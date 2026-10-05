// SpaceSim — 쌍성계: Kepler-16 주쌍성 행성 + 불안정 영역 시험 행성
import { NBodyScenario } from './nbody-base.js';
import { G_AU, AU_KM, RSUN_KM, fmtDuration } from '../util.js';

const KM = 1 / AU_KM;
const ORIGIN = { x: 0, y: 0, z: 0 };

export class BinaryScenario extends NBodyScenario {
  constructor(app) {
    super(app, { G: G_AU, dtMax: 0.0002, primary: 'stars', trailLen: 520, merge: true, adaptive: true, eta: 0.02, minFocus: 0.06 });
    this.build();
  }

  build() {
    const mA = 0.6897, mB = 0.20255, a = 0.22431, e = 0.15944, M = mA + mB;
    // 원점(apoastron) 배치
    const r = a * (1 + e), v = Math.sqrt((G_AU * M * (1 - e)) / (a * (1 + e)));
    this.A = this.addBody({
      name: 'Kepler-16 A', type: 'K형 주계열성', kind: 'star', temp: 4450, m: mA, visR: 0.042, realR: 0.6489 * RSUN_KM * KM,
      p: [(-r * mB) / M, 0, 0], v: [0, 0, (v * mB) / M], trailDt: 0.0006, trailLen: 260, glow: 3, rotRate: 20,
      desc: '태양 질량의 69%인 주황색 K형 왜성. 동반성과 41일 주기로 서로를 공전합니다.',
    });
    this.B = this.addBody({
      name: 'Kepler-16 B', type: 'M형 적색왜성', kind: 'star', temp: 3311, m: mB, visR: 0.026, realR: 0.22623 * RSUN_KM * KM, lightW: 0.45,
      p: [(r * mA) / M, 0, 0], v: [0, 0, (-v * mA) / M], trailDt: 0.0006, trailLen: 260, glow: 3, rotRate: 25,
      desc: '태양 질량의 20%인 적색왜성. 두 별이 행성의 하늘에 두 개의 해를 띄웁니다.',
    });
    const planet = (o) => {
      const rr = o.a, vc = Math.sqrt((G_AU * (M + o.m)) / rr) * (o.vk ?? 1), ang = o.ang;
      return this.addBody({
        ...o, p: [Math.cos(ang) * rr, 0, Math.sin(ang) * rr], v: [-Math.sin(ang) * vc, 0, Math.cos(ang) * vc],
        trailDt: (Math.pow(rr, 1.5) / Math.sqrt(M)) / 300, trailLen: 420,
      });
    };
    planet({
      name: 'Kepler-16b', type: '주쌍성 가스 행성 (실존)', a: 0.7048, ang: 1.2, m: 3.18e-4, visR: 0.034, realR: 52700 * KM, style: 'gas', tilt: 4,
      look: { colA: 0xd9c9a8, colB: 0x9c8466, colC: 0xeee4d0, bands: 12, atmo: 0xd8c8b0, atmoDensity: 0.4 }, color: 0xe0c8a0, rotRate: 300,
      desc: '2011년 케플러 우주망원경이 발견한 최초의 주쌍성 행성. 영화 스타워즈의 "타투인"처럼 두 개의 태양을 가집니다.',
    });
    planet({
      name: '가상 행성 c', type: '가상의 얼음 행성', a: 1.45, ang: 3.6, m: 4e-6, visR: 0.026, realR: 7000 * KM, style: 'europa', tilt: 12,
      look: { colA: 0xdfe8f0, colB: 0xb8c8d8, colC: 0x6a7f99 }, color: 0xcfe0ff, rotRate: 1500,
      desc: '안정 영역 바깥쪽에 놓은 가상의 행성. 쌍성의 섭동을 받으면서도 오랫동안 궤도를 유지합니다.',
    });
    planet({
      name: '불안정 행성', type: '가상의 암석 행성 (불안정 영역)', a: 0.43, ang: 5.0, m: 2e-6, visR: 0.02, realR: 6000 * KM, style: 'lava', heat: 0,
      look: { colA: 0x3a2a24, colB: 0x6a4a3a, spot: 0 }, color: 0xff9a7a, rotRate: 1500,
      desc: '쌍성 궤도의 약 2배 이내는 역학적으로 불안정합니다. 이 행성은 결국 튕겨 나가거나 별과 충돌합니다.',
    });
    this.sim.toCOM();
    this.sim.computeAcc();
  }

  get warp() { return { min: 1 / 365.25 / 4, max: 4, def: 0.08, fmt: (w) => `${fmtDuration(w)}/초` }; }

  start() {
    const c = this.app.controls;
    c.minR = 0.01; c.maxR = 60; c.minNear = 1e-5; c.minFar = 0;
    c.follow = null; c.target.set(0, 0, 0);
    c.set({ theta: 0.3, phi: 0.7, radius: 14, jump: true });
    c.set({ theta: 0.6, phi: 1.0, radius: 3.4 });
  }

  clock() { return { main: `${(this.sim.time * 365.25).toFixed(1)} 일`, sub: `쌍성 공전 ${((this.sim.time * 365.25) / 41.08).toFixed(1)}회` }; }

  panel() {
    return [
      { type: 'chips', label: '천체로 이동', items: this.bodies.filter((b) => b.label).map((b) => ({ label: b.name, on: () => !b.dead && this.select(b, true) })) },
      { type: 'chips', label: '시점', items: [{ label: '쌍성 중심', on: () => { this.select(null); const c = this.app.controls; c.focus(() => ORIGIN, 3.4); } }] },
      { type: 'readouts', items: ['천체 수', '에너지 보존 오차', '적분 스텝/프레임'] },
      { type: 'hint', text: '실측 궤도 요소: 쌍성 a = 0.224 AU, e = 0.159, P = 41.1일 · 행성 a = 0.705 AU, P = 229일 (Doyle et al. 2011).' },
    ];
  }

  readouts() {
    return {
      '천체 수': String(this.sim.n),
      '에너지 보존 오차': this.dE ? this.dE.toExponential(2) : '—',
      '적분 스텝/프레임': `${this.sim.lastSteps || 0}${this.lagging ? ' ⚠' : ''}`,
    };
  }
}
