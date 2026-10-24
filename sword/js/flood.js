// SKY BLADE — 해일(쓰나미)과 침수
//  물에 아주 세게 부딪히면 (초속 수백 m 이상) 충돌 지점에서 높은 물벽이 둥글게 퍼져 나감
//  - 물벽 높이: 충돌 에너지에 비례, 퍼질수록 낮아짐 (에너지가 둘레로 퍼짐: 1/√R)
//  - 물벽이 지나간 곳은 한동안 잠김 (수위 = 원래 수위 + 침수 높이, 천천히 빠짐)
//  - 땅이 그 수위보다 높으면 물에 안 잠김 → 깊이 버퍼가 알아서 해안선을 그림 (지형·건물에 가려짐)
//  - 물리: waterLevelAt 에 침수 수위를 더해 줌 → 플레이어가 잠긴 거리에서 헤엄치고, 사람·차가 휩쓸림
import * as THREE from 'three';
import { origin } from './frame.js';

const WAVE_VS = /* glsl */`
uniform vec2 uC;       // 중심 (렌더 좌표)
uniform float uR, uW, uH, uHf, uY, uTime;
attribute vec2 aP;     // x: 각 (0..1), y: 단면 위치 (-1 뒤 .. 1 앞)
varying float vCrest;
varying vec3 vWorld;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  float a = aP.x * 6.2831853;
  float s = aP.y;
  // 물벽 단면: 앞은 가파르고 뒤는 완만, 뒤쪽은 침수 높이로 이어짐
  float prof = s > 0.0 ? exp(-pow(s * 2.6, 2.0)) : mix(uHf / max(uH, 0.01), 1.0, exp(-pow(s * 1.3, 2.0)));
  float n = sin(a * 37.0 + uTime * 0.7) * 0.06 + sin(a * 91.0 - uTime * 1.3) * 0.04;
  float h = uH * prof * (1.0 + n);
  float r = uR + s * uW;
  vec3 p = vec3(uC.x + cos(a) * r, uY + h, uC.y + sin(a) * r);
  vCrest = smoothstep(0.55, 0.95, prof) * step(-0.25, s);
  vWorld = p;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
const WAVE_FS = /* glsl */`
uniform vec3 uCol, uSun;
uniform float uTime;
varying float vCrest;
varying vec3 vWorld;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
float hh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y); }
void main() {
  #include <logdepthbuf_fragment>
  vec3 dx = dFdx(vWorld), dy = dFdy(vWorld);
  vec3 N = normalize(cross(dx, dy));
  if (N.y < 0.0) N = -N;
  float lit = 0.35 + 0.65 * max(dot(N, normalize(uSun)), 0.0);
  float foam = vCrest * (0.55 + 0.45 * vn(vWorld.xz * 0.15 + uTime * 0.8));
  foam = max(foam, smoothstep(0.75, 1.0, vn(vWorld.xz * 0.06 - uTime * 0.3)) * 0.35);
  vec3 c = mix(uCol * lit, vec3(0.9, 0.93, 0.95) * lit, clamp(foam, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
const FLOOD_FS = /* glsl */`
uniform vec3 uCol, uSun;
uniform float uTime;
varying vec3 vWorld;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
float hh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y); }
void main() {
  #include <logdepthbuf_fragment>
  float w = vn(vWorld.xz * 0.08 + vec2(uTime * 0.4, uTime * 0.25)) * 0.6 + vn(vWorld.xz * 0.3 - uTime * 0.6) * 0.4;
  float sp = pow(w, 6.0) * 0.35;
  vec3 c = uCol * (0.75 + 0.35 * w) + vec3(sp);
  gl_FragColor = vec4(c, 0.88);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
const FLOOD_VS = /* glsl */`
uniform vec2 uC;
uniform float uR, uY;
varying vec3 vWorld;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vec3 p = vec3(uC.x + position.x * uR, uY, uC.y + position.z * uR);
  vWorld = p;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;

const MAXE = 3;

export class Flood {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.sunDir = opts.sunDir || new THREE.Vector3(0, 1, 0);
    this.events = [];
    const A = opts.quality === 'low' ? 256 : 512, S = 28;
    // 물벽 단면 격자 (각 × 단면)
    const aP = new Float32Array((A + 1) * S * 2), idx = [];
    for (let i = 0; i <= A; i++) for (let j = 0; j < S; j++) { const k = (i * S + j) * 2; aP[k] = i / A; aP[k + 1] = -1 + (2 * j) / (S - 1); }
    for (let i = 0; i < A; i++) for (let j = 0; j < S - 1; j++) { const a = i * S + j, b = a + S; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('aP', new THREE.BufferAttribute(aP, 2));
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array((A + 1) * S * 3), 3));
    wg.setIndex(idx);
    // 침수 원판
    const fg = new THREE.CircleGeometry(1, 160); fg.rotateX(-Math.PI / 2);
    this.slots = [];
    for (let e = 0; e < MAXE; e++) {
      const wu = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uC: { value: new THREE.Vector2() }, uR: { value: 0 }, uW: { value: 60 }, uH: { value: 0 }, uHf: { value: 0 }, uY: { value: 0 }, uTime: { value: 0 },
        uCol: { value: new THREE.Color(0x1d4a52) }, uSun: { value: this.sunDir } }]);
      const wave = new THREE.Mesh(wg, new THREE.ShaderMaterial({ vertexShader: WAVE_VS, fragmentShader: WAVE_FS, uniforms: wu, fog: true, side: THREE.DoubleSide }));
      wave.frustumCulled = false; wave.visible = false; wave.renderOrder = -4;
      const fu = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uC: { value: new THREE.Vector2() }, uR: { value: 0 }, uY: { value: 0 }, uTime: { value: 0 }, uCol: { value: new THREE.Color(0x4a4a3a) }, uSun: { value: this.sunDir } }]);
      const flood = new THREE.Mesh(fg, new THREE.ShaderMaterial({ vertexShader: FLOOD_VS, fragmentShader: FLOOD_FS, uniforms: fu, fog: true, transparent: true, depthWrite: false }));
      flood.frustumCulled = false; flood.visible = false; flood.renderOrder = -3;
      scene.add(wave, flood);
      this.slots.push({ wave, flood, wu, fu });
    }
    this.time = 0;
  }

  get active() { return this.events.length > 0; }

  /** 해일 시작: 절대 (x, z), 수면 높이 level, 충돌 속도 sp (m/s) */
  trigger(x, z, level, sp) {
    const H = Math.min(45, 3 + (sp - 250) / 55);      // 물벽 처음 높이 (m)
    if (H < 2) return null;
    const ev = { x, z, level, H0: H, t: 0, R: 30, c: 22 + H * 0.9, Rmax: 2500 + H * 220, W: 30 + H * 2.2, h: H, hf: 0, drain: 0 };
    if (this.events.length >= MAXE) this.events.shift();
    this.events.push(ev);
    return ev;
  }

  // 지금 이 지점의 물 높이 (원래 수위 wl 과 비교해 높은 쪽)
  levelAt(x, z, wl) {
    let w = wl;
    for (const e of this.events) {
      const d = Math.hypot(x - e.x, z - e.z);
      if (d > e.R + e.W) continue;
      const s = (d - e.R) / e.W;
      let y;
      if (s > 0) y = e.level + e.h * Math.exp(-Math.pow(s * 2.6, 2));
      else y = e.level + e.hf + (e.h - e.hf) * Math.exp(-Math.pow(s * 1.3, 2));
      if (e.hf < 0.05 && s < -1) continue;
      if (y > w) w = y;
    }
    return w;
  }

  // 물벽 띠 안에 있는지 (휩쓸기용): 반환 = [밀어내는 방향 x, z, 물벽 꼭대기 높이] 또는 null
  crestAt(x, z) {
    for (const e of this.events) {
      if (e.h < 1) continue;
      const d = Math.hypot(x - e.x, z - e.z);
      if (Math.abs(d - e.R) > e.W * 0.7) continue;
      return [(x - e.x) / (d || 1), (z - e.z) / (d || 1), e.level + e.h, e.c];
    }
    return null;
  }

  update(dt, heightAt) {
    this.time += dt;
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      e.t += dt;
      if (e.R < e.Rmax) {
        e.R += e.c * dt;
        // 에너지가 둘레로 퍼짐 + 바닥 마찰
        e.h = e.H0 * Math.sqrt(200 / (200 + e.R)) * Math.exp(-e.t / 200);
        // 지나간 자리의 침수 높이: 물벽의 일부가 남음
        e.hf = Math.max(e.hf, e.h * 0.4);
      } else {
        e.h = Math.max(0, e.h - dt * 0.6);
        e.drain += dt;
      }
      // 서서히 빠짐 (약 2분)
      if (e.t > 20) e.hf = Math.max(0, e.hf - dt * (0.04 + e.H0 * 0.002));
      if (e.hf <= 0.02 && e.h <= 0.05) this.events.splice(i, 1);
    }
    for (let k = 0; k < MAXE; k++) {
      const S = this.slots[k], e = this.events[k];
      S.wave.visible = S.flood.visible = !!e;
      if (!e) continue;
      const cx = e.x - origin.x, cz = e.z - origin.z, y = e.level - origin.y;
      S.wu.uC.value.set(cx, cz); S.wu.uR.value = e.R; S.wu.uW.value = e.W; S.wu.uH.value = e.h; S.wu.uHf.value = e.hf; S.wu.uY.value = y; S.wu.uTime.value = this.time;
      S.wave.visible = e.h > 0.15;
      S.fu.uC.value.set(cx, cz); S.fu.uR.value = Math.max(0, e.R - e.W * 0.6); S.fu.uY.value = y + e.hf; S.fu.uTime.value = this.time;
      S.flood.visible = e.hf > 0.05;
    }
  }

  reset() { this.events.length = 0; for (const S of this.slots) { S.wave.visible = false; S.flood.visible = false; } }
}
