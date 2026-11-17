import * as THREE from './vendor/three.module.min.js';
import { COS_ELEVATION, GROUND_AXIS_Y } from './projection3d.js';
import { buildSite, inSite, CROSSING_Z } from './site3d.js';

// Side streets cross the main road at CROSSING_Z + n * 36: the first one is Oude Baan, just past the stop.
const STREET_OFFSET = CROSSING_Z;

// Every model is a small list of transformed, shared primitives. No textures or asset downloads.
const cache = new Map();
const colors = new Map();
const rotation = new THREE.Quaternion();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const euler = new THREE.Euler();

// Shared by the street geometry and vehicle placement so neither can drift toward a kerb.
export const MAIN_ROAD_LANES = {
  central: { min: -2, max: 1.1 },
  route: { min: 2.2, max: 5.5 },
};

function model(height, build) {
  const parts = [];
  const add = (shape, color, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0, glow = false) => {
    if (!colors.has(color)) colors.set(color, new THREE.Color(color));
    position.set(x, y, z);
    scale.set(w, h, d);
    rotation.setFromEuler(euler.set(rx, ry, rz));
    const part = { shape: glow ? `${shape}-glow` : shape, color: colors.get(color),
      matrix: new THREE.Matrix4().compose(position, rotation, scale) };
    if (rx === 0 && rz === 0) {
      if ((shape === 'box' || shape === 'cylinder') && h >= Math.max(w, d) * 3) {
        part.minPixelWidth = 1;
      } else if (shape === 'box' && Math.min(w, h, d) < .25) {
        const normalAxis = w <= h && w <= d ? 0 : h <= d ? 1 : 2;
        part.pixelPlane = { matrix: part.matrix, axes: normalAxis === 0 ? [2, 1] : normalAxis === 1 ? [0, 2] : [0, 1] };
      }
    }
    parts.push(part);
    return part;
  };
  build(add, parts);
  return { height, parts };
}

function stop(add, x, z) {
  add('cylinder', '#71858d', x, 1.25, z, .10, 2.5, .10);
  add('box', '#284d69', x, 2.65, z, .12, 1.05, .65);
  add('box', '#f5cf4d', x + .07, 2.57, z, .025, .68, .52);
  add('box', '#e8f3ef', x + .07, 2.98, z, .025, .15, .52);
  for (let n = 0; n < 3; n++) add('box', '#987f45', x + .09, 2.7 - n * .15, z, .02, .035, .38);
}

function stopTree(add) {
  add('box', '#65735d', -6.4, .37, 2.8, 2.25, .35, 2.25);
  add('sphere', '#719650', -6.4, .65, 2.8, 2.2, .7, 2.2);
  cityTree(add, -6.4, 2.8, 6.15, lotRandom(11, 7), 0);
}

function shelter(add) {
  for (const z of [-1.4, 1.8]) {
    for (const x of [-5.5, -3.8]) add('box', '#31536c', x, 1.55, z, .10, 2.7, .10);
    add('box', '#31536c', -4.65, 2.86, z, 1.95, .10, .10);
  }
  for (let n = 0; n < 3; n++) {
    add('box', '#b4d8d6', -5.5, 1.6, -.86 + n * 1.04, .055, 2.1, .97);
    add('box', '#31536c', -5.5, 1.6, -1.4 + n * 1.07, .09, 2.55, .09);
  }
  for (let n = 0; n < 6; n++) {
    const x = -5.65 + n * .4;
    const y = 2.93 + .24 * Math.sin(n / 5 * Math.PI);
    add('box', '#c0e3dd', x, y, .2, .42, .10, 3.6, 0, 0, Math.cos(n / 5 * Math.PI) * .22);
  }
  for (const z of [-1.55, -.4, .75, 1.95]) add('box', '#31536c', -4.65, 3.11, z, 2.15, .06, .075);
  add('box', '#e99a50', -4.85, .88, .2, .75, .16, 2.95);
  add('box', '#e98447', -5.17, 1.22, .2, .12, .63, 2.95, 0, 0, -.12);
  for (const z of [-1.1, 1.5]) {
    add('box', '#31536c', -4.9, .5, z, .12, .55, .12);
    add('box', '#31536c', -4.7, 1.03, z, .9, .08, .09);
  }
}

// The stop itself stays fixed. Viewport-sized ground and city blocks are generated separately.
export const scenery = model(7, (add) => {
  stopTree(add);
  shelter(add);
  stop(add, -3.45, -2.55);
  stop(add, 6.9, -2.1);
});

function lotRandom(column, row) {
  let state = (Math.imul(column, 73856093) ^ Math.imul(row, 19349663) ^ 0x43ba1d29) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

// Land use belongs to a complete street-bounded block, never to an individual house plot.
export function getCityBlock(column, row) {
  const side = Math.sign(column);
  const index = Math.abs(column) - 1;
  const near = index === 0 ? side > 0 ? 5.5 : 2 : 33.4 + (index - 1) * 36;
  const far = 29.6 + index * 36;
  const bounds = { minX: side > 0 ? near : -far, maxX: side > 0 ? far : -near,
    minZ: row * 36 + STREET_OFFSET - 33.9, maxZ: row * 36 + STREET_OFFSET - 2.1 };
  const random = lotRandom(column * 17, row * 23);
  const choice = random();
  const kind = index === 0 && row === 0 ? 'building' : choice < .43 ? 'building' : choice < .70 ? 'park' : 'mixed';
  const axis = random() < .5 ? 'x' : 'z';
  const parkSide = random() < .5 ? -1 : 1;
  const inner = { minX: bounds.minX + 1.8, maxX: bounds.maxX - 1.8,
    minZ: bounds.minZ + 1.8, maxZ: bounds.maxZ - 1.8 };
  let buildingArea = kind === 'park' ? null : { ...inner };
  let parkArea = kind === 'building' ? null : { ...inner };
  if (kind === 'mixed') {
    const min = axis === 'x' ? 'minX' : 'minZ';
    const max = axis === 'x' ? 'maxX' : 'maxZ';
    const middle = (inner[min] + inner[max]) / 2;
    if (parkSide < 0) { parkArea[max] = middle - .4; buildingArea[min] = middle + .4; }
    else { buildingArea[max] = middle - .4; parkArea[min] = middle + .4; }
  }
  return { id: `${column}:${row}`, column, row, kind, axis, parkSide, bounds, buildingArea, parkArea };
}

function visibleCityLot(lot, view, keepFocus = true) {
  const u = (lot.x - lot.z) / Math.sqrt(2);
  const v = (lot.x + lot.z) * GROUND_AXIS_Y;
  const radiusU = (lot.width + lot.depth + 1) / (2 * Math.sqrt(2));
  const radiusV = (lot.width + lot.depth + 1) * GROUND_AXIS_Y / 2;
  const top = v - radiusV - (lot.height + 2) * COS_ELEVATION;
  const bottom = v + radiusV;
  if (keepFocus && u + radiusU > -11 && u - radiusU < 11 && bottom > -10 && top < 7) return false;
  return u + radiusU >= view.minU && u - radiusU <= view.maxU && bottom >= view.minV && top <= view.maxV;
}

function blockBuildings(block, view) {
  if (!block.buildingArea) return [];
  const area = block.buildingArea;
  const width = area.maxX - area.minX;
  const depth = area.maxZ - area.minZ;
  const columns = Math.max(1, Math.round(width / 6.5));
  const rows = Math.max(1, Math.round(depth / 8.5));
  const lots = [];
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      const random = lotRandom(block.column * 101 + column, block.row * 103 + row);
      const floors = 2 + Math.floor(random() * 3);
      const lot = { x: area.minX + (column + .5) * width / columns,
        z: area.minZ + (row + .5) * depth / rows,
        width: width / columns - .35, depth: depth / rows - .70,
        floors, height: floors * 1.95 + .5, kind: 'building', blockId: block.id,
        blockBounds: block.bounds, random };
      if (visibleCityLot(lot, view)) lots.push(lot);
    }
  }
  return lots;
}

function building(add, lot) {
  const { x, z, width, depth, height, floors, random } = lot;
  const facade = ['#b9907d', '#c5b6a0', '#a7b7b3', '#be9d92', '#a7abb8', '#b6b49c'][Math.floor(random() * 6)];
  const roof = ['#71777d', '#866d65', '#727e78'][Math.floor(random() * 3)];
  const base = .225;
  add('box', facade, x, base + height / 2, z, width, height, depth);
  add('box', '#dfd6bf', x, base + height - .12, z, width + .12, .18, depth + .12);
  const pitched = random() < .55;
  lot.roof = { base: base + height + (pitched ? .1 : .17), rise: pitched ? width * .22 : 0 };
  if (pitched) {
    const rise = width * .22;
    const slope = Math.atan2(rise, width / 2);
    const panel = Math.hypot(width / 2, rise) + .25;
    for (const side of [-1, 1]) add('box', roof, x + side * width / 4,
      base + height + rise / 2, z, panel, .18, depth + .45, 0, 0, -side * slope);
  } else {
    add('box', roof, x, base + height + .08, z, width + .25, .18, depth + .25);
    add('box', '#a0aaa6', x - width * .2, base + height + .35, z, width * .28, .45, depth * .25);
  }
  add('box', roof, x + width * .25, base + height + .65, z - depth * .2, .45, 1.2, .5);
  const frontColumns = Math.max(2, Math.floor(width / 1.65));
  const sideColumns = Math.max(2, Math.floor(depth / 1.65));
  for (let floor = 0; floor < floors; floor++) {
    const y = base + 1.25 + floor * 1.95;
    for (let column = 0; column < frontColumns; column++) {
      const wx = x - width / 2 + (column + .5) * width / frontColumns;
      const glass = random() < .25 ? '#a9b9b5' : '#647e89';
      framedWindow(add, glass, wx, y, z + depth / 2 + .025, 0);
    }
    for (let column = 0; column < sideColumns; column++) {
      const wz = z - depth / 2 + (column + .5) * depth / sideColumns;
      framedWindow(add, '#748d96', x + width / 2 + .025, y, wz, 2);
    }
  }
  add('box', '#4e6268', x, .99, z + depth / 2 + .09, .82, 1.75, .08);
  add('box', '#d5c9b0', x, 1.93, z + depth / 2 + .13, 1.05, .12, .18);
}

function framedWindow(add, color, x, y, z, horizontalAxis) {
  const front = horizontalAxis === 0;
  const frame = add('box', '#ded7c6', x, y, z, front ? .87 : .055, 1.12, front ? .055 : .87);
  const glass = add('box', color, x + (front ? 0 : .035), y + .035, z + (front ? .035 : 0),
    front ? .68 : .025, .88, front ? .025 : .68);
  // Frame and pane share a pixel anchor; the one-pixel inset survives every render scale.
  const group = { matrix: frame.matrix, axes: [horizontalAxis, 1], framed: true };
  frame.pixelPlane = group;
  glass.pixelPlane = { ...group, inset: 1 };
}

function cityTree(add, x, z, height, random, variant = random() < .5 ? 0 : 1) {
  const palettes = [
    ['#75965e', '#88a66b', '#a0b779', '#60834f'],
    ['#6e946b', '#83a47a', '#9db78b', '#587c58'],
    ['#829b63', '#97ae74', '#adbf87', '#6b8756'],
  ];
  const [leaf, light, top, shade] = palettes[Math.floor(random() * palettes.length)];
  const yaw = random() * Math.PI * 2;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const bark = variant === 0 ? '#947252' : '#a18b6b';
  const crown = (color, dx, y, dz, w, h, d, tilt = 0) => {
    add('sphere', color, x + (dx * c + dz * s) * height, .225 + y * height,
      z + (dz * c - dx * s) * height, w * height, h * height, d * height, 0, yaw, tilt);
  };
  const branch = (dx, y, dz, start) => {
    const bx = (dx * c + dz * s) * height;
    const by = (y - start) * height;
    const bz = (dz * c - dx * s) * height;
    add('cone', bark, x + bx / 2, .225 + (start + y) * height / 2, z + bz / 2,
      height * .034, Math.hypot(bx, by, bz), height * .034,
      Math.atan2(bz, by), 0, -Math.atan2(bx, Math.hypot(by, bz)));
  };

  // A tapered trunk, root flare and visible forks support overlapping, irregular leaf masses.
  crown('#7f9769', .045, .003, .03, variant === 0 ? .72 : .48, .005, .54);
  add('cone', bark, x, .225 + height * .32, z, height * .072, height * .64, height * .065);
  add('cone', bark, x, .225 + height * .06, z, height * .11, height * .12, height * .09);
  const spread = variant === 0 ? .18 : .10;
  branch(-spread, .64, .035, .28);
  branch(spread, .66, -.06, .34);
  branch(.025, .64, spread * .8, .39);

  // Broad, spreading crown versus a narrower, upright crown; both retain an uneven outline.
  if (variant === 0) {
    crown(shade, 0, .61, 0, .52, .35, .46);
    crown(leaf, -.19, .65, .015, .38, .38, .40, -.12);
    crown(leaf, .18, .68, -.045, .36, .41, .36, .13);
    crown(leaf, -.04, .73, -.16, .40, .41, .35);
    crown(light, .035, .72, .16, .41, .38, .35, -.08);
    crown(light, -.08, .83, -.015, .40, .32, .37);
    crown(top, .09, .87, .055, .30, .24, .29, .10);
  } else {
    crown(shade, .005, .69, 0, .33, .52, .32);
    crown(leaf, -.10, .58, .03, .25, .31, .27, -.18);
    crown(leaf, .10, .64, -.015, .26, .34, .25, .15);
    crown(leaf, .01, .75, -.09, .27, .38, .24, -.06);
    crown(light, -.03, .76, .10, .28, .36, .25, .12);
    crown(top, .015, .87, -.005, .25, .26, .24, -.10);
  }
}

function streetLamp(add, headX, z, postX) {
  add('cylinder', '#455965', postX, .30, z, .30, .15, .30);
  add('cylinder', '#526674', postX, 2.525, z, .105, 4.6, .105);
  add('box', '#526674', (postX + headX) / 2, 4.82, z, Math.abs(headX - postX) + .10, .10, .12);
  add('box', '#354b5b', headX, 4.79, z, .75, .17, .40);
  add('box', '#ffe3a2', headX, 4.685, z, .57, .035, .28, 0, 0, 0, true);
  add('box', '#ffe3a2', headX, 4.75, z + .205, .60, .065, .025, 0, 0, 0, true);
  add('box', '#ffe3a2', headX + .38, 4.75, z, .025, .065, .30, 0, 0, 0, true);
  // Camera-facing procedural halo. Its shader fades it out completely during daylight.
  add('light', '#ffd396', headX + .12, 4.78, z + .24, .95, .95, 1);
}

function parkBench(add, x, z) {
  add('box', '#c29263', x, .72, z, 1.5, .12, .5);
  add('box', '#c29263', x, .99, z - .22, 1.5, .48, .10);
  for (const side of [-1, 1]) add('box', '#54676b', x + side * .55, .46, z, .09, .48, .42);
}

function cityPark(add, lot) {
  const { x, z, random, width, depth } = lot;
  add('box', '#92ad78', x, .23, z, width, .025, depth);
  const loopWidth = width - 3;
  const loopDepth = depth - 3;
  const crossing = z + depth * .14;
  // One continuous park with an edge loop, entrances and shared walking paths.
  for (const side of [-1, 1]) {
    add('paving', '#e2dfc8', x, .242, z + side * loopDepth / 2, loopWidth + .8, .025, .8);
    add('paving', '#e2dfc8', x + side * loopWidth / 2, .242, z, .8, .025, loopDepth);
    parkBench(add, x + side * Math.min(width * .23, 3.5), crossing + side * 1.05);
  }
  add('paving', '#e2dfc8', x, .242, z, 1.05, .025, depth);
  add('paving', '#e2dfc8', x, .242, crossing, width, .025, 1.05);
  if (random() < .6) {
    const pond = { x: x + width * .24, z: z - depth * .15,
      radiusX: Math.min(width * .12, 2.1), radiusZ: Math.min(depth * .13, 2.0) };
    add('sphere', '#c6c9b2', pond.x, .25, pond.z, pond.radiusX * 2 + .22, .035, pond.radiusZ * 2 + .22);
    add('sphere', '#7da6a8', pond.x, .27, pond.z, pond.radiusX * 2, .025, pond.radiusZ * 2);
    lot.pond = pond;
  }
  const treesPerSide = Math.max(2, Math.min(5, Math.round(depth / 6)));
  for (const side of [-1, 1]) {
    for (let n = 0; n < treesPerSide; n++) {
      const tx = x + side * (width / 2 - 1.8);
      const tz = z - depth / 2 + 2.3 + n * (depth - 4.6) / (treesPerSide - 1);
      cityTree(add, tx, tz, 3 + random() * 1.5, random);
    }
    for (let n = 0; n < 6; n++) {
      const bx = x + side * Math.min(width * .22, 3.2) + (n - 2.5) * .38;
      const bz = z + side * (depth / 2 - .8);
      add('sphere', '#6f925f', bx, .42, bz, .47, .36, .48);
      add('sphere', n % 2 ? '#d3ae69' : '#bd8b9f', bx, .61, bz, .2, .13, .2);
    }
  }
}

function gaps(min, max, roads) {
  const segments = [];
  let edge = min;
  for (const road of [...roads].sort((a, b) => a.min - b.min)) {
    if (road.max <= edge || road.min >= max) continue;
    if (road.min > edge) segments.push({ min: edge, max: road.min });
    edge = Math.max(edge, road.max);
  }
  if (edge < max) segments.push({ min: edge, max });
  return segments;
}

export function createEnvironment(bounds, view) {
  const length = bounds.maxZ - bounds.minZ;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  let buildingCount = 0;
  let parkCount = 0;
  const cityLots = [];
  const cityBlocks = [];
  const streetLights = [];
  const roadsX = Object.values(MAIN_ROAD_LANES);
  const roadsZ = [];
  const environment = model(12, (add) => {
    // One asphalt base, with continuous paving between streets. The city and stop now share
    // the same .225-high pavement surface, without an artificial edge around the old diorama.
    add('box', '#637f87', (bounds.minX + bounds.maxX) / 2, -.22, centerZ,
      bounds.maxX - bounds.minX, .45, length);
    for (let n = 0; 31.5 + n * 36 < Math.max(-bounds.minX, bounds.maxX) + 4; n++) {
      for (const side of [-1, 1]) {
        const x = side * (31.5 + n * 36);
        roadsX.push({ min: x - 1.9, max: x + 1.9 });
      }
    }
    for (let n = Math.floor(bounds.minZ / 36) - 1; n <= Math.ceil(bounds.maxZ / 36); n++) {
      const z = STREET_OFFSET + n * 36;
      // Side streets that would run through the hand-made sites on both sides of the main road don't exist,
      // except the crossing itself
      if (z !== CROSSING_Z && inSite(-3, z) && inSite(6, z)) continue;
      if (z + 2.1 > bounds.minZ && z - 2.1 < bounds.maxZ) roadsZ.push({ min: z - 2.1, max: z + 2.1 });
    }
    const pavedX = gaps(bounds.minX, bounds.maxX, roadsX);
    const pavedZ = gaps(bounds.minZ, bounds.maxZ, roadsZ);
    for (const x of pavedX) {
      for (const z of pavedZ) {
        // The hand-made site (site3d.js) draws its own ground
        if (inSite((x.min + x.max) / 2, (z.min + z.max) / 2)) continue;
        add('paving', '#e2dfc8', (x.min + x.max) / 2, .065,
          (z.min + z.max) / 2, x.max - x.min, .32, z.max - z.min);
      }
    }
    // Pale kerbs and zebra crossings connect the extended footpaths at side streets.
    for (const z of pavedZ) {
      for (const x of [-1.96, 1.06, 2.24, 5.46]) {
        if (inSite(x - .1, (z.min + z.max) / 2)) continue;
        add('box', '#f3ecd4', x, .229, (z.min + z.max) / 2, .075, .018, z.max - z.min);
      }
    }
    for (const street of roadsZ) {
      const z = (street.min + street.max) / 2;
      for (let x = Math.ceil(bounds.minX / 3) * 3; x < bounds.maxX; x += 3) {
        if (roadsX.some((road) => x + .6 > road.min && x - .6 < road.max) || inSite(x, z)) continue;
        add('box', '#dce0ce', x, .017, z, 1.2, .012, .075);
      }
      for (const x of [-3.4, 6.9]) {
        if (inSite(x, z)) continue;
        for (let n = 0; n < 7; n++) add('box', '#eee9d6', x, .018, z - 1.7 + n * .56, 1.8, .015, .27);
      }
    }
    const columns = [{ head: -1.5, post: -2.8 }, { head: 5, post: 6.3 }];
    for (let n = 0; 30 + n * 36 < Math.max(-bounds.minX, bounds.maxX); n++) {
      for (const side of [-1, 1]) columns.push({ head: side * (30 + n * 36), post: side * (29.5 + n * 36) });
    }
    for (const column of columns) {
      if (column.post < bounds.minX || column.post > bounds.maxX) continue;
      for (let row = Math.ceil(bounds.minZ / 12); row <= Math.floor(bounds.maxZ / 12); row++) {
        const z = row * 12;
        // Inside the hand-made sites only the lamps along the main road remain
        if (Math.abs(column.post) > 7 && inSite(column.post, z)) continue;
        if (roadsZ.some((road) => z > road.min - .5 && z < road.max + .5)) continue;
        streetLamp(add, column.head, z, column.post);
        streetLights.push({ x: column.head, y: 4.68, z });
      }
    }

    const blocks = [];
    const maxColumn = Math.ceil(Math.max(-bounds.minX, bounds.maxX) / 36) + 1;
    for (let column = -maxColumn; column <= maxColumn; column++) {
      if (column === 0) continue;
      for (let row = Math.floor(bounds.minZ / 36); row <= Math.ceil(bounds.maxZ / 36); row++) {
        const block = getCityBlock(column, row);
        if (inSite((block.bounds.minX + block.bounds.maxX) / 2, (block.bounds.minZ + block.bounds.maxZ) / 2)) continue;
        const houses = blockBuildings(block, view);
        let park = null;
        if (block.parkArea) {
          const area = block.parkArea;
          park = { x: (area.minX + area.maxX) / 2, z: (area.minZ + area.maxZ) / 2,
            width: area.maxX - area.minX, depth: area.maxZ - area.minZ, height: 5, kind: 'park',
            blockId: block.id, blockBounds: block.bounds, random: lotRandom(column * 109, row * 113) };
          if (!visibleCityLot(park, view, false)) park = null;
        }
        if (houses.length || park) blocks.push({ ...block, houses, park });
      }
    }
    // The real surroundings of the stop: Curio and the sports field, see site3d.js
    const site = buildSite(add, { cityTree, lotRandom });
    for (const lot of site.lots) {
      cityLots.push(lot);
      if (lot.kind === 'building') buildingCount++;
      else parkCount++;
    }
    streetLights.push(...site.lights);
    blocks.sort((a, b) => Math.hypot((a.bounds.minX + a.bounds.maxX) / 2, a.row * 36)
      - Math.hypot((b.bounds.minX + b.bounds.maxX) / 2, b.row * 36));
    for (const block of blocks) {
      // Keep complete land-use areas together when limiting distant detail on extreme displays.
      if (buildingCount + block.houses.length > 150 || cityBlocks.length >= 24) continue;
      for (const lot of block.houses) {
        building(add, lot);
        buildingCount++;
        cityLots.push(lot);
      }
      if (block.park) {
        cityPark(add, block.park);
        parkCount++;
        cityLots.push(block.park);
      }
      cityBlocks.push({ id: block.id, kind: block.kind, bounds: block.bounds,
        buildingArea: block.buildingArea, parkArea: block.parkArea });
    }
  });
  return { ...environment, buildingCount, parkCount, blocks: cityBlocks, lots: cityLots, roadsX, roadsZ, streetLights };
}

function decorationHash(value) {
  let hash = 2166136261;
  for (let n = 0; n < value.length; n++) hash = Math.imul(hash ^ value.charCodeAt(n), 16777619);
  return (hash >>> 0) / 4294967296;
}

export function createCityDecorations(environment, specs) {
  const placed = [];
  const anchors = [];
  for (const lot of environment.lots) {
    const key = `${lot.x}:${lot.z}`;
    if (lot.kind === 'building') {
      for (const [dx, dz] of [[0, .28], [-.27, -.28], [.27, .28]]) {
        anchors.push({ id: `${key}:roof:${dx}:${dz}`, placement: 'roof', lot,
          x: lot.x + dx * lot.width, z: lot.z + dz * lot.depth });
      }
    } else {
      for (const [dx, dz] of [[-.28, -.28], [.28, -.28], [-.28, .28], [.28, .28],
        [-.08, -.32], [.08, .32], [-.30, 0], [.30, 0]]) {
        const x = lot.x + dx * lot.width;
        const z = lot.z + dz * lot.depth;
        if (lot.pond && Math.hypot((x - lot.pond.x) / (lot.pond.radiusX + .6),
          (z - lot.pond.z) / (lot.pond.radiusZ + .6)) < 1) continue;
        anchors.push({ id: `${key}:park:${dx}:${dz}`, placement: 'park', lot,
          x, z });
      }
    }
    const block = lot.blockBounds;
    for (const [x, z] of [[block.minX + .75, lot.z], [block.maxX - .75, lot.z],
      [lot.x, block.minZ + .75], [lot.x, block.maxZ - .75]]) {
      if (environment.roadsX.some((road) => x + .5 > road.min && x - .5 < road.max)
        || environment.roadsZ.some((road) => z + .5 > road.min && z - .5 < road.max)) continue;
      anchors.push({ id: `${key}:pavement:${x}:${z}`, placement: 'pavement', lot, x, z });
    }
  }
  // Unique characters reserve their place before the smaller props are scattered around them.
  for (const spec of [...specs].sort((a, b) => Number(!!b.unique) - Number(!!a.unique))) {
    const placements = spec.placements || ['roof', 'park', 'pavement'];
    const candidates = anchors.filter((anchor) => placements.includes(anchor.placement)).map((anchor) => {
      const radius = spec.unique ? .2 : spec.height / (55 * COS_ELEVATION) * .38;
      const roof = anchor.lot.roof;
      const y = anchor.placement === 'roof'
        ? roof.base + roof.rise * Math.max(0, 1 - Math.max(0, Math.abs(anchor.x - anchor.lot.x) - radius) / (anchor.lot.width / 2))
        : anchor.placement === 'park' ? .245 : .225;
      const u = (anchor.x - anchor.z) / Math.sqrt(2);
      const v = (anchor.x + anchor.z) * GROUND_AXIS_Y - y * COS_ELEVATION;
      // Prefer a roof to the right of the stop for the single Sinterklaas: visible in both orientations.
      const score = spec.unique ? Math.hypot(u - 17, v + 2) + Math.hypot(anchor.x, anchor.z) * .02
        : decorationHash(`${spec.model}:${anchor.id}`);
      return { ...anchor, y, u, v, score };
    }).filter((anchor) => {
      const h = spec.height / 55;
      return !(anchor.u > -12 && anchor.u < 12 && anchor.v > -10 && anchor.v - h < 7);
    }).sort((a, b) => a.score - b.score);
    for (let n = 0; n < Math.min(spec.unique ? 1 : spec.count || 1, 80); n++) {
      const preferred = placements[n % placements.length];
      const free = (anchor) => placed.every((other) => Math.hypot(anchor.x - other.x,
        anchor.z - other.z, (anchor.y - other.y) * 2) > (spec.unique || other.unique ? 1.25 : .95));
      const anchor = spec.unique ? candidates.find(free)
        : candidates.find((candidate) => candidate.placement === preferred && free(candidate)) || candidates.find(free);
      if (!anchor) break;
      placed.push({ model: spec.model, height: spec.height, unique: !!spec.unique,
        x: anchor.x, y: anchor.y, z: anchor.z, placement: anchor.placement,
        angle: spec.unique ? Math.PI / 8 : decorationHash(anchor.id) * Math.PI / 2 });
    }
  }
  return placed;
}

function student(key) {
  const [, outfit = '', poseText = '0', variantText = '0'] = key.split('|');
  const pose = Number(poseText);
  const variant = Number(variantText);
  const shirt = outfit.includes('t-shirt') ? '#823cb5' : outfit.includes('sweater') ? '#b83445'
    : outfit.includes('kiel') ? '#5b8eba' : ['#28354e', '#34435d', '#58495f', '#35505b'][variant % 4];
  return model(1.65, (add) => {
    const skin = ['#e3b48e', '#b67e5c', '#8d5c45', '#edc8a5'][variant % 4];
    add('sphere', '#29363c', 0, .24, 0, .16, .48, .18, pose * .10);
    add('sphere', '#29363c', .2, .24, 0, .16, .48, .18, -pose * .10);
    add('sphere', '#acb3a3', .1, .008, 0, .65, .012, .4);
    add('box', shirt, .1, .82, 0, .46, .63, .29);
    add('sphere', shirt, -.20, .79, 0, .17, .55, .18, -pose * .10);
    add('sphere', shirt, .4, .79, 0, .17, .55, .18, pose * .10);
    add('sphere', skin, -.20, .52, -.02, .14, .16, .14);
    add('sphere', skin, .4, .52, .02, .14, .16, .14);
    add('box', '#635476', .1, .84, -.23, .36, .48, .22);
    add('sphere', skin, .1, 1.34, 0, .43, .48, .4);
    add('sphere', '#292a32', .1, 1.50, -.025, .46, .22, .43);
    if (outfit.includes('hat')) {
      const santa = outfit.includes('christmas');
      const carnival = outfit.includes('carnaval');
      const color = santa ? '#c94044' : carnival ? '#b176c8' : '#c64070';
      add('cylinder', santa ? '#faf1df' : '#f2c44f', .1, 1.58, 0, .52, .09, .50);
      add(santa ? 'cone' : 'sphere', color, .1, 1.75, 0, .46, .35, .43);
      if (santa) add('sphere', '#fff2dd', .1, 1.96, 0, .13, .13, .13);
      else add('sphere', '#f0d56a', .25, 1.99, 0, .12, .43, .09, 0, 0, -.4);
    }
  });
}

function bus(open) {
  return model(2.7, (add) => {
    add('sphere', '#57696c', .18, .018, .08, 2.4, .02, 5.9);
    add('box', '#e68b4f', 0, 1.38, 0, 2.0, 1.9, 5.65);
    add('box', '#f7efce', 0, 2.39, 0, 2.03, .18, 5.7);
    add('box', '#53687d', 0, .42, 0, 2.02, .22, 5.72);
    add('box', '#d2d7c8', 0, 2.55, -.3, .95, .22, 1.1);
    add('box', '#607b80', 0, 2.68, -.3, .62, .045, .65);
    for (const x of [-1.015, 1.015]) {
      for (let n = 0; n < 5; n++) {
        add('box', n % 2 ? '#81b0b9' : '#9fc7c8', x, 1.74, -2.19 + n * 1.06, .025, 1.03, .94);
        add('box', '#2d495c', x, 1.74, -2.71 + n * 1.06, .04, 1.13, .08);
      }
      add('box', '#2d495c', x, 1.15, 0, .04, .08, 5.5);
      for (const z of [-1.8, 1.8]) {
        add('cylinder', '#30343e', x, .46, z, .82, .19, .82, 0, 0, Math.PI / 2);
        add('cylinder', '#acb7bf', x * 1.105, .46, z, .44, .035, .44, 0, 0, Math.PI / 2);
        add('cylinder', '#667789', x * 1.13, .46, z, .18, .04, .18, 0, 0, Math.PI / 2);
      }
      add('box', '#31536c', x * 1.12, 1.95, 2.54, .20, .32, .16);
    }
    add('box', '#9fcdd0', 0, 1.67, 2.84, 1.78, 1.05, .025);
    add('box', '#2b4256', 0, 2.2, 2.86, 1.8, .23, .035);
    // Route display is geometry, including a tiny amber line of destination lettering.
    for (let n = 0; n < 9; n++) add('box', '#f7cd65', -.66 + n * .16, 2.2, 2.885, .09, .08, .012, 0, 0, 0, true);
    add('box', '#6a969f', 0, 1.75, -2.84, 1.8, .85, .025);
    add('box', '#efd15e', 0, .58, 2.87, .45, .13, .035);
    for (const x of [-.72, .72]) {
      add('box', '#fff0ba', x, .81, 2.86, .33, .18, .035, 0, 0, 0, true);
      add('box', '#ed6050', x, .78, -2.86, .2, .29, .035, 0, 0, 0, true);
      add('light', '#ffdf9c', x, .81, 2.91, .82, .82, 1);
      add('light', '#ff3020', x, .78, -2.91, .56, .56, 1);
    }
    // The bus faces +Z, so its right-hand boarding side is -X. Rotating the bus for
    // the return route puts these same doors beside the opposite pavement.
    for (const z of [-1.25, 1.9]) {
      add('box', '#294557', -1.035, 1.2, z, .035, 1.65, .65);
      for (const side of [-1, 1]) add('box', '#9fc9c9', -1.06 - (open ? .05 : 0), 1.4,
        z + side * (open ? .35 : .17), .035, 1.08, open ? .08 : .27);
    }
  });
}

function balloon(passengerCount) {
  return model(3.3, (add, parts) => {
    for (let n = 0; n < 8; n++) {
      const angle = n / 8 * Math.PI * 2;
      add('sphere', ['#b46a9e', '#eee1bd', '#6d9cae', '#dfac62'][n % 4], Math.sin(angle) * .42, 2.2, Math.cos(angle) * .42, 1.4, 2.1, 1.4);
    }
    add('cone', '#b38b62', 0, 1.15, 0, .3, .7, .3, Math.PI);

    // An open wicker basket: a recessed floor, four gently flared walls and a rounded rim.
    add('box', '#725337', 0, .09, 0, .71, .08, .49);
    for (const side of [-1, 1]) {
      add('box', '#ae8051', 0, .265, side * .285, .80, .30, .045, side * .14);
      add('box', '#ae8051', side * .375, .265, 0, .045, .30, .55, 0, 0, -side * .14);
      for (let row = 0; row < 4; row++) {
        const y = .16 + row * .067;
        const width = .71 + row * .027;
        const depth = .50 + row * .027;
        const color = row % 2 ? '#caa16b' : '#ddb781';
        add('box', color, 0, y, side * (depth / 2 + .017), width, .019, .023);
        add('box', color, side * (width / 2 + .017), y, 0, .023, .019, depth);
      }
      for (let n = -2; n <= 2; n++) add('box', '#8e673f', n * .14, .268,
        side * .311, .012, .28, .013, side * .14);
      for (let n = -1; n <= 1; n++) add('box', '#8e673f', side * .401, .268,
        n * .17, .013, .28, .012, 0, 0, -side * .14);
      add('cylinder', '#e1bb83', 0, .435, side * .315, .055, .84, .055, 0, 0, Math.PI / 2);
      add('cylinder', '#e1bb83', side * .42, .435, 0, .055, .63, .055, Math.PI / 2);
    }
    for (const x of [-.405, .405]) {
      for (const z of [-.30, .30]) {
        add('sphere', '#e1bb83', x, .435, z, .075, .065, .075);
        add('cylinder', '#8c7666', x, .73, z, .022, .61, .022);
      }
    }
    for (const z of [-.30, .30]) add('box', '#5b6263', 0, 1.035, z, .84, .035, .035);
    for (const x of [-.405, .405]) add('box', '#5b6263', x, 1.035, 0, .035, .035, .63);

    // Reuse the actual student models at basket scale; their lower bodies sit behind the walls.
    for (let n = 0; n < passengerCount; n++) {
      const centerX = passengerCount === 1 ? 0 : (n === 0 ? -.19 : .19);
      const scale = .43;
      const root = new THREE.Matrix4().makeScale(scale, scale, scale);
      root.setPosition(centerX - .1 * scale, .13, .015);
      for (const part of getModel(`student||0|${n * 2}`).parts) {
        const passengerPart = { ...part, matrix: new THREE.Matrix4().multiplyMatrices(root, part.matrix) };
        if (part.pixelPlane) passengerPart.pixelPlane = { ...part.pixelPlane,
          matrix: new THREE.Matrix4().multiplyMatrices(root, part.pixelPlane.matrix) };
        parts.push(passengerPart);
      }
      const skin = n === 0 ? '#e3b48e' : '#8d5c45';
      const shirt = n === 0 ? '#28354e' : '#58495f';
      for (const side of [-1, 1]) {
        // Hands rest on the rim, rather than hanging down inside the basket.
        add('sphere', shirt, centerX + side * .125, .465, .17, .075, .09, .28);
        add('sphere', skin, centerX + side * .125, .465, .32, .072, .065, .075);
        add('sphere', '#292a32', centerX + side * .044, .13 + 1.37 * scale,
          .015 + .20 * scale, .019, .023, .015);
      }
    }
  });
}

function willysJeep(add) {
  const olive = '#68734c';
  const edge = '#7c865b';
  const darkOlive = '#444e36';
  const rubber = '#292d2c';
  const tread = '#353a34';
  const canvas = '#999376';
  const stencil = '#eee9d3';

  // Road wheels and the rear spare share narrow military tyres, steel rims and tread blocks.
  const wheel = (x, y, z, side = 0) => {
    const rx = side ? 0 : Math.PI / 2;
    const rz = side ? Math.PI / 2 : 0;
    const faceX = x + side * .135;
    const faceZ = z - (side ? 0 : .135);
    add('cylinder', rubber, x, y, z, .69, .24, .69, rx, 0, rz);
    add('cylinder', tread, faceX, y, faceZ, .56, .025, .56, rx, 0, rz);
    add('cylinder', darkOlive, x + side * .153, y, z - (side ? 0 : .153), .41, .025, .41, rx, 0, rz);
    add('cylinder', edge, x + side * .17, y, z - (side ? 0 : .17), .34, .035, .34, rx, 0, rz);
    add('cylinder', darkOlive, x + side * .195, y, z - (side ? 0 : .195), .15, .06, .15, rx, 0, rz);
    for (let n = 0; n < 12; n++) {
      const a = n / 12 * Math.PI * 2;
      add('box', tread, x + (side ? 0 : Math.sin(a) * .345), y + Math.cos(a) * .345,
        z + (side ? Math.sin(a) * .345 : 0), side ? .265 : .12, .065, side ? .12 : .265,
        side ? a : 0, 0, side ? 0 : -a);
    }
    for (let n = 0; n < 5; n++) {
      const a = n / 5 * Math.PI * 2;
      add('sphere', '#b0ad8b', x + (side ? side * .196 : Math.sin(a) * .12),
        y + Math.cos(a) * .12, z + (side ? Math.sin(a) * .12 : -.196), .035, .035, .035);
    }
  };

  // Exposed ladder chassis, leaf springs and axles sit below a shallow, open body tub.
  for (const x of [-.45, .45]) add('box', darkOlive, x, .40, 0, .10, .14, 2.92);
  for (const z of [-1.02, 1.02]) {
    add('cylinder', rubber, 0, .37, z, .09, 1.49, .09, 0, 0, Math.PI / 2);
    add('sphere', darkOlive, 0, .37, z, .27, .23, .24);
    for (const side of [-1, 1]) {
      add('box', darkOlive, side * .46, .28, z, .085, .06, .66);
      wheel(side * .74, .375, z, side);
    }
  }
  add('box', olive, 0, .60, -.02, 1.40, .13, 2.94);
  add('box', darkOlive, 0, .68, -.49, 1.21, .045, 1.64);
  add('box', olive, 0, .91, -1.46, 1.44, .60, .09);
  for (const side of [-1, 1]) {
    add('box', olive, side * .65, .71, -.11, .13, .16, 1.02);
    add('box', edge, side * .75, .62, -.10, .29, .065, .74);
    add('box', olive, side * .54, .87, -1.03, .35, .47, .90);
    add('box', edge, side * .68, 1.13, -1.03, .33, .065, 1.04);
    add('box', olive, side * .71, .89, -.54, .09, .48, .14);
    add('box', olive, side * .71, .88, -1.45, .09, .47, .14);
    // Flat front wings and their sloping returns leave clear space above the front tyres.
    add('box', edge, side * .66, .97, 1.04, .39, .065, 1.24);
    add('box', olive, side * .84, .92, 1.08, .035, .13, 1.15);
    add('box', olive, side * .66, .83, .30, .39, .065, .43, -.65);
    add('box', darkOlive, side * .63, .53, 1.61, .10, .11, .37);
  }

  // The flat bonnet meets an upright nine-slot grille and small, recessed round headlights.
  add('box', olive, 0, .96, .28, 1.34, .59, .25);
  add('box', olive, 0, .94, .96, 1.08, .47, 1.15);
  add('box', edge, 0, 1.205, .94, 1.18, .06, 1.39);
  add('box', olive, 0, .93, 1.60, 1.20, .55, .075);
  for (let n = 0; n < 9; n++) {
    const x = (n - 4) * .084;
    add('box', '#283129', x, .90, 1.643, .045, .32, .014);
    for (const y of [.74, 1.06]) add('sphere', '#283129', x, y, 1.644, .045, .055, .018);
  }
  for (const side of [-1, 1]) {
    add('cylinder', darkOlive, side * .48, 1.045, 1.655, .253, .045, .253, Math.PI / 2);
    add('cylinder', '#dbcf9f', side * .48, 1.045, 1.683, .192, .022, .192, Math.PI / 2);
    add('sphere', '#f7efd3', side * .48 - .025, 1.08, 1.70, .085, .055, .017);
    add('box', darkOlive, side * .49, .78, 1.65, .14, .07, .035);
    add('box', '#c7b18a', side * .49, .77, 1.673, .09, .025, .014);
    add('box', darkOlive, side * .601, 1.10, .53, .025, .16, .05);
    add('box', '#adae8d', side * .617, 1.11, .53, .025, .07, .07);
    add('box', darkOlive, side * .34, 1.242, .36, .19, .025, .055);
  }
  add('box', edge, 0, .52, 1.81, 1.80, .16, .13);
  for (const side of [-1, 1]) add('box', darkOlive, side * .50, .48, 1.90, .09, .13, .10);
  add('cylinder', darkOlive, .69, 1.10, .85, .14, .23, .14, Math.PI / 2);
  add('box', '#a4aa88', .69, 1.09, .973, .095, .025, .014);

  // Flat primitive triangles form a five-point hood star without adding a texture or mesh type.
  for (let n = 0; n < 5; n++) {
    const a = n / 5 * Math.PI * 2;
    add('cone', stencil, Math.sin(a) * .244, 1.24, .99 + Math.cos(a) * .244,
      .171, .253, .007, Math.PI / 2, 0, -a);
    add('cone', stencil, Math.sin(a) * .05875, 1.24, .99 + Math.cos(a) * .05875,
      .171, .1175, .007, Math.PI / 2, 0, Math.PI - a);
  }

  // Separate cushions and seat backs keep the footwells and door openings genuinely open.
  for (const x of [-.34, .34]) {
    for (const z of [-.08, -.47]) add('box', darkOlive, x, .74, z, .40, .16, .04);
    add('box', canvas, x, .84, -.25, .49, .14, .53);
    add('box', canvas, x, 1.08, -.52, .49, .46, .13, -.12);
    add('box', '#79785c', x, .91, -.51, .43, .035, .15);
  }
  add('box', canvas, 0, 1.10, -1.02, 1.06, .13, .43);
  add('box', canvas, 0, 1.30, -1.34, 1.08, .36, .13, -.06);
  add('cylinder', canvas, 0, 1.47, -1.38, .16, 1.15, .16, 0, 0, Math.PI / 2);
  for (const x of [-.37, .37]) add('cylinder', darkOlive, x, 1.47, -1.38, .175, .055, .175, 0, 0, Math.PI / 2);

  add('box', olive, 0, 1.09, .18, 1.26, .30, .075);
  for (const [x, diameter] of [[.12, .13], [-.07, .075], [-.23, .075], [.29, .075]]) {
    add('cylinder', '#b0b29b', x, 1.12, .135, diameter, .02, diameter, Math.PI / 2);
    add('cylinder', rubber, x, 1.12, .12, diameter * .76, .014, diameter * .76, Math.PI / 2);
    add('box', stencil, x, 1.13, .109, .012, diameter * .44, .008, 0, 0, -.5);
  }
  add('box', darkOlive, -.47, 1.08, .133, .30, .18, .015);
  add('box', '#a3a58a', -.47, 1.09, .12, .065, .025, .015);
  add('cylinder', darkOlive, .34, 1.04, .065, .035, .39, .035, -.92);
  for (let n = 0; n < 12; n++) {
    const a = n / 12 * Math.PI * 2;
    add('cylinder', rubber, .34 + Math.cos(a) * .18, 1.16 + Math.sin(a) * .143,
      -.09 + Math.sin(a) * .109, .028, .10, .028, .65, 0, a);
  }
  for (let n = 0; n < 3; n++) {
    const a = n / 3 * Math.PI * 2;
    add('cylinder', darkOlive, .34 + Math.cos(a) * .09, 1.16 + Math.sin(a) * .0715,
      -.09 + Math.sin(a) * .0545, .023, .18, .023, .65, 0, a - Math.PI / 2);
  }
  add('sphere', rubber, .34, 1.16, -.09, .065, .065, .065);
  for (const [x, h] of [[.03, .30], [-.11, .20]]) {
    add('cylinder', darkOlive, x, .73 + h / 2, -.16, .018, h, .018, -.22);
    add('sphere', rubber, x, .73 + h, -.16 - h * .11, .06, .06, .06);
  }

  // Split upright windscreen: open panes with a few glints preserve the view into the cabin.
  add('box', olive, 0, 1.31, .28, 1.38, .17, .07);
  for (const x of [-.66, 0, .66]) add('box', edge, x, 1.64, .28, x === 0 ? .035 : .055, .56, .055);
  add('box', edge, 0, 1.93, .28, 1.38, .055, .06);
  add('box', darkOlive, 0, 1.39, .28, 1.28, .025, .065);
  for (const side of [-1, 1]) {
    add('box', '#c3d8ce', side * .33, 1.70, .29, .022, .31, .018, 0, 0, -.42);
    add('box', '#c3d8ce', side * .33 + .08, 1.78, .29, .015, .14, .018, 0, 0, -.42);
    add('box', rubber, side * .32, 1.46, .32, .24, .022, .02, 0, 0, side * .20);
    add('box', darkOlive, side * .69, 1.29, .28, .07, .18, .10);
  }
  add('cylinder', darkOlive, .79, 1.58, .28, .024, .30, .024, 0, 0, -.42);
  add('sphere', darkOlive, .86, 1.75, .28, .16, .20, .055);
  add('sphere', '#a8bdb6', .86, 1.75, .315, .12, .16, .025);

  // Rear spare, strapped jerrycan, bumperettes and lamps make it readable from behind.
  add('box', darkOlive, -.27, 1.02, -1.59, .22, .24, .23);
  wheel(-.27, 1.03, -1.72);
  add('box', darkOlive, .48, 1.03, -1.64, .36, .55, .22);
  add('box', edge, .48, 1.04, -1.76, .28, .44, .025);
  for (const angle of [-.57, .57]) add('box', olive, .48, 1.04, -1.779, .035, .43, .016, 0, 0, angle);
  add('box', '#565c3e', .48, 1.04, -1.79, .055, .56, .02);
  for (const x of [.40, .56]) add('box', darkOlive, x, 1.35, -1.63, .04, .09, .06);
  add('box', darkOlive, .48, 1.40, -1.63, .20, .04, .06);
  add('cylinder', edge, .58, 1.32, -1.69, .065, .04, .065);
  for (const side of [-1, 1]) {
    add('box', edge, side * .55, .53, -1.62, .33, .15, .20);
    add('cylinder', darkOlive, side * .61, .79, -1.521, .11, .035, .11, Math.PI / 2);
    add('cylinder', '#9f3f36', side * .61, .79, -1.545, .075, .02, .075, Math.PI / 2);
    add('box', darkOlive, side * .77, 1.06, -1.27, .04, .035, .26);
    for (const z of [-1.38, -1.16]) add('box', darkOlive, side * .745, 1.03, z, .075, .08, .035);
  }
  add('box', darkOlive, 0, .43, -1.60, .17, .12, .20);
  // Pioneer tools secured to the driver's side, beneath the rear grab handle.
  add('box', '#a08c5e', .79, .91, -.98, .035, .04, .65);
  add('sphere', '#777e65', .79, .91, -1.34, .045, .17, .25);
  add('box', '#a08c5e', .79, 1.02, -.97, .035, .035, .63);
  add('box', '#777e65', .79, 1.02, -.63, .05, .15, .16);
  for (const z of [-1.15, -.84]) add('box', darkOlive, .815, .97, z, .035, .19, .04);

  // Rear-mounted Dutch tricolours fly outwards, leaving the open cabin and spare visible.
  for (const side of [-1, 1]) {
    add('cylinder', darkOlive, side * .74, 1.85, -1.40, .028, 1.43, .028);
    add('sphere', '#bcb492', side * .74, 2.59, -1.40, .075, .075, .075);
    for (const y of [1.15, 1.30]) add('cylinder', edge, side * .74, y, -1.40, .085, .055, .085);
    for (let n = 0; n < 5; n++) {
      const x0 = side * (.755 + n * .13);
      const x1 = side * (.755 + (n + 1) * .13);
      const z0 = -1.40 + Math.sin(n / 5 * Math.PI * 1.7) * .075;
      const z1 = -1.40 + Math.sin((n + 1) / 5 * Math.PI * 1.7) * .075;
      const angle = -Math.atan2(z1 - z0, x1 - x0);
      ['#c23b43', '#f7f3e6', '#2c4d91'].forEach((color, band) => {
        add('box', color, (x0 + x1) / 2, 2.48 - (band + .5) * .135 - n * .009,
          (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) + .006, .135, .014, 0, angle);
      });
    }
  }
}

function paradeFloat(add) {
  const red = '#dc3049';
  const yellow = '#ffd34e';
  const green = '#21a878';
  const gold = '#edac32';
  const cream = '#fff2d5';
  const ink = '#29263d';

  // A low, skirted wagon carries the sculptures; only the bottoms of its wheels show.
  add('box', ink, 0, .36, 0, 2.12, .25, 3.7);
  for (const side of [-1, 1]) {
    for (const z of [-1.35, 1.35]) {
      add('cylinder', ink, side * 1.04, .34, z, .68, .22, .68, 0, 0, Math.PI / 2);
      add('cylinder', gold, side * 1.17, .34, z, .30, .035, .30, 0, 0, Math.PI / 2);
    }
  }
  add('box', green, 0, .78, 0, 2.45, .69, 4.1);
  add('box', red, 0, 1.08, 0, 2.55, .14, 4.22);
  add('box', gold, 0, .46, 0, 2.53, .12, 4.18);
  add('sphere', red, 0, .74, 2.02, 2.64, .64, .55);
  add('sphere', yellow, 0, 1.04, 2.04, 2.62, .16, .56);
  for (const side of [-1, 1]) {
    for (let n = 0; n < 9; n++) {
      const z = -1.8 + n * .45;
      add('box', n % 2 ? red : yellow, side * 1.237, .78, z, .035, .27, .27, Math.PI / 4);
      add('sphere', gold, side * 1.25, .48, z, .13, .20, .32);
      add('sphere', cream, side * 1.29, 1.1, z, .09, .09, .09, 0, 0, 0, true);
    }
    for (let n = 0; n < 5; n++) {
      add('sphere', cream, -.94 + n * .47, 1.12, side * 2.12, .09, .09, .09, 0, 0, 0, true);
    }
  }
  // Stepped plinth and large curled flourishes give the rear a finished silhouette too.
  add('box', '#743f9e', 0, 1.25, -.75, 1.8, .30, 1.9);
  add('box', yellow, 0, 1.43, -.75, 1.65, .10, 1.76);
  for (const side of [-1, 1]) {
    for (let n = 0; n < 11; n++) {
      const a = n / 10 * Math.PI * 1.65;
      const radius = .52 - n * .025;
      add('sphere', n < 5 ? red : yellow, side * (1.02 + Math.cos(a) * radius),
        1.65 + Math.sin(a) * radius, -1.5, .23, .23, .22);
    }
    add('box', ink, side * .88, 1.67, -1.68, .42, .7, .40);
    for (const y of [1.49, 1.81]) {
      add('cylinder', gold, side * 1.10, y, -1.68, .26, .035, .26, 0, 0, Math.PI / 2);
      add('cylinder', ink, side * 1.13, y, -1.68, .17, .04, .17, 0, 0, Math.PI / 2);
    }
  }

  // Oversized, laughing Carnaval jester, sculpted in the same shared primitives as the city.
  add('sphere', red, -.31, 2.08, -.87, .9, 1.32, .95, 0, 0, -.12);
  add('sphere', green, .31, 2.08, -.87, .9, 1.32, .95, 0, 0, .12);
  for (const y of [1.8, 2.12, 2.44]) add('sphere', yellow, 0, y, -.32, .17, .17, .09);
  for (const side of [-1, 1]) {
    add('sphere', side < 0 ? green : red, side * .68, 1.55, -.40, .73, .35, .82, 0, side * .25);
    add('sphere', yellow, side * .9, 1.65, -.08, .24, .28, .30);
    const sleeve = side < 0 ? red : green;
    add('sphere', sleeve, side * .85, 2.46, -.85, .49, .87, .50, 0, 0, side * .7);
    add('sphere', sleeve, side * 1.19, 2.83, -.77, .40, .74, .42, 0, 0, -side * .35);
    add('sphere', cream, side * 1.29, 3.12, -.72, .44, .19, .44);
    add('sphere', '#f4bd91', side * 1.31, 3.34, -.70, .39, .43, .26, 0, 0, side * .12);
    for (let n = 0; n < 3; n++) {
      add('sphere', '#f4bd91', side * (1.19 + n * .12), 3.56 - n * .035, -.70, .10, .29, .12,
        0, 0, -side * (.15 + n * .15));
    }
    add('sphere', '#f4bd91', side * 1.08, 3.31, -.60, .17, .25, .17, 0, 0, side * .6);
  }
  add('sphere', cream, 0, 2.73, -.83, 1.5, .23, 1.1);
  for (const x of [-.54, 0, .54]) {
    add('cone', yellow, x, 2.53, -.27, .40, .46, .17, Math.PI);
    add('sphere', gold, x, 2.30, -.27, .13, .13, .13);
  }
  add('sphere', '#a45a32', 0, 3.62, -.96, 1.76, 1.63, 1.18);
  add('sphere', '#f4bd91', 0, 3.61, -.78, 1.59, 1.60, 1.12);
  for (const side of [-1, 1]) {
    add('sphere', '#f4bd91', side * .82, 3.61, -.80, .30, .43, .30);
    add('sphere', '#de8b79', side * .85, 3.61, -.63, .13, .25, .08);
    add('sphere', '#ed8d83', side * .54, 3.49, -.30, .44, .32, .22);
    add('sphere', cream, side * .32, 3.92, -.29, .43, .51, .20, 0, 0, -side * .12);
    add('sphere', '#389d9c', side * .30, 3.91, -.18, .22, .29, .08);
    add('sphere', ink, side * .29, 3.92, -.13, .12, .19, .06);
    add('sphere', '#ffffff', side * .29 - .035, 3.98, -.09, .055, .065, .025);
    add('sphere', '#814528', side * .34, 4.18, -.28, .48, .12, .14, 0, 0, side * .16);
    add('sphere', '#a45a32', side * .67, 4.04, -.65, .27, .52, .37, 0, 0, -side * .25);
  }
  add('sphere', red, 0, 3.32, -.25, 1.02, .65, .24);
  add('sphere', ink, 0, 3.34, -.10, .81, .43, .11);
  add('sphere', '#f2768c', 0, 3.21, -.025, .48, .14, .09);
  add('box', cream, 0, 3.47, -.015, .66, .13, .08);
  add('sphere', '#efa77e', 0, 3.72, -.09, .37, .34, .40);
  // Three unmistakable floppy hat points, with gold bells rather than a party cone.
  add('sphere', red, -.35, 4.35, -.85, 1.02, .65, 1.17);
  add('sphere', green, .35, 4.35, -.85, 1.02, .65, 1.17);
  add('cylinder', gold, 0, 4.23, -.85, 1.69, .14, 1.22);
  for (const side of [-1, 1]) {
    add('cone', side < 0 ? red : green, side * .81, 4.62, -.85, .77, 1.0, .78, 0, 0, -side * .95);
    add('sphere', yellow, side * 1.23, 4.91, -.85, .26, .26, .26);
  }
  add('cone', yellow, 0, 4.77, -.91, .67, .95, .68, -.18);
  add('sphere', gold, 0, 5.25, -1.0, .24, .24, .24);

  // The front sculpture echoes the huge, toothy papier-mâché cows of Dutch optochten.
  add('sphere', cream, 0, 2.12, 1.10, 1.83, 1.83, 1.29);
  for (const side of [-1, 1]) {
    add('sphere', cream, side * .94, 2.61, 1.11, .67, .37, .38, 0, 0, side * .3);
    add('sphere', '#ed8d9d', side * 1.01, 2.62, 1.29, .39, .18, .12, 0, 0, side * .3);
    add('sphere', gold, side * .73, 2.92, 1.02, .25, .57, .25, 0, 0, -side * .48);
    add('cone', '#ffe2a0', side * .91, 3.16, 1.02, .26, .47, .25, 0, 0, side * .35);
    add('sphere', ink, side * .73, 2.20, 1.51, .31, .45, .13, 0, 0, side * .4);
    add('sphere', ink, side * .55, 2.76, 1.54, .38, .25, .11, 0, 0, side * .25);
    add('sphere', '#ffffff', side * .38, 2.48, 1.66, .58, .70, .24, 0, 0, -side * .12);
    add('sphere', '#51afd3', side * .36, 2.47, 1.80, .30, .42, .09);
    add('sphere', ink, side * .35, 2.47, 1.86, .17, .29, .07);
    add('sphere', '#ffffff', side * .35 - .045, 2.56, 1.90, .075, .10, .025);
    add('sphere', ink, side * .39, 2.86, 1.67, .60, .12, .15, 0, 0, side * .17);
  }
  add('sphere', '#ed718f', 0, 1.56, 1.75, 1.72, 1.05, .57);
  add('sphere', ink, 0, 1.57, 2.04, 1.45, .78, .17);
  add('sphere', '#e63d59', 0, 1.27, 2.12, .80, .18, .23);
  for (let n = 0; n < 6; n++) {
    const x = (n - 2.5) * .215;
    add('box', cream, x, 1.76 + Math.abs(x) * .12, 2.14, .195, .26, .13, 0, 0, x * .24);
  }
  add('sphere', '#f18ca6', 0, 2.02, 1.88, 1.70, .52, .60);
  for (const side of [-1, 1]) {
    add('sphere', '#a93d64', side * .47, 2.09, 2.15, .30, .14, .08, 0, 0, side * .2);
    add('sphere', '#ffb3bf', side * .25, 2.18, 2.12, .32, .10, .06);
  }
  add('sphere', red, 0, 3.02, 1.03, 1.25, .46, 1.0);
  add('sphere', red, 0, 2.91, 1.30, 1.45, .13, 1.14);
  add('box', gold, 0, 3.07, 1.50, .29, .31, .08, 0, 0, -.12);
  add('sphere', green, 0, 3.08, 1.56, .14, .19, .035);
}

function prop(key) {
  const name = key.split('/').pop();
  if (name === 'parade-car') return model(5.4, paradeFloat);
  if (name === 'jeep') return model(2.63, willysJeep);
  return model(name === 'flag' ? 2 : name === 'sinterklaas' ? 2.8 : name.includes('bunny') ? 1.5 : 1, (add) => {
    if (name.startsWith('present')) {
      const n = Number(name.slice(-1)) || 1;
      const color = ['#cf5375', '#68ab91', '#7b69b3', '#e4b24e'][n - 1];
      add('box', color, 0, .43, 0, .9, .8, .8);
      add('box', color, 0, .86, 0, 1, .12, .9);
      add('box', '#f6d878', 0, .5, 0, .13, .88, .92);
      add('box', '#f6d878', 0, .5, 0, 1.02, .88, .12);
      for (const x of [-.16, .16]) add('sphere', '#f6d878', x, .99, 0, .33, .19, .22, 0, 0, x * 2);
    } else if (name.startsWith('pumpkin')) {
      for (let n = 0; n < 7; n++) {
        const angle = n / 7 * Math.PI * 2;
        add('sphere', n % 2 ? '#d97a2c' : '#ec9039', Math.sin(angle) * .19, .43, Math.cos(angle) * .19, .65, .78, .65);
      }
      add('cylinder', '#6c8046', 0, .89, 0, .12, .23, .12, 0, 0, .2);
      for (const x of [-.19, .19]) add('cone', '#473b30', x, .52, .45, .17, .17, .035);
      add('box', '#473b30', 0, .29, .45, .30, .08, .04);
    } else if (name === 'sinterklaas') {
      // A complete figure underneath the vestments: shoes, robe, shoulders, arms and hands.
      for (const x of [-.19, .19]) add('box', '#39343c', x, .08, .1, .25, .16, .4);
      add('cone', '#f2e9d4', 0, .77, 0, 1.0, 1.28, .72);
      add('sphere', '#f2e9d4', 0, 1.34, 0, .76, .78, .48);
      add('box', '#b83e4d', 0, .97, -.24, .79, 1.42, .12); // long red cape
      for (const side of [-1, 1]) {
        add('sphere', '#bf4251', side * .31, 1.43, -.06, .35, .56, .44, 0, 0, side * .17);
        add('box', '#bf4251', side * .27, 1.02, .23, .19, 1.02, .08);
        add('box', '#e8c56c', side * .19, 1.02, .28, .045, 1.04, .025);
      }
      // One forearm reaches towards the staff; the other rests by his side.
      add('sphere', '#f2e9d4', -.43, 1.12, .08, .24, .59, .25, 0, 0, -.18);
      add('sphere', '#edc19d', -.47, .84, .12, .18, .22, .18);
      add('sphere', '#f2e9d4', .47, 1.24, .07, .24, .53, .25, 0, 0, .55);
      add('sphere', '#edc19d', .59, 1.06, .14, .19, .21, .19);
      add('sphere', '#edc19d', 0, 1.78, 0, .22, .25, .22); // neck
      add('sphere', '#f4eedd', 0, 2.03, -.06, .62, .62, .46); // white hair
      add('sphere', '#edc19d', 0, 2.04, .1, .50, .53, .45);
      for (const x of [-.27, .27]) add('sphere', '#edc19d', x, 2.03, .07, .13, .18, .14);
      add('sphere', '#f7f0de', 0, 1.82, .25, .52, .46, .23); // full beard below face
      add('cone', '#f7f0de', 0, 1.60, .25, .36, .42, .22, Math.PI);
      for (const x of [-.11, .11]) {
        add('sphere', '#43404a', x, 2.09, .31, .055, .065, .035);
        add('box', '#f7f0de', x, 2.17, .31, .13, .035, .025);
        add('sphere', '#fff5e0', x, 1.96, .33, .24, .10, .11, 0, 0, x * .8);
      }
      add('sphere', '#dfab87', 0, 2.03, .35, .13, .14, .13);
      // Tall bishop's mitre with a gold band and cross, rather than a party hat.
      add('box', '#c43f4b', 0, 2.39, -.02, .58, .28, .34);
      add('cone', '#c43f4b', 0, 2.65, -.02, .65, .47, .36);
      add('box', '#f2ce74', 0, 2.28, .16, .6, .075, .035);
      add('box', '#f2ce74', 0, 2.52, .17, .065, .36, .035);
      add('box', '#f2ce74', 0, 2.55, .17, .27, .065, .035);
      add('cylinder', '#d8ae55', .63, 1.24, .12, .045, 2.46, .045);
      // Segmented crook stays in the same instanced primitive batches as the rest of the scene.
      for (let n = 0; n < 10; n++) {
        const a = n / 9 * Math.PI * 1.65;
        add('sphere', '#e8c46c', .46 + Math.cos(a) * .17, 2.47 + Math.sin(a) * .17, .12, .065, .065, .065);
      }
    } else if (name.includes('bunny')) {
      const color = name.startsWith('choco') ? '#704b39' : '#e6e4d5';
      add('sphere', color, 0, .43, 0, .65, .85, .65);
      add('sphere', color, 0, 1, .08, .53, .53, .5);
      for (const x of [-.16, .16]) {
        add('sphere', color, x, 1.41, .02, .18, .65, .19, 0, 0, x * 1.1);
        add('sphere', '#38343d', x, 1.07, .31, .06, .06, .04);
      }
      add('sphere', '#dc9a9c', 0, .95, .34, .1, .07, .05);
      add('sphere', color, 0, .3, -.36, .28, .28, .28);
    } else if (name === 'flag') {
      add('cylinder', '#9b7856', 0, 1, 0, .055, 2, .055);
      ['#cf5862', '#f3edda', '#4f6caa'].forEach((color, n) => add('box', color, .38, 1.83 - n * .18, 0, .76, .18, .035));
    } else if (name === 'flowers') {
      add('cone', '#9a6d53', 0, .19, 0, .5, .38, .5, Math.PI);
      for (let n = 0; n < 5; n++) {
        const x = Math.sin(n * 2.4) * .23;
        const z = Math.cos(n * 2.4) * .23;
        add('cylinder', '#69945b', x, .52, z, .035, .65, .035);
        add('sphere', n % 2 ? '#ecc45b' : '#bd6b9b', x, .89, z, .31, .17, .31);
      }
    } else {
      // Easter eggs, nests and the hatching chick.
      const chick = name.includes('chick');
      const multiple = name === 'eggs';
      for (let n = 0; n < (multiple ? 3 : 1); n++) {
        const x = multiple ? (n - 1) * .37 : 0;
        add('sphere', chick ? '#f0d274' : ['#b692c7', '#86b9a5', '#d98fa5'][n], x, .46, 0, .6, .91, .6);
        add('sphere', '#f0e3b9', x, .4, .01, .61, .13, .61);
        if (chick) {
          add('cone', '#de9843', x, .65, .36, .12, .2, .12, Math.PI / 2);
          for (const eye of [-.13, .13]) add('sphere', '#38343d', eye, .73, .27, .05, .05, .05);
        }
      }
    }
  });
}

export function getModelPreviews() {
  return [
    ...['bus', 'bus-open', 'balloon-1', 'balloon-2'].map((key) => ({ key, group: 'Vehicles', create: () => getModel(key) })),
    { key: 'student', group: 'People', create: () => getModel('student||0|0') },
    ...['sinterklaas/sinterklaas', ...[1, 2, 3, 4].map((n) => `sinterklaas/present${n}`),
      ...[1, 2, 3].map((n) => `halloween/pumpkin${n}`),
      'easter/egg', 'easter/eggs', 'easter/egg-chick', 'easter/choco-bunny', 'easter/bunny',
      'bevrijdingsdag/flag', 'bevrijdingsdag/flowers', 'bevrijdingsdag/jeep', 'carnaval/parade-car']
      .map((key) => ({ key, group: 'Props', create: () => getModel(key) })),
    { key: 'scenery', group: 'City', create: () => scenery },
    { key: 'shelter', group: 'City', create: () => model(3.3, shelter) },
    { key: 'stop-tree', group: 'City', create: () => model(7, stopTree) },
    { key: 'stop', group: 'City', create: () => model(3.2, (add) => stop(add, 0, 0)) },
    { key: 'tree', group: 'City', create: () => model(5.25, (add) => cityTree(add, 0, 0, 5, lotRandom(1, 1), 0)) },
    { key: 'tree-2', group: 'City', create: () => model(5.25, (add) => cityTree(add, 0, 0, 5, lotRandom(1, 1), 1)) },
    { key: 'street-lamp', group: 'City', create: () => model(5, (add) => streetLamp(add, 1.3, 0, 0)) },
    { key: 'bench', group: 'City', create: () => model(1.3, (add) => parkBench(add, 0, 0)) },
    { key: 'building', group: 'City', create: () => model(7, (add) => building(add,
      { x: 0, z: 0, width: 6, depth: 8, height: 6.35, floors: 3, random: lotRandom(1, 1) })) },
    { key: 'park', group: 'City', create: () => model(5, (add) => cityPark(add,
      { x: 0, z: 0, width: 16, depth: 20, random: lotRandom(1, 1) })) },
  ];
}

export function getModel(key) {
  if (!cache.has(key)) cache.set(key, key.startsWith('student|') ? student(key)
    : key === 'balloon' || key.startsWith('balloon-') ? balloon(key === 'balloon-1' ? 1 : 2)
    : key.startsWith('bus') ? bus(key === 'bus-open') : prop(key));
  return cache.get(key);
}
