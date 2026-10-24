// SKY BLADE — 실제 서울 도로·철도·가로 시설
//  - Overture(OSM) 도로 조각을 지형 위에 리본으로 깔고, 셰이더로 차선·중앙선(노란 겹선)·정지선 없는 교차로·보도블록·연석·자전거길을 그림
//  - 다리·고가(플래그/층)는 갑판 높이 단면을 계산해 도시(city.js)의 회전 박스(상판·난간·교각)로 넣음 → 밟고, 부수고, 뚫을 수 있음
//  - 카메라 주변 300 m 타일만 만들고 멀어지면 버림 (멀리 보이는 도로망은 지형 셰이더가 15 m 격자로 칠함)
//  - 가로등(실제 위치 + 간선도로 30 m 간격), 신호등(실제 위치, 불이 바뀜), 횡단보도(실제 위치), 버스정류장, 벤치, 송전탑, 지하철역 입구(역 이름)
//  - 가로수: 실제 나무 + 간선도로 보도 9 m 간격 (trees.js 에 넘김)
//  - 자동차·사람이 다닐 도로 그래프 (노드 = Overture 커넥터)
import * as THREE from 'three';
import { origin } from './frame.js';
import { T_BRIDGE } from './city.js';
import { GH_U, GH_GLSL } from './holes.js';

const TILE = 300;
const SEG_MAX = 50;                          // 긴 직선은 이 길이로 잘라 둠 (타일 소속·지형 따라가기)
// 분류: 0 고속도로, 1 도시고속, 2 주간선, 3 보조간선, 4 집산, 5 주거, 6 생활, 7 미분류, 8 진입로, 9 보행광장, 10 보도, 11 오솔길, 12 계단, 13 자전거, 14 농로
const SIDEWALK = [0, 3.0, 3.5, 3.0, 2.5, 1.2, 0, 0.8, 0, 0, 0, 0, 0, 0, 0];
const ONEWAY = [1, 1, 1, 0, 0, 0, 0, 0, 0];   // 간선은 OSM 에서 대개 상하행이 따로 그려짐
const CAR = (c) => c <= 8;
const _v = new THREE.Vector3();

// ───────── 노면 셰이더 ─────────
const ROAD_VS = /* glsl */`
attribute vec4 aRd;     // 가로(m, 부호), 세로(m), 조각 길이, 차도 반폭
attribute vec4 aRk;     // 분류 (철도는 100+), 보도 폭, 플래그 (1 시작 교차로, 2 끝 교차로, 4 다리), 차로 수
varying vec4 vRd;
varying vec4 vRk;
`;
const ROAD_FS_PARS = /* glsl */`
varying vec4 vRd;
varying vec4 vRk;
float rH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rH(i), rH(i + vec2(1, 0)), f.x), mix(rH(i + vec2(0, 1)), rH(i + vec2(1, 1)), f.x), f.y); }
float rBand(float d, float hw, float fw) { return 1.0 - smoothstep(hw - fw, hw + fw, d); }
`;
const ROAD_FS = /* glsl */`
{
  float ac = vRd.x, s = vRd.y, L = vRd.z, hw = vRd.w;
  float cls = vRk.x, sw = vRk.y, fl = vRk.z, lanes = vRk.w;
  float fwA = max(fwidth(ac), 1e-3), fwS = max(fwidth(s), 1e-3);
  float fw = max(fwA, fwS);
  vec2 q = vec2(ac, mod(s, 1000.0));
  float nz = rN(q * vec2(0.6, 0.25)) * 0.6 + rN(q * 3.1) * 0.4;
  float near = 1.0 - smoothstep(0.03, 0.25, fw);
  vec3 col; float rough = 0.9;
  float aa = abs(ac);
  if (cls >= 99.5) {
    // 철도: 자갈 + 침목 + 레일 두 줄 (표준궤 1.435 m)
    col = vec3(0.16, 0.145, 0.13) * (0.8 + 0.4 * nz);
    float sl = rBand(abs(fract(s / 0.6) - 0.5) * 0.6, 0.12, fwS) * rBand(aa, 1.25, fwA);
    col = mix(col, vec3(0.13, 0.11, 0.09), sl * 0.9);
    float rl = rBand(abs(aa - 0.72), 0.04, fwA);
    col = mix(col, vec3(0.5, 0.5, 0.52), rl);
    rough = mix(0.95, 0.3, rl);
  } else if (aa > hw + 0.01 && sw > 0.0) {
    // 보도: 보도블록 (붉은 회색 엇갈림) + 연석
    vec2 b = vec2(ac * 5.0, s * 2.5 + floor(ac * 5.0) * 0.5);
    float tone = rH(floor(b));
    col = mix(vec3(0.17, 0.125, 0.11), vec3(0.19, 0.185, 0.175), step(0.35, tone)) * (0.85 + 0.25 * nz);
    vec2 g = abs(fract(b) - 0.5);
    col *= 1.0 - 0.25 * near * rBand(min(g.x / 5.0, g.y / 2.5), 0.012, fw);
    float curb = rBand(aa - hw, 0.22, fwA);
    col = mix(col, vec3(0.28, 0.275, 0.26) * (0.9 + 0.2 * nz), curb);
    // 시각장애인 유도 블록 (노란 줄)
    col = mix(col, vec3(0.5, 0.36, 0.03), rBand(abs(aa - hw - sw * 0.55), 0.15, fwA) * step(0.5, fract(s / 30.0)) * 0.9);
  } else if (cls > 8.5) {
    if (cls < 10.5) {        // 보행광장 · 보도
      vec2 b = vec2(ac * 4.0, s * 4.0);
      col = mix(vec3(0.17, 0.158, 0.145), vec3(0.14, 0.128, 0.12), step(0.5, rH(floor(b)))) * (0.85 + 0.3 * nz);
      vec2 g = abs(fract(b) - 0.5);
      col *= 1.0 - 0.2 * near * rBand(min(g.x, g.y) / 4.0, 0.01, fw);
    } else if (cls < 11.5 || cls > 13.5) {   // 오솔길 · 농로: 흙
      col = vec3(0.17, 0.13, 0.09) * (0.75 + 0.5 * nz);
      if (cls > 13.5) col *= 1.0 - 0.25 * rBand(abs(aa - 0.8), 0.25, fwA);
    } else if (cls < 12.5) { // 계단
      col = vec3(0.3, 0.29, 0.28) * (0.85 + 0.2 * nz) * (0.8 + 0.2 * step(0.15, fract(s / 0.32)));
    } else {                 // 자전거길: 적색 포장 + 흰 가장자리
      col = vec3(0.17, 0.065, 0.05) * (0.85 + 0.3 * nz);
      col = mix(col, vec3(0.6), rBand(hw - aa - 0.12, 0.06, fwA));
      col = mix(col, vec3(0.62, 0.55, 0.1), rBand(aa, 0.05, fwA) * step(0.5, fract(s / 4.0)));
    }
  } else {
    // 차도: 아스팔트 (덧씌운 자국, 바퀴 자국 광택)
    col = vec3(0.052, 0.052, 0.056) * (0.75 + 0.5 * nz);
    float ptch = smoothstep(0.62, 0.66, rN(q * vec2(0.08, 0.04) + 7.0));
    col = mix(col, vec3(0.085, 0.085, 0.09), ptch * 0.7);
    float lw = hw / max(lanes, 1.0);
    float wheel = rBand(abs(fract((aa) / max(lw, 1.0)) - 0.5) * lw - 0.9, 0.35, fwA);
    rough = 0.82 - 0.12 * wheel;
    // 교차로 안쪽엔 차선 없음
    float trimS = mod(fl, 2.0) > 0.5 ? min(hw + 6.0, 20.0) : 0.0;
    float trimE = mod(floor(fl / 2.0), 2.0) > 0.5 ? min(hw + 6.0, 20.0) : 0.0;
    float mk = step(trimS, s) * step(trimE, L - s) * (1.0 - smoothstep(0.08, 0.5, fw));
    vec3 white = vec3(0.62, 0.62, 0.6), yellow = vec3(0.62, 0.42, 0.05);
    float edge = rBand(abs(aa - (hw - 0.35)), 0.075, fwA);
    float dash = step(fract(s / 12.0), 0.42);
    float lane = 0.0;
    if (cls < 2.5 || lanes > 5.5) {
      // 일방 (간선 한쪽 방향): 전체 폭을 차로로 나눔
      float n = max(1.0, floor(2.0 * hw / 3.3 + 0.4));
      float w = 2.0 * hw / n;
      float x = ac + hw;
      float k = abs(fract(x / w + 0.5) - 0.5) * w;
      lane = rBand(k, 0.075, fwA) * dash * step(0.5, x) * step(x, 2.0 * hw - 0.5);
      col = mix(col, white, max(edge, lane) * mk);
    } else if (cls < 6.5 && hw > 2.6) {
      // 양방향: 노란 중앙 겹선 + 흰 차선
      float cen = rBand(abs(aa - 0.16), 0.07, fwA);
      float n = max(1.0, floor(hw / 3.2));
      float w = hw / n;
      float k = abs(fract(aa / w + 0.5) - 0.5) * w;
      lane = rBand(k, 0.075, fwA) * dash * step(w * 0.5, aa) * step(aa, hw - w * 0.5);
      col = mix(col, yellow, cen * mk);
      col = mix(col, white, max(edge * step(4.0, hw), lane) * mk);
    } else if (cls < 7.5) {
      col = mix(col, white, rBand(abs(aa - 0.0), 0.06, fwA) * dash * mk * step(2.2, hw) * 0.8);
    }
  }
  diffuseColor.rgb = col;
  fRoadRough = rough;
}
`;
function roadMaterial(offset) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -offset });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, GH_U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + ROAD_VS + '\nvarying vec3 vRW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRd = aRd; vRk = aRk; vRW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + ROAD_FS_PARS + 'float fRoadRough = 0.9;\nvarying vec3 vRW;\n' + GH_GLSL)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (uGHN > 0.5 && gHole(vRW)) discard;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + ROAD_FS)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fRoadRough;');
  };
  m.customProgramCacheKey = () => 'sky-road';
  return m;
}

// 횡단보도: 도로 방향과 나란한 흰 막대 (폭 0.45 m, 0.9 m 간격)
const CROSS_FS = /* glsl */`
varying vec2 vC;
void main() {
  float fw = max(fwidth(vC.x), 1e-3);
  float b = 1.0 - smoothstep(0.24 - fw, 0.24 + fw, abs(fract(vC.x / 0.9) - 0.5) * 0.9);
  if (b < 0.02) discard;
  gl_FragColor = vec4(vec3(0.62, 0.62, 0.6), b);
}`;

// ───────── 소품 지오메트리 ─────────
function merged(parts) {
  const gs = parts.map(([g, color]) => {
    const gg = g.index ? g.toNonIndexed() : g;
    gg.setAttribute('color', new THREE.BufferAttribute(expand(new THREE.Color(color), gg.attributes.position.count), 3));
    return gg;
  });
  let n = 0;
  for (const g of gs) n += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'color']) {
    const a = new Float32Array(n * 3);
    let o = 0;
    for (const g of gs) { a.set(g.attributes[k].array, o); o += g.attributes[k].array.length; }
    out.setAttribute(k, new THREE.BufferAttribute(a, 3));
  }
  return out;
}
function expand(col, n) { const c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; } return c; }
const box = (w, h, d, x, y, z, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); return g; };
const cyl = (r0, r1, h, x, y, z, seg = 8) => { const g = new THREE.CylinderGeometry(r0, r1, h, seg); g.translate(x, y, z); return g; };
// 모든 소품은 +Z 가 도로 쪽
function lampGeo() {
  const arm = new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6); arm.rotateX(Math.PI / 2 - 0.12); arm.translate(0, 9.6, 1.15);
  return merged([[cyl(0.09, 0.14, 9.8, 0, 4.9, 0), 0x6d7378], [arm, 0x6d7378], [box(0.42, 0.14, 0.9, 0, 9.72, 2.35), 0x50565a], [box(0.36, 0.04, 0.8, 0, 9.63, 2.35), 0xfff2c8]]);
}
function signalGeo() {
  const arm = box(0.14, 0.14, 7.2, 0, 6.2, 3.5);
  const parts = [[cyl(0.12, 0.16, 6.4, 0, 3.2, 0), 0xb5b9bd], [arm, 0xb5b9bd], [box(0.36, 0.42, 1.25, 0, 5.8, 5.6), 0x1b1e21]];
  return merged(parts);
}
function busStopGeo() {
  return merged([[box(4.2, 0.12, 1.7, 0, 2.6, -0.2), 0x3a4048], [box(0.08, 2.5, 0.08, -2.0, 1.25, -0.9), 0x7a8086], [box(0.08, 2.5, 0.08, 2.0, 1.25, -0.9), 0x7a8086],
    [box(4.0, 1.9, 0.04, 0, 1.25, -1.0), 0x9ec2d4], [box(3.6, 0.1, 0.45, 0, 0.48, -0.75), 0x6b5a45], [cyl(0.05, 0.05, 3.0, 2.6, 1.5, 0.2, 6), 0x7a8086], [box(0.6, 0.5, 0.05, 2.6, 2.75, 0.2), 0x1f5fb5]]);
}
function benchGeo() { return merged([[box(1.8, 0.08, 0.45, 0, 0.45, 0), 0x7a5a3a], [box(1.8, 0.4, 0.06, 0, 0.7, -0.22), 0x7a5a3a], [box(0.08, 0.45, 0.4, -0.8, 0.22, 0), 0x333333], [box(0.08, 0.45, 0.4, 0.8, 0.22, 0), 0x333333]]); }
function towerGeo() {
  // 송전탑 (격자 철탑 근사): 네 다리 + 가로대 + 팔
  const P = [];
  const leg = (x, z) => { const g = new THREE.CylinderGeometry(0.18, 0.28, 44, 4); const t = Math.atan2(Math.hypot(x, z) - 1.2, 44); g.translate(0, 22, 0); const m = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(z, 0, -x).normalize(), -t); g.applyMatrix4(m); g.translate(x, 0, z); return g; };
  for (const [x, z] of [[4, 4], [-4, 4], [4, -4], [-4, -4]]) P.push([leg(x, z), 0x8d9296]);
  for (const y of [12, 24, 34]) { const s = 4 * (1 - y / 52); P.push([box(s * 2, 0.25, 0.25, 0, y, s), 0x8d9296], [box(s * 2, 0.25, 0.25, 0, y, -s), 0x8d9296], [box(0.25, 0.25, s * 2, s, y, 0), 0x8d9296], [box(0.25, 0.25, s * 2, -s, y, 0), 0x8d9296]); }
  for (const y of [30, 37, 43]) P.push([box(16, 0.5, 0.6, 0, y, 0), 0x8d9296]);
  P.push([cyl(0.1, 0.5, 4, 0, 46, 0, 4), 0x8d9296]);
  return merged(P);
}
function stationGeo() {
  // 지하철 출입구: 유리 지붕 + 계단 벽 + 초록 표지
  return merged([[box(3.4, 0.15, 7, 0, 3.1, 0), 0x2c5e3a], [box(0.15, 3.1, 7, -1.65, 1.55, 0), 0xa9c6c9], [box(0.15, 3.1, 7, 1.65, 1.55, 0), 0xa9c6c9],
    [box(3.4, 1.0, 0.15, 0, 2.5, -3.45), 0xa9c6c9], [box(1.2, 0.5, 0.12, 0, 3.6, 3.4), 0x1f8a3a], [box(3.0, 0.3, 6.6, 0, 0.1, 0), 0x404448]]);
}
function propMat() { return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.35 }); }

function label(text) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = '700 44px system-ui, "Noto Sans KR", sans-serif';
  const w = Math.ceil(g.measureText(text).width) + 40;
  c.width = w; c.height = 72;
  g.font = '700 44px system-ui, "Noto Sans KR", sans-serif';
  g.fillStyle = 'rgba(20,90,50,0.92)'; g.beginPath(); g.roundRect(0, 0, w, 72, 16); g.fill();
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, 20, 38);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
  s.scale.set(w / 72 * 2.2, 2.2, 1);
  return s;
}

export class Roads {
  /**
   * data: { roads, rails, points } (seoul.js), game: { heightAt, waterLevelAt }
   */
  constructor(scene, data, game, opts = {}) {
    this.scene = scene; this.game = game;
    this.low = opts.quality === 'low';
    this.R = opts.radius || 2000;
    this.group = new THREE.Group(); this.group.name = 'roads';
    scene.add(this.group);
    this.mats = [roadMaterial(2), roadMaterial(4), roadMaterial(6)];
    this.crossMat = new THREE.ShaderMaterial({ vertexShader: 'attribute vec2 aC; varying vec2 vC; void main(){ vC = aC; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: CROSS_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -10 });
    this.crossMat.extensions = { derivatives: true };
    this.propGeo = { lamp: lampGeo(), signal: signalGeo(), bus: busStopGeo(), bench: benchGeo(), tower: towerGeo(), station: stationGeo() };
    this.propMat = propMat();
    // 신호등 불빛: 위상에 따라 빨강/노랑/초록 (셰이더에서 시간으로)
    this.sigUni = { uTime: { value: 0 } };
    this.sigMat = new THREE.ShaderMaterial({
      uniforms: this.sigUni,
      vertexShader: 'attribute float aPh; attribute float aK; varying float vPh; varying float vK; void main(){ vPh = aPh; vK = aK; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uTime; varying float vPh; varying float vK;
        void main(){ float t = mod(uTime + vPh, 60.0); float st = t < 27.0 ? 2.0 : t < 30.0 ? 1.0 : 0.0;   // 0 빨강 1 노랑 2 초록
          float on = abs(vK - st) < 0.5 ? 1.0 : 0.06;
          vec3 c = vK < 0.5 ? vec3(4.0, 0.25, 0.15) : vK < 1.5 ? vec3(4.0, 2.4, 0.2) : vec3(0.2, 3.2, 1.6);
          gl_FragColor = vec4(c * on, 1.0); }`,
    });
    this.lightGeo = new THREE.CircleGeometry(0.13, 10);
    this.tiles = new Map();
    this._prepare(data);
  }

  /** 신호 위상 (life.js 와 같게): 0 빨강, 1 노랑, 2 초록 — 위상은 신호등마다 */
  signalState(ph, time) { const t = ((time + ph) % 60 + 60) % 60; return t < 27 ? 2 : t < 30 ? 1 : 0; }

  _prepare(D) {
    const T = this.game;
    const R = D.roads;
    // 1) 긴 선분 쪼개기 → 새 점 배열
    const split = (L) => {
      const pts = [], start = new Uint32Array(L.n + 1);
      for (let i = 0; i < L.n; i++) {
        start[i] = pts.length / 2;
        for (let k = L.start[i]; k < L.start[i + 1]; k++) {
          const x = L.pts[k * 2], z = L.pts[k * 2 + 1];
          if (k > L.start[i]) {
            const px = L.pts[k * 2 - 2], pz = L.pts[k * 2 - 1], d = Math.hypot(x - px, z - pz);
            const m = Math.ceil(d / SEG_MAX);
            for (let j = 1; j < m; j++) pts.push(px + (x - px) * j / m, pz + (z - pz) * j / m);
          }
          pts.push(x, z);
        }
      }
      start[L.n] = pts.length / 2;
      L.pts = new Float64Array(pts); L.start = start;
    };
    split(R);
    if (D.rails) split(D.rails);
    this.roads = R; this.rails = D.rails; this.points = D.points;
    // 2) 노드 차수 (교차로 판별) + 그래프 (차 다니는 길)
    let maxN = 0;
    for (let i = 0; i < R.n; i++) maxN = Math.max(maxN, R.na[i], R.nb[i]);
    const deg = new Uint8Array(maxN + 1);
    for (let i = 0; i < R.n; i++) { if (deg[R.na[i]] < 250) deg[R.na[i]]++; if (deg[R.nb[i]] < 250) deg[R.nb[i]]++; }
    this.deg = deg;
    // 3) 조각 길이
    const len = (L) => { const out = new Float32Array(L.n); for (let i = 0; i < L.n; i++) { let s = 0; for (let k = L.start[i] + 1; k < L.start[i + 1]; k++) s += Math.hypot(L.pts[k * 2] - L.pts[k * 2 - 2], L.pts[k * 2 + 1] - L.pts[k * 2 - 1]); out[i] = s; } return out; };
    R.len = len(R); if (D.rails) D.rails.len = len(D.rails);
    // 4) 다리·고가 갑판 높이 (점마다): 이어진 다리 조각을 한 덩어리로 묶어 양쪽 교대(지면과 만나는 곳)를 기준으로 계산
    this.deck = new Map();
    this.boxes = [];
    const isDeck = (L, i, rail) => {
      const fl = L.flags[i], lv = L.level[i];
      if (fl & 2 || lv < 0) return -1;                                  // 터널·지하
      if (fl & 1) return rail || L.cls[i] <= 13 ? 1 : 0;                // 다리
      if (lv >= 1 && (rail || L.cls[i] <= 7)) return 1;                 // 고가 (건물 안 층 보도는 제외)
      return 0;
    };
    const decks = (L, rail) => {
      const kind = new Int8Array(L.n);
      const byNode = new Map();
      for (let i = 0; i < L.n; i++) {
        kind[i] = isDeck(L, i, rail);
        if (kind[i] === -1) L.flags[i] |= 2;
        for (const nd of [L.na[i], L.nb[i]]) { let a = byNode.get(nd); if (!a) { a = []; byNode.set(nd, a); } a.push(i); }
      }
      // 묶기 (BFS)
      const grp = new Int32Array(L.n).fill(-1);
      let ng = 0;
      for (let i = 0; i < L.n; i++) {
        if (kind[i] !== 1 || grp[i] >= 0) continue;
        const members = [], abut = [];
        const q = [i]; grp[i] = ng;
        while (q.length) {
          const c = q.pop(); members.push(c);
          for (const [nd, end] of [[L.na[c], L.start[c]], [L.nb[c], L.start[c + 1] - 1]]) {
            let ground = false;
            for (const o of byNode.get(nd)) {
              if (o === c) continue;
              if (kind[o] === 1) { if (grp[o] < 0) { grp[o] = ng; q.push(o); } }
              else ground = true;
            }
            if (ground || byNode.get(nd).length === 1) {
              const x = L.pts[end * 2], z = L.pts[end * 2 + 1];
              abut.push(x, z, T.heightAt(x, z));
            }
          }
        }
        ng++;
        this._deckGroup(L, members, abut, rail);
      }
    };
    decks(R, false);
    if (D.rails) decks(D.rails, true);
    // 5) 타일 색인: 선분 중점 기준 (도로·철도·시설점)
    this.index = new Map();
    const add = (key, v) => { let a = this.index.get(key); if (!a) { a = { segs: [], rsegs: [], pts: [] }; this.index.set(key, a); } return a; };
    const tk = (x, z) => Math.floor(x / TILE) * 100000 + Math.floor(z / TILE);
    for (let i = 0; i < R.n; i++) for (let k = R.start[i]; k < R.start[i + 1] - 1; k++) {
      add(tk((R.pts[k * 2] + R.pts[k * 2 + 2]) / 2, (R.pts[k * 2 + 1] + R.pts[k * 2 + 3]) / 2)).segs.push(i, k);
    }
    if (D.rails) { const L = D.rails; for (let i = 0; i < L.n; i++) for (let k = L.start[i]; k < L.start[i + 1] - 1; k++) add(tk((L.pts[k * 2] + L.pts[k * 2 + 2]) / 2, (L.pts[k * 2 + 1] + L.pts[k * 2 + 3]) / 2)).rsegs.push(i, k); }
    if (D.points) { const P = D.points; for (let i = 0; i < P.n; i++) add(tk(P.x[i], P.z[i])).pts.push(i); }
    // 6) 그래프: 노드 → 이어진 조각들 (차도)
    this.adj = new Map();
    for (let i = 0; i < R.n; i++) {
      if (!CAR(R.cls[i])) continue;
      for (const nd of [R.na[i], R.nb[i]]) { let a = this.adj.get(nd); if (!a) { a = []; this.adj.set(nd, a); } a.push(i); }
    }
    this.tk = tk;
  }

  _deckGroup(L, members, abut, rail) {
    const T = this.game;
    const na = abut.length / 3;
    for (const i of members) {
      const a = L.start[i], b = L.start[i + 1], n = b - a;
      const H = new Float32Array(n);
      const lv = Math.max(0, L.level[i]), bridge = L.flags[i] & 1;
      for (let k = 0; k < n; k++) {
        const x = L.pts[(a + k) * 2], z = L.pts[(a + k) * 2 + 1];
        // 교대 높이를 거리 역제곱으로 섞은 기준 높이 + 교대에서 멀어질수록 필요한 여유 높이
        let ws = 0, hs = 0, dmin = 1e9;
        for (let j = 0; j < na; j++) {
          const d = Math.hypot(x - abut[j * 3], z - abut[j * 3 + 1]);
          dmin = Math.min(dmin, d);
          const w = 1 / (d * d + 1);
          ws += w; hs += abut[j * 3 + 2] * w;
        }
        const g0 = T.heightAt(x, z), wl = T.waterLevelAt(x, z);
        const base = na ? hs / ws : g0;
        const ramp = na ? Math.min(1, dmin / 70) : 1;
        const clear = wl > -1e8 ? 13 : lv >= 1 ? 6.5 * lv : bridge ? 5.5 : 7.5;
        H[k] = Math.max(base, Math.max(g0, wl) + clear * ramp, g0 + 0.3);
      }
      this.deck.set((rail ? 1e7 : 0) + i, H);
      this._deckBoxes(L, i, H, rail);
    }
  }

  // 도시 박스: 상판 (25 m 단위), 난간 (차도만), 교각 (~38 m 간격)
  _deckBoxes(L, i, H, rail) {
    const T = this.game;
    const a = L.start[i], n = L.start[i + 1] - a;
    const ped = !rail && L.cls[i] >= 9;
    const hw = L.width[i] / 2 + (rail ? 0.6 : SIDEWALK[L.cls[i]] || 0);
    let acc = 19;
    for (let k = 0; k < n - 1; k++) {
      const x0 = L.pts[(a + k) * 2], z0 = L.pts[(a + k) * 2 + 1], x1 = L.pts[(a + k + 1) * 2], z1 = L.pts[(a + k + 1) * 2 + 1];
      const d = Math.hypot(x1 - x0, z1 - z0);
      if (d < 0.5) continue;
      const m = Math.max(1, Math.ceil(d / 25));
      const rot = Math.atan2(z1 - z0, x1 - x0) - Math.PI / 2;
      const c = Math.cos(rot), s2 = Math.sin(rot);
      for (let j = 0; j < m; j++) {
        const um = (j + 0.5) / m;
        const cx = x0 + (x1 - x0) * um, cz = z0 + (z1 - z0) * um;
        const yd = H[k] + (H[k + 1] - H[k]) * um;
        const g = T.heightAt(cx, cz);
        if (yd - g < 2.2) continue;                                   // 땅과 거의 붙은 곳은 상판 불필요
        const seg = d / m + 0.6, th = ped ? 0.8 : 1.6;
        this.boxes.push([T_BRIDGE, cx, cz, hw * 2 + 0.6, seg, th, rot, 0.4, 0, 0, yd - th - 0.02]);
        if (!ped) for (const side of [-1, 1]) this.boxes.push([T_BRIDGE, cx + c * side * (hw + 0.1), cz + s2 * side * (hw + 0.1), 0.35, seg, 1.05, rot, 0.45, 0, 0, yd - 0.02]);
        acc += d / m;
        if (acc > (rail ? 30 : 38)) {
          acc = 0;
          const ph = yd - th - g + 1;
          if (ph > 1.5) this.boxes.push([T_BRIDGE, cx, cz, Math.min(hw * 1.2, 9), ped ? 0.8 : 2.2, ph, rot, 0.3, 0, 0, g - 1]);
        }
      }
    }
  }

  /** 도시에 넣을 다리·고가 박스 [type, x, z, w, d, h, rot, seed, num, tint, baseY] */
  get bridgeBoxes() { return this.boxes; }

  // 조각 i 의 점 k 높이 (갑판 또는 지면)
  _y(L, i, k, x, z, hwSample, rail) {
    const H = this.deck.get((rail ? 1e7 : 0) + i);
    if (H) return H[k - L.start[i]] + 0.04;
    return this.game.heightAt(x, z) + 0.07;
  }

  update(dt, camAbs, time) {
    this.sigUni.uTime.value = time;
    const show = camAbs.y - this.game.heightAt(camAbs.x, camAbs.z) < 3500;
    this.group.visible = show;
    if (!show) return;
    const R = this.R;
    const cx = Math.floor(camAbs.x / TILE), cz = Math.floor(camAbs.z / TILE), r = Math.ceil(R / TILE);
    // 필요 없는 타일 버림
    for (const [k, t] of this.tiles) {
      if (Math.abs(t.ix - cx) > r + 1 || Math.abs(t.iz - cz) > r + 1) { this._drop(t); this.tiles.delete(k); }
    }
    // 가까운 것부터 프레임당 몇 개씩 만듦
    let budget = this.tiles.size === 0 ? 40 : this.low ? 1 : 2;
    const want = [];
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      const k = (cx + i) * 100000 + (cz + j);
      if (this.tiles.has(k) || Math.hypot(i, j) * TILE > R + TILE) continue;
      want.push([Math.hypot(i, j), cx + i, cz + j, k]);
    }
    want.sort((a, b) => a[0] - b[0]);
    for (const [, ix, iz, k] of want) { if (budget-- <= 0) break; this.tiles.set(k, this._build(ix, iz, k)); }
    for (const t of this.tiles.values()) t.group.position.set(t.ox - origin.x, -origin.y, t.oz - origin.z);
  }

  _drop(t) {
    this.group.remove(t.group);
    t.group.traverse((o) => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); if (o.isSprite) { o.material.map.dispose(); o.material.dispose(); } });
  }

  _build(ix, iz, key) {
    const ox = (ix + 0.5) * TILE, oz = (iz + 0.5) * TILE;
    const g = new THREE.Group();
    const t = { ix, iz, ox, oz, group: g };
    this.group.add(g);
    const E = this.index.get(key);
    if (!E) return t;
    const R = this.roads;
    const B = [this._buf(), this._buf(), this._buf()];       // 0 보도·보행로, 1 생활도로, 2 간선
    const ribbon = (L, i, k, rail) => {
      const cls = rail ? 100 + L.cls[i] : L.cls[i];
      const hw = rail ? 1.6 : L.width[i] / 2;
      const sw = rail ? 0 : SIDEWALK[L.cls[i]] || 0;
      const a = L.start[i], b = L.start[i + 1];
      const P = L.pts;
      // 이 선분 (k → k+1) 의 양 끝 법선 (마이터)
      const nrm = (j) => {
        let nx = 0, nz = 0;
        for (const q of [j - 1, j]) {
          if (q < a || q + 1 >= b) continue;
          const dx = P[q * 2 + 2] - P[q * 2], dz = P[q * 2 + 3] - P[q * 2 + 1], l = Math.hypot(dx, dz) || 1;
          nx += -dz / l; nz += dx / l;
        }
        const l = Math.hypot(nx, nz) || 1;
        nx /= l; nz /= l;
        // 마이터 길이 보정
        const q = Math.min(Math.max(j, a), b - 2);
        const dx = P[q * 2 + 2] - P[q * 2], dz = P[q * 2 + 3] - P[q * 2 + 1], ll = Math.hypot(dx, dz) || 1;
        const sc = 1 / Math.max(0.55, (nx * -dz + nz * dx) / ll);
        return [nx * sc, nz * sc];
      };
      const [n0x, n0z] = nrm(k), [n1x, n1z] = nrm(k + 1);
      let x0 = P[k * 2], z0 = P[k * 2 + 1], x1 = P[k * 2 + 2], z1 = P[k * 2 + 3];
      const dx = x1 - x0, dz = z1 - z0, dl = Math.hypot(dx, dz) || 1;
      // 조각 끝에서 살짝 늘려 이음매 틈을 덮음
      let s0 = 0;
      for (let q = a + 1; q <= k; q++) s0 += Math.hypot(P[q * 2] - P[q * 2 - 2], P[q * 2 + 1] - P[q * 2 - 1]);
      const Ltot = L.len[i];
      const da = rail ? 1 : this.deg[L.na[i]], db = rail ? 1 : this.deg[L.nb[i]];
      let e0 = 0, e1 = 0;
      if (k === a && da > 1) e0 = Math.min(hw * 0.5, 3);
      if (k + 1 === b - 1 && db > 1) e1 = Math.min(hw * 0.5, 3);
      x0 -= dx / dl * e0; z0 -= dz / dl * e0; x1 += dx / dl * e1; z1 += dz / dl * e1;
      const H0 = this._y(L, i, k, x0, z0, hw, rail), H1 = this._y(L, i, k + 1, x1, z1, hw, rail);
      const deck = this.deck.has((rail ? 1e7 : 0) + i);
      const fl = (da > 2 ? 1 : 0) | (db > 2 ? 2 : 0) | (deck ? 4 : 0);
      const lanes = Math.max(1, Math.round(L.width[i] / 3.3));
      const steps = Math.max(1, Math.ceil((dl + e0 + e1) / (deck ? 25 : 6)));
      const layer = rail ? 1 : cls >= 9 ? 0 : cls >= 5 ? 1 : 2;
      const info = [cls, sw, fl, lanes];
      let prev = null;
      for (let st = 0; st <= steps; st++) {
        const u = st / steps;
        const x = x0 + (x1 - x0) * u, z = z0 + (z1 - z0) * u;
        let nx = n0x + (n1x - n0x) * u, nz = n0z + (n1z - n0z) * u;
        let y;
        if (deck) y = H0 + (H1 - H0) * u;
        else {
          // 가로 경사: 가운데와 양 끝 중 높은 곳에 맞춤 (지형이 뚫고 나오지 않게)
          const gh = this.game.heightAt;
          y = Math.max(gh(x, z), gh(x + nx * hw, z + nz * hw), gh(x - nx * hw, z - nz * hw)) + 0.07;
        }
        const s = s0 - e0 + (dl + e0 + e1) * u;
        const cur = { x, z, y, nx, nz, s };
        if (prev) {
          this._quad(B[layer], ox, oz, prev, cur, -hw, hw, 0, Ltot, hw, info);
          if (sw > 0) {
            const bw = B[0];
            this._quad(bw, ox, oz, prev, cur, hw, hw + sw, 0.15, Ltot, hw, info);
            this._quad(bw, ox, oz, prev, cur, -hw - sw, -hw, 0.15, Ltot, hw, info);
          }
        }
        prev = cur;
      }
    };
    for (let q = 0; q < E.segs.length; q += 2) {
      const i = E.segs[q], k = E.segs[q + 1];
      if (R.flags[i] & 2) continue;
      ribbon(R, i, k, false);
    }
    const RL = this.rails;
    if (RL) for (let q = 0; q < E.rsegs.length; q += 2) {
      const i = E.rsegs[q], k = E.rsegs[q + 1];
      if (RL.flags[i] & 2) continue;
      ribbon(RL, i, k, true);
    }
    for (let l = 0; l < 3; l++) {
      const geo = this._geo(B[l]);
      if (!geo) continue;
      const m = new THREE.Mesh(geo, this.mats[l]);
      m.receiveShadow = true;
      m.renderOrder = -30 + l;
      g.add(m);
    }
    this._props(t, E);
    return t;
  }

  _buf() { return { p: [], n: [], rd: [], rk: [], idx: [] }; }
  _quad(b, ox, oz, A, C, a0, a1, lift, Ltot, hw, info) {
    const base = b.p.length / 3;
    for (const [P, ac] of [[A, a0], [A, a1], [C, a0], [C, a1]]) {
      b.p.push(P.x + P.nx * ac - ox, P.y + lift, P.z + P.nz * ac - oz);
      b.rd.push(ac, P.s, Ltot, hw);
      b.rk.push(info[0], info[1], info[2], info[3]);
    }
    b.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  _geo(b) {
    if (!b.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    g.setAttribute('aRd', new THREE.Float32BufferAttribute(b.rd, 4));
    g.setAttribute('aRk', new THREE.Float32BufferAttribute(b.rk, 4));
    g.setIndex(b.idx);
    g.computeVertexNormals();
    // 아래를 향한 법선은 위로 (리본 감김 방향 섞임 대비)
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    return g;
  }

  // 점 근처의 차도 선분: [조각, 선분, 거리, 방향x, 방향z, 반폭, 높이]
  nearestRoad(x, z, maxD = 25, carOnly = true) {
    const R = this.roads;
    let best = null, bd = maxD;
    const cx = Math.floor(x / TILE), cz = Math.floor(z / TILE);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const E = this.index.get((cx + i) * 100000 + (cz + j));
      if (!E) continue;
      for (let q = 0; q < E.segs.length; q += 2) {
        const p = E.segs[q], k = E.segs[q + 1];
        if (carOnly && !CAR(R.cls[p])) continue;
        const ax = R.pts[k * 2], az = R.pts[k * 2 + 1], bx = R.pts[k * 2 + 2], bz = R.pts[k * 2 + 3];
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        const d = Math.hypot(ax + dx * u - x, az + dz * u - z);
        if (d < bd) { bd = d; const l = Math.sqrt(l2); best = [p, k, d, dx / l, dz / l, R.width[p] / 2, u]; }
      }
    }
    return best;
  }

  _props(t, E) {
    const P = this.points, R = this.roads;
    const lists = { lamp: [], signal: [], bus: [], bench: [], tower: [], station: [] };
    const cross = [];
    const put = (kind, x, z, y, ang) => lists[kind].push(x, y, z, ang);
    // 간선도로 가로등: 30 m 간격, 양쪽
    for (let q = 0; q < E.segs.length; q += 2) {
      const i = E.segs[q], k = E.segs[q + 1];
      const c = R.cls[i];
      if (c > 4 || (R.flags[i] & 2)) continue;
      const ax = R.pts[k * 2], az = R.pts[k * 2 + 1], bx = R.pts[k * 2 + 2], bz = R.pts[k * 2 + 3];
      const dl = Math.hypot(bx - ax, bz - az);
      if (dl < 1) continue;
      const dx = (bx - ax) / dl, dz = (bz - az) / dl;
      const off = R.width[i] / 2 + Math.max(0.6, (SIDEWALK[c] || 0) - 0.6);
      const spacing = c <= 1 ? 40 : 30;
      // 조각 시작부터의 거리로 위상을 맞춰 선분이 바뀌어도 간격 유지
      let s0 = 0; for (let qq = R.start[i] + 1; qq <= k; qq++) s0 += Math.hypot(R.pts[qq * 2] - R.pts[qq * 2 - 2], R.pts[qq * 2 + 1] - R.pts[qq * 2 - 1]);
      for (let s = Math.ceil(s0 / spacing) * spacing - s0; s < dl; s += spacing) {
        const x = ax + dx * s, z = az + dz * s;
        const H = this.deck.get(i);
        const y = H ? H[k - R.start[i]] + (H[k + 1 - R.start[i]] - H[k - R.start[i]]) * (s / dl) : this.game.heightAt(x, z);
        for (const side of c <= 1 ? [1] : [-1, 1]) {
          const px = x - dz * off * side, pz = z + dx * off * side;
          put('lamp', px, pz, y, Math.atan2(dz * side, -dx * side) + Math.PI / 2);
        }
      }
    }
    if (P) for (const pi of E.pts) {
      const k = P.kind[pi], x = P.x[pi], z = P.z[pi];
      const nr = k <= 4 || k === 6 ? this.nearestRoad(x, z, k === 2 ? 12 : 30, k !== 4) : null;
      const y = this.game.heightAt(x, z);
      // 도로 쪽을 바라보는 각
      let face = 0;
      if (nr) { const kk = nr[1], u = nr[6]; face = Math.atan2(R.pts[kk * 2] + (R.pts[kk * 2 + 2] - R.pts[kk * 2]) * u - x, R.pts[kk * 2 + 1] + (R.pts[kk * 2 + 3] - R.pts[kk * 2 + 1]) * u - z); }
      if (k === 0) put('lamp', x, z, y, face);
      else if (k === 1) put('signal', x, z, y, face);
      else if (k === 3) put('bus', x, z, y, face + Math.PI);
      else if (k === 4) put('bench', x, z, y, face);
      else if (k === 5) put('tower', x, z, y, (P.x[pi] * 0.013) % 6.28);
      else if (k === 6 || k === 7) {
        put('station', x, z, y, face);
        const nm = P.names[P.nameIx[pi]];
        if (nm) { const s = label(nm + (k === 6 ? '역' === nm.slice(-1) ? '' : '역' : '')); s.position.set(x - t.ox, y + 6.5, z - t.oz); t.group.add(s); }
      } else if (k === 2 && nr) {
        const [p, kk, d, dx, dz, hw, u] = nr;
        if (d < hw + 2 && CAR(R.cls[p]) && !(R.flags[p] & 2)) {
          const cx = R.pts[kk * 2] + (R.pts[kk * 2 + 2] - R.pts[kk * 2]) * u, cz = R.pts[kk * 2 + 1] + (R.pts[kk * 2 + 3] - R.pts[kk * 2 + 1]) * u;
          const H = this.deck.get(p);
          const cy = H ? H[kk - R.start[p]] + 0.06 : this.game.heightAt(cx, cz) + 0.09;
          cross.push(cx, cy, cz, dx, dz, hw);
        }
      }
    }
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), V = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    for (const kind in lists) {
      const a = lists[kind], n = a.length / 4;
      if (!n) continue;
      const mesh = new THREE.InstancedMesh(this.propGeo[kind], this.propMat, n);
      mesh.userData.shared = true;
      for (let j = 0; j < n; j++) {
        Q.setFromAxisAngle(Y, a[j * 4 + 3]);
        V.set(a[j * 4] - t.ox, a[j * 4 + 1], a[j * 4 + 2] - t.oz);
        mesh.setMatrixAt(j, M.compose(V, Q, S));
      }
      mesh.castShadow = kind !== 'bench';
      mesh.receiveShadow = true;
      t.group.add(mesh);
      if (kind === 'signal') this._signalLights(t, a, n);
    }
    if (cross.length) {
      const n = cross.length / 6, pos = [], aC = [], idx = [];
      for (let j = 0; j < n; j++) {
        const [cx, cy, cz, dx, dz, hw] = cross.slice(j * 6, j * 6 + 6);
        const nx = -dz, nz = dx, b = pos.length / 3, hl = 2.2;
        for (const [u, v] of [[-hw, -hl], [hw, -hl], [-hw, hl], [hw, hl]]) {
          pos.push(cx + nx * u + dx * v - t.ox, cy, cz + nz * u + dz * v - t.oz);
          aC.push(u + hw, v);
        }
        idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      gg.setAttribute('aC', new THREE.Float32BufferAttribute(aC, 2));
      gg.setIndex(idx);
      const m = new THREE.Mesh(gg, this.crossMat);
      m.renderOrder = -20;
      t.group.add(m);
    }
  }

  // 신호등 불빛 3개 (빨강·노랑·초록), 신호등마다 위상
  _signalLights(t, a, n) {
    const geo = this.lightGeo.clone();
    const N = n * 3;
    const ph = new Float32Array(N), kk = new Float32Array(N);
    const mesh = new THREE.InstancedMesh(geo, this.sigMat, N);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), V = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    for (let j = 0; j < n; j++) {
      const x = a[j * 4], y = a[j * 4 + 1], z = a[j * 4 + 2], ang = a[j * 4 + 3];
      const p = ((x * 0.37 + z * 0.11) % 60 + 60) % 60;
      for (let l = 0; l < 3; l++) {
        // 신호 상자 앞면 (+X 쪽이 차가 오는 쪽)
        const lx = 0.19, lz = 5.6 + (l - 1) * 0.38;
        const c = Math.cos(ang), s = Math.sin(ang);
        V.set(x + lx * c + lz * s - t.ox, y + 5.8, z - lx * s + lz * c - t.oz);
        Q.setFromAxisAngle(Y, ang + Math.PI / 2);
        mesh.setMatrixAt(j * 3 + l, M.compose(V, Q, S));
        ph[j * 3 + l] = p; kk[j * 3 + l] = l === 0 ? 0 : l === 1 ? 1 : 2;
      }
    }
    geo.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph, 1));
    geo.setAttribute('aK', new THREE.InstancedBufferAttribute(kk, 1));
    t.group.add(mesh);
  }

  /** trees.js 용: 이 나무 타일 안의 가로수 [x, z, 높이, 종류(1 활엽)] */
  streetTrees(x0, z0, size) {
    const out = [];
    const R = this.roads, P = this.points;
    const t0x = Math.floor(x0 / TILE), t1x = Math.floor((x0 + size) / TILE), t0z = Math.floor(z0 / TILE), t1z = Math.floor((z0 + size) / TILE);
    const inside = (x, z) => x >= x0 && x < x0 + size && z >= z0 && z < z0 + size;
    for (let tz = t0z; tz <= t1z; tz++) for (let tx = t0x; tx <= t1x; tx++) {
      const E = this.index.get(tx * 100000 + tz);
      if (!E) continue;
      for (let q = 0; q < E.segs.length; q += 2) {
        const i = E.segs[q], k = E.segs[q + 1], c = R.cls[i];
        if (c < 1 || c > 4 || (R.flags[i] & 3) || this.deck.has(i)) continue;
        const ax = R.pts[k * 2], az = R.pts[k * 2 + 1], bx = R.pts[k * 2 + 2], bz = R.pts[k * 2 + 3];
        const dl = Math.hypot(bx - ax, bz - az);
        if (dl < 1) continue;
        const dx = (bx - ax) / dl, dz = (bz - az) / dl;
        const off = R.width[i] / 2 + Math.max(1.1, (SIDEWALK[c] || 0) * 0.45);
        let s0 = 0; for (let qq = R.start[i] + 1; qq <= k; qq++) s0 += Math.hypot(R.pts[qq * 2] - R.pts[qq * 2 - 2], R.pts[qq * 2 + 1] - R.pts[qq * 2 - 1]);
        // 교차로 근처는 비움
        for (let s = Math.ceil((s0 + 4.5) / 9) * 9 - s0; s < dl; s += 9) {
          const sa = s0 + s;
          if (sa < 14 || R.len[i] - sa < 14) continue;
          const x = ax + dx * s, z = az + dz * s;
          for (const side of [-1, 1]) {
            const px = x - dz * off * side, pz = z + dx * off * side;
            if (inside(px, pz)) out.push(px, pz, 7.5 + ((px * 0.71 + pz * 0.37) % 1 + 1) % 1 * 4, 1);
          }
        }
      }
      if (P) for (const pi of E.pts) if (P.kind[pi] === 8 && inside(P.x[pi], P.z[pi])) out.push(P.x[pi], P.z[pi], 7 + ((pi * 0.618) % 1) * 6, 1);
    }
    return out;
  }

  reset() { for (const t of this.tiles.values()) this._drop(t); this.tiles.clear(); }
}
