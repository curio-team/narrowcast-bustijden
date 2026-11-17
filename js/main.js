function sortPasses(passes) {
  return Object.values(passes)
    .sort(
      (a, b) => a.TargetArrivalTime.localeCompare(b.TargetArrivalTime)
    );
}

function isLocalhost() {
  return window.location.hostname === 'localhost'
    || window.location.hostname === '127.0.0.1';
}

// ?background=1 hides the departure boards, e.g. to take a screenshot of the scenery
if (new URLSearchParams(window.location.search).get('background') === '1') {
  document.body.classList.add('background-only');
}

let currentBusAnimationId = 0;
let stopAreaCode = 'BdOud';
const busAnimationData = new Map();

// Settles once the first API response was handled, so the first bus cycle knows about crowdedMode
let resolveFirstDataLoad;
const firstDataLoad = new Promise((resolve) => { resolveFirstDataLoad = resolve; });

// Animation constants
const BUS_TRAVEL_DURATION = 3000;
const FADE_TIME = BUS_TRAVEL_DURATION * .5;
const FADE_IN = 1;
const FADE_OUT = 2;

function fadeMode(mode, duration) {
  return {
    mode,
    duration: duration || FADE_TIME
  };
}

function addBusToAnimationData(direction, from, to, fadeMode, onArrivalCallback) {
  const currentTime = new Date().getTime();
  busAnimationData.set(currentBusAnimationId, {
    direction,
    from,
    to,
    fadeMode, // This can be null if no fading is desired
    startTime: currentTime,
    travelDuration: BUS_TRAVEL_DURATION,
    onArrivalCallback
  });
  currentBusAnimationId++;
}

function removeBusFromAnimationData(index) {
  busAnimationData.delete(index);
}

/*
** API data fetching of bus times
*/
Vue.createApp({
  data() {
    return {
      routeA: [],
      routeB: [],
      stopName: '',
      error: null
    }
  },
  computed: {
    getData() {
      // Check if there's an ID for the bus stops in the query parameters
      const urlParams = new URLSearchParams(window.location.search);

      if (urlParams.has('stopAreaCode')) {
        stopAreaCode = urlParams.get('stopAreaCode');
      }

      let url = 'https://bustijden.curio.codes/?stopAreaCode=' + stopAreaCode;
      const options = {
        method: 'GET'
      }

      if (isLocalhost()) {
        // Note that you will have to open this URL in the browser and accept the risk
        // before it will load the data.
        url = 'http://v0.ovapi.nl/stopareacode/' + stopAreaCode;

        // If you want live data, comment the line below. We use this static data during
        // development to prevent hitting any API rate limit.
        // This test data only contains data for the 'bdOud' stopAreaCode.
        url = 'test-data.json';
      }

      fetch(url, options)
        .then((response) => {
          if (!response.ok) {
            return response.json()
              .then((data) => { this.error = data.error ?? 'Onbekende fout'; })
              .catch(() => { this.error = `HTTP ${response.status}`; });
          }
          return response.json().then((data) => {
            this.error = null;
            // routeA is the top board, next to the shelter in the scene; routeB the bottom board, at the
            // stop across the road
            const routes = {
              routeA: {
                id: 72000810,
              },
              routeB: {
                id: 72000640,
              }
            };

            let index = 0;

            for (const route in routes) {
              if (urlParams.has(route)) {
                const routeId = urlParams.get(route);
                routes[route].id = routeId;
              } else if (urlParams.has('stopAreaCode')) {
                // Deduce the route ID's by looking at the data keys
                const keys = Object.keys(data[stopAreaCode]);
                routes[route].id = keys[index];
              }

              const routeData = data[stopAreaCode][routes[route].id];

              this.stopName = routeData.Stop.TimingPointName;
              this[route] = sortPasses(routeData.Passes);

              index++;
            }

            // Auto-enable crowdedMode when every displayed departure is delayed
            const displayedRows = [...this.routeA.slice(0, 5), ...this.routeB.slice(0, 5)];
            if (displayedRows.length > 0 && displayedRows.every((bus) => bus.ExpectedArrivalTime !== bus.TargetArrivalTime)) {
              window.crowdedMode = true;
            }

            // TODO: Draw the bus animations based on real arrival times
            // To use the API data, we could determine the arrival time and if it's close enough to the current time,
            // we could add a bus to the animation data to show it arriving and going to the destination.
          });
        })
        .catch((err) => {
          this.error = err.message ?? 'Verbindingsfout';
        })
        .finally(() => resolveFirstDataLoad());
    }
  },
  methods: {
    formatDate(value) {
      return new Date(value)
        .toLocaleTimeString('nl-NL', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
    },
    translate(status) {
      let translatedStatus;

      switch (status) {
        case 'PLANNED':
          translatedStatus = 'Verwacht';
          break;
        case 'PASSED':
          translatedStatus = 'Vertrokken';
          break;
        case 'CANCEL':
          translatedStatus = 'Geannuleerd';
          break;
        case 'DRIVING':
          translatedStatus = 'Onderweg';
          break;
        default:
          translatedStatus = 'Onbekend';
      }

      return translatedStatus;
    },
  }
}).mount('#app');

/*
** Background canvas bus animation
*/
// Route labels select opposing orientations of the same procedural model.
const busToCentral = 'central';
const busToRoute = 'route';
const backgroundOriginalSize = 990;
const backgroundOriginalPointsOfInterest = {
  routeA: {
    spawn: { x: 1259, y: -259 },
    stop: { x: 268, y: 314 },
    destination: { x: -800, y: 314 + 1068 / Math.sqrt(3) },
  },
  routeB: {
    spawn: { x: -812, y: 446 + 1300 / Math.sqrt(3) },
    stop: { x: 488, y: 446 },
    destination: { x: 1475, y: 446 - 987 / Math.sqrt(3) },
  },
  stopSignRoute: { x: 785, y: 515 },
};

// Simulation always uses layout coordinates, independent of resolution and resizing.
const pointsOfInterest = backgroundOriginalPointsOfInterest;
const busSize = { width: 350, height: 350 };
let drawArea = {};
let scene3d = null;
const backgroundCanvasElement = document.getElementById('backgroundCanvas');
const eventCanvasElement = document.getElementById('eventCanvas');
const backgroundCanvas = eventCanvasElement.getContext('2d');

function resizeCanvas() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const effectRatio = Math.min(1, Math.sqrt(1920 * 1080 / (width * height)));
  eventCanvasElement.width = Math.round(width * effectRatio);
  eventCanvasElement.height = Math.round(height * effectRatio);
  backgroundCanvas.setTransform(effectRatio, 0, 0, effectRatio, 0, 0);
  const size = Math.min(width, height) * .4;
  drawArea = { x: (width - size) / 2, y: (height - size) / 2, width: size, height: size };
  scene3d?.resize(width, height);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const sceneReady = import('./scene3d.js').then(({ IsometricScene, SCENE_STYLES }) => {
  const params = new URLSearchParams(window.location.search);
  scene3d = new IsometricScene(backgroundCanvasElement, params.get('sceneStyle') || 'original',
    { quality: params.get('quality'), opaque: true });
  // Inspect bounded draw calls, triangles and GPU resources on a kiosk or in browser devtools.
  window.scene3d = scene3d;
  if (params.get('compareStyles') === '1') {
    const label = document.createElement('label');
    label.className = 'scene-style-picker';
    label.textContent = 'Scènestijl ';
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Scènestijl');
    for (const [value, { label: text }] of Object.entries(SCENE_STYLES)) {
      select.add(new Option(text, value));
    }
    select.value = scene3d.style;
    select.addEventListener('change', () => {
      scene3d.setStyle(select.value);
      const url = new URL(window.location.href);
      url.searchParams.set('sceneStyle', scene3d.style);
      window.history.replaceState(null, '', url);
    });
    label.appendChild(select);
    document.body.appendChild(label);
  }
  startSceneLoop();
}).catch((error) => {
  console.error('Could not start procedural 3D scenery:', error);
  const notice = document.createElement('p');
  notice.setAttribute('role', 'status');
  notice.style.cssText = 'position:fixed;bottom:0;left:0;font:12px sans-serif;padding:4px;';
  notice.textContent = '3D-weergave niet beschikbaar.';
  document.body.appendChild(notice);
});

/*
** Time of day
*/

// Estimates how dark it is in Amsterdam (0 = full daylight, 1 = night). Uses solar time
// (UTC + longitude offset), which sidesteps summer/wintertime: the sun is the same either way.
const amsterdamLongitude = 4.9;
// Set window.fakeTime in the console (a Date, timestamp or ISO string like '2026-12-01T23:00:00+01:00') to test other times.
// On localhost you can also pass it as a query parameter: ?fakeTime=2026-12-31T23:59:30+01:00
function getNow() {
  // A literal "+" in a query string decodes to a space, so put it back (otherwise +01:00 gives an invalid date)
  const queryTime = isLocalhost() ? new URLSearchParams(window.location.search).get('fakeTime')?.replace(' ', '+') : null;
  const fakeTime = window.fakeTime || queryTime;
  const date = fakeTime ? new Date(fakeTime) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function getSolarHour(date) {
  return (date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
    + amsterdamLongitude / 15) % 24;
}

function getSunElevationHours(date = getNow()) {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date.getTime() - startOfYear) / 86400000;
  const halfDayLength = 6.15 + 2.2 * Math.cos(2 * Math.PI * (dayOfYear - 172) / 365); // ~4h (winter) to ~8.3h (summer)
  const solarHour = getSolarHour(date);
  return halfDayLength - Math.abs(solarHour - 12); // hours until sunrise/sunset; negative at night
}

// Gradient stops by hours of "daylight left" (top-left color, bottom-right color)
const skyStops = [
  { e: -1.0, from: [10, 14, 44], to: [38, 24, 72] },      // night
  { e: -0.2, from: [70, 40, 100], to: [200, 100, 110] },   // twilight
  { e: 0.3, from: [255, 150, 110], to: [150, 110, 180] },  // sunrise/sunset
  { e: 1.2, from: [180, 140, 190], to: [170, 238, 247] },  // day
];

function mixColor(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

function getSkyGradient(e) {
  let lower = skyStops[0];
  let upper = skyStops[skyStops.length - 1];
  if (e <= lower.e) {
    upper = lower;
  } else if (e < upper.e) {
    for (let i = 0; i < skyStops.length - 1; i++) {
      if (e >= skyStops[i].e && e <= skyStops[i + 1].e) {
        lower = skyStops[i];
        upper = skyStops[i + 1];
        break;
      }
    }
  } else {
    lower = upper;
  }
  const t = lower === upper ? 0 : (e - lower.e) / (upper.e - lower.e);
  const from = mixColor(lower.from, upper.from, t);
  const to = mixColor(lower.to, upper.to, t);
  return `linear-gradient(to bottom right, rgb(${from}), rgb(${to}))`;
}

let currentDarkness = 0;
let currentLighting = { elevationHours: 2, isMorning: false };
let lastSkyGradient = '';
function updateTimeOfDay() {
  const date = getNow();
  const e = getSunElevationHours(date);
  currentLighting = { elevationHours: e, isMorning: getSolarHour(date) < 12 };
  currentDarkness = Math.min(1, Math.max(0, (0.2 - e) / 0.7)); // headlights fade in around dusk

  const gradient = getSkyGradient(e);
  if (gradient !== lastSkyGradient) {
    document.body.style.backgroundImage = gradient;
    lastSkyGradient = gradient;

    const d = currentDarkness;
    const root = document.documentElement.style;
    root.setProperty('--sky-panel-bg', `rgba(${mixColor([255, 255, 255], [14, 16, 44], d)}, ${0.91 + 0.04 * d})`);
    root.setProperty('--sky-text', `rgb(${mixColor([0, 0, 0], [238, 238, 250], d)})`);
    root.setProperty('--sky-border', `rgb(${mixColor([229, 231, 235], [60, 62, 100], d)})`);
    root.setProperty('--board-surface', `rgb(${mixColor([255, 254, 249], [25, 25, 46], d)})`);
    root.setProperty('--board-panel', `rgba(${mixColor([255, 254, 249], [25, 25, 46], d)}, var(--board-opacity))`);
    root.setProperty('--board-text', `rgb(${mixColor([43, 33, 55], [244, 241, 255], d)})`);
    root.setProperty('--board-muted', `rgb(${mixColor([115, 104, 123], [180, 175, 204], d)})`);
    root.setProperty('--board-row', `rgba(${mixColor([247, 245, 249], [30, 29, 53], d)}, var(--board-opacity))`);
    root.setProperty('--board-featured', `rgba(${mixColor([236, 245, 245], [35, 43, 63], d)}, var(--board-opacity))`);
    root.setProperty('--board-divider', `rgb(${mixColor([232, 226, 236], [59, 55, 79], d)})`);
    root.setProperty('--board-change', `rgb(${mixColor([174, 52, 31], [255, 177, 152], d)})`);
  }

  // Available to custom canvas effects; 3D models use the scene's day/night lighting.
  nightFilter = currentDarkness > 0.01
    ? `brightness(${1 - 0.5 * currentDarkness}) saturate(${1 - 0.25 * currentDarkness}) hue-rotate(${12 * currentDarkness}deg)`
    : 'none';
}
let nightFilter = 'none';

// Students walk up to a stop before the bus arrives, wait, then board.
let currentStudentAnimationId = 0;
const studentAnimationData = new Map();

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// Console/auto toggle: while true, students pile up faster than busses clear them (see showTestBusses)
window.crowdedMode = false;

const MAX_WAITING_STUDENTS_PER_ROUTE = 300; // cap so a 24/7 display doesn't grow unbounded

let studentSequenceCounter = 0;

function countWaitingStudents(routeKey) {
  let count = 0;
  studentAnimationData.forEach((student) => {
    if (student.route === routeKey && student.boardStartTime === null) {
      count++;
    }
  });
  return count;
}

function getWaitingStudentsSorted(routeKey) {
  const list = [];
  studentAnimationData.forEach((student) => {
    if (student.route === routeKey && student.boardStartTime === null) {
      list.push(student);
    }
  });
  list.sort((a, b) => a.seq - b.seq);
  return list;
}

function computeQueueGeometry(routeKey) {
  const stop = pointsOfInterest[routeKey].stop;
  const direction = routeKey === 'routeA' ? busToCentral : busToRoute;
  const { anchor, dir } = scene3d.queueGeometry(direction, stop.x, stop.y);
  return { anchor, dir, spacing: 60, lineLength: 600 };
}

function getStudentPos(student, now) {
  const progress = Math.max(0, Math.min(1, (now - student.moveStartTime) / student.moveDuration));
  return {
    x: student.moveFrom.x + (student.moveTo.x - student.moveFrom.x) * progress,
    y: student.moveFrom.y + (student.moveTo.y - student.moveFrom.y) * progress
  };
}

// Recomputes everyone's spot in a route's queue (bunched up, not an even grid) and scoots
// anyone whose spot moved forward - e.g. after people ahead of them board.
function repositionRoute(routeKey) {
  const geo = computeQueueGeometry(routeKey);
  const waiting = getWaitingStudentsSorted(routeKey);
  const now = Date.now();
  let cumulative = 0;

  waiting.forEach((student) => {
    cumulative += student.gapToPrev;

    const target = {
      x: geo.anchor.x - geo.dir.x * cumulative,
      y: geo.anchor.y - geo.dir.y * cumulative
    };

    if (target.x === student.moveTo.x && target.y === student.moveTo.y) {
      return;
    }

    if (now < student.spawnTime) {
      student.moveTo = target; // not walking yet, just update where they'll head
      return;
    }

    student.moveFrom = getStudentPos(student, now);
    student.moveTo = target;
    student.moveStartTime = now;
    student.moveDuration = randomBetween(300, 600); // a short scoot forward
  });
}

// Spawns students that queue up bunched together (not a rigid line) behind whoever's
// already waiting. Defaults to 1-4; pass count to override.
function spawnStudentsForStop(routeKey, count) {
  const geo = computeQueueGeometry(routeKey);
  const spawnCount = count !== undefined ? count : 1 + Math.floor(Math.random() * 4);
  const startIndex = countWaitingStudents(routeKey);
  const actualCount = Math.max(0, Math.min(spawnCount, MAX_WAITING_STUDENTS_PER_ROUTE - startIndex));

  for (let n = 0; n < actualCount; n++) {
    const i = startIndex + n;
    const spawnDelay = randomBetween(0, 500);
    const gapToPrev = randomBetween(geo.spacing * 0.45, geo.spacing * 1.0); // tighter, uneven gaps
    const roughDistance = geo.lineLength + geo.spacing * i;
    const spawnPos = {
      x: geo.anchor.x - geo.dir.x * roughDistance,
      y: geo.anchor.y - geo.dir.y * roughDistance
    };

    studentAnimationData.set(currentStudentAnimationId, {
      route: routeKey,
      seq: studentSequenceCounter++,
      gapToPrev,
      spawnTime: Date.now() + spawnDelay,
      moveFrom: spawnPos,
      moveTo: spawnPos,
      moveStartTime: Date.now() + spawnDelay,
      moveDuration: randomBetween(1100, 1900),
      boardStartTime: null,
      boardDuration: null,
      boardPos: null,
      bouncePhase: randomBetween(0, Math.PI * 2),
      bounceSpeed: randomBetween(160, 220)
    });
    currentStudentAnimationId++;
  }

  repositionRoute(routeKey);
}

// Fades out waiting students in place to simulate boarding, then scoots the rest forward.
// No limit = everyone boards.
function boardStudentsAtStop(routeKey, limit) {
  const now = Date.now();
  let boarded = 0;

  studentAnimationData.forEach((student) => {
    if (student.route !== routeKey || student.boardStartTime !== null) {
      return;
    }

    if (limit !== undefined && boarded >= limit) {
      return;
    }

    student.boardPos = getStudentPos(student, now);
    student.boardStartTime = now + randomBetween(0, 250);
    student.boardDuration = randomBetween(350, 500);
    boarded++;
  });

  if (boarded > 0) {
    repositionRoute(routeKey);
  }
}

function removeStudentFromAnimationData(index) {
  studentAnimationData.delete(index);
}

const CROWDED_BUS_EVERY_N_CYCLES = 4; // in crowdedMode, busses only show up 1 cycle in N
let busCycleCount = 0;

/*
** Bus animations to have it go from one point to another
*/
// TODO: Actually draw busses based on the API data, for now we just show busses arriving and going
function showTestBusses() {
  busCycleCount++;

  const crowded = window.crowdedMode === true;
  const studentCount = crowded ? 15 + Math.floor(Math.random() * 15) : undefined;
  spawnStudentsForStop('routeA', studentCount);
  spawnStudentsForStop('routeB', studentCount);

  if (crowded && busCycleCount % CROWDED_BUS_EVERY_N_CYCLES !== 0) {
    return; // skip this cycle's busses
  }

  startHolidayBusCycle();

  const boardLimit = () => (window.crowdedMode === true ? 2 + Math.floor(Math.random() * 3) : undefined);

  // A bus that goes to the stop and when it arrives, after 2 seconds, it goes to the central destination
  addBusToAnimationData(
    busToCentral,
    pointsOfInterest.routeA.spawn,
    pointsOfInterest.routeA.stop,
    fadeMode(FADE_IN),
    (bus, index) => {
      boardStudentsAtStop('routeA', boardLimit());
      setTimeout(() => {
        addBusToAnimationData(
          busToCentral,
          pointsOfInterest.routeA.stop,
          pointsOfInterest.routeA.destination,
          fadeMode(FADE_OUT),
        );
        removeBusFromAnimationData(index);
      }, 500);
    }
  );

  // Bus the other way around
  addBusToAnimationData(
    busToRoute,
    pointsOfInterest.routeB.spawn,
    pointsOfInterest.routeB.stop,
    fadeMode(FADE_IN),
    (bus, index) => {
      boardStudentsAtStop('routeB', boardLimit());
      setTimeout(() => {
        addBusToAnimationData(
          busToRoute,
          pointsOfInterest.routeB.stop,
          pointsOfInterest.routeB.destination,
          fadeMode(FADE_OUT),
        );
        removeBusFromAnimationData(index);
      }, 500);
    }
  );
}
// Wait for the API data (max 5s) so crowdedMode is already decided before the first students spawn
Promise.all([sceneReady, Promise.race([firstDataLoad, new Promise((resolve) => setTimeout(resolve, 5000))])])
  .then(() => {
    if (!scene3d) return;
    showTestBusses();
    setInterval(showTestBusses, 10000);
  });

// Most events only draw 3D models. The 2D event canvas is only cleared and shown while an event uses scene.ctx.
let eventCanvasUsed = false;
let eventCanvasHasContent = true;

// What holiday events (js/events/*.js) get to work with. Live getters, since drawArea etc. are replaced on resize.
function getEventScene() {
  return {
    canvas: backgroundCanvasElement,
    get ctx() {
      eventCanvasUsed = true;
      return backgroundCanvas;
    },
    get canvasContext() { return backgroundCanvas; }, // for events.js to reset state, without showing the canvas
    get models() { return scene3d; },
    get width() { return window.innerWidth; },
    get height() { return window.innerHeight; },
    get drawArea() { return drawArea; },
    get pointsOfInterest() { return pointsOfInterest; },
    get darkness() { return currentDarkness; }, // 0 = daylight, 1 = night
    get nightFilter() { return nightFilter; }, // day/night filter available to canvas effects
    get busSize() { return busSize; },
    get scale() { return 1; }, // world simulation uses original layout units
    toCanvas(point) { // the original 990-unit layout to canvas pixels
      return {
        x: drawArea.x + point.x * drawArea.width / backgroundOriginalSize,
        y: drawArea.y + point.y * drawArea.height / backgroundOriginalSize,
      };
    },
  };
}

const eventScene = getEventScene();
const SCENE_MAX_FPS = 30;
let sceneFrameId = 0;
let lastSceneFrame = 0;
let lastTimeOfDayUpdate = 0;

function draw(timestamp) {
  sceneFrameId = 0;
  if (document.hidden || !scene3d) return;
  sceneFrameId = requestAnimationFrame(draw);
  if (timestamp - lastSceneFrame < 1000 / SCENE_MAX_FPS - 1) return;
  lastSceneFrame = timestamp - (timestamp - lastSceneFrame) % (1000 / SCENE_MAX_FPS);
  const now = Date.now();
  if (now - lastTimeOfDayUpdate >= 1000) {
    updateTimeOfDay();
    lastTimeOfDayUpdate = now;
  }
  if (eventCanvasHasContent) backgroundCanvas.clearRect(0, 0, window.innerWidth, window.innerHeight);
  eventCanvasUsed = false;
  scene3d.begin(currentDarkness, currentLighting);
  updateHolidayEvents(eventScene, getNow());
  drawHolidayGround(eventScene, now);

  busAnimationData.forEach((bus, index) => {
    const elapsed = Math.max(0, now - bus.startTime);
    const progress = Math.min(1, elapsed / bus.travelDuration);
    let alpha = 1;
    if (bus.fadeMode?.mode === FADE_IN) alpha = Math.min(1, elapsed / bus.fadeMode.duration);
    if (bus.fadeMode?.mode === FADE_OUT) alpha = Math.max(0, Math.min(1, (bus.travelDuration - elapsed) / bus.fadeMode.duration));
    scene3d.drawBus(bus.direction, bus.from.x + (bus.to.x - bus.from.x) * progress,
      bus.from.y + (bus.to.y - bus.from.y) * progress, progress < 1, alpha, now);
    if (progress >= 1) {
      const callback = bus.onArrivalCallback;
      bus.onArrivalCallback = null;
      callback?.(bus, index);
      if (bus.fadeMode?.mode === FADE_OUT) removeBusFromAnimationData(index);
    }
  });

  studentAnimationData.forEach((student, index) => {
    if (now < student.spawnTime) return;
    let pos, alpha = 1, walking = false;
    if (student.boardStartTime !== null && now >= student.boardStartTime) {
      const progress = Math.min(1, (now - student.boardStartTime) / student.boardDuration);
      if (progress >= 1) {
        removeStudentFromAnimationData(index);
        return;
      }
      pos = student.boardPos;
      alpha = 1 - progress;
    } else {
      pos = getStudentPos(student, now);
      walking = now < student.moveStartTime + student.moveDuration;
    }
    scene3d.drawStudent(student, pos.x, pos.y, walking, alpha, getStudentClothing(student), now);
  });
  drawHolidayVehicles(eventScene, now);
  drawHolidayFrontGround(eventScene);
  drawHolidayEvents(eventScene, now);
  scene3d.render();
  if (eventCanvasUsed !== eventCanvasHasContent) {
    eventCanvasHasContent = eventCanvasUsed;
    eventCanvasElement.style.visibility = eventCanvasUsed ? '' : 'hidden';
  }
}

function startSceneLoop() {
  if (!sceneFrameId && scene3d && !document.hidden) {
    lastSceneFrame = 0;
    sceneFrameId = requestAnimationFrame(draw);
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(sceneFrameId);
    sceneFrameId = 0;
  } else startSceneLoop();
});
