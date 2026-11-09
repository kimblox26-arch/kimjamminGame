// SCP-096 새 디자인: 조각된 유기체 메시(근육·힘줄·갈비뼈·척추·관절뼈) + 깊은 눈구멍의 빛나는 눈 + 찢어지는 턱
// 뼈 이름/구조는 rig.js 와 같아서 Pose/applyPose 애니메이션을 그대로 쓴다.
import * as THREE from 'three';
import { normalFrom } from './world.js';

const PI = Math.PI, TAU = PI * 2;
const G = (d, w) => Math.exp(-(d * d) / (w * w));
const ad = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// 유기 튜브: t=0 위(관절) → t=1 아래(-Y). prof(t) → [rx, rz, cz]. bump(t,θ) → 반지름 배율 변화 (θ=0 앞쪽 +Z, θ=π/2 → +X)
function organ(len, prof, bump = () => 0, segT = 28, segA = 24, capT = 0.7, capB = 0.7) {
  const rings = [], pos = [], uv = [], col = [], idx = [];
  const p0 = prof(0), p1 = prof(1);
  for (let k = 4; k >= 1; k--) { const f = k / 4 * PI / 2; rings.push([0, Math.max(p0[0], p0[1]) * capT * Math.sin(f), Math.cos(f)]); }
  for (let i = 0; i <= segT; i++) rings.push([i / segT, -i / segT * len, 1]);
  for (let k = 1; k <= 4; k++) { const f = k / 4 * PI / 2; rings.push([1, -len - Math.max(p1[0], p1[1]) * capB * Math.sin(f), Math.cos(f)]); }
  rings.forEach(([t, y, sc], r) => {
    const [rx, rz, cz = 0, cx = 0] = prof(t);
    for (let j = 0; j <= segA; j++) {
      const th = j / segA * TAU, d = bump(t, th), m = (1 + d) * sc;
      pos.push(cx + rx * m * Math.sin(th), y, cz + rz * m * Math.cos(th));
      const c = Math.min(1.08, Math.max(0.5, 1 + Math.max(-0.4, Math.min(0.4, d)) * 1.1)) * (0.82 + 0.18 * sc);
      col.push(c, c * 0.985, c * 0.98);
      uv.push(j / segA, 1 - r / (rings.length - 1));
    }
  });
  const S = segA + 1;
  for (let r = 0; r < rings.length - 1; r++) for (let j = 0; j < segA; j++) { const a = r * S + j, b = a + 1, c = a + S, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const n = g.attributes.normal; // 이음매 법선 평균
  for (let r = 0; r < rings.length; r++) { const a = r * S, b = a + segA; for (let k = 0; k < 3; k++) { const v = (n.array[a * 3 + k] + n.array[b * 3 + k]) / 2; n.array[a * 3 + k] = n.array[b * 3 + k] = v; } }
  return g;
}
const up = (g, len) => g.translate(0, len, 0); // 위로 자라는 부위(몸통·목)

// 머리: 구를 조각 — 길쭉한 두개골, 깊은 눈구멍, 튀어나온 광대, 홀쭉한 볼, 입 자리 오목
function sculpt(geo, sx, sy, sz, fn) {
  const p = geo.attributes.position, col = [], v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const d = fn(v), m = 1 + d;
    p.setXYZ(i, v.x * m * sx, v.y * m * sy, v.z * m * sz + (fn.back ? fn.back(v) : 0));
    const c = Math.min(1.08, Math.max(0.35, 1 + d * 2.4)); col.push(c, c * 0.98, c * 0.97);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.computeVertexNormals();
  return geo;
}
const G3 = (v, x, y, z, w) => { const l = Math.hypot(x, y, z); return Math.exp(-((v.x - x / l) ** 2 + (v.y - y / l) ** 2 + (v.z - z / l) ** 2) / (w * w)); };

function skinMaps() {
  const s = 512, c = document.createElement('canvas'); c.width = c.height = s; const x = c.getContext('2d');
  x.fillStyle = '#ddd3cb'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 320; i++) { x.fillStyle = `rgba(${140 + Math.random() * 60},${110 + Math.random() * 40},${115 + Math.random() * 45},${Math.random() * 0.09})`; x.beginPath(); x.arc(Math.random() * s, Math.random() * s, 3 + Math.random() * 36, 0, 7); x.fill(); }
  for (let v = 0; v < 40; v++) { // 비치는 핏줄
    let px = Math.random() * s, py = Math.random() * s, a = Math.random() * 7;
    x.strokeStyle = `rgba(${80 + Math.random() * 40},${85 + Math.random() * 30},${140 + Math.random() * 50},${0.1 + Math.random() * 0.2})`;
    x.lineWidth = 0.5 + Math.random() * 2; x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 34; k++) { a += (Math.random() - 0.5) * 0.9; px += Math.cos(a) * 5; py += Math.sin(a) * 5; x.lineTo(px, py); }
    x.stroke();
  }
  for (let i = 0; i < 70; i++) { x.strokeStyle = `rgba(90,40,35,${Math.random() * 0.25})`; x.lineWidth = 0.6; x.beginPath(); const a = Math.random() * s, b = Math.random() * s; x.moveTo(a, b); x.lineTo(a + (Math.random() - 0.5) * 30, b + (Math.random() - 0.5) * 30); x.stroke(); } // 긁힌 상처
  for (let i = 0; i < 16000; i++) { x.fillStyle = `rgba(70,50,50,${Math.random() * 0.07})`; x.fillRect(Math.random() * s, Math.random() * s, 1, 1); } // 모공
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const n = new THREE.CanvasTexture(normalFrom(c, 6)); n.wrapS = n.wrapT = THREE.RepeatWrapping;
  return [t, n];
}

export function buildModel096() {
  const [map, normalMap] = skinMaps();
  const skin = new THREE.MeshPhysicalMaterial({ map, normalMap, normalScale: new THREE.Vector2(0.7, 0.7), vertexColors: true, color: 0xa89c92, roughness: 0.6, sheen: 0.3, sheenColor: new THREE.Color(0xff9f90), sheenRoughness: 0.5, clearcoat: 0.18, clearcoatRoughness: 0.5 });
  const nail = new THREE.MeshStandardMaterial({ color: 0x6b5f4e, roughness: 0.3, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0a0505, roughness: 1 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(2), toneMapped: false });
  const root = new THREE.Group(), B = {};
  const M = (geo, parent, mat = skin, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; m.frustumCulled = false; parent.add(m); return m; };
  const bone = (n, p, x = 0, y = 0, z = 0) => { const b = new THREE.Group(); b.name = n; b.position.set(x, y, z); p.add(b); B[n] = b; return b; };
  const H = { hipH: 1.28, thigh: 0.58, shin: 0.57, spine: 0.32, chest: 0.36, neck: 0.15, upper: 0.52, fore: 0.5, sw: 0.215, hw: 0.088 };
  const vert = (t, th) => (-0.07 + 0.09 * Math.max(0, Math.sin(t * PI * 7))) * G(ad(th, PI), 0.13); // 척추 마디

  const hips = bone('hips', root, 0, H.hipH, 0);
  M(organ(0.2, t => [0.122 - 0.012 * t, 0.088 - 0.012 * t, -0.005], (t, th) => 0.07 * G(t - 0.55, 0.3) * (G(ad(th, PI - 0.5), 0.45) + G(ad(th, PI + 0.5), 0.45)) - 0.05 * G(th, 0.5) * G(t - 0.9, 0.2), 20, 24, 0.3, 0.55), hips, skin, 0, 0.08);
  const sp = bone('spine', hips, 0, 0.06, 0);
  // 배: 푹 꺼진 복부, 골반뼈 돌출, 등뼈
  M(up(organ(H.spine + 0.03, t => [0.1 - 0.02 * Math.sin(PI * t) + 0.018 * t, 0.078 - 0.014 * Math.sin(PI * t), 0.004], (t, th) =>
    -0.24 * G(t - 0.45, 0.24) * G(th, 0.85) - 0.05 * G(th, 0.07) + 0.16 * G(t - 0.9, 0.08) * G(ad(Math.abs(ad(th, 0)), 1.05), 0.3)
    + 0.07 * G(t - 0.04, 0.06) * G(ad(Math.abs(ad(th, 0)), 0.9), 0.5) + vert(t, th), 26, 26, 0.2, 0.2), H.spine + 0.03), sp);
  const ch = bone('chest', sp, 0, H.spine, 0);
  // 흉곽: 갈비뼈 6쌍, 흉골, 쇄골, 견갑골, 척추
  M(up(organ(H.chest, t => [0.128 + 0.026 * Math.sin(PI * t) - 0.012 * t, 0.086 + 0.016 * Math.sin(PI * t), 0.005], (t, th) => {
    let d = 0; const a = Math.abs(ad(th, 0));
    for (let k = 0; k < 6; k++) { const tr = 0.3 + k * 0.105 + 0.08 * Math.cos(th); d += 0.075 * G(t - tr, 0.02); }
    d *= (1 - G(a, 0.25)) * (1 - G(ad(th, PI), 0.45)) * (t > 0.18 ? 1 : 0);
    d += 0.035 * G(a, 0.12) * (t > 0.2 && t < 0.8 ? 1 : 0) - 0.04 * G(t - 0.95, 0.06) * G(a, 0.6);
    d += 0.1 * G(t - 0.07 - 0.04 * Math.abs(Math.sin(th)), 0.028) * G(a - 0.85, 0.5) * (a < 1.6 ? 1 : 0); // 쇄골
    d += 0.13 * G(t - 0.3, 0.13) * (G(ad(th, PI - 0.78), 0.33) + G(ad(th, PI + 0.78), 0.33)); // 견갑골
    return d + vert(t, th);
  }, 34, 30, 0.55, 0.2), H.chest), ch);
  // 목: 흉쇄유돌근 힘줄, 울대뼈
  const nk = bone('neck', ch, 0, H.chest, 0.025);
  M(up(organ(H.neck + 0.04, t => [0.043 + 0.012 * t, 0.046 + 0.016 * t, 0.004 * t], (t, th) => {
    let d = 0.12 * G(t - 0.5, 0.14) * G(th, 0.2) + 0.06 * G(ad(th, PI), 0.2) * Math.max(0, Math.sin(t * PI * 3));
    for (const s of [1, -1]) d += 0.16 * G(ad(th, s * (1.85 - 1.55 * t)), 0.2);
    return d;
  }, 18, 22, 0.2, 0.2), H.neck + 0.02), nk);
  const hd = bone('head', nk, 0, H.neck, 0.0);
  buildHead(hd, skin, dark, eyeMat, M, bone, B);
  // 팔
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R', o = s * PI / 2;
    const arm = bone('arm' + L, ch, s * H.sw, H.chest * 0.88, -0.01);
    M(organ(H.upper, t => [0.037 - 0.006 * t, 0.037 - 0.006 * t], (t, th) =>
      0.42 * G(t - 0.05, 0.12) * G(ad(th, o), 1.0) + 0.24 * G(t - 0.45, 0.2) * G(th, 0.6) + 0.2 * G(t - 0.35, 0.22) * G(ad(th, PI), 0.7)
      - 0.1 * G(ad(th, -o), 0.22) * G(t - 0.5, 0.3) + 0.34 * G(t - 0.985, 0.035) * G(ad(th, PI), 0.5) - 0.12 * G(t - 0.95, 0.05) * G(th, 0.5), 28, 22, 0.9, 0.6), arm);
    const fo = bone('fore' + L, arm, 0, -H.upper, 0);
    M(organ(H.fore, t => [0.034 - 0.013 * t, 0.029 - 0.012 * t], (t, th) =>
      0.32 * G(t - 0.17, 0.14) * G(ad(th, o * 0.5), 0.6) + 0.18 * G(t - 0.25, 0.2) * G(ad(th, -o * 0.6), 0.6)
      + 0.14 * G(t - 0.85, 0.16) * (G(ad(th, 0.35), 0.1) + G(ad(th, -0.35), 0.1)) + 0.28 * G(t - 0.96, 0.04) * G(ad(th, PI - o * 0.5), 0.4), 28, 22, 0.5, 0.5), fo);
    const hn = bone('hand' + L, fo, 0, -H.fore, 0);
    buildHand(hn, s, L, skin, nail, M, B);
  }
  // 다리
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R', o = s * PI / 2;
    const lg = bone('leg' + L, hips, s * H.hw, 0, 0);
    M(organ(H.thigh, t => [0.066 - 0.022 * t, 0.068 - 0.022 * t], (t, th) =>
      0.16 * G(t - 0.4, 0.25) * G(th, 0.8) + 0.2 * G(t - 0.8, 0.1) * G(ad(th, -o * 0.5), 0.4) + 0.1 * G(t - 0.45, 0.3) * G(ad(th, PI), 0.6)
      - 0.07 * G(ad(th, o), 0.15) + 0.36 * G(t - 0.985, 0.04) * G(th, 0.45), 30, 24, 0.4, 0.55), lg);
    const sh = bone('shin' + L, lg, 0, -H.thigh, 0);
    M(organ(H.shin, t => [0.043 - 0.017 * t, 0.044 - 0.016 * t], (t, th) =>
      0.45 * G(t - 0.22, 0.17) * G(ad(th, PI), 0.85) + 0.06 * G(ad(th, -o * 0.15), 0.12) + 0.16 * G(t - 0.02, 0.05) * G(th, 0.6)
      - 0.16 * G(t - 0.85, 0.1) * (G(ad(th, PI - 0.5), 0.2) + G(ad(th, PI + 0.5), 0.2)) + 0.38 * G(t - 0.97, 0.035) * (G(ad(th, PI / 2), 0.35) + G(ad(th, -PI / 2), 0.35)), 30, 22, 0.5, 0.5), sh);
    const ft = bone('foot' + L, sh, 0, -H.shin, 0);
    const fg = organ(0.31, t => [0.032 + 0.016 * Math.min(1, t / 0.75), 0.04 - 0.02 * t, 0], (t, th) => 0.13 * G(t - 0.6, 0.25) * [-2, -1, 0, 1, 2].reduce((a, k) => a + G(ad(th, k * 0.28), 0.06), 0) + 0.2 * G(t - 0.1, 0.12) * G(ad(th, PI), 0.8), 20, 20, 0.6, 0.3);
    fg.rotateX(-PI / 2); M(fg, ft, skin, 0, -0.075, -0.07);
    for (let i = 0; i < 5; i++) { // 발가락 + 발톱
      const tl = 0.05 - Math.abs(i - 0.8) * 0.007, tg = organ(tl, () => [0.0105 - i * 0.0009, 0.009], (t) => 0.2 * G(t - 0.45, 0.15), 8, 10, 0.6, 0.8);
      tg.rotateX(-PI / 2 + 0.25); M(tg, ft, skin, s * (0.03 - i * 0.015), -0.1, 0.235);
      const nl = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 4), nail); nl.scale.set(1, 0.45, 1.5); nl.position.set(s * (0.03 - i * 0.015), -0.093, 0.235 + tl * 0.85); ft.add(nl);
    }
  }
  root.traverse(m => { if (m.isMesh) m.frustumCulled = false; });
  return { root, bones: B, hipH: H.hipH, eyeMat };
}

function buildHead(hd, skin, dark, eyeMat, M, bone, B) {
  const sx = 0.1, sy = 0.152, sz = 0.124, cy = 0.13;
  const f = v => {
    let d = 0;
    for (const s of [1, -1]) {
      d -= 0.24 * G3(v, s * 0.36, 0.1, 0.93, 0.21);            // 깊은 눈구멍
      d += 0.06 * G3(v, s * 0.34, 0.32, 0.88, 0.15);           // 눈썹뼈
      d += 0.085 * G3(v, s * 0.64, -0.08, 0.75, 0.17);         // 광대
      d -= 0.14 * G3(v, s * 0.56, -0.45, 0.66, 0.22);          // 홀쭉한 볼
      d -= 0.07 * G3(v, s * 0.9, 0.25, 0.3, 0.22);             // 관자놀이
      d += 0.05 * G3(v, s * 0.5, -0.62, 0.35, 0.2);            // 턱 근육 자리
    }
    d += 0.1 * G3(v, 0, -0.1, 1, 0.1) + 0.03 * G3(v, 0, 0.12, 1, 0.08); // 작은 코
    d -= 0.3 * Math.max(0, -v.y - 0.42) * Math.max(0, v.z + 0.1) * 2.2; // 입/턱 자리 오목 (턱뼈가 채움)
    return d;
  };
  f.back = v => -0.035 * Math.max(0, -v.z) * Math.max(0, v.y + 0.3); // 뒤로 길쭉한 뒤통수
  M(sculpt(new THREE.SphereGeometry(1, 72, 54), sx, sy, sz, f), hd, skin, 0, cy, 0);
  for (const s of [1, -1]) {
    M(new THREE.SphereGeometry(0.019, 12, 10), hd, dark, s * 0.036, cy + 0.016, 0.098);  // 눈 안쪽 어둠
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 10, 8), eyeMat); e.position.set(s * 0.036, cy + 0.016, 0.112); hd.add(e); // 빛나는 작은 눈동자
    const ear = M(new THREE.SphereGeometry(0.022, 12, 10), hd, skin, s * 0.098, cy + 0.005, -0.012); ear.scale.set(0.35, 1, 0.6);
  }
  // 입 안 + 윗니
  M(new THREE.SphereGeometry(0.055, 18, 14), hd, new THREE.MeshStandardMaterial({ color: 0x2a0606, roughness: 0.7 }), 0, cy - 0.085, 0.055).scale.set(1, 0.9, 1.1);
  const tooth = new THREE.MeshStandardMaterial({ color: 0xcfc4a0, roughness: 0.35 });
  for (let i = 0; i < 10; i++) { const a = (i - 4.5) * 0.2, h = 0.016 + Math.random() * 0.008; const t = M(new THREE.ConeGeometry(0.0055, h, 5), hd, tooth, Math.sin(a) * 0.05, cy - 0.072 - h / 2, 0.06 + Math.cos(a) * 0.05); t.rotation.x = PI; }
  // 턱: 귀 근처 경첩. 열리면 비정상적으로 크게 찢어짐
  const jaw = bone('jaw', hd, 0, cy - 0.035, -0.005);
  const jg = sculpt(new THREE.SphereGeometry(1, 40, 30), 0.074, 0.05, 0.1, v => 0.12 * G3(v, 0, -0.5, 1, 0.3) - 0.25 * Math.max(0, v.y) + 0.06 * Math.max(0, -v.y) * Math.abs(v.x));
  M(jg, jaw, skin, 0, -0.072, 0.052);
  for (let i = 0; i < 10; i++) { const a = (i - 4.5) * 0.2, h = 0.014 + Math.random() * 0.008; M(new THREE.ConeGeometry(0.005, h, 5), jaw, tooth, Math.sin(a) * 0.045, -0.05 + h / 2, 0.055 + Math.cos(a) * 0.045); }
  M(new THREE.SphereGeometry(0.04, 12, 8), jaw, new THREE.MeshStandardMaterial({ color: 0x4a1010, roughness: 0.6 }), 0, -0.06, 0.04).scale.set(1, 0.4, 1.3); // 혀
}

function buildHand(hn, s, L, skin, nail, M, B) {
  const pg = new THREE.Group(); pg.rotation.y = -s * PI / 2; hn.add(pg); // 손바닥이 몸 안쪽
  const kn = i => PI - (i - 1.5) * 0.46;
  M(organ(0.135, t => [0.044 + 0.008 * t, 0.017], (t, th) => [0, 1, 2, 3].reduce((a, i) => a + 0.4 * G(t - 0.93, 0.06) * G(ad(th, kn(i)), 0.18) + 0.14 * G(ad(th, kn(i)), 0.07) * (t > 0.25 ? 1 : 0), 0) + 0.15 * G(t - 0.15, 0.2) * G(th, 1), 18, 26, 0.5, 0.4), pg);
  const fingers = [];
  for (let i = 0; i < 4; i++) {
    const len = [0.165, 0.185, 0.175, 0.14][i], r = 0.0095 - i * 0.0006;
    const f0 = new THREE.Group(); f0.position.set((i - 1.5) * 0.023, -0.14, 0); pg.add(f0);
    M(organ(len * 0.55, () => [r, r * 0.92], (t, th) => 0.25 * G(t - 0.02, 0.1) + 0.2 * G(t - 0.98, 0.08) * G(ad(th, PI), 0.8), 12, 12, 0.7, 0.5), f0);
    const f1 = new THREE.Group(); f1.position.y = -len * 0.55; f0.add(f1);
    M(organ(len * 0.45, t => [r * (0.92 - 0.3 * t), r * (0.85 - 0.3 * t)], () => 0, 10, 12, 0.5, 0.9), f1);
    const cl = new THREE.Mesh(new THREE.ConeGeometry(r * 0.75, 0.028, 6), nail); cl.position.set(0, -len * 0.45 - 0.006, -r * 0.35); cl.rotation.x = PI - 0.25; cl.scale.z = 0.5; f1.add(cl); // 길고 뾰족한 손톱
    fingers.push(f0, f1);
  }
  const th = new THREE.Group(); th.position.set(s * 0.045, -0.04, 0.012); th.rotation.set(0.5, 0, s * 0.55); pg.add(th);
  M(organ(0.1, t => [0.011 - 0.003 * t, 0.01 - 0.003 * t], (t) => 0.2 * G(t - 0.5, 0.1), 12, 12, 0.6, 0.7), th);
  fingers.push(th);
  B['fingers' + L] = fingers;
}
