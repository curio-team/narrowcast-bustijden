import * as THREE from './vendor/three.module.min.js';
import { IsometricScene, SCENE_STYLES } from './scene3d.js';
import { getModel, getModelPreviews } from './models3d.js';

class ModelPreview extends IsometricScene {
  resizeEnvironment() {}

  setModel(model) {
    this.model = model;
    const bounds = new THREE.Box3();
    for (const part of model.parts) {
      const geometry = this.geometries[part.shape.replace('-glow', '')];
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      bounds.union(geometry.boundingBox.clone().applyMatrix4(part.matrix));
    }
    this.center = bounds.getCenter(new THREE.Vector3());
    this.radius = Math.max(.1, bounds.getSize(new THREE.Vector3()).length() / 2);
    this.centering = new THREE.Matrix4().makeTranslation(-this.center.x, -this.center.y, -this.center.z);
  }

  frame(zoom) {
    const aspect = this.canvasWidth / this.canvasHeight;
    const halfHeight = this.radius * 1.2 / Math.min(1, aspect) / zoom;
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
    this.pixelsPerWorldUnit = this.canvasHeight / (2 * halfHeight);
    this.pixelWorldSize = this.pixelEffect ? this.pixelScale / this.pixelsPerWorldUnit : 0;
    if (this.pixelEffect) {
      const tileWidth = Math.max(2, Math.round((11.4 / 14) / (Math.SQRT2 * this.pixelWorldSize * 2)) * 2);
      const viewport = this.lightingUniforms.uPixelViewport.value;
      this.lightingUniforms.uPavingGrid.value.set(tileWidth, Math.round(viewport.x / 2), Math.round(viewport.y / 2));
    }
  }

  preview(angle, zoom, lighting) {
    this.begin(lighting === 'night' ? 1 : 0, {
      elevationHours: lighting === 'day' ? 2 : lighting === 'night' ? -2 : .2,
      isMorning: lighting === 'dawn',
    });
    this.frame(zoom);
    this.root.makeRotationY(angle).multiply(this.centering);
    this.submit(this.model, this.root);
    this.render();
  }
}

const controls = Object.fromEntries(['model', 'style', 'lighting', 'angle', 'zoom', 'spin', 'variant', 'pose', 'outfit']
  .map((id) => [id, document.getElementById(id)]));
const previews = getModelPreviews();
const groups = new Map();
for (const item of previews) {
  if (!groups.has(item.group)) {
    const group = document.createElement('optgroup');
    group.label = item.group;
    controls.model.append(group);
    groups.set(item.group, group);
  }
  groups.get(item.group).append(new Option(item.key, item.key));
}
for (const [key, style] of Object.entries(SCENE_STYLES)) controls.style.add(new Option(style.label, key));

const params = new URLSearchParams(location.hash.slice(1));
for (const [id, control] of Object.entries(controls)) {
  if (!params.has(id)) continue;
  if (control.multiple) {
    const values = params.get(id).split(',');
    for (const option of control.options) option.selected = values.includes(option.value);
  } else if (control.type === 'checkbox') control.checked = params.get(id) === '1';
  else {
    const original = control.value;
    control.value = params.get(id);
    if (control.value === '') control.value = original;
  }
}

function save() {
  const params = new URLSearchParams();
  for (const [id, control] of Object.entries(controls)) {
    params.set(id, control.multiple ? [...control.selectedOptions].map((option) => option.value).join(',')
      : control.type === 'checkbox' ? Number(control.checked) : control.value);
  }
  history.replaceState(null, '', '#' + params);
}

const viewport = document.getElementById('viewport');
const canvas = viewport.querySelector('canvas');
const preview = new ModelPreview(canvas, controls.style.value);
let dirty = true;
let angle = Number(controls.angle.value);
function selectModel() {
  const student = controls.model.value === 'student';
  document.getElementById('student-controls').hidden = !student;
  const outfit = [...controls.outfit.selectedOptions].map((option) => option.value).join(',');
  const model = student ? getModel(`student|${outfit}|${controls.pose.value}|${controls.variant.value}`)
    : previews.find((item) => item.key === controls.model.value).create();
  preview.setModel(model);
  document.getElementById('details').textContent = `${model.parts.length} parts`;
  dirty = true;
}
selectModel();

for (const [id, control] of Object.entries(controls)) {
  control.addEventListener('input', () => {
    if (['model', 'outfit', 'pose', 'variant'].includes(id)) selectModel();
    if (id === 'style') preview.setStyle(control.value);
    if (id === 'angle') angle = Number(control.value);
    dirty = true;
    save();
  });
}
document.getElementById('reset').addEventListener('click', () => {
  controls.angle.value = 0;
  angle = 0;
  controls.zoom.value = 1;
  controls.spin.checked = false;
  dirty = true;
  save();
});

let drag;
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  drag = event.clientX;
  controls.spin.checked = false;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (drag === undefined) return;
  angle = ((angle + (event.clientX - drag) * .6 + 540) % 360) - 180;
  controls.angle.value = angle;
  drag = event.clientX;
  dirty = true;
});
canvas.addEventListener('lostpointercapture', () => { drag = undefined; save(); });
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  controls.zoom.value = Math.min(5, Math.max(.5, Number(controls.zoom.value) * Math.exp(-event.deltaY * .001)));
  dirty = true;
  save();
}, { passive: false });

const observer = new ResizeObserver(() => {
  preview.resize(Math.max(1, viewport.clientWidth), Math.max(1, viewport.clientHeight));
  dirty = true;
});
observer.observe(viewport);
canvas.addEventListener('webglcontextrestored', () => { dirty = true; });
let lastTime;
let animation;
function render(time) {
  if (controls.spin.checked) {
    angle = ((angle + Math.min(100, time - (lastTime ?? time)) * .025 + 540) % 360) - 180;
    controls.angle.value = angle;
    dirty = true;
    if (Math.floor(time / 250) !== Math.floor((lastTime ?? time) / 250)) save();
  }
  lastTime = time;
  if (dirty && !preview.contextLost) {
    preview.preview(angle * Math.PI / 180, Number(controls.zoom.value), controls.lighting.value);
    dirty = false;
  }
  animation = requestAnimationFrame(render);
}
animation = requestAnimationFrame(render);
addEventListener('pagehide', () => {
  cancelAnimationFrame(animation);
  observer.disconnect();
  preview.dispose();
});
