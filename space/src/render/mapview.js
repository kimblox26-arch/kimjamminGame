// ORBITER — 지도(궤도) 뷰
// 항성계 전체를 내려다보며 궤도, SOI, 기동 노드, 목표를 조작한다.

import {
  TAU,
  clamp,
  clamp01,
  lerp,
  withAlpha,
  formatDistance,
  formatTime,
  formatSpeed,
  Vec2,
  vLen,
} from '../core/math.js';
import { MapCamera } from './camera.js';
import { drawBodyDisc, drawOrbitPath, drawSOI } from './planetdraw.js';
import { stateToOrbit, closestApproach } from '../physics/orbit.js';

const FONT = 'ui-monospace, monospace';

export class MapView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = new MapCamera(canvas);
    this.active = false;
    this.focusBody = null;
    this.selectedBody = null;
    this.targetBody = null;
    this.showSOI = true;
    this.showLabels = true;
    this.showConics = true;
    this.hoverItem = null;
    this.dragNode = null;
    this.dragMode = null; // 'prograde' | 'radial' | 'time'
    this.nodeHandleRadius = 46;
    this._sp = { x: 0, y: 0 };
  }

  resize(w, h, dpr = 1) {
    this.camera.resize(w, h, dpr);
  }

  /** 지도 열기 — 현재 기체 SOI 를 중심으로 */
  open(vessel, system, time) {
    this.active = true;
    const body = vessel?.body ?? system.home;
    this.focusBody = body;
    const abs = body.absolutePositionAt(time);
    this.camera.focusOn(body, abs);
    this.camera.jumpTo(abs.x, abs.y);
  }

  close() {
    this.active = false;
    this.dragNode = null;
  }

  focusOn(body, time) {
    this.focusBody = body;
    const abs = body.absolutePositionAt(time);
    this.camera.focusOn(body, abs);
  }

  /* ── 입력 ─────────────────────────────────────────────── */

  handleInput(input, system, vessel, planner, time) {
    if (!this.active) return;
    // 툴바 버튼을 누른 입력은 지도 조작으로 쓰지 않는다
    if (input.mouse.overUI && input.mouse.left) return;
    const cam = this.camera;

    // 휠 줌
    if (input.mouse.wheel !== 0) {
      const factor = Math.pow(0.9, input.mouse.wheel / 100);
      cam.zoomAt(input.mouse.x, input.mouse.y, factor);
    }
    // 핀치 줌
    if (input.pinch.active && Math.abs(input.pinch.delta) > 0.5) {
      cam.zoomAt(
        input.mouse.x,
        input.mouse.y,
        1 + input.pinch.delta * 0.004
      );
    }

    // 드래그 패닝
    if (input.mouse.left && input.mouse.dragging && !this.dragNode) {
      cam.pos.x -= input.mouse.dx / cam.zoom;
      cam.pos.y += input.mouse.dy / cam.zoom;
      cam.targetPos.copy(cam.pos);
    }

    // 기동 노드 핸들 조작
    if (planner && vessel) {
      this.handleNodeDrag(input, planner, vessel, system, time);
    }

    // 클릭으로 천체 선택
    if (input.clicked && !this.dragNode) {
      const picked = this.pickBody(input.mouse.x, input.mouse.y, system, time);
      if (picked) {
        this.selectedBody = picked;
      }
    }
  }

  handleNodeDrag(input, planner, vessel, system, time) {
    const node = planner.next;
    if (!node) return;
    const bodyWorld = vessel.body.absolutePositionAt(time);
    const np = node.position();
    const sp = this.camera.worldToScreen(
      bodyWorld.x + np.x,
      bodyWorld.y + np.y,
      this._sp
    );

    if (input.mouse.leftPressed) {
      const d = Math.hypot(input.mouse.x - sp.x, input.mouse.y - sp.y);
      if (d < this.nodeHandleRadius) {
        this.dragNode = node;
        // 어느 핸들인가 — 위/아래(진행/역행), 좌/우(반경)
        const dx = input.mouse.x - sp.x;
        const dy = input.mouse.y - sp.y;
        this.dragMode = Math.abs(dx) > Math.abs(dy) ? 'radial' : 'prograde';
        if (d < 12) this.dragMode = 'time';
      }
    }

    if (this.dragNode && input.mouse.left) {
      const scale = 0.6;
      if (this.dragMode === 'prograde') {
        this.dragNode.addDeltaV(-input.mouse.dy * scale, 0);
      } else if (this.dragMode === 'radial') {
        this.dragNode.addDeltaV(0, input.mouse.dx * scale);
      } else if (this.dragMode === 'time') {
        const period = vessel.orbit?.period ?? 3600;
        this.dragNode.shiftTime(
          (input.mouse.dx / this.camera.width) * period * 0.5
        );
      }
    }

    if (!input.mouse.left) {
      this.dragNode = null;
      this.dragMode = null;
    }
  }

  pickBody(sx, sy, system, time) {
    let best = null;
    let bestD = 40;
    for (const body of system.list) {
      const p = body.absolutePositionAt(time);
      const sp = this.camera.worldToScreen(p.x, p.y, this._sp);
      const d = Math.hypot(sx - sp.x, sy - sp.y);
      const r = Math.max(body.radius * this.camera.zoom, 6);
      if (d < Math.max(r, 14) && d < bestD) {
        bestD = d;
        best = body;
      }
    }
    return best;
  }

  /* ── 렌더 ─────────────────────────────────────────────── */

  render(o) {
    if (!this.active) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const system = o.system;
    const vessel = o.vessel;
    const time = o.time;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#04060b';
    ctx.fillRect(0, 0, cam.width, cam.height);

    // 배경 격자
    this.drawGrid(ctx, cam);

    // 천체 궤도 경로
    for (const body of system.list) {
      if (!body.parent || !body.orbit) continue;
      const parentPos = body.parent.absolutePositionAt(time);
      const r = body.orbit.a * cam.zoom;
      if (r < 6 || r > 120000) continue;
      drawOrbitPath(ctx, cam, body.orbit, parentPos, {
        color: body.palette.map ?? '#8fa8c8',
        alpha: 0.28,
        samples: 120,
        width: 1,
      });
    }

    // SOI
    if (this.showSOI) {
      for (const body of system.list) {
        if (!body.parent) continue;
        const p = body.absolutePositionAt(time);
        drawSOI(ctx, cam, body, p);
      }
    }

    // 천체
    for (const body of system.list) {
      const p = body.absolutePositionAt(time);
      const screenR = body.radius * cam.zoom;
      if (
        !cam.isVisible(p.x, p.y, Math.max(body.radius * 2, 1e7)) &&
        body.type !== 'star'
      ) {
        continue;
      }
      if (screenR < 3) {
        const sp = cam.worldToScreen(p.x, p.y, this._sp);
        if (
          sp.x < -20 ||
          sp.y < -20 ||
          sp.x > cam.width + 20 ||
          sp.y > cam.height + 20
        )
          continue;
        ctx.fillStyle = body.palette.map ?? '#ffffff';
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, body.type === 'star' ? 5 : 3, 0, TAU);
        ctx.fill();
      } else {
        drawBodyDisc(ctx, cam, body, p, { time, showAtmosphere: screenR > 10 });
      }
    }

    // 기체 궤도
    if (vessel && vessel.orbit) {
      this.drawVesselOrbit(ctx, cam, vessel, system, time, o.planner);
    }

    // 다른 기체들
    if (o.otherVessels) {
      for (const other of o.otherVessels) {
        if (other === vessel) continue;
        this.drawVesselMarker(ctx, cam, other, time, '#c48cff');
      }
    }

    // 라벨
    if (this.showLabels) this.drawLabels(ctx, cam, system, time, vessel);

    // 정보 패널
    this.drawInfoPanel(ctx, cam, vessel, o);

    // 축척
    this.drawScaleBar(ctx, cam);
  }

  drawGrid(ctx, cam) {
    const spacing = Math.pow(10, Math.ceil(Math.log10(200 / cam.zoom)));
    const px = spacing * cam.zoom;
    if (px < 20 || px > 2000) return;
    ctx.strokeStyle = 'rgba(90,120,160,0.06)';
    ctx.lineWidth = 1;
    const originX = cam.width / 2 - (cam.pos.x % spacing) * cam.zoom;
    const originY = cam.height / 2 + (cam.pos.y % spacing) * cam.zoom;
    ctx.beginPath();
    for (let x = originX % px; x < cam.width; x += px) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, cam.height);
    }
    for (let y = originY % px; y < cam.height; y += px) {
      ctx.moveTo(0, y);
      ctx.lineTo(cam.width, y);
    }
    ctx.stroke();
  }

  drawVesselOrbit(ctx, cam, vessel, system, time, planner) {
    const bodyWorld = vessel.body.absolutePositionAt(time);

    // 현재 궤도
    drawOrbitPath(ctx, cam, vessel.orbit, bodyWorld, {
      color: '#6fd8ff',
      alpha: 0.9,
      samples: 220,
      width: 1.6,
      maxRadius: vessel.body.soi,
    });

    // Ap / Pe 마커
    this.drawApsis(ctx, cam, vessel, bodyWorld, time);

    // 기동 노드 결과 궤도
    const node = planner?.next;
    if (node && node.resultOrbit) {
      drawOrbitPath(ctx, cam, node.resultOrbit, bodyWorld, {
        color: '#5ae0b8',
        alpha: 0.75,
        samples: 200,
        width: 1.4,
        dash: [6, 5],
        maxRadius: vessel.body.soi,
      });
      this.drawNodeHandle(ctx, cam, node, bodyWorld);
    }

    // 기체 마커
    this.drawVesselMarker(ctx, cam, vessel, time, '#ffd24a');
  }

  drawApsis(ctx, cam, vessel, bodyWorld, time) {
    const orbit = vessel.orbit;
    if (!orbit) return;
    const R = vessel.body.radius;

    const marks = [];
    if (Number.isFinite(orbit.apoapsis)) {
      const p = orbit.positionAtTrue(Math.PI);
      marks.push({
        pos: p,
        color: '#5ae09a',
        label: `Ap ${formatDistance(orbit.apoapsis - R)}`,
        time: orbit.timeToTrueAnomaly(Math.PI, time),
      });
    }
    const pPe = orbit.positionAtTrue(0);
    marks.push({
      pos: pPe,
      color: '#ffb04a',
      label: `Pe ${formatDistance(orbit.periapsis - R)}`,
      time: orbit.timeToTrueAnomaly(0, time),
    });

    ctx.font = `11px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const m of marks) {
      const sp = cam.worldToScreen(
        bodyWorld.x + m.pos.x,
        bodyWorld.y + m.pos.y,
        this._sp
      );
      if (
        sp.x < -80 ||
        sp.y < -40 ||
        sp.x > cam.width + 80 ||
        sp.y > cam.height + 40
      )
        continue;
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = withAlpha(m.color, 0.9);
      ctx.fillText(m.label, sp.x + 9, sp.y);
      if (Number.isFinite(m.time) && m.time > 0) {
        ctx.fillStyle = withAlpha('#cfe0f0', 0.6);
        ctx.fillText(`T-${formatTime(m.time, true)}`, sp.x + 9, sp.y + 13);
      }
    }
  }

  drawNodeHandle(ctx, cam, node, bodyWorld) {
    const p = node.position();
    const sp = cam.worldToScreen(bodyWorld.x + p.x, bodyWorld.y + p.y, this._sp);
    const r = 26;

    ctx.save();
    ctx.translate(sp.x, sp.y);

    ctx.strokeStyle = withAlpha('#5ae0b8', 0.8);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();

    // 진행/역행 핸들 (위/아래)
    const handles = [
      { x: 0, y: -r, color: '#ffd24a', tip: '진행' },
      { x: 0, y: r, color: '#ffd24a', tip: '역행' },
      { x: -r, y: 0, color: '#63b8ff', tip: '구심' },
      { x: r, y: 0, color: '#63b8ff', tip: '원심' },
    ];
    for (const h of handles) {
      ctx.fillStyle = h.color;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 5, 0, TAU);
      ctx.fill();
    }

    // 중심
    ctx.fillStyle = '#5ae0b8';
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, TAU);
    ctx.fill();

    // Δv 라벨
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = '#5ae0b8';
    ctx.textAlign = 'left';
    ctx.fillText(
      `Δv ${node.deltaVMagnitude.toFixed(1)} m/s`,
      r + 8,
      -4
    );
    ctx.restore();
  }

  drawVesselMarker(ctx, cam, vessel, time, color) {
    const bodyWorld = vessel.body.absolutePositionAt(time);
    const sp = cam.worldToScreen(
      bodyWorld.x + vessel.pos.x,
      bodyWorld.y + vessel.pos.y,
      this._sp
    );
    if (
      sp.x < -20 ||
      sp.y < -20 ||
      sp.x > cam.width + 20 ||
      sp.y > cam.height + 20
    )
      return;

    ctx.save();
    ctx.translate(sp.x, sp.y);
    ctx.rotate(-(vessel.angle - Math.PI / 2));
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = withAlpha(color, 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 12, 0, TAU);
    ctx.stroke();
  }

  drawLabels(ctx, cam, system, time, vessel) {
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const body of system.list) {
      const p = body.absolutePositionAt(time);
      const sp = cam.worldToScreen(p.x, p.y, this._sp);
      if (
        sp.x < 0 ||
        sp.y < 0 ||
        sp.x > cam.width ||
        sp.y > cam.height
      )
        continue;
      const r = Math.max(body.radius * cam.zoom, 4);
      if (r < 2) continue;
      const isTarget = this.targetBody === body;
      const isSelected = this.selectedBody === body;
      ctx.fillStyle = isTarget
        ? '#c48cff'
        : isSelected
        ? '#ffd24a'
        : withAlpha('#cfe0f0', 0.75);
      ctx.fillText(body.name, sp.x, sp.y + r + 4);
      if (isTarget) {
        ctx.strokeStyle = '#c48cff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r + 8, 0, TAU);
        ctx.stroke();
      }
    }
  }

  drawInfoPanel(ctx, cam, vessel, o) {
    const body = this.selectedBody;
    if (!body) return;
    const w = 240;
    const h = 168;
    // 오른쪽 아래 — 왼쪽은 오토파일럿 바가 쓴다
    const x = cam.width - w - 20;
    const y = cam.height - h - 56;

    ctx.fillStyle = 'rgba(8,13,20,0.78)';
    ctx.strokeStyle = 'rgba(120,160,200,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();

    const d = body.describe();
    ctx.font = `15px ${FONT}`;
    ctx.fillStyle = '#dce8f4';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(body.name, x + 12, y + 24);

    ctx.font = `11px ${FONT}`;
    const rows = [
      ['분류', bodyTypeLabel(body.type)],
      ['반지름', formatDistance(body.radius)],
      ['표면중력', d.gravity],
      ['탈출속도', d.escape],
      ['대기', d.atmosphere],
      ['자전주기', d.day],
      ['SOI', d.soi],
    ];
    rows.forEach((r, i) => {
      const ry = y + 44 + i * 16;
      ctx.fillStyle = '#8ba0b4';
      ctx.fillText(r[0], x + 12, ry);
      ctx.fillStyle = '#dce8f4';
      ctx.textAlign = 'right';
      ctx.fillText(r[1], x + w - 12, ry);
      ctx.textAlign = 'left';
    });
  }

  drawScaleBar(ctx, cam) {
    const bar = cam.scaleBar();
    const x = cam.width - bar.pixels - 24;
    const y = cam.height - 28;
    ctx.strokeStyle = 'rgba(200,220,240,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + bar.pixels, y);
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.moveTo(x + bar.pixels, y - 5);
    ctx.lineTo(x + bar.pixels, y + 5);
    ctx.stroke();
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = 'rgba(200,220,240,0.85)';
    ctx.textAlign = 'center';
    ctx.fillText(bar.label, x + bar.pixels / 2, y - 9);
  }

  update(dt) {
    this.camera.update(dt);
  }

  /** 목표 지정 */
  setTarget(body) {
    this.targetBody = body;
    return body;
  }

  /** 최근접 접근 정보 계산 */
  closestApproachInfo(vessel, targetBody, time) {
    if (!targetBody || !targetBody.orbit || !vessel.orbit) return null;
    if (targetBody.parent !== vessel.body) return null;
    const ca = closestApproach(
      vessel.orbit,
      targetBody.orbit,
      time,
      time + Math.min(vessel.orbit.period * 3 || 7200, 86400 * 30)
    );
    return {
      distance: ca.distance,
      time: ca.t - time,
      insideSOI: ca.distance < targetBody.soi,
    };
  }
}

function bodyTypeLabel(t) {
  return (
    { star: '항성', planet: '행성', moon: '위성', dwarf: '왜행성' }[t] ?? t
  );
}
