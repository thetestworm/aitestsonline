/**
 * Persistent save data in localStorage with a versioned schema.
 * Older saves are migrated step by step (v1 -> v2 -> v3); anything malformed is
 * sanitised field by field so a corrupt value never wipes the rest of the save.
 */
import { CHARACTERS, DEFAULT_CHARACTER } from '../data/characters';
import type { MissionState } from '../data/missions';

export const SAVE_KEY = 'laneleap.save';
export const SAVE_VERSION = 3;

export type Quality = 'auto' | 'high' | 'medium' | 'low';

export interface Settings {
  sound: boolean;
  music: boolean;
  quality: Quality;
  touchControls: 'swipe' | 'buttons';
  themedWorlds: boolean;
  screenShake: boolean;
}

export interface Stats {
  gamesPlayed: number;
  totalCoinsEarned: number;
  totalHops: number;
  missionsCompleted: number;
  predatorDeaths: number;
}

export interface SaveData {
  version: typeof SAVE_VERSION;
  coins: number;
  bestScore: number;
  unlocked: string[];
  selected: string;
  settings: Settings;
  stats: Stats;
  missions: MissionState[];
  achievements: string[];
  /** Local calendar day (YYYY-MM-DD) the daily gift was last claimed. */
  lastGiftDay: string | null;
  giftStreak: number;
}

export interface KVStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function defaultSettings(): Settings {
  return {
    sound: true,
    music: true,
    quality: 'auto',
    touchControls: 'swipe',
    themedWorlds: true,
    screenShake: true,
  };
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    coins: 0,
    bestScore: 0,
    unlocked: [DEFAULT_CHARACTER],
    selected: DEFAULT_CHARACTER,
    settings: defaultSettings(),
    stats: {
      gamesPlayed: 0,
      totalCoinsEarned: 0,
      totalHops: 0,
      missionsCompleted: 0,
      predatorDeaths: 0,
    },
    missions: [],
    achievements: [],
    lastGiftDay: null,
    giftStreak: 0,
  };
}

type Raw = Record<string, unknown>;

/** Migrations keyed by the version they upgrade *from*. */
const MIGRATIONS: Record<number, (s: Raw) => Raw> = {
  // v1 (prototype): { version: 1, coins, best }
  1: (s) => ({
    ...s,
    version: 2,
    bestScore: s.best ?? 0,
    unlocked: [DEFAULT_CHARACTER],
    selected: DEFAULT_CHARACTER,
    settings: { sound: s.muted !== true, music: s.muted !== true },
  }),
  // v2: adds characters + basic settings. v3 adds missions, stats, gifts, achievements.
  2: (s) => ({
    ...s,
    version: 3,
    settings: { ...defaultSettings(), ...(isObj(s.settings) ? s.settings : {}) },
    stats: { ...defaultSave().stats, gamesPlayed: num(s.plays, 0) },
    missions: [],
    achievements: [],
    lastGiftDay: null,
    giftStreak: 0,
  }),
};

export function migrate(raw: unknown): SaveData {
  if (!isObj(raw)) return defaultSave();
  let s: Raw = { ...raw };
  let v = typeof s.version === 'number' ? s.version : 1;
  if (v > SAVE_VERSION) {
    // A newer build wrote this save; keep what we understand.
    v = SAVE_VERSION;
  }
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) break;
    s = step(s);
    v = num(s.version, v + 1);
  }
  return sanitize(s);
}

export function sanitize(s: Raw): SaveData {
  const d = defaultSave();
  const ids = new Set(CHARACTERS.map((c) => c.id));
  const unlocked = Array.isArray(s.unlocked)
    ? s.unlocked.filter((x): x is string => typeof x === 'string' && ids.has(x))
    : [];
  if (!unlocked.includes(DEFAULT_CHARACTER)) unlocked.unshift(DEFAULT_CHARACTER);
  const selected =
    typeof s.selected === 'string' && unlocked.includes(s.selected)
      ? s.selected
      : DEFAULT_CHARACTER;
  const st = isObj(s.settings) ? s.settings : {};
  const stats = isObj(s.stats) ? s.stats : {};
  const quality = ['auto', 'high', 'medium', 'low'].includes(st.quality as string)
    ? (st.quality as Quality)
    : d.settings.quality;
  return {
    version: SAVE_VERSION,
    coins: int(s.coins, 0),
    bestScore: int(s.bestScore, 0),
    unlocked: Array.from(new Set(unlocked)),
    selected,
    settings: {
      sound: bool(st.sound, d.settings.sound),
      music: bool(st.music, d.settings.music),
      quality,
      touchControls: st.touchControls === 'buttons' ? 'buttons' : 'swipe',
      themedWorlds: bool(st.themedWorlds, d.settings.themedWorlds),
      screenShake: bool(st.screenShake, d.settings.screenShake),
    },
    stats: {
      gamesPlayed: int(stats.gamesPlayed, 0),
      totalCoinsEarned: int(stats.totalCoinsEarned, 0),
      totalHops: int(stats.totalHops, 0),
      missionsCompleted: int(stats.missionsCompleted, 0),
      predatorDeaths: int(stats.predatorDeaths, 0),
    },
    missions: Array.isArray(s.missions)
      ? s.missions.filter(isObj).map((m) => ({
          template: typeof m.template === 'string' ? m.template : 'score',
          target: Math.max(1, int(m.target, 1)),
          progress: int(m.progress, 0),
          reward: int(m.reward, 20),
        }))
      : [],
    achievements: Array.isArray(s.achievements)
      ? s.achievements.filter((x): x is string => typeof x === 'string')
      : [],
    lastGiftDay:
      typeof s.lastGiftDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.lastGiftDay)
        ? s.lastGiftDay
        : null,
    giftStreak: int(s.giftStreak, 0),
  };
}

export function loadSave(store: KVStore | null): SaveData {
  if (!store) return defaultSave();
  let text: string | null = null;
  try {
    text = store.getItem(SAVE_KEY);
  } catch {
    return defaultSave();
  }
  if (!text) return defaultSave();
  try {
    return migrate(JSON.parse(text));
  } catch {
    // Keep the unreadable blob around for debugging instead of silently losing it.
    try {
      store.setItem(`${SAVE_KEY}.corrupt`, text);
    } catch {
      /* storage full or unavailable */
    }
    return defaultSave();
  }
}

export function writeSave(store: KVStore | null, data: SaveData): boolean {
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function browserStore(): KVStore | null {
  try {
    const ls = globalThis.localStorage;
    const probe = '__laneleap_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

export function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function giftAvailable(save: SaveData, now: Date): boolean {
  return save.lastGiftDay !== localDay(now);
}

function isObj(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function int(v: unknown, fallback: number): number {
  return Math.max(0, Math.floor(num(v, fallback)));
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
