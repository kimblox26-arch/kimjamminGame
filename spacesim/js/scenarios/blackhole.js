// SpaceSim — 블랙홀: 슈바르츠실트 시공간 널 측지선 광선추적
// x'' = −(3/2)·h²·x / r⁵ (r_s = 1) 로 빛의 경로를 적분 → 중력 렌즈, 광자 고리, 그림자,
// 얇은 강착원반(Shakura–Sunyaev 온도 분포) + 상대론적 도플러 빔 + 중력 적색편이
import * as THREE from 'three';
import { NOISE, BLACKBODY } from '../glsl.js';
import { fmtNum } from '../util.js';

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

const FRAG = /* glsl */ `
#ifndef OCT
#define OCT 4
#endif
${NOISE}
${BLACKBODY}
uniform samplerCube uSky;
uniform vec3 uCamPos; uniform mat4 uCamWorld; uniform mat4 uProjInv;
uniform float uTime, uIn, uOut, uDoppler, uLens, uTemp, uGain, uSky2, uThick;
varying vec2 vUv;

vec3 diskShade(vec3 p, vec3 dir, out float alpha){
  float r = length(p.xz);
  float x = (r-uIn)/(uOut-uIn);
  float tprof = pow(uIn/r,.75)*pow(max(1.-sqrt(uIn/r),1e-4),.25)*2.05;
  float beta = min(sqrt(.5/max(r-1.,.05)), .98);
  vec3 vdir = normalize(vec3(-p.z,0.,p.x));
  float gam = 1./sqrt(1.-beta*beta);
  float dop = 1./(gam*(1.-beta*dot(vdir,-dir)));
  float grav = sqrt(max(1.-1./r,.02));
  float g = mix(1., dop*grav, uDoppler);
  // 케플러 차등 회전 텍스처 (흐름 맵 2층 교차)
  float om = sqrt(.5/(r*r*r));
  float ang = atan(p.z,p.x);
  float ph1 = fract(uTime*.05), ph2 = fract(uTime*.05+.5);
  float w1 = 1.-abs(ph1*2.-1.);
  float a1 = ang - om*ph1*60., a2 = ang - om*ph2*60.;
  float n1 = fbm(vec3(cos(a1)*r, sin(a1)*r, r*.35)*1.15);
  float n2 = fbm(vec3(cos(a2)*r, sin(a2)*r, r*.35+3.)*1.15);
  float n = mix(n2, n1, w1);
  float streak = .5+.5*sin(r*6.+n*3.);
  float dens = smoothstep(0.,.06,x)*(1.-smoothstep(.55,1.,x));
  dens *= clamp(.5 + .9*n + .25*streak, 0., 1.4);
  float T = uTemp*tprof*g;
  vec3 c = blackbody(T) * pow(tprof,2.) * pow(g,3.) * uGain;
  alpha = clamp(dens*uThick, 0., .97);
  return c*(.6+.6*n);
}

void main(){
  vec2 ndc = vUv*2.-1.;
  vec4 vp = uProjInv*vec4(ndc,1.,1.);
  vec3 dir = normalize((uCamWorld*vec4(normalize(vp.xyz/vp.w),0.)).xyz);
  vec3 pos = uCamPos, vel = dir;
  vec3 hv = cross(pos,vel); float h2 = dot(hv,hv);
  vec3 col = vec3(0.); float trans = 1.; bool hole = false;
  float glow = 0.;
  for(int i=0;i<STEPS;i++){
    float r2 = dot(pos,pos), r = sqrt(r2);
    float dt = clamp(.075*r-.04, .012, 1.6);
    vec3 acc = -1.5*h2*pos/(r2*r2*r)*uLens;
    vec3 np = pos + vel*dt + .5*acc*dt*dt;
    float nr2 = dot(np,np), nr = sqrt(nr2);
    vec3 nacc = -1.5*h2*np/(nr2*nr2*nr)*uLens;
    vel += .5*(acc+nacc)*dt;
    if(pos.y*np.y < 0.){
      float t = pos.y/(pos.y-np.y);
      vec3 hp = mix(pos,np,t);
      float rr = length(hp.xz);
      if(rr>uIn*.98 && rr<uOut){ float a; vec3 dc = diskShade(hp, normalize(vel), a); col += trans*dc*a; trans *= 1.-a; }
    }
    glow += exp(-pow((r-1.5)*6.,2.))*dt*.012;
    pos = np;
    if(nr < 1.){ hole = true; break; }
    if(nr > 80. && dot(pos,vel) > 0.) break;
    if(trans < .01) break;
  }
  if(!hole && trans>.01) col += trans*textureCube(uSky, normalize(vel)).rgb*uSky2;
  col += vec3(1.,.75,.5)*glow*uGain*.4*uLens;
  gl_FragColor = vec4(col, 1.);
}`;

const BLIT_FRAG = /* glsl */ `uniform sampler2D tMap; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tMap, vUv); }`;

export class BlackHoleScenario {
  constructor(app) {
    this.app = app;
    this.root = new THREE.Group();
    app.scene.add(this.root);
    this.time = 0;
    this.massSun = 4.3e6;
    this.sky = app.sky.renderCube(app.renderer, app.quality.bhCube);
    const q = app.quality;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      defines: { STEPS: q.bhSteps, OCT: q.oct <= 4 ? 3 : 4 },
      uniforms: {
        uSky: { value: this.sky.texture }, uCamPos: { value: new THREE.Vector3() }, uCamWorld: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() },
        uTime: { value: 0 }, uIn: { value: 3 }, uOut: { value: 13 }, uDoppler: { value: 1 }, uLens: { value: 1 }, uTemp: { value: 6500 }, uGain: { value: 1.25 }, uSky2: { value: 1.1 }, uThick: { value: 1.25 },
      },
      depthTest: false, depthWrite: false,
    });
    this.rtScene = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.rtScene.add(this.quad);
    this.rtCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false });
    this.blit = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: BLIT_FRAG, uniforms: { tMap: { value: this.rt.texture } }, depthTest: false, depthWrite: false }));
    this.blit.frustumCulled = false;
    this.blit.renderOrder = -2000;
    this.root.add(this.blit);
    app.sky.group.visible = false;
  }

  beforeRender(renderer) {
    const cam = this.app.camera, u = this.mat.uniforms;
    u.uCamPos.value.copy(cam.position);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const s = this.app.quality.bhScale;
    const w = Math.max(2, Math.round(size.x * s)), h = Math.max(2, Math.round(size.y * s));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.rtScene, this.rtCam);
    renderer.setRenderTarget(prev);
  }

  simulate(dt, warp) { this.time += dt * warp; }
  update() { this.mat.uniforms.uTime.value = this.time; }

  get warp() { return { min: 0.05, max: 6, def: 1, fmt: (w) => `${w.toFixed(2)}×` }; }

  start() {
    const c = this.app.controls;
    c.minR = 2.2; c.maxR = 70; c.minNear = 0.01; c.minFar = 0;
    c.follow = null; c.target.set(0, 0, 0);
    c.set({ theta: 0.2, phi: 1.2, radius: 60, jump: true });
    c.set({ theta: 0.0, phi: 1.47, radius: 24 });
  }

  view(phi, radius, theta) { this.app.controls.set({ phi, radius, theta: theta ?? this.app.controls.goalTheta }); }

  pick() { return false; }
  select() {}

  clock() {
    const r = this.app.controls.radius;
    return { main: `관측자 r = ${r.toFixed(2)} rₛ`, sub: `시간 지연 ×${Math.sqrt(Math.max(1 - 1 / r, 0)).toFixed(3)}` };
  }

  panel() {
    const u = this.mat.uniforms;
    return [
      { type: 'chips', label: '시점', items: [
        { label: '인터스텔라', on: () => this.view(1.5, 24, 0) },
        { label: '비스듬히', on: () => this.view(1.25, 20) },
        { label: '극 방향', on: () => this.view(0.12, 26) },
        { label: '근접 비행', act: true, on: () => { this.view(1.43, 5.2); this.app.toast('광자구(1.5 rₛ) 근처: 하늘 전체가 왜곡됩니다'); } },
      ] },
      { type: 'slider', label: '원반 바깥 반지름', min: 5, max: 24, step: 0.1, value: u.uOut.value, fmt: (v) => `${v.toFixed(1)} rₛ`, on: (v) => (u.uOut.value = v) },
      { type: 'slider', label: '원반 온도 (최고)', min: 2500, max: 20000, step: 50, value: u.uTemp.value, fmt: (v) => `${Math.round(v)} K`, on: (v) => (u.uTemp.value = v) },
      { type: 'slider', label: '원반 밝기', min: 0.2, max: 8, step: 0.01, value: u.uGain.value, fmt: (v) => v.toFixed(2), on: (v) => (u.uGain.value = v) },
      { type: 'slider', label: '블랙홀 질량', min: 0, max: 10, step: 0.01, value: Math.log10(this.massSun), fmt: (v) => `${fmtNum(10 ** v, 2)} M☉`, on: (v) => (this.massSun = 10 ** v) },
      { type: 'toggle', label: '중력 렌즈 (측지선 휘어짐)', value: true, on: (v) => (u.uLens.value = v ? 1 : 0) },
      { type: 'toggle', label: '도플러 빔 · 중력 적색편이', value: true, on: (v) => (u.uDoppler.value = v ? 1 : 0) },
      { type: 'readouts', items: ['슈바르츠실트 반지름', '광자구 / ISCO', 'ISCO 공전 주기', '광선 적분 스텝', '렌더 해상도'] },
      { type: 'hint', text: '각 픽셀마다 빛의 경로를 블랙홀 시공간에서 거꾸로 추적합니다. 원반의 다가오는 쪽은 도플러 효과로 더 밝고 푸르게, 멀어지는 쪽은 어둡고 붉게 보입니다. 원반 뒷면이 렌즈 효과로 위아래에 휘어 보입니다.' },
    ];
  }

  readouts() {
    const M = this.massSun, rs = 2.953 * M, tIsco = 4.54e-4 * M;
    const fmtLen = (km) => (km > 1.496e8 * 0.5 ? `${fmtNum(km / 1.496e8, 3)} AU` : `${fmtNum(km, 3)} km`);
    const fmtT = (s) => (s < 120 ? `${fmtNum(s, 3)} 초` : s < 7200 ? `${fmtNum(s / 60, 3)} 분` : s < 172800 ? `${fmtNum(s / 3600, 3)} 시간` : `${fmtNum(s / 86400, 3)} 일`);
    const s = this.app.quality.bhScale;
    return {
      '슈바르츠실트 반지름': fmtLen(rs),
      '광자구 / ISCO': `${fmtLen(rs * 1.5)} / ${fmtLen(rs * 3)}`,
      'ISCO 공전 주기': fmtT(tIsco),
      '광선 적분 스텝': `최대 ${this.app.quality.bhSteps}`,
      '렌더 해상도': `${Math.round(s * 100)}% · ${this.rt.width}×${this.rt.height}`,
    };
  }

  stats() { return { bodies: 0, steps: 0 }; }

  dispose() {
    this.app.scene.remove(this.root);
    this.rt.dispose(); this.sky.dispose(); this.mat.dispose(); this.blit.material.dispose();
    this.app.sky.group.visible = true;
  }
}
