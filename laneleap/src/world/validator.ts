/**
 * Layout validation. Guarantees every generated stretch of lanes can be crossed:
 *  - static reachability: a path of columns exists through blocking props and lily pads;
 *  - dynamic feasibility: traffic gaps, platform waits and train intervals are survivable.
 *
 * Column sets are 9-bit masks (bit i = column i - PLAY_HALF). All rules are
 * conservative: if the validator says a layout is fine, a skilled player can cross it.
 */
import { PLAY_HALF, PLAY_COLS, LANE_HALF_SPAN, HOP_DURATION } from '../core/constants';
import type { LaneSpec } from './laneTypes';

export const ALL_COLS = (1 << PLAY_COLS) - 1;

export const RULES = {
  /** Seconds a player needs inside a road/rail lane to hop through, plus reaction margin. */
  crossTime: HOP_DURATION + 0.37,
  maxRoadSpeed: 7,
  maxPlatformSpeed: 3.2,
  minLogLen: 2,
  /** Longest a player should ever have to wait for the next log to arrive. */
  maxPlatformWait: 3.6,
  minRailInterval: 2.4,
  maxTrainSpeed: 40,
} as const;

export function colBit(col: number): number {
  return 1 << (col + PLAY_HALF);
}

export function maskHas(mask: number, col: number): boolean {
  return (mask & colBit(col)) !== 0;
}

export function maskCols(mask: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < PLAY_COLS; i++) if (mask & (1 << i)) out.push(i - PLAY_HALF);
  return out;
}

/** Columns in the playable strip not blocked by props. */
export function freeMask(lane: LaneSpec): number {
  if (lane.kind !== 'grass') return ALL_COLS;
  let m = ALL_COLS;
  for (const p of lane.props) {
    if (p.col >= -PLAY_HALF && p.col <= PLAY_HALF) m &= ~colBit(p.col);
  }
  return m;
}

/** Columns covered by static (speed 0) platforms. */
export function padMask(lane: LaneSpec): number {
  let m = 0;
  for (const mv of lane.movers) {
    const c = Math.round(mv.x);
    if (c >= -PLAY_HALF && c <= PLAY_HALF) m |= colBit(c);
  }
  return m;
}

function flood(mask: number, within: number): number {
  let m = mask & within;
  for (;;) {
    const next = (m | (m << 1) | (m >> 1)) & within;
    if (next === m) return m;
    m = next;
  }
}

/** Given the set of reachable columns in the previous lane, return reachable columns in `lane`. */
export function stepReachable(prev: number, lane: LaneSpec): number {
  switch (lane.kind) {
    case 'grass': {
      const free = freeMask(lane);
      return flood(prev & free, free);
    }
    case 'road':
    case 'rail':
      // Moving hazards: conservatively assume the player only hops straight through.
      return prev;
    case 'river': {
      if (lane.platform === 'lily') {
        const pads = padMask(lane);
        return flood(prev & pads, pads);
      }
      if (prev === 0) return 0;
      // Logs pass every column; riding carries the player in the drift direction.
      if (lane.dir > 0) {
        const low = prev & -prev;
        return ALL_COLS & ~(low - 1);
      }
      const high = 1 << (31 - Math.clz32(prev));
      return ALL_COLS & ((high << 1) - 1);
    }
  }
}

export interface LaneIssue {
  row: number;
  reason: string;
}

/** Dynamic checks for a single lane in isolation. Returns null when the lane is fine. */
export function checkLane(lane: LaneSpec): string | null {
  for (const c of lane.coins) {
    if (c < -PLAY_HALF || c > PLAY_HALF) return 'coin outside playable strip';
    if (lane.kind === 'grass' && lane.props.some((p) => p.col === c)) return 'coin on blocked tile';
  }
  if (lane.kind === 'road' || (lane.kind === 'river' && lane.platform === 'log')) {
    if (lane.movers.length === 0 && lane.kind === 'river') return 'river without platforms';
    if (lane.movers.length > 0 && lane.cycle < LANE_HALF_SPAN * 2) return 'mover cycle too short';
  }
  if (lane.kind === 'road') {
    if (lane.speed <= 0 || lane.speed > RULES.maxRoadSpeed) return 'road speed out of range';
    const minGap = minRoadGap(lane.speed);
    const gaps = moverGaps(lane);
    for (const g of gaps) if (g < minGap) return `road gap ${g.toFixed(2)} < ${minGap.toFixed(2)}`;
  }
  if (lane.kind === 'river') {
    if (lane.platform === 'lily') {
      if (lane.speed !== 0) return 'lily pads must be static';
      if (padMask(lane) === 0) return 'no lily pads in playable strip';
    } else {
      if (lane.speed <= 0 || lane.speed > RULES.maxPlatformSpeed) return 'log speed out of range';
      for (const m of lane.movers) if (m.len < RULES.minLogLen) return 'log too short';
      const maxGap = lane.speed * RULES.maxPlatformWait;
      for (const g of moverGaps(lane)) {
        if (g > maxGap) return `log gap ${g.toFixed(2)} > ${maxGap.toFixed(2)}`;
        if (g < 0.2) return 'logs overlap';
      }
    }
  }
  if (lane.kind === 'rail') {
    const r = lane.rail;
    if (!r) return 'rail lane without rail spec';
    if (r.intervalMin < RULES.minRailInterval) return 'trains too frequent';
    if (r.intervalMax < r.intervalMin) return 'bad train interval';
    if (r.trainSpeed <= 0 || r.trainSpeed > RULES.maxTrainSpeed) return 'train speed out of range';
  }
  return null;
}

export function minRoadGap(speed: number): number {
  return 0.8 + speed * RULES.crossTime;
}

/** Edge-to-edge gaps between consecutive movers around the full wrap cycle. */
export function moverGaps(lane: LaneSpec): number[] {
  const ms = [...lane.movers].sort((a, b) => a.x - b.x);
  const gaps: number[] = [];
  for (let i = 0; i < ms.length; i++) {
    const a = ms[i];
    const b = i + 1 < ms.length ? ms[i + 1] : { x: ms[0].x + lane.cycle, len: ms[0].len };
    gaps.push(b.x - b.len / 2 - (a.x + a.len / 2));
  }
  return gaps;
}

export interface ValidationResult {
  ok: boolean;
  issues: LaneIssue[];
  /** Reachable column mask after the last lane. */
  reach: number;
}

/** Validate a contiguous run of lanes, starting from `startMask` before the first lane. */
export function validateLayout(lanes: readonly LaneSpec[], startMask: number): ValidationResult {
  const issues: LaneIssue[] = [];
  let reach = startMask;
  for (const lane of lanes) {
    const problem = checkLane(lane);
    if (problem) issues.push({ row: lane.row, reason: problem });
    reach = stepReachable(reach, lane);
    if (reach === 0) {
      issues.push({ row: lane.row, reason: 'no reachable column' });
      break;
    }
  }
  return { ok: issues.length === 0, issues, reach };
}
