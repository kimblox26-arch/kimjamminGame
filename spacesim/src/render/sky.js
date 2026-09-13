// SpaceSim — 실제 하늘
//
// 밝기 3.5등급까지의 실측 항성을 J2000 적도좌표에서 황도좌표계로 변환해 배치한다.
// 별자리 선과 은하수 띠(은하 북극 기준 절차적 생성)를 함께 그린다.
// 좌표가 실제값이라 오리온·북두칠성·남십자가 하늘에서 그대로 확인된다.

import * as THREE from 'three';
import {
  STARS, CONSTELLATIONS, GALACTIC_POLE, GALACTIC_CENTER,
  equatorialToEcliptic, bvToTemperature,
} from '../data/skycatalog.js';
import { blackbodyRGB } from '../astro/stars.js';

const R_SKY = 2600;

const STAR_VERT = /* glsl */`
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  gl_PointSize = aSize * uScale;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const STAR_FRAG = /* glsl */`
precision highp float;
varying vec3 vColor;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float r = length(uv);
  if (r > 1.0) discard;
  // 중심 코어 + 회절 무늬 느낌의 부드러운 헤일로
  float core = exp(-r * r * 9.0);
  float halo = exp(-r * 2.6) * 0.35;
  gl_FragColor = vec4(vColor * (core + halo), 1.0);
}`;

const MW_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const MW_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uPole;
uniform vec3 uCenter;
uniform float uIntensity;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.13; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float b = asin(clamp(dot(d, uPole), -1.0, 1.0));   // 은위 [rad]
  // pow(음수, n) 은 GLSL 에서 정의되지 않는다 — 제곱은 직접 곱한다
  float b1 = b / 0.20, b2 = b / 0.36;
  float band = exp(-b1 * b1);
  float toCenter = max(dot(d, uCenter), 0.0);
  float bulge = pow(toCenter, 7.0) * exp(-b2 * b2);
  float cl = fbm(d * 7.0);
  float dust = smoothstep(0.40, 0.63, fbm(d * 13.0 + vec3(19.0)));
  float I = (band * (0.30 + 1.15 * cl) + bulge * 1.8) * (1.0 - dust * 0.70);
  vec3 col = mix(vec3(0.40, 0.48, 0.70), vec3(0.96, 0.88, 0.70), toCenter * 0.65);
  gl_FragColor = vec4(col * max(I, 0.0) * uIntensity, 1.0);
}`;

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    scene.add(this.group);

    this.stars = [];           // { name, dir[3], mag }
    this._byId = new Map();

    this._buildMilkyWay();
    this._buildBackground();
    this._buildCatalog();
    this._buildConstellations();

    this.showConstellations = false;
    this.showMilkyWay = true;
  }

  _buildMilkyWay() {
    const pole = equatorialToEcliptic(GALACTIC_POLE.ra, GALACTIC_POLE.dec);
    const center = equatorialToEcliptic(GALACTIC_CENTER.ra, GALACTIC_CENTER.dec);
    this.mwMat = new THREE.ShaderMaterial({
      uniforms: {
        uPole: { value: new THREE.Vector3(...pole) },
        uCenter: { value: new THREE.Vector3(...center) },
        uIntensity: { value: 0.032 },
      },
      vertexShader: MW_VERT,
      fragmentShader: MW_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.milkyWay = new THREE.Mesh(new THREE.SphereGeometry(R_SKY * 1.05, 48, 32), this.mwMat);
    this.milkyWay.frustumCulled = false;
    this.milkyWay.renderOrder = -10;
    this.group.add(this.milkyWay);
  }

  /** 카탈로그에 없는 어두운 별들 — 깊이감을 준다 */
  _buildBackground() {
    const N = 3200;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const size = new Float32Array(N);
    const pole = new THREE.Vector3(...equatorialToEcliptic(GALACTIC_POLE.ra, GALACTIC_POLE.dec));
    const v = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      // 은하면 쪽에 더 조밀하게 뿌린다
      let dir;
      for (let k = 0; k < 8; k++) {
        const u = 2 * Math.random() - 1, th = Math.random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        dir = [s * Math.cos(th), s * Math.sin(th), u];
        v.set(dir[0], dir[1], dir[2]);
        const b = Math.abs(v.dot(pole));
        if (Math.random() < 0.25 + 0.75 * Math.exp(-((b / 0.35) ** 2))) break;
      }
      pos[i * 3] = dir[0] * R_SKY;
      pos[i * 3 + 1] = dir[1] * R_SKY;
      pos[i * 3 + 2] = dir[2] * R_SKY;
      const T = 2800 + Math.pow(Math.random(), 2.2) * 16000;
      const rgb = blackbodyRGB(T);
      const f = 0.22 + Math.pow(Math.random(), 2.6) * 0.5;
      col[i * 3] = rgb[0] * f;
      col[i * 3 + 1] = rgb[1] * f;
      col[i * 3 + 2] = rgb[2] * f;
      size[i] = 0.6 + Math.pow(Math.random(), 3) * 1.3;
    }
    this.bgPoints = this._makePoints(pos, col, size);
    this.group.add(this.bgPoints);
  }

  _buildCatalog() {
    const n = STARS.length;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const [id, name, ra, dec, mag, bv] = STARS[i];
      const d = equatorialToEcliptic(ra, dec);
      pos[i * 3] = d[0] * R_SKY;
      pos[i * 3 + 1] = d[1] * R_SKY;
      pos[i * 3 + 2] = d[2] * R_SKY;
      const rgb = blackbodyRGB(Math.min(30000, Math.max(2200, bvToTemperature(bv ?? 0.6))));
      // 플럭스 ∝ 10^(-0.4 m) 이지만 그대로 쓰면 대비가 과해 지수를 완화한다
      const f = Math.min(1.15, Math.pow(10, -0.16 * mag) * 0.78);
      col[i * 3] = rgb[0] * f;
      col[i * 3 + 1] = rgb[1] * f;
      col[i * 3 + 2] = rgb[2] * f;
      size[i] = Math.max(1.1, Math.pow(10, -0.10 * mag) * 2.3);
      const star = { id, name, dir: d, mag };
      this.stars.push(star);
      this._byId.set(id, star);
    }
    this.catalogPoints = this._makePoints(pos, col, size);
    this.group.add(this.catalogPoints);
  }

  _makePoints(pos, col, size) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 1 } },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    p.renderOrder = -9;
    return p;
  }

  _buildConstellations() {
    const pts = [];
    for (const c of CONSTELLATIONS) {
      for (const [a, b] of c.lines) {
        const sa = this._byId.get(a), sb = this._byId.get(b);
        if (!sa || !sb) continue;
        pts.push(
          sa.dir[0] * R_SKY, sa.dir[1] * R_SKY, sa.dir[2] * R_SKY,
          sb.dir[0] * R_SKY, sb.dir[1] * R_SKY, sb.dir[2] * R_SKY,
        );
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      color: 0x5bb7e0, transparent: true, opacity: 0.24,
      depthWrite: false, depthTest: false,
    }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = -8;
    this.lines.visible = false;
    this.group.add(this.lines);
  }

  /** 하늘은 무한원에 있으므로 카메라를 따라다닌다 */
  update(camera, dpr) {
    this.group.position.copy(camera.position);
    const s = Math.min(dpr, 2);
    this.bgPoints.material.uniforms.uScale.value = s;
    this.catalogPoints.material.uniforms.uScale.value = s;
    this.lines.visible = this.showConstellations;
    this.milkyWay.visible = this.showMilkyWay;
  }

  /** 라벨용 — 밝은 별 목록 */
  brightStars(maxMag = 1.7) {
    return this.stars.filter((s) => s.mag <= maxMag);
  }

  setIntensity(v) {
    this.mwMat.uniforms.uIntensity.value = v;
  }
}
