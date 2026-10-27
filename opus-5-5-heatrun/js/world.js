// Port Calder: procedural grid city with three districts, colliders, road graph,
// hiding spots and pursuit breakers.
import * as THREE from 'three';
import { rng, pick, clamp } from './util.js';
import { facadeMaterial, roadTextures, intersectionTexture, sidewalkTextures, groundTexture, billboardTexture } from './facade.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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

export const CURB_H = 0.15;        // sidewalks and blocks sit this high above the asphalt

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
          addBox(containers, sx, z0 + 10 + k * 14, 2.6, 12, 2.6 * (1 + (k % 2)), pick(r, [0xa8452f, 0x2f5e8c, 0x3f7a4a]), { style: 4 });
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
          const style = h > 55 && r() < 0.65 ? 0 : 1;
          const col = style === 0 ? pick(r, [0x7d8288, 0x6b6e70, 0x8a8378, 0x5c6066]) : pick(r, [0x9c8f7c, 0xa49786, 0x8a8178, 0x7b6a5a, 0xb0a28a, 0x8c6a52]);
          addBox(towers, lx, lz, w, d, h, col, { style });
          if (h > 60 && r() < 0.7) towers.push({ x: lx, z: lz, w: w * 0.7, d: d * 0.7, h: h * 0.35, y: h, color: col, style });
          if (h > 110) towers.push({ x: lx, z: lz, w: 2, d: 2, h: 18, y: h * 1.35, color: 0x333333, style: 4 });
        }
      } else if (dist === 'heights') {
        // Rows of houses facing the street with lawns and trees.
        const cols = [0xc9b9a0, 0xa7896a, 0xd8cdb5, 0x9b7d62, 0xb8a58a, 0x8e9a8c, 0xcfb08a];
        const campus = (i + j) % 5 === 0;
        if (campus) {
          addBox(towers, cx, cz, 90, 60, 16 + r() * 8, 0x9a5e44, { style: 1 });
          for (let k = 0; k < 10; k++) addTree(x0 + 8 + r() * (x1 - x0 - 16), r() < 0.5 ? z0 + 6 : z1 - 6, 1.2);
          continue;
        }
        const step = 25;
        for (let t = x0 + 14; t < x1 - 10; t += step) {
          for (const side of [-1, 1]) {
            const hz = side < 0 ? z0 + 16 : z1 - 16, w = 14 + r() * 4, d = 12 + r() * 3, h = 5 + r() * 3;
            const col = pick(r, cols);
            addBox(houses, t, hz, w, d, h, col, { style: 2 });
            roofs.push({ x: t, z: hz, w: w + 1, d: d + 1, y: h, h: 3 + r() * 1.5, kind: 'gable', color: pick(r, [0x5a3b2e, 0x4a4440, 0x6d4030, 0x3d3a3a]) });
            if (r() < 0.8) addTree(t + step / 2, side < 0 ? z0 + 3 : z1 - 3, 0.9 + r() * 0.5);
          }
        }
        for (let k = 0; k < 5; k++) addTree(x0 + 6 + r() * (x1 - x0 - 12), cz + (r() - 0.5) * 20, 1 + r() * 0.6);
      } else {
        // Port: warehouses and container stacks.
        const colsW = [0x7a6a55, 0x6b7076, 0x8c5f45, 0x5f6a5c, 0x8b8070];
        const w1 = 50 + r() * 20, d1 = 70 + r() * 30;
        addBox(warehouses, x0 + w1 / 2 + 4, cz, w1, d1, 11 + r() * 8, pick(r, colsW), { style: 3 });
        const ccol = [0xa8452f, 0x2f5e8c, 0x3f7a4a, 0xb08a2a, 0x7a3a6a, 0x9a9a92];
        for (let row = 0; row < 4; row++) for (let k = 0; k < 6; k++) {
          if (r() < 0.2) continue;
          const sx = x1 - 12 - row * 7, sz = z0 + 12 + k * 21;
          const stack = 1 + Math.floor(r() * 3);
          containers.push({ x: sx, z: sz, w: 2.6, d: 12, h: 2.6 * stack, color: pick(r, ccol), stack, style: 4 });
          blk.boxes.push({ x0: sx - 1.3, x1: sx + 1.3, z0: sz - 6, z1: sz + 6, h: 2.6 * stack });
        }
      }
    }
    // street furniture along every road segment: lamps, hydrants, bins
    const props = { lamps: [], hydrants: [], bins: [] };
    for (let i = 0; i < N; i++) for (let j = 0; j < N - 1; j++) for (let t = 38; t < SP - 30; t += 46) {
      props.lamps.push({ x: lineAt(i) + ROAD_W / 2 + 0.9, z: lineAt(j) + t, rot: -Math.PI / 2 });
      props.lamps.push({ x: lineAt(j) + t, z: lineAt(i) - ROAD_W / 2 - 0.9, rot: 0 });
      if (t < 60) {
        props.hydrants.push({ x: lineAt(i) - ROAD_W / 2 - 0.8, z: lineAt(j) + t + 9 });
        props.bins.push({ x: lineAt(j) + t + 14, z: lineAt(i) + ROAD_W / 2 + 0.9 });
      }
    }

    this.instBoxes(towers, facadeMaterial({ floorH: 3.8, colW: 3.1, density: 1, base: 4.6 }), true);
    this.instBoxes(houses, facadeMaterial({ floorH: 3.0, colW: 4.2, density: 0.6, base: 0.9 }), true);
    this.instBoxes(warehouses, facadeMaterial({ floorH: 7.0, colW: 8.0, density: 0.9, base: 5.6 }), true);
    this.instBoxes(containers, facadeMaterial({ density: 0, rough: 0.6 }), true);
    this.instRoofs(roofs);
    this.instTrees(trees);
    this.instPillars(pillars);
    this.instLamps(props.lamps);
    this.instSmallProps(props);
    this.buildRoofClutter(towers.filter((b) => b.style < 2), r);
    this.buildTrafficLights();
    this.buildBillboards(towers.filter((b) => b.style < 2 && !b.y && b.h < 70), r);
    this.buildCurbs();
    this.buildSkyline(r);
    this.buildPort(r);
    this.buildEdges(r);
    this.buildBreakers(r);
  }

  // Split instances into spatial chunks so frustum and shadow culling can skip them.
  chunked(list, geo, mat, place, { cast = true, receive = false, perGeo = null, size = SP * 3 } = {}) {
    const groups = new Map();
    for (const it of list) {
      const k = Math.floor((it.x + 4000) / size) * 1000 + Math.floor((it.z + 4000) / size);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
    const meshes = [];
    for (const items of groups.values()) {
      const mesh = new THREE.InstancedMesh(perGeo ? perGeo(items) : geo, mat, items.length);
      items.forEach((it, k) => place(mesh, it, k));
      mesh.computeBoundingSphere();
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      this.group.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }
  instBoxes(list, mat, shadows, size = SP * 3) {
    if (!list.length) return [];
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    return this.chunked(list, null, mat, (mesh, b, k) => {
      m.makeScale(b.w, b.h, b.d).setPosition(b.x, b.y || 0, b.z);
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, c.setHex(b.color));
    }, {
      cast: shadows, receive: true, size,
      perGeo: (items) => {
        const g = box.clone();
        g.setAttribute('aStyle', new THREE.InstancedBufferAttribute(Float32Array.from(items, (b) => b.style ?? 1), 1));
        return g;
      },
    });
  }
  instRoofs(list) {
    const gables = list.filter((r) => r.kind === 'gable'), slabs = list.filter((r) => r.kind === 'slab');
    const shape = new THREE.Shape([new THREE.Vector2(-0.5, 0), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, 1)]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
    g.translate(0, 0, -0.5);
    const tiles = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const x = c.getContext('2d');
      x.fillStyle = '#8a8a8a'; x.fillRect(0, 0, 256, 256);
      for (let row = 0; row < 16; row++) for (let k = 0; k < 9; k++) {
        const v = 110 + Math.random() * 60;
        x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(k * 30 + (row % 2) * 15, row * 16, 28, 14);
      }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const m = new THREE.Matrix4(), c = new THREE.Color();
    this.chunked(gables, g, new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.85 }), (mesh, r, k) => {
      m.makeScale(r.w, r.h, r.d).setPosition(r.x, r.y, r.z);
      mesh.setMatrixAt(k, m); mesh.setColorAt(k, c.setHex(r.color));
    }, { receive: true });
    const sm = new THREE.MeshStandardMaterial({ color: 0x77706a, roughness: 0.9 });
    for (const s of slabs) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(s.w, 0.8, s.d), sm);
      slab.position.set(s.x, 6.4, s.z);
      slab.castShadow = true; slab.receiveShadow = true;
      this.group.add(slab);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(14, 2.2, 0.4), new THREE.MeshStandardMaterial({ color: 0x1f5aa0, roughness: 0.5 }));
      sign.position.set(s.x, 8, s.z - s.d / 2);
      this.group.add(sign);
      const P = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 0.1), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }));
      P.position.set(s.x - 5.6, 8, s.z - s.d / 2 - 0.22);
      this.group.add(P);
    }
  }
  instTrees(list) {
    // trunk with two limbs, foliage as a cluster of lumpy spheres shaded darker underneath
    const trunk = mergeGeometries([
      new THREE.CylinderGeometry(0.16, 0.3, 3.4, 7).translate(0, 1.7, 0),
      new THREE.CylinderGeometry(0.07, 0.12, 1.8, 5).rotateZ(0.7).translate(0.55, 3.4, 0),
      new THREE.CylinderGeometry(0.07, 0.12, 1.6, 5).rotateZ(-0.8).rotateY(1.8).translate(-0.2, 3.3, 0.45),
    ]);
    const blobs = [];
    const spots = [[0, 5.0, 0, 2.2], [1.25, 4.4, 0.35, 1.6], [-1.05, 4.5, 0.6, 1.6], [0.1, 4.4, -1.2, 1.6]];
    for (const [x, y, z, rad] of spots) {
      const g = new THREE.IcosahedronGeometry(rad, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = 1 + (Math.sin(p.getX(i) * 7.1 + p.getY(i) * 3.3) * Math.cos(p.getZ(i) * 5.7)) * 0.13;
        p.setXYZ(i, p.getX(i) * k + x, p.getY(i) * k * 0.86 + y, p.getZ(i) * k + z);
      }
      blobs.push(g);
    }
    const leafG = mergeGeometries(blobs);
    leafG.computeVertexNormals();
    const lp = leafG.attributes.position, col = new Float32Array(lp.count * 3);
    for (let i = 0; i < lp.count; i++) {
      const ao = 0.55 + 0.45 * Math.min(1, Math.max(0, (lp.getY(i) - 3.4) / 3.2));
      const v = ao * (0.9 + Math.random() * 0.2);
      col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v;
    }
    leafG.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), at = new THREE.Vector3();
    const xf = (t) => { q.setFromAxisAngle(up, t.x * 13.1 + t.z); return m.compose(at.set(t.x, CURB_H, t.z), q, sc.set(t.s, t.s * (0.9 + 0.2 * Math.abs(Math.sin(t.x))), t.s)); };
    this.chunked(list, trunk, new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.95 }), (mesh, t, k) => mesh.setMatrixAt(k, xf(t)));
    this.chunked(list, leafG, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.92, flatShading: true }), (mesh, t, k) => {
      mesh.setMatrixAt(k, xf(t));
      mesh.setColorAt(k, c.setHSL(0.17 + Math.sin(t.z * 0.7) * 0.05, 0.42 + Math.cos(t.x) * 0.1, 0.27 + Math.cos(t.x * 1.3) * 0.05));
    }, { receive: true });
  }
  instPillars(list) {
    const g = new THREE.BoxGeometry(1.2, 6, 1.2); g.translate(0, 3, 0);
    const mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: 0x8a8278, roughness: 0.9 }), list.length);
    const m = new THREE.Matrix4();
    list.forEach((p, k) => { m.makeTranslation(p.x, 0, p.z); mesh.setMatrixAt(k, m); });
    mesh.castShadow = true;
    this.group.add(mesh);
  }
  instLamps(list) {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 8.4, 0), new THREE.Vector3(0, 9.4, 0.4), new THREE.Vector3(0, 9.3, 2.8));
    const geo = mergeGeometries([
      vc(new THREE.CylinderGeometry(0.09, 0.16, 8.6, 8).translate(0, 4.3, 0), 0x35363a),
      vc(new THREE.CylinderGeometry(0.22, 0.26, 0.6, 8).translate(0, 0.3, 0), 0x2c2d30),
      vc(new THREE.TubeGeometry(curve, 8, 0.07, 6), 0x35363a),
      vc(new THREE.BoxGeometry(0.45, 0.18, 0.95).translate(0, 9.2, 3.0), 0x2a2b2e),
      vc(new THREE.BoxGeometry(0.34, 0.03, 0.75).translate(0, 9.1, 3.0), 0xe8e2cc),
    ]);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3();
    this.chunked(list, geo, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.45 }), (mesh, l, k) => {
      q.setFromAxisAngle(up, l.rot); mesh.setMatrixAt(k, m.compose(at.set(l.x, CURB_H, l.z), q, one));
    });
  }
  instSmallProps(props) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
    const hyd = mergeGeometries([
      vc(new THREE.CylinderGeometry(0.17, 0.2, 0.7, 8).translate(0, 0.35, 0), 0xa82418),
      vc(new THREE.SphereGeometry(0.18, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.7, 0), 0xa82418),
      vc(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 6).rotateZ(Math.PI / 2).translate(0, 0.48, 0), 0xb8b0a0),
    ]);
    const bin = mergeGeometries([
      vc(new THREE.CylinderGeometry(0.32, 0.28, 1.0, 10).translate(0, 0.5, 0), 0x2e4a34),
      vc(new THREE.CylinderGeometry(0.35, 0.35, 0.08, 10).translate(0, 1.03, 0), 0x1f2f22),
    ]);
    const m = new THREE.Matrix4();
    for (const [g, list] of [[hyd, props.hydrants], [bin, props.bins]]) this.chunked(list, g, mat, (mesh, p, k) => mesh.setMatrixAt(k, m.makeTranslation(p.x, CURB_H, p.z)));
  }
  buildRoofClutter(list, r) {
    const ac = [], tanks = [];
    for (const b of list) {
      if (b.w < 8 || b.d < 8) continue;
      const top = (b.y || 0) + b.h;
      const n = 1 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) ac.push({ x: b.x + (r() - 0.5) * (b.w - 6), z: b.z + (r() - 0.5) * (b.d - 6), y: top, w: 2 + r() * 3, d: 2 + r() * 3, h: 1 + r() * 1.5 });
      if (r() < 0.3 && b.h < 80) tanks.push({ x: b.x + (r() - 0.5) * (b.w - 8), z: b.z + (r() - 0.5) * (b.d - 8), y: top });
    }
    const boxG = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(boxG, new THREE.MeshStandardMaterial({ color: 0x8e8a84, roughness: 0.6, metalness: 0.4 }), ac.length);
    const m = new THREE.Matrix4();
    ac.forEach((a, k) => { m.makeScale(a.w, a.h, a.d).setPosition(a.x, a.y, a.z); mesh.setMatrixAt(k, m); });
    mesh.castShadow = true;
    const tankG = mergeGeometries([
      vc(new THREE.CylinderGeometry(2.2, 2.2, 4, 12).translate(0, 5, 0), 0x6a5038),
      vc(new THREE.ConeGeometry(2.4, 1.4, 12).translate(0, 7.7, 0), 0x3a3430),
      ...[[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]].map(([x, z]) => vc(new THREE.BoxGeometry(0.2, 3, 0.2).translate(x, 1.5, z), 0x2a2622)),
    ]);
    const tm = new THREE.InstancedMesh(tankG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), tanks.length);
    tanks.forEach((t, k) => { m.makeTranslation(t.x, t.y, t.z); tm.setMatrixAt(k, m); });
    tm.castShadow = true;
    this.group.add(mesh, tm);
  }
  buildTrafficLights() {
    // mast-arm signals on four corners of each intersection, heads over the approaching lanes
    const head = (x) => [
      vc(new THREE.BoxGeometry(0.42, 1.15, 0.32).translate(x, 5.7, 0.05), 0x1c1c1a),
      vc(new THREE.BoxGeometry(0.6, 1.4, 0.04).translate(x, 5.7, -0.12), 0x111111),
      vc(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 10).rotateX(Math.PI / 2).translate(x, 6.06, 0.22), 0x4a1410),
      vc(new THREE.CylinderGeometry(0.12, 0.12, 0.04, 10).rotateX(Math.PI / 2).translate(x, 5.7, 0.22), 0x4a3a10),
    ];
    const geo = mergeGeometries([
      vc(new THREE.CylinderGeometry(0.12, 0.17, 6.6, 8).translate(0, 3.3, 0), 0x3a3b36),
      vc(new THREE.CylinderGeometry(0.07, 0.1, 11.6, 6).rotateZ(Math.PI / 2).translate(-5.8, 6.4, 0), 0x3a3b36),
      ...head(-5.25), ...head(-10.75),
      vc(new THREE.BoxGeometry(0.3, 0.45, 0.2).translate(0, 2.6, 0.17), 0x262626),
    ]);
    const lit = mergeGeometries([-5.25, -10.75].map((x) => new THREE.CylinderGeometry(0.12, 0.12, 0.04, 10).rotateX(Math.PI / 2).translate(x, 5.34, 0.22)));
    const spots = [];
    const c = ROAD_W / 2 + 2.6;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x = lineAt(i), z = lineAt(j);
      for (const [dx, dz, rot] of [[c, c, 0], [-c, -c, Math.PI], [c, -c, Math.PI / 2], [-c, c, -Math.PI / 2]]) {
        if (Math.abs(x + dx) > BOUND - 2 || Math.abs(z + dz) > BOUND - 2) continue;
        spots.push({ x: x + dx, z: z + dz, rot });
      }
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), at = new THREE.Vector3();
    const place = (mesh, s, k) => { q.setFromAxisAngle(up, s.rot); mesh.setMatrixAt(k, m.compose(at.set(s.x, CURB_H, s.z), q, one)); };
    this.chunked(spots, geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.4 }), place);
    this.chunked(spots, lit, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 2.4, 0.9), toneMapped: false }), place, { cast: false });
  }
  buildBillboards(list, r) {
    const byAd = new Map();
    for (let k = 0; k < list.length; k++) {
      if (r() > 0.22) continue;
      const b = list[k], ad = Math.floor(r() * 6), face = Math.floor(r() * 4);
      if (!byAd.has(ad)) byAd.set(ad, []);
      byAd.get(ad).push({ x: b.x, z: b.z, y: b.h, rot: (face * Math.PI) / 2 });
    }
    const board = new THREE.PlaneGeometry(14, 7).translate(0, 7.5, 0);
    const frame = mergeGeometries([
      new THREE.BoxGeometry(14.6, 7.6, 0.3).translate(0, 7.5, -0.2),
      new THREE.BoxGeometry(0.3, 4, 0.3).translate(-5, 2, -0.6), new THREE.BoxGeometry(0.3, 4, 0.3).translate(5, 2, -0.6),
      new THREE.BoxGeometry(14, 0.2, 1).translate(0, 3.7, 0.2),
    ]);
    const fm = new THREE.InstancedMesh(frame, new THREE.MeshStandardMaterial({ color: 0x3a3836, roughness: 0.7, metalness: 0.5 }), list.length);
    let n = 0;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    for (const [ad, spots] of byAd) {
      const mesh = new THREE.InstancedMesh(board, new THREE.MeshStandardMaterial({ map: billboardTexture(ad), roughness: 0.6, emissive: 0x222222, emissiveIntensity: 0.4 }), spots.length);
      spots.forEach((s, k) => {
        q.setFromAxisAngle(up, s.rot); m.compose(new THREE.Vector3(s.x, s.y, s.z), q, one);
        mesh.setMatrixAt(k, m); fm.setMatrixAt(n++, m);
      });
      mesh.castShadow = true;
      this.group.add(mesh);
    }
    fm.count = n;
    fm.castShadow = true;
    this.group.add(fm);
  }
  buildCurbs() {
    // concrete kerb faces around every block so the raised sidewalks read as kerbs
    const parts = [];
    const t = 0.32;
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
      const x0 = lineAt(i) + ROAD_W / 2, x1 = lineAt(i + 1) - ROAD_W / 2, z0 = lineAt(j) + ROAD_W / 2, z1 = lineAt(j + 1) - ROAD_W / 2;
      const L = x1 - x0, y = CURB_H / 2 + 0.002;
      parts.push(new THREE.BoxGeometry(L, CURB_H + 0.004, t).translate((x0 + x1) / 2, y, z0 + t / 2));
      parts.push(new THREE.BoxGeometry(L, CURB_H + 0.004, t).translate((x0 + x1) / 2, y, z1 - t / 2));
      parts.push(new THREE.BoxGeometry(t, CURB_H + 0.004, L).translate(x0 + t / 2, y, (z0 + z1) / 2));
      parts.push(new THREE.BoxGeometry(t, CURB_H + 0.004, L).translate(x1 - t / 2, y, (z0 + z1) / 2));
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: 0xb4ab9c, roughness: 0.85 }));
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }
  buildSkyline(r) {
    // dense outer city beyond the limits, hazed by fog, so the horizon isn't empty
    const list = [];
    for (let k = 0; k < 520; k++) {
      const a = r() * Math.PI * 2;
      if (Math.cos(a) < -0.5) continue; // sea to the west
      const d = BOUND + 70 + Math.pow(r(), 0.7) * 900;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.abs(x) < BOUND + 50 && Math.abs(z) < BOUND + 50) continue;
      const tall = Math.max(0, 1 - Math.hypot(x - 1300, z + 900) / 1200);
      list.push({ x, z, w: 25 + r() * 35, d: 25 + r() * 35, h: 15 + r() * 40 + tall * r() * 200, color: pick(r, [0x8a8178, 0x6d6a66, 0x9c8f7c, 0x5c6066, 0x7b7266]), style: r() < 0.5 ? 0 : 1 });
    }
    for (const mesh of this.instBoxes(list, facadeMaterial({ floorH: 3.8, colW: 3.1, density: 1, base: 4.6 }), false, 700)) mesh.receiveShadow = false;
  }

  buildGround() {
    const base = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), new THREE.MeshStandardMaterial({ color: 0x4a4339, roughness: 1 }));
    base.rotation.x = -Math.PI / 2; base.position.y = -0.05; base.receiveShadow = true;
    this.group.add(base);
    // Raised sidewalks + block interiors as merged quads per material.
    const walk = sidewalkTextures();
    const mats = {
      walk: new THREE.MeshStandardMaterial({ map: walk.map, normalMap: walk.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.88 }),
      grass: new THREE.MeshStandardMaterial({ map: groundTexture('grass'), roughness: 0.95 }),
      gravel: new THREE.MeshStandardMaterial({ map: groundTexture('gravel'), roughness: 0.95 }),
      concrete: new THREE.MeshStandardMaterial({ map: groundTexture('concrete'), roughness: 0.9 }),
    };
    const quads = { walk: [], grass: [], gravel: [], concrete: [] };
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
      const x0 = lineAt(i) + ROAD_W / 2, x1 = lineAt(i + 1) - ROAD_W / 2;
      const z0 = lineAt(j) + ROAD_W / 2, z1 = lineAt(j + 1) - ROAD_W / 2;
      quads.walk.push([x0, z0, x1, z1, CURB_H, 0.25]);
      const blk = this.blocks[i * (N - 1) + j];
      const d = districtOf((x0 + x1) / 2, (z0 + z1) / 2);
      const kind = blk && blk.kind === 'park' ? 'grass' : d === 'heights' ? 'grass' : d === 'port' ? 'gravel' : 'concrete';
      quads[kind].push([x0 + WALK, z0 + WALK, x1 - WALK, z1 - WALK, CURB_H + 0.01, kind === 'grass' ? 0.12 : 0.08]);
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
    const rt = roadTextures(ROAD_W, LANE_IN, LANE_OUT);
    const roads = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: rt.map, normalMap: rt.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.82, metalness: 0.0 }));
    roads.receiveShadow = true;
    const inter = new THREE.Mesh(quadGeo(xs), new THREE.MeshStandardMaterial({ map: intersectionTexture(ROAD_W), normalMap: rt.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.82 }));
    inter.receiveShadow = true;
    inter.material.polygonOffset = true; inter.material.polygonOffsetFactor = -0.5; inter.material.polygonOffsetUnits = -0.5;
    this.group.add(roads, inter);
  }

  buildPort(r) {
    // Water beyond the western edge, cranes on the quay.
    const wn = (() => {
      const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
      const g = c.getContext('2d'), img = g.createImageData(S, S);
      const H = (x, y) => Math.sin(x * 0.098 + Math.sin(y * 0.05) * 2) * 0.5 + Math.sin(y * 0.123 + x * 0.031) * 0.35 + Math.sin((x + y) * 0.21) * 0.15;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const dx = H(x + 1, y) - H(x - 1, y), dy = H(x, y + 1) - H(x, y - 1), l = Math.hypot(dx, dy, 0.6), i = (y * S + x) * 4;
        img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (0.6 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(60, 120);
      return t;
    })();
    this.waterNormal = wn;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(3000, 6000, 1, 1), new THREE.MeshStandardMaterial({ color: 0x1f2c2c, roughness: 0.12, metalness: 0.2, normalMap: wn, normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 1.6 }));
    water.rotation.x = -Math.PI / 2; water.position.set(-BOUND - 1500 - 10, -1.2, 0);
    this.group.add(water);
    const quay = new THREE.Mesh(new THREE.BoxGeometry(14, 2, BOUND * 2 + 30), new THREE.MeshStandardMaterial({ roughness: 0.85, color: 0x77706a }));
    quay.position.set(-BOUND - 4, -0.95, 0);
    this.group.add(quay);
    const yellow = new THREE.MeshStandardMaterial({ roughness: 0.85, color: 0xc9902a }), dark = new THREE.MeshStandardMaterial({ roughness: 0.85, color: 0x3b3835 });
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
      const ship = new THREE.Mesh(new THREE.BoxGeometry(40, 14, 220), new THREE.MeshStandardMaterial({ roughness: 0.85, color: [0x6b2f25, 0x2c3e4f, 0x3c4a3a][k] }));
      ship.position.set(-BOUND - 60, 4, -600 + k * 600);
      this.group.add(ship);
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(30, 16, 18), new THREE.MeshStandardMaterial({ roughness: 0.85, color: 0xd8d0c0 }));
      bridge.position.set(-BOUND - 60, 19, -600 + k * 600 - 90);
      this.group.add(bridge);
    }
  }

  buildEdges(r) {
    // Jersey barriers along the north, south and east limits; quay rail on the west.
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, color: 0xb3aa9a });
    const L = BOUND * 2 + 6;
    for (const [x, z, w, d] of [[0, -BOUND - 0.6, L, 1.2], [0, BOUND + 0.6, L, 1.2], [BOUND + 0.6, 0, 1.2, L], [-BOUND - 0.6, 0, 1.2, L]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), mat);
      m.position.set(x, 0.55, z); m.receiveShadow = true;
      this.group.add(m);
    }
    // Distant hills to frame the horizon.
    const hillMat = new THREE.MeshStandardMaterial({ roughness: 0.85, color: 0x6b6040, flatShading: true });
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
    const legMat = new THREE.MeshStandardMaterial({ roughness: 0.85, color: 0x5a4a3a }), tankMat = new THREE.MeshStandardMaterial({ roughness: 0.85, color: 0x8a6a48 });
    const signMat = new THREE.MeshStandardMaterial({ roughness: 0.85, color: 0xc8402a });
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
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.7, 6, 16), new THREE.MeshStandardMaterial({ roughness: 0.85, color: 0xf0d080 }));
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

  updateWater(t) { if (this.waterNormal) this.waterNormal.offset.set(t * 0.004, t * 0.009); }

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

// Give a geometry a flat vertex colour so parts can be merged into one mesh.
function vc(g, hex) {
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
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
