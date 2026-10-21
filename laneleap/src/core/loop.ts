/**
 * Fixed-timestep game loop. Simulation always advances in FIXED_STEP slices;
 * frame deltas are clamped so a backgrounded tab or a long hitch never
 * produces a giant jump, and the step count per frame is capped.
 */
import { FIXED_STEP, MAX_FRAME_DT, MAX_STEPS_PER_FRAME } from './constants';

export class FixedLoop {
  private acc = 0;
  private last = -1;
  private raf = 0;
  running = false;
  /** Real (unclamped) duration of the last frame in ms, for perf monitoring. */
  frameMs = 16.7;

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: (frameDt: number) => void,
    private readonly step = FIXED_STEP,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = -1;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Forget accumulated time (e.g. after unpausing). */
  resetClock(): void {
    this.last = -1;
    this.acc = 0;
  }

  /** Advance one frame manually (tests / headless). Returns steps taken. */
  tick(dtSeconds: number): number {
    const dt = Math.min(Math.max(dtSeconds, 0), MAX_FRAME_DT);
    this.acc += dt;
    let steps = 0;
    while (this.acc >= this.step && steps < MAX_STEPS_PER_FRAME) {
      this.update(this.step);
      this.acc -= this.step;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0;
    return steps;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    if (this.last < 0) this.last = now;
    const raw = (now - this.last) / 1000;
    this.last = now;
    this.frameMs = raw * 1000;
    this.tick(raw);
    this.render(Math.min(raw, MAX_FRAME_DT));
  };
}
