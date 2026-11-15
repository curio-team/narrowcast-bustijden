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
      models: [
        'sinterklaas/student-hat1',
        'sinterklaas/student-hat2',
        'sinterklaas/student-hat3',
      ],
      chance: 0.5,
    },
  ],

  props: [
    { model: 'sinterklaas/sinterklaas', height: 120, at: { x: 140, y: 590 } },
    { model: 'sinterklaas/present1', height: 40, count: [1, 3] },
    { model: 'sinterklaas/present2', height: 40, count: [1, 3] },
    { model: 'sinterklaas/present3', height: 40, count: [1, 3] },
    { model: 'sinterklaas/present4', height: 40, count: [1, 3] },
  ],
});
