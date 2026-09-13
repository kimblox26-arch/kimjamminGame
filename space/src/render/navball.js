// ORBITER — 자세 표시기 (2D 내비볼)
// 3D 게임의 내비볼을 2D 로 옮긴 형태: 지평선 원판 + 진행/역행/천정 마커.

import {
  TAU,
  clamp,
  clamp01,
  wrapPi,
  withAlpha,
  Vec2,
  vLen,
  vNorm,
} from '../core/math.js';

const MARKERS = {
  prograde: { color: '#ffd24a', symbol: 'prograde' },
  retrograde: { color: '#ffd24a', symbol: 'retrograde' },
  radialOut: { color: '#63b8ff', symbol: 'radial' },
  radialIn: { color: '#63b8ff', symbol: 'radialIn' },
  target: { color: '#c48cff', symbol: 'target' },
  maneuver: { color: '#5ae0b8', symbol: 'maneuver' },
};

/**
 * 내비볼을 그린다.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx 중심 x (화면 좌표)
 * @param {number} cy 중심 y
 * @param {number} radius
 * @param {Vessel} vessel
 * @param {object} opts { maneuverNode, target, surfaceMode }
 */
export function drawNavball(ctx, cx, cy, radius, vessel, opts = {}) {
  if (!vessel || !vessel.body) return;

  const up = vNorm(vessel.pos);
  const upAngle = Math.atan2(up.y, up.x);
  // 기체 기준으로 회전시켜 "위쪽이 항상 기체 전방"
  const shipAngle = vessel.angle;
  // 화면 각도: 천정 방향이 위로 오도록
  const rel = wrapPi(upAngle - shipAngle);

  ctx.save();
  ctx.translate(cx, cy);

  // 배경 원
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.fillStyle = '#0b1017';
  ctx.fill();

  // 2D 내비볼: 기수는 항상 화면 위를 향하므로 롤이 없다.
  // 대신 지평선을 피치만큼 위아래로 옮겨 자세를 표현한다.
  // pitch = +90° → 천정을 향함(하늘로 가득), 0° → 수평, -90° → 천저.
  const pitch = Math.PI / 2 - Math.abs(rel);
  const horizonY = (pitch / (Math.PI / 2)) * radius * 0.9;

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.94, 0, TAU);
  ctx.clip();

  const skyGrad = ctx.createLinearGradient(0, -radius, 0, horizonY);
  skyGrad.addColorStop(0, '#2a6aa8');
  skyGrad.addColorStop(1, '#5aa0d8');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(-radius, -radius, radius * 2, radius + horizonY);

  const groundGrad = ctx.createLinearGradient(0, horizonY, 0, radius);
  groundGrad.addColorStop(0, '#9a6a3a');
  groundGrad.addColorStop(1, '#5c3d1e');
  ctx.fillStyle = groundGrad;
  ctx.fillRect(-radius, horizonY, radius * 2, radius - horizonY);

  // 지평선
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-radius, horizonY);
  ctx.lineTo(radius, horizonY);
  ctx.stroke();

  // 피치 눈금
  ctx.strokeStyle = withAlpha('#ffffff', 0.5);
  ctx.lineWidth = 1;
  ctx.font = `${Math.round(radius * 0.11)}px ui-monospace, monospace`;
  ctx.fillStyle = withAlpha('#ffffff', 0.75);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let deg = -60; deg <= 60; deg += 30) {
    if (deg === 0) continue;
    const y = horizonY - (deg / 90) * radius * 0.9;
    if (Math.abs(y) > radius * 0.9) continue;
    const wdt = radius * 0.22;
    ctx.beginPath();
    ctx.moveTo(-wdt, y);
    ctx.lineTo(wdt, y);
    ctx.stroke();
    ctx.fillText(String(Math.abs(deg)), 0, y - radius * 0.08);
  }
  ctx.restore();

  // 테두리
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.94, 0, TAU);
  ctx.strokeStyle = '#2d3742';
  ctx.lineWidth = Math.max(2, radius * 0.06);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.strokeStyle = '#6d7a88';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 마커들
  const markers = [];
  const orbitalVel = vessel.vel;
  const surfaceVel = vessel.surfaceVelocity();
  const vel = opts.surfaceMode ? surfaceVel : orbitalVel;

  if (vLen(vel) > 0.5) {
    const va = Math.atan2(vel.y, vel.x);
    markers.push({ angle: wrapPi(va - shipAngle), type: 'prograde' });
    markers.push({
      angle: wrapPi(va + Math.PI - shipAngle),
      type: 'retrograde',
    });
  }
  markers.push({ angle: rel, type: 'radialOut' });
  markers.push({ angle: wrapPi(rel + Math.PI), type: 'radialIn' });

  if (opts.target) {
    const d = new Vec2(
      opts.target.pos.x - vessel.pos.x,
      opts.target.pos.y - vessel.pos.y
    );
    markers.push({
      angle: wrapPi(Math.atan2(d.y, d.x) - shipAngle),
      type: 'target',
    });
  }
  if (opts.maneuverNode) {
    const dir = opts.maneuverNode.worldDirection(vessel);
    markers.push({
      angle: wrapPi(Math.atan2(dir.y, dir.x) - shipAngle),
      type: 'maneuver',
    });
  }

  for (const m of markers) {
    // 마커는 원 위에 배치 (2D 이므로 방위각만 표현)
    const a = m.angle;
    const mr = radius * 0.74;
    const mx = Math.sin(a) * mr;
    const my = -Math.cos(a) * mr;
    drawMarker(ctx, mx, my, radius * 0.12, m.type);
  }

  // 기체 기준선 (항상 위쪽)
  ctx.strokeStyle = '#ffd24a';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-radius * 0.3, 0);
  ctx.lineTo(-radius * 0.12, 0);
  ctx.moveTo(radius * 0.12, 0);
  ctx.lineTo(radius * 0.3, 0);
  ctx.moveTo(0, -radius * 0.1);
  ctx.lineTo(0, -radius * 0.02);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.035, 0, TAU);
  ctx.fillStyle = '#ffd24a';
  ctx.fill();

  ctx.restore();
}

function drawMarker(ctx, x, y, size, type) {
  const cfg = MARKERS[type] ?? MARKERS.prograde;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = cfg.color;
  ctx.fillStyle = cfg.color;
  ctx.lineWidth = Math.max(1.2, size * 0.16);

  switch (cfg.symbol) {
    case 'prograde':
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.45, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.14, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-size, 0);
      ctx.lineTo(-size * 0.45, 0);
      ctx.moveTo(size * 0.45, 0);
      ctx.lineTo(size, 0);
      ctx.moveTo(0, -size);
      ctx.lineTo(0, -size * 0.45);
      ctx.stroke();
      break;
    case 'retrograde':
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.45, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-size * 0.3, -size * 0.3);
      ctx.lineTo(size * 0.3, size * 0.3);
      ctx.moveTo(size * 0.3, -size * 0.3);
      ctx.lineTo(-size * 0.3, size * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-size, 0);
      ctx.lineTo(-size * 0.45, 0);
      ctx.moveTo(size * 0.45, 0);
      ctx.lineTo(size, 0);
      ctx.moveTo(0, -size);
      ctx.lineTo(0, -size * 0.45);
      ctx.stroke();
      break;
    case 'radial':
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.3, 0, TAU);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * size * 0.4, Math.sin(a) * size * 0.4);
        ctx.lineTo(Math.cos(a) * size * 0.9, Math.sin(a) * size * 0.9);
        ctx.stroke();
      }
      break;
    case 'radialIn':
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.3, 0, TAU);
      ctx.stroke();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * size * 0.45, Math.sin(a) * size * 0.45);
        ctx.lineTo(Math.cos(a) * size * 0.85, Math.sin(a) * size * 0.85);
        ctx.stroke();
      }
      break;
    case 'target':
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.4, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(0, size);
      ctx.moveTo(-size, 0);
      ctx.lineTo(size, 0);
      ctx.stroke();
      break;
    case 'maneuver':
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.34, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * TAU - Math.PI / 2;
        ctx.moveTo(Math.cos(a) * size * 0.42, Math.sin(a) * size * 0.42);
        ctx.lineTo(Math.cos(a) * size * 0.95, Math.sin(a) * size * 0.95);
      }
      ctx.stroke();
      break;
    default:
      break;
  }
  ctx.restore();
}

/**
 * 수평 방위 테이프 — 화면 상단에 진행 방향 각도를 표시.
 */
export function drawHeadingTape(ctx, x, y, width, vessel) {
  if (!vessel) return;
  const up = vNorm(vessel.pos);
  const upAngle = Math.atan2(up.y, up.x);
  // 천정(0°) 기준으로 기수가 얼마나 기울었는가
  const heading = wrapPi(vessel.angle - upAngle) * (180 / Math.PI);
  ctx.save();
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(160,190,215,0.8)';
  ctx.textAlign = 'center';
  ctx.fillText('천정 기준 기수각', x, y - 28);
  ctx.restore();

  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(8,12,18,0.55)';
  ctx.fillRect(-width / 2, -14, width, 28);
  ctx.strokeStyle = 'rgba(140,170,200,0.3)';
  ctx.lineWidth = 1;
  ctx.strokeRect(-width / 2, -14, width, 28);

  ctx.save();
  ctx.beginPath();
  ctx.rect(-width / 2, -14, width, 28);
  ctx.clip();

  const pxPerDeg = width / 90;
  ctx.font = '11px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let d = -180; d <= 180; d += 10) {
    const dx = (d - heading) * pxPerDeg;
    if (dx < -width / 2 - 20 || dx > width / 2 + 20) continue;
    const major = d % 30 === 0;
    ctx.strokeStyle = withAlpha('#a8c0d8', major ? 0.8 : 0.4);
    ctx.beginPath();
    ctx.moveTo(dx, major ? -10 : -5);
    ctx.lineTo(dx, major ? 2 : 0);
    ctx.stroke();
    if (major) {
      ctx.fillStyle = withAlpha('#cfe0f0', 0.85);
      ctx.fillText(`${d}`, dx, 8);
    }
  }
  ctx.restore();

  // 중앙 지시침
  ctx.fillStyle = '#ffd24a';
  ctx.beginPath();
  ctx.moveTo(0, -16);
  ctx.lineTo(-5, -22);
  ctx.lineTo(5, -22);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
