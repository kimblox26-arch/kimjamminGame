// ORBITER — 카메라
// 월드(미터) ↔ 화면(픽셀) 변환과 추적/줌/흔들림을 담당한다.
// 우주 규모 때문에 줌 배율은 로그 스케일로 다룬다.

import {
  clamp,
  lerp,
  damp,
  dampAngle,
  wrapPi,
  Vec2,
  rand,
  smoothstep,
} from '../core/math.js';

export const CAMERA_MODE = {
  FOLLOW: 'follow', // 기체 추적 (화면 고정 방향)
  LOCKED: 'locked', // 기체 자세에 맞춰 회전
  FREE: 'free', // 자유 이동
  ORBIT: 'orbit', // 천체 중심
  CINEMATIC: 'cinematic',
};

export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    /** 월드 좌표 중심 */
    this.pos = new Vec2(0, 0);
    this.targetPos = new Vec2(0, 0);
    /** 픽셀 per 미터 */
    this.zoom = 4;
    this.targetZoom = 4;
    this.minZoom = 1e-9;
    this.maxZoom = 80;
    /** 화면 회전 (rad) */
    this.rotation = 0;
    this.targetRotation = 0;
    this.mode = CAMERA_MODE.FOLLOW;

    this.smoothing = 0.001; // 1초 뒤 남는 비율
    this.zoomSmoothing = 0.0015;
    this.rotationSmoothing = 0.02;

    this.shake = 0;
    this.shakeDecay = 2.4;
    this.shakeOffset = new Vec2();
    this.shakeIntensity = 1;

    this.width = canvas?.width ?? 1280;
    this.height = canvas?.height ?? 720;
    this.dpr = 1;

    this.followTarget = null;
    this.lookAhead = 0.25;
    this.autoZoom = true;
  }

  resize(width, height, dpr = 1) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
  }

  /* ── 좌표 변환 ─────────────────────────────────────────── */

  /** 월드 → 화면 */
  worldToScreen(wx, wy, out = { x: 0, y: 0 }) {
    let dx = wx - this.pos.x;
    let dy = wy - this.pos.y;
    if (this.rotation !== 0) {
      const c = Math.cos(-this.rotation);
      const s = Math.sin(-this.rotation);
      const nx = dx * c - dy * s;
      dy = dx * s + dy * c;
      dx = nx;
    }
    out.x = this.width / 2 + dx * this.zoom + this.shakeOffset.x;
    // 화면 y 는 아래로 증가하므로 뒤집는다
    out.y = this.height / 2 - dy * this.zoom + this.shakeOffset.y;
    return out;
  }

  /** 화면 → 월드 */
  screenToWorld(sx, sy, out = new Vec2()) {
    let dx = (sx - this.width / 2 - this.shakeOffset.x) / this.zoom;
    let dy = -(sy - this.height / 2 - this.shakeOffset.y) / this.zoom;
    if (this.rotation !== 0) {
      const c = Math.cos(this.rotation);
      const s = Math.sin(this.rotation);
      const nx = dx * c - dy * s;
      dy = dx * s + dy * c;
      dx = nx;
    }
    out.x = this.pos.x + dx;
    out.y = this.pos.y + dy;
    return out;
  }

  /** 화면에 보이는 월드 영역 */
  viewBounds(margin = 1.15) {
    const halfW = (this.width / 2 / this.zoom) * margin;
    const halfH = (this.height / 2 / this.zoom) * margin;
    const r = Math.hypot(halfW, halfH);
    return {
      minX: this.pos.x - r,
      maxX: this.pos.x + r,
      minY: this.pos.y - r,
      maxY: this.pos.y + r,
      halfWidth: halfW,
      halfHeight: halfH,
      radius: r,
    };
  }

  /** 월드 반지름이 화면에서 몇 픽셀인가 */
  scaleLength(meters) {
    return meters * this.zoom;
  }

  /** 점이 화면 안에 있는가 (반지름 고려) */
  isVisible(wx, wy, radius = 0) {
    const b = this.viewBounds(1.05);
    return (
      wx + radius > b.minX &&
      wx - radius < b.maxX &&
      wy + radius > b.minY &&
      wy - radius < b.maxY
    );
  }

  /* ── 제어 ─────────────────────────────────────────────── */

  setTarget(x, y) {
    this.targetPos.set(x, y);
  }

  jumpTo(x, y) {
    this.pos.set(x, y);
    this.targetPos.set(x, y);
  }

  setZoom(z, immediate = false) {
    this.targetZoom = clamp(z, this.minZoom, this.maxZoom);
    if (immediate) this.zoom = this.targetZoom;
  }

  /** 배율 곱하기 (휠 입력) */
  zoomBy(factor) {
    this.setZoom(this.targetZoom * factor);
  }

  /** 마우스 위치를 기준으로 확대/축소 */
  zoomAt(screenX, screenY, factor) {
    const before = this.screenToWorld(screenX, screenY);
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    this.targetZoom = this.zoom;
    const after = this.screenToWorld(screenX, screenY);
    this.pos.x += before.x - after.x;
    this.pos.y += before.y - after.y;
    this.targetPos.copy(this.pos);
  }

  /** 지정한 월드 크기가 화면에 들어오도록 줌 설정 */
  fitWorldSize(meters, fill = 0.8) {
    const minDim = Math.min(this.width, this.height);
    this.setZoom((minDim * fill) / Math.max(meters, 1e-6));
  }

  setRotation(r, immediate = false) {
    this.targetRotation = r;
    if (immediate) this.rotation = r;
  }

  addShake(amount) {
    this.shake = Math.min(this.shake + amount, 40);
  }

  /* ── 갱신 ─────────────────────────────────────────────── */

  update(dt) {
    // 위치
    if (this.mode === CAMERA_MODE.FREE) {
      this.pos.x = damp(this.pos.x, this.targetPos.x, 0.0005, dt);
      this.pos.y = damp(this.pos.y, this.targetPos.y, 0.0005, dt);
    } else {
      this.pos.x = damp(this.pos.x, this.targetPos.x, this.smoothing, dt);
      this.pos.y = damp(this.pos.y, this.targetPos.y, this.smoothing, dt);
    }

    // 줌 — 로그 공간에서 보간해야 자연스럽다
    const lz = Math.log(Math.max(this.zoom, 1e-12));
    const lt = Math.log(Math.max(this.targetZoom, 1e-12));
    this.zoom = Math.exp(damp(lz, lt, this.zoomSmoothing, dt));

    // 회전
    this.rotation = dampAngle(
      this.rotation,
      this.targetRotation,
      this.rotationSmoothing,
      dt
    );

    // 흔들림
    if (this.shake > 0.001) {
      this.shake = Math.max(0, this.shake - this.shakeDecay * dt * (1 + this.shake * 0.1));
      const s = this.shake * this.shakeIntensity;
      this.shakeOffset.set(rand(-s, s), rand(-s, s));
    } else {
      this.shakeOffset.set(0, 0);
    }
  }

  /**
   * 기체를 추적한다.
   * @param {Vessel} vessel
   * @param {object} opts { lockRotation, autoZoom }
   */
  follow(vessel, opts = {}) {
    if (!vessel) return;
    const lead = this.lookAhead;
    this.setTarget(
      vessel.pos.x + vessel.vel.x * lead * 0.05,
      vessel.pos.y + vessel.vel.y * lead * 0.05
    );

    if (opts.lockRotation ?? this.mode === CAMERA_MODE.LOCKED) {
      this.setRotation(vessel.angle - Math.PI / 2);
    } else if (opts.alignToBody) {
      // 지표면이 항상 아래로 오도록
      const up = Math.atan2(vessel.pos.y, vessel.pos.x);
      this.setRotation(up - Math.PI / 2);
    }

    if (this.autoZoom && (opts.autoZoom ?? true)) {
      const alt = Math.max(vessel.terrainAltitude ?? vessel.altitude, 1);
      const size = Math.max(vessel.bounds?.length ?? 12, 6);
      // 저고도에서는 기체 크기, 고고도에서는 고도에 맞춘다
      const nearZoom = (Math.min(this.width, this.height) * 0.35) / size;
      const farZoom = (Math.min(this.width, this.height) * 0.4) / (alt * 2.2);
      const t = smoothstep(clamp((alt - size * 3) / (size * 40), 0, 1));
      this.setZoom(lerp(nearZoom, Math.max(farZoom, 0.002), t));
    }
  }

  /** 천체 전체가 보이도록 */
  frameBody(body, absPos, fill = 0.6) {
    this.setTarget(absPos.x, absPos.y);
    this.fitWorldSize(body.radius * 2.4, fill);
  }

  /** 두 점이 모두 보이도록 */
  frameTwo(a, b, padding = 1.6) {
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    this.setTarget(cx, cy);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    this.fitWorldSize(Math.max(d * padding, 100), 0.85);
  }

  /** 현재 축척을 사람이 읽을 수 있는 눈금으로 */
  scaleBar() {
    const targetPx = 140;
    const meters = targetPx / this.zoom;
    const pow = Math.pow(10, Math.floor(Math.log10(meters)));
    const candidates = [1, 2, 5, 10].map((m) => m * pow);
    let best = candidates[0];
    for (const c of candidates) {
      if (Math.abs(c * this.zoom - targetPx) < Math.abs(best * this.zoom - targetPx))
        best = c;
    }
    const px = best * this.zoom;
    let label;
    if (best >= 1e9) label = `${(best / 1e9).toFixed(0)} Gm`;
    else if (best >= 1e6) label = `${(best / 1e6).toFixed(0)} Mm`;
    else if (best >= 1000) label = `${(best / 1000).toFixed(0)} km`;
    else label = `${best.toFixed(0)} m`;
    return { pixels: px, label, meters: best };
  }
}

/**
 * 지도 뷰 전용 카메라 — 아주 넓은 범위를 다룬다.
 */
export class MapCamera extends Camera {
  constructor(canvas) {
    super(canvas);
    this.minZoom = 1e-12;
    this.maxZoom = 1e-2;
    this.zoom = 1e-6;
    this.targetZoom = 1e-6;
    this.smoothing = 0.0008;
    this.zoomSmoothing = 0.0008;
    this.autoZoom = false;
    this.focusBody = null;
    this.mode = CAMERA_MODE.ORBIT;
  }

  /** 특정 천체 SOI 전체가 보이도록 */
  focusOn(body, absPos) {
    this.focusBody = body;
    this.setTarget(absPos.x, absPos.y);
    const span = Number.isFinite(body.soi) ? body.soi * 2.2 : body.radius * 8;
    this.fitWorldSize(span, 0.75);
  }
}
