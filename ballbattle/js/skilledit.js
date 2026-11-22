'use strict';
// ===== 스킬 편집기 (얼라이트 모션처럼 깔끔하고 쉽게) =====
// 스킬 = 여러 효과(레이어). 효과마다 시간에 따른 위치·크기·방향·투명도(키프레임)와 맞았을 때 피해를 가져요.
// 좌표는 '내 공'이 원점, 오른쪽(+x)이 상대 쪽. 게임에서는 실제 상대 방향으로 돌려서 써요.
const SE_ORIGIN = [110, 200], SE_GHOST = 200;
const EASE = { linear: u => u, smooth: u => u * u * (3 - 2 * u), fast: u => 1 - (1 - u) * (1 - u), slow: u => u * u, bounce: u => { const n = 7.5625, d = 2.75; return u < 1 / d ? n * u * u : u < 2 / d ? n * (u -= 1.5 / d) * u + .75 : u < 2.5 / d ? n * (u -= 2.25 / d) * u + .9375 : n * (u -= 2.625 / d) * u + .984375; } };
// 효과 종류 (영상처럼 단순한 모양)
const FX = {
  shot: { n: '탄환', d: '날아가서 맞히는 작은 공', i: 'proj', w: 1 },
  beam: { n: '레이저', d: '쭉 뻗는 선. 닿는 동안 계속 피해', i: 'laser', w: 1.8 },
  area: { n: '범위', d: '둥근 영역 안에 있으면 피해', i: 'grow', w: 1.6 },
  trail: { n: '자국', d: '지나간 자리에 남아서 밟으면 피해', i: 'drop', w: 1.5 },
  clone: { n: '분신', d: '내 공을 닮은 분신이 돌진', i: 'users', w: 1.2 },
  pic: { n: '사진·그림', d: '내 사진(배경 제거 무료)이나 직접 그린 그림', i: 'image', w: 1 },
};
const lType = L => L.type || (L.shape === 'drawing' ? 'pic' : 'shot');
function mkLayer(type, t = 0, o = {}) {
  const base = { id: 'l' + uid6(), type, color: '#FE2C55', pic: null, start: t, end: t + 1.2, dmg: 8, knock: 100, effect: 'none', explode: 0, pierce: false, trail: true, follow: false, fit: true, ease: 'linear', rep: 1, gap: .25, width: 6, stay: 2.5,
    keys: [{ t, x: 26, y: 0, s: 1, r: 0, o: 1 }, { t: t + 1, x: 200, y: 0, s: 1, r: 0, o: 1 }] };
  if (type === 'beam') Object.assign(base, { color: '#22a447', follow: true, fit: false, dmg: 5, knock: 40, width: 6, keys: [{ t, x: 22, y: 0, s: 3.6, r: -35, o: 1 }, { t: t + 1.1, x: 22, y: 0, s: 3.6, r: 35, o: 1 }] });
  if (type === 'area') Object.assign(base, { color: '#ef4444', follow: true, fit: false, dmg: 6, knock: 150, end: t + 1, keys: [{ t, x: 0, y: 0, s: 1, r: 0, o: .9 }, { t: t + .8, x: 0, y: 0, s: 3.2, r: 0, o: .9 }] });
  if (type === 'trail') Object.assign(base, { color: '#51cf66', dmg: 4, knock: 0, effect: 'slow', width: 18, keys: [{ t, x: 26, y: 0, s: 1, r: 0, o: 1 }, { t: t + .5, x: 110, y: -50, s: 1, r: 0, o: 1 }, { t: t + 1, x: 200, y: 20, s: 1, r: 0, o: 1 }] });
  if (type === 'clone') Object.assign(base, { color: '#7048e8', dmg: 10, knock: 260, keys: [{ t, x: 0, y: -30, s: .9, r: 0, o: .8 }, { t: t + 1, x: 200, y: 0, s: .9, r: 0, o: .8 }] });
  if (type === 'pic') base.keys.forEach(k => k.s = 2);
  return Object.assign(base, o);
}
const anim0 = () => ({ dur: 1.6, heal: 0, shield: 0, layers: [mkLayer('shot', 0)] });
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
function expandLayers(A) {
  const out = [];
  A.layers.forEach(L => { const n = Math.max(1, L.rep || 1); for (let i = 0; i < n; i++) { if (!i) { out.push(L); continue; } const d = i * (L.gap || .25); out.push({ ...L, copy: i, start: L.start + d, end: L.end + d, keys: L.keys.map(k => ({ ...k, t: k.t + d })) }); } });
  return out;
}
const animCost = A => A.layers.reduce((s, L) => s + (4 * L.dmg * (FX[lType(L)] || FX.shot).w * (L.pierce && lType(L) === 'shot' ? 1.5 : 1) + .02 * L.explode * L.dmg + ({ slow: 12, poison: 14, stun: 20, vamp: 14 }[L.effect] || 0) + .03 * L.knock) * Math.max(1, L.rep || 1), 0) + 2 * (A.heal || 0) + 1.5 * (A.shield || 0);
const animScale = A => Math.min(1, SPEC_BUDGET / Math.max(1, animCost(A)));
const animDur = A => Math.max(A.dur, ...expandLayers(A).map(L => L.end + (lType(L) === 'trail' ? L.stay || 2.5 : 0)));

// 효과 그리기 (게임·편집기 같이 씀). P = { x, y, ang(라디안), s, o, pts(자국) }
function drawFx(c, L, P, img, ballImg) {
  const ty = lType(L), col = L.color; c.save(); c.globalAlpha = Math.max(0, Math.min(1, P.o));
  if (ty === 'beam') {
    const len = 100 * P.s, x2 = P.x + Math.cos(P.ang) * len, y2 = P.y + Math.sin(P.ang) * len; c.lineCap = 'round';
    c.strokeStyle = col; c.lineWidth = L.width; c.globalAlpha *= .85; c.beginPath(); c.moveTo(P.x, P.y); c.lineTo(x2, y2); c.stroke();
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = Math.max(1, L.width * .3); c.stroke();
  } else if (ty === 'area') {
    const R = 30 * P.s; c.fillStyle = col; c.globalAlpha *= .14; c.beginPath(); c.arc(P.x, P.y, R, 0, 7); c.fill();
    c.globalAlpha = Math.max(0, Math.min(1, P.o)) * .75; c.strokeStyle = col; c.lineWidth = 2; c.stroke();
  } else if (ty === 'trail') {
    const pts = P.pts || []; c.lineCap = 'round'; c.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) { c.globalAlpha = Math.max(0, Math.min(1, P.o)) * .4 * (pts[i].a ?? 1); c.strokeStyle = col; c.lineWidth = L.width; c.beginPath(); c.moveTo(pts[i - 1].x, pts[i - 1].y); c.lineTo(pts[i].x, pts[i].y); c.stroke(); }
    c.globalAlpha = Math.max(0, Math.min(1, P.o)); c.fillStyle = col; c.beginPath(); c.arc(P.x, P.y, L.width * .45, 0, 7); c.fill();
  } else if (ty === 'clone') {
    const r = 22 * P.s; c.globalAlpha *= .8; c.fillStyle = col; c.beginPath(); c.arc(P.x, P.y, r, 0, 7); c.fill();
    c.save(); c.beginPath(); c.arc(P.x, P.y, r - 3, 0, 7); c.clip(); if (ballImg && ballImg.complete && ballImg.naturalWidth) c.drawImage(ballImg, P.x - r + 3, P.y - r + 3, (r - 3) * 2, (r - 3) * 2); else { c.fillStyle = '#fff'; c.fill(); } c.restore();
  } else if (ty === 'pic' && img && img.complete && img.naturalWidth) {
    const r = 12 * P.s; c.translate(P.x, P.y); c.rotate(P.ang); c.drawImage(img, -r * 1.4, -r * 1.4, r * 2.8, r * 2.8);
  } else { const r = 12 * P.s; c.fillStyle = col; c.beginPath(); c.arc(P.x, P.y, r, 0, 7); c.fill(); c.globalAlpha *= .35; c.strokeStyle = '#000'; c.lineWidth = 1.5; c.stroke(); }
  c.restore();
}

// --- 게임 엔진에서 실행 ---
Object.assign(Game.prototype, {
  castAnim(b, e, sk, pm) {
    const A = sk.s.anim;
    if (A.heal) { const v = Math.min(b.max - b.hp, A.heal * pm); if (v > 0) { b.hp += v; this.text(b.x, b.y - b.r - 8, '+' + Math.round(v), '#2f9e44'); AUD.sfx('heal'); } }
    if (A.shield) { b.shield = A.shield * pm; b.shieldT = 4; this.ring(b.x, b.y, b.r + 14, '#74c0fc', .5, 3); }
    const ang = Math.atan2(e.y - b.y, e.x - b.x), dist = Math.hypot(e.x - b.x, e.y - b.y), layers = expandLayers(A);
    this.anims.push({ layers, dur: animDur(A), sk, pm, b, e, ox: b.x, oy: b.y, ang, fit: Math.max(.4, dist / SE_GHOST), t: 0, st: layers.map(() => ({ done: false, hcd: 0, tk: {}, trail: [], pts: [], pos: null })) });
    AUD.sfx(layers.some(L => lType(L) === 'beam') ? 'laser' : 'pew');
  },
  updAnims(dt) {
    for (const a of this.anims) {
      a.t += dt; const ca = Math.cos(a.ang), sa = Math.sin(a.ang);
      a.layers.forEach((L, i) => {
        const S = a.st[i], ty = lType(L);
        if (ty === 'trail') { S.pts = S.pts.filter(q => a.t - q.t < (L.stay || 2.5)); S.pts.forEach(q => q.a = 1 - (a.t - q.t) / (L.stay || 2.5)); }
        const active = !S.done && a.t >= L.start && a.t <= L.end;
        if (!active) { S.pos = null; if (ty !== 'trail' || !S.pts.length) return; }
        let x, y, k;
        if (active) {
          k = keyAt(L, a.t); const lx = k.x * (L.fit ? a.fit : 1), ly = k.y, ox = L.follow ? a.b.x : a.ox, oy = L.follow ? a.b.y : a.oy;
          x = ox + lx * ca - ly * sa; y = oy + lx * sa + ly * ca;
          S.pos = { x, y, s: k.s * (ty === 'beam' && L.fit ? a.fit : 1), o: k.o, ang: k.r * Math.PI / 180 + a.ang }; S.trail.push([x, y]); if (S.trail.length > 8) S.trail.shift();
          if (ty === 'trail') { const last = S.pts[S.pts.length - 1]; if (!last || Math.hypot(last.x - x, last.y - y) > 6) S.pts.push({ x, y, t: a.t, a: 1 }); }
        }
        S.hcd = Math.max(0, S.hcd - dt);
        for (const tg of this.balls) {
          if (tg === a.b || tg.dead) continue; const tr = tg.r * tg.sc; let touch = false, hx = tg.x, hy = tg.y;
          if (ty === 'beam' && S.pos) { const P = S.pos, len = 100 * P.s; touch = segDist(tg.x, tg.y, P.x, P.y, P.x + Math.cos(P.ang) * len, P.y + Math.sin(P.ang) * len) < tr + L.width / 2; }
          else if (ty === 'area' && S.pos) touch = Math.hypot(tg.x - S.pos.x, tg.y - S.pos.y) < tr + 30 * S.pos.s;
          else if (ty === 'trail') touch = S.pts.some((q, j) => j % 2 === 0 && Math.hypot(tg.x - q.x, tg.y - q.y) < tr + L.width / 2);
          else if (S.pos && S.hcd <= 0 && S.pos.o > .15) { touch = Math.hypot(tg.x - S.pos.x, tg.y - S.pos.y) < tr + (ty === 'clone' ? 22 : 12) * S.pos.s; hx = S.pos.x; hy = S.pos.y; }
          if (!touch) continue;
          const tick = ty === 'beam' || ty === 'area' || ty === 'trail';
          if (tick) { if ((S.tk[tg.side] || 0) > a.t) continue; S.tk[tg.side] = a.t + (ty === 'beam' ? .4 : .5); }
          this.specHit({ p: { ...SPEC0, dmg: L.dmg, knock: tick ? L.knock * .3 : L.knock, effect: L.effect, explode: L.explode }, pm: a.pm, col: L.color, b: a.b }, tg, hx, hy);
          if (!tick) { if (L.pierce) S.hcd = .5; else { S.done = true; S.pos = null; break; } }
        }
      });
      if (a.t > a.dur + .05) a.done = true;
    }
    this.anims = this.anims.filter(a => !a.done);
  },
  drawAnims(c) {
    for (const a of this.anims) a.layers.forEach((L, i) => {
      const S = a.st[i], ty = lType(L);
      if (ty === 'trail') { if (S.pts.length) drawFx(c, L, { ...(S.pos || S.pts[S.pts.length - 1]), s: 1, o: S.pos ? S.pos.o : .8, pts: S.pts }); return; }
      const P = S.pos; if (!P) return;
      if (L.trail && ty === 'shot') S.trail.forEach(([x, y], j) => { c.globalAlpha = j / S.trail.length * .25 * P.o; c.fillStyle = L.color; c.beginPath(); c.arc(x, y, 12 * P.s * (.4 + .5 * j / S.trail.length), 0, 7); c.fill(); });
      c.globalAlpha = 1; drawFx(c, L, P, a.sk.sprites && a.sk.sprites[L.id], a.b.img);
    });
  },
});
function animSprites(s) { const o = {}; ((s.anim || {}).layers || []).forEach(L => { if (L.pic) { const i = new Image(); i.src = L.pic; o[L.id] = i; } }); return o; }
async function mediaToPic(url, kind, e) {
  const el = await loadEl(url, kind);
  if (kind === 'video') { await fixDur(el); await seekTo(el, (e.start || 0) + .05); }
  if (e.key && e.key.mode === 'ai') { try { await withTimeout(SEG.load(), 15000); } catch (x) { } }
  const c = document.createElement('canvas'); c.width = c.height = 256; drawEdited(c.getContext('2d', { willReadFrequently: true }), el, e, 256, 256, 'contain');
  return c.toDataURL('image/png');
}

// --- 편집기 화면 ---
screen('skilledit', (el, p) => {
  const u = me(), ed = p.id && D.skills[p.id] && D.skills[p.id].owner === u.uid ? D.skills[p.id] : null;
  const st = ed ? JSON.parse(JSON.stringify(ed)) : { name: '', sound: 'none', media: null };
  const A = st.anim = st.anim || anim0(); A.heal = A.heal || 0; A.shield = A.shield || 0;
  A.layers.forEach(L => { L.type = lType(L); Object.assign(L, { ease: L.ease || 'linear', rep: L.rep || 1, gap: L.gap || .25, width: L.width || 6, stay: L.stay || 2.5 }); });
  let sel = A.layers[0].id, t = 0, playing = false, rec = false, tool = null, drag = null, raf = 0, last = performance.now(), sprites = animSprites(st), clip = null;
  const hist = [], fut = []; let lastJ = JSON.stringify(A);
  const meImg = new Image(); meImg.src = avatarSrc(u);
  el.innerHTML = `<div class="am">
    <div class="am-top"><button class="icon-btn" data-back>${ic('back')}</button><input class="am-name" maxlength="14" placeholder="스킬 이름" value="${esc(st.name || '')}"><button class="icon-btn am-undo">${ic('rotate', 20)}</button><button class="icon-btn am-redo">${ic('rotate', 20)}</button><button class="am-save">저장</button></div>
    <div class="am-stage"><canvas class="am-cv" width="800" height="800"></canvas><div class="am-hint"></div></div>
    <div class="am-trans"><button class="am-tb" data-go="start">${ic('back', 18)}</button><button class="am-pp">${ic('play', 20)}</button><button class="am-tb" data-go="end">${ic('chevR', 18)}</button><span class="am-time"></span><span class="am-meter"><i></i></span><b class="am-cost"></b></div>
    <div class="am-tl"><div class="am-lcol"><div class="am-rsp"></div><div class="am-lbls"></div><button class="am-add">${ic('plus', 16)} 추가</button></div><div class="am-tcol"><div class="am-ruler"></div><div class="am-trks"></div><i class="am-head"></i></div></div>
    <div class="am-panel"></div>
    <div class="am-tools"></div></div>`;
  const cv = $('.am-cv', el), x = cv.getContext('2d'), tcol = $('.am-tcol', el);
  const cur = () => A.layers.find(L => L.id === sel) || A.layers[0];
  const hint = s => { $('.am-hint', el).textContent = s; };
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * 400 / r.width - SE_ORIGIN[0], (e.clientY - r.top) * 400 / r.height - SE_ORIGIN[1]]; };
  const commit = () => { const j = JSON.stringify(A); if (j !== lastJ) { hist.push(lastJ); if (hist.length > 50) hist.shift(); fut.length = 0; lastJ = j; } $('.am-undo', el).disabled = !hist.length; $('.am-redo', el).disabled = !fut.length; };
  const restore = j => { const o = JSON.parse(j); Object.keys(A).forEach(k => delete A[k]); Object.assign(A, o); lastJ = j; if (!A.layers.find(L => L.id === sel)) sel = A.layers[0].id; sprites = animSprites({ anim: A }); t = Math.min(t, A.dur); tl(); tools(); commit(); };
  $('.am-undo', el).onclick = () => { if (!hist.length) return; fut.push(lastJ); restore(hist.pop()); };
  $('.am-redo', el).onclick = () => { if (!fut.length) return; hist.push(lastJ); restore(fut.pop()); };
  // 편집기 미리보기에서 효과 위치 (자국은 지나온 길까지)
  const P0 = (L, tt) => { const k = keyAt(L, tt); return { x: SE_ORIGIN[0] + k.x, y: SE_ORIGIN[1] + k.y, s: k.s, o: k.o, ang: k.r * Math.PI / 180 }; };
  function render() {
    x.setTransform(2, 0, 0, 2, 0, 0); x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 400);
    x.strokeStyle = '#f0f0f3'; x.lineWidth = 1; for (let i = 25; i < 400; i += 25) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 400); x.moveTo(0, i); x.lineTo(400, i); x.stroke(); }
    const [ox, oy] = SE_ORIGIN;
    x.setLineDash([5, 5]); x.strokeStyle = '#adb5bd'; x.lineWidth = 2; x.beginPath(); x.arc(ox + SE_GHOST, oy, 26, 0, 7); x.stroke(); x.setLineDash([]);
    x.fillStyle = '#adb5bd'; x.font = '600 12px "IBM Plex Sans KR",sans-serif'; x.textAlign = 'center'; x.fillText('상대', ox + SE_GHOST, oy + 44); x.fillText('내 공', ox, oy + 44);
    x.fillStyle = PCOL[0]; x.beginPath(); x.arc(ox, oy, 26, 0, 7); x.fill(); x.save(); x.beginPath(); x.arc(ox, oy, 22.5, 0, 7); x.clip(); if (meImg.complete && meImg.naturalWidth) x.drawImage(meImg, ox - 22.5, oy - 22.5, 45, 45); x.restore();
    const L = cur();
    if (L && lType(L) !== 'beam' && lType(L) !== 'area') { // 선택한 효과가 지나가는 길
      x.setLineDash([3, 4]); x.strokeStyle = '#4c8dff'; x.lineWidth = 1.5; x.beginPath();
      for (let tt = L.start; tt <= L.end + 1e-6; tt += .03) { const k = keyAt(L, tt); tt === L.start ? x.moveTo(ox + k.x, oy + k.y) : x.lineTo(ox + k.x, oy + k.y); } x.stroke(); x.setLineDash([]);
      L.keys.forEach(k => { if (k.t < L.start - .01 || k.t > L.end + .01) return; x.save(); x.translate(ox + k.x, oy + k.y); x.rotate(Math.PI / 4); x.fillStyle = Math.abs(k.t - t) < .026 ? '#f59f00' : '#4c8dff'; x.fillRect(-3.5, -3.5, 7, 7); x.restore(); });
    }
    expandLayers(A).forEach(Ly => {
      const ty = lType(Ly);
      if (ty === 'trail') { const pts = []; for (let tt = Ly.start; tt <= Math.min(t, Ly.end) + 1e-6; tt += .04) { if (t - tt < Ly.stay) { const q = P0(Ly, tt); pts.push({ x: q.x, y: q.y, a: 1 - (t - tt) / Ly.stay }); } } if (pts.length) drawFx(x, Ly, { ...pts[pts.length - 1], s: 1, o: t <= Ly.end ? 1 : .8, pts }); return; }
      if (t < Ly.start || t > Ly.end) return;
      drawFx(x, Ly, P0(Ly, t), sprites[Ly.id], meImg);
      if (Ly.id === sel && !Ly.copy) { const q = P0(Ly, t), r = ty === 'area' ? 30 * q.s : ty === 'clone' ? 22 * q.s : ty === 'beam' ? 8 : 12 * q.s; x.strokeStyle = '#4c8dff'; x.lineWidth = 1.5; x.strokeRect(q.x - r - 4, q.y - r - 4, (r + 4) * 2, (r + 4) * 2); }
    });
    if (rec) { x.fillStyle = '#e03131'; x.beginPath(); x.arc(16, 16, 5, 0, 7); x.fill(); x.fillStyle = '#e03131'; x.textAlign = 'left'; x.fillText('경로 기록 중', 26, 20); }
  }
  function tl() {
    const W = A.dur; let ticks = ''; for (let tt = 0; tt <= W + 1e-6; tt += .5) ticks += `<span style="left:${tt / W * 100}%">${tt.toFixed(1)}s</span>`;
    $('.am-ruler', el).innerHTML = ticks;
    $('.am-lbls', el).innerHTML = A.layers.map(L => `<button class="am-lbl ${L.id === sel ? 'on' : ''}" data-l="${L.id}" style="--c:${L.color}">${ic(FX[lType(L)].i, 15)}<span>${FX[lType(L)].n}${L.rep > 1 ? ' ×' + L.rep : ''}</span></button>`).join('');
    $('.am-trks', el).innerHTML = A.layers.map(L => `<div class="am-trk ${L.id === sel ? 'on' : ''}" data-l="${L.id}"><div class="am-clip" style="left:${L.start / W * 100}%;width:${(L.end - L.start) / W * 100}%;--c:${L.color}"><i class="am-h" data-h="start"></i><i class="am-h" data-h="end"></i></div>${L.keys.filter(k => k.t >= L.start - .01 && k.t <= L.end + .01).map(k => `<b class="am-key ${Math.abs(k.t - t) < .026 ? 'on' : ''}" style="left:${k.t / W * 100}%" data-kt="${k.t}"></b>`).join('')}</div>`).join('');
    head();
  }
  function head() {
    $('.am-head', el).style.left = (t / A.dur * 100) + '%'; $('.am-time', el).textContent = `${t.toFixed(2)}s`;
    const c = animCost(A), over = c > SPEC_BUDGET; $('.am-meter i', el).style.width = Math.min(100, c / SPEC_BUDGET * 100) + '%'; $('.am-meter i', el).classList.toggle('over', over);
    $('.am-cost', el).textContent = over ? `위력 ${Math.round(animScale(A) * 100)}%` : `위력 ${Math.round(c)}/${SPEC_BUDGET}`;
    $('.am-pp', el).innerHTML = ic(playing ? 'pause' : 'play', 20);
  }
  const loop = now => {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (playing) {
      t += dt;
      if (drag && drag.rec) { const L = cur(); setKey(L, t, { x: drag.lx, y: drag.ly }); if (t >= L.end) { playing = false; rec = false; drag = null; hint('경로를 만들었어요'); commit(); tl(); tools(); } }
      if (t > A.dur) t = drag && drag.rec ? A.dur : 0;
      head();
    }
    render(); raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  el._leave = () => cancelAnimationFrame(raf);
  cv.onpointerdown = e => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId); const [lx, ly] = pos(e);
    const hit = [...A.layers].reverse().find(L => { if (t < L.start || t > L.end) return false; const k = keyAt(L, t), ty = lType(L), rr = ty === 'area' ? 30 * k.s : ty === 'clone' ? 22 * k.s : 12 * k.s; return Math.hypot(k.x - lx, k.y - ly) < rr + 12; });
    if (hit && hit.id !== sel) { sel = hit.id; tl(); tools(); }
    const L = cur(); if (!L) return;
    if (rec) { if (t < L.start || t >= L.end) t = L.start; L.keys = L.keys.filter(k => k.t < t - .01 || k.t > L.end + .01); drag = { rec: true, lx, ly }; setKey(L, t, { x: lx, y: ly }); playing = true; hint('손을 떼지 말고 움직이세요'); }
    else if (hit) { drag = { rec: false }; playing = false; setKey(L, t, { x: lx, y: ly }); }
  };
  cv.onpointermove = e => { if (!drag) return; const [lx, ly] = pos(e); if (drag.rec) { drag.lx = lx; drag.ly = ly; } else setKey(cur(), t, { x: lx, y: ly }); };
  cv.onpointerup = cv.onpointercancel = () => { if (drag) { if (drag.rec) { playing = false; rec = false; hint('경로를 만들었어요'); tools(); } drag = null; commit(); tl(); } };
  $('.am-lbls', el).onclick = e => { const b = e.target.closest('[data-l]'); if (b) { sel = b.dataset.l; tool = null; tl(); tools(); } };
  tcol.onpointerdown = e => {
    const r = $('.am-trks', el).getBoundingClientRect(); let ex = e.clientX; const tt = () => Math.max(0, Math.min(A.dur, (ex - r.left) / r.width * A.dur));
    const tr = e.target.closest('[data-l]'); if (tr && tr.dataset.l !== sel) { sel = tr.dataset.l; tools(); }
    const hd = e.target.closest('[data-h]'), kt = e.target.closest('[data-kt]');
    playing = false; tcol.setPointerCapture(e.pointerId);
    if (kt) { t = +kt.dataset.kt; tl(); tools(); return; }
    const L = cur(), move = ev => { ex = ev.clientX; const v = Math.round(tt() * 20) / 20; if (hd) { if (hd.dataset.h === 'start') L.start = Math.min(v, L.end - .1); else L.end = Math.max(v, L.start + .1); t = v; } else t = tt(); tl(); };
    move(e); tcol.onpointermove = move; tcol.onpointerup = () => { tcol.onpointermove = null; commit(); tools(); };
  };
  $('.am-pp', el).onclick = () => { playing = !playing; if (playing && t >= A.dur - .01) t = 0; head(); };
  $$('[data-go]', el).forEach(b => b.onclick = () => { playing = false; t = b.dataset.go === 'start' ? 0 : A.dur; tl(); tools(); });
  // 효과 추가: 영상 속 스킬처럼 단순한 6가지
  $('.am-add', el).onclick = () => {
    if (A.layers.length >= 6) return toast('효과는 6개까지 넣을 수 있어요');
    const m = modal(`<h3 class="m-title">효과 추가</h3><div class="am-types">${Object.entries(FX).map(([k, f]) => `<button class="am-type" data-type="${k}">${ic(f.i, 22)}<div><b>${f.n}</b><small>${f.d}</small></div></button>`).join('')}</div>`, { cls: 'sheet am-sheet' });
    $$('[data-type]', m).forEach(b => b.onclick = async () => {
      m.close(); const ty = b.dataset.type, t0 = Math.min(t, A.dur - .3);
      const add = (pic) => { const n = mkLayer(ty, t0, pic ? { pic } : {}); n.end = Math.min(A.dur, n.end); if (pic) { const i = new Image(); i.src = pic; sprites[n.id] = i; } A.layers.push(n); sel = n.id; tool = null; commit(); tl(); tools(); hint(`${FX[ty].n} 효과를 넣었어요. 화면에서 끌어서 움직여보세요`); };
      if (ty !== 'pic') return add();
      sheet('사진·그림', [
        { label: '사진에서 가져오기 (배경 제거)', fn: async () => { const f = await pickFile('image/*,video/*'); if (!f) return; const kind = f.type.startsWith('video') ? 'video' : 'image', url = URL.createObjectURL(f); openEditor(url, kind, { key: { mode: 'ai', c: '#00ff00', tol: 90, soft: 50 } }, async e2 => { hint('사진을 준비하는 중'); add(await mediaToPic(url, kind, e2)); }, { ratio: 1 }); } },
        { label: '직접 그리기', fn: () => openDraw(null, (blob, pic) => add(pic)) },
      ]);
    });
  };
  // 아래 도구: 선택한 효과에 맞는 것만
  const sl = (k, label, min, max, step, val) => `<label class="ed-rng"><span>${label}</span><input type="range" data-p="${k}" min="${min}" max="${max}" step="${step}" value="${val}"><output>${(+val).toFixed(step < 1 ? 2 : 0)}</output></label>`;
  const chipsOf = (attr, list, curV) => `<div class="chips">${list.map(([v, n]) => `<button class="chip ${curV === v ? 'on' : ''}" data-${attr}="${v}">${n}</button>`).join('')}</div>`;
  function toolList() {
    const ty = lType(cur());
    return [['path', '경로', 'dash'], ['key', '키프레임', 'diamond'], ['s', ty === 'beam' ? '길이' : '크기', 'grow'], ...(ty === 'beam' || ty === 'pic' ? [['r', '방향', 'rotate']] : []), ...(ty === 'beam' || ty === 'trail' ? [['w', '두께', 'sliders']] : []), ['o', '투명도', 'eye'], ['color', '색', 'palette'], ['hit', '피해', 'burst'], ['ease', '속도 곡선', 'gauge'], ['rep', '반복', 'copy'], ['opt', '옵션', 'sliders'], ['dup', '복제', 'copy'], ['del', '삭제', 'x'], ['|'], ['dur', '전체 길이', 'gauge'], ['self', '내 공', 'heal'], ['snd', '소리', 'music'], ['vid', '영상', 'film']];
  }
  function tools() {
    $('.am-tools', el).innerHTML = toolList().map(([k, n, i]) => k === '|' ? '<i class="am-sep"></i>' : `<button data-tool="${k}" class="${tool === k ? 'on' : ''}">${ic(i, 21)}<small>${n}</small></button>`).join('');
    panel();
  }
  function panel() {
    const L = cur(), P = $('.am-panel', el), k = keyAt(L, t), ty = lType(L); let h0 = '';
    if (!tool) h0 = `<p class="se-tip">${FX[ty].n}: ${FX[ty].d}. 화면에서 끌면 지금 시간의 위치가 저장돼요</p>`;
    if (tool === 'path') h0 = `<div class="chips"><button class="chip ${rec ? 'on' : ''}" data-act="rec">${rec ? '기록 취소' : '경로 그리기'}</button><button class="chip" data-act="mirror">위아래 뒤집기</button><button class="chip" data-act="reverse">거꾸로</button><button class="chip" data-act="bigger">크게</button><button class="chip" data-act="smaller">작게</button><button class="chip" data-act="clearpath">지우기</button></div>`;
    if (tool === 'key') { const has = L.keys.some(q => Math.abs(q.t - t) < .026); h0 = `<div class="chips"><button class="chip" data-act="key">${has ? '키프레임 지우기' : '키프레임 추가'}</button><button class="chip" data-act="prevkey">이전</button><button class="chip" data-act="nextkey">다음</button><button class="chip" data-act="copykey">복사</button><button class="chip" data-act="pastekey" ${clip ? '' : 'disabled'}>붙여넣기</button></div>`; }
    if (tool === 's') h0 = sl('s', ty === 'beam' ? '길이' : '크기', .3, ty === 'beam' ? 6 : 4, .05, k.s);
    if (tool === 'r') h0 = sl('r', '방향', -180, 180, 5, k.r);
    if (tool === 'o') h0 = sl('o', '투명도', 0, 1, .05, k.o);
    if (tool === 'w') h0 = sl('width', '두께', 2, 30, 1, L.width) + (ty === 'trail' ? sl('stay', '남는 시간', .5, 5, .1, L.stay) : '');
    if (tool === 'color') h0 = `<div class="chips">${[...PCOL, ...SK_COLORS.filter(c => c !== '#111111')].map(c => `<button class="sw ${L.color === c ? 'on' : ''}" data-col="${c}" style="--c:${c}"></button>`).join('')}<input type="color" data-colpick value="${L.color}"></div>`;
    if (tool === 'hit') h0 = sl('dmg', '피해', 1, 30, 1, L.dmg) + sl('knock', '밀어내기', 0, 600, 10, L.knock) + sl('explode', '폭발', 0, 120, 5, L.explode) + chipsOf('eff', SPEC_OPT.effect, L.effect) + (ty === 'shot' || ty === 'clone' || ty === 'pic' ? `<div class="chips"><button class="chip ${L.pierce ? 'on' : ''}" data-tg="pierce">관통</button></div>` : '');
    if (tool === 'ease') h0 = chipsOf('ease', [['linear', '일정하게'], ['smooth', '부드럽게'], ['fast', '빠르게 시작'], ['slow', '천천히 시작'], ['bounce', '튀기']], L.ease);
    if (tool === 'rep') h0 = sl('rep', '횟수', 1, 6, 1, L.rep) + sl('gap', '간격', .05, .8, .05, L.gap);
    if (tool === 'opt') h0 = `<div class="chips">${[...(ty === 'shot' ? [['trail', '꼬리']] : []), ['follow', '내 공 따라다니기'], ['fit', '상대 거리에 맞추기']].map(([k2, n]) => `<button class="chip ${L[k2] ? 'on' : ''}" data-tg="${k2}">${n}</button>`).join('')}</div>`;
    if (tool === 'dur') h0 = sl('dur', '전체 길이', .5, 4, .1, A.dur);
    if (tool === 'self') h0 = sl('heal', '회복', 0, 30, 1, A.heal) + sl('shield', '방어막', 0, 40, 1, A.shield);
    if (tool === 'snd') h0 = `<p class="se-tip">${st.sound && st.sound.startsWith('data:') ? `영상 소리 ${st.sndLen || ''}초` : '소리 없음'}</p><div class="chips"><button class="chip" data-act="snd">영상에서 소리 만들기</button><button class="chip" data-act="sndplay">듣기</button><button class="chip" data-act="sndoff">없애기</button></div>`;
    if (tool === 'vid') h0 = `<p class="se-tip">발동할 때 공 위에 나올 영상·사진 (배경 제거 무료)</p><div class="chips"><button class="chip" data-act="vid">갤러리에서 선택</button><button class="chip" data-act="videdit">편집·배경제거</button><button class="chip" data-act="vidoff">없애기</button></div>`;
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
  el.addEventListener('click', async e => {
    const b = e.target.closest('.am-tools button, .am-panel button'); if (!b) return; const L = cur();
    if (b.dataset.tool) {
      const k = b.dataset.tool; playing = false;
      if (k === 'dup') { if (A.layers.length >= 6) return toast('효과는 6개까지 넣을 수 있어요'); const n = JSON.parse(JSON.stringify(L)); n.id = 'l' + uid6(); n.keys.forEach(q => q.y += 24); A.layers.push(n); if (sprites[L.id]) sprites[n.id] = sprites[L.id]; sel = n.id; tool = null; }
      else if (k === 'del') { if (A.layers.length <= 1) return toast('효과가 하나는 있어야 해요'); A.layers = A.layers.filter(q => q.id !== L.id); sel = A.layers[0].id; tool = null; }
      else tool = tool === k ? null : k;
      commit(); tl(); tools(); return;
    }
    const act = b.dataset.act;
    if (act === 'rec') { rec = !rec; if (rec) { t = L.start; hint('화면을 누른 채로 끌어서 경로를 그려요'); } }
    if (act === 'clearpath') { const k0 = keyAt(L, L.start); L.keys = [{ ...k0, t: L.start }]; }
    if (act === 'key') { const i = L.keys.findIndex(q => Math.abs(q.t - t) < .026); if (i >= 0) { if (L.keys.length > 1) L.keys.splice(i, 1); } else setKey(L, t, {}); }
    if (act === 'prevkey' || act === 'nextkey') { const ks = L.keys.map(q => q.t); const n = act === 'prevkey' ? ks.filter(v => v < t - .026).pop() : ks.find(v => v > t + .026); if (n != null) t = n; }
    if (act === 'copykey') { const k = keyAt(L, t); clip = { x: k.x, y: k.y, s: k.s, r: k.r, o: k.o }; hint('복사했어요'); }
    if (act === 'pastekey' && clip) setKey(L, t, clip);
    if (act === 'mirror') L.keys.forEach(q => { q.y = -q.y; q.r = -q.r; });
    if (act === 'reverse') { const xs = L.keys.map(q => ({ ...q })).reverse(); L.keys.forEach((q, i) => Object.assign(q, { x: xs[i].x, y: xs[i].y, s: xs[i].s, r: xs[i].r, o: xs[i].o })); }
    if (act === 'bigger' || act === 'smaller') { const f = act === 'bigger' ? 1.2 : 1 / 1.2; L.keys.forEach(q => { q.x *= f; q.y *= f; }); }
    if (b.dataset.ease) L.ease = b.dataset.ease;
    if (b.dataset.col) L.color = b.dataset.col;
    if (b.dataset.eff) L.effect = b.dataset.eff;
    if (b.dataset.tg) L[b.dataset.tg] = !L[b.dataset.tg];
    if (act === 'snd') openSoundMaker((url, len) => { st.sound = url; st.sndLen = len; AUD.bufs[url] = null; AUD.skill(url); panel(); });
    if (act === 'sndplay') { if (!st.sound || st.sound === 'none') return toast('먼저 소리를 만들어주세요'); AUD.skill(st.sound); }
    if (act === 'sndoff') st.sound = 'none';
    if (act === 'vid') { const f = await pickFile('image/*,video/*'); if (!f) return; if (f.size > 40e6) return toast('40MB 이하 파일만 넣을 수 있어요'); const kind = f.type.startsWith('video') ? 'video' : 'image', key = await putBlob(f, 'm'), url = await blobURL(key); openEditor(url, kind, { key: { mode: 'ai', c: '#00ff00', tol: 90, soft: 50 } }, async e2 => { st.media = { key, kind, edits: e2 }; panel(); const asset = await shareBlob(key); if (asset && st.media && st.media.key === key) st.media.asset = asset; }, { ratio: 1 }); }
    if (act === 'videdit') { if (!st.media) return toast('먼저 영상이나 사진을 넣어주세요'); const url = await mediaSrc(st.media); openEditor(url, st.media.kind, st.media.edits, e2 => { st.media.edits = e2; }, { ratio: 1 }); }
    if (act === 'vidoff') st.media = null;
    commit(); tl(); panel(); head();
  });
  $('.am-save', el).onclick = () => {
    const name = $('.am-name', el).value.trim(); if (!name) { $('.am-name', el).focus(); return toast('스킬 이름을 적어주세요'); }
    const ic2 = document.createElement('canvas'); ic2.width = ic2.height = 96; const t0 = t; t = A.dur * .45; render(); ic2.getContext('2d').drawImage(cv, 0, 0, 800, 800, 0, 0, 96, 96); t = t0;
    const data = { name, color: A.layers[0].color, comps: [], cd: SKILL_CD, spec: null, anim: A, sound: st.sound || 'none', sndLen: st.sndLen || 0, media: st.media || null, pic: ic2.toDataURL('image/png') };
    if (ed) { Object.assign(ed, data); save('skills'); toast('스킬을 저장했어요'); }
    else { const s = mkSkill(u.uid, name, data.color, [], SKILL_CD, data); if (!(u.equipped || []).some(id => usable(u, D.skills[id]))) equipToggle(u, s.id, false); save('skills'); toast(`'${name}' 스킬 완성!`); AUD.sfx('ding'); }
    back();
  };
  hint('효과를 끌어서 움직이고, 아래 타임라인에서 시간을 옮겨요');
  commit(); tl(); tools();
});
