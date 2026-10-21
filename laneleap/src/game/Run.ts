/**
 * One play session: players, camera scrolling, hazards and the predator. All
 * rules live here; presentation (audio, particles, UI) is reached via hooks.
 */
import { BACK_LIMIT_ROWS, IDLE_LIMIT_SECONDS, MIN_ROW, PLAY_HALF } from '../core/constants';
import {
  findPlatform,
  hitSpan,
  isBehindCamera,
  isDriftedOff,
  snapToPlatformCell,
} from '../core/collision';
import type { Dir } from '../core/gestures';
import { emptyRunStats, type DeathCause, type RunStats } from '../data/missions';
import { scrollSpeedAt } from '../world/difficulty';
import { isBlocked } from '../world/laneTypes';
import type { LaneRuntime } from '../world/Lane';
import { GROUND_TOP, PLATFORM_TOP, type World } from '../world/World';
import type { Player } from '../entities/Player';
import type { Predator } from '../entities/Predator';

export interface RunHooks {
  hop(p: Player): void;
  bump(p: Player): void;
  land(p: Player, lane: LaneRuntime | undefined): void;
  coin(p: Player, x: number, row: number, value: number): void;
  death(p: Player, cause: DeathCause): void;
  predator(p: Player): void;
  score(p: Player): void;
}

const SPAWN_COLS: Record<number, number[]> = {
  1: [0],
  2: [-1, 1],
  3: [-2, 0, 2],
  4: [-3, -1, 1, 3],
};

export class Run {
  readonly stats: RunStats;
  focusRow = 0;
  focusX = 0;
  scrolling = false;
  elapsed = 0;
  over = false;
  private overTimer = 0;
  coins = 0;

  constructor(
    readonly world: World,
    readonly players: Player[],
    readonly predators: Predator[],
    private readonly hooks: RunHooks,
  ) {
    this.stats = emptyRunStats(players.length);
    const cols = SPAWN_COLS[players.length] ?? SPAWN_COLS[1];
    players.forEach((p, i) => p.spawn(cols[i], 0));
    for (const pr of predators) {
      pr.reset();
      pr.onGrab = (p) => this.kill(p, 'predator');
    }
    world.ensure(0);
  }

  get alivePlayers(): number {
    let n = 0;
    for (const p of this.players) if (p.alive) n++;
    return n;
  }

  get bestRow(): number {
    let m = 0;
    for (const p of this.players) if (p.maxRow > m) m = p.maxRow;
    return m;
  }

  input(playerIndex: number, dir: Dir): void {
    const p = this.players[playerIndex];
    if (!p || !p.alive || p.grabbed) return;
    if (p.hopping) {
      p.enqueue(dir);
      return;
    }
    this.tryHop(p, dir);
  }

  private tryHop(p: Player, dir: Dir): void {
    const dRow = dir === 'up' ? 1 : dir === 'down' ? -1 : 0;
    const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
    const toRow = p.row + dRow;
    const lane = this.world.lane(toRow);
    p.face(dir);
    if (toRow < MIN_ROW || !lane) {
      p.bump(dir);
      this.hooks.bump(p);
      return;
    }
    let toX: number;
    let toY: number;
    if (lane.kind === 'river') {
      toX = p.x + dx;
      toY = lane.spec.platform === 'lily' ? PLATFORM_TOP.lily : PLATFORM_TOP.log;
    } else {
      toX = Math.round(p.x + dx);
      toY = GROUND_TOP[lane.kind] > 0 ? GROUND_TOP[lane.kind] : 0;
    }
    const col = Math.round(toX);
    if (col < -PLAY_HALF || col > PLAY_HALF || isBlocked(lane.spec, col)) {
      p.bump(dir);
      this.hooks.bump(p);
      return;
    }
    // Sideways hops along a moving log keep moving with it.
    const carry =
      dRow === 0 && p.platformLane && p.platformLane.spec.speed > 0 ? p.platformLane : null;
    p.startHop(toX, toRow, toY, carry);
    if (dir === 'up' && !this.scrolling) this.scrolling = true;
    this.stats.hops++;
    this.hooks.hop(p);
  }

  update(dt: number): void {
    if (this.over) return;
    this.elapsed += dt;
    this.world.update(dt, this.focusRow);
    let anyAlive = false;
    for (const p of this.players) {
      if (p.alive) {
        anyAlive = true;
        this.updatePlayer(p, dt);
      } else {
        p.deathT += dt;
      }
    }
    for (const pr of this.predators) pr.update(dt);
    this.updateCamera(dt);
    this.world.ensure(this.focusRow);
    if (!anyAlive) {
      this.overTimer += dt;
      const predatorBusy = this.predators.some((x) => x.busy);
      if (this.overTimer > 1.25 && !predatorBusy) this.over = true;
    }
  }

  private updatePlayer(p: Player, dt: number): void {
    if (p.grabbed) return;
    if (p.hopping) {
      if (p.advanceHop(dt)) this.land(p);
    } else if (p.platformLane) {
      p.x += p.platformLane.velocity * dt;
      if (isDriftedOff(p.x)) {
        this.kill(p, 'drift');
        return;
      }
    }
    if (!p.alive) return;
    // Consume buffered input once grounded.
    if (!p.hopping && p.queue.length) this.tryHop(p, p.queue.shift()!);

    // Hazards in the lane the player currently occupies.
    const lane = this.world.lane(p.row);
    if (lane) {
      if (lane.kind === 'road' && hitSpan(p.x, lane.movers) >= 0) {
        p.deathDir = lane.spec.dir;
        this.kill(p, 'vehicle');
        return;
      }
      if (
        lane.kind === 'rail' &&
        lane.trainActive &&
        hitSpan(p.x, lane.trainSpans, 1, 0.3, 0) >= 0
      ) {
        p.deathDir = lane.spec.dir;
        this.kill(p, 'train');
        return;
      }
    }

    if (this.scrolling && p.hasMoved) p.idle += dt;
    const behind = isBehindCamera(p.visualRow, this.focusRow, BACK_LIMIT_ROWS);
    if (p.idle > IDLE_LIMIT_SECONDS || behind) this.summonPredator(p);
    if (p.alive) p.animate(dt);
  }

  private land(p: Player): void {
    const lane = this.world.lane(p.row);
    if (lane && lane.kind === 'river') {
      const idx = findPlatform(p.x, lane.movers);
      if (idx < 0) {
        if (p.def.special === 'floatOnce' && !p.floatUsed) {
          p.floatUsed = true;
          p.floating = true;
          p.x = Math.round(p.x);
        } else {
          this.kill(p, 'water');
          return;
        }
      } else {
        p.x = snapToPlatformCell(p.x, lane.movers[idx]);
        p.platformLane = lane;
        p.platformIndex = idx;
        if (lane.spec.platform === 'lily') this.stats.lilyHops++;
        else this.stats.logsRidden++;
      }
    } else {
      p.x = Math.round(p.x);
    }
    this.collectCoins(p);
    if (p.row > p.maxRow) {
      for (let r = p.maxRow; r < p.row; r++) {
        const crossed = this.world.lane(r);
        if (!crossed || r < 0) continue;
        if (crossed.kind === 'road') this.stats.roadsCrossed++;
        else if (crossed.kind === 'river') this.stats.riversCrossed++;
        else if (crossed.kind === 'rail') this.stats.railsCrossed++;
      }
      p.maxRow = p.row;
      this.stats.score = Math.max(this.stats.score, p.maxRow);
      this.hooks.score(p);
    }
    this.hooks.land(p, lane);
  }

  private collectCoins(p: Player): void {
    const magnet = p.def.special === 'magnet';
    const value = p.def.special === 'doubleCoins' ? 2 : 1;
    const col = Math.round(p.x);
    for (let dr = magnet ? -1 : 0; dr <= (magnet ? 1 : 0); dr++) {
      const lane = this.world.lane(p.row + dr);
      if (!lane || lane.coins.length === 0) continue;
      for (let i = lane.coins.length - 1; i >= 0; i--) {
        if (Math.abs(lane.coins[i] - col) <= (magnet ? 1 : 0)) {
          const c = this.world.collectCoin(lane, i);
          this.coins += value;
          this.stats.coins += value;
          this.hooks.coin(p, c, lane.row, value);
        }
      }
    }
  }

  private summonPredator(p: Player): void {
    if (p.grabbed || !p.alive) return;
    if (this.predators.some((x) => x.target === p)) return;
    const pr = this.predators.find((x) => !x.busy);
    if (!pr) return;
    p.queue.length = 0;
    pr.launch(p);
    this.hooks.predator(p);
  }

  kill(p: Player, cause: DeathCause): void {
    if (!p.alive) return;
    p.alive = false;
    p.deathCause = cause;
    p.deathT = 0;
    p.queue.length = 0;
    if (!this.stats.deathCause || cause === 'predator') this.stats.deathCause = cause;
    this.hooks.death(p, cause);
  }

  private updateCamera(dt: number): void {
    let lead = -Infinity;
    let sumX = 0;
    let n = 0;
    for (const p of this.players) {
      if (!p.alive && !p.grabbed) continue;
      if (p.visualRow > lead) lead = p.visualRow;
      sumX += p.x;
      n++;
    }
    if (n > 0) {
      const target = lead + 0.5;
      if (target > this.focusRow) this.focusRow += (target - this.focusRow) * Math.min(1, dt * 3.2);
      const tx = Math.max(-2.2, Math.min(2.2, (sumX / n) * 0.55));
      this.focusX += (tx - this.focusX) * Math.min(1, dt * 2.5);
    }
    if (this.scrolling && this.alivePlayers > 0) this.focusRow += scrollSpeedAt(this.focusRow) * dt;
    this.stats.seconds = this.elapsed;
  }
}
