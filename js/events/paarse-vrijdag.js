/*
** Paarse Vrijdag: the second Friday of October. Students wear a purple t-shirt, and every now and then a
** purple shimmer sweeps across the screen while confetti and hearts flutter down.
*/
(() => {
  const SHOWER_DURATION = 5000; // how long new confetti keeps falling in, in ms
  const SWEEP_DURATION = 2500;
  const PIECES_PER_SECOND = 60;
  const COLORS = ['#7b2cbf', '#9d4edd', '#c77dff', '#e0aaff', '#5a189a', '#ffffff'];

  let pieces = [];
  let showerStartTime = 0; // 0 = no shower going on
  let nextShowerTime = 0;
  let lastFrameTime = 0;

  function spawnPiece(scene) {
    const size = scene.height * randomBetween(0.008, 0.016);
    pieces.push({
      x: Math.random() * scene.width,
      y: -size * 2,
      vy: scene.height * randomBetween(0.08, 0.16), // px per second
      size,
      isHeart: Math.random() < 0.25,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      swayPhase: Math.random() * Math.PI * 2,
      swaySpeed: randomBetween(1, 2.5),
      swayWidth: scene.width * randomBetween(0.005, 0.015),
      rotation: Math.random() * Math.PI * 2,
      spin: randomBetween(-3, 3),
      flipSpeed: randomBetween(3, 8), // the paper flips around, so it looks thinner and wider in turns
    });
  }

  function drawHeart(ctx, size) {
    ctx.beginPath();
    ctx.moveTo(0, size * 0.35);
    ctx.bezierCurveTo(-size * 1.1, -size * 0.35, -size * 0.45, -size * 1, 0, -size * 0.45);
    ctx.bezierCurveTo(size * 0.45, -size * 1, size * 1.1, -size * 0.35, 0, size * 0.35);
    ctx.fill();
  }

  function drawPieces(scene, now, dt) {
    const ctx = scene.ctx;

    pieces = pieces.filter((piece) => {
      piece.y += piece.vy * dt;
      piece.rotation += piece.spin * dt;
      if (piece.y > scene.height + piece.size * 2) {
        return false;
      }

      const t = now / 1000;
      const x = piece.x + Math.sin(t * piece.swaySpeed + piece.swayPhase) * piece.swayWidth;
      ctx.save();
      ctx.translate(x, piece.y);
      ctx.fillStyle = piece.color;

      if (piece.isHeart) {
        ctx.rotate(Math.sin(t * 2 + piece.swayPhase) * 0.3); // hearts rock instead of tumbling
        drawHeart(ctx, piece.size * 1.4);
      } else {
        ctx.rotate(piece.rotation);
        ctx.scale(1, Math.cos(t * piece.flipSpeed + piece.swayPhase));
        ctx.fillRect(-piece.size / 2, -piece.size * 0.3, piece.size, piece.size * 0.6);
      }

      ctx.restore();
      return true;
    });
  }

  // A soft diagonal band of purple light that crosses the screen from left to right
  function drawSweep(scene, progress) {
    const ctx = scene.ctx;
    const bandWidth = scene.width * 0.35;
    const center = -bandWidth + (scene.width + bandWidth * 2) * progress;
    const slant = scene.height * 0.4;
    const gradient = ctx.createLinearGradient(center - bandWidth, 0, center + bandWidth, slant);

    gradient.addColorStop(0, 'rgba(157, 78, 221, 0)');
    gradient.addColorStop(0.5, 'rgba(199, 125, 255, 0.35)');
    gradient.addColorStop(1, 'rgba(157, 78, 221, 0)');

    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, scene.width, scene.height);
    ctx.globalCompositeOperation = 'source-over';
  }

  registerHolidayEvent({
    id: 'paarse-vrijdag',

    isActive(time) {
      const weekday = new Date(Date.UTC(time.year, time.month - 1, time.day)).getUTCDay();
      return time.month === 10 && weekday === 5 && time.day >= 8 && time.day <= 14;
    },

    clothing: [
      { images: ['assets/paarse-vrijdag/t-shirt.png'], chance: 0.7 },
    ],

    activate() {
      pieces = [];
      showerStartTime = 0;
      nextShowerTime = Date.now() + randomBetween(10000, 30000);
      lastFrameTime = 0;
    },

    deactivate() {
      pieces = [];
      showerStartTime = 0;
    },

    draw(scene, now) {
      const dt = lastFrameTime ? Math.min(0.05, (now - lastFrameTime) / 1000) : 0;
      lastFrameTime = now;

      if (!showerStartTime && now >= nextShowerTime) {
        showerStartTime = now;
      }

      if (showerStartTime) {
        const elapsed = now - showerStartTime;

        if (elapsed < SWEEP_DURATION) {
          drawSweep(scene, elapsed / SWEEP_DURATION);
        }
        if (elapsed < SHOWER_DURATION) {
          // About 60 a second; at 60fps that's one a frame, the random part covers the fraction
          const count = PIECES_PER_SECOND * dt;
          for (let n = Math.floor(count) + (Math.random() < count % 1 ? 1 : 0); n > 0; n--) {
            spawnPiece(scene);
          }
        } else if (!pieces.length) {
          showerStartTime = 0;
          nextShowerTime = now + randomBetween(60000, 180000);
        }
      }

      drawPieces(scene, now, dt);
    },
  });
})();
