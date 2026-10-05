// SpaceSim — 실제 천체 표면 텍스처 로더
// 행성/태양/고리/은하수: Solar System Scope (CC BY 4.0, NASA 자료 기반) · 지구 세트: three.js 예제(NASA Blue Marble 기반)
import * as THREE from 'three';

const BASE = new URL('../textures/', import.meta.url).href;
const FILES = {
  sun: 'sun.jpg', mercury: 'mercury.jpg', venus: 'venus.jpg', moon: 'moon.jpg', mars: 'mars.jpg',
  jupiter: 'jupiter.jpg', saturn: 'saturn.jpg', saturn_ring: 'saturn_ring.png', uranus: 'uranus.jpg', neptune: 'neptune.jpg', pluto: 'pluto.jpg',
  earth_day: 'earth_day.jpg', earth_night: 'earth_night.jpg', earth_spec: 'earth_spec.jpg', earth_normal: 'earth_normal.jpg', earth_clouds: 'earth_clouds.jpg',
  milkyway_4k: 'milkyway_4k.jpg', milkyway_8k: 'milkyway_8k.jpg',
};
const LINEAR = new Set(['earth_spec', 'earth_normal', 'earth_clouds', 'saturn_ring']);
const cache = new Map();
const loader = new THREE.TextureLoader();
let aniso = 4;

export function setAnisotropy(n) { aniso = n; }

export function getTex(key) {
  if (!key || !FILES[key]) return null;
  if (cache.has(key)) return cache.get(key).tex;
  const entry = {};
  entry.promise = new Promise((resolve) => {
    entry.tex = loader.load(BASE + FILES[key], () => { entry.ok = true; resolve(true); }, undefined, () => { entry.ok = false; resolve(false); });
  });
  const t = entry.tex;
  t.colorSpace = LINEAR.has(key) ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (key.startsWith('milkyway')) { t.wrapS = THREE.RepeatWrapping; t.anisotropy = Math.min(aniso, 4); }
  if (key === 'saturn_ring') t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, entry);
  return t;
}

export const texReady = (key) => cache.get(key)?.ok === true;
export const texPromise = (key) => (getTex(key), cache.get(key).promise);

export async function preloadTextures(keys, onProgress) {
  let done = 0;
  await Promise.all(keys.map((k) => texPromise(k).then((ok) => { done++; onProgress?.(done / keys.length, k, ok); return ok; })));
}

export const PLANET_KEYS = Object.keys(FILES).filter((k) => !k.startsWith('milkyway'));
