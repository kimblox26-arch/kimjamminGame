// 2D 지도: 해안선·섬·강·노선·역·도시, 열차 위치. 끌기/휠/두 손가락으로 이동·확대
import { toXZ } from './geo.js';
import { CITIES, PEAKS } from './data/places.js';

export class MapView {
  constructor(canvas, terrain, net, geo, { interactive = true } = {}) {
    this.cv = canvas; this.g = canvas.getContext('2d'); this.T = terrain; this.net = net;
    this.cx = 0; this.cz = -60000; this.mpp = 900; this.follow = false;
    this.coast = new Path2D();
    for (const r of geo.coast) { for (let i = 0; i < r.length; i += 2) { const [x, z] = toXZ(r[i + 1], r[i]); i ? this.coast.lineTo(x, z) : this.coast.moveTo(x, z); } this.coast.closePath(); }
    this.rivers = terrain.rivers.map(r => { const p = new Path2D(); r.pts.forEach(([la, lo], i) => { const [x, z] = toXZ(la, lo); i ? p.lineTo(x, z) : p.moveTo(x, z); }); return { p, w: r.w }; });
    this.paths = net.lines.map(L => { const p = new Path2D(), k = Math.max(1, Math.round(60 / L.ds)); for (let i = 0; i < L.n; i += k) i ? p.lineTo(L.x[i], L.z[i]) : p.moveTo(L.x[i], L.z[i]); p.lineTo(L.x[L.n - 1], L.z[L.n - 1]); return { L, p }; });
    this.cities = CITIES.map(([n, la, lo, r]) => { const [x, z] = toXZ(la, lo); return { n, x, z, r }; });
    this.peaks = PEAKS.map(([n, la, lo, h]) => { const [x, z] = toXZ(la, lo); return { n, x, z, h }; });
    this.interactive = interactive;
    if (interactive) this.bind();
  }
  bind() {
    const cv = this.cv; let drag = null, pinch = null;
    const pt = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', e => { drag = pt(e); this.follow = false; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (!drag || pinch) return; const p = pt(e); this.cx -= (p[0] - drag[0]) * this.mpp; this.cz -= (p[1] - drag[1]) * this.mpp; drag = p; });
    cv.addEventListener('pointerup', () => drag = null);
    cv.addEventListener('wheel', e => { e.preventDefault(); this.zoomAt(pt(e), Math.exp(e.deltaY * 0.0015)); }, { passive: false });
    cv.addEventListener('touchstart', e => { if (e.touches.length === 2) pinch = this.dist(e.touches); }, { passive: true });
    cv.addEventListener('touchmove', e => { if (e.touches.length === 2 && pinch) { const d = this.dist(e.touches); this.zoomAt([cv.clientWidth / 2, cv.clientHeight / 2], pinch / d); pinch = d; } }, { passive: true });
    cv.addEventListener('touchend', () => pinch = null);
  }
  dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
  zoomAt([px, py], f) {
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    const wx = this.cx + (px - w / 2) * this.mpp, wz = this.cz + (py - h / 2) * this.mpp;
    this.mpp = Math.min(2500, Math.max(2, this.mpp * f));
    this.cx = wx - (px - w / 2) * this.mpp; this.cz = wz - (py - h / 2) * this.mpp;
  }
  fit(x0, z0, x1, z1) { const w = this.cv.clientWidth || 300, h = this.cv.clientHeight || 300; this.cx = (x0 + x1) / 2; this.cz = (z0 + z1) / 2; this.mpp = Math.max((x1 - x0) / w, (z1 - z0) / h) * 1.15 + 2; }
  drawBase(g, w, h, hl, route) {
    const s = 1 / this.mpp;
    g.fillStyle = '#0b1c2a'; g.fillRect(0, 0, w, h);
    const W = (x, z) => [(x - this.cx) * s + w / 2, (z - this.cz) * s + h / 2];
    g.save(); g.translate(w / 2, h / 2); g.scale(s, s); g.translate(-this.cx, -this.cz);
    g.fillStyle = '#1d2c24'; g.fill(this.coast); g.strokeStyle = '#3d5a4c'; g.lineWidth = 1.2 * this.mpp; g.stroke(this.coast);
    g.strokeStyle = '#1f4864'; g.lineCap = g.lineJoin = 'round';
    for (const r of this.rivers) { g.lineWidth = Math.max(r.w, 1.4 * this.mpp); g.stroke(r.p); }
    for (const { L, p } of this.paths) {
      const on = !hl || L.id === hl;
      g.strokeStyle = on ? L.color : '#4b5a63'; g.globalAlpha = on ? 1 : 0.45;
      g.lineWidth = (L.type === 'hsr' ? 3.2 : L.type === 'rail' ? 2.4 : 2.2) * this.mpp * (L.id === hl ? 1.6 : 1); g.stroke(p);
    }
    g.globalAlpha = 1; g.restore();
    // 도시·산 이름
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (this.mpp > 60) {
      g.font = '600 12px "Noto Sans KR",sans-serif';
      for (const c of this.cities) { if (c.r < 4.5 && this.mpp > 400) continue; const [x, y] = W(c.x, c.z); g.fillStyle = 'rgba(230,236,240,.75)'; g.fillText(c.n, x, y); }
      g.font = '11px "Noto Sans KR",sans-serif'; g.fillStyle = 'rgba(160,190,150,.6)';
      if (this.mpp < 500) for (const p of this.peaks) { if (p.h < 600 && this.mpp > 150) continue; const [x, y] = W(p.x, p.z); g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 4, y + 2); g.lineTo(x - 4, y + 2); g.fill(); g.fillText(p.n, x, y + 11); }
    }
    // 역
    const showSt = this.mpp < 140, label = this.mpp < 35;
    if (showSt) {
      g.font = '600 11px "Noto Sans KR",sans-serif';
      const seen = new Set();
      for (const L of this.net.lines) {
        if (hl && L.id !== hl && this.mpp > 60) continue;
        for (const st of L.stations) {
          const [x, y] = W(st.x, st.z); if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
          g.fillStyle = '#fff'; g.strokeStyle = L.color; g.lineWidth = 2; g.beginPath(); g.arc(x, y, label ? 4.5 : 3, 0, 7); g.fill(); g.stroke();
          const key = st.name + Math.round(st.x / 300) + Math.round(st.z / 300);
          if ((label || L.type === 'hsr' || (hl === L.id && this.mpp < 90)) && !seen.has(key)) { seen.add(key); g.fillStyle = '#e8eef2'; g.fillText(st.name, x, y - 11); }
        }
      }
    } else if (hl) {
      const L = this.net.byId[hl];
      for (const st of L.stations) { const [x, y] = W(st.x, st.z); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill(); }
    }
    if (route) for (const [i, st] of [[0, route[0]], [1, route[1]]]) {
      if (!st) continue; const [x, y] = W(st.x, st.z);
      g.fillStyle = i ? '#ff6b4a' : '#4ad08a'; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
      g.font = '700 13px "Noto Sans KR",sans-serif'; g.fillStyle = '#fff'; g.fillText((i ? '도착 ' : '출발 ') + st.name, x, y - 16);
    }
  }
  draw({ train, hl, route } = {}) {
    const cv = this.cv, dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; this.key = null; }
    if (train && this.follow) { this.cx = train.x; this.cz = train.z; }
    const g = this.g;
    // 바탕 지도는 캐시해 두고, 화면 밖으로 많이 벗어나거나 확대가 바뀔 때만 다시 그린다
    const M = this.margin = train && !this.interactive ? 1 : 0;
    const cw = w * (1 + 2 * M), ch = h * (1 + 2 * M);
    const key = [this.mpp, hl, route?.[0]?.name, route?.[1]?.name, w, h].join('|');
    const off = this.base ? [(this.cx - this.base.cx) / this.mpp, (this.cz - this.base.cz) / this.mpp] : [1e9, 1e9];
    if (key !== this.key || Math.abs(off[0]) > w * M * 0.8 + (M ? 0 : 0.01) || Math.abs(off[1]) > h * M * 0.8 + (M ? 0 : 0.01)) {
      this.key = key; this.base = { cx: this.cx, cz: this.cz };
      if (!this.cache) this.cache = document.createElement('canvas');
      this.cache.width = cw * dpr; this.cache.height = ch * dpr;
      const cg = this.cache.getContext('2d'); cg.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.drawBase(cg, cw, ch, hl, route);
    }
    const ox = (this.cx - this.base.cx) / this.mpp, oy = (this.cz - this.base.cz) / this.mpp;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#0b1c2a'; g.fillRect(0, 0, cv.width, cv.height);
    g.drawImage(this.cache, (-w * M - ox) * dpr, (-h * M - oy) * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = 1 / this.mpp, W = (x, z) => [(x - this.cx) * s + w / 2, (z - this.cz) * s + h / 2];
    // 열차
    if (train) {
      const [x, y] = W(train.x, train.z);
      g.save(); g.translate(x, y); g.rotate(train.hd);
      g.fillStyle = '#ffd23f'; g.strokeStyle = '#1a1a1a'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(11, 0); g.lineTo(-7, -7); g.lineTo(-3, 0); g.lineTo(-7, 7); g.closePath(); g.fill(); g.stroke(); g.restore();
      g.strokeStyle = 'rgba(255,210,63,.5)'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 14 + (performance.now() / 60) % 10, 0, 7); g.stroke();
    }
    // 축척
    const bar = niceBar(this.mpp * 120);
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(14, h - 18, bar / this.mpp, 3);
    g.font = '11px sans-serif'; g.textAlign = 'left'; g.fillText(bar >= 1000 ? bar / 1000 + ' km' : bar + ' m', 14, h - 28);
  }
}
function niceBar(m) { const p = Math.pow(10, Math.floor(Math.log10(m))); for (const k of [5, 2, 1]) if (k * p <= m) return k * p; return p; }
