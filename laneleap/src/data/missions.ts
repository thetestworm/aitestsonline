/** Missions (rotating short-term goals) and achievements (permanent badges). */
import type { Rng } from '../core/rng';

export interface RunStats {
  score: number;
  hops: number;
  coins: number;
  roadsCrossed: number;
  riversCrossed: number;
  railsCrossed: number;
  logsRidden: number;
  lilyHops: number;
  seconds: number;
  deathCause: DeathCause | null;
  players: number;
}

export type DeathCause = 'vehicle' | 'train' | 'water' | 'drift' | 'predator';

export function emptyRunStats(players = 1): RunStats {
  return {
    score: 0,
    hops: 0,
    coins: 0,
    roadsCrossed: 0,
    riversCrossed: 0,
    railsCrossed: 0,
    logsRidden: 0,
    lilyHops: 0,
    seconds: 0,
    deathCause: null,
    players,
  };
}

type StatKey = Exclude<keyof RunStats, 'deathCause' | 'players'>;

export interface MissionTemplate {
  id: string;
  stat: StatKey;
  /** 'run' = reach target within a single run, 'total' = accumulate across runs. */
  scope: 'run' | 'total';
  base: number;
  step: number;
  text: (n: number) => string;
}

export const MISSION_TEMPLATES: readonly MissionTemplate[] = [
  { id: 'score', stat: 'score', scope: 'run', base: 25, step: 10, text: (n) => `Reach a score of ${n} in one run` },
  { id: 'hops', stat: 'hops', scope: 'total', base: 150, step: 75, text: (n) => `Hop ${n} times` },
  { id: 'coinsRun', stat: 'coins', scope: 'run', base: 5, step: 2, text: (n) => `Grab ${n} coins in one run` },
  { id: 'coins', stat: 'coins', scope: 'total', base: 30, step: 15, text: (n) => `Collect ${n} coins` },
  { id: 'roads', stat: 'roadsCrossed', scope: 'total', base: 25, step: 15, text: (n) => `Cross ${n} road lanes` },
  { id: 'roadsRun', stat: 'roadsCrossed', scope: 'run', base: 10, step: 4, text: (n) => `Cross ${n} road lanes in one run` },
  { id: 'rivers', stat: 'riversCrossed', scope: 'total', base: 12, step: 8, text: (n) => `Cross ${n} river lanes` },
  { id: 'logs', stat: 'logsRidden', scope: 'total', base: 15, step: 10, text: (n) => `Land on ${n} logs` },
  { id: 'rails', stat: 'railsCrossed', scope: 'total', base: 8, step: 5, text: (n) => `Cross ${n} railway tracks` },
  { id: 'lily', stat: 'lilyHops', scope: 'total', base: 6, step: 4, text: (n) => `Hop onto ${n} lily pads` },
  { id: 'time', stat: 'seconds', scope: 'run', base: 45, step: 15, text: (n) => `Survive ${n} seconds in one run` },
];

export interface MissionState {
  template: string;
  target: number;
  progress: number;
  reward: number;
}

export function makeMission(rng: Rng, level: number, exclude: readonly string[]): MissionState {
  const pool = MISSION_TEMPLATES.filter((t) => !exclude.includes(t.id));
  const t = rng.pick(pool.length ? pool : MISSION_TEMPLATES);
  const target = t.base + t.step * Math.min(level, 12);
  return { template: t.id, target, progress: 0, reward: 20 + Math.min(level, 10) * 5 };
}

export function missionTemplate(id: string): MissionTemplate {
  return MISSION_TEMPLATES.find((t) => t.id === id) ?? MISSION_TEMPLATES[0];
}

export function missionText(m: MissionState): string {
  return missionTemplate(m.template).text(m.target);
}

/** Apply a finished run's stats to a mission. Returns true if it just completed. */
export function applyRunToMission(m: MissionState, run: RunStats): boolean {
  if (m.progress >= m.target) return false;
  const t = missionTemplate(m.template);
  const v = run[t.stat];
  m.progress = t.scope === 'run' ? Math.max(m.progress, v) : m.progress + v;
  if (m.progress >= m.target) {
    m.progress = m.target;
    return true;
  }
  return false;
}

export interface AchievementCtx {
  run: RunStats;
  bestScore: number;
  totalCoinsEarned: number;
  gamesPlayed: number;
  unlockedCount: number;
  missionsCompleted: number;
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  check: (c: AchievementCtx) => boolean;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first', name: 'First Steps', desc: 'Finish your first run.', check: (c) => c.gamesPlayed >= 1 },
  { id: 's50', name: 'Lane Ranger', desc: 'Score 50 in a run.', check: (c) => c.run.score >= 50 },
  { id: 's100', name: 'Centurion Hopper', desc: 'Score 100 in a run.', check: (c) => c.run.score >= 100 },
  { id: 's200', name: 'Unstoppable', desc: 'Score 200 in a run.', check: (c) => c.run.score >= 200 },
  { id: 'coins20', name: 'Pocket Change', desc: 'Grab 20 coins in one run.', check: (c) => c.run.coins >= 20 },
  { id: 'rich', name: 'Coin Hoarder', desc: 'Earn 1000 coins in total.', check: (c) => c.totalCoinsEarned >= 1000 },
  { id: 'logger', name: 'Log Roller', desc: 'Land on 15 logs in one run.', check: (c) => c.run.logsRidden >= 15 },
  { id: 'rail', name: 'Rail Dancer', desc: 'Cross 8 railway tracks in one run.', check: (c) => c.run.railsCrossed >= 8 },
  { id: 'snatched', name: 'Up, Up and Away', desc: 'Get snatched by the Stormray.', check: (c) => c.run.deathCause === 'predator' },
  { id: 'splash', name: 'Belly Flop', desc: 'Fall in the river.', check: (c) => c.run.deathCause === 'water' },
  { id: 'collector5', name: 'Collector', desc: 'Unlock 5 characters.', check: (c) => c.unlockedCount >= 5 },
  { id: 'collector15', name: 'Curator', desc: 'Unlock 15 characters.', check: (c) => c.unlockedCount >= 15 },
  { id: 'missions5', name: 'Task Master', desc: 'Complete 5 missions.', check: (c) => c.missionsCompleted >= 5 },
  { id: 'party', name: 'Party Hop', desc: 'Play a multiplayer run.', check: (c) => c.run.players >= 2 },
  { id: 'veteran', name: 'Veteran', desc: 'Play 50 runs.', check: (c) => c.gamesPlayed >= 50 },
];
