// FREE FREELY 우주 탐사 - 행성 렌더러: 지형 구(쿼드트리) · 기체 행성 · 고리 · 대기 껍질 · 원거리 광점
import * as THREE from 'three';
import { TerrainSphere, makeAtmoUniforms, makeCloudUniforms } from './terrain.js';
import { LOGDEPTH_VS_PARS, LOGDEPTH_VS, LOGDEPTH_FS_PARS, LOGDEPTH_FS, ATMO_PARS, CLOUD_PARS } from './glsl.js';
import { makeGasPalette, makeRingTexture } from './textures.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

/* ------------------------------ 기체 행성 ------------------------------ */
const GAS_VS = /* glsl */`
${LOGDEPTH_VS_PARS}
uniform vec3 uSunDir;
varying vec3 vL;      // 행성 로컬 위치(단위)
varying vec3 vSunL;
varying vec3 vViewL;
varying float vDist;
void main() {
  vL = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  mat3 rot = mat3(modelMatrix);
  vec3 s = vec3(length(rot[0]), length(rot[1]), length(rot[2]));
  mat3 rn = mat3(rot[0] / s.x, rot[1] / s.y, rot[2] / s.z);
  vSunL = uSunDir * rn;
  vViewL = (-w.xyz) * rn;
  vDist = length(w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
  ${LOGDEPTH_VS}
}`;
const GAS_FS = /* glsl */`
precision highp float;
precision highp sampler3D;
${LOGDEPTH_FS_PARS}
uniform sampler2D uPal;
uniform sampler3D uNoise;
uniform vec3 uSunCol;
uniform float uTime;
uniform vec4 uStorm;      // lat, lon(rad), size, on
uniform vec3 uStormCol;
uniform float uBands;
uniform float uRingIn;    // 고리 그림자 (행성 반지름 단위)
uniform float uRingOut;
uniform sampler2D uRingTex;
uniform float uHasRing;
uniform float uDetail;
varying vec3 vL;
varying vec3 vSunL;
varying vec3 vViewL;
varying float vDist;
float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += (texture(uNoise, p).r - 0.5) * a; p *= 2.13; a *= 0.5; }
  return s;
}
void main() {
  vec3 p = normalize(vL);
  vec3 L = normalize(vSunL);
  vec3 V = normalize(vViewL);
  float lat = asin(clamp(p.y, -1.0, 1.0));
  float lon = atan(p.z, p.x);
  // 차등 자전: 위도마다 다른 속도로 흐르는 띠
  float flow = sin(lat * uBands) * 0.02;
  float lonF = lon + uTime * flow;
  vec3 q = vec3(cos(lonF) * cos(lat), sin(lat), sin(lonF) * cos(lat));
  float turb = fbm3(q * 1.7 + vec3(0.0, uTime * 0.0004, 0.0));
  float turb2 = fbm3(q * 6.0 + turb * 1.5);
  float fine = uDetail > 0.0 ? fbm3(q * 40.0 + turb2 * 2.0) * uDetail : 0.0;
  float v = p.y * 0.5 + 0.5 + turb * 0.035 + turb2 * 0.012 * (1.0 - abs(p.y)) + fine * 0.004;
  vec3 col = texture(uPal, vec2(v, 0.5)).rgb;
  col *= 0.92 + turb2 * 0.35 + fine * 0.2;
  // 소용돌이 폭풍
  if (uStorm.w > 0.5) {
    float dl = lat - uStorm.x;
    float dlon = mod(lon - uStorm.y - uTime * 0.00002 + 3.14159, 6.28318) - 3.14159;
    vec2 e = vec2(dlon * cos(lat) / (uStorm.z * 1.6), dl / uStorm.z);
    float r = length(e);
    if (r < 1.6) {
      float ang = atan(e.y, e.x) + (1.0 - r) * 4.0 + uTime * 0.0003;
      float sw = fbm3(vec3(cos(ang) * r, sin(ang) * r, 0.3) * 3.0);
      float m = smoothstep(1.1, 0.4, r + sw * 0.4);
      col = mix(col, uStormCol * (0.85 + sw), m);
      col = mix(col, col * 1.25, smoothstep(1.4, 1.0, r) * (1.0 - m) * 0.5);
    }
  }
  float ndl = dot(p, L);
  float lit = smoothstep(-0.08, 0.25, ndl) * max(0.0, ndl * 0.85 + 0.15);
  // 고리 그림자
  if (uHasRing > 0.5 && abs(L.y) > 1e-3) {
    float t = -p.y / L.y;
    if (t > 0.0) {
      vec3 h = p + L * t;
      float r = length(h.xz);
      if (r > uRingIn && r < uRingOut) {
        float a = texture(uRingTex, vec2((r - uRingIn) / (uRingOut - uRingIn), 0.5)).a;
        lit *= 1.0 - a * 0.85;
      }
    }
  }
  // 가장자리 어둡게 + 산란 테두리
  float mu = max(0.0, dot(p, V));
  float limb = pow(mu, 0.35);
  vec3 c = col * uSunCol * lit * limb * 0.9;
  c += col * uSunCol * pow(1.0 - mu, 4.0) * smoothstep(-0.2, 0.4, ndl) * 0.25;
  gl_FragColor = vec4(c, 1.0);
  ${LOGDEPTH_FS}
}`;

/* ------------------------------ 고리 ------------------------------ */
const RING_VS = /* glsl */`
${LOGDEPTH_VS_PARS}
uniform vec3 uSunDir;
varying vec3 vP;      // 행성 로컬 (행성 반지름 단위)
varying vec3 vSunL;
varying vec3 vViewL;
varying float vDist;
uniform float uR;
void main() {
  vP = position / uR;
  vec4 w = modelMatrix * vec4(position, 1.0);
  mat3 rot = mat3(modelMatrix);
  vSunL = uSunDir * rot;
  vViewL = (-w.xyz) * rot;
  vDist = length(w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
  ${LOGDEPTH_VS}
}`;
const RING_FS = /* glsl */`
precision highp float;
${LOGDEPTH_FS_PARS}
uniform sampler2D uRingTex;
uniform float uIn;
uniform float uOut;
uniform vec3 uSunCol;
uniform float uNearFade;
varying vec3 vP;
varying vec3 vSunL;
varying vec3 vViewL;
varying float vDist;
void main() {
  float r = length(vP.xz);
  float u = (r - uIn) / (uOut - uIn);
  if (u < 0.0 || u > 1.0) discard;
  vec4 t = texture(uRingTex, vec2(u, 0.5));
  vec3 L = normalize(vSunL);
  vec3 V = normalize(vViewL);
  // 행성 그림자 (태양 방향 광선이 행성 구와 교차)
  float b = dot(vP, L);
  vec3 cq = vP - b * L;
  float sh = (b < 0.0 && dot(cq, cq) < 1.0) ? 0.06 : 1.0;
  // 조명: 태양을 향한 면은 반사, 반대면은 투과 산란
  float sameSide = sign(L.y) * sign(V.y);
  float fwd = pow(max(0.0, dot(-V, L)), 6.0);
  float light = sameSide > 0.0 ? 0.9 : (0.25 + fwd * 1.6) * (1.0 - t.a * 0.6);
  vec3 col = t.rgb * uSunCol * light * sh;
  float a = t.a * mix(0.4, 1.0, smoothstep(0.0, 0.3, abs(normalize(vViewL).y)));
  a *= uNearFade;
  gl_FragColor = vec4(col * a, a);
  ${LOGDEPTH_FS}
}`;

/* ------------------------------ 대기 껍질 (원거리 행성) ------------------------------ */
const SHELL_VS = /* glsl */`
${LOGDEPTH_VS_PARS}
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  ${LOGDEPTH_VS}
}`;
const SHELL_FS = /* glsl */`
precision highp float;
${LOGDEPTH_FS_PARS}
${ATMO_PARS}
uniform vec3 uCenter;   // 카메라 기준 행성 중심 (R 단위)
uniform vec3 uSunDirW;
varying vec3 vW;
void main() {
  vec3 rd = normalize(vW);
  vec3 ro = -uCenter;
  vec2 at = rsph(ro, rd, uAtR);
  if (at.x > at.y) discard;
  vec2 pl = rsph(ro, rd, 1.0);
  float t0 = max(0.0, at.x);
  float t1 = pl.x < pl.y && pl.x > 0.0 ? pl.x : at.y;
  vec3 tr;
  vec3 ins = atmoIntegrate(ro, rd, t0, t1, normalize(uSunDirW), 8, 3, tr);
  float a = 1.0 - dot(tr, vec3(0.3333));
  gl_FragColor = vec4(ins, a);
  ${LOGDEPTH_FS}
}`;

/* ------------------------------ 광점 스프라이트 ------------------------------ */
const DOT_VS = /* glsl */`
${LOGDEPTH_VS_PARS}
uniform float uSize;
void main() {
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize;
  ${LOGDEPTH_VS}
}`;
const DOT_FS = /* glsl */`
precision highp float;
${LOGDEPTH_FS_PARS}
uniform vec3 uColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  float a = exp(-d * 3.5);
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * a, a);
  ${LOGDEPTH_FS}
}`;

export class PlanetView {
  constructor(body, ctx) {
    this.body = body;
    this.ctx = ctx;
    const scene = ctx.scene;
    this.isGas = !!body.gas;
    this.terrain = null;
    this.gasMesh = null;
    this.ring = null;
    this.shell = null;
    const R = body.radius;
    if (this.isGas) {
      const g = new THREE.SphereGeometry(R, 256, 160);
      const pal = makeGasPalette(body.gas.palette);
      const st = body.gas.storm;
      this.gasMat = new THREE.ShaderMaterial({
        vertexShader: GAS_VS, fragmentShader: GAS_FS,
        uniforms: {
          uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunCol: { value: new THREE.Vector3(3, 3, 3) },
          uPal: { value: pal }, uNoise: { value: ctx.cloudTex }, uTime: { value: 0 }, uBands: { value: body.gas.bands || 12 },
          uStorm: { value: st ? new THREE.Vector4(st.lat * Math.PI / 180, st.lon * Math.PI / 180, st.size, 1) : new THREE.Vector4(0, 0, 0.1, 0) },
          uStormCol: { value: st ? new THREE.Color(...st.color).convertSRGBToLinear() : new THREE.Color() },
          uRingIn: { value: body.rings ? body.rings.inner / R : 0 }, uRingOut: { value: body.rings ? body.rings.outer / R : 0 },
          uRingTex: { value: null }, uHasRing: { value: body.rings ? 1 : 0 }, uDetail: { value: 0 },
        },
      });
      this.gasMesh = new THREE.Mesh(g, this.gasMat);
      this.gasMesh.matrixAutoUpdate = false;
      this.gasMesh.renderOrder = 1;
      scene.add(this.gasMesh);
    } else if (body.terrain) {
      ctx.scheduler.registerPlanet(body.id, body.terrain, R);
      this.terrain = new TerrainSphere(body, ctx.scheduler, ctx, scene);
    }
    if (body.rings) {
      const rt = makeRingTexture(body.rings.palette, body.rings.seed);
      const g = new THREE.RingGeometry(body.rings.inner, body.rings.outer, 256, 4);
      g.rotateX(-Math.PI / 2);
      this.ringMat = new THREE.ShaderMaterial({
        vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        uniforms: {
          uRingTex: { value: rt }, uIn: { value: body.rings.inner / R }, uOut: { value: body.rings.outer / R }, uR: { value: R },
          uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uSunCol: { value: new THREE.Vector3(3, 3, 3) }, uNearFade: { value: 1 },
        },
      });
      this.ring = new THREE.Mesh(g, this.ringMat);
      this.ring.matrixAutoUpdate = false;
      this.ring.renderOrder = 6;
      scene.add(this.ring);
      if (this.gasMat) this.gasMat.uniforms.uRingTex.value = rt;
      this.ringTex = rt;
    }
    if (body.atmo) {
      this.shellU = { ...makeAtmoUniforms(body), uCenter: { value: new THREE.Vector3() }, uSunDirW: { value: new THREE.Vector3(1, 0, 0) } };
      this.shell = new THREE.Mesh(new THREE.SphereGeometry(R + body.atmo.top, 96, 64), new THREE.ShaderMaterial({
        vertexShader: SHELL_VS, fragmentShader: SHELL_FS, uniforms: this.shellU,
        transparent: true, depthWrite: false, side: THREE.FrontSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      }));
      this.shell.matrixAutoUpdate = false;
      this.shell.renderOrder = 8;
      scene.add(this.shell);
      this.cloudU = makeCloudUniforms(body, ctx.cloudTex);
    }
    // 원거리 광점
    this.dotMat = new THREE.ShaderMaterial({
      vertexShader: DOT_VS, fragmentShader: DOT_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uSize: { value: 3 }, uColor: { value: new THREE.Vector3(1, 1, 1) } },
    });
    this.dot = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)), this.dotMat);
    this.dot.frustumCulled = false;
    this.dot.matrixAutoUpdate = false;
    this.dot.renderOrder = 2;
    scene.add(this.dot);
    this.albedoColor = new THREE.Color(this.isGas ? '#d8c8a8' : body.palette === 'earth' ? '#8aa8d8' : body.palette === 'mars' ? '#d88a5a' : '#c8c0b8');
    this.primary = false;
  }

  setQuality(q) { if (this.terrain) this.terrain.setQuality(q); this.quality = q; }

  /**
   * @param cam { relCenter (Float64 카메라 기준 행성 중심), sunDir(월드), sunCol, pixelScale }
   */
  update(f) {
    const b = this.body;
    const R = b.radius;
    const rel = b.rel;
    const dist = rel.length();
    const angR = R / Math.max(1, dist);
    const pixR = angR * f.pixelScale;
    const sunDir = f.sunDir;
    const sunCol = f.sunCol;
    const near = pixR > 0.6;
    // 행렬: 회전 + 위치 (Float64 상대 위치)
    const setM = (obj, scale = 1) => {
      obj.matrix.makeRotationFromQuaternion(b.rotation);
      if (scale !== 1) obj.matrix.scale(_v.set(scale, scale, scale));
      obj.matrix.elements[12] = rel.x; obj.matrix.elements[13] = rel.y; obj.matrix.elements[14] = rel.z;
      obj.matrixWorld.copy(obj.matrix);
      obj.matrixWorldNeedsUpdate = false;
    };
    // 지형
    if (this.terrain) {
      const camL = _v2.copy(rel).negate().applyQuaternion(_q.copy(b.rotation).invert());
      this.terrain.update(camL, rel, b.rotation, near && dist < 5e11);
      const u = this.terrain.uniforms;
      u.uSunDir.value.copy(sunDir);
      u.uSunCol.value.copy(sunCol);
      u.uTime.value = f.time;
      u.uSkyAmb.value.copy(f.skyAmb || _v.set(0, 0, 0));
      u.uAtSun.value.copy(sunCol).multiplyScalar(b.atmo ? b.atmo.sunIntensity / 3 : 1);
      if (u.uClTime) u.uClTime.value = f.time;
      u.uClOverlay.value = this.primary ? 0 : 1;
      if (this.terrain.oceanMaterial) {
        const ou = this.terrain.oceanMaterial.uniforms;
        ou.uSkyZenith.value.copy(f.skyZenith || _v.set(0.05, 0.15, 0.4));
        ou.uSkyHorizon.value.copy(f.skyHorizon || _v.set(0.3, 0.45, 0.6));
        ou.uWaveAmp.value = f.waveAmp ?? 0.9;
      }
    }
    if (this.gasMesh) {
      this.gasMesh.visible = near;
      setM(this.gasMesh);
      const u = this.gasMat.uniforms;
      u.uSunDir.value.copy(sunDir);
      u.uSunCol.value.copy(sunCol);
      u.uTime.value = f.time;
      u.uDetail.value = pixR > 2000 ? 1 : 0;
    }
    if (this.ring) {
      this.ring.visible = near || b.rings.outer / Math.max(1, dist) * f.pixelScale > 0.6;
      setM(this.ring);
      const u = this.ringMat.uniforms;
      u.uSunDir.value.copy(sunDir);
      u.uSunCol.value.copy(sunCol);
    }
    if (this.shell) {
      // 주 행성은 화면 공간 대기 패스로 그리므로 껍질은 끔
      this.shell.visible = near && !this.primary && pixR > 2;
      if (this.shell.visible) {
        setM(this.shell);
        this.shellU.uCenter.value.copy(rel).divideScalar(R);
        this.shellU.uSunDirW.value.copy(sunDir);
        this.shellU.uAtSun.value.copy(sunCol).multiplyScalar(b.atmo.sunIntensity / 3);
      }
    }
    // 광점: 원판이 1픽셀 미만일 때 밝기 보존
    const showDot = pixR < 2.5 && dist > R * 3;
    this.dot.visible = showDot;
    if (showDot) {
      this.dot.matrixWorld.makeTranslation(rel.x, rel.y, rel.z);
      this.dot.matrix.copy(this.dot.matrixWorld);
      const lit = Math.max(0, 0.5 + 0.5 * -_v.copy(rel).normalize().dot(sunDir));
      const flux = Math.min(4, pixR * pixR * 3 + 0.02) * (0.3 + lit);
      const sz = Math.max(2, Math.min(6, 2 + pixR * 2));
      this.dotMat.uniforms.uSize.value = sz * f.dpr;
      this.dotMat.uniforms.uColor.value.set(this.albedoColor.r, this.albedoColor.g, this.albedoColor.b).multiplyScalar(flux * sunCol.x * 0.3);
    }
  }

  /** 지표 높이 (행성 로컬 방향) */
  heightAt(dirL, minW) { return this.terrain ? this.terrain.heightAt(dirL, minW) : 0; }

  get loading() { return this.terrain ? this.terrain.scheduler.pending : 0; }

  dispose() {
    if (this.terrain) this.terrain.dispose();
    for (const o of [this.gasMesh, this.ring, this.shell, this.dot]) if (o) { o.parent && o.parent.remove(o); o.geometry.dispose(); o.material.dispose(); }
  }
}
