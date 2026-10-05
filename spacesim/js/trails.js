// SpaceSim — 궤적(페이드 라인), 위치 마커, 궤도 타원, 충돌 섬광, 발광 입자
import * as THREE from 'three';

const TRAIL_VERT = /* glsl */ `
attribute float aT; uniform float uStart, uCount;
varying float vA;
void main(){ vA = clamp((aT-uStart)/max(uCount,1.),0.,1.); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity; varying float vA;
void main(){ float a = vA*vA*uOpacity; gl_FragColor = vec4(uColor*a, 1.); }`;

export class Trail {
  constructor(max, color, opacity = 0.9) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    const t = new Float32Array(max);
    for (let i = 0; i < max; i++) t[i] = i;
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    geo.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uStart: { value: 0 }, uCount: { value: 0 } },
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    this.line = new THREE.Line(geo, this.mat);
    this.line.frustumCulled = false;
    this.dirty = false;
  }
  push(x, y, z) {
    const p = this.pos, m = this.max;
    if (this.count < m) this.count++;
    p.copyWithin(0, 3, m * 3);
    p[m * 3 - 3] = x; p[m * 3 - 2] = y; p[m * 3 - 1] = z;
    this.dirty = true;
  }
  reset() { this.count = 0; this.line.geometry.setDrawRange(0, 0); }
  commit() {
    if (!this.dirty) return;
    const start = this.max - this.count;
    this.line.geometry.setDrawRange(start, this.count);
    this.mat.uniforms.uStart.value = start;
    this.mat.uniforms.uCount.value = this.count;
    this.attr.needsUpdate = true;
    this.dirty = false;
  }
  dispose() { this.line.geometry.dispose(); this.mat.dispose(); }
}

// 화면 고정 크기 위치 마커 (멀리 있는 천체도 보이도록)
const MK_VERT = /* glsl */ `
attribute vec3 aColor; attribute float aAlpha; uniform float uSize;
varying vec3 vC; varying float vA;
void main(){ vC=aColor; vA=aAlpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_PointSize=uSize; }`;
const MK_FRAG = /* glsl */ `
varying vec3 vC; varying float vA;
void main(){ vec2 c=gl_PointCoord*2.-1.; float r=length(c); float a=(smoothstep(1.,.75,r)*smoothstep(.45,.62,r)*.9 + exp(-r*r*14.)*1.2)*vA; if(a<.01) discard; gl_FragColor=vec4(vC*a,1.); }`;

export class Markers {
  constructor(cap = 256, pixelRatio = 1) {
    this.cap = cap;
    const geo = new THREE.BufferGeometry();
    this.p = new Float32Array(cap * 3); this.c = new Float32Array(cap * 3); this.a = new Float32Array(cap);
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({ vertexShader: MK_VERT, fragmentShader: MK_FRAG, uniforms: { uSize: { value: 11 * pixelRatio } }, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }
  update(bodies, visible) {
    let n = 0;
    for (const b of bodies) {
      if (n >= this.cap) break;
      if (b.noMarker) continue;
      this.p[n * 3] = b.vis.x; this.p[n * 3 + 1] = b.vis.y; this.p[n * 3 + 2] = b.vis.z;
      this.c[n * 3] = b.color.r; this.c[n * 3 + 1] = b.color.g; this.c[n * 3 + 2] = b.color.b;
      this.a[n] = visible ? Math.max(0, Math.min(1, (6 - b.px) / 4)) * (b.markerA ?? 1) : 0;
      n++;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = g.attributes.aColor.needsUpdate = g.attributes.aAlpha.needsUpdate = true;
  }
  setPixelRatio(pr) { this.mat.uniforms.uSize.value = 11 * pr; }
  dispose() { this.points.geometry.dispose(); this.mat.dispose(); }
}

export class OrbitLine {
  constructor(color, n = 256) {
    this.n = n;
    this.buf = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.buf, 3).setUsage(THREE.DynamicDrawUsage));
    this.line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.line.frustumCulled = false;
  }
  commit() { this.line.geometry.attributes.position.needsUpdate = true; }
  dispose() { this.line.geometry.dispose(); this.line.material.dispose(); }
}

// 충돌/병합 섬광
const FLASH_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uK; varying vec2 vUv;
void main(){ vec2 c=vUv*2.-1.; float r=length(c); float ring=exp(-pow((r-uK*.8)*10.,2.))*(1.-uK); float core=exp(-r*r*18.)*(1.-uK)*2.;
 float spikes=0.;
 gl_FragColor=vec4(uColor*(ring*2.+core+spikes),1.); }`;
const FLASH_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;

export class Flashes {
  constructor(parent) {
    this.parent = parent;
    this.list = [];
    this.geo = new THREE.PlaneGeometry(2, 2);
  }
  spawn(pos, size, color = 0xffc58a, life = 1.6) {
    if (this.list.length >= 16) return;
    const mat = new THREE.ShaderMaterial({ vertexShader: FLASH_VERT, fragmentShader: FLASH_FRAG, uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(1.4) }, uK: { value: 0 } }, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const m = new THREE.Mesh(this.geo, mat);
    m.position.copy(pos);
    m.scale.setScalar(size);
    m.frustumCulled = false;
    this.parent.add(m);
    this.list.push({ m, t: 0, life, size });
  }
  update(dt, camera) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.t += dt;
      const k = f.t / f.life;
      f.m.material.uniforms.uK.value = Math.min(k, 1);
      f.m.scale.setScalar(f.size * (1 + k * 2.5));
      f.m.quaternion.copy(camera.quaternion);
      if (k >= 1) { this.parent.remove(f.m); f.m.material.dispose(); this.list.splice(i, 1); }
    }
  }
  dispose() { this.list.forEach((f) => { this.parent.remove(f.m); f.m.material.dispose(); }); this.list = []; this.geo.dispose(); }
}

// 대량 발광 입자 (은하/성단)
const GP_VERT = /* glsl */ `
attribute vec3 aColor; attribute float aSize;
uniform float uScale, uBright, uMaxSize;
varying vec3 vC;
void main(){
  vec4 mv = modelViewMatrix*vec4(position,1.);
  gl_Position = projectionMatrix*mv;
  float s = aSize*uScale/max(-mv.z,1e-4);
  float sz = clamp(s, 1.6, uMaxSize);
  vC = aColor*uBright*min(1., s*s/(sz*sz)+.05) ;
  gl_PointSize = sz;
}`;
const GP_FRAG = /* glsl */ `
varying vec3 vC;
void main(){ vec2 c=gl_PointCoord*2.-1.; float d=dot(c,c); if(d>1.) discard; float a=exp(-d*4.5)-.011; gl_FragColor=vec4(vC*a,1.); }`;

export class GlowPoints {
  constructor(count, { maxSize = 64 } = {}) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    this.colAttr = new THREE.BufferAttribute(this.col, 3);
    geo.setAttribute('aColor', this.colAttr);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1);
    geo.setAttribute('aSize', this.sizeAttr);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: GP_VERT, fragmentShader: GP_FRAG,
      uniforms: { uScale: { value: 500 }, uBright: { value: 1 }, uMaxSize: { value: maxSize } },
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
  }
  setScale(camera, height) { this.mat.uniforms.uScale.value = height / (2 * Math.tan((camera.fov * Math.PI) / 360)); }
  dispose() { this.points.geometry.dispose(); this.mat.dispose(); }
}
