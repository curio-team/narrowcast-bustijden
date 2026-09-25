/*
** Balloon: the default scenery. A balloon occasionally drifts across the whole screen, above everything
** else. It's a fallback event, so it only shows when no holiday is active (a holiday brings its own
** drifting thing instead).
*/
(() => {
  const balloonImage = new Image();
  balloonImage.src = 'assets/balloon.png';

  let balloon = null;
  let nextBalloonTime = 0;

  registerHolidayEvent({
    id: 'balloon',
    isFallback: true,

    activate() {
      balloon = null;
      nextBalloonTime = Date.now() + randomBetween(5000, 15000);
    },

    deactivate() {
      balloon = null;
    },

    draw(scene, now) {
      if (!balloon) {
        if (now < nextBalloonTime || !balloonImage.complete || !balloonImage.naturalWidth) {
          return;
        }

        const height = scene.height * randomBetween(0.3, 0.4);
        const width = height * balloonImage.naturalWidth / balloonImage.naturalHeight;
        const leftToRight = Math.random() < 0.5;
        balloon = {
          startTime: now,
          duration: randomBetween(25000, 40000),
          width,
          height,
          fromX: leftToRight ? -width : scene.width + width,
          toX: leftToRight ? scene.width + width : -width,
          baseY: scene.height * randomBetween(0.1, 0.5),
          bobPhase: Math.random() * Math.PI * 2,
        };
      }

      const progress = (now - balloon.startTime) / balloon.duration;
      if (progress >= 1) {
        balloon = null;
        nextBalloonTime = now + randomBetween(30000, 90000);
        return;
      }

      const x = balloon.fromX + (balloon.toX - balloon.fromX) * progress;
      const y = balloon.baseY + Math.sin(now / 1200 + balloon.bobPhase) * balloon.height * 0.15;
      scene.ctx.filter = nightFilter; // it flies through the same night as the rest of the scene
      scene.ctx.drawImage(balloonImage, x - balloon.width / 2, y - balloon.height / 2, balloon.width, balloon.height);
    },
  });
})();
