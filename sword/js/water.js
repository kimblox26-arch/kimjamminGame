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
transformed += disp;
objectNormal = normalize(cross(tz, tx));
vCrest = crest;
vWPos = wp0 + disp;
`;
const FRAG_PARS = /* glsl */`
uniform float uTime;
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
  float amt = 0.22 * (1.0 - smoothstep(30.0, 400.0, dist));
  vec3 pn = normalize(vec3(-(hx - h0) / e * amt, 1.0, -(hz - h0) / e * amt));
  normal = normalize(normal + (mat3(viewMatrix) * pn - mat3(viewMatrix) * vec3(0.0, 1.0, 0.0)));
}
`;
const FRAG_COLOR = /* glsl */`
// 물마루 거품
{
  float foam = smoothstep(0.35, 0.75, vCrest) * (0.6 + 0.4 * wNoise(vWPos.xz * 0.8 + uTime * 0.3));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.88, 0.9), foam * 0.7);
}
`;

export class Water {
  constructor(renderer, scene, opts = {}) {
    const low = opts.quality === 'low';
    this.scene = scene;
    // 극좌표 격자: 반지름이 지수적으로 커짐
    const A = low ? 96 : 160, Rn = low ? 90 : 140, r0 = 0.6, gr = low ? 1.07 : 1.045;
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
    this.uniforms = { uW: { value: this.uW }, uW2: { value: this.uW2 }, uTime: { value: 0 }, uAmp: { value: 1 } };
    const m = new THREE.MeshStandardMaterial({ color: 0x0c2a33, roughness: 0.05, metalness: 0.0, envMap: opts.envMap || null, envMapIntensity: 1.0 });
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
    this.time = 0;
    this._probe = 0;
  }

  update(dt, camera, camAbs) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    // 근처 물 높이 탐색 (몇 프레임마다, 카메라 주변 8방향)
    if (--this._probe <= 0) {
      this._probe = 10;
      let lv = waterLevelAt(camAbs.x, camAbs.z), found = lv > -1e9;
      for (let i = 0; i < 8 && !found; i++) {
        const a = i * Math.PI / 4;
        for (const r of [400, 1500, 4000]) {
          const w = waterLevelAt(camAbs.x + Math.cos(a) * r, camAbs.z + Math.sin(a) * r);
          if (w > -1e9) { lv = w; found = true; break; }
        }
      }
      this.found = found;
      if (found) this.level = lv;
    }
    const alt = camAbs.y - this.level;
    this.mesh.visible = this.found && alt < 6000;
    // 바다(수위 0)는 크게, 강은 잔잔하게
    this.uniforms.uAmp.value = this.level < 0.5 ? 1.0 : 0.25;
    this.mesh.position.set(camAbs.x - origin.x, this.level - origin.y, camAbs.z - origin.z);
    // 원점 보정 위상: k·(origin.xz) 를 2π 로 나눈 나머지 (배정밀도로 계산)
    for (let i = 0; i < NW; i++) {
      const w = this.waves[i];
      const ph = w.k * (w.dx * origin.x + w.dz * origin.z);
      this.uW2[i].y = ph % (Math.PI * 2);
    }
  }
}
