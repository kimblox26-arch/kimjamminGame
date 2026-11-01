(() => {
  const ANIM = 220; // 기물 이동 애니메이션 시간(ms) — style.css 의 transition 과 같게 유지
  const $ = (id) => document.getElementById(id);

  const boardEl = $('board'), squaresEl = $('squares'), marksEl = $('marks'), piecesEl = $('pieces');
  const promoEl = $('promo'), promoList = $('promoList');
  const playersEl = $('players'), pWhite = $('pWhite'), pBlack = $('pBlack');
  const statusEl = $('status'), moveListEl = $('moveList'), btnUndo = $('btnUndo');
  const resultEl = $('result');

  const SIDE = { w: '백', b: '흑' };
  const NAMES = { q: '퀸', r: '룩', b: '비숍', n: '나이트' };
  const els = new Map(); // 기물 id -> DOM

  let state, legal, history, sans, keys, selected, over, promoMoves, resultTimer;
  let flipped = false;

  $('brandMark').innerHTML = pieceSVG('n', 'w');
  pWhite.querySelector('.pi').innerHTML = pieceSVG('k', 'w');
  pBlack.querySelector('.pi').innerHTML = pieceSVG('k', 'b');

  // ---------- 화면 좌표 ----------
  function screenPos(s) {
    let r = s >> 3, c = s & 7;
    if (flipped) { r = 7 - r; c = 7 - c; }
    return [r, c];
  }
  function translate(s) {
    const [r, c] = screenPos(s);
    return `translate(${c * 100}%, ${r * 100}%)`;
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
      if (el.rmTimer) { // 무르기로 다시 살아난 기물
        clearTimeout(el.rmTimer);
        el.rmTimer = null;
        el.classList.remove('taken');
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
      if (alive.has(id) || el.rmTimer) continue;
      el.classList.add('taken');
      el.rmTimer = setTimeout(() => { el.remove(); els.delete(id); }, ANIM);
    }
  }

  function renderMarks() {
    let html = '';
    const add = (s, cls) => { html += `<div class="mark ${cls}" style="transform:${translate(s)}"></div>`; };
    if (Chess.inCheck(state, state.turn)) add(Chess.kingSq(state.board, state.turn), 'check');
    if (selected !== null) {
      add(selected, 'sel');
      const done = new Set();
      for (const m of legal) {
        if (m.from !== selected || done.has(m.to)) continue;
        done.add(m.to);
        add(m.to, m.capture !== undefined ? 'take' : 'move');
      }
    }
    marksEl.innerHTML = html;
  }

  function renderPanel() {
    pWhite.classList.toggle('active', !over && state.turn === 'w');
    pBlack.classList.toggle('active', !over && state.turn === 'b');
    playersEl.classList.toggle('flipped', flipped);

    if (over) statusEl.textContent = `${over.title} · ${over.text}`;
    else statusEl.textContent = SIDE[state.turn] + (Chess.inCheck(state, state.turn) ? ' 체크' : ' 차례');

    let html = '';
    for (let i = 0; i < sans.length; i += 2) {
      html += `<li><span class="n">${i / 2 + 1}.</span><span>${sans[i]}</span><span>${sans[i + 1] || ''}</span></li>`;
    }
    moveListEl.innerHTML = html;
    moveListEl.scrollTop = moveListEl.scrollHeight;
    btnUndo.disabled = history.length === 0;
  }

  // ---------- 게임 진행 ----------
  function evaluate() {
    if (!legal.length) {
      if (Chess.inCheck(state, state.turn)) {
        const winner = state.turn === 'w' ? 'b' : 'w';
        return { title: '체크메이트', text: `${SIDE[winner]} 승리`, winner };
      }
      return { title: '스테일메이트', text: '무승부' };
    }
    if (Chess.insufficient(state.board)) return { title: '기물 부족', text: '무승부' };
    if (state.half >= 100) return { title: '50수 규칙', text: '무승부' };
    const k = keys[keys.length - 1];
    if (keys.filter((x) => x === k).length >= 3) return { title: '3회 동일 국면', text: '무승부' };
    return null;
  }

  function update() {
    legal = Chess.legalMoves(state);
    over = evaluate();
    renderPieces();
    renderMarks();
    renderPanel();
    if (over) resultTimer = setTimeout(showResult, ANIM + 150);
  }

  function newGame() {
    clearTimeout(resultTimer);
    for (const el of els.values()) { clearTimeout(el.rmTimer); el.remove(); }
    els.clear();
    state = Chess.initial();
    history = [];
    sans = [];
    keys = [Chess.key(state)];
    selected = null;
    closePromo();
    resultEl.hidden = true;
    update();
  }

  function doMove(m) {
    const notation = Chess.san(state, m, legal);
    history.push(state);
    state = Chess.apply(state, m);
    sans.push(notation);
    keys.push(Chess.key(state));
    selected = null;
    update();
  }

  function undo() {
    if (!history.length) return;
    clearTimeout(resultTimer);
    resultEl.hidden = true;
    closePromo();
    state = history.pop();
    sans.pop();
    keys.pop();
    selected = null;
    update();
  }

  function flip() {
    flipped = !flipped;
    boardEl.classList.add('instant');
    buildSquares();
    renderPieces();
    renderMarks();
    renderPanel();
    void boardEl.offsetWidth;
    boardEl.classList.remove('instant');
  }

  // ---------- 승급 ----------
  function openPromo(moves) {
    promoMoves = moves;
    promoList.innerHTML = 'qrbn'.split('').map((t) =>
      `<button type="button" data-t="${t}" aria-label="${NAMES[t]}">${pieceSVG(t, state.turn)}</button>`).join('');
    promoEl.hidden = false;
  }
  function closePromo() {
    promoMoves = null;
    promoEl.hidden = true;
  }

  // ---------- 결과 ----------
  function showResult() {
    $('resultTitle').textContent = over.title;
    $('resultText').textContent = over.text;
    $('resultMark').innerHTML = over.winner ? pieceSVG('k', over.winner) : pieceSVG('k', 'w') + pieceSVG('k', 'b');
    resultEl.hidden = false;
  }

  // ---------- 입력 ----------
  boardEl.addEventListener('click', (e) => {
    if (over || promoMoves) return;
    const rect = boardEl.getBoundingClientRect();
    let c = Math.floor(((e.clientX - rect.left) / rect.width) * 8);
    let r = Math.floor(((e.clientY - rect.top) / rect.height) * 8);
    if (c < 0 || c > 7 || r < 0 || r > 7) return;
    if (flipped) { r = 7 - r; c = 7 - c; }
    const s = r * 8 + c;

    if (selected !== null) {
      const moves = legal.filter((m) => m.from === selected && m.to === s);
      if (moves.length) {
        if (moves[0].promo) openPromo(moves);
        else doMove(moves[0]);
        return;
      }
    }
    const p = state.board[s];
    selected = p && p.color === state.turn && selected !== s ? s : null;
    renderMarks();
  });

  promoList.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const m = promoMoves.find((x) => x.promo === b.dataset.t);
    closePromo();
    doMove(m);
  });
  promoEl.addEventListener('click', (e) => {
    if (e.target !== promoEl) return;
    closePromo();
    selected = null;
    renderMarks();
  });

  $('btnNew').addEventListener('click', newGame);
  btnUndo.addEventListener('click', undo);
  $('btnFlip').addEventListener('click', flip);
  $('btnResultNew').addEventListener('click', newGame);
  $('btnResultClose').addEventListener('click', () => { resultEl.hidden = true; });

  buildSquares();
  newGame();
})();
