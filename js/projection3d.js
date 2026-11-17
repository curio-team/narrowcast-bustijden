// 45° azimuth and 30° elevation give ground axes a regular 2:1 pixel staircase.
export const SIN_ELEVATION = 0.5;
export const COS_ELEVATION = Math.sqrt(3) / 2;
export const GROUND_AXIS_Y = SIN_ELEVATION / Math.SQRT2;
