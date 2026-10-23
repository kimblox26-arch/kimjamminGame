// 시나리오: 실제 천체 데이터 (JPL 근사 궤도요소 J2000 + 세기당 평균경도 변화율)
import { G, C, AU, DAY, YEAR, KPC, MSUN, RSUN, LSUN, MEARTH, REARTH, MJUP, RJUP, D2R, TAU,
  elementsToState, tiltVec, add, mul, sub, rng, gauss, blackbody } from './orbit.js';

let UID = 0;
export function makeBody(o) {
  const b = Object.assign({ id: ++UID, type: 'planet', name: '?', en: '', mass: 1, radius: 1, pos: [0, 0, 0], vel: [0, 0, 0],
    tilt: 0, rotP: 0, alive: true, style: null, lum: 0, temp: 0, ring: null, atmo: null }, o);
  if (b.type === 'star' && !b.color) b.color = blackbody(b.temp || 5772);
  if (!b.color) b.color = b.style ? b.style.a : [1, 1, 1];
  return b;
}
const star = (o) => makeBody(Object.assign({ type: 'star' }, o, { lum: o.lum ?? LSUN * Math.pow(o.mass / MSUN, 3.5) }));

export function makeGroup(name, n, o = {}) {
  return Object.assign({ name, n, P: new Float64Array(3 * n), V: new Float64Array(3 * n), alive: new Uint8Array(n).fill(1),
    col: new Float32Array(3 * n), size: 1.6, alpha: 0.85, visc: 0, respawn: null, beam: false }, o);
}
function setP(g, i, r, v, c) { g.P.set(r, 3 * i); g.V.set(v, 3 * i); g.col.set(c, 3 * i); }

function recenter(sc) {
  let m = 0; const p = [0, 0, 0], v = [0, 0, 0];
  for (const b of sc.bodies) { m += b.mass; for (let k = 0; k < 3; k++) { p[k] += b.mass * b.pos[k]; v[k] += b.mass * b.vel[k]; } }
  for (let k = 0; k < 3; k++) { p[k] /= m; v[k] /= m; }
  for (const b of sc.bodies) { b.pos = sub(b.pos, p); b.vel = sub(b.vel, v); }
  for (const g of sc.groups) for (let i = 0; i < g.n; i++) for (let k = 0; k < 3; k++) { g.P[3 * i + k] -= p[k]; g.V[3 * i + k] -= v[k]; }
  if (sc.ship) { sc.ship.pos = sub(sc.ship.pos, p); sc.ship.vel = sub(sc.ship.vel, v); }
  return sc;
}

const base = (o) => Object.assign({ warp: 1, method: 'yoshida', eta: 0.02, soft: 0, gr: false, collide: true, tides: false,
  orbitMode: 'kepler', trailFrame: 'parent', trailDt: DAY, focus: null, camDist: null, timeMode: 'elapsed', lens: false, epochMs: 0 }, o);

// ───────── 태양계 ─────────
const PLANETS = [
  // 이름, 영문, a(AU), e, I, L, ϖ, Ω (deg), L̇(deg/세기), 질량, 반지름(km), 자전(h), 기울기, 외형
  ['수성', 'Mercury', 0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593, 149472.67411175, 3.3011e23, 2439.7, 1407.6, 0.03,
    { k: 'rocky', a: [.40, .38, .36], b: [.63, .60, .56] }],
  ['금성', 'Venus', 0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255, 58517.81538729, 4.8675e24, 6051.8, 5832.5, 177.4,
    { k: 'cloud', a: [.93, .82, .60], b: [.80, .64, .42], atmo: [1, .85, .6], th: .045 }, { rho0: 65, H: 15900, top: 250e3 }],
  ['EMB'], // 지구–달 질량중심
  ['화성', 'Mars', 1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891, 19140.30268499, 6.4171e23, 3389.5, 24.623, 25.19,
    { k: 'mars', a: [.76, .38, .20], b: [.42, .21, .12], atmo: [.95, .62, .42], th: .014 }, { rho0: 0.020, H: 11100, top: 120e3 }],
  ['목성', 'Jupiter', 5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909, 3034.74612775, 1.89819e27, 69911, 9.925, 3.13,
    { k: 'gas', a: [.86, .76, .63], b: [.66, .45, .30], c: [.96, .94, .89], p: [17, .55, 1, 0], atmo: [.85, .75, .6], th: .012 }, { rho0: 0.16, H: 27000, top: 1e6 }],
  ['토성', 'Saturn', 9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448, 1222.49362201, 5.6834e26, 58232, 10.656, 26.73,
    { k: 'gas', a: [.93, .85, .66], b: [.78, .66, .46], c: [.96, .91, .79], p: [23, .3, 0, 0], atmo: [.9, .82, .62], th: .012 }, { rho0: 0.19, H: 59500, top: 1e6 },
    { inner: 74500e3, outer: 136800e3, col: [.86, .78, .64], op: .95 }],
  ['천왕성', 'Uranus', 19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503, 428.48202785, 8.6813e25, 25362, 17.24, 97.77,
    { k: 'gas', a: [.62, .86, .89], b: [.54, .78, .83], c: [.72, .91, .93], p: [9, .12, 0, 0], atmo: [.6, .85, .95], th: .015 }, { rho0: 0.42, H: 27700, top: 1e6 },
    { inner: 41800e3, outer: 51200e3, col: [.6, .65, .7], op: .25 }],
  ['해왕성', 'Neptune', 30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574, 218.45945325, 1.02413e26, 24622, 16.11, 28.32,
    { k: 'gas', a: [.26, .44, .88], b: [.17, .29, .70], c: [.52, .67, .96], p: [12, .4, 2, 0], atmo: [.4, .6, 1], th: .015 }, { rho0: 0.45, H: 19700, top: 1e6 }],
  ['명왕성', 'Pluto', 39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684, 145.20780515, 1.303e22, 1188.3, 153.3, 122.53,
    { k: 'rocky', a: [.55, .45, .38], b: [.88, .80, .72], c: [.95, .9, .85] }],
];
const MOONS = [
  // 이름, 영문, 모행성, a(km), e, i(적도 기준), 질량, 반지름(km), 외형
  ['이오', 'Io', 'Jupiter', 421700, .0041, .05, 8.9319e22, 1821.6, { k: 'lava', a: [.92, .82, .38], b: [.78, .47, .16], c: [.12, .08, .04] }],
  ['유로파', 'Europa', 'Jupiter', 671034, .009, .47, 4.7998e22, 1560.8, { k: 'ice', a: [.88, .85, .78], b: [.62, .40, .26] }],
  ['가니메데', 'Ganymede', 'Jupiter', 1070412, .0013, .2, 1.4819e23, 2634.1, { k: 'rocky', a: [.42, .39, .35], b: [.72, .70, .66] }],
  ['칼리스토', 'Callisto', 'Jupiter', 1882709, .0074, .19, 1.0759e23, 2410.3, { k: 'rocky', a: [.28, .25, .22], b: [.55, .52, .48] }],
  ['타이탄', 'Titan', 'Saturn', 1221870, .0288, .35, 1.3452e23, 2574.7, { k: 'cloud', a: [.86, .62, .28], b: [.72, .46, .16], atmo: [.95, .7, .35], th: .12 }, { rho0: 5.3, H: 40000, top: 600e3 }],
  ['트리톤', 'Triton', 'Neptune', 354759, .000016, 157, 2.139e22, 1353.4, { k: 'ice', a: [.84, .78, .74], b: [.66, .52, .50] }],
  ['카론', 'Charon', 'Pluto', 19591, .0002, 0, 1.586e21, 606, { k: 'rocky', a: [.44, .42, .41], b: [.64, .62, .60] }],
];

function solar() {
  const nowMs = Date.now(), jd = nowMs / 86400000 + 2440587.5, d = jd - 2451545, T = d / 36525;
  const r = rng(7);
  const sun = star({ name: '태양', en: 'Sun', mass: MSUN, radius: RSUN, lum: LSUN, temp: 5772, rotP: 609.12 * 3600, tilt: 7.25 });
  const bodies = [sun], byEn = { Sun: sun };
  for (const p of PLANETS) {
    if (p[0] === 'EMB') {
      const mE = MEARTH, mM = 7.342e22, mu = G * (MSUN + mE + mM);
      const L = 100.46457166 + 35999.37244981 * T, vp = 102.93768193, a = 1.00000261 * AU;
      const st = elementsToState(mu, a, 0.01671123, -0.00001531 * D2R, 0, vp * D2R, (L - vp) * D2R);
      const mo = elementsToState(G * (mE + mM), 384400e3, 0.0549, 5.1454 * D2R, (125.1228 - 0.0529538083 * d) * D2R,
        (318.0634 + 0.1643573223 * d) * D2R, (115.3654 + 13.0649929509 * d) * D2R);
      const fE = mM / (mE + mM), fM = mE / (mE + mM);
      const earth = makeBody({ name: '지구', en: 'Earth', mass: mE, radius: REARTH, rotP: 23.9345 * 3600, tilt: 23.44,
        pos: sub(st.r, mul(mo.r, fE)), vel: sub(st.v, mul(mo.v, fE)),
        style: { k: 'earth', a: [.05, .18, .42], b: [.22, .42, .16], atmo: [.32, .58, 1], th: .028 }, atmo: { rho0: 1.225, H: 8500, top: 140e3 } });
      const moon = makeBody({ name: '달', en: 'Moon', type: 'moon', mass: mM, radius: 1737.4e3, rotP: 655.72 * 3600, tilt: 6.68,
        pos: add(st.r, mul(mo.r, fM)), vel: add(st.v, mul(mo.v, fM)), style: { k: 'rocky', a: [.36, .36, .36], b: [.70, .69, .67] } });
      bodies.push(earth, moon); byEn.Earth = earth; byEn.Moon = moon;
      continue;
    }
    const [name, en, a, e, I, L, vp, O, Ld, m, R, rot, tilt, style, atmo, ring] = p;
    const Lt = L + Ld * T;
    const st = elementsToState(G * (MSUN + m), a * AU, e, I * D2R, O * D2R, (vp - O) * D2R, (Lt - vp) * D2R);
    const b = makeBody({ name, en, mass: m, radius: R * 1e3, rotP: rot * 3600, tilt, pos: st.r, vel: st.v, style, atmo: atmo || null, ring: ring || null });
    bodies.push(b); byEn[en] = b;
  }
  for (const [name, en, par, a, e, inc, m, R, style, atmo] of MOONS) {
    const P = byEn[par], mt = P.mass + m;
    const st = elementsToState(G * mt, a * 1e3, e, inc * D2R, r() * TAU, r() * TAU, r() * TAU);
    const rr = tiltVec(st.r, P.tilt * D2R), vv = tiltVec(st.v, P.tilt * D2R), fP = m / mt, fM = P.mass / mt;
    const b = makeBody({ name, en, type: 'moon', mass: m, radius: R * 1e3, pos: add(P.pos, mul(rr, fM)), vel: add(P.vel, mul(vv, fM)),
      rotP: TAU * Math.sqrt((a * 1e3) ** 3 / (G * mt)), tilt: P.tilt, style, atmo: atmo || null });
    P.pos = sub(P.pos, mul(rr, fP)); P.vel = sub(P.vel, mul(vv, fP));
    bodies.push(b);
  }
  // 소행성대 · 트로이군 · 카이퍼대 (질량 없는 시험 입자)
  const jup = PLANETS[4], Lj = jup[5] + jup[8] * T;
  const muS = G * MSUN, groups = [];
  const belt = makeGroup('소행성대', 2600, { size: 1.4 }), troj = makeGroup('트로이군', 700, { size: 1.5 }), kb = makeGroup('카이퍼대', 1200, { size: 1.4 });
  for (let i = 0; i < belt.n; i++) {
    const st = elementsToState(muS, (2.1 + 1.2 * r()) * AU, 0.18 * r(), Math.abs(gauss(r)) * 7 * D2R, r() * TAU, r() * TAU, r() * TAU);
    const g = 0.45 + 0.25 * r(); setP(belt, i, add(sun.pos, st.r), add(sun.vel, st.v), [g, g * 0.92, g * 0.82]);
  }
  for (let i = 0; i < troj.n; i++) {
    const lam = (Lj + (i % 2 ? 60 : -60) + gauss(r) * 12) * D2R, vp = r() * TAU;
    const st = elementsToState(muS, (5.2 + gauss(r) * 0.08) * AU, 0.08 * r(), Math.abs(gauss(r)) * 12 * D2R, r() * TAU, vp, lam - vp);
    setP(troj, i, add(sun.pos, st.r), add(sun.vel, st.v), [0.75, 0.5, 0.38]);
  }
  for (let i = 0; i < kb.n; i++) {
    const res = i < 300, a = res ? 39.4 : 42 + 6 * r(), e = res ? 0.1 + 0.2 * r() : 0.1 * r();
    const st = elementsToState(muS, a * AU, e, Math.abs(gauss(r)) * (res ? 15 : 6) * D2R, r() * TAU, r() * TAU, r() * TAU);
    setP(kb, i, add(sun.pos, st.r), add(sun.vel, st.v), [0.55, 0.62, 0.75]);
  }
  groups.push(belt, troj, kb);
  // 우주선: 고도 400 km, 궤도경사 51.6° 원궤도 (ISS 궤도)
  const E = byEn.Earth, so = elementsToState(G * E.mass, E.radius + 400e3, 0, 51.6 * D2R, r() * TAU, 0, r() * TAU);
  const ship = { pos: add(E.pos, tiltVec(so.r, E.tilt * D2R)), vel: add(E.vel, tiltVec(so.v, E.tilt * D2R)) };
  return recenter({ bodies, groups, ship, cfg: base({ warp: 1, timeMode: 'date', epochMs: nowMs, focus: 'ship', camDist: 45, trailDt: 6 * 3600 }) });
}

// ───────── 쌍성계 Kepler-16 (주쌍성 행성) ─────────
function binary() {
  const r = rng(3);
  const A = star({ name: 'Kepler-16 A', en: 'K dwarf', mass: 0.6897 * MSUN, radius: 0.6489 * RSUN, temp: 4450, lum: 0.148 * LSUN });
  const B = star({ name: 'Kepler-16 B', en: 'M dwarf', mass: 0.20255 * MSUN, radius: 0.22623 * RSUN, temp: 3300, lum: 0.0055 * LSUN });
  const mb = A.mass + B.mass, bin = elementsToState(G * mb, 0.22431 * AU, 0.15944, 0, 0, 263.464 * D2R, 0);
  A.pos = mul(bin.r, -B.mass / mb); A.vel = mul(bin.v, -B.mass / mb); B.pos = mul(bin.r, A.mass / mb); B.vel = mul(bin.v, A.mass / mb);
  const pm = 0.333 * MJUP, ps = elementsToState(G * (mb + pm), 0.7048 * AU, 0.0069, 0.3 * D2R, 0, 0, 1.2);
  const b = makeBody({ name: 'Kepler-16 b', en: 'Circumbinary planet', mass: pm, radius: 0.7538 * RJUP, rotP: 12 * 3600, tilt: 8, pos: ps.r, vel: ps.v,
    style: { k: 'gas', a: [.78, .70, .58], b: [.58, .46, .36], c: [.88, .84, .76], p: [14, .4, 0, 0], atmo: [.8, .7, .6], th: .015 } });
  const cs = elementsToState(G * mb, 1.25 * AU, 0.02, 1 * D2R, 0, 0, 4.0);
  const c = makeBody({ name: '가상 행성 c', en: 'Hypothetical super-Earth', mass: 3 * MEARTH, radius: 1.4 * REARTH, rotP: 20 * 3600, tilt: 15, pos: cs.r, vel: cs.v,
    style: { k: 'earth', a: [.06, .22, .40], b: [.40, .36, .20], atmo: [.4, .6, 1], th: .03 } });
  const g = makeGroup('잔해 원반', 3000, { size: 1.5 });
  for (let i = 0; i < g.n; i++) {
    const st = elementsToState(G * mb, (0.3 + 1.6 * r()) * AU, 0.02 * r(), 1.5 * gauss(r) * D2R, r() * TAU, 0, r() * TAU);
    const t = 0.5 + 0.4 * r(); setP(g, i, st.r, st.v, [t, t * 0.85, t * 0.7]);
  }
  return recenter({ bodies: [A, B, b, c], groups: [g], cfg: base({ warp: 2e5, pitch: 0.7, orbitMode: 'trail', trailFrame: 'bary', trailDt: DAY / 2, focus: 'Kepler-16 A', camDist: 3 * AU }) });
}

// ───────── 삼체 문제 ─────────
function threeBody(kind) {
  const L = AU, V = Math.sqrt(G * MSUN / AU), cols = [[1, .55, .3], [.4, .7, 1], [1, .95, .6]];
  let set;
  if (kind === 'fig8') {
    const x1 = [0.97000436, -0.24308753], v3 = [-0.93240737, -0.86473146];
    set = [[1, [x1[0], x1[1]], [-v3[0] / 2, -v3[1] / 2]], [1, [-x1[0], -x1[1]], [-v3[0] / 2, -v3[1] / 2]], [1, [0, 0], v3]];
  } else set = [[3, [1, 3], [0, 0]], [4, [-2, -1], [0, 0]], [5, [1, -1], [0, 0]]];
  const bodies = set.map(([m, p, v], k) => star({ name: ['α', 'β', 'γ'][k] + (kind === 'fig8' ? '' : ` (${m} M☉)`), en: 'Star', mass: m * MSUN,
    radius: (kind === 'fig8' ? 1 : 0.25) * RSUN * Math.pow(m, 0.8), temp: [4200, 7500, 5800][k], pos: [p[0] * L, p[1] * L, 0], vel: [v[0] * V, v[1] * V, 0] }));
  return recenter({ bodies, groups: [], cfg: base({ pitch: 1.3, warp: kind === 'fig8' ? 2e6 : 3e6, eta: 0.004, collide: kind === 'fig8', orbitMode: 'trail', trailFrame: 'bary',
    trailDt: kind === 'fig8' ? 2e4 : 1.5e4, focus: '#bary', camDist: (kind === 'fig8' ? 3.2 : 9) * AU }) });
}

// ───────── 은하 충돌 (Toomre & Toomre 1972 제한 3체 모형) ─────────
function galaxy() {
  const r = rng(11), eps = 1.2 * KPC, MA = 1e11 * MSUN, MB = 0.6e11 * MSUN, mu = G * (MA + MB), q = 18 * KPC, nu = -115 * D2R;
  const rr = 2 * q / (1 + Math.cos(nu)), vk = Math.sqrt(mu / (2 * q));
  const rel = [rr * Math.cos(nu), rr * Math.sin(nu), 0], vrel = [-vk * Math.sin(nu), vk * (1 + Math.cos(nu)), 0];
  const core = (name, m, pos, vel, col) => makeBody({ name, en: 'Galactic core (Plummer)', type: 'core', mass: m, radius: 0, pos, vel, color: col });
  const A = core('은하 A', MA, mul(rel, -MB / (MA + MB)), mul(vrel, -MB / (MA + MB)), [1, .9, .75]);
  const B = core('은하 B', MB, mul(rel, MA / (MA + MB)), mul(vrel, MA / (MA + MB)), [1, .8, .55]);
  const nA = 9000, nB = 6000, g = makeGroup('항성', nA + nB, { size: 1.6, alpha: 0.7 });
  const disk = (c, i0, n, rmax, inc, spin, hue) => {
    for (let k = 0; k < n; k++) {
      const rad = (1.5 + (rmax - 1.5) * Math.pow(r(), 0.75)) * KPC, th = r() * TAU;
      const vc = Math.sqrt(G * c.mass * rad * rad / Math.pow(rad * rad + eps * eps, 1.5)) * spin;
      const p = tiltVec([rad * Math.cos(th), rad * Math.sin(th), gauss(r) * 0.15 * KPC], inc), v = tiltVec([-vc * Math.sin(th), vc * Math.cos(th), 0], inc);
      const f = rad / (rmax * KPC), col = hue ? [1, 0.8 - 0.25 * f, 0.5 - 0.3 * f] : [0.95 - 0.45 * f, 0.9 - 0.2 * f, 0.8 + 0.2 * f];
      setP(g, i0 + k, add(c.pos, p), add(c.vel, v), col);
    }
  };
  disk(A, 0, nA, 14, 15 * D2R, 1, 0); disk(B, nA, nB, 10, -60 * D2R, 1, 1);
  return recenter({ bodies: [A, B], groups: [g], cfg: base({ unit: 1e13, pitch: 0.95, warp: 3e14, soft: eps, collide: false, orbitMode: 'trail', trailFrame: 'bary',
    trailDt: 2e13, focus: '#bary', camDist: 110 * KPC }) });
}

// ───────── 초대질량 블랙홀 · 강착원반 · 조석 붕괴 ─────────
function blackhole() {
  const r = rng(5), M = 4.3e6 * MSUN, rs = 2 * G * M / (C * C);
  const bh = makeBody({ name: 'Sgr A*', en: 'Supermassive black hole', type: 'blackhole', mass: M, radius: rs, color: [0, 0, 0] });
  const orbitPW = (a, e, i, w, Mn) => { const s = elementsToState(G * M, a * rs, e, i * D2R, 0, w * D2R, Mn); return s; };
  const stars = [
    ['S1', 1.0, 80, 0.6, 20, 0, 0.5, 5800], ['S2', 2.5, 140, 0.35, -35, 90, 2.0, 9000], ['S3', 0.8, 55, 0.2, 60, 200, 4.0, 4800],
    ['희생 항성', 1.0, 110, 0.935, 10, 300, Math.PI, 5600],
  ].map(([name, m, a, e, i, w, Mn, T]) => { const s = orbitPW(a, e, i, w, Mn);
    return star({ name, en: 'Star', mass: m * MSUN, radius: RSUN * Math.pow(m, 0.8), temp: T, pos: s.r, vel: s.v }); });
  const g = makeGroup('강착원반', 9000, { size: 1.7, alpha: 0.8, visc: 0.004, beam: true });
  const put = (i, rin, rout) => {
    const rad = (rin + (rout - rin) * Math.pow(r(), 1.4)) * rs, th = r() * TAU, v = Math.sqrt(G * M * rad) / (rad - rs);
    const Tn = Math.pow(6 * rs / rad, 0.75), col = blackbody(2400 + 11000 * Tn).map(c => c * (0.35 + 1.3 * Tn));
    setP(g, i, add(bh.pos, [rad * Math.cos(th), rad * Math.sin(th), gauss(r) * 0.012 * rad]), add(bh.vel, [-v * Math.sin(th), v * Math.cos(th), 0]), col);
    g.alive[i] = 1;
  };
  for (let i = 0; i < g.n; i++) put(i, 6.5, 40);
  g.respawn = i => put(i, 34, 40);
  return recenter({ bodies: [bh, ...stars], groups: [g], cfg: base({ warp: 2e4, pitch: 0.22, orbitMode: 'trail', trailFrame: 'bary', trailDt: 2500, focus: 'Sgr A*',
    camDist: 120 * rs, lens: true, tides: true, gr: false }) });
}

// ───────── 원시 행성계 원반 (충돌·병합에 의한 행성 형성) ─────────
function formation() {
  const r = rng(9), S = star({ name: '원시별', en: 'Protostar', mass: MSUN, radius: RSUN * 1.4, temp: 4600, lum: 1.6 * LSUN });
  const bodies = [S], mu = G * MSUN, INF = 70; // 충돌 단면 확대 계수
  for (let k = 0; k < 90; k++) {
    const m = MEARTH * Math.exp(Math.log(0.04) + r() * Math.log(0.5 / 0.04)), a = (0.45 + 1.6 * Math.pow(r(), 0.9)) * AU;
    const st = elementsToState(mu, a, 0.06 * r(), r() * 0.6 * D2R, r() * TAU, r() * TAU, r() * TAU);
    const t = r();
    bodies.push(makeBody({ name: `미행성 ${k + 1}`, en: 'Planetesimal', mass: m, radius: INF * REARTH * Math.cbrt(m / MEARTH), pos: st.r, vel: st.v,
      rotP: 30 * 3600, tilt: 20 * r(), style: { k: 'rocky', a: [.35 + .2 * t, .3 + .1 * t, .25], b: [.62, .55, .48] } }));
  }
  const g = makeGroup('먼지', 3500, { size: 1.5, alpha: 0.55 });
  for (let i = 0; i < g.n; i++) {
    const st = elementsToState(mu, (0.3 + 2.6 * Math.pow(r(), 0.8)) * AU, 0.05 * r(), gauss(r) * 2 * D2R, r() * TAU, r() * TAU, r() * TAU);
    setP(g, i, st.r, st.v, [0.85, 0.6 + 0.2 * r(), 0.4]);
  }
  return recenter({ bodies, groups: [g], cfg: base({ warp: 3e7, pitch: 0.75, method: 'leapfrog', eta: 0.03, orbitMode: 'trail', trailFrame: 'bary', trailDt: 5 * DAY,
    focus: '원시별', camDist: 5 * AU }) });
}

function sandbox() {
  const S = star({ name: '항성', en: 'Star', mass: MSUN, radius: RSUN, lum: LSUN, temp: 5772 });
  const st = elementsToState(G * MSUN, AU, 0.0167, 0, 0, 0, 0);
  const E = makeBody({ name: '행성', en: 'Planet', mass: MEARTH, radius: REARTH, rotP: 86164, tilt: 23.4, pos: st.r, vel: st.v,
    style: { k: 'earth', a: [.05, .18, .42], b: [.22, .42, .16], atmo: [.32, .58, 1], th: .028 } });
  return recenter({ bodies: [S, E], groups: [], cfg: base({ warp: 1e6, focus: '항성', camDist: 2.5 * AU, trailDt: DAY }) });
}

export const SCENARIOS = {
  solar: { name: '태양계 — 실시간 궤도 (JPL J2000 요소)', desc: '오늘 날짜의 실제 행성 위치에서 시작합니다. 지구 저궤도(400 km)의 우주선을 직접 조종해 달·화성으로 가보세요.', make: solar },
  binary: { name: '쌍성계 Kepler-16 — 두 개의 태양', desc: '실측 데이터 기반 주쌍성 행성계. 쌍성 근처의 불안정 영역에서 잔해 원반이 깎여 나가는 과정을 관찰합니다.', make: binary },
  fig8: { name: '삼체 문제 — 8자 궤도 (Chenciner–Montgomery)', desc: '같은 질량의 세 별이 하나의 8자 궤도를 공유하는 주기해. 적분기를 바꾸면 수치 오차가 궤도를 어떻게 망가뜨리는지 볼 수 있습니다.', make: () => threeBody('fig8') },
  pyth: { name: '삼체 문제 — 피타고라스 문제 (Burrau)', desc: '질량 3·4·5의 별이 3-4-5 직각삼각형 꼭짓점에서 정지 상태로 출발. 카오스적 근접조우 끝에 하나가 방출됩니다.', make: () => threeBody('pyth') },
  galaxy: { name: '은하 충돌 — Toomre & Toomre 모형', desc: '두 원반 은하가 포물선 궤도로 스쳐 지나가며 조석 꼬리와 다리가 형성됩니다. 15,000개 항성 (Plummer 연화 퍼텐셜).', make: galaxy },
  blackhole: { name: '초대질량 블랙홀 — 강착원반 · 조석 붕괴', desc: '파친스키–비타 의사뉴턴 퍼텐셜(ISCO = 6 GM/c²), 중력렌즈, 도플러 빔효과. 근접 통과하는 별이 조석력에 찢겨 흐름(stream)이 됩니다.', make: blackhole },
  formation: { name: '원시 행성계 원반 — 행성 형성', desc: '90개 미행성이 중력 섭동으로 궤도가 교차하며 충돌·병합해 원시 행성으로 자랍니다 (운동량 보존 비탄성 병합).', make: formation },
  sandbox: { name: '샌드박스 — 직접 만들기', desc: '왼쪽 "천체 추가"로 행성·항성·블랙홀을 배치하세요. 클릭 = 원궤도, 드래그 = 속도 지정.', make: sandbox },
};

// 사용자 추가 천체
export function spawnBody(kind, mult, pos, vel) {
  const k = {
    rocky: () => { const m = MEARTH * mult; return makeBody({ name: '암석 행성', en: 'Rocky planet', mass: m, radius: REARTH * Math.cbrt(mult), rotP: 86400, tilt: 20,
      style: { k: 'mars', a: [.55, .45, .38], b: [.32, .28, .26], atmo: [.6, .7, 1], th: .02 } }); },
    ocean: () => makeBody({ name: '바다 행성', en: 'Ocean planet', mass: MEARTH * mult, radius: REARTH * Math.cbrt(mult), rotP: 86400, tilt: 23,
      style: { k: 'earth', a: [.04, .16, .40], b: [.30, .40, .18], atmo: [.32, .58, 1], th: .028 } }),
    gas: () => makeBody({ name: '가스 행성', en: 'Gas giant', mass: MJUP * mult, radius: RJUP * Math.min(1.1, Math.pow(mult, 0.1)), rotP: 36000, tilt: 5,
      style: { k: 'gas', a: [.80, .62, .50], b: [.55, .35, .28], c: [.95, .88, .80], p: [16, .5, 1, 0], atmo: [.85, .7, .6], th: .012 } }),
    star: () => star({ name: '항성', en: 'Star', mass: MSUN * mult, radius: RSUN * Math.pow(mult, 0.8), temp: 5772 * Math.pow(mult, 0.5) }),
    blackhole: () => { const m = 10 * MSUN * mult; return makeBody({ name: '블랙홀', en: 'Black hole', type: 'blackhole', mass: m, radius: 2 * G * m / (C * C), color: [0, 0, 0] }); },
  }[kind]();
  k.pos = pos; k.vel = vel; k.name += ' #' + k.id;
  return k;
}
