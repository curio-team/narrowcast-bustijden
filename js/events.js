/*
** Holiday events
**
** Each event lives in its own file in js/events/ and registers itself here:
**
**   registerHolidayEvent({
**     id: 'my-event',
**     isActive(time) { return time.month === 2 && time.day === 14; },
**     isFallback: true,           // optional: no isActive needed, runs only while no non-fallback event is active
**     activate(scene) { },        // optional: the event just became active (create DOM, reset state)
**     deactivate(scene) { },      // optional: the event just ended (clean up whatever activate() made)
**     tick(time, scene) { },      // optional: about once a second while active
**     draw(scene, now) { },       // optional: every frame while active, on top of the finished scene
**   });
**
** `time` is the current date in Amsterdam (see getAmsterdamTime), `scene` is described in getEventScene()
** in main.js. Add the new file to index.html, before main.js. New hooks (e.g. for the sky or the students)
** can be added by calling them from updateHolidayEvents/drawHolidayEvents below.
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
  return time;
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
      event.activate?.(scene, time);
    } else if (!active && wasActive) {
      activeHolidayEvents.delete(event);
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
