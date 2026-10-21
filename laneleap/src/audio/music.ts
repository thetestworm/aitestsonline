/**
 * A small step sequencer playing an original looping tune: a I–vi–IV–V style
 * progression with a hand-written melody, plucky arpeggios, bass and light
 * percussion. Scheduled ahead on the audio clock so it never drifts with frame rate.
 */
const BPM = 112;
const STEP = 60 / BPM / 2; // eighth notes
const LOOKAHEAD = 0.25;

// MIDI helpers
const n = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// Bars: root notes (MIDI) and chord tones for the arpeggio.
const CHORDS: [number, number[]][] = [
  [48, [60, 64, 67, 72]], // C
  [45, [57, 60, 64, 69]], // Am
  [41, [57, 60, 65, 69]], // F
  [43, [55, 59, 62, 67]], // G
  [48, [60, 64, 67, 72]],
  [52, [59, 64, 67, 71]], // Em
  [41, [57, 60, 65, 69]],
  [43, [55, 59, 62, 67]],
];

// Melody: 8 bars x 8 eighth-note steps; 0 = rest. Written for Laneleap.
const MELODY: number[] = [
  72, 0, 74, 76, 0, 79, 76, 0,
  74, 0, 72, 69, 0, 72, 0, 0,
  69, 0, 72, 74, 0, 77, 76, 74,
  71, 0, 74, 0, 79, 0, 0, 0,
  76, 0, 79, 81, 0, 79, 76, 0,
  79, 0, 76, 74, 0, 71, 0, 0,
  72, 74, 0, 77, 0, 76, 74, 72,
  74, 0, 0, 71, 0, 67, 0, 0,
];

export class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  /** 0..1, raises the arrangement density as runs get intense. */
  intensity = 0;
  playing = false;

  attach(ctx: AudioContext, out: GainNode, noise: AudioBuffer): void {
    this.ctx = ctx;
    this.out = out;
    this.noise = noise;
  }

  start(): void {
    if (this.playing || !this.ctx) return;
    this.playing = true;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 60);
  }

  stop(): void {
    this.playing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') {
      if (ctx) this.nextTime = ctx.currentTime + 0.1;
      return;
    }
    // If we fell far behind (tab throttled), skip ahead instead of bursting notes.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % (CHORDS.length * 8);
    }
  }

  private playStep(step: number, t: number): void {
    const bar = Math.floor(step / 8);
    const s = step % 8;
    const [root, chord] = CHORDS[bar];
    // Bass on 1 and the "and" of 2, plus octave pop.
    if (s === 0 || s === 3) this.voice('triangle', n(root), t, STEP * 1.8, 0.5);
    if (s === 6) this.voice('triangle', n(root + 12), t, STEP * 0.9, 0.3);
    // Arpeggio pluck.
    const arp = chord[(s * 3) % chord.length];
    this.voice('sine', n(arp), t, STEP * 0.9, 0.12 + this.intensity * 0.06);
    // Melody.
    const m = MELODY[step];
    if (m) this.voice('square', n(m), t, STEP * 1.4, 0.07, 1600);
    // Percussion.
    if (s === 0 || s === 4) this.kick(t);
    if (s % 2 === 1) this.hat(t, 0.05 + this.intensity * 0.04);
    if (s === 4 && this.intensity > 0.3) this.snare(t);
  }

  private voice(
    type: OscillatorType,
    freq: number,
    t: number,
    dur: number,
    vol: number,
    cutoff?: number,
  ): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (cutoff) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      o.connect(f).connect(g);
    } else {
      o.connect(g);
    }
    g.connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.18);
  }

  private hat(t: number, vol: number): void {
    this.noiseHit(t, 0.04, vol, 7000, 'highpass');
  }

  private snare(t: number): void {
    this.noiseHit(t, 0.12, 0.18, 1800, 'bandpass');
  }

  private noiseHit(t: number, dur: number, vol: number, freq: number, type: BiquadFilterType): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}
