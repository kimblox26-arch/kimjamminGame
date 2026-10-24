// SKY BLADE — 다른 천체의 표면 (달·수성·금성·화성·목성의 위성·타이탄·명왕성 / 가스 행성은 구름 바다)
//  - 착륙 지점을 원점으로 하는 지역 좌표 (x 동, y 위, z 남, m). 멀리 보이는 둥근 지평선과 하늘의 천체는 우주 장면(space.js)이 그림
//  - 높이: 실제 지도 텍스처(화성 MOLA 고도, 달 고도) + 운석구덩이(크기별 여러 층) + 잔기복 → 물리(JS)와 메시가 같은 함수
//  - 색: 실제 행성 지도 텍스처를 착륙 위도·경도에 맞춰 샘플 + 가까이선 잔무늬
//  - 대기: 화성 (옅은 버터스카치 하늘·먼지), 금성 (두꺼운 주황 안개), 타이탄 (주황 연무), 나머지는 검은 하늘
import * as THREE from 'three';
import { origin } from './frame.js';

const D2R = Math.PI / 180;
// g: 표면 중력 (m/s²), atm: 지표 대기 밀도 (지구 = 1), crater: 운석구덩이 밀도, rough: 잔기복 (m), topo: 고도 지도 (m 배율)
export const SURF = {
  moon: { g: 1.62, atm: 0, crater: 1.0, rough: 3, tex: 'moon.jpg', topo: 'moon_bump.jpg', topoK: 9000, light: 1.0, rock: [0.5, 0.49, 0.47], lat: 0.67, lon: 23.47, note: '고요의 바다 (아폴로 11호 착륙지 근처)' },
  mercury: { g: 3.7, atm: 0, crater: 1.3, rough: 3.5, tex: 'mercury.jpg', light: 1.8, rock: [0.45, 0.42, 0.39], lat: -20, lon: 120 },
  venus: { g: 8.87, atm: 60, crater: 0.05, rough: 6, tex: null, col: [0.33, 0.24, 0.16], light: 0.35, sky: [0.95, 0.62, 0.28], hor: [0.9, 0.55, 0.22], fog: 2500, rock: [0.32, 0.25, 0.18], lat: 3, lon: 300, note: '마아트 산 근처 화산 평원' },
  mars: { g: 3.71, atm: 0.012, crater: 0.6, rough: 4, dunes: 1, tex: 'mars.jpg', topo: 'mars_topo.jpg', topoK: 21000, light: 0.7, sky: [0.62, 0.45, 0.32], hor: [0.85, 0.65, 0.45], fog: 26000, rock: [0.45, 0.25, 0.15], lat: 18.4, lon: 77.5, note: '예제로 크레이터 (퍼서비어런스 착륙지)' },
  io: { g: 1.8, atm: 0, crater: 0.05, rough: 5, col: [0.85, 0.75, 0.35], col2: [0.6, 0.35, 0.12], light: 0.5, rock: [0.6, 0.5, 0.25], lat: 0, lon: 0 },
  europa: { g: 1.31, atm: 0, crater: 0.1, rough: 1.5, cracks: 1, col: [0.85, 0.82, 0.76], col2: [0.55, 0.38, 0.28], light: 0.5, rock: [0.8, 0.78, 0.74], lat: 10, lon: 40 },
  ganymede: { g: 1.43, atm: 0, crater: 0.8, rough: 3, col: [0.55, 0.52, 0.48], col2: [0.32, 0.3, 0.27], light: 0.5, rock: [0.45, 0.43, 0.4], lat: 0, lon: 0 },
  callisto: { g: 1.24, atm: 0, crater: 1.4, rough: 3, col: [0.38, 0.35, 0.31], col2: [0.22, 0.2, 0.18], light: 0.5, rock: [0.35, 0.33, 0.3], lat: 0, lon: 0 },
  titan: { g: 1.35, atm: 1.45, crater: 0.05, rough: 4, dunes: 1, col: [0.42, 0.3, 0.16], col2: [0.2, 0.14, 0.08], light: 0.3, sky: [0.7, 0.45, 0.18], hor: [0.8, 0.55, 0.25], fog: 6000, rock: [0.4, 0.3, 0.2], lat: 10, lon: 200 },
  pluto: { g: 0.62, atm: 1e-5, crater: 0.6, rough: 4, tex: 'pluto.jpg', light: 0.35, rock: [0.75, 0.68, 0.58], lat: 15, lon: 175, note: '스푸트니크 평원 가장자리' },
  jupiter: { g: 24.8, atm: 30, gas: 1, tex: 'jupiter.jpg', light: 0.5, sky: [0.75, 0.6, 0.45], hor: [0.85, 0.72, 0.55], fog: 9000, lat: -22, lon: 0, note: '대적점 근처 구름 바다' },
  saturn: { g: 10.4, atm: 30, gas: 1, tex: 'saturn.jpg', light: 0.45, sky: [0.8, 0.72, 0.55], hor: [0.9, 0.82, 0.62], fog: 9000, lat: 20, lon: 0 },
  uranus: { g: 8.87, atm: 30, gas: 1, tex: 'uranus.jpg', light: 0.35, sky: [0.45, 0.75, 0.8], hor: [0.6, 0.85, 0.88], fog: 9000, lat: 0, lon: 0 },
  neptune: { g: 11.15, atm: 30, gas: 1, tex: 'neptune.jpg', light: 0.3, sky: [0.15, 0.3, 0.75], hor: [0.3, 0.45, 0.85], fog: 9000, lat: 0, lon: 0 },
};

function h2(ix, iz, s) {
  let h = Math.imul(ix ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(iz + s * 7919, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = h2(xi, zi, 1), b = h2(xi + 1, zi, 1), c = h2(xi, zi + 1, 1), d = h2(xi + 1, zi + 1, 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
async function imageData(url, W, H) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url);
  const bmp = await createImageBitmap(await res.blob());
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, W, H);
  return { d: g.getImageData(0, 0, W, H).data, W, H };
}
function sampleImg(I, u, v, ch = -1) {
  if (!I) return null;
  u = ((u % 1) + 1) % 1; v = Math.min(0.999, Math.max(0, v));
  const x = u * I.W - 0.5, y = v * I.H - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const px = (xx, yy) => { xx = ((xx % I.W) + I.W) % I.W; yy = Math.min(I.H - 1, Math.max(0, yy)); return (yy * I.W + xx) * 4; };
  const a = px(x0, y0), b = px(x0 + 1, y0), c = px(x0, y0 + 1), d = px(x0 + 1, y0 + 1);
  const mix = (k) => (I.d[a + k] * (1 - fx) + I.d[b + k] * fx) * (1 - fy) + (I.d[c + k] * (1 - fx) + I.d[d + k] * fx) * fy;
  if (ch >= 0) return mix(ch) / 255;
  return [mix(0) / 255, mix(1) / 255, mix(2) / 255];
}

const SKY_VS = 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const SKY_FS = /* glsl */`
uniform vec3 uZen, uHor, uSun; uniform float uI, uA;
varying vec3 vD;
void main() {
  float h = clamp(vD.y, -0.2, 1.0);
  vec3 c = mix(uHor, uZen, pow(max(h, 0.0), 0.5));
  float mu = max(dot(vD, uSun), 0.0);
  c += uHor * pow(mu, 8.0) * 0.6 + vec3(1.0, 0.9, 0.75) * pow(mu, 300.0) * 3.0;
  gl_FragColor = vec4(c * uI, uA);
}`;
// 가스 행성 구름 바다: 흐르는 띠 + 뭉게 구름
const CLOUD_FS = /* glsl */`
uniform float uTime; uniform vec3 uA, uB; uniform vec3 uSun;
varying vec3 vW;
float hh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
void main() {
  vec2 p = vW.xz * 0.0006 + vec2(uTime * 0.004, 0.0);
  float band = 0.5 + 0.5 * sin(vW.z * 0.0004 + fbm(p * 0.5) * 4.0);
  float c = fbm(p * 3.0 + vec2(0.0, uTime * 0.01));
  vec3 col = mix(uA, uB, band) * (0.4 + 1.2 * c);
  col *= 0.85 + 0.3 * fbm(vW.xz * 0.004);
  float lit = 0.45 + 0.7 * max(uSun.y, 0.0);
  // 멀리 갈수록 연무 (지평선 색)
  float d = length(vW.xz - cameraPosition.xz);
  col = mix(col, uB, 1.0 - exp(-d / 22000.0));
  gl_FragColor = vec4(col * lit, 1.0);
}`;

export class PlanetSurface {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.base = opts.base || './assets/';
    this.group = new THREE.Group(); this.group.name = 'planetSurface'; this.group.visible = false;
    scene.add(this.group);
    this.id = null; this.info = null;
    this.N = opts.quality === 'low' ? 64 : 96;
    this.uCurv = { value: 0 };
    this.uOrig = { value: new THREE.Vector3() };
    // 지형 4단계 (간격 3 m · 20 m · 140 m · 1 km → 폭 288 m ~ 96 km). 바깥 단계는 안쪽 단계가 덮는 곳을 그리지 않음
    this.levels = [3, 20, 140, 1000].map((sp, i) => {
      const g = new THREE.PlaneGeometry(1, 1, this.N, this.N); g.rotateX(-Math.PI / 2);
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
      const L = { sp, cx: 1e12, cz: 1e12, hole: { value: new THREE.Vector4(0, 0, -1, 0) } };
      const m = new THREE.Mesh(g, this._mat(L.hole));
      m.receiveShadow = true; m.castShadow = i < 2; m.frustumCulled = false;
      this.group.add(m);
      L.mesh = m;
      return L;
    });
    this.skyU = { uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uI: { value: 1 }, uA: { value: 1 } };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(60000, 32, 16), new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false, transparent: true }));
    this.sky.renderOrder = -900; this.sky.frustumCulled = false;
    this.group.add(this.sky);
    this.cloudU = { uTime: { value: 0 }, uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) } };
    const cg = new THREE.PlaneGeometry(120000, 120000, 1, 1); cg.rotateX(-Math.PI / 2);
    this.clouds = new THREE.Mesh(cg, new THREE.ShaderMaterial({ vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }', fragmentShader: CLOUD_FS, uniforms: this.cloudU, side: THREE.DoubleSide, fog: false }));
    this.clouds.frustumCulled = false;
    this.group.add(this.clouds);
    this.time = 0;
  }

  _mat(hole) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uCurv = this.uCurv; sh.uniforms.uOrig = this.uOrig; sh.uniforms.uHole = hole;
      // 둥근 천체: 카메라에서 멀수록 지평선 아래로 (d²/2R)
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPW;\nuniform float uCurv;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{ vec4 wp = modelMatrix * vec4(transformed, 1.0); vPW = wp.xyz;
  vec2 dd = wp.xz - cameraPosition.xz; transformed.y -= dot(dd, dd) * uCurv; }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vPW;
uniform vec3 uOrig; uniform vec4 uHole;
float ph(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(ph(i), ph(i + vec2(1, 0)), f.x), mix(ph(i + vec2(0, 1)), ph(i + vec2(1, 1)), f.x), f.y); }`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (abs(vPW.x - uHole.x) < uHole.z && abs(vPW.z - uHole.y) < uHole.z) discard;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{ vec2 q = mod(vPW.xz + uOrig.xz, 4096.0);
  float d = pn(q * 0.9) * 0.5 + pn(q * 4.1) * 0.3 + pn(q * 17.0) * 0.2;
  float fw = length(fwidth(q));
  diffuseColor.rgb *= mix(0.78 + 0.44 * d, 1.0, smoothstep(0.5, 3.0, fw)); }`);
    };
    return m;
  }

  /** 들어갈 천체 준비 (텍스처 픽셀은 비동기로) */
  enter(id, body, lat, lon) {
    this.id = id;
    this.body = body;
    this.info = SURF[id] || { g: 3, atm: 0, crater: 0.6, rough: 3, light: 0.5, rock: [0.5, 0.5, 0.5] };
    this.R = body.radius;
    this.lat0 = lat * D2R; this.lon0 = lon * D2R;
    this.img = null; this.topo = null;
    for (const L of this.levels) L.cx = 1e12;
    const I = this.info;
    const load = async () => {
      try {
        if (I.tex) this.img = await imageData(this.base + I.tex, 1024, 512);
        if (I.topo) this.topo = await imageData(this.base + I.topo, 1024, 512);
        this.h0 = 0; this.h0 = this.heightAt(0, 0);
        for (const L of this.levels) L.cx = 1e12;
      } catch (e) { console.warn('[planet] 지도 텍스처 없음', e); }
    };
    this.h0 = 0;
    this.ready = load();
    this.group.visible = true;
    this.sky.visible = !!I.sky;
    this.clouds.visible = !!I.gas;
    for (const L of this.levels) L.mesh.visible = !I.gas;
    if (I.sky) { this.skyU.uZen.value.setRGB(...I.sky.map((v) => Math.pow(v, 2.2) * 0.55)); this.skyU.uHor.value.setRGB(...I.hor.map((v) => Math.pow(v, 2.2) * 0.6)); }
    if (I.gas) {
      const a = I.sky, b = I.hor;
      this.cloudU.uA.value.setRGB(a[0] * 0.9, a[1] * 0.85, a[2] * 0.8); this.cloudU.uB.value.setRGB(b[0], b[1], b[2]);
    }
  }
  leave() { this.id = null; this.group.visible = false; }

  // 지역 (x, z) → 위도·경도 (rad)
  _ll(x, z) {
    const lat = this.lat0 - z / this.R;
    const lon = this.lon0 + x / (this.R * Math.max(0.05, Math.cos(this.lat0)));
    return [lat, lon];
  }

  /** 표면 높이 (m, 착륙 지점 ≈ 0) */
  heightAt(x, z) {
    const I = this.info;
    if (!I || I.gas) return -2500;            // 구름 아래 '바닥' (압력 한계)
    let h = 0;
    if (this.topo) {
      const [lat, lon] = this._ll(x, z);
      h += (sampleImg(this.topo, lon / (2 * Math.PI) + 0.5, 0.5 - lat / Math.PI, 0) - 0.5) * I.topoK;
    }
    // 운석구덩이: 큰 것부터 작은 것까지 (셀마다 하나 있을 수도)
    if (I.crater > 0) {
      for (const [cell, p, k] of [[2600, 0.35, 0.13], [700, 0.45, 0.16], [180, 0.55, 0.18], [45, 0.6, 0.2], [11, 0.5, 0.2]]) {
        const ix = Math.floor(x / cell), iz = Math.floor(z / cell);
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
          const cx = ix + i, cz = iz + j;
          if (h2(cx, cz, cell) > p * I.crater) continue;
          const r = cell * (0.18 + 0.3 * h2(cx, cz, cell + 1));
          const px = (cx + 0.2 + 0.6 * h2(cx, cz, cell + 2)) * cell, pz = (cz + 0.2 + 0.6 * h2(cx, cz, cell + 3)) * cell;
          const d = Math.hypot(x - px, z - pz) / r;
          if (d > 2.2) continue;
          const depth = r * k;
          if (d < 1) h -= depth * (1 - d * d);
          h += depth * 0.4 * Math.exp(-((d - 1) * (d - 1)) / 0.06) + (d < 1.6 && d > 1 ? depth * 0.12 * (1.6 - d) : 0);
        }
      }
    }
    // 모래 언덕 (화성·타이탄)
    if (I.dunes) {
      const w = vnoise(x / 900, z / 900);
      h += Math.pow(Math.abs(Math.sin((x * 0.8 + z * 0.6) / 22 + vnoise(x / 140, z / 140) * 6)), 1.6) * 2.2 * w;
    }
    // 유로파: 얼음 균열 능선
    if (I.cracks) h += Math.max(0, 1 - Math.abs(Math.sin(x / 380 + vnoise(x / 600, z / 600) * 5)) * 30) * 4;
    // 잔기복
    h += (vnoise(x / 260, z / 260) - 0.5) * I.rough * 5 + (vnoise(x / 47, z / 47) - 0.5) * I.rough + (vnoise(x / 9, z / 9) - 0.5) * I.rough * 0.25;
    return h - (this.h0 || 0);
  }
  _color(x, z, out) {
    const I = this.info;
    let c = null;
    if (this.img) { const [lat, lon] = this._ll(x, z); c = sampleImg(this.img, lon / (2 * Math.PI) + 0.5, 0.5 - lat / Math.PI); }
    if (!c) {
      const a = I.col || I.rock, b = I.col2 || a, t = vnoise(x / 700, z / 700);
      c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
    // sRGB 지도 → 선형
    out[0] = Math.pow(c[0], 2.2); out[1] = Math.pow(c[1], 2.2); out[2] = Math.pow(c[2], 2.2);
    if (this.id === 'venus') { out[0] = 0.12; out[1] = 0.075; out[2] = 0.04; }
    return out;
  }
  /** ground.js 가 쓰는 표본 (바위만) */
  sample(x, z) {
    const S = this._S || (this._S = { h: 0, urban: 0, forest: 0, park: 0, rock: 0.55, level: -1e9, sea: 0 });
    S.h = this.heightAt(x, z);
    S.rock = this.info && this.info.gas ? 0 : 0.42;
    return S;
  }

  update(dt, camLocal, sunLocal) {
    if (!this.id) return;
    this.time += dt;
    this.group.position.set(0, 0, 0);
    this.uOrig.value.copy(origin);
    this.uCurv.value = 0.5 / this.R;
    this.sky.position.set(camLocal.x - origin.x, camLocal.y - origin.y, camLocal.z - origin.z);
    this.skyU.uSun.value.copy(sunLocal);
    const day = Math.min(1, Math.max(0, (sunLocal.y + 0.1) / 0.25));
    this.skyU.uI.value = 0.06 + 0.94 * day;
    this.skyU.uA.value = this.info.atm >= 1 ? 1 : 0.15 + 0.8 * day;
    this.cloudU.uTime.value = this.time; this.cloudU.uSun.value.copy(sunLocal);
    this.clouds.position.set(camLocal.x - origin.x, -origin.y, camLocal.z - origin.z);
    if (this.info.gas) return;
    const col = [0, 0, 0];
    for (let i = 0; i < this.levels.length; i++) {
      const L = this.levels[i];
      L.mesh.position.set(L.cx - origin.x, -origin.y, L.cz - origin.z);
      const inner = this.levels[i - 1];
      if (inner) L.hole.value.set(inner.cx - origin.x, inner.cz - origin.z, inner.sp * this.N * 0.5 * 0.9, 0);
    }
    for (const L of this.levels) {
      const step = L.sp, half = step * this.N / 2;
      const cx = Math.round(camLocal.x / (step * 8)) * step * 8, cz = Math.round(camLocal.z / (step * 8)) * step * 8;
      if (Math.abs(cx - L.cx) < 1e-6 && Math.abs(cz - L.cz) < 1e-6) continue;
      L.cx = cx; L.cz = cz;
      const g = L.mesh.geometry, P = g.attributes.position, C = g.attributes.color;
      const n1 = this.N + 1;
      for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) {
        const k = j * n1 + i;
        const x = cx - half + i * step, z = cz - half + j * step;
        P.setXYZ(k, x - cx, this.heightAt(x, z), z - cz);
        this._color(x, z, col);
        C.setXYZ(k, col[0], col[1], col[2]);
      }
      P.needsUpdate = true; C.needsUpdate = true;
      g.computeVertexNormals();
      g.computeBoundingSphere();
      L.mesh.position.set(cx - origin.x, -origin.y, cz - origin.z);
      const k2 = this.levels.indexOf(L), outer = this.levels[k2 + 1];
      if (outer) outer.hole.value.set(cx - origin.x, cz - origin.z, step * this.N * 0.5 * 0.9, 0);
      break;    // 한 프레임에 한 단계만 (끊김 방지)
    }
  }
}
