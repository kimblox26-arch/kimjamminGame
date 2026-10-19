// 좌표계 공용 모듈
//  - "절대(평면) 좌표" abs: 미터, 서울 한강변 원점, +X 동쪽, +Y 위(해발), +Z 남쪽. 물리는 이 좌표에서 계산.
//  - "렌더 좌표" = abs - origin. 부동소수 정밀도 때문에 플레이어 근처를 원점으로 유지(플로팅 원점).
//  - "행성 좌표" planet: 미터, 지구 중심 = (0,0,0), 서울 지표 = (0, R, 0). 평면 좌표의 x,z 를 지표 위 호의 길이로 감아 구면에 대응.
import * as THREE from 'three';

export const R_EARTH = 6371000;
export const C_LIGHT = 299792458;
export const ATMO_TOP = 100000;           // 대기권 상단 (m)
export const SCALE_HEIGHT = 8500;         // 대기 밀도 척도 높이 (m)

// 렌더 좌표 원점의 절대 좌표 (double)
export const origin = new THREE.Vector3();

const listeners = [];
// 리베이스 시 콜백 (dx,dy,dz): 저장해 둔 렌더 좌표에서 이 값을 빼야 함
export function onRebase(fn) { listeners.push(fn); }
export function rebase(dx, dy, dz) {
  origin.x += dx; origin.y += dy; origin.z += dz;
  for (const fn of listeners) fn(dx, dy, dz);
}

// 해수면 대비 상대 공기 밀도 (0..1)
export function airDensity(alt) { return Math.exp(-Math.max(0, alt) / SCALE_HEIGHT); }

// 평면(abs) → 행성 좌표
export function flatToPlanet(x, y, z, out) {
  const a = x / R_EARTH, b = z / R_EARTH;
  const cb = Math.cos(b), r = R_EARTH + y;
  return out.set(Math.sin(a) * cb * r, Math.cos(a) * cb * r, Math.sin(b) * r);
}

// 행성 좌표 → 평면(abs)
export function planetToFlat(px, py, pz, out) {
  const r = Math.hypot(px, py, pz) || 1;
  const b = Math.asin(Math.max(-1, Math.min(1, pz / r)));
  const a = Math.atan2(px, py);
  return out.set(a * R_EARTH, r - R_EARTH, b * R_EARTH);
}

// 평면 좌표 (x,z) 지점의 지역 축(동 +X, 위 +Y, 남 +Z)을 행성 좌표로 돌리는 회전
const _e = new THREE.Vector3(), _u = new THREE.Vector3(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();
export function localToPlanetQuat(x, z, out) {
  const a = x / R_EARTH, b = z / R_EARTH;
  const sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(b), cb = Math.cos(b);
  _e.set(ca, -sa, 0);
  _u.set(sa * cb, ca * cb, sb);
  _s.set(-sa * sb, -ca * sb, cb);
  _m.makeBasis(_e, _u, _s);
  return out.setFromRotationMatrix(_m);
}

// 천체 (행성 좌표, 미터). 해는 서울 하늘에서 보이는 방향과 같게 (main 의 sunDir).
export const SUN_DIR = new THREE.Vector3(-0.66, 0.5, -0.56).normalize();
export const SUN = { dir: SUN_DIR, dist: 1.496e11, radius: 6.9634e8, pos: SUN_DIR.clone().multiplyScalar(1.496e11) };
// 달: 서울 낮하늘 북동쪽 고도 약 45°
export const MOON_DIR = new THREE.Vector3(0.45, 0.72, -0.53).normalize();
export const MOON = { radius: 1737400, dist: 3.844e8, pos: MOON_DIR.clone().multiplyScalar(3.844e8) };
export const EARTH = { radius: R_EARTH, pos: new THREE.Vector3(0, 0, 0) };

// ───────── 태양계 (행성 좌표, 미터) ─────────
// 황도면 기저: u = 태양→지구 방향, v = 황도면 안의 수직, n = 황도 북극 (지구 자전축에서 23.4° 기운 방향 근사)
const AU = 1.496e11;
export { AU };
const _eu = SUN_DIR.clone().negate();
const _en = new THREE.Vector3(0, Math.cos(52.5 * Math.PI / 180), -Math.sin(52.5 * Math.PI / 180)).projectOnPlane(_eu).normalize()
  .applyAxisAngle(_eu, 23.4 * Math.PI / 180);
const _ev = new THREE.Vector3().crossVectors(_en, _eu).normalize();
export const ECLIPTIC = { u: _eu, v: _ev, n: _en };
const G = 6.674e-11;
// 태양 기준 위치 (AU, 황경 상대각°): J2000 근처의 실제 황경을 지구 기준으로 돌린 값
function helio(aAU, degFromEarth) {
  const t = degFromEarth * Math.PI / 180;
  return SUN.pos.clone().addScaledVector(_eu, Math.cos(t) * aAU * AU).addScaledVector(_ev, Math.sin(t) * aAU * AU);
}
function around(parentPos, distM, deg, incl = 0) {
  const t = deg * Math.PI / 180;
  return parentPos.clone().addScaledVector(_eu, Math.cos(t) * distM).addScaledVector(_ev, Math.sin(t) * distM).addScaledVector(_en, Math.sin(incl) * distM);
}
// kind: rocky | gas | ice | moon | star | earth
// breakV: 이 속도(m/s) 이상으로 부딪히면 천체가 산산조각 (중력 결합 에너지 ∝ M²/R 에 비례하게 잡은 게임 값)
function body(id, name, kind, radiusKm, pos, massEarth, extra = {}) {
  const M = massEarth * 5.972e24;
  const R = radiusKm * 1000;
  const breakV = 1e10 * massEarth / Math.sqrt(R / 6.371e6);
  return Object.assign({ id, name, kind, radius: R, pos, GM: G * M, mass: M, breakV }, extra);
}
const JUP = helio(5.203, -66), SAT = helio(9.537, -50);
export const BODIES = [
  body('sun', '태양', 'star', 696340, SUN.pos, 333000, { breakV: Infinity }),
  body('mercury', '수성', 'rocky', 2440, helio(0.387, 152), 0.0553, { c1: [0.42, 0.4, 0.38], c2: [0.25, 0.24, 0.23] }),
  body('venus', '금성', 'cloud', 6052, helio(0.723, 82), 0.815, { c1: [0.95, 0.85, 0.6], c2: [0.8, 0.62, 0.35] }),
  body('earth', '지구', 'earth', 6371, EARTH.pos, 1.0),
  body('moon', '달', 'moon', 1737.4, MOON.pos, 0.0123),
  body('mars', '화성', 'rocky', 3390, helio(1.524, 255), 0.107, { c1: [0.75, 0.36, 0.18], c2: [0.45, 0.2, 0.1], ice: 1 }),
  body('jupiter', '목성', 'gas', 69911, JUP, 317.8, { c1: [0.85, 0.75, 0.6], c2: [0.62, 0.42, 0.28], spot: 1 }),
  body('io', '이오', 'rocky', 1822, around(JUP, 4.217e8, 40), 0.015, { c1: [0.92, 0.85, 0.4], c2: [0.7, 0.4, 0.15] }),
  body('europa', '유로파', 'ice', 1561, around(JUP, 6.71e8, 130), 0.008, { c1: [0.85, 0.82, 0.75], c2: [0.6, 0.45, 0.35] }),
  body('ganymede', '가니메데', 'rocky', 2634, around(JUP, 1.07e9, 220), 0.025, { c1: [0.55, 0.52, 0.48], c2: [0.35, 0.33, 0.3] }),
  body('callisto', '칼리스토', 'rocky', 2410, around(JUP, 1.883e9, 310), 0.018, { c1: [0.4, 0.37, 0.33], c2: [0.22, 0.2, 0.18] }),
  body('saturn', '토성', 'gas', 58232, SAT, 95.2, { c1: [0.9, 0.82, 0.62], c2: [0.75, 0.62, 0.42], rings: 1 }),
  body('titan', '타이탄', 'cloud', 2575, around(SAT, 1.222e9, 70), 0.0225, { c1: [0.85, 0.6, 0.3], c2: [0.7, 0.45, 0.2] }),
  body('uranus', '천왕성', 'ice', 25362, helio(19.19, 214), 14.5, { c1: [0.6, 0.85, 0.88], c2: [0.5, 0.75, 0.8] }),
  body('neptune', '해왕성', 'ice', 24622, helio(30.07, 204), 17.1, { c1: [0.25, 0.42, 0.9], c2: [0.15, 0.28, 0.7] }),
  body('pluto', '명왕성', 'rocky', 1188, helio(39.48, 138), 0.0022, { c1: [0.78, 0.7, 0.6], c2: [0.5, 0.38, 0.3] }),
];
export const BODY = Object.fromEntries(BODIES.map((b) => [b.id, b]));
// 지구 파괴 속도 (게임 값): 광속의 약 33배
export const EARTH_BREAK_V = BODY.earth.breakV;
