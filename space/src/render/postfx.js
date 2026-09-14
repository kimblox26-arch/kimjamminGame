// ORBITER — 후처리
//
// 사실감의 절반은 후처리에서 나온다. 실제 카메라로 찍은 장면에는
// 밝은 곳이 번지고(블룸), 렌즈에 고스트가 생기고(플레어), 미세한 입자가 있다.
//
// 전부 Canvas 2D 로 처리한다.
//   블룸  : 축소 → multiply 로 어두운 부분 억제 → blur 필터 → lighter 합성
//   플레어: 태양 화면 좌표에서 화면 중심을 지나는 축 위에 고스트 배치
//   그레인: 미리 만든 노이즈 타일을 매 프레임 다른 위치로 overlay

import { clamp, clamp01, lerp, withAlpha } from '../core/math.js';

/** ctx.filter 지원 여부 (사파리 구버전 대응) */
let _filterSupported = null;
function supportsFilter() {
  if (_filterSupported !== null) return _filterSupported;
  try {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    const g = c.getContext('2d');
    g.filter = 'blur(2px)';
    _filterSupported = g.filter === 'blur(2px)';
  } catch (e) {
    _filterSupported = false;
  }
  return _filterSupported;
}

export class PostFX {
  constructor(opts = {}) {
    this.enabled = opts.enabled ?? true;
    this.bloomStrength = opts.bloomStrength ?? 0.45;
    // 자기 자신을 몇 번 곱할지 = 임계값의 세기.
    // 4번이면 밝기 x⁵ 이라 하늘(0.75)은 0.24 로 눌리고 화염(1.0)만 살아남는다.
    this.bloomThresholdPasses = 4;
    this.grainStrength = opts.grain ?? 0.035;
    this.vignetteStrength = opts.vignette ?? 0.3;
    this.chromatic = opts.chromatic ?? 0.6;
    this.quality = 2;

    this._src = null; // 축소 원본
    this._down = null; // 임계값 적용 버퍼
    this._blur = null; // 블러 결과
    this._grain = null;
    this._w = 0;
    this._h = 0;
    this._frame = 0;
  }

  setQuality(level) {
    this.quality = level;
    this.bloomStrength = [0, 0.3, 0.45, 0.6][clamp(level, 0, 3)];
    this.grainStrength = [0, 0.022, 0.035, 0.045][clamp(level, 0, 3)];
  }

  _ensure(w, h) {
    if (this._w === w && this._h === h && this._down) return;
    this._w = w;
    this._h = h;
    // 블룸 버퍼는 절대 크기를 제한한다. 번짐은 저해상도로도 충분한데
    // 블러 반경이 버퍼 폭에 비례하므로 큰 버퍼는 비용만 폭증시킨다.
    const scale = Math.min(0.25, 320 / Math.max(w, 1));
    const dw = Math.max(2, Math.round(w * scale));
    const dh = Math.max(2, Math.round(h * scale));

    const make = () => {
      const c = document.createElement('canvas');
      c.width = dw;
      c.height = dh;
      return c;
    };
    this._src = make();
    this._srcCtx = this._src.getContext('2d');
    this._down = make();
    this._downCtx = this._down.getContext('2d');
    this._blur = make();
    this._blurCtx = this._blur.getContext('2d');
  }

  _ensureGrain() {
    if (this._grain) return;
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const v = 110 + Math.random() * 70;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this._grain = c;
  }

  /**
   * 블룸 — 밝은 부분만 남겨 번지게 한 뒤 원본에 더한다.
   */
  bloom(ctx, canvas, strength = this.bloomStrength) {
    if (strength <= 0.01 || !supportsFilter()) return;
    const w = canvas.width;
    const h = canvas.height;
    this._ensure(w, h);
    const dw = this._down.width;
    const dh = this._down.height;
    const sctx = this._srcCtx;
    const dctx = this._downCtx;
    const bctx = this._blurCtx;

    // 1) 축소본을 따로 보관한다 (같은 캔버스를 읽으며 쓰면 결과가 불안정하다)
    sctx.globalCompositeOperation = 'source-over';
    sctx.globalAlpha = 1;
    sctx.clearRect(0, 0, dw, dh);
    sctx.drawImage(canvas, 0, 0, dw, dh);

    // 2) 원본을 반복해서 곱해 어두운 부분을 눌러 준다 (임계값 대용)
    dctx.globalCompositeOperation = 'source-over';
    dctx.globalAlpha = 1;
    dctx.clearRect(0, 0, dw, dh);
    dctx.drawImage(this._src, 0, 0);
    dctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < this.bloomThresholdPasses; i++) {
      dctx.drawImage(this._src, 0, 0);
    }
    dctx.globalCompositeOperation = 'source-over';

    // 3) 블러 — 반경을 달리해 두 번 겹치면 자연스러운 헤일로가 된다
    bctx.clearRect(0, 0, dw, dh);
    bctx.filter = `blur(${Math.max(2, dw * 0.012)}px)`;
    bctx.drawImage(this._down, 0, 0);
    bctx.filter = `blur(${Math.max(5, dw * 0.035)}px)`;
    bctx.globalAlpha = 0.7;
    bctx.drawImage(this._down, 0, 0);
    bctx.filter = 'none';
    bctx.globalAlpha = 1;

    // 4) 합성
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp01(strength);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(this._blur, 0, 0, w, h);
    ctx.restore();
  }

  /**
   * 렌즈 플레어 — 태양이 화면 안에 있을 때만.
   * @param {object} sun { x, y, visible(0..1), size }
   */
  lensFlare(ctx, w, h, sun) {
    if (!sun || sun.visible <= 0.01) return;
    const cx = w / 2;
    const cy = h / 2;
    const dx = cx - sun.x;
    const dy = cy - sun.y;
    const vis = clamp01(sun.visible);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';

    // 태양 주변 글레어
    const glareR = (sun.size ?? 40) * 6;
    const g = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, glareR);
    g.addColorStop(0, withAlpha('#fff6d8', 0.55 * vis));
    g.addColorStop(0.12, withAlpha('#ffe2a0', 0.28 * vis));
    g.addColorStop(0.4, withAlpha('#ffb45a', 0.08 * vis));
    g.addColorStop(1, withAlpha('#ff8a3a', 0));
    ctx.fillStyle = g;
    ctx.fillRect(sun.x - glareR, sun.y - glareR, glareR * 2, glareR * 2);

    // 아나모픽 가로 스트릭
    const streakW = glareR * 2.6;
    const sg = ctx.createLinearGradient(sun.x - streakW, sun.y, sun.x + streakW, sun.y);
    sg.addColorStop(0, withAlpha('#8fc8ff', 0));
    sg.addColorStop(0.5, withAlpha('#cfe4ff', 0.22 * vis));
    sg.addColorStop(1, withAlpha('#8fc8ff', 0));
    ctx.fillStyle = sg;
    ctx.fillRect(sun.x - streakW, sun.y - glareR * 0.035, streakW * 2, glareR * 0.07);

    // 고스트 — 태양~화면중심 축 위에 색색의 원반
    const ghosts = [
      { t: 0.32, r: 0.1, c: '#6fd8ff', a: 0.1 },
      { t: 0.55, r: 0.055, c: '#ffb45a', a: 0.13 },
      { t: 0.78, r: 0.14, c: '#5ae0b8', a: 0.07 },
      { t: 1.15, r: 0.08, c: '#c48cff', a: 0.09 },
      { t: 1.5, r: 0.2, c: '#ff8a6a', a: 0.05 },
      { t: 1.85, r: 0.06, c: '#ffe9a0', a: 0.1 },
    ];
    const scale = Math.min(w, h);
    for (const gh of ghosts) {
      const x = sun.x + dx * gh.t * 2;
      const y = sun.y + dy * gh.t * 2;
      const r = scale * gh.r * (0.5 + vis * 0.5);
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, withAlpha(gh.c, gh.a * vis));
      rg.addColorStop(0.75, withAlpha(gh.c, gh.a * 0.4 * vis));
      rg.addColorStop(1, withAlpha(gh.c, 0));
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 필름 그레인 */
  grain(ctx, w, h, strength = this.grainStrength) {
    if (strength <= 0.005) return;
    this._ensureGrain();
    this._frame++;
    const ox = (this._frame * 37) % 256;
    const oy = (this._frame * 61) % 256;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = strength;
    const pat = ctx.createPattern(this._grain, 'repeat');
    ctx.translate(-ox, -oy);
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w + 256, h + 256);
    ctx.restore();
  }

  /** 비네트 + 아주 옅은 색수차 느낌의 가장자리 물빠짐 */
  vignette(ctx, w, h, strength = this.vignetteStrength) {
    if (strength <= 0.005) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.min(w, h) * 0.32,
      w / 2,
      h / 2,
      Math.max(w, h) * 0.78
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.65, `rgba(0,0,0,${strength * 0.35})`);
    g.addColorStop(1, `rgba(0,0,0,${strength})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (this.chromatic > 0.01) {
      // 가장자리에만 아주 옅은 청/적 분리
      ctx.globalCompositeOperation = 'lighter';
      const cg = ctx.createRadialGradient(
        w / 2,
        h / 2,
        Math.min(w, h) * 0.55,
        w / 2,
        h / 2,
        Math.max(w, h) * 0.75
      );
      cg.addColorStop(0, 'rgba(0,0,0,0)');
      cg.addColorStop(1, `rgba(40,20,60,${0.09 * this.chromatic})`);
      ctx.fillStyle = cg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.restore();
  }

  /**
   * 전체 후처리 파이프라인.
   * @param {object} opts { sun, bloom, grain, vignette }
   */
  apply(ctx, canvas, opts = {}) {
    if (!this.enabled) return;
    // 후처리는 전부 실제 픽셀(디바이스 픽셀) 기준으로 한다.
    // 호출자가 넘기는 좌표는 CSS 픽셀이므로 dpr 을 곱해 맞춘다.
    const w = canvas.width;
    const h = canvas.height;
    const dpr = opts.dpr ?? 1;

    this.bloom(ctx, canvas, opts.bloom ?? this.bloomStrength);
    if (opts.sun) {
      this.lensFlare(ctx, w, h, {
        x: opts.sun.x * dpr,
        y: opts.sun.y * dpr,
        visible: opts.sun.visible,
        size: (opts.sun.size ?? 40) * dpr,
      });
    }
    this.grain(ctx, w, h, opts.grain ?? this.grainStrength);
    this.vignette(ctx, w, h, opts.vignette ?? this.vignetteStrength);
  }
}

/**
 * 태양 원반과 광채를 장면에 직접 그린다 (후처리 이전).
 * @param {object} opts { x, y, radius, color, atmosphere(0..1) }
 */
export function drawSunDisc(ctx, opts) {
  const { x, y, radius } = opts;
  const color = opts.color ?? '#fff6d8';
  const atmo = clamp01(opts.atmosphere ?? 0);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // 대기 중에서는 산란으로 훨씬 크게 번진다
  const halo = radius * lerp(7, 26, atmo);
  const g = ctx.createRadialGradient(x, y, radius * 0.4, x, y, halo);
  g.addColorStop(0, withAlpha('#ffffff', 0.95));
  g.addColorStop(0.05, withAlpha(color, 0.75));
  g.addColorStop(0.2, withAlpha('#ffd08a', lerp(0.18, 0.4, atmo)));
  g.addColorStop(0.5, withAlpha('#ffab5a', lerp(0.05, 0.18, atmo)));
  g.addColorStop(1, withAlpha('#ff8a3a', 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, halo, 0, Math.PI * 2);
  ctx.fill();

  // 코어
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  // 진공에서는 날카로운 광선이 생긴다
  if (atmo < 0.5) {
    const spikes = 4;
    const len = radius * 9 * (1 - atmo);
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2 + 0.2;
      const sx = Math.cos(a);
      const sy = Math.sin(a);
      const lg = ctx.createLinearGradient(x, y, x + sx * len, y + sy * len);
      lg.addColorStop(0, withAlpha('#fff6d8', 0.5));
      lg.addColorStop(1, withAlpha('#fff6d8', 0));
      ctx.strokeStyle = lg;
      ctx.lineWidth = radius * 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + sx * len, y + sy * len);
      ctx.stroke();
    }
  }
  ctx.restore();
}
