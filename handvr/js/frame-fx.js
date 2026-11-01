// 손가락 틀 필터 (Finger FX)
// 양손 엄지·검지를 펴고(나머지 손가락은 접고) 'ㄱ'·'ㄴ' 모양으로 사각 틀을 만들면, 틀 안에 카메라 영상을 필터로 보여 준다.
//  · 게임 화면: 화면 속 두 손 사이에 '창'이 생기고, 그 안에 실제 카메라 영상(손가락 끝 사이 부분)이 필터를 거쳐 보인다.
//    창은 손가락 끝보다 살짝 뒤에 있어서 손가락이 틀 앞을 가린다.
//  · AR 화면: 카메라 영상을 화면 가득(거울처럼) 보여 주고, 손가락 틀 안만 필터.
// 틀을 새로 만들 때마다 다음 필터로 바뀐다 (F 키·🎨 버튼으로도 바꿈). 인식이 잠깐 끊겨도 0.25초는 틀을 유지한다.
import * as THREE from 'three';

export const FILTERS = ['🔥 열화상', '🌙 야간 투시경', '🦴 엑스레이', '💥 만화', '👾 픽셀', '🌈 무지개'];

// 공통 필터 (sRGB 공간에서 계산). map: 카메라 영상, texel: 영상 한 픽셀 크기(uv)
const FX = /* glsl */`
uniform sampler2D map;
uniform vec2 texel;
uniform float time;
uniform int mode;
vec3 toSrgb( vec3 c ) { return pow( max( c, 0.0 ), vec3( 1.0 / 2.2 ) ); }
vec3 toLin( vec3 c ) { return pow( max( c, 0.0 ), vec3( 2.2 ) ); }
vec3 S( vec2 uv ) { return toSrgb( texture2D( map, clamp( uv, 0.0, 1.0 ) ).rgb ); }
float luma( vec3 c ) { return dot( c, vec3( 0.299, 0.587, 0.114 ) ); }
float hash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
// 소벨 경계 세기 (밝기 기준)
float edge( vec2 uv ) {
  vec2 d = texel * 1.5;
  float tl = luma( S( uv + vec2( -d.x, d.y ) ) ), t = luma( S( uv + vec2( 0.0, d.y ) ) ), tr = luma( S( uv + d ) );
  float l = luma( S( uv - vec2( d.x, 0.0 ) ) ), r = luma( S( uv + vec2( d.x, 0.0 ) ) );
  float bl = luma( S( uv - d ) ), b = luma( S( uv - vec2( 0.0, d.y ) ) ), br = luma( S( uv + vec2( d.x, -d.y ) ) );
  float gx = tr + 2.0 * r + br - tl - 2.0 * l - bl, gy = tl + 2.0 * t + tr - bl - 2.0 * b - br;
  return length( vec2( gx, gy ) );
}
// 열화상 색: 차가움(남색) → 하늘 → 초록 → 노랑 → 빨강 → 분홍(뜨거움)
vec3 heatColor( float t ) {
  t = clamp( t, 0.0, 1.0 ) * 5.0;
  vec3 c0 = vec3( 0.06, 0.04, 0.4 ), c1 = vec3( 0.0, 0.6, 1.0 ), c2 = vec3( 0.1, 0.95, 0.35 ), c3 = vec3( 1.0, 0.95, 0.1 ), c4 = vec3( 1.0, 0.25, 0.1 ), c5 = vec3( 1.0, 0.25, 0.95 );
  if ( t < 1.0 ) return mix( c0, c1, t );
  if ( t < 2.0 ) return mix( c1, c2, t - 1.0 );
  if ( t < 3.0 ) return mix( c2, c3, t - 2.0 );
  if ( t < 4.0 ) return mix( c3, c4, t - 3.0 );
  return mix( c4, c5, t - 4.0 );
}
vec3 hueShift( vec3 c, float a ) {
  const vec3 k = vec3( 0.57735 );
  float ca = cos( a );
  return c * ca + cross( k, c ) * sin( a ) + k * dot( k, c ) * ( 1.0 - ca );
}
vec3 fx( vec2 uv ) {
  if ( mode == 0 ) {
    // 열화상: 살(붉은 기)은 뜨겁게, 나머지는 밝기로. 열 카메라처럼 살짝 번지게
    vec2 d = texel * 3.0;
    vec3 c = ( S( uv ) * 4.0 + S( uv + vec2( d.x, 0.0 ) ) + S( uv - vec2( d.x, 0.0 ) ) + S( uv + vec2( 0.0, d.y ) ) + S( uv - vec2( 0.0, d.y ) ) ) / 8.0;
    float y = luma( c );
    float cr = 0.5 + 0.5 * c.r - 0.419 * c.g - 0.081 * c.b, cb = 0.5 - 0.169 * c.r - 0.331 * c.g + 0.5 * c.b;
    float skin = smoothstep( 0.515, 0.575, cr ) * ( 1.0 - smoothstep( 0.49, 0.55, cb ) ) * smoothstep( 0.12, 0.3, y );
    return heatColor( 0.08 + 0.66 * skin + 0.3 * ( y - 0.45 ) ); // 벽·옷은 차갑게(파랑), 사람 살은 뜨겁게(노랑~빨강)
  }
  if ( mode == 1 ) {
    // 야간 투시경: 초록, 밝게, 지글지글 노이즈 + 주사선
    float y = pow( clamp( luma( S( uv ) ) * 1.7, 0.0, 1.0 ), 0.8 );
    float n = hash( uv / texel + fract( time * 7.0 ) * 100.0 );
    float scan = 0.88 + 0.12 * sin( uv.y / texel.y * 1.6 );
    return vec3( 0.12, 1.0, 0.25 ) * y * scan + ( n - 0.5 ) * 0.12;
  }
  if ( mode == 2 ) {
    // 엑스레이: 밝기 반전 + 윤곽 강조, 푸르스름하게
    float y = 1.0 - luma( S( uv ) );
    float e = edge( uv );
    return vec3( 0.72, 0.88, 1.0 ) * clamp( y * 0.75 + e * 1.4, 0.0, 1.0 );
  }
  if ( mode == 3 ) {
    // 만화: 색을 4단계로 + 진한 테두리
    vec3 c = S( uv );
    c = floor( c * 4.0 + 0.5 ) / 4.0;
    c = clamp( mix( vec3( luma( c ) ), c, 1.5 ), 0.0, 1.0 );
    return c * ( 1.0 - smoothstep( 0.22, 0.4, edge( uv ) ) );
  }
  if ( mode == 4 ) {
    // 픽셀: 큰 네모 칸
    vec2 b = texel * 14.0;
    vec3 c = S( ( floor( uv / b ) + 0.5 ) * b );
    return floor( c * 6.0 + 0.5 ) / 6.0;
  }
  // 무지개: 색이 돌고, 빨강·파랑이 살짝 어긋남
  vec2 o = texel * vec2( 4.0, 0.0 );
  vec3 c = vec3( S( uv + o ).r, S( uv ).g, S( uv - o ).b );
  c = hueShift( c, time * 2.0 + uv.y * 6.0 );
  return clamp( mix( vec3( luma( c ) ), c, 1.8 ), 0.0, 1.0 );
}`;

const N = 8; // 창 메시를 N×N 칸으로 나눠서, 비스듬한 틀에서도 영상이 덜 일그러지게

export class FrameFX {
  // video: 카메라 영상, camera: 게임 카메라(손이 이 카메라에 붙어 있음), scene: 장면, onFilter(name): 필터가 바뀔 때
  constructor(video, camera, scene, onFilter) {
    this.video = video;
    this.camera = camera;
    this.onFilter = onFilter;
    this.tex = new THREE.VideoTexture(video);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mode = 0;
    this.ar = false;
    this.alpha = 0;     // 틀이 보이는 정도 (나타날 때·사라질 때 부드럽게)
    this.hold = 0;      // 인식이 끊겨도 잠깐 유지하는 남은 시간
    this.offAt = -1e9;
    this.shown = 0;     // 지금까지 틀을 만든 횟수
    this.uv = Array.from({ length: 4 }, () => new THREE.Vector2());  // 틀 꼭짓점: 카메라 영상 uv
    this.pos = Array.from({ length: 4 }, () => new THREE.Vector3()); // 틀 꼭짓점: 게임 카메라 공간
    this.tUv = this.uv.map(v => v.clone());
    this.tPos = this.pos.map(v => v.clone());
    const common = { map: { value: this.tex }, texel: { value: new THREE.Vector2(1 / 640, 1 / 480) }, time: { value: 0 }, mode: { value: 0 }, opacity: { value: 0 } };

    // 게임 화면용 창
    const g = new THREE.BufferGeometry();
    const n = (N + 1) * (N + 1), q = new Float32Array(n * 2), idx = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) q.set([i / N, j / N], (j * (N + 1) + i) * 2);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i; idx.push(a, a + 1, a + N + 2, a, a + N + 2, a + N + 1); }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    g.setAttribute('q', new THREE.BufferAttribute(q, 2));
    g.setIndex(idx);
    this.win = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { ...common },
      vertexShader: /* glsl */`
        attribute vec2 q;
        varying vec2 vUv; varying vec2 vQ;
        void main() { vUv = uv; vQ = q; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
      fragmentShader: /* glsl */`
        uniform float opacity;
        varying vec2 vUv; varying vec2 vQ;
        ${FX}
        void main() {
          vec3 c = fx( vUv );
          float e = min( min( vQ.x, 1.0 - vQ.x ), min( vQ.y, 1.0 - vQ.y ) );
          c = mix( c, vec3( 1.0 ), ( 1.0 - smoothstep( 0.0, 0.025, e ) ) * 0.85 ); // 빛나는 테두리
          gl_FragColor = vec4( toLin( c ), opacity );
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    }));
    this.win.frustumCulled = false;
    this.win.renderOrder = 10;
    this.win.visible = false;
    camera.add(this.win);

    // AR 화면용: 화면 가득 카메라 영상 + 틀 안만 필터
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { ...common, scale: { value: new THREE.Vector2(1, 1) }, C: { value: this.uv }, res: { value: new THREE.Vector2(640, 480) } },
      vertexShader: /* glsl */`
        varying vec2 vS;
        void main() { vS = uv; gl_Position = vec4( position.xy, 1.0, 1.0 ); }`,
      fragmentShader: /* glsl */`
        uniform float opacity;
        uniform vec2 scale;
        uniform vec2 C[ 4 ];
        uniform vec2 res;
        varying vec2 vS;
        ${FX}
        float side( vec2 a, vec2 b, vec2 p ) { vec2 e = ( b - a ) * res, w = ( p - a ) * res; return ( e.x * w.y - e.y * w.x ) / max( length( e ), 1e-4 ); }
        void main() {
          // 화면 → 카메라 영상 (비율 유지해서 꽉 채우기, 거울처럼 좌우 뒤집기)
          vec2 uv = vec2( 1.0 - ( 0.5 + ( vS.x - 0.5 ) * scale.x ), 0.5 + ( vS.y - 0.5 ) * scale.y );
          vec3 c = S( uv );
          if ( opacity > 0.001 ) {
            float d0 = side( C[ 0 ], C[ 1 ], uv ), d1 = side( C[ 1 ], C[ 2 ], uv ), d2 = side( C[ 2 ], C[ 3 ], uv ), d3 = side( C[ 3 ], C[ 0 ], uv );
            float s = sign( d0 + d1 + d2 + d3 );
            float d = min( min( d0 * s, d1 * s ), min( d2 * s, d3 * s ) ); // 틀 안쪽이면 +, 가장 가까운 변까지 영상 픽셀 거리
            if ( d > -3.0 ) {
              vec3 f = d > 0.0 ? fx( uv ) : c;
              f = mix( f, vec3( 1.0 ), 1.0 - smoothstep( 0.0, 3.0, abs( d ) ) ); // 빛나는 테두리
              c = mix( c, f, opacity );
            }
          }
          gl_FragColor = vec4( toLin( c ), 1.0 );
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false, toneMapped: false,
    }));
    this.bg.frustumCulled = false;
    this.bg.renderOrder = -1000;
    this.bg.visible = false;
    scene.add(this.bg);
    this.mats = [this.win.material, this.bg.material];
  }

  setAR(on) { this.ar = on; this.bg.visible = on; }

  next() {
    this.mode = (this.mode + 1) % FILTERS.length;
    this.onFilter?.(FILTERS[this.mode]);
  }

  // 손 하나가 'ㄱ' 모양인가: 엄지·검지 펴짐, 나머지 세 손가락은 펴지지 않음
  static isL(h) {
    const p = h.pose;
    return h.visible && !h.bridging && p && p.thumb.state === 'ext' && p.fingers[1].state === 'ext' && p.fingers.slice(2).every(f => f.state !== 'ext');
  }

  // hands: { L, R } HandState, rigs: { L, R } 손 모델 (게임 화면의 손가락 끝 위치), size: 화면 크기(px)
  update(dt, now, hands, rigs, size) {
    const v = this.video, vw = v.videoWidth || 640, vh = v.videoHeight || 480;
    for (const m of this.mats) {
      m.uniforms.time.value = now / 1000;
      m.uniforms.mode.value = this.mode;
      m.uniforms.texel.value.set(1 / vw, 1 / vh);
    }
    const sa = size.x / size.y, ia = vw / vh;
    this.bg.material.uniforms.scale.value.set(Math.min(1, sa / ia), Math.min(1, ia / sa));
    this.bg.material.uniforms.res.value.set(vw, vh);

    // ── 틀 찾기: 두 손 모두 'ㄱ' 모양이면 엄지 끝·검지 끝 4점이 틀의 꼭짓점
    let ok = !!(rigs && FrameFX.isL(hands.L) && FrameFX.isL(hands.R) && (this.ar || (rigs.L.group.visible && rigs.R.group.visible)));
    if (ok) {
      const pts = [];
      for (const s of ['L', 'R']) for (const [i, b] of [[4, 'thumb-tip'], [8, 'index-finger-tip']]) {
        const im = hands[s].img[i];
        const p = rigs[s].bone[b].getWorldPosition(new THREE.Vector3());
        this.camera.worldToLocal(p);
        p.multiplyScalar((p.length() + 0.015) / p.length()); // 손가락 끝보다 1.5cm 뒤 → 손가락이 틀 앞에
        pts.push({ x: 1 - im.x, y: im.y, uv: new THREE.Vector2(im.x, 1 - im.y), p });
      }
      // 화면(거울)에서 중심 둘레 각도 순서로 → 볼록한 사각형
      const cx = pts.reduce((a, q) => a + q.x, 0) / 4, cy = pts.reduce((a, q) => a + q.y, 0) / 4;
      pts.sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
      let area = 0, minSide = Infinity;
      for (let k = 0; k < 4; k++) {
        const a = pts[k], b = pts[(k + 1) % 4];
        area += (a.x * b.y - b.x * a.y) / 2;
        minSide = Math.min(minSide, Math.hypot((a.x - b.x) * ia, a.y - b.y));
      }
      ok = Math.abs(area) * ia > 0.01 && minSide > 0.06;
      if (ok) pts.forEach((q, k) => { this.tUv[k].copy(q.uv); this.tPos[k].copy(q.p); });
    }
    const wasOn = this.hold > 0;
    this.hold = ok ? 0.25 : this.hold - dt;
    const on = this.hold > 0;
    if (on && !wasOn) {
      // 새로 틀을 만들 때마다 다음 필터 (잠깐 끊겼다 다시 잡힌 건 제외)
      if (now - this.offAt > 600) { if (this.shown++) this.next(); else this.onFilter?.(FILTERS[this.mode]); }
      if (this.alpha < 0.05) { this.uv.forEach((u, k) => u.copy(this.tUv[k])); this.pos.forEach((p, k) => p.copy(this.tPos[k])); }
    }
    if (!on && wasOn) this.offAt = now;
    this.alpha += ((on ? 1 : 0) - this.alpha) * (1 - Math.exp(-dt * 10));
    const k = 1 - Math.exp(-dt * 25);
    this.uv.forEach((u, i) => u.lerp(this.tUv[i], k));
    this.pos.forEach((p, i) => p.lerp(this.tPos[i], k));
    for (const m of this.mats) m.uniforms.opacity.value = this.alpha;

    // 게임 화면의 창: 4 꼭짓점을 이은 격자 (위치·영상 좌표 모두 양선형 보간)
    this.win.visible = !this.ar && this.alpha > 0.01;
    if (this.win.visible) {
      const g = this.win.geometry, P = g.attributes.position, U = g.attributes.uv, [p0, p1, p2, p3] = this.pos, [u0, u1, u2, u3] = this.uv;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), ua = new THREE.Vector2(), ub = new THREE.Vector2();
      for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
        const s = i / N, t = j / N, n = j * (N + 1) + i;
        a.lerpVectors(p0, p1, s); b.lerpVectors(p3, p2, s); a.lerp(b, t); P.setXYZ(n, a.x, a.y, a.z);
        ua.lerpVectors(u0, u1, s); ub.lerpVectors(u3, u2, s); ua.lerp(ub, t); U.setXY(n, ua.x, ua.y);
      }
      P.needsUpdate = U.needsUpdate = true;
    }
  }
}
