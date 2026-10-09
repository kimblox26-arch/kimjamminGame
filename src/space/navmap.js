// FREE FREELY 우주 탐사 - 항법 지도 (우주 → 은하 → 항성계 → 행성), 목표 지정
import * as THREE from 'three';
import { icon, drawIcon, bodyIcon, buttonHTML } from '../ui/icons.js';
import { formatDistance, formatPressure, formatTemp, LY, AU } from './consts.js';
import { GAS_LABEL } from './universe.js';

const KIND_NAME = {
  galaxy: { spiral: '나선은하', elliptical: '타원은하', irregular: '불규칙은하' }, system: '항성계', star: '항성', planet: '행성', moon: '위성',
  blackhole: '블랙홀', nebula: '성운', belt: '소행성대',
};
const TYPE_NAME = { terran: '지구형 행성', mars: '화성형 행성', hot: '뜨거운 행성', ice: '얼음 행성', gas: '기체 행성', ringed: '고리 행성', moon: '위성', asteroid: '소행성형 천체' };

export class NavMap {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('space-map');
    this.open = false;
    this.level = null;      // 현재 보는 프레임 천체
    this.selected = null;
    this.zoom = 1;
    this.pan = new THREE.Vector2();
    this._build();
  }

  _build() {
    const r = this.root;
    r.innerHTML = `
      <div class="map-head">
        <h3>${icon('map', { size: 22 })} 항법 지도</h3>
        <div class="map-crumbs"></div>
        <span style="flex:1"></span>
        ${buttonHTML('target', '내 위치', { small: true, attrs: 'data-map="here"' })}
        ${buttonHTML('close', '닫기', { small: true, attrs: 'data-map="close"', key: 'M' })}
      </div>
      <div class="map-body">
        <div style="position:relative;min-height:0"><canvas class="map-canvas"></canvas></div>
        <aside class="map-side">
          <div class="map-detail frame-panel"></div>
          <div class="map-list"></div>
        </aside>
      </div>`;
    this.canvas = r.querySelector('.map-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.crumbs = r.querySelector('.map-crumbs');
    this.detail = r.querySelector('.map-detail');
    this.list = r.querySelector('.map-list');
    r.querySelector('[data-map="close"]').onclick = () => this.toggle(false);
    r.querySelector('[data-map="here"]').onclick = () => { this.level = this._defaultLevel(); this.zoom = 1; this.pan.set(0, 0); this._refresh(); };
    // 클릭 · 드래그 · 휠 · 핀치
    let drag = null, moved = 0;
    const pointers = new Map();
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag = { x: e.clientX, y: e.clientY }; moved = 0;
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const d0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        p.x = e.clientX; p.y = e.clientY;
        const pts2 = [...pointers.values()];
        const d1 = Math.hypot(pts2[0].x - pts2[1].x, pts2[0].y - pts2[1].y);
        if (d0 > 0) this.zoom = Math.max(0.2, Math.min(400, this.zoom * d1 / d0));
        moved += 10;
        return;
      }
      p.x = e.clientX; p.y = e.clientY;
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        moved += Math.abs(dx) + Math.abs(dy);
        this.pan.x += dx; this.pan.y += dy;
        drag.x = e.clientX; drag.y = e.clientY;
      }
    });
    const up = (e) => {
      pointers.delete(e.pointerId);
      if (drag && moved < 6) this._click(e);
      drag = null;
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); drag = null; });
    this.canvas.addEventListener('dblclick', () => { if (this.selected && this._canEnter(this.selected)) this._enter(this.selected); });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = Math.exp(-e.deltaY * 0.0015);
      const r2 = this.canvas.getBoundingClientRect();
      const mx = e.clientX - r2.left - r2.width / 2 - this.pan.x, my = e.clientY - r2.top - r2.height / 2 - this.pan.y;
      const nz = Math.max(0.2, Math.min(400, this.zoom * k));
      this.pan.x -= mx * (nz / this.zoom - 1); this.pan.y -= my * (nz / this.zoom - 1);
      this.zoom = nz;
    }, { passive: false });
  }

  toggle(on = !this.open) {
    this.open = on;
    this.root.hidden = !on;
    if (on) {
      this.level = this._defaultLevel();
      this.zoom = 1; this.pan.set(0, 0);
      this.selected = this.game.target || null;
      this._refresh();
      this.game.audio && this.game.sfx('click');
    }
  }

  _defaultLevel() {
    const f = this.game.flight.frame;
    if (!f) return this.game.uni.root;
    if (f.kind === 'planet' || f.kind === 'moon') return f.kind === 'moon' ? f.parent : f;
    return f;
  }

  _canEnter(b) { return b.children && b.children.some((c) => c.kind !== 'star'); }

  _enter(b) {
    this.level = b;
    this.zoom = 1; this.pan.set(0, 0);
    this._refresh();
  }

  _children(level) {
    if (level.kind === 'universe') return level.children;
    if (level.kind === 'galaxy') return level.children;
    if (level.kind === 'system') return level.children;
    return level.children;
  }

  _refresh() {
    // 경로 (breadcrumb)
    const chain = [];
    let b = this.level;
    while (b) { chain.unshift(b); b = b.parent; }
    this.crumbs.innerHTML = chain.map((c, i) => buttonHTML(i === 0 ? 'galaxy' : bodyIcon(c), c.name, { small: true, attrs: `data-crumb="${c.id}"`, cls: c === this.level ? 'is-selected' : '' })).join('');
    this.crumbs.querySelectorAll('[data-crumb]').forEach((el) => {
      el.onclick = () => this._enter(this.game.uni.byId[el.dataset.crumb]);
    });
    // 목록
    const kids = this._children(this.level).filter((c) => c.kind !== 'belt' || this.level.kind === 'system');
    const shipPos = this.game.shipPosIn(this.level);
    this.list.innerHTML = kids.map((c) => {
      const d = shipPos.distanceTo(c.localPos);
      return `<button class="sbtn map-row ${c === this.selected ? 'is-selected' : ''}" data-body="${c.id}">${icon(bodyIcon(c), { size: 18 })}<span class="sbtn-label">${c.name}</span><span class="dist">${formatDistance(d)}</span></button>`;
    }).join('');
    this.list.querySelectorAll('[data-body]').forEach((el) => {
      el.onclick = () => this._select(this.game.uni.byId[el.dataset.body]);
      el.ondblclick = () => { const bb = this.game.uni.byId[el.dataset.body]; if (this._canEnter(bb)) this._enter(bb); };
    });
    this._detail();
  }

  _select(b) {
    this.selected = b;
    this.game.sfx('click');
    this._refresh();
  }

  _detail() {
    const b = this.selected || this.level;
    const el = this.detail;
    if (!b) { el.innerHTML = ''; return; }
    const kind = b.kind === 'galaxy' ? KIND_NAME.galaxy[b.gtype] : b.kind === 'planet' || b.kind === 'moon' ? (TYPE_NAME[b.type] || KIND_NAME[b.kind]) : KIND_NAME[b.kind] || '';
    const kv = [];
    if (b.radius && b.kind !== 'galaxy') kv.push(['반지름', formatDistance(b.radius)]);
    if (b.kind === 'galaxy') kv.push(['지름', formatDistance(b.galRadius * 2)]);
    if (b.surfaceGravity && b.kind !== 'galaxy' && b.kind !== 'blackhole' && b.kind !== 'star') kv.push(['표면 중력', (b.surfaceGravity / 9.80665).toFixed(2) + ' g']);
    if (b.temp) kv.push(['표면 온도', formatTemp(b.temp)]);
    if (b.atmo) { kv.push(['표면 기압', formatPressure(b.atmo.p0)]); kv.push(['표면 기온', formatTemp(b.atmo.T0)]); }
    if (b.orbit) kv.push(['궤도 반지름', formatDistance(b.orbit.a)]);
    const shipD = this.game.distanceTo(b);
    kv.push(['현재 거리', formatDistance(shipD)]);
    const comp = b.atmo ? Object.entries(b.atmo.comp).sort((x, y) => y[1] - x[1]).slice(0, 5) : [];
    el.innerHTML = `
      <h4>${icon(bodyIcon(b), { size: 22, anim: true })} ${b.name}</h4>
      <div class="hint">${kind}</div>
      <div class="prev-slot"></div>
      <p class="hint" style="margin:0">${b.desc || ''}</p>
      <div class="kv">${kv.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('')}</div>
      ${comp.length ? `<div class="comp-bars">${comp.map(([g, v]) => `<div><span>${GAS_LABEL[g] || g}</span><i><b style="width:${Math.max(1, v)}%"></b></i><span>${v < 1 ? v.toFixed(2) : v.toFixed(1)}%</span></div>`).join('')}</div>` : ''}
      <div class="map-btns">
        ${b !== this.level ? buttonHTML('target', '목표 지정', { primary: true, small: true, attrs: 'data-act="target"' }) : ''}
        ${this._canEnter(b) && b !== this.level ? buttonHTML('zoom', '들어가기', { small: true, attrs: 'data-act="enter"' }) : ''}
        ${this.level.parent ? buttonHTML('back', '상위로', { small: true, attrs: 'data-act="up"' }) : ''}
      </div>`;
    const slot = el.querySelector('.prev-slot');
    if (slot && this.game.previews && b.kind !== 'universe') {
      const c = this.game.previews.element(b, 160);
      c.style.display = 'block'; c.style.margin = '0 auto';
      slot.appendChild(c);
    }
    const t = el.querySelector('[data-act="target"]');
    if (t) t.onclick = () => { this.game.setTarget(b); this.game.sfx('confirm'); this._refresh(); };
    const en = el.querySelector('[data-act="enter"]');
    if (en) en.onclick = () => this._enter(b);
    const upb = el.querySelector('[data-act="up"]');
    if (upb) upb.onclick = () => this._enter(this.level.parent);
  }

  /* ------------------------------ 그리기 ------------------------------ */
  _proj(level) {
    // 수준별 축척: 로그 반지름 (작은 것과 큰 것 동시 표시)
    const kids = this._children(level);
    let maxD = 1, minD = Infinity;
    for (const c of kids) {
      const d = c.orbit ? c.orbit.a : c.localPos.length();
      if (d > 0) { maxD = Math.max(maxD, d); minD = Math.min(minD, d); }
    }
    if (!isFinite(minD)) minD = maxD * 0.01;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const R = Math.min(W, H) * 0.44 * this.zoom;
    const lmin = Math.log10(minD * 0.5), lmax = Math.log10(maxD * 1.1);
    const useLog = maxD / minD > 30;
    return (p) => {
      const d = Math.hypot(p.x, p.z);
      let r;
      if (d <= 0) r = 0;
      else if (useLog) r = Math.max(0, (Math.log10(d) - lmin) / (lmax - lmin)) * R;
      else r = (d / (maxD * 1.1)) * R;
      const a = Math.atan2(p.z, p.x);
      return { x: W / 2 + this.pan.x + Math.cos(a) * r, y: H / 2 + this.pan.y + Math.sin(a) * r, scale: r / Math.max(1, d) };
    };
  }

  render(dt) {
    if (!this.open) return;
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    this.t = (this.t || 0) + dt;
    const level = this.level;
    const proj = this._proj(level);
    // 배경 격자
    ctx.strokeStyle = 'rgba(98,230,255,0.07)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 6; i++) { ctx.beginPath(); ctx.arc(W / 2 + this.pan.x, H / 2 + this.pan.y, Math.min(W, H) * 0.074 * i * this.zoom, 0, Math.PI * 2); ctx.stroke(); }
    // 은하 원반 (은하 수준)
    if (level.kind === 'galaxy') {
      const o = proj(new THREE.Vector3(0, 0, 0));
      const edge = proj(new THREE.Vector3(level.galRadius, 0, 0));
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, Math.max(20, edge.x - o.x));
      g.addColorStop(0, 'rgba(255,220,170,0.35)'); g.addColorStop(0.3, 'rgba(160,180,255,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, Math.max(20, edge.x - o.x), 0, Math.PI * 2); ctx.fill();
    }
    const kids = this._children(level);
    // 궤도
    for (const b of kids) {
      if (b.orbit) {
        ctx.strokeStyle = b === this.selected ? 'rgba(255,169,77,0.7)' : 'rgba(98,230,255,0.25)';
        ctx.beginPath();
        for (let i = 0; i <= 96; i++) {
          const E = (i / 96) * Math.PI * 2;
          const p = new THREE.Vector3(b.orbit.a * (Math.cos(E) - b.orbit.e), 0, -b.orbit.b * Math.sin(E)).applyQuaternion(b.orbit.q);
          const s = proj(p);
          if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
        }
        ctx.stroke();
      }
      if (b.kind === 'belt') {
        const a = proj(new THREE.Vector3(b.inner, 0, 0)), z = proj(new THREE.Vector3(b.outer, 0, 0)), o = proj(new THREE.Vector3());
        ctx.strokeStyle = 'rgba(200,190,170,0.18)';
        ctx.lineWidth = Math.max(2, z.x - a.x);
        ctx.beginPath(); ctx.arc(o.x, o.y, (a.x + z.x) / 2 - o.x, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
    // 천체 아이콘
    this._hits = [];
    for (const b of kids) {
      if (b.kind === 'belt') continue;
      const s = proj(b.localPos);
      const sel = b === this.selected;
      const isTarget = b === this.game.target;
      const size = b.kind === 'star' ? 30 : b.kind === 'galaxy' ? 28 : 24;
      drawIcon(ctx, bodyIcon(b), s.x, s.y, size * (sel ? 1.15 : 1), { color: sel ? '#fff' : '#e9f6ff', accent: '#ffa94d', cyan: '#62e6ff', glow: sel ? 1 : 0.4, animate: sel, t: this.t });
      if (isTarget) drawIcon(ctx, 'target', s.x, s.y, size + 18, { color: '#ffa94d', accent: '#ffa94d', animate: true, t: this.t });
      ctx.font = '600 12px Rajdhani, sans-serif';
      ctx.fillStyle = sel ? '#ffa94d' : 'rgba(233,246,255,0.8)';
      ctx.textAlign = 'center';
      ctx.fillText(b.name, s.x, s.y + size * 0.5 + 14);
      this._hits.push({ b, x: s.x, y: s.y, r: size * 0.7 });
    }
    // 내 위치
    const sp = this.game.shipPosIn(level);
    const s = proj(sp);
    drawIcon(ctx, 'ship', s.x, s.y, 22, { color: '#7dffb0', accent: '#ffa94d', cyan: '#62e6ff', glow: 1, animate: true, t: this.t });
    ctx.fillStyle = '#7dffb0'; ctx.font = '700 11px Rajdhani, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('현재 위치', s.x, s.y - 16);
    // 축척 안내
    ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(200,230,250,0.6)'; ctx.font = '600 12px Rajdhani, sans-serif';
    ctx.fillText('로그 축척 · 휠/핀치 확대 · 드래그 이동 · 더블클릭으로 들어가기', 14, H - 14);
  }

  _click(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 1e9;
    for (const h of this._hits || []) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < h.r + 10 && d < bd) { bd = d; best = h.b; }
    }
    if (best) this._select(best);
  }
}

void LY; void AU;
