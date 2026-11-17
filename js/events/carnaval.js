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
    { models: ['carnaval/student-kiel1'], chance: 0.4 },
    { models: ['carnaval/student-hat1'], chance: 0.5 },
  ],

  driveBy: { model: 'carnaval/parade-car', width: 400, chance: 0.9 },
});
