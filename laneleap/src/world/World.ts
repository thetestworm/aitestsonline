/**
 * The world: streams lanes from the generator in chunks ahead of the camera,
 * gives each lane instance slots in shared batches, animates traffic, and
 * releases everything behind the camera. Geometry is shared per world theme
 * and properly disposed when the theme changes.
 */
import * as THREE from 'three';
import { DISPOSE_BEHIND, GEN_AHEAD, PLAY_HALF, VISUAL_HALF_WIDTH } from '../core/constants';
import { LaneGenerator } from './generator';
import { LaneRuntime, type SlotRef } from './Lane';
import { InstanceBatch } from '../render/InstanceBatch';
import { buildEnvModels, disposeEnvModels, type EnvModels } from '../render/models';
import type { PaletteAtlas } from '../render/atlas';
import { themePalette, type WorldTheme } from './worlds';
import type { PropType } from './laneTypes';

export const GROUND_TOP: Record<string, number> = { grass: 0, road: -0.04, rail: 0, river: -0.32 };
export const PLATFORM_TOP = { log: 0.25, lily: 0.05 } as const;

interface Batches {
  ground: InstanceBatch;
  props: Record<PropType, InstanceBatch>;
  vehicles: InstanceBatch[];
  logs: InstanceBatch[];
  lily: InstanceBatch[];
  loco: InstanceBatch;
  carriage: InstanceBatch;
  coin: InstanceBatch;
  track: InstanceBatch;
  dashes: InstanceBatch;
  post: InstanceBatch;
  bulb: InstanceBatch;
}

export class World {
  readonly group = new THREE.Group();
  readonly lanes = new Map<number, LaneRuntime>();
  private gen: LaneGenerator = new LaneGenerator(1);
  private models: EnvModels | null = null;
  private batches: Batches | null = null;
  private theme!: WorldTheme;
  private readonly groundGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly groundMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  private readonly glowMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  private readonly tmpColor = new THREE.Color();
  private readonly bulbOn = new THREE.Color('#ff3b3b');
  private readonly bulbOff = new THREE.Color('#4a1515');
  private time = 0;
  private minRow = 0;
  private maxRow = -1;
  private shadows = true;
  /** Hook for train warning/entry sounds: (row, event). */
  onTrain: ((row: number, event: 'warn' | 'pass') => void) | null = null;

  constructor(
    private readonly atlas: PaletteAtlas,
    private readonly envMat: THREE.Material,
  ) {
    this.group.name = 'world';
  }

  setTheme(theme: WorldTheme): void {
    this.theme = theme;
    this.atlas.setEnv(themePalette(theme));
    this.clearLanes();
    if (this.batches) this.disposeBatches();
    if (this.models) disposeEnvModels(this.models);
    this.models = buildEnvModels(this.atlas, theme);
    this.batches = this.createBatches(this.models);
    this.setShadows(this.shadows);
  }

  get currentTheme(): WorldTheme {
    return this.theme;
  }

  private createBatches(m: EnvModels): Batches {
    const mk = (geo: THREE.BufferGeometry, cap: number, name: string, cast = true) => {
      const b = new InstanceBatch(geo, this.envMat, cap, {
        castShadow: cast,
        receiveShadow: true,
        name,
      });
      this.group.add(b.mesh);
      return b;
    };
    const ground = new InstanceBatch(this.groundGeo, this.groundMat, 260, {
      receiveShadow: true,
      colors: true,
      name: 'ground',
    });
    this.group.add(ground.mesh);
    const bulb = new InstanceBatch(m.bulb, this.glowMat, 96, { colors: true, name: 'bulbs' });
    this.group.add(bulb.mesh);
    return {
      ground,
      props: {
        treeTall: mk(m.treeTall, 420, 'treeTall'),
        treeShort: mk(m.treeShort, 420, 'treeShort'),
        rock: mk(m.rock, 320, 'rock'),
        bush: mk(m.bush, 320, 'bush'),
      },
      vehicles: m.vehicles.map((g, i) => mk(g, 160, `vehicle${i}`)),
      logs: m.logs.map((g, i) => mk(g, i >= 2 ? 120 : 1, `log${i}`)),
      lily: m.lily.map((g, i) => mk(g, 160, `lily${i}`, false)),
      loco: mk(m.locomotive, 40, 'loco'),
      carriage: mk(m.carriage, 160, 'carriage'),
      coin: mk(m.coin, 96, 'coin'),
      track: mk(m.track, 48, 'track', false),
      dashes: mk(m.dashes, 96, 'dashes', false),
      post: mk(m.post, 48, 'post'),
      bulb,
    };
  }

  private disposeBatches(): void {
    const b = this.batches!;
    // Geometry belongs to the models and is disposed with them; the ground box is shared.
    b.ground.dispose(false);
    b.bulb.dispose(false);
    for (const p of Object.values(b.props)) p.dispose(false);
    for (const list of [b.vehicles, b.logs, b.lily]) list.forEach((x) => x.dispose(false));
    for (const x of [b.loco, b.carriage, b.coin, b.track, b.dashes, b.post]) x.dispose(false);
    this.batches = null;
  }

  setShadows(on: boolean): void {
    this.shadows = on;
    if (!this.batches) return;
    this.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh && o.name !== 'ground' && o.name !== 'bulbs') {
        const isFlat = o.name.startsWith('lily') || o.name === 'track' || o.name === 'dashes';
        o.castShadow = on && !isFlat;
      }
    });
  }

  reset(seed: number): void {
    this.clearLanes();
    this.gen = new LaneGenerator(seed);
    this.minRow = this.gen.nextRow;
    this.maxRow = this.minRow - 1;
    this.time = 0;
  }

  lane(row: number): LaneRuntime | undefined {
    return this.lanes.get(row);
  }

  /** Stream lanes in around the camera focus row. */
  ensure(focusRow: number): void {
    const want = Math.floor(focusRow) + GEN_AHEAD;
    while (this.maxRow < want) {
      const spec = this.gen.next();
      const lane = new LaneRuntime(spec);
      this.lanes.set(lane.row, lane);
      this.maxRow = lane.row;
      this.buildLane(lane);
    }
    const cutoff = Math.floor(focusRow) - DISPOSE_BEHIND;
    while (this.minRow < cutoff) {
      const lane = this.lanes.get(this.minRow);
      if (lane) this.disposeLane(lane);
      this.lanes.delete(this.minRow);
      this.minRow++;
    }
  }

  private groundColor(kind: string, row: number, outer: boolean): THREE.Color {
    const g = this.theme.ground;
    let hex: string;
    switch (kind) {
      case 'road':
        hex = outer ? g.roadOut : g.road;
        break;
      case 'river':
        hex = outer ? g.waterOut : g.water;
        break;
      case 'rail':
        hex = outer ? g.railOut : g.rail;
        break;
      default:
        hex = outer ? g.grassOut : row % 2 === 0 ? g.grassA : g.grassB;
    }
    return this.tmpColor.set(hex);
  }

  private take(batch: InstanceBatch, lane: LaneRuntime): number {
    const slot = batch.alloc();
    if (slot >= 0) lane.slots.push({ batch, slot });
    return slot;
  }

  private buildLane(lane: LaneRuntime): void {
    const b = this.batches!;
    const spec = lane.spec;
    const z = -lane.row;
    const top = GROUND_TOP[spec.kind];
    const depth = 1 - top + 0.6;
    // Ground: playable strip plus darker margins either side.
    const inner = PLAY_HALF + 0.5;
    const outerW = VISUAL_HALF_WIDTH - inner;
    let s = this.take(b.ground, lane);
    b.ground.set(s, 0, top - depth / 2, z, 0, inner * 2, depth, 1);
    b.ground.setColor(s, this.groundColor(spec.kind, lane.row, false));
    for (const side of [-1, 1]) {
      s = this.take(b.ground, lane);
      b.ground.set(s, side * (inner + outerW / 2), top - depth / 2, z, 0, outerW, depth, 1);
      b.ground.setColor(s, this.groundColor(spec.kind, lane.row, true));
    }

    if (spec.kind === 'grass') {
      for (const p of spec.props) {
        const batch = b.props[p.type];
        const ps = this.take(batch, lane);
        batch.set(ps, p.col, top, z, (p.rot * Math.PI) / 2, p.scale, p.scale, p.scale);
      }
    } else if (spec.kind === 'road') {
      const prev = this.lanes.get(lane.row - 1);
      if (prev && prev.kind === 'road') {
        const ds = this.take(b.dashes, lane);
        b.dashes.set(ds, (lane.row % 2) * 0.6, top + 0.001, z + 0.5);
      }
      const yaw = spec.dir > 0 ? 0 : Math.PI;
      for (const m of lane.movers) {
        m.batch = b.vehicles[m.variant] ?? b.vehicles[0];
        m.slot = m.batch.alloc();
        m.batch.set(m.slot, m.x, top, z, yaw);
      }
    } else if (spec.kind === 'river') {
      for (const m of lane.movers) {
        if (spec.platform === 'lily') {
          m.batch = b.lily[m.variant] ?? b.lily[0];
          m.slot = m.batch.alloc();
          m.batch.set(m.slot, m.x, top + 0.32, z, (lane.row * 1.3 + m.x) % 6.28);
        } else {
          m.batch = b.logs[Math.min(4, Math.max(2, Math.round(m.len)))];
          m.slot = m.batch.alloc();
          m.batch.set(m.slot, m.x, 0, z);
        }
      }
    } else if (spec.kind === 'rail') {
      const ts = this.take(b.track, lane);
      b.track.set(ts, 0, top, z);
      const ps = this.take(b.post, lane);
      b.post.set(ps, PLAY_HALF + 1.3, top, z + 0.38);
      lane.bulbs = [];
      for (const dx of [-0.17, 0.17]) {
        const bs = this.take(b.bulb, lane);
        b.bulb.set(bs, PLAY_HALF + 1.3 + dx, top + 1.18, z + 0.46);
        b.bulb.setColor(bs, this.bulbOff);
        lane.bulbs.push({ batch: b.bulb, slot: bs });
      }
      const yaw = spec.dir > 0 ? 0 : Math.PI;
      const cars = spec.rail!.cars;
      for (let i = 0; i <= cars; i++) {
        const batch = i === 0 ? b.loco : b.carriage;
        const slot = batch.alloc();
        batch.set(slot, 0, top, z, yaw);
        batch.hide(slot);
        lane.trainSlots.push({ batch, slot });
      }
    }
    for (const c of lane.coins) {
      const cs = b.coin.alloc();
      lane.coinSlots.push(cs);
      b.coin.set(cs, c, 0.45, z);
    }
  }

  private disposeLane(lane: LaneRuntime): void {
    for (const r of lane.slots) r.batch.release(r.slot);
    for (const m of lane.movers) m.batch?.release(m.slot);
    for (const r of lane.trainSlots) r.batch.release(r.slot);
    for (const s of lane.coinSlots) this.batches?.coin.release(s);
    lane.slots.length = 0;
    lane.trainSlots.length = 0;
    lane.coinSlots.length = 0;
  }

  private clearLanes(): void {
    for (const lane of this.lanes.values()) this.disposeLane(lane);
    this.lanes.clear();
    if (this.batches) {
      const b = this.batches;
      b.ground.clear();
      b.bulb.clear();
      for (const p of Object.values(b.props)) p.clear();
      for (const list of [b.vehicles, b.logs, b.lily]) list.forEach((x) => x.clear());
      for (const x of [b.loco, b.carriage, b.coin, b.track, b.dashes, b.post]) x.clear();
    }
  }

  /** Remove a collected coin's visual. */
  collectCoin(lane: LaneRuntime, index: number): number {
    const col = lane.takeCoin(index);
    this.batches?.coin.release(lane.releasedCoinSlot);
    return col;
  }

  update(dt: number, focusRow: number): void {
    this.time += dt;
    const b = this.batches;
    if (!b) return;
    const t = this.time;
    const flash = Math.floor(t * 5) % 2;
    const viewMin = focusRow - 9;
    const viewMax = focusRow + 18;
    for (const lane of this.lanes.values()) {
      lane.update(dt);
      const z = -lane.row;
      const kind = lane.spec.kind;
      if (kind === 'road' || kind === 'river') {
        if (lane.spec.speed > 0) {
          const top = GROUND_TOP[kind];
          const isRiver = kind === 'river';
          for (let i = 0; i < lane.movers.length; i++) {
            const m = lane.movers[i];
            const y = isRiver ? Math.sin(t * 2.2 + i * 1.7 + lane.row) * 0.025 : top;
            m.batch?.move(m.slot, m.x, y, z);
          }
        }
      } else if (kind === 'rail') {
        if (lane.warnStarted && lane.row > viewMin && lane.row < viewMax)
          this.onTrain?.(lane.row, 'warn');
        if (lane.trainEntered && lane.row > viewMin && lane.row < viewMax)
          this.onTrain?.(lane.row, 'pass');
        const on = lane.warning;
        for (let i = 0; i < lane.bulbs.length; i++) {
          const r = lane.bulbs[i];
          r.batch.setColor(r.slot, on && flash === i ? this.bulbOn : this.bulbOff);
        }
        const dir = lane.spec.dir;
        for (let i = 0; i < lane.trainSlots.length; i++) {
          const r = lane.trainSlots[i];
          if (!lane.trainActive) {
            r.batch.hide(r.slot);
            continue;
          }
          // Locomotive leads in the direction of travel.
          const offset = lane.trainLen / 2 - 1.5 - i * 3;
          r.batch.set(r.slot, lane.train.x + dir * offset, 0, z, dir > 0 ? 0 : Math.PI);
        }
      }
      if (lane.coinSlots.length) {
        for (let i = 0; i < lane.coinSlots.length; i++) {
          b.coin.set(
            lane.coinSlots[i],
            lane.coins[i],
            0.45 + Math.sin(t * 3 + i) * 0.06,
            z,
            t * 2.5,
          );
        }
      }
    }
    b.ground.flush();
    b.bulb.flush();
    for (const p of Object.values(b.props)) p.flush();
    for (const list of [b.vehicles, b.logs, b.lily]) for (const x of list) x.flush();
    b.loco.flush();
    b.carriage.flush();
    b.coin.flush();
    b.track.flush();
    b.dashes.flush();
    b.post.flush();
  }

  /** Total live instance slots, for the debug overlay. */
  stats(): { lanes: number; instances: number } {
    let instances = 0;
    this.group.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) instances += (o as THREE.InstancedMesh).count;
    });
    return { lanes: this.lanes.size, instances };
  }

  dispose(): void {
    this.clearLanes();
    if (this.batches) this.disposeBatches();
    if (this.models) disposeEnvModels(this.models);
    this.models = null;
    this.groundGeo.dispose();
    this.groundMat.dispose();
    this.glowMat.dispose();
  }
}

export type { SlotRef };
