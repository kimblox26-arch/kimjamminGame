// ORBITER — 부품 벡터 아트
//
// 모든 그리기 함수는 "1 단위 = 1 미터", 원점 = 부품 중심, +y = 위 인 좌표계에서 동작한다.
// 호출자가 ctx.scale(ppm, -ppm) 으로 뒤집어 두므로 여기서는 수학 좌표 그대로 쓰면 된다.
// (텍스트는 뒤집히므로 이 파일에서는 그리지 않는다)

import { clamp01, lerp, mixHex, withAlpha, shade, TAU } from '../core/math.js';

/* ──────────────────────────────────────────────────────────────
 * 공통 헬퍼
 * ────────────────────────────────────────────────────────────── */

const METAL = '#d4d8dd';
const METAL_DARK = '#8b939c';
const METAL_SHADOW = '#4a5158';
const ORANGE = '#d9743a';
const DARK = '#2b3036';

function rect(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
}

function roundRect(ctx, x, y, w, h, r) {
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

function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

/** 좌우 방향 원통 음영 그라디언트 */
function cylinderGradient(ctx, w, base, highlight, shadow) {
  const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  g.addColorStop(0, shadow);
  g.addColorStop(0.28, base);
  g.addColorStop(0.45, highlight);
  g.addColorStop(0.62, base);
  g.addColorStop(1, shadow);
  return g;
}

function strokeThin(ctx, color, width = 0.03) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

/* ──────────────────────────────────────────────────────────────
 * 개별 부품 아트
 * ────────────────────────────────────────────────────────────── */

const ART = {};

/* 캡슐형 사령선 */
ART.capsule = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const topW = w * 0.42;
  const g = cylinderGradient(ctx, w, '#c3cad2', '#f2f5f8', '#6d757e');
  poly(ctx, [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [topW / 2, h / 2],
    [-topW / 2, h / 2],
  ]);
  ctx.fillStyle = g;
  ctx.fill();
  strokeThin(ctx, METAL_SHADOW, 0.04);

  // 창문
  ctx.beginPath();
  ctx.ellipse(0, h * 0.14, w * 0.14, h * 0.1, 0, 0, TAU);
  ctx.fillStyle = s?.lightOn ? '#ffe9a8' : '#2a4258';
  ctx.fill();
  strokeThin(ctx, '#1b2733', 0.025);

  // 하단 열차폐
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.quadraticCurveTo(0, -h / 2 - w * 0.16, w / 2, -h / 2);
  ctx.closePath();
  const heat = clamp01(s?.heat ?? 0);
  ctx.fillStyle = heat > 0.02 ? mixHex('#4a3b33', '#ff7030', heat) : '#4a3b33';
  ctx.fill();

  // 리브
  ctx.strokeStyle = withAlpha('#5b636b', 0.55);
  ctx.lineWidth = 0.02;
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    const y = -h / 2 + h * t;
    const hw = lerp(w / 2, topW / 2, t);
    ctx.beginPath();
    ctx.moveTo(-hw, y);
    ctx.lineTo(hw, y);
    ctx.stroke();
  }
};

/* 유선형 조종석 */
ART.cockpit = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  ctx.quadraticCurveTo(w * 0.42, h * 0.42, 0, h / 2);
  ctx.quadraticCurveTo(-w * 0.42, h * 0.42, -w / 2, -h / 2);
  ctx.closePath();
  ctx.fillStyle = cylinderGradient(ctx, w, '#cfd6dd', '#ffffff', '#79818a');
  ctx.fill();
  strokeThin(ctx, METAL_SHADOW, 0.035);

  ctx.beginPath();
  ctx.moveTo(-w * 0.26, h * 0.05);
  ctx.quadraticCurveTo(0, h * 0.4, w * 0.26, h * 0.05);
  ctx.quadraticCurveTo(0, h * 0.18, -w * 0.26, h * 0.05);
  ctx.fillStyle = '#25415c';
  ctx.fill();
};

/* 무인 탐사 코어 */
ART.probe = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  roundRect(ctx, -w / 2, -h / 2, w, h, h * 0.2);
  ctx.fillStyle = cylinderGradient(ctx, w, '#9aa3ad', '#cfd6de', '#5c646d');
  ctx.fill();
  strokeThin(ctx, '#3d444b', 0.025);
  // 상태등
  ctx.beginPath();
  ctx.arc(0, 0, Math.min(w, h) * 0.16, 0, TAU);
  ctx.fillStyle = def.artOpts?.advanced ? '#63f0b0' : '#f0a63a';
  ctx.fill();
  ctx.strokeStyle = withAlpha('#000', 0.3);
  ctx.lineWidth = 0.015;
  ctx.stroke();
};

/* 착륙선 캐빈 */
ART.landercan = (ctx, def) => {
  const w = def.size.w;
  const h = def.size.h;
  roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.12);
  ctx.fillStyle = cylinderGradient(ctx, w, '#c9cfd6', '#f4f7fa', '#767e87');
  ctx.fill();
  strokeThin(ctx, METAL_SHADOW, 0.04);
  // 창문 3개
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(i * w * 0.26, h * 0.1, w * 0.08, 0, TAU);
    ctx.fillStyle = '#27455f';
    ctx.fill();
  }
  // 금색 단열 포일
  ctx.fillStyle = withAlpha('#e0b64a', 0.65);
  rect(ctx, -w / 2, -h / 2, w, h * 0.22);
  ctx.fill();
};

/* 원통 탱크 */
ART.tank = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const o = def.artOpts ?? {};
  const base = o.color ?? METAL;
  roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.06);
  ctx.fillStyle = cylinderGradient(
    ctx,
    w,
    base,
    shade(base, 0.35),
    shade(base, -0.45)
  );
  ctx.fill();
  strokeThin(ctx, shade(base, -0.6), 0.025);

  // 상하 캡
  ctx.fillStyle = withAlpha('#6c747d', 0.45);
  rect(ctx, -w / 2, h / 2 - h * 0.04, w, h * 0.04);
  ctx.fill();
  rect(ctx, -w / 2, -h / 2, w, h * 0.04);
  ctx.fill();

  // 줄무늬 / 리브
  if (o.stripes) {
    ctx.fillStyle = withAlpha(ORANGE, 0.85);
    const bandH = Math.min(h * 0.1, 0.28);
    rect(ctx, -w / 2, h * 0.5 - bandH * 1.6, w, bandH);
    ctx.fill();
    rect(ctx, -w / 2, -h * 0.5 + bandH * 0.6, w, bandH);
    ctx.fill();
  }
  if (o.ribs) {
    ctx.strokeStyle = withAlpha('#4d545c', 0.5);
    ctx.lineWidth = 0.02;
    const n = Math.max(3, Math.floor(h / 0.18));
    for (let i = 1; i < n; i++) {
      const y = -h / 2 + (h * i) / n;
      ctx.beginPath();
      ctx.moveTo(-w / 2, y);
      ctx.lineTo(w / 2, y);
      ctx.stroke();
    }
  }
  if (o.bands) {
    ctx.strokeStyle = withAlpha('#2c3238', 0.5);
    ctx.lineWidth = 0.03;
    for (const t of [0.3, 0.7]) {
      const y = -h / 2 + h * t;
      ctx.beginPath();
      ctx.moveTo(-w / 2, y);
      ctx.lineTo(w / 2, y);
      ctx.stroke();
    }
  }

  // 연료 잔량 표시선
  if (s?.fuelFraction !== undefined && s.fuelFraction < 0.999) {
    const y = -h / 2 + h * clamp01(s.fuelFraction);
    ctx.strokeStyle = withAlpha('#ffd27a', 0.5);
    ctx.lineWidth = 0.04;
    ctx.beginPath();
    ctx.moveTo(-w / 2, y);
    ctx.lineTo(w / 2, y);
    ctx.stroke();
  }
};

/* 구형 탱크 */
ART.spheretank = (ctx, def) => {
  const r = Math.min(def.size.w, def.size.h) / 2;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  const g = ctx.createRadialGradient(-r * 0.3, r * 0.3, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#f2f5f8');
  g.addColorStop(0.55, '#c0c7ce');
  g.addColorStop(1, '#6f777f');
  ctx.fillStyle = g;
  ctx.fill();
  strokeThin(ctx, '#474e55', 0.03);
  ctx.beginPath();
  ctx.moveTo(-r, 0);
  ctx.lineTo(r, 0);
  strokeThin(ctx, withAlpha('#3b4148', 0.4), 0.02);
};

/* 액체 엔진 */
ART.engine = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const o = def.artOpts ?? {};
  const bell = (o.bellRatio ?? 1) * w * 0.5;

  // 상부 터보펌프 블록
  roundRect(ctx, -w * 0.33, h * 0.1, w * 0.66, h * 0.4, w * 0.05);
  ctx.fillStyle = cylinderGradient(ctx, w * 0.66, '#9aa3ac', '#d0d7de', '#5a6069');
  ctx.fill();
  strokeThin(ctx, '#3b4147', 0.025);

  // 짐벌 링
  if (o.gimbalRing) {
    ctx.beginPath();
    ctx.arc(0, h * 0.1, w * 0.2, 0, TAU);
    ctx.strokeStyle = '#7f8892';
    ctx.lineWidth = 0.05;
    ctx.stroke();
  }

  // 노즐 (나팔)
  ctx.beginPath();
  ctx.moveTo(-w * 0.2, h * 0.12);
  ctx.quadraticCurveTo(-bell * 0.85, -h * 0.15, -bell, -h / 2);
  ctx.lineTo(bell, -h / 2);
  ctx.quadraticCurveTo(bell * 0.85, -h * 0.15, w * 0.2, h * 0.12);
  ctx.closePath();
  const heat = clamp01(s?.enginePower ?? 0);
  const nozzleBase = heat > 0.05 ? mixHex('#7b828a', '#ff6a28', heat * 0.7) : '#7b828a';
  ctx.fillStyle = cylinderGradient(
    ctx,
    bell * 2,
    nozzleBase,
    shade(nozzleBase, 0.4),
    shade(nozzleBase, -0.5)
  );
  ctx.fill();
  strokeThin(ctx, '#33393f', 0.028);

  // 냉각 채널
  ctx.strokeStyle = withAlpha('#4e555c', 0.45);
  ctx.lineWidth = 0.018;
  for (let i = -3; i <= 3; i++) {
    const t = i / 3.5;
    ctx.beginPath();
    ctx.moveTo(w * 0.2 * t, h * 0.12);
    ctx.lineTo(bell * t, -h / 2);
    ctx.stroke();
  }
};

/* 고체 부스터 */
ART.srb = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const stripe = def.artOpts?.stripe ?? '#e8ecef';
  roundRect(ctx, -w / 2, -h / 2 + w * 0.18, w, h - w * 0.18, w * 0.05);
  ctx.fillStyle = cylinderGradient(ctx, w, stripe, shade(stripe, 0.35), shade(stripe, -0.42));
  ctx.fill();
  strokeThin(ctx, shade(stripe, -0.6), 0.025);

  // 분절 이음매
  ctx.strokeStyle = withAlpha('#5a6169', 0.6);
  ctx.lineWidth = 0.035;
  const seg = Math.max(2, Math.round(h / 1.6));
  for (let i = 1; i < seg; i++) {
    const y = -h / 2 + w * 0.18 + ((h - w * 0.18) * i) / seg;
    ctx.beginPath();
    ctx.moveTo(-w / 2, y);
    ctx.lineTo(w / 2, y);
    ctx.stroke();
  }

  // 하단 노즐
  ctx.beginPath();
  ctx.moveTo(-w * 0.18, -h / 2 + w * 0.2);
  ctx.lineTo(-w * 0.34, -h / 2);
  ctx.lineTo(w * 0.34, -h / 2);
  ctx.lineTo(w * 0.18, -h / 2 + w * 0.2);
  ctx.closePath();
  const heat = clamp01(s?.enginePower ?? 0);
  ctx.fillStyle = heat > 0.05 ? mixHex('#5d646b', '#ff8030', heat) : '#5d646b';
  ctx.fill();
};

/* 핵열 엔진 */
ART.nuclear = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  // 방사선 차폐 원반
  roundRect(ctx, -w * 0.52, h * 0.18, w * 1.04, h * 0.1, 0.04);
  ctx.fillStyle = '#8c9299';
  ctx.fill();
  // 원자로 본체
  roundRect(ctx, -w * 0.36, -h * 0.05, w * 0.72, h * 0.3, w * 0.05);
  ctx.fillStyle = cylinderGradient(ctx, w * 0.72, '#a8b0b8', '#dfe5ea', '#646c74');
  ctx.fill();
  strokeThin(ctx, '#3f454b', 0.025);
  // 방사능 마크
  ctx.fillStyle = '#f0c419';
  ctx.beginPath();
  ctx.arc(0, h * 0.1, w * 0.07, 0, TAU);
  ctx.fill();
  // 노즐
  ctx.beginPath();
  ctx.moveTo(-w * 0.2, -h * 0.05);
  ctx.quadraticCurveTo(-w * 0.5, -h * 0.3, -w * 0.46, -h / 2);
  ctx.lineTo(w * 0.46, -h / 2);
  ctx.quadraticCurveTo(w * 0.5, -h * 0.3, w * 0.2, -h * 0.05);
  ctx.closePath();
  const heat = clamp01(s?.enginePower ?? 0);
  ctx.fillStyle = heat > 0.05 ? mixHex('#6f767d', '#9fdfff', heat * 0.6) : '#6f767d';
  ctx.fill();
  strokeThin(ctx, '#32383e', 0.025);
};

/* 이온 엔진 */
ART.ion = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  roundRect(ctx, -w * 0.45, -h * 0.1, w * 0.9, h * 0.6, 0.03);
  ctx.fillStyle = '#8d949c';
  ctx.fill();
  // 그리드
  ctx.beginPath();
  ctx.moveTo(-w * 0.45, -h * 0.1);
  ctx.lineTo(-w * 0.5, -h / 2);
  ctx.lineTo(w * 0.5, -h / 2);
  ctx.lineTo(w * 0.45, -h * 0.1);
  ctx.closePath();
  ctx.fillStyle = '#4b5158';
  ctx.fill();
  const power = clamp01(s?.enginePower ?? 0);
  if (power > 0.02) {
    ctx.fillStyle = withAlpha('#b98cff', 0.5 * power);
    rect(ctx, -w * 0.48, -h / 2 - 0.02, w * 0.96, 0.05);
    ctx.fill();
  }
  strokeThin(ctx, '#343a40', 0.02);
};

/* 제트/공기흡입 엔진 */
ART.jet = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.2);
  ctx.fillStyle = cylinderGradient(ctx, w, '#b8bfc6', '#eef2f5', '#6a727a');
  ctx.fill();
  strokeThin(ctx, '#3c4248', 0.03);
  // 흡입구
  ctx.beginPath();
  ctx.ellipse(0, h * 0.4, w * 0.36, h * 0.1, 0, 0, TAU);
  ctx.fillStyle = '#2a3036';
  ctx.fill();
  // 후방 노즐
  ctx.beginPath();
  ctx.ellipse(0, -h * 0.42, w * 0.33, h * 0.09, 0, 0, TAU);
  const heat = clamp01(s?.enginePower ?? 0);
  ctx.fillStyle = heat > 0.05 ? mixHex('#333a40', '#6ec8ff', heat) : '#333a40';
  ctx.fill();
};

/* 분리기 */
ART.decoupler = (ctx, def) => {
  const w = def.size.w;
  const h = def.size.h;
  rect(ctx, -w / 2, -h / 2, w, h);
  ctx.fillStyle = cylinderGradient(ctx, w, '#c0562f', '#e8874f', '#6f2f17');
  ctx.fill();
  strokeThin(ctx, '#4a1f0f', 0.025);
  // 폭발 볼트
  ctx.fillStyle = withAlpha('#2c1a10', 0.6);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / n;
    ctx.beginPath();
    ctx.arc(x, 0, h * 0.18, 0, TAU);
    ctx.fill();
  }
  if (def.artOpts?.separator) {
    ctx.strokeStyle = withAlpha('#ffdcb0', 0.6);
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(w / 2, 0);
    ctx.stroke();
  }
};

/* 방사형 분리기 */
ART.radialdecoupler = (ctx, def) => {
  const w = def.size.w;
  const h = def.size.h;
  roundRect(ctx, -w / 2, -h / 2, w, h, 0.04);
  ctx.fillStyle = '#b45530';
  ctx.fill();
  strokeThin(ctx, '#5d2a15', 0.02);
  ctx.fillStyle = '#2a1a12';
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.22, 0, TAU);
  ctx.fill();
};

/* 어댑터 */
ART.adapter = (ctx, def) => {
  const h = def.size.h;
  const o = def.artOpts ?? {};
  const tw = o.topWidth ?? def.size.w * 0.5;
  const bw = o.bottomWidth ?? def.size.w;
  poly(ctx, [
    [-bw / 2, -h / 2],
    [bw / 2, -h / 2],
    [tw / 2, h / 2],
    [-tw / 2, h / 2],
  ]);
  ctx.fillStyle = cylinderGradient(ctx, bw, METAL, '#f0f3f6', METAL_SHADOW);
  ctx.fill();
  strokeThin(ctx, '#454c53', 0.03);
  ctx.strokeStyle = withAlpha('#666e76', 0.4);
  ctx.lineWidth = 0.02;
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    const y = -h / 2 + h * t;
    const hw = lerp(bw / 2, tw / 2, t);
    ctx.beginPath();
    ctx.moveTo(-hw, y);
    ctx.lineTo(hw, y);
    ctx.stroke();
  }
};

/* 노즈콘 */
ART.nosecone = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const blunt = def.artOpts?.blunt;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  if (blunt) {
    ctx.quadraticCurveTo(-w * 0.45, h * 0.36, 0, h / 2);
    ctx.quadraticCurveTo(w * 0.45, h * 0.36, w / 2, -h / 2);
  } else {
    ctx.quadraticCurveTo(-w * 0.32, h * 0.1, 0, h / 2);
    ctx.quadraticCurveTo(w * 0.32, h * 0.1, w / 2, -h / 2);
  }
  ctx.closePath();
  const heat = clamp01(s?.heat ?? 0);
  const base = heat > 0.02 ? mixHex(METAL, '#ff6a28', heat) : METAL;
  ctx.fillStyle = cylinderGradient(ctx, w, base, shade(base, 0.4), shade(base, -0.45));
  ctx.fill();
  strokeThin(ctx, '#454c53', 0.03);
};

/* 페어링 */
ART.fairing = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const open = s?.fairingOpen ?? 0;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * open * w * 0.6, 0);
    ctx.rotate(side * open * 0.5);
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo((side * w) / 2, -h / 2);
    ctx.quadraticCurveTo((side * w) / 2, h * 0.28, 0, h / 2);
    ctx.closePath();
    ctx.fillStyle = cylinderGradient(ctx, w, '#e6eaee', '#ffffff', '#98a0a8');
    ctx.fill();
    strokeThin(ctx, '#6d757d', 0.03);
    ctx.restore();
  }
};

/* 큐빅 스트럿 */
ART.cube = (ctx, def) => {
  const w = def.size.w;
  const h = def.size.h;
  roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.15);
  ctx.fillStyle = '#9aa2aa';
  ctx.fill();
  strokeThin(ctx, '#4d545b', 0.02);
  ctx.strokeStyle = withAlpha('#6a727a', 0.6);
  ctx.lineWidth = 0.015;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, h / 2);
  ctx.moveTo(w / 2, -h / 2);
  ctx.lineTo(-w / 2, h / 2);
  ctx.stroke();
};

/* 트러스 */
ART.truss = (ctx, def) => {
  const w = def.size.w;
  const h = def.size.h;
  ctx.strokeStyle = '#9aa2aa';
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(-w / 2, h / 2);
  ctx.moveTo(w / 2, -h / 2);
  ctx.lineTo(w / 2, h / 2);
  ctx.stroke();
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  const n = Math.max(3, Math.round(h / 0.35));
  for (let i = 0; i < n; i++) {
    const y0 = -h / 2 + (h * i) / n;
    const y1 = -h / 2 + (h * (i + 1)) / n;
    if (i % 2 === 0) {
      ctx.moveTo(-w / 2, y0);
      ctx.lineTo(w / 2, y1);
    } else {
      ctx.moveTo(w / 2, y0);
      ctx.lineTo(-w / 2, y1);
    }
  }
  ctx.stroke();
};

/* 열차폐 */
ART.heatshield = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const heat = clamp01(s?.heat ?? 0);
  const ablator = clamp01(s?.ablator ?? 1);
  ctx.beginPath();
  ctx.moveTo(-w / 2, h / 2);
  ctx.lineTo(w / 2, h / 2);
  ctx.lineTo(w * 0.46, -h / 2);
  ctx.quadraticCurveTo(0, -h / 2 - w * 0.1 * ablator, -w * 0.46, -h / 2);
  ctx.closePath();
  const base = mixHex('#3e332c', '#ff5a1e', heat);
  ctx.fillStyle = cylinderGradient(ctx, w, base, shade(base, 0.3), shade(base, -0.4));
  ctx.fill();
  strokeThin(ctx, '#241d18', 0.03);
};

/* 안정 날개 */
ART.fin = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const defl = s?.finDeflection ?? 0;
  ctx.save();
  ctx.rotate(defl * 0.6);
  poly(ctx, [
    [w / 2, h / 2],
    [w / 2, -h / 2],
    [-w / 2, -h * 0.62],
    [-w * 0.1, h * 0.3],
  ]);
  ctx.fillStyle = def.artOpts?.controllable ? '#c4562f' : '#aeb6be';
  ctx.fill();
  strokeThin(ctx, '#4a3025', 0.025);
  ctx.restore();
};

/* 그리드 핀 */
ART.gridfin = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  ctx.save();
  ctx.rotate((s?.finDeflection ?? 0) * 0.5);
  rect(ctx, -w / 2, -h / 2, w, h);
  ctx.fillStyle = withAlpha('#7d858d', 0.85);
  ctx.fill();
  ctx.strokeStyle = '#454c53';
  ctx.lineWidth = 0.02;
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
  ctx.restore();
};

/* 델타 날개 */
ART.wing = (ctx, def) => {
  const w = def.size.w;
  const h = def.size.h;
  poly(ctx, [
    [w / 2, h / 2],
    [w / 2, -h / 2],
    [-w / 2, -h * 0.3],
  ]);
  ctx.fillStyle = '#c2cad2';
  ctx.fill();
  strokeThin(ctx, '#5d656d', 0.025);
};

/* 에어브레이크 */
ART.airbrake = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const open = s?.airbrakeOpen ? 1 : 0;
  ctx.save();
  ctx.rotate(open * 1.1);
  rect(ctx, -w / 2, -h / 2, w, h);
  ctx.fillStyle = open ? '#d9743a' : '#9aa2aa';
  ctx.fill();
  strokeThin(ctx, '#3f464d', 0.025);
  ctx.restore();
};

/* 낙하산 */
ART.chute = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const state = s?.chuteState;
  const prog = s?.chuteProgress ?? 0;

  // 본체 캐니스터
  roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.12);
  ctx.fillStyle = cylinderGradient(ctx, w, '#b9c0c8', '#e6eaee', '#6f777f');
  ctx.fill();
  strokeThin(ctx, '#454c53', 0.025);

  if (!state || state === 'stowed' || state === 'cut' || state === 'destroyed')
    return;

  // 캐노피
  const semi = state === 'deploying';
  const scale = semi ? 0.35 : lerp(0.45, 1, prog);
  const cw = (def.chute?.area ?? 40) ** 0.5 * 0.9 * scale;
  const ch = cw * 0.62;
  const cy = h / 2 + ch * 0.9;

  ctx.beginPath();
  ctx.moveTo(-cw / 2, cy - ch / 2);
  ctx.quadraticCurveTo(-cw / 2, cy + ch, 0, cy + ch);
  ctx.quadraticCurveTo(cw / 2, cy + ch, cw / 2, cy - ch / 2);
  ctx.closePath();
  const g = ctx.createLinearGradient(-cw / 2, 0, cw / 2, 0);
  g.addColorStop(0, '#d94f3d');
  g.addColorStop(0.25, '#f2f2f2');
  g.addColorStop(0.5, '#d94f3d');
  g.addColorStop(0.75, '#f2f2f2');
  g.addColorStop(1, '#d94f3d');
  ctx.fillStyle = g;
  ctx.fill();
  strokeThin(ctx, withAlpha('#5a2018', 0.5), 0.03);

  // 줄
  ctx.strokeStyle = withAlpha('#e8eaec', 0.7);
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  for (let i = -2; i <= 2; i++) {
    ctx.moveTo(0, h / 2);
    ctx.lineTo((i / 2) * (cw / 2), cy - ch / 2);
  }
  ctx.stroke();
};

/* 착륙 다리 */
ART.leg = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  const ext = s?.legExtended ? 1 : 0;
  const comp = s?.legCompression ?? 0;
  const len = (def.leg?.length ?? 1.4) * ext;
  const foot = def.leg?.footWidth ?? 0.5;

  // 힌지
  roundRect(ctx, -w * 0.3, -h * 0.1, w * 0.6, h * 0.3, 0.03);
  ctx.fillStyle = '#8e969e';
  ctx.fill();

  if (ext < 0.01) {
    // 접힌 상태
    rect(ctx, -w * 0.16, -h * 0.45, w * 0.32, h * 0.5);
    ctx.fillStyle = '#9aa2aa';
    ctx.fill();
    strokeThin(ctx, '#4c535a', 0.02);
    return;
  }

  const dropY = -(len - comp);
  const spreadX = -len * 0.55;
  ctx.strokeStyle = '#aeb6be';
  ctx.lineWidth = 0.09;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(spreadX, dropY);
  ctx.stroke();
  // 보조 지지대
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.2);
  ctx.lineTo(spreadX * 0.55, dropY * 0.55);
  ctx.stroke();
  // 발
  ctx.beginPath();
  ctx.ellipse(spreadX, dropY, foot / 2, foot * 0.22, 0, 0, TAU);
  ctx.fillStyle = '#6f777f';
  ctx.fill();
  strokeThin(ctx, '#3d444b', 0.02);
};

/* RCS 블록 */
ART.rcsblock = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  roundRect(ctx, -w * 0.25, -h * 0.25, w * 0.5, h * 0.5, 0.02);
  ctx.fillStyle = '#9aa2aa';
  ctx.fill();
  ctx.fillStyle = '#5d656d';
  const nozzle = w * 0.2;
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(dx * w * 0.25, dy * h * 0.25);
    ctx.lineTo(dx * (w * 0.25 + nozzle) - dy * nozzle * 0.4, dy * (h * 0.25 + nozzle) - dx * nozzle * 0.4);
    ctx.lineTo(dx * (w * 0.25 + nozzle) + dy * nozzle * 0.4, dy * (h * 0.25 + nozzle) + dx * nozzle * 0.4);
    ctx.closePath();
    ctx.fill();
  }
  if (s?.rcsFiring) {
    ctx.fillStyle = withAlpha('#cfe8ff', 0.7);
    ctx.beginPath();
    ctx.arc(0, 0, w * 0.4, 0, TAU);
    ctx.fill();
  }
};

/* 반작용 휠 */
ART.wheel = (ctx, def) => {
  const w = def.size.w;
  const h = def.size.h;
  rect(ctx, -w / 2, -h / 2, w, h);
  ctx.fillStyle = cylinderGradient(ctx, w, '#8f97a0', '#c8ced5', '#575f67');
  ctx.fill();
  strokeThin(ctx, '#3f464d', 0.025);
  ctx.strokeStyle = withAlpha('#5ad1c0', 0.7);
  ctx.lineWidth = 0.025;
  ctx.beginPath();
  ctx.moveTo(-w * 0.35, 0);
  ctx.lineTo(w * 0.35, 0);
  ctx.stroke();
};

/* 배터리 */
ART.battery = (ctx, def) => {
  const w = def.size.w;
  const h = def.size.h;
  roundRect(ctx, -w / 2, -h / 2, w, h, 0.02);
  ctx.fillStyle = '#3f6f4e';
  ctx.fill();
  strokeThin(ctx, '#1f3827', 0.02);
  ctx.fillStyle = '#e8d76a';
  const n = def.artOpts?.stack ? 4 : 2;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w * (i + 0.5)) / n;
    rect(ctx, x - w * 0.06, -h * 0.3, w * 0.12, h * 0.6);
    ctx.fill();
  }
};

/* 태양전지 */
ART.solar = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  // 본체
  roundRect(ctx, -w * 0.3, -h * 0.3, w * 0.6, h * 0.6, 0.02);
  ctx.fillStyle = '#8f97a0';
  ctx.fill();
  if (!s?.deployed) return;

  const large = def.artOpts?.large;
  const pw = large ? 3.6 : 1.8;
  const ph = large ? 1.0 : 0.6;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * (w * 0.3 + pw / 2), 0);
    rect(ctx, -pw / 2, -ph / 2, pw, ph);
    const g = ctx.createLinearGradient(-pw / 2, -ph / 2, pw / 2, ph / 2);
    g.addColorStop(0, '#14335e');
    g.addColorStop(0.5, '#2a5f9e');
    g.addColorStop(1, '#14335e');
    ctx.fillStyle = g;
    ctx.fill();
    strokeThin(ctx, '#0b1c33', 0.02);
    ctx.strokeStyle = withAlpha('#6fa8e0', 0.35);
    ctx.lineWidth = 0.015;
    const cells = large ? 8 : 5;
    for (let i = 1; i < cells; i++) {
      const x = -pw / 2 + (pw * i) / cells;
      ctx.beginPath();
      ctx.moveTo(x, -ph / 2);
      ctx.lineTo(x, ph / 2);
      ctx.stroke();
    }
    ctx.restore();
  }
};

/* RTG */
ART.rtg = (ctx, def) => {
  const w = def.size.w;
  const h = def.size.h;
  roundRect(ctx, -w * 0.28, -h / 2, w * 0.56, h, 0.03);
  ctx.fillStyle = '#77808a';
  ctx.fill();
  strokeThin(ctx, '#3b4249', 0.02);
  // 방열 핀
  ctx.fillStyle = '#5c646d';
  for (let i = -2; i <= 2; i++) {
    rect(ctx, -w / 2, (i * h) / 6 - 0.02, w, 0.04);
    ctx.fill();
  }
  ctx.fillStyle = withAlpha('#ffb03a', 0.6);
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.1, 0, TAU);
  ctx.fill();
};

/* 도킹 포트 */
ART.dock = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  rect(ctx, -w / 2, -h / 2, w, h);
  ctx.fillStyle = cylinderGradient(ctx, w, '#a8b0b8', '#e0e6ec', '#656d75');
  ctx.fill();
  strokeThin(ctx, '#3f464d', 0.02);
  ctx.fillStyle = s?.docked ? '#63f0b0' : '#2c3238';
  rect(ctx, -w * 0.3, -h * 0.2, w * 0.6, h * 0.4);
  ctx.fill();
};

/* 발사 클램프 */
ART.clamp = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  ctx.fillStyle = '#d9a23a';
  rect(ctx, -w / 2, -h / 2, w * 0.5, h);
  ctx.fill();
  strokeThin(ctx, '#6d4f12', 0.025);
  // 팔
  ctx.strokeStyle = '#d9a23a';
  ctx.lineWidth = 0.09;
  ctx.beginPath();
  ctx.moveTo(-w * 0.25, h * 0.32);
  ctx.lineTo(w * 0.5, h * 0.32);
  ctx.moveTo(-w * 0.25, -h * 0.05);
  ctx.lineTo(w * 0.5, -h * 0.05);
  ctx.stroke();
  // 경고 줄무늬
  ctx.fillStyle = withAlpha('#1f1a10', 0.6);
  for (let i = 0; i < 5; i++) {
    rect(ctx, -w / 2, -h / 2 + (h * i) / 5, w * 0.5, h * 0.06);
    ctx.fill();
  }
};

/* 조명 */
ART.light = (ctx, def, s) => {
  const w = def.size.w;
  roundRect(ctx, -w / 2, -w / 2, w, w, 0.02);
  ctx.fillStyle = '#7d858d';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.3, 0, TAU);
  ctx.fillStyle = s?.lightOn ? '#fff4d0' : '#4a5158';
  ctx.fill();
  if (s?.lightOn) {
    const g = ctx.createRadialGradient(0, 0, w * 0.2, 0, 0, w * 3);
    g.addColorStop(0, withAlpha('#fff4d0', 0.35));
    g.addColorStop(1, withAlpha('#fff4d0', 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, w * 3, 0, TAU);
    ctx.fill();
  }
};

/* 사다리 */
ART.ladder = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  ctx.strokeStyle = '#b4bcc4';
  ctx.lineWidth = 0.035;
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(-w / 2, h / 2);
  ctx.moveTo(w / 2, -h / 2);
  ctx.lineTo(w / 2, h / 2);
  ctx.stroke();
  ctx.lineWidth = 0.028;
  const n = Math.max(4, Math.round(h / 0.25));
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const y = -h / 2 + (h * i) / n;
    ctx.moveTo(-w / 2, y);
    ctx.lineTo(w / 2, y);
  }
  ctx.stroke();
};

/* 계측 장비 */
ART.instrument = (ctx, def) => {
  const w = def.size.w;
  const h = def.size.h;
  const v = def.artOpts?.variant ?? 0;
  roundRect(ctx, -w / 2, -h / 2, w, h, 0.02);
  ctx.fillStyle = ['#8f97a0', '#7a8f9a', '#6f7d8a'][v % 3];
  ctx.fill();
  strokeThin(ctx, '#3b4249', 0.02);
  ctx.fillStyle = '#e8d76a';
  ctx.beginPath();
  ctx.arc(0, h * 0.15, w * 0.13, 0, TAU);
  ctx.fill();
  if (v === 0) {
    ctx.strokeStyle = '#d9573a';
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(0, -h * 0.8);
    ctx.stroke();
  }
};

/* 구 캐니스터 */
ART.goo = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.2);
  ctx.fillStyle = '#8f97a0';
  ctx.fill();
  strokeThin(ctx, '#3b4249', 0.025);
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.24, 0, TAU);
  ctx.fillStyle = s?.scienceUsed ? '#4a5158' : '#8fd94a';
  ctx.fill();
};

/* 실험실 */
ART.lab = (ctx, def) => {
  const w = def.size.w;
  const h = def.size.h;
  rect(ctx, -w / 2, -h / 2, w, h);
  ctx.fillStyle = cylinderGradient(ctx, w, '#b0b8c0', '#e4e9ee', '#697179');
  ctx.fill();
  strokeThin(ctx, '#3f464d', 0.025);
  ctx.fillStyle = '#2f81c4';
  for (let i = -1; i <= 1; i++) {
    rect(ctx, i * w * 0.25 - w * 0.07, -h * 0.2, w * 0.14, h * 0.4);
    ctx.fill();
  }
};

/* 안테나 */
ART.antenna = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  roundRect(ctx, -w / 2, -h * 0.45, w, h * 0.2, 0.02);
  ctx.fillStyle = '#8f97a0';
  ctx.fill();
  if (s?.deployed === false) return;
  ctx.strokeStyle = '#d0d6dc';
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.3);
  ctx.lineTo(0, h * 0.5);
  ctx.stroke();
  ctx.lineWidth = 0.02;
  for (let i = 0; i < 4; i++) {
    const y = -h * 0.1 + (h * 0.5 * i) / 4;
    ctx.beginPath();
    ctx.moveTo(-w * 0.8, y);
    ctx.lineTo(w * 0.8, y);
    ctx.stroke();
  }
};

/* 접시 안테나 */
ART.dish = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  ctx.beginPath();
  ctx.ellipse(0, 0, w / 2, h / 2, 0, Math.PI * 0.15, Math.PI * 0.85);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fillStyle = '#dfe4e9';
  ctx.fill();
  strokeThin(ctx, '#7d858d', 0.025);
  ctx.strokeStyle = '#9aa2aa';
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -h * 0.4);
  ctx.stroke();
};

/* 위성 본체 */
ART.satellite = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.08);
  ctx.fillStyle = cylinderGradient(ctx, w, '#c7a24a', '#f0dc96', '#7d6320');
  ctx.fill();
  strokeThin(ctx, '#4e3d12', 0.025);
  ctx.fillStyle = withAlpha('#2c3238', 0.5);
  rect(ctx, -w * 0.35, -h * 0.1, w * 0.7, h * 0.2);
  ctx.fill();
};

/* 로버 */
ART.rover = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  roundRect(ctx, -w * 0.4, -h * 0.1, w * 0.8, h * 0.55, 0.05);
  ctx.fillStyle = '#b0b8c0';
  ctx.fill();
  strokeThin(ctx, '#454c53', 0.025);
  // 바퀴
  ctx.fillStyle = '#3b4249';
  for (const x of [-w * 0.34, -w * 0.1, w * 0.16, w * 0.38]) {
    ctx.beginPath();
    ctx.arc(x, -h * 0.18, h * 0.22, 0, TAU);
    ctx.fill();
  }
  // 태양전지 상판
  ctx.fillStyle = '#1f4a7d';
  rect(ctx, -w * 0.38, h * 0.4, w * 0.76, h * 0.12);
  ctx.fill();
};

/* 거주 모듈 */
ART.habitat = (ctx, def) => {
  const w = def.size.w;
  const h = def.size.h;
  roundRect(ctx, -w / 2, -h / 2, w, h, w * 0.2);
  ctx.fillStyle = cylinderGradient(ctx, w, '#d6dce2', '#ffffff', '#7b838b');
  ctx.fill();
  strokeThin(ctx, '#4b525a', 0.03);
  ctx.fillStyle = '#2a4f70';
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(i * w * 0.3, h * 0.1, w * 0.09, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = withAlpha('#e0b64a', 0.5);
  rect(ctx, -w / 2, -h * 0.45, w, h * 0.12);
  ctx.fill();
};

/* 채굴 드릴 */
ART.drill = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  roundRect(ctx, -w * 0.35, -h * 0.1, w * 0.7, h * 0.6, 0.04);
  ctx.fillStyle = '#8a929a';
  ctx.fill();
  strokeThin(ctx, '#3f464d', 0.025);
  // 드릴 비트
  ctx.beginPath();
  ctx.moveTo(-w * 0.12, -h * 0.1);
  ctx.lineTo(0, -h / 2);
  ctx.lineTo(w * 0.12, -h * 0.1);
  ctx.closePath();
  ctx.fillStyle = s?.active ? '#e0a03a' : '#5c646d';
  ctx.fill();
};

/* ISRU 변환기 */
ART.converter = (ctx, def, s) => {
  const w = def.size.w;
  const h = def.size.h;
  rect(ctx, -w / 2, -h / 2, w, h);
  ctx.fillStyle = cylinderGradient(ctx, w, '#9aa2aa', '#d4dae0', '#5f676f');
  ctx.fill();
  strokeThin(ctx, '#3f464d', 0.025);
  // 파이프
  ctx.strokeStyle = s?.active ? '#5ad1c0' : '#6f777f';
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  ctx.moveTo(-w * 0.3, -h * 0.3);
  ctx.lineTo(-w * 0.3, h * 0.3);
  ctx.lineTo(w * 0.3, h * 0.3);
  ctx.lineTo(w * 0.3, -h * 0.3);
  ctx.stroke();
};

/* 기본 폴백 */
ART.default = (ctx, def) => {
  const w = def.size.w;
  const h = def.size.h;
  rect(ctx, -w / 2, -h / 2, w, h);
  ctx.fillStyle = '#9aa2aa';
  ctx.fill();
  strokeThin(ctx, '#454c53', 0.025);
};

/* ──────────────────────────────────────────────────────────────
 * 공개 API
 * ────────────────────────────────────────────────────────────── */

/**
 * 부품 하나를 그린다. ctx 는 이미 부품 중심으로 이동·회전되어 있어야 한다.
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} def 부품 정의
 * @param {object} state 런타임 상태 (연료 비율, 전개 여부, 온도 등)
 */
export function drawPart(ctx, def, state = null) {
  const fn = ART[def.art] ?? ART.default;
  ctx.save();
  try {
    fn(ctx, def, state);
  } catch (e) {
    // 하나가 실패해도 렌더링 전체가 멈추지 않게 한다
    ART.default(ctx, def, state);
  }
  ctx.restore();
}

/**
 * 과열 글로우 오버레이.
 */
export function drawHeatGlow(ctx, def, heatFraction) {
  if (heatFraction < 0.25) return;
  const w = def.size.w;
  const h = def.size.h;
  const t = clamp01((heatFraction - 0.25) / 0.75);
  const r = Math.max(w, h) * 0.9;
  const g = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r);
  const color = t > 0.7 ? '#ffe9a0' : '#ff6a28';
  g.addColorStop(0, withAlpha(color, 0.55 * t));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
}

/**
 * 설계실 아이콘용 — 부품을 정사각형 안에 맞춰 그린다.
 */
export function drawPartIcon(ctx, def, size, state = null) {
  const w = def.size.w;
  const h = def.size.h;
  const scale = (size * 0.78) / Math.max(w, h);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(scale, -scale);
  drawPart(ctx, def, state);
  ctx.restore();
}

/** 등록된 아트 타입 목록 (디버그용) */
export const ART_TYPES = Object.keys(ART);
