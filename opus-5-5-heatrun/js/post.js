// Renderer, lighting, sky, reflections and the warm "golden haze" grade.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

// Low afternoon sun from the south-west: long shadows down the avenues.
export const SUN_DIR = new THREE.Vector3(-0.52, 0.36, -0.78).normalize();
export const FOG_COLOR = 0xc9ad80;

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uSpeed: { value: 0 }, uSB: { value: 0 }, uFlash: { value: 0 },
    uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uBust: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSpeed, uSB, uFlash, uTime, uBust; uniform vec2 uRes;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r = length(c);
      vec3 col;
      if (uSpeed < 0.01) {
        // subtle lens fringing toward the corners
        vec2 o = c * r * 0.006;
        col = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
      } else {
        float amt = uSpeed * 0.055 * smoothstep(0.1, 0.55, r);
        col = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float t = float(i) / 7.0;
          col += texture2D(tDiffuse, 0.5 + c * (1.0 - amt * t)).rgb;
        }
        col /= 8.0;
      }
      // warm, bleached afternoon grade: amber highlights, brown shadows, muted greens
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 sepia = vec3(l * 1.1 + 0.03, l * 0.95 + 0.012, l * 0.68);
      col = mix(col, sepia, 0.36);
      col.g = mix(col.g, (col.r + col.b) * 0.5, 0.1);
      col = mix(col, smoothstep(0.0, 1.0, col), 0.45);           // filmic S-curve
      col *= vec3(1.06, 1.0, 0.85);
      col += vec3(0.035, 0.022, 0.0) * (1.0 - l);                // lifted brown shadows
      // speedbreaker: cold desaturated bullet time
      float lb = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(lb) * vec3(0.82, 0.95, 1.12), uSB * 0.7);
      col = mix(col, col * vec3(1.25, 0.6, 0.6), uBust * 0.5);
      col *= 1.0 - r * r * (0.95 + uSB * 0.8);
      col += vec3(0.08, 0.22, 0.95) * uFlash;
      col += (h(vUv * uRes + uTime) - 0.5) * 0.035;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  return renderer;
}

const SKY_FRAG = `
  varying vec3 vD; uniform vec3 uSun; uniform float uTime; uniform float uClouds;
  float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
  void main(){
    vec3 d = normalize(vD);
    float y = d.y;
    vec3 hor = vec3(0.92, 0.76, 0.52), mid = vec3(0.78, 0.68, 0.54), top = vec3(0.52, 0.56, 0.58);
    vec3 c = mix(hor, mid, smoothstep(0.0, 0.16, y));
    c = mix(c, top, smoothstep(0.16, 0.75, y));
    c = mix(c, vec3(0.56, 0.48, 0.38), smoothstep(0.0, -0.15, y));
    float s = max(dot(d, uSun), 0.0);
    c += vec3(1.0, 0.72, 0.36) * pow(s, 6.0) * 0.45 + vec3(1.0, 0.86, 0.6) * pow(s, 64.0) * 0.6 + vec3(1.2, 1.05, 0.85) * pow(s, 900.0) * 6.0;
    // cloud deck projected onto a plane
    if (y > 0.0 && uClouds > 0.0) {
      vec2 uv = d.xz / (y + 0.08) * 1.6 + vec2(uTime * 0.004, uTime * 0.002);
      float n = fbm(uv);
      float cov = smoothstep(0.48, 0.78, n) * smoothstep(0.0, 0.12, y);
      vec3 cloudLit = mix(vec3(0.95, 0.84, 0.66), vec3(1.15, 0.92, 0.66), pow(s, 4.0));
      vec3 cloudShade = vec3(0.62, 0.56, 0.5);
      vec3 cc = mix(cloudShade, cloudLit, smoothstep(0.5, 0.85, fbm(uv * 1.7 + 3.1)));
      c = mix(c, cc, cov * 0.85 * uClouds);
      // streaky high cirrus
      float ci = smoothstep(0.55, 0.9, fbm(vec2(uv.x * 0.35, uv.y * 3.0) + 5.0)) * smoothstep(0.1, 0.5, y);
      c = mix(c, vec3(0.98, 0.9, 0.78), ci * 0.3 * uClouds);
    }
    gl_FragColor = vec4(c, 1.0);
  }`;
function makeSky(clouds = 1) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: SUN_DIR.clone() }, uTime: { value: 0 }, uClouds: { value: clouds } },
    vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: SKY_FRAG,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), mat);
  m.frustumCulled = false;
  m.renderOrder = -1;
  return m;
}

function flareTexture(size, inner, outer, rgb) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, `rgba(${rgb},${inner})`); grd.addColorStop(0.4, `rgba(${rgb},${outer})`); grd.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function setupScene(scene, renderer) {
  scene.fog = new THREE.Fog(FOG_COLOR, 160, 1500);
  scene.background = new THREE.Color(FOG_COLOR);
  const sky = makeSky();
  scene.add(sky);
  // Environment for paint and glass reflections: sky, a ring of city blocks, warm ground.
  const envScene = new THREE.Scene();
  envScene.add(makeSky(0.6));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(600, 24), new THREE.MeshBasicMaterial({ color: 0x3e362e }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -2; envScene.add(ground);
  const bm = [0x5a5248, 0x6e665a, 0x4a4640, 0x7a6e5e].map((c) => new THREE.MeshBasicMaterial({ color: c }));
  for (let k = 0; k < 70; k++) {
    const a = (k / 70) * Math.PI * 2 + Math.random() * 0.05, d = 60 + Math.random() * 80, h = 10 + Math.random() * 70;
    const b = new THREE.Mesh(new THREE.BoxGeometry(18 + Math.random() * 20, h, 18), bm[k % 4]);
    b.position.set(Math.cos(a) * d, h / 2 - 2, Math.sin(a) * d); b.lookAt(0, h / 2, 0);
    envScene.add(b);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.015).texture;
  scene.environmentIntensity = 0.85;

  const hemi = new THREE.HemisphereLight(0xf0dcb4, 0x5e4a38, 1.45);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffcf90, 3.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -120; sc.right = 120; sc.top = 120; sc.bottom = -120; sc.near = 10; sc.far = 700;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5;
  scene.add(sun, sun.target);
  // lens flare riding on a far-off point light in the sun's direction
  const flareLight = new THREE.PointLight(0xffffff, 0, 1);
  const lf = new Lensflare();
  lf.addElement(new LensflareElement(flareTexture(256, 0.9, 0.25, '255,230,180'), 520, 0, new THREE.Color(1, 0.9, 0.7)));
  lf.addElement(new LensflareElement(flareTexture(64, 0.35, 0.1, '255,200,120'), 60, 0.4));
  lf.addElement(new LensflareElement(flareTexture(64, 0.3, 0.08, '200,220,255'), 90, 0.7));
  lf.addElement(new LensflareElement(flareTexture(64, 0.25, 0.08, '255,180,120'), 140, 1.0));
  flareLight.add(lf);
  scene.add(flareLight);
  return {
    sun, sky, hemi,
    follow(p, t = 0) {
      sun.position.set(p.x + SUN_DIR.x * 350, SUN_DIR.y * 350, p.z + SUN_DIR.z * 350);
      sun.target.position.set(p.x, 0, p.z);
      // snap the shadow camera to texels so shadows don't shimmer while driving
      const step = 240 / sun.shadow.mapSize.x;
      sun.target.position.x = Math.round(sun.target.position.x / step) * step;
      sun.target.position.z = Math.round(sun.target.position.z / step) * step;
      sun.position.x = sun.target.position.x + SUN_DIR.x * 350; sun.position.z = sun.target.position.z + SUN_DIR.z * 350;
      sky.position.set(p.x, 0, p.z);
      sky.material.uniforms.uTime.value = t;
      flareLight.position.set(p.x + SUN_DIR.x * 2800, p.y + SUN_DIR.y * 2800, p.z + SUN_DIR.z * 2800);
    },
  };
}

export function createComposer(renderer, scene, camera) {
  // MSAA render target: the composer otherwise bypasses the canvas antialiasing
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.6, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  return { composer, grade, bloom };
}
