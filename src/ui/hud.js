// FREE FREELY - 비행 계기 HUD (캔버스 2D 오버레이)
import { clamp, lerp, fmt, pad, headingName, msToKnots, msToKmh, mToFt, formatTime, damp } from '../core/utils.js';
import { Settings } from '../core/settings.js';
import { MAP_HALF } from '../world/terrain.js';

const HUD_GREEN = '#7dffb0';
const HUD_CYAN = '#7fe9ff';
const HUD_AMBER = '#ffc861';
const HUD_RED = '#ff6b5e';

/** 지형 하이트맵 → 미니맵 썸네일 */
export function makeMapThumbnail(terrain, size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = -MAP_HALF + (i / (size - 1)) * MAP_HALF * 2;
      const z = -MAP_HALF + (j / (size - 1)) * MAP_HALF * 2;
      const h = terrain.heightAt(x, z);
      let r, g, b;
      if (h < 0) {
        const t = clamp(1 + h / 220, 0, 1);
        r = lerp(6, 22, t); g = lerp(20, 66, t); b = lerp(46, 96, t);
      } else if (h < 8) { r = 96; g = 92; b = 66; }
      else if (h < 500) {
        const t = clamp(h / 500, 0, 1);
        r = lerp(38, 74, t); g = lerp(72, 84, t); b = lerp(34, 48, t);
      } else if (h < 1100) {
        const t = clamp((h - 500) / 600, 0, 1);
        r = lerp(74, 104, t); g = lerp(84, 96, t); b = lerp(48, 88, t);
      } else { r = 200; g = 212; b = 226; }
      const k = (j * size + i) * 4;
      img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = 0; this.h = 0;
    this.mapThumb = null;
    this.mapZoom = 1;
    this.controlsInset = 0;   // 화면 조이스틱/스로틀이 보일 때 계기판을 위로 밀어 올린다
    this.visible = true;
    this.style = 'full';
    this.vsSmooth = 0;
    this.iasSmooth = 0;
    this.altSmooth = 0;
    this.events = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * dpr);
    this.canvas.height = Math.floor(this.h * dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
  }

  setMap(terrain) { this.mapThumb = makeMapThumbnail(terrain, 256); }

  pushEvent(e) {
    this.events.push({ ...e, t: performance.now() });
    if (this.events.length > 6) this.events.shift();
  }

  render(tele, ctx2) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.visible || !tele || tele.alt === undefined) return;
    const dt = ctx2 && ctx2.dt ? ctx2.dt : 0.016;
    this.iasSmooth = damp(this.iasSmooth, tele.ias, 0.0005, dt);
    this.altSmooth = damp(this.altSmooth, tele.alt, 0.0005, dt);
    this.vsSmooth = damp(this.vsSmooth, tele.vs, 0.002, dt);

    const imperial = Settings.get('units') === 'imperial';
    const cx = this.w / 2, cy = this.h / 2;

    ctx.save();
    ctx.font = '600 13px "Rajdhani", "Consolas", monospace';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1.4;

    this._drawHorizon(ctx, cx, cy, tele);
    this._drawSpeedTape(ctx, tele, imperial);
    this._drawAltTape(ctx, tele, imperial);
    this._drawHeadingTape(ctx, cx, tele);
    this._drawVsi(ctx, tele, imperial);
    this._drawCenterReticle(ctx, cx, cy, tele, ctx2);
    this._drawEnginePanel(ctx, tele);
    this._drawStatusPanel(ctx, tele);
    this._drawMinimap(ctx, tele, ctx2);
    this._drawWarnings(ctx, cx, tele);
    this._drawEvents(ctx);
    if (ctx2 && ctx2.mission) this._drawMission(ctx, cx, ctx2.mission);
    ctx.restore();
  }

  /* ---------------------- 인공 수평의 + 피치 래더 ---------------------- */
  _drawHorizon(ctx, cx, cy, tele) {
    const pitch = tele.pitch, roll = tele.roll;
    const pxPerDeg = this.h / 90;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-roll * Math.PI / 180);
    ctx.translate(0, pitch * pxPerDeg);
    ctx.globalAlpha = 0.92;
    ctx.strokeStyle = HUD_GREEN;
    ctx.fillStyle = HUD_GREEN;
    ctx.lineWidth = 1.6;
    // 수평선
    ctx.beginPath();
    ctx.moveTo(-this.w * 0.42, 0); ctx.lineTo(-40, 0);
    ctx.moveTo(40, 0); ctx.lineTo(this.w * 0.42, 0);
    ctx.stroke();
    ctx.font = '600 12px "Rajdhani", monospace';
    for (let d = -90; d <= 90; d += 5) {
      if (d === 0) continue;
      const y = -d * pxPerDeg;
      if (Math.abs(y) > this.h * 0.55) continue;
      const major = d % 10 === 0;
      const len = major ? 78 : 40;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      if (d < 0) ctx.setLineDash([7, 6]); else ctx.setLineDash([]);
      ctx.moveTo(-len, y); ctx.lineTo(-22, y);
      ctx.moveTo(22, y); ctx.lineTo(len, y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (major) {
        ctx.textAlign = 'right';
        ctx.fillText(String(Math.abs(d)), -len - 6, y);
        ctx.textAlign = 'left';
        ctx.fillText(String(Math.abs(d)), len + 6, y);
      }
    }
    ctx.restore();

    // 롤 스케일
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = HUD_CYAN;
    ctx.globalAlpha = 0.8;
    const R = Math.min(this.w, this.h) * 0.33;
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const rad = (a - 90) * Math.PI / 180;
      const inner = a % 30 === 0 ? R - 14 : R - 8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(rad) * R, Math.sin(rad) * R);
      ctx.lineTo(Math.cos(rad) * inner, Math.sin(rad) * inner);
      ctx.stroke();
    }
    // 롤 포인터
    ctx.rotate(-tele.roll * Math.PI / 180);
    ctx.fillStyle = Math.abs(tele.roll) > 75 ? HUD_AMBER : HUD_CYAN;
    ctx.beginPath();
    ctx.moveTo(0, -R + 2); ctx.lineTo(-7, -R + 16); ctx.lineTo(7, -R + 16);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* ------------------------------ 속도계 ------------------------------ */
  _drawSpeedTape(ctx, tele, imperial) {
    const x = 78, cy = this.h / 2, h = Math.min(320, this.h * 0.44);
    const v = imperial ? msToKnots(this.iasSmooth) : msToKmh(this.iasSmooth);
    const unit = imperial ? 'kt' : 'km/h';
    const step = imperial ? 20 : 40;
    const pxPer = h / (step * 6);
    ctx.save();
    ctx.strokeStyle = 'rgba(125,255,176,0.65)';
    ctx.fillStyle = 'rgba(4,14,12,0.32)';
    ctx.beginPath();
    ctx.roundRect(x - 52, cy - h / 2, 104, h, 6);
    ctx.fill(); ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.rect(x - 52, cy - h / 2, 104, h); ctx.clip();
    ctx.fillStyle = HUD_GREEN;
    ctx.strokeStyle = HUD_GREEN;
    const base = Math.floor(v / step) * step;
    for (let i = -4; i <= 4; i++) {
      const val = base + i * step;
      if (val < 0) continue;
      const y = cy + (v - val) * pxPer;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(x + 30, y); ctx.lineTo(x + 46, y); ctx.stroke();
      ctx.textAlign = 'right';
      ctx.font = '600 14px "Rajdhani", monospace';
      ctx.fillText(String(Math.round(val)), x + 24, y);
      for (let k = 1; k < 4; k++) {
        const yy = y + (step / 4) * k * pxPer;
        ctx.beginPath(); ctx.moveTo(x + 38, yy); ctx.lineTo(x + 46, yy); ctx.stroke();
      }
    }
    ctx.restore();
    // 현재값 박스
    ctx.fillStyle = 'rgba(6,26,20,0.9)';
    ctx.strokeStyle = tele.stall > 0.3 ? HUD_RED : HUD_GREEN;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x - 52, cy - 17, 108, 34, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = tele.stall > 0.3 ? HUD_RED : '#eafff4';
    ctx.font = '700 22px "Rajdhani", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(pad(v, 3), x + 34, cy + 1);
    ctx.font = '600 11px "Rajdhani", monospace';
    ctx.fillStyle = HUD_GREEN;
    ctx.textAlign = 'left';
    ctx.fillText(unit, x - 48, cy - 26);
    // 마하 / 실속 속도
    ctx.fillStyle = tele.mach > 0.95 ? HUD_AMBER : HUD_CYAN;
    ctx.textAlign = 'center';
    ctx.fillText('M ' + tele.mach.toFixed(2), x, cy + h / 2 + 16);
    ctx.fillStyle = HUD_CYAN;
    ctx.fillText('AOA ' + fmt(tele.aoa, 1) + '°', x, cy + h / 2 + 32);
    ctx.restore();
  }

  /* ------------------------------ 고도계 ------------------------------ */
  _drawAltTape(ctx, tele, imperial) {
    const x = this.w - 84, cy = this.h / 2, h = Math.min(320, this.h * 0.44);
    const alt = imperial ? mToFt(this.altSmooth) : this.altSmooth;
    const unit = imperial ? 'ft' : 'm';
    const step = imperial ? 500 : 200;
    const pxPer = h / (step * 6);
    ctx.save();
    ctx.strokeStyle = 'rgba(127,233,255,0.6)';
    ctx.fillStyle = 'rgba(4,12,18,0.32)';
    ctx.beginPath(); ctx.roundRect(x - 52, cy - h / 2, 108, h, 6); ctx.fill(); ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.rect(x - 52, cy - h / 2, 108, h); ctx.clip();
    ctx.fillStyle = HUD_CYAN; ctx.strokeStyle = HUD_CYAN;
    const base = Math.floor(alt / step) * step;
    for (let i = -4; i <= 4; i++) {
      const val = base + i * step;
      const y = cy + (alt - val) * pxPer;
      ctx.beginPath(); ctx.moveTo(x - 46, y); ctx.lineTo(x - 30, y); ctx.stroke();
      ctx.textAlign = 'left';
      ctx.font = '600 14px "Rajdhani", monospace';
      ctx.fillText(String(Math.round(val)), x - 24, y);
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(6,18,26,0.9)';
    ctx.strokeStyle = HUD_CYAN; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x - 56, cy - 17, 112, 34, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#eafaff';
    ctx.font = '700 22px "Rajdhani", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(pad(alt, 4), x + 40, cy + 1);
    ctx.font = '600 11px "Rajdhani", monospace';
    ctx.fillStyle = HUD_CYAN;
    ctx.textAlign = 'right';
    ctx.fillText(unit, x + 40, cy - 26);
    // 대지고도(레이더 고도)
    const agl = imperial ? mToFt(tele.agl) : tele.agl;
    ctx.textAlign = 'center';
    ctx.fillStyle = tele.agl < 60 && !tele.onGround ? HUD_AMBER : HUD_CYAN;
    ctx.fillText('RA ' + (agl < 3000 ? Math.round(agl) : '----'), x, cy + h / 2 + 16);
    ctx.fillStyle = HUD_CYAN;
    ctx.fillText(tele.surfaceType === 'water' ? '해면' : tele.surfaceType === 'deck' ? '갑판' : '지면', x, cy + h / 2 + 32);
    ctx.restore();
  }

  /* ----------------------------- 방위 테이프 ----------------------------- */
  _drawHeadingTape(ctx, cx, tele) {
    const y = 34, w = Math.min(560, this.w * 0.5);
    const hdg = tele.heading;
    const pxPerDeg = w / 90;
    ctx.save();
    ctx.fillStyle = 'rgba(6,16,22,0.35)';
    ctx.strokeStyle = 'rgba(127,233,255,0.5)';
    ctx.beginPath(); ctx.roundRect(cx - w / 2, y - 16, w, 32, 5); ctx.fill(); ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - w / 2, y - 16, w, 32); ctx.clip();
    ctx.strokeStyle = HUD_CYAN; ctx.fillStyle = HUD_CYAN;
    ctx.textAlign = 'center';
    for (let d = -50; d <= 50; d += 5) {
      const val = Math.round((hdg + d) / 5) * 5;
      const delta = val - hdg;
      const x = cx + delta * pxPerDeg;
      const major = ((val % 10) + 10) % 10 === 0;
      ctx.beginPath();
      ctx.moveTo(x, y + 12); ctx.lineTo(x, y + (major ? 2 : 7));
      ctx.stroke();
      if (major) {
        const norm = ((val % 360) + 360) % 360;
        const label = norm === 0 ? 'N' : norm === 90 ? 'E' : norm === 180 ? 'S' : norm === 270 ? 'W' : String(norm / 10);
        ctx.font = norm % 90 === 0 ? '700 14px "Rajdhani", monospace' : '600 12px "Rajdhani", monospace';
        ctx.fillText(label, x, y - 5);
      }
    }
    ctx.restore();
    ctx.fillStyle = '#eafaff';
    ctx.font = '700 15px "Rajdhani", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(pad(hdg, 3) + '° ' + headingName(hdg), cx, y + 30);
    ctx.beginPath();
    ctx.moveTo(cx, y - 16); ctx.lineTo(cx - 6, y - 24); ctx.lineTo(cx + 6, y - 24);
    ctx.closePath(); ctx.fillStyle = HUD_AMBER; ctx.fill();
    ctx.restore();
  }

  /* ---------------------------- 수직 속도계 ---------------------------- */
  _drawVsi(ctx, tele, imperial) {
    const x = this.w - 152, cy = this.h / 2, h = Math.min(240, this.h * 0.34);
    ctx.save();
    ctx.strokeStyle = 'rgba(127,233,255,0.35)';
    ctx.beginPath(); ctx.roundRect(x - 14, cy - h / 2, 28, h, 4); ctx.stroke();
    const max = 25;
    const v = clamp(this.vsSmooth, -max, max);
    const y = cy - (v / max) * (h / 2 - 6);
    ctx.fillStyle = Math.abs(v) > 12 ? HUD_AMBER : HUD_CYAN;
    ctx.fillRect(x - 12, Math.min(cy, y), 24, Math.abs(y - cy) || 1);
    ctx.strokeStyle = 'rgba(127,233,255,0.5)';
    ctx.beginPath(); ctx.moveTo(x - 14, cy); ctx.lineTo(x + 14, cy); ctx.stroke();
    ctx.fillStyle = HUD_CYAN;
    ctx.font = '600 11px "Rajdhani", monospace';
    ctx.textAlign = 'center';
    const vsTxt = imperial ? Math.round(mToFt(this.vsSmooth) * 60) + ' fpm' : this.vsSmooth.toFixed(1) + ' m/s';
    ctx.fillText(vsTxt, x, cy + h / 2 + 14);
    ctx.fillText('V/S', x, cy - h / 2 - 12);
    ctx.restore();
  }

  /* ---------------------------- 중앙 조준/기수 ---------------------------- */
  _drawCenterReticle(ctx, cx, cy, tele, ctx2) {
    ctx.save();
    ctx.strokeStyle = HUD_GREEN;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.95;
    // 기수 기준 마크
    ctx.beginPath();
    ctx.moveTo(cx - 42, cy); ctx.lineTo(cx - 14, cy);
    ctx.moveTo(cx + 14, cy); ctx.lineTo(cx + 42, cy);
    ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy - 1);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, 3.2, 0, Math.PI * 2); ctx.stroke();

    // 속도 벡터(FPV) 마커
    if (ctx2 && ctx2.fpv) {
      const p = ctx2.fpv;
      ctx.strokeStyle = HUD_CYAN;
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.moveTo(p.x - 14, p.y); ctx.lineTo(p.x - 7, p.y);
      ctx.moveTo(p.x + 7, p.y); ctx.lineTo(p.x + 14, p.y);
      ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x, p.y - 13);
      ctx.stroke();
    }
    // 무장 조준선
    if (ctx2 && ctx2.hasGuns) {
      ctx.strokeStyle = 'rgba(255,120,100,0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy, 26, 0, Math.PI * 2);
      ctx.moveTo(cx - 34, cy); ctx.lineTo(cx - 26, cy);
      ctx.moveTo(cx + 26, cy); ctx.lineTo(cx + 34, cy);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------------------------- 엔진/추력 패널 ---------------------------- */
  _drawEnginePanel(ctx, tele) {
    const x = 30, y = this.h - 190 - this.controlsInset, w = 168, h = 158;
    ctx.save();
    ctx.fillStyle = 'rgba(6,16,20,0.42)';
    ctx.strokeStyle = 'rgba(125,255,176,0.35)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = HUD_GREEN;
    ctx.font = '700 12px "Rajdhani", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('출력 / THRUST', x + 12, y + 16);

    // 스로틀 바
    const bx = x + 14, by = y + 28, bw = 26, bh = h - 54;
    ctx.strokeStyle = 'rgba(125,255,176,0.5)';
    ctx.strokeRect(bx, by, bw, bh);
    const t = clamp(tele.throttle, 0, 1);
    const grd = ctx.createLinearGradient(0, by + bh, 0, by);
    grd.addColorStop(0, '#1e6b4a');
    grd.addColorStop(0.7, HUD_GREEN);
    grd.addColorStop(1, tele.afterburner ? '#ff9a4d' : '#c8ffe0');
    ctx.fillStyle = grd;
    ctx.fillRect(bx + 1, by + bh - bh * t + 1, bw - 2, bh * t - 2);
    if (tele.afterburner) {
      ctx.fillStyle = 'rgba(255,140,60,0.85)';
      ctx.fillRect(bx + 1, by + 1, bw - 2, 10);
      ctx.fillStyle = '#2b1405';
      ctx.font = '700 9px "Rajdhani", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('A/B', bx + bw / 2, by + 6);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#d8ffe8';
    ctx.font = '700 15px "Rajdhani", monospace';
    ctx.fillText(Math.round(t * 100) + '%', bx + 40, by + 14);
    ctx.font = '600 11px "Rajdhani", monospace';
    ctx.fillStyle = HUD_CYAN;
    ctx.fillText('RPM ' + Math.round(tele.rpm * 100) + '%', bx + 40, by + 32);
    ctx.fillText('추력 ' + (tele.thrust / 1000).toFixed(1) + ' kN', bx + 40, by + 48);
    ctx.fillText('연료 ' + Math.round(tele.fuel) + ' kg', bx + 40, by + 64);
    // 연료 게이지
    const fx = bx + 40, fy = by + 74, fw = 100;
    ctx.strokeStyle = 'rgba(255,200,97,0.6)';
    ctx.strokeRect(fx, fy, fw, 8);
    ctx.fillStyle = tele.fuelPct < 0.12 ? HUD_RED : HUD_AMBER;
    ctx.fillRect(fx + 1, fy + 1, (fw - 2) * clamp(tele.fuelPct, 0, 1), 6);
    // 기체 상태
    ctx.fillStyle = tele.integrity < 40 ? HUD_RED : tele.integrity < 75 ? HUD_AMBER : HUD_GREEN;
    ctx.font = '600 11px "Rajdhani", monospace';
    ctx.fillText('기체 ' + Math.round(tele.integrity) + '%', fx, fy + 24);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.strokeRect(fx, fy + 30, fw, 8);
    ctx.fillRect(fx + 1, fy + 31, (fw - 2) * clamp(tele.integrity / 100, 0, 1), 6);
    ctx.restore();
  }

  /* ------------------------------ 상태 표시줄 ------------------------------ */
  _drawStatusPanel(ctx, tele) {
    const items = [
      ['G', tele.g.toFixed(1), Math.abs(tele.g) > 7 ? HUD_RED : Math.abs(tele.g) > 5 ? HUD_AMBER : HUD_GREEN],
      ['GEAR', tele.gear > 0.9 ? 'DOWN' : tele.gear < 0.1 ? 'UP' : '전환', tele.gear > 0.9 ? HUD_GREEN : HUD_AMBER],
      ['FLAP', Math.round(tele.flap * 100) + '%', tele.flap > 0 ? HUD_AMBER : HUD_GREEN],
      ['BRK', tele.brake > 0.5 ? 'ON' : tele.airbrake ? 'AIR' : 'OFF', tele.brake > 0.5 || tele.airbrake ? HUD_AMBER : HUD_GREEN],
      ['A/P', { off: 'OFF', level: '수평', alt: '고도', heading: '방위' }[tele.autopilot], tele.autopilot === 'off' ? HUD_GREEN : HUD_CYAN],
      ['TRIM', (tele.trim >= 0 ? '+' : '') + tele.trim.toFixed(2), HUD_GREEN],
      ['LIGHT', tele.lights ? 'ON' : 'OFF', tele.lights ? HUD_AMBER : HUD_GREEN],
      ['ENG', tele.engineOn ? 'RUN' : 'OFF', tele.engineOn ? HUD_GREEN : HUD_RED],
    ];
    if (tele.balloonLift > 0) {
      items.push(['봉투', Math.round(tele.envelopeTemp - 273) + '°C', HUD_AMBER]);
      items.push(['부력', (tele.balloonLift / 1000).toFixed(1) + 'kN', HUD_CYAN]);
    }
    if (tele.flares > 0) items.push(['FLR', String(tele.flares), HUD_GREEN]);
    if (tele.waterFill > 0.01) items.push(['침수', Math.round(tele.waterFill * 100) + '%', HUD_RED]);
    if (tele.reentry > 0.05) items.push(['열부하', Math.round(tele.reentry * 100) + '%', HUD_RED]);

    // 화면 하단 버튼 위에 가로 한 줄로 배치 (다른 계기와 겹치지 않는다)
    const cw = 86;
    const perRow = Math.max(4, Math.min(items.length, Math.floor((this.w - 420) / cw)));
    const rows = Math.ceil(items.length / perRow);
    const totalW = Math.min(items.length, perRow) * cw;
    const x0 = this.w / 2 - totalW / 2;
    const y0 = this.h - 208 - this.controlsInset - (rows - 1) * 20;
    ctx.save();
    ctx.font = '600 11px "Rajdhani", monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(6,16,20,0.42)';
    ctx.strokeStyle = 'rgba(125,255,176,0.22)';
    ctx.beginPath();
    ctx.roundRect(x0 - 8, y0 - 12, totalW + 16, rows * 20 + 6, 8);
    ctx.fill(); ctx.stroke();
    items.forEach((it, i) => {
      const r = Math.floor(i / perRow), c = i % perRow;
      const x = x0 + c * cw, y = y0 + r * 20;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(200,240,255,0.5)';
      ctx.fillText(it[0], x, y);
      ctx.fillStyle = it[2];
      ctx.fillText(it[1], x + 40, y);
    });
    ctx.restore();
  }

  /* ------------------------------- 미니맵 ------------------------------- */
  _drawMinimap(ctx, tele, ctx2) {
    if (!this.mapThumb) return;
    const size = 170;
    const x = this.w - size - 26, y = this.h - size - 30 - (this.controlsInset ? 0 : 0);
    const zoom = this.mapZoom;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 10);
    ctx.strokeStyle = 'rgba(127,233,255,0.55)';
    ctx.fillStyle = 'rgba(4,10,16,0.65)';
    ctx.fill(); ctx.stroke();
    ctx.clip();
    // 지도 스크롤
    const world = MAP_HALF * 2;
    const scale = (size / world) * zoom;
    const px = tele.position.x, pz = tele.position.z;
    ctx.translate(x + size / 2, y + size / 2);
    ctx.drawImage(this.mapThumb, -px * scale - (world / 2) * scale, -pz * scale - (world / 2) * scale, world * scale, world * scale);
    // 체크포인트 링
    if (ctx2 && ctx2.rings) {
      for (const r of ctx2.rings) {
        ctx.fillStyle = r.passed ? 'rgba(90,200,150,0.7)' : '#33ddff';
        const rx = (r.mesh.position.x - px) * scale;
        const rz = (r.mesh.position.z - pz) * scale;
        ctx.beginPath(); ctx.arc(rx, rz, 3.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    // 활주로
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo((-900 - px) * scale, (0 - pz) * scale);
    ctx.lineTo((900 - px) * scale, (0 - pz) * scale);
    ctx.stroke();
    // 자기 기체
    ctx.rotate(tele.heading * Math.PI / 180);
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(5.5, 7); ctx.lineTo(0, 4); ctx.lineTo(-5.5, 7);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.font = '600 10px "Rajdhani", monospace';
    ctx.fillStyle = 'rgba(200,240,255,0.7)';
    ctx.textAlign = 'left';
    ctx.fillText('X ' + Math.round(tele.position.x) + '  Z ' + Math.round(tele.position.z), x + 8, y - 8);
    ctx.textAlign = 'right';
    ctx.fillText('×' + zoom.toFixed(1) + ' (Z키)', x + size - 8, y - 8);
    ctx.restore();
  }

  /* ------------------------------- 경고 ------------------------------- */
  _drawWarnings(ctx, cx, tele) {
    if (!tele.warnings || !tele.warnings.length) return;
    const blink = (performance.now() % 700) < 380;
    ctx.save();
    ctx.textAlign = 'center';
    tele.warnings.slice(0, 4).forEach((w, i) => {
      const y = this.h / 2 + 120 + i * 30;
      ctx.font = '700 20px "Rajdhani", monospace';
      ctx.fillStyle = blink ? HUD_RED : 'rgba(255,107,94,0.45)';
      ctx.fillText(w.code + '  ' + w.text, cx, y);
    });
    ctx.restore();
  }

  _drawEvents(ctx) {
    const now = performance.now();
    ctx.save();
    ctx.textAlign = 'left';
    ctx.font = '600 13px "Rajdhani", monospace';
    let i = 0;
    for (let k = this.events.length - 1; k >= 0; k--) {
      const e = this.events[k];
      const age = (now - e.t) / 1000;
      if (age > 6) continue;
      const a = clamp(1 - (age - 4.5) / 1.5, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = e.kind === 'bad' ? HUD_RED : e.kind === 'good' ? HUD_GREEN : e.kind === 'warn' ? HUD_AMBER : '#dceaf4';
      ctx.fillText('▸ ' + e.text, 30, this.h - 214 - this.controlsInset - i * 19);
      i++;
    }
    ctx.restore();
  }

  _drawMission(ctx, cx, m) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 15px "Rajdhani", monospace';
    ctx.fillStyle = HUD_CYAN;
    ctx.fillText(m.title, cx, 86);
    ctx.font = '600 13px "Rajdhani", monospace';
    ctx.fillStyle = '#dceaf4';
    ctx.fillText(m.subtitle, cx, 106);
    if (m.time !== undefined) {
      ctx.font = '700 22px "Rajdhani", monospace';
      ctx.fillStyle = HUD_AMBER;
      ctx.fillText(formatTime(m.time), cx, 134);
    }
    ctx.restore();
  }
}
