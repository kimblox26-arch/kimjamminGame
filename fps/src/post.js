// 후처리/환경: 뷰모델 패스, 깊이 기반 SSAO, 색보정, 하늘, HDRI 환경광
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// 뷰모델 패스: 깊이만 지우고 총/팔을 월드 위에 그림
export class ViewmodelPass extends Pass {
  constructor(scene, camera) { super(); this.scene = scene; this.camera = camera; this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) {
    const ac = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }
}

// ── 깊이 버퍼 기반 SSAO (반해상도 + 양방향 블러 합성) ──
const KERNEL = 14;
function kernel() {
  const k = [];
  for (let i = 0; i < KERNEL; i++) {
    const v = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 0.85 + 0.15).normalize();
    let s = i / KERNEL; s = 0.12 + 0.88 * s * s;
    k.push(v.multiplyScalar(s * (0.6 + Math.random() * 0.4)));
  }
  return k;
}
const AO_FRAG = `
  uniform sampler2D tDepth; uniform mat4 uProj; uniform mat4 uProjInv; uniform vec3 uKernel[${KERNEL}];
  uniform float uRadius; uniform float uFrame; uniform vec2 uRes; varying vec2 vUv;
  vec3 viewPos(vec2 uv, float d){ vec4 c = vec4(uv*2.-1., d*2.-1., 1.); vec4 v = uProjInv*c; return v.xyz/v.w; }
  float ign(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  void main(){
    float d = texture2D(tDepth, vUv).x;
    if (d >= 0.99999) { gl_FragColor = vec4(1.); return; }
    vec3 P = viewPos(vUv, d);
    vec2 px = 1.0/uRes;
    vec3 Px = viewPos(vUv + vec2(px.x,0.), texture2D(tDepth, vUv + vec2(px.x,0.)).x);
    vec3 Py = viewPos(vUv + vec2(0.,px.y), texture2D(tDepth, vUv + vec2(0.,px.y)).x);
    vec3 N = normalize(cross(Px - P, Py - P));
    float a = ign(gl_FragCoord.xy + uFrame*5.588) * 6.2831;
    vec3 rv = vec3(cos(a), sin(a), 0.);
    vec3 T = normalize(rv - N*dot(rv, N)); vec3 B = cross(N, T); mat3 TBN = mat3(T, B, N);
    float r = uRadius * clamp(-P.z * 0.08 + 0.6, 0.6, 2.2);
    float occ = 0.;
    for (int i = 0; i < ${KERNEL}; i++) {
      vec3 Q = P + TBN * uKernel[i] * r;
      vec4 o = uProj * vec4(Q, 1.); vec2 suv = o.xy/o.w*0.5 + 0.5;
      if (suv.x < 0. || suv.y < 0. || suv.x > 1. || suv.y > 1.) continue;
      float sz = viewPos(suv, texture2D(tDepth, suv).x).z;
      float rc = smoothstep(0., 1., r / abs(P.z - sz));
      occ += (sz >= Q.z + 0.025 ? 1. : 0.) * rc;
    }
    float ao = 1. - occ / float(${KERNEL});
    gl_FragColor = vec4(vec3(ao), 1.);
  }`;
const COMP_FRAG = `
  uniform sampler2D tDiffuse; uniform sampler2D tAO; uniform sampler2D tDepth; uniform vec2 uAORes; uniform float uStrength; uniform mat4 uProjInv; varying vec2 vUv;
  float lin(vec2 uv){ vec4 c = vec4(uv*2.-1., texture2D(tDepth, uv).x*2.-1., 1.); vec4 v = uProjInv*c; return v.z/v.w; }
  void main(){
    vec4 col = texture2D(tDiffuse, vUv);
    float z0 = lin(vUv), s = 0., w = 0.;
    for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
      vec2 o = vec2(float(x), float(y)) / uAORes;
      float zw = exp(-abs(lin(vUv + o) - z0) * 4.0 / max(0.5, -z0*0.05));
      s += texture2D(tAO, vUv + o).r * zw; w += zw;
    }
    float ao = s / max(w, 1e-4);
    ao = mix(1., ao, uStrength);
    gl_FragColor = vec4(col.rgb * ao, col.a);
  }`;
const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

export class SSAOPass extends Pass {
  constructor(camera, w, h) {
    super();
    this.camera = camera;
    this.aoRT = new THREE.WebGLRenderTarget(Math.max(1, w >> 1), Math.max(1, h >> 1), { type: THREE.HalfFloatType });
    this.aoMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: AO_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uKernel: { value: kernel() }, uRadius: { value: 0.55 }, uFrame: { value: 0 }, uRes: { value: new THREE.Vector2(w, h) } } });
    this.compMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: COMP_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tDiffuse: { value: null }, tAO: { value: this.aoRT.texture }, tDepth: { value: null }, uAORes: { value: new THREE.Vector2(w >> 1, h >> 1) }, uStrength: { value: 0.85 }, uProjInv: { value: new THREE.Matrix4() } } });
    this.q1 = new FullScreenQuad(this.aoMat); this.q2 = new FullScreenQuad(this.compMat);
    this.frame = 0;
  }
  setSize(w, h) {
    this.aoRT.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.aoMat.uniforms.uRes.value.set(w, h);
    this.compMat.uniforms.uAORes.value.set(w >> 1, h >> 1);
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.aoMat.uniforms, c = this.compMat.uniforms;
    u.tDepth.value = readBuffer.depthTexture; c.tDepth.value = readBuffer.depthTexture;
    u.uProj.value.copy(this.camera.projectionMatrix); u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    c.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    u.uFrame.value = (this.frame++ % 64);
    renderer.setRenderTarget(this.aoRT); this.q1.render(renderer);
    c.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.q2.render(renderer);
  }
  dispose() { this.aoRT.dispose(); this.aoMat.dispose(); this.compMat.dispose(); }
}

// ── 색보정 / 렌즈 효과 ──
export const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.28 }, uDamage: { value: 0 }, uSup: { value: 0 }, uGrain: { value: 0.028 }, uCA: { value: 0.0022 }, uSat: { value: 1.12 }, uLow: { value: 0 }, uFlash: { value: 0 }, uScope: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVig, uDamage, uSup, uGrain, uCA, uSat, uLow, uFlash, uScope; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 uv = vUv, c = uv - 0.5; float r = length(c);
      float ca = uCA * (1.0 + uSup*3.0) * r;
      vec3 col = vec3(texture2D(tDiffuse, uv - c*ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv + c*ca).b);
      float bl = uSup*0.6 + uLow*0.35;
      if (bl > 0.01) {
        vec3 b = vec3(0.); float s = 0.0035 * smoothstep(0.1, 0.6, r);
        for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398; b += texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * s * (1.0 + mod(float(i), 2.0))).rgb; }
        col = mix(col, b*0.125, clamp(bl * smoothstep(0.12, 0.55, r), 0., 1.));
      }
      float l = dot(col, vec3(0.2126,0.7152,0.0722));
      col = mix(vec3(l), col, uSat - uSup*0.35 - uLow*0.55);
      col = mix(col, col*col*(3.0-2.0*col), 0.18);
      col *= vec3(1.015, 1.0, 0.975);
      col *= 1.0 - uVig*smoothstep(0.3, 0.95, r) - uSup*0.45*smoothstep(0.15, 0.75, r) - uScope*0.25*smoothstep(0.2,0.7,r);
      col = mix(col, vec3(0.42,0.0,0.0), clamp(uDamage*smoothstep(0.2, 0.8, r) + uLow*0.25*smoothstep(0.3,0.9,r), 0., 0.85));
      col += (h(uv*vec2(1920.,1080.) + fract(uTime)*97.) - 0.5) * uGrain;
      col += uFlash;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// ── 하늘 (대기 그라데이션 + 태양 + 이중 구름층) ──
export function skyMaterial(sunDir, disk = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir.clone() }, uTime: { value: 0 }, uDisk: { value: disk } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize((modelMatrix*vec4(position,0.)).xyz); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 uSun; uniform float uTime, uDisk; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0., a = .5; for(int i=0;i<6;i++){ s += noise(p)*a; p = p*2.03 + vec2(1.7, 9.2); a *= .5; } return s; }
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        float sh = max(uSun.y, 0.);
        vec3 zen = vec3(0.09,0.24,0.58), hor = vec3(0.66,0.74,0.82);
        vec3 col = mix(hor, zen, pow(clamp(h,0.,1.), 0.42));
        float sd = max(dot(d, uSun), 0.);
        col += vec3(1.0,0.58,0.3) * pow(sd, 5.) * 0.5 * (1. - clamp(h*1.5,0.,1.));
        col += vec3(1.0,0.86,0.66) * pow(sd, 90.) * 2.2;
        col += vec3(46.,39.,30.) * smoothstep(0.99955, 0.99975, sd) * uDisk;
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.1) * 1.2 + vec2(uTime*0.006, uTime*0.002);
          float base = fbm(uv * 1.1);
          float c = smoothstep(0.5, 0.82, base);
          float c2 = smoothstep(0.58, 0.9, fbm(uv*2.7 + 7.)) * 0.5;
          float thick = smoothstep(0.55, 1.0, base);
          vec3 lit = vec3(1.08,1.03,0.98) + vec3(1.0,0.72,0.45)*pow(sd,4.)*0.9;
          vec3 cc = mix(lit, vec3(0.52,0.55,0.62), thick*0.7);
          float cov = clamp(c*0.9 + c2, 0., 1.) * smoothstep(0.0, 0.2, h);
          col = mix(col, cc, cov);
          // 권운
          float ci = smoothstep(0.55, 0.9, fbm(vec2(uv.x*0.3, uv.y*3.0) + 3.)) * 0.25 * smoothstep(0.1, 0.4, h);
          col = mix(col, vec3(1.), ci);
        }
        vec3 ground = vec3(0.21,0.2,0.18);
        col = mix(col, mix(hor*0.85, ground, smoothstep(0.0, 0.25, -h)), step(h, 0.0));
        gl_FragColor = vec4(col, 1.);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
}

// ── HDRI → 환경광 (태양 방향 정렬 + 지면색 치환) ──
export function buildEnvironment(renderer, hdrTex, sunDir, hdriSunAz) {
  const s = new THREE.Scene();
  const rot = Math.atan2(sunDir.z, sunDir.x) - hdriSunAz;
  const mat = new THREE.ShaderMaterial({
    uniforms: { tEnv: { value: hdrTex }, uRot: { value: rot } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform sampler2D tEnv; uniform float uRot; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float a = atan(d.z, d.x) - uRot;
        vec2 uv = vec2(fract(a / 6.2831853 + 0.5), asin(clamp(d.y, -1., 1.)) / 3.1415926 + 0.5);
        vec3 c = texture2D(tEnv, uv).rgb;
        float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(lum), c, 0.72);
        vec3 ground = vec3(0.26, 0.245, 0.225) * 0.9;
        float g = smoothstep(0.02, -0.12, d.y);
        c = mix(c, ground * (0.8 + 0.4 * dot(c, vec3(0.33))), g);
        gl_FragColor = vec4(c, 1.);
      }`,
    side: THREE.BackSide, depthWrite: false,
  });
  s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), mat));
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(s, 0.0).texture;
  pm.dispose(); mat.dispose();
  return env;
}
