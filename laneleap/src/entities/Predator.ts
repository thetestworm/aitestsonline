/**
 * The Stormray: an original voxel sky-manta that swoops down on players who
 * dawdle or fall behind the camera, snatches them, and carries them off.
 */
import * as THREE from 'three';
import type { Player } from './Player';

type Phase = 'idle' | 'dive' | 'carry';

export class Predator {
  readonly mesh: THREE.Mesh;
  phase: Phase = 'idle';
  target: Player | null = null;
  private t = 0;
  private readonly start = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  onGrab: ((p: Player) => void) | null = null;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material) {
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.visible = false;
    this.mesh.name = 'predator';
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  launch(p: Player): void {
    this.target = p;
    this.phase = 'dive';
    this.t = 0;
    const z = -p.visualRow;
    this.start.set(p.x + 3, 9, z - 14);
    this.mesh.visible = true;
    this.mesh.position.copy(this.start);
  }

  update(dt: number): void {
    if (this.phase === 'idle' || !this.target) return;
    const p = this.target;
    this.t += dt;
    const m = this.mesh;
    if (this.phase === 'dive') {
      const k = Math.min(1, this.t / 0.75);
      const e = k * k * (3 - 2 * k);
      this.end.set(p.x, p.y + 0.9, -p.visualRow);
      m.position.lerpVectors(this.start, this.end, e);
      m.position.y += Math.sin(k * Math.PI) * 1.5;
      m.rotation.set(0.35 * (1 - k), 0, Math.sin(this.t * 10) * 0.1);
      const flap = 1 + Math.sin(this.t * 18) * 0.12;
      m.scale.set(flap, 1, 1);
      if (k >= 1) {
        this.phase = 'carry';
        this.t = 0;
        this.start.copy(m.position);
        p.grabbed = true;
        this.onGrab?.(p);
      }
    } else {
      const k = Math.min(1, this.t / 1.6);
      m.position.set(this.start.x + k * 2, this.start.y + k * k * 12, this.start.z - k * 9);
      m.rotation.set(-0.3 * k, Math.PI, Math.sin(this.t * 12) * 0.08);
      m.scale.set(1 + Math.sin(this.t * 16) * 0.14, 1, 1);
      p.root.position.set(m.position.x, m.position.y - 0.85, m.position.z);
      p.body.rotation.z = Math.sin(this.t * 14) * 0.4;
      if (k >= 1) this.reset();
    }
  }

  reset(): void {
    this.phase = 'idle';
    this.target = null;
    this.mesh.visible = false;
  }
}
