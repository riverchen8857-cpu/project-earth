import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { feature } from 'topojson-client';
import landTopo from 'world-atlas/land-110m.json';
import { createSea, SEA_IN, SEA_OUT } from './sea.js';

/* ---------- 工具 ---------- */
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const pulse = (x, a, b, e = 0.04) => sstep(a, a + e, x) * (1 - sstep(b - e, b, x));
const gauss = (x, c, w) => Math.exp(-Math.pow((x - c) / w, 2));
const $ = (id) => document.getElementById(id);
const setO = (node, v) => { node.style.opacity = v < 0.002 ? '0' : v.toFixed(3); };
const setT = (node, s) => { if (node.textContent !== s) node.textContent = s; };
let seedN = 20261122;
const rand = () => { seedN = (seedN * 1664525 + 1013904223) >>> 0; return seedN / 4294967296; };

const params = new URLSearchParams(location.search);
const forcedP = params.has('p') ? parseFloat(params.get('p')) : null; // 除錯用：?p=0.4 直接看某個進度

const isMobile = Math.min(innerWidth, innerHeight) < 768;

/* ---------- 八幕時間軸 ---------- */
// 0 創世（大爆炸到地球）、1 拉遠、2 五次銷毀、3 祈禱、4 壓制、5 其他實驗場、6 回到那道光、7 你
const WEIGHTS = [1.5, 0.9, 3.54, 1.2, 1.9, 0.9, 0.9, 1.0];
const NA = WEIGHTS.length;
const B = [0];
{ const sum = WEIGHTS.reduce((s, w) => s + w, 0); let acc = 0; for (const w of WEIGHTS) { acc += w / sum; B.push(acc); } B[NA] = 1; }
const local = (i, p) => clamp01((p - B[i]) / (B[i + 1] - B[i]));
const at = (i, u) => B[i] + (B[i + 1] - B[i]) * u;

/* ---------- 基本場景 ---------- */
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const PX = renderer.getPixelRatio();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const FOV = 45, TAN = Math.tan((FOV / 2) * Math.PI / 180);
const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.05, 14000);
camera.position.set(0, 0, 9);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.6, 0.32);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const WARM = new THREE.Color(1.0, 0.84, 0.58);
const COLD = new THREE.Color(0.45, 0.92, 1.0);
const KILL = new THREE.Color(1.0, 0.25, 0.14);
const ADD = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
const PI = Math.PI;

/* ---------- 星空 ---------- */
const stars = (() => {
  const n = isMobile ? 2500 : 6000;
  const pos = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 1500 + Math.random() * 300;
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
    ...ADD,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uPx: { value: PX } },
    vertexShader: `
      attribute float aSize; attribute float aSeed; uniform float uTime; uniform float uPx; varying float vTw;
      void main(){
        vTw = 0.65 + 0.35 * sin(uTime * (0.6 + fract(aSeed) * 1.4) + aSeed);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uPx;
      }`,
    fragmentShader: `
      uniform float uAlpha; varying float vTw;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(0.85, 0.92, 1.0), a * vTw * uAlpha); }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  scene.add(p);
  return p;
})();

/* ---------- 那道光 ---------- */
const BEAM_TOP = 10.5;
const beam = (() => {
  const m = new THREE.ShaderMaterial({
    ...ADD, depthTest: false, side: THREE.DoubleSide,
    uniforms: {
      uI: { value: 0 }, uColor: { value: WARM.clone() }, uTime: { value: 0 },
      uBottom: { value: -60 }, uTop: { value: BEAM_TOP }, uWidth: { value: 0.02 },
    },
    vertexShader: `
      varying vec2 vUv; varying float vY;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float uI, uBottom, uTop, uTime, uWidth; uniform vec3 uColor; varying vec2 vUv; varying float vY;
      void main(){
        float d = abs(vUv.x - 0.5) * 2.0;
        float core = exp(-d * d * (900.0 / max(uWidth, 0.02)));
        float glow = exp(-d * 9.0) * 0.07 * uWidth;
        float flick = 0.92 + 0.08 * sin(uTime * 9.0 + vY * 3.0);
        float clip = smoothstep(uBottom - 0.6, uBottom + 0.3, vY) * (1.0 - smoothstep(uTop - 0.2, uTop, vY));
        float a = (core * 1.2 + glow) * uI * flick * clip;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
  mesh.scale.set(7, 140, 1);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
})();

/* ---------- 星球 ---------- */
const PLANET_R = 1.6;
const IMPACT = new THREE.Vector3(0.45, 0.35, 0.82).normalize();
const NOISE = `
  float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x){
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++){ s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
`;
// 真實的大陸輪廓（Natural Earth 1:110m），畫成一張經緯度展開的遮罩給星球用
const landMap = (() => {
  const W = 2048, H = 1024, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.filter = 'blur(1.6px)';
  ctx.fillStyle = '#fff';
  const geo = feature(landTopo, landTopo.objects.land);
  const polys = [];
  for (const f of (geo.features || [geo])) {
    const gm = f.geometry;
    if (gm.type === 'Polygon') polys.push(gm.coordinates); else if (gm.type === 'MultiPolygon') polys.push(...gm.coordinates);
  }
  for (const poly of polys) {
    ctx.beginPath();
    for (const ring of poly) {
      ring.forEach(([lon, lat], i) => { const x = (lon + 180) / 360 * W, y = (90 - lat) / 180 * H; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath();
    }
    ctx.fill('evenodd');
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
})();
const planet = (() => {
  const m = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 }, uReveal: { value: 0 }, uCold: { value: 0 },
      uSeed: { value: 0 }, uLife: { value: 1 }, uWipe: { value: 0 }, uType: { value: 0 },
      uSpark: { value: 0 }, uFlood: { value: 0 }, uPlague: { value: 0 }, uWar: { value: 0 },
      uImpact: { value: IMPACT.clone() }, uMap: { value: landMap }, uReal: { value: 0 }, uEra: { value: 4 }, uFade: { value: 1 },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vP; varying vec3 vV; varying vec2 vUv;
      void main(){
        vP = position; vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform float uTime, uReveal, uCold, uSeed, uLife, uWipe, uType, uSpark, uFlood, uPlague, uWar;
      uniform vec3 uImpact; uniform sampler2D uMap; uniform float uReal, uEra, uFade;
      varying vec3 vN; varying vec3 vP; varying vec3 vV; varying vec2 vUv;
      ${NOISE}
      void main(){
        vec3 p = normalize(vP);
        vec3 so = uSeed * vec3(7.31, 3.17, 5.71);
        float h = fbm(p * 1.7 + 3.1 + so);
        float detail = fbm(p * 5.0 + 20.0 + so);
        // 各年代陸地的大致分布（近似，不是精確的古地理重建）
        float bias = 0.0;
        if (uEra < 0.5) bias = smoothstep(-0.05, -0.85, p.y) * 0.15 - 0.045;                       // 奧陶紀：陸地集中在南半球
        else if (uEra < 1.5) bias = max(smoothstep(0.1, -0.8, p.y) * 0.13, smoothstep(0.55, 0.95, dot(p, normalize(vec3(0.7, 0.35, 0.6)))) * 0.14) - 0.05; // 泥盆紀：南方大陸加一塊赤道大陸
        else if (uEra < 3.5) bias = smoothstep(0.62, 0.05, abs(dot(p, normalize(vec3(0.75, 0.0, -0.66))))) * smoothstep(-0.25, 0.35, dot(p, normalize(vec3(0.66, 0.0, 0.75)))) * 0.2 - 0.085; // 二疊紀、三疊紀：盤古大陸
        float procLand = smoothstep(0.50 + uFlood * 0.075, 0.545 + uFlood * 0.075, h + bias);
        float realRaw = texture2D(uMap, vUv).r;
        // 洪水：地勢低的地方先被淹掉
        float realLand = smoothstep(0.45, 0.6, realRaw - uFlood * smoothstep(0.66, 0.36, h) * 1.3);
        float land = mix(procLand, realLand, uReal);

        vec3 ocean = mix(vec3(0.010, 0.060, 0.220), vec3(0.030, 0.230, 0.480), smoothstep(0.30, 0.52, h));
        vec3 ground = mix(vec3(0.07, 0.26, 0.10), vec3(0.42, 0.35, 0.20), smoothstep(0.40, 0.66, detail));
        ground = mix(ground, vec3(0.30, 0.27, 0.24), smoothstep(0.60, 0.70, h));
        float lat = abs(p.y);
        vec3 realGround = mix(vec3(0.06, 0.24, 0.09), vec3(0.50, 0.41, 0.24), smoothstep(0.22, 0.38, lat + (detail - 0.5) * 0.35) * (1.0 - smoothstep(0.48, 0.62, lat)));
        realGround = mix(realGround, vec3(0.12, 0.22, 0.12), smoothstep(0.62, 0.8, lat));
        ground = mix(ground, realGround, uReal);
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
        if (uType < 0.5) {
          float lineY = mix(0.86, -0.25, w);
          float frozen = smoothstep(lineY, lineY + 0.12, abs(p.y) + (detail - 0.5) * 0.25);
          col = mix(col, vec3(0.60, 0.70, 0.82), frozen);
          cloud *= 1.0 - w * 0.6; spec *= 1.0 + w;
        } else if (uType < 1.5) {
          vec3 rot = mix(vec3(0.10, 0.02, 0.12), vec3(0.05, 0.09, 0.03), detail);
          col = mix(col, mix(rot, vec3(0.16, 0.12, 0.08), land), w);
          cloud *= 1.0 - w * 0.85;
        } else if (uType < 3.5) {
          float ridge = 1.0 - abs(fbm(p * 3.2 + so + 40.0) * 2.0 - 1.0);
          float crack = smoothstep(1.0 - w * 0.22, 1.0, ridge);
          col = mix(col, vec3(0.035, 0.03, 0.03), w * 0.92);
          emit += mix(vec3(1.2, 0.22, 0.03), vec3(1.6, 0.7, 0.15), crack) * crack * w * 0.7;
          cloud *= 1.0 - w * 0.4;
          col = mix(col, vec3(0.08, 0.07, 0.07), cloud * w);
          cloud *= 1.0 - w;
        } else {
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

        float g0 = dot(lit, vec3(0.3, 0.59, 0.11));
        lit = mix(lit, vec3(g0) * vec3(0.72, 0.85, 0.45), uPlague * 0.8);
        float fire = step(0.975, vnoise(p * 55.0 + floor(uTime * 4.0) * 3.7)) * land;
        emit += vec3(2.6, 0.7, 0.12) * fire * uWar;
        // 火落到地表之後往外擴散的燈火
        float town = smoothstep(0.55, 0.85, vnoise(p * 42.0 + so)) * smoothstep(0.42, 0.62, fbm(p * 7.0 + 5.0 + so));
        float polar = acos(clamp(vN.y, -1.0, 1.0));
        float lit2 = smoothstep(uSpark * 3.4, uSpark * 3.4 - 0.45, polar) * step(0.001, uSpark);
        emit += vec3(1.7, 1.1, 0.45) * town * land * lit2;
        lit = mix(lit, lit * 0.45, lit2 * 0.6);

        lit += emit;

        float cool = smoothstep(0.15, 0.85, uReveal);
        float lava = fbm(p * 4.0 + uTime * 0.05);
        vec3 molten = mix(vec3(0.85, 0.22, 0.03), vec3(1.25, 0.75, 0.25), smoothstep(0.4, 0.7, lava));
        lit = mix(molten, lit, cool);
        float g = dot(lit, vec3(0.3, 0.59, 0.11));
        lit = mix(lit, mix(vec3(g), lit, 0.75) * vec3(0.9, 1.0, 1.08), uCold);
        gl_FragColor = vec4(lit, smoothstep(0.0, 0.25, uReveal) * uFade);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(PLANET_R, 128, 96), m);
  scene.add(mesh);
  return mesh;
})();

const atmo = (() => {
  const m = new THREE.ShaderMaterial({
    ...ADD, side: THREE.BackSide,
    uniforms: { uReveal: { value: 0 }, uHot: { value: 1 }, uKill: { value: 0 } },
    vertexShader: `varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
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

/* ====================== 第一幕：一點炸開 → 許多星系 → 銀河系 → 太陽系 → 地球 ====================== */
// 世界座標：地球在原點。太陽放在星球著色用的光源方向上，行星的軌道面通過地球；
// 銀河系的一條旋臂通過這裡，銀心在遠處。各層的尺度不是等比例的。
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const gr = () => { let u = 0; for (let i = 0; i < 4; i++) u += Math.random(); return (u - 2) * 1.732; }; // 近似常態分布
const BANG = 0.07, ZOOM0 = 0.32, FLY0 = 0.62, FLY_END = 0.9; // 第一幕進度：炸開、開始放大進銀河系、開始飛進太陽系、抵達地球
const SUN_DIR = V3(0.55, 0.75, 0.6).normalize();
const SUN_POS = SUN_DIR.clone().multiplyScalar(40);
const DISK_N = V3(0, 1, 0).addScaledVector(SUN_DIR, -SUN_DIR.y).normalize();
const DISK_E1 = SUN_DIR.clone().negate(); // 太陽指向地球
const DISK_E2 = new THREE.Vector3().crossVectors(DISK_E1, DISK_N).normalize();
const RG = 360, R0 = RG * 0.5;
const GAL_N = V3(0.18, 0.95, 0.25).normalize();
const GAL_X = (() => { const v = V3(0.6, 0, 0.8); return v.addScaledVector(GAL_N, -v.dot(GAL_N)).normalize(); })(); // 銀心指向地球
const GAL_Z = new THREE.Vector3().crossVectors(GAL_X, GAL_N).normalize();
const GAL_C = GAL_X.clone().multiplyScalar(-R0);
const GAL_RB = RG * 0.2, GAL_KP = 0.24, GAL_PHI = -Math.log(R0 / GAL_RB) / GAL_KP; // 旋臂：對數螺線，其中一條剛好通過地球
// 鏡頭方向：看整個星系時、抵達太陽系外圍時
const DIR5 = GAL_N.clone().multiplyScalar(0.8).addScaledVector(GAL_X.clone().multiplyScalar(0.3).addScaledVector(GAL_Z, 0.95).normalize(), 0.6).normalize();
const diskPt = (x, y, z) => SUN_POS.clone().addScaledVector(DISK_E1, x).addScaledVector(DISK_N, y).addScaledVector(DISK_E2, z); // 以太陽為中心、軌道面上的座標
const FLY_P0 = diskPt(135, 6, -10), FLY_P1 = diskPt(45, 2, -13); // 從海王星外側飛進來，繞到地球受光的那一面
const DIR7 = FLY_P0.clone().sub(SUN_POS).normalize(), D7 = FLY_P0.distanceTo(SUN_POS);
const N4 = `
  float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x){
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
`;
const ROT2 = `mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }`;

/* ---------- 星系在宇宙裡的分布：沿著絲狀結構排列 ---------- */
const webNodes = (() => {
  const nodes = [];
  for (let i = 0; i < 90; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * PI * 2, r = 1500 + Math.pow(Math.random(), 0.6) * 3900, s = Math.sqrt(1 - u * u);
    const v = V3(s * Math.cos(th), u, s * Math.sin(th));
    if (v.dot(DIR5) > 0.72) { i--; continue; } // 不要擋在鏡頭的路線上
    nodes.push(v.multiplyScalar(r).add(GAL_C));
  }
  const edges = [];
  nodes.forEach((a, i) => {
    const near = nodes.map((b, j) => [a.distanceToSquared(b), j]).filter((e) => e[1] !== i).sort((x, y) => x[0] - y[0]);
    edges.push([i, near[0][1]], [i, near[1][1]]);
  });
  nodes.forEach((a, i) => { if (i % 6 === 0) edges.push([i, -1]); }); // 幾條接到我們這個星系
  return { nodes, edges };
})();
/* ---------- 炸出來的其他星系 ---------- */
const bgGal = (() => {
  const pts = [];
  for (const nd of webNodes.nodes) pts.push(nd.clone());
  for (let i = 0; i < (isMobile ? 1500 : 3600); i++) {
    const e = webNodes.edges[Math.floor(Math.random() * webNodes.edges.length)];
    const p = webNodes.nodes[e[0]].clone().lerp(e[1] < 0 ? GAL_C : webNodes.nodes[e[1]], 0.08 + Math.random() * 0.84);
    if (p.distanceTo(GAL_C) < 1300 || p.clone().sub(GAL_C).normalize().dot(DIR5) > 0.72) continue;
    pts.push(p.add(V3(gr() * 110, gr() * 110, gr() * 110)));
  }
  for (let i = 0; i < (isMobile ? 900 : 2200); i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * PI * 2, r = 3800 + Math.random() * 4200, s = Math.sqrt(1 - u * u);
    pts.push(V3(r * s * Math.cos(th), r * u, r * s * Math.sin(th)).add(GAL_C));
  }
  const n = pts.length, pos = new Float32Array(n * 3), seed = new Float32Array(n), size = new Float32Array(n), shape = new Float32Array(n * 2);
  pts.forEach((p, i) => { pos.set([p.x, p.y, p.z], i * 3); seed[i] = Math.random(); size[i] = 12 + Math.pow(Math.random(), 7) * 170; shape.set([Math.random() * PI * 2, 0.28 + Math.random() * 0.72], i * 2); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aShape', new THREE.BufferAttribute(shape, 2));
  const m = new THREE.ShaderMaterial({
    ...ADD,
    uniforms: { uAlpha: { value: 0 }, uIgnite: { value: 1 }, uGrow: { value: 1 }, uBang: { value: 0 }, uC: { value: GAL_C.clone() }, uH: { value: 1 }, uPx: { value: PX }, uTime: { value: 0 } },
    vertexShader: `attribute float aSeed, aSize; attribute vec2 aShape; uniform float uIgnite, uGrow, uBang, uH, uPx, uTime; uniform vec3 uC;
      varying float vLit, vGrow, vSeed, vSmall; varying vec2 vShape;
      void main(){
        vSeed = aSeed; vShape = aShape;
        vLit = smoothstep(aSeed * 0.92, aSeed * 0.92 + 0.05, uIgnite);
        vGrow = smoothstep(aSeed * 0.5, aSeed * 0.5 + 0.5, uGrow);
        vLit *= 1.0 + (1.0 - vGrow) * 0.35 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 60.0);
        float e = 1.0 - pow(1.0 - clamp(uBang * (0.75 + aSeed * 0.5), 0.0, 1.0), 3.0); // 從同一點飛出去，快的先到
        vec4 mv = modelViewMatrix * vec4(mix(uC, position, e), 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uH / -mv.z, 2.0 * uPx, 64.0 * uPx);
        vSmall = 1.0 - smoothstep(3.0 * uPx, 9.0 * uPx, gl_PointSize);
      }`,
    fragmentShader: `uniform float uAlpha; varying float vLit, vGrow, vSeed, vSmall; varying vec2 vShape;
      ${ROT2}
      void main(){
        vec2 q0 = (gl_PointCoord - 0.5) * 2.0;
        vec2 q = rot(vShape.x) * q0; q.y /= vShape.y;
        float r = length(q);
        float kind = vSeed < 0.15 ? 0.0 : vSeed < 0.45 ? 1.0 : 2.0; // 遠處偏紅的、黃色橢圓、藍白旋渦
        float core = exp(-r * r * (kind > 1.5 ? 34.0 : 14.0));
        float th = atan(q.y, q.x);
        float arms = 0.5 + 0.5 * cos(2.0 * th + 6.5 * log(r + 0.06));
        float disk = kind > 1.5 ? exp(-r * 3.4) * (0.2 + 1.0 * arms) * smoothstep(1.0, 0.6, r) : 0.0;
        vec3 warm = kind < 0.5 ? vec3(1.0, 0.5, 0.36) : vec3(1.0, 0.84, 0.6);
        vec3 col = warm * core * 0.5 + vec3(0.62, 0.76, 1.0) * disk * 0.55;
        // 很小的就只是一個光點
        float dot0 = smoothstep(1.0, 0.0, length(q0));
        col = mix(col, (kind > 1.5 ? vec3(0.8, 0.88, 1.0) : warm) * dot0 * dot0 * 0.5, vSmall);
        gl_FragColor = vec4(col * vLit * uAlpha * (0.45 + 0.55 * fract(vSeed * 7.31)), 1.0);
      }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false; p.renderOrder = -4; p.visible = false;
  scene.add(p);
  return p;
})();

/* ---------- 我們的星系（棒旋星系） ---------- */
const galaxyGrp = new THREE.Group();
galaxyGrp.position.copy(GAL_C);
galaxyGrp.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(GAL_X, GAL_N, GAL_Z));
scene.add(galaxyGrp);
const HOLE_C = SUN_POS.clone(); // 太陽系附近不放星系的粒子
const galaxy = (() => {
  const n = isMobile ? 45000 : 140000;
  const start = new Float32Array(n * 3), target = new Float32Array(n * 3);
  const seed = new Float32Array(n), size = new Float32Array(n), kind = new Float32Array(n);
  const clumps = Array.from({ length: 9 }, () => {
    const u = Math.random() * 2 - 1, th = Math.random() * PI * 2, r = RG * Math.sqrt(Math.random()) * 1.05, s = Math.sqrt(1 - u * u);
    return [r * s * Math.cos(th), r * u * 0.6, r * s * Math.sin(th), RG * (0.2 + Math.random() * 0.26)];
  });
  for (let i = 0; i < n; i++) {
    const c = clumps[i % clumps.length];
    start.set([c[0] + gr() * c[3], c[1] + gr() * c[3] * 0.7, c[2] + gr() * c[3]], i * 3);
    const k = Math.random(); let x, y, z, kd;
    if (k < 0.17) { // 核球與棒
      const bx = gr() * RG * 0.13, bz = gr() * RG * 0.045; y = gr() * RG * 0.034;
      x = bx * Math.cos(GAL_PHI) - bz * Math.sin(GAL_PHI); z = bx * Math.sin(GAL_PHI) + bz * Math.cos(GAL_PHI); kd = 0;
    } else if (k < 0.45) { // 盤面
      const r = Math.min(-Math.log(1 - Math.random() * 0.985) * RG * 0.24, RG * 1.08), th = Math.random() * PI * 2;
      x = r * Math.cos(th); z = r * Math.sin(th); y = gr() * RG * 0.012; kd = 1;
    } else { // 旋臂：兩條主臂、兩條次臂
      const arm = Math.random() < 0.7 ? (Math.random() < 0.5 ? 0 : 2) : (Math.random() < 0.5 ? 1 : 3);
      const r = GAL_RB + (RG - GAL_RB) * Math.pow(Math.random(), 0.85);
      const th = GAL_PHI + Math.log(r / GAL_RB) / GAL_KP + arm * PI / 2 + gr() * 0.13;
      const rr = r + gr() * RG * 0.015;
      x = rr * Math.cos(th); z = rr * Math.sin(th); y = gr() * RG * 0.009; kd = Math.random() < 0.07 ? 3 : 2;
    }
    target.set([x, y, z], i * 3);
    seed[i] = Math.random(); kind[i] = kd;
    size[i] = kd === 3 ? 2.2 + Math.random() * 1.6 : 0.6 + Math.pow(Math.random(), 3) * 2.2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(target, 3));
  g.setAttribute('aStart', new THREE.BufferAttribute(start, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  const m = new THREE.ShaderMaterial({
    ...ADD,
    uniforms: { uTime: { value: 0 }, uForm: { value: 0 }, uIgnite: { value: 0 }, uAlpha: { value: 0 }, uPx: { value: PX }, uHole: { value: HOLE_C.clone() }, uHoleR: { value: 110 } },
    vertexShader: `
      attribute vec3 aStart; attribute float aSeed, aSize, aKind;
      uniform float uTime, uForm, uIgnite, uPx, uHoleR; uniform vec3 uHole;
      varying float vSeed, vKind, vLit, vFade;
      ${ROT2}
      void main(){
        float f = clamp(uForm * 1.5 - aSeed * 0.5, 0.0, 1.0);
        f = f * f * (3.0 - 2.0 * f);
        vec3 p = mix(aStart, position, f);
        float r = length(position.xz);
        p.xz = rot((1.0 - f) * (1.5 + aSeed * 2.2) * (1.0 - 0.45 * r / ${RG.toFixed(1)})) * p.xz;
        p += (1.0 - f) * vec3(sin(uTime * 0.21 + aSeed * 40.0), cos(uTime * 0.17 + aSeed * 31.0), sin(uTime * 0.19 + aSeed * 53.0)) * 5.0;
        vSeed = aSeed; vKind = aKind;
        vLit = smoothstep(aSeed * 0.9, aSeed * 0.9 + 0.07, uIgnite);
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vFade = smoothstep(uHoleR, uHoleR * 2.4, distance(wp.xyz, uHole));
        vec4 mv = viewMatrix * wp;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uPx * (1500.0 / -mv.z), 1.0 * uPx, 5.0 * uPx) * mix(0.8, 1.0, vLit);
      }`,
    fragmentShader: `
      uniform float uAlpha, uTime; varying float vSeed, vKind, vLit, vFade;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        vec3 star = vKind < 0.5 ? vec3(1.0, 0.8, 0.52) : vKind < 1.5 ? vec3(1.0, 0.9, 0.78) : vKind < 2.5 ? vec3(0.6, 0.76, 1.0) : vec3(1.0, 0.42, 0.58);
        vec3 col = mix(vec3(0.2, 0.24, 0.55), star, vLit);
        float tw = 0.85 + 0.15 * sin(uTime * (0.8 + vSeed * 2.0) + vSeed * 90.0);
        gl_FragColor = vec4(col, a * a * uAlpha * vFade * mix(0.22, 0.62, vLit) * tw);
      }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false; p.renderOrder = -2; p.visible = false;
  galaxyGrp.add(p);
  return p;
})();
// 星系整體的柔光（遠看時用）
const galGlow = (() => {
  const m = new THREE.ShaderMaterial({
    ...ADD, side: THREE.DoubleSide, depthTest: false,
    uniforms: { uAlpha: { value: 0 } },
    vertexShader: `varying vec2 vQ; void main(){ vQ = vec2(position.x, -position.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uAlpha; varying vec2 vQ;
      ${N4}
      void main(){
        const float RG = ${RG.toFixed(1)}, RB = ${GAL_RB.toFixed(2)}, KP = ${GAL_KP.toFixed(3)}, PHI = ${GAL_PHI.toFixed(5)};
        float r = length(vQ), th = atan(vQ.y, vQ.x), rn = r / RG;
        float arms = 0.0;
        for (int i = 0; i < 4; i++){
          float d = th - (PHI + log(max(r, 1.0) / RB) / KP + float(i) * 1.5707963);
          d = atan(sin(d), cos(d));
          arms += exp(-d * d / 0.05) * (mod(float(i), 2.0) < 0.5 ? 1.0 : 0.45);
        }
        arms *= smoothstep(RB * 0.75, RB * 1.3, r);
        float blot = fbm(vec3(vQ * 0.022, 1.0)), lane = smoothstep(0.34, 0.6, fbm(vec3(vQ * 0.05, 4.0)));
        float disk = exp(-rn * 3.4);
        float bx = dot(vQ, vec2(cos(PHI), sin(PHI))), bz = dot(vQ, vec2(-sin(PHI), cos(PHI)));
        float bar = exp(-bx * bx / (2.0 * pow(RG * 0.13, 2.0)) - bz * bz / (2.0 * pow(RG * 0.045, 2.0)));
        float bulge = exp(-rn * rn * 80.0);
        vec3 col = vec3(0.5, 0.68, 1.0) * arms * disk * 2.0 * (0.45 + blot) * mix(0.5, 1.0, lane)
                 + vec3(1.0, 0.86, 0.68) * disk * 0.3 * mix(0.6, 1.0, lane)
                 + vec3(1.0, 0.8, 0.5) * (bar * 0.8 + bulge * 1.3);
        col *= smoothstep(1.15, 0.8, rn);
        gl_FragColor = vec4(col * uAlpha, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(RG * 2.4, RG * 2.4), m);
  mesh.rotation.x = -PI / 2;
  mesh.frustumCulled = false; mesh.renderOrder = -3; mesh.visible = false;
  galaxyGrp.add(mesh);
  return mesh;
})();

/* ---------- 旋臂裡的恆星與星雲 ---------- */
const localStars = (() => {
  const n = isMobile ? 3500 : 9000;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n), size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * PI * 2, r = 190 + Math.pow(Math.random(), 1.5) * 560, s = Math.sqrt(1 - u * u);
    pos.set([HOLE_C.x + r * s * Math.cos(th), HOLE_C.y + r * u, HOLE_C.z + r * s * Math.sin(th)], i * 3);
    seed[i] = Math.random(); size[i] = 0.7 + Math.pow(Math.random(), 4) * 3.2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({
    ...ADD,
    uniforms: { uAlpha: { value: 0 }, uPx: { value: PX }, uTime: { value: 0 } },
    vertexShader: `attribute float aSeed, aSize; uniform float uPx, uTime; varying float vS, vTw;
      void main(){ vS = aSeed; vTw = 0.7 + 0.3 * sin(uTime * (0.6 + aSeed * 1.6) + aSeed * 70.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(aSize * uPx * (240.0 / -mv.z), 1.0 * uPx, 6.5 * uPx); }`,
    fragmentShader: `uniform float uAlpha; varying float vS, vTw;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
        vec3 col = vS < 0.55 ? vec3(0.72, 0.84, 1.0) : vS < 0.85 ? vec3(1.0, 0.93, 0.8) : vec3(1.0, 0.66, 0.45);
        gl_FragColor = vec4(col, a * a * vTw * uAlpha); }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false; p.renderOrder = -2; p.visible = false;
  scene.add(p);
  return p;
})();
const nebulae = (() => {
  const lat1 = new THREE.Vector3().crossVectors(DIR7, V3(0, 1, 0)).normalize(), lat2 = new THREE.Vector3().crossVectors(DIR7, lat1).normalize();
  const pal = [[[1.0, 0.3, 0.5], [0.45, 0.2, 0.9]], [[0.2, 0.75, 0.85], [0.3, 0.35, 1.0]], [[1.0, 0.5, 0.25], [1.0, 0.25, 0.45]], [[0.5, 0.3, 1.0], [0.2, 0.6, 1.0]]];
  // d：沿著鏡頭抵達的路線離太陽多遠（負的在太陽後面當背景），a、lr：往旁邊偏的方向與距離，s：大小
  const defs = [
    { d: 880, a: 0.4, lr: 330, s: 340 }, { d: 700, a: 3.3, lr: 260, s: 280 }, { d: 540, a: 1.7, lr: 210, s: 230 }, { d: 420, a: 4.6, lr: 170, s: 190 },
    { d: 330, a: 0.2, lr: 150, s: 160 }, { d: 250, a: 2.6, lr: 135, s: 150 }, { d: 190, a: 5.4, lr: 120, s: 120 },
    { d: -260, a: 1.0, lr: 190, s: 330 }, { d: -420, a: 3.9, lr: 260, s: 420 }, { d: -330, a: 5.6, lr: 60, s: 280 },
  ];
  return defs.map((df, i) => {
    const c = pal[i % pal.length];
    const m = new THREE.ShaderMaterial({
      ...ADD, depthTest: false,
      uniforms: { uAlpha: { value: 0 }, uSeed: { value: Math.random() * 40 }, uA: { value: new THREE.Color(...c[0]) }, uB: { value: new THREE.Color(...c[1]) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uAlpha, uSeed; uniform vec3 uA, uB; varying vec2 vUv;
        ${N4}
        void main(){
          vec2 q = (vUv - 0.5) * 2.0; float r = length(q);
          float n = fbm(vec3(q * 1.7 + uSeed, uSeed * 3.0)), n2 = fbm(vec3(q * 4.2 + uSeed * 2.0, 1.0));
          float a = smoothstep(0.25, 0.95, n + (1.0 - r) * 0.55 - 0.2) * smoothstep(1.0, 0.25, r) * (0.3 + n2 * 1.1);
          gl_FragColor = vec4(mix(uA, uB, smoothstep(0.3, 0.65, n2)) * a * uAlpha, 1.0);
        }`,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    mesh.position.copy(SUN_POS).addScaledVector(DIR7, df.d).addScaledVector(lat1, Math.cos(df.a) * df.lr).addScaledVector(lat2, Math.sin(df.a) * df.lr);
    mesh.scale.setScalar(df.s);
    mesh.frustumCulled = false; mesh.renderOrder = -1; mesh.visible = false;
    scene.add(mesh);
    return mesh;
  });
})();

/* ---------- 太陽系：太陽、行星、軌道 ---------- */
const solarGrp = new THREE.Group();
solarGrp.position.copy(SUN_POS);
solarGrp.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(DISK_E1, DISK_N, DISK_E2));
scene.add(solarGrp);
const glowSprite = (pos, scale) => {
  const m = new THREE.ShaderMaterial({
    ...ADD, depthTest: false,
    uniforms: { uGlow: { value: 0 }, uLit: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uGlow, uLit; varying vec2 vUv;
      void main(){
        vec2 q = (vUv - 0.5) * 2.0; float r = length(q);
        float core = exp(-r * r * mix(1400.0, 700.0, uLit)), halo = exp(-r * mix(18.0, 11.0, uLit)) * 0.3;
        float spike = (exp(-abs(q.y) * 240.0) * exp(-abs(q.x) * 5.0) + exp(-abs(q.x) * 240.0) * exp(-abs(q.y) * 5.0)) * 0.4 * uLit;
        vec3 col = mix(vec3(1.0, 0.32, 0.1), vec3(1.0, 0.93, 0.78), uLit);
        gl_FragColor = vec4(col * (core * 1.6 + halo + spike * 0.6) * uGlow * smoothstep(1.0, 0.7, r), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
  mesh.position.copy(pos); mesh.scale.setScalar(scale);
  mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.visible = false;
  scene.add(mesh);
  return mesh;
};
const sun = glowSprite(SUN_POS, 120);
const spark = glowSprite(GAL_C, 420); // 爆炸前的那個點

const rockMat = (ca, cb, band = 0) => new THREE.ShaderMaterial({
  transparent: true,
  uniforms: { uA: { value: new THREE.Color(...ca) }, uB: { value: new THREE.Color(...cb) }, uAlpha: { value: 1 }, uHot: { value: 1 }, uSeed: { value: Math.random() * 50 }, uBand: { value: band }, uL: { value: SUN_DIR.clone() } },
  vertexShader: `varying vec3 vN; varying vec3 vP; varying vec3 vV; void main(){ vP = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `
    uniform vec3 uA, uB, uL; uniform float uAlpha, uHot, uSeed, uBand; varying vec3 vN; varying vec3 vP; varying vec3 vV;
    ${N4}
    void main(){
      vec3 p = normalize(vP);
      float n = fbm(p * 2.6 + uSeed), cr = fbm(p * 7.0 + uSeed * 1.7);
      float bands = 0.5 + 0.5 * sin(p.y * 13.0 + n * 4.0 + uSeed);
      vec3 col = mix(uB, uA, mix(smoothstep(0.35, 0.65, n), bands, uBand)) * mix(0.75 + 0.5 * cr, 1.0, uBand);
      float diff = max(dot(vN, normalize(uL)), 0.0);
      vec3 lit = col * (0.09 + diff * 1.05);
      float lava = fbm(p * 4.0 + uSeed * 2.0);
      vec3 molten = mix(vec3(0.9, 0.25, 0.04), vec3(1.35, 0.85, 0.3), smoothstep(0.4, 0.7, lava));
      gl_FragColor = vec4(mix(lit, molten, uHot), uAlpha);
    }`,
});
/* ---------- 其他七顆行星（大小與距離不是等比例） ---------- */
const planets = (() => {
  // r：軌道半徑、z：在軌道面上往旁邊偏多少（鏡頭沿著 z ≈ -11 飛進來，行星排在路線兩側）、s：半徑、band：氣態行星的條紋
  const defs = [
    { r: 12, z: -9, s: 1.0, a: [0.6, 0.57, 0.54], b: [0.34, 0.32, 0.3], band: 0 },                  // 水星
    { r: 22, z: 12, s: 1.7, a: [0.92, 0.78, 0.5], b: [0.7, 0.52, 0.3], band: 0.35 },                // 金星
    { r: 49, z: -8, s: 1.2, a: [0.8, 0.38, 0.2], b: [0.45, 0.18, 0.1], band: 0 },                   // 火星
    { r: 57, z: -27, s: 5.6, a: [0.9, 0.74, 0.55], b: [0.6, 0.38, 0.24], band: 1 },                 // 木星
    { r: 71, z: 3, s: 4.6, a: [0.92, 0.8, 0.56], b: [0.72, 0.58, 0.38], band: 1, ring: true },      // 土星
    { r: 79, z: -21, s: 3.0, a: [0.62, 0.86, 0.9], b: [0.5, 0.76, 0.82], band: 0.6 },               // 天王星
    { r: 85, z: -3, s: 2.9, a: [0.3, 0.46, 0.95], b: [0.2, 0.32, 0.75], band: 0.6 },                // 海王星
  ];
  return defs.map((d, i) => {
    const mat = rockMat(d.a, d.b, d.band);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(d.s, 48, 32), mat);
    mesh.position.set(Math.sqrt(d.r * d.r - d.z * d.z), 0, d.z);
    mesh.visible = false;
    solarGrp.add(mesh);
    solarGrp.updateMatrixWorld(true);
    mat.uniforms.uL.value.copy(SUN_POS).sub(mesh.getWorldPosition(V3(0, 0, 0))).normalize();
    let ringMat = null;
    if (d.ring) {
      ringMat = new THREE.ShaderMaterial({
        transparent: true, side: THREE.DoubleSide, depthWrite: false,
        uniforms: { uAlpha: { value: 0 }, uC: { value: new THREE.Color(...d.a) } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform float uAlpha; uniform vec3 uC; varying vec2 vUv;
          void main(){ float r = length(vUv - 0.5) * 2.0; if (r < 0.56 || r > 1.0) discard; float t = (r - 0.56) / 0.44;
            float bd = 0.55 + 0.45 * sin(t * 46.0) * sin(t * 13.0 + 1.0), gp = smoothstep(0.02, 0.05, abs(t - 0.58));
            gl_FragColor = vec4(uC * (0.5 + 0.5 * bd), bd * gp * 0.75 * uAlpha * smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.92, t)); }`,
      });
      const ring = new THREE.Mesh(new THREE.PlaneGeometry(d.s * 4.6, d.s * 4.6), ringMat);
      ring.rotation.x = -PI / 2 + 0.42;
      mesh.add(ring);
    }
    mat.uniforms.uHot.value = 0;
    return { mesh, mat, ringMat };
  });
})();
const orbits = (() => { // 每顆行星的軌道
  const seg = [];
  for (const r of [12, 22, 40, 49, 57, 71, 79, 85]) for (let i = 0; i < 240; i++) {
    const a0 = (i / 240) * PI * 2, a1 = ((i + 1) / 240) * PI * 2;
    seg.push(r * Math.cos(a0), 0, r * Math.sin(a0), r * Math.cos(a1), 0, r * Math.sin(a1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(1.0, 0.9, 0.72), ...ADD, opacity: 0 }));
  l.frustumCulled = false; l.visible = false;
  solarGrp.add(l);
  return l;
})();
const MOON_POS = [V3(3.3, 1.5, -2.2), V3(1.5, 2.7, -2.2)]; // 月球的位置：[桌機, 直式手機]
const moon = (() => { const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.44, 48, 32), rockMat([0.62, 0.61, 0.6], [0.3, 0.3, 0.31])); mesh.visible = false; scene.add(mesh); return mesh; })();
/* ---------- 第一幕的鏡頭 ---------- */
const c1T = V3(0, 0, 0), c1D = V3(0, 0, 0);
function act1Cam(a, narrow) {
  const D4 = narrow ? 4200 : 2600, D5 = narrow ? 1900 : 1050;
  if (a < ZOOM0) { // 看著那個點炸開，星系往四面飛散，慢慢靠近我們這一個
    c1D.copy(DIR5).applyAxisAngle(GAL_N, (a - ZOOM0) * 1.2);
    camera.position.copy(GAL_C).addScaledVector(c1D, Math.exp(lerp(Math.log(D4), Math.log(D5), sstep(BANG, ZOOM0, a))));
    lookAt.copy(GAL_C);
  } else if (a < FLY0) { // 一路放大：整個盤面 → 旋臂 → 太陽系外圍
    const u = (a - ZOOM0) / (FLY0 - ZOOM0), ue = lerp(u, sstep(0, 1, u), 0.6);
    c1T.copy(GAL_C).lerp(SUN_POS, sstep(0.0, 0.5, u));
    c1D.copy(DIR5).lerp(DIR7, sstep(0.05, 0.95, u)).normalize();
    camera.position.copy(c1T).addScaledVector(c1D, Math.exp(lerp(Math.log(D5), Math.log(D7), ue)));
    lookAt.copy(c1T);
  } else { // 從外側經過其他行星，繞到地球前面。camera.position 這時是關鍵格算出來的終點
    const u = (a - FLY0) / (FLY_END - FLY0), w = lerp(u, sstep(0, 1, u), 0.5), k = 1 - w;
    camera.position.multiplyScalar(w * w).addScaledVector(FLY_P1, 2 * k * w).addScaledVector(FLY_P0, k * k);
    lookAt.copy(SUN_POS).multiplyScalar(1 - sstep(0.2, 0.7, w));
  }
  camera.lookAt(lookAt);
}

/* ---------- 全息線條：用來畫化石、塔、樹、隔離罩 ---------- */
// 每條線有出現順序 aT，uDraw 由 0 到 1 把線一條條畫出來；uBreak 讓整個東西碎開、變紅、往下掉
const holoLineMat = (color) => new THREE.ShaderMaterial({
  ...ADD, depthTest: false,
  uniforms: { uDraw: { value: 0 }, uBreak: { value: 0 }, uAlpha: { value: 1 }, uColor: { value: color.clone() } },
  vertexShader: `
    attribute float aT; attribute vec3 aRand; uniform float uBreak; varying float vT;
    void main(){
      vT = aT;
      vec3 p = position;
      float b = uBreak * uBreak;
      p += aRand * b * 2.4;
      p.y -= b * b * 2.0 * (0.4 + aRand.z * 0.5 + 0.5);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: `
    uniform float uDraw, uBreak, uAlpha; uniform vec3 uColor; varying float vT;
    void main(){
      if (vT >= uDraw) discard;
      float head = smoothstep(uDraw - 0.05, uDraw, vT) * step(uDraw, 0.999);
      vec3 c = mix(uColor, vec3(1.0, 0.28, 0.16), smoothstep(0.0, 0.35, uBreak));
      c += head * 0.9;
      gl_FragColor = vec4(c, uAlpha * (1.0 - smoothstep(0.35, 1.0, uBreak)));
    }`,
});
class Ink {
  constructor() { this.p = []; }
  seg(ax, ay, bx, by, az = 0, bz = 0) { this.p.push(ax, ay, az, bx, by, bz); return this; }
  poly(pts, closed = false) {
    for (let i = 0; i < pts.length - 1; i++) this.seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (closed) this.seg(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]);
    return this;
  }
  arc(cx, cy, rx, ry, a0, a1, n = 24) {
    const pts = [];
    for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
    return this.poly(pts);
  }
  zig(ax, ay, bx, by, n, amp) { // 牙齒
    const pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n; pts.push([lerp(ax, bx, t), lerp(ay, by, t) + (i % 2 ? amp : 0)]); }
    return this.poly(pts);
  }
  // 沿著脊椎每隔一段畫一節：up、down 是往上、往下的骨頭長度（依位置 0~1 變化）
  spine(pts, step, up, down, lean = 0) {
    this.poly(pts);
    let acc = 0, next = step * 0.5, total = 0;
    for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], len = Math.hypot(bx - ax, by - ay);
      const nx = -(by - ay) / len, ny = (bx - ax) / len, tx = (bx - ax) / len, ty = (by - ay) / len;
      while (next <= acc + len) {
        const f = (next - acc) / len, x = lerp(ax, bx, f), y = lerp(ay, by, f), t = next / total;
        const u = up ? up(t) : 0, d = down ? down(t) : 0;
        const sgn = ny >= 0 ? 1 : -1; // 讓「上」永遠朝畫面上方
        if (u > 0) this.seg(x, y, x + (nx * sgn + tx * lean) * u, y + (ny * sgn + ty * lean) * u);
        if (d > 0) this.seg(x, y, x - (nx * sgn - tx * lean) * d, y - (ny * sgn - ty * lean) * d);
        next += step;
      }
      acc += len;
    }
    return this;
  }
  build(mat) {
    const n = this.p.length / 6;
    const aT = new Float32Array(n * 2), aRand = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      aT[i * 2] = aT[i * 2 + 1] = i / n;
      const rx = rand() - 0.5, ry = rand() - 0.5, rz = rand() - 0.5;
      aRand.set([rx, ry, rz, rx, ry, rz], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
    g.setAttribute('aRand', new THREE.BufferAttribute(aRand, 3));
    const l = new THREE.LineSegments(g, mat);
    l.frustumCulled = false; l.renderOrder = 8;
    return l;
  }
}

/* ---------- 五輪的代表生物：畫成化石標本 ---------- */
const fossils = (() => {
  const list = [];
  const add = (ink) => { const mat = holoLineMat(COLD); const l = ink.build(mat); l.visible = false; list.push({ l, mat }); };

  // 一：三葉蟲（奧陶紀），俯視
  { const k = new Ink();
    k.arc(0, 0.9, 1.15, 0.8, 0, PI, 30).seg(-1.15, 0.9, 1.15, 0.9);
    k.poly([[-1.15, 0.9], [-1.3, 0.35], [-1.22, -0.1]]).poly([[1.15, 0.9], [1.3, 0.35], [1.22, -0.1]]);
    k.arc(0, 1.2, 0.34, 0.42, 0, PI * 2, 20).arc(-0.68, 1.12, 0.17, 0.1, 0, PI * 2, 12).arc(0.68, 1.12, 0.17, 0.1, 0, PI * 2, 12);
    const side = [[], []];
    for (let i = 0; i <= 11; i++) {
      const y = 0.9 - i * 0.185, w = 1.08 - 0.0045 * i * i, ax = 0.36 - i * 0.012;
      if (i < 11) k.poly([[-w, y - 0.1], [-ax, y - 0.02], [ax, y - 0.02], [w, y - 0.1]]);
      side[0].push([-w, y - (i ? 0.1 : 0)]); side[1].push([w, y - (i ? 0.1 : 0)]);
    }
    k.poly(side[0]).poly(side[1]);
    k.poly([[-0.36, 0.9], [-0.22, -1.2], [-0.1, -1.75]]).poly([[0.36, 0.9], [0.22, -1.2], [0.1, -1.75]]);
    k.arc(0, -1.13, 0.55, 0.75, PI, PI * 2, 20);
    for (let i = 1; i <= 4; i++) { const a = PI + (i / 5) * PI; k.seg(Math.cos(a) * 0.12, -1.2, Math.cos(a) * 0.55, -1.13 + Math.sin(a) * 0.75); }
    add(k); }

  // 二：鄧氏魚（泥盆紀），側面朝左
  { const k = new Ink();
    k.poly([[-2.3, 0.0], [-2.1, 0.6], [-1.35, 1.0], [-0.5, 0.95], [-0.35, 0.05], [-0.6, -0.75], [-1.45, -0.85], [-2.1, -0.5]], true);
    k.seg(-2.3, 0.0, -1.45, -0.08).zig(-2.28, 0.04, -1.7, -0.02, 6, -0.2).zig(-2.2, -0.22, -1.7, -0.12, 4, 0.14);
    k.arc(-1.6, 0.48, 0.17, 0.17, 0, PI * 2, 16).arc(-1.6, 0.48, 0.07, 0.07, 0, PI * 2, 8);
    k.poly([[-1.35, 1.0], [-1.2, 0.12], [-0.35, 0.05]]).seg(-2.1, 0.6, -1.2, 0.12).seg(-0.9, 0.97, -0.85, -0.8).seg(-1.2, 0.12, -1.45, -0.85);
    const sp = []; for (let i = 0; i <= 16; i++) { const t = i / 16; sp.push([lerp(-0.35, 2.15, t), 0.3 + 0.12 * t + Math.sin(t * PI) * 0.06]); }
    k.spine(sp, 0.125, (t) => 0.42 * (1 - t * 0.75), (t) => t < 0.55 ? 0.62 * (1 - t * 1.3) : 0.2 * (1 - t), 0.35);
    k.poly([[1.75, 0.45], [2.55, 1.25], [2.2, 0.5], [2.45, -0.15], [1.75, 0.4]]);
    k.seg(1.9, 0.5, 2.4, 1.0).seg(1.95, 0.46, 2.3, 0.1);
    k.poly([[0.15, 0.72], [0.55, 1.25], [0.95, 0.74]]).seg(0.4, 0.75, 0.57, 1.15).seg(0.65, 0.75, 0.62, 1.12);
    k.poly([[-0.3, -0.45], [0.25, -1.05], [0.35, -0.5]]).poly([[0.9, -0.2], [1.25, -0.6], [1.35, -0.12]]);
    k.poly([[-0.5, 0.95], [0.6, 0.86], [1.75, 0.5]]).poly([[-0.6, -0.75], [0.7, -0.42], [1.75, 0.38]]);
    add(k); }

  // 三：麗齒獸（二疊紀），側面朝左
  { const k = new Ink();
    k.poly([[-2.5, 0.72], [-2.42, 1.0], [-1.85, 1.2], [-1.4, 1.1], [-1.35, 0.7], [-1.8, 0.58]], true);
    k.poly([[-2.45, 0.6], [-1.9, 0.42], [-1.4, 0.55], [-1.35, 0.7]]);
    k.poly([[-2.32, 0.72], [-2.26, 0.18], [-2.18, 0.72]]).zig(-2.15, 0.7, -1.7, 0.62, 6, -0.13).zig(-2.3, 0.55, -1.8, 0.45, 5, 0.1);
    k.arc(-1.72, 0.95, 0.11, 0.11, 0, PI * 2, 12).arc(-1.5, 0.9, 0.07, 0.1, 0, PI * 2, 10);
    const sp = [[-1.38, 0.95], [-1.1, 1.08], [-0.6, 1.15], [0.2, 1.12], [0.95, 1.02], [1.5, 0.8], [2.1, 0.5], [2.6, 0.3]];
    k.spine(sp, 0.13, (t) => 0.2 * (1 - t * 0.6), (t) => (t > 0.12 && t < 0.52) ? 0.78 * Math.sin((t - 0.12) / 0.4 * PI) + 0.25 : 0, -0.25);
    k.poly([[-0.95, 1.05], [-0.8, 0.55], [-1.0, 0.35]]);
    k.poly([[-0.95, 0.6], [-1.12, -0.05], [-0.9, -0.72], [-1.25, -0.8]]).poly([[-0.8, 0.55], [-0.62, -0.1], [-0.72, -0.72], [-1.02, -0.8]]);
    k.arc(0.95, 0.85, 0.3, 0.2, 0, PI * 2, 14);
    k.poly([[0.95, 0.8], [0.72, 0.05], [1.0, -0.7], [0.68, -0.8]]).poly([[1.05, 0.78], [1.25, 0.0], [1.22, -0.72], [0.95, -0.8]]);
    add(k); }

  // 四：菊石（三疊紀）
  { const k = new Ink();
    const R = (th) => 0.115 * Math.exp(0.152 * th);
    const outer = []; for (let i = 0; i <= 220; i++) { const th = (i / 220) * PI * 6; outer.push([Math.cos(th) * R(th), Math.sin(th) * R(th)]); }
    k.poly(outer);
    for (let th = PI * 2; th <= PI * 6; th += 0.115) k.seg(Math.cos(th) * R(th - PI * 2), Math.sin(th) * R(th - PI * 2), Math.cos(th) * R(th), Math.sin(th) * R(th));
    add(k); }

  // 五：暴龍（白堊紀），側面朝左
  { const k = new Ink();
    k.poly([[-2.75, 1.58], [-2.68, 2.0], [-2.1, 2.22], [-1.62, 2.1], [-1.52, 1.68], [-1.95, 1.5], [-2.4, 1.46]], true);
    k.poly([[-2.7, 1.38], [-2.05, 1.2], [-1.55, 1.36], [-1.52, 1.68]]);
    k.zig(-2.72, 1.56, -1.95, 1.5, 10, -0.16).zig(-2.66, 1.4, -2.05, 1.26, 8, 0.12);
    k.arc(-1.85, 1.92, 0.11, 0.11, 0, PI * 2, 12).arc(-2.18, 1.8, 0.15, 0.13, 0, PI * 2, 12).arc(-2.56, 1.82, 0.05, 0.05, 0, PI * 2, 8).arc(-1.68, 1.75, 0.08, 0.12, 0, PI * 2, 10);
    const sp = [[-1.55, 1.9], [-1.3, 1.7], [-1.1, 1.5], [-0.8, 1.45], [-0.2, 1.52], [0.45, 1.5], [1.0, 1.42], [1.7, 1.3], [2.5, 1.18], [3.2, 1.1]];
    k.spine(sp, 0.14, (t) => 0.2 * (1 - t * 0.55), (t) => (t > 0.16 && t < 0.42) ? 0.85 * Math.sin((t - 0.16) / 0.26 * PI) + 0.2 : (t > 0.55 ? 0.22 * (1 - t) * 1.6 : 0), -0.3);
    k.poly([[-0.85, 1.42], [-0.55, 0.95], [-0.6, 0.8]]);
    k.poly([[-0.75, 1.15], [-0.9, 0.9], [-1.15, 0.82]]).seg(-1.15, 0.82, -1.28, 0.72).seg(-1.15, 0.82, -1.22, 0.9);
    k.arc(0.45, 1.38, 0.42, 0.2, 0, PI, 12).poly([[0.4, 1.3], [0.12, 0.5], [-0.12, 0.45]]).poly([[0.5, 1.3], [0.9, 0.75]]);
    k.poly([[0.42, 1.25], [0.02, 0.45], [0.42, -0.38], [0.2, -0.76], [-0.2, -0.82]]).seg(0.2, -0.76, -0.05, -0.72).seg(0.42, -0.38, 0.55, -0.6);
    k.poly([[0.52, 1.22], [0.82, 0.5], [0.62, -0.32], [0.95, -0.76], [0.6, -0.82]]).seg(0.95, -0.76, 0.75, -0.7);
    add(k); }

  const grp = new THREE.Group();
  list.forEach((f) => grp.add(f.l));
  scene.add(grp);
  return { grp, list };
})();

/* ---------- 演化樹：每一輪往上長，銷毀時大部分的枝被剪掉 ---------- */
const LOSS = [0.85, 0.75, 0.9, 0.8, 0.75];
const evo = (() => {
  const pos = [], aRound = [], aT = [], aAlive = [], aHuman = [];
  const STEPS = 9, BAND = 1.0, Y0 = -3;
  let survivors = [{ x: 0 }];
  let humanTip = null;
  for (let r = 0; r < 6; r++) {
    let tips = survivors.map((s) => ({ x: s.x, parent: null, segs: [] }));
    const nodes = [];
    for (let s = 0; s < STEPS; s++) {
      const y = Y0 + r * BAND + (s / STEPS) * BAND, y2 = y + BAND / STEPS, next = [];
      for (const tip of tips) {
        const kids = (tips.length + next.length < 52 && rand() < 0.4) ? 2 : 1;
        for (let c = 0; c < kids; c++) {
          let nx = tip.x + (rand() - 0.5) * 0.34 + (kids === 2 ? (c ? 0.2 : -0.2) : 0);
          nx = Math.max(-1.75, Math.min(1.75, nx));
          const node = { x: nx, y: y2, parent: tip, seg: { ax: tip.x, ay: y, bx: nx, by: y2, t: s / STEPS, alive: 0, human: 0 } };
          nodes.push(node); next.push(node);
        }
      }
      tips = next;
    }
    // 選出活下來的枝，往回標記它們的祖先
    let keep;
    if (r < 5) {
      const nKeep = Math.max(1, Math.round(tips.length * (1 - LOSS[r])));
      const order = tips.map((t, i) => i).sort(() => rand() - 0.5).slice(0, nKeep);
      keep = order.map((i) => tips[i]);
    } else keep = tips;
    for (const k of keep) { let n = k; while (n && n.seg) { n.seg.alive = 1; n = n.parent; } }
    if (r === 5) {
      humanTip = tips.reduce((best, t) => Math.abs(t.x - 0.45) < Math.abs(best.x - 0.45) ? t : best, tips[0]);
      let n = humanTip; while (n && n.seg) { n.seg.human = 1; n = n.parent; }
    }
    for (const n of nodes) {
      const s = n.seg;
      pos.push(s.ax, s.ay, 0, s.bx, s.by, 0);
      aRound.push(r, r); aT.push(s.t, s.t + 1 / STEPS); aAlive.push(s.alive, s.alive); aHuman.push(s.human, s.human);
    }
    survivors = keep.map((k) => ({ x: k.x }));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRound', new THREE.Float32BufferAttribute(aRound, 1));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
  g.setAttribute('aAlive', new THREE.Float32BufferAttribute(aAlive, 1));
  g.setAttribute('aHuman', new THREE.Float32BufferAttribute(aHuman, 1));
  const mat = new THREE.ShaderMaterial({
    ...ADD, depthTest: false,
    uniforms: { uGrow: { value: 0 }, uKillT: { value: 0 }, uAlpha: { value: 0 } },
    vertexShader: `
      attribute float aRound, aT, aAlive, aHuman; varying float vG, vR, vAlive, vHuman;
      void main(){ vG = aRound + aT; vR = aRound; vAlive = aAlive; vHuman = aHuman; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uGrow, uKillT, uAlpha; varying float vG, vR, vAlive, vHuman;
      void main(){
        if (vG > uGrow) discard;
        float k = clamp(uKillT - vR, 0.0, 1.0);
        vec3 c = vec3(0.45, 0.92, 1.0);
        float a = 0.95;
        if (vAlive < 0.5) {
          float flash = sin(k * 3.14159);
          c = mix(c, vec3(1.0, 0.25, 0.14), smoothstep(0.0, 0.25, k));
          c = c * mix(1.0, 0.2, smoothstep(0.55, 1.0, k)) + vec3(1.0, 0.3, 0.18) * flash * 0.9;
        }
        if (vHuman > 0.5) c = mix(c, vec3(1.3, 1.05, 0.65), smoothstep(5.0, 5.4, uGrow));
        c += smoothstep(uGrow - 0.06, uGrow, vG) * 0.6;
        gl_FragColor = vec4(c, a * uAlpha);
      }`,
  });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false; lines.renderOrder = 8;
  // 每次銷毀的那條切線
  const cuts = [];
  for (let r = 0; r < 5; r++) {
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute([-1.9, Y0 + (r + 1) * BAND, 0, 1.9, Y0 + (r + 1) * BAND, 0], 3));
    const cm = new THREE.LineBasicMaterial({ color: KILL, ...ADD, depthTest: false, opacity: 0 });
    const cl = new THREE.Line(cg, cm); cl.frustumCulled = false; cl.renderOrder = 9;
    cuts.push(cm);
    lines.add(cl);
  }
  const grp = new THREE.Group();
  grp.add(lines);
  scene.add(grp);
  return { grp, mat, cuts, humanLocal: new THREE.Vector3(humanTip.x, humanTip.y, 0) };
})();

/* ---------- DNA：每一輪開始時沿著光束投放 ---------- */
const helix = (() => {
  const seg = [], H = 2.6, TURNS = 3.2, RAD = 0.3, N = 90;
  const at2 = (i, ph) => { const t = i / N, a = t * TURNS * PI * 2 + ph; return [Math.cos(a) * RAD, (t - 0.5) * H, Math.sin(a) * RAD]; };
  for (let i = 0; i < N; i++) for (const ph of [0, PI]) { const a = at2(i, ph), b = at2(i + 1, ph); seg.push(...a, ...b); }
  for (let i = 0; i <= N; i += 4) seg.push(...at2(i, 0), ...at2(i, PI));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  const m = new THREE.LineBasicMaterial({ color: new THREE.Color(0.7, 1.0, 1.0), ...ADD, depthTest: false, opacity: 0 });
  const l = new THREE.LineSegments(g, m);
  l.frustumCulled = false; l.renderOrder = 7;
  scene.add(l);
  return l;
})();

/* ---------- 全息環 ---------- */
const holoMat = new THREE.LineBasicMaterial({ color: COLD.clone(), ...ADD, opacity: 0 });
const holoDim = new THREE.LineBasicMaterial({ color: COLD.clone(), ...ADD, opacity: 0 });
const circlePts = (r, n = 180, a0 = 0, a1 = PI * 2) => {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
  return pts;
};
const holo = new THREE.Group();
const holoRings = [];
(() => {
  const mk = (r, tiltX, tiltZ, speed, a0 = 0, a1 = PI * 2, mat = holoMat) => {
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
  mk(3.9, -0.35, 0.6, 0.12, 0, PI * 1.5);
  mk(2.7, PI / 2, 0, 0.3, 0, PI * 2, holoDim);
  mk(4.6, 0.12, -0.1, -0.06, 0, PI * 2, holoDim);
  const seg = [];
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * PI * 2, r0 = 4.6, r1 = 4.6 + (i % 10 === 0 ? 0.32 : i % 5 === 0 ? 0.2 : 0.1);
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
const pushChamber = (seg, cx, cz, detail) => {
  const ribs = detail ? 36 : 8, hoopN = detail ? 96 : 20;
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * PI * 2;
    seg.push(cx + Math.cos(a) * CH_R, CH_Y0, cz + Math.sin(a) * CH_R, cx + Math.cos(a) * CH_R, CH_Y1, cz + Math.sin(a) * CH_R);
  }
  const hoop = (r, y) => {
    for (let i = 0; i < hoopN; i++) {
      const a0 = (i / hoopN) * PI * 2, a1 = ((i + 1) / hoopN) * PI * 2;
      seg.push(cx + Math.cos(a0) * r, y, cz + Math.sin(a0) * r, cx + Math.cos(a1) * r, y, cz + Math.sin(a1) * r);
    }
  };
  if (detail) {
    for (let y = CH_Y0; y <= CH_Y1; y += 4.25) hoop(CH_R, y);
    for (const y of [CH_Y0, CH_Y1]) {
      for (const r of [4, 9, 15, 22]) hoop(r, y);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * PI * 2;
        seg.push(cx + Math.cos(a) * 4, y, cz + Math.sin(a) * 4, cx + Math.cos(a) * CH_R, y, cz + Math.sin(a) * CH_R);
      }
    }
  } else { hoop(CH_R, CH_Y0); hoop(CH_R, 3); hoop(CH_R, CH_Y1); }
};
const lineMat = (r, g, b) => new THREE.LineBasicMaterial({ color: new THREE.Color(r, g, b), ...ADD, opacity: 0 });
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

/* ---------- 其他實驗場：排到看不見盡頭 ---------- */
const others = (() => {
  const liveMat = lineMat(0.2, 0.55, 0.66), deadMat = lineMat(0.16, 0.2, 0.24), beamMat = lineMat(0.5, 0.95, 1.0);
  const liveSeg = [], deadSeg = [], beamSeg = [], pos = [], col = [];
  const palette = [[1.0, 0.35, 0.2], [0.3, 0.6, 1.0], [0.95, 0.95, 1.0], [1.0, 0.7, 0.3], [0.4, 1.0, 0.7], [0.8, 0.5, 1.0]];
  const SP = 86, NX = isMobile ? 9 : 14, NZ = isMobile ? 9 : 14;
  for (let i = -NX; i <= NX; i++) for (let j = -NZ; j <= NZ; j++) {
    if (i === 0 && j === 0) continue;
    const cx = i * SP, cz = j * SP;
    if (rand() < 0.3) { pushChamber(deadSeg, cx, cz, false); continue; }
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
    ...ADD, vertexColors: true,
    uniforms: { uAlpha: { value: 0 }, uPx: { value: PX } },
    vertexShader: `uniform float uPx; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uPx * clamp(2600.0 / -mv.z, 2.0, 60.0); }`,
    fragmentShader: `uniform float uAlpha; varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.08, d); gl_FragColor = vec4(vC * (0.6 + a), a * uAlpha); }`,
  });
  const dots = new THREE.Points(g, dotMat);
  dots.frustumCulled = false;
  scene.add(dots);
  return { liveMat, deadMat, beamMat, dotMat };
})();

/* ---------- 光束的來源（儀器） ---------- */
const emitterMat = new THREE.MeshBasicMaterial({ color: COLD, ...ADD, opacity: 0 });
const emitterBody = new THREE.MeshBasicMaterial({ color: 0x06141a, transparent: true, opacity: 0 });
const emitterEdge = new THREE.LineBasicMaterial({ color: COLD, ...ADD, opacity: 0 });
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
    ring.rotation.x = PI / 2;
    ring.position.y = y;
    grp.add(ring);
    rings.push(ring);
  }
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.55, 48), emitterMat);
  lens.rotation.x = PI / 2;
  lens.position.y = 0.05;
  grp.add(lens);
  const seg = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    seg.push(Math.cos(a) * 2.6, 3.3, Math.sin(a) * 2.6, Math.cos(a) * 9, CH_Y1 - BEAM_TOP, Math.sin(a) * 9);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  grp.add(new THREE.LineSegments(sg, emitterEdge));
  scene.add(grp);
  return { grp, rings };
})();

/* ---------- 隕石 ---------- */
const meteor = (() => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const m = new THREE.LineBasicMaterial({ color: new THREE.Color(3, 2.2, 1.4), ...ADD, opacity: 0 });
  const l = new THREE.Line(g, m);
  l.frustumCulled = false;
  scene.add(l);
  return l;
})();

/* ---------- 祈禱：往上升、到不了 ---------- */
const prayers = (() => {
  const n = isMobile ? 1800 : 4500;
  const dir = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 1.6 - 0.6, th = Math.random() * PI * 2, s = Math.sqrt(Math.max(0, 1 - u * u));
    dir.set([s * Math.cos(th), u, s * Math.sin(th)], i * 3);
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(dir, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    ...ADD,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uPx: { value: PX } },
    vertexShader: `
      attribute float aSeed; uniform float uTime, uPx; varying float vA;
      void main(){
        float f = fract(uTime * (0.035 + aSeed * 0.03) + aSeed * 7.0);
        vec3 p = position * ${PLANET_R.toFixed(2)};
        p.y += f * 6.5;
        p.xz *= 1.0 - f * 0.78;
        p.xz += vec2(sin(uTime * 0.7 + aSeed * 30.0), cos(uTime * 0.6 + aSeed * 20.0)) * 0.08;
        vA = sin(3.14159 * f) * (1.0 - smoothstep(0.55, 0.92, f));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * (1.0 + aSeed * 1.6) * (15.0 / -mv.z);
      }`,
    fragmentShader: `uniform float uAlpha; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(1.0, 0.82, 0.5), a * a * vA * uAlpha); }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  scene.add(p);
  return p;
})();

/* ---------- 壓制一：巴別塔（沿著光束往上蓋） ---------- */
const babel = (() => {
  const k = new Ink(), LV = 34, SIDES = 10, Y0 = 1.55, DY = 0.215;
  const rad = (i) => 1.15 - i * 0.027;
  const pt = (i, s) => { const a = (s / SIDES) * PI * 2 + i * 0.16; return [Math.cos(a) * rad(i), Y0 + i * DY, Math.sin(a) * rad(i)]; };
  for (let i = 0; i < LV; i++) {
    for (let s = 0; s < SIDES; s++) {
      const a = pt(i, s), b = pt(i, s + 1), c = pt(i + 1, s);
      k.seg(a[0], a[1], b[0], b[1], a[2], b[2]);
      k.seg(a[0], a[1], c[0], c[1], a[2], c[2]);
      if ((s + i) % 3 === 0) { const d = pt(i + 1, s + 1); k.seg(a[0], a[1], d[0], d[1], a[2], d[2]); }
    }
  }
  const mat = holoLineMat(new THREE.Color(1.0, 0.8, 0.5));
  const l = k.build(mat);
  l.visible = false;
  scene.add(l);
  return { l, mat, top: Y0 + LV * DY };
})();

/* ---------- 壓制二：知識樹與隔離罩 ---------- */
const eden = (() => {
  const k = new Ink(), fruits = [];
  const branch = (x, y, ang, len, depth) => {
    const bx = x + Math.cos(ang) * len, by = y + Math.sin(ang) * len;
    k.seg(x, y, bx, by);
    if (depth === 0) { if (rand() < 0.3) fruits.push(bx, by - 0.06, 0); return; }
    branch(bx, by, ang + 0.42 + (rand() - 0.5) * 0.25, len * 0.74, depth - 1);
    branch(bx, by, ang - 0.4 + (rand() - 0.5) * 0.25, len * 0.74, depth - 1);
    if (depth > 3 && rand() < 0.5) branch(bx, by, ang + (rand() - 0.5) * 0.3, len * 0.6, depth - 2);
  };
  // 由樹幹往上長：先收集再照高度排序，畫出來才像在生長
  branch(0, -2.2, PI / 2, 1.15, 7);
  const segs = [];
  for (let i = 0; i < k.p.length; i += 6) segs.push(k.p.slice(i, i + 6));
  segs.sort((a, b) => Math.min(a[1], a[4]) - Math.min(b[1], b[4]));
  k.p = segs.flat();
  const treeMat = holoLineMat(COLD);
  const tree = k.build(treeMat);
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(fruits, 3));
  const fruitMat = new THREE.ShaderMaterial({
    ...ADD, depthTest: false,
    uniforms: { uAlpha: { value: 0 }, uPx: { value: PX }, uHot: { value: 0 }, uSize: { value: 1 } },
    vertexShader: `uniform float uPx, uSize; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uPx * uSize * (34.0 / -mv.z); }`,
    fragmentShader: `uniform float uAlpha, uHot; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(mix(vec3(1.0, 0.78, 0.4), vec3(1.5, 1.3, 0.9), uHot) * (0.5 + a * 0.6), a * uAlpha * 0.8); }`,
  });
  const fruit = new THREE.Points(fg, fruitMat);
  fruit.frustumCulled = false; fruit.renderOrder = 9;
  // 隔離罩：二十面體線框
  const cageInk = new Ink();
  const eg = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(2.9, 1)).attributes.position.array;
  for (let i = 0; i < eg.length; i += 6) cageInk.seg(eg[i], eg[i + 1] + 0.35, eg[i + 3], eg[i + 4] + 0.35, eg[i + 2], eg[i + 5]);
  const cageMat = holoLineMat(KILL);
  const cage = cageInk.build(cageMat);
  const grp = new THREE.Group();
  grp.add(tree, fruit, cage);
  grp.visible = false;
  scene.add(grp);
  return { grp, treeMat, fruitMat, cageMat, cage };
})();

/* ---------- 壓制三：火 ---------- */
const flame = (() => {
  const n = 140, pos = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) { pos.set([(Math.random() - 0.5) * 0.4, Math.random(), (Math.random() - 0.5) * 0.4], i * 3); seed[i] = Math.random(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    ...ADD, depthTest: false,
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uPx: { value: PX } },
    vertexShader: `
      attribute float aSeed; uniform float uTime, uPx; varying float vF;
      void main(){
        float f = fract(uTime * (0.9 + aSeed) + aSeed * 5.0);
        vec3 p = position; p.y = f * 1.1; p.xz *= 1.0 - f * 0.8; p.x += sin(uTime * 6.0 + aSeed * 20.0) * 0.04;
        vF = f;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uPx * (1.0 - f * 0.6) * (130.0 / -mv.z);
      }`,
    fragmentShader: `uniform float uAlpha; varying float vF; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); vec3 c = mix(vec3(1.6, 1.2, 0.6), vec3(1.4, 0.3, 0.05), vF); gl_FragColor = vec4(c, a * (1.0 - vF) * uAlpha * 0.7); }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false; p.renderOrder = 9;
  scene.add(p);
  return p;
})();

/* ---------- 第三幕第一輪的海底場景 ---------- */
const sea = createSea(scene, isMobile, PX);

/* ---------- DOM ---------- */
const q = (sel) => [...document.querySelectorAll(sel)];
const el = {
  flash: $('flash'), dark: $('dark'), frame: $('frame'), watch: $('watch'), wTag: $('w-tag'), hint: $('hint'),
  line1: $('line1'), line2: $('line2'), hudLayer: $('hud'), hud: q('#hud li'), id: $('v-id'),
  vAu: $('v-au'), vYear: $('v-year'), vTilt: $('v-tilt'), vAir: $('v-air'), vWater: $('v-water'), vG: $('v-g'),
  a3: $('a3'), round: q('#round li'), a3end: $('a3end'), humanTag: $('humanTag'),
  rN: $('r-n'), rEra: $('r-era'), rSpec: $('r-spec'), rHow: $('r-how'), rLoss: $('r-loss'), rState: $('r-state'),
  a4: $('a4'), pray: q('#pray li'), a4b: $('a4b'), a4note: $('a4note'), a4h: $('a4h'),
  a5: $('a5'), press: q('#press li'), a5b: $('a5b'),
  sObj: $('s-obj'), sEvt: $('s-evt'), sJudge: $('s-judge'), sAct: $('s-act'),
  a6: $('a6'), e1: $('e1'), e2: $('e2'),
  a8: $('a8'), you: q('#you li'), a8h: $('a8h'), a8p: $('a8p'),
  yTime: $('y-time'), yZone: $('y-zone'), yScreen: $('y-screen'), yLang: $('y-lang'), yStay: $('y-stay'),
};
const FINAL_ID = 'EARTH';
let lastIdTick = 0;
const row = (li, v) => { setO(li, v); li.style.transform = `translateY(${((1 - v) * 8).toFixed(1)}px)`; };
const cls = (node, name, on) => { if (node.classList.contains(name) !== on) node.classList.toggle(name, on); };

const ROUNDS = [
  { n: '第一輪', era: '奧陶紀末　4.45 億年前', spec: '三葉蟲', how: '全球冰封', loss: '約 85%' },
  { n: '第二輪', era: '泥盆紀晚期　3.72 億年前', spec: '鄧氏魚', how: '海洋缺氧', loss: '約 75%' },
  { n: '第三輪', era: '二疊紀末　2.52 億年前', spec: '麗齒獸', how: '大規模火山噴發', loss: '約 90%' },
  { n: '第四輪', era: '三疊紀末　2.01 億年前', spec: '菊石', how: '火山噴發　二氧化碳暴增', loss: '約 80%' },
  { n: '第五輪', era: '白堊紀末　6600 萬年前', spec: '暴龍', how: '小行星撞擊', loss: '約 75%' },
  { n: '第六輪', era: '現在', spec: '智人', how: '—', loss: '—' },
];
const PRESS = [
  { obj: '巴別塔', judge: '過高', act: '語言分化　1 → 約 7,000 種' },
  { obj: '知識樹', evt: '受試者已取樣', judge: '與我們相似', act: '隔離' },
  { obj: '火', evt: '未授權轉移', judge: '能力外洩', act: '來源已拘束' },
];

// 被監視：計時與最後一幕顯示的都是訪客瀏覽器裡的真實資訊，只在本機顯示，不會送出去
const t0 = performance.now();
const pad = (n) => String(n).padStart(2, '0');
let lastSec = -1;
const updateWatch = () => {
  const sec = Math.floor((performance.now() - t0) / 1000);
  if (sec === lastSec) return; lastSec = sec;
  const now = new Date();
  setT(el.wTag, `觀察中　${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`);
  setT(el.yTime, `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`);
  setT(el.yZone, Intl.DateTimeFormat().resolvedOptions().timeZone || '未知');
  setT(el.yScreen, `${screen.width} × ${screen.height}`);
  setT(el.yLang, navigator.language || '未知');
  setT(el.yStay, `${Math.floor(sec / 60)} 分 ${pad(sec % 60)} 秒`);
};

/* ---------- 第三幕：六輪的狀態 ---------- */
const ROUND_W = [0.43, 0.165, 0.18, 0.14, 0.18, 0.17]; // 第一輪比較長：多了潛進海裡那一段
const ROUND_B = [0]; { const sum = ROUND_W.reduce((x, w) => x + w, 0); let acc = 0; for (const w of ROUND_W) { acc += w / sum; ROUND_B.push(acc); } ROUND_B[6] = 1; }
// 第一輪：把拉長後的進度 v 對回原本的節奏（投放 → 培養 → 銷毀 → 換下一輪），中間那一大段在海裡
const R0_MAP = [[0, 0], [0.12, 0.2], [0.6, 0.5], [0.78, 0.56], [0.9, 0.8], [0.94, 0.86], [1, 1]];
const r0u = (v) => { for (let i = 0; i < R0_MAP.length - 1; i++) if (v < R0_MAP[i + 1][0]) return lerp(R0_MAP[i][1], R0_MAP[i + 1][1], (v - R0_MAP[i][0]) / (R0_MAP[i + 1][0] - R0_MAP[i][0])); return 1; };
const roundState = (p) => {
  if (p <= B[2]) return { r: 0, u: 0, life: 1, wipe: 0, type: 0, seed: 0, grow: 0, killT: 0, on: false };
  if (p >= B[3]) return { r: 5, u: 1, life: 1, wipe: 0, type: 0, seed: 5, grow: 6, killT: 5, on: false };
  const c = local(2, p);
  let r = 0; while (r < 5 && c >= ROUND_B[r + 1]) r++;
  const v = clamp01((c - ROUND_B[r]) / (ROUND_B[r + 1] - ROUND_B[r]));
  const u = r === 0 ? r0u(v) : v;
  if (r === 5) return { r, u, life: sstep(0.0, 0.5, u), wipe: 0, type: 0, seed: 5, grow: 5 + sstep(0.05, 0.6, u), killT: 5, on: true };
  const swapped = u >= 0.86;
  const kill = sstep(0.56, 0.8, u);
  return {
    r, u, v, on: true,
    life: swapped ? 0 : (r === 0 ? sstep(0.09, 0.2, v) : sstep(0.05, 0.42, u)), // 第一輪：光打下來之後生命才出現
    wipe: u < 0.8 ? kill : 1 - sstep(0.9, 1.0, u),
    type: r, seed: swapped ? r + 1 : r,
    grow: r + sstep(0.08, 0.5, u), killT: r + kill,
  };
};

/* ---------- 鏡頭關鍵格 ---------- */
// z 距離、y 高度、orb 繞行角度、sx 讓星球往畫面右邊偏多少、ly 視線高度；[桌機, 直式手機]
const K = [
  { p: B[0], z: [10.5, 17], y: 1.2, orb: 0, sx: [0, 0], ly: [0, 0] },
  { p: B[1], z: [6.2, 11.5], y: 0.5, orb: 0, sx: [0, 0], ly: [0, 0] },
  { p: B[2], z: [24, 40], y: 3.4, orb: 0.5, sx: [0, 0], ly: [4.8, 5.4] },
  { p: at(2, 0.05), z: [11.5, 26], y: 0.8, orb: 0.3, sx: [0, 0], ly: [0.2, 0.6] },
  { p: B[3], z: [11.5, 26], y: 0.8, orb: 0.55, sx: [0, 0], ly: [0.2, 0.6] },
  { p: at(3, 0.2), z: [13, 22], y: 1.6, orb: 0.1, sx: [2.3, 0], ly: [2.9, 2.6] },
  { p: B[4], z: [13, 22], y: 1.6, orb: -0.1, sx: [2.3, 0], ly: [2.9, 2.6] },
  { p: at(4, 0.06), z: [17, 28], y: 2.4, orb: 0.15, sx: [3.0, 0], ly: [4.6, 4.6] },
  { p: B[5], z: [17, 28], y: 2.4, orb: 0.5, sx: [3.0, 0], ly: [4.6, 4.6] },
  { p: at(5, 0.3), z: [36, 44], y: 9, orb: 0.8, sx: [0, 0], ly: [2, 2] },
  { p: B[6], z: [520, 640], y: 230, orb: 1.3, sx: [0, 0], ly: [-40, -40] },
  { p: at(6, 0.45), z: [10.5, 17], y: 1.2, orb: 0, sx: [0, 0], ly: [0, 0], ease: 1.8 },
  { p: 1.001, z: [9.5, 16], y: 1.0, orb: 0, sx: [0, 0], ly: [0, 0] },
];
const camState = { z: 9, y: 0, orb: 0, sx: 0, ly: 0 };
const sampleCam = (p, narrow) => {
  let i = 0; while (i < K.length - 2 && p >= K[i + 1].p) i++;
  const a = K[i], b = K[i + 1], n = narrow ? 1 : 0;
  let u = clamp01((p - a.p) / (b.p - a.p));
  u = b.ease ? 1 - Math.pow(1 - u, b.ease) : u * u * (3 - 2 * u);
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
const cRight = new THREE.Vector3(), cUp = new THREE.Vector3(), cFwd = new THREE.Vector3(), tmpV = new THREE.Vector3();
const tmpColor = new THREE.Color();
// 把一個全息物件固定在畫面上的某個位置（fx、fy 是 -1~1 的畫面座標），大小跟著畫面高度
const HOLO_D = 10;
const SHOW_FOSSILS = false; // 線稿版化石先拿掉，等換成實體模型
const anchor = (obj, fx, fy, scale) => {
  const halfH = TAN * HOLO_D, halfW = halfH * camera.aspect;
  obj.position.copy(camera.position).addScaledVector(cFwd, HOLO_D).addScaledVector(cRight, fx * halfW).addScaledVector(cUp, fy * halfH);
  obj.quaternion.copy(camera.quaternion);
  obj.scale.setScalar(scale * halfH);
};

function frame() {
  const t = clock.getElapsedTime();
  if (forcedP === null) p += (target - p) * 0.07;

  const a = local(0, p), b = local(1, p), c = local(2, p), d = local(3, p), e = local(4, p), f = local(5, p), g = local(6, p), h = local(7, p);
  const cold = sstep(0.05, 0.55, b);
  const narrow = camera.aspect < 0.8;
  const rs = roundState(p);
  const killing = rs.wipe;
  const back = sstep(0.3, 0.6, g);   // 第七幕：回到一開始那道光
  const gone = sstep(0.25, 0.5, g);  // 實驗室的東西全部淡掉

  /* ---- 鏡頭 ---- */
  const in1 = p < B[1];
  sampleCam(in1 ? B[1] * sstep(FLY_END, 1, a) : p, narrow); // 第一幕前段的鏡頭另外算，最後一段才接回關鍵格
  const orb = camState.orb + Math.sin(t * 0.07) * 0.05;
  camera.position.set(Math.sin(orb) * camState.z, camState.y, Math.cos(orb) * camState.z);
  right.set(Math.cos(orb), 0, -Math.sin(orb));
  lookAt.set(0, camState.ly, 0).addScaledVector(right, -camState.sx);
  camera.lookAt(lookAt);
  camera.updateMatrixWorld();
  cRight.setFromMatrixColumn(camera.matrixWorld, 0);
  cUp.setFromMatrixColumn(camera.matrixWorld, 1);
  cFwd.setFromMatrixColumn(camera.matrixWorld, 2).negate();

  /* ---- 第一幕：鏡頭 ---- */
  if (in1) {
    if (a < FLY_END) act1Cam(a, narrow);
    const shake = gauss(a, BANG + 0.006, 0.008) * 22; // 爆開的瞬間鏡頭震一下（這時鏡頭離得很遠）
    if (shake > 0.01) { camera.position.x += Math.sin(t * 61) * shake; camera.position.y += Math.cos(t * 53) * shake; }
    camera.updateMatrixWorld();
    cRight.setFromMatrixColumn(camera.matrixWorld, 0); cUp.setFromMatrixColumn(camera.matrixWorld, 1); cFwd.setFromMatrixColumn(camera.matrixWorld, 2).negate();
  }

  /* ---- 第三幕第一輪：光打下來投放 → 俯衝入海 → 海裡的生態 → 結冰 → 回到軌道 ---- */
  const seaV = p > B[2] && p < B[3] && rs.r === 0 ? rs.v : -1;
  const seaOn = seaV > SEA_IN && seaV < SEA_OUT;
  const seedPulse = seaV >= 0 ? gauss(seaV, 0.07, 0.03) : 0;
  const seaFlash = seaV >= 0 ? (gauss(seaV, SEA_IN, 0.014) + gauss(seaV, SEA_OUT, 0.014)) * 0.95 : 0;
  if (seaV >= 0 && !seaOn) {
    const dive = sstep(0.13, SEA_IN, seaV) * (1 - sstep(SEA_OUT, SEA_OUT + 0.08, seaV));
    if (dive > 0.001) { camera.position.multiplyScalar(lerp(1, (PLANET_R + 0.45) / camera.position.length(), dive * dive)); lookAt.multiplyScalar(1 - dive); camera.lookAt(lookAt); }
  }
  sea.update(seaOn, camera, lookAt, seaV, t);
  if (seaV >= 0) {
    camera.updateMatrixWorld();
    cRight.setFromMatrixColumn(camera.matrixWorld, 0); cUp.setFromMatrixColumn(camera.matrixWorld, 1); cFwd.setFromMatrixColumn(camera.matrixWorld, 2).negate();
  }

  /* ---- 第一幕：一個點 → 炸出許多星系 → 放大進銀河系 ---- */
  const skyOut = 1 - sstep(0.1, 0.55, b); // 第二幕發現是艙壁之後，天空整個淡掉
  const camSun = camera.position.distanceTo(SUN_POS);
  {
    const bangU = clamp01((a - BANG) / 0.22), bangE = 1 - Math.pow(1 - bangU, 3);
    const su = spark.material.uniforms;
    su.uGlow.value = !in1 ? 0 : a < BANG ? sstep(0.008, BANG - 0.012, a) * (0.75 + 0.25 * Math.sin(t * 5)) : (1 - sstep(BANG, BANG + 0.06, a)) * 1.6;
    su.uLit.value = 1;
    spark.visible = su.uGlow.value > 0.002;
    if (spark.visible) spark.quaternion.copy(camera.quaternion);
    const gA = sstep(BANG, BANG + 0.004, a) * skyOut;
    const bgu = bgGal.material.uniforms;
    bgu.uAlpha.value = gA * lerp(1, 0.45, sstep(0.38, 0.56, a)); bgu.uBang.value = bangU; bgu.uTime.value = t;
    bgu.uH.value = renderer.domElement.height / (2 * TAN);
    bgGal.visible = gA > 0.002;
    galaxyGrp.scale.setScalar(Math.max(bangE, 0.001));
    const gu = galaxy.material.uniforms;
    gu.uTime.value = t; gu.uForm.value = 1; gu.uIgnite.value = 1; gu.uAlpha.value = gA * lerp(0.55, 1, sstep(ZOOM0 - 0.06, ZOOM0 + 0.12, a)); // 遠看時不要比其他星系亮太多
    galaxy.visible = gA > 0.002;
    galGlow.material.uniforms.uAlpha.value = bangE * sstep(150, 560, camSun) * skyOut * lerp(0.3, 0.85, sstep(ZOOM0 - 0.06, ZOOM0 + 0.12, a));
    galGlow.visible = galGlow.material.uniforms.uAlpha.value > 0.002;
    const nearA = sstep(ZOOM0, ZOOM0 + 0.1, a) * sstep(1000, 430, camSun) * skyOut;
    localStars.material.uniforms.uAlpha.value = nearA; localStars.material.uniforms.uTime.value = t;
    localStars.visible = nearA > 0.002;
    for (const nb of nebulae) {
      const nu = nb.material.uniforms;
      nu.uAlpha.value = nearA * 0.26 * lerp(1, 0.45, sstep(0.78, 0.92, a)) * sstep(nb.scale.x * 0.25, nb.scale.x * 0.8, camera.position.distanceTo(nb.position));
      nb.visible = nu.uAlpha.value > 0.002;
      if (nb.visible) nb.quaternion.copy(camera.quaternion);
    }
  }

  /* ---- 第一幕：太陽系 → 地球 ---- */
  const pScale = 1;
  {
    const sysA = sstep(0.46, 0.56, a) * skyOut;
    sun.material.uniforms.uGlow.value = sysA * 1.2; sun.material.uniforms.uLit.value = 1;
    sun.visible = sysA > 0.002;
    if (sun.visible) sun.quaternion.copy(camera.quaternion);
    for (const pl of planets) {
      pl.mesh.visible = sysA > 0.002;
      if (!pl.mesh.visible) continue;
      pl.mesh.rotation.y = t * 0.06;
      pl.mat.uniforms.uAlpha.value = sysA; pl.mat.transparent = sysA < 0.999;
      if (pl.ringMat) pl.ringMat.uniforms.uAlpha.value = sysA;
    }
    orbits.material.opacity = sysA * 0.2 * (1 - sstep(0.82, 0.95, a));
    orbits.visible = orbits.material.opacity > 0.002;
    moon.visible = sysA > 0.002;
    if (moon.visible) {
      moon.position.copy(MOON_POS[narrow ? 1 : 0]); moon.rotation.y = t * 0.05;
      moon.material.uniforms.uHot.value = 0;
      moon.material.uniforms.uAlpha.value = sysA; moon.material.transparent = sysA < 0.999;
    }
  }

  /* ---- 那道光 ---- */
  const crack = sstep(0.925, 0.965, a);
  const open = 1;
  const bu = beam.material.uniforms;
  bu.uTime.value = t;
  bu.uWidth.value = lerp(lerp(0.02, 1.0, open) * 0.5 * lerp(1.0, 0.8, cold), 1.0, back);
  bu.uI.value = lerp(crack * lerp(1.0, 1.15, open) * 0.5 * lerp(1.0, 1.3, cold) * (1 + killing * 0.35), 1.15, back);
  bu.uBottom.value = lerp(PLANET_R * 0.98, -60, back);
  bu.uTop.value = lerp(BEAM_TOP, 80, back);
  tmpColor.copy(WARM).lerp(COLD, cold).lerp(KILL, killing * 0.85).lerp(WARM, back);
  bu.uColor.value.copy(tmpColor);
  if (seaOn) bu.uI.value = 0; else if (seedPulse > 0.001) { bu.uI.value *= 1 + seedPulse * 2.5; bu.uWidth.value *= 1 + seedPulse * 1.5; } // 投放：一道特別亮的光打下來
  beam.rotation.y = Math.atan2(camera.position.x, camera.position.z);

  /* ---- 星空、塵埃 ---- */
  stars.material.uniforms.uTime.value = t;
  stars.material.uniforms.uAlpha.value = sstep(0.5, 0.6, a) * lerp(lerp(1, 0.08, sstep(0.1, 0.6, b)), 1, back);
  stars.rotation.y = t * 0.004;

  /* ---- 壓制三段的進度 ---- */
  const v1 = clamp01((e - 0.04) / 0.32), v2 = clamp01((e - 0.36) / 0.30), v3 = clamp01((e - 0.66) / 0.27);
  const stage = e < 0.36 ? 0 : e < 0.66 ? 1 : 2;
  const lock = sstep(0.68, 0.95, v3) * (1 - sstep(0.1, 0.3, f)); // 最後把環收緊、變紅

  /* ---- 星球 ---- */
  const reveal = sstep(0.46, 0.54, a); // 放大到太陽系之後地球才出現
  const pu = planet.material.uniforms;
  pu.uTime.value = t; pu.uReveal.value = reveal; pu.uCold.value = cold; pu.uFade.value = 1 - gone;
  planet.visible = gone < 0.999 && reveal > 0.001;
  pu.uSeed.value = rs.seed; pu.uLife.value = rs.life; pu.uWipe.value = rs.wipe; pu.uType.value = rs.type;
  pu.uEra.value = Math.min(rs.seed, 4); pu.uReal.value = rs.seed >= 5 ? 1 : 0;
  pu.uFlood.value = pulse(d, 0.30, 0.50, 0.06);
  pu.uPlague.value = pulse(d, 0.50, 0.68, 0.05);
  pu.uWar.value = pulse(d, 0.68, 0.92, 0.05);
  pu.uSpark.value = sstep(0.42, 0.8, v3);
  planet.rotation.y = t * 0.035;
  planet.scale.setScalar(pScale); atmo.scale.setScalar(pScale);
  atmo.material.uniforms.uReveal.value = reveal * (1 - gone);
  atmo.material.uniforms.uHot.value = 1 - sstep(0.3, 0.9, reveal);
  atmo.material.uniforms.uKill.value = killing * (rs.type >= 2 ? 0.6 : 0.15);

  /* ---- 隕石 ---- */
  const inAct3 = p > B[2] && p < B[3];
  if (inAct3 && rs.r === 4 && rs.u > 0.455 && rs.u < 0.57) {
    const k = (rs.u - 0.455) / 0.115;
    const dist = PLANET_R + (1 - k) * (1 - k) * 26;
    mHead.copy(IMPACT).multiplyScalar(dist);
    const arr = meteor.geometry.attributes.position.array;
    arr[0] = mHead.x; arr[1] = mHead.y; arr[2] = mHead.z;
    const tail = dist + 1.2 + (1 - k) * 5;
    arr[3] = IMPACT.x * tail; arr[4] = IMPACT.y * tail; arr[5] = IMPACT.z * tail;
    meteor.geometry.attributes.position.needsUpdate = true;
    meteor.material.opacity = sstep(0, 0.15, k);
  } else meteor.material.opacity = 0;
  const impactFlash = (inAct3 && rs.r === 4) ? gauss(rs.u, 0.575, 0.012) * 0.75 : 0;
  const flashV = (in1 ? gauss(a, BANG + 0.004, 0.008) * 0.9 : 0) + seaFlash + impactFlash + gauss(v1, 0.9, 0.03) * 0.3 * (stage === 0 ? 1 : 0);
  setO(el.flash, flashV);

  /* ---- 第三幕：演化樹、化石、DNA ---- */
  const a3on = sstep(0.04, 0.1, c) * (1 - sstep(0.0, 0.08, d));
  evo.mat.uniforms.uGrow.value = rs.grow;
  evo.mat.uniforms.uKillT.value = rs.killT;
  evo.mat.uniforms.uAlpha.value = narrow || seaOn ? 0 : a3on;
  evo.grp.visible = evo.mat.uniforms.uAlpha.value > 0.002;
  if (evo.grp.visible) anchor(evo.grp, -0.62, 0.1, 0.25);
  evo.cuts.forEach((m, r) => { m.opacity = (rs.killT > r ? sstep(r, r + 0.3, rs.killT) : 0) * 0.7 * a3on * (narrow || seaOn ? 0 : 1); });
  if (narrow) anchor(fossils.grp, 0, 0.56, 0.085); else anchor(fossils.grp, 0.6, 0.42, 0.15);
  fossils.list.forEach((fo, i) => {
    const on = SHOW_FOSSILS && inAct3 && rs.r === i && rs.u > 0.1 && rs.u < 0.88;
    fo.l.visible = on;
    if (on) { fo.mat.uniforms.uDraw.value = sstep(0.12, 0.46, rs.u) * 1.001; fo.mat.uniforms.uBreak.value = sstep(0.6, 0.86, rs.u); }
  });
  // DNA 沿光束投放
  const drop = inAct3 ? (rs.r === 0 ? rs.u + 0.04 : rs.u) : 1;
  helix.material.opacity = inAct3 && drop < 0.2 ? Math.sin(clamp01(drop / 0.2) * PI) * 0.9 : 0;
  helix.position.y = lerp(BEAM_TOP - 2, PLANET_R + 0.6, sstep(0.0, 0.2, drop));
  helix.rotation.y = t * 2.2;

  /* ---- 全息環、艙體、儀器 ---- */
  const holoA = sstep(0.14, 0.5, b) * (1 - sstep(0.3, 0.6, f));
  holoMat.opacity = holoA * 0.85; holoDim.opacity = holoA * 0.35;
  holoMat.color.copy(COLD).lerp(KILL, lock); holoDim.color.copy(COLD).lerp(KILL, lock);
  holo.scale.setScalar(lerp(0.6, 1, sstep(0.14, 0.6, b)) * lerp(1, 0.7, lock));
  for (const r of holoRings) r.l.rotation.y = t * r.speed;
  chamberMat.opacity = sstep(0.28, 0.85, b) * 0.5 * lerp(1, 0.55, sstep(0.3, 0.9, f)) * (1 - gone);
  const em = sstep(0.22, 0.7, b) * (1 - gone);
  emitterMat.opacity = em; emitterBody.opacity = em; emitterEdge.opacity = em * 0.8;
  emitter.grp.visible = em > 0.002; // 看不見的時候也不要擋住後面的東西
  emitter.rings.forEach((r, i) => { r.rotation.z = t * (0.4 - i * 0.25); });

  /* ---- 第四幕：祈禱 ---- */
  prayers.material.uniforms.uTime.value = t;
  prayers.material.uniforms.uAlpha.value = sstep(0.02, 0.16, d) * (1 - sstep(0.0, 0.12, e));
  prayers.visible = prayers.material.uniforms.uAlpha.value > 0.002;

  /* ---- 第五幕：巴別塔、知識樹、火 ---- */
  const inAct5 = p > B[4] && p < B[5];
  babel.l.visible = inAct5 && stage === 0 && v1 > 0.02;
  const towerDraw = sstep(0.06, 0.82, v1) * 0.96;
  if (babel.l.visible) { babel.mat.uniforms.uDraw.value = towerDraw; babel.mat.uniforms.uBreak.value = sstep(0.86, 1.0, v1); }
  eden.grp.visible = inAct5 && stage === 1 && v2 > 0.02 && v2 < 0.99;
  if (eden.grp.visible) {
    if (narrow) anchor(eden.grp, -0.42, -0.2, 0.085); else anchor(eden.grp, -0.56, -0.12, 0.16);
    const fade = 1 - sstep(0.9, 0.99, v2);
    eden.treeMat.uniforms.uDraw.value = sstep(0.04, 0.42, v2) * 1.001; eden.treeMat.uniforms.uAlpha.value = fade;
    const touched = sstep(0.5, 0.56, v2);
    eden.fruitMat.uniforms.uAlpha.value = sstep(0.36, 0.46, v2) * fade;
    eden.fruitMat.uniforms.uHot.value = touched;
    eden.fruitMat.uniforms.uSize.value = 1 + gauss(v2, 0.54, 0.04) * 1.6;
    eden.cageMat.uniforms.uDraw.value = sstep(0.56, 0.78, v2) * 1.001; eden.cageMat.uniforms.uAlpha.value = fade * 0.9;
    eden.cage.scale.setScalar(lerp(1.5, 1.0, sstep(0.56, 0.82, v2)));
    eden.cage.rotation.y = t * 0.3;
    eden.treeMat.uniforms.uColor.value.copy(COLD).lerp(KILL, sstep(0.78, 0.9, v2) * 0.6);
  }
  flame.material.uniforms.uTime.value = t;
  const fall = sstep(0.06, 0.42, v3);
  flame.material.uniforms.uAlpha.value = inAct5 && stage === 2 ? sstep(0.02, 0.1, v3) * (1 - sstep(0.4, 0.5, v3)) : 0;
  flame.visible = flame.material.uniforms.uAlpha.value > 0.002;
  flame.position.set(0, lerp(BEAM_TOP - 1.2, PLANET_R - 0.1, fall * fall), 0);

  /* ---- 第六幕：其他實驗場 ---- */
  const oth = sstep(0.28, 0.75, f) * (1 - sstep(0.1, 0.35, g));
  others.liveMat.opacity = oth * 0.34; others.deadMat.opacity = oth * 0.2; others.beamMat.opacity = oth * 0.8;
  others.dotMat.uniforms.uAlpha.value = oth;

  bloom.strength = lerp(lerp(0.75, 0.6, cold) * lerp(1, 0.55, sstep(0.0, 0.15, c)), 0.75, back) + flashV * 1.0 + killing * 0.08;
  bloom.threshold = lerp(lerp(0.32, 0.5, sstep(0.0, 0.15, c)), 0.32, back);
  if (seaOn) { bloom.strength = 0.3; bloom.threshold = 0.7; }

  /* ================= 文字 ================= */
  setO(el.hint, 1 - sstep(0.0, 0.004, p));
  setO(el.line1, sstep(0.955, 0.985, a) * (1 - sstep(0.02, 0.16, b)));
  const act2Out = 1 - sstep(0.0, 0.07, c);
  setO(el.line2, sstep(0.56, 0.74, b) * act2Out);
  setO(el.hudLayer, act2Out);
  el.hud.forEach((li, i) => row(li, sstep(0.32 + i * 0.05, 0.4 + i * 0.05, b)));
  const kk = sstep(0.36, 0.82, b);
  setT(el.vAu, (1.0 * kk).toFixed(3) + ' AU');
  setT(el.vYear, (365.256 * kk).toFixed(3) + ' 日');
  setT(el.vTilt, (23.44 * kk).toFixed(2) + '°');
  setT(el.vAir, `氮 ${(78.08 * kk).toFixed(2)}%　氧 ${(20.95 * kk).toFixed(2)}%`);
  setT(el.vWater, Math.round(71 * kk) + '%');
  setT(el.vG, (9.81 * kk).toFixed(2) + ' m/s²');
  if (b < 0.8) {
    if (t - lastIdTick > 0.06) { lastIdTick = t; el.id.textContent = Array.from({ length: 5 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join(''); }
  } else setT(el.id, FINAL_ID);

  // 第三幕
  setO(el.a3, a3on);
  const R = ROUNDS[rs.r], dead = rs.r < 5 && rs.u > 0.58;
  setT(el.rN, R.n); setT(el.rEra, R.era); setT(el.rSpec, R.spec);
  setT(el.rHow, rs.r < 5 ? (rs.u > 0.5 ? R.how : '—') : '—');
  setT(el.rLoss, rs.r < 5 ? (rs.u > 0.62 ? R.loss : '—') : '—');
  setT(el.rState, rs.r === 5 ? '觀察中' : dead ? '銷毀' : rs.u < 0.2 ? '投放' : '培養中');
  cls(el.round[5], 'kill', dead); cls(el.round[4], 'kill', dead && rs.u > 0.62);
  el.round.forEach((li, i) => row(li, a3on > 0 ? sstep(0.0, 0.3, a3on + 0.3 - i * 0.04) : 0));
  setO(el.a3end, rs.r === 5 && inAct3 ? sstep(0.55, 0.72, rs.u) * (1 - sstep(0.0, 0.06, d)) : 0);
  // 「人類」標在演化樹上那一枝
  const tagOn = evo.grp.visible && rs.r === 5 ? sstep(0.55, 0.7, rs.u) * a3on : 0;
  setO(el.humanTag, tagOn);
  if (tagOn > 0) {
    evo.grp.updateMatrixWorld();
    tmpV.copy(evo.humanLocal).applyMatrix4(evo.grp.matrixWorld).project(camera);
    el.humanTag.style.transform = `translate(${((tmpV.x * 0.5 + 0.5) * innerWidth + 10).toFixed(1)}px, ${((-tmpV.y * 0.5 + 0.5) * innerHeight - 22).toFixed(1)}px)`;
  }

  // 第四幕
  const act4Out = 1 - sstep(0.0, 0.08, e);
  setO(el.a4, sstep(0.06, 0.14, d) * act4Out);
  setO(el.a4b, sstep(0.04, 0.1, d) * act4Out);
  setO(el.a4note, sstep(0.14, 0.24, d));
  setO(el.a4h, sstep(0.66, 0.8, d));
  el.pray.forEach((li, i) => {
    row(li, sstep(0.08 + i * 0.025, 0.14 + i * 0.025, d));
    if (i >= 3) {
      const s0 = [0.30, 0.50, 0.68][i - 3], done = d > s0;
      cls(li, 'idle', !done); cls(li, 'kill', done);
      setT(li.lastElementChild, done ? '已執行' : '待命');
    }
  });

  // 第五幕
  const act5Out = 1 - sstep(0.0, 0.1, f);
  setO(el.a5, sstep(0.03, 0.08, e) * act5Out);
  setO(el.a5b, sstep(0.93, 0.99, e) * act5Out);
  const P = PRESS[stage], vv = [v1, v2, v3][stage];
  setT(el.sObj, P.obj);
  setT(el.sEvt, stage === 0 ? `高度 ${Math.round(towerDraw / 0.96 * 100)}%` : (vv > [0, 0.5, 0.2][stage] ? P.evt : '—'));
  const judged = vv > [0.8, 0.6, 0.55][stage], acted = vv > [0.88, 0.76, 0.72][stage];
  setT(el.sJudge, judged ? P.judge : '—');
  setT(el.sAct, acted ? P.act : '—');
  cls(el.press[2], 'kill', judged); cls(el.press[3], 'kill', acted);
  el.press.forEach((li, i) => row(li, sstep(0.03 + i * 0.012, 0.08 + i * 0.012, e)));

  // 第六幕
  setO(el.a6, sstep(0.55, 0.75, f) * (1 - sstep(0.0, 0.12, g)));

  // 第七幕：回到那道光
  setO(el.e1, sstep(0.55, 0.7, g) * (1 - sstep(0.0, 0.1, h)));
  setO(el.e2, sstep(0.8, 0.92, g) * (1 - sstep(0.0, 0.1, h)));

  // 被監視：揭穿之後取景框就一直在，最後整個框起來
  updateWatch();
  setO(el.watch, sstep(0.85, 1.0, b) * lerp(0.55, 1, sstep(0.0, 0.2, h)));
  setO(el.dark, sstep(0.08, 0.2, h) * 0.94);
  setO(el.frame, sstep(0.2, 0.32, h));
  setO(el.a8, sstep(0.22, 0.3, h));
  el.you.forEach((li, i) => row(li, sstep(0.28 + i * 0.05, 0.34 + i * 0.05, h)));
  setO(el.a8h, sstep(0.64, 0.76, h));
  setO(el.a8p, sstep(0.86, 0.95, h));

  composer.render();
  requestAnimationFrame(frame);
}
frame();
