/** Pointer gesture classification for touch controls (pure, unit-tested). */
export type Dir = 'up' | 'down' | 'left' | 'right';
export type Gesture = Dir | 'tap' | null;

export interface GestureConfig {
  /** Movement below this many CSS px counts as a tap. */
  deadZone: number;
  /** Taps/swipes longer than this many ms are ignored (likely a scroll/hold). */
  maxDuration: number;
}

export const DEFAULT_GESTURE: GestureConfig = { deadZone: 14, maxDuration: 600 };

export function classifyGesture(
  dx: number,
  dy: number,
  durationMs: number,
  cfg: GestureConfig = DEFAULT_GESTURE,
): Gesture {
  const dist = Math.hypot(dx, dy);
  if (dist < cfg.deadZone) return durationMs <= cfg.maxDuration ? 'tap' : null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** Which multiplayer touch zone a screen x falls into (vertical strips). */
export function zoneForX(x: number, width: number, players: number): number {
  if (players <= 1 || width <= 0) return 0;
  const z = Math.floor((x / width) * players);
  return z < 0 ? 0 : z >= players ? players - 1 : z;
}
