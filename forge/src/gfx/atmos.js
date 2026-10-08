// 대기 효과: 실내 간접광 차폐 · 작업장 빛줄기(갓레이) · 떠다니는 먼지 입자
import * as THREE from 'three';
import { fbm } from './textures.js';
import { mulberry } from '../core/util.js';

// 작업장 치수 (world.js workshop() 과 일치)
export const SHOP = { x: 16, z0: -24, z1: 0, eave: 8, ridge: 10.2, doorX: 7, doorH: 6.5, skyZ: [-18, -12, -6, 0], skyW: 1.6 };
const roofY = (x) => SHOP.eave + (SHOP.ridge - SHOP.eave) * (1 - Math.min(1, Math.abs(x) / SHOP.x));
// 빛줄기 적분 구간을 자르는 실내 AABB
const LO = new THREE.Vector3(-15.95, 0, -23.98), HI = new THREE.Vector3(15.95, 10.25, 0.05);

// ─── 1) 실내 간접광 차폐 ───
// 하늘 환경맵·반구광은 지붕과 벽에 가려지므로 작업장 안에서는 줄인다 (문 근처는 하늘이 보이므로 덜 줄임).
// 표준 재질 셰이더 청크를 전역 패치: 뷰 공간 위치 → 월드 위치 복원 후 해석적 실내 판정.
// USE_FOG 일 때만 (메인 씬만 안개가 있음 → 카탈로그 썸네일 등 다른 씬에는 영향 없음).
let patched = false;
export function installInteriorAmbient(amb = 0.3) {
  if (patched) return; patched = true;
  THREE.ShaderChunk.lights_fragment_maps += /* glsl */`
#if defined( USE_FOG ) && ( defined( RE_IndirectDiffuse ) || defined( RE_IndirectSpecular ) )
{
	vec3 fN = normalize( geometryNormal * mat3( viewMatrix ) );
	vec3 fP = geometryPosition * mat3( viewMatrix ) + cameraPosition + fN * 0.12;
	float fRoof = 8.1 + 2.2 * ( 1.0 - min( abs( fP.x ) / 16.0, 1.0 ) );
	float fIn = ( 1.0 - smoothstep( 16.05, 16.25, abs( fP.x ) ) ) * ( 1.0 - smoothstep( 0.1, 0.28, fP.z ) ) * smoothstep( -24.3, -24.12, fP.z ) * ( 1.0 - smoothstep( fRoof - 0.1, fRoof + 0.08, fP.y ) );
	float fDoor = smoothstep( -15.0, 0.5, fP.z ); fDoor *= fDoor * ( 1.0 - 0.55 * smoothstep( 5.0, 15.0, abs( fP.x ) ) );
	float fOcc = mix( 1.0, mix( ${amb.toFixed(3)}, 1.0, fDoor * 0.8 ), fIn );
	#if defined( RE_IndirectDiffuse )
	irradiance *= fOcc; iblIrradiance *= fOcc;
	#endif
	#if defined( RE_IndirectSpecular )
	radiance *= fOcc;
	#endif
}
#endif
`;
}

// 타일되는 노이즈 텍스처 (R: 빛줄기 줄무늬, G: 떠다니는 먼지 구름, B: 잔 결)
let _noise = null;
export function noiseTex() {
  if (_noise) return _noise;
  const N = 128, d = new Uint8Array(N * N * 4), rn = (v) => Math.max(0, Math.min(255, ((v - 0.28) / 0.44) * 255));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, k = (y * N + x) * 4;
    d[k] = rn(fbm(u, v, 6, 6, 4, 301)); d[k + 1] = rn(fbm(u, v, 3, 3, 4, 302)); d[k + 2] = rn(fbm(u, v, 16, 16, 3, 303)); d[k + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return (_noise = t);
}

// 빛줄기 부피 = 개구부(채광창 띠/문) 평행사변형을 빛 방향으로 밀어낸 평행육면체.
// M: 빔 공간(a,b,t ∈ [0,1]³) → 월드. a,b = 개구부 면, t = 빛 진행 방향.
function beamDefs(sunDir) {
  const L = sunDir.clone().negate().normalize(), out = [];
  const add = (O, A, B, len, gain) => {
    const C = L.clone().multiplyScalar(len);
    if (A.dot(new THREE.Vector3().crossVectors(B, C)) < 0) { O = O.clone().add(A); A = A.clone().negate(); } // 오른손 좌표계 유지 (앞면 판정)
    const M = new THREE.Matrix4().makeBasis(A, B, C).setPosition(O);
    out.push({ M, inv: M.clone().invert(), size: new THREE.Vector4(A.length(), B.length(), C.length(), gain) });
  };
  for (const zc of SHOP.skyZ) for (const s of [-1, 1]) {
    const y0 = roofY(0) + 0.07, y1 = roofY(SHOP.x) + 0.07;
    add(new THREE.Vector3(0, y0, zc - SHOP.skyW / 2), new THREE.Vector3(s * SHOP.x, y1 - y0, 0), new THREE.Vector3(0, 0, SHOP.skyW), (y0 + 0.6) / -L.y, 1);
  }
  add(new THREE.Vector3(-SHOP.doorX, 0, 0), new THREE.Vector3(SHOP.doorX * 2, 0, 0), new THREE.Vector3(0, SHOP.doorH, 0), (SHOP.doorH + 0.6) / -L.y, 0.8);
  return out;
}

const SHADOW_GLSL = /* glsl */`
uniform sampler2D uShadow; uniform mat4 uShadowM; uniform float uShadowOn;
float sunVis( vec3 p ) {
	if ( uShadowOn < 0.5 ) return 1.0;
	vec4 sc = uShadowM * vec4( p, 1.0 ); sc.xyz /= sc.w;
	if ( any( lessThan( sc.xyz, vec3( 0.0 ) ) ) || any( greaterThan( sc.xyz, vec3( 1.0 ) ) ) ) return 1.0;
	return step( sc.z - 0.0005, unpackRGBAToDepth( texture2D( uShadow, sc.xy ) ) );
}`;

// ─── 2) 빛줄기 (medium 이상) ───
// 부피의 앞면만 그려서 픽셀마다 광선-평행육면체 교차 구간을 해석적으로 구하고 몇 단계 적분.
// 실내 AABB(바닥·벽)로 구간을 자르고, high 이상은 태양 그림자맵을 샘플해 서까래·크레인이 빛을 가리게 함.
export class LightShafts {
  constructor(scene, sun, sunDir, { steps = 8, shadow = false } = {}) {
    this.sun = sun;
    const defs = beamDefs(sunDir), geos = [];
    for (const d of defs) {
      const g = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5).applyMatrix4(d.M);
      g.deleteAttribute('normal'); g.deleteAttribute('uv');
      const n = g.attributes.position.count, e = d.inv.elements;
      const rows = [0, 1, 2].map((r) => new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => e[(i % 4) * 4 + r]), 4));
      g.setAttribute('r0', rows[0]); g.setAttribute('r1', rows[1]); g.setAttribute('r2', rows[2]);
      g.setAttribute('sz', new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => d.size.getComponent(i % 4)), 4));
      geos.push(g);
    }
    const geo = mergeSimple(geos);
    this.u = {
      uTime: { value: 0 }, uGain: { value: 0.011 }, uColor: { value: new THREE.Color() }, uL: { value: sunDir.clone().negate().normalize() },
      uNoise: { value: noiseTex() }, uLo: { value: LO }, uHi: { value: HI },
      uShadow: { value: null }, uShadowM: { value: sun.shadow.matrix }, uShadowOn: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, defines: { STEPS: steps, ...(shadow ? { SHADOW: 1 } : {}) },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.FrontSide, fog: false,
      vertexShader: /* glsl */`
        attribute vec4 r0; attribute vec4 r1; attribute vec4 r2; attribute vec4 sz;
        varying vec3 vW; varying vec4 vR0; varying vec4 vR1; varying vec4 vR2; varying vec4 vSz;
        void main() {
          vec4 w = modelMatrix * vec4( position, 1.0 ); vW = w.xyz; vR0 = r0; vR1 = r1; vR2 = r2; vSz = sz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        #include <packing>
        uniform float uTime; uniform float uGain; uniform vec3 uColor; uniform vec3 uL; uniform sampler2D uNoise; uniform vec3 uLo; uniform vec3 uHi;
        #ifdef SHADOW
        ${SHADOW_GLSL}
        #endif
        varying vec3 vW; varying vec4 vR0; varying vec4 vR1; varying vec4 vR2; varying vec4 vSz;
        vec3 toB( vec3 p ) { return vec3( dot( vR0.xyz, p ) + vR0.w, dot( vR1.xyz, p ) + vR1.w, dot( vR2.xyz, p ) + vR2.w ); }
        vec3 dirB( vec3 d ) { return vec3( dot( vR0.xyz, d ), dot( vR1.xyz, d ), dot( vR2.xyz, d ) ); }
        vec2 slab( vec3 o, vec3 d, vec3 lo, vec3 hi ) {
          d = mix( d, vec3( 1e-6 ), step( abs( d ), vec3( 1e-6 ) ) );
          vec3 a = ( lo - o ) / d, b = ( hi - o ) / d, mn = min( a, b ), mx = max( a, b );
          return vec2( max( max( mn.x, mn.y ), mn.z ), min( min( mx.x, mx.y ), mx.z ) );
        }
        float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
        void main() {
          if ( any( lessThan( vW, uLo - 0.08 ) ) || any( greaterThan( vW, uHi + 0.08 ) ) ) discard; // 외벽 바깥에서 빛나지 않게
          vec3 ro = cameraPosition, rd = vW - ro;
          vec2 sb = slab( toB( ro ), dirB( rd ), vec3( 0.0 ), vec3( 1.0 ) ), sw = slab( ro, rd, uLo, uHi );
          float s0 = max( max( sb.x, sw.x ), 0.0 ), s1 = min( sb.y, sw.y );
          if ( s1 <= s0 ) discard;
          float len = length( rd ), seg = ( s1 - s0 ) * len;
          float cosT = dot( rd / len, -uL ), g = 0.55;
          float ph = mix( 1.0, ( 1.0 - g * g ) / pow( 1.0 + g * g - 2.0 * g * cosT, 1.5 ), 0.55 ); // 전방 산란 (해를 바라볼 때 밝음)
          float j = ign( gl_FragCoord.xy ), acc = 0.0;
          for ( int i = 0; i < STEPS; i ++ ) {
            float s = mix( s0, s1, ( float( i ) + j ) / float( STEPS ) );
            vec3 p = ro + rd * s, b = toB( p );
            vec2 m = b.xy * vSz.xy;
            float e = smoothstep( 0.0, 0.4, m.x ) * ( 1.0 - smoothstep( vSz.x - 0.4, vSz.x, m.x ) ) * smoothstep( 0.0, 0.32, m.y ) * ( 1.0 - smoothstep( vSz.y - 0.32, vSz.y, m.y ) );
            float f = smoothstep( 0.0, 0.06, b.z ) * smoothstep( -0.4, 2.2, p.y );
            float n = texture2D( uNoise, m * 0.11 + vec2( uTime * 0.011, 0.0 ) ).r * 0.65 + texture2D( uNoise, m * 0.43 + vec2( - uTime * 0.017, uTime * 0.008 ) ).b * 0.35;
            n = 0.25 + 1.5 * n * n;
            float cl = texture2D( uNoise, p.xz * 0.045 + p.y * 0.021 + uTime * vec2( 0.0031, 0.0017 ) ).g;
            float v = e * f * n * ( 0.55 + cl * 0.9 );
            #ifdef SHADOW
            v *= sunVis( p );
            #endif
            acc += v;
          }
          acc *= seg / float( STEPS );
          vec3 oc = toB( ro ), q = max( max( - oc, oc - 1.0 ), 0.0 ) * vSz.xyz;
          float fc = smoothstep( 0.25, 2.2, length( q ) ); // 카메라가 빔 안/근처면 흐리게
          gl_FragColor = vec4( uColor * ( acc * uGain * vSz.w * ph * fc ), 1.0 );
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat); this.mesh.frustumCulled = false; this.mesh.castShadow = this.mesh.receiveShadow = false; this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }
  update(t, cam) {
    const u = this.u, sm = this.sun.shadow.map;
    u.uTime.value = t; u.uShadow.value = sm ? sm.texture : null; u.uShadowOn.value = sm ? 1 : 0;
    u.uColor.value.copy(this.sun.color).multiplyScalar(this.sun.intensity);
    // 작업장에서 멀면 그리지 않음
    const dx = Math.max(Math.abs(cam.x) - 16, 0), dz = Math.max(cam.z - 0, -24 - cam.z, 0);
    this.mesh.visible = Math.hypot(dx, dz) < 70;
  }
  dispose() { this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

// ─── 3) 떠다니는 먼지 (medium 이상) ───
// 카메라를 따라 반복되는 10 m 셀 안의 입자들. 위치는 셰이더에서 컬(curl) 형태 흐름으로 이동,
// 빛줄기 안(해석적 판정 + high 이상 그림자맵)일 때만 반짝이고 그늘에서는 거의 보이지 않음.
export class DustMotes {
  constructor(scene, sun, sunDir, { count = 2000, shadow = false } = {}) {
    this.sun = sun;
    const defs = beamDefs(sunDir), NB = defs.length, R = mulberry(77);
    const seed = new Float32Array(count * 4); for (let i = 0; i < seed.length; i++) seed[i] = R();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 4));
    const rows = (r) => defs.map((d) => { const e = d.inv.elements; return new THREE.Vector4(e[r], e[4 + r], e[8 + r], e[12 + r]); });
    this.u = {
      uTime: { value: 0 }, uScale: { value: 800 }, uCell: { value: 10 }, uSize: { value: 0.0045 }, uColor: { value: new THREE.Color() },
      uB0: { value: rows(0) }, uB1: { value: rows(1) }, uB2: { value: rows(2) }, uBS: { value: defs.map((d) => d.size.clone()) },
      uShadow: { value: null }, uShadowM: { value: sun.shadow.matrix }, uShadowOn: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u, defines: { NB, ...(shadow ? { SHADOW: 1 } : {}) },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: /* glsl */`
        #include <packing>
        attribute vec4 seed;
        uniform float uTime; uniform float uScale; uniform float uCell; uniform float uSize; uniform vec3 uColor;
        uniform vec4 uB0[ NB ]; uniform vec4 uB1[ NB ]; uniform vec4 uB2[ NB ]; uniform vec4 uBS[ NB ];
        #ifdef SHADOW
        ${SHADOW_GLSL}
        #endif
        varying vec4 vC;
        void main() {
          vec3 p = seed.xyz * uCell;
          p.y -= uTime * ( 0.004 + 0.012 * seed.w ); // 천천히 가라앉음
          float t = uTime * 0.11; vec3 a = p * 0.42;
          // 발산 없는(curl) 사인 흐름 두 겹
          p += 0.28 * vec3( cos( a.z * 1.3 + t ) - cos( a.y * 0.9 - t * 1.2 ), cos( a.x * 1.1 + t * 0.8 ) - cos( a.z * 0.7 + t * 1.4 ), cos( a.y * 1.2 - t * 1.1 ) - cos( a.x * 0.8 + t * 0.6 ) );
          p += 0.06 * sin( vec3( a.y, a.z, a.x ) * 5.0 + uTime * ( 0.6 + seed.w ) );
          p += uCell * floor( ( cameraPosition - p ) / uCell + 0.5 ); // 카메라 주변으로 반복
          float inside = step( -15.85, p.x ) * step( p.x, 15.85 ) * step( 0.03, p.y ) * step( p.y, 9.6 ) * step( - 23.9, p.z ) * step( p.z, - 0.05 );
          float lit = 0.0;
          for ( int i = 0; i < NB; i ++ ) {
            vec3 b = vec3( dot( uB0[ i ].xyz, p ) + uB0[ i ].w, dot( uB1[ i ].xyz, p ) + uB1[ i ].w, dot( uB2[ i ].xyz, p ) + uB2[ i ].w );
            vec3 m = b * uBS[ i ].xyz;
            float e = smoothstep( 0.0, 0.25, m.x ) * ( 1.0 - smoothstep( uBS[ i ].x - 0.25, uBS[ i ].x, m.x ) ) * smoothstep( 0.0, 0.2, m.y ) * ( 1.0 - smoothstep( uBS[ i ].y - 0.2, uBS[ i ].y, m.y ) ) * step( 0.0, b.z ) * step( b.z, 1.0 );
            lit = max( lit, e );
          }
          #ifdef SHADOW
          if ( lit > 0.0 ) lit *= sunVis( p );
          #endif
          vec3 d = abs( p - cameraPosition );
          float fade = ( 1.0 - smoothstep( uCell * 0.34, uCell * 0.5, max( max( d.x, d.y ), d.z ) ) ) * smoothstep( 0.12, 0.5, length( d ) );
          float tw = 0.45 + 0.55 * pow( 0.5 + 0.5 * sin( uTime * ( 1.3 + seed.w * 3.7 ) + seed.x * 61.0 ), 3.0 ); // 회전하는 먼지의 반짝임
          vec4 mv = viewMatrix * vec4( p, 1.0 );
          gl_Position = projectionMatrix * mv;
          float px = uSize * ( 0.5 + seed.w ) * uScale / max( - mv.z, 0.05 );
          float cov = clamp( px / 1.5, 0.0, 1.0 );
          gl_PointSize = max( px, 1.5 );
          vC = vec4( uColor * ( lit * tw + 0.012 ), inside * fade * cov * cov );
        }`,
      fragmentShader: /* glsl */`
        varying vec4 vC;
        void main() {
          float r = length( gl_PointCoord - 0.5 );
          gl_FragColor = vec4( vC.rgb, vC.a * ( 1.0 - smoothstep( 0.15, 0.5, r ) ) );
        }`,
    });
    this.points = new THREE.Points(geo, mat); this.points.frustumCulled = false; this.points.renderOrder = 6;
    scene.add(this.points);
  }
  update(t, cam, camera, renderer) {
    const u = this.u, sm = this.sun.shadow.map;
    u.uTime.value = t; u.uShadow.value = sm ? sm.texture : null; u.uShadowOn.value = sm ? 1 : 0;
    u.uColor.value.copy(this.sun.color).multiplyScalar(this.sun.intensity * 0.55);
    u.uScale.value = renderer.getDrawingBufferSize(_v2).y / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const dx = Math.max(Math.abs(cam.x) - 16, 0), dz = Math.max(cam.z, -24 - cam.z, 0);
    this.points.visible = Math.hypot(dx, dz) < 6;
  }
  dispose() { this.points.parent?.remove(this.points); this.points.geometry.dispose(); this.points.material.dispose(); }
}
const _v2 = new THREE.Vector2();

// 같은 속성 구성의 비색인 지오메트리 병합 (BoxGeometry 는 색인 → 비색인으로 변환)
function mergeSimple(geos) {
  const parts = geos.map((g) => g.toNonIndexed()), out = new THREE.BufferGeometry();
  for (const name of Object.keys(parts[0].attributes)) {
    const isz = parts[0].attributes[name].itemSize, total = parts.reduce((s, g) => s + g.attributes[name].array.length, 0), arr = new Float32Array(total);
    let o = 0; for (const g of parts) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, isz));
  }
  return out;
}
