// Arcade vehicle dynamics, static/dynamic collision and a shared AI driver.
import * as THREE from 'three';
import { clamp, wrapAngle, smooth } from './util.js';

const GEAR_FRAC = [0.24, 0.4, 0.55, 0.7, 0.85, 1.0];
const GEAR_MUL = [1.0, 0.86, 0.74, 0.64, 0.56, 0.5];
const REDLINE = 8000, IDLE = 900;

export class Vehicle {
  static groundAt = null; // (x, z) => surface height under a car, set by the game
  // spec: {top (m/s), accel (m/s^2), grip, steer, brake, mass, nitro}
  constructor(spec, mesh, kind = 'racer') {
    this.spec = { ...spec };
    this.mesh = mesh;
    this.kind = kind;
    this.pos = new THREE.Vector3();
    this.heading = 0;
    this.vx = 0; this.vz = 0;
    this.yawRate = 0;
    this.steerAng = 0;
    this.gear = 0; this.rpm = IDLE;
    this.manual = false; this.shiftTimer = 0; this.blown = false;
    this.nitro = 1; this.nitroOn = false;
    this.health = 1; this.flat = false; this.wrecked = false;
    this.slip = 0; this.lastImpact = 0;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false };
    this.halfLen = mesh?.userData.dims ? mesh.userData.dims.L / 2 - 0.9 : 1.3;
    this.radius = mesh?.userData.dims ? mesh.userData.dims.W / 2 + 0.1 : 1.0;
    this.mass = spec.mass || 1400;
    this.wheelSpin = 0; this.roll = 0; this.pitch = 0;
    this.massMul = 1;
  }
  get speed() { return Math.hypot(this.vx, this.vz); }
  get fwdX() { return Math.sin(this.heading); }
  get fwdZ() { return Math.cos(this.heading); }
  get vLong() { return this.vx * this.fwdX + this.vz * this.fwdZ; }
  place(x, z, heading) {
    this.pos.set(x, 0, z); this.heading = heading; this.vx = this.vz = 0; this.yawRate = 0;
    this.savePrev();
    this.sync();
  }
  gearTop(g) { return this.spec.top * GEAR_FRAC[g]; }

  savePrev() { this.ppx = this.pos.x; this.ppz = this.pos.z; this.ph = this.heading; }
  update(dt) {
    this.savePrev();
    const s = this.spec, inp = this.input;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx;
    let vLong = this.vx * fx + this.vz * fz;
    let vLat = this.vx * rx + this.vz * rz;
    const spd = Math.abs(vLong);
    if (this.wrecked) { inp.throttle = 0; inp.brake = 0.4; inp.steer = 0; inp.nitro = false; }
    if (this.hold) {
      // staged on the start line: engine revs, car stays put
      this.rpm = smooth(this.rpm, IDLE + 6200 * inp.throttle, 10, dt);
      this.vx = this.vz = 0; this.yawRate = 0;
      return;
    }

    // --- steering
    const maxA = 0.62 - 0.46 * clamp(spd / 70, 0, 1);
    this.steerAng = smooth(this.steerAng, inp.steer * maxA * s.steer, 9, dt);
    const drifting = inp.handbrake && spd > 8;
    let yawTarget = -(vLong * Math.tan(this.steerAng)) / 2.6;
    // tyres can only deliver so much lateral acceleration: cap yaw rate by speed
    const latMax = (21 * s.grip) / 9 * (drifting ? 2.2 : 1) * (this.flat ? 0.6 : 1);
    const yawCap = latMax / Math.max(6, spd);
    yawTarget = clamp(yawTarget, -yawCap, yawCap);
    let yawResp = drifting ? 3.5 : 8 * s.grip / 9;
    // counter-steer assist: steering against the rotation catches a slide quickly
    if (Math.sign(yawTarget) !== Math.sign(this.yawRate) && Math.abs(vLat) > 2.5) yawResp *= 2;
    this.yawRate = smooth(this.yawRate, yawTarget, yawResp, dt);
    this.heading = wrapAngle(this.heading + this.yawRate * dt);

    // --- gearbox
    const top = s.top * (this.flat ? 0.55 : 1) * (this.nitroOn ? 1.12 : 1);
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (!this.manual) {
      if (this.shiftTimer > 0) { /* mid-shift */ }
      else if (vLong > this.gearTop(this.gear) * 0.97 && this.gear < 5) { this.gear++; this.shiftTimer = 0.25; }
      else if (this.gear > 0 && vLong < this.gearTop(this.gear - 1) * 0.72) this.gear--;
    }
    const gTop = this.gearTop(this.gear);
    const rpmT = IDLE + (REDLINE - IDLE) * clamp(Math.abs(vLong) / gTop, 0, 1.05);
    this.rpm = smooth(this.rpm, inp.throttle > 0.05 && spd < 2 ? IDLE + 4500 * inp.throttle : rpmT, 14, dt);
    const torque = 0.75 + 0.35 * Math.sin(clamp((this.rpm - IDLE) / (REDLINE - IDLE), 0, 1) * Math.PI * 0.9);

    // --- longitudinal
    let a = 0;
    if (inp.throttle > 0 && vLong > -1) {
      if (this.shiftTimer <= 0 && !this.blown) {
        let eng = s.accel * GEAR_MUL[this.gear] * torque * inp.throttle;
        if (vLong >= gTop * 1.02) eng = 0; // limiter
        a += eng;
      }
    } else if (inp.throttle > 0 && vLong <= -1) a += s.brake;
    if (inp.brake > 0) {
      if (vLong > 0.6) a -= s.brake * inp.brake;
      else if (this.kind === 'player' || inp.reverse) { if (vLong > -12) a -= 7 * inp.brake; } // reverse
      else vLong *= Math.max(0, 1 - 8 * dt); // AI brakes to a stop, never backs up by accident
    }
    this.nitroOn = inp.nitro && this.nitro > 0 && vLong > 5 && !this.wrecked;
    if (this.nitroOn) { a += s.nitro; this.nitro = Math.max(0, this.nitro - dt / s.nitroDur); }
    else if (spd > 4 && this.kind === 'player') this.nitro = Math.min(1, this.nitro + dt * s.nitroFill);
    const drag = (s.accel * 0.36 / (top * top)) * vLong * Math.abs(vLong) + 0.012 * vLong;
    a -= drag;
    if (inp.handbrake) a -= Math.sign(vLong) * 3.5;
    if (this.flat) a -= Math.sign(vLong) * 2;
    a -= Math.sign(vLong) * Math.min(6, Math.abs(vLat) * 0.3); // sliding scrubs speed
    if (inp.throttle === 0 && inp.brake === 0 && Math.abs(vLong) < 0.3) vLong = 0;
    vLong += a * dt;

    // --- lateral grip
    let grip = s.grip * (this.flat ? 0.4 : 1);
    if (drifting) grip = 1.4;
    else if (Math.abs(vLat) > 5) grip *= 0.55; // sliding tyres hold less
    vLat *= Math.exp(-grip * dt);
    this.slip = Math.abs(vLat);

    this.vx = fx * vLong + rx * vLat;
    this.vz = fz * vLong + rz * vLat;
    this.pos.x += this.vx * dt;
    this.pos.z += this.vz * dt;
    this.wheelSpin += (vLong / 0.33) * dt;
    this.roll = smooth(this.roll, clamp(this.yawRate * vLong * 0.004, -0.08, 0.08), 6, dt);
    this.pitch = smooth(this.pitch, clamp(-a * 0.004, -0.05, 0.05), 6, dt);
  }

  // alpha interpolates between the previous and current fixed steps
  sync(alpha = 1) {
    if (!this.mesh) return;
    if (this.ppx === undefined || alpha >= 1) {
      this.mesh.position.set(this.pos.x, 0, this.pos.z);
      this.mesh.rotation.y = this.heading;
    } else {
      this.mesh.position.set(this.ppx + (this.pos.x - this.ppx) * alpha, 0, this.ppz + (this.pos.z - this.ppz) * alpha);
      this.mesh.rotation.y = this.ph + wrapAngle(this.heading - this.ph) * alpha;
    }
    // ride up onto kerbs, sidewalks and parks
    const gy = Vehicle.groundAt ? Vehicle.groundAt(this.mesh.position.x, this.mesh.position.z) : 0;
    this.gy = this.gy === undefined ? gy : this.gy + (gy - this.gy) * 0.35;
    this.mesh.position.y = this.gy;
    const ud = this.mesh.userData;
    if (ud.body) { ud.body.rotation.z = this.roll; ud.body.rotation.x = this.pitch; ud.body.position.y = this.flat ? -0.12 : 0; }
    if (ud.wheels) for (const w of ud.wheels) {
      w.userData.spin.rotation.x = this.wheelSpin;
      if (w.userData.front) w.rotation.y = -this.steerAng;
    }
  }

  // Two circles along the body for collision.
  circles() {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    return [
      [this.pos.x + fx * this.halfLen, this.pos.z + fz * this.halfLen],
      [this.pos.x - fx * this.halfLen, this.pos.z - fz * this.halfLen],
    ];
  }
}

// Collide a vehicle with buildings, props and city limits. Returns impact speed.
export function collideStatic(v, world, bound) {
  let impact = 0;
  const r = v.radius;
  for (let pass = 0; pass < 2; pass++) {
    const cs = v.circles();
    for (const [cx0, cz0] of cs) {
      let cx = cx0, cz = cz0;
      for (const blk of world.blocksNear(cx, cz, r + 1)) {
        for (const b of blk.boxes) {
          const px = clamp(cx, b.x0, b.x1), pz = clamp(cz, b.z0, b.z1);
          let dx = cx - px, dz = cz - pz;
          let d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          let d = Math.sqrt(d2), nx, nz, pen;
          if (d < 1e-4) {
            // centre inside the box: push out along the shallowest axis
            const l = cx - b.x0, rr = b.x1 - cx, t = cz - b.z0, bb = b.z1 - cz, m = Math.min(l, rr, t, bb);
            nx = m === l ? -1 : m === rr ? 1 : 0; nz = m === t ? -1 : m === bb ? 1 : 0;
            pen = m + r;
          } else { nx = dx / d; nz = dz / d; pen = r - d; }
          impact = Math.max(impact, applyWall(v, nx, nz, pen));
          cx += nx * pen; cz += nz * pen;
        }
        for (const c of blk.circles) {
          const dx = cx - c.x, dz = cz - c.z, d = Math.hypot(dx, dz), rr = r + c.r;
          if (d >= rr || d < 1e-4) continue;
          impact = Math.max(impact, applyWall(v, dx / d, dz / d, rr - d));
          cx += (dx / d) * (rr - d); cz += (dz / d) * (rr - d);
        }
      }
      // city limits
      if (cx > bound - r) impact = Math.max(impact, applyWall(v, -1, 0, cx - (bound - r)));
      if (cx < -bound + r) impact = Math.max(impact, applyWall(v, 1, 0, -bound + r - cx));
      if (cz > bound - r) impact = Math.max(impact, applyWall(v, 0, -1, cz - (bound - r)));
      if (cz < -bound + r) impact = Math.max(impact, applyWall(v, 0, 1, -bound + r - cz));
    }
  }
  return impact;
}

function applyWall(v, nx, nz, pen) {
  v.pos.x += nx * pen; v.pos.z += nz * pen;
  const vn = v.vx * nx + v.vz * nz;
  if (vn >= 0) return 0;
  // remove inward velocity with a little bounce, scrub some tangential speed
  v.vx -= 1.25 * vn * nx; v.vz -= 1.25 * vn * nz;
  const scrub = 1 - clamp(-vn * 0.025, 0, 0.35);
  v.vx *= scrub; v.vz *= scrub;
  // glancing hits nudge the nose along the wall
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  const side = fx * nz - fz * nx;
  v.yawRate += side * -vn * 0.03;
  return -vn;
}

// Car vs car. Returns impact speed along the normal (0 if none).
export function collidePair(a, b) {
  const dx0 = a.pos.x - b.pos.x, dz0 = a.pos.z - b.pos.z;
  if (dx0 * dx0 + dz0 * dz0 > 49) return 0;
  let best = 0;
  const ca = a.circles(), cb = b.circles();
  const rr = a.radius + b.radius;
  for (const [ax, az] of ca) for (const [bx, bz] of cb) {
    const dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz);
    if (d >= rr || d < 1e-4) continue;
    const nx = dx / d, nz = dz / d, pen = rr - d;
    const ma = a.mass * a.massMul, mb = b.mass * b.massMul;
    const ia = a.static ? 0 : 1 / ma, ib = b.static ? 0 : 1 / mb;
    if (ia + ib === 0) continue;
    a.pos.x += nx * pen * ia / (ia + ib); a.pos.z += nz * pen * ia / (ia + ib);
    b.pos.x -= nx * pen * ib / (ia + ib); b.pos.z -= nz * pen * ib / (ia + ib);
    const rv = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
    if (rv >= 0) continue;
    const j = (-(1.3) * rv) / (ia + ib);
    a.vx += j * ia * nx; a.vz += j * ia * nz;
    b.vx -= j * ib * nx; b.vz -= j * ib * nz;
    // off-centre hits spin the lighter car
    const offA = (ax - a.pos.x) * nz - (az - a.pos.z) * nx;
    const offB = (bx - b.pos.x) * nz - (bz - b.pos.z) * nx;
    a.yawRate -= offA * j * ia * 0.35;
    b.yawRate += offB * j * ib * 0.35;
    best = Math.max(best, -rv);
  }
  return best;
}

// Pure-pursuit driver: steer toward a target point at a desired speed.
export function driveTo(v, tx, tz, desired, opts = {}) {
  const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
  const dx = tx - v.pos.x, dz = tz - v.pos.z;
  const ang = wrapAngle(Math.atan2(dx, dz) - v.heading);
  const inp = v.input;
  inp.reverse = false;
  // positive steer = right = decreasing heading
  inp.steer = clamp(-ang * 2.2, -1, 1);
  const vl = v.vLong;
  // slow down for sharp angles
  const angLimit = Math.abs(ang) > 0.5 ? Math.max(12, desired * (1 - Math.abs(ang) * 0.55)) : desired;
  const want = Math.min(desired, angLimit);
  if (vl < want - 1) { inp.throttle = 1; inp.brake = 0; }
  else if (vl > want + 3) { inp.throttle = 0; inp.brake = clamp((vl - want) / 10, 0.2, 1); }
  else { inp.throttle = 0.4; inp.brake = 0; }
  inp.handbrake = !!opts.handbrake && Math.abs(ang) > 0.9 && vl > 15;
  inp.nitro = !!opts.nitro && Math.abs(ang) < 0.1 && vl > 20;
  // stuck recovery
  if (v.stuckT === undefined) v.stuckT = 0;
  if (v.reverseT > 0) {
    v.reverseT -= opts.dt || 1 / 60;
    inp.throttle = 0; inp.brake = 1; inp.reverse = true; inp.steer = -inp.steer; inp.nitro = false;
    return;
  }
  if (inp.throttle > 0.5 && Math.abs(vl) < 1.5) v.stuckT += opts.dt || 1 / 60; else v.stuckT = 0;
  if (v.stuckT > 1.2) { v.reverseT = 1.1; v.stuckT = 0; }
}
