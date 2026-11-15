import * as THREE from './vendor/three.module.min.js';
import { scenery, createEnvironment, createCityDecorations, getModel, MAIN_ROAD_LANES } from './models3d.js';
import { getLightingProfile, applyLightingShader } from './lighting3d.js';
import { PixelArtEffect, SCENE_STYLES } from './pixelart3d.js';
import { SIN_ELEVATION, COS_ELEVATION, GROUND_AXIS_Y } from './projection3d.js';

export { SCENE_STYLES };

const PIXELS_PER_UNIT = 55;
const SQRT2 = Math.sqrt(2);
const MAX_RENDER_PIXELS = 1920 * 1080;
const MAX_INSTANCES = 16384;

// Four primitive types, plus unlit geometry for lamps: draw calls stay constant as crowds grow.
class Batch {
  constructor(scene, geometry, material, capacity, dynamic) {
    this.scene = scene;
    this.geometry = geometry.clone();
    this.material = material;
    this.dynamic = dynamic;
    this.capacity = capacity;
    this.create();
  }

  create() {
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity).fill(1), 1);
    this.geometry.setAttribute('instanceAlpha', this.alpha);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
    this.mesh.instanceMatrix.setUsage(this.dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3);
    this.mesh.instanceColor.setUsage(this.dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
    this.alpha.setUsage(this.dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
    // We cull whole models in screen space before submission; a changing batch has no fixed bounds.
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.scene.add(this.mesh);
  }

  add(matrix, color, alpha) {
    const index = this.mesh.count;
    if (index >= this.capacity) {
      if (this.capacity >= MAX_INSTANCES) return;
      const old = this.mesh;
      const oldAlpha = this.alpha.array;
      this.capacity = Math.min(MAX_INSTANCES, this.capacity * 2);
      this.scene.remove(old);
      this.create();
      this.mesh.instanceMatrix.array.set(old.instanceMatrix.array);
      this.mesh.instanceColor.array.set(old.instanceColor.array);
      this.alpha.array.set(oldAlpha);
      this.mesh.count = index;
      old.dispose();
    }
    this.mesh.setMatrixAt(index, matrix);
    this.mesh.setColorAt(index, color);
    this.alpha.array[index] = alpha;
    this.mesh.count++;
  }

  commit() {
    this.mesh.visible = this.mesh.count > 0;
    for (const [attribute, size] of [[this.mesh.instanceMatrix, 16], [this.mesh.instanceColor, 3], [this.alpha, 1]]) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, this.mesh.count * size);
      attribute.needsUpdate = true;
    }
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
  }
}

function fadingMaterial(uniforms, unlit = false, paving = false) {
  const material = unlit ? new THREE.MeshBasicMaterial() : new THREE.MeshLambertMaterial({ flatShading: true });
  // Ordered coverage keeps depth writes and correct 3D occlusion during fades, without sorting
  // thousands of transparent meshes. Models at full opacity use the same inexpensive shader.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float instanceAlpha; varying float vAlpha;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = instanceAlpha;');
    shader.fragmentShader = 'varying float vAlpha;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
      #include <alphatest_fragment>
      vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
      vec2 lo = mod(cell, 2.0);
      vec2 hi = floor(cell / 2.0);
      float coverage = 4.0 * (2.0 * lo.x + 3.0 * lo.y - 4.0 * lo.x * lo.y)
        + 2.0 * hi.x + 3.0 * hi.y - 4.0 * hi.x * hi.y;
      if (vAlpha <= (coverage + 0.5) / 16.0) discard;
    `);
    applyLightingShader(shader, uniforms, unlit);
    if (paving) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        vec2 tile = vSceneWorldPosition.xz / (11.4 / 14.0) + vec2(0.0, 7.0);
        vec2 edge = min(fract(tile), 1.0 - fract(tile));
        float distanceToSeam = min(edge.x, edge.y);
        float seam = 1.0 - smoothstep(0.012, 0.012 + max(fwidth(distanceToSeam), 0.005), distanceToSeam);
        float tone = mod(floor(tile.x) + floor(tile.y), 3.0);
        diffuseColor.rgb *= (1.0 - tone * 0.018) * (1.0 - seam * 0.19);
      `);
    }
  };
  material.customProgramCacheKey = () => paving ? 'paving-lighting' : 'scene-lighting';
  return material;
}

function haloMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { uNightLights: uniforms.uNightLights },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float instanceAlpha;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vUv = uv;
        vColor = instanceColor;
        vAlpha = instanceAlpha;
        vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec2 size = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
        center.xy += position.xy * size;
        gl_Position = projectionMatrix * center;
      }
    `,
    fragmentShader: `
      uniform float uNightLights;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float radius = length(vUv - 0.5);
        float glow = 1.0 - smoothstep(0.0, 0.5, radius);
        float alpha = glow * glow * vAlpha * uNightLights * 0.42;
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(vColor, alpha);
        #include <colorspace_fragment>
      }
    `,
  });
}

export class IsometricScene {
  constructor(canvas, style = 'original') {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    // Count scene and postprocessing draws together.
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-20, 20, 20, -20, .1, 300);
    this.ambient = new THREE.HemisphereLight('#fff8df', '#80919e', 2.1);
    this.sun = new THREE.DirectionalLight('#fff2d4', 2.4);
    this.sun.position.set(-15, 28, 10);
    this.scene.add(this.ambient, this.sun);
    this.lightingUniforms = {
      uSceneSaturation: { value: 1 }, uSceneBrightness: { value: 1 },
      uSceneTint: { value: new THREE.Vector3(1, 1, 1) }, uNightLights: { value: 0 },
      uBusFront: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      uBusDirection: { value: [new THREE.Vector2(), new THREE.Vector2()] },
    };
    this.material = fadingMaterial(this.lightingUniforms);
    this.glowMaterial = fadingMaterial(this.lightingUniforms, true);
    this.pavingMaterial = fadingMaterial(this.lightingUniforms, false, true);
    this.haloMaterial = haloMaterial(this.lightingUniforms);
    this.geometries = {
      box: new THREE.BoxGeometry(1, 1, 1),
      paving: new THREE.BoxGeometry(1, 1, 1),
      sphere: new THREE.SphereGeometry(.5, 10, 6),
      cylinder: new THREE.CylinderGeometry(.5, .5, 1, 10),
      cone: new THREE.CylinderGeometry(0, .5, 1, 10),
      light: new THREE.PlaneGeometry(1, 1),
    };
    this.staticBatches = new Map();
    this.batches = new Map();
    this.holidaySpecs = [];
    this.root = new THREE.Matrix4();
    this.matrix = new THREE.Matrix4();
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.scale = new THREE.Vector3();
    this.axis = new THREE.Vector3(0, 1, 0);
    this.projected = new THREE.Vector3();
    this.contextLost = false;
    this.onLost = (event) => { event.preventDefault(); this.contextLost = true; };
    this.onRestored = () => { this.contextLost = false; };
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.style = 'original';
    this.pixelEffect = null;
    this.setStyle(style);
    this.resize(window.innerWidth, window.innerHeight);
    this.lastElevation = null;
    this.busLightCount = 0;
  }

  setStyle(style) {
    if (!Object.hasOwn(SCENE_STYLES, style)) style = 'original';
    if (style === this.style) return;
    this.pixelEffect?.dispose();
    this.pixelEffect = style === 'original' ? null : new PixelArtEffect(style);
    this.style = style;
    this.renderer.domElement.style.imageRendering = this.pixelEffect ? 'pixelated' : 'auto';
    if (this.width) this.resize(this.width, this.height);
  }

  submit(model, root, alpha = 1, batches = this.batches) {
    for (const part of model.parts) {
      let batch = batches.get(part.shape);
      if (!batch) {
        const glow = part.shape.endsWith('-glow');
        const shape = part.shape.replace('-glow', '');
        const material = shape === 'light' ? this.haloMaterial : shape === 'paving' ? this.pavingMaterial
          : glow ? this.glowMaterial : this.material;
        batch = new Batch(this.scene, this.geometries[shape], material,
          batches === this.batches ? 256 : 512, batches === this.batches);
        batches.set(part.shape, batch);
      }
      this.matrix.multiplyMatrices(root, part.matrix);
      batch.add(this.matrix, part.color, alpha);
    }
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    if (this.pixelEffect) {
      const pixelSize = SCENE_STYLES[this.style].pixelSize;
      this.pixelScale = Math.max(pixelSize, Math.ceil(Math.sqrt(width * height / MAX_RENDER_PIXELS) * pixelSize));
      // Cover the viewport with whole pixel blocks, including at odd window dimensions.
      const maxPixels = MAX_RENDER_PIXELS / pixelSize ** 2;
      while (Math.ceil(width / this.pixelScale) * Math.ceil(height / this.pixelScale) > maxPixels) this.pixelScale++;
      this.renderer.setPixelRatio(1);
      const renderWidth = Math.max(1, Math.ceil(width / this.pixelScale));
      const renderHeight = Math.max(1, Math.ceil(height / this.pixelScale));
      this.canvasWidth = renderWidth * this.pixelScale;
      this.canvasHeight = renderHeight * this.pixelScale;
      this.renderer.setSize(renderWidth, renderHeight, false);
      this.pixelEffect.resize(renderWidth, renderHeight);
    } else {
      this.canvasWidth = width;
      this.canvasHeight = height;
      this.pixelScale = 1;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(MAX_RENDER_PIXELS / (width * height)));
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(width, height, false);
    }
    this.renderer.domElement.style.width = `${this.canvasWidth}px`;
    this.renderer.domElement.style.height = `${this.canvasHeight}px`;
    // Keep the original 990-unit layout so queues, routes and seasonal anchors share coordinates.
    this.layoutSize = Math.min(width, height) * .4;
    this.layoutX = (width - this.layoutSize) / 2;
    this.layoutY = (height - this.layoutSize) / 2;
    this.pixelsPerWorldUnit = this.layoutSize / 990 * PIXELS_PER_UNIT;
    const halfW = this.canvasWidth / this.pixelsPerWorldUnit / 2;
    const halfH = this.canvasHeight / this.pixelsPerWorldUnit / 2;
    const centerX = this.layoutX + 495 * this.layoutSize / 990;
    const centerY = this.layoutY + 580 * this.layoutSize / 990;
    const offsetX = (this.canvasWidth / 2 - centerX) / this.pixelsPerWorldUnit;
    const offsetY = (centerY - this.canvasHeight / 2) / this.pixelsPerWorldUnit;
    // Move only along the viewing axis on tall displays: framing is unchanged, but the near
    // plane cannot cut through the foreground city when the visible ground becomes deeper.
    const groundDepth = (halfH + Math.abs(offsetY)) * COS_ELEVATION / SIN_ELEVATION;
    const distance = Math.max(90, groundDepth + 35);
    this.camera.position.set(distance * COS_ELEVATION / SQRT2, distance * SIN_ELEVATION,
      distance * COS_ELEVATION / SQRT2);
    this.camera.lookAt(0, 0, 0);
    this.camera.far = Math.max(300, distance + groundDepth + 100);
    this.camera.left = -halfW + offsetX;
    this.camera.right = halfW + offsetX;
    this.camera.top = halfH + offsetY;
    this.camera.bottom = -halfH + offsetY;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.resizeEnvironment();
  }

  resizeEnvironment() {
    // Orthographic screen corners projected onto the ground; add room for roofs at the edges.
    const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        this.projected.set(x, y, 0).unproject(this.camera);
        this.projected.addScaledVector(direction, -this.projected.y / direction.y);
        bounds.minX = Math.min(bounds.minX, this.projected.x);
        bounds.maxX = Math.max(bounds.maxX, this.projected.x);
        bounds.minZ = Math.min(bounds.minZ, this.projected.z);
        bounds.maxZ = Math.max(bounds.maxZ, this.projected.z);
      }
    }
    for (const axis of ['X', 'Z']) {
      bounds[`min${axis}`] = Math.floor(bounds[`min${axis}`] / 12) * 12 - 12;
      bounds[`max${axis}`] = Math.ceil(bounds[`max${axis}`] / 12) * 12 + 12;
    }
    const view = { minU: this.camera.left, maxU: this.camera.right,
      minV: -this.camera.top, maxV: -this.camera.bottom };
    const key = JSON.stringify([bounds, view]);
    if (key === this.environmentKey) return;
    this.environment = createEnvironment(bounds, view);
    this.environmentKey = key;
    this.environmentBounds = bounds;
    this.buildingCount = this.environment.buildingCount;
    this.parkCount = this.environment.parkCount;
    this.rebuildStaticScene();
  }

  setHolidayDecorations(specs) {
    this.holidaySpecs = specs;
    this.rebuildStaticScene();
  }

  rebuildStaticScene() {
    this.staticBatches.forEach((batch) => { batch.mesh.count = 0; });
    this.root.identity();
    this.submit(this.environment, this.root, 1, this.staticBatches);
    this.submit(scenery, this.root, 1, this.staticBatches);
    this.cityDecorations = createCityDecorations(this.environment, this.holidaySpecs);
    for (const prop of this.cityDecorations) {
      const model = getModel(prop.model);
      this.position.set(prop.x, prop.y, prop.z);
      this.scale.setScalar(prop.height / (PIXELS_PER_UNIT * COS_ELEVATION * model.height));
      this.quaternion.setFromAxisAngle(this.axis, prop.angle);
      this.root.compose(this.position, this.quaternion, this.scale);
      this.submit(model, this.root, 1, this.staticBatches);
    }
    this.staticBatches.forEach((batch) => batch.commit());
  }

  begin(darkness, solar = null) {
    this.batches.forEach((batch) => { batch.mesh.count = 0; });
    this.busLightCount = 0;
    this.lightingUniforms.uBusFront.value.forEach((front) => { front.w = 0; });
    const elevation = solar?.elevationHours ?? 2 - darkness * 4;
    const morning = solar?.isMorning ?? false;
    if (this.lastElevation === null || Math.abs(this.lastElevation - elevation) > .0001 || this.lastMorning !== morning) {
      const profile = getLightingProfile(elevation, morning);
      this.lighting = profile;
      this.lightingUniforms.uSceneSaturation.value = profile.saturation;
      this.lightingUniforms.uSceneBrightness.value = profile.brightness;
      this.lightingUniforms.uSceneTint.value.fromArray(profile.tint);
      this.lightingUniforms.uNightLights.value = profile.lights;
      this.ambient.intensity = profile.ambient;
      this.ambient.color.setRGB(...profile.skyTint);
      this.ambient.groundColor.setRGB(...profile.groundTint);
      this.sun.intensity = profile.sun;
      this.sun.color.setRGB(...profile.sunTint);
      this.lastElevation = elevation;
      this.lastMorning = morning;
    }
  }

  // Convert projected layout ground coordinates back into the XZ plane.
  ground(x, y) {
    const u = (x - 495) / PIXELS_PER_UNIT;
    const v = (y - 580) / PIXELS_PER_UNIT;
    this.position.set(u / SQRT2 + v / (2 * GROUND_AXIS_Y), .23, -u / SQRT2 + v / (2 * GROUND_AXIS_Y));
    return this.position;
  }

  draw(key, x, y, height, angle = 0, alpha = 1, lift = 0) {
    this.ground(x, y).y += lift;
    return this.drawAtPosition(key, height, angle, alpha);
  }

  drawAtPosition(key, height, angle = 0, alpha = 1) {
    if (alpha <= 0) return false;
    const model = getModel(key);
    const size = height / (PIXELS_PER_UNIT * COS_ELEVATION * model.height);
    this.projected.copy(this.position).project(this.camera);
    const margin = Math.max(2, size * model.height * 2) * this.pixelsPerWorldUnit;
    const sx = (this.projected.x + 1) * this.canvasWidth / 2;
    const sy = (1 - this.projected.y) * this.canvasHeight / 2;
    if (sx < -margin || sx > this.width + margin || sy < -margin || sy > this.height + margin) return false;
    this.quaternion.setFromAxisAngle(this.axis, angle);
    this.scale.setScalar(size);
    this.root.compose(this.position, this.quaternion, this.scale);
    this.submit(model, this.root, alpha);
    return true;
  }

  drawBus(direction, x, y, moving, alpha, now) {
    // Retain longitudinal progress from the layout path, but align the model's axle
    // centre with the actual 3D lane throughout arrival, stopping and departure.
    const sign = direction === 'central' ? 1 : -1;
    const lane = sign === 1 ? MAIN_ROAD_LANES.central : MAIN_ROAD_LANES.route;
    this.ground(x + 175, y + 245);
    this.position.x = (lane.min + lane.max) / 2;
    this.position.y = moving ? Math.sin(now / 75) * .015 : 0;
    const visible = this.drawAtPosition(moving ? 'bus' : 'bus-open', 122,
      sign === 1 ? 0 : Math.PI, alpha);
    if (visible && this.busLightCount < 2) {
      const index = this.busLightCount++;
      this.lightingUniforms.uBusFront.value[index].set(this.position.x,
        this.position.y + .81 * this.scale.y, this.position.z + sign * 2.86 * this.scale.z, alpha);
      this.lightingUniforms.uBusDirection.value[index].set(0, sign);
    }
  }

  drawStudent(student, x, y, walking, alpha, outfit, now) {
    const phase = walking ? Math.round(Math.sin(now / student.bounceSpeed + student.bouncePhase) * 3) : 0;
    this.draw(`student|${outfit.join(',')}|${phase}|${student.seq % 4}`, x, y, 70,
      student.flip ? Math.PI : 0, alpha, walking ? Math.abs(phase) * .018 : 0);
  }

  drawFloating(key, x, y, height) {
    // Screen coordinates to a point in the camera's plane. Unlike ground props this can cross the sky.
    const model = getModel(key);
    this.position.set(x / this.canvasWidth * 2 - 1, 1 - y / this.canvasHeight * 2, -.65).unproject(this.camera);
    const size = height / (this.pixelsPerWorldUnit * COS_ELEVATION * 3.3);
    this.quaternion.identity();
    this.scale.setScalar(size);
    this.root.compose(this.position, this.quaternion, this.scale);
    this.submit(model, this.root);
  }

  render() {
    if (this.contextLost) return;
    this.batches.forEach((batch) => batch.commit());
    for (const batches of [this.staticBatches, this.batches]) {
      const halo = batches.get('light');
      if (halo) halo.mesh.visible = halo.mesh.count > 0 && this.lightingUniforms.uNightLights.value > .001;
    }
    this.renderer.info.reset();
    if (this.pixelEffect) this.pixelEffect.render(this.renderer, this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
  }

  getStats() {
    return { ...this.renderer.info.render, geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures, pixelRatio: this.renderer.getPixelRatio(),
      style: this.style, pixelScale: this.pixelScale, postPasses: this.pixelEffect ? 1 : 0,
      buildings: this.buildingCount,
      blocks: this.environment.blocks.length,
      parks: this.parkCount,
      decorations: this.cityDecorations.length,
      streetLights: this.environment.streetLights.length, busLights: this.busLightCount,
      phase: this.lighting?.phase, saturation: this.lighting?.saturation, nightLights: this.lighting?.lights,
      bufferWidth: this.renderer.domElement.width, bufferHeight: this.renderer.domElement.height };
  }

  dispose() {
    this.pixelEffect?.dispose();
    this.staticBatches.forEach((batch) => batch.dispose());
    this.batches.forEach((batch) => batch.dispose());
    Object.values(this.geometries).forEach((geometry) => geometry.dispose());
    this.material.dispose();
    this.glowMaterial.dispose();
    this.pavingMaterial.dispose();
    this.haloMaterial.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onRestored);
    this.renderer.dispose();
  }
}
