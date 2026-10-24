// SKY BLADE — 서울 도시: 아파트 단지, 업무지구 유리 빌딩, 저층 주거, 랜드마크, 한강 다리
//  - 절대 좌표로 결정적 생성 (terrain.js 의 지형/도시화/도로/물 정보 사용)
//  - 3 km 타일마다 InstancedMesh 1개 (재질 1개, 건물 종류는 인스턴스 속성) → 타일 단위 절두체 컬링
//  - 플로팅 원점: 타일 메시 위치 = 타일 원점(절대) - origin, 인스턴스 좌표는 타일 기준 (정밀도 유지)
//  - 파사드(창문/멀리언/층 띠/아파트 동 번호)는 셰이더로 절차 생성 (텍스처는 숫자 아틀라스 하나)
//  - 충돌: 100 m 격자 해시 + 회전 박스 (roofAt / segmentHit), 파괴: 인스턴스 축소 + 잔해 박스 반환
import * as THREE from 'three';
import { heightAt, waterLevelAt, urbanAt, roadAt, terrainSample } from './terrain.js';
import { origin } from './frame.js';

const TILE = 3000;
const GRID = 100;
const T_APT = 0, T_OFFICE = 1, T_LOW = 2, T_BRIDGE = 3, T_LANDMARK = 4;

// 결정적 해시 난수
function hash2(x, z, s) {
  let h = Math.imul((x | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((z | 0) + s * 7919, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// ── 파사드 셰이더 조각 (MeshStandardMaterial.onBeforeCompile) ──
const VERT_PARS = /* glsl */`
attribute vec3 aDim;
attribute vec4 aInfo;     // x: 종류, y: 시드, z: 동 번호, w: 색조
attribute float aOff;     // 잘린 조각: 원래 건물에서의 높이 오프셋 (창문 층이 이어지게)
varying vec3 vObjP;
varying vec3 vObjN;
varying vec4 vInfo;
varying vec3 vDim;
`;
const VERT_MAIN = /* glsl */`
vObjP = position * aDim;
vObjP.y += aOff;
vObjN = normal;
vInfo = aInfo;
vDim = aDim;
vDim.y += aOff;
`;
const FRAG_PARS = /* glsl */`
uniform sampler2D uDigits;
varying vec3 vObjP;
varying vec3 vObjN;
varying vec4 vInfo;
varying vec3 vDim;
float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// 창 패턴: 칸 안의 사각형 마스크 (안티에일리어싱)
float rectMask(vec2 f, vec2 lo, vec2 hi, vec2 aa) {
  vec2 a = smoothstep(lo - aa, lo + aa, f) * (1.0 - smoothstep(hi - aa, hi + aa, f));
  return a.x * a.y;
}
float fRough = 0.8;
float fMetal = 0.0;
`;
const FRAG_COLOR = /* glsl */`
{
  float type = vInfo.x;
  float seed = vInfo.y;
  vec3 n = normalize(vObjN);
  vec3 p = vObjP;
  bool roof = n.y > 0.5;
  // 측면 좌표: u = 면을 따라 가로 (m), v = 높이 (m)
  vec2 tng = normalize(vec2(n.z, -n.x) + 1e-5);   // 바깥에서 볼 때 오른쪽이 + (숫자가 뒤집히지 않게)
  float u = dot(p.xz, tng);
  float v = p.y;
  vec3 col;
  // 멀리서 창 무늬가 깜빡이지 않게 화면 크기에 따라 평균색으로 수렴
  float px = max(fwidth(u), fwidth(v));
  if (roof) {
    col = vec3(0.16, 0.165, 0.17) * (0.85 + 0.3 * fHash(floor(p.xz * 0.5)));
    if (type < 0.5) col = vec3(0.32, 0.33, 0.33);
    fRough = 0.9; fMetal = 0.0;
  } else if (type < 0.5) {
    // ── 아파트: 크림색 벽, 세대별 발코니 창, 꼭대기 색띠, 측벽에 큰 동 번호 ──
    vec3 wall = mix(vec3(0.86, 0.84, 0.79), vec3(0.93, 0.92, 0.9), fHash(vec2(seed, 3.0)));
    float hue = vInfo.w;
    vec3 brand = 0.5 + 0.45 * cos(6.2831 * (hue + vec3(0.0, 0.33, 0.67)));
    brand *= vec3(0.55, 0.6, 0.75);
    bool gable = abs(n.x) > 0.5;      // 슬래브 짧은 면 (동 번호)
    col = wall;
    if (!gable) {
      float fl = 2.8, uw = 3.6;
      vec2 f = vec2(fract(u / uw), fract(v / fl));
      float aa = clamp(px / uw * 1.5, 0.0, 0.5);
      float win = rectMask(f, vec2(0.08, 0.3), vec2(0.92, 0.88), vec2(aa));
      float rail = rectMask(f, vec2(0.08, 0.3), vec2(0.92, 0.42), vec2(aa));
      vec3 glass = vec3(0.07, 0.09, 0.11) + 0.05 * fHash(floor(vec2(u / uw, v / fl)) + seed);
      vec3 c = mix(wall, glass, win);
      c = mix(c, wall * 0.92, rail * 0.8);
      float far = smoothstep(0.25, 0.6, px / uw);
      col = mix(c, mix(wall, glass, 0.45), far);
      if (v < 3.0) col = wall * 0.8;              // 필로티
      if (win > 0.5) { fRough = 0.15; fMetal = 0.3; } else fRough = 0.85;
    } else {
      // 측벽: 상단 색띠 + 동 번호 (3자리)
      float top = vDim.y;
      float halfD = vDim.z * 0.5;
      float uu = u;                                   // -halfD..halfD
      // 브랜드 사선 띠
      float stripe = smoothstep(0.0, 0.4, 1.0 - abs(uu + (v - top + 18.0) * 0.35) / 1.4) * step(top - 30.0, v) * step(v, top - 15.0);
      col = mix(col, brand, stripe);
      // 숫자: 높이 7 m, 자리당 폭 3.2 m
      float dh = 7.0, dw = 3.2;
      float ny = (v - (top - 13.0)) / dh;
      float nx = (uu + dw * 1.5) / dw;
      if (ny > 0.0 && ny < 1.0 && nx > 0.0 && nx < 3.0) {
        float idx = floor(nx);
        float num = vInfo.z;
        float d = mod(floor(num / pow(10.0, 2.0 - idx)), 10.0);
        vec2 tuv = vec2((d + fract(nx)) / 10.0, ny);
        float g = texture2D(uDigits, tuv).r;
        col = mix(col, brand * 0.55, g);
      }
      fRough = 0.85;
    }
  } else if (type < 1.5) {
    // ── 업무지구 유리 커튼월: 멀리언, 층 스팬드럴, 색 유리 ──
    float tsel = fHash(vec2(seed, 9.0));
    vec3 glass = tsel < 0.3 ? vec3(0.05, 0.085, 0.12) : tsel < 0.55 ? vec3(0.06, 0.1, 0.095) : tsel < 0.8 ? vec3(0.1, 0.11, 0.12) : vec3(0.12, 0.09, 0.06);
    if (vInfo.w > 0.95) glass = vec3(0.34, 0.24, 0.07);       // 63빌딩 금빛 유리
    float fl = 4.0, mw = 1.6;
    vec2 f = vec2(fract(u / mw), fract(v / fl));
    float aa = clamp(px / mw * 1.5, 0.0, 0.5);
    float mull = 1.0 - rectMask(f, vec2(0.05, 0.14), vec2(0.95, 0.98), vec2(aa));
    vec3 metal = vec3(0.32, 0.33, 0.35);
    float far = smoothstep(0.3, 0.7, px / mw);
    float m = mix(mull, 0.2, far);
    col = mix(glass, metal, m);
    // 층마다 살짝 다른 반사 (판유리 왜곡)
    col *= 0.9 + 0.2 * fHash(floor(vec2(u / mw, v / fl)) + seed);
    if (v < 6.0) col = mix(vec3(0.2, 0.22, 0.24), col, 0.4);  // 로비층
    fRough = mix(0.06, 0.45, m); fMetal = mix(0.85, 0.6, m);
  } else if (type < 2.5) {
    // ── 저층 주거/상가: 벽돌·베이지·회색 벽, 작은 창 ──
    float c = fHash(vec2(seed, 5.0));
    vec3 wall = c < 0.3 ? vec3(0.42, 0.25, 0.19) : c < 0.55 ? vec3(0.7, 0.64, 0.54) : c < 0.8 ? vec3(0.55, 0.56, 0.57) : vec3(0.82, 0.8, 0.76);
    float fl = 3.0, ww = 3.4;
    vec2 f = vec2(fract(u / ww), fract(v / fl));
    float aa = clamp(px / ww * 1.5, 0.0, 0.5);
    float win = rectMask(f, vec2(0.25, 0.3), vec2(0.75, 0.78), vec2(aa));
    vec3 glass = vec3(0.08, 0.09, 0.1);
    float far = smoothstep(0.3, 0.7, px / ww);
    col = mix(mix(wall, glass, win), mix(wall, glass, 0.25), far);
    if (v < 3.2) col = mix(vec3(0.15, 0.17, 0.2), wall, 0.3) ;          // 1층 상가
    fRough = win > 0.5 ? 0.2 : 0.9;
  } else if (type < 3.5) {
    // ── 다리: 콘크리트 + 측면 난간 띠 ──
    col = vec3(0.55, 0.55, 0.53);
    if (!roof && v > vDim.y - 1.2) col = vec3(0.72, 0.73, 0.75);
    fRough = 0.85;
  } else {
    // ── 랜드마크 유리 (롯데월드타워 등): 세로 핀 + 층 띠 ──
    vec3 glass = vec3(0.13, 0.15, 0.17);
    float fl = 4.2, mw = 1.8;
    vec2 f = vec2(fract(u / mw), fract(v / fl));
    float aa = clamp(px / mw * 1.5, 0.0, 0.5);
    float mull = 1.0 - rectMask(f, vec2(0.08, 0.1), vec2(0.92, 0.98), vec2(aa));
    float far = smoothstep(0.3, 0.7, px / mw);
    float m = mix(mull, 0.2, far);
    col = mix(glass, vec3(0.75, 0.76, 0.78), m * 0.8);
    fRough = mix(0.05, 0.35, m); fMetal = 0.85;
  }
  diffuseColor.rgb = col;
}
`;

function makeDigitAtlas() {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.font = 'bold 86px Arial, Helvetica, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let d = 0; d < 10; d++) g.fillText(String(d), d * 64 + 32, 50);
  const t = new THREE.CanvasTexture(c);
  t.flipY = true;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

function makeFacadeMaterial(digits, envMap) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0, envMap, envMapIntensity: 1.0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDigits = { value: digits };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = fMetal;');
  };
  m.customProgramCacheKey = () => 'sky-blade-facade';
  return m;
}

// 단위 박스 (바닥면 없음, 밑면이 y=0) — 인스턴스 스케일 = 건물 크기
export function unitBox() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  return g;
}

export class City {
  constructor(renderer, scene, opts = {}) {
    this.scene = scene;
    this.low = opts.quality === 'low';
    this.real = opts.buildings || null;
    this.max = this.real ? this.real.n + (opts.extraBoxes ? opts.extraBoxes.length : 0) + 400 : this.low ? 14000 : 42000;
    // 건물 데이터 (절대 좌표)
    const M = this.max + 64;
    this.n = 0;
    this.bx = new Float64Array(M); this.bz = new Float64Array(M);
    this.by = new Float32Array(M); this.bh = new Float32Array(M);
    this.bw = new Float32Array(M); this.bd = new Float32Array(M);
    this.bc = new Float32Array(M); this.bs = new Float32Array(M);   // cos, sin (회전)
    this.btype = new Uint8Array(M); this.alive = new Uint8Array(M);
    this.bseed = new Float32Array(M); this.bnum = new Float32Array(M); this.btint = new Float32Array(M);
    this.btile = new Int32Array(M); this.binst = new Int32Array(M);
    this.grid = new Map();
    this.tiles = [];
    this.group = new THREE.Group();
    this.group.name = 'city';
    scene.add(this.group);
    this.landmarks = [];
    this._boxes = [];
    for (let i = 0; i < 400; i++) this._boxes.push({ x: 0, y: 0, z: 0, w: 0, h: 0, d: 0, color: 0x999999 });
    this._out = [];

    this.digits = makeDigitAtlas();
    this.envMap = this._makeEnv(renderer, scene);
    this.material = makeFacadeMaterial(this.digits, this.envMap);

    const t0 = performance.now();
    if (this.real) {
      this._loadReal(this.real);
      this.real = true;
      // 다리·고가 상판/난간/교각 (roads.js 가 실제 도로에서 계산)
      for (const b of opts.extraBoxes || []) this._add(...b);
    } else {
      this._generate();
      this._placeLandmarks();
      this._placeBridges();
    }
    this._buildTiles();
    this.genMs = performance.now() - t0;
    this._m = new THREE.Matrix4();
  }

  // 하늘 돔으로 반사 환경맵 (유리 반사용, 1회)
  _makeEnv(renderer, scene) {
    try {
      const sky = scene.getObjectByName('skyDome');
      if (!sky) return null;
      const s = new THREE.Scene();
      const m = new THREE.Mesh(sky.geometry, sky.material);
      s.add(m);
      const pm = new THREE.PMREMGenerator(renderer);
      const rt = pm.fromScene(s, 0, 0.1, 5000);
      pm.dispose();
      return rt.texture;
    } catch (e) { console.warn('city env', e); return null; }
  }

  _add(type, x, z, w, d, h, rot, seed, num = 0, tint = 0, baseY = null) {
    if (this.n >= this.max + 60) return -1;
    let y0 = baseY;
    if (y0 === null) {
      // 경사지: 네 모서리 중 가장 낮은 곳에 묻어 세움
      const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hd = d / 2;
      let lo = Infinity;
      for (const [a, b] of [[hw, hd], [-hw, -hd]]) lo = Math.min(lo, heightAt(x + a * c - b * s, z + a * s + b * c));
      y0 = lo - 1.5;
      h += 1.5;
    }
    const i = this.n++;
    this.bx[i] = x; this.bz[i] = z; this.by[i] = y0; this.bh[i] = h; this.bw[i] = w; this.bd[i] = d;
    this.bc[i] = Math.cos(rot); this.bs[i] = Math.sin(rot);
    this.btype[i] = type; this.alive[i] = 1; this.bseed[i] = seed; this.bnum[i] = num; this.btint[i] = tint;
    // 격자 등록 (외접원 기준)
    const r = Math.hypot(w, d) / 2;
    const gx0 = Math.floor((x - r) / GRID), gx1 = Math.floor((x + r) / GRID);
    const gz0 = Math.floor((z - r) / GRID), gz1 = Math.floor((z + r) / GRID);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const k = gx * 100003 + gz;
      let a = this.grid.get(k);
      if (!a) { a = []; this.grid.set(k, a); }
      a.push(i);
    }
    return i;
  }

  _footClear(x, z, w, d, rot) {
    const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2, hd = d / 2;
    // 생성 비용을 줄이려고 중심 + 대각 두 모서리만 검사 (물은 칸 단위로 이미 검사)
    for (const [a, b] of [[0, 0], [hw, hd], [-hw, -hd]]) {
      const px = x + a * c - b * s, pz = z + a * s + b * c;
      if (roadAt(px, pz)) return false;
    }
    return true;
  }

  _generate() {
    const C = 128;
    const x0 = -38000, x1 = 30000, z0 = -16000, z1 = 22000;
    const dens = this.low ? 0.35 : 1.0;
    let aptNo = 0;
    for (let cz = z0; cz < z1; cz += 512) {
      for (let cx = x0; cx < x1; cx += 512) {
        // 512 m 굵은 칸이 도시가 아니면 통째로 건너뜀
        if (urbanAt(cx + 256, cz + 256) < 0.1 && urbanAt(cx + 128, cz + 128) < 0.1 && urbanAt(cx + 384, cz + 384) < 0.1) continue;
        for (let sz = 0; sz < 4; sz++) for (let sx = 0; sx < 4; sx++) {
          if (this.n >= this.max) return;
          const gx = cx + sx * C, gz = cz + sz * C;
          const x = gx + C / 2, z = gz + C / 2;
          if (x * x + z * z < 280 * 280) continue;            // 스폰 광장
          const S = terrainSample(x, z);
          const u = S.urban;
          if (u < 0.16 || S.park > 0.4 || S.sea > 0.5) continue;
          const h0 = S.h;
          if (waterLevelAt(x, z) > h0 - 0.5) continue;
          if (Math.abs(heightAt(x + 45, z) - h0) > 12 || Math.abs(heightAt(x, z + 45) - h0) > 12) continue;
          const r = hash2(gx, gz, 1);
          if (r > dens) continue;
          const ix = Math.round(gx / C), iz = Math.round(gz / C);
          const complex = hash2(Math.floor(gx / 512), Math.floor(gz / 512), 7);
          if (u > 0.8 && hash2(ix, iz, 3) < 0.85) {
            // 업무지구: 타워 1~3동
            const k = 1 + Math.floor(hash2(ix, iz, 4) * 2.6);
            for (let j = 0; j < k; j++) {
              const w = 24 + hash2(ix, iz, 10 + j) * 26, d = 22 + hash2(ix, iz, 20 + j) * 24;
              const ox = (hash2(ix, iz, 30 + j) - 0.5) * (C - w - 36), oz = (hash2(ix, iz, 40 + j) - 0.5) * (C - d - 36);
              const tall = Math.pow(hash2(ix, iz, 50 + j), 2.2);
              const h = 35 + (u - 0.8) * 300 + tall * 190;
              const bx = x + ox, bz = z + oz;
              if (!this._footClear(bx, bz, w, d, 0)) continue;
              this._add(T_OFFICE, bx, bz, w, d, h, 0, hash2(ix, iz, 60 + j));
            }
          } else if (u > 0.42 && complex > 0.38) {
            // 아파트 단지: 남향 판상형 2동 (단지마다 같은 방향)
            const rot = (hash2(Math.floor(gx / 512), Math.floor(gz / 512), 8) - 0.5) * 0.5;
            const floors = 15 + Math.floor(hash2(Math.floor(gx / 512), Math.floor(gz / 512), 9) * 16 + hash2(ix, iz, 5) * 5);
            const h = floors * 2.8 + 3;
            const tint = hash2(Math.floor(gx / 512), Math.floor(gz / 512), 11);
            for (let j = 0; j < 2; j++) {
              const L = 52 + hash2(ix, iz, 12 + j) * 22, D = 13.5;
              const oz = j === 0 ? -27 : 27;
              const ox = (hash2(ix, iz, 14 + j) - 0.5) * 8;
              const c = Math.cos(rot), s = Math.sin(rot);
              const bx = x + ox * c - oz * s, bz = z + ox * s + oz * c;
              if (!this._footClear(bx, bz, L, D, rot)) continue;
              aptNo++;
              const num = 101 + ((ix * 7 + iz * 3 + j) % 3) * 1 + (Math.abs(ix * 13 + iz * 31) % 9) * 1 + j;
              this._add(T_APT, bx, bz, L, D, h, rot, hash2(ix, iz, 16 + j), num, tint);
            }
          } else {
            // 저층 주거/상가: 2x2 필지
            const prob = this.low ? 0.4 : 0.85;
            for (let j = 0; j < 4; j++) {
              if (hash2(ix, iz, 70 + j) > prob) continue;
              const w = 13 + hash2(ix, iz, 80 + j) * 14, d = 12 + hash2(ix, iz, 90 + j) * 13;
              const ox = ((j & 1) ? 1 : -1) * 30 + (hash2(ix, iz, 100 + j) - 0.5) * 10;
              const oz = ((j & 2) ? 1 : -1) * 30 + (hash2(ix, iz, 110 + j) - 0.5) * 10;
              const floors = 2 + Math.floor(hash2(ix, iz, 120 + j) * (u > 0.5 ? 6 : 4));
              const bx = x + ox, bz = z + oz;
              if (!this._footClear(bx, bz, w, d, 0)) continue;
              this._add(T_LOW, bx, bz, w, d, floors * 3 + 0.6, 0, hash2(ix, iz, 130 + j));
            }
          }
        }
      }
    }
  }

  // ── 실제 서울 건물 (seoul.js loadBuildings) ──
  _loadReal(B) {
    const n = B.n;
    for (let i = 0; i < n; i++) {
      const w = B.w[i] * 0.1, d = B.d[i] * 0.1, h = B.h[i] * 0.1, rot = B.yaw[i] / 65535 * Math.PI;
      const sd = B.seed[i] / 255, k = B.kind[i];
      const type = k === 0 ? T_APT : k === 1 ? T_OFFICE : T_LOW;
      const num = type === T_APT ? 101 + Math.floor(sd * 12) : 0;
      const tint = type === T_OFFICE ? sd * 0.9 : (sd * 7.31) % 1;
      const mh = B.minH[i] * 0.1;
      if (mh > 0.5) {
        // 위로 띄운 부분 (구름다리·필로티 위층)
        const g = Math.min(heightAt(B.x[i], B.z[i]), heightAt(B.x[i] + 3, B.z[i] + 3));
        this._add(type, B.x[i], B.z[i], w, d, h - mh, rot, sd, num, tint, g + mh);
      } else this._add(type, B.x[i], B.z[i], w, d, h, rot, sd, num, tint);
    }
    // 랜드마크: 롯데월드타워는 가늘어지는 실제 모양으로, N서울타워, 63빌딩 금빛 유리
    const tallest = (x, z, r) => { let b = -1; for (let i = 0; i < this.n; i++) if (Math.abs(this.bx[i] - x) < r && Math.abs(this.bz[i] - z) < r && (b < 0 || this.bh[i] > this.bh[b])) b = i; return b; };
    let lt = tallest(10981, 5997, 90);
    if (lt >= 0 && this.bh[lt] > 300) { this.alive[lt] = 0; this._lotte(this.bx[lt], this.bz[lt], 0); }
    else this._lotte(10981, 5997, 40);
    this._seoulTower(899, 1701);
    const sx = tallest(-3325, 5192, 70);
    if (sx >= 0) this.btint[sx] = 1.0;
  }

  // 주변에서 조건을 만족하는 지점 찾기
  _find(x, z, R, step, score) {
    let best = null, bs = -Infinity;
    for (let dz = -R; dz <= R; dz += step) for (let dx = -R; dx <= R; dx += step) {
      const s = score(x + dx, z + dz);
      if (s > bs) { bs = s; best = [x + dx, z + dz]; }
    }
    return best;
  }

  _placeLandmarks() {
    const dry = (x, z) => waterLevelAt(x, z) < heightAt(x, z) - 0.5;
    // 롯데월드타워 (555 m, 잠실)
    const lt = this._find(12500, 2500, 1200, 150, (x, z) => (dry(x, z) ? 0 : -1e9) - Math.abs(heightAt(x + 40, z) - heightAt(x - 40, z)) - Math.hypot(x - 12500, z - 2500) * 0.01);
    if (lt) this._lotte(lt[0], lt[1]);
    // 63빌딩 (여의도, 금빛 유리 249 m): 강 가까운 마른 땅
    const yy = this._find(-6500, 300, 1800, 100, (x, z) => {
      if (!dry(x, z)) return -1e9;
      let w = 0;
      for (const [a, b] of [[0, 500], [0, -500], [500, 0], [-500, 0]]) if (!dry(x + a, z + b)) w++;
      return w * 10 + urbanAt(x, z) * 5 - Math.hypot(x + 6500, z - 300) * 0.002;
    });
    if (yy) {
      this._clearAround(yy[0], yy[1], 60);
      this._add(T_OFFICE, yy[0], yy[1], 46, 30, 249, 0.3, 0.77, 0, 1.0);
    }
    // N서울타워 (남산 정상)
    const ns = this._find(1500, -3000, 1500, 60, (x, z) => heightAt(x, z));
    if (ns) this._seoulTower(ns[0], ns[1]);
  }

  _clearAround(x, z, r) {
    for (let i = 0; i < this.n; i++) if (this.alive[i] && Math.hypot(this.bx[i] - x, this.bz[i] - z) < r + Math.hypot(this.bw[i], this.bd[i]) / 2) this.alive[i] = 0;
  }

  _lotte(x, z, clear = 90) {
    if (clear > 0) this._clearAround(x, z, clear);
    const y0 = heightAt(x, z) - 2;
    // 둥근 모서리 사각 단면이 위로 갈수록 좁아지는 형태 (16각 원기둥을 사각으로 눌러 근사)
    const H = 555, segH = 40;
    const g = new THREE.CylinderGeometry(1, 1, 1, 16, segH, false);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i) + 0.5, pz = pos.getZ(i);
      const t = py;                                                // 0..1
      const half = 34 * (1 - t) + 6 * t - 6 * Math.pow(t, 6);     // 꼭대기로 갈수록 가늘게
      const ang = Math.atan2(pz, px);
      const sq = 1 / Math.max(Math.abs(Math.cos(ang)), Math.abs(Math.sin(ang)));   // 사각형으로 눌러줌
      const r = half * (0.82 + 0.18 * sq);
      pos.setXYZ(i, Math.cos(ang) * r, py * H, Math.sin(ang) * r);
    }
    g.computeVertexNormals();
    const n = pos.count;
    g.setAttribute('aDim', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    const info = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) info.set([4, 0.5, 0, 0], i * 4);
    g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
    this._landmarkMesh(g, x, y0, z);
    // 충돌용 박스 (그리지 않음)
    const i = this._add(T_LANDMARK, x, z, 62, 62, H, Math.PI / 4, 0.5, 0, 0, y0);
    if (i >= 0) this.binst[i] = -1;
  }

  _seoulTower(x, z) {
    const y0 = heightAt(x, z) - 1;
    const parts = [
      [new THREE.CylinderGeometry(9, 11, 30, 24), 15, 0xd9d9d6],
      [new THREE.CylinderGeometry(4.8, 6.2, 150, 24), 105, 0xe6e6e3],
      [new THREE.CylinderGeometry(13, 10, 22, 32), 178, 0xcfd2d6],
      [new THREE.CylinderGeometry(1.4, 2.2, 60, 12), 219, 0xd8463a],
    ];
    for (const [geo, cy] of parts) geo.translate(0, cy, 0);
    for (const [geo, , color] of parts) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2, envMap: this.envMap }));
      mesh.castShadow = true; mesh.receiveShadow = true;
      const L = { mesh, ax: x, ay: y0, az: z, idx: -1 };
      this.landmarks.push(L);
      this.group.add(mesh);
    }
    const i = this._add(T_LANDMARK, x, z, 24, 24, 250, 0, 0.3, 0, 0, y0);
    if (i >= 0) { this.binst[i] = -1; this._towerIdx = i; }
  }

  _landmarkMesh(geo, x, y, z) {
    if (!geo.attributes.aOff) geo.setAttribute('aOff', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.landmarks.push({ mesh, ax: x, ay: y, az: z, idx: -1 });
    this.group.add(mesh);
  }

  _placeBridges() {
    const xs = [-11000, -8500, -6000, -3600, -1200, 1200, 3600, 6000, 8500, 11000, 13500];
    for (const x of xs) {
      // 강을 가로지르는 물 구간 찾기
      let za = null, zb = null;
      for (let z = -3000; z <= 5000; z += 20) {
        const wet = waterLevelAt(x, z) > heightAt(x, z) - 0.2;
        if (wet && za === null) za = z;
        if (wet) zb = z;
        if (!wet && za !== null && z - zb > 200) break;
      }
      if (za === null || zb - za < 250 || zb - za > 2200) continue;
      const wl = waterLevelAt(x, (za + zb) / 2);
      const deckY = Math.max(wl + 13, heightAt(x, za - 80) + 1, heightAt(x, zb + 80) + 1);
      const L = zb - za + 200, cz = (za + zb) / 2;
      this._add(T_BRIDGE, x, cz, 28, L, 3.2, 0, 0.2, 0, 0, deckY - 3.2);
      // 교각
      for (let z = za + 60; z < zb - 30; z += 130) this._add(T_BRIDGE, x, z, 6, 8, deckY - 3.2 - (wl - 6), 0, 0.3, 0, 0, wl - 6);
    }
  }

  _buildTiles() {
    const tiles = new Map();
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i] || this.btype[i] === T_LANDMARK) { this.btile[i] = -1; continue; }
      // 실제 서울: 높은 건물(30 m+)은 3 km 타일 (멀리서도 보이는 스카이라인), 나머지는 750 m 타일 (가까이서만)
      const tall = !this.real || this.bh[i] >= 30;
      const T = !this.real ? TILE : tall ? 3000 : 750;
      const k = (tall ? 0 : 1e9) + Math.floor(this.bx[i] / T) * 100000 + Math.floor(this.bz[i] / T);
      let t = tiles.get(k);
      if (!t) { t = { ids: [], ox: Math.floor(this.bx[i] / T) * T + T / 2, oz: Math.floor(this.bz[i] / T) * T + T / 2, near: !tall }; tiles.set(k, t); }
      t.ids.push(i);
    }
    const geo = unitBox();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    for (const t of tiles.values()) {
      const N = t.ids.length;
      const g = geo.clone();
      const dim = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
      const info = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
      g.setAttribute('aDim', dim);
      g.setAttribute('aInfo', info);
      g.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(N), 1));
      const mesh = new THREE.InstancedMesh(g, this.material, N);
      mesh.castShadow = true; mesh.receiveShadow = true;
      let minY = Infinity, maxY = -Infinity;
      t.ids.forEach((i, j) => {
        q.setFromAxisAngle(Y, -Math.atan2(this.bs[i], this.bc[i]));
        s.set(this.bw[i], this.bh[i], this.bd[i]);
        p.set(this.bx[i] - t.ox, this.by[i], this.bz[i] - t.oz);
        m.compose(p, q, s);
        mesh.setMatrixAt(j, m);
        dim.setXYZ(j, this.bw[i], this.bh[i], this.bd[i]);
        info.setXYZW(j, this.btype[i], this.bseed[i], this.bnum[i], this.btint[i]);
        this.btile[i] = this.tiles.length; this.binst[i] = j;
        minY = Math.min(minY, this.by[i]); maxY = Math.max(maxY, this.by[i] + this.bh[i]);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      t.mesh = mesh;
      t.maxY = maxY;
      t.orig = new Float32Array(mesh.instanceMatrix.array);   // 복원용
      this.tiles.push(t);
      this.group.add(mesh);
    }
    this.count = this.n;
    this.bh0 = this.bh.slice();   // 복원용 원래 높이
  }

  update(dt, camera, camAbs) {
    // 플로팅 원점: 타일/랜드마크 위치 = 절대 - origin
    const R = this.nearR || 3000;
    for (const t of this.tiles) {
      t.mesh.position.set(t.ox - origin.x, -origin.y, t.oz - origin.z);
      if (t.near) t.mesh.visible = Math.abs(t.ox - camAbs.x) < R + 400 && Math.abs(t.oz - camAbs.z) < R + 400 && camAbs.y - t.maxY < R;
    }
    for (const L of this.landmarks) L.mesh.position.set(L.ax - origin.x, L.ay - origin.y, L.az - origin.z);
    // 아주 높이 올라가면 도시를 숨김 (지구 원반이 대신)
    this.group.visible = camAbs.y < 120000;
  }

  // ── 충돌 질의 (절대 좌표) ──
  _local(i, x, z, out) {
    const dx = x - this.bx[i], dz = z - this.bz[i];
    out[0] = dx * this.bc[i] + dz * this.bs[i];
    out[1] = -dx * this.bs[i] + dz * this.bc[i];
    return out;
  }

  roofAt(x, z) {
    const a = this.grid.get(Math.floor(x / GRID) * 100003 + Math.floor(z / GRID));
    if (!a) return -Infinity;
    let top = -Infinity;
    const L = _l;
    for (let k = 0; k < a.length; k++) {
      const i = a[k];
      if (!this.alive[i]) continue;
      this._local(i, x, z, L);
      if (Math.abs(L[0]) <= this.bw[i] / 2 && Math.abs(L[1]) <= this.bd[i] / 2) top = Math.max(top, this.by[i] + this.bh[i]);
    }
    return top;
  }

  // 선분 a→b 와 가장 먼저 닿는 건물 (회전 박스, 슬랩법)
  segmentHit(ax, ay, az, bx, by, bz, out) {
    if (Math.min(ay, by) > 700) return false;                 // 가장 높은 건물보다 위
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.min(4000, Math.ceil(len / GRID) + 1);
    let best = Infinity, bi = -1, bnx = 0, bny = 0, bnz = 0;
    const seen = _seen; seen.clear();
    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0;
      const px = ax + dx * t, pz = az + dz * t;
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const a = this.grid.get((Math.floor(px / GRID) + ox) * 100003 + Math.floor(pz / GRID) + oz);
        if (!a) continue;
        for (let k = 0; k < a.length; k++) {
          const i = a[k];
          if (!this.alive[i] || seen.has(i)) continue;
          seen.add(i);
          // 박스 지역 좌표로 변환
          const c = this.bc[i], sn = this.bs[i];
          const rx = ax - this.bx[i], rz = az - this.bz[i];
          const lox = rx * c + rz * sn, loz = -rx * sn + rz * c, loy = ay - this.by[i];
          const ldx = dx * c + dz * sn, ldz = -dx * sn + dz * c, ldy = dy;
          const hx = this.bw[i] / 2, hz = this.bd[i] / 2, hy = this.bh[i];
          let t0 = 0, t1 = 1, nax = 0, nay = 0, naz = 0;
          // x
          if (Math.abs(ldx) < 1e-9) { if (lox < -hx || lox > hx) continue; }
          else {
            let ta = (-hx - lox) / ldx, tb = (hx - lox) / ldx, sgn = -1;
            if (ta > tb) { const tt = ta; ta = tb; tb = tt; sgn = 1; }
            if (ta > t0) { t0 = ta; nax = sgn; nay = 0; naz = 0; }
            if (tb < t1) t1 = tb;
            if (t0 > t1) continue;
          }
          // y
          if (Math.abs(ldy) < 1e-9) { if (loy < 0 || loy > hy) continue; }
          else {
            let ta = (0 - loy) / ldy, tb = (hy - loy) / ldy, sgn = -1;
            if (ta > tb) { const tt = ta; ta = tb; tb = tt; sgn = 1; }
            if (ta > t0) { t0 = ta; nax = 0; nay = sgn; naz = 0; }
            if (tb < t1) t1 = tb;
            if (t0 > t1) continue;
          }
          // z
          if (Math.abs(ldz) < 1e-9) { if (loz < -hz || loz > hz) continue; }
          else {
            let ta = (-hz - loz) / ldz, tb = (hz - loz) / ldz, sgn = -1;
            if (ta > tb) { const tt = ta; ta = tb; tb = tt; sgn = 1; }
            if (ta > t0) { t0 = ta; nax = 0; nay = 0; naz = sgn; }
            if (tb < t1) t1 = tb;
            if (t0 > t1) continue;
          }
          if (t0 <= 0 && (nax !== 0 || nay !== 0 || naz !== 0) === false) {
            // 시작점이 이미 박스 안: 가장 가까운 면으로 밀어냄
            const ex = hx - Math.abs(lox), ez = hz - Math.abs(loz), ey = hy - loy;
            if (ey < ex && ey < ez) { nay = 1; } else if (ex < ez) nax = Math.sign(lox) || 1; else naz = Math.sign(loz) || 1;
            t0 = 0;
          }
          if (t0 < best) {
            best = t0; bi = i;
            // 법선을 월드로 (회전 역변환)
            bnx = nax * c - naz * sn; bnz = nax * sn + naz * c; bny = nay;
            // 진행 방향과 같은 쪽이면 뒤집기
            if (bnx * dx + bny * dy + bnz * dz > 0) { bnx = -bnx; bny = -bny; bnz = -bnz; }
          }
        }
      }
      if (bi >= 0 && best <= t + GRID / Math.max(len, 1)) break;   // 이미 가까운 충돌을 찾음
    }
    if (bi < 0) return false;
    out.t = best; out.id = bi;
    out.x = ax + dx * best; out.y = ay + dy * best; out.z = az + dz * best;
    const nl = Math.hypot(bnx, bny, bnz) || 1;
    out.nx = bnx / nl; out.ny = bny / nl; out.nz = bnz / nl;
    return true;
  }


  // ── 개별 건물 (건물 물리용) ──
  /** 절대 (x,z) 위에 서 있는 살아 있는 건물 index (가장 높은 것), 없으면 -1 */
  roofId(x, z) {
    const a = this.grid.get(Math.floor(x / GRID) * 100003 + Math.floor(z / GRID));
    if (!a) return -1;
    let top = -Infinity, id = -1;
    const L = _l;
    for (let k = 0; k < a.length; k++) {
      const i = a[k];
      if (!this.alive[i]) continue;
      this._local(i, x, z, L);
      if (Math.abs(L[0]) <= this.bw[i] / 2 && Math.abs(L[1]) <= this.bd[i] / 2 && this.by[i] + this.bh[i] > top) { top = this.by[i] + this.bh[i]; id = i; }
    }
    return id;
  }
  /** 잘 그려지는 일반 건물인지 (타일 인스턴스) */
  isDynamicable(i) { return i >= 0 && this.alive[i] && this.btile[i] >= 0 && this.btype[i] !== T_BRIDGE; }
  /** 건물 높이를 줄임 (잘린 그루터기). h = 새 높이 (m) */
  setHeight(i, h) {
    const ti = this.btile[i];
    this.bh[i] = h;
    if (ti < 0) return;
    const t = this.tiles[ti], j = this.binst[i];
    const q = _q.setFromAxisAngle(_Y, -Math.atan2(this.bs[i], this.bc[i]));
    _s.set(this.bw[i], h, this.bd[i]);
    _p.set(this.bx[i] - t.ox, this.by[i], this.bz[i] - t.oz);
    t.mesh.setMatrixAt(j, _mm.compose(_p, q, _s));
    t.mesh.instanceMatrix.needsUpdate = true;
    const dim = t.mesh.geometry.attributes.aDim;
    dim.setY(j, h); dim.needsUpdate = true;
  }
  /** 건물 하나 제거 → 잔해 박스 (절대 좌표 중심) */
  kill(i) {
    if (!this.alive[i]) return null;
    this.alive[i] = 0;
    const ti = this.btile[i];
    if (ti >= 0) { const t = this.tiles[ti]; t.mesh.setMatrixAt(this.binst[i], _zero); t.mesh.instanceMatrix.needsUpdate = true; }
    const b = { x: this.bx[i], z: this.bz[i], y: this.by[i] + this.bh[i] / 2, w: this.bw[i], h: this.bh[i], d: this.bd[i] };
    const ty = this.btype[i];
    b.color = ty === T_APT ? 0xdcd8cf : ty === T_OFFICE ? 0x3a4652 : ty === T_BRIDGE ? 0x8a8a86 : 0x9a8a7a;
    return b;
  }

  // 구 안의 건물 파괴 → 잔해 박스 목록 (절대 좌표 중심)
  destroy(x, y, z, radius) {
    const out = this._out; out.length = 0;
    const g0x = Math.floor((x - radius) / GRID), g1x = Math.floor((x + radius) / GRID);
    const g0z = Math.floor((z - radius) / GRID), g1z = Math.floor((z + radius) / GRID);
    const touched = _touched; touched.clear();
    if ((g1x - g0x) * (g1z - g0z) > 250000) return out;
    for (let gx = g0x; gx <= g1x; gx++) for (let gz = g0z; gz <= g1z; gz++) {
      const a = this.grid.get(gx * 100003 + gz);
      if (!a) continue;
      for (let k = 0; k < a.length; k++) {
        const i = a[k];
        if (!this.alive[i]) continue;
        const r = Math.hypot(this.bw[i], this.bd[i]) / 2;
        const dh = Math.hypot(this.bx[i] - x, this.bz[i] - z);
        if (dh > radius + r) continue;
        // 높이: 구가 건물 높이 범위와 겹치는지 (충격은 지면에서 퍼지므로 관대하게)
        if (y > this.by[i] + this.bh[i] + radius || y < this.by[i] - radius) continue;
        this.alive[i] = 0;
        const ti = this.btile[i];
        if (ti >= 0) {
          const t = this.tiles[ti];
          t.mesh.setMatrixAt(this.binst[i], _zero);
          touched.add(ti);
        } else if (i === this._towerIdx) {
          for (const L of this.landmarks) if (L.mesh.material !== this.material) L.mesh.visible = false;
        } else if (this.btype[i] === T_LANDMARK) {
          for (const L of this.landmarks) if (L.mesh.material === this.material) L.mesh.visible = false;
        }
        if (out.length < this._boxes.length) {
          const b = this._boxes[out.length];
          b.x = this.bx[i]; b.z = this.bz[i]; b.y = this.by[i] + this.bh[i] / 2;
          b.w = this.bw[i]; b.h = this.bh[i]; b.d = this.bd[i];
          const ty = this.btype[i];
          b.color = ty === T_APT ? 0xdcd8cf : ty === T_OFFICE ? 0x3a4652 : ty === T_BRIDGE ? 0x8a8a86 : 0x9a8a7a;
          out.push(b);
        }
      }
    }
    for (const ti of touched) this.tiles[ti].mesh.instanceMatrix.needsUpdate = true;
    return out;
  }

  restoreAll() {
    for (let i = 0; i < this.n; i++) this.alive[i] = 1;
    if (this.bh0) this.bh.set(this.bh0);
    for (const t of this.tiles) {
      t.mesh.instanceMatrix.array.set(t.orig); t.mesh.instanceMatrix.needsUpdate = true;
      const dim = t.mesh.geometry.attributes.aDim;
      t.ids.forEach((i, j) => dim.setY(j, this.bh[i]));
      dim.needsUpdate = true;
    }
    for (const L of this.landmarks) L.mesh.visible = true;
    // 생성 시 랜드마크 자리 정리로 숨긴 건물은 계속 숨김
    for (let i = 0; i < this.n; i++) if (this.btile[i] < 0 && this.btype[i] !== T_LANDMARK) this.alive[i] = 0;
  }
}

const _l = [0, 0];
const _seen = new Set();
const _touched = new Set();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _mm = new THREE.Matrix4(), _Y = new THREE.Vector3(0, 1, 0);
export { T_APT, T_OFFICE, T_LOW, T_BRIDGE, T_LANDMARK };
