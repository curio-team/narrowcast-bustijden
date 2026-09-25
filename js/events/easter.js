/*
** Pasen: from the Thursday before Easter up to and including Easter Monday. Eggs and bunnies on the pavement.
*/
registerHolidayEvent({
  id: 'easter',

  isActive(time) {
    return time.daysFromEaster >= -3 && time.daysFromEaster <= 1;
  },

  props: [
    { image: 'assets/easter/egg.png', height: 100, count: [4, 7] },
    { image: 'assets/easter/eggs.png', height: 100, count: [2, 3] },
    { image: 'assets/easter/egg-chick.png', height: 100, count: [1, 2] },
    { image: 'assets/easter/choco-bunny.png', height: 100, count: [1, 2] },
    { image: 'assets/easter/bunny.png', height: 200, count: 1 },
  ],
});
