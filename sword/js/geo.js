// SKY BLADE — 실제 지구 (NASA 블루마블 색, 고도, 바다 마스크)
//  - 평면(abs) 좌표 ↔ 실제 위도·경도: 서울(37.5665°N, 126.978°E)을 원점으로, +X 동쪽, +Z 남쪽, 행성 좌표 = frame.js 의 flatToPlanet
//  - loadGeo(): 이미지들을 내려받아 지형 생성(메인/워커)에 쓸 작은 배열로 만듦
//      topo  : 2048×1024 고도 (0..255 → 0..6.4 km)
//      water : 4096×2048 바다/호수 마스크 (1비트로 압축)
//      green / arid : 1024×512 식생·건조 정도 (블루마블 색에서 계산)
import * as THREE from 'three';

export const LAT0 = 37.5665 * Math.PI / 180, LON0 = 126.978 * Math.PI / 180;
// 서울의 지구 고정 좌표(ECEF) 기저: 동 E, 위 U, 북 N
export const GE = new THREE.Vector3(-Math.sin(LON0), Math.cos(LON0), 0);
export const GU = new THREE.Vector3(Math.cos(LAT0) * Math.cos(LON0), Math.cos(LAT0) * Math.sin(LON0), Math.sin(LAT0));
export const GN = new THREE.Vector3(-Math.sin(LAT0) * Math.cos(LON0), -Math.sin(LAT0) * Math.sin(LON0), Math.cos(LAT0));

/** 행성 좌표 단위 벡터 (서울 기준: X 동, Y 위, Z 남) → [위도, 경도] (rad) */
export function localToLatLon(nx, ny, nz, out = [0, 0]) {
  const ex = nx * GE.x + ny * GU.x - nz * GN.x;
  const ey = nx * GE.y + ny * GU.y - nz * GN.y;
  const ez = nx * GE.z + ny * GU.z - nz * GN.z;
  const r = Math.hypot(ex, ey, ez) || 1;
  out[0] = Math.asin(Math.max(-1, Math.min(1, ez / r)));
  out[1] = Math.atan2(ey, ex);
  return out;
}

/** 위도·경도 → 행성 좌표 단위 벡터 (서울 기준) */
export function latLonToLocal(lat, lon, out = new THREE.Vector3()) {
  const cl = Math.cos(lat);
  const ex = cl * Math.cos(lon), ey = cl * Math.sin(lon), ez = Math.sin(lat);
  return out.set(ex * GE.x + ey * GE.y + ez * GE.z, ex * GU.x + ey * GU.y + ez * GU.z, -(ex * GN.x + ey * GN.y + ez * GN.z));
}

async function loadImageData(url, w, h) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ' ' + res.status);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const W = w || bmp.width, H = h || bmp.height;
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, W, H);
  if (bmp.close) bmp.close();
  return { data: g.getImageData(0, 0, W, H).data, w: W, h: H };
}

/** 지형 생성용 지구 데이터. 실패하면 null (지형은 절차적으로만 생성) */
export async function loadGeo(base = './assets/') {
  try {
    const [topo, water, day] = await Promise.all([
      loadImageData(base + 'earth_topo.png'),
      loadImageData(base + 'earth_water.png'),
      loadImageData(base + 'earth_day.jpg', 1024, 512),
    ]);
    const T = new Uint8Array(topo.w * topo.h);
    for (let i = 0; i < T.length; i++) T[i] = topo.data[i * 4];
    const WN = water.w * water.h, Wb = new Uint8Array(Math.ceil(WN / 8));
    for (let i = 0; i < WN; i++) if (water.data[i * 4] > 127) Wb[i >> 3] |= 1 << (i & 7);
    const CN = day.w * day.h, green = new Uint8Array(CN), arid = new Uint8Array(CN);
    for (let i = 0; i < CN; i++) {
      const r = day.data[i * 4], g = day.data[i * 4 + 1], b = day.data[i * 4 + 2];
      const s = r + g + b + 1;
      green[i] = Math.max(0, Math.min(255, ((g - r) * 3 + (g - b) * 1.5) * 255 / s * 2.2));
      arid[i] = Math.max(0, Math.min(255, (r - b) * 255 / s * 2.6 * Math.min(1, s / 260)));
    }
    return { topo: T, tw: topo.w, th: topo.h, water: Wb, ww: water.w, wh: water.h, green, arid, cw: day.w, ch: day.h };
  } catch (e) {
    console.warn('[geo] 실제 지구 데이터를 불러오지 못함 — 절차적 지형만 사용', e);
    return null;
  }
}

/** 지구/행성 텍스처 (색공간 지정, 반복) */
const _loader = new THREE.TextureLoader();
export function loadTex(url, srgb = true, onLoad) {
  const t = _loader.load(url, onLoad, undefined, () => console.warn('[geo] 텍스처 없음', url));
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
