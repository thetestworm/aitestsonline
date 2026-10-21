/** Runtime state of one lane: moving vehicles/platforms, trains and coins. */
import { LANE_HALF_SPAN } from '../core/constants';
import { Rng } from '../core/rng';
import type { Span } from '../core/collision';
import { wrap } from './generator';
import type { LaneSpec } from './laneTypes';
import type { InstanceBatch } from '../render/InstanceBatch';

export interface Mover extends Span {
  variant: number;
  batch: InstanceBatch | null;
  slot: number;
}

export interface SlotRef {
  batch: InstanceBatch;
  slot: number;
}

export const TRAIN_WARN_TIME = 1.7;

export class LaneRuntime {
  readonly row: number;
  readonly spec: LaneSpec;
  readonly movers: Mover[];
  /** Coins still on the lane (columns); parallel to coinSlots. */
  readonly coins: number[];
  readonly coinSlots: number[] = [];
  /** Every static instance slot owned by the lane, released on dispose. */
  readonly slots: SlotRef[] = [];

  // Trains -------------------------------------------------------------
  readonly train: Span = { x: 0, len: 0 };
  trainLen = 0;
  /** Single-element view of `train` so collision checks never allocate. */
  readonly trainSpans: Span[] = [this.train];
  trainActive = false;
  trainTimer = 0;
  warning = false;
  /** Set for one tick when the warning starts / the train enters (for audio). */
  warnStarted = false;
  trainEntered = false;
  readonly trainSlots: SlotRef[] = [];
  bulbs: SlotRef[] = [];
  private readonly rng: Rng;

  constructor(spec: LaneSpec) {
    this.spec = spec;
    this.row = spec.row;
    this.coins = spec.coins.slice();
    this.movers = spec.movers.map((m) => ({
      x: m.x,
      len: m.len,
      variant: m.variant,
      batch: null,
      slot: -1,
    }));
    this.rng = new Rng(spec.row * 7919 + 17);
    if (spec.rail) {
      this.trainLen = 3 + spec.rail.cars * 3;
      this.train.len = this.trainLen;
      this.trainTimer = spec.rail.firstDelay;
    }
  }

  get kind() {
    return this.spec.kind;
  }

  get velocity(): number {
    return this.spec.speed * this.spec.dir;
  }

  update(dt: number): void {
    const spec = this.spec;
    if (spec.speed > 0 && this.movers.length) {
      const dx = spec.speed * spec.dir * dt;
      const start = -LANE_HALF_SPAN;
      for (let i = 0; i < this.movers.length; i++) {
        const m = this.movers[i];
        m.x = wrap(m.x + dx, start, spec.cycle);
      }
    }
    this.warnStarted = false;
    this.trainEntered = false;
    const rail = spec.rail;
    if (rail) {
      if (this.trainActive) {
        this.train.x += rail.trainSpeed * spec.dir * dt;
        if (this.train.x * spec.dir > LANE_HALF_SPAN + this.trainLen / 2 + 2) {
          this.trainActive = false;
          this.trainTimer = this.rng.range(rail.intervalMin, rail.intervalMax);
        }
      } else {
        this.trainTimer -= dt;
        const warn = this.trainTimer <= TRAIN_WARN_TIME;
        if (warn && !this.warning) this.warnStarted = true;
        this.warning = warn;
        if (this.trainTimer <= 0) {
          this.trainActive = true;
          this.trainEntered = true;
          this.train.x = -spec.dir * (LANE_HALF_SPAN + this.trainLen / 2);
        }
      }
      if (this.trainActive) this.warning = true;
    }
  }

  /** Remove a coin by index, returning its column. */
  takeCoin(i: number): number {
    const col = this.coins[i];
    const slot = this.coinSlots[i];
    this.coins.splice(i, 1);
    this.coinSlots.splice(i, 1);
    this.releasedCoinSlot = slot;
    return col;
  }

  releasedCoinSlot = -1;
}
