// SpaceSim — 시나리오 라이브러리
// 각 시나리오는 초기조건 + 권장 적분 설정을 제공한다.

import { G_SIM, KM_PER_AU, MSUN_PER_MEARTH, DAY_PER_YEAR, DEG } from '../core/constants.js';
import { stateFromElements } from '../physics/kepler.js';
import { blackbodyHex } from '../astro/stars.js';
import {
  PLANET_ELEMENTS, BODY_DATA, MOONS, SMALL_BODIES, KIRKWOOD, elementsAt,
} from '../data/bodies.js';

const km = (x) => x / KM_PER_AU;

// 결정론적 난수 (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────── 태양계 구성 헬퍼 ───────────────
// 궤도요소·물리량은 src/data/bodies.js (JPL / NASA Fact Sheet) 한 곳에서 온다.

const PLANETS = PLANET_ELEMENTS.map((p) => {
  const d = BODY_DATA[p.key];
  return {
    key: p.key, name: p.name, data: d,
    a: p.el[0], e: p.el[1], i: p.el[2], L: p.el[3], pi: p.el[4], O: p.el[5],
    m: d.mass, R: d.R, color: d.color,
  };
});

function addSun(sim, over = {}) {
  const d = BODY_DATA.sun;
  return sim.add({
    name: d.name, mass: 1, pos: [0, 0, 0], vel: [0, 0, 0],
    radius: km(d.R), color: d.color, type: 'star', glow: 1,
    temperature: d.T, trail: false, data: d, key: 'sun', ...over,
  });
}

/** 행성 추가. T = J2000 이후 율리우스 세기 (0 이면 J2000 그대로) */
function addPlanet(sim, p, opts = {}, T = 0) {
  const src = PLANET_ELEMENTS.find((x) => x.key === p.key);
  const el = (src && T) ? elementsAt(src, T) : {
    a: p.a, e: p.e, i: p.i, Omega: p.O, omega: p.pi - p.O, M0: p.L - p.pi,
  };
  const { r, v } = stateFromElements(G_SIM * (1 + p.m), el);
  return sim.add({
    name: p.name, mass: p.m, pos: r, vel: v,
    radius: km(p.R), color: p.color, type: 'planet',
    data: p.data, key: p.key, drawScale: opts.drawScale ?? 1, ...opts,
  });
}

/** 모행성 인덱스 기준으로 위성 추가 */
function addMoon(sim, parentIdx, spec, over = {}) {
  const d = BODY_DATA[spec.key];
  const p3 = parentIdx * 3;
  const mu = G_SIM * (sim.mass[parentIdx] + d.mass);
  const { r, v } = stateFromElements(mu, spec);
  return sim.add({
    name: d.name, mass: d.mass,
    pos: [sim.pos[p3] + r[0], sim.pos[p3 + 1] + r[1], sim.pos[p3 + 2] + r[2]],
    vel: [sim.vel[p3] + v[0], sim.vel[p3 + 1] + v[1], sim.vel[p3 + 2] + v[2]],
    radius: km(d.R), color: d.color, type: 'moon',
    parent: sim.meta[parentIdx].name, data: d, key: spec.key, ...over,
  });
}

/** 태양 기준 소천체 (소행성·혜성) */
function addSmall(sim, spec, over = {}) {
  const d = BODY_DATA[spec.key];
  const { r, v } = stateFromElements(G_SIM * (1 + (d.mass || 0)), spec);
  return sim.add({
    name: d.name, mass: d.mass || 0, pos: r, vel: v,
    radius: km(d.R), color: d.color,
    type: d.type === 'comet' ? 'dust' : 'planet',
    data: d, key: spec.key, drawScale: d.type === 'comet' ? 400 : 60, ...over,
  });
}

/**
 * 주 소행성대. 목성과의 평균운동 공명 위치(커크우드 간극)에서 확률을 떨어뜨려
 * 실제 관측되는 a 분포를 재현한다.
 */
function addBelt(sim, N, R, over = {}) {
  for (let k = 0; k < N; k++) {
    let a = 2.7;
    for (let t = 0; t < 60; t++) {
      a = 2.06 + R() * 1.26;
      let keep = 0.32 + 0.68 * Math.exp(-(((a - 2.72) / 0.42) ** 2));
      for (const g of KIRKWOOD) keep *= 1 - 0.96 * Math.exp(-(((a - g.a) / g.w) ** 2));
      if (R() < keep) break;
    }
    const s = stateFromElements(G_SIM, {
      a, e: R() * 0.24, i: (R() - 0.5) * 26,
      Omega: R() * 360, omega: R() * 360, M0: R() * 360,
    });
    sim.add({
      name: `소행성 ${k + 1}`, mass: 0, pos: s.r, vel: s.v,
      radius: km(25), color: k % 5 === 0 ? 0xb0a08c : 0x8f8474,
      type: 'dust', drawScale: 140, trail: false, ...over,
    });
  }
}

// ─────────────── 시나리오 정의 ───────────────

export const SCENARIOS = [
  {
    id: 'solar',
    name: '태양계 (실측 궤도요소)',
    group: '태양계',
    desc: 'JPL 근사 궤도요소(1800–2050년 유효)로 임의 날짜에 초기화하는 태양계 모델. 8행성·명왕성·달·세레스·베스타·팔라스·핼리/엔케 혜성과 소행성대를 완전 N체로 적분합니다. 행성은 실제 반지름·자전주기·자전축 기울기로 자전하며, 태양 방향에 따라 위상이 생깁니다.',
    units: { length: 'AU', time: 'day', mass: 'M☉' },
    rate: 2629800, dt: 0.5, integrator: 'pefrl', softening: 1e-5, collisions: false,
    camera: 35, scale: 'log', epochAware: true,
    build(sim, opt = {}) {
      const epoch = opt.epoch ?? 0;
      const T = epoch / 36525;
      addSun(sim);
      const idx = {};
      for (const p of PLANETS) idx[p.key] = addPlanet(sim, p, {}, T);
      // 달만 포함한다 — 목성·토성 위성은 주기가 짧아 전용 시나리오에서 다룬다
      for (const m of MOONS.earth) addMoon(sim, idx.earth, m);
      for (const sb of SMALL_BODIES) addSmall(sim, sb, { trail: sb.key === 'halley' });
      addBelt(sim, 240, rng(2024));
      sim.time = epoch;
    },
  },

  {
    id: 'inner',
    name: '내행성계 · 수성 근일점 이동',
    group: '태양계',
    desc: '태양 + 내행성 4개. 상대론 보정(1PN)을 켜면 수성 근일점이 세기당 약 43″ 추가로 전진합니다. 궤도요소 패널에서 ω 변화를 관찰하세요.',
    units: { length: 'AU', time: 'day', mass: 'M☉' },
    rate: 864000, dt: 0.2, integrator: 'pefrl', softening: 1e-6, relativistic: true, collisions: false,
    camera: 4, scale: 'linear',
    build(sim) {
      addSun(sim);
      for (let i = 0; i < 4; i++) addPlanet(sim, PLANETS[i]);
    },
  },

  {
    id: 'trojan',
    name: '라그랑주 점 & 트로이 소행성',
    group: '태양계',
    desc: '태양-목성 계의 5개 라그랑주 점에 시험입자를 배치합니다. L4/L5 는 안정(타드폴 궤도), L1·L2·L3 는 불안정해 서서히 이탈합니다.',
    units: { length: 'AU', time: 'day', mass: 'M☉' },
    rate: 31557600, dt: 1, integrator: 'pefrl', softening: 1e-5, collisions: false,
    camera: 12, scale: 'linear', rotatingFrame: true,
    build(sim) {
      addSun(sim);
      const jup = PLANETS[4];
      const ji = addPlanet(sim, { ...jup, i: 0, O: 0, pi: 0, L: 0, e: 0 });
      const a = jup.a, mu = jup.m / (1 + jup.m);
      const n = Math.sqrt(G_SIM * (1 + jup.m) / (a * a * a));
      const R = rng(7);

      const put = (name, x, y, color, jitter = 0) => {
        const px = x + (R() - 0.5) * jitter, py = y + (R() - 0.5) * jitter;
        sim.add({
          name, mass: 0, pos: [px, py, (R() - 0.5) * jitter * 0.3],
          vel: [-n * py, n * px, 0],
          radius: km(60), color, type: 'dust', drawScale: 40,
        });
      };
      const rh = Math.cbrt(mu / 3) * a;
      put('L1', a - rh, 0, 0xff9a5c);
      put('L2', a + rh, 0, 0xff9a5c);
      put('L3', -a * (1 + 5 * mu / 12), 0, 0xff9a5c);
      put('L4 (그리스군)', a * Math.cos(60 * DEG), a * Math.sin(60 * DEG), 0x7dffb0);
      put('L5 (트로이군)', a * Math.cos(-60 * DEG), a * Math.sin(-60 * DEG), 0x7dffb0);
      for (let k = 0; k < 40; k++) {
        const s = k < 20 ? 1 : -1;
        const th = (60 + (R() - 0.5) * 28) * DEG * s;
        const rr = a * (1 + (R() - 0.5) * 0.06);
        put(`Trojan ${k + 1}`, rr * Math.cos(th), rr * Math.sin(th),
          s > 0 ? 0x5fd39a : 0x5f9ad3, 0.02);
      }
      sim.meta[ji].drawScale = 1;
    },
  },

  {
    id: 'flyby',
    name: '항성 근접 통과',
    group: '태양계',
    desc: '0.8 M☉ 의 적색왜성이 태양계를 30 AU 거리로 통과합니다. 외행성 궤도가 이심률을 얻고 일부는 성간공간으로 방출됩니다.',
    units: { length: 'AU', time: 'day', mass: 'M☉' },
    rate: 315576000, dt: 1, integrator: 'pefrl', softening: 1e-4, collisions: false,
    camera: 90, scale: 'log',
    build(sim) {
      addSun(sim);
      for (const p of PLANETS) addPlanet(sim, p);
      const R = rng(11);
      for (let k = 0; k < 120; k++) { // 카이퍼 벨트
        const a = 35 + R() * 15;
        const { r, v } = stateFromElements(G_SIM, {
          a, e: R() * 0.1, i: (R() - 0.5) * 14, Omega: R() * 360,
          omega: R() * 360, M0: R() * 360,
        });
        sim.add({
          name: `KBO ${k + 1}`, mass: 0, pos: r, vel: v, radius: km(200),
          color: 0x88aacc, type: 'dust', drawScale: 60, trail: false,
        });
      }
      sim.add({
        name: '통과 항성', mass: 0.8, pos: [-260, -160, 60], vel: [0.0042, 0.0026, -0.001],
        radius: km(450000), color: blackbodyHex(3600), type: 'star', glow: 0.8,
        temperature: 3600,
      });
    },
  },

  {
    id: 'jupiter',
    name: '목성계 — 갈릴레이 위성',
    group: '위성계',
    desc: '갈릴레오가 1610년에 발견한 네 위성. 이오·유로파·가니메데는 평균운동이 n₁ − 3n₂ + 2n₃ = 0 을 만족하는 라플라스 공명에 갇혀 있어(주기비 약 1:2:4) 세 위성이 동시에 한쪽에 모이는 일이 절대 없습니다. 이 공명이 유지하는 이심률이 조석가열을 일으켜 이오의 화산활동과 유로파의 지하 바다를 만듭니다.',
    units: { length: 'AU', time: 'day', mass: 'M☉' },
    rate: 21600, dt: 0.002, integrator: 'pefrl', softening: 1e-7, collisions: false,
    camera: 0.02, scale: 'linear',
    build(sim) {
      const d = BODY_DATA.jupiter;
      const ji = sim.add({
        name: d.name, mass: d.mass, pos: [0, 0, 0], vel: [0, 0, 0],
        radius: km(d.R), color: d.color, type: 'planet',
        data: d, key: 'jupiter', trail: false,
      });
      for (const m of MOONS.jupiter) addMoon(sim, ji, m);
      sim.recenter();
    },
  },

  {
    id: 'kirkwood',
    name: '소행성대 & 커크우드 간극',
    group: '태양계',
    desc: '소행성 1400개의 장반경 분포. 목성과 4:1·3:1·5:2·7:3·2:1 평균운동 공명을 이루는 위치에서는 섭동이 누적돼 소행성이 쓸려나가고, 실제 관측되는 커크우드 간극이 그대로 나타납니다. 소행성을 하나 선택해 궤도요소 패널에서 a 를 확인해 보세요.',
    units: { length: 'AU', time: 'day', mass: 'M☉' },
    rate: 31557600, dt: 2, integrator: 'pefrl', softening: 1e-4, collisions: false,
    camera: 6, scale: 'linear',
    build(sim) {
      addSun(sim);
      addPlanet(sim, PLANETS.find((p) => p.key === 'earth'));
      addPlanet(sim, PLANETS.find((p) => p.key === 'mars'));
      addPlanet(sim, PLANETS.find((p) => p.key === 'jupiter'));
      for (const sb of SMALL_BODIES.slice(0, 3)) addSmall(sim, sb);
      addBelt(sim, 1400, rng(77));
    },
  },

  {
    id: 'figure8',
    name: '8자 궤도 (3체 주기해)',
    group: '고전 3체 문제',
    desc: 'Chenciner & Montgomery (2000) 가 발견한 동일질량 3체 주기해. 세 별이 하나의 8자 곡선을 따라 서로를 쫓습니다. 적분 정확도 검증에 쓰입니다.',
    units: { length: 'code', time: 'code', mass: 'code' },
    G: 1, rate: 1, dt: 0.001, integrator: 'pefrl', softening: 0, collisions: false,
    camera: 3, scale: 'linear',
    build(sim) {
      const x = 0.97000436, y = -0.24308753;
      const vx = 0.4662036850, vy = 0.4323657300;
      const c = [0xff7b6b, 0x7de2ff, 0xffd76b];
      sim.add({ name: 'A', mass: 1, pos: [x, y, 0], vel: [vx, vy, 0], radius: 0.03, color: c[0], type: 'star', glow: 0.6 });
      sim.add({ name: 'B', mass: 1, pos: [-x, -y, 0], vel: [vx, vy, 0], radius: 0.03, color: c[1], type: 'star', glow: 0.6 });
      sim.add({ name: 'C', mass: 1, pos: [0, 0, 0], vel: [-2 * vx, -2 * vy, 0], radius: 0.03, color: c[2], type: 'star', glow: 0.6 });
    },
  },

  {
    id: 'pythagorean',
    name: '피타고라스 3체 문제',
    group: '고전 3체 문제',
    desc: 'Burrau (1913) 의 고전 문제. 질량 3·4·5 가 3-4-5 직각삼각형 꼭짓점에 정지해 있다가 카오스적으로 상호작용한 뒤, 이중성계 하나와 탈출체 하나로 분해됩니다.',
    units: { length: 'code', time: 'code', mass: 'code' },
    G: 1, rate: 2, dt: 2e-4, integrator: 'rk4', softening: 1e-3, collisions: false,
    camera: 8, scale: 'linear',
    build(sim) {
      const c = [0xff7b6b, 0x7de2ff, 0xffd76b];
      const set = [
        { name: 'm=3', m: 3, p: [1, 3, 0] },
        { name: 'm=4', m: 4, p: [-2, -1, 0] },
        { name: 'm=5', m: 5, p: [1, -1, 0] },
      ];
      set.forEach((s, i) => sim.add({
        name: s.name, mass: s.m, pos: s.p, vel: [0, 0, 0],
        radius: 0.04 * Math.cbrt(s.m), color: c[i], type: 'star', glow: 0.5,
      }));
    },
  },

  {
    id: 'binary',
    name: '쌍성 + 주연성 행성',
    group: '외계 행성계',
    desc: 'Kepler-16 계를 본뜬 근접 쌍성과, 두 별을 함께 도는 주연성(circumbinary) 행성. 행성 궤도는 쌍성의 세차 섭동으로 천천히 회전합니다.',
    units: { length: 'AU', time: 'day', mass: 'M☉' },
    rate: 432000, dt: 0.05, integrator: 'pefrl', softening: 1e-5, collisions: true,
    camera: 3, scale: 'linear',
    build(sim) {
      const m1 = 0.69, m2 = 0.20, a = 0.224, e = 0.159;
      const mu = G_SIM * (m1 + m2);
      const { r, v } = stateFromElements(mu, { a, e, i: 0.3, Omega: 0, omega: 263, M0: 0 });
      const f1 = m2 / (m1 + m2), f2 = -m1 / (m1 + m2);
      sim.add({
        name: 'Kepler-16 A', mass: m1, pos: r.map((x) => x * f1), vel: v.map((x) => x * f1),
        radius: km(450000), color: blackbodyHex(4450), type: 'star', glow: 1, temperature: 4450,
      });
      sim.add({
        name: 'Kepler-16 B', mass: m2, pos: r.map((x) => x * f2), vel: v.map((x) => x * f2),
        radius: km(160000), color: blackbodyHex(3300), type: 'star', glow: 0.8, temperature: 3300,
      });
      const pl = stateFromElements(G_SIM * (m1 + m2), { a: 0.7048, e: 0.0069, i: 0.5, Omega: 0, omega: 318, M0: 90 });
      sim.add({
        name: 'Kepler-16b', mass: 0.333 * 9.5458e-4, pos: pl.r, vel: pl.v,
        radius: km(53000), color: 0x9fc6e8, type: 'planet',
      });
      const R = rng(3);
      for (let k = 0; k < 60; k++) { // 잔해 원반
        const aa = 1.2 + R() * 1.6;
        const s = stateFromElements(G_SIM * (m1 + m2), {
          a: aa, e: R() * 0.05, i: (R() - 0.5) * 3, Omega: R() * 360, omega: R() * 360, M0: R() * 360,
        });
        sim.add({
          name: `잔해 ${k}`, mass: 0, pos: s.r, vel: s.v, radius: km(500),
          color: 0x7d93a8, type: 'dust', drawScale: 30, trail: false,
        });
      }
    },
  },

  {
    id: 'kozai',
    name: '코자이-리도프 진동',
    group: '외계 행성계',
    desc: '큰 경사각(70°)을 가진 계층적 3중계. 외부 동반성의 섭동으로 내부 궤도의 이심률과 경사각이 주기적으로 교환됩니다 (√(1−e²)·cos i ≈ 일정).',
    units: { length: 'AU', time: 'day', mass: 'M☉' },
    rate: 315576000, dt: 0.5, integrator: 'pefrl', softening: 1e-5, collisions: false,
    camera: 30, scale: 'linear',
    build(sim) {
      addSun(sim, { name: '주성' });
      const mj = 9.54792e-4;
      const inner = stateFromElements(G_SIM * (1 + mj), { a: 5, e: 0.05, i: 70, Omega: 0, omega: 0, M0: 0 });
      sim.add({
        name: '내행성 (거대가스)', mass: mj, pos: inner.r, vel: inner.v,
        radius: km(69911), color: 0xd9b48f, type: 'planet',
      });
      const outer = stateFromElements(G_SIM * (1 + 0.3), { a: 60, e: 0.2, i: 0, Omega: 0, omega: 0, M0: 180 });
      sim.add({
        name: '동반 항성', mass: 0.3, pos: outer.r, vel: outer.v,
        radius: km(300000), color: blackbodyHex(3400), type: 'star', glow: 0.7, temperature: 3400,
      });
      sim.recenter();
    },
  },

  {
    id: 'rings',
    name: '고리계 & 양치기 위성',
    group: '원반 역학',
    desc: '토성급 행성 주위 1만 개 규모 고리 입자(축소판)와 양치기 위성. 공명 간극(카시니 간극과 유사한 구조)이 스스로 형성됩니다.',
    units: { length: 'AU', time: 'day', mass: 'M☉' },
    rate: 3600, dt: 0.002, integrator: 'verlet', softening: 2e-6, collisions: false,
    camera: 0.006, scale: 'linear',
    build(sim) {
      const M = 2.85886e-4;
      sim.add({
        name: '토성형 행성', mass: M, pos: [0, 0, 0], vel: [0, 0, 0],
        radius: km(58232), color: 0xe3d3a0, type: 'planet', trail: false,
      });
      const R = rng(23);
      for (let k = 0; k < 900; k++) {
        const a = km(74000) + R() * km(66000);
        const th = R() * Math.PI * 2;
        const vc = Math.sqrt(G_SIM * M / a);
        const z = (R() - 0.5) * a * 0.0015;
        sim.add({
          name: `고리입자 ${k}`, mass: 0,
          pos: [a * Math.cos(th), a * Math.sin(th), z],
          vel: [-vc * Math.sin(th), vc * Math.cos(th), 0],
          radius: km(2), color: k % 7 === 0 ? 0xfff0d0 : 0xd8cbb0,
          type: 'dust', drawScale: 8, trail: false,
        });
      }
      const shepherds = [
        { name: '판도라', a: km(141700), m: 7.5e-17, r: 41, c: 0xbfae94 },
        { name: '프로메테우스', a: km(139400), m: 8.4e-17, r: 43, c: 0xc9b89c },
        { name: '미마스', a: km(185500), m: 1.88e-11, r: 198, c: 0xd9d2c4 },
      ];
      for (const s of shepherds) {
        const vc = Math.sqrt(G_SIM * M / s.a);
        const th = R() * Math.PI * 2;
        sim.add({
          name: s.name, mass: s.m,
          pos: [s.a * Math.cos(th), s.a * Math.sin(th), 0],
          vel: [-vc * Math.sin(th), vc * Math.cos(th), 0],
          radius: km(s.r), color: s.c, type: 'moon', drawScale: 4,
        });
      }
    },
  },

  {
    id: 'cluster',
    name: '구상성단 (플러머 구)',
    group: '항성계 역학',
    desc: '플러머 모형에서 추출한 500개 항성의 자기중력계. 비리얼 평형(2T/|U| = 1) 에서 출발해 질량 분리와 중심 붕괴가 진행됩니다.',
    units: { length: 'code', time: 'code', mass: 'code' },
    G: 1, rate: 0.5, dt: 0.002, integrator: 'verlet', softening: 0.02,
    barnesHut: true, theta: 0.6, collisions: false,
    camera: 12, scale: 'linear',
    build(sim) {
      const N = 500, a = 1, Mtot = 1;
      const R = rng(1337);
      for (let k = 0; k < N; k++) {
        const m = Mtot / N * (0.3 + 2.2 * Math.pow(R(), 2.2)); // 질량함수 근사
        // 플러머 반지름 샘플링
        const u = R();
        const r = a / Math.sqrt(Math.pow(u, -2 / 3) - 1);
        const p = randDir(R, r);
        // 속도: rejection sampling  g(q) = q²(1−q²)^3.5
        let q, g;
        do { q = R(); g = R() * 0.1; } while (g > q * q * Math.pow(1 - q * q, 3.5));
        const ve = Math.sqrt(2) * Math.pow(1 + r * r / (a * a), -0.25);
        const v = randDir(R, q * ve);
        const T = 2500 + 9000 * Math.pow(m * N, 1.4);
        sim.add({
          name: `Star ${k + 1}`, mass: m, pos: p, vel: v,
          radius: 0.004, color: blackbodyHex(Math.min(30000, T)),
          type: 'star', glow: 0.25, trail: false, drawScale: 1 + 2 * m * N,
        });
      }
      sim.recenter();
    },
  },

  {
    id: 'collision',
    name: '은하 충돌',
    group: '항성계 역학',
    desc: '두 원반 은하가 근접 조우합니다. 조석꼬리와 다리 구조가 형성되고 결국 하나의 타원은하로 병합됩니다. Barnes-Hut 트리로 계산합니다.',
    units: { length: 'code', time: 'code', mass: 'code' },
    G: 1, rate: 0.5, dt: 0.004, integrator: 'verlet', softening: 0.06,
    barnesHut: true, theta: 0.7, collisions: false,
    camera: 40, scale: 'linear',
    build(sim) {
      const R = rng(4242);
      makeDisk(sim, R, { center: [-9, -5, 0], vel: [0.32, 0.10, 0], Mbulge: 6, N: 700, rd: 3.2, tilt: 0, color: 0x8fc6ff });
      makeDisk(sim, R, { center: [9, 5, 0], vel: [-0.32, -0.10, 0], Mbulge: 4, N: 500, rd: 2.6, tilt: 60, color: 0xffb98f });
      sim.recenter();
    },
  },

  {
    id: 'tidal',
    name: '블랙홀 조석 파괴',
    group: '항성계 역학',
    desc: '자기중력으로 묶인 항성(1 M, 400입자)이 1000 M 블랙홀에 포물선 궤도로 접근합니다. 근점 q = 1.2 는 조석반경 r_t ≈ 3 의 안쪽이라 항성이 완전히 찢어지고, 근점에서 각 파편이 자신의 궤도에너지를 고정받아 절반은 속박(되돌아와 강착)·절반은 탈출 조석꼬리로 갈라집니다.',
    units: { length: 'code', time: 'code', mass: 'code' },
    G: 1, rate: 1, dt: 0.0015, integrator: 'verlet', softening: 0.02, collisions: true,
    camera: 16, scale: 'linear',
    build(sim) {
      sim.add({
        name: '초대질량 블랙홀', mass: 1000, pos: [0, 0, 0], vel: [0, 0, 0],
        radius: 0.15, color: 0x2a0a3a, type: 'bh', glow: 1.4, trail: false,
      });
      // 포물선 궤도(q = 1.2)의 접근 구간: r = 8, L = √(2μq) = 49.0
      const R = rng(99);
      const c = [-8, 0, 0], v0 = [14.58, 6.12, 0];
      const N = 400, Mstar = 1, ap = 0.15;
      for (let k = 0; k < N; k++) {
        // 플러머 구 — 비리얼 평형 상태의 항성
        let r;
        do { r = ap / Math.sqrt(Math.pow(R(), -2 / 3) - 1); } while (!(r < 0.5));
        const p = randDir(R, r);
        let q, g;
        do { q = R(); g = R() * 0.1; } while (g > q * q * Math.pow(1 - q * q, 3.5));
        const ve = Math.sqrt(2 * Mstar / ap) * Math.pow(1 + r * r / (ap * ap), -0.25);
        const v = randDir(R, q * ve);
        sim.add({
          name: `항성물질 ${k + 1}`, mass: Mstar / N, radius: 0.0008,
          pos: [c[0] + p[0], c[1] + p[1], c[2] + p[2]],
          vel: [v0[0] + v[0], v0[1] + v[1], v0[2] + v[2]],
          color: blackbodyHex(6500), type: 'dust', glow: 0.4, trail: false, drawScale: 1,
        });
      }
    },
  },

  {
    id: 'protoplanet',
    name: '원시행성계 원반 집적',
    group: '원반 역학',
    desc: '1 M☉ 항성 주위 미행성 300개. 충돌 병합을 켠 상태로 적분하면 과두성장을 거쳐 소수의 원시행성이 남습니다.',
    units: { length: 'AU', time: 'day', mass: 'M☉' },
    rate: 31557600, dt: 0.3, integrator: 'verlet', softening: 3e-4, collisions: true,
    camera: 5, scale: 'linear',
    build(sim) {
      addSun(sim);
      const R = rng(808);
      for (let k = 0; k < 300; k++) {
        const a = 0.5 + Math.pow(R(), 0.7) * 3.5;
        const m = MSUN_PER_MEARTH * (0.008 + R() * 0.05);
        const s = stateFromElements(G_SIM, {
          a, e: R() * 0.03, i: (R() - 0.5) * 2, Omega: R() * 360, omega: R() * 360, M0: R() * 360,
        });
        sim.add({
          name: `미행성 ${k + 1}`, mass: m, pos: s.r, vel: s.v,
          radius: km(2600) * Math.cbrt(m / (MSUN_PER_MEARTH * 0.02)),
          color: 0xc98a5c, type: 'planet', trail: false, drawScale: 400,
        });
      }
    },
  },
];

function randDir(R, r) {
  const u = 2 * R() - 1, th = R() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return [r * s * Math.cos(th), r * s * Math.sin(th), r * u];
}

function makeDisk(sim, R, { center, vel, Mbulge, N, rd, tilt, color }) {
  const t = tilt * DEG, ct = Math.cos(t), st = Math.sin(t);
  const rot = (p) => [p[0], p[1] * ct - p[2] * st, p[1] * st + p[2] * ct];
  sim.add({
    name: `은하핵 (${Mbulge})`, mass: Mbulge, pos: center, vel,
    radius: 0.25, color: 0xfff0c0, type: 'bh', glow: 1.1, trail: true, drawScale: 2.5,
  });
  const mStar = Mbulge * 0.25 / N;
  for (let k = 0; k < N; k++) {
    const r = -rd * Math.log(1 - 0.985 * R()) * 0.5 + 0.4;
    const th = R() * Math.PI * 2;
    const Menc = Mbulge + Mbulge * 0.25 * (1 - Math.exp(-r / rd) * (1 + r / rd));
    const vc = Math.sqrt(Menc / Math.max(r, 0.2));
    const p = rot([r * Math.cos(th), r * Math.sin(th), (R() - 0.5) * 0.12 * rd]);
    const v = rot([-vc * Math.sin(th), vc * Math.cos(th), 0]);
    sim.add({
      name: `star`, mass: mStar,
      pos: [center[0] + p[0], center[1] + p[1], center[2] + p[2]],
      vel: [vel[0] + v[0], vel[1] + v[1], vel[2] + v[2]],
      radius: 0.01, color, type: 'dust', trail: false, glow: 0.3, drawScale: 1.2,
    });
  }
}

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}

/** 시나리오를 시뮬레이터에 적용 */
export function loadScenario(sim, sc, opts = {}) {
  sim.clear();
  sim.G = sc.G ?? G_SIM;
  sim.softening = sc.softening ?? 1e-5;
  sim.integrator = sc.integrator ?? 'verlet';
  sim.useBarnesHut = sc.barnesHut ?? false;
  sim.theta = sc.theta ?? 0.6;
  sim.collisions = sc.collisions ?? false;
  sim.relativistic = sc.relativistic ?? false;
  sim._primed = false;
  sc.build(sim, opts);
  sim.markBaseline();
  return sim;
}

export { PLANETS, DAY_PER_YEAR };
