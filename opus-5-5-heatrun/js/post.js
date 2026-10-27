// Renderer, lighting, sky and the warm "golden haze" post-processing grade.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const SUN_DIR = new THREE.Vector3(-0.55, 0.32, -0.77).normalize();
export const FOG_COLOR = 0xcbb085;

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
      float amt = uSpeed * 0.05 * smoothstep(0.12, 0.55, r);
      vec3 col;
      if (uSpeed < 0.01) col = texture2D(tDiffuse, vUv).rgb;
      else {
        col = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          float t = float(i) / 7.0;
          col += texture2D(tDiffuse, 0.5 + c * (1.0 - amt * t)).rgb;
        }
        col /= 8.0;
      }
      // warm, slightly bleached grade: lifted browns, amber highlights, muted greens
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 sepia = vec3(l * 1.07 + 0.03, l * 0.93 + 0.015, l * 0.70);
      col = mix(col, sepia, 0.42);
      col.g = mix(col.g, (col.r + col.b) * 0.5, 0.12);
      col = (col - 0.5) * 1.14 + 0.5;
      col *= vec3(1.05, 1.0, 0.86);
      col += vec3(0.03, 0.018, 0.0);
      // speedbreaker: cold desaturated bullet time
      float lb = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(lb) * vec3(0.82, 0.95, 1.12), uSB * 0.7);
      // busted pulse
      col = mix(col, col * vec3(1.25, 0.6, 0.6), uBust * 0.5);
      col *= 1.0 - r * r * (1.05 + uSB * 0.8);
      col += vec3(0.08, 0.22, 0.95) * uFlash;
      col += (h(vUv * uRes + uTime) - 0.5) * 0.04;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  return renderer;
}

export function setupScene(scene, renderer) {
  scene.fog = new THREE.Fog(FOG_COLOR, 140, 1250);
  scene.background = new THREE.Color(FOG_COLOR);
  const sky = makeSky();
  scene.add(sky);
  // environment map for paint reflections, generated from the sky
  const envScene = new THREE.Scene();
  envScene.add(makeSky());
  const ground = new THREE.Mesh(new THREE.CircleGeometry(400, 16), new THREE.MeshBasicMaterial({ color: 0x4a4038 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -20; envScene.add(ground);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.8;

  const hemi = new THREE.HemisphereLight(0xeedcb8, 0x6a5440, 1.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd29a, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 10; sc.far = 600;
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  return { sun, sky, hemi, follow(p) { sun.position.set(p.x - SUN_DIR.x * 300, 300 * SUN_DIR.y + 60, p.z - SUN_DIR.z * 300); sun.target.position.set(p.x, 0, p.z); sky.position.set(p.x, 0, p.z); } };
}

function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: SUN_DIR.clone().multiplyScalar(-1).setY(SUN_DIR.y) } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      varying vec3 vD; uniform vec3 uSun;
      void main(){
        float y = vD.y;
        vec3 hor = vec3(0.86, 0.72, 0.52), mid = vec3(0.70, 0.62, 0.50), top = vec3(0.50, 0.52, 0.52);
        vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, y));
        c = mix(c, top, smoothstep(0.18, 0.7, y));
        c = mix(c, vec3(0.55, 0.47, 0.38), smoothstep(0.0, -0.2, y));
        vec3 sd = normalize(vec3(-uSun.x, uSun.y, -uSun.z));
        float s = max(dot(normalize(vD), sd), 0.0);
        c += vec3(1.0, 0.75, 0.4) * pow(s, 8.0) * 0.35 + vec3(1.0, 0.9, 0.7) * pow(s, 400.0) * 2.0;
        // streaky overcast bands
        float band = sin(vD.x * 6.0 + vD.z * 3.0 + y * 30.0) * 0.5 + 0.5;
        c = mix(c, c * 0.92, band * smoothstep(0.05, 0.4, y) * 0.5);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), mat);
  m.frustumCulled = false;
  return m;
}

export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.55, 0.88);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  return { composer, grade, bloom };
}
