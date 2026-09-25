/*
** Halloween: the week up to and including 31 October. Pumpkins and a broom on the pavement.
*/
registerHolidayEvent({
  id: 'halloween',

  isActive(time) {
    return time.month === 10 && time.day >= 24;
  },

  props: [
    { image: 'assets/halloween/pumpkin1.png', height: 90, count: [1, 2] },
    { image: 'assets/halloween/pumpkin2.png', height: 90, count: [2, 3] },
    { image: 'assets/halloween/pumpkin3.png', height: 90, count: [2, 3] },
  ],
});
