/*
** Sinterklaas: from the arrival (15 November) up to and including Pakjesavond (5 December). Sinterklaas
** himself stands on one roof, presents are hidden throughout the city and some students wear a hat.
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
    { model: 'sinterklaas/present1', height: 40, count: [1, 3] },
    { model: 'sinterklaas/present2', height: 40, count: [1, 3] },
    { model: 'sinterklaas/present3', height: 40, count: [1, 3] },
    { model: 'sinterklaas/present4', height: 40, count: [1, 3] },
  ],
  cityProps: [
    { model: 'sinterklaas/sinterklaas', height: 120, count: 1, placements: ['roof'], unique: true },
    ...[1, 2, 3, 4].map((variant) => ({ model: `sinterklaas/present${variant}`, height: 40, count: 12 })),
  ],
});
