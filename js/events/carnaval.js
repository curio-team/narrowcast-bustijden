/*
** Carnaval: Sunday to Tuesday before Ash Wednesday (49 to 47 days before Easter). Students dress up and a
** parade float drives by.
*/
registerHolidayEvent({
  id: 'carnaval',

  isActive(time) {
    return time.daysFromEaster >= -49 && time.daysFromEaster <= -47;
  },

  clothing: [
    { images: ['assets/carnaval/student-kiel1.png'], chance: 0.4 },
    { images: ['assets/carnaval/student-hat1.png'], chance: 0.5 },
  ],

  driveBy: { image: 'assets/carnaval/parade-car.png', width: 250, chance: 0.9 },
});
