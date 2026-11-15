/*
** Pasen: from the Thursday before Easter up to and including Easter Monday. Eggs and bunnies on the pavement.
*/
registerHolidayEvent({
  id: 'easter',

  isActive(time) {
    return time.daysFromEaster >= -3 && time.daysFromEaster <= 1;
  },

  props: [
    { model: 'easter/egg', height: 100, count: [4, 7] },
    { model: 'easter/eggs', height: 100, count: [2, 3] },
    { model: 'easter/egg-chick', height: 100, count: [1, 2] },
    { model: 'easter/choco-bunny', height: 100, count: [1, 2] },
    { model: 'easter/bunny', height: 200, count: 1 },
  ],
});
