(() => {
  const DEPTH = 3; // 추천·컴퓨터 탐색 깊이
  const $ = (id) => document.getElementById(id);

  const boardEl = $('board'), squaresEl = $('squares'), marksEl = $('marks'), piecesEl = $('pieces');
  const promoEl = $('promo'), veilEl = $('veil');
  const els = new Map(); // 기물 id -> DOM

  let state, legal = [], keys, played = [], selected = null, over = null, hint = null, promoMoves = null;
  let me, flipped = false, busy = true, token = 0;

  document.addEventListener('pointerdown', Sound.init);

  // ---------- 좌표 / 변형 ----------
  function screenPos(s) {
    let r = s >> 3, c = s & 7;
    if (flipped) { r = 7 - r; c = 7 - c; }
    return [r, c];
  }
  const at = (r, c) => `translate(${c * 100}%, ${r * 100}%)`;
  const translate = (s) => at(...screenPos(s));
  const pose = (y = 0, ry = 0, rz = 0, sx = 1, sy = sx) =>
    `perspective(320px) translateY(${y}%) rotateY(${ry}deg) rotate(${rz}deg) scale(${sx}, ${sy})`;

  function later(fn, ms) {
    const t = token;
    setTimeout(() => { if (t === token) fn(); }, ms);
  }

  // ---------- 보드 / 기물 DOM ----------
  function buildSquares() {
    let html = '';
    for (let vr = 0; vr < 8; vr++) {
      for (let vc = 0; vc < 8; vc++) {
        const r = flipped ? 7 - vr : vr, c = flipped ? 7 - vc : vc;
        html += `<div class="sq ${(r + c) % 2 ? 'd' : 'l'}"></div>`;
      }
    }
    squaresEl.innerHTML = html;
  }

  function makePiece(p, s) {
    const el = document.createElement('div');
    el.className = 'piece';
    el.innerHTML =
      `<div class="shadow"></div><div class="body">${pieceSVG(p.type, p.color)}</div>`;
    el.style.transform = translate(s);
    el.body = el.querySelector('.body');
    el.shadow = el.querySelector('.shadow');
    piecesEl.appendChild(el);
    els.set(p.id, el);
    return el;
  }

  function renderMarks() {
    let html = '';
    const add = (s, cls) => { html += `<div class="mark ${cls}" style="transform:${translate(s)}"></div>`; };
    if (Chess.inCheck(state, state.turn)) add(Chess.kingSq(state.board, state.turn), 'check');
    if (hint && selected !== hint.best.move.from) add(hint.best.move.from, 'hint');
    if (selected !== null) {
      add(selected, 'sel');
      const rec = hint && hint.byFrom.get(selected);
      const done = new Set();
      for (const m of legal) {
        if (m.from !== selected || done.has(m.to)) continue;
        done.add(m.to);
        const best = rec && rec.move.to === m.to ? ' best' : '';
        add(m.to, (m.capture !== undefined ? 'take' : 'move') + best);
      }
    }
    marksEl.innerHTML = html;
  }

  function renderPromo() {
    if (!promoMoves) { promoEl.hidden = true; return; }
    const c = screenPos(promoMoves[0].to)[1];
    promoEl.innerHTML = 'qnrb'.split('').map((t, r) =>
      `<div class="promo-opt" style="transform:${at(r, c)}">${pieceSVG(t, me)}</div>`).join('');
    promoEl.hidden = false;
  }

  function showVeil(title, text) {
    $('veilTitle').textContent = title;
    $('veilText').textContent = text;
    veilEl.hidden = false;
  }

  // ---------- 애니메이션 ----------
  // 기물이 몸을 옆으로 비틀며 판 위를 미끄러지듯 이동하고, 내려앉을 때 눌렸다 펴진다
  function travel(el, from, to, delay = 0) {
    const [r0, c0] = screenPos(from), [r1, c1] = screenPos(to);
    const dist = Math.hypot(r1 - r0, c1 - c0);
    const dur = Math.round(Math.min(640, 340 + dist * 42));
    const tail = 160;
    const dir = Math.sign(c1 - c0) || (c0 < 4 ? -1 : 1);
    const lean = dir * 12, twist = -dir * 38;
    const a = dur / (dur + tail);
    const opts = { duration: dur + tail, delay, easing: 'ease-in-out', fill: 'backwards' };

    el.style.zIndex = 5;
    el.style.transform = at(r1, c1);
    el.animate([{ transform: at(r0, c0) }, { transform: at(r1, c1) }],
      { duration: dur, delay, easing: 'cubic-bezier(.45,.05,.3,1)', fill: 'backwards' });
    el.body.animate([
      { offset: 0, transform: pose() },
      { offset: a * 0.2, transform: pose(-4, twist * 0.6, lean * 0.5, 1.04) },
      { offset: a * 0.55, transform: pose(-8, twist, lean, 1.08) },
      { offset: a * 0.85, transform: pose(-3, -twist * 0.3, -lean * 0.35, 1.03) },
      { offset: a, transform: pose(0, 0, 0, 1.07, 0.9) },
      { offset: a + (1 - a) * 0.5, transform: pose(0, 0, 0, 0.98, 1.03) },
      { offset: 1, transform: pose() },
    ], opts);
    el.shadow.animate([
      { offset: 0, transform: 'scale(1)', opacity: 0 },
      { offset: a * 0.55, transform: 'scale(.8)', opacity: 0.45 },
      { offset: a, transform: 'scale(1)', opacity: 0 },
      { offset: 1, opacity: 0 },
    ], opts);
    later(() => { el.style.zIndex = ''; }, delay + dur + tail);

    Sound.scrape(delay, dur * 0.95);          // 나무 긁는 소리
    Sound.knock(delay + dur, { gain: 1 });    // 나무 치는 소리
    return { land: delay + dur, end: delay + dur + tail, dir };
  }

  // 잡을 때: 부딪히는 순간 상대 기물을 툭 튕겨 판 밖으로 날려 보낸다
  function flick(att, vic, s, from, T) {
    const [r, c] = screenPos(s), [r0, c0] = screenPos(from);
    let vx = c - c0, vy = r - r0;
    const len = Math.hypot(vx, vy) || 1;
    vx /= len;
    vy /= len;
    const exit = (p, v) => (v > 0 ? (8.6 - p) / v : v < 0 ? (p + 1.6) / -v : Infinity);
    const dist = Math.min(exit(c, vx), exit(r, vy)) + 1.5;
    const spin = (vx >= 0 ? 1 : -1) * (540 + Math.random() * 300);
    const fly = Math.round(620 + dist * 35);

    const frames = [];
    for (let i = 0; i <= 28; i++) {
      const t = i / 28;
      const e = 1 - Math.pow(1 - t, 2.2);
      const up = Math.sin(Math.PI * Math.min(1, t * 1.1));
      frames.push({
        transform: `${at(r + vy * dist * e - up * 0.6, c + vx * dist * e)} rotate(${(spin * e).toFixed(1)}deg) scale(${(1 + 0.35 * up).toFixed(3)})`,
        opacity: t > 0.8 ? (1 - t) / 0.2 : 1,
      });
    }
    vic.style.zIndex = 6;
    vic.body.animate([
      { transform: pose() },
      { offset: 0.5, transform: pose(0, 0, 0, 0.88, 1.08) },
      { transform: pose() },
    ], { duration: 120, delay: T, easing: 'ease-out' });
    vic.animate(frames, { duration: fly, delay: T, easing: 'linear', fill: 'forwards' });
    vic.shadow.animate([
      { transform: 'scale(1)', opacity: 0 },
      { offset: 0.3, transform: 'scale(.6) translateY(120%)', opacity: 0.4 },
      { transform: 'scale(.6) translateY(120%)', opacity: 0 },
    ], { duration: fly, delay: T, fill: 'forwards' });
    att.body.animate([
      { transform: pose() },
      { offset: 0.35, transform: pose(-2, 0, Math.sign(vx || 1) * 14, 1.05, 0.95) },
      { transform: pose() },
    ], { duration: 260, delay: T - 20, easing: 'ease-out' });
    later(() => vic.remove(), T + fly + 30);

    Sound.knock(T, { gain: 0.8, pitch: 1.5 });                                   // 툭
    Sound.knock(T + fly * 0.8, { gain: 0.4, pitch: 0.75, muffle: true });        // 판 밖에 떨어짐
    Sound.knock(T + fly * 0.8 + 140, { gain: 0.16, pitch: 0.8, muffle: true });
    return T + fly;
  }

  function promote(el, type, color) {
    el.body.firstElementChild.outerHTML = pieceSVG(type, color);
    el.body.animate([
      { transform: pose(0, 0, 0, 0.7) },
      { offset: 0.6, transform: pose(-6, 0, 0, 1.15) },
      { transform: pose() },
    ], { duration: 320, easing: 'ease-out' });
    Sound.knock(0, { gain: 0.5, pitch: 1.3 });
  }

  function animateMove(prev, m) {
    const mover = prev.board[m.from];
    const el = els.get(mover.id);
    const t = travel(el, m.from, m.to);
    let end = t.end;
    if (m.castle) end = Math.max(end, travel(els.get(prev.board[m.rookFrom].id), m.rookFrom, m.rookTo, 170).end);
    if (m.capture !== undefined) {
      const victim = prev.board[m.capture];
      const vel = els.get(victim.id);
      els.delete(victim.id);
      end = Math.max(end, flick(el, vel, m.capture, m.from, t.land - 70));
    }
    if (m.promo) {
      later(() => promote(el, m.promo, mover.color), t.land + 60);
      end = Math.max(end, t.land + 400);
    }
    return end;
  }

  // 게임 시작: 기물이 위에서 떨어져 제자리에 놓인다
  function dropIn(el, delay, dur) {
    const rz = (Math.random() - 0.5) * 50;
    el.body.animate([
      { offset: 0, transform: pose(-230, 0, rz, 1.25), opacity: 0, easing: 'cubic-bezier(.5,0,.9,.6)' },
      { offset: 0.15, opacity: 1 },
      { offset: 0.6, transform: pose(0, 0, 0, 1.1, 0.86), easing: 'ease-out' },
      { offset: 0.8, transform: pose(-9, 0, 0, 0.96, 1.05), easing: 'ease-in' },
      { offset: 1, transform: pose(), opacity: 1 },
    ], { duration: dur, delay, fill: 'backwards' });
    el.shadow.animate([
      { transform: 'scale(.2)', opacity: 0 },
      { offset: 0.55, transform: 'scale(.8)', opacity: 0.4 },
      { transform: 'scale(1)', opacity: 0 },
    ], { duration: dur, delay, easing: 'ease-in', fill: 'backwards' });
  }

  function setupBoard() {
    const dur = 480;
    const groups = [];
    for (let f = 0; f < 8; f++) groups.push({ d: f * 45, files: [f], ranks: [1, 6], pitch: 1.12, gain: 0.45 });
    [[0, 7], [1, 6], [2, 5], [3], [4]].forEach((files, j) =>
      groups.push({ d: 470 + j * 130, files, ranks: [0, 7], pitch: j === 4 ? 0.9 : 1, gain: j >= 3 ? 0.85 : 0.65 }));
    let end = 0;
    for (const g of groups) {
      for (const f of g.files) for (const r of g.ranks) dropIn(makePiece(state.board[r * 8 + f], r * 8 + f), g.d, dur);
      Sound.knock(g.d + dur * 0.6, { gain: g.gain, pitch: g.pitch });
      end = Math.max(end, g.d + dur);
    }
    return end;
  }

  // 다시 시작: 기물이 위로 튀어 올라 사라진다
  function clearBoard() {
    let end = 0;
    [...piecesEl.children].forEach((el, i) => {
      if (!el.body) return;
      const d = i * 16;
      el.body.animate([
        { transform: pose(), opacity: 1 },
        { offset: 0.35, transform: pose(-14, 0, 0, 1.08), opacity: 1 },
        { transform: pose(-210, 0, (Math.random() - 0.5) * 60, 0.8), opacity: 0 },
      ], { duration: 380, delay: d, easing: 'ease-in', fill: 'forwards' });
      el.shadow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, delay: d, fill: 'forwards' });
      end = d + 380;
    });
    return end;
  }

  // ---------- 진행 ----------
  function judge() {
    if (!legal.length) {
      if (Chess.inCheck(state, state.turn)) return { title: '체크메이트', text: state.turn === me ? '패배' : '승리' };
      return { title: '스테일메이트', text: '무승부' };
    }
    if (Chess.insufficient(state.board)) return { title: '기물 부족', text: '무승부' };
    if (state.half >= 100) return { title: '50수 규칙', text: '무승부' };
    const k = keys[keys.length - 1];
    if (keys.filter((x) => x === k).length >= 3) return { title: '3회 동일 국면', text: '무승부' };
    return null;
  }

  function play(m) {
    state = Chess.apply(state, m);
    keys.push(Chess.key(state));
    played.push({ from: m.from, to: m.to, promo: m.promo });
  }

  function beginTurn() {
    legal = Chess.legalMoves(state);
    over = judge();
    hint = null;
    renderMarks();
    if (over) {
      busy = true;
      showVeil(over.title, `${over.text} · 눌러서 다시 시작`);
    } else if (state.turn === me) {
      hint = Chess.analyze(state, DEPTH);
      busy = false;
      renderMarks();
    } else {
      busy = true;
      later(computerMove, 220);
    }
  }

  function doMove(m) {
    busy = true;
    selected = null;
    hint = null;
    marksEl.innerHTML = '';
    const prev = state;
    play(m);
    later(beginTurn, animateMove(prev, m) + 60);
  }

  function computerMove() {
    const { best, byFrom } = Chess.analyze(state, DEPTH);
    const close = [...byFrom.values()].filter((x) => x.score >= best.score - 8);
    doMove(close[Math.floor(Math.random() * close.length)].move);
  }

  function reset(color, replay) {
    me = color || (Math.random() < 0.5 ? 'w' : 'b');
    flipped = me === 'b';
    state = Chess.initial();
    keys = [Chess.key(state)];
    played = [];
    selected = null;
    promoMoves = null;
    hint = null;
    for (const r of replay || []) {
      const m = Chess.legalMoves(state).find((x) => x.from === r.from && x.to === r.to && x.promo === r.promo);
      if (!m) break;
      play(m);
    }
    buildSquares();
    renderPromo();
    marksEl.innerHTML = '';
  }

  function newGame() {
    token++;
    busy = true;
    veilEl.hidden = true;
    marksEl.innerHTML = '';
    const wait = clearBoard();
    later(() => {
      piecesEl.innerHTML = '';
      els.clear();
      reset();
      later(beginTurn, setupBoard() + 80);
    }, wait + 120);
  }

  // ---------- 입력 ----------
  boardEl.addEventListener('click', (e) => {
    Sound.init();
    if (!veilEl.hidden) { newGame(); return; }
    if (busy) return;
    const rect = boardEl.getBoundingClientRect();
    const vc = Math.floor(((e.clientX - rect.left) / rect.width) * 8);
    const vr = Math.floor(((e.clientY - rect.top) / rect.height) * 8);
    if (vr < 0 || vr > 7 || vc < 0 || vc > 7) return;

    if (promoMoves) {
      const pc = screenPos(promoMoves[0].to)[1];
      const m = vc === pc && vr < 4 ? promoMoves.find((x) => x.promo === 'qnrb'[vr]) : null;
      promoMoves = null;
      renderPromo();
      if (m) doMove(m);
      else { selected = null; renderMarks(); }
      return;
    }
    if (state.turn !== me) return;

    const s = flipped ? (7 - vr) * 8 + (7 - vc) : vr * 8 + vc;
    if (selected !== null) {
      const moves = legal.filter((m) => m.from === selected && m.to === s);
      if (moves.length) {
        if (moves[0].promo) { promoMoves = moves; renderPromo(); }
        else doMove(moves[0]);
        return;
      }
    }
    const p = state.board[s];
    selected = p && p.color === me && selected !== s ? s : null;
    renderMarks();
  });

  // ---------- 시작 ----------
  function boot(data) {
    buildSquares();
    if (data && data.color && data.moves && data.moves.length) {
      reset(data.color, data.moves);
      state.board.forEach((p, s) => { if (p) makePiece(p, s); });
      veilEl.hidden = true;
      beginTurn();
    }
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => ({ color: me, moves: played }));
  if (hot && hot.ready) hot.ready(boot);
  else boot(hot && hot.data);
})();
