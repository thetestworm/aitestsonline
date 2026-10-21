/**
 * Unified input: keyboard (with per-player split bindings for local
 * multiplayer) and pointer gestures (tap = forward, swipe = direction, with a
 * dead zone). Touches are routed to per-player zones in multiplayer. Inputs
 * are forwarded immediately; the Run buffers them while a hop is in progress.
 */
import { classifyGesture, zoneForX, DEFAULT_GESTURE, type Dir } from './gestures';

export type Action = 'pause' | 'confirm' | 'back';

interface Touch {
  id: number;
  x: number;
  y: number;
  t: number;
  zone: number;
  fired: boolean;
}

const SOLO_KEYS: Record<string, Dir> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};

/** Multiplayer key split: [player, dir]. */
const MULTI_KEYS: Record<string, [number, Dir]> = {
  KeyW: [0, 'up'],
  KeyA: [0, 'left'],
  KeyS: [0, 'down'],
  KeyD: [0, 'right'],
  ArrowUp: [1, 'up'],
  ArrowLeft: [1, 'left'],
  ArrowDown: [1, 'down'],
  ArrowRight: [1, 'right'],
  KeyI: [2, 'up'],
  KeyJ: [2, 'left'],
  KeyK: [2, 'down'],
  KeyL: [2, 'right'],
  Numpad8: [3, 'up'],
  Numpad4: [3, 'left'],
  Numpad5: [3, 'down'],
  Numpad2: [3, 'down'],
  Numpad6: [3, 'right'],
  KeyT: [3, 'up'],
  KeyF: [3, 'left'],
  KeyG: [3, 'down'],
  KeyH: [3, 'right'],
};

export const KEY_HELP: Record<number, string> = {
  0: 'W A S D',
  1: 'Arrow keys',
  2: 'I J K L',
  3: 'T F G H / Numpad',
};

export class InputManager {
  players = 1;
  /** When false, gameplay moves are not emitted (menus, pause). */
  gameplay = false;
  /** Swipe detection off when on-screen buttons are used. */
  swipe = true;
  onMove: (player: number, dir: Dir) => void = () => undefined;
  onAction: (a: Action) => void = () => undefined;
  private readonly touches = new Map<number, Touch>();
  private readonly cfg = { ...DEFAULT_GESTURE };

  constructor(private readonly surface: HTMLElement) {
    window.addEventListener('keydown', this.onKey);
    surface.addEventListener('pointerdown', this.onDown);
    surface.addEventListener('pointermove', this.onMoveEvt);
    surface.addEventListener('pointerup', this.onUp);
    surface.addEventListener('pointercancel', this.onCancel);
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' || e.code === 'KeyP') {
      this.onAction(e.code === 'Escape' ? 'back' : 'pause');
      return;
    }
    if (e.code === 'Enter' || e.code === 'Space') {
      // Space also hops forward during play, which feels natural on desktop.
      if (this.gameplay && e.code === 'Space') {
        if (!e.repeat) this.onMove(0, 'up');
        e.preventDefault();
        return;
      }
      if (!e.repeat) this.onAction('confirm');
      e.preventDefault();
      return;
    }
    if (!this.gameplay || e.repeat) return;
    if (this.players <= 1) {
      const d = SOLO_KEYS[e.code];
      if (d) {
        e.preventDefault();
        this.onMove(0, d);
      }
    } else {
      const b = MULTI_KEYS[e.code];
      if (b && b[0] < this.players) {
        e.preventDefault();
        this.onMove(b[0], b[1]);
      }
    }
  };

  private readonly onDown = (e: PointerEvent): void => {
    if (!this.gameplay) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const rect = this.surface.getBoundingClientRect();
    this.touches.set(e.pointerId, {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      zone: zoneForX(e.clientX - rect.left, rect.width, this.players),
      fired: false,
    });
    try {
      this.surface.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported for this pointer */
    }
  };

  private readonly onMoveEvt = (e: PointerEvent): void => {
    const t = this.touches.get(e.pointerId);
    if (!t || t.fired || !this.swipe) return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    // Fire swipes as soon as they clear the threshold for responsiveness.
    if (Math.hypot(dx, dy) >= this.cfg.deadZone * 2.2) {
      const g = classifyGesture(dx, dy, e.timeStamp - t.t, this.cfg);
      if (g && g !== 'tap') {
        t.fired = true;
        this.onMove(t.zone, g);
      }
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    const t = this.touches.get(e.pointerId);
    this.touches.delete(e.pointerId);
    if (!t || t.fired || !this.gameplay) return;
    const g = classifyGesture(e.clientX - t.x, e.clientY - t.y, e.timeStamp - t.t, this.cfg);
    if (g === 'tap') this.onMove(t.zone, 'up');
    else if (g && this.swipe) this.onMove(t.zone, g);
  };

  private readonly onCancel = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
  };

  reset(): void {
    this.touches.clear();
  }
}
