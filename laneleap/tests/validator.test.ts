import { describe, expect, it } from 'vitest';
import { makeLane, type LaneSpec } from '../src/world/laneTypes';
import {
  ALL_COLS,
  checkLane,
  colBit,
  maskCols,
  stepReachable,
  validateLayout,
} from '../src/world/validator';
import { PLAY_HALF } from '../src/core/constants';

function grass(row: number, blocked: number[]): LaneSpec {
  const l = makeLane(row, 'grass');
  l.props = blocked.map((col) => ({ col, type: 'rock' as const, rot: 0, scale: 1 }));
  return l;
}

function lily(row: number, cols: number[]): LaneSpec {
  const l = makeLane(row, 'river');
  l.platform = 'lily';
  l.movers = cols.map((x) => ({ x, len: 1, variant: 0 }));
  return l;
}

function logs(row: number, dir: 1 | -1, speed = 1.5): LaneSpec {
  const l = makeLane(row, 'river');
  l.platform = 'log';
  l.dir = dir;
  l.speed = speed;
  l.cycle = 40;
  for (let x = -18; x < 22; x += 5) l.movers.push({ x, len: 3, variant: 0 });
  return l;
}

const allCols = Array.from({ length: PLAY_HALF * 2 + 1 }, (_, i) => i - PLAY_HALF);

describe('reachability', () => {
  it('rejects a fully blocked grass row', () => {
    const res = validateLayout([grass(1, []), grass(2, allCols)], ALL_COLS);
    expect(res.ok).toBe(false);
    expect(res.issues[0].row).toBe(2);
  });

  it('follows a winding path through obstacles', () => {
    const left = allCols.filter((c) => c !== -4);
    const right = allCols.filter((c) => c !== 4);
    // Row 2 only open at -4; row 3 only open at 4; row 2 is fully open in between via row 2b
    const lanes = [grass(1, left), grass(2, []), grass(3, right)];
    const res = validateLayout(lanes, colBit(-4));
    expect(res.ok).toBe(true);
    expect(maskCols(res.reach)).toEqual([4]);
  });

  it('detects disconnected pockets', () => {
    // Row 1 open only at -4, row 2 open only at +4 and there is no lateral connection.
    const lanes = [grass(1, allCols.filter((c) => c !== -4)), grass(2, allCols.filter((c) => c !== 4))];
    expect(validateLayout(lanes, ALL_COLS).ok).toBe(false);
  });

  it('roads and rails pass columns straight through', () => {
    const road = makeLane(1, 'road');
    expect(stepReachable(colBit(2), road)).toBe(colBit(2));
    const rail = makeLane(1, 'rail');
    expect(stepReachable(colBit(-1) | colBit(3), rail)).toBe(colBit(-1) | colBit(3));
  });

  it('lily pads must line up with the reachable columns', () => {
    expect(stepReachable(colBit(0), lily(1, [2, 3]))).toBe(0);
    expect(stepReachable(colBit(2), lily(1, [2, 3]))).toBe(colBit(2) | colBit(3));
    const res = validateLayout([grass(1, allCols.filter((c) => c !== 0)), lily(2, [3])], ALL_COLS);
    expect(res.ok).toBe(false);
  });

  it('logs carry the player in their drift direction only', () => {
    const right = stepReachable(colBit(0), logs(1, 1));
    expect(maskCols(right)).toEqual([0, 1, 2, 3, 4]);
    const left = stepReachable(colBit(0), logs(1, -1));
    expect(maskCols(left)).toEqual([-4, -3, -2, -1, 0]);
  });
});

describe('lane dynamic checks', () => {
  it('flags traffic gaps that are too tight to cross', () => {
    const road = makeLane(1, 'road');
    road.speed = 5;
    road.cycle = 40;
    for (let x = -19; x < 21; x += 2) road.movers.push({ x, len: 1.6, variant: 0 });
    expect(checkLane(road)).toMatch(/road gap/);
  });

  it('flags log gaps that would strand the player', () => {
    const river = makeLane(1, 'river');
    river.platform = 'log';
    river.speed = 1;
    river.cycle = 44;
    river.movers = [{ x: 0, len: 3, variant: 0 }];
    expect(checkLane(river)).toMatch(/log gap/);
  });

  it('flags too-frequent trains', () => {
    const rail = makeLane(1, 'rail');
    rail.rail = { trainSpeed: 30, cars: 2, intervalMin: 1, intervalMax: 3, firstDelay: 1 };
    expect(checkLane(rail)).toMatch(/trains too frequent/);
  });

  it('flags coins on blocked tiles', () => {
    const g = grass(1, [2]);
    g.coins = [2];
    expect(checkLane(g)).toMatch(/coin on blocked/);
  });

  it('accepts a sensible log lane', () => {
    expect(checkLane(logs(1, 1))).toBeNull();
  });
});
