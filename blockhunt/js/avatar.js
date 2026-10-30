// 사용자가 준 사진의 아바타를 그대로 만든 캐릭터: 관절 리그 + 절차적 애니메이션 + 래그돌(넘어짐/죽음)
import * as THREE from 'three';
import { rbox, mat, clamp, lerp, damp, rand } from './util.js';
import { faceMaterial } from './faces.js';
import { G } from './game.js';

const JN = ['hips', 'waist', 'neck', 'shL', 'elL', 'wrL', 'shR', 'elR', 'wrR', 'hpL', 'knL', 'anL', 'hpR', 'knR', 'anR'];
const DOWN = new THREE.Vector3(0, -1, 0), UP = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _v = new THREE.Vector3(), _m = new THREE.Matrix4();
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
// 손에 든 물건: 모델의 -Z(총구)를 팔 방향(-Y)으로, 모델 위쪽을 손등 앞(+Z)으로
export const HOLD_Q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V3(-1, 0, 0), V3(0, 0, 1), V3(0, 1, 0)));

// 사진에서 잰 치수 (단위: 스터드, 바닥 = 0)
export const HIP_Y = 2.11, EYE_Y = 4.85;
const RED = '#dc3033', GREY = '#a9aab6', WHITE = '#efeff3';
const lin = (pts, y) => {
  if (y <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (y <= pts[i][0]) { const [y0, v0] = pts[i - 1], [y1, v1] = pts[i]; return v0 + ((v1 - v0) * (y - y0)) / (y1 - y0); }
  return pts[pts.length - 1][1];
};
// 둥근 상자를 높이에 따라 폭·두께를 바꿔 모양을 맞춤
function shaped(w, h, d, r, fx, fz, fy) {
  const g = rbox(w, h, d, r, 3).clone(), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) + h / 2) / h;
    p.setX(i, p.getX(i) * (fx ? fx(t) : 1));
    p.setZ(i, p.getZ(i) * (fz ? fz(t) : 1));
    if (fy) p.setY(i, fy(p.getX(i), p.getY(i), p.getZ(i)));
  }
  g.computeBoundingSphere();
  return g;
}
// 몸통(셔츠): 높이마다 폭이 다른 둥근 사각 단면을 쌓아 만든다 — 위는 곧고, 허리에서 들어가고, 밑단은 살짝 퍼짐
const TORSO_W = [[2.11, 1.66], [2.3, 1.6], [2.6, 1.55], [2.85, 1.56], [3.1, 1.72], [3.35, 1.92], [3.55, 2.0], [4.15, 2.02]];
const TORSO_D = [[2.11, 1.0], [3.9, 1.0], [4.15, 0.88]];
function torsoGeo(y0, y1, r = 0.16, bev = 0.07) {
  const K = 5, cs = [];
  for (const [sx, sz, a0] of [[1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI], [1, -1, Math.PI * 1.5]])
    for (let k = 0; k <= K; k++) { const a = a0 + (k / K) * (Math.PI / 2); cs.push([sx, sz, Math.cos(a), Math.sin(a)]); }
  const N = cs.length, rings = [], mid = (y0 + y1) / 2;
  const ys = [];
  for (let i = 0; i <= 24; i++) ys.push(y0 + bev + ((y1 - y0 - 2 * bev) * i) / 24);
  const ring = (y, w, d, rr) => cs.map(([sx, sz, c, sn]) => [sx * (w / 2 - rr) + c * rr, y - mid, sz * (d / 2 - rr) + sn * rr]);
  rings.push(ring(y0, lin(TORSO_W, y0) - 2 * bev, lin(TORSO_D, y0) - 2 * bev, r - bev / 2));
  for (const y of ys) rings.push(ring(y, lin(TORSO_W, y), lin(TORSO_D, y), r));
  rings.push(ring(y1, lin(TORSO_W, y1) - 2 * bev, lin(TORSO_D, y1) - 2 * bev, r - bev / 2));
  const pos = [], idx = [];
  for (const rg of rings) for (const v of rg) pos.push(...v);
  for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < N; k++) {
    const a = i * N + k, b = i * N + ((k + 1) % N), c = a + N, d = b + N;
    idx.push(a, b, d, a, d, c);
  }
  const bot = pos.length / 3; pos.push(0, y0 - mid, 0);
  const top = bot + 1; pos.push(0, y1 - mid, 0);
  const L = (rings.length - 1) * N;
  for (let k = 0; k < N; k++) { idx.push(bot, (k + 1) % N, k); idx.push(top, L + k, L + ((k + 1) % N)); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
// 머리: 위아래 모서리가 둥근 원기둥 (사진의 기본 머리)
const HR = 0.59, HH = 1.13, HRT = 0.24, HRB = 0.16;
const HEAD_GEO = (() => {
  const pts = [new THREE.Vector2(0, -HH / 2)];
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2); pts.push(new THREE.Vector2(HR - HRB + Math.cos(a) * HRB, -HH / 2 + HRB + Math.sin(a) * HRB)); }
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); pts.push(new THREE.Vector2(HR - HRT + Math.cos(a) * HRT, HH / 2 - HRT + Math.sin(a) * HRT)); }
  pts.push(new THREE.Vector2(0, HH / 2));
  const g = new THREE.LatheGeometry(pts, 40);
  g.computeVertexNormals();
  return g;
})();
const headR = (y) => {
  if (y > HH / 2 - HRT) { const d = y - (HH / 2 - HRT); return HR - HRT + Math.sqrt(Math.max(0, HRT * HRT - d * d)); }
  if (y < -HH / 2 + HRB) { const d = -HH / 2 + HRB - y; return HR - HRB + Math.sqrt(Math.max(0, HRB * HRB - d * d)); }
  return HR;
};
// 얼굴 판: 사진에서 1 스터드 = 234px 로 잘라낸 얼굴을 머리 곡면에 붙임
const FACE_GEO = (() => {
  const g = new THREE.PlaneGeometry(1, 1, 16, 16), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const r = headR(p.getY(i)), x = p.getX(i); p.setZ(i, Math.sqrt(Math.max(0, r * r - x * x)) + 0.006); }
  g.computeVertexNormals();
  return g;
})();
const LOGO = new THREE.MeshLambertMaterial({ map: (() => { const t = new THREE.TextureLoader().load('./logo.png'); t.colorSpace = THREE.SRGBColorSpace; return t; })(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

export class Avatar {
  constructor(owner = null) {
    this.owner = owner;
    this.root = new THREE.Group();
    this.j = {}; this.parts = []; this.tgt = {};
    for (const n of JN) this.tgt[n] = new THREE.Vector3();
    this.t = rand(0, 10); this.ph = 0; this.amp = 0; this.step = 0;
    this.fl = new THREE.Vector3();
    this.rag = null; this.faceKey = '';
    const red = mat(RED), grey = mat(GREY), white = mat(WHITE);
    const J = (n, parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); this.j[n] = o; return o; };
    const P = (parent, part, geo, m, x, y, z) => {
      const me = new THREE.Mesh(geo, m);
      me.position.set(x, y, z); me.castShadow = true;
      me.userData = { kind: 'part', owner, part };
      parent.add(me); this.parts.push(me);
      return me;
    };
    const hips = J('hips', this.root, 0, HIP_Y, 0);
    const waist = J('waist', hips, 0, 0, 0);
    this.torso = P(waist, 'torso', torsoGeo(2.11, 4.15), red, 0, 1.02, 0);
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.51, 0.51), LOGO);
    logo.position.set(0.46, 3.73 - 3.13, 0.505);
    this.torso.add(logo);
    const neck = J('neck', waist, 0, 2.04, 0);
    this.head = P(neck, 'head', HEAD_GEO, white, 0, 0.55, 0);
    this.face = new THREE.Mesh(FACE_GEO, faceMaterial('neutral'));
    this.head.add(this.face);
    for (const [n, s] of [['L', 1], ['R', -1]]) {
      const sh = J('sh' + n, waist, 1.2 * s, 1.83, 0);
      P(sh, 'arm', shaped(0.8, 1.05, 0.86, 0.28, (t) => lerp(0.92, 1, t)), white, 0.03 * s, -0.35, 0);
      const el = J('el' + n, sh, 0, -0.74, 0);
      P(el, 'arm', shaped(0.76, 0.9, 0.86, 0.07, (t) => lerp(1.02, 0.95, t)), white, 0, -0.3, 0);
      const wr = J('wr' + n, el, 0, -0.68, 0);
      P(wr, 'arm', shaped(0.7, 0.82, 0.8, 0.1, (t) => lerp(0.92, 1, t)), white, 0, -0.38, 0);
      P(wr, 'arm', rbox(0.24, 0.46, 0.32, 0.08, 2), white, -0.32 * s, -0.3, 0.26);
      const hp = J('hp' + n, hips, 0.44 * s, 0, 0);
      P(hp, 'leg', rbox(0.64, 0.88, 0.8, 0.12), grey, 0, -0.38, 0);
      P(hp, 'leg', rbox(0.66, 0.12, 0.82, 0.04), red, 0, -0.76, 0);
      const kn = J('kn' + n, hp, 0, -0.82, 0);
      P(kn, 'leg', shaped(0.64, 0.92, 0.74, 0.1, (t) => lerp(1.2, 1, t), (t) => lerp(1.12, 1, t)), white, 0, -0.44, 0);
      const an = J('an' + n, kn, 0, -0.88, 0);
      P(an, 'leg', shaped(0.78, 0.42, 1.0, 0.12, null, null, (x, y, z) => (y > 0 && z > 0.1 ? y * lerp(1, 0.3, Math.min(1, (z - 0.1) / 0.4)) : y)), white, 0, -0.2, 0.08);
    }
  }

  setFace(emo) {
    if (emo === this.faceKey) return;
    this.faceKey = emo;
    this.face.material = faceMaterial(emo);
  }
  hold(model) {
    if (this.held) this.held.removeFromParent();
    this.held = model;
    if (!model) return;
    model.position.set(0, -0.36, 0);
    model.quaternion.copy(HOLD_Q);
    this.j.wrR.add(model);
  }
  setHeadVisible(v) { this.head.visible = v; }
  flinch(dir, part) {
    this.fl.x += clamp(dir.z, -1, 1) * (part === 'head' ? 0.2 : 0.45);
    this.fl.z += clamp(-dir.x, -1, 1) * 0.3;
  }
  update(dt, p) {
    if (this.rag) this.stepRagdoll(dt);
    else this.animate(dt, p);
  }

  // ───────── 절차적 애니메이션: 서기·걷기·달리기·웅크리기·무릎 꿇기·기어가기·일어나기·운전 ─────────
  animate(dt, p) {
    const T = this.tgt;
    for (const n of JN) T[n].set(0, 0, 0);
    const t = (this.t += dt);
    const mode = p.mode || 'stand';
    let hy = HIP_Y, hz = 0, k = p.k || 12;
    const sp = p.speed || 0, run = p.run || 0;
    if (mode === 'stand') {
      this.ph += dt * sp * lerp(1.45, 1.0, run);
      this.amp = damp(this.amp, clamp(sp / 7, 0, 1) * lerp(0.62, 1.1, run), 8, dt);
      const a = this.amp, s = Math.sin(this.ph), c = Math.cos(this.ph), idle = 1 - clamp(a * 2, 0, 1);
      T.hpL.x = -s * a; T.hpR.x = s * a;
      T.knL.x = 0.04 + a * 1.35 * Math.max(0, c); T.knR.x = 0.04 + a * 1.35 * Math.max(0, -c);
      T.shL.x = s * a * 0.85; T.shR.x = -s * a * 0.85;
      T.shL.z = 0.16 + Math.sin(t * 1.6) * 0.02 * idle; T.shR.z = -T.shL.z;
      T.elL.x = T.elR.x = -0.08 - run * a * 1.25;
      T.waist.x = 0.04 * a + 0.22 * run * a + Math.sin(t * 1.6) * 0.015 * idle;
      T.waist.y = s * 0.14 * a; T.hips.y = -s * 0.1 * a;
      T.neck.x = -T.waist.x * 0.6;
      hy = HIP_Y - 0.1 * run * a + 0.12 * a * (Math.abs(c) - 0.5);
      if (p.flail) {
        T.shL.x = -2.6 + Math.sin(t * 13) * 0.45; T.shR.x = -2.6 + Math.sin(t * 13 + 2) * 0.45;
        T.shL.z = 0.45; T.shR.z = -0.45; T.elL.x = T.elR.x = -0.4;
      }
      if (p.handsUp) { T.shL.x = T.shR.x = -2.85 + Math.sin(t * 25) * 0.03; T.shL.z = 0.32; T.shR.z = -0.32; T.elL.x = T.elR.x = -0.35; }
      if (p.aim) {
        const pt = p.aimPitch || 0;
        T.shR.x = -1.57 - pt; T.shR.z = 0.05; T.elR.x = 0;
        T.shL.x = -1.45 - pt; T.shL.z = -0.62; T.elL.x = -0.35;
        T.waist.y += 0.12; T.neck.y -= 0.12;
      } else if (p.hold) { T.shR.x = -0.3; T.elR.x = -1.0; }
      if (p.grab) { T.shL.x = T.shR.x = -1.55; T.shL.z = -0.35; T.shR.z = 0.35; T.elL.x = T.elR.x = -0.2; T.waist.x += 0.25; k = 20; }
      if (p.punch > 0) {
        const u = 1 - p.punch;
        if (u < 0.3) { T.shR.x = -0.8; T.elR.x = -2.1; T.waist.y += 0.35; }
        else if (u < 0.6) { T.shR.x = -1.65; T.shR.z = 0.15; T.elR.x = -0.05; T.waist.y -= 0.4; }
        k = 22;
      }
      if (a > 0.3) {
        const st = Math.floor(this.ph / Math.PI);
        if (st !== this.step) { this.step = st; if (this.onStep) this.onStep(a); }
      }
    } else if (mode === 'cower') {
      hy = 1.3; hz = -0.4;
      T.hpL.x = T.hpR.x = -1.3; T.hpL.z = 0.12; T.hpR.z = -0.12; T.knL.x = T.knR.x = 2.0;
      T.waist.x = 0.7; T.neck.x = 0.45;
      T.shL.x = T.shR.x = -2.5; T.shL.z = 0.6; T.shR.z = -0.6; T.elL.x = T.elR.x = -2.0;
    } else if (mode === 'kneel') {
      hy = 1.14;
      T.knL.x = T.knR.x = 1.57;
      if (p.pose === 'mourn') {
        T.waist.x = 0.6 + Math.sin(t * 8) * 0.04; T.neck.x = 0.5;
        T.shL.x = T.shR.x = -2.1; T.shL.z = -0.5; T.shR.z = 0.5; T.elL.x = T.elR.x = -2.3;
      } else {
        T.waist.x = 0.25 + Math.sin(t * 3) * 0.12; T.neck.x = -0.3;
        T.shL.x = T.shR.x = -1.15; T.shL.z = -0.42; T.shR.z = 0.42; T.elL.x = T.elR.x = -1.1;
      }
    } else if (mode === 'crawl') {
      this.ph += dt * sp * 2.4;
      const s = Math.sin(this.ph), c = Math.cos(this.ph);
      T.hips.x = 1.42; T.hips.z = s * 0.08 * Math.min(1, sp); hy = 0.55;
      T.shL.x = -2.2 - 0.6 * s; T.shR.x = -2.2 + 0.6 * s; T.shL.z = 0.3; T.shR.z = -0.3;
      T.elL.x = -0.5 - 0.5 * Math.max(0, c); T.elR.x = -0.5 - 0.5 * Math.max(0, -c);
      T.hpL.x = 0.1 + 0.15 * s; T.hpR.x = 0.1 - 0.15 * s; T.hpL.z = 0.1; T.hpR.z = -0.1;
      T.knL.x = 0.25 + 0.4 * Math.max(0, -s); T.knR.x = 0.25 + 0.4 * Math.max(0, s);
      T.neck.x = -0.95; T.waist.x = -0.05 + Math.sin(t * 2) * 0.03;
      k = 8;
    } else if (mode === 'getup') {
      k = 5;
      if (p.g < 0.5) {
        hy = 1.05;
        T.hpL.x = -1.0; T.hpR.x = -0.2; T.knL.x = 1.6; T.knR.x = 1.9; T.waist.x = 0.6;
        T.shL.x = T.shR.x = -0.6; T.elL.x = T.elR.x = -0.5;
      }
    } else if (mode === 'drive') {
      const st = p.steer || 0;
      T.hpL.x = T.hpR.x = -1.45; T.knL.x = T.knR.x = 1.35;
      T.shL.x = -1.2 - st * 0.25; T.shR.x = -1.2 + st * 0.25; T.shL.z = -0.3; T.shR.z = 0.3;
      T.elL.x = T.elR.x = -0.55; T.waist.x = -0.08;
      k = 15;
    }
    T.neck.y += clamp(p.lookYaw || 0, -1.1, 1.1);
    T.neck.x += clamp(-(p.lookPitch || 0), -0.7, 0.6);
    if (p.shake) { T.waist.z += Math.sin(t * 37) * 0.035 * p.shake; T.neck.z += Math.sin(t * 31) * 0.05 * p.shake; }
    T.waist.add(this.fl);
    this.fl.multiplyScalar(Math.exp(-7 * dt));
    const f = 1 - Math.exp(-k * dt);
    for (const n of JN) { const v = T[n]; _e.set(v.x, v.y, v.z); this.j[n].quaternion.slerp(_q.setFromEuler(_e), f); }
    const hp = this.j.hips.position, fh = 1 - Math.exp(-(mode === 'getup' ? 4 : k) * dt);
    hp.x += (0 - hp.x) * fh; hp.y += (hy - hp.y) * fh; hp.z += (hz - hp.z) * fh;
  }

  // ───────── 래그돌 (Verlet 입자 + 거리 제약) ─────────
  startRagdoll(vel, hitPoint, impulse) {
    if (this.rag) { if (hitPoint) this.impulse(hitPoint, impulse || vel); else this.push(vel); return; }
    this.root.updateMatrixWorld(true);
    const j = this.j, w = (o, x = 0, y = 0, z = 0) => o.localToWorld(new THREE.Vector3(x, y, z));
    const p = [w(j.hips), w(j.neck), w(j.neck, 0, 0.55, 0), w(j.shL), w(j.shR), w(j.elL), w(j.elR), w(j.wrL, 0, -0.4, 0), w(j.wrR, 0, -0.4, 0),
      w(j.hpL), w(j.hpR), w(j.knL), w(j.knR), w(j.anL, 0, -0.15, 0.08), w(j.anR, 0, -0.15, 0.08)];
    const h = 1 / 60;
    const o = p.map((q) => q.clone().addScaledVector(vel, -h));
    const c = [];
    const add = (a, b, min = 0) => c.push([a, b, p[a].distanceTo(p[b]) * (min || 1), !!min]);
    const torso = [0, 1, 3, 4, 9, 10];
    for (let a = 0; a < torso.length; a++) for (let b = a + 1; b < torso.length; b++) add(torso[a], torso[b]);
    [[2, 1], [2, 3], [2, 4], [2, 0], [3, 5], [5, 7], [4, 6], [6, 8], [9, 11], [11, 13], [10, 12], [12, 14]].forEach(([a, b]) => add(a, b));
    add(3, 7, 0.55); add(4, 8, 0.55); add(9, 13, 0.7); add(10, 14, 0.7); add(7, 1, 0.4); add(8, 1, 0.4);
    this.rag = { p, o, c, acc: 0, still: 0, sleep: false, boxes: [] };
    if (hitPoint && impulse) this.impulse(hitPoint, impulse);
  }
  push(v) {
    const R = this.rag; if (!R) return;
    for (let i = 0; i < R.p.length; i++) R.o[i].addScaledVector(v, -1 / 60);
    R.sleep = false; R.still = 0;
  }
  impulse(point, dv) {
    const R = this.rag; if (!R) return;
    let best = 0, bd = Infinity;
    R.p.forEach((q, i) => { const d = q.distanceToSquared(point); if (d < bd) { bd = d; best = i; } });
    const h = 1 / 60;
    R.o[best].addScaledVector(dv, -h);
    for (const [a, b] of R.c) { if (a === best) R.o[b].addScaledVector(dv, -h * 0.3); else if (b === best) R.o[a].addScaledVector(dv, -h * 0.3); }
    R.sleep = false; R.still = 0;
  }
  stepRagdoll(dt) {
    const R = this.rag;
    if (!R.sleep) {
      R.acc += Math.min(dt, 0.05);
      const h = 1 / 60;
      if (R.acc >= h) R.boxes = G.world ? G.world.boxesNear(R.p[0], 9) : [];
      while (R.acc >= h) { R.acc -= h; this.ragStep(h); }
    }
    this.applyRagdoll();
  }
  ragStep(h) {
    const R = this.rag, { p, o, c } = R;
    const g = 196.2 * h * h;
    let energy = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[i], r = o[i];
      const vx = (q.x - r.x) * 0.996, vy = (q.y - r.y) * 0.996, vz = (q.z - r.z) * 0.996;
      energy += vx * vx + vy * vy + vz * vz;
      r.copy(q);
      q.x += vx; q.y += vy - g; q.z += vz;
    }
    for (let it = 0; it < 6; it++) {
      for (const [a, b, rest, min] of c) {
        const A = p[a], B = p[b];
        _v.subVectors(B, A);
        const L = _v.length() || 1e-6;
        if (min && L >= rest) continue;
        _v.multiplyScalar(((L - rest) / L) * 0.5);
        A.add(_v); B.sub(_v);
      }
      for (let i = 0; i < p.length; i++) {
        const q = p[i], r = RAD[i];
        if (q.y < r) q.y = r;
        for (const bx of R.boxes) pushOut(q, r, bx);
      }
    }
    for (let i = 0; i < p.length; i++) {
      if (p[i].y <= RAD[i] + 0.03) { o[i].x += (p[i].x - o[i].x) * 0.15; o[i].z += (p[i].z - o[i].z) * 0.15; }
    }
    if (energy < 8e-4) { if (++R.still > 70) R.sleep = true; } else R.still = 0;
  }
  get settled() { return this.rag && (this.rag.sleep || this.rag.still > 25); }
  applyRagdoll() {
    const P = this.rag.p, j = this.j;
    const rp = this.root.position;
    rp.set(P[0].x, 0, P[0].z);
    const irq = _qi.copy(this.root.quaternion).invert();
    const up = _a.subVectors(P[1], P[0]).normalize();
    const xr = _b.subVectors(P[9], P[10]); xr.addScaledVector(up, -xr.dot(up)).normalize();
    _c.crossVectors(xr, up);
    const qPel = _q1.setFromRotationMatrix(_m.makeBasis(xr, up, _c));
    const xs = _b.subVectors(P[3], P[4]); xs.addScaledVector(up, -xs.dot(up)).normalize();
    _c.crossVectors(xs, up);
    const qCh = _q2.setFromRotationMatrix(_m.makeBasis(xs, up, _c));
    j.hips.position.copy(P[0]).sub(rp).applyQuaternion(irq);
    j.hips.quaternion.copy(irq).multiply(qPel);
    j.waist.quaternion.copy(qPel).invert().multiply(qCh);
    this.limb(j.neck, qCh, P[1], P[2], UP, _q3);
    this.limb(j.shL, qCh, P[3], P[5], DOWN, _qa); this.limb(j.elL, _qa, P[5], P[7], DOWN, _qb);
    this.limb(j.shR, qCh, P[4], P[6], DOWN, _qa); this.limb(j.elR, _qa, P[6], P[8], DOWN, _qb);
    this.limb(j.hpL, qPel, P[9], P[11], DOWN, _qa); this.limb(j.knL, _qa, P[11], P[13], DOWN, _qb);
    this.limb(j.hpR, qPel, P[10], P[12], DOWN, _qa); this.limb(j.knR, _qa, P[12], P[14], DOWN, _qb);
  }
  limb(joint, qParent, a, b, ref, outQ) {
    _v.subVectors(b, a).normalize().applyQuaternion(_q.copy(qParent).invert());
    joint.quaternion.setFromUnitVectors(ref, _v);
    return outQ.copy(qParent).multiply(joint.quaternion);
  }
  // 래그돌을 끝내고 일어날/기어갈 준비: 쓰러진 방향을 보고 몸의 방향을 정한다
  endRagdoll() {
    const P = this.rag.p;
    const up = _a.subVectors(P[1], P[0]).normalize();
    const xr = _b.subVectors(P[9], P[10]).normalize();
    const front = _c.crossVectors(xr, up);
    let hd = this.root.rotation.y;
    if (Math.hypot(up.x, up.z) > 0.3) hd = front.y > 0 ? Math.atan2(-up.x, -up.z) : Math.atan2(up.x, up.z);
    this.root.rotation.set(0, hd, 0);
    this.applyRagdoll();
    this.rag = null;
    return hd;
  }
  ragCenter() { return this.rag ? this.rag.p[0] : this.j.hips.getWorldPosition(new THREE.Vector3()); }
}
const RAD = [0.48, 0.48, 0.58, 0.42, 0.42, 0.33, 0.33, 0.33, 0.33, 0.4, 0.4, 0.35, 0.35, 0.25, 0.25];
function pushOut(q, r, b) {
  if (q.x < b.min.x - r || q.x > b.max.x + r || q.z < b.min.z - r || q.z > b.max.z + r || q.y < b.min.y - r || q.y > b.max.y + r) return;
  const dx1 = q.x - (b.min.x - r), dx2 = b.max.x + r - q.x, dz1 = q.z - (b.min.z - r), dz2 = b.max.z + r - q.z, dy = b.max.y + r - q.y;
  const m = Math.min(dx1, dx2, dz1, dz2, dy);
  if (m === dy) q.y = b.max.y + r;
  else if (m === dx1) q.x = b.min.x - r;
  else if (m === dx2) q.x = b.max.x + r;
  else if (m === dz1) q.z = b.min.z - r;
  else q.z = b.max.z + r;
}
