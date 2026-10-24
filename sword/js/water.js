// SKY BLADE — 파도치는 물 (한강/바다)
//  - 카메라를 따라다니는 극좌표 격자 (가까울수록 촘촘) 위에 거스트너 파동 6개를 정점 셰이더에서 합성
//  - 파동 위상은 절대 좌표 기준 (플로팅 원점 이동 시 JS 에서 위상 보정) → 원점이 옮겨가도 물결이 튀지 않음
//  - MeshStandardMaterial 확장: 하늘 반사(환경맵), 태양 반짝임, 그림자, 연무를 그대로 받음 + 물마루 거품 + 잔물결 노멀
//  - 물 높이: 카메라 아래/주변의 waterLevelAt (한강 ≈ 2.5 m, 바다 0 m). 지형이 물보다 높은 곳은 깊이로 자연히 가려짐
import * as THREE from 'three';
import { waterLevelAt } from './terrain.js';
import { origin } from './frame.js';

const NW = 6;
// [방향(도), 파장(m), 진폭(m, 바다 기준), 가파름]
const WAVES = [[20, 64, 0.55, 0.55], [55, 37, 0.32, 0.6], [-15, 23, 0.2, 0.65], [80, 13, 0.1, 0.7], [-50, 7.5, 0.06, 0.7], [35, 4.2, 0.03, 0.7]];

const VERT_PARS = /* glsl */`
uniform vec4 uW[${NW}];      // xy: 방향, z: k (파수), w: 진폭
uniform vec4 uW2[${NW}];     // x: 가파름, y: 위상 보정(원점), z: 각속도
uniform float uTime;
uniform float uAmp;          // 바다 1, 강 0.25
uniform vec4 uRip[6];        // 충격 파문: xy 중심(렌더), z 나이(s), w 진폭(m)
uniform vec4 uRipK[6];       // x 파수, y 파 묶음 폭(m), z 전파 속도(m/s)
varying vec3 vWPos;
varying float vCrest;
`;
const VERT_BEGIN = /* glsl */`
vec3 transformed = vec3(position);
vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
vec3 disp = vec3(0.0);
vec3 tx = vec3(1.0, 0.0, 0.0), tz = vec3(0.0, 0.0, 1.0);
float crest = 0.0;
// 멀어질수록 작은 파동은 끔 (앨리어싱 방지)
float camD = length(wp0.xz - cameraPosition.xz);
for (int i = 0; i < ${NW}; i++) {
  vec2 d = uW[i].xy; float k = uW[i].z; float A = uW[i].w * uAmp; float Q = uW2[i].x;
  float fade = 1.0 - smoothstep(60.0 / k, 400.0 / k, camD);
  A *= fade;
  float ph = k * dot(d, wp0.xz) + uW2[i].y - uW2[i].z * uTime;
  float c = cos(ph), s = sin(ph);
  disp.x += Q * A * d.x * c; disp.z += Q * A * d.y * c; disp.y += A * s;
  // 접선 (해석적 미분)
  float wa = k * A;
  tx += vec3(-Q * d.x * d.x * wa * s, d.x * wa * c, -Q * d.x * d.y * wa * s);
  tz += vec3(-Q * d.x * d.y * wa * s, d.y * wa * c, -Q * d.y * d.y * wa * s);
  crest += max(s, 0.0) * Q * wa;
}
// 충격 파문: 퍼져 나가는 동심원 파 묶음 (해석적 기울기로 법선도 맞춤)
for (int i = 0; i < 6; i++) {
  vec4 R = uRip[i];
  if (R.w <= 0.0) continue;
  vec2 dv = wp0.xz - R.xy;
  float d = length(dv) + 1e-3;
  float wdt = uRipK[i].y;
  float s = d - uRipK[i].z * R.z;
  if (abs(s) > wdt * 3.0) continue;
  float g = exp(-(s * s) / (wdt * wdt));
  float k = uRipK[i].x;
  // 가운데는 비워 둠 (돔처럼 솟지 않고 고리로 퍼짐)
  float cen = smoothstep(0.0, 0.8 / k * 6.2832, d);
  float h = R.w * cos(k * s) * g * cen;
  float dh = R.w * g * cen * (-k * sin(k * s) - cos(k * s) * 2.0 * s / (wdt * wdt));
  disp.y += h;
  vec2 gd = dv / d;
  tx.y += dh * gd.x; tz.y += dh * gd.y;
  crest += max(0.0, dh) * 0.4;
}
transformed += disp;
objectNormal = normalize(cross(tz, tx));
vCrest = crest;
vWPos = wp0 + disp;
`;
const FRAG_PARS = /* glsl */`
uniform float uTime;
uniform sampler2D uMask;     // 실제 물이 있는 곳 (카메라 주변 격자, 1 = 물)
uniform vec4 uMaskT;         // xy: 마스크 좌하단(렌더 좌표), z: 1/크기, w: 사용 여부
uniform vec3 uWaterCol;
uniform float uFoam;
varying vec3 vWPos;
varying float vCrest;
float wHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y); }
`;
const FRAG_NORMAL = /* glsl */`
// 잔물결: 움직이는 노이즈 두 겹의 기울기로 법선 섭동
{
  vec2 p = vWPos.xz;
  float e = 0.15;
  float t = uTime;
  float h0 = wNoise(p * 1.3 + vec2(t * 0.6, t * 0.4)) + 0.5 * wNoise(p * 3.1 - vec2(t * 0.9, -t * 0.7));
  float hx = wNoise((p + vec2(e, 0.0)) * 1.3 + vec2(t * 0.6, t * 0.4)) + 0.5 * wNoise((p + vec2(e, 0.0)) * 3.1 - vec2(t * 0.9, -t * 0.7));
  float hz = wNoise((p + vec2(0.0, e)) * 1.3 + vec2(t * 0.6, t * 0.4)) + 0.5 * wNoise((p + vec2(0.0, e)) * 3.1 - vec2(t * 0.9, -t * 0.7));
  float dist = length(vWPos - cameraPosition);
  // 화면 픽셀보다 잘아지는 잔물결은 끔 (반짝이 노이즈 방지)
  float amt = 0.09 * (1.0 - smoothstep(6.0, 70.0, dist));
  vec3 pn = normalize(vec3(-(hx - h0) / e * amt, 1.0, -(hz - h0) / e * amt));
  normal = normalize(normal + (mat3(viewMatrix) * pn - mat3(viewMatrix) * vec3(0.0, 1.0, 0.0)));
}
`;
const FRAG_COLOR = /* glsl */`
// 물이 없는 곳(지형이 아직 안 깔린 땅)은 그리지 않음
if (uMaskT.w > 0.5) {
  vec2 mu = (vWPos.xz - uMaskT.xy) * uMaskT.z;
  if (mu.x < 0.0 || mu.y < 0.0 || mu.x > 1.0 || mu.y > 1.0 || texture2D(uMask, mu).r < 0.5) discard;
}
// 물마루 거품
{
  float foam = smoothstep(0.5, 0.85, vCrest) * smoothstep(0.35, 0.8, wNoise(vWPos.xz * 0.35 + uTime * 0.2));
  diffuseColor.rgb = mix(uWaterCol, vec3(0.8, 0.84, 0.86), foam * 0.6 * uFoam);
}
`;

export class Water {
  constructor(renderer, scene, opts = {}) {
    const low = opts.quality === 'low';
    this.scene = scene;
    // 극좌표 격자: 반지름이 지수적으로 커짐
    const A = low ? 96 : 160, Rn = low ? 90 : 140, r0 = 0.6, gr = low ? 1.095 : 1.06;
    const pos = [], idx = [];
    pos.push(0, 0, 0);
    let r = r0;
    for (let j = 0; j < Rn; j++) {
      for (let i = 0; i < A; i++) { const a = (i / A) * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
      r *= gr;
    }
    this.radius = r;
    for (let i = 0; i < A; i++) idx.push(0, 1 + ((i + 1) % A), 1 + i);
    for (let j = 0; j < Rn - 1; j++) for (let i = 0; i < A; i++) {
      const a = 1 + j * A + i, b = 1 + j * A + ((i + 1) % A), c = a + A, d = b + A;
      idx.push(a, b, d, a, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).fill(0).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);

    this.uW = []; this.uW2 = [];
    this.waves = WAVES.map(([deg, L, amp, q]) => {
      const a = deg * Math.PI / 180, k = 2 * Math.PI / L;
      const w = Math.sqrt(9.81 * k);   // 깊은 물 분산 관계
      this.uW.push(new THREE.Vector4(Math.cos(a), Math.sin(a), k, amp));
      this.uW2.push(new THREE.Vector4(q / (k * amp * NW), 0, w, 0));
      return { dx: Math.cos(a), dz: Math.sin(a), k };
    });
    this.rips = [];
    this.uRip = Array.from({ length: 6 }, () => new THREE.Vector4());
    this.uRipK = Array.from({ length: 6 }, () => new THREE.Vector4(0.3, 10, 5, 0));
    // 물 마스크: 카메라 주변 MS×MS 칸 (칸 MC m). 몇 줄씩 나눠 계산해 끊김 없이 갱신
    this.MS = 96; this.MC = 40;
    this.maskData = new Uint8Array(this.MS * this.MS);
    this.maskWork = new Uint8Array(this.MS * this.MS);
    this.maskTex = new THREE.DataTexture(this.maskData, this.MS, this.MS, THREE.RedFormat, THREE.UnsignedByteType);
    this.maskTex.magFilter = THREE.LinearFilter; this.maskTex.minFilter = THREE.LinearFilter;
    this.maskTex.needsUpdate = true;
    this.maskAbs = null;      // 완성된 마스크의 좌하단 (절대)
    this.maskJob = null;      // 계산 중 { x0, z0, row }
    this.uniforms = { uW: { value: this.uW }, uW2: { value: this.uW2 }, uTime: { value: 0 }, uAmp: { value: 1 }, uWaterCol: { value: new THREE.Color(0x0a2630) }, uFoam: { value: 1 },
      uRip: { value: this.uRip }, uRipK: { value: this.uRipK }, uMask: { value: this.maskTex }, uMaskT: { value: new THREE.Vector4(0, 0, 1, 0) } };
    const m = new THREE.MeshStandardMaterial({ color: 0x0c2a33, roughness: 0.05, metalness: 0.0, envMap: opts.envMap || null, envMapIntensity: 1.0, side: THREE.DoubleSide });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_PARS)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(normal);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(tangent.xyz);\n#endif')
        .replace('#include <begin_vertex>', VERT_BEGIN)
        .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>');
      // begin_vertex 가 objectNormal 을 바꾸므로 defaultnormal 보다 앞에 오도록 순서 재배치
      sh.vertexShader = sh.vertexShader.replace(VERT_BEGIN, '').replace('#include <defaultnormal_vertex>', VERT_BEGIN + '\n#include <defaultnormal_vertex>');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_NORMAL)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR);
    };
    m.customProgramCacheKey = () => 'sky-blade-water';
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.name = 'water';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = -5;
    scene.add(this.mesh);
    this.level = 0;
    this.ready = false;     // 지형이 깔린 뒤에 보이기 (main 에서 설정)
    this.time = 0;
    this._probe = 0;
  }

  // 마스크 갱신: 카메라가 마스크 가운데서 멀어지면 새로 계산 (프레임당 몇 줄)
  _mask(camAbs) {
    const MS = this.MS, MC = this.MC, half = (MS * MC) / 2;
    const snap = (v) => Math.round(v / (MC * 8)) * MC * 8;
    const cx = snap(camAbs.x), cz = snap(camAbs.z);
    if (!this.maskJob && (!this.maskAbs || Math.abs(this.maskAbs.cx - cx) > 1 || Math.abs(this.maskAbs.cz - cz) > 1)) {
      this.maskJob = { cx, cz, x0: cx - half, z0: cz - half, row: 0, level: this.level };
    }
    const J = this.maskJob;
    if (J) {
      const W = this.maskWork;
      const rows = this.maskAbs ? 4 : MS;   // 처음엔 한 번에
      for (let n = 0; n < rows && J.row < MS; n++, J.row++) {
        const z = J.z0 + (J.row + 0.5) * MC;
        for (let i = 0; i < MS; i++) {
          const x = J.x0 + (i + 0.5) * MC;
          // 이 수면 높이와 같은 물만 (산속 저수지·하천은 지형 셰이더가 물로 칠함)
          const wl = waterLevelAt(x, z);
          W[J.row * MS + i] = wl > -1e9 && Math.abs(wl - J.level) < 1.5 ? 255 : 0;
        }
      }
      if (J.row >= MS) {
        // 한 칸 넓힘 (해안선은 깊이 버퍼가 마무리)
        const D = this.maskData;
        for (let j = 0; j < MS; j++) for (let i = 0; i < MS; i++) {
          let v = 0;
          for (let dj = -1; dj <= 1 && !v; dj++) for (let di = -1; di <= 1; di++) {
            const jj = j + dj, ii = i + di;
            if (jj >= 0 && jj < MS && ii >= 0 && ii < MS && W[jj * MS + ii]) { v = 255; break; }
          }
          D[j * MS + i] = v;
        }
        this.maskTex.needsUpdate = true;
        this.maskAbs = { cx: J.cx, cz: J.cz, x0: J.x0, z0: J.z0 };
        this.maskJob = null;
      }
    }
    const M = this.maskAbs, U = this.uniforms.uMaskT.value;
    if (M) U.set(M.x0 - origin.x, M.z0 - origin.z, 1 / (MS * MC), 1); else U.w = 0;
  }

  /** 충격 파문 (절대 x,z). amp = 첫 진폭(m), lambda = 파장(m) */
  ripple(x, z, amp, lambda = 14) {
    if (this.level > 0.5) { amp = Math.min(amp, 1.6); lambda = Math.min(lambda, 30); }
    const k = (2 * Math.PI) / lambda;
    const c = Math.sqrt(9.81 / k) * 1.2;
    const r = { x, z, t: (lambda * 0.6) / c, a0: amp, k, c, lambda };
    if (this.rips.length >= 6) this.rips.shift();
    this.rips.push(r);
  }

  update(dt, camera, camAbs) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    // 파문: 퍼지면서 약해짐 (반지름이 커질수록 에너지가 둘레로 퍼짐)
    for (let i = this.rips.length - 1; i >= 0; i--) {
      const r = this.rips[i];
      r.t += dt;
      const R = r.c * r.t;
      r.a = r.a0 * Math.exp(-r.t / 9) / Math.sqrt(1 + R / r.lambda);
      if (r.a < 0.02) this.rips.splice(i, 1);
    }
    for (let i = 0; i < 6; i++) {
      const r = this.rips[i];
      if (!r) { this.uRip[i].w = 0; continue; }
      this.uRip[i].set(r.x - origin.x, r.z - origin.z, r.t, r.a);
      this.uRipK[i].set(r.k, r.lambda * 0.6 + r.c * r.t * 0.1, r.c, 0);
    }
    // 근처 물 높이 탐색 (몇 프레임마다, 카메라 주변 8방향)
    if (--this._probe <= 0) {
      this._probe = 10;
      // 주변에서 가장 낮은 물 (= 큰 강·바다) 을 고름. 작은 하천·저수지는 지형 셰이더가 물로 칠함
      let lv = waterLevelAt(camAbs.x, camAbs.z), found = lv > -1e9;
      if (!found) lv = 1e9;
      for (let i = 0; i < 16; i++) {
        const a = i * Math.PI / 8;
        for (const r of [250, 700, 1500, 3000, 5000]) {
          const w = waterLevelAt(camAbs.x + Math.cos(a) * r, camAbs.z + Math.sin(a) * r);
          if (w > -1e9 && w < lv) { lv = w; found = true; }
        }
      }
      this.found = found;
      if (found && Math.abs(lv - this.level) > 0.5) this.maskAbs = null;   // 다른 물 → 마스크 새로
      if (found) this.level = lv;
    }
    const alt = camAbs.y - this.level;
    this.mesh.visible = this.ready && this.found && alt < 6000;
    if (this.mesh.visible) this._mask(camAbs);
    // 바다(수위 0)는 크게, 강은 잔잔하게
    const sea = this.level < 0.5;
    this.uniforms.uAmp.value = sea ? 1.0 : 0.25;
    this.uniforms.uFoam.value = sea ? 1 : 0;
    this.uniforms.uWaterCol.value.setHex(sea ? 0x0a2630 : 0x12302a);   // 바다: 짙은 청록 / 한강: 녹회색
    this.mesh.position.set(camAbs.x - origin.x, this.level - origin.y, camAbs.z - origin.z);
    // 원점 보정 위상: k·(origin.xz) 를 2π 로 나눈 나머지 (배정밀도로 계산)
    for (let i = 0; i < NW; i++) {
      const w = this.waves[i];
      const ph = w.k * (w.dx * origin.x + w.dz * origin.z);
      this.uW2[i].y = ph % (Math.PI * 2);
    }
  }
}
