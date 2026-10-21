import { describe, expect, it } from 'vitest';
import { classifyGesture, zoneForX } from '../src/core/gestures';

describe('gestures', () => {
  it('treats small movements as taps', () => {
    expect(classifyGesture(3, -4, 120)).toBe('tap');
    expect(classifyGesture(0, 0, 900)).toBeNull();
  });
  it('classifies swipes by dominant axis', () => {
    expect(classifyGesture(60, 10, 150)).toBe('right');
    expect(classifyGesture(-60, 10, 150)).toBe('left');
    expect(classifyGesture(5, -50, 150)).toBe('up');
    expect(classifyGesture(5, 50, 150)).toBe('down');
  });
  it('maps touches to multiplayer zones', () => {
    expect(zoneForX(10, 400, 1)).toBe(0);
    expect(zoneForX(10, 400, 2)).toBe(0);
    expect(zoneForX(390, 400, 2)).toBe(1);
    expect(zoneForX(399, 400, 4)).toBe(3);
    expect(zoneForX(-5, 400, 4)).toBe(0);
  });
});
