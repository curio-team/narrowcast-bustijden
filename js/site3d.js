import * as THREE from './vendor/three.module.min.js';

/*
** The real surroundings of the Oude Baan stop on Terheijdenseweg: the Intratuin right behind the stop,
** the crossing with Oude Baan, and the road that curves past Curio and the sports field.
**
** The camera looks east across Terheijdenseweg, so in world coordinates:
**   -x = east (behind the stop: Intratuin, Curio)       +x = west (the far lane, Oude Baan)
**   +z = north (bottom-left of the screen)              -z = south (top-right)
** Distances are compressed so everything fits next to the departure boards; 1 unit is roughly 2-3 m.
**
** SITE is aligned with the procedural street grid in models3d.js: generated blocks, side streets and lamps
** inside it are left out, and buildSite() draws this hand-made area instead.
*/
export const CROSSING_Z = 10; // Oude Baan crosses Terheijdenseweg right after the stop
// From the street two blocks south of the crossing up to two blocks north of it. The generated side street
// in between (at CROSSING_Z + 36) is left out: there the bike path ends and only a small path continues.
export const SITE = { minX: -65.6, maxX: -2, minZ: CROSSING_Z - 69.9, maxZ: CROSSING_Z + 69.9 };
const BIKE_PATH_END = CROSSING_Z + 36;
// Across the road: the Oude Baan parallel road and VDL Steelweld, on both sides of the crossing
export const WEST_SITE = { minX: 5.5, maxX: 65.6, minZ: SITE.minZ, maxZ: SITE.maxZ };
export const SITES = [SITE, WEST_SITE];

export function inSite(x, z) {
  return SITES.some((site) => x > site.minX && x < site.maxX && z > site.minZ && z < site.maxZ);
}

// Surface layers on top of the .225 high pavement
const GROUND_Y = .235; // grass, yards, roads and the bike path (top at .245)
const LINE_Y = .249; // paint and markings on top of those

const GRASS = '#8aac66';
const VERGE = '#82a35f';
const ASPHALT = '#637f87';
const BIKE_PATH = '#a9554b';
const BRICK_ROAD = '#9c8b80';
const YARD = '#80878a';
const HEDGE = '#557d48';
const FENCE = '#5f696d';

// The side road from the crossing: east along the grass field, then a rounded turn north around it
// (Luikstraat), with Curio behind the field
const ROAD = { halfWidth: 2.1, turnX: -32, radius: 8 };
ROAD.northX = ROAD.turnX - ROAD.radius; // centre line of the drive after the turn
const ROAD_Y = .239; // just above grass and yards

// A 5x7 pixel font for the signs, only the letters we need
const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  // Lowercase, for the curio logo
  c: ['00000', '00000', '01110', '10000', '10000', '10001', '01110'],
  i: ['00100', '00000', '01100', '00100', '00100', '00100', '01110'],
  o: ['00000', '00000', '01110', '10001', '10001', '10001', '01110'],
  r: ['00000', '00000', '10110', '11001', '10000', '10000', '10000'],
  u: ['00000', '00000', '10001', '10001', '10001', '10011', '01101'],
};

export function textWidth(text, cell) {
  return (text.length * 6 - 1) * cell;
}

// Block letters on a sign. (x, y, z) is the top centre of the text. face 'x': on a sign facing +x, reading
// towards -z; face 'z': on a sign facing +z, reading towards +x. Runs of pixels share one box.
export function pixelText(add, text, { x, y, z, cell, color, face }) {
  const width = text.length * 6 - 1;
  [...text].forEach((char, index) => {
    GLYPHS[char]?.forEach((row, r) => {
      for (let c = 0; c < row.length;) {
        if (row[c] !== '1') { c++; continue; }
        let end = c;
        while (end < row.length && row[end] === '1') end++;
        const along = (index * 6 + (c + end) / 2 - width / 2) * cell;
        const length = (end - c) * cell;
        const cy = y - (r + .5) * cell;
        if (face === 'x') add('box', color, x, cy, z - along, .04, cell, length);
        else add('box', color, x + along, cy, z, length, cell, .04);
        c = end;
      }
    });
  });
}

function ground(add, color, minX, maxX, minZ, maxZ, y = GROUND_Y) {
  add('box', color, (minX + maxX) / 2, y, (minZ + maxZ) / 2, maxX - minX, .02, maxZ - minZ);
}

// A model part rotated around the y axis at (x, z): dx/dz are offsets in the part's own frame.
function rotated(add, angle, x, z) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return (shape, color, dx, y, dz, w, h, d, rx = 0, rz = 0) =>
    add(shape, color, x + dx * c + dz * s, y, z - dx * s + dz * c, w, h, d, rx, angle, rz);
}

const gableScale = new THREE.Matrix4();
const gableMove = new THREE.Matrix4();

// The triangular end of a pitched roof: a box turned 45 degrees around the ridge (half of it inside the
// wall below), then flattened to the roof's rise. The ridge runs along x (axis 'x') or along z.
function gable(add, color, x, y, z, length, span, rise, axis = 'x') {
  const size = span / Math.SQRT2;
  const part = axis === 'x'
    ? add('box', color, x, y, z, length, size, size, Math.PI / 4)
    : add('box', color, x, y, z, size, size, length, 0, 0, Math.PI / 4);
  gableScale.makeScale(1, rise / (span / 2), 1);
  gableMove.makeTranslation(0, y, 0).multiply(gableScale).multiply(new THREE.Matrix4().makeTranslation(0, -y, 0));
  part.matrix.premultiply(gableMove);
  return part;
}

// Two roof panels on top of a wall; the ridge runs along x (sloping towards ±z) or along z.
function pitchedRoof(add, color, x, eave, z, length, span, rise, axis = 'x', overhang = .25) {
  const slope = Math.atan2(rise, span / 2);
  const panel = Math.hypot(span / 2, rise) + overhang;
  for (const side of [-1, 1]) {
    if (axis === 'x') {
      add('box', color, x, eave + rise / 2, z + side * span / 4, length + overhang, .12, panel, side * slope);
    } else {
      add('box', color, x + side * span / 4, eave + rise / 2, z, panel, .12, length + overhang, 0, 0, -side * slope);
    }
  }
}

export function parkedCar(add, x, z, angle, color) {
  const part = rotated(add, angle, x, z);
  part('box', color, 0, .78, 0, 3.9, .72, 1.7);
  part('box', color, -.25, 1.38, 0, 2.2, .55, 1.56);
  part('box', '#3f4c57', -.25, 1.38, 0, 2.26, .42, 1.6);
  part('box', '#d9dde0', 1.94, .82, 0, .04, .16, 1.4);
  for (const dx of [-1.3, 1.3]) {
    for (const dz of [-.78, .78]) part('sphere', '#2b2f33', dx, .56, dz, .66, .66, .2);
  }
}

// The round "mushroom" lamps along the brick road
function mushroomLamp(add, x, z) {
  add('cylinder', '#b9bfbd', x, 1.95, z, .09, 3.4, .09);
  add('sphere', '#eeeadf', x, 3.72, z, .95, .32, .95);
  add('cylinder', '#ffe3a2', x, 3.6, z, .62, .03, .62, 0, 0, 0, true);
  add('light', '#ffd396', x, 3.55, z + .1, .8, .8, 1);
}

// Black and white striped pole with a light on top, facing traffic in both directions along z
function trafficLight(add, x, z, arm = 0) {
  for (let n = 0; n < 9; n++) add('cylinder', n % 2 ? '#f2f2ee' : '#232527', x, .4 + n * .34, z, .14, .34, .14);
  const headX = x + arm;
  if (arm) add('box', '#3a3d40', x + arm / 2, 4.75, z, Math.abs(arm), .14, .14);
  const headY = arm ? 4.2 : 3.75;
  add('box', '#1d1f21', headX, headY, z, .38, 1.1, .34);
  ['#e0402f', '#e9a531', '#3fae5c'].forEach((color, n) => {
    for (const side of [-1, 1]) add('sphere', color, headX, headY + .33 - n * .33, z + side * .18, .22, .22, .06, 0, 0, 0, n === 0);
  });
}

function basketballHoop(add, x, z) {
  // Facing west, towards the road
  add('cylinder', '#2f5aa0', x, 1.75, z, .12, 3.1, .12);
  add('box', '#2f5aa0', x + .35, 3.05, z, .7, .08, .08);
  add('box', '#f2f2ee', x + .72, 3.2, z, .06, 1.0, 1.45);
  add('box', '#d0472f', x + .75, 3.05, z, .02, .35, .45);
  add('cylinder', '#e0662c', x + 1.0, 2.82, z, .5, .04, .5);
}

function footballGoal(add, x, z) {
  // A small blue goal, open towards the west
  for (const dz of [-1.1, 1.1]) {
    add('box', '#3557b7', x, .95, z + dz, .09, 1.4, .09);
    add('box', '#3557b7', x - .55, .3, z + dz, 1.1, .07, .07);
  }
  add('box', '#3557b7', x, 1.65, z, .09, .09, 2.3);
  add('box', '#e9ece8', x - .55, .95, z, .02, 1.3, 2.1);
}

function fenceLine(add, axis, fixed, from, to, gaps = []) {
  const along = (value) => axis === 'x' ? [value, fixed] : [fixed, value];
  const inGap = (value) => gaps.some(([a, b]) => value > a && value < b);
  // Rails as segments between gaps, posts every .5 units
  let start = from;
  for (const edge of [...gaps.flat(), to].sort((a, b) => a - b)) {
    if (edge <= start) continue;
    const end = Math.min(edge, to);
    if (!inGap((start + end) / 2)) {
      const [x, z] = along((start + end) / 2);
      const w = axis === 'x' ? end - start : .05;
      const d = axis === 'x' ? .05 : end - start;
      add('box', FENCE, x, 1.95, z, w, .06, d);
      add('box', FENCE, x, .45, z, w, .06, d);
    }
    start = end;
  }
  for (let n = 0; n <= Math.floor((to - from) / .5); n++) {
    const value = from + n * .5;
    if (inGap(value)) continue;
    const [x, z] = along(value);
    add('box', FENCE, x, 1.12, z, .045, 1.75, .045);
  }
}

function hedge(add, minX, maxX, minZ, maxZ, height = 1.05) {
  add('box', HEDGE, (minX + maxX) / 2, .245 + height / 2, (minZ + maxZ) / 2, maxX - minX, height, maxZ - minZ);
  add('box', '#64904f', (minX + maxX) / 2, .245 + height + .06, (minZ + maxZ) / 2, maxX - minX - .1, .12, maxZ - minZ - .1);
}

function flagpole(add, x, z, colors) {
  add('cylinder', '#d9dcdc', x, 3.4, z, .07, 6.3, .07);
  colors.forEach((color, n) => add('box', color, x, 6.0 - n * .32, z + .75, .03, .32, 1.4));
}

function boundsOf(lot) {
  const { minX, maxX, minZ, maxZ } = lot.bounds;
  return { minX, maxX, minZ, maxZ, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, width: maxX - minX, depth: maxZ - minZ };
}

/*
** Curio buildings. Only the west (+x) and north (+z) facades face the camera.
*/

// The beige tower with continuous window bands and orange sunshades above every floor
function curioTower(add, lot) {
  const { minX, maxX, minZ, x, z, width, depth } = boundsOf(lot);
  const maxZ = lot.bounds.maxZ;
  const base = .245;
  const groundFloor = 2.4;
  const floors = 4;
  const floorHeight = 1.95;
  const height = groundFloor + floors * floorHeight + .5;
  add('box', '#cdc4b1', x, base + height / 2, z, width, height, depth);
  add('box', '#b9ae98', x, base + height + .1, z, width + .2, .2, depth + .2);
  add('box', '#a5a9a6', x - width * .15, base + height + .55, z - depth * .2, width * .3, .7, depth * .25);
  // Ground floor: darker plinth with glass
  add('box', '#8d8a80', x, base + groundFloor / 2, z, width + .06, groundFloor, depth + .06);
  add('box', '#5f7480', maxX + .05, base + 1.15, z, .04, 1.4, depth - 1.2);
  add('box', '#5f7480', x, base + 1.15, maxZ + .05, width - 1.2, 1.4, .04);

  for (let floor = 0; floor < floors; floor++) {
    const y = base + groundFloor + floor * floorHeight + 1.0;
    // West facade (towards the road)
    add('box', '#f1eee6', maxX + .04, y, z, .05, 1.12, depth - .6);
    add('box', '#647d8a', maxX + .07, y - .02, z, .03, .9, depth - .8);
    for (let n = 0; n <= Math.floor((depth - .8) / 1.3); n++) {
      add('box', '#f1eee6', maxX + .09, y, minZ + .4 + n * 1.3, .03, .9, .08);
    }
    add('box', '#e2672a', maxX + .38, y + .66, z, .72, .07, depth - .5, 0, 0, -.42);
    // North facade
    add('box', '#f1eee6', x, y, maxZ + .04, width - .6, 1.12, .05);
    add('box', '#647d8a', x, y - .02, maxZ + .07, width - .8, .9, .03);
    for (let n = 0; n <= Math.floor((width - .8) / 1.3); n++) {
      add('box', '#f1eee6', minX + .4 + n * 1.3, y, maxZ + .09, .08, .9, .03);
    }
    add('box', '#e2672a', x, y + .66, maxZ + .38, width - .5, .07, .72, .42);
  }
  lot.roof = { base: base + height + .2, rise: 0 };
}

// The low brown brick hall with the meander pattern and the red tube entrance
function curioHall(add, lot) {
  const { minX, maxX, minZ, maxZ, x, z, width, depth } = boundsOf(lot);
  const base = .245;
  const height = 6.2;
  add('box', '#7a6150', x, base + height / 2, z, width, height, depth);
  add('box', '#8b3a2f', x, base + height + .2, z, width + .25, .5, depth + .25);
  add('box', '#6f7276', x, base + height + .46, z, width - .3, .06, depth - .3);
  add('box', '#a0a5a6', x - width * .2, base + height + .75, z - depth * .15, width * .3, .6, depth * .3);
  // A row of windows just under the roof edge
  for (let n = 0; n < Math.floor(depth / 1.6); n++) {
    add('box', '#556872', maxX + .03, base + height - .75, minZ + .8 + n * 1.6, .04, .7, 1.1);
  }
  for (let n = 0; n < Math.floor(width / 1.6); n++) {
    add('box', '#556872', minX + .8 + n * 1.6, base + height - .75, maxZ + .03, 1.1, .7, .04);
  }
  // Meander pattern in darker brick on both visible facades
  const dark = '#5a4537';
  const pattern = (along, face, length, horizontal) => {
    for (let n = 0; n < Math.floor(length / 2.6); n++) {
      const a = along + n * 2.6;
      const top = base + 4.4 - (n % 2) * .8;
      const segments = [
        [a + .3, base + 1.0, .1, top - base - 1.0],
        [a + .3, top, 1.7, .1],
        [a + 2.0, base + 2.0, .1, top - base - 2.0],
        [a + 1.1, base + 2.0, .9, .1],
        [a + 1.1, base + 2.0, .1, 1.2],
      ];
      for (const [start, y, size, tall] of segments) {
        const center = start + size / 2;
        if (horizontal) add('box', dark, center, y + tall / 2, face, size, tall, .04);
        else add('box', dark, face, y + tall / 2, center, .04, tall, size);
      }
    }
  };
  pattern(minZ + .2, maxX + .03, depth - 3.5, false);
  pattern(minX + .2, maxZ + .03, width - .4, true);
  // Entrance tube sticking out towards the road, with a round window and coloured rings
  const tubeZ = maxZ - 2.2;
  const tubeY = base + 2.6;
  add('cylinder', '#cf3128', maxX + 1.6, tubeY, tubeZ, 2.1, 3.2, 2.1, 0, 0, Math.PI / 2);
  ['#2c79c4', '#f2c230', '#3aa66b'].forEach((color, n) => {
    add('cylinder', color, maxX + .55 + n * .7, tubeY, tubeZ, 2.16, .22, 2.16, 0, 0, Math.PI / 2);
  });
  add('cylinder', '#f3efe6', maxX + 3.22, tubeY, tubeZ, 1.6, .05, 1.6, 0, 0, Math.PI / 2);
  add('cylinder', '#4d6c86', maxX + 3.25, tubeY, tubeZ, 1.2, .05, 1.2, 0, 0, Math.PI / 2);
  add('box', '#4b5559', maxX + 1.6, base + .8, tubeZ, 3.2, 1.1, 1.2);
  lot.roof = { base: base + height + .45, rise: 0 };
}

// The golden corrugated metal hall at the back, with a band of windows at the bottom
function curioMetalHall(add, lot) {
  const { minX, maxX, minZ, maxZ, x, z, width, depth } = boundsOf(lot);
  const base = .245;
  const height = 5;
  add('box', '#b6a576', x, base + height / 2, z, width, height, depth);
  add('box', '#9b8c63', x, base + height + .08, z, width + .1, .16, depth + .1);
  add('box', '#e9e7df', x, base + .85, maxZ + .03, width - .6, .9, .04);
  add('box', '#5f7480', x, base + .85, maxZ + .05, width - 1, .62, .03);
  add('box', '#e9e7df', maxX + .03, base + .85, z, .04, .9, depth - .6);
  add('box', '#5f7480', maxX + .05, base + .85, z, .03, .62, depth - 1);
  for (let n = 1; n < width / .9; n++) add('box', '#a39367', minX + n * .9, base + 3.1, maxZ + .04, .1, 3.6, .05);
  for (let n = 1; n < depth / .9; n++) add('box', '#a39367', maxX + .04, base + 3.1, minZ + n * .9, .05, 3.6, .1);
  lot.roof = { base: base + height + .16, rise: 0 };
}

// The curio logo: white lowercase letters on an orange-red panel, on a facade facing +x (the road)
function curioLogo(add, x, y, z, cell) {
  const width = textWidth('curio', cell) + cell * 4;
  const height = 7 * cell + cell * 3;
  add('box', '#e8562a', x + .06, y, z, .1, height, width);
  pixelText(add, 'curio', { x: x + .13, y: y + 3.5 * cell, z, cell, color: '#ffffff', face: 'x' });
}

function curioSign(add, x, z) {
  add('box', '#57b98d', x, 1.35, z, .25, 2.2, .9);
  add('box', '#2c66ad', x, 2.75, z, .27, .6, .9);
  add('box', '#f4f6f4', x + .14, 2.75, z, .02, .16, .55);
}

/*
** Intratuin: garden centre behind the stop. Seen from the road: a white hall, glass greenhouses with
** hedges in front, and a red brick office with the logo, behind a hedge and a car park.
*/

// White hall with its gable end towards the road
function intratuinHall(add, lot) {
  const { minX, maxX, x, z, width, depth } = boundsOf(lot);
  const base = .245;
  const wall = 3.6;
  const rise = 1.5;
  add('box', '#ecebe6', x, base + wall / 2, z, width, wall, depth);
  gable(add, '#ecebe6', x, base + wall, z, width, depth, rise, 'x');
  pitchedRoof(add, '#c9ccca', x, base + wall, z, width, depth, rise, 'x');
  // A wide door and a few windows in the gable end
  add('box', '#7f8b90', maxX + .03, base + 1.2, z, .04, 2.2, 2.6);
  add('box', '#e2e3df', maxX + .05, base + 2.4, z, .04, .12, 2.8);
  for (const dz of [-3, 3]) add('box', '#64798a', maxX + .03, base + 2.2, z + dz, .04, .9, 1.4);
  add('box', '#d9d9d3', minX + width * .3, base + wall + rise + .25, z, 1, .5, 1);
  lot.roof = { base: base + wall + .05, rise };
}

// Glass greenhouses: a row of narrow glass roofs, ridges running towards the road
function greenhouses(add, lot) {
  const { minX, maxX, minZ, x, width, depth } = boundsOf(lot);
  const base = .245;
  const wall = 2.6;
  const bays = Math.max(2, Math.round(depth / 3.2));
  const bay = depth / bays;
  const rise = 1.1;
  add('box', '#bfd3d1', x, base + wall / 2, lot.bounds.minZ + depth / 2, width, wall, depth);
  // White frames on the road facade
  for (let n = 0; n <= Math.round(depth / 1.1); n++) {
    add('box', '#f3f3ef', maxX + .03, base + wall / 2, minZ + n * depth / Math.round(depth / 1.1), .05, wall, .07);
  }
  add('box', '#f3f3ef', maxX + .03, base + wall - .05, minZ + depth / 2, .06, .1, depth);
  for (let n = 0; n < bays; n++) {
    const z = minZ + (n + .5) * bay;
    gable(add, '#c9dcda', x, base + wall, z, width, bay, rise, 'x');
    pitchedRoof(add, '#d8e7e5', x, base + wall, z, width, bay, rise, 'x', .05);
    add('box', '#f3f3ef', x, base + wall + rise, z, width + .05, .07, .07);
    add('box', '#f3f3ef', maxX + .05, base + wall + rise / 2, z, .05, rise, .06);
  }
  // Plants inside, and the hedges in front
  for (let n = 0; n < bays * 2; n++) {
    add('sphere', n % 3 ? '#6e9c55' : '#c56b8b', maxX - .9, base + .45, minZ + (n + .5) * depth / (bays * 2), .9, .7, .9);
  }
  hedge(add, maxX + .6, maxX + 1.4, minZ + 1, minZ + depth / 2 - .6, 1.6);
  hedge(add, maxX + .6, maxX + 1.4, minZ + depth / 2 + .6, lot.bounds.maxZ - 1, 1.6);
  lot.roof = { base: base + wall + .05, rise };
}

// Red brick office with the green/blue logo panel
function intratuinOffice(add, lot) {
  const { maxX, x, z, width, depth } = boundsOf(lot);
  const maxZ = lot.bounds.maxZ;
  const base = .245;
  const height = 6.4;
  add('box', '#8d4233', x, base + height / 2, z, width, height, depth);
  add('box', '#6d6f71', x, base + height + .1, z, width + .2, .2, depth + .2);
  for (let floor = 0; floor < 3; floor++) {
    const y = base + 1.2 + floor * 2;
    add('box', '#5b6f7c', maxX + .03, y, z - depth * .15, .04, 1.1, depth * .55);
    add('box', '#5b6f7c', x, y, maxZ + .03, width * .7, 1.1, .04);
  }
  // Logo panel on the road side, entrance below
  add('box', '#2b6cb3', maxX + .06, base + height - 1.3, z + depth * .3, .06, 1.6, 1.6);
  add('box', '#f4f4ef', maxX + .1, base + height - 1.3, z + depth * .3, .03, .6, .9);
  add('box', '#43a560', maxX + .1, base + height - .85, z + depth * .3, .03, .25, 1.2);
  add('box', '#e8e4dc', maxX + .5, base + 2.4, z + depth * .3, 1, .14, 2.6);
  add('box', '#7c8a90', maxX + .03, base + 1.1, z + depth * .3, .05, 1.9, 2);
  lot.roof = { base: base + height + .2, rise: 0 };
}

// A green Intratuin sign on two posts, facing the road: a flower and the name. cell sets the size.
function intratuinSign(add, x, bottom, z, cell = .3) {
  const text = 'INTRATUIN';
  const pad = cell * 2.3;
  const height = 7 * cell + pad;
  const flower = cell * 8;
  const length = textWidth(text, cell) + flower + cell * 4.6;
  for (const dz of [-length / 2 + cell * 5, length / 2 - cell * 5]) {
    add('box', '#5d6366', x - .2, bottom / 2 + .5, z + dz, .12, bottom + 1, .12);
  }
  add('box', '#23763b', x, bottom + height / 2, z, .14, height, length);
  add('box', '#f4f4ef', x + .02, bottom + cell * .4, z, .15, cell * .33, length - .2);
  pixelText(add, text, { x: x + .09, y: bottom + height - pad / 2, z: z - flower / 2, cell, color: '#ffffff', face: 'x' });
  // Flower at the start of the name (the +z end)
  const fz = z + length / 2 - cell * 1.7 - flower / 2;
  const fy = bottom + height / 2;
  for (let n = 0; n < 5; n++) {
    const angle = n / 5 * Math.PI * 2;
    add('sphere', n % 2 ? '#e7509a' : '#f08cc0', x + .1, fy + Math.cos(angle) * cell * 1.83,
      fz + Math.sin(angle) * cell * 1.83, .06, cell * 2.33, cell * 2.33);
  }
  add('sphere', '#f6c945', x + .13, fy, fz, .06, cell * 1.83, cell * 1.83);
}

// VDL: a blue panel with white letters, on a facade facing +z (north, towards Oude Baan)
function vdlPanel(add, x, y, z, cell) {
  const width = textWidth('VDL', cell) + cell * 4;
  const height = 7 * cell + cell * 3;
  add('box', '#1d3f8f', x, y, z + .05, width, height, .1);
  pixelText(add, 'VDL', { x, y: y + 3.5 * cell, z: z + .12, cell, color: '#ffffff', face: 'z' });
}

// The big production hall with solar panels on the roof
function vdlHall(add, lot) {
  const { minX, maxX, minZ, maxZ, x, z, width, depth } = boundsOf(lot);
  const base = .245;
  const height = 8;
  add('box', '#6b7884', x, base + height / 2, z, width, height, depth);
  add('box', '#56626d', x, base + height + .1, z, width + .2, .2, depth + .2);
  add('box', '#9aa5ad', x, base + height - .6, maxZ + .03, width, .5, .04);
  add('box', '#9aa5ad', maxX + .03, base + height - .6, z, .04, .5, depth);
  for (let n = 1; n < width / 1.2; n++) add('box', '#5f6b77', minX + n * 1.2, base + height / 2 - .4, maxZ + .04, .08, height - 1.6, .04);
  for (let n = 1; n < depth / 1.2; n++) add('box', '#5f6b77', maxX + .04, base + height / 2 - .4, minZ + n * 1.2, .04, height - 1.6, .08);
  // Loading doors on the north side
  for (let n = 0; n < 4; n++) add('box', '#b9c0c4', maxX - 5 - n * 6, base + 2.1, maxZ + .06, 3.6, 4.2, .05);
  // Rows of solar panels, tilted towards the south
  for (let n = 0; n < Math.floor((depth - 2) / 2.2); n++) {
    add('box', '#27395a', x, base + height + .45, minZ + 1.6 + n * 2.2, width - 2, .1, 1.7, -.2);
  }
  vdlPanel(add, minX + 8, base + height - 2.6, maxZ, .42);
  lot.roof = { base: base + height + .7, rise: 0 };
}

// The office along Oude Baan, with dark window bands and the logo
function vdlOffice(add, lot) {
  const { maxX, maxZ, x, z, width, depth } = boundsOf(lot);
  const base = .245;
  const height = 6.6;
  add('box', '#cfd3d4', x, base + height / 2, z, width, height, depth);
  add('box', '#9aa2a6', x, base + height + .1, z, width + .2, .2, depth + .2);
  for (let floor = 0; floor < 2; floor++) {
    const y = base + 1.6 + floor * 2.9;
    add('box', '#40525f', x, y, maxZ + .03, width - 1, 1.5, .04);
    add('box', '#40525f', maxX + .03, y, z, .04, 1.5, depth - 1);
  }
  add('box', '#1d3f8f', x, base + height - .3, maxZ + .05, width, .4, .04);
  vdlPanel(add, x + width * .25, base + height - 1.9, maxZ + .05, .2);
  add('box', '#e0e3e2', x - width * .3, base + 2.6, maxZ + .7, 3, .14, 1.4);
  lot.roof = { base: base + height + .2, rise: 0 };
}

// A VDL sign on a post at the corner of the crossing
function vdlPylon(add, x, z) {
  const cell = .2;
  add('box', '#7b8287', x, 1.6, z, .2, 2.7, .2);
  vdlPanel(add, x, 3.4, z - .1, cell);
}

/*
** The whole site
*/
export function buildSite(add, kit) {
  const { cityTree, lotRandom } = kit;
  const random = lotRandom(700, 700);
  const lots = [];
  const lights = [];
  const crossing = { minZ: CROSSING_Z - ROAD.halfWidth, maxZ: CROSSING_Z + ROAD.halfWidth };
  const lamp = (x, z) => {
    mushroomLamp(add, x, z);
    lights.push({ x, y: 3.6, z });
  };
  const site = (lot) => {
    Object.assign(lot, boundsOf(lot));
    lots.push(lot);
    return lot;
  };

  // Base pavement, like the procedural blocks, then surfaces on top
  add('paving', '#e2dfc8', (SITE.minX + SITE.maxX) / 2, .065, (SITE.minZ + SITE.maxZ) / 2,
    SITE.maxX - SITE.minX, .32, SITE.maxZ - SITE.minZ);
  for (const [minZ, maxZ] of [[SITE.minZ, crossing.minZ], [crossing.maxZ, SITE.maxZ]]) {
    add('box', '#f3ecd4', -1.96, .229, (minZ + maxZ) / 2, .075, .018, maxZ - minZ);
  }

  // Terheijdenseweg east side: pavement (-2 to -7.6), verge with trees, red bike path, grass
  const stopArea = [-6, 8]; // keep the stop tree and shelter free
  for (const [minZ, maxZ] of [[SITE.minZ, stopArea[0]], [stopArea[1], crossing.minZ - .6], [crossing.maxZ + .6, SITE.maxZ]]) {
    if (maxZ - minZ < 1) continue;
    ground(add, VERGE, -10.4, -7.6, minZ, maxZ);
    for (let z = minZ + 3; z < maxZ - 2; z += 7.5) cityTree(add, -9, z, 4.8 + random() * 1.4, random, 1);
  }
  for (const [minZ, maxZ] of [[SITE.minZ, crossing.minZ - .6], [crossing.maxZ + .6, SITE.maxZ]]) {
    ground(add, VERGE, -14.6, -12.6, minZ, maxZ);
  }
  // The bike path ends north of Curio; from there only a small concrete path continues
  ground(add, BIKE_PATH, -12.6, -10.4, SITE.minZ, BIKE_PATH_END);
  for (let z = SITE.minZ + 1; z < BIKE_PATH_END - 1; z += 3) {
    if (z < crossing.minZ - 1 || z > crossing.maxZ + 1) add('box', '#e8d9cf', -11.5, LINE_Y, z, .08, .01, 1.3);
  }
  ground(add, VERGE, -12.6, -10.4, BIKE_PATH_END, SITE.maxZ);
  ground(add, '#cdcac2', -12.1, -10.9, BIKE_PATH_END - .2, SITE.maxZ, ROAD_Y);
  for (let z = BIKE_PATH_END + 1.5; z < SITE.maxZ; z += 1.5) add('box', '#b4b1a9', -11.5, LINE_Y, z, 1.2, .01, .04);

  // The crossing: asphalt from the main road to the bike path, zebra, blocks along the bike crossing,
  // traffic lights on all four corners
  ground(add, ASPHALT, -10.4, -2, crossing.minZ - .6, crossing.maxZ + .6);
  ground(add, ASPHALT, -14.6, -12.6, crossing.minZ - .6, crossing.maxZ + .6);
  for (let n = 0; n < 7; n++) add('box', '#eee9d6', -3.4, LINE_Y, crossing.minZ + .4 + n * .56, 1.8, .01, .27);
  for (const x of [-10.3, -12.7]) {
    for (let n = 0; n < 9; n++) add('box', '#f1ece0', x, LINE_Y, crossing.minZ - .2 + n * .58, .22, .01, .3);
  }
  for (let x = -7; x > -10; x -= 3) add('box', '#dce0ce', x, LINE_Y, CROSSING_Z, 1.2, .01, .075);
  trafficLight(add, -2.7, crossing.minZ - .5, 1.6);
  trafficLight(add, -2.7, crossing.maxZ + .5);
  trafficLight(add, 6.2, crossing.maxZ + .5, -2.2);
  trafficLight(add, 6.2, crossing.minZ - .5);

  // The road to the school: east along the grass field, a rounded turn north around it, then on past Curio
  const turnCenter = { x: ROAD.turnX, z: CROSSING_Z + ROAD.radius };
  ground(add, BRICK_ROAD, ROAD.turnX - .1, -14.6, crossing.minZ, crossing.maxZ, ROAD_Y);
  const segments = 14;
  for (let n = 0; n < segments; n++) {
    const angle = (n + .5) / segments * Math.PI / 2;
    const length = ROAD.radius * Math.PI / 2 / segments * 1.25;
    add('box', BRICK_ROAD, turnCenter.x - ROAD.radius * Math.sin(angle), ROAD_Y,
      turnCenter.z - ROAD.radius * Math.cos(angle), length + .4, .02, ROAD.halfWidth * 2, 0, Math.PI + angle, 0);
  }
  ground(add, BRICK_ROAD, ROAD.northX - ROAD.halfWidth, ROAD.northX + ROAD.halfWidth, turnCenter.z - .1, SITE.maxZ, ROAD_Y);
  const outside = ROAD.radius + ROAD.halfWidth + .9;
  lamp(turnCenter.x - outside * Math.SQRT1_2, turnCenter.z - outside * Math.SQRT1_2);
  lamp(-17, crossing.maxZ + 1);
  for (let z = turnCenter.z + 6; z < SITE.maxZ; z += 9) lamp(ROAD.northX - ROAD.halfWidth - .8, z);

  // The grass field inside the bend, between the road and the school, rounded along the curve
  const fieldEdge = { minX: ROAD.northX + ROAD.halfWidth + .3, maxX: -15.2, minZ: crossing.maxZ + .5, maxZ: CROSSING_Z + ROAD.radius + 3.6 };
  const fieldRadius = ROAD.radius - ROAD.halfWidth - .3;
  ground(add, VERGE, ROAD.northX - ROAD.halfWidth, ROAD.turnX, crossing.maxZ, turnCenter.z); // outside the bend
  ground(add, GRASS, turnCenter.x, fieldEdge.maxX, fieldEdge.minZ, fieldEdge.maxZ);
  ground(add, GRASS, fieldEdge.minX, turnCenter.x, turnCenter.z, fieldEdge.maxZ);
  add('cylinder', GRASS, turnCenter.x, GROUND_Y, turnCenter.z, fieldRadius * 2, .02, fieldRadius * 2);
  basketballHoop(add, fieldEdge.minX + .8, fieldEdge.maxZ - 1.6);
  basketballHoop(add, fieldEdge.minX + .8, fieldEdge.maxZ - 6.6);
  footballGoal(add, fieldEdge.maxX - 4.5, fieldEdge.minZ + 1.6);
  for (let x = fieldEdge.maxX - 1.2; x > fieldEdge.minX + 2; x -= 7.5) cityTree(add, x, fieldEdge.maxZ - .9, 5.8 + random(), random, 0);
  site({ kind: 'park', bounds: fieldEdge, height: 7 });
  lots.at(-1).blockBounds = { minX: ROAD.northX, maxX: -14.6, minZ: crossing.maxZ, maxZ: fieldEdge.maxZ };

  // Open grass behind the stop, between the road to the school and the Intratuin
  ground(add, GRASS, -38, -14.6, -4, crossing.minZ);
  ground(add, VERGE, -38, ROAD.turnX, crossing.minZ, crossing.maxZ);
  for (let x = -19; x > -37; x -= 5.5) cityTree(add, x + random(), -2.6, 5.6 + random() * 1.5, random, 0);
  cityTree(add, -35.5, 4.5, 6.4, random, 0);

  // Intratuin, south of the stop and all along the road: hedge along the bike path, a long car park,
  // then the white hall, the greenhouses with the big sign and the red brick office
  const tuin = { minX: -38, maxX: -14.6, minZ: SITE.minZ, maxZ: -4 };
  ground(add, VERGE, tuin.minX, tuin.maxX, tuin.minZ, tuin.maxZ);
  ground(add, YARD, -21.2, -15.6, tuin.minZ + .5, tuin.maxZ - .3);
  hedge(add, -15.5, -14.8, tuin.minZ + .5, -31, 1.2);
  hedge(add, -15.5, -14.8, -27, tuin.maxZ - 4.5, 1.2);
  const carColors = ['#c9ccd0', '#2f3d55', '#8b2f2f', '#f2f2ef', '#4a4f55', '#6f8a9c', '#2a2a2e'];
  for (let z = tuin.minZ + 2; z < tuin.maxZ - 1.5; z += 2.6) {
    add('box', '#eeeeea', -18.4, LINE_Y, z - 1.3, 4.2, .01, .07);
    if (random() < .55) parkedCar(add, -18.4, z, 0, carColors[Math.floor(random() * carColors.length)]);
  }
  const tuinLots = [
    site({ kind: 'building', bounds: { minX: tuin.minX + 2, maxX: -22, minZ: -18.5, maxZ: tuin.maxZ - .8 } }),
    site({ kind: 'building', bounds: { minX: tuin.minX, maxX: -23.6, minZ: -48, maxZ: -19.5 } }),
    site({ kind: 'building', bounds: { minX: -32, maxX: -22.4, minZ: tuin.minZ + 2.5, maxZ: -49.5 } }),
  ];
  intratuinHall(add, tuinLots[0]);
  greenhouses(add, tuinLots[1]);
  intratuinOffice(add, tuinLots[2]);
  intratuinSign(add, tuinLots[1].maxX - 1.2, tuinLots[1].roof.base + tuinLots[1].roof.rise + .5, tuinLots[1].z);
  // A second, smaller sign along the road next to the car park entrance
  intratuinSign(add, -13.6, 2.6, -37, .2);
  [0, 1.4, 2.8].forEach((dz, n) => flagpole(add, -21.7, -49.2 + dz,
    n === 1 ? ['#f4f4ef', '#2b6cb3', '#f4f4ef'] : ['#2b6cb3', '#2b6cb3', '#f4f4ef']));
  for (const lot of tuinLots) lot.blockBounds = tuin;

  // Woods between the Intratuin and Luikstraat
  ground(add, VERGE, SITE.minX, tuin.minX, SITE.minZ, crossing.maxZ + 1.2);
  for (let z = SITE.minZ + 2; z < crossing.minZ; z += 4.6) {
    for (let x = tuin.minX - 2; x > SITE.minX + 1; x -= 4.8) {
      cityTree(add, x - random() * 1.5, z + random() * 1.8, 5.2 + random() * 2.2, random, random() < .5 ? 0 : 1);
    }
  }

  // The Curio grounds behind the field: fenced yard, three buildings, flags, sign and parking along the drive
  const yard = { minX: SITE.minX, maxX: -15.6, minZ: fieldEdge.maxZ + .6, maxZ: SITE.maxZ };
  ground(add, VERGE, ROAD.northX + ROAD.halfWidth, -14.6, fieldEdge.maxZ, SITE.maxZ);
  ground(add, VERGE, SITE.minX, ROAD.northX - ROAD.halfWidth, crossing.maxZ, SITE.maxZ);
  ground(add, YARD, yard.minX, yard.maxX, yard.minZ, yard.maxZ);
  const gate = [ROAD.northX - ROAD.halfWidth - .3, ROAD.northX + ROAD.halfWidth + .3];
  const hall = site({ kind: 'building', bounds: { minX: -26.4, maxX: -18.4, minZ: yard.minZ + 1, maxZ: yard.minZ + 8.5 } });
  const tower = site({ kind: 'building', bounds: { minX: ROAD.northX + ROAD.halfWidth + 1.9, maxX: -17.4, minZ: hall.maxZ + 2, maxZ: SITE.maxZ - .5 } });
  const metal = site({ kind: 'building', bounds: { minX: -60, maxX: ROAD.northX - ROAD.halfWidth - 2.5, minZ: yard.minZ + 1.4, maxZ: yard.minZ + 17 } });
  const footGate = [hall.maxZ - 3.8, hall.maxZ - .6];
  hedge(add, -15.4, -14.7, yard.minZ, footGate[0]);
  hedge(add, -15.4, -14.7, footGate[1], yard.maxZ);
  fenceLine(add, 'z', -15.55, yard.minZ, yard.maxZ, [footGate]);
  fenceLine(add, 'x', yard.minZ, yard.minX, -15.55, [gate]);
  ground(add, '#c9c3b5', -15.6, -12.6, footGate[0], footGate[1]);
  curioHall(add, hall);
  curioTower(add, tower);
  curioMetalHall(add, metal);
  // curio logos: above the tube entrance, and a large one on the roof of the tower
  curioLogo(add, hall.maxX, 4.85, hall.z - 1, .17);
  curioLogo(add, tower.maxX - .6, tower.roof.base + 1.5, tower.minZ + 6.5, .32);
  for (const lot of [hall, tower, metal]) lot.blockBounds = { minX: yard.minX, maxX: -15.6, minZ: yard.minZ, maxZ: yard.maxZ };

  for (let z = metal.maxZ + 1.8; z < SITE.maxZ - 1.5; z += 2.6) {
    if (random() < .8) parkedCar(add, ROAD.northX - ROAD.halfWidth - 2.3, z, 0, carColors[Math.floor(random() * carColors.length)]);
  }
  for (let n = 0; n < 6; n++) {
    const x = ROAD.northX - ROAD.halfWidth - 7 - n * 2.6;
    add('box', '#eeeeea', x - 1.3, LINE_Y, metal.maxZ + 3.4, .07, .01, 4.2);
    if (random() < .75) parkedCar(add, x, metal.maxZ + 3.4, Math.PI / 2, carColors[Math.floor(random() * carColors.length)]);
  }

  flagpole(add, -16.6, footGate[0] - 1.2, ['#e8562a', '#e8562a', '#e8562a']);
  flagpole(add, -16.6, footGate[0] - 2.5, ['#ae1c28', '#f4f4f0', '#21468b']);
  curioSign(add, -14.3, footGate[0] - .4);

  // Across the road: no side street, only the Oude Baan parallel road along Terheijdenseweg, joining it at
  // the crossing. Behind it VDL Steelweld behind a fence, on both sides of the crossing: the office and a
  // car park opposite the crossing, and a big hall with solar panels to the south and to the north of it.
  const west = WEST_SITE;
  add('paving', '#e2dfc8', (west.minX + west.maxX) / 2, .065, (west.minZ + west.maxZ) / 2,
    west.maxX - west.minX, .32, west.maxZ - west.minZ);
  const parallel = { minX: 9, maxX: 12.8 };
  ground(add, ASPHALT, parallel.minX, parallel.maxX, west.minZ, west.maxZ);
  ground(add, ASPHALT, west.minX, parallel.minX, crossing.minZ, crossing.maxZ);
  for (const x of [parallel.minX - .04, parallel.maxX + .04]) add('box', '#f3ecd4', x, .229, (west.minZ + west.maxZ) / 2, .075, .018, west.maxZ - west.minZ);
  for (let z = west.minZ + 1.5; z < west.maxZ; z += 3) {
    if (z < crossing.minZ - 1 || z > crossing.maxZ + 1) add('box', '#dce0ce', (parallel.minX + parallel.maxX) / 2, LINE_Y, z, .075, .01, 1.2);
  }
  const vdl = { minX: 13.6, maxX: west.maxX, minZ: west.minZ, maxZ: west.maxZ };
  ground(add, YARD, vdl.minX, vdl.maxX, vdl.minZ, vdl.maxZ);
  const vdlGate = [crossing.minZ - 1, crossing.maxZ + 1];
  fenceLine(add, 'z', vdl.minX - .1, vdl.minZ, vdl.maxZ, [vdlGate]);
  const office = site({ kind: 'building', bounds: { minX: 15, maxX: 31, minZ: -6.5, maxZ: 4.5 } });
  const factory = site({ kind: 'building', bounds: { minX: 15, maxX: 63, minZ: west.minZ + 2.5, maxZ: -9.5 } });
  // Set back from the crossing, so it doesn't hide the crossing and the VDL sign at the gate
  const factoryNorth = site({ kind: 'building', bounds: { minX: 17, maxX: 63, minZ: crossing.maxZ + 2, maxZ: west.maxZ - 2.5 } });
  vdlOffice(add, office);
  vdlHall(add, factory);
  vdlHall(add, factoryNorth);
  for (const lot of [office, factory, factoryNorth]) lot.blockBounds = vdl;
  for (const z of [-3.6, 2.4]) {
    for (let x = 34; x < vdl.maxX - 2; x += 2.6) {
      add('box', '#eeeeea', x - 1.3, LINE_Y, z, .07, .01, 4.2);
      if (random() < .65) parkedCar(add, x, z, Math.PI / 2, carColors[Math.floor(random() * carColors.length)]);
    }
  }
  vdlPylon(add, 13, vdlGate[0] - .6);

  return { lots, lights };
}
