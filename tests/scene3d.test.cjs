const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

function checkBlockLayout(blocks, lots) {
  const epsilon = 1e-8;
  const areaSize = (area) => (area.maxX - area.minX) * (area.maxZ - area.minZ);
  for (const block of blocks) {
    assert.ok(['building', 'park', 'mixed'].includes(block.kind));
    const children = lots.filter((lot) => lot.blockId === block.id);
    const parks = children.filter((lot) => lot.kind === 'park');
    const buildings = children.filter((lot) => lot.kind === 'building');
    if (block.kind === 'building') { assert.equal(block.parkArea, null); assert.equal(parks.length, 0); }
    if (block.kind === 'park') { assert.equal(block.buildingArea, null); assert.equal(buildings.length, 0); }
    if (block.kind === 'mixed') {
      assert.ok(Math.abs(areaSize(block.buildingArea) - areaSize(block.parkArea)) < epsilon);
      assert.ok(block.buildingArea.maxX <= block.parkArea.minX || block.parkArea.maxX <= block.buildingArea.minX
        || block.buildingArea.maxZ <= block.parkArea.minZ || block.parkArea.maxZ <= block.buildingArea.minZ);
    }
    assert.ok(parks.length <= 1, `${block.id}: park fragmented into individual plots`);
    for (const lot of children) {
      const area = lot.kind === 'park' ? block.parkArea : block.buildingArea;
      assert.ok(area, `${block.id}: wrong land use`);
      assert.ok(lot.x - lot.width / 2 >= area.minX - epsilon && lot.x + lot.width / 2 <= area.maxX + epsilon);
      assert.ok(lot.z - lot.depth / 2 >= area.minZ - epsilon && lot.z + lot.depth / 2 <= area.maxZ + epsilon);
      if (lot.kind === 'park') {
        assert.ok(Math.abs(lot.width * lot.depth - areaSize(area)) < epsilon, `${block.id}: disconnected lawn`);
      }
    }
    for (let a = 0; a < children.length; a++) {
      for (let b = a + 1; b < children.length; b++) {
        const first = children[a];
        const second = children[b];
        assert.ok(Math.abs(first.x - second.x) >= (first.width + second.width) / 2 - epsilon
          || Math.abs(first.z - second.z) >= (first.depth + second.depth) / 2 - epsilon,
        `${block.id}: overlapping park/building footprints`);
      }
    }
  }
}

test('procedural scenery, holiday transitions, bounded crowds and lifecycle', { timeout: 90000 }, async (t) => {
  const root = path.resolve(__dirname, '..');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    try {
      const content = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(content);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  const spriteRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (/THREE.WebGLProgram: Shader Error/.test(message.text())) errors.push(message.text()); });
  page.on('request', (request) => { if (/\/assets\/.*\.png/.test(request.url())) spriteRequests.push(request.url()); });
  await page.route('**/api.open-meteo.com/**', (route) => route.fulfill({ json: { current: { weather_code: 0 } } }));
  await page.goto(`http://127.0.0.1:${server.address().port}/?compareStyles=1&fakeTime=2026-11-20T12:00:00%2B01:00`);
  await page.waitForFunction(() => window.scene3d?.getStats().frame > 2 && document.querySelectorAll('tbody tr').length > 0);
  assert.match(await page.locator('h1').textContent(), /Oude Baan/);
  const initial = await page.evaluate(() => ({ stats: scene3d.getStats(),
    events: [...activeHolidayEvents].map((event) => event.id),
    city: scene3d.cityDecorations,
    blocks: scene3d.environment.blocks,
    lots: scene3d.environment.lots.map(({ x, z, width, depth, kind, blockId }) => ({ x, z, width, depth, kind, blockId })),
    localSinterklaas: [...propStates.values()].flat().filter((prop) => prop.spec.model === 'sinterklaas/sinterklaas').length,
    gifts: [...propStates.values()].flat().filter((prop) => prop.spec.model.includes('present')).map((prop) => prop.spec.height) }));
  assert.deepEqual(initial.events, ['sinterklaas']);
  assert.ok(initial.gifts.length && initial.gifts.every((height) => height === 40));
  assert.ok(initial.stats.calls <= 10);
  assert.equal(initial.stats.textures, 0);
  assert.ok(initial.stats.buildings > 10 && initial.stats.parks > 5);
  assert.ok(initial.city.length >= 40);
  const sinterklaas = initial.city.filter((prop) => prop.model === 'sinterklaas/sinterklaas');
  assert.equal(sinterklaas.length, 1);
  assert.equal(sinterklaas[0].placement, 'roof');
  assert.ok(sinterklaas[0].y > 3);
  assert.equal(initial.localSinterklaas, 0);
  assert.deepEqual([...new Set(initial.city.map((prop) => prop.placement))].sort(), ['park', 'pavement', 'roof']);
  assert.deepEqual([...new Set(initial.blocks.map((block) => block.kind))].sort(), ['building', 'mixed', 'park']);
  checkBlockLayout(initial.blocks, initial.lots);

  const checkCity = async () => {
    await page.waitForFunction(() => scene3d.width === innerWidth && scene3d.height === innerHeight);
    const city = await page.evaluate(() => {
      scene3d.begin(currentDarkness);
      scene3d.render();
      const gl = scene3d.renderer.getContext();
      const pixel = new Uint8Array(4);
      const coverage = [];
      for (const x of [0, .25, .5, .75, 1]) {
        for (const y of [0, .25, .5, .75, 1]) {
          gl.readPixels(Math.floor(x * (gl.drawingBufferWidth - 1)), Math.floor(y * (gl.drawingBufferHeight - 1)),
            1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          coverage.push(pixel[3]);
        }
      }
      scene3d.ground(495, 580).y = 0;
      const center = scene3d.position.project(scene3d.camera).clone();
      const rect = scene3d.renderer.domElement.getBoundingClientRect();
      const origin = scene3d.projected.set(0, 0, 0).project(scene3d.camera).clone();
      const slopes = [[1, 0, 0], [0, 0, 1]].map((axis) => {
        scene3d.projected.set(...axis).project(scene3d.camera).sub(origin);
        return Math.abs(scene3d.projected.y * rect.height / (scene3d.projected.x * rect.width));
      });
      scene3d.ground(630, 730).y = 0;
      const layoutPoint = scene3d.position.project(scene3d.camera);
      let fingerprint = 2166136261;
      for (const batch of scene3d.staticBatches.values()) {
        const values = new Uint32Array(batch.mesh.instanceMatrix.array.buffer, 0, batch.mesh.count * 16);
        for (const value of values) fingerprint = Math.imul(fingerprint ^ value, 16777619) >>> 0;
      }
      const outsideRoads = scene3d.cityDecorations.filter((prop) => prop.placement !== 'roof').every((prop) =>
        !scene3d.environment.roadsX.some((road) => prop.x + .2 > road.min && prop.x - .2 < road.max)
        && !scene3d.environment.roadsZ.some((road) => prop.z + .2 > road.min && prop.z - .2 < road.max));
      return { coverage, fingerprint, outsideRoads, stats: scene3d.getStats(),
        blocks: scene3d.environment.blocks,
        lots: scene3d.environment.lots.map(({ x, z, width, depth, kind, blockId }) => ({ x, z, width, depth, kind, blockId })),
        center: { x: (center.x + 1) * rect.width / 2, y: (1 - center.y) * rect.height / 2 },
        layoutError: { x: (layoutPoint.x + 1) * rect.width / 2 - (scene3d.layoutX + 630 * scene3d.layoutSize / 990),
          y: (1 - layoutPoint.y) * rect.height / 2 - (scene3d.layoutY + 730 * scene3d.layoutSize / 990) },
        slopes, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        expectedY: innerHeight / 2 + 85 * Math.min(innerWidth, innerHeight) * .4 / 990,
        sinterklaas: scene3d.cityDecorations.filter((prop) => prop.unique) };
    });
    assert.ok(city.coverage.every((alpha) => alpha === 255), `Incomplete ground: ${city.coverage}`);
    assert.ok(city.outsideRoads);
    assert.ok(Math.abs(city.center.x - page.viewportSize().width / 2) < .001);
    assert.ok(Math.abs(city.center.y - city.expectedY) < .001);
    assert.ok(city.slopes.every((slope) => Math.abs(slope - 0.5) < 1e-8), `Irregular ground diagonals: ${city.slopes}`);
    assert.ok(Math.abs(city.layoutError.x) < .001 && Math.abs(city.layoutError.y) < .001);
    if (city.stats.postPasses) {
      assert.equal(city.rect.x, 0);
      assert.equal(city.rect.y, 0);
      assert.equal(city.rect.width, city.stats.bufferWidth * city.stats.pixelScale);
      assert.equal(city.rect.height, city.stats.bufferHeight * city.stats.pixelScale);
      assert.ok(city.rect.width >= page.viewportSize().width && city.rect.height >= page.viewportSize().height);
      assert.ok(city.rect.width - page.viewportSize().width < city.stats.pixelScale);
      assert.ok(city.rect.height - page.viewportSize().height < city.stats.pixelScale);
    }
    assert.ok(city.stats.calls <= 13 + city.stats.postPasses && city.stats.geometries <= 14 + city.stats.postPasses);
    assert.deepEqual(city.sinterklaas, sinterklaas);
    checkBlockLayout(city.blocks, city.lots);
    for (const block of city.blocks) {
      const original = initial.blocks.find((item) => item.id === block.id);
      if (original) assert.deepEqual(block, original);
    }
    return city;
  };
  const landscape = await checkCity();

  const checkPixelDetails = async () => {
    const details = await page.evaluate(async () => {
      const THREE = await import('/js/vendor/three.module.min.js');
      const { scenery, getModel } = await import('/js/models3d.js');
      scene3d.begin(0);
      const fixture = new THREE.Scene();
      fixture.add(scene3d.ambient.clone(), scene3d.sun.clone());
      const batches = new Map();
      const gl = scene3d.renderer.getContext();
      const { width, height } = scene3d.pixelEffect.target;
      const point = new THREE.Vector3();
      const root = new THREE.Matrix4();
      const stems = new Map([...scenery.parts, ...scene3d.environment.parts]
        .filter((part) => part.minPixelWidth > 0).map((part) => [part.matrix.elements[0], part]));
      const widths = [];
      const busFrames = [];
      const busCenters = [];
      const windows = [];
      const pavingFrames = [];
      const readPatch = (x, y, size) => {
        const pixels = new Uint8Array(size * size * 4);
        scene3d.renderer.readRenderTargetPixels(scene3d.pixelEffect.target, x, y, size, size, pixels);
        return pixels;
      };
      const render = (model, transform) => {
        batches.forEach((batch) => { batch.mesh.count = 0; });
        scene3d.submit(model, transform, 1, batches);
        batches.forEach((batch) => { batch.commit(); fixture.add(batch.mesh); });
        scene3d.pixelEffect.render(scene3d.renderer, fixture, scene3d.camera);
      };
      try {
        for (const [diameter, part] of stems) {
          const samples = [];
          const centered = { ...part, matrix: part.matrix.clone().setPosition(0, 0, 0) };
          for (const phase of [.05, .25, .49, .51, .75, .95]) {
            point.set(phase * 2 / width, 0, 0).unproject(scene3d.camera);
            root.makeTranslation(point.x, point.y, point.z);
            render({ parts: [centered] }, root);
            const pixels = new Uint8Array(width * 4);
            gl.readPixels(0, Math.floor(height / 2), width, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            samples.push(pixels.filter((value, i) => i % 4 === 3 && value > 0).length);
          }
          widths.push({ diameter, samples });
        }
        for (const phase of [0, .1, .25, .5, .75, 1]) {
          scene3d.begin(0);
          const stop = pointsOfInterest.routeA.stop;
          scene3d.drawBus('central', stop.x + phase * 20, stop.y, true, 1, phase * 160);
          root.copy(scene3d.root);
          point.setFromMatrixPosition(root).project(scene3d.camera);
          const x = (point.x + 1) * width / 2;
          const y = (point.y + 1) * height / 2;
          busCenters.push([x, y]);
          render(getModel('bus'), root);
          const pixels = new Uint8Array(96 * 96 * 4);
          scene3d.renderer.readRenderTargetPixels(scene3d.pixelEffect.target,
            Math.round(x) - 48, Math.round(y) - 16, 96, 96, pixels);
          busFrames.push(pixels);
        }
        for (const axis of [0, 2]) {
          const frame = scene3d.environment.parts.find((part) => part.pixelPlane?.framed
            && !part.pixelPlane.inset && part.pixelPlane.axes[0] === axis);
          const pane = scene3d.environment.parts.find((part) => part.pixelPlane?.inset === 1
            && part.pixelPlane.matrix === frame.matrix);
          const anchor = new THREE.Vector3().setFromMatrixPosition(frame.matrix);
          const group = frame.matrix.clone().setPosition(0, 0, 0);
          const parts = [frame, pane].map((part, i) => ({ ...part, shape: 'box-glow',
            color: new THREE.Color(i ? '#000' : '#fff'),
            matrix: part.matrix.clone().setPosition(new THREE.Vector3().setFromMatrixPosition(part.matrix).sub(anchor)),
            pixelPlane: { ...part.pixelPlane, matrix: group } }));
          const frames = [];
          const highlights = [];
          for (const phase of [.05, .25, .49, .51, .75, .95]) {
            point.set(phase * 2 / width, phase * 1.4 / height, 0).unproject(scene3d.camera);
            root.makeTranslation(point.x, point.y, point.z);
            render({ parts }, root);
            point.setFromMatrixPosition(scene3d.matrix).project(scene3d.camera);
            const pixels = readPatch(Math.round((point.x + 1) * width / 2) - 16,
              Math.floor((point.y + 1) * height / 2 + 1e-5) - 16, 32);
            frames.push([...pixels]);
            for (let x = 0; x < 32; x++) {
              let topFrame = -1;
              let topPane = -1;
              for (let y = 0; y < 32; y++) {
                const i = (y * 32 + x) * 4;
                if (pixels[i + 3] && pixels[i] > 0) topFrame = y;
                if (pixels[i + 3] && pixels[i] === 0) topPane = y;
              }
              if (topPane >= 0) highlights.push(topFrame - topPane);
            }
          }
          windows.push({ axis, differences: frames.map((pixels) => pixels.filter((value, i) => value !== frames[0][i]).length), highlights });
        }
        point.set(0, 0, 0).unproject(scene3d.camera);
        const center = point.clone();
        for (const lift of [0, .225, .75]) {
          root.identity();
          render({ parts: [{ shape: 'paving', color: new THREE.Color('#fff'),
            matrix: new THREE.Matrix4().makeScale(100, .025, 100).setPosition(center.x, center.y + lift, center.z) }] }, root);
          pavingFrames.push([...readPatch(Math.floor(width / 2) - 16, Math.floor(height / 2) - 16, 32)]);
          if (lift === 0) pavingFrames.push([...readPatch(Math.floor(width / 2) - 16
            + scene3d.lightingUniforms.uPavingGrid.value.x * 2, Math.floor(height / 2) - 16, 32)]);
        }
        const changedBusPixels = busFrames.slice(1).map((pixels) => {
          let changed = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels.subarray(i, i + 4).some((value, channel) => value !== busFrames[0][i + channel])) changed++;
          }
          return changed;
        });
        return { widths, busCenters, changedBusPixels, windows,
          pavingDifferences: pavingFrames.map((pixels) => pixels.filter((value, i) => value !== pavingFrames[0][i]).length) };
      } finally {
        batches.forEach((batch) => batch.dispose());
        fixture.clear();
      }
    });
    assert.ok(details.widths.length >= 3, 'Exercise authored street poles, stop poles and tree trunks');
    for (const stem of details.widths) {
      assert.ok(stem.samples[0] >= 1, `Missing stem: ${JSON.stringify(stem)}`);
      assert.equal(new Set(stem.samples).size, 1, `Inconsistent stem width: ${JSON.stringify(stem)}`);
    }
    assert.ok(details.busCenters.flat().every((value) => Math.abs(value - Math.round(value)) < 1e-6));
    assert.ok(details.changedBusPixels.every((count) => count <= 5), `Unstable bus edges: ${JSON.stringify(details)}`);
    for (const window of details.windows) {
      assert.ok(window.differences.every((count) => count === 0), `Window varies with pixel position: ${JSON.stringify(window)}`);
      assert.ok(window.highlights.length > 0 && window.highlights.every((height) => height === 1),
        `Inconsistent window highlights: ${JSON.stringify(window)}`);
    }
    assert.ok(details.pavingDifferences.every((count) => count === 0),
      `Pavement must repeat on the pixel grid and match between separate surface heights: ${details.pavingDifferences}`);
  };

  // Exercise the real date-to-solar-state path as well as the resulting rendered colours.
  const phases = {};
  for (const [phase, hour] of [['day', '12:00'], ['dusk', '16:45'], ['evening', '17:30'],
    ['night', '23:00'], ['dawn', '08:45']]) {
    phases[phase] = await page.evaluate(({ hour }) => {
      window.fakeTime = `2026-11-20T${hour}:00+01:00`;
      updateTimeOfDay();
      scene3d.begin(currentDarkness, currentLighting);
      scene3d.drawBus('central', pointsOfInterest.routeA.stop.x, pointsOfInterest.routeA.stop.y, false, 1, Date.now());
      scene3d.drawBus('route', pointsOfInterest.routeB.stop.x, pointsOfInterest.routeB.stop.y, false, 1, Date.now());
      scene3d.render();
      const gl = scene3d.renderer.getContext();
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const average = [0, 0, 0];
      let count = 0;
      for (let n = 0; n < pixels.length; n += 4 * 251) {
        for (let c = 0; c < 3; c++) average[c] += pixels[n + c];
        count++;
      }
      return { stats: scene3d.getStats(), average: average.map((value) => value / count) };
    }, { hour });
    assert.equal(phases[phase].stats.phase, phase);
    assert.equal(phases[phase].stats.busLights, 2);
    assert.ok(phases[phase].stats.streetLights > 20);
    assert.ok(phases[phase].stats.calls <= 13);
  }
  assert.equal(phases.day.stats.nightLights, 0);
  assert.equal(phases.night.stats.nightLights, 1);
  assert.ok(phases.night.stats.saturation < phases.evening.stats.saturation);
  assert.ok(phases.evening.stats.saturation < phases.dusk.stats.saturation);
  assert.ok(phases.dusk.stats.saturation < phases.day.stats.saturation);
  assert.ok(phases.day.average.reduce((a, b) => a + b) > phases.night.average.reduce((a, b) => a + b) * 2);
  assert.ok(phases.dusk.average[0] / phases.dusk.average[2] > phases.dawn.average[0] / phases.dawn.average[2]);

  const lightSamples = await page.evaluate(() => {
    scene3d.begin(1, { elevationHours: -2, isMorning: false });
    scene3d.drawBus('central', pointsOfInterest.routeA.stop.x, pointsOfInterest.routeA.stop.y, false, .8, Date.now());
    scene3d.drawBus('route', pointsOfInterest.routeB.stop.x, pointsOfInterest.routeB.stop.y, false, 1, Date.now());
    const gl = scene3d.renderer.getContext();
    const pixel = new Uint8Array(4);
    const sample = (x, y, z) => {
      scene3d.projected.set(x, y, z).project(scene3d.camera);
      gl.readPixels(Math.round((scene3d.projected.x + 1) * (gl.drawingBufferWidth - 1) / 2),
        Math.round((scene3d.projected.y + 1) * (gl.drawingBufferHeight - 1) / 2),
        1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel].slice(0, 3);
    };
    const fronts = scene3d.lightingUniforms.uBusFront.value;
    const directions = scene3d.lightingUniforms.uBusDirection.value;
    const samples = () => ({
      headlights: fronts.map((front, n) => sample(front.x, .018, front.z + directions[n].y * 4)),
      rear: sample(fronts[1].x, .018, fronts[1].z - directions[1].y * 6.52),
      street: sample(-1.5, .018, -12),
    });
    scene3d.render();
    const on = samples();
    fronts.forEach((front) => { front.w = 0; });
    scene3d.render();
    const noBuses = samples();
    scene3d.lightingUniforms.uNightLights.value = 0;
    scene3d.render();
    const off = samples();
    return { on, noBuses, off, directions: directions.map((direction) => direction.toArray()) };
  });
  const sum = (pixel) => pixel.reduce((a, b) => a + b);
  assert.deepEqual(lightSamples.directions, [[0, 1], [0, -1]]);
  for (let n = 0; n < 2; n++) {
    assert.ok(sum(lightSamples.on.headlights[n]) > sum(lightSamples.noBuses.headlights[n]) + 30,
      `Headlight ${n} did not illuminate the road: ${JSON.stringify(lightSamples)}`);
  }
  assert.ok(lightSamples.on.rear[0] > lightSamples.noBuses.rear[0] + 10, JSON.stringify(lightSamples));
  assert.ok(lightSamples.on.rear[0] - lightSamples.noBuses.rear[0] > lightSamples.on.rear[2] - lightSamples.noBuses.rear[2]);
  assert.ok(sum(lightSamples.on.street) > sum(lightSamples.off.street) + 40);
  const movingLights = await page.evaluate(() => {
    const stop = pointsOfInterest.routeA.stop;
    scene3d.begin(1);
    scene3d.drawBus('central', stop.x, stop.y, false, 1, Date.now());
    const before = scene3d.lightingUniforms.uBusFront.value[0].toArray();
    scene3d.begin(1);
    scene3d.drawBus('central', stop.x - 120, stop.y + 120 / Math.sqrt(3), true, .4, Date.now());
    const after = scene3d.lightingUniforms.uBusFront.value[0].toArray();
    scene3d.drawBus('route', pointsOfInterest.routeB.stop.x, pointsOfInterest.routeB.stop.y, false, 1, Date.now());
    scene3d.drawBus('central', stop.x, stop.y, false, 1, Date.now());
    const budget = scene3d.busLightCount;
    scene3d.begin(1);
    return { before, after, budget, cleared: scene3d.lightingUniforms.uBusFront.value.every((front) => front.w === 0) };
  });
  assert.ok(Math.abs(movingLights.before[0] - movingLights.after[0]) < .01);
  assert.ok(movingLights.after[2] - movingLights.before[2] > 2.9);
  assert.equal(movingLights.after[3], .4);
  assert.equal(movingLights.budget, 2);
  assert.equal(movingLights.cleared, true);
  await page.evaluate(() => {
    window.fakeTime = '2026-11-20T12:00:00+01:00';
    updateTimeOfDay();
  });

  // Render 600 visible, animated people, rather than hiding them offscreen in a long queue.
  const crowd = await page.evaluate(() => {
    const started = performance.now();
    scene3d.begin(1);
    for (let i = 0; i < 600; i++) scene3d.drawStudent({ seq: i, flip: i % 2, bounceSpeed: 180, bouncePhase: i },
      140 + i % 30 * 25, 450 + Math.floor(i / 30) * 18, true, 1, [], Date.now());
    scene3d.drawBus('central', pointsOfInterest.routeA.stop.x, pointsOfInterest.routeA.stop.y, false, 1, Date.now());
    scene3d.drawBus('route', pointsOfInterest.routeB.stop.x, pointsOfInterest.routeB.stop.y, false, 1, Date.now());
    scene3d.render();
    return { ...scene3d.getStats(), submissionMs: performance.now() - started };
  });
  assert.ok(crowd.calls <= 13, JSON.stringify(crowd));
  assert.ok(crowd.geometries <= 14, JSON.stringify(crowd));
  assert.ok(crowd.triangles > initial.stats.triangles);
  t.diagnostic(`600 visible students and 2 buses at night: ${crowd.calls} draw calls, ${crowd.triangles} triangles, ${crowd.submissionMs.toFixed(1)}ms CPU submission (test machine).`);

  // Style switches must preserve framing, transparency, bounded GPU resources and night lighting.
  const styleResults = {};
  for (const style of ['clean', 'dither', 'ink', 'clean', 'original']) {
    await page.getByLabel('Scènestijl').selectOption(style);
    assert.equal(new URL(page.url()).searchParams.get('sceneStyle'), style);
    const result = await page.evaluate(() => {
      const frames = [];
      const gl = scene3d.renderer.getContext();
      for (const darkness of [0, 1]) {
        scene3d.begin(darkness);
        scene3d.drawBus('central', pointsOfInterest.routeA.stop.x, pointsOfInterest.routeA.stop.y, false, 1, 0);
        for (let i = 0; i < 600; i++) scene3d.drawStudent({ seq: i, flip: i % 2, bounceSpeed: 180, bouncePhase: i },
          140 + i % 30 * 25, 450 + Math.floor(i / 30) * 18, false, 1, [], 0);
        scene3d.render();
        const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let fingerprint = 2166136261;
        let brightness = 0;
        let opaque = true;
        for (let i = 0; i < pixels.length; i += 4) {
          fingerprint = Math.imul(fingerprint ^ pixels[i] ^ pixels[i + 1] << 8 ^ pixels[i + 2] << 16, 16777619) >>> 0;
          brightness += pixels[i] + pixels[i + 1] + pixels[i + 2];
          opaque &&= pixels[i + 3] === 255;
        }
        frames.push({ fingerprint, brightness: brightness / pixels.length, opaque });
      }
      // An empty scene must remain transparent, including after the colour/contour pass.
      scene3d.scene.visible = false;
      scene3d.render();
      const transparent = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, transparent);
      scene3d.scene.visible = true;
      scene3d.render();
      return { frames, transparent: [...transparent], stats: scene3d.getStats(),
        camera: scene3d.camera.projectionMatrix.elements,
        scaling: scene3d.renderer.domElement.style.imageRendering };
    });
    assert.equal(result.stats.style, style);
    assert.equal(result.stats.postPasses, style === 'original' ? 0 : 1);
    assert.equal(result.stats.textures, style === 'original' ? 0 : 1);
    assert.ok(result.stats.calls <= 14 && result.stats.geometries <= 15, JSON.stringify(result.stats));
    const scale = style === 'original' ? 1 : style === 'clean' ? 2 : 3;
    assert.equal(result.stats.bufferWidth, 1920 / scale);
    assert.equal(result.stats.bufferHeight, 1080 / scale);
    assert.equal(result.scaling, style === 'original' ? 'auto' : 'pixelated');
    assert.deepEqual(result.transparent, [0, 0, 0, 0]);
    assert.deepEqual(errors, []);
    assert.ok(result.frames.every((frame) => frame.opaque), `${style}: ${JSON.stringify(result.frames)}`);
    assert.ok(result.frames[0].brightness > result.frames[1].brightness * 2);
    if (styleResults[style]) assert.deepEqual(result.frames, styleResults[style].frames, 'Switching styles must produce stable pixels');
    styleResults[style] = result;
  }
  assert.equal(new Set(Object.values(styleResults).map((result) => result.frames[0].fingerprint)).size, 4);
  for (const result of Object.values(styleResults)) assert.deepEqual(result.camera, styleResults.original.camera);
  t.diagnostic(`Pixel styles: clean ${styleResults.clean.stats.bufferWidth}×${styleResults.clean.stats.bufferHeight}; dither/ink ${styleResults.ink.stats.bufferWidth}×${styleResults.ink.stats.bufferHeight}, one extra draw call and one texture.`);

  const beforeResize = await page.evaluate(() => {
    studentAnimationData.clear();
    spawnStudentsForStop('routeA', 350);
    spawnStudentsForStop('routeB', 350);
    return { count: studentAnimationData.size, point: { ...pointsOfInterest.routeA.stop } };
  });
  assert.equal(beforeResize.count, 600);
  await page.setViewportSize({ width: 3840, height: 2160 });
  const resized = await page.evaluate(() => ({ stats: scene3d.getStats(), point: pointsOfInterest.routeA.stop,
    effects: eventCanvasElement.width * eventCanvasElement.height }));
  assert.deepEqual(resized.point, beforeResize.point);
  assert.ok(resized.stats.bufferWidth * resized.stats.bufferHeight <= 1920 * 1080);
  assert.ok(resized.effects <= 1920 * 1080);
  assert.equal((await checkCity()).fingerprint, landscape.fingerprint);
  await page.setViewportSize({ width: 1080, height: 1920 });
  assert.deepEqual(await page.evaluate(() => pointsOfInterest.routeA.stop), beforeResize.point);
  await checkCity();
  for (const viewport of [{ width: 3840, height: 1080 }, { width: 360, height: 1200 }]) {
    await page.setViewportSize(viewport);
    await checkCity();
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  assert.equal((await checkCity()).fingerprint, landscape.fingerprint);

  for (const style of ['clean', 'dither', 'ink']) {
    await page.getByLabel('Scènestijl').selectOption(style);
    for (const viewport of [{ width: 3840, height: 2160 }, { width: 1080, height: 1920 },
      { width: 1919, height: 1079 }, { width: 1081, height: 1919 },
      { width: 1280, height: 1080 }, { width: 2560, height: 1080 }]) {
      await page.setViewportSize(viewport);
      const city = await checkCity();
      const pixelSize = style === 'clean' ? 2 : 3;
      assert.ok(city.stats.bufferWidth * city.stats.bufferHeight <= 1920 * 1080 / pixelSize ** 2);
      assert.equal(city.stats.textures, 1);
      if (viewport.height === 1080) await checkPixelDetails();
    }
  }
  await page.getByLabel('Scènestijl').selectOption('original');
  await page.setViewportSize({ width: 1920, height: 1080 });

  for (const [date, event] of [['2026-12-15', 'christmas'], ['2026-10-31', 'halloween'],
    ['2026-04-05', 'easter'], ['2026-02-15', 'carnaval'], ['2026-05-05', 'bevrijdingsdag'],
    ['2026-10-09', 'paarse-vrijdag'], ['2026-12-31', 'oud-en-nieuw'], ['2026-07-01', 'balloon']]) {
    const active = await page.evaluate(({ date }) => {
      window.fakeTime = `${date}T21:59:30Z`;
      updateHolidayEvents(eventScene, getNow());
      driveByStates.forEach((state) => { state.startTime = Date.now() - 1000; });
      return [...activeHolidayEvents].map((item) => item.id);
    }, { date });
    assert.ok(active.includes(event), `${date}: ${active}`);
    await page.waitForTimeout(70);
    const decorations = await page.evaluate(() => scene3d.cityDecorations);
    if (['christmas', 'halloween', 'easter', 'bevrijdingsdag'].includes(event)) {
      assert.ok(decorations.length >= 20, `${event}: missing city decorations`);
    } else assert.equal(decorations.length, 0);
    assert.equal(decorations.filter((prop) => prop.model === 'sinterklaas/sinterklaas').length, 0);
  }
  // Exercise floating geometry as well as ground models and vehicles.
  await page.evaluate(() => { scene3d.begin(0); scene3d.drawFloating('balloon', 500, 300, 250); scene3d.render(); });

  await page.evaluate(() => {
    busAnimationData.clear();
    studentAnimationData.clear();
    for (let i = 0; i < 1000; i++) {
      addBusToAnimationData(busToCentral, pointsOfInterest.routeA.stop, pointsOfInterest.routeA.destination, fadeMode(FADE_OUT));
    }
    busAnimationData.forEach((bus) => { bus.startTime = Date.now() - 4000; });
    window.expiredTestBuses = [...busAnimationData.keys()];
  });
  await page.waitForFunction(() => expiredTestBuses.every((id) => !busAnimationData.has(id)));

  // Hidden tabs release both animation loops, then restart cleanly.
  await page.evaluate(() => {
    setWeatherOverride({ mode: 'rain', intensity: .7 });
    startWeatherLoop();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.deepEqual(await page.evaluate(() => [sceneFrameId, weatherFrameId]), [0, 0]);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(100);
  assert.ok(await page.evaluate(() => sceneFrameId > 0 && weatherFrameId > 0));

  await page.getByLabel('Scènestijl').selectOption('ink');
  const canLoseContext = await page.evaluate(() => {
    const extension = scene3d.renderer.getContext().getExtension('WEBGL_lose_context');
    if (!extension) return false;
    window.testContextExtension = extension;
    extension.loseContext();
    return true;
  });
  if (canLoseContext) {
    await page.waitForFunction(() => scene3d.contextLost);
    await page.waitForTimeout(150);
    await page.evaluate(() => window.testContextExtension.restoreContext());
    await page.waitForFunction(() => !scene3d.contextLost);
    await page.waitForFunction(() => scene3d.getStats().textures === 1 && scene3d.getStats().calls > 1);
    const restoredAlpha = await page.evaluate(() => {
      scene3d.render();
      const gl = scene3d.renderer.getContext();
      const pixel = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return pixel[3];
    });
    assert.equal(restoredAlpha, 255);
  }
  await page.reload();
  await page.waitForFunction(() => window.scene3d?.getStats().frame > 2);
  assert.equal(await page.evaluate(() => scene3d.style), 'ink');
  assert.equal(await page.getByLabel('Scènestijl').inputValue(), 'ink');
  assert.deepEqual(spriteRequests, []);
  assert.deepEqual(errors, []);

  const fallback = await browser.newPage();
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type.startsWith('webgl') ? null : original.call(this, type, ...args);
    };
  });
  await fallback.goto(`http://127.0.0.1:${server.address().port}/`);
  await fallback.locator('[role="status"]').waitFor();
  assert.match(await fallback.locator('h1').textContent(), /Oude Baan/);
  assert.ok(await fallback.locator('tbody tr').count() > 0);
});
