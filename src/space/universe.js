// FREE FREELY 우주 탐사 - 천체 데이터 · 계층 좌표 · 케플러 궤도
// 좌표 계층: 우주 → 은하 → 항성계 → 행성 → 위성. 모든 위치는 부모 중심 기준 Float64(m).
// 궤도면은 XZ 평면(+Y 가 북), 행성은 케플러 궤도 레일을 따라 움직이고 자전한다.
import * as THREE from 'three';
import { AU, LY, M_SUN, R_SUN, L_SUN, G_CONST, DAY, YEAR } from './consts.js';

const DEG = Math.PI / 180;
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);

/** 분자량 (g/mol) — 대기 조성으로부터 평균 분자량 계산 */
export const MOLAR = { N2: 28.013, O2: 31.999, Ar: 39.948, CO2: 44.01, CH4: 16.04, H2: 2.016, He: 4.003, SO2: 64.07, H2O: 18.02, Ne: 20.18, CO: 28.01, Na: 22.99 };
export const GAS_LABEL = { N2: 'N₂', O2: 'O₂', Ar: 'Ar', CO2: 'CO₂', CH4: 'CH₄', H2: 'H₂', He: 'He', SO2: 'SO₂', H2O: 'H₂O', Ne: 'Ne', CO: 'CO', Na: 'Na' };

export class Body {
  constructor(o) {
    Object.assign(this, o);
    this.children = [];
    this.parent = null;
    this.mass = o.mass || 0;
    this.radius = o.radius || 0;
    this.mu = G_CONST * this.mass;
    this.soi = o.soi || 0;
    this.rel = new THREE.Vector3();         // 매 프레임: 함선(카메라) 기준 상대 위치
    this.relValid = false;
    this.localPos = new THREE.Vector3();     // 매 프레임: 부모 기준 위치(현재 시각)
    this.localVel = new THREE.Vector3();
    this.rotation = new THREE.Quaternion();  // 매 프레임: 자전 자세 (행성 로컬 → 관성)
    this.angVel = new THREE.Vector3();       // 자전 각속도 (관성 좌표)
    if (o.pos) this.localPos.set(o.pos[0], o.pos[1], o.pos[2]);
  }

  add(child) { child.parent = this; this.children.push(child); return child; }

  /** 궤도 초기화 (부모 질량 필요) */
  initOrbit() {
    const o = this.orbit;
    if (!o) return;
    const mu = G_CONST * ((this.parent ? this.parent.massForOrbit() : 0) + this.mass);
    o.n = Math.sqrt(mu / (o.a * o.a * o.a));
    o.period = (Math.PI * 2) / o.n;
    o.b = o.a * Math.sqrt(1 - o.e * o.e);
    // 궤도면 회전: Ω(승교점) → i(경사) → ω(근점편각)
    const q = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, (o.lan || 0) * DEG);
    q.multiply(_q.setFromAxisAngle(AXIS_X, (o.inc || 0) * DEG));
    q.multiply(_q.setFromAxisAngle(AXIS_Y, (o.argp || 0) * DEG));
    o.q = q;
    if (!this.soi) {
      const M = this.parent ? this.parent.massForOrbit() : 1;
      this.soi = Math.max(this.radius * 12, o.a * Math.pow(this.mass / M, 0.4));
    }
  }

  massForOrbit() {
    if (this.kind === 'system') return this.children.reduce((s, c) => s + (c.kind === 'star' ? c.mass : 0), 0);
    return this.mass;
  }

  /** 시각 t 에서 부모 기준 위치/속도 갱신 */
  updateState(t) {
    const o = this.orbit;
    if (o) {
      const M = (o.M0 || 0) * DEG + o.n * t;
      let E = M;
      for (let k = 0; k < 8; k++) E -= (E - o.e * Math.sin(E) - M) / (1 - o.e * Math.cos(E));
      const cE = Math.cos(E), sE = Math.sin(E);
      const dE = o.n / (1 - o.e * cE);
      this.localPos.set(o.a * (cE - o.e), 0, -o.b * sE).applyQuaternion(o.q);
      this.localVel.set(-o.a * sE * dE, 0, -o.b * cE * dE).applyQuaternion(o.q);
    }
    const s = this.spin;
    if (s) {
      if (s.locked && o) {
        // 조석 고정: 로컬 -X 면이 항상 부모를 향함 (이심률에 의한 칭동 포함)
        const M = (o.M0 || 0) * DEG + o.n * t;
        this.rotation.copy(o.q).multiply(_q2.setFromAxisAngle(AXIS_Y, M));
        this.angVel.copy(AXIS_Y).applyQuaternion(o.q).multiplyScalar(o.n);
      } else {
        const theta = (Math.PI * 2 * t) / s.period + (s.phase || 0);
        _q.setFromAxisAngle(AXIS_X, (s.tilt || 0) * DEG);
        this.rotation.copy(_q).multiply(_q2.setFromAxisAngle(AXIS_Y, theta));
        this.angVel.copy(AXIS_Y).applyQuaternion(_q).multiplyScalar((Math.PI * 2) / s.period);
      }
    } else if (this.orient) {
      this.rotation.copy(this.orient);
    }
  }

  /** 행성 표면 위 한 점의 관성 속도 (자전) */
  surfaceVelocity(relPos, out) {
    return out.copy(this.angVel).cross(relPos);
  }

  get depth() { let d = 0, b = this; while (b.parent) { d++; b = b.parent; } return d; }

  ancestors() { const a = []; let b = this.parent; while (b) { a.push(b); b = b.parent; } return a; }

  /** 대기 조성 → 평균 분자량 (kg/mol) */
  get molarMass() {
    const c = this.atmo && this.atmo.comp;
    if (!c) return 0.029;
    let s = 0, w = 0;
    for (const k in c) { s += (MOLAR[k] || 28) * c[k]; w += c[k]; }
    return (s / Math.max(1e-6, w)) / 1000;
  }

  get surfaceGravity() { return this.radius > 0 ? this.mu / (this.radius * this.radius) : 0; }
}

/* ------------------------------------------------------------------ */
/* 우주 구성                                                           */
/* ------------------------------------------------------------------ */
const EARTH_R = 6.371e6, EARTH_M = 5.972e24;

function planet(o) { return new Body({ kind: o.kind || 'planet', ...o }); }

/** 지구형 대기 산란 계수 (레일리) — 조성·밀도 비율로 크기 조정 */
const RAYLEIGH_EARTH = [5.8e-6, 13.5e-6, 33.1e-6];

function atmo(o) {
  return {
    comp: o.comp, p0: o.p0, T0: o.T0, lapse: o.lapse ?? 0.0065, Tmin: o.Tmin ?? o.T0 * 0.6, H: o.H,
    top: o.top || o.H * 12,
    betaR: o.betaR || RAYLEIGH_EARTH.map((v) => v * (o.rayleighScale ?? 1)),
    HR: o.HR || o.H,
    betaM: o.betaM || [21e-6, 21e-6, 21e-6], betaMExt: o.betaMExt || null, HM: o.HM || 1200, mieG: o.mieG ?? 0.76,
    mieTint: o.mieTint || [1, 1, 1], ozone: o.ozone ?? 0,
    sunIntensity: o.sunIntensity ?? 22,
    clouds: o.clouds || null,
    fog: o.fog || null,
  };
}

export function buildUniverse() {
  const all = [];
  const reg = (b) => { all.push(b); return b; };
  const root = reg(new Body({ id: 'universe', name: '관측 가능한 우주', kind: 'universe', soi: Infinity }));

  /* ------------------------------ 우리은하 ------------------------------ */
  const mw = reg(root.add(new Body({
    id: 'milkyway', name: '우리은하', kind: 'galaxy', gtype: 'spiral', pos: [0, 0, 0],
    galRadius: 5.0e4 * LY, mass: 1.5e12 * M_SUN, soi: 9e4 * LY, arms: 4, armTwist: 3.4, bulge: 0.18, seed: 11,
    colors: { core: [1.0, 0.82, 0.55], arm: [0.62, 0.74, 1.0], dust: [0.9, 0.55, 0.45] },
    orient: new THREE.Quaternion(), desc: '태양계가 속한 막대 나선은하. 지름 약 10만 광년, 별 약 2천억 개.',
  })));
  mw.mu = 0; // 은하 전체 중력은 무시(미미함)

  // 태양 위치: 은하 중심에서 약 26,000 광년, 원반면 위 60 광년
  const SOL_POS = [26000 * LY, 60 * LY, 1200 * LY];

  /* ------------------------------ 태양계 ------------------------------ */
  const sol = reg(mw.add(new Body({ id: 'sol', name: '태양계', kind: 'system', pos: SOL_POS, soi: 1.2e15, desc: '황색 왜성 태양과 8개 행성의 고향 항성계.' })));
  const sun = reg(sol.add(new Body({
    id: 'sun', name: '태양', kind: 'star', stype: 'G2V', radius: R_SUN, mass: M_SUN, temp: 5778, lum: L_SUN,
    spin: { period: 25.4 * DAY, tilt: 7.25 }, desc: '주계열 황색 왜성 (G2V). 표면 5,500 °C, 흑점과 플레어 활동.',
  })));
  void sun;

  const venus = reg(sol.add(planet({
    id: 'venus', name: '금성', type: 'hot', radius: 6.0518e6, mass: 4.867e24,
    orbit: { a: 0.723 * AU, e: 0.0068, inc: 3.39, lan: 76.7, argp: 54.9, M0: 50 },
    spin: { period: -243 * DAY, tilt: 2.6 },
    atmo: atmo({
      comp: { CO2: 96.5, N2: 3.5, SO2: 0.015 }, p0: 9.2e6, T0: 737, lapse: 0.0078, Tmin: 230, H: 15900, top: 260e3,
      betaR: [1.1e-5, 1.6e-5, 2.2e-5], HR: 15900, betaM: [5.0e-5, 4.2e-5, 2.0e-5], betaMExt: [5.6e-5, 5.0e-5, 4.0e-5], HM: 14000, mieG: 0.7, sunIntensity: 26,
      clouds: { base: 48e3, top: 68e3, coverage: 0.98, density: 0.06, color: [1.0, 0.86, 0.55], scale: 9e5 },
    }),
    terrain: { seed: 7, kind: 'hot', mountain: 9000, ocean: false, lava: 0.05, craters: 0.1 },
    palette: 'venus', desc: '두꺼운 이산화탄소 대기와 황산 구름. 표면 기압 92 bar, 460 °C.',
  })));
  void venus;

  const earth = reg(sol.add(planet({
    id: 'earth', name: '지구', type: 'terran', radius: EARTH_R, mass: EARTH_M,
    orbit: { a: 1.0 * AU, e: 0.0167, inc: 0, lan: -11.26, argp: 114.2, M0: 120 },
    spin: { period: 86164, tilt: 23.44, phase: 1.2 },
    atmo: atmo({
      comp: { N2: 78.08, O2: 20.95, Ar: 0.93, CO2: 0.04 }, p0: 101325, T0: 288.15, H: 8500, top: 110e3, HR: 8000, HM: 1200,
      clouds: { base: 1500, top: 4200, coverage: 0.52, density: 0.09, color: [1, 1, 1], scale: 2.6e4, cirrus: 9500 },
      isa: true,
    }),
    terrain: { seed: 3, kind: 'terran', mountain: 8200, ocean: true, oceanDepth: 9000, craters: 0 },
    cityLights: true, palette: 'earth', desc: '질소·산소 대기, 액체 바다와 대륙, 생명체가 사는 유일한 행성.',
  })));
  const moon = reg(earth.add(planet({
    id: 'moon', name: '달', kind: 'moon', type: 'moon', radius: 1.7374e6, mass: 7.342e22,
    orbit: { a: 3.844e8, e: 0.0549, inc: 5.14, lan: 125, argp: 318, M0: 200 },
    spin: { locked: true },
    terrain: { seed: 21, kind: 'moon', mountain: 5000, ocean: false, craters: 1 },
    palette: 'moon', desc: '지구의 위성. 대기가 없어 하늘이 검고 그림자가 선명하다.',
  })));
  void moon;

  const mars = reg(sol.add(planet({
    id: 'mars', name: '화성', type: 'mars', radius: 3.3895e6, mass: 6.417e23,
    orbit: { a: 1.524 * AU, e: 0.0934, inc: 1.85, lan: 49.6, argp: 286.5, M0: 300 },
    spin: { period: 88642, tilt: 25.19, phase: 0.4 },
    atmo: atmo({
      comp: { CO2: 95.3, N2: 2.6, Ar: 1.9, O2: 0.17 }, p0: 610, T0: 215, lapse: 0.0025, Tmin: 150, H: 11100, top: 120e3,
      betaR: [1.2e-7, 2.8e-7, 6.8e-7], HR: 11100, betaM: [6.0e-6, 3.9e-6, 2.1e-6], betaMExt: [6.6e-6, 6.0e-6, 6.2e-6], HM: 11000, mieG: 0.72,
      mieTint: [0.45, 0.72, 1.55], sunIntensity: 18,
      clouds: { base: 18e3, top: 22e3, coverage: 0.12, density: 0.02, color: [1, 0.92, 0.84], scale: 4e4 },
    }),
    terrain: { seed: 5, kind: 'mars', mountain: 7000, ocean: false, craters: 0.6, volcano: { dir: [0.45, 0.32, -0.83], height: 21000, radius: 0.09 }, canyon: true },
    palette: 'mars', desc: '얇은 이산화탄소 대기, 붉은 사막과 거대 화산 올림푸스 산, 극관.',
  })));
  reg(mars.add(planet({
    id: 'phobos', name: '포보스', kind: 'moon', type: 'asteroid', radius: 11.2e3, mass: 1.06e16,
    orbit: { a: 9.376e6, e: 0.015, inc: 1.1, lan: 0, argp: 0, M0: 40 }, spin: { locked: true },
    terrain: { seed: 41, kind: 'asteroid', mountain: 2600, ocean: false, craters: 1 },
    palette: 'asteroid', desc: '화성의 작은 위성. 감자 모양의 소천체로 중력이 거의 없다.',
  })));

  reg(sol.add(new Body({ id: 'belt', name: '소행성대', kind: 'belt', inner: 2.2 * AU, outer: 3.3 * AU, pos: [0, 0, 0], desc: '화성과 목성 사이 수백만 개의 암석 천체가 도는 띠.' })));
  reg(sol.add(planet({
    id: 'ceres', name: '세레스', kind: 'planet', type: 'asteroid', radius: 4.73e5, mass: 9.38e20,
    orbit: { a: 2.77 * AU, e: 0.0758, inc: 10.6, lan: 80.3, argp: 73.6, M0: 10 }, spin: { period: 9.07 * 3600, tilt: 4 },
    terrain: { seed: 51, kind: 'asteroid', mountain: 6000, ocean: false, craters: 1, roundish: true },
    palette: 'asteroid', desc: '소행성대 최대의 왜행성. 크레이터로 뒤덮인 회색 표면.',
  })));

  const jupiter = reg(sol.add(planet({
    id: 'jupiter', name: '목성', type: 'gas', radius: 6.9911e7, mass: 1.898e27,
    orbit: { a: 5.204 * AU, e: 0.0489, inc: 1.3, lan: 100.5, argp: 273.9, M0: 20 },
    spin: { period: 35730, tilt: 3.13 },
    atmo: atmo({
      comp: { H2: 89.8, He: 10.2, CH4: 0.3 }, p0: 1e5, T0: 165, lapse: -0.0018, Tmin: 110, H: 27000, top: 300e3,
      betaR: [2.2e-6, 5.0e-6, 11e-6], HR: 27000, betaM: [4e-6, 3.6e-6, 3e-6], HM: 20000, mieG: 0.7, sunIntensity: 22,
      fog: [0.72, 0.6, 0.45],
    }),
    gas: { palette: 'jupiter', bands: 16, storm: { lat: -22, lon: 40, size: 0.16, color: [0.75, 0.32, 0.18] } },
    palette: 'jupiter', desc: '태양계 최대의 기체 행성. 수소·헬륨 대기, 띠 구조와 대적점 폭풍.',
  })));
  reg(jupiter.add(planet({
    id: 'io', name: '이오', kind: 'moon', type: 'hot', radius: 1.8216e6, mass: 8.93e22,
    orbit: { a: 4.217e8, e: 0.0041, inc: 0.05, M0: 90 }, spin: { locked: true },
    terrain: { seed: 61, kind: 'io', mountain: 6000, ocean: false, lava: 0.035, craters: 0 },
    palette: 'io', desc: '태양계에서 가장 활발한 화산 위성. 유황 평원과 빛나는 용암 균열.',
  })));
  reg(jupiter.add(planet({
    id: 'europa', name: '유로파', kind: 'moon', type: 'ice', radius: 1.5608e6, mass: 4.8e22,
    orbit: { a: 6.709e8, e: 0.009, inc: 0.47, M0: 210 }, spin: { locked: true },
    terrain: { seed: 62, kind: 'ice', mountain: 1500, ocean: false, craters: 0.1, crevasse: 1 },
    palette: 'europa', desc: '얼음 껍질 아래 바다가 숨어 있는 위성. 갈색 균열이 표면을 가로지른다.',
  })));

  const saturn = reg(sol.add(planet({
    id: 'saturn', name: '토성', type: 'ringed', radius: 5.8232e7, mass: 5.683e26,
    orbit: { a: 9.583 * AU, e: 0.0565, inc: 2.49, lan: 113.7, argp: 339.4, M0: 150 },
    spin: { period: 38362, tilt: 26.73 },
    atmo: atmo({
      comp: { H2: 96.3, He: 3.25, CH4: 0.45 }, p0: 1e5, T0: 134, lapse: -0.0012, Tmin: 84, H: 59500, top: 450e3,
      betaR: [2.0e-6, 4.4e-6, 9e-6], HR: 59500, betaM: [3e-6, 2.8e-6, 2.2e-6], HM: 40000, mieG: 0.7, sunIntensity: 22,
      fog: [0.82, 0.72, 0.52],
    }),
    gas: { palette: 'saturn', bands: 12 },
    rings: { inner: 7.4e7, outer: 1.37e8, palette: 'saturn', seed: 3 },
    palette: 'saturn', desc: '얼음·암석 입자로 된 거대한 고리를 가진 기체 행성.',
  })));
  reg(saturn.add(planet({
    id: 'titan', name: '타이탄', kind: 'moon', type: 'ice', radius: 2.5747e6, mass: 1.345e23,
    orbit: { a: 1.22187e9, e: 0.0288, inc: 0.35, M0: 300 }, spin: { locked: true },
    atmo: atmo({
      comp: { N2: 98.4, CH4: 1.4, H2: 0.1 }, p0: 146700, T0: 94, lapse: 0.0009, Tmin: 70, H: 21000, top: 400e3,
      betaR: [1.8e-6, 4.0e-6, 9.6e-6], HR: 21000, betaM: [2.4e-5, 1.3e-5, 4e-6], betaMExt: [2.6e-5, 2.2e-5, 2.0e-5], HM: 30000, mieG: 0.66, sunIntensity: 20,
    }),
    terrain: { seed: 71, kind: 'titan', mountain: 1500, ocean: true, oceanDepth: 400, liquid: 'methane', craters: 0.05 },
    palette: 'titan', desc: '두꺼운 질소 대기와 주황빛 연무, 메탄 호수를 가진 얼음 위성.',
  })));

  reg(sol.add(planet({
    id: 'neptune', name: '해왕성', type: 'gas', radius: 2.4622e7, mass: 1.024e26,
    orbit: { a: 30.07 * AU, e: 0.0086, inc: 1.77, lan: 131.8, argp: 273.2, M0: 250 },
    spin: { period: 57996, tilt: 28.3 },
    atmo: atmo({
      comp: { H2: 80, He: 19, CH4: 1.5 }, p0: 1e5, T0: 72, lapse: -0.001, Tmin: 55, H: 20000, top: 260e3,
      betaR: [1.4e-6, 4.8e-6, 14e-6], HR: 20000, betaM: [2e-6, 2.4e-6, 3e-6], HM: 18000, mieG: 0.7, sunIntensity: 20,
      fog: [0.3, 0.48, 0.85],
    }),
    gas: { palette: 'neptune', bands: 8, storm: { lat: -20, lon: 200, size: 0.1, color: [0.12, 0.2, 0.55] } },
    palette: 'neptune', desc: '메탄이 붉은빛을 흡수해 짙푸르게 보이는 얼음 거대 행성. 초속 600 m 강풍.',
  })));

  /* ------------------------------ 프록시마 켄타우리 ------------------------------ */
  const prox = reg(mw.add(new Body({
    id: 'proxima', name: '프록시마 켄타우리계', kind: 'system',
    pos: [SOL_POS[0] + 1.6 * LY, SOL_POS[1] - 1.2 * LY, SOL_POS[2] - 3.7 * LY], soi: 8e14, desc: '태양에서 4.24 광년, 가장 가까운 적색왜성계.',
  })));
  reg(prox.add(new Body({
    id: 'proxima-star', name: '프록시마 켄타우리', kind: 'star', stype: 'M5.5Ve', radius: 0.154 * R_SUN, mass: 0.122 * M_SUN,
    temp: 3042, lum: 0.0017 * L_SUN, flare: 1.6, spin: { period: 83 * DAY, tilt: 0 }, desc: '적색왜성. 잦은 플레어 폭발로 유명하다.',
  })));
  reg(prox.add(planet({
    id: 'proxima-b', name: '프록시마 b', type: 'hot', radius: 7.2e6, mass: 1.07 * EARTH_M,
    orbit: { a: 0.0485 * AU, e: 0.02, inc: 0, M0: 10 }, spin: { locked: true },
    atmo: atmo({
      comp: { CO2: 82, N2: 12, SO2: 4, H2O: 2 }, p0: 4.2e5, T0: 1150, lapse: 0.004, Tmin: 400, H: 12000, top: 140e3,
      betaR: [4e-6, 7e-6, 12e-6], HR: 12000, betaM: [3e-5, 1.6e-5, 6e-6], HM: 8000, mieG: 0.7, sunIntensity: 20,
    }),
    terrain: { seed: 81, kind: 'lava', mountain: 6500, ocean: false, lava: 0.42, craters: 0.05 },
    palette: 'lava', desc: '항성에 바짝 붙은 용암 행성. 마그마 바다와 빛나는 균열.',
  })));
  reg(prox.add(planet({
    id: 'proxima-c', name: '프록시마 c', type: 'ice', radius: 9.4e6, mass: 7 * EARTH_M,
    orbit: { a: 1.49 * AU, e: 0.04, inc: 2, M0: 200 }, spin: { period: 31 * 3600, tilt: 12 },
    atmo: atmo({
      comp: { N2: 90, CH4: 9, Ar: 1 }, p0: 1200, T0: 48, lapse: 0.0005, Tmin: 35, H: 9000, top: 100e3,
      betaR: [0.6e-6, 1.5e-6, 3.6e-6], HR: 9000, betaM: [2e-6, 2e-6, 2.2e-6], HM: 6000, mieG: 0.7, sunIntensity: 16,
    }),
    terrain: { seed: 82, kind: 'ice', mountain: 4200, ocean: false, crevasse: 1, craters: 0.15, frost: 1 },
    palette: 'ice', desc: '희박한 질소·메탄 대기의 얼음 행성. 크레바스와 얼음 절벽, 질소 서리.',
  })));

  /* ------------------------------ 트라피스트-1 ------------------------------ */
  const trap = reg(mw.add(new Body({
    id: 'trappist', name: '트라피스트-1계', kind: 'system',
    pos: [SOL_POS[0] - 22 * LY, SOL_POS[1] + 6 * LY, SOL_POS[2] + braid(32) * LY], soi: 6e14, desc: '39 광년 떨어진 초저온 적색왜성과 일곱 개의 지구 크기 행성.',
  })));
  reg(trap.add(new Body({
    id: 'trappist-star', name: '트라피스트-1', kind: 'star', stype: 'M8V', radius: 0.119 * R_SUN, mass: 0.0898 * M_SUN,
    temp: 2566, lum: 0.000553 * L_SUN, flare: 0.8, spin: { period: 3.3 * DAY, tilt: 0 }, desc: '목성보다 조금 큰 초저온 적색왜성.',
  })));
  reg(trap.add(planet({
    id: 'trappist-e', name: '트라피스트-1e', type: 'terran', radius: 0.92 * EARTH_R, mass: 0.69 * EARTH_M,
    orbit: { a: 0.02925 * AU, e: 0.005, inc: 0.1, M0: 60 }, spin: { locked: true },
    atmo: atmo({
      comp: { N2: 72, O2: 18, CO2: 8, Ar: 2 }, p0: 88000, T0: 262, H: 9200, top: 115e3, HR: 9000, HM: 1500, rayleighScale: 0.9,
      betaM: [26e-6, 22e-6, 18e-6], mieG: 0.78, sunIntensity: 14,
      clouds: { base: 1200, top: 3600, coverage: 0.6, density: 0.08, color: [1, 0.95, 0.9], scale: 2.2e4, cirrus: 8000 },
    }),
    terrain: { seed: 91, kind: 'terran', mountain: 6500, ocean: true, oceanDepth: 6000, alien: true, craters: 0 },
    palette: 'alien', desc: '붉은 태양 아래 바다와 짙은 보랏빛 식생을 가진 지구형 행성.',
  })));
  reg(trap.add(planet({
    id: 'trappist-f', name: '트라피스트-1f', type: 'ice', radius: 1.045 * EARTH_R, mass: 1.04 * EARTH_M,
    orbit: { a: 0.0385 * AU, e: 0.01, inc: 0.2, M0: 170 }, spin: { locked: true },
    terrain: { seed: 92, kind: 'ice', mountain: 3200, ocean: false, crevasse: 1, craters: 0.05, frost: 0.5 },
    palette: 'ice2', desc: '두꺼운 얼음으로 덮인 행성. 대기가 거의 없어 별이 선명하다.',
  })));

  /* ------------------------------ 리겔 (청색 초거성) ------------------------------ */
  const rigel = reg(mw.add(new Body({
    id: 'rigel', name: '리겔계', kind: 'system',
    pos: [SOL_POS[0] + 520 * LY, SOL_POS[1] - 260 * LY, SOL_POS[2] + 610 * LY], soi: 4e15, desc: '860 광년 거리의 청색 초거성계 (가상의 행성 포함).',
  })));
  reg(rigel.add(new Body({
    id: 'rigel-star', name: '리겔', kind: 'star', stype: 'B8Ia', radius: 78.9 * R_SUN, mass: 21 * M_SUN,
    temp: 12100, lum: 120000 * L_SUN, spin: { period: 25 * DAY, tilt: 0 }, desc: '청백색 초거성. 태양보다 12만 배 밝다.',
  })));
  const rigelb = reg(rigel.add(planet({
    id: 'rigel-b', name: '리겔 b', type: 'ringed', radius: 8.4e7, mass: 3.2e27,
    orbit: { a: 9 * AU, e: 0.03, inc: 3, M0: 30 }, spin: { period: 31000, tilt: 18 },
    atmo: atmo({
      comp: { H2: 86, He: 13, CH4: 1 }, p0: 1e5, T0: 420, lapse: -0.001, Tmin: 300, H: 42000, top: 400e3,
      betaR: [1.6e-6, 4.6e-6, 12e-6], HR: 42000, betaM: [2.4e-6, 2.6e-6, 3e-6], HM: 30000, mieG: 0.7, sunIntensity: 26,
      fog: [0.36, 0.62, 0.7],
    }),
    gas: { palette: 'teal', bands: 14, storm: { lat: 30, lon: 120, size: 0.12, color: [0.9, 0.95, 1.0] } },
    rings: { inner: 1.15e8, outer: 2.3e8, palette: 'ice', seed: 9 },
    palette: 'teal', desc: '청록빛 띠를 두른 거대한 고리 행성.',
  })));
  reg(rigelb.add(planet({
    id: 'rigel-b1', name: '리겔 b-I', kind: 'moon', type: 'ice', radius: 2.1e6, mass: 6e22,
    orbit: { a: 3.6e8, e: 0.01, inc: 1, M0: 0 }, spin: { locked: true },
    terrain: { seed: 101, kind: 'ice', mountain: 2500, ocean: false, crevasse: 1, craters: 0.4 },
    palette: 'ice', desc: '고리 행성을 도는 얼음 위성.',
  })));
  reg(rigel.add(planet({
    id: 'rigel-c', name: '리겔 c', type: 'mars', radius: 5.1e6, mass: 0.42 * EARTH_M,
    orbit: { a: 22 * AU, e: 0.05, inc: 1, M0: 260 }, spin: { period: 21 * 3600, tilt: 10 },
    atmo: atmo({
      comp: { CO2: 88, N2: 9, Ar: 3 }, p0: 2400, T0: 250, lapse: 0.0022, Tmin: 160, H: 10500, top: 120e3,
      betaR: [3e-7, 7e-7, 1.6e-6], HR: 10500, betaM: [7e-6, 4.6e-6, 2.6e-6], betaMExt: [7.6e-6, 7e-6, 7e-6], HM: 9000, mieG: 0.72, mieTint: [0.5, 0.75, 1.5], sunIntensity: 24,
    }),
    terrain: { seed: 111, kind: 'mars', mountain: 9000, ocean: false, craters: 0.4, canyon: true, volcano: { dir: [-0.3, 0.2, 0.93], height: 14000, radius: 0.07 } },
    palette: 'desert2', desc: '청색 태양빛 아래 붉은 협곡이 펼쳐진 사막 행성.',
  })));

  /* ------------------------------ 은하 중심 · 성운 ------------------------------ */
  reg(mw.add(new Body({
    id: 'sgra', name: '궁수자리 A*', kind: 'blackhole', radius: 1.2e10, mass: 4.15e6 * M_SUN, pos: [0, 0, 0], soi: 2e15,
    disk: { inner: 3.2, outer: 14, color: [1.0, 0.62, 0.3] }, desc: '우리은하 중심의 초대질량 블랙홀. 태양 질량의 415만 배.',
  })));
  reg(mw.add(new Body({
    id: 'orion', name: '오리온 성운', kind: 'nebula', pos: [SOL_POS[0] - 980 * LY, SOL_POS[1] - 380 * LY, SOL_POS[2] - 820 * LY],
    nebRadius: 12 * LY, colors: [[1.0, 0.36, 0.5], [0.3, 0.85, 0.9], [0.95, 0.75, 0.5]], seed: 5, desc: '1,344 광년 거리의 별 탄생 구역. 이온화된 수소가 붉게 빛난다.',
  })));
  reg(mw.add(new Body({
    id: 'carina', name: '용골자리 성운', kind: 'nebula', pos: [SOL_POS[0] + 4200 * LY, SOL_POS[1] - 120 * LY, SOL_POS[2] - 6800 * LY],
    nebRadius: 120 * LY, colors: [[1.0, 0.45, 0.32], [0.95, 0.85, 0.5], [0.4, 0.6, 1.0]], seed: 9, desc: '7,500 광년 거리의 거대한 발광 성운.',
  })));

  /* ------------------------------ 외부 은하 ------------------------------ */
  const gdir = (lonDeg, latDeg, dist) => {
    const lo = lonDeg * DEG, la = latDeg * DEG;
    return [Math.cos(la) * Math.cos(lo) * dist, Math.sin(la) * dist, Math.cos(la) * Math.sin(lo) * dist];
  };
  const eul = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG));

  const m31 = reg(root.add(new Body({
    id: 'andromeda', name: '안드로메다 은하 (M31)', kind: 'galaxy', gtype: 'spiral', pos: gdir(121, -21.6, 2.537e6 * LY),
    galRadius: 1.1e5 * LY, mass: 1.5e12 * M_SUN, soi: 2.2e5 * LY, arms: 2, armTwist: 4.2, bulge: 0.22, seed: 31,
    colors: { core: [1.0, 0.8, 0.55], arm: [0.7, 0.78, 1.0], dust: [0.9, 0.6, 0.5] },
    orient: eul(77, 0, 38), desc: '254만 광년 떨어진 가장 가까운 거대 나선은하. 별 약 1조 개.',
  })));
  reg(m31.add(new Body({
    id: 'm31star', name: 'M31*', kind: 'blackhole', radius: 4.2e11, mass: 1.4e8 * M_SUN, pos: [0, 0, 0], soi: 3e16,
    disk: { inner: 3.0, outer: 18, color: [1.0, 0.7, 0.42] }, desc: '안드로메다 중심의 초대질량 블랙홀 (태양 질량 1억 4천만 배).',
  })));
  reg(root.add(new Body({
    id: 'm32', name: 'M32 (왜소 타원은하)', kind: 'galaxy', gtype: 'elliptical', pos: gdir(121.15, -22.0, 2.49e6 * LY),
    galRadius: 4.5e3 * LY, mass: 3e9 * M_SUN, soi: 1e4 * LY, ellip: [1, 0.78, 0.86], seed: 32,
    colors: { core: [1.0, 0.86, 0.66], arm: [1.0, 0.75, 0.52] }, orient: eul(10, 20, 0), desc: '안드로메다를 도는 작은 타원은하. 늙은 붉은 별로 가득하다.',
  })));
  reg(root.add(new Body({
    id: 'm110', name: 'M110 (타원은하)', kind: 'galaxy', gtype: 'elliptical', pos: gdir(120.7, -21.1, 2.69e6 * LY),
    galRadius: 1.0e4 * LY, mass: 1e10 * M_SUN, soi: 2.2e4 * LY, ellip: [1, 0.55, 0.7], seed: 33,
    colors: { core: [1.0, 0.84, 0.62], arm: [0.98, 0.72, 0.5] }, orient: eul(-30, 40, 10), desc: '안드로메다의 위성 타원은하.',
  })));
  reg(root.add(new Body({
    id: 'm33', name: '삼각형자리 은하 (M33)', kind: 'galaxy', gtype: 'spiral', pos: gdir(133.6, -31.3, 2.73e6 * LY),
    galRadius: 3.0e4 * LY, mass: 5e10 * M_SUN, soi: 6e4 * LY, arms: 2, armTwist: 2.6, bulge: 0.08, seed: 34, flocculent: true,
    colors: { core: [1.0, 0.85, 0.65], arm: [0.55, 0.72, 1.0], dust: [0.9, 0.6, 0.5] }, orient: eul(-35, 0, 22), desc: '국부 은하군 세 번째 크기의 나선은하.',
  })));
  reg(root.add(new Body({
    id: 'lmc', name: '대마젤란운', kind: 'galaxy', gtype: 'irregular', pos: gdir(280.5, -32.9, 1.63e5 * LY),
    galRadius: 1.6e4 * LY, mass: 1e10 * M_SUN, soi: 3e4 * LY, seed: 35,
    colors: { core: [1.0, 0.86, 0.7], arm: [0.6, 0.75, 1.0] }, orient: eul(30, 10, -20), desc: '우리은하를 도는 불규칙 왜소은하.',
  })));
  reg(root.add(new Body({
    id: 'smc', name: '소마젤란운', kind: 'galaxy', gtype: 'irregular', pos: gdir(302.8, -44.3, 2.0e5 * LY),
    galRadius: 9e3 * LY, mass: 7e9 * M_SUN, soi: 1.8e4 * LY, seed: 36,
    colors: { core: [1.0, 0.88, 0.75], arm: [0.62, 0.78, 1.0] }, orient: eul(-20, 60, 0), desc: '대마젤란운의 작은 짝 은하.',
  })));
  reg(root.add(new Body({
    id: 'maffei1', name: '마페이 1 (거대 타원은하)', kind: 'galaxy', gtype: 'elliptical', pos: gdir(136, -0.6, 9.8e6 * LY),
    galRadius: 7.5e4 * LY, mass: 2e12 * M_SUN, soi: 1.5e5 * LY, ellip: [1, 0.7, 0.8], seed: 37,
    colors: { core: [1.0, 0.82, 0.6], arm: [1.0, 0.7, 0.48] }, orient: eul(0, 30, 50), desc: '은하수 먼지에 가려졌던 980만 광년 거리의 거대 타원은하.',
  })));

  // 궤도 초기화 (부모 → 자식 순서)
  for (const b of all) b.initOrbit();
  const byId = {};
  for (const b of all) byId[b.id] = b;
  return { root, bodies: all, byId };
}

function braid(v) { return v; }

/* ------------------------------------------------------------------ */
/* 프레임 상대 위치 계산                                                 */
/* ------------------------------------------------------------------ */
/** 모든 천체의 상태 갱신 (시각 t) */
export function updateBodies(bodies, t) {
  for (const b of bodies) b.updateState(t);
}

/**
 * 함선 프레임 기준 모든 천체의 상대 위치(body.rel)를 계산.
 * 계층을 따라 가까운 것부터 더해 나가므로 근처 천체일수록 정밀하다.
 * @param frame 함선이 속한 프레임 천체
 * @param shipPos 프레임 기준 함선 위치
 */
export function computeRelative(root, frame, shipPos) {
  const visit = (node, from) => {
    for (const c of node.children) {
      if (c === from) continue;
      c.rel.copy(node.rel).add(c.localPos);
      visit(c, null);
    }
  };
  frame.rel.copy(shipPos).negate();
  visit(frame, null);
  let node = frame;
  while (node.parent) {
    const p = node.parent;
    p.rel.copy(node.rel).sub(node.localPos);
    visit(p, node);
    node = p;
  }
}

/** body 의 위치를 frame 좌표로 (계층 경로) */
export function posInFrame(body, frame, out = new THREE.Vector3()) {
  out.set(0, 0, 0);
  if (body === frame) return out;
  const anc = new Set();
  let b = frame; while (b) { anc.add(b); b = b.parent; }
  b = body;
  while (b && !anc.has(b)) { out.add(b.localPos); b = b.parent; }
  const lca = b;
  b = frame;
  while (b && b !== lca) { out.sub(b.localPos); b = b.parent; }
  return out;
}

/** body 의 속도를 frame 좌표로 */
export function velInFrame(body, frame, out = new THREE.Vector3()) {
  out.set(0, 0, 0);
  if (body === frame) return out;
  const anc = new Set();
  let b = frame; while (b) { anc.add(b); b = b.parent; }
  b = body;
  while (b && !anc.has(b)) { out.add(b.localVel); b = b.parent; }
  const lca = b;
  b = frame;
  while (b && b !== lca) { out.sub(b.localVel); b = b.parent; }
  return out;
}

/** 시스템 내 시작 위치 정의 */
export const START_POINTS = {
  sol: { body: 'earth', alt: 420e3, lat: 18, lon: -40, title: '지구 저궤도' },
  proxima: { body: 'proxima-c', alt: 260e3, lat: 10, lon: 30, title: '프록시마 c 궤도' },
  trappist: { body: 'trappist-e', alt: 300e3, lat: 5, lon: 10, title: '트라피스트-1e 궤도' },
  rigel: { body: 'rigel-c', alt: 320e3, lat: -8, lon: 60, title: '리겔 c 궤도' },
};

void YEAR; void _v;
