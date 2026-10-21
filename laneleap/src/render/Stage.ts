/**
 * Renderer, orthographic isometric camera, lights, day/night cycle and screen
 * shake. Pixel ratio is capped and driven by the quality manager.
 */
import * as THREE from 'three';
import type { WorldTheme } from '../world/worlds';
import type { QualityLevel } from '../core/quality';

const CAM_OFFSET = new THREE.Vector3(3.4, 15, 10);
const SUN_OFFSET = new THREE.Vector3(-7, 16, 6);
const DAY_LENGTH = 160; // seconds for a full day/night cycle

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly hemi: THREE.HemisphereLight;
  readonly sun: THREE.DirectionalLight;
  /** Camera look-at target in world space (x, row-derived z). */
  readonly focus = new THREE.Vector3();
  private shakeAmp = 0;
  private shakeT = 0;
  private readonly skyDay = new THREE.Color();
  private readonly skyNight = new THREE.Color();
  private readonly sky = new THREE.Color();
  private readonly sunDay = new THREE.Color('#fff4e0');
  private readonly sunDusk = new THREE.Color('#ff9a62');
  private readonly sunNight = new THREE.Color('#8fa8ff');
  private readonly tmpColor = new THREE.Color();
  private nightBias = 0;
  /** 0 = noon, 0.5 = midnight. */
  dayPhase = 0.08;
  /** 0 (day) .. 1 (night), for lamps and glow effects. */
  night = 0;
  private pixelRatioCap = 2;
  private zoom = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 80);
    this.hemi = new THREE.HemisphereLight('#ffffff', '#6d7a5a', 1.6);
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.4);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -16;
    sc.right = 16;
    sc.top = 16;
    sc.bottom = -16;
    sc.near = 1;
    sc.far = 50;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.resize();
  }

  setTheme(theme: WorldTheme): void {
    this.skyDay.set(theme.skyDay);
    this.skyNight.set(theme.skyNight);
    this.nightBias = theme.nightBias;
    this.applyDayNight();
  }

  setQuality(q: QualityLevel): void {
    this.pixelRatioCap = q.pixelRatio;
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    if (q.shadows && this.sun.shadow.mapSize.x !== q.shadowMapSize) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    // Materials must recompile when shadow support toggles.
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.pixelRatioCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    // Portrait: fix the visible width. Landscape: fix the visible height.
    let halfW: number;
    let halfH: number;
    if (aspect < 1) {
      halfW = 5.6;
      halfH = halfW / aspect;
    } else {
      halfH = 6.6;
      halfW = Math.min(halfH * aspect, 14);
      halfH = halfW / aspect;
    }
    halfW /= this.zoom;
    halfH /= this.zoom;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  setZoom(z: number): void {
    this.zoom = z;
    this.resize();
  }

  shake(amount: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  /** Advance the day/night clock. */
  tickDay(dt: number): void {
    this.dayPhase = (this.dayPhase + dt / DAY_LENGTH) % 1;
    this.applyDayNight();
  }

  private applyDayNight(): void {
    // Smooth night factor: dark around phase 0.5, with a bias for night-loving worlds.
    const c = Math.cos(this.dayPhase * Math.PI * 2); // 1 at noon, -1 at midnight
    let n = THREE.MathUtils.smoothstep(-c, -0.25 - this.nightBias, 0.55 - this.nightBias);
    n = Math.min(1, Math.max(0, n));
    this.night = n;
    this.sky.copy(this.skyDay).lerp(this.skyNight, n);
    this.scene.background = this.sky;
    const dusk = 1 - Math.abs(n - 0.5) * 2;
    this.tmpColor
      .copy(this.sunDay)
      .lerp(this.sunNight, n)
      .lerp(this.sunDusk, dusk * 0.6);
    this.sun.color.copy(this.tmpColor);
    this.sun.intensity = 2.5 - 1.9 * n;
    this.hemi.intensity = 1.65 - 0.95 * n;
    this.hemi.color.set('#ffffff').lerp(this.sunNight, n * 0.7);
  }

  update(dt: number, shakeEnabled: boolean): void {
    let ox = 0;
    let oz = 0;
    if (this.shakeAmp > 0.001 && shakeEnabled) {
      this.shakeT += dt * 60;
      ox = Math.sin(this.shakeT * 1.7) * this.shakeAmp;
      oz = Math.cos(this.shakeT * 2.3) * this.shakeAmp;
    }
    this.shakeAmp *= Math.exp(-dt * 7);
    const f = this.focus;
    this.camera.position.set(f.x + CAM_OFFSET.x + ox, f.y + CAM_OFFSET.y, f.z + CAM_OFFSET.z + oz);
    this.camera.lookAt(f.x + ox, f.y, f.z + oz);
    this.sun.position.set(f.x + SUN_OFFSET.x, SUN_OFFSET.y, f.z + SUN_OFFSET.z - 3);
    this.sun.target.position.set(f.x, 0, f.z - 3);
    this.sun.target.updateMatrixWorld();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Project a world position to CSS pixels (for floating UI). */
  toScreen(v: THREE.Vector3, out: THREE.Vector2): THREE.Vector2 {
    const p = v.project(this.camera);
    out.set((p.x * 0.5 + 0.5) * window.innerWidth, (-p.y * 0.5 + 0.5) * window.innerHeight);
    return out;
  }
}
