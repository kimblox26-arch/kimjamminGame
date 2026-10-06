// UI: 메뉴 · HUD · 공구바 · 카탈로그(썸네일 렌더) · 저장 슬롯 · 설정
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TOOLS, PAINTS } from './tools/tools.js';
import { CATALOG, CATS, partMass } from './build/catalog.js';
import { MATS } from './gfx/materials.js';
import { fmtKg } from './core/util.js';
import { Store } from './build/save.js';

const $ = (s) => document.querySelector(s);
const ICONS = {
  hand: '<path d="M8 14V6a1.5 1.5 0 0 1 3 0v6M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V5.5a1.5 1.5 0 0 1 3 0V12M17 12V8a1.5 1.5 0 0 1 3 0v6c0 4-2.5 7-7 7s-6-2-8-6l-2-4a1.5 1.5 0 0 1 2.6-1.5L8 14"/>',
  place: '<path d="M3 17l9 4 9-4M3 12l9 4 9-4M12 3l9 4-9 4-9-4 9-4z"/>',
  weld: '<path d="M4 20l7-7M9 11l4 4M13 15l4-4-4-4-4 4M17 11l3-3M19 3v2M21 5h-2M16 4l1 1M6 14l-2 2"/>',
  hammer: '<path d="M14 6l4 4-2 2-4-4M12 8l-9 9 2 2 9-9M13 4l3-1 5 5-1 3"/>',
  drill: '<path d="M3 9h11v5H3zM14 10.5h4M18 11.5h3M6 14v4h4l1-4M8 18v3"/>',
  trowel: '<path d="M4 20l10-4 4-10-10 4zM14 10l5-5M19 5l2-2"/>',
  grinder: '<circle cx="8" cy="15" r="5"/><path d="M8 15l12-8M17 4l4 4"/><path d="M3 13l-1-2M5 20l-1 2M11 21l1 2"/>',
  paint: '<path d="M6 8h8v4H6zM10 12v8M8 20h4M14 9h4M18 7l3-2M18 10l3 1M18 12l3 2"/>',
};

export class UI {
  constructor(g) {
    this.g = g; this.toastEl = $('#toasts'); this.catCat = 'steel'; this.helmetOn = false;
    this.buildHotbar();
    document.body.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) { g.sfx.play('ui'); this.act(b.dataset.act, b); } });
    this.initSettings();
  }
  state(s) { document.body.dataset.state = s; this.st = s; }
  loading(f, label) { $('#load-bar').style.width = (f * 100).toFixed(0) + '%'; $('#load-label').textContent = label; }
  act(a, el) {
    const g = this.g;
    switch (a) {
      case 'start': g.start(false); break;
      case 'continue': g.start(true); break;
      case 'help': this.back = this.st; this.state('help'); break;
      case 'settings': this.back = this.st; this.state('settings'); break;
      case 'back': this.state(this.back || 'menu'); if (this.back === 'play') g.resume(); break;
      case 'resume': g.resume(); break;
      case 'close': g.resume(); break;
      case 'menu': g.toMenu(); break;
      case 'clear': { // 대화상자 대신 두 번 눌러 확인
        const b = el.querySelector('b');
        if (!el.dataset.armed || performance.now() - +el.dataset.armed > 4000) { el.dataset.armed = performance.now(); b.textContent = '한 번 더 누르면 모두 지웁니다'; setTimeout(() => { delete el.dataset.armed; b.textContent = '작업장 비우기'; }, 4000); break; }
        delete el.dataset.armed; b.textContent = '작업장 비우기';
        if (g.driving) g.exitVehicle(); g.mgr.clearAll(); g.vehicles.seat = null; g.tools.undo = []; g.resume(); g.ui.toast('작업장을 비웠습니다'); break;
      }
      case 'save': g.save(+el.dataset.slot); this.renderSlots(); break;
      case 'load': g.load(+el.dataset.slot); break;
      case 'select': g.tools.selectItem(this.detailDef); g.tools.dims = this.detailDims.slice(); g.resume(); break;
    }
  }
  // ── 공구바 ──
  buildHotbar() {
    const hb = $('#hotbar');
    hb.innerHTML = TOOLS.map((t, i) => `<div class="slotb" data-i="${i}"><em>${i + 1}</em><svg viewBox="0 0 24 24">${ICONS[t.id]}</svg><span>${t.name}</span></div>`).join('');
    hb.addEventListener('click', (e) => { const s = e.target.closest('.slotb'); if (s) this.g.tools.select(+s.dataset.i); });
  }
  setTool(i) {
    document.querySelectorAll('.slotb').forEach((s, k) => s.classList.toggle('on', k === i));
    this.updateSel();
  }
  updateSel() {
    const t = this.g.tools, el = $('#sel');
    if (!t) return;
    if (t.tool === 'place') {
      const d = t.sel, dims = d.kit ? '' : d.shape === 'box' ? t.dims.map((x) => Math.round(x * 1000)).join('×') + ' mm' : d.resize ? 'L ' + Math.round(t.dims[0] * 1000) + ' mm' : '';
      el.innerHTML = `<b>${d.name}</b> ${dims} ${d.kit ? '' : '· ' + fmtKg(partMass(d, t.dims))} · <kbd>Tab</kbd> 변경`; el.classList.add('on');
    } else if (t.tool === 'paint') { const p = PAINTS[t.paintIdx]; el.innerHTML = `<i style="background:${p.c == null ? 'transparent' : '#' + p.c.toString(16).padStart(6, '0')}"></i><b>${p.n}</b>`; el.classList.add('on'); }
    else el.classList.remove('on');
  }
  setPaint() { this.updateSel(); }
  // ── HUD 갱신 ──
  hud(dt) {
    const t = this.g.tools;
    const h = this.g.driving ? '' : t.hint;
    if (h !== this._hint) { $('#hint').textContent = h; this._hint = h; }
    const inf = this.g.driving ? null : t.info, el = $('#info');
    const key = inf ? JSON.stringify(inf) : '';
    if (key !== this._info) {
      this._info = key; el.classList.toggle('on', !!inf);
      if (inf) el.innerHTML = `<h4>${inf.name}</h4><div class="sp">${inf.spec}</div><dl><dt>재질</dt><dd>${inf.mat}</dd><dt>질량</dt><dd>${inf.mass}</dd>${inf.joints ? `<dt>접합</dt><dd>${inf.joints}</dd><dt>접합 강도</dt><dd>${inf.strength}</dd>` : '<dt>접합</dt><dd style="color:#9aa0a6">없음 (자유)</dd>'}${inf.dents ? `<dt>찌그러짐</dt><dd>${inf.dents}곳</dd>` : ''}<dt>구조물</dt><dd>${inf.parts}개 부품 · ${inf.smass}</dd></dl>${inf.anchored ? '<div class="pin">⚓ 바닥에 앵커 고정됨</div>' : ''}`;
    }
    if (this.g.driving) $('#v-speed').textContent = Math.round(this.g.vehicles.speedKmh());
  }
  progress(f) { $('#ring').style.strokeDashoffset = (100.5 * (1 - Math.min(1, f))).toFixed(1); }
  helmet(on) { if (on !== this.helmetOn) { this.helmetOn = on; $('#helmet').classList.toggle('on', on && this.g.settings.helmet); } }
  toast(msg) {
    const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; this.toastEl.appendChild(d);
    while (this.toastEl.children.length > 4) this.toastEl.firstChild.remove();
    setTimeout(() => { d.style.transition = 'opacity .4s'; d.style.opacity = 0; setTimeout(() => d.remove(), 400); }, 3200);
  }
  driving(on) { document.body.classList.toggle('driving', on); }
  fps(v) { $('#fps').textContent = this.g.settings.fps ? v + ' FPS' : ''; }

  // ── 카탈로그 ──
  makeThumbs(mgr) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(180, 140); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
    const sc = new THREE.Scene(), pm = new THREE.PMREMGenerator(r); sc.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    const l = new THREE.DirectionalLight(0xffffff, 2.5); l.position.set(2, 4, 3); sc.add(l, new THREE.AmbientLight(0xffffff, 0.4));
    const cam = new THREE.PerspectiveCamera(30, 180 / 140, 0.01, 100);
    this.thumbs = {};
    for (const d of CATALOG) {
      if (d.kit) continue;
      const p = mgr.createPart(d, d.dims), o = p.mesh;
      const box = new THREE.Box3().setFromObject(o), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      o.position.sub(c); const g = new THREE.Group(); g.add(o); g.rotation.set(0.5, -0.7, 0); sc.add(g);
      const rad = Math.max(size.length() * 0.5, 0.05);
      cam.position.set(0, 0, rad / Math.tan((cam.fov * Math.PI) / 360) * 1.05); cam.lookAt(0, 0, 0);
      r.render(sc, cam); this.thumbs[d.id] = r.domElement.toDataURL('image/png'); sc.remove(g);
    }
    pm.dispose(); r.dispose(); r.forceContextLoss?.();
  }
  openCatalog() {
    const tabs = $('#cat-tabs');
    tabs.innerHTML = CATS.map((c) => `<button data-c="${c.id}" class="${c.id === this.catCat ? 'on' : ''}">${c.name}</button>`).join('');
    tabs.onclick = (e) => { const b = e.target.closest('button'); if (b) { this.catCat = b.dataset.c; this.openCatalog(); } };
    const grid = $('#cat-grid'), items = CATALOG.filter((d) => d.cat === this.catCat), cur = this.g.tools.sel;
    const kitIcon = { kart: '🏎️', buggy: '🚙', shed: '🏚️', wall: '🧱', tower: '🗼' };
    grid.innerHTML = items.map((d) => `<button class="item ${d === cur ? 'on' : ''}" data-id="${d.id}"><div class="th">${this.thumbs?.[d.id] ? `<img src="${this.thumbs[d.id]}">` : kitIcon[d.kit] || '▦'}</div><div class="tx"><b>${d.name}</b><span>${d.spec || ''}</span></div></button>`).join('');
    grid.onclick = (e) => { const b = e.target.closest('.item'); if (!b) return; const d = items.find((x) => x.id === b.dataset.id); grid.querySelectorAll('.item').forEach((x) => x.classList.toggle('on', x === b)); this.detail(d); if (e.detail === 2) this.act('select'); };
    this.detail(items.includes(cur) ? cur : items[0]);
  }
  detail(d) {
    this.detailDef = d; this.detailDims = d.dims ? (d === this.g.tools.sel ? this.g.tools.dims.slice() : d.dims.slice()) : [1, 1, 1];
    const el = $('#cat-detail'), m = MATS[d.mat];
    const names = ['길이(X)', '두께(Y)', '폭(Z)'];
    if (d.shape && d.shape !== 'box') { names[0] = '길이'; }
    const rows = d.resize ? Object.entries(d.resize).map(([ax, [lo, hi]]) => `<label class="dim-row"><div>${names[ax]}<output id="o${ax}">${Math.round(this.detailDims[ax] * 1000)} mm</output></div><input type="range" data-ax="${ax}" min="${lo}" max="${hi}" step="${hi - lo > 1 ? 0.01 : 0.001}" value="${this.detailDims[ax]}"></label>`).join('') : '';
    const st = () => d.kit ? '' : `<dl class="stats"><dt>재질</dt><dd>${m.name}</dd><dt>질량</dt><dd id="d-mass">${fmtKg(partMass(d, this.detailDims))}</dd>${m.density ? `<dt>밀도</dt><dd>${m.density} kg/m³</dd>` : ''}<dt>접합</dt><dd>${m.weld ? '용접 · ' : ''}${m.nail ? '못 · ' : ''}${m.masonry ? '모르타르 · ' : ''}볼트</dd>${d.power ? `<dt>출력</dt><dd>${d.power / 1000} kW</dd>` : ''}${d.thrust ? `<dt>추력</dt><dd>${d.thrust / 1000} kN</dd>` : ''}</dl>`;
    el.innerHTML = `<h3>${d.name}</h3><div class="spec">${d.spec || ''}</div>${st()}${rows}<button class="btn primary" data-act="select"><b>선택하고 배치하기</b><span>더블클릭으로도 선택</span></button>`;
    el.querySelectorAll('input[type=range]').forEach((inp) => inp.addEventListener('input', () => {
      const ax = +inp.dataset.ax; this.detailDims[ax] = +inp.value; $('#o' + ax).textContent = Math.round(+inp.value * 1000) + ' mm';
      $('#d-mass').textContent = fmtKg(partMass(d, this.detailDims));
    }));
  }
  // ── 저장 슬롯 ──
  renderSlots() {
    const el = $('#slots');
    el.innerHTML = [1, 2, 3].map((s) => {
      const inf = Store.info(s);
      return `<div class="slot"><div class="meta"><b>슬롯 ${s}</b>${inf ? `${new Date(inf.t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · 부품 ${inf.n}개` : '비어 있음'}</div><button data-act="save" data-slot="${s}">저장</button><button data-act="load" data-slot="${s}" ${inf ? '' : 'disabled'}>불러오기</button></div>`;
    }).join('');
  }
  menuInfo() {
    const inf = Store.info('auto');
    $('#btn-continue').disabled = !inf;
    $('#cont-info').textContent = inf ? `자동 저장 · 부품 ${inf.n}개` : '저장된 작업 없음';
  }
  initSettings() {
    const s = this.g.settings;
    const q = $('#s-quality'), sens = $('#s-sens'), fov = $('#s-fov'), vol = $('#s-vol'), hel = $('#s-helmet'), fps = $('#s-fps');
    q.value = s.quality; sens.value = s.sens; fov.value = s.fov; vol.value = s.vol; hel.checked = s.helmet; fps.checked = s.fps;
    const up = () => {
      const nq = q.value !== s.quality;
      Object.assign(s, { quality: q.value, sens: +sens.value, fov: +fov.value, vol: +vol.value, helmet: hel.checked, fps: fps.checked });
      this.g.applySettings(nq);
    };
    [q, sens, fov, vol, hel, fps].forEach((e) => e.addEventListener('change', up));
    [sens, fov, vol].forEach((e) => e.addEventListener('input', up));
  }
}
