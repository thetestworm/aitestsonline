// Procedural low-poly car bodies built from extruded side profiles.
import * as THREE from 'three';

// Side profiles in metres: x along length (+x = front), y up. Lower body + greenhouse.
const STYLES = {
  hatch: { L: 4.0, W: 1.74, wb: 2.45, wr: 0.31, body: [[-2.0, 0.32], [-2.05, 0.9], [-1.85, 1.02], [1.05, 0.95], [1.85, 0.78], [2.0, 0.5], [1.95, 0.32]],
    cab: [[-1.95, 0.98], [-1.75, 1.42], [0.0, 1.47], [0.95, 0.96]], roof: [-1.6, 0.1] },
  coupe: { L: 4.4, W: 1.8, wb: 2.6, wr: 0.33, body: [[-2.2, 0.32], [-2.25, 0.78], [-2.0, 0.96], [0.9, 0.9], [2.0, 0.72], [2.22, 0.48], [2.15, 0.3]],
    cab: [[-1.75, 0.94], [-0.9, 1.3], [0.15, 1.33], [1.05, 0.9]], roof: [-0.85, 0.12], spoiler: true },
  muscle: { L: 4.8, W: 1.9, wb: 2.85, wr: 0.36, body: [[-2.4, 0.34], [-2.42, 0.9], [-2.1, 1.0], [0.6, 1.0], [2.3, 0.92], [2.42, 0.6], [2.35, 0.32]],
    cab: [[-1.75, 0.98], [-0.95, 1.36], [0.2, 1.38], [0.85, 0.99]], roof: [-0.9, 0.18], scoop: true },
  super: { L: 4.5, W: 1.98, wb: 2.7, wr: 0.34, body: [[-2.25, 0.3], [-2.3, 0.86], [-1.9, 0.98], [-0.2, 0.92], [1.4, 0.72], [2.25, 0.5], [2.2, 0.28]],
    cab: [[-1.4, 0.94], [-0.75, 1.18], [0.05, 1.2], [1.25, 0.76]], roof: [-0.65, 0.06], spoiler: true, wing: true },
  sedan: { L: 4.9, W: 1.86, wb: 2.85, wr: 0.34, body: [[-2.45, 0.34], [-2.48, 0.9], [-2.2, 1.0], [1.2, 0.98], [2.3, 0.86], [2.45, 0.56], [2.38, 0.34]],
    cab: [[-1.8, 0.98], [-1.15, 1.48], [0.6, 1.5], [1.25, 0.98]], roof: [-1.05, 0.1] },
  suv: { L: 5.0, W: 2.0, wb: 2.95, wr: 0.42, body: [[-2.5, 0.45], [-2.52, 1.15], [-2.4, 1.25], [1.3, 1.2], [2.4, 1.05], [2.5, 0.7], [2.42, 0.45]],
    cab: [[-2.4, 1.22], [-2.3, 1.95], [0.95, 1.95], [1.45, 1.22]], roof: [-2.2, 0.1] },
  van: { L: 4.9, W: 1.95, wb: 2.9, wr: 0.36, body: [[-2.45, 0.4], [-2.45, 2.2], [1.0, 2.2], [2.3, 1.2], [2.45, 0.7], [2.4, 0.4]],
    cab: [[0.9, 2.0], [1.0, 2.05], [1.6, 1.4], [1.0, 1.35]], roof: null },
  pickup: { L: 5.1, W: 1.95, wb: 3.1, wr: 0.4, body: [[-2.55, 0.45], [-2.55, 1.15], [0.0, 1.15], [0.1, 1.2], [1.4, 1.18], [2.45, 1.0], [2.55, 0.65], [2.5, 0.45]],
    cab: [[-0.6, 1.16], [-0.5, 1.85], [0.7, 1.85], [1.45, 1.17]], roof: [-0.5, 0.08] },
};

const sharedGeo = new Map();
const cache = (k, f) => { if (!sharedGeo.has(k)) sharedGeo.set(k, f()); return sharedGeo.get(k); };

function profileShape(style) {
  const s = STYLES[style];
  const pts = s.body;
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) shape.lineTo(pts[k][0], pts[k][1]);
  // Bottom edge back to the rear, with wheel-arch notches.
  const fx = s.wb / 2, rx = -s.wb / 2, ar = s.wr + 0.07, by = pts[0][1];
  const cy = s.wr;
  const half = Math.sqrt(Math.max(0.01, ar * ar - (by - cy) * (by - cy)));
  shape.lineTo(fx + half, by);
  shape.absarc(fx, cy, ar, Math.asin((by - cy) / ar), Math.PI - Math.asin((by - cy) / ar), false);
  shape.lineTo(rx + half, by);
  shape.absarc(rx, cy, ar, Math.asin((by - cy) / ar), Math.PI - Math.asin((by - cy) / ar), false);
  shape.lineTo(pts[0][0], pts[0][1]);
  return shape;
}

function extrude(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(-Math.PI / 2); // profile +x (front) -> world +z
  return g;
}

const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0b0d10, metalness: 0.2, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.6 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, metalness: 0.9, roughness: 0.3 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xfff2d0, emissive: 0xfff0c0, emissiveIntensity: 0.6 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0x5a0000, emissive: 0xff1a10, emissiveIntensity: 0.8 });
export const paintCache = new Map();
export function paintMat(hex) {
  if (!paintCache.has(hex)) paintCache.set(hex, new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }));
  return paintCache.get(hex);
}

// opts: {style, color, stripe, police:'cruiser'|'interceptor'|'heavy'|'undercover', lod}
export function buildCar(opts) {
  const style = opts.style || 'coupe';
  const s = STYLES[style];
  const root = new THREE.Group();
  const body = new THREE.Group(); // body rolls/pitches, wheels stay
  root.add(body);
  const paint = paintMat(opts.color ?? 0xb02020);
  const lower = new THREE.Mesh(cache(style + ':body', () => extrude(profileShape(style), s.W, 0.07)), paint);
  lower.castShadow = true;
  body.add(lower);
  // greenhouse
  const cabShape = new THREE.Shape(s.cab.map(([x, y]) => new THREE.Vector2(x, y)));
  const cab = new THREE.Mesh(cache(style + ':cab', () => extrude(cabShape, s.W * 0.8, 0.05)), glassMat);
  cab.castShadow = true;
  body.add(cab);
  if (s.roof) {
    const [rx, rt] = s.roof;
    const roofTopY = Math.max(...s.cab.map((p) => p[1]));
    const roofLen = (s.cab[2][0] - s.cab[1][0]) * 0.92 + (style === 'suv' ? 0 : 0.2);
    const roof = new THREE.Mesh(cache(style + ':roof', () => new THREE.BoxGeometry(s.W * 0.76, rt, roofLen)), paint);
    roof.position.set(0, roofTopY + rt / 2 - 0.02, rx + roofLen / 2 - 0.05);
    body.add(roof);
  }
  // lights
  const front = s.body.reduce((m, p) => Math.max(m, p[0]), -9), rear = s.body[0][0];
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(cache('hl', () => new THREE.BoxGeometry(0.42, 0.12, 0.08)), headMat);
    hl.position.set(sx * s.W * 0.33, style === 'suv' || style === 'van' || style === 'pickup' ? 0.88 : 0.66, front - 0.04);
    body.add(hl);
    const tl = new THREE.Mesh(cache('tl', () => new THREE.BoxGeometry(0.5, 0.12, 0.08)), tailMat);
    tl.position.set(sx * s.W * 0.33, style === 'suv' || style === 'van' || style === 'pickup' ? 1.0 : 0.8, rear - 0.03);
    body.add(tl);
    root.userData.tail = root.userData.tail || [];
    root.userData.tail.push(tl);
  }
  // grille / diffuser
  const grille = new THREE.Mesh(cache(style + ':gr', () => new THREE.BoxGeometry(s.W * 0.5, 0.18, 0.06)), darkMat);
  grille.position.set(0, 0.48, front - 0.02); body.add(grille);
  if (s.spoiler && !opts.police) {
    const sp = new THREE.Mesh(cache('spoiler' + style, () => new THREE.BoxGeometry(s.W * 0.92, 0.05, s.wing ? 0.4 : 0.25)), s.wing ? darkMat : paint);
    sp.position.set(0, s.wing ? 1.18 : 0.98, rear + 0.25);
    body.add(sp);
    if (s.wing) for (const sx of [-1, 1]) {
      const st = new THREE.Mesh(cache('wingpost', () => new THREE.BoxGeometry(0.06, 0.22, 0.12)), darkMat);
      st.position.set(sx * s.W * 0.3, 1.06, rear + 0.28); body.add(st);
    }
  }
  if (s.scoop) {
    const sc = new THREE.Mesh(cache('scoop', () => new THREE.BoxGeometry(0.6, 0.12, 0.9)), darkMat);
    sc.position.set(0, 1.03, 1.3); body.add(sc);
  }
  if (opts.stripe) {
    const smat = new THREE.MeshStandardMaterial({ color: opts.stripe, roughness: 0.4, metalness: 0.3 });
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, s.L * 0.98), smat);
    st.position.set(0, 0.0, 0);
    // stripe follows the hood/roof roughly: put pieces on hood and roof
    const hood = st.clone(); hood.scale.z = 0.3; hood.position.set(0, s.body[3][1] + 0.05, s.L * 0.3); body.add(hood);
    const trunk = st.clone(); trunk.scale.z = 0.18; trunk.position.set(0, s.body[2][1] + 0.05, -s.L * 0.38); body.add(trunk);
    if (s.roof) { const rf = st.clone(); rf.scale.z = 0.22; rf.position.set(0, Math.max(...s.cab.map((p) => p[1])) + s.roof[1] + 0.01, s.roof[0] + 0.5); body.add(rf); }
  }
  // police dress-up
  if (opts.police && opts.police !== 'undercover') {
    const white = paintMat(0xe8e8e4);
    for (const sx of [-1, 1]) {
      const door = new THREE.Mesh(cache(style + ':door', () => new THREE.BoxGeometry(0.03, 0.42, s.wb * 0.62)), white);
      door.position.set(sx * (s.W / 2 + 0.035), style === 'suv' ? 0.85 : 0.62, 0.05);
      body.add(door);
    }
    const roofY = Math.max(...s.cab.map((p) => p[1])) + (s.roof ? s.roof[1] : 0);
    const bar = new THREE.Group();
    const red = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff0000, emissiveIntensity: 2 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x000040, emissive: 0x1040ff, emissiveIntensity: 2 });
    const base = new THREE.Mesh(cache('barbase', () => new THREE.BoxGeometry(1.3, 0.08, 0.3)), darkMat);
    bar.add(base);
    const L = new THREE.Mesh(cache('barL', () => new THREE.BoxGeometry(0.55, 0.12, 0.26)), red); L.position.set(-0.35, 0.09, 0); bar.add(L);
    const R = new THREE.Mesh(cache('barL', () => new THREE.BoxGeometry(0.55, 0.12, 0.26)), blue); R.position.set(0.35, 0.09, 0); bar.add(R);
    bar.position.set(0, roofY + 0.02, (s.roof ? s.roof[0] : 0) + 0.6);
    body.add(bar);
    root.userData.lightbar = { red, blue };
    // push bar
    const pb = new THREE.Mesh(cache('pushbar', () => new THREE.BoxGeometry(s.W * 0.7, 0.35, 0.12)), darkMat);
    pb.position.set(0, 0.5, front + 0.08); body.add(pb);
  }
  if (opts.police === 'undercover') {
    const red = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff0000, emissiveIntensity: 2 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x000040, emissive: 0x1040ff, emissiveIntensity: 2 });
    const a = new THREE.Mesh(cache('dash', () => new THREE.BoxGeometry(0.3, 0.06, 0.06)), red), b = new THREE.Mesh(cache('dash', () => new THREE.BoxGeometry(0.3, 0.06, 0.06)), blue);
    a.position.set(-0.2, 0.62, front - 0.01); b.position.set(0.2, 0.62, front - 0.01);
    body.add(a, b);
    root.userData.lightbar = { red, blue };
  }
  // wheels
  root.userData.wheels = [];
  const wgeo = cache('wheel' + s.wr, () => { const g = new THREE.CylinderGeometry(s.wr, s.wr, 0.26, 16); g.rotateZ(Math.PI / 2); return g; });
  const rgeo = cache('rim' + s.wr, () => { const g = new THREE.CylinderGeometry(s.wr * 0.62, s.wr * 0.62, 0.27, 8); g.rotateZ(Math.PI / 2); return g; });
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const hub = new THREE.Group();
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(wgeo, tireMat), new THREE.Mesh(rgeo, rimMat));
    spin.children[0].castShadow = true;
    hub.add(spin);
    hub.position.set(sx * (s.W / 2 - 0.12), s.wr, sz * s.wb / 2);
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
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, metalness: 0.4, roughness: 0.5 });
  const white = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.8, 12, 8), mat);
  body.scale.set(1, 0.9, 1.7); g.add(body);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.5, 2.5), white); stripe.position.y = -0.2; g.add(stripe);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
  glass.rotation.x = Math.PI / 2.4; glass.position.set(0, 0.2, 1.6); g.add(glass);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 6), mat); tail.position.set(0, 0.4, -4.6); g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 0.8), mat); fin.position.set(0, 1.1, -7.4); g.add(fin);
  for (const s of [-1, 1]) { const sk = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 4), darkMat); sk.position.set(s * 1.2, -1.75, 0); g.add(sk); }
  const rotor = new THREE.Group();
  for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 11), darkMat); b.rotation.y = (k * Math.PI) / 4 * 2; rotor.add(b); }
  rotor.position.y = 1.9; g.add(rotor);
  const trotor = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2, 0.2), darkMat); trotor.position.set(0.2, 1.1, -7.5); g.add(trotor);
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
