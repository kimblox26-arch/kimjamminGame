// SKY BLADE — 땅속 (지각 → 맨틀 → 외핵 → 내핵)
//  - 카메라가 지표 아래로 들어가면 카메라를 감싸는 구 껍질이 그 깊이의 암석/용암/액체 금속을 보여 줌 (바깥은 가림)
//  - 무늬는 절대 좌표 3D 노이즈라 움직이면 지나가는 바위가 보이고, 빠를수록 흐르는 줄무늬
//  - 깊이 (실제 지구 내부 구조): 지각 0~35 km, 상부 맨틀 ~660 km, 하부 맨틀 ~2,890 km, 외핵(액체) ~5,150 km, 내핵(고체) ~6,371 km
import * as THREE from 'three';

export const LAYERS = [
  [0, '지각'], [35000, '상부 맨틀'], [660000, '하부 맨틀'], [2890000, '외핵 (액체 철)'], [5150000, '내핵 (고체 철)'], [6360000, '지구 중심'],
];
export function layerName(depth) {
  let n = LAYERS[0][1];
  for (const [d, name] of LAYERS) if (depth >= d) n = name;
  return n;
}

const VS = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FS = /* glsl */`
uniform vec3 uCam;        // 카메라 절대 위치 (m, 정밀도 위해 1 km 로 나눈 나머지 + 큰 부분은 시드)
uniform float uDepth;     // 깊이 (m)
uniform float uTime;
uniform vec3 uVel;        // 속도 (m/s)
uniform float uR;
varying vec3 vDir;
float h31(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  vec3 wp = uCam + d * uR;                         // 이 픽셀이 보는 바위의 위치
  float sp = length(uVel);
  // 빠르면 진행 방향으로 늘어진 줄무늬 (움직임 흐림)
  vec3 vdir = sp > 1.0 ? uVel / sp : vec3(0.0, 1.0, 0.0);
  float along = dot(d, vdir);
  vec3 q = wp * 0.08 - vdir * along * min(sp * 0.002, 6.0);
  float n = fbm(q), n2 = fbm(q * 3.7 + 11.0);
  float D = uDepth;
  vec3 col;
  if (D < 35000.0) {
    // 지각: 흙 → 퇴적층 → 화강암/현무암, 깊을수록 따뜻해짐
    float strata = 0.5 + 0.5 * sin(wp.y * 0.35 + n * 6.0);
    vec3 soil = mix(vec3(0.16, 0.11, 0.07), vec3(0.3, 0.22, 0.14), strata);
    vec3 rock = mix(vec3(0.22, 0.21, 0.2), vec3(0.42, 0.38, 0.34), n2);
    col = mix(soil, rock, smoothstep(5.0, 400.0, D)) * (0.55 + 0.6 * n);
    col += vec3(1.0, 0.35, 0.08) * smoothstep(15000.0, 35000.0, D) * pow(n2, 3.0) * 1.5;
  } else if (D < 2890000.0) {
    // 맨틀: 아주 뜨거운 고체 암석이 느리게 흐름 → 깊을수록 붉게 달아오름
    float k = smoothstep(35000.0, 2890000.0, D);
    float veins = smoothstep(0.62, 0.75, fbm(q * 0.6 + uTime * 0.05));
    col = mix(vec3(0.25, 0.08, 0.04), vec3(0.9, 0.25, 0.05), k) * (0.4 + 0.8 * n);
    col += vec3(1.6, 0.6, 0.15) * veins * (0.6 + k);
  } else if (D < 5150000.0) {
    // 외핵: 액체 철이 소용돌이침 (밝은 주황 ~ 노랑)
    float sw = fbm(q * 0.4 + vec3(uTime * 0.2, uTime * 0.13, 0.0));
    col = mix(vec3(0.9, 0.32, 0.05), vec3(1.4, 0.85, 0.25), sw) * (0.6 + 0.6 * n);
  } else {
    // 내핵: 하얗게 달아오른 고체 철 (결정 반짝임)
    float cr = pow(vn(q * 4.0), 12.0);
    col = mix(vec3(1.25, 0.95, 0.6), vec3(1.6, 1.35, 1.0), n) + vec3(1.6) * cr;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class Underground {
  constructor(scene) {
    this.R = 60;
    this.u = { uCam: { value: new THREE.Vector3() }, uDepth: { value: 0 }, uTime: { value: 0 }, uVel: { value: new THREE.Vector3() }, uR: { value: this.R } };
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(this.R, 48, 24), new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: this.u, side: THREE.BackSide, depthWrite: true, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = -500;
    this.mesh.layers.set(2);          // 근거리 패스에서만
    scene.add(this.mesh);
    this.time = 0;
    this.depth = 0;
  }

  /** depth = 카메라가 지표 아래로 들어간 깊이 (m), 0 이하면 숨김 */
  update(dt, camera, camAbs, depth, vel) {
    this.time += dt;
    this.depth = depth;
    const on = depth > 0.3;
    this.mesh.visible = on;
    if (!on) return;
    this.mesh.position.copy(camera.position);
    // 절대 좌표는 크므로 노이즈용으로 1 km 주기로 접음 (이음매는 노이즈가 연속이라 거의 안 보임)
    this.u.uCam.value.set(camAbs.x % 4096, camAbs.y % 4096, camAbs.z % 4096);
    this.u.uDepth.value = depth;
    this.u.uTime.value = this.time;
    this.u.uVel.value.copy(vel);
  }
}
