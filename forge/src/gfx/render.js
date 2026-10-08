// 렌더러 + 후처리 (MSAA · GTAO 앰비언트 오클루전 · 블룸 · 톤매핑 · 시네마틱 그레이딩)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

// shafts: 빛줄기 적분 단계 수(0=끔) · shaftShadow: 빛줄기/먼지가 그림자맵을 샘플 · dust: 먼지 입자 수
// grass: 풀 포기 인스턴스 수 / grassR: 풀 반경(m) · cine: 0=끔, 1=비네트+그레이딩, 2=+필름 그레인+색수차
// hires: 512px 재질 텍스처를 1024px 로 생성 (로딩 시 적용)
export const QUALITY = {
  low: { name: '낮음', pr: 0.75, shadow: 1024, ao: false, bloom: false, msaa: 0, soft: false, shafts: 0, shaftShadow: false, dust: 0, grass: 0, grassR: 0, cine: 0, hires: false },
  medium: { name: '중간', pr: 1, shadow: 2048, ao: false, bloom: true, msaa: 4, soft: true, shafts: 6, shaftShadow: false, dust: 1800, grass: 0, grassR: 0, cine: 1, hires: false },
  high: { name: '높음', pr: 1.25, shadow: 2048, ao: true, bloom: true, msaa: 4, soft: true, shafts: 10, shaftShadow: true, dust: 3500, grass: 20000, grassR: 30, cine: 2, hires: false },
  ultra: { name: '울트라', pr: 2, shadow: 4096, ao: true, bloom: true, msaa: 4, soft: true, shafts: 14, shaftShadow: true, dust: 6000, grass: 36000, grassR: 40, cine: 2, hires: true },
};

// 톤매핑: ACES — AgX 는 이 장면에서 채도·대비가 빠져 피부·도장색이 바래 보임
export const TONE = { mapping: THREE.ACESFilmicToneMapping, exposure: 1.05 };

// 디스플레이 기준(OutputPass 이후) 시네마틱 패스: 비네트 · 스플릿 톤(그림자 차갑게/하이라이트 따뜻하게) · 필름 그레인 · 가장자리 색수차
const CineShader = {
  name: 'CineShader',
  uniforms: { tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uVig: { value: 0.26 }, uGrade: { value: 1 }, uGrain: { value: 0.024 }, uCA: { value: 0.0016 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime; uniform float uVig; uniform float uGrade; uniform float uGrain; uniform float uCA;
    varying vec2 vUv;
    float h12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
    void main() {
      vec2 c = vUv - 0.5, ca = c * vec2( uRes.x / uRes.y, 1.0 );
      float r = length( ca );
      #ifdef FILM
        vec2 off = c * smoothstep( 0.3, 1.0, r ) * uCA * 3.0; // 화면 가장자리만
        vec3 col = vec3( texture2D( tDiffuse, vUv - off ).r, texture2D( tDiffuse, vUv ).g, texture2D( tDiffuse, vUv + off ).b );
      #else
        vec3 col = texture2D( tDiffuse, vUv ).rgb;
      #endif
      float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      // 스플릿 톤: 거의 흰 하이라이트(용접 아크·스파크)는 중성 유지
      vec3 sh = vec3( - 0.010, 0.002, 0.016 ), hi = vec3( 0.020, 0.007, - 0.016 );
      col += uGrade * ( sh * ( 1.0 - smoothstep( 0.02, 0.4, l ) ) * smoothstep( 0.0, 0.05, l ) + hi * smoothstep( 0.3, 0.75, l ) * ( 1.0 - smoothstep( 0.82, 1.0, l ) ) );
      col = mix( col, col * col * ( 3.0 - 2.0 * col ), 0.08 * uGrade ); // 아주 약한 S 커브
      col *= 1.0 - uVig * pow( smoothstep( 0.3, 1.15, r ), 1.4 );
      #ifdef FILM
        float t = fract( uTime * 7.31 ) * 97.0;
        float n = h12( gl_FragCoord.xy + t ) + h12( gl_FragCoord.xy * 1.37 + t + 13.1 ) - 1.0; // 삼각 분포
        col += n * uGrain * ( 0.35 + 0.65 * ( 1.0 - l ) );
      #endif
      gl_FragColor = vec4( max( col, 0.0 ), 1.0 );
    }`,
};

export class Renderer {
  constructor(canvas, qkey) {
    const r = (this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false }));
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = TONE.mapping; r.toneMappingExposure = TONE.exposure;
    r.shadowMap.enabled = true; this.q = QUALITY[qkey] || QUALITY.high; this.qkey = qkey;
    r.shadowMap.type = this.q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    // 그림자맵은 프레임당 한 번만 (GTAO 노멀 패스가 같은 프레임에 다시 그리지 않도록)
    r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true;
    this.maxAniso = r.capabilities.getMaxAnisotropy();
  }
  setup(scene, camera) {
    this.scene = scene; this.camera = camera; this.build(); addEventListener('resize', () => this.resize());
  }
  build() {
    const r = this.r, q = this.q, w = innerWidth, h = innerHeight;
    r.setPixelRatio(Math.min(devicePixelRatio, q.pr)); r.setSize(w, h, false);
    this.composer?.dispose?.();
    const pr = r.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: q.msaa });
    const c = (this.composer = new EffectComposer(r, rt));
    c.addPass(new RenderPass(this.scene, this.camera));
    if (q.ao) {
      const ao = (this.ao = new GTAOPass(this.scene, this.camera, w * pr, h * pr));
      ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 0.6, scale: 1.0, samples: q === QUALITY.ultra ? 16 : 10 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      ao.blendIntensity = 0.85; c.addPass(ao);
    } else this.ao = null;
    if (q.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.4, 0.55, 1.05); c.addPass(this.bloom); } else this.bloom = null;
    c.addPass(new OutputPass());
    if (q.cine) {
      const cine = (this.cine = new ShaderPass(CineShader));
      if (q.cine > 1) { cine.material.defines.FILM = ''; cine.material.needsUpdate = true; }
      c.addPass(cine);
    } else this.cine = null;
    this.resize();
  }
  setQuality(key) {
    this.q = QUALITY[key] || QUALITY.high; this.qkey = key;
    this.r.shadowMap.type = this.q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap; this.r.shadowMap.needsUpdate = true;
    this.build();
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.r.setSize(w, h, false); this.composer.setSize(w, h);
    this.cine?.uniforms.uRes.value.set(w, h);
  }
  render() {
    if (this.cine) this.cine.uniforms.uTime.value = performance.now() / 1000;
    this.r.shadowMap.needsUpdate = true;
    this.composer.render();
  }
}
