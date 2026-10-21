/**
 * Pure collision helpers. They operate on plain numbers/arrays so they can be
 * unit-tested without Three.js and run allocation-free in the hot loop.
 */
import { PLAY_HALF, PLAYER_HALF_WIDTH, DRIFT_DEATH_X } from './constants';

/** Anything occupying an x-interval in a lane: vehicles, logs, lily pads, trains. */
export interface Span {
  x: number;
  len: number;
}

export function overlaps1D(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return aMin < bMax && bMin < aMax;
}

/** Index of the first span overlapping the player's hitbox, or -1. */
export function hitSpan(
  playerX: number,
  spans: readonly Span[],
  count = spans.length,
  halfWidth = PLAYER_HALF_WIDTH,
  shrink = 0.08,
): number {
  const pMin = playerX - halfWidth;
  const pMax = playerX + halfWidth;
  for (let i = 0; i < count; i++) {
    const s = spans[i];
    const h = s.len / 2 - shrink;
    if (overlaps1D(pMin, pMax, s.x - h, s.x + h)) return i;
  }
  return -1;
}

/**
 * Platform the player is standing on. The player's centre must be over the
 * platform (with a little forgiveness) to count as a safe landing.
 */
export function findPlatform(
  playerX: number,
  spans: readonly Span[],
  count = spans.length,
  forgiveness = 0.18,
): number {
  for (let i = 0; i < count; i++) {
    const s = spans[i];
    const h = s.len / 2 + forgiveness;
    if (playerX >= s.x - h && playerX <= s.x + h) return i;
  }
  return -1;
}

/**
 * Snap a landing x onto the nearest whole "cell" of a platform so hopping along
 * a log always lines up with its planks.
 */
export function snapToPlatformCell(playerX: number, span: Span): number {
  const left = span.x - span.len / 2;
  const cells = Math.max(1, Math.round(span.len));
  let idx = Math.floor(playerX - left);
  if (idx < 0) idx = 0;
  if (idx > cells - 1) idx = cells - 1;
  return left + idx + 0.5;
}

/** Player carried by a platform beyond the screen edge. */
export function isDriftedOff(playerX: number): boolean {
  return playerX < -DRIFT_DEATH_X || playerX > DRIFT_DEATH_X;
}

export function inPlayableColumns(col: number): boolean {
  return col >= -PLAY_HALF && col <= PLAY_HALF;
}

/** True if the player has fallen too far behind the scrolling camera. */
export function isBehindCamera(playerRow: number, focusRow: number, limit: number): boolean {
  return playerRow < focusRow - limit;
}

/** Collect any coins in `coins` within `radius` columns of `col`. Returns indices. */
export function coinsInReach(col: number, coins: readonly number[], radius = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < coins.length; i++) if (Math.abs(coins[i] - col) <= radius) out.push(i);
  return out;
}
