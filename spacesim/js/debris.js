// SpaceSim — 충돌 파편: 중력장 속을 날아가는 고온 암석 조각(인스턴싱) + 불꽃 입자
// 파편은 질량 없는 시험 입자로, 가장 무거운 천체들의 중력을 받으며 다시 떨어지거나 탈출합니다.
import * as THREE from 'three';
import { LIGHTS } from './bodies.js';
import { rng, gauss } from './util.js';

const ROCK_VERT = /* glsl */ `
attribute float aHeat; attribute float aFade;
varying vec3 vN; varying vec3 vW; varying float vHeat; varying float vFade;
void main(){
  mat4 m = modelMatrix*instanceMatrix;
  vec4 w = m*vec4(position,1.);
  vW = w.xyz; vN = normalize(mat3(m)*normal); vHeat = aHeat; vFade = aFade;
  gl_Position = projectionMatrix*viewMatrix*w;
}`;
const ROCK_FRAG = /* glsl */ `
uniform vec3 uStarPos[2]; uniform vec3 uStarCol[2]; uniform int uStarCount;
varying vec3 vN; varying vec3 vW; varying float vHeat; varying float vFade;
void main(){
  vec3 N = normalize(vN); vec3 base = vec3(.32,.29,.27);
  vec3 col = base*.02;
  for(int i=0;i<2;i++){ if(i>=uStarCount) break; vec3 L = normalize(uStarPos[i]-vW); col += uStarCol[i]*base*max(dot(N,L),0.); }
  float h = clamp(vHeat,0.,1.);
  vec3 glow = mix(vec3(1.,.18,.02), vec3(1.,.78,.4), h*h) * h*h*1.8;
  gl_FragColor = vec4((col*(1.-h*.8) + glow)*vFade, 1.);
}`;
const SPARK_VERT = /* glsl */ `
attribute float aHeat; uniform float uPR;
varying float vH;
void main(){ vH = aHeat; vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; gl_PointSize = (1. + aHeat*2.)*uPR; }`;
const SPARK_FRAG = /* glsl */ `
varying float vH;
void main(){ vec2 c=gl_PointCoord*2.-1.; float d=dot(c,c); if(d>1.||vH<.02) discard; vec3 col=mix(vec3(1.,.25,.03),vec3(1.,.9,.6),vH); gl_FragColor=vec4(col*exp(-d*3.5)*vH*vH*.9,1.); }`;

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position, v = new THREE.Vector3();
  const key = (x) => Math.round(x * 1000);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const h = Math.sin(key(v.x) * 12.9898 + key(v.y) * 78.233 + key(v.z) * 37.719) * 43758.5453;
    v.multiplyScalar(0.72 + (h - Math.floor(h)) * 0.5);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

export class Debris {
  constructor(scn, cap) {
    this.scn = scn;
    this.cap = cap;
    this.n = 0;
    this.pos = new Float64Array(cap * 3);
    this.vel = new Float64Array(cap * 3);
    this.age = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.spin = new Float32Array(cap * 4);
    this.cool = new Float32Array(cap);
    this.r = rng(99);
    this.geo = rockGeometry();
    this.heatAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    this.fadeAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aHeat', this.heatAttr);
    this.geo.setAttribute('aFade', this.fadeAttr);
    this.mat = new THREE.ShaderMaterial({ vertexShader: ROCK_VERT, fragmentShader: ROCK_FRAG, uniforms: { ...LIGHTS } });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scn.root.add(this.mesh);
    const sg = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(cap * 3);
    this.sparkHeat = new Float32Array(cap);
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    sg.setAttribute('aHeat', new THREE.BufferAttribute(this.sparkHeat, 1).setUsage(THREE.DynamicDrawUsage));
    this.sparkMat = new THREE.ShaderMaterial({ vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, uniforms: { uPR: { value: scn.app.pixelRatio } }, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.sparks = new THREE.Points(sg, this.sparkMat);
    this.sparks.frustumCulled = false;
    scn.root.add(this.sparks);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3(); this._e = new THREE.Euler();
  }

  get count() { return this.n; }

  // 충돌 지점에서 분출: n = 충돌 법선, vcm = 질량중심 속도, vej = 기준 분출 속도, size = 파편 기준 크기(시각 단위)
  burst({ pos, n, vcm, vej, size, count, spread = 0.9, hot = 1 }) {
    const R = this.r;
    const t1 = new THREE.Vector3(n[0], n[1], n[2]).normalize();
    const nn = t1.clone();
    const a = Math.abs(nn.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(nn, a).normalize(), w = new THREE.Vector3().crossVectors(nn, u);
    for (let k = 0; k < count; k++) {
      let i = this.n;
      if (i >= this.cap) { i = Math.floor(R() * this.cap); } else this.n++;
      // 법선 주위 원뿔 분출 + 접선 방향 퍼짐
      const th = R() * Math.PI * 2, rr = Math.pow(R(), 0.6) * spread;
      const dir = nn.clone().addScaledVector(u, Math.cos(th) * rr * 1.6).addScaledVector(w, Math.sin(th) * rr * 1.6).normalize();
      const sp = vej * (0.25 + Math.pow(R(), 1.6) * 1.5);
      const j = i * 3;
      this.pos[j] = pos[0] + dir.x * size * R(); this.pos[j + 1] = pos[1] + dir.y * size * R(); this.pos[j + 2] = pos[2] + dir.z * size * R();
      this.vel[j] = vcm[0] + dir.x * sp + gauss(R) * vej * 0.05;
      this.vel[j + 1] = vcm[1] + dir.y * sp + gauss(R) * vej * 0.05;
      this.vel[j + 2] = vcm[2] + dir.z * sp + gauss(R) * vej * 0.05;
      this.age[i] = 0;
      this.life[i] = 18 + R() * 30;
      this.size[i] = size * (0.03 + Math.pow(R(), 3) * 0.13);
      this.cool[i] = (4 + R() * 7) * hot;
      this.spin.set([R() * 6.3, R() * 6.3, R() * 6.3, (R() - 0.5) * 6], i * 4);
    }
  }

  _kill(i) {
    const last = --this.n;
    if (i === last) return;
    for (let c = 0; c < 3; c++) { this.pos[i * 3 + c] = this.pos[last * 3 + c]; this.vel[i * 3 + c] = this.vel[last * 3 + c]; }
    for (let c = 0; c < 4; c++) this.spin[i * 4 + c] = this.spin[last * 4 + c];
    this.age[i] = this.age[last]; this.life[i] = this.life[last]; this.size[i] = this.size[last]; this.cool[i] = this.cool[last];
  }

  // 중력 적분 (가장 무거운 천체 최대 8개)
  step(simDt, steps) {
    if (!this.n || simDt <= 0) return;
    const s = this.scn.sim, G = s.G;
    const src = [];
    for (let i = 0; i < s.n; i++) src.push(i);
    src.sort((a, b) => s.m[b] - s.m[a]);
    const K = Math.min(8, src.length);
    const sx = new Float64Array(K), sy = new Float64Array(K), sz = new Float64Array(K), sm = new Float64Array(K), sr = new Float64Array(K);
    for (let k = 0; k < K; k++) { const i = src[k]; sx[k] = s.x[i]; sy[k] = s.y[i]; sz[k] = s.z[i]; sm[k] = G * s.m[i]; sr[k] = s.r[i]; }
    const nSub = Math.max(1, Math.min(10, steps)), h = simDt / nSub;
    const P = this.pos, V = this.vel;
    for (let it = 0; it < nSub; it++) {
      for (let i = 0; i < this.n; i++) {
        const j = i * 3;
        let ax = 0, ay = 0, az = 0, hit = false;
        for (let k = 0; k < K; k++) {
          const dx = sx[k] - P[j], dy = sy[k] - P[j + 1], dz = sz[k] - P[j + 2];
          const r2 = dx * dx + dy * dy + dz * dz;
          if (r2 < sr[k] * sr[k] * 0.9 && this.age[i] > 0.4) { hit = true; break; }
          const e2 = r2 + sr[k] * sr[k] * 0.25, f = sm[k] / (e2 * Math.sqrt(e2));
          ax += dx * f; ay += dy * f; az += dz * f;
        }
        if (hit) { this._kill(i); i--; continue; }
        V[j] += ax * h; V[j + 1] += ay * h; V[j + 2] += az * h;
        P[j] += V[j] * h; P[j + 1] += V[j + 1] * h; P[j + 2] += V[j + 2] * h;
      }
    }
  }

  update(dt) {
    const sc = this.scn.distScale;
    const heat = this.heatAttr.array, fade = this.fadeAttr.array;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] > this.life[i]) { this._kill(i); i--; }
    }
    const m = this._m, q = this._q, sv = this._s, pv = this._p, e = this._e;
    for (let i = 0; i < this.n; i++) {
      const j = i * 3, a = this.age[i];
      const hv = Math.exp(-a / this.cool[i]);
      heat[i] = hv;
      fade[i] = Math.min(1, (this.life[i] - a) / 3);
      const sp = this.spin[i * 4 + 3] * a;
      e.set(this.spin[i * 4] + sp, this.spin[i * 4 + 1] + sp * 0.7, this.spin[i * 4 + 2]);
      q.setFromEuler(e);
      pv.set(this.pos[j] * sc, this.pos[j + 1] * sc, this.pos[j + 2] * sc);
      const z = this.size[i];
      sv.set(z, z * 0.8, z * 0.65);
      m.compose(pv, q, sv);
      this.mesh.setMatrixAt(i, m);
      this.sparkPos[j] = pv.x; this.sparkPos[j + 1] = pv.y; this.sparkPos[j + 2] = pv.z;
      this.sparkHeat[i] = hv;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.heatAttr.needsUpdate = this.fadeAttr.needsUpdate = true;
    const g = this.sparks.geometry;
    g.setDrawRange(0, this.n);
    g.attributes.position.needsUpdate = g.attributes.aHeat.needsUpdate = true;
  }

  clear() { this.n = 0; this.mesh.count = 0; this.sparks.geometry.setDrawRange(0, 0); }

  dispose() {
    this.scn.root.remove(this.mesh, this.sparks);
    this.geo.dispose(); this.mat.dispose(); this.sparks.geometry.dispose(); this.sparkMat.dispose();
  }
}
