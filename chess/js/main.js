(() => {
  const DEPTH = 3; // 추천·컴퓨터 탐색 깊이
  const $ = (id) => document.getElementById(id);

  const menuEl = $('menu'), gameEl = $('game');
  const boardEl = $('board'), squaresEl = $('squares'), marksEl = $('marks'), piecesEl = $('pieces');
  const promoEl = $('promo'), veilEl = $('veil'), timerEl = $('timer');
  const els = new Map(); // 기물 id -> DOM

  let state, legal = [], keys = [], played = [], selected = null, over = null, hint = null, promoMoves = null;
  let me = 'w', flipped = false, busy = true, token = 0;

  // ---------- 설정 / 언어 ----------
  const TEXT = {
    ko: {
      title: '체스', subtitle: '컴퓨터와 한 판', play: '플레이', settings: '설정', language: '언어',
      sound: '소리', hints: '추천 표시', close: '닫기', toMenu: '눌러서 메인으로', menu: '메인',
      checkmate: '체크메이트', stalemate: '스테일메이트', insufficient: '기물 부족', fifty: '50수 규칙',
      repetition: '3회 동일 국면', win: '승리', lose: '패배', draw: '무승부',
    },
    en: {
      title: 'Chess', subtitle: 'A game against the computer', play: 'Play', settings: 'Settings', language: 'Language',
      sound: 'Sound', hints: 'Move hints', close: 'Close', toMenu: 'Tap to return to the menu', menu: 'Menu',
      checkmate: 'Checkmate', stalemate: 'Stalemate', insufficient: 'Insufficient material', fifty: '50-move rule',
      repetition: 'Threefold repetition', win: 'You win', lose: 'You lose', draw: 'Draw',
    },
  };
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem('chess.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('chess.' + k, JSON.stringify(v)); } catch (e) { /* 저장 불가 */ }
    },
  };
  const prefs = { sound: store.get('sound', true), hints: store.get('hints', true), lang: store.get('lang', 'ko') };
  if (!TEXT[prefs.lang]) prefs.lang = 'ko';
  const tr = (k) => TEXT[prefs.lang][k];

  function applyLang() {
    document.documentElement.lang = prefs.lang;
    document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = tr(el.dataset.t); });
    document.querySelectorAll('.lang').forEach((b) => b.classList.toggle('on', b.dataset.lang === prefs.lang));
    $('btnHome').setAttribute('aria-label', tr('menu'));
    if (over && !veilEl.hidden) showVeil();
  }

  // ---------- 타이머 (왼쪽 위, 분:초:1/100초) ----------
  let tStart = 0, tAcc = 0, tRun = false, raf = 0;
  const fmt = (ms) => {
    const cs = Math.floor(ms / 10);
    return [Math.floor(cs / 6000), Math.floor(cs / 100) % 60, cs % 100].map((v) => String(v).padStart(2, '0')).join(':');
  };
  function tick() {
    timerEl.textContent = fmt(tAcc + (tRun ? performance.now() - tStart : 0));
    if (tRun) raf = requestAnimationFrame(tick);
  }
  function timerReset() { cancelAnimationFrame(raf); tRun = false; tAcc = 0; tick(); }
  function timerGo() { if (!tRun) { tRun = true; tStart = performance.now(); tick(); } }
  function timerStop() {
    if (!tRun) return;
    tAcc += performance.now() - tStart;
    tRun = false;
    cancelAnimationFrame(raf);
    tick();
  }

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

  // ---------- 그리기 ----------
  function buildSquares() {
    let html = '';
    for (let vr = 0; vr < 8; vr++) {
      for (let vc = 0; vc < 8; vc++) {
        const r = flipped ? 7 - vr : vr, c = flipped ? 7 - vc : vc;
        html += `<div class="sq ${(r + c) % 2 ? 'd' : 'l'}">`;
        if (vc === 0) html += `<span class="coord rank">${8 - r}</span>`;
        if (vr === 7) html += `<span class="coord file">${'abcdefgh'[c]}</span>`;
        html += '</div>';
      }
    }
    squaresEl.innerHTML = html;
  }

  function makePiece(p, s) {
    const el = document.createElement('div');
    el.className = 'piece';
    el.innerHTML = `<div class="body">${pieceSVG(p.type, p.color)}</div>`;
    el.style.transform = translate(s);
    el.body = el.firstElementChild;
    piecesEl.appendChild(el);
    els.set(p.id, el);
    return el;
  }

  function renderMarks() {
    let html = '';
    const add = (s, cls) => { html += `<div class="mark ${cls}" style="transform:${translate(s)}"></div>`; };
    if (Chess.inCheck(state, state.turn)) add(Chess.kingSq(state.board, state.turn), 'check');
    if (hint && selected !== hint.best.move.from) add(hint.best.move.from, 'rec');
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

  function showVeil() {
    $('veilTitle').textContent = tr(over.title);
    $('veilText').textContent = tr(over.text);
    veilEl.hidden = false;
  }

  // ---------- 애니메이션 ----------
  // 이동: 살짝 들어 올려 진행 방향으로 기울며 미끄러지듯 옮기고, 멈출 때 관성으로 살짝 뒤로 기울었다가 내려놓는다
  function travel(el, from, to, delay = 0) {
    const [r0, c0] = screenPos(from), [r1, c1] = screenPos(to);
    const dist = Math.hypot(r1 - r0, c1 - c0);
    const dur = Math.round(Math.min(520, 260 + dist * 38));
    const tail = 140;
    const dir = Math.sign(c1 - c0) || (c0 < 4 ? -1 : 1);
    const lean = dir * 6;
    const a = dur / (dur + tail);

    el.style.zIndex = 5;
    el.style.transform = at(r1, c1);
    el.animate([{ transform: at(r0, c0) }, { transform: at(r1, c1) }],
      { duration: dur, delay, easing: 'cubic-bezier(.33,0,.2,1)', fill: 'backwards' });
    el.body.animate([
      { offset: 0, transform: pose(), easing: 'ease-out' },
      { offset: a * 0.25, transform: pose(-5, 0, lean * 0.6, 1.05), easing: 'ease-in-out' },
      { offset: a * 0.6, transform: pose(-6, 0, lean * 0.3, 1.06), easing: 'ease-in-out' },
      { offset: a * 0.92, transform: pose(-2, 0, -lean * 0.4, 1.02), easing: 'ease-in' },
      { offset: a, transform: pose(0, 0, 0, 1.02, 0.97), easing: 'ease-out' },
      { offset: a + (1 - a) * 0.55, transform: pose(0, 0, 0, 0.995, 1.005), easing: 'ease-in-out' },
      { offset: 1, transform: pose() },
    ], { duration: dur + tail, delay, fill: 'backwards' });
    later(() => { el.style.zIndex = ''; }, delay + dur + tail);

    Sound.knock(delay + dur); // 둑
    return { land: delay + dur, end: delay + dur + tail, dir };
  }

  // 잡힘: 제자리 가운데에서 흐려지며 살짝 돌아가며 사라진다
  function vanish(vic, dir, T) {
    vic.style.zIndex = 0;
    vic.body.animate([
      { transform: pose(), opacity: 1, filter: 'blur(0px)' },
      { offset: 0.35, transform: pose(0, 0, dir * 6, 0.97), opacity: 0.75, filter: 'blur(1px)' },
      { transform: pose(0, 0, dir * 20, 0.8), opacity: 0, filter: 'blur(4px)' },
    ], { duration: 480, delay: T, easing: 'ease-out', fill: 'forwards' });
    later(() => vic.remove(), T + 500);
    return T + 480;
  }

  function promote(el, type, color) {
    el.body.firstElementChild.outerHTML = pieceSVG(type, color);
    el.body.animate([
      { transform: pose(0, 0, 0, 0.75) },
      { offset: 0.6, transform: pose(-4, 0, 0, 1.1) },
      { transform: pose() },
    ], { duration: 300, easing: 'ease-out' });
  }

  function animateMove(prev, m) {
    const mover = prev.board[m.from];
    const el = els.get(mover.id);
    const t = travel(el, m.from, m.to);
    let end = t.end;
    if (m.castle) end = Math.max(end, travel(els.get(prev.board[m.rookFrom].id), m.rookFrom, m.rookTo, 160).end);
    if (m.capture !== undefined) {
      const victim = prev.board[m.capture];
      const vel = els.get(victim.id);
      els.delete(victim.id);
      end = Math.max(end, vanish(vel, t.dir, Math.max(0, t.land - 180)));
    }
    if (m.promo) {
      later(() => promote(el, m.promo, mover.color), t.land + 40);
      end = Math.max(end, t.land + 360);
    }
    return end;
  }

  // 시작: 내 기물은 아래에서 위로, 상대 기물은 위에서 아래로 부드럽게 자리 잡는다
  function setupBoard() {
    const dur = 620;
    let end = 0;
    state.board.forEach((p, s) => {
      if (!p) return;
      const el = makePiece(p, s);
      const [r, c] = screenPos(s);
      const mine = p.color === me;
      const back = mine ? r === 7 : r === 0;
      const off = mine ? 2.6 : -2.6;
      const d = c * 55 + (back ? 110 : 0);
      el.animate([
        { transform: at(r + off, c), opacity: 0 },
        { offset: 0.35, opacity: 1 },
        { transform: at(r, c), opacity: 1 },
      ], { duration: dur, delay: d, easing: 'cubic-bezier(.2,.85,.25,1)', fill: 'backwards' });
      end = Math.max(end, d + dur);
    });
    for (let c = 0; c < 8; c++) Sound.knock(c * 55 + 110 + dur * 0.8, { gain: 0.32 });
    return end;
  }

  // ---------- 진행 ----------
  function judge() {
    if (!legal.length) {
      if (Chess.inCheck(state, state.turn)) return { title: 'checkmate', text: state.turn === me ? 'lose' : 'win' };
      return { title: 'stalemate', text: 'draw' };
    }
    if (Chess.insufficient(state.board)) return { title: 'insufficient', text: 'draw' };
    if (state.half >= 100) return { title: 'fifty', text: 'draw' };
    const k = keys[keys.length - 1];
    if (keys.filter((x) => x === k).length >= 3) return { title: 'repetition', text: 'draw' };
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
      timerStop();
      showVeil();
    } else if (state.turn === me) {
      if (prefs.hints) hint = Chess.analyze(state, DEPTH);
      busy = false;
      renderMarks();
    } else {
      busy = true;
      later(computerMove, 200);
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
    over = null;
    for (const r of replay || []) {
      const m = Chess.legalMoves(state).find((x) => x.from === r.from && x.to === r.to && x.promo === r.promo);
      if (!m) break;
      play(m);
    }
    piecesEl.innerHTML = '';
    els.clear();
    buildSquares();
    renderPromo();
    marksEl.innerHTML = '';
    veilEl.hidden = true;
  }

  function startGame() {
    Sound.init();
    token++;
    busy = true;
    menuEl.hidden = true;
    gameEl.hidden = false;
    reset();
    timerReset();
    later(() => { timerGo(); beginTurn(); }, setupBoard() + 60);
  }

  function showMenu() {
    token++;
    busy = true;
    timerStop();
    gameEl.hidden = true;
    menuEl.hidden = false;
  }

  // ---------- 입력: 게임 ----------
  boardEl.addEventListener('click', (e) => {
    if (!veilEl.hidden) { showMenu(); return; }
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
  $('btnHome').addEventListener('click', showMenu);

  // ---------- 입력: 메인 화면 ----------
  document.addEventListener('pointerdown', Sound.init);
  $('btnPlay').addEventListener('click', startGame);
  $('btnSettings').addEventListener('click', () => { $('sheetSettings').hidden = false; });
  $('btnLang').addEventListener('click', () => { $('sheetLang').hidden = false; });
  document.querySelectorAll('.sheet').forEach((sh) => {
    sh.addEventListener('click', (e) => {
      if (e.target === sh || e.target.closest('[data-close]')) sh.hidden = true;
    });
  });
  document.querySelectorAll('.lang').forEach((b) => b.addEventListener('click', () => {
    prefs.lang = b.dataset.lang;
    store.set('lang', prefs.lang);
    applyLang();
  }));
  const optSound = $('optSound'), optHints = $('optHints');
  optSound.checked = prefs.sound;
  optHints.checked = prefs.hints;
  Sound.setOn(prefs.sound);
  optSound.addEventListener('change', () => { prefs.sound = optSound.checked; store.set('sound', prefs.sound); Sound.setOn(prefs.sound); });
  optHints.addEventListener('change', () => { prefs.hints = optHints.checked; store.set('hints', prefs.hints); });

  // 메인 화면 뒤 흐린 체스판
  function buildShowcase() {
    const pcs = {
      '0,1': 'pb', '0,4': 'nb', '1,0': 'pb', '1,2': 'nb', '1,3': 'pb', '1,5': 'bb', '2,1': 'pb', '2,4': 'pb',
      '3,2': 'pw', '3,3': 'pw', '4,0': 'bw', '4,1': 'pw', '4,4': 'nw', '5,3': 'qw', '5,5': 'pw',
    };
    let html = '';
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        const k = pcs[r + ',' + c];
        html += `<div class="sq ${(r + c) % 2 ? 'd' : 'l'}">${k ? pieceSVG(k[0], k[1]) : ''}</div>`;
      }
    }
    $('showcase').innerHTML = html;
  }

  // ---------- 시작 ----------
  $('brandMark').innerHTML = pieceSVG('n', 'w');
  buildShowcase();
  applyLang();
  timerReset();

  function boot(data) {
    if (data && data.color && data.moves && data.moves.length) {
      menuEl.hidden = true;
      gameEl.hidden = false;
      reset(data.color, data.moves);
      state.board.forEach((p, s) => { if (p) makePiece(p, s); });
      timerGo();
      beginTurn();
    }
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => ({ color: me, moves: gameEl.hidden ? [] : played }));
  if (hot && hot.ready) hot.ready(boot);
  else boot(hot && hot.data);
})();
