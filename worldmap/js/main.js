// 세계 지도 편집기 — UI, 도구, 패널
import * as Wd from './world.js';
import { loadFlags, flagEl, drawFlag, flagCodes, drawLabels } from './labels.js';
import * as L from './labels.js';
import { View2D } from './view2d.js';
import { Globe } from './globe.js';
import * as store from './store.js';

const { M, W, H } = Wd;
window.WM = Wd; // 디버그용
const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const fmtArea = (a) => (a >= 1e6 ? (a / 1e6).toFixed(2) + '백만' : Math.round(a).toLocaleString('ko-KR')) + ' km²';
const isMobile = () => innerWidth < 760;
let toastT = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); }

// ── 상태 ──
const TOOLS = {
  select: { name: '선택', key: 'v', hint: '국가·지방을 눌러 선택하고 이름·색·국기를 바꿉니다. 끌면 지도 이동.' },
  pan: { name: '이동', key: 'h', hint: '끌어서 지도를 움직입니다. 휠·두 손가락으로 확대.' },
  prov: { name: '지방 칠하기', key: 'p', hint: '간편 모드: 지방을 누르거나 끌어서 선택한 국가 영토로 만듭니다.', paint: true },
  brush: { name: '브러시', key: 'b', hint: '정밀 모드: 국경을 픽셀 단위로 자유롭게 그립니다.', paint: true, brush: true },
  annex: { name: '국가 합병', key: 'f', hint: '국가를 누르면 그 국가 전체가 선택한 국가에 합병됩니다.', paint: true },
  split: { name: '지방 분할', key: 'x', hint: '칠한 부분이 새 지방으로 나뉩니다.', brush: true },
  erase: { name: '지우개', key: 'e', hint: '칠한 땅을 무주지(주인 없는 땅)로 만듭니다.', brush: true },
  land: { name: '땅 만들기', key: 'l', hint: '바다 위에 새 땅(섬)을 만듭니다. 선택한 국가의 영토가 됩니다.', paint: true, brush: true },
  sea: { name: '바다 만들기', key: 'o', hint: '땅을 바다로 바꿉니다.', brush: true },
  label: { name: '도시·라벨', key: 't', hint: '도시·바다 이름을 눌러 수정하고 끌어서 옮깁니다. 빈 곳을 누르면 새 도시.' },
  pick: { name: '스포이드', key: 'i', hint: '누른 곳의 국가를 칠할 국가로 고릅니다.' },
};
const st = { tool: 'select', brushC: -1, size: 10, view: '2d' };

// ── 보기 ──
const stage = $('#stage'), c2d = $('#c2d'), c3d = $('#c3d'), ov = $('#ov');
const v2 = new View2D(c2d, ov), gl = new Globe(c3d, ov);
let view = v2, needs = true;
const need = () => { needs = true; };
const kNow = () => (view === v2 ? v2.z : gl.k());
function resize() {
  const r = stage.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
  for (const c of [c2d, ov]) { c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); }
  v2.resize(r.width, r.height, d); gl.resize(r.width, r.height, d); need();
}
let hover = null;
function frame() {
  if (needs) {
    needs = false;
    if (view.draw()) needs = true;
    if (hover && TOOLS[st.tool].brush) {
      const g = ov.getContext('2d'), r = Math.max(1, Math.round(st.size / kNow())) * kNow();
      g.beginPath(); g.arc(hover[0], hover[1], Math.max(2, r), 0, Math.PI * 2);
      g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 2; g.stroke(); g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke();
    }
  }
  requestAnimationFrame(frame);
}
function setView(v) {
  if (v === st.view) return;
  if (v === '3d') {
    try { gl.init(); } catch (e) { toast('이 기기는 3D(WebGL)를 지원하지 않습니다'); return; }
    gl.resize(v2.w, v2.h, v2.dpr); gl.flyTo(v2.cx, v2.cy); gl.markDirty();
    gl.dist = Math.max(1.12, 1 + 3 * Math.min(1, 1.8 * v2.minZ() / v2.z));
    view = gl;
  } else {
    const [lon, lat] = [gl.lon, gl.lat];
    v2.flyTo(...Wd.mapXY(((lon + 540) % 360) - 180, lat)); v2.z = v2.minZ() * 1.8 * Math.max(1, 3 / (gl.dist - 1)); v2.clamp(); view = v2;
  }
  st.view = v;
  document.body.dataset.view = v;
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  need();
}
function flyToCountry(o) {
  const s = M.cstat[o]; if (!s || s.root < 0) return;
  const span = Math.max(40, s.bx[2] - s.bx[0], (s.bx[3] - s.bx[1]) * 1.6);
  view.flyTo(s.lx, s.ly, span); need();
}

// ── 이벤트 연결 ──
let listT = 0, saveT = 0;
Wd.on((t) => {
  if (t === 'map') { gl.markDirty(); need(); }
  if (t === 'labels') need();
  if (t === 'data') { need(); clearTimeout(listT); listT = setTimeout(() => { refreshList(); renderInfo(); refreshChip(); }, 120); }
  if (t === 'sel') { renderInfo(); markListSel(); need(); }
  if (t === 'hist') {
    $('#undo').disabled = !Wd.canUndo(); $('#redo').disabled = !Wd.canRedo();
    clearTimeout(saveT); saveT = setTimeout(autosave, 2500);
  }
});

// ── 도구 막대 ──
const ICON = {
  select: 'M5 3l13 8-6 1.5L15 19l-2.5 1-3-6.5L5 17z',
  pan: 'M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3',
  prov: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  brush: 'M18 3l3 3-9.5 9.5-3-3zM8.5 12.5l3 3c0 3-2.5 5.5-7.5 5.5 1.5-1.5 1-3 1.5-4.5s1.5-3.5 3-4z',
  annex: 'M4 12h10M10 7l5 5-5 5M18 4v16',
  split: 'M6 4a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5zM6 15a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5zM8 8l12 10M8 16L20 6',
  erase: 'M16 3l5 5-10 10H6l-3-3zM11 18h10M9 9l6 6',
  land: 'M3 19l6-9 4 5 3-3 5 7zM16 5a2 2 0 1 0 0 4 2 2 0 1 0 0-4z',
  sea: 'M2 9c3-2 5 2 8 0s5-2 8 0 4 0 4 0M2 15c3-2 5 2 8 0s5-2 8 0 4 0 4 0',
  label: 'M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12zM12 6.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z',
  pick: 'M19 5l-2-2-4 4-1.5-1.5L10 7l7 7 1.5-1.5L17 11l4-4zM12 9l-8 8v3h3l8-8',
};
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
for (const [id, t] of Object.entries(TOOLS)) {
  $('#tools').append(h('button', { 'data-tool': id, title: `${t.name} (${t.key.toUpperCase()})`, html: svg(ICON[id]) + `<span>${t.name}</span>`, onclick: () => setTool(id) }));
}
function setTool(id) {
  st.tool = id;
  document.querySelectorAll('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === id));
  const t = TOOLS[id];
  $('#hint').textContent = t.hint;
  $('#sizeWrap').hidden = !t.brush;
  $('#brushCountry').hidden = !t.paint;
  stage.dataset.tool = id;
  need();
}
function setBrush(o) {
  st.brushC = o; refreshChip();
  document.querySelectorAll('.crow .mini').forEach((b) => b.classList.toggle('on', +b.dataset.i === o));
}
function refreshChip() {
  if (st.brushC >= 0 && !(M.countries[st.brushC] && M.countries[st.brushC].alive)) st.brushC = -1;
  const c = M.countries[st.brushC], b = $('#brushCountry');
  b.textContent = '';
  b.append(h('small', {}, '칠할 국가'), c ? flagEl(c.flag, 22) : '', h('span', { class: 'sw', style: `background:${c ? c.color : M.opts.neutral}` }), h('b', {}, c ? c.name : '무주지'), h('i', {}, '▾'));
}
$('#brushCountry').onclick = async () => { const o = await pickCountry('어느 국가로 칠할까요?'); if (o != null) setBrush(o); };
$('#size').oninput = (e) => { st.size = +e.target.value; $('#sizeVal').textContent = st.size; need(); };

// ── 포인터 ──
const ptrs = new Map();
let drag = null, spaceDown = false;
const pos = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
const radius = () => Math.max(0, Math.round(st.size / kNow()));
function endDrag() {
  if (!drag) return;
  if (drag.type === 'stroke') Wd.strokeEnd();
  if (drag.type === 'prov') Wd.endGroup();
  drag = null;
}
ov.addEventListener('contextmenu', (e) => e.preventDefault());
ov.addEventListener('pointerdown', (e) => {
  ov.setPointerCapture(e.pointerId);
  const p = pos(e); ptrs.set(e.pointerId, p);
  if (ptrs.size === 2) {
    endDrag();
    const [a, b] = [...ptrs.values()];
    drag = { type: 'pinch', d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
    return;
  }
  if (ptrs.size > 2) return;
  const tool = st.tool;
  if (e.button === 1 || e.button === 2 || spaceDown || tool === 'pan') { drag = { type: 'pan', p }; return; }
  const m = view.toMap(...p);
  if (tool === 'label') {
    const hit = L.hits.find((q) => (q.dot && Math.hypot(q.dot[0] - p[0], q.dot[1] - p[1]) < 12) || (p[0] > q.r[0] && p[0] < q.r[2] && p[1] > q.r[1] && p[1] < q.r[3]));
    if (hit) { const it = hit.type === 'city' ? M.cities[hit.i] : M.oceans[hit.i]; drag = { type: 'label', hit, it, p0: p, orig: [it.lon, it.lat], moved: false }; return; }
  }
  if (TOOLS[tool].brush && m) {
    const mode = { brush: 'own', erase: 'own', split: 'split', land: 'land', sea: 'sea' }[tool];
    Wd.strokeBegin(mode, tool === 'erase' ? -1 : st.brushC);
    Wd.strokeLine(m[0], m[1], m[0], m[1], radius());
    drag = { type: 'stroke', last: m }; return;
  }
  if (tool === 'prov') { Wd.beginGroup(); drag = { type: 'prov', last: p }; paintProvAt(p); return; }
  drag = { type: 'click', p0: p, p };
});
ov.addEventListener('pointermove', (e) => {
  const p = pos(e);
  if (e.pointerType === 'mouse') { hover = p; showTip(p); if (TOOLS[st.tool].brush) need(); }
  if (!ptrs.has(e.pointerId)) return;
  const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, p);
  if (!drag) return;
  if (drag.type === 'pinch' && ptrs.size === 2) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    view.pan(m[0] - drag.m[0], m[1] - drag.m[1]); view.zoomAt(m[0], m[1], d / drag.d);
    drag.d = d; drag.m = m; need(); return;
  }
  if (drag.type === 'click' && Math.hypot(p[0] - drag.p0[0], p[1] - drag.p0[1]) > 6) drag = { type: 'pan', p: prev };
  if (drag.type === 'pan') { view.pan(p[0] - drag.p[0], p[1] - drag.p[1]); drag.p = p; need(); }
  else if (drag.type === 'stroke') {
    const m = view.toMap(...p); if (!m) return;
    Wd.strokeLine(drag.last[0], drag.last[1], m[0], m[1], radius()); drag.last = m;
  } else if (drag.type === 'prov') {
    const n = Math.ceil(Math.hypot(p[0] - drag.last[0], p[1] - drag.last[1]) / 4);
    for (let k = 1; k <= n; k++) paintProvAt([drag.last[0] + (p[0] - drag.last[0]) * k / n, drag.last[1] + (p[1] - drag.last[1]) * k / n]);
    drag.last = p;
  } else if (drag.type === 'label') {
    if (Math.hypot(p[0] - drag.p0[0], p[1] - drag.p0[1]) > 4) drag.moved = true;
    const m = view.toMap(...p);
    if (drag.moved && m) { [drag.it.lon, drag.it.lat] = Wd.lonlat(((m[0] % W) + W) % W, m[1]); need(); }
  }
});
const up = (e) => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (drag && drag.type === 'pinch') { if (ptrs.size === 0) drag = null; return; }
  if (!drag) return;
  const d = drag;
  if (d.type === 'click') { drag = null; click(d.p0); return; }
  if (d.type === 'label') {
    drag = null;
    if (!d.moved) { labelDialog(d.hit.type, d.hit.i); return; }
    const it = d.it, a = d.orig, b = [it.lon, it.lat];
    Wd.push({ undo() { [it.lon, it.lat] = a; need(); }, redo() { [it.lon, it.lat] = b; need(); } });
    return;
  }
  endDrag();
};
ov.addEventListener('pointerup', up);
ov.addEventListener('pointercancel', up);
ov.addEventListener('pointerleave', () => { hover = null; $('#tip').hidden = true; need(); });
ov.addEventListener('wheel', (e) => { e.preventDefault(); const p = pos(e); view.zoomAt(p[0], p[1], Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016))); need(); }, { passive: false });
$('#zin').onclick = () => { view.zoomAt(v2.w / 2, v2.h / 2, 1.5); need(); };
$('#zout').onclick = () => { view.zoomAt(v2.w / 2, v2.h / 2, 1 / 1.5); need(); };

const provAt = (p) => { const m = view.toMap(...p); return m ? Wd.pixelAt(m[0], m[1]) : 0; };
function paintProvAt(p) { const q = provAt(p); if (q && M.own[q] !== st.brushC) Wd.setOwner([q], st.brushC); }
const cname = (o) => (o >= 0 && M.countries[o] ? M.countries[o].name : '무주지');
function showTip(p) {
  const tip = $('#tip');
  if (drag || isMobile()) { tip.hidden = true; return; }
  const q = provAt(p);
  if (!q) { tip.hidden = true; return; }
  tip.hidden = false;
  tip.textContent = `${M.prov[q].name} · ${cname(M.own[q])}`;
  tip.style.transform = `translate(${p[0] + 14}px, ${p[1] + 14}px)`;
}
function click(p) {
  const tool = st.tool, q = provAt(p), o = q ? M.own[q] : -1;
  if (tool === 'select') {
    Wd.select(q ? o : -1, q);
    if (q) { showTab('info'); if (isMobile()) openPanel(true); }
  } else if (tool === 'pick') {
    if (q) { setBrush(o); toast(`칠할 국가: ${cname(o)}`); }
  } else if (tool === 'annex') {
    if (!q || o === st.brushC) return;
    if (o < 0) { Wd.setOwner([q], st.brushC); return; }
    Wd.setOwner(Wd.provsOf(o), st.brushC);
    toast(`${cname(st.brushC)} ← ${cname(o)} 합병`);
  } else if (tool === 'label') {
    const m = view.toMap(...p); if (m) labelDialog('new', -1, Wd.lonlat(((m[0] % W) + W) % W, m[1]));
  }
}

// ── 키보드 ──
addEventListener('keydown', (e) => {
  if (e.target.closest('input,textarea,select')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? Wd.redo() : Wd.undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); Wd.redo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === ' ') { spaceDown = true; e.preventDefault(); return; }
  if (k === '[' || k === ']') { st.size = Math.max(1, Math.min(60, st.size + (k === ']' ? 2 : -2))); $('#size').value = st.size; $('#sizeVal').textContent = st.size; need(); return; }
  if (k === 'g') { setView(st.view === '2d' ? '3d' : '2d'); return; }
  if (k === 'escape') { closeModal(); closePops(); return; }
  for (const [id, t] of Object.entries(TOOLS)) if (t.key === k) setTool(id);
});
addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });

// ── 패널 ──
function openPanel(on) { document.body.classList.toggle('panel-open', on); }
$('#panelBtn').onclick = () => openPanel(!document.body.classList.contains('panel-open'));
$('#panelClose').onclick = () => openPanel(false);
function showTab(t) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  $('#tab-list').hidden = t !== 'list'; $('#tab-info').hidden = t !== 'info';
}
document.querySelectorAll('.tabs button').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
let listLimit = 300;
$('#search').oninput = () => { listLimit = 300; refreshList(); };
$('#sort').onchange = refreshList;
$('#addCountry').onclick = async () => { const o = await newCountryDialog(); if (o != null) { setBrush(o); selectCountry(o, false); if (!TOOLS[st.tool].paint) setTool('prov'); } };
const aliveIdx = () => M.countries.map((c, i) => i).filter((i) => M.countries[i].alive);
function sorted(q, sort = 'area') {
  q = q.trim().toLowerCase();
  const arr = aliveIdx().filter((i) => !q || M.countries[i].name.toLowerCase().includes(q) || (M.countries[i].en || '').toLowerCase().includes(q));
  const s = (i) => M.cstat[i] || { area: 0, np: 0 };
  if (sort === 'name') arr.sort((a, b) => M.countries[a].name.localeCompare(M.countries[b].name, 'ko'));
  else if (sort === 'prov') arr.sort((a, b) => s(b).np - s(a).np);
  else arr.sort((a, b) => s(b).area - s(a).area);
  return arr;
}
function refreshList() {
  const arr = sorted($('#search').value, $('#sort').value), box = $('#clist');
  box.textContent = '';
  $('#count').textContent = `${arr.length}개국`;
  for (const i of arr.slice(0, listLimit)) {
    const c = M.countries[i], s = M.cstat[i] || {};
    box.append(h('div', { class: 'crow' + (i === M.sel ? ' sel' : ''), 'data-i': i, onclick: () => selectCountry(i, true) },
      h('span', { class: 'sw', style: `background:${c.color}` }), flagEl(c.flag, 26),
      h('div', { class: 'cn' }, h('b', {}, c.name), h('small', {}, s.area ? `${fmtArea(s.area)} · 지방 ${s.np}` : '영토 없음')),
      h('button', { class: 'mini' + (i === st.brushC ? ' on' : ''), 'data-i': i, title: '이 국가로 칠하기', html: svg(ICON.brush), onclick: (e) => { e.stopPropagation(); setBrush(i); if (!TOOLS[st.tool].paint) setTool('prov'); toast(`칠할 국가: ${c.name}`); } })));
  }
  if (arr.length > listLimit) box.append(h('button', { class: 'btn more', onclick: () => { listLimit += 300; refreshList(); } }, `더 보기 (${arr.length - listLimit})`));
}
function markListSel() { document.querySelectorAll('.crow').forEach((r) => r.classList.toggle('sel', +r.dataset.i === M.sel)); }
function selectCountry(o, fly) {
  Wd.select(o, 0); showTab('info');
  if (fly) { flyToCountry(o); if (isMobile()) openPanel(false); }
}
const rankOf = (o) => aliveIdx().filter((i) => (M.cstat[i] || {}).area > (M.cstat[o] || {}).area).length + 1;

function renderInfo() {
  const box = $('#tab-info'), o = M.sel, p = M.selProv, key = o + ':' + p;
  if (box.dataset.key === key && box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  box.dataset.key = key; box.textContent = '';
  if (o < 0 && !p) { box.append(h('p', { class: 'empty' }, '지도에서 국가나 지방을 눌러 선택하세요.')); return; }
  if (o >= 0 && M.countries[o]) {
    const c = M.countries[o], s = M.cstat[o] || {};
    box.append(h('div', { class: 'card' },
      h('div', { class: 'chead' },
        h('button', { class: 'flagbtn', title: '국기 바꾸기', onclick: () => flagDialog(o) }, flagEl(c.flag, 84), h('span', {}, '국기 바꾸기')),
        h('div', { class: 'grow' },
          h('label', { class: 'lab' }, '국가 이름'),
          h('input', { class: 'big', value: c.name, onchange: (e) => Wd.setCountry(o, 'name', e.target.value.trim() || c.name) }),
          h('div', { class: 'row' }, h('label', { class: 'lab' }, '색상'), h('input', { type: 'color', value: c.color, onchange: (e) => Wd.setCountry(o, 'color', e.target.value) }),
            c.en && c.en !== c.name ? h('small', { class: 'en' }, c.en) : ''))),
      h('div', { class: 'stats' },
        h('div', {}, h('b', {}, s.area ? fmtArea(s.area) : '-'), h('small', {}, '면적')),
        h('div', {}, h('b', {}, s.np || 0), h('small', {}, '지방')),
        h('div', {}, h('b', {}, s.area ? '#' + rankOf(o) : '-'), h('small', {}, '면적 순위'))),
      h('div', { class: 'btns' },
        h('button', { class: 'btn pri', onclick: () => { setBrush(o); if (!TOOLS[st.tool].paint) setTool('prov'); toast(`칠할 국가: ${c.name}`); } }, '이 국가로 칠하기'),
        h('button', { class: 'btn', onclick: () => flyToCountry(o) }, '지도에서 보기'),
        h('button', { class: 'btn', onclick: () => pickImage(640, 'image/jpeg', (url) => Wd.setCountryBg(o, url)) }, c.bg ? '배경 사진 바꾸기' : '배경 사진 넣기'),
        c.bg ? h('button', { class: 'btn', onclick: () => Wd.setCountry(o, 'bg', '') }, '사진 지우기') : '',
        h('button', { class: 'btn', onclick: async () => { const t = await pickCountry(`${c.name}을(를) 어느 국가에 합병할까요?`, { none: false }); if (t != null && t !== o) { Wd.setOwner(Wd.provsOf(o), t); Wd.select(t, 0); } } }, '다른 국가에 합병'),
        h('button', { class: 'btn', onclick: () => dissolve(o) }, '지방별로 해체'),
        h('button', { class: 'btn danger', onclick: () => deleteCountry(o) }, '국가 삭제'))));
  } else box.append(h('div', { class: 'card' }, h('b', {}, '무주지'), h('p', { class: 'muted' }, '어느 국가에도 속하지 않은 땅입니다.')));
  const q = M.prov[p];
  if (p && q) {
    box.append(h('div', { class: 'card' },
      h('label', { class: 'lab' }, '지방 이름'),
      h('input', { value: q.name, onchange: (e) => { const v = e.target.value.trim(), old = q.name; if (v && v !== old) Wd.act(() => { q.name = v; Wd.emit('data'); }, () => { q.name = old; Wd.emit('data'); }); } }),
      h('div', { class: 'stats' },
        h('div', {}, h('b', {}, fmtArea(q.area || 0)), h('small', {}, '면적')),
        h('div', {}, h('b', {}, cname(M.own[p])), h('small', {}, '소속'))),
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: async () => { const t = await pickCountry('이 지방을 어느 국가에 넘길까요?'); if (t != null) { Wd.setOwner([p], t); Wd.select(t, p); } } }, '소속 바꾸기'),
        h('button', { class: 'btn', onclick: () => { Wd.beginGroup(); const i = Wd.addCountry({ name: q.name, en: q.en }); Wd.setOwner([p], i); Wd.endGroup(); Wd.select(i, p); toast(`${q.name} 독립!`); } }, '독립시키기'),
        M.own[p] >= 0 ? h('button', { class: 'btn', onclick: () => Wd.setOwner([p], -1) }, '무주지로 만들기') : '')));
  }
}
function dissolve(o) {
  const ps = Wd.provsOf(o);
  if (ps.length < 2 || !confirm(`${M.countries[o].name}을(를) 지방 ${ps.length}개의 독립국으로 해체할까요?`)) return;
  Wd.beginGroup();
  ps.forEach((p, k) => { if (k === 0) { Wd.setCountry(o, 'name', M.prov[p].name); return; } const i = Wd.addCountry({ name: M.prov[p].name, en: M.prov[p].en }); Wd.setOwner([p], i); });
  Wd.endGroup();
}
function deleteCountry(o) {
  const c = M.countries[o];
  if (!confirm(`${c.name}을(를) 삭제할까요? 영토는 무주지가 됩니다.`)) return;
  Wd.beginGroup(); Wd.setOwner(Wd.provsOf(o), -1);
  Wd.act(() => { c.alive = false; Wd.emit('data'); }, () => { c.alive = true; Wd.emit('data'); });
  Wd.endGroup(); Wd.select(-1, 0);
}

// ── 모달 ──
let modalCancel = null;
function openModal(content, onCancel, wide) {
  closePops();
  const m = $('#modal'), d = $('#modal .dlg');
  d.textContent = ''; d.classList.toggle('wide', !!wide);
  d.append(h('button', { class: 'x', onclick: () => closeModal(true), html: '&times;' }), content);
  m.hidden = false; modalCancel = onCancel;
}
function closeModal(cancel) {
  const m = $('#modal'); if (m.hidden) return;
  m.hidden = true;
  if (cancel && modalCancel) modalCancel();
  modalCancel = null;
}
$('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') closeModal(true); });

function pickCountry(title, { none = true, create = true } = {}) {
  return new Promise((res) => {
    const list = h('div', { class: 'plist' });
    const close = (v) => { modalCancel = null; closeModal(); res(v); };
    const fill = () => {
      list.textContent = '';
      for (const i of sorted(inp.value).slice(0, 250)) {
        const c = M.countries[i], s = M.cstat[i] || {};
        list.append(h('div', { class: 'crow', onclick: () => close(i) }, h('span', { class: 'sw', style: `background:${c.color}` }), flagEl(c.flag, 26), h('div', { class: 'cn' }, h('b', {}, c.name), h('small', {}, s.area ? fmtArea(s.area) : '영토 없음'))));
      }
    };
    const inp = h('input', { placeholder: '국가 검색', oninput: fill });
    openModal(h('div', {}, h('h3', {}, title), inp,
      h('div', { class: 'row gap' },
        none ? h('button', { class: 'btn', onclick: () => close(-1) }, '무주지') : '',
        create ? h('button', { class: 'btn pri', onclick: async () => { modalCancel = null; const i = await newCountryDialog(); res(i); } }, '+ 새 국가 만들기') : ''),
      list), () => res(null));
    fill(); if (!isMobile()) inp.focus();
  });
}
function newCountryDialog() {
  return new Promise((res) => {
    const name = h('input', { value: '', placeholder: '예: 대한제국' }), color = h('input', { type: 'color', value: Wd.randColor() });
    const ok = () => { const n = name.value.trim() || '새 국가'; modalCancel = null; closeModal(); res(Wd.addCountry({ name: n, color: color.value })); };
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    openModal(h('div', {}, h('h3', {}, '새 국가 만들기'), h('label', { class: 'lab' }, '국가 이름'), name,
      h('div', { class: 'row gap' }, h('label', { class: 'lab' }, '색상'), color),
      h('p', { class: 'muted' }, '만든 뒤 지방 칠하기·브러시로 영토를 그리세요. 국기는 국가 정보에서 바꿀 수 있습니다.'),
      h('div', { class: 'row end' }, h('button', { class: 'btn pri', onclick: ok }, '만들기'))), () => res(null));
    setTimeout(() => name.focus(), 50);
  });
}

// 이미지 선택 → 축소한 dataURL
function pickImage(max, type, cb, crop) {
  const inp = $('#fileIn'); inp.accept = 'image/*'; inp.value = '';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const im = new Image();
    im.onload = () => {
      const cv = document.createElement('canvas'), g = cv.getContext('2d');
      if (crop) {
        cv.width = crop[0]; cv.height = crop[1];
        const k = Math.max(crop[0] / im.width, crop[1] / im.height);
        g.drawImage(im, (crop[0] - im.width * k) / 2, (crop[1] - im.height * k) / 2, im.width * k, im.height * k);
      } else {
        const k = Math.min(1, max / Math.max(im.width, im.height));
        cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k); g.drawImage(im, 0, 0, cv.width, cv.height);
      }
      cb(cv.toDataURL(type, 0.85)); URL.revokeObjectURL(im.src);
    };
    im.src = URL.createObjectURL(f);
  };
  inp.click();
}

// ── 국기 ──
let isoNames = {};
function drawMade(g, w, hh, f) {
  const [a, b, c] = f.c;
  g.fillStyle = a; g.fillRect(0, 0, w, hh);
  let ex = w / 2, ey = hh / 2, er = hh * 0.2;
  g.fillStyle = b;
  switch (f.pat) {
    case 'h3': g.fillRect(0, hh / 3, w, hh / 3 + 1); g.fillStyle = c; g.fillRect(0, hh * 2 / 3, w, hh / 3 + 1); break;
    case 'v3': g.fillRect(w / 3, 0, w / 3 + 1, hh); g.fillStyle = c; g.fillRect(w * 2 / 3, 0, w / 3 + 1, hh); break;
    case 'h2': g.fillRect(0, hh / 2, w, hh / 2); break;
    case 'v2': g.fillRect(w / 2, 0, w / 2, hh); break;
    case 'cross': g.fillRect(w * 0.28, 0, w * 0.17, hh); g.fillRect(0, hh * 0.41, w, hh * 0.18); g.fillStyle = c; g.fillRect(w * 0.315, 0, w * 0.1, hh); g.fillRect(0, hh * 0.455, w, hh * 0.09); ex = w * 0.365; ey = hh / 2; er = 0; break;
    case 'diag': g.beginPath(); g.moveTo(w, 0); g.lineTo(w, hh); g.lineTo(0, hh); g.fill(); g.strokeStyle = c; g.lineWidth = hh * 0.2; g.beginPath(); g.moveTo(0, hh); g.lineTo(w, 0); g.stroke(); break;
    case 'tri': g.fillRect(0, hh / 2, w, hh / 2); g.fillStyle = c; g.beginPath(); g.moveTo(0, 0); g.lineTo(w * 0.42, hh / 2); g.lineTo(0, hh); g.fill(); ex = w * 0.15; er = hh * 0.13; break;
    case 'canton': for (let i = 1; i < 7; i += 2) g.fillRect(0, hh * i / 7, w, hh / 7); g.fillStyle = c; g.fillRect(0, 0, w * 0.44, hh * 4 / 7); ex = w * 0.22; ey = hh * 2 / 7; er = hh * 0.16; break;
    case 'border': g.fillRect(w * 0.1, hh * 0.13, w * 0.8, hh * 0.74); break;
    default: break;
  }
  g.fillStyle = f.ec;
  if (f.em === 'star' && er) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? er * 0.4 : er, t = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(ex + r * Math.cos(t), ey + r * Math.sin(t)); }
    g.fill();
  } else if (f.em === 'circle' && er) { g.beginPath(); g.arc(ex, ey, er, 0, Math.PI * 2); g.fill(); }
  else if (f.em === 'moon' && er) {
    g.beginPath(); g.arc(ex, ey, er, 0, Math.PI * 2); g.arc(ex + er * 0.4, ey - er * 0.1, er * 0.8, 0, Math.PI * 2, true); g.fill('evenodd');
  }
}
function flagDialog(o) {
  const c = M.countries[o];
  const set = (v) => { Wd.setCountry(o, 'flag', v); closeModal(); };
  const body = h('div', {});
  const tabs = h('div', { class: 'seg' });
  const pages = {};
  const show = (k) => { for (const [id, el] of Object.entries(pages)) el.hidden = id !== k; tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k)); };
  [['lib', '기본 국기'], ['make', '직접 만들기'], ['photo', '사진']].forEach(([k, t]) => tabs.append(h('button', { 'data-k': k, onclick: () => show(k) }, t)));
  // 기본 국기
  const grid = h('div', { class: 'fgrid' });
  const fq = h('input', { placeholder: '국가 이름 또는 코드로 검색', oninput: () => fillGrid() });
  const fillGrid = () => {
    grid.textContent = '';
    const q = fq.value.trim().toLowerCase();
    for (const code of flagCodes()) {
      const nm = isoNames[code] || code.toUpperCase();
      if (q && !nm.toLowerCase().includes(q) && !code.includes(q)) continue;
      grid.append(h('button', { class: 'fcell' + (c.flag === code ? ' on' : ''), title: nm, onclick: () => set(code) }, flagEl(code, 48), h('small', {}, nm)));
    }
  };
  pages.lib = h('div', {}, fq, grid);
  // 직접 만들기
  const f = { pat: 'h3', c: [Wd.randColor(), '#ffffff', Wd.randColor()], em: 'none', ec: '#ffffff' };
  const pv = h('canvas', { width: 240, height: 180, class: 'fpreview' });
  const redraw = () => drawMade(pv.getContext('2d'), 240, 180, f);
  const pats = h('div', { class: 'pats' });
  for (const p of ['h3', 'v3', 'h2', 'v2', 'cross', 'diag', 'tri', 'canton', 'border', 'plain']) {
    const cv = h('canvas', { width: 48, height: 36 }); drawMade(cv.getContext('2d'), 48, 36, { ...f, pat: p, c: ['#c9302c', '#ffffff', '#1f4e9c'], em: 'none' });
    pats.append(h('button', { class: 'pat', onclick: () => { f.pat = p; redraw(); } }, cv));
  }
  const cin = (i) => h('input', { type: 'color', value: f.c[i], oninput: (e) => { f.c[i] = e.target.value; redraw(); } });
  pages.make = h('div', {}, pv, h('label', { class: 'lab' }, '무늬'), pats,
    h('div', { class: 'row gap' }, h('label', { class: 'lab' }, '색'), cin(0), cin(1), cin(2)),
    h('div', { class: 'row gap' }, h('label', { class: 'lab' }, '문양'),
      h('select', { onchange: (e) => { f.em = e.target.value; redraw(); } }, ...[['none', '없음'], ['star', '별'], ['circle', '원'], ['moon', '초승달']].map(([v, t]) => h('option', { value: v }, t))),
      h('input', { type: 'color', value: f.ec, oninput: (e) => { f.ec = e.target.value; redraw(); } })),
    h('div', { class: 'row end' }, h('button', { class: 'btn pri', onclick: () => set(pv.toDataURL('image/png')) }, '이 국기 사용')));
  redraw();
  pages.photo = h('div', { class: 'center' }, h('p', { class: 'muted' }, '사진이나 그림을 국기로 사용합니다. (4:3 비율로 잘립니다)'),
    h('button', { class: 'btn pri', onclick: () => pickImage(0, 'image/png', (url) => set(url), [160, 120]) }, '이미지 고르기'));
  body.append(h('h3', {}, `${c.name}의 국기`), tabs, pages.lib, pages.make, pages.photo,
    h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: () => set('') }, '국기 없음')));
  openModal(body, null, true);
  show('lib'); fillGrid();
}

// ── 도시·바다 라벨 ──
function labelDialog(type, i, ll) {
  if (type === 'new' && !Wd.pixelAt(...Wd.mapXY(ll[0], ll[1]))) type = 'newOcean';
  const isNew = type === 'new' || type === 'newOcean', isCity = type === 'city' || type === 'new';
  const arr = isCity ? M.cities : M.oceans;
  const it = isNew ? { name: '', lon: ll[0], lat: ll[1], rank: isCity ? 4 : 2, cap: false } : arr[i];
  const name = h('input', { value: it.name, placeholder: '이름' });
  const cap = h('input', { type: 'checkbox', checked: !!it.cap });
  const rank = h('select', {}, ...(isCity ? [[0, '아주 큼'], [2, '큼'], [4, '보통'], [6, '작음'], [9, '아주 작음']] : [[0, '대양'], [1, '큰 바다'], [2, '바다'], [3, '만·해협'], [4, '작은 만']]).map(([v, t]) => h('option', { value: v }, t)));
  rank.value = [...rank.options].reduce((b, op) => (Math.abs(+op.value - it.rank) < Math.abs(+b - it.rank) ? op.value : b), rank.options[0].value);
  const save = () => {
    const nv = { name: name.value.trim() || it.name || (isCity ? '새 도시' : '새 바다'), rank: +rank.value };
    if (isCity) nv.cap = cap.checked;
    if (isNew) { const c = { lon: it.lon, lat: it.lat, ...nv }; Wd.act(() => { arr.push(c); need(); }, () => { arr.splice(arr.indexOf(c), 1); need(); }); }
    else { const old = { name: it.name, rank: it.rank, cap: it.cap }; Wd.act(() => { Object.assign(it, nv); need(); }, () => { Object.assign(it, old); need(); }); }
    closeModal();
  };
  const remove = () => { const k = arr.indexOf(it); Wd.act(() => { arr.splice(arr.indexOf(it), 1); need(); }, () => { arr.splice(k, 0, it); need(); }); closeModal(); };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  const title = { new: '새 도시', newOcean: '새 바다 이름', city: '도시 편집', ocean: '바다 이름 편집' }[type];
  openModal(h('div', {},
    h('h3', {}, title),
    h('label', { class: 'lab' }, '이름'), name,
    h('div', { class: 'row gap' }, h('label', { class: 'lab' }, '크기'), rank, isCity ? h('label', { class: 'chk' }, cap, ' 수도') : ''),
    h('div', { class: 'row end gap' }, !isNew ? h('button', { class: 'btn danger', onclick: remove }, '삭제') : '', h('button', { class: 'btn pri', onclick: save }, '저장'))));
  setTimeout(() => name.focus(), 50);
}

// ── 팝오버 (표시 / 파일) ──
function closePops() { document.querySelectorAll('.pop').forEach((p) => { p.hidden = true; }); }
function togglePop(id, btn, build) {
  const p = $(id), was = !p.hidden; closePops();
  if (was) return;
  p.textContent = ''; build(p); p.hidden = false;
  const r = btn.getBoundingClientRect();
  p.style.top = r.bottom + 6 + 'px'; p.style.right = Math.max(8, innerWidth - r.right) + 'px';
}
addEventListener('pointerdown', (e) => { if (!e.target.closest('.pop,.ib')) closePops(); });
$('#layersBtn').onclick = (e) => togglePop('#pop', e.currentTarget, (p) => {
  p.append(h('h4', {}, '지도 표시'));
  for (const [k, t] of [['cLabels', '국가 이름'], ['flags', '국기'], ['pBorders', '지방 경계선'], ['pLabels', '지방 이름'], ['cities', '도시'], ['oceans', '바다 이름']]) {
    p.append(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: M.opts[k], onchange: (e2) => { Wd.setOpt(k, e2.target.checked); need(); } }), ' ' + t));
  }
  p.append(h('div', { class: 'row gap' }, h('label', { class: 'lab' }, '바다 색'), h('input', { type: 'color', value: M.opts.ocean, onchange: (e2) => Wd.setOpt('ocean', e2.target.value) })));
  p.append(h('div', { class: 'row gap' }, h('label', { class: 'lab' }, '무주지 색'), h('input', { type: 'color', value: M.opts.neutral, onchange: (e2) => Wd.setOpt('neutral', e2.target.value) })));
});
$('#fileBtn').onclick = (e) => togglePop('#pop', e.currentTarget, (p) => {
  const item = (t, fn, sub) => p.append(h('button', { class: 'mi', onclick: () => { closePops(); fn(); } }, h('b', {}, t), sub ? h('small', {}, sub) : ''));
  p.append(h('h4', {}, '새 지도'));
  item('실제 세계 지도', () => newMap('real'), '현재 국가·지방 그대로 시작');
  item('빈 세계', () => newMap('blank'), '모든 땅이 무주지');
  item('지방마다 독립국', () => newMap('provinces'), '4,500여 개 지방이 모두 국가');
  p.append(h('h4', {}, '저장'));
  item('저장하기…', saveAs); item('불러오기…', loadDialog);
  item('이름 바꾸기…', () => { const n = prompt('세계 이름', M.name); if (n) { M.name = n.trim() || M.name; $('#worldName').textContent = M.name; autosave(); } });
  p.append(h('h4', {}, '내보내기'));
  item('이미지(PNG)로 저장', exportPNG);
  item('백업 파일 내보내기', () => store.download(`${M.name}.worldmap.json`, store.toFile(Wd.serialize()), 'application/json'));
  item('백업 파일 가져오기', importFile);
});

// ── 저장 ──
function thumb() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  c.getContext('2d').drawImage(Wd.canvas, 0, 0, 256, 128);
  return c.toDataURL('image/jpeg', 0.7);
}
async function autosave() {
  try { const d = Wd.serialize(); await store.put({ id: 'auto', name: M.name + ' (자동 저장)', time: Date.now(), thumb: thumb(), ...d }); } catch (e) { console.warn(e); }
}
async function saveAs() {
  const n = prompt('저장 이름', M.name); if (!n) return;
  M.name = n.trim(); $('#worldName').textContent = M.name;
  await store.put({ id: 's' + Date.now(), name: M.name, time: Date.now(), thumb: thumb(), ...Wd.serialize() });
  autosave(); toast('저장했습니다');
}
async function loadDialog() {
  const list = h('div', { class: 'slots' });
  const fill = async () => {
    list.textContent = '';
    const all = await store.list();
    if (!all.length) list.append(h('p', { class: 'muted' }, '저장된 지도가 없습니다.'));
    for (const r of all) {
      list.append(h('div', { class: 'slot' }, h('img', { src: r.thumb, alt: '' }),
        h('div', { class: 'grow' }, h('b', {}, r.name), h('small', {}, new Date(r.time).toLocaleString('ko-KR'))),
        h('button', { class: 'btn pri', onclick: () => { Wd.deserialize(r); afterLoad(); closeModal(); toast('불러왔습니다'); } }, '열기'),
        r.id !== 'auto' ? h('button', { class: 'btn danger', onclick: async () => { if (confirm(`'${r.name}'을(를) 지울까요?`)) { await store.del(r.id); fill(); } } }, '삭제') : ''));
    }
  };
  openModal(h('div', {}, h('h3', {}, '불러오기'), list), null, true);
  fill();
}
function importFile() {
  const inp = $('#fileIn'); inp.accept = '.json,application/json'; inp.value = '';
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try { Wd.deserialize(store.fromFile(await f.text())); afterLoad(); toast('가져왔습니다'); } catch (e) { alert('파일을 읽을 수 없습니다: ' + e.message); }
  };
  inp.click();
}
function newMap(kind) {
  if (!confirm('새 지도를 만들까요? 지금 지도는 자동 저장에서 사라집니다. (필요하면 먼저 저장하세요)')) return;
  Wd.newWorld(kind); afterLoad(); autosave();
}
function afterLoad() {
  $('#worldName').textContent = M.name;
  const kr = M.countries.findIndex((c) => c.flag === 'kr' && c.alive);
  setBrush(kr >= 0 ? kr : aliveIdx()[0] ?? -1);
  refreshList(); renderInfo(); need();
}
function exportPNG() {
  toast('이미지를 만드는 중…');
  setTimeout(() => {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'); g.drawImage(Wd.canvas, 0, 0);
    drawLabels(g, { w: W, h: H, k: 1, proj: (x, y) => [x, y] });
    c.toBlob((b) => store.download(`${M.name}.png`, b), 'image/png');
  }, 30);
}

// ── 시작 ──
$('#undo').onclick = () => Wd.undo();
$('#redo').onclick = () => Wd.redo();
document.querySelectorAll('#viewSeg button').forEach((b) => { b.onclick = () => setView(b.dataset.view); });
new ResizeObserver(() => resize()).observe(stage);
(async () => {
  const lbl = $('#loading p');
  try {
    lbl.textContent = '지도 데이터 불러오는 중…';
    const [base] = await Promise.all([Wd.loadBase(), loadFlags()]);
    base.meta.countries.forEach(([n, , iso]) => { if (iso && !isoNames[iso]) isoNames[iso] = n; });
    lbl.textContent = '지도 그리는 중…';
    await new Promise((r) => setTimeout(r, 20));
    let saved = null;
    try { saved = await store.get('auto'); } catch (e) { /* 저장소 없음 */ }
    if (saved) { try { Wd.deserialize(saved); } catch (e) { saved = null; } }
    if (!saved) Wd.newWorld('real');
    resize(); setTool('select'); afterLoad(); showTab('list');
    if (!isMobile()) document.body.classList.add('panel-open');
    resize();
    $('#loading').remove();
    requestAnimationFrame(frame);
  } catch (e) {
    console.error(e);
    lbl.textContent = '불러오기 실패: ' + e.message + ' — 웹 서버로 열었는지 확인하세요.';
  }
})();
