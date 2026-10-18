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
