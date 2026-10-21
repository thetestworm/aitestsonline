import { describe, expect, it } from 'vitest';
import {
  SAVE_KEY,
  SAVE_VERSION,
  defaultSave,
  giftAvailable,
  loadSave,
  localDay,
  migrate,
  writeSave,
  type KVStore,
} from '../src/core/save';

function memStore(init: Record<string, string> = {}): KVStore & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

describe('save data', () => {
  it('round-trips through storage', () => {
    const store = memStore();
    const s = defaultSave();
    s.coins = 321;
    s.bestScore = 77;
    s.unlocked.push('bolt7');
    s.selected = 'bolt7';
    expect(writeSave(store, s)).toBe(true);
    expect(loadSave(store)).toEqual(s);
  });

  it('migrates a v1 save', () => {
    const out = migrate({ version: 1, coins: 50, best: 12, muted: true });
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.coins).toBe(50);
    expect(out.bestScore).toBe(12);
    expect(out.settings.sound).toBe(false);
    expect(out.settings.quality).toBe('auto');
    expect(out.unlocked).toContain('sprout');
  });

  it('migrates a v2 save keeping characters and settings', () => {
    const out = migrate({
      version: 2,
      coins: 10,
      bestScore: 40,
      unlocked: ['sprout', 'glint', 'not-a-real-character'],
      selected: 'glint',
      settings: { sound: true, music: false },
      plays: 9,
    });
    expect(out.unlocked).toEqual(['sprout', 'glint']);
    expect(out.selected).toBe('glint');
    expect(out.settings.music).toBe(false);
    expect(out.stats.gamesPlayed).toBe(9);
  });

  it('sanitises garbage values field by field', () => {
    const out = migrate({
      version: 3,
      coins: -5,
      bestScore: 'lots',
      selected: 'locked-guy',
      settings: { quality: 'ultra', sound: 'yes' },
      missions: [{ template: 'hops', target: 10, progress: 3, reward: 20 }, 'junk'],
      lastGiftDay: 'yesterday',
    });
    expect(out.coins).toBe(0);
    expect(out.bestScore).toBe(0);
    expect(out.selected).toBe('sprout');
    expect(out.settings.quality).toBe('auto');
    expect(out.settings.sound).toBe(true);
    expect(out.missions).toHaveLength(1);
    expect(out.lastGiftDay).toBeNull();
  });

  it('recovers from corrupt JSON and keeps a backup', () => {
    const store = memStore({ [SAVE_KEY]: '{not json' });
    expect(loadSave(store)).toEqual(defaultSave());
    expect(store.data[`${SAVE_KEY}.corrupt`]).toBe('{not json');
  });

  it('tolerates storage that throws', () => {
    const throwing: KVStore = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    expect(loadSave(throwing)).toEqual(defaultSave());
    expect(writeSave(throwing, defaultSave())).toBe(false);
  });

  it('daily gift is available once per local day', () => {
    const s = defaultSave();
    const now = new Date(2026, 9, 21, 12);
    expect(giftAvailable(s, now)).toBe(true);
    s.lastGiftDay = localDay(now);
    expect(giftAvailable(s, now)).toBe(false);
    expect(giftAvailable(s, new Date(2026, 9, 22, 0, 1))).toBe(true);
  });
});
