import { describe, expect, it } from 'vitest';
import {
  coinsInReach,
  findPlatform,
  hitSpan,
  inPlayableColumns,
  isBehindCamera,
  isDriftedOff,
  overlaps1D,
  snapToPlatformCell,
} from '../src/core/collision';
import { DRIFT_DEATH_X } from '../src/core/constants';

describe('collision', () => {
  it('overlaps1D treats touching edges as not overlapping', () => {
    expect(overlaps1D(0, 1, 1, 2)).toBe(false);
    expect(overlaps1D(0, 1.01, 1, 2)).toBe(true);
    expect(overlaps1D(-1, 3, 0, 1)).toBe(true);
  });

  it('detects vehicle hits against the player hitbox', () => {
    const cars = [
      { x: -5, len: 1.6 },
      { x: 0.9, len: 1.6 },
    ];
    expect(hitSpan(0, cars)).toBe(1);
    expect(hitSpan(-2, cars)).toBe(-1);
    // The forgiving shrink lets a car's bumper graze past.
    expect(hitSpan(1.95, cars)).toBe(-1);
  });

  it('respects the active count for pooled arrays', () => {
    const spans = [
      { x: 10, len: 2 },
      { x: 0, len: 2 },
    ];
    expect(hitSpan(0, spans, 1)).toBe(-1);
    expect(hitSpan(0, spans, 2)).toBe(1);
  });

  it('finds the platform under the player with forgiveness', () => {
    const logs = [{ x: 2, len: 3 }];
    expect(findPlatform(2, logs)).toBe(0);
    expect(findPlatform(3.6, logs)).toBe(0);
    expect(findPlatform(3.8, logs)).toBe(-1);
    expect(findPlatform(-1, logs)).toBe(-1);
  });

  it('snaps onto log planks', () => {
    const log = { x: 0, len: 3 };
    expect(snapToPlatformCell(-1.2, log)).toBeCloseTo(-1);
    expect(snapToPlatformCell(0.2, log)).toBeCloseTo(0);
    expect(snapToPlatformCell(1.6, log)).toBeCloseTo(1);
    expect(snapToPlatformCell(5, log)).toBeCloseTo(1);
    const lily = { x: 3, len: 1 };
    expect(snapToPlatformCell(3.3, lily)).toBeCloseTo(3);
  });

  it('kills players carried off screen', () => {
    expect(isDriftedOff(0)).toBe(false);
    expect(isDriftedOff(DRIFT_DEATH_X + 0.01)).toBe(true);
    expect(isDriftedOff(-DRIFT_DEATH_X - 0.01)).toBe(true);
  });

  it('bounds columns and camera', () => {
    expect(inPlayableColumns(4)).toBe(true);
    expect(inPlayableColumns(5)).toBe(false);
    expect(isBehindCamera(10, 15, 4)).toBe(true);
    expect(isBehindCamera(11, 15, 4)).toBe(false);
  });

  it('collects coins within a magnet radius', () => {
    expect(coinsInReach(0, [0, 1, -2])).toEqual([0]);
    expect(coinsInReach(0, [0, 1, -2], 1)).toEqual([0, 1]);
  });
});
