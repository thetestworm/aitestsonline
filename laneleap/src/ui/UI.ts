/**
 * DOM overlay UI: menus, HUD, character select, prize machine, missions,
 * settings, pause and game-over screens. Rendering is string templates with
 * event delegation via `data-action` attributes; the Game handles actions.
 */
import { CHARACTERS, type CharacterDef, type Rarity } from '../data/characters';
import { ACHIEVEMENTS, missionText } from '../data/missions';
import type { SaveData } from '../core/save';
import { PLAYER_COLORS, PRIZE_COST } from '../core/constants';
import { KEY_HELP } from '../core/input';
import { WORLDS } from '../world/worlds';

export type Screen =
  | 'none'
  | 'menu'
  | 'characters'
  | 'prize'
  | 'missions'
  | 'settings'
  | 'pause'
  | 'gameover'
  | 'lobby';

export interface UIModel {
  save: SaveData;
  quality: string;
  playerCount: number;
  lobby: string[];
  isTouch: boolean;
  giftReady: boolean;
  thumb(id: string): string;
  secretProgress(def: CharacterDef): string;
}

export interface GameOverData {
  scores: { player: number; score: number; name: string }[];
  best: number;
  newBest: boolean;
  coinsRun: number;
  coinsTotal: number;
  completed: string[];
  unlocked: string[];
  achievements: string[];
}

const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  secret: 'Secret',
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const coinIcon = '<span class="coin-ico" aria-hidden="true"></span>';

export class UI {
  readonly root: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly dpad: HTMLElement;
  private readonly zones: HTMLElement;
  private readonly debug: HTMLElement;
  screen: Screen = 'none';
  private charFilter: 'all' | Rarity = 'all';
  private scoreEls: HTMLElement[] = [];
  private coinEl: HTMLElement | null = null;
  private bestEl: HTMLElement | null = null;
  private lastScores: number[] = [];
  private lastCoins = -1;
  onAction: (action: string, arg?: string) => void = () => undefined;

  constructor(root: HTMLElement, private readonly model: () => UIModel) {
    this.root = root;
    root.innerHTML = `
      <div class="hud" hidden></div>
      <div class="zones" hidden></div>
      <div class="dpad" hidden>
        <button class="dp up" data-action="dpad" data-arg="up" aria-label="Hop forward">▲</button>
        <button class="dp left" data-action="dpad" data-arg="left" aria-label="Hop left">◀</button>
        <button class="dp right" data-action="dpad" data-arg="right" aria-label="Hop right">▶</button>
        <button class="dp down" data-action="dpad" data-arg="down" aria-label="Hop back">▼</button>
      </div>
      <div class="overlay" hidden></div>
      <div class="toasts" aria-live="polite"></div>
      <pre class="debug" hidden></pre>`;
    this.hud = root.querySelector('.hud')!;
    this.overlay = root.querySelector('.overlay')!;
    this.toasts = root.querySelector('.toasts')!;
    this.dpad = root.querySelector('.dpad')!;
    this.zones = root.querySelector('.zones')!;
    this.debug = root.querySelector('.debug')!;
    root.addEventListener('click', this.onClick);
    // D-pad reacts on pointerdown for zero-latency hops.
    this.dpad.addEventListener('pointerdown', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action="dpad"]');
      if (!btn) return;
      e.preventDefault();
      this.onAction('dpad', btn.dataset.arg);
    });
  }

  private readonly onClick = (e: MouseEvent): void => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el || el.dataset.action === 'dpad') return;
    e.preventDefault();
    this.onAction(el.dataset.action!, el.dataset.arg);
  };

  // ------------------------------------------------------------------ screens

  show(screen: Screen): void {
    this.screen = screen;
    const m = this.model();
    let html = '';
    switch (screen) {
      case 'none':
        break;
      case 'menu':
        html = this.menuHtml(m);
        break;
      case 'characters':
        html = this.charactersHtml(m);
        break;
      case 'prize':
        html = this.prizeHtml(m);
        break;
      case 'missions':
        html = this.missionsHtml(m);
        break;
      case 'settings':
        html = this.settingsHtml(m);
        break;
      case 'pause':
        html = this.pauseHtml();
        break;
      case 'lobby':
        html = this.lobbyHtml(m);
        break;
      case 'gameover':
        return; // rendered by showGameOver
    }
    this.overlay.hidden = screen === 'none';
    this.overlay.className = `overlay screen-${screen}`;
    this.overlay.innerHTML = html;
    const focus = this.overlay.querySelector<HTMLElement>('[data-autofocus]');
    focus?.focus({ preventScroll: true });
  }

  refresh(): void {
    if (this.screen !== 'none' && this.screen !== 'gameover') {
      const scroll = this.overlay.querySelector('.scroll')?.scrollTop ?? 0;
      this.show(this.screen);
      const sc = this.overlay.querySelector('.scroll');
      if (sc) sc.scrollTop = scroll;
    }
  }

  private menuHtml(m: UIModel): string {
    const s = m.save;
    const pc = m.playerCount;
    return `
      <div class="panel menu">
        <h1 class="logo" aria-label="Laneleap"><span>LANE</span><span>LEAP</span></h1>
        <div class="stats-row">
          <span class="pill">Best <b>${s.bestScore}</b></span>
          <span class="pill">${coinIcon}<b>${s.coins}</b></span>
        </div>
        <button class="btn big primary" data-action="play" data-autofocus>${pc > 1 ? `Play · ${pc} players` : 'Play'}</button>
        <div class="seg" role="group" aria-label="Players">
          ${[1, 2, 3, 4].map((n) => `<button class="seg-btn ${n === pc ? 'on' : ''}" data-action="players" data-arg="${n}">${n}P</button>`).join('')}
        </div>
        <div class="grid2">
          <button class="btn" data-action="characters">Characters</button>
          <button class="btn ${s.coins >= PRIZE_COST ? 'glow' : ''}" data-action="prize">Prize Machine</button>
          <button class="btn" data-action="missions">Missions</button>
          <button class="btn" data-action="settings">Settings</button>
        </div>
        ${m.giftReady ? `<button class="btn gift glow" data-action="gift">🎁 Daily gift ready!</button>` : `<div class="hint">Next free gift tomorrow</div>`}
        <div class="hint">${m.isTouch ? 'Tap to hop · swipe to turn' : 'W / ↑ to hop · A D S / ← → ↓ to move · P to pause'}</div>
      </div>`;
  }

  private charactersHtml(m: UIModel): string {
    const s = m.save;
    const filters: ('all' | Rarity)[] = ['all', 'common', 'rare', 'epic', 'secret'];
    const list = CHARACTERS.filter((c) => this.charFilter === 'all' || c.rarity === this.charFilter);
    const cards = list
      .map((c) => {
        const owned = s.unlocked.includes(c.id);
        const sel = s.selected === c.id;
        const isSecret = c.rarity === 'secret';
        const thumb = m.thumb(c.id);
        const name = owned || !isSecret ? c.name : '???';
        const sub = owned
          ? esc(c.blurb)
          : isSecret
            ? esc(c.secret?.hint ?? '') + `<br><small>${esc(m.secretProgress(c))}</small>`
            : 'Win it from the Prize Machine';
        const world = c.world ? `<span class="tag world">${esc(WORLDS[c.world].name)}</span>` : '';
        return `
        <button class="card r-${c.rarity} ${owned ? '' : 'locked'} ${sel ? 'selected' : ''}"
          data-action="${owned ? 'select' : 'noop'}" data-arg="${c.id}" aria-label="${esc(name)}">
          <span class="thumb">${thumb ? `<img src="${thumb}" alt="" draggable="false">` : '<span class="ph"></span>'}${owned ? '' : '<span class="q">?</span>'}</span>
          <span class="cname">${esc(name)}</span>
          <span class="tag r">${RARITY_LABEL[c.rarity]}</span>${world}
          <span class="blurb">${sub}</span>
        </button>`;
      })
      .join('');
    return `
      <div class="panel wide">
        <div class="bar"><button class="btn small" data-action="back">← Back</button><h2>Characters <small>${s.unlocked.length}/${CHARACTERS.length}</small></h2></div>
        <div class="seg">${filters.map((f) => `<button class="seg-btn ${f === this.charFilter ? 'on' : ''}" data-action="filter" data-arg="${f}">${f === 'all' ? 'All' : RARITY_LABEL[f]}</button>`).join('')}</div>
        <div class="scroll cards">${cards}</div>
        <div class="hint">Characters with a home world change the scenery when “Themed worlds” is on.</div>
      </div>`;
  }

  setFilter(f: string): void {
    this.charFilter = (['all', 'common', 'rare', 'epic', 'secret'].includes(f) ? f : 'all') as 'all' | Rarity;
    this.refresh();
  }

  private prizeHtml(m: UIModel): string {
    const s = m.save;
    const remaining = CHARACTERS.filter((c) => c.rarity !== 'secret' && !s.unlocked.includes(c.id)).length;
    const can = s.coins >= PRIZE_COST && remaining > 0;
    return `
      <div class="panel prize">
        <div class="bar"><button class="btn small" data-action="back">← Back</button><h2>Prize Machine</h2></div>
        <div class="machine" aria-hidden="true">
          <div class="dome"><span class="cap c1"></span><span class="cap c2"></span><span class="cap c3"></span><span class="cap c4"></span><span class="cap c5"></span></div>
          <div class="base"><span class="slot"></span><span class="knob"></span></div>
        </div>
        <div class="stats-row"><span class="pill">${coinIcon}<b>${s.coins}</b></span><span class="pill">${remaining} left to win</span></div>
        <button class="btn big primary" data-action="roll" ${can ? '' : 'disabled'}>Spin for ${coinIcon}${PRIZE_COST}</button>
        <div class="hint">${remaining === 0 ? 'You own every prize character! Secrets are earned in play.' : can ? 'Every spin wins a new character.' : `Collect ${PRIZE_COST - s.coins} more coins to spin.`}</div>
        <div class="reveal" hidden></div>
      </div>`;
  }

  /** Animate the prize machine and reveal a character. */
  prizeReveal(def: CharacterDef, thumb: string): void {
    const panel = this.overlay.querySelector('.prize');
    if (!panel) return;
    panel.classList.add('spinning');
    const reveal = panel.querySelector<HTMLElement>('.reveal')!;
    window.setTimeout(() => {
      panel.classList.remove('spinning');
      reveal.hidden = false;
      reveal.innerHTML = `
        <div class="capsule-open r-${def.rarity}">
          <div class="burst"></div>
          <img src="${thumb}" alt="">
          <div class="cname">${esc(def.name)}</div>
          <div class="tag r">${RARITY_LABEL[def.rarity]}</div>
          <div class="blurb">${esc(def.blurb)}</div>
          <div class="row"><button class="btn primary" data-action="select-play" data-arg="${def.id}">Use now</button><button class="btn" data-action="prize">Nice!</button></div>
        </div>`;
    }, 1400);
  }

  private missionsHtml(m: UIModel): string {
    const s = m.save;
    const missions = s.missions
      .map((mi) => {
        const pct = Math.min(100, Math.round((mi.progress / mi.target) * 100));
        return `<div class="mission"><div class="mtext">${esc(missionText(mi))}</div>
          <div class="progress"><span style="width:${pct}%"></span></div>
          <div class="mmeta">${mi.progress}/${mi.target} · reward ${coinIcon}${mi.reward}</div></div>`;
      })
      .join('');
    const ach = ACHIEVEMENTS.map((a) => {
      const got = s.achievements.includes(a.id);
      return `<div class="ach ${got ? 'got' : ''}"><span class="medal">${got ? '★' : '☆'}</span><span><b>${esc(a.name)}</b><br><small>${esc(a.desc)}</small></span></div>`;
    }).join('');
    return `
      <div class="panel wide">
        <div class="bar"><button class="btn small" data-action="back">← Back</button><h2>Missions</h2></div>
        <div class="scroll">
          <div class="missions">${missions}</div>
          <h3>Achievements <small>${s.achievements.length}/${ACHIEVEMENTS.length}</small></h3>
          <div class="achs">${ach}</div>
          <h3>Stats</h3>
          <div class="statgrid">
            <span>Runs</span><b>${s.stats.gamesPlayed}</b>
            <span>Total hops</span><b>${s.stats.totalHops}</b>
            <span>Coins earned</span><b>${s.stats.totalCoinsEarned}</b>
            <span>Missions done</span><b>${s.stats.missionsCompleted}</b>
          </div>
        </div>
      </div>`;
  }

  private settingsHtml(m: UIModel): string {
    const st = m.save.settings;
    const toggle = (key: string, label: string, on: boolean) =>
      `<button class="toggle ${on ? 'on' : ''}" data-action="set" data-arg="${key}:${on ? '0' : '1'}" role="switch" aria-checked="${on}"><span>${label}</span><i></i></button>`;
    const opt = (key: string, value: string, cur: string, label: string) =>
      `<button class="seg-btn ${value === cur ? 'on' : ''}" data-action="set" data-arg="${key}:${value}">${label}</button>`;
    return `
      <div class="panel">
        <div class="bar"><button class="btn small" data-action="back">← Back</button><h2>Settings</h2></div>
        <div class="scroll">
          ${toggle('sound', 'Sound effects', st.sound)}
          ${toggle('music', 'Music', st.music)}
          ${toggle('screenShake', 'Screen shake', st.screenShake)}
          ${toggle('themedWorlds', 'Themed worlds', st.themedWorlds)}
          <h3>Graphics</h3>
          <div class="seg">${opt('quality', 'auto', st.quality, 'Auto')}${opt('quality', 'high', st.quality, 'High')}${opt('quality', 'medium', st.quality, 'Medium')}${opt('quality', 'low', st.quality, 'Low')}</div>
          <div class="hint">Currently rendering at <b>${esc(m.quality)}</b>. Auto lowers resolution, shadows and particles if frames slow down.</div>
          <h3>Touch controls</h3>
          <div class="seg">${opt('touchControls', 'swipe', st.touchControls, 'Tap & swipe')}${opt('touchControls', 'buttons', st.touchControls, 'On-screen buttons')}</div>
          <h3>Keyboard</h3>
          <div class="statgrid keys">
            <span>Solo</span><b>WASD / Arrows · Space hops</b>
            ${[0, 1, 2, 3].map((i) => `<span style="color:${PLAYER_COLORS[i]}">Player ${i + 1}</span><b>${KEY_HELP[i]}</b>`).join('')}
            <span>Pause</span><b>P / Esc</b>
          </div>
          <button class="btn small danger" data-action="reset-save">Reset progress</button>
        </div>
      </div>`;
  }

  private pauseHtml(): string {
    return `
      <div class="panel">
        <h2>Paused</h2>
        <button class="btn big primary" data-action="resume" data-autofocus>Resume</button>
        <button class="btn" data-action="restart">Restart</button>
        <button class="btn" data-action="settings">Settings</button>
        <button class="btn" data-action="quit">Main menu</button>
      </div>`;
  }

  private lobbyHtml(m: UIModel): string {
    const cards = m.lobby
      .map((id, i) => {
        const c = CHARACTERS.find((x) => x.id === id)!;
        return `<div class="pcard" style="--pc:${PLAYER_COLORS[i]}">
          <div class="ptitle">Player ${i + 1}</div>
          <div class="thumb"><img src="${m.thumb(id)}" alt=""></div>
          <div class="cname">${esc(c.name)}</div>
          <div class="row"><button class="btn small" data-action="lobby-prev" data-arg="${i}" aria-label="Previous character">◀</button><button class="btn small" data-action="lobby-next" data-arg="${i}" aria-label="Next character">▶</button></div>
          <div class="hint">${m.isTouch ? `Zone ${i + 1} of the screen` : esc(KEY_HELP[i])}</div>
        </div>`;
      })
      .join('');
    return `
      <div class="panel wide">
        <div class="bar"><button class="btn small" data-action="back">← Back</button><h2>${m.playerCount} Player Party</h2></div>
        <div class="scroll lobby">${cards}</div>
        <button class="btn big primary" data-action="start-multi" data-autofocus>Start!</button>
        <div class="hint">${m.isTouch ? 'The screen is split into vertical strips — each player taps & swipes in their own strip.' : 'Everyone shares one keyboard. Fall behind the camera and the Stormray gets you!'}</div>
      </div>`;
  }

  showGameOver(d: GameOverData): void {
    this.screen = 'gameover';
    const multi = d.scores.length > 1;
    const winner = multi ? [...d.scores].sort((a, b) => b.score - a.score)[0] : null;
    const scores = multi
      ? `<div class="mscores">${d.scores
          .map((s) => `<div class="ms" style="--pc:${PLAYER_COLORS[s.player]}"><span>P${s.player + 1} · ${esc(s.name)}</span><b>${s.score}</b>${winner && winner.player === s.player ? '<em>WIN</em>' : ''}</div>`)
          .join('')}</div>`
      : `<div class="final">${d.scores[0]?.score ?? 0}</div>`;
    const extra = [
      ...d.completed.map((t) => `<li>✔ Mission: ${esc(t)}</li>`),
      ...d.unlocked.map((t) => `<li>🔓 Unlocked: ${esc(t)}</li>`),
      ...d.achievements.map((t) => `<li>★ ${esc(t)}</li>`),
    ].join('');
    this.overlay.hidden = false;
    this.overlay.className = 'overlay screen-gameover';
    this.overlay.innerHTML = `
      <div class="panel gameover">
        <h2>${multi ? `Player ${winner!.player + 1} wins!` : 'Game Over'}</h2>
        ${scores}
        <div class="stats-row">
          <span class="pill ${d.newBest ? 'best' : ''}">${d.newBest ? 'NEW BEST ' : 'Best '}<b>${d.best}</b></span>
          <span class="pill">+${coinIcon}<b>${d.coinsRun}</b> → ${d.coinsTotal}</span>
        </div>
        ${extra ? `<ul class="news">${extra}</ul>` : ''}
        <button class="btn big primary" data-action="retry" data-autofocus>Play again</button>
        <div class="grid2">
          <button class="btn" data-action="characters">Characters</button>
          <button class="btn ${d.coinsTotal >= PRIZE_COST ? 'glow' : ''}" data-action="prize">Prize Machine</button>
        </div>
        <button class="btn small" data-action="quit">Main menu</button>
      </div>`;
    // Guard against an accidental tap carried over from the death.
    const btns = this.overlay.querySelectorAll<HTMLButtonElement>('button');
    btns.forEach((b) => (b.disabled = true));
    window.setTimeout(() => {
      btns.forEach((b) => (b.disabled = false));
      this.overlay.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    }, 550);
  }

  // ------------------------------------------------------------------ HUD

  showHud(players: number, names: string[], touchButtons: boolean, isTouch: boolean): void {
    this.hud.hidden = false;
    const multi = players > 1;
    this.hud.innerHTML = `
      <div class="hud-left">
        ${multi
          ? names.map((_n, i) => `<div class="pscore" style="--pc:${PLAYER_COLORS[i]}"><span>P${i + 1}</span><b data-score="${i}">0</b></div>`).join('')
          : `<div class="score" data-score="0">0</div><div class="best">BEST <span data-best>${this.model().save.bestScore}</span></div>`}
      </div>
      <div class="hud-right">
        <div class="coins">${coinIcon}<b data-coins>0</b></div>
        <button class="btn icon" data-action="pause" aria-label="Pause">❚❚</button>
      </div>`;
    this.scoreEls = Array.from(this.hud.querySelectorAll<HTMLElement>('[data-score]'));
    this.coinEl = this.hud.querySelector('[data-coins]');
    this.bestEl = this.hud.querySelector('[data-best]');
    this.lastScores = names.map(() => -1);
    this.lastCoins = -1;
    this.dpad.hidden = !(touchButtons && isTouch && players === 1);
    this.zones.hidden = !(isTouch && multi);
    this.zones.innerHTML = multi
      ? Array.from({ length: players }, (_, i) => `<div class="zone" style="--pc:${PLAYER_COLORS[i]}"><span>P${i + 1}</span></div>`).join('')
      : '';
  }

  hideHud(): void {
    this.hud.hidden = true;
    this.dpad.hidden = true;
    this.zones.hidden = true;
  }

  setScore(i: number, score: number, dead = false): void {
    if (this.lastScores[i] === score && !dead) return;
    this.lastScores[i] = score;
    const el = this.scoreEls[i];
    if (!el) return;
    el.textContent = String(score);
    el.parentElement?.classList.toggle('dead', dead);
  }

  setBest(best: number): void {
    if (this.bestEl) this.bestEl.textContent = String(best);
  }

  setCoins(n: number): void {
    if (n === this.lastCoins || !this.coinEl) return;
    this.lastCoins = n;
    this.coinEl.textContent = String(n);
    const box = this.coinEl.parentElement!;
    box.classList.remove('pop');
    void box.offsetWidth;
    box.classList.add('pop');
  }

  toast(text: string, kind: 'info' | 'gold' | 'secret' = 'info'): void {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.appendChild(el);
    window.setTimeout(() => el.classList.add('out'), 2600);
    window.setTimeout(() => el.remove(), 3100);
  }

  setDebug(text: string | null): void {
    this.debug.hidden = text === null;
    if (text !== null) this.debug.textContent = text;
  }
}
