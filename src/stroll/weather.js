// 고요(GOYO) — 날씨: 돌풍과 비
import * as THREE from 'three';
import { clamp01, lerp, rand, makeRng } from '../core/utils.js';
import { damp } from './util.js';
import { heightAt, WATER_LEVEL, LAKE } from './terrain.js';

const RAIN_VERT = /* glsl */`
attribute vec3 iPos;
attribute vec2 iSeed;         // x: 속도 편차, y: 길이 편차
uniform float uTime;
uniform vec3 uOrigin;
uniform float uHeight;
uniform float uSpeed;
uniform vec2 uWind;
varying vec2 vUv;

void main() {
  vUv = uv;
  vec3 base = iPos;
  float t = uTime * uSpeed * (0.85 + iSeed.x * 0.3);
  base.y = mod(base.y - t, uHeight);
  vec3 world = uOrigin + base;

  // 바람에 기운 빗줄기 방향
  vec3 dir = normalize(vec3(uWind.x * 0.34, -1.0, uWind.y * 0.34));
  vec3 toCam = normalize(cameraPosition - world);
  vec3 right = normalize(cross(dir, toCam));
  float len = (0.3 + iSeed.y * 0.5);
  world += right * position.x * 0.018 - dir * position.y * len;

  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const RAIN_FRAG = /* glsl */`
uniform float uAmount;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  // 양 끝을 흐리게
  float a = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.72, vUv.y);
  a *= smoothstep(0.0, 0.4, vUv.x) * smoothstep(1.0, 0.6, vUv.x);
  gl_FragColor = vec4(uColor, a * 0.5 * uAmount);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** 빗줄기 — 위치는 GPU에서 순환시키므로 CPU 비용이 거의 없다 */
export class Rain {
  constructor(scene, count = 2600, radius = 26, height = 22) {
    const rng = makeRng(1212);
    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', plane.attributes.position);
    geo.setAttribute('uv', plane.attributes.uv);
    geo.setIndex(plane.index);

    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * radius;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = rng() * height;
      pos[i * 3 + 2] = Math.sin(a) * r;
      seed[i * 2] = rng();
      seed[i * 2 + 1] = rng();
    }
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3));
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seed, 2));
    geo.instanceCount = count;

    this.uniforms = {
      uTime: { value: 0 },
      uOrigin: { value: new THREE.Vector3() },
      uHeight: { value: height },
      uSpeed: { value: 16 },
      uWind: { value: new THREE.Vector2(0.3, 0.1) },
      uAmount: { value: 0 },
      uColor: { value: new THREE.Color(0xd8e4ee) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: RAIN_VERT,
      fragmentShader: RAIN_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    this.mesh.name = 'rain';
    scene.add(this.mesh);
    this.height = height;
  }

  update(dt, px, pz, amount, windX, windZ, skyColor) {
    const u = this.uniforms;
    u.uAmount.value = amount;
    this.mesh.visible = amount > 0.01;
    if (!this.mesh.visible) return;
    u.uTime.value += dt;
    // 빗줄기가 늘 플레이어 머리 위에 있도록 원점만 옮긴다
    u.uOrigin.value.set(px, heightAt(px, pz) - 2, pz);
    u.uWind.value.set(windX, windZ);
    if (skyColor) u.uColor.value.copy(skyColor).lerp(new THREE.Color(0xffffff), 0.55);
  }
}

/**
 * 날씨 상태 — 천천히 오가는 바람과 비.
 * 시각(바람에 눕는 풀·빗줄기)과 청각(바람 소리·빗소리)이 같은 값을 쓴다.
 */
export class Weather {
  constructor(scene, opts = {}) {
    this.rain = new Rain(scene, opts.rainCount ?? 2600);
    this.wind = 0.45;          // 기본 바람 (0~1)
    this.windTarget = 0.45;
    this.gust = 0;             // 돌풍 (0~1)
    this.gustTarget = 0;
    this.rainAmount = 0;
    this.rainTarget = 0;
    this.rainbow = 0;
    this._rainbowT = 0;
    this._windT = 6;
    this._gustT = 8;
    this._weatherT = rand(90, 200);
    this.enabled = opts.rain !== false;
    this.dir = new THREE.Vector2(0.86, 0.51).normalize();
  }

  update(dt, px, pz, sky, water) {
    // 기본 바람 — 아주 천천히 변한다
    this._windT -= dt;
    if (this._windT <= 0) {
      this._windT = rand(8, 22);
      this.windTarget = rand(0.15, 0.9);
    }
    this.wind = damp(this.wind, this.windTarget, 0.25, dt);

    // 돌풍 — 잠깐 훅 불고 잦아든다
    this._gustT -= dt;
    if (this._gustT <= 0) {
      if (this.gustTarget > 0.05) {
        this.gustTarget = 0;
        this._gustT = rand(4, 16);
      } else {
        this.gustTarget = rand(0.35, 1) * lerp(0.6, 1.2, this.wind);
        this._gustT = rand(1.6, 5);
      }
    }
    this.gust = damp(this.gust, this.gustTarget, this.gustTarget > this.gust ? 1.1 : 0.7, dt);

    // 비 — 몇 분에 한 번 지나간다
    this._weatherT -= dt;
    if (this._weatherT <= 0) {
      if (this.rainTarget > 0.02) {
        this.rainTarget = 0;
        this._weatherT = rand(180, 420);
      } else if (this.enabled && Math.random() < 0.45) {
        this.rainTarget = rand(0.35, 1);
        this._weatherT = rand(70, 190);
      } else {
        this._weatherT = rand(90, 220);
      }
    }
    if (!this.enabled) this.rainTarget = 0;
    const before = this.rainAmount;
    this.rainAmount = damp(this.rainAmount, this.rainTarget, 0.12, dt);
    // 비가 그친 직후 잠깐 무지개가 선다
    if (before > 0.25 && this.rainAmount <= 0.25) this._rainbowT = 90;
    if (this._rainbowT > 0) this._rainbowT -= dt;
    this.rainbow = clamp01(Math.min(this._rainbowT / 12, 1) * (1 - this.rainAmount * 3));

    // 바람 방향도 아주 천천히 돈다
    this._dirT = (this._dirT || 0) + dt * 0.02;
    this.dir.set(Math.cos(this._dirT), Math.sin(this._dirT)).normalize();

    this.rain.update(dt, px, pz, this.rainAmount, this.dir.x, this.dir.y,
      sky ? sky.scene.fog.color : null);

    // 빗방울이 호수에 떨어진다
    if (water && this.rainAmount > 0.15) {
      this._splashT = (this._splashT || 0) - dt;
      if (this._splashT <= 0) {
        this._splashT = 0.12 / this.rainAmount;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * LAKE.r * 0.9;
        water.splash(LAKE.x + Math.cos(a) * r, LAKE.z + Math.sin(a) * r, 0.15);
      }
    }
  }

  /** 풀·나무를 흔드는 총 바람 세기 */
  get strength() { return clamp01(0.18 + this.wind * 0.55 + this.gust * 0.75); }
}
