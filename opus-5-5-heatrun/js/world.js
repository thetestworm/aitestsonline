// Port Calder: procedural grid city with three districts, colliders, road graph,
// hiding spots and pursuit breakers.
import * as THREE from 'three';
import { rng, pick, clamp } from './util.js';

export const N = 13;               // road lines per axis
export const SP = 180;             // spacing between road lines (m)
export const HALF = ((N - 1) / 2) * SP;
export const ROAD_W = 22;          // asphalt width, 4 lanes
export const LANE_IN = 2.75, LANE_OUT = 8.25;
export const WALK = 4;             // sidewalk width
export const BOUND = HALF + ROAD_W / 2 + 3;
export const lineAt = (i) => -HALF + i * SP;
export const nodeId = (i, j) => i * N + j;
export const nodePos = (id) => ({ x: lineAt(Math.floor(id / N)), z: lineAt(id % N) });

export function districtOf(x, z) {
  if (x < lineAt(4)) return 'port';
  return z < 0 ? 'downtown' : 'heights';
}
export const DISTRICT_NAMES = { port: 'IRONHOOK DOCKS', downtown: 'CALDER CENTRAL', heights: 'MAPLE HEIGHTS' };

// ---------- procedural textures ----------
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noise(g, w, h, base, amp, n = 6000) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let k = 0; k < n; k++) {
    const v = Math.random() * amp;
    g.fillStyle = `rgba(${v > amp / 2 ? '255,255,255' : '0,0,0'},${Math.random() * 0.08})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}
function roadTexture() {
  // One 22m x 22m tile; v runs along the road.
  return canvasTex(512, 512, (g, w, h) => {
    noise(g, w, h, '#3b3a38', 255, 20000);
    // tyre wear in lanes
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (const l of [LANE_OUT, LANE_IN]) for (const s of [-1, 1]) {
      const cx = w / 2 + (s * l / ROAD_W) * w;
      g.fillRect(cx - 34, 0, 16, h); g.fillRect(cx + 18, 0, 16, h);
    }
    const px = (m) => w / 2 + (m / ROAD_W) * w;
    g.fillStyle = '#d9b43a'; // double yellow
    g.fillRect(px(-0.3) - 4, 0, 6, h); g.fillRect(px(0.3) - 2, 0, 6, h);
    g.fillStyle = '#d8d4c8';
    for (const s of [-1, 1]) {
      for (let y = 0; y < h; y += 128) g.fillRect(px(s * 5.5) - 3, y, 6, 64); // lane dashes
      g.fillRect(px(s * 10.6) - 3, 0, 6, h); // edge line
    }
    // gutter
    g.fillStyle = 'rgba(20,18,16,0.6)';
    g.fillRect(0, 0, 10, h); g.fillRect(w - 10, 0, 10, h);
  });
}
function crossTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    noise(g, w, h, '#3b3a38', 255, 20000);
    g.fillStyle = 'rgba(0,0,0,0.15)';
    g.beginPath(); g.arc(w / 2, h / 2, w * 0.35, 0, Math.PI * 2); g.fill();
  }, false);
}
function walkTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    noise(g, w, h, '#9a9184', 255, 6000);
    g.strokeStyle = 'rgba(40,35,30,0.35)'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke(); g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke(); }
  });
}
function groundTexture(kind) {
  return canvasTex(256, 256, (g, w, h) => {
    if (kind === 'grass') {
      noise(g, w, h, '#5d6b33', 255, 14000);
      for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(${90 + Math.random() * 60},${100 + Math.random() * 40},40,0.25)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 5); }
    } else if (kind === 'gravel') {
      noise(g, w, h, '#6b6255', 255, 16000);
    } else {
      noise(g, w, h, '#7d766c', 255, 9000);
      g.strokeStyle = 'rgba(30,25,20,0.25)';
      for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, h); g.stroke(); }
    }
  });
}

// Lambert material that paints windows on boxes using world-space position.
function buildingMaterial({ floorH = 3.6, colW = 3.2, density = 1, glass = 0.9, base = 0 }) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWin = { value: new THREE.Vector4(floorH, colW, density, glass) };
    sh.uniforms.uBase = { value: base };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        mat4 mw = modelMatrix;
        #ifdef USE_INSTANCING
          mw = modelMatrix * instanceMatrix;
        #endif
        vWP = (mw * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(mw) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP; varying vec3 vWN; uniform vec4 uWin; uniform float uBase;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 n = normalize(vWN);
        if (n.y > 0.5) { diffuseColor.rgb *= 0.55; }
        else {
          float u = abs(n.x) > 0.5 ? vWP.z : vWP.x;
          vec2 cell = floor(vec2(u / uWin.y, vWP.y / uWin.x));
          float fy = fract(vWP.y / uWin.x), fu = fract(u / uWin.y);
          float win = step(0.22, fy) * step(fy, 0.82) * step(0.14, fu) * step(fu, 0.86);
          win *= step(uBase, vWP.y);
          float r = h21(cell + floor(vWP.xz * 0.013));
          win *= step(1.0 - uWin.z, r + 0.001);
          vec3 glassC = mix(vec3(0.10, 0.12, 0.15), vec3(0.62, 0.52, 0.36), pow(h21(cell * 1.7), 3.0));
          glassC += smoothstep(0.55, 1.0, fract(vWP.y * 0.02 + u * 0.004)) * 0.18;
          diffuseColor.rgb = mix(diffuseColor.rgb, glassC, win * uWin.w);
          // grime toward the ground
          diffuseColor.rgb *= 0.78 + 0.22 * smoothstep(0.0, 6.0, vWP.y);
        }`);
  };
  return m;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.blocks = [];        // per block {i,j,kind,boxes:[aabb], circles:[]}
    this.hidingSpots = [];   // {x,z,hw,hd}
    this.breakers = [];
    this.eventSpots = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.build();
  }

  blockAt(x, z) {
    const i = Math.floor((x + HALF) / SP), j = Math.floor((z + HALF) / SP);
    if (i < 0 || j < 0 || i >= N - 1 || j >= N - 1) return null;
    return this.blocks[i * (N - 1) + j];
  }
  blocksNear(x, z, r) {
    const out = [];
    const i0 = Math.floor((x - r + HALF) / SP), i1 = Math.floor((x + r + HALF) / SP);
    const j0 = Math.floor((z - r + HALF) / SP), j1 = Math.floor((z + r + HALF) / SP);
    for (let i = Math.max(0, i0); i <= Math.min(N - 2, i1); i++)
      for (let j = Math.max(0, j0); j <= Math.min(N - 2, j1); j++) out.push(this.blocks[i * (N - 1) + j]);
    if (this.dynamicBoxes.length) out.push({ boxes: this.dynamicBoxes, circles: [] });
    return out;
  }
  // Line of sight at car height between two points.
  los(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.ceil(len / 6);
    for (let s = 1; s < steps; s++) {
      const t = s / steps, x = ax + dx * t, z = az + dz * t;
      const b = this.blockAt(x, z);
      if (!b) continue;
      for (const a of b.boxes) if (a.h > 2.5 && x > a.x0 && x < a.x1 && z > a.z0 && z < a.z1) return false;
    }
    return true;
  }
  inHidingSpot(x, z) {
    for (const h of this.hidingSpots) if (Math.abs(x - h.x) < h.hw && Math.abs(z - h.z) < h.hd) return h;
    return null;
  }
  nearestNode(x, z) {
    const i = clamp(Math.round((x + HALF) / SP), 0, N - 1), j = clamp(Math.round((z + HALF) / SP), 0, N - 1);
    return nodeId(i, j);
  }
  neighbors(id) {
    const i = Math.floor(id / N), j = id % N, out = [];
    if (i > 0) out.push(nodeId(i - 1, j));
    if (i < N - 1) out.push(nodeId(i + 1, j));
    if (j > 0) out.push(nodeId(i, j - 1));
    if (j < N - 1) out.push(nodeId(i, j + 1));
    return out;
  }
  // BFS path between nodes (grid is fully connected).
  path(from, to) {
    const prev = new Map([[from, -1]]);
    const q = [from];
    while (q.length) {
      const c = q.shift();
      if (c === to) break;
      for (const n of this.neighbors(c)) if (!prev.has(n)) { prev.set(n, c); q.push(n); }
    }
    const out = [];
    for (let c = to; c !== -1 && c !== undefined; c = prev.get(c)) out.unshift(c);
    return out;
  }
  // Is the point on asphalt (road or intersection)?
  onRoad(x, z) {
    const fx = ((x + HALF) % SP + SP) % SP, fz = ((z + HALF) % SP + SP) % SP;
    const nx = Math.min(fx, SP - fx), nz = Math.min(fz, SP - fz);
    return nx < ROAD_W / 2 || nz < ROAD_W / 2;
  }

  build() {
    const r = rng(1337);
    this.dynamicBoxes = [];
    this.buildGround();
    this.buildRoads();

    const towers = [], houses = [], warehouses = [], roofs = [], trees = [], containers = [], pillars = [], lamps = [];
    const parkBlocks = new Set(['5,7', '8,9', '9,5', '6,10', '2,9', '10,2', '7,3']);
    const lotBlocks = new Set(['1,3', '3,8', '6,6', '9,8', '5,2', '10,10', '2,0', '7,11']);
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
      const x0 = lineAt(i) + ROAD_W / 2 + WALK, x1 = lineAt(i + 1) - ROAD_W / 2 - WALK;
      const z0 = lineAt(j) + ROAD_W / 2 + WALK, z1 = lineAt(j + 1) - ROAD_W / 2 - WALK;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const dist = districtOf(cx, cz);
      const key = `${i},${j}`;
      const blk = { i, j, dist, kind: 'city', boxes: [], circles: [] };
      this.blocks.push(blk);
      const addBox = (list, x, z, w, d, h, color, extra = {}) => {
        list.push({ x, z, w, d, h, color, ...extra });
        blk.boxes.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h });
      };
      const addTree = (x, z, s = 1) => { trees.push({ x, z, s }); blk.circles.push({ x, z, r: 0.7 * s }); };

      if (parkBlocks.has(key)) {
        blk.kind = 'park';
        for (let k = 0; k < 34; k++) {
          const tx = x0 + 6 + r() * (x1 - x0 - 12), tz = z0 + 6 + r() * (z1 - z0 - 12);
          if (Math.abs(tx - cx) < 14 || Math.abs(tz - cz) < 14) continue; // keep cross paths open
          addTree(tx, tz, 0.8 + r() * 0.8);
        }
        continue;
      }
      if (lotBlocks.has(key)) {
        // Covered car park: drive under, hide from the law.
        blk.kind = 'lot';
        const hw = 38, hd = 30;
        this.hidingSpots.push({ x: cx, z: cz, hw, hd });
        for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) {
          const px = cx + sx * (hw - 2), pz = cz + sz * (hd - 2);
          pillars.push({ x: px, z: pz });
          blk.boxes.push({ x0: px - 0.6, x1: px + 0.6, z0: pz - 0.6, z1: pz + 0.6, h: 6 });
        }
        roofs.push({ x: cx, z: cz, w: hw * 2 + 2, d: hd * 2 + 2, kind: 'slab' });
        if (dist === 'port') for (let k = 0; k < 6; k++) {
          const sx = r() < 0.5 ? x0 + 8 : x1 - 8;
          addBox(containers, sx, z0 + 10 + k * 14, 2.6, 12, 2.6 * (1 + (k % 2)), 0);
        }
        continue;
      }
      if (dist === 'downtown') {
        // 2x2 lots of towers, some with setbacks.
        const nx = 2, nz = 2, gap = 8;
        const lw = (x1 - x0 - gap) / nx, ld = (z1 - z0 - gap) / nz;
        const core = 1 - Math.hypot(cx - lineAt(8), cz - lineAt(3)) / 900;
        for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
          const lx = x0 + a * (lw + gap) + lw / 2, lz = z0 + b * (ld + gap) + ld / 2;
          const w = lw - 2 - r() * 10, d = ld - 2 - r() * 10;
          const h = 22 + r() * 50 + Math.max(0, core) * r() * 140;
          const col = pick(r, [0x8a8178, 0x6d6a66, 0x9c8f7c, 0x5c6066, 0xa49786, 0x7b7266]);
          addBox(towers, lx, lz, w, d, h, col);
          if (h > 60 && r() < 0.7) towers.push({ x: lx, z: lz, w: w * 0.7, d: d * 0.7, h: h * 0.35, y: h, color: col });
          if (h > 110) towers.push({ x: lx, z: lz, w: 2, d: 2, h: 18, y: h * 1.35, color: 0x333333 });
        }
      } else if (dist === 'heights') {
        // Rows of houses facing the street with lawns and trees.
        const cols = [0xc9b9a0, 0xa7896a, 0xd8cdb5, 0x9b7d62, 0xb8a58a, 0x8e9a8c, 0xcfb08a];
        const campus = (i + j) % 5 === 0;
        if (campus) {
          addBox(warehouses, cx, cz, 90, 60, 16 + r() * 8, 0x9e6e52);
          for (let k = 0; k < 10; k++) addTree(x0 + 8 + r() * (x1 - x0 - 16), r() < 0.5 ? z0 + 6 : z1 - 6, 1.2);
          continue;
        }
        const step = 25;
        for (let t = x0 + 14; t < x1 - 10; t += step) {
          for (const side of [-1, 1]) {
            const hz = side < 0 ? z0 + 16 : z1 - 16, w = 14 + r() * 4, d = 12 + r() * 3, h = 5 + r() * 3;
            const col = pick(r, cols);
            addBox(houses, t, hz, w, d, h, col);
            roofs.push({ x: t, z: hz, w: w + 1, d: d + 1, y: h, h: 3 + r() * 1.5, kind: 'gable', color: pick(r, [0x5a3b2e, 0x4a4440, 0x6d4030, 0x3d3a3a]) });
            if (r() < 0.8) addTree(t + step / 2, side < 0 ? z0 + 3 : z1 - 3, 0.9 + r() * 0.5);
          }
        }
        for (let k = 0; k < 5; k++) addTree(x0 + 6 + r() * (x1 - x0 - 12), cz + (r() - 0.5) * 20, 1 + r() * 0.6);
      } else {
        // Port: warehouses and container stacks.
        const colsW = [0x7a6a55, 0x6b7076, 0x8c5f45, 0x5f6a5c, 0x8b8070];
        const w1 = 50 + r() * 20, d1 = 70 + r() * 30;
        addBox(warehouses, x0 + w1 / 2 + 4, cz, w1, d1, 11 + r() * 8, pick(r, colsW));
        const ccol = [0xa8452f, 0x2f5e8c, 0x3f7a4a, 0xb08a2a, 0x7a3a6a, 0x9a9a92];
        for (let row = 0; row < 4; row++) for (let k = 0; k < 6; k++) {
          if (r() < 0.2) continue;
          const sx = x1 - 12 - row * 7, sz = z0 + 12 + k * 21;
          const stack = 1 + Math.floor(r() * 3);
          containers.push({ x: sx, z: sz, w: 2.6, d: 12, h: 2.6 * stack, color: pick(r, ccol), stack });
          blk.boxes.push({ x0: sx - 1.3, x1: sx + 1.3, z0: sz - 6, z1: sz + 6, h: 2.6 * stack });
        }
      }
    }
    // street lamps along every road segment
    for (let i = 0; i < N; i++) for (let j = 0; j < N - 1; j++) for (let t = 40; t < SP - 30; t += 50) {
      lamps.push({ x: lineAt(i) + ROAD_W / 2 + 1.2, z: lineAt(j) + t, rot: Math.PI });
      lamps.push({ x: lineAt(j) + t, z: lineAt(i) - ROAD_W / 2 - 1.2, rot: -Math.PI / 2 });
    }

    this.instBoxes(towers, buildingMaterial({ floorH: 3.8, colW: 3.0, density: 0.95, glass: 0.95, base: 4 }), true);
    this.instBoxes(houses, buildingMaterial({ floorH: 3.0, colW: 4.5, density: 0.35, glass: 0.9, base: 1 }), true);
    this.instBoxes(warehouses, buildingMaterial({ floorH: 6.0, colW: 9.0, density: 0.25, glass: 0.7, base: 5 }), true);
    this.instBoxes(containers, new THREE.MeshLambertMaterial({ color: 0xffffff }), true, true);
    this.instRoofs(roofs);
    this.instTrees(trees);
    this.instPillars(pillars);
    this.instLamps(lamps);
    this.buildPort(r);
    this.buildEdges(r);
    this.buildBreakers(r);
  }

  instBoxes(list, mat, shadows, ribbed = false) {
    if (!list.length) return;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    list.forEach((b, k) => {
      m.makeScale(b.w, b.h, b.d).setPosition(b.x, b.y || 0, b.z);
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, c.setHex(b.color));
    });
    mesh.castShadow = shadows; mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }
  instRoofs(list) {
    const gables = list.filter((r) => r.kind === 'gable'), slabs = list.filter((r) => r.kind === 'slab');
    const shape = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5);
    const mesh = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial(), gables.length);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    gables.forEach((r, k) => {
      m.makeScale(r.w, r.h, r.d).setPosition(r.x, r.y, r.z);
      mesh.setMatrixAt(k, m); mesh.setColorAt(k, c.setHex(r.color));
    });
    mesh.castShadow = true;
    this.group.add(mesh);
    const sm = new THREE.MeshLambertMaterial({ color: 0x6d675e });
    for (const s of slabs) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(s.w, 0.8, s.d), sm);
      slab.position.set(s.x, 6.4, s.z);
      slab.castShadow = true; slab.receiveShadow = true;
      this.group.add(slab);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(14, 2.2, 0.4), new THREE.MeshBasicMaterial({ color: 0x2a62a8 }));
      sign.position.set(s.x, 8, s.z - s.d / 2);
      this.group.add(sign);
    }
  }
  instTrees(list) {
    const trunkG = new THREE.CylinderGeometry(0.18, 0.28, 3, 5); trunkG.translate(0, 1.5, 0);
    const leafG = new THREE.IcosahedronGeometry(2.4, 0); leafG.translate(0, 4.6, 0);
    const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: 0x4a3a2a }), list.length);
    const leaves = new THREE.InstancedMesh(leafG, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    list.forEach((t, k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.x * 13.1);
      m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
      trunks.setMatrixAt(k, m); leaves.setMatrixAt(k, m);
      leaves.setColorAt(k, c.setHSL(0.18 + Math.sin(t.z) * 0.04, 0.45, 0.28 + Math.cos(t.x) * 0.05));
    });
    leaves.castShadow = true; trunks.castShadow = true;
    this.group.add(trunks, leaves);
  }
  instPillars(list) {
    const g = new THREE.BoxGeometry(1.2, 6, 1.2); g.translate(0, 3, 0);
    const mesh = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: 0x8a8278 }), list.length);
    const m = new THREE.Matrix4();
    list.forEach((p, k) => { m.makeTranslation(p.x, 0, p.z); mesh.setMatrixAt(k, m); });
    this.group.add(mesh);
  }
  instLamps(list) {
    const pole = new THREE.CylinderGeometry(0.1, 0.14, 8, 5); pole.translate(0, 4, 0);
    const arm = new THREE.BoxGeometry(0.15, 0.15, 3); arm.translate(0, 7.9, 1.5);
    const head = new THREE.BoxGeometry(0.5, 0.25, 0.9); head.translate(0, 7.8, 2.9);
    const mat = new THREE.MeshLambertMaterial({ color: 0x3a3a38 });
    const meshes = [pole, arm, head].map((g) => new THREE.InstancedMesh(g, mat, list.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    list.forEach((l, k) => {
      q.setFromAxisAngle(up, l.rot);
      m.compose(new THREE.Vector3(l.x, 0, l.z), q, one);
      for (const mm of meshes) mm.setMatrixAt(k, m);
    });
    this.group.add(...meshes);
  }

  buildGround() {
    const size = BOUND * 2 + 40;
    const base = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ color: 0x3a3936 }));
    base.rotation.x = -Math.PI / 2; base.position.y = -0.05; base.receiveShadow = true;
    this.group.add(base);
    // Sidewalks + block interiors as merged quads per material.
    const walkTex = walkTexture();
    const mats = {
      walk: new THREE.MeshLambertMaterial({ map: walkTex }),
      grass: new THREE.MeshLambertMaterial({ map: groundTexture('grass') }),
      gravel: new THREE.MeshLambertMaterial({ map: groundTexture('gravel') }),
      concrete: new THREE.MeshLambertMaterial({ map: groundTexture('concrete') }),
    };
    const quads = { walk: [], grass: [], gravel: [], concrete: [] };
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
      const x0 = lineAt(i) + ROAD_W / 2, x1 = lineAt(i + 1) - ROAD_W / 2;
      const z0 = lineAt(j) + ROAD_W / 2, z1 = lineAt(j + 1) - ROAD_W / 2;
      quads.walk.push([x0, z0, x1, z1, 0.03, 0.25]);
      const d = districtOf((x0 + x1) / 2, (z0 + z1) / 2);
      const kind = d === 'heights' ? 'grass' : d === 'port' ? 'gravel' : 'concrete';
      quads[kind].push([x0 + WALK, z0 + WALK, x1 - WALK, z1 - WALK, 0.07, 0.08]);
    }
    for (const k in quads) {
      mats[k].polygonOffset = true; mats[k].polygonOffsetFactor = k === 'walk' ? -1 : -2; mats[k].polygonOffsetUnits = k === 'walk' ? -1 : -2;
      const mesh = new THREE.Mesh(quadGeo(quads[k]), mats[k]);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  buildRoads() {
    const segs = [], xs = [];
    const h = ROAD_W / 2;
    for (let a = 0; a < N; a++) for (let b = 0; b < N - 1; b++) {
      const l = lineAt(a), s = lineAt(b) + h, e = lineAt(b + 1) - h;
      segs.push({ ax: l, az: s, bx: l, bz: e });  // along z
      segs.push({ ax: s, az: l, bx: e, bz: l });  // along x
    }
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) xs.push([lineAt(a) - h, lineAt(b) - h, lineAt(a) + h, lineAt(b) + h, 0, 1]);
    // Road strips: u across, v along (one tile per ROAD_W metres).
    const pos = [], uv = [], idx = [];
    for (const s of segs) {
      const dx = s.bx - s.ax, dz = s.bz - s.az, len = Math.hypot(dx, dz);
      const px = (-dz / len) * h, pz = (dx / len) * h;
      const v = len / ROAD_W, n = pos.length / 3;
      pos.push(s.ax - px, 0, s.az - pz, s.ax + px, 0, s.az + pz, s.bx + px, 0, s.bz + pz, s.bx - px, 0, s.bz - pz);
      uv.push(0, 0, 1, 0, 1, v, 0, v);
      idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    if (g.attributes.normal.array[1] < 0) { g.index.array.reverse(); g.computeVertexNormals(); }
    const roads = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: roadTexture() }));
    roads.receiveShadow = true;
    const inter = new THREE.Mesh(quadGeo(xs), new THREE.MeshLambertMaterial({ map: crossTexture() }));
    inter.receiveShadow = true;
    inter.material.polygonOffset = true; inter.material.polygonOffsetFactor = -0.5; inter.material.polygonOffsetUnits = -0.5;
    this.group.add(roads, inter);
  }

  buildPort(r) {
    // Water beyond the western edge, cranes on the quay.
    const water = new THREE.Mesh(new THREE.PlaneGeometry(3000, 6000, 1, 1), new THREE.MeshPhongMaterial({ color: 0x3d4a48, shininess: 80, specular: 0x8a7a50 }));
    water.rotation.x = -Math.PI / 2; water.position.set(-BOUND - 1500 - 10, -1.2, 0);
    this.group.add(water);
    const quay = new THREE.Mesh(new THREE.BoxGeometry(14, 2, BOUND * 2 + 30), new THREE.MeshLambertMaterial({ color: 0x77706a }));
    quay.position.set(-BOUND - 4, -0.95, 0);
    this.group.add(quay);
    const yellow = new THREE.MeshLambertMaterial({ color: 0xc9902a }), dark = new THREE.MeshLambertMaterial({ color: 0x3b3835 });
    for (let k = -3; k <= 3; k++) {
      const crane = new THREE.Group();
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(1, 34, 1), yellow);
        leg.position.set(sx * 6, 17, sz * 6); crane.add(leg);
      }
      const boom = new THREE.Mesh(new THREE.BoxGeometry(70, 3, 3), yellow);
      boom.position.set(-12, 36, 0); crane.add(boom);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 6), dark);
      cab.position.set(2, 32, 0); crane.add(cab);
      crane.position.set(-BOUND - 10, 0, k * 260 + 40);
      crane.traverse((o) => { o.castShadow = true; });
      this.group.add(crane);
    }
    // Moored ships
    for (let k = 0; k < 3; k++) {
      const ship = new THREE.Mesh(new THREE.BoxGeometry(40, 14, 220), new THREE.MeshLambertMaterial({ color: [0x6b2f25, 0x2c3e4f, 0x3c4a3a][k] }));
      ship.position.set(-BOUND - 60, 4, -600 + k * 600);
      this.group.add(ship);
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(30, 16, 18), new THREE.MeshLambertMaterial({ color: 0xd8d0c0 }));
      bridge.position.set(-BOUND - 60, 19, -600 + k * 600 - 90);
      this.group.add(bridge);
    }
  }

  buildEdges(r) {
    // Jersey barriers along the north, south and east limits; quay rail on the west.
    const mat = new THREE.MeshLambertMaterial({ color: 0xb3aa9a });
    const L = BOUND * 2 + 6;
    for (const [x, z, w, d] of [[0, -BOUND - 0.6, L, 1.2], [0, BOUND + 0.6, L, 1.2], [BOUND + 0.6, 0, 1.2, L], [-BOUND - 0.6, 0, 1.2, L]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), mat);
      m.position.set(x, 0.55, z); m.receiveShadow = true;
      this.group.add(m);
    }
    // Distant hills to frame the horizon.
    const hillMat = new THREE.MeshLambertMaterial({ color: 0x6b6040, flatShading: true });
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      if (Math.cos(a) < -0.55) continue; // open sea to the west
      const d = 1900 + r() * 700, h = 120 + r() * 260, w = 300 + r() * 400;
      const hill = new THREE.Mesh(new THREE.ConeGeometry(w, h, 6 + Math.floor(r() * 4), 1), hillMat);
      hill.position.set(Math.cos(a) * d, h / 2 - 10, Math.sin(a) * d);
      hill.rotation.y = r() * 6;
      this.group.add(hill);
    }
  }

  buildBreakers(r) {
    // Pursuit breakers: water towers and giant roadside signs that topple across the road.
    const spots = [[2, 4, 'x'], [5, 9, 'z'], [8, 2, 'x'], [10, 7, 'z'], [3, 10, 'x'], [7, 6, 'z'], [11, 11, 'x'], [1, 1, 'z'], [6, 3, 'x'], [9, 10, 'z'], [4, 6, 'z'], [11, 4, 'x']];
    const legMat = new THREE.MeshLambertMaterial({ color: 0x5a4a3a }), tankMat = new THREE.MeshLambertMaterial({ color: 0x8a6a48 });
    const signMat = new THREE.MeshLambertMaterial({ color: 0xc8402a });
    spots.forEach(([a, b, axis], k) => {
      // A breaker sits on the sidewalk halfway along a road segment, falls across it.
      const roadLine = lineAt(a), mid = lineAt(b) + SP / 2;
      const x = axis === 'z' ? roadLine + ROAD_W / 2 + 2.5 : mid;
      const z = axis === 'z' ? mid : roadLine + ROAD_W / 2 + 2.5;
      const pivot = new THREE.Group();
      pivot.position.set(x, 0, z);
      const body = new THREE.Group();
      const type = k % 2 ? 'tower' : 'sign';
      if (type === 'tower') {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 16, 5), legMat);
          leg.position.set(sx * 2.5, 8, sz * 2.5); body.add(leg);
        }
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 7, 12), tankMat);
        tank.position.y = 19.5; body.add(tank);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(5.4, 3, 12), legMat);
        cap.position.y = 24.5; body.add(cap);
      } else {
        for (const s of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 14, 0.8), legMat);
          post.position.set(s * 4, 7, 0); body.add(post);
        }
        const board = new THREE.Mesh(new THREE.BoxGeometry(16, 8, 1), signMat);
        board.position.y = 17; body.add(board);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.7, 6, 16), new THREE.MeshLambertMaterial({ color: 0xf0d080 }));
        ring.position.set(0, 17, -0.8); body.add(ring);
      }
      body.traverse((o) => { o.castShadow = true; });
      // Orient so local +z points across the road (toward the road centre).
      pivot.rotation.y = axis === 'z' ? -Math.PI / 2 : Math.PI;
      pivot.add(body);
      this.group.add(pivot);
      // Debris collider spans the road once fallen.
      const box = axis === 'z'
        ? { x0: roadLine - ROAD_W / 2, x1: roadLine + ROAD_W / 2, z0: mid - 4, z1: mid + 4, h: 4 }
        : { x0: mid - 4, x1: mid + 4, z0: roadLine - ROAD_W / 2, z1: roadLine + ROAD_W / 2, h: 4 };
      // trigger zone: the breaker-side half of the road next to it
      const tx = axis === 'z' ? roadLine + LANE_OUT : mid, tz = axis === 'z' ? mid : roadLine + LANE_OUT;
      this.breakers.push({ x, z, tx, tz, rx: axis === 'z' ? roadLine : mid, rz: axis === 'z' ? mid : roadLine, axis, pivot, body, box, state: 'ready', t: 0 });
    });
  }

  updateBreakers(dt) {
    for (const b of this.breakers) {
      if (b.state === 'falling') {
        b.t += dt;
        const k = Math.min(1, b.t / 1.4);
        b.body.rotation.x = (k * k) * (Math.PI / 2 - 0.08);
        if (k >= 1) { b.state = 'down'; b.t = 0; this.dynamicBoxes.push(b.box); }
      } else if (b.state === 'down') {
        b.t += dt;
        if (b.t > 25 && this.dynamicBoxes.includes(b.box)) {
          // debris is cleared: hide the wreck together with its collider
          this.dynamicBoxes.splice(this.dynamicBoxes.indexOf(b.box), 1);
          b.body.visible = false;
        }
        if (b.t > 120) { b.state = 'ready'; b.body.rotation.x = 0; b.body.visible = true; }
      }
    }
  }
  triggerBreaker(b) {
    b.state = 'falling'; b.t = 0;
  }
}

function quadGeo(list) {
  const pos = [], uv = [], idx = [];
  for (const [x0, z0, x1, z1, y, s] of list) {
    const n = pos.length / 3;
    pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
    const sc = s === 1 ? 1 : s;
    const u0 = s === 1 ? 0 : x0 * sc, u1 = s === 1 ? 1 : x1 * sc, v0 = s === 1 ? 0 : z0 * sc, v1 = s === 1 ? 1 : z1 * sc;
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
