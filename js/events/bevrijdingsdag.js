/*
** Bevrijdingsdag: 5 May. Flowers and newspapers on the pavement, and an army jeep drives by.
*/
registerHolidayEvent({
  id: 'bevrijdingsdag',

  isActive(time) {
    return time.month === 5 && time.day === 5;
  },

  props: [
    { image: 'assets/bevrijdingsdag/flowers.png', height: 100, count: [3, 5] },
    { image: 'assets/bevrijdingsdag/flag.png', height: 200, count: [3, 5] },
    // should show bottom right of screen or something instead of as a ground prop
    // { image: 'assets/bevrijdingsdag/krant.png', height: 500, count: 1 },
  ],

  driveBy: { image: 'assets/bevrijdingsdag/jeep.png', width: 150, chance: 0.5 },
});
