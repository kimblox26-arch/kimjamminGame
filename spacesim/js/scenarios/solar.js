// SpaceSim — 태양계: 실제 날짜의 실제 위치에서 시작하는 N-체 적분
// · 행성: JPL 근사 궤도 요소 → 지정한 날짜(기본: 지금)의 일심 위치/속도
// · 달: Meeus 평균 요소 · 갈릴레이 위성: Meeus 44장 위상 · 자전축과 자전 위상: IAU WGCCRE 2015
// · 표면: 실제 행성 사진 텍스처 (지구 낮/밤/구름/바다 반사, 토성 고리 등)
import * as THREE from 'three';
import { NBodyScenario } from './nbody-base.js';
import { G_AU, DEG, TAU, AU_KM, ecl, keplerToState, rng, fmtDuration, daysSinceJ2000, iauFrame, galileanU } from '../util.js';
import { BODIES, visRadius } from '../catalog.js';

const KM = 1 / AU_KM;
const PLANET_KEYS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const MOON_KEYS = ['io', 'europa', 'ganymede', 'callisto', 'titan'];
const SEC_YR = 1 / 31557600;

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
    this.startMs = app.solarStart ?? Date.now();
    this.build();
  }

  build() {
    const app = this.app;
    const d0 = daysSinceJ2000(this.startMs), T = d0 / 36525;
    this.d0 = d0;
    const R = rng(42);
    const S = BODIES.sun;
    this.sun = this.addBody({
      ...S, kind: 'star', visR: 0.15, realR: S.R * KM, p: [0, 0, 0], v: [0, 0, 0], rotRate: 0, glow: 1.15, coronaI: 0.75, orbit: false, trailLen: 2,
    });
    this.sun.key = 'sun';
    const byKey = { sun: this.sun };
    const helio = {};
    for (const key of PLANET_KEYS) {
      const P = BODIES[key];
      const [a, e, I, L, wb, Om] = P.el.map((v, k) => v + P.rt[k] * T);
      const M = ((((L - wb) % 360) + 540) % 360) - 180;
      const st = keplerToState(a, e, I * DEG, Om * DEG, (wb - Om) * DEG, M * DEG, G_AU * (1 + P.m));
      const period = Math.pow(a, 1.5);
      const common = { ...P, rotRate: 0, trailDt: period / 340, visR: visRadius(P), realR: P.R * KM };
      if (P.emb) {
        // 지구-달 질량 중심 분리 (Meeus 평균 요소)
        const mM = BODIES.moon.m, mE = P.m, mu = G_AU * (mE + mM);
        const Lm = 218.3165 + 481267.8813 * T, Nm = 125.0445 - 1934.1363 * T, Pm = 83.3532 + 4069.0137 * T;
        const rel = keplerToState(0.00256955, 0.0549, 5.145 * DEG, Nm * DEG, (Pm - Nm) * DEG, (Lm - Pm) * DEG, mu);
        const fE = mM / (mE + mM), fM = mE / (mE + mM);
        const pe = st.p.map((v, k) => v - rel.p[k] * fE), ve = st.v.map((v, k) => v - rel.v[k] * fE);
        const pm = st.p.map((v, k) => v + rel.p[k] * fM), vm = st.v.map((v, k) => v + rel.v[k] * fM);
        const earth = this.addBody({ ...common, m: mE, p: ecl(...pe), v: ecl(...ve) });
        const Mo = BODIES.moon;
        const moon = this.addBody({
          ...Mo, parent: earth, moonScale: 50, p: ecl(...pm), v: ecl(...vm), visR: visRadius(Mo), realR: Mo.R * KM, rotRate: 0,
          trailDt: 27.32 / 365.25 / 120, trailLen: 130,
        });
        byKey.earth = earth; byKey.moon = moon; earth.key = 'earth'; moon.key = 'moon';
        helio.earth = ecl(...pe);
      } else {
        byKey[key] = this.addBody({ ...common, p: ecl(...st.p), v: ecl(...st.v) });
        byKey[key].key = key;
        helio[key] = ecl(...st.p);
      }
    }
    // 위성: 모행성 적도면 (IAU 극), 갈릴레이 위성은 Meeus 위상
    const gal = galileanU(d0);
    for (const key of MOON_KEYS) {
      const Mo = BODIES[key], host = byKey[Mo.parent], hi = host.idx, sim = this.sim;
      const a = Mo.a * KM, Mhost = sim.m[hi], vc = Math.sqrt((G_AU * (Mhost + Mo.m)) / a);
      const pole = iauFrame(host.iau, d0).pole;
      let ref;
      if (Mo.gal !== undefined) ref = new THREE.Vector3(...helio.earth).sub(new THREE.Vector3(sim.x[hi], sim.y[hi], sim.z[hi]));
      else ref = new THREE.Vector3(1, 0, 0);
      ref.addScaledVector(pole, -ref.dot(pole)).normalize();
      const side = new THREE.Vector3().crossVectors(pole, ref);
      const u = (Mo.gal !== undefined ? gal[Mo.gal] : R() * 360) * DEG;
      const loc = ref.clone().multiplyScalar(Math.cos(u) * a).addScaledVector(side, Math.sin(u) * a);
      const vel = ref.clone().multiplyScalar(-Math.sin(u) * vc).addScaledVector(side, Math.cos(u) * vc);
      const per = TAU * Math.sqrt((a * a * a) / (G_AU * Mhost));
      byKey[key] = this.addBody({
        ...Mo, parent: host, moonScale: Mo.parent === 'jupiter' ? 85 : 55,
        p: [sim.x[hi] + loc.x, sim.y[hi] + loc.y, sim.z[hi] + loc.z], v: [sim.vx[hi] + vel.x, sim.vy[hi] + vel.y, sim.vz[hi] + vel.z],
        visR: visRadius(Mo), realR: Mo.R * KM, rotRate: 0, trailDt: per / 120, trailLen: 130,
      });
      byKey[key].key = key;
    }
    this.sim.toCOM();
    this.sim.computeAcc();
    // 실제 자전축 방향
    for (const b of this.bodies) {
      if (!b.iau) continue;
      const f = iauFrame(b.iau, d0);
      b.visual.setOrientation(f.quat);
      b.spin = f.W;
      b.wRate = b.iau[5] * DEG * 365.25; // rad/yr
    }
    const q = app.quality;
    this.belt = makeBelt(q.belt, 2.1, 3.3, 0.18, 0.3, 3, 0.4, app.pixelRatio);
    this.kuiper = makeBelt(Math.round(q.belt * 0.6), 30, 48, 0.12, 0.25, 9, 0.35, app.pixelRatio);
    this.root.add(this.belt, this.kuiper);
    this.byKey = byKey;
  }

  get warp() { return { min: SEC_YR, max: 25, def: 1 / 365.25, fmt: (w) => (Math.abs(w - SEC_YR) < SEC_YR * 0.05 ? '실시간 (1초/초)' : `${fmtDuration(w)}/초`) }; }

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
    this.app.toast(on ? '실제 크기·거리 비율 — 행성은 점보다 작습니다. 이름표를 눌러 접근하세요' : '시각 강조 (행성 확대 · 위성 거리 확대)');
  }

  update(dt) {
    super.update(dt);
    // 자전: IAU 본초자오선 각 W(t). 프레임당 회전이 크면(고배속) 화면용 각속도로 제한
    const d = this.d0 + this.sim.time * 365.25;
    for (const b of this.bodies) {
      if (!b.iau) continue;
      const perFrame = Math.abs(b.wRate * (this.simRate || 0) * dt);
      if (perFrame < 0.35) b.spin = ((((b.iau[4] + b.iau[5] * d) % 360) + 360) % 360) * DEG;
      else b.spin += Math.sign(b.wRate) * 1.2 * dt;
    }
    const t = this.sim.time + this.d0 / 365.25;
    this.belt.material.uniforms.uTime.value = t;
    this.kuiper.material.uniforms.uTime.value = t;
    this.belt.position.copy(this.sun.vis);
    this.kuiper.position.copy(this.sun.vis);
    this.belt.visible = this.kuiper.visible = this.showBelts !== false;
  }

  nowMs() { return this.startMs + this.sim.time * 365.25 * 86400000; }

  clock() {
    const d = new Date(this.nowMs());
    if (!isFinite(d)) return { main: '—', sub: '' };
    const p = (n) => String(n).padStart(2, '0');
    const off = -d.getTimezoneOffset() / 60;
    return {
      main: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
      sub: `UTC${off >= 0 ? '+' : ''}${off} · 시작 후 ${fmtDuration(Math.abs(this.sim.time))}`,
    };
  }

  jumpTo(ms) {
    this.app.solarStart = ms;
    this.app.setScenario('solar');
  }

  panel() {
    const keys = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
    return [
      { type: 'datetime', label: '날짜·시각 (이 순간의 실제 위치로 이동)', value: this.startMs, on: (ms) => this.jumpTo(ms) },
      { type: 'chips', label: '시간', items: [
        { label: '지금 시각', act: true, on: () => this.jumpTo(Date.now()) },
        { label: '실시간 재생', on: () => this.app.setWarp(SEC_YR) },
        { label: '1일/초', on: () => this.app.setWarp(1 / 365.25) },
        { label: '1개월/초', on: () => this.app.setWarp(1 / 12) },
        { label: '1년/초', on: () => this.app.setWarp(1) },
      ] },
      { type: 'chips', label: '천체로 이동', items: keys.map((k) => ({ label: BODIES[k].name, on: () => { const b = this.byKey[k]; if (b && !b.dead) this.select(b, true); } })) },
      { type: 'chips', label: '전경', items: [
        { label: '내행성계', on: () => { this.select(null); this.app.controls.focus(() => this.sun.vis, 5); } },
        { label: '외행성계', on: () => { this.select(null); this.app.controls.focus(() => this.sun.vis, 75); } },
        { label: '카이퍼대', on: () => { this.select(null); this.app.controls.focus(() => this.sun.vis, 160); } },
      ] },
      { type: 'toggle', label: '실제 크기·거리 비율', value: this.realScale, on: (v) => this.setRealScale(v) },
      { type: 'toggle', label: '소행성대 · 카이퍼대', value: this.showBelts !== false, on: (v) => (this.showBelts = v) },
      { type: 'readouts', items: ['천체 수', '적분 스텝/프레임', '에너지 보존 오차', '적분기'] },
      { type: 'hint', text: '행성·달·갈릴레이 위성의 위치, 자전축 방향, 자전 위상(낮/밤)은 선택한 날짜의 실제 값입니다(JPL·Meeus·IAU). 지구의 낮밤 경계는 지금 이 순간과 같습니다. 크기는 보기 쉽도록 강조되어 있습니다.' },
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
