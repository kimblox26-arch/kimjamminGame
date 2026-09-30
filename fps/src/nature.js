// 자연 환경 — 바람에 흔들리는 풀·꽃·덤불·나무(잎 카드), 펄럭이는 국기, 새 떼, 돌풍
import * as THREE from 'three';
import { terrainH, grassK } from './world.js';
import { WIND } from './human.js';
import { fbm } from './textures.js';
import { Audio } from './audio.js';
import { rand, clamp } from './core.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ── 바람 셰이더 (인스턴스 위치로 위상, 높이² 로 휨) ──
function windPatch(mat, { amp = 0.2, freq = 1.8, hRef = 0.6, key, normalUp = false }) {
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, { uWind: WIND.dir, uWS: WIND.strength, uTime: WIND.time });
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform vec3 uWind; uniform float uWS; uniform float uTime;')
      .replace('#include <project_vertex>', `
        vec4 mvPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
        vec3 ip = instanceMatrix[3].xyz;
        #else
        vec3 ip = vec3(0.0);
        #endif
        vec3 wp0 = (modelMatrix * mvPosition).xyz;
        float hk = clamp(position.y / ${hRef.toFixed(3)}, 0.0, 1.4);
        float ph = uTime * ${freq.toFixed(3)} + wp0.x * 0.23 + wp0.z * 0.19 + ip.x * 0.05;
        float gust = 0.55 + 0.45 * sin(uTime * 0.45 + wp0.x * 0.021 - wp0.z * 0.017);
        float sw = (0.55 + 0.45 * sin(ph) + 0.18 * sin(ph * 2.7 + 1.3)) * uWS * gust;
        vec3 wd = normalize(vec3(uWind.x, 0.0, uWind.z));
        mvPosition.xyz += (wd * sw + vec3(-wd.z, 0.0, wd.x) * 0.25 * sin(ph * 1.7)) * hk * hk * ${amp.toFixed(3)};
        mvPosition.y -= sw * sw * hk * hk * ${(amp * 0.15).toFixed(3)};
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
  };
  mat.customProgramCacheKey = () => 'wind-' + key;
  return mat;
}

// ── 캔버스 텍스처: 활엽 잎 뭉치 / 침엽 가지 ──
function leafTex() {
  const W = 256, c = document.createElement('canvas'); c.width = c.height = W;
  const x = c.getContext('2d');
  for (let i = 0; i < 90; i++) {
    const px = W / 2 + rand(-1, 1) * W * 0.38, py = W / 2 + rand(-1, 1) * W * 0.38;
    if (Math.hypot(px - W / 2, py - W / 2) > W * 0.44) continue;
    const L = rand(16, 30), a = rand(0, Math.PI * 2), g = rand(0.7, 1.15);
    x.save(); x.translate(px, py); x.rotate(a);
    x.fillStyle = `rgb(${Math.round(70 * g)},${Math.round(105 * g)},${Math.round(38 * g)})`;
    x.beginPath(); x.moveTo(-L, 0); x.quadraticCurveTo(0, -L * 0.42, L, 0); x.quadraticCurveTo(0, L * 0.42, -L, 0); x.fill();
    x.strokeStyle = `rgba(150,170,90,0.5)`; x.lineWidth = 1; x.beginPath(); x.moveTo(-L, 0); x.lineTo(L, 0); x.stroke();
    x.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function needleTex() {
  const W = 256, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.strokeStyle = 'rgb(60,45,30)'; x.lineWidth = 3; x.beginPath(); x.moveTo(4, H / 2); x.lineTo(W - 6, H / 2); x.stroke();
  for (let i = 0; i < 420; i++) {
    const u = rand(0.02, 0.97), px = u * W, s = Math.random() < 0.5 ? -1 : 1, L = (1 - u * 0.55) * rand(26, 50), a = rand(0.5, 1.1);
    const g = rand(0.75, 1.2);
    x.strokeStyle = `rgb(${Math.round(34 * g)},${Math.round(62 * g)},${Math.round(36 * g)})`; x.lineWidth = rand(1.2, 2.2);
    x.beginPath(); x.moveTo(px, H / 2); x.lineTo(px + Math.cos(a) * L * 0.6, H / 2 + s * Math.sin(a) * L); x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function barkTex() {
  const W = 128, c = document.createElement('canvas'); c.width = c.height = W;
  const x = c.getContext('2d'), im = x.createImageData(W, W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const n = fbm(i / W, j / W * 0.25, 8, 4), r = fbm(i / W * 3, j / W, 4, 2);
    const k = 0.55 + n * 0.6 - (Math.abs(Math.sin(i / W * Math.PI * 10 + r * 4)) < 0.15 ? 0.3 : 0);
    const o = (j * W + i) * 4; im.data[o] = 88 * k; im.data[o + 1] = 70 * k; im.data[o + 2] = 54 * k; im.data[o + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ── 지오메트리 헬퍼 ──
function merge(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  let v = 0, k = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, v * 3); nor.set(g.attributes.normal.array, v * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, v * 2);
    if (g.attributes.color) col.set(g.attributes.color.array, v * 3); else col.fill(1, v * 3, (v + n) * 3);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[k++] = g.index.array[i] + v; else for (let i = 0; i < n; i++) idx[k++] = i + v;
    v += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
const tint = (g, r, gg, b) => { const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; };

// 풀 한 포기(여러 잎) — 법선은 위쪽으로 기울여 부드러운 조명
function grassClump(blades, hMin, hMax, flower) {
  const pos = [], nor = [], col = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const a = rand(0, Math.PI * 2), r = rand(0, 0.09), bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const H = rand(hMin, hMax), W = rand(0.008, 0.016), lean = rand(0.1, 0.45), la = rand(0, Math.PI * 2), rot = rand(0, Math.PI);
    const lx = Math.cos(la), lz = Math.sin(la), wx = Math.cos(rot), wz = Math.sin(rot);
    const v0 = pos.length / 3, S = 3;
    const dry = Math.random() < 0.12;
    for (let i = 0; i <= S; i++) {
      const t = i / S, w = W * (1 - t * 0.92), y = H * t, off = lean * H * t * t;
      for (const sd of [-1, 1]) {
        pos.push(bx + lx * off + wx * w * sd, y, bz + lz * off + wz * w * sd);
        const n = V(-wz * sd * 0.3 + lx * 0.2, 1, wx * sd * 0.3 + lz * 0.2).normalize(); nor.push(n.x, n.y, n.z);
        const k = 0.35 + t * 0.75;
        if (dry) col.push(0.42 * k + 0.1, 0.36 * k + 0.06, 0.12 * k); else col.push(0.13 * k + 0.02, 0.24 * k + 0.03, 0.05 * k + 0.01);
      }
      if (i < S) { const o = v0 + i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    }
    if (flower && b < 2) { // 꽃 머리 (작은 십자 쿼드)
      const tx = bx + lx * lean * H, tz = bz + lz * lean * H, s = 0.018;
      const fc = flower === 1 ? [0.9, 0.85, 0.15] : [0.92, 0.92, 0.88];
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const q = pos.length / 3;
        pos.push(tx - dx * s, H - s, tz - dz * s, tx + dx * s, H - s, tz + dz * s, tx + dx * s, H + s, tz + dz * s, tx - dx * s, H + s, tz - dz * s);
        for (let i = 0; i < 4; i++) { nor.push(0, 1, 0); col.push(...fc); }
        idx.push(q, q + 1, q + 2, q, q + 2, q + 3);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
  g.setIndex(idx);
  return g;
}

// 잎 카드 묶음 (구형 법선) — 캐노피 중심 c, 반경 R
function cardCloud(n, c, R, sz, { droop = 0, flat = 0.7, shade = 1 } = {}) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const u = V(rand(-1, 1), rand(-1, 1) * flat, rand(-1, 1)); if (u.length() > 1) { i--; continue; }
    const p = c.clone().addScaledVector(u, R);
    const g = new THREE.PlaneGeometry(sz * rand(0.8, 1.2), sz * rand(0.8, 1.2));
    g.rotateX(rand(-1.4, 1.4) - droop); g.rotateY(rand(0, Math.PI * 2)); g.translate(p.x, p.y, p.z);
    const nn = g.attributes.normal, pp = g.attributes.position;
    for (let k = 0; k < pp.count; k++) { const d = V(pp.getX(k) - c.x, (pp.getY(k) - c.y) * 1.3, pp.getZ(k) - c.z).normalize(); nn.setXYZ(k, d.x, d.y, d.z); }
    const ao = (0.45 + 0.55 * clamp(u.length() * 0.8 + (u.y + 1) * 0.25, 0, 1)) * shade;
    tint(g, ao, ao, ao);
    list.push(g);
  }
  return list;
}

function branchCyl(a, b, r0, r1) {
  const d = b.clone().sub(a), L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, 7, 1, true);
  g.translate(0, L / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r0 * 8, uv.getY(i) * L);
  return g;
}

// 활엽수: 줄기 + 가지 + 잎 카드 캐노피
function broadleaf(H) {
  const bark = [], leaves = [];
  const top = V(rand(-0.4, 0.4), H * 0.55, rand(-0.4, 0.4));
  bark.push(branchCyl(V(0, -0.3, 0), top, 0.28 * H / 10, 0.16 * H / 10));
  const blobs = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rand(-0.4, 0.4), L = H * rand(0.22, 0.34);
    const e = top.clone().add(V(Math.cos(a) * L, H * rand(0.12, 0.32), Math.sin(a) * L));
    bark.push(branchCyl(top.clone().add(V(0, rand(-0.6, 0.3), 0)), e, 0.1 * H / 10, 0.04 * H / 10));
    blobs.push(e);
  }
  blobs.push(top.clone().add(V(0, H * 0.38, 0)));
  for (const b of blobs) leaves.push(...cardCloud(26, b, H * rand(0.17, 0.23), H * 0.16, { flat: 0.75 }));
  return { bark: merge(bark), leaves: merge(leaves) };
}
// 침엽수: 줄기 + 층층 가지 카드(아래로 처짐)
function pine(H) {
  const bark = [branchCyl(V(0, -0.3, 0), V(0, H, 0), 0.24 * H / 12, 0.03)], leaves = [];
  const tiers = Math.round(rand(9, 12));
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1), y = H * (0.22 + f * 0.74), L = H * (0.36 - f * 0.3) + 0.25, n = Math.round(7 + (1 - f) * 7);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.3, 0.3) + t * 0.7, droop = rand(0.25, 0.55) - f * 0.2;
      const g = new THREE.PlaneGeometry(L, L * 0.5);
      g.translate(L / 2, 0, 0);
      g.rotateX(rand(-0.5, 0.5) + Math.PI / 2 * (Math.random() < 0.5 ? 0 : 1) * 0.35);
      g.rotateZ(-droop); g.rotateY(-a); g.translate(0, y, 0);
      const nn = g.attributes.normal, pp = g.attributes.position;
      for (let k = 0; k < pp.count; k++) { const d = V(pp.getX(k), (pp.getY(k) - y) * 0.6 + 0.35, pp.getZ(k)).normalize(); nn.setXYZ(k, d.x, d.y, d.z); }
      const ao = 0.5 + f * 0.4 + rand(0, 0.1);
      tint(g, ao, ao, ao);
      leaves.push(g);
    }
  }
  return { bark: merge(bark), leaves: merge(leaves) };
}

// 태극기 텍스처
function flagTex() {
  const W = 480, H = 320, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#f7f7f5'; x.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, r = H / 4, th = Math.atan2(2, 3);
  x.save(); x.translate(cx, cy); x.rotate(th);
  x.fillStyle = '#0f3c8c'; x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#cd2e3a'; x.beginPath(); x.arc(0, 0, r, Math.PI, Math.PI * 2); x.fill();
  x.beginPath(); x.arc(-r / 2, 0, r / 2, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#0f3c8c'; x.beginPath(); x.arc(r / 2, 0, r / 2, 0, Math.PI * 2); x.fill();
  x.restore();
  const bar = H / 24, gap = H / 48, len = H / 4, brk = H / 24, dist = r + H / 8 + (3 * bar + 2 * gap) / 2;
  const tri = (ang, pat) => {
    x.save(); x.translate(cx + Math.cos(ang) * dist, cy + Math.sin(ang) * dist); x.rotate(ang);
    x.fillStyle = '#111';
    pat.forEach((solid, i) => {
      const o = (i - 1) * (bar + gap);
      if (solid) x.fillRect(o - bar / 2, -len / 2, bar, len);
      else { x.fillRect(o - bar / 2, -len / 2, bar, (len - brk) / 2); x.fillRect(o - bar / 2, brk / 2, bar, (len - brk) / 2); }
    });
    x.restore();
  };
  tri(Math.PI + th, [1, 1, 1]); tri(th, [0, 0, 0]); tri(-th, [0, 1, 0]); tri(Math.PI - th, [1, 0, 1]);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class Nature {
  constructor(g) {
    this.g = g;
    const q = g.settings?.quality || 'high', Q = { low: 0.35, medium: 0.6, high: 1 }[q] ?? 1;
    this.group = new THREE.Group(); g.scene.add(this.group);
    this.buildGrass(Q);
    this.buildTrees(Q);
    this.buildFlag();
    this.buildBirds();
    this.gust = 0; this.gustT = rand(4, 9); this.gustDur = 0; this.gustAge = 0; this.base = 0.75;
    this.quiet = 0; this.chirpT = rand(1, 3);
  }

  buildGrass(Q) {
    const mat = windPatch(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.82, envMapIntensity: 0.6 }), { amp: 0.16, freq: 1.9, hRef: 0.55, key: 'grass' });
    const variants = [grassClump(9, 0.25, 0.55, 0), grassClump(11, 0.3, 0.7, 0), grassClump(8, 0.2, 0.45, 1), grassClump(9, 0.25, 0.6, 2), grassClump(6, 0.12, 0.3, 0)];
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), s = V(1, 1, 1), p = V(0, 0, 0), c = new THREE.Color();
    const chunks = new Map();
    const put = (x, z, y, sc) => {
      const vi = (Math.random() * variants.length) | 0, key = vi + ':' + Math.floor(x / 40) + ':' + Math.floor(z / 40);
      let L = chunks.get(key); if (!L) chunks.set(key, L = { vi, list: [] });
      L.list.push([x, y, z, sc]);
    };
    // 울타리 밖 초원: 가까울수록 빽빽
    const N = Math.round(30000 * Q);
    for (let i = 0; i < N; i++) {
      const side = (Math.random() * 4) | 0, along = rand(-110, 110), d = 71.2 + Math.pow(Math.random(), 2.6) * 60;
      const x = side < 2 ? along : (side === 2 ? -d : d), z = side < 2 ? (side === 0 ? -d : d) : along;
      if (Math.max(Math.abs(x), Math.abs(z)) < 71.2) continue;
      if (Math.random() > grassK(x, z) * 1.2) continue;
      put(x, z, terrainH(x, z) - 0.02, rand(0.8, 1.35));
    }
    // 울타리 안쪽 가장자리/틈새 잡초
    const M2 = Math.round(1600 * Q);
    for (let i = 0; i < M2; i++) {
      const side = (Math.random() * 4) | 0, along = rand(-69.5, 69.5), d = 69.6 - Math.pow(Math.random(), 2) * 1.6;
      const x = side < 2 ? along : (side === 2 ? -d : d), z = side < 2 ? (side === 0 ? -d : d) : along;
      if (z > 68 && Math.abs(x) < 6) continue;
      put(x, z, 0, rand(0.5, 0.9));
    }
    for (const { vi, list } of chunks.values()) {
      const im = new THREE.InstancedMesh(variants[vi], mat, list.length);
      list.forEach(([x, y, z, sc], i) => {
        m.compose(p.set(x, y, z), qq.setFromAxisAngle(V(0, 1, 0), rand(0, 6.28)), s.set(sc, sc * rand(0.85, 1.2), sc));
        im.setMatrixAt(i, m);
        const k = rand(0.8, 1.2), dry = fbm(x / 50 + 5, z / 50 + 2, 3, 2);
        im.setColorAt(i, c.setRGB(k * (0.9 + dry * 0.5), k * (1 - dry * 0.1), k * 0.85));
      });
      im.computeBoundingSphere(); im.receiveShadow = true;
      this.group.add(im);
    }
  }

  buildTrees(Q) {
    const leafMat = windPatch(new THREE.MeshStandardMaterial({ map: leafTex(), alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.75, envMapIntensity: 0.5 }), { amp: 0.35, freq: 1.1, hRef: 9, key: 'leaf' });
    const needleMat = windPatch(new THREE.MeshStandardMaterial({ map: needleTex(), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85, envMapIntensity: 0.45 }), { amp: 0.3, freq: 0.9, hRef: 12, key: 'needle' });
    const barkMat = windPatch(new THREE.MeshStandardMaterial({ map: barkTex(), roughness: 0.95 }), { amp: 0.3, freq: 1.0, hRef: 11, key: 'bark' });
    const kinds = [];
    for (let i = 0; i < 3; i++) kinds.push({ ...pine(rand(11, 15)), leaf: needleMat, n: 0, list: [] });
    for (let i = 0; i < 3; i++) kinds.push({ ...broadleaf(rand(8, 11)), leaf: leafMat, n: 0, list: [] });
    const bush = { leaves: merge(cardCloud(30, V(0, 0.55, 0), 0.75, 0.6, { flat: 0.6, shade: 0.9 })), leaf: leafMat, list: [] };
    const N = Math.round(420 * (0.5 + Q * 0.5));
    let placed = 0;
    for (let i = 0; placed < N && i < 20000; i++) {
      const a = Math.random() * Math.PI * 2, r = 78 + Math.pow(Math.random(), 1.5) * 330, x = Math.cos(a) * r * 1.2, z = Math.sin(a) * r * 1.2;
      if (Math.max(Math.abs(x), Math.abs(z)) < 78 || (x < -72 && z > 22 && z < 68)) continue;
      const f = fbm(x / 300 + 0.5, z / 300 + 0.5, 4, 3);
      if (f < 0.42 && Math.random() > 0.08) continue;
      const broad = fbm(x / 150 + 2, z / 150 + 7, 3, 2) > 0.5;
      const k = kinds[(broad ? 3 : 0) + ((Math.random() * 3) | 0)];
      k.list.push([x, terrainH(x, z) - 0.2, z, rand(0.75, 1.25)]); placed++;
    }
    for (let i = 0; i < 220 * Q; i++) {
      const side = (Math.random() * 4) | 0, along = rand(-140, 140), d = 73 + Math.pow(Math.random(), 1.5) * 50;
      const x = side < 2 ? along : (side === 2 ? -d : d), z = side < 2 ? (side === 0 ? -d : d) : along;
      if (x < -72 && z > 22 && z < 68) continue;
      bush.list.push([x, terrainH(x, z) - 0.1, z, rand(0.7, 1.6)]);
    }
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), s = V(1, 1, 1), p = V(0, 0, 0), c = new THREE.Color();
    for (const k of [...kinds, bush]) {
      if (!k.list.length) continue;
      const mk = (geo, mat, colorize) => {
        const im = new THREE.InstancedMesh(geo, mat, k.list.length);
        k.list.forEach(([x, y, z, sc], i) => {
          m.compose(p.set(x, y, z), qq.setFromAxisAngle(V(0, 1, 0), (x * 12.9898 + z * 78.233) % 6.28), s.set(sc, sc * (0.9 + ((x * z) % 1 + 1) % 1 * 0.25), sc));
          im.setMatrixAt(i, m);
          if (colorize) { const h = fbm(x / 80, z / 80, 3, 2); im.setColorAt(i, c.setRGB(0.85 + h * 0.4, 0.95 + h * 0.15, 0.8 + h * 0.1)); }
        });
        im.computeBoundingSphere(); im.receiveShadow = true;
        this.group.add(im);
      };
      mk(k.leaves, k.leaf, true);
      if (k.bark) mk(k.bark, barkMat, false);
    }
  }

  buildFlag() {
    const P = this.flagPos = V(9, 0, 63);
    const G = new THREE.Group(); G.position.copy(P);
    const steel = new THREE.MeshStandardMaterial({ color: 0xc9cdd0, roughness: 0.3, metalness: 1 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 9, 16), steel); pole.position.y = 4.5;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), new THREE.MeshStandardMaterial({ color: 0xd4a84f, roughness: 0.25, metalness: 1 })); ball.position.y = 9.05;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.35, 20), new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.9 })); base.position.y = 0.17;
    for (const o of [pole, ball, base]) { o.castShadow = true; o.receiveShadow = true; G.add(o); }
    const fg = new THREE.PlaneGeometry(1.8, 1.2, 36, 18); fg.translate(0.9, 0, 0);
    this.flag0 = fg.attributes.position.array.slice();
    const flag = this.flag = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: flagTex(), side: THREE.DoubleSide, roughness: 0.8 }));
    flag.position.set(0.04, 8.25, 0); flag.castShadow = true; flag.receiveShadow = true;
    this.flagPivot = new THREE.Group(); this.flagPivot.position.y = 0; this.flagPivot.add(flag); G.add(this.flagPivot);
    this.group.add(G);
    this.g.world.addCollider(P.x - 0.5, 0, P.z - 0.5, P.x + 0.5, 0.35, P.z + 0.5, 'concrete');
    this.g.world.addCollider(P.x - 0.06, 0, P.z - 0.06, P.x + 0.06, 9, P.z + 0.06, 'metal', { thin: true });
    this.flagYaw = 0;
  }

  buildBirds() {
    // 몸통 + 날개 2장 (날개 끝 x=±0.35 → 셰이더에서 날갯짓)
    const g = new THREE.BufferGeometry();
    const P = [0, 0, -0.12, 0.03, 0, 0.02, -0.03, 0, 0.02, 0, 0.02, 0.1, 0, -0.012, 0.02, // 몸통
      0.02, 0, -0.03, 0.35, 0.02, 0.0, 0.02, 0, 0.05, -0.02, 0, -0.03, -0.35, 0.02, 0.0, -0.02, 0, 0.05];
    const I = [0, 1, 3, 0, 3, 2, 0, 4, 1, 0, 2, 4, 5, 6, 7, 8, 10, 9];
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.9, side: THREE.DoubleSide });
    mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = WIND.time;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
          float bph = instanceMatrix[3].x * 3.1 + instanceMatrix[3].z * 1.7;
          float flap = sin(uTime * 13.0 + bph) * step(0.0, sin(uTime * 0.7 + bph * 0.3) + 0.35);
          transformed.y += flap * abs(transformed.x) * 0.9;
          #endif`);
    };
    mat.customProgramCacheKey = () => 'bird';
    const n = 30;
    this.birds = new THREE.InstancedMesh(g, mat, n);
    this.birds.frustumCulled = false;
    this.group.add(this.birds);
    this.flocks = [];
    for (let f = 0; f < 3; f++) {
      const fl = { c: V(rand(-120, 120), rand(28, 50), rand(-160, 40)), R: rand(40, 90), w: rand(0.06, 0.12) * (Math.random() < 0.5 ? -1 : 1), a: rand(0, 6), drift: V(rand(-1, 1), 0, rand(-1, 1)).normalize().multiplyScalar(rand(0.5, 1.5)), scare: 0, members: [] };
      for (let i = 0; i < 10; i++) fl.members.push({ o: V(rand(-6, 6), rand(-2, 2), rand(-6, 6)), ph: rand(0, 6), p: V(0, 0, 0), prev: V(0, 0, 0) });
      this.flocks.push(fl);
    }
  }

  // 큰 소리 → 새가 흩어지고 한동안 조용
  scare(p, loud = 1) {
    for (const fl of this.flocks) if (fl.c.distanceTo(p) < 200 * loud) fl.scare = Math.min(1, fl.scare + 0.6 * loud);
    this.quiet = Math.max(this.quiet, 6 + 6 * loud);
  }

  update(dt) {
    const g = this.g, t = WIND.time.value;
    // 돌풍: 주기적으로 바람 세기 증가 + 소리
    this.gustT -= dt;
    if (this.gustT <= 0) { this.gustT = rand(7, 18); this.gustDur = rand(2.5, 5); this.gustAge = 0; this.gustPow = rand(0.5, 1.2); Audio.play('gust', { vol: 0.25 + this.gustPow * 0.35, bus: 'sfx' }); }
    let gk = 0;
    if (this.gustAge < this.gustDur) { this.gustAge += dt; gk = Math.sin(Math.PI * clamp(this.gustAge / this.gustDur, 0, 1)) * this.gustPow; }
    WIND.strength.value = this.base + gk + Math.sin(t * 0.13) * 0.12;
    // 풍향 천천히 변화
    const wa = 0.3 + Math.sin(t * 0.02) * 0.35;
    WIND.dir.value.set(Math.cos(wa), 0, Math.sin(wa));
    // 새 소리
    this.quiet = Math.max(0, this.quiet - dt);
    this.chirpT -= dt;
    if (this.chirpT <= 0) {
      this.chirpT = rand(1.2, 4.5);
      const dayK = g.dayNight ? g.dayNight.day : 1;
      if (this.quiet <= 0) {
        const L = g.player.pos, a = rand(0, Math.PI * 2), r = rand(25, 70);
        const p = V(L.x + Math.cos(a) * r, rand(4, 12), L.z + Math.sin(a) * r);
        if (Math.random() < dayK) Audio.play3D('chirp' + ((Math.random() * 4) | 0), p, { vol: rand(0.25, 0.5), ref: 12, jitter: 0.08 });
        else if (Math.random() < 0.18) Audio.play3D('owl', p.setY(rand(8, 14)), { vol: rand(0.3, 0.5), ref: 14, jitter: 0.04 });
      }
      if (g.dayNight) Audio.setNight(1 - dayK);
    }
    // 국기
    const f = this.flag.geometry.attributes.position, a0 = this.flag0, S = WIND.strength.value;
    const wd = WIND.dir.value, yaw = Math.atan2(-wd.z, wd.x);
    this.flagYaw += (yaw - this.flagYaw) * Math.min(1, dt * 0.8);
    this.flagPivot.rotation.y = this.flagYaw;
    for (let i = 0; i < f.count; i++) {
      const x = a0[i * 3], y = a0[i * 3 + 1], u = x / 1.8;
      const w = Math.sin(x * 3.2 - t * 7.5 * (0.6 + S * 0.4) + y * 0.8) * 0.13 + Math.sin(x * 6.1 - t * 11 + y * 2.1) * 0.04;
      const sag = (1 - clamp(S, 0.2, 1.4) / 1.4) * u * u * 0.5;
      f.setXYZ(i, x * (1 - 0.04 * Math.abs(w)), y - sag, w * u * (0.5 + S * 0.5));
    }
    f.needsUpdate = true; this.flag.geometry.computeVertexNormals();
    // 새 떼
    const m = this._m || (this._m = new THREE.Matrix4()), q = new THREE.Quaternion(), sc = V(1, 1, 1);
    let k = 0;
    for (const fl of this.flocks) {
      fl.scare = Math.max(0, fl.scare - dt * 0.08);
      fl.a += fl.w * dt * (1 + fl.scare * 2.5);
      fl.c.addScaledVector(fl.drift, dt * (1 + fl.scare * 4));
      fl.c.y += (40 + fl.scare * 25 - fl.c.y) * dt * 0.2;
      if (Math.abs(fl.c.x) > 260 || Math.abs(fl.c.z) > 260) fl.drift.multiplyScalar(-1);
      const cen = V(fl.c.x + Math.cos(fl.a) * fl.R, fl.c.y, fl.c.z + Math.sin(fl.a) * fl.R);
      for (const b of fl.members) {
        b.prev.copy(b.p);
        b.p.copy(cen).add(V(b.o.x + Math.sin(t * 0.7 + b.ph) * 2, b.o.y + Math.sin(t * 1.1 + b.ph) * 0.8, b.o.z + Math.cos(t * 0.6 + b.ph) * 2));
        const d = b.p.clone().sub(b.prev);
        if (d.lengthSq() > 1e-6) q.setFromRotationMatrix(m.lookAt(b.prev, b.p, V(0, 1, 0)));
        m.compose(b.p, q, sc.setScalar(1.3));
        this.birds.setMatrixAt(k++, m);
      }
    }
    this.birds.count = k; this.birds.instanceMatrix.needsUpdate = true;
  }
}
