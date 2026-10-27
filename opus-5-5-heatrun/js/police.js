// Police: patrols, pursuits, heat, roadblocks, spike strips, helicopter,
// evade/cooldown, busted meter, bounty, infractions and dispatch chatter.
import * as THREE from 'three';
import { N, SP, ROAD_W, LANE_IN, nodePos, nodeId, lineAt, HALF } from './world.js';
import { buildCar, buildHeli, buildSpikeStrip } from './carmesh.js';
import { Vehicle, driveTo } from './vehicle.js';
import { clamp, wrapAngle } from './util.js';

const UNITS = {
  cruiser:     { style: 'sedan', color: 0x15171b, top: 60, accel: 9.5,  grip: 9,   steer: 1.0, brake: 26, mass: 1650, health: 1.0, cost: 12000, label: 'CRUISER' },
  heavy:       { style: 'suv',   color: 0x15171b, top: 60, accel: 9.0,  grip: 8.5, steer: 0.9, brake: 24, mass: 2700, health: 2.2, cost: 30000, label: 'HEAVY SUV' },
  interceptor: { style: 'super', color: 0x15171b, top: 82, accel: 12.5, grip: 10.5,steer: 1.0, brake: 30, mass: 1500, health: 1.2, cost: 45000, label: 'INTERCEPTOR' },
  undercover:  { style: 'coupe', color: 0x6a6f78, top: 78, accel: 12,   grip: 10,  steer: 1.0, brake: 30, mass: 1450, health: 1.1, cost: 38000, label: 'UNDERCOVER' },
};
// Per heat: target active units, unit mix, roadblock interval, spikes, heli.
const HEAT = [
  null,
  { units: 2, mix: ['cruiser'], rb: 0, spikes: false, heli: false, speed: 0.86 },
  { units: 3, mix: ['cruiser', 'cruiser', 'undercover'], rb: 0, spikes: false, heli: false, speed: 0.92 },
  { units: 4, mix: ['cruiser', 'heavy', 'cruiser'], rb: 32, spikes: false, heli: false, speed: 0.97 },
  { units: 5, mix: ['cruiser', 'heavy', 'undercover', 'interceptor'], rb: 24, spikes: true, heli: false, speed: 1.02 },
  { units: 7, mix: ['interceptor', 'heavy', 'undercover', 'interceptor', 'cruiser'], rb: 18, spikes: true, heli: true, speed: 1.06 },
];
const HEAT_TIME = [0, 0, 45, 110, 190, 290];   // pursuit seconds to reach heat N
const HEAT_BOUNTY = [0, 0, 6000, 18000, 40000, 80000];

export const INFRACTIONS = {
  speeding: 'Speeding', reckless: 'Reckless driving', ramming: 'Ramming a police vehicle',
  hitrun: 'Hit and run', property: 'Damage to property', offroad: 'Driving off roadway', resisting: 'Resisting arrest',
};

const LINES = {
  start: ['Dispatch, unit {u} in pursuit. Suspect vehicle is not stopping.', 'Unit {u}, I have a runner heading {d}. Lights and sirens.', 'Dispatch, be advised, suspect just blew past me doing triple digits.'],
  heat: ['All units, suspect is escalating. Authorize additional cars.', 'This guy is serious. Requesting heavy support.', 'Command authorizes all available units. Stop that vehicle.', 'Air support is spinning up. Keep eyes on him.'],
  roadblock: ['Roadblock set up {d} of the suspect. Box him in.', 'Units in position, roadblock is hot.', 'We have the road sealed. He is coming right at us.'],
  spikes: ['Spike strips are down. Watch your tires, people.', 'Strips deployed at the roadblock.'],
  heli: ['Air unit on scene. I have visual from above.', 'Chopper has the suspect. Calling out turns.'],
  down: ['Unit down! I am out of this one.', 'I am disabled, repeat, I am disabled.', 'He took me out. Somebody stay on him.', 'Car is totaled. Need a tow.'],
  lost: ['Lost visual. Last seen heading {d}.', 'Anyone have eyes on him? I lost him.', 'Suspect is out of sight. Start a grid search.'],
  cooldown: ['All units, search the area. He is hiding somewhere.', 'Check the parking structures and alleys.'],
  spotted: ['Got him! Suspect spotted, back in pursuit!', 'There he is! Resume pursuit!'],
  evaded: ['Dispatch, we lost him. Calling off the search.', 'Suspect is gone. All units return to patrol.'],
  busted: ['Suspect in custody. Nice work, everyone.', 'We got him. Bring the wagon.'],
  breaker: ['Watch out! The structure is coming down!', 'Debris on the road! Units are trapped!'],
  spiked: ['Tires are shredded! He is on the rims!'],
  rbEvaded: ['He got through the roadblock! Turn around!', 'Roadblock failed, he is through.'],
};
const dirName = (vx, vz) => (Math.abs(vx) > Math.abs(vz) ? (vx > 0 ? 'east' : 'west') : (vz > 0 ? 'south' : 'north'));

export class Police {
  constructor(scene, world, hooks) {
    this.scene = scene; this.world = world; this.hooks = hooks; // hooks: radio(text), sfx(name), flash(), toast(text)
    this.units = []; this.roadblocks = []; this.heli = null;
    this.patrolMax = 4;
    this.unitSeq = 100;
    this.reset();
  }
  reset() {
    for (const u of this.units) this.scene.remove(u.mesh);
    for (const rb of this.roadblocks) this.removeRoadblock(rb);
    this.units = []; this.roadblocks = [];
    if (this.heli) { this.scene.remove(this.heli.mesh); this.heli = null; }
    this.state = 'none';  // none | pursuit | cooldown
    this.p = null;
    this.radioCd = 0;
  }
  get active() { return this.state !== 'none'; }

  radio(kind, vars = {}, force = false) {
    if (!force && this.radioCd > 0) return;
    const list = LINES[kind];
    let t = list[Math.floor(Math.random() * list.length)];
    for (const k in vars) t = t.replace('{' + k + '}', vars[k]);
    this.hooks.radio(t);
    this.radioCd = 5;
  }

  makeUnit(type, x, z, heading, mode) {
    const def = UNITS[type];
    const mesh = buildCar({ style: def.style, color: def.color, police: type });
    this.scene.add(mesh);
    const v = new Vehicle({ ...def, nitro: 6, nitroDur: 3, nitroFill: 0 }, mesh, 'cop');
    v.type = type; v.def = def; v.health = def.health; v.mode = mode; v.id = this.unitSeq++;
    v.path = []; v.repath = 0; v.lightT = Math.random() * 6;
    v.mass = def.mass;
    v.place(x, z, heading);
    this.units.push(v);
    return v;
  }

  // ---------- pursuit lifecycle ----------
  startPursuit(player, carHeat, reason) {
    if (this.state !== 'none') return;
    this.state = 'pursuit';
    this.p = {
      t: 0, heat: Math.max(1, carHeat), bounty: 0, cost: 0, immob: 0, involved: 0, damaged: 0,
      roadblocks: 0, spikes: 0, breakers: 0, helis: 0, infractions: new Set(),
      evade: 0, cooldown: 0, bust: 0, seen: true, lastSeen: player.pos.clone(), spawnT: 2, rbT: 12,
      heliT: 0, spiked: false, unseenT: 0, bountyTick: 0,
    };
    for (const u of this.units) if (u.mode === 'patrol') { u.mode = 'chase'; this.p.involved++; }
    this.addInfraction(reason);
    this.radio('start', { u: this.units[0]?.id ?? 12, d: dirName(player.vx, player.vz) }, true);
    this.hooks.sfx('siren');
    this.hooks.onStart?.();
  }
  addInfraction(kind) {
    if (!this.p || !kind || this.p.infractions.has(kind)) return;
    this.p.infractions.add(kind);
    this.p.bounty += 250 * this.p.heat;
    this.hooks.toast(`INFRACTION: ${INFRACTIONS[kind].toUpperCase()}`);
  }
  addCost(v) { if (this.p) this.p.cost += v; }

  setHeat(h) {
    const p = this.p;
    if (h <= p.heat) return;
    p.heat = Math.min(5, h);
    this.hooks.flash();
    this.hooks.toast(`HEAT LEVEL ${p.heat}`);
    this.radio('heat', {}, true);
    if (p.heat >= 3 && !p.rbT) p.rbT = 10;
  }

  endPursuit(result) {
    const p = this.p;
    this.state = 'none';
    for (const u of this.units) { u.mode = u.wrecked ? 'wreck' : 'leave'; u.leaveT = 0; }
    for (const rb of this.roadblocks) this.removeRoadblock(rb);
    this.roadblocks = [];
    if (this.heli) { this.heli.leaving = true; }
    if (result === 'evaded') this.radio('evaded', {}, true);
    if (result === 'busted') this.radio('busted', {}, true);
    this.p = null;
    return p;
  }

  // ---------- spawning ----------
  spawnPoint(player, minD, maxD, avoidSight = true) {
    let best = null;
    for (let k = 0; k < 30; k++) {
      const id = Math.floor(Math.random() * N * N);
      const p = nodePos(id);
      const d = Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
      if (d < minD || d > maxD) continue;
      if (avoidSight && k < 20 && this.world.los(p.x, p.z, player.pos.x, player.pos.z)) continue;
      best = { id, ...p };
      break;
    }
    return best;
  }
  spawnChaser(player) {
    const p = this.p;
    const mix = HEAT[p.heat].mix;
    const type = mix[Math.floor(Math.random() * mix.length)];
    const sp = this.spawnPoint(player, 160, 380);
    if (!sp) return;
    const h = Math.atan2(player.pos.x - sp.x, player.pos.z - sp.z);
    const u = this.makeUnit(type, sp.x, sp.z, h, 'chase');
    p.involved++;
    u.vx = Math.sin(h) * 20; u.vz = Math.cos(h) * 20;
  }
  spawnPatrol(player) {
    const sp = this.spawnPoint(player, 200, 450, false);
    if (!sp) return;
    const nb = this.world.neighbors(sp.id);
    const to = nb[Math.floor(Math.random() * nb.length)], tp = nodePos(to);
    const h = Math.atan2(tp.x - sp.x, tp.z - sp.z);
    const u = this.makeUnit('cruiser', sp.x, sp.z, h, 'patrol');
    u.path = [to]; u.cruise = 13 + Math.random() * 4;
  }

  // Roadblock across the player's road a couple of intersections ahead.
  spawnRoadblock(player) {
    const p = this.p;
    const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
    const alongX = Math.abs(fx) > Math.abs(fz);
    const dir = alongX ? Math.sign(fx) : Math.sign(fz);
    // which line is the player on?
    const lineIdx = Math.round(((alongX ? player.pos.z : player.pos.x) + HALF) / SP);
    const lineC = lineAt(clamp(lineIdx, 0, N - 1));
    if (Math.abs((alongX ? player.pos.z : player.pos.x) - lineC) > ROAD_W) return false;
    const coord = alongX ? player.pos.x : player.pos.z;
    const ahead = Math.max(220, Math.abs(player.vLong) * 6);
    let target = coord + dir * ahead;
    // snap to 45 m before the next intersection beyond target
    let k = Math.round((target + HALF) / SP);
    if (k < 0 || k > N - 1) return false;
    let at = lineAt(k) - dir * 45;
    if ((at - coord) * dir < 120) return false;
    const rb = { cars: [], spikes: null, spikeBox: null, x: alongX ? at : lineC, z: alongX ? lineC : at, alongX, dir, passed: false, hit: false, t: 0 };
    const cross = [-6.2, 0.6, 7.4];
    const withSpikes = HEAT[p.heat].spikes;
    for (let c = 0; c < cross.length; c++) {
      if (withSpikes && c === 0) continue; // spike strip fills that slot
      const lat = cross[c];
      const x = alongX ? at : lineC + lat, z = alongX ? lineC + lat : at;
      const head = alongX ? 0 : Math.PI / 2;
      const type = p.heat >= 4 && c === 1 ? 'heavy' : 'cruiser';
      const u = this.makeUnit(type, x, z, head + (Math.random() - 0.5) * 0.3, 'roadblock');
      u.massMul = 2.5; u.rb = rb;
      rb.cars.push(u);
      p.involved++;
    }
    if (withSpikes) {
      const strip = buildSpikeStrip(9);
      const x = alongX ? at - dir * 4 : lineC - 5.5, z = alongX ? lineC - 5.5 : at - dir * 4;
      strip.position.set(x, 0, z);
      strip.rotation.y = alongX ? Math.PI / 2 : 0;
      this.scene.add(strip);
      rb.spikes = strip;
      rb.spikeBox = alongX ? { x0: x - 0.6, x1: x + 0.6, z0: z - 4.5, z1: z + 4.5 } : { x0: x - 4.5, x1: x + 4.5, z0: z - 0.6, z1: z + 0.6 };
      this.radio('spikes', {}, true);
    } else this.radio('roadblock', { d: dirName(fx, fz) }, true);
    this.roadblocks.push(rb);
    return true;
  }
  removeRoadblock(rb) {
    if (rb.spikes) this.scene.remove(rb.spikes);
    for (const u of rb.cars) if (u.mode === 'roadblock') { u.mode = 'leave'; u.leaveT = 0; }
  }

  // ---------- per-frame ----------
  update(dt, player, ctx) {
    this.radioCd -= dt;
    const p = this.p;
    if (!this.active) {
      // patrols wander and watch for infractions
      if (ctx.allowPatrols) {
        const patrols = this.units.filter((u) => u.mode === 'patrol').length;
        if (patrols < this.patrolMax && Math.random() < dt * 0.5) this.spawnPatrol(player);
      }
    } else {
      this.updatePursuit(dt, player, ctx);
    }
    // drive every unit
    for (let k = this.units.length - 1; k >= 0; k--) {
      const u = this.units[k];
      u.lightT += dt;
      this.driveUnit(u, dt, player);
      u.update(dt);
      const d = Math.hypot(u.pos.x - player.pos.x, u.pos.z - player.pos.z);
      if ((u.mode === 'leave' || u.mode === 'wreck' || u.mode === 'patrol') && d > 600) {
        this.scene.remove(u.mesh); this.units.splice(k, 1);
      } else if (u.mode === 'leave' && (u.leaveT += dt) > 40 && d > 150) {
        this.scene.remove(u.mesh); this.units.splice(k, 1);
      }
    }
    if (this.heli) this.updateHeli(dt, player);
  }

  updatePursuit(dt, player, ctx) {
    const p = this.p, H = HEAT[p.heat];
    p.t += dt;
    const ps = player.speed;
    // --- visibility
    const seeDist = 115 + p.heat * 12;
    const hiding = this.world.inHidingSpot(player.pos.x, player.pos.z);
    let seen = false, nearest = 1e9, nearCount = 0;
    for (const u of this.units) {
      if (u.wrecked || u.mode === 'leave') continue;
      const d = Math.hypot(u.pos.x - player.pos.x, u.pos.z - player.pos.z);
      nearest = Math.min(nearest, d);
      if (d < 13) nearCount++;
      const range = hiding ? seeDist * 0.35 : seeDist;
      if (d < range && this.world.los(u.pos.x, u.pos.z, player.pos.x, player.pos.z)) { seen = true; u.sees = true; } else u.sees = false;
    }
    if (this.heli && !this.heli.leaving && !hiding) {
      const d = Math.hypot(this.heli.x - player.pos.x, this.heli.z - player.pos.z);
      if (d < 140) seen = true;
    }
    p.seen = seen;
    if (seen) p.lastSeen.copy(player.pos);

    if (this.state === 'pursuit') {
      p.bountyTick += dt;
      if (p.bountyTick >= 1) { p.bountyTick -= 1; p.bounty += 15 * p.heat; }
      // heat escalation from time and bounty
      let h = 1;
      for (let k = 2; k <= 5; k++) if (p.t >= HEAT_TIME[k] || p.bounty >= HEAT_BOUNTY[k]) h = k;
      this.setHeat(h);
      // evade
      if (seen) { p.evade = Math.max(0, p.evade - dt * 1.5); p.unseenT = 0; }
      else {
        p.unseenT += dt;
        if (nearest > 45) p.evade = Math.min(1, p.evade + dt / 7);
        if (p.unseenT > 1.5 && p.evade < 0.05) this.radio('lost', { d: dirName(player.vx, player.vz) });
      }
      if (p.evade >= 1) {
        this.state = 'cooldown'; p.cooldown = 0;
        this.radio('cooldown', {}, true);
        for (const u of this.units) if (u.mode === 'chase') { u.mode = 'search'; u.path = []; }
        this.hooks.toast('COOLDOWN');
      }
      // bust meter
      const boxed = ps < 4 && nearCount > 0;
      if (boxed) p.bust = Math.min(1, p.bust + dt * (0.2 + 0.07 * (nearCount - 1)) * (ps < 1.5 ? 1.25 : 1));
      else p.bust = Math.max(0, p.bust - dt * 0.35);
      if (p.bust >= 1) { ctx.onBusted(); return; }
      // reinforcements
      const activeUnits = this.units.filter((u) => u.mode === 'chase' && !u.wrecked).length;
      p.spawnT -= dt;
      if (activeUnits < H.units && p.spawnT <= 0) { this.spawnChaser(player); p.spawnT = activeUnits <= 1 ? 4 : 7; }
      // roadblocks
      if (H.rb) {
        p.rbT -= dt;
        if (p.rbT <= 0 && this.roadblocks.length < 2) p.rbT = this.spawnRoadblock(player) ? H.rb : 3;
      }
      // helicopter
      if (H.heli && !this.heli) {
        p.heliT += dt;
        if (p.heliT > 12) {
          this.heli = { x: player.pos.x - 200, z: player.pos.z - 200, y: 55, vx: 0, vz: 0, mesh: buildHeli(), leaving: false, t: 0 };
          this.scene.add(this.heli.mesh); p.helis++;
          this.radio('heli', {}, true); this.hooks.sfx('heli');
        }
      }
      if (ps > 4 && p.t > 3) this.addInfraction('resisting');
    } else if (this.state === 'cooldown') {
      if (seen) {
        this.state = 'pursuit'; p.evade = 0; p.unseenT = 0;
        for (const u of this.units) if (u.mode === 'search') u.mode = 'chase';
        this.radio('spotted', {}, true);
        this.hooks.toast('SPOTTED');
      } else {
        const dur = 18 + p.heat * 7;
        p.cooldown += (dt / dur) * (hiding ? 3 : 1);
        if (p.cooldown >= 1) { ctx.onEvaded(); return; }
      }
      p.bust = Math.max(0, p.bust - dt);
    }

    // roadblock + spike checks
    for (let k = this.roadblocks.length - 1; k >= 0; k--) {
      const rb = this.roadblocks[k];
      rb.t += dt;
      const rel = rb.alongX ? (player.pos.x - rb.x) * rb.dir : (player.pos.z - rb.z) * rb.dir;
      if (rb.spikeBox && !player.flat) {
        const sb = rb.spikeBox;
        for (const [cx, cz] of player.circles()) if (cx > sb.x0 - 0.8 && cx < sb.x1 + 0.8 && cz > sb.z0 - 0.8 && cz < sb.z1 + 0.8) {
          player.flat = true; rb.hit = true; this.hooks.sfx('pop'); this.hooks.toast('TIRES BLOWN');
          this.radio('spiked', {}, true);
        }
      }
      if (!rb.passed && rel > 8) {
        rb.passed = true;
        const lateral = rb.alongX ? Math.abs(player.pos.z - rb.z) : Math.abs(player.pos.x - rb.x);
        if (lateral < ROAD_W) {
          p.roadblocks++; p.bounty += 500 * p.heat;
          if (rb.spikes && !rb.hit) { p.spikes++; p.bounty += 750 * p.heat; }
          this.hooks.toast('ROADBLOCK EVADED');
          this.radio('rbEvaded', {}, true);
        }
        for (const u of rb.cars) if (!u.wrecked) setTimeout(() => { if (u.mode === 'roadblock') { u.mode = 'chase'; u.massMul = 1; } }, 1200);
      }
      const dist = Math.hypot(player.pos.x - rb.x, player.pos.z - rb.z);
      if ((rb.passed && dist > 250) || (!rb.passed && rel < -700) || rb.t > 70) {
        this.removeRoadblock(rb); this.roadblocks.splice(k, 1);
      }
    }
  }

  updateHeli(dt, player) {
    const h = this.heli;
    h.t += dt;
    let tx = player.pos.x + player.vx * 1.5, tz = player.pos.z + player.vz * 1.5;
    if (h.leaving) { tx = h.x + (h.x - player.pos.x) * 2 + 1; tz = h.z + (h.z - player.pos.z) * 2 + 1; }
    const dx = tx - h.x, dz = tz - h.z, d = Math.hypot(dx, dz);
    const maxV = h.leaving ? 70 : 58;
    const want = Math.min(maxV, d * 0.6);
    const ax = (dx / (d || 1)) * want - h.vx, az = (dz / (d || 1)) * want - h.vz;
    h.vx += clamp(ax, -14, 14) * dt; h.vz += clamp(az, -14, 14) * dt;
    h.x += h.vx * dt; h.z += h.vz * dt;
    const m = h.mesh;
    m.position.set(h.x, h.y + Math.sin(h.t * 1.3) * 0.8, h.z);
    m.rotation.y = Math.atan2(h.vx, h.vz);
    m.rotation.x = clamp(Math.hypot(h.vx, h.vz) * 0.004, 0, 0.25);
    m.userData.rotor.rotation.y += dt * 30;
    m.userData.trotor.rotation.x += dt * 40;
    m.userData.cone.visible = !h.leaving;
    if (h.leaving && Math.hypot(h.x - player.pos.x, h.z - player.pos.z) > 900) { this.scene.remove(m); this.heli = null; }
  }

  // ---------- AI ----------
  driveUnit(u, dt, player) {
    if (u.wrecked) { u.input.throttle = 0; u.input.brake = 1; u.input.steer = 0; return; }
    const H = this.p ? HEAT[this.p.heat] : HEAT[1];
    const scale = H.speed;
    // rubber band: pursuers keep up with fast player cars
    u.spec.top = Math.max(u.def.top, (player.spec.top || 60) * scale) * (u.type === 'heavy' ? 0.92 : 1);
    u.spec.accel = Math.max(u.def.accel, (player.spec.accel || 9) * scale);
    const dpx = player.pos.x - u.pos.x, dpz = player.pos.z - u.pos.z, d = Math.hypot(dpx, dpz);
    if (u.mode === 'roadblock') { u.input.throttle = 0; u.input.brake = 1; u.input.steer = 0; u.input.handbrake = true; return; }
    u.input.handbrake = false;
    if (u.mode === 'chase' && this.p) {
      if (u.sees || d < 45) {
        // intercept / ram
        const lead = clamp(d / 45, 0.15, 1.3);
        let tx = player.pos.x + player.vx * lead, tz = player.pos.z + player.vz * lead;
        if (d < 18 && u.type !== 'heavy') {
          // try to come alongside to box in
          const side = ((u.id % 2) ? 1 : -1) * 2.4;
          tx += -Math.cos(player.heading) * side; tz += Math.sin(player.heading) * side;
        }
        const want = Math.max(20, player.speed + 8 + d * 0.25);
        driveTo(u, tx, tz, Math.min(u.spec.top, want), { dt, nitro: d > 60 });
        if (player.speed < 4 && d < 10) { u.input.throttle = 0.3; u.input.brake = 0.5; } // hold the box
        u.path = [];
        return;
      }
      this.followPath(u, dt, this.p.lastSeen.x, this.p.lastSeen.z, u.spec.top * 0.9);
      return;
    }
    if (u.mode === 'search' && this.p) {
      // sweep around the last known position
      if (!u.searchT || (u.searchT -= dt) <= 0 || !u.path.length) {
        u.searchT = 12;
        const ls = this.p.lastSeen;
        const tx = ls.x + (Math.random() - 0.5) * 500, tz = ls.z + (Math.random() - 0.5) * 500;
        u.goal = { x: tx, z: tz }; u.path = [];
      }
      this.followPath(u, dt, u.goal.x, u.goal.z, 24);
      return;
    }
    if (u.mode === 'patrol' || u.mode === 'leave') {
      if (!u.path.length) {
        const here = this.world.nearestNode(u.pos.x, u.pos.z);
        const nb = this.world.neighbors(here);
        u.path = [nb[Math.floor(Math.random() * nb.length)]];
      }
      const np = nodePos(u.path[0]);
      // keep right
      const fx = Math.sin(u.heading), fz = Math.cos(u.heading);
      const tx = np.x - fz * LANE_IN, tz = np.z + fx * LANE_IN;
      driveTo(u, tx, tz, u.cruise || 15, { dt });
      if (Math.hypot(np.x - u.pos.x, np.z - u.pos.z) < 13) u.path.shift();
      return;
    }
  }
  followPath(u, dt, gx, gz, speed) {
    u.repath -= dt;
    if (u.repath <= 0 || !u.path.length) {
      u.repath = 2;
      const from = this.world.nearestNode(u.pos.x, u.pos.z), to = this.world.nearestNode(gx, gz);
      u.path = this.world.path(from, to);
      // drop the first node if we're past it
      if (u.path.length > 1) {
        const a = nodePos(u.path[0]), b = nodePos(u.path[1]);
        const toB = Math.hypot(b.x - u.pos.x, b.z - u.pos.z), ab = Math.hypot(b.x - a.x, b.z - a.z);
        if (toB < ab) u.path.shift();
      }
    }
    if (!u.path.length) { driveTo(u, gx, gz, speed, { dt }); return; }
    const np = nodePos(u.path[0]);
    const d = Math.hypot(np.x - u.pos.x, np.z - u.pos.z);
    let want = speed;
    if (u.path.length > 1) {
      const nn = nodePos(u.path[1]);
      const turn = Math.abs(wrapAngle(Math.atan2(nn.x - np.x, nn.z - np.z) - Math.atan2(np.x - u.pos.x, np.z - u.pos.z)));
      if (turn > 0.5) want = Math.min(speed, Math.sqrt(22 * 22 + 2 * 16 * Math.max(0, d - 10)));
    }
    driveTo(u, np.x, np.z, want, { dt });
    if (d < 14) u.path.shift();
  }

  // Called by the game when a police unit is damaged.
  damage(u, amount, byPlayer) {
    if (u.wrecked) return;
    u.health -= amount;
    if (this.p && byPlayer && amount > 0.05) { this.p.damaged++; this.addInfraction('ramming'); }
    if (u.health <= 0) this.wreck(u);
  }
  wreck(u) {
    if (u.wrecked) return;
    u.wrecked = true; u.mode = 'wreck';
    u.mesh.userData.lightbar && (u.mesh.userData.lightbar.red.emissiveIntensity = 0, u.mesh.userData.lightbar.blue.emissiveIntensity = 0);
    u.mesh.userData.smoke = true;
    if (this.p) {
      this.p.immob++; this.p.bounty += 1000 * this.p.heat; this.p.cost += u.def.cost;
      this.radio('down', {}, true);
      this.hooks.toast(`${u.def.label} IMMOBILIZED  +${(1000 * this.p.heat).toLocaleString('en-US')}`);
    }
    this.hooks.sfx('wreck');
  }

  // Pursuit breaker collapse: wreck units near the fall zone.
  breaker(b) {
    if (!this.p) return 0;
    let n = 0;
    for (const u of this.units) if (!u.wrecked && Math.hypot(u.pos.x - b.rx, u.pos.z - b.rz) < 34) { this.wreck(u); n++; }
    this.p.breakers++; this.p.bounty += 2500 * this.p.heat; this.p.cost += 50000;
    this.radio('breaker', {}, true);
    this.hooks.toast(`PURSUIT BREAKER  ${n} UNIT${n === 1 ? '' : 'S'} DOWN`);
    return n;
  }

  // Patrol witnesses: returns infraction kind if a patrol sees something.
  watch(player, events) {
    if (this.active) return null;
    for (const u of this.units) {
      if (u.mode !== 'patrol' || u.wrecked) continue;
      const d = Math.hypot(u.pos.x - player.pos.x, u.pos.z - player.pos.z);
      if (d > 75 || !this.world.los(u.pos.x, u.pos.z, player.pos.x, player.pos.z)) continue;
      if (events.hitCop === u) return 'ramming';
      if (events.hitTraffic) return 'hitrun';
      if (player.speed > 31) return 'speeding';
      if (player.slip > 6 && d < 50) return 'reckless';
    }
    return null;
  }

  sync(t) {
    for (const u of this.units) {
      u.sync();
      const lb = u.mesh.userData.lightbar;
      if (lb && !u.wrecked && u.mode !== 'patrol') {
        const ph = Math.floor(t * 8) % 4;
        lb.red.emissiveIntensity = ph < 2 ? 4 : 0.2;
        lb.blue.emissiveIntensity = ph >= 2 ? 4 : 0.2;
      } else if (lb && u.mode === 'patrol') { lb.red.emissiveIntensity = 0.3; lb.blue.emissiveIntensity = 0.3; }
    }
  }
  heatLevel() { return this.p ? this.p.heat : 0; }
  static heatTable() { return HEAT; }
}
