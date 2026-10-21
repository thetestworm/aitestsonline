/**
 * Procedural Web Audio: every sound effect and the music loop are synthesised
 * at runtime (no audio files), so all audio is original and the bundle stays tiny.
 *
 * Mobile quirks handled here:
 *  - the AudioContext is created/resumed inside the first user gesture;
 *  - iOS routes Web Audio through the ringer ("silent mode") channel, so we set
 *    `navigator.audioSession.type = 'playback'` where supported and also start a
 *    silent looping <audio> element, which promotes the page to the playback
 *    session on older iOS versions;
 *  - iOS can leave the context 'interrupted' after calls/Siri/backgrounding, so
 *    we retry `resume()` on the next gesture and when the page becomes visible.
 */
import type { HopSound } from '../data/characters';
import { Music } from './music';

type Ctx = AudioContext;

/** Build a short silent 8-bit WAV as an object URL (used for the iOS session trick). */
function silentWavUrl(): string {
  const samples = 4000;
  const buf = new ArrayBuffer(44 + samples);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + samples, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  w(36, 'data');
  v.setUint32(40, samples, true);
  for (let i = 0; i < samples; i++) v.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

export class AudioEngine {
  ctx: Ctx | null = null;
  private master!: GainNode;
  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private noise!: AudioBuffer;
  private silentEl: HTMLAudioElement | null = null;
  readonly music = new Music();
  private sfxOn = true;
  private musicOn = true;
  private wantMusic = false;
  private paused = false;
  private lastBump = 0;
  retro = false;

  /** Install gesture listeners that unlock audio on the first interaction. */
  installUnlock(target: EventTarget = window): void {
    const unlock = () => {
      this.unlock();
    };
    for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) {
      target.addEventListener(ev, unlock, { capture: true, passive: true });
    }
  }

  unlock(): void {
    try {
      if (!this.ctx) this.create();
      const ctx = this.ctx;
      if (!ctx) return;
      if (ctx.state !== 'running' && !this.paused) void ctx.resume().catch(() => undefined);
      if (!this.silentEl) {
        const el = new Audio(silentWavUrl());
        el.loop = true;
        el.setAttribute('playsinline', '');
        el.volume = 0.0001;
        this.silentEl = el;
      }
      if (this.silentEl.paused && !this.paused) void this.silentEl.play().catch(() => undefined);
    } catch {
      /* audio unavailable: game continues silently */
    }
  }

  private create(): void {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) {
      try {
        nav.audioSession.type = 'playback';
      } catch {
        /* older Safari */
      }
    }
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxGain = ctx.createGain();
    this.musicGain = ctx.createGain();
    this.sfxGain.connect(this.master);
    this.musicGain.connect(this.master);
    this.applyVolumes();
    const len = Math.floor(ctx.sampleRate * 1);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    ctx.addEventListener('statechange', () => {
      // 'interrupted' is iOS-specific; try to recover when we are meant to be playing.
      if (ctx.state !== 'running' && !this.paused && document.visibilityState === 'visible') {
        void ctx.resume().catch(() => undefined);
      }
    });
    this.music.attach(ctx, this.musicGain, this.noise);
    if (this.wantMusic && this.musicOn) this.music.start();
  }

  setEnabled(sfx: boolean, music: boolean): void {
    this.sfxOn = sfx;
    this.musicOn = music;
    this.applyVolumes();
    if (music && this.wantMusic) this.music.start();
    if (!music) this.music.stop();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfxGain.gain.setTargetAtTime(this.sfxOn ? 0.8 : 0, t, 0.02);
    this.musicGain.gain.setTargetAtTime(this.musicOn ? 0.32 : 0, t, 0.05);
  }

  playMusic(on: boolean): void {
    this.wantMusic = on;
    if (on && this.musicOn) this.music.start();
    else this.music.stop();
  }

  setMusicIntensity(v: number): void {
    this.music.intensity = v;
  }

  /** Suspend everything (pause / hidden tab). */
  suspend(): void {
    this.paused = true;
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
    this.silentEl?.pause();
  }

  resume(): void {
    this.paused = false;
    if (this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);
    if (this.silentEl && this.silentEl.paused) void this.silentEl.play().catch(() => undefined);
  }

  // ------------------------------------------------------------- synthesis primitives

  private ready(): Ctx | null {
    const c = this.ctx;
    if (!c || c.state !== 'running' || !this.sfxOn) return null;
    return c;
  }

  private tone(
    type: OscillatorType,
    f0: number,
    f1: number,
    dur: number,
    vol: number,
    delay = 0,
    attack = 0.005,
  ): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxGain);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(
    dur: number,
    vol: number,
    freq: number,
    type: BiquadFilterType = 'lowpass',
    delay = 0,
    q = 0.8,
    sweepTo?: number,
  ): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxGain);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------- game sounds

  hop(s: HopSound): void {
    const jitter = 1 + (Math.random() - 0.5) * 0.08;
    const wave = this.retro ? 'square' : s.wave;
    this.tone(
      wave,
      s.f0 * jitter,
      s.f1 * jitter,
      s.dur,
      wave === 'square' || wave === 'sawtooth' ? 0.09 : 0.18,
    );
    if (s.noise) this.burst(0.05, s.noise * 0.25, 3000, 'bandpass');
  }

  bump(): void {
    const now = performance.now();
    if (now - this.lastBump < 90) return;
    this.lastBump = now;
    this.tone('triangle', 160, 90, 0.08, 0.2);
  }

  coin(): void {
    this.tone('square', 988, 988, 0.06, 0.07);
    this.tone('square', 1319, 1319, 0.14, 0.07, 0.055);
  }

  splash(): void {
    this.burst(0.5, 0.5, 1800, 'lowpass', 0, 0.7, 300);
    this.tone('sine', 420, 120, 0.25, 0.25);
  }

  squash(): void {
    this.burst(0.18, 0.6, 900, 'lowpass');
    this.tone('square', 140, 40, 0.22, 0.2);
    this.tone('sawtooth', 600, 300, 0.08, 0.06, 0.02);
  }

  honk(): void {
    this.tone('sawtooth', 330, 320, 0.18, 0.05);
    this.tone('sawtooth', 415, 405, 0.18, 0.05);
  }

  trainBell(): void {
    for (let i = 0; i < 4; i++) {
      this.tone('square', 1568, 1560, 0.12, 0.05, i * 0.36);
      this.tone('sine', 1568 * 2.4, 1568 * 2.4, 0.1, 0.03, i * 0.36);
    }
  }

  trainPass(): void {
    this.tone('sawtooth', 220, 210, 0.6, 0.07);
    this.tone('sawtooth', 277, 265, 0.6, 0.06);
    this.burst(1.1, 0.25, 500, 'lowpass', 0.1, 0.5, 200);
  }

  screech(): void {
    this.tone('sawtooth', 900, 1500, 0.25, 0.09);
    this.tone('sawtooth', 1500, 600, 0.45, 0.08, 0.22);
    this.burst(0.6, 0.18, 2500, 'bandpass', 0.05, 2);
  }

  flap(): void {
    this.burst(0.12, 0.25, 600, 'lowpass');
  }

  death(): void {
    this.tone('triangle', 520, 130, 0.5, 0.18, 0.05);
    this.tone('triangle', 390, 98, 0.6, 0.12, 0.2);
  }

  click(): void {
    this.tone('triangle', 800, 1100, 0.05, 0.12);
  }

  newBest(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, 0.14, 0.06, i * 0.09));
  }

  gift(): void {
    [784, 988, 1175, 1568].forEach((f, i) => this.tone('triangle', f, f, 0.2, 0.15, i * 0.08));
  }

  mission(): void {
    [659, 880, 1319].forEach((f, i) => this.tone('square', f, f, 0.12, 0.06, i * 0.1));
  }

  rattle(): void {
    for (let i = 0; i < 10; i++)
      this.burst(0.05, 0.25, 2000 + Math.random() * 2000, 'bandpass', i * 0.09, 3);
  }

  reveal(): void {
    this.burst(0.3, 0.4, 3000, 'highpass');
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      this.tone('triangle', f, f * 1.01, 0.35, 0.14, 0.15 + i * 0.07),
    );
  }
}
