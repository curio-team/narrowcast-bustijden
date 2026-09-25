/*
** Sinterklaas: from the arrival (15 November) up to and including Pakjesavond (5 December). Sinterklaas
** himself stands at the stop, presents lie around and some students wear a hat.
*/
registerHolidayEvent({
  id: 'sinterklaas',

  isActive(time) {
    return (time.month === 11 && time.day >= 15) || (time.month === 12 && time.day <= 5);
  },

  clothing: [
    {
      images: [
        'assets/sinterklaas/student-hat1.png',
        'assets/sinterklaas/student-hat2.png',
        'assets/sinterklaas/student-hat3.png',
      ],
      chance: 0.5,
    },
  ],

  props: [
    { image: 'assets/sinterklaas/sinterklaas.png', height: 120, at: { x: 140, y: 590 } },
    { image: 'assets/sinterklaas/present1.png', height: 100, count: [1, 3] },
    { image: 'assets/sinterklaas/present2.png', height: 100, count: [1, 3] },
    { image: 'assets/sinterklaas/present3.png', height: 100, count: [1, 3] },
    { image: 'assets/sinterklaas/present4.png', height: 100, count: [1, 3] },
  ],
});
