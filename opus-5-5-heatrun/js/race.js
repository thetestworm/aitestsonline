// Race events: circuit, sprint, lap knockout, tollbooth, speedtrap and drag.
import * as THREE from 'three';
import { nodePos, LANE_IN, LANE_OUT } from './world.js';
import { buildCar } from './carmesh.js';
import { Vehicle, driveTo } from './vehicle.js';
import { CARS, carSpec, RIVALS } from './career.js';
import { clamp, wrapAngle } from './util.js';

// Start point of an event without building the course (for free-roam markers).
export function raceStart(ev) {
  const a = nodePos(ev.route[0]), b = nodePos(ev.route[1]);
  return ev.type === 'drag' ? a : { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

const OPP_NAMES = ['Ziggy', 'Moreno', 'Tank', 'Quill', 'Rook', 'Dace', 'Nix', 'Juno', 'Haze', 'Pike', 'Lark', 'Volt'];
const OPP_COLORS = [0x2050a0, 0xb02a1a, 0xe0c020, 0x208040, 0xe0e0e0, 0x602080, 0xf08020, 0x101010];

export class Race {
  constructor(game, ev) {
    this.game = game; this.ev = ev; this.type = ev.type;
    this.state = 'countdown'; this.count = 3.6; this.t = 0;
    this.racers = []; this.result = null;
    this.objects = [];
    this.buildCourse();
  }

  buildCourse() {
    const ev = this.ev, rt = ev.route.map(nodePos);
    this.closed = ev.type === 'circuit' || ev.type === 'knockout';
    const wps = [];
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    if (this.closed) {
      this.start = mid(rt[0], rt[1]);
      for (let k = 1; k < rt.length; k++) wps.push({ ...rt[k] });
      wps.push({ ...rt[0] });
      wps.push({ ...this.start, line: true });
      this.startDir = Math.atan2(rt[1].x - rt[0].x, rt[1].z - rt[0].z);
    } else if (ev.type === 'drag') {
      this.start = { x: rt[0].x, z: rt[0].z };
      this.end = rt[rt.length - 1];
      this.startDir = Math.atan2(this.end.x - this.start.x, this.end.z - this.start.z);
      for (let k = 1; k < rt.length; k++) wps.push({ ...rt[k] });
    } else {
      this.start = mid(rt[0], rt[1]);
      this.startDir = Math.atan2(rt[1].x - rt[0].x, rt[1].z - rt[0].z);
      for (let k = 1; k < rt.length; k++) {
        if (ev.type === 'speedtrap' && k % 2 === 0) wps.push({ ...mid(rt[k - 1], rt[k]), trap: true });
        wps.push({ ...rt[k] });
      }
    }
    wps[wps.length - 1].finish = true;
    this.wps = wps;
    // cumulative distance
    this.cum = [];
    let acc = 0, px = this.start.x, pz = this.start.z;
    for (const w of wps) { acc += Math.hypot(w.x - px, w.z - pz); this.cum.push(acc); px = w.x; pz = w.z; }
    this.lapLen = acc;
    // tollbooth timing
    if (ev.type === 'tollbooth') {
      // required average speed scales with the player's own car and the event tier
      const top = this.game.player?.spec.top || 60;
      const v = top * (0.4 + 0.16 * ev.tier);
      this.timeLeft = this.cum[0] / v + 7; // standing start
      this.segTime = wps.map((w, k) => (k === 0 ? 0 : (this.cum[k] - this.cum[k - 1]) / v + 1.5));
    }
    // checkpoint beacon
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffc040, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 60, 24, 1, true), beamMat);
    this.beacon.position.y = 30;
    this.game.scene.add(this.beacon); this.objects.push(this.beacon);
    const ring = new THREE.Mesh(new THREE.RingGeometry(8.6, 9.6, 40), new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15;
    this.beaconRing = ring; this.game.scene.add(ring); this.objects.push(ring);
    // start/finish banner
    const fin = this.closed ? this.start : wps[wps.length - 1];
    const prev = this.closed ? wps[wps.length - 2] : wps.length > 1 ? wps[wps.length - 2] : this.start;
    const fd = this.closed ? this.startDir : Math.atan2(fin.x - prev.x, fin.z - prev.z);
    const banner = new THREE.Group();
    const c = document.createElement('canvas'); c.width = 512; c.height = 64;
    const g = c.getContext('2d');
    for (let i = 0; i < 32; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#eee'; g.fillRect(i * 16, j * 16, 16, 16); }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(24, 3), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    cloth.position.y = 8; banner.add(cloth);
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 9.5, 0.5), new THREE.MeshLambertMaterial({ color: 0x222222 })); p.position.set(s * 12, 4.75, 0); banner.add(p); }
    banner.position.set(fin.x, 0, fin.z); banner.rotation.y = fd;
    this.game.scene.add(banner); this.objects.push(banner);
    this.owned = [this.beacon, ring, banner]; // course props whose GPU resources die with the race
  }

  addRacer(veh, name, isPlayer, color) {
    const r = { veh, name, isPlayer, wp: 0, lap: 0, done: false, out: false, finishT: 0, traps: [], sum: 0, color, lane: 1 };
    this.racers.push(r);
    return r;
  }

  spawnField(player) {
    const ev = this.ev;
    const g = this.game;
    const h = this.startDir;
    const fx = Math.sin(h), fz = Math.cos(h), rx = -fz, rz = fx;
    const slots = ev.type === 'drag'
      ? [[LANE_IN, 0], [LANE_OUT, 0]]
      : [[-3.2, 0], [3.2, -9], [-3.2, -18], [3.2, -27]];
    const n = ev.opponents;
    // player at the back of the grid (or lane 1 for drag)
    const ps = ev.type === 'drag' ? slots[0] : slots[Math.min(n, slots.length - 1)];
    player.place(this.start.x + fx * ps[1] + rx * ps[0], this.start.z + fz * ps[1] + rz * ps[0], h);
    this.player = this.addRacer(player, 'YOU', true, 0xffffff);
    this.player.lane = ev.type === 'drag' ? 2 : 0; // drag slots sit in lanes[2] and lanes[3]
    for (let k = 0; k < n; k++) {
      let spec, style, color, stripe = null, name;
      if (ev.rival !== undefined) {
        const rv = RIVALS[ev.rival];
        const c = CARS[rv.car];
        spec = carSpec({ id: rv.car, up: { engine: 2, trans: 2, susp: 2, tires: 2, turbo: 1 + Math.floor(ev.rival / 5), nitrous: 2 } });
        style = c.style; color = rv.color; stripe = rv.stripe; name = rv.tag;
      } else {
        const ids = Object.keys(CARS).filter((id) => Math.abs(CARS[id].tier - (1 + ev.tier * 3)) <= 1);
        const id = ids[(ev.seed + k * 3) % ids.length];
        spec = carSpec({ id, up: { engine: Math.floor(ev.tier * 3), susp: 1, tires: 1 } });
        style = CARS[id].style; color = OPP_COLORS[(ev.seed + k) % OPP_COLORS.length]; name = OPP_NAMES[(ev.seed + k * 5) % OPP_NAMES.length];
        if (k % 2) stripe = 0xf0f0f0;
      }
      const mesh = buildCar({ style, color, stripe });
      g.scene.add(mesh);
      const v = new Vehicle(spec, mesh, 'racer');
      v.baseSpec = { ...spec };
      const s = ev.type === 'drag' ? slots[1] : slots[k];
      v.place(this.start.x + fx * s[1] + rx * s[0], this.start.z + fz * s[1] + rz * s[0], h);
      const r = this.addRacer(v, name, false, color);
      r.lane = 3;
      this.objects.push(mesh);
    }
    if (ev.type === 'drag') this.spawnDragTraffic();
  }

  spawnDragTraffic() {
    const lanes = [-LANE_OUT, -LANE_IN, LANE_IN, LANE_OUT];
    const h = this.startDir, fx = Math.sin(h), fz = Math.cos(h), rx = -fz, rz = fx;
    this.dragTraffic = [];
    const len = Math.hypot(this.end.x - this.start.x, this.end.z - this.start.z);
    for (let d = 160; d < len - 60; d += 55 + Math.random() * 50) {
      const lane = lanes[Math.floor(Math.random() * 4)];
      const mesh = buildCar({ style: ['sedan', 'van', 'hatch', 'pickup'][Math.floor(Math.random() * 4)], color: [0x8a8378, 0x40454c, 0x6b2a22, 0xb8b2a4][Math.floor(Math.random() * 4)] });
      this.game.scene.add(mesh); this.objects.push(mesh);
      const v = new Vehicle({ top: 20, accel: 3, grip: 8, steer: 1, brake: 10, mass: 1600, nitro: 0, nitroDur: 1, nitroFill: 0 }, mesh, 'traffic');
      v.place(this.start.x + fx * d + rx * lane, this.start.z + fz * d + rz * lane, h);
      v.dragSpeed = 9 + Math.random() * 5; v.free = false;
      this.dragTraffic.push(v);
    }
  }

  progress(r) {
    const w = this.wps[Math.min(r.wp, this.wps.length - 1)];
    return r.lap * this.lapLen + this.cum[Math.min(r.wp, this.wps.length - 1)] - Math.hypot(w.x - r.veh.pos.x, w.z - r.veh.pos.z) + (r.done ? 1e6 - r.finishT : 0);
  }
  standings() {
    return [...this.racers].sort((a, b) => (a.out - b.out) || (this.progress(b) - this.progress(a)));
  }
  position(r) { return this.standings().indexOf(r) + 1; }

  // Called every fixed step.
  update(dt) {
    if (this.state === 'countdown') {
      const before = Math.ceil(this.count);
      this.count -= dt;
      if (Math.ceil(this.count) !== before && this.count > 0) this.game.audio.beep(false);
      for (const r of this.racers) { r.veh.hold = true; if (!r.isPlayer) r.veh.input.throttle = 0.3 + Math.random() * 0.5; }
      if (this.count <= 0) {
        this.state = 'running';
        for (const r of this.racers) r.veh.hold = false;
        this.game.audio.beep(true); this.game.hud.banner('GO!', 900);
        // launch: revs held in the sweet spot give a jump, bouncing off the limiter bogs
        const v = this.player.veh, rpm = v.rpm;
        if (rpm > 4500 && rpm < 6800) { v.vx += Math.sin(v.heading) * 4; v.vz += Math.cos(v.heading) * 4; this.game.hud.toast('PERFECT LAUNCH'); }
        else if (rpm >= 7400) { v.shiftTimer = 0.6; this.game.hud.toast('WHEELSPIN'); }
      }
      return;
    }
    if (this.state !== 'running') return;
    this.t += dt;
    for (const r of this.racers) {
      if (r.done || r.out) {
        if (!r.isPlayer) { r.veh.input.throttle = 0; r.veh.input.brake = 0.6; r.veh.input.steer = 0; }
        continue;
      }
      const w = this.wps[r.wp];
      const d = Math.hypot(w.x - r.veh.pos.x, w.z - r.veh.pos.z);
      if (!r.isPlayer) this.drive(r, dt);
      if (d < (r.isPlayer ? 21 : 26) || (this.type === 'drag' && this.passedAlong(r, w))) this.hitWaypoint(r, w);
    }
    if (this.type === 'tollbooth') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0 && !this.player.done) this.finish(false, 'OUT OF TIME');
    }
    if (this.type === 'drag') this.updateDrag(dt);
  }
  passedAlong(r, w) {
    const h = this.startDir;
    return (r.veh.pos.x - w.x) * Math.sin(h) + (r.veh.pos.z - w.z) * Math.cos(h) > 0;
  }

  hitWaypoint(r, w) {
    if (w.trap) {
      const s = r.veh.speed;
      r.traps.push(s); r.sum += s;
      if (r.isPlayer) { this.game.hud.toast(`SPEEDTRAP  ${this.game.fmtSpeed(s)}`); this.game.audio.camera(); }
    }
    if (r.isPlayer) this.game.audio.checkpoint();
    if (this.type === 'tollbooth' && r.isPlayer && r.wp + 1 < this.wps.length) {
      this.timeLeft += this.segTime[r.wp + 1];
      this.game.hud.toast(`CHECKPOINT  +${this.segTime[r.wp + 1].toFixed(1)}s`);
    }
    r.wp++;
    if (r.wp >= this.wps.length) {
      r.lap++;
      if (this.closed && r.lap < this.ev.laps) {
        r.wp = 0;
        if (r.isPlayer) this.game.hud.banner(r.lap === this.ev.laps - 1 ? 'FINAL LAP' : `LAP ${r.lap + 1}`, 1200);
        if (this.type === 'knockout') this.knockoutCheck(r.lap);
        return;
      }
      r.wp = this.wps.length - 1;
      r.done = true; r.finishT = this.t;
      if (this.type === 'knockout') this.knockoutCheck(r.lap);
      if (r.isPlayer) this.playerFinished();
    }
  }
  knockoutCheck(lap) {
    const alive = this.racers.filter((r) => !r.out);
    const crossed = alive.filter((r) => r.lap >= lap);
    if (crossed.length === alive.length - 1 && alive.length > 1) {
      const loser = alive.find((r) => r.lap < lap);
      loser.out = true;
      this.game.hud.toast(`${loser.name} KNOCKED OUT`);
      if (loser.isPlayer) this.finish(false, 'KNOCKED OUT');
      else if (alive.length - 1 === 1 && !this.player.out) { this.player.done = true; this.player.finishT = this.t; this.playerFinished(); }
    }
  }

  playerFinished() {
    if (this.type === 'speedtrap') {
      // finish estimates for opponents still on track
      const traps = this.wps.filter((w) => w.trap).length;
      const totals = this.racers.map((r) => {
        const avg = r.traps.length ? r.sum / r.traps.length : 40;
        return { r, total: r.sum + avg * (traps - r.traps.length) };
      }).sort((a, b) => b.total - a.total);
      this.trapTotals = totals;
      const pos = totals.findIndex((t) => t.r.isPlayer) + 1;
      this.finish(pos === 1, pos === 1 ? 'WINNER' : `${ordinal(pos)} PLACE`, pos);
      return;
    }
    if (this.type === 'tollbooth') { this.finish(true, 'COMPLETE', 1); return; }
    const pos = this.position(this.player);
    this.finish(pos === 1, pos === 1 ? 'WINNER' : `${ordinal(pos)} PLACE`, pos);
  }
  finish(won, label, pos = 0) {
    if (this.state === 'done') return;
    this.state = 'done';
    this.result = { won, label, pos, time: this.t };
    this.game.onRaceEnd(this.result);
  }

  // ---------- AI ----------
  drive(r, dt) {
    const v = r.veh;
    if (this.type === 'drag') return; // handled in updateDrag
    const w = this.wps[r.wp];
    const nx = this.wps[r.wp + 1] || (this.closed ? this.wps[0] : null);
    const d = Math.hypot(w.x - v.pos.x, w.z - v.pos.z);
    // rubber band against the player
    const gap = this.progress(r) - this.progress(this.player);
    const band = clamp(1 - gap / 2600, 0.92, 1.07);
    v.spec.top = v.baseSpec.top * band; v.spec.accel = v.baseSpec.accel * clamp(band, 0.9, 1.15);
    let want = v.spec.top;
    let tx = w.x, tz = w.z;
    if (nx) {
      const a1 = Math.atan2(w.x - v.pos.x, w.z - v.pos.z), a2 = Math.atan2(nx.x - w.x, nx.z - w.z);
      const turn = Math.abs(wrapAngle(a2 - a1));
      if (turn > 0.35) {
        const vc = 21 + v.spec.grip * 0.7 - turn * 3;
        want = Math.min(want, Math.sqrt(vc * vc + 2 * v.spec.brake * 0.55 * Math.max(0, d - 10)));
        // aim a little inside the corner
        const ix = (nx.x - w.x) / (Math.hypot(nx.x - w.x, nx.z - w.z) || 1), iz = (nx.z - w.z) / (Math.hypot(nx.x - w.x, nx.z - w.z) || 1);
        if (d < 30) { tx += ix * 8; tz += iz * 8; }
      }
    }
    // avoid traffic straight ahead by shifting the aim point
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    for (const o of this.game.traffic.cars) {
      const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z, ahead = dx * fx + dz * fz;
      if (ahead < 4 || ahead > 40) continue;
      const lat = dx * fz - dz * fx;
      if (Math.abs(lat) < 2.8) { const s = lat > 0 ? 1 : -1; tx += fz * s * 5; tz -= fx * s * 5; break; }
    }
    driveTo(v, tx, tz, want, { dt, nitro: gap < 100 });
  }

  updateDrag(dt) {
    const h = this.startDir, fx = Math.sin(h), fz = Math.cos(h), rx = -fz, rz = fx;
    const lanes = [-LANE_OUT, -LANE_IN, LANE_IN, LANE_OUT];
    for (const v of this.dragTraffic) {
      if (v.free) { v.input.throttle = 0; v.input.brake = 1; v.update(dt); continue; }
      v.savePrev();
      v.heading = h; v.vx = fx * v.dragSpeed; v.vz = fz * v.dragSpeed;
      v.pos.x += v.vx * dt; v.pos.z += v.vz * dt;
    }
    for (const r of this.racers) {
      const v = r.veh;
      if (r.done || r.out) continue;
      if (!r.isPlayer) {
        // AI: shift near-perfectly, change lane for traffic ahead
        v.manual = true;
        v.input.throttle = 1; v.input.brake = 0; v.input.nitro = this.t > 3;
        if (v.rpm > 7300 && v.gear < 5) { v.gear++; v.shiftTimer = 0.2; }
        for (const o of this.dragTraffic) {
          const dx = o.pos.x - v.pos.x, dz = o.pos.z - v.pos.z, ahead = dx * fx + dz * fz;
          if (ahead < 0 || ahead > 45) continue;
          if (Math.abs((dx * rx + dz * rz)) < 2.5) {
            const opts = [r.lane - 1, r.lane + 1].filter((l) => l >= 0 && l < 4);
            r.lane = opts[Math.floor(Math.random() * opts.length)];
            break;
          }
        }
      }
      // lock to lane
      const lat = (v.pos.x - this.start.x) * rx + (v.pos.z - this.start.z) * rz;
      const target = lanes[r.lane];
      const nl = lat + clamp(target - lat, -dt * 9, dt * 9);
      v.pos.x += rx * (nl - lat); v.pos.z += rz * (nl - lat);
      v.heading = h + clamp((target - lat) * -0.04, -0.15, 0.15);
      const along = v.vx * fx + v.vz * fz;
      v.vx = fx * along; v.vz = fz * along; v.yawRate = 0;
      if (r.isPlayer) {
        if (v.rpm > 7950) { this.overrev = (this.overrev || 0) + dt; if (this.overrev > 2.2) { v.blown = true; this.finish(false, 'ENGINE BLOWN'); } }
        else this.overrev = Math.max(0, (this.overrev || 0) - dt * 0.5);
      }
    }
  }
  dragShift(up) {
    const v = this.player.veh;
    if (this.state !== 'running') return;
    if (up && v.gear < 5) {
      const r = v.rpm;
      let msg = 'GOOD SHIFT', boost = 0.5;
      if (r > 6900 && r < 7700) { msg = 'PERFECT SHIFT'; boost = 2.2; }
      else if (r < 5600) { msg = 'EARLY SHIFT'; boost = -0.5; }
      v.gear++; v.shiftTimer = 0.18;
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      v.vx += fx * boost; v.vz += fz * boost;
      this.game.hud.toast(msg);
    } else if (!up && v.gear > 0) { v.gear--; v.shiftTimer = 0.18; }
  }
  dragLane(dir) { this.player.lane = clamp(this.player.lane + dir, 0, 3); }

  colliders() {
    const out = this.racers.filter((r) => !r.isPlayer).map((r) => r.veh);
    if (this.dragTraffic) out.push(...this.dragTraffic);
    return out;
  }

  nextWaypoint() { return this.wps[Math.min(this.player.wp, this.wps.length - 1)]; }

  sync(time, alpha) {
    const w = this.nextWaypoint();
    this.beacon.position.set(w.x, 30, w.z);
    this.beaconRing.position.set(w.x, 0.15, w.z);
    this.beacon.material.color.setHex(w.trap ? 0x40c0ff : w.finish ? 0xffffff : 0xffc040);
    this.beacon.material.opacity = 0.16 + Math.sin(time * 4) * 0.05;
    for (const r of this.racers) if (!r.isPlayer) r.veh.sync(alpha);
    if (this.dragTraffic) for (const v of this.dragTraffic) v.sync(alpha);
  }

  dispose() {
    for (const o of this.objects) this.game.scene.remove(o);
    for (const o of this.owned) o.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); } });
  }
}

export const ordinal = (n) => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
