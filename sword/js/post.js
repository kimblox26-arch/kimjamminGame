// SKY HERO — Post
// 파이프라인: RenderPass(HalfFloat, 선택적 MSAA) -> 블룸(1/2 해상도, 저사양 1/4) -> 최종 패스 1회(풀스크린 draw 1번)
// 최종 패스 = 방사형 속도 블러 + 스펙트럴 색수차 + 열 아지랑이 + 충격파 굴절 링 + 플래시 + 비네팅
//            + 톤매핑/sRGB(OutputPass 를 이 패스에 접어 넣음: renderer.toneMapping / toneMappingExposure 그대로 사용) + 디더링.
// 블룸은 원본에 가산 합성하지 않고 최종 패스에서 샘플링 → 풀해상도 패스 2개 절약 (120fps / 모바일).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const MAX_WAVES = 4;
const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);

// ---------- 타일링 값 노이즈 텍스처 (시작 시 1회, RGBA 4채널 독립) ----------
function makeNoiseTexture(size = 128) {
  const data = new Uint8Array(size * size * 4);
  const hash = (x, y, s) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h & 0xffff) / 65535;
  };
  const vnoise = (x, y, p, s) => {   // 주기 p 로 타일링
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const x0 = ((ix % p) + p) % p, y0 = ((iy % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  for (let ch = 0; ch < 4; ch++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0, amp = 0.5, norm = 0, p = 6;
        for (let o = 0; o < 3; o++) {
          sum += amp * vnoise((x / size) * p, (y / size) * p, p, ch * 31 + o * 7 + 1);
          norm += amp; amp *= 0.5; p *= 2;
        }
        // 대비를 조금 키워 0.5 중심으로 고르게 분포
        const v = 0.5 + (sum / norm - 0.5) * 1.6;
        data[(y * size + x) * 4 + ch] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------- 블룸: UnrealBloomPass 확장 ----------
// - 해상도 배율 (high 1 → 밝은영역 1/2 해상도, low 0.5 → 1/4)
// - 4탭 Karis 평균 + 소프트 니 하이패스 (작은 HDR 하이라이트 깜빡임/파이어플라이 억제, half-float 오버플로 방지)
// - 마지막 가산 합성 생략: 결과(bloom.texture)는 최종 패스가 직접 샘플
class SkyBloomPass extends UnrealBloomPass {
  constructor(resolution, strength, radius, threshold, scale = 1) {
    super(resolution, strength, radius, threshold);
    this.scale = scale;
    this.knee = 0.5;          // 임계값 대비 소프트 니 폭
    this.maxBrightness = 48;  // 프리필터 클램프 (태양 원반 등)
    this.materialHighPassFilter.dispose();
    this.highPassUniforms = {
      tDiffuse: { value: null },
      uTexel: { value: new THREE.Vector2(1, 1) },
      luminosityThreshold: { value: threshold },
      smoothWidth: { value: 0.5 },
      uMaxBright: { value: this.maxBrightness },
    };
    this.materialHighPassFilter = new THREE.ShaderMaterial({
      name: 'SkyBloom.prefilter',
      uniforms: this.highPassUniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform vec2 uTexel;
        uniform float luminosityThreshold;
        uniform float smoothWidth;
        uniform float uMaxBright;
        varying vec2 vUv;
        vec3 fetch(vec2 o) { return min(max(texture2D(tDiffuse, vUv + o * uTexel).rgb, vec3(0.0)), vec3(uMaxBright)); }
        float kw(vec3 c) { return 1.0 / (1.0 + max(c.r, max(c.g, c.b)) * 0.25); }
        void main() {
          vec3 a = fetch(vec2(-1.0, -1.0)), b = fetch(vec2(1.0, -1.0));
          vec3 c = fetch(vec2(-1.0, 1.0)), d = fetch(vec2(1.0, 1.0));
          float wa = kw(a), wb = kw(b), wc = kw(c), wd = kw(d);
          vec3 col = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
          float br = max(col.r, max(col.g, col.b));
          float th = luminosityThreshold;
          float knee = th * smoothWidth + 1e-4;
          float soft = clamp(br - th + knee, 0.0, 2.0 * knee);
          soft = soft * soft / (4.0 * knee);
          float contrib = max(soft, br - th) / max(br, 1e-4);
          gl_FragColor = vec4(col * contrib, 1.0);
        }`,
    });
  }

  get texture() { return this.renderTargetsHorizontal[0].texture; }

  setSize(width, height) {
    const w = Math.max(2, Math.round(width * this.scale));
    const h = Math.max(2, Math.round(height * this.scale));
    super.setSize(w, h);
    // 프리필터 4탭은 원본(풀해상도) 텍셀 기준: 1/2 다운샘플이면 4x4, 1/4 이면 정확히 4x4 블록 커버
    this.highPassUniforms.uTexel.value.set(1 / Math.max(1, width), 1 / Math.max(1, height));
  }

  render(renderer, writeBuffer, readBuffer) {
    renderer.getClearColor(this._oldClearColor);
    this.oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);

    // 1. 밝은 영역 추출
    const hp = this.highPassUniforms;
    hp.tDiffuse.value = readBuffer.texture;
    hp.luminosityThreshold.value = this.threshold;
    hp.smoothWidth.value = this.knee;
    hp.uMaxBright.value = this.maxBrightness;
    this.fsQuad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    this.fsQuad.render(renderer);

    // 2. 밉 체인 블러
    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const m = this.separableBlurMaterials[i];
      this.fsQuad.material = m;
      m.uniforms.colorTexture.value = input.texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      this.fsQuad.render(renderer);
      m.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      this.fsQuad.render(renderer);
      input = this.renderTargetsVertical[i];
    }

    // 3. 밉 합성 → renderTargetsHorizontal[0] (최종 패스가 샘플)
    const cu = this.compositeMaterial.uniforms;
    this.fsQuad.material = this.compositeMaterial;
    cu.bloomStrength.value = this.strength;
    cu.bloomRadius.value = this.radius;
    cu.bloomTintColors.value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    this.fsQuad.render(renderer);

    renderer.setClearColor(this._oldClearColor, this.oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }
}

// ---------- 최종 합성 셰이더 (풀스크린 draw 1회) ----------
const FinalShader = {
  name: 'SkyHero.final',
  uniforms: {
    tDiffuse: { value: null },
    tBloom: { value: null },
    tNoise: { value: null },
    uBloom: { value: 1 },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uAspect: { value: 1 },
    uTime: { value: 0 },
    uJitter: { value: 0 },
    uFocus: { value: new THREE.Vector2(0.5, 0.5) },
    uSpeed: { value: 0 },
    uHeat: { value: 0 },
    uFlash: { value: 0 },
    uVignette: { value: 0.25 },
    uChroma: { value: 0 },
    uBlurMax: { value: 0.13 },
    uCaMax: { value: 0.016 },
    uHazeAmp: { value: 0.011 },
    uInvExposure: { value: 1 },
    uWave: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uWaveP: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tBloom;
    uniform sampler2D tNoise;
    uniform float uBloom;
    uniform vec2 uTexel;
    uniform float uAspect;
    uniform float uTime;
    uniform float uJitter;
    uniform vec2 uFocus;
    uniform float uSpeed;
    uniform float uHeat;
    uniform float uFlash;
    uniform float uVignette;
    uniform float uChroma;
    uniform float uBlurMax;
    uniform float uCaMax;
    uniform float uHazeAmp;
    uniform float uInvExposure;
    uniform vec4 uWave[4];    // xy 중심 uv, z 반지름(화면 높이 단위), w 링 반폭
    uniform vec4 uWaveP[4];   // x 굴절 세기, y 밝은 테두리, z 안쪽 어두운 띠, w 활성
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 uv = vUv;
      vec2 asp = vec2(uAspect, 1.0);
      vec2 toF = uv - uFocus;
      vec2 toFa = toF * asp;
      float rF = length(toFa);

      vec2 ofs = vec2(0.0);
      vec3 glowC = vec3(0.0);
      float shade = 0.0;
      float hazeW = 0.0;

      // ── 열 아지랑이: 플레이어 주변에 집중, 두 옥타브 노이즈가 서로 다른 방향으로 흐름 ──
      if (uHeat > 0.002) {
        vec2 q = toFa * 3.1;
        vec4 n1 = texture2D(tNoise, q + vec2(0.17, -0.61) * uTime);
        vec4 n2 = texture2D(tNoise, q * 2.9 + vec2(-0.53, -1.37) * uTime);
        vec2 h = (n1.xy - 0.5) * 0.8 + (n2.zw - 0.5);
        hazeW = uHeat * (0.16 + 0.84 * exp(-rF * rF * 7.0));
        ofs += h * (hazeW * uHazeAmp) / asp;
      }

      // ── 충격파 굴절 링 (최대 4개) ──
      for (int i = 0; i < 4; i++) {
        vec4 wv = uWave[i];
        vec4 wp = uWaveP[i];
        if (wp.w > 0.5) {
          vec2 d = (uv - wv.xy) * asp;
          float dist = length(d);
          float x = (dist - wv.z) / wv.w;
          if (abs(x) < 4.0) {
            vec2 n = d / max(dist, 1e-4);
            // 완벽한 원이 되지 않게 난류로 반지름을 살짝 흔듦
            float wob = texture2D(tNoise, n * 0.2 + wv.xy * 3.0 + vec2(uTime * 0.03, 0.0)).g - 0.5;
            x += wob * (0.5 + wv.z * 2.2);
            float g = exp(-x * x);
            ofs += n * (x * g * wp.x) / asp;      // 압축 껍질: 링 안팎이 렌즈처럼 휘어짐
            vec3 e = (vec3(x) - vec3(0.7, 0.6, 0.5)) * 3.4;
            glowC += exp(-e * e) * wp.y;           // 바깥쪽 얇은 밝은 테두리 (분산: 바깥 붉게, 안쪽 푸르게)
            float s = (x + 0.35) * 1.9;
            shade += exp(-s * s) * wp.z;           // 안쪽 희박 영역 살짝 어둡게
          }
        }
      }
      vec2 uvD = uv + ofs;

      // ── 방사형 속도 블러 + 스펙트럴 색수차 (한 선분 위의 TAPS 샘플) ──
      vec2 toC = uvD - 0.5;
      float rC2 = dot(toC, toC) * 2.0;                         // 화면 모서리 = 1
      float sm = smoothstep(0.07, 0.62, rF);                    // 중심(플레이어)은 선명
      float blurK = uSpeed * uBlurMax * sm * (0.5 + 0.5 * sm);  // 가장자리로 갈수록 가속
      float caK = uChroma * uCaMax * rC2;
      vec2 D = toF * blurK + toC * caK;
      float spanPx = length(D / uTexel);
      vec3 col;
      if (spanPx < 0.7) {
        col = texture2D(tDiffuse, uvD).rgb;
      } else {
        float lb = length(toF) * blurK, lc = length(toC) * caK;
        float cmix = clamp(uChroma * 1.6, 0.0, 1.0) * lc / (lc + 0.3 * lb + 1e-5);
        float j = fract(hash12(gl_FragCoord.xy) + uJitter);
        vec3 acc = vec3(0.0);
        vec3 wsum = vec3(0.0);
        for (int i = 0; i < TAPS; i++) {
          float t = (float(i) + j) / float(TAPS);
          vec3 spec = vec3(1.0 - t, 1.0 - abs(2.0 * t - 1.0), t);
          vec3 w = mix(vec3(1.0), spec * 2.0, cmix) * (1.0 - 0.55 * abs(2.0 * t - 1.0));
          acc += texture2D(tDiffuse, uvD - D * (t - 0.5)).rgb * w;
          wsum += w;
        }
        col = acc / max(wsum, vec3(1e-4));
      }
      col = min(col, vec3(1e4));

      // ── 블룸 ──
      if (uBloom > 0.5) col += texture2D(tBloom, uvD).rgb;

      // ── 충격파 테두리 / 열기 색조 ──
      col *= 1.0 - min(shade, 0.5);
      col = col * (1.0 + glowC * 0.55) + glowC * (0.45 * uInvExposure * 2.2);
      col *= 1.0 + vec3(0.07, 0.0, -0.08) * hazeW;

      // ── 비네팅 (cos^4 근사, 선형 공간) ──
      vec2 vp = uv - 0.5;
      float r2 = dot(vp, vp) * 2.0;
      float vk = 1.0 + uVignette * 0.85 * r2;
      col *= 1.0 / (vk * vk);

      // ── 섬광 (가산 흰빛, 노출 보정, 플레이어 쪽이 조금 더 밝게; flash=1 이면 거의 하얗게) ──
      float fl = uFlash * (0.35 + 1.4 * uFlash) * (1.0 + 0.7 * exp(-rF * rF * 3.0));
      col += vec3(1.0, 0.975, 0.93) * (fl * uInvExposure);

      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      // 8bit 밴딩 제거 디더 (하늘 그라디언트)
      gl_FragColor.rgb += (hash12(gl_FragCoord.xy + vec2(47.0, 17.0) * uJitter) - 0.5) / 255.0;
    }`,
};

const _size = new THREE.Vector2();

export class Post {
  constructor(renderer, scene, camera, opts = { quality: 'high' }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = opts && opts.quality === 'low' ? 'low' : 'high';
    const low = this.quality === 'low';
    // MSAA: 'auto'(high: 픽셀 수에 따라 4/2/0, low: 0) 또는 숫자
    this.msaa = opts && opts.msaa !== undefined ? opts.msaa : 'auto';

    this.params = {
      speed: 0, heat: 0, flash: 0, vignette: 0.25, chroma: 0,
      focus: new THREE.Vector2(0.5, 0.5),
    };
    // 튜닝용 (런타임 변경 OK, 재컴파일 없음)
    this.tune = {
      blurMax: 0.13,      // speed=1 일 때 블러 길이 (포커스까지 거리 대비 비율)
      caMax: 0.016,       // chroma=1 일 때 화면 모서리 색수차 폭 (uv)
      hazeAmp: 0.011,     // heat=1 일 때 아지랑이 UV 왜곡
      waveLife: 0.9,      // 충격파 수명 (s)
      waveRadius: 0.95,   // strength=1 최종 반지름 (화면 높이 단위)
      waveRefract: 0.06,  // 굴절 세기
      waveGlow: 0.9,      // 밝은 테두리
      flashGain: 1.0,     // 섬광 입력 배율 (노출 보정됨; flash 0.5 ≈ 강한 순간 화이트아웃)
    };

    renderer.getSize(_size);
    const pr = renderer.getPixelRatio();
    const pw = Math.max(1, Math.floor(_size.x * pr)), ph = Math.max(1, Math.floor(_size.y * pr));
    const rt = new THREE.WebGLRenderTarget(pw, ph, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
    });
    rt.texture.name = 'Post.scene';
    rt.texture.generateMipmaps = false;
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(1);   // 컴포저는 드로잉버퍼 픽셀 단위로 직접 관리
    this.composer.renderToScreen = true;

    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new SkyBloomPass(new THREE.Vector2(pw, ph), 0.55, 0.5, 0.9, low ? 0.5 : 1);

    this.noise = makeNoiseTexture(128);
    const mat = new THREE.ShaderMaterial({
      name: FinalShader.name,
      defines: { TAPS: low ? 5 : 8 },
      uniforms: THREE.UniformsUtils.clone(FinalShader.uniforms),
      vertexShader: FinalShader.vertexShader,
      fragmentShader: FinalShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.final = new ShaderPass(mat);
    this.final.needsSwap = false;     // 화면에 바로 그림 → 스왑 불필요 (씬 RT 하나만 사용)
    this.uniforms = this.final.uniforms;
    this.uniforms.tNoise.value = this.noise;
    this.uniforms.tBloom.value = this.bloom.texture;

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.final);

    // 충격파 슬롯 (고정 4개)
    this._waves = [];
    for (let i = 0; i < MAX_WAVES; i++) this._waves.push({ x: 0, y: 0, age: 0, life: 1, s: 0, active: false });

    this.time = 0;
    this._frame = 0;
    this._samples = 0;
    this._w = _size.x; this._h = _size.y;
    this.setSize(_size.x, _size.y);
  }

  _pickSamples(pixels) {
    if (typeof this.msaa === 'number') return this.msaa;
    const r = this.renderer;
    if (this.quality === 'low' || !r.capabilities.isWebGL2) return 0;
    const max = r.capabilities.maxSamples || 4;
    const s = pixels <= 2.4e6 ? 4 : pixels <= 4.6e6 ? 2 : 0;
    return Math.min(s, max);
  }

  setSize(width, height) {
    this._w = width; this._h = height;
    const pr = this.renderer.getPixelRatio();
    const pw = Math.max(1, Math.floor(width * pr)), ph = Math.max(1, Math.floor(height * pr));
    const samples = this._pickSamples(pw * ph);
    const c = this.composer;
    if (samples !== this._samples) {
      this._samples = samples;
      c.renderTarget1.samples = samples;
      c.renderTarget2.samples = samples;
      c.renderTarget1.dispose();   // 다음 사용 시 새 샘플 수로 재할당 (리사이즈 때만)
      c.renderTarget2.dispose();
    }
    c.setSize(pw, ph);
    this.uniforms.uTexel.value.set(1 / pw, 1 / ph);
    this.uniforms.uAspect.value = pw / ph;
  }

  addShockwave(uv, strength = 1) {
    const s = clamp01(strength);
    if (s <= 0 || !uv) return;
    let slot = null, oldest = -1;
    for (let i = 0; i < MAX_WAVES; i++) {
      const w = this._waves[i];
      if (!w.active) { slot = w; break; }
      const k = w.age / w.life;
      if (k > oldest) { oldest = k; slot = w; }
    }
    slot.x = uv.x; slot.y = uv.y;
    slot.age = 0;
    slot.life = this.tune.waveLife * (0.85 + 0.25 * s);
    slot.s = s;
    slot.active = true;
  }

  _updateWaves(dt) {
    const T = this.tune;
    const uW = this.uniforms.uWave.value, uP = this.uniforms.uWaveP.value;
    for (let i = 0; i < MAX_WAVES; i++) {
      const w = this._waves[i];
      if (w.active) {
        w.age += dt;
        if (w.age >= w.life) w.active = false;
      }
      if (!w.active) { uP[i].w = 0; continue; }
      const t = w.age / w.life;
      const e = 1 - Math.pow(1 - t, 2.6);                     // 빠르게 터져 나가다 감속
      const R = 0.03 + T.waveRadius * (0.45 + 0.55 * w.s) * e;
      const hw = 0.012 + 0.045 * t + 0.012 * w.s;              // 링 반폭: 퍼지며 두꺼워짐
      const fadeIn = Math.min(1, w.age / 0.035);
      const fade = Math.pow(1 - t, 1.5) * fadeIn;
      uW[i].set(w.x, w.y, R, hw);
      const grow = Math.min(1, R / 0.12);                      // 태어날 때 플레이어를 과하게 일그러뜨리지 않게
      uP[i].set(T.waveRefract * w.s * fade * grow, T.waveGlow * w.s * fade * (1 - 0.5 * t), 0.22 * w.s * fade, 1);
    }
  }

  render(dt = 0) {
    if (!(dt > 0)) dt = 0;
    this.time += dt;
    this._frame++;
    const u = this.uniforms, P = this.params, T = this.tune;
    u.uTime.value = this.time % 1000;
    u.uJitter.value = (this._frame * 0.6180339887) % 1;
    u.uSpeed.value = clamp01(P.speed);
    u.uHeat.value = clamp01(P.heat);
    u.uFlash.value = clamp01(P.flash * T.flashGain);
    u.uVignette.value = clamp01(P.vignette);
    u.uChroma.value = clamp01(P.chroma);
    const f = P.focus;
    if (f && Number.isFinite(f.x) && Number.isFinite(f.y)) u.uFocus.value.copy(f);
    u.uBlurMax.value = T.blurMax;
    u.uCaMax.value = T.caMax;
    u.uHazeAmp.value = T.hazeAmp;
    u.uBloom.value = this.bloom.enabled ? 1 : 0;
    const r = this.renderer;
    u.uInvExposure.value = r.toneMapping === THREE.NoToneMapping ? 1 : 1 / Math.max(0.05, r.toneMappingExposure);
    this._updateWaves(dt);
    this.composer.render(dt);
  }

  // 셰이더 미리 컴파일: 씬 재질은 '컴포저 RT' 기준(톤매핑 없음/선형)으로 컴파일해야 실제 사용 변형과 일치.
  // main 의 renderer.compile(scene, camera) 대신 post.prewarm() 호출 권장 (모든 모듈 생성 후).
  prewarm() {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    try {
      r.setRenderTarget(this.composer.readBuffer);
      r.compile(this.scene, this.camera);
    } catch (e) { console.warn(e); }
    r.setRenderTarget(prev);
    this.render(0);
  }

  dispose() {
    this.composer.dispose();
    this.bloom.dispose();
    this.final.dispose();
    this.noise.dispose();
  }
}
