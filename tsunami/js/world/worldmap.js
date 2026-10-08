// 세계 지도 (2D 정거원통 투영) — 실제 세계 수심 · 육지 · 해안선 · 쓰나미 오버레이 렌더러 + 팬/줌/탭 상호작용
// 공유 WebGLRenderer 에 자체 Scene/OrthographicCamera 로 그린다. 월드 좌표 = (경도, 위도) 도 단위.
// 가로 순환: 바다는 전체 화면 셰이더(fract), 육지·선은 -360/0/+360 세 벌을 절두체 컬링.
import * as THREE from 'three';

const DEG = Math.PI / 180;
const KM_LAT = 110.57, KM_LON = 111.32;   // 위도·경도 1도 길이 (km)

// 품질 프리셋: 화면공간 해안 그림자, 바이큐빅 수심, 선 두께 배율
const QUAL = {
  low:    { shadow: 0,    bicubic: false, glowScale: 0.5, line: 1.0 },
  medium: { shadow: 0.5,  bicubic: false, glowScale: 0.5, line: 1.0 },
  high:   { shadow: 0.5,  bicubic: true,  glowScale: 0.5, line: 1.05 },
  ultra:  { shadow: 0.75, bicubic: true,  glowScale: 0.75, line: 1.1 },
};

const MAX_ZOOM = 40;

// ---------------------------------------------------------------- GLSL 조각
const FS_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// 임의 격자(R32F) 필드: 셀 중심 규약, 경계 (서, 북, 경도폭, 위도폭), 전구면이면 경도 순환
const fieldGLSL = (n) => /* glsl */`
uniform sampler2D t${n};
uniform vec2 u${n}Size;
uniform vec4 u${n}B;
uniform float u${n}Wrap;
float ${n}Tap(int x, int y) {
  int W = int(u${n}Size.x), H = int(u${n}Size.y);
  if (u${n}Wrap > 0.5) x = x < 0 ? x + W : (x >= W ? x - W : x);
  else x = clamp(x, 0, W - 1);
  return texelFetch(t${n}, ivec2(x, clamp(y, 0, H - 1)), 0).r;
}
// 반환: xy = 셀 좌표(정수부), zw = 보간 가중치. 영역 밖이면 x < -1e4
vec4 ${n}Cell(vec2 ll) {
  float fx = (ll.x - u${n}B.x) / u${n}B.z;
  float fy = (u${n}B.y - ll.y) / u${n}B.w;
  if (u${n}Wrap > 0.5) fx = fract(fx);
  else if (fx < 0.0 || fx > 1.0 || fy < 0.0 || fy > 1.0) return vec4(-1e5);
  vec2 p = vec2(fx, fy) * u${n}Size - 0.5;
  vec2 f = floor(p);
  return vec4(f, p - f);
}
float ${n}Bilin(vec2 ll) {
  vec4 c = ${n}Cell(ll);
  if (c.x < -1e4) return 0.0;
  int x = int(c.x), y = int(c.y);
  return mix(mix(${n}Tap(x, y), ${n}Tap(x + 1, y), c.z), mix(${n}Tap(x, y + 1), ${n}Tap(x + 1, y + 1), c.z), c.w);
}`;

const OCEAN_FRAG = /* glsl */`
precision highp float;
precision highp int;
varying vec2 vUv;
uniform sampler2D tElev;      // R32F 고도 (m)
uniform sampler2D tAux;       // RGBA8 r=음영 g=해안 근접
uniform sampler2D tMask;      // 화면공간 육지 마스크(블러)
uniform vec2 uCenter, uHalf, uRes;
uniform float uPPD, uDpr, uTime, uShadow, uRelief;
uniform vec2 uShadowOff;
uniform float uWaveOn, uArrOn;
${fieldGLSL('Wave')}
${fieldGLSL('Arr')}

const int EW = ${1024}, EH = ${512};
float eTap(int x, int y) {
  x = x < 0 ? x + EW : (x >= EW ? x - EW : x);
  return texelFetch(tElev, ivec2(x, clamp(y, 0, EH - 1)), 0).r;
}
float elevAt(vec2 ll) {
  vec2 p = vec2(fract((ll.x + 180.0) / 360.0) * float(EW), (90.0 - ll.y) / 180.0 * float(EH)) - 0.5;
  vec2 f = floor(p), t = p - f;
  int x = int(f.x), y = int(f.y);
#ifdef BICUBIC
  // 3차 B-스플라인 (16탭) — 고배율에서 마름모 무늬 없이 매끈
  vec4 wx, wy; vec4 tt;
  float t2 = t.x * t.x, t3 = t2 * t.x, s = 1.0 - t.x;
  wx = vec4(s * s * s, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t.x + 1.0, t3) / 6.0;
  t2 = t.y * t.y; t3 = t2 * t.y; s = 1.0 - t.y;
  wy = vec4(s * s * s, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t.y + 1.0, t3) / 6.0;
  float r = 0.0;
  for (int j = 0; j < 4; j++) {
    float row = wx.x * eTap(x - 1, y - 1 + j) + wx.y * eTap(x, y - 1 + j) + wx.z * eTap(x + 1, y - 1 + j) + wx.w * eTap(x + 2, y - 1 + j);
    r += wy[j] * row;
  }
  return r;
#else
  return mix(mix(eTap(x, y), eTap(x + 1, y), t.x), mix(eTap(x, y + 1), eTap(x + 1, y + 1), t.x), t.y);
#endif
}

// 수심 팔레트: 청록 대륙붕 → 심해 남색
vec3 oceanColor(float d) {
  float t = log2(1.0 + d / 40.0);
  vec3 c = mix(vec3(0.360, 0.662, 0.690), vec3(0.235, 0.553, 0.616), smoothstep(0.0, 1.81, t));   // 0 → 60 m
  c = mix(c, vec3(0.153, 0.420, 0.525), smoothstep(1.81, 2.58, t));                               // → 200 m
  c = mix(c, vec3(0.102, 0.302, 0.435), smoothstep(2.58, 4.70, t));                               // → 1000 m
  c = mix(c, vec3(0.071, 0.220, 0.365), smoothstep(4.70, 6.25, t));                               // → 3000 m
  c = mix(c, vec3(0.051, 0.169, 0.306), smoothstep(6.25, 6.82, t));                               // → 4500 m
  c = mix(c, vec3(0.036, 0.122, 0.247), smoothstep(6.82, 7.40, t));                               // → 6500 m+
  return c;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 ll = uCenter + (vUv * 2.0 - 1.0) * uHalf;
  ll.y = clamp(ll.y, -89.99, 89.99);
  float elev = elevAt(ll);
  float depth = max(-elev, 0.0);
  vec3 col = oceanColor(depth);

  // 해저 음영 (북서광)
  vec2 auv = vec2(fract((ll.x + 180.0) / 360.0), (90.0 - ll.y) / 180.0);
  vec4 aux = texture2D(tAux, auv);
  float relief = (aux.r - 0.5) * uRelief * smoothstep(20.0, 400.0, depth);
  col *= 1.0 + relief;

  // 등심선 (200 m 대륙붕단 · 2000 m) — 아주 옅게
  float lt = log2(1.0 + depth / 40.0);
  float fwl = max(fwidth(lt), 1e-4);
  float iso = 1.0 - smoothstep(0.4, 1.2, abs(lt - 2.585) / fwl);
  iso = max(iso, 0.6 * (1.0 - smoothstep(0.4, 1.2, abs(lt - 5.672) / fwl)));
  col = mix(col, vec3(0.55, 0.78, 0.82), iso * 0.10);

  // 해안 그림자 / 근접 후광
  vec2 suv = gl_FragCoord.xy / uRes;
  if (uShadow > 0.5) {
    float sh = texture2D(tMask, suv + uShadowOff).r;
    float m0 = texture2D(tMask, suv).r;
    col *= 1.0 - 0.42 * sh;
    col = mix(col, vec3(0.42, 0.70, 0.73), 0.10 * smoothstep(0.0, 0.5, m0) * (1.0 - sh));
  } else {
    col *= 1.0 - 0.22 * aux.g;
  }

  // 경위선 (30도) — 화면 픽셀 기준 일정 두께
  vec2 gd = abs(fract(ll / 30.0 + 0.5) - 0.5) * 30.0 * uPPD;
  float gw = 0.6 * uDpr;
  float grat = max(1.0 - smoothstep(gw * 0.5, gw * 0.5 + 1.0, gd.x), 1.0 - smoothstep(gw * 0.5, gw * 0.5 + 1.0, gd.y));
  col = mix(col, vec3(0.62, 0.78, 0.90), grat * 0.085);

  // 도달 시간 등시선 (1시간 간격, 6시간마다 조금 진하게)
  if (uArrOn > 0.5) {
    vec4 c = ArrCell(ll);
    if (c.x > -1e4) {
      int x = int(c.x), y = int(c.y);
      float a = ArrTap(x, y), b = ArrTap(x + 1, y), cc = ArrTap(x, y + 1), d = ArrTap(x + 1, y + 1);
      bool ok = a >= 0.0 && a < 1e8 && b >= 0.0 && b < 1e8 && cc >= 0.0 && cc < 1e8 && d >= 0.0 && d < 1e8;
      if (ok) {
        float T = mix(mix(a, b, c.z), mix(cc, d, c.z), c.w) / 3600.0;
        float fw = max(length(vec2(dFdx(T), dFdy(T))), 1e-5);
        float dl = abs(fract(T + 0.5) - 0.5) / fw;
        float major = abs(mod(floor(T + 0.5), 6.0)) < 0.5 ? 1.0 : 0.0;
        float line = 1.0 - smoothstep(0.35 * uDpr, 0.35 * uDpr + 1.0, dl);
        col = mix(col, vec3(0.86, 0.93, 1.0), line * (0.17 + 0.13 * major) * step(0.25, T));
      }
    }
  }

  // 쓰나미 파고: 마루 = 주황→빨강, 골 = 하늘→파랑, 불투명도 ∝ log|η| (1 cm .. 5 m)
  if (uWaveOn > 0.5) {
    float eta = WaveBilin(ll);
    float a = clamp(log(abs(eta) / 0.01) / 6.2146, 0.0, 1.0);
    if (a > 0.0) {
      float hi = smoothstep(0.45, 1.0, a);
      vec3 crest = mix(vec3(1.0, 0.76, 0.34), vec3(1.0, 0.24, 0.17), hi);
      crest = mix(crest, vec3(1.0, 0.16, 0.42), smoothstep(0.88, 1.0, a));
      vec3 trough = mix(vec3(0.42, 0.82, 1.0), vec3(0.30, 0.42, 1.0), hi);
      vec3 wc = eta > 0.0 ? crest : trough;
      col = mix(col, wc, pow(a, 1.15) * 0.9);
      col += wc * 0.22 * smoothstep(0.7, 1.0, a);
    }
  }

  // 은은한 비네트 + 디더 (어두운 그라데이션 띠 방지)
  vec2 vq = vUv - 0.5;
  col *= 1.0 - 0.22 * pow(clamp(length(vq * vec2(1.0, 1.15)) * 1.25, 0.0, 1.0), 2.4);
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 17.0) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

const LAND_VERT = /* glsl */`
varying vec2 vLL;
void main() {
  vec4 wp = modelMatrix * vec4(position.xy, 0.0, 1.0);
  vLL = vec2(position.x, position.y);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const LAND_FRAG = /* glsl */`
precision highp float;
varying vec2 vLL;
uniform sampler2D tMask;
uniform vec2 uRes, uBevel;
uniform float uShadow, uPPD, uDpr;
void main() {
  // 따뜻한 밝은 중성색, 고위도는 차가운 흰빛
  vec3 c = vec3(0.918, 0.898, 0.861);
  float polar = smoothstep(58.0, 76.0, abs(vLL.y));
  c = mix(c, vec3(0.925, 0.937, 0.945), polar);
  c *= 1.0 - 0.025 * smoothstep(0.0, 35.0, 35.0 - abs(vLL.y - 5.0)); // 저위도 아주 살짝 따뜻하게
  if (uShadow > 0.5) {
    vec2 suv = gl_FragCoord.xy / uRes;
    float m = texture2D(tMask, suv).r;
    float lit = texture2D(tMask, suv + uBevel).r;   // 빛 반대쪽
    float drk = texture2D(tMask, suv - uBevel).r;   // 빛 쪽
    float rim = 1.0 - smoothstep(0.5, 0.97, m);
    c *= 1.0 - 0.075 * rim;
    c *= 1.0 + 0.11 * (lit - drk);                 // 엠보스: 빛 받는 해안은 밝게, 반대편은 어둡게
  }
  vec2 gd = abs(fract(vLL / 30.0 + 0.5) - 0.5) * 30.0 * uPPD;
  float gw = 0.6 * uDpr;
  float grat = max(1.0 - smoothstep(gw * 0.5, gw * 0.5 + 1.0, gd.x), 1.0 - smoothstep(gw * 0.5, gw * 0.5 + 1.0, gd.y));
  c *= 1.0 - 0.035 * grat;
  gl_FragColor = vec4(c, 1.0);
}`;

const MASK_FRAG = /* glsl */`void main() { gl_FragColor = vec4(1.0); }`;

// 13탭 가우시안 (선형 샘플링 7회)
const BLUR_FRAG = /* glsl */`
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uDir;
void main() {
  float s = texture2D(tSrc, vUv).r * 0.196482;
  s += (texture2D(tSrc, vUv + uDir * 1.411765).r + texture2D(tSrc, vUv - uDir * 1.411765).r) * 0.296907;
  s += (texture2D(tSrc, vUv + uDir * 3.294118).r + texture2D(tSrc, vUv - uDir * 3.294118).r) * 0.094470;
  s += (texture2D(tSrc, vUv + uDir * 5.176471).r + texture2D(tSrc, vUv - uDir * 5.176471).r) * 0.010381;
  gl_FragColor = vec4(s, s, s, 1.0);
}`;

// 인스턴스 선분: 화면공간에서 일정 두께로 확장, AA 가장자리
const SEG_VERT = /* glsl */`
attribute vec2 aA;
attribute vec2 aB;
uniform vec2 uRes;
uniform float uWidth;
varying float vD;
varying float vHW;
void main() {
  mat4 pm = projectionMatrix * modelViewMatrix;
  vec2 sa = (pm * vec4(aA, 0.0, 1.0)).xy * 0.5 * uRes;
  vec2 sb = (pm * vec4(aB, 0.0, 1.0)).xy * 0.5 * uRes;
  vec2 d = sb - sa;
  float L = length(d);
  vec2 dir = L > 1e-5 ? d / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float hw = 0.5 * uWidth + 0.75;
  vec2 p = (position.x < 0.5 ? sa - dir * 0.5 * hw : sb + dir * 0.5 * hw) + nrm * position.y * hw;
  vD = position.y * hw; vHW = 0.5 * uWidth;
  gl_Position = vec4(p / (0.5 * uRes), 0.0, 1.0);
}`;

const SEG_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uOpacity;
varying float vD;
varying float vHW;
void main() {
  float a = clamp(vHW + 0.5 - abs(vD), 0.0, 1.0);
  gl_FragColor = vec4(uColor, a * uOpacity);
}`;

// 최대 파고 해안 하이라이트: 해안 선분 중점 주변 3×3 셀 최댓값 → 색·두께
const GLOW_VERT = /* glsl */`
precision highp float;
precision highp int;
attribute vec2 aA;
attribute vec2 aB;
uniform vec2 uRes;
uniform float uDpr, uMin;
${fieldGLSL('Max')}
varying float vD;
varying float vHW;
varying float vLv;
void main() {
  vec2 mid = 0.5 * (aA + aB);
  vec4 c = MaxCell(mid);
  float m = 0.0;
  if (c.x > -1e4) {
    int x = int(c.x + 0.5), y = int(c.y + 0.5);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) m = max(m, abs(MaxTap(x + i, y + j)));
  }
  if (!(m >= uMin)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vD = 0.0; vHW = 0.0; vLv = 0.0; return; }
  float lv = clamp(log(m / uMin) / log(5.0 / uMin), 0.0, 1.0);
  vLv = lv;
  mat4 pm = projectionMatrix * modelViewMatrix;
  vec2 sa = (pm * vec4(aA, 0.0, 1.0)).xy * 0.5 * uRes;
  vec2 sb = (pm * vec4(aB, 0.0, 1.0)).xy * 0.5 * uRes;
  vec2 d = sb - sa;
  float L = length(d);
  vec2 dir = L > 1e-5 ? d / L : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float hw = (3.0 + 9.0 * lv) * uDpr;
  vec2 p = (position.x < 0.5 ? sa - dir * hw : sb + dir * hw) + nrm * position.y * hw;
  vD = position.y * hw; vHW = hw;
  gl_Position = vec4(p / (0.5 * uRes), 0.0, 1.0);
}`;

const GLOW_FRAG = /* glsl */`
varying float vD;
varying float vHW;
varying float vLv;
vec3 lvColor(float l) {
  vec3 c = mix(vec3(1.0, 0.86, 0.32), vec3(1.0, 0.56, 0.16), smoothstep(0.0, 0.35, l));
  c = mix(c, vec3(1.0, 0.20, 0.18), smoothstep(0.35, 0.7, l));
  return mix(c, vec3(0.95, 0.20, 0.85), smoothstep(0.75, 1.0, l));
}
void main() {
  float r = abs(vD) / max(vHW, 1e-3);
  float a = exp(-r * r * 3.2) * (0.55 + 0.45 * vLv);
  gl_FragColor = vec4(lvColor(vLv) * a, a);   // 사전곱 알파 → MAX 합성
}`;

const COMPOSE_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uRes;
uniform float uPulse;
void main() {
  vec4 g = texture2D(tSrc, gl_FragCoord.xy / uRes);
  gl_FragColor = g * uPulse;
}`;

// 발생원 미리보기 (회전 타원 / 원): 점선 외곽 + 부드러운 채움 + 진앙 점
const PREVIEW_VERT = /* glsl */`
varying vec2 vLL;
void main() {
  vec4 wp = modelMatrix * vec4(position.xy, 0.0, 1.0);
  vLL = wp.xy;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const PREVIEW_FRAG = /* glsl */`
precision highp float;
varying vec2 vLL;
uniform vec2 uC;       // 중심 (경도, 위도) — 메시와 같은 사본 기준
uniform vec2 uAx;      // 반축 (km): x = 주향 방향, y = 수직
uniform float uStrike; // 라디안 (북→시계)
uniform float uDash, uTime, uDpr;
uniform vec3 uCol;
void main() {
  vec2 dkm = vec2((vLL.x - uC.x) * ${KM_LON} * cos(radians(vLL.y)), (vLL.y - uC.y) * ${KM_LAT});
  float s = sin(uStrike), c = cos(uStrike);
  vec2 q = vec2(dkm.x * s + dkm.y * c, dkm.x * c - dkm.y * s);
  float k1 = length(q / uAx), k2 = length(q / (uAx * uAx));
  float dk = k1 * (k1 - 1.0) / max(k2, 1e-6);
  float px = dk / max(length(vec2(dFdx(dk), dFdy(dk))), 1e-6);   // 외곽선까지 화면 픽셀 거리
  float th = atan(q.y / uAx.y, q.x / uAx.x);
  float dash = step(0.42, fract(th / 6.2831853 * uDash - uTime * 0.35));
  float lw = 1.1 * uDpr;
  float line = (1.0 - smoothstep(lw, lw + 1.0, abs(px))) * dash;
  float halo = (1.0 - smoothstep(0.0, 6.0 * uDpr, abs(px))) * 0.25;
  float fill = (k1 < 1.0 ? 0.13 + 0.10 * smoothstep(0.2, 1.0, k1) : 0.0) * smoothstep(0.0, 1.0, -px);
  // 진앙 점 + 주향 표시선
  float rc = length(vec2(dFdx(dk), dFdy(dk)));
  float cpx = length(dkm) / max(rc, 1e-6);
  float dot_ = 1.0 - smoothstep(2.6 * uDpr, 2.6 * uDpr + 1.0, cpx);
  float ring = (1.0 - smoothstep(0.7 * uDpr, 0.7 * uDpr + 1.0, abs(cpx - 5.5 * uDpr))) * 0.8;
  float a = max(max(line, dot_), max(ring, max(fill, halo * dash)));
  vec3 col = mix(uCol, vec3(1.0), max(dot_, line * 0.35));
  gl_FragColor = vec4(col, a * 0.95);
}`;

const CITY_FRAG = /* glsl */`
precision highp float;
varying vec2 vLL;
uniform vec2 uC;
uniform float uPPD, uDpr, uTime;
void main() {
  float r = length(vLL - uC) * uPPD;   // 화면 픽셀 (정거원통: 경·위도 같은 축척)
  float ph = fract(uTime * 0.55);
  float R = (6.0 + 22.0 * ph) * uDpr;
  float ring = (1.0 - smoothstep(0.8 * uDpr, 0.8 * uDpr + 1.2, abs(r - R))) * (1.0 - ph) * 0.8;
  float glow = exp(-r * r / (60.0 * uDpr * uDpr)) * 0.35;
  gl_FragColor = vec4(vec3(1.0, 0.96, 0.88), max(ring, glow));
}`;

// ---------------------------------------------------------------- 보조 함수
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapLon = (l) => ((((l + 180) % 360) + 360) % 360) - 180;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function makeFieldUniforms(n) {
  return {
    ['t' + n]: { value: null },
    ['u' + n + 'Size']: { value: new THREE.Vector2(1, 1) },
    ['u' + n + 'B']: { value: new THREE.Vector4(-180, 90, 360, 180) },
    ['u' + n + 'Wrap']: { value: 1 },
  };
}

function segGeometry(segs) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  const ib = new THREE.InstancedInterleavedBuffer(segs, 4);
  g.setAttribute('aA', new THREE.InterleavedBufferAttribute(ib, 2, 0));
  g.setAttribute('aB', new THREE.InterleavedBufferAttribute(ib, 2, 2));
  g.instanceCount = segs.length / 4;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 202);
  return g;
}

// 수심 음영 · 해안 근접 보조 텍스처 (CPU 1회)
function buildAux(data) {
  const { W, H, elev } = data;
  const out = new Uint8Array(W * H * 4);
  const z = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) z[k] = elev[k] < 0 ? elev[k] : 0;
  const cellM = (180 / H) * KM_LAT * 1000;
  const shade = new Float32Array(W * H);
  const L = [-0.62, 0.62, 0.48], ex = 22;
  const Ln = Math.hypot(L[0], L[1], L[2]);
  for (let j = 0; j < H; j++) {
    const lat = 90 - ((j + 0.5) * 180) / H;
    const dxm = cellM * Math.max(0.15, Math.cos(lat * DEG));
    const jn = j > 0 ? j - 1 : j, js = j < H - 1 ? j + 1 : j;
    for (let i = 0; i < W; i++) {
      const ie = i < W - 1 ? i + 1 : 0, iw = i > 0 ? i - 1 : W - 1;
      const gx = ((z[j * W + ie] - z[j * W + iw]) / (2 * dxm)) * ex;
      const gy = ((z[jn * W + i] - z[js * W + i]) / ((js - jn) * cellM || 1)) * ex;
      const nl = Math.hypot(gx, gy, 1);
      const s = (-gx * L[0] - gy * L[1] + L[2]) / (nl * Ln);
      shade[j * W + i] = s - L[2] / Ln;
    }
  }
  // 3×3 블러 후 저장
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      let s = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = clamp(j + dj, 0, H - 1);
        for (let di = -1; di <= 1; di++) s += shade[jj * W + ((i + di + W) % W)] * (dj === 0 && di === 0 ? 4 : dj === 0 || di === 0 ? 2 : 1);
      }
      out[(j * W + i) * 4] = clamp(Math.round(127.5 + (s / 16) * 340), 0, 255);
    }
  }
  // 해안 근접 (모따기 거리, 셀 단위)
  const dist = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) dist[k] = elev[k] >= 0 ? 0 : 99;
  const D1 = 1, D2 = 1.4142;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    let d = dist[k];
    if (i > 0) d = Math.min(d, dist[k - 1] + D1);
    if (j > 0) {
      d = Math.min(d, dist[k - W] + D1);
      if (i > 0) d = Math.min(d, dist[k - W - 1] + D2);
      if (i < W - 1) d = Math.min(d, dist[k - W + 1] + D2);
    }
    dist[k] = d;
  }
  for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
    const k = j * W + i;
    let d = dist[k];
    if (i < W - 1) d = Math.min(d, dist[k + 1] + D1);
    if (j < H - 1) {
      d = Math.min(d, dist[k + W] + D1);
      if (i < W - 1) d = Math.min(d, dist[k + W + 1] + D2);
      if (i > 0) d = Math.min(d, dist[k + W - 1] + D2);
    }
    dist[k] = d;
  }
  for (let k = 0; k < W * H; k++) {
    out[k * 4 + 1] = elev[k] >= 0 ? 255 : Math.round(255 * Math.exp(-(dist[k] - 0.5) / 1.3));
    out[k * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function floatTex(data, w, h) {
  const t = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.FloatType);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- 본체
export class WorldMap {
  /**
   * @param {THREE.WebGLRenderer} renderer 게임과 공유하는 렌더러
   * @param {object} data loadWorldData() 결과
   * @param {{quality?: 'low'|'medium'|'high'|'ultra'}} opts
   */
  constructor(renderer, data, { quality = 'medium' } = {}) {
    this.renderer = renderer;
    this.data = data;
    this.quality = QUAL[quality] ? quality : 'medium';
    this.q = QUAL[this.quality];
    /** 현재 시점: 중심 경위도, 확대(1 = 세계가 화면을 덮는 최소 배율) */
    this.view = { lon: 140, lat: 25, zoom: 2 };
    this.minZoom = 1;
    this.maxZoom = MAX_ZOOM;
    /** 드래그 없는 탭: (lon, lat, sx, sy) — sx, sy 는 요소 기준 CSS 픽셀 */
    this.onTap = null;
    /** 사용자 조작으로 시점이 바뀔 때 (선택) */
    this.onUserMove = null;
    this.width = 1; this.height = 1; this.dpr = 1;
    this._time = 0;
    this._last = -1;
    this._fly = null;
    this._zt = null;            // 휠 줌 목표 {z, ax, ay, lon, lat}
    this._vel = [0, 0];         // 관성 (도/초)
    this._ptrs = new Map();
    this._hist = { x: new Float32Array(8), y: new Float32Array(8), t: new Float64Array(8), n: 0 };
    this._city = null;
    this._dirtyMask = true;
    this._dirtyGlow = false;
    this._maskKey = '';
    this._tmpColor = new THREE.Color();
    this._tmpV2 = new THREE.Vector2();
    this._ll = { lon: 0, lat: 0 };

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.camera.position.set(0, 0, 5);

    // 고도 텍스처 (R32F, texelFetch 수동 보간)
    const { W, H, elev } = data;
    const ef = new Float32Array(W * H);
    for (let k = 0; k < W * H; k++) ef[k] = elev[k];
    this.elevTex = floatTex(ef, W, H);
    this.auxTex = buildAux(data);
    const dummy = floatTex(new Float32Array(4), 2, 2);
    this._dummy = dummy;

    this._fields = {};
    const sq = this.q.shadow > 0;
    this.uniforms = {
      tElev: { value: this.elevTex }, tAux: { value: this.auxTex }, tMask: { value: null },
      uCenter: { value: new THREE.Vector2() }, uHalf: { value: new THREE.Vector2(1, 1) }, uRes: { value: new THREE.Vector2(1, 1) },
      uPPD: { value: 1 }, uDpr: { value: 1 }, uTime: { value: 0 }, uShadow: { value: sq ? 1 : 0 }, uRelief: { value: 0.34 },
      uShadowOff: { value: new THREE.Vector2() }, uBevel: { value: new THREE.Vector2() },
      uWaveOn: { value: 0 }, uArrOn: { value: 0 },
      ...makeFieldUniforms('Wave'), ...makeFieldUniforms('Arr'),
    };
    this.uniforms.tWave.value = dummy; this.uniforms.tArr.value = dummy;
    const U = this.uniforms;

    // 1) 바다 (전체 화면)
    const fsGeo = new THREE.PlaneGeometry(2, 2);
    this._fsGeo = fsGeo;
    this.oceanMat = new THREE.ShaderMaterial({
      uniforms: U, vertexShader: FS_VERT, fragmentShader: OCEAN_FRAG,
      defines: this.q.bicubic ? { BICUBIC: 1 } : {}, depthTest: false, depthWrite: false,
    });
    this.ocean = new THREE.Mesh(fsGeo, this.oceanMat);
    this.ocean.frustumCulled = false;
    this.ocean.renderOrder = 0;
    this.scene.add(this.ocean);

    // 2) 육지 (벡터 삼각망, 3벌)
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(data.landPos, 2));
    lg.setIndex(new THREE.BufferAttribute(data.landIdx, 1));
    lg.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 202);
    this._landGeo = lg;
    this.landMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: LAND_VERT, fragmentShader: LAND_FRAG, depthTest: false, depthWrite: false });
    this.maskMat = new THREE.ShaderMaterial({ vertexShader: LAND_VERT, fragmentShader: MASK_FRAG, depthTest: false, depthWrite: false });
    this._maskScene = new THREE.Scene();
    for (const off of [-360, 0, 360]) {
      const m = new THREE.Mesh(lg, this.landMat);
      m.position.x = off; m.renderOrder = 1;
      this.scene.add(m);
      const mm = new THREE.Mesh(lg, this.maskMat);
      mm.position.x = off;
      this._maskScene.add(mm);
    }

    // 3) 국경 · 해안선 (인스턴스 선분)
    const lineMat = (color, opacity, width, order) => new THREE.ShaderMaterial({
      uniforms: { uRes: U.uRes, uWidth: { value: width }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
      vertexShader: SEG_VERT, fragmentShader: SEG_FRAG, transparent: true, depthTest: false, depthWrite: false,
    });
    this._borderGeo = segGeometry(data.borders);
    this._coastGeo = segGeometry(data.coast);
    this.borderMat = lineMat(0xa69c8c, 0.85, 0.8, 2);
    this.coastMat = lineMat(0x5b6e7a, 0.9, 1.0, 3);
    this._lineW = { border: 0.75, coast: 0.95 };
    for (const off of [-360, 0, 360]) {
      const b = new THREE.Mesh(this._borderGeo, this.borderMat);
      b.position.x = off; b.renderOrder = 2;
      const c = new THREE.Mesh(this._coastGeo, this.coastMat);
      c.position.x = off; c.renderOrder = 3;
      this.scene.add(b, c);
    }

    // 4) 최대 파고 해안 하이라이트 (오프스크린 MAX 합성 → 1회 합성)
    this.glowU = { uRes: { value: new THREE.Vector2(1, 1) }, uDpr: { value: 1 }, uMin: { value: 0.05 }, ...makeFieldUniforms('Max') };
    this.glowU.tMax.value = dummy;
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: this.glowU, vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendEquationAlpha: THREE.MaxEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this._glowScene = new THREE.Scene();
    for (const off of [-360, 0, 360]) {
      const g = new THREE.Mesh(this._coastGeo, this.glowMat);
      g.position.x = off;
      this._glowScene.add(g);
    }
    this.composeMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uRes: U.uRes, uPulse: { value: 1 } },
      vertexShader: FS_VERT, fragmentShader: COMPOSE_FRAG, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.glowQuad = new THREE.Mesh(fsGeo, this.composeMat);
    this.glowQuad.frustumCulled = false;
    this.glowQuad.renderOrder = 4;
    this.glowQuad.visible = false;
    this.scene.add(this.glowQuad);

    // 5) 발생원 미리보기
    const quad = new THREE.PlaneGeometry(2, 2);
    this._quadGeo = quad;
    this.previewU = {
      uC: { value: new THREE.Vector2() }, uAx: { value: new THREE.Vector2(1, 1) }, uStrike: { value: 0 },
      uDash: { value: 24 }, uTime: U.uTime, uDpr: U.uDpr, uCol: { value: new THREE.Color(1.0, 0.78, 0.36) },
    };
    this.previewMat = new THREE.ShaderMaterial({
      uniforms: this.previewU, vertexShader: PREVIEW_VERT, fragmentShader: PREVIEW_FRAG, transparent: true, depthTest: false, depthWrite: false,
    });
    this.preview = new THREE.Mesh(quad, this.previewMat);
    this.preview.renderOrder = 5;
    this.preview.visible = false;
    this.preview.frustumCulled = false;
    this.scene.add(this.preview);
    this._src = null;

    // 6) 도시 위치 맥동 링 (HTML 마커 아래)
    this.cityU = { uC: { value: new THREE.Vector2() }, uPPD: U.uPPD, uDpr: U.uDpr, uTime: U.uTime };
    this.cityMat = new THREE.ShaderMaterial({
      uniforms: this.cityU, vertexShader: PREVIEW_VERT, fragmentShader: CITY_FRAG, transparent: true, depthTest: false, depthWrite: false,
    });
    this.cityMesh = new THREE.Mesh(quad, this.cityMat);
    this.cityMesh.renderOrder = 6;
    this.cityMesh.visible = false;
    this.cityMesh.frustumCulled = false;
    this.scene.add(this.cityMesh);
    /** 맥동 링 표시 여부 (HTML 마커만 쓰려면 false) */
    this.cityPulse = true;

    // 화면공간 그림자 렌더 타깃
    this._fsScene = new THREE.Scene();
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
      vertexShader: FS_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
    });
    this._fsQuad = new THREE.Mesh(fsGeo, this.blurMat);
    this._fsQuad.frustumCulled = false;
    this._fsScene.add(this._fsQuad);
    const rtOpts = { depthBuffer: false, stencilBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this._rtA = sq ? new THREE.WebGLRenderTarget(4, 4, rtOpts) : null;
    this._rtB = sq ? new THREE.WebGLRenderTarget(4, 4, rtOpts) : null;
    this._rtGlow = new THREE.WebGLRenderTarget(4, 4, rtOpts);
    U.tMask.value = sq ? this._rtA.texture : dummy;
    this.composeMat.uniforms.tSrc.value = this._rtGlow.texture;

    // 상호작용 핸들러 (한 번만 생성)
    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e);
    this._onWheel = (e) => this._wheel(e);
    this._onCtx = (e) => e.preventDefault();
    this.dom = null;

    const sz = renderer.getSize(this._tmpV2);
    this.setSize(sz.x, sz.y);
    this.resetView();
  }

  // ------------------------------------------------------------ 시점
  /** 세계가 화면을 덮는 최소 배율에서의 CSS px/도 */
  get minPPD() { return Math.max(this.height / 180, this.width / 360); }
  /** 현재 CSS px/도 */
  get ppd() { return this.minPPD * this.view.zoom; }

  /** 기본 시점: 동아시아 + 태평양 (경도 140, 위도 25) */
  resetView() {
    const fit = Math.min(this.width / 140, this.height / 85) / this.minPPD;
    this.view.lon = 140; this.view.lat = 25;
    this.view.zoom = clamp(Math.max(fit, 1.55), this.minZoom, this.maxZoom);
    this._fly = null; this._zt = null; this._vel[0] = this._vel[1] = 0;
    this._clampView();
  }

  _clampView() {
    const v = this.view;
    v.zoom = clamp(v.zoom || 1, this.minZoom, this.maxZoom);
    v.lon = wrapLon(v.lon);
    const hh = this.height / 2 / this.ppd;
    const m = 90 - hh;
    v.lat = m <= 0 ? 0 : clamp(v.lat, -m, m);
  }

  setSize(w, h) {
    this.width = Math.max(1, w); this.height = Math.max(1, h);
    this.dpr = this.renderer.getPixelRatio();
    const bw = Math.max(1, Math.round(this.width * this.dpr)), bh = Math.max(1, Math.round(this.height * this.dpr));
    this.uniforms.uRes.value.set(bw, bh);
    this.glowU.uRes.value.set(bw, bh);
    this.uniforms.uDpr.value = this.dpr;
    this.glowU.uDpr.value = this.dpr;
    if (this._rtA) {
      const s = this.q.shadow;
      this._rtA.setSize(Math.max(4, Math.round(bw * s)), Math.max(4, Math.round(bh * s)));
      this._rtB.setSize(Math.max(4, Math.round(bw * s)), Math.max(4, Math.round(bh * s)));
    }
    const gs = this.q.glowScale;
    this._rtGlow.setSize(Math.max(4, Math.round(bw * gs)), Math.max(4, Math.round(bh * gs)));
    this._dirtyMask = true; this._dirtyGlow = true;
    this._clampView();
  }

  /** 화면(요소 기준 CSS px) → 경위도. out 을 넘기면 재사용 */
  screenToLonLat(x, y, out = {}) {
    const p = this.ppd;
    out.lon = wrapLon(this.view.lon + (x - this.width / 2) / p);
    out.lat = clamp(this.view.lat - (y - this.height / 2) / p, -90, 90);
    return out;
  }

  /** 경위도 → 화면(CSS px). 시점 중심에 가장 가까운 순환 사본 기준 */
  lonLatToScreen(lon, lat, out = {}) {
    const p = this.ppd;
    let dl = lon - this.view.lon;
    dl -= 360 * Math.round(dl / 360);
    out.x = this.width / 2 + dl * p;
    out.y = this.height / 2 - (lat - this.view.lat) * p;
    out.visible = out.x >= 0 && out.x <= this.width && out.y >= 0 && out.y <= this.height;
    return out;
  }

  /** 부드럽게 이동 (seconds = 0 이면 즉시). zoom 생략 시 현재 배율 유지 */
  flyTo(lon, lat, zoom = this.view.zoom, seconds = 1.2) {
    const v = this.view;
    let dl = wrapLon(lon) - v.lon;
    dl -= 360 * Math.round(dl / 360);
    const z1 = clamp(zoom, this.minZoom, this.maxZoom);
    this._zt = null; this._vel[0] = this._vel[1] = 0;
    if (!(seconds > 0)) {
      v.lon = v.lon + dl; v.lat = lat; v.zoom = z1; this._fly = null;
      this._clampView(); return;
    }
    const z0 = v.zoom;
    const distPx = Math.hypot(dl, lat - v.lat) * this.minPPD * Math.min(z0, z1);
    const ref = Math.hypot(this.width, this.height) * 0.6;
    const bump = distPx > ref ? Math.log(distPx / ref) * 0.75 : 0;
    this._fly = { t: 0, dur: seconds, lon0: v.lon, lat0: v.lat, dl, lat1: lat, lz0: Math.log(z0), lz1: Math.log(z1), bump };
  }

  _update(dt) {
    const v = this.view;
    if (this._fly) {
      const f = this._fly;
      f.t += dt;
      const t = Math.min(1, f.t / f.dur), e = ease(t);
      v.lon = f.lon0 + f.dl * e;
      v.lat = f.lat0 + (f.lat1 - f.lat0) * e;
      v.zoom = Math.exp(f.lz0 + (f.lz1 - f.lz0) * e - f.bump * Math.sin(Math.PI * t));
      if (t >= 1) this._fly = null;
    } else if (this._zt) {
      const z = this._zt;
      const k = 1 - Math.exp(-dt * 14);
      const lz = Math.log(v.zoom), lt = Math.log(z.z);
      v.zoom = Math.abs(lt - lz) < 1e-3 ? z.z : Math.exp(lz + (lt - lz) * k);
      const p = this.minPPD * v.zoom;
      v.lon = z.lon - (z.ax - this.width / 2) / p;
      v.lat = z.lat + (z.ay - this.height / 2) / p;
      if (v.zoom === z.z) this._zt = null;
    }
    if (this._ptrs.size === 0 && (this._vel[0] || this._vel[1])) {
      v.lon += this._vel[0] * dt; v.lat += this._vel[1] * dt;
      const d = Math.exp(-dt * 4.2);
      this._vel[0] *= d; this._vel[1] *= d;
      if (Math.hypot(this._vel[0], this._vel[1]) * this.ppd < 4) this._vel[0] = this._vel[1] = 0;
    }
    this._clampView();
  }

  // ------------------------------------------------------------ 데이터 오버레이
  _setField(n, uniforms, arr, w, h, bounds) {
    const tKey = 't' + n;
    let tex = this._fields[n];
    if (!arr) {
      if (tex) { tex.dispose(); this._fields[n] = null; }
      uniforms[tKey].value = this._dummy;
      return false;
    }
    if (arr.length < w * h) throw new Error(`${n}: 배열 길이 < w*h`);
    const f32 = arr instanceof Float32Array ? arr : Float32Array.from(arr);
    if (!tex || tex.image.width !== w || tex.image.height !== h) {
      if (tex) tex.dispose();
      tex = this._fields[n] = floatTex(f32, w, h);
    } else {
      tex.image.data = f32;
      tex.needsUpdate = true;
    }
    uniforms[tKey].value = tex;
    uniforms['u' + n + 'Size'].value.set(w, h);
    const b = bounds || { west: -180, north: 90, east: 180, south: -90 };
    uniforms['u' + n + 'B'].value.set(b.west, b.north, b.east - b.west, b.north - b.south);
    uniforms['u' + n + 'Wrap'].value = b.east - b.west >= 359.999 ? 1 : 0;
    return true;
  }

  /**
   * 쓰나미 수면 변위(m) 격자. 기본 규약: 전구면, 열 0 = 경도 -180, 행 0 = 위도 +90, 셀 중심.
   * 배열은 복사하지 않고 참조 → 내용 갱신 후 다시 호출하면 재업로드. null 이면 끔.
   * bounds({west, north, east, south}, 셀 가장자리 기준)로 부분 영역도 가능.
   */
  setWave(eta, w = this.data.W, h = this.data.H, bounds = null) {
    this.uniforms.uWaveOn.value = this._setField('Wave', this.uniforms, eta, w, h, bounds) ? 1 : 0;
  }

  /** 최대 파고(m) 격자 → 해안선 발광 하이라이트 (0.05 m 이상). null 이면 끔 */
  setMax(maxEta, w = this.data.W, h = this.data.H, bounds = null) {
    const on = this._setField('Max', this.glowU, maxEta, w, h, bounds);
    this.glowQuad.visible = on;
    this._dirtyGlow = on;
  }

  /** 도달 시간(초) 격자 → 1시간 간격 등시선. 미도달은 음수/NaN/Infinity/≥1e8. null 이면 끔 */
  setArrival(arr, w = this.data.W, h = this.data.H, bounds = null) {
    this.uniforms.uArrOn.value = this._setField('Arr', this.uniforms, arr, w, h, bounds) ? 1 : 0;
  }

  /**
   * 발생원 미리보기. src = { lon, lat, length_km, width_km, strike_deg } (타원) 또는
   * { lon, lat, radius_km } (원, 운석 충돌 등). null 이면 숨김. color(선택) = CSS 색/hex
   */
  setPreview(src) {
    this._src = src || null;
    if (!src) { this.preview.visible = false; return; }
    let a, b;
    if (src.length_km > 0 && src.width_km > 0) { a = src.length_km / 2; b = src.width_km / 2; }
    else { a = b = src.radius_km > 0 ? src.radius_km : src.diameter_km > 0 ? src.diameter_km / 2 : 50; }
    this.previewU.uAx.value.set(Math.max(a, 0.5), Math.max(b, 0.5));
    this.previewU.uStrike.value = (src.strike_deg || 0) * DEG;
    if (src.color !== undefined) this.previewU.uCol.value.set(src.color);
    else this.previewU.uCol.value.setRGB(1.0, 0.78, 0.36);
    this._srcR = Math.max(a, b);
    this.preview.visible = true;
  }

  /** 플레이 도시 위치 (HTML 마커는 cityScreen() 으로 배치). null 이면 숨김 */
  setCity(c) {
    this._city = c ? { lon: c.lon, lat: c.lat } : null;
    this.cityMesh.visible = !!c && this.cityPulse;
  }

  /** 도시의 화면 좌표 {x, y, visible} (CSS px) 또는 null */
  cityScreen(out = {}) {
    if (!this._city) return null;
    return this.lonLatToScreen(this._city.lon, this._city.lat, out);
  }

  // ------------------------------------------------------------ 렌더
  _nearestCopy(lon) {
    let d = lon - this.view.lon;
    d -= 360 * Math.round(d / 360);
    return this.view.lon + d;
  }

  render() {
    const now = performance.now();
    const dt = this._last < 0 ? 0 : Math.min(0.1, (now - this._last) / 1000);
    this._last = now;
    this._time += dt;
    this._update(dt);

    const r = this.renderer, U = this.uniforms, v = this.view;
    const p = this.ppd, hw = this.width / 2 / p, hh = this.height / 2 / p;
    const cam = this.camera;
    cam.left = -hw; cam.right = hw; cam.top = hh; cam.bottom = -hh;
    cam.position.set(v.lon, v.lat, 5);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    U.uCenter.value.set(v.lon, v.lat);
    U.uHalf.value.set(hw, hh);
    U.uPPD.value = p * this.dpr;
    U.uTime.value = this._time;
    const res = U.uRes.value;
    const so = 3.2 * this.dpr;  // 그림자 오프셋 (픽셀)
    U.uShadowOff.value.set(-so / res.x, so / res.y);
    U.uBevel.value.set(1.6 * this.dpr / res.x, -1.6 * this.dpr / res.y);
    const lw = this.q.line * this.dpr;
    this.coastMat.uniforms.uWidth.value = this._lineW.coast * lw * (1 + 0.25 * clamp(Math.log2(v.zoom) / 5, 0, 1));
    this.borderMat.uniforms.uWidth.value = this._lineW.border * lw;
    this.borderMat.uniforms.uOpacity.value = 0.55 + 0.35 * clamp(Math.log2(v.zoom) / 3, 0, 1);

    if (this.preview.visible && this._src) {
      const s = this._src;
      const lat = s.lat, lon = this._nearestCopy(s.lon);
      const rk = this._srcR * 1.15 + 30 / (p / KM_LAT);  // 여유 30 px
      const dLat = rk / KM_LAT, dLon = Math.min(180, rk / (KM_LON * Math.max(0.05, Math.cos(Math.min(89, Math.abs(lat) + dLat) * DEG))));
      this.preview.position.set(lon, lat, 0);
      this.preview.scale.set(dLon, dLat, 1);
      this.previewU.uC.value.set(lon, lat);
      const pa = this.previewU.uAx.value;
      const perimKm = Math.PI * (3 * (pa.x + pa.y) - Math.sqrt((3 * pa.x + pa.y) * (pa.x + 3 * pa.y)));
      this.previewU.uDash.value = clamp(Math.round(perimKm / (KM_LAT / p) / 13), 6, 160);
    }
    if (this.cityMesh.visible && this._city) {
      const lon = this._nearestCopy(this._city.lon), lat = this._city.lat;
      const rd = 40 / p;
      this.cityMesh.position.set(lon, lat, 0);
      this.cityMesh.scale.set(rd, rd, 1);
      this.cityU.uC.value.set(lon, lat);
    }

    // 렌더러 상태 보존
    const prevRT = r.getRenderTarget(), prevAuto = r.autoClear;
    r.getClearColor(this._tmpColor);
    const prevAlpha = r.getClearAlpha();
    r.autoClear = true;

    const key = `${v.lon.toFixed(5)},${v.lat.toFixed(5)},${v.zoom.toFixed(5)},${this.width},${this.height},${this.dpr}`;
    const viewChanged = key !== this._maskKey;
    this._maskKey = key;
    if (this._rtA && (viewChanged || this._dirtyMask)) {
      r.setClearColor(0x000000, 1);
      r.setRenderTarget(this._rtA);
      r.render(this._maskScene, cam);
      const bu = this.blurMat.uniforms, w = this._rtA.width, h = this._rtA.height, rad = 1.35 * this.dpr * this.q.shadow * 2;
      bu.tSrc.value = this._rtA.texture; bu.uDir.value.set(rad / w, 0);
      r.setRenderTarget(this._rtB); r.render(this._fsScene, cam);
      bu.tSrc.value = this._rtB.texture; bu.uDir.value.set(0, rad / h);
      r.setRenderTarget(this._rtA); r.render(this._fsScene, cam);
      this._dirtyMask = false;
    }
    if (this.glowQuad.visible && (viewChanged || this._dirtyGlow)) {
      r.setClearColor(0x000000, 0);
      r.setRenderTarget(this._rtGlow);
      r.render(this._glowScene, cam);
      this._dirtyGlow = false;
    }
    this.composeMat.uniforms.uPulse.value = 0.88 + 0.12 * Math.sin(this._time * 2.6);

    r.setRenderTarget(null);
    r.render(this.scene, cam);

    r.setRenderTarget(prevRT);
    r.setClearColor(this._tmpColor, prevAlpha);
    r.autoClear = prevAuto;
  }

  // ------------------------------------------------------------ 상호작용
  attach(el) {
    if (this.dom) this.detach();
    this.dom = el;
    this._prevTouchAction = el.style.touchAction;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this._onDown);
    el.addEventListener('pointermove', this._onMove);
    el.addEventListener('pointerup', this._onUp);
    el.addEventListener('pointercancel', this._onUp);
    el.addEventListener('wheel', this._onWheel, { passive: false });
    el.addEventListener('contextmenu', this._onCtx);
  }

  detach() {
    const el = this.dom;
    if (!el) return;
    el.removeEventListener('pointerdown', this._onDown);
    el.removeEventListener('pointermove', this._onMove);
    el.removeEventListener('pointerup', this._onUp);
    el.removeEventListener('pointercancel', this._onUp);
    el.removeEventListener('wheel', this._onWheel);
    el.removeEventListener('contextmenu', this._onCtx);
    el.style.touchAction = this._prevTouchAction || '';
    this._ptrs.clear();
    this.dom = null;
  }

  _local(e) {
    const rc = this._rect || (this._rect = this.dom.getBoundingClientRect());
    return [e.clientX - rc.left, e.clientY - rc.top];
  }

  _pinchState() {
    let ax = 0, ay = 0, bx = 0, by = 0, i = 0;
    for (const p of this._ptrs.values()) {
      if (i === 0) { ax = p.x; ay = p.y; } else if (i === 1) { bx = p.x; by = p.y; }
      i++;
    }
    return [(ax + bx) / 2, (ay + by) / 2, Math.max(1, Math.hypot(bx - ax, by - ay))];
  }

  _pointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    this._rect = this.dom.getBoundingClientRect();
    const [x, y] = this._local(e);
    try { this.dom.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    this._ptrs.set(e.pointerId, { x, y });
    this._fly = null; this._zt = null; this._vel[0] = this._vel[1] = 0;
    if (this._ptrs.size === 1) {
      this._tap = { x, y, t: performance.now(), moved: false, btn: e.button };
      this._hist.n = 0;
      this._pushHist(x, y);
    } else {
      if (this._tap) this._tap.moved = true;
      const [mx, my, d] = this._pinchState();
      this._pinch = { mx, my, d };
    }
  }

  _pushHist(x, y) {
    const h = this._hist, k = h.n % 8;
    h.x[k] = x; h.y[k] = y; h.t[k] = performance.now(); h.n++;
  }

  _pointerMove(e) {
    const p = this._ptrs.get(e.pointerId);
    if (!p) return;
    const [x, y] = this._local(e);
    const dx = x - p.x, dy = y - p.y;
    p.x = x; p.y = y;
    const v = this.view;
    if (this._ptrs.size === 1) {
      const t = this._tap;
      if (t && !t.moved && Math.hypot(x - t.x, y - t.y) > (e.pointerType === 'touch' ? 9 : 5)) t.moved = true;
      if (t && !t.moved) return;
      const pp = this.ppd;
      v.lon -= dx / pp; v.lat += dy / pp;
      this._clampView();
      this._pushHist(x, y);
      if (this.onUserMove) this.onUserMove();
    } else if (this._ptrs.size >= 2 && this._pinch) {
      const [mx, my, d] = this._pinchState();
      const pc = this._pinch;
      // 이전 중점 아래 경위도를 새 중점에 고정하며 확대
      const p0 = this.ppd;
      const lon = v.lon + (pc.mx - this.width / 2) / p0, lat = v.lat - (pc.my - this.height / 2) / p0;
      v.zoom = clamp(v.zoom * (d / pc.d), this.minZoom, this.maxZoom);
      const p1 = this.ppd;
      v.lon = lon - (mx - this.width / 2) / p1;
      v.lat = lat + (my - this.height / 2) / p1;
      this._clampView();
      pc.mx = mx; pc.my = my; pc.d = d;
      if (this.onUserMove) this.onUserMove();
    }
  }

  _pointerUp(e) {
    const p = this._ptrs.get(e.pointerId);
    if (!p) return;
    this._ptrs.delete(e.pointerId);
    try { this.dom.releasePointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
    const t = this._tap;
    if (this._ptrs.size === 0) {
      this._pinch = null;
      const now = performance.now();
      if (t && !t.moved && e.type === 'pointerup' && now - t.t < 600 && (t.btn === 0 || e.pointerType !== 'mouse')) {
        if (this.onTap) {
          const ll = this.screenToLonLat(t.x, t.y, this._ll);
          this.onTap(ll.lon, ll.lat, t.x, t.y);
        }
      } else if (t && t.moved) {
        // 관성: 최근 ~90 ms 이동 평균
        const h = this._hist, n = Math.min(h.n, 8);
        if (n >= 2) {
          const last = (h.n - 1) % 8;
          let first = last;
          for (let i = 1; i < n; i++) {
            const k = (h.n - 1 - i) % 8;
            if (h.t[last] - h.t[k] > 90) break;
            first = k;
          }
          const dtm = (h.t[last] - h.t[first]) / 1000;
          if (dtm > 0.008 && now - h.t[last] < 70) {
            const pp = this.ppd;
            this._vel[0] = -(h.x[last] - h.x[first]) / dtm / pp;
            this._vel[1] = (h.y[last] - h.y[first]) / dtm / pp;
          }
        }
      }
      this._tap = null;
    } else if (this._ptrs.size === 1) {
      // 핀치 → 한 손가락 드래그로 자연스럽게 이어짐
      this._pinch = null;
      for (const q of this._ptrs.values()) { this._hist.n = 0; this._pushHist(q.x, q.y); }
    } else {
      const [mx, my, d] = this._pinchState();
      this._pinch = { mx, my, d };
    }
  }

  _wheel(e) {
    e.preventDefault();
    this._rect = this.dom.getBoundingClientRect();
    const [x, y] = this._local(e);
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= this.height;
    const k = e.ctrlKey ? 0.012 : 0.0018;   // 트랙패드 핀치(ctrl+wheel)는 더 민감
    const base = this._zt ? this._zt.z : this.view.zoom;
    const z = clamp(base * Math.exp(-dy * k), this.minZoom, this.maxZoom);
    const pp = this.ppd;
    const lon = this.view.lon + (x - this.width / 2) / pp, lat = this.view.lat - (y - this.height / 2) / pp;
    if (this._zt && Math.abs(this._zt.ax - x) < 2 && Math.abs(this._zt.ay - y) < 2) this._zt.z = z;
    else this._zt = { z, ax: x, ay: y, lon, lat };
    this._fly = null; this._vel[0] = this._vel[1] = 0;
    if (this.onUserMove) this.onUserMove();
  }

  dispose() {
    this.detach();
    for (const n in this._fields) if (this._fields[n]) this._fields[n].dispose();
    this.elevTex.dispose(); this.auxTex.dispose(); this._dummy.dispose();
    for (const g of [this._fsGeo, this._landGeo, this._borderGeo, this._coastGeo, this._quadGeo]) g.dispose();
    for (const m of [this.oceanMat, this.landMat, this.maskMat, this.borderMat, this.coastMat, this.glowMat, this.composeMat, this.previewMat, this.cityMat, this.blurMat]) m.dispose();
    for (const t of [this._rtA, this._rtB, this._rtGlow]) if (t) t.dispose();
  }
}
