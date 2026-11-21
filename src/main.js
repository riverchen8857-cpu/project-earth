import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ---------- 工具 ---------- */
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
const forcedP = params.has('p') ? parseFloat(params.get('p')) : null; // 除錯用：?p=0.4 直接看某個進度

const isMobile = Math.min(innerWidth, innerHeight) < 768;
const ACT1_END = 0.55; // 0~0.55 第一幕，0.55~1 第二幕

/* ---------- 基本場景 ---------- */
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 600);
camera.position.set(0, 0, 9);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.6, 0.32);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const WARM = new THREE.Color(1.0, 0.84, 0.58);
const COLD = new THREE.Color(0.45, 0.92, 1.0);

/* ---------- 星空 ---------- */
const stars = (() => {
  const n = isMobile ? 2500 : 6000;
  const pos = new Float32Array(n * 3), size = new Float32Array(n), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 180 + Math.random() * 60;
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
  scene.add(p);
  return p;
})();

/* ---------- 塵埃 → 星雲 ---------- */
const dust = (() => {
  const n = isMobile ? 26000 : 80000;
  const start = new Float32Array(n * 3), target = new Float32Array(n * 3);
  const seed = new Float32Array(n), size = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // 起點：一大片混沌
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 6 + Math.pow(Math.random(), 0.6) * 34;
    const s = Math.sqrt(1 - u * u);
    start.set([r * s * Math.cos(th), r * u * 0.7, r * s * Math.sin(th)], i * 3);
    // 終點：繞著星球的旋臂盤面
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
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);
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
        // 還沒聚攏時多轉幾圈，聚攏後照內快外慢的速度公轉
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
      uBottom: { value: -60 }, uTop: { value: BEAM_TOP }, uWidth: { value: 0.02 },
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
  const mesh = new THREE.Mesh(g, m);
  mesh.scale.set(7, 140, 1);
  mesh.position.y = 0;
  mesh.renderOrder = 5;
  scene.add(mesh);
  return mesh;
})();

/* ---------- 星球 ---------- */
const PLANET_R = 1.6;
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
    uniforms: { uTime: { value: 0 }, uReveal: { value: 0 }, uCold: { value: 0 } },
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
      uniform float uTime, uReveal, uCold; varying vec3 vN; varying vec3 vP; varying vec3 vV;
      ${NOISE}
      void main(){
        vec3 p = normalize(vP);
        float h = fbm(p * 1.7 + 3.1);
        float land = smoothstep(0.50, 0.545, h);
        float detail = fbm(p * 5.0 + 20.0);
        vec3 ocean = mix(vec3(0.010, 0.060, 0.220), vec3(0.030, 0.230, 0.480), smoothstep(0.30, 0.52, h));
        vec3 ground = mix(vec3(0.07, 0.26, 0.10), vec3(0.42, 0.35, 0.20), smoothstep(0.40, 0.66, detail));
        ground = mix(ground, vec3(0.30, 0.27, 0.24), smoothstep(0.60, 0.70, h));
        vec3 col = mix(ocean, ground, land);
        float ice = smoothstep(0.80, 0.92, abs(p.y) + (detail - 0.5) * 0.12);
        col = mix(col, vec3(0.90, 0.95, 1.0), ice);

        vec3 L = normalize(vec3(0.55, 0.75, 0.6));
        float diff = max(dot(vN, L), 0.0);
        float spec = pow(max(dot(reflect(-L, vN), vV), 0.0), 40.0) * (1.0 - land) * 0.6;

        float c = fbm(p * 3.0 + vec3(uTime * 0.012, 0.0, uTime * 0.008));
        float cloud = smoothstep(0.52, 0.72, c);
        col = mix(col, vec3(1.0), cloud * 0.85);

        vec3 lit = col * (0.05 + diff * 1.15) + spec;
        // 夜面微光，讓它不是死黑
        lit += col * 0.03;
        float fres = pow(1.0 - max(dot(vN, vV), 0.0), 3.0);
        lit += vec3(0.25, 0.55, 1.0) * fres * (0.35 + diff * 0.9);

        // 剛成形時是熔融的，慢慢冷卻成藍色
        float cool = smoothstep(0.15, 0.85, uReveal);
        float lava = fbm(p * 4.0 + uTime * 0.05);
        vec3 molten = mix(vec3(0.85, 0.22, 0.03), vec3(1.25, 0.75, 0.25), smoothstep(0.4, 0.7, lava));
        lit = mix(molten, lit, cool);
        // 第二幕：變成被觀察的樣本，稍微去飽和偏冷
        float g = dot(lit, vec3(0.3, 0.59, 0.11));
        lit = mix(lit, mix(vec3(g), lit, 0.75) * vec3(0.9, 1.0, 1.08), uCold);
        gl_FragColor = vec4(lit, smoothstep(0.0, 0.25, uReveal));
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(PLANET_R, 128, 96), m);
  mesh.rotation.z = 0.41;
  scene.add(mesh);
  return mesh;
})();

const atmo = (() => {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
    uniforms: { uReveal: { value: 0 }, uHot: { value: 1 } },
    vertexShader: `
      varying vec3 vN;
      void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uReveal, uHot; varying vec3 vN;
      void main(){
        float i = pow(max(0.72 - dot(vN, vec3(0.0, 0.0, 1.0)), 0.0), 3.2);
        vec3 col = mix(vec3(0.30, 0.60, 1.0), vec3(1.0, 0.55, 0.2), uHot);
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
    return l;
  };
  mk(2.35, 0, 0, 0.25);
  mk(2.42, 0, 0, 0.25, 0.2, 2.6);
  mk(3.1, 0.5, 0.2, -0.18);
  mk(3.9, -0.35, 0.6, 0.12, 0, Math.PI * 1.5);
  mk(2.7, Math.PI / 2, 0, 0.3, 0, Math.PI * 2, holoDim);
  mk(4.6, 0.12, -0.1, -0.06, 0, Math.PI * 2, holoDim);
  // 刻度
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

/* ---------- 第二幕：實驗艙 ---------- */
const CH_R = 30, CH_Y0 = -14, CH_Y1 = 20;
const chamberMat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.22, 0.6, 0.72), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const chamber = (() => {
  const seg = [];
  const ribs = 36;
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2;
    seg.push(Math.cos(a) * CH_R, CH_Y0, Math.sin(a) * CH_R, Math.cos(a) * CH_R, CH_Y1, Math.sin(a) * CH_R);
  }
  const hoop = (r, y, n = 96) => {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      seg.push(Math.cos(a0) * r, y, Math.sin(a0) * r, Math.cos(a1) * r, y, Math.sin(a1) * r);
    }
  };
  for (let y = CH_Y0; y <= CH_Y1; y += 4.25) hoop(CH_R, y);
  // 地板與天花板的同心圓和放射線
  for (const y of [CH_Y0, CH_Y1]) {
    for (const r of [4, 9, 15, 22]) hoop(r, y);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      seg.push(Math.cos(a) * 4, y, Math.sin(a) * 4, Math.cos(a) * CH_R, y, Math.sin(a) * CH_R);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
  const lines = new THREE.LineSegments(g, chamberMat);
  scene.add(lines);
  return lines;
})();

/* ---------- 第二幕：光束的來源（儀器） ---------- */
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
  // 連到天花板的支架
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

/* ---------- DOM ---------- */
const el = {
  flash: $('flash'), line1: $('line1'), line2: $('line2'), hint: $('hint'), end: $('end'),
  hud: [...document.querySelectorAll('#hud li')],
  beam: $('v-beam'), air: $('v-air'), orbit: $('v-orbit'), id: $('v-id'),
};
const FINAL_ID = '000006';
let lastIdTick = 0;

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
const lookAt = new THREE.Vector3();
const tmpColor = new THREE.Color();

function frame() {
  const t = clock.getElapsedTime();
  if (forcedP === null) p += (target - p) * 0.07;

  const a = clamp01(p / ACT1_END);                    // 第一幕進度
  const b = clamp01((p - ACT1_END) / (1 - ACT1_END)); // 第二幕進度
  const cold = sstep(0.05, 0.55, b);
  const narrow = camera.aspect < 0.8;

  /* 那道光：先是一條線，劈開後變寬 */
  const crack = sstep(0.02, 0.10, a);
  const open = sstep(0.11, 0.24, a);
  const bu = beam.material.uniforms;
  bu.uTime.value = t;
  bu.uWidth.value = lerp(0.02, 1.0, open) * lerp(1.0, 0.5, sstep(0.5, 0.95, a)) * lerp(1.0, 0.8, cold);
  bu.uI.value = crack * lerp(1.0, 1.15, open) * lerp(1.0, 0.5, sstep(0.5, 0.95, a)) * lerp(1.0, 1.3, cold);
  bu.uBottom.value = lerp(-60, PLANET_R * 0.98, sstep(0.5, 0.8, a)); // 星球成形後，光停在星球上
  tmpColor.copy(WARM).lerp(COLD, cold);
  bu.uColor.value.copy(tmpColor);
  beam.rotation.y = Math.atan2(camera.position.x, camera.position.z);
  el.flash.style.opacity = (Math.exp(-Math.pow((a - 0.125) / 0.028, 2)) * 0.7).toFixed(3);

  /* 星空：光劈開後才出現；第二幕發現是艙壁，星星淡掉 */
  stars.material.uniforms.uTime.value = t;
  stars.material.uniforms.uAlpha.value = sstep(0.13, 0.4, a) * lerp(1, 0.08, sstep(0.1, 0.6, b));
  stars.rotation.y = t * 0.004;

  /* 塵埃聚成星雲 */
  const du = dust.material.uniforms;
  du.uTime.value = t;
  du.uForm.value = sstep(0.16, 0.74, a);
  du.uAlpha.value = sstep(0.12, 0.3, a) * lerp(1, 0.55, sstep(0.7, 1, a)) * lerp(1, 0.35, sstep(0.2, 0.8, b));
  du.uCold.value = cold;
  dust.rotation.x = 0.32;

  /* 星球成形、冷卻 */
  const reveal = sstep(0.52, 0.96, a);
  planet.material.uniforms.uTime.value = t;
  planet.material.uniforms.uReveal.value = reveal;
  planet.material.uniforms.uCold.value = cold;
  planet.rotation.y = t * 0.035;
  const sc = lerp(0.35, 1, sstep(0.52, 0.8, a));
  planet.scale.setScalar(sc);
  atmo.scale.setScalar(sc);
  atmo.material.uniforms.uReveal.value = reveal;
  atmo.material.uniforms.uHot.value = 1 - sstep(0.3, 0.9, reveal);

  /* 全息環、艙體、儀器 */
  const holoA = sstep(0.14, 0.5, b);
  holoMat.opacity = holoA * 0.85;
  holoDim.opacity = holoA * 0.35;
  holo.scale.setScalar(lerp(0.6, 1, sstep(0.14, 0.6, b)));
  for (const r of holoRings) r.l.rotation.y = t * r.speed;
  chamberMat.opacity = sstep(0.28, 0.85, b) * 0.5;
  const em = sstep(0.22, 0.7, b);
  emitterMat.opacity = em;
  emitterBody.opacity = em;
  emitterEdge.opacity = em * 0.8;
  emitter.rings.forEach((r, i) => { r.rotation.z = t * (0.4 - i * 0.25); });

  /* 鏡頭：第一幕緩緩推近，第二幕往後退、抬頭 */
  const push = sstep(0.0, 1.0, a);
  const back = sstep(0.0, 1.0, b);
  const z = lerp(lerp(narrow ? 17 : 10.5, narrow ? 11.5 : 6.2, push), narrow ? 40 : 24, back);
  const orbit = Math.sin(t * 0.07) * 0.18 + lerp(0.0, 0.5, back);
  camera.position.set(Math.sin(orbit) * z, lerp(lerp(1.2, 0.5, push), 3.4, back), Math.cos(orbit) * z);
  lookAt.set(0, lerp(0, narrow ? 5.4 : 4.8, back), 0);
  camera.lookAt(lookAt);

  bloom.strength = lerp(0.75, 0.6, cold) + Number(el.flash.style.opacity) * 1.2;

  /* 文字 */
  el.hint.style.opacity = (1 - sstep(0.0, 0.03, p)).toFixed(3);
  el.line1.style.opacity = (sstep(0.72, 0.88, a) * (1 - sstep(0.02, 0.16, b))).toFixed(3);
  el.line2.style.opacity = sstep(0.56, 0.74, b).toFixed(3);
  el.end.style.opacity = sstep(0.94, 1.0, b).toFixed(3);
  el.hud.forEach((li, i) => {
    const v = sstep(0.34 + i * 0.065, 0.42 + i * 0.065, b);
    li.style.opacity = v.toFixed(3);
    li.style.transform = `translateY(${((1 - v) * 8).toFixed(1)}px)`;
  });
  el.beam.textContent = (99.97 * sstep(0.36, 0.72, b)).toFixed(2) + '%';
  el.air.textContent = (100 * sstep(0.44, 0.8, b)).toFixed(2) + '%';
  el.orbit.textContent = (99.2 * sstep(0.5, 0.86, b)).toFixed(2) + '%';
  if (b < 0.8) {
    if (t - lastIdTick > 0.06) {
      lastIdTick = t;
      el.id.textContent = Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join('');
    }
  } else if (el.id.textContent !== FINAL_ID) {
    el.id.textContent = FINAL_ID;
  }

  composer.render();
  requestAnimationFrame(frame);
}
frame();
