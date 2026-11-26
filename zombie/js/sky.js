// 하늘(대기 산란 근사 + 구름), 태양/달, 조명, 안개, 환경맵
import * as THREE from 'three';
import { clamp, smooth, lerp } from './util.js';

const skyVS = `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;
const skyFS = `
uniform vec3 uSun; uniform vec3 uMoon; uniform float uDay; uniform float uTime; uniform float uCloud; uniform float uSmoke;
varying vec3 vDir;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=0.0, w=0.5; for(int i=0;i<5;i++){ a+=w*n2(p); p*=2.03; w*=0.5; } return a; }
void main(){
  vec3 d = normalize(vDir); float y = max(d.y, -0.05);
  float sd = dot(d, uSun); float se = uSun.y;
  // 기본 하늘색 (낮/노을/밤)
  vec3 zen = mix(vec3(0.01,0.015,0.035), vec3(0.18,0.36,0.66), uDay);
  vec3 hor = mix(vec3(0.03,0.04,0.07), vec3(0.62,0.70,0.78), uDay);
  float dusk = smoothstep(0.35, 0.0, abs(se)) * smoothstep(-0.25, 0.05, se);
  hor = mix(hor, vec3(0.95,0.52,0.28), dusk * 0.75 * smoothstep(-0.2, 0.9, sd));
  vec3 col = mix(hor, zen, pow(clamp(y,0.0,1.0), 0.45));
  // 미 산란 / 태양
  col += vec3(1.0,0.85,0.6) * pow(max(sd,0.0), 8.0) * 0.35 * uDay;
  col += vec3(1.0,0.95,0.85) * smoothstep(0.9993, 0.9997, sd) * 18.0 * step(-0.02, se);
  // 달
  float md = dot(d, uMoon); col += vec3(0.8,0.85,1.0) * smoothstep(0.9995,0.9997, md) * 2.5 * (1.0-uDay);
  // 별
  if (uDay < 0.3) { vec2 sp = d.xz / (d.y + 0.25) * 220.0; float s = h(floor(sp)); col += vec3(step(0.997, s) * (1.0 - uDay/0.3) * smoothstep(0.0,0.2,d.y)) * 0.9; }
  // 구름
  if (d.y > 0.0) {
    vec2 cp = d.xz / (d.y + 0.08) * 1.6 + vec2(uTime*0.004, uTime*0.002);
    float c = smoothstep(0.55 - uCloud*0.35, 0.95, fbm(cp));
    vec3 cc = mix(vec3(0.05,0.05,0.07), vec3(0.85,0.85,0.86), uDay) + vec3(1.0,0.6,0.35) * dusk * 0.5;
    cc *= 0.75 + 0.35 * pow(max(sd,0.0), 4.0);
    col = mix(col, cc, c * smoothstep(0.0, 0.15, d.y) * 0.9);
    // 도시 화재 연기(지평선 근처 갈색 띠)
    float sm = fbm(vec2(atan(d.x,d.z)*6.0, d.y*8.0 - uTime*0.01));
    col = mix(col, vec3(0.25,0.21,0.18)*(0.3+uDay*0.7), uSmoke * smoothstep(0.25,0.0,d.y) * sm * 0.7);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor(renderer, scene) {
    this.renderer = renderer; this.scene = scene;
    this.uniforms = { uSun: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: new THREE.Vector3(0, -1, 0) }, uDay: { value: 1 }, uTime: { value: 0 }, uCloud: { value: 0.5 }, uSmoke: { value: 0.6 } };
    const mat = new THREE.ShaderMaterial({ vertexShader: skyVS, fragmentShader: skyFS, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(10000, 48, 24), mat); this.dome.frustumCulled = false; this.dome.renderOrder = -10;
    scene.add(this.dome);
    // 환경맵용 별도 씬
    this.envScene = new THREE.Scene(); this.envDome = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat); this.envScene.add(this.envDome);
    this.pmrem = new THREE.PMREMGenerator(renderer); this.envRT = null; this.envTimer = 0;

    this.sun = new THREE.DirectionalLight(0xffffff, 3); this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd4ee, 0x4a4036, 0.6); scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xaab4bd, 0.00045);
    this.fogBase = 0.00045; this.dayF = 1; this.cloud = 0.5;
  }
  setShadow(size, range = 60) {
    const s = this.sun.shadow; this.sun.castShadow = size > 0;
    if (size > 0) { s.mapSize.set(size, size); const c = s.camera; c.left = c.bottom = -range; c.right = c.top = range; c.near = 1; c.far = 400; c.updateProjectionMatrix(); if (s.map) { s.map.dispose(); s.map = null; } }
  }
  // hours: 0~24, focus: 플레이어 위치
  update(hours, dt, focus, indoor = 0) {
    const t = (hours - 7.3) / (17.25 - 7.3); // 11월 서울 일출 07:18, 일몰 17:15
    const el = Math.sin(clamp(t, -0.6, 1.6) * Math.PI) * 0.55 - (t < 0 || t > 1 ? 0.25 * Math.min(1, Math.abs(t < 0 ? t : t - 1) * 4) : 0);
    const az = lerp(-1.95, 1.95, clamp(t, -0.3, 1.3)); // 동남→남→서남
    const ce = Math.cos(el);
    const sunDir = new THREE.Vector3(Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce).normalize(); // +z = 남쪽
    const moonDir = new THREE.Vector3(-sunDir.x * 0.8, Math.abs(sunDir.y) * 0.7 + 0.3, -sunDir.z).normalize();
    this.uniforms.uSun.value.copy(sunDir); this.uniforms.uMoon.value.copy(moonDir);
    const day = smooth(-0.12, 0.18, sunDir.y); this.dayF = day;
    this.uniforms.uDay.value = day; this.uniforms.uTime.value += dt; this.uniforms.uCloud.value = this.cloud;
    const sunUp = sunDir.y > -0.02;
    const L = sunUp ? sunDir : moonDir;
    const warm = smooth(0.35, 0.02, sunDir.y);
    this.sun.color.setRGB(1, lerp(0.96, 0.62, warm), lerp(0.9, 0.38, warm));
    if (!sunUp) this.sun.color.setRGB(0.55, 0.65, 1);
    this.sun.intensity = sunUp ? lerp(0.0, 3.4, smooth(-0.02, 0.25, sunDir.y)) * (1 - this.cloud * 0.35) : 0.12;
    this.sun.position.set(focus.x + L.x * 150, focus.y + L.y * 150, focus.z + L.z * 150);
    this.sun.target.position.copy(focus);
    this.hemi.intensity = lerp(0.05, 0.75, day) * (1 - indoor * 0.35);
    this.hemi.color.setRGB(lerp(0.15, 0.75, day), lerp(0.18, 0.82, day), lerp(0.3, 0.95, day));
    this.hemi.groundColor.setRGB(lerp(0.03, 0.32, day), lerp(0.03, 0.28, day), lerp(0.04, 0.24, day));
    const fc = new THREE.Color().setRGB(lerp(0.025, 0.6, day) + warm * 0.12 * day, lerp(0.03, 0.65, day) + warm * 0.03 * day, lerp(0.05, 0.7, day));
    this.scene.fog.color.copy(fc);
    this.scene.fog.density = this.fogBase * (1 + (1 - day) * 0.8);
    this.dome.position.copy(focus);
    this.envTimer -= dt;
    if (this.envTimer <= 0 || Math.abs(day - (this.envDay ?? -1)) > 0.06) { this.envTimer = 8; this.envDay = day; this.updateEnv(); }
    this.sunDir = sunDir;
  }
  updateEnv() {
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
    this.scene.environment = this.envRT.texture;
  }
}
