/**
 * Procedural lane generator. Lanes are produced in themed groups ("patterns")
 * whose mix and parameters scale with the difficulty curve. Every lane is run
 * through the validator before it is handed out; impossible lanes are repaired
 * (props removed, lily pads added) and anything still invalid falls back to an
 * open meadow lane, so the stream is always crossable.
 */
import { PLAY_HALF, LANE_HALF_SPAN, DECOR_HALF } from '../core/constants';
import { Rng } from '../core/rng';
import { difficultyAt, lerp } from './difficulty';
import { makeLane, type LaneSpec, type PropType, type LaneKind } from './laneTypes';
import {
  ALL_COLS,
  checkLane,
  colBit,
  maskCols,
  minRoadGap,
  padMask,
  stepReachable,
  freeMask,
} from './validator';

export const START_WALL_ROW = -3;
export const START_CLEAR_ROWS = 4;

type GroupKind =
  | 'meadow'
  | 'forest'
  | 'road'
  | 'highway'
  | 'river'
  | 'lily'
  | 'rail'
  | 'railroad';

const PROP_WEIGHTS: Record<PropType, number> = {
  treeTall: 0.3,
  treeShort: 0.3,
  rock: 0.2,
  bush: 0.2,
};

export class LaneGenerator {
  readonly rng: Rng;
  private row: number;
  private reach = ALL_COLS;
  private queue: LaneSpec[] = [];
  private lastGroup: GroupKind | 'start' = 'start';
  /** Count of lanes that needed a repair (exposed for tests and debugging). */
  repairs = 0;
  fallbacks = 0;

  constructor(seed: number, firstRow = -7) {
    this.rng = new Rng(seed);
    this.row = firstRow;
  }

  get nextRow(): number {
    return this.row;
  }

  next(): LaneSpec {
    if (this.queue.length === 0) this.plan();
    let lane = this.queue.shift()!;
    if (lane.row > START_WALL_ROW) {
      lane = this.repair(lane);
      this.reach = stepReachable(this.reach, lane);
    }
    this.row = lane.row + 1;
    return lane;
  }

  /** Generate up to and including `row`. */
  generateUntil(row: number): LaneSpec[] {
    const out: LaneSpec[] = [];
    while (this.row <= row) out.push(this.next());
    return out;
  }

  // ---------------------------------------------------------------- planning

  private plan(): void {
    const r = this.row;
    if (r <= START_WALL_ROW) {
      this.queue.push(this.grass(r, 1, 'start-wall'));
      return;
    }
    if (r < START_CLEAR_ROWS) {
      const lane = this.grass(r, r >= 1 ? 0.3 : 0, 'start');
      // Keep the middle of the start area open for multiplayer spawns.
      lane.props = lane.props.filter((p) => Math.abs(p.col) > (r >= 1 ? 2 : PLAY_HALF));
      this.queue.push(lane);
      return;
    }
    const d = difficultyAt(r);
    const g = this.pickGroup(d);
    this.lastGroup = g;
    this.buildGroup(g, r, d);
    if (g !== 'meadow' && g !== 'forest' && this.rng.chance(lerp(0.92, 0.5, d))) {
      this.queue.push(this.grass(this.row + this.queue.length, lerp(0.12, 0.3, d), 'rest'));
    }
  }

  private pickGroup(d: number): GroupKind {
    const weights: Record<GroupKind, number> = {
      meadow: lerp(0.3, 0.16, d),
      forest: d > 0.12 ? 0.08 : 0,
      road: 0.3,
      highway: d > 0.2 ? 0.12 * d + 0.03 : 0,
      river: lerp(0.18, 0.22, d),
      lily: d > 0.08 ? 0.06 : 0,
      rail: lerp(0.08, 0.13, d),
      railroad: d > 0.35 ? 0.07 : 0,
    };
    if (this.lastGroup === 'meadow' || this.lastGroup === 'forest' || this.lastGroup === 'start') {
      weights.meadow *= 0.25;
      weights.forest *= 0.25;
    }
    // Discourage the exact same hazard twice in a row for variety.
    if (this.lastGroup in weights) weights[this.lastGroup as GroupKind] *= 0.45;
    return this.rng.weighted(weights);
  }

  private buildGroup(g: GroupKind, r: number, d: number): void {
    const rng = this.rng;
    const push = (fn: (row: number) => LaneSpec): void => {
      this.queue.push(fn(r + this.queue.length));
    };
    switch (g) {
      case 'meadow': {
        const n = rng.int(1, 3);
        for (let i = 0; i < n; i++) push((row) => this.grass(row, lerp(0.12, 0.34, d), g));
        break;
      }
      case 'forest': {
        const n = rng.int(2, 4);
        for (let i = 0; i < n; i++) push((row) => this.grass(row, lerp(0.42, 0.6, d), g));
        break;
      }
      case 'road': {
        const n = rng.int(1, 2 + Math.round(d * 3));
        for (let i = 0; i < n; i++) push((row) => this.road(row, d, rng.sign(), g));
        break;
      }
      case 'highway': {
        const n = rng.int(4, 6);
        let dir = rng.sign();
        const base = lerp(2, 4.5, d);
        for (let i = 0; i < n; i++) {
          const ldir = dir;
          push((row) => this.road(row, d, ldir, g, base + rng.range(-0.3, 1)));
          dir = (rng.chance(0.75) ? -dir : dir) as 1 | -1;
        }
        break;
      }
      case 'river': {
        const n = rng.int(1, 1 + Math.round(d * 3));
        let dir = rng.sign();
        for (let i = 0; i < n; i++) {
          const ldir = dir;
          if (i > 0 && rng.chance(0.15)) push((row) => this.lily(row, d, g));
          else push((row) => this.river(row, d, ldir, g));
          dir = (-dir) as 1 | -1;
        }
        break;
      }
      case 'lily': {
        const n = rng.int(2, 3);
        for (let i = 0; i < n; i++) push((row) => this.lily(row, d, g));
        break;
      }
      case 'rail': {
        const n = d > 0.3 && rng.chance(0.35) ? 2 : 1;
        for (let i = 0; i < n; i++) push((row) => this.railLane(row, d, g));
        break;
      }
      case 'railroad': {
        push((row) => this.railLane(row, d, g));
        push((row) => this.road(row, d, rng.sign(), g));
        push((row) => this.railLane(row, d, g));
        break;
      }
    }
  }

  // ---------------------------------------------------------------- lane builders

  private grass(row: number, density: number, pattern: string): LaneSpec {
    const lane = makeLane(row, 'grass', pattern);
    const rng = this.rng;
    for (let c = -DECOR_HALF; c <= DECOR_HALF; c++) {
      const inPlay = Math.abs(c) <= PLAY_HALF;
      const p = inPlay ? density : 0.38;
      if (!rng.chance(p)) continue;
      lane.props.push({
        col: c,
        type: rng.weighted(PROP_WEIGHTS),
        rot: rng.int(0, 3),
        scale: rng.range(0.85, 1.12),
      });
    }
    if (pattern !== 'start-wall' && pattern !== 'start' && rng.chance(0.24)) {
      const free = maskCols(freeMask(lane));
      if (free.length) lane.coins.push(rng.pick(free));
    }
    return lane;
  }

  private road(row: number, d: number, dir: 1 | -1, pattern: string, speedHint?: number): LaneSpec {
    const rng = this.rng;
    const lane = makeLane(row, 'road', pattern);
    lane.dir = dir;
    const speed = speedHint ?? lerp(1.3, 4.3, d) + rng.range(-0.4, 1.3);
    lane.speed = clamp(speed, 0.9, 6.6);
    const minGap = minRoadGap(lane.speed) + 0.25;
    const maxGap = minGap + lerp(8.5, 3.5, d);
    const truckChance = 0.14 + 0.26 * d;
    this.fillMovers(lane, minGap, maxGap, () => {
      const truck = rng.chance(truckChance);
      return truck ? { len: 2.8, variant: rng.int(3, 4) } : { len: 1.6, variant: rng.int(0, 2) };
    });
    if (rng.chance(0.1)) lane.coins.push(rng.int(-PLAY_HALF, PLAY_HALF));
    return lane;
  }

  private river(row: number, d: number, dir: 1 | -1, pattern: string): LaneSpec {
    const rng = this.rng;
    const lane = makeLane(row, 'river', pattern);
    lane.dir = dir;
    lane.platform = 'log';
    lane.speed = clamp(lerp(0.9, 2.1, d) + rng.range(-0.2, 0.55), 0.6, 3.0);
    const maxLen = Math.round(lerp(4, 3, d));
    const minLen = d > 0.45 ? 2 : 3;
    const minGap = 1;
    const maxGap = Math.max(minGap + 0.2, Math.min(lane.speed * 3.2, lerp(2.4, 4.4, d)));
    this.fillMovers(lane, minGap, maxGap, () => ({ len: rng.int(minLen, maxLen), variant: 0 }));
    return lane;
  }

  private lily(row: number, d: number, pattern: string): LaneSpec {
    const rng = this.rng;
    const lane = makeLane(row, 'river', pattern);
    lane.platform = 'lily';
    const count = rng.int(2, Math.round(lerp(5, 3, d)));
    const cols = new Set<number>();
    while (cols.size < count) cols.add(rng.int(-PLAY_HALF, PLAY_HALF));
    for (let c = -10; c <= 10; c++) {
      if (Math.abs(c) > PLAY_HALF && rng.chance(0.18)) cols.add(c);
    }
    for (const c of cols) lane.movers.push({ x: c, len: 1, variant: rng.int(0, 1) });
    if (rng.chance(0.15)) {
      const inPlay = [...cols].filter((c) => Math.abs(c) <= PLAY_HALF);
      lane.coins.push(rng.pick(inPlay));
    }
    return lane;
  }

  private railLane(row: number, d: number, pattern: string): LaneSpec {
    const rng = this.rng;
    const lane = makeLane(row, 'rail', pattern);
    lane.dir = rng.sign();
    const intervalMin = lerp(4.8, 2.7, d);
    lane.rail = {
      trainSpeed: lerp(24, 33, d) + rng.range(0, 4),
      cars: rng.int(1, 2 + Math.round(d * 2)),
      intervalMin,
      intervalMax: intervalMin + lerp(4, 2.5, d),
      firstDelay: rng.range(1.2, intervalMin + 2),
    };
    if (rng.chance(0.12)) lane.coins.push(rng.int(-PLAY_HALF, PLAY_HALF));
    return lane;
  }

  /** Lay out movers with random gaps around a wrap cycle, then apply a random phase. */
  private fillMovers(
    lane: LaneSpec,
    minGap: number,
    maxGap: number,
    make: () => { len: number; variant: number },
  ): void {
    const rng = this.rng;
    const start = -LANE_HALF_SPAN;
    let cursor = start;
    const target = start + LANE_HALF_SPAN * 2;
    while (cursor < target) {
      const m = make();
      lane.movers.push({ x: cursor + m.len / 2, len: m.len, variant: m.variant });
      cursor += m.len + rng.range(minGap, maxGap);
    }
    lane.cycle = cursor - start;
    const phase = rng.range(0, lane.cycle);
    for (const m of lane.movers) m.x = wrap(m.x + phase, start, lane.cycle);
  }

  // ---------------------------------------------------------------- validation & repair

  private repair(lane: LaneSpec): LaneSpec {
    const before = this.reach;
    let fixed = false;
    if (lane.kind === 'grass' && stepReachable(before, lane) === 0) {
      // Clear a prop on a column we can already reach.
      const col = this.rng.pick(maskCols(before));
      lane.props = lane.props.filter((p) => p.col !== col);
      fixed = true;
    }
    if (lane.kind === 'river' && lane.platform === 'lily' && (padMask(lane) & before) === 0) {
      const col = this.rng.pick(maskCols(before));
      lane.movers.push({ x: col, len: 1, variant: 0 });
      fixed = true;
    }
    // Drop coins that ended up somewhere unreachable or blocked.
    lane.coins = lane.coins.filter((c) => (freeMask(lane) & colBit(c)) !== 0);
    if (fixed) this.repairs++;
    if (checkLane(lane) !== null || stepReachable(before, lane) === 0) {
      this.fallbacks++;
      const open = makeLane(lane.row, 'grass', 'fallback');
      return open;
    }
    return lane;
  }
}

export function wrap(x: number, start: number, cycle: number): number {
  if (cycle <= 0) return x;
  return start + ((((x - start) % cycle) + cycle) % cycle);
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function laneKindsOf(lanes: readonly LaneSpec[]): Record<LaneKind, number> {
  const out: Record<LaneKind, number> = { grass: 0, road: 0, river: 0, rail: 0 };
  for (const l of lanes) out[l.kind]++;
  return out;
}
