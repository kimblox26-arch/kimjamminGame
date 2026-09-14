// ORBITER — 부품 아트
//
// 좌표계는 "1 단위 = 1 미터, 원점 = 부품 중심, +y 가 위".
// 호출자가 ctx.scale(ppm, -ppm) 으로 뒤집어 두므로 수학 좌표 그대로 쓴다.
// (텍스트는 뒤집히므로 여기서는 그리지 않는다)
//
// 모든 부품은 materials.js 의 셰이딩 도구를 쓴다. 핵심은:
//   · 광원 방향을 따라 움직이는 스페큘러      → 둥글어 보인다
//   · 끝단 AO 와 접합 링                      → 스택이 통짜로 안 보인다
//   · 패널 이음선 · 리벳 · 미세 결             → 크기감이 생긴다
//   · 그을음 · 열 변색 · 적열                  → 쓰던 물건처럼 보인다

import { clamp, clamp01, lerp, mixHex, withAlpha, shade, TAU } from '../core/math.js';
import {
  MAT,
  lightOf,
  cylinderShade,
  sphereShade,
  endCapAO,
  jointRing,
  panelSeams,
  verticalRibs,
  rivetRow,
  surfaceGrain,
  sootStain,
  heatTint,
  incandescence,
  paintBand,
  hazardStripes,
  porthole,
  nozzleBell,
  outline,
  rectPath,
  roundRectPath,
  polyPath,
  setSurfaceContext,
  edgeWear,
  contactShadow,
} from './materials.js';

const ART = {};

/** 디테일 레벨 — 화면에서 작게 보이면 잔디테일을 생략한다 */
const detailOf = (s) => (s?.detail === undefined ? 1 : clamp01(s.detail));

/* ──────────────────────────────────────────────────────────────
 * 조종부
 * ────────────────────────────────────────────────────────────── */

/* 재진입 캡슐 */
ART.capsule = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  const d = detailOf(s);
  const topW = w * 0.44;
  const heat = clamp01(s?.heat ?? 0);

  // 동체 (원뿔대)
  polyPath(ctx, [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [topW / 2, h / 2],
    [-topW / 2, h / 2],
  ]);
  ctx.fillStyle = cylinderShade(ctx, w, '#cfd6dd', {
    lightX: L.x,
    roughness: 0.5,
    metal: 0.72,
    ambient: L.ambient,
  });
  ctx.fill();

  ctx.save();
  ctx.clip();
  // 열 차폐 타일 무늬
  if (d > 0.4) {
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 0.012;
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      const y = -h / 2 + h * t;
      ctx.beginPath();
      ctx.moveTo(-w / 2, y);
      ctx.lineTo(w / 2, y);
      ctx.stroke();
    }
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo((i * w) / 7, -h / 2);
      ctx.lineTo((i * topW) / 7, h / 2);
      ctx.stroke();
    }
  }
  surfaceGrain(ctx, w, h, 0.08 * d);
  heatTint(ctx, w, h, heat);
  ctx.restore();

  // 하단 삭마 열차폐 (볼록한 접시)
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.quadraticCurveTo(0, -h / 2 - w * 0.2, w / 2, -h / 2);
  ctx.closePath();
  const shieldBase = heat > 0.02 ? mixHex('#3b312a', '#ff6a24', heat) : '#3b312a';
  ctx.fillStyle = cylinderShade(ctx, w, shieldBase, {
    lightX: L.x,
    roughness: 0.95,
    metal: 0.05,
    ambient: L.ambient,
  });
  ctx.fill();
  if (heat > 0.5) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = withAlpha('#ffb05a', (heat - 0.5) * 0.9);
    ctx.fill();
    ctx.restore();
  }

  // 창문
  if (d > 0.25) {
    porthole(ctx, -w * 0.16, h * 0.16, w * 0.11, {
      lightX: L.x,
      lit: s?.lightOn,
    });
    porthole(ctx, w * 0.16, h * 0.16, w * 0.11, {
      lightX: L.x,
      lit: s?.lightOn,
    });
  }

  // 도킹 링
  jointRing(ctx, topW * 1.06, h / 2 - h * 0.03, h * 0.06, MAT.steel, L.x);
  endCapAO(ctx, w, h, { strength: 0.3 });
};

/* 유선형 조종석 */
ART.cockpit = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);

  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  ctx.quadraticCurveTo(w * 0.44, h * 0.4, 0, h / 2);
  ctx.quadraticCurveTo(-w * 0.44, h * 0.4, -w / 2, -h / 2);
  ctx.closePath();
  ctx.fillStyle = cylinderShade(ctx, w, MAT.paintWhite, {
    lightX: L.x,
    roughness: 0.3,
    metal: 0.55,
    ambient: L.ambient,
  });
  ctx.fill();
  ctx.save();
  ctx.clip();
  surfaceGrain(ctx, w, h, 0.05);
  ctx.restore();

  // 캐노피 유리
  ctx.beginPath();
  ctx.moveTo(-w * 0.3, h * 0.02);
  ctx.quadraticCurveTo(0, h * 0.44, w * 0.3, h * 0.02);
  ctx.quadraticCurveTo(0, h * 0.16, -w * 0.3, h * 0.02);
  const g = ctx.createLinearGradient(-w * 0.3, 0, w * 0.3, h * 0.3);
  g.addColorStop(0, '#3b6d95');
  g.addColorStop(0.45, '#16293a');
  g.addColorStop(1, '#5b8fb5');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 0.015;
  ctx.stroke();
  endCapAO(ctx, w, h, { strength: 0.28 });
};

/* 무인 탐사 코어 */
ART.probe = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  const adv = def.artOpts?.advanced;

  roundRectPath(ctx, -w / 2, -h / 2, w, h, h * 0.16);
  ctx.fillStyle = cylinderShade(ctx, w, adv ? '#8f98a2' : '#9aa3ad', {
    lightX: L.x,
    roughness: 0.42,
    metal: 0.8,
    ambient: L.ambient,
  });
  ctx.fill();
  outline(ctx, 0.3);

  // 금박 단열재
  ctx.fillStyle = withAlpha(MAT.gold, 0.55);
  ctx.fillRect(-w / 2, -h / 2 + h * 0.1, w, h * 0.22);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(-w / 2, -h / 2 + h * 0.1, w, h * 0.04);

  // 상태등
  const glow = adv ? '#63f0b0' : '#f0a63a';
  ctx.beginPath();
  ctx.arc(0, h * 0.06, Math.min(w, h) * 0.14, 0, TAU);
  ctx.fillStyle = glow;
  ctx.fill();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const lg = ctx.createRadialGradient(0, h * 0.06, 0, 0, h * 0.06, w * 0.3);
  lg.addColorStop(0, withAlpha(glow, 0.5));
  lg.addColorStop(1, withAlpha(glow, 0));
  ctx.fillStyle = lg;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
  endCapAO(ctx, w, h, { strength: 0.3 });
};

/* 착륙선 캐빈 */
ART.landercan = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  const d = detailOf(s);

  roundRectPath(ctx, -w / 2, -h / 2, w, h, w * 0.1);
  ctx.fillStyle = cylinderShade(ctx, w, '#d2d8de', {
    lightX: L.x,
    roughness: 0.55,
    metal: 0.6,
    ambient: L.ambient,
  });
  ctx.fill();

  ctx.save();
  ctx.clip();
  // 금박 단열 담요
  const foil = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  foil.addColorStop(0, shade(MAT.gold, -0.45));
  foil.addColorStop(0.4, shade(MAT.gold, 0.3));
  foil.addColorStop(0.55, '#ffe9a8');
  foil.addColorStop(1, shade(MAT.gold, -0.5));
  ctx.fillStyle = foil;
  ctx.fillRect(-w / 2, -h / 2, w, h * 0.3);
  if (d > 0.4) {
    // 구겨진 주름
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 0.012;
    for (let i = 0; i < 14; i++) {
      const x = -w / 2 + (w * i) / 14;
      ctx.beginPath();
      ctx.moveTo(x, -h / 2);
      ctx.lineTo(x + (i % 3) * 0.04 - 0.04, -h / 2 + h * 0.3);
      ctx.stroke();
    }
  }
  panelSeams(ctx, w, h, 2, { alpha: 0.24 });
  surfaceGrain(ctx, w, h, 0.07 * d);
  ctx.restore();

  if (d > 0.25) {
    for (let i = -1; i <= 1; i++) {
      porthole(ctx, i * w * 0.27, h * 0.12, w * 0.085, {
        lightX: L.x,
        lit: s?.lightOn,
      });
    }
  }
  endCapAO(ctx, w, h, { strength: 0.34 });
};

/* ──────────────────────────────────────────────────────────────
 * 탱크
 * ────────────────────────────────────────────────────────────── */

ART.tank = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const o = def.artOpts ?? {};
  const L = lightOf(s);
  const d = detailOf(s);
  const base = o.color ?? MAT.aluminium;

  rectPath(ctx, -w / 2, -h / 2, w, h);
  ctx.fillStyle = cylinderShade(ctx, w, base, {
    lightX: L.x,
    roughness: o.ribs ? 0.55 : 0.32,
    metal: 0.85,
    ambient: L.ambient,
  });
  ctx.fill();

  ctx.save();
  ctx.clip();

  // 세로 리브
  if (o.ribs && d > 0.35) verticalRibs(ctx, w, h, 10, L.x, 0.22);

  // 가로 용접선 — 1.25 m 탱크는 대략 1.5 m 마다 판이 이어진다
  if (d > 0.3) {
    const seams = clamp(Math.round(h / 1.4), 1, 8);
    panelSeams(ctx, w, h, seams, { alpha: 0.3 });
    if (d > 0.6) {
      for (let i = 1; i <= seams; i++) {
        const y = -h / 2 + (h * i) / (seams + 1);
        rivetRow(ctx, w * 0.92, y - 0.05, Math.round(w * 7), w * 0.012, L.x);
      }
    }
  }

  // 도색 띠
  if (o.stripes) {
    const bandH = Math.min(h * 0.1, 0.3);
    paintBand(ctx, w, h * 0.5 - bandH * 1.7, bandH, MAT.paintOrange, { lightX: L.x });
    paintBand(ctx, w, -h * 0.5 + bandH * 0.6, bandH, MAT.paintOrange, { lightX: L.x });
  }
  if (o.bands) {
    for (const t of [0.3, 0.7]) {
      paintBand(ctx, w, -h / 2 + h * t, h * 0.05, MAT.paintBlack, { lightX: L.x });
    }
  }

  surfaceGrain(ctx, w, h, 0.09 * d);

  // 잔량 표시 — 연료가 줄면 아래쪽이 살짝 서늘하게 비친다
  const frac = s?.fuelFraction;
  if (frac !== undefined && frac < 0.999) {
    const y = -h / 2 + h * clamp01(frac);
    const cold = ctx.createLinearGradient(0, -h / 2, 0, y);
    cold.addColorStop(0, 'rgba(150,190,220,0.16)');
    cold.addColorStop(1, 'rgba(150,190,220,0)');
    ctx.fillStyle = cold;
    ctx.fillRect(-w / 2, -h / 2, w, h * clamp01(frac));
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    ctx.moveTo(-w / 2, y);
    ctx.lineTo(w / 2, y);
    ctx.stroke();
  }

  sootStain(ctx, w, h, (s?.soot ?? 0) * 0.8);
  heatTint(ctx, w, h, s?.heat ?? 0);
  ctx.restore();

  // 상하 접합 링
  jointRing(ctx, w * 1.012, h / 2 - h * 0.022, h * 0.045, MAT.darkMetal, L.x);
  jointRing(ctx, w * 1.012, -h / 2 + h * 0.022, h * 0.045, MAT.darkMetal, L.x);
  endCapAO(ctx, w, h);
  incandescence(ctx, w, h, s?.heat ?? 0);
};

ART.spheretank = (ctx, def, s) => {
  const r = Math.min(def.size.w, def.size.h) / 2;
  const L = lightOf(s);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = sphereShade(ctx, r, MAT.aluminium, {
    lightX: L.x,
    lightY: L.y,
    metal: 0.85,
  });
  ctx.fill();
  // 적도 용접선
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 0.022;
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.12, 0, 0, TAU);
  ctx.stroke();
  // 스페큘러 하이라이트
  ctx.beginPath();
  ctx.ellipse(L.x * r * 0.42, -L.y * r * 0.42, r * 0.28, r * 0.16, -0.6, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fill();
  outline(ctx, 0.28);
};

/* ──────────────────────────────────────────────────────────────
 * 엔진
 * ────────────────────────────────────────────────────────────── */

ART.engine = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const o = def.artOpts ?? {};
  const L = lightOf(s);
  const d = detailOf(s);
  const power = clamp01(s?.enginePower ?? 0);
  const bell = (o.bellRatio ?? 1) * w * 0.5;

  // 상부 터보펌프 블록
  roundRectPath(ctx, -w * 0.34, h * 0.08, w * 0.68, h * 0.42, w * 0.05);
  ctx.fillStyle = cylinderShade(ctx, w * 0.68, MAT.titanium, {
    lightX: L.x,
    roughness: 0.4,
    metal: 0.9,
    ambient: L.ambient,
  });
  ctx.fill();
  outline(ctx, 0.35);

  // 배관 — 엔진다운 복잡함의 핵심
  if (d > 0.35) {
    ctx.strokeStyle = shade(MAT.steel, -0.25);
    ctx.lineWidth = w * 0.035;
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * w * 0.3, h * 0.46);
      ctx.bezierCurveTo(
        side * w * 0.46,
        h * 0.3,
        side * w * 0.4,
        h * 0.16,
        side * w * 0.2,
        h * 0.1
      );
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = w * 0.012;
      ctx.stroke();
      ctx.strokeStyle = shade(MAT.steel, -0.25);
      ctx.lineWidth = w * 0.035;
    }
  }

  // 짐벌 링
  if (o.gimbalRing) {
    ctx.beginPath();
    ctx.arc(0, h * 0.1, w * 0.2, 0, TAU);
    ctx.strokeStyle = shade(MAT.darkMetal, 0.2);
    ctx.lineWidth = w * 0.05;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = w * 0.014;
    ctx.stroke();
  }

  // 노즐
  nozzleBell(ctx, {
    throatW: w * 0.34,
    exitW: bell * 2,
    top: h * 0.12,
    bottom: -h / 2,
    lightX: L.x,
    heat: power,
    color: o.vacuum ? '#9aa2ab' : '#7f878f',
  });

  // 그을음
  ctx.save();
  polyPath(ctx, [
    [-bell, -h / 2],
    [bell, -h / 2],
    [w * 0.2, h * 0.12],
    [-w * 0.2, h * 0.12],
  ]);
  ctx.clip();
  sootStain(ctx, bell * 2, h, 0.55);
  ctx.restore();
};

ART.srb = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  const d = detailOf(s);
  const stripe = def.artOpts?.stripe ?? MAT.paintWhite;
  const power = clamp01(s?.enginePower ?? 0);
  const bodyTop = h / 2;
  const bodyBottom = -h / 2 + w * 0.22;

  // 몸통
  rectPath(ctx, -w / 2, bodyBottom, w, bodyTop - bodyBottom);
  ctx.fillStyle = cylinderShade(ctx, w, stripe, {
    lightX: L.x,
    roughness: 0.68,
    metal: 0.25,
    ambient: L.ambient,
  });
  ctx.fill();

  ctx.save();
  ctx.clip();
  // 분절 이음부 — 고체 부스터의 상징
  const seg = clamp(Math.round(h / 1.5), 1, 7);
  for (let i = 1; i <= seg; i++) {
    const y = bodyBottom + ((bodyTop - bodyBottom) * i) / (seg + 1);
    jointRing(ctx, w, y, h * 0.02 + 0.04, shade(stripe, -0.3), L.x);
    if (d > 0.6) rivetRow(ctx, w * 0.94, y, Math.round(w * 8), w * 0.011, L.x);
  }
  surfaceGrain(ctx, w, h, 0.08 * d);
  sootStain(ctx, w, h, 0.35 + power * 0.4);
  ctx.restore();

  // 노즈 캡 (상부 원뿔)
  ctx.beginPath();
  ctx.moveTo(-w / 2, bodyTop);
  ctx.quadraticCurveTo(0, bodyTop + w * 0.3, w / 2, bodyTop);
  ctx.closePath();
  ctx.fillStyle = cylinderShade(ctx, w, shade(stripe, -0.12), {
    lightX: L.x,
    roughness: 0.6,
    metal: 0.3,
  });
  ctx.fill();

  // 하단 노즐
  nozzleBell(ctx, {
    throatW: w * 0.3,
    exitW: w * 0.66,
    top: bodyBottom,
    bottom: -h / 2,
    lightX: L.x,
    heat: power,
    color: '#5e666e',
  });
};

ART.nuclear = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  const power = clamp01(s?.enginePower ?? 0);

  // 방사선 차폐 원반
  roundRectPath(ctx, -w * 0.54, h * 0.2, w * 1.08, h * 0.09, 0.04);
  ctx.fillStyle = cylinderShade(ctx, w * 1.08, MAT.darkMetal, {
    lightX: L.x,
    roughness: 0.5,
    metal: 0.8,
  });
  ctx.fill();

  // 원자로 본체
  rectPath(ctx, -w * 0.37, -h * 0.04, w * 0.74, h * 0.28);
  ctx.fillStyle = cylinderShade(ctx, w * 0.74, '#aab2ba', {
    lightX: L.x,
    roughness: 0.35,
    metal: 0.9,
  });
  ctx.fill();
  ctx.save();
  ctx.clip();
  panelSeams(ctx, w * 0.74, h * 0.28, 3, { alpha: 0.3 });
  ctx.restore();
  outline(ctx, 0.32);

  // 방열 핀
  ctx.fillStyle = shade(MAT.titanium, -0.2);
  for (let i = 0; i < 5; i++) {
    const y = h * 0.02 + i * h * 0.045;
    ctx.fillRect(-w * 0.52, y, w * 1.04, h * 0.012);
  }

  // 방사능 마크
  ctx.fillStyle = '#f0c419';
  ctx.beginPath();
  ctx.arc(0, h * 0.12, w * 0.075, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.12);
    ctx.arc(0, h * 0.12, w * 0.075, a - 0.35, a + 0.35);
    ctx.closePath();
    ctx.fill();
  }

  nozzleBell(ctx, {
    throatW: w * 0.3,
    exitW: w * 0.94,
    top: -h * 0.04,
    bottom: -h / 2,
    lightX: L.x,
    heat: power * 0.7,
    color: '#7d858d',
  });
  // 핵열 배기는 푸르스름하다
  if (power > 0.05) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, -h / 2, 0, -h * 0.1);
    g.addColorStop(0, withAlpha('#9fd8ff', 0.5 * power));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-w * 0.47, -h / 2, w * 0.94, h * 0.4);
    ctx.restore();
  }
};

ART.ion = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  const power = clamp01(s?.enginePower ?? 0);

  roundRectPath(ctx, -w * 0.46, -h * 0.08, w * 0.92, h * 0.58, 0.03);
  ctx.fillStyle = cylinderShade(ctx, w * 0.92, '#8d949c', {
    lightX: L.x,
    roughness: 0.45,
    metal: 0.85,
  });
  ctx.fill();
  outline(ctx, 0.32);

  // 격자 (가속 그리드)
  polyPath(ctx, [
    [-w * 0.46, -h * 0.08],
    [-w * 0.5, -h / 2],
    [w * 0.5, -h / 2],
    [w * 0.46, -h * 0.08],
  ]);
  ctx.fillStyle = '#2f353b';
  ctx.fill();
  ctx.strokeStyle = withAlpha('#8a939c', 0.6);
  ctx.lineWidth = 0.01;
  for (let i = -4; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo((i * w * 0.92) / 9, -h * 0.08);
    ctx.lineTo((i * w) / 9, -h / 2);
    ctx.stroke();
  }

  if (power > 0.02) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, -h / 2, 0, -h * 0.1);
    g.addColorStop(0, withAlpha('#c8a0ff', 0.75 * power));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-w * 0.5, -h / 2 - 0.06, w, h * 0.45);
    ctx.restore();
  }
};

ART.jet = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  const power = clamp01(s?.enginePower ?? 0);

  roundRectPath(ctx, -w / 2, -h / 2, w, h, w * 0.22);
  ctx.fillStyle = cylinderShade(ctx, w, '#c2c9d0', {
    lightX: L.x,
    roughness: 0.28,
    metal: 0.92,
  });
  ctx.fill();
  ctx.save();
  ctx.clip();
  panelSeams(ctx, w, h, 3, { alpha: 0.26 });
  surfaceGrain(ctx, w, h, 0.06);
  ctx.restore();
  outline(ctx, 0.3);

  // 흡입구 (깊은 구멍)
  const intake = ctx.createRadialGradient(0, h * 0.4, 0, 0, h * 0.4, w * 0.36);
  intake.addColorStop(0, '#05080b');
  intake.addColorStop(0.7, '#1b2228');
  intake.addColorStop(1, '#3e464e');
  ctx.beginPath();
  ctx.ellipse(0, h * 0.4, w * 0.36, h * 0.1, 0, 0, TAU);
  ctx.fillStyle = intake;
  ctx.fill();

  // 후방 노즐
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.42, w * 0.33, h * 0.09, 0, 0, TAU);
  ctx.fillStyle = power > 0.05 ? mixHex('#2a3138', '#6ec8ff', power) : '#2a3138';
  ctx.fill();
  if (power > 0.05) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = withAlpha('#8fd0ff', 0.4 * power);
    ctx.fill();
    ctx.restore();
  }
};

/* ──────────────────────────────────────────────────────────────
 * 구조물
 * ────────────────────────────────────────────────────────────── */

ART.decoupler = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);

  rectPath(ctx, -w / 2, -h / 2, w, h);
  ctx.fillStyle = cylinderShade(ctx, w, '#b8562c', {
    lightX: L.x,
    roughness: 0.7,
    metal: 0.2,
    ambient: L.ambient,
  });
  ctx.fill();

  ctx.save();
  ctx.clip();
  // 폭발 볼트
  const n = Math.max(4, Math.round(w * 5));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / n;
    ctx.beginPath();
    ctx.arc(x, 0, h * 0.2, 0, TAU);
    ctx.fillStyle = sphereShade(ctx, h * 0.2, '#3a2a20', {
      lightX: L.x,
      metal: 0.5,
    });
    ctx.fill();
  }
  if (def.artOpts?.separator) {
    ctx.strokeStyle = 'rgba(255,224,180,0.5)';
    ctx.lineWidth = 0.016;
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(w / 2, 0);
    ctx.stroke();
  }
  surfaceGrain(ctx, w, h, 0.09);
  ctx.restore();
  endCapAO(ctx, w, h, { strength: 0.36 });
};

ART.radialdecoupler = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  roundRectPath(ctx, -w / 2, -h / 2, w, h, 0.04);
  ctx.fillStyle = cylinderShade(ctx, w, '#b8562c', {
    lightX: L.x,
    roughness: 0.7,
    metal: 0.2,
  });
  ctx.fill();
  outline(ctx, 0.3);
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.22, 0, TAU);
  ctx.fillStyle = sphereShade(ctx, w * 0.22, '#2a1c14', { lightX: L.x });
  ctx.fill();
};

ART.adapter = (ctx, def, s) => {
  const h = def.size.h;
  const o = def.artOpts ?? {};
  const L = lightOf(s);
  const d = detailOf(s);
  const tw = o.topWidth ?? def.size.w * 0.5;
  const bw = o.bottomWidth ?? def.size.w;

  polyPath(ctx, [
    [-bw / 2, -h / 2],
    [bw / 2, -h / 2],
    [tw / 2, h / 2],
    [-tw / 2, h / 2],
  ]);
  ctx.fillStyle = cylinderShade(ctx, bw, MAT.aluminium, {
    lightX: L.x,
    roughness: 0.38,
    metal: 0.85,
    ambient: L.ambient,
  });
  ctx.fill();

  ctx.save();
  ctx.clip();
  if (d > 0.35) {
    // 테이퍼를 따라가는 이음선
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = 0.016;
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      const y = -h / 2 + h * t;
      const hw = lerp(bw / 2, tw / 2, t);
      ctx.beginPath();
      ctx.moveTo(-hw, y);
      ctx.lineTo(hw, y);
      ctx.stroke();
    }
  }
  surfaceGrain(ctx, bw, h, 0.07 * d);
  ctx.restore();
  jointRing(ctx, bw * 1.01, -h / 2 + h * 0.03, h * 0.055, MAT.darkMetal, L.x);
  jointRing(ctx, tw * 1.01, h / 2 - h * 0.03, h * 0.055, MAT.darkMetal, L.x);
  endCapAO(ctx, bw, h);
};

ART.nosecone = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  const heat = clamp01(s?.heat ?? 0);
  const blunt = def.artOpts?.blunt;

  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  if (blunt) {
    ctx.bezierCurveTo(-w * 0.5, h * 0.18, -w * 0.34, h * 0.46, 0, h / 2);
    ctx.bezierCurveTo(w * 0.34, h * 0.46, w * 0.5, h * 0.18, w / 2, -h / 2);
  } else {
    ctx.bezierCurveTo(-w * 0.46, -h * 0.05, -w * 0.2, h * 0.34, 0, h / 2);
    ctx.bezierCurveTo(w * 0.2, h * 0.34, w * 0.46, -h * 0.05, w / 2, -h / 2);
  }
  ctx.closePath();
  const base = heat > 0.02 ? mixHex(MAT.paintWhite, '#ff7a34', heat) : MAT.paintWhite;
  ctx.fillStyle = cylinderShade(ctx, w, base, {
    lightX: L.x,
    roughness: 0.3,
    metal: 0.55,
    ambient: L.ambient,
  });
  ctx.fill();
  ctx.save();
  ctx.clip();
  panelSeams(ctx, w, h, 2, { alpha: 0.2 });
  surfaceGrain(ctx, w, h, 0.06);
  heatTint(ctx, w, h, heat);
  ctx.restore();
  endCapAO(ctx, w, h, { strength: 0.3 });
  incandescence(ctx, w, h, heat);
};

ART.fairing = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  const open = s?.fairingOpen ?? 0;

  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * open * w * 0.6, 0);
    ctx.rotate(side * open * 0.5);
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo((side * w) / 2, -h / 2);
    ctx.bezierCurveTo(
      (side * w) / 2,
      h * 0.1,
      (side * w) * 0.36,
      h * 0.42,
      0,
      h / 2
    );
    ctx.closePath();
    ctx.fillStyle = cylinderShade(ctx, w, MAT.paintWhite, {
      lightX: L.x * side,
      roughness: 0.35,
      metal: 0.5,
      ambient: L.ambient,
    });
    ctx.fill();
    ctx.save();
    ctx.clip();
    panelSeams(ctx, w, h, 4, { alpha: 0.22 });
    surfaceGrain(ctx, w, h, 0.06);
    ctx.restore();
    // 분리선
    ctx.strokeStyle = 'rgba(20,25,30,0.5)';
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(0, h / 2);
    ctx.stroke();
    ctx.restore();
  }
};

ART.cube = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  roundRectPath(ctx, -w / 2, -h / 2, w, h, w * 0.12);
  ctx.fillStyle = cylinderShade(ctx, w, MAT.titanium, {
    lightX: L.x,
    roughness: 0.45,
    metal: 0.85,
  });
  ctx.fill();
  outline(ctx, 0.32);
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 0.014;
  ctx.beginPath();
  ctx.moveTo(-w * 0.36, -h * 0.36);
  ctx.lineTo(w * 0.36, h * 0.36);
  ctx.moveTo(w * 0.36, -h * 0.36);
  ctx.lineTo(-w * 0.36, h * 0.36);
  ctx.stroke();
};

ART.truss = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  const beam = (x0, y0, x1, y1, thick) => {
    ctx.lineCap = 'round';
    ctx.strokeStyle = shade(MAT.titanium, -0.35);
    ctx.lineWidth = thick;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = shade(MAT.titanium, 0.28);
    ctx.lineWidth = thick * 0.4;
    ctx.beginPath();
    ctx.moveTo(x0 - L.x * thick * 0.2, y0);
    ctx.lineTo(x1 - L.x * thick * 0.2, y1);
    ctx.stroke();
  };
  beam(-w / 2, -h / 2, -w / 2, h / 2, 0.055);
  beam(w / 2, -h / 2, w / 2, h / 2, 0.055);
  const n = Math.max(3, Math.round(h / 0.35));
  for (let i = 0; i < n; i++) {
    const y0 = -h / 2 + (h * i) / n;
    const y1 = -h / 2 + (h * (i + 1)) / n;
    if (i % 2 === 0) beam(-w / 2, y0, w / 2, y1, 0.032);
    else beam(w / 2, y0, -w / 2, y1, 0.032);
    beam(-w / 2, y1, w / 2, y1, 0.026);
  }
};

ART.heatshield = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  const heat = clamp01(s?.heat ?? 0);
  const ablator = clamp01(s?.ablator ?? 1);

  ctx.beginPath();
  ctx.moveTo(-w / 2, h / 2);
  ctx.lineTo(w / 2, h / 2);
  ctx.lineTo(w * 0.47, -h / 2);
  ctx.quadraticCurveTo(0, -h / 2 - w * 0.12 * ablator, -w * 0.47, -h / 2);
  ctx.closePath();
  const base = mixHex('#3a302a', '#ff5a1e', heat);
  ctx.fillStyle = cylinderShade(ctx, w, base, {
    lightX: L.x,
    roughness: 0.95,
    metal: 0.05,
    ambient: L.ambient,
  });
  ctx.fill();
  ctx.save();
  ctx.clip();
  // 삭마재 타일 격자
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 0.014;
  for (let i = -5; i <= 5; i++) {
    ctx.beginPath();
    ctx.moveTo((i * w) / 11, -h / 2);
    ctx.lineTo((i * w) / 11, h / 2);
    ctx.stroke();
  }
  surfaceGrain(ctx, w, h, 0.12);
  // 삭마된 부분은 검게 탄다
  if (ablator < 0.95) {
    sootStain(ctx, w, h, (1 - ablator) * 0.8);
  }
  ctx.restore();
  incandescence(ctx, w, h, heat);
};

/* ──────────────────────────────────────────────────────────────
 * 공력
 * ────────────────────────────────────────────────────────────── */

ART.fin = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  const defl = s?.finDeflection ?? 0;
  const controllable = def.artOpts?.controllable;

  ctx.save();
  ctx.rotate(defl * 0.6);
  polyPath(ctx, [
    [w / 2, h / 2],
    [w / 2, -h / 2],
    [-w / 2, -h * 0.62],
    [-w * 0.1, h * 0.3],
  ]);
  const base = controllable ? '#c05a30' : MAT.aluminium;
  const g = ctx.createLinearGradient(w / 2, 0, -w / 2, 0);
  g.addColorStop(0, shade(base, -0.28));
  g.addColorStop(0.45, shade(base, 0.1));
  g.addColorStop(0.8, shade(base, -0.12));
  g.addColorStop(1, shade(base, -0.45));
  ctx.fillStyle = g;
  ctx.fill();
  // 앞전 하이라이트
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 0.018;
  ctx.beginPath();
  ctx.moveTo(w / 2, -h / 2);
  ctx.lineTo(-w / 2, -h * 0.62);
  ctx.stroke();
  outline(ctx, 0.35);
  ctx.restore();
};

ART.gridfin = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  ctx.save();
  ctx.rotate((s?.finDeflection ?? 0) * 0.5);
  rectPath(ctx, -w / 2, -h / 2, w, h);
  ctx.fillStyle = withAlpha('#4b535b', 0.5);
  ctx.fill();
  ctx.strokeStyle = shade(MAT.titanium, -0.1);
  ctx.lineWidth = 0.022;
  const nx = 4;
  const ny = 6;
  for (let i = 0; i <= nx; i++) {
    const x = -w / 2 + (w * i) / nx;
    ctx.beginPath();
    ctx.moveTo(x, -h / 2);
    ctx.lineTo(x, h / 2);
    ctx.stroke();
  }
  for (let i = 0; i <= ny; i++) {
    const y = -h / 2 + (h * i) / ny;
    ctx.beginPath();
    ctx.moveTo(-w / 2, y);
    ctx.lineTo(w / 2, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 0.008;
  for (let i = 0; i <= nx; i++) {
    const x = -w / 2 + (w * i) / nx + 0.012;
    ctx.beginPath();
    ctx.moveTo(x, -h / 2);
    ctx.lineTo(x, h / 2);
    ctx.stroke();
  }
  ctx.strokeStyle = shade(MAT.darkMetal, -0.2);
  ctx.lineWidth = 0.03;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.restore();
};

ART.wing = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  polyPath(ctx, [
    [w / 2, h / 2],
    [w / 2, -h / 2],
    [-w / 2, -h * 0.3],
  ]);
  const g = ctx.createLinearGradient(0, h / 2, 0, -h / 2);
  g.addColorStop(0, shade(MAT.paintWhite, -0.3));
  g.addColorStop(0.5, MAT.paintWhite);
  g.addColorStop(1, shade(MAT.paintWhite, -0.15));
  ctx.fillStyle = g;
  ctx.fill();
  outline(ctx, 0.32);
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 0.014;
  ctx.beginPath();
  ctx.moveTo(w * 0.2, h * 0.35);
  ctx.lineTo(-w * 0.35, -h * 0.22);
  ctx.stroke();
};

ART.airbrake = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  const open = s?.airbrakeOpen ? 1 : 0;
  ctx.save();
  ctx.rotate(open * 1.1);
  rectPath(ctx, -w / 2, -h / 2, w, h);
  ctx.fillStyle = cylinderShade(ctx, w, open ? MAT.paintOrange : MAT.titanium, {
    lightX: L.x,
    roughness: 0.6,
    metal: 0.5,
  });
  ctx.fill();
  outline(ctx, 0.34);
  if (open) hazardStripes(ctx, w * 0.8, -h * 0.12, h * 0.24, { step: h * 0.2 });
  ctx.restore();
};

/* ──────────────────────────────────────────────────────────────
 * 유틸리티
 * ────────────────────────────────────────────────────────────── */

ART.chute = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  const state = s?.chuteState;
  const prog = s?.chuteProgress ?? 0;

  // 캐니스터
  roundRectPath(ctx, -w / 2, -h / 2, w, h, w * 0.1);
  ctx.fillStyle = cylinderShade(ctx, w, MAT.steel, {
    lightX: L.x,
    roughness: 0.4,
    metal: 0.85,
  });
  ctx.fill();
  endCapAO(ctx, w, h, { strength: 0.3 });

  if (!state || state === 'stowed' || state === 'cut' || state === 'destroyed')
    return;

  const semi = state === 'deploying';
  const scale = semi ? 0.35 : lerp(0.45, 1, prog);
  const cw = Math.sqrt(def.chute?.area ?? 40) * 0.95 * scale;
  const ch = cw * 0.66;
  const cy = h / 2 + ch * 0.95;

  // 줄 (먼저 그려서 캐노피 뒤로)
  ctx.strokeStyle = 'rgba(220,225,230,0.55)';
  ctx.lineWidth = 0.016;
  ctx.beginPath();
  for (let i = -3; i <= 3; i++) {
    ctx.moveTo(0, h / 2);
    ctx.lineTo((i / 3) * (cw / 2) * 0.9, cy - ch * 0.42);
  }
  ctx.stroke();

  // 캐노피 — 부풀어 오른 천
  ctx.beginPath();
  ctx.moveTo(-cw / 2, cy - ch / 2);
  ctx.bezierCurveTo(-cw * 0.58, cy + ch * 0.85, cw * 0.58, cy + ch * 0.85, cw / 2, cy - ch / 2);
  ctx.bezierCurveTo(cw * 0.3, cy - ch * 0.66, -cw * 0.3, cy - ch * 0.66, -cw / 2, cy - ch / 2);
  ctx.closePath();

  const g = ctx.createLinearGradient(-cw / 2, 0, cw / 2, 0);
  const panels = ['#c8402f', '#f2f2f2', '#c8402f', '#f2f2f2', '#c8402f'];
  panels.forEach((c, i) => {
    const t = i / (panels.length - 1);
    // 천이 부풀면서 생기는 명암
    const lit = 1 - Math.abs(t - (0.5 + L.x * 0.25)) * 1.4;
    g.addColorStop(t, shade(c, lit * 0.3 - 0.18));
  });
  ctx.fillStyle = g;
  ctx.fill();

  // 패널 봉제선
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 0.014;
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    const x = -cw / 2 + cw * t;
    ctx.beginPath();
    ctx.moveTo(x, cy - ch * 0.55);
    ctx.quadraticCurveTo(x, cy + ch * 0.2, x * 0.9, cy + ch * 0.5);
    ctx.stroke();
  }
  outline(ctx, 0.25);
};

/** 로버 바퀴 — 타이어 트레드 + 허브 + 서스펜션 암 */
ART.roverwheel = (ctx, def, s) => {
  const L = lightOf(s);
  const d = detailOf(s);
  const r = Math.min(def.size.w, def.size.h) / 2;
  const comp = (s?.legCompression ?? 0) * (def.wheel?.maxCompression ?? 0.2);
  const spin = s?.wheelSpin ?? 0;

  // 서스펜션 암 — 본체 쪽으로
  ctx.strokeStyle = shade(MAT.darkMetal, -0.1 + L.ambient * 0.2);
  ctx.lineWidth = r * 0.22;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-r * 1.5, r * 0.35);
  ctx.lineTo(0, comp * 0.5);
  ctx.moveTo(-r * 1.5, -r * 0.25);
  ctx.lineTo(0, comp * 0.5);
  ctx.stroke();

  ctx.save();
  ctx.translate(0, -comp * 0.5);

  // 타이어
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = sphereShade(ctx, r, '#2b2f34', {
    lightX: L.x,
    lightY: 0.5,
    ambient: L.ambient + 0.06,
  });
  ctx.fill();

  // 트레드 — 회전에 따라 돈다
  if (d > 0.25) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.clip();
    ctx.rotate(spin);
    const lugs = 14;
    ctx.strokeStyle = 'rgba(12,14,17,0.85)';
    ctx.lineWidth = r * 0.1;
    for (let i = 0; i < lugs; i++) {
      const a = (i / lugs) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.76, Math.sin(a) * r * 0.76);
      ctx.lineTo(Math.cos(a) * r * 1.02, Math.sin(a) * r * 1.02);
      ctx.stroke();
    }
    ctx.restore();
    // 접지면 광택
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = r * 0.06;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.93, -2.6, -0.8);
    ctx.stroke();
  }

  // 허브
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.46, 0, TAU);
  ctx.fillStyle = sphereShade(ctx, r * 0.46, MAT.aluminium, {
    lightX: L.x,
    lightY: 0.5,
    ambient: L.ambient,
  });
  ctx.fill();
  if (d > 0.4) {
    ctx.save();
    ctx.rotate(spin);
    ctx.fillStyle = 'rgba(30,36,42,0.6)';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.28, Math.sin(a) * r * 0.28, r * 0.07, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // 구동 중이면 허브가 살짝 빛난다
  if ((s?.wheelDrive ?? 0) > 0.05) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = withAlpha('#6ad8ff', 0.2 * clamp01(s.wheelDrive));
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.5, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // 결은 타이어 원 안쪽에만 — 클립 없이 깔면 사각형 얼룩이 남는다
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.clip();
  surfaceGrain(ctx, r * 2, r * 2, 0.07 * d, 0.02, { material: 'rough' });
  ctx.restore();
};

ART.leg = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  const ext = s?.legExtended ? 1 : 0;
  const comp = s?.legCompression ?? 0;
  const len = (def.leg?.length ?? 1.4) * ext;
  const foot = def.leg?.footWidth ?? 0.5;

  // 힌지 브래킷
  roundRectPath(ctx, -w * 0.32, -h * 0.12, w * 0.64, h * 0.34, 0.03);
  ctx.fillStyle = cylinderShade(ctx, w * 0.64, MAT.titanium, {
    lightX: L.x,
    roughness: 0.4,
    metal: 0.85,
  });
  ctx.fill();
  outline(ctx, 0.3);

  if (ext < 0.01) {
    rectPath(ctx, -w * 0.17, -h * 0.46, w * 0.34, h * 0.5);
    ctx.fillStyle = cylinderShade(ctx, w * 0.34, MAT.aluminium, {
      lightX: L.x,
      roughness: 0.35,
      metal: 0.9,
    });
    ctx.fill();
    outline(ctx, 0.3);
    return;
  }

  const dropY = -(len - comp);
  const spreadX = -len * 0.55;

  // 주 지지대 (텔레스코픽)
  const strut = (x0, y0, x1, y1, thick) => {
    ctx.lineCap = 'round';
    ctx.strokeStyle = shade(MAT.aluminium, -0.35);
    ctx.lineWidth = thick;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = shade(MAT.aluminium, 0.35);
    ctx.lineWidth = thick * 0.35;
    ctx.beginPath();
    ctx.moveTo(x0 - 0.02, y0);
    ctx.lineTo(x1 - 0.02, y1);
    ctx.stroke();
  };
  strut(0, 0, spreadX, dropY, 0.1);
  strut(0, h * 0.18, spreadX * 0.55, dropY * 0.55, 0.055);

  // 완충기 (압축되면 짧아진다)
  ctx.strokeStyle = shade(MAT.darkMetal, 0.1);
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.moveTo(spreadX * 0.45, dropY * 0.45);
  ctx.lineTo(spreadX * 0.85, dropY * 0.85);
  ctx.stroke();

  // 발 (접시)
  ctx.save();
  ctx.translate(spreadX, dropY);
  ctx.beginPath();
  ctx.ellipse(0, 0, foot / 2, foot * 0.2, 0, 0, TAU);
  ctx.fillStyle = sphereShade(ctx, foot / 2, MAT.darkMetal, {
    lightX: L.x,
    metal: 0.7,
  });
  ctx.fill();
  outline(ctx, 0.35);
  ctx.restore();
};

ART.rcsblock = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  roundRectPath(ctx, -w * 0.26, -h * 0.26, w * 0.52, h * 0.52, 0.02);
  ctx.fillStyle = cylinderShade(ctx, w * 0.52, MAT.titanium, {
    lightX: L.x,
    roughness: 0.4,
    metal: 0.85,
  });
  ctx.fill();
  outline(ctx, 0.3);

  const nozzle = w * 0.2;
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    polyPath(ctx, [
      [dx * w * 0.25, dy * h * 0.25],
      [
        dx * (w * 0.25 + nozzle) - dy * nozzle * 0.42,
        dy * (h * 0.25 + nozzle) - dx * nozzle * 0.42,
      ],
      [
        dx * (w * 0.25 + nozzle) + dy * nozzle * 0.42,
        dy * (h * 0.25 + nozzle) + dx * nozzle * 0.42,
      ],
    ]);
    ctx.fillStyle = shade(MAT.darkMetal, -0.15);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.008;
    ctx.stroke();
  }
  if (s?.rcsFiring) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.55);
    g.addColorStop(0, withAlpha('#dff0ff', 0.7));
    g.addColorStop(1, withAlpha('#dff0ff', 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.55, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
};

ART.wheel = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  rectPath(ctx, -w / 2, -h / 2, w, h);
  ctx.fillStyle = cylinderShade(ctx, w, '#949ca4', {
    lightX: L.x,
    roughness: 0.38,
    metal: 0.88,
  });
  ctx.fill();
  ctx.save();
  ctx.clip();
  panelSeams(ctx, w, h, 1, { alpha: 0.28 });
  // 회전 표시 띠
  ctx.fillStyle = withAlpha('#5ad1c0', 0.55);
  ctx.fillRect(-w * 0.38, -h * 0.06, w * 0.76, h * 0.12);
  surfaceGrain(ctx, w, h, 0.06);
  ctx.restore();
  endCapAO(ctx, w, h, { strength: 0.34 });
};

ART.battery = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  roundRectPath(ctx, -w / 2, -h / 2, w, h, 0.02);
  ctx.fillStyle = cylinderShade(ctx, w, '#37634a', {
    lightX: L.x,
    roughness: 0.6,
    metal: 0.4,
  });
  ctx.fill();
  outline(ctx, 0.34);
  const n = def.artOpts?.stack ? 4 : 2;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / n;
    ctx.fillStyle = cylinderShade(ctx, w * 0.12, '#e0cf5a', {
      lightX: L.x,
      roughness: 0.4,
      metal: 0.7,
    });
    ctx.save();
    ctx.translate(x, 0);
    ctx.fillRect(-w * 0.06, -h * 0.32, w * 0.12, h * 0.64);
    ctx.restore();
  }
};

ART.solar = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  // 본체
  roundRectPath(ctx, -w * 0.3, -h * 0.3, w * 0.6, h * 0.6, 0.02);
  ctx.fillStyle = cylinderShade(ctx, w * 0.6, MAT.titanium, {
    lightX: L.x,
    roughness: 0.4,
    metal: 0.85,
  });
  ctx.fill();
  if (!s?.deployed) return;

  const large = def.artOpts?.large;
  const pw = large ? 3.6 : 1.8;
  const ph = large ? 1.0 : 0.6;
  const sun = clamp01(s?.sunFactor ?? 1);

  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * (w * 0.3 + pw / 2), 0);
    // 지지대
    ctx.strokeStyle = shade(MAT.titanium, -0.2);
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    ctx.moveTo(-side * pw / 2, 0);
    ctx.lineTo(side * pw / 2, 0);
    ctx.stroke();

    rectPath(ctx, -pw / 2, -ph / 2, pw, ph);
    const g = ctx.createLinearGradient(-pw / 2, -ph / 2, pw / 2, ph / 2);
    g.addColorStop(0, '#0d2247');
    g.addColorStop(0.42, '#1d4a86');
    g.addColorStop(0.5, mixHex('#2f6fb8', '#a8d8ff', sun * 0.5));
    g.addColorStop(0.6, '#1d4a86');
    g.addColorStop(1, '#0a1930');
    ctx.fillStyle = g;
    ctx.fill();

    // 셀 격자
    ctx.strokeStyle = 'rgba(140,190,235,0.28)';
    ctx.lineWidth = 0.012;
    const cells = large ? 10 : 6;
    for (let i = 1; i < cells; i++) {
      const x = -pw / 2 + (pw * i) / cells;
      ctx.beginPath();
      ctx.moveTo(x, -ph / 2);
      ctx.lineTo(x, ph / 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-pw / 2, 0);
    ctx.lineTo(pw / 2, 0);
    ctx.stroke();

    // 유리 반사
    if (sun > 0.1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const r = ctx.createLinearGradient(-pw / 2, -ph / 2, pw * 0.1, ph / 2);
      r.addColorStop(0, withAlpha('#ffffff', 0));
      r.addColorStop(0.5, withAlpha('#cfe8ff', 0.22 * sun));
      r.addColorStop(1, withAlpha('#ffffff', 0));
      ctx.fillStyle = r;
      ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
      ctx.restore();
    }
    ctx.strokeStyle = shade(MAT.titanium, -0.3);
    ctx.lineWidth = 0.025;
    ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
    ctx.restore();
  }
};

ART.rtg = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  roundRectPath(ctx, -w * 0.28, -h / 2, w * 0.56, h, 0.03);
  ctx.fillStyle = cylinderShade(ctx, w * 0.56, '#77808a', {
    lightX: L.x,
    roughness: 0.5,
    metal: 0.8,
  });
  ctx.fill();
  outline(ctx, 0.3);
  // 방열 핀
  for (let i = -2; i <= 2; i++) {
    const y = (i * h) / 6;
    ctx.fillStyle = cylinderShade(ctx, w, shade(MAT.darkMetal, -0.1), {
      lightX: L.x,
      roughness: 0.5,
      metal: 0.7,
    });
    ctx.fillRect(-w / 2, y - 0.022, w, 0.044);
  }
  // 열 발광
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.5);
  g.addColorStop(0, withAlpha('#ff9a3a', 0.3));
  g.addColorStop(1, withAlpha('#ff9a3a', 0));
  ctx.fillStyle = g;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.restore();
};

ART.dock = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  rectPath(ctx, -w / 2, -h / 2, w, h);
  ctx.fillStyle = cylinderShade(ctx, w, MAT.aluminium, {
    lightX: L.x,
    roughness: 0.32,
    metal: 0.9,
  });
  ctx.fill();
  // 도킹 링 안쪽
  const inner = ctx.createLinearGradient(-w * 0.3, 0, w * 0.3, 0);
  inner.addColorStop(0, '#14191e');
  inner.addColorStop(0.5, '#2c343b');
  inner.addColorStop(1, '#14191e');
  ctx.fillStyle = inner;
  ctx.fillRect(-w * 0.3, -h * 0.24, w * 0.6, h * 0.48);
  // 유도등
  ctx.fillStyle = s?.docked ? '#63f0b0' : '#3a4a56';
  for (const x of [-w * 0.4, w * 0.4]) {
    ctx.beginPath();
    ctx.arc(x, 0, h * 0.12, 0, TAU);
    ctx.fill();
  }
  endCapAO(ctx, w, h, { strength: 0.3 });
};

ART.clamp = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  // 기둥
  rectPath(ctx, -w / 2, -h / 2, w * 0.5, h);
  ctx.fillStyle = cylinderShade(ctx, w * 0.5, '#c89a36', {
    lightX: L.x,
    roughness: 0.65,
    metal: 0.4,
  });
  ctx.fill();
  ctx.save();
  ctx.clip();
  hazardStripes(ctx, w, -h / 2, h, { step: h * 0.08 });
  ctx.restore();
  outline(ctx, 0.35);
  // 클램프 팔
  ctx.strokeStyle = shade('#c89a36', -0.1);
  ctx.lineWidth = 0.09;
  ctx.lineCap = 'round';
  for (const y of [h * 0.32, -h * 0.05]) {
    ctx.beginPath();
    ctx.moveTo(-w * 0.25, y);
    ctx.lineTo(w * 0.5, y);
    ctx.stroke();
  }
};

ART.light = (ctx, def, s) => {
  const w = def.size.w;
  const L = lightOf(s);
  roundRectPath(ctx, -w / 2, -w / 2, w, w, 0.02);
  ctx.fillStyle = cylinderShade(ctx, w, MAT.titanium, {
    lightX: L.x,
    roughness: 0.45,
    metal: 0.8,
  });
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.3, 0, TAU);
  ctx.fillStyle = s?.lightOn ? '#fff8e0' : '#39424a';
  ctx.fill();
  if (s?.lightOn) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, w * 0.2, 0, 0, w * 4);
    g.addColorStop(0, withAlpha('#fff4d0', 0.45));
    g.addColorStop(0.3, withAlpha('#fff4d0', 0.14));
    g.addColorStop(1, withAlpha('#fff4d0', 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, w * 4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
};

ART.ladder = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const rail = (x) => {
    ctx.strokeStyle = shade(MAT.aluminium, -0.3);
    ctx.lineWidth = 0.036;
    ctx.beginPath();
    ctx.moveTo(x, -h / 2);
    ctx.lineTo(x, h / 2);
    ctx.stroke();
    ctx.strokeStyle = shade(MAT.aluminium, 0.3);
    ctx.lineWidth = 0.014;
    ctx.beginPath();
    ctx.moveTo(x - 0.008, -h / 2);
    ctx.lineTo(x - 0.008, h / 2);
    ctx.stroke();
  };
  rail(-w / 2);
  rail(w / 2);
  const n = Math.max(4, Math.round(h / 0.25));
  ctx.strokeStyle = shade(MAT.aluminium, -0.15);
  ctx.lineWidth = 0.026;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const y = -h / 2 + (h * i) / n;
    ctx.moveTo(-w / 2, y);
    ctx.lineTo(w / 2, y);
  }
  ctx.stroke();
};

/* ──────────────────────────────────────────────────────────────
 * 과학
 * ────────────────────────────────────────────────────────────── */

ART.instrument = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  const v = def.artOpts?.variant ?? 0;
  roundRectPath(ctx, -w / 2, -h / 2, w, h, 0.02);
  ctx.fillStyle = cylinderShade(ctx, w, ['#8f97a0', '#7a8f9a', '#6f7d8a'][v % 3], {
    lightX: L.x,
    roughness: 0.45,
    metal: 0.75,
  });
  ctx.fill();
  outline(ctx, 0.32);
  ctx.beginPath();
  ctx.arc(0, h * 0.12, w * 0.14, 0, TAU);
  ctx.fillStyle = sphereShade(ctx, w * 0.14, '#e8d76a', { lightX: L.x, metal: 0.5 });
  ctx.fill();
  if (v === 0) {
    ctx.strokeStyle = '#c94a32';
    ctx.lineWidth = 0.018;
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(0, -h * 0.85);
    ctx.stroke();
  }
};

ART.goo = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  roundRectPath(ctx, -w / 2, -h / 2, w, h, w * 0.18);
  ctx.fillStyle = cylinderShade(ctx, w, MAT.titanium, {
    lightX: L.x,
    roughness: 0.45,
    metal: 0.8,
  });
  ctx.fill();
  outline(ctx, 0.32);
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.24, 0, TAU);
  ctx.fillStyle = s?.scienceUsed
    ? '#454d55'
    : sphereShade(ctx, w * 0.24, '#7ec93a', { lightX: L.x, metal: 0.3 });
  ctx.fill();
};

ART.lab = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  rectPath(ctx, -w / 2, -h / 2, w, h);
  ctx.fillStyle = cylinderShade(ctx, w, '#bcc3cb', {
    lightX: L.x,
    roughness: 0.4,
    metal: 0.8,
  });
  ctx.fill();
  ctx.save();
  ctx.clip();
  panelSeams(ctx, w, h, 1, { alpha: 0.25 });
  for (let i = -1; i <= 1; i++) {
    ctx.fillStyle = '#2a6fa8';
    ctx.fillRect(i * w * 0.25 - w * 0.07, -h * 0.22, w * 0.14, h * 0.44);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(i * w * 0.25 - w * 0.07, -h * 0.22, w * 0.14, h * 0.08);
  }
  surfaceGrain(ctx, w, h, 0.06);
  ctx.restore();
  endCapAO(ctx, w, h, { strength: 0.3 });
};

ART.antenna = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  roundRectPath(ctx, -w / 2, -h * 0.46, w, h * 0.2, 0.02);
  ctx.fillStyle = cylinderShade(ctx, w, MAT.titanium, {
    lightX: L.x,
    roughness: 0.45,
    metal: 0.8,
  });
  ctx.fill();
  if (s?.deployed === false) return;
  ctx.strokeStyle = shade(MAT.aluminium, -0.1);
  ctx.lineWidth = 0.026;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.3);
  ctx.lineTo(0, h * 0.5);
  ctx.stroke();
  ctx.lineWidth = 0.016;
  for (let i = 0; i < 4; i++) {
    const y = -h * 0.1 + (h * 0.5 * i) / 4;
    ctx.beginPath();
    ctx.moveTo(-w * 0.8, y);
    ctx.lineTo(w * 0.8, y);
    ctx.stroke();
  }
};

ART.dish = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  // 접시 안쪽
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, h / 2, 0, Math.PI * 0.12, Math.PI * 0.88);
  ctx.lineTo(0, 0);
  ctx.closePath();
  const g = ctx.createRadialGradient(0, -h * 0.1, h * 0.05, 0, 0, w / 2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.55, '#d4dae0');
  g.addColorStop(1, '#8d959d');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.02;
  ctx.stroke();
  // 급전부
  ctx.strokeStyle = shade(MAT.titanium, -0.1);
  ctx.lineWidth = 0.028;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -h * 0.45);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -h * 0.45, w * 0.07, 0, TAU);
  ctx.fillStyle = MAT.darkMetal;
  ctx.fill();
};

/* ──────────────────────────────────────────────────────────────
 * 페이로드
 * ────────────────────────────────────────────────────────────── */

ART.satellite = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  roundRectPath(ctx, -w / 2, -h / 2, w, h, w * 0.06);
  // 금박 단열재
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  g.addColorStop(0, shade(MAT.gold, -0.5));
  g.addColorStop(0.35, shade(MAT.gold, 0.1));
  g.addColorStop(0.48, '#ffe9a8');
  g.addColorStop(0.62, shade(MAT.gold, 0.05));
  g.addColorStop(1, shade(MAT.gold, -0.55));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // 주름
  ctx.strokeStyle = 'rgba(0,0,0,0.2)';
  ctx.lineWidth = 0.01;
  for (let i = 0; i < 16; i++) {
    const x = -w / 2 + (w * i) / 16;
    ctx.beginPath();
    ctx.moveTo(x, -h / 2);
    ctx.lineTo(x + ((i % 3) - 1) * 0.03, h / 2);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(30,36,42,0.55)';
  ctx.fillRect(-w * 0.36, -h * 0.12, w * 0.72, h * 0.24);
  ctx.restore();
  outline(ctx, 0.3);
};

ART.rover = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  // 차체
  roundRectPath(ctx, -w * 0.4, -h * 0.08, w * 0.8, h * 0.5, 0.05);
  ctx.fillStyle = cylinderShade(ctx, w * 0.8, '#b6bec6', {
    lightX: L.x,
    roughness: 0.5,
    metal: 0.7,
  });
  ctx.fill();
  outline(ctx, 0.32);
  // 바퀴
  for (const x of [-w * 0.34, -w * 0.1, w * 0.16, w * 0.38]) {
    ctx.beginPath();
    ctx.arc(x, -h * 0.18, h * 0.23, 0, TAU);
    ctx.fillStyle = sphereShade(ctx, h * 0.23, '#3b4249', {
      lightX: L.x,
      metal: 0.3,
    });
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 0.014;
    ctx.stroke();
  }
  // 상판 태양전지
  const g = ctx.createLinearGradient(-w * 0.38, 0, w * 0.38, 0);
  g.addColorStop(0, '#0d2247');
  g.addColorStop(0.5, '#2a5f9e');
  g.addColorStop(1, '#0d2247');
  ctx.fillStyle = g;
  ctx.fillRect(-w * 0.38, h * 0.4, w * 0.76, h * 0.13);
};

ART.habitat = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  const d = detailOf(s);
  roundRectPath(ctx, -w / 2, -h / 2, w, h, w * 0.18);
  ctx.fillStyle = cylinderShade(ctx, w, '#dde3e9', {
    lightX: L.x,
    roughness: 0.45,
    metal: 0.6,
    ambient: L.ambient,
  });
  ctx.fill();
  ctx.save();
  ctx.clip();
  panelSeams(ctx, w, h, 3, { alpha: 0.26 });
  // 단열 담요 밴드
  ctx.fillStyle = withAlpha(MAT.gold, 0.5);
  ctx.fillRect(-w / 2, -h * 0.45, w, h * 0.12);
  ctx.fillRect(-w / 2, h * 0.33, w, h * 0.12);
  surfaceGrain(ctx, w, h, 0.07 * d);
  ctx.restore();
  if (d > 0.25) {
    for (let i = -1; i <= 1; i++) {
      porthole(ctx, i * w * 0.28, h * 0.08, w * 0.085, {
        lightX: L.x,
        lit: s?.lightOn,
      });
    }
  }
  endCapAO(ctx, w, h, { strength: 0.34 });
};

ART.drill = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  roundRectPath(ctx, -w * 0.36, -h * 0.08, w * 0.72, h * 0.6, 0.04);
  ctx.fillStyle = cylinderShade(ctx, w * 0.72, '#8a929a', {
    lightX: L.x,
    roughness: 0.45,
    metal: 0.8,
  });
  ctx.fill();
  outline(ctx, 0.3);
  polyPath(ctx, [
    [-w * 0.13, -h * 0.08],
    [0, -h / 2],
    [w * 0.13, -h * 0.08],
  ]);
  ctx.fillStyle = s?.active ? '#e0a03a' : shade(MAT.darkMetal, -0.1);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 0.012;
  for (let i = 1; i < 5; i++) {
    const t = i / 5;
    const y = lerp(-h * 0.08, -h / 2, t);
    const hw = lerp(w * 0.13, 0.01, t);
    ctx.beginPath();
    ctx.moveTo(-hw, y);
    ctx.lineTo(hw, y);
    ctx.stroke();
  }
};

ART.converter = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  rectPath(ctx, -w / 2, -h / 2, w, h);
  ctx.fillStyle = cylinderShade(ctx, w, '#9aa2aa', {
    lightX: L.x,
    roughness: 0.45,
    metal: 0.8,
  });
  ctx.fill();
  ctx.save();
  ctx.clip();
  panelSeams(ctx, w, h, 2, { alpha: 0.25 });
  // 배관
  ctx.strokeStyle = s?.active ? '#5ad1c0' : shade(MAT.darkMetal, 0.1);
  ctx.lineWidth = 0.06;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-w * 0.3, -h * 0.3);
  ctx.lineTo(-w * 0.3, h * 0.3);
  ctx.lineTo(w * 0.3, h * 0.3);
  ctx.lineTo(w * 0.3, -h * 0.3);
  ctx.stroke();
  surfaceGrain(ctx, w, h, 0.07);
  ctx.restore();
  endCapAO(ctx, w, h, { strength: 0.32 });
};

/* 폴백 */
ART.default = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const L = lightOf(s);
  rectPath(ctx, -w / 2, -h / 2, w, h);
  ctx.fillStyle = cylinderShade(ctx, w, MAT.titanium, {
    lightX: L.x,
    roughness: 0.5,
    metal: 0.7,
  });
  ctx.fill();
  outline(ctx, 0.32);
  endCapAO(ctx, w, h, { strength: 0.3 });
};

/* ──────────────────────────────────────────────────────────────
 * 공개 API
 * ────────────────────────────────────────────────────────────── */

/**
 * 부품 하나를 그린다. ctx 는 이미 부품 중심으로 이동·회전되어 있어야 한다.
 * @param {object} state 런타임 상태
 *   light  { x, y, ambient } 부품 로컬 좌표계의 광원 방향
 *   detail 0..1 — 화면에서 작으면 잔디테일 생략
 *   heat / soot / fuelFraction / deployed / ...
 */
/** 크기 조절된 부품을 위한 임시 def — 아트 함수는 def.size 만 보면 된다 */
const _scaledDefCache = new Map();
function scaledDef(def, sw, sh) {
  if (Math.abs(sw - 1) < 1e-4 && Math.abs(sh - 1) < 1e-4) return def;
  const key = `${def.id}|${sw.toFixed(3)}|${sh.toFixed(3)}`;
  let d = _scaledDefCache.get(key);
  if (d) return d;
  d = Object.create(def);
  d.size = { ...def.size, w: def.size.w * sw, h: def.size.h * sh };
  if (def.nodes) {
    d.nodes = def.nodes.map((n) => ({ ...n, x: n.x * sw, y: n.y * sh }));
  }
  if (_scaledDefCache.size > 400) _scaledDefCache.clear();
  _scaledDefCache.set(key, d);
  return d;
}

export function drawPart(ctx, def, state = null) {
  const sw = state?.scaleW ?? 1;
  const sh = state?.scaleH ?? 1;
  const d = scaledDef(def, sw, sh);
  const fn = ART[d.art] ?? ART.default;
  setSurfaceContext(d, state);

  const paint = (target) => {
    target.save();
    try {
      fn(target, d, state);
    } catch (e) {
      target.restore();
      target.save();
      ART.default(target, d, state);
    }
    target.restore();
  };

  if (state?.tint && drawTintedPart(ctx, d, state, paint)) return;
  paint(ctx);

}

/* ──────────────────────────────────────────────────────────────
 * 사용자 도색
 *
 * source-atop 은 "이미 칠해진 픽셀 위에만" 그리지만, 대상이 장면
 * 캔버스면 하늘·지형까지 함께 물든다. 그래서 부품만 담긴 오프스크린
 * 버퍼에 그린 뒤 거기서 색을 입히고 합성한다.
 * ────────────────────────────────────────────────────────────── */

let _tintBuf = null;
let _tintCtx = null;

function tintBuffer(w, h) {
  if (!_tintBuf) {
    _tintBuf = document.createElement('canvas');
    _tintCtx = _tintBuf.getContext('2d');
  }
  if (_tintBuf.width < w || _tintBuf.height < h) {
    _tintBuf.width = Math.max(_tintBuf.width, w);
    _tintBuf.height = Math.max(_tintBuf.height, h);
  }
  _tintCtx.setTransform(1, 0, 0, 1, 0, 0);
  _tintCtx.clearRect(0, 0, w, h);
  return _tintCtx;
}

/** 도색된 부품을 그린다 */
function drawTintedPart(ctx, def, state, drawFn) {
  const m = ctx.getTransform ? ctx.getTransform() : null;
  const w = def.size.w;
  const h = def.size.h;
  if (!m) return false;

  // 부품 네 모서리를 장치 좌표로 옮겨 바운딩 박스를 구한다
  const pad = 6;
  const pts = [
    [-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2],
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of pts) {
    const dx = m.a * px + m.c * py + m.e;
    const dy = m.b * px + m.d * py + m.f;
    if (dx < minX) minX = dx;
    if (dx > maxX) maxX = dx;
    if (dy < minY) minY = dy;
    if (dy > maxY) maxY = dy;
  }
  // 부품 밖으로 나가는 요소(다리·낙하산·화염)까지 담도록 넉넉히
  const grow = Math.max(maxX - minX, maxY - minY) * 1.3 + pad;
  minX -= grow; minY -= grow; maxX += grow; maxY += grow;
  const bw = Math.ceil(maxX - minX);
  const bh = Math.ceil(maxY - minY);
  // 너무 작거나 너무 크면 버퍼를 쓰지 않는다
  if (bw < 2 || bh < 2 || bw > 2400 || bh > 2400) return false;

  const bctx = tintBuffer(bw, bh);
  bctx.setTransform(m.a, m.b, m.c, m.d, m.e - minX, m.f - minY);
  drawFn(bctx);

  bctx.setTransform(1, 0, 0, 1, 0, 0);
  bctx.globalCompositeOperation = 'source-atop';
  bctx.globalAlpha = state?.tintStrength ?? 0.5;
  bctx.fillStyle = state.tint;
  bctx.fillRect(0, 0, bw, bh);
  bctx.globalCompositeOperation = 'source-over';
  bctx.globalAlpha = 1;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(_tintBuf, 0, 0, bw, bh, minX, minY, bw, bh);
  ctx.restore();
  return true;
}

/** 과열 글로우 오버레이 */
export function drawHeatGlow(ctx, def, heatFraction) {
  if (heatFraction < 0.22) return;
  const w = def.size.w;
  const h = def.size.h;
  const t = clamp01((heatFraction - 0.22) / 0.78);
  const r = Math.max(w, h) * (0.8 + t * 0.5);
  const g = ctx.createRadialGradient(0, 0, r * 0.15, 0, 0, r);
  const color = t > 0.7 ? '#ffe9a0' : t > 0.4 ? '#ff8a3a' : '#ff5a1e';
  g.addColorStop(0, withAlpha(color, 0.6 * t));
  g.addColorStop(0.45, withAlpha(color, 0.25 * t));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** 설계실 아이콘용 — 부품을 정사각형 안에 맞춰 그린다 */
export function drawPartIcon(ctx, def, size, state = null) {
  const w = def.size.w;
  const h = def.size.h;
  const scale = (size * 0.78) / Math.max(w, h);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(scale, -scale);
  drawPart(ctx, def, {
    detail: 1,
    light: { x: -0.6, y: 0.4, ambient: 0.38 },
    ...state,
  });
  ctx.restore();
}

export const ART_TYPES = Object.keys(ART);
