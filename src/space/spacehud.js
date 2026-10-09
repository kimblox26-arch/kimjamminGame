// FREE FREELY 우주 탐사 - 캔버스 HUD (모든 아이콘은 src/ui/icons.js 의 SVG 경로를 Path2D 로 그림)
import { drawIcon, bodyIcon, ICON_COLORS } from '../ui/icons.js';
import { formatDistance, formatSpeed, formatC, formatDuration, formatPressure, formatTemp, TIERS } from './consts.js';
import { GAS_LABEL } from './universe.js';

const CY = '#62e6ff', OR = '#ffa94d', RD = '#ff5a4e', WH = '#e9f6ff', DIM = 'rgba(200,230,250,0.6)', GR = '#7dffb0';
const FONT = (s, w = 600) => `${w} ${s}px Rajdhani, "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;

export class SpaceHUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.visible = true;
    this.events = [];
    this.time = 0;
    this.tierPulse = 0;
    this.lastTier = 1;
    this.reduced = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
    this.insetBottom = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
  }

  pushEvent(e) {
    this.events.unshift({ ...e, t: 0 });
    if (this.events.length > 6) this.events.length = 6;
  }

  clear() { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }

  render(s, dt) {
    const ctx = this.ctx;
    this.time += dt;
    this.clear();
    if (!this.visible || !s) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const reduced = this.reduced.matches;
    this.anim = !reduced;
    if (s.tier !== this.lastTier) { this.tierPulse = 1.2; this.lastTier = s.tier; }
    this.tierPulse = Math.max(0, this.tierPulse - dt);
    for (const e of this.events) e.t += dt;
    this.events = this.events.filter((e) => e.t < 9);

    const W = this.w, H = this.h;
    const compact = W < 760;
    this._markers(ctx, s);
    this._tierGauge(ctx, W / 2, 14, s, compact);
    this._speedBlock(ctx, 14, H - 200 - this.insetBottom, s);
    this._navBlock(ctx, W - 14, 14, s, compact);
    if (!compact) this._envBlock(ctx, 14, 92, s);
    this._shipBlock(ctx, W - 14, H - 160 - this.insetBottom, s);
    this._warnings(ctx, W / 2, compact ? 108 : 96, s);
    this._events(ctx, 14, compact ? 96 : H * 0.5 + 20, compact);
  }

  /* ------------------------------ 공통 ------------------------------ */
  _panel(ctx, x, y, w, h, color = CY, alpha = 0.55) {
    const c = 9;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + c); ctx.closePath();
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(10,26,40,0.62)'); g.addColorStop(1, 'rgba(4,12,20,0.5)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 2, y + c + 4); ctx.lineTo(x + c + 4, y + 2); ctx.stroke();
    ctx.restore();
  }

  _text(ctx, t, x, y, size, color = WH, align = 'left', weight = 600, maxW = 0) {
    ctx.font = FONT(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    if (maxW > 0) ctx.fillText(t, x, y, maxW); else ctx.fillText(t, x, y);
  }

  _bar(ctx, x, y, w, h, v, color, back = 'rgba(255,255,255,0.1)') {
    ctx.fillStyle = back; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color; ctx.fillRect(x, y, w * Math.max(0, Math.min(1, v)), h);
  }

  /* ------------------------------ 속도 단계 게이지 ------------------------------ */
  _tierGauge(ctx, cx, y, s, compact) {
    const n = 5, gap = compact ? 44 : 56, w = gap * n + 26, h = compact ? 66 : 74;
    const x = cx - w / 2;
    this._panel(ctx, x, y, w, h, s.warp ? '#bff6ff' : CY, 0.6);
    for (let i = 1; i <= n; i++) {
      const ix = x + 13 + gap * (i - 0.5);
      const active = i === s.tier;
      const lit = i <= s.tier;
      let scale = 1;
      if (active && this.tierPulse > 0 && this.anim) scale = 1 + Math.sin((1.2 - this.tierPulse) * Math.PI * 3) * 0.14 * this.tierPulse;
      const col = active ? (i >= 4 ? '#bff6ff' : OR) : lit ? WH : DIM;
      drawIcon(ctx, 'tier' + i, ix, y + 26, compact ? 26 : 30, {
        color: col, accent: active ? '#ffb060' : lit ? OR : DIM, cyan: lit ? CY : DIM, scale,
        animate: this.anim && (active || (i === 5 && s.tier === 5)), t: this.time * (i === 5 && s.warp ? 2.5 : 1), glow: active ? 1 : 0,
        alpha: lit ? 1 : 0.55,
      });
      this._text(ctx, String(i), ix, y + (compact ? 54 : 58), 11, active ? OR : DIM, 'center', 700);
    }
    // 전환 게이지 (차오름)
    const gx = x + 13, gw = w - 26, gy = y + h - 7;
    const from = (s.tierFrom - 1) / 4, to = (s.tier - 1) / 4;
    const k = s.tierT * s.tierT * (3 - 2 * s.tierT);
    const v = from + (to - from) * k;
    this._bar(ctx, gx, gy, gw, 3, v + 0.02, s.tier >= 4 ? '#bff6ff' : OR);
    if (!compact) {
      const tdef = TIERS[s.tier - 1];
      this._text(ctx, `${tdef.name} · 최대 ${formatSpeed(tdef.max)}`, cx, y + h + 15, 12, DIM, 'center');
    }
  }

  /* ------------------------------ 속도 · 스로틀 ------------------------------ */
  _speedBlock(ctx, x, y, s) {
    const w = 236, h = 170;
    this._panel(ctx, x, y, w, h);
    drawIcon(ctx, 'speed', x + 22, y + 24, 22, { color: WH, accent: OR, glow: 0.6 });
    this._text(ctx, s.speedLabel || '속도', x + 40, y + 29, 12, DIM);
    this._text(ctx, formatSpeed(s.speed), x + 16, y + 66, 32, WH, 'left', 700, w - 30);
    const c = formatC(s.speed);
    if (c) this._text(ctx, c, x + 16, y + 86, 14, '#bff6ff', 'left', 700);
    else if (s.mach > 0.3) this._text(ctx, `마하 ${s.mach.toFixed(2)}`, x + 16, y + 86, 14, s.mach > 1 ? OR : CY, 'left', 700);
    // 스로틀
    drawIcon(ctx, 'throttle', x + 22, y + 112, 20, { color: WH, accent: OR });
    this._text(ctx, '스로틀', x + 40, y + 117, 12, DIM);
    this._text(ctx, Math.round(s.throttle * 100) + '%', x + w - 14, y + 117, 14, OR, 'right', 700);
    this._bar(ctx, x + 16, y + 126, w - 32, 7, s.throttle, OR);
    this._text(ctx, '목표 ' + formatSpeed(s.targetSpeed), x + 16, y + 152, 12, DIM);
    if (s.limited) {
      drawIcon(ctx, 'warning', x + w - 26, y + 147, 16, { color: OR, accent: OR });
      this._text(ctx, '근접 감속', x + w - 38, y + 152, 12, OR, 'right');
    }
  }

  /* ------------------------------ 항법 (가까운 천체 · 목표) ------------------------------ */
  _navBlock(ctx, rx, y, s, compact) {
    const w = compact ? 200 : 268, x = rx - w;
    let h = 72 + (s.target ? 66 : 0) + (s.altShow ? 48 : 0);
    this._panel(ctx, x, y, w, h);
    let yy = y + 26;
    if (s.altShow) {
      drawIcon(ctx, 'altitude', x + 22, yy - 4, 22, { color: WH, accent: OR });
      this._text(ctx, s.agl < 30000 ? '지표 고도' : '고도', x + 40, yy, 12, DIM);
      this._text(ctx, formatDistance(s.agl < 30000 ? s.agl : s.alt), x + w - 14, yy, 18, WH, 'right', 700);
      this._text(ctx, `수직 ${s.vs >= 0 ? '+' : ''}${s.vs.toFixed(0)} m/s`, x + w - 14, yy + 18, 12, s.vs < -50 && s.agl < 3000 ? RD : DIM, 'right');
      yy += 48;
    }
    if (s.nearest) {
      drawIcon(ctx, bodyIcon(s.nearest.body), x + 22, yy - 4, 24, { color: WH, accent: OR, cyan: CY, animate: this.anim, t: this.time * 0.5, glow: 0.5 });
      this._text(ctx, '가장 가까운 천체', x + 40, yy - 8, 11, DIM);
      this._text(ctx, formatDistance(s.nearest.dist), x + w - 14, yy + 8, 13, CY, 'right', 700);
      const dw = ctx.measureText(formatDistance(s.nearest.dist)).width;
      drawIcon(ctx, 'distance', x + w - 14 - dw - 14, yy + 3, 14, { color: DIM, accent: CY });
      this._text(ctx, s.nearest.body.name, x + 40, yy + 8, 15, WH, 'left', 700, w - 54 - dw - 30);
      yy += 38;
    }
    if (s.target) {
      ctx.strokeStyle = 'rgba(98,230,255,0.2)'; ctx.beginPath(); ctx.moveTo(x + 12, yy - 14); ctx.lineTo(x + w - 12, yy - 14); ctx.stroke();
      drawIcon(ctx, 'target', x + 22, yy + 4, 20, { color: OR, accent: OR, animate: this.anim, t: this.time });
      this._text(ctx, '목표', x + 40, yy, 11, DIM);
      this._text(ctx, formatDistance(s.target.dist), x + w - 14, yy + 16, 13, WH, 'right', 700);
      const tw = ctx.measureText(formatDistance(s.target.dist)).width;
      this._text(ctx, s.target.body.name, x + 40, yy + 16, 15, OR, 'left', 700, w - 54 - tw - 10);
      drawIcon(ctx, 'eta', x + 22, yy + 36, 16, { color: DIM, accent: CY });
      this._text(ctx, '도착 예상 ' + formatDuration(s.target.eta), x + 40, yy + 40, 12, CY);
    }
  }

  /* ------------------------------ 환경 (중력 · 기압 · 기온 · 조성) ------------------------------ */
  _envBlock(ctx, x, y, s) {
    const comp = s.composition;
    const rows = comp ? Math.min(4, Object.keys(comp).length) : 0;
    const w = 236, h = 100 + (rows ? 22 + rows * 15 : 0);
    this._panel(ctx, x, y, w, h);
    const line = (icon, label, value, yy, col = WH) => {
      drawIcon(ctx, icon, x + 22, yy - 4, 18, { color: WH, accent: OR, warn: RD, cyan: CY, animate: icon === 'temperature' && s.heat > 0.3 && this.anim, t: this.time });
      this._text(ctx, label, x + 38, yy, 12, DIM);
      this._text(ctx, value, x + w - 14, yy, 14, col, 'right', 700);
    };
    line('gravity', '중력', `${s.gravityG.toFixed(s.gravityG < 0.1 ? 3 : 2)} g`, y + 24);
    line('pressure', '기압', formatPressure(s.pressure), y + 48);
    line('temperature', '기온', s.pressure > 1e-3 ? formatTemp(s.temp) : '—', y + 72);
    if (rows) {
      drawIcon(ctx, 'atmosphere', x + 22, y + 92, 18, { color: WH, cyan: CY, accent: OR });
      this._text(ctx, '대기 조성' + (s.atmoBody ? ' · ' + s.atmoBody : ''), x + 38, y + 96, 12, DIM);
      const keys = Object.keys(comp).sort((a, b) => comp[b] - comp[a]).slice(0, 4);
      keys.forEach((k, i) => {
        const yy = y + 114 + i * 15;
        this._text(ctx, GAS_LABEL[k] || k, x + 16, yy, 12, WH, 'left', 700);
        this._bar(ctx, x + 58, yy - 7, w - 124, 5, comp[k] / 100, CY);
        this._text(ctx, comp[k] < 1 ? comp[k].toFixed(2) + '%' : comp[k].toFixed(1) + '%', x + w - 14, yy, 12, GR, 'right');
      });
    } else if (s.vacuum) {
      this._text(ctx, '진공 — 대기 없음', x + 16, y + 96, 12, DIM);
    }
  }

  /* ------------------------------ 기체 상태 ------------------------------ */
  _shipBlock(ctx, rx, y, s) {
    const w = 268, h = 146, x = rx - w;
    const hot = s.hullTemp > 1500;
    this._panel(ctx, x, y, w, h, s.integrity < 35 ? RD : CY);
    // 선체 온도
    const tcol = s.hullTemp > 2000 ? RD : s.hullTemp > 1100 ? OR : WH;
    drawIcon(ctx, 'hullTemp', x + 22, y + 20, 20, { color: tcol, accent: s.heat > 0.2 ? RD : OR, animate: s.heat > 0.15 && this.anim, t: this.time * 2 });
    this._text(ctx, '선체 온도', x + 40, y + 25, 12, DIM);
    this._text(ctx, formatTemp(s.hullTemp), x + w - 14, y + 25, 14, tcol, 'right', 700);
    this._bar(ctx, x + 16, y + 32, w - 32, 5, s.hullTemp / 2600, hot ? RD : OR);
    // 손상
    const icol = s.integrity < 35 ? RD : s.integrity < 70 ? OR : GR;
    drawIcon(ctx, 'damage', x + 22, y + 56, 20, { color: WH, warn: icol });
    this._text(ctx, '선체 상태', x + 40, y + 61, 12, DIM);
    this._text(ctx, Math.round(s.integrity) + '%', x + w - 14, y + 61, 14, icol, 'right', 700);
    this._bar(ctx, x + 16, y + 68, w - 32, 5, s.integrity / 100, icol);
    // 시스템 토글
    const sys = [
      ['gear', '기어', s.gear], ['assist', '관성', s.fa], ['rcs', 'RCS', s.rcs > 0.05],
      [s.warp ? 'warp' : 'warpExit', '워프', s.warp], ['orbit', '궤도선', s.orbitOn], [s.view === 'cockpit' ? 'cockpit' : 'chase', '시점', true],
    ];
    const cw = (w - 16) / 6;
    sys.forEach(([ic, label, on], i) => {
      const cx = x + 8 + cw * (i + 0.5);
      drawIcon(ctx, ic, cx, y + 98, 22, { color: on ? WH : DIM, accent: on ? OR : DIM, cyan: on ? CY : DIM, glow: on ? 0.8 : 0, alpha: on ? 1 : 0.6, animate: on && this.anim && (ic === 'warp' || ic === 'rcs'), t: this.time * 1.5 });
      this._text(ctx, label, cx, y + 128, 10.5, on ? WH : DIM, 'center', 600, cw - 4);
    });
  }

  /* ------------------------------ 화면 마커 ------------------------------ */
  _markers(ctx, s) {
    const W = this.w, H = this.h, cx = W / 2, cy = H / 2;
    // 조준선
    drawIcon(ctx, 'reticle', cx, cy, 34, { color: 'rgba(233,246,255,0.75)', cyan: CY });
    // 진행 방향 (프로그레이드)
    if (s.prograde && s.prograde.on) drawIcon(ctx, 'prograde', s.prograde.x, s.prograde.y, 28, { color: GR, cyan: GR });
    if (s.retro && s.retro.on) {
      ctx.save(); ctx.globalAlpha = 0.6;
      drawIcon(ctx, 'warpExit', s.retro.x, s.retro.y, 20, { color: GR, accent: GR, dim: GR });
      ctx.restore();
    }
    // 목표 마커
    const t = s.target;
    if (t && t.screen) {
      const m = t.screen;
      if (m.on) {
        drawIcon(ctx, 'target', m.x, m.y, 30, { color: OR, accent: OR, animate: this.anim, t: this.time, glow: 1 });
        drawIcon(ctx, bodyIcon(t.body), m.x, m.y - 30, 18, { color: WH, accent: OR, cyan: CY });
        this._text(ctx, `${t.body.name} · ${formatDistance(t.dist)}`, m.x, m.y + 32, 12.5, OR, 'center', 700);
      } else {
        // 화면 밖: 가장자리 화살표
        const ang = m.ang;
        const r = Math.min(W, H) * 0.42;
        const ex = cx + Math.cos(ang) * r, ey = cy + Math.sin(ang) * r;
        drawIcon(ctx, 'arrowRight', ex, ey, 30, { color: OR, rot: ang, glow: 1 });
        this._text(ctx, t.body.name, ex - Math.cos(ang) * 30, ey - Math.sin(ang) * 30 + 4, 12, OR, 'center', 700);
      }
    }
    // 주변 천체 라벨
    if (s.labels) for (const l of s.labels) {
      drawIcon(ctx, bodyIcon(l.body), l.x, l.y, 14, { color: 'rgba(233,246,255,0.7)', accent: OR, cyan: CY, alpha: 0.85 });
      this._text(ctx, l.body.name, l.x + 11, l.y + 4, 11.5, 'rgba(233,246,255,0.75)', 'left');
    }
    // 궤도 정보
    if (s.orbitInfo) {
      const o = s.orbitInfo;
      this._text(ctx, `원지점 ${formatDistance(o.ap)} · 근지점 ${formatDistance(o.pe)}${o.period ? ' · 주기 ' + formatDuration(o.period) : ''}`, cx, H - 22 - this.insetBottom, 12.5, CY, 'center', 700);
    }
  }

  /* ------------------------------ 경고 (깜박임 1·2·3 Hz, 동작 줄이기 시 정지 발광) ------------------------------ */
  _warnings(ctx, cx, y, s) {
    if (!s.warnings || !s.warnings.length) return;
    s.warnings.slice(0, 3).forEach((wn, i) => {
      const yy = y + i * 34;
      const lvl = Math.max(1, Math.min(3, wn.level));
      const hz = lvl;   // 주의 1회/초, 위험 2회/초, 치명 3회/초 (최대 3Hz)
      const on = this.anim ? (Math.sin(this.time * Math.PI * 2 * hz) > -0.2) : true;
      const col = lvl >= 2 ? RD : OR;
      ctx.font = FONT(14, 700);
      const tw = ctx.measureText(wn.text).width + 56;
      const x = cx - tw / 2;
      ctx.save();
      ctx.globalAlpha = on ? 1 : 0.35;
      this._panel(ctx, x, yy, tw, 28, col, 1);
      if (!this.anim) { ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, yy + 1.5, tw - 3, 25); }
      drawIcon(ctx, lvl >= 2 ? 'danger' : 'warning', x + 18, yy + 14, 18, { color: col, accent: col, warn: col, glow: 1 });
      this._text(ctx, wn.text, x + 34, yy + 19, 14, col, 'left', 700);
      ctx.restore();
    });
  }

  /* ------------------------------ 이벤트 로그 ------------------------------ */
  _events(ctx, x, y, compact) {
    const list = this.events.slice(0, compact ? 3 : 5);
    list.forEach((e, i) => {
      const a = Math.min(1, (9 - e.t) / 1.5) * (e.t < 0.3 && this.anim ? e.t / 0.3 : 1);
      ctx.save();
      ctx.globalAlpha = a;
      const icon = e.kind === 'good' ? 'done' : e.kind === 'danger' || e.kind === 'destroyed' || e.kind === 'impact' ? 'danger' : e.kind === 'warn' ? 'warning' : e.kind === 'warp' ? 'warp' : 'log';
      const col = e.kind === 'danger' || e.kind === 'destroyed' || e.kind === 'impact' ? RD : e.kind === 'warn' ? OR : e.kind === 'good' ? GR : WH;
      drawIcon(ctx, icon, x + 10, y + i * 20 - 4, 14, { color: col, accent: col, warn: col, cyan: CY });
      this._text(ctx, e.text, x + 24, y + i * 20, 13, col);
      ctx.restore();
    });
  }
}

void ICON_COLORS;
