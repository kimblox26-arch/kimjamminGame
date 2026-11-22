'use strict';
// ===== 스킬 편집기: 캡컷처럼 화면에서 직접 움직임을 만들어요 =====
// 스킬 = 여러 조각(레이어). 조각마다 시간에 따른 위치·크기·회전·투명도(키프레임)와 맞았을 때 효과를 가져요.
// 좌표는 '내 공'이 원점, 오른쪽(+x)이 상대 쪽이에요. 게임에서는 실제 상대 방향으로 돌려서 써요.
const SE_ORIGIN = [110, 200], SE_GHOST = 200;
const anim0 = () => ({ dur: 1.6, heal: 0, shield: 0, layers: [layer0(0, '#FE2C55')] });
function layer0(t, color) {
  return { id: 'l' + uid6(), shape: 'circle', color, pic: null, start: t, end: Math.min(t + 1.2, 4), keys: [{ t, x: 26, y: 0, s: 1, r: 0, o: 1 }, { t: t + 1, x: 200, y: 0, s: 1, r: 0, o: 1 }], dmg: 8, knock: 100, effect: 'none', explode: 0, pierce: false, trail: true, glow: false, follow: false, fit: true };
}
function keyAt(L, t) {
  const k = L.keys; if (!k.length) return { t, x: 0, y: 0, s: 1, r: 0, o: 1 };
  if (t <= k[0].t) return { ...k[0], t }; if (t >= k[k.length - 1].t) return { ...k[k.length - 1], t };
  for (let i = 0; i < k.length - 1; i++) { const a = k[i], b = k[i + 1]; if (t <= b.t) { const u = (t - a.t) / Math.max(1e-6, b.t - a.t), m = (p, q) => p + (q - p) * u; return { t, x: m(a.x, b.x), y: m(a.y, b.y), s: m(a.s, b.s), r: m(a.r, b.r), o: m(a.o, b.o) }; } }
}
function setKey(L, t, patch) {
  t = Math.round(t * 20) / 20; let k = L.keys.find(q => Math.abs(q.t - t) < .026);
  if (!k) { k = keyAt(L, t); k.t = t; L.keys.push(k); L.keys.sort((a, b) => a.t - b.t); }
  Object.assign(k, patch); return k;
}
const animCost = A => A.layers.reduce((s, L) => s + 4 * L.dmg * (L.pierce ? 1.5 : 1) + .02 * L.explode * L.dmg + ({ slow: 12, poison: 14, stun: 20, vamp: 14 }[L.effect] || 0) + .03 * L.knock, 0) + 2 * (A.heal || 0) + 1.5 * (A.shield || 0);
const animScale = A => Math.min(1, SPEC_BUDGET / Math.max(1, animCost(A)));

// --- 게임 엔진에서 편집한 스킬 실행 ---
Object.assign(Game.prototype, {
  castAnim(b, e, sk, pm) {
    const A = sk.s.anim;
    if (A.heal) { const v = Math.min(b.max - b.hp, A.heal * pm); if (v > 0) { b.hp += v; this.text(b.x, b.y - b.r - 8, '+' + Math.round(v), '#2f9e44'); AUD.sfx('heal'); } }
    if (A.shield) { b.shield = A.shield * pm; b.shieldT = 4; this.ring(b.x, b.y, b.r + 14, '#74c0fc', .5, 3); }
    const ang = Math.atan2(e.y - b.y, e.x - b.x), dist = Math.hypot(e.x - b.x, e.y - b.y);
    this.anims.push({ A, sk, pm, b, e, ox: b.x, oy: b.y, ang, fit: Math.max(.4, dist / SE_GHOST), t: 0, st: A.layers.map(() => ({ done: false, hcd: 0, trail: [], pos: null })) });
    AUD.sfx('pew');
  },
  updAnims(dt) {
    for (const a of this.anims) {
      a.t += dt; const ca = Math.cos(a.ang), sa = Math.sin(a.ang);
      a.A.layers.forEach((L, i) => {
        const S = a.st[i]; if (S.done || a.t < L.start || a.t > L.end) { S.pos = null; return; }
        const k = keyAt(L, a.t), lx = k.x * (L.fit ? a.fit : 1), ly = k.y, ox = L.follow ? a.b.x : a.ox, oy = L.follow ? a.b.y : a.oy;
        const x = ox + lx * ca - ly * sa, y = oy + lx * sa + ly * ca, r = 12 * k.s;
        S.pos = { x, y, r, rot: k.r * Math.PI / 180 + a.ang, o: k.o }; S.trail.push([x, y]); if (S.trail.length > 8) S.trail.shift();
        S.hcd = Math.max(0, S.hcd - dt); const tg = a.e;
        if (!tg.dead && S.hcd <= 0 && k.o > .15 && Math.hypot(tg.x - x, tg.y - y) < tg.r * tg.sc + r) {
          this.specHit({ p: { ...SPEC0, dmg: L.dmg, knock: L.knock, effect: L.effect, explode: L.explode }, pm: a.pm, col: L.color, b: a.b }, tg, x, y);
          if (L.pierce) S.hcd = .5; else S.done = true;
        }
      });
      if (a.t > a.A.dur + .05) a.done = true;
    }
    this.anims = this.anims.filter(a => !a.done);
  },
  drawAnims(c) {
    for (const a of this.anims) a.A.layers.forEach((L, i) => {
      const S = a.st[i], P = S.pos; if (!P) return;
      if (L.trail) S.trail.forEach(([x, y], j) => { c.globalAlpha = j / S.trail.length * .3 * P.o; c.fillStyle = L.color; c.beginPath(); c.arc(x, y, P.r * (.4 + .5 * j / S.trail.length), 0, 7); c.fill(); });
      c.globalAlpha = Math.max(0, Math.min(1, P.o)); c.save(); c.translate(P.x, P.y); c.rotate(P.rot); if (L.glow) { c.shadowColor = L.color; c.shadowBlur = 16; }
      drawSpecShape(c, L.shape, P.r, L.color, a.sk.sprites && a.sk.sprites[L.id]); c.restore(); c.globalAlpha = 1;
    });
  },
});
function animSprites(s) { const o = {}; ((s.anim || {}).layers || []).forEach(L => { if (L.pic) { const i = new Image(); i.src = L.pic; o[L.id] = i; } }); return o; }

// --- 편집기 화면 ---
const SE_TOOLS = [['add', '조각 추가', 'plus'], ['move', '움직임 그리기', 'dash'], ['key', '키프레임', 'diamond'], ['size', '크기', 'grow'], ['rot', '회전', 'rotate'], ['op', '투명도', 'eye'], ['shape', '모양', 'star'], ['color', '색', 'palette'], ['hit', '맞으면', 'burst'], ['opt', '옵션', 'sliders'], ['time', '길이', 'gauge'], ['self', '내 공', 'heal'], ['dup', '복제', 'copy'], ['del', '삭제', 'x'], ['snd', '소리', 'music'], ['vid', '영상', 'film']];
screen('skilledit', (el, p) => {
  const u = me(), ed = p.id && D.skills[p.id] && D.skills[p.id].owner === u.uid ? D.skills[p.id] : null;
  const st = ed ? JSON.parse(JSON.stringify(ed)) : { name: '', sound: 'none', media: null };
  const A = st.anim = st.anim || anim0(); A.heal = A.heal || 0; A.shield = A.shield || 0;
  let sel = A.layers[0].id, t = 0, playing = false, rec = false, tool = 'move', drag = null, raf = 0, last = performance.now(), sprites = animSprites(st);
  el.innerHTML = `<div class="se">
    <div class="se-top"><button class="icon-btn" data-back>${ic('x')}</button><input class="se-name" maxlength="14" placeholder="스킬 이름" value="${esc(st.name || '')}"><button class="se-ok">완료</button></div>
    <div class="se-stage"><canvas class="se-cv" width="800" height="800"></canvas><div class="se-hint"></div></div>
    <div class="se-bar"><button class="se-pp">${ic('play', 20)}</button><span class="se-time"></span><span class="se-meter"><i></i></span><b class="se-cost"></b></div>
    <div class="se-tl"><div class="tl-in"><div class="tl-ruler"></div><div class="tl-tracks"></div><i class="tl-head"></i></div></div>
    <div class="se-panel"></div>
    <div class="se-tools">${SE_TOOLS.map(([k, n, i]) => `<button data-tool="${k}">${ic(i, 22)}<small>${n}</small></button>`).join('')}</div></div>`;
  const cv = $('.se-cv', el), x = cv.getContext('2d'), tin = $('.tl-in', el);
  const cur = () => A.layers.find(L => L.id === sel) || A.layers[0];
  const hint = s => { $('.se-hint', el).textContent = s; };
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * 400 / r.width - SE_ORIGIN[0], (e.clientY - r.top) * 400 / r.height - SE_ORIGIN[1]]; };
  function render() {
    x.setTransform(2, 0, 0, 2, 0, 0); x.fillStyle = '#16161d'; x.fillRect(0, 0, 400, 400);
    x.strokeStyle = 'rgba(255,255,255,.05)'; x.lineWidth = 1; for (let i = 0; i <= 400; i += 25) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 400); x.moveTo(0, i); x.lineTo(400, i); x.stroke(); }
    const [ox, oy] = SE_ORIGIN;
    x.setLineDash([5, 5]); x.strokeStyle = 'rgba(255,255,255,.35)'; x.lineWidth = 2; x.beginPath(); x.arc(ox + SE_GHOST, oy, 26, 0, 7); x.stroke(); x.setLineDash([]);
    x.fillStyle = 'rgba(255,255,255,.45)'; x.font = '600 12px "IBM Plex Sans KR",sans-serif'; x.textAlign = 'center'; x.fillText('상대', ox + SE_GHOST, oy + 44); x.fillText('내 공', ox, oy + 44);
    x.fillStyle = (A.layers[0] || {}).color || '#FE2C55'; x.beginPath(); x.arc(ox, oy, 26, 0, 7); x.fill(); x.fillStyle = '#fff'; x.beginPath(); x.arc(ox, oy, 22, 0, 7); x.fill();
    const L = cur();
    if (L) { // 선택한 조각의 길
      x.setLineDash([4, 4]); x.strokeStyle = 'rgba(37,244,238,.7)'; x.lineWidth = 2; x.beginPath();
      for (let tt = L.start; tt <= L.end + 1e-6; tt += .03) { const k = keyAt(L, tt); tt === L.start ? x.moveTo(ox + k.x, oy + k.y) : x.lineTo(ox + k.x, oy + k.y); } x.stroke(); x.setLineDash([]);
      L.keys.forEach(k => { if (k.t < L.start - .01 || k.t > L.end + .01) return; x.save(); x.translate(ox + k.x, oy + k.y); x.rotate(Math.PI / 4); x.fillStyle = Math.abs(k.t - t) < .026 ? '#ffd43b' : '#25F4EE'; x.fillRect(-4, -4, 8, 8); x.restore(); });
    }
    A.layers.forEach(Ly => {
      if (t < Ly.start || t > Ly.end) return; const k = keyAt(Ly, t);
      x.save(); x.globalAlpha = Math.max(.08, k.o); x.translate(ox + k.x, oy + k.y); x.rotate(k.r * Math.PI / 180); if (Ly.glow) { x.shadowColor = Ly.color; x.shadowBlur = 16; }
      drawSpecShape(x, Ly.shape, 12 * k.s, Ly.color, sprites[Ly.id]); x.restore();
      if (Ly.id === sel) { const r = 12 * k.s + 6; x.strokeStyle = '#25F4EE'; x.lineWidth = 1.5; x.strokeRect(ox + k.x - r, oy + k.y - r, r * 2, r * 2); }
    });
    if (rec) { x.fillStyle = '#ff3b3b'; x.beginPath(); x.arc(16, 16, 6, 0, 7); x.fill(); x.fillStyle = '#fff'; x.textAlign = 'left'; x.fillText('움직임 그리는 중', 28, 20); }
  }
  function tl() {
    const W = A.dur; let ticks = ''; for (let tt = 0; tt <= W + 1e-6; tt += .5) ticks += `<span style="left:${tt / W * 100}%">${tt.toFixed(1)}</span>`;
    $('.tl-ruler', el).innerHTML = ticks;
    $('.tl-tracks', el).innerHTML = A.layers.map((L, i) => `<div class="tl-track ${L.id === sel ? 'on' : ''}" data-l="${L.id}"><div class="tl-clip" style="left:${L.start / W * 100}%;width:${(L.end - L.start) / W * 100}%;--c:${L.color}"><i class="tl-h" data-h="start"></i><span>조각 ${i + 1}</span><i class="tl-h" data-h="end"></i></div>${L.keys.filter(k => k.t >= L.start - .01 && k.t <= L.end + .01).map(k => `<b class="tl-key ${Math.abs(k.t - t) < .026 ? 'on' : ''}" style="left:${k.t / W * 100}%" data-kt="${k.t}"></b>`).join('')}</div>`).join('');
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
      if (drag && drag.rec) { const L = cur(); setKey(L, t, { x: drag.lx, y: drag.ly }); if (t >= L.end) { playing = false; rec = false; drag = null; hint('움직임을 만들었어요. 재생해서 확인해보세요'); tl(); panel(); } }
      if (t > A.dur) { t = drag && drag.rec ? A.dur : 0; }
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
  cv.onpointerup = cv.onpointercancel = () => { if (drag) { if (drag.rec) { playing = false; rec = false; hint('움직임을 만들었어요'); panel(); } drag = null; tl(); } };
  // 타임라인: 끌어서 시간 이동, 조각 끝 손잡이로 나오는 시간 조절
  tin.onpointerdown = e => {
    const r = tin.getBoundingClientRect(), tt = () => Math.max(0, Math.min(A.dur, (e2x - r.left) / r.width * A.dur)); let e2x = e.clientX;
    const tr = e.target.closest('[data-l]'); if (tr) { sel = tr.dataset.l; }
    const hd = e.target.closest('[data-h]'), kt = e.target.closest('[data-kt]');
    playing = false; tin.setPointerCapture(e.pointerId);
    if (kt) { t = +kt.dataset.kt; tl(); panel(); return; }
    const L = cur(), move = ev => { e2x = ev.clientX; const v = Math.round(tt() * 20) / 20; if (hd) { if (hd.dataset.h === 'start') L.start = Math.min(v, L.end - .1); else L.end = Math.max(v, L.start + .1); t = v; } else t = tt(); tl(); };
    move(e); tin.onpointermove = move; tin.onpointerup = () => { tin.onpointermove = null; panel(); };
  };
  $('.se-pp', el).onclick = () => { playing = !playing; if (playing && t >= A.dur - .01) t = 0; head(); };
  // 아래 도구
  const sl = (k, label, min, max, step, val) => `<label class="ed-rng"><span>${label}</span><input type="range" data-p="${k}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${(+val).toFixed(step < 1 ? 2 : 0)}</output></label>`;
  function panel() {
    const L = cur(), P = $('.se-panel', el), k = keyAt(L, t); let h0 = '';
    $$('.se-tools button', el).forEach(b => b.classList.toggle('on', b.dataset.tool === tool || (b.dataset.tool === 'move' && rec)));
    if (tool === 'move') h0 = `<p class="se-tip">${rec ? '지금 화면을 누른 채로 끌면 시간이 흐르면서 그 길대로 날아가요' : '조각을 끌면 지금 시간의 위치가 바뀌어요. 아래 버튼을 누르고 화면에 길을 그리면 움직임이 통째로 만들어져요'}</p><div class="chips"><button class="chip ${rec ? 'on' : ''}" data-act="rec">${ic('dash', 14)} ${rec ? '그리기 취소' : '길 그리기 시작'}</button><button class="chip" data-act="clearpath">길 지우기</button></div>`;
    if (tool === 'key') { const has = L.keys.some(q => Math.abs(q.t - t) < .026); h0 = `<p class="se-tip">키프레임은 그 시간의 위치·크기·회전·투명도를 기억해요. 키프레임 사이는 자연스럽게 이어져요</p><div class="chips"><button class="chip" data-act="key">${has ? '이 키프레임 지우기' : '여기에 키프레임 추가'}</button><button class="chip" data-act="prevkey">이전</button><button class="chip" data-act="nextkey">다음</button></div>`; }
    if (tool === 'size') h0 = sl('s', '크기', .3, 4, .05, k.s);
    if (tool === 'rot') h0 = sl('r', '회전', -360, 360, 5, k.r);
    if (tool === 'op') h0 = sl('o', '투명도', 0, 1, .05, k.o);
    if (tool === 'shape') h0 = `<div class="chips">${SPEC_OPT.shape.filter(s => s[0] !== 'drawing').map(([v, n]) => `<button class="chip ${L.shape === v ? 'on' : ''}" data-shape="${v}">${n}</button>`).join('')}<button class="chip ${L.shape === 'drawing' ? 'on' : ''}" data-act="draw">${ic('pencil', 14)} 그림 그리기</button></div>`;
    if (tool === 'color') h0 = `<div class="chips">${SK_COLORS.map(c => `<button class="sw ${L.color === c ? 'on' : ''}" data-col="${c}" style="--c:${c}"></button>`).join('')}<input type="color" data-colpick value="${L.color}"></div>`;
    if (tool === 'hit') h0 = sl('dmg', '피해', 1, 30, 1, L.dmg) + sl('knock', '밀어내기', 0, 600, 10, L.knock) + sl('explode', '폭발 범위', 0, 120, 5, L.explode) + `<div class="chips">${SPEC_OPT.effect.map(([v, n]) => `<button class="chip ${L.effect === v ? 'on' : ''}" data-eff="${v}">${n}</button>`).join('')}<button class="chip ${L.pierce ? 'on' : ''}" data-tg="pierce">관통</button></div>`;
    if (tool === 'opt') h0 = `<div class="chips">${[['trail', '꼬리 효과'], ['glow', '빛나기'], ['follow', '내 공 따라다니기'], ['fit', '상대 거리에 맞추기']].map(([k2, n]) => `<button class="chip ${L[k2] ? 'on' : ''}" data-tg="${k2}">${n}</button>`).join('')}</div>`;
    if (tool === 'time') h0 = sl('dur', '전체 길이', .5, 4, .1, A.dur);
    if (tool === 'self') h0 = sl('heal', '회복', 0, 30, 1, A.heal) + sl('shield', '방어막', 0, 40, 1, A.shield);
    if (tool === 'snd') h0 = `<p class="se-tip">${st.sound && st.sound.startsWith('data:') ? `영상 소리 ${st.sndLen || ''}초` : '소리 없음'}</p><div class="chips"><button class="chip" data-act="snd">${ic('film', 14)} 영상에서 소리 만들기</button><button class="chip" data-act="sndplay">${ic('play', 14)} 듣기</button><button class="chip" data-act="sndoff">없애기</button></div>`;
    if (tool === 'vid') h0 = `<p class="se-tip">${st.media ? '발동할 때 공 위에 영상·사진이 나와요' : '발동할 때 공 위에 나올 영상·사진 (선택)'}</p><div class="chips"><button class="chip" data-act="vid">${ic('upload', 14)} 갤러리에서 선택</button><button class="chip" data-act="videdit">${ic('wand', 14)} 편집·배경제거</button><button class="chip" data-act="vidoff">없애기</button></div>`;
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
  el.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b || !el.contains(b)) return; const L = cur();
    if (b.dataset.tool) {
      const k = b.dataset.tool; playing = false;
      if (k === 'add') { if (A.layers.length >= 6) return toast('조각은 6개까지 만들 수 있어요'); const n = layer0(Math.min(t, A.dur - .3), L.color); n.end = Math.min(A.dur, n.start + 1.2); n.keys.forEach(q => q.y = (A.layers.length % 2 ? -1 : 1) * 30 * Math.ceil(A.layers.length / 2)); A.layers.push(n); sel = n.id; tool = 'move'; hint('새 조각을 만들었어요. 끌어서 움직여보세요'); }
      else if (k === 'dup') { if (A.layers.length >= 6) return toast('조각은 6개까지 만들 수 있어요'); const n = JSON.parse(JSON.stringify(L)); n.id = 'l' + uid6(); n.keys.forEach(q => q.y += 24); A.layers.push(n); if (sprites[L.id]) sprites[n.id] = sprites[L.id]; sel = n.id; hint('조각을 복제했어요'); }
      else if (k === 'del') { if (A.layers.length <= 1) return toast('조각이 하나는 있어야 해요'); A.layers = A.layers.filter(q => q.id !== L.id); sel = A.layers[0].id; hint('조각을 지웠어요'); }
      else tool = k;
      tl(); panel(); return;
    }
    const act = b.dataset.act;
    if (act === 'rec') { rec = !rec; if (rec) { t = L.start; hint('화면을 누른 채로 끌어서 길을 그려요'); } panel(); }
    if (act === 'clearpath') { const k0 = keyAt(L, L.start); L.keys = [{ ...k0, t: L.start }]; tl(); }
    if (act === 'key') { const i = L.keys.findIndex(q => Math.abs(q.t - t) < .026); if (i >= 0) { if (L.keys.length > 1) L.keys.splice(i, 1); else toast('키프레임이 하나는 있어야 해요'); } else setKey(L, t, {}); tl(); panel(); }
    if (act === 'prevkey' || act === 'nextkey') { const ks = L.keys.map(q => q.t); const n = act === 'prevkey' ? ks.filter(v => v < t - .026).pop() : ks.find(v => v > t + .026); if (n != null) { t = n; tl(); panel(); } }
    if (b.dataset.shape) { L.shape = b.dataset.shape; panel(); }
    if (act === 'draw') openDraw(L.pic, (blob, pic) => { L.pic = pic; L.shape = 'drawing'; const i = new Image(); i.src = pic; sprites[L.id] = i; panel(); });
    if (b.dataset.col) { L.color = b.dataset.col; tl(); panel(); }
    if (b.dataset.eff) { L.effect = b.dataset.eff; panel(); head(); }
    if (b.dataset.tg) { L[b.dataset.tg] = !L[b.dataset.tg]; panel(); head(); }
    if (act === 'snd') openSoundMaker((url, len) => { st.sound = url; st.sndLen = len; AUD.bufs[url] = null; AUD.skill(url); panel(); });
    if (act === 'sndplay') { if (!st.sound || st.sound === 'none') return toast('먼저 소리를 만들어주세요'); AUD.skill(st.sound); }
    if (act === 'sndoff') { st.sound = 'none'; st.sndLen = 0; panel(); }
    if (act === 'vid') { const f = await pickFile('image/*,video/*'); if (!f) return; if (f.size > 40e6) return toast('40MB 이하 파일만 넣을 수 있어요'); const kind = f.type.startsWith('video') ? 'video' : 'image', key = await putBlob(f, 'm'), url = await blobURL(key); openEditor(url, kind, { key: { mode: 'ai', c: '#00ff00', tol: 90, soft: 50 } }, async ed2 => { st.media = { key, kind, edits: ed2 }; panel(); const asset = await shareBlob(key); if (asset && st.media && st.media.key === key) st.media.asset = asset; }, { ratio: 1 }); }
    if (act === 'videdit') { if (!st.media) return toast('먼저 영상이나 사진을 넣어주세요'); const url = await mediaSrc(st.media); openEditor(url, st.media.kind, st.media.edits, ed2 => { st.media.edits = ed2; }, { ratio: 1 }); }
    if (act === 'vidoff') { st.media = null; panel(); }
  });
  $('.se-ok', el).onclick = () => {
    const name = $('.se-name', el).value.trim(); if (!name) { $('.se-name', el).focus(); return toast('스킬 이름을 적어주세요'); }
    // 목록에 보일 아이콘: 스킬 중간 장면
    const ic2 = document.createElement('canvas'); ic2.width = ic2.height = 96; const t0 = t; t = A.dur * .45; render(); ic2.getContext('2d').drawImage(cv, 0, 0, 800, 800, 0, 0, 96, 96); t = t0;
    const data = { name, color: A.layers[0].color, comps: [], cd: SKILL_CD, spec: null, anim: A, sound: st.sound || 'none', sndLen: st.sndLen || 0, media: st.media || null, pic: ic2.toDataURL('image/png') };
    if (ed) { Object.assign(ed, data); save('skills'); toast('스킬을 수정했어요'); }
    else { const s = mkSkill(u.uid, name, data.color, [], SKILL_CD, data); if (!(u.equipped || []).some(id => usable(u, D.skills[id]))) equipToggle(u, s.id, false); save('skills'); toast(`'${name}' 스킬 완성!`); AUD.sfx('ding'); }
    back();
  };
  hint('조각을 끌어서 움직이고, 아래 타임라인으로 시간을 옮겨요');
  tl(); panel();
});
