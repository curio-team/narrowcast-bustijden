/*
** Oud & Nieuw: 31 December and 1 January. A glowing banner with the coming year, and fireworks
** once it's dark. In the first minute of the new year there's a finale.
*/
(() => {
  const MAX_SPARKS = 1500;

  let banner = null;
  let rockets = [];
  let sparks = [];
  let nextLaunchTime = 0;
  let lastFrameTime = 0;
  let isFinale = false;

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  // 31 Dec 2026 and 1 Jan 2027 both celebrate 2027
  function getCelebratedYear(time) {
    return time.month === 12 ? time.year + 1 : time.year;
  }

  function launchRocket(scene) {
    rockets.push({
      x: randomBetween(0.1, 0.9) * scene.width,
      y: scene.height,
      targetY: randomBetween(0.15, 0.5) * scene.height,
      speed: scene.height * randomBetween(0.55, 0.8), // px per second
      hue: randomBetween(0, 360),
    });
  }

  function explode(scene, rocket) {
    const count = Math.floor(randomBetween(50, 90));
    const power = scene.height * randomBetween(0.18, 0.32);
    const twoTone = Math.random() < 0.4;

    for (let i = 0; i < count && sparks.length < MAX_SPARKS; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = power * randomBetween(0.6, 1);
      const life = randomBetween(1.2, 2);
      sparks.push({
        x: rocket.x,
        y: rocket.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        hue: twoTone && i % 2 ? rocket.hue + 50 : rocket.hue,
      });
    }
  }

  function updateRockets(scene, dt) {
    rockets = rockets.filter((rocket) => {
      rocket.y -= rocket.speed * dt;

      if (sparks.length < MAX_SPARKS) { // a short fading trail
        sparks.push({ x: rocket.x, y: rocket.y, vx: 0, vy: 0, life: 0.35, maxLife: 0.35, hue: 40 });
      }

      if (rocket.y <= rocket.targetY) {
        explode(scene, rocket);
        return false;
      }
      return true;
    });
  }

  function updateSparks(scene, dt) {
    const drag = Math.pow(0.35, dt);
    const gravity = scene.height * 0.12;

    sparks = sparks.filter((spark) => {
      spark.life -= dt;
      spark.vx *= drag;
      spark.vy = spark.vy * drag + gravity * dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      return spark.life > 0;
    });
  }

  function drawSparks(scene) {
    const ctx = scene.ctx;
    const radius = Math.max(1.5, scene.height * 0.0025);

    ctx.globalCompositeOperation = 'lighter'; // overlapping sparks add up to a glow
    sparks.forEach((spark) => {
      const alpha = Math.min(1, spark.life / spark.maxLife * 1.5);
      ctx.fillStyle = `hsla(${spark.hue}, 100%, 60%, ${alpha})`;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  registerHolidayEvent({
    id: 'oud-en-nieuw',

    isActive(time) {
      return (time.month === 12 && time.day === 31) || (time.month === 1 && time.day === 1);
    },

    activate(scene, time) {
      banner = document.createElement('div');
      banner.className = 'event-new-year-banner';
      banner.innerHTML = '<span class="event-new-year-greeting">Gelukkig Nieuwjaar</span><span class="event-new-year-year"></span>';
      document.body.appendChild(banner);
      lastFrameTime = 0;
    },

    deactivate() {
      banner?.remove();
      banner = null;
      rockets = [];
      sparks = [];
    },

    tick(time) {
      banner.querySelector('.event-new-year-year').textContent = getCelebratedYear(time);
      isFinale = time.month === 1 && time.hour === 0 && time.minute === 0;
    },

    draw(scene, now) {
      const dt = lastFrameTime ? Math.min(0.05, (now - lastFrameTime) / 1000) : 0;
      lastFrameTime = now;

      // Only fire new rockets when it's dark enough to see them
      if (scene.darkness > 0.3 && now >= nextLaunchTime) {
        launchRocket(scene);
        nextLaunchTime = now + randomBetween(400, 1500) / (isFinale ? 6 : 1);
      }

      updateRockets(scene, dt);
      updateSparks(scene, dt);
      drawSparks(scene);
    },
  });
})();
