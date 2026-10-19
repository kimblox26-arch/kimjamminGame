// SKY BLADE — 우주 장면 (별, 은하수, 해, 달, 지구)
//  - 단위: km, 카메라 기준 렌더 (카메라 = 원점, 장면 축 = 행성 좌표 축)
//  - 카메라 회전 = localToPlanetQuat(카메라 위치) × 메인 카메라 회전 → 지역 화면과 정확히 겹침
//  - 깊이 테스트 없이 거리순(renderOrder)으로 그림: 배경(별/은하) → 해 → 먼 천체 → 가까운 천체
//  - 모든 셰이더 출력은 선형 HDR (OutputPass 에서 톤매핑)
import * as THREE from 'three';
import { SUN_DIR, SUN, MOON, flatToPlanet, localToPlanetQuat } from './frame.js';

const RE = 6371, RM = MOON.radius / 1000, RS = SUN.radius / 1000;   // km
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// 지구 자전축 (서울 위도 37.5°N): 서울 천정에서 북쪽(-Z)으로 52.5° 기운 방향
const POLE = new THREE.Vector3(0, Math.cos(52.5 * Math.PI / 180), -Math.sin(52.5 * Math.PI / 180)).normalize();
// 은하 북극 / 은하 중심 방향 (임의, 서울 밤하늘에서 은하수가 비스듬히 지나가게)
const GAL_N = new THREE.Vector3(0.42, 0.35, 0.84).normalize();
const GAL_C = new THREE.Vector3(-0.62, 0.71, 0.0).normalize().projectOnPlane(GAL_N).normalize();

const NOISE = /* glsl */`
float h31(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 9; i++) { if (i >= oct) break; s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}
// 크레이터: 셀마다 하나, 반지름/깊이 무작위 → (높이, 테두리)
float craters(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float h = 0.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(h31(i + g), h31(i + g + 17.3), h31(i + g + 41.7));
    float r = 0.18 + 0.32 * h31(i + g + 7.7);
    float d = length(g + o - f) / r;
    if (d < 1.4) {
      float bowl = d < 1.0 ? (d * d - 1.0) : 0.0;
      float rim = exp(-pow((d - 1.0) * 4.0, 2.0)) * 0.35;
      h += (bowl + rim) * r;
    }
  }
  return h;
}`;

// ── 별 ──
const STAR_VS = /* glsl */`
attribute float aMag;
attribute vec3 aCol;
uniform float uPR;
varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = 0.5 * gl_Position.w;
  float b = pow(10.0, -0.4 * (aMag - 1.0));
  gl_PointSize = max(clamp(1.4 + 2.2 * sqrt(b), 1.0, 5.0) * uPR, 1.6);
  vC = aCol * (0.6 + 6.0 * b);
}`;
const STAR_FS = /* glsl */`
uniform float uVis;
varying vec3 vC;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = exp(-dot(q, q) * 18.0);
  gl_FragColor = vec4(vC * a * uVis, 1.0);   // AdditiveBlending 은 src alpha 를 곱함
}`;

// ── 은하수 (안쪽에서 보는 큰 구) ──
const MW_VS = /* glsl */`
varying vec3 vD;
void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = 0.5 * gl_Position.w; }`;
const MW_FS = /* glsl */`
${NOISE}
uniform vec3 uGN;
uniform vec3 uGC;
uniform float uVis;
varying vec3 vD;
void main() {
  vec3 d = normalize(vD);
  float b = asin(clamp(dot(d, uGN), -1.0, 1.0));            // 은하 위도
  float l = acos(clamp(dot(normalize(d - uGN * dot(d, uGN)), uGC), -1.0, 1.0));   // 중심으로부터 경도 각
  float band = exp(-pow(b / 0.16, 2.0));
  float bulge = exp(-pow(l / 0.55, 2.0) - pow(b / 0.22, 2.0));
  float n = fbm(d * 7.0, 6);
  float fine = fbm(d * 38.0, 4);
  // 먼지띠: 은하 적도 근처에 어두운 갈라짐
  float dust = smoothstep(0.42, 0.72, fbm(d * 13.0 + 4.0, 5)) * exp(-pow(b / 0.05, 2.0));
  float I = (band * (0.35 + 0.9 * n) + bulge * 1.6) * (0.75 + 0.5 * fine);
  I *= 1.0 - 0.85 * dust;
  vec3 col = mix(vec3(0.55, 0.62, 0.85), vec3(1.0, 0.82, 0.62), bulge * 0.9) * I;
  // 희미한 성운 얼룩
  col += vec3(0.9, 0.3, 0.35) * pow(max(fbm(d * 21.0 + 9.0, 4) - 0.55, 0.0), 2.0) * band * 2.0;
  gl_FragColor = vec4(col * 0.11 * uVis, 1.0);   // AdditiveBlending 은 src alpha 를 곱함
}`;

// ── 해 (구 + 화면 정렬 글로우) ──
const SUN_VS = /* glsl */`
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(-wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = 0.5 * gl_Position.w;
}`;
const SUN_FS = /* glsl */`
${NOISE}
uniform float uTime;
uniform float uI;
varying vec3 vN;
varying vec3 vV;
void main() {
  float mu = clamp(dot(vN, vV), 0.0, 1.0);
  float limb = 0.35 + 0.65 * pow(mu, 0.55);                 // 주연 감광
  float gran = 0.85 + 0.3 * fbm(vN * 180.0 + uTime * 0.05, 4);   // 쌀알 무늬
  vec3 col = vec3(1.0, 0.93, 0.82) * 60.0 * limb * gran;
  gl_FragColor = vec4(col * uI, 1.0);
}`;
const GLOW_VS = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
  gl_Position = projectionMatrix * mv;
  gl_Position.z = 0.5 * gl_Position.w;
}`;
const GLOW_FS = /* glsl */`
uniform float uR;      // 해 원반 반지름 (쿼드 반폭 대비)
uniform float uI;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float x = max(r - uR, 0.0) / max(1.0 - uR, 1e-4);
  float a = atan(vUv.y, vUv.x);
  float rays = 0.6 + 0.4 * pow(abs(sin(a * 6.0 + 0.4)), 18.0) + 0.25 * pow(abs(sin(a * 11.0 - 1.1)), 30.0);
  vec3 c = vec3(1.0, 0.86, 0.7) * (exp(-x * 9.0) * 3.0 + exp(-x * 2.6) * 0.35 * rays) * (1.0 - smoothstep(0.85, 1.0, r));
  gl_FragColor = vec4(c * uI, 1.0);   // AdditiveBlending 은 src alpha 를 곱함
}`;

// ── 달 ──
const BODY_VS = /* glsl */`
varying vec3 vN;     // 천체 기준 단위 위치 (= 법선)
varying vec3 vW;     // 카메라 기준 위치 (km)
void main() {
  vN = normalize(position);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z = 0.5 * gl_Position.w;
}`;
const MOON_FS = /* glsl */`
${NOISE}
uniform vec3 uSun;
uniform float uI;
varying vec3 vN;
varying vec3 vW;
float hgt(vec3 p) {
  return craters(p * 7.0) * 0.6 + craters(p * 19.0) * 0.25 + craters(p * 47.0) * 0.08 + fbm(p * 30.0, 4) * 0.05;
}
void main() {
  vec3 n = normalize(vN);
  // 법선 섭동 (높이장 유한 차분)
  vec3 t1 = normalize(cross(n, vec3(0.0, 1.0, 0.1)));
  vec3 t2 = cross(n, t1);
  float e = 0.004;
  float h0 = hgt(n);
  float hx = hgt(normalize(n + t1 * e)), hy = hgt(normalize(n + t2 * e));
  vec3 nb = normalize(n - (t1 * (hx - h0) + t2 * (hy - h0)) * 2.2 / e * 0.012);
  // 바다(어두운 현무암 평원)와 고지대
  float maria = smoothstep(0.52, 0.62, fbm(n * 2.3 + 5.0, 5));
  float alb = mix(0.2, 0.085, maria) * (0.85 + 0.3 * fbm(n * 60.0, 3));
  alb += 0.05 * smoothstep(0.03, 0.08, h0);                  // 밝은 크레이터 테두리/광조
  float nl = max(dot(nb, uSun), 0.0);
  vec3 V = normalize(-vW);
  float nv = max(dot(nb, V), 1e-3);
  float ls = nl / (nl + nv) * 2.0;                           // 로멜-지리거 (달 표면 반사)
  vec3 col = vec3(1.0, 0.97, 0.93) * alb * mix(nl, ls, 0.6) * 3.2;
  col += vec3(0.25, 0.3, 0.4) * alb * 0.02;                  // 지구 반사광
  gl_FragColor = vec4(col * uI, 1.0);
}`;

// ── 지구 ──
const EARTH_FS = /* glsl */`
${NOISE}
uniform vec3 uSun;
uniform vec3 uPole;
uniform vec3 uSeoul;
uniform float uTime;
uniform float uI;
varying vec3 vN;
varying vec3 vW;
float landMask(vec3 n) {
  float c = fbm(n * 1.6 + 2.0, 6) + 0.18 * fbm(n * 7.0, 4);
  c += 0.22 * exp(-pow(acos(clamp(dot(n, uSeoul), -1.0, 1.0)) / 0.25, 2.0));   // 서울 부근은 대륙 (한반도)
  return c;
}
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(-vW);
  float lat = asin(clamp(dot(n, uPole), -1.0, 1.0));
  float alat = abs(lat);
  float c = landMask(n);
  float land = smoothstep(0.545, 0.56, c);
  float coast = smoothstep(0.50, 0.545, c) * (1.0 - land);
  // 육지: 위도대별 숲/초원/사막/툰드라 + 산맥
  float dry = smoothstep(0.12, 0.42, 1.0 - abs(alat - 0.42) * 3.0) * smoothstep(0.45, 0.7, fbm(n * 4.0 + 9.0, 4));
  vec3 forest = vec3(0.045, 0.075, 0.03), grass = vec3(0.11, 0.12, 0.055), desert = vec3(0.34, 0.26, 0.15), tundra = vec3(0.13, 0.12, 0.1);
  vec3 lc = mix(forest, grass, fbm(n * 9.0, 4));
  dry *= smoothstep(0.08, 0.3, acos(clamp(dot(n, uSeoul), -1.0, 1.0)));   // 한반도는 푸른 산림
  lc = mix(lc, desert, dry);
  lc = mix(lc, tundra, smoothstep(0.95, 1.15, alat));
  lc *= 0.8 + 0.4 * fbm(n * 40.0, 4);
  float mtn = smoothstep(0.6, 0.75, fbm(n * 6.0 + 3.0, 5)) * land;
  lc = mix(lc, vec3(0.2, 0.19, 0.17), mtn * 0.6);
  // 바다: 깊은 남색 → 얕은 해안은 청록
  vec3 oc = mix(vec3(0.004, 0.018, 0.05), vec3(0.02, 0.09, 0.12), coast);
  vec3 alb = mix(oc, lc, land);
  // 극지 얼음
  float ice = smoothstep(1.12, 1.22, alat + 0.06 * fbm(n * 12.0, 3));
  alb = mix(alb, vec3(0.75, 0.8, 0.85), ice);
  // 구름 (천천히 흐름)
  vec3 q = n + vec3(uTime * 0.0004, 0.0, uTime * 0.00025);
  float cl = fbm(q * 3.2 + fbm(q * 6.0, 3) * 0.8, 7);
  float band = 0.06 * exp(-pow((alat - 0.95) / 0.25, 2.0)) - 0.05 * exp(-pow((alat - 0.42) / 0.12, 2.0));
  float cov = smoothstep(0.56, 0.74, cl + band);
  float NL = dot(n, uSun);
  float day = smoothstep(-0.08, 0.12, NL);
  float lit = max(NL, 0.0);
  vec3 col = alb * lit * 2.6;
  // 바다 햇빛 반짝임
  vec3 H = normalize(uSun + V);
  float spec = pow(max(dot(n, H), 0.0), 220.0) * (1.0 - land) * (1.0 - ice) * (1.0 - cov);
  col += vec3(1.0, 0.92, 0.8) * spec * 6.0 * lit;
  // 구름: 밝게, 아래에 그림자
  col = mix(col * (1.0 - 0.5 * cov), vec3(0.9, 0.92, 0.95) * (lit * 2.4 + 0.02), cov);
  // 밤: 도시 불빛 (육지, 해안에 많음)
  float city = smoothstep(0.62, 0.8, fbm(n * 70.0, 4)) * land * (1.0 - ice) * (0.3 + 0.7 * smoothstep(0.545, 0.6, c) * (1.0 - smoothstep(0.62, 0.7, c)));
  city += 2.5 * exp(-pow(acos(clamp(dot(n, uSeoul), -1.0, 1.0)) / 0.006, 2.0));   // 서울
  col += vec3(1.0, 0.62, 0.25) * city * (1.0 - day) * (1.0 - cov * 0.7) * 0.5;
  // 대기: 가장자리로 갈수록 파란 산란광, 명암 경계는 붉게
  float ndv = max(dot(n, V), 0.0);
  float fres = pow(1.0 - ndv, 5.0);
  vec3 sky = mix(vec3(0.95, 0.35, 0.1), vec3(0.25, 0.5, 1.0), smoothstep(-0.05, 0.3, NL));
  col = mix(col, sky * 1.2 * smoothstep(-0.2, 0.25, NL), clamp(fres * 0.7 + 0.05 * day, 0.0, 1.0));
  gl_FragColor = vec4(col * uI, 1.0);
}`;
// 대기 바깥 껍질 (지구 원반 테두리 너머로 번지는 푸른 빛)
const ATMO_FS = /* glsl */`
uniform vec3 uSun;
uniform float uI;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  vec3 V = normalize(-vW);
  float ndv = dot(n, V);
  float rim = pow(clamp(1.0 - abs(ndv), 0.0, 1.0), 4.0);
  float NL = dot(n, uSun);
  vec3 c = mix(vec3(1.0, 0.4, 0.12), vec3(0.3, 0.55, 1.0), smoothstep(-0.1, 0.35, NL)) * smoothstep(-0.35, 0.2, NL);
  gl_FragColor = vec4(c * rim * 2.2 * uI, 1.0);   // AdditiveBlending 은 src alpha 를 곱함
}`;

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _cp = new THREE.Vector3();

export class Space {
  constructor(renderer, opts = {}) {
    const low = opts.quality === 'low';
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.001, 2e9);
    this.camPlanet = new THREE.Vector3();     // 카메라 행성 좌표 (m)
    this.time = 0;
    this.sunDir = SUN_DIR.clone();

    this._buildStars(low);
    this._buildMilkyWay(low);
    this._buildSun();
    this._buildMoon(low);
    this._buildEarth(low);

    this.bodies = {
      earth: { group: this.earth, radius: RE, center: new THREE.Vector3(0, 0, 0) },
      moon: { group: this.moon, radius: RM, center: MOON.pos.clone() },
      sun: { group: this.sun, radius: RS, center: SUN.pos.clone() },
    };
  }

  _buildStars(low) {
    const N = low ? 3500 : 9000;
    const pos = new Float32Array(N * 3), mag = new Float32Array(N), col = new Float32Array(N * 3);
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const v = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      // 일부는 은하면에 몰리게
      v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
      if (rnd() < 0.45) v.addScaledVector(GAL_N, -v.dot(GAL_N) * (0.75 + 0.2 * rnd())).normalize();
      pos[i * 3] = v.x * 1e8; pos[i * 3 + 1] = v.y * 1e8; pos[i * 3 + 2] = v.z * 1e8;
      mag[i] = 1.0 + 5.5 * Math.pow(rnd(), 0.45);
      // 색온도: 붉은 별 ~ 푸른 별
      const t = rnd();
      const c = t < 0.15 ? [1.0, 0.72, 0.5] : t < 0.45 ? [1.0, 0.9, 0.78] : t < 0.85 ? [0.95, 0.96, 1.0] : [0.72, 0.82, 1.0];
      col.set(c, i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    this.starUniforms = { uPR: { value: this.renderer.getPixelRatio() }, uVis: { value: 1 } };
    const m = new THREE.ShaderMaterial({
      vertexShader: STAR_VS, fragmentShader: STAR_FS, uniforms: this.starUniforms,
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    });
    this.stars = new THREE.Points(g, m);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -100;
    this.scene.add(this.stars);
  }

  _buildMilkyWay(low) {
    this.mwUniforms = { uGN: { value: GAL_N }, uGC: { value: GAL_C }, uVis: { value: 1 } };
    const m = new THREE.ShaderMaterial({
      vertexShader: MW_VS, fragmentShader: MW_FS, uniforms: this.mwUniforms, side: THREE.BackSide,
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    });
    this.milkyWay = new THREE.Mesh(new THREE.SphereGeometry(5e7, low ? 48 : 96, low ? 24 : 48), m);
    this.milkyWay.frustumCulled = false;
    this.milkyWay.renderOrder = -110;
    this.scene.add(this.milkyWay);
  }

  _buildSun() {
    this.sun = new THREE.Group();
    this.sunUniforms = { uTime: { value: 0 }, uI: { value: 1 } };
    const body = new THREE.Mesh(new THREE.SphereGeometry(RS, 48, 24), new THREE.ShaderMaterial({
      vertexShader: SUN_VS, fragmentShader: SUN_FS, uniforms: this.sunUniforms, depthTest: false, depthWrite: false,
    }));
    body.frustumCulled = false;
    this.glowUniforms = { uR: { value: 0.1 }, uI: { value: 1 } };
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: GLOW_VS, fragmentShader: GLOW_FS, uniforms: this.glowUniforms,
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    }));
    glow.frustumCulled = false;
    this.sunBody = body; this.sunGlow = glow;
    this.sun.add(body, glow);
    this.scene.add(this.sun);
  }

  _buildMoon(low) {
    this.moonUniforms = { uSun: { value: this.sunDir }, uI: { value: 1 } };
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(RM, low ? 64 : 128, low ? 32 : 64), new THREE.ShaderMaterial({
      vertexShader: BODY_VS, fragmentShader: MOON_FS, uniforms: this.moonUniforms, depthTest: false, depthWrite: false,
    }));
    this.moon.frustumCulled = false;
    this.scene.add(this.moon);
  }

  _buildEarth(low) {
    this.earth = new THREE.Group();
    const seoul = new THREE.Vector3(0, 1, 0);
    this.earthUniforms = { uSun: { value: this.sunDir }, uPole: { value: POLE }, uSeoul: { value: seoul }, uTime: { value: 0 }, uI: { value: 1 } };
    const surf = new THREE.Mesh(new THREE.SphereGeometry(RE, low ? 96 : 192, low ? 48 : 96), new THREE.ShaderMaterial({
      vertexShader: BODY_VS, fragmentShader: EARTH_FS, uniforms: this.earthUniforms, depthTest: false, depthWrite: false,
    }));
    surf.frustumCulled = false;
    this.atmoUniforms = { uSun: { value: this.sunDir }, uI: { value: 1 } };
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(RE + 90, low ? 64 : 128, low ? 32 : 64), new THREE.ShaderMaterial({
      vertexShader: BODY_VS, fragmentShader: ATMO_FS, uniforms: this.atmoUniforms,
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    }));
    atmo.frustumCulled = false;
    atmo.renderOrder = 1;
    this.earthSurf = surf; this.earthAtmo = atmo;
    this.earth.add(surf, atmo);
    this.scene.add(this.earth);
  }

  setBodyVisible(name, v) { const b = this.bodies[name]; if (b) b.group.visible = v; }

  // 행성 좌표 (m) → 우주 장면 좌표 (km, 카메라 기준)
  toCamera(pm, out) {
    return out.set((pm.x - this.camPlanet.x) / 1000, (pm.y - this.camPlanet.y) / 1000, (pm.z - this.camPlanet.z) / 1000);
  }

  update(dt, mainCamera, camAbs, altitude) {
    this.time += dt;
    flatToPlanet(camAbs.x, camAbs.y, camAbs.z, this.camPlanet);
    localToPlanetQuat(camAbs.x, camAbs.z, _q);
    const cam = this.camera;
    cam.quaternion.copy(_q).multiply(mainCamera.quaternion);
    cam.position.set(0, 0, 0);
    if (cam.fov !== mainCamera.fov || cam.aspect !== mainCamera.aspect) { cam.fov = mainCamera.fov; cam.aspect = mainCamera.aspect; }
    const alt = Math.max(0, altitude);

    // 천체 위치 (카메라 기준 km)
    this.toCamera(this.bodies.earth.center, this.earth.position);
    this.toCamera(this.bodies.moon.center, this.moon.position);
    this.toCamera(this.bodies.sun.center, this.sun.position);
    // 가까운 것을 나중에 (깊이 테스트 없이 가림)
    const dE = this.earth.position.length() - RE, dM = this.moon.position.length() - RM, dS = this.sun.position.length() - RS;
    const order = [[dE, this.earth], [dM, this.moon], [dS, this.sun]].sort((a, b) => b[0] - a[0]);
    for (let i = 0; i < 3; i++) {
      const o = order[i][1];
      o.renderOrder = i * 10;
      o.traverse((c) => { if (c !== o) c.renderOrder = i * 10 + (c === this.earthAtmo ? 2 : c === this.sunGlow ? 3 : 1); });
    }
    // 가까운 천체 표면까지 거리로 near 결정 (잘림 방지)
    const near = clamp(Math.min(dE, dM, dS) * 0.3, 1e-5, 500);
    if (Math.abs(cam.near - near) > near * 0.05) cam.near = near;
    cam.far = 2e9;
    cam.updateProjectionMatrix();

    // 해 글로우: 거리와 무관하게 해 원반보다 넉넉한 쿼드
    const ds = this.sun.position.length();
    const angR = Math.asin(clamp(RS / ds, 0, 1));
    const glowAng = Math.max(angR * 9, 0.09);
    const halfW = ds * Math.tan(Math.min(glowAng, 1.2));
    this.sunGlow.scale.set(halfW, halfW, 1);
    this.sunGlow.position.set(0, 0, 0);
    this.glowUniforms.uR.value = clamp(Math.tan(angR) / Math.tan(Math.min(glowAng, 1.2)), 0, 0.95);
    this.sunUniforms.uTime.value = this.time;
    this.earthUniforms.uTime.value = this.time;

    // 대기권 안에서는 낮하늘이 별을 가림 (world 하늘 돔이 불투명) → 여기서는 대기 투과만 근사
    const hk = smooth(15000, 90000, alt);
    this.starUniforms.uVis.value = 0.15 + 0.85 * hk;
    this.mwUniforms.uVis.value = hk;
    this.starUniforms.uPR.value = this.renderer.getPixelRatio();
    // 지구 대기 바깥 껍질은 대기권 밖에서만
    this.earthAtmo.visible = alt > 60000;
  }
}
