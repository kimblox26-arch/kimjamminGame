// 밤낮 — 태양·달 궤도, 하늘/환경광/안개/노출, 가로등·창문 조명, 전술 라이트, 야간투시경
import * as THREE from 'three';
import { clamp, lerp, damp } from './core.js';
import { packFogDir } from './post.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ss = THREE.MathUtils.smoothstep;
// 태양 궤도: 동(+x)에서 떠서 남쪽(+z)으로 기울어 서(-x)로 짐. 15시 = 기존 오후 태양 방향
const E = V(1, 0, 0), UP = V(0, 1, 0), S = V(0, 0, 1), TILT = 0.846, MTILT = 0.7;
export const TIME_PRESETS = { dawn: 5.85, morning: 8.5, day: 12.5, afternoon: 15, dusk: 18.35, night: 23.2 };

export function sunAt(h, out = V(0, 0, 0)) {
  const t = (h - 6) / 12 * Math.PI;
  return out.copy(E).multiplyScalar(Math.cos(t)).addScaledVector(UP, Math.sin(t) * Math.cos(TILT)).addScaledVector(S, Math.sin(t) * Math.sin(TILT)).normalize();
}
function moonAt(h, out = V(0, 0, 0)) {
  const t = (h - 6) / 12 * Math.PI + Math.PI + 0.45;
  return out.copy(E).multiplyScalar(Math.cos(t)).addScaledVector(UP, Math.sin(t) * Math.cos(MTILT)).addScaledVector(S, Math.sin(t) * Math.sin(MTILT)).normalize();
}

// 원형 빛 웅덩이 텍스처 (가로등 바닥)
function poolTex() {
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N;
  const x = c.getContext('2d'), gr = x.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  gr.addColorStop(0, 'rgba(255,220,170,1)'); gr.addColorStop(0.35, 'rgba(255,200,140,0.55)'); gr.addColorStop(1, 'rgba(255,180,120,0)');
  x.fillStyle = gr; x.fillRect(0, 0, N, N);
  return new THREE.CanvasTexture(c);
}

export class DayNight {
  constructor(g, { sunDir, envBaker }) {
    this.g = g; this.sunDir = sunDir; this.baker = envBaker;
    this.h = TIME_PRESETS.afternoon; this.cycle = true; this.speed = 1;   // 실제 1분 = 게임 1시간
    this.sun = V(0, 1, 0); this.moon = V(0, -1, 0);
    this.day = 1; this.tw = 0; this.night = 0; this.lamp = 0;
    this.lightColor = new THREE.Color(); this.lightI = 4.2; this.ambient = 1;
    this.bakeT = 0; this.bakeSun = V(0, 0, 0); this.bakeDay = -1;
    this.buildLamps();
    this.buildFlashlight();
    this.flashOn = false; this.nvg = false; this.nvgK = 0;
  }

  setMode(mode) {
    if (mode === 'cycle') this.cycle = true;
    else if (TIME_PRESETS[mode] != null) { this.cycle = false; this.h = TIME_PRESETS[mode]; this.bakeDay = -1; }
  }
  clock() { const h = Math.floor(this.h), m = Math.floor((this.h - h) * 60); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`; }

  // 가로등: 전구 발광 + 바닥 빛 웅덩이 + 가까운 4개에만 실제 스포트라이트
  buildLamps() {
    const g = this.g, W = g.world;
    this.lamps = (W.streetLamps || []).map((p) => {
      const pool = new THREE.Mesh(new THREE.CircleGeometry(4.5, 32), new THREE.MeshBasicMaterial({ map: this.poolMap || (this.poolMap = poolTex()), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
      pool.rotation.x = -Math.PI / 2; pool.position.set(p.x, 0.03, p.z); pool.renderOrder = 1;
      g.scene.add(pool);
      return { p, pool };
    });
    this.spots = [];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.SpotLight(0xffc98a, 0, 30, 1.05, 0.65, 1.6);
      g.scene.add(s, s.target);
      this.spots.push(s);
    }
    this.spotT = 0;
  }

  // 플레이어 총기 라이트 (그림자 포함) + 광선 원뿔
  buildFlashlight() {
    const g = this.g;
    const L = this.flash = new THREE.SpotLight(0xfff2de, 0, 55, 0.3, 0.55, 1.5);
    L.castShadow = g.settings.quality !== 'low';
    L.shadow.mapSize.set(512, 512); L.shadow.bias = -0.0005; L.shadow.camera.near = 0.2;
    g.scene.add(L, L.target);
    const cone = new THREE.ConeGeometry(1, 1, 28, 1, true); cone.translate(0, -0.5, 0); cone.rotateX(-Math.PI / 2);
    this.beam = new THREE.Mesh(cone, new THREE.ShaderMaterial({
      uniforms: { uK: { value: 0 } },
      vertexShader: `varying float vZ; varying vec3 vN, vV; void main(){ vZ = position.z; vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uK; varying float vZ; varying vec3 vN, vV; void main(){ float e = pow(abs(dot(vN, vV)), 1.5); float a = uK * (1. - vZ) * (1. - vZ) * smoothstep(0.0, 0.08, vZ) * (1. - e) * 0.05; gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a, 1.); }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.beam.scale.set(4.2, 4.2, 14); this.beam.frustumCulled = false; this.beam.renderOrder = 5;
    g.scene.add(this.beam);
    // 뷰모델용 약한 보조광 (손/총 앞부분)
    this.vmFlash = new THREE.PointLight(0xfff2de, 0, 0.9, 2);
    g.vmRoot.add(this.vmFlash); this.vmFlash.position.set(0.05, -0.1, -0.55);
  }

  update(dt) {
    const g = this.g;
    if (this.cycle) this.h = (this.h + dt * this.speed / 60) % 24;
    sunAt(this.h, this.sun); moonAt(this.h, this.moon);
    const el = this.sun.y;
    this.day = ss(el, -0.06, 0.22);
    this.tw = Math.exp(-(((el - 0.01) / 0.11) ** 2));
    this.night = 1 - ss(el, -0.2, -0.02);
    this.lamp = 1 - ss(el, -0.02, 0.1);
    // 주광원: 해가 지평선 위면 해, 아니면 달
    const moonUp = ss(this.moon.y, 0.02, 0.25);
    if (el > -0.035) {
      this.sunDir.copy(this.sun.y < 0.02 ? V(this.sun.x, 0.02, this.sun.z).normalize() : this.sun);
      const warm = ss(el, 0.0, 0.35);
      this.lightColor.setRGB(1.0, lerp(0.52, 0.86, warm), lerp(0.26, 0.69, warm));
      this.lightI = 4.2 * ss(el, -0.035, 0.12);
    } else {
      this.sunDir.copy(this.moon.y > 0.05 ? this.moon : V(0.2, 1, 0.1).normalize());
      this.lightColor.setRGB(0.62, 0.72, 1.0);
      this.lightI = 0.42 * moonUp;
    }
    this.ambient = this.day + this.tw * 0.35 + this.night * 0.12;
    // 하늘
    const su = g.sky.material.uniforms;
    su.uSun.value.copy(this.sun); su.uMoon.value.copy(this.moon);
    su.uDay.value = this.day; su.uTw.value = this.tw; su.uNight.value = this.night;
    // 조명/안개/노출
    const sun = g.sun; sun.color.copy(this.lightColor); sun.intensity = this.lightI;
    g.hemi.intensity = 0.25 * this.day + 0.07 * this.tw + 0.05 * this.night;
    g.hemi.color.setRGB(lerp(0.3, 0.77, this.day), lerp(0.38, 0.84, this.day), lerp(0.6, 0.93, this.day));
    const fc = g.scene.fog.color;
    fc.setRGB(0.02, 0.026, 0.042).lerp(new THREE.Color(0.6, 0.65, 0.68), this.day);
    fc.r += 0.2 * this.tw * (1 - this.day * 0.6); fc.g += 0.11 * this.tw * (1 - this.day * 0.6); fc.b += 0.08 * this.tw * (1 - this.day * 0.6);
    g.scene.fog.far = lerp(0.0046, 0.0055, this.day);   // 밀도
    g.scene.fog.near = packFogDir(this.sunDir);          // 산란 방향 (해/달)
    g.renderer.toneMappingExposure = lerp(2.3, 1.35, Math.sqrt(this.day)) - this.tw * 0.15;
    // 환경광 재굽기 (해 방향 1° 이상 또는 밝기 변화 시, 최대 0.4초마다)
    this.bakeT -= dt;
    if (this.baker && (this.bakeDay < 0 || (this.bakeT <= 0 && (this.sun.dot(this.bakeSun) < 0.99985 || Math.abs(this.day - this.bakeDay) > 0.015)))) {
      const env = this.baker.bake(this.sun, this.moon, this.day, this.tw, this.night);
      g.scene.environment = env; g.vmScene.environment = env; g.env = env;
      this.bakeSun.copy(this.sun); this.bakeDay = this.day; this.bakeT = 0.4;
    }
    // 가로등 · 창문
    const W = g.world, lampK = this.lamp;
    if (W.M.streetLamp) W.M.streetLamp.emissiveIntensity = 0.15 + 11 * lampK;
    if (W.M.glass) { W.M.glass.emissive.setRGB(0.9, 0.62, 0.32); W.M.glass.emissiveIntensity = 0.55 * lampK; }
    for (const l of this.lamps) l.pool.material.opacity = 0.28 * lampK * (1 - this.day) * (1 - this.tw * 0.5);
    this.spotT -= dt;
    if (this.spotT <= 0) {
      this.spotT = 0.5;
      const cp = g.camera.position;
      const near = this.lamps.slice().sort((a, b) => a.p.distanceToSquared(cp) - b.p.distanceToSquared(cp)).slice(0, this.spots.length);
      this.spots.forEach((s, i) => { const l = near[i]; if (!l) { s.intensity = 0; return; } s.position.copy(l.p); s.target.position.set(l.p.x, 0, l.p.z); s.target.updateMatrixWorld(); });
    }
    for (const s of this.spots) s.intensity = 42 * lampK;
    // 전술 라이트
    const f = this.flash, on = this.flashOn && g.player.alive;
    const cam = g.camera, fw = V(0, 0, -1).applyQuaternion(cam.quaternion);
    const W2 = g.weapons, m = W2.item ? null : W2.cur.m;
    const src = V(0.09, -0.07, -0.45);
    if (m) { m.group.updateMatrixWorld(true); const mp = V(0, 0, 0); m.muzzle.getWorldPosition(mp); g.vmCam.worldToLocal(mp); src.copy(mp).add(V(0.02, -0.02, 0.15)); }
    f.position.copy(src).applyQuaternion(cam.quaternion).add(cam.position);
    const aim = m ? V(0, 0, -1).applyQuaternion(m.group.quaternion).applyQuaternion(cam.quaternion) : fw;
    f.target.position.copy(f.position).addScaledVector(aim, 10); f.target.updateMatrixWorld();
    f.intensity = on ? 70 : 0;
    this.beam.visible = false;   // 자기 라이트의 광선은 거의 보이지 않음 (아군 라이트는 광선 표시)
    if (on) {
      this.beam.position.copy(f.position); this.beam.lookAt(f.target.position);
      this.beam.material.uniforms.uK.value = 0.4 + 0.6 * (1 - this.day);
    }
    this.vmFlash.intensity = on ? 0.35 : 0;
    // 야간투시경 자동 이득
    this.nvgK = damp(this.nvgK, this.nvg ? 1 : 0, 10, dt);
  }
}

// 야간투시경: 밝기 증폭(자동 이득) + 녹색 형광 + 노이즈 + 관(tube) 비네트
export const NVGShader = {
  uniforms: { tDiffuse: { value: null }, uK: { value: 0 }, uGain: { value: 8 }, uTime: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uK, uGain, uTime; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec4 src = texture2D(tDiffuse, vUv);
      if (uK < 0.001) { gl_FragColor = src; return; }
      vec3 bl = vec3(0.);
      for (int i = 0; i < 6; i++) { float a = float(i) * 1.047; bl += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * 0.004).rgb; }
      float l = dot(src.rgb, vec3(0.3, 0.59, 0.11)) + dot(bl / 6., vec3(0.3, 0.59, 0.11)) * 0.35;
      float n = h(vUv * vec2(1280., 720.) + fract(uTime * 13.) * 91.) - 0.5;
      float v = 1. - exp(-l * uGain);
      v = pow(clamp(v, 0., 1.), 1.35) + n * 0.1 + 0.015;
      vec2 c = (vUv - 0.5) * vec2(1.6, 1.0); float r = length(c);
      float tube = smoothstep(0.62, 0.5, r) * (1. - 0.35 * smoothstep(0.2, 0.6, r));
      vec3 nv = mix(vec3(0.01, 0.045, 0.02), vec3(0.62, 1.0, 0.66), clamp(v, 0., 1.)) * 0.9 * tube * (0.94 + 0.06 * sin(vUv.y * 700.));
      gl_FragColor = vec4(mix(src.rgb, nv, uK), 1.);
    }`,
};
