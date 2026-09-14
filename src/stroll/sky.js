// 고요(GOYO) — 하늘: 해·달·별·구름과 하루 주기
import * as THREE from 'three';
import { clamp01, lerp, smoothstep, makeRng, TAU } from '../core/utils.js';

/* ------------------------------------------------------------------ */
/* 하늘 돔 셰이더                                                      */
/* ------------------------------------------------------------------ */
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunTint;
uniform vec3 uMoonDir;
uniform float uSunSize;
uniform float uNight;
uniform float uHaze;
varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);
  float up = d.y;

  // 천정 ↔ 지평 그라디언트 (지평 근처를 강하게 눌러 대기 두께를 흉내)
  float t = pow(clamp(up * 1.0 + 0.02, 0.0, 1.0), 0.42);
  vec3 col = mix(uHorizon, uZenith, t);

  // 지평선 아래는 지면 반사색으로
  col = mix(col, uGround, smoothstep(0.0, -0.09, up));

  // 태양 주변 산란 (Mie 근사)
  float cs = max(dot(d, uSunDir), 0.0);
  float glow = pow(cs, 8.0) * 0.35 + pow(cs, 64.0) * 0.55 + pow(cs, 900.0) * 1.4;
  float horizonBoost = 1.0 + uHaze * 2.4 * (1.0 - smoothstep(0.0, 0.35, abs(up)));
  col += uSunTint * glow * horizonBoost;

  // 태양 원반
  float disk = smoothstep(uSunSize, uSunSize * 0.985, acos(clamp(cs, -1.0, 1.0)));
  col += uSunTint * disk * 14.0 * (1.0 - uNight * 0.8);

  // 달빛 산란
  float cm = max(dot(d, uMoonDir), 0.0);
  col += vec3(0.55, 0.62, 0.82) * pow(cm, 90.0) * 0.25 * uNight;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* ------------------------------------------------------------------ */
/* 캔버스 텍스처들                                                     */
/* ------------------------------------------------------------------ */
function radialTexture(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([p, col]) => grad.addColorStop(p, col));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 부드러운 구름 퍼프 — 가장자리를 노이즈로 갉아 구름결을 만든다 */
function puffTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const rng = makeRng(4242);
  const cells = [];
  for (let i = 0; i < 26; i++) cells.push([rng(), rng(), 0.1 + rng() * 0.22]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const r = Math.hypot(u - 0.5, v - 0.5) * 2;
      let a = 1 - smoothstep(clamp01((r - 0.08) / 0.88));
      a *= a;
      let bump = 0;
      for (const [cx, cy, cr] of cells) {
        const d = Math.hypot(u - cx, v - cy);
        bump += Math.max(0, 1 - d / cr);
      }
      a *= clamp01(0.4 + bump * 0.32);
      const i4 = (y * size + x) * 4;
      img.data[i4] = 255; img.data[i4 + 1] = 255; img.data[i4 + 2] = 255;
      img.data[i4 + 3] = Math.round(clamp01(a) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 달 — 바다(어두운 무늬)와 크레이터 */
function moonTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 2, 0, TAU);
  g.fillStyle = '#e9e7df'; g.fill();
  const rng = makeRng(9911);
  g.save(); g.clip();
  for (let i = 0; i < 9; i++) {
    const x = rng() * size, y = rng() * size, r = size * (0.08 + rng() * 0.17);
    g.globalAlpha = 0.12 + rng() * 0.1;
    g.fillStyle = '#8d8b86';
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  for (let i = 0; i < 40; i++) {
    const x = rng() * size, y = rng() * size, r = size * (0.008 + rng() * 0.035);
    g.globalAlpha = 0.18 + rng() * 0.25;
    g.fillStyle = rng() > 0.5 ? '#b9b6ae' : '#fbfaf6';
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------ */
/* 시간대별 색 프리셋 (태양 고도 기준)                                   */
/* ------------------------------------------------------------------ */
const KEYS = [
  { el: -1.00, zenith: 0x04060f, horizon: 0x0a1020, ground: 0x05070d, sun: 0x24304a, haze: 0.05,
    light: 0x2a3a63, intensity: 0.0, moon: 0.75, hemiSky: 0x20325e, hemiGround: 0x141822, hemi: 0.45,
    fog: 0x0a1020, fogNear: 12, fogFar: 260, expo: 1.22 },
  { el: -0.24, zenith: 0x0a1428, horizon: 0x20293f, ground: 0x0c1018, sun: 0x4a3c50, haze: 0.22,
    light: 0x40506e, intensity: 0.03, moon: 0.6, hemiSky: 0x2b3c68, hemiGround: 0x1a1e26, hemi: 0.6,
    fog: 0x1b2438, fogNear: 10, fogFar: 220, expo: 1.16 },
  { el: -0.06, zenith: 0x1d3358, horizon: 0xb4674a, ground: 0x2a2622, sun: 0xff8a4a, haze: 0.85,
    light: 0xff8c5a, intensity: 0.0, moon: 0.3, hemiSky: 0x5a6a90, hemiGround: 0x3a3026, hemi: 0.9,
    fog: 0x6d5a5c, fogNear: 8, fogFar: 200, expo: 1.08 },
  { el: 0.06, zenith: 0x2f5c96, horizon: 0xf0a06a, ground: 0x4a3d31, sun: 0xffb070, haze: 0.7,
    light: 0xffb072, intensity: 1.5, moon: 0.0, hemiSky: 0x7c9ac4, hemiGround: 0x4a4032, hemi: 0.7,
    fog: 0xc2a291, fogNear: 10, fogFar: 240, expo: 1.0 },
  { el: 0.30, zenith: 0x3f7ec4, horizon: 0xbcd3e6, ground: 0x6b6553, sun: 0xfff0d2, haze: 0.35,
    light: 0xfff2dc, intensity: 2.6, moon: 0.0, hemiSky: 0x9dc2e8, hemiGround: 0x6a6a50, hemi: 0.85,
    fog: 0xb9cbdc, fogNear: 24, fogFar: 420, expo: 0.95 },
  { el: 0.85, zenith: 0x2f6fbe, horizon: 0xcfe0ec, ground: 0x77705c, sun: 0xfffaf0, haze: 0.22,
    light: 0xfff8ec, intensity: 3.1, moon: 0.0, hemiSky: 0xa8cdf0, hemiGround: 0x767454, hemi: 0.95,
    fog: 0xc6d6e4, fogNear: 30, fogFar: 520, expo: 0.92 },
];

const _ca = new THREE.Color(), _cb = new THREE.Color();
// 색으로 다뤄야 하는 항목 (16진수도 숫자라 이름으로 구분한다)
const COLOR_KEYS = new Set(['zenith', 'horizon', 'ground', 'sun', 'light', 'hemiSky', 'hemiGround', 'fog']);

function sampleKeys(el, field, out) {
  let i = 0;
  while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = smoothstep(clamp01((el - a.el) / (b.el - a.el)));
  if (!COLOR_KEYS.has(field)) return lerp(a[field], b[field], t);
  return (out || _ca).setHex(a[field], THREE.SRGBColorSpace)
    .lerp(_cb.setHex(b[field], THREE.SRGBColorSpace), t);
}

/* ------------------------------------------------------------------ */
export class Sky {
  constructor(scene, renderer, opts = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.time = opts.time ?? 0.30;       // 0=자정, 0.25=일출, 0.5=정오
    this.dayLength = opts.dayLength ?? 900; // 하루(초)
    this.paused = false;

    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.night = 0;
    this.sunElevation = 0;

    this._buildDome();
    this._buildStars();
    this._buildMoon();
    this._buildClouds();
    this._buildLights();
    this.update(0, new THREE.Vector3());
  }

  _buildDome() {
    this.uniforms = {
      uZenith: { value: new THREE.Color(0x3f7ec4) },
      uHorizon: { value: new THREE.Color(0xbcd3e6) },
      uGround: { value: new THREE.Color(0x6b6553) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunTint: { value: new THREE.Color(0xfff0d2) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uSunSize: { value: 0.0092 },
      uNight: { value: 0 },
      uHaze: { value: 0.3 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 32), mat);
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.scene.add(this.dome);
  }

  _buildStars() {
    const rng = makeRng(20260914);
    const N = 2600;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const siz = new Float32Array(N);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      // 은하수 띠를 흉내내어 일부를 한 평면 근처에 몰아준다
      let v;
      if (i % 3 === 0) {
        const a = rng() * TAU;
        const band = (rng() + rng() + rng() - 1.5) * 0.24;
        v = new THREE.Vector3(Math.cos(a), band, Math.sin(a))
          .applyAxisAngle(new THREE.Vector3(1, 0, 0.35).normalize(), 0.9).normalize();
      } else {
        v = new THREE.Vector3(rng() * 2 - 1, rng(), rng() * 2 - 1).normalize();
      }
      if (v.y < 0.01) v.y = 0.01 + rng() * 0.04;
      v.multiplyScalar(3600);
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      const temp = rng();
      c.setHSL(temp < 0.72 ? 0.58 - temp * 0.1 : 0.09, 0.28 + rng() * 0.35, 0.72 + rng() * 0.25);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      siz[i] = (rng() < 0.06 ? 3.6 : 1.0 + rng() * 1.4) * 22;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));

    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uTwinkle: { value: 0 } },
      vertexShader: /* glsl */`
        attribute float aSize;
        varying vec3 vColor;
        varying float vTw;
        uniform float uTwinkle;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vTw = 0.75 + 0.25 * sin(uTwinkle * 2.1 + position.x * 0.07 + position.z * 0.05);
          gl_PointSize = aSize * (300.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vColor;
        varying float vTw;
        uniform float uOpacity;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          a *= a;
          gl_FragColor = vec4(vColor * vTw, a * uOpacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.renderOrder = -900;
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  _buildMoon() {
    this.moon = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshBasicMaterial({ map: moonTexture(), transparent: true, depthWrite: false, fog: false })
    );
    this.moon.renderOrder = -880;
    this.moon.frustumCulled = false;
    this.scene.add(this.moon);

    this.moonGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1500, 1500),
      new THREE.MeshBasicMaterial({
        map: radialTexture(128, [[0, 'rgba(190,210,255,0.5)'], [0.35, 'rgba(150,175,230,0.14)'], [1, 'rgba(120,150,210,0)']]),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      })
    );
    this.moonGlow.renderOrder = -890;
    this.moonGlow.frustumCulled = false;
    this.scene.add(this.moonGlow);

    // 태양 광휘 (돔 셰이더의 원반 위에 얹는 부드러운 헤일로)
    this.sunGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1500, 1500),
      new THREE.MeshBasicMaterial({
        map: radialTexture(128, [[0, 'rgba(255,244,222,0.6)'], [0.18, 'rgba(255,214,158,0.16)'], [1, 'rgba(255,190,120,0)']]),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      })
    );
    this.sunGlow.renderOrder = -885;
    this.sunGlow.frustumCulled = false;
    this.scene.add(this.sunGlow);
  }

  _buildClouds() {
    const rng = makeRng(777);
    const tex = puffTexture();
    const PUFFS = 620;
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.7,
    });
    this.clouds = new THREE.InstancedMesh(geo, mat, PUFFS);
    this.clouds.frustumCulled = false;
    this.clouds.renderOrder = -800;
    this.clouds.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PUFFS * 3).fill(1), 3);
    this.puffs = [];

    let i = 0;
    while (i < PUFFS) {
      // 적운 덩어리 하나
      const cx = (rng() * 2 - 1) * 2600;
      const cz = (rng() * 2 - 1) * 2600;
      const cy = 260 + rng() * 320;
      const n = 8 + Math.floor(rng() * 12);
      const spread = 90 + rng() * 160;
      const scale = 0.7 + rng() * 0.9;
      for (let k = 0; k < n && i < PUFFS; k++, i++) {
        const a = rng() * TAU, r = Math.pow(rng(), 0.6) * spread;
        this.puffs.push({
          x: cx + Math.cos(a) * r,
          y: cy + (rng() - 0.5) * 40 - r * 0.12,
          z: cz + Math.sin(a) * r * 0.8,
          s: (110 + rng() * 150) * scale * (1 - r / spread * 0.35),
          bright: 0.82 + rng() * 0.18,
          ph: rng() * TAU,
        });
      }
    }
    this.scene.add(this.clouds);

    // 높은 새털구름 한 겹
    const cirrus = new THREE.Mesh(
      new THREE.PlaneGeometry(9000, 9000, 1, 1),
      new THREE.MeshBasicMaterial({
        map: this._cirrusTexture(), transparent: true, opacity: 0.3, depthWrite: false, fog: false,
      })
    );
    cirrus.rotation.x = Math.PI / 2;
    cirrus.position.y = 1200;
    cirrus.renderOrder = -820;
    cirrus.frustumCulled = false;
    this.cirrus = cirrus;
    this.scene.add(cirrus);
  }

  _cirrusTexture(size = 256) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const rng = makeRng(31337);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // 길게 늘어난 결
        let n = 0, amp = 1, f = 1;
        for (let o = 0; o < 4; o++) {
          n += (Math.sin((x / size * 6.3 * f) + Math.cos(y / size * 2.1 * f + o) * 2.4) * 0.5 + 0.5) * amp;
          amp *= 0.5; f *= 2.1;
        }
        n /= 1.9;
        const a = clamp01((n - 0.55) * 2.2) * (0.55 + rng() * 0.45);
        const i4 = (y * size + x) * 4;
        img.data[i4] = 255; img.data[i4 + 1] = 255; img.data[i4 + 2] = 255;
        img.data[i4 + 3] = Math.round(a * 190);
      }
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _buildLights() {
    this.sunLight = new THREE.DirectionalLight(0xfff2dc, 2.6);
    this.sunLight.castShadow = true;
    const s = this.sunLight.shadow;
    s.mapSize.set(2048, 2048);
    s.camera.near = 1; s.camera.far = 320;
    s.camera.left = -70; s.camera.right = 70; s.camera.top = 70; s.camera.bottom = -70;
    s.bias = -0.0008;
    s.normalBias = 0.06;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.moonLight = new THREE.DirectionalLight(0x93a9d8, 0.0);
    this.scene.add(this.moonLight);
    this.scene.add(this.moonLight.target);

    this.hemi = new THREE.HemisphereLight(0xa8cdf0, 0x6a6a50, 0.9);
    this.scene.add(this.hemi);

    this.scene.fog = new THREE.Fog(0xc6d6e4, 30, 520);
  }

  setShadowQuality(q) {
    const size = q === 'low' ? 1024 : q === 'medium' ? 2048 : 3072;
    this.sunLight.shadow.mapSize.set(size, size);
    if (this.sunLight.shadow.map) { this.sunLight.shadow.map.dispose(); this.sunLight.shadow.map = null; }
  }

  /** 하루 주기 갱신 */
  update(dt, playerPos, camera) {
    if (!this.paused) this.time = (this.time + dt / this.dayLength) % 1;

    const ang = (this.time - 0.25) * TAU;          // 0.25 = 일출
    const tilt = 0.32;
    this.sunElevation = Math.sin(ang);
    this.sunDir.set(Math.cos(ang) * Math.sin(tilt), Math.sin(ang), Math.cos(ang) * Math.cos(tilt)).normalize();
    this.moonDir.copy(this.sunDir).multiplyScalar(-1);
    this.moonDir.x += 0.22; this.moonDir.normalize();

    const el = this.sunElevation;
    this.night = clamp01((-el - 0.02) / 0.2);
    this.dayFactor = clamp01((el + 0.08) / 0.25);
    this.goldenFactor = clamp01(1 - Math.abs(el - 0.09) / 0.16);

    const u = this.uniforms;
    sampleKeys(el, 'zenith', u.uZenith.value);
    sampleKeys(el, 'horizon', u.uHorizon.value);
    sampleKeys(el, 'ground', u.uGround.value);
    sampleKeys(el, 'sun', u.uSunTint.value);
    u.uHaze.value = sampleKeys(el, 'haze');
    u.uNight.value = this.night;
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);

    // 조명
    const li = sampleKeys(el, 'intensity');
    sampleKeys(el, 'light', this.sunLight.color);
    this.sunLight.intensity = li;
    this.sunLight.visible = li > 0.01;
    this.moonLight.intensity = sampleKeys(el, 'moon');
    this.moonLight.visible = this.moonLight.intensity > 0.01;
    sampleKeys(el, 'hemiSky', this.hemi.color);
    sampleKeys(el, 'hemiGround', this.hemi.groundColor);
    this.hemi.intensity = sampleKeys(el, 'hemi');

    // 그림자 카메라는 플레이어를 따라다닌다
    const p = playerPos;
    this.sunLight.target.position.copy(p);
    this.sunLight.position.copy(p).addScaledVector(this.sunDir, 140);
    this.moonLight.target.position.copy(p);
    this.moonLight.position.copy(p).addScaledVector(this.moonDir, 140);

    // 안개 — 새벽에는 옅은 물안개가 낀다
    const mist = Math.pow(clamp01(1 - Math.abs(this.time - 0.26) / 0.055), 1.5);
    this.mist = mist;
    sampleKeys(el, 'fog', this.scene.fog.color);
    this.scene.fog.near = lerp(sampleKeys(el, 'fogNear'), 2, mist);
    this.scene.fog.far = lerp(sampleKeys(el, 'fogFar'), 95, mist * 0.85);
    this.renderer.toneMappingExposure = sampleKeys(el, 'expo');

    // 하늘 오브젝트는 카메라를 따라 이동
    this.dome.position.copy(p);
    this.stars.position.copy(p);
    this.starMat.uniforms.uOpacity.value = clamp01(this.night * 1.1 - 0.02);
    this.starMat.uniforms.uTwinkle.value += dt;
    this.stars.rotation.y += dt * 0.004;

    this.moon.position.copy(p).addScaledVector(this.moonDir, 3000);
    this.moon.lookAt(p);
    this.moon.material.opacity = clamp01(this.night * 1.3 + this.moonDir.y * 0.4);
    this.moon.visible = this.moonDir.y > -0.06 && this.moon.material.opacity > 0.02;
    this.moonGlow.position.copy(p).addScaledVector(this.moonDir, 2900);
    this.moonGlow.lookAt(p);
    this.moonGlow.material.opacity = clamp01(this.night) * 0.8;
    this.moonGlow.visible = this.moon.visible;

    this.sunGlow.position.copy(p).addScaledVector(this.sunDir, 2900);
    this.sunGlow.lookAt(p);
    this.sunGlow.material.opacity = clamp01(0.18 + this.goldenFactor * 0.45) * clamp01((el + 0.1) / 0.2);
    this.sunGlow.visible = this.sunGlow.material.opacity > 0.02;

    this._updateClouds(dt, p, camera);
  }

  _updateClouds(dt, p, camera) {
    this._cloudT = (this._cloudT || 0) + dt;
    const drift = this._cloudT * 1.6;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    if (camera) camera.getWorldQuaternion(q);
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();

    // 구름 색 — 낮엔 흰색, 해질녘엔 주황빛, 밤엔 짙은 남색
    const lit = _ca.copy(this.uniforms.uSunTint.value).lerp(_cb.setRGB(1, 1, 1), 0.45 * this.dayFactor);
    const base = _cb.copy(this.uniforms.uHorizon.value).multiplyScalar(1.1);
    const ic = this.clouds.instanceColor;

    for (let i = 0; i < this.puffs.length; i++) {
      const pf = this.puffs[i];
      let x = pf.x + drift;
      x = ((x + 3000) % 6000) - 3000;
      pos.set(p.x + x, pf.y, p.z + pf.z);
      const s = pf.s * (1 + Math.sin(this._cloudT * 0.12 + pf.ph) * 0.04);
      scale.set(s, s, s);
      m.compose(pos, q, scale);
      this.clouds.setMatrixAt(i, m);

      // 태양 쪽 가장자리를 밝게
      const toSun = clamp01((x * this.sunDir.x + pf.z * this.sunDir.z) / 1400 * 0.5 + 0.6);
      const b = pf.bright * (0.35 + 0.65 * this.dayFactor + this.night * 0.05);
      const r = lerp(base.r, lit.r, toSun) * b;
      const g = lerp(base.g, lit.g, toSun) * b;
      const bl = lerp(base.b, lit.b, toSun) * b;
      ic.setXYZ(i, r, g, bl);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
    ic.needsUpdate = true;
    this.clouds.material.opacity = lerp(0.34, 0.78, this.dayFactor);

    this.cirrus.position.set(p.x, 1200, p.z);
    this.cirrus.material.map.offset.x = this._cloudT * 0.0018;
    this.cirrus.material.color.copy(this.uniforms.uSunTint.value).lerp(_ca.setRGB(1, 1, 1), 0.5);
    this.cirrus.material.opacity = lerp(0.08, 0.34, this.dayFactor);
  }

  /** 현재 시각 문자열 (24시간) */
  clock() {
    const total = this.time * 24 * 60;        // time 0 = 자정, 0.25 = 일출
    const h = Math.floor(total / 60), m = Math.floor(total % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  phaseName() {
    const el = this.sunElevation;
    const rising = Math.cos((this.time - 0.25) * TAU) > 0;
    if (el < -0.2) return '깊은 밤';
    if (el < -0.02) return rising ? '동트기 전' : '땅거미';
    if (el < 0.16) return rising ? '일출' : '노을';
    if (el < 0.5) return rising ? '아침' : '오후';
    return '한낮';
  }
}
