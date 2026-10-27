// Cars, rivals ("The Fifteen"), events, milestones, upgrades and the save file.
import { rng, pick } from './util.js';
import { N, nodeId } from './world.js';

// Fictional cars. top in m/s, accel in m/s^2.
export const CARS = {
  hachi:     { name: 'Ronin Hachi',       style: 'hatch',  tier: 1, price: 0,      top: 54, accel: 8.0,  grip: 8.5,  steer: 1.05, brake: 22, mass: 1150, color: 0xc8c2b4 },
  strade:    { name: 'Strade Corsa 3',    style: 'coupe',  tier: 1, price: 16000,  top: 58, accel: 8.6,  grip: 8.8,  steer: 1.0,  brake: 23, mass: 1250, color: 0x2a5aa8 },
  bullet:    { name: 'Kessler Bullet V8', style: 'muscle', tier: 2, price: 38000,  top: 65, accel: 10.4, grip: 7.8,  steer: 0.95, brake: 23, mass: 1600, color: 0xd8a020 },
  volta:     { name: 'Volta GT-X',        style: 'coupe',  tier: 2, price: 52000,  top: 66, accel: 10.0, grip: 9.4,  steer: 1.0,  brake: 25, mass: 1380, color: 0x1f6b48 },
  raijin:    { name: 'Ronin Raijin',      style: 'coupe',  tier: 2, price: 68000,  top: 69, accel: 10.6, grip: 9.8,  steer: 1.02, brake: 26, mass: 1350, color: 0xe8e8e8 },
  phantom:   { name: 'Arrow Phantom S',   style: 'super',  tier: 3, price: 115000, top: 76, accel: 11.8, grip: 10.2, steer: 1.0,  brake: 28, mass: 1420, color: 0x202226 },
  hellcrest: { name: 'Kessler Hellcrest', style: 'muscle', tier: 3, price: 135000, top: 79, accel: 12.8, grip: 8.8,  steer: 0.95, brake: 27, mass: 1650, color: 0x8a1010 },
  sette:     { name: 'Volta Sette',       style: 'super',  tier: 3, price: 210000, top: 83, accel: 12.4, grip: 10.8, steer: 1.02, brake: 30, mass: 1400, color: 0xe06a10 },
  zero:      { name: 'Corsair Zero',      style: 'super',  tier: 4, price: 380000, top: 90, accel: 13.8, grip: 11.2, steer: 1.04, brake: 32, mass: 1380, color: 0x6a6f78 },
};

export const UPGRADES = {
  engine:  { name: 'Engine',       desc: '+top speed, +acceleration' },
  trans:   { name: 'Transmission', desc: '+acceleration' },
  turbo:   { name: 'Turbo',        desc: '+acceleration at high RPM' },
  susp:    { name: 'Suspension',   desc: '+handling' },
  tires:   { name: 'Tires',        desc: '+grip' },
  brakes:  { name: 'Brakes',       desc: '+braking' },
  nitrous: { name: 'Nitrous',      desc: '+boost duration and power' },
};
export const STAGE_COST = [2000, 8000, 25000];
export const upgradeCost = (carId, stage) => STAGE_COST[stage] * Math.min(3, CARS[carId].tier);

// Final driving spec for a garage entry.
export function carSpec(entry) {
  const c = CARS[entry.id], u = entry.up || {};
  const st = (k) => u[k] || 0;
  return {
    top: c.top * (1 + 0.035 * st('engine') + 0.01 * st('trans') + 0.015 * st('turbo')),
    accel: c.accel * (1 + 0.07 * st('engine') + 0.05 * st('trans') + 0.06 * st('turbo')),
    grip: c.grip * (1 + 0.05 * st('susp') + 0.06 * st('tires')),
    steer: c.steer * (1 + 0.03 * st('susp')),
    brake: c.brake * (1 + 0.12 * st('brakes')),
    mass: c.mass,
    nitro: 7 * (1 + 0.1 * st('nitrous')),
    nitroDur: 4 * (1 + 0.2 * st('nitrous')),
    nitroFill: 0.04,
  };
}
export const perfRating = (spec) => Math.round((spec.top * 1.6 + spec.accel * 6 + spec.grip * 4) - 100);

// ---------- The Fifteen ----------
const R = (rank, name, tag, car, color, stripe, bounty, ms) => ({ rank, name, tag, car, color, stripe, bounty, ms });
export const RIVALS = [
  R(15, 'Benny Okafor',     'SPARKPLUG',  'hachi',     0x3fa34d, 0xf0f0f0, 5000,   1),
  R(14, 'Lu Mei',           'KITE',       'strade',    0xd04a7a, null,     15000,  2),
  R(13, 'Dmitri Vasko',     'DOZER',      'strade',    0x5a5a5a, 0xe0b020, 30000,  2),
  R(12, 'Jo "Flint" Harlow','FLINT',      'bullet',    0xa03a1a, 0x101010, 50000,  2),
  R(11, 'Ana Quintero',     'LA REINA',   'volta',     0x6a2a90, 0xd8c060, 75000,  2),
  R(10, 'Marcus Teague',    'DEADBOLT',   'bullet',    0x102040, 0xf0f0f0, 105000, 3),
  R(9,  'Priya Rao',        'MONSOON',    'raijin',    0x1a8aa0, null,     140000, 3),
  R(8,  'Theo Lindqvist',   'GLACIER',    'raijin',    0xe8f0f8, 0x3060c0, 180000, 3),
  R(7,  'Rico Fontaine',    'VELVET',     'phantom',   0x701030, 0x101010, 230000, 3),
  R(6,  'Sasha Ivey',       'WIRETAP',    'phantom',   0x30e080, 0x101010, 290000, 3),
  R(5,  'Cole Brannigan',   'BRANDO',     'hellcrest', 0xe0e0d0, 0xc01010, 360000, 3),
  R(4,  'Yuki Hanamura',    'SAKURA-9',   'sette',     0xf0a0c0, 0x202020, 440000, 4),
  R(3,  'Victor Crane',     'THE BARON',  'hellcrest', 0x101010, 0xd0a020, 530000, 4),
  R(2,  'Nadia Kross',      'HALO',       'sette',     0xf2f2f2, 0xd0a030, 640000, 4),
  R(1,  'Silas Wren',       'WREN',       'zero',      0x1a1c20, 0x40c0ff, 800000, 4),
];
export const duelRaces = (rank) => (rank >= 6 ? 2 : rank >= 2 ? 3 : 5);
// Car unlocked for purchase after defeating each rival index.
export const UNLOCK_AFTER = { 0: 'strade', 2: 'bullet', 3: 'volta', 5: 'raijin', 7: 'phantom', 9: 'hellcrest', 11: 'sette', 14: 'zero' };

// ---------- Milestones ----------
export const MS_TYPES = {
  length:     { label: 'Pursuit length',      fmt: (v) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}` },
  immob:      { label: 'Cops immobilized',    fmt: (v) => v },
  roadblocks: { label: 'Roadblocks evaded',   fmt: (v) => v },
  spikes:     { label: 'Spike strips evaded', fmt: (v) => v },
  cost:       { label: 'Cost to state',       fmt: (v) => '$' + v.toLocaleString('en-US') },
  infractions:{ label: 'Infractions',         fmt: (v) => v },
  bounty:     { label: 'Pursuit bounty',      fmt: (v) => v.toLocaleString('en-US') },
  breakers:   { label: 'Pursuit breakers',    fmt: (v) => v },
};
function milestonesFor(idx, count) {
  const r = rng(900 + idx);
  const lvl = idx / 14;
  const pool = [
    ['length', Math.round(60 + lvl * 300)],
    ['immob', Math.round(2 + lvl * 14)],
    ['infractions', Math.min(7, 2 + Math.floor(lvl * 5))],
    ['cost', Math.round((20000 + lvl * 280000) / 1000) * 1000],
    ['bounty', Math.round((3000 + lvl * 60000) / 500) * 500],
  ];
  if (idx >= 3) pool.push(['roadblocks', Math.round(1 + lvl * 6)]);
  if (idx >= 6) pool.push(['spikes', Math.round(1 + lvl * 4)]);
  if (idx >= 2) pool.push(['breakers', Math.round(1 + lvl * 3)]);
  const out = [];
  while (out.length < count && pool.length) {
    const k = Math.floor(r() * pool.length);
    const [type, target] = pool.splice(k, 1)[0];
    out.push({ id: `m${idx}_${type}`, type, target });
  }
  return out;
}

// ---------- Event / route generation ----------
const TYPE_CYCLE = ['circuit', 'sprint', 'tollbooth', 'speedtrap', 'knockout', 'drag', 'sprint', 'circuit'];
export const TYPE_NAMES = { circuit: 'CIRCUIT', sprint: 'SPRINT', knockout: 'LAP KNOCKOUT', tollbooth: 'TOLLBOOTH', speedtrap: 'SPEEDTRAP', drag: 'DRAG' };
const PLACE = ['Dockside', 'Rivet', 'Kingsbridge', 'Harlow', 'Mercer', 'Gantry', 'Ashby', 'Union', 'Lantern', 'Copper', 'Saltmarsh', 'Ferris', 'Juniper', 'Bramble', 'Ironhook', 'Calder', 'Westgate', 'Orchard', 'Founders', 'Tannery'];
const SUFFIX = ['Run', 'Loop', 'Line', 'Dash', 'Grind', 'Mile', 'Cut', 'Circuit', 'Way', 'Rush'];

function loopRoute(r) {
  // A rectangle around a few blocks, optionally with a notch for variety.
  const w = 2 + Math.floor(r() * 3), h = 2 + Math.floor(r() * 3);
  const i0 = Math.floor(r() * (N - 1 - w)), j0 = Math.floor(r() * (N - 1 - h));
  const pts = [];
  for (let i = i0; i < i0 + w; i++) pts.push([i, j0]);
  for (let j = j0; j < j0 + h; j++) pts.push([i0 + w, j]);
  for (let i = i0 + w; i > i0; i--) pts.push([i, j0 + h]);
  for (let j = j0 + h; j > j0; j--) pts.push([i0, j]);
  return pts.map(([i, j]) => nodeId(i, j));
}
function walkRoute(r, len) {
  let i = Math.floor(r() * N), j = Math.floor(r() * N);
  const seen = new Set([nodeId(i, j)]);
  const out = [nodeId(i, j)];
  let di = 0, dj = 1;
  let guard = 0;
  while (out.length < len && guard++ < 500) {
    // prefer continuing straight for 1-3 nodes
    const opts = [[di, dj], [di, dj], [dj, di], [-dj, -di]];
    let moved = false;
    for (let t = 0; t < 6 && !moved; t++) {
      const [a, b] = t < 2 && r() < 0.6 ? opts[0] : opts[Math.floor(r() * opts.length)];
      const ni = i + a, nj = j + b, id = nodeId(ni, nj);
      if (ni < 0 || nj < 0 || ni >= N || nj >= N || seen.has(id)) continue;
      i = ni; j = nj; di = a; dj = b; seen.add(id); out.push(id); moved = true;
    }
    if (!moved) break;
  }
  return out;
}
function dragRoute(r) {
  const along = r() < 0.5, line = 1 + Math.floor(r() * (N - 2)), start = Math.floor(r() * (N - 7));
  const out = [];
  for (let k = 0; k <= 6; k++) out.push(along ? nodeId(line, start + k) : nodeId(start + k, line));
  return out;
}
export function makeEvent(id, type, seed, tier, opts = {}) {
  const r = rng(seed);
  const name = `${pick(r, PLACE)} ${pick(r, SUFFIX)}`;
  let route, laps = 1;
  if (type === 'circuit' || type === 'knockout') { route = loopRoute(r); laps = type === 'knockout' ? 3 : 2; }
  else if (type === 'drag') route = dragRoute(r);
  else route = walkRoute(r, type === 'tollbooth' ? 12 : 10);
  if (route.length < 5) route = walkRoute(rng(seed + 7), 10);
  const opponents = type === 'tollbooth' ? 0 : type === 'drag' ? 1 : 3;
  const cash = Math.round((1500 + tier * 2600) * (type === 'drag' ? 0.8 : 1) / 100) * 100;
  return { id, type, name, route, laps, opponents, cash, bounty: Math.round(cash * 1.4), tier, seed, ...opts };
}

export const RIVAL_EVENTS = RIVALS.map((rv, idx) => {
  const count = 2 + Math.floor(idx / 3);
  const list = [];
  for (let k = 0; k < count; k++) list.push(makeEvent(`r${idx}e${k}`, TYPE_CYCLE[(idx + k * 3) % TYPE_CYCLE.length], 1000 + idx * 31 + k * 7, idx / 14));
  return list;
});
export const RIVAL_MILESTONES = RIVALS.map((rv, idx) => milestonesFor(idx, rv.ms));
export const DUELS = RIVALS.map((rv, idx) => {
  const list = [];
  for (let k = 0; k < duelRaces(rv.rank); k++) {
    const type = k % 2 === 0 ? 'circuit' : 'sprint';
    list.push(makeEvent(`d${idx}_${k}`, type, 5000 + idx * 17 + k * 3, idx / 14, { rival: idx, opponents: 1 }));
  }
  return list;
});

// ---------- Save ----------
const KEY = 'heatrun.save.v1';
export function newSave() {
  return {
    cash: 6000, bounty: 0, rivalIdx: 0, won: [], milestones: [], defeated: [],
    garage: [{ id: 'hachi', up: {}, color: CARS.hachi.color, heat: 1, strikes: 0 }],
    current: 0, unlocked: ['hachi'], jailFree: 0,
    stats: { pursuits: 0, evaded: 0, busted: 0, longest: 0, immob: 0, racesWon: 0 },
    settings: { radio: true, mph: true, volume: 0.7 },
  };
}
export function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && s.garage && s.garage.length) return { ...newSave(), ...s };
  } catch (e) { /* storage unavailable */ }
  return null;
}
export function writeSave(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
export function clearSave() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

// Requirements to challenge the current rival.
export function rivalStatus(save, idx) {
  const evs = RIVAL_EVENTS[idx], ms = RIVAL_MILESTONES[idx], rv = RIVALS[idx];
  const racesDone = evs.filter((e) => save.won.includes(e.id)).length;
  const msDone = ms.filter((m) => save.milestones.includes(m.id)).length;
  const ok = racesDone === evs.length && msDone === ms.length && save.bounty >= rv.bounty;
  return { racesDone, racesNeed: evs.length, msDone, msNeed: ms.length, bounty: save.bounty, bountyNeed: rv.bounty, ok };
}
