/**
 * Lazy character asset loading. The model-builder module is a separate chunk
 * fetched on first use; individual geometries are built on demand, cached,
 * and can be released. Thumbnails for the character screen are rendered once
 * into a small render target and cached as data URLs.
 */
import * as THREE from 'three';
import type { CharacterDef } from '../data/characters';
import type { CharacterModel } from '../data/characterModels';
import type { PaletteAtlas } from './atlas';

type ModelModule = typeof import('../data/characterModels');

const THUMB = 112;

export class CharacterLibrary {
  private mod: ModelModule | null = null;
  private loading: Promise<ModelModule> | null = null;
  private readonly cache = new Map<string, CharacterModel>();
  private readonly thumbs = new Map<string, string>();
  private thumbScene: THREE.Scene | null = null;
  private thumbCam: THREE.OrthographicCamera | null = null;
  private thumbTarget: THREE.WebGLRenderTarget | null = null;
  private thumbMesh: THREE.Mesh | null = null;
  private readonly thumbMat: THREE.MeshLambertMaterial;
  private pixels: Uint8Array | null = null;
  private canvas: HTMLCanvasElement | null = null;

  constructor(private readonly atlas: PaletteAtlas) {
    this.thumbMat = new THREE.MeshLambertMaterial({ map: atlas.texture });
  }

  load(): Promise<ModelModule> {
    if (this.mod) return Promise.resolve(this.mod);
    this.loading ??= import('../data/characterModels').then((m) => (this.mod = m));
    return this.loading;
  }

  get loaded(): boolean {
    return this.mod !== null;
  }

  get(def: CharacterDef): CharacterModel {
    let m = this.cache.get(def.id);
    if (!m) {
      if (!this.mod) throw new Error('character models not loaded yet');
      m = this.mod.buildCharacterModel(def, this.atlas);
      this.cache.set(def.id, m);
    }
    return m;
  }

  /** Free cached geometries except the ones still in use. */
  trim(keep: ReadonlySet<string>): void {
    for (const [id, m] of this.cache) {
      if (keep.has(id)) continue;
      m.geometry.dispose();
      this.cache.delete(id);
    }
  }

  thumbnail(def: CharacterDef, renderer: THREE.WebGLRenderer): string {
    const cached = this.thumbs.get(def.id);
    if (cached) return cached;
    if (!this.mod) return '';
    this.ensureThumbRig();
    const model = this.get(def);
    const mesh = this.thumbMesh!;
    mesh.geometry = model.geometry;
    const h = Math.max(0.6, model.height);
    mesh.position.set(0, -h * 0.5, 0);
    const cam = this.thumbCam!;
    const s = Math.max(0.62, h * 0.72);
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.updateProjectionMatrix();
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearAlpha();
    const prevShadow = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;
    renderer.setRenderTarget(this.thumbTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.thumbScene!, cam);
    renderer.readRenderTargetPixels(this.thumbTarget!, 0, 0, THUMB, THUMB, this.pixels!);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearAlpha(prevClear);
    renderer.shadowMap.enabled = prevShadow;
    const ctx = this.canvas!.getContext('2d')!;
    const img = ctx.createImageData(THUMB, THUMB);
    // Flip vertically: GL rows are bottom-up.
    for (let y = 0; y < THUMB; y++) {
      const src = (THUMB - 1 - y) * THUMB * 4;
      img.data.set(this.pixels!.subarray(src, src + THUMB * 4), y * THUMB * 4);
    }
    ctx.putImageData(img, 0, 0);
    const url = this.canvas!.toDataURL('image/png');
    this.thumbs.set(def.id, url);
    return url;
  }

  private ensureThumbRig(): void {
    if (this.thumbScene) return;
    this.thumbScene = new THREE.Scene();
    this.thumbScene.add(new THREE.HemisphereLight('#ffffff', '#777788', 2.2));
    const dl = new THREE.DirectionalLight('#ffffff', 2.2);
    dl.position.set(3, 5, 4);
    this.thumbScene.add(dl);
    this.thumbMesh = new THREE.Mesh(undefined, this.thumbMat);
    this.thumbMesh.rotation.y = 0.55;
    this.thumbScene.add(this.thumbMesh);
    this.thumbCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
    this.thumbCam.position.set(0, 1.4, 5);
    this.thumbCam.lookAt(0, 0, 0);
    this.thumbTarget = new THREE.WebGLRenderTarget(THUMB, THUMB, { samples: 0 });
    this.thumbTarget.texture.colorSpace = THREE.SRGBColorSpace;
    this.pixels = new Uint8Array(THUMB * THUMB * 4);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = THUMB;
  }

  dispose(): void {
    for (const m of this.cache.values()) m.geometry.dispose();
    this.cache.clear();
    this.thumbTarget?.dispose();
    this.thumbMat.dispose();
  }
}
