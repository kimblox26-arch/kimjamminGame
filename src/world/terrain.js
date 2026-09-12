// FREE FREELY - 지형 (하이트필드 + 카메라 추종 지오클립맵)
// CPU에서 하이트맵을 생성하므로 물리 충돌과 렌더 형상이 완전히 일치한다.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, fbm2, ridgeNoise2, gradNoise2 } from '../core/utils.js';

export const MAP_SPACING = 20;          // 하이트맵 격자 간격(m)
export const MAP_SIZE = 1024;           // 격자 수 (실제 배열은 +1)
export const MAP_EXTENT = MAP_SPACING * MAP_SIZE;    // 20480m
export const MAP_HALF = MAP_EXTENT / 2;

// 활주로 제원 (스폰 지점)
export const RUNWAY = {
  x0: -900, x1: 900, z0: -22, z1: 22, height: 24,
  blend: 260,
};

const LEVELS = 7;
const CELLS = 48;          // 레벨당 외곽 셀 수 (한 변)
const HOLE = 11;           // 내부 구멍 반경(셀)
const BASE_CELL = 10;      // L0 셀 크기(m)

function palette(r, g, b) {
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}

const COL = {
  deep: palette(28, 38, 46),
  shelf: palette(72, 92, 84),
  sand: palette(206, 186, 141),
  grass: palette(96, 122, 62),
  grassDark: palette(64, 88, 44),
  grassDry: palette(136, 138, 78),
  forest: palette(46, 72, 40),
  rock: palette(104, 98, 92),
  rockDark: palette(72, 68, 66),
  snow: palette(238, 242, 248),
};

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.heights = null;
    this.levels = [];
    this.ready = false;
    this._tmpColor = new THREE.Color();
  }

  /** 하이트맵 생성 — 프레임을 나눠 진행 (로딩 화면에서 await) */
  async generate(onProgress) {
    const N = MAP_SIZE + 1;
    const data = new Float32Array(N * N);
    const chunk = 32;
    for (let j0 = 0; j0 < N; j0 += chunk) {
      for (let j = j0; j < Math.min(N, j0 + chunk); j++) {
        const z = -MAP_HALF + j * MAP_SPACING;
        for (let i = 0; i < N; i++) {
          const x = -MAP_HALF + i * MAP_SPACING;
          data[j * N + i] = this._sampleHeightFunc(x, z);
        }
      }
      if (onProgress) onProgress(Math.min(1, (j0 + chunk) / N));
      await new Promise((r) => setTimeout(r, 0));
    }
    this.heights = data;
    this.N = N;
    this._buildMeshes();
    this.ready = true;
    return this;
  }

  /** 절차적 지형 고도 함수 — 대륙/산맥/해안/활주로 */
  _sampleHeightFunc(x, z) {
    const cx = x * 0.000052, cz = z * 0.000052;
    const continent = fbm2(cx, cz, 5, 2.1, 0.52);
    const land = smoothstep((continent + 0.06) / 0.42);

    // 산맥 — 능선 노이즈, 육지에서만 솟음
    const ridge = ridgeNoise2(x * 0.00031, z * 0.00031, 6);
    const ridge2 = ridgeNoise2(x * 0.00085 + 11.3, z * 0.00085 - 4.1, 4);
    const mountains = (Math.pow(ridge, 1.7) * 1750 + Math.pow(ridge2, 2.2) * 420) * Math.pow(land, 2.1);

    // 언덕 / 침식 디테일
    const hills = fbm2(x * 0.00105, z * 0.00105, 5) * 135 * land;
    const detail = fbm2(x * 0.0052, z * 0.0052, 4) * 13 * (0.25 + land);
    const micro = gradNoise2(x * 0.021, z * 0.021) * 1.6 * land;

    // 해저 지형
    const seabed = -190 + fbm2(x * 0.00022, z * 0.00022, 4) * 70 + ridge * 40;

    let h = lerp(seabed, 26, land) + mountains + hills + detail + micro;

    // 메인 섬 보장 (스폰 지역)
    const r = Math.hypot(x, z);
    h += 150 * Math.exp(-Math.pow(r / 4200, 2));
    h -= 40 * Math.exp(-Math.pow((r - 6400) / 2600, 2));    // 섬 주변 얕은 바다

    // 화산섬 (남동쪽)
    const vx = x - 6200, vz = z - 5400;
    const vr = Math.hypot(vx, vz);
    h += 1450 * Math.exp(-Math.pow(vr / 2100, 2)) - 420 * Math.exp(-Math.pow(vr / 420, 2));

    // 고원 (북서쪽 — 우주선 발사장)
    const px = x + 5200, pz = z + 6100;
    const pr = Math.hypot(px, pz);
    const plateau = smoothstep(1 - (pr - 900) / 900);
    h = lerp(h, Math.max(h, 640), plateau * 0.92);

    // 활주로 평탄화
    const dx = Math.max(RUNWAY.x0 - x, 0, x - RUNWAY.x1);
    const dz = Math.max(RUNWAY.z0 - z, 0, z - RUNWAY.z1);
    const d = Math.hypot(dx, dz);
    if (d < RUNWAY.blend) {
      const t = smoothstep(1 - d / RUNWAY.blend);
      h = lerp(h, RUNWAY.height, t);
    }
    // 지도 경계는 바다로 수렴
    const edge = Math.max(Math.abs(x), Math.abs(z)) / MAP_HALF;
    if (edge > 0.82) h = lerp(h, -240, smoothstep((edge - 0.82) / 0.18));
    return h;
  }

  /** 양선형 보간 고도 (물리/충돌용) */
  heightAt(x, z) {
    if (!this.heights) return 0;
    const fx = (x + MAP_HALF) / MAP_SPACING;
    const fz = (z + MAP_HALF) / MAP_SPACING;
    const N = this.N;
    if (fx < 0 || fz < 0 || fx >= N - 1 || fz >= N - 1) return -240;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const h = this.heights;
    const h00 = h[j * N + i], h10 = h[j * N + i + 1];
    const h01 = h[(j + 1) * N + i], h11 = h[(j + 1) * N + i + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = MAP_SPACING * 0.75;
    const hL = this.heightAt(x - e, z), hR = this.heightAt(x + e, z);
    const hD = this.heightAt(x, z - e), hU = this.heightAt(x, z + e);
    out.set(hL - hR, 2 * e, hD - hU).normalize();
    return out;
  }

  slopeAt(x, z) {
    const n = this.normalAt(x, z, new THREE.Vector3());
    return 1 - clamp(n.y, 0, 1);
  }

  isRunway(x, z) {
    return x > RUNWAY.x0 - 30 && x < RUNWAY.x1 + 30 && z > RUNWAY.z0 - 8 && z < RUNWAY.z1 + 8;
  }

  /** 표면 재질 판별 — 충돌 사운드/파티클 선택 */
  materialAt(x, z) {
    const h = this.heightAt(x, z);
    if (h < 0) return 'water';
    if (this.isRunway(x, z)) return 'asphalt';
    if (h < 6) return 'sand';
    const s = this.slopeAt(x, z);
    if (h > 1050 || (h > 800 && s < 0.35)) return 'snow';
    if (s > 0.55) return 'rock';
    return 'grass';
  }

  /* ---------------------------- 메시 구성 ---------------------------- */
  _buildMeshes() {
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.93,
      metalness: 0.0,
      envMapIntensity: 0.35,
      flatShading: false,
      side: THREE.FrontSide,
    });
    // 미세 요철용 디테일 노멀맵 (절차적 생성)
    this.material.normalMap = makeDetailNormal();
    this.material.normalScale = new THREE.Vector2(0.55, 0.55);
    this.material.normalMap.wrapS = this.material.normalMap.wrapT = THREE.RepeatWrapping;

    for (let l = 0; l < LEVELS; l++) {
      const cell = BASE_CELL * Math.pow(2, l);
      const geo = l === 0 ? makeGridGeometry(CELLS, 0) : makeGridGeometry(CELLS, HOLE);
      const mesh = new THREE.Mesh(geo, this.material.clone());
      mesh.material.polygonOffset = true;
      mesh.material.polygonOffsetFactor = 1 + l * 1.2;
      mesh.material.polygonOffsetUnits = 2 + l * 2;
      mesh.receiveShadow = l < 3;
      mesh.castShadow = false;
      mesh.frustumCulled = false;
      mesh.name = 'terrainLOD' + l;
      // 노멀맵 타일링을 레벨 크기에 맞춤
      mesh.material.normalMap = this.material.normalMap;
      this.group.add(mesh);
      this.levels.push({ mesh, cell, snapX: NaN, snapZ: NaN, geo });
    }
    this.update(new THREE.Vector3(0, 100, 0), true);
  }

  update(cameraPos, force = false) {
    if (!this.ready && !force) return;
    for (let l = 0; l < this.levels.length; l++) {
      const L = this.levels[l];
      const sx = Math.round(cameraPos.x / L.cell) * L.cell;
      const sz = Math.round(cameraPos.z / L.cell) * L.cell;
      if (!force && sx === L.snapX && sz === L.snapZ) continue;
      L.snapX = sx; L.snapZ = sz;
      this._fillLevel(L);
    }
  }

  _fillLevel(L) {
    const geo = L.geo;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const col = geo.attributes.color;
    const grid = geo.userData.grid;     // [{gx, gz, skirt}]
    const cell = L.cell;
    const n = new THREE.Vector3();
    const c = this._tmpColor;
    for (let i = 0; i < grid.length; i++) {
      const g = grid[i];
      const x = L.snapX + g.gx * cell;
      const z = L.snapZ + g.gz * cell;
      let h = this.heightAt(x, z);
      this.normalAt(x, z, n);
      this.colorAt(x, z, h, n, c);
      if (g.skirt) h -= cell * 2.5;
      pos.setXYZ(i, x, h, z);
      nor.setXYZ(i, n.x, n.y, n.z);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    col.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  colorAt(x, z, h, n, out) {
    const slope = 1 - clamp(n.y, 0, 1);
    const v1 = fbm2(x * 0.0009, z * 0.0009, 3);       // 매크로 변화
    const v2 = gradNoise2(x * 0.012, z * 0.012) * 0.5;
    if (h < -4) {
      out.copy(COL.deep).lerp(COL.shelf, smoothstep(1 + h / 120));
      return out;
    }
    if (h < 4.5) {
      out.copy(COL.shelf).lerp(COL.sand, smoothstep((h + 4) / 8.5));
      return out;
    }
    // 초지 / 삼림 / 건조지
    const wet = smoothstep(0.5 + v1 * 0.9);
    out.copy(COL.grass).lerp(COL.forest, wet * 0.75);
    out.lerp(COL.grassDry, smoothstep((v1 - 0.15) * 1.6) * 0.5);
    out.lerp(COL.grassDark, clamp(v2 + 0.35, 0, 1) * 0.3);
    // 해변 전이
    if (h < 14) out.lerp(COL.sand, smoothstep(1 - (h - 4.5) / 9.5) * 0.85);
    // 암반 (경사)
    const rockAmt = smoothstep((slope - 0.34) / 0.3);
    const rockCol = this._rock || (this._rock = new THREE.Color());
    rockCol.copy(COL.rock).lerp(COL.rockDark, clamp(v2 + 0.5, 0, 1));
    out.lerp(rockCol, rockAmt);
    // 고산 툰드라 → 설선
    if (h > 620) {
      const dry = smoothstep((h - 620) / 420);
      out.lerp(COL.rock, dry * 0.7);
      const snowLine = 1010 + v1 * 260;
      const snowAmt = smoothstep((h - snowLine) / 150) * (1 - rockAmt * 0.55);
      out.lerp(COL.snow, clamp(snowAmt, 0, 1));
    }
    return out;
  }

  /** 광선-지형 교차 (레이마칭) — 카메라 충돌, 폭탄 착점 등 */
  raycast(origin, dir, maxDist = 6000, step = 6) {
    const p = origin.clone();
    const d = dir.clone().normalize();
    let t = 0;
    let prevAbove = p.y - this.heightAt(p.x, p.z);
    while (t < maxDist) {
      const adaptive = Math.max(step, Math.abs(prevAbove) * 0.5);
      t += adaptive;
      p.copy(origin).addScaledVector(d, t);
      const above = p.y - this.heightAt(p.x, p.z);
      if (above <= 0) {
        // 이분 정밀화
        let lo = t - adaptive, hi = t;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          p.copy(origin).addScaledVector(d, mid);
          if (p.y - this.heightAt(p.x, p.z) > 0) lo = mid; else hi = mid;
        }
        p.copy(origin).addScaledVector(d, hi);
        return { hit: true, point: p, distance: hi };
      }
      prevAbove = above;
    }
    return { hit: false };
  }
}

/* ------------------------------------------------------------------ */
/* 격자/링 지오메트리 생성 (구멍 있는 사각 링 + 내부 스커트)              */
/* ------------------------------------------------------------------ */
function makeGridGeometry(cells, hole) {
  const half = cells / 2;
  const index = [];
  const grid = [];
  const key = new Map();
  const vid = (gx, gz, skirt = false) => {
    const k = gx + ',' + gz + (skirt ? 's' : '');
    let id = key.get(k);
    if (id === undefined) {
      id = grid.length;
      grid.push({ gx, gz, skirt });
      key.set(k, id);
    }
    return id;
  };
  for (let j = -half; j < half; j++) {
    for (let i = -half; i < half; i++) {
      // 구멍 영역은 비움
      if (hole > 0 && i >= -hole && i < hole && j >= -hole && j < hole) continue;
      const a = vid(i, j), b = vid(i + 1, j), c = vid(i + 1, j + 1), d = vid(i, j + 1);
      index.push(a, d, b, b, d, c);
    }
  }
  // 내부 구멍 경계에 아래로 늘어지는 스커트 (레벨 간 균열 은폐)
  if (hole > 0) {
    for (let i = -hole; i < hole; i++) {
      // 위/아래 변
      let a = vid(i, -hole), b = vid(i + 1, -hole);
      let as = vid(i, -hole, true), bs = vid(i + 1, -hole, true);
      index.push(a, b, as, b, bs, as);
      a = vid(i, hole); b = vid(i + 1, hole);
      as = vid(i, hole, true); bs = vid(i + 1, hole, true);
      index.push(a, as, b, b, as, bs);
    }
    for (let j = -hole; j < hole; j++) {
      let a = vid(-hole, j), b = vid(-hole, j + 1);
      let as = vid(-hole, j, true), bs = vid(-hole, j + 1, true);
      index.push(a, as, b, b, as, bs);
      a = vid(hole, j); b = vid(hole, j + 1);
      as = vid(hole, j, true); bs = vid(hole, j + 1, true);
      index.push(a, b, as, b, bs, as);
    }
  }
  const geo = new THREE.BufferGeometry();
  const count = grid.length;
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const uv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    uv[i * 2] = grid[i].gx * 0.5;
    uv[i * 2 + 1] = grid[i].gz * 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.userData.grid = grid;
  return geo;
}

/* 절차적 디테일 노멀맵 (자잘한 요철) */
export function makeDetailNormal(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const hf = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      hf[y * size + x] =
        gradNoise2(x * 0.09, y * 0.09) * 0.6 +
        gradNoise2(x * 0.31, y * 0.31) * 0.3 +
        gradNoise2(x * 0.83, y * 0.83) * 0.14;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const xl = hf[y * size + ((x - 1 + size) % size)];
      const xr = hf[y * size + ((x + 1) % size)];
      const yu = hf[((y - 1 + size) % size) * size + x];
      const yd = hf[((y + 1) % size) * size + x];
      const nx = (xl - xr) * 1.6, ny = (yu - yd) * 1.6, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
