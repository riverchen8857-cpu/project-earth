// 第三幕第一輪：穿過大氣、雲層，落到海面，潛進奧陶紀的海裡，看當時的生態，然後結冰。
// 生物都是用程式拼出來的簡單實體模型（直角石、三葉蟲、海百合、無頜魚），大小比例不是真實的。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const PI = Math.PI;

export const SKY_IN = 0.22, SEA_IN = 0.36, SEA_OUT = 0.8; // 這一輪的進度：進大氣層、入水、出水
const SKY_C = new THREE.Vector3(0, -9000, 0);  // 海面上空的場景
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

  // 生物、海床共用的材質：上方來的光、濕潤的反光、水面的光紋、越遠越融進水色。
  // mode 決定表面的花紋：0 斑駁、1 直角石的殼、2 軟體的皮膚、3 甲殼、4 海百合、5 魚
  const seaMat = (c1, c2 = c1, o = {}) => new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...U, uColor: { value: new THREE.Color(...c1) }, uColor2: { value: new THREE.Color(...c2) }, uSway: { value: o.sway || 0 }, uMode: { value: o.mode || 0 }, uSpec: { value: o.spec || 0 },
      uWaveY: { value: o.waveY || 0 }, uWaveZ: { value: o.waveZ || 0 }, uWaveSpd: { value: o.waveSpd || 2.2 } },
    vertexShader: `
      attribute vec2 aAnim; // x：離根部多遠（0～1），y：相位
      uniform float uSeaT, uSway, uFrozen, uWaveY, uWaveZ, uWaveSpd; varying vec3 vW, vN, vL;
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
        float t2 = aAnim.x * aAnim.x, live = 1.0 - uFrozen * 0.85; // 觸手、腕、尾巴的擺動：越末端擺越大
        p.y += sin(uSeaT * uWaveSpd - aAnim.x * 5.5 + aAnim.y + ph) * uWaveY * t2 * live - uFrozen * uWaveY * t2 * 1.6;
        p.z += cos(uSeaT * uWaveSpd * 0.83 - aAnim.x * 4.6 + aAnim.y * 1.7 + ph) * uWaveZ * t2 * live;
        vec4 w = m * vec4(p, 1.0);
        vW = w.xyz; vL = position; vN = normalize(mat3(m) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform vec3 uColor, uColor2, uFog; uniform float uLight, uFrozen, uTime, uMode, uSpec; varying vec3 vW, vN, vL;
      ${NOISE}
      void main(){
        vec3 v = normalize(cameraPosition - vW), n = normalize(vN);
        if (dot(n, v) < 0.0) n = -n;
        vec3 Ld = normalize(vec3(0.25, 1.0, 0.35));
        vec3 col; float shade = 1.0;
        if (uMode < 0.5) { // 斑駁
          col = mix(uColor, uColor2, smoothstep(0.35, 0.65, fbm(vW * 0.7)));
        } else if (uMode < 1.5) { // 直角石的殼：寬窄不一的色帶、細密的生長紋、風化的斑
          float gx = vL.x * 2.6 + (fbm(vL * 2.2) - 0.5) * 0.9;
          float band = 0.5 * vnoise(vec3(gx * 1.9, 3.0, 1.0)) + 0.32 * vnoise(vec3(gx * 6.1, 9.0, 2.0)) + 0.18 * vnoise(vec3(gx * 17.0, 4.0, 6.0));
          band = smoothstep(0.34, 0.66, band + (fbm(vL * 7.0) - 0.5) * 0.25);
          col = mix(uColor, uColor2, band);
          col = mix(col, uColor2 * 0.45, smoothstep(0.6, 0.82, fbm(vL * 5.0 + 3.0)) * 0.55);
          col = mix(col, vec3(0.9, 0.88, 0.8), smoothstep(0.68, 0.85, fbm(vL * 9.0)) * 0.3);
          float ridge = sin(vL.x * 120.0);
          shade = 0.93 + 0.07 * ridge;
          col *= mix(1.0, 0.55, smoothstep(-0.1, 0.0, vL.x)); // 殼口的暗邊
        } else if (uMode < 2.5) { // 軟體：紅褐色的斑駁、淺色的斑點、腹面較淡
          col = mix(uColor, uColor2, smoothstep(0.3, 0.7, fbm(vL * 6.0)));
          col = mix(col, vec3(0.95, 0.82, 0.72), smoothstep(0.7, 0.8, vnoise(vL * 26.0)) * 0.6);
          col = mix(col, vec3(0.92, 0.78, 0.7), smoothstep(0.1, -0.7, vN.y) * 0.45);
        } else if (uMode < 3.5) { // 甲殼
          col = mix(uColor, uColor2, smoothstep(0.3, 0.7, fbm(vL * 9.0)));
          col *= 0.8 + 0.4 * vnoise(vL * 40.0);
        } else if (uMode < 4.5) { // 海百合：莖是一節一節的，往上到腕的顏色比較鮮豔
          float up = smoothstep(3.4, 4.6, vL.y);
          col = mix(uColor2, uColor, up);
          col *= mix(0.78 + 0.22 * step(0.5, fract(vL.y * 7.0)), 1.0, up);
          col *= 0.85 + 0.3 * fbm(vL * 8.0);
        } else { // 魚：背深腹淺、細鱗
          col = mix(uColor2, uColor, smoothstep(-0.4, 0.6, vN.y));
          col *= 0.9 + 0.1 * sin(vL.x * 150.0) * sin(vL.y * 190.0 + vL.z * 130.0);
          col *= 0.85 + 0.3 * fbm(vL * 14.0);
        }
        float diff = 0.26 + 0.74 * max(dot(n, Ld), 0.0);
        float ca = pow(vnoise(vec3(vW.xz * 0.9, uTime * 0.6)), 3.0) * max(n.y, 0.0) * 1.1 * (1.0 - uFrozen);
        col *= diff * shade * (1.0 + ca) * uLight;
        col += vec3(0.9, 1.0, 0.95) * pow(max(dot(reflect(-Ld, n), v), 0.0), 26.0) * uSpec * uLight * 0.6;
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
    grp.add(new THREE.Mesh(g, seaMat([0.34, 0.32, 0.25], [0.19, 0.2, 0.18])));
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
  // 會變細的管子（觸手、腕、莖）。每個頂點帶著「離根部多遠」和相位，給材質做擺動
  const taperTube = (pts, r0, r1, seg = 14, rad = 6, ph = 0, t0 = 0, t1 = 1) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)));
    const fr = curve.computeFrenetFrames(seg, false);
    const pos = [], nor = [], uv = [], anim = [], idx = [];
    for (let a = 0; a <= seg; a++) {
      const u = a / seg, c = curve.getPointAt(u), r = lerp(r0, r1, u), N = fr.normals[a], Bn = fr.binormals[a];
      for (let b = 0; b <= rad; b++) {
        const an = (b / rad) * PI * 2, cs = Math.cos(an), sn = Math.sin(an);
        const nx = cs * N.x + sn * Bn.x, ny = cs * N.y + sn * Bn.y, nz = cs * N.z + sn * Bn.z;
        pos.push(c.x + r * nx, c.y + r * ny, c.z + r * nz); nor.push(nx, ny, nz); uv.push(u, b / rad); anim.push(lerp(t0, t1, u), ph);
      }
    }
    for (let a = 0; a < seg; a++) for (let b = 0; b < rad; b++) { const k = a * (rad + 1) + b, l = k + rad + 1; idx.push(k, l, k + 1, l, l + 1, k + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aAnim', new THREE.Float32BufferAttribute(anim, 2));
    g.setIndex(idx);
    return g;
  };
  const merge = (parts) => { // 沒有擺動資料的零件補上 0
    for (const g of parts) if (!g.attributes.aAnim) g.setAttribute('aAnim', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    return mergeGeometries(parts);
  };
  const one = (g) => merge([g]);

  /* ---------- 海百合：節狀的莖、杯狀的萼、一圈帶羽枝的腕 ---------- */
  {
    const H = 3.8, TOP = [0.2, H + 0.12, 0];
    const parts = [taperTube([[0, 0, 0], [0.15, 1.2, 0], [0.05, 2.6, 0.1], [0.2, H, 0]], 0.06, 0.045, 22, 6, 0, 0, 0)];
    for (let k = 0; k < 5; k++) { const a = (k / 5) * PI * 2 + 0.3; parts.push(taperTube([[0, 0.12, 0], [Math.cos(a) * 0.22, 0.03, Math.sin(a) * 0.22], [Math.cos(a) * 0.42, -0.04, Math.sin(a) * 0.42]], 0.04, 0.012, 4, 5, 0, 0, 0)); } // 固著的根
    parts.push(place(new THREE.SphereGeometry(0.19, 12, 10), TOP[0], H + 0.1, 0, 1, 1.35, 1)); // 萼
    const NA = 14, tmp = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3();
    for (let k = 0; k < NA; k++) {
      const a = (k / NA) * PI * 2, c = Math.cos(a), sn = Math.sin(a), w = 0.85 + (k % 3) * 0.14, ph = k * 1.3;
      const pts = [TOP, [TOP[0] + c * 0.3 * w, H + 0.5, sn * 0.3 * w], [TOP[0] + c * 0.66 * w, H + 1.05, sn * 0.66 * w], [TOP[0] + c * 0.8 * w, H + 1.7, sn * 0.8 * w], [TOP[0] + c * 0.6 * w, H + 2.25, sn * 0.6 * w]];
      parts.push(taperTube(pts, 0.03, 0.008, 12, 5, ph, 0, 0.5));
      const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)));
      for (let q = 2; q <= 13; q++) { // 羽枝：沿著腕往兩側長的細毛
        const u = q / 14; curve.getPointAt(u, tmp); curve.getTangentAt(u, tan);
        side.set(-sn, 0, c);
        for (const sg of [-1, 1]) {
          const L = 0.24 * (1 - u * 0.45);
          parts.push(taperTube([[tmp.x, tmp.y, tmp.z], [tmp.x + (side.x * sg * 0.7 + tan.x * 0.5) * L, tmp.y + tan.y * 0.5 * L + 0.02, tmp.z + (side.z * sg * 0.7 + tan.z * 0.5) * L]], 0.009, 0.002, 1, 3, ph, u * 0.5, u * 0.5));
        }
      }
    }
    const geo = merge(parts);
    for (const [top, stalk, n] of [[[0.95, 0.5, 0.26], [0.5, 0.36, 0.26], 34], [[0.9, 0.78, 0.36], [0.46, 0.4, 0.28], 28], [[0.7, 0.34, 0.56], [0.4, 0.3, 0.32], 18]]) {
      const im = new THREE.InstancedMesh(geo, seaMat(top, stalk, { sway: 1, mode: 4, waveY: 0.5, waveZ: 0.35, waveSpd: 1.1 }), isMobile ? Math.ceil(n / 2) : n);
      for (let i = 0; i < im.count; i++) {
        const x = (Math.random() - 0.5) * 58, z = -34 + Math.random() * 40, sc = 0.65 + Math.random() * 0.85;
        im.setMatrixAt(i, M.compose(P.set(x, FLOOR_Y + floorH(x, z) - 0.05, z), Q.setFromEuler(E.set(0, Math.random() * PI * 2, 0)), S.set(sc, sc, sc)));
      }
      im.frustumCulled = false;
      grp.add(im);
    }
  }

  /* ---------- 海床上的腕足類與石塊 ---------- */
  {
    const shell = merge([place(new THREE.SphereGeometry(1, 14, 8, 0, PI * 2, 0, PI / 2), 0, 0, 0, 0.16, 0.07, 0.13)]);
    const n = isMobile ? 70 : 170;
    const im = new THREE.InstancedMesh(shell, seaMat([0.72, 0.66, 0.52], [0.46, 0.4, 0.32], { mode: 3, spec: 0.3 }), n);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 30, z = -14 + Math.random() * 24, sc = 0.6 + Math.random() * 1.2;
      im.setMatrixAt(i, M.compose(P.set(x, FLOOR_Y + floorH(x, z) + 0.0, z), Q.setFromEuler(E.set((Math.random() - 0.5) * 0.4, Math.random() * PI * 2, (Math.random() - 0.5) * 0.4)), S.set(sc, sc, sc)));
    }
    im.frustumCulled = false; grp.add(im);
    const rock = new THREE.SphereGeometry(1, 18, 12), rp = rock.attributes.position;
    for (let i = 0; i < rp.count; i++) { const k = 1 + Math.sin(rp.getX(i) * 3.1) * 0.14 + Math.cos(rp.getY(i) * 4.3 + rp.getZ(i) * 2.2) * 0.14; rp.setXYZ(i, rp.getX(i) * k, rp.getY(i) * k * 0.6, rp.getZ(i) * k); }
    rock.computeVertexNormals();
    const rm = new THREE.InstancedMesh(one(rock), seaMat([0.3, 0.3, 0.27], [0.16, 0.18, 0.17]), 26);
    for (let i = 0; i < 26; i++) {
      const x = (Math.random() - 0.5) * 50, z = -30 + Math.random() * 38, sc = 0.3 + Math.random() * 1.1;
      rm.setMatrixAt(i, M.compose(P.set(x, FLOOR_Y + floorH(x, z) - 0.1, z), Q.setFromEuler(E.set(0, Math.random() * PI * 2, 0)), S.set(sc, sc, sc)));
    }
    rm.frustumCulled = false; grp.add(rm);
  }

  /* ---------- 三葉蟲：在海床上爬 ---------- */
  const trilos = (() => {
    const parts = [];
    parts.push(place(new THREE.SphereGeometry(0.3, 22, 12, 0, PI * 2, 0, PI / 2), 0, 0, 0.34, 1.08, 0.5, 0.78)); // 頭甲
    parts.push(place(new THREE.SphereGeometry(0.13, 14, 10), 0, 0.1, 0.36, 1, 0.85, 1.35));                     // 頭鞍
    for (let k = 0; k < 3; k++) parts.push(place(new THREE.TorusGeometry(0.105, 0.012, 5, 14, PI), 0, 0.13, 0.3 + k * 0.07, 1, 0.75, 1, -PI / 2.6, 0, 0)); // 頭鞍溝
    for (const sx of [-1, 1]) {
      parts.push(place(new THREE.SphereGeometry(0.055, 10, 8), sx * 0.17, 0.115, 0.35, 0.8, 1, 1.5));            // 新月形的複眼
      parts.push(place(new THREE.ConeGeometry(0.045, 0.5, 6), sx * 0.32, 0.02, 0.08, 1, 1, 1, -PI / 2, 0, sx * 0.1)); // 頰刺
      parts.push(taperTube([[sx * 0.08, 0.04, 0.6], [sx * 0.16, 0.06, 0.85], [sx * 0.3, 0.04, 1.1]], 0.009, 0.003, 5, 4, sx, 0, 1)); // 觸角
    }
    for (let i = 0; i < 11; i++) { // 胸節：中軸一節、左右肋葉各一節、末端一根刺
      const z = 0.21 - i * 0.07, w = 0.3 * (1 - 0.034 * i);
      parts.push(place(new THREE.SphereGeometry(1, 10, 8), 0, 0.065, z, w * 0.4, 0.13, 0.044));
      for (const sx of [-1, 1]) {
        parts.push(place(new THREE.SphereGeometry(1, 10, 8), sx * w * 0.66, 0.03, z - 0.012, w * 0.46, 0.062, 0.042, 0, sx * 0.18, 0));
        parts.push(place(new THREE.ConeGeometry(0.018, 0.13, 4), sx * (w * 1.1 + 0.02), 0.01, z - 0.045, 1, 1, 1, -PI / 2, 0, sx * 0.9));
      }
    }
    parts.push(place(new THREE.SphereGeometry(0.2, 16, 10, 0, PI * 2, 0, PI / 2), 0, 0, -0.63, 1, 0.42, 0.95)); // 尾甲
    for (let k = 0; k < 4; k++) parts.push(place(new THREE.TorusGeometry(0.06 + k * 0.035, 0.008, 4, 12, PI), 0, 0.03 + (3 - k) * 0.012, -0.6, 1, 1, 1, PI / 2.4, 0, PI));
    const n = isMobile ? 7 : 13;
    const im = new THREE.InstancedMesh(merge(parts), seaMat([0.42, 0.29, 0.18], [0.24, 0.17, 0.12], { mode: 3, spec: 0.7, waveY: 0.06, waveZ: 0.05, waveSpd: 3 }), n);
    im.frustumCulled = false;
    grp.add(im);
    const list = Array.from({ length: n }, (_, i) => ({ x: -9 + Math.random() * 18, z: -5 + Math.random() * 11, a: Math.random() * PI * 2, sp: 0.12 + Math.random() * 0.14, sc: 0.9 + Math.random() * 0.7, ph: Math.random() * 9, i }));
    list[0].x = 1.6; list[0].z = 5.6; list[0].a = -2.2; list[0].sc = 1.5; // 一隻就在鏡頭前面
    return { im, list };
  })();

  /* ---------- 直角石：直筒殼的頭足類，當時的頂級掠食者 ---------- */
  const mkOrtho = () => {
    const g = new THREE.Group();
    const shell = new THREE.ConeGeometry(0.46, 5.2, 40, 48, true);
    shell.rotateZ(PI / 2); shell.translate(-2.6, 0, 0); // 尖端朝後，殼口在 x = 0
    g.add(new THREE.Mesh(one(shell), seaMat([0.86, 0.8, 0.66], [0.5, 0.3, 0.17], { mode: 1, spec: 0.5 })));
    const soft = [
      place(new THREE.SphereGeometry(0.43, 20, 14), 0.22, -0.03, 0, 1.25, 0.88, 0.9),   // 頭
      place(new THREE.SphereGeometry(0.47, 20, 12), 0.06, 0.17, 0, 1.0, 0.58, 0.97),    // 頭巾
      taperTube([[0.2, -0.3, 0], [0.5, -0.42, 0], [0.78, -0.4, 0]], 0.1, 0.06, 5, 8, 0, 0, 0),    // 漏斗
    ];
    for (let k = 0; k < 10; k++) { // 十條觸手：從口的周圍往前伸，末端往內捲
      const a = (k / 10) * PI * 2 + 0.3, c = Math.cos(a), s = Math.sin(a), L = 1.0 + (k % 3) * 0.14;
      soft.push(taperTube([[0.6, c * 0.14, s * 0.14], [0.6 + 0.55 * L, c * 0.3, s * 0.3], [0.6 + 1.15 * L, c * 0.4, s * 0.4], [0.6 + 1.7 * L, c * 0.3, s * 0.3], [0.6 + 2.0 * L, c * 0.14 - 0.06, s * 0.14]], 0.085, 0.012, 22, 7, k * 1.7, 0.05, 1));
    }
    g.add(new THREE.Mesh(merge(soft), seaMat([0.74, 0.4, 0.3], [0.48, 0.22, 0.17], { mode: 2, spec: 0.9, waveY: 0.3, waveZ: 0.26, waveSpd: 1.8 })));
    g.add(new THREE.Mesh(merge([-1, 1].map((sz) => place(new THREE.SphereGeometry(0.115, 14, 10), 0.4, 0.07, sz * 0.33))), seaMat([0.82, 0.68, 0.3], [0.6, 0.45, 0.2], { mode: 3, spec: 1.5 }))); // 眼
    g.add(new THREE.Mesh(merge([-1, 1].map((sz) => place(new THREE.SphereGeometry(0.07, 12, 8), 0.41, 0.07, sz * 0.385, 1, 1, 0.6))), seaMat([0.02, 0.02, 0.025], [0.02, 0.02, 0.025], { spec: 2.5 }))); // 瞳孔
    g.traverse((o) => { o.frustumCulled = false; });
    grp.add(g);
    return g;
  };
  const orthos = [
    { g: mkOrtho(), x0: -13, x1: 12, y: -1.9, z: 2.6, sc: 1, dir: 1 },
    { g: mkOrtho(), x0: 18, x1: -14, y: 0.6, z: -9, sc: 0.6, dir: -1 },
    { g: mkOrtho(), x0: -22, x1: 10, y: -2.4, z: -16, sc: 0.75, dir: 1 },
  ];

  /* ---------- 無頜魚：頭部有骨甲、沒有下巴，很小的一群 ---------- */
  const fish = (() => {
    const parts = [
      place(new THREE.SphereGeometry(1, 16, 10), -0.05, 0, 0, 0.34, 0.12, 0.1),           // 身體
      place(new THREE.SphereGeometry(1, 14, 10), 0.14, 0, 0, 0.2, 0.135, 0.125),           // 頭甲
      place(new THREE.SphereGeometry(1, 10, 8), -0.46, 0, 0, 0.13, 0.15, 0.012),           // 尾鰭
    ];
    for (const sz of [-1, 1]) parts.push(place(new THREE.SphereGeometry(0.02, 6, 6), 0.3, 0.02, sz * 0.06));
    const geo = merge(parts), gp = geo.attributes.position, an = geo.attributes.aAnim;
    for (let i = 0; i < gp.count; i++) an.setX(i, clamp01((0.12 - gp.getX(i)) / 0.6)); // 越靠尾巴擺越大
    const n = isMobile ? 8 : 16;
    const im = new THREE.InstancedMesh(geo, seaMat([0.3, 0.36, 0.38], [0.66, 0.7, 0.66], { mode: 5, spec: 0.8, waveZ: 0.16, waveSpd: 9 }), n);
    im.frustumCulled = false;
    grp.add(im);
    return { im, list: Array.from({ length: n }, () => ({ ox: (Math.random() - 0.5) * 3, oy: (Math.random() - 0.5) * 1.2, oz: (Math.random() - 0.5) * 2.4, ph: Math.random() * 9 })) };
  })();

  /* ====================== 海面上空：大氣 → 雲層 → 海面 ====================== */
  const sky = new THREE.Group();
  sky.visible = false;
  scene.add(sky);
  const SUN = new THREE.Vector3(0.35, 0.5, -0.8).normalize();
  const SU = { uTime: U.uTime, uAlt: { value: 1 }, uHorizon: { value: new THREE.Color() }, uSun: { value: SUN } };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(6500, 48, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: SU,
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uHorizon, uSun; uniform float uAlt; varying vec3 vD;
      void main(){
        vec3 d = normalize(vD);
        vec3 zen = mix(vec3(0.1, 0.3, 0.62), vec3(0.004, 0.012, 0.05), uAlt); // 越高，頭頂越接近太空的黑
        vec3 col = mix(uHorizon, zen, pow(smoothstep(0.0, 0.85, d.y), 0.55));
        float s = max(dot(d, uSun), 0.0);
        col += vec3(1.0, 0.95, 0.85) * (pow(s, 900.0) * 3.0 + pow(s, 24.0) * 0.28);
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  dome.renderOrder = -10; dome.frustumCulled = false;
  sky.add(dome);
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(13000, 13000), new THREE.ShaderMaterial({
    uniforms: SU,
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform vec3 uHorizon, uSun; uniform float uTime; varying vec3 vW;
      ${NOISE}
      float h(vec2 q){ return fbm(vec3(q * 0.045, uTime * 0.3)) + fbm(vec3(q * 0.2 + 7.0, uTime * 0.55)) * 0.3; }
      void main(){
        vec3 V = normalize(cameraPosition - vW); float d = distance(cameraPosition, vW);
        float e = 0.6 + d * 0.006; vec2 q = vW.xz;
        float h0 = h(q), hx = h(q + vec2(e, 0.0)), hz = h(q + vec2(0.0, e));
        vec3 n = normalize(vec3(-(hx - h0) / e * 2.2, 1.0, -(hz - h0) / e * 2.2));
        n = normalize(mix(n, vec3(0.0, 1.0, 0.0), smoothstep(150.0, 2600.0, d) * 0.85));
        float fr = pow(1.0 - max(dot(n, V), 0.0), 4.0);
        vec3 col = mix(vec3(0.006, 0.06, 0.15), uHorizon, 0.06 + 0.85 * fr);
        col += vec3(1.0, 0.95, 0.85) * pow(max(dot(reflect(-V, n), uSun), 0.0), 160.0) * 1.6;
        col += vec3(0.9) * smoothstep(0.78, 0.9, h0) * smoothstep(900.0, 40.0, d) * 0.25; // 近看才有的浪花
        col = mix(col, uHorizon, 1.0 - exp(-d * 0.00042));
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  ocean.rotation.x = -PI / 2; ocean.frustumCulled = false;
  sky.add(ocean);
  const cloudMat = (scale, cover, alpha) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { ...SU, uScale: { value: scale }, uCover: { value: cover }, uA: { value: alpha } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      uniform vec3 uHorizon; uniform float uTime, uScale, uCover, uA; varying vec3 vW;
      ${NOISE}
      void main(){
        vec2 q = vW.xz * uScale + uTime * 0.004;
        float n = fbm(vec3(q, 1.0)) + fbm(vec3(q * 3.7, 5.0)) * 0.28;
        float a = smoothstep(uCover, uCover + 0.2, n);
        float lum = 0.52 + 0.3 * smoothstep(uCover, uCover + 0.35, n) - 0.14 * fbm(vec3(q * 9.0, 2.0));
        float d = distance(cameraPosition, vW);
        vec3 col = mix(vec3(lum), uHorizon, 1.0 - exp(-d * 0.00035));
        gl_FragColor = vec4(col, a * uA * exp(-d * 0.00012));
      }`,
  });
  const CLOUD_Y = 330;
  const clouds = [[CLOUD_Y, 0.0016, 0.5, 0.96], [CLOUD_Y + 26, 0.0022, 0.56, 0.7], [130, 0.004, 0.66, 0.6]].map(([y, sc, cv, al], i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(13000, 13000), cloudMat(sc, cv, al));
    m.rotation.x = -PI / 2; m.userData.y = y; m.renderOrder = 2 + i; m.frustumCulled = false;
    sky.add(m);
    return m;
  });
  const horHigh = new THREE.Color(0.2, 0.4, 0.72), horLow = new THREE.Color(0.46, 0.64, 0.8);

  /* ---------- 入水時的氣泡 ---------- */
  const bubbles = (() => {
    const n = 260, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos.set([(Math.random() - 0.5) * 7, Math.random() * 9, (Math.random() - 0.5) * 6], i * 3); seed[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const pts = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: U.uTime, uAlpha: { value: 0 }, uPx: { value: PX } },
      vertexShader: `attribute float aSeed; uniform float uTime, uPx;
        void main(){ vec3 p = position; p.y = mod(p.y + uTime * (2.0 + aSeed * 3.0), 9.0) - 4.5; p.x += sin(uTime * 3.0 + aSeed * 40.0) * 0.12;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(uPx * (2.0 + aSeed * 5.0) * (7.0 / -mv.z), 1.5 * uPx, 22.0 * uPx); }`,
      fragmentShader: `uniform float uAlpha; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float ring = smoothstep(1.0, 0.8, d) * (0.25 + 0.75 * smoothstep(0.55, 0.9, d)); gl_FragColor = vec4(vec3(0.75, 0.95, 1.0) * ring * uAlpha, 1.0); }`,
    }));
    pts.frustumCulled = false; pts.renderOrder = 6;
    grp.add(pts);
    return pts;
  })();

  let seaT = 0, lastT = 0;
  const fogWarm = new THREE.Color(0.006, 0.085, 0.14), fogCold = new THREE.Color(0.02, 0.045, 0.075);

  // v：這一輪的進度。回傳 on（有沒有接管鏡頭）、white（穿過雲層或入水時的白霧）
  const out = { on: false, white: 0 };
  function update(v, t, camera, lookAt) {
    const inSky = v > SKY_IN && v <= SEA_IN, inSea = v > SEA_IN && v < SEA_OUT;
    sky.visible = inSky; grp.visible = inSea;
    out.on = inSky || inSea; out.white = 0;
    U.uTime.value = t;
    if (inSky) { // 從高空一路往下：越低天越藍、海面的細節越清楚，中途穿過雲層
      const s = (v - SKY_IN) / (SEA_IN - SKY_IN);
      const alt = 5 + 1700 * Math.pow(1 - s, 2.4) - sstep(0.93, 1, s) * 6;
      const cx = SKY_C.x, cy = SKY_C.y + alt, cz = SKY_C.z - s * 1100;
      camera.position.set(cx, cy, cz);
      const down = lerp(1.9, 0.16, sstep(0.0, 0.8, s)) + sstep(0.9, 1, s) * 0.9; // 一開始往下看，接近海面時抬平，最後一頭栽進水裡
      lookAt.set(cx, cy - down, cz - 1);
      camera.lookAt(lookAt);
      SU.uAlt.value = clamp01(alt / 1500);
      SU.uHorizon.value.copy(horLow).lerp(horHigh, SU.uAlt.value);
      dome.position.copy(camera.position);
      ocean.position.set(cx, SKY_C.y, cz);
      for (const c of clouds) c.position.set(cx, SKY_C.y + c.userData.y, cz);
      out.white = Math.exp(-Math.pow((alt - CLOUD_Y - 13) / 55, 2)) * 0.92 + sstep(0.975, 1, s) * 0.8;
      lastT = t;
      return out;
    }
    if (!inSea) { lastT = t; return out; }
    const k = clamp01((v - SEA_IN) / (SEA_OUT - SEA_IN));
    const frozen = sstep(0.62, 0.74, v);
    seaT += Math.min(0.1, Math.max(0, t - lastT)) * (1 - frozen); lastT = t; // 結冰之後一切慢慢停下來
    U.uSeaT.value = seaT; U.uFrozen.value = frozen;
    U.uLight.value = lerp(0.58, 0.3, frozen);
    U.uFog.value.copy(fogWarm).lerp(fogCold, frozen);

    const sink = 1 - sstep(0.0, 0.16, k); // 剛入水：從海面往下沉到海床附近
    camera.position.set(SEA_C.x + lerp(-1.6, 1.6, k), SEA_C.y - 2.7 + sink * sink * 9 + Math.sin(t * 0.4) * 0.07, SEA_C.z + lerp(10.5, 7.4, k));
    lookAt.set(SEA_C.x + lerp(-3, 2, k), SEA_C.y - 3.3 + sink * 2.5, SEA_C.z);
    camera.lookAt(lookAt);
    out.white = (1 - sstep(0.0, 0.03, k)) * 0.8;
    bubbles.material.uniforms.uAlpha.value = (1 - sstep(0.02, 0.14, k)) * 0.8;
    bubbles.visible = bubbles.material.uniforms.uAlpha.value > 0.003;
    bubbles.position.copy(camera.position).sub(SEA_C).add(P.set(0, 0, -3.5));

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
    return out;
  }
  return { update };
}
