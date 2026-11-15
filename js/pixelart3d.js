import * as THREE from './vendor/three.module.min.js';

export const SCENE_STYLES = Object.freeze({
  original: { label: 'Origineel', pixelSize: 1 },
  clean: { label: 'Heldere pixels', pixelSize: 2 },
  dither: { label: 'Warm raster', pixelSize: 3 },
  ink: { label: 'Pixelinkt', pixelSize: 3 },
});

const FRAGMENT_SHADER = `
  uniform sampler2D tScene;
  uniform vec2 uTexel;
  varying vec2 vUv;

  vec3 displayColor(vec4 sampleColor) {
    // The transparent canvas is composited over the page's day/night background.
    return linearToOutputTexel(vec4(sampleColor.rgb / max(sampleColor.a, 0.0001), 1.0)).rgb;
  }

  void main() {
    vec4 source = texture2D(tScene, vUv);
    if (source.a == 0.0) { gl_FragColor = vec4(0.0); return; }
    vec3 color = displayColor(source);

    #if STYLE == 1
      color = floor(color * 23.0 + 0.5) / 23.0;
    #elif STYLE == 2
      // Ordered coverage is anchored to the render grid, with no temporal noise.
      vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
      vec2 lo = mod(cell, 2.0);
      vec2 hi = floor(cell / 2.0);
      float bayer = (4.0 * (2.0 * lo.x + 3.0 * lo.y - 4.0 * lo.x * lo.y)
        + 2.0 * hi.x + 3.0 * hi.y - 4.0 * hi.x * hi.y + 0.5) / 16.0;
      float light = luminance(color);
      color = mix(vec3(light), color, 0.82) * vec3(1.045, 1.0, 0.94);
      color = floor(clamp(color, 0.0, 1.0) * 11.0 + bayer) / 11.0;
    #elif STYLE == 3
      float light = luminance(color);
      float band = floor(light * 7.0 + 0.5) / 7.0;
      color *= mix(1.0, band / max(light, 0.035), 0.72);
      color = floor(clamp(color, 0.0, 1.0) * 15.0 + 0.5) / 15.0;

      // Four colour neighbours give one-pixel internal contours without depth/normal passes.
      float neighbour = light;
      neighbour = max(neighbour, luminance(displayColor(texture2D(tScene, vUv + vec2(uTexel.x, 0.0)))));
      neighbour = max(neighbour, luminance(displayColor(texture2D(tScene, vUv - vec2(uTexel.x, 0.0)))));
      neighbour = max(neighbour, luminance(displayColor(texture2D(tScene, vUv + vec2(0.0, uTexel.y)))));
      neighbour = max(neighbour, luminance(displayColor(texture2D(tScene, vUv - vec2(0.0, uTexel.y)))));
      float edge = smoothstep(0.07, 0.22, neighbour - light);
      color = mix(color, color * vec3(0.38, 0.32, 0.48), edge * 0.8);
    #endif

    gl_FragColor = vec4(clamp(color, 0.0, 1.0) * source.a, source.a);
  }
`;

export class PixelArtEffect {
  constructor(style) {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      generateMipmaps: false, depthBuffer: true, stencilBuffer: false,
    });
    this.material = new THREE.ShaderMaterial({
      defines: { STYLE: { clean: 1, dither: 2, ink: 3 }[style] },
      uniforms: { tScene: { value: this.target.texture }, uTexel: { value: new THREE.Vector2(1, 1) } },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: FRAGMENT_SHADER,
    });
    // One oversized triangle avoids a diagonal seam and adds only one draw call.
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.scene = new THREE.Scene();
    const triangle = new THREE.Mesh(this.geometry, this.material);
    triangle.frustumCulled = false;
    this.scene.add(triangle);
    this.camera = new THREE.Camera();
  }

  resize(width, height) {
    this.target.setSize(width, height);
    this.material.uniforms.uTexel.value.set(1 / width, 1 / height);
  }

  render(renderer, scene, camera) {
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.target.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
