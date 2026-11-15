/*
** Holiday registry. Events register date predicates, optional activate/deactivate/tick hooks,
** procedural clothing slots ({ models: ['christmas/student-hat1'], chance: .5 }), ground
** props ({ model: 'easter/egg', height: 100, count: [4, 7] }) and drive-by vehicles
** ({ model: 'bevrijdingsdag/jeep', width: 150, chance: .5 }).
** Fixed props use at: { x, y }; scattered props use count. All positions and sizes are in
** the original 990-unit layout. Models are defined in models3d.js and share GPU primitives.
** draw/drawGround hooks can use scene.ctx for particle effects and scene.models for 3D.
** The scene contract is defined in getEventScene() in main.js. Add new event scripts before main.js.
*/
const holidayEvents = [];
const activeHolidayEvents = new Set();

function registerHolidayEvent(event) {
  holidayEvents.push(event);
}

const amsterdamTimeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
});

// Splits a Date into its Amsterdam wall clock parts (month is 1-12), regardless of the display's timezone
function getAmsterdamTime(date) {
  const time = { date };
  amsterdamTimeFormat.formatToParts(date).forEach((part) => {
    if (part.type !== 'literal') {
      time[part.type] = parseInt(part.value, 10);
    }
  });
  time.daysFromEaster = Math.round((Date.UTC(time.year, time.month - 1, time.day) - getEasterSunday(time.year)) / 86400000);
  return time;
}

// Easter Sunday of a year as a UTC timestamp (Meeus/Jones/Butcher algorithm)
function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

let clothingRevision = 0;

// Pick each outfit once and reuse it until the active holiday changes.
function getStudentClothing(student) {
  if (student.clothingRevision === clothingRevision) return student.clothing;
  const worn = [];
  activeHolidayEvents.forEach((event) => {
    event.clothing?.forEach((slot, slotIndex) => {
      student.outfit ??= {};
      const key = `${event.id}:${slotIndex}`;
      if (!(key in student.outfit)) {
        student.outfit[key] = Math.random() < (slot.chance ?? 1)
          ? slot.models[Math.floor(Math.random() * slot.models.length)] : null;
      }
      if (student.outfit[key]) worn.push(student.outfit[key]);
    });
  });
  student.clothingRevision = clothingRevision;
  student.clothing = worn;
  return worn;
}

/*
** Props: decoration scattered over the pavement
*/
const propStates = new Map(); // event -> placed props, sorted back to front

// Where props may land, as polygons in background pixels: the pavements, minus the tree, shelter and sign.
// Props in a `front` zone are drawn in front of the busses (like the students of the bottom stop), the
// rest is drawn under them.
const propZones = [
  {
    // In front of the tree and shelter, along the front edge of the main pavement
    points: [{ x: 25, y: 515 }, { x: 95, y: 532 }, { x: 180, y: 548 }, { x: 222, y: 566 }, { x: 232, y: 628 }, { x: 210, y: 636 }, { x: 120, y: 586 }, { x: 40, y: 542 }],
  },
  {
    // Behind the bus stop sign, up to the curb
    points: [{ x: 440, y: 315 }, { x: 600, y: 388 }, { x: 600, y: 412 }, { x: 470, y: 488 }, { x: 440, y: 470 }],
  },
  // {
  //   // The strip between the two lanes
  //   points: [{ x: 360, y: 725 }, { x: 735, y: 485 }, { x: 805, y: 510 }, { x: 415, y: 755 }],
  // },
  {
    // The pavement along the far lane, where the students of the bottom stop wait
    points: [{ x: 555, y: 830 }, { x: 925, y: 600 }, { x: 975, y: 625 }, { x: 600, y: 880 }],
    front: true,
  },
].map((zone) => ({ ...zone, area: getPolygonArea(zone.points) }));

function getPolygonArea(points) {
  let area = 0;
  points.forEach((p, i) => {
    const next = points[(i + 1) % points.length];
    area += p.x * next.y - next.x * p.y;
  });
  return Math.abs(area) / 2;
}

function isInPolygon(point, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

// A random spot in the zones, larger zones are more likely
function getRandomPropSpot() {
  let pick = Math.random() * propZones.reduce((sum, zone) => sum + zone.area, 0);
  const zone = propZones.find((z) => (pick -= z.area) <= 0) ?? propZones[propZones.length - 1];
  const xs = zone.points.map((p) => p.x);
  const ys = zone.points.map((p) => p.y);

  for (let attempt = 0; attempt < 100; attempt++) {
    const point = {
      x: randomBetween(Math.min(...xs), Math.max(...xs)),
      y: randomBetween(Math.min(...ys), Math.max(...ys)),
    };
    if (isInPolygon(point, zone.points)) {
      return { ...point, front: zone.front === true };
    }
  }
  return { x: zone.points[0].x, y: zone.points[0].y, front: zone.front === true };
}

function scatterProps(specs) {
  const placed = [];
  // The ground is seen at an angle, so vertical distances count double
  const isFree = (point, spec) => placed.every((other) =>
    Math.hypot(point.x - other.x, (point.y - other.y) * 2) > (spec.height + other.spec.height) * 0.5
  );

  specs.filter((spec) => spec.at).forEach((spec) => placed.push({ spec, x: spec.at.x, y: spec.at.y, front: spec.front === true }));

  specs.filter((spec) => !spec.at).forEach((spec) => {
    const count = Array.isArray(spec.count)
      ? Math.floor(randomBetween(spec.count[0], spec.count[1] + 1))
      : (spec.count ?? 1);

    for (let n = 0; n < count; n++) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const point = getRandomPropSpot();
        if (isFree(point, spec)) {
          placed.push({ spec, x: point.x, y: point.y, front: point.front });
          break;
        }
      }
    }
  });

  return placed.sort((a, b) => a.y - b.y);
}

function drawProps(scene, placed, front) {
  placed.forEach((prop) => {
    if (prop.front === front) scene.models.draw(prop.spec.model, prop.x, prop.y, prop.spec.height);
  });
}

/*
** Drive-bys: a vehicle that drives the route A lane just ahead of the bus, at the same speed. Where the bus
** stops at the stop, the vehicle carries on to the destination.
*/
const driveByStates = new Map(); // event -> { startTime } (0 = not driving)

// Called whenever a new pair of busses is about to arrive, so the vehicle and the bus start together
function startHolidayBusCycle() {
  driveByStates.forEach((state, event) => {
    if (!state.startTime && Math.random() < (event.driveBy.chance ?? 0.5)) {
      state.startTime = Date.now();
    }
  });
}

// How far ahead of the bus (in background pixels, along the lane) the vehicle starts: half a bus
// (about 340 long) plus half the vehicle plus some room, so it never overlaps the bus
function getDriveByLead(spec) {
  return spec.lead ?? (340 + spec.width * 0.9) / 2 + 40;
}

function drawDriveBy(scene, spec, state, now) {
  const { spawn, stop, destination } = scene.pointsOfInterest.routeA;
  const toStop = Math.hypot(stop.x - spawn.x, stop.y - spawn.y);
  const toDestination = Math.hypot(destination.x - stop.x, destination.y - stop.y);
  const speed = toStop / BUS_TRAVEL_DURATION; // the bus's speed on its way to the stop, in canvas pixels per ms
  const lead = getDriveByLead(spec) * scene.scale;

  const elapsed = now - state.startTime;
  const distance = lead + speed * elapsed; // along the lane: spawn > stop > destination
  const totalDistance = toStop + toDestination;

  if (distance >= totalDistance) {
    state.startTime = 0;
    return;
  }

  // Follow the same two legs as the bus does
  const [from, to, progress] = distance <= toStop
    ? [spawn, stop, distance / toStop]
    : [stop, destination, (distance - toStop) / toDestination];
  // The points are the top-left of a bus image, so add half a bus to get to the middle of the lane
  const x = from.x + (to.x - from.x) * progress + scene.busSize.width / 2;
  const y = from.y + (to.y - from.y) * progress + scene.busSize.height / 2;
  const width = spec.width * scene.scale;
  const height = width * .65;

  // Fade in and out like the busses do
  const remaining = (totalDistance - distance) / speed;
  const alpha = Math.max(0, Math.min(1, elapsed / FADE_TIME, remaining / FADE_TIME));
  scene.models.draw(spec.model, x, y + 70, height, 0, alpha, -.23);
}

let lastHolidayEventSecond = null;

// Starts, stops and ticks events. Only does work once a second, the date can't change faster than that.
function updateHolidayEvents(scene, date) {
  const second = Math.floor(date.getTime() / 1000);
  if (second === lastHolidayEventSecond) {
    return;
  }
  lastHolidayEventSecond = second;

  const time = getAmsterdamTime(date);

  // Fallback events only run while nothing else does, so a holiday can replace the default scenery
  const anyRegularActive = holidayEvents.some((event) => !event.isFallback && event.isActive(time));

  holidayEvents.forEach((event) => {
    const active = event.isFallback ? !anyRegularActive : event.isActive(time);
    const wasActive = activeHolidayEvents.has(event);

    if (active && !wasActive) {
      activeHolidayEvents.add(event);
      clothingRevision++;
      if (event.props) {
        propStates.set(event, scatterProps(event.props));
      }
      if (event.driveBy) {
        driveByStates.set(event, { startTime: 0 });
      }
      event.activate?.(scene, time);
    } else if (!active && wasActive) {
      activeHolidayEvents.delete(event);
      clothingRevision++;
      propStates.delete(event);
      driveByStates.delete(event);
      event.deactivate?.(scene);
    }

    if (active) {
      event.tick?.(time, scene);
    }
  });
}

function drawHolidayEvents(scene, now) {
  activeHolidayEvents.forEach((event) => {
    if (!event.draw) {
      return;
    }

    // Events start from a clean canvas state (the scene is drawn with a night filter) and can't leak theirs
    scene.ctx.save();
    scene.ctx.filter = 'none';
    event.draw(scene, now);
    scene.ctx.restore();
  });
}

// The ground layer: drawn right after the background, so students and busses walk and drive over it
function drawHolidayGround(scene, now) {
  activeHolidayEvents.forEach((event) => {
    scene.ctx.save();
    scene.ctx.filter = scene.nightFilter; // it gets the same night as the background
    if (propStates.has(event)) {
      drawProps(scene, propStates.get(event), false);
    }
    event.drawGround?.(scene, now);
    scene.ctx.restore();
  });
}

// Vehicles are drawn in the same layer as the busses: over the students of the top stop, under those of the bottom stop
function drawHolidayVehicles(scene, now) {
  activeHolidayEvents.forEach((event) => {
    if (driveByStates.get(event)?.startTime) {
      scene.ctx.save();
      scene.ctx.filter = scene.nightFilter;
      drawDriveBy(scene, event.driveBy, driveByStates.get(event), now);
      scene.ctx.restore();
    }
  });
}

// The part of the ground that lies in front of the busses (the bottom stop): drawn after them, under the
// students who walk there
function drawHolidayFrontGround(scene) {
  activeHolidayEvents.forEach((event) => {
    if (propStates.has(event)) {
      scene.ctx.save();
      scene.ctx.filter = scene.nightFilter;
      drawProps(scene, propStates.get(event), true);
      scene.ctx.restore();
    }
  });
}
