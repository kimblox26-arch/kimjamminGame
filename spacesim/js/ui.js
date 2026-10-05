// SpaceSim — UI: 아이콘, 라벨, 정보 패널, 시나리오 제어 패널, 토스트
const P = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  reset: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4',
  trail: 'M3 18c4-1 6-12 11-12 3 0 5 3 7 4M18 6l3 4-4 1',
  tag: 'M3 12V4h8l9 9-8 8-9-9zM7.5 7.5h.01',
  target: 'M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  camera: 'M3 8h3l2-3h8l2 3h3v11H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
};
export const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${P[name]}"/></svg>`;
export function applyIcons(root = document) { root.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); }); }

export class Labels {
  constructor(el) { this.el = el; }
  add(text, onClick, cls = '') {
    const d = document.createElement('div');
    d.className = `lbl ${cls}`;
    d.textContent = text;
    d.addEventListener('pointerdown', (e) => e.stopPropagation());
    d.addEventListener('click', (e) => { e.stopPropagation(); onClick && onClick(); });
    this.el.appendChild(d);
    return d;
  }
  remove(d) { d.remove(); }
  place(d, x, y, vis, sel = false) {
    if (!vis) { if (d._v !== false) { d.style.opacity = '0'; d.style.pointerEvents = 'none'; d._v = false; } return; }
    if (d._v !== true) { d.style.opacity = '1'; d.style.pointerEvents = 'auto'; d._v = true; }
    d.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    if (d._s !== sel) { d.classList.toggle('sel', sel); d._s = sel; }
  }
  clear() { this.el.innerHTML = ''; }
}

export class UI {
  constructor(app) {
    this.app = app;
    this.$ = (id) => document.getElementById(id);
    this.info = this.$('info');
    this.panel = this.$('panel');
    this.toastEl = this.$('toast');
    this.readoutEls = {};
    applyIcons();
  }

  showInfo(d) {
    if (!d) { this.info.classList.add('hidden'); this._infoName = null; return; }
    const rows = d.rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    if (this._infoName === d.name && !this.info.classList.contains('hidden')) {
      this.info.querySelector('.info-rows').innerHTML = rows;
      return;
    }
    this._infoName = d.name;
    this.info.innerHTML = `
      <div class="info-head"><span class="info-dot" style="color:${d.color}"></span>
        <div><h3>${d.name}</h3><div class="info-type">${d.type || ''}</div></div>
        <button class="icon-btn close" aria-label="닫기">${icon('close')}</button></div>
      <dl class="info-rows">${rows}</dl>${d.desc ? `<p class="info-desc">${d.desc}</p>` : ''}`;
    this.info.querySelector('.close').onclick = () => { this.app.scenario.select?.(null); this.showInfo(null); };
    this.info.classList.remove('hidden');
  }

  buildPanel(defs, title) {
    const el = this.panel;
    el.innerHTML = `<h4>${title}</h4>`;
    this.readoutEls = {};
    for (const d of defs) {
      const wrap = document.createElement('div');
      wrap.className = 'ctl';
      if (d.type === 'chips') {
        wrap.innerHTML = d.label ? `<div class="ctl-label">${d.label}</div>` : '';
        const box = document.createElement('div'); box.className = 'chips';
        d.items.forEach((it) => {
          const b = document.createElement('button');
          b.className = 'chip' + (it.act ? ' act' : '') + (d.radio && d.value === it.key ? ' on' : '');
          b.textContent = it.label;
          b.onclick = () => {
            if (d.radio) { box.querySelectorAll('.chip').forEach((c) => c.classList.remove('on')); b.classList.add('on'); }
            it.on();
          };
          box.appendChild(b);
        });
        wrap.appendChild(box);
      } else if (d.type === 'slider') {
        wrap.innerHTML = `<div class="ctl-label">${d.label} <i></i></div><input type="range" min="${d.min}" max="${d.max}" step="${d.step}" value="${d.value}">`;
        const inp = wrap.querySelector('input'), lab = wrap.querySelector('i');
        const up = () => { const v = parseFloat(inp.value); lab.textContent = d.fmt ? d.fmt(v) : v; d.on(v); };
        inp.oninput = up;
        lab.textContent = d.fmt ? d.fmt(d.value) : d.value;
      } else if (d.type === 'toggle') {
        wrap.innerHTML = `<label class="toggle">${d.label}<input type="checkbox" ${d.value ? 'checked' : ''}><span class="sw"></span></label>`;
        wrap.querySelector('input').onchange = (e) => d.on(e.target.checked);
      } else if (d.type === 'readouts') {
        wrap.className = 'readouts';
        wrap.innerHTML = d.items.map((k) => `<dt>${k}</dt><dd data-k="${k}">—</dd>`).join('');
        wrap.querySelectorAll('dd').forEach((dd) => (this.readoutEls[dd.dataset.k] = dd));
        el.appendChild(document.createElement('dl')).replaceWith(wrap);
        continue;
      } else if (d.type === 'hint') {
        wrap.className = 'hint';
        wrap.textContent = d.text;
      }
      el.appendChild(wrap);
    }
  }

  updateReadouts(vals) {
    for (const k in vals) { const e = this.readoutEls[k]; if (e && e.textContent !== vals[k]) e.textContent = vals[k]; }
  }

  toast(msg, ms = 2800) {
    const t = this.toastEl;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.remove('show'), ms);
  }
}
