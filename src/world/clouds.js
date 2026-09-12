// FREE FREELY - 구름 (빌보드 적란운 군집 + 권운층 + 뇌우)
import * as THREE from 'three';
import { clamp, lerp, rand, randInt, makeRng, fbm2, smoothstep } from '../core/utils.js';

const CLOUD_VERT = /* glsl */`
precision highp float;
attribute vec3 aPos;
attribute vec3 aInfo;      // x: 반경, y: 회전, z: 시드
attribute vec3 aLight;     // 군집 중심에서의 방향 (셀프 섀도잉 근사)
attribute vec2 aFade;      // x: 불투명도, y: 고도비
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uShadowColor;
uniform vec3 uAmbient;
uniform float uCloudScale;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vSeed;
varying float vDepth;

void main() {
  vUv = uv;
  vSeed = aInfo.z;
  float r = aInfo.x * uCloudScale;
  // 카메라를 향한 빌보드
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float ang = aInfo.y + uTime * 0.006 * (aInfo.z - 0.5);
  float c = cos(ang), s = sin(ang);
  vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * r;
  vec3 world = aPos + camRight * p.x + camUp * p.y;

  // 조명: 태양측 밝게, 반대측 어둡게 + 하단 그림자
  float sunFace = dot(normalize(aLight + vec3(0.001)), uSunDir) * 0.5 + 0.5;
  float vertical = clamp(aFade.y, 0.0, 1.0);
  vec3 lit = mix(uShadowColor, uSunColor, pow(sunFace, 1.35));
  lit = mix(lit * 0.62, lit, vertical);
  vColor = lit + uAmbient * 0.35;
  vAlpha = aFade.x;

  vec4 mv = viewMatrix * vec4(world, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const CLOUD_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uTex;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vSeed;
varying float vDepth;

void main() {
  vec2 uv = vUv;
  // 시드별 UV 회전/오프셋으로 동일 텍스처의 반복감 제거
  float a = texture2D(uTex, uv).a;
  a *= vAlpha;
  if (a < 0.004) discard;
  vec3 col = vColor;
  // 근거리 페이드 (카메라가 구름을 통과할 때 팝핑 방지)
  float near = smoothstep(12.0, 150.0, vDepth);
  float far = 1.0 - exp(-pow(vDepth * uFogDensity, 2.0));
  col = mix(col, uFogColor, clamp(far, 0.0, 1.0));
  gl_FragColor = vec4(col, a * near * (1.0 - far * 0.35));
}`;

export function makePuffTexture(size = 192) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half, dy = (y - half) / half;
      const d = Math.hypot(dx, dy);
      let a = smoothstep(1 - d * 1.02);
      // 프랙탈 노이즈로 뭉게뭉게한 실루엣
      const n = fbm2(x * 0.035, y * 0.035, 4) * 0.5 + 0.5;
      const n2 = fbm2(x * 0.11 + 7.7, y * 0.11 - 3.1, 3) * 0.5 + 0.5;
      a *= clamp(n * 1.25 + n2 * 0.45 - 0.32, 0, 1);
      a = Math.pow(clamp(a, 0, 1), 1.25);
      const i = (y * size + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

function makeCirrusTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 가늘고 길게 늘어난 권운 형태
      const n = fbm2(x * 0.012, y * 0.055, 5);
      const streak = fbm2(x * 0.004, y * 0.14 + 20, 3);
      let a = clamp((n * 0.7 + streak * 0.5) * 1.5 - 0.28, 0, 1);
      a = Math.pow(a, 1.5) * 0.85;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export class Clouds {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.maxPuffs = opts.maxPuffs || 3600;
    this.radius = opts.radius || 9000;
    this.rng = makeRng(20260912);
    this.time = 0;
    this.clusters = [];
    this.density = 1;
    this.weather = 'clear';
    this.baseAltitude = 1250;

    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.attributes.position = quad.attributes.position;
    geo.attributes.uv = quad.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(this.maxPuffs * 3), 3);
    this.aInfo = new THREE.InstancedBufferAttribute(new Float32Array(this.maxPuffs * 3), 3);
    this.aLight = new THREE.InstancedBufferAttribute(new Float32Array(this.maxPuffs * 3), 3);
    this.aFade = new THREE.InstancedBufferAttribute(new Float32Array(this.maxPuffs * 2), 2);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aInfo', this.aInfo);
    geo.setAttribute('aLight', this.aLight);
    geo.setAttribute('aFade', this.aFade);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uTex: { value: makePuffTexture() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xfff6ea) },
        uShadowColor: { value: new THREE.Color(0x6d7d95) },
        uAmbient: { value: new THREE.Color(0x9fb8d8) },
        uFogColor: { value: new THREE.Color(0xbdd6ee) },
        uFogDensity: { value: 0.00006 },
        uCloudScale: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.name = 'clouds';
    scene.add(this.mesh);
    this.geo = geo;

    // 권운층
    this.cirrus = new THREE.Mesh(
      new THREE.PlaneGeometry(60000, 60000, 1, 1),
      new THREE.MeshBasicMaterial({
        map: makeCirrusTexture(),
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      })
    );
    this.cirrus.material.map.repeat.set(9, 9);
    this.cirrus.rotation.x = Math.PI / 2;
    this.cirrus.position.y = 8600;
    this.cirrus.renderOrder = 6;
    this.cirrus.frustumCulled = false;
    scene.add(this.cirrus);

    // 번개 섬광
    this.lightning = new THREE.PointLight(0xdfe8ff, 0, 12000, 1.4);
    this.lightning.visible = false;
    scene.add(this.lightning);
    this._lightningTimer = rand(6, 20);
    this.onThunder = null;

    this.rebuild(1, 'clear');
  }

  /** 날씨/밀도에 따라 군집 재배치 */
  rebuild(density = 1, weather = 'clear') {
    this.density = density;
    this.weather = weather;
    const cfg = {
      clear: { clusters: 26, puffs: [7, 14], size: [130, 260], alt: [1400, 2400], op: 0.72, spread: 1.0 },
      cloudy: { clusters: 52, puffs: [10, 22], size: [150, 330], alt: [1000, 2600], op: 0.82, spread: 0.85 },
      overcast: { clusters: 76, puffs: [14, 26], size: [220, 420], alt: [700, 1500], op: 0.88, spread: 0.6 },
      storm: { clusters: 84, puffs: [16, 28], size: [260, 520], alt: [520, 2000], op: 0.95, spread: 0.55 },
    }[weather] || { clusters: 26, puffs: [7, 14], size: [130, 260], alt: [1400, 2400], op: 0.72, spread: 1 };

    const n = Math.max(4, Math.round(cfg.clusters * density));
    this.clusters = [];
    const rng = this.rng;
    for (let i = 0; i < n; i++) {
      const ang = rng() * Math.PI * 2;
      const dist = Math.pow(rng(), 0.6) * this.radius;
      this.clusters.push(this._makeCluster(
        Math.cos(ang) * dist, lerp(cfg.alt[0], cfg.alt[1], rng()), Math.sin(ang) * dist, cfg, rng
      ));
    }
    this.cfg = cfg;
    this.cirrus.material.opacity = weather === 'clear' ? 0.42 : weather === 'cloudy' ? 0.55 : 0.2;
    this.baseAltitude = cfg.alt[0];
    this._writeInstances();
  }

  _makeCluster(x, y, z, cfg, rng) {
    const count = randInt(cfg.puffs[0], cfg.puffs[1]);
    const radius = lerp(cfg.size[0], cfg.size[1], rng()) * lerp(0.8, 1.6, rng());
    const puffs = [];
    const height = radius * lerp(0.6, 1.5, rng());
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const a = rng() * Math.PI * 2;
      const rr = Math.pow(rng(), 0.65) * radius * 1.5;
      // 아래는 평평하고 위로 부풀어 오르는 적운 형태
      const py = Math.pow(1 - t, 0.6) * height * (0.15 + rng() * 0.85) - height * 0.1;
      puffs.push({
        ox: Math.cos(a) * rr,
        oy: py,
        oz: Math.sin(a) * rr * 0.9,
        r: lerp(0.55, 1.25, rng()) * radius * 0.75,
        rot: rng() * Math.PI * 2,
        seed: rng(),
        op: lerp(0.55, 1.0, rng()) * cfg.op,
        vert: clamp(0.25 + py / (height + 1), 0, 1),
      });
    }
    return { x, y, z, radius, puffs, drift: rng() * 0.4 + 0.8 };
  }

  _writeInstances() {
    let k = 0;
    const P = this.aPos.array, I = this.aInfo.array, L = this.aLight.array, F = this.aFade.array;
    for (const c of this.clusters) {
      for (const p of c.puffs) {
        if (k >= this.maxPuffs) break;
        P[k * 3] = c.x + p.ox; P[k * 3 + 1] = c.y + p.oy; P[k * 3 + 2] = c.z + p.oz;
        I[k * 3] = p.r; I[k * 3 + 1] = p.rot; I[k * 3 + 2] = p.seed;
        const len = Math.hypot(p.ox, p.oy + c.radius * 0.3, p.oz) || 1;
        L[k * 3] = p.ox / len; L[k * 3 + 1] = (p.oy + c.radius * 0.3) / len; L[k * 3 + 2] = p.oz / len;
        F[k * 2] = p.op; F[k * 2 + 1] = p.vert;
        k++;
      }
    }
    this.geo.instanceCount = k;
    this.aPos.needsUpdate = true;
    this.aInfo.needsUpdate = true;
    this.aLight.needsUpdate = true;
    this.aFade.needsUpdate = true;
    this.puffCount = k;
  }

  /** 주어진 위치의 구름 농도 (0..1) — 시야 흐림/사운드용 */
  densityAt(pos) {
    let d = 0;
    for (const c of this.clusters) {
      const dx = pos.x - c.x, dy = pos.y - c.y, dz = pos.z - c.z;
      const r = c.radius * 1.5;
      const dist2 = dx * dx + dy * dy * 2.2 + dz * dz;
      if (dist2 < r * r) d = Math.max(d, 1 - Math.sqrt(dist2) / r);
    }
    return clamp(d * 1.2, 0, 1);
  }

  update(dt, camera, sky, windVec) {
    this.time += dt;
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    if (sky) {
      u.uSunDir.value.copy(sky.sunDirection);
      const day = clamp(sky.dayFactor, 0, 1);
      u.uSunColor.value.copy(sky.sunColor).multiplyScalar(lerp(0.35, 1.15, day));
      u.uShadowColor.value.copy(sky.horizonColor).multiplyScalar(lerp(0.25, 0.62, day));
      u.uAmbient.value.copy(sky.horizonColor).multiplyScalar(lerp(0.15, 0.5, day));
      u.uFogColor.value.copy(sky.fogColor);
      this.cirrus.material.color.copy(sky.sunColor).multiplyScalar(lerp(0.25, 1.0, day));
    }

    // 바람에 따른 이동 + 카메라 주변으로 순환 배치
    const wx = (windVec ? windVec.x : 2) * 0.35;
    const wz = (windVec ? windVec.z : 1) * 0.35;
    let moved = false;
    const R = this.radius;
    for (const c of this.clusters) {
      c.x += wx * dt * c.drift;
      c.z += wz * dt * c.drift;
      const dx = c.x - camera.position.x, dz = c.z - camera.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > R * 1.25) {
        // 반대편으로 재배치
        const ang = Math.atan2(dz, dx) + Math.PI + rand(-0.5, 0.5);
        c.x = camera.position.x + Math.cos(ang) * R * rand(0.85, 1.15);
        c.z = camera.position.z + Math.sin(ang) * R * rand(0.85, 1.15);
        c.y = lerp(this.cfg.alt[0], this.cfg.alt[1], Math.random());
        moved = true;
      }
    }
    this._writeInstances();
    void moved;

    this.cirrus.position.x = camera.position.x + this.time * 1.5;
    this.cirrus.position.z = camera.position.z;
    this.cirrus.material.map.offset.x = this.time * 0.0016;
    this.cirrus.material.map.offset.y = this.time * 0.0007;

    // 뇌우: 번개 + 천둥
    if (this.weather === 'storm') {
      this._lightningTimer -= dt;
      if (this._lightningTimer <= 0) {
        this._lightningTimer = rand(3.5, 14);
        const ang = Math.random() * Math.PI * 2;
        const dist = rand(600, 6000);
        this.lightning.position.set(
          camera.position.x + Math.cos(ang) * dist,
          rand(700, 2200),
          camera.position.z + Math.sin(ang) * dist
        );
        this.lightning.visible = true;
        this.lightning.intensity = rand(2500, 9000);
        this._flashLeft = rand(0.08, 0.3);
        if (this.onThunder) this.onThunder(this.lightning.position.clone(), dist);
      }
      if (this._flashLeft > 0) {
        this._flashLeft -= dt;
        this.lightning.intensity *= Math.random() < 0.3 ? 0.35 : 1.0;
        if (this._flashLeft <= 0) { this.lightning.visible = false; this.lightning.intensity = 0; }
      }
    } else {
      this.lightning.visible = false;
    }
  }

  setFogDensity(d) { this.material.uniforms.uFogDensity.value = d; }
}
