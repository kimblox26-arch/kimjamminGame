// 군중 렌더러: 미리 구운 인체 메시(변형 5종 × LOD 3단계) + GPU 스키닝(뼈 행렬 데이터 텍스처, 사람당 한 줄)
// 옷(소매·바지 길이·수영복)·피부·머리카락·얼굴(눈·눈썹·입, 표정)은 셰이더에서 바인드 좌표와 부위 정보로 칠함
import * as THREE from 'three';
import { NB, BONE_PARENT, VARIANTS, variantInfo } from './body.js';
import { makeAnimState, animate, skinMatrices } from './anim.js';

const APP = 6;                       // 외형 텍셀: 피부+부속마스크, 머리, 상의+소매, 하의+바지, 신발+표정, 모자
const ROWW = NB * 3 + APP;
const EXPR = { neutral: 0, happy: 1, fear: 2, panic: 3, sad: 4, pain: 5 };
const DATA_URL = new URL('../../data/humans/', import.meta.url);

function decode(buf) {
  const dv = new DataView(buf);
  const nv = dv.getUint32(4, true), ni = dv.getUint32(8, true);
  let o = 12;
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
  for (let i = 0; i < nv * 3; i++) { pos[i] = dv.getInt16(o, true) / 12000; o += 2; }
  for (let i = 0; i < nv * 3; i++) { nrm[i] = dv.getInt8(o) / 127; o += 1; }
  const bi = new Uint8Array(buf.slice(o, o + nv * 4)); o += nv * 4;
  const bw = new Uint8Array(buf.slice(o, o + nv * 4)); o += nv * 4;
  const zn = new Float32Array(nv * 4), ms = new Float32Array(nv * 4);
  for (let i = 0; i < nv; i++) {
    zn[i * 4] = dv.getUint8(o++) / 255; zn[i * 4 + 1] = dv.getUint8(o++) / 50 - 2;
    zn[i * 4 + 2] = dv.getUint8(o++) / 255; zn[i * 4 + 3] = dv.getUint8(o++) / 50 - 2;
  }
  for (let i = 0; i < nv; i++) {
    ms[i * 4] = dv.getUint8(o++) / 255; ms[i * 4 + 1] = dv.getUint8(o++);
    ms[i * 4 + 2] = dv.getUint8(o++) / 255; ms[i * 4 + 3] = dv.getUint8(o++) / 100;
  }
  o = (o + 3) & ~3;
  const idx = nv > 65535 ? new Uint32Array(buf.slice(o, o + ni * 4)) : new Uint16Array(buf.slice(o, o + ni * 2));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aBoneIdx', new THREE.BufferAttribute(bi, 4));
  g.setAttribute('aBoneW', new THREE.BufferAttribute(bw, 4, true));
  g.setAttribute('aZone', new THREE.BufferAttribute(zn, 4));
  g.setAttribute('aMisc', new THREE.BufferAttribute(ms, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1e6);   // 인스턴스가 도시 전체에 흩어짐 → 컬링은 직접
  return g;
}

const SKIN_VERT = /* glsl */`
uniform highp sampler2D tBones;
attribute vec4 aBoneIdx;
attribute vec4 aBoneW;
attribute vec4 aZone;
attribute vec4 aMisc;
attribute float aRow;
varying vec4 vZone;
varying vec4 vMisc;
varying vec3 vBind;
flat varying int vRowI;
vec4 skTex(int x, int y) { return texelFetch(tBones, ivec2(x, y), 0); }
void skinV(out vec3 P, out vec3 N) {
  int row = int(aRow + 0.5);
  vec4 p4 = vec4(position, 1.0);
  P = vec3(0.0); N = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    float w = aBoneW[k];
    if (w > 0.0) {
      int bx = int(aBoneIdx[k] + 0.5) * 3;
      vec4 r0 = skTex(bx, row), r1 = skTex(bx + 1, row), r2 = skTex(bx + 2, row);
      P += w * vec3(dot(r0, p4), dot(r1, p4), dot(r2, p4));
      N += w * vec3(dot(r0.xyz, normal), dot(r1.xyz, normal), dot(r2.xyz, normal));
    }
  }
  float part = floor(aMisc.y + 0.5);
  if (part > 0.5 && part < 9.5) {
    float mask = skTex(${NB * 3}, row).w;
    if (mod(floor(mask / exp2(part)), 2.0) < 0.5) P = vec3(0.0);
  }
}
`;

const SKIN_FRAG = /* glsl */`
uniform highp sampler2D tBones;
uniform vec4 uLand1;   // crotchY, waistY, shY, neckY
uniform vec4 uLand2;   // chinY, kneeY, ankleY, bustY
uniform vec4 uLand3;   // H, sex, kid, hipY
uniform vec4 uHead;    // 머리 중심 xyz, 머리 높이
uniform float uEyeY;
varying vec4 vZone;
varying vec4 vMisc;
varying vec3 vBind;
flat varying int vRowI;
vec4 apTex(int k) { return texelFetch(tBones, ivec2(${NB * 3} + k, vRowI), 0); }
float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float skRough;
float sq(float x) { return x * x; }   // 제곱: pow(x, 2.0)는 x<0에서 정의되지 않음 (GPU에 따라 NaN)
vec3 skCol() {
  vec4 a0 = apTex(0), a1 = apTex(1), a2 = apTex(2), a3 = apTex(3), a4 = apTex(4), a5 = apTex(5);
  vec3 skin = a0.rgb;
  float part = floor(vMisc.y + 0.5), flag = vMisc.w;
  float H = uLand3.x, y = vBind.y;
  skRough = 0.52;
  if (part >= 0.5 && part <= 4.5) {
    skRough = 0.42;
    float strand = vnoise3(vec3(vBind.x * 900.0, vBind.y * 60.0, vBind.z * 900.0));
    return a1.rgb * (0.82 + 0.3 * strand);
  }
  if (part >= 4.5 && part <= 7.5) { skRough = 0.75; return flag > 0.5 ? a5.rgb * 0.35 : a5.rgb; }
  if (part > 7.5 && part < 8.5) { skRough = 0.85; return a3.rgb; }
  if (part > 8.5 && part < 9.5) { skRough = 0.2; return vec3(0.03, 0.035, 0.04); }
  if (part > 9.5) return skin;
  float arm = vZone.x, tArm = vZone.y, leg = vZone.z, tLeg = vZone.w;
  float topK = floor(a3.a + 0.5);
  float sty = a5.a;
  float fDenim = mod(floor(sty), 2.0), fPocket = mod(floor(sty / 2.0), 2.0), fSneak = mod(floor(sty / 4.0), 2.0), fWatch = mod(floor(sty / 8.0), 2.0), fBeard = mod(floor(sty / 16.0), 2.0);
  float cloth = 0.0; vec3 cc = skin;
  float crotch = uLand1.x, waist = uLand1.y, neck = uLand1.w, ankle = uLand2.z, bust = uLand2.w, hip = uLand3.w;
  float isPants = 0.0;
  if (arm > 0.5) {
    if (tArm < a1.a) { cloth = 1.0; cc = a2.rgb * (1.0 - 0.18 * smoothstep(a1.a - 0.03, a1.a, tArm)); }
    // 손목시계 (왼쪽)
    if (fWatch > 0.5 && vBind.x > 0.0 && tArm > 0.935 && tArm < 0.975) { skRough = 0.25; return mix(vec3(0.62, 0.63, 0.65), vec3(0.08), step(0.0, vBind.z) * 0.7); }
  } else if (leg > 0.5) {
    // 수영복 하의는 몸통과 같은 허리선에서 끊음 (옆구리만 높이 올라가는 V자 방지)
    if (tLeg < a2.a && (topK < 0.5 || topK > 2.5 || y < uLand3.w + (topK < 1.5 ? -0.01 : 0.01) * H)) { cloth = 1.0; cc = a3.rgb; isPants = 1.0; }
    if (tLeg > 0.96) {
      cloth = 1.0; cc = a4.rgb; skRough = 0.6;
      if (fSneak > 0.5) {
        float sole = 1.0 - smoothstep(0.012 * H, 0.018 * H, y);
        // 옆면 사선 줄 3개 (발 바깥쪽 중앙부)
        float sz = vBind.z - 0.04 * H / 1.75, sy2 = y - 0.03 * H;
        float band = step(abs(sz + sy2 * 0.8), 0.035 * H / 1.75) * step(0.5, fract((sz + sy2 * 0.8) * 140.0 / (H / 1.75))) * step(abs(sy2), 0.012 * H);
        cc = mix(cc, vec3(0.92), max(sole, band * 0.85));
      }
      return cc * (0.9 + 0.1 * vnoise3(vBind * 300.0));
    }
  } else if (y < neck + 0.02 * H) {
    float neckline = neck - 0.006 * H - max(0.0, 0.032 * H - abs(vBind.x)) * 1.1 * step(0.0, vBind.z);
    if (topK < 0.5) {                       // 셔츠 + 하의
      if (y > waist - 0.01 * H && y < neckline + 0.03 * H) { cloth = 1.0; cc = a2.rgb; }
      else if (y <= waist - 0.01 * H) { cloth = 1.0; cc = a3.rgb; }
    } else if (topK < 1.5) {                // 비키니
      if (y > bust - 0.045 * H && y < bust + 0.03 * H) { cloth = 1.0; cc = a2.rgb; }
      if (y < hip - 0.01 * H) { cloth = 1.0; cc = a3.rgb; }
    } else if (topK < 2.5) {                // 수영 바지만
      if (y < hip + 0.01 * H) { cloth = 1.0; cc = a3.rgb; }
    } else {                                // 원피스 / 원피스 수영복
      if (y < neckline + 0.02 * H) { cloth = 1.0; cc = a2.rgb; }
    }
  }
  if (cloth > 0.5) {
    skRough = max(skRough, 0.88);
    float weave = vnoise3(vBind * 260.0) * 0.06 + vnoise3(vBind * 18.0) * 0.08;
    // 주름: 팔꿈치 · 무릎 · 사타구니 접힘 그늘
    float fold = 0.0;
    if (leg > 0.5) fold = (1.0 - smoothstep(0.0, 0.06, abs(tLeg - 0.5))) * (0.5 + 0.5 * vnoise3(vBind * vec3(30.0, 90.0, 30.0)));
    if (arm > 0.5) fold = (1.0 - smoothstep(0.0, 0.05, abs(tArm - 0.48))) * (0.5 + 0.5 * vnoise3(vBind * 70.0));
    cc *= 1.0 - 0.18 * fold;
    if (isPants > 0.5 && fDenim > 0.5) {
      // 데님: 능직 사선 + 허벅지 앞 · 무릎 탈색 + 수염(whisker) 주름
      float tw = 0.5 + 0.5 * sin((vBind.y * 1.0 + vBind.x * 0.6 + vBind.z * 0.6) * 1400.0);
      float fade = smoothstep(0.0, 0.05, vBind.z) * (exp(-sq((tLeg - 0.28) / 0.16)) * 0.9 + exp(-sq((tLeg - 0.52) / 0.06)) * 0.7);
      float whisk = (1.0 - smoothstep(0.0, 0.004, abs(fract(vBind.y * 28.0 + abs(vBind.x) * 14.0) - 0.5) - 0.46)) * step(tLeg, 0.15) * step(0.0, vBind.z);
      cc = cc * (0.88 + 0.12 * tw) + vec3(0.1, 0.12, 0.15) * fade * (0.6 + 0.4 * vnoise3(vBind * 40.0)) + whisk * 0.02;
    }
    if (fPocket > 0.5 && arm < 0.5 && leg < 0.5 && vBind.z > 0.0) {
      float px = vBind.x - 0.075 * H / 1.75, py = y - (uLand2.w + 0.02 * H);
      float edge = step(abs(px), 0.042 * H / 1.75) * step(abs(py), 0.045 * H / 1.75);
      float inner = step(abs(px), 0.038 * H / 1.75) * step(abs(py), 0.041 * H / 1.75);
      cc *= 1.0 - 0.12 * (edge - inner) - 0.03 * inner;
    }
    return cc * (0.92 + weave);
  }
  // 얼굴 (양식화): 흰자 없는 작고 어두운 타원 눈 + 윗눈꺼풀 그늘, 가는 눈썹, 부드러운 입선.
  // 표정은 눈썹 각도 · 눈 뜬 정도 · 입꼬리 곡선으로만 표현 (0 무표정 1 기쁨 2 겁 3 공황 4 슬픔 5 고통)
  vec3 col = skin;
  if (y > uLand2.x - 0.01 * H) {
    vec3 q = vBind - uHead.xyz;
    float hh = uHead.w, ey = uEyeY - uHead.y, ax = abs(q.x), sex = uLand3.y;
    float front = smoothstep(0.2 * hh, 0.32 * hh, q.z);
    float ez = floor(a4.a + 0.5);
    float eOpen = 1.0, bLift = 0.0, bTilt = 0.0, mCurve = 0.15, mOpen = 0.0, mWide = 1.0, lowLid = 0.0;
    if (ez == 1.0) { eOpen = 0.85; lowLid = 1.0; bLift = 0.008; mCurve = 1.0; mWide = 1.12; }
    else if (ez == 2.0) { eOpen = 1.2; bLift = 0.02; bTilt = 0.8; mCurve = -0.35; mOpen = 0.32; mWide = 0.72; }
    else if (ez == 3.0) { eOpen = 1.28; bLift = 0.026; bTilt = 1.0; mCurve = -0.2; mOpen = 0.85; mWide = 0.78; }
    else if (ez == 4.0) { eOpen = 0.82; bTilt = 1.0; mCurve = -0.85; mWide = 0.9; }
    else if (ez == 5.0) { eOpen = 0.32; bLift = -0.01; bTilt = -0.9; mCurve = -0.6; mOpen = 0.22; mWide = 1.05; }
    float px = fwidth(q.y) + 1e-5;                      // 화면 픽셀 크기(머리 좌표) → 경계 안티앨리어싱
    // 윗눈꺼풀 · 눈두덩 그늘 (넓고 은은하게)
    float ex = 0.135 * hh;
    float lid = exp(-sq((ax - ex) / (0.065 * hh)) - sq((q.y - ey - 0.038 * hh) / (0.026 * hh))) * front;
    col *= mix(vec3(1.0), vec3(0.9, 0.84, 0.84), lid);
    // 눈: 어두운 타원 (가로 반경 0.031, 세로 0.041 머리높이) + 작은 반사광, 흰자 없음
    vec2 ep = vec2(ax - ex, q.y - ey);
    float kidE = 1.0 + 0.16 * uLand3.z;                 // 아이: 눈이 조금 큼
    vec2 er2 = vec2(0.031 * hh, 0.041 * hh * eOpen) * kidE;
    float er = length(ep / er2);
    float eAA = px / er2.x * 1.3;
    float eyeM = 1.0 - smoothstep(1.0 - eAA, 1.0 + eAA, er);
    eyeM *= mix(1.0, smoothstep(-0.55 - eAA * 4.0, -0.4 + eAA * 4.0, ep.y / er2.y - 0.55 * (ep.x / er2.x) * (ep.x / er2.x)), lowLid);
    eyeM *= front;
    vec3 eyeC = mix(vec3(0.17, 0.105, 0.065), vec3(0.035, 0.026, 0.024), smoothstep(0.85, 0.25, length(ep / er2 - vec2(0.0, -0.08))));
    float hl = 1.0 - smoothstep(0.0, 0.0085 * hh + px, length(vec2(q.x - sign(q.x) * ex + 0.009 * hh, q.y - ey - 0.013 * hh * eOpen)));
    eyeC = mix(eyeC, vec3(0.92), hl * 0.85);
    col = mix(col, eyeC, eyeM);
    // 윗눈꺼풀 선 (눈 위쪽 가장자리를 바깥으로 살짝 길게)
    float lash = exp(-sq((er - 1.0) / (0.2 + 0.1 * sex))) * smoothstep(-0.1, 0.4, ep.y / er2.y + 0.25 * sex * ep.x / er2.x) * front;
    col = mix(col, vec3(0.05, 0.035, 0.03), lash * (0.45 + 0.35 * sex) * (1.0 - eyeM));
    // 눈썹: 가늘고 부드러운 호, 안쪽이 약간 두껍고 바깥으로 가늘어짐
    float bx = (ax - 0.045 * hh) / (0.17 * hh);
    float arch = 0.016 * hh * (1.0 - sq(1.9 * bx - 0.85));
    float byc = ey + (0.1 + bLift) * hh + arch + bTilt * 0.03 * hh * (1.0 - bx) - 0.012 * hh * bx;
    float bth = mix(0.012, 0.0055, clamp(bx, 0.0, 1.0)) * hh * (1.0 - 0.3 * sex);
    float brow = (1.0 - smoothstep(bth - px, bth + px * 1.5, abs(q.y - byc))) * smoothstep(-0.04, 0.1, bx) * (1.0 - smoothstep(0.82, 1.0, bx)) * front;
    vec3 browC = mix(skin * 0.5, a1.rgb, 0.55);
    col = mix(col, browC, brow * 0.82);
    // 입: 얇은 선 + 은은한 입술색, 벌림은 어두운 타원
    float my = ey - (0.272 - 0.035 * uLand3.z) * hh, mw = 0.07 * hh * mWide * (1.0 - 0.12 * uLand3.z), mx = q.x / mw;
    float mcy = my + mCurve * 0.017 * hh * (mx * mx - 0.35);
    float md = q.y - mcy, mfade = 1.0 - smoothstep(0.7, 1.0, abs(mx));
    float lth = 0.0042 * hh;
    float mline = (1.0 - smoothstep(lth - px, lth + px * 1.5, abs(md))) * mfade * front;
    float lip = exp(-sq((md + 0.012 * hh) / (0.016 * hh))) * (1.0 - smoothstep(0.45, 1.0, abs(mx))) * front;
    col = mix(col, col * vec3(0.94, 0.78, 0.77), lip * (0.3 + 0.35 * sex));
    col = mix(col, col * vec3(0.52, 0.36, 0.34), mline * 0.75);
    if (mOpen > 0.0) {
      float oh = mOpen * 0.04 * hh;
      float ov = length(vec2(mx / 0.82, (md + oh * 0.35) / oh));
      float cav = (1.0 - smoothstep(1.0 - px / oh, 1.0 + px / oh, ov)) * front;
      col = mix(col, vec3(0.2, 0.07, 0.07), cav * 0.92);
    }
    // 볼 홍조 (여성 · 아이)
    float cheek = exp(-sq(length(vec2(ax - 0.17 * hh, q.y - ey + 0.15 * hh)) / (0.075 * hh))) * front;
    col *= mix(vec3(1.0), vec3(1.03, 0.94, 0.93), cheek * (0.25 + 0.5 * max(sex, uLand3.z)));
    if (fBeard > 0.5) {
      // 짧은 수염: 턱 · 윗입술 · 볼 아래 (부드러운 경계)
      float jaw = smoothstep(ey - 0.2 * hh, ey - 0.32 * hh, q.y) * smoothstep(0.0, 0.2 * hh, q.z + 0.12 * hh) * smoothstep(-0.56 * hh, -0.47 * hh, q.y);
      float lipZone = (1.0 - smoothstep(0.0, 0.03 * hh, abs(q.y - (my + 0.045 * hh)))) * (1.0 - smoothstep(0.8, 1.1, abs(q.x / (0.09 * hh))));
      float stub = max(jaw, lipZone * 0.8) * (1.0 - mline) * (0.6 + 0.4 * vnoise3(vBind * 900.0));
      col = mix(col, a1.rgb * 0.5 + col * 0.45, stub * 0.35);
    }
    skRough = mix(skRough, 0.22, eyeM);
  }
  col *= 0.96 + vnoise3(vBind * 120.0) * 0.06;
  return col;
}
`;

function patch(mat, U, depth) {
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U);
    s.vertexShader = SKIN_VERT + s.vertexShader
      .replace('#include <beginnormal_vertex>', 'vec3 skP, skN; skinV(skP, skN);\n#define SK_DONE\nvec3 objectNormal = normalize(skN);')
      .replace('#include <begin_vertex>', '#ifndef SK_DONE\nvec3 skP, skN; skinV(skP, skN);\n#endif\nvec3 transformed = skP;\nvZone = aZone; vMisc = aMisc; vBind = position; vRowI = int(aRow + 0.5);');
    if (depth) return;
    s.fragmentShader = SKIN_FRAG + s.fragmentShader
      .replace('#include <color_fragment>', 'diffuseColor.rgb = skCol() * mix(0.55, 1.0, pow(vMisc.z, 0.8));')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = skRough;');
  };
  mat.customProgramCacheKey = () => 'human' + (depth ? 'D' : '');
}

const _fr = new THREE.Frustum(), _m = new THREE.Matrix4(), _sp = new THREE.Sphere();

export class HumanCrowd {
  constructor(scene, { max = 400, quality = 'medium', castShadow = true } = {}) {
    this.scene = scene;
    this.max = max;
    this.q = quality;
    this.lods = quality === 'low' ? [2, 3] : [1, 2, 3];
    this.dist = quality === 'low' ? [45, 400] : quality === 'medium' ? [18, 70, 500] : [30, 110, 700];
    this.castShadow = castShadow;
    this.people = [];
    this.free = [];
    this.data = new Float32Array(ROWW * max * 4);
    this.tex = new THREE.DataTexture(this.data, ROWW, max, THREE.RGBAFormat, THREE.FloatType);
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    this.meshes = {};
    this.ready = this.load();
  }

  async load() {
    const jobs = [];
    for (const v of VARIANTS) for (const l of this.lods) jobs.push(fetch(new URL(`${v}_${l}.bin`, DATA_URL)).then((r) => { if (!r.ok) throw new Error('사람 메시 로드 실패 ' + v); return r.arrayBuffer(); }).then((b) => [v, l, decode(b)]));
    const geos = await Promise.all(jobs);
    for (const v of VARIANTS) {
      const info = variantInfo(v), L = info.land;
      const U = {
        tBones: { value: this.tex },
        uLand1: { value: new THREE.Vector4(L.crotchY, L.waistY, L.shY, L.neckY) },
        uLand2: { value: new THREE.Vector4(L.chinY, L.kneeY, L.ankleY, L.bustY) },
        uLand3: { value: new THREE.Vector4(info.H, L.sex, L.kid, L.hipY) },
        uHead: { value: new THREE.Vector4(info.head.c[0], info.head.c[1], info.head.c[2], info.head.hh) },
        uEyeY: { value: info.head.c[1] + info.head.eyeY * info.head.hh },
      };
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, envMapIntensity: 0.6 });
      patch(mat, U, false);
      const dmat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      patch(dmat, U, true);
      this.meshes[v] = [];
      for (const [vv, l, geo] of geos) {
        if (vv !== v) continue;
        geo.setAttribute('aRow', new THREE.InstancedBufferAttribute(new Float32Array(this.max), 1).setUsage(THREE.DynamicDrawUsage));
        const m = new THREE.InstancedMesh(geo, mat, this.max);
        m.customDepthMaterial = dmat;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.frustumCulled = false;
        m.castShadow = this.castShadow && l <= 2;
        m.receiveShadow = true;
        m.count = 0;
        m.userData.lod = l;
        this.scene.add(m);
        this.meshes[v].push(m);
      }
      this.meshes[v].sort((a, b) => a.userData.lod - b.userData.lod);
    }
    this.loaded = true;
  }

  /** desc: { variant, height, seed, kind, skin, hair, top, bottom, shoes, hat, sleeve, pants, topKind, parts } → id */
  add(d) {
    const id = this.free.length ? this.free.pop() : this.people.length;
    const info = variantInfo(d.variant);
    const P = {
      id, variant: d.variant, info, scale: (d.height || info.H) / info.H, parts: d.parts || 0,
      st: makeAnimState(info, d.seed ?? id, d.kind),
      x: 0, y: 0, z: 0, yaw: 0, motion: 'idle', speed: 0, turnRate: 0, action: null, look: 0, expression: 0, visible: true, alive: true,
      head: new Float32Array(3),
    };
    this.people[id] = P;
    const o = (id * ROWW + NB * 3) * 4, a = this.data, c = new THREE.Color();
    const put = (k, col, w) => { c.set(col); a[o + k * 4] = c.r; a[o + k * 4 + 1] = c.g; a[o + k * 4 + 2] = c.b; a[o + k * 4 + 3] = w; };
    put(0, d.skin, P.parts); put(1, d.hair, d.sleeve ?? 0.4); put(2, d.top, d.pants ?? 1.05);
    put(3, d.bottom, d.topKind || 0); put(4, d.shoes ?? d.skin, 0); put(5, d.hat ?? 0xffffff, d.style || 0);
    this.tex.needsUpdate = true;
    return id;
  }

  set(id, s) {
    const P = this.people[id];
    if (!P) return;
    Object.assign(P, s);
    if (s.expression !== undefined) P.exprCode = typeof s.expression === 'number' ? s.expression : EXPR[s.expression] || 0;
  }

  remove(id) { const P = this.people[id]; if (P) { P.alive = false; this.free.push(id); } }
  clear() { this.people = []; this.free = []; }

  /** 머리(눈) 월드 위치 */
  headPos(id, out) {
    const P = this.people[id];
    if (!P) return out;
    return out.set(P.head[0], P.head[1], P.head[2]);
  }

  update(dt, camera) {
    if (!this.loaded) return;
    for (const v of VARIANTS) for (const m of this.meshes[v]) m.count = 0;
    camera.updateMatrixWorld();
    _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _fr.setFromProjectionMatrix(_m);
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const data = this.data, D = this.dist, last = D.length - 1;
    for (const P of this.people) {
      if (!P || !P.alive || !P.visible) continue;
      const dx = P.x - cx, dy = P.y - cy, dz = P.z - cz, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > D[last]) continue;
      _sp.center.set(P.x, P.y + 0.9 * P.scale, P.z); _sp.radius = 1.3 * P.scale;
      if (!_fr.intersectsSphere(_sp)) continue;
      let li = 0;
      while (li < last && d > D[li]) li++;
      const mesh = this.meshes[P.variant][Math.min(li, this.meshes[P.variant].length - 1)];
      // 동작 (먼 사람은 프레임 건너 갱신)
      P.skip = (P.skip || 0) + dt;
      if (li < 2 || P.skip > 0.05) {
        animate(P.st, P.skip, P);
        const jp = skinMatrices(P.info, P.st.pose, data, P.id * ROWW * 4, BONE_PARENT);
        P.skip = 0;
        // 머리 월드 위치 (눈 높이: 머리 관절 위 0.45 머리높이)
        const c = Math.cos(P.yaw), s = Math.sin(P.yaw), k = P.scale;
        const hx = jp[12], hy = jp[13] + P.info.head.hh * 0.42, hz = jp[14] + 0.04;
        P.head[0] = P.x + (c * hx + s * hz) * k; P.head[1] = P.y + hy * k; P.head[2] = P.z + (-s * hx + c * hz) * k;
      }
      const ao = (P.id * ROWW + NB * 3) * 4;
      data[ao + 3] = P.parts | (P.motion === 'phone' ? 512 : 0);
      data[ao + 19] = P.exprCode || 0;
      const i = mesh.count++;
      const e = mesh.instanceMatrix.array, o = i * 16, c = Math.cos(P.yaw) * P.scale, s = Math.sin(P.yaw) * P.scale;
      e[o] = c; e[o + 1] = 0; e[o + 2] = -s; e[o + 3] = 0;
      e[o + 4] = 0; e[o + 5] = P.scale; e[o + 6] = 0; e[o + 7] = 0;
      e[o + 8] = s; e[o + 9] = 0; e[o + 10] = c; e[o + 11] = 0;
      e[o + 12] = P.x; e[o + 13] = P.y; e[o + 14] = P.z; e[o + 15] = 1;
      mesh.geometry.attributes.aRow.array[i] = P.id;
    }
    for (const v of VARIANTS) for (const m of this.meshes[v]) {
      if (!m.count) continue;
      m.instanceMatrix.needsUpdate = true;
      m.geometry.attributes.aRow.needsUpdate = true;
    }
    this.tex.needsUpdate = true;
  }
}
