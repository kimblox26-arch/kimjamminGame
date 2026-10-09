// FREE FREELY 우주 탐사 - 후처리
// 1) 대기 패스: 장면 깊이(로그 깊이)를 읽어 레일리+미 산란·공기 원근·체적 구름·구름 그림자·수중 안개를 합성
// 2) 우주 효과 패스: 블랙홀 중력 렌즈, 워프 스타 스트릭·터널, 모션 블러, 색수차, 열 왜곡, 렌즈 플레어, 비네트
// 3) UnrealBloom → OutputPass(ACES 톤매핑) → FXAA   (vendor/three/addons 사용)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ATMO_PARS, CLOUD_PARS } from './glsl.js';
import { makeAtmoUniforms, makeCloudUniforms } from './terrain.js';

const QUAD_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const ATMO_FS = /* glsl */`
precision highp float;
precision highp sampler3D;
${ATMO_PARS}
${CLOUD_PARS}
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform mat4 uInvProj;
uniform mat3 uCamRot;
uniform float uLogFar;
uniform float uR;
uniform vec3 uCamP;         // 카메라 위치 (행성 중심 기준, R 단위, 월드 축)
uniform mat3 uPlanetInv;    // 월드 → 행성 로컬
uniform vec3 uSunW;
uniform float uActive;
uniform float uUnder;       // 수중 깊이 (m), 0 = 수면 위
uniform vec3 uWaterCol;
uniform vec3 uSkyAmbient;
uniform float uTime;
uniform float uCloudSteps;
varying vec2 vUv;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hg(float mu, float g) { float g2 = g * g; return 0.0795775 * (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * mu, 1.5); }

void main() {
  vec4 col = texture2D(tColor, vUv);
  if (uActive < 0.5) { gl_FragColor = col; return; }
  float d = texture2D(tDepth, vUv).r;
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, -1.0, 1.0);
  vec3 rdV = normalize(vp.xyz / vp.w);
  vec3 rd = normalize(uCamRot * rdV);
  bool sky = d >= 0.9999999;
  float w = exp2(d * uLogFar) - 1.0;
  float tScene = sky ? 1e9 : (w / max(1e-6, -rdV.z)) / uR;
  vec3 ro = uCamP;
  vec3 L = normalize(uSunW);
  vec3 result = col.rgb;

  // ---------------- 수중 ----------------
  if (uUnder > 0.0) {
    float distM = min(tScene * uR, 400.0);
    float depthLight = exp(-uUnder * 0.035);
    vec3 fogc = uWaterCol * (0.35 + 0.65 * depthLight) * max(0.05, dot(normalize(ro), L) * 0.8 + 0.2);
    float k = 1.0 - exp(-distM * 0.045);
    result = mix(result * mix(vec3(0.6, 0.85, 0.95), vec3(1.0), depthLight), fogc, k);
    gl_FragColor = vec4(result, 1.0);
    return;
  }

  vec2 at = rsph(ro, rd, uAtR);
  if (at.x > at.y || at.y < 0.0) { gl_FragColor = col; return; }
  // 지형이 아직 로드되지 않은 경우 대비: 행성 구에서 멈춤
  vec2 pl = rsph(ro, rd, 1.0);
  float tGround = (pl.x < pl.y && pl.y > 0.0) ? max(0.0, pl.x) : 1e9;
  float tEnd = min(min(at.y, tScene), tGround * 1.002 + (sky ? 0.0 : 1.0));
  float t0 = max(0.0, at.x);
  if (sky && tGround < 1e8) tEnd = min(at.y, tGround);
  float jitter = hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 100.0);

  // ---------------- 구름 (체적 레이마칭) ----------------
  vec3 cloudCol = vec3(0.0);
  float cloudT = 1.0;
  float tc = -1.0;
  if (uClOn > 0.5) {
    float rb = 1.0 + uClBase, rt = 1.0 + uClTop;
    vec2 ot = rsph(ro, rd, rt);
    vec2 ib = rsph(ro, rd, rb);
    float h0 = length(ro);
    float cs = 0.0, ce = -1.0;
    if (ot.x < ot.y && ot.y > 0.0) {
      if (h0 > rt) { cs = ot.x; ce = (ib.x < ib.y && ib.x > 0.0) ? ib.x : ot.y; }
      else if (h0 > rb) { cs = 0.0; ce = (ib.x < ib.y && ib.x > 0.0) ? ib.x : ot.y; }
      else { cs = ib.y; ce = ot.y; }
    }
    ce = min(ce, min(tScene, tGround));
    float maxLen = (uClTop - uClBase) * 40.0;
    ce = min(ce, cs + maxLen);
    if (ce > cs) {
      int N = int(uCloudSteps);
      float ds = (ce - cs) / uCloudSteps;
      float t = cs + ds * jitter;
      vec3 Ll = uPlanetInv * L;
      float mu = dot(rd, L);
      float ph = mix(hg(mu, 0.55), hg(mu, -0.25), 0.3);
      vec3 sunAtCloud = uAtSun * sunTransmittance(ro + rd * (cs + ds), L) / 22.0;
      float sumT = 0.0, sumW = 0.0;
      for (int i = 0; i < 64; i++) {
        if (i >= N) break;
        vec3 p = ro + rd * t;
        float r = length(p);
        float hN = (r - rb) / (rt - rb);
        if (hN > 0.0 && hN < 1.0) {
          vec3 pL = uPlanetInv * p;
          float den = cloudDensityAt(pL, hN);
          if (den > 0.002) {
            float ext = den * uClDensity;
            // 태양 방향 그림자 (2단)
            float odl = 0.0;
            float lstep = (uClTop - uClBase) * 0.22;
            for (int j = 1; j <= 2; j++) {
              vec3 q = pL + Ll * lstep * float(j) * 1.5;
              float hq = (length(q) - rb) / (rt - rb);
              odl += cloudDensityAt(q, clamp(hq, 0.0, 1.0)) * uClDensity * lstep * 1.5;
            }
            float beer = exp(-odl) ;
            float powder = 1.0 - exp(-ext * ds * 2.0);
            vec3 lightC = sunAtCloud * uClColor * (beer * ph * 6.0 * mix(1.0, powder, 0.5) + 0.0) + uSkyAmbient * uClColor * (0.6 + hN * 0.5);
            float a = 1.0 - exp(-ext * ds);
            cloudCol += cloudT * a * lightC;
            sumT += t * cloudT * a; sumW += cloudT * a;
            cloudT *= 1.0 - a;
            if (cloudT < 0.02) break;
          }
        }
        t += ds;
      }
      if (sumW > 0.0) tc = sumT / sumW;
    }
    // 권운 (얇은 2D 층)
    if (uClCirrus > 0.0) {
      vec2 ci = rsph(ro, rd, 1.0 + uClCirrus);
      float tci = length(ro) > 1.0 + uClCirrus ? ci.x : ci.y;
      if (ci.x < ci.y && tci > 0.0 && tci < min(tScene, tGround)) {
        vec3 pL = uPlanetInv * (ro + rd * tci);
        vec3 q = pL / (uClScale * 6.0) * vec3(1.0, 1.0, 0.35);
        float c = texture(uCloudTex, q * 0.5 + vec3(uTime * 0.0002, 0.0, 0.0)).g;
        c = smoothstep(0.55, 0.85, c) * 0.55 * smoothstep(0.3, 0.6, cloudCoverage(normalize(pL)) + 0.2);
        vec3 cc = uAtSun * sunTransmittance(ro + rd * tci, L) / 22.0 * (0.6 + hg(dot(rd, L), 0.6) * 3.0) + uSkyAmbient;
        cloudCol = cloudCol + cloudT * c * cc;
        cloudT *= 1.0 - c;
        if (tc < 0.0) tc = tci;
      }
    }
  }

  // 지면 구름 그림자
  if (!sky && uClOn > 0.5 && tScene < tGround * 1.05 + 0.02) {
    vec3 pg = ro + rd * tScene;
    vec2 cs = rsph(pg, L, 1.0 + (uClBase + uClTop) * 0.5);
    if (cs.y > 0.0) {
      vec3 pc = uPlanetInv * (pg + L * cs.y);
      float cov = cloudCoverage(normalize(pc));
      result *= 1.0 - 0.72 * smoothstep(0.1, 0.8, cov);
    }
  }

  // ---------------- 대기 산란 (구름 앞/뒤 두 구간) ----------------
  int steps = int(${'${STEPS}'});
  vec3 trA, trB;
  vec3 insA, insB;
  if (tc > t0 && tc < tEnd) {
    insA = atmoIntegrate(ro, rd, t0, tc, L, steps / 2 + 2, 4, trA);
    insB = atmoIntegrate(ro, rd, tc, tEnd, L, steps / 2 + 2, 4, trB);
    result = insA + trA * (cloudCol + cloudT * (insB + trB * result));
  } else {
    insA = atmoIntegrate(ro, rd, t0, tEnd, L, steps, 4, trA);
    if (tc >= 0.0 && tc <= t0) result = cloudCol + cloudT * (insA + trA * result);
    else result = insA + trA * (cloudCol + cloudT * result);
  }
  gl_FragColor = vec4(result, 1.0);
}`;

/** 대기 후처리 패스 — 주 행성 1개를 화면 공간에서 처리 */
export class AtmospherePass extends Pass {
  constructor(sceneRT, cloudTex, quality = 'medium') {
    super();
    this.sceneRT = sceneRT;
    this.cloudTex = cloudTex;
    this.uniforms = null;
    this.body = null;
    this.quality = quality;
    this.fsQuad = new FullScreenQuad(null);
    this._build(null);
  }

  _steps() { return { low: 8, medium: 12, high: 16, ultra: 22 }[this.quality] || 12; }
  cloudSteps() { return { low: 14, medium: 22, high: 34, ultra: 52 }[this.quality] || 22; }

  _build(body) {
    const dummy = { radius: 1, atmo: null };
    const b = body || dummy;
    const u = {
      tColor: { value: this.sceneRT.texture }, tDepth: { value: this.sceneRT.depthTexture },
      uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix3() }, uLogFar: { value: 1 },
      uR: { value: b.radius }, uCamP: { value: new THREE.Vector3() }, uPlanetInv: { value: new THREE.Matrix3() },
      uSunW: { value: new THREE.Vector3(1, 0, 0) }, uActive: { value: 0 }, uUnder: { value: 0 },
      uWaterCol: { value: new THREE.Color('#06374a').convertSRGBToLinear() }, uSkyAmbient: { value: new THREE.Vector3() },
      uTime: { value: 0 }, uCloudSteps: { value: this.cloudSteps() },
      ...makeAtmoUniforms(b), ...makeCloudUniforms(b, this.cloudTex),
    };
    if (this.material) this.material.dispose();
    this.material = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: ATMO_FS.replace('${STEPS}', String(this._steps())),
      uniforms: u, depthTest: false, depthWrite: false,
    });
    this.uniforms = u;
    this.fsQuad.material = this.material;
    this.body = body;
  }

  setQuality(q) { this.quality = q; this._build(this.body); }

  /** 주 행성 지정 (바뀔 때만 유니폼 재구성) */
  setBody(body) { if (body !== this.body) this._build(body); }

  render(renderer, writeBuffer) {
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);
  }

  dispose() { this.material.dispose(); this.fsQuad.dispose(); }
}

/* ------------------------------ 우주 효과 패스 ------------------------------ */
const FX_FS = /* glsl */`
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uTime;
uniform float uWarp;        // 0..1 워프 강도
uniform float uBlur;        // 0..1 모션 블러
uniform float uChroma;
uniform float uHeat;        // 열 왜곡
uniform vec4 uSun;          // uv.xy, 가시도, 크기
uniform vec3 uSunCol;
uniform vec4 uBH;           // uv.xy, 아인슈타인 반지름(화면 높이 비), 그림자 반지름
uniform float uVignette;
uniform float uFlash;
uniform float uFlareOn;
uniform vec3 uTint;
varying vec2 vUv;

float hash(float n) { return fract(sin(n) * 43758.5453); }

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  vec2 c = vec2(0.5);
  // 블랙홀 중력 렌즈 (점질량 근사: 편향 = θE² / r)
  float bhShadow = 0.0;
  if (uBH.z > 0.0) {
    vec2 d = (uv - uBH.xy) * vec2(aspect, 1.0);
    float r = length(d);
    float defl = uBH.z * uBH.z / max(r, 1e-4);
    vec2 dir = d / max(r, 1e-5);
    vec2 src = d - dir * min(defl, 2.0);
    uv = uBH.xy + src / vec2(aspect, 1.0);
    bhShadow = 1.0 - smoothstep(uBH.w * 0.92, uBH.w * 1.02, r);
    // 광자 고리
    bhShadow -= exp(-pow((r - uBH.w * 1.04) / (uBH.w * 0.025), 2.0)) * 1.4;
  }
  // 열 왜곡 (재진입·항성 근접)
  if (uHeat > 0.0) {
    uv += vec2(sin(uv.y * 80.0 + uTime * 23.0), cos(uv.x * 70.0 - uTime * 19.0)) * 0.0022 * uHeat;
  }
  vec2 toC = uv - c;
  float rr = length(toC * vec2(aspect, 1.0));
  // 방사형 블러 (워프 스트릭 + 가속 모션 블러) + 색수차
  float strength = uWarp * 0.22 + uBlur * 0.035;
  vec3 col = vec3(0.0);
  float ca = uChroma * rr * rr * 0.012 + uWarp * 0.004;
  const int S = 14;
  float wsum = 0.0;
  for (int i = 0; i < S; i++) {
    float k = float(i) / float(S - 1);
    float sc = 1.0 - strength * k * smoothstep(0.0, 0.5, rr);
    vec2 p = c + toC * sc;
    float w = 1.0 - k * 0.7;
    col.r += texture2D(tDiffuse, c + (p - c) * (1.0 + ca)).r * w;
    col.g += texture2D(tDiffuse, p).g * w;
    col.b += texture2D(tDiffuse, c + (p - c) * (1.0 - ca)).b * w;
    wsum += w;
    if (strength < 0.0005) { wsum = w; break; }
  }
  col /= wsum;
  // 워프 터널: 극좌표 빛줄기
  if (uWarp > 0.01) {
    float ang = atan(toC.y * 1.0, toC.x * aspect);
    float id = floor((ang + 3.14159) * 90.0);
    float h = hash(id);
    float lane = fract(h * 13.7 + uTime * (0.8 + h * 2.4));
    float line = smoothstep(0.0, 0.02, abs(fract((ang + 3.14159) * 90.0) - 0.5) * -1.0 + 0.5) * step(0.82, h);
    float rad = smoothstep(lane - 0.25, lane, rr) * (1.0 - smoothstep(lane, lane + 0.04, rr));
    vec3 tun = mix(vec3(0.4, 0.75, 1.2), vec3(1.2, 0.8, 1.4), h) * line * rad * smoothstep(0.08, 0.5, rr);
    col += tun * uWarp * 2.5;
    // 중심부 청백색 빛
    col += vec3(0.5, 0.8, 1.4) * exp(-rr * 9.0) * uWarp * 0.8;
  }
  col *= 1.0 - clamp(bhShadow, 0.0, 1.0);
  col += vec3(1.0, 0.85, 0.6) * max(0.0, -bhShadow) * 0.6 * step(0.0, uBH.z);
  // 렌즈 플레어 (태양 화면 위치 기반)
  if (uFlareOn > 0.5 && uSun.z > 0.0) {
    vec2 s = uSun.xy;
    vec2 axis = c - s;
    vec3 fl = vec3(0.0);
    for (int i = 1; i <= 6; i++) {
      float k = float(i) * 0.33 - 0.1;
      vec2 gp = s + axis * k * 2.0;
      float gd = length((uv - gp) * vec2(aspect, 1.0));
      float sz = 0.02 + 0.03 * hash(float(i) * 3.1);
      vec3 gc = mix(vec3(0.3, 0.6, 1.0), vec3(1.0, 0.5, 0.3), hash(float(i)));
      fl += gc * smoothstep(sz, sz * 0.6, gd) * 0.12;
    }
    // 헤일로 고리
    float hd = length((uv - (s + axis * 1.0)) * vec2(aspect, 1.0));
    fl += vec3(0.6, 0.7, 1.0) * exp(-pow((hd - 0.32) / 0.015, 2.0)) * 0.08;
    // 별빛 갈래 (스타버스트)
    vec2 sd = (uv - s) * vec2(aspect, 1.0);
    float sr = length(sd);
    float sa = atan(sd.y, sd.x);
    float rays = pow(abs(cos(sa * 3.0)), 60.0) + pow(abs(cos(sa * 3.0 + 1.05)), 80.0) * 0.6;
    fl += uSunCol * rays * exp(-sr * 6.0) * 0.5 * uSun.w;
    fl += uSunCol * exp(-sr * 22.0 / max(0.3, uSun.w)) * 0.6;
    col += fl * uSun.z * uSunCol;
  }
  // 비네트 · 섬광 · 색조
  float vig = smoothstep(0.95, 0.25, rr * (0.9 + uVignette * 0.4));
  col *= mix(1.0, vig, 0.55 + uVignette * 0.4);
  col *= uTint;
  col += vec3(1.0, 0.95, 0.9) * uFlash;
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSpaceComposer(renderer, cloudTex, quality) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthBuffer: true });
  sceneRT.depthTexture = new THREE.DepthTexture(size.x, size.y, THREE.FloatType);
  sceneRT.depthTexture.format = THREE.DepthFormat;
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthBuffer: false }));
  const atmo = new AtmospherePass(sceneRT, cloudTex, quality);
  composer.addPass(atmo);
  const fx = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(size.x, size.y) }, uTime: { value: 0 }, uWarp: { value: 0 }, uBlur: { value: 0 },
      uChroma: { value: 0.3 }, uHeat: { value: 0 }, uSun: { value: new THREE.Vector4() }, uSunCol: { value: new THREE.Vector3(1, 1, 1) },
      uBH: { value: new THREE.Vector4(0, 0, 0, 0) }, uVignette: { value: 0 }, uFlash: { value: 0 }, uFlareOn: { value: 1 }, uTint: { value: new THREE.Vector3(1, 1, 1) },
    },
    vertexShader: QUAD_VS.replace('gl_Position = vec4(position.xy, 0.0, 1.0);', 'gl_Position = vec4(position.xy, 0.0, 1.0);'),
    fragmentShader: FX_FS,
  });
  composer.addPass(fx);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.6, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);
  const setSize = (w, h) => {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    sceneRT.setSize(s.x, s.y);
    composer.setSize(w, h);
    fx.uniforms.uRes.value.set(s.x, s.y);
    fxaa.uniforms.resolution.value.set(1 / s.x, 1 / s.y);
  };
  return { composer, sceneRT, atmo, fx, bloom, fxaa, setSize };
}
