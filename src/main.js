import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ---------- 工具 ---------- */
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const pulse = (x, a, b, e = 0.04) => sstep(a, a + e, x) * (1 - sstep(b - e, b, x));
const gauss = (x, c, w) => Math.exp(-Math.pow((x - c) / w, 2));
const $ = (id) => document.getElementById(id);
const setO = (node, v) => { node.style.opacity = v < 0.002 ? '0' : v.toFixed(3); };

const params = new URLSearchParams(location.search);
const forcedP = params.has('p') ? parseFloat(params.get('p')) : null; // 除錯用：?p=0.4 直接看某個進度

const isMobile = Math.min(innerWidth, innerHeight) < 768;

/* ---------- 七幕時間軸 ---------- */
// 創世、拉遠、培養、神蹟、額度、其他實驗場、你
const WEIGHTS = [1.0, 0.9, 1.7, 1.2, 1.1, 1.0, 1.1];
const B = [0];
{ const sum = WEIGHTS.reduce((s, w) => s + w, 0); let acc = 0; for (const w of WEIGHTS) { acc += w / sum; B.push(acc); } B[7] = 1; }
const local = (i, p) => clamp01((p - B[i]) / (B[i + 1] - B[i]));
const at = (i, u) => B[i] + (B[i + 1] - B[i]) * u; // 第 i 幕的 u 進度換成整體進度

/* ---------- 基本場景 ---------- */
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 2000);
camera.position.set(0, 0, 9);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.6, 0.32);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const WARM = new THREE.Color(1.0, 0.84, 0.58);
const COLD = new THREE.Color(0.45, 0.92, 1.0);
const KILL = new THREE.Color(1.0, 0.25, 0.14);

/* ---------- 星空 ---------- */
const stars = (() => {
  const n = isMobile ? 2500 : 6000;
  const pos = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 900 + Math.random() * 200;
    const s = Math.sqrt(1 - u * u);
    pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
    size[i] = 0.6 + Math.pow(Math.random(), 4) * 2.6;
    seed[i] = Math.random() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uPx: { value: renderer.getPixelRatio() } },
    vertexShader: `
      attribute float aSize; attribute float aSeed; uniform float uTime; uniform float uPx; varying float vTw;
      void main(){
        vTw = 0.65 + 0.35 * sin(uTime * (0.6 + fract(aSeed) * 1.4) + aSeed);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPx;
      }`,
    fragmentShader: `
      uniform float uAlpha; varying float vTw;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(0.85, 0.92, 1.0), a * vTw * uAlpha);
      }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  scene.add(p);
  return p;
})();

/* ---------- 塵埃 → 星雲 ---------- */
const dust = (() => {
  const n = isMobile ? 26000 : 80000;
  const start = new Float32Array(n * 3), target = new Float32Array(n * 3);
  const seed = new Float32Array(n), size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 6 + Math.pow(Math.random(), 0.6) * 34;
    const s = Math.sqrt(1 - u * u);
    start.set([r * s * Math.cos(th), r * u * 0.7, r * s * Math.sin(th)], i * 3);
    const rr = 2.3 + Math.pow(Math.random(), 1.6) * 8.5;
    const arm = Math.floor(Math.random() * 3) * (Math.PI * 2 / 3);
    const ang = arm + rr * 0.55 + (Math.random() - 0.5) * 1.1;
    const thick = (Math.random() - 0.5) * (0.25 + rr * 0.06);
    target.set([rr * Math.cos(ang), thick, rr * Math.sin(ang)], i * 3);
    seed[i] = Math.random();
    size[i] = 0.5 + Math.pow(Math.random(), 3) * 2.4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(start, 3));
  g.setAttribute('aTarget', new THREE.BufferAttribute(target, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uForm: { value: 0 }, uAlpha: { value: 0 }, uCold: { value: 0 },
      uPx: { value: renderer.getPixelRatio() },
    },
    vertexShader: `
      attribute vec3 aTarget; attribute float aSeed; attribute float aSize;
      uniform float uTime, uForm, uPx;
      varying float vR; varying float vSeed;
      mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
      void main(){
        float f = clamp(uForm * 1.45 - aSeed * 0.45, 0.0, 1.0);
        f = f * f * (3.0 - 2.0 * f);
        vec3 p = mix(position, aTarget, f);
        float r = length(aTarget.xz);
        float ang = (1.0 - f) * (2.5 + aSeed * 4.0) + uTime * 0.06 * (1.6 - r / 11.0);
        p.xz = rot(ang) * p.xz;
        p.y += sin(uTime * 0.4 + aSeed * 40.0) * 0.05 * (1.0 - f * 0.5);
        vR = r; vSeed = aSeed;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPx * (16.0 / -mv.z);
      }`,
    fragmentShader: `
      uniform float uAlpha, uCold; varying float vR; varying float vSeed;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        vec3 warm = mix(vec3(1.0, 0.86, 0.6), vec3(1.0, 0.55, 0.3), smoothstep(2.0, 9.0, vR));
        vec3 blue = mix(vec3(0.75, 0.86, 1.0), vec3(0.35, 0.5, 1.0), smoothstep(2.0, 9.0, vR));
        vec3 col = mix(warm, blue, step(0.62, vSeed));
        col = mix(col, vec3(0.35, 0.85, 1.0) * 0.8, uCold);
        gl_FragColor = vec4(col, a * a * uAlpha * 0.5);
      }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.rotation.x = 0.32;
  scene.add(p);
  return p;
})();

/* ---------- 那道光 ---------- */
const BEAM_TOP = 10.5;
const beam = (() => {
  const g = new THREE.PlaneGeometry(1, 1);
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: {
      uI: { value: 0 }, uColor: { value: WARM.clone() }, uTime: { value: 0 },
      uBottom: { value: -60 }, uTop: { value: BEAM_TOP }, uWidth: { value: 0.02 }, uPulse: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv; varying float vY;
      void main(){
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vY = w.y;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uI, uBottom, uTop, uTime, uWidth, uPulse; uniform vec3 uColor; varying vec2 vUv; varying float vY;
      void main(){
        float d = abs(vUv.x - 0.5) * 2.0;
        float core = exp(-d * d * (900.0 / max(uWidth, 0.02)));
        float glow = exp(-d * 9.0) * 0.07 * uWidth;
        float flick = 0.92 + 0.08 * sin(uTime * 9.0 + vY * 3.0);
        float clip = smoothstep(uBottom - 0.6, uBottom + 0.3, vY) * (1.0 - smoothstep(uTop - 0.2, uTop, vY));
        // 沿著光束往下送的指令脈衝
        float py = mix(uTop, uBottom, fract(uTime * 0.55));
        float band = exp(-pow((vY - py) / 0.5, 2.0));
        float a = (core * 1.2 + glow) * uI * flick * clip * (1.0 + uPulse * band * 4.0);
        a += exp(-d * d * 60.0) * band * uPulse * clip * 0.8;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.scale.set(7, 140, 1);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
})();

/* ---------- 星球 ---------- */
const PLANET_R = 1.6;
const IMPACT = new THREE.Vector3(0.45, 0.35, 0.82).normalize(); // 隕石落點（世界座標方向）
const NOISE = `
  float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x){
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++){ s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
`;
const planet = (() => {
  const m = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 }, uReveal: { value: 0 }, uCold: { value: 0 },
      uSeed: { value: 0 }, uLife: { value: 1 }, uWipe: { value: 0 }, uType: { value: 0 },
      uCity: { value: 0 }, uFlood: { value: 0 }, uPlague: { value: 0 }, uWar: { value: 0 },
      uImpact: { value: IMPACT.clone() },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vP; varying vec3 vV;
      void main(){
        vP = position;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uTime, uReveal, uCold, uSeed, uLife, uWipe, uType, uCity, uFlood, uPlague, uWar;
      uniform vec3 uImpact;
      varying vec3 vN; varying vec3 vP; varying vec3 vV;
      ${NOISE}
      void main(){
        vec3 p = normalize(vP);
        vec3 so = uSeed * vec3(7.31, 3.17, 5.71);
        float h = fbm(p * 1.7 + 3.1 + so);
        float land = smoothstep(0.50 + uFlood * 0.07, 0.545 + uFlood * 0.07, h);
        float detail = fbm(p * 5.0 + 20.0 + so);

        // 活著的樣子
        vec3 ocean = mix(vec3(0.010, 0.060, 0.220), vec3(0.030, 0.230, 0.480), smoothstep(0.30, 0.52, h));
        vec3 ground = mix(vec3(0.07, 0.26, 0.10), vec3(0.42, 0.35, 0.20), smoothstep(0.40, 0.66, detail));
        ground = mix(ground, vec3(0.30, 0.27, 0.24), smoothstep(0.60, 0.70, h));
        // 還沒投放物種的樣子：岩石和死水
        vec3 rock = mix(vec3(0.20, 0.17, 0.15), vec3(0.34, 0.29, 0.24), detail);
        vec3 deadSea = mix(vec3(0.02, 0.05, 0.10), vec3(0.06, 0.13, 0.20), smoothstep(0.30, 0.52, h));
        float lifeMask = smoothstep(1.0 - uLife * 1.35, 1.0 - uLife * 1.35 + 0.35, detail * 0.6 + vnoise(p * 9.0 + so) * 0.4);
        vec3 col = mix(mix(deadSea, ocean, lifeMask), mix(rock, ground, lifeMask), land);
        float ice = smoothstep(0.80, 0.92, abs(p.y) + (detail - 0.5) * 0.12);
        col = mix(col, vec3(0.90, 0.95, 1.0), ice);

        vec3 L = normalize(vec3(0.55, 0.75, 0.6));
        float nl = dot(vN, L);
        float diff = max(nl, 0.0);
        float spec = pow(max(dot(reflect(-L, vN), vV), 0.0), 40.0) * (1.0 - land) * 0.6;
        float c = fbm(p * 3.0 + vec3(uTime * 0.012, 0.0, uTime * 0.008) + so);
        float cloud = smoothstep(0.52, 0.72, c) * mix(0.35, 1.0, uLife);
        vec3 emit = vec3(0.0);

        // ---- 銷毀：五種方式 ----
        float w = uWipe;
        float cover = 0.0; // 整顆被蓋住的程度（用來換下一輪的地形）
        if (uType < 0.5) {
          // 冰封
          float lineY = mix(0.86, -0.25, w);
          float frozen = smoothstep(lineY, lineY + 0.12, abs(p.y) + (detail - 0.5) * 0.25);
          col = mix(col, vec3(0.60, 0.70, 0.82), frozen);
          cloud *= 1.0 - w * 0.6; spec *= 1.0 + w;
        } else if (uType < 1.5) {
          // 海洋缺氧
          vec3 rot = mix(vec3(0.10, 0.02, 0.12), vec3(0.05, 0.09, 0.03), detail);
          col = mix(col, mix(rot, vec3(0.16, 0.12, 0.08), land), w);
          cloud *= 1.0 - w * 0.85;
        } else if (uType < 3.5) {
          // 火山連續噴發（第四輪是比較短的同一招）
          float ridge = 1.0 - abs(fbm(p * 3.2 + so + 40.0) * 2.0 - 1.0);
          float crack = smoothstep(1.0 - w * 0.22, 1.0, ridge);
          col = mix(col, vec3(0.035, 0.03, 0.03), w * 0.92);
          emit += mix(vec3(1.2, 0.22, 0.03), vec3(1.6, 0.7, 0.15), crack) * crack * w * 0.7;
          cloud *= 1.0 - w * 0.4;
          col = mix(col, vec3(0.08, 0.07, 0.07), cloud * w);
          cloud *= 1.0 - w;
        } else {
          // 隕石
          float ang = acos(clamp(dot(vN, uImpact), -1.0, 1.0));
          float front = w * 3.5;
          float burned = smoothstep(front, front - 0.5, ang) * step(0.001, w);
          col = mix(col, vec3(0.04, 0.035, 0.03), burned * 0.95);
          float ember = smoothstep(0.62, 0.9, vnoise(p * 22.0 + uTime * 0.2)) * burned * (1.0 - w * 0.6);
          emit += vec3(1.1, 0.28, 0.04) * ember;
          float ring = exp(-pow((ang - front) / 0.07, 2.0)) * step(0.001, w) * (1.0 - smoothstep(0.85, 1.0, w));
          emit += vec3(1.4, 0.8, 0.35) * ring;
          emit += vec3(1.6, 1.3, 0.9) * exp(-ang * ang * 30.0) * (1.0 - smoothstep(0.0, 0.25, w)) * step(0.001, w);
          cloud *= 1.0 - burned;
        }

        col = mix(col, vec3(1.0), cloud * 0.85);
        vec3 lit = col * (0.04 + diff * 1.0) + spec;
        lit += col * 0.03;
        float fres = pow(1.0 - max(dot(vN, vV), 0.0), 3.0);
        lit += vec3(0.25, 0.55, 1.0) * fres * (0.25 + diff * 0.65) * (1.0 - w * 0.6);

        // 瘟疫：整顆發灰發綠
        float g0 = dot(lit, vec3(0.3, 0.59, 0.11));
        lit = mix(lit, vec3(g0) * vec3(0.72, 0.85, 0.45), uPlague * 0.8);
        // 戰爭：陸地上一閃一閃的火
        float fire = step(0.975, vnoise(p * 55.0 + floor(uTime * 4.0) * 3.7)) * land;
        emit += vec3(2.6, 0.7, 0.12) * fire * uWar;
        // 夜面的城市燈火
        float night = 1.0 - smoothstep(-0.12, 0.18, nl);
        float town = smoothstep(0.55, 0.85, vnoise(p * 42.0 + so)) * smoothstep(0.42, 0.62, fbm(p * 7.0 + 5.0 + so));
        emit += vec3(1.6, 1.15, 0.6) * town * land * night * uCity * (1.0 - cloud * 0.7);

        lit += emit;

        // 第一幕：剛成形時是熔融的，慢慢冷卻成藍色
        float cool = smoothstep(0.15, 0.85, uReveal);
        float lava = fbm(p * 4.0 + uTime * 0.05);
        vec3 molten = mix(vec3(0.85, 0.22, 0.03), vec3(1.25, 0.75, 0.25), smoothstep(0.4, 0.7, lava));
        lit = mix(molten, lit, cool);
        float g = dot(lit, vec3(0.3, 0.59, 0.11));
        lit = mix(lit, mix(vec3(g), lit, 0.75) * vec3(0.9, 1.0, 1.08), uCold);
        gl_FragColor = vec4(lit, smoothstep(0.0, 0.25, uReveal));
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(PLANET_R, 128, 96), m);
  scene.add(mesh);
  return mesh;
})();

const atmo = (() => {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    uniforms: { uReveal: { value: 0 }, uHot: { value: 1 }, uKill: { value: 0 } },
    vertexShader: `
      varying vec3 vN;
      void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uReveal, uHot, uKill; varying vec3 vN;
      void main(){
        float i = pow(max(0.72 - dot(vN, vec3(0.0, 0.0, 1.0)), 0.0), 3.2);
        vec3 col = mix(vec3(0.30, 0.60, 1.0), vec3(1.0, 0.55, 0.2), uHot);
        col = mix(col, vec3(1.0, 0.25, 0.12), uKill);
        gl_FragColor = vec4(col * i * 0.8, i) * uReveal;
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(PLANET_R * 1.16, 64, 48), m);
  scene.add(mesh);
  return mesh;
})();

/* ---------- 第二幕：全息環 ---------- */
const holoMat = new THREE.LineBasicMaterial({ color: COLD, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const holoDim = new THREE.LineBasicMaterial({ color: COLD, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const circlePts = (r, n = 180, a0 = 0, a1 = Math.PI * 2) => {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
  return pts;
};
const holo = new THREE.Group();
const holoRings = [];
(() => {
  const mk = (r, tiltX, tiltZ, speed, a0 = 0, a1 = Math.PI * 2, mat = holoMat) => {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(circlePts(r, 200, a0, a1)), mat);
    const pivot = new THREE.Group();
    pivot.rotation.set(tiltX, 0, tiltZ);
    pivot.add(l);
    holo.add(pivot);
    holoRings.push({ l, speed });
  };
  mk(2.35, 0, 0, 0.25);
  mk(2.42, 0, 0, 0.25, 0.2, 2.6);
  mk(3.1, 0.5, 0.2, -0.18);
  mk(3.9, -0.35, 0.6, 0.12, 0, Math.PI * 1.5);
  mk(2.7, Math.PI / 2, 0, 0.3, 0, Math.PI * 2, holoDim);
  mk(4.6, 0.12, -0.1, -0.06, 0, Math.PI * 2, holoDim);
  const seg = [];
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2, r0 = 4.6, r1 = 4.6 + (i % 10 === 0 ? 0.32 : i % 5 === 0 ? 0.2 : 0.1);
    seg.push(Math.cos(a) * r0, 0, Math.sin(a) * r0, Math.cos(a) * r1, 0, Math.sin(a) * r1);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  const ticks = new THREE.LineSegments(tg, holoMat);
  const pivot = new THREE.Group();
  pivot.rotation.set(0.12, 0, -0.1);
  pivot.add(ticks);
  holo.add(pivot);
  holoRings.push({ l: ticks, speed: -0.06 });
  scene.add(holo);
})();

/* ---------- 實驗艙（線框） ---------- */
const CH_R = 30, CH_Y0 = -14, CH_Y1 = 20;
// 往 seg 陣列塞一個艙的線段；detail 高的是地球這個艙，低的是遠處的其他艙
const pushChamber = (seg, cx, cz, detail) => {
  const ribs = detail ? 36 : 10, hoopN = detail ? 96 : 28;
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2;
    seg.push(cx + Math.cos(a) * CH_R, CH_Y0, cz + Math.sin(a) * CH_R, cx + Math.cos(a) * CH_R, CH_Y1, cz + Math.sin(a) * CH_R);
  }
  const hoop = (r, y) => {
    for (let i = 0; i < hoopN; i++) {
      const a0 = (i / hoopN) * Math.PI * 2, a1 = ((i + 1) / hoopN) * Math.PI * 2;
      seg.push(cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r, cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r);
    }
  };
  if (detail) {
    for (let y = CH_Y0; y <= CH_Y1; y += 4.25) hoop(CH_R, y);
    for (const y of [CH_Y0, CH_Y1]) {
      for (const r of [4, 9, 15, 22]) hoop(r, y);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        seg.push(cx + Math.cos(a) * 4, y, cz + Math.sin(a) * 4, cx + Math.cos(a) * CH_R, y, cz + Math.sin(a) * CH_R);
      }
    }
  } else {
    hoop(CH_R, CH_Y0); hoop(CH_R, 3); hoop(CH_R, CH_Y1); hoop(10, CH_Y0);
  }
};
const lineMat = (r, g, b) => new THREE.LineBasicMaterial({ color: new THREE.Color(r, g, b), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const mkLines = (seg, mat) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  const l = new THREE.LineSegments(g, mat);
  l.frustumCulled = false;
  scene.add(l);
  return l;
};
const chamberMat = lineMat(0.22, 0.6, 0.72);
{ const seg = []; pushChamber(seg, 0, 0, true); mkLines(seg, chamberMat); }

/* ---------- 第六幕：其他實驗場 ---------- */
const others = (() => {
  const liveMat = lineMat(0.2, 0.55, 0.66), deadMat = lineMat(0.16, 0.2, 0.24), beamMat = lineMat(0.5, 0.95, 1.0);
  const liveSeg = [], deadSeg = [], beamSeg = [];
  const pos = [], col = [];
  const palette = [[1.0, 0.35, 0.2], [0.3, 0.6, 1.0], [0.95, 0.95, 1.0], [1.0, 0.7, 0.3], [0.4, 1.0, 0.7], [0.8, 0.5, 1.0]];
  let rnd = 20261122; const rand = () => { rnd = (rnd * 1664525 + 1013904223) >>> 0; return rnd / 4294967296; };
  const SP = 86;
  let live = 1, dead = 0; // 地球算一個觀察中
  for (let i = -4; i <= 4; i++) for (let j = -3; j <= 3; j++) {
    if (i === 0 && j === 0) continue;
    const cx = i * SP, cz = j * SP;
    if (rand() < 0.3) { dead++; pushChamber(deadSeg, cx, cz, false); continue; }
    live++;
    pushChamber(liveSeg, cx, cz, false);
    beamSeg.push(cx, BEAM_TOP, cz, cx, 1.6, cz);
    pos.push(cx, 0, cz);
    col.push(...palette[Math.floor(rand() * palette.length)]);
  }
  mkLines(liveSeg, liveMat); mkLines(deadSeg, deadMat); mkLines(beamSeg, beamMat);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const dotMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    uniforms: { uAlpha: { value: 0 }, uPx: { value: renderer.getPixelRatio() } },
    vertexShader: `
      uniform float uPx; varying vec3 vC;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uPx * clamp(2600.0 / -mv.z, 3.0, 60.0); }`,
    fragmentShader: `
      uniform float uAlpha; varying vec3 vC;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.08, d); gl_FragColor = vec4(vC * (0.6 + a), a * uAlpha); }`,
  });
  const dots = new THREE.Points(g, dotMat);
  dots.frustumCulled = false;
  scene.add(dots);
  return { liveMat, deadMat, beamMat, dotMat, live, dead, total: live + dead };
})();

/* ---------- 光束的來源（儀器） ---------- */
const emitterMat = new THREE.MeshBasicMaterial({ color: COLD, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const emitterBody = new THREE.MeshBasicMaterial({ color: 0x06141a, transparent: true, opacity: 0 });
const emitterEdge = new THREE.LineBasicMaterial({ color: COLD, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const emitter = (() => {
  const grp = new THREE.Group();
  grp.position.y = BEAM_TOP;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 0.9, 3.2, 12, 1), emitterBody);
  body.position.y = 1.7;
  grp.add(body);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry), emitterEdge);
  edges.position.copy(body.position);
  grp.add(edges);
  const rings = [];
  for (const [r, t, y] of [[1.25, 0.035, -0.1], [2.1, 0.03, -0.9], [3.2, 0.022, -1.9]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, 96), emitterMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    grp.add(ring);
    rings.push(ring);
  }
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.55, 48), emitterMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.y = 0.05;
  grp.add(lens);
  const seg = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    seg.push(Math.cos(a) * 2.6, 3.3, Math.sin(a) * 2.6, Math.cos(a) * 9, CH_Y1 - BEAM_TOP, Math.sin(a) * 9);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  grp.add(new THREE.LineSegments(sg, emitterEdge));
  scene.add(grp);
  return { grp, rings };
})();

/* ---------- 第三幕：隕石 ---------- */
const meteor = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const m = new THREE.LineBasicMaterial({ color: new THREE.Color(3, 2.2, 1.4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const l = new THREE.Line(g, m);
  l.frustumCulled = false;
  scene.add(l);
  return l;
})();

/* ---------- 第四幕：祈禱（往上升、到不了） ---------- */
const prayers = (() => {
  const n = isMobile ? 1800 : 4500;
  const dir = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 1.6 - 0.6, th = Math.random() * Math.PI * 2, s = Math.sqrt(Math.max(0, 1 - u * u));
    dir.set([s * Math.cos(th), u, s * Math.sin(th)], i * 3);
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(dir, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uPx: { value: renderer.getPixelRatio() } },
    vertexShader: `
      attribute float aSeed; uniform float uTime, uPx; varying float vA;
      void main(){
        float f = fract(uTime * (0.035 + aSeed * 0.03) + aSeed * 7.0);
        vec3 p = position * ${PLANET_R.toFixed(2)};
        // 從地表升起，往光束靠攏，但在半路就散掉
        p.y += f * 6.5;
        p.xz *= 1.0 - f * 0.78;
        p.xz += vec2(sin(uTime * 0.7 + aSeed * 30.0), cos(uTime * 0.6 + aSeed * 20.0)) * 0.08;
        vA = sin(3.14159 * f) * (1.0 - smoothstep(0.55, 0.92, f));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * (1.0 + aSeed * 1.6) * (15.0 / -mv.z);
      }`,
    fragmentShader: `
      uniform float uAlpha; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(1.0, 0.82, 0.5), a * a * vA * uAlpha); }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  scene.add(p);
  return p;
})();

/* ---------- 第五幕：衛星 ---------- */
const sats = (() => {
  const n = 220;
  const a = new Float32Array(n * 3), b = new Float32Array(n * 3), seed = new Float32Array(n), idx = new Float32Array(n);
  const v = new THREE.Vector3(), nrm = new THREE.Vector3(), u2 = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    nrm.set(Math.random() - 0.5, Math.random() - 0.5 + 0.8, Math.random() - 0.5).normalize();
    v.set(1, 0, 0).cross(nrm).normalize();
    u2.copy(nrm).cross(v).normalize();
    const r = 1.85 + Math.random() * 0.75;
    a.set([v.x * r, v.y * r, v.z * r], i * 3); b.set([u2.x * r, u2.y * r, u2.z * r], i * 3);
    seed[i] = Math.random(); idx[i] = i / n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  g.setAttribute('aB', new THREE.BufferAttribute(b, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uCount: { value: 0 }, uPx: { value: renderer.getPixelRatio() } },
    vertexShader: `
      attribute vec3 aB; attribute float aSeed, aIdx; uniform float uTime, uCount, uPx; varying float vA;
      void main(){
        float ang = aSeed * 6.2832 + uTime * (0.25 + aSeed * 0.35);
        vec3 p = position * cos(ang) + aB * sin(ang);
        vA = step(aIdx, uCount);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * (14.0 / -mv.z);
      }`,
    fragmentShader: `
      varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(0.75, 0.95, 1.0), a * vA); }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  scene.add(p);
  return p;
})();

/* ---------- DOM ---------- */
const q = (sel) => [...document.querySelectorAll(sel)];
const el = {
  flash: $('flash'), cloud: $('cloud'), dark: $('dark'), frame: $('frame'), hint: $('hint'),
  line1: $('line1'), line2: $('line2'), hudLayer: $('hud'), hud: q('#hud li'),
  beam: $('v-beam'), air: $('v-air'), orbit: $('v-orbit'), id: $('v-id'),
  a3: $('a3'), rounds: q('#rounds li'), a3end: $('a3end'),
  a4: $('a4'), switches: q('#switches li'), a4b: $('a4b'), a4note: $('a4note'), a4h: $('a4h'),
  a5: $('a5'), locks: q('#locks li'), a5b: $('a5b'),
  a6: $('a6'), a7: $('a7'), you: q('#you li'), a7h: $('a7h'), a7p: $('a7p'),
  yTime: $('y-time'), yZone: $('y-zone'), yScreen: $('y-screen'), yLang: $('y-lang'), yStay: $('y-stay'),
};
$('v-total').textContent = others.total;
$('v-live').textContent = others.live;
$('v-dead').textContent = others.dead;
const FINAL_ID = '000006';
let lastIdTick = 0;
const row = (li, v) => { setO(li, v); li.style.transform = `translateY(${((1 - v) * 8).toFixed(1)}px)`; };
const toggle = (li, on, onText, offText) => {
  if (li.classList.contains('on') !== on) { li.classList.toggle('on', on); li.lastElementChild.textContent = on ? onText : offText; }
};

// 第七幕顯示的是訪客瀏覽器裡的真實資訊，只在本機顯示，不會送出去
const t0 = performance.now();
const pad = (n) => String(n).padStart(2, '0');
let lastYou = -1;
const updateYou = () => {
  const now = new Date(), sec = Math.floor((performance.now() - t0) / 1000);
  if (sec === lastYou) return; lastYou = sec;
  el.yTime.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  el.yZone.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || '未知';
  el.yScreen.textContent = `${screen.width} × ${screen.height}`;
  el.yLang.textContent = navigator.language || '未知';
  el.yStay.textContent = `${Math.floor(sec / 60)} 分 ${pad(sec % 60)} 秒`;
};

/* ---------- 第三幕：六輪的狀態 ---------- */
const ROUND_W = [0.13, 0.13, 0.15, 0.09, 0.22, 0.28];
const ROUND_B = [0]; { let acc = 0; for (const w of ROUND_W) { acc += w; ROUND_B.push(acc); } ROUND_B[6] = 1; }
const roundState = (p) => {
  if (p <= B[2]) return { r: 0, u: 0, life: 1, wipe: 0, type: 0, seed: 0 };
  if (p >= B[3]) return { r: 5, u: 1, life: 1, wipe: 0, type: 0, seed: 5 };
  const c = local(2, p);
  let r = 0; while (r < 5 && c >= ROUND_B[r + 1]) r++;
  const u = clamp01((c - ROUND_B[r]) / (ROUND_B[r + 1] - ROUND_B[r]));
  if (r === 5) return { r, u, life: sstep(0.0, 0.5, u), wipe: 0, type: 0, seed: 5 };
  const swapped = u >= 0.85; // 整顆被蓋住時換成下一輪的地形
  return {
    r, u,
    life: swapped ? 0 : (r === 0 ? 1 : sstep(0.0, 0.4, u)),
    wipe: u < 0.8 ? sstep(0.55, 0.8, u) : 1 - sstep(0.9, 1.0, u),
    type: r, seed: swapped ? r + 1 : r,
  };
};

/* ---------- 鏡頭關鍵格 ---------- */
// z 距離、y 高度、orb 繞行角度、sx 讓星球往畫面右邊偏多少、ly 視線高度；[桌機, 直式手機]
const K = [
  { p: B[0], z: [10.5, 17], y: 1.2, orb: 0, sx: [0, 0], ly: [0, 0] },
  { p: B[1], z: [6.2, 11.5], y: 0.5, orb: 0, sx: [0, 0], ly: [0, 0] },
  { p: B[2], z: [24, 40], y: 3.4, orb: 0.5, sx: [0, 0], ly: [4.8, 5.4] },
  { p: at(2, 0.1), z: [8.6, 15], y: 0.9, orb: 0.3, sx: [2.3, 0], ly: [0, 2.2] },
  { p: B[3], z: [8.6, 15], y: 0.9, orb: 0.42, sx: [2.3, 0], ly: [0, 2.2] },
  { p: at(3, 0.22), z: [13, 22], y: 1.6, orb: 0.1, sx: [2.3, 0], ly: [2.9, 2.6] },
  { p: B[4], z: [13, 22], y: 1.6, orb: -0.1, sx: [2.3, 0], ly: [2.9, 2.6] },
  { p: at(4, 0.25), z: [7.6, 16], y: 0.7, orb: 3.75, sx: [-2.2, 0], ly: [0, 0.9] },
  { p: B[5], z: [7.6, 16], y: 0.7, orb: 3.95, sx: [-2.2, 0], ly: [0, 0.9] },
  { p: at(5, 0.3), z: [36, 44], y: 9, orb: 4.1, sx: [0, 0], ly: [2, 2] },
  { p: B[6], z: [300, 420], y: 150, orb: 4.5, sx: [0, 0], ly: [-20, -20] },
  { p: at(6, 0.44), z: [2.5, 2.5], y: 0.3, orb: 6.9, sx: [0, 0], ly: [0, 0], ease: 2.0 },
  { p: 1.001, z: [1.9, 1.9], y: 0.3, orb: 7.0, sx: [0, 0], ly: [0, 0] },
];
const camState = { z: 9, y: 0, orb: 0, sx: 0, ly: 0 };
const sampleCam = (p, narrow) => {
  let i = 0; while (i < K.length - 2 && p >= K[i + 1].p) i++;
  const a = K[i], b = K[i + 1], n = narrow ? 1 : 0;
  let u = clamp01((p - a.p) / (b.p - a.p));
  u = b.ease ? Math.pow(u, b.ease) : u * u * (3 - 2 * u);
  camState.z = lerp(a.z[n], b.z[n], u); camState.y = lerp(a.y, b.y, u); camState.orb = lerp(a.orb, b.orb, u);
  camState.sx = lerp(a.sx[n], b.sx[n], u); camState.ly = lerp(a.ly[n], b.ly[n], u);
};

/* ---------- 捲動 ---------- */
let target = 0, p = forcedP ?? 0;
const readScroll = () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  target = max > 0 ? clamp01(scrollY / max) : 0;
};
addEventListener('scroll', readScroll, { passive: true });
readScroll();

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  readScroll();
});

/* ---------- 主迴圈 ---------- */
const clock = new THREE.Clock();
const lookAt = new THREE.Vector3(), right = new THREE.Vector3(), mHead = new THREE.Vector3();
const tmpColor = new THREE.Color();

function frame() {
  const t = clock.getElapsedTime();
  if (forcedP === null) p += (target - p) * 0.07;

  const a = local(0, p), b = local(1, p), c = local(2, p), d = local(3, p), e = local(4, p), f = local(5, p), g = local(6, p);
  const cold = sstep(0.05, 0.55, b);
  const narrow = camera.aspect < 0.8;
  const rs = roundState(p);
  const killing = rs.wipe; // 0~1，正在銷毀

  /* 那道光 */
  const crack = sstep(0.02, 0.10, a);
  const open = sstep(0.11, 0.24, a);
  const prophet = pulse(d, 0.44, 0.57) + pulse(d, 0.57, 0.70) * 1.6; // 先知、啟示：沿著光送下去
  const bu = beam.material.uniforms;
  bu.uTime.value = t;
  bu.uWidth.value = lerp(0.02, 1.0, open) * lerp(1.0, 0.5, sstep(0.5, 0.95, a)) * lerp(1.0, 0.8, cold);
  bu.uI.value = crack * lerp(1.0, 1.15, open) * lerp(1.0, 0.5, sstep(0.5, 0.95, a)) * lerp(1.0, 1.3, cold) * (1 + killing * 0.35) * (1 - sstep(0.35, 0.5, g));
  bu.uBottom.value = lerp(-60, PLANET_R * 0.98, sstep(0.5, 0.8, a));
  bu.uPulse.value = prophet;
  tmpColor.copy(WARM).lerp(COLD, cold).lerp(KILL, killing * 0.85);
  bu.uColor.value.copy(tmpColor);
  beam.rotation.y = Math.atan2(camera.position.x, camera.position.z);

  /* 星空、塵埃 */
  stars.material.uniforms.uTime.value = t;
  stars.material.uniforms.uAlpha.value = sstep(0.13, 0.4, a) * lerp(1, 0.08, sstep(0.1, 0.6, b));
  stars.rotation.y = t * 0.004;
  const du = dust.material.uniforms;
  du.uTime.value = t;
  du.uForm.value = sstep(0.16, 0.74, a);
  du.uAlpha.value = sstep(0.12, 0.3, a) * lerp(1, 0.55, sstep(0.7, 1, a)) * lerp(1, 0.35, sstep(0.2, 0.8, b)) * (1 - sstep(0.0, 0.12, c));
  du.uCold.value = cold;
  dust.visible = du.uAlpha.value > 0.002;

  /* 星球 */
  const reveal = sstep(0.52, 0.96, a);
  const pu = planet.material.uniforms;
  pu.uTime.value = t; pu.uReveal.value = reveal; pu.uCold.value = cold;
  pu.uSeed.value = rs.seed; pu.uLife.value = rs.life; pu.uWipe.value = rs.wipe; pu.uType.value = rs.type;
  pu.uFlood.value = pulse(d, 0.18, 0.31);
  pu.uPlague.value = pulse(d, 0.31, 0.44);
  pu.uWar.value = pulse(d, 0.70, 0.93);
  pu.uCity.value = sstep(0.12, 0.9, e);
  planet.rotation.y = t * 0.035;
  const sc = lerp(0.35, 1, sstep(0.52, 0.8, a));
  planet.scale.setScalar(sc);
  atmo.scale.setScalar(sc);
  atmo.material.uniforms.uReveal.value = reveal;
  atmo.material.uniforms.uHot.value = 1 - sstep(0.3, 0.9, reveal);
  atmo.material.uniforms.uKill.value = killing * (rs.type >= 2 ? 0.6 : 0.15);

  /* 隕石：第五輪，銷毀前飛進來 */
  if (rs.r === 4 && rs.u > 0.455 && rs.u < 0.56 && p > B[2] && p < B[3]) {
    const k = (rs.u - 0.455) / 0.105;
    const dist = PLANET_R + (1 - k) * (1 - k) * 26;
    mHead.copy(IMPACT).multiplyScalar(dist);
    const arr = meteor.geometry.attributes.position.array;
    arr[0] = mHead.x; arr[1] = mHead.y; arr[2] = mHead.z;
    const tail = dist + 1.2 + (1 - k) * 5;
    arr[3] = IMPACT.x * tail; arr[4] = IMPACT.y * tail; arr[5] = IMPACT.z * tail;
    meteor.geometry.attributes.position.needsUpdate = true;
    meteor.material.opacity = sstep(0, 0.15, k);
  } else meteor.material.opacity = 0;
  const impactFlash = (rs.r === 4 && p > B[2] && p < B[3]) ? gauss(rs.u, 0.565, 0.012) * 0.75 : 0;
  setO(el.flash, gauss(a, 0.125, 0.028) * 0.7 * (p < B[1] ? 1 : 0) + impactFlash);

  /* 全息環、艙體、儀器 */
  const holoA = sstep(0.14, 0.5, b) * (1 - sstep(0.15, 0.45, f));
  holoMat.opacity = holoA * 0.85;
  holoDim.opacity = holoA * 0.35;
  holo.scale.setScalar(lerp(0.6, 1, sstep(0.14, 0.6, b)));
  for (const r of holoRings) r.l.rotation.y = t * r.speed;
  chamberMat.opacity = sstep(0.28, 0.85, b) * 0.5 * lerp(1, 0.55, sstep(0.3, 0.9, f));
  const em = sstep(0.22, 0.7, b);
  emitterMat.opacity = em; emitterBody.opacity = em; emitterEdge.opacity = em * 0.8;
  emitter.rings.forEach((r, i) => { r.rotation.z = t * (0.4 - i * 0.25); });

  /* 祈禱、衛星 */
  prayers.material.uniforms.uTime.value = t;
  prayers.material.uniforms.uAlpha.value = sstep(0.02, 0.16, d) * (1 - sstep(0.0, 0.2, e));
  prayers.visible = prayers.material.uniforms.uAlpha.value > 0.002;
  sats.material.uniforms.uTime.value = t;
  sats.material.uniforms.uCount.value = sstep(0.5, 0.98, e) * (1 - sstep(0.3, 0.45, g));

  /* 其他實驗場 */
  const oth = sstep(0.28, 0.75, f) * (1 - sstep(0.15, 0.42, g));
  others.liveMat.opacity = oth * 0.38; others.deadMat.opacity = oth * 0.22; others.beamMat.opacity = oth * 0.8;
  others.dotMat.uniforms.uAlpha.value = oth;

  /* 鏡頭 */
  sampleCam(p, narrow);
  const orb = camState.orb + Math.sin(t * 0.07) * 0.05;
  camera.position.set(Math.sin(orb) * camState.z, camState.y, Math.cos(orb) * camState.z);
  right.set(Math.cos(orb), 0, -Math.sin(orb));
  lookAt.set(0, camState.ly, 0).addScaledVector(right, -camState.sx);
  camera.lookAt(lookAt);

  bloom.strength = lerp(0.75, 0.6, cold) * lerp(1, 0.55, sstep(0.0, 0.15, c)) + Number(el.flash.style.opacity) * 1.0 + killing * 0.08;
  bloom.threshold = lerp(0.32, 0.5, sstep(0.0, 0.15, c));

  /* ---- 文字 ---- */
  setO(el.hint, 1 - sstep(0.0, 0.004, p));
  setO(el.line1, sstep(0.72, 0.88, a) * (1 - sstep(0.02, 0.16, b)));
  const act2Out = 1 - sstep(0.0, 0.08, c);
  setO(el.line2, sstep(0.56, 0.74, b) * act2Out);
  setO(el.hudLayer, act2Out);
  el.hud.forEach((li, i) => row(li, sstep(0.34 + i * 0.065, 0.42 + i * 0.065, b)));
  el.beam.textContent = (99.97 * sstep(0.36, 0.72, b)).toFixed(2) + '%';
  el.air.textContent = (100 * sstep(0.44, 0.8, b)).toFixed(2) + '%';
  el.orbit.textContent = (99.2 * sstep(0.5, 0.86, b)).toFixed(2) + '%';
  if (b < 0.8) {
    if (t - lastIdTick > 0.06) { lastIdTick = t; el.id.textContent = Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join(''); }
  } else if (el.id.textContent !== FINAL_ID) el.id.textContent = FINAL_ID;

  // 第三幕
  const in3 = p > B[2];
  setO(el.a3, sstep(0.03, 0.09, c) * (1 - sstep(0.0, 0.08, d)));
  el.rounds.forEach((li, i) => {
    const shown = !in3 ? 0 : rs.r > i ? 1 : rs.r === i ? sstep(0.0, 0.1, rs.u + (i === 0 ? 0.1 : 0)) : 0;
    setO(li, shown * (rs.r > i ? 0.55 : 1));
    const kill = li.querySelector('i');
    if (kill) setO(kill, rs.r > i ? 1 : rs.r === i ? sstep(0.6, 0.7, rs.u) : 0);
  });
  setO(el.a3end, rs.r === 5 && in3 ? sstep(0.45, 0.62, rs.u) : 0);

  // 第四幕
  const act4Out = 1 - sstep(0.0, 0.09, e);
  setO(el.a4, sstep(0.06, 0.14, d) * act4Out);
  setO(el.a4b, sstep(0.04, 0.1, d) * act4Out);
  setO(el.a4note, sstep(0.06, 0.16, d));
  setO(el.a4h, sstep(0.6, 0.74, d));
  el.switches.forEach((li, i) => {
    row(li, sstep(0.08 + i * 0.02, 0.14 + i * 0.02, d));
    const s0 = 0.18 + i * 0.13;
    toggle(li, d > s0 && d < (i === 4 ? 0.93 : s0 + 0.13), '開', '關');
  });

  // 第五幕
  const act5Out = 1 - sstep(0.0, 0.1, f);
  setO(el.a5, sstep(0.06, 0.14, e) * act5Out);
  setO(el.a5b, sstep(0.72, 0.86, e) * act5Out);
  el.locks.forEach((li, i) => {
    row(li, sstep(0.08 + i * 0.02, 0.14 + i * 0.02, e));
    toggle(li, e > 0.16 + i * 0.1, '已開放', '鎖定');
  });

  // 第六幕
  setO(el.a6, sstep(0.5, 0.7, f) * (1 - sstep(0.0, 0.12, g)));

  // 第七幕
  setO(el.cloud, gauss(g, 0.5, 0.045) * 0.97);
  setO(el.dark, sstep(0.5, 0.58, g) * 0.94);
  setO(el.frame, sstep(0.6, 0.7, g));
  setO(el.a7, sstep(0.6, 0.66, g));
  if (g > 0.55) updateYou();
  el.you.forEach((li, i) => row(li, sstep(0.64 + i * 0.03, 0.69 + i * 0.03, g)));
  setO(el.a7h, sstep(0.82, 0.9, g));
  setO(el.a7p, sstep(0.93, 0.99, g));

  composer.render();
  requestAnimationFrame(frame);
}
frame();
