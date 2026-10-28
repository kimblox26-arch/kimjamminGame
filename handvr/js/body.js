// 몸(상체) 추적 → 이동 입력
// 처음 1.5초 동안 기준 자세를 잡고, 그 자세에서 얼마나 벗어났는지로 조작한다.
//   어깨가 커짐(카메라 쪽으로 숙임) = 전진, 작아짐 = 후진
//   어깨 중심이 좌/우로 이동 = 회전,  머리가 빠르게 올라감 = 점프,  크게 내려감 = 웅크리기
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class BodyControl {
  constructor() {
    this.out = { forward: 0, turn: 0, crouch: false, jump: false, label: '', seen: false };
    this.recalibrate();
  }

  recalibrate() { this.base = null; this.samples = []; this.calibUntil = 0; this.prevUp = 0; this.prevT = 0; this.jumpCool = 0; this.sm = null; }

  update(lms, aspect, now) {
    const o = this.out;
    o.jump = false;
    const n = lms?.[0], l = lms?.[11], r = lms?.[12];
    if (!n || !l || !r || Math.min(l.visibility ?? 1, r.visibility ?? 1) < 0.5) {
      o.forward = o.turn = 0; o.crouch = false; o.seen = false;
      o.label = '몸이 보이지 않아요 (어깨까지 화면에)';
      return o;
    }
    o.seen = true;
    // 떨림 줄이기 (지수 평활)
    const raw = { w: Math.hypot((l.x - r.x) * aspect, l.y - r.y), mx: (l.x + r.x) / 2, ny: n.y };
    if (!this.sm) this.sm = raw;
    else for (const k in raw) this.sm[k] += (raw[k] - this.sm[k]) * 0.5;
    const { w, mx, ny } = this.sm;
    if (w < 0.06) {
      o.forward = o.turn = 0; o.crouch = false;
      o.label = '조금 더 가까이 / 어깨가 보이게 앉아주세요';
      return o;
    }
    if (!this.base) {
      if (!this.calibUntil) this.calibUntil = now + 1500;
      this.samples.push({ w, mx, ny });
      o.forward = o.turn = 0; o.crouch = false;
      o.label = '기준 자세 잡는 중… 편하게 정면을 보세요';
      if (now >= this.calibUntil && this.samples.length >= 5) {
        const avg = k => this.samples.reduce((s, v) => s + v[k], 0) / this.samples.length;
        this.base = { w: avg('w'), mx: avg('mx'), ny: avg('ny') };
        o.label = '기준 자세 저장!';
      }
      return o;
    }
    const b = this.base;
    const lean = w / b.w - 1;                    // + = 카메라 쪽으로
    const side = -(mx - b.mx) * aspect / b.w;    // + = 사용자 오른쪽 (영상은 좌우 반대)
    const up = (b.ny - ny) / b.w;                // + = 머리가 위로

    o.forward = lean > 0.05 ? clamp((lean - 0.05) / 0.12, 0, 1) : lean < -0.05 ? -clamp((-lean - 0.05) / 0.1, 0, 1) : 0;
    o.turn = Math.abs(side) > 0.12 ? Math.sign(side) * clamp((Math.abs(side) - 0.12) / 0.3, 0, 1) : 0;
    o.crouch = up < -0.45;
    const dt = (now - this.prevT) / 1000;
    const vUp = dt > 0 && dt < 0.3 ? (up - this.prevUp) / dt : 0;
    this.prevUp = up; this.prevT = now;
    if (vUp > 1.6 && up > 0.08 && now > this.jumpCool) { o.jump = true; this.jumpCool = now + 900; }

    const parts = [];
    if (o.forward > 0) parts.push('전진'); else if (o.forward < 0) parts.push('후진');
    if (o.turn > 0) parts.push('오른쪽 회전'); else if (o.turn < 0) parts.push('왼쪽 회전');
    if (o.crouch) parts.push('웅크리기');
    if (o.jump) parts.push('점프!');
    o.label = parts.join(' · ') || '정지';
    return o;
  }
}
