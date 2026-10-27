// Procedural materials for the city: a PBR facade shader for every building
// type (windows fitted to each face, frames, storefronts, grime, reflective
// glass) and canvas-generated ground textures with matching normal maps.
import * as THREE from 'three';

// style: 0 glass curtain wall, 1 punched-window office, 2 house, 3 warehouse, 4 container
export function facadeMaterial({ floorH = 3.6, colW = 3.2, density = 1, base = 0, rough = 0.9 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: 0, envMapIntensity: 1.0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWin = { value: new THREE.Vector4(floorH, colW, density, base) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aStyle;
        varying vec3 vWP; varying vec3 vNo; varying vec3 vLoc; varying vec3 vSize; varying float vStyle; varying float vSeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        mat4 mw = modelMatrix;
        #ifdef USE_INSTANCING
          mw = modelMatrix * instanceMatrix;
          vSize = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vSeed = fract(dot(instanceMatrix[3].xyz, vec3(0.0131, 0.0173, 0.0197)) * 7.31);
        #else
          vSize = vec3(1.0); vSeed = 0.0;
        #endif
        vWP = (mw * vec4(transformed, 1.0)).xyz;
        vNo = objectNormal;
        vLoc = position;
        vStyle = aStyle;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWP; varying vec3 vNo; varying vec3 vLoc; varying vec3 vSize; varying float vStyle; varying float vSeed;
        uniform vec4 uWin;
        float gGlass;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        gGlass = 0.0;
        vec3 nrm = normalize(vNo);
        float st = vStyle;
        if (nrm.y > 0.5) {
          // roof: tar and gravel with a lighter parapet cap
          float g = vn(vWP.xz * 1.7) * 0.5 + vn(vWP.xz * 0.21) * 0.5;
          float edge = min(min(vLoc.x + 0.5, 0.5 - vLoc.x) * vSize.x, min(vLoc.z + 0.5, 0.5 - vLoc.z) * vSize.z);
          diffuseColor.rgb *= (0.45 + 0.2 * g) * mix(1.35, 1.0, smoothstep(0.5, 0.8, edge));
          if (st > 3.5) diffuseColor.rgb *= 1.6;
        } else if (nrm.y > -0.5) {
          bool xf = abs(nrm.x) > 0.5;
          float faceW = xf ? vSize.z : vSize.x;
          float u = ((xf ? vLoc.z : vLoc.x) + 0.5) * faceW;
          float yW = vWP.y, topD = vSize.y * (1.0 - vLoc.y);
          float base = uWin.w, floorH = uWin.x;
          float nCols = max(1.0, floor(faceW / uWin.y));
          float cw = faceW / nCols;
          vec2 cell = vec2(u / cw, (yW - base) / floorH);
          vec2 id = floor(cell), f = fract(cell);
          float rnd = h21(id + vSeed * 31.0 + (xf ? 7.0 : 0.0));
          // wall: large-scale tone, fine grain, rain streaks
          float wn = vn(vec2(u, yW) * 0.31 + vSeed * 40.0) * 0.6 + vn(vec2(u, yW) * 2.3) * 0.4;
          float streak = vn(vec2(u * 1.7 + vSeed * 9.0, yW * 0.05));
          vec3 wall = diffuseColor.rgb * (0.8 + 0.32 * wn) * (1.0 - 0.2 * smoothstep(0.55, 0.92, streak));
          vec2 wmin = vec2(0.2, 0.25), wmax = vec2(0.8, 0.82);
          if (st < 0.5) { wmin = vec2(0.03, 0.14); wmax = vec2(0.97, 0.92); }
          else if (st > 1.5 && st < 2.5) { wmin = vec2(0.28, 0.32); wmax = vec2(0.72, 0.82); }
          else if (st > 2.5) { wmin = vec2(0.08, 0.62); wmax = vec2(0.92, 0.86); }
          float aa = 0.015;
          float win = smoothstep(wmin.x - aa, wmin.x, f.x) * (1.0 - smoothstep(wmax.x, wmax.x + aa, f.x))
                    * smoothstep(wmin.y - aa, wmin.y, f.y) * (1.0 - smoothstep(wmax.y, wmax.y + aa, f.y));
          float fr = st < 0.5 ? 0.02 : 0.05;
          float inner = step(wmin.x + fr, f.x) * step(f.x, wmax.x - fr) * step(wmin.y + fr * 1.4, f.y) * step(f.y, wmax.y - fr);
          float frame = win * (1.0 - inner), glass = win * inner;
          if (st < 0.5) { float mul = step(abs(f.x - 0.5), 0.01); frame = max(frame, mul * win); glass *= 1.0 - mul; }
          float valid = step(base, yW) * step(1.2, min(u, faceW - u)) * step(1.3, topD) * step(1.0 - uWin.z, rnd) * step(st, 3.5);
          glass *= valid; frame *= valid;
          if (st < 0.5) wall = mix(wall, wall * 0.62, valid * (1.0 - win)); // dark spandrels
          vec3 frameC = (st > 1.5 && st < 2.5) ? vec3(0.82, 0.8, 0.76) : vec3(0.1, 0.1, 0.11);
          // glass: tinted panes, some with blinds or interior light
          float tintPick = h21(vec2(vSeed * 13.0, 1.0));
          vec3 tint = st < 0.5 ? (tintPick < 0.4 ? vec3(0.34, 0.4, 0.42) : tintPick < 0.75 ? vec3(0.44, 0.36, 0.24) : vec3(0.24, 0.32, 0.3)) : vec3(0.12, 0.13, 0.14);
          float blinds = step(0.7, rnd) * step(0.5, fract(f.y * 9.0));
          vec3 glassC = mix(tint, vec3(0.62, 0.56, 0.44), blinds * (st < 0.5 ? 0.25 : 0.7));
          glassC *= 1.0 - 0.45 * smoothstep(wmax.y - 0.15, wmax.y, f.y) * step(0.5, st); // recess shadow
          // ground-floor shops with awnings (offices/towers)
          float shop = 0.0;
          if (st < 1.5 && yW < base) {
            float sf = fract(u / 6.5);
            shop = step(0.5, yW) * step(yW, base - 1.2) * step(0.06, sf) * step(sf, 0.94) * step(1.2, min(u, faceW - u));
            float aw = step(base - 1.15, yW) * step(yW, base - 0.45) * step(1.0, min(u, faceW - u));
            vec3 awC = mix(vec3(0.42, 0.1, 0.07), vec3(0.12, 0.24, 0.32), step(0.5, h21(vec2(floor(u / 6.5), vSeed))));
            wall = mix(wall, awC * (0.85 + 0.3 * step(0.5, fract(u * 1.2))), aw);
          }
          if (st > 2.5) {
            wall *= 0.88 + 0.12 * sin(u * 6.2832 * (st > 3.5 ? 3.0 : 2.0));
            if (st < 3.5) {
              float dz = fract(u / 15.0);
              float door = step(0.28, dz) * step(dz, 0.72) * step(yW, 5.2) * step(2.5, min(u, faceW - u));
              wall = mix(wall, vec3(0.3, 0.29, 0.27) * (0.85 + 0.15 * step(0.5, fract(yW * 2.6))), door);
            }
          }
          if (st > 1.5 && st < 2.5) wall *= 0.9 + 0.1 * step(0.14, fract(yW * 4.0)); // siding
          gGlass = max(glass, shop);
          vec3 col = mix(wall, frameC, frame);
          col = mix(col, shop > 0.5 ? vec3(0.05, 0.05, 0.06) : glassC, gGlass);
          col *= 0.68 + 0.32 * smoothstep(0.0, 6.0, yW);
          col *= 0.84 + 0.16 * smoothstep(0.0, 1.5, min(u, faceW - u));
          diffuseColor.rgb = col;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.05, gGlass);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, vStyle < 0.5 ? 0.9 : 0.6, gGlass);`);
  };
  m.customProgramCacheKey = () => `facade${floorH}_${colW}_${density}_${base}`;
  return m;
}

// ---------- canvas textures with derived normal maps ----------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function toTex(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
// Normal map from the luminance of a height canvas.
function normalFrom(src, strength = 2) {
  const w = src.width, h = src.height;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = canvas(w, h), og = out.getContext('2d'), img = og.createImageData(w, h);
  const H = (x, y) => d[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  return toTex(out, false);
}
function speckle(g, w, h, n, colors, size = [1, 3]) {
  for (let k = 0; k < n; k++) {
    g.fillStyle = colors[(Math.random() * colors.length) | 0];
    const s = size[0] + Math.random() * (size[1] - size[0]);
    g.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}
function blotches(g, w, h, n, rgba, rMin, rMax) {
  for (let k = 0; k < n; k++) {
    const x = Math.random() * w, y = Math.random() * h, r = rMin + Math.random() * (rMax - rMin);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, rgba); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

// Asphalt base shared by roads and intersections: aggregate, patches, cracks, oil.
function asphalt(g, w, h, heightMode) {
  g.fillStyle = heightMode ? '#808080' : '#45433f'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, w * h * 0.05, heightMode ? ['#9a9a9a', '#6a6a6a', '#8a8a8a'] : ['#55524c', '#3a3936', '#5e5a53', '#33322f'], [1, 2.5]);
  if (!heightMode) {
    blotches(g, w, h, 18, 'rgba(20,18,16,0.18)', 30, 110);
    blotches(g, w, h, 10, 'rgba(120,112,100,0.10)', 40, 120);
  }
  // sealed cracks
  g.strokeStyle = heightMode ? 'rgba(40,40,40,0.9)' : 'rgba(18,17,15,0.55)'; g.lineWidth = 2;
  for (let k = 0; k < 7; k++) {
    let x = Math.random() * w, y = Math.random() * h;
    g.beginPath(); g.moveTo(x, y);
    for (let s = 0; s < 12; s++) { x += (Math.random() - 0.5) * 40; y += Math.random() * 26; g.lineTo(x, y); }
    g.stroke();
  }
}
export function roadTextures(ROAD_W, LANE_IN, LANE_OUT) {
  const S = 1024;
  const c = canvas(S, S), g = c.getContext('2d');
  const hc = canvas(S / 2, S / 2), hg = hc.getContext('2d');
  asphalt(g, S, S, false); asphalt(hg, S / 2, S / 2, true);
  const px = (m) => S / 2 + (m / ROAD_W) * S;
  // polished tyre lanes
  for (const l of [LANE_OUT, LANE_IN]) for (const s of [-1, 1]) for (const o of [-0.85, 0.85]) {
    const grd = g.createLinearGradient(px(s * l + o) - 30, 0, px(s * l + o) + 30, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.5, 'rgba(10,10,10,0.16)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(px(s * l + o) - 30, 0, 60, S);
  }
  // paint: worn double yellow, white dashes, edge lines
  const paint = (x0, x1, y0, y1, col) => { g.fillStyle = col; g.fillRect(x0, y0, x1 - x0, y1 - y0); };
  paint(px(-0.32) - 5, px(-0.32) + 5, 0, S, '#c9a53a'); paint(px(0.32) - 5, px(0.32) + 5, 0, S, '#c9a53a');
  for (const s of [-1, 1]) {
    for (let y = 0; y < S; y += 256) paint(px(s * 5.5) - 5, px(s * 5.5) + 5, y + 20, y + 150, '#d6d2c4');
    paint(px(s * 10.5) - 5, px(s * 10.5) + 5, 0, S, '#cfcabb');
  }
  // wear on the paint
  speckle(g, S, S, 9000, ['rgba(60,58,54,0.55)', 'rgba(50,48,44,0.4)'], [1, 3]);
  // gutters
  for (const x of [0, S - 18]) { const grd = g.createLinearGradient(x, 0, x + 18, 0); grd.addColorStop(0, x ? 'rgba(25,23,20,0)' : 'rgba(25,23,20,0.75)'); grd.addColorStop(1, x ? 'rgba(25,23,20,0.75)' : 'rgba(25,23,20,0)'); g.fillStyle = grd; g.fillRect(x, 0, 18, S); }
  // a manhole
  g.fillStyle = '#2c2b29'; g.beginPath(); g.arc(px(-LANE_IN), S * 0.7, 18, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#4c4a46'; g.lineWidth = 3; g.stroke();
  return { map: toTex(c), normalMap: normalFrom(hc, 3) };
}
export function intersectionTexture(ROAD_W) {
  const S = 1024, c = canvas(S, S), g = c.getContext('2d');
  asphalt(g, S, S, false);
  blotches(g, S, S, 6, 'rgba(15,14,12,0.2)', 60, 160);
  // zebra crossings on all four sides + stop lines
  const stripe = 3.0 / ROAD_W * S, depth = 3.2 / ROAD_W * S;
  g.fillStyle = '#d4cfbf';
  for (let k = 0; k < 8; k++) {
    const a = S * 0.08 + k * (S * 0.84 / 8);
    g.fillRect(a, 6, stripe * 0.55, depth); g.fillRect(a, S - 6 - depth, stripe * 0.55, depth);
    g.fillRect(6, a, depth, stripe * 0.55); g.fillRect(S - 6 - depth, a, depth, stripe * 0.55);
  }
  speckle(g, S, S, 7000, ['rgba(60,58,54,0.6)'], [1, 3]);
  const t = toTex(c, true, false);
  return t;
}
export function sidewalkTextures() {
  const S = 512, c = canvas(S, S), g = c.getContext('2d'), hc = canvas(S, S), hg = hc.getContext('2d');
  g.fillStyle = '#a49b8c'; g.fillRect(0, 0, S, S); hg.fillStyle = '#909090'; hg.fillRect(0, 0, S, S);
  // 1.5 m slabs (texture covers 4 m)
  const n = 3, step = S / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = 150 + Math.random() * 30;
    g.fillStyle = `rgb(${v + 8},${v},${v - 12})`; g.fillRect(i * step + 2, j * step + 2, step - 4, step - 4);
  }
  speckle(g, S, S, 30000, ['rgba(90,84,74,0.35)', 'rgba(200,192,178,0.3)'], [1, 2]);
  blotches(g, S, S, 10, 'rgba(60,52,40,0.12)', 20, 80);
  g.strokeStyle = 'rgba(55,50,44,0.8)'; hg.strokeStyle = '#303030'; g.lineWidth = hg.lineWidth = 3;
  for (let i = 0; i <= n; i++) for (const gg of [g, hg]) {
    gg.beginPath(); gg.moveTo(i * step, 0); gg.lineTo(i * step, S); gg.stroke();
    gg.beginPath(); gg.moveTo(0, i * step); gg.lineTo(S, i * step); gg.stroke();
  }
  return { map: toTex(c), normalMap: normalFrom(hc, 4) };
}
export function groundTexture(kind) {
  const S = 512, c = canvas(S, S), g = c.getContext('2d');
  if (kind === 'grass') {
    g.fillStyle = '#5b6a30'; g.fillRect(0, 0, S, S);
    blotches(g, S, S, 40, 'rgba(120,120,50,0.25)', 30, 90);
    blotches(g, S, S, 30, 'rgba(40,55,20,0.3)', 20, 70);
    for (let k = 0; k < 26000; k++) {
      g.strokeStyle = `rgba(${70 + Math.random() * 70},${85 + Math.random() * 60},${25 + Math.random() * 25},0.5)`;
      const x = Math.random() * S, y = Math.random() * S;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (Math.random() - 0.5) * 3, y - 2 - Math.random() * 5); g.stroke();
    }
  } else if (kind === 'gravel') {
    g.fillStyle = '#6e6556'; g.fillRect(0, 0, S, S);
    speckle(g, S, S, 50000, ['#7d7362', '#5a5246', '#8a816f', '#4c463c'], [1, 4]);
    blotches(g, S, S, 14, 'rgba(30,25,18,0.22)', 30, 120);
  } else {
    g.fillStyle = '#857d71'; g.fillRect(0, 0, S, S);
    speckle(g, S, S, 30000, ['rgba(100,94,84,0.5)', 'rgba(150,142,128,0.4)'], [1, 2]);
    blotches(g, S, S, 16, 'rgba(50,45,38,0.18)', 30, 110);
    g.strokeStyle = 'rgba(40,36,30,0.5)'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * S / 4, 0); g.lineTo(i * S / 4, S); g.stroke(); g.beginPath(); g.moveTo(0, i * S / 4); g.lineTo(S, i * S / 4); g.stroke(); }
  }
  return toTex(c);
}
// A few original billboard ads for rooftops and poles.
export function billboardTexture(k) {
  const c = canvas(512, 256), g = c.getContext('2d');
  const ads = [
    ['#d8b03a', '#1a1a1a', 'KESSLER', 'BUILT LOUD'], ['#1f4f7a', '#f2e6c8', 'CALDER FM', '101.7  ALL NIGHT'],
    ['#8a1d14', '#f6e3b4', 'RONIN', 'PRECISION IN MOTION'], ['#2c2c2c', '#e8a33a', 'VOLTA', 'CHARGE AHEAD'],
    ['#e6dccb', '#3a2a1a', 'HARBOR COLA', 'ICE COLD SINCE 1952'], ['#38542e', '#efe4c4', 'GANTRY TIRES', 'GRIP THE CITY'],
  ];
  const [bg, fg, a, b] = ads[k % ads.length];
  g.fillStyle = bg; g.fillRect(0, 0, 512, 256);
  g.fillStyle = fg; g.font = 'bold 92px Oswald, Impact, sans-serif'; g.textAlign = 'center'; g.fillText(a, 256, 130);
  g.font = '600 34px Oswald, Impact, sans-serif'; g.fillText(b, 256, 196);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 236, 512, 20);
  return toTex(c, true, false);
}
