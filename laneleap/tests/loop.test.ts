import { describe, expect, it } from 'vitest';
import { FixedLoop } from '../src/core/loop';
import { FIXED_STEP, MAX_STEPS_PER_FRAME } from '../src/core/constants';

describe('FixedLoop', () => {
  it('advances in fixed steps and carries the remainder', () => {
    let t = 0;
    const loop = new FixedLoop((dt) => (t += dt), () => undefined);
    expect(loop.tick(FIXED_STEP * 2.5)).toBe(2);
    expect(loop.tick(FIXED_STEP * 0.6)).toBe(1);
    expect(t).toBeCloseTo(FIXED_STEP * 3);
  });

  it('clamps huge deltas from tab switches', () => {
    let steps = 0;
    const loop = new FixedLoop(() => steps++, () => undefined);
    loop.tick(30);
    expect(steps).toBeLessThanOrEqual(MAX_STEPS_PER_FRAME);
  });
});
