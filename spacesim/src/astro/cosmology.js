// SpaceSim — 우주론 계산기
// 프리드만 방정식 기반 거리·시간 척도, 척도인자 a(t) 적분, 지평선 계산.

import { SI, h0ToInvGyr } from '../core/constants.js';

export const PLANCK18 = { H0: 67.66, Om: 0.3111, Ol: 0.6889, Or: 9.182e-5, name: 'Planck 2018' };
export const WMAP9 = { H0: 69.32, Om: 0.2865, Ol: 0.7135, Or: 9.0e-5, name: 'WMAP9' };
export const EDS = { H0: 70, Om: 1.0, Ol: 0, Or: 0, name: '아인슈타인-드지터' };
export const OPEN = { H0: 70, Om: 0.3, Ol: 0, Or: 0, name: '열린 우주 (Λ=0)' };

export class Cosmology {
  constructor(p = PLANCK18) {
    this.set(p);
  }

  set(p) {
    this.H0 = p.H0;
    this.Om = p.Om;
    this.Ol = p.Ol;
    this.Or = p.Or ?? 0;
    this.name = p.name ?? 'custom';
    this.Ok = 1 - this.Om - this.Ol - this.Or;
    this.hubbleTime = 1 / h0ToInvGyr(this.H0);     // Gyr
    this.hubbleDistance = (SI.c / 1e3) / this.H0;  // Mpc
    return this;
  }

  /** E(z) = H(z)/H0 */
  E(z) {
    const z1 = 1 + z;
    return Math.sqrt(this.Or * z1 ** 4 + this.Om * z1 ** 3 + this.Ok * z1 ** 2 + this.Ol);
  }

  /** H(z) [km/s/Mpc] */
  H(z) { return this.H0 * this.E(z); }

  /** 임계밀도 [kg/m^3] */
  criticalDensity(z = 0) {
    const H = this.H(z) * 1e3 / (1e6 * SI.pc);
    return 3 * H * H / (8 * Math.PI * SI.G);
  }

  /** 공변거리 [Mpc] — 심프슨 적분 */
  comovingDistance(z, n = 2000) {
    if (z <= 0) return 0;
    const f = (zz) => 1 / this.E(zz);
    return this.hubbleDistance * simpson(f, 0, z, n);
  }

  /** 횡단 공변거리 (곡률 보정) */
  transverseComoving(z) {
    const Dc = this.comovingDistance(z);
    if (Math.abs(this.Ok) < 1e-6) return Dc;
    const sk = Math.sqrt(Math.abs(this.Ok)) * Dc / this.hubbleDistance;
    return this.Ok > 0
      ? this.hubbleDistance / Math.sqrt(this.Ok) * Math.sinh(sk)
      : this.hubbleDistance / Math.sqrt(-this.Ok) * Math.sin(sk);
  }

  angularDiameterDistance(z) { return this.transverseComoving(z) / (1 + z); }
  luminosityDistance(z) { return this.transverseComoving(z) * (1 + z); }
  distanceModulus(z) { return 5 * Math.log10(this.luminosityDistance(z) * 1e6) - 5; }

  /** 후퇴시간 [Gyr] */
  lookbackTime(z, n = 2000) {
    if (z <= 0) return 0;
    const f = (zz) => 1 / ((1 + zz) * this.E(zz));
    return this.hubbleTime * simpson(f, 0, z, n);
  }

  /** 적색편이 z 시점의 우주 나이 [Gyr] */
  age(z = 0, n = 4000) {
    const f = (x) => {
      // x ∈ (0,1] 치환: zz = 1/x - 1
      const zz = 1 / x - 1;
      return 1 / (x * x * (1 + zz) * this.E(zz));
    };
    const xm = 1 / (1 + z);
    return this.hubbleTime * simpson(f, 1e-8, xm, n);
  }

  /** 입자 지평선 (공변) [Mpc] */
  particleHorizon(z = 0, n = 4000) {
    const f = (x) => {
      const zz = 1 / x - 1;
      return 1 / (x * x * this.E(zz));
    };
    return this.hubbleDistance * simpson(f, 1e-8, 1 / (1 + z), n);
  }

  /** 사건 지평선 (Λ 우주에서 유한) [Mpc] */
  eventHorizon(z = 0, n = 4000) {
    if (this.Ol <= 0) return Infinity;
    const f = (x) => {
      const zz = 1 / x - 1;
      return 1 / (x * x * this.E(zz));
    };
    return this.hubbleDistance * simpson(f, 1 / (1 + z), 1, n);
  }

  /** 각크기 [arcsec] ← 실제 크기 [kpc] */
  angularSize(sizeKpc, z) {
    const Da = this.angularDiameterDistance(z) * 1e3; // kpc
    return (sizeKpc / Da) * 206264.806;
  }

  /** 척도인자 미분방정식 da/dt = a·H0·E(z(a)) 를 RK4 로 적분 */
  scaleFactorHistory({ aStart = 1e-4, aEnd = 12, steps = 4000 } = {}) {
    const Hi = h0ToInvGyr(this.H0); // 1/Gyr
    const da = (a) => {
      const z1 = 1 / a;
      return a * Hi * Math.sqrt(
        this.Or * z1 ** 4 + this.Om * z1 ** 3 + this.Ok * z1 ** 2 + this.Ol,
      );
    };
    // t(a) 를 역으로 적분해서 a=1 (현재) 을 t=age 로 맞춘다
    const pts = [];
    let a = aStart, t = 0;
    const lnEnd = Math.log(aEnd / aStart);
    const h = lnEnd / steps;
    for (let i = 0; i <= steps; i++) {
      pts.push({ a, t, H: da(a) / a, z: 1 / a - 1 });
      // d t / d(ln a) = 1 / (da/dt / a)
      const f = (aa) => aa / da(aa);
      const a1 = a, a2 = a * Math.exp(h / 2), a3 = a * Math.exp(h);
      t += h / 6 * (f(a1) + 4 * f(a2) + f(a3));
      a = a3;
    }
    const now = this.age(0);
    // a=1 지점의 t 를 찾아 현재 나이에 맞춰 평행이동
    let t1 = 0;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i - 1].a <= 1 && pts[i].a >= 1) {
        const f = (1 - pts[i - 1].a) / (pts[i].a - pts[i - 1].a);
        t1 = pts[i - 1].t + f * (pts[i].t - pts[i - 1].t);
        break;
      }
    }
    const shift = now - t1;
    for (const p of pts) p.t += shift;
    return pts;
  }

  /** 요약 리포트 */
  report(z) {
    return {
      z,
      E: this.E(z),
      H: this.H(z),
      comoving: this.comovingDistance(z),
      transverse: this.transverseComoving(z),
      angular: this.angularDiameterDistance(z),
      luminosity: this.luminosityDistance(z),
      modulus: this.distanceModulus(z),
      lookback: this.lookbackTime(z),
      ageAtZ: this.age(z),
      ageNow: this.age(0),
      horizon: this.particleHorizon(0),
      eventHorizon: this.eventHorizon(0),
      lightTravelGly: this.lookbackTime(z) * 1e9 * SI.jyr * SI.c / SI.ly / 1e9,
      rhoCrit: this.criticalDensity(0),
      Ok: this.Ok,
    };
  }
}

function simpson(f, a, b, n) {
  if (n % 2) n++;
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return s * h / 3;
}

/** 적색편이 ↔ 속도 (상대론적 도플러) */
export const zToVelocity = (z) => {
  const r = (1 + z) ** 2;
  return SI.c / 1e3 * (r - 1) / (r + 1); // km/s
};

/** 주요 우주사 이정표 */
export const EPOCHS = [
  { z: 1e9, name: '빅뱅 핵합성', note: '~3분, T≈10⁹ K' },
  { z: 3400, name: '물질-복사 동등', note: 'ρ_m = ρ_r' },
  { z: 1100, name: '재결합 / CMB', note: '우주가 투명해짐' },
  { z: 20, name: '최초의 별 (Pop III)', note: '우주 암흑기 종료' },
  { z: 7, name: '재이온화 완료', note: '' },
  { z: 2, name: '우주 별형성 정점', note: 'cosmic noon' },
  { z: 0.3, name: '가속팽창 시작', note: 'Λ 지배 시작' },
  { z: 0, name: '현재', note: '' },
];
