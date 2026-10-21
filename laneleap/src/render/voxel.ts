/**
 * Voxel model builder: accumulates axis-aligned boxes and merges them into one
 * BufferGeometry whose UVs point at palette-atlas swatches.
 */
import * as THREE from 'three';
import type { PaletteAtlas, EnvKey } from './atlas';

interface Box {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  c: number;
}

export type ColorRef = string | { env: EnvKey };

// Face definitions: normal + 4 corners (unit cube, counter-clockwise from outside).
const FACES: { n: [number, number, number]; v: [number, number, number][] }[] = [
  {
    n: [1, 0, 0],
    v: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  {
    n: [-1, 0, 0],
    v: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  {
    n: [0, 1, 0],
    v: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    n: [0, -1, 0],
    v: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    n: [0, 0, 1],
    v: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    n: [0, 0, -1],
    v: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
];

export class VoxelBuilder {
  private boxes: Box[] = [];
  /** Colours used, for particle bursts in the model's own palette. */
  readonly colors: string[] = [];

  constructor(private readonly atlas: PaletteAtlas) {}

  private resolve(c: ColorRef): number {
    if (typeof c === 'string') {
      if (!this.colors.includes(c)) this.colors.push(c);
      return this.atlas.swatch(c);
    }
    return this.atlas.env(c.env);
  }

  /** Add a box by min corner and size (in arbitrary units, scaled at build time). */
  box(x: number, y: number, z: number, w: number, h: number, d: number, c: ColorRef): this {
    if (w > 0 && h > 0 && d > 0) this.boxes.push({ x, y, z, w, h, d, c: this.resolve(c) });
    return this;
  }

  /** Add a box centred on x/z with its base at y. */
  cbox(cx: number, y: number, cz: number, w: number, h: number, d: number, c: ColorRef): this {
    return this.box(cx - w / 2, y, cz - d / 2, w, h, d, c);
  }

  /** Mirror-pair helper: adds the box and its reflection across x = 0 (centred coords). */
  pair(cx: number, y: number, cz: number, w: number, h: number, d: number, c: ColorRef): this {
    this.cbox(cx, y, cz, w, h, d, c);
    return this.cbox(-cx, y, cz, w, h, d, c);
  }

  get count(): number {
    return this.boxes.length;
  }

  /**
   * Merge into a geometry. `scale` converts builder units to world units.
   * Coordinates are used as-is (centre your model while building).
   */
  build(scale = 1): THREE.BufferGeometry {
    const n = this.boxes.length;
    const pos = new Float32Array(n * 24 * 3);
    const nor = new Float32Array(n * 24 * 3);
    const uv = new Float32Array(n * 24 * 2);
    const idx = n * 24 > 65535 ? new Uint32Array(n * 36) : new Uint16Array(n * 36);
    const tmp: [number, number] = [0, 0];
    let vp = 0;
    let ip = 0;
    let vi = 0;
    for (const b of this.boxes) {
      this.atlas.uv(b.c, tmp);
      for (const f of FACES) {
        for (const corner of f.v) {
          pos[vp * 3] = (b.x + corner[0] * b.w) * scale;
          pos[vp * 3 + 1] = (b.y + corner[1] * b.h) * scale;
          pos[vp * 3 + 2] = (b.z + corner[2] * b.d) * scale;
          nor[vp * 3] = f.n[0];
          nor[vp * 3 + 1] = f.n[1];
          nor[vp * 3 + 2] = f.n[2];
          uv[vp * 2] = tmp[0];
          uv[vp * 2 + 1] = tmp[1];
          vp++;
        }
        idx[ip++] = vi;
        idx[ip++] = vi + 1;
        idx[ip++] = vi + 2;
        idx[ip++] = vi;
        idx[ip++] = vi + 2;
        idx[ip++] = vi + 3;
        vi += 4;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
