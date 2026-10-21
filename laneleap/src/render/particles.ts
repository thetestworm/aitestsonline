/**
 * Pooled voxel particles drawn with one InstancedMesh. All state lives in
 * preallocated typed arrays; emitting and updating never allocates.
 */
import * as THREE from 'three';

export type ParticlePreset =
  | 'dust'
  | 'splash'
  | 'feathers'
  | 'sparks'
  | 'confetti'
  | 'shatter'
  | 'ghost'
  | 'coin'
  | 'rainbow'
  | 'poof'
  | 'snow';

interface PresetDef {
  speed: number;
  up: number;
  gravity: number;
  drag: number;
  life: number;
  size: number;
  spin: number;
}

const PRESETS: Record<ParticlePreset, PresetDef> = {
  dust: { speed: 1.2, up: 0.8, gravity: -2, drag: 4, life: 0.35, size: 0.12, spin: 4 },
  splash: { speed: 2.2, up: 4.5, gravity: -14, drag: 0.5, life: 0.7, size: 0.14, spin: 3 },
  feathers: { speed: 1.8, up: 2.5, gravity: -1.2, drag: 2.5, life: 1.4, size: 0.11, spin: 8 },
  sparks: { speed: 4, up: 3, gravity: -9, drag: 1.5, life: 0.6, size: 0.08, spin: 10 },
  confetti: { speed: 3, up: 5, gravity: -6, drag: 1.8, life: 1.3, size: 0.1, spin: 12 },
  shatter: { speed: 3.2, up: 4, gravity: -15, drag: 0.6, life: 1.1, size: 0.16, spin: 6 },
  ghost: { speed: 0.5, up: 1.6, gravity: 0.6, drag: 1.5, life: 1.6, size: 0.12, spin: 2 },
  coin: { speed: 1.6, up: 3, gravity: -8, drag: 1, life: 0.5, size: 0.08, spin: 10 },
  rainbow: { speed: 0.2, up: 0.4, gravity: -0.5, drag: 3, life: 0.8, size: 0.13, spin: 1 },
  poof: { speed: 2.4, up: 1.6, gravity: -1, drag: 4.5, life: 0.6, size: 0.2, spin: 3 },
  snow: { speed: 0.3, up: -0.6, gravity: 0, drag: 0, life: 6, size: 0.06, spin: 2 },
};

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private readonly cap: number;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly colors: Float32Array;
  private cursor = 0;
  private live = 0;
  /** Quality multiplier for emitted counts. */
  density = 1;
  private readonly tmpColor = new THREE.Color();

  constructor(capacity = 320) {
    this.cap = capacity;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'particles';
    this.colors = new Float32Array(capacity * 3).fill(1);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    const f = () => new Float32Array(capacity);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.life = f();
    this.maxLife = f();
    this.size = f();
    this.grav = f();
    this.drag = f();
    this.rot = f();
    this.spin = f();
    (this.mesh.instanceMatrix.array as Float32Array).fill(0);
    this.mesh.count = capacity;
  }

  /**
   * Emit `count` particles. `palette` is a list of CSS colours; one is chosen per particle.
   */
  emit(
    preset: ParticlePreset,
    x: number,
    y: number,
    z: number,
    count: number,
    palette: readonly string[],
    scale = 1,
  ): void {
    const p = PRESETS[preset];
    const n = Math.max(1, Math.round(count * this.density));
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.cap;
      if (this.life[i] <= 0) this.live++;
      const a = Math.random() * Math.PI * 2;
      const s = p.speed * (0.4 + Math.random() * 0.8) * scale;
      this.px[i] = x + (Math.random() - 0.5) * 0.3 * scale;
      this.py[i] = y + Math.random() * 0.2;
      this.pz[i] = z + (Math.random() - 0.5) * 0.3 * scale;
      this.vx[i] = Math.cos(a) * s;
      this.vz[i] = Math.sin(a) * s;
      this.vy[i] = p.up * (0.6 + Math.random() * 0.7) * scale;
      this.life[i] = this.maxLife[i] = p.life * (0.7 + Math.random() * 0.6);
      this.size[i] = p.size * (0.7 + Math.random() * 0.6) * scale;
      this.grav[i] = p.gravity;
      this.drag[i] = p.drag;
      this.rot[i] = Math.random() * 6;
      this.spin[i] = (Math.random() - 0.5) * p.spin;
      this.tmpColor.set(palette[(Math.random() * palette.length) | 0] ?? '#ffffff');
      this.colors[i * 3] = this.tmpColor.r;
      this.colors[i * 3 + 1] = this.tmpColor.g;
      this.colors[i * 3 + 2] = this.tmpColor.b;
    }
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number): void {
    if (this.live <= 0) return;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    let alive = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const o = i * 16;
      if (this.life[i] <= 0) {
        m.fill(0, o, o + 16);
        continue;
      }
      alive++;
      const damp = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= damp;
      this.vz[i] *= damp;
      this.vy[i] = this.vy[i] * damp + this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < -0.3 && this.grav[i] < 0) {
        this.py[i] = -0.3;
        this.vy[i] = 0;
      }
      this.rot[i] += this.spin[i] * dt;
      const t = this.life[i] / this.maxLife[i];
      const s = this.size[i] * (t < 0.3 ? t / 0.3 : 1);
      const c = Math.cos(this.rot[i]) * s;
      const sn = Math.sin(this.rot[i]) * s;
      m[o] = c;
      m[o + 1] = 0;
      m[o + 2] = -sn;
      m[o + 3] = 0;
      m[o + 4] = 0;
      m[o + 5] = s;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = sn;
      m[o + 9] = 0;
      m[o + 10] = c;
      m[o + 11] = 0;
      m[o + 12] = this.px[i];
      m[o + 13] = this.py[i];
      m[o + 14] = this.pz[i];
      m[o + 15] = 1;
    }
    this.live = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    (this.mesh.instanceMatrix.array as Float32Array).fill(0);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.live = 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
