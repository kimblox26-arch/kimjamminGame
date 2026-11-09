// 절차적 인체 리그 — 플레이어(D계급)와 SCP-096 이 같은 뼈대 구조를 쓴다.
// 캐릭터는 +Z 를 바라보고 발바닥이 y=0. 팔다리 뼈는 -Y 방향으로 뻗음.
import * as THREE from 'three';

const V2 = THREE.Vector2;

// 둥근 끝을 가진 테이퍼 팔다리 (Lathe). r0=위(관절) r1=아래, bulge=근육 볼록
export function limbGeo(len, r0, r1, bulge = 0, seg = 14, bulgeAt = 0.5) {
  const pts = [], N = 12;
  for (let i = 0; i <= 4; i++) { const a = -Math.PI / 2 + i / 4 * Math.PI / 2; pts.push(new V2(Math.max(1e-4, r1 * Math.cos(a)), -len + r1 * 0.7 * Math.sin(a))); }
  for (let i = 1; i < N; i++) {
    const t = i / N, bb = t < bulgeAt ? Math.sin(Math.PI / 2 * t / bulgeAt) : Math.cos(Math.PI / 2 * (t - bulgeAt) / (1 - bulgeAt));
    pts.push(new V2(r1 + (r0 - r1) * t + bulge * bb, -len + t * len));
  }
  for (let i = 0; i <= 4; i++) { const a = i / 4 * Math.PI / 2; pts.push(new V2(Math.max(1e-4, r0 * Math.cos(a)), r0 * 0.7 * Math.sin(a))); }
  const g = new THREE.LatheGeometry(pts, seg);
  g.computeVertexNormals();
  return g;
}

function mesh(geo, mat, parent, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m); return m;
}
function bone(name, parent, x = 0, y = 0, z = 0, bones) {
  const b = new THREE.Group(); b.name = name; b.position.set(x, y, z);
  parent.add(b); bones[name] = b; return b;
}
const sphere = (r, w = 20, h = 14) => new THREE.SphereGeometry(r, w, h);

// opts: 비율과 재질. kind = 'dclass' | '096'
export function buildHumanoid(o) {
  const root = new THREE.Group(), B = {};
  const { skin, cloth = skin, cloth2 = cloth, shoe = cloth, hipH, thigh, shin, spine, chest, neck, upper, fore, shoulderW, hipW } = o;
  const is096 = o.kind === '096';
  const hips = bone('hips', root, 0, hipH, 0, B);
  // 골반
  mesh(sphere(1), cloth2, hips, 0, 0.02, 0, o.pelvis[0], o.pelvis[1], o.pelvis[2]);
  const sp = bone('spine', hips, 0, 0.06, 0, B);
  // 배 (096 은 움푹 꺼진 배)
  mesh(limbGeo(spine + 0.04, o.waist * 1.05, o.waist, is096 ? -0.012 : 0.01), cloth, sp, 0, spine, 0, 1, 1, o.depth);
  const ch = bone('chest', sp, 0, spine, 0, B);
  // 흉곽: 위가 넓은 lathe
  const cg = limbGeo(chest, o.chestR * 0.8, o.chestR * 0.92, o.chestR * 0.12, 18, 0.65);
  const torso = mesh(cg, cloth, ch, 0, chest, 0, 1, 1, o.depth);
  if (is096) {
    // 앙상한 갈비뼈 융기
    for (let i = 0; i < 6; i++) {
      const t = 0.18 + i * 0.12, r = o.chestR * (0.86 + 0.08 * Math.sin(Math.PI * Math.min(1, t * 1.3)));
      const g = new THREE.Group(); g.position.y = t * chest; g.scale.z = o.depth * 1.03; ch.add(g);
      mesh(new THREE.TorusGeometry(r, 0.0075, 6, 28, Math.PI * 1.7), skin, g).rotation.set(Math.PI / 2 + 0.28, 0, -Math.PI * 0.35);
    }
    // 척추 마디
    for (let i = 0; i < 9; i++) mesh(sphere(0.016, 8, 6), skin, sp, 0, i * (spine + chest) / 9, -o.waist * o.depth * 0.95 - 0.004 * Math.sin(i), 1, 0.8, 0.7);
    // 쇄골
    for (const s of [1, -1]) { const c = mesh(limbGeo(shoulderW * 0.9, 0.013, 0.011), skin, ch, s * 0.02, chest * 0.97, o.chestR * o.depth * 0.55); c.rotation.z = s * Math.PI / 2 * 1.08; c.rotation.y = s * -0.25; }
  }
  // 목 / 머리
  const nk = bone('neck', ch, 0, chest, is096 ? 0.03 : 0.0, B);
  mesh(limbGeo(neck + 0.03, o.neckR, o.neckR * 1.08), skin, nk, 0, neck + 0.02, 0);
  const hd = bone('head', nk, 0, neck, 0, B);
  buildHead(hd, o, B);
  // 팔
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    const sh = bone('arm' + L, ch, s * shoulderW, chest * 0.9, 0, B);
    mesh(sphere(o.armR * 1.25, 14, 10), is096 ? skin : cloth, sh, 0, 0, 0, 1, 0.9, 0.95); // 어깨
    mesh(limbGeo(upper, o.armR, o.armR * 0.82, o.armR * (is096 ? 0.05 : 0.18), 12, 0.6), o.sleeve || skin, sh, 0, 0, 0);
    const el = bone('fore' + L, sh, 0, -upper, 0, B);
    if (is096) mesh(sphere(o.armR * 0.95, 10, 8), skin, el, 0, 0, -0.006);
    mesh(limbGeo(fore, o.armR * 0.85, o.armR * 0.62, o.armR * 0.12, 12, 0.7), skin, el, 0, 0, 0);
    const hn = bone('hand' + L, el, 0, -fore, 0, B);
    buildHand(hn, s, o, B, L);
  }
  // 다리
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    const hp = bone('leg' + L, hips, s * hipW, 0, 0, B);
    mesh(limbGeo(thigh, o.legR, o.legR * 0.7, o.legR * (is096 ? 0.02 : 0.15), 14, 0.35), o.pants || cloth2, hp, 0, 0, 0);
    const kn = bone('shin' + L, hp, 0, -thigh, 0, B);
    if (is096) mesh(sphere(o.legR * 0.78, 10, 8), skin, kn, 0, 0, 0.012);
    mesh(limbGeo(shin, o.legR * 0.72, o.legR * 0.5, o.legR * 0.12, 12, 0.3), o.pants || cloth2, kn, 0, 0, 0);
    const an = bone('foot' + L, kn, 0, -shin, 0, B);
    const fl = o.footL;
    const f = mesh(limbGeo(fl, o.legR * 0.52, o.legR * 0.42, 0.01, 10), shoe, an, 0, -o.ankleH * 0.6, -fl * 0.22);
    f.rotation.x = -Math.PI / 2; f.scale.set(1.15, 1, 0.62);
    if (is096) for (let i = 0; i < 5; i++) { const t = mesh(limbGeo(0.035 - i * 0.003, 0.009, 0.007), skin, an, s * (0.03 - i * 0.016), -o.ankleH * 0.85, fl * 0.75); t.rotation.x = -Math.PI / 2 + 0.2; }
  }
  root.traverse(m => { if (m.isMesh) m.frustumCulled = false; });
  return { root, bones: B, hipH, rest: snapshot(B) };
}

function buildHead(hd, o, B) {
  const is096 = o.kind === '096', s = o.headS;
  const skull = mesh(sphere(1, 28, 22), o.skin, hd, 0, s[1] * 0.85, is096 ? -0.01 : 0, s[0], s[1], s[2]);
  const eyeSock = new THREE.MeshStandardMaterial({ color: is096 ? 0x6e605c : 0x5a3d33, roughness: 0.9 });
  const eyeW = new THREE.MeshPhysicalMaterial({ color: is096 ? 0xf2eee8 : 0xffffff, roughness: 0.15, clearcoat: 1 });
  const pupil = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const ey = s[1] * 0.95, ez = s[2] * 0.84;
  for (const k of [1, -1]) {
    if (is096) {
      mesh(sphere(0.026, 14, 10), eyeSock, hd, k * 0.042, ey, ez - 0.012, 1.1, 0.8, 0.6); // 퀭한 눈구멍
      mesh(sphere(0.011, 12, 8), eyeW, hd, k * 0.042, ey, ez - 0.004, 1, 0.9, 0.7);
      mesh(sphere(0.0035, 6, 4), pupil, hd, k * 0.042, ey, ez + 0.004);
    } else {
      mesh(sphere(0.013, 12, 8), eyeW, hd, k * 0.036, ey, ez, 1, 0.8, 0.6);
      mesh(sphere(0.006, 8, 6), pupil, hd, k * 0.036, ey, ez + 0.006);
      mesh(new THREE.BoxGeometry(0.035, 0.007, 0.01), o.hairMat, hd, k * 0.036, ey + 0.026, ez + 0.003); // 눈썹
    }
    mesh(sphere(0.02, 10, 8), o.skin, hd, k * s[0] * 0.98, s[1] * 0.85, -0.005, 0.35, 0.8, 0.6); // 귀
  }
  // 코
  const nose = mesh(sphere(0.016, 10, 8), o.skin, hd, 0, s[1] * 0.75, s[2] * 0.97, 0.8, 1.4, 1);
  nose.rotation.x = -0.3;
  if (is096) {
    // 입 안(어둠) + 윗니
    mesh(sphere(0.055, 16, 12), new THREE.MeshStandardMaterial({ color: 0x1a0505, roughness: 1 }), hd, 0, s[1] * 0.35, s[2] * 0.45, 1, 1.1, 1);
    const tooth = new THREE.MeshStandardMaterial({ color: 0xd8d0b0, roughness: 0.4 });
    for (let i = 0; i < 8; i++) { const a = (i - 3.5) * 0.24; mesh(new THREE.BoxGeometry(0.011, 0.016, 0.008), tooth, hd, Math.sin(a) * 0.05, s[1] * 0.46, s[2] * 0.62 + Math.cos(a) * 0.035); }
  } else {
    mesh(new THREE.BoxGeometry(0.035, 0.006, 0.01), new THREE.MeshStandardMaterial({ color: 0x7a3a33 }), hd, 0, s[1] * 0.48, s[2] * 0.92);
    // 짧은 머리카락
    mesh(new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.52), o.hairMat, hd, 0, s[1] * 0.9, -0.012, s[0] * 1.06, s[1] * 1.06, s[2] * 1.05).rotation.x = -0.25;
  }
  // 턱 (096 은 비정상적으로 크게 벌어짐)
  const jaw = bone('jaw', hd, 0, s[1] * (is096 ? 0.55 : 0.5), is096 ? -0.01 : 0, B);
  mesh(sphere(1, 20, 12), o.skin, jaw, 0, -s[1] * 0.25, s[2] * 0.42, s[0] * 0.78, s[1] * 0.38, s[2] * 0.62);
  if (is096) {
    const tooth = new THREE.MeshStandardMaterial({ color: 0xcfc5a0, roughness: 0.4 });
    for (let i = 0; i < 8; i++) { const a = (i - 3.5) * 0.24; mesh(new THREE.BoxGeometry(0.01, 0.014, 0.008), tooth, jaw, Math.sin(a) * 0.045, -s[1] * 0.1, s[2] * 0.6 + Math.cos(a) * 0.03); }
    mesh(sphere(0.045, 12, 8), new THREE.MeshStandardMaterial({ color: 0x3a0c0c, roughness: 1 }), jaw, 0, -s[1] * 0.14, s[2] * 0.35, 1, 0.5, 1.2); // 혀
  }
  B.skull = skull;
}

function buildHand(hn, s, o, B, L) {
  const is096 = o.kind === '096';
  const palmG = new THREE.Group(); palmG.rotation.y = -s * Math.PI / 2; hn.add(palmG); // 손바닥이 몸 안쪽을 향함
  const pl = o.palmL;
  mesh(limbGeo(pl, o.armR * 0.75, o.armR * 0.8, 0.004, 10), o.skin, palmG, 0, 0, 0, 1.45, 1, 0.55);
  const fingers = [];
  const n = 4, fl = o.fingerL;
  for (let i = 0; i < n; i++) {
    const x = (i - 1.5) * o.armR * 0.36 * s, len = fl * [0.9, 1, 0.95, 0.78][i];
    const f0 = new THREE.Group(); f0.position.set(x, -pl, 0); palmG.add(f0);
    mesh(limbGeo(len * 0.55, o.fingerR, o.fingerR * 0.9), o.skin, f0);
    const f1 = new THREE.Group(); f1.position.y = -len * 0.55; f0.add(f1);
    mesh(limbGeo(len * 0.45, o.fingerR * 0.88, o.fingerR * 0.65), o.skin, f1);
    if (is096) { const nail = mesh(sphere(o.fingerR * 0.8, 6, 4), new THREE.MeshStandardMaterial({ color: 0xb8aa98, roughness: 0.3 }), f1, 0, -len * 0.42, o.fingerR * 0.5, 1, 1.4, 0.4); nail.castShadow = false; }
    fingers.push(f0, f1);
  }
  const th = new THREE.Group(); th.position.set(s * o.armR * 0.7, -pl * 0.25, o.armR * 0.25); th.rotation.set(0.5, 0, s * 0.5); palmG.add(th);
  mesh(limbGeo(fl * 0.6, o.fingerR * 1.1, o.fingerR * 0.8), o.skin, th);
  fingers.push(th);
  B['fingers' + L] = fingers;
}

function snapshot(B) { const r = {}; for (const k in B) if (B[k].isObject3D) r[k] = B[k].rotation.clone(); return r; }

// ── 포즈: 뼈 이름 → [x,y,z] 회전 + 부가 값(hipY, curlL, curlR, jaw…) 의 가중 합 ──
export class Pose {
  constructor() { this.r = {}; this.v = {}; }
  clear() { for (const k in this.r) this.r[k].fill(0); for (const k in this.v) this.v[k] = 0; return this; }
  rot(n, x = 0, y = 0, z = 0, w = 1) { const a = this.r[n] || (this.r[n] = [0, 0, 0]); a[0] += x * w; a[1] += y * w; a[2] += z * w; return this; }
  val(n, x, w = 1) { this.v[n] = (this.v[n] || 0) + x * w; return this; }
}

const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'legL', 'shinL', 'footL', 'legR', 'shinR', 'footR'];
export function applyPose(rig, P, dt, sharp = 14) {
  const k = 1 - Math.exp(-sharp * dt), B = rig.bones;
  for (const n of BONES) {
    const b = B[n]; if (!b) continue;
    const t = P.r[n] || ZERO;
    b.rotation.x += (t[0] - b.rotation.x) * k;
    b.rotation.y += (t[1] - b.rotation.y) * k;
    b.rotation.z += (t[2] - b.rotation.z) * k;
  }
  const hy = rig.hipH + (P.v.hipY || 0);
  B.hips.position.y += (hy - B.hips.position.y) * k;
  B.hips.position.z += ((P.v.hipZ || 0) - B.hips.position.z) * k;
  B.hips.position.x += ((P.v.hipX || 0) - B.hips.position.x) * k;
  for (const L of ['L', 'R']) {
    const c = P.v['curl' + L] || 0, f = B['fingers' + L];
    for (let i = 0; i < f.length - 1; i++) { const tgt = -c * (i % 2 ? 1.4 : 1.0) - 0.08; f[i].rotation.x += (tgt - f[i].rotation.x) * k; }
    const th = f[f.length - 1]; th.rotation.x += (0.5 - c * 0.4 - th.rotation.x) * k;
  }
}
const ZERO = [0, 0, 0];
