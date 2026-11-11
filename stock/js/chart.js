// 그래프: 선 그래프(누르면 가격 표시), 작은 선 그래프, 원 그래프
const dirOf = (a, b) => (b > a ? 'up' : b < a ? 'down' : 'flat');
let gid = 0;

export function lineChart(el, vals, o = {}) {
  if (!vals.length) vals = [0];
  if (vals.length < 2) vals = [vals[0], vals[0]];
  const W = Math.max(240, el.clientWidth || 320);
  const H = Math.max(160, el.clientHeight || 220);
  const pl = 6, pr = 70, pt = 16, pb = 26;
  const iw = W - pl - pr, ih = H - pt - pb;
  let mn = Math.min(...vals), mx = Math.max(...vals);
  if (mx === mn) { mx += Math.max(1, mx * 0.01); mn -= Math.max(1, mn * 0.01); }
  const pad = (mx - mn) * 0.12, lo = mn - pad, hi = mx + pad;
  const n = vals.length;
  const X = i => pl + (i / (n - 1)) * iw;
  const Y = v => pt + (1 - (v - lo) / (hi - lo)) * ih;
  const dir = dirOf(vals[0], vals[n - 1]);
  const f = o.fmt || (v => Math.round(v).toLocaleString('ko-KR'));
  const id = 'lg' + (++gid);
  let line = '';
  vals.forEach((v, i) => { line += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); });
  const area = `${line}L${X(n - 1).toFixed(1)} ${pt + ih}L${pl} ${pt + ih}Z`;
  const iMax = vals.indexOf(Math.max(...vals)), iMin = vals.indexOf(Math.min(...vals));
  const grid = [mx, (mx + mn) / 2, mn].map(v => `<line class="grid" x1="${pl}" x2="${pl + iw}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${pl + iw + 8}" y="${Y(v) + 4}">${f(v)}</text>`).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="${dir}" role="img" aria-label="주가 그래프">
<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".22"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
${grid}
<line class="base" x1="${pl}" x2="${pl + iw}" y1="${Y(vals[0])}" y2="${Y(vals[0])}"/>
<path d="${area}" fill="url(#${id})"/>
<path class="ln" d="${line}" stroke="currentColor"/>
<circle cx="${X(iMax)}" cy="${Y(vals[iMax])}" r="3.5" class="mk-hi"/><circle cx="${X(iMin)}" cy="${Y(vals[iMin])}" r="3.5" class="mk-lo"/>
<circle cx="${X(n - 1)}" cy="${Y(vals[n - 1])}" r="5" fill="currentColor" stroke="var(--card)" stroke-width="2"/>
<text class="ax" x="${pl}" y="${H - 6}">${o.xl || ''}</text><text class="ax" x="${pl + iw}" y="${H - 6}" text-anchor="end">${o.xr || ''}</text>
<g class="hov"></g></svg>`;
  el._c = { vals, X, Y, n, pl, iw, pt, ih, W, f, label: o.label };
  el._draw = drawHover;
  if (!el._bound) bindHover(el);
  if (el._hi != null) drawHover(el);
}

function bindHover(el) {
  el._bound = true;
  const pick = e => {
    const c = el._c; if (!c) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) * (c.W / r.width);
    el._hi = Math.max(0, Math.min(c.n - 1, Math.round(((x - c.pl) / c.iw) * (c.n - 1))));
    el._draw(el);
  };
  el.addEventListener('pointermove', pick);
  el.addEventListener('pointerdown', pick);
  el.addEventListener('pointerleave', () => { el._hi = null; el._draw(el); });
}

function drawHover(el) {
  const c = el._c, g = el.querySelector('.hov');
  let tip = el.querySelector('.tip');
  if (el._hi == null || !c || !g) { if (g) g.innerHTML = ''; if (tip) tip.remove(); return; }
  const i = Math.min(el._hi, c.n - 1), x = c.X(i), y = c.Y(c.vals[i]);
  g.innerHTML = `<line x1="${x}" x2="${x}" y1="${c.pt}" y2="${c.pt + c.ih}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3"/><circle cx="${x}" cy="${y}" r="6" fill="var(--card)" stroke="currentColor" stroke-width="3"/>`;
  if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; el.appendChild(tip); }
  tip.innerHTML = `<b>${c.f(c.vals[i])}</b><span>${c.label ? c.label(i) : ''}</span>`;
  const r = el.getBoundingClientRect();
  const px = (x / c.W) * r.width;
  tip.style.left = Math.max(70, Math.min(r.width - 70, px)) + 'px';
}

export function spark(vals, w = 88, h = 34) {
  if (vals.length < 2) vals = [vals[0] || 0, vals[0] || 0];
  let mn = Math.min(...vals), mx = Math.max(...vals);
  if (mx === mn) { mx += 1; mn -= 1; }
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * w).toFixed(1)},${(3 + (1 - (v - mn) / (mx - mn)) * (h - 6)).toFixed(1)}`).join(' ');
  const by = (3 + (1 - (vals[0] - mn) / (mx - mn)) * (h - 6)).toFixed(1);
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="spark ${dirOf(vals[0], vals[vals.length - 1])}" aria-hidden="true"><line x1="0" x2="${w}" y1="${by}" y2="${by}" class="base" vector-effect="non-scaling-stroke"/><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}

// parts: [{v, color}]
export function donut(parts, size = 168, thick = 28) {
  const total = parts.reduce((s, p) => s + p.v, 0) || 1;
  const r = (size - thick) / 2, C = 2 * Math.PI * r, cx = size / 2;
  let acc = 0, segs = '';
  const live = parts.filter(p => p.v > 0);
  for (const p of live) {
    const len = (p.v / total) * C;
    const gap = live.length > 1 ? Math.min(2, len / 3) : 0;
    segs += `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${p.color}" stroke-width="${thick}" stroke-dasharray="${Math.max(0, len - gap).toFixed(2)} ${(C - len + gap).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 ${cx} ${cx})"/>`;
    acc += len;
  }
  return `<svg class="donut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--soft)" stroke-width="${thick}"/>${segs}</svg>`;
}

// 캔들 차트: 막대 하나에 시가, 고가, 저가, 종가를 그리고 아래에 거래량을 그려요
export function candleChart(el, cs, o = {}) {
  if (!cs.length) { el.innerHTML = ''; return; }
  const W = Math.max(260, el.clientWidth || 400), H = Math.max(120, el.clientHeight || 300);
  const pl = 4, pr = 66, pt = 12, pb = 22, gap = 10;
  const volH = Math.round(Math.min((H - pt - pb) * 0.18, 80)), ph = H - pt - pb - volH - gap;
  const n = cs.length, iw = W - pl - pr, slot = iw / n, bw = Math.max(1.6, Math.min(16, slot * 0.64));
  let mn = Math.min(...cs.map(c => c[2])), mx = Math.max(...cs.map(c => c[1]));
  if (mx === mn) { mx += 1; mn -= 1; }
  const pad = (mx - mn) * 0.08, lo = mn - pad, hi = mx + pad;
  const Y = v => pt + (1 - (v - lo) / (hi - lo)) * ph;
  const X = i => pl + slot * (i + 0.5);
  const vmax = Math.max(1, ...cs.map(c => c[4])), vb = pt + ph + gap + volH;
  const f = o.fmt || (v => Math.round(v).toLocaleString('ko-KR'));
  let g = '';
  for (let k = 0; k <= 3; k++) { const v = mn + ((mx - mn) * k) / 3; g += `<line class="grid" x1="${pl}" x2="${pl + iw}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${pl + iw + 6}" y="${Y(v) + 4}">${f(v)}</text>`; }
  g += `<line class="grid" x1="${pl}" x2="${pl + iw}" y1="${vb}" y2="${vb}"/><text class="ax" x="${pl + iw + 6}" y="${vb - volH + 10}">거래량</text>`;
  let body = '';
  cs.forEach((c, i) => {
    const d = c[3] > c[0] ? 'up' : c[3] < c[0] ? 'down' : 'flat', x = X(i);
    const y1 = Y(Math.max(c[0], c[3])), y2 = Y(Math.min(c[0], c[3])), vh = (c[4] / vmax) * volH;
    body += `<g class="cd ${d}"><line x1="${x}" x2="${x}" y1="${Y(c[1])}" y2="${Y(c[2])}"/><rect x="${x - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(1.2, y2 - y1)}"/><rect class="vb" x="${x - bw / 2}" y="${vb - vh}" width="${bw}" height="${vh}"/></g>`;
  });
  const ma = k => { let d = '', sum = 0; cs.forEach((c, i) => { sum += c[3]; if (i >= k) sum -= cs[i - k][3]; if (i >= k - 1) d += (d ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(sum / k).toFixed(1); }); return d; };
  const last = cs[n - 1][3], ly = Y(last), ld = cs[n - 1][3] >= (o.base ?? cs[n - 1][0]) ? 'up' : 'down';
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="캔들 차트">${g}${body}
${o.ma ? `<path class="ma5" d="${ma(5)}"/><path class="ma20" d="${ma(20)}"/>` : ''}
<line class="nowline ${ld}" x1="${pl}" x2="${pl + iw}" y1="${ly}" y2="${ly}"/><rect class="nowtag ${ld}" x="${pl + iw + 2}" y="${ly - 10}" width="${pr - 4}" height="20" rx="4"/><text class="nowtxt" x="${pl + iw + pr / 2}" y="${ly + 4}" text-anchor="middle">${f(last)}</text>
<text class="ax" x="${pl}" y="${H - 6}">${o.xl || ''}</text><text class="ax" x="${pl + iw}" y="${H - 6}" text-anchor="end">${o.xr || ''}</text><g class="hov"></g></svg>`;
  el._c = { cs, X, n, pl, iw, W, pt, H: vb, f, label: o.label };
  el._draw = drawCandleHover;
  if (!el._bound) bindHover(el);
  if (el._hi != null) drawCandleHover(el);
}

function drawCandleHover(el) {
  const c = el._c, g = el.querySelector('.hov');
  let tip = el.querySelector('.tip');
  if (el._hi == null || !c || !g) { if (g) g.innerHTML = ''; if (tip) tip.remove(); return; }
  const i = Math.min(el._hi, c.n - 1), x = c.X(i), k = c.cs[i];
  g.innerHTML = `<line x1="${x}" x2="${x}" y1="${c.pt}" y2="${c.H}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3"/>`;
  if (!tip) { tip = document.createElement('div'); tip.className = 'tip ctip'; el.appendChild(tip); }
  tip.innerHTML = `<span>${c.label ? c.label(i) : ''}</span><span>시가 <b>${c.f(k[0])}</b></span><span>고가 <b>${c.f(k[1])}</b></span><span>저가 <b>${c.f(k[2])}</b></span><span>종가 <b>${c.f(k[3])}</b></span><span>거래량 <b>${c.f(k[4])}</b></span>`;
  const r = el.getBoundingClientRect(), px = (x / c.W) * r.width;
  tip.style.left = Math.max(70, Math.min(r.width - 70, px)) + 'px';
}
