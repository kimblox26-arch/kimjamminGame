// 고요(GOYO) — 지형
// 해석적 하이트필드 하나로 렌더 메시 / 충돌 / 초목 배치를 모두 만든다.
// (렌더와 물리가 같은 함수를 쓰므로 발이 뜨거나 잠기지 않는다)
import * as THREE from 'three';
import { clamp01, lerp, smoothstep, makeRng, TAU } from '../core/utils.js';

/* ------------------------------------------------------------------ */
/* 빠른 결정론적 노이즈                                                 */
/* 지형/배치에서 수십만 번 호출되므로 삼각함수 없이 기울기 표를 쓴다.      */
/* ------------------------------------------------------------------ */
const GRAD = new Float32Array(512);
for (let i = 0; i < 256; i++) {
  const a = (i / 256) * TAU;
  GRAD[i * 2] = Math.cos(a);
  GRAD[i * 2 + 1] = Math.sin(a);
}

function hashi(x, y) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 그라디언트(펄린 유사) 노이즈 — 대략 ±0.7 */
export function gradNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const g = (ix, iy, dx, dy) => {
    const i = (hashi(ix, iy) & 255) * 2;
    return GRAD[i] * dx + GRAD[i + 1] * dy;
  };
  const a = g(xi, yi, xf, yf);
  const b = g(xi + 1, yi, xf - 1, yf);
  const c = g(xi, yi + 1, xf, yf - 1);
  const d = g(xi + 1, yi + 1, xf - 1, yf - 1);
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}

/** 다중 옥타브 — 대체로 ±0.35 */
export function fbm2(x, y, octaves = 5, lacunarity = 2.03, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, fx = x, fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += gradNoise(fx, fy) * amp;
    norm += amp;
    amp *= gain;
    fx *= lacunarity; fy *= lacunarity;
  }
  return sum / norm;
}

/** 능선형 — 0~1 */
export function ridgeNoise2(x, y, octaves = 5) {
  let sum = 0, amp = 0.5, norm = 0, fx = x, fy = y, prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(gradNoise(fx, fy));
    n *= n;
    sum += n * amp * prev;
    prev = n;
    norm += amp;
    amp *= 0.5;
    fx *= 2.07; fy *= 2.07;
  }
  return sum / norm;
}

export const WATER_LEVEL = 0;
export const LAKE = { x: 78, z: -104, r: 46 };
export const INNER_HALF = 340;      // 정밀 지형 반변(m)
export const WORLD_LIMIT = 300;     // 플레이어가 다닐 수 있는 반경(부드럽게 막음)

/* ------------------------------------------------------------------ */
/* 높이장                                                              */
/* ------------------------------------------------------------------ */
export function heightAt(x, z) {
  const dc = Math.hypot(x, z);

  // 완만한 구릉 (fbm2 는 대체로 ±0.3 범위라 크게 곱해 쓴다)
  let h = fbm2(x * 0.0017 + 31.7, z * 0.0017 - 12.4, 5) * 95;
  h += fbm2(x * 0.0061 - 5.1, z * 0.0061 + 8.8, 4) * 26;
  h += fbm2(x * 0.019, z * 0.019, 3) * 5.5;

  // 중앙 초원 — 산책하기 좋은 평탄지
  const meadow = 1 - smoothstep(clamp01((dc - 85) / 215));
  h = lerp(h, 3.6 + h * 0.22, meadow * 0.86);

  // 호수 분지 (호안선을 노이즈로 일그러뜨려 자연스럽게)
  const ld = Math.hypot(x - LAKE.x, z - LAKE.z) + fbm2(x * 0.013, z * 0.013, 3) * 42;
  const basin = 1 - smoothstep(clamp01((ld - LAKE.r * 0.42) / (LAKE.r * 0.95)));
  h -= basin * 10.5;

  // 바위 노두 — 높은 곳일수록 드러난다
  h += (ridgeNoise2(x * 0.021 + 4.4, z * 0.021 - 7.7, 3) - 0.2) * 3.4
     * smoothstep(clamp01((h - 9) / 18));

  // 계곡을 둘러싼 원경 산맥
  const mt = smoothstep(clamp01((dc - 400) / 760));
  h += (ridgeNoise2(x * 0.00085 + 2.3, z * 0.00085 - 1.1, 5) - 0.25) * 640 * mt;
  h += mt * 40;

  return h;
}

const _n = new THREE.Vector3();
export function normalAt(x, z, eps = 0.7) {
  const hL = heightAt(x - eps, z), hR = heightAt(x + eps, z);
  const hD = heightAt(x, z - eps), hU = heightAt(x, z + eps);
  return _n.set(hL - hR, 2 * eps, hD - hU).normalize();
}

/** 경사도 0(평지)~1(수직) */
export function slopeAt(x, z) {
  return 1 - normalAt(x, z).y;
}

/** 높이와 경사를 한 번에 (샘플 3회) — 초목 배치용 */
export function sampleGround(x, z, eps = 0.9) {
  const h = heightAt(x, z);
  const dx = heightAt(x + eps, z) - h;
  const dz = heightAt(x, z + eps) - h;
  const slope = 1 - eps / Math.sqrt(dx * dx + dz * dz + eps * eps);
  return { h, slope };
}

export const SURFACE = { GRASS: 'grass', DIRT: 'dirt', ROCK: 'rock', SAND: 'sand', WATER: 'water' };

/** 발밑 재질 — 발소리와 초목 밀도에 함께 쓰인다 */
export function surfaceAt(x, z, h = heightAt(x, z), slope = slopeAt(x, z)) {
  if (h < WATER_LEVEL + 0.06) return SURFACE.WATER;
  const shore = Math.hypot(x - LAKE.x, z - LAKE.z) - LAKE.r;
  if (h < WATER_LEVEL + 1.15 && shore < 26) return SURFACE.SAND;
  if (slope > 0.42 || h > 58) return SURFACE.ROCK;
  const dry = fbm2(x * 0.028 + 71.2, z * 0.028 - 3.3, 3);
  if (dry > 0.42 || slope > 0.3) return SURFACE.DIRT;
  return SURFACE.GRASS;
}

/** 초목이 자랄 수 있는 정도(0~1) */
export function fertilityAt(x, z, h = heightAt(x, z), slope = slopeAt(x, z)) {
  if (h < WATER_LEVEL + 0.25 || h > 62) return 0;
  let f = 1 - smoothstep(clamp01((slope - 0.24) / 0.3));
  f *= smoothstep(clamp01((h - WATER_LEVEL - 0.15) / 1.6));
  f *= 0.55 + 0.45 * (fbm2(x * 0.0075 + 9.1, z * 0.0075 + 2.6, 3) * 0.5 + 0.5);
  return clamp01(f);
}

/* ------------------------------------------------------------------ */
/* 절차적 디테일 텍스처                                                 */
/* ------------------------------------------------------------------ */
export function noiseCanvas(size, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  fn(img.data, size);
  ctx.putImageData(img, 0, 0);
  return c;
}

/** 높이 배열(0~1)에서 탄젠트 공간 노멀맵 텍스처를 만든다 */
export function normalMapFromHeights(size, heights, strength = 2.4, repeat = 1) {
  const canvas = noiseCanvas(size, (d, s) => {
    const at = (x, y) => heights[((y + s) % s) * s + ((x + s) % s)];
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
        const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
        const len = Math.hypot(-dx, -dy, 1);
        const i = (y * s + x) * 4;
        d[i] = (-dx / len * 0.5 + 0.5) * 255;
        d[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
        d[i + 2] = (1 / len * 0.5 + 0.5) * 255;
        d[i + 3] = 255;
      }
    }
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  return tex;
}

/**
 * 지면 디테일 — 흙알갱이 위에 짧은 잔풀결을 얹는다.
 * 정점 색(풀빛/흙빛)에 곱해지므로, 풀밭에서는 잔디결로, 맨땅에서는
 * 흙알갱이로 읽힌다. 포기 사이가 비어도 바닥이 잔디처럼 보인다.
 */
function groundHeights(size) {
  const h = new Float32Array(size * size);
  // 잔알갱이
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size * 8, v = y / size * 8;
      h[y * size + x] = (fbm2(u, v, 4) * 0.5 + 0.5) * 0.55 + Math.random() * 0.2;
    }
  }
  // 짧은 풀결 — 무작위 방향의 가는 획을 긋는다
  const rng = makeRng(3131);
  const strokes = Math.round(size * size / 26);
  for (let i = 0; i < strokes; i++) {
    const x0 = rng() * size, y0 = rng() * size;
    const a = rng() * Math.PI * 2;
    const len = size * (0.012 + rng() * 0.03);
    const bright = 0.25 + rng() * 0.45;
    const steps = Math.ceil(len);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const x = Math.round(x0 + Math.cos(a) * len * t) & (size - 1);
      const y = Math.round(y0 + Math.sin(a) * len * t) & (size - 1);
      const k = y * size + x;
      h[k] = Math.min(1, h[k] + bright * (1 - t * 0.7));
    }
  }
  return h;
}

let _groundH = null;
function makeGroundMap(size = 512) {
  if (!_groundH) _groundH = groundHeights(size);
  const h = _groundH;
  const canvas = noiseCanvas(size, (d, s) => {
    for (let i = 0; i < s * s; i++) {
      const n = h[i];
      const b = 150 + n * 110;
      d[i * 4] = b * 1.02; d[i * 4 + 1] = b * 1.03; d[i * 4 + 2] = b * 0.9; d[i * 4 + 3] = 255;
    }
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makeGroundNormal(size = 512) {
  if (!_groundH) _groundH = groundHeights(size);
  return normalMapFromHeights(size, _groundH, 2.2, 1);
}

/* ------------------------------------------------------------------ */
/* 앰비언트 오클루전 (수평선 기반)                                       */
/* 골짜기·바위 밑동이 어두워져 지형에 깊이가 생긴다.                      */
/* ------------------------------------------------------------------ */
const AO_DIRS = 8;
const AO_STEPS = [2.5, 6, 13, 26, 48];

export class AOMap {
  constructor(half, res) {
    this.half = half;
    this.res = res;
    this.step = (half * 2) / (res - 1);
    this.data = new Float32Array(res * res).fill(1);
  }

  /** j 번째 행을 계산한다 (로딩 중 나눠 돌리기 좋게) */
  bakeRow(j) {
    const { res, half, step } = this;
    const z = -half + j * step;
    for (let i = 0; i < res; i++) {
      const x = -half + i * step;
      const h0 = heightAt(x, z);
      let occ = 0;
      for (let d = 0; d < AO_DIRS; d++) {
        const a = (d / AO_DIRS) * TAU;
        const dx = Math.cos(a), dz = Math.sin(a);
        let maxTan = 0;
        for (const r of AO_STEPS) {
          const dh = heightAt(x + dx * r, z + dz * r) - h0;
          if (dh > 0) maxTan = Math.max(maxTan, dh / r);
        }
        occ += maxTan / Math.sqrt(1 + maxTan * maxTan);   // sin(수평선 각)
      }
      this.data[j * res + i] = clamp01(1 - (occ / AO_DIRS) * 1.35);
    }
  }

  /** 쌍선형 보간 */
  at(x, z) {
    const { res, half, step, data } = this;
    const fx = clamp01((x + half) / (half * 2)) * (res - 1);
    const fz = clamp01((z + half) / (half * 2)) * (res - 1);
    const i = Math.min(res - 2, Math.floor(fx)), j = Math.min(res - 2, Math.floor(fz));
    const tx = fx - i, tz = fz - j;
    const a = data[j * res + i], b = data[j * res + i + 1];
    const c = data[(j + 1) * res + i], d = data[(j + 1) * res + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }
}

/* ------------------------------------------------------------------ */
/* 색 팔레트                                                           */
/* ------------------------------------------------------------------ */
const C = {
  grass: new THREE.Color(0x56613c),
  grassLush: new THREE.Color(0x606f3f),
  grassDry: new THREE.Color(0x8d8657),
  moss: new THREE.Color(0x44513a),
  dirt: new THREE.Color(0x6b5438),
  dirtDark: new THREE.Color(0x4a3a28),
  rock: new THREE.Color(0x7a7570),
  rockDark: new THREE.Color(0x55524f),
  sand: new THREE.Color(0xbfae86),
  silt: new THREE.Color(0x5a5642),
  duff: new THREE.Color(0x4e4530),          // 숲 바닥 — 낙엽이 삭은 빛깔
  forest: new THREE.Color(0x36482c),
  haze: new THREE.Color(0x7e93ab),
  snow: new THREE.Color(0xe8edf2),
};

const _c = new THREE.Color();
const _c2 = new THREE.Color();

/** 정점 색 — 높이/경사/노이즈로 지면을 칠한다 */
function colorAt(x, z, h, slope, out) {
  const varA = fbm2(x * 0.035 + 17.3, z * 0.035 - 9.2, 3);        // 잔무늬
  const varB = fbm2(x * 0.0067 - 4.8, z * 0.0067 + 21.5, 3);      // 큰 얼룩
  const dry = clamp01(varB * 0.9 + 0.35 + varA * 0.2);

  out.copy(C.grass).lerp(C.grassLush, clamp01(0.5 - varB * 0.8));
  out.lerp(C.grassDry, clamp01((dry - 0.55) * 1.9));
  out.lerp(C.moss, clamp01(0.35 - h * 0.03));

  // 숲이 빽빽한 자리의 땅은 낙엽과 그늘로 짙고 누렇다 — 흙·풀·낙엽이 이어진다
  const forestN = clamp01((fbm2(x * 0.0045 + 5.5, z * 0.0045 - 2.2, 3) * 0.5 + 0.5 - 0.34) * 2.2);
  out.lerp(_c2.copy(C.duff).lerp(C.moss, clamp01(varA * 0.8 + 0.4)), forestN * (0.24 + varA * 0.16));

  // 경사면은 흙 → 바위
  out.lerp(_c2.copy(C.dirt).lerp(C.dirtDark, clamp01(varA * 0.6 + 0.4)),
    smoothstep(clamp01((slope - 0.17) / 0.16)));
  out.lerp(_c2.copy(C.rock).lerp(C.rockDark, clamp01(varA * 0.7 + 0.35)),
    smoothstep(clamp01((slope - 0.34) / 0.2)));

  // 물가 모래·진흙
  const shore = Math.hypot(x - LAKE.x, z - LAKE.z) - LAKE.r;
  if (shore < 34) {
    const beach = smoothstep(clamp01((2.1 - (h - WATER_LEVEL)) / 2.0)) * smoothstep(clamp01((34 - shore) / 16));
    out.lerp(C.sand, beach * 0.85);
  }
  if (h < WATER_LEVEL + 0.4) out.lerp(C.silt, smoothstep(clamp01((WATER_LEVEL + 0.4 - h) / 1.4)) * 0.8);
  // 물이 닿았다 빠진 자리는 젖어서 짙다
  const wet = smoothstep(clamp01((0.55 - (h - WATER_LEVEL)) / 0.9)) * smoothstep(clamp01((h - WATER_LEVEL + 1.2) / 0.6));
  out.multiplyScalar(1 - wet * 0.32);

  // 고지대 — 침엽수 띠 → 바위 → 설선 (원경은 공기원근으로 푸르게)
  out.lerp(C.forest, smoothstep(clamp01((h - 30) / 40)) * 0.55);
  out.lerp(C.rockDark, smoothstep(clamp01((h - 90) / 70)) * 0.8);
  out.lerp(C.snow, smoothstep(clamp01((h - 250) / 120)) * 0.9);
  out.lerp(C.haze, smoothstep(clamp01((h - 60) / 260)) * 0.35);
  return out;
}

/* ------------------------------------------------------------------ */
/* 지형 메시                                                           */
/* ------------------------------------------------------------------ */
export class Terrain {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.segs = quality === 'low' ? 256 : quality === 'medium' ? 384 : 480;
    this.chunks = 8;
  }

  async build(onProgress = () => {}, frame = () => Promise.resolve()) {
    await this._bakeAO(onProgress, frame);
    await this._buildInner(onProgress, frame);
    await frame();
    this._buildFar();
    onProgress(1);
  }

  /** 지형 AO 를 미리 구워 둔다 (정점 색에 곱한다) */
  async _bakeAO(onProgress, frame) {
    const res = this.quality === 'low' ? 128 : this.quality === 'medium' ? 176 : 224;
    this.ao = new AOMap(INNER_HALF + 20, res);
    for (let j = 0; j < res; j++) {
      this.ao.bakeRow(j);
      if ((j & 15) === 0) { onProgress(j / res * 0.22); await frame(); }
    }
    onProgress(0.22);
  }

  /** 플레이어가 걷는 정밀 지형 — 청크로 나눠 시야 밖은 그리지 않는다 */
  async _buildInner(onProgress, frame) {
    const CH = this.chunks;                    // 한 변당 청크 수
    const SEG = Math.round(this.segs / CH);    // 청크당 분할 수
    const size = INNER_HALF * 2;
    const chunkSize = size / CH;
    const step = chunkSize / SEG;

    const map = makeGroundMap();
    const nrm = makeGroundNormal();
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map,
      normalMap: nrm,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughness: 0.97,
      metalness: 0,
      dithering: true,
    });
    // 같은 텍스처를 두 배율로 섞어 반복 무늬가 보이지 않게 한다
    this.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 tNear = texture2D(map, vMapUv);
          vec4 tFar = texture2D(map, vMapUv * 0.143);
          vec4 sampledDiffuseColor = mix(tNear, tFar, 0.45);
          diffuseColor *= sampledDiffuseColor;
        #endif`);
    };
    this.material.customProgramCacheKey = () => 'terrain-detail';

    // 청크 경계에서 법선이 끊기지 않도록 한 칸씩 넓게 샘플링한다
    const G = SEG + 3;
    const hs = new Float32Array(G * G);
    const edge = [];                            // 치마용 바깥 테두리
    this.meshes = [];

    for (let cz = 0; cz < CH; cz++) {
      for (let cx = 0; cx < CH; cx++) {
        const ox = -INNER_HALF + cx * chunkSize;
        const oz = -INNER_HALF + cz * chunkSize;
        for (let j = 0; j < G; j++) {
          const z = oz + (j - 1) * step;
          for (let i = 0; i < G; i++) {
            hs[j * G + i] = heightAt(ox + (i - 1) * step, z);
          }
        }

        const vc = (SEG + 1) * (SEG + 1);
        const pos = new Float32Array(vc * 3);
        const nor = new Float32Array(vc * 3);
        const col = new Float32Array(vc * 3);
        const uv = new Float32Array(vc * 2);
        for (let j = 0; j <= SEG; j++) {
          const z = oz + j * step;
          for (let i = 0; i <= SEG; i++) {
            const x = ox + i * step;
            const k = j * (SEG + 1) + i;
            const gi = (j + 1) * G + (i + 1);
            const h = hs[gi];
            // 격자에서 바로 법선을 구한다 (heightAt 재호출 없음)
            const dx = hs[gi - 1] - hs[gi + 1];
            const dz = hs[gi - G] - hs[gi + G];
            const len = Math.hypot(dx, 2 * step, dz);
            const ny = 2 * step / len;
            pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
            nor[k * 3] = dx / len; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = dz / len;
            uv[k * 2] = x / 6; uv[k * 2 + 1] = z / 6;
            colorAt(x, z, h, 1 - ny, _c);
            // 구워 둔 AO — 그늘진 골과 바위 밑이 짙어진다
            const ao = lerp(0.55, 1, this.ao.at(x, z));
            col[k * 3] = _c.r * ao; col[k * 3 + 1] = _c.g * ao; col[k * 3 + 2] = _c.b * ao;
            if (cx === 0 && i === 0) edge.push([3, z, x, h]);
            if (cx === CH - 1 && i === SEG) edge.push([1, z, x, h]);
            if (cz === 0 && j === 0) edge.push([0, x, z, h]);
            if (cz === CH - 1 && j === SEG) edge.push([2, x, z, h]);
          }
        }

        const idx = new Uint16Array(SEG * SEG * 6);
        let p = 0;
        for (let j = 0; j < SEG; j++) {
          for (let i = 0; i < SEG; i++) {
            const a = j * (SEG + 1) + i, b = a + 1, c = a + SEG + 1, d = c + 1;
            // 대각선을 번갈아 두어 격자무늬가 눈에 띄지 않게
            if (((i + j) & 1) === 0) { idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d; }
            else { idx[p++] = a; idx[p++] = c; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = b; }
          }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.receiveShadow = true;
        mesh.name = `terrain-${cx}-${cz}`;
        this.group.add(mesh);
        this.meshes.push(mesh);
      }
      onProgress(0.22 + (cz + 1) / CH * 0.7);
      await frame();
    }

    this.group.add(this._buildSkirt(edge));
  }

  /** 정밀 지형 가장자리 치마 — 원경 메시와의 이음매를 가린다 */
  _buildSkirt(edge) {
    // 변별로 모아 정렬한 뒤 아래로 늘어뜨린다
    const sides = [[], [], [], []];
    for (const e of edge) sides[e[0]].push(e);
    const verts = [], idx = [];
    for (const side of sides) {
      side.sort((a, b) => a[1] - b[1]);
      const base = verts.length / 3;
      for (let i = 0; i < side.length; i++) {
        const [dir, , , h] = side[i];
        const a = side[i][1], b = side[i][2];
        const x = (dir === 0 || dir === 2) ? a : b;
        const z = (dir === 0 || dir === 2) ? b : a;
        verts.push(x, h + 0.15, z, x, h - 28, z);
      }
      for (let i = 0; i < side.length - 1; i++) {
        const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0x4c4838, roughness: 1, side: THREE.DoubleSide,
    }));
    mesh.name = 'terrain-skirt';
    return mesh;
  }

  /** 안개 너머의 원경 — 실루엣만 담당 */
  _buildFar() {
    const N = 150, size = 3400, step = size / N, hole = INNER_HALF - step;
    const verts = [], cols = [], idx = [];
    const gridIndex = new Int32Array((N + 1) * (N + 1)).fill(-1);

    for (let j = 0; j <= N; j++) {
      const z = -size / 2 + j * step;
      for (let i = 0; i <= N; i++) {
        const x = -size / 2 + i * step;
        if (Math.abs(x) < hole && Math.abs(z) < hole) continue;
        const h = heightAt(x, z);
        gridIndex[j * (N + 1) + i] = verts.length / 3;
        verts.push(x, h, z);
        colorAt(x, z, h, 1 - normalAt(x, z, step * 0.5).y, _c);
        cols.push(_c.r, _c.g, _c.b);
      }
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = gridIndex[j * (N + 1) + i], b = gridIndex[j * (N + 1) + i + 1];
        const c = gridIndex[(j + 1) * (N + 1) + i], d = gridIndex[(j + 1) * (N + 1) + i + 1];
        if (a < 0 || b < 0 || c < 0 || d < 0) continue;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, metalness: 0,
    }));
    mesh.name = 'terrain-far';
    this.farMesh = mesh;
    this.group.add(mesh);
  }

  /** 호수 바닥 깊이 맵 — 물가 투명도/포말에 사용 */
  bakeLakeDepth(res = 192) {
    const half = LAKE.r + 46;
    const data = new Uint8Array(res * res);
    for (let j = 0; j < res; j++) {
      const z = LAKE.z - half + (j / (res - 1)) * half * 2;
      for (let i = 0; i < res; i++) {
        const x = LAKE.x - half + (i / (res - 1)) * half * 2;
        const d = clamp01((WATER_LEVEL - heightAt(x, z)) / 7);
        data[j * res + i] = Math.round(d * 255);
      }
    }
    const tex = new THREE.DataTexture(data, res, res, THREE.RedFormat);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return { tex, half };
  }
}

/** 결정론적 산포 — 같은 좌표는 항상 같은 결과 */
export function scatterCell(cx, cz, seed, count, cell, fn) {
  const rng = makeRng((cx * 73856093) ^ (cz * 19349663) ^ seed);
  for (let i = 0; i < count; i++) {
    const x = cx * cell + rng() * cell;
    const z = cz * cell + rng() * cell;
    fn(x, z, rng);
  }
}
