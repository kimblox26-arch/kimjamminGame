// SpaceSim — 2D 오버레이 (라벨 · 스케일바) 및 도표 렌더러

import { fmt, fmtBig } from '../core/constants.js';

export class Overlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.showLabels = true;
    this.p = [0, 0, 0];
  }

  resize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
  }

  draw(sim, view, state) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    if (this.showLabels) this._labels(sim, view, state);
    this._scaleBar(view, state);
    if (state.selected >= 0 && sim.active[state.selected]) this._reticle(sim, view, state.selected);
  }

  _labels(sim, view, state) {
    const ctx = this.ctx;
    ctx.font = '600 11px Rajdhani, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const drawn = [];
    const limit = sim.activeCount() > 400 ? 24 : 90;
    let n = 0;
    for (let i = 0; i < sim.count && n < limit; i++) {
      if (!sim.active[i]) continue;
      const m = sim.meta[i];
      if (m.type === 'dust' && i !== state.selected && i !== view.focusIndex) continue;
      const i3 = i * 3;
      const p = view.project(sim.pos[i3], sim.pos[i3 + 1], sim.pos[i3 + 2], this.p);
      if (p[2] > 1 || p[0] < -60 || p[0] > this.w + 60 || p[1] < -20 || p[1] > this.h + 20) continue;
      // 라벨 겹침 회피
      let clash = false;
      for (const d of drawn) {
        if (Math.abs(d[0] - p[0]) < 68 && Math.abs(d[1] - p[1]) < 13) { clash = true; break; }
      }
      if (clash && i !== state.selected && i !== view.focusIndex) continue;
      drawn.push([p[0], p[1]]);
      n++;

      const sel = i === state.selected;
      const foc = i === view.focusIndex;
      ctx.fillStyle = sel ? '#7de2ff' : foc ? '#7dffb0' : 'rgba(210,232,248,0.72)';
      ctx.beginPath();
      ctx.arc(p[0], p[1], 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(m.name, p[0] + 7, p[1] - 7);
    }
  }

  _reticle(sim, view, i) {
    const ctx = this.ctx;
    const i3 = i * 3;
    const p = view.project(sim.pos[i3], sim.pos[i3 + 1], sim.pos[i3 + 2], this.p);
    if (p[2] > 1) return;
    ctx.strokeStyle = 'rgba(125,226,255,0.85)';
    ctx.lineWidth = 1;
    const r = 16;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      ctx.moveTo(p[0] + Math.cos(a) * r * 0.6, p[1] + Math.sin(a) * r * 0.6);
      ctx.lineTo(p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
    ctx.globalAlpha = 0.35;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  _scaleBar(view, state) {
    const ctx = this.ctx;
    const unit = state.lengthUnit || 'AU';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pxPerWorld = view.pointMat.uniforms.uPixelScale.value / dpr / view.spherical.radius;
    if (!isFinite(pxPerWorld) || pxPerWorld <= 0) return;

    // 화면상 ~120 px 에 가까운 '깔끔한' 길이를 고른다
    let L = 120 / pxPerWorld;
    const e = Math.floor(Math.log10(L));
    const m = L / Math.pow(10, e);
    L = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * Math.pow(10, e);
    const px = L * pxPerWorld;

    // 렌더 길이 L 에 대응하는 실제 거리
    const real = view.scaleMode === 'log'
      ? view.logRef * (Math.pow(10, L / view.logK()) - 1)
      : L / view.unit;

    const x = 18, y = this.h - 26;
    ctx.strokeStyle = 'rgba(160,205,235,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + px, y);
    ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
    ctx.moveTo(x + px, y - 4); ctx.lineTo(x + px, y + 4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(200,228,246,0.8)';
    ctx.font = '600 11px Rajdhani, system-ui, sans-serif';
    ctx.fillText(`${fmtBig(real, 3)} ${unit}${view.scaleMode === 'log' ? ' (로그 눈금)' : ''}`, x, y - 12);
  }
}

// ───────────────────────── 도표 ─────────────────────────

function setupCanvas(cv) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = cv.clientWidth || 320, h = cv.clientHeight || 160;
  if (cv.width !== w * dpr || cv.height !== h * dpr) {
    cv.width = w * dpr; cv.height = h * dpr;
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function axes(ctx, w, h, pad, opts = {}) {
  ctx.strokeStyle = 'rgba(125,200,240,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b);
  ctx.fillStyle = 'rgba(190,220,240,0.65)';
  ctx.font = '600 10px Rajdhani, system-ui, sans-serif';
  if (opts.xlabel) {
    ctx.textAlign = 'center';
    ctx.fillText(opts.xlabel, (pad.l + w - pad.r) / 2, h - 3);
  }
  if (opts.ylabel) {
    ctx.save();
    ctx.translate(9, (pad.t + h - pad.b) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText(opts.ylabel, 0, 0);
    ctx.restore();
  }
  ctx.textAlign = 'left';
}

/** 보존량 오차 시계열 (로그 y축) */
export function drawConservation(cv, series) {
  const { ctx, w, h } = setupCanvas(cv);
  const pad = { l: 46, r: 8, t: 10, b: 18 };
  axes(ctx, w, h, pad, { xlabel: '적분 스텝', ylabel: '상대오차' });
  if (!series.length) return;
  const lo = -16, hi = 0;
  const X = (i) => pad.l + (i / Math.max(1, series.length - 1)) * (w - pad.l - pad.r);
  const Y = (v) => {
    const e = Math.log10(Math.max(v, 1e-16));
    return pad.t + (1 - (e - lo) / (hi - lo)) * (h - pad.t - pad.b);
  };
  for (let e = lo; e <= hi; e += 4) {
    const y = Y(Math.pow(10, e));
    ctx.strokeStyle = 'rgba(125,200,240,0.12)';
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillStyle = 'rgba(190,220,240,0.5)';
    ctx.fillText(`1e${e}`, 16, y + 3);
  }
  const plot = (key, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    series.forEach((s, i) => (i ? ctx.lineTo(X(i), Y(s[key])) : ctx.moveTo(X(i), Y(s[key]))));
    ctx.stroke();
  };
  plot('energy', '#ff9a5c');
  plot('angular', '#7de2ff');
  ctx.fillStyle = '#ff9a5c'; ctx.fillText('ΔE/E', w - 60, pad.t + 10);
  ctx.fillStyle = '#7de2ff'; ctx.fillText('ΔL/L', w - 60, pad.t + 22);
}

/** HR 도표 */
export function drawHR(cv, track, catalog, marker) {
  const { ctx, w, h } = setupCanvas(cv);
  const pad = { l: 36, r: 10, t: 12, b: 22 };
  const Tlo = Math.log10(2000), Thi = Math.log10(45000);
  const Llo = -5, Lhi = 6.4;
  const X = (T) => pad.l + (1 - (Math.log10(T) - Tlo) / (Thi - Tlo)) * (w - pad.l - pad.r);
  const Y = (L) => pad.t + (1 - (Math.log10(L) - Llo) / (Lhi - Llo)) * (h - pad.t - pad.b);
  axes(ctx, w, h, pad, { xlabel: '유효온도 T_eff [K] →  낮아짐', ylabel: 'log L / L☉' });

  ctx.font = '600 9px Rajdhani, system-ui, sans-serif';
  for (const T of [30000, 10000, 7500, 6000, 5200, 3700, 2400]) {
    const x = X(T);
    ctx.strokeStyle = 'rgba(125,200,240,0.1)';
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
    ctx.fillStyle = 'rgba(190,220,240,0.45)';
    ctx.fillText((T / 1000) + 'k', x - 8, h - pad.b + 11);
  }
  for (let e = Llo + 1; e <= Lhi; e += 2) {
    const y = Y(Math.pow(10, e));
    ctx.strokeStyle = 'rgba(125,200,240,0.1)';
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillStyle = 'rgba(190,220,240,0.45)';
    ctx.fillText(String(e), 6, y + 3);
  }

  // 주계열
  ctx.lineWidth = 6;
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  track.forEach((p, i) => (i ? ctx.lineTo(X(p.T), Y(p.L)) : ctx.moveTo(X(p.T), Y(p.L))));
  ctx.strokeStyle = '#7de2ff';
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  track.forEach((p, i) => (i ? ctx.lineTo(X(p.T), Y(p.L)) : ctx.moveTo(X(p.T), Y(p.L))));
  ctx.strokeStyle = 'rgba(200,235,255,0.85)';
  ctx.stroke();

  // 카탈로그 별
  ctx.font = '600 9px Rajdhani, system-ui, sans-serif';
  for (const s of catalog) {
    const x = X(s.T), y = Y(s.L);
    if (x < pad.l || x > w - pad.r || y < pad.t || y > h - pad.b) continue;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(190,220,240,0.55)';
    ctx.fillText(s.name, x + 4, y - 4);
  }

  if (marker) {
    const x = X(marker.T), y = Y(marker.L);
    ctx.strokeStyle = '#ffd76b';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y);
    ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10);
    ctx.stroke();
  }
}

/** 척도인자 a(t) 이력 */
export function drawScaleFactor(cv, models) {
  const { ctx, w, h } = setupCanvas(cv);
  const pad = { l: 34, r: 10, t: 12, b: 20 };
  const tMax = 32, aMax = 4;
  const X = (t) => pad.l + (t / tMax) * (w - pad.l - pad.r);
  const Y = (a) => pad.t + (1 - a / aMax) * (h - pad.t - pad.b);
  axes(ctx, w, h, pad, { xlabel: '우주 나이 [Gyr]', ylabel: '척도인자 a' });
  for (let t = 0; t <= tMax; t += 8) {
    ctx.strokeStyle = 'rgba(125,200,240,0.1)';
    ctx.beginPath(); ctx.moveTo(X(t), pad.t); ctx.lineTo(X(t), h - pad.b); ctx.stroke();
    ctx.fillStyle = 'rgba(190,220,240,0.45)';
    ctx.fillText(String(t), X(t) + 2, h - pad.b + 10);
  }
  for (let a = 1; a <= aMax; a++) {
    ctx.strokeStyle = a === 1 ? 'rgba(255,215,107,0.3)' : 'rgba(125,200,240,0.1)';
    ctx.beginPath(); ctx.moveTo(pad.l, Y(a)); ctx.lineTo(w - pad.r, Y(a)); ctx.stroke();
    ctx.fillStyle = 'rgba(190,220,240,0.45)';
    ctx.fillText(String(a), 8, Y(a) + 3);
  }
  models.forEach((m) => {
    ctx.strokeStyle = m.color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    let started = false;
    for (const p of m.pts) {
      if (p.t < 0 || p.t > tMax || p.a > aMax) continue;
      started ? ctx.lineTo(X(p.t), Y(p.a)) : (ctx.moveTo(X(p.t), Y(p.a)), started = true);
    }
    ctx.stroke();
  });
  ctx.font = '600 10px Rajdhani, system-ui, sans-serif';
  models.forEach((m, i) => {
    ctx.fillStyle = m.color;
    ctx.fillText(m.name, pad.l + 8, pad.t + 12 + i * 12);
  });
}

/** 거리-적색편이 관계 */
export function drawDistances(cv, cosmo) {
  const { ctx, w, h } = setupCanvas(cv);
  const pad = { l: 40, r: 10, t: 12, b: 20 };
  const zMax = 8, dMax = 40000;
  const X = (z) => pad.l + (z / zMax) * (w - pad.l - pad.r);
  const Y = (d) => pad.t + (1 - d / dMax) * (h - pad.t - pad.b);
  axes(ctx, w, h, pad, { xlabel: '적색편이 z', ylabel: '거리 [Mpc]' });
  const curves = [
    { key: 'luminosityDistance', name: '광도거리 D_L', color: '#ff9a5c' },
    { key: 'transverseComoving', name: '공변거리 D_C', color: '#7de2ff' },
    { key: 'angularDiameterDistance', name: '각지름거리 D_A', color: '#7dffb0' },
  ];
  for (const c of curves) {
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const z = (i / 80) * zMax;
      const d = Math.min(dMax, cosmo[c.key](z));
      i ? ctx.lineTo(X(z), Y(d)) : ctx.moveTo(X(z), Y(d));
    }
    ctx.stroke();
  }
  ctx.font = '600 10px Rajdhani, system-ui, sans-serif';
  curves.forEach((c, i) => {
    ctx.fillStyle = c.color;
    ctx.fillText(c.name, pad.l + 8, pad.t + 12 + i * 12);
  });
  for (let z = 2; z <= zMax; z += 2) {
    ctx.fillStyle = 'rgba(190,220,240,0.45)';
    ctx.fillText(String(z), X(z), h - pad.b + 11);
  }
}

/** 간단한 막대/값 표시용 스파크라인 */
export function drawSpark(cv, values, color = '#7de2ff') {
  const { ctx, w, h } = setupCanvas(cv);
  if (!values.length) return;
  let lo = Infinity, hi = -Infinity;
  for (const v of values) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (hi - lo < 1e-30) { hi = lo + 1; }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - 2 - ((v - lo) / (hi - lo)) * (h - 4);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
  ctx.fillStyle = 'rgba(190,220,240,0.55)';
  ctx.font = '600 9px Rajdhani, system-ui, sans-serif';
  ctx.fillText(fmt(hi, 3), 2, 9);
  ctx.fillText(fmt(lo, 3), 2, h - 2);
}
