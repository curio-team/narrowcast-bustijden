import * as THREE from './vendor/three.module.min.js';
import { scenery, getModel } from './models3d.js';

const PIXELS_PER_UNIT = 55;
const SQRT2 = Math.sqrt(2);
const GROUND_Y = Math.sqrt(2 / 3);
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

function fadingMaterial(unlit = false) {
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
  };
  return material;
}

export class IsometricScene {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-20, 20, 20, -20, .1, 300);
    this.camera.position.set(50, 50, 50);
    this.camera.lookAt(0, 0, 0); // true isometric: 45° azimuth, 35.264° elevation
    this.ambient = new THREE.HemisphereLight('#fff8df', '#80919e', 2.1);
    this.sun = new THREE.DirectionalLight('#fff2d4', 2.4);
    this.sun.position.set(-15, 28, 10);
    this.scene.add(this.ambient, this.sun);
    this.material = fadingMaterial();
    this.glowMaterial = fadingMaterial(true);
    this.geometries = {
      box: new THREE.BoxGeometry(1, 1, 1),
      sphere: new THREE.SphereGeometry(.5, 10, 6),
      cylinder: new THREE.CylinderGeometry(.5, .5, 1, 10),
      cone: new THREE.CylinderGeometry(0, .5, 1, 10),
    };
    this.staticBatches = new Map();
    this.batches = new Map();
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
    this.submit(scenery, this.root.identity(), 1, this.staticBatches);
    this.staticBatches.forEach((batch) => batch.commit());
    this.resize(window.innerWidth, window.innerHeight);
    this.lastDarkness = -1;
  }

  submit(model, root, alpha = 1, batches = this.batches) {
    for (const part of model.parts) {
      let batch = batches.get(part.shape);
      if (!batch) {
        const glow = part.shape.endsWith('-glow');
        const shape = part.shape.replace('-glow', '');
        batch = new Batch(this.scene, this.geometries[shape], glow ? this.glowMaterial : this.material,
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
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(MAX_RENDER_PIXELS / (width * height)));
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    // Keep the original 990-unit layout so queues, routes and seasonal anchors share coordinates.
    this.layoutSize = Math.min(width, height) * .4;
    this.layoutX = (width - this.layoutSize) / 2;
    this.layoutY = (height - this.layoutSize) / 2;
    this.pixelsPerWorldUnit = this.layoutSize / 990 * PIXELS_PER_UNIT;
    const halfW = width / this.pixelsPerWorldUnit / 2;
    const halfH = height / this.pixelsPerWorldUnit / 2;
    const centerX = this.layoutX + 495 * this.layoutSize / 990;
    const centerY = this.layoutY + 580 * this.layoutSize / 990;
    const offsetX = (width / 2 - centerX) / this.pixelsPerWorldUnit;
    const offsetY = (centerY - height / 2) / this.pixelsPerWorldUnit;
    this.camera.left = -halfW + offsetX;
    this.camera.right = halfW + offsetX;
    this.camera.top = halfH + offsetY;
    this.camera.bottom = -halfH + offsetY;
    this.camera.updateProjectionMatrix();
  }

  begin(darkness) {
    this.batches.forEach((batch) => { batch.mesh.count = 0; });
    if (Math.abs(this.lastDarkness - darkness) > .001) {
      this.ambient.intensity = 2.1 - darkness * 1.2;
      this.sun.intensity = 2.4 - darkness * 1.9;
      this.sun.color.set(darkness > .5 ? '#b7c7ff' : '#fff2d4');
      this.lastDarkness = darkness;
    }
  }

  // Convert projected layout ground coordinates back into the XZ plane.
  ground(x, y) {
    const u = (x - 495) / PIXELS_PER_UNIT;
    const v = (y - 580) / PIXELS_PER_UNIT;
    this.position.set(u / SQRT2 + v / GROUND_Y, .23, -u / SQRT2 + v / GROUND_Y);
    return this.position;
  }

  draw(key, x, y, height, angle = 0, alpha = 1, lift = 0) {
    if (alpha <= 0) return;
    const model = getModel(key);
    const size = height / (PIXELS_PER_UNIT * GROUND_Y * model.height);
    this.ground(x, y).y += lift;
    this.projected.copy(this.position).project(this.camera);
    const margin = Math.max(2, size * model.height * 2) * this.pixelsPerWorldUnit;
    const sx = (this.projected.x + 1) * this.width / 2;
    const sy = (1 - this.projected.y) * this.height / 2;
    if (sx < -margin || sx > this.width + margin || sy < -margin || sy > this.height + margin) return;
    this.quaternion.setFromAxisAngle(this.axis, angle);
    this.scale.setScalar(size);
    this.root.compose(this.position, this.quaternion, this.scale);
    this.submit(model, this.root, alpha);
  }

  drawBus(direction, x, y, moving, alpha, now) {
    // Bus path coordinates used to be the top-left of a 350px sprite. Align its axle centre.
    this.draw(moving ? 'bus' : 'bus-open', x + 175, y + 245, 122,
      direction === 'central' ? 0 : Math.PI, alpha, -.23 + (moving ? Math.sin(now / 75) * .015 : 0));
  }

  drawStudent(student, x, y, walking, alpha, outfit, now) {
    const phase = walking ? Math.round(Math.sin(now / student.bounceSpeed + student.bouncePhase) * 3) : 0;
    this.draw(`student|${outfit.join(',')}|${phase}|${student.seq % 4}`, x, y, 70,
      student.flip ? Math.PI : 0, alpha, walking ? Math.abs(phase) * .018 : 0);
  }

  drawFloating(key, x, y, height) {
    // Screen coordinates to a point in the camera's plane. Unlike ground props this can cross the sky.
    const model = getModel(key);
    this.position.set(x / this.width * 2 - 1, 1 - y / this.height * 2, -.65).unproject(this.camera);
    const size = height / (this.pixelsPerWorldUnit * GROUND_Y * 3.3);
    this.quaternion.identity();
    this.scale.setScalar(size);
    this.root.compose(this.position, this.quaternion, this.scale);
    this.submit(model, this.root);
  }

  render() {
    if (this.contextLost) return;
    this.batches.forEach((batch) => batch.commit());
    this.renderer.render(this.scene, this.camera);
  }

  getStats() {
    return { ...this.renderer.info.render, geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures, pixelRatio: this.renderer.getPixelRatio(),
      bufferWidth: this.renderer.domElement.width, bufferHeight: this.renderer.domElement.height };
  }

  dispose() {
    this.staticBatches.forEach((batch) => batch.dispose());
    this.batches.forEach((batch) => batch.dispose());
    Object.values(this.geometries).forEach((geometry) => geometry.dispose());
    this.material.dispose();
    this.glowMaterial.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onRestored);
    this.renderer.dispose();
  }
}
