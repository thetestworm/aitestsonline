/** Global tuning constants. World units: 1 unit = 1 grid tile. Forward is -Z. */

/** Playable columns run from -PLAY_HALF to +PLAY_HALF inclusive. */
export const PLAY_HALF = 4;
export const PLAY_COLS = PLAY_HALF * 2 + 1;
/** Moving things wrap around inside [-LANE_HALF_SPAN, LANE_HALF_SPAN]. */
export const LANE_HALF_SPAN = 20;
/** Lanes are drawn this wide (half-width) so landscape screens are covered. */
export const VISUAL_HALF_WIDTH = 24;
/** Decorative props are scattered out to this column on grass lanes. */
export const DECOR_HALF = 13;

export const FIXED_STEP = 1 / 60;
export const MAX_FRAME_DT = 0.1;
export const MAX_STEPS_PER_FRAME = 5;

export const HOP_DURATION = 0.13;
export const HOP_HEIGHT = 0.55;
export const LAND_SQUASH_TIME = 0.09;
/** Inputs arriving this late in a hop are queued instead of dropped. */
export const INPUT_BUFFER_SIZE = 2;
/** Player is considered killed off-screen when carried past this |x|. */
export const DRIFT_DEATH_X = PLAY_HALF + 1.15;
/** Half-width of the player's collision box. */
export const PLAYER_HALF_WIDTH = 0.3;

/** Rows behind the camera focus before the predator swoops in. */
export const BACK_LIMIT_ROWS = 4;
/** Seconds without hopping before the predator arrives. */
export const IDLE_LIMIT_SECONDS = 9;

/** Rows the player may move backwards from the start line. */
export const MIN_ROW = -2;
/** Rows generated ahead of the camera focus. */
export const GEN_AHEAD = 26;
/** Lanes further than this behind the focus are disposed. */
export const DISPOSE_BEHIND = 12;

export const PRIZE_COST = 100;
export const DAILY_GIFT_MIN = 30;
export const DAILY_GIFT_MAX = 80;

export const PLAYER_COLORS = ['#ffd23f', '#3fc1ff', '#ff5d8f', '#7cff6b'] as const;
