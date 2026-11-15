/*
** Halloween: the week up to and including 31 October. Pumpkins and a broom on the pavement.
*/
registerHolidayEvent({
  id: 'halloween',

  isActive(time) {
    return time.month === 10 && time.day >= 24;
  },

  props: [
    { model: 'halloween/pumpkin1', height: 90, count: [1, 2] },
    { model: 'halloween/pumpkin2', height: 90, count: [2, 3] },
    { model: 'halloween/pumpkin3', height: 90, count: [2, 3] },
  ],
});
