// FREE FREELY - 물리 기반 대기 산란 하늘, 태양/달/별, 밤낮 순환
import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU, makeRng } from '../core/utils.js';

/* Rayleigh/Mie 산란(Preetham 모델) 기반 스카이돔 셰이더 */
const SKY_VERT = /* glsl */`
varying vec3 vWorldPos;
varying vec3 vSunDir;
varying float vSunE;
varying float vSunfade;
varying vec3 vBetaR;
varying vec3 vBetaM;

uniform vec3 sunPosition;
uniform float rayleigh;
uniform float turbidity;
uniform float mieCoefficient;
uniform float upSampleShift;

const vec3 up = vec3(0.0, 1.0, 0.0);
const float e = 2.71828182845904523536028747135266249775724709369995957;
const float pi = 3.141592653589793238462643383279502884197169;
const vec3 lambda = vec3(680E-9, 550E-9, 450E-9);
const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
const float v = 4.0;
const vec3 K = vec3(0.686, 0.678, 0.666);
const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);
const float cutoffAngle = 1.6110731556870734;
const float steepness = 1.5;
const float EE = 1000.0;

float sunIntensity(float zenithAngleCos) {
  zenithAngleCos = clamp(zenithAngleCos, -1.0, 1.0);
  return EE * max(0.0, 1.0 - pow(e, -((cutoffAngle - acos(zenithAngleCos)) / steepness)));
}

vec3 totalMie(float T) {
  float c = (0.2 * T) * 10E-18;
  return 0.434 * c * MieConst;
}

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  vSunDir = normalize(sunPosition);
  vSunE = sunIntensity(dot(vSunDir, up));
  vSunfade = 1.0 - clamp(1.0 - exp((sunPosition.y / 450000.0)), 0.0, 1.0);
  float rayleighCoefficient = rayleigh - (1.0 * (1.0 - vSunfade));
  vBetaR = totalRayleigh * rayleighCoefficient;
  vBetaM = totalMie(turbidity) * mieCoefficient;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w;   // 무한원 배경
}`;

const SKY_FRAG = /* glsl */`
varying vec3 vWorldPos;
varying vec3 vSunDir;
varying float vSunE;
varying float vSunfade;
varying vec3 vBetaR;
varying vec3 vBetaM;

uniform float mieDirectionalG;
uniform float exposure;
uniform float starIntensity;
uniform vec3 moonDirection;
uniform float moonPhase;
uniform float cloudCover;
uniform float time;

const vec3 up = vec3(0.0, 1.0, 0.0);
const float pi = 3.141592653589793238462643383279502884197169;
const float rayleighZenithLength = 8.4E3;
const float mieZenithLength = 1.25E3;
const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
const float ONE_OVER_FOURPI = 0.07957747154594767;

float rayleighPhase(float cosTheta) {
  return THREE_OVER_SIXTEENPI * (1.0 + pow(cosTheta, 2.0));
}
float hgPhase(float cosTheta, float g) {
  float g2 = pow(g, 2.0);
  float inv = 1.0 / max(1.0e-3, pow(1.0 - 2.0 * g * cosTheta + g2, 1.5));
  return ONE_OVER_FOURPI * ((1.0 - g2) * inv);
}

// 해시 기반 별 필드
float hash13(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float starField(vec3 dir) {
  vec3 p = dir * 220.0;
  vec3 id = floor(p);
  vec3 f = fract(p) - 0.5;
  float h = hash13(id);
  if (h < 0.9965) return 0.0;
  float d = length(f);
  float bright = (h - 0.9965) / 0.0035;
  float tw = 0.65 + 0.35 * sin(time * (1.5 + bright * 5.0) + h * 90.0);
  return smoothstep(0.42, 0.0, d) * bright * tw;
}

void main() {
  vec3 direction = normalize(vWorldPos - cameraPosition);

  // 광학 깊이
  float zenithAngle = acos(max(0.0, dot(up, direction)));
  float inv = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - ((zenithAngle * 180.0) / pi), -1.253));
  float sR = rayleighZenithLength * inv;
  float sM = mieZenithLength * inv;
  vec3 Fex = exp(-(vBetaR * sR + vBetaM * sM));

  float cosTheta = dot(direction, vSunDir);
  float rPhase = rayleighPhase(cosTheta * 0.5 + 0.5);
  vec3 betaRTheta = vBetaR * rPhase;
  float mPhase = hgPhase(cosTheta, mieDirectionalG);
  vec3 betaMTheta = vBetaM * mPhase;

  vec3 Lin = pow(vSunE * ((betaRTheta + betaMTheta) / (vBetaR + vBetaM)) * (1.0 - Fex), vec3(1.5));
  Lin *= mix(vec3(1.0), pow(vSunE * ((betaRTheta + betaMTheta) / (vBetaR + vBetaM)) * Fex, vec3(0.5)),
             clamp(pow(1.0 - dot(up, vSunDir), 5.0), 0.0, 1.0));

  // 밤하늘 기본색 + 별 + 은하수 느낌의 밝은 띠
  vec3 L0 = vec3(0.09, 0.12, 0.22) * starIntensity * 0.22 + vec3(0.1) * Fex;
  float stars = starField(direction) * starIntensity;
  float milky = smoothstep(0.16, 0.0, abs(dot(direction, normalize(vec3(0.5, 0.3, 0.8)))));
  L0 += vec3(stars) * vec3(1.0, 0.97, 0.92) * 3.0;
  L0 += milky * starIntensity * vec3(0.06, 0.07, 0.11);

  // 태양 원반
  float sundisk = smoothstep(0.99986, 0.99993, cosTheta);
  L0 += (vSunE * 19000.0 * Fex) * sundisk;

  // 달 (원반 + 위상 + 헤일로)
  float mcos = dot(direction, normalize(moonDirection));
  float moonDisk = smoothstep(0.99975, 0.99989, mcos);
  float halo = pow(max(0.0, mcos), 900.0) * 0.25 + pow(max(0.0, mcos), 60.0) * 0.02;
  vec3 moonCol = vec3(0.95, 0.94, 0.88) * (0.35 + 0.65 * moonPhase);
  L0 += moonCol * (moonDisk * 55.0 + halo * 12.0) * starIntensity;

  vec3 texColor = (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);
  vec3 retColor = pow(texColor, vec3(1.0 / (1.2 + (1.2 * vSunfade))));

  // 흐린 날씨: 하늘 채도 하강
  retColor = mix(retColor, vec3(dot(retColor, vec3(0.33)) * 0.92), cloudCover * 0.55);
  gl_FragColor = vec4(retColor * exposure, 1.0);
}`;

export class Sky {
  constructor(scene) {
    this.scene = scene;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        sunPosition: { value: new THREE.Vector3(0, 100000, 0) },
        moonDirection: { value: new THREE.Vector3(0, -1, 0) },
        rayleigh: { value: 2.0 },
        turbidity: { value: 4.2 },
        mieCoefficient: { value: 0.0045 },
        mieDirectionalG: { value: 0.8 },
        exposure: { value: 1.0 },
        starIntensity: { value: 0 },
        moonPhase: { value: 0.75 },
        cloudCover: { value: 0.1 },
        time: { value: 0 },
        upSampleShift: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.scale.setScalar(450000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);

    // 조명
    this.sunLight = new THREE.DirectionalLight(0xfff2e0, 3.0);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 2600;
    this.sunLight.shadow.camera.left = -420;
    this.sunLight.shadow.camera.right = 420;
    this.sunLight.shadow.camera.top = 420;
    this.sunLight.shadow.camera.bottom = -420;
    this.sunLight.shadow.bias = -0.0006;
    this.sunLight.shadow.normalBias = 0.9;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    this.moonLight = new THREE.DirectionalLight(0x9fb6ff, 0.0);
    scene.add(this.moonLight);

    this.hemi = new THREE.HemisphereLight(0x9fc4ff, 0x4a3f32, 0.6);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x3a4a66, 0.25);
    scene.add(this.ambient);

    // 렌즈 플레어 대용 태양 스프라이트 (블룸과 결합)
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: 0xfff0c0,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    }));
    this.sunSprite.scale.setScalar(9000);
    this.sunSprite.renderOrder = 5;
    scene.add(this.sunSprite);

    this.sunDirection = new THREE.Vector3(0, 1, 0);
    this.moonDirection = new THREE.Vector3(0, -1, 0);
    this.fogColor = new THREE.Color(0x9ec4e8);
    this.horizonColor = new THREE.Color(0xaed2f0);
    this.sunColor = new THREE.Color(0xffffff);
    this.dayFactor = 1;
    this.timeOfDay = 9;
    this.starRng = makeRng(7);
  }

  /** timeOfDay: 0..24 (12 = 정오) */
  update(timeOfDay, cameraPos, cloudCover = 0.1, elapsed = 0) {
    this.timeOfDay = timeOfDay;
    const t = (timeOfDay / 24) * TAU - Math.PI / 2;
    // 계절/위도 느낌을 위해 약간 기울인 태양 궤도
    const tilt = 0.32;
    const sunAlt = Math.sin(t) * Math.cos(tilt) - 0.06;
    const dir = new THREE.Vector3(
      Math.cos(t) * 0.55 + 0.1,
      sunAlt,
      Math.sin(tilt) * Math.sin(t) + Math.cos(t) * 0.25
    ).normalize();
    this.sunDirection.copy(dir);
    this.moonDirection.copy(dir).negate();
    this.moonDirection.x += 0.18;
    this.moonDirection.normalize();

    const u = this.material.uniforms;
    u.sunPosition.value.copy(dir).multiplyScalar(400000);
    u.moonDirection.value.copy(this.moonDirection);
    u.time.value = elapsed;
    u.cloudCover.value = cloudCover;

    const day = clamp((dir.y + 0.06) / 0.28, 0, 1);           // 0=밤 1=낮
    const dusk = smoothstep(1 - Math.abs(dir.y) / 0.22) * (1 - day * 0.2);
    this.dayFactor = day;
    u.starIntensity.value = clamp(1 - day * 1.9, 0, 1);
    u.turbidity.value = lerp(2.4, 8.0, dusk) + cloudCover * 6;
    u.rayleigh.value = lerp(1.4, 2.6, day) + dusk * 1.4;
    u.mieCoefficient.value = lerp(0.003, 0.012, dusk) + cloudCover * 0.004;
    u.exposure.value = lerp(0.5, 0.86, day);

    // 태양광 색/강도 — 일출·일몰의 붉은 기운
    const warm = new THREE.Color(0xff7a33);
    const noon = new THREE.Color(0xfff4e2);
    this.sunColor.copy(warm).lerp(noon, smoothstep(clamp(dir.y / 0.35, 0, 1)));
    this.sunLight.color.copy(this.sunColor);
    this.sunLight.intensity = lerp(0.0, 3.4, clamp(dir.y * 3.2, 0, 1)) * (1 - cloudCover * 0.45);
    this.sunLight.position.copy(cameraPos).addScaledVector(dir, 900);
    this.sunLight.target.position.copy(cameraPos);
    this.sunLight.visible = this.sunLight.intensity > 0.01;

    this.moonLight.position.copy(cameraPos).addScaledVector(this.moonDirection, 900);
    this.moonLight.intensity = clamp((1 - day) * 0.5, 0, 0.5) * clamp(this.moonDirection.y * 2.4, 0, 1);

    this.hemi.intensity = lerp(0.12, 0.55, day) * (1 + cloudCover * 0.25);
    this.hemi.color.setHSL(0.58, lerp(0.15, 0.55, day), lerp(0.22, 0.66, day));
    this.hemi.groundColor.setHSL(0.09, 0.35, lerp(0.05, 0.28, day));
    this.ambient.intensity = lerp(0.1, 0.2, day);

    // 안개색 = 지평선 하늘색 근사
    // 안개(대기 산란) 색: 너무 밝으면 원경이 하얗게 날아가므로 명도를 억제
    const hz = new THREE.Color().setHSL(
      lerp(0.6, 0.565, day),
      lerp(0.4, 0.42, day) + dusk * 0.25,
      lerp(0.05, 0.58, day) * (1 - cloudCover * 0.2)
    );
    if (dusk > 0.3) hz.lerp(new THREE.Color(0xff9a55), (dusk - 0.3) * 0.55);
    this.fogColor.copy(hz);
    this.horizonColor.copy(hz);

    this.sunSprite.position.copy(cameraPos).addScaledVector(dir, 150000);
    this.sunSprite.material.opacity = clamp(day * 0.85 + dusk * 0.4, 0, 1);
    this.sunSprite.scale.setScalar(lerp(14000, 8000, day));
    this.sunSprite.material.color.copy(this.sunColor);

    this.mesh.position.copy(cameraPos);
  }
}

export function makeGlowTexture(size = 128, inner = 0.0, power = 2.6) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, size * inner, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const a = Math.pow(1 - t, power);
    g.addColorStop(t, `rgba(255,255,255,${a})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
