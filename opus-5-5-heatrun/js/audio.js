// All sound is synthesised with WebAudio: engine, tyres, nitrous, siren,
// impacts, UI blips, helicopter and a small procedural driving score.
export class Audio {
  constructor() { this.ctx = null; this.vol = 0.7; this.musicOn = true; this.mode = 'menu'; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.vol; this.master.connect(c.destination);
    // noise buffer
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    // engine: two detuned saws + square sub through a lowpass
    this.eng = c.createGain(); this.eng.gain.value = 0;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 4;
    this.engLP = lp;
    this.o1 = c.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = c.createOscillator(); this.o2.type = 'sawtooth'; this.o2.detune.value = 14;
    this.o3 = c.createOscillator(); this.o3.type = 'square';
    const g3 = c.createGain(); g3.gain.value = 0.5;
    this.o1.connect(lp); this.o2.connect(lp); this.o3.connect(g3); g3.connect(lp);
    lp.connect(this.eng); this.eng.connect(this.master);
    [this.o1, this.o2, this.o3].forEach((o) => o.start());
    // tyre squeal: band-passed noise
    this.tire = this.loopNoise('bandpass', 1800, 6);
    // wind / nitrous hiss
    this.wind = this.loopNoise('highpass', 900, 0.5);
    this.nos = this.loopNoise('bandpass', 3500, 1.5);
    // siren
    this.sirenG = c.createGain(); this.sirenG.gain.value = 0;
    this.siren = c.createOscillator(); this.siren.type = 'triangle'; this.siren.frequency.value = 700;
    const sLfo = c.createOscillator(); sLfo.frequency.value = 0.45;
    const sAmt = c.createGain(); sAmt.gain.value = 330;
    sLfo.connect(sAmt); sAmt.connect(this.siren.frequency);
    this.siren.connect(this.sirenG); this.sirenG.connect(this.master);
    this.siren.start(); sLfo.start();
    // helicopter: chopped low noise
    this.heliG = c.createGain(); this.heliG.gain.value = 0;
    const hn = c.createBufferSource(); hn.buffer = nb; hn.loop = true;
    const hlp = c.createBiquadFilter(); hlp.type = 'lowpass'; hlp.frequency.value = 220;
    const chop = c.createGain(); chop.gain.value = 0.5;
    const cl = c.createOscillator(); cl.type = 'square'; cl.frequency.value = 11;
    const clg = c.createGain(); clg.gain.value = 0.5; cl.connect(clg); clg.connect(chop.gain);
    hn.connect(hlp); hlp.connect(chop); chop.connect(this.heliG); this.heliG.connect(this.master);
    hn.start(); cl.start();
    this.music = new Music(c, this.master);
  }
  loopNoise(type, freq, q) {
    const c = this.ctx, src = c.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    return g;
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }

  // per-frame engine + ambience update
  update(p, ctx) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const r = p.rpm / 8000;
    const base = 38 + r * 150;
    this.o1.frequency.setTargetAtTime(base, t, 0.03);
    this.o2.frequency.setTargetAtTime(base * 1.005, t, 0.03);
    this.o3.frequency.setTargetAtTime(base / 2, t, 0.03);
    this.engLP.frequency.setTargetAtTime(500 + r * 2600 * (0.4 + 0.6 * p.input.throttle), t, 0.05);
    this.eng.gain.setTargetAtTime(ctx.active ? 0.08 + 0.1 * p.input.throttle : 0, t, 0.05);
    this.tire.gain.setTargetAtTime(ctx.active ? Math.min(0.22, Math.max(0, p.slip - 3.5) * 0.03) : 0, t, 0.05);
    this.wind.gain.setTargetAtTime(ctx.active ? Math.min(0.12, p.speed * 0.0016) : 0, t, 0.1);
    this.nos.gain.setTargetAtTime(ctx.active && p.nitroOn ? 0.12 : 0, t, 0.05);
    this.sirenG.gain.setTargetAtTime(ctx.active ? Math.min(0.06, ctx.siren) : 0, t, 0.3);
    this.heliG.gain.setTargetAtTime(ctx.active ? Math.min(0.5, ctx.heli) : 0, t, 0.3);
    if (this.music) this.music.update(ctx.music, this.musicOn);
  }

  burst(freq, dur, gain, type = 'lowpass') {
    if (!this.ctx) return;
    const c = this.ctx, src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(gain, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(); src.stop(c.currentTime + dur);
  }
  tone(freq, dur, gain = 0.15, type = 'square', slide = 0) {
    if (!this.ctx) return;
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, c.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, c.currentTime + dur);
    g.gain.setValueAtTime(gain, c.currentTime); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g); g.connect(this.master); o.start(); o.stop(c.currentTime + dur);
  }
  impact(v) { this.burst(300 + v * 20, 0.25 + Math.min(0.4, v * 0.02), Math.min(0.8, 0.1 + v * 0.03)); }
  beep(go) { this.tone(go ? 880 : 440, go ? 0.5 : 0.25, 0.18, 'square'); }
  checkpoint() { this.tone(1046, 0.12, 0.12, 'triangle'); setTimeout(() => this.tone(1568, 0.18, 0.12, 'triangle'), 90); }
  camera() { this.burst(5000, 0.12, 0.3, 'highpass'); }
  ui() { this.tone(660, 0.06, 0.08, 'triangle'); }
  pop() { this.burst(1200, 0.4, 0.8, 'bandpass'); }
  whoosh() { if (!this.ctx) return; this.burst(2000, 0.6, 0.35, 'bandpass'); this.tone(180, 0.6, 0.15, 'sawtooth', 0.4); }
  radio() { this.burst(2400, 0.08, 0.15, 'bandpass'); }
  wreck() { this.burst(180, 0.9, 0.9); this.burst(2500, 0.5, 0.3, 'highpass'); }
  crash() { this.burst(250, 0.6, 0.6); }
  sfx(name) {
    if (name === 'pop') this.pop();
    else if (name === 'wreck') this.wreck();
    else if (name === 'siren') this.tone(900, 0.3, 0.1, 'triangle', 1.4);
    else if (name === 'heli') this.burst(120, 1.2, 0.4);
  }
}

// Tiny step sequencer: moody minor groove for free roam, driving beat for races,
// faster aggressive pattern for pursuits. Entirely original patterns.
class Music {
  constructor(c, out) {
    this.c = c; this.out = c.createGain(); this.out.gain.value = 0.32; this.out.connect(out);
    this.step = 0; this.next = c.currentTime + 0.1; this.mode = 'roam';
    const comp = c.createDynamicsCompressor(); this.out.disconnect(); this.out.connect(comp); comp.connect(out);
  }
  update(mode, on) {
    this.mode = mode;
    this.out.gain.setTargetAtTime(on && mode !== 'off' ? 0.32 : 0, this.c.currentTime, 0.4);
    if (!on || mode === 'off') return;
    const bpm = mode === 'pursuit' ? 148 : mode === 'race' ? 132 : mode === 'menu' ? 92 : 104;
    const dt = 60 / bpm / 4;
    while (this.next < this.c.currentTime + 0.15) { this.play(this.step, this.next, mode); this.step = (this.step + 1) % 64; this.next += dt; }
  }
  play(s, t, mode) {
    const c = this.c;
    const bar = Math.floor(s / 16), st = s % 16;
    const roots = mode === 'pursuit' ? [41, 41, 44, 39] : [38, 38, 34, 36]; // MIDI roots
    const root = roots[bar];
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    // kick
    const kickPat = mode === 'pursuit' ? [0, 4, 8, 10, 12] : mode === 'menu' ? [0, 10] : [0, 6, 8];
    if (kickPat.includes(st)) {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.3);
    }
    // snare / clap
    if ((st === 4 || st === 12) && mode !== 'menu') this.noise(t, 0.18, 0.35, 1800, 'bandpass');
    // hats
    if (st % 2 === 0 || mode === 'pursuit') this.noise(t, 0.04, st % 4 === 2 ? 0.14 : 0.07, 8000, 'highpass');
    // bass
    const bassPat = mode === 'pursuit' ? [0, 2, 3, 6, 8, 10, 11, 14] : [0, 3, 7, 10, 14];
    if (bassPat.includes(st)) {
      const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.value = hz(root + (st === 14 ? 7 : st === 10 ? 3 : 0));
      f.type = 'lowpass'; f.frequency.setValueAtTime(mode === 'pursuit' ? 900 : 500, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.18);
      g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(f); f.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.25);
    }
    // pad stab on bar start
    if (st === 0) for (const iv of [12, 15, 19]) {
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = hz(root + iv);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.3); g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
      o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 1.9);
    }
    // pursuit: urgent lead arpeggio
    if (mode === 'pursuit' && st % 2 === 0) {
      const arp = [24, 27, 31, 27, 24, 31, 34, 31];
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square'; o.frequency.value = hz(root + arp[(st / 2) % 8]);
      g.gain.setValueAtTime(0.035, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.12);
    }
  }
  noise(t, dur, gain, freq, type) {
    const c = this.c, n = c.createBufferSource();
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = buf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(this.out); n.start(t); n.stop(t + dur);
  }
}
