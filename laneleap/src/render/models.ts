/**
 * Voxel models for the environment. All geometry is authored in tenth-of-a-tile
 * units and shares the palette atlas, so it renders with one material.
 * Shapes depend on the active world theme; colours come from palette slots.
 */
import * as THREE from 'three';
import type { PaletteAtlas, EnvKey } from './atlas';
import { VoxelBuilder } from './voxel';
import type { WorldTheme } from '../world/worlds';
import { VISUAL_HALF_WIDTH } from '../core/constants';

const U = 0.1;
const e = (env: EnvKey) => ({ env });

export interface EnvModels {
  treeTall: THREE.BufferGeometry;
  treeShort: THREE.BufferGeometry;
  rock: THREE.BufferGeometry;
  bush: THREE.BufferGeometry;
  vehicles: THREE.BufferGeometry[];
  logs: THREE.BufferGeometry[]; // index = length (2..4)
  lily: THREE.BufferGeometry[];
  locomotive: THREE.BufferGeometry;
  carriage: THREE.BufferGeometry;
  coin: THREE.BufferGeometry;
  track: THREE.BufferGeometry;
  dashes: THREE.BufferGeometry;
  post: THREE.BufferGeometry;
  bulb: THREE.BufferGeometry;
}

export function buildEnvModels(atlas: PaletteAtlas, theme: WorldTheme): EnvModels {
  const vb = () => new VoxelBuilder(atlas);
  return {
    treeTall: tree(vb(), theme, true).build(U),
    treeShort: tree(vb(), theme, false).build(U),
    rock: rock(vb(), theme).build(U),
    bush: bush(vb(), theme).build(U),
    vehicles: [0, 1, 2, 3, 4].map((v) => vehicle(vb(), v).build(U)),
    logs: [0, 1, 2, 3, 4, 5].map((len) => platform(vb(), theme, Math.max(1, len)).build(U)),
    lily: [lily(vb(), false).build(U), lily(vb(), true).build(U)],
    locomotive: locomotive(vb()).build(U),
    carriage: carriage(vb()).build(U),
    coin: coin(vb()).build(U),
    track: track(vb()).build(U),
    dashes: dashes(vb()).build(U),
    post: post(vb()).build(U),
    bulb: new VoxelBuilder(atlas).cbox(0, -0.8, 0, 1.6, 1.6, 1.6, e('white')).build(U),
  };
}

export function disposeEnvModels(m: EnvModels): void {
  for (const v of Object.values(m)) {
    if (Array.isArray(v)) v.forEach((g) => g.dispose());
    else (v as THREE.BufferGeometry).dispose();
  }
}

function tree(b: VoxelBuilder, theme: WorldTheme, tall: boolean): VoxelBuilder {
  switch (theme.tree) {
    case 'round': {
      const t = tall ? 9 : 5;
      b.cbox(0, 0, 0, 4, t, 4, e('trunk'));
      b.cbox(0, t, 0, 8, tall ? 9 : 6, 8, e('leaf1'));
      b.cbox(0, t + (tall ? 3 : 2), 0, 8.4, 2, 8.4, e('leaf2'));
      b.cbox(0, t + (tall ? 9 : 6), 0, 5, 2, 5, e('leaf1'));
      break;
    }
    case 'pine': {
      b.cbox(0, 0, 0, 3, 4, 3, e('trunk'));
      const tiers = tall ? 5 : 3;
      for (let i = 0; i < tiers; i++) {
        const w = 9 - i * (tall ? 1.6 : 2.2);
        const y = 4 + i * 3;
        b.cbox(0, y, 0, w, 3, w, e(i % 2 ? 'leaf2' : 'leaf1'));
        b.cbox(0, y + 2.5, 0, w - 1.6, 0.8, w - 1.6, e('snow'));
      }
      break;
    }
    case 'cactus': {
      const h = tall ? 13 : 8;
      b.cbox(0, 0, 0, 4, h, 4, e('leaf1'));
      b.cbox(0, 0, 0, 4.2, 1, 4.2, e('leaf3'));
      b.cbox(3, 5, 0, 2.5, 2, 2.5, e('leaf2')).cbox(4, 5, 0, 2, 5, 2, e('leaf1'));
      if (tall) b.cbox(-3, 7, 0, 2.5, 2, 2.5, e('leaf2')).cbox(-4, 7, 0, 2, 4, 2, e('leaf1'));
      b.cbox(0, h, 0, 2, 1.2, 2, e('berry'));
      break;
    }
    case 'lollipop': {
      const h = tall ? 11 : 7;
      b.cbox(0, 0, 0, 1.6, h, 1.6, e('trunk'));
      const r = tall ? 9 : 7;
      b.cbox(0, h - 1, 0, r, r, 2.4, e('leaf1'));
      b.cbox(0, h + 1, 0, r - 4, r - 4, 2.8, e('leaf3'));
      b.cbox(0, h + 2.4, 0, r - 7, r - 7, 3, e('leaf2'));
      break;
    }
    case 'tower': {
      const h = tall ? 18 : 10;
      b.cbox(0, 0, 0, 5, h, 5, e('trunk'));
      for (let y = 3; y < h - 1; y += 4) b.cbox(0, y, 0, 5.4, 1, 5.4, e(y % 8 === 3 ? 'leaf1' : 'leaf2'));
      b.cbox(0, h, 0, 1, 3, 1, e('trunkDark')).cbox(0, h + 3, 0, 1.6, 1.6, 1.6, e('leaf3'));
      break;
    }
  }
  return b;
}

function rock(b: VoxelBuilder, theme: WorldTheme): VoxelBuilder {
  switch (theme.rock) {
    case 'boulder':
      b.cbox(0, 0, 0, 7.5, 4, 6.5, e('rock'));
      b.cbox(-0.5, 4, 0.3, 5, 2.4, 4.5, e('rock'));
      b.cbox(0, 0, 0, 8, 1, 7, e('rockDark'));
      break;
    case 'ice':
      b.cbox(0, 0, 0, 7, 6, 7, e('rock'));
      b.cbox(1, 6, -1, 4, 2, 4, e('rockDark'));
      b.cbox(-2, 1, 3.6, 2, 4, 0.4, e('white'));
      break;
    case 'crystal':
      b.cbox(0, 0, 0, 3, 9, 3, e('rock'));
      b.cbox(2.5, 0, 1.5, 2.4, 6, 2.4, e('rockDark'));
      b.cbox(-2.4, 0, -1, 2, 5, 2, e('leaf2'));
      break;
    case 'candy':
      b.cbox(0, 0, 0, 7, 5, 7, e('rock'));
      b.cbox(0, 1.5, 0, 7.4, 1, 7.4, e('white'));
      b.cbox(0, 3.5, 0, 7.4, 1, 7.4, e('white'));
      break;
  }
  return b;
}

function bush(b: VoxelBuilder, theme: WorldTheme): VoxelBuilder {
  switch (theme.bush) {
    case 'shrub':
      b.cbox(0, 0, 0, 8, 5, 8, e('bush'));
      b.cbox(0, 5, 0, 5.5, 2, 5.5, e('bushDark'));
      b.cbox(2.5, 3, 4, 1.2, 1.2, 0.6, e('berry')).cbox(-2, 4, 4, 1.2, 1.2, 0.6, e('berry'));
      break;
    case 'drift':
      b.cbox(0, 0, 0, 9, 3, 8, e('bush'));
      b.cbox(-1, 3, 0, 6, 2, 5, e('bushDark'));
      break;
    case 'tumble':
      b.cbox(0, 0.5, 0, 7, 6, 7, e('bush'));
      b.cbox(0, 2, 0, 7.6, 2, 5, e('bushDark'));
      b.cbox(0, 1, 0, 5, 5, 7.6, e('bushDark'));
      break;
    case 'gumdrop':
      b.cbox(0, 0, 0, 7, 5, 7, e('bush'));
      b.cbox(0, 5, 0, 5, 2, 5, e('bush'));
      b.cbox(0, 0, 0, 7.4, 1, 7.4, e('bushDark'));
      break;
    case 'hydrant':
      b.cbox(0, 0, 0, 4, 7, 4, e('bush'));
      b.cbox(0, 7, 0, 3, 2, 3, e('bushDark'));
      b.cbox(0, 4, 0, 6, 1.5, 2, e('bushDark'));
      break;
  }
  return b;
}

/** Vehicles are authored facing +x, centred on the origin. */
function vehicle(b: VoxelBuilder, v: number): VoxelBuilder {
  const wheel = e('wheel');
  if (v < 3) {
    const body = e((['car0', 'car1', 'car2'] as const)[v]);
    const L = 15;
    b.cbox(0, 1.5, 0, L, 4, 8, body);
    if (v === 2) {
      // Pickup: cab forward, open bed behind.
      b.cbox(2, 5.5, 0, 6, 3.5, 7, e('window'));
      b.cbox(2, 9, 0, 6, 1, 7, body);
      b.cbox(-4, 5.5, 3.5, 6, 1.5, 1, body).cbox(-4, 5.5, -3.5, 6, 1.5, 1, body);
    } else {
      const cab = v === 0 ? 8 : 10;
      b.cbox(-0.5, 5.5, 0, cab, 3.5, 7, e('window'));
      b.cbox(-0.5, 9, 0, cab, 1, 7, body);
      b.cbox(-0.5, 5.5, 0, 1, 3.5, 7.2, body);
    }
    b.cbox(L / 2 - 0.2, 3, 2.5, 0.6, 1.4, 1.6, e('headlight'));
    b.cbox(L / 2 - 0.2, 3, -2.5, 0.6, 1.4, 1.6, e('headlight'));
    b.cbox(-L / 2 + 0.2, 3, 2.5, 0.6, 1.2, 1.6, e('berry'));
    b.cbox(-L / 2 + 0.2, 3, -2.5, 0.6, 1.2, 1.6, e('berry'));
    b.cbox(0, 1.5, 0, L + 0.4, 1, 8.2, e('trim'));
    for (const x of [-4.5, 4.5]) for (const z of [-4, 4]) b.cbox(x, 0, z, 3, 3, 1.4, wheel);
  } else {
    const cab = e(v === 3 ? 'truck0' : 'truck1');
    const L = 27;
    b.cbox(L / 2 - 4, 1.5, 0, 8, 8.5, 9, cab);
    b.cbox(L / 2 - 1.5, 6, 0, 3, 3, 8, e('window'));
    b.cbox(L / 2 - 0.2, 3, 3, 0.6, 1.4, 1.6, e('headlight'));
    b.cbox(L / 2 - 0.2, 3, -3, 0.6, 1.4, 1.6, e('headlight'));
    if (v === 3) {
      b.cbox(-4.5, 1.5, 0, 18, 11, 9.4, e('cargo'));
      b.cbox(-4.5, 6, 0, 18.2, 2, 9.6, cab);
    } else {
      // Tanker: stacked boxes approximate a cylinder.
      b.cbox(-4.5, 2.5, 0, 18, 8, 7, e('cargo'));
      b.cbox(-4.5, 3.5, 0, 18, 6, 9, e('cargo'));
      b.cbox(-4.5, 10.5, 0, 3, 1, 3, e('trim'));
    }
    b.cbox(0, 0.5, 0, L, 1.5, 8, e('trainDark'));
    for (const x of [-10, -6, 9]) for (const z of [-4.2, 4.2]) b.cbox(x, 0, z, 3.4, 3.4, 1.4, wheel);
  }
  return b;
}

/** River platforms of `len` tiles, centred on x. */
function platform(b: VoxelBuilder, theme: WorldTheme, len: number): VoxelBuilder {
  const L = len * 10 - 0.6;
  switch (theme.platform) {
    case 'log':
      b.cbox(0, -2, 0, L, 4.5, 8, e('log'));
      b.cbox(0, 2.5, 0, L - 2, 0.6, 5, e('logDark'));
      b.cbox(L / 2, -1.5, 0, 0.6, 3.6, 7, e('logEnd')).cbox(-L / 2, -1.5, 0, 0.6, 3.6, 7, e('logEnd'));
      for (let x = -L / 2 + 4; x < L / 2 - 2; x += 6) b.cbox(x, -2, 0, 1, 4.7, 8.2, e('logDark'));
      break;
    case 'floe':
      b.cbox(0, -2, 0, L, 3.4, 8.6, e('log'));
      b.cbox(0, 1.4, 0, L - 2, 0.8, 6, e('logEnd'));
      b.cbox(L / 4, -2, 4.3, L / 3, 3, 1, e('logDark'));
      break;
    case 'raft':
      for (let z = -3.6; z <= 3.6; z += 2.4) b.cbox(0, -2, z, L, 3.6, 2.2, e(z > 0 ? 'log' : 'logDark'));
      b.cbox(-L / 2 + 2, 1.6, 0, 1.4, 0.6, 9, e('logEnd')).cbox(L / 2 - 2, 1.6, 0, 1.4, 0.6, 9, e('logEnd'));
      break;
    case 'wafer':
      b.cbox(0, -2, 0, L, 4, 8, e('log'));
      for (let x = -L / 2 + 2.5; x < L / 2; x += 5) b.cbox(x, 2, 0, 3.5, 0.6, 7, e('logEnd'));
      break;
    case 'hover':
      b.cbox(0, -0.5, 0, L, 2.5, 8, e('log'));
      b.cbox(0, -1.2, 0, L + 0.2, 0.8, 8.2, e('logEnd'));
      b.cbox(0, 2, 0, L - 3, 0.3, 1, e('logDark'));
      break;
  }
  return b;
}

function lily(b: VoxelBuilder, flower: boolean): VoxelBuilder {
  b.cbox(0, -0.6, 0, 8, 1, 6, e('lily'));
  b.cbox(0, -0.6, 0, 6, 1, 8, e('lily'));
  b.cbox(1.5, -0.5, 2, 2.5, 1, 2, e('lilyDark'));
  if (flower) {
    b.cbox(-1.5, 0.4, -1, 2.4, 1.4, 2.4, e('lilyFlower'));
    b.cbox(-1.5, 1.6, -1, 1, 0.6, 1, e('coin'));
  }
  return b;
}

function locomotive(b: VoxelBuilder): VoxelBuilder {
  const L = 29;
  b.cbox(0, 2, 0, L, 9, 9, e('train'));
  b.cbox(0, 6, 0, L + 0.2, 1.5, 9.2, e('trainStripe'));
  b.cbox(-6, 11, 0, 12, 3, 8, e('train'));
  b.cbox(L / 2 - 2, 7.5, 0, 3, 3, 8, e('window'));
  b.cbox(-6, 8, 0, 10, 2.4, 9.3, e('window'));
  b.cbox(L / 2 + 0.6, 1, 0, 1.6, 4, 8, e('trainDark'));
  b.cbox(L / 2, 4, 3, 0.8, 1.4, 1.6, e('headlight')).cbox(L / 2, 4, -3, 0.8, 1.4, 1.6, e('headlight'));
  b.cbox(0, 0, 0, L - 2, 2, 7, e('trainDark'));
  for (let x = -11; x <= 11; x += 5.5) b.cbox(x, 0, 0, 3, 2.6, 9.4, e('wheel'));
  return b;
}

function carriage(b: VoxelBuilder): VoxelBuilder {
  const L = 29;
  b.cbox(0, 2, 0, L, 10, 9, e('train'));
  b.cbox(0, 12, 0, L - 1, 1, 8, e('trainDark'));
  for (let x = -10; x <= 10; x += 5) b.cbox(x, 6.5, 0, 3.4, 3, 9.2, e('window'));
  b.cbox(0, 3.5, 0, L + 0.2, 1.2, 9.2, e('trainStripe'));
  b.cbox(0, 0, 0, L - 2, 2, 7, e('trainDark'));
  for (const x of [-11, -6.5, 6.5, 11]) b.cbox(x, 0, 0, 3, 2.6, 9.4, e('wheel'));
  return b;
}

function coin(b: VoxelBuilder): VoxelBuilder {
  b.cbox(0, -2.5, 0, 5, 5, 1.4, e('coin'));
  b.cbox(0, -1.5, 0, 3, 3, 1.8, e('coinDark'));
  b.cbox(0, -2, 0, 4, 4, 1.6, e('coin'));
  b.cbox(0, -0.75, 0, 1, 1.5, 2, e('coinDark'));
  return b;
}

function track(b: VoxelBuilder): VoxelBuilder {
  const W = VISUAL_HALF_WIDTH * 10;
  for (let x = -W; x <= W; x += 10) b.cbox(x, 0, 0, 2.6, 0.8, 8.6, e('sleeper'));
  b.cbox(0, 0.8, 2.6, W * 2, 1, 0.9, e('rail'));
  b.cbox(0, 0.8, -2.6, W * 2, 1, 0.9, e('rail'));
  return b;
}

function dashes(b: VoxelBuilder): VoxelBuilder {
  const W = VISUAL_HALF_WIDTH * 10;
  for (let x = -W; x < W; x += 20) b.cbox(x + 5, 0, 0, 7, 0.3, 0.8, e('roadLine'));
  return b;
}

function post(b: VoxelBuilder): VoxelBuilder {
  b.cbox(0, 0, 0, 1.2, 14, 1.2, e('post'));
  b.cbox(0, 10.5, 0.7, 5.6, 2.6, 0.6, e('black'));
  b.cbox(0, 14, 0, 6, 1, 0.8, e('white'));
  b.cbox(0, 0, 0, 3, 1, 3, e('post'));
  return b;
}

/** The Stormray: the original flying predator that ends idle runs. Faces +z. */
export function buildPredator(atlas: PaletteAtlas): THREE.BufferGeometry {
  const b = new VoxelBuilder(atlas);
  b.cbox(0, 0, 0, 12, 4, 16, e('predator'));
  b.cbox(0, 4, -1, 8, 2, 11, e('predatorDark'));
  for (let i = 1; i <= 4; i++) {
    const w = 6;
    const x = 6 + (i - 1) * w + w / 2;
    const d = 14 - i * 2.6;
    const h = 3 - i * 0.5;
    b.pair(x, 0.5 + i * 0.3, -i * 0.8, w, h, d, e(i % 2 ? 'predator' : 'predatorDark'));
    b.pair(x, 0.5 + i * 0.3 + h, -i * 0.8, w * 0.8, 0.4, d * 0.4, e('predatorAccent'));
  }
  b.cbox(0, 1, -15, 2, 2, 14, e('predatorDark'));
  b.cbox(0, 1.5, -22, 3, 1, 3, e('predatorAccent'));
  b.pair(3.2, 2, 8, 2, 2, 1, e('predatorEye'));
  b.pair(3.2, 2.4, 8.4, 1, 1, 0.6, e('black'));
  b.pair(4, 4, 6, 1.5, 3, 1.5, e('predatorDark'));
  b.pair(2.5, -3, 1, 1.4, 3, 1.4, e('predatorDark'));
  b.pair(2.5, -4, 2, 1.4, 1, 2.4, e('predatorAccent'));
  return b.build(U * 1.6);
}
