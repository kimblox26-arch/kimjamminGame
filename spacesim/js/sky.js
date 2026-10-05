// SpaceSim — 배경 하늘: 실제 은하수 파노라마(은하 좌표 → 황도 좌표 정렬) + 실제 밝은 별 위치
// 텍스처를 쓸 수 없으면 절차적 은하수 + 무작위 항성으로 대체
import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { rng, gauss, blackbody, TAU, radecToScene } from './util.js';
import { getTex, texPromise } from './textures.js';

// 은하 좌표계 축 (J2000): 은하 중심 방향 · 은하 북극
const GAL_X = radecToScene(266.40499, -28.93617);
const GAL_Z = radecToScene(192.85948, 27.12825);
const GAL_Y = new THREE.Vector3().crossVectors(GAL_Z, GAL_X).normalize();

// 밝은 별 [적경(시), 적위(°), 등급, 표면온도(K)]
const STARS = [
  [6.752, -16.72, -1.46, 9940], [6.399, -52.7, -0.74, 7350], [14.661, -60.83, -0.27, 5790], [14.261, 19.18, -0.05, 4290], [18.616, 38.78, 0.03, 9600],
  [5.278, 46.0, 0.08, 4970], [5.242, -8.2, 0.13, 12100], [7.655, 5.22, 0.34, 6530], [5.919, 7.41, 0.5, 3600], [1.629, -57.24, 0.46, 15000],
  [14.064, -60.37, 0.61, 25000], [19.846, 8.87, 0.76, 7700], [12.443, -63.1, 0.76, 24000], [4.599, 16.51, 0.86, 3900], [16.49, -26.43, 0.96, 3400],
  [13.42, -11.16, 0.97, 22400], [7.755, 28.03, 1.14, 4670], [22.961, -29.62, 1.16, 8590], [20.69, 45.28, 1.25, 8500], [12.795, -59.69, 1.25, 27000],
  [10.139, 11.97, 1.35, 12460], [6.977, -28.97, 1.5, 22200], [7.577, 31.89, 1.58, 10300], [17.56, -37.1, 1.62, 25000], [12.519, -57.11, 1.63, 3600],
  [5.419, 6.35, 1.64, 22000], [5.438, 28.61, 1.65, 13600], [9.22, -69.72, 1.67, 8900], [5.604, -1.2, 1.69, 27500], [22.137, -46.96, 1.73, 13900],
  [5.679, -1.94, 1.77, 29000], [12.9, 55.96, 1.77, 9000], [11.062, 61.75, 1.79, 4660], [3.405, 49.86, 1.79, 6350], [7.14, -26.39, 1.83, 6000],
  [17.622, -43.0, 1.86, 7200], [18.403, -34.38, 1.85, 9960], [8.375, -59.51, 1.86, 4000], [13.792, 49.31, 1.86, 15500], [5.992, 44.95, 1.9, 9350],
  [16.811, -69.03, 1.91, 4150], [6.629, 16.4, 1.92, 9260], [20.427, -56.74, 1.94, 17000], [2.53, 89.26, 1.98, 6000], [6.378, -17.96, 1.98, 25000],
  [9.46, -8.66, 1.98, 4120], [2.12, 23.46, 2.0, 4480], [0.726, -17.99, 2.04, 4800], [18.921, -26.3, 2.05, 18900], [14.111, -36.37, 2.06, 4980],
  [0.14, 29.09, 2.06, 13800], [1.162, 35.62, 2.06, 3840], [5.796, -9.67, 2.07, 26000], [14.845, 74.16, 2.08, 4030], [17.582, 12.56, 2.08, 8000],
  [3.136, 40.96, 2.1, 13000], [2.065, 42.33, 2.1, 4250], [11.818, 14.57, 2.13, 8500], [5.533, -0.3, 2.23, 29500], [0.675, 56.54, 2.24, 4660],
  [0.153, 59.15, 2.27, 7000], [11.031, 56.38, 2.37, 9600], [11.897, 53.69, 2.44, 9350], [12.257, 57.03, 3.31, 9480], [13.399, 54.93, 2.23, 9000],
  [0.945, 60.72, 2.47, 25000], [1.43, 60.24, 2.68, 8400], [1.907, 63.67, 3.37, 15000], [21.736, 9.88, 2.39, 4400], [23.063, 28.08, 2.42, 3700],
  [23.079, 15.21, 2.49, 9800], [0.22, 15.18, 2.83, 22000], [20.37, 40.26, 2.23, 6100], [19.512, 27.96, 3.05, 4400], [20.77, 33.97, 2.48, 4700],
  [16.006, -22.62, 2.29, 28000], [16.836, -34.29, 2.29, 4600], [10.333, 19.84, 2.08, 4470], [8.159, -47.34, 1.83, 3990], [12.692, -1.45, 2.74, 7100],
  [15.578, 26.71, 2.22, 9700], [2.971, 4.09, 2.53, 3910], [3.791, 24.11, 2.87, 13000], [4.83, 6.96, 3.19, 6000], [21.31, 62.59, 2.45, 7700],
];

const VERT = /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`;

const MW_PROC = /* glsl */ `
#ifndef OCT
#define OCT 5
#endif
${NOISE}
uniform vec3 uN, uC; uniform float uIntensity;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float b = asin(clamp(dot(d,uN),-1.,1.));
  vec3 e = normalize(d - uN*dot(d,uN));
  float l = atan(dot(cross(uC,e),uN), dot(uC,e));
  float n1 = fbm(d*3.2), n2 = fbm(d*9.+vec3(4.));
  float band = exp(-pow(b/(.16+.05*n1),2.));
  float core = exp(-(l*l)/.5 - (b*b)/.03), bulge = exp(-(l*l)/.08 - (b*b)/.012);
  float stars = band*(.55+.45*n1)*(.75+.25*cos(l)) + core*1.2 + bulge*1.6;
  float dust = smoothstep(-.05,.45,fbm(d*7.+vec3(11.)) + .25*n2) * exp(-pow(b/(.045+.02*n1),2.));
  stars *= 1. - .85*dust;
  vec3 col = mix(vec3(.62,.72,1.), vec3(1.,.84,.62), clamp(core*1.4+bulge,0.,1.)) * stars;
  col += vec3(.95,.32,.45)*smoothstep(.25,.75,fbm(d*5.5+vec3(2.,7.,1.)))*band*.35;
  gl_FragColor = vec4(col*uIntensity, 1.);
}`;

const MW_TEX = /* glsl */ `
uniform sampler2D uMap; uniform vec3 uGX, uGY, uGZ; uniform float uIntensity;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  vec3 g = vec3(dot(d,uGX), dot(d,uGY), dot(d,uGZ));
  float l = atan(g.y, g.x), b = asin(clamp(g.z,-1.,1.));
  float v = .5 - b/3.14159265;
  float ua = .5 - l/6.2831853;
  float u1 = fract(ua), u2 = fract(ua+.5)-.5;
  vec2 dx1 = dFdx(vec2(u1,v)), dy1 = dFdy(vec2(u1,v)), dx2 = dFdx(vec2(u2,v)), dy2 = dFdy(vec2(u2,v));
  vec2 dx = dot(dx1,dx1) < dot(dx2,dx2) ? dx1 : dx2, dy = dot(dy1,dy1) < dot(dy2,dy2) ? dy1 : dy2;
  vec3 c = textureGrad(uMap, vec2(u1,v), dx, dy).rgb;
  c = pow(c, vec3(1.15))*uIntensity*3.2;
  gl_FragColor = vec4(c, 1.);
}`;

const STAR_VERT = /* glsl */ `
attribute float aSize; attribute vec3 aColor;
uniform float uPR, uBright;
varying vec3 vCol; varying float vSize;
void main(){
  vCol = aColor*uBright;
  gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.);
  vSize = aSize*uPR;
  gl_PointSize = max(vSize, 1.);
  if(vSize<1.) vCol *= vSize;
}`;
const STAR_FRAG = /* glsl */ `
varying vec3 vCol; varying float vSize;
void main(){
  vec2 c = gl_PointCoord*2.-1.;
  float d = dot(c,c);
  float spike = vSize>6. ? (max(0.,1.-abs(c.x)*14.)*max(0.,1.-abs(c.y)) + max(0.,1.-abs(c.y)*14.)*max(0.,1.-abs(c.x)))*.4 : 0.;
  float a = exp(-d*7.) + spike;
  if(a<.004) discard;
  gl_FragColor = vec4(vCol*a, 1.);
}`;

function pointCloud(list, pixelRatio) {
  const n = list.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  list.forEach(([v, c, s], i) => { pos.set([v.x, v.y, v.z], i * 3); col.set([c.r, c.g, c.b], i * 3); size[i] = s; });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: { uPR: { value: pixelRatio }, uBright: { value: 1 } },
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -999;
  return pts;
}

export class Sky {
  constructor({ count = 16000, pixelRatio = 1, texKey = null } = {}) {
    this.group = new THREE.Group();
    this.group.renderOrder = -1000;
    this.milkyI = 0.24; this.starB = 1;
    this.procMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: MW_PROC, uniforms: { uN: { value: GAL_Z }, uC: { value: GAL_X }, uIntensity: { value: this.milkyI } },
      side: THREE.BackSide, depthWrite: false, depthTest: false,
    });
    this.milky = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), this.procMat);
    this.milky.renderOrder = -1000;
    this.milky.frustumCulled = false;
    this.group.add(this.milky);

    // 실제 밝은 별
    const c = new THREE.Color();
    this.bright = pointCloud(STARS.map(([ra, dec, mag, T]) => {
      const v = radecToScene(ra * 15, dec).multiplyScalar(0.97);
      const lum = Math.pow(10, -0.4 * (mag - 1.2)) * 0.9;
      return [v, blackbody(T, new THREE.Color()).multiplyScalar(Math.min(lum, 4)), 2.2 + Math.max(0, 3 - mag) * 2.2];
    }), pixelRatio);
    this.group.add(this.bright);

    // 무작위 배경 항성 (텍스처 없을 때)
    const r = rng(7), list = [], v = new THREE.Vector3(), t1 = new THREE.Vector3().crossVectors(GAL_Z, GAL_X).normalize();
    for (let i = 0; i < count; i++) {
      if (r() < 0.45) {
        const l = r() * TAU, b = gauss(r) * 0.18;
        v.copy(GAL_X).multiplyScalar(Math.cos(l) * Math.cos(b)).addScaledVector(t1, Math.sin(l) * Math.cos(b)).addScaledVector(GAL_Z, Math.sin(b));
      } else v.set(gauss(r), gauss(r), gauss(r));
      const T = r() < 0.12 ? 9000 + r() * 22000 : 3000 + Math.pow(r(), 1.4) * 5500;
      const mag = Math.pow(r(), 9);
      list.push([v.clone().normalize().multiplyScalar(0.98), blackbody(T, c).clone().multiplyScalar(0.22 + mag * 1.2), 1.0 + mag * 4 + r() * 0.5]);
    }
    this.stars = pointCloud(list, pixelRatio);
    this.group.add(this.stars);

    if (texKey) {
      const tex = getTex(texKey);
      this.texMat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: MW_TEX,
        uniforms: { uMap: { value: tex }, uGX: { value: GAL_X }, uGY: { value: GAL_Y }, uGZ: { value: GAL_Z }, uIntensity: { value: 1 } },
        side: THREE.BackSide, depthWrite: false, depthTest: false,
      });
      this.ready = texPromise(texKey).then((ok) => {
        if (!ok) return false;
        this.milky.material = this.texMat;
        this.stars.visible = false;
        this.real = true;
        this.setLook(this.milkyI, this.starB);
        return true;
      });
    } else this.ready = Promise.resolve(false);
  }

  setPixelRatio(pr) { for (const p of [this.stars, this.bright]) p.material.uniforms.uPR.value = pr; }

  setLook(milky = 0.24, stars = 1) {
    this.milkyI = milky; this.starB = stars;
    this.procMat.uniforms.uIntensity.value = milky;
    if (this.texMat) this.texMat.uniforms.uIntensity.value = milky / 0.24;
    this.stars.material.uniforms.uBright.value = stars;
    this.bright.material.uniforms.uBright.value = stars;
  }

  update(camera) {
    this.group.position.copy(camera.position);
    this.group.scale.setScalar(camera.far * 0.5);
  }

  // 블랙홀 광선추적용 큐브맵
  renderCube(renderer, size = 1024) {
    const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const scene = new THREE.Scene(), parent = this.group.parent;
    scene.add(this.group);
    this.group.position.set(0, 0, 0);
    this.group.scale.setScalar(50);
    const cam = new THREE.CubeCamera(0.1, 1000, rt);
    const prs = [this.stars, this.bright].map((p) => p.material.uniforms.uPR.value);
    for (const p of [this.stars, this.bright]) p.material.uniforms.uPR.value = size / 1500;
    cam.update(renderer, scene);
    [this.stars, this.bright].forEach((p, i) => (p.material.uniforms.uPR.value = prs[i]));
    if (parent) parent.add(this.group);
    return rt;
  }

  dispose() {
    for (const o of [this.milky, this.stars, this.bright]) { o.geometry.dispose(); o.material.dispose(); }
    this.procMat.dispose(); this.texMat?.dispose();
  }
}
