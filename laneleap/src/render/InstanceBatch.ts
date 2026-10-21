/**
 * Fixed-capacity InstancedMesh with slot allocation. Lanes allocate slots for
 * their props/vehicles and release them when disposed, so the whole world is
 * drawn with a handful of draw calls and no per-lane GPU objects.
 */
import * as THREE from 'three';

export class InstanceBatch {
  readonly mesh: THREE.InstancedMesh;
  private readonly free: number[] = [];
  private high = 0;
  private dirty = false;
  private colorDirty = false;
  private readonly arr: Float32Array;

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    readonly capacity: number,
    opts: { castShadow?: boolean; receiveShadow?: boolean; colors?: boolean; name?: string } = {},
  ) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.name = opts.name ?? 'batch';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = !!opts.castShadow;
    this.mesh.receiveShadow = !!opts.receiveShadow;
    // Instances span the whole world; per-instance bounds would go stale every frame.
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.arr = this.mesh.instanceMatrix.array as Float32Array;
    if (opts.colors) {
      this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(capacity * 3).fill(1),
        3,
      );
      this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
  }

  get used(): number {
    return this.high - this.free.length;
  }

  alloc(): number {
    let i: number;
    if (this.free.length > 0) i = this.free.pop()!;
    else if (this.high < this.capacity) i = this.high++;
    else return -1;
    this.mesh.count = this.high;
    return i;
  }

  release(i: number): void {
    if (i < 0) return;
    this.hide(i);
    this.free.push(i);
  }

  /** Release every slot at once (world reset). */
  clear(): void {
    this.free.length = 0;
    this.high = 0;
    this.mesh.count = 0;
    this.dirty = true;
  }

  /** Write a translation + yaw + scale matrix without allocating. */
  set(i: number, x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1): void {
    if (i < 0) return;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const a = this.arr;
    const o = i * 16;
    a[o] = c * sx;
    a[o + 1] = 0;
    a[o + 2] = -s * sx;
    a[o + 3] = 0;
    a[o + 4] = 0;
    a[o + 5] = sy;
    a[o + 6] = 0;
    a[o + 7] = 0;
    a[o + 8] = s * sz;
    a[o + 9] = 0;
    a[o + 10] = c * sz;
    a[o + 11] = 0;
    a[o + 12] = x;
    a[o + 13] = y;
    a[o + 14] = z;
    a[o + 15] = 1;
    this.dirty = true;
  }

  /** Only move an instance (keeps rotation/scale). */
  move(i: number, x: number, y: number, z: number): void {
    if (i < 0) return;
    const o = i * 16;
    this.arr[o + 12] = x;
    this.arr[o + 13] = y;
    this.arr[o + 14] = z;
    this.dirty = true;
  }

  hide(i: number): void {
    if (i < 0) return;
    this.arr.fill(0, i * 16, i * 16 + 16);
    this.dirty = true;
  }

  setColor(i: number, color: THREE.Color): void {
    const ic = this.mesh.instanceColor;
    if (i < 0 || !ic) return;
    const a = ic.array as Float32Array;
    a[i * 3] = color.r;
    a[i * 3 + 1] = color.g;
    a[i * 3 + 2] = color.b;
    this.colorDirty = true;
  }

  flush(): void {
    if (this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dirty = false;
    }
    if (this.colorDirty && this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
      this.colorDirty = false;
    }
  }

  setShadows(cast: boolean, receive: boolean): void {
    this.mesh.castShadow = cast;
    this.mesh.receiveShadow = receive;
  }

  dispose(disposeGeometry = true): void {
    this.mesh.removeFromParent();
    if (disposeGeometry) this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}
