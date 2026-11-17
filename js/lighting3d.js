import { SITES } from './site3d.js';

const DAY = { saturation: 1, brightness: 1, tint: [1, 1, 1], ambient: 2.1, sun: 2.4,
  sunTint: [1, .89, .66], skyTint: [1, .94, .78], groundTint: [.22, .29, .34] };
const NIGHT = { saturation: .28, brightness: .68, tint: [.58, .72, 1.02], ambient: .7, sun: .12,
  sunTint: [.52, .64, 1], skyTint: [.42, .51, .83], groundTint: [.12, .16, .29] };
const EVENING = { saturation: .48, brightness: .74, tint: [.76, .75, 1.04], ambient: .95, sun: .4,
  sunTint: [.69, .53, .88], skyTint: [.68, .55, .83], groundTint: [.22, .18, .34] };
const DUSK = { saturation: .78, brightness: .91, tint: [1.09, .85, .79], ambient: 1.45, sun: 1.5,
  sunTint: [1, .48, .22], skyTint: [.96, .72, .66], groundTint: [.30, .23, .35] };
const DAWN = { saturation: .74, brightness: .91, tint: [1.03, .86, .99], ambient: 1.4, sun: 1.4,
  sunTint: [1, .65, .51], skyTint: [.88, .74, .88], groundTint: [.23, .22, .37] };

function smooth(a, b, value) {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Elevation is the existing season-aware number of hours above/below the horizon.
// Morning and evening share a smooth night transition but have distinct sunrise/sunset colours.
export function getLightingProfile(elevationHours, isMorning = false) {
  const stops = [
    { e: -1.2, profile: NIGHT },
    { e: -.45, profile: EVENING },
    { e: .2, profile: isMorning ? DAWN : DUSK },
    { e: 1.3, profile: DAY },
  ];
  let lower = stops[0];
  let upper = stops[stops.length - 1];
  if (elevationHours <= lower.e) upper = lower;
  else if (elevationHours >= upper.e) lower = upper;
  else {
    for (let n = 0; n < stops.length - 1; n++) {
      if (elevationHours >= stops[n].e && elevationHours < stops[n + 1].e) {
        lower = stops[n]; upper = stops[n + 1]; break;
      }
    }
  }
  const t = lower === upper ? 0 : smooth(lower.e, upper.e, elevationHours);
  const profile = {};
  for (const key of Object.keys(DAY)) {
    const a = lower.profile[key];
    const b = upper.profile[key];
    profile[key] = Array.isArray(a) ? a.map((value, n) => value + (b[n] - value) * t) : a + (b - a) * t;
  }
  profile.lights = 1 - smooth(-.65, .75, elevationHours);
  profile.phase = elevationHours >= .9 ? 'day' : elevationHours < -.85 ? 'night'
    : isMorning ? 'dawn' : elevationHours < -.15 ? 'evening' : 'dusk';
  return profile;
}

const LIGHT_UNIFORMS = `
uniform float uSceneSaturation;
uniform float uSceneBrightness;
uniform vec3 uSceneTint;
uniform float uNightLights;
uniform vec4 uBusFront[2];
uniform vec2 uBusDirection[2];
`;

// Each fragment considers the two main-road columns and the closest city-street column.
// This matches the regular lamp positions in models3d.js, so cost is independent of city size.
const STREET_LIGHTS = `
float streetIllumination(vec3 world, vec3 surfaceNormal, float column) {
  if (abs(world.x - column) > 8.4 || world.y > 4.67) return 0.0;
  float row = floor(world.z / 12.0 + 0.5) * 12.0;
  vec3 delta = vec3(column, 4.68, row) - world;
  float falloff = max(0.0, 1.0 - dot(delta, delta) / 70.56);
  return falloff * falloff * max(0.0, dot(surfaceNormal, normalize(delta))) * 1.3;
}
vec3 streetLightIllumination(vec3 world, vec3 surfaceNormal) {
  float outerColumn = 30.0 + 36.0 * floor(max(abs(world.x) - 30.0, 0.0) / 36.0 + 0.5);
  outerColumn *= world.x < 0.0 ? -1.0 : 1.0;
  // The hand-made site (site3d.js) has no lamps on the generated street grid
  bool inSite = ${SITES.map((site) => `(world.x > ${site.minX.toFixed(1)} && world.x < ${site.maxX.toFixed(1)}
    && world.z > ${site.minZ.toFixed(1)} && world.z < ${site.maxZ.toFixed(1)})`).join(' || ')};
  float street = streetIllumination(world, surfaceNormal, -1.5)
    + streetIllumination(world, surfaceNormal, 5.0)
    + (inSite ? 0.0 : streetIllumination(world, surfaceNormal, outerColumn));
  return vec3(1.0, 0.62, 0.28) * street;
}
`;

// Head- and taillights of at most two busses.
const BUS_LIGHTS = `
vec3 busIllumination(vec3 world, vec3 surfaceNormal) {
  vec3 illumination = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    if (uBusFront[i].w <= 0.0) continue;
    vec3 delta = world - uBusFront[i].xyz;
    vec2 direction = uBusDirection[i];
    float forward = dot(delta.xz, direction);
    if (forward > 0.0 && forward < 9.0 && world.y < 2.0) {
      float across = abs(dot(delta.xz, vec2(direction.y, -direction.x)));
      float width = 0.85 + forward * 0.26;
      float cone = 1.0 - smoothstep(width * 0.5, width, across);
      float height = 1.0 - smoothstep(0.9, 1.8, abs(world.y - 0.35));
      float falloff = 1.0 - forward / 9.0;
      float facing = 0.35 + 0.65 * max(0.0, dot(surfaceNormal, normalize(-delta)));
      float beam = cone * height * falloff * falloff * facing * smoothstep(0.0, 0.15, forward);
      illumination += vec3(1.0, 0.86, 0.62) * beam * uBusFront[i].w * 2.8;
    }
    vec3 rear = uBusFront[i].xyz - vec3(direction.x, 0.0, direction.y) * 5.72;
    vec3 rearDelta = world - rear;
    if (dot(rearDelta.xz, direction) < 0.0 && world.y < 1.5) {
      float spill = max(0.0, 1.0 - dot(rearDelta, rearDelta) / 5.76);
      illumination += vec3(1.0, 0.025, 0.012) * spill * spill * uBusFront[i].w * 0.8;
    }
  }
  return illumination;
}
`;

const SURFACE_LIGHTS = `
varying vec3 vSceneWorldPosition;
${STREET_LIGHTS}
${BUS_LIGHTS}
vec3 localIllumination(vec3 world, vec3 surfaceNormal) {
  return streetLightIllumination(world, surfaceNormal) + busIllumination(world, surfaceNormal);
}
`;

// For the pass that copies the cached static city: busses move, so their light is added per frame.
export const CACHED_LIGHTS_GLSL = LIGHT_UNIFORMS + STREET_LIGHTS + BUS_LIGHTS;

export function applyLightingShader(shader, uniforms, unlit) {
  Object.assign(shader.uniforms, uniforms);
  if (unlit) {
    shader.fragmentShader = LIGHT_UNIFORMS + shader.fragmentShader;
    // Emissive lenses retain their warm/red colour instead of receiving the scene's night grade.
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      outgoingLight *= mix(0.45, 2.8, uNightLights);
      #include <opaque_fragment>
    `);
    return;
  }
  shader.vertexShader = 'varying vec3 vSceneWorldPosition;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
    #include <begin_vertex>
    vSceneWorldPosition = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  `);
  shader.fragmentShader = LIGHT_UNIFORMS + SURFACE_LIGHTS + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
    float luminance = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
    outgoingLight = mix(vec3(luminance), outgoingLight, uSceneSaturation) * uSceneTint * uSceneBrightness;
    if (uNightLights > 0.001) {
      vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
      outgoingLight += diffuseColor.rgb * localIllumination(vSceneWorldPosition, worldNormal) * uNightLights;
    }
    #include <opaque_fragment>
  `);
}
