// FREE FREELY 우주 탐사 - 행성별 대기 물리 (고도별 밀도·압력·온도·음속)
// 지구는 기존 비행 시뮬레이터의 국제표준대기(src/physics/aero.js)를 그대로 쓰고,
// 다른 천체는 조성(평균 분자량)과 지수 감소 모델로 계산한다.
import { atmosphere as isaAtmosphere } from '../physics/aero.js';

const R_GAS = 8.314462;

/** @returns {density kg/m³, pressure Pa, temperature K, sound m/s, factor 0..1} */
export function atmosphereAt(body, alt, out = {}) {
  const a = body && body.atmo;
  if (!a) { out.density = 0; out.pressure = 0; out.temperature = 3; out.sound = 300; out.factor = 0; return out; }
  if (a.isa) {
    if (alt > a.top) { out.density = 0; out.pressure = 0; out.temperature = 186; out.sound = 280; out.factor = 0; return out; }
    const s = isaAtmosphere(alt);
    out.density = s.density; out.pressure = s.pressure; out.temperature = s.temperature; out.sound = s.speedOfSound;
  } else {
    const M = body.molarMass;
    let T, p;
    if (alt >= 0) {
      T = Math.max(a.Tmin, a.T0 - a.lapse * alt);
      p = a.p0 * Math.exp(-alt / a.H);
    } else {
      // 기체 행성 깊은 곳: 단열 압축으로 온도·압력 급상승
      const depth = -alt;
      T = a.T0 + depth * 0.0021 * (body.gas ? 1 : 0.3);
      p = a.p0 * Math.exp(depth / (a.H * 0.9));
    }
    if (alt > a.top) p = 0;
    out.pressure = p;
    out.temperature = T;
    out.density = (p * M) / (R_GAS * T);
    const gamma = M < 0.006 ? 1.42 : M > 0.04 ? 1.3 : 1.4;
    out.sound = Math.sqrt((gamma * R_GAS * T) / M);
  }
  out.factor = Math.min(1, out.pressure / 101325);
  return out;
}
