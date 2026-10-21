/**
 * A tiny palette texture atlas. Every voxel model in the game samples this one
 * texture (one texel per colour), so all props, vehicles and characters share a
 * single material. The first ENV_KEYS.length swatches are "environment slots":
 * themed worlds recolour them in place and every model updates instantly.
 */
import * as THREE from 'three';

export const ATLAS_SIZE = 32;

export const ENV_KEYS = [
  'trunk',
  'trunkDark',
  'leaf1',
  'leaf2',
  'leaf3',
  'rock',
  'rockDark',
  'bush',
  'bushDark',
  'berry',
  'log',
  'logEnd',
  'logDark',
  'lily',
  'lilyDark',
  'lilyFlower',
  'car0',
  'car1',
  'car2',
  'truck0',
  'truck1',
  'cargo',
  'window',
  'wheel',
  'trim',
  'headlight',
  'train',
  'trainStripe',
  'trainDark',
  'rail',
  'sleeper',
  'roadLine',
  'post',
  'coin',
  'coinDark',
  'predator',
  'predatorDark',
  'predatorAccent',
  'predatorEye',
  'snow',
  'white',
  'black',
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];

export class PaletteAtlas {
  readonly texture: THREE.CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dynamic = new Map<string, number>();
  private nextDynamic = ENV_KEYS.length;

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = ATLAS_SIZE;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.fillStyle = '#ff00ff';
    this.ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  env(key: EnvKey): number {
    return ENV_KEYS.indexOf(key);
  }

  setEnv(colors: Partial<Record<EnvKey, string>>): void {
    for (const k in colors) {
      const hex = colors[k as EnvKey];
      if (hex) this.paint(this.env(k as EnvKey), hex);
    }
    this.texture.needsUpdate = true;
  }

  /** Swatch index for an arbitrary colour (allocated on first use). */
  swatch(hex: string): number {
    const key = hex.toLowerCase();
    const existing = this.dynamic.get(key);
    if (existing !== undefined) return existing;
    if (this.nextDynamic >= ATLAS_SIZE * ATLAS_SIZE) return this.env('white');
    const idx = this.nextDynamic++;
    this.dynamic.set(key, idx);
    this.paint(idx, key);
    this.texture.needsUpdate = true;
    return idx;
  }

  /** UV of a swatch centre. CanvasTexture flips Y, so row 0 is at v = 1. */
  uv(index: number, out: [number, number]): [number, number] {
    const x = index % ATLAS_SIZE;
    const y = Math.floor(index / ATLAS_SIZE);
    out[0] = (x + 0.5) / ATLAS_SIZE;
    out[1] = 1 - (y + 0.5) / ATLAS_SIZE;
    return out;
  }

  private paint(index: number, hex: string): void {
    this.ctx.fillStyle = hex;
    this.ctx.fillRect(index % ATLAS_SIZE, Math.floor(index / ATLAS_SIZE), 1, 1);
  }

  dispose(): void {
    this.texture.dispose();
  }
}
