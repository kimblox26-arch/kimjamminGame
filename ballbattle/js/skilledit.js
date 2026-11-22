'use strict';
// ===== 스킬 편집기: 캡컷처럼 화면에서 직접 움직임을 만들어요 =====
// 스킬 = 여러 조각(레이어). 조각마다 시간에 따른 위치·크기·회전·투명도(키프레임)와 맞았을 때 효과를 가져요.
// 좌표는 '내 공'이 원점, 오른쪽(+x)이 상대 쪽이에요. 게임에서는 실제 상대 방향으로 돌려서 써요.
const SE_ORIGIN = [110, 200], SE_GHOST = 200;
const EASE = { linear: u => u, smooth: u => u * u * (3 - 2 * u), fast: u => 1 - (1 - u) * (1 - u), slow: u => u * u, bounce: u => { const n = 7.5625, d = 2.75; return u < 1 / d ? n * u * u : u < 2 / d ? n * (u -= 1.5 / d) * u + .75 : u < 2.5 / d ? n * (u -= 2.25 / d) * u + .9375 : n * (u -= 2.625 / d) * u + .984375; } };
const anim0 = () => ({ dur: 1.6, heal: 0, shield: 0, layers: [layer0(0, '#FE2C55')] });
function layer0(t, color) {
  return { id: 'l' + uid6(), shape: 'circle', color, pic: null, start: t, end: Math.min(t + 1.2, 4), keys: [{ t, x: 26, y: 0, s: 1, r: 0, o: 1 }, { t: t + 1, x: 200, y: 0, s: 1, r: 0, o: 1 }], dmg: 8, knock: 100, effect: 'none', explode: 0, pierce: false, trail: true, glow: false, follow: false, fit: true, ease: 'linear', rep: 1, gap: .25, outline: false };
}
function keyAt(L, t) {
  const k = L.keys; if (!k.length) return { t, x: 0, y: 0, s: 1, r: 0, o: 1 };
  if (t <= k[0].t) return { ...k[0], t }; if (t >= k[k.length - 1].t) return { ...k[k.length - 1], t };
  const f = EASE[L.ease] || EASE.linear;
  for (let i = 0; i < k.length - 1; i++) { const a = k[i], b = k[i + 1]; if (t <= b.t) { const u = f((t - a.t) / Math.max(1e-6, b.t - a.t)), m = (p, q) => p + (q - p) * u; return { t, x: m(a.x, b.x), y: m(a.y, b.y), s: m(a.s, b.s), r: m(a.r, b.r), o: m(a.o, b.o) }; } }
}
function setKey(L, t, patch) {
  t = Math.round(t * 20) / 20; let k = L.keys.find(q => Math.abs(q.t - t) < .026);
  if (!k) { k = keyAt(L, t); k.t = t; L.keys.push(k); L.keys.sort((a, b) => a.t - b.t); }
  Object.assign(k, patch); return k;
}
function expandLayers(A) { // '반복'이 있는 조각은 시간차를 두고 여러 번
  const out = [];
  A.layers.forEach(L => { const n = Math.max(1, L.rep || 1); for (let i = 0; i < n; i++) { if (!i) { out.push(L); continue; } const d = i * (L.gap || .25); out.push({ ...L, copy: i, start: L.start + d, end: L.end + d, keys: L.keys.map(k => ({ ...k, t: k.t + d })) }); } });
  return out;
}
const animCost = A => A.layers.reduce((s, L) => s + (4 * L.dmg * (L.pierce ? 1.5 : 1) + .02 * L.explode * L.dmg + ({ slow: 12, poison: 14, stun: 20, vamp: 14 }[L.effect] || 0) + .03 * L.knock) * Math.max(1, L.rep || 1), 0) + 2 * (A.heal || 0) + 1.5 * (A.shield || 0);
const animScale = A => Math.min(1, SPEC_BUDGET / Math.max(1, animCost(A)));
const animDur = A => Math.max(A.dur, ...expandLayers(A).map(L => L.end));

// --- 게임 엔진에서 편집한 스킬 실행 ---
Object.assign(Game.prototype, {
  castAnim(b, e, sk, pm) {
    const A = sk.s.anim;
    if (A.heal) { const v = Math.min(b.max - b.hp, A.heal * pm); if (v > 0) { b.hp += v; this.text(b.x, b.y - b.r - 8, '+' + Math.round(v), '#2f9e44'); AUD.sfx('heal'); } }
    if (A.shield) { b.shield = A.shield * pm; b.shieldT = 4; this.ring(b.x, b.y, b.r + 14, '#74c0fc', .5, 3); }
    const ang = Math.atan2(e.y - b.y, e.x - b.x), dist = Math.hypot(e.x - b.x, e.y - b.y), layers = expandLayers(A);
    this.anims.push({ layers, dur: animDur(A), sk, pm, b, e, ox: b.x, oy: b.y, ang, fit: Math.max(.4, dist / SE_GHOST), t: 0, st: layers.map(() => ({ done: false, hcd: 0, trail: [], pos: null })) });
    AUD.sfx('pew');
  },
  updAnims(dt) {
    for (const a of this.anims) {
      a.t += dt; const ca = Math.cos(a.ang), sa = Math.sin(a.ang);
      a.layers.forEach((L, i) => {
        const S = a.st[i]; if (S.done || a.t < L.start || a.t > L.end) { S.pos = null; return; }
        const k = keyAt(L, a.t), lx = k.x * (L.fit ? a.fit : 1), ly = k.y, ox = L.follow ? a.b.x : a.ox, oy = L.follow ? a.b.y : a.oy;
        const x = ox + lx * ca - ly * sa, y = oy + lx * sa + ly * ca, r = 12 * k.s;
        S.pos = { x, y, r, rot: k.r * Math.PI / 180 + a.ang, o: k.o }; S.trail.push([x, y]); if (S.trail.length > 8) S.trail.shift();
        S.hcd = Math.max(0, S.hcd - dt);
        for (const tg of this.balls) {
          if (tg === a.b || tg.dead || S.hcd > 0 || k.o <= .15 || Math.hypot(tg.x - x, tg.y - y) >= tg.r * tg.sc + r) continue;
          this.specHit({ p: { ...SPEC0, dmg: L.dmg, knock: L.knock, effect: L.effect, explode: L.explode }, pm: a.pm, col: L.color, b: a.b }, tg, x, y);
          if (L.pierce) S.hcd = .5; else { S.done = true; break; }
        }
      });
      if (a.t > a.dur + .05) a.done = true;
    }
    this.anims = this.anims.filter(a => !a.done);
  },
  drawAnims(c) {
    for (const a of this.anims) a.layers.forEach((L, i) => {
      const S = a.st[i], P = S.pos; if (!P) return;
      if (L.trail) S.trail.forEach(([x, y], j) => { c.globalAlpha = j / S.trail.length * .3 * P.o; c.fillStyle = L.color; c.beginPath(); c.arc(x, y, P.r * (.4 + .5 * j / S.trail.length), 0, 7); c.fill(); });
      c.globalAlpha = Math.max(0, Math.min(1, P.o)); c.save(); c.translate(P.x, P.y); c.rotate(P.rot); if (L.glow) { c.shadowColor = L.color; c.shadowBlur = 16; }
      drawSpecShape(c, L.shape, P.r, L.color, a.sk.sprites && a.sk.sprites[L.id], L.outline); c.restore(); c.globalAlpha = 1;
    });
  },
});
function animSprites(s) { const o = {}; ((s.anim || {}).layers || []).forEach(L => { if (L.pic) { const i = new Image(); i.src = L.pic; o[L.id] = i; } }); return o; }
// 사진·영상 한 장면을 (배경 제거 등 편집해서) 조각 그림으로
async function mediaToPic(url, kind, e) {
  const el = await loadEl(url, kind);
  if (kind === 'video') { await fixDur(el); await seekTo(el, (e.start || 0) + .05); }
  if (e.key && e.key.mode === 'ai') { try { await withTimeout(SEG.load(), 15000); } catch (x) { } }
  const c = document.createElement('canvas'); c.width = c.height = 256; drawEdited(c.getContext('2d', { willReadFrequently: true }), el, e, 256, 256, 'contain');
  return c.toDataURL('image/png');
}
function textToPic(txt, col) {
  const c = document.createElement('canvas'), x = c.getContext('2d'), f = '700 72px "IBM Plex Sans KR",sans-serif'; x.font = f;
  const w = Math.min(512, Math.ceil(x.measureText(txt).width) + 24); c.width = w; c.height = 100; x.font = f; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 10; x.lineJoin = 'round'; x.strokeStyle = '#fff'; x.strokeText(txt, w / 2, 52); x.fillStyle = col; x.fillText(txt, w / 2, 52);
  const s = document.createElement('canvas'), m = Math.max(w, 100); s.width = s.height = m; s.getContext('2d').drawImage(c, (m - w) / 2, (m - 100) / 2);
  return s.toDataURL('image/png');
}

// --- 편집기 화면 ---
const SE_TOOLS = [['add', '조각 추가', 'plus'], ['photo', '사진 조각', 'image'], ['text', '글자 조각', 'text'], ['move', '움직임 그리기', 'dash'], ['key', '키프레임', 'diamond'], ['ease', '부드럽게', 'gauge'], ['path', '경로', 'flip'], ['size', '크기', 'grow'], ['rot', '회전', 'rotate'], ['op', '투명도', 'eye'], ['shape', '모양', 'star'], ['color', '색', 'palette'], ['hit', '맞으면', 'burst'], ['rep', '반복', 'copy'], ['opt', '옵션', 'sliders'], ['view', '보기', 'grid'], ['time', '길이', 'gauge'], ['self', '내 공', 'heal'], ['dup', '복제', 'copy'], ['del', '삭제', 'x'], ['snd', '소리', 'music'], ['vid', '영상', 'film']];
screen('skilledit', (el, p) => {
  const u = me(), ed = p.id && D.skills[p.id] && D.skills[p.id].owner === u.uid ? D.skills[p.id] : null;
  const st = ed ? JSON.parse(JSON.stringify(ed)) : { name: '', sound: 'none', media: null };
  const A = st.anim = st.anim || anim0(); A.heal = A.heal || 0; A.shield = A.shield || 0;
  A.layers.forEach(L => Object.assign(L, { ease: L.ease || 'linear', rep: L.rep || 1, gap: L.gap || .25, outline: !!L.outline }));
  let sel = A.layers[0].id, t = 0, playing = false, rec = false, tool = 'move', drag = null, raf = 0, last = performance.now(), sprites = animSprites(st), clip = null;
  const view = { onion: false, snap: false };
  const hist = [], fut = []; let lastJ = JSON.stringify(A);
  el.innerHTML = `<div class="se">
    <div class="se-top"><button class="icon-btn" data-back>${ic('x')}</button><input class="se-name" maxlength="14" placeholder="스킬 이름" value="${esc(st.name || '')}"><button class="icon-btn se-undo" title="되돌리기">${ic('rotate', 20)}</button><button class="icon-btn se-redo" title="다시하기">${ic('rotate', 20)}</button><button class="se-ok">완료</button></div>
    <div class="se-stage"><canvas class="se-cv" width="800" height="800"></canvas><div class="se-hint"></div></div>
    <div class="se-bar"><button class="se-pp">${ic('play', 20)}</button><span class="se-time"></span><span class="se-meter"><i></i></span><b class="se-cost"></b></div>
    <div class="se-tl"><div class="tl-in"><div class="tl-ruler"></div><div class="tl-tracks"></div><i class="tl-head"></i></div></div>
    <div class="se-panel"></div>
    <div class="se-tools">${SE_TOOLS.map(([k, n, i]) => `<button data-tool="${k}">${ic(i, 22)}<small>${n}</small></button>`).join('')}</div></div>`;
  const cv = $('.se-cv', el), x = cv.getContext('2d'), tin = $('.tl-in', el);
  const cur = () => A.layers.find(L => L.id === sel) || A.layers[0];
  const hint = s => { $('.se-hint', el).textContent = s; };
  const snapV = v => view.snap ? Math.round(v / 10) * 10 : v;
  const pos = e => { const r = cv.getBoundingClientRect(); return [snapV((e.clientX - r.left) * 400 / r.width - SE_ORIGIN[0]), snapV((e.clientY - r.top) * 400 / r.height - SE_ORIGIN[1])]; };
  // 되돌리기·다시하기
  const commit = () => { const j = JSON.stringify(A); if (j !== lastJ) { hist.push(lastJ); if (hist.length > 50) hist.shift(); fut.length = 0; lastJ = j; } undoUI(); };
  const restore = j => { const o = JSON.parse(j); Object.keys(A).forEach(k => delete A[k]); Object.assign(A, o); lastJ = j; if (!A.layers.find(L => L.id === sel)) sel = A.layers[0].id; sprites = animSprites({ anim: A }); t = Math.min(t, A.dur); tl(); panel(); undoUI(); };
  const undoUI = () => { $('.se-undo', el).disabled = !hist.length; $('.se-redo', el).disabled = !fut.length; };
  $('.se-undo', el).onclick = () => { if (!hist.length) return; fut.push(lastJ); restore(hist.pop()); hint('되돌렸어요'); };
  $('.se-redo', el).onclick = () => { if (!fut.length) return; hist.push(lastJ); restore(fut.pop()); hint('다시 했어요'); };
  function drawPiece(Ly, k, alpha) {
    const [ox, oy] = SE_ORIGIN; x.save(); x.globalAlpha = alpha; x.translate(ox + k.x, oy + k.y); x.rotate(k.r * Math.PI / 180); if (Ly.glow) { x.shadowColor = Ly.color; x.shadowBlur = 16; }
    drawSpecShape(x, Ly.shape, 12 * k.s, Ly.color, sprites[Ly.id], Ly.outline); x.restore();
  }
  function render() {
    x.setTransform(2, 0, 0, 2, 0, 0); x.fillStyle = '#16161d'; x.fillRect(0, 0, 400, 400);
    x.strokeStyle = view.snap ? 'rgba(255,255,255,.1)' : 'rgba(255,255,255,.05)'; x.lineWidth = 1; for (let i = 0; i <= 400; i += view.snap ? 10 : 25) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 400); x.moveTo(0, i); x.lineTo(400, i); x.stroke(); }
    const [ox, oy] = SE_ORIGIN;
    x.setLineDash([5, 5]); x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 2; x.beginPath(); x.arc(ox + SE_GHOST, oy, 26, 0, 7); x.stroke(); x.setLineDash([]);
    x.fillStyle = 'rgba(255,255,255,.45)'; x.font = '600 12px "IBM Plex Sans KR",sans-serif'; x.textAlign = 'center'; x.fillText('상대', ox + SE_GHOST, oy + 44); x.fillText('내 공', ox, oy + 44);
    x.fillStyle = (A.layers[0] || {}).color || '#FE2C55'; x.beginPath(); x.arc(ox, oy, 26, 0, 7); x.fill(); x.fillStyle = '#fff'; x.beginPath(); x.arc(ox, oy, 22, 0, 7); x.fill();
    const L = cur();
    if (L) {
      x.setLineDash([4, 4]); x.strokeStyle = 'rgba(37,244,238,.7)'; x.lineWidth = 2; x.beginPath();
      for (let tt = L.start; tt <= L.end + 1e-6; tt += .03) { const k = keyAt(L, tt); tt === L.start ? x.moveTo(ox + k.x, oy + k.y) : x.lineTo(ox + k.x, oy + k.y); } x.stroke(); x.setLineDash([]);
      L.keys.forEach(k => { if (k.t < L.start - .01 || k.t > L.end + .01) return; x.save(); x.translate(ox + k.x, oy + k.y); x.rotate(Math.PI / 4); x.fillStyle = Math.abs(k.t - t) < .026 ? '#ffd43b' : '#25F4EE'; x.fillRect(-4, -4, 8, 8); x.restore(); });
      if (view.onion) [-.24, -.12, .12, .24].forEach(d => { const tt = t + d; if (tt >= L.start && tt <= L.end) drawPiece(L, keyAt(L, tt), .18); });
    }
    expandLayers(A).forEach(Ly => {
      if (t < Ly.start || t > Ly.end) return; const k = keyAt(Ly, t);
      drawPiece(Ly, k, Math.max(.08, k.o) * (Ly.copy ? .6 : 1));
      if (Ly.id === sel && !Ly.copy) { const r = 12 * k.s + 6; x.strokeStyle = '#25F4EE'; x.lineWidth = 1.5; x.strokeRect(ox + k.x - r, oy + k.y - r, r * 2, r * 2); }
    });
    if (rec) { x.fillStyle = '#ff3b3b'; x.beginPath(); x.arc(16, 16, 6, 0, 7); x.fill(); x.fillStyle = '#fff'; x.textAlign = 'left'; x.fillText('움직임 그리는 중', 28, 20); }
  }
  function tl() {
    const W = A.dur; let ticks = ''; for (let tt = 0; tt <= W + 1e-6; tt += .5) ticks += `<span style="left:${tt / W * 100}%">${tt.toFixed(1)}</span>`;
    $('.tl-ruler', el).innerHTML = ticks;
    $('.tl-tracks', el).innerHTML = A.layers.map((L, i) => `<div class="tl-track ${L.id === sel ? 'on' : ''}" data-l="${L.id}"><div class="tl-clip" style="left:${L.start / W * 100}%;width:${(L.end - L.start) / W * 100}%;--c:${L.color}"><i class="tl-h" data-h="start"></i><span>${L.pic ? '그림' : '조각'} ${i + 1}${L.rep > 1 ? ' ×' + L.rep : ''}</span><i class="tl-h" data-h="end"></i></div>${L.keys.filter(k => k.t >= L.start - .01 && k.t <= L.end + .01).map(k => `<b class="tl-key ${Math.abs(k.t - t) < .026 ? 'on' : ''}" style="left:${k.t / W * 100}%" data-kt="${k.t}"></b>`).join('')}</div>`).join('');
    head();
  }
  function head() {
    $('.tl-head', el).style.left = (t / A.dur * 100) + '%'; $('.se-time', el).textContent = `${t.toFixed(2)} / ${A.dur.toFixed(1)}초`;
    const c = animCost(A), over = c > SPEC_BUDGET; $('.se-meter i', el).style.width = Math.min(100, c / SPEC_BUDGET * 100) + '%'; $('.se-meter i', el).classList.toggle('over', over);
    $('.se-cost', el).textContent = over ? `위력 ${Math.round(animScale(A) * 100)}%` : `${Math.round(c)}/${SPEC_BUDGET}`;
    $('.se-pp', el).innerHTML = ic(playing ? 'pause' : 'play', 20);
  }
  const loop = now => {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (playing) {
      t += dt;
      if (drag && drag.rec) { const L = cur(); setKey(L, t, { x: drag.lx, y: drag.ly }); if (t >= L.end) { playing = false; rec = false; drag = null; hint('움직임을 만들었어요. 재생해서 확인해보세요'); commit(); tl(); panel(); } }
      if (t > A.dur) t = drag && drag.rec ? A.dur : 0;
      head();
    }
    render(); raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  el._leave = () => cancelAnimationFrame(raf);
  // 화면: 조각을 누르고 끌면 그 시간에 위치가 저장돼요
  cv.onpointerdown = e => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId); const [lx, ly] = pos(e);
    const hit = [...A.layers].reverse().find(L => { if (t < L.start || t > L.end) return false; const k = keyAt(L, t); return Math.hypot(k.x - lx, k.y - ly) < 12 * k.s + 12; });
    if (hit && hit.id !== sel) { sel = hit.id; tl(); panel(); }
    const L = cur(); if (!L) return;
    if (rec) { if (t < L.start || t >= L.end) t = L.start; L.keys = L.keys.filter(k => k.t < t - .01 || k.t > L.end + .01); drag = { rec: true, lx, ly }; setKey(L, t, { x: lx, y: ly }); playing = true; hint('손을 떼지 말고 움직여보세요'); }
    else if (hit || !L.keys.length) { drag = { rec: false }; playing = false; setKey(L, t, { x: lx, y: ly }); }
  };
  cv.onpointermove = e => { if (!drag) return; const [lx, ly] = pos(e); if (drag.rec) { drag.lx = lx; drag.ly = ly; } else setKey(cur(), t, { x: lx, y: ly }); };
  cv.onpointerup = cv.onpointercancel = () => { if (drag) { if (drag.rec) { playing = false; rec = false; hint('움직임을 만들었어요'); panel(); } drag = null; commit(); tl(); } };
  // 타임라인
  tin.onpointerdown = e => {
    const r = tin.getBoundingClientRect(); let ex = e.clientX; const tt = () => Math.max(0, Math.min(A.dur, (ex - r.left) / r.width * A.dur));
    const tr = e.target.closest('[data-l]'); if (tr) sel = tr.dataset.l;
    const hd = e.target.closest('[data-h]'), kt = e.target.closest('[data-kt]');
    playing = false; tin.setPointerCapture(e.pointerId);
    if (kt) { t = +kt.dataset.kt; tl(); panel(); return; }
    const L = cur(), move = ev => { ex = ev.clientX; const v = Math.round(tt() * 20) / 20; if (hd) { if (hd.dataset.h === 'start') L.start = Math.min(v, L.end - .1); else L.end = Math.max(v, L.start + .1); t = v; } else t = tt(); tl(); };
    move(e); tin.onpointermove = move; tin.onpointerup = () => { tin.onpointermove = null; commit(); panel(); };
  };
  $('.se-pp', el).onclick = () => { playing = !playing; if (playing && t >= A.dur - .01) t = 0; head(); };
  const sl = (k, label, min, max, step, val) => `<label class="ed-rng"><span>${label}</span><input type="range" data-p="${k}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${(+val).toFixed(step < 1 ? 2 : 0)}</output></label>`;
  const chipsOf = (attr, list, curV) => `<div class="chips">${list.map(([v, n]) => `<button class="chip ${curV === v ? 'on' : ''}" data-${attr}="${v}">${n}</button>`).join('')}</div>`;
  function panel() {
    const L = cur(), P = $('.se-panel', el), k = keyAt(L, t); let h0 = '';
    $$('.se-tools button', el).forEach(b => b.classList.toggle('on', b.dataset.tool === tool || (b.dataset.tool === 'move' && rec)));
    if (tool === 'move') h0 = `<p class="se-tip">${rec ? '지금 화면을 누른 채로 끌면 시간이 흐르면서 그 길대로 날아가요' : '조각을 끌면 지금 시간의 위치가 바뀌어요. 아래 버튼을 누르고 화면에 길을 그리면 움직임이 통째로 만들어져요'}</p><div class="chips"><button class="chip ${rec ? 'on' : ''}" data-act="rec">${ic('dash', 14)} ${rec ? '그리기 취소' : '길 그리기 시작'}</button><button class="chip" data-act="clearpath">길 지우기</button></div>`;
    if (tool === 'key') { const has = L.keys.some(q => Math.abs(q.t - t) < .026); h0 = `<p class="se-tip">키프레임은 그 시간의 위치·크기·회전·투명도를 기억해요</p><div class="chips"><button class="chip" data-act="key">${has ? '이 키프레임 지우기' : '여기에 키프레임 추가'}</button><button class="chip" data-act="prevkey">이전</button><button class="chip" data-act="nextkey">다음</button><button class="chip" data-act="copykey">복사</button><button class="chip" data-act="pastekey" ${clip ? '' : 'disabled'}>붙여넣기</button></div>`; }
    if (tool === 'ease') h0 = `<p class="se-tip">키프레임 사이를 어떻게 이어줄지 골라요</p>` + chipsOf('ease', [['linear', '일정하게'], ['smooth', '부드럽게'], ['fast', '빠르게 시작'], ['slow', '천천히 시작'], ['bounce', '통통 튀게']], L.ease);
    if (tool === 'path') h0 = `<div class="chips"><button class="chip" data-act="mirror">위아래 뒤집기</button><button class="chip" data-act="reverse">거꾸로 움직이기</button><button class="chip" data-act="bigger">길 크게</button><button class="chip" data-act="smaller">길 작게</button><button class="chip" data-act="up">위로</button><button class="chip" data-act="down">아래로</button></div>`;
    if (tool === 'size') h0 = sl('s', '크기', .3, 4, .05, k.s);
    if (tool === 'rot') h0 = sl('r', '회전', -360, 360, 5, k.r);
    if (tool === 'op') h0 = sl('o', '투명도', 0, 1, .05, k.o);
    if (tool === 'shape') h0 = `<div class="chips">${SPEC_OPT.shape.filter(s => s[0] !== 'drawing').map(([v, n]) => `<button class="chip ${L.shape === v ? 'on' : ''}" data-shape="${v}">${n}</button>`).join('')}<button class="chip ${L.shape === 'drawing' ? 'on' : ''}" data-act="draw">${ic('pencil', 14)} 그림 그리기</button></div>`;
    if (tool === 'color') h0 = `<div class="chips">${SK_COLORS.map(c => `<button class="sw ${L.color === c ? 'on' : ''}" data-col="${c}" style="--c:${c}"></button>`).join('')}<input type="color" data-colpick value="${L.color}"></div>`;
    if (tool === 'hit') h0 = sl('dmg', '피해', 1, 30, 1, L.dmg) + sl('knock', '밀어내기', 0, 600, 10, L.knock) + sl('explode', '폭발 범위', 0, 120, 5, L.explode) + `<div class="chips">${SPEC_OPT.effect.map(([v, n]) => `<button class="chip ${L.effect === v ? 'on' : ''}" data-eff="${v}">${n}</button>`).join('')}<button class="chip ${L.pierce ? 'on' : ''}" data-tg="pierce">관통</button></div>`;
    if (tool === 'rep') h0 = `<p class="se-tip">같은 조각을 시간차를 두고 여러 번 날려요</p>` + sl('rep', '횟수', 1, 6, 1, L.rep) + sl('gap', '간격(초)', .05, .8, .05, L.gap);
    if (tool === 'opt') h0 = `<div class="chips">${[['trail', '꼬리 효과'], ['glow', '빛나기'], ['outline', '테두리'], ['follow', '내 공 따라다니기'], ['fit', '상대 거리에 맞추기']].map(([k2, n]) => `<button class="chip ${L[k2] ? 'on' : ''}" data-tg="${k2}">${n}</button>`).join('')}</div>`;
    if (tool === 'view') h0 = `<div class="chips"><button class="chip ${view.onion ? 'on' : ''}" data-view="onion">잔상 보기</button><button class="chip ${view.snap ? 'on' : ''}" data-view="snap">격자에 맞추기</button></div>`;
    if (tool === 'time') h0 = sl('dur', '전체 길이', .5, 4, .1, A.dur);
    if (tool === 'self') h0 = sl('heal', '회복', 0, 30, 1, A.heal) + sl('shield', '방어막', 0, 40, 1, A.shield);
    if (tool === 'snd') h0 = `<p class="se-tip">${st.sound && st.sound.startsWith('data:') ? `영상 소리 ${st.sndLen || ''}초` : '소리 없음'}</p><div class="chips"><button class="chip" data-act="snd">${ic('film', 14)} 영상에서 소리 만들기</button><button class="chip" data-act="sndplay">${ic('play', 14)} 듣기</button><button class="chip" data-act="sndoff">없애기</button></div>`;
    if (tool === 'vid') h0 = `<p class="se-tip">발동할 때 공 위에 나올 영상·사진 (배경 제거·필터 등 편집 무료)</p><div class="chips"><button class="chip" data-act="vid">${ic('upload', 14)} 갤러리에서 선택</button><button class="chip" data-act="videdit">${ic('wand', 14)} 편집·배경제거</button><button class="chip" data-act="vidoff">없애기</button></div>`;
    P.innerHTML = h0;
  }
  el.addEventListener('input', e => {
    const k = e.target.dataset.p; if (!k) { if (e.target.hasAttribute('data-colpick')) { cur().color = e.target.value; tl(); } return; }
    const v = +e.target.value, L = cur(); e.target.nextElementSibling.textContent = v.toFixed(+e.target.step < 1 ? 2 : 0);
    if (['s', 'r', 'o'].includes(k)) setKey(L, t, { [k]: v });
    else if (k === 'dur') { A.dur = v; A.layers.forEach(Ly => { Ly.end = Math.min(Ly.end, v); Ly.start = Math.min(Ly.start, v - .1); }); t = Math.min(t, v); }
    else if (k === 'heal' || k === 'shield') A[k] = v; else L[k] = v;
    tl();
  });
  el.addEventListener('change', commit);
  const addLayer = (pic, shape) => {
    if (A.layers.length >= 6) { toast('조각은 6개까지 만들 수 있어요'); return null; }
    const L = cur(), n = layer0(Math.min(t, A.dur - .3), L.color); n.end = Math.min(A.dur, n.start + 1.2);
    n.keys.forEach(q => q.y = (A.layers.length % 2 ? -1 : 1) * 30 * Math.ceil(A.layers.length / 2));
    if (pic) { n.pic = pic; n.shape = 'drawing'; n.keys.forEach(q => q.s = 2); const i = new Image(); i.src = pic; sprites[n.id] = i; }
    if (shape) n.shape = shape;
    A.layers.push(n); sel = n.id; tool = 'move'; commit(); tl(); panel(); return n;
  };
  el.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b || !el.contains(b) || b.closest('.se-top')) return; const L = cur();
    if (b.dataset.tool) {
      const k = b.dataset.tool; playing = false;
      if (k === 'add') { if (addLayer()) hint('새 조각을 만들었어요. 끌어서 움직여보세요'); return; }
      if (k === 'photo') {
        const f = await pickFile('image/*,video/*'); if (!f) return; if (f.size > 40e6) return toast('40MB 이하 파일만 넣을 수 있어요');
        const kind = f.type.startsWith('video') ? 'video' : 'image', url = URL.createObjectURL(f);
        openEditor(url, kind, { key: { mode: 'ai', c: '#00ff00', tol: 90, soft: 50 } }, async ed2 => { hint('사진 조각을 만드는 중'); const pic = await mediaToPic(url, kind, ed2); if (addLayer(pic)) hint('사진 조각을 만들었어요. 배경 제거도 무료예요'); }, { ratio: 1 });
        return;
      }
      if (k === 'text') {
        const m = modal(`<h3 class="m-title">${ic('text')} 글자 조각</h3><input class="inp" id="tx-v" maxlength="12" placeholder="예) 쾅!"><div class="row2"><button class="btn-ghost" data-c>취소</button><button class="btn-main" id="tx-ok">만들기</button></div>`);
        $('[data-c]', m).onclick = () => m.close();
        $('#tx-ok', m).onclick = () => { const v = $('#tx-v', m).value.trim(); if (!v) return; m.close(); if (addLayer(textToPic(v, L.color))) hint('글자 조각을 만들었어요'); };
        return;
      }
      if (k === 'dup') { if (A.layers.length >= 6) return toast('조각은 6개까지 만들 수 있어요'); const n = JSON.parse(JSON.stringify(L)); n.id = 'l' + uid6(); n.keys.forEach(q => q.y += 24); A.layers.push(n); if (sprites[L.id]) sprites[n.id] = sprites[L.id]; sel = n.id; hint('조각을 복제했어요'); }
      else if (k === 'del') { if (A.layers.length <= 1) return toast('조각이 하나는 있어야 해요'); A.layers = A.layers.filter(q => q.id !== L.id); sel = A.layers[0].id; hint('조각을 지웠어요'); }
      else tool = k;
      commit(); tl(); panel(); return;
    }
    const act = b.dataset.act;
    if (act === 'rec') { rec = !rec; if (rec) { t = L.start; hint('화면을 누른 채로 끌어서 길을 그려요'); } panel(); }
    if (act === 'clearpath') { const k0 = keyAt(L, L.start); L.keys = [{ ...k0, t: L.start }]; }
    if (act === 'key') { const i = L.keys.findIndex(q => Math.abs(q.t - t) < .026); if (i >= 0) { if (L.keys.length > 1) L.keys.splice(i, 1); else toast('키프레임이 하나는 있어야 해요'); } else setKey(L, t, {}); }
    if (act === 'prevkey' || act === 'nextkey') { const ks = L.keys.map(q => q.t); const n = act === 'prevkey' ? ks.filter(v => v < t - .026).pop() : ks.find(v => v > t + .026); if (n != null) t = n; }
    if (act === 'copykey') { const k = keyAt(L, t); clip = { x: k.x, y: k.y, s: k.s, r: k.r, o: k.o }; hint('키프레임을 복사했어요'); }
    if (act === 'pastekey' && clip) { setKey(L, t, clip); hint('붙여넣었어요'); }
    if (act === 'mirror') L.keys.forEach(q => q.y = -q.y);
    if (act === 'reverse') { const xs = L.keys.map(q => ({ ...q })).reverse(); L.keys.forEach((q, i) => Object.assign(q, { x: xs[i].x, y: xs[i].y, s: xs[i].s, r: xs[i].r, o: xs[i].o })); }
    if (act === 'bigger' || act === 'smaller') { const f = act === 'bigger' ? 1.2 : 1 / 1.2; L.keys.forEach(q => { q.x *= f; q.y *= f; }); }
    if (act === 'up' || act === 'down') L.keys.forEach(q => q.y += act === 'up' ? -15 : 15);
    if (b.dataset.ease) L.ease = b.dataset.ease;
    if (b.dataset.view) view[b.dataset.view] = !view[b.dataset.view];
    if (b.dataset.shape) L.shape = b.dataset.shape;
    if (act === 'draw') openDraw(L.pic, (blob, pic) => { L.pic = pic; L.shape = 'drawing'; const i = new Image(); i.src = pic; sprites[L.id] = i; commit(); tl(); panel(); });
    if (b.dataset.col) L.color = b.dataset.col;
    if (b.dataset.eff) L.effect = b.dataset.eff;
    if (b.dataset.tg) L[b.dataset.tg] = !L[b.dataset.tg];
    if (act === 'snd') openSoundMaker((url, len) => { st.sound = url; st.sndLen = len; AUD.bufs[url] = null; AUD.skill(url); panel(); });
    if (act === 'sndplay') { if (!st.sound || st.sound === 'none') return toast('먼저 소리를 만들어주세요'); AUD.skill(st.sound); }
    if (act === 'sndoff') st.sound = 'none';
    if (act === 'vid') { const f = await pickFile('image/*,video/*'); if (!f) return; if (f.size > 40e6) return toast('40MB 이하 파일만 넣을 수 있어요'); const kind = f.type.startsWith('video') ? 'video' : 'image', key = await putBlob(f, 'm'), url = await blobURL(key); openEditor(url, kind, { key: { mode: 'ai', c: '#00ff00', tol: 90, soft: 50 } }, async ed2 => { st.media = { key, kind, edits: ed2 }; panel(); const asset = await shareBlob(key); if (asset && st.media && st.media.key === key) st.media.asset = asset; }, { ratio: 1 }); }
    if (act === 'videdit') { if (!st.media) return toast('먼저 영상이나 사진을 넣어주세요'); const url = await mediaSrc(st.media); openEditor(url, st.media.kind, st.media.edits, ed2 => { st.media.edits = ed2; }, { ratio: 1 }); }
    if (act === 'vidoff') st.media = null;
    commit(); tl(); panel(); head();
  });
  $('.se-ok', el).onclick = () => {
    const name = $('.se-name', el).value.trim(); if (!name) { $('.se-name', el).focus(); return toast('스킬 이름을 적어주세요'); }
    const ic2 = document.createElement('canvas'); ic2.width = ic2.height = 96; const t0 = t; t = A.dur * .45; render(); ic2.getContext('2d').drawImage(cv, 0, 0, 800, 800, 0, 0, 96, 96); t = t0;
    const data = { name, color: A.layers[0].color, comps: [], cd: SKILL_CD, spec: null, anim: A, sound: st.sound || 'none', sndLen: st.sndLen || 0, media: st.media || null, pic: ic2.toDataURL('image/png') };
    if (ed) { Object.assign(ed, data); save('skills'); toast('스킬을 수정했어요'); }
    else { const s = mkSkill(u.uid, name, data.color, [], SKILL_CD, data); if (!(u.equipped || []).some(id => usable(u, D.skills[id]))) equipToggle(u, s.id, false); save('skills'); toast(`'${name}' 스킬 완성!`); AUD.sfx('ding'); }
    back();
  };
  hint('조각을 끌어서 움직이고, 아래 타임라인으로 시간을 옮겨요');
  undoUI(); tl(); panel();
});
