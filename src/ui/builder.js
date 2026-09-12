// FREE FREELY - 설계도 제작 화면 (블루프린트 에디터)
// 청사진 스타일의 2D 캔버스에서 부품을 배치해 기체를 설계한다.
// 측면도/평면도/정면도 3개 뷰, 실시간 성능 해석, 무게중심·공력중심 표시.
import { PARTS, CATEGORIES } from '../craft/parts.js';
import { analyzeBlueprint } from '../craft/assembler.js';
import { PRESETS, starterBlueprint, cloneBlueprint, loadDesigns, saveDesign, deleteDesign } from '../craft/presets.js';
import { clamp, lerp } from '../core/utils.js';

const VIEWS = [
  { id: 'side', name: '측면도 (SIDE)', hx: 'bx', hy: 'by', hLabel: '기수 ←→ 후방', vLabel: '높이' },
  { id: 'top', name: '평면도 (TOP)', hx: 'bx', hy: 'bz', hLabel: '기수 ←→ 후방', vLabel: '좌우' },
  { id: 'front', name: '정면도 (FRONT)', hx: 'bz', hy: 'by', hLabel: '좌우', vLabel: '높이' },
];

export class Builder {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.audio = opts.audio;
    this.bp = starterBlueprint();
    this.view = 'side';
    this.scale = 26;           // px / m
    this.offset = { x: 0, y: 0 };
    this.selected = null;      // 선택된 배치 부품 index
    this.palettePart = null;   // 배치 대기 중인 부품 id
    this.category = 'structure';
    this.dragging = null;
    this.panning = false;
    this.snap = 0.25;
    this.stats = null;
    this.hoverPart = null;
    this._build();
    this.setBlueprint(this.bp);
  }

  /* ------------------------------ DOM 구성 ------------------------------ */
  _build() {
    const el = document.createElement('div');
    el.className = 'builder-screen';
    el.innerHTML = `
      <div class="builder-top">
        <div class="builder-title">
          <span class="bt-logo">FREE<span>FREELY</span></span>
          <span class="bt-sub">AEROWORKS · 설계실</span>
        </div>
        <div class="builder-views"></div>
        <div class="builder-actions">
          <button class="btn btn-ghost" data-act="presets">격납고</button>
          <button class="btn btn-ghost" data-act="save">저장</button>
          <button class="btn btn-ghost" data-act="load">불러오기</button>
          <button class="btn btn-ghost" data-act="json">JSON</button>
          <button class="btn btn-ghost" data-act="clear">초기화</button>
          <button class="btn btn-ghost" data-act="exit">메뉴</button>
          <button class="btn btn-primary" data-act="fly">▶ 비행 시작</button>
        </div>
      </div>
      <div class="builder-body">
        <aside class="builder-palette">
          <div class="palette-tabs"></div>
          <div class="palette-list"></div>
          <div class="palette-help">
            <b>조작</b><br>
            부품 선택 → 도면 클릭으로 배치<br>
            드래그: 이동 · 휠: 확대 · 우클릭 드래그: 화면 이동<br>
            Del: 삭제 · [ ]: 크기 · , .: 각도 · D: 복제
          </div>
        </aside>
        <div class="builder-canvas-wrap">
          <canvas class="builder-canvas"></canvas>
          <div class="builder-viewhint"></div>
        </div>
        <aside class="builder-inspector">
          <div class="insp-section insp-part"></div>
          <div class="insp-section insp-stats"></div>
          <div class="insp-section insp-warn"></div>
          <div class="insp-section insp-list"></div>
        </aside>
      </div>
      <div class="builder-modal" hidden>
        <div class="modal-card">
          <h3 class="modal-title">제목</h3>
          <div class="modal-body"></div>
          <div class="modal-actions">
            <button class="btn btn-ghost" data-act="modal-close">닫기</button>
          </div>
        </div>
      </div>`;
    this.container.appendChild(el);
    this.el = el;
    this.canvas = el.querySelector('.builder-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.paletteTabs = el.querySelector('.palette-tabs');
    this.paletteList = el.querySelector('.palette-list');
    this.inspPart = el.querySelector('.insp-part');
    this.inspStats = el.querySelector('.insp-stats');
    this.inspWarn = el.querySelector('.insp-warn');
    this.inspList = el.querySelector('.insp-list');
    this.viewTabs = el.querySelector('.builder-views');
    this.viewHint = el.querySelector('.builder-viewhint');
    this.modal = el.querySelector('.builder-modal');

    // 뷰 탭
    for (const v of VIEWS) {
      const b = document.createElement('button');
      b.className = 'btn btn-tab' + (v.id === this.view ? ' active' : '');
      b.textContent = v.name;
      b.onclick = () => { this.view = v.id; this._syncViewTabs(); this.render(); this.click(); };
      this.viewTabs.appendChild(b);
    }
    // 카테고리 탭
    for (const c of CATEGORIES) {
      const b = document.createElement('button');
      b.className = 'btn btn-cat' + (c.id === this.category ? ' active' : '');
      b.textContent = c.name;
      b.style.setProperty('--cat', c.color);
      b.onclick = () => { this.category = c.id; this._renderPalette(); this.click(); };
      this.paletteTabs.appendChild(b);
    }

    el.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => this._action(b.dataset.act);
    });

    // 캔버스 이벤트
    const cv = this.canvas;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => this._onDown(e));
    cv.addEventListener('pointermove', (e) => this._onMove(e));
    cv.addEventListener('pointerup', (e) => this._onUp(e));
    cv.addEventListener('pointerleave', () => { this.dragging = null; this.panning = false; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.scale = clamp(this.scale * f, 6, 140);
      this.render();
    }, { passive: false });

    this._keyHandler = (e) => this._onKey(e);
    window.addEventListener('keydown', this._keyHandler);
    this._resizeHandler = () => this.resize();
    window.addEventListener('resize', this._resizeHandler);
    this._renderPalette();
  }

  click(kind = 'click') { if (this.audio) this.audio.ui(kind); }

  destroy() {
    window.removeEventListener('keydown', this._keyHandler);
    window.removeEventListener('resize', this._resizeHandler);
    this.el.remove();
  }

  show() { this.el.style.display = 'flex'; this.resize(); }
  hide() { this.el.style.display = 'none'; }

  resize() {
    const wrap = this.canvas.parentElement;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = wrap.clientWidth, h = wrap.clientHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.dpr = dpr;
    this.cw = w; this.ch = h;
    this.render();
  }

  setBlueprint(bp) {
    this.bp = cloneBlueprint(bp);
    this.selected = null;
    this.offset.x = 0;
    this.offset.y = 0;
    this._analyze();
    this.render();
  }

  _syncViewTabs() {
    this.viewTabs.querySelectorAll('.btn-tab').forEach((b, i) => {
      b.classList.toggle('active', VIEWS[i].id === this.view);
    });
  }

  /* ------------------------------ 팔레트 ------------------------------ */
  _renderPalette() {
    this.paletteTabs.querySelectorAll('.btn-cat').forEach((b, i) => {
      b.classList.toggle('active', CATEGORIES[i].id === this.category);
    });
    const list = Object.values(PARTS).filter((p) => p.cat === this.category);
    this.paletteList.innerHTML = '';
    for (const def of list) {
      const card = document.createElement('button');
      card.className = 'part-card' + (this.palettePart === def.id ? ' active' : '');
      const cat = CATEGORIES.find((c) => c.id === def.cat);
      card.style.setProperty('--cat', cat ? cat.color : '#8fd');
      card.innerHTML = `
        <div class="pc-head"><span class="pc-name">${def.name}</span><span class="pc-mass">${def.mass}kg</span></div>
        <div class="pc-desc">${def.desc || ''}</div>
        <div class="pc-meta">${def.size[0]}×${def.size[1]}×${def.size[2]} m${def.mirror ? ' · 좌우대칭' : ''}</div>`;
      card.onclick = () => {
        this.palettePart = this.palettePart === def.id ? null : def.id;
        this._renderPalette();
        this.click('hover');
      };
      this.paletteList.appendChild(card);
    }
  }

  /* ------------------------------ 좌표 변환 ------------------------------ */
  get axes() { return VIEWS.find((v) => v.id === this.view); }

  toScreen(hv, vv) {
    const cx = this.cw / 2 + this.offset.x;
    const cy = this.ch / 2 + this.offset.y;
    return { x: cx + hv * this.scale, y: cy - vv * this.scale };
  }
  toWorld(sx, sy) {
    const cx = this.cw / 2 + this.offset.x;
    const cy = this.ch / 2 + this.offset.y;
    return { h: (sx - cx) / this.scale, v: -(sy - cy) / this.scale };
  }

  /** 부품의 현재 뷰에서의 사각형들 (blueprint 단위) */
  partRects(p, def) {
    const size = p.size || def.size;
    const k = p.scale || 1;
    const l = size[0] * k, hh = size[1] * k, w = size[2] * k;
    const bx = p.bx || 0, by = p.by || 0, bz = p.bz || 0;
    const isWing = def.cat === 'wing';
    const vertical = !!def.vertical;
    const rects = [];
    const mirror = def.mirror && Math.abs(bz) > 0.05;

    if (this.view === 'side') {
      if (isWing && !vertical) {
        rects.push({ x0: bx - l, x1: bx, y0: by - hh / 2, y1: by + hh / 2, shape: 'wing' });
      } else if (vertical) {
        rects.push({ x0: bx - l, x1: bx, y0: by, y1: by + hh, shape: 'fin' });
      } else {
        rects.push({ x0: bx - l / 2, x1: bx + l / 2, y0: by - hh / 2, y1: by + hh / 2, shape: def.cat === 'balloon' ? 'ellipse' : 'body' });
      }
    } else if (this.view === 'top') {
      if (isWing && !vertical) {
        rects.push({ x0: bx - l, x1: bx, y0: bz, y1: bz + w, shape: 'wing' });
        if (mirror) rects.push({ x0: bx - l, x1: bx, y0: -bz - w, y1: -bz, shape: 'wing', mirrored: true });
      } else if (vertical) {
        rects.push({ x0: bx - l, x1: bx, y0: bz - w / 2, y1: bz + w / 2, shape: 'fin' });
        if (mirror) rects.push({ x0: bx - l, x1: bx, y0: -bz - w / 2, y1: -bz + w / 2, shape: 'fin', mirrored: true });
      } else {
        rects.push({ x0: bx - l / 2, x1: bx + l / 2, y0: bz - w / 2, y1: bz + w / 2, shape: def.cat === 'balloon' ? 'ellipse' : 'body' });
        if (mirror) rects.push({ x0: bx - l / 2, x1: bx + l / 2, y0: -bz - w / 2, y1: -bz + w / 2, shape: 'body', mirrored: true });
      }
    } else { // front
      if (isWing && !vertical) {
        rects.push({ x0: bz, x1: bz + w, y0: by - hh / 2, y1: by + hh / 2, shape: 'wing' });
        if (mirror) rects.push({ x0: -bz - w, x1: -bz, y0: by - hh / 2, y1: by + hh / 2, shape: 'wing', mirrored: true });
      } else if (vertical) {
        rects.push({ x0: bz - w / 2, x1: bz + w / 2, y0: by, y1: by + hh, shape: 'fin' });
        if (mirror) rects.push({ x0: -bz - w / 2, x1: -bz + w / 2, y0: by, y1: by + hh, shape: 'fin', mirrored: true });
      } else {
        rects.push({ x0: bz - w / 2, x1: bz + w / 2, y0: by - hh / 2, y1: by + hh / 2, shape: def.cat === 'balloon' ? 'ellipse' : 'body' });
        if (mirror) rects.push({ x0: -bz - w / 2, x1: -bz + w / 2, y0: by - hh / 2, y1: by + hh / 2, shape: 'body', mirrored: true });
      }
    }
    return rects;
  }

  /* ------------------------------ 렌더링 ------------------------------ */
  render() {
    const ctx = this.ctx;
    if (!ctx || !this.cw) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const W = this.cw, H = this.ch;
    // 청사진 배경
    const grd = ctx.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, '#0a2038');
    grd.addColorStop(0.55, '#0c2742');
    grd.addColorStop(1, '#081a2e');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    this._drawGrid(ctx, W, H);
    this._drawAxes(ctx);
    this._drawParts(ctx);
    this._drawMarkers(ctx);
    this._drawTitleBlock(ctx, W, H);

    const v = this.axes;
    this.viewHint.textContent = `${v.name} — 가로: ${v.hLabel} / 세로: ${v.vLabel} · 1칸 = 1 m`
      + (this.palettePart ? `  ⟶ 배치 대기: ${PARTS[this.palettePart].name} (도면 클릭)` : '');
  }

  _drawGrid(ctx, W, H) {
    const s = this.scale;
    const o = this.toScreen(0, 0);
    ctx.lineWidth = 1;
    // 미세 격자 (0.5m)
    if (s > 18) {
      ctx.strokeStyle = 'rgba(120,200,255,0.07)';
      ctx.beginPath();
      const half = s / 2;
      for (let x = o.x % half; x < W; x += half) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = o.y % half; y < H; y += half) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
    }
    // 1m 격자
    ctx.strokeStyle = 'rgba(120,200,255,0.14)';
    ctx.beginPath();
    for (let x = o.x % s; x < W; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = o.y % s; y < H; y += s) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    // 5m 굵은 격자
    ctx.strokeStyle = 'rgba(140,215,255,0.28)';
    ctx.beginPath();
    const s5 = s * 5;
    for (let x = o.x % s5; x < W; x += s5) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = o.y % s5; y < H; y += s5) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }

  _drawAxes(ctx) {
    const o = this.toScreen(0, 0);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(0, o.y); ctx.lineTo(this.cw, o.y);
    ctx.moveTo(o.x, 0); ctx.lineTo(o.x, this.ch);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(200,235,255,0.75)';
    ctx.font = '600 11px "Rajdhani", monospace';
    ctx.fillText('기준선 0', o.x + 6, o.y - 6);
    // 스케일 자
    const s = this.scale;
    ctx.strokeStyle = 'rgba(200,235,255,0.6)';
    ctx.beginPath();
    ctx.moveTo(24, this.ch - 40); ctx.lineTo(24 + s * 5, this.ch - 40);
    ctx.moveTo(24, this.ch - 46); ctx.lineTo(24, this.ch - 34);
    ctx.moveTo(24 + s * 5, this.ch - 46); ctx.lineTo(24 + s * 5, this.ch - 34);
    ctx.stroke();
    ctx.fillText('5 m', 24 + s * 2.2, this.ch - 46);
    ctx.restore();
  }

  _drawParts(ctx) {
    const parts = this.bp.parts || [];
    parts.forEach((p, i) => {
      const def = PARTS[p.type];
      if (!def) return;
      const cat = CATEGORIES.find((c) => c.id === def.cat);
      const color = cat ? cat.color : '#9fe';
      const rects = this.partRects(p, def);
      const isSel = this.selected === i;
      for (const r of rects) {
        const a = this.toScreen(r.x0, r.y1);
        const b = this.toScreen(r.x1, r.y0);
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
        ctx.save();
        // 회전(취부각) 표현
        if (p.rot) {
          ctx.translate(x + w / 2, y + h / 2);
          ctx.rotate(-(p.rot || 0) * Math.PI / 180 * (this.view === 'side' ? 1 : 0));
          ctx.translate(-(x + w / 2), -(y + h / 2));
        }
        ctx.lineWidth = isSel ? 2.4 : 1.4;
        ctx.strokeStyle = isSel ? '#ffffff' : color;
        ctx.fillStyle = isSel ? 'rgba(255,255,255,0.18)' : hexToRgba(color, r.mirrored ? 0.09 : 0.14);
        ctx.beginPath();
        if (r.shape === 'ellipse') {
          ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        } else if (r.shape === 'wing' || r.shape === 'fin') {
          // 테이퍼 있는 날개 실루엣
          const taper = 0.55;
          if (this.view === 'top' || (this.view === 'front' && r.shape === 'wing')) {
            const tipTop = lerp(y, y + h, 0);
            void tipTop;
            ctx.moveTo(x, r.mirrored ? y + h : y);
            ctx.lineTo(x + w, r.mirrored ? y + h : y);
            ctx.lineTo(x + w * (this.view === 'top' ? 1 : 1), r.mirrored ? y : y + h);
            ctx.lineTo(x + w * taper * 0 + x * 0 + (this.view === 'top' ? x + w * 0.35 : x), r.mirrored ? y : y + h);
            ctx.closePath();
          } else {
            ctx.rect(x, y, w, h);
          }
        } else {
          const r2 = Math.min(6, h / 2, w / 2);
          ctx.roundRect(x, y, w, h, r2);
        }
        ctx.fill();
        ctx.stroke();
        // 부품 이름 (충분히 클 때)
        if (w > 42 && h > 13 && !r.mirrored) {
          ctx.fillStyle = 'rgba(240,250,255,0.9)';
          ctx.font = '600 10px "Rajdhani", monospace';
          ctx.fillText(def.name, x + 4, y + 11);
        }
        ctx.restore();
      }
      // 선택 핸들
      if (isSel) {
        const r = rects[0];
        const a = this.toScreen(r.x0, r.y1);
        const b = this.toScreen(r.x1, r.y0);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(Math.min(a.x, b.x) - 4, Math.min(a.y, b.y) - 4, Math.abs(b.x - a.x) + 8, Math.abs(b.y - a.y) + 8);
        ctx.restore();
      }
    });
  }

  _drawMarkers(ctx) {
    if (!this.stats) return;
    const s = this.stats;
    // 무게중심 / 공력중심 (측면도·평면도에서 표시)
    if (this.view === 'side' || this.view === 'top') {
      const cgH = s.cg.z;          // bx 방향
      const cgV = this.view === 'side' ? s.cg.y : s.cg.x;
      const cg = this.toScreen(cgH, cgV);
      ctx.save();
      // CG 심볼
      ctx.strokeStyle = '#ffd45e';
      ctx.fillStyle = '#ffd45e';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cg.x, cg.y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cg.x, cg.y); ctx.arc(cg.x, cg.y, 9, -Math.PI / 2, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cg.x, cg.y); ctx.arc(cg.x, cg.y, 9, Math.PI / 2, Math.PI); ctx.closePath(); ctx.fill();
      ctx.font = '600 11px "Rajdhani", monospace';
      ctx.fillText('무게중심 CG', cg.x + 13, cg.y - 10);
      // 공력중심
      if (s.wingArea > 0.5) {
        const ac = this.toScreen(s.ac, cgV);
        ctx.strokeStyle = '#6ff0c0';
        ctx.fillStyle = '#6ff0c0';
        ctx.beginPath();
        ctx.moveTo(ac.x - 8, ac.y + 7); ctx.lineTo(ac.x + 8, ac.y + 7); ctx.lineTo(ac.x, ac.y - 8);
        ctx.closePath(); ctx.stroke();
        ctx.fillText('공력중심 AC', ac.x + 12, ac.y + 12);
        // 정적 마진 표시
        ctx.strokeStyle = s.staticMargin >= 0 ? 'rgba(111,240,192,0.8)' : 'rgba(255,107,94,0.9)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(cg.x, cg.y); ctx.lineTo(ac.x, ac.y); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  }

  _drawTitleBlock(ctx, W, H) {
    const s = this.stats;
    const bw = 320, bh = 92;
    const x = W - bw - 18, y = H - bh - 18;
    ctx.save();
    ctx.fillStyle = 'rgba(6,22,38,0.86)';
    ctx.strokeStyle = 'rgba(150,220,255,0.6)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.rect(x, y, bw, bh); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + 26); ctx.lineTo(x + bw, y + 26);
    ctx.moveTo(x + bw * 0.55, y + 26); ctx.lineTo(x + bw * 0.55, y + bh);
    ctx.stroke();
    ctx.fillStyle = '#eaf6ff';
    ctx.font = '700 15px "Rajdhani", monospace';
    ctx.fillText(this.bp.name || '무명 기체', x + 10, y + 18);
    ctx.font = '600 11px "Rajdhani", monospace';
    ctx.fillStyle = 'rgba(200,235,255,0.85)';
    if (s) {
      ctx.fillText(`질량  ${Math.round(s.mass)} kg`, x + 10, y + 44);
      ctx.fillText(`날개면적  ${s.wingArea.toFixed(1)} m²`, x + 10, y + 62);
      ctx.fillText(`전장  ${s.length.toFixed(1)} m / 전폭 ${s.span.toFixed(1)} m`, x + 10, y + 80);
      ctx.fillText(`추력  ${(s.thrust / 1000).toFixed(1)} kN`, x + bw * 0.58, y + 44);
      ctx.fillText(`추력/중량  ${s.twr.toFixed(2)}`, x + bw * 0.58, y + 62);
      ctx.fillText(`부품  ${s.partCount} 개`, x + bw * 0.58, y + 80);
    }
    ctx.restore();
  }

  /* ------------------------------ 상호작용 ------------------------------ */
  _pick(sx, sy) {
    const parts = this.bp.parts || [];
    for (let i = parts.length - 1; i >= 0; i--) {
      const def = PARTS[parts[i].type];
      if (!def) continue;
      for (const r of this.partRects(parts[i], def)) {
        const a = this.toScreen(r.x0, r.y1);
        const b = this.toScreen(r.x1, r.y0);
        const x0 = Math.min(a.x, b.x) - 3, x1 = Math.max(a.x, b.x) + 3;
        const y0 = Math.min(a.y, b.y) - 3, y1 = Math.max(a.y, b.y) + 3;
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) return i;
      }
    }
    return -1;
  }

  _onDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    if (e.button === 2 || e.button === 1) {
      this.panning = { x: e.clientX, y: e.clientY, ox: this.offset.x, oy: this.offset.y };
      return;
    }
    if (this.palettePart) {
      this._place(sx, sy);
      return;
    }
    const i = this._pick(sx, sy);
    this.selected = i >= 0 ? i : null;
    if (i >= 0) {
      const w = this.toWorld(sx, sy);
      const p = this.bp.parts[i];
      const ax = this.axes;
      this.dragging = { i, grabH: w.h - (p[ax.hx] || 0), grabV: w.v - (p[ax.hy] || 0) };
      this.click('hover');
    }
    this._renderInspector();
    this.render();
  }

  _onMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    if (this.panning) {
      this.offset.x = this.panning.ox + (e.clientX - this.panning.x);
      this.offset.y = this.panning.oy + (e.clientY - this.panning.y);
      this.render();
      return;
    }
    if (this.dragging) {
      const w = this.toWorld(sx, sy);
      const p = this.bp.parts[this.dragging.i];
      const ax = this.axes;
      const snap = e.shiftKey ? 0.05 : this.snap;
      p[ax.hx] = Math.round((w.h - this.dragging.grabH) / snap) * snap;
      let v = Math.round((w.v - this.dragging.grabV) / snap) * snap;
      if (ax.hy === 'bz' && Math.abs(v) < 0.2) v = 0;
      p[ax.hy] = v;
      this._analyze();
      this.render();
      this._renderInspector();
    }
  }

  _onUp() { this.dragging = null; this.panning = false; }

  _place(sx, sy) {
    const def = PARTS[this.palettePart];
    if (!def) return;
    const w = this.toWorld(sx, sy);
    const ax = this.axes;
    const p = { type: def.id, bx: 0, by: 0, bz: 0, scale: 1, rot: 0 };
    p[ax.hx] = Math.round(w.h / this.snap) * this.snap;
    p[ax.hy] = Math.round(w.v / this.snap) * this.snap;
    // 대칭 부품을 측면도에서 놓으면 기본 좌우 오프셋 부여
    if (def.mirror && this.view === 'side') p.bz = def.cat === 'wing' ? 0.8 : 1.0;
    this.bp.parts.push(p);
    this.selected = this.bp.parts.length - 1;
    this.palettePart = null;
    this._renderPalette();
    this._analyze();
    this.render();
    this._renderInspector();
    this.click('place');
  }

  _onKey(e) {
    if (this.el.style.display === 'none') return;
    if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
    const p = this.selected !== null ? this.bp.parts[this.selected] : null;
    const ax = this.axes;
    const step = e.shiftKey ? 0.05 : 0.25;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (p) {
        this.bp.parts.splice(this.selected, 1);
        this.selected = null;
        this._analyze(); this.render(); this._renderInspector();
        this.click('back');
      }
      e.preventDefault();
    } else if (p && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      if (e.key === 'ArrowLeft') p[ax.hx] = +(p[ax.hx] - step).toFixed(3);
      if (e.key === 'ArrowRight') p[ax.hx] = +(p[ax.hx] + step).toFixed(3);
      if (e.key === 'ArrowUp') p[ax.hy] = +((p[ax.hy] || 0) + step).toFixed(3);
      if (e.key === 'ArrowDown') p[ax.hy] = +((p[ax.hy] || 0) - step).toFixed(3);
      this._analyze(); this.render(); this._renderInspector();
      e.preventDefault();
    } else if (p && (e.key === '[' || e.key === ']')) {
      p.scale = clamp(+((p.scale || 1) + (e.key === ']' ? 0.1 : -0.1)).toFixed(2), 0.3, 3);
      this._analyze(); this.render(); this._renderInspector();
    } else if (p && (e.key === ',' || e.key === '.')) {
      p.rot = clamp(+((p.rot || 0) + (e.key === '.' ? 1 : -1)).toFixed(1), -20, 20);
      this._analyze(); this.render(); this._renderInspector();
    } else if (p && (e.key === 'd' || e.key === 'D')) {
      const c = JSON.parse(JSON.stringify(p));
      c.bx += 1;
      this.bp.parts.push(c);
      this.selected = this.bp.parts.length - 1;
      this._analyze(); this.render(); this._renderInspector();
      this.click('place');
    } else if (e.key === 'Tab') {
      const i = VIEWS.findIndex((v) => v.id === this.view);
      this.view = VIEWS[(i + 1) % VIEWS.length].id;
      this._syncViewTabs(); this.render();
      e.preventDefault();
    }
  }

  /* ------------------------------ 해석/패널 ------------------------------ */
  _analyze() {
    this.stats = analyzeBlueprint(this.bp);
    this._renderStats();
  }

  _renderStats() {
    const s = this.stats;
    if (!s) return;
    const row = (k, v, cls = '') => `<div class="st-row"><span>${k}</span><b class="${cls}">${v}</b></div>`;
    this.inspStats.innerHTML = `
      <h4>성능 해석</h4>
      ${row('총 질량', Math.round(s.mass) + ' kg')}
      ${row('건조 질량', Math.round(s.dryMass) + ' kg')}
      ${row('연료', Math.round(s.fuel) + ' kg')}
      ${row('정적 추력', (s.thrust / 1000).toFixed(1) + ' kN')}
      ${row('A/B 추력', (s.thrustAB / 1000).toFixed(1) + ' kN')}
      ${row('추력 대 중량', s.twr.toFixed(2), s.twr > 0.35 ? 'good' : s.twr > 0.12 ? '' : 'bad')}
      ${row('날개 면적', s.wingArea.toFixed(1) + ' m²')}
      ${row('날개 하중', s.wingArea > 0 ? Math.round(s.wingLoading) + ' kg/m²' : '—')}
      ${row('실속 속도', isFinite(s.stallSpeed) ? Math.round(s.stallSpeed * 3.6) + ' km/h' : '—', s.stallSpeed < 45 ? 'good' : '')}
      ${row('추정 최고속도', Math.round(s.topSpeed * 3.6) + ' km/h')}
      ${row('정적 마진', s.staticMargin.toFixed(3), s.staticMargin > 0.02 ? 'good' : 'bad')}
      ${row('부력 (열기구)', s.balloonLift > 0 ? (s.balloonLift / 1000).toFixed(1) + ' kN' : '—')}
      ${row('전장 / 전폭', s.length.toFixed(1) + ' / ' + s.span.toFixed(1) + ' m')}`;
    const warns = s.warnings.map((w) =>
      `<div class="warn ${w.level}">${w.level === 'error' ? '✖' : w.level === 'warn' ? '▲' : 'ℹ'} ${w.text}</div>`).join('');
    this.inspWarn.innerHTML = `<h4>설계 검증</h4>${warns || '<div class="warn ok">✔ 문제 없음 — 비행 가능</div>'}`;
    this._renderList();
  }

  _renderList() {
    const parts = this.bp.parts || [];
    this.inspList.innerHTML = `<h4>부품 목록 (${parts.length})</h4>` + parts.map((p, i) => {
      const def = PARTS[p.type];
      if (!def) return '';
      return `<div class="pl-row ${this.selected === i ? 'sel' : ''}" data-i="${i}">
        <span>${def.name}</span>
        <span class="pl-pos">${(p.bx || 0).toFixed(1)}, ${(p.by || 0).toFixed(1)}, ${(p.bz || 0).toFixed(1)}</span>
        <button class="pl-del" data-del="${i}">✕</button></div>`;
    }).join('');
    this.inspList.querySelectorAll('.pl-row').forEach((r) => {
      r.onclick = (e) => {
        if (e.target.dataset.del !== undefined) return;
        this.selected = +r.dataset.i;
        this.render(); this._renderInspector(); this._renderList();
      };
    });
    this.inspList.querySelectorAll('.pl-del').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        this.bp.parts.splice(+b.dataset.del, 1);
        this.selected = null;
        this._analyze(); this.render(); this._renderInspector();
        this.click('back');
      };
    });
  }

  _renderInspector() {
    const i = this.selected;
    if (i === null || !this.bp.parts[i]) {
      this.inspPart.innerHTML = `<h4>기체 정보</h4>
        <label class="fld"><span>이름</span><input id="bp-name" value="${escapeHtml(this.bp.name || '')}"></label>
        <label class="fld"><span>도장 색</span><input id="bp-color" type="color" value="${toHexColor(this.bp.color)}"></label>
        <p class="hint">부품을 선택하면 세부 조정이 가능합니다.</p>`;
      const n = this.inspPart.querySelector('#bp-name');
      if (n) n.oninput = () => { this.bp.name = n.value; this.render(); };
      const c = this.inspPart.querySelector('#bp-color');
      if (c) c.oninput = () => { this.bp.color = parseInt(c.value.slice(1), 16); };
      this._renderList();
      return;
    }
    const p = this.bp.parts[i];
    const def = PARTS[p.type];
    this.inspPart.innerHTML = `<h4>${def.name}</h4>
      <p class="hint">${def.desc || ''}</p>
      <div class="fld-grid">
        <label class="fld"><span>전후 bx</span><input type="number" step="0.25" id="f-bx" value="${p.bx || 0}"></label>
        <label class="fld"><span>상하 by</span><input type="number" step="0.25" id="f-by" value="${p.by || 0}"></label>
        <label class="fld"><span>좌우 bz</span><input type="number" step="0.25" id="f-bz" value="${p.bz || 0}"></label>
        <label class="fld"><span>크기 ×</span><input type="number" step="0.1" min="0.3" max="3" id="f-scale" value="${p.scale || 1}"></label>
        <label class="fld"><span>취부각 °</span><input type="number" step="0.5" min="-20" max="20" id="f-rot" value="${p.rot || 0}"></label>
      </div>
      ${def.mirror ? '<p class="hint">좌우 대칭 부품 — bz ≠ 0 이면 반대쪽에도 자동 생성됩니다.</p>' : ''}
      <div class="insp-btns">
        <button class="btn btn-ghost" id="f-dup">복제 (D)</button>
        <button class="btn btn-ghost" id="f-del">삭제 (Del)</button>
      </div>`;
    const bind = (id, key, min, max) => {
      const el = this.inspPart.querySelector(id);
      if (!el) return;
      el.oninput = () => {
        let v = parseFloat(el.value);
        if (!isFinite(v)) v = 0;
        if (min !== undefined) v = clamp(v, min, max);
        p[key] = v;
        this._analyze(); this.render();
      };
    };
    bind('#f-bx', 'bx'); bind('#f-by', 'by'); bind('#f-bz', 'bz');
    bind('#f-scale', 'scale', 0.3, 3); bind('#f-rot', 'rot', -20, 20);
    this.inspPart.querySelector('#f-dup').onclick = () => {
      const c = JSON.parse(JSON.stringify(p)); c.bx += 1;
      this.bp.parts.push(c); this.selected = this.bp.parts.length - 1;
      this._analyze(); this.render(); this._renderInspector(); this.click('place');
    };
    this.inspPart.querySelector('#f-del').onclick = () => {
      this.bp.parts.splice(i, 1); this.selected = null;
      this._analyze(); this.render(); this._renderInspector(); this.click('back');
    };
    this._renderList();
  }

  /* ------------------------------ 액션 ------------------------------ */
  _action(act) {
    this.click(act === 'fly' ? 'confirm' : 'click');
    if (act === 'fly') {
      const s = this.stats;
      const fatal = s.warnings.filter((w) => w.level === 'error');
      if (fatal.length) {
        this._modal('비행 불가', `<p>다음 문제를 해결해야 이륙할 수 있습니다.</p>` +
          fatal.map((w) => `<div class="warn error">✖ ${w.text}</div>`).join(''));
        if (this.audio) this.audio.ui('error');
        return;
      }
      if (this.opts.onLaunch) this.opts.onLaunch(cloneBlueprint(this.bp));
    } else if (act === 'exit') {
      if (this.opts.onExit) this.opts.onExit();
    } else if (act === 'save') {
      const name = prompt('설계 이름', this.bp.name || '내 기체');
      if (!name) return;
      this.bp.name = name;
      saveDesign(this.bp);
      this._modal('저장 완료', `<p><b>${escapeHtml(name)}</b> 설계를 저장했습니다. 격납고에서 다시 불러올 수 있습니다.</p>`);
      this.render();
    } else if (act === 'load' || act === 'presets') {
      this._openHangar();
    } else if (act === 'json') {
      this._openJson();
    } else if (act === 'clear') {
      if (confirm('현재 설계를 모두 지우고 새로 시작할까요?')) {
        this.setBlueprint(starterBlueprint());
        this._renderInspector();
      }
    } else if (act === 'modal-close') {
      this.modal.hidden = true;
    }
  }

  _modal(title, html) {
    this.modal.querySelector('.modal-title').textContent = title;
    this.modal.querySelector('.modal-body').innerHTML = html;
    this.modal.hidden = false;
  }

  _openHangar() {
    const mine = loadDesigns();
    const card = (bp, isMine) => {
      const s = analyzeBlueprint(bp);
      return `<div class="hangar-card" data-name="${escapeHtml(bp.name)}" data-mine="${isMine ? 1 : 0}">
        <div class="hc-title">${escapeHtml(bp.name)}</div>
        <div class="hc-desc">${escapeHtml(bp.desc || '사용자 설계')}</div>
        <div class="hc-stats">${Math.round(s.mass)} kg · ${(s.thrust / 1000).toFixed(0)} kN · ${s.wingArea.toFixed(0)} m²
          · 부품 ${s.partCount}</div>
        <div class="hc-btns">
          <button class="btn btn-primary" data-load="${escapeHtml(bp.name)}" data-mine="${isMine ? 1 : 0}">설계 열기</button>
          ${isMine ? `<button class="btn btn-ghost" data-del-design="${escapeHtml(bp.name)}">삭제</button>` : ''}
        </div></div>`;
    };
    const html = `
      <h5>기본 기체</h5><div class="hangar-grid">${PRESETS.map((p) => card(p, false)).join('')}</div>
      <h5>내 설계 (${mine.length})</h5><div class="hangar-grid">${mine.length ? mine.map((p) => card(p, true)).join('') : '<p class="hint">저장된 설계가 없습니다.</p>'}</div>`;
    this._modal('격납고 — 설계 불러오기', html);
    this.modal.querySelectorAll('[data-load]').forEach((b) => {
      b.onclick = () => {
        const name = b.dataset.load;
        const isMine = b.dataset.mine === '1';
        const bp = isMine ? loadDesigns().find((d) => d.name === name) : PRESETS.find((p) => p.name === name);
        if (bp) {
          this.setBlueprint(bp);
          this._renderInspector();
          this.modal.hidden = true;
          this.click('confirm');
        }
      };
    });
    this.modal.querySelectorAll('[data-del-design]').forEach((b) => {
      b.onclick = () => { deleteDesign(b.dataset.delDesign); this._openHangar(); };
    });
  }

  _openJson() {
    const json = JSON.stringify(this.bp, null, 2);
    this._modal('설계 JSON — 복사 / 붙여넣기', `
      <p class="hint">텍스트를 복사해 보관하거나, 다른 설계를 붙여넣고 [적용]을 누르세요.</p>
      <textarea class="json-area" spellcheck="false">${escapeHtml(json)}</textarea>
      <button class="btn btn-primary" id="json-apply">적용</button>`);
    const ta = this.modal.querySelector('.json-area');
    this.modal.querySelector('#json-apply').onclick = () => {
      try {
        const bp = JSON.parse(ta.value);
        if (!bp.parts) throw new Error('parts 배열이 없습니다');
        this.setBlueprint(bp);
        this._renderInspector();
        this.modal.hidden = true;
        this.click('confirm');
      } catch (err) {
        alert('JSON 오류: ' + err.message);
        if (this.audio) this.audio.ui('error');
      }
    };
  }
}

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`;
}
function toHexColor(v) {
  return '#' + (v === undefined ? 0xdde3ea : v).toString(16).padStart(6, '0');
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
