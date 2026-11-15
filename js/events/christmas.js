/*
** Kerst: 6 December (after Sinterklaas) up to and including 26 December. Presents and food on the pavement,
** and some students wear a Christmas sweater or hat.
*/
registerHolidayEvent({
  id: 'christmas',

  isActive(time) {
    return time.month === 12 && time.day >= 6 && time.day <= 26;
  },

  clothing: [
    { models: ['christmas/student-sweater1'], chance: 0.4 },
    { models: ['christmas/student-hat1'], chance: 0.4 },
  ],

  props: [
    { model: 'sinterklaas/present1', height: 40, count: [1, 3] },
    { model: 'sinterklaas/present2', height: 40, count: [1, 3] },
    { model: 'sinterklaas/present3', height: 40, count: [1, 3] },
    { model: 'sinterklaas/present4', height: 40, count: [1, 3] },
  ],
});
