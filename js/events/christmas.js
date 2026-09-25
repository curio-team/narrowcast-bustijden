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
    { images: ['assets/christmas/student-sweater1.png'], chance: 0.4 },
    { images: ['assets/christmas/student-hat1.png'], chance: 0.4 },
  ],

  props: [
    { image: 'assets/sinterklaas/present1.png', height: 100, count: [1, 3] },
    { image: 'assets/sinterklaas/present2.png', height: 100, count: [1, 3] },
    { image: 'assets/sinterklaas/present3.png', height: 100, count: [1, 3] },
    { image: 'assets/sinterklaas/present4.png', height: 100, count: [1, 3] },
  ],
});
