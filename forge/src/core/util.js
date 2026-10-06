// 공용 수학/유틸리티
import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const Q = () => new THREE.Quaternion();
export const UP = new THREE.Vector3(0, 1, 0);

// rapier <-> three 변환
export const toV = (r, out = new THREE.Vector3()) => out.set(r.x, r.y, r.z);
export const toQ = (r, out = new THREE.Quaternion()) => out.set(r.x, r.y, r.z, r.w);
export const rv = (v) => ({ x: v.x, y: v.y, z: v.z });
export const rq = (q) => ({ x: q.x, y: q.y, z: q.z, w: q.w });

// 결정적 난수 (텍스처/월드 생성용)
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const fmtKg = (kg) => (kg >= 1000 ? (kg / 1000).toFixed(2) + ' t' : kg >= 10 ? kg.toFixed(0) + ' kg' : kg.toFixed(1) + ' kg');
export const fmtN = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + ' kN' : n.toFixed(0) + ' N');
export const fmtMM = (m) => Math.round(m * 1000);

// 축 인덱스 → 단위벡터
export const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

// 가장 정렬된 로컬 축 찾기 (q: 월드회전, dir: 월드방향) → {axis, sign, dot}
export function bestAxis(q, dir) {
  const inv = q.clone().invert();
  const d = dir.clone().applyQuaternion(inv);
  const ax = [Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)];
  const axis = ax[0] > ax[1] ? (ax[0] > ax[2] ? 0 : 2) : ax[1] > ax[2] ? 1 : 2;
  return { axis, sign: Math.sign(d.getComponent(axis)) || 1, dot: ax[axis] };
}
