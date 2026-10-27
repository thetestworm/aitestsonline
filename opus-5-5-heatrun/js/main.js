// HEAT RUN: game orchestration — modes, input, simulation step, camera,
// collisions, career flow and post-event screens.
import * as THREE from 'three';
import { World, BOUND, districtOf, DISTRICT_NAMES, nodePos, lineAt, CURB_H } from './world.js';
import { buildCar } from './carmesh.js';
import { Vehicle, collideStatic, collidePair } from './vehicle.js';
import { Traffic } from './traffic.js';
import { Police } from './police.js';
import { Race, raceStart } from './race.js';
import { Audio } from './audio.js';
import { HUD } from './hud.js';
import { Menu, showMarkers } from './menu.js';
import { createRenderer, setupScene, createComposer } from './post.js';
import { CARS, carSpec, loadSave, newSave, writeSave, RIVALS, RIVAL_EVENTS, RIVAL_MILESTONES, DUELS, UNLOCK_AFTER, TYPE_NAMES, MS_TYPES } from './career.js';
import { clamp, smooth, wrapAngle, MPH, fmtMoney, fmtTime } from './util.js';

const _pos = new THREE.Vector3(), _look = new THREE.Vector3();

const $ = (id) => document.getElementById(id);
const STEP = 1 / 60;

class Particles {
  constructor(scene, max = 400) {
    this.max = max; this.n = 0; this.items = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.col = new Float32Array(max * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 aCol; varying float vA; varying vec3 vC;
        void main(){ vA = aAlpha; vC = aCol; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * (420.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.1, d)); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size, color = [0.75, 0.72, 0.68], grow = 3) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ x, y, z, vx, vy, vz, life, t: 0, size, color, grow });
  }
  update(dt) {
    const it = this.items;
    for (let k = it.length - 1; k >= 0; k--) {
      const p = it[k]; p.t += dt;
      if (p.t >= p.life) { it.splice(k, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vx *= 0.97; p.vz *= 0.97;
    }
    for (let k = 0; k < this.max; k++) {
      const p = it[k];
      if (!p) { this.alpha[k] = 0; continue; }
      const f = p.t / p.life;
      this.pos[k * 3] = p.x; this.pos[k * 3 + 1] = p.y; this.pos[k * 3 + 2] = p.z;
      this.size[k] = p.size * (1 + f * p.grow);
      this.alpha[k] = (1 - f) * 0.5;
      this.col[k * 3] = p.color[0]; this.col[k * 3 + 1] = p.color[1]; this.col[k * 3 + 2] = p.color[2];
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.aSize.needsUpdate = a.aAlpha.needsUpdate = a.aCol.needsUpdate = true;
  }
}

// Tyre marks laid behind sliding rear wheels; a ring buffer of instanced quads.
class SkidMarks {
  constructor(scene, max = 1600) {
    const g = new THREE.PlaneGeometry(0.26, 1).rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ color: 0x0a0908, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    this.mesh = new THREE.InstancedMesh(g, m, max);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.max = max; this.i = 0; this.prev = new Map();
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.up = new THREE.Vector3(0, 1, 0); this.v = new THREE.Vector3(); this.s = new THREE.Vector3();
    scene.add(this.mesh);
  }
  // key identifies a wheel; call every frame with sliding=false to break the trail
  mark(key, x, y, z, sliding) {
    const p = this.prev.get(key);
    if (!sliding) { this.prev.delete(key); return; }
    if (p) {
      const dx = x - p.x, dz = z - p.z, len = Math.hypot(dx, dz);
      if (len < 0.25) return;
      if (len < 4) {
        this.q.setFromAxisAngle(this.up, Math.atan2(dx, dz));
        this.m.compose(this.v.set((x + p.x) / 2, y + 0.01, (z + p.z) / 2), this.q, this.s.set(1, 1, len + 0.05));
        this.mesh.setMatrixAt(this.i, this.m);
        this.i = (this.i + 1) % this.max;
        this.mesh.count = Math.max(this.mesh.count, this.i === 0 ? this.max : this.i);
        this.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.prev.set(key, { x, z });
  }
  clear() { this.mesh.count = 0; this.i = 0; this.prev.clear(); }
}

class Game {
  constructor() {
    this.canvas = $('gl');
    this.renderer = createRenderer(this.canvas);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 4000);
    this.env = setupScene(this.scene, this.renderer);
    this.post = createComposer(this.renderer, this.scene, this.camera);
    this.world = new World(this.scene);
    Vehicle.groundAt = (x, z) => (this.world.onRoad(x, z) ? 0 : CURB_H);
    this.traffic = new Traffic(this.scene, this.world);
    this.audio = new Audio();
    this.particles = new Particles(this.scene);
    this.skids = new SkidMarks(this.scene);
    this.police = new Police(this.scene, this.world, {
      radio: (t) => this.radio(t), sfx: (n) => this.audio.sfx(n), flash: () => { this.flash = 1; this.audio.whoosh(); },
      toast: (t) => this.hud.toast(t), onStart: () => { this.save.stats.pursuits++; },
    });
    this.save = loadSave() || newSave();
    this.hasSave = !!loadSave();
    this.hud = new HUD(this);
    this.menu = new Menu(this); this.menu.bindSettings();
    this.mode = 'title';
    this.keys = new Set();
    this.camMode = 0; this.camHeading = 0; this.shake = 0; this.flash = 0;
    this.sbMeter = 0.5; this.sbActive = false;
    this.acc = 0; this.time = 0; this.paused = false;
    this.markers = []; this.markerMeshes = [];
    this.safehouse = { x: lineAt(6) + 60, z: lineAt(5) };
    this.pendingBreakers = [];
    this.buildSafehouse();
    this.makePlayer();
    this.bindInput();
    this.applySettings();
    addEventListener('resize', () => this.resize());
    this.resize();
    this.showTitle();
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------- setup ----------
  carEntry() { return this.save.garage[this.save.current]; }
  makePlayer() {
    if (this.player) this.scene.remove(this.player.mesh);
    const g = this.carEntry(), c = CARS[g.id];
    const mesh = buildCar({ style: c.style, color: g.color, ownTail: true });
    // nitrous flames
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.1, 8), new THREE.MeshBasicMaterial({ color: 0x70a0ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }));
    flame.rotation.x = -Math.PI / 2;
    const fl = new THREE.Group();
    for (const s of [-0.35, 0.35]) { const f = flame.clone(); f.position.set(s, 0.38, -mesh.userData.dims.L / 2 - 0.55); fl.add(f); }
    fl.visible = false; mesh.add(fl); mesh.userData.flames = fl;
    this.scene.add(mesh);
    const prev = this.player;
    this.player = new Vehicle(carSpec(g), mesh, 'player');
    if (prev) { this.player.pos.copy(prev.pos); this.player.heading = prev.heading; }
    else this.player.place(this.safehouse.x, this.safehouse.z + 0, Math.PI / 2);
    this.player.sync();
  }
  buildSafehouse() {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.3, 32), new THREE.MeshBasicMaterial({ color: 0x40e070, transparent: true, opacity: 0.35, depthWrite: false }));
    m.position.y = 0.2; g.add(m);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 40, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x40e070, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.y = 20; g.add(beam);
    g.position.set(this.safehouse.x, 0, this.safehouse.z);
    this.scene.add(g); this.safehouseMesh = g;
  }
  applySettings() {
    const st = this.save.settings;
    this.audio.setVolume(st.volume);
    this.audio.musicOn = st.music !== false;
    const hq = st.hq !== false;
    this.renderer.shadowMap.enabled = hq;
    this.post.bloom.enabled = hq;
    this.env.sun.castShadow = hq;
  }
  persist() { writeSave(this.save); }
  fmtSpeed(ms, bare) {
    const v = Math.round(Math.abs(ms) * (this.save.settings.mph ? MPH : 3.6));
    return bare ? String(v) : `${v} ${this.save.settings.mph ? 'MPH' : 'KM/H'}`;
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.post.composer.setSize(w, h);
    this.post.grade.uniforms.uRes.value.set(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ---------- input ----------
  bindInput() {
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      this.audio.init();
      const k = e.code;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(k)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      if (this.mode === 'title') { if (k === 'Enter' || k === 'Space') this.titleContinue(); return; }
      if (k === 'Enter' && $('post').classList.contains('show')) { $('post').querySelector('button.big')?.click(); return; }
      if (k === 'Escape' || k === 'KeyP') { if (this.mode === 'roam' || this.mode === 'race') this.togglePause(); return; }
      if (this.paused) return;
      if (this.mode !== 'roam' && this.mode !== 'race') return;
      if (k === 'KeyC') this.camMode = (this.camMode + 1) % 3;
      if (k === 'KeyR') { if (this.police.active) this.hud.toast('CAN\'T RESET DURING A PURSUIT'); else this.resetCar(); }
      if (k === 'KeyE' || k === 'ControlLeft' || k === 'ControlRight') this.toggleSB();
      if (k === 'Enter') this.interact();
      if (this.race && this.race.type === 'drag') {
        if (k === 'KeyW' || k === 'ArrowUp') this.race.dragShift(true);
        if (k === 'KeyS' || k === 'ArrowDown') this.race.dragShift(false);
        if (k === 'KeyA' || k === 'ArrowLeft') this.race.dragLane(-1);
        if (k === 'KeyD' || k === 'ArrowRight') this.race.dragLane(1);
      }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('pointerdown', () => this.audio.init());
    $('pause').addEventListener('click', (e) => {
      const a = e.target.dataset.act; if (!a) return;
      this.audio.ui();
      if (a === 'resume') this.togglePause();
      else if (a === 'restart' && this.race) { const ev = this.race.ev; this.togglePause(); this.endRace(); this.startRace(ev, this.duel); }
      else if (a === 'quit') { this.togglePause(); this.endRace(); this.duel = null; this.toMenu(); }
      else if (a === 'safehouse') { if (this.police.active) return; this.togglePause(); this.toMenu(); }
    });
  }
  readInput() {
    const k = this.keys, inp = this.player.input;
    const pad = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g) : null;
    let steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let thr = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    let brk = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0;
    let hb = k.has('Space'), nos = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyN');
    if (pad) {
      if (Math.abs(pad.axes[0]) > 0.12) steer = pad.axes[0];
      thr = Math.max(thr, pad.buttons[7]?.value || 0);
      brk = Math.max(brk, pad.buttons[6]?.value || 0);
      hb = hb || pad.buttons[0]?.pressed; nos = nos || pad.buttons[1]?.pressed;
      if (pad.buttons[2]?.pressed && !this.padSB) this.toggleSB();
      this.padSB = pad.buttons[2]?.pressed;
    }
    // speed-sensitive keyboard steering: quick at parking speed, progressive at speed
    const sp = clamp(this.player.speed / 60, 0, 1);
    this.steerIn = smooth(this.steerIn || 0, steer * (1 - 0.35 * sp), steer === 0 ? 12 : 7 - 4 * sp, STEP);
    inp.steer = this.steerIn; inp.throttle = thr; inp.brake = brk; inp.handbrake = hb; inp.nitro = nos;
    if (this.race && this.race.type === 'drag') {
      inp.steer = 0; inp.handbrake = false; inp.brake = 0;
      inp.throttle = this.race.state === 'running' ? 1 : (k.has('KeyW') || k.has('ArrowUp') ? 0.6 : 0);
    }
  }
  toggleSB() {
    if (this.sbActive) { this.sbActive = false; return; }
    if (this.race) { this.hud.toast('SPEEDBREAKER: FREE ROAM ONLY'); return; }
    if (this.sbMeter > 0.15) { this.sbActive = true; this.audio.whoosh(); }
  }
  resetCar() {
    const p = this.player;
    const id = this.world.nearestNode(p.pos.x, p.pos.z), np = nodePos(id);
    const ax = Math.abs(Math.sin(p.heading)) > Math.abs(Math.cos(p.heading));
    const h = ax ? (Math.sin(p.heading) > 0 ? Math.PI / 2 : -Math.PI / 2) : (Math.cos(p.heading) > 0 ? 0 : Math.PI);
    p.place(np.x, np.z, h);
  }
  togglePause() {
    this.paused = !this.paused;
    const el = $('pause');
    el.classList.toggle('show', this.paused);
    if (this.paused) {
      el.innerHTML = `<h1>PAUSED</h1><button data-act="resume">RESUME</button>` +
        (this.race ? `<button data-act="restart">RESTART EVENT</button><button data-act="quit">QUIT EVENT</button>` :
          `<button data-act="safehouse" class="${this.police.active ? 'disabled' : ''}">SAFEHOUSE${this.police.active ? ' (IN PURSUIT)' : ''}</button>`) +
        `<p>WASD/Arrows drive · Space handbrake · Shift nitrous · E speedbreaker · C camera · R reset</p>`;
    }
  }
  interact() {
    if (this.mode !== 'roam' || this.police.active) return;
    const p = this.player;
    if (Math.hypot(p.pos.x - this.safehouse.x, p.pos.z - this.safehouse.z) < 12) return this.toMenu();
    for (const m of this.markers) if (Math.hypot(p.pos.x - m.x, p.pos.z - m.z) < 14) return this.startRace(m.ev);
  }

  // ---------- modes ----------
  showTitle() {
    $('title').classList.add('show');
    $('title').innerHTML = `<div class="t-wrap"><div class="t-logo">HEAT<span>RUN</span></div><div class="t-sub">PORT CALDER · THE FIFTEEN</div>
      <p class="t-story">Port Calder's street scene answers to one list: <b>The Fifteen</b>. Nobody gets on it by asking.
      You climb it by winning races, by outrunning the Calder PD, and by making sure every cop in the city knows your plate.</p>
      <button class="big" id="t-go">${this.hasSave ? 'CONTINUE CAREER' : 'START CAREER'}</button>
      <div class="t-hint">Press ENTER · Headphones recommended</div></div>`;
    $('t-go').onclick = () => this.titleContinue();
    this.hud.setVisible(false);
  }
  titleContinue() {
    this.audio.init();
    $('title').classList.remove('show');
    this.toMenu();
  }
  toMenu() {
    this.endRace();
    this.clearMarkers();
    if (this.police.active) this.police.endPursuit('quit');
    this.police.reset();
    this.mode = 'menu'; this.sbActive = false;
    this.hud.setVisible(false);
    this.makePlayer();
    this.player.place(this.safehouse.x, this.safehouse.z, Math.PI / 2);
    this.player.flat = false;
    this.menu.open();
    this.persist();
  }
  startRoam() {
    this.mode = 'roam';
    this.skids.clear();
    this.makePlayer();
    this.player.place(this.safehouse.x + 24, this.safehouse.z + 2.75, Math.PI / 2);
    this.player.nitro = 1;
    this.traffic.enabled = true; this.traffic.max = 34;
    this.camHeading = this.player.heading;
    this.hud.setVisible(true);
    this.buildMarkers();
    this.lastDistrict = null;
    this.hud.banner('FREE ROAM', 1400);
  }
  buildMarkers() {
    this.clearMarkers();
    const idx = Math.min(this.save.rivalIdx, 14);
    for (const ev of RIVAL_EVENTS[idx]) {
      if (this.save.won.includes(ev.id) && this.save.rivalIdx < 15) continue;
      const r = { start: raceStart(ev) };
      const col = { circuit: '#ffb030', sprint: '#ffd060', knockout: '#ff7030', tollbooth: '#40d0ff', speedtrap: '#60a0ff', drag: '#ff4060' }[ev.type];
      const m = { x: r.start.x, z: r.start.z, ev, color: col };
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 60, 20, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      beam.position.set(m.x, 30, m.z);
      this.scene.add(beam); this.markerMeshes.push(beam);
      this.markers.push(m);
    }
  }
  clearMarkers() { for (const m of this.markerMeshes) this.scene.remove(m); this.markerMeshes = []; this.markers = []; }

  startRace(ev, duel = null) {
    this.endRace();
    this.clearMarkers();
    if (this.police.active) this.police.endPursuit('quit');
    this.police.reset();
    this.duel = duel;
    this.mode = 'race'; this.sbActive = false;
    this.skids.clear();
    this.makePlayer();
    this.player.nitro = 1; this.player.flat = false; this.player.blown = false;
    this.player.manual = ev.type === 'drag'; this.player.gear = 0;
    this.traffic.clear();
    this.traffic.enabled = ev.type !== 'drag'; this.traffic.max = 22;
    this.race = new Race(this, ev);
    this.race.spawnField(this.player);
    this.camHeading = this.player.heading;
    for (let k = 0; k < 8; k++) this.traffic.manage(this.player.pos.x, this.player.pos.z, 0);
    // keep traffic off the start grid
    for (const t of [...this.traffic.cars]) if (Math.hypot(t.pos.x - this.player.pos.x, t.pos.z - this.player.pos.z) < 70) { this.scene.remove(t.mesh); this.traffic.cars.splice(this.traffic.cars.indexOf(t), 1); }
    this.hud.setVisible(true);
    const title = duel !== null && duel !== undefined ? `${RIVALS[ev.rival].tag} · RACE ${duel.k + 1}/${DUELS[ev.rival].length}` : TYPE_NAMES[ev.type];
    this.hud.banner(title, 2200);
  }
  startDuel(idx) { this.startRace(DUELS[idx][0], { idx, k: 0 }); }
  endRace() {
    if (this.race) { this.race.dispose(); this.race = null; }
    if (this.player) { this.player.manual = false; this.player.hold = false; }
  }

  onRaceEnd(res) {
    const r = this.race, ev = r.ev, s = this.save;
    this.mode = 'post';
    let reward = '', buttons = '';
    if (this.duel) {
      const d = this.duel, rv = RIVALS[d.idx];
      if (res.won && d.k + 1 < DUELS[d.idx].length) {
        reward = `Race ${d.k + 1} of ${DUELS[d.idx].length} won. ${rv.tag} wants a rematch.`;
        buttons = `<button class="big" data-act="nextduel">NEXT RACE ▸</button>`;
      } else if (res.won) {
        this.defeatRival(d.idx);
        reward = `You beat ${rv.tag}. Rank #${rv.rank} is yours.`;
        buttons = `<button class="big" data-act="markers">CLAIM MARKERS ▸</button>`;
      } else {
        reward = `${rv.tag} keeps the spot. Run it back.`;
        buttons = `<button class="big" data-act="retryduel">RETRY CHALLENGE</button><button data-act="menu">SAFEHOUSE</button>`;
      }
    } else {
      if (res.won) {
        const first = !s.won.includes(ev.id);
        const cash = first ? ev.cash : Math.round(ev.cash * 0.4);
        const bounty = first ? ev.bounty : 0;
        s.cash += cash; s.bounty += bounty; s.stats.racesWon++;
        if (first) s.won.push(ev.id);
        reward = `+${fmtMoney(cash)}${bounty ? ` · +${bounty.toLocaleString('en-US')} bounty` : ' (replay)'}`;
      } else reward = 'No payout.';
      buttons = `<button class="big" data-act="menu">SAFEHOUSE ▸</button><button data-act="retry">RETRY</button><button data-act="roam">FREE ROAM</button>`;
    }
    const rows = r.type === 'speedtrap' && r.trapTotals
      ? r.trapTotals.map((t, k) => `<tr class="${t.r.isPlayer ? 'me' : ''}"><td>${k + 1}</td><td>${t.r.name}</td><td>${this.fmtSpeed(t.total)}</td></tr>`).join('')
      : r.standings().map((x, k) => `<tr class="${x.isPlayer ? 'me' : ''}"><td>${x.out ? 'OUT' : k + 1}</td><td>${x.name}</td><td>${x.done ? fmtTime(x.finishT) : x.out ? '—' : res.won || x.isPlayer ? 'DNF' : 'RACING'}</td></tr>`).join('');
    this.persist();
    this.showPost(`<h1 class="${res.won ? 'win' : 'lose'}">${res.label}</h1><div class="sub">${ev.name.toUpperCase()} · ${TYPE_NAMES[ev.type]} · ${fmtTime(res.time)}</div>
      <table class="standings">${rows}</table><p class="reward">${reward}</p><div class="btns">${buttons}</div>`, (a) => {
      if (a === 'menu') { this.duel = null; this.toMenu(); }
      else if (a === 'retry') this.startRace(ev);
      else if (a === 'roam') { this.endRace(); this.startRoam(); }
      else if (a === 'nextduel') { const d = { ...this.duel, k: this.duel.k + 1 }; this.startRace(DUELS[d.idx][d.k], d); }
      else if (a === 'retryduel') this.startDuel(this.duel.idx);
      else if (a === 'markers') {
        const idx = this.duel.idx;
        this.endRace();
        showMarkers(this, idx, () => { this.duel = null; this.toMenu(); });
      }
    });
  }
  defeatRival(idx) {
    const s = this.save;
    if (s.defeated.includes(idx)) return;
    s.defeated.push(idx); s.rivalIdx = Math.max(s.rivalIdx, idx + 1);
    const u = UNLOCK_AFTER[idx];
    if (u && !s.unlocked.includes(u)) s.unlocked.push(u);
    s.cash += 5000 + idx * 2500;
    this.persist();
  }

  onBusted() {
    const p = this.police.endPursuit('busted');
    const s = this.save, g = this.carEntry();
    this.mode = 'post'; this.sbActive = false;
    s.stats.busted++;
    const fine = 1500 * p.heat;
    let txt = `Fine: ${fmtMoney(fine)}. Lost pursuit bounty: ${p.bounty.toLocaleString('en-US')}.`;
    s.cash = Math.max(0, s.cash - fine);
    if (s.jailFree > 0) { s.jailFree--; txt += ' Get-out-of-jail card used: no impound strike.'; }
    else {
      g.strikes++;
      txt += ` Impound strike ${g.strikes}/3.`;
      if (g.strikes >= 3) {
        txt += ` <b>${CARS[g.id].name} has been IMPOUNDED.</b>`;
        s.garage.splice(s.current, 1);
        s.current = 0;
        if (!s.garage.length) { s.garage.push({ id: 'hachi', up: {}, color: 0x7a6a55, heat: 1, strikes: 0 }); txt += ' A friend lends you an old Hachi.'; }
      }
    }
    if (s.garage[s.current] === g) g.heat = 1;
    this.persist();
    this.showPost(`<h1 class="lose">BUSTED</h1><div class="sub">PURSUIT TIME ${fmtTime(p.t).slice(0, -3)} · HEAT ${p.heat}</div><p class="reward">${txt}</p><div class="btns"><button class="big" data-act="menu">SAFEHOUSE ▸</button></div>`,
      () => this.toMenu());
  }
  onEvaded() {
    const p = this.police.endPursuit('evaded');
    const s = this.save, g = this.carEntry();
    const bonus = 1000 * p.heat;
    const total = p.bounty + bonus;
    s.bounty += total; s.stats.evaded++; s.stats.immob += p.immob;
    s.stats.longest = Math.max(s.stats.longest, p.t);
    g.heat = Math.max(g.heat, p.heat);
    // milestones for the current rival (and any earlier ones still open)
    const stats = { length: p.t, immob: p.immob, roadblocks: p.roadblocks, spikes: p.spikes, cost: p.cost, infractions: p.infractions.size, bounty: p.bounty, breakers: p.breakers };
    const got = [];
    for (let i = 0; i <= Math.min(14, s.rivalIdx); i++) for (const m of RIVAL_MILESTONES[i]) {
      if (!s.milestones.includes(m.id) && stats[m.type] >= m.target) { s.milestones.push(m.id); got.push(`${MS_TYPES[m.type].label} ${MS_TYPES[m.type].fmt(m.target)}`); }
    }
    this.player.flat = false;
    this.persist();
    this.hud.banner('EVADED', 2000);
    this.audio.checkpoint();
    const row = (a, b) => `<tr><td>${a}</td><td>${b}</td></tr>`;
    this.mode = 'post';
    this.showPost(`<h1 class="win">EVADED</h1><div class="sub">HEAT ${p.heat} · BOUNTY +${total.toLocaleString('en-US')}</div>
      <table class="standings">${row('Pursuit length', fmtTime(p.t).slice(0, -3))}${row('Units involved', p.involved)}${row('Units immobilized', p.immob)}${row('Roadblocks evaded', p.roadblocks)}${row('Spike strips evaded', p.spikes)}${row('Pursuit breakers', p.breakers)}${row('Helicopters', p.helis)}${row('Infractions', p.infractions.size)}${row('Cost to state', fmtMoney(p.cost))}${row('Evade bonus', bonus.toLocaleString('en-US'))}</table>
      ${got.length ? `<p class="reward">MILESTONES COMPLETE: ${got.join(' · ')}</p>` : ''}
      <div class="btns"><button class="big" data-act="roam">CONTINUE ▸</button><button data-act="menu">SAFEHOUSE</button></div>`,
      (a) => { if (a === 'menu') this.toMenu(); else { this.mode = 'roam'; this.buildMarkers(); } });
  }
  showPost(html, cb) {
    const el = $('post');
    el.innerHTML = `<div class="post-box">${html}</div>`;
    el.classList.add('show');
    el.onclick = (e) => {
      const a = e.target.dataset.act; if (!a) return;
      this.audio.ui();
      el.classList.remove('show');
      cb(a);
    };
  }
  radio(text) {
    this.hud.radio(text);
    this.audio.radio();
    if (this.save.settings.radio && window.speechSynthesis) {
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.2; u.pitch = 0.75; u.volume = Math.min(1, this.save.settings.volume * 0.9);
        speechSynthesis.speak(u);
      } catch (e) { /* speech unavailable */ }
    }
  }

  // ---------- simulation ----------
  step(dt) {
    const p = this.player, pol = this.police, race = this.race;
    this.readInput();
    if (race && race.state === 'countdown') { p.input.nitro = false; p.input.throttle = this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0; }
    if (race && race.state === 'done') { p.input.throttle = 0; p.input.brake = p.vLong > 0.6 ? 0.5 : 0; p.input.nitro = false; }
    // speedbreaker meter
    if (this.sbActive) { this.sbMeter -= dt * 0.25; if (this.sbMeter <= 0) { this.sbMeter = 0; this.sbActive = false; } }
    else {
      if (p.slip > 4 && p.speed > 12) this.sbMeter += dt * 0.05;
      if (p.speed > 45) this.sbMeter += dt * 0.012;
      this.sbMeter = Math.min(1, this.sbMeter);
    }
    const wdt = dt * (this.sbActive ? 0.35 : 1);
    const pdt = dt * (this.sbActive ? 0.55 : 1);
    p.massMul = this.sbActive ? 3 : 1;
    p.update(pdt);
    const others = [p, ...pol.units, ...(race ? race.colliders() : [])];
    this.traffic.update(wdt, p, others);
    const ctx = { allowPatrols: this.mode === 'roam', onBusted: () => this.onBusted(), onEvaded: () => this.onEvaded() };
    if (this.mode === 'roam') pol.update(wdt, p, ctx);
    if (this.mode !== 'roam' && this.mode !== 'race') return;
    if (race) {
      race.update(wdt);
      for (const v of race.colliders()) if (v.kind === 'racer') v.update(wdt);
    }
    this.world.updateBreakers(wdt);
    for (const pb of this.pendingBreakers) pb.t -= wdt;
    while (this.pendingBreakers.length && this.pendingBreakers[0].t <= 0) pol.breaker(this.pendingBreakers.shift().b);
    this.collide(wdt);
    this.gameplayEvents(wdt);
  }

  collide(dt) {
    const p = this.player, pol = this.police, race = this.race;
    const events = { hitTraffic: false, hitCop: null };
    const dyn = [p, ...pol.units, ...(race ? race.colliders() : []), ...this.traffic.cars];
    for (const v of dyn) {
      v.massMul = v === p ? p.massMul : v.kind === 'traffic' && !v.free ? 2 : v.massMul || 1;
      if (v.kind === 'traffic' && !v.free) continue;
      const imp = collideStatic(v, this.world, BOUND);
      if (imp <= 0) continue;
      if (v === p) {
        if (imp > 4) { this.audio.impact(imp); this.shake = Math.min(1, this.shake + imp * 0.03); }
        if (imp > 7) this.sparks(p.pos.x + Math.sin(p.heading) * 2, p.pos.z + Math.cos(p.heading) * 2, imp);
        if (imp > 10 && pol.active && pol.p.seen) { pol.addInfraction('property'); pol.addCost(800); }
      } else if (v.kind === 'cop' && imp > 13) pol.damage(v, (imp - 11) * 0.05, false);
    }
    for (let i = 0; i < dyn.length; i++) {
      const a = dyn[i];
      for (let j = i + 1; j < dyn.length; j++) {
        const b = dyn[j];
        if (a.kind === 'traffic' && b.kind === 'traffic' && !a.free && !b.free) continue;
        const imp = collidePair(a, b);
        if (imp <= 0) continue;
        this.onPair(a, b, imp, events);
        this.onPair(b, a, imp, events);
      }
    }
    this.events = events;
  }
  onPair(a, b, imp, ev) {
    const p = this.player, pol = this.police;
    if (b.kind === 'traffic') {
      if (imp > 2.5 && !b.free) { b.free = true; b.deadT = 0; }
      b.hitT = this.time;
      if (a === p && imp > 4) {
        ev.hitTraffic = true;
        if (pol.active) { pol.addCost(1500); if (pol.p.seen) pol.addInfraction('hitrun'); }
        if (this.race && this.race.type === 'drag' && imp > 6) this.race.finish(false, 'TOTALED');
      }
    }
    if (a === p) {
      if (imp > 3) { this.audio.impact(imp); this.shake = Math.min(1, this.shake + imp * 0.04); }
      if (imp > 6) this.sparks((p.pos.x + b.pos.x) / 2, (p.pos.z + b.pos.z) / 2, imp);
      if (b.kind === 'cop') {
        ev.hitCop = b;
        const ratio = Math.min(2, (p.mass * p.massMul) / b.mass);
        const share = clamp((p.speed / (p.speed + b.speed + 1)) * 2, 0.25, 1); // a cop plowing into you hurts itself less
        pol.damage(b, Math.max(0, imp - 6) * 0.05 * ratio * share, true);
        if (!pol.active && this.mode === 'roam' && imp > 2) pol.startPursuit(p, this.carEntry().heat, 'ramming');
      }
    } else if (a.kind === 'cop' && b.kind !== 'player') {
      if (imp > 9) pol.damage(a, (imp - 8) * 0.03, false);
    }
  }

  gameplayEvents(dt) {
    const p = this.player, pol = this.police;
    this.time += dt;
    // patrols witnessing infractions
    if (this.mode === 'roam' && !pol.active) {
      const inf = pol.watch(p, this.events || {});
      if (inf) pol.startPursuit(p, this.carEntry().heat, inf);
    }
    if (pol.active && pol.p && pol.p.seen && pol.state === 'pursuit') {
      if (p.speed > 31) pol.addInfraction('speeding');
      if (p.slip > 6) pol.addInfraction('reckless');
      if (p.speed > 8 && !this.world.onRoad(p.pos.x, p.pos.z)) pol.addInfraction('offroad');
    }
    // pursuit breakers
    if (pol.active) for (const b of this.world.breakers) {
      if (b.state === 'ready' && p.speed > 10 && Math.hypot(p.pos.x - b.tx, p.pos.z - b.tz) < 9) {
        this.world.triggerBreaker(b);
        this.pendingBreakers.push({ b, t: 1.2 });
        this.audio.crash(); this.shake = 1;
        this.sbMeter = Math.min(1, this.sbMeter + 0.2);
      }
    }
    // near misses fill the speedbreaker
    if (p.speed > 25) for (const t of this.traffic.cars) {
      const d = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
      if (d > 12) { t.nm = false; continue; }
      if (!t.nm && d < 4.4 && !t.free && (t.hitT === undefined || this.time - t.hitT > 1)) { t.nm = true; t.nmT = this.time + 0.25; }
      if (t.nmT && this.time >= t.nmT) {
        // only counts if we didn't touch it in the meantime
        if (t.hitT === undefined || t.hitT < t.nmT - 0.5) { this.sbMeter = Math.min(1, this.sbMeter + 0.1); this.hud.toast('NEAR MISS'); }
        t.nmT = 0;
      }
    }
    // district callouts
    const dname = districtOf(p.pos.x, p.pos.z);
    if (dname !== this.lastDistrict) { this.lastDistrict = dname; if (this.mode === 'roam') this.hud.district(DISTRICT_NAMES[dname]); }
    // prompts
    this.prompt = '';
    if (this.mode === 'roam' && !pol.active && p.speed < 12) {
      if (Math.hypot(p.pos.x - this.safehouse.x, p.pos.z - this.safehouse.z) < 12) this.prompt = 'ENTER — SAFEHOUSE';
      for (const m of this.markers) if (Math.hypot(p.pos.x - m.x, p.pos.z - m.z) < 14) this.prompt = `ENTER — ${TYPE_NAMES[m.ev.type]}: ${m.ev.name.toUpperCase()}`;
    }
    this.traffic.manage(p.pos.x, p.pos.z, p.speed);
  }

  // ---------- frame ----------
  frame() {
    const now = performance.now();
    let dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const playing = (this.mode === 'roam' || this.mode === 'race') && !this.paused;
    if (playing) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n++ < 6) { this.step(STEP); this.acc -= STEP; }
      if (this.acc > STEP) this.acc = 0;
    }
    const alpha = playing ? this.acc / STEP : 1;
    const simDt = playing ? dt * (this.sbActive ? 0.35 : 1) : dt;
    this.renderTime = (this.renderTime || 0) + simDt;
    // visuals
    const p = this.player;
    p.sync(alpha);
    const ud = p.mesh.userData;
    ud.flames.visible = p.nitroOn;
    if (p.nitroOn) for (const f of ud.flames.children) f.scale.set(1, 0.7 + Math.random() * 0.6, 1);
    ud.setBrake(p.input.brake > 0 && p.vLong > 0.5);
    this.traffic.sync(alpha);
    this.police.sync(this.renderTime, alpha);
    if (this.race) this.race.sync(this.renderTime, alpha);
    if (playing) this.emitParticles(simDt);
    this.particles.update(simDt);
    this.updateCamera(dt);
    this.env.follow(this.camera.position, now / 1000);
    this.world.updateWater(now / 1000);
    this.safehouseMesh.visible = this.mode === 'roam' && !this.police.active;
    for (const m of this.markerMeshes) m.visible = !this.police.active;
    // post uniforms
    const g = this.post.grade.uniforms;
    this.flash = Math.max(0, this.flash - dt * 2.2);
    g.uSpeed.value = playing ? clamp((p.speed - 20) / 60, 0, 1) * (p.nitroOn ? 1.6 : 1) : 0;
    g.uSB.value = smooth(g.uSB.value, this.sbActive ? 1 : 0, 8, dt);
    g.uFlash.value = this.flash * 0.35;
    g.uBust.value = this.police.p ? this.police.p.bust * (0.5 + 0.5 * Math.sin(now / 90)) : 0;
    g.uTime.value = now / 1000 % 100;
    // audio
    const pol = this.police;
    let nearest = 1e9;
    for (const u of pol.units) if (!u.wrecked && u.mode !== 'patrol' && u.mode !== 'leave') nearest = Math.min(nearest, Math.hypot(u.pos.x - p.pos.x, u.pos.z - p.pos.z));
    const heliD = pol.heli ? Math.hypot(pol.heli.x - p.pos.x, pol.heli.z - p.pos.z) : 1e9;
    const musicMode = this.mode === 'menu' || this.mode === 'title' ? 'menu' : pol.active ? 'pursuit' : this.race ? 'race' : 'roam';
    this.audio.update(p, { active: playing, siren: pol.active ? clamp(1 - nearest / 220, 0, 1) * 0.07 : 0, heli: clamp(1 - heliD / 300, 0, 1) * 0.5, music: musicMode });
    if (this.mode === 'roam' || this.mode === 'race') this.hud.update(dt);
    this.post.composer.render(dt);
  }

  emitParticles(dt) {
    const p = this.player;
    const skid = (v, id) => {
      const sliding = (v.slip > 3.2 && v.speed > 6) || (v.input.brake > 0.5 && v.vLong > 12 && v.kind === 'player') || (v.input.handbrake && v.speed > 6);
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      for (const sx of [-0.78, 0.78]) {
        const x = v.mesh.position.x - fx * 1.3 - fz * sx, z = v.mesh.position.z - fz * 1.3 + fx * sx;
        this.skids.mark(id + sx, x, v.mesh.position.y, z, sliding);
      }
    };
    skid(p, 'p');
    if (this.race) this.race.colliders().forEach((v, k) => { if (v.kind === 'racer') skid(v, 'r' + k); });
    for (const u of this.police.units) skid(u, 'c' + u.id);
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading), rx = -fz, rz = fx;
    const smokeOf = (v, intensity) => {
      for (const s of [-0.8, 0.8]) if (Math.random() < intensity) {
        const x = v.pos.x - Math.sin(v.heading) * 1.4 + -Math.cos(v.heading) * s, z = v.pos.z - Math.cos(v.heading) * 1.4 + Math.sin(v.heading) * s;
        this.particles.emit(x, 0.35, z, (Math.random() - 0.5) * 2, 0.6 + Math.random(), (Math.random() - 0.5) * 2, 1.4, 1.4, [0.82, 0.78, 0.72], 3);
      }
    };
    if ((p.slip > 4.5 && p.speed > 6) || (p.input.throttle > 0 && p.speed < 6 && p.input.handbrake)) smokeOf(p, Math.min(1, (p.slip - 3) * 0.15 + 0.3));
    if (p.flat && p.speed > 5 && Math.random() < 0.5) this.particles.emit(p.pos.x - fx * 1.4, 0.2, p.pos.z - fz * 1.4, 0, 0.3, 0, 0.25, 0.5, [1, 0.8, 0.3], 0);
    for (const v of this.race ? this.race.colliders() : []) if (v.kind === 'racer' && v.slip > 5 && v.speed > 8) smokeOf(v, 0.4);
    for (const u of this.police.units) if (u.wrecked && Math.random() < dt * 14) this.particles.emit(u.pos.x, 1.2, u.pos.z, (Math.random() - 0.5), 2.5, (Math.random() - 0.5), 3, 2.2, [0.25, 0.23, 0.22], 2.5);
  }

  sparks(x, z, imp) {
    const n = Math.min(24, 4 + imp);
    for (let k = 0; k < n; k++) this.particles.emit(x, 0.6, z, (Math.random() - 0.5) * 14, 2 + Math.random() * 5, (Math.random() - 0.5) * 14, 0.35 + Math.random() * 0.3, 0.22, [1.6, 1.0, 0.4], -0.6);
  }

  updateCamera(dt) {
    const cam = this.camera, p = this.player;
    if (this.mode === 'menu' || this.mode === 'title') {
      // slow showroom orbit
      const t = performance.now() / 1000 * (this.mode === 'title' ? 0.05 : 0.18);
      const R = this.mode === 'title' ? 420 : 8.5, H = this.mode === 'title' ? 160 : 2.6;
      const c = this.mode === 'title' ? { x: 0, z: 0 } : p.pos;
      cam.position.set(c.x + Math.cos(t) * R, H, c.z + Math.sin(t) * R);
      cam.lookAt(c.x, this.mode === 'title' ? 20 : 0.7, c.z);
      cam.fov = 50; cam.updateProjectionMatrix();
      return;
    }
    if (this.mode === 'post') {
      const t = performance.now() / 1000 * 0.25;
      cam.position.set(p.pos.x + Math.cos(t) * 9, 3.2, p.pos.z + Math.sin(t) * 9);
      cam.lookAt(p.pos.x, 0.8, p.pos.z);
      return;
    }
    // blend car heading with direction of travel so slides show the car's angle
    const travel = p.speed > 4 ? Math.atan2(p.vx, p.vz) : p.heading;
    const want = p.vLong < -2 ? p.heading : travel + wrapAngle(p.heading - travel) * 0.55;
    this.camHeading += wrapAngle(want - this.camHeading) * (1 - Math.exp(-6 * dt));
    const fx = Math.sin(this.camHeading), fz = Math.cos(this.camHeading);
    const top = p.spec.top || 60;
    const sp = clamp(p.speed / top, 0, 1.2);
    const cx = p.mesh.position.x, cz = p.mesh.position.z, ch = p.mesh.rotation.y;
    const look = _look;
    if (this.camMode === 2) {
      cam.position.set(cx + Math.sin(ch) * 0.4, 1.15, cz + Math.cos(ch) * 0.4);
      look.set(cx + Math.sin(ch) * 20, 1.0, cz + Math.cos(ch) * 20);
    } else {
      const dist = (this.camMode === 1 ? 9.5 : 6.2) + sp * 0.8, h = this.camMode === 1 ? 3.4 : 2.0;
      cam.position.lerp(_pos.set(cx - fx * dist, h, cz - fz * dist), 1 - Math.exp(-14 * dt));
      look.set(cx + fx * 4, 1.0, cz + fz * 4);
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sh = this.shake * 0.25 + (p.speed > 50 ? (p.speed - 50) * 0.0012 : 0) + (p.nitroOn ? 0.02 : 0);
    cam.position.x += (Math.random() - 0.5) * sh; cam.position.y += (Math.random() - 0.5) * sh;
    cam.lookAt(look);
    cam.rotateZ(-p.yawRate * 0.02);
    const fov = 62 + 18 * Math.min(1, sp) + (p.nitroOn ? 7 : 0) - (this.sbActive ? 6 : 0);
    cam.fov = smooth(cam.fov, fov, 4, dt);
    cam.updateProjectionMatrix();
  }
}

window.game = new Game();
