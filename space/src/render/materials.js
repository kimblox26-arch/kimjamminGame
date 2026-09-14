// ORBITER — 재질 셰이딩 툴킷
//
// Canvas 2D 로 "실제 물건처럼" 보이게 만드는 도구 모음.
// 핵심은 네 가지다.
//   1) 원통 셰이딩  — 광원 방향에 따라 스페큘러 띠가 움직인다
//   2) 가장자리 AO  — 물체 테두리가 살짝 어두워야 입체로 보인다
//   3) 표면 디테일  — 패널 이음선, 리벳, 용접선, 미세 줄무늬
//   4) 사용 흔적    — 그을음, 열 변색, 얼룩
//
// 모든 함수는 "1 단위 = 1 미터, +y 가 위" 인 부품 로컬 좌표계에서 동작한다.

import { clamp, clamp01, lerp, mixHex, withAlpha, shade, TAU } from '../core/math.js';
import { paintTexture } from './textures.js';

/* ──────────────────────────────────────────────────────────────
 * 노이즈 패턴 — 한 번만 만들어 재사용
 * ────────────────────────────────────────────────────────────── */

let _noisePattern = null;
let _noiseCanvas = null;

/** 미세한 얼룩/거칠기용 노이즈 타일 */
export function noisePattern(ctx) {
  if (_noisePattern) return _noisePattern;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    // 값 노이즈 두 겹 — 큰 얼룩 + 미세 입자
    const x = i % size;
    const y = (i / size) | 0;
    const coarse =
      Math.sin(x * 0.13) * Math.cos(y * 0.11) * 0.5 +
      Math.sin((x + y) * 0.07) * 0.5;
    const fine = Math.random() * 2 - 1;
    const v = 128 + coarse * 26 + fine * 18;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  _noiseCanvas = c;
  _noisePattern = ctx.createPattern(c, 'repeat');
  return _noisePattern;
}

export function noiseCanvas() {
  return _noiseCanvas;
}

/* ──────────────────────────────────────────────────────────────
 * 광원
 * ────────────────────────────────────────────────────────────── */

/**
 * 부품 로컬 좌표계에서의 광원 방향.
 * lx ∈ [-1,1] 이 좌우, ly 가 상하. 기본값은 왼쪽 위에서 비추는 스튜디오 조명.
 */
export function lightOf(state) {
  const l = state?.light;
  if (!l) return { x: -0.55, y: 0.35, ambient: 0.34 };
  const len = Math.hypot(l.x, l.y) || 1;
  return {
    x: l.x / len,
    y: l.y / len,
    ambient: l.ambient ?? 0.22,
  };
}

/* ──────────────────────────────────────────────────────────────
 * 원통 셰이딩
 * ────────────────────────────────────────────────────────────── */

/**
 * 금속/도장 원통의 가로 방향 그라디언트.
 *
 * 실제 원통은 광원 쪽에 좁고 밝은 스페큘러가 서고, 반대쪽 가장자리에는
 * 주변광이 반사되는 얇은 림 라이트가 생긴다. 그 두 가지를 같이 넣어야
 * "칠한 사각형" 이 아니라 "둥근 통" 으로 보인다.
 *
 * @param {number} w 폭(미터)
 * @param {string} base 기본 색
 * @param {object} opts { lightX, roughness(0=거울,1=무광), metal(0..1), ambient }
 */
export function cylinderShade(ctx, w, base, opts = {}) {
  const lightX = clamp(opts.lightX ?? -0.55, -1, 1);
  const rough = clamp01(opts.roughness ?? 0.45);
  const metal = clamp01(opts.metal ?? 0.75);
  const ambient = clamp01(opts.ambient ?? 0.3);

  // 스페큘러 위치: 광원 방향 쪽으로 치우친다
  const specPos = clamp(0.5 + lightX * 0.34, 0.12, 0.88);
  const specWidth = lerp(0.06, 0.3, rough);

  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  const dark = shade(base, -0.62 + ambient * 0.5);
  const mid = shade(base, -0.16);
  const lit = shade(base, lerp(0.12, 0.5, metal));
  const spec = mixHex(lit, '#ffffff', lerp(0.25, 0.85, metal) * (1 - rough * 0.55));
  const rim = shade(base, -0.3 + ambient * 0.7);

  g.addColorStop(0, dark);
  g.addColorStop(clamp01(specPos - specWidth * 2.2), mid);
  g.addColorStop(clamp01(specPos - specWidth), lit);
  g.addColorStop(specPos, spec);
  g.addColorStop(clamp01(specPos + specWidth), lit);
  g.addColorStop(clamp01(specPos + specWidth * 2.4), mid);
  g.addColorStop(0.94, dark);
  // 반대쪽 가장자리 림 라이트 (주변광 반사)
  g.addColorStop(1, rim);
  return g;
}

/**
 * 구체 셰이딩 — 광원 방향에서 오는 방사형 그라디언트.
 */
export function sphereShade(ctx, r, base, opts = {}) {
  const lx = opts.lightX ?? -0.55;
  const ly = opts.lightY ?? 0.35;
  const metal = clamp01(opts.metal ?? 0.6);
  const g = ctx.createRadialGradient(
    lx * r * 0.45,
    -ly * r * 0.45,
    r * 0.05,
    0,
    0,
    r * 1.05
  );
  g.addColorStop(0, mixHex(shade(base, 0.45), '#ffffff', metal * 0.5));
  g.addColorStop(0.28, shade(base, 0.12));
  g.addColorStop(0.7, shade(base, -0.22));
  g.addColorStop(1, shade(base, -0.62));
  return g;
}

/**
 * 원뿔/테이퍼 셰이딩 — 위아래 폭이 다른 몸체용.
 */
export function taperShade(ctx, wTop, wBottom, h, base, opts = {}) {
  const w = Math.max(wTop, wBottom);
  return cylinderShade(ctx, w, base, opts);
}

/* ──────────────────────────────────────────────────────────────
 * 가장자리 처리
 * ────────────────────────────────────────────────────────────── */

/**
 * 상하 끝단 앰비언트 오클루전 — 부품이 맞닿는 곳을 어둡게.
 * 이게 없으면 스택이 통짜 막대처럼 보인다.
 */
export function endCapAO(ctx, w, h, opts = {}) {
  const depth = opts.depth ?? h * 0.055;
  const strength = opts.strength ?? 0.42;

  const top = ctx.createLinearGradient(0, h / 2, 0, h / 2 - depth);
  top.addColorStop(0, `rgba(0,0,0,${strength})`);
  top.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = top;
  ctx.fillRect(-w / 2, h / 2 - depth, w, depth);

  const bot = ctx.createLinearGradient(0, -h / 2, 0, -h / 2 + depth);
  bot.addColorStop(0, `rgba(0,0,0,${strength})`);
  bot.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bot;
  ctx.fillRect(-w / 2, -h / 2, w, depth);
}

/**
 * 접합 링 — 단과 단 사이의 금속 밴드.
 */
export function jointRing(ctx, w, y, thickness, base, lightX = -0.55) {
  ctx.fillStyle = cylinderShade(ctx, w, base, {
    lightX,
    roughness: 0.3,
    metal: 0.9,
  });
  ctx.fillRect(-w / 2, y - thickness / 2, w, thickness);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(-w / 2, y - thickness / 2, w, thickness * 0.14);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(-w / 2, y + thickness / 2 - thickness * 0.12, w, thickness * 0.12);
}

/* ──────────────────────────────────────────────────────────────
 * 표면 디테일
 * ────────────────────────────────────────────────────────────── */

/**
 * 가로 패널 이음선. 어두운 선 + 바로 아래 밝은 선이 한 쌍이어야
 * 판이 겹쳐진 것처럼 보인다.
 */
export function panelSeams(ctx, w, h, count, opts = {}) {
  if (count < 1) return;
  const alpha = opts.alpha ?? 0.34;
  const inset = opts.inset ?? 0;
  ctx.lineWidth = opts.width ?? Math.min(0.02, h * 0.01);
  for (let i = 1; i <= count; i++) {
    const y = -h / 2 + (h * i) / (count + 1);
    ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + inset, y);
    ctx.lineTo(w / 2 - inset, y);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.4})`;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + inset, y + ctx.lineWidth * 1.1);
    ctx.lineTo(w / 2 - inset, y + ctx.lineWidth * 1.1);
    ctx.stroke();
  }
}

/**
 * 세로 보강 리브 — 압력 탱크나 구조물의 세로줄.
 */
export function verticalRibs(ctx, w, h, count, lightX = -0.55, alpha = 0.2) {
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const x = -w / 2 + w * t;
    // 광원 반대쪽 리브가 더 진하게 보인다
    const facing = clamp01(0.5 + (t - 0.5) * 2 * -lightX);
    ctx.fillStyle = `rgba(0,0,0,${alpha * (0.4 + facing * 0.6)})`;
    ctx.fillRect(x - w * 0.008, -h / 2, w * 0.016, h);
    ctx.fillStyle = `rgba(255,255,255,${alpha * 0.35 * facing})`;
    ctx.fillRect(x + w * 0.008, -h / 2, w * 0.008, h);
  }
}

/** 리벳 열 */
export function rivetRow(ctx, w, y, count, size, lightX = -0.55) {
  const r = size;
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / count;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.arc(x - lightX * r * 0.3, y - r * 0.25, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath();
    ctx.arc(x + lightX * r * 0.25, y + r * 0.2, r * 0.7, 0, TAU);
    ctx.fill();
  }
}

/**
 * 미세 표면 결 — 노이즈 패턴을 아주 옅게 덮는다.
 * 순색 면이 사라져서 "플라스틱 느낌" 이 줄어든다.
 */
/**
 * 현재 그리는 부품 정보. drawPart 가 부품마다 갱신하면 surfaceGrain 이
 * 재질 종류와 고유 시드를 알아서 고른다 (아트 함수 44개를 고치지 않아도 된다).
 */
let _surfCtx = { material: 'brushed', seed: 0, wear: 1 };
export function setSurfaceContext(def, state) {
  const o = def?.artOpts ?? {};
  let material = o.material;
  if (!material) {
    const art = def?.art ?? '';
    if (art === 'solar' || art === 'probe' || art === 'battery') material = 'foil';
    else if (art === 'fairing' || art === 'nosecone' || art === 'heatshield') material = 'paint';
    else if (art === 'wing' || art === 'fin' || art === 'strut') material = 'carbon';
    else material = 'brushed';
  }
  // 부품 uid 로 시드를 만들어 같은 종류라도 얼룩 위치가 다르게
  let seed = 0;
  const id = state?.uid ?? def?.id ?? '';
  for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) % 997;
  _surfCtx = {
    material,
    seed: seed / 997,
    wear: clamp01(0.35 + (state?.soot ?? 0) * 0.9 + (state?.wear ?? 0)),
  };
}

export function surfaceGrain(ctx, w, h, amount = 0.06, scale = 0.02, opts = {}) {
  if (amount <= 0.004) return;
  // 호출부는 "약간" 을 뜻하는 작은 값을 넘긴다. 실제 표면 정보가
  // 눈에 보이려면 그보다 강해야 한다.
  const a = clamp01(amount * 2.8);
  opts = { ..._surfCtx, ...opts };
  // 1) 재질 고유의 결 — 압연 금속 / 도장 오렌지필 / 탄소 위브 / 금박 주름
  const kind = opts.material ?? 'brushed';
  const grain = {
    brushed: { tex: 'brushed', alpha: 1.9, scale: 0.0042, rotate: 0 },
    paint: { tex: 'paint', alpha: 1.4, scale: 0.0038, rotate: 0 },
    carbon: { tex: 'carbon', alpha: 1.8, scale: 0.0022, rotate: 0.4 },
    foil: { tex: 'foil', alpha: 2.2, scale: 0.006, rotate: 0.2 },
    rough: { tex: 'regolith', alpha: 1.7, scale: 0.005, rotate: 0 },
  }[kind] ?? { tex: 'brushed', alpha: 1.9, scale: 0.0042, rotate: 0 };

  paintTexture(ctx, grain.tex, w, h, {
    alpha: a * grain.alpha,
    scale: grain.scale * (opts.grainScale ?? 1),
    rotate: grain.rotate,
    mode: 'overlay',
  });

  // 2) 때·얼룩 — 큰 스케일이라 같은 부품이라도 면마다 달라 보인다
  paintTexture(ctx, 'grime', w, h, {
    alpha: a * (opts.grime ?? 1.1),
    scale: Math.max(w, h) * 0.012,
    mode: 'overlay',
    offsetX: (opts.seed ?? 0) * 0.37,
    offsetY: (opts.seed ?? 0) * 0.61,
  });

  // 3) 긁힘 — 사용 흔적
  if ((opts.wear ?? 1) > 0.01) {
    paintTexture(ctx, 'scratch', w, h, {
      alpha: a * 1.0 * (opts.wear ?? 1),
      scale: 0.0035,
      mode: 'overlay',
    });
  }
}

/**
 * 모서리 마모 — 실제 기체는 각진 모서리의 도장이 벗겨져 금속이 드러난다.
 */
export function edgeWear(ctx, w, h, amount = 0.3, color = '#cfd6dd') {
  if (amount <= 0.01) return;
  const t = Math.min(w, h) * 0.06;
  ctx.save();
  ctx.globalAlpha = clamp01(amount) * 0.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = t * 0.5;
  ctx.setLineDash([t * 2.5, t * 5.5, t * 1.2, t * 7]);
  ctx.strokeRect(-w / 2 + t * 0.25, -h / 2 + t * 0.25, w - t * 0.5, h - t * 0.5);
  ctx.setLineDash([]);
  ctx.restore();
}

/**
 * 접촉 그림자 — 부품이 맞닿은 곳은 빛이 들어가지 못해 어둡다.
 * 위/아래 양쪽으로 좁고 진한 그라디언트를 깐다.
 */
export function contactShadow(ctx, w, h, opts = {}) {
  const depth = opts.depth ?? Math.min(h * 0.12, w * 0.22);
  const strength = opts.strength ?? 0.3;
  if (depth <= 0) return;
  ctx.save();
  const g = ctx.createLinearGradient(0, h / 2, 0, h / 2 - depth);
  g.addColorStop(0, `rgba(0,0,0,${strength})`);
  g.addColorStop(0.5, `rgba(0,0,0,${strength * 0.28})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-w / 2, h / 2 - depth, w, depth);
  ctx.restore();
}

/**
 * 그을음 — 엔진 근처 아래쪽이 검게 탄다.
 */
export function sootStain(ctx, w, h, amount = 0.5, fromBottom = true) {
  if (amount <= 0.01) return;
  const reach = h * lerp(0.15, 0.6, clamp01(amount));
  const y0 = fromBottom ? -h / 2 : h / 2;
  const y1 = fromBottom ? -h / 2 + reach : h / 2 - reach;
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, `rgba(18,16,15,${0.72 * amount})`);
  g.addColorStop(0.45, `rgba(30,26,24,${0.3 * amount})`);
  g.addColorStop(1, 'rgba(30,26,24,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-w / 2, Math.min(y0, y1), w, reach);
}

/**
 * 열 변색 — 가열된 금속의 파랑→보라→짚색 무지개.
 */
export function heatTint(ctx, w, h, heat) {
  const t = clamp01(heat);
  if (t < 0.02) return;
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, withAlpha('#ffb45a', 0.5 * t));
  g.addColorStop(0.4, withAlpha('#a05a8a', 0.3 * t));
  g.addColorStop(1, withAlpha('#5a7ab0', 0.12 * t));
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = g;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

/** 적열 — 아주 뜨거우면 스스로 빛난다 */
export function incandescence(ctx, w, h, heat) {
  const t = clamp01((heat - 0.55) / 0.45);
  if (t <= 0) return;
  const color = t > 0.75 ? '#ffe9b0' : t > 0.4 ? '#ff8a3a' : '#c03a18';
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = withAlpha(color, 0.55 * t);
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
}

/* ──────────────────────────────────────────────────────────────
 * 도색 / 마킹
 * ────────────────────────────────────────────────────────────── */

/** 도색 띠 (경계에 약간의 벗겨짐) */
export function paintBand(ctx, w, y, height, color, opts = {}) {
  const lightX = opts.lightX ?? -0.55;
  ctx.fillStyle = cylinderShade(ctx, w, color, {
    lightX,
    roughness: 0.72,
    metal: 0.12,
    ambient: 0.34,
  });
  ctx.fillRect(-w / 2, y, w, height);
  // 도료 두께가 만드는 얇은 그림자
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(-w / 2, y, w, height * 0.08);
  ctx.fillRect(-w / 2, y + height - height * 0.06, w, height * 0.06);
}

/** 경고 사선 (검정/노랑) */
export function hazardStripes(ctx, w, y, height, opts = {}) {
  const step = opts.step ?? height * 0.9;
  ctx.save();
  ctx.beginPath();
  ctx.rect(-w / 2, y, w, height);
  ctx.clip();
  ctx.fillStyle = opts.color ?? '#e0a83a';
  ctx.fillRect(-w / 2, y, w, height);
  ctx.fillStyle = 'rgba(20,18,14,0.88)';
  for (let x = -w / 2 - height; x < w / 2 + height; x += step * 2) {
    ctx.beginPath();
    ctx.moveTo(x, y + height);
    ctx.lineTo(x + step, y + height);
    ctx.lineTo(x + step + height, y);
    ctx.lineTo(x + height, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** 창문 — 유리 반사와 내부 어둠 */
export function porthole(ctx, x, y, r, opts = {}) {
  const lightX = opts.lightX ?? -0.55;
  ctx.save();
  ctx.translate(x, y);

  // 테두리 금속 링
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.24, 0, TAU);
  ctx.fillStyle = sphereShade(ctx, r * 1.24, '#b8bfc6', { lightX, metal: 0.9 });
  ctx.fill();

  // 유리 — 안쪽은 깊고 어둡다
  const glass = ctx.createRadialGradient(
    lightX * r * 0.4,
    r * 0.3,
    r * 0.05,
    0,
    0,
    r
  );
  if (opts.lit) {
    glass.addColorStop(0, '#ffeab0');
    glass.addColorStop(0.55, '#c09a4e');
    glass.addColorStop(1, '#4a3a1c');
  } else {
    glass.addColorStop(0, '#4a6f90');
    glass.addColorStop(0.55, '#1f3448');
    glass.addColorStop(1, '#0b1620');
  }
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = glass;
  ctx.fill();

  // 유리 반사 하이라이트
  ctx.beginPath();
  ctx.ellipse(lightX * r * 0.35, r * 0.34, r * 0.52, r * 0.24, -0.5, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.fill();
  ctx.restore();
}

/* ──────────────────────────────────────────────────────────────
 * 노즐
 * ────────────────────────────────────────────────────────────── */

/**
 * 종 모양 노즐. 안쪽은 어둡고 바깥은 금속, 냉각 채널이 보인다.
 */
export function nozzleBell(ctx, opts) {
  const { throatW, exitW, top, bottom } = opts;
  const lightX = opts.lightX ?? -0.55;
  const heat = clamp01(opts.heat ?? 0);
  const base = opts.color ?? '#8a929a';

  const h = top - bottom;
  ctx.beginPath();
  ctx.moveTo(-throatW / 2, top);
  ctx.bezierCurveTo(
    -throatW * 0.62,
    top - h * 0.45,
    -exitW * 0.47,
    bottom + h * 0.3,
    -exitW / 2,
    bottom
  );
  ctx.lineTo(exitW / 2, bottom);
  ctx.bezierCurveTo(
    exitW * 0.47,
    bottom + h * 0.3,
    throatW * 0.62,
    top - h * 0.45,
    throatW / 2,
    top
  );
  ctx.closePath();

  const shell = cylinderShade(ctx, exitW, base, {
    lightX,
    roughness: 0.35,
    metal: 0.85,
  });
  ctx.fillStyle = shell;
  ctx.fill();

  // 냉각 채널 (세로 줄)
  ctx.save();
  ctx.clip();
  const channels = Math.max(6, Math.round(exitW * 7));
  for (let i = 0; i <= channels; i++) {
    const t = i / channels - 0.5;
    const facing = clamp01(0.5 + t * 2 * -lightX);
    ctx.strokeStyle = `rgba(0,0,0,${0.1 + facing * 0.16})`;
    ctx.lineWidth = exitW * 0.012;
    ctx.beginPath();
    ctx.moveTo(throatW * t, top);
    ctx.lineTo(exitW * t, bottom);
    ctx.stroke();
  }
  // 안쪽 그림자 — 노즐 내부는 깊다
  const inner = ctx.createLinearGradient(0, bottom, 0, top);
  inner.addColorStop(0, 'rgba(0,0,0,0.55)');
  inner.addColorStop(0.5, 'rgba(0,0,0,0.18)');
  inner.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = inner;
  ctx.fillRect(-exitW / 2, bottom, exitW, h);

  // 연소로 인한 그을음과 적열
  if (heat > 0.02) {
    const hg = ctx.createLinearGradient(0, bottom, 0, top);
    hg.addColorStop(0, withAlpha(heat > 0.6 ? '#ffcf7a' : '#d05a28', 0.7 * heat));
    hg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = hg;
    ctx.fillRect(-exitW / 2, bottom, exitW, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();

  // 출구 립
  ctx.strokeStyle = withAlpha(shade(base, 0.35), 0.8);
  ctx.lineWidth = exitW * 0.02;
  ctx.beginPath();
  ctx.moveTo(-exitW / 2, bottom);
  ctx.lineTo(exitW / 2, bottom);
  ctx.stroke();
}

/* ──────────────────────────────────────────────────────────────
 * 공통 마감
 * ────────────────────────────────────────────────────────────── */

/** 얇은 외곽선 — 너무 진하면 만화처럼 보이므로 아주 옅게 */
export function outline(ctx, alpha = 0.32, width = 0.018) {
  ctx.strokeStyle = `rgba(10,14,18,${alpha})`;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** 사각형 경로 */
export function rectPath(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
}

/** 둥근 사각형 경로 */
export function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** 다각형 경로 */
export function polyPath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** 자주 쓰는 색 */
export const MAT = {
  steel: '#b9c0c8',
  aluminium: '#cdd4db',
  titanium: '#9aa3ab',
  darkMetal: '#6b737b',
  carbon: '#2e3338',
  gold: '#d9b154',
  copper: '#b5713c',
  paintWhite: '#eef2f5',
  paintOrange: '#cf6a30',
  paintRed: '#b8392c',
  paintBlack: '#23272b',
  insulation: '#d8c48a',
  solarCell: '#16345e',
};
