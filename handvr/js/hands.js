// 손 추적 결과 → 게임 좌표 변환, 필터링, 제스처 인식
import * as THREE from 'three';
import { HandProfile } from './scan.js';
import { FingerPose } from './finger-pose.js';

export const FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
export const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

export const WEBCAM_HFOV = THREE.MathUtils.degToRad(62); // 일반 노트북 웹캠 수평 화각
const SCREEN_GAIN = 1.08;   // 카메라 화면 가장자리 = 게임 시야 가장자리
const Y_OFFSET = -0.05;     // 손을 살짝 아래에
const EYE_REACH = 0.32;     // 기준 자세에서 손이 눈앞 몇 m 에 오는가

// 사용자-웹캠 거리 기준값. 처음 손이 보일 때 자동 보정 (K 키로 재보정)
export const DEPTH = { userDist: 0.75, calibrated: false, samples: [] };
export function recalibrateDepth() { DEPTH.calibrated = false; DEPTH.samples.length = 0; }

class OneEuro {
  constructor(minCutoff, beta, dCutoff = 1.0) { this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff; this.x = null; this.dx = 0; }
  static a(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v, dt) {
    if (this.x === null) { this.x = v; this.dx = 0; return v; }
    const dv = (v - this.x) / dt;
    this.dx += OneEuro.a(this.dCutoff, dt) * (dv - this.dx);
    this.x += OneEuro.a(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (v - this.x);
    return this.x;
  }
}
class VecFilter {
  constructor(min, beta, minZ = min) { this.f = [new OneEuro(min, beta), new OneEuro(min, beta), new OneEuro(minZ, beta)]; }
  apply(v, dt) { v.x = this.f[0].filter(v.x, dt); v.y = this.f[1].filter(v.y, dt); v.z = this.f[2].filter(v.z, dt); return v; }
  reset() { for (const f of this.f) f.x = null; }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const vec21 = () => Array.from({ length: 21 }, () => new THREE.Vector3());

export class HandState {
  constructor(side) {
    this.side = side;                 // 'L' | 'R' (사용자의 실제 왼손/오른손)
    this.sign = side === 'R' ? 1 : -1; // 손바닥 법선 방향 부호
    this.visible = false;
    this.lastSeen = -1e9;
    this.lastT = 0;
    this.snap = true;
    this.img = Array.from({ length: 21 }, () => ({ x: 0, y: 0 })); // 원본 카메라 정규화 좌표
    this.img2 = Array.from({ length: 21 }, () => ({ x: 0, y: 0 })); // 같은 좌표, 픽셀 단위
    this.local = vec21();   // 손 모양 (m, 플레이어 기준 축, 중지 MCP 원점)
    this.target = vec21();  // 카메라(눈) 공간 목표 관절 위치
    this.joints = vec21();  // 화면 표시용(보간된) 관절 위치
    this.palmCam = new THREE.Vector3();
    this.posFilter = new VecFilter(1.2, 3.0, 0.7);
    this.shapeFilters = Array.from({ length: 21 }, () => new VecFilter(2.2, 12));
    this.gesture = 'none';
    this.cand = 'none';
    this.candN = 0;
    this.pinching = false;
    this.pinchD = 1;
    this.profile = new HandProfile(side); // 손 스캔 결과 (굵기·손바닥·손목·피부색·소매)
    this.scanTick = 0;
    this.fingerPose = new FingerPose(); // 손가락 펴짐/접힘 판단
    this.pose = null;                    // 판단 결과 (손 모델이 씀)
    this.elbow = null;                   // 팔꿈치 쪽 방향 (몸 인식, 없으면 null)
  }

  // fr: { W, H, view, now, lostMs, scanner, video, stamp }
  ingest(lm, wl, fr) {
    const { W, H, view, now, lostMs } = fr;
    const reappear = !this.visible || now - this.lastSeen > lostMs;
    const dt = reappear ? 1 / 30 : Math.max(1 / 120, (now - this.lastT) / 1000);
    this.lastT = now;
    this.lastSeen = now;
    if (reappear) {
      this.posFilter.reset();
      for (const f of this.shapeFilters) f.reset();
      this.snap = true;
      this.cand = 'none'; this.candN = 0; this.pinching = false;
      this.fingerPose.reset();
    }
    this.visible = true;
    for (let i = 0; i < 21; i++) { this.img[i].x = lm[i].x; this.img[i].y = lm[i].y; }

    // ── 깊이 추정: 실제 손 크기(m, world landmark) ÷ 화면상 크기(px) × 초점거리
    const f = (W / 2) / Math.tan(WEBCAM_HFOV / 2);
    let sw = 0, si = 0;
    for (let i = 0; i < 21; i++) {
      if (i === 9) continue;
      sw += Math.hypot(wl[i].x - wl[9].x, wl[i].y - wl[9].y);
      si += Math.hypot((lm[i].x - lm[9].x) * W, (lm[i].y - lm[9].y) * H);
    }
    const Z = si > 1 ? THREE.MathUtils.clamp(f * sw / si, 0.12, 2.5) : 0.45;
    if (!DEPTH.calibrated) {
      DEPTH.samples.push(Z);
      const avg = DEPTH.samples.reduce((s, v) => s + v, 0) / DEPTH.samples.length;
      DEPTH.userDist = avg + EYE_REACH;
      if (DEPTH.samples.length >= 45) DEPTH.calibrated = true;
    }
    const d = THREE.MathUtils.clamp(DEPTH.userDist - Z, 0.13, 0.9);

    // ── 화면 위치: 카메라 영상을 거울처럼 뒤집어 게임 시야에 매핑
    const nx = -(lm[9].x - 0.5) * 2 * SCREEN_GAIN;
    const ny = -(lm[9].y - 0.5) * 2 * SCREEN_GAIN;
    _a.set(nx * view.tanH * d, ny * view.tanV * d + Y_OFFSET, -d);
    this.palmCam.copy(this.posFilter.apply(_a, dt));

    // ── 손 모양: MediaPipe 3D 관절(미터 단위, 손 모양 사전지식이 들어간 추정)을 그대로 사용
    //    → 카메라 각도가 바뀌어도 뼈 길이·비율이 일정하게 유지된다.
    //    카메라 좌표(x 오른쪽, y 아래, z 멀어짐) → 플레이어 시점 (x→-x, y→-y, z→z) : 회전이라 손의 좌우(키랄성) 유지
    const depth = i => Z + (wl[i].z - wl[9].z);
    for (let i = 0; i < 21; i++) {
      _b.set(-(wl[i].x - wl[9].x), -(wl[i].y - wl[9].y), wl[i].z - wl[9].z);
      this.local[i].copy(this.shapeFilters[i].apply(_b, dt));
      this.target[i].copy(this.palmCam).add(this.local[i]);
    }
    this.classify(now);
    for (let i = 0; i < 21; i++) { this.img2[i].x = lm[i].x * W; this.img2[i].y = lm[i].y * H; }
    this.pose = this.fingerPose.update(this.local, this.sign, now, this.img2);
    // 손 스캔 (아직 안 끝났을 때만, 2프레임에 한 번)
    if (fr.scanner && !this.profile.done && (this.scanTick++ & 1) === 0) fr.scanner.observe(this, lm, depth, fr.video, fr.stamp);
  }

  classify(now) {
    const w = this.local;
    const palm = w[0].distanceTo(w[9]) || 0.09;
    const st = [], out = [];
    for (const [a, b, c, d] of FINGERS) {
      st.push(w[a].distanceTo(w[d]) / (w[a].distanceTo(w[b]) + w[b].distanceTo(w[c]) + w[c].distanceTo(w[d]) + 1e-6));
      out.push(w[d].distanceTo(w[0]) / (w[b].distanceTo(w[0]) + 1e-6));
    }
    const ext = i => st[i] > 0.82 && out[i] > 1.1;
    const cur = i => st[i] < 0.66 || out[i] < 1.0;
    const four = [1, 2, 3, 4];
    // 엄지 펴짐: 엄지(2→4)가 곧고, 끝이 검지 둘째 마디에서 떨어져 있음 (주먹이면 엄지가 손가락 위에 붙는다)
    const thumbOut = w[2].distanceTo(w[4]) / (w[2].distanceTo(w[3]) + w[3].distanceTo(w[4]) + 1e-6) > 0.88 && w[4].distanceTo(w[6]) / palm > 0.55;
    this.pinchD = w[4].distanceTo(w[8]) / palm;

    let g = 'relaxed';
    if (four.every(cur)) {
      g = thumbOut && _c.subVectors(w[4], w[2]).normalize().y > 0.55 ? 'thumbsUp' : 'fist';
    } else if ((this.pinching ? this.pinchD < 0.45 : this.pinchD < 0.3) && st[1] > 0.45) g = 'pinch';
    else if (ext(1) && cur(2) && cur(3) && cur(4)) g = 'point';
    else if (ext(1) && ext(2) && cur(3) && cur(4)) g = 'victory';
    else if (four.every(ext)) g = 'open';
    this.pinching = g === 'pinch';

    // 떨림 방지: 같은 결과가 몇 프레임 이어져야 확정
    if (g === this.cand) this.candN++; else { this.cand = g; this.candN = 1; }
    const need = (g === 'pinch' || this.gesture === 'pinch') ? 2 : 3;
    if (g !== this.gesture && this.candN >= need) { this.gesture = g; this.gestureSince = now; }
  }

  // 매 렌더 프레임: 추적 결과(초당 20~30번)를 화면 프레임에 맞춰 부드럽게 보간
  updateDisplay(dt, now, lostMs) {
    if (this.visible && now - this.lastSeen > lostMs) {
      this.visible = false;
      this.gesture = 'none';
    }
    if (!this.visible) return;
    const k = this.snap ? 1 : 1 - Math.exp(-dt * 24);
    for (let i = 0; i < 21; i++) this.joints[i].lerp(this.target[i], k);
    this.snap = false;
  }
}

// 손의 좌우(키랄성)를 3D 관절로 직접 계산: 엄지가 손바닥 쪽에 있다는 해부학적 사실 이용. + = 오른손
function chirality(wl) {
  const v = i => [wl[i].x - wl[0].x, wl[i].y - wl[0].y, wl[i].z - wl[0].z];
  const a = v(5), b = v(17), t = v(2);
  return (a[1] * b[2] - a[2] * b[1]) * t[0] + (a[2] * b[0] - a[0] * b[2]) * t[1] + (a[0] * b[1] - a[1] * b[0]) * t[2];
}

// MediaPipe 결과를 왼손/오른손 슬롯에 배정.
// MediaPipe 의 Left/Right 라벨은 손을 돌리거나 손등이 보일 때 가끔 뒤집힌다. 뒤집힌 프레임을 그대로 쓰면
// 손바닥 방향이 반대로 계산돼 굽힌 손가락이 펴진 것처럼 보이므로,
//   ① 라벨(신뢰도 가중) + 3D 모양(엄지가 손바닥 쪽)으로 '오른손 증거'를 만들고
//   ② 직전 프레임 위치와 가까운 손은 같은 손으로 이어 가며, 증거가 계속 반대일 때만 바꾼다.
export class HandAssigner {
  constructor() { this.slot = { L: { x: 0, y: 0, ev: 0 }, R: { x: 0, y: 0, ev: 0 } }; }

  assign(res, swap, hands, now, lostMs) {
    const out = { L: -1, R: -1 };
    const lms = res?.landmarks || [];
    const hd = res?.handedness || res?.handednesses || [];
    const cand = lms.map((lm, i) => {
      const c = hd[i]?.[0];
      const det = chirality(res.worldLandmarks[i]);
      let e = (c ? (c.categoryName === 'Right' ? 1 : -1) * c.score : 0) + Math.sign(det) * Math.min(1, Math.abs(det) / 0.06);
      if (swap) e = -e;
      return { i, e, x: lm[9].x, y: lm[9].y, size: Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y) };
    });
    if (cand.length === 2) {
      const [p, q] = cand;
      if (Math.hypot(p.x - q.x, p.y - q.y) < Math.max(p.size, q.size) * 0.6) cand.splice(Math.abs(p.e) >= Math.abs(q.e) ? 1 : 0, 1);
    }
    const live = s => hands[s].visible && now - hands[s].lastSeen < lostMs;
    const dist = (c, s) => Math.hypot(c.x - this.slot[s].x, c.y - this.slot[s].y);
    const other = s => (s === 'L' ? 'R' : 'L');
    if (cand.length === 1) {
      const c = cand[0];
      let side = ['L', 'R'].find(s => live(s) && dist(c, s) < 0.25) ?? null;
      if (side) {
        const sl = this.slot[side];
        sl.ev = sl.ev * 0.85 + (side === 'R' ? c.e : -c.e) * 0.15; // 이 슬롯이 맞다는 증거 (평균)
        if (sl.ev < -0.6) { side = other(side); this.slot[side].ev = 0.6; }
      } else {
        side = c.e >= 0 ? 'R' : 'L';
        this.slot[side].ev = Math.abs(c.e) / 2;
      }
      out[side] = c.i;
    } else if (cand.length >= 2) {
      const [a, b] = cand;
      const score = (r, l) => (r.e - l.e) - (live('R') ? dist(r, 'R') * 4 : 0) - (live('L') ? dist(l, 'L') * 4 : 0);
      if (score(a, b) >= score(b, a)) { out.R = a.i; out.L = b.i; } else { out.R = b.i; out.L = a.i; }
      for (const s of ['L', 'R']) { const c = cand.find(x => x.i === out[s]); this.slot[s].ev = this.slot[s].ev * 0.85 + (s === 'R' ? c.e : -c.e) * 0.15; }
    }
    // 한 손이 다른 칸으로 옮겨 갔으면 예전 칸은 바로 숨긴다 (같은 손이 두 개로 보이지 않게)
    for (const s of ['L', 'R']) {
      if (out[s] >= 0 || !live(s)) continue;
      if (cand.some(c => (out.L === c.i || out.R === c.i) && dist(c, s) < 0.15)) hands[s].lastSeen = -1e9;
    }
    for (const s of ['L', 'R']) if (out[s] >= 0) { const c = cand.find(x => x.i === out[s]); this.slot[s].x = c.x; this.slot[s].y = c.y; }
    return out;
  }
}

export const GESTURE_LABEL = {
  none: '—', relaxed: '✋ 기본', open: '🖐 손바닥', fist: '✊ 주먹', point: '☝️ 검지',
  victory: '✌️ 브이', thumbsUp: '👍 엄지척', pinch: '🤏 집기',
};
