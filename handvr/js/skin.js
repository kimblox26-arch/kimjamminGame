// 피부·손톱·옷감 재질
//  - 피부 셰이더(MeshPhysicalMaterial 패치)
//    · SSS 근사: 빛이 살 속에서 퍼져 명암 경계가 붉고 부드러움 + 역광일 때 손가락이 붉게 비침
//    · 미세 요철(범프): 모공, 손등 마디 주름, 손바닥 쪽 마디 금 — 텍스처 대신 바인드 좌표에서 계산하므로
//      손가락을 굽혀도 피부에 붙어서 같이 움직이고, UV 이음매가 없다
//    · 손가락 굵기 보정(girth): 스캔한 내 손가락 굵기에 맞게 뼈 축 기준으로만 살을 넓히거나 좁힘
//  - 손톱 / 소매 질감은 캔버스로 그린다 (이미지 파일 없음)
import * as THREE from 'three';

let seed = 1337;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const R = (a, b) => a + rnd() * (b - a);

function canvas(w, h, fill) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (fill) { g.fillStyle = fill; g.fillRect(0, 0, w, h); }
  return [c, g];
}

// 높이맵(회색) → 노멀맵
function toNormal(hc, strength) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const [out, og] = canvas(w, h);
  const img = og.createImageData(w, h), d = img.data;
  const H = (x, y) => src[((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = (-dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  return out;
}

function tex(c, srgb, repeat) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  return t;
}

// 손톱: v=0 뿌리(반달) → v=1 끝(하얀 자유연), 세로 결
export function nailTexture() {
  const W = 64, H = 128, [c, g] = canvas(W, H, '#f1c9c1');
  for (let i = 0; i < 18; i++) { g.strokeStyle = `rgba(255,255,255,${R(0.04, 0.1)})`; g.lineWidth = R(1, 2); const x = R(0, W); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + R(-2, 2), H); g.stroke(); }
  const lun = g.createRadialGradient(W / 2, H + 6, 4, W / 2, H + 6, 34);
  lun.addColorStop(0, 'rgba(255,246,242,0.95)'); lun.addColorStop(0.75, 'rgba(255,244,238,0.6)'); lun.addColorStop(1, 'rgba(255,244,238,0)');
  g.fillStyle = lun; g.fillRect(0, H - 40, W, 40);
  g.fillStyle = 'rgba(200,130,120,0.4)'; g.fillRect(0, 18, W, 3);
  const edge = g.createLinearGradient(0, 0, 0, 20);
  edge.addColorStop(0, 'rgba(255,252,248,1)'); edge.addColorStop(1, 'rgba(250,243,236,0.95)');
  g.fillStyle = edge; g.fillRect(0, 0, W, 19);
  return tex(c, true);
}

// 니트 소매 결
export function fabricNormal() {
  const [hc, hg] = canvas(128, 128, '#808080');
  for (let x = 0; x < 128; x += 8) { hg.fillStyle = 'rgba(255,255,255,0.35)'; hg.fillRect(x, 0, 4, 128); }
  for (let i = 0; i < 1500; i++) { hg.fillStyle = `rgba(${rnd() < 0.5 ? 40 : 220},0,0,0.15)`; hg.fillRect(R(0, 128), R(0, 128), 1, 2); }
  return tex(toNormal(hc, 3), false, true);
}

// ── 피부 셰이더 패치
export const SSS = {
  sssColor: { value: new THREE.Color(1.0, 0.32, 0.2) },
  sssWrap: { value: 0.5 },
  sssTrans: { value: 1.8 },
};
const DIRECT = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

const VERT_PARS = /* glsl */`
attribute float thin;
varying float vThin;
#if defined( SKIN_DETAIL ) || defined( SKIN_GIRTH )
attribute float fingerId;
#endif
#ifdef SKIN_DETAIL
attribute vec4 kn;
attribute float palmW;
varying vec4 vKn;
varying vec3 vBind;
varying float vPalmW;
varying float vFingerId;
#endif
#ifdef SKIN_GIRTH
attribute vec4 girthData;
uniform float girth[ 5 ];
#endif`;
const VERT_MAIN = /* glsl */`
vThin = thin;
#ifdef SKIN_DETAIL
vKn = kn;
vBind = position;
vPalmW = palmW;
vFingerId = fingerId;
#endif
#ifdef SKIN_GIRTH
transformed += girthData.xyz * ( girth[ int( fingerId + 0.5 ) ] - 1.0 ) * girthData.w;
#endif`;

const FRAG_PARS = /* glsl */`
uniform vec3 sssColor;
uniform float sssWrap;
uniform float sssTrans;
varying float vThin;
void skinSSS( const in IncidentLight dl, const in vec3 n, const in vec3 v, const in PhysicalMaterial mat, inout ReflectedLight rl ) {
  float ndl = dot( n, dl.direction );
  float wrapped = max( 0.0, ( ndl + sssWrap ) / ( 1.0 + sssWrap ) );
  float scatter = max( wrapped - max( ndl, 0.0 ), 0.0 );
  vec3 bh = normalize( dl.direction + n * 0.3 );
  float trans = pow( saturate( dot( v, -bh ) ), 4.0 ) * sssTrans * vThin;
  rl.directDiffuse += dl.color * mat.diffuseColor * sssColor * ( scatter + trans ) * RECIPROCAL_PI;
}
#ifdef SKIN_DETAIL
varying vec4 vKn;
varying vec3 vBind;
varying float vPalmW;
varying float vFingerId;
uniform vec3 palmO;
uniform vec3 palmX;
uniform vec3 palmY;
uniform float palmLen;
uniform vec3 wrinkS[ 5 ];
uniform vec3 creaseS[ 5 ];
// 손금: 손바닥 좌표(x 새끼→검지 뿌리, y 손목→중지 뿌리)의 꺾은선까지 거리
float segD( vec2 p, vec2 a, vec2 b ) { vec2 pa = p - a, ba = b - a; return length( pa - ba * clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 ) ); }
float lineD( vec2 p, vec2 a, vec2 b, vec2 c, vec2 d ) { return min( segD( p, a, b ), min( segD( p, b, c ), segD( p, c, d ) ) ); }
float palmLines() {
  vec3 q = vBind - palmO;
  vec2 p = vec2( dot( q, palmX ), dot( q, palmY ) );
  float heart = lineD( p, vec2( -0.12, 0.72 ), vec2( 0.3, 0.69 ), vec2( 0.62, 0.78 ), vec2( 0.82, 0.93 ) );
  float head = lineD( p, vec2( 1.12, 0.66 ), vec2( 0.75, 0.57 ), vec2( 0.4, 0.51 ), vec2( 0.1, 0.44 ) );
  float life = lineD( p, vec2( 1.1, 0.64 ), vec2( 0.9, 0.47 ), vec2( 0.82, 0.27 ), vec2( 0.86, 0.04 ) );
  float wrist = abs( p.y - 0.035 ) + max( 0.0, abs( p.x - 0.5 ) - 0.55 );
  float dm = min( min( heart, head ), life ) * palmLen, dw = wrist * palmLen;
  return exp( -dm * dm / 1.0e-6 ) * 0.00034 + exp( -dw * dw / 6.0e-7 ) * 0.00015;
}
// 손등 힘줄 4줄: 손목 가운데에서 부채꼴로 퍼져 각 손가락 뿌리 마디로 (볼록한 띠)
float tendons() {
  vec3 q = vBind - palmO;
  vec2 p = vec2( dot( q, palmX ), dot( q, palmY ) );
  float d = min( min( segD( p, vec2( 0.62, 0.1 ), vec2( 0.95, 0.97 ) ), segD( p, vec2( 0.53, 0.1 ), vec2( 0.67, 0.99 ) ) ),
                 min( segD( p, vec2( 0.45, 0.1 ), vec2( 0.37, 0.97 ) ), segD( p, vec2( 0.38, 0.12 ), vec2( 0.07, 0.93 ) ) ) ) * palmLen;
  float fade = smoothstep( 0.08, 0.3, p.y ) * ( 1.0 - smoothstep( 0.9, 1.05, p.y ) );
  return exp( -d * d / 5.0e-6 ) * 0.0004 * fade;
}
float skHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float skNoise( vec3 x ) {
  vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( skHash( i ), skHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( skHash( i + vec3( 0, 1, 0 ) ), skHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( skHash( i + vec3( 0, 0, 1 ) ), skHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( skHash( i + vec3( 0, 1, 1 ) ), skHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
// 피부 표면 높이(m): 모공 + 손등 마디 주름(여러 줄) + 손바닥 쪽 마디 금(한 줄 골)
float skinHeight() {
  float fw = length( fwidth( vBind ) );                    // 픽셀 하나가 덮는 크기 — 너무 작은 무늬는 깜빡이므로 생략
  float fine = 1.0 - smoothstep( 0.00035, 0.001, fw );
  float mid = 1.0 - smoothstep( 0.0008, 0.002, fw );
  float h = ( skNoise( vBind * 1500.0 ) - 0.5 ) * 0.00004 * fine + ( skNoise( vBind * 380.0 ) - 0.5 ) * 0.00006 * mid;
  // 손가락 길이 좌표(vKn.x) 기준: 손등 마디 주름(관절 중심 ±4mm, 줄마다 깊이·간격 조금씩 다르게) + 손바닥 쪽 마디 금
  int fi = int( clamp( vFingerId + 0.5, 0.0, 4.0 ) );
  vec3 ws = wrinkS[ fi ], cs = creaseS[ fi ];
  vec3 ww = fi == 0 ? vec3( 0.0, 0.6, 0.9 ) : vec3( 0.25, 1.0, 0.7 );
  vec3 cw = fi == 0 ? vec3( 0.0, 1.0, 0.9 ) : vec3( 0.9, 1.0, 0.8 );
  float wob = skNoise( vBind * 700.0 );
  for ( int k = 0; k < 3; k++ ) {
    float a = vKn.x - ws[ k ];
    h += vKn.y * ww[ k ] * exp( -a * a / 1.3e-5 ) * sin( a * 3000.0 + wob * 2.5 ) * ( 0.4 + 0.6 * wob ) * 0.0001 * mid;
    float b = vKn.x - cs[ k ];
    h -= vKn.z * cw[ k ] * exp( -b * b / 2.4e-6 ) * 0.00026 * mid;
  }
  h -= vPalmW * palmLines() * mid;
  h += vKn.w * tendons() * mid;
  return h;
}
vec3 skinPerturb( vec3 pos, vec3 n, vec2 dH, float fd ) {
  vec3 sx = normalize( dFdx( pos ) ), sy = normalize( dFdy( pos ) );
  vec3 r1 = cross( sy, n ), r2 = cross( n, sx );
  float det = dot( sx, r1 ) * fd;
  return normalize( abs( det ) * n - sign( det ) * ( dH.x * r1 + dH.y * r2 ) );
}
#endif`;
const FRAG_NORMAL = /* glsl */`
#ifdef SKIN_DETAIL
{
  float hh = skinHeight();
  vec2 dH = vec2( dFdx( hh ) / max( length( dFdx( vViewPosition ) ), 1e-7 ), dFdy( hh ) / max( length( dFdy( vViewPosition ) ), 1e-7 ) );
  normal = skinPerturb( -vViewPosition, normal, clamp( dH, -0.8, 0.8 ), faceDirection );
}
#endif`;

// opts.detail: 미세 요철 사용, opts.girth: Float32Array(5) 손가락 굵기 배율 (참조로 실시간 반영)
export function makeSkin({ detail = false, girth = null, ...opts } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    roughness: 0.56, metalness: 0, specularIntensity: 0.5, ior: 1.42,
    sheen: 0.15, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffb0a0),
    clearcoat: 0.08, clearcoatRoughness: 0.4,
    ...opts,
  });
  m.defines = { ...(detail ? { SKIN_DETAIL: '' } : {}), ...(girth ? { SKIN_GIRTH: '' } : {}) };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, SSS);
    if (girth) sh.uniforms.girth = { value: girth };
    Object.assign(sh.uniforms, m.userData.palm ?? { palmO: { value: new THREE.Vector3() }, palmX: { value: new THREE.Vector3() }, palmY: { value: new THREE.Vector3() }, palmLen: { value: 0.09 } });
    const far = () => Array.from({ length: 5 }, () => new THREE.Vector3(-1, -1, -1));
    Object.assign(sh.uniforms, m.userData.fold ?? { wrinkS: { value: far() }, creaseS: { value: far() } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + FRAG_PARS)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_NORMAL)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replaceAll(DIRECT,
        DIRECT + '\n\t\tskinSSS( directLight, geometryNormal, geometryViewDir, material, reflectedLight );'));
  };
  m.customProgramCacheKey = () => 'handvr-skin';
  return m;
}
