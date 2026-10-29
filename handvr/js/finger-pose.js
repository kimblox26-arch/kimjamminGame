// 손가락 모양 판단기
// 카메라가 준 관절 좌표를 그대로 따라가지 않고, 손가락마다 "얼마나 접혔는지"를 각도로 읽어서
//   ① 펴짐 / 반쯤 / 접힘 으로 판단하고 (오락가락하지 않게 문턱에 여유를 둠)
//   ② 펴짐이면 곧게, 접힘이면 자연스러운 주먹 모양 쪽으로 끌어당기고
//   ③ 끝마디는 사람 손처럼 둘째 마디에 맞춰 함께 굽게(약 0.7배) 하고
//   ④ 말이 안 되는 프레임(손 크기가 갑자기 변함, 손 좌우가 뒤집힘, 각도가 비정상)은 버리고 직전 모양을 유지한다.
// 결과는 손 모델(hand-rig.js)이 관절 각도로 그대로 쓴다.
import * as THREE from 'three';
import { FINGERS } from './hands.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const V = () => new THREE.Vector3();

// 손가락 이름, 상태 이름
export const FINGER_NAME = ['엄지', '검지', '중지', '약지', '소지'];
export const STATE_NAME = { ext: '펴짐', half: '반쯤', fold: '접힘' };

// 관절 범위 (도)
const RANGE = { m: [-25, 95], a: [-25, 25], p: [-5, 110], d: [-5, 85], t1: [-20, 65], t2: [-25, 85] };
// 접힘 상태의 자연스러운 주먹 각도 / 펴짐 상태
const FIST = { m: 82, p: 100, d: 68 };
const ASSIST = 0.55; // 판단한 상태 쪽으로 끌어당기는 정도

class OneEuro {
  constructor(minCutoff, beta) { this.minCutoff = minCutoff; this.beta = beta; this.x = null; this.dx = 0; }
  static a(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v, dt) {
    if (this.x === null) { this.x = v; this.dx = 0; return v; }
    const dv = (v - this.x) / dt;
    this.dx += OneEuro.a(1, dt) * (dv - this.dx);
    this.x += OneEuro.a(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (v - this.x);
    return this.x;
  }
  reset() { this.x = null; }
}

// 손바닥 좌표계에서 본 각도들. basis: { F, L(엄지쪽), U(손바닥쪽), H(굽힘 축) }
function signedAngle(a, b, axis) {
  const pa = a.clone().addScaledVector(axis, -a.dot(axis)).normalize();
  const pb = b.clone().addScaledVector(axis, -b.dot(axis)).normalize();
  return Math.atan2(V().crossVectors(pa, pb).dot(axis), pa.dot(pb));
}

// 엄지가 굽을 때 향하는 쪽(손바닥 + 새끼 쪽)과 그 경첩 축
export function thumbHinge(dir, B) {
  const h = V().crossVectors(dir, V().copy(B.U).addScaledVector(B.L, -0.6).normalize());
  return h.lengthSq() < 1e-6 ? B.H.clone() : h.normalize();
}

// 관절 21개(같은 좌표계)에서 손가락 각도 읽기 (도 단위). P(i): 관절 위치
export function measureAngles(P, B) {
  const D = (i, j) => V().subVectors(P(j), P(i)).normalize();
  const palm = P(0).distanceTo(P(9)) || 1;
  const out = { fingers: [], thumb: null };
  for (let f = 1; f < 5; f++) {
    const [a, b, c, d] = FINGERS[f];
    const d0 = D(a, b), d1 = D(b, c), d2 = D(c, d);
    out.fingers[f] = {
      m: Math.atan2(d0.dot(B.U), d0.dot(B.F)) / DEG,
      a: Math.asin(clamp(d0.dot(B.L), -1, 1)) / DEG,
      p: signedAngle(d0, d1, B.H) / DEG,
      d: signedAngle(d1, d2, B.H) / DEG,
      // 손끝이 손목에서 얼마나 멀리 있는지 (곧게 펴면 약 1.9, 주먹이면 약 1.0) — 각도보다 흔들림에 강함
      reach: P(0).distanceTo(P(d)) / (P(0).distanceTo(P(a)) || 1),
    };
  }
  const t0 = D(1, 2), t1 = D(2, 3), t2 = D(3, 4), h = thumbHinge(t0, B);
  out.thumb = {
    dir: new THREE.Vector3(t0.dot(B.F), t0.dot(B.L), t0.dot(B.U)),
    t1: signedAngle(t0, t1, h) / DEG, t2: signedAngle(t1, t2, h) / DEG, // + = 손바닥 쪽으로 굽힘, − = 뒤로 젖힘
    tipRing: P(4).distanceTo(P(13)) / palm,   // 엄지 끝 ↔ 약지 뿌리 (손바닥을 가로질러 접으면 가까움)
  };
  return out;
}

export function palmBasis(P0, P5, P9, P17, sign) {
  const F = V().subVectors(P9, P0).normalize();
  const L = V().subVectors(P5, P17); L.addScaledVector(F, -L.dot(F)).normalize();
  const U = V().crossVectors(V().subVectors(P5, P0), V().subVectors(P17, P0)).multiplyScalar(sign);
  U.addScaledVector(F, -U.dot(F)).normalize();
  const H = V().crossVectors(F, U).normalize(); // 이 축으로 +회전 = 손바닥 쪽으로 굽힘
  return { F, L, U, H };
}

export class FingerPose {
  constructor() {
    this.f = [null, 1, 2, 3, 4].map(() => ({ m: new OneEuro(3, 0.02), a: new OneEuro(2, 0.02), p: new OneEuro(3, 0.02), d: new OneEuro(3, 0.02) }));
    this.tf = { x: new OneEuro(2.5, 0.5), y: new OneEuro(2.5, 0.5), z: new OneEuro(2.5, 0.5), t1: new OneEuro(3, 0.02), t2: new OneEuro(3, 0.02) };
    this.state = ['ext', 'ext', 'ext', 'ext', 'ext'];
    this.out = null;     // 마지막으로 확정한 손가락 각도
    this.sizes = [];     // 손바닥 크기 기록 (이상한 프레임 걸러내기)
    this.lastT = 0;
    this.rejected = 0;
  }

  reset() {
    for (const g of this.f) if (g) for (const k in g) g[k].reset();
    for (const k in this.tf) this.tf[k].reset();
    this.out = null; this.sizes.length = 0; this.rejected = 0;
  }

  // 카메라 화면(2D)에서 본 손끝 거리. 손바닥 길이가 비스듬히 줄어 보여도 손바닥 폭으로 보정해서,
  // 3D 추정이 틀려(특히 손등이 보일 때) 펴진 손가락을 굽었다고 보는 일을 막는다
  reach2d(img, local, a, t) {
    const d2 = (i, j) => Math.hypot(img[i].x - img[j].x, img[i].y - img[j].y);
    const w3 = local[5].distanceTo(local[17]) || 1;
    const den = Math.max(d2(0, a), d2(5, 17) * local[0].distanceTo(local[a]) / w3);
    return den > 1 ? d2(0, t) / den : 0;
  }

  // local: 3D 관절(미터, 플레이어 시점 축), sign: 이 손 모델의 좌우(+1 오른손), img: 화면 관절(픽셀, 없어도 됨)
  update(local, sign, now, img) {
    // 이번 프레임 3D 모양의 좌우 (엄지가 손바닥 쪽): + = 오른손. 분명하면 그 기준으로 각도를 재서
    // 왼손/오른손 판정이 잠깐 틀려도 손가락이 뒤로 꺾여 보이지 않게
    const a = V().subVectors(local[5], local[0]), b = V().subVectors(local[17], local[0]), c = V().subVectors(local[2], local[0]);
    const det = V().crossVectors(a, b).dot(c) / Math.max(1e-9, local[0].distanceTo(local[9]) ** 3);
    const hand = Math.abs(det) > 0.02 ? Math.sign(det) : sign;
    const dt = this.lastT ? clamp((now - this.lastT) / 1000, 1 / 120, 0.2) : 1 / 30;
    this.lastT = now;
    // ── 이상한 프레임 거르기
    const size = local[0].distanceTo(local[9]);
    if (this.sizes.length >= 8) {
      const sorted = [...this.sizes].sort((x, y) => x - y), med = sorted[sorted.length >> 1];
      const bad = Math.abs(size / med - 1) > 0.35;
      if (bad && this.out && this.rejected < 8) { this.rejected++; return this.out; }
    }
    this.rejected = 0;
    this.sizes.push(size); if (this.sizes.length > 30) this.sizes.shift();

    const B = palmBasis(local[0], local[5], local[9], local[17], hand);
    const raw = measureAngles(i => local[i], B);

    const fingers = [null];
    this.debug = { det, curl: [] };
    for (let f = 1; f < 5; f++) {
      const r = raw.fingers[f], g = this.f[f];
      const reach = img ? Math.max(r.reach, this.reach2d(img, local, FINGERS[f][0], FINGERS[f][3])) : r.reach;
      let m = clamp(r.m, ...RANGE.m), p = clamp(r.p, ...RANGE.p);
      let d = clamp(0.5 * clamp(r.d, ...RANGE.d) + 0.5 * 0.72 * p, ...RANGE.d); // 끝마디는 둘째 마디와 함께
      // ── 상태 판단 (펴짐 / 반쯤 / 접힘): 관절 각도 + 손끝 거리를 함께 보고, 문턱에 여유
      const angCurl = (Math.max(0, m) / FIST.m + Math.max(0, p) / FIST.p + Math.max(0, d) / FIST.d) / 3;
      const reachCurl = clamp((1.75 - reach) / (1.75 - 1.0), 0, 1);
      const curl = 0.4 * angCurl + 0.6 * reachCurl;
      this.debug.curl[f] = `${curl.toFixed(2)}(a${angCurl.toFixed(2)} r${reach.toFixed(2)})`;
      const st = this.state[f];
      this.state[f] = curl > (st === 'fold' ? 0.56 : 0.64) ? 'fold' : curl < (st === 'ext' ? 0.36 : 0.3) ? 'ext' : 'half';
      if (this.state[f] === 'fold') { m += (FIST.m - m) * ASSIST; p += (FIST.p - p) * ASSIST; d += (FIST.d - d) * ASSIST; }
      else if (this.state[f] === 'ext') { m += (clamp(m, -10, 30) - m) * ASSIST; p *= 1 - ASSIST; d *= 1 - ASSIST; }
      fingers[f] = {
        m: g.m.filter(m, dt), p: g.p.filter(p, dt), d: g.d.filter(d, dt),
        a: g.a.filter(clamp(r.a, ...RANGE.a), dt),
        state: this.state[f],
      };
    }
    // ── 네 손가락 벌림 순서 유지: 검지 > 중지 > 약지 > 소지 (엄지 쪽이 +). 서로 파고들거나 겹치지 않게
    for (let pass = 0; pass < 2; pass++) for (let f = 1; f < 4; f++) {
      const g = 3;
      if (fingers[f + 1].a > fingers[f].a - g) { const mid = (fingers[f].a + fingers[f + 1].a) / 2; fingers[f].a = mid + g / 2; fingers[f + 1].a = mid - g / 2; }
    }
    // ── 엄지: 뿌리 방향(손바닥 기준) + 두 마디 굽힘
    const t = raw.thumb, tf = this.tf;
    const dir = new THREE.Vector3(tf.x.filter(t.dir.x, dt), tf.y.filter(t.dir.y, dt), tf.z.filter(t.dir.z, dt)).normalize();
    let t1 = clamp(t.t1, ...RANGE.t1), t2 = clamp(t.t2, ...RANGE.t2);
    // 엄지 접힘: 굽힘 각도보다 '엄지 끝이 손바닥 안쪽(검지·약지 뿌리)에 가까운지'를 더 믿는다
    const angFold = (Math.max(0, t1) / 60 + Math.max(0, t2) / 80) / 2;
    const tipFold = clamp((0.9 - t.tipRing) / 0.4, 0, 1);
    const tc = 0.35 * angFold + 0.65 * tipFold;
    this.debug.thumb = `${tc.toFixed(2)}(a${angFold.toFixed(2)} tipR${t.tipRing.toFixed(2)} t1 ${t.t1.toFixed(0)} t2 ${t.t2.toFixed(0)})`;
    const ts = this.state[0];
    this.state[0] = tc > (ts === 'fold' ? 0.5 : 0.6) ? 'fold' : tc < (ts === 'ext' ? 0.3 : 0.22) ? 'ext' : 'half';
    if (this.state[0] === 'ext') { t1 *= 1 - ASSIST * 0.6; t2 *= 1 - ASSIST * 0.6; }
    const thumb = { dir, t1: tf.t1.filter(t1, dt), t2: tf.t2.filter(t2, dt), state: this.state[0] };

    this.out = { fingers, thumb };
    return this.out;
  }
}
