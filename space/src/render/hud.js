// ORBITER — 비행 HUD
// 화면 위에 겹쳐 그리는 계기판. 고도/속도 테이프, 스로틀, 자원, 스테이지,
// 궤도 정보, 경고 메시지를 담당한다.

import {
  clamp,
  clamp01,
  lerp,
  wrapPi,
  withAlpha,
  formatDistance,
  formatSpeed,
  formatTime,
  formatClock,
  formatMass,
  formatForce,
  TAU,
  vLen,
} from '../core/math.js';
import { SITUATION_LABEL, RESOURCES } from '../physics/constants.js';
import { drawNavball, drawHeadingTape } from './navball.js';
import { stageSummaries, describeNextStage } from '../flight/staging.js';
import { landingAssessment, suicideBurnAltitude } from '../flight/autopilot.js';

const FONT = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
const UI_FONT = '"Rajdhani", "Noto Sans KR", system-ui, sans-serif';

const COLOR = {
  panel: 'rgba(8,13,20,0.62)',
  panelEdge: 'rgba(120,160,200,0.22)',
  text: '#dce8f4',
  dim: '#8ba0b4',
  accent: '#5ad1ff',
  warn: '#ffc44a',
  danger: '#ff5a4a',
  good: '#5ae09a',
};

export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = canvas.width;
    this.height = canvas.height;
    this.scale = 1;
    this.messages = [];
    this.visible = true;
    this.compact = false;
    this.showStageList = true;
    this.blink = 0;
  }

  resize(w, h, scale = 1) {
    this.width = w;
    this.height = h;
    this.scale = scale;
  }

  /** 토스트 메시지 추가 */
  toast(text, kind = 'info', duration = 4) {
    this.messages.push({ text, kind, life: duration, max: duration });
    if (this.messages.length > 6) this.messages.shift();
  }

  update(dt) {
    this.blink += dt;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      this.messages[i].life -= dt;
      if (this.messages[i].life <= 0) this.messages.splice(i, 1);
    }
  }

  /* ── 공통 그리기 헬퍼 ──────────────────────────────────── */

  panel(x, y, w, h, radius = 6) {
    const ctx = this.ctx;
    ctx.fillStyle = COLOR.panel;
    ctx.strokeStyle = COLOR.panelEdge;
    ctx.lineWidth = 1;
    roundRectPath(ctx, x, y, w, h, radius);
    ctx.fill();
    ctx.stroke();
  }

  label(text, x, y, opts = {}) {
    const ctx = this.ctx;
    ctx.font = opts.font ?? `${opts.size ?? 12}px ${FONT}`;
    ctx.fillStyle = opts.color ?? COLOR.dim;
    ctx.textAlign = opts.align ?? 'left';
    ctx.textBaseline = opts.baseline ?? 'alphabetic';
    ctx.fillText(text, x, y);
  }

  value(text, x, y, opts = {}) {
    this.label(text, x, y, {
      size: opts.size ?? 15,
      color: opts.color ?? COLOR.text,
      align: opts.align,
      baseline: opts.baseline,
      font: opts.font,
    });
  }

  bar(x, y, w, h, fraction, color, bg = 'rgba(255,255,255,0.08)') {
    const ctx = this.ctx;
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp01(fraction), h);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  /* ── 메인 ─────────────────────────────────────────────── */

  /**
   * @param {object} o { vessel, system, time, autopilot, planner, warp, settings }
   */
  render(o) {
    const ctx = this.ctx;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this.visible) {
      this.renderMessages(o);
      return;
    }
    const vessel = o.vessel;
    if (!vessel) {
      this.renderMessages(o);
      return;
    }

    // 지도 화면에서는 계기 패널이 궤도를 가리므로 최소한만 남긴다
    if (o.mapOpen) {
      this.renderTopBar(o);
      this.renderOrbitInfo(o);
      this.renderWarnings(o);
      this.renderAutopilot(o);
      this.renderMessages(o);
      return;
    }

    this.renderTopBar(o);
    this.renderAltitudeTape(o);
    this.renderSpeedTape(o);
    this.renderThrottle(o);
    this.renderNavball(o);
    this.renderResources(o);
    if (this.showStageList) this.renderStages(o);
    this.renderOrbitInfo(o);
    this.renderDocking(o);
    this.renderRover(o);
    this.renderWarnings(o);
    this.renderAutopilot(o);
    this.renderMessages(o);
  }

  /**
   * 도킹 보조 — 가까운 대상까지의 거리·접근속도·방향.
   *
   * 도킹의 어려움은 "지금 다가가고 있나 멀어지고 있나" 를 모르는 데서
   * 온다. 그래서 접근속도의 부호를 색으로 구분해서 보여준다.
   */
  renderDocking(o) {
    const info = o.docking;
    if (!info || info.distance > 500) return;
    const ctx = this.ctx;
    const w = this.width;
    const x = w / 2 - 110;
    const y = 150;

    this.panel(x, y, 220, 78, 8);
    this.label('도킹 대상', x + 12, y + 18, { size: 10 });
    this.value(info.target.name ?? '미상', x + 12, y + 33, { size: 12 });

    // 접근속도 부호 — 음수면 가까워지는 중
    const dx = info.dx;
    const dy = info.dy;
    const d = Math.max(info.distance, 1e-6);
    const rvx = info.target.vel.x - o.vessel.vel.x;
    const rvy = info.target.vel.y - o.vessel.vel.y;
    const closing = -((rvx * dx + rvy * dy) / d);

    this.label('거리', x + 12, y + 52, { size: 10 });
    this.value(
      info.distance < 1000
        ? `${info.distance.toFixed(1)} m`
        : `${(info.distance / 1000).toFixed(2)} km`,
      x + 12,
      y + 68,
      { size: 14 }
    );

    this.label('접근속도', x + 116, y + 52, { size: 10 });
    const color = closing > 0.05 ? COLOR.good : closing < -0.05 ? COLOR.warn : COLOR.text;
    this.value(`${closing >= 0 ? '+' : ''}${closing.toFixed(2)} m/s`, x + 116, y + 68, {
      size: 14,
      color,
    });

    // 방향 화살표 — 대상이 어느 쪽인지
    const ang = Math.atan2(-dy, dx);
    const ax = x + 190;
    const ay = y + 22;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(-ang);
    ctx.fillStyle = closing > 0.05 ? COLOR.good : COLOR.accent;
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-7, 6);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-7, -6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 로버 주행 상태 — 바퀴가 접지 중일 때만 */
  renderRover(o) {
    const v = o.vessel;
    if (!v) return;
    const wheels = v.parts.filter(
      (p) => !p.destroyed && p.def.wheel && p.legExtended
    );
    if (!wheels.length || !v.landed) return;

    const x = this.width / 2 - 90;
    const y = this.height - 200;
    this.panel(x, y, 180, 52, 8);
    this.label('주행', x + 12, y + 17, { size: 10 });
    this.value(`${Math.abs(v.groundSpeed ?? 0).toFixed(1)} m/s`, x + 12, y + 36, {
      size: 15,
    });
    this.label('브레이크', x + 106, y + 17, { size: 10 });
    this.value(v.brakes ? 'ON' : 'off', x + 106, y + 36, {
      size: 13,
      color: v.brakes ? COLOR.warn : COLOR.dim,
    });
  }

  /* 상단 바 — 임무 시간, 상황, 타임워프 */
  renderTopBar(o) {
    const ctx = this.ctx;
    const v = o.vessel;
    const w = this.width;
    const barH = 34;

    this.panel(w / 2 - 240, 8, 480, barH, 8);

    this.label('임무 시간', w / 2 - 226, 22, { size: 10 });
    this.value(formatTime(v.missionTime, true), w / 2 - 226, 36, { size: 14 });

    this.label('상황', w / 2 - 100, 22, { size: 10 });
    const situationColor =
      v.situation === 'orbiting'
        ? COLOR.good
        : v.situation === 'destroyed'
        ? COLOR.danger
        : COLOR.text;
    this.value(SITUATION_LABEL[v.situation] ?? v.situation, w / 2 - 100, 36, {
      size: 14,
      color: situationColor,
    });

    this.label('천체', w / 2 + 20, 22, { size: 10 });
    this.value(v.body?.name ?? '—', w / 2 + 20, 36, { size: 14 });

    this.label('시간 배속', w / 2 + 120, 22, { size: 10 });
    const warp = o.warp ?? 1;
    this.value(warp > 1 ? `×${formatWarp(warp)}` : '실시간', w / 2 + 120, 36, {
      size: 14,
      color: warp > 1 ? COLOR.accent : COLOR.text,
    });

    // 타임워프 인디케이터 (화살표)
    if (warp > 1) {
      const n = Math.min(6, Math.round(Math.log10(warp) * 2) + 1);
      ctx.fillStyle = COLOR.accent;
      for (let i = 0; i < n; i++) {
        const x = w / 2 + 190 + i * 8;
        ctx.beginPath();
        ctx.moveTo(x, 16);
        ctx.lineTo(x + 6, 22);
        ctx.lineTo(x, 28);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /* 좌측 고도 테이프 */
  renderAltitudeTape(o) {
    const ctx = this.ctx;
    const v = o.vessel;
    const x = 24;
    const y = this.height / 2 - 130;
    const w = 86;
    const h = 260;

    this.panel(x, y, w, h, 6);
    this.label('고도', x + 8, y + 16, { size: 10 });

    const alt = v.altitude;
    this.value(formatDistance(alt), x + 8, y + 34, { size: 15 });

    const terrainAlt = v.terrainAltitude;
    if (Math.abs(terrainAlt - alt) > 1) {
      this.label('지표 기준', x + 8, y + 52, { size: 9 });
      this.value(formatDistance(terrainAlt), x + 8, y + 66, {
        size: 13,
        color: terrainAlt < 500 ? COLOR.warn : COLOR.text,
      });
    }

    // 대기권 표시 막대
    const barX = x + w - 20;
    const barY = y + 80;
    const barH = h - 96;
    const atmoH = v.body.atmo.height || v.body.radius * 0.1;
    const maxShow = Math.max(atmoH * 1.5, alt * 1.15, 1000);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(barX, barY, 12, barH);

    if (v.body.atmo.exists) {
      const atmoFrac = clamp01(atmoH / maxShow);
      const g = ctx.createLinearGradient(0, barY + barH, 0, barY + barH * (1 - atmoFrac));
      g.addColorStop(0, withAlpha(v.body.atmo.hazeColor, 0.65));
      g.addColorStop(1, withAlpha(v.body.atmo.hazeColor, 0));
      ctx.fillStyle = g;
      ctx.fillRect(barX, barY + barH * (1 - atmoFrac), 12, barH * atmoFrac);
    }

    // 현재 고도 마커
    const frac = clamp01(alt / maxShow);
    const my = barY + barH * (1 - frac);
    ctx.fillStyle = COLOR.accent;
    ctx.beginPath();
    ctx.moveTo(barX - 6, my);
    ctx.lineTo(barX, my - 4);
    ctx.lineTo(barX, my + 4);
    ctx.closePath();
    ctx.fill();

    // Ap / Pe 마커
    if (v.orbit) {
      for (const [val, color, tag] of [
        [v.apoapsis, '#5ae09a', 'Ap'],
        [v.periapsis, '#ffb04a', 'Pe'],
      ]) {
        if (!Number.isFinite(val)) continue;
        const f = clamp01(val / maxShow);
        const yy = barY + barH * (1 - f);
        ctx.strokeStyle = withAlpha(color, 0.8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(barX, yy);
        ctx.lineTo(barX + 12, yy);
        ctx.stroke();
        this.label(tag, barX + 14, yy + 3, { size: 9, color });
      }
    }

    // 수직속도
    this.label('수직속도', x + 8, y + h - 30, { size: 9 });
    const vs = v.verticalSpeed;
    this.value(
      `${vs >= 0 ? '+' : ''}${vs.toFixed(1)} m/s`,
      x + 8,
      y + h - 14,
      { size: 13, color: vs < -20 ? COLOR.warn : COLOR.text }
    );
  }

  /* 우측 속도 테이프 */
  renderSpeedTape(o) {
    const v = o.vessel;
    const w = 96;
    const x = this.width - w - 24;
    const y = this.height / 2 - 130;
    const h = 260;

    this.panel(x, y, w, h, 6);
    this.label('궤도 속도', x + 8, y + 16, { size: 10 });
    this.value(formatSpeed(v.orbitalSpeed), x + 8, y + 34, { size: 15 });

    this.label('지표 속도', x + 8, y + 54, { size: 10 });
    this.value(formatSpeed(v.surfaceSpeed), x + 8, y + 70, { size: 14 });

    this.label('수평 속도', x + 8, y + 90, { size: 10 });
    this.value(formatSpeed(v.horizontalSpeed), x + 8, y + 105, { size: 13 });

    this.label('G', x + 8, y + 128, { size: 10 });
    const g = v.gForce;
    this.value(`${g.toFixed(2)} g`, x + 8, y + 143, {
      size: 14,
      color: g > 8 ? COLOR.danger : g > 5 ? COLOR.warn : COLOR.text,
    });

    if (v.body.atmo.exists && v.altitude < v.body.atmo.height) {
      this.label('마하', x + 8, y + 166, { size: 10 });
      this.value(v.mach.toFixed(2), x + 8, y + 181, {
        size: 13,
        color: v.mach > 0.9 && v.mach < 1.2 ? COLOR.warn : COLOR.text,
      });

      this.label('동압 Q', x + 8, y + 202, { size: 10 });
      this.value(`${(v.dynamicPressure / 1000).toFixed(1)} kPa`, x + 8, y + 217, {
        size: 13,
        color: v.dynamicPressure > 30000 ? COLOR.danger : COLOR.text,
      });
    } else {
      this.label('Δv 잔량', x + 8, y + 166, { size: 10 });
      this.value(`${Math.round(v.availableDeltaV(0))} m/s`, x + 8, y + 181, {
        size: 13,
        color: COLOR.good,
      });
      this.label('추중비', x + 8, y + 202, { size: 10 });
      this.value(v.twr(0).toFixed(2), x + 8, y + 217, { size: 13 });
    }

    // 열 게이지
    if (v.hottestFraction > 0.05) {
      this.label('온도', x + 8, y + h - 30, { size: 9 });
      this.bar(
        x + 8,
        y + h - 22,
        w - 16,
        8,
        v.hottestFraction,
        v.hottestFraction > 0.8
          ? COLOR.danger
          : v.hottestFraction > 0.5
          ? COLOR.warn
          : '#ff8a4a'
      );
    }
  }

  /* 스로틀 */
  renderThrottle(o) {
    const ctx = this.ctx;
    const v = o.vessel;
    const x = 124;
    const y = this.height / 2 - 90;
    const w = 16;
    const h = 180;

    ctx.fillStyle = 'rgba(8,13,20,0.5)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = COLOR.panelEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    const frac = clamp01(v.throttle);
    const g = ctx.createLinearGradient(0, y + h, 0, y);
    g.addColorStop(0, '#4ad07a');
    g.addColorStop(0.6, '#ffc44a');
    g.addColorStop(1, '#ff6a4a');
    ctx.fillStyle = g;
    ctx.fillRect(x + 2, y + h - h * frac + 2, w - 4, h * frac - 4);

    // 목표 스로틀 표시
    const ty = y + h - h * clamp01(v.targetThrottle);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 3, ty);
    ctx.lineTo(x + w + 3, ty);
    ctx.stroke();

    this.label(`${Math.round(frac * 100)}%`, x + w / 2, y + h + 14, {
      size: 11,
      align: 'center',
      color: COLOR.text,
    });
    this.label('스로틀', x + w / 2, y - 6, {
      size: 9,
      align: 'center',
    });
  }

  /* 내비볼 */
  renderNavball(o) {
    const v = o.vessel;
    const r = 74;
    const cx = this.width / 2;
    const cy = this.height - r - 26;

    drawNavball(this.ctx, cx, cy, r, v, {
      maneuverNode: o.planner?.next ?? null,
      target: o.target ?? null,
      surfaceMode: v.altitude < v.body.atmo.height,
    });

    drawHeadingTape(this.ctx, cx, cy - r - 26, 260, v);

    // SAS / RCS 표시
    const tags = [];
    if (v.sas) tags.push({ text: `SAS ${sasLabel(v.sasMode)}`, color: COLOR.accent });
    if (v.rcs) tags.push({ text: 'RCS', color: COLOR.good });
    if (v.gearDown) tags.push({ text: '다리', color: COLOR.text });
    if (v.lightsOn) tags.push({ text: '조명', color: COLOR.warn });
    if (v.brakes) tags.push({ text: '브레이크', color: COLOR.warn });

    const tagW = 88;
    const tagX = cx - r - tagW - 16;
    let tagY = cy - (tags.length * 26) / 2;
    for (const tag of tags) {
      this.panel(tagX, tagY, tagW, 22, 4);
      this.label(tag.text, tagX + tagW / 2, tagY + 15, {
        size: 11,
        align: 'center',
        color: tag.color,
      });
      tagY += 26;
    }
  }

  /* 자원 게이지 */
  renderResources(o) {
    const v = o.vessel;
    const list = v.net.summary().filter((r) => r.capacity > 0);
    if (!list.length) return;

    const w = 150;
    const rowH = 20;
    const h = 22 + list.length * rowH;
    const x = 24;
    const y = 52;

    this.panel(x, y, w, h, 6);
    this.label('자원', x + 8, y + 15, { size: 10 });

    list.forEach((r, i) => {
      const ry = y + 24 + i * rowH;
      this.label(r.short, x + 8, ry + 10, { size: 10, color: r.color });
      this.bar(x + 34, ry + 2, w - 76, 9, r.fraction, r.color);
      this.label(
        `${Math.round(r.fraction * 100)}%`,
        x + w - 8,
        ry + 10,
        { size: 9, align: 'right' }
      );
    });
  }

  /* 스테이지 목록 */
  renderStages(o) {
    const v = o.vessel;
    // 상단 스테이지는 대부분 진공에서 쓰이므로 Δv 는 진공 기준으로 보여준다.
    // (해면 기준으로 계산하면 진공 엔진이 쓸모없어 보인다)
    const summaries = stageSummaries(v, 0);
    if (!summaries.length) return;

    const w = 186;
    const rowH = 34;
    const visible = summaries.slice(v.stageIndex, v.stageIndex + 5);
    const h = 26 + visible.length * rowH;
    const x = this.width - w - 24;
    const y = 52;

    this.panel(x, y, w, h, 6);
    this.label(
      `스테이지 ${v.stageIndex + 1}/${summaries.length} · 진공 기준`,
      x + 8,
      y + 16,
      { size: 10 }
    );

    visible.forEach((s, i) => {
      const ry = y + 24 + i * rowH;
      const isCurrent = i === 0;
      if (isCurrent) {
        this.ctx.fillStyle = 'rgba(90,209,255,0.12)';
        this.ctx.fillRect(x + 4, ry, w - 8, rowH - 3);
      }
      this.label(`#${s.index + 1}`, x + 10, ry + 13, {
        size: 10,
        color: isCurrent ? COLOR.accent : COLOR.dim,
      });
      this.value(
        s.deltaV > 0 ? `${Math.round(s.deltaV)} m/s` : '—',
        x + 44,
        ry + 13,
        { size: 12 }
      );
      const twrText = s.twr > 0 ? `TWR ${s.twr.toFixed(2)}` : '';
      const burnText = s.burnTime > 0 ? `${Math.round(s.burnTime)}s` : '';
      this.label(`${twrText}  ${burnText}`, x + 44, ry + 26, { size: 9 });

      // 아이콘
      let ix = x + w - 14;
      for (const icon of s.icons.slice(0, 4)) {
        this.ctx.fillStyle = iconColor(icon.type);
        this.ctx.fillRect(ix - 6, ry + 6, 6, 6);
        ix -= 9;
      }
    });

    this.label(describeNextStage(v), x + 8, y + h - 6, {
      size: 9,
      color: COLOR.warn,
    });
  }

  /* 궤도 정보 */
  renderOrbitInfo(o) {
    const v = o.vessel;
    if (!v.orbit) return;
    const w = 208;
    const h = 96;
    const x = this.width / 2 - w / 2;
    const y = 50;

    this.panel(x, y, w, h, 6);
    const o2 = v.orbit;

    const rows = [
      ['원점 Ap', Number.isFinite(v.apoapsis) ? formatDistance(v.apoapsis) : '∞'],
      ['근점 Pe', formatDistance(v.periapsis)],
      ['이심률', o2.e.toFixed(4)],
      [
        '주기',
        Number.isFinite(o2.period) ? formatTime(o2.period, true) : '탈출 궤도',
      ],
    ];
    rows.forEach((r, i) => {
      const ry = y + 20 + i * 19;
      this.label(r[0], x + 10, ry, { size: 10 });
      this.value(r[1], x + w - 10, ry, { size: 12, align: 'right' });
    });
  }

  /* 경고 */
  renderWarnings(o) {
    const v = o.vessel;
    const warnings = [];

    if (v.hottestFraction > 0.8) warnings.push(['과열 위험', COLOR.danger]);
    if (v.gForce > 9) warnings.push(['고 G 하중', COLOR.danger]);
    if (v.dynamicPressure > 35000) warnings.push(['최대 동압 초과', COLOR.warn]);
    if (v.brownout) warnings.push(['전력 부족', COLOR.warn]);
    if (v.net.capacity('lf') > 0 && v.net.fraction('lf') < 0.08)
      warnings.push(['연료 부족', COLOR.warn]);
    if (v.controlLost) warnings.push(['조종 불능', COLOR.danger]);

    // 착륙 경고
    if (v.verticalSpeed < -5 && v.terrainAltitude < 20000 && !v.landed) {
      const a = landingAssessment(v);
      if (a.status === 'danger') warnings.push([a.label, COLOR.danger]);
      else if (a.status === 'warn') warnings.push([a.label, COLOR.warn]);
    }

    if (!warnings.length) return;
    const blinkOn = Math.sin(this.blink * 6) > -0.3;
    const x = this.width / 2;
    let y = this.height - 220;

    for (const [text, color] of warnings) {
      const w = Math.max(160, text.length * 11 + 30);
      this.ctx.globalAlpha = color === COLOR.danger && !blinkOn ? 0.45 : 1;
      this.panel(x - w / 2, y, w, 24, 4);
      this.label(`⚠ ${text}`, x, y + 16, {
        size: 12,
        align: 'center',
        color,
      });
      this.ctx.globalAlpha = 1;
      y -= 28;
    }
  }

  /* 오토파일럿 상태 */
  renderAutopilot(o) {
    const ap = o.autopilot;
    if (!ap || !ap.enabled) return;
    const w = 220;
    const x = this.width / 2 - w / 2;
    const y = 152;
    this.panel(x, y, w, 44, 6);
    this.label('오토파일럿', x + 10, y + 16, { size: 10, color: COLOR.accent });
    this.value(ap.status, x + 10, y + 34, { size: 12 });
  }

  /* 토스트 메시지 */
  renderMessages() {
    const x = this.width / 2;
    let y = 200;
    for (const m of this.messages) {
      const alpha = clamp01(m.life / Math.min(m.max, 1.2));
      const color =
        m.kind === 'danger'
          ? COLOR.danger
          : m.kind === 'success'
          ? COLOR.good
          : m.kind === 'warn'
          ? COLOR.warn
          : COLOR.text;
      const w = Math.max(180, m.text.length * 10 + 32);
      this.ctx.globalAlpha = alpha;
      this.panel(x - w / 2, y, w, 28, 6);
      this.label(m.text, x, y + 19, { size: 13, align: 'center', color });
      this.ctx.globalAlpha = 1;
      y += 34;
    }
  }
}

/* ──────────────────────────────────────────────────────────────
 * 헬퍼
 * ────────────────────────────────────────────────────────────── */

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
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

function iconColor(type) {
  switch (type) {
    case 'engine':
      return '#ff8a4a';
    case 'decoupler':
      return '#d9743a';
    case 'chute':
      return '#5ad1ff';
    case 'clamp':
      return '#ffc44a';
    case 'fairing':
      return '#cfd8e0';
    default:
      return '#8ba0b4';
  }
}

function sasLabel(mode) {
  return (
    {
      hold: '고정',
      prograde: '진행',
      retrograde: '역행',
      surfacePrograde: '지표진행',
      surfaceRetrograde: '지표역행',
      radialIn: '구심',
      radialOut: '원심',
      normal: '노멀',
      target: '목표',
      off: '해제',
    }[mode] ?? mode
  );
}

function formatWarp(w) {
  if (w >= 1000) return `${(w / 1000).toFixed(w >= 10000 ? 0 : 1)}k`;
  return String(w);
}

/**
 * 도킹 보조 HUD — 목표와의 상대 운동 표시.
 */
export function drawDockingHud(ctx, x, y, w, h, motion) {
  ctx.save();
  ctx.fillStyle = COLOR.panel;
  roundRectPath(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = COLOR.panelEdge;
  ctx.stroke();

  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = COLOR.dim;
  ctx.textAlign = 'left';
  ctx.fillText('목표 거리', x + 10, y + 18);
  ctx.fillText('접근 속도', x + 10, y + 38);
  ctx.fillText('상대 속도', x + 10, y + 58);

  ctx.textAlign = 'right';
  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = COLOR.text;
  ctx.fillText(formatDistance(motion.distance), x + w - 10, y + 18);
  ctx.fillStyle =
    motion.closingSpeed > 5 && motion.distance < 200 ? COLOR.warn : COLOR.text;
  ctx.fillText(`${motion.closingSpeed.toFixed(2)} m/s`, x + w - 10, y + 38);
  ctx.fillStyle = COLOR.text;
  ctx.fillText(`${motion.relativeSpeed.toFixed(2)} m/s`, x + w - 10, y + 58);
  ctx.restore();
}
