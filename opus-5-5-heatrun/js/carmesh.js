// Procedural car models. Bodies are lofted from cross-sections along the car,
// giving curved panels, wheel arches and a glass greenhouse; details are merged
// into a few vertex-coloured meshes so a car costs ~9 draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Profiles use t in [0,1] from rear bumper (0) to front bumper (1).
// b = beltline/hood/deck height, r = roofline (cabin where r > b), w = half-width factor.
const STYLES = {
  hatch: { L: 4.0, W: 1.76, wb: 2.48, wr: 0.31, sill: 0.3,
    b: [[0, 0.82], [0.03, 0.96], [0.25, 0.98], [0.66, 0.93], [0.86, 0.84], [0.97, 0.7], [1, 0.52]],
    r: [[0, 0], [0.02, 1.25], [0.06, 1.42], [0.45, 1.47], [0.58, 1.42], [0.72, 0.96], [1, 0]],
    w: [[0, 0.88], [0.04, 0.98], [0.12, 1], [0.88, 1], [0.97, 0.94], [1, 0.84]], glass: [0.035, 0.71], pillars: [0.36] },
  coupe: { L: 4.42, W: 1.82, wb: 2.62, wr: 0.33, sill: 0.29,
    b: [[0, 0.72], [0.035, 0.9], [0.3, 0.94], [0.62, 0.9], [0.84, 0.8], [0.96, 0.64], [1, 0.48]],
    r: [[0, 0], [0.16, 0.92], [0.27, 1.22], [0.42, 1.32], [0.54, 1.3], [0.69, 0.92], [1, 0]],
    w: [[0, 0.86], [0.05, 0.98], [0.14, 1], [0.86, 1], [0.96, 0.93], [1, 0.82]], glass: [0.18, 0.68], pillars: [0.4], spoiler: 'lip' },
  muscle: { L: 4.85, W: 1.92, wb: 2.86, wr: 0.36, sill: 0.31,
    b: [[0, 0.86], [0.03, 0.98], [0.3, 1.0], [0.62, 0.98], [0.9, 0.94], [0.98, 0.84], [1, 0.62]],
    r: [[0, 0], [0.2, 1.0], [0.3, 1.33], [0.48, 1.38], [0.56, 1.36], [0.66, 0.99], [1, 0]],
    w: [[0, 0.92], [0.04, 0.99], [0.1, 1], [0.9, 1], [0.98, 0.97], [1, 0.9]], glass: [0.22, 0.65], pillars: [0.43], scoop: true, spoiler: 'duck' },
  super: { L: 4.55, W: 2.0, wb: 2.72, wr: 0.34, sill: 0.26,
    b: [[0, 0.8], [0.04, 0.95], [0.22, 0.98], [0.4, 0.92], [0.7, 0.78], [0.9, 0.66], [0.98, 0.52], [1, 0.42]],
    r: [[0, 0], [0.18, 0.96], [0.32, 1.13], [0.46, 1.19], [0.56, 1.14], [0.74, 0.76], [1, 0]],
    w: [[0, 0.9], [0.06, 1], [0.3, 1], [0.55, 0.95], [0.85, 0.98], [0.97, 0.93], [1, 0.82]], glass: [0.3, 0.73], pillars: [], spoiler: 'wing' },
  sedan: { L: 4.9, W: 1.86, wb: 2.86, wr: 0.34, sill: 0.31,
    b: [[0, 0.82], [0.03, 0.98], [0.25, 1.0], [0.68, 0.98], [0.88, 0.88], [0.98, 0.72], [1, 0.56]],
    r: [[0, 0], [0.15, 1.0], [0.25, 1.38], [0.4, 1.48], [0.58, 1.47], [0.71, 1.0], [1, 0]],
    w: [[0, 0.88], [0.04, 0.98], [0.12, 1], [0.88, 1], [0.97, 0.95], [1, 0.86]], glass: [0.17, 0.7], pillars: [0.27, 0.46] },
  suv: { L: 5.0, W: 2.0, wb: 2.96, wr: 0.42, sill: 0.48,
    b: [[0, 1.1], [0.03, 1.2], [0.6, 1.22], [0.84, 1.15], [0.97, 0.98], [1, 0.74]],
    r: [[0, 0], [0.01, 1.7], [0.04, 1.92], [0.62, 1.95], [0.72, 1.24], [1, 0]],
    w: [[0, 0.93], [0.04, 0.99], [0.1, 1], [0.9, 1], [0.98, 0.97], [1, 0.9]], glass: [0.03, 0.715], pillars: [0.2, 0.44] },
  van: { L: 4.95, W: 1.96, wb: 2.92, wr: 0.36, sill: 0.4,
    b: [[0, 1.2], [0.75, 1.2], [0.86, 1.12], [0.97, 0.92], [1, 0.72]],
    r: [[0, 2.1], [0.02, 2.22], [0.76, 2.24], [0.84, 1.6], [0.86, 1.18], [1, 0]],
    w: [[0, 0.97], [0.03, 1], [0.95, 1], [1, 0.92]], glass: [0.68, 0.86], pillars: [] },
  pickup: { L: 5.15, W: 1.96, wb: 3.12, wr: 0.4, sill: 0.45,
    b: [[0, 1.08], [0.02, 1.16], [0.45, 1.18], [0.86, 1.12], [0.97, 0.96], [1, 0.72]],
    r: [[0, 0], [0.38, 1.18], [0.39, 1.86], [0.58, 1.9], [0.68, 1.2], [1, 0]],
    w: [[0, 0.96], [0.03, 1], [0.95, 1], [1, 0.92]], glass: [0.39, 0.67], pillars: [], bed: true },
};

const lerp = (a, b, t) => a + (b - a) * t;
function prof(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let k = 1; k < keys.length; k++) if (t <= keys[k][0]) {
    const [t0, v0] = keys[k - 1], [t1, v1] = keys[k];
    const u = (t - t0) / (t1 - t0 || 1);
    return lerp(v0, v1, u * u * (3 - 2 * u)); // smooth between keys
  }
  return keys[keys.length - 1][1];
}

// ---------- shared materials ----------
const paintMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.55, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 1.35 });
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0c1014, metalness: 0.15, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.6 });
const detailMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.45, roughness: 0.45, envMapIntensity: 1.1 });
const lightMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false });
const wheelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.7, roughness: 0.32, envMapIntensity: 1.3 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
const heliGlass = new THREE.MeshPhysicalMaterial({ color: 0x0c1014, metalness: 0.2, roughness: 0.05, envMapIntensity: 2 });
// Light-bar materials are shared: every active unit flashes in sync, patrols glow dim.
export const LIGHTBAR = {
  red: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.1, 0.05), toneMapped: false }),
  blue: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.3, 5), toneMapped: false }),
  dimRed: new THREE.MeshBasicMaterial({ color: 0x7a1010 }),
  dimBlue: new THREE.MeshBasicMaterial({ color: 0x14246a }),
  off: new THREE.MeshBasicMaterial({ color: 0x202020 }),
};
LIGHTBAR.setPhase = (on) => {
  LIGHTBAR.red.color.setRGB(on ? 4 : 0.25, on ? 0.12 : 0.02, on ? 0.06 : 0.02);
  LIGHTBAR.blue.color.setRGB(on ? 0.06 : 0.02, on ? 0.2 : 0.03, on ? 0.04 : 5);
};

const shadowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.75)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.45)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

// ---------- body loft ----------
const HALF_PTS = 15;
function sectionPoints(s, t) {
  const x = (t - 0.5) * s.L;
  const w = (s.W / 2) * prof(s.w, t);
  const b = prof(s.b, t);
  const R0 = Math.max(b, prof(s.r, t));
  const c = Math.min(1, Math.max(0, (R0 - b - 0.03) / 0.22)); // 0 = hood/deck, 1 = full cabin
  const R = Math.max(R0, b + 0.05);
  // sill, lifted over the wheels to form arches
  const yLow = s.sill + Math.max(0, Math.abs(t - 0.5) * 2 - 0.86) * 0.6;
  let y0 = yLow;
  const ar = s.wr + 0.08;
  for (const ax of [s.wb / 2, -s.wb / 2]) {
    const d = x - ax;
    if (Math.abs(d) < ar) y0 = Math.max(y0, s.wr + Math.sqrt(ar * ar - d * d) * 0.98);
  }
  y0 = Math.min(y0, b - 0.12);
  const wr = lerp(w * 0.55, w * 0.78, c);
  const crown = s.scoop && c < 0.5 && t > 0.7 ? 0.05 : 0.012;
  // inner points stay low so only the outer fender is cut by the arch (wheel well wall)
  return [
    [0, Math.min(yLow, b - 0.12) + 0.02], [w * 0.6, Math.min(yLow, b - 0.12)], [w * 0.66, y0], [w * 0.84, y0], [w * 0.97, y0 + 0.06],
    [w, lerp(y0, b, 0.35)], [w, b - 0.1], [w * 0.975, b - 0.025], [w * 0.91, b + 0.02],
    [lerp(w * 0.91, wr, 0.55), lerp(b + 0.02, R - 0.04, lerp(0.3, 0.6, c))],
    [wr, R - 0.04], [wr * 0.6, R], [0.27, R + crown * 0.6], [0.21, R + crown * 0.8], [0, R + crown],
  ].map(([lat, y]) => [lat, y, x]); // game convention: +z forward, x lateral
}

function bodyGeometry(style) {
  const s = STYLES[style];
  const NS = 44;
  const ts = [];
  for (let k = 0; k < NS; k++) { const u = k / (NS - 1); ts.push(0.5 - 0.5 * Math.cos(u * Math.PI) * 0.35 + (u - 0.5) * 0.65); }
  ts[0] = 0; ts[NS - 1] = 1;
  const RING = HALF_PTS * 2 - 2;
  const pos = [], meta = [];
  for (const t of ts) {
    const half = sectionPoints(s, t);
    const ring = [...half, ...half.slice(1, -1).reverse().map(([x, y, z]) => [-x, y, z])];
    for (let k = 0; k < RING; k++) { pos.push(...ring[k]); meta.push(t, k); }
  }
  const idxPaint = [], idxGlass = [];
  const inGlass = (t) => t > s.glass[0] && t < s.glass[1] && !s.pillars.some((p) => Math.abs(t - p) < 0.018);
  const steep = (t) => {
    const e = 0.01, d = (Math.max(prof(s.b, t + e), prof(s.r, t + e)) - Math.max(prof(s.b, t - e), prof(s.r, t - e))) / (2 * e * s.L);
    return Math.abs(d) > 0.45;
  };
  for (let a = 0; a < NS - 1; a++) {
    const tm = (ts[a] + ts[a + 1]) / 2;
    const cab = Math.max(prof(s.b, tm), prof(s.r, tm)) - prof(s.b, tm) > 0.15;
    for (let k = 0; k < RING; k++) {
      const k2 = (k + 1) % RING;
      const i0 = a * RING + k, i1 = a * RING + k2, i2 = (a + 1) * RING + k, i3 = (a + 1) * RING + k2;
      // ring index → which half-point band (mirror for the left side)
      const hk = k < HALF_PTS - 1 ? k : RING - k - 1;
      const side = hk >= 8 && hk <= 9, top = hk >= 10;
      const glass = cab && inGlass(tm) && (side || (top && steep(tm)));
      const list = glass ? idxGlass : idxPaint;
      list.push(i0, i2, i1, i1, i2, i3);
    }
  }
  // end caps (flat, separate vertices)
  const capStart = pos.length / 3;
  for (const [a, sign] of [[0, -1], [NS - 1, 1]]) {
    const base = pos.length / 3;
    let cy = 0, cz = 0;
    for (let k = 0; k < RING; k++) { const i = (a * RING + k) * 3; pos.push(pos[i], pos[i + 1], pos[i + 2]); cy += pos[i + 1]; cz += pos[i + 2]; }
    pos.push(0, cy / RING, cz / RING);
    for (let k = 0; k < RING; k++) {
      const k2 = (k + 1) % RING;
      if (sign > 0) idxPaint.push(base + RING, base + k, base + k2); else idxPaint.push(base + RING, base + k2, base + k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex([...idxPaint, ...idxGlass]);
  g.addGroup(0, idxPaint.length, 0);
  g.addGroup(idxPaint.length, idxGlass.length, 1);
  g.computeVertexNormals();
  // the loft winds inward on one side; make normals face outward
  const n = g.attributes.normal, p = g.attributes.position;
  let out = 0;
  for (let i = 0; i < capStart; i += 7) out += n.getX(i) * p.getX(i) + n.getY(i) * (p.getY(i) - 0.7);
  if (out < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const tmp = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = tmp; } g.computeVertexNormals(); }
  g.userData = { capStart, NS, RING, ts };
  return g;
}

const bodyCache = new Map();
function coloredBody(style, color, stripe, police) {
  const key = `${style}|${color}|${stripe}|${police}`;
  if (bodyCache.has(key)) return bodyCache.get(key);
  if (!bodyCache.has(style)) bodyCache.set(style, bodyGeometry(style));
  const base = bodyCache.get(style), s = STYLES[style];
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal']) g.setAttribute(k, base.attributes[k]);
  g.setIndex(base.index);
  for (const gr of base.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
  const p = base.attributes.position, n = p.count;
  const col = new Float32Array(n * 3);
  const c0 = new THREE.Color(color), cs = new THREE.Color(stripe ?? color), cw = new THREE.Color(0xe8e8e2);
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), t = p.getZ(i) / s.L + 0.5;
    let c = c0;
    if (stripe != null && Math.abs(x) < 0.24 && y > prof(s.b, t) - 0.04) c = cs;
    if (police && police !== 'undercover' && t > 0.3 && t < 0.66 && y < prof(s.b, t) - 0.03 && y > s.sill + 0.08) c = cw;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  bodyCache.set(key, g);
  return g;
}

// ---------- merged detail parts ----------
function part(geo, color, m) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv');
  if (m) g.applyMatrix4(m);
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const M = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

const detailCache = new Map();
function detailGeometry(style, police) {
  const key = style + '|' + police;
  if (detailCache.has(key)) return detailCache.get(key);
  const s = STYLES[style], parts = [], lights = [];
  const front = s.L / 2, rear = -s.L / 2;
  const bF = prof(s.b, 0.985), bR = prof(s.b, 0.012);
  const box = new THREE.BoxGeometry(1, 1, 1), sph = new THREE.SphereGeometry(0.5, 12, 8), cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  // grille / intake and rear diffuser
  parts.push(part(box, 0x0d0d0d, M(0, s.sill + 0.16, front - 0.03, 0, 0, 0, s.W * 0.56, 0.16, 0.06)));
  parts.push(part(box, 0x0d0d0d, M(0, s.sill + 0.07, rear + 0.04, 0, 0, 0, s.W * 0.7, 0.1, 0.08)));
  // headlights: housing + bright lens
  for (const sx of [-1, 1]) {
    const z = sx * s.W * 0.33;
    parts.push(part(sph, 0x1a1a1a, M(z, bF - 0.09, front - 0.12, 0, 0, 0, 0.44, 0.16, 0.26)));
    lights.push(part(sph, new THREE.Color(1.5, 1.42, 1.25), M(z, bF - 0.085, front - 0.08, 0, 0, 0, 0.36, 0.11, 0.2)));
    lights.push(part(box, new THREE.Color(0.9, 0.04, 0.02), M(z * 1.02, bR - 0.12, rear + 0.02, 0, 0, 0, 0.46, 0.11, 0.05)));
    // mirrors
    const tg = s.glass[1] - 0.025, xm = (tg - 0.5) * s.L, bm = prof(s.b, tg);
    parts.push(part(box, 0x111111, M(sx * (s.W / 2 * prof(s.w, tg) + 0.09), bm + 0.12, xm, 0, sx * 0.2, 0, 0.16, 0.1, 0.12)));
    // exhaust tips
    if (!['van', 'pickup', 'suv'].includes(style) || sx > 0) parts.push(part(cyl, 0xb8b8b8, M(sx * 0.42, s.sill + 0.06, rear + 0.02, Math.PI / 2, 0, 0, 0.09, 0.14, 0.09)));
  }
  // number plates
  parts.push(part(box, 0xe6dfc8, M(0, s.sill + 0.24, rear + 0.01, 0, 0, 0, 0.52, 0.12, 0.02)));
  parts.push(part(box, 0xe6dfc8, M(0, s.sill + 0.12, front + 0.0, 0, 0, 0, 0.52, 0.12, 0.02)));
  if (s.spoiler === 'wing' && !police) {
    parts.push(part(box, 0x121212, M(0, bR + 0.32, rear + 0.32, -0.08, 0, 0, s.W * 0.9, 0.05, 0.36)));
    for (const sx of [-0.55, 0.55]) parts.push(part(box, 0x121212, M(sx, bR + 0.16, rear + 0.34, 0, 0, 0, 0.05, 0.3, 0.14)));
  } else if (s.spoiler === 'duck' && !police) {
    parts.push(part(box, 0x121212, M(0, bR + 0.05, rear + 0.12, -0.35, 0, 0, s.W * 0.86, 0.04, 0.22)));
  }
  if (s.scoop) parts.push(part(box, 0x0e0e0e, M(0, prof(s.b, 0.82) + 0.05, (0.82 - 0.5) * s.L, -0.04, 0, 0, 0.62, 0.1, 0.8)));
  if (s.bed) parts.push(part(box, 0x0e0e0e, M(0, prof(s.b, 0.2) + 0.005, (0.19 - 0.5) * s.L, 0, 0, 0, s.W * 0.84, 0.02, s.L * 0.34)));
  if (police && police !== 'undercover') {
    parts.push(part(box, 0x111111, M(0, s.sill + 0.24, front + 0.1, 0, 0, 0, s.W * 0.66, 0.34, 0.1))); // push bar
    const tr = (s.glass[0] + s.glass[1]) / 2, rY = prof(s.r, tr);
    parts.push(part(box, 0x161616, M(0, rY + 0.04, (tr - 0.5) * s.L, 0, 0, 0, 1.3, 0.08, 0.3)));
  }
  const g = mergeGeometries(parts), l = mergeGeometries(lights);
  const out = { g, l };
  detailCache.set(key, out);
  return out;
}

const wheelCache = new Map();
function wheelGeometry(r) {
  if (wheelCache.has(r)) return wheelCache.get(r);
  const prof2 = [[0.6, -0.125], [0.93, -0.13], [0.995, -0.1], [1, 0], [0.995, 0.1], [0.93, 0.13], [0.6, 0.125]].map(([a, b]) => new THREE.Vector2(a * r, b));
  const tire = new THREE.LatheGeometry(prof2, 16);
  tire.rotateZ(Math.PI / 2);
  const parts = [part(tire, 0x121212)];
  const rim = new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.05, 18); rim.rotateZ(Math.PI / 2);
  parts.push(part(rim, 0x2a2a2a, M(0.05, 0, 0)));
  const disc = new THREE.CylinderGeometry(r * 0.45, r * 0.45, 0.03, 16); disc.rotateZ(Math.PI / 2);
  parts.push(part(disc, 0x6a6a6a, M(0.01, 0, 0)));
  const spoke = new THREE.BoxGeometry(0.04, r * 0.56, 0.07);
  for (let k = 0; k < 5; k++) parts.push(part(spoke, 0xc8c8c8, M(0.11, 0, 0, (k / 5) * Math.PI * 2, 0, 0).multiply(M(0, r * 0.3, 0))));
  const lip = new THREE.TorusGeometry(r * 0.6, 0.022, 6, 22); lip.rotateY(Math.PI / 2);
  parts.push(part(lip, 0xd8d8d8, M(0.11, 0, 0)));
  const hub = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 8); hub.rotateZ(Math.PI / 2);
  parts.push(part(hub, 0x888888, M(0.13, 0, 0)));
  const g = mergeGeometries(parts);
  wheelCache.set(r, g);
  return g;
}
const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const barGeo = new THREE.BoxGeometry(0.56, 0.12, 0.26);
const dashGeo = new THREE.BoxGeometry(0.28, 0.06, 0.05);

// opts: {style, color, stripe, police:'cruiser'|'interceptor'|'heavy'|'undercover', ownTail}
export function buildCar(opts) {
  const style = opts.style || 'coupe', s = STYLES[style];
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const shell = new THREE.Mesh(coloredBody(style, opts.color ?? 0xb02020, opts.stripe ?? null, opts.police || null), [paintMat, glassMat]);
  shell.castShadow = true;
  body.add(shell);
  const det = detailGeometry(style, opts.police || null);
  const dm = new THREE.Mesh(det.g, detailMat); dm.castShadow = true; body.add(dm);
  const lm = new THREE.Mesh(det.l, opts.ownTail ? lightMat.clone() : lightMat); body.add(lm);
  root.userData.setBrake = (on) => { if (lm.material !== lightMat) lm.material.color.setScalar(on ? 2.6 : 1); };
  // police light bar
  if (opts.police && opts.police !== 'undercover') {
    const tr = (s.glass[0] + s.glass[1]) / 2, rY = prof(s.r, tr), x = (tr - 0.5) * s.L;
    const L = new THREE.Mesh(barGeo, LIGHTBAR.dimRed), R = new THREE.Mesh(barGeo, LIGHTBAR.dimBlue);
    L.position.set(-0.33, rY + 0.13, x); R.position.set(0.33, rY + 0.13, x);
    body.add(L, R);
    root.userData.lightbar = { L, R };
  } else if (opts.police === 'undercover') {
    const L = new THREE.Mesh(dashGeo, LIGHTBAR.dimRed), R = new THREE.Mesh(dashGeo, LIGHTBAR.dimBlue);
    const y = prof(s.b, 0.98) - 0.25;
    L.position.set(-0.2, y, s.L / 2 + 0.01); R.position.set(0.2, y, s.L / 2 + 0.01);
    body.add(L, R);
    root.userData.lightbar = { L, R };
  }
  // contact shadow
  const sh = new THREE.Mesh(shadowGeo, shadowMat);
  sh.scale.set(s.W + 0.9, 1, s.L + 0.9); sh.position.y = 0.025;
  root.add(sh);
  // wheels
  root.userData.wheels = [];
  const wg = wheelGeometry(s.wr);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const hub = new THREE.Group();
    const spin = new THREE.Group();
    const w = new THREE.Mesh(wg, wheelMat);
    w.castShadow = true;
    if (sx < 0) w.rotation.y = Math.PI; // rim face outward
    spin.add(w);
    hub.add(spin);
    hub.position.set(sx * (s.W / 2 - 0.13), s.wr, sz * s.wb / 2);
    hub.userData = { spin, front: sz > 0 };
    root.add(hub);
    root.userData.wheels.push(hub);
  }
  root.userData.body = body;
  root.userData.dims = { L: s.L, W: s.W, wb: s.wb, wr: s.wr };
  return root;
}

export function buildHeli() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, metalness: 0.5, roughness: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 12), mat);
  body.scale.set(1, 0.9, 1.7); g.add(body);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 2.5), white); stripe.position.y = -0.2; g.add(stripe);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), heliGlass);
  glass.rotation.x = Math.PI / 2.4; glass.position.set(0, 0.2, 1.6); g.add(glass);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.4, 6, 8), mat); tail.rotation.x = Math.PI / 2; tail.position.set(0, 0.4, -4.6); g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 0.8), mat); fin.position.set(0, 1.1, -7.4); g.add(fin);
  for (const s of [-1, 1]) { const sk = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 4), darkMat); sk.position.set(s * 1.2, -1.75, 0); g.add(sk); }
  const rotor = new THREE.Group();
  for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 11), darkMat); b.rotation.y = (k * Math.PI) / 2; rotor.add(b); }
  rotor.position.y = 1.9; g.add(rotor);
  const trotor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2, 0.2), darkMat); trotor.position.set(0.2, 1.1, -7.5); g.add(trotor);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 4), LIGHTBAR.red); beacon.position.set(0, -1.3, 0.5); g.add(beacon);
  // searchlight cone
  const cone = new THREE.Mesh(new THREE.ConeGeometry(9, 40, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff4d0, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide }));
  cone.position.y = -20; g.add(cone);
  g.userData = { rotor, trotor, cone };
  g.traverse((o) => { if (o.isMesh && o !== cone) o.castShadow = true; });
  return g;
}

export function buildSpikeStrip(width) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, 0.5), darkMat);
  base.position.y = 0.04; g.add(base);
  const spikeG = new THREE.ConeGeometry(0.05, 0.16, 4);
  const sm = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.3 });
  for (let x = -width / 2 + 0.2; x < width / 2; x += 0.35) {
    const sp = new THREE.Mesh(spikeG, sm); sp.position.set(x, 0.14, 0); g.add(sp);
  }
  return g;
}

// Free geometry owned by a one-off object (heli, spike strip). Car geometry is
// cached and shared, so cars never need disposing.
export function disposeGeometry(obj) {
  obj.traverse((o) => { if (o.isMesh && !o.geometry.userData.shared) o.geometry.dispose(); });
}
