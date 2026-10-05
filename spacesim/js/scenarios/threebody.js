// SpaceSim — 삼체 문제: 주기 해(8자·나비·나방), 라그랑주 정삼각형, 피타고라스 혼돈
import { NBodyScenario } from './nbody-base.js';
import { fmtNum } from '../util.js';

const PRESETS = {
  figure8: {
    label: '8자 궤도', period: 6.32591398,
    desc: 'Chenciner–Montgomery (2000): 같은 질량의 세 별이 하나의 8자 곡선을 따라 서로를 쫓는 안정한 주기 해.',
    init: () => {
      const x1 = [-0.97000436, 0.24308753], v3 = [-0.93240737, -0.86473146];
      return [[1, x1, [-v3[0] / 2, -v3[1] / 2]], [1, [-x1[0], -x1[1]], [-v3[0] / 2, -v3[1] / 2]], [1, [0, 0], v3]];
    },
  },
  butterfly: {
    label: '나비 I', period: 6.2356,
    desc: 'Šuvakov–Dmitrašinović (2013)가 발견한 새로운 주기 해 계열. 수치 오차가 쌓이면 결국 혼돈으로 붕괴합니다.',
    init: () => sym(0.306893, 0.125507),
  },
  moth: { label: '나방 I', period: 14.8939, desc: 'Šuvakov–Dmitrašinović 주기 해. 불안정하여 작은 섭동에도 궤도가 무너집니다.', init: () => sym(0.464445, 0.39606) },
  lagrange: {
    label: '라그랑주 삼각형', period: 2 * Math.PI,
    desc: '라그랑주(1772)의 정삼각형 해: 세 별이 정삼각형을 유지하며 회전. 같은 질량에서는 불안정합니다.',
    init: () => {
      const out = [], R = 1, w = Math.sqrt(1 / (Math.sqrt(3) * R ** 3));
      for (let k = 0; k < 3; k++) {
        const a = (k * 2 * Math.PI) / 3;
        out.push([1, [R * Math.cos(a), R * Math.sin(a)], [-R * w * Math.sin(a), R * w * Math.cos(a)]]);
      }
      return out;
    },
  },
  pythagoras: {
    label: '피타고라스 혼돈', period: 1,
    desc: 'Burrau(1913) 문제: 질량 3·4·5인 별이 직각삼각형 꼭짓점에 정지한 상태에서 출발. 격렬한 근접 조우 끝에 쌍성과 홀로 탈출하는 별로 갈라집니다.',
    init: () => [[3, [1, 3], [0, 0]], [4, [-2, -1], [0, 0]], [5, [1, -1], [0, 0]]],
  },
};
function sym(p1, p2) { return [[1, [-1, 0], [p1, p2]], [1, [1, 0], [p1, p2]], [1, [0, 0], [-2 * p1, -2 * p2]]]; }

const STARS = [
  { name: '알파', temp: 9800, color: 0x8fb8ff },
  { name: '베타', temp: 5600, color: 0xffd27a },
  { name: '감마', temp: 3700, color: 0xff7a5a },
];

export class ThreeBodyScenario extends NBodyScenario {
  constructor(app) {
    super(app, { G: 1, dtMax: 0.002, adaptive: true, eta: 0.01, softening: 0.0005, units: 'nbody', primary: 'heaviest' });
    this.presetKey = 'figure8';
    this.build();
  }

  build() {
    const P = PRESETS[this.presetKey];
    for (const b of [...this.bodies]) this.removeBody(b);
    this.sim.time = 0;
    P.init().forEach(([m, p, v], i) => {
      const S = STARS[i];
      this.addBody({
        name: S.name, type: `항성 · 질량 ${m}`, kind: 'star', temp: S.temp, color: S.color, m, visR: 0.045 * Math.cbrt(m), lightW: 0.6,
        p: [p[0], 0, -p[1]], v: [v[0], 0, -v[1]], trailLen: 1800, trailDt: 0.006, orbit: false, glow: 2.4, coronaI: 1.4, desc: P.desc,
      });
    });
    this.sim.toCOM();
    this.sim.computeAcc();
    this.E0 = null;
    this.resetTrails();
  }

  setPreset(k) { this.presetKey = k; this.build(); this.app.toast(PRESETS[k].label); }

  perturb() {
    const s = this.sim;
    for (let i = 0; i < s.n; i++) { s.vx[i] += (Math.random() - 0.5) * 2e-3; s.vz[i] += (Math.random() - 0.5) * 2e-3; }
    s.toCOM(); s.computeAcc();
    this.E0 = null;
    this.app.toast('속도에 ±0.001 섭동 — 나비 효과를 지켜보세요');
  }

  get warp() { return { min: 0.02, max: 8, def: 0.8, fmt: (w) => `${w.toFixed(2)} 시간단위/초` }; }

  start() {
    const c = this.app.controls;
    c.minR = 0.1; c.maxR = 200; c.minNear = 1e-4; c.minFar = 0;
    c.target.set(0, 0, 0); c.follow = null;
    c.set({ theta: 0, phi: 0.35, radius: 30, jump: true });
    c.set({ theta: 0.2, phi: 0.55, radius: this.presetKey === 'pythagoras' ? 12 : 4.2 });
  }

  focusRadius() { return 1.2; }

  clock() {
    const P = PRESETS[this.presetKey];
    return { main: `t = ${this.sim.time.toFixed(3)}`, sub: this.presetKey === 'pythagoras' ? 'G = 1 · N-체 단위' : `주기 ${(this.sim.time / P.period).toFixed(2)}회` };
  }

  panel() {
    return [
      { type: 'chips', label: '초기 조건', radio: true, value: this.presetKey, items: Object.entries(PRESETS).map(([k, p]) => ({ key: k, label: p.label, on: () => this.setPreset(k) })) },
      { type: 'chips', label: '실험', items: [{ label: '미세 섭동 가하기', act: true, on: () => this.perturb() }, { label: '궤적 지우기', on: () => this.resetTrails() }] },
      { type: 'readouts', items: ['에너지 보존 오차', '최소 시간 간격', '적분 스텝/프레임'] },
      { type: 'hint', text: '적응형 시간 간격 립프로그 적분기가 근접 조우 시 Δt를 자동으로 줄입니다. 주기 해는 불안정하여 수치 오차만으로도 언젠가 혼돈으로 전이합니다.' },
    ];
  }

  readouts() {
    return {
      '에너지 보존 오차': this.dE ? this.dE.toExponential(2) : '—',
      '최소 시간 간격': fmtNum(Math.min(this.dtMax, this.sim.eta * this.sim.minTau), 6),
      '적분 스텝/프레임': `${this.sim.lastSteps || 0}${this.lagging ? ' ⚠' : ''}`,
    };
  }
}
