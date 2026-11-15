const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

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
  await page.goto(`http://127.0.0.1:${server.address().port}/?fakeTime=2026-11-20T12:00:00%2B01:00`);
  await page.waitForFunction(() => window.scene3d?.getStats().frame > 2 && document.querySelectorAll('tbody tr').length > 0);
  assert.match(await page.locator('h1').textContent(), /Oude Baan/);
  const initial = await page.evaluate(() => ({ stats: scene3d.getStats(),
    events: [...activeHolidayEvents].map((event) => event.id),
    gifts: [...propStates.values()].flat().filter((prop) => prop.spec.model.includes('present')).map((prop) => prop.spec.height) }));
  assert.deepEqual(initial.events, ['sinterklaas']);
  assert.ok(initial.gifts.length && initial.gifts.every((height) => height === 40));
  assert.ok(initial.stats.calls <= 9);
  assert.equal(initial.stats.textures, 0);

  // Render 600 visible, animated people, rather than hiding them offscreen in a long queue.
  const crowd = await page.evaluate(() => {
    const started = performance.now();
    scene3d.begin(0);
    for (let i = 0; i < 600; i++) scene3d.drawStudent({ seq: i, flip: i % 2, bounceSpeed: 180, bouncePhase: i },
      140 + i % 30 * 25, 450 + Math.floor(i / 30) * 18, true, 1, [], Date.now());
    scene3d.render();
    return { ...scene3d.getStats(), submissionMs: performance.now() - started };
  });
  assert.ok(crowd.calls <= 9, JSON.stringify(crowd));
  assert.ok(crowd.geometries <= 9, JSON.stringify(crowd));
  assert.ok(crowd.triangles > initial.stats.triangles);
  t.diagnostic(`600 visible students: ${crowd.calls} draw calls, ${crowd.triangles} triangles, ${crowd.submissionMs.toFixed(1)}ms CPU submission (test machine).`);

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
  await page.setViewportSize({ width: 1080, height: 1920 });
  assert.deepEqual(await page.evaluate(() => pointsOfInterest.routeA.stop), beforeResize.point);

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
  });
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(() => busAnimationData.size), 0);

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
    await page.waitForTimeout(100);
  }
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
