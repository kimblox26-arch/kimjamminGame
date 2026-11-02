(() => {
  const $ = (id) => document.getElementById(id);

  const menuEl = $('menu'), gameEl = $('game');
  const boardEl = $('board'), squaresEl = $('squares'), marksEl = $('marks'), piecesEl = $('pieces');
  const promoEl = $('promo'), veilEl = $('veil'), timerEl = $('timer');
  const els = new Map(); // 기물 id -> DOM

  // mode: 'ai' = 컴퓨터와 대전, 'duo' = 한 화면에서 두 명이서
  let state, legal = [], keys = [], played = [], selected = null, over = null, hint = null, promoMoves = null;
  let me = 'w', flipped = false, busy = true, token = 0, turnSeq = 0, mode = 'ai', auto = false;

  // 난이도: Stockfish 실력(0~20)과 생각 시간
  const LEVELS = [
    { key: 'easy', skill: 0, ms: 150, depth: 1 },
    { key: 'normal', skill: 6, ms: 400, depth: 2 },
    { key: 'hard', skill: 13, ms: 900, depth: 3 },
    { key: 'max', skill: 20, ms: 1500, depth: 4 },
  ];

  // ---------- 설정 / 언어 ----------
  const TEXT = {
    ko: {
      title: '체스', subtitle: '컴퓨터와 한 판', play: '플레이', duo: '두 명이서', settings: '설정', language: '언어',
      sound: '소리', hints: '추천 표시', close: '닫기', toMenu: '눌러서 메인으로', menu: '메인',
      think: '생각 모드', speed: '스피드 모드', difficulty: '난이도', easy: '쉬움', normal: '보통', hard: '어려움', max: '최강', start: '시작',
      password: '비밀번호', confirm: '확인', wrongPw: '비밀번호가 틀렸어요', twoP: '2인',
      checkmate: '체크메이트', stalemate: '스테일메이트', insufficient: '기물 부족', fifty: '50수 규칙',
      repetition: '3회 동일 국면', win: '승리', lose: '패배', draw: '무승부', whiteWins: '백 승리', blackWins: '흑 승리',
    },
    en: {
      title: 'Chess', subtitle: 'A game against the computer', play: 'Play', duo: 'Two players', settings: 'Settings',
      language: 'Language', sound: 'Sound', hints: 'Move hints', close: 'Close', toMenu: 'Tap to return to the menu',
      menu: 'Menu', think: 'Think mode', speed: 'Speed mode', difficulty: 'Difficulty', easy: 'Easy', normal: 'Normal', hard: 'Hard', max: 'Max', start: 'Start',
      password: 'Password', confirm: 'OK', wrongPw: 'Wrong password', twoP: '2P',
      checkmate: 'Checkmate', stalemate: 'Stalemate', insufficient: 'Insufficient material', fifty: '50-move rule',
      repetition: 'Threefold repetition', win: 'You win', lose: 'You lose', draw: 'Draw',
      whiteWins: 'White wins', blackWins: 'Black wins',
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
  const prefs = {
    sound: store.get('sound', true), hints: store.get('hints', true), lang: store.get('lang', 'ko'),
    level: Math.min(3, Math.max(0, Number(store.get('level', 1)) || 0)),
    pace: store.get('pace', 'think') === 'speed' ? 'speed' : 'think',
  };
  if (!TEXT[prefs.lang]) prefs.lang = 'ko';
  const tr = (k) => TEXT[prefs.lang][k];

  function applyLang() {
    document.documentElement.lang = prefs.lang;
    document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = tr(el.dataset.t); });
    document.querySelectorAll('.lang').forEach((b) => b.classList.toggle('on', b.dataset.lang === prefs.lang));
    $('btnHome').setAttribute('aria-label', tr('menu'));
    setModeTag();
    if (over && !veilEl.hidden) showVeil();
  }
  const setModeTag = () => { $('modeTag').textContent = mode === 'duo' ? tr('twoP') : tr(LEVELS[prefs.level].key); };

  // ---------- 화면·창 애니메이션 ----------
  const EASE_POP = 'cubic-bezier(.2,1.25,.4,1)';
  function swap(from, to, done) {
    const out = from.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.97)' }],
      { duration: 180, easing: 'ease-in' });
    out.onfinish = () => {
      from.hidden = true;
      to.hidden = false;
      to.animate([{ opacity: 0, transform: 'scale(1.03)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
      if (done) done();
    };
  }
  function openSheet(sh) {
    sh.hidden = false;
    sh.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
    sh.firstElementChild.animate([
      { opacity: 0, transform: 'translateY(18px) scale(.92)' },
      { opacity: 1, transform: 'none' },
    ], { duration: 300, easing: EASE_POP });
  }
  function closeSheet(sh, done) {
    if (sh.hidden) { if (done) done(); return; }
    sh.firstElementChild.animate([{ transform: 'none' }, { transform: 'scale(.94)' }], { duration: 160 });
    const a = sh.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' });
    a.onfinish = () => { sh.hidden = true; a.cancel(); if (done) done(); };
  }
  const pop = (el) => el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
    { duration: 260, easing: EASE_POP });

  // ---------- 타이머 (왼쪽 위, 분:초:1/100초) ----------
  let tStart = 0, tAcc = 0, tRun = false, raf = 0, tLast = '';
  const fmt = (ms) => {
    const cs = Math.floor(ms / 10);
    return [Math.floor(cs / 6000), Math.floor(cs / 100) % 60, cs % 100].map((v) => String(v).padStart(2, '0')).join(':');
  };
  function tick() {
    const txt = fmt(tAcc + (tRun ? performance.now() - tStart : 0));
    if (txt !== tLast) { timerEl.textContent = txt; tLast = txt; }
    if (tRun) raf = requestAnimationFrame(tick);
  }
  function timerReset() { cancelAnimationFrame(raf); tRun = false; tAcc = 0; tick(); }
  function timerGo() { if (!tRun) { tRun = true; tStart = performance.now(); raf = requestAnimationFrame(tick); } }
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
  const pose = (y = 0, rz = 0, sx = 1, sy = sx) => `translateY(${y}%) rotate(${rz}deg) scale(${sx}, ${sy})`;
  const spd = () => (prefs.pace === 'speed' ? 0.4 : 1); // 스피드 모드에서는 빠르게

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

  // 승급 선택: 승급하는 칸에서 판 안쪽으로 4칸
  const promoRows = (to) => (screenPos(to)[0] === 0 ? [0, 1, 2, 3] : [7, 6, 5, 4]);
  function renderPromo() {
    if (!promoMoves) { promoEl.hidden = true; return; }
    const c = screenPos(promoMoves[0].to)[1], rows = promoRows(promoMoves[0].to);
    promoEl.innerHTML = 'qnrb'.split('').map((t, i) =>
      `<div class="promo-opt" style="transform:${at(rows[i], c)}">${pieceSVG(t, state.turn)}</div>`).join('');
    promoEl.hidden = false;
  }

  function showVeil() {
    $('veilTitle').textContent = tr(over.title);
    $('veilText').textContent = tr(over.text);
    if (veilEl.hidden) {
      veilEl.hidden = false;
      veilEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220 });
      veilEl.firstElementChild.animate([{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'none' }],
        { duration: 320, easing: EASE_POP });
    }
  }

  // ---------- 기물 애니메이션 ----------
  // 이동: 살짝 들어 올려 진행 방향으로 기울며 옮기고, 멈출 때 관성으로 살짝 뒤로 기울었다가 내려놓는다
  function travel(el, from, to, delay = 0) {
    const [r0, c0] = screenPos(from), [r1, c1] = screenPos(to);
    const dist = Math.hypot(r1 - r0, c1 - c0);
    const dur = Math.round(Math.min(520, 260 + dist * 38) * spd());
    const tail = Math.round(140 * spd());
    const dir = Math.sign(c1 - c0) || (c0 < 4 ? -1 : 1);
    const lean = dir * 6;
    const a = dur / (dur + tail);

    el.style.zIndex = 5;
    el.style.transform = at(r1, c1);
    el.animate([{ transform: at(r0, c0) }, { transform: at(r1, c1) }],
      { duration: dur, delay, easing: 'cubic-bezier(.33,0,.2,1)', fill: 'backwards' });
    el.body.animate([
      { offset: 0, transform: pose(), easing: 'ease-out' },
      { offset: a * 0.25, transform: pose(-5, lean * 0.6, 1.05), easing: 'ease-in-out' },
      { offset: a * 0.6, transform: pose(-6, lean * 0.3, 1.06), easing: 'ease-in-out' },
      { offset: a * 0.92, transform: pose(-2, -lean * 0.4, 1.02), easing: 'ease-in' },
      { offset: a, transform: pose(0, 0, 1.02, 0.97), easing: 'ease-out' },
      { offset: a + (1 - a) * 0.55, transform: pose(0, 0, 0.995, 1.005), easing: 'ease-in-out' },
      { offset: 1, transform: pose() },
    ], { duration: dur + tail, delay, fill: 'backwards' });
    later(() => { el.style.zIndex = ''; }, delay + dur + tail);

    Sound.knock(delay + dur); // 둑
    return { land: delay + dur, end: delay + dur + tail, dir };
  }

  // 잡힘: 제자리 가운데에서 흐려지며 살짝 돌아가며 사라진다
  function vanish(vic, dir, T) {
    const d = Math.round(480 * spd());
    vic.style.zIndex = 0;
    vic.body.animate([
      { transform: pose(), opacity: 1, filter: 'blur(0px)' },
      { offset: 0.35, transform: pose(0, dir * 6, 0.97), opacity: 0.75, filter: 'blur(1px)' },
      { transform: pose(0, dir * 20, 0.8), opacity: 0, filter: 'blur(4px)' },
    ], { duration: d, delay: T, easing: 'ease-out', fill: 'forwards' });
    later(() => vic.remove(), T + d + 20);
    return T + d;
  }

  function promote(el, type, color) {
    el.body.firstElementChild.outerHTML = pieceSVG(type, color);
    el.body.animate([{ transform: pose(0, 0, 0.75) }, { offset: 0.6, transform: pose(-4, 0, 1.1) }, { transform: pose() }],
      { duration: 300, easing: 'ease-out' });
  }

  function animateMove(prev, m) {
    const mover = prev.board[m.from];
    const el = els.get(mover.id);
    const t = travel(el, m.from, m.to);
    let end = t.end;
    if (m.castle) end = Math.max(end, travel(els.get(prev.board[m.rookFrom].id), m.rookFrom, m.rookTo, 160 * spd()).end);
    if (m.capture !== undefined) {
      const victim = prev.board[m.capture];
      const vel = els.get(victim.id);
      els.delete(victim.id);
      end = Math.max(end, vanish(vel, t.dir, Math.max(0, t.land - 180 * spd())));
    }
    if (m.promo) {
      later(() => promote(el, m.promo, mover.color), t.land + 40);
      end = Math.max(end, t.land + 360);
    }
    return end;
  }

  // 시작: 아래쪽 기물은 아래에서 위로, 위쪽 기물은 위에서 아래로 부드럽게 자리 잡는다
  function setupBoard() {
    const dur = 620;
    let end = 0;
    state.board.forEach((p, s) => {
      if (!p) return;
      const el = makePiece(p, s);
      const [r, c] = screenPos(s);
      const d = c * 55 + (r === 0 || r === 7 ? 110 : 0);
      el.animate([
        { transform: at(r + (r >= 4 ? 2.6 : -2.6), c), opacity: 0 },
        { offset: 0.35, opacity: 1 },
        { transform: at(r, c), opacity: 1 },
      ], { duration: dur, delay: d, easing: 'cubic-bezier(.2,.85,.25,1)', fill: 'backwards' });
      end = Math.max(end, d + dur);
    });
    for (let c = 0; c < 8; c++) Sound.knock(c * 55 + 110 + dur * 0.8, { gain: 0.32 });
    return end;
  }

  // ---------- 엔진 ----------
  const sqName = (s) => 'abcdefgh'[s & 7] + (8 - (s >> 3));
  const sqIndex = (n) => (8 - Number(n[1])) * 8 + 'abcdefgh'.indexOf(n[0]);
  // Stockfish: 백그라운드 워커에서 계산 (화면이 멈추지 않음)
  function makeEngine(url) {
    let w = null, waiting = null, skip = 0, failed = false;
    function fail() {
      failed = true;
      if (w) w.terminate();
      w = null;
      const cb = waiting;
      waiting = null;
      if (cb) cb(null);
    }
    function start() {
      if (w || failed) return;
      try {
        w = new Worker(url);
      } catch (e) {
        failed = true;
        return;
      }
      w.onmessage = (e) => {
        const line = String(e.data);
        if (!line.startsWith('bestmove')) return;
        if (skip > 0) { skip--; return; }
        const cb = waiting;
        waiting = null;
        if (cb) cb(line.split(' ')[1]);
      };
      w.onerror = fail;
      w.postMessage('uci');
      w.postMessage('isready');
    }
    function best(moves, skill, ms, cb) {
      if (!w) { cb(null); return; }
      if (waiting) { skip++; w.postMessage('stop'); }
      waiting = cb;
      w.postMessage('setoption name Skill Level value ' + skill);
      w.postMessage('position startpos' + (moves.length ? ' moves ' + moves.join(' ') : ''));
      w.postMessage('go movetime ' + ms);
      // 응답이 없으면(불러오기 실패 등) 이 엔진은 더 쓰지 않는다
      setTimeout(() => { if (waiting === cb) fail(); }, ms + 12000);
    }
    return { start, best, ok: () => !!w, newGame: () => { if (w) w.postMessage('ucinewgame'); } };
  }
  const Strong = makeEngine('vendor/stockfish.asm.js');               // Stockfish 10: 난이도별 상대·추천
  const Genius = makeEngine('vendor/stockfish-17.1-lite-single.js');  // Stockfish 17.1 NNUE: AI 오토 모드
  const uciMoves = () => played.map((m) => sqName(m.from) + sqName(m.to) + (m.promo || ''));
  const fromUci = (u) => u && u.length >= 4 && legal.find((x) =>
    x.from === sqIndex(u.slice(0, 2)) && x.to === sqIndex(u.slice(2, 4)) && (x.promo || '') === (u[4] || ''));

  // 엔진에게 수를 받아 두기: 앞의 엔진이 안 되면 다음 엔진, 마지막은 내장 엔진
  function engineMove(id, engines, skill, ms, depth, random) {
    const [eng, ...rest] = engines;
    if (eng && eng.ok()) {
      eng.best(uciMoves(), skill, ms, (u) => {
        if (id !== turnSeq) return;
        const m = fromUci(u);
        if (m) doMove(m);
        else engineMove(id, rest, skill, ms, depth, random);
      });
      return;
    }
    if (eng) { engineMove(id, rest, skill, ms, depth, random); return; }
    Brain.analyze(state, depth, ({ best, byFrom }) => {
      if (id !== turnSeq) return;
      const pool = random ? [...byFrom.values()].filter((x) => x.score >= best.score - random) : [best];
      doMove(pool[Math.floor(Math.random() * pool.length)].move);
    });
  }

  function requestHints(id) {
    Brain.analyze(state, 3, (res) => {
      if (id !== turnSeq || !prefs.hints) return;
      hint = res;
      renderMarks();
      if (!Strong.ok()) return;
      Strong.best(uciMoves(), 20, 600, (u) => {
        const m = id === turnSeq && hint && fromUci(u);
        if (!m) return;
        hint.best = { move: m, score: hint.best.score };
        hint.byFrom.set(m.from, { move: m, score: hint.best.score });
        renderMarks();
      });
    });
  }

  // ---------- 진행 ----------
  function judge() {
    if (!legal.length) {
      if (Chess.inCheck(state, state.turn)) {
        const winner = state.turn === 'w' ? 'b' : 'w';
        const text = mode === 'duo' ? (winner === 'w' ? 'whiteWins' : 'blackWins') : winner === me ? 'win' : 'lose';
        return { title: 'checkmate', text };
      }
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

  // 사람이 두는 쪽인가 (오토 모드가 켜지면 내 쪽은 AI 가 대신 둔다)
  const humanSide = (color) => (mode === 'duo' || color === me) && !(auto && color === me);

  function beginTurn() {
    const id = ++turnSeq;
    legal = Chess.legalMoves(state);
    over = judge();
    hint = null;
    selected = null;
    renderMarks();
    if (over) {
      busy = true;
      timerStop();
      showVeil();
    } else if (!humanSide(state.turn)) {
      busy = true;
      // 오토 모드: 가장 강한 Stockfish 17.1 이 최고 실력으로 충분히 생각해서 둔다
      // 생각 모드: 한 수에 2.5초 깊게 / 스피드 모드: 0.2초 만에
      if (auto && state.turn === me) engineMove(id, [Genius, Strong], 20, prefs.pace === 'speed' ? 200 : 2500, 4, 0);
      else {
        const L = LEVELS[prefs.level];
        engineMove(id, [Strong], L.skill, prefs.pace === 'speed' ? Math.min(L.ms, 150) : L.ms, L.depth, L.skill < 10 ? 40 : 0);
      }
    } else {
      busy = false;
      if (prefs.hints) requestHints(id);
    }
  }

  function doMove(m) {
    busy = true;
    selected = null;
    hint = null;
    turnSeq++;
    marksEl.innerHTML = '';
    const prev = state;
    play(m);
    later(beginTurn, animateMove(prev, m) + 60 * spd());
  }

  function reset(color, replay) {
    me = color;
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

  function startGame(m) {
    mode = m;
    setModeTag();
    Strong.start();
    Strong.newGame();
    Sound.init();
    token++;
    turnSeq++;
    busy = true;
    reset(mode === 'duo' ? 'w' : Math.random() < 0.5 ? 'w' : 'b');
    timerReset();
    swap(menuEl, gameEl, () => {
      later(() => { timerGo(); beginTurn(); }, setupBoard() + 60);
    });
  }

  function showMenu() {
    token++;
    turnSeq++;
    busy = true;
    timerStop();
    swap(gameEl, menuEl);
  }

  // ---------- 입력: 게임 ----------
  boardEl.addEventListener('click', (e) => {
    if (!veilEl.hidden) { showMenu(); return; }
    if (busy || over) return;
    const rect = boardEl.getBoundingClientRect();
    const vc = Math.floor(((e.clientX - rect.left) / rect.width) * 8);
    const vr = Math.floor(((e.clientY - rect.top) / rect.height) * 8);
    if (vr < 0 || vr > 7 || vc < 0 || vc > 7) return;

    if (promoMoves) {
      const pc = screenPos(promoMoves[0].to)[1], i = promoRows(promoMoves[0].to).indexOf(vr);
      const m = vc === pc && i >= 0 ? promoMoves.find((x) => x.promo === 'qnrb'[i]) : null;
      promoMoves = null;
      renderPromo();
      if (m) doMove(m);
      else { selected = null; renderMarks(); }
      return;
    }
    if (!humanSide(state.turn)) return;

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
    selected = p && p.color === state.turn && selected !== s ? s : null;
    renderMarks();
  });
  $('btnHome').addEventListener('click', showMenu);

  // ---------- 입력: 메인 화면 / 창 ----------
  document.addEventListener('pointerdown', Sound.init);
  const sheets = [...document.querySelectorAll('.sheet')];
  const sheetLevel = $('sheetLevel'), sheetSettings = $('sheetSettings'), sheetLang = $('sheetLang'), sheetPw = $('sheetPw');
  let taps = 0;

  function markLevel() {
    document.querySelectorAll('[data-level]').forEach((b) => b.classList.toggle('on', Number(b.dataset.level) === prefs.level));
  }
  $('btnPlay').addEventListener('click', () => openSheet(sheetLevel));
  $('btnDuo').addEventListener('click', () => openSheet($('sheetDuo')));
  $('btnDuoStart').addEventListener('click', () => closeSheet($('sheetDuo'), () => startGame('duo')));
  // 생각 모드 / 스피드 모드 (난이도 창과 오토 창이 같은 설정을 쓴다)
  function markPace() {
    document.querySelectorAll('[data-pace]').forEach((b) => b.classList.toggle('on', b.dataset.pace === prefs.pace));
  }
  document.querySelectorAll('[data-pace]').forEach((b) => b.addEventListener('click', () => {
    prefs.pace = b.dataset.pace;
    store.set('pace', prefs.pace);
    markPace();
    pop(b);
  }));
  markPace();
  $('btnStart').addEventListener('click', () => closeSheet(sheetLevel, () => startGame('ai')));
  document.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => {
    prefs.level = Number(b.dataset.level);
    store.set('level', prefs.level);
    markLevel();
    pop(b);
  }));
  $('btnSettings').addEventListener('click', () => { taps = 0; openSheet(sheetSettings); });
  $('btnLang').addEventListener('click', () => openSheet(sheetLang));
  sheets.forEach((sh) => {
    sh.addEventListener('click', (e) => {
      if (e.target === sh || e.target.closest('[data-close]')) closeSheet(sh);
    });
  });
  document.querySelectorAll('.lang').forEach((b) => b.addEventListener('click', () => {
    prefs.lang = b.dataset.lang;
    store.set('lang', prefs.lang);
    applyLang();
    pop(b);
  }));
  const optSound = $('optSound'), optHints = $('optHints');
  optSound.checked = prefs.sound;
  optHints.checked = prefs.hints;
  Sound.setOn(prefs.sound);
  optSound.addEventListener('change', () => { prefs.sound = optSound.checked; store.set('sound', prefs.sound); Sound.setOn(prefs.sound); });
  optHints.addEventListener('change', () => { prefs.hints = optHints.checked; store.set('hints', prefs.hints); });

  // 설정 창 위 체스말을 10번 누르면 비밀번호 창
  const mascot = $('mascot');
  mascot.addEventListener('click', () => {
    mascot.animate([{ transform: 'translateY(0) scale(1)' }, { transform: 'translateY(-8px) scale(1.08)' }, { transform: 'translateY(0) scale(1)' }],
      { duration: 240, easing: EASE_POP });
    if (++taps >= 10) {
      taps = 0;
      $('pwInput').value = '';
      $('pwErr').hidden = true;
      openSheet(sheetPw);
      setTimeout(() => $('pwInput').focus(), 50);
    }
  });
  $('pwForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('pwInput').value === 'chess0101') {
      $('pwInput').blur();
      sheets.forEach((sh) => closeSheet(sh));
      Genius.start(); // 큰 엔진을 미리 불러 둔다
      setTimeout(openAutoWin, 200);
    } else {
      $('pwErr').hidden = false;
      $('pwForm').animate([0, -10, 10, -8, 8, -4, 0].map((x) => ({ transform: `translateX(${x}px)` })), { duration: 380 });
    }
  });

  // ---------- AI 오토 모드 창 ----------
  const win = $('autoWin'), bubble = $('autoBubble'), toggle = $('autoToggle');
  bubble.innerHTML = pieceSVG('n', 'w');
  function place(el, x, y) {
    el.style.left = Math.max(6, Math.min(window.innerWidth - el.offsetWidth - 6, x)) + 'px';
    el.style.top = Math.max(6, Math.min(window.innerHeight - el.offsetHeight - 6, y)) + 'px';
  }
  // 끌어서 옮기기 (거의 안 움직이고 떼면 누른 것으로 본다)
  function draggable(handle, target, onTap) {
    let sx = 0, sy = 0, ox = 0, oy = 0, moved = false, down = false;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.float-min')) return;
      down = true;
      moved = false;
      sx = e.clientX;
      sy = e.clientY;
      ox = target.offsetLeft;
      oy = target.offsetTop;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < 6) return;
      moved = true;
      place(target, ox + dx, oy + dy);
    });
    handle.addEventListener('pointerup', () => {
      if (down && !moved && onTap) onTap();
      down = false;
    });
    handle.addEventListener('pointercancel', () => { down = false; });
  }
  function openAutoWin() {
    bubble.hidden = true;
    win.hidden = false;
    if (!win.style.left) place(win, (window.innerWidth - win.offsetWidth) / 2, window.innerHeight * 0.18);
    win.animate([{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 340, easing: EASE_POP });
  }
  function minimize() {
    const a = win.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.25)' }],
      { duration: 220, easing: 'ease-in', fill: 'forwards' });
    a.onfinish = () => {
      win.hidden = true;
      a.cancel();
      bubble.hidden = false;
      place(bubble, win.offsetLeft, win.offsetTop);
      bubble.animate([{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: 320, easing: EASE_POP });
    };
  }
  function expand() {
    const x = bubble.offsetLeft, y = bubble.offsetTop;
    const a = bubble.animate([{ transform: 'scale(1)' }, { transform: 'scale(0)' }], { duration: 150, easing: 'ease-in', fill: 'forwards' });
    a.onfinish = () => {
      a.cancel();
      bubble.hidden = true;
      win.hidden = false;
      place(win, x, y);
      win.animate([{ opacity: 0, transform: 'scale(.25)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 360, easing: EASE_POP });
    };
  }
  draggable($('autoHead'), win);
  draggable(bubble, bubble, expand);
  $('autoMin').addEventListener('click', minimize);
  toggle.addEventListener('click', () => {
    auto = !auto;
    if (auto) Genius.start();
    toggle.classList.toggle('on', auto);
    bubble.classList.toggle('on', auto);
    toggle.setAttribute('aria-pressed', String(auto));
    $('autoState').textContent = auto ? 'ON' : 'OFF';
    // 지금 내 차례라면 바로 넘겨받는다
    if (!gameEl.hidden && state && !over && !busy && state.turn === me && !promoMoves) beginTurn();
  });
  window.addEventListener('resize', () => {
    if (!win.hidden) place(win, win.offsetLeft, win.offsetTop);
    if (!bubble.hidden) place(bubble, bubble.offsetLeft, bubble.offsetTop);
  });

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
  mascot.innerHTML = pieceSVG('k', 'w');
  buildShowcase();
  markLevel();
  applyLang();
  timerReset();

})();
