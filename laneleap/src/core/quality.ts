/**
 * Graphics quality presets and an automatic fallback that watches frame time
 * and steps quality down (pixel ratio, shadows, particles) when a device
 * cannot hold its frame budget. It never steps back up within a session to
 * avoid oscillating.
 */
export type QualityName = 'high' | 'medium' | 'low';

export interface QualityLevel {
  name: QualityName;
  pixelRatio: number;
  shadows: boolean;
  shadowMapSize: number;
  particles: number;
}

export const QUALITY_LEVELS: Record<QualityName, QualityLevel> = {
  high: { name: 'high', pixelRatio: 2, shadows: true, shadowMapSize: 1024, particles: 1 },
  medium: { name: 'medium', pixelRatio: 1.5, shadows: true, shadowMapSize: 512, particles: 0.6 },
  low: { name: 'low', pixelRatio: 1, shadows: false, shadowMapSize: 512, particles: 0.3 },
};

const ORDER: QualityName[] = ['high', 'medium', 'low'];

export class AutoQuality {
  private acc = 0;
  private frames = 0;
  private slowWindows = 0;
  private warmup = 2;
  enabled = true;

  constructor(
    public current: QualityName,
    private readonly onChange: (q: QualityLevel) => void,
    /** Average frame time (ms) above which a window counts as slow. */
    private readonly budgetMs = 21,
    private readonly windowMs = 1500,
  ) {}

  /** Feed the real (unclamped) frame time in ms. */
  sample(frameMs: number): void {
    if (!this.enabled) return;
    if (frameMs > 250) return; // tab switch / hitch, not a perf signal
    this.acc += frameMs;
    this.frames++;
    if (this.acc < this.windowMs) return;
    const avg = this.acc / this.frames;
    this.acc = 0;
    this.frames = 0;
    if (this.warmup > 0) {
      this.warmup--;
      return;
    }
    if (avg > this.budgetMs) this.slowWindows++;
    else this.slowWindows = Math.max(0, this.slowWindows - 1);
    if (this.slowWindows >= 2) {
      this.slowWindows = 0;
      this.stepDown();
    }
  }

  stepDown(): boolean {
    const i = ORDER.indexOf(this.current);
    if (i >= ORDER.length - 1) return false;
    this.current = ORDER[i + 1];
    this.warmup = 1;
    this.onChange(QUALITY_LEVELS[this.current]);
    return true;
  }

  reset(q: QualityName): void {
    this.current = q;
    this.acc = 0;
    this.frames = 0;
    this.slowWindows = 0;
    this.warmup = 2;
  }
}

export function defaultQualityFor(isMobile: boolean): QualityName {
  return isMobile ? 'medium' : 'high';
}
