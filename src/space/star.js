// FREE FREELY 우주 탐사 - 항성 렌더러 (광구 쌀알무늬·흑점·주연감광, 코로나, 플레어)
import * as THREE from 'three';
import { LOGDEPTH_VS_PARS, LOGDEPTH_VS, LOGDEPTH_FS_PARS, LOGDEPTH_FS } from './glsl.js';
import { blackbody } from './consts.js';

const STAR_VS = /* glsl */`
${LOGDEPTH_VS_PARS}
varying vec3 vL;
varying vec3 vViewL;
void main() {
  vL = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  mat3 rot = mat3(modelMatrix);
  vec3 s = vec3(length(rot[0]), length(rot[1]), length(rot[2]));
  vViewL = (-w.xyz) * mat3(rot[0] / s.x, rot[1] / s.y, rot[2] / s.z);
  gl_Position = projectionMatrix * viewMatrix * w;
  ${LOGDEPTH_VS}
}`;
const STAR_FS = /* glsl */`
precision highp float;
precision highp sampler3D;
${LOGDEPTH_FS_PARS}
uniform sampler3D uNoise;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uSpots;
varying vec3 vL;
varying vec3 vViewL;
void main() {
  vec3 p = normalize(vL);
  vec3 V = normalize(vViewL);
  float mu = max(0.0, dot(p, V));
  // 쌀알무늬 (대류 세포) — 시간에 따라 끓어오름
  vec4 g1 = texture(uNoise, p * 3.1 + vec3(uTime * 0.002, 0.0, uTime * 0.0013));
  vec4 g2 = texture(uNoise, p * 11.0 - vec3(0.0, uTime * 0.004, 0.0));
  float gran = g1.g * 0.6 + g2.g * 0.4;
  // 흑점 (중위도 띠)
  float band = smoothstep(0.55, 0.15, abs(abs(p.y) - 0.3));
  float spot = smoothstep(0.62, 0.72, texture(uNoise, p * 0.9 + vec3(uTime * 0.0002)).a) * band * uSpots;
  float umbra = smoothstep(0.7, 0.78, texture(uNoise, p * 0.9 + vec3(uTime * 0.0002)).a) * band * uSpots;
  // 주연감광
  float limb = 0.35 + 0.65 * pow(mu, 0.55);
  vec3 col = uColor * (0.75 + gran * 0.5) * limb;
  col *= 1.0 - spot * 0.55 - umbra * 0.35;
  // 백반 (밝은 가장자리 영역)
  col += uColor * smoothstep(0.55, 0.62, texture(uNoise, p * 2.0).r) * (1.0 - mu) * 0.4;
  gl_FragColor = vec4(col * uIntensity, 1.0);
  ${LOGDEPTH_FS}
}`;

const CORONA_VS = /* glsl */`
${LOGDEPTH_VS_PARS}
uniform float uScale;
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  c.xy += position.xy * uScale;
  gl_Position = projectionMatrix * c;
  ${LOGDEPTH_VS}
}`;
const CORONA_FS = /* glsl */`
precision highp float;
precision highp sampler3D;
${LOGDEPTH_FS_PARS}
uniform sampler3D uNoise;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uInner;     // 광구 반지름 / 스프라이트 반지름
uniform vec2 uFlare;      // 각도, 세기
varying vec2 vUv;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float a = atan(vUv.y, vUv.x);
  float x = max(0.0, (r - uInner) / (1.0 - uInner));
  // 방사형 줄기 (스트리머)
  float st = texture(uNoise, vec3(cos(a) * 0.6, sin(a) * 0.6, uTime * 0.0006)).r;
  float st2 = texture(uNoise, vec3(cos(a) * 2.2, sin(a) * 2.2, x * 0.3 - uTime * 0.002)).g;
  float glow = exp(-x * 7.0) * (0.55 + st * 0.6) + exp(-x * 2.2) * 0.12 * (0.4 + st2);
  glow *= smoothstep(uInner * 0.92, uInner, r);
  // 홍염 / 플레어 아치
  float da = abs(mod(a - uFlare.x + 3.14159, 6.28318) - 3.14159);
  float arch = exp(-pow(da / 0.08, 2.0)) * exp(-pow((x - 0.06) / 0.05, 2.0)) * uFlare.y;
  vec3 col = uColor * glow + vec3(1.0, 0.55, 0.3) * arch * 4.0;
  float inside = r < uInner ? 0.0 : 1.0;
  gl_FragColor = vec4(col * uIntensity * inside, 0.0);
  ${LOGDEPTH_FS}
}`;

const PT_VS = /* glsl */`
${LOGDEPTH_VS_PARS}
uniform float uSize;
void main() {
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize;
  ${LOGDEPTH_VS}
}`;
const PT_FS = /* glsl */`
precision highp float;
${LOGDEPTH_FS_PARS}
uniform vec3 uColor;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = length(c);
  float a = exp(-d * d * 6.0) + exp(-d * 3.0) * 0.25;
  // 회절 스파이크
  a += (exp(-abs(c.x) * 26.0) + exp(-abs(c.y) * 26.0)) * exp(-d * 2.2) * 0.35;
  gl_FragColor = vec4(uColor * a, 0.0);
  ${LOGDEPTH_FS}
}`;

export class StarView {
  constructor(body, ctx) {
    this.body = body;
    const [r, g, b] = blackbody(body.temp || 5778);
    const m = Math.max(r, g, b);
    this.color = new THREE.Vector3(r / m, g / m, b / m);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: STAR_VS, fragmentShader: STAR_FS,
      uniforms: { uNoise: { value: ctx.cloudTex }, uColor: { value: this.color.clone() }, uIntensity: { value: 30 }, uTime: { value: 0 }, uSpots: { value: body.temp < 4000 ? 0.4 : body.temp > 9000 ? 0.0 : 1 } },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(body.radius, 96, 64), this.mat);
    this.mesh.matrixAutoUpdate = false;
    ctx.scene.add(this.mesh);
    this.coronaMat = new THREE.ShaderMaterial({
      vertexShader: CORONA_VS, fragmentShader: CORONA_FS, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      uniforms: { uNoise: { value: ctx.cloudTex }, uColor: { value: this.color.clone() }, uIntensity: { value: 6 }, uTime: { value: 0 }, uScale: { value: body.radius * 5 }, uInner: { value: 0.2 }, uFlare: { value: new THREE.Vector2(0, 0) } },
    });
    this.corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.coronaMat);
    this.corona.frustumCulled = false;
    this.corona.matrixAutoUpdate = false;
    this.corona.renderOrder = 9;
    ctx.scene.add(this.corona);
    this.ptMat = new THREE.ShaderMaterial({
      vertexShader: PT_VS, fragmentShader: PT_FS, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      uniforms: { uSize: { value: 8 }, uColor: { value: this.color.clone() } },
    });
    this.point = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)), this.ptMat);
    this.point.frustumCulled = false;
    this.point.matrixAutoUpdate = false;
    this.point.renderOrder = 2;
    ctx.scene.add(this.point);
    this.flare = { t: 0, angle: 0, power: 0, next: 4 + Math.random() * 10 };
    this.flareEvent = 0;
  }

  update(f, dt) {
    const b = this.body;
    const rel = b.rel;
    const dist = rel.length();
    const pixR = (b.radius / Math.max(1, dist)) * f.pixelScale;
    const set = (o) => {
      o.matrix.makeRotationFromQuaternion(b.rotation);
      o.matrix.elements[12] = rel.x; o.matrix.elements[13] = rel.y; o.matrix.elements[14] = rel.z;
      o.matrixWorld.copy(o.matrix); o.matrixWorldNeedsUpdate = false;
    };
    const big = pixR > 1.2;
    this.mesh.visible = big;
    this.corona.visible = big;
    if (big) {
      set(this.mesh);
      set(this.corona);
      this.mat.uniforms.uTime.value = f.time;
      this.coronaMat.uniforms.uTime.value = f.time;
      // 노출: 가까울수록 표면 휘도를 일정하게 (자동 노출 근사)
      this.mat.uniforms.uIntensity.value = 14 + 10 * Math.min(1, pixR / 400);
      this.coronaMat.uniforms.uIntensity.value = 2.2;
    }
    // 플레어 이벤트
    this.flare.next -= dt * (b.flare || 0.6);
    if (this.flare.next <= 0) {
      this.flare.t = 1; this.flare.angle = Math.random() * Math.PI * 2; this.flare.power = 0.6 + Math.random();
      this.flare.next = 8 + Math.random() * 20;
      this.flareEvent = this.flare.power;
    }
    this.flare.t = Math.max(0, this.flare.t - dt * 0.12);
    this.coronaMat.uniforms.uFlare.value.set(this.flare.angle, Math.sin(this.flare.t * Math.PI) * this.flare.power);
    // 원거리 점광원 (회절 스파이크)
    const showPt = pixR < 6;
    this.point.visible = showPt;
    if (showPt) {
      this.point.matrixWorld.makeTranslation(rel.x, rel.y, rel.z);
      // 겉보기 밝기: 광도 / 거리² (로그 압축)
      const flux = (b.lum || 3.8e26) / (dist * dist);
      const mag = Math.log10(flux / 1e-8 + 1);
      const size = Math.max(3, Math.min(64, 2 + mag * 5)) * f.dpr;
      this.ptMat.uniforms.uSize.value = size;
      this.ptMat.uniforms.uColor.value.copy(this.color).multiplyScalar(Math.min(30, 0.6 + mag * 1.8));
    }
  }

  dispose() {
    for (const o of [this.mesh, this.corona, this.point]) { o.parent && o.parent.remove(o); o.geometry.dispose(); o.material.dispose(); }
  }
}
