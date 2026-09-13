// ORBITER — 천체 렌더링
// 두 가지 모드가 있다.
//   1) 근접(surface): 지형 프로파일을 폴리라인으로 그려 실제 지면을 보여준다.
//   2) 원거리(disc):  원반 + 음영 + 대기 글로우 + 고리로 그린다.

import {
  TAU,
  clamp,
  clamp01,
  lerp,
  wrapTau,
  withAlpha,
  mixHex,
  shade,
  Vec2,
} from '../core/math.js';

/**
 * 천체를 원반으로 그린다 (궤도/지도 시점).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Camera} camera
 * @param {CelestialBody} body
 * @param {Vec2} worldPos 천체 중심의 월드 좌표
 * @param {object} opts { sunDir, showAtmosphere, detail, time }
 */
export function drawBodyDisc(ctx, camera, body, worldPos, opts = {}) {
  const sp = camera.worldToScreen(worldPos.x, worldPos.y);
  const r = body.radius * camera.zoom;
  if (r < 0.4) {
    // 점으로 표시
    ctx.fillStyle = body.palette.map ?? body.palette.surface;
    ctx.fillRect(sp.x - 1, sp.y - 1, 2.5, 2.5);
    return;
  }

  const sunDir = opts.sunDir ?? { x: -1, y: 0 };
  const time = opts.time ?? 0;
  const rotation = body.rotationAt(time);

  ctx.save();

  // 대기 글로우
  if (body.atmo.exists && (opts.showAtmosphere ?? true)) {
    const ar = (body.radius + body.atmo.height) * camera.zoom;
    const g = ctx.createRadialGradient(sp.x, sp.y, r * 0.98, sp.x, sp.y, ar);
    g.addColorStop(0, withAlpha(body.palette.atmoGlow ?? '#7ec3f0', 0.5));
    g.addColorStop(0.55, withAlpha(body.palette.atmoGlow ?? '#7ec3f0', 0.18));
    g.addColorStop(1, withAlpha(body.palette.atmoGlow ?? '#7ec3f0', 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, ar, 0, TAU);
    ctx.fill();
  }

  // 고리 (뒤쪽 절반)
  if (body.rings) drawRings(ctx, camera, body, sp, r, false);

  // 본체
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r, 0, TAU);
  if (body.type === 'star') {
    const g = ctx.createRadialGradient(sp.x, sp.y, r * 0.2, sp.x, sp.y, r);
    g.addColorStop(0, body.palette.highlight);
    g.addColorStop(0.7, body.palette.surface);
    g.addColorStop(1, body.palette.deep);
    ctx.fillStyle = g;
    ctx.fill();
    // 코로나
    const cg = ctx.createRadialGradient(sp.x, sp.y, r, sp.x, sp.y, r * 2.6);
    cg.addColorStop(0, withAlpha(body.palette.atmoGlow ?? '#ffd77a', 0.4));
    cg.addColorStop(1, withAlpha(body.palette.atmoGlow ?? '#ffd77a', 0));
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r * 2.6, 0, TAU);
    ctx.fill();
    ctx.restore();
    return;
  }

  const g = ctx.createRadialGradient(
    sp.x - sunDir.x * r * 0.45,
    sp.y + sunDir.y * r * 0.45,
    r * 0.05,
    sp.x,
    sp.y,
    r
  );
  g.addColorStop(0, body.palette.highlight);
  g.addColorStop(0.45, body.palette.surface);
  g.addColorStop(1, body.palette.deep);
  ctx.fillStyle = g;
  ctx.fill();

  // 표면 패턴
  if (r > 12) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, 0, TAU);
    ctx.clip();
    if (body.gasGiant) {
      drawGasBands(ctx, body, sp, r, rotation);
    } else {
      drawSurfaceTexture(ctx, body, sp, r, rotation);
    }
    ctx.restore();
  }

  // 명암 경계 (터미네이터)
  const tg = ctx.createLinearGradient(
    sp.x + sunDir.x * r,
    sp.y - sunDir.y * r,
    sp.x - sunDir.x * r,
    sp.y + sunDir.y * r
  );
  tg.addColorStop(0, 'rgba(0,0,0,0)');
  tg.addColorStop(0.45, 'rgba(0,0,0,0.05)');
  tg.addColorStop(0.62, 'rgba(0,0,0,0.55)');
  tg.addColorStop(1, 'rgba(0,0,0,0.88)');
  ctx.save();
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r, 0, TAU);
  ctx.clip();
  ctx.fillStyle = tg;
  ctx.fillRect(sp.x - r, sp.y - r, r * 2, r * 2);
  ctx.restore();

  // 대기 림 라이트
  if (body.atmo.exists) {
    ctx.strokeStyle = withAlpha(body.palette.atmoGlow ?? '#7ec3f0', 0.55);
    ctx.lineWidth = Math.max(1, r * 0.02);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, 0, TAU);
    ctx.stroke();
  }

  // 고리 (앞쪽 절반)
  if (body.rings) drawRings(ctx, camera, body, sp, r, true);

  ctx.restore();
}

/** 가스 행성 줄무늬 */
function drawGasBands(ctx, body, sp, r, rotation) {
  const pal = body.palette;
  const n = body.def.terrain?.bands ?? 8;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const y0 = sp.y - r + r * 2 * t;
    const h = (r * 2) / n;
    const c = i % 2 === 0 ? pal.band1 ?? pal.surface : pal.band2 ?? pal.deep;
    ctx.fillStyle = withAlpha(c, 0.55);
    // 위도에 따라 폭이 좁아지도록 타원 클리핑에 의존
    ctx.fillRect(sp.x - r, y0, r * 2, h * 0.85);
  }
  // 대적점
  if (pal.spot) {
    const a = rotation * 0.6;
    const sx = sp.x + Math.cos(a) * r * 0.4;
    const sy = sp.y + r * 0.22;
    ctx.save();
    ctx.globalAlpha = clamp01(Math.cos(a) * 0.5 + 0.5);
    ctx.fillStyle = withAlpha(pal.spot, 0.8);
    ctx.beginPath();
    ctx.ellipse(sx, sy, r * 0.2, r * 0.11, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

/** 암석 천체 표면 무늬 — 지형 고도를 극좌표로 샘플링 */
function drawSurfaceTexture(ctx, body, sp, r, rotation) {
  const terrain = body.terrain;
  const steps = clamp(Math.round(r * 0.6), 24, 220);

  // 고도에 따른 색 띠
  ctx.lineWidth = Math.max(1, r * 0.06);
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * TAU;
    const a1 = ((i + 1) / steps) * TAU;
    const theta = a0 - rotation;
    const color = terrain.colorAt(theta);
    ctx.strokeStyle = withAlpha(color, 0.55);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r * 0.965, a0, a1 + 0.01);
    ctx.stroke();
  }

  // 안쪽 대륙 얼룩
  const blobs = clamp(Math.round(r / 8), 3, 26);
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * TAU + rotation * 0.2;
    const theta = a - rotation;
    const elev = terrain.elevationAt(theta);
    const amp = Math.max(body.def.terrain?.amplitude ?? 1000, 1);
    const n = clamp(elev / amp, -1, 1);
    const rr = r * lerp(0.25, 0.8, (i * 0.37) % 1);
    const bx = sp.x + Math.cos(a) * rr;
    const by = sp.y + Math.sin(a) * rr;
    const size = r * lerp(0.08, 0.26, ((i * 0.61) % 1));
    ctx.fillStyle = withAlpha(
      n > 0 ? body.palette.highlight : body.palette.deep,
      0.14 + Math.abs(n) * 0.16
    );
    ctx.beginPath();
    ctx.ellipse(bx, by, size, size * 0.7, a, 0, TAU);
    ctx.fill();
  }

  // 극관
  if (body.def.terrain?.polarCaps) {
    ctx.fillStyle = withAlpha(body.palette.ice ?? '#ffffff', 0.6);
    ctx.beginPath();
    ctx.ellipse(sp.x, sp.y - r * 0.88, r * 0.45, r * 0.16, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(sp.x, sp.y + r * 0.88, r * 0.4, r * 0.14, 0, 0, TAU);
    ctx.fill();
  }
}

/** 고리 */
function drawRings(ctx, camera, body, sp, r, front) {
  const rings = body.rings;
  const inner = rings.inner * camera.zoom;
  const outer = rings.outer * camera.zoom;
  if (outer < 3) return;

  ctx.save();
  // 2D 이므로 고리는 위아래로 눌린 타원으로 그린다
  const squash = 0.22;
  ctx.translate(sp.x, sp.y);
  ctx.scale(1, squash);

  const steps = 26;
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const r0 = lerp(inner, outer, t0);
    const r1 = lerp(inner, outer, t1);
    // 카시니 간극
    let skip = false;
    for (const gap of rings.gaps ?? []) {
      const gr = gap.at * camera.zoom;
      const gw = gap.width * camera.zoom;
      if (r0 > gr - gw / 2 && r1 < gr + gw / 2) skip = true;
    }
    if (skip) continue;
    const alpha = 0.42 * (1 - Math.abs(t0 - 0.45)) + 0.08;
    ctx.strokeStyle = withAlpha(
      mixHex(rings.color, '#ffffff', (i % 3) * 0.12),
      alpha
    );
    ctx.lineWidth = Math.max(0.6, (r1 - r0));
    ctx.beginPath();
    if (front) ctx.arc(0, 0, (r0 + r1) / 2, 0, Math.PI);
    else ctx.arc(0, 0, (r0 + r1) / 2, Math.PI, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 근접 지형 렌더링 — 기체 아래 지면을 실제 프로파일로 그린다.
 * @param {object} opts { time, viewAngleSpan, detail, sunAngle }
 */
export function drawTerrain(ctx, camera, body, worldPos, opts = {}) {
  const time = opts.time ?? 0;
  const rotation = body.rotationAt(time);
  const camWorld = camera.pos;

  // 카메라가 천체 중심에서 보이는 각도
  const dx = camWorld.x - worldPos.x;
  const dy = camWorld.y - worldPos.y;
  const camTheta = Math.atan2(dy, dx);
  const camR = Math.hypot(dx, dy);
  const altitude = camR - body.radius;

  // 화면에 필요한 각도 범위
  const viewHalfWidth = camera.width / 2 / camera.zoom;
  const span = clamp(
    (viewHalfWidth / Math.max(camR, 1)) * 2.6,
    0.00002,
    Math.PI
  );

  const segments = clamp(Math.round(camera.width / 3), 64, 900);
  const step = (span * 2) / segments;

  const oceanR = body.terrain.oceanRadius;
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const theta = camTheta - span + step * i;
    const surfaceTheta = theta - rotation;
    let rr = body.terrain.radiusAt(surfaceTheta);
    const isOcean = oceanR !== null && rr < oceanR;
    pts.push({
      theta,
      r: rr,
      color: body.terrain.colorAt(surfaceTheta),
      ocean: isOcean,
    });
  }

  // 지면 폴리곤
  ctx.save();
  ctx.beginPath();
  const sp = { x: 0, y: 0 };
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const wx = worldPos.x + Math.cos(p.theta) * p.r;
    const wy = worldPos.y + Math.sin(p.theta) * p.r;
    camera.worldToScreen(wx, wy, sp);
    if (i === 0) ctx.moveTo(sp.x, sp.y);
    else ctx.lineTo(sp.x, sp.y);
  }
  // 안쪽으로 닫는다 (천체 중심 방향).
  // 천체 중심까지 내려가면 화면 밖 수백만 픽셀짜리 경로가 되어
  // 브라우저가 칠하지 못하는 경우가 있다. 화면을 덮을 만큼만 내려간다.
  const viewSpan = Math.hypot(camera.width, camera.height) / camera.zoom;
  const closeR = Math.max(body.radius * 0.02, camR - viewSpan * 1.5);
  for (let i = pts.length - 1; i >= 0; i -= Math.max(1, Math.floor(segments / 8))) {
    const p = pts[i];
    const wx = worldPos.x + Math.cos(p.theta) * closeR;
    const wy = worldPos.y + Math.sin(p.theta) * closeR;
    camera.worldToScreen(wx, wy, sp);
    ctx.lineTo(sp.x, sp.y);
  }
  ctx.closePath();

  const sunAngle = opts.sunAngle ?? 0;
  const light = clamp01(Math.cos(camTheta - sunAngle) * 0.5 + 0.7);
  const baseColor = body.palette.surface;
  const g = ctx.createLinearGradient(0, 0, 0, camera.height);
  g.addColorStop(0, shade(baseColor, -0.1 + light * 0.25));
  g.addColorStop(1, shade(body.palette.deep, -0.25));
  ctx.fillStyle = g;
  ctx.fill();

  // 표면 "껍질" — 지형선을 따라가는 얇은 밝은 선.
  // 두꺼운 선분으로 칠하면 줄무늬가 생기므로 얇게 한 번만 긋는다.
  ctx.lineWidth = clamp(camera.zoom * 0.6, 1.2, 4);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const crustStep = Math.max(1, Math.floor(segments / 120));
  for (let i = 0; i < pts.length - 1 - crustStep; i += crustStep) {
    const a = pts[i];
    const b = pts[i + crustStep];
    const s1 = camera.worldToScreen(
      worldPos.x + Math.cos(a.theta) * a.r,
      worldPos.y + Math.sin(a.theta) * a.r
    );
    const s2 = camera.worldToScreen(
      worldPos.x + Math.cos(b.theta) * b.r,
      worldPos.y + Math.sin(b.theta) * b.r
    );
    if (
      (s1.x < -50 && s2.x < -50) ||
      (s1.x > camera.width + 50 && s2.x > camera.width + 50)
    ) {
      continue;
    }
    ctx.strokeStyle = shade(a.color, 0.12 + (light - 0.7) * 0.25);
    ctx.beginPath();
    ctx.moveTo(s1.x, s1.y);
    ctx.lineTo(s2.x, s2.y);
    ctx.stroke();
  }

  // 바다
  if (oceanR !== null && altitude < body.atmo.height * 1.5) {
    ctx.beginPath();
    for (let i = 0; i <= segments; i++) {
      const theta = camTheta - span + step * i;
      const wave =
        Math.sin(theta * 90000 + time * 0.6) * 2 +
        Math.sin(theta * 230000 + time * 1.3) * 1.1;
      const wx = worldPos.x + Math.cos(theta) * (oceanR + wave);
      const wy = worldPos.y + Math.sin(theta) * (oceanR + wave);
      camera.worldToScreen(wx, wy, sp);
      if (i === 0) ctx.moveTo(sp.x, sp.y);
      else ctx.lineTo(sp.x, sp.y);
    }
    for (let i = segments; i >= 0; i -= Math.max(1, Math.floor(segments / 6))) {
      const theta = camTheta - span + step * i;
      const wx = worldPos.x + Math.cos(theta) * closeR;
      const wy = worldPos.y + Math.sin(theta) * closeR;
      camera.worldToScreen(wx, wy, sp);
      ctx.lineTo(sp.x, sp.y);
    }
    ctx.closePath();
    const og = ctx.createLinearGradient(0, 0, 0, camera.height);
    og.addColorStop(0, withAlpha(body.ocean.color, 0.88));
    og.addColorStop(1, withAlpha(body.ocean.deepColor ?? body.ocean.color, 0.98));
    ctx.fillStyle = og;
    ctx.fill();
  }

  ctx.restore();
  return { camTheta, span, altitude };
}

/**
 * 지표 구조물 (발사대, 관제탑) 그리기.
 */
export function drawSurfaceProps(ctx, camera, body, worldPos, props, time) {
  const rotation = body.rotationAt(time);
  const sp = { x: 0, y: 0 };
  for (const prop of props) {
    const theta = prop.angle + rotation;
    const baseR = body.terrain.radiusAt(prop.angle);
    const wx = worldPos.x + Math.cos(theta) * baseR;
    const wy = worldPos.y + Math.sin(theta) * baseR;
    camera.worldToScreen(wx, wy, sp);
    const h = prop.height * camera.zoom;
    if (h < 1) continue;
    if (
      sp.x < -200 ||
      sp.x > camera.width + 200 ||
      sp.y < -400 ||
      sp.y > camera.height + 200
    ) {
      continue;
    }

    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(-(theta - Math.PI / 2) + camera.rotation);

    switch (prop.type) {
      case 'pad': {
        const w = Math.max((prop.width ?? 30) * camera.zoom, 6);
        // 넓은 콘크리트 에이프런 + 그 위의 발사대
        ctx.fillStyle = '#3a3f45';
        ctx.fillRect(-w / 2, -h * 0.35, w, h * 0.35);
        ctx.fillStyle = '#565c63';
        ctx.fillRect(-w * 0.22, -h, w * 0.44, h);
        ctx.fillStyle = '#2f3338';
        ctx.fillRect(-w * 0.22, -h, w * 0.44, Math.max(h * 0.18, 1));
        break;
      }
      case 'tower': {
        const half = h * 0.045;
        ctx.strokeStyle = '#9aa2aa';
        ctx.lineWidth = Math.max(1, h * 0.014);
        ctx.beginPath();
        ctx.moveTo(-half, 0);
        ctx.lineTo(-half, -h);
        ctx.moveTo(half, 0);
        ctx.lineTo(half, -h);
        ctx.stroke();
        ctx.lineWidth = Math.max(0.5, h * 0.008);
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const y0 = -(h * i) / 10;
          const y1 = -(h * (i + 1)) / 10;
          ctx.moveTo(-half, y0);
          ctx.lineTo(half, y1);
          ctx.moveTo(-half, y1);
          ctx.lineTo(half, y1);
        }
        ctx.stroke();
        // 항공 장애등
        ctx.fillStyle = '#ff4a3a';
        ctx.fillRect(-Math.max(1, h * 0.012), -h - h * 0.02, Math.max(2, h * 0.024), Math.max(2, h * 0.02));
        break;
      }
      case 'tank': {
        const r = h * 0.42;
        ctx.fillStyle = '#c8ced5';
        ctx.beginPath();
        ctx.arc(0, -h * 0.55, r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = '#8d949c';
        ctx.lineWidth = Math.max(1, h * 0.02);
        ctx.stroke();
        // 지지 다리
        ctx.beginPath();
        ctx.moveTo(-r * 0.6, 0);
        ctx.lineTo(-r * 0.35, -h * 0.55);
        ctx.moveTo(r * 0.6, 0);
        ctx.lineTo(r * 0.35, -h * 0.55);
        ctx.stroke();
        break;
      }
      case 'building': {
        const w = Math.max((prop.width ?? 20) * camera.zoom, 4);
        ctx.fillStyle = '#6b7279';
        ctx.fillRect(-w / 2, -h, w, h);
        ctx.fillStyle = withAlpha('#ffd97a', 0.55);
        const rows = Math.max(2, Math.floor(h / 6));
        for (let i = 0; i < rows; i++) {
          for (let j = 0; j < 3; j++) {
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
        ctx.strokeStyle = '#aeb6be';
        ctx.lineWidth = Math.max(1, h * 0.05);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -h * 0.6);
        ctx.stroke();
        ctx.fillStyle = '#dfe4e9';
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

/**
 * 착륙 깃발.
 */
export function drawFlags(ctx, camera, body, worldPos, flags, time) {
  const rotation = body.rotationAt(time);
  const sp = { x: 0, y: 0 };
  for (const flag of flags) {
    const theta = flag.angle + rotation;
    const r = body.terrain.radiusAt(flag.angle);
    const wx = worldPos.x + Math.cos(theta) * r;
    const wy = worldPos.y + Math.sin(theta) * r;
    camera.worldToScreen(wx, wy, sp);
    const h = 3 * camera.zoom;
    if (h < 2 || sp.x < -50 || sp.x > camera.width + 50) continue;

    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(-(theta - Math.PI / 2) + camera.rotation);
    ctx.strokeStyle = '#d0d6dc';
    ctx.lineWidth = Math.max(1, h * 0.06);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -h);
    ctx.stroke();
    ctx.fillStyle = '#d94f3d';
    const fw = h * 0.55;
    const wave = Math.sin(time * 2) * fw * 0.08;
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

/**
 * 궤도 경로 그리기.
 */
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

/**
 * SOI 경계 원.
 */
export function drawSOI(ctx, camera, body, worldPos) {
  if (!Number.isFinite(body.soi)) return;
  const sp = camera.worldToScreen(worldPos.x, worldPos.y);
  const r = body.soi * camera.zoom;
  if (r < 8 || r > 20000) return;
  ctx.save();
  ctx.strokeStyle = withAlpha('#8fa8c8', 0.28);
  ctx.setLineDash([6, 8]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r, 0, TAU);
  ctx.stroke();
  ctx.restore();
}
