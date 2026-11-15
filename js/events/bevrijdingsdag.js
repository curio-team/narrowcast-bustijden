/*
** Bevrijdingsdag: 5 May. Flowers and newspapers on the pavement, and an army jeep drives by.
*/
registerHolidayEvent({
  id: 'bevrijdingsdag',

  isActive(time) {
    return time.month === 5 && time.day === 5;
  },

  props: [
    { model: 'bevrijdingsdag/flowers', height: 100, count: [3, 5] },
    { model: 'bevrijdingsdag/flag', height: 200, count: [3, 5] },
    // should show bottom right of screen or something instead of as a ground prop
    // { model: 'bevrijdingsdag/krant', height: 500, count: 1 },
  ],

  driveBy: { model: 'bevrijdingsdag/jeep', width: 150, chance: 0.5 },
});
