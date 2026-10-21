import { describe, expect, it } from 'vitest';
import { LaneGenerator, wrap, laneKindsOf } from '../src/world/generator';
import { ALL_COLS, checkLane, validateLayout, moverGaps, minRoadGap } from '../src/world/validator';
import { difficultyAt } from '../src/world/difficulty';
import { PLAY_HALF, LANE_HALF_SPAN } from '../src/core/constants';

function generate(seed: number, rows: number) {
  const g = new LaneGenerator(seed);
  return { g, lanes: g.generateUntil(rows) };
}

describe('LaneGenerator', () => {
  it('produces contiguous rows starting below the start line', () => {
    const { lanes } = generate(1, 200);
    for (let i = 1; i < lanes.length; i++) expect(lanes[i].row).toBe(lanes[i - 1].row + 1);
    expect(lanes[0].row).toBeLessThan(0);
    expect(lanes.at(-1)!.row).toBe(200);
  });

  it('is deterministic for a given seed', () => {
    const a = generate(1234, 300).lanes;
    const b = generate(1234, 300).lanes;
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    const c = generate(4321, 300).lanes;
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(c));
  });

  it('keeps the start area open and walls off the back', () => {
    const { lanes } = generate(7, 10);
    const wall = lanes.filter((l) => l.pattern === 'start-wall');
    expect(wall.length).toBeGreaterThan(0);
    for (const w of wall) {
      for (let c = -PLAY_HALF; c <= PLAY_HALF; c++) {
        expect(w.props.some((p) => p.col === c)).toBe(true);
      }
    }
    for (const l of lanes.filter((x) => x.row >= -2 && x.row <= 0)) {
      expect(l.kind).toBe('grass');
      expect(l.props.filter((p) => Math.abs(p.col) <= PLAY_HALF)).toHaveLength(0);
    }
  });

  it('generates every lane type with pattern variety', () => {
    const { lanes } = generate(99, 1500);
    const kinds = laneKindsOf(lanes);
    expect(kinds.grass).toBeGreaterThan(0);
    expect(kinds.road).toBeGreaterThan(0);
    expect(kinds.river).toBeGreaterThan(0);
    expect(kinds.rail).toBeGreaterThan(0);
    const patterns = new Set(lanes.map((l) => l.pattern));
    for (const p of ['meadow', 'forest', 'road', 'highway', 'river', 'lily', 'rail', 'railroad']) {
      expect(patterns).toContain(p);
    }
    expect(lanes.some((l) => l.platform === 'lily')).toBe(true);
  });

  it('every generated layout passes validation across many seeds', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { lanes } = generate(seed * 7919, 1200);
      const playable = lanes.filter((l) => l.row >= -2);
      const res = validateLayout(playable, ALL_COLS);
      expect(res.issues, `seed ${seed}`).toEqual([]);
    }
  });

  it('scales hazards with difficulty', () => {
    const { lanes } = generate(5, 3000);
    const roads = lanes.filter((l) => l.kind === 'road');
    const early = roads.filter((l) => l.row < 100);
    const late = roads.filter((l) => l.row > 1500);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(late.map((l) => l.speed))).toBeGreaterThan(avg(early.map((l) => l.speed)));
    const grassEarly = lanes.filter((l) => l.kind === 'grass' && l.row > 5 && l.row < 100).length;
    const grassLate = lanes.filter((l) => l.kind === 'grass' && l.row > 2000 && l.row < 2095).length;
    expect(grassLate).toBeLessThanOrEqual(grassEarly + 5);
  });

  it('road traffic always leaves a crossable gap', () => {
    const { lanes } = generate(2024, 2000);
    for (const l of lanes.filter((x) => x.kind === 'road')) {
      for (const gap of moverGaps(l)) expect(gap).toBeGreaterThanOrEqual(minRoadGap(l.speed));
      expect(l.cycle).toBeGreaterThanOrEqual(LANE_HALF_SPAN * 2);
    }
  });

  it('places coins only on reachable free tiles', () => {
    const { lanes } = generate(31, 800);
    for (const l of lanes) {
      expect(checkLane(l)).toBeNull();
      for (const c of l.coins) expect(Math.abs(c)).toBeLessThanOrEqual(PLAY_HALF);
    }
  });
});

describe('difficulty and wrap helpers', () => {
  it('difficulty is monotonic and bounded', () => {
    let prev = -1;
    for (let r = 0; r < 5000; r += 25) {
      const d = difficultyAt(r);
      expect(d).toBeGreaterThanOrEqual(prev);
      expect(d).toBeLessThan(1);
      prev = d;
    }
  });

  it('wrap keeps values in [start, start + cycle)', () => {
    for (const x of [-100, -20, 0, 19.99, 20, 45, 1000]) {
      const w = wrap(x, -20, 42);
      expect(w).toBeGreaterThanOrEqual(-20);
      expect(w).toBeLessThan(22);
    }
  });
});
