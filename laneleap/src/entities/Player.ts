/** A hopping player: grid movement state, input buffer and visual animation. */
import * as THREE from 'three';
import {
  HOP_DURATION,
  HOP_HEIGHT,
  INPUT_BUFFER_SIZE,
  LAND_SQUASH_TIME,
} from '../core/constants';
import type { Dir } from '../core/gestures';
import type { CharacterDef } from '../data/characters';
import type { DeathCause } from '../data/missions';
import type { LaneRuntime } from '../world/Lane';

const YAW: Record<Dir, number> = { up: Math.PI, down: 0, left: -Math.PI / 2, right: Math.PI / 2 };

export class Player {
  readonly root = new THREE.Group();
  /** Squash/stretch + facing pivot. */
  readonly body = new THREE.Group();
  mesh: THREE.Mesh | null = null;
  def!: CharacterDef;
  colors: string[] = ['#ffffff'];
  readonly material: THREE.MeshLambertMaterial;

  // Grid state ---------------------------------------------------------
  x = 0;
  /** Logical row used for collisions (switches halfway through a hop). */
  row = 0;
  /** Smooth row for rendering. */
  visualRow = 0;
  y = 0;
  fromX = 0;
  toX = 0;
  fromRow = 0;
  toRow = 0;
  fromY = 0;
  toY = 0;
  hopT = 1;
  hopping = false;
  /** Hop started from a moving platform sideways: carry with the platform. */
  carryLane: LaneRuntime | null = null;
  readonly queue: Dir[] = [];
  landT = 0;
  bumpT = 0;
  yaw = Math.PI;
  targetYaw = Math.PI;

  platformLane: LaneRuntime | null = null;
  platformIndex = -1;
  /** Standing on water thanks to the floatOnce ability. */
  floating = false;
  floatUsed = false;

  // Run state ----------------------------------------------------------
  alive = true;
  deathCause: DeathCause | null = null;
  deathT = 0;
  deathDir = 1;
  grabbed = false;
  maxRow = 0;
  idle = 0;
  hops = 0;
  hasMoved = false;

  constructor(readonly index: number) {
    this.material = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    this.root.add(this.body);
    this.root.name = `player${index}`;
  }

  setModel(def: CharacterDef, geometry: THREE.BufferGeometry, colors: string[], map: THREE.Texture): void {
    this.def = def;
    this.colors = colors;
    this.material.map = map;
    this.material.emissive.set(def.special === 'glow' ? '#2a6b22' : '#000000');
    this.material.needsUpdate = true;
    if (this.mesh) {
      this.mesh.geometry = geometry;
    } else {
      this.mesh = new THREE.Mesh(geometry, this.material);
      this.mesh.castShadow = true;
      this.body.add(this.mesh);
    }
  }

  spawn(col: number, row: number): void {
    this.x = this.fromX = this.toX = col;
    this.row = this.fromRow = this.toRow = row;
    this.visualRow = row;
    this.y = this.fromY = this.toY = 0;
    this.hopT = 1;
    this.hopping = false;
    this.queue.length = 0;
    this.landT = 0;
    this.bumpT = 0;
    this.yaw = this.targetYaw = Math.PI;
    this.platformLane = null;
    this.platformIndex = -1;
    this.carryLane = null;
    this.floating = false;
    this.floatUsed = false;
    this.alive = true;
    this.deathCause = null;
    this.deathT = 0;
    this.grabbed = false;
    this.maxRow = row;
    this.idle = 0;
    this.hops = 0;
    this.hasMoved = false;
    this.root.visible = true;
    this.body.scale.set(1, 1, 1);
    this.body.rotation.set(0, this.yaw, 0);
    this.body.position.set(0, 0, 0);
    this.syncTransform();
  }

  /** Buffer an input; returns false if the buffer is full. */
  enqueue(dir: Dir): boolean {
    if (this.queue.length >= INPUT_BUFFER_SIZE) return false;
    this.queue.push(dir);
    return true;
  }

  face(dir: Dir): void {
    this.targetYaw = YAW[dir];
  }

  startHop(toX: number, toRow: number, toY: number, carry: LaneRuntime | null): void {
    this.fromX = this.x;
    this.fromRow = this.visualRow;
    this.fromY = this.y;
    this.toX = toX;
    this.toRow = toRow;
    this.toY = toY;
    this.hopT = 0;
    this.hopping = true;
    this.carryLane = carry;
    this.platformLane = null;
    this.platformIndex = -1;
    this.floating = false;
    this.landT = 0;
    this.idle = 0;
    this.hops++;
    this.hasMoved = true;
  }

  bump(dir: Dir): void {
    this.face(dir);
    this.bumpT = 0.16;
  }

  /** Advance the hop. Returns true on the frame the player lands. */
  advanceHop(dt: number): boolean {
    if (!this.hopping) return false;
    if (this.carryLane) {
      const v = this.carryLane.velocity * dt;
      this.fromX += v;
      this.toX += v;
    }
    this.hopT = Math.min(1, this.hopT + dt / HOP_DURATION);
    const t = this.hopT;
    this.x = this.fromX + (this.toX - this.fromX) * t;
    this.visualRow = this.fromRow + (this.toRow - this.fromRow) * t;
    this.row = t < 0.5 ? Math.round(this.fromRow) : this.toRow;
    this.y = this.fromY + (this.toY - this.fromY) * t + Math.sin(Math.PI * t) * HOP_HEIGHT;
    if (t >= 1) {
      this.hopping = false;
      this.carryLane = null;
      this.y = this.toY;
      this.visualRow = this.toRow;
      this.landT = LAND_SQUASH_TIME;
      return true;
    }
    return false;
  }

  /** Visual animation while alive (squash/stretch, facing). */
  animate(dt: number): void {
    // Shortest-path yaw interpolation.
    let d = this.targetYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, dt * 22);
    let sy = 1;
    let sxz = 1;
    if (this.hopping) {
      const s = Math.sin(Math.PI * this.hopT);
      sy = 1 + 0.22 * s;
      sxz = 1 - 0.1 * s;
    } else if (this.landT > 0) {
      this.landT = Math.max(0, this.landT - dt);
      const k = this.landT / LAND_SQUASH_TIME;
      sy = 1 - 0.28 * k;
      sxz = 1 + 0.16 * k;
    }
    let bumpY = 0;
    if (this.bumpT > 0) {
      this.bumpT = Math.max(0, this.bumpT - dt);
      const k = this.bumpT / 0.16;
      bumpY = Math.sin(k * Math.PI) * 0.12;
      sy *= 1 - 0.12 * Math.sin(k * Math.PI);
    }
    this.body.scale.set(sxz, sy, sxz);
    this.body.rotation.set(0, this.yaw, 0);
    this.body.position.y = bumpY;
    this.syncTransform();
  }

  syncTransform(): void {
    this.root.position.set(this.x, this.y, -this.visualRow);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.material.dispose();
    // Geometry is owned by the character library cache.
  }
}
