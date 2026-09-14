// 고요(GOYO) — 공용 보조 함수
/**
 * 프레임레이트에 독립적인 지수 보간.
 * rate 는 "초당 수렴 속도"로, 값이 클수록 목표에 빨리 붙는다.
 * (core/utils.js 의 damp 는 감쇠 계수(0~1)를 받는 다른 규약이라 혼용하지 않는다)
 */
export const damp = (current, target, rate, dt) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));
