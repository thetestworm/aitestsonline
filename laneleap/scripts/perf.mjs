// Headless performance + screenshot harness.
// Usage: node scripts/perf.mjs [url] [outDir]
// Runs the game in Chromium with mobile emulation and 4x CPU throttling, drives
// it with a simple autopilot and reports frame statistics.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch {
  playwright = require(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright');
}
const url = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || 'perf-results';
mkdirSync(out, { recursive: true });
const autopilot = readFileSync(new URL('./autopilot.js', import.meta.url), 'utf8');

const profiles = [
  {
    name: 'mid-phone-portrait',
    viewport: { width: 393, height: 852 },
    dpr: 2.75,
    throttle: 4,
    mobile: true,
  },
  {
    name: 'phone-landscape',
    viewport: { width: 852, height: 393 },
    dpr: 3,
    throttle: 4,
    mobile: true,
  },
  { name: 'desktop', viewport: { width: 1280, height: 800 }, dpr: 1, throttle: 1, mobile: false },
];

// NOTE: headless Chromium renders with SwiftShader (software GL), which is fill-rate bound on
// CPU cores, so raw FPS here is far below a real phone GPU. The device-relevant metric is the
// JS cost per frame (simulation + draw submission) under CPU throttling.
const browser = await playwright.chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
  ],
});
const results = [];
for (const prof of profiles) {
  const ctx = await browser.newContext({
    viewport: prof.viewport,
    deviceScaleFactor: prof.dpr,
    isMobile: prof.mobile,
    hasTouch: prof.mobile,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(autopilot);
  const cdp = await ctx.newCDPSession(page);
  await page.goto(url + (url.includes('?') ? '&' : '?') + 'debug');
  await page.waitForFunction(() => window.laneleap && window.laneleap.state === 'menu', null, {
    timeout: 30000,
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${prof.name}-menu.png` });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: prof.throttle });
  await page.evaluate(() => window.laneleap.onUiAction('play'));
  // Collect real frame times via rAF.
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = (now) => {
      window.__frames.push(now - last);
      last = now;
      if (window.__frames.length < 100000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.evaluate(() => {
    // Measure main-thread CPU cost of simulation + render submission per frame.
    const g = window.laneleap;
    window.__cpu = [];
    let acc = 0;
    const u = g.loop.update;
    const r = g.loop.render;
    g.loop.update = (dt) => {
      const t = performance.now();
      u(dt);
      acc += performance.now() - t;
    };
    g.loop.render = (dt) => {
      const t = performance.now();
      r(dt);
      window.__cpu.push(acc + performance.now() - t);
      acc = 0;
    };
    window.__startAutopilot();
  });
  // Screenshots first (they stall the renderer), then a clean timing window.
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${out}/${prof.name}-play${i}.png` });
  }
  await page.evaluate(() => {
    window.__frames.length = 0;
    window.__cpu.length = 0;
  });
  await page.waitForTimeout(20000);
  const runs = await page.evaluate(() => window.__runs);
  const bestScore = await page.evaluate(() => window.__best);
  const snap = await page.evaluate(() => window.laneleap.perfSnapshot());
  const frames = await page.evaluate(() => window.__frames.slice(30));
  frames.sort((a, b) => a - b);
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  const pct = (q) => frames[Math.min(frames.length - 1, Math.floor(frames.length * q))];
  const cpu = await page.evaluate(() => window.__cpu.slice());
  cpu.sort((a, b) => a - b);
  const cavg = cpu.reduce((a, b) => a + b, 0) / cpu.length;
  const heap = await page.evaluate(() =>
    performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
  );
  results.push({
    profile: prof.name,
    cpuThrottle: `${prof.throttle}x`,
    jsFrameAvgMs: +cavg.toFixed(2),
    jsFrameP95Ms: +cpu[Math.floor(cpu.length * 0.95)].toFixed(2),
    jsFrameP99Ms: +cpu[Math.floor(cpu.length * 0.99)].toFixed(2),
    swiftshaderFps: +(1000 / avg).toFixed(1),
    rafP50Ms: +pct(0.5).toFixed(1),
    finalQuality: snap.quality,
    pixelRatio: snap.pixelRatio,
    drawCalls: snap.calls,
    triangles: snap.triangles,
    geometries: snap.geometries,
    textures: snap.textures,
    lanes: snap.lanes,
    runs,
    bestScore,
    heapMB: heap && +heap.toFixed(1),
    errors: errors.length,
  });
  if (errors.length) console.error(prof.name, errors);
  await ctx.close();
}
await browser.close();
console.table(results);
writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
