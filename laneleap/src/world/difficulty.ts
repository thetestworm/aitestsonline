/**
 * Smooth difficulty curve in [0, 1). Rises quickly at first and flattens out so
 * long runs keep getting harder without ever becoming a wall.
 */
export function difficultyAt(row: number): number {
  if (row <= 0) return 0;
  return 1 - Math.exp(-row / 160);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Camera auto-scroll speed in rows per second. */
export function scrollSpeedAt(row: number): number {
  return lerp(0.32, 0.85, difficultyAt(row));
}
