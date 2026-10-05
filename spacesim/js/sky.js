// SpaceSim — 배경 하늘: 절차적 은하수 + 실제 분포를 흉내 낸 항성 2만 개
import * as THREE from 'three';
import { NOISE } from './glsl.js';
import { rng, gauss, blackbody, TAU } from './util.js';

// 은하 좌표계: 은하 북극/은하 중심 방향 (장면 좌표)
const GAL_N = new THREE.Vector3(-0.42, 0.78, 0.46).normalize();
const GAL_C = new THREE.Vector3(0.3, 0.0, -1).projectOnPlane(GAL_N).normalize();

const MW_VERT = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`;

const MW_FRAG = /* glsl */ `
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
  float n1 = fbm(d*3.2);
  float n2 = fbm(d*9.+vec3(4.));
  float width = .16 + .05*n1;
  float band = exp(-pow(b/width,2.));
  float core = exp(-(l*l)/.5 - (b*b)/.03);
  float bulge = exp(-(l*l)/.08 - (b*b)/.012);
  float stars = band*(.55+.45*n1)*(.75+.25*cos(l)) + core*1.2 + bulge*1.6;
  float dust = smoothstep(-.05,.45,fbm(d*7.+vec3(11.)) + .25*n2) * exp(-pow(b/(.045+.02*n1),2.));
  stars *= 1. - .85*dust;
  vec3 col = mix(vec3(.62,.72,1.), vec3(1.,.84,.62), clamp(core*1.4+bulge,0.,1.)) * stars;
  float neb = smoothstep(.25,.75,fbm(d*5.5+vec3(2.,7.,1.))) * band;
  col += vec3(.95,.32,.45)*neb*.35 + vec3(.25,.6,.75)*smoothstep(.3,.8,n2)*band*.18;
  col += vec3(.05,.06,.12)*(.5+.5*n1)*.25;
  gl_FragColor = vec4(col*uIntensity, 1.);
}`;

const STAR_VERT = /* glsl */ `
attribute float aSize; attribute vec3 aColor;
uniform float uPR, uBright;
varying vec3 vCol; varying float vSize;
void main(){
  vCol = aColor*uBright;
  vec4 mv = modelViewMatrix*vec4(position,1.);
  gl_Position = projectionMatrix*mv;
  vSize = aSize*uPR;
  gl_PointSize = max(vSize, 1.);
  if(vSize<1.) vCol *= vSize;
}`;

const STAR_FRAG = /* glsl */ `
varying vec3 vCol; varying float vSize;
void main(){
  vec2 c = gl_PointCoord*2.-1.;
  float d = dot(c,c);
  float core = exp(-d*7.);
  float spike = vSize>5. ? (max(0.,1.-abs(c.x)*14.)*max(0.,1.-abs(c.y)) + max(0.,1.-abs(c.y)*14.)*max(0.,1.-abs(c.x)))*.45 : 0.;
  float a = core + spike;
  if(a<.004) discard;
  gl_FragColor = vec4(vCol*a, 1.);
}`;

export class Sky {
  constructor({ count = 16000, pixelRatio = 1 } = {}) {
    this.group = new THREE.Group();
    this.group.renderOrder = -1000;

    this.mwMat = new THREE.ShaderMaterial({
      vertexShader: MW_VERT, fragmentShader: MW_FRAG,
      uniforms: { uN: { value: GAL_N }, uC: { value: GAL_C }, uIntensity: { value: 0.24 } },
      side: THREE.BackSide, depthWrite: false, depthTest: false,
    });
    this.milky = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), this.mwMat);
    this.milky.renderOrder = -1000;
    this.milky.frustumCulled = false;
    this.group.add(this.milky);

    const r = rng(7);
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count);
    const c = new THREE.Color(), v = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
    t1.crossVectors(GAL_N, GAL_C).normalize();
    for (let i = 0; i < count; i++) {
      if (r() < 0.45) {
        const l = r() * TAU, b = gauss(r) * 0.18;
        v.copy(GAL_C).multiplyScalar(Math.cos(l) * Math.cos(b)).addScaledVector(t1, Math.sin(l) * Math.cos(b)).addScaledVector(GAL_N, Math.sin(b));
      } else {
        v.set(gauss(r), gauss(r), gauss(r));
      }
      v.normalize().multiplyScalar(0.98);
      pos.set([v.x, v.y, v.z], i * 3);
      const T = r() < 0.12 ? 9000 + r() * 22000 : 3000 + Math.pow(r(), 1.4) * 5500;
      blackbody(T, c);
      const mag = Math.pow(r(), 9);
      const lum = 0.22 + mag * 1.7;
      col.set([c.r * lum, c.g * lum, c.b * lum], i * 3);
      size[i] = 1.0 + mag * 5.5 + r() * 0.5;
    }
    t2.set(0, 0, 0);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      uniforms: { uPR: { value: pixelRatio }, uBright: { value: 1 } },
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    });
    this.stars = new THREE.Points(geo, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -999;
    this.group.add(this.stars);
  }

  setPixelRatio(pr) { this.starMat.uniforms.uPR.value = pr; }
  setLook(milky = 0.24, stars = 1) { this.mwMat.uniforms.uIntensity.value = milky; this.starMat.uniforms.uBright.value = stars; }

  update(camera) {
    this.group.position.copy(camera.position);
    this.group.scale.setScalar(camera.far * 0.5);
  }

  // 블랙홀 광선추적용 큐브맵 생성
  renderCube(renderer, size = 1024) {
    const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const scene = new THREE.Scene();
    const parent = this.group.parent;
    scene.add(this.group);
    this.group.position.set(0, 0, 0);
    this.group.scale.setScalar(50);
    const cam = new THREE.CubeCamera(0.1, 1000, rt);
    const prevPR = this.starMat.uniforms.uPR.value;
    this.starMat.uniforms.uPR.value = size / 1500;
    cam.update(renderer, scene);
    this.starMat.uniforms.uPR.value = prevPR;
    if (parent) parent.add(this.group);
    return rt;
  }
}
