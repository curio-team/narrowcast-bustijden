import * as THREE from './vendor/three.module.min.js';

// Every model is a small list of transformed, shared primitives. No textures or asset downloads.
const cache = new Map();
const colors = new Map();
const rotation = new THREE.Quaternion();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const euler = new THREE.Euler();

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
  build(add);
  return { height, parts };
}

function stop(add, x, z) {
  add('cylinder', '#71858d', x, 1.25, z, .10, 2.5, .10);
  add('box', '#284d69', x, 2.65, z, .12, 1.05, .65);
  add('box', '#f5cf4d', x + .07, 2.57, z, .025, .68, .52);
  add('box', '#e8f3ef', x + .07, 2.98, z, .025, .15, .52);
  for (let n = 0; n < 3; n++) add('box', '#987f45', x + .09, 2.7 - n * .15, z, .02, .035, .38);
}

export const scenery = model(7, (add) => {
  add('box', '#637f87', 0, -.22, 0, 16, .45, 11.4);
  for (const [x, width] of [[-5, 6], [1.65, 1.1], [6.75, 2.5]]) {
    add('box', '#c6c5ac', x, .02, 0, width, .32, 11.4);
    const columns = Math.round(width / .8);
    for (let ix = 0; ix < columns; ix++) {
      for (let iz = 0; iz < 14; iz++) {
        const tone = (ix + iz) % 3 === 0 ? '#eee9cf' : '#e2dfc8';
        add('box', tone, x - width / 2 + (ix + .5) * width / columns, .20,
          -5.7 + (iz + .5) * 11.4 / 14, width / columns - .035, .05, 11.4 / 14 - .035);
      }
    }
  }
  for (const x of [-1.94, 1.04, 2.26, 5.43]) {
    for (let iz = 0; iz < 14; iz++) add('box', '#f5edd1', x, .012, -5.3 + iz * .81, .075, .02, .66);
  }
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
    }
    for (const z of [-1.25, 1.9]) {
      add('box', '#294557', 1.035, 1.2, z, .035, 1.65, .65);
      for (const side of [-1, 1]) add('box', '#9fc9c9', 1.06 + (open ? .05 : 0), 1.4,
        z + side * (open ? .35 : .17), .035, 1.08, open ? .08 : .27);
    }
  });
}

function prop(key) {
  const name = key.split('/').pop().replace('.png', '');
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
    } else if (name === 'balloon') {
      for (let n = 0; n < 8; n++) {
        const angle = n / 8 * Math.PI * 2;
        add('sphere', ['#b46a9e', '#eee1bd', '#6d9cae', '#dfac62'][n % 4], Math.sin(angle) * .42, 2.2, Math.cos(angle) * .42, 1.4, 2.1, 1.4);
      }
      add('cone', '#b38b62', 0, 1.15, 0, .3, .7, .3, Math.PI);
      add('box', '#9e7856', 0, .25, 0, .6, .4, .5);
      for (const x of [-.23, .23]) add('cylinder', '#8c7666', x, .7, 0, .025, .7, .025);
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
    : key.startsWith('bus') ? bus(key === 'bus-open') : prop(key));
  return cache.get(key);
}
