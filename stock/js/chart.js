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
    drawHover(el);
  };
  el.addEventListener('pointermove', pick);
  el.addEventListener('pointerdown', pick);
  el.addEventListener('pointerleave', () => { el._hi = null; drawHover(el); });
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
