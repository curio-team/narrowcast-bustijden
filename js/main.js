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

let currentBusAnimationId = 0;
let stopAreaCode = 'BdOud';
const busAnimationData = [];

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
  busAnimationData[currentBusAnimationId] = {
    direction,
    from,
    to,
    fadeMode, // This can be null if no fading is desired
    startTime: currentTime,
    travelDuration: BUS_TRAVEL_DURATION,
    onArrivalCallback
  };
  currentBusAnimationId++;
}

function removeBusFromAnimationData(index) {
  delete busAnimationData[index];
}

/*
** API data fetching of bus times
*/
Vue.createApp({
  data() {
    return {
      routeA: [],
      routeB: [],
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
            const routes = {
              routeA: {
                element: document.querySelector('.routeA'),
                id: 72000640,
              },
              routeB: {
                element: document.querySelector('.routeB'),
                id: 72000810,
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

              // routes[route].element.querySelector('h2').innerText = routeData.Stop.TimingPointName;
              // Since the stop is the same on both sides, let's hide the heading for now and show the common name
              // as the h1
              routes[route].element.querySelector('h2').style.display = 'none';
              document.querySelector('h1').innerText = `Bustijden ${routeData.Stop.TimingPointName}`;
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
        });
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
const busToCentral = new Image();
busToCentral.src = 'assets/bus-to-central.png';

const busToRoute = new Image();
busToRoute.src = 'assets/bus-to-route.png';

const busToCentralLights = new Image();
busToCentralLights.src = 'assets/bus-to-central-lights.png';

const busToRouteLights = new Image();
busToRouteLights.src = 'assets/bus-to-route-lights.png';
const lightsOriginalSize = 1000; // drawn at the same scale as the bus (busOriginalSize)

const background = new Image();
background.src = 'assets/background.png';

const stopSignRoute = new Image();
stopSignRoute.src = 'assets/stop.png';

const studentImage = new Image();
studentImage.src = 'assets/student.png';
const studentImageAspect = 43 / 103; // width / height of the source image

// Original image pixel sizes and points of interest (x and y of top-left of bus image)
const backgroundOriginalSize = 990;
const busOriginalSize = 350;
const stopSignOriginalSize = 194;
const studentOriginalHeight = 70; // students are drawn much smaller than the bus/stop sign
const backgroundOriginalPointsOfInterest = {
  routeA: {
    spawn: { x: 1259, y: -259 },
    stop: { x: 268, y: 314 },
    destination: { x: -800, y: 900 },
  },
  routeB: {
    spawn: { x: -812, y: 1118 },
    stop: { x: 488, y: 446 },
    destination: { x: 1475, y: -100 },
  },
  stopSignRoute: { x: 785, y: 515 },
}

// Scaled bus size and points of interest
let busSize = busOriginalSize;
let stopSignSize = stopSignOriginalSize;
let studentSize = { width: 0, height: 0 };
let drawArea = {};
let pointsOfInterest = {};

// Get the canvas and its context
const backgroundCanvasElement = document.getElementById('backgroundCanvas');
const backgroundCanvas = backgroundCanvasElement.getContext('2d');
const scaleAnimation = 0.4;

const resizeCanvas = () => {
  backgroundCanvasElement.width = window.innerWidth;
  backgroundCanvasElement.height = window.innerHeight;

  const smallestDimension = Math.min(window.innerWidth * scaleAnimation, window.innerHeight * scaleAnimation);
  drawArea = {
    x: window.innerWidth * .5 - smallestDimension * .5,
    y: window.innerHeight * .5 - smallestDimension * .5,
    width: smallestDimension,
    height: smallestDimension
  };

  // Scale the bus and points of interest to the new canvas size
  const scalePoint = (point) => {
    return {
      x: drawArea.x + drawArea.width * point.x / backgroundOriginalSize,
      y: drawArea.y + drawArea.height * point.y / backgroundOriginalSize
    }
  }

  busSize = {
    width: smallestDimension * busOriginalSize / backgroundOriginalSize,
    height: smallestDimension * busOriginalSize / backgroundOriginalSize
  };

  stopSignSize = {
    width: smallestDimension * stopSignOriginalSize / backgroundOriginalSize,
    height: smallestDimension * stopSignOriginalSize / backgroundOriginalSize
  }

  studentSize.height = smallestDimension * studentOriginalHeight / backgroundOriginalSize;
  studentSize.width = studentSize.height * studentImageAspect;

  pointsOfInterest = {
    routeA: {
      spawn: scalePoint(backgroundOriginalPointsOfInterest.routeA.spawn),
      stop: scalePoint(backgroundOriginalPointsOfInterest.routeA.stop),
      destination: scalePoint(backgroundOriginalPointsOfInterest.routeA.destination)
    },
    routeB: {
      spawn: scalePoint(backgroundOriginalPointsOfInterest.routeB.spawn),
      stop: scalePoint(backgroundOriginalPointsOfInterest.routeB.stop),
      destination: scalePoint(backgroundOriginalPointsOfInterest.routeB.destination)
    },
    stopSignRoute: scalePoint(backgroundOriginalPointsOfInterest.stopSignRoute)
  };
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

/*
** Drawing functions
*/

// Draws the bus at the given position, optionally "running" (bouncing up and down like its engine is running)
function drawBus(bus, x, y, running) {
  if (running) {
    y += Math.sin(Date.now() / 25) * 1;
  }

  backgroundCanvas.drawImage(bus, x, y, busSize.width, busSize.height);

  // Headlight overlay is 1000x1000 for a 350x350 bus, centered on the bus
  const lights = bus === busToCentral ? busToCentralLights : bus === busToRoute ? busToRouteLights : null;
  if (lights && currentDarkness > 0 && lights.complete && lights.naturalWidth) {
    const lightsWidth = busSize.width * lightsOriginalSize / busOriginalSize;
    const lightsHeight = busSize.height * lightsOriginalSize / busOriginalSize;
    const previousAlpha = backgroundCanvas.globalAlpha;
    backgroundCanvas.globalAlpha = previousAlpha * currentDarkness;
    backgroundCanvas.filter = 'none'; // headlights glow, they shouldn't be darkened
    backgroundCanvas.drawImage(
      lights,
      x + busSize.width / 2 - lightsWidth / 2,
      y + busSize.height / 2 - lightsHeight / 2,
      lightsWidth,
      lightsHeight
    );
    backgroundCanvas.globalAlpha = previousAlpha;
    backgroundCanvas.filter = nightFilter;
  }
}

/*
** Time of day
*/

// Estimates how dark it is in Amsterdam (0 = full daylight, 1 = night). Uses solar time
// (UTC + longitude offset), which sidesteps summer/wintertime: the sun is the same either way.
const amsterdamLongitude = 4.9;
// Set window.fakeTime in the console (a Date, timestamp or ISO string like '2026-12-01T23:00:00+01:00') to test other times.
// On localhost you can also pass it as a query parameter: ?fakeTime=2026-12-31T23:59:30+01:00
function getNow() {
  const queryTime = isLocalhost() ? new URLSearchParams(window.location.search).get('fakeTime') : null;
  const fakeTime = window.fakeTime || queryTime;
  return fakeTime ? new Date(fakeTime) : new Date();
}

function getSunElevationHours() {
  const date = getNow();
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date.getTime() - startOfYear) / 86400000;
  const halfDayLength = 6.15 + 2.2 * Math.cos(2 * Math.PI * (dayOfYear - 172) / 365); // ~4h (winter) to ~8.3h (summer)
  const solarHour = (date.getUTCHours() + date.getUTCMinutes() / 60 + amsterdamLongitude / 15) % 24;
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
let lastSkyGradient = '';
function updateTimeOfDay() {
  const e = getSunElevationHours();
  currentDarkness = Math.min(1, Math.max(0, (0.2 - e) / 0.7)); // headlights fade in around dusk

  const gradient = getSkyGradient(e);
  if (gradient !== lastSkyGradient) {
    document.body.style.backgroundImage = gradient;
    lastSkyGradient = gradient;

    const d = currentDarkness;
    const root = document.documentElement.style;
    root.setProperty('--sky-header-bg', `rgba(${mixColor([86, 221, 239], [30, 30, 78], d)}, ${0.5 + 0.25 * d})`);
    root.setProperty('--sky-title', `rgb(${mixColor([105, 25, 124], [222, 208, 255], d)})`);
    root.setProperty('--sky-panel-bg', `rgba(${mixColor([255, 255, 255], [14, 16, 44], d)}, ${0.5 + 0.15 * d})`);
    root.setProperty('--sky-text', `rgb(${mixColor([0, 0, 0], [238, 238, 250], d)})`);
    root.setProperty('--sky-border', `rgb(${mixColor([229, 231, 235], [60, 62, 100], d)})`);
  }

  // Darken and cool down the sprites (canvas filters aren't supported everywhere, then they stay bright)
  nightFilter = currentDarkness > 0.01
    ? `brightness(${1 - 0.5 * currentDarkness}) saturate(${1 - 0.25 * currentDarkness}) hue-rotate(${12 * currentDarkness}deg)`
    : 'none';
}
let nightFilter = 'none';

function drawBackground() {
  backgroundCanvas.drawImage(background, drawArea.x, drawArea.y, drawArea.width, drawArea.height);
}

function drawStopSign() {
  backgroundCanvas.drawImage(stopSignRoute, pointsOfInterest.stopSignRoute.x, pointsOfInterest.stopSignRoute.y, stopSignSize.width, stopSignSize.height);
}

// Draws a student standing on their feet at (x, y), optionally bouncing like they're walking
function drawStudent(student, x, y, walking, alpha) {
  let drawY = y;

  if (walking) {
    const bounce = Math.abs(Math.sin((Date.now() + student.bouncePhase) / student.bounceSpeed));
    drawY -= bounce * studentSize.height * 0.18;
  }

  backgroundCanvas.save();
  backgroundCanvas.globalAlpha = alpha;

  if (student.flip) {
    backgroundCanvas.translate(x, 0);
    backgroundCanvas.scale(-1, 1);
    backgroundCanvas.drawImage(studentImage, -studentSize.width / 2, drawY - studentSize.height, studentSize.width, studentSize.height);
  } else {
    backgroundCanvas.drawImage(studentImage, x - studentSize.width / 2, drawY - studentSize.height, studentSize.width, studentSize.height);
  }

  backgroundCanvas.restore();
}

let debugHelpFindBusPositions = false;
let mouseX = 0;
let mouseY = 0;

// If we're on localhost and the user presses d, we toggle the debug mode to help find the correct bus positions
if (isLocalhost()) {
  window.addEventListener('mousemove', (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'd') {
      debugHelpFindBusPositions = !debugHelpFindBusPositions;
    }
  });
}

// Students walk up to a stop before the bus arrives, wait, then board.
let currentStudentAnimationId = 0;
const studentAnimationData = [];

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// Scales an offset in the original 990x990 space into canvas pixels (no drawArea.x/y, it's a delta)
function scaleOriginalOffset(offset) {
  const scale = drawArea.width / backgroundOriginalSize;
  return { x: offset.x * scale, y: offset.y * scale };
}

// Pixel offsets from each stop (same coord space as backgroundOriginalPointsOfInterest):
// anchorOffset = front of the queue, spawnOffset = where the line starts from.
const studentTuning = {
  routeA: { anchorOffset: { x: 50, y: 222 }, spawnOffset: { x: 600, y: -100 }, spacing: 60, perpJitter: 8 },
  routeB: { anchorOffset: { x: 390, y: 190 }, spawnOffset: { x: -250, y: 600 }, spacing: 60, perpJitter: 8 }
};

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
  const tuning = studentTuning[routeKey];

  const anchor = {
    x: stop.x + scaleOriginalOffset(tuning.anchorOffset).x,
    y: stop.y + scaleOriginalOffset(tuning.anchorOffset).y
  };
  const frontSpawn = {
    x: stop.x + scaleOriginalOffset(tuning.spawnOffset).x,
    y: stop.y + scaleOriginalOffset(tuning.spawnOffset).y
  };

  const lineVec = { x: anchor.x - frontSpawn.x, y: anchor.y - frontSpawn.y };
  const lineLength = Math.hypot(lineVec.x, lineVec.y) || 1;
  const dir = { x: lineVec.x / lineLength, y: lineVec.y / lineLength };
  const perp = { x: -dir.y, y: dir.x };

  const spacing = scaleOriginalOffset({ x: tuning.spacing, y: 0 }).x;
  const jitterMag = scaleOriginalOffset({ x: tuning.perpJitter, y: 0 }).x;

  return { anchor, frontSpawn, dir, perp, spacing, jitterMag, lineLength };
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
      x: geo.anchor.x - geo.dir.x * cumulative + geo.perp.x * student.perpOffset,
      y: geo.anchor.y - geo.dir.y * cumulative + geo.perp.y * student.perpOffset
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
    const perpOffset = randomBetween(-geo.jitterMag * 2.5, geo.jitterMag * 2.5); // spread sideways, not a straight line

    const roughDistance = geo.lineLength + geo.spacing * i;
    const spawnPos = {
      x: geo.anchor.x - geo.dir.x * roughDistance + geo.perp.x * perpOffset,
      y: geo.anchor.y - geo.dir.y * roughDistance + geo.perp.y * perpOffset
    };

    studentAnimationData[currentStudentAnimationId] = {
      route: routeKey,
      seq: studentSequenceCounter++,
      gapToPrev,
      perpOffset,
      spawnTime: Date.now() + spawnDelay,
      moveFrom: spawnPos,
      moveTo: spawnPos,
      moveStartTime: Date.now() + spawnDelay,
      moveDuration: randomBetween(1100, 1900),
      boardStartTime: null,
      boardDuration: null,
      boardPos: null,
      bouncePhase: randomBetween(0, Math.PI * 2),
      bounceSpeed: randomBetween(160, 220),
      flip: Math.random() < 0.5
    };
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
  delete studentAnimationData[index];
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
showTestBusses();
setInterval(showTestBusses, 10000);

// What holiday events (js/events/*.js) get to work with. Live getters, since drawArea etc. are replaced on resize.
function getEventScene() {
  return {
    canvas: backgroundCanvasElement,
    ctx: backgroundCanvas,
    get width() { return backgroundCanvasElement.width; },
    get height() { return backgroundCanvasElement.height; },
    get drawArea() { return drawArea; },
    get pointsOfInterest() { return pointsOfInterest; },
    get darkness() { return currentDarkness; }, // 0 = daylight, 1 = night
  };
}

function draw() {
  backgroundCanvas.clearRect(0, 0, window.innerWidth, window.innerHeight);
  updateTimeOfDay();
  backgroundCanvas.filter = nightFilter;
  drawBackground();

  if (debugHelpFindBusPositions) {
    // Draw a bus at the cursor position and show the x, y coordinates based on the original image size
    // This way we can determine the correct points of interest for the bus
    const x = (mouseX - drawArea.x) * backgroundOriginalSize / drawArea.width;
    const y = (mouseY - drawArea.y) * backgroundOriginalSize / drawArea.height;
    console.log(x, y);

    drawBus(busToCentral, mouseX, mouseY, false);
  }

  const now = new Date().getTime();

  function drawBuses() {
    busAnimationData.forEach((bus, index) => {
      const elapsedTime = now - bus.startTime;

      let alpha = 1;
      let x, y;
      let progress = elapsedTime / bus.travelDuration;

      if (bus.fadeMode && bus.fadeMode.mode === FADE_IN) {
        alpha = Math.min(1, elapsedTime / bus.fadeMode.duration);
      } else if (bus.fadeMode && bus.fadeMode.mode === FADE_OUT) {
        alpha = Math.max(0, 1 - (elapsedTime + bus.fadeMode.duration - bus.travelDuration) / bus.fadeMode.duration);
      }

      if (progress < 1) {
        x = bus.from.x + (bus.to.x - bus.from.x) * progress;
        y = bus.from.y + (bus.to.y - bus.from.y) * progress;
      } else {
        x = bus.to.x;
        y = bus.to.y;
      }

      backgroundCanvas.globalAlpha = alpha;
      drawBus(bus.direction, x, y, progress < 1); // Only bounce if still moving
      backgroundCanvas.globalAlpha = 1;

      if (progress > 1) {
        bus.onArrivalCallback?.(bus, index);
        bus.onArrivalCallback = null;
      }
    });
  }

  function drawStudentsForRoute(routeKey) {
    studentAnimationData.forEach((student, index) => {
      if (student.route !== routeKey || now < student.spawnTime) {
        return;
      }

      let x, y, alpha, walking;

      if (student.boardStartTime !== null && now >= student.boardStartTime) {
        const progress = Math.min(1, (now - student.boardStartTime) / student.boardDuration);

        x = student.boardPos.x;
        y = student.boardPos.y;
        alpha = 1 - progress;
        walking = false;

        if (progress >= 1) {
          removeStudentFromAnimationData(index);
          return;
        }
      } else {
        const pos = getStudentPos(student, now);

        x = pos.x;
        y = pos.y;
        alpha = 1;
        walking = now < student.moveStartTime + student.moveDuration;
      }

      drawStudent(student, x, y, walking, alpha);
    });
  }

  // routeA students draw under the bus, routeB students draw over it
  drawStudentsForRoute('routeA');
  drawBuses();
  drawStudentsForRoute('routeB');

  drawStopSign();

  // Holiday events get the finished scene to update and draw on top of
  const eventScene = getEventScene();
  updateHolidayEvents(eventScene, getNow());
  drawHolidayEvents(eventScene, now);

  requestAnimationFrame(draw);
}

draw();
