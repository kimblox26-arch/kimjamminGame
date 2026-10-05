// SpaceSim — 태양계: JPL 근사 궤도 요소로 오늘 날짜의 실제 배치에서 시작하는 N-체 적분
import * as THREE from 'three';
import { NBodyScenario } from './nbody-base.js';
import { G_AU, DEG, TAU, AU_KM, ecl, keplerToState, rng, fmtDuration } from '../util.js';

const KM = 1 / AU_KM;
const visR = (km) => 0.04 * Math.pow(km / 6371, 0.46);

// a, e, I, L, ϖ, Ω (J2000) + 세기당 변화율 — JPL "Approximate Positions of the Planets"
const PLANETS = [
  { name: '수성', type: '지구형 행성', el: [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593], rt: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
    m: 1.6601e-7, R: 2440, tilt: 0.03, rot: 1407.6, style: 'rocky', look: { colA: 0x8f8a84, colB: 0x5f5b56, colC: 0x45423f, spot: 0.25 }, color: 0xb5aea6,
    desc: '태양에 가장 가까운 행성. 대기가 거의 없어 낮 430 °C, 밤 −180 °C의 극단적 온도차를 보입니다.' },
  { name: '금성', type: '지구형 행성', el: [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255], rt: [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
    m: 2.4478e-6, R: 6052, tilt: 177.4, rot: -5832.5, style: 'cloudy', look: { colA: 0xe9d4a6, colB: 0xc49c5e, colC: 0xfff3d6, atmo: 0xffd9a0, atmoDensity: 1.3 }, color: 0xf0d9a8,
    desc: '두꺼운 이산화탄소 대기와 황산 구름이 폭주 온실효과를 일으켜 표면 온도가 465 °C에 달합니다. 역방향으로 자전합니다.' },
  { name: '지구', type: '지구형 행성', el: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0], rt: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0],
    m: 3.0034e-6, R: 6371, tilt: 23.44, rot: 23.934, style: 'earth', look: { clouds: true, atmo: 0x5aa6ff, atmoDensity: 1.7, atmoPower: 3.0, atmoScale: 1.04 }, color: 0x6fb2ff, emb: true,
    desc: '액체 상태의 물과 생명이 확인된 유일한 행성. 자전축이 23.4° 기울어져 계절이 생깁니다.' },
  { name: '화성', type: '지구형 행성', el: [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891], rt: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
    m: 3.2271e-7, R: 3390, tilt: 25.19, rot: 24.62, style: 'mars', look: { colA: 0xb8582c, colB: 0x5c2c18, colC: 0xd99466, atmo: 0xff9e70, atmoDensity: 0.55, atmoPower: 4.5 }, color: 0xe07850,
    desc: '산화철 먼지로 붉게 보이는 행성. 태양계 최대 화산 올림푸스 산과 거대 협곡 마리네리스가 있습니다.' },
  { name: '목성', type: '가스 거대 행성', el: [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909], rt: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
    m: 9.5479e-4, R: 69911, tilt: 3.13, rot: 9.925, style: 'gas', look: { colA: 0xdcc6a6, colB: 0xa36a45, colC: 0xf2e9da, spot: 1, bands: 14, atmo: 0xd8c8b0, atmoDensity: 0.45 }, color: 0xe0b98c,
    desc: '태양계에서 가장 큰 행성. 지구보다 큰 폭풍인 대적점이 350년 넘게 지속되고 있습니다.' },
  { name: '토성', type: '가스 거대 행성', el: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448], rt: [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
    m: 2.8589e-4, R: 58232, tilt: 26.73, rot: 10.656, style: 'gas', look: { colA: 0xead9b2, colB: 0xc4a46c, colC: 0xf5ecd4, bands: 18, rings: true, atmo: 0xe8d8b0, atmoDensity: 0.4 }, color: 0xf0d9a0,
    desc: '얼음과 암석 조각으로 이루어진 장대한 고리를 가진 행성. 평균 밀도가 물보다 낮습니다.' },
  { name: '천왕성', type: '얼음 거대 행성', el: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503], rt: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
    m: 4.3662e-5, R: 25362, tilt: 97.77, rot: -17.24, style: 'ice', look: { colA: 0xa6e6ec, colB: 0x83cbd8, colC: 0x5aa0b8, bands: 6, atmo: 0xaaf0ff, atmoDensity: 0.7 }, color: 0x9fe6f0,
    desc: '자전축이 98° 기울어 옆으로 누운 채 공전합니다. 메테인 대기가 청록색을 띱니다.' },
  { name: '해왕성', type: '얼음 거대 행성', el: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574], rt: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
    m: 5.1514e-5, R: 24622, tilt: 28.32, rot: 16.11, style: 'ice', look: { colA: 0x4170e0, colB: 0x2c50b8, colC: 0x14204e, bands: 8, spot: 1, atmo: 0x6a9cff, atmoDensity: 0.8 }, color: 0x5d8bff,
    desc: '태양계 가장 바깥의 행성. 시속 2,000 km가 넘는 태양계 최강의 바람이 붑니다.' },
  { name: '명왕성', type: '왜소행성', el: [39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684], rt: [-0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
    m: 6.58e-9, R: 1188, tilt: 122.5, rot: -153.3, style: 'pluto', look: { colA: 0xc9a98a, colB: 0x7a5a44 }, color: 0xd8c0a8, dwarf: true,
    desc: '카이퍼 벨트의 왜소행성. 하트 모양의 질소 얼음 평원 스푸트니크 평원이 유명합니다.' },
];

// 위성: 모행성, 장반경(km), 질량(M☉), 반지름(km), 공전 주기(일)
const MOONS = [
  { name: '이오', parent: '목성', a: 421700, m: 4.4797e-8, R: 1822, style: 'io', look: { colA: 0xe8d36a, colB: 0xcf9a3a, colC: 0xf6f0d6 }, color: 0xf0d870, desc: '태양계에서 화산 활동이 가장 활발한 천체. 목성의 조석 가열로 400개 이상의 활화산이 있습니다.' },
  { name: '유로파', parent: '목성', a: 671034, m: 2.4078e-8, R: 1561, style: 'europa', look: { colA: 0xece4d6, colB: 0xcbbca3, colC: 0x8a5634 }, color: 0xe8dcc8, desc: '얼음 지각 아래 전 지구적 액체 바다가 있을 것으로 추정되는, 생명 탐사의 핵심 후보지입니다.' },
  { name: '가니메데', parent: '목성', a: 1070412, m: 7.4539e-8, R: 2634, style: 'rocky', look: { colA: 0x9d8f80, colB: 0x6a5f54, colC: 0xbab0a2, spot: 0.6 }, color: 0xb8aa98, desc: '태양계 최대의 위성으로 수성보다 큽니다. 고유 자기장을 가진 유일한 위성입니다.' },
  { name: '칼리스토', parent: '목성', a: 1882709, m: 5.4074e-8, R: 2410, style: 'rocky', look: { colA: 0x62584d, colB: 0x3d362f, colC: 0x8f8574, spot: 0.15 }, color: 0x8a8070, desc: '태양계에서 크레이터가 가장 많은 천체 중 하나. 40억 년 된 오래된 표면을 간직하고 있습니다.' },
  { name: '타이탄', parent: '토성', a: 1221870, m: 6.7628e-8, R: 2575, style: 'cloudy', look: { colA: 0xd99a4a, colB: 0xb47530, colC: 0xeab872, atmo: 0xffb060, atmoDensity: 1.1 }, color: 0xe8a858, desc: '두꺼운 질소 대기를 가진 위성. 표면에는 액체 메테인 호수와 강이 흐릅니다.' },
];

const BELT_VERT = /* glsl */ `
attribute vec4 aOrb; attribute vec3 aOrb2;
uniform float uTime, uPR;
varying float vB; varying vec3 vC;
void main(){
  float a=aOrb.x, e=aOrb.y, inc=aOrb.z, Om=aOrb.w, w=aOrb2.x, M0=aOrb2.y;
  float M = M0 + 6.2831853/(a*sqrt(a))*uTime;
  M = mod(M, 6.2831853);
  float E = M; for(int k=0;k<5;k++) E = E - (E - e*sin(E) - M)/(1.-e*cos(E));
  float xv=a*(cos(E)-e), yv=a*sqrt(1.-e*e)*sin(E);
  float cO=cos(Om), sO=sin(Om), cw=cos(w), sw=sin(w), ci=cos(inc), si=sin(inc);
  float x=(cO*cw-sO*sw*ci)*xv+(-cO*sw-sO*cw*ci)*yv;
  float y=(sO*cw+cO*sw*ci)*xv+(-sO*sw+cO*cw*ci)*yv;
  float z=(sw*si)*xv+(cw*si)*yv;
  vec4 mv = modelViewMatrix*vec4(x,z,-y,1.);
  gl_Position = projectionMatrix*mv;
  gl_PointSize = clamp(aOrb2.z*uPR*(.55+1.2/max(-mv.z,.1)), 1., 4.);
  vB = aOrb2.z;
  vC = mix(vec3(.75,.68,.6), vec3(.55,.6,.7), fract(aOrb2.y*7.));
}`;
const BELT_FRAG = /* glsl */ `
uniform float uBright; varying float vB; varying vec3 vC;
void main(){ vec2 c=gl_PointCoord*2.-1.; float d=dot(c,c); if(d>1.) discard; gl_FragColor=vec4(vC*uBright*(1.-d)*(.4+vB*.3),1.); }`;

function makeBelt(count, aMin, aMax, eMax, iMax, seed, bright, pr) {
  const r = rng(seed);
  const o1 = new Float32Array(count * 4), o2 = new Float32Array(count * 3), pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    let a = aMin + (aMax - aMin) * r();
    // 커크우드 간극 (목성 공명) 회피
    for (const g of [2.5, 2.82, 2.95, 3.27]) if (Math.abs(a - g) < 0.03 && aMax < 4) a += 0.07;
    o1.set([a, r() * eMax, Math.abs(r() + r() - 1) * iMax, r() * TAU], i * 4);
    o2.set([r() * TAU, r() * TAU, 0.6 + r() * 1.2], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aOrb', new THREE.BufferAttribute(o1, 4));
  geo.setAttribute('aOrb2', new THREE.BufferAttribute(o2, 3));
  const mat = new THREE.ShaderMaterial({ vertexShader: BELT_VERT, fragmentShader: BELT_FRAG, uniforms: { uTime: { value: 0 }, uPR: { value: pr }, uBright: { value: bright } }, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

export class SolarScenario extends NBodyScenario {
  constructor(app) {
    super(app, { G: G_AU, dtMax: 0.00005, primary: 'heaviest', trailLen: 360, minFocus: 0.05 });
    this.realScale = false;
    this.startMs = Date.now();
    this.build();
  }

  build() {
    const app = this.app;
    const T = (this.startMs - Date.UTC(2000, 0, 1, 12)) / (86400000 * 36525);
    const R = rng(42);
    this.sun = this.addBody({
      name: '태양', type: 'G2V 주계열성', kind: 'star', temp: 5772, m: 1, visR: 0.15, realR: 695700 * KM, p: [0, 0, 0], v: [0, 0, 0],
      rotRate: TAU / (25.4 / 365.25), glow: 1.9, coronaI: 1.1, orbit: false, trailLen: 2, color: 0xffe2b0,
      desc: '태양계 질량의 99.86%를 차지하는 G형 주계열성. 중심핵에서 매초 6억 톤의 수소를 헬륨으로 융합합니다.',
    });
    const byName = {};
    for (const P of PLANETS) {
      const el = P.el.map((v, k) => v + P.rt[k] * T);
      const [a, e, I, L, wb, Om] = el;
      const M = ((((L - wb) % 360) + 540) % 360) - 180;
      const s = keplerToState(a, e, I * DEG, Om * DEG, (wb - Om) * DEG, M * DEG, G_AU * (1 + P.m));
      const period = Math.pow(a, 1.5);
      const common = {
        name: P.name, type: P.type, style: P.style, look: P.look, color: P.color, tilt: P.tilt, desc: P.desc,
        rotRate: (TAU * 8766) / P.rot, trailDt: period / 340, visR: visR(P.R) * (P.dwarf ? 1.2 : 1), realR: P.R * KM,
      };
      if (P.emb) {
        // 지구-달 질량 중심 분리 (Meeus 평균 요소)
        const mM = 3.6943e-8, mE = P.m, mu = G_AU * (mE + mM);
        const Lm = 218.3165 + 481267.8813 * T, Nm = 125.0445 - 1934.1363 * T, Pm = 83.3532 + 4069.0137 * T;
        const rel = keplerToState(0.00256955, 0.0549, 5.145 * DEG, Nm * DEG, (Pm - Nm) * DEG, (Lm - Pm) * DEG, mu);
        const fE = mM / (mE + mM), fM = mE / (mE + mM);
        const pe = s.p.map((v, k) => v - rel.p[k] * fE), ve = s.v.map((v, k) => v - rel.v[k] * fE);
        const pm = s.p.map((v, k) => v + rel.p[k] * fM), vm = s.v.map((v, k) => v + rel.v[k] * fM);
        const earth = this.addBody({ ...common, m: mE, p: ecl(...pe), v: ecl(...ve) });
        byName[P.name] = earth;
        this.addBody({
          name: '달', type: '지구의 위성', parent: earth, moonScale: 50, m: mM, p: ecl(...pm), v: ecl(...vm),
          style: 'rocky', look: { colA: 0x9c9a95, colB: 0x6e6c68, colC: 0x3a3938, spot: 1 }, color: 0xcfcac2,
          visR: visR(1737), realR: 1737 * KM, rotRate: TAU / (27.32 / 365.25), trailDt: 27.32 / 365.25 / 120, trailLen: 130,
          desc: '지구의 유일한 자연 위성. 조석 고정되어 항상 같은 면을 지구로 향합니다.',
        });
      } else {
        byName[P.name] = this.addBody({ ...common, m: P.m, p: ecl(...s.p), v: ecl(...s.v) });
      }
    }
    // 목성/토성 위성 (모행성 적도면)
    for (const Mo of MOONS) {
      const host = byName[Mo.parent], hi = host.idx, sim = this.sim;
      const a = Mo.a * KM, Mhost = sim.m[hi];
      const ang = R() * TAU, vc = Math.sqrt((G_AU * (Mhost + Mo.m)) / a);
      const tilt = host.tilt * DEG;
      const loc = new THREE.Vector3(Math.cos(ang) * a, 0, Math.sin(ang) * a);
      const vel = new THREE.Vector3(-Math.sin(ang) * vc, 0, Math.cos(ang) * vc);
      const rot = new THREE.Euler(0, 0, tilt);
      loc.applyEuler(rot); vel.applyEuler(rot);
      const per = TAU * Math.sqrt((a * a * a) / (G_AU * Mhost));
      this.addBody({
        name: Mo.name, type: `${Mo.parent}의 위성`, parent: host, moonScale: Mo.parent === '목성' ? 85 : 55, m: Mo.m,
        p: [sim.x[hi] + loc.x, sim.y[hi] + loc.y, sim.z[hi] + loc.z], v: [sim.vx[hi] + vel.x, sim.vy[hi] + vel.y, sim.vz[hi] + vel.z],
        style: Mo.style, look: Mo.look, color: Mo.color, visR: visR(Mo.R), realR: Mo.R * KM, rotRate: TAU / per, trailDt: per / 120, trailLen: 130, desc: Mo.desc,
      });
    }
    this.sim.toCOM();
    this.sim.computeAcc();

    const q = app.quality;
    this.belt = makeBelt(q.belt, 2.1, 3.3, 0.18, 0.3, 3, 0.4, app.pixelRatio);
    this.kuiper = makeBelt(Math.round(q.belt * 0.6), 30, 48, 0.12, 0.25, 9, 0.35, app.pixelRatio);
    this.root.add(this.belt, this.kuiper);
    this.byName = byName;
  }

  get warp() { return { min: 1 / 8766, max: 25, def: 0.03, fmt: (w) => `${fmtDuration(w)}/초` }; }

  view() { return { theta: 0.5, phi: 1.05, radius: 5.5, from: 60 }; }

  start() {
    const c = this.app.controls;
    c.minR = 2e-5; c.maxR = 400; c.minNear = 1e-7; c.minFar = 300;
    c.set({ theta: 0.4, phi: 1.2, radius: 90, jump: true });
    c.set({ theta: 0.9, phi: 1.08, radius: 5.2 });
    c.focus(() => this.sun.vis, null, 0.1);
  }

  setRealScale(on) {
    this.realScale = on;
    for (const b of this.bodies) {
      b.visR = on ? b.realR : b.enhR;
      b.moonScale = on ? 1 : b.enhMoonScale;
      b.visual.setRadius(b.visR);
      if (b.parent) b.trail.reset();
    }
    this.app.toast(on ? '실제 크기 비율: 행성은 점보다 작습니다 — 이름표를 눌러 접근하세요' : '시각 강조 크기 (행성 확대 · 위성 거리 확대)');
  }

  update(dt) {
    super.update(dt);
    const t = this.sim.time + (this.startMs - Date.UTC(2000, 0, 1, 12)) / (86400000 * 365.25);
    this.belt.material.uniforms.uTime.value = t;
    this.kuiper.material.uniforms.uTime.value = t;
    this.belt.position.copy(this.sun.vis);
    this.kuiper.position.copy(this.sun.vis);
    this.belt.visible = this.kuiper.visible = this.showBelts !== false;
  }

  clock() {
    const d = new Date(this.startMs + this.sim.time * 365.25 * 86400000);
    const p = (n) => String(n).padStart(2, '0');
    return {
      main: isFinite(d) ? `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC` : '—',
      sub: `경과 ${fmtDuration(this.sim.time)}`,
    };
  }

  panel() {
    const names = ['태양', '수성', '금성', '지구', '화성', '목성', '토성', '천왕성', '해왕성', '명왕성'];
    return [
      { type: 'chips', label: '천체로 이동', items: names.map((n) => ({ label: n, on: () => { const b = n === '태양' ? this.sun : this.byName[n]; if (b && !b.dead) this.select(b, true); } })) },
      { type: 'chips', label: '전경', items: [
        { label: '내행성계', on: () => { this.select(null); this.app.controls.focus(() => this.sun.vis, 5); } },
        { label: '외행성계', on: () => { this.select(null); this.app.controls.focus(() => this.sun.vis, 75); } },
        { label: '카이퍼대', on: () => { this.select(null); this.app.controls.focus(() => this.sun.vis, 160); } },
      ] },
      { type: 'toggle', label: '실제 크기 비율', value: false, on: (v) => this.setRealScale(v) },
      { type: 'toggle', label: '소행성대 · 카이퍼대', value: true, on: (v) => (this.showBelts = v) },
      { type: 'readouts', items: ['천체 수', '적분 스텝/프레임', '에너지 보존 오차', '적분기'] },
      { type: 'hint', text: '행성 크기는 보기 쉽도록 강조되어 있고, 위성은 모행성 주위 거리가 확대되어 표시됩니다. 물리 계산은 실제 질량·거리로 수행됩니다.' },
    ];
  }

  readouts() {
    return {
      '천체 수': `${this.sim.n} + 소행성 ${this.app.quality.belt}`,
      '적분 스텝/프레임': `${this.sim.lastSteps || 0}${this.lagging ? ' ⚠' : ''}`,
      '에너지 보존 오차': this.dE ? this.dE.toExponential(2) : '—',
      '적분기': 'KDK 립프로그 · Δt 26분',
    };
  }
}
