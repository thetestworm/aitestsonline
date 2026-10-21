/**
 * Themed worlds. Each world recolours the shared palette atlas, picks prop and
 * platform shapes, and sets its own sky. Characters can carry a home world.
 */
import type { EnvKey } from '../render/atlas';
import type { WorldId } from '../data/worldIds';

export type TreeStyle = 'round' | 'pine' | 'cactus' | 'lollipop' | 'tower';
export type RockStyle = 'boulder' | 'ice' | 'crystal' | 'candy';
export type BushStyle = 'shrub' | 'drift' | 'tumble' | 'gumdrop' | 'hydrant';
export type PlatformStyle = 'log' | 'floe' | 'raft' | 'wafer' | 'hover';

export interface GroundColors {
  grassA: string;
  grassB: string;
  grassOut: string;
  road: string;
  roadOut: string;
  water: string;
  waterOut: string;
  rail: string;
  railOut: string;
  edge: string;
}

export interface WorldTheme {
  id: WorldId;
  name: string;
  ground: GroundColors;
  palette: Partial<Record<EnvKey, string>>;
  skyDay: string;
  skyNight: string;
  tree: TreeStyle;
  rock: RockStyle;
  bush: BushStyle;
  platform: PlatformStyle;
  /** Fraction of the day/night cycle spent dark (neon city lives at night). */
  nightBias: number;
}

const BASE_PALETTE: Record<EnvKey, string> = {
  trunk: '#8a5a3b',
  trunkDark: '#6b4329',
  leaf1: '#6cc04a',
  leaf2: '#4e9e35',
  leaf3: '#3b7f29',
  rock: '#a8a8b0',
  rockDark: '#82828c',
  bush: '#5fae3e',
  bushDark: '#478a2d',
  berry: '#e2483d',
  log: '#9a6a43',
  logEnd: '#d9b07a',
  logDark: '#75502f',
  lily: '#4caf50',
  lilyDark: '#2e7d32',
  lilyFlower: '#ff8fc7',
  car0: '#e84a5f',
  car1: '#3fa7d6',
  car2: '#f6c344',
  truck0: '#5b6ee1',
  truck1: '#e3803a',
  cargo: '#ecf0f1',
  window: '#a6e3ff',
  wheel: '#2b2b33',
  trim: '#d5d8dc',
  headlight: '#fff6b3',
  train: '#d64545',
  trainStripe: '#f4f4f4',
  trainDark: '#3a3a44',
  rail: '#8d8f99',
  sleeper: '#6d4c37',
  roadLine: '#f2f2f2',
  post: '#4a4a52',
  coin: '#ffd23f',
  coinDark: '#e0a400',
  predator: '#3d4a7a',
  predatorDark: '#232b4d',
  predatorAccent: '#7fe0ff',
  predatorEye: '#ffef5a',
  snow: '#f4f8ff',
  white: '#ffffff',
  black: '#16161c',
};

export const WORLDS: Record<WorldId, WorldTheme> = {
  meadow: {
    id: 'meadow',
    name: 'Clover Meadow',
    ground: {
      grassA: '#8fd16a',
      grassB: '#84c962',
      grassOut: '#6aa34c',
      road: '#4f5560',
      roadOut: '#3f444d',
      water: '#4fc3f7',
      waterOut: '#3aa9da',
      rail: '#8b7d6b',
      railOut: '#6f6455',
      edge: '#5b8f3e',
    },
    palette: {},
    skyDay: '#9fe3ff',
    skyNight: '#16203d',
    tree: 'round',
    rock: 'boulder',
    bush: 'shrub',
    platform: 'log',
    nightBias: 0,
  },
  tundra: {
    id: 'tundra',
    name: 'Frostbite Flats',
    ground: {
      grassA: '#eef5fb',
      grassB: '#e2edf7',
      grassOut: '#c6d6e6',
      road: '#5d6670',
      roadOut: '#4a525b',
      water: '#3d8fd1',
      waterOut: '#2f78b6',
      rail: '#9a9aa6',
      railOut: '#7d7d89',
      edge: '#b7c9db',
    },
    palette: {
      leaf1: '#2f7d5b',
      leaf2: '#25674a',
      leaf3: '#1c5039',
      rock: '#bfe6ff',
      rockDark: '#8fc9ef',
      bush: '#f4f8ff',
      bushDark: '#d6e4f2',
      log: '#e8f6ff',
      logEnd: '#bfe2fa',
      logDark: '#a9d4f2',
      car0: '#2e86de',
      car1: '#ee5253',
      car2: '#10ac84',
      truck0: '#f39c12',
      truck1: '#576574',
      train: '#2e86de',
    },
    skyDay: '#cfeaff',
    skyNight: '#1a2440',
    tree: 'pine',
    rock: 'ice',
    bush: 'drift',
    platform: 'floe',
    nightBias: 0.1,
  },
  neon: {
    id: 'neon',
    name: 'Neon Nightway',
    ground: {
      grassA: '#2a2347',
      grassB: '#251f40',
      grassOut: '#1b1631',
      road: '#16161f',
      roadOut: '#0f0f16',
      water: '#1de9ff',
      waterOut: '#12b6cc',
      rail: '#3b2f5c',
      railOut: '#2c2346',
      edge: '#ff2fd0',
    },
    palette: {
      trunk: '#2b2b3a',
      trunkDark: '#1d1d28',
      leaf1: '#ff2fd0',
      leaf2: '#2ff5ff',
      leaf3: '#b44dff',
      rock: '#6a5acd',
      rockDark: '#483d8b',
      bush: '#ff5277',
      bushDark: '#c4304f',
      log: '#2b2b3a',
      logEnd: '#2ff5ff',
      logDark: '#ff2fd0',
      car0: '#ff2fd0',
      car1: '#2ff5ff',
      car2: '#fff95b',
      truck0: '#7c4dff',
      truck1: '#ff6e40',
      window: '#ff9cf0',
      roadLine: '#2ff5ff',
      train: '#7c4dff',
      trainStripe: '#2ff5ff',
    },
    skyDay: '#3a2a6e',
    skyNight: '#0b0820',
    tree: 'tower',
    rock: 'crystal',
    bush: 'hydrant',
    platform: 'hover',
    nightBias: 0.35,
  },
  desert: {
    id: 'desert',
    name: 'Sunbaked Dunes',
    ground: {
      grassA: '#f3d48a',
      grassB: '#ecca7c',
      grassOut: '#d6ae62',
      road: '#6b5a4a',
      roadOut: '#56483b',
      water: '#3fb8c9',
      waterOut: '#2f9aaa',
      rail: '#b08a5a',
      railOut: '#8f6f47',
      edge: '#c79a52',
    },
    palette: {
      leaf1: '#5ba84a',
      leaf2: '#4a8f3c',
      leaf3: '#3a7330',
      rock: '#d9a066',
      rockDark: '#b07a45',
      bush: '#b8945a',
      bushDark: '#8f6f3e',
      log: '#c49a6c',
      logEnd: '#e8c79a',
      logDark: '#8d6b45',
      car0: '#e07a5f',
      car1: '#3d405b',
      car2: '#81b29a',
      truck0: '#f2cc8f',
      truck1: '#b5651d',
      train: '#b5651d',
    },
    skyDay: '#ffe2b0',
    skyNight: '#2a1d33',
    tree: 'cactus',
    rock: 'boulder',
    bush: 'tumble',
    platform: 'raft',
    nightBias: 0,
  },
  candy: {
    id: 'candy',
    name: 'Sugarloaf Lane',
    ground: {
      grassA: '#ffc8e1',
      grassB: '#ffbcd9',
      grassOut: '#f29cc4',
      road: '#7a4a3a',
      roadOut: '#633a2d',
      water: '#ff8fb8',
      waterOut: '#f2709f',
      rail: '#c9a0dc',
      railOut: '#a87fbf',
      edge: '#f07ab0',
    },
    palette: {
      trunk: '#ffffff',
      trunkDark: '#f0e0f0',
      leaf1: '#ff5fa2',
      leaf2: '#7ad3ff',
      leaf3: '#ffd84a',
      rock: '#b388ff',
      rockDark: '#8e5cf0',
      bush: '#7ee8a5',
      bushDark: '#4fcf80',
      log: '#7a4a2a',
      logEnd: '#f5d1a8',
      logDark: '#5a3418',
      lily: '#ffffff',
      lilyDark: '#f0d0e0',
      car0: '#ff7eb6',
      car1: '#7ad3ff',
      car2: '#b9f18c',
      truck0: '#ffb347',
      truck1: '#c792ea',
      train: '#ff5fa2',
      roadLine: '#ffffff',
    },
    skyDay: '#ffe6f4',
    skyNight: '#3a1f4a',
    tree: 'lollipop',
    rock: 'candy',
    bush: 'gumdrop',
    platform: 'wafer',
    nightBias: 0,
  },
};

export function themePalette(theme: WorldTheme): Record<EnvKey, string> {
  return { ...BASE_PALETTE, ...theme.palette };
}
