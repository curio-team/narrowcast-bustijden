import * as THREE from './vendor/three.module.min.js';
import { COS_ELEVATION, GROUND_AXIS_Y } from './projection3d.js';

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
    parts.push({ shape: glow ? `${shape}-glow` : shape, color: colors.get(color),
      matrix: new THREE.Matrix4().compose(position, rotation, scale) });
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

// The stop itself stays fixed. Viewport-sized ground and city blocks are generated separately.
export const scenery = model(7, (add) => {
  // Tree, planter and the recognisable blue shelter with its orange bench.
  add('box', '#65735d', -6.4, .37, 2.8, 2.25, .35, 2.25);
  add('sphere', '#719650', -6.4, .65, 2.8, 2.2, .7, 2.2);
  add('cylinder', '#aa6946', -6.4, 2.1, 2.8, .52, 3.0, .52);
  add('cylinder', '#c98956', -6.12, 2.8, 2.8, .23, 1.6, .23, 0, 0, -.4);
  add('sphere', '#6b9d57', -6.4, 4.7, 2.8, 3.5, 3.8, 3.4);
  add('sphere', '#91b95a', -6.8, 5.25, 3.0, 2.6, 2.5, 2.6);
  add('sphere', '#b2cd70', -7.15, 5.8, 3.05, 1.35, 1.15, 1.3);
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
    minZ: row * 36 - 15.9, maxZ: row * 36 + 15.9 };
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
      add('box', '#ded7c6', wx, y, z + depth / 2 + .025, .87, 1.12, .055);
      add('box', glass, wx, y + .035, z + depth / 2 + .06, .68, .88, .025);
    }
    for (let column = 0; column < sideColumns; column++) {
      const wz = z - depth / 2 + (column + .5) * depth / sideColumns;
      add('box', '#ded7c6', x + width / 2 + .025, y, wz, .055, 1.12, .87);
      add('box', '#748d96', x + width / 2 + .06, y + .035, wz, .025, .88, .68);
    }
  }
  add('box', '#4e6268', x, .99, z + depth / 2 + .09, .82, 1.75, .08);
  add('box', '#d5c9b0', x, 1.93, z + depth / 2 + .13, 1.05, .12, .18);
}

function cityTree(add, x, z, height, random) {
  const green = ['#789b61', '#8eab68', '#679675', '#99ad69'][Math.floor(random() * 4)];
  add('sphere', '#7f9769', x + .25, .24, z + .15, height * .65, .02, height * .5);
  add('cylinder', '#967455', x, .225 + height * .25, z, .19, height * .5, .19);
  add('sphere', green, x, .225 + height * .67, z, height * .62, height * .64, height * .59);
  add('sphere', '#a8bc7b', x - height * .09, .225 + height * .87, z + height * .04,
    height * .40, height * .35, height * .39);
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
      const z = 18 + n * 36;
      if (z + 2.1 > bounds.minZ && z - 2.1 < bounds.maxZ) roadsZ.push({ min: z - 2.1, max: z + 2.1 });
    }
    const pavedX = gaps(bounds.minX, bounds.maxX, roadsX);
    const pavedZ = gaps(bounds.minZ, bounds.maxZ, roadsZ);
    for (const x of pavedX) {
      for (const z of pavedZ) add('paving', '#e2dfc8', (x.min + x.max) / 2, .065,
        (z.min + z.max) / 2, x.max - x.min, .32, z.max - z.min);
    }
    // Pale kerbs and zebra crossings connect the extended footpaths at side streets.
    for (const z of pavedZ) {
      for (const x of [-1.96, 1.06, 2.24, 5.46]) add('box', '#f3ecd4', x, .229,
        (z.min + z.max) / 2, .075, .018, z.max - z.min);
    }
    for (const street of roadsZ) {
      const z = (street.min + street.max) / 2;
      for (let x = Math.ceil(bounds.minX / 3) * 3; x < bounds.maxX; x += 3) {
        if (roadsX.some((road) => x + .6 > road.min && x - .6 < road.max)) continue;
        add('box', '#dce0ce', x, .017, z, 1.2, .012, .075);
      }
      for (const x of [-3.4, 6.9]) {
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
    add('box', '#253039', 0, .055, .06 + pose * .04, .18, .11, .29);
    add('box', '#253039', .2, .055, .06 - pose * .04, .18, .11, .29);
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
        parts.push({ ...part, matrix: new THREE.Matrix4().multiplyMatrices(root, part.matrix) });
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

function prop(key) {
  const name = key.split('/').pop();
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
    } else if (name === 'jeep' || name === 'parade-car') {
      const parade = name === 'parade-car';
      add('box', parade ? '#a966b3' : '#6f7c56', 0, .55, 0, 1.2, .5, 2.1);
      add('box', parade ? '#e1b95b' : '#6f7c56', 0, .97, -.45, 1.12, .45, .7);
      add('box', '#b4d6d5', 0, 1.14, .03, 1.06, .5, .06, .15);
      for (const x of [-.62, .62]) for (const z of [-.7, .7]) add('cylinder', '#30343e', x, .3, z, .54, .14, .54, 0, 0, Math.PI / 2);
      if (parade) {
        add('cone', '#eac35d', 0, 1.6, -.4, .8, 1.1, .8);
        for (const x of [-.6, .6]) add('sphere', '#d477a3', x, 1.6, -.6, .6, .65, .6);
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

export function getModel(key) {
  if (!cache.has(key)) cache.set(key, key.startsWith('student|') ? student(key)
    : key === 'balloon' || key.startsWith('balloon-') ? balloon(key === 'balloon-1' ? 1 : 2)
    : key.startsWith('bus') ? bus(key === 'bus-open') : prop(key));
  return cache.get(key);
}
