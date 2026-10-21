import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ACHIEVEMENTS, applyRunToMission, emptyRunStats, makeMission } from '../src/data/missions';
import { CHARACTERS } from '../src/data/characters';

describe('missions', () => {
  it('run-scoped missions keep the best value', () => {
    const m = { template: 'score', target: 30, progress: 0, reward: 20 };
    const run = emptyRunStats();
    run.score = 20;
    expect(applyRunToMission(m, run)).toBe(false);
    run.score = 10;
    applyRunToMission(m, run);
    expect(m.progress).toBe(20);
    run.score = 31;
    expect(applyRunToMission(m, run)).toBe(true);
    expect(m.progress).toBe(30);
    expect(applyRunToMission(m, run)).toBe(false);
  });

  it('total-scoped missions accumulate', () => {
    const m = { template: 'hops', target: 100, progress: 0, reward: 20 };
    const run = emptyRunStats();
    run.hops = 60;
    applyRunToMission(m, run);
    expect(applyRunToMission(m, run)).toBe(true);
  });

  it('makeMission avoids excluded templates and scales with level', () => {
    const rng = new Rng(1);
    for (let i = 0; i < 50; i++) {
      const m = makeMission(rng, 3, ['score', 'hops']);
      expect(['score', 'hops']).not.toContain(m.template);
    }
    const lo = makeMission(new Rng(5), 0, []);
    const hi = makeMission(new Rng(5), 8, []);
    expect(hi.target).toBeGreaterThan(lo.target);
  });

  it('has unique achievement ids', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});

describe('character roster', () => {
  it('has 30+ unique original characters with secrets', () => {
    expect(CHARACTERS.length).toBeGreaterThanOrEqual(30);
    expect(new Set(CHARACTERS.map((c) => c.id)).size).toBe(CHARACTERS.length);
    expect(new Set(CHARACTERS.map((c) => c.name)).size).toBe(CHARACTERS.length);
    const secrets = CHARACTERS.filter((c) => c.rarity === 'secret');
    expect(secrets.length).toBeGreaterThanOrEqual(3);
    for (const s of secrets) {
      expect(s.secret).toBeDefined();
      expect(s.special).toBeDefined();
    }
  });
});
