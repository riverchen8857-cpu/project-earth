// 第三幕第一輪：潛進奧陶紀的海裡，看當時的生態，然後結冰。
// 生物都是用程式拼出來的簡單實體模型（直角石、三葉蟲、海百合、無頜魚），大小比例不是真實的。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const PI = Math.PI;

export const SEA_IN = 0.225, SEA_OUT = 0.775; // 這一輪的進度：入水、出水
const SEA_C = new THREE.Vector3(0, -5000, 0);  // 海底場景放在離主場景很遠的地方
const FLOOR_Y = -6;
const floorH = (x, z) => Math.sin(x * 0.11) * Math.cos(z * 0.09) * 1.3 + Math.sin(x * 0.31 + 1.7) * Math.sin(z * 0.27) * 0.4;

const NOISE = `
  float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x){
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
`;

export function createSea(scene, isMobile, PX) {
  // 所有材質共用的狀態
  const U = { uTime: { value: 0 }, uSeaT: { value: 0 }, uLight: { value: 1 }, uFrozen: { value: 0 }, uFog: { value: new THREE.Color() } };
  const grp = new THREE.Group();
  grp.position.copy(SEA_C);
  grp.visible = false;
  scene.add(grp);

  // 生物、海床共用的材質：上方來的光、水面的光紋、越遠越融進水色
  const seaMat = (c1, c2 = c1, o = {}) => new THREE.ShaderMaterial({
    uniforms: { ...U, uColor: { value: new THREE.Color(...c1) }, uColor2: { value: new THREE.Color(...c2) }, uSway: { value: o.sway || 0 }, uStripe: { value: o.stripe || 0 }, uMottle: { value: o.mottle || 0 } },
    vertexShader: `
      uniform float uSeaT, uSway, uFrozen; varying vec3 vW, vN, vL;
      void main(){
        vec3 p = position;
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = modelMatrix * instanceMatrix;
        #endif
        float ph = m[3][0] * 0.7 + m[3][2] * 0.9;
        float bend = uSway * p.y * p.y; // 隨水流擺動，越高擺越多；結冰後垂下來
        p.x += (sin(uSeaT * 0.9 + ph + p.y * 0.6) * 0.03 + uFrozen * 0.035) * bend;
        p.z += cos(uSeaT * 0.7 + ph) * 0.018 * bend;
        p.y -= uFrozen * 0.012 * bend * p.y;
        vec4 w = m * vec4(p, 1.0);
        vW = w.xyz; vL = position; vN = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform vec3 uColor, uColor2, uFog; uniform float uLight, uFrozen, uTime, uStripe, uMottle; varying vec3 vW, vN, vL;
      ${NOISE}
      void main(){
        vec3 n = normalize(vN), v = normalize(cameraPosition - vW);
        float diff = 0.3 + 0.7 * max(dot(n, normalize(vec3(0.25, 1.0, 0.35))), 0.0);
        float k = uStripe > 0.0 ? smoothstep(-0.2, 0.2, sin(vL.x * uStripe)) : 0.0;
        k = mix(k, smoothstep(0.35, 0.65, fbm(vW * 0.7)), uMottle);
        vec3 col = mix(uColor, uColor2, k);
        float ca = pow(vnoise(vec3(vW.xz * 0.9, uTime * 0.6)), 3.0) * max(n.y, 0.0) * 1.1 * (1.0 - uFrozen);
        col *= diff * (1.0 + ca) * uLight;
        col = mix(col, vec3(0.72, 0.84, 0.94) * diff * uLight, uFrozen * 0.5);
        col += uFog * pow(1.0 - max(dot(n, v), 0.0), 2.5) * 0.7;
        col = mix(col, uFog, 1.0 - exp(-distance(vW, cameraPosition) * 0.062));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });

  /* ---------- 水體：往上是海面的亮光，往下是深處；結冰後頭頂變成冰蓋 ---------- */
  grp.add(new THREE.Mesh(new THREE.SphereGeometry(300, 48, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: U,
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uFog; uniform float uLight, uFrozen, uTime; varying vec3 vD;
      ${NOISE}
      void main(){
        vec3 d = normalize(vD);
        vec3 col = mix(uFog * 0.25, uFog, smoothstep(-0.5, 0.02, d.y));
        vec3 top = vec3(0.2, 0.62, 0.74) * uLight;
        float rip = fbm(vec3(d.xz / max(d.y, 0.08) * 1.6, uTime * 0.25));
        top *= 0.75 + 0.6 * rip;
        vec3 ice = vec3(0.62, 0.72, 0.8) * (0.55 + 0.45 * smoothstep(0.42, 0.5, fbm(vec3(d.xz / max(d.y, 0.08) * 0.9, 3.0)))) * 0.75;
        ice *= 1.0 - 0.6 * smoothstep(0.035, 0.0, abs(fbm(vec3(d.xz / max(d.y, 0.08) * 2.2, 7.0)) - 0.5)); // 裂縫
        top = mix(top, ice * mix(1.0, 0.75, uFrozen), uFrozen);
        col = mix(col, top, smoothstep(0.02, 0.75, d.y));
        col += vec3(0.9, 1.0, 0.95) * pow(max(dot(d, normalize(vec3(0.15, 1.0, -0.25))), 0.0), 10.0) * 0.5 * uLight * (1.0 - uFrozen);
        gl_FragColor = vec4(col, 1.0);
      }`,
  })));

  /* ---------- 海床 ---------- */
  {
    const g = new THREE.PlaneGeometry(260, 260, 180, 180);
    g.rotateX(-PI / 2);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, FLOOR_Y + floorH(pos.getX(i), pos.getZ(i)) + (Math.random() - 0.5) * 0.06);
    g.computeVertexNormals();
    grp.add(new THREE.Mesh(g, seaMat([0.34, 0.32, 0.25], [0.19, 0.2, 0.18], { mottle: 1 })));
  }

  /* ---------- 從海面灑下來的光柱 ---------- */
  const shaftMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: U,
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform float uTime, uLight, uFrozen; varying vec2 vUv; varying vec3 vW;
      ${NOISE}
      void main(){
        float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
        float rays = 0.35 + 0.65 * fbm(vec3(vUv.x * 5.0 + vW.x * 0.2, uTime * 0.18, vW.z * 0.1));
        float a = edge * rays * smoothstep(0.0, 0.55, vUv.y) * 0.15 * uLight * (1.0 - uFrozen);
        gl_FragColor = vec4(vec3(0.6, 0.95, 0.9) * a, 1.0);
      }`,
  });
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5 + Math.random() * 6, 46), shaftMat);
    m.position.set(-26 + i * 6.5 + Math.random() * 3, 14, -24 + Math.random() * 24);
    m.rotation.z = 0.22 + Math.random() * 0.1;
    m.renderOrder = 3;
    grp.add(m);
  }

  /* ---------- 漂在水裡的碎屑 ---------- */
  {
    const n = isMobile ? 500 : 1300, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos.set([(Math.random() - 0.5) * 60, FLOOR_Y + Math.random() * 20, -32 + Math.random() * 44], i * 3); seed[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { ...U, uPx: { value: PX } },
      vertexShader: `attribute float aSeed; uniform float uSeaT, uPx; varying float vA;
        void main(){ vec3 p = position; p.y = ${FLOOR_Y.toFixed(1)} + mod(p.y - ${FLOOR_Y.toFixed(1)} - uSeaT * (0.12 + aSeed * 0.2), 20.0);
          p.x += sin(uSeaT * 0.4 + aSeed * 30.0) * 0.4;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; vA = exp(mv.z * 0.06);
          gl_PointSize = clamp(uPx * (1.0 + aSeed * 2.0) * (9.0 / -mv.z), 1.0 * uPx, 5.0 * uPx); }`,
      fragmentShader: `uniform float uLight; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(0.75, 0.95, 0.92) * smoothstep(0.5, 0.0, d) * vA * 0.5 * uLight, 1.0); }`,
    }));
    pts.frustumCulled = false; pts.renderOrder = 4;
    grp.add(pts);
  }

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(), P = new THREE.Vector3();
  const place = (g, x, y, z, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) => g.applyMatrix4(M.compose(P.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz)));
  const tube = (pts, r, seg = 12) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), seg, r, 5);

  /* ---------- 海百合：一整片長在海床上 ---------- */
  {
    const H = 3.8, parts = [tube([[0, 0, 0], [0.15, 1.2, 0], [0.05, 2.6, 0.1], [0.2, H, 0]], 0.05, 16)];
    parts.push(place(new THREE.SphereGeometry(0.17, 10, 8), 0.2, H + 0.08, 0, 1, 1.4, 1));
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * PI * 2, c = Math.cos(a), s = Math.sin(a), w = 0.85 + (k % 3) * 0.12;
      parts.push(tube([[0.2, H + 0.1, 0], [0.2 + c * 0.38 * w, H + 0.5, s * 0.38 * w], [0.2 + c * 0.66 * w, H + 1.05, s * 0.66 * w], [0.2 + c * 0.52 * w, H + 1.55, s * 0.52 * w]], 0.024, 8));
    }
    const geo = mergeGeometries(parts);
    for (const [col, n] of [[[0.86, 0.5, 0.34], 34], [[0.8, 0.72, 0.42], 28], [[0.62, 0.36, 0.5], 18]]) {
      const im = new THREE.InstancedMesh(geo, seaMat(col, col, { sway: 1 }), isMobile ? Math.ceil(n / 2) : n);
      for (let i = 0; i < im.count; i++) {
        const x = (Math.random() - 0.5) * 58, z = -34 + Math.random() * 40, sc = 0.65 + Math.random() * 0.85;
        im.setMatrixAt(i, M.compose(P.set(x, FLOOR_Y + floorH(x, z) - 0.05, z), Q.setFromEuler(E.set(0, Math.random() * PI * 2, 0)), S.set(sc, sc, sc)));
      }
      im.frustumCulled = false;
      grp.add(im);
    }
  }

  /* ---------- 三葉蟲：在海床上爬 ---------- */
  const trilos = (() => {
    const parts = [];
    parts.push(place(new THREE.SphereGeometry(0.3, 18, 10, 0, PI * 2, 0, PI / 2), 0, 0, 0.34, 1.08, 0.5, 0.78)); // 頭甲
    parts.push(place(new THREE.SphereGeometry(0.13, 12, 10), 0, 0.1, 0.36, 1, 0.85, 1.35));                     // 頭鞍
    for (const sx of [-1, 1]) {
      parts.push(place(new THREE.SphereGeometry(0.05, 8, 8), sx * 0.17, 0.12, 0.36));                            // 眼
      parts.push(place(new THREE.ConeGeometry(0.045, 0.42, 6), sx * 0.31, 0.02, 0.12, 1, 1, 1, -PI / 2, 0, sx * 0.12)); // 頰刺
      parts.push(place(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4), sx * 0.1, 0.05, 0.78, 1, 1, 1, PI / 2, 0, -sx * 0.35)); // 觸角
    }
    for (let i = 0; i < 10; i++) { // 胸節：中軸一節、左右肋葉各一節
      const z = 0.2 - i * 0.076, w = 0.3 * (1 - 0.035 * i);
      parts.push(place(new THREE.SphereGeometry(1, 10, 8), 0, 0.06, z, w * 0.4, 0.13, 0.05));
      for (const sx of [-1, 1]) parts.push(place(new THREE.SphereGeometry(1, 10, 8), sx * w * 0.66, 0.03, z - 0.012, w * 0.46, 0.065, 0.048, 0, sx * 0.18, 0));
    }
    parts.push(place(new THREE.SphereGeometry(0.2, 14, 10, 0, PI * 2, 0, PI / 2), 0, 0, -0.63, 1, 0.42, 0.95)); // 尾甲
    const n = isMobile ? 7 : 13;
    const im = new THREE.InstancedMesh(mergeGeometries(parts), seaMat([0.5, 0.36, 0.24], [0.36, 0.26, 0.18], { mottle: 1 }), n);
    im.frustumCulled = false;
    grp.add(im);
    const list = Array.from({ length: n }, (_, i) => ({ x: -9 + Math.random() * 18, z: -5 + Math.random() * 11, a: Math.random() * PI * 2, sp: 0.12 + Math.random() * 0.14, sc: 0.9 + Math.random() * 0.7, ph: Math.random() * 9, i }));
    list[0].x = 1.6; list[0].z = 5.6; list[0].a = -2.2; list[0].sc = 1.5; // 一隻就在鏡頭前面
    return { im, list };
  })();

  /* ---------- 直角石：直筒殼的頭足類，當時的頂級掠食者 ---------- */
  const mkOrtho = () => {
    const g = new THREE.Group();
    const shell = new THREE.ConeGeometry(0.44, 5.2, 24, 12);
    shell.rotateZ(PI / 2); shell.translate(-2.6, 0, 0); // 尖端朝後
    g.add(new THREE.Mesh(shell, seaMat([0.8, 0.72, 0.58], [0.6, 0.4, 0.28], { stripe: 15 })));
    const soft = [place(new THREE.SphereGeometry(0.42, 16, 12), 0.25, 0, 0, 1.15, 0.9, 0.9)];
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * PI * 2, c = Math.cos(a), s = Math.sin(a);
      soft.push(tube([[0.55, c * 0.14, s * 0.14], [1.0, c * 0.3, s * 0.3], [1.5, c * 0.34, s * 0.34], [1.95, c * 0.2, s * 0.2]], 0.05, 10));
    }
    g.add(new THREE.Mesh(mergeGeometries(soft), seaMat([0.8, 0.48, 0.36], [0.62, 0.32, 0.26], { mottle: 1 })));
    const eyes = mergeGeometries([place(new THREE.SphereGeometry(0.085, 10, 8), 0.34, 0.1, 0.36), place(new THREE.SphereGeometry(0.085, 10, 8), 0.34, 0.1, -0.36)]);
    g.add(new THREE.Mesh(eyes, seaMat([0.04, 0.04, 0.05])));
    g.traverse((o) => { o.frustumCulled = false; });
    grp.add(g);
    return g;
  };
  const orthos = [
    { g: mkOrtho(), x0: -13, x1: 12, y: -1.9, z: 2.6, sc: 1, dir: 1 },
    { g: mkOrtho(), x0: 18, x1: -14, y: 0.6, z: -9, sc: 0.6, dir: -1 },
    { g: mkOrtho(), x0: -22, x1: 10, y: -2.4, z: -16, sc: 0.75, dir: 1 },
  ];

  /* ---------- 無頜魚：很小的一群 ---------- */
  const fish = (() => {
    const parts = [place(new THREE.SphereGeometry(1, 12, 8), 0, 0, 0, 0.3, 0.11, 0.1), place(new THREE.ConeGeometry(0.09, 0.3, 6), -0.4, 0, 0, 1, 1, 0.3, 0, 0, -PI / 2)];
    const n = isMobile ? 8 : 16;
    const im = new THREE.InstancedMesh(mergeGeometries(parts), seaMat([0.5, 0.6, 0.62], [0.3, 0.36, 0.4], { mottle: 1 }), n);
    im.frustumCulled = false;
    grp.add(im);
    return { im, list: Array.from({ length: n }, () => ({ ox: (Math.random() - 0.5) * 3, oy: (Math.random() - 0.5) * 1.2, oz: (Math.random() - 0.5) * 2.4, ph: Math.random() * 9 })) };
  })();

  let seaT = 0, lastT = 0;
  const fogWarm = new THREE.Color(0.006, 0.085, 0.14), fogCold = new THREE.Color(0.02, 0.045, 0.075);

  // v：這一輪的進度。開著的時候會接管鏡頭
  function update(on, camera, lookAt, v, t) {
    grp.visible = on;
    if (!on) { lastT = t; return; }
    const k = clamp01((v - SEA_IN) / (SEA_OUT - SEA_IN));
    const frozen = sstep(0.58, 0.72, v);
    seaT += Math.min(0.1, Math.max(0, t - lastT)) * (1 - frozen); lastT = t; // 結冰之後一切慢慢停下來
    U.uTime.value = t; U.uSeaT.value = seaT; U.uFrozen.value = frozen;
    U.uLight.value = lerp(0.58, 0.3, frozen);
    U.uFog.value.copy(fogWarm).lerp(fogCold, frozen);

    camera.position.set(SEA_C.x + lerp(-1.6, 1.6, k), SEA_C.y - 2.7 + Math.sin(t * 0.4) * 0.07, SEA_C.z + lerp(10.5, 7.4, k));
    lookAt.set(SEA_C.x + lerp(-3, 2, k), SEA_C.y - 3.3, SEA_C.z);
    camera.lookAt(lookAt);

    for (const tr of trilos.list) {
      const wob = Math.sin(seaT * 0.5 + tr.ph) * 0.5;
      const x = tr.x + Math.sin(tr.a) * tr.sp * seaT, z = tr.z + Math.cos(tr.a) * tr.sp * seaT;
      const xx = ((x + 14) % 28 + 28) % 28 - 14, zz = ((z + 8) % 16 + 16) % 16 - 8;
      trilos.im.setMatrixAt(tr.i, M.compose(P.set(xx, FLOOR_Y + floorH(xx, zz) + 0.02, zz), Q.setFromEuler(E.set(0, tr.a + wob * 0.12, 0)), S.set(tr.sc, tr.sc, tr.sc)));
    }
    trilos.im.instanceMatrix.needsUpdate = true;

    const drop = frozen * frozen;
    orthos.forEach((o, i) => {
      const u = clamp01(k * 1.25 + seaT * 0.004); // 跟著捲動往前游
      o.g.position.set(lerp(o.x0, o.x1, u), o.y + Math.sin(seaT * 0.5 + i * 2) * 0.25 - drop * (3.2 - i * 0.6), o.z);
      o.g.rotation.set(Math.sin(seaT * 0.3 + i) * 0.04, o.dir > 0 ? 0 : PI, (o.dir > 0 ? -1 : 1) * drop * 0.55 + Math.sin(seaT * 0.4 + i) * 0.03);
      o.g.scale.setScalar(o.sc);
    });

    fish.list.forEach((f, i) => {
      const a = seaT * 0.16 + 0.6;
      const cx = Math.cos(a) * 9 - 2, cz = Math.sin(a) * 5 - 4;
      fish.im.setMatrixAt(i, M.compose(
        P.set(cx + f.ox, -3.2 + f.oy + Math.sin(seaT * 1.3 + f.ph) * 0.15 - drop * (1.5 + f.oy), cz + f.oz),
        Q.setFromEuler(E.set(drop * 1.2 * (f.ox > 0 ? 1 : -1), -a - PI / 2 + Math.sin(seaT * 5 + f.ph) * 0.12, 0)), S.set(1, 1, 1)));
    });
    fish.im.instanceMatrix.needsUpdate = true;
  }
  return { update };
}
