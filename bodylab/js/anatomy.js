// 몸 만들기: 피부 재질(상처·창백함·피부 산란), 몸통·다리 메시(스킨), 머리·얼굴, 장기, 뼈, 근육, 엑스레이 재질
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { paint, toTex, fbm, canvas, heightToNormal } from './tex.js';

const V = THREE.Vector3;
export const MAXW = 16;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (x, s) => Math.exp(-(x * x) / (2 * s * s));
// 모델 텍스처의 평균 피부색(선형)
export const SKIN_LIN = [0.431, 0.184, 0.112];

// ───────── 피부 재질 ─────────
const NOISE = /* glsl */`
float h3(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
 return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }`;
const WOUND_FRAG = /* glsl */`
uniform vec4 uW[${MAXW}]; uniform vec4 uD[${MAXW}]; uniform vec4 uC[${MAXW}]; uniform int uN; uniform float uPale; uniform float uBloody;
varying vec3 vBind;
${NOISE}
float gWet;
void applyWounds(inout vec4 dc, inout float rough){
  float hole=0.0, flesh=0.0, bruise=0.0, blood=0.0, burn=0.0;
  float nz = n3(vBind*220.0);
  for(int i=0;i<${MAXW};i++){ if(i>=uN) break;
    vec4 w=uW[i]; vec4 d=uD[i]; vec4 c=uC[i];
    vec3 rel=vBind-w.xyz; float r=w.w; int t=int(d.w+0.5); float dist;
    if(t==1){ float a=clamp(dot(rel,c.xyz),-c.w,c.w); dist=length(rel-c.xyz*a); dist/=max(1.0-pow(abs(a)/max(c.w,1e-4),4.0),0.08); }
    else dist=length(rel);
    float x=dist/r+(nz-0.5)*0.55;
    if(t==2){ bruise=max(bruise,1.0-smoothstep(0.2,1.0,x)); }
    else if(t==6){ bruise=max(bruise,1.0-smoothstep(0.5,1.4,x)); flesh=max(flesh,1.0-smoothstep(0.35,0.7,x)); hole=max(hole,(1.0-smoothstep(0.1,0.3,x))*0.7); }
    else if(t==3){ burn=max(burn,1.0-smoothstep(0.35,1.0,x)); flesh=max(flesh,(1.0-smoothstep(0.1,0.3,x))*0.6); }
    else { float hs = t==5 ? 0.42 : 0.3; hole=max(hole,1.0-smoothstep(hs*0.8,hs,x)); flesh=max(flesh,1.0-smoothstep(0.55,0.8,x)); bruise=max(bruise,(1.0-smoothstep(0.8,2.4,x))*0.55); }
    float dl=length(d.xyz);
    if(dl>0.001 && t!=2 && t!=3){ vec3 dd=d.xyz/dl; float al=dot(rel,dd); float lt=length(rel-dd*al);
      float wid=r*(0.32+0.2*sin(al*70.0+float(i)*7.0))*(1.0-clamp(al/dl,0.0,1.0)*0.6);
      blood=max(blood, step(0.0,al)*(1.0-smoothstep(dl*0.75,dl,al))*(1.0-smoothstep(wid*0.5,wid,lt)));
      blood=max(blood,(1.0-smoothstep(1.0,1.9,x))*0.95); }
  }
  blood = max(blood, uBloody*smoothstep(0.45,0.75,n3(vBind*18.0)));
  dc.rgb = mix(dc.rgb, dc.rgb*vec3(0.42,0.2,0.3), bruise*0.75);
  dc.rgb = mix(dc.rgb, vec3(0.26,0.008,0.006)*(0.8+0.4*nz), blood*0.94);
  dc.rgb = mix(dc.rgb, vec3(0.48,0.05,0.045)*(0.55+0.7*n3(vBind*400.0)), flesh);
  dc.rgb = mix(dc.rgb, vec3(0.02,0.0,0.0), hole);
  dc.rgb = mix(dc.rgb, vec3(0.025,0.018,0.014)*(0.6+nz), burn);
  float lum = dot(dc.rgb, vec3(0.3,0.55,0.15));
  dc.rgb = mix(dc.rgb, vec3(lum)*vec3(0.92,0.96,1.08)*1.1, uPale*(1.0-max(blood,flesh))*0.8);
  gWet = max(max(blood,flesh),hole);
  rough = mix(rough, 0.16, gWet);
}`;
const SSS_FN = /* glsl */`
vec3 skinScatter(vec3 n, vec3 l, vec3 col){ float ndl=dot(n,l); float w=max(0.0,(ndl+0.5)/1.5)-max(ndl,0.0); return col*vec3(1.0,0.32,0.2)*max(w,0.0)*(1.0-gWet)*0.75; }`;
const DIRECT = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

export function skinMaterial({ map = null, normalMap = null, orm = null, detail = null, color = null } = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: color ?? (map ? 0xffffff : new THREE.Color(...SKIN_LIN)), map, normalMap, roughnessMap: orm, aoMap: orm, aoMapIntensity: 0.6,
    roughness: map ? 1 : 0.55, sheen: 0.35, sheenColor: new THREE.Color(0.9, 0.55, 0.45), sheenRoughness: 0.55, envMapIntensity: 0.7,
  });
  if (normalMap) mat.normalScale.set(1, 1);
  const U = { uW: { value: [] }, uD: { value: [] }, uC: { value: [] }, uN: { value: 0 }, uPale: { value: 0 }, uBloody: { value: 0 }, uDetail: { value: detail } };
  for (let i = 0; i < MAXW; i++) { U.uW.value.push(new THREE.Vector4()); U.uD.value.push(new THREE.Vector4()); U.uC.value.push(new THREE.Vector4()); }
  mat.userData.U = U;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBind;\nvarying vec3 vBindN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position; vBindN = normal;');
    let f = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vBindN;\nuniform sampler2D uDetail;\n${WOUND_FRAG}\n${SSS_FN}`);
    if (detail) f = f.replace('#include <map_fragment>', `#include <map_fragment>
{ vec3 bw=pow(abs(vBindN)+1e-3,vec3(4.0)); bw/=max(dot(bw,vec3(1.0)),1e-6); float s=3.2;
  vec3 tc=texture2D(uDetail,vBind.zy*s).rgb*bw.x+texture2D(uDetail,vBind.xz*s).rgb*bw.y+texture2D(uDetail,vBind.xy*s).rgb*bw.z;
  diffuseColor.rgb*=tc*2.0; }`);
    f = f.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\napplyWounds(diffuseColor, roughnessFactor);');
    f = f.split(DIRECT).join(`${DIRECT}\n\t\treflectedLight.directDiffuse += skinScatter(geometryNormal, directLight.direction, directLight.color*material.diffuseColor);`);
    sh.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => 'skin' + (detail ? 'd' : '') + (map ? 'm' : '');
  return mat;
}
// 팔 텍스처에서 피부만 있는 부분을 잘라 몸에 쓰는 디테일 텍스처 (평균=0.5)
export function skinDetailFrom(image) {
  const c = canvas(256), g = c.getContext('2d');
  g.drawImage(image, 500, 300, 360, 300, 0, 0, 256, 256);
  const d = g.getImageData(0, 0, 256, 256), a = d.data;
  let r = 0, gg = 0, b = 0; const n = a.length / 4;
  for (let i = 0; i < a.length; i += 4) { r += a[i]; gg += a[i + 1]; b += a[i + 2]; }
  r /= n; gg /= n; b /= n;
  for (let i = 0; i < a.length; i += 4) { a[i] = Math.min(255, a[i] / r * 127); a[i + 1] = Math.min(255, a[i + 1] / gg * 127); a[i + 2] = Math.min(255, a[i + 2] / b * 127); }
  g.putImageData(d, 0, 0);
  const t = toTex(c, { srgb: false }); t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
  return t;
}

// ───────── 엑스레이 재질 ─────────
export function xrayMaterial(color, { solid = 0.2, rim = 2.5, power = 1, skinned = false } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uSolid: { value: solid }, uRim: { value: rim }, uPow: { value: power }, uFlash: { value: 0 }, uHi: { value: new THREE.Color(1, 0.12, 0.05) } },
    vertexShader: /* glsl */`
#include <common>
#include <skinning_pars_vertex>
varying vec3 vN; varying vec3 vV;
void main(){
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 mv = modelViewMatrix*vec4(transformed,1.0);
  vN = normalize(normalMatrix*objectNormal); vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix*mv;
}`,
    fragmentShader: /* glsl */`
uniform vec3 uColor; uniform float uSolid; uniform float uRim; uniform float uPow; uniform float uFlash; uniform vec3 uHi;
varying vec3 vN; varying vec3 vV;
void main(){ float f = 1.0-abs(dot(normalize(vN),normalize(vV))); float a = uSolid + pow(f,uRim);
  vec3 c = mix(uColor, uHi, uFlash); gl_FragColor = vec4(c*a*uPow, 1.0); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, side: THREE.DoubleSide,
  });
}

// ───────── 형상 도우미 ─────────
// 단면(타원/초타원)을 이어 붙인 관. rows: [{c:Vector3 중심, rx, rzF, rzB}] 축은 Y (위→아래 순서 무관)
function loftY(rows, seg = 40, e = 2.4, capA = true, capB = true) {
  const pos = [], idx = [];
  for (const r of rows) for (let j = 0; j < seg; j++) {
    const th = j / seg * Math.PI * 2, s = Math.sin(th), c = Math.cos(th);
    const px = Math.sign(s) * Math.pow(Math.abs(s), 2 / e), pz = Math.sign(c) * Math.pow(Math.abs(c), 2 / e);
    pos.push(r.c.x + r.rx * px + (r.dx ? r.dx(px, pz) : 0), r.c.y, r.c.z + (pz >= 0 ? r.rzF : r.rzB) * pz + (r.dz ? r.dz(px, pz) : 0));
  }
  const n = rows.length;
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + (j + 1) % seg, c = a + seg, d = b + seg;
    idx.push(a, c, b, b, c, d);
  }
  const cap = (ri, flip) => { const ci = pos.length / 3; const r = rows[ri]; pos.push(r.c.x, r.c.y + (flip ? 0.006 : -0.006), r.c.z);
    for (let j = 0; j < seg; j++) { const a = ri * seg + j, b = ri * seg + (j + 1) % seg; flip ? idx.push(ci, a, b) : idx.push(ci, b, a); } };
  if (capA) cap(0, rows[0].c.y > rows[n - 1].c.y);
  if (capB) cap(n - 1, rows[n - 1].c.y > rows[0].c.y);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // 와인딩 방향 맞추기 (바깥이 앞면): 첫 삼각형 법선이 중심 밖을 향하는지 확인
  g.computeVertexNormals();
  return g;
}
function interpRows(ctrl, n, make) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) * (ctrl.length - 1), k = Math.min(ctrl.length - 2, Math.floor(t)), f = t - k;
    const p0 = ctrl[Math.max(0, k - 1)], p1 = ctrl[k], p2 = ctrl[k + 1], p3 = ctrl[Math.min(ctrl.length - 1, k + 2)];
    const cr = j => { const a = p0[j], b = p1[j], c = p2[j], d = p3[j]; return 0.5 * ((2 * b) + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f); };
    out.push(make(cr));
  }
  return out;
}
function fixWinding(g, center) {
  // 바깥쪽이 앞면이 되도록: 평균적으로 법선이 중심에서 멀어지는지 검사
  const p = g.attributes.position, nn = g.attributes.normal; let s = 0;
  for (let i = 0; i < p.count; i += 7) { s += (p.getX(i) - center.x) * nn.getX(i) + (p.getZ(i) - center.z) * nn.getZ(i); }
  if (s < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
  return g;
}

// ───────── 몸 (팔·머리 제외) — 스킨 메시 ─────────
export const BODY_BONES = ['pelvis', 'belly', 'chest', 'neck', 'head', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
export function buildBody(REST, { inflate = 0, part = 'all' } = {}) {
  const geos = [], regions = [];
  const I = inflate;
  if (part === 'all' || part === 'shorts') {
    // 몸통
    const T = [ // y, rx, rzF, rzB, cz
      [0.80, 0.05, 0.05, 0.05, -0.01], [0.845, 0.118, 0.08, 0.095, -0.01], [0.90, 0.162, 0.095, 0.118, -0.012], [0.97, 0.168, 0.1, 0.122, -0.014],
      [1.04, 0.152, 0.1, 0.1, -0.006], [1.10, 0.139, 0.104, 0.086, 0], [1.18, 0.143, 0.108, 0.086, 0], [1.26, 0.153, 0.118, 0.09, 0],
      [1.33, 0.162, 0.122, 0.096, 0], [1.39, 0.172, 0.112, 0.097, -0.006], [1.44, 0.178, 0.088, 0.09, -0.012], [1.48, 0.13, 0.07, 0.08, -0.016],
      [1.51, 0.076, 0.06, 0.066, -0.016], [1.535, 0.06, 0.055, 0.06, -0.016]];
    const ctrl = part === 'shorts' ? T.slice(0, 6) : T;
    const rows = interpRows(ctrl, part === 'shorts' ? 14 : 44, cr => {
      const y = cr(0);
      return { c: new V(0, y, cr(4)), rx: cr(1) + I, rzF: cr(2) + I, rzB: cr(3) + I,
        dz: (px, pz) => pz > 0 ? 0.016 * gauss(Math.abs(px) * cr(1) - 0.075, 0.035) * gauss(y - 1.33, 0.035) * pz : -0.012 * gauss(Math.abs(px) * cr(1) - 0.07, 0.04) * gauss(y - 0.93, 0.04) * pz };
    });
    const g = fixWinding(loftY(rows, 48, 2.5, true, part !== 'shorts'), new V(0, 1, 0));
    geos.push(g); regions.push('torso');
  }
  if (part === 'all') {
    const N = [[1.49, 0.06, 0.057, 0.057, -0.012], [1.56, 0.055, 0.05, 0.054, -0.006], [1.63, 0.054, 0.048, 0.055, 0.0], [1.67, 0.05, 0.04, 0.05, 0.0]];
    const g = fixWinding(loftY(interpRows(N, 8, cr => ({ c: new V(0, cr(0), cr(4)), rx: cr(1), rzF: cr(2), rzB: cr(3) })), 32, 2, false, false), new V(0, 1.5, 0));
    geos.push(g); regions.push('neck');
  }
  for (const s of [1, -1]) {
    if (part === 'all' || part === 'shorts') {
      const L = [[1.0, 0.085, -0.01, 0.095, 0.1], [0.92, 0.092, 0.0, 0.092, 0.095], [0.80, 0.097, 0.006, 0.083, 0.085], [0.68, 0.1, 0.01, 0.072, 0.075],
        [0.56, 0.102, 0.016, 0.058, 0.06], [0.515, 0.102, 0.02, 0.054, 0.056], [0.45, 0.103, 0.008, 0.054, 0.058], [0.36, 0.104, -0.01, 0.055, 0.064],
        [0.25, 0.105, -0.008, 0.044, 0.048], [0.14, 0.105, -0.01, 0.034, 0.038], [0.08, 0.105, -0.012, 0.033, 0.036]];
      const ctrl = part === 'shorts' ? L.slice(0, 4).map((r, i) => i === 3 ? [0.74, 0.099, 0.008, 0.078, 0.08] : r) : L;
      const rows = interpRows(ctrl, part === 'shorts' ? 8 : 34, cr => ({ c: new V(cr(1) * s, cr(0), cr(2)), rx: cr(3) + I, rzF: cr(4) + I, rzB: cr(4) + I }));
      geos.push(fixWinding(loftY(rows, 32, 2, false, part !== 'shorts'), new V(0.1 * s, 0.5, 0))); regions.push(s > 0 ? 'legL' : 'legR');
    }
    if (part === 'all') {
      // 발: z 방향 단면
      const F = [[-0.07, 0.05, 0.03, 0.03, 0.05], [-0.045, 0.058, 0.038, 0.05, 0.058], [0.0, 0.062, 0.04, 0.045, 0.062], [0.06, 0.045, 0.046, 0.033, 0.045], [0.12, 0.03, 0.049, 0.022, 0.03], [0.17, 0.022, 0.042, 0.015, 0.022], [0.19, 0.02, 0.022, 0.009, 0.018]];
      const rows = interpRows(F, 16, cr => ({ z: cr(0), cy: cr(1), w: cr(2), ht: cr(3), hb: cr(4) }));
      const pos = [], idx = [], seg = 24;
      for (const r of rows) for (let j = 0; j < seg; j++) {
        const th = j / seg * Math.PI * 2, sx = Math.sin(th), cy = Math.cos(th);
        const px = Math.sign(sx) * Math.pow(Math.abs(sx), 2 / 3), py = Math.sign(cy) * Math.pow(Math.abs(cy), 2 / 3);
        pos.push(s * (0.106 + r.z * 0.06) + r.w * px, Math.max(0.002, r.cy + (py > 0 ? r.ht : r.hb) * py), r.z - 0.0);
      }
      for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < seg; j++) { const a = i * seg + j, b = i * seg + (j + 1) % seg; idx.push(a, b, a + seg, b, b + seg, a + seg); }
      for (const [ri, fl] of [[0, 0], [rows.length - 1, 1]]) { const ci = pos.length / 3; const r = rows[ri]; pos.push(s * (0.106 + r.z * 0.06), r.cy, r.z); for (let j = 0; j < seg; j++) { const a = ri * seg + j, b = ri * seg + (j + 1) % seg; fl ? idx.push(ci, a, b) : idx.push(ci, b, a); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      // 바깥 확인 (중심: 발 중앙)
      const p = g.attributes.position, nn = g.attributes.normal; let sum = 0;
      for (let i = 0; i < p.count; i++) sum += (p.getY(i) - 0.04) * nn.getY(i) + (p.getX(i) - s * 0.106) * nn.getX(i);
      if (sum < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
      geos.push(g); regions.push(s > 0 ? 'footL' : 'footR');
    }
  }
  // 스킨 가중치
  for (let gi = 0; gi < geos.length; gi++) {
    const g = geos[gi], reg = regions[gi], p = g.attributes.position, n = p.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), y = p.getY(i), ax = Math.abs(x);
      const L = x > 0, th = L ? 5 : 8, sh = th + 1, ft = th + 2;
      let w = {};
      const add = (b, v) => { if (v > 1e-4) w[b] = (w[b] || 0) + v; };
      if (reg === 'torso') {
        const wC = sstep(1.17, 1.3, y), wP = 1 - sstep(0.99, 1.1, y);
        let wN = sstep(1.47, 1.53, y) * (1 - sstep(0.07, 0.12, ax));
        const wT = (1 - sstep(0.84, 0.98, y)) * sstep(0.02, 0.1, ax) * 0.65;
        const rest = (1 - wN) * (1 - wT);
        add(0, wP * rest); add(2, wC * rest); add(1, Math.max(0, 1 - wP - wC) * rest); add(3, wN * (1 - wT)); add(th, wT);
      } else if (reg === 'neck') {
        const wH = sstep(1.6, 1.665, y), wC = 1 - sstep(1.49, 1.535, y);
        add(4, wH); add(2, wC * (1 - wH)); add(3, (1 - wH) * (1 - wC));
      } else if (reg === 'legL' || reg === 'legR') {
        const wP = sstep(0.88, 0.99, y) * 0.75, wS = 1 - sstep(0.47, 0.56, y), wF = 1 - sstep(0.075, 0.1, y);
        add(0, wP); add(th, (1 - wP) * (1 - wS)); add(sh, (1 - wP) * wS * (1 - wF)); add(ft, (1 - wP) * wS * wF);
      } else { const wS = sstep(0.07, 0.11, y) * 0.5; add(ft, 1 - wS); add(sh, wS); }
      const e = Object.entries(w).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const tot = e.reduce((s, q) => s + q[1], 0);
      e.forEach((q, k) => { si[i * 4 + k] = +q[0]; sw[i * 4 + k] = q[1] / tot; });
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  }
  return mergeGeometries(geos);
}

// ───────── 머리·얼굴 ─────────
export function headGeometry(C) {
  const g = new THREE.SphereGeometry(1, 128, 96), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let rx = 0.074, ry = 0.114, rz = 0.097;
    if (z < 0) rz *= 1 + 0.07 * Math.max(0, y + 0.3);
    const jn = sstep(-0.05, -0.95, y);
    rx *= 1 - 0.36 * jn * jn;
    if (z < 0) rz *= 1 - 0.35 * jn;
    let X = x * rx, Y = y * ry, Z = z * rz;
    const front = sstep(0.2, 0.7, z);
    X *= 1 - 0.05 * front * sstep(-0.2, 0.4, y);
    Z += 0.012 * gauss(y + 0.86, 0.12) * front;                // 턱 끝
    Y += 0.006 * gauss(y + 0.95, 0.1);
    for (const s of [-1, 1]) {
      Z -= 0.014 * gauss(X - s * 0.033, 0.015) * gauss(Y - 0.026, 0.012) * front; // 눈구멍
      Z += 0.006 * gauss(X - s * 0.045, 0.016) * gauss(Y + 0.006, 0.012) * front; // 광대
      Z += 0.0045 * gauss(Math.abs(X) - 0.014, 0.005) * gauss(Y + 0.04, 0.005) * front; // 콧방울
    }
    Z += 0.006 * gauss(Y - 0.048, 0.008) * gauss(X, 0.04) * front;  // 눈썹뼈
    Z += 0.024 * gauss(X, 0.0105) * sstep(0.035, -0.035, Y) * sstep(-0.058, -0.036, Y) * front; // 콧대
    Z += 0.012 * gauss(X, 0.013) * gauss(Y + 0.036, 0.011) * front;   // 코끝
    Z += 0.006 * gauss(X, 0.024) * gauss(Y + 0.072, 0.012) * front; // 입술
    Z -= 0.003 * gauss(X, 0.022) * gauss(Y + 0.09, 0.005) * front;  // 입술 아래 홈
    p.setXYZ(i, X + C.x, Y + C.y, Z + C.z);
  }
  g.computeVertexNormals();
  return g;
}
function eyeTexture() {
  return toTex(paint(256, (u, v) => {
    const r = v; // v=0 이 앞(홍채)
    if (r < 0.045) return [6, 5, 5];
    if (r < 0.13) { const a = Math.atan2(v, u) * 30; const n = 0.6 + 0.4 * Math.sin(u * 140 + Math.sin(u * 37) * 3); const t = (r - 0.045) / 0.085; return [70 * n + 40 * t, 48 * n + 20 * t, 26 * n]; }
    if (r < 0.145) return [40, 30, 25];
    const vein = Math.max(0, Math.sin(u * 60 + v * 30) * Math.sin(u * 23 - v * 50)) * sstep(0.3, 0.6, r);
    return [235 - vein * 30, 228 - vein * 120, 222 - vein * 120];
  }), { srgb: true });
}
export function buildFace(C, skinMat) {
  const face = new THREE.Group();
  const eyeMat = new THREE.MeshPhysicalMaterial({ map: eyeTexture(), roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02 });
  const eyeG = new THREE.SphereGeometry(0.0122, 32, 24); eyeG.rotateX(Math.PI / 2);
  const lidG = new THREE.SphereGeometry(0.0134, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const lowG = new THREE.SphereGeometry(0.0131, 32, 8, 0, Math.PI * 2, 0, Math.PI * 0.22);
  const browMat = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.95 });
  const browG = new THREE.BoxGeometry(0.03, 0.004, 0.004); browG.translate(0, 0, 0);
  const F = { eyes: [], lids: [], lows: [], brows: [] };
  for (const s of [1, -1]) {
    const c = new V(C.x + s * 0.033, C.y + 0.027, C.z + 0.0615);
    const eye = new THREE.Mesh(eyeG, eyeMat); eye.position.copy(c); face.add(eye); F.eyes.push(eye);
    const lid = new THREE.Mesh(lidG, skinMat); lid.position.copy(c); face.add(lid); F.lids.push(lid);
    const low = new THREE.Mesh(lowG, skinMat); low.position.copy(c); low.rotation.x = Math.PI; face.add(low); F.lows.push(low);
    const bp = new THREE.Object3D(); bp.position.set(C.x + s * 0.034, C.y + 0.049, C.z + 0.0815); face.add(bp);
    const brow = new THREE.Mesh(browG, browMat); bp.add(brow); brow.userData.s = s; F.brows.push(bp);
  }
  // 입: 입안(어두운 공간) + 이 + 입술
  const lipMat = skinMat.clone(); lipMat.color = new THREE.Color(0.42, 0.13, 0.11); lipMat.roughness = 0.35; lipMat.onBeforeCompile = skinMat.onBeforeCompile; lipMat.userData = skinMat.userData;
  const mouthC = new V(C.x, C.y - 0.072, C.z + 0.089);
  const cav = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshStandardMaterial({ color: 0x1a0505, roughness: 0.6 }));
  cav.position.copy(mouthC).add(new V(0, 0, -0.012)); cav.scale.set(0.019, 0.004, 0.012); face.add(cav);
  const teethMat = new THREE.MeshStandardMaterial({ color: 0xcfc6b0, roughness: 0.55, envMapIntensity: 0.3 });
  const tU = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.008, 0.006), teethMat); tU.position.copy(mouthC).add(new V(0, 0.003, -0.004)); face.add(tU);
  const tL = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.007, 0.006), teethMat); tL.position.copy(mouthC).add(new V(0, -0.004, -0.005)); face.add(tL);
  const lipG = new THREE.SphereGeometry(1, 24, 12); lipG.scale(0.021, 0.0048, 0.0075);
  const upLip = new THREE.Mesh(lipG, lipMat); upLip.position.copy(mouthC).add(new V(0, 0.0045, -0.0055)); face.add(upLip);
  const loLip = new THREE.Mesh(lipG, lipMat); loLip.scale.set(0.95, 1.25, 1); loLip.position.copy(mouthC).add(new V(0, -0.004, -0.006)); face.add(loLip);
  // 귀
  for (const s of [1, -1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), skinMat); ear.scale.set(0.008, 0.029, 0.018);
    ear.position.set(C.x + s * 0.073, C.y + 0.004, C.z - 0.012); ear.rotation.y = s * 0.35; face.add(ear);
  }
  // 머리카락
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x1a120c, roughness: 0.7,
    normalMap: toTex(paint(256, (u, v) => { const n = Math.sin(u * 900 + Math.sin(v * 20) * 4) * 0.5 + 0.5; return [128 + (n - 0.5) * 120, 128, 255]; })) });
  const hair = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32, 0, Math.PI * 2, 0, 1.68), hairMat);
  hair.scale.set(0.079, 0.12, 0.104); hair.rotation.x = -0.5; hair.position.set(C.x, C.y + 0.006, C.z - 0.006); face.add(hair);
  face.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  Object.assign(F, { cav, tL, loLip, upLip, mouthC, lipMat });
  return { face, F };
}
// 표정 적용: e = { eyeOpen, browUp, browIn, mouthOpen, mouthWide, gaze:{x,y} }
export function applyFace(F, e) {
  const op = Math.min(1.05, e.eyeOpen);
  F.lids.forEach(l => { l.rotation.x = -0.32 + (1 - op) * 1.45; });
  F.lows.forEach(l => { l.rotation.x = Math.PI - 0.35 - (1 - e.eyeOpen) * 0.3; });
  F.eyes.forEach(o => { o.rotation.set(-e.gaze.y, e.gaze.x, 0); });
  F.brows.forEach(b => { const s = b.children[0].userData.s; b.position.y = b.userData.y0 ?? (b.userData.y0 = b.position.y); b.position.y = b.userData.y0 + e.browUp * 0.006; b.rotation.z = -s * e.browIn * 0.35; });
  const o = e.mouthOpen, w = e.mouthWide;
  F.cav.scale.set(0.019 * w, 0.004 + o * 0.018, 0.012);
  F.cav.position.y = F.mouthC.y - o * 0.008;
  F.loLip.position.y = F.mouthC.y - 0.004 - o * 0.017; F.tL.position.y = F.mouthC.y - 0.004 - o * 0.015;
  F.loLip.scale.x = F.upLip.scale.x = w;
}

// ───────── 장기 ─────────
function blob(r, seed = 1, rough = 0.12) {
  const g = new THREE.SphereGeometry(1, 40, 28), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + rough * (Math.sin(x * 5.1 + seed) * Math.sin(y * 4.3 + seed * 2) * Math.sin(z * 3.7 + seed * 3));
    p.setXYZ(i, x * r[0] * n, y * r[1] * n, z * r[2] * n);
  }
  g.computeVertexNormals();
  return g;
}
function coil(center, size, n, seed, radius) {
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pts = []; const p = new V();
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / 8), t = (i % 8) / 7, dir = row % 2 ? 1 - t : t;
    p.set(center.x + (dir - 0.5) * size.x + (rnd() - 0.5) * 0.03, center.y + size.y / 2 - row / (n / 8) * size.y + (rnd() - 0.5) * 0.02, center.z + (rnd() - 0.5) * size.z);
    pts.push(p.clone());
  }
  return { geo: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 6, radius, 10, false), pts };
}
export const ORGAN_COLORS = { brain: 0xd9a3a0, heart: 0x8a1414, lungL: 0xd77b80, lungR: 0xd77b80, liver: 0x5a1610, stomach: 0xc98a7c, spleen: 0x5b1a33, kidneyL: 0x7a2420, kidneyR: 0x7a2420, intestine: 0xd0928a, bladder: 0xc9a07a };
export const ORGAN_NAMES = { brain: '뇌', heart: '심장', lungL: '왼쪽 폐', lungR: '오른쪽 폐', liver: '간', stomach: '위', spleen: '비장', kidneyL: '왼쪽 신장', kidneyR: '오른쪽 신장', intestine: '창자', bladder: '방광' };
// 장기 정의: 어느 뼈에 붙는지, 중심(휴지 자세 좌표), 반지름(타원체)
export const ORGANS = [
  { id: 'brain', bone: 'head', c: [0, 1.695, -0.005], r: [0.062, 0.05, 0.078], vital: 1 },
  { id: 'heart', bone: 'chest', c: [0.022, 1.3, 0.045], r: [0.042, 0.055, 0.04], vital: 1 },
  { id: 'lungL', bone: 'chest', c: [0.075, 1.34, 0.0], r: [0.058, 0.1, 0.07] },
  { id: 'lungR', bone: 'chest', c: [-0.075, 1.34, 0.0], r: [0.062, 0.1, 0.07] },
  { id: 'liver', bone: 'belly', c: [-0.055, 1.185, 0.03], r: [0.095, 0.05, 0.065] },
  { id: 'stomach', bone: 'belly', c: [0.06, 1.165, 0.045], r: [0.058, 0.045, 0.04] },
  { id: 'spleen', bone: 'belly', c: [0.105, 1.18, -0.03], r: [0.025, 0.045, 0.02] },
  { id: 'kidneyL', bone: 'belly', c: [0.06, 1.1, -0.06], r: [0.026, 0.048, 0.022] },
  { id: 'kidneyR', bone: 'belly', c: [-0.06, 1.095, -0.06], r: [0.026, 0.048, 0.022] },
  { id: 'intestine', bone: 'pelvis', c: [0, 1.01, 0.045], r: [0.11, 0.08, 0.06] },
  { id: 'bladder', bone: 'pelvis', c: [0, 0.9, 0.06], r: [0.035, 0.03, 0.03] },
];
export function organGeometry(o) {
  const c = new V(...o.c);
  if (o.id === 'intestine') return coil(c, new V(0.2, 0.15, 0.06), 48, 7, 0.0125).geo;
  let g;
  if (o.id === 'brain') {
    g = new THREE.SphereGeometry(1, 64, 48); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const n = 1 + 0.04 * Math.sin(x * 23 + Math.sin(z * 17) * 2) * Math.sin(y * 19 + z * 13) - 0.08 * gauss(x, 0.04) * sstep(0, 0.6, y);
      p.setXYZ(i, x * o.r[0] * n, y * o.r[1] * n, z * o.r[2] * n); }
    g.computeVertexNormals();
  } else if (o.id === 'heart') { g = blob(o.r, 3, 0.08); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); const k = 1 - 0.45 * sstep(0, -0.06, y); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } g.computeVertexNormals(); g.rotateZ(0.5); }
  else g = blob(o.r, o.id.length, 0.1);
  g.translate(c.x, c.y, c.z);
  return g;
}
export function organMaterial(id) {
  return new THREE.MeshPhysicalMaterial({ color: ORGAN_COLORS[id], roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.12, sheen: 0.4, sheenColor: new THREE.Color(1, 0.6, 0.6),
    normalMap: ORGAN_NORMAL(), normalScale: new THREE.Vector2(0.6, 0.6) });
}
let _on = null;
function ORGAN_NORMAL() {
  if (_on) return _on;
  _on = toTex(heightToNormal(256, (u, v) => fbm(u * 10, v * 10, 10, 4, 3) + Math.abs(Math.sin(u * 40 + fbm(u * 4, v * 4, 4, 3, 8) * 8)) * 0.15, 4));
  return _on;
}

// ───────── 뼈 (엑스레이) ─────────
function tube(a, b, r, seg = 10) {
  const d = new V().subVectors(b, a), L = d.length();
  const g = new THREE.CylinderGeometry(r, r, L, seg, 1);
  g.translate(0, L / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}
function ball(c, r) { const g = new THREE.SphereGeometry(1, 16, 12); g.scale(r[0] ?? r, r[1] ?? r, r[2] ?? r); g.translate(c.x, c.y, c.z); return g; }
function bone(a, b, r) { return mergeGeometries([tube(a, b, r), ball(a, r * 1.7), ball(b, r * 1.6)]); }
function curveTube(pts, r) { return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 6, r, 6, false); }
const nx = g => { g.deleteAttribute('uv'); return g; };
const M = (...gs) => mergeGeometries(gs.map(g => nx(g.index ? g.toNonIndexed() : g)));

export function skeletonGeometries(R) {
  const out = {};
  const head = R.head;
  // 두개골 + 턱
  const sk = ball(new V(head.x, head.y + 0.012, head.z - 0.005), [0.07, 0.092, 0.092]);
  const jaw = new THREE.TorusGeometry(0.048, 0.008, 8, 20, Math.PI); jaw.rotateX(Math.PI / 2); jaw.scale(1, 1, 1.15); jaw.translate(head.x, head.y - 0.07, head.z + 0.02);
  out.head = M(sk, jaw, ball(new V(head.x, head.y - 0.03, head.z + 0.065), [0.03, 0.02, 0.015]));
  // 척추
  const spine = { pelvis: [], belly: [], chest: [], neck: [] };
  for (let i = 0; i < 24; i++) {
    const y = 0.93 + i * 0.0295, z = -0.07 + 0.012 * Math.sin((y - 0.9) * 6) + (y > 1.48 ? 0.03 * (y - 1.48) / 0.15 : 0);
    const g = tube(new V(0, y - 0.011, z), new V(0, y + 0.011, z), y > 1.48 ? 0.011 : 0.016, 10);
    const sp = tube(new V(0, y, z - 0.012), new V(0, y - 0.01, z - 0.035), 0.004, 6);
    (y < 1.04 ? spine.pelvis : y < 1.22 ? spine.belly : y < 1.49 ? spine.chest : spine.neck).push(g, sp);
  }
  // 갈비뼈 + 흉골 + 빗장뼈 + 견갑골
  const ribs = [];
  for (let i = 0; i < 10; i++) {
    const y = 1.425 - i * 0.027, w = 0.1 + Math.sin(Math.min(1, i / 5) * Math.PI / 2) * 0.045, d = 0.085 + Math.min(i, 5) * 0.004;
    for (const s of [1, -1]) {
      const pts = []; for (let k = 0; k <= 8; k++) { const a = -Math.PI / 2 + k / 8 * Math.PI * (i > 7 ? 0.75 : 1); pts.push(new V(s * Math.cos(a) * w, y - k * 0.006, -0.065 + (Math.sin(a) + 1) / 2 * (d + 0.065) - 0.01)); }
      ribs.push(curveTube(pts, 0.0055));
    }
  }
  ribs.push(tube(new V(0, 1.24, 0.1), new V(0, 1.42, 0.09), 0.012));
  for (const s of [1, -1]) {
    ribs.push(curveTube([new V(s * 0.015, 1.44, 0.085), new V(s * 0.08, 1.455, 0.06), new V(s * 0.16, 1.455, 0.0)], 0.007));
    const sc = new THREE.CircleGeometry(0.06, 3); sc.rotateY(Math.PI); sc.rotateZ(Math.PI / 2 + s * 0.2); sc.translate(s * 0.1, 1.37, -0.095); ribs.push(sc);
  }
  out.chest = M(...ribs, ...spine.chest);
  out.belly = M(...spine.belly);
  out.neck = M(...spine.neck);
  // 골반
  const pel = [...spine.pelvis];
  for (const s of [1, -1]) { const w = ball(new V(s * 0.09, 0.99, -0.02), [0.055, 0.06, 0.02]); w.rotateY(0); pel.push(w, curveTube([new V(s * 0.06, 0.92, -0.05), new V(s * 0.09, 0.9, 0.0), new V(s * 0.04, 0.87, 0.05), new V(0, 0.87, 0.06)], 0.012)); }
  out.pelvis = M(...pel);
  // 다리
  for (const [s, k] of [[1, 'L'], [-1, 'R']]) {
    const hip = new V(s * 0.092, 0.94, 0), kn = new V(s * 0.1, 0.515, 0.022), an = new V(s * 0.105, 0.085, -0.012);
    out['thigh' + k] = M(bone(hip.clone().add(new V(-s * 0.02, 0, 0)), kn, 0.014), ball(kn.clone().add(new V(0, 0, 0.04)), [0.02, 0.022, 0.008]));
    out['shin' + k] = M(bone(kn, an, 0.012), tube(kn.clone().add(new V(s * 0.025, -0.03, -0.01)), an.clone().add(new V(s * 0.022, 0, -0.005)), 0.006));
    const ft = [ball(new V(s * 0.105, 0.05, -0.04), [0.025, 0.025, 0.035])];
    for (let t = 0; t < 5; t++) ft.push(bone(new V(s * (0.09 + t * 0.008), 0.045, 0.0), new V(s * (0.08 + t * 0.016), 0.02, 0.15 - t * 0.012), 0.005));
    out['foot' + k] = M(...ft);
  }
  return out;
}
export function armBoneGeometries(arm) {
  const J = arm.J, out = [];
  out[0] = M(bone(arm.S, arm.E, 0.012));
  const side = new V().crossVectors(new V().subVectors(arm.E, arm.W), arm.U).normalize().multiplyScalar(0.012);
  out[1] = M(bone(arm.E.clone().add(side), arm.W.clone().add(side), 0.007), bone(arm.E.clone().sub(side), arm.W.clone().sub(side), 0.008));
  const hb = [ball(J[0].clone().lerp(J[9], 0.15), [0.022, 0.012, 0.016])];
  for (const m of [1, 5, 9, 13, 17]) hb.push(bone(J[0].clone().lerp(J[m], 0.2), m === 1 ? J[2] : J[m], 0.0045));
  out[2] = M(...hb);
  const CH = [[2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
  for (let f = 0; f < 5; f++) for (let k = 0; k < 3; k++) {
    const c = f === 0 ? [1, 2, 3, 4] : CH[f];
    out[3 + f * 3 + k] = f === 0 && k === 0 ? null : M(bone(J[c[k]], J[c[k + 1]], 0.0038));
  }
  return out;
}
// ───────── 근육 (엑스레이) ─────────
function spindle(a, b, r, off = new V()) {
  const g = new THREE.SphereGeometry(1, 16, 12); const d = new V().subVectors(b, a); const L = d.length();
  g.scale(r[0], L / 2, r[1]);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V(0, 1, 0), d.normalize()));
  g.translate((a.x + b.x) / 2 + off.x, (a.y + b.y) / 2 + off.y, (a.z + b.z) / 2 + off.z);
  return nx(g);
}
export function muscleGeometries() {
  const out = {};
  const chest = [], belly = [], pelvis = [], neck = [];
  for (const s of [1, -1]) {
    chest.push(spindle(new V(s * 0.02, 1.36, 0.1), new V(s * 0.15, 1.4, 0.06), [0.06, 0.02]));          // 큰가슴근
    chest.push(spindle(new V(s * 0.06, 1.47, -0.05), new V(s * 0.16, 1.45, -0.03), [0.03, 0.025]));     // 승모근
    chest.push(spindle(new V(s * 0.08, 1.38, -0.09), new V(s * 0.11, 1.18, -0.07), [0.04, 0.02]));     // 넓은등근
    for (let i = 0; i < 3; i++) belly.push(spindle(new V(s * 0.035, 1.24 - i * 0.065, 0.1), new V(s * 0.035, 1.19 - i * 0.065, 0.1), [0.03, 0.012])); // 복직근
    belly.push(spindle(new V(s * 0.12, 1.2, 0.03), new V(s * 0.13, 1.03, 0.05), [0.03, 0.02]));         // 외복사근
    pelvis.push(spindle(new V(s * 0.09, 1.0, -0.08), new V(s * 0.095, 0.86, -0.08), [0.065, 0.045]));   // 엉덩이근
    neck.push(spindle(new V(s * 0.04, 1.62, 0.0), new V(s * 0.02, 1.5, 0.05), [0.012, 0.012]));
    const k = s > 0 ? 'L' : 'R', hip = new V(s * 0.095, 0.94, 0), kn = new V(s * 0.1, 0.515, 0.022), an = new V(s * 0.105, 0.085, -0.012);
    out['thigh' + k] = mergeGeometries([spindle(hip, kn, [0.05, 0.04], new V(0, 0, 0.03)), spindle(hip, kn, [0.045, 0.035], new V(0, 0, -0.035)), spindle(hip, kn, [0.025, 0.02], new V(-s * 0.04, 0, 0))]);
    out['shin' + k] = mergeGeometries([spindle(kn.clone().add(new V(0, -0.05, 0)), an.clone().add(new V(0, 0.15, 0)), [0.04, 0.035], new V(0, 0, -0.03)), spindle(kn, an, [0.015, 0.015], new V(s * 0.015, 0, 0.02))]);
  }
  out.chest = mergeGeometries(chest); out.belly = mergeGeometries(belly); out.pelvis = mergeGeometries(pelvis); out.neck = mergeGeometries(neck);
  return out;
}
export function armMuscleGeometries(arm) {
  const S = arm.S, E = arm.E, W = arm.W;
  const ant = new V().subVectors(W, E); const ax = new V().subVectors(E, S).normalize(); ant.addScaledVector(ax, -ant.dot(ax)).normalize();
  const fax = new V().subVectors(W, E).normalize(), side = new V().crossVectors(fax, ant).normalize();
  return [
    mergeGeometries([spindle(S.clone().lerp(E, 0.15), E, [0.028, 0.028], ant.clone().multiplyScalar(0.022)), spindle(S, E, [0.03, 0.03], ant.clone().multiplyScalar(-0.022)), spindle(S.clone().add(new V(0, 0.03, 0)), S.clone().lerp(E, 0.4), [0.045, 0.04])]),
    mergeGeometries([spindle(E, E.clone().lerp(W, 0.85), [0.026, 0.02], side.clone().multiplyScalar(0.012)), spindle(E, E.clone().lerp(W, 0.8), [0.024, 0.02], side.clone().multiplyScalar(-0.012))]),
  ];
}
