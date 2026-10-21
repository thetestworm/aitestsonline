/** Pure lane data shared by the generator, validator, simulation and renderer. */

export type LaneKind = 'grass' | 'road' | 'river' | 'rail';
export type PropType = 'treeTall' | 'treeShort' | 'rock' | 'bush';
export type PlatformType = 'log' | 'lily';
export type VehicleVariant = 0 | 1 | 2 | 3 | 4; // 0-2 cars, 3-4 trucks

export interface Prop {
  col: number;
  type: PropType;
  /** Quarter-turn rotation and scale jitter, decided at generation for determinism. */
  rot: number;
  scale: number;
}

export interface MoverSpec {
  /** Centre x at t=0. */
  x: number;
  /** Length along x in tiles. */
  len: number;
  variant: number;
}

export interface RailSpec {
  trainSpeed: number;
  cars: number;
  intervalMin: number;
  intervalMax: number;
  firstDelay: number;
}

export interface LaneSpec {
  row: number;
  kind: LaneKind;
  /** Props on this lane (grass only). Columns with props are blocked. */
  props: Prop[];
  /** Columns holding a coin. */
  coins: number[];
  dir: 1 | -1;
  /** Tiles per second (road vehicles, river platforms). 0 for static lanes. */
  speed: number;
  movers: MoverSpec[];
  /** Wrap length of the mover pattern. */
  cycle: number;
  platform: PlatformType | null;
  rail: RailSpec | null;
  /** Pattern name the lane came from, for debugging and variety tests. */
  pattern: string;
}

export function makeLane(row: number, kind: LaneKind, pattern = 'plain'): LaneSpec {
  return {
    row,
    kind,
    props: [],
    coins: [],
    dir: 1,
    speed: 0,
    movers: [],
    cycle: 0,
    platform: null,
    rail: null,
    pattern,
  };
}

export function isBlocked(lane: LaneSpec, col: number): boolean {
  if (lane.kind !== 'grass') return false;
  for (let i = 0; i < lane.props.length; i++) if (lane.props[i].col === col) return true;
  return false;
}
