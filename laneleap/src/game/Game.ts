/**
 * Top-level orchestrator: owns the renderer, world, players, audio, input,
 * UI and save data, and runs the menu → play → game-over state machine.
 */
import * as THREE from 'three';
import { Stage } from '../render/Stage';
import { PaletteAtlas } from '../render/atlas';
import { Particles, type ParticlePreset } from '../render/particles';
import { CharacterLibrary } from '../render/CharacterLibrary';
import { buildPredator } from '../render/models';
import { World } from '../world/World';
import { WORLDS } from '../world/worlds';
import type { WorldId } from '../data/worldIds';
import { Player } from '../entities/Player';
import { Predator } from '../entities/Predator';
import { Run, type RunHooks } from './Run';
import { FixedLoop } from '../core/loop';
import { InputManager } from '../core/input';
import type { Dir } from '../core/gestures';
import { Rng } from '../core/rng';
import { AudioEngine } from '../audio/AudioEngine';
import { UI, type GameOverData, type Screen, type UIModel } from '../ui/UI';
import {
  browserStore,
  defaultSave,
  giftAvailable,
  loadSave,
  localDay,
  writeSave,
  type SaveData,
} from '../core/save';
import { AutoQuality, QUALITY_LEVELS, defaultQualityFor, type QualityName } from '../core/quality';
import { CHARACTERS, RARITY_WEIGHT, getCharacter, type CharacterDef } from '../data/characters';
import {
  ACHIEVEMENTS,
  applyRunToMission,
  makeMission,
  missionText,
  type DeathCause,
} from '../data/missions';
import { DAILY_GIFT_MAX, DAILY_GIFT_MIN, PRIZE_COST } from '../core/constants';

type State = 'menu' | 'playing' | 'paused' | 'gameover';

const MAX_PLAYERS = 4;

export class Game {
  private readonly stage: Stage;
  private readonly atlas = new PaletteAtlas();
  private readonly envMat: THREE.MeshLambertMaterial;
  private readonly world: World;
  private readonly particles: Particles;
  private readonly audio = new AudioEngine();
  private readonly input: InputManager;
  private readonly ui: UI;
  private readonly chars: CharacterLibrary;
  private readonly store = browserStore();
  private save: SaveData;
  private readonly quality: AutoQuality;
  private readonly loop: FixedLoop;
  private readonly players: Player[] = [];
  private readonly predators: Predator[] = [];
  private run: Run | null = null;
  private state: State = 'menu';
  private playerCount = 1;
  private lobby: string[] = [];
  private readonly rng = new Rng((Date.now() ^ 0x5bd1e995) >>> 0);
  private themeId: WorldId | null = null;
  private readonly isTouch: boolean;
  private debug = false;
  private debugTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private fps = 60;
  private bestAnnounced = false;
  private returnTo: Screen = 'menu';
  private lastGameOver: GameOverData | null = null;
  private ambientTimer = 0;
  private lookAhead = 2;
  private viewOffset = -3;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.save = loadSave(this.store);
    this.stage = new Stage(canvas);
    this.envMat = new THREE.MeshLambertMaterial({ map: this.atlas.texture });
    this.world = new World(this.atlas, this.envMat);
    this.stage.scene.add(this.world.group);
    this.particles = new Particles(320);
    this.stage.scene.add(this.particles.mesh);
    this.chars = new CharacterLibrary(this.atlas);
    const predGeo = buildPredator(this.atlas);
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = new Player(i);
      this.players.push(p);
      const pr = new Predator(predGeo, this.envMat);
      this.predators.push(pr);
      this.stage.scene.add(pr.mesh);
    }
    this.world.onTrain = (_row, ev) =>
      ev === 'warn' ? this.audio.trainBell() : this.audio.trainPass();

    const startQ: QualityName =
      this.save.settings.quality === 'auto'
        ? defaultQualityFor(this.isTouch)
        : this.save.settings.quality;
    this.quality = new AutoQuality(startQ, (q) => {
      this.applyQuality(q.name);
      this.ui.toast(`Graphics lowered to ${q.name} for smoother play`);
    });
    this.quality.enabled = this.save.settings.quality === 'auto';

    this.input = new InputManager(canvas);
    this.input.onMove = (p, d) => this.onMove(p, d);
    this.input.onAction = (a) => this.onKeyAction(a);
    this.ui = new UI(uiRoot, () => this.uiModel());
    this.ui.onAction = (a, arg) => this.onUiAction(a, arg);
    this.audio.installUnlock();
    this.audio.setEnabled(this.save.settings.sound, this.save.settings.music);
    this.debug = /[?&]debug\b/.test(location.search);

    this.loop = new FixedLoop(
      (dt) => this.update(dt),
      (dt) => this.render(dt),
    );
    this.installLifecycle();
    this.applyQuality(startQ);
    this.ensureMissions();
  }

  /** Load lazy assets and show the main menu. */
  async init(onProgress: (p: number) => void): Promise<void> {
    onProgress(0.4);
    await this.chars.load();
    onProgress(0.8);
    this.prepareRun();
    this.loop.start();
    this.ui.show('menu');
    this.audio.playMusic(true);
    onProgress(1);
    // Warm thumbnails in idle time so the character screen opens instantly.
    this.warmThumbnails();
  }

  // ------------------------------------------------------------------ setup helpers

  private uiModel(): UIModel {
    return {
      save: this.save,
      quality: this.quality.current,
      playerCount: this.playerCount,
      lobby: this.lobby,
      isTouch: this.isTouch,
      giftReady: giftAvailable(this.save, new Date()),
      thumb: (id) => this.chars.thumbnail(getCharacter(id), this.stage.renderer),
      secretProgress: (def) => this.secretProgress(def),
    };
  }

  private warmThumbnails(): void {
    let i = 0;
    const step = () => {
      const t0 = performance.now();
      while (i < CHARACTERS.length && performance.now() - t0 < 6) {
        this.chars.thumbnail(CHARACTERS[i++], this.stage.renderer);
      }
      if (i < CHARACTERS.length) setTimeout(step, 50);
    };
    setTimeout(step, 400);
  }

  private applyQuality(name: QualityName): void {
    const q = QUALITY_LEVELS[name];
    this.stage.setQuality(q);
    this.world.setShadows(q.shadows);
    this.particles.density = q.particles;
    for (const p of this.players) if (p.mesh) p.mesh.castShadow = q.shadows;
    for (const pr of this.predators) pr.mesh.castShadow = q.shadows;
  }

  private persist(): void {
    writeSave(this.store, this.save);
  }

  private ensureMissions(): void {
    while (this.save.missions.length < 3) {
      const exclude = this.save.missions.map((m) => m.template);
      this.save.missions.push(makeMission(this.rng, this.save.stats.missionsCompleted, exclude));
    }
  }

  private themeFor(def: CharacterDef): WorldId {
    return this.save.settings.themedWorlds && def.world ? def.world : 'meadow';
  }

  private applyTheme(id: WorldId): void {
    if (this.themeId === id) return;
    this.themeId = id;
    const theme = WORLDS[id];
    this.world.setTheme(theme);
    this.stage.setTheme(theme);
    this.world.setShadows(QUALITY_LEVELS[this.quality.current].shadows);
  }

  private charactersForRun(): CharacterDef[] {
    if (this.playerCount <= 1) return [getCharacter(this.save.selected)];
    return this.lobby.slice(0, this.playerCount).map((id) => getCharacter(id));
  }

  /** Build a fresh world and spawn players, ready to play (shown behind menus). */
  private prepareRun(): void {
    for (const pr of this.predators) pr.reset();
    const defs = this.charactersForRun();
    this.applyTheme(this.themeFor(defs[0]));
    this.world.reset(this.rng.int(1, 2 ** 31 - 1));
    this.particles.clear();
    const active: Player[] = [];
    defs.forEach((def, i) => {
      const p = this.players[i];
      const model = this.chars.get(def);
      p.setModel(def, model.geometry, model.colors, this.atlas.texture);
      p.mesh!.castShadow = QUALITY_LEVELS[this.quality.current].shadows;
      if (!p.root.parent) this.stage.scene.add(p.root);
      active.push(p);
    });
    for (let i = defs.length; i < MAX_PLAYERS; i++) this.players[i].root.removeFromParent();
    this.chars.trim(new Set(defs.map((d) => d.id)));
    this.run = new Run(this.world, active, this.predators, this.hooks);
    this.audio.retro = defs[0].special === 'retro';
    this.bestAnnounced = false;
    this.lookAhead = window.innerWidth < window.innerHeight ? 2.2 : 1.2;
  }

  private startPlaying(): void {
    if (!this.run || this.run.elapsed > 0.01 || this.run.players.some((p) => p.hasMoved))
      this.prepareRun();
    this.state = 'playing';
    this.input.players = this.playerCount;
    this.input.swipe = this.save.settings.touchControls === 'swipe' || this.playerCount > 1;
    this.input.gameplay = true;
    this.input.reset();
    this.ui.show('none');
    const names = this.run!.players.map((p) => p.def.name);
    this.ui.showHud(
      this.playerCount,
      names,
      this.save.settings.touchControls === 'buttons',
      this.isTouch,
    );
    this.ui.setCoins(this.save.coins);
    this.audio.setMusicIntensity(0);
    this.loop.resetClock();
  }

  // ------------------------------------------------------------------ run hooks

  private readonly hooks: RunHooks = {
    hop: (p) => {
      this.audio.hop(p.def.hop);
      const z = -p.visualRow;
      this.emit('dust', p.x, p.y + 0.05, z, 2, ['#ffffff', '#e8e2d0']);
      if (p.def.special === 'rainbowTrail') {
        this.emit('rainbow', p.x, p.y + 0.3, z, 4, [
          '#ff5fa2',
          '#ffb347',
          '#ffe066',
          '#7ee8a5',
          '#7ad3ff',
          '#b388ff',
        ]);
      }
    },
    bump: () => this.audio.bump(),
    land: (p, lane) => {
      const z = -p.visualRow;
      if (lane?.kind === 'river') {
        this.emit('splash', p.x, 0, z, 3, [
          WORLDS[this.themeId ?? 'meadow'].ground.water,
          '#ffffff',
        ]);
      } else {
        this.emit('dust', p.x, 0.02, z, 3, ['#ffffff', '#ddd6c0']);
      }
    },
    coin: (_p, x, row, value) => {
      this.audio.coin();
      this.emit('coin', x, 0.5, -row, 6, ['#ffd23f', '#fff3a8']);
      if (value > 1) this.emit('sparks', x, 0.5, -row, 4, ['#fff6b0']);
      this.ui.setCoins(this.save.coins + (this.run?.coins ?? 0));
    },
    death: (p, cause) => this.onDeath(p, cause),
    predator: () => {
      this.audio.screech();
      setTimeout(() => this.audio.flap(), 450);
    },
    score: (p) => {
      this.ui.setScore(p.index, p.maxRow);
      const best = this.save.bestScore;
      if (best > 0 && p.maxRow > best && !this.bestAnnounced && this.playerCount === 1) {
        this.bestAnnounced = true;
        this.audio.newBest();
        this.ui.toast('New best!', 'gold');
      }
      if (this.playerCount === 1) this.ui.setBest(Math.max(best, p.maxRow));
      this.audio.setMusicIntensity(Math.min(1, p.maxRow / 150));
    },
  };

  private emit(
    preset: ParticlePreset,
    x: number,
    y: number,
    z: number,
    n: number,
    colors: readonly string[],
  ): void {
    this.particles.emit(preset, x, y, z, n, colors);
  }

  private onDeath(p: Player, cause: DeathCause): void {
    const z = -p.visualRow;
    const x = p.x;
    const y = p.y;
    const shake = this.save.settings.screenShake;
    const colors = p.colors;
    switch (cause) {
      case 'vehicle':
        this.audio.squash();
        this.emit('shatter', x, 0.2, z, 8, colors);
        if (shake) this.stage.shake(0.22);
        break;
      case 'train':
        this.audio.squash();
        this.emit('shatter', x, 0.4, z, 14, colors);
        if (shake) this.stage.shake(0.45);
        break;
      case 'water':
      case 'drift':
        this.audio.splash();
        this.emit('splash', x, -0.1, z, 18, [
          WORLDS[this.themeId ?? 'meadow'].ground.water,
          '#ffffff',
          '#d6f6ff',
        ]);
        if (shake) this.stage.shake(0.1);
        break;
      case 'predator':
        this.emit('feathers', x, y + 0.6, z, 10, colors);
        if (shake) this.stage.shake(0.25);
        break;
    }
    // Character-specific flourish.
    switch (p.def.death) {
      case 'feathers':
        this.emit('feathers', x, y + 0.4, z, 14, ['#ffffff', ...colors]);
        break;
      case 'sparks':
        this.emit('sparks', x, y + 0.4, z, 16, ['#fff36b', '#ffb02e', '#ffffff']);
        break;
      case 'confetti':
        this.emit('confetti', x, y + 0.4, z, 20, [
          '#ff5fa2',
          '#ffd23f',
          '#3fc1ff',
          '#7cff6b',
          '#b388ff',
        ]);
        break;
      case 'poof':
        this.emit('poof', x, y + 0.3, z, 12, ['#ffffff', '#f0f0f0']);
        break;
      case 'shatter':
        this.emit('shatter', x, y + 0.4, z, 18, colors);
        break;
      case 'ghost':
        this.emit('ghost', x, y + 0.4, z, 12, ['#ffffff', '#dff6ff']);
        break;
      default:
        break;
    }
    if (cause !== 'predator') this.audio.death();
    try {
      navigator.vibrate?.(cause === 'train' ? 120 : 60);
    } catch {
      /* not supported */
    }
    if (this.playerCount > 1) this.ui.setScore(p.index, p.maxRow, true);
  }

  private animateDeath(p: Player, dt: number): void {
    if (p.grabbed || p.alive || !p.root.visible) return;
    const t = p.deathT;
    const style = p.def.death;
    const vanish = style === 'poof' || style === 'shatter' || style === 'ghost';
    switch (p.deathCause) {
      case 'vehicle': {
        const k = Math.min(1, t / 0.07);
        const flat = style === 'melt' ? 0.06 : 0.14;
        p.body.scale.set(1 + 0.45 * k, 1 - (1 - flat) * k, 1 + 0.45 * k);
        p.y = Math.max(0.01, p.y - dt * 6);
        if (style === 'spin') p.body.rotation.y += dt * 18 * Math.max(0, 1 - t * 2);
        if (vanish && t > 0.12) p.root.visible = false;
        break;
      }
      case 'train':
        p.x += p.deathDir * 16 * dt;
        p.y += (5 - t * 14) * dt;
        p.body.rotation.x += dt * 14;
        p.body.rotation.z += dt * 9;
        if (t > 0.9 || vanish) p.root.visible = false;
        break;
      case 'water':
      case 'drift':
        p.y -= dt * 1.6;
        if (style === 'spin') p.body.rotation.y += dt * 14;
        if (t > 0.5 || (vanish && t > 0.1)) p.root.visible = false;
        break;
      default:
        break;
    }
    p.syncTransform();
  }

  // ------------------------------------------------------------------ loop

  private update(dt: number): void {
    const run = this.run;
    if (this.state === 'paused') return;
    if (run) {
      if (this.state === 'gameover') {
        this.world.update(dt, run.focusRow);
      } else {
        run.update(dt);
      }
      for (const p of run.players) this.animateDeath(p, dt);
      if (this.state === 'playing' && run.over) this.endRun();
    }
    this.particles.update(dt);
    this.stage.tickDay(dt);
    this.ambient(dt);
  }

  private ambient(dt: number): void {
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0 || !this.run) return;
    this.ambientTimer = 0.12;
    if (this.themeId === 'tundra') {
      const f = this.stage.focus;
      this.particles.emit(
        'snow',
        f.x + (Math.random() - 0.5) * 18,
        7,
        f.z + (Math.random() - 0.5) * 18,
        2,
        ['#ffffff'],
      );
    }
    for (const p of this.run.players) {
      if (p.alive && p.def.special === 'glow' && this.stage.night > 0.4 && Math.random() < 0.4) {
        this.emit('ghost', p.x, p.y + 0.5, -p.visualRow, 1, ['#7cff6b']);
      }
    }
  }

  private render(frameDt: number): void {
    const run = this.run;
    if (run) {
      // In menus the camera frames the character above the menu panel.
      const portrait = window.innerWidth < window.innerHeight;
      const target = this.state === 'menu' ? (portrait ? -3.2 : -2.6) : this.lookAhead;
      this.viewOffset += (target - this.viewOffset) * Math.min(1, frameDt * 4);
      this.stage.focus.set(run.focusX, 0, -(run.focusRow + this.viewOffset));
    }
    this.stage.update(frameDt, this.save.settings.screenShake);
    this.stage.render();
    if (this.state === 'playing') this.quality.sample(this.loop.frameMs);
    this.fpsFrames++;
    this.fpsTime += frameDt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    if (this.debug) {
      this.debugTimer -= frameDt;
      if (this.debugTimer <= 0) {
        this.debugTimer = 0.5;
        const info = this.stage.renderer.info;
        const ws = this.world.stats();
        this.ui.setDebug(
          `fps ${this.fps.toFixed(0)}  frame ${this.loop.frameMs.toFixed(1)}ms\n` +
            `quality ${this.quality.current}  dpr ${this.stage.renderer.getPixelRatio().toFixed(2)}\n` +
            `calls ${info.render.calls}  tris ${info.render.triangles}\n` +
            `geoms ${info.memory.geometries}  tex ${info.memory.textures}\n` +
            `lanes ${ws.lanes}  instances ${ws.instances}`,
        );
      }
    }
  }

  /** Exposed for automated performance tests. */
  perfSnapshot(): Record<string, number | string> {
    const info = this.stage.renderer.info;
    const ws = this.world.stats();
    return {
      fps: Math.round(this.fps),
      quality: this.quality.current,
      pixelRatio: this.stage.renderer.getPixelRatio(),
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      lanes: ws.lanes,
      instances: ws.instances,
      score: this.run?.stats.score ?? 0,
      state: this.state,
    };
  }

  // ------------------------------------------------------------------ input

  private onMove(player: number, dir: Dir): void {
    if (this.state !== 'playing' || !this.run) return;
    this.run.input(player, dir);
  }

  private onKeyAction(a: 'pause' | 'confirm' | 'back'): void {
    const scr = this.ui.screen;
    if (a === 'confirm') {
      if (this.state === 'menu' && scr === 'menu') this.onUiAction('play');
      else if (this.state === 'menu' && scr === 'lobby') this.onUiAction('start-multi');
      else if (this.state === 'gameover' && scr === 'gameover') this.onUiAction('retry');
      else if (this.state === 'paused' && scr === 'pause') this.resume();
      return;
    }
    if (this.state === 'playing') {
      this.pause();
      return;
    }
    if (this.state === 'paused' && scr === 'pause') {
      this.resume();
      return;
    }
    if (a === 'back' && ['characters', 'prize', 'missions', 'settings', 'lobby'].includes(scr)) {
      this.onUiAction('back');
    }
  }

  private onUiAction(action: string, arg?: string): void {
    if (action !== 'dpad') this.audio.click();
    switch (action) {
      case 'play':
        if (this.playerCount > 1) {
          this.openLobby();
        } else {
          this.startPlaying();
        }
        break;
      case 'retry':
        this.prepareRun();
        this.startPlaying();
        break;
      case 'restart':
        this.state = 'menu';
        this.audio.resume();
        this.prepareRun();
        this.startPlaying();
        break;
      case 'players':
        this.playerCount = Math.max(1, Math.min(4, Number(arg) || 1));
        this.ui.refresh();
        break;
      case 'start-multi':
        this.prepareRun();
        this.startPlaying();
        break;
      case 'lobby-next':
      case 'lobby-prev': {
        const i = Number(arg);
        const owned = CHARACTERS.filter((c) => this.save.unlocked.includes(c.id));
        const cur = owned.findIndex((c) => c.id === this.lobby[i]);
        const next = (cur + (action === 'lobby-next' ? 1 : -1) + owned.length) % owned.length;
        this.lobby[i] = owned[next].id;
        this.ui.refresh();
        break;
      }
      case 'characters':
      case 'missions':
      case 'settings':
      case 'prize':
        if (
          this.ui.screen === 'menu' ||
          this.ui.screen === 'gameover' ||
          this.ui.screen === 'pause'
        ) {
          this.returnTo = this.ui.screen;
        }
        this.ui.show(action);
        break;
      case 'back':
        this.goBack();
        break;
      case 'select':
        if (arg && this.save.unlocked.includes(arg)) {
          this.save.selected = arg;
          this.persist();
          if (this.state === 'menu') this.prepareRun();
          this.ui.refresh();
        }
        break;
      case 'select-play':
        if (arg && this.save.unlocked.includes(arg)) {
          this.save.selected = arg;
          this.persist();
          this.state = 'menu';
          this.input.gameplay = false;
          this.ui.hideHud();
          this.prepareRun();
          this.ui.show('menu');
        }
        break;
      case 'filter':
        this.ui.setFilter(arg ?? 'all');
        break;
      case 'roll':
        this.rollPrize();
        break;
      case 'gift':
        this.claimGift();
        break;
      case 'set':
        this.applySetting(arg ?? '');
        break;
      case 'reset-save':
        if (confirm('Reset all progress, coins and characters?')) {
          this.save = defaultSave();
          this.ensureMissions();
          this.persist();
          this.audio.setEnabled(true, true);
          this.prepareRun();
          this.ui.refresh();
        }
        break;
      case 'pause':
        this.pause();
        break;
      case 'resume':
        this.resume();
        break;
      case 'quit':
        this.toMenu();
        break;
      case 'dpad':
        if (arg) this.onMove(0, arg as Dir);
        break;
      default:
        break;
    }
  }

  private goBack(): void {
    if (this.state === 'gameover' && this.returnTo === 'gameover' && this.lastGameOver) {
      this.ui.showGameOver(this.lastGameOver);
      return;
    }
    if (this.state === 'paused') {
      this.ui.show('pause');
      return;
    }
    this.ui.show('menu');
  }

  private openLobby(): void {
    const owned = CHARACTERS.filter((c) => this.save.unlocked.includes(c.id)).map((c) => c.id);
    while (this.lobby.length < 4) {
      const base =
        this.lobby.length === 0 ? this.save.selected : owned[this.lobby.length % owned.length];
      this.lobby.push(base);
    }
    this.lobby[0] = this.lobby[0] ?? this.save.selected;
    this.returnTo = 'menu';
    this.ui.show('lobby');
  }

  private toMenu(): void {
    this.state = 'menu';
    this.input.gameplay = false;
    this.ui.hideHud();
    this.audio.resume();
    this.prepareRun();
    this.ui.show('menu');
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.gameplay = false;
    this.ui.show('pause');
    this.audio.suspend();
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.input.gameplay = true;
    this.input.reset();
    this.ui.show('none');
    this.audio.resume();
    this.loop.resetClock();
  }

  private applySetting(arg: string): void {
    const [key, value] = arg.split(':');
    const st = this.save.settings;
    switch (key) {
      case 'sound':
        st.sound = value === '1';
        break;
      case 'music':
        st.music = value === '1';
        break;
      case 'screenShake':
        st.screenShake = value === '1';
        break;
      case 'themedWorlds':
        st.themedWorlds = value === '1';
        if (this.state === 'menu') this.prepareRun();
        break;
      case 'touchControls':
        st.touchControls = value === 'buttons' ? 'buttons' : 'swipe';
        break;
      case 'quality':
        if (value === 'auto' || value === 'high' || value === 'medium' || value === 'low') {
          st.quality = value;
          const q = value === 'auto' ? defaultQualityFor(this.isTouch) : value;
          this.quality.enabled = value === 'auto';
          this.quality.reset(q);
          this.applyQuality(q);
        }
        break;
    }
    this.audio.setEnabled(st.sound, st.music);
    this.persist();
    this.ui.refresh();
  }

  // ------------------------------------------------------------------ progression

  private secretProgress(def: CharacterDef): string {
    const s = def.secret;
    if (!s) return '';
    const v = this.statValue(s.stat);
    return `${Math.min(v, s.value)}/${s.value}`;
  }

  private statValue(stat: NonNullable<CharacterDef['secret']>['stat']): number {
    if (stat === 'bestScore') return this.save.bestScore;
    return this.save.stats[stat];
  }

  private endRun(): void {
    const run = this.run!;
    this.state = 'gameover';
    this.input.gameplay = false;
    this.ui.hideHud();
    const save = this.save;
    const stats = run.stats;
    const score = run.bestRow;
    const prevBest = save.bestScore;
    save.coins += run.coins;
    save.bestScore = Math.max(save.bestScore, score);
    save.stats.gamesPlayed++;
    save.stats.totalCoinsEarned += run.coins;
    save.stats.totalHops += stats.hops;
    if (run.players.some((p) => p.deathCause === 'predator')) save.stats.predatorDeaths++;

    const completed: string[] = [];
    save.missions = save.missions.filter((m) => {
      if (applyRunToMission(m, stats)) {
        completed.push(missionText(m));
        save.coins += m.reward;
        save.stats.missionsCompleted++;
        return false;
      }
      return true;
    });
    this.ensureMissions();

    const unlocked: string[] = [];
    for (const c of CHARACTERS) {
      if (
        c.secret &&
        !save.unlocked.includes(c.id) &&
        this.statValue(c.secret.stat) >= c.secret.value
      ) {
        save.unlocked.push(c.id);
        unlocked.push(c.name);
      }
    }
    const achievements: string[] = [];
    for (const a of ACHIEVEMENTS) {
      if (save.achievements.includes(a.id)) continue;
      const ok = a.check({
        run: stats,
        bestScore: save.bestScore,
        totalCoinsEarned: save.stats.totalCoinsEarned,
        gamesPlayed: save.stats.gamesPlayed,
        unlockedCount: save.unlocked.length,
        missionsCompleted: save.stats.missionsCompleted,
      });
      if (ok) {
        save.achievements.push(a.id);
        achievements.push(a.name);
      }
    }
    this.persist();
    if (completed.length) this.audio.mission();
    if (score > prevBest && this.playerCount === 1) this.audio.newBest();
    const data: GameOverData = {
      scores: run.players.map((p) => ({ player: p.index, score: p.maxRow, name: p.def.name })),
      best: save.bestScore,
      newBest: score > prevBest,
      coinsRun: run.coins,
      coinsTotal: save.coins,
      completed,
      unlocked,
      achievements,
    };
    this.lastGameOver = data;
    this.returnTo = 'gameover';
    this.ui.showGameOver(data);
    for (const name of unlocked) this.ui.toast(`Secret unlocked: ${name}!`, 'secret');
  }

  private rollPrize(): void {
    const save = this.save;
    const pool = CHARACTERS.filter((c) => c.rarity !== 'secret' && !save.unlocked.includes(c.id));
    if (save.coins < PRIZE_COST || pool.length === 0) return;
    save.coins -= PRIZE_COST;
    let total = 0;
    for (const c of pool) total += RARITY_WEIGHT[c.rarity];
    let r = this.rng.next() * total;
    let pick = pool[0];
    for (const c of pool) {
      r -= RARITY_WEIGHT[c.rarity];
      if (r <= 0) {
        pick = c;
        break;
      }
    }
    save.unlocked.push(pick.id);
    if (save.unlocked.length >= 5 && !save.achievements.includes('collector5')) {
      save.achievements.push('collector5');
      this.ui.toast('Achievement: Collector', 'gold');
    }
    if (save.unlocked.length >= 15 && !save.achievements.includes('collector15')) {
      save.achievements.push('collector15');
      this.ui.toast('Achievement: Curator', 'gold');
    }
    this.persist();
    this.audio.rattle();
    const thumb = this.chars.thumbnail(pick, this.stage.renderer);
    // Re-render the panel with updated coins, then animate.
    this.ui.show('prize');
    this.ui.prizeReveal(pick, thumb);
    setTimeout(() => this.audio.reveal(), 1400);
  }

  private claimGift(): void {
    const now = new Date();
    if (!giftAvailable(this.save, now)) return;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    this.save.giftStreak =
      this.save.lastGiftDay === localDay(yesterday) ? this.save.giftStreak + 1 : 1;
    const bonus = Math.min(this.save.giftStreak - 1, 5) * 10;
    const amount = this.rng.int(DAILY_GIFT_MIN, DAILY_GIFT_MAX) + bonus;
    this.save.coins += amount;
    this.save.lastGiftDay = localDay(now);
    this.persist();
    this.audio.gift();
    this.ui.toast(
      `Daily gift: +${amount} coins${this.save.giftStreak > 1 ? ` (${this.save.giftStreak}-day streak!)` : ''}`,
      'gold',
    );
    this.ui.refresh();
  }

  // ------------------------------------------------------------------ lifecycle

  private installLifecycle(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.pause();
        this.audio.suspend();
      } else {
        if (this.state !== 'paused') this.audio.resume();
        this.loop.resetClock();
      }
    });
    window.addEventListener('pagehide', () => {
      this.pause();
      this.persist();
    });
    window.addEventListener('blur', () => this.pause());
    const onOrient = () => {
      this.pause();
      setTimeout(() => this.onResize(), 120);
    };
    window.addEventListener('orientationchange', onOrient);
    screen.orientation?.addEventListener?.('change', onOrient);
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3' || (e.code === 'Backquote' && e.shiftKey)) {
        this.debug = !this.debug;
        if (!this.debug) this.ui.setDebug(null);
        e.preventDefault();
      }
    });
  }

  private onResize(): void {
    this.stage.resize();
    this.lookAhead = window.innerWidth < window.innerHeight ? 2.2 : 1.2;
  }
}
