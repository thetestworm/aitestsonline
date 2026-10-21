// Simple autopilot used by the perf/screenshot harness (scripts/perf.mjs).
// Injected into the page; reads game state via window.laneleap and presses keys.
window.__autopilot = function autopilot() {
  const g = window.laneleap;
  if (!g || g.state !== 'playing' || !g.run) return null;
  const run = g.run;
  const p = run.players[0];
  if (!p.alive || p.hopping || p.grabbed) return null;
  const W = run.world;
  const dangerRoad = (lane, x, t0, t1) => {
    const v = lane.spec.speed * lane.spec.dir;
    for (let t = t0; t <= t1; t += 0.04) {
      for (const m of lane.movers) {
        if (Math.abs(m.x + v * t - x) < m.len / 2 + 0.45) return true;
      }
    }
    return false;
  };
  const safeAt = (row, x) => {
    const lane = W.lane(row);
    if (!lane) return false;
    const k = lane.spec.kind;
    const c = Math.round(x);
    if (k === 'grass') return Math.abs(c) <= 4 && !lane.spec.props.some((pr) => pr.col === c);
    if (k === 'road') return Math.abs(c) <= 4 && !dangerRoad(lane, c, 0, 0.5);
    if (k === 'rail') return Math.abs(c) <= 4 && !lane.warning && !lane.trainActive;
    if (k === 'river') {
      const v = lane.spec.speed * lane.spec.dir;
      for (const m of lane.movers) {
        const mx = m.x + v * 0.13;
        if (Math.abs(mx - x) < m.len / 2 - 0.15) return Math.abs(x + v * 1.2) < 3.8;
      }
      return false;
    }
    return false;
  };
  const cur = W.lane(p.row);
  const x = p.x;
  const fx = cur && cur.spec.kind === 'river' ? x : Math.round(x);
  const next = W.lane(p.row + 1);
  const nx = next && next.spec.kind === 'river' ? x : Math.round(x);
  if (safeAt(p.row + 1, nx)) return 'ArrowUp';
  // Stay put unless the current tile is about to become deadly.
  let threatened = false;
  if (cur && cur.spec.kind === 'road') threatened = dangerRoad(cur, Math.round(x), 0, 0.35);
  if (cur && cur.spec.kind === 'rail') threatened = cur.warning;
  if (cur && cur.spec.kind === 'river')
    threatened = Math.abs(x + cur.spec.speed * cur.spec.dir * 0.6) > 3.6;
  const sideways = [];
  if (cur && cur.spec.kind === 'river') {
    // Walk against the drift to stay on screen, or along to line up with the next platform.
    sideways.push(cur.spec.dir > 0 ? 'ArrowLeft' : 'ArrowRight');
  } else {
    sideways.push(x > 0 ? 'ArrowLeft' : 'ArrowRight', x > 0 ? 'ArrowRight' : 'ArrowLeft');
  }
  for (const key of sideways) {
    const dx = key === 'ArrowLeft' ? -1 : 1;
    if (safeAt(p.row, fx + dx) && (threatened || Math.random() < 0.12)) return key;
  }
  if (threatened && safeAt(p.row - 1, fx)) return 'ArrowDown';
  return null;
};

const KEY_DIR = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
// Runs the autopilot inside the page (no CDP round-trips) and auto-retries.
window.__startAutopilot = function () {
  window.__runs = 1;
  window.__best = 0;
  let overAt = 0;
  setInterval(() => {
    const g = window.laneleap;
    if (!g) return;
    if (g.state === 'gameover') {
      if (!overAt) overAt = performance.now();
      if (performance.now() - overAt > 700) {
        overAt = 0;
        window.__runs++;
        g.onUiAction('retry');
      }
      return;
    }
    if (g.run) window.__best = Math.max(window.__best, g.run.stats.score);
    const key = window.__autopilot();
    if (key) g.onMove(0, KEY_DIR[key]);
  }, 40);
};
