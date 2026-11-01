(() => {
  const ANIM = 240;  // 기물 이동 시간(ms) — style.css 의 transition 과 같게
  const DEPTH = 3;   // 추천·컴퓨터 탐색 깊이
  const $ = (id) => document.getElementById(id);

  const boardEl = $('board'), squaresEl = $('squares'), marksEl = $('marks'), piecesEl = $('pieces');
  const promoEl = $('promo'), endEl = $('end');
  const els = new Map(); // 기물 id -> DOM

  let state, legal, keys, played, selected, over, hint, promoMoves, me, flipped, token = 0;

  // ---------- 소리 (나무 기물이 판에 닿는 소리) ----------
  let actx = null;
  function unlockAudio() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { actx = null; }
  }
  function knock(capture) {
    if (!actx || actx.state !== 'running') return;
    const t = actx.currentTime + (ANIM / 1000) * 0.9;
    const len = Math.floor(actx.sampleRate * 0.07);
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 5);
    const noise = actx.createBufferSource();
    noise.buffer = buf;
    const band = actx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = capture ? 1300 : 1800;
    band.Q.value = 1.4;
    const ng = actx.createGain();
    ng.gain.value = capture ? 0.8 : 0.55;
    noise.connect(band).connect(ng).connect(actx.destination);
    noise.start(t);

    const osc = actx.createOscillator();
    osc.frequency.setValueAtTime(capture ? 200 : 260, t);
    osc.frequency.exponentialRampToValueAtTime(capture ? 110 : 150, t + 0.09);
    const og = actx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(capture ? 0.5 : 0.32, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    osc.connect(og).connect(actx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  }
  document.addEventListener('pointerdown', unlockAudio);

  // ---------- 좌표 ----------
  function screenPos(s) {
    let r = s >> 3, c = s & 7;
    if (flipped) { r = 7 - r; c = 7 - c; }
    return [r, c];
  }
  const translate = (s) => { const [r, c] = screenPos(s); return `translate(${c * 100}%, ${r * 100}%)`; };
  function pointToScreen(e) {
    const rect = boardEl.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * 8);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * 8);
    return r < 0 || r > 7 || c < 0 || c > 7 ? null : [r, c];
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

  function renderPieces() {
    const alive = new Set();
    state.board.forEach((p, s) => {
      if (!p) return;
      alive.add(p.id);
      let el = els.get(p.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'piece';
        el.style.transform = translate(s);
        piecesEl.appendChild(el);
        els.set(p.id, el);
      }
      const kind = p.color + p.type;
      if (el.dataset.kind !== kind) {
        el.innerHTML = pieceSVG(p.type, p.color);
        el.dataset.kind = kind;
      }
      el.style.transform = translate(s);
    });
    // 잡힌 기물은 공격한 기물이 도착한 뒤에 치운다
    for (const [id, el] of els) {
      if (alive.has(id) || el.classList.contains('taken')) continue;
      el.classList.add('taken');
      setTimeout(() => { el.remove(); els.delete(id); }, ANIM);
    }
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
    const [, c] = screenPos(promoMoves[0].to);
    promoEl.innerHTML = 'qnrb'.split('').map((t, r) =>
      `<div class="promo-opt" style="transform:translate(${c * 100}%, ${r * 100}%)">${pieceSVG(t, me)}</div>`).join('');
    promoEl.hidden = false;
  }

  // ---------- 진행 ----------
  function judge() {
    if (!legal.length) {
      if (Chess.inCheck(state, state.turn)) {
        return { title: '체크메이트', text: state.turn === me ? '패배' : '승리' };
      }
      return { title: '스테일메이트', text: '무승부' };
    }
    if (Chess.insufficient(state.board)) return { title: '기물 부족', text: '무승부' };
    if (state.half >= 100) return { title: '50수 규칙', text: '무승부' };
    const k = keys[keys.length - 1];
    if (keys.filter((x) => x === k).length >= 3) return { title: '3회 동일 국면', text: '무승부' };
    return null;
  }

  function later(fn, ms) {
    const t = token;
    setTimeout(() => { if (t === token) fn(); }, ms);
  }

  function update() {
    legal = Chess.legalMoves(state);
    over = judge();
    hint = null;
    renderPieces();
    renderMarks();
    if (over) {
      later(() => {
        $('endTitle').textContent = over.title;
        $('endText').textContent = over.text;
        endEl.hidden = false;
      }, ANIM + 200);
    } else if (state.turn === me) {
      later(() => { hint = Chess.analyze(state, DEPTH); renderMarks(); }, ANIM + 40);
    } else {
      later(computerMove, ANIM + 160);
    }
  }

  function play(m, silent) {
    state = Chess.apply(state, m);
    keys.push(Chess.key(state));
    played.push({ from: m.from, to: m.to, promo: m.promo });
    if (!silent) knock(m.capture !== undefined);
  }

  function doMove(m) {
    selected = null;
    play(m);
    update();
  }

  function computerMove() {
    const { best, byFrom } = Chess.analyze(state, DEPTH);
    const close = [...byFrom.values()].filter((x) => x.score >= best.score - 8);
    doMove(close[Math.floor(Math.random() * close.length)].move);
  }

  function newGame(color, replay) {
    token++;
    for (const el of els.values()) el.remove();
    els.clear();
    me = color || (Math.random() < 0.5 ? 'w' : 'b');
    flipped = me === 'b';
    state = Chess.initial();
    keys = [Chess.key(state)];
    played = [];
    selected = null;
    promoMoves = null;
    endEl.hidden = true;
    for (const r of replay || []) {
      const m = Chess.legalMoves(state).find((x) => x.from === r.from && x.to === r.to && x.promo === r.promo);
      if (!m) break;
      play(m, true);
    }
    buildSquares();
    renderPromo();
    update();
  }

  // ---------- 입력 ----------
  boardEl.addEventListener('click', (e) => {
    if (!endEl.hidden) { newGame(); return; }
    const pos = pointToScreen(e);
    if (!pos) return;

    if (promoMoves) {
      const [r, c] = pos;
      const [, pc] = screenPos(promoMoves[0].to);
      const m = c === pc && r < 4 ? promoMoves.find((x) => x.promo === 'qnrb'[r]) : null;
      promoMoves = null;
      renderPromo();
      if (m) doMove(m);
      else { selected = null; renderMarks(); }
      return;
    }
    if (over || state.turn !== me) return;

    let [r, c] = pos;
    if (flipped) { r = 7 - r; c = 7 - c; }
    const s = r * 8 + c;
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
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => ({ color: me, moves: played }));
  const start = (data) => newGame(data && data.color, data && data.moves);
  if (hot && hot.ready) hot.ready(start);
  else start(hot && hot.data);
})();
