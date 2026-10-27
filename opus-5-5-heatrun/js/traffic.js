// Civilian traffic: kinematic lane-following until hit, then free physics.
import * as THREE from 'three';
import { N, ROAD_W, LANE_IN, LANE_OUT, nodePos } from './world.js';
import { buildCar } from './carmesh.js';
import { Vehicle } from './vehicle.js';

const STYLES = ['sedan', 'sedan', 'hatch', 'van', 'pickup', 'sedan', 'suv', 'hatch'];
const COLORS = [0x8a8378, 0x40454c, 0x6b2a22, 0xb8b2a4, 0x2b3a52, 0x5a5f3c, 0x1c1c1c, 0xa58b5c, 0x7a7f86, 0x334a3a];
const TSPEC = { top: 30, accel: 4, grip: 7, steer: 0.9, brake: 14, mass: 1500, nitro: 0, nitroDur: 1, nitroFill: 0 };

function legGeom(a, b, lane) {
  const pa = nodePos(a), pb = nodePos(b);
  const dx = Math.sign(pb.x - pa.x), dz = Math.sign(pb.z - pa.z);
  const rx = -dz, rz = dx; // right of travel
  return { pa, pb, dx, dz, rx, rz, off: lane ? LANE_OUT : LANE_IN };
}

export class Traffic {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.cars = [];
    this.max = 34;
    this.enabled = true;
  }
  clear() { for (const c of this.cars) this.scene.remove(c.mesh); this.cars.length = 0; }

  spawn(px, pz, minD, maxD) {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.floor(Math.random() * N * N);
      const p = nodePos(a);
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d < minD || d > maxD) continue;
      const nb = this.world.neighbors(a);
      const b = nb[Math.floor(Math.random() * nb.length)];
      return this.add(a, b, Math.random() < 0.5 ? 1 : 0, Math.random());
    }
    return null;
  }
  add(a, b, lane, t = 0, opts = {}) {
    const style = opts.style || STYLES[Math.floor(Math.random() * STYLES.length)];
    const mesh = buildCar({ style, color: opts.color ?? COLORS[Math.floor(Math.random() * COLORS.length)] });
    this.scene.add(mesh);
    const v = new Vehicle(TSPEC, mesh, 'traffic');
    v.mass = style === 'van' || style === 'suv' || style === 'pickup' ? 2100 : 1450;
    v.tr = { a, b, lane, s: 0, phase: 'leg', cruise: opts.cruise ?? 12 + Math.random() * 5, cur: 0 };
    v.free = false; v.age = 0; v.deadT = 0;
    const g = legGeom(a, b, lane);
    const len = Math.abs(g.pb.x - g.pa.x) + Math.abs(g.pb.z - g.pa.z) - ROAD_W;
    v.tr.s = t * len;
    v.tr.cur = v.tr.cruise;
    this.place(v);
    this.cars.push(v);
    return v;
  }

  // Compute position on current leg/turn and write into the vehicle.
  place(v) {
    const tr = v.tr, g = legGeom(tr.a, tr.b, tr.lane);
    if (tr.phase === 'leg') {
      const x = g.pa.x + g.dx * (ROAD_W / 2 + tr.s) + g.rx * g.off;
      const z = g.pa.z + g.dz * (ROAD_W / 2 + tr.s) + g.rz * g.off;
      v.pos.set(x, 0, z);
      v.heading = Math.atan2(g.dx, g.dz);
    } else {
      const t = tr.s / tr.turn.len, [p0, p1, p2] = tr.turn.p;
      const u = 1 - t;
      const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
      const z = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
      const tx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
      const tz = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
      v.pos.set(x, 0, z);
      if (tx * tx + tz * tz > 1e-6) v.heading = Math.atan2(tx, tz);
    }
    v.vx = Math.sin(v.heading) * tr.cur; v.vz = Math.cos(v.heading) * tr.cur;
  }

  beginTurn(v) {
    const tr = v.tr;
    const opts = this.world.neighbors(tr.b).filter((n) => n !== tr.a);
    let c = opts[Math.floor(Math.random() * opts.length)];
    if (tr.fixed && opts.length) {
      // keep straight when possible (drag strip traffic)
      const g = legGeom(tr.a, tr.b, tr.lane);
      const straight = opts.find((n) => { const p = nodePos(n), pb = nodePos(tr.b); return Math.sign(p.x - pb.x) === g.dx && Math.sign(p.z - pb.z) === g.dz; });
      if (straight !== undefined) c = straight;
    }
    const gi = legGeom(tr.a, tr.b, tr.lane), go = legGeom(tr.b, c, tr.lane);
    const B = gi.pb;
    const p0 = [B.x - gi.dx * ROAD_W / 2 + gi.rx * gi.off, B.z - gi.dz * ROAD_W / 2 + gi.rz * gi.off];
    const p2 = [B.x + go.dx * ROAD_W / 2 + go.rx * go.off, B.z + go.dz * ROAD_W / 2 + go.rz * go.off];
    let p1;
    if (gi.dx === go.dx && gi.dz === go.dz) p1 = [(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2];
    else p1 = [B.x + gi.rx * gi.off + go.rx * go.off, B.z + gi.rz * gi.off + go.rz * go.off];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    tr.turn = { p: [p0, p1, p2], len: Math.max(1, len * 0.92), next: c };
    tr.phase = 'turn'; tr.s = 0;
  }

  update(dt, player, others) {
    const all = this.cars;
    for (const v of all) {
      v.age += dt;
      if (v.free) {
        v.input.throttle = 0; v.input.brake = 1; v.input.steer = 0;
        v.update(dt);
        v.deadT += dt;
        continue;
      }
      const tr = v.tr;
      v.savePrev();
      // look ahead for cars in the way
      let want = tr.cruise;
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      const check = (o) => {
        if (o === v) return;
        const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z;
        const ahead = dx * fx + dz * fz;
        if (ahead < 0 || ahead > 22) return;
        const lat = Math.abs(dx * fz - dz * fx);
        if (lat > 2.6) return;
        const ospd = o.vx * fx + o.vz * fz;
        want = Math.min(want, Math.max(0, ospd) + Math.max(0, (ahead - 8) * 0.6));
      };
      for (const o of all) check(o);
      for (const o of others) check(o);
      tr.cur += Math.max(-10 * dt, Math.min(3 * dt, want - tr.cur));
      tr.cur = Math.max(0, tr.cur);
      tr.s += tr.cur * dt;
      if (tr.phase === 'leg') {
        const g = legGeom(tr.a, tr.b, tr.lane);
        const len = Math.abs(g.pb.x - g.pa.x) + Math.abs(g.pb.z - g.pa.z) - ROAD_W;
        if (tr.s >= len) this.beginTurn(v);
      } else if (tr.s >= tr.turn.len) {
        tr.a = tr.b; tr.b = tr.turn.next; tr.phase = 'leg'; tr.s = 0;
      }
      this.place(v);
    }
  }
  sync(alpha) { for (const v of this.cars) v.sync(alpha); }

  manage(px, pz, playerSpeed) {
    // recycle distant or long-dead cars, keep density around the player
    for (let k = this.cars.length - 1; k >= 0; k--) {
      const v = this.cars[k];
      const d = Math.hypot(v.pos.x - px, v.pos.z - pz);
      if (d > 560 || (v.free && v.deadT > 25 && d > 120)) {
        this.scene.remove(v.mesh);
        this.cars.splice(k, 1);
      }
    }
    if (!this.enabled) return;
    let n = 0;
    while (this.cars.length < this.max && n++ < 3) this.spawn(px, pz, this.cars.length < this.max / 2 ? 120 : 260, 520);
  }
}
