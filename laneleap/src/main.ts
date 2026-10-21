import './style.css';

const loading = document.getElementById('loading')!;
const bar = loading.querySelector<HTMLElement>('.bar i');
const progress = (p: number) => {
  if (bar) bar.style.width = `${Math.round(8 + p * 92)}%`;
};

function blockBrowserGestures(): void {
  // Prevent pull-to-refresh, pinch/double-tap zoom and text selection while playing.
  const opts: AddEventListenerOptions = { passive: false };
  document.addEventListener(
    'touchmove',
    (e) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.scroll')) e.preventDefault();
    },
    opts,
  );
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(ev, (e) => e.preventDefault(), opts);
  }
  document.addEventListener('dblclick', (e) => e.preventDefault(), opts);
  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = performance.now();
      if (now - lastTouchEnd < 300 && !(e.target as HTMLElement).closest('button')) e.preventDefault();
      lastTouchEnd = now;
    },
    opts,
  );
  document.addEventListener('selectstart', (e) => e.preventDefault());
}

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  blockBrowserGestures();
  registerServiceWorker();
  if (!webglAvailable()) {
    loading.innerHTML = '<div style="max-width:280px;text-align:center">Laneleap needs WebGL. Try a newer browser or enable hardware acceleration.</div>';
    return;
  }
  progress(0.15);
  // Three.js and the game code arrive as separate chunks while the loader animates.
  const { Game } = await import('./game/Game');
  progress(0.35);
  const game = new Game(
    document.getElementById('game') as HTMLCanvasElement,
    document.getElementById('ui')!,
  );
  await game.init(progress);
  (window as unknown as { laneleap: unknown }).laneleap = game;
  loading.classList.add('done');
  setTimeout(() => loading.remove(), 400);
}

boot().catch((err: unknown) => {
  console.error(err);
  loading.innerHTML = `<div style="max-width:300px;text-align:center">Something went wrong loading Laneleap.<br><small>${String(err)}</small></div>`;
});
