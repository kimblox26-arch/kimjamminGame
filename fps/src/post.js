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

// ── 대기 안개 (모든 재질 공통 청크 교체): 높이에 따라 옅어지는 안개 + 해/달 방향 빛 산란 ──
// THREE.Fog 를 사용하되 near = 해/달 방향(방위·고도 인코딩), far = 밀도
THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth; varying vec3 vFogWorld;
#endif`;
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec4 fogWP = vec4( position, 1.0 );
  #ifdef USE_INSTANCING
  fogWP = instanceMatrix * fogWP;
  #endif
  vFogWorld = ( modelMatrix * fogWP ).xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogWorld;
  #ifdef FOG_EXP2
  uniform float fogDensity;
  #else
  uniform float fogNear; uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
  float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  #else
  float fgPk = fogNear, fgAz = radians( floor( fgPk / 1000.0 ) - 180.0 ), fgEl = radians( mod( fgPk, 1000.0 ) - 90.0 );
  vec3 fgSun = vec3( cos( fgEl ) * cos( fgAz ), sin( fgEl ), cos( fgEl ) * sin( fgAz ) );
  vec3 fgRv = vFogWorld - cameraPosition; float fgDist = length( fgRv ); vec3 fgRd = fgRv / max( fgDist, 1e-4 );
  float fgDh = fgRv.y * 0.035, fgH = abs( fgDh ) > 1e-3 ? ( 1.0 - exp( - fgDh ) ) / fgDh : 1.0;
  float fogFactor = 1.0 - exp( - fogFar * fogFar * fgDist * fgDist * exp( - max( cameraPosition.y, 0.0 ) * 0.035 ) * fgH );
  float fgSd = max( dot( fgRd, fgSun ), 0.0 );
  vec3 fgCol = fogColor * ( 1.0 + vec3( 1.0, 0.72, 0.45 ) * pow( fgSd, 6.0 ) * 0.9 + vec3( 1.0, 0.9, 0.75 ) * pow( fgSd, 48.0 ) * 1.3 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fgCol, fogFactor );
  #endif
#endif`;
export function packFogDir(d) { const az = Math.round(Math.atan2(d.z, d.x) * 180 / Math.PI) + 180, el = Math.round(Math.asin(Math.max(-1, Math.min(1, d.y))) * 180 / Math.PI) + 90; return az * 1000 + el; }

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
  uniform vec2 uSunUV; uniform float uSunVis; uniform vec3 uSunCol; uniform float uFrame;
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
    // 빛줄기(갓 레이): 해 쪽으로 깊이=하늘 인 밝은 픽셀을 누적
    vec3 rays = vec3(0.);
    if (uSunVis > 0.001) {
      vec2 dv = uSunUV - vUv; float L = length(dv);
      vec2 st = dv / 32.0; vec2 p = vUv + st * fract(sin(dot(vUv * 731.7 + uFrame, vec2(12.9898, 78.233))) * 43758.5);
      float acc = 0., wt = 1.;
      for (int i = 0; i < 32; i++) {
        p += st;
        if (p.x < 0. || p.y < 0. || p.x > 1. || p.y > 1.) break;
        float sky = step(0.99999, texture2D(tDepth, p).x);
        float lum = dot(texture2D(tDiffuse, p).rgb, vec3(0.2126, 0.7152, 0.0722));
        acc += sky * max(lum - 0.6, 0.) * wt; wt *= 0.965;
      }
      rays = uSunCol * acc / 32. * uSunVis * exp(-L * 1.4);
    }
    gl_FragColor = vec4(col.rgb * ao + rays, col.a);
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
      uniforms: { tDiffuse: { value: null }, tAO: { value: this.aoRT.texture }, tDepth: { value: null }, uAORes: { value: new THREE.Vector2(w >> 1, h >> 1) }, uStrength: { value: 0.85 }, uProjInv: { value: new THREE.Matrix4() },
        uSunUV: { value: new THREE.Vector2() }, uSunVis: { value: 0 }, uSunCol: { value: new THREE.Color(1, 0.8, 0.55) }, uFrame: { value: 0 } } });
    this.ao = true;
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
    u.uFrame.value = (this.frame++ % 64); c.uFrame.value = u.uFrame.value;
    c.uStrength.value = this.ao ? 0.85 : 0;
    if (this.ao) { renderer.setRenderTarget(this.aoRT); this.q1.render(renderer); }
    c.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.q2.render(renderer);
  }
  dispose() { this.aoRT.dispose(); this.aoMat.dispose(); this.compMat.dispose(); }
}

// ── 색보정 / 렌즈 효과 ──
export const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.28 }, uDamage: { value: 0 }, uSup: { value: 0 }, uGrain: { value: 0.028 }, uCA: { value: 0.0022 }, uSat: { value: 1.12 }, uLow: { value: 0 }, uFlash: { value: 0 }, uScope: { value: 0 }, uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) }, uSharp: { value: 0.35 }, uSh0: { value: new THREE.Vector4() }, uSh1: { value: new THREE.Vector4() } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVig, uDamage, uSup, uGrain, uCA, uSat, uLow, uFlash, uScope, uSharp; uniform vec2 uTexel; uniform vec4 uSh0, uSh1; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
    // 폭발 충격파: 화면상 팽창하는 굴절 고리 (xy=중심, z=반경, w=세기)
    vec2 shk(vec2 uv, vec4 s, float asp){ if (s.w <= 0.) return vec2(0.); vec2 d = uv - s.xy; d.x *= asp; float r = length(d); float w = s.w * exp(-pow((r - s.z) / max(0.018, s.z * 0.22), 2.)); return d / max(r, 1e-4) * w * vec2(1. / asp, 1.); }
    void main(){
      float asp = uTexel.y / uTexel.x;
      vec2 uv = vUv - shk(vUv, uSh0, asp) - shk(vUv, uSh1, asp), c = uv - 0.5; float r = length(c);
      float ca = uCA * (1.0 + uSup*3.0) * r;
      vec3 col = vec3(texture2D(tDiffuse, uv - c*ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv + c*ca).b);
      // 선명화 (언샤프 마스크)
      vec3 nb = texture2D(tDiffuse, uv + vec2(uTexel.x, 0.)).rgb + texture2D(tDiffuse, uv - vec2(uTexel.x, 0.)).rgb + texture2D(tDiffuse, uv + vec2(0., uTexel.y)).rgb + texture2D(tDiffuse, uv - vec2(0., uTexel.y)).rgb;
      col = max(col + (col - nb * 0.25) * uSharp, 0.);
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
// 시간대 하늘: 낮 대기 그라데이션 · 노을(태양 쪽 주황/반대편 보라) · 밤(별 · 은하수 · 달) · 이중 구름층(태양/달빛 조명)
export function skyMaterial(sunDir, disk = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir.clone() }, uMoon: { value: sunDir.clone().negate() }, uTime: { value: 0 }, uDisk: { value: disk }, uDay: { value: 1 }, uTw: { value: 0 }, uNight: { value: 0 }, uCloud: { value: 1 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize((modelMatrix*vec4(position,0.)).xyz); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 uSun, uMoon; uniform float uTime, uDisk, uDay, uTw, uNight, uCloud; varying vec3 vDir;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float hash3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      float fbm(vec2 p){ float s = 0., a = .5; for(int i=0;i<6;i++){ s += noise(p)*a; p = p*2.03 + vec2(1.7, 9.2); a *= .5; } return s; }
      void main(){
        vec3 d = normalize(vDir); float h = d.y;
        float sd = max(dot(d, uSun), 0.), md = max(dot(d, uMoon), 0.);
        float hz = pow(clamp(h, 0., 1.), 0.42);
        // 낮
        vec3 day = mix(vec3(0.66,0.74,0.82), vec3(0.09,0.24,0.58), hz);
        day += vec3(1.0,0.58,0.3) * pow(sd, 5.) * 0.5 * (1. - clamp(h*1.5,0.,1.));
        // 노을: 태양 쪽 지평선 주황·빨강, 반대편 보라·분홍, 천정 짙은 청색
        float sAz = max(dot(normalize(vec2(d.x, d.z) + 1e-5), normalize(vec2(uSun.x, uSun.z) + 1e-5)), 0.);
        vec3 tw = mix(vec3(0.55,0.36,0.52), vec3(1.25,0.48,0.16), pow(sAz, 2.5));
        tw = mix(tw, vec3(0.1,0.13,0.3), pow(clamp(h, 0., 1.), 0.55));
        tw += vec3(1.3,0.5,0.15) * pow(sd, 8.) * 0.8;
        // 밤
        vec3 night = mix(vec3(0.022,0.03,0.05), vec3(0.003,0.006,0.016), hz);
        vec3 col = night * uNight + day * uDay + tw * uTw * (1. - uDay * 0.6);
        col = max(col, night);
        // 해
        col += vec3(1.0,0.86,0.66) * pow(sd, 90.) * 2.2 * uDay;
        col += vec3(46.,39.,30.) * smoothstep(0.99955, 0.99975, sd) * uDisk * smoothstep(-0.02, 0.01, uSun.y);
        // 별 + 은하수
        float starK = uNight * smoothstep(0.0, 0.2, h);
        if (starK > 0.001) {
          vec3 p = d * 260.; vec3 ip = floor(p); float r = hash3(ip);
          if (r > 0.9965) { vec3 c = fract(p) - 0.5; float st = smoothstep(0.35, 0.0, length(c)) * (r - 0.9965) / 0.0035;
            float tw2 = 0.65 + 0.35 * sin(uTime * (2. + r * 7.) + r * 40.); col += vec3(0.9,0.93,1.0) * st * tw2 * 2.2 * starK; }
          vec3 gp = normalize(vec3(0.35, 0.55, -0.76)); float band = exp(-pow(dot(d, gp) * 5.5, 2.)) * fbm(d.xz * 6. + d.y * 3.);
          col += vec3(0.05,0.055,0.08) * band * starK;
        }
        // 달 (원반 + 달무리)
        float moonUp = smoothstep(-0.02, 0.05, uMoon.y) * (1. - uDay * 0.85);
        col += vec3(1.0,0.97,0.9) * 3.5 * smoothstep(0.99985, 0.99992, md) * moonUp * (0.85 + 0.15 * fbm(d.xy * 900.));
        col += vec3(0.25,0.3,0.4) * pow(md, 200.) * 0.6 * moonUp + vec3(0.04,0.05,0.07) * pow(md, 12.) * moonUp;
        // 구름
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.1) * 1.2 + vec2(uTime*0.006, uTime*0.002);
          float base = fbm(uv * 1.1);
          float c = smoothstep(0.5, 0.82, base) * uCloud;
          float c2 = smoothstep(0.58, 0.9, fbm(uv*2.7 + 7.)) * 0.5 * uCloud;
          float thick = smoothstep(0.55, 1.0, base);
          vec3 litDay = vec3(1.08,1.03,0.98) + vec3(1.0,0.72,0.45)*pow(sd,4.)*0.9;
          vec3 litTw = mix(vec3(0.45,0.3,0.4), vec3(1.4,0.55,0.25), pow(sAz, 1.5)) * (0.6 + 0.6 * pow(sd, 3.));
          vec3 litNight = vec3(0.03,0.035,0.05) + vec3(0.18,0.2,0.26) * pow(md, 6.) * moonUp;
          vec3 lit = litNight * uNight + litDay * uDay + litTw * uTw * (1. - uDay * 0.7);
          vec3 shade = mix(lit * 0.35, vec3(0.52,0.55,0.62) * uDay + lit * 0.4 * (1. - uDay), uDay);
          vec3 cc = mix(lit, shade, thick*0.7);
          float cov = clamp(c*0.9 + c2, 0., 1.) * smoothstep(0.0, 0.2, h);
          col = mix(col, cc, cov);
          float ci = smoothstep(0.55, 0.9, fbm(vec2(uv.x*0.3, uv.y*3.0) + 3.)) * 0.25 * smoothstep(0.1, 0.4, h) * uCloud;
          col = mix(col, lit, ci);
        }
        vec3 hor = day * uDay + tw * uTw * 0.6 + night * uNight;
        vec3 ground = vec3(0.21,0.2,0.18) * (uDay + 0.25 * uTw) + vec3(0.01,0.012,0.018) * uNight;
        col = mix(col, mix(hor*0.85, ground, smoothstep(0.0, 0.25, -h)), step(h, 0.0));
        gl_FragColor = vec4(col, 1.);
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
}

// ── 시간대별 환경광 굽기: 낮 HDRI(태양 방위 정렬) × 밝기 + 노을/밤 대기색 → PMREM ──
export class EnvBaker {
  constructor(renderer, hdrTex, hdriSunAz) {
    this.pm = new THREE.PMREMGenerator(renderer); this.hdriSunAz = hdriSunAz;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tEnv: { value: hdrTex }, uRot: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: new THREE.Vector3(0, -1, 0) }, uDay: { value: 1 }, uTw: { value: 0 }, uNight: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform sampler2D tEnv; uniform float uRot, uDay, uTw, uNight; uniform vec3 uSun, uMoon; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float a = atan(d.z, d.x) - uRot;
          vec2 uv = vec2(fract(a / 6.2831853 + 0.5), asin(clamp(d.y, -1., 1.)) / 3.1415926 + 0.5);
          vec3 c = texture2D(tEnv, uv).rgb;
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(lum), c, 0.58);
          float up = clamp(d.y, 0., 1.), sd = max(dot(d, uSun), 0.), md = max(dot(d, uMoon), 0.);
          vec3 twc = mix(vec3(0.35,0.28,0.4), vec3(1.1,0.5,0.22), pow(max(dot(normalize(d.xz + 1e-5), normalize(uSun.xz + 1e-5)), 0.), 2.)) * (0.35 + 0.5 * (1. - up));
          vec3 ngt = vec3(0.012,0.017,0.03) * (0.6 + 0.4 * up) + vec3(0.03,0.035,0.045) * pow(md, 4.) * smoothstep(-0.05, 0.1, uMoon.y);
          vec3 sky = c * uDay + twc * uTw * (1. - uDay * 0.7) * lum * 1.6 + twc * uTw * 0.12 + ngt * uNight;
          // 지면 반사광: 햇빛 고도에 비례 (알베도 0.3 × (태양+하늘 조도)/π) → 그늘이 과하게 푸르지 않게
          vec3 ground = vec3(0.3, 0.275, 0.24) * (uDay * (0.3 + 1.25 * max(uSun.y, 0.)) + 0.35 * uTw) + vec3(0.006,0.007,0.01) * uNight;
          float g = smoothstep(0.02, -0.12, d.y);
          gl_FragColor = vec4(mix(sky, ground, g), 1.);
        }`,
      side: THREE.BackSide, depthWrite: false,
    });
    this.scene = new THREE.Scene(); this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), this.mat));
    this.rt = null;
  }
  bake(sun, moon, day, tw, night) {
    const u = this.mat.uniforms;
    u.uRot.value = Math.atan2(sun.z, sun.x) - this.hdriSunAz;
    u.uSun.value.copy(sun); u.uMoon.value.copy(moon); u.uDay.value = day; u.uTw.value = tw; u.uNight.value = night;
    const old = this.rt;
    this.rt = this.pm.fromScene(this.scene, 0.0);
    if (old) old.dispose();
    return this.rt.texture;
  }
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
