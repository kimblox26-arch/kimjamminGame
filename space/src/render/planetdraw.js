// ORBITER — 천체 렌더링
//
// 두 모드가 있다.
//   1) 원거리(disc)   : 원반 + 구체 셰이딩 + 구름층 + 대기 림 + 명암경계 + 야간 불빛
//   2) 근접(terrain)  : 지형 프로파일을 경사면 조명으로 칠하고, 거리 헤이즈와 바위를 얹는다
//
// 사실감의 핵심은 "빛이 어디서 오는가" 다. 모든 셰이딩이 sunDir 을 따라간다.

import {
  TAU,
  clamp,
  clamp01,
  lerp,
  smoothstep,
  wrapTau,
  withAlpha,
  mixHex,
  shade,
  hash01,
  Vec2,
} from '../core/math.js';

/* ──────────────────────────────────────────────────────────────
 * 원거리 — 천체 원반
 * ────────────────────────────────────────────────────────────── */

/**
 * @param {object} opts { sunDir, time, showAtmosphere, detail }
 */
export function drawBodyDisc(ctx, camera, body, worldPos, opts = {}) {
  const sp = camera.worldToScreen(worldPos.x, worldPos.y);
  const r = body.radius * camera.zoom;

  if (r < 0.6) {
    // 점광원으로 — 밝기는 크기에 비례
    const a = clamp01(r / 0.6) * 0.9 + 0.1;
    ctx.fillStyle = withAlpha(body.palette.map ?? body.palette.surface, a);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, Math.max(1, r * 1.6), 0, TAU);
    ctx.fill();
    return;
  }

  const sunDir = opts.sunDir ?? { x: -1, y: 0 };
  const time = opts.time ?? 0;
  const rotation = body.rotationAt(time);
  // 화면 좌표에서 태양 방향 (y 뒤집힘 주의)
  const lx = sunDir.x * Math.cos(-camera.rotation) - sunDir.y * Math.sin(-camera.rotation);
  const ly = -(sunDir.x * Math.sin(-camera.rotation) + sunDir.y * Math.cos(-camera.rotation));

  ctx.save();

  /* 1. 대기 — 바깥 글로우 */
  if (body.atmo.exists && (opts.showAtmosphere ?? true)) {
    drawAtmosphereHalo(ctx, body, sp, r, camera, lx, ly);
  }

  /* 2. 고리 뒤쪽 */
  if (body.rings) drawRings(ctx, camera, body, sp, r, false, lx, ly);

  /* 3. 항성은 따로 */
  if (body.type === 'star') {
    drawStarBody(ctx, body, sp, r);
    ctx.restore();
    return;
  }

  /* 4. 본체 구체 셰이딩 */
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r, 0, TAU);
  const g = ctx.createRadialGradient(
    sp.x - lx * r * 0.55,
    sp.y - ly * r * 0.55,
    r * 0.02,
    sp.x - lx * r * 0.2,
    sp.y - ly * r * 0.2,
    r * 1.35
  );
  g.addColorStop(0, shade(body.palette.highlight, 0.1));
  g.addColorStop(0.3, body.palette.surface);
  g.addColorStop(0.68, shade(body.palette.deep, -0.1));
  g.addColorStop(1, shade(body.palette.deep, -0.6));
  ctx.fillStyle = g;
  ctx.fill();

  /* 5. 표면 무늬 */
  if (r > 8) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, 0, TAU);
    ctx.clip();
    if (body.gasGiant) {
      drawGasBands(ctx, body, sp, r, rotation, lx, ly);
    } else {
      drawSurfaceTexture(ctx, body, sp, r, rotation, lx, ly);
      if (body.ocean) drawOceanSpecular(ctx, body, sp, r, lx, ly);
      if (body.atmo.exists && r > 20) drawCloudLayer(ctx, body, sp, r, rotation, time);
    }
    ctx.restore();
  }

  /* 6. 명암경계 — 부드러운 반그림자 */
  ctx.save();
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r, 0, TAU);
  ctx.clip();
  const tg = ctx.createLinearGradient(
    sp.x - lx * r,
    sp.y - ly * r,
    sp.x + lx * r,
    sp.y + ly * r
  );
  tg.addColorStop(0, 'rgba(0,0,0,0)');
  tg.addColorStop(0.42, 'rgba(0,0,0,0.04)');
  tg.addColorStop(0.55, 'rgba(2,4,8,0.4)');
  tg.addColorStop(0.68, 'rgba(2,4,8,0.78)');
  tg.addColorStop(1, 'rgba(1,2,5,0.93)');
  ctx.fillStyle = tg;
  ctx.fillRect(sp.x - r, sp.y - r, r * 2, r * 2);

  // 야간 도시 불빛 (모성만)
  if (body.home && r > 26) {
    drawNightLights(ctx, body, sp, r, rotation, lx, ly);
  }
  ctx.restore();

  /* 7. 대기 림 — 빛이 스치는 쪽이 밝다 */
  if (body.atmo.exists) {
    const rimColor = body.palette.atmoGlow ?? '#7ec3f0';
    const rg = ctx.createRadialGradient(sp.x, sp.y, r * 0.93, sp.x, sp.y, r * 1.02);
    rg.addColorStop(0, withAlpha(rimColor, 0));
    rg.addColorStop(0.7, withAlpha(rimColor, 0.35));
    rg.addColorStop(1, withAlpha(rimColor, 0));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r * 1.02, 0, TAU);
    ctx.fillStyle = rg;
    ctx.fill();
    ctx.restore();
  }

  /* 8. 고리 앞쪽 */
  if (body.rings) drawRings(ctx, camera, body, sp, r, true, lx, ly);

  ctx.restore();
}

/** 대기 헤일로 — 전방 산란으로 태양 쪽이 더 밝다 */
function drawAtmosphereHalo(ctx, body, sp, r, camera, lx, ly) {
  const ar = (body.radius + body.atmo.height) * camera.zoom;
  const color = body.palette.atmoGlow ?? '#7ec3f0';
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(
    sp.x - lx * r * 0.25,
    sp.y - ly * r * 0.25,
    r * 0.96,
    sp.x,
    sp.y,
    ar * 1.04
  );
  g.addColorStop(0, withAlpha(color, 0.42));
  g.addColorStop(0.35, withAlpha(color, 0.16));
  g.addColorStop(0.75, withAlpha(color, 0.05));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, ar * 1.04, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** 항성 */
function drawStarBody(ctx, body, sp, r) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // 코로나
  const cg = ctx.createRadialGradient(sp.x, sp.y, r * 0.8, sp.x, sp.y, r * 4.5);
  cg.addColorStop(0, withAlpha('#ffd77a', 0.5));
  cg.addColorStop(0.2, withAlpha('#ff9a3a', 0.22));
  cg.addColorStop(0.6, withAlpha('#ff6a2a', 0.06));
  cg.addColorStop(1, withAlpha('#ff5a1e', 0));
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r * 4.5, 0, TAU);
  ctx.fill();
  ctx.restore();

  // 광구
  const g = ctx.createRadialGradient(sp.x, sp.y, r * 0.1, sp.x, sp.y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, '#fff0b0');
  g.addColorStop(0.82, '#ffc44a');
  g.addColorStop(1, '#ff8a2a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r, 0, TAU);
  ctx.fill();
}

/** 가스 행성 줄무늬 — 위도에 따라 눌린 띠 + 소용돌이 */
function drawGasBands(ctx, body, sp, r, rotation, lx, ly) {
  const pal = body.palette;
  const n = body.def.terrain?.bands ?? 8;
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    // 구면 투영: 화면 y 를 위도로 환산
    const y0 = sp.y - r + r * 2 * t0;
    const y1 = sp.y - r + r * 2 * t1;
    const c = i % 2 === 0 ? pal.band1 ?? pal.surface : pal.band2 ?? pal.deep;
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, withAlpha(shade(c, -0.12), 0.75));
    g.addColorStop(0.5, withAlpha(c, 0.85));
    g.addColorStop(1, withAlpha(shade(c, -0.16), 0.75));
    ctx.fillStyle = g;
    ctx.fillRect(sp.x - r, y0, r * 2, y1 - y0 + 1);

    // 띠 경계의 난류
    if (r > 40) {
      ctx.strokeStyle = withAlpha(shade(c, 0.22), 0.35);
      ctx.lineWidth = Math.max(1, r * 0.008);
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) {
        const x = sp.x - r + (r * 2 * k) / 24;
        const wob = Math.sin(k * 0.9 + i * 2.3 + rotation * 0.4) * r * 0.012;
        if (k === 0) ctx.moveTo(x, y1 + wob);
        else ctx.lineTo(x, y1 + wob);
      }
      ctx.stroke();
    }
  }
  // 대적점
  if (pal.spot) {
    const a = rotation * 0.6;
    const cosA = Math.cos(a);
    if (cosA > -0.2) {
      const sx = sp.x + cosA * r * 0.42;
      const sy = sp.y + r * 0.2;
      ctx.save();
      ctx.globalAlpha = clamp01(cosA + 0.2);
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 0.22);
      sg.addColorStop(0, withAlpha(shade(pal.spot, 0.25), 0.9));
      sg.addColorStop(0.6, withAlpha(pal.spot, 0.75));
      sg.addColorStop(1, withAlpha(pal.spot, 0));
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.ellipse(sx, sy, r * 0.22 * Math.abs(cosA), r * 0.12, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
}

/** 암석 천체 표면 — 지형 고도를 극좌표로 샘플링해 실제 지형을 반영 */
function drawSurfaceTexture(ctx, body, sp, r, rotation, lx, ly) {
  const terrain = body.terrain;
  const steps = clamp(Math.round(r * 0.9), 32, 360);
  const amp = Math.max(body.def.terrain?.amplitude ?? 1000, 1);

  // 표면 색을 링으로 칠한다 (구면 투영 근사)
  ctx.lineWidth = Math.max(1.2, r * 0.075);
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * TAU;
    const a1 = ((i + 1) / steps) * TAU;
    const theta = a0 - rotation;
    const color = terrain.colorAt(theta);
    // 이 지점이 태양을 향하는 정도
    const facing = clamp01(-(Math.cos(a0) * lx + Math.sin(a0) * ly) * 0.5 + 0.5);
    ctx.strokeStyle = withAlpha(shade(color, facing * 0.22 - 0.06), 0.62);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r * 0.962, a0, a1 + 0.012);
    ctx.stroke();
  }

  // 안쪽 지형 얼룩 — 고도에 따라 밝기가 달라진다
  const blobs = clamp(Math.round(r / 5), 4, 48);
  for (let i = 0; i < blobs; i++) {
    const seed = i * 2.399963;
    const a = seed % TAU;
    const rr = r * (0.15 + ((i * 0.37) % 1) * 0.72);
    const bx = sp.x + Math.cos(a) * rr;
    const by = sp.y + Math.sin(a) * rr;
    const theta = a - rotation;
    const elev = terrain.elevationAt(theta);
    const n = clamp(elev / amp, -1, 1);
    const size = r * lerp(0.06, 0.22, (i * 0.61) % 1);
    const lit = clamp01(
      -((bx - sp.x) / r * lx + (by - sp.y) / r * ly) * 0.5 + 0.5
    );
    const c = n > 0 ? body.palette.highlight : body.palette.deep;
    const gg = ctx.createRadialGradient(bx, by, 0, bx, by, size);
    gg.addColorStop(0, withAlpha(c, (0.1 + Math.abs(n) * 0.2) * (0.5 + lit * 0.8)));
    gg.addColorStop(1, withAlpha(c, 0));
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.ellipse(bx, by, size, size * 0.72, a, 0, TAU);
    ctx.fill();
  }

  // 충돌구 — 태양 반대쪽에 그림자가 진다
  if ((body.def.terrain?.craters ?? 0) > 0.3 && r > 24) {
    const craters = terrain.craters.slice(0, clamp(Math.round(r / 10), 4, 26));
    for (const c of craters) {
      const a = c.center + rotation;
      const dist = r * (0.2 + ((c.center * 7.13) % 1) * 0.7);
      const cx = sp.x + Math.cos(a) * dist;
      const cy = sp.y + Math.sin(a) * dist;
      const cr = clamp(c.angularRadius * r * 2.2, 1.5, r * 0.3);
      if (cr < 1.6) continue;
      // 바닥 그림자 (태양 쪽)
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(cx - lx * cr * 0.22, cy - ly * cr * 0.22, cr * 0.78, cr * 0.6, a, 0, TAU);
      ctx.fill();
      // 테두리 밝은 쪽
      ctx.strokeStyle = withAlpha(body.palette.highlight, 0.4);
      ctx.lineWidth = Math.max(0.8, cr * 0.16);
      ctx.beginPath();
      ctx.ellipse(cx, cy, cr * 0.88, cr * 0.68, a, 0, TAU);
      ctx.stroke();
    }
  }

  // 극관
  if (body.def.terrain?.polarCaps) {
    const ice = body.palette.ice ?? '#ffffff';
    for (const sy of [-1, 1]) {
      const g = ctx.createRadialGradient(
        sp.x,
        sp.y + sy * r * 0.92,
        0,
        sp.x,
        sp.y + sy * r * 0.92,
        r * 0.5
      );
      g.addColorStop(0, withAlpha(ice, 0.78));
      g.addColorStop(0.6, withAlpha(ice, 0.32));
      g.addColorStop(1, withAlpha(ice, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y + sy * r * 0.92, r * 0.5, r * 0.2, 0, 0, TAU);
      ctx.fill();
    }
  }
}

/** 바다의 거울 반사 — 태양 쪽에 밝은 점 */
function drawOceanSpecular(ctx, body, sp, r, lx, ly) {
  const x = sp.x - lx * r * 0.45;
  const y = sp.y - ly * r * 0.45;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 0.42);
  g.addColorStop(0, 'rgba(255,255,240,0.32)');
  g.addColorStop(0.3, 'rgba(190,225,255,0.12)');
  g.addColorStop(1, 'rgba(190,225,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.42, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** 구름층 — 본체보다 조금 빠르게 돈다 */
function drawCloudLayer(ctx, body, sp, r, rotation, time) {
  const drift = rotation * 1.12 + time * 1e-5;
  const n = clamp(Math.round(r / 7), 5, 34);
  ctx.save();
  for (let i = 0; i < n; i++) {
    const seed = i * 3.6;
    const a = (seed % TAU) + drift;
    const rr = r * (0.1 + ((i * 0.43) % 1) * 0.82);
    const cx = sp.x + Math.cos(a) * rr;
    const cy = sp.y + Math.sin(a) * rr;
    const sw = r * lerp(0.08, 0.3, (i * 0.29) % 1);
    const sh = sw * lerp(0.35, 0.6, (i * 0.71) % 1);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, sw);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.55, 'rgba(245,250,255,0.24)');
    g.addColorStop(1, 'rgba(245,250,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, sw, sh, a, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** 야간 도시 불빛 */
function drawNightLights(ctx, body, sp, r, rotation, lx, ly) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const n = clamp(Math.round(r / 4), 8, 90);
  for (let i = 0; i < n; i++) {
    const a = (i * 2.399963) % TAU;
    const rr = r * (0.1 + hash01(i * 37) * 0.85);
    const x = sp.x + Math.cos(a) * rr;
    const y = sp.y + Math.sin(a) * rr;
    // 밤쪽에만
    const nightness = clamp01(((x - sp.x) / r * lx + (y - sp.y) / r * ly) * 1.4 - 0.1);
    if (nightness < 0.05) continue;
    // 바다 위에는 불빛이 없다
    const theta = a - rotation;
    if (body.terrain.isOcean(theta)) continue;
    // 도시 크기는 화면상 몇 px 로 제한한다 (가까이 가도 거대한 얼룩이 되지 않게)
    const size = clamp(r * lerp(0.008, 0.026, hash01(i * 91)), 2, 22);
    const g = ctx.createRadialGradient(x, y, 0, x, y, size);
    g.addColorStop(0, withAlpha('#ffd98a', 0.5 * nightness));
    g.addColorStop(0.45, withAlpha('#ffc26a', 0.16 * nightness));
    g.addColorStop(1, withAlpha('#ffb45a', 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, TAU);
    ctx.fill();
    // 도심 — 작고 또렷한 점 몇 개
    const cores = 3 + Math.floor(hash01(i * 53) * 4);
    for (let k = 0; k < cores; k++) {
      const ha = hash01(i * 131 + k * 17) * TAU;
      const hr = size * 0.7 * hash01(i * 197 + k * 29);
      ctx.fillStyle = withAlpha('#fff0c0', 0.5 * nightness);
      ctx.beginPath();
      ctx.arc(x + Math.cos(ha) * hr, y + Math.sin(ha) * hr, Math.max(0.6, size * 0.07), 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 고리 */
function drawRings(ctx, camera, body, sp, r, front, lx, ly) {
  const rings = body.rings;
  const inner = rings.inner * camera.zoom;
  const outer = rings.outer * camera.zoom;
  if (outer < 4) return;

  ctx.save();
  const squash = 0.22;
  ctx.translate(sp.x, sp.y);
  ctx.scale(1, squash);

  const steps = 40;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const r0 = lerp(inner, outer, t0);
    const r1 = lerp(inner, outer, t1);
    let skip = false;
    for (const gap of rings.gaps ?? []) {
      const gr = gap.at * camera.zoom;
      const gw = gap.width * camera.zoom;
      if (r0 > gr - gw / 2 && r1 < gr + gw / 2) skip = true;
    }
    if (skip) continue;
    // 입자 밀도가 균일하지 않다
    const density =
      0.35 +
      0.3 * Math.sin(t0 * 22) +
      0.2 * Math.sin(t0 * 61 + 1.3) +
      0.15 * Math.sin(t0 * 7);
    const alpha = clamp01(density) * (front ? 0.42 : 0.3);
    ctx.strokeStyle = withAlpha(
      mixHex(rings.color, '#ffffff', clamp01(density) * 0.35),
      alpha
    );
    ctx.lineWidth = Math.max(0.7, r1 - r0);
    ctx.beginPath();
    if (front) ctx.arc(0, 0, (r0 + r1) / 2, 0, Math.PI);
    else ctx.arc(0, 0, (r0 + r1) / 2, Math.PI, TAU);
    ctx.stroke();
  }
  ctx.restore();

  // 행성이 고리에 드리우는 그림자
  if (front) {
    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.scale(1, squash);
    ctx.globalCompositeOperation = 'multiply';
    const shadowAngle = Math.atan2(ly, lx);
    ctx.fillStyle = 'rgba(20,22,30,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, outer, shadowAngle - 0.16, shadowAngle + 0.16);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/* ──────────────────────────────────────────────────────────────
 * 근접 — 지형
 * ────────────────────────────────────────────────────────────── */

/**
 * 지형을 경사면 조명으로 그린다.
 * @param {object} opts { time, sunAngle, skyColor, hazeStrength }
 */
export function drawTerrain(ctx, camera, body, worldPos, opts = {}) {
  const time = opts.time ?? 0;
  const rotation = body.rotationAt(time);
  const camWorld = camera.pos;

  const dx = camWorld.x - worldPos.x;
  const dy = camWorld.y - worldPos.y;
  const camTheta = Math.atan2(dy, dx);
  const camR = Math.hypot(dx, dy);
  const altitude = camR - body.radius;

  const viewHalfWidth = camera.width / 2 / camera.zoom;
  const span = clamp((viewHalfWidth / Math.max(camR, 1)) * 2.8, 0.00002, Math.PI);
  const segments = clamp(Math.round(camera.width / 4), 64, 640);
  const step = (span * 2) / segments;

  const oceanR = body.terrain.oceanRadius;
  const sunAngle = opts.sunAngle ?? 0;
  // 태양 방향 단위벡터 (천체 중심 좌표계)
  const sunX = Math.cos(sunAngle);
  const sunY = Math.sin(sunAngle);

  // 표면 샘플
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const theta = camTheta - span + step * i;
    const surfaceTheta = theta - rotation;
    const rr = body.terrain.radiusAt(surfaceTheta);
    pts.push({
      theta,
      r: rr,
      color: body.terrain.colorAt(surfaceTheta),
      ocean: oceanR !== null && rr < oceanR,
    });
  }

  // 표면 법선 — 넓은 창으로 기울기를 평균내 고주파 노이즈가
  // 세로 줄무늬로 보이는 것을 막는다
  {
    const win = clamp(Math.round(segments / 48), 2, 16);
    for (let i = 0; i <= segments; i++) {
      const i0 = Math.max(0, i - win);
      const i1 = Math.min(segments, i + win);
      const arc = Math.max(body.radius * step * (i1 - i0), 1e-6);
      const slope = Math.atan2(pts[i1].r - pts[i0].r, arc);
      pts[i].n = pts[i].theta - slope;
    }
    // 한 번 더 부드럽게
    const smooth = new Float64Array(segments + 1);
    for (let i = 0; i <= segments; i++) {
      const p = pts[Math.max(0, i - 1)].n;
      const c = pts[i].n;
      const q = pts[Math.min(segments, i + 1)].n;
      smooth[i] = (p + c * 2 + q) / 4;
    }
    for (let i = 0; i <= segments; i++) pts[i].n = smooth[i];
  }

  // 화면을 덮을 만큼만 안쪽으로 닫는다
  const viewSpan = Math.hypot(camera.width, camera.height) / camera.zoom;
  const closeR = Math.max(body.radius * 0.02, camR - viewSpan * 1.6);

  const sp = { x: 0, y: 0 };
  const sp2 = { x: 0, y: 0 };
  const ip = { x: 0, y: 0 };
  const ip2 = { x: 0, y: 0 };
  const sp3 = { x: 0, y: 0 };

  /* 0. 바탕 — 조각 사이 틈이 하늘색으로 새지 않도록 한 번에 채운다 */
  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const p = pts[i];
    camera.worldToScreen(
      worldPos.x + Math.cos(p.theta) * p.r,
      worldPos.y + Math.sin(p.theta) * p.r,
      sp
    );
    if (i === 0) ctx.moveTo(sp.x, sp.y);
    else ctx.lineTo(sp.x, sp.y);
  }
  for (let i = segments; i >= 0; i -= Math.max(1, Math.floor(segments / 8))) {
    camera.worldToScreen(
      worldPos.x + Math.cos(pts[i].theta) * closeR,
      worldPos.y + Math.sin(pts[i].theta) * closeR,
      sp
    );
    ctx.lineTo(sp.x, sp.y);
  }
  ctx.closePath();
  ctx.fillStyle = shade(pts[segments >> 1].color, -0.3);
  ctx.fill();

  /* 1. 지형 본체 — 세그먼트마다 경사 조명을 적용해 칠한다 */
  for (let i = 0; i < segments; i++) {
    const a = pts[i];
    const b = pts[i + 1];

    // 표면 법선: 평활화된 지형 기울기를 반영한 바깥 방향
    const nAngle = (a.n + b.n) / 2;
    const nx = Math.cos(nAngle);
    const ny = Math.sin(nAngle);
    // 램버트 + 주변광. light = 1 이 "원래 색" 이 되도록 맞춘다.
    const lambert = clamp01(nx * sunX + ny * sunY);
    const light = 0.46 + lambert * 0.62;
    const tone = (light - 1) * 0.55;

    // 조각은 한 칸 더 넓게(i → i+2) 그려 이웃과 통째로 겹치게 한다.
    // 안티에일리어싱 가장자리가 다음 조각 안쪽에 묻혀 세로 줄무늬가 사라진다.
    const c = pts[Math.min(segments, i + 2)];
    camera.worldToScreen(
      worldPos.x + Math.cos(a.theta) * a.r,
      worldPos.y + Math.sin(a.theta) * a.r,
      sp
    );
    camera.worldToScreen(
      worldPos.x + Math.cos(b.theta) * b.r,
      worldPos.y + Math.sin(b.theta) * b.r,
      sp2
    );
    camera.worldToScreen(
      worldPos.x + Math.cos(a.theta) * closeR,
      worldPos.y + Math.sin(a.theta) * closeR,
      ip
    );
    camera.worldToScreen(
      worldPos.x + Math.cos(c.theta) * closeR,
      worldPos.y + Math.sin(c.theta) * closeR,
      ip2
    );
    camera.worldToScreen(
      worldPos.x + Math.cos(c.theta) * c.r,
      worldPos.y + Math.sin(c.theta) * c.r,
      sp3
    );

    // 화면 밖이면 건너뛴다
    if (
      (sp.x < -6 && sp3.x < -6) ||
      (sp.x > camera.width + 6 && sp3.x > camera.width + 6)
    ) {
      continue;
    }

    ctx.beginPath();
    ctx.moveTo(sp.x, sp.y);
    ctx.lineTo(sp2.x, sp2.y);
    ctx.lineTo(sp3.x, sp3.y);
    ctx.lineTo(ip2.x, ip2.y);
    ctx.lineTo(ip.x, ip.y);
    ctx.closePath();

    // 표면은 밝고 깊이 들어갈수록 어둡다 (지하 AO)
    const surf = shade(a.color, tone);
    const vg = ctx.createLinearGradient(sp.x, sp.y, ip.x, ip.y);
    vg.addColorStop(0, surf);
    vg.addColorStop(0.05, shade(a.color, tone - 0.06));
    vg.addColorStop(0.3, shade(a.color, -0.45));
    vg.addColorStop(1, shade(a.color, -0.72));
    ctx.fillStyle = vg;
    ctx.fill();
  }

  /* 2. 표층 — 지표에 얇은 밝은 띠 (풍화층) */
  const crustW = Math.max(1.2, Math.min(camera.zoom * 0.45, 6));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = crustW;
  const crustStep = Math.max(1, Math.floor(segments / 160));
  for (let i = 0; i < segments - crustStep; i += crustStep) {
    const a = pts[i];
    const b = pts[i + crustStep];
    camera.worldToScreen(
      worldPos.x + Math.cos(a.theta) * a.r,
      worldPos.y + Math.sin(a.theta) * a.r,
      sp
    );
    camera.worldToScreen(
      worldPos.x + Math.cos(b.theta) * b.r,
      worldPos.y + Math.sin(b.theta) * b.r,
      sp2
    );
    if (
      (sp.x < -20 && sp2.x < -20) ||
      (sp.x > camera.width + 20 && sp2.x > camera.width + 20)
    ) {
      continue;
    }
    const nAngle = (a.n + b.n) / 2;
    const lambert = clamp01(Math.cos(nAngle) * sunX + Math.sin(nAngle) * sunY);
    ctx.strokeStyle = shade(a.color, -0.16 + lambert * 0.2);
    ctx.beginPath();
    ctx.moveTo(sp.x, sp.y);
    ctx.lineTo(sp2.x, sp2.y);
    ctx.stroke();
  }

  /* 2b. 지표 얼룩 — 흙/식생 반점. 회전과 무관한 해시라 화면에서 헤엄치지 않는다 */
  if (!opts.lowDetail && camera.zoom > 0.02) {
    ctx.save();
    const patchStride = Math.max(1, Math.floor(segments / 110));
    const patchSpacing = ((camera.width * 2.8) / segments) * patchStride;
    for (let i = 0; i < segments; i += patchStride) {
      const p = pts[i];
      if (p.ocean) continue;
      const key = Math.round((p.theta - rotation) * 2e5);
      const hv = hash01(key * 3 + 11);
      if (hv > 0.62) continue;
      camera.worldToScreen(
        worldPos.x + Math.cos(p.theta) * p.r,
        worldPos.y + Math.sin(p.theta) * p.r,
        sp
      );
      if (sp.x < -60 || sp.x > camera.width + 60) continue;
      // 샘플 간격에 비례한 크기 — 어느 고도에서도 얼룩 밀도가 일정하다
      const px = patchSpacing * lerp(0.5, 1.5, hash01(key * 7 + 3));
      if (px < 2 || px > camera.height) continue;
      const lambert = clamp01(Math.cos(p.n) * sunX + Math.sin(p.n) * sunY);
      const dark = hash01(key * 13 + 5) < 0.5;
      ctx.fillStyle = withAlpha(
        shade(p.color, (dark ? -0.22 : 0.14) + (lambert - 0.6) * 0.2),
        0.26
      );
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(-(p.theta - Math.PI / 2) + camera.rotation);
      ctx.beginPath();
      ctx.ellipse(0, px * 0.28, px * 0.9, px * 0.3, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  /* 3. 바위/자갈 — 가까울 때만 */
  if (camera.zoom > 1.2 && !opts.lowDetail) {
    drawRocks(ctx, camera, body, worldPos, pts, rotation, sunX, sunY, camera.zoom);
  }

  /* 4. 바다 */
  if (oceanR !== null && altitude < body.atmo.height * 1.5) {
    drawOcean(ctx, camera, body, worldPos, camTheta, span, segments, closeR, time, sunX, sunY);
  }

  /* 5. 거리 헤이즈 — 대기가 있으면 멀리 있는 지형이 하늘색으로 흐려진다 */
  if (body.atmo.exists && opts.skyColor) {
    const hz = clamp01(opts.hazeStrength ?? 0);
    if (hz > 0.01) {
      const g = ctx.createLinearGradient(0, camera.height * 0.35, 0, camera.height);
      g.addColorStop(0, withAlpha(opts.skyColor, 0.55 * hz));
      g.addColorStop(0.35, withAlpha(opts.skyColor, 0.22 * hz));
      g.addColorStop(1, withAlpha(opts.skyColor, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, camera.width, camera.height);
    }
  }

  return { camTheta, span, altitude };
}

/** 표면 바위 — 결정론적 배치라 매 프레임 흔들리지 않는다 */
function drawRocks(ctx, camera, body, worldPos, pts, rotation, sunX, sunY, zoom) {
  const sp = { x: 0, y: 0 };
  const count = pts.length;
  const stride = Math.max(1, Math.floor(count / 90));
  for (let i = 0; i < count; i += stride) {
    const p = pts[i];
    if (p.ocean) continue;
    // 위치 해시로 바위 유무 결정
    const key = Math.round((p.theta - rotation) * 1e6);
    const h = hash01(key);
    if (h > 0.42) continue;
    const size = lerp(0.25, 1.8, hash01(key * 7)) ;
    const px = size * zoom;
    if (px < 1.2 || px > camera.height * 0.4) continue;

    camera.worldToScreen(
      worldPos.x + Math.cos(p.theta) * p.r,
      worldPos.y + Math.sin(p.theta) * p.r,
      sp
    );
    if (sp.x < -40 || sp.x > camera.width + 40) continue;

    const rockAngle = p.theta;
    const lambert = clamp01(Math.cos(rockAngle) * sunX + Math.sin(rockAngle) * sunY);
    const base = shade(p.color, -0.12 + lambert * 0.3);

    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(-(p.theta - Math.PI / 2) + camera.rotation);
    // 그림자
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(px * 0.3, px * 0.1, px * 0.9, px * 0.22, 0, 0, TAU);
    ctx.fill();
    // 바위 본체
    ctx.beginPath();
    ctx.moveTo(-px * 0.55, 0);
    ctx.lineTo(-px * 0.3, -px * 0.55);
    ctx.lineTo(px * 0.15, -px * 0.7);
    ctx.lineTo(px * 0.55, -px * 0.2);
    ctx.lineTo(px * 0.45, 0);
    ctx.closePath();
    const g = ctx.createLinearGradient(-px * 0.5, -px * 0.6, px * 0.5, 0);
    g.addColorStop(0, shade(base, 0.22));
    g.addColorStop(0.6, base);
    g.addColorStop(1, shade(base, -0.32));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }
}

/** 바다 — 파도 + 태양 반짝임 */
function drawOcean(ctx, camera, body, worldPos, camTheta, span, segments, closeR, time, sunX, sunY) {
  const oceanR = body.terrain.oceanRadius;
  const step = (span * 2) / segments;
  const sp = { x: 0, y: 0 };

  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const theta = camTheta - span + step * i;
    const wave =
      Math.sin(theta * 90000 + time * 0.8) * 1.6 +
      Math.sin(theta * 230000 + time * 1.7) * 0.9 +
      Math.sin(theta * 410000 - time * 2.3) * 0.4;
    camera.worldToScreen(
      worldPos.x + Math.cos(theta) * (oceanR + wave),
      worldPos.y + Math.sin(theta) * (oceanR + wave),
      sp
    );
    if (i === 0) ctx.moveTo(sp.x, sp.y);
    else ctx.lineTo(sp.x, sp.y);
  }
  for (let i = segments; i >= 0; i -= Math.max(1, Math.floor(segments / 8))) {
    const theta = camTheta - span + step * i;
    camera.worldToScreen(
      worldPos.x + Math.cos(theta) * closeR,
      worldPos.y + Math.sin(theta) * closeR,
      sp
    );
    ctx.lineTo(sp.x, sp.y);
  }
  ctx.closePath();

  const og = ctx.createLinearGradient(0, camera.height * 0.35, 0, camera.height);
  og.addColorStop(0, withAlpha(shade(body.ocean.color, 0.18), 0.9));
  og.addColorStop(0.3, withAlpha(body.ocean.color, 0.96));
  og.addColorStop(1, withAlpha(body.ocean.deepColor ?? body.ocean.color, 1));
  ctx.fillStyle = og;
  ctx.fill();

  // 햇빛 반짝임
  ctx.save();
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  const glintX = camera.width / 2 - sunX * camera.width * 0.3;
  const g = ctx.createRadialGradient(
    glintX,
    camera.height * 0.55,
    0,
    glintX,
    camera.height * 0.55,
    camera.width * 0.35
  );
  g.addColorStop(0, 'rgba(255,248,220,0.3)');
  g.addColorStop(0.4, 'rgba(200,230,255,0.08)');
  g.addColorStop(1, 'rgba(200,230,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, camera.width, camera.height);
  ctx.restore();
}

/* ──────────────────────────────────────────────────────────────
 * 지표 구조물
 * ────────────────────────────────────────────────────────────── */

export function drawSurfaceProps(ctx, camera, body, worldPos, props, time, sunAngle = 0) {
  const rotation = body.rotationAt(time);
  const sp = { x: 0, y: 0 };
  for (const prop of props) {
    const theta = prop.angle + rotation;
    const baseR = body.terrain.radiusAt(prop.angle);
    camera.worldToScreen(
      worldPos.x + Math.cos(theta) * baseR,
      worldPos.y + Math.sin(theta) * baseR,
      sp
    );
    const h = prop.height * camera.zoom;
    if (h < 1) continue;
    if (
      sp.x < -300 ||
      sp.x > camera.width + 300 ||
      sp.y < -600 ||
      sp.y > camera.height + 300
    ) {
      continue;
    }

    const lambert = clamp01(Math.cos(theta) * Math.cos(sunAngle) + Math.sin(theta) * Math.sin(sunAngle));
    // lambert = 1 이 원래 색이 되도록 (구조물이 하얗게 뜨지 않게)
    const lit = (0.42 + lambert * 0.66 - 1) * 0.72;

    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(-(theta - Math.PI / 2) + camera.rotation);

    // 그림자
    const shadowLen = h * 1.4;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(shadowLen * 0.25, 0, shadowLen * 0.6, h * 0.08, 0, 0, TAU);
    ctx.fill();

    switch (prop.type) {
      case 'pad': {
        const w = Math.max((prop.width ?? 30) * camera.zoom, 6);
        ctx.fillStyle = shade('#3d434a', lit - 0.04);
        ctx.fillRect(-w / 2, -h * 0.35, w, h * 0.35);
        ctx.fillStyle = shade('#585f67', lit);
        ctx.fillRect(-w * 0.22, -h, w * 0.44, h);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fillRect(-w * 0.22, -h, w * 0.44, Math.max(h * 0.1, 1));
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(-w * 0.22, -h * 0.1, w * 0.44, h * 0.1);
        break;
      }
      case 'tower': {
        const half = h * 0.045;
        ctx.strokeStyle = shade('#8b939b', lit - 0.04);
        ctx.lineWidth = Math.max(1, h * 0.014);
        ctx.beginPath();
        ctx.moveTo(-half, 0);
        ctx.lineTo(-half, -h);
        ctx.moveTo(half, 0);
        ctx.lineTo(half, -h);
        ctx.stroke();
        ctx.lineWidth = Math.max(0.5, h * 0.008);
        ctx.beginPath();
        for (let i = 0; i < 12; i++) {
          const y0 = -(h * i) / 12;
          const y1 = -(h * (i + 1)) / 12;
          ctx.moveTo(-half, y0);
          ctx.lineTo(half, y1);
          ctx.moveTo(-half, y1);
          ctx.lineTo(half, y1);
        }
        ctx.stroke();
        ctx.fillStyle = '#ff4a3a';
        const ls = Math.max(2, h * 0.022);
        ctx.fillRect(-ls / 2, -h - ls, ls, ls);
        break;
      }
      case 'tank': {
        const r = h * 0.3;
        const cy = -h * 0.62;
        // 지지 스커트
        ctx.fillStyle = shade('#4b5259', lit - 0.06);
        ctx.beginPath();
        ctx.moveTo(-r * 0.72, 0);
        ctx.lineTo(-r * 0.5, cy);
        ctx.lineTo(r * 0.5, cy);
        ctx.lineTo(r * 0.72, 0);
        ctx.closePath();
        ctx.fill();
        // 구형 탱크
        const g = ctx.createRadialGradient(-r * 0.45, cy - r * 0.45, r * 0.05, 0, cy, r * 1.15);
        g.addColorStop(0, shade('#c6ced6', lit + 0.02));
        g.addColorStop(0.42, shade('#9aa3ac', lit - 0.02));
        g.addColorStop(0.82, shade('#6c747c', lit - 0.1));
        g.addColorStop(1, shade('#464d54', lit - 0.16));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, cy, r, 0, TAU);
        ctx.fill();
        // 단열 패널 이음매
        ctx.strokeStyle = 'rgba(30,36,42,0.35)';
        ctx.lineWidth = Math.max(0.5, r * 0.035);
        for (let k = -1; k <= 1; k++) {
          const yy = cy + r * k * 0.5;
          const hw = Math.sqrt(Math.max(r * r - (yy - cy) * (yy - cy), 0));
          ctx.beginPath();
          ctx.moveTo(-hw, yy);
          ctx.lineTo(hw, yy);
          ctx.stroke();
        }
        // 반사 하이라이트
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        ctx.beginPath();
        ctx.ellipse(-r * 0.4, cy - r * 0.42, r * 0.3, r * 0.16, -0.5, 0, TAU);
        ctx.fill();
        break;
      }
      case 'building': {
        const w = Math.max((prop.width ?? 20) * camera.zoom, 4);
        const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
        g.addColorStop(0, shade('#6b7279', lit - 0.14));
        g.addColorStop(0.45, shade('#7d848c', lit));
        g.addColorStop(1, shade('#525960', lit - 0.14));
        ctx.fillStyle = g;
        ctx.fillRect(-w / 2, -h, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(-w / 2, -h, w, Math.max(1, h * 0.05));
        ctx.fillStyle = withAlpha('#ffd97a', 0.5);
        const rows = Math.max(2, Math.floor(h / 7));
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < 3; j++) {
            if (hash01(i * 13 + j * 7) < 0.35) continue;
            ctx.fillRect(
              -w / 2 + (w * (j + 0.5)) / 3 - 1,
              -h + (h * (i + 0.3)) / rows,
              2,
              2
            );
          }
        }
        break;
      }
      case 'dish': {
        ctx.strokeStyle = shade('#949ca4', lit - 0.07);
        ctx.lineWidth = Math.max(1, h * 0.05);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -h * 0.6);
        ctx.stroke();
        const g = ctx.createRadialGradient(0, -h * 0.75, 0, 0, -h * 0.7, h * 0.32);
        g.addColorStop(0, shade('#dfe5ea', lit + 0.04));
        g.addColorStop(1, shade('#949ca4', lit - 0.11));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, -h * 0.7, h * 0.32, h * 0.22, 0.4, 0, TAU);
        ctx.fill();
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }
}

/** 착륙 깃발 */
export function drawFlags(ctx, camera, body, worldPos, flags, time) {
  const rotation = body.rotationAt(time);
  const sp = { x: 0, y: 0 };
  for (const flag of flags) {
    const theta = flag.angle + rotation;
    const r = body.terrain.radiusAt(flag.angle);
    camera.worldToScreen(
      worldPos.x + Math.cos(theta) * r,
      worldPos.y + Math.sin(theta) * r,
      sp
    );
    const h = 3 * camera.zoom;
    if (h < 2 || sp.x < -50 || sp.x > camera.width + 50) continue;

    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(-(theta - Math.PI / 2) + camera.rotation);
    ctx.strokeStyle = '#d8dee4';
    ctx.lineWidth = Math.max(1, h * 0.05);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -h);
    ctx.stroke();
    const fw = h * 0.55;
    const wave = Math.sin(time * 2) * fw * 0.06;
    const g = ctx.createLinearGradient(0, -h, fw, -h + fw * 0.6);
    g.addColorStop(0, '#e05a45');
    g.addColorStop(0.5, '#c03a2c');
    g.addColorStop(1, '#8f271c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(fw, -h + wave);
    ctx.lineTo(fw, -h + fw * 0.6 + wave);
    ctx.lineTo(0, -h + fw * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/* ──────────────────────────────────────────────────────────────
 * 궤도선
 * ────────────────────────────────────────────────────────────── */

export function drawOrbitPath(ctx, camera, orbit, centerWorld, opts = {}) {
  if (!orbit) return;
  const samples = opts.samples ?? 200;
  const pts = orbit.sample(samples, { maxRadius: opts.maxRadius });
  if (!pts.length) return;

  ctx.save();
  ctx.strokeStyle = opts.color ?? '#6fd8ff';
  ctx.lineWidth = opts.width ?? 1.4;
  if (opts.dash) ctx.setLineDash(opts.dash);
  ctx.globalAlpha = opts.alpha ?? 0.85;
  if (opts.glow) {
    ctx.shadowColor = opts.color ?? '#6fd8ff';
    ctx.shadowBlur = 6;
  }

  ctx.beginPath();
  const sp = { x: 0, y: 0 };
  let started = false;
  for (const p of pts) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      started = false;
      continue;
    }
    camera.worldToScreen(centerWorld.x + p.x, centerWorld.y + p.y, sp);
    if (!started) {
      ctx.moveTo(sp.x, sp.y);
      started = true;
    } else {
      ctx.lineTo(sp.x, sp.y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

export function drawSOI(ctx, camera, body, worldPos) {
  if (!Number.isFinite(body.soi)) return;
  const sp = camera.worldToScreen(worldPos.x, worldPos.y);
  const r = body.soi * camera.zoom;
  if (r < 8 || r > 20000) return;
  ctx.save();
  ctx.strokeStyle = withAlpha('#8fa8c8', 0.24);
  ctx.setLineDash([6, 8]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r, 0, TAU);
  ctx.stroke();
  ctx.restore();
}
