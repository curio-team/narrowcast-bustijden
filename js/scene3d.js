import * as THREE from './vendor/three.module.min.js';
import { scenery, createEnvironment, createCityDecorations, getModel, MAIN_ROAD_LANES } from './models3d.js';
import { getLightingProfile, applyLightingShader, CACHED_LIGHTS_GLSL } from './lighting3d.js';
import { PixelArtEffect, SCENE_STYLES } from './pixelart3d.js';
import { SIN_ELEVATION, COS_ELEVATION, GROUND_AXIS_Y } from './projection3d.js';

export { SCENE_STYLES };

const PIXELS_PER_UNIT = 55;
const SQRT2 = Math.sqrt(2);
const MAX_RENDER_PIXELS = 1920 * 1080;
const LOW_QUALITY_RENDER_PIXELS = 1280 * 720;
const MAX_INSTANCES = 16384;

function sameValues(a, b, length) {
  for (let n = 0; n < length; n++) if (a[n] !== b[n]) return false;
  return true;
}

function createLights() {
  const ambient = new THREE.HemisphereLight('#fff8df', '#80919e', 2.1);
  const sun = new THREE.DirectionalLight('#fff2d4', 2.4);
  sun.position.set(-15, 28, 10);
  return [ambient, sun];
}

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
    this.minPixelWidth = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 2), 2);
    this.geometry.setAttribute('instanceAlpha', this.alpha);
    this.geometry.setAttribute('instancePixelStem', this.minPixelWidth);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.capacity);
    this.mesh.instanceMatrix.setUsage(this.dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3);
    this.mesh.instanceColor.setUsage(this.dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
    this.alpha.setUsage(this.dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
    this.minPixelWidth.setUsage(this.dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage);
    // We cull whole models in screen space before submission; a changing batch has no fixed bounds.
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.scene.add(this.mesh);
    this.attributes = [[this.mesh.instanceMatrix, 16], [this.mesh.instanceColor, 3], [this.alpha, 1], [this.minPixelWidth, 2]];
    // Dynamic batches remember their last upload, so frames where nothing moved can be skipped.
    this.uploaded = this.dynamic ? this.attributes.map(([attribute]) => new Float32Array(attribute.array.length)) : null;
    this.uploadedCount = -1;
  }

  add(matrix, color, alpha, minPixelWidth = 0, box = false) {
    const index = this.mesh.count;
    if (index >= this.capacity) {
      if (this.capacity >= MAX_INSTANCES) return;
      const old = this.mesh;
      const oldAlpha = this.alpha.array;
      const oldMinPixelWidth = this.minPixelWidth.array;
      this.capacity = Math.min(MAX_INSTANCES, this.capacity * 2);
      this.scene.remove(old);
      this.create();
      this.mesh.instanceMatrix.array.set(old.instanceMatrix.array);
      this.mesh.instanceColor.array.set(old.instanceColor.array);
      this.alpha.array.set(oldAlpha);
      this.minPixelWidth.array.set(oldMinPixelWidth);
      this.mesh.count = index;
      old.dispose();
    }
    this.mesh.setMatrixAt(index, matrix);
    this.mesh.setColorAt(index, color);
    this.alpha.array[index] = alpha;
    this.minPixelWidth.array[index * 2] = minPixelWidth;
    this.minPixelWidth.array[index * 2 + 1] = box ? 1 : 0;
    this.mesh.count++;
  }

  // Uploads the instances. Returns false when they are identical to the previous upload.
  commit() {
    const count = this.mesh.count;
    this.mesh.visible = count > 0;
    if (this.uploaded && count === this.uploadedCount && this.attributes.every(([attribute, size], n) =>
      sameValues(attribute.array, this.uploaded[n], count * size))) return false;
    this.attributes.forEach(([attribute, size], n) => {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, count * size);
      attribute.needsUpdate = true;
      this.uploaded?.[n].set(attribute.array.subarray(0, count * size));
    });
    this.uploadedCount = count;
    return true;
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
    shader.vertexShader = 'attribute float instanceAlpha; attribute vec2 instancePixelStem;\n'
      + 'uniform vec2 uPixelViewport; varying float vAlpha;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = instanceAlpha;');
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      #include <project_vertex>
      if (uPixelViewport.x > 0.0 && instancePixelStem.x > 0.0) {
        // Upright stems get an integer width and matching centre parity on the pixel grid.
        mat4 pixelTransform = projectionMatrix * modelViewMatrix * instanceMatrix;
        vec4 center = pixelTransform * vec4(0.0, position.y, 0.0, 1.0);
        float halfViewport = uPixelViewport.x * 0.5;
        vec2 crossSection = abs(vec2(pixelTransform[0].x, pixelTransform[2].x));
        float diameter = mix(length(crossSection), crossSection.x + crossSection.y, instancePixelStem.y) * halfViewport;
        float width = max(instancePixelStem.x, floor(diameter + 0.5));
        float parity = mod(width, 2.0);
        float screenCenter = (center.x + 1.0) * halfViewport;
        float snappedCenter = floor(screenCenter + 0.5 * (1.0 - parity)) + parity * 0.5;
        gl_Position.x = (snappedCenter / halfViewport - 1.0)
          + (gl_Position.x - center.x) * width / max(diameter, 0.0001);
      }
    `);
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
      shader.fragmentShader = 'uniform vec3 uPavingGrid;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        vec2 tile;
        float seam;
        if (uPavingGrid.x > 0.0) {
          // All paved surfaces share one integer diamond lattice, regardless of mesh height.
          vec2 pixel = floor(gl_FragCoord.xy) - uPavingGrid.yz;
          vec2 lattice = vec2(pixel.x - 2.0 * pixel.y, -pixel.x - 2.0 * pixel.y) + 0.5;
          float period = uPavingGrid.x * 2.0;
          tile = lattice / period;
          vec2 gridEdge = mod(lattice, period);
          seam = min(gridEdge.x, gridEdge.y) < 2.0 ? 1.0 : 0.0;
        } else {
          tile = vSceneWorldPosition.xz / (11.4 / 14.0) + vec2(0.0, 7.0);
          vec2 edge = min(fract(tile), 1.0 - fract(tile));
          float distanceToSeam = min(edge.x, edge.y);
          seam = 1.0 - smoothstep(0.012, 0.012 + max(fwidth(distanceToSeam), 0.005), distanceToSeam);
        }
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

// Copies the cached static city into the frame, depth included, so moving models stay occluded.
// Busses move, so the light of their headlights on the cached surfaces is added here per frame.
function cachedSceneMaterial(uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      tColor: { value: null },
      tDepth: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uInverseViewProjection: { value: new THREE.Matrix4() },
      uHemiSky: { value: new THREE.Vector3() },
      uHemiGround: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Vector3() },
      uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    },
    depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth, blending: THREE.NoBlending,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D tColor;
      uniform highp sampler2D tDepth;
      uniform vec2 uResolution;
      uniform mat4 uInverseViewProjection;
      uniform vec3 uHemiSky;
      uniform vec3 uHemiGround;
      uniform vec3 uSunColor;
      uniform vec3 uSunDirection;
      ${CACHED_LIGHTS_GLSL}

      mat3 diagonal(vec3 v) { return mat3(v.x, 0.0, 0.0, 0.0, v.y, 0.0, 0.0, 0.0, v.z); }

      vec3 worldAt(ivec2 pixel, float depth) {
        vec4 world = uInverseViewProjection * vec4((vec2(pixel) + 0.5) / uResolution * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        return world.xyz / world.w;
      }

      vec3 neighbourAt(ivec2 pixel) {
        pixel = clamp(pixel, ivec2(0), ivec2(uResolution) - 1);
        return worldAt(pixel, texelFetch(tDepth, pixel, 0).r);
      }

      // Per axis, the neighbour on the same surface (the smaller step) gives the slope, so pixels next to an
      // edge don't get the normal of whatever lies behind it.
      vec3 surfaceNormal(ivec2 pixel, vec3 center) {
        vec3 left = center - neighbourAt(pixel - ivec2(1, 0));
        vec3 right = neighbourAt(pixel + ivec2(1, 0)) - center;
        vec3 down = center - neighbourAt(pixel - ivec2(0, 1));
        vec3 up = neighbourAt(pixel + ivec2(0, 1)) - center;
        return normalize(cross(dot(left, left) < dot(right, right) ? left : right,
          dot(down, down) < dot(up, up) ? down : up));
      }

      void main() {
        ivec2 pixel = ivec2(gl_FragCoord.xy);
        vec4 color = texelFetch(tColor, pixel, 0);
        float depth = texelFetch(tDepth, pixel, 0).r;
        gl_FragDepth = depth;
        if (uNightLights > 0.001 && max(uBusFront[0].w, uBusFront[1].w) > 0.0 && depth < 1.0) {
          vec3 position = worldAt(pixel, depth);
          // The beam shape doesn't depend on the normal, only its strength does: most pixels stop here.
          if (dot(busIllumination(position, vec3(0.0, 1.0, 0.0)), vec3(1.0)) > 0.0) {
            vec3 normal = surfaceNormal(pixel, position);
            vec3 beam = busIllumination(position, normal) * uNightLights;
            // The Lambert light, night grade and street lamps are all linear in the surface colour,
            // so recover that colour and add the beam exactly like the scene shader does.
            vec3 irradiance = (mix(uHemiGround, uHemiSky, 0.5 * normal.y + 0.5)
              + uSunColor * max(dot(normal, uSunDirection), 0.0)) * 0.3183098862; // Lambert's 1 / PI
            vec3 weights = vec3(0.2126, 0.7152, 0.0722);
            mat3 grade = mat3(uSceneSaturation)
              + (1.0 - uSceneSaturation) * mat3(vec3(weights.x), vec3(weights.y), vec3(weights.z));
            mat3 response = diagonal(uSceneTint * uSceneBrightness) * grade * diagonal(irradiance)
              + diagonal(streetLightIllumination(position, normal) * uNightLights);
            color.rgb += clamp(inverse(response) * color.rgb, 0.0, 1.0) * beam;
          }
        }
        gl_FragColor = color;
        #include <colorspace_fragment>
      }
    `,
  });
}

export class IsometricScene {
  // options.quality = 'low' renders fewer pixels without antialiasing, for the weakest displays.
  // options.opaque: the scene covers the whole canvas, so the browser doesn't have to blend it with the page.
  constructor(canvas, style = 'original', options = {}) {
    this.antialias = options.quality !== 'low';
    this.maxRenderPixels = options.quality === 'low' ? LOW_QUALITY_RENDER_PIXELS : MAX_RENDER_PIXELS;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: !options.opaque, antialias: this.antialias,
      powerPreference: 'low-power' });
    // Count scene and postprocessing draws together.
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // The city, street and stop never move: they are drawn once into staticTarget, and each frame only
    // copies that and draws the moving models over it. See render().
    this.scene = new THREE.Scene();
    this.staticScene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-20, 20, 20, -20, .1, 300);
    [this.ambient, this.sun] = createLights();
    this.scene.add(this.ambient, this.sun);
    this.staticLights = createLights();
    this.staticScene.add(...this.staticLights);
    this.lightingUniforms = {
      uSceneSaturation: { value: 1 }, uSceneBrightness: { value: 1 },
      uSceneTint: { value: new THREE.Vector3(1, 1, 1) }, uNightLights: { value: 0 },
      uBusFront: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      uBusDirection: { value: [new THREE.Vector2(), new THREE.Vector2()] },
      uPixelViewport: { value: new THREE.Vector2() },
      uPavingGrid: { value: new THREE.Vector3() },
    };
    this.material = fadingMaterial(this.lightingUniforms);
    this.glowMaterial = fadingMaterial(this.lightingUniforms, true);
    this.pavingMaterial = fadingMaterial(this.lightingUniforms, false, true);
    this.haloMaterial = haloMaterial(this.lightingUniforms);
    this.cacheMaterial = cachedSceneMaterial(this.lightingUniforms);
    this.cacheMaterial.uniforms.uSunDirection.value.copy(this.sun.position).normalize();
    // One oversized triangle covers the screen. It is drawn before every other model.
    this.cacheGeometry = new THREE.BufferGeometry();
    this.cacheGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const cachedScene = new THREE.Mesh(this.cacheGeometry, this.cacheMaterial);
    cachedScene.frustumCulled = false;
    cachedScene.renderOrder = -1;
    this.scene.add(cachedScene);
    this.cacheSize = this.cacheMaterial.uniforms.uResolution.value;
    this.cameraSnapshot = new Float64Array(32).fill(NaN);
    this.staticDirty = true;
    this.forceRender = true;
    this.staticRenders = 0;
    this.skippedFrames = 0;
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
    this.pixelRight = new THREE.Vector3();
    this.pixelUp = new THREE.Vector3();
    this.pixelFrameMatrix = new THREE.Matrix4();
    this.pixelPartPoint = new THREE.Vector3();
    this.contextLost = false;
    this.onLost = (event) => { event.preventDefault(); this.contextLost = true; };
    this.onRestored = () => {
      this.contextLost = false;
      this.staticDirty = true;
      this.forceRender = true;
    };
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.style = 'original';
    this.pixelEffect = null;
    this.createStaticTarget();
    this.setStyle(style);
    this.resize(window.innerWidth, window.innerHeight);
    this.lastElevation = null;
    this.busLightCount = 0;
  }

  createStaticTarget() {
    this.staticTarget?.depthTexture?.dispose();
    this.staticTarget?.dispose();
    // sRGB storage keeps 8-bit precision in the dark night colours. Pixel styles have their own low resolution target.
    this.staticTarget = new THREE.WebGLRenderTarget(this.cacheSize.x, this.cacheSize.y, {
      samples: this.pixelEffect || !this.antialias ? 0 : 4,
      colorSpace: THREE.SRGBColorSpace,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
      depthTexture: new THREE.DepthTexture(this.cacheSize.x, this.cacheSize.y),
    });
    this.cacheMaterial.uniforms.tColor.value = this.staticTarget.texture;
    this.cacheMaterial.uniforms.tDepth.value = this.staticTarget.depthTexture;
    this.staticDirty = true;
  }

  setStyle(style) {
    if (!Object.hasOwn(SCENE_STYLES, style)) style = 'original';
    if (style === this.style) return;
    this.pixelEffect?.dispose();
    this.pixelEffect = style === 'original' ? null : new PixelArtEffect(style);
    this.style = style;
    this.renderer.domElement.style.imageRendering = this.pixelEffect ? 'pixelated' : 'auto';
    this.createStaticTarget();
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
        // Additive halos are not cached: moving models would hide the glow in front of them.
        const scene = batches === this.batches || shape === 'light' ? this.scene : this.staticScene;
        batch = new Batch(scene, this.geometries[shape], material,
          batches === this.batches ? 256 : 512, batches === this.batches);
        batches.set(part.shape, batch);
      }
      this.matrix.multiplyMatrices(root, part.matrix);
      if (this.pixelEffect && part.pixelPlane) this.fitPixelPlane(part.pixelPlane, root);
      batch.add(this.matrix, part.color, alpha, part.minPixelWidth, part.shape.startsWith('box'));
    }
  }

  pixelSpan(matrix, axis, basis) {
    const e = matrix.elements;
    const i = axis * 4;
    return Math.abs(e[i] * basis.x + e[i + 1] * basis.y + e[i + 2] * basis.z) / this.pixelWorldSize;
  }

  fitPixelPlane(hint, root) {
    const group = this.pixelFrameMatrix.multiplyMatrices(root, hint.matrix);
    const [horizontal, vertical] = hint.axes;
    const originalWidth = this.pixelSpan(group, horizontal, this.pixelRight);
    const originalHeight = this.pixelSpan(group, vertical, vertical === 1 ? this.pixelUp : this.pixelRight);
    if (originalWidth < .01 || originalHeight < .01) return;
    const g = group.elements;
    const h = horizontal * 4;
    const v = vertical * 4;
    const a = this.pixelRight.x * g[h] + this.pixelRight.y * g[h + 1] + this.pixelRight.z * g[h + 2];
    const b = this.pixelRight.x * g[v] + this.pixelRight.y * g[v + 1] + this.pixelRight.z * g[v + 2];
    const c = this.pixelUp.x * g[h] + this.pixelUp.y * g[h + 1] + this.pixelUp.z * g[h + 2];
    const d = this.pixelUp.x * g[v] + this.pixelUp.y * g[v + 1] + this.pixelUp.z * g[v + 2];
    const determinant = a * d - b * c;
    if (Math.abs(determinant) < .000001
      || Math.abs(a) < Math.hypot(g[h], g[h + 1], g[h + 2]) * .25
      || (vertical !== 1 && Math.abs(b) < Math.hypot(g[v], g[v + 1], g[v + 2]) * .25)) return;
    // Ground axes advance in pairs of pixels, retaining the camera's 2:1 diagonals.
    const heightStep = vertical === 1 ? 1 : 2;
    const width = Math.max(hint.framed ? 4 : 2, (hint.framed ? Math.ceil(originalWidth / 2) : Math.round(originalWidth / 2)) * 2);
    const height = Math.max(hint.framed ? 4 : heightStep, Math.round(originalHeight / heightStep) * heightStep);
    const inset = hint.inset || 0;
    const e = this.matrix.elements;
    const sx = (width - inset * 2) / this.pixelSpan(this.matrix, horizontal, this.pixelRight);
    const sy = (height - inset * 2) / this.pixelSpan(this.matrix, vertical, vertical === 1 ? this.pixelUp : this.pixelRight);
    for (let row = 0; row < 3; row++) {
      e[horizontal * 4 + row] *= sx;
      e[vertical * 4 + row] *= sy;
    }
    this.pixelPartPoint.setFromMatrixPosition(group).project(this.camera);
    const viewport = this.lightingUniforms.uPixelViewport.value;
    const centerX = Math.round((this.pixelPartPoint.x + 1) * viewport.x / 2);
    const parity = (width / 2 + height / heightStep) % 2 * .5;
    const centerY = Math.round((this.pixelPartPoint.y + 1) * viewport.y / 2 - parity) + parity;
    this.pixelPartPoint.setFromMatrixPosition(this.matrix).project(this.camera);
    const dx = (centerX - (this.pixelPartPoint.x + 1) * viewport.x / 2) * this.pixelWorldSize;
    const dy = (centerY - (this.pixelPartPoint.y + 1) * viewport.y / 2) * this.pixelWorldSize;
    const along = (dx * d - dy * b) / determinant;
    const across = (dy * a - dx * c) / determinant;
    // Move within the surface so panes and trim cannot sink into their supporting wall/body.
    for (let row = 0; row < 3; row++) e[12 + row] += g[h + row] * along + g[v + row] * across;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    if (this.pixelEffect) {
      const pixelSize = SCENE_STYLES[this.style].pixelSize;
      this.pixelScale = Math.max(pixelSize, Math.ceil(Math.sqrt(width * height / this.maxRenderPixels) * pixelSize));
      // Cover the viewport with whole pixel blocks, including at odd window dimensions.
      const maxPixels = this.maxRenderPixels / pixelSize ** 2;
      while (Math.ceil(width / this.pixelScale) * Math.ceil(height / this.pixelScale) > maxPixels) this.pixelScale++;
      this.renderer.setPixelRatio(1);
      const renderWidth = Math.max(1, Math.ceil(width / this.pixelScale));
      const renderHeight = Math.max(1, Math.ceil(height / this.pixelScale));
      this.canvasWidth = renderWidth * this.pixelScale;
      this.canvasHeight = renderHeight * this.pixelScale;
      this.renderer.setSize(renderWidth, renderHeight, false);
      this.pixelEffect.resize(renderWidth, renderHeight);
      this.lightingUniforms.uPixelViewport.value.set(renderWidth, renderHeight);
    } else {
      this.canvasWidth = width;
      this.canvasHeight = height;
      this.pixelScale = 1;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(this.maxRenderPixels / (width * height)));
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(width, height, false);
      this.lightingUniforms.uPixelViewport.value.set(0, 0);
    }
    // The cache matches the buffer that each frame is drawn into, pixel for pixel.
    if (this.pixelEffect) this.cacheSize.set(this.pixelEffect.target.width, this.pixelEffect.target.height);
    else this.renderer.getDrawingBufferSize(this.cacheSize);
    this.staticTarget.setSize(this.cacheSize.x, this.cacheSize.y);
    this.staticDirty = true;
    this.forceRender = true;
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
    this.pixelRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.pixelUp.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.pixelWorldSize = this.pixelEffect ? this.pixelScale / this.pixelsPerWorldUnit : 0;
    if (this.pixelEffect) {
      const tileWidth = Math.max(2, Math.round((11.4 / 14) / (SQRT2 * this.pixelWorldSize * 2)) * 2);
      this.projected.set(0, 0, 0).project(this.camera);
      const viewport = this.lightingUniforms.uPixelViewport.value;
      this.lightingUniforms.uPavingGrid.value.set(tileWidth,
        Math.round((this.projected.x + 1) * viewport.x / 2), Math.round((this.projected.y + 1) * viewport.y / 2));
    } else this.lightingUniforms.uPavingGrid.value.set(0, 0, 0);
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
    if (key === this.environmentKey) {
      if (this.staticPixelWorldSize !== this.pixelWorldSize) this.rebuildStaticScene();
      return;
    }
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
    this.staticPixelWorldSize = this.pixelWorldSize;
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
    this.staticDirty = true;
  }

  begin(darkness, solar = null) {
    this.batches.forEach((batch) => { batch.mesh.count = 0; });
    this.busLightCount = 0;
    this.lightingUniforms.uBusFront.value.forEach((front) => { front.w = 0; });
    // Daylight changes slowly. Steps of 0.01 hours (36 seconds) mean the cached city is only
    // redrawn now and then around sunrise and sunset, and never during the day or night.
    const elevation = Math.round((solar?.elevationHours ?? 2 - darkness * 4) * 100) / 100;
    const morning = solar?.isMorning ?? false;
    if (this.lastElevation === elevation && this.lastMorning === morning) return;
    this.lastElevation = elevation;
    this.lastMorning = morning;
    const profile = getLightingProfile(elevation, morning);
    const key = JSON.stringify(profile);
    if (key === this.lightingKey) return;
    this.lightingKey = key;
    this.lightingChanged = true;
    this.lighting = profile;
    this.lightingUniforms.uSceneSaturation.value = profile.saturation;
    this.lightingUniforms.uSceneBrightness.value = profile.brightness;
    this.lightingUniforms.uSceneTint.value.fromArray(profile.tint);
    this.lightingUniforms.uNightLights.value = profile.lights;
    for (const [ambient, sun] of [[this.ambient, this.sun], this.staticLights]) {
      ambient.intensity = profile.ambient;
      ambient.color.setRGB(...profile.skyTint);
      ambient.groundColor.setRGB(...profile.groundTint);
      sun.intensity = profile.sun;
      sun.color.setRGB(...profile.sunTint);
    }
    // Light uniforms as three.js passes them to its Lambert shader.
    const { uHemiSky, uHemiGround, uSunColor } = this.cacheMaterial.uniforms;
    const { color, groundColor, intensity } = this.ambient;
    uHemiSky.value.set(color.r, color.g, color.b).multiplyScalar(intensity);
    uHemiGround.value.set(groundColor.r, groundColor.g, groundColor.b).multiplyScalar(intensity);
    uSunColor.value.set(this.sun.color.r, this.sun.color.g, this.sun.color.b).multiplyScalar(this.sun.intensity);
  }

  // Convert projected layout ground coordinates back into the XZ plane.
  ground(x, y) {
    const u = (x - 495) / PIXELS_PER_UNIT;
    const v = (y - 580) / PIXELS_PER_UNIT;
    this.position.set(u / SQRT2 + v / (2 * GROUND_AXIS_Y), .23, -u / SQRT2 + v / (2 * GROUND_AXIS_Y));
    return this.position;
  }

  queueGeometry(direction, x, y) {
    const sign = direction === 'central' ? 1 : -1;
    const lane = MAIN_ROAD_LANES[direction];
    // The roadside pavement is 1.8 units wide. Keep the whole line on its centre,
    // parallel to the road, with its head beside the bus's front boarding door.
    const sidewalkX = sign === 1 ? lane.min - .9 : lane.max + .9;
    const frontZ = this.ground(x + 175, y + 245).z + sign * 2.2;
    const anchor = {
      x: 495 + (sidewalkX - frontZ) / SQRT2 * PIXELS_PER_UNIT,
      y: 580 + (sidewalkX + frontZ) * GROUND_AXIS_Y * PIXELS_PER_UNIT,
    };
    return { anchor, dir: { x: -sign * 2 / Math.sqrt(5), y: sign / Math.sqrt(5) } };
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
    this.snapPositionToPixels();
    this.quaternion.setFromAxisAngle(this.axis, angle);
    this.scale.setScalar(size);
    this.root.compose(this.position, this.quaternion, this.scale);
    this.submit(model, this.root, alpha);
    return true;
  }

  snapPositionToPixels() {
    if (!this.pixelEffect) return;
    this.projected.copy(this.position).project(this.camera);
    const { width, height } = this.pixelEffect.target;
    const x = (this.projected.x + 1) * width / 2;
    const y = (this.projected.y + 1) * height / 2;
    const step = this.pixelScale / this.pixelsPerWorldUnit;
    // Snap the complete model, preserving its internal diagonals and window spacing.
    this.position.addScaledVector(this.pixelRight, (Math.round(x) - x) * step);
    this.position.addScaledVector(this.pixelUp, (Math.round(y) - y) * step);
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
    // Keys are kept until the outfit changes, rather than building strings for every student each frame.
    if (student.modelOutfit !== outfit) {
      student.modelOutfit = outfit;
      student.modelKeys = [];
    }
    const key = student.modelKeys[phase + 3] ??= `student|${outfit.join(',')}|${phase}|${student.seq % 4}`;
    this.draw(key, x, y, 70,
      student.route === 'routeB' ? Math.PI : 0, alpha, walking ? Math.abs(phase) * .018 : 0);
  }

  drawFloating(key, x, y, height) {
    // Screen coordinates to a point in the camera's plane. Unlike ground props this can cross the sky.
    const model = getModel(key);
    this.position.set(x / this.canvasWidth * 2 - 1, 1 - y / this.canvasHeight * 2, -.65).unproject(this.camera);
    this.snapPositionToPixels();
    const size = height / (this.pixelsPerWorldUnit * COS_ELEVATION * 3.3);
    this.quaternion.identity();
    this.scale.setScalar(size);
    this.root.compose(this.position, this.quaternion, this.scale);
    this.submit(model, this.root);
  }

  cameraMoved() {
    let moved = false;
    [this.camera.projectionMatrix.elements, this.camera.matrixWorld.elements].forEach((elements, m) => {
      for (let n = 0; n < 16; n++) {
        if (this.cameraSnapshot[m * 16 + n] !== elements[n]) {
          this.cameraSnapshot[m * 16 + n] = elements[n];
          moved = true;
        }
      }
    });
    return moved;
  }

  renderStaticCache() {
    // The cache must not contain light from busses: they are drawn per frame.
    const fronts = this.lightingUniforms.uBusFront.value;
    const busAlpha = fronts.map((front) => front.w);
    fronts.forEach((front) => { front.w = 0; });
    const target = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.staticTarget);
    this.renderer.render(this.staticScene, this.camera);
    this.renderer.setRenderTarget(target);
    fronts.forEach((front, n) => { front.w = busAlpha[n]; });
    this.staticDirty = false;
    this.staticRenders++;
  }

  // Returns false when the frame was skipped because nothing changed since the last one.
  render() {
    if (this.contextLost) return false;
    let changed = this.forceRender;
    this.batches.forEach((batch) => { if (batch.commit()) changed = true; });
    for (const batches of [this.staticBatches, this.batches]) {
      const halo = batches.get('light');
      if (halo) halo.mesh.visible = halo.mesh.count > 0 && this.lightingUniforms.uNightLights.value > .001;
    }
    if (this.cameraMoved()) {
      this.cacheMaterial.uniforms.uInverseViewProjection.value
        .multiplyMatrices(this.camera.matrixWorld, this.camera.projectionMatrixInverse);
      this.staticDirty = true;
    }
    if (this.lightingChanged) {
      this.lightingChanged = false;
      this.staticDirty = true;
    }
    if (!changed && !this.staticDirty) {
      this.skippedFrames++;
      return false;
    }
    this.forceRender = false;
    this.renderer.info.reset();
    if (this.staticDirty) this.renderStaticCache();
    if (this.pixelEffect) this.pixelEffect.render(this.renderer, this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
    return true;
  }

  getStats() {
    return { ...this.renderer.info.render, geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures, pixelRatio: this.renderer.getPixelRatio(),
      style: this.style, pixelScale: this.pixelScale, postPasses: this.pixelEffect ? 1 : 0,
      antialias: this.antialias, staticRenders: this.staticRenders, skippedFrames: this.skippedFrames,
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
    this.staticTarget.depthTexture?.dispose();
    this.staticTarget.dispose();
    this.cacheMaterial.dispose();
    this.cacheGeometry.dispose();
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
