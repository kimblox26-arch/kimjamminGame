// 체스 규칙 엔진
// 칸 번호: 0 = a8, 7 = h8, 56 = a1, 63 = h1  (행 r = s >> 3, 열 c = s & 7)
const Chess = (() => {
  const FILES = 'abcdefgh';
  const N_OFF = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const K_OFF = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const B_DIR = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const R_DIR = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  const on = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const opp = (color) => (color === 'w' ? 'b' : 'w');
  const name = (s) => FILES[s & 7] + (8 - (s >> 3));
  let uid = 0;

  function initial() {
    const board = Array(64).fill(null);
    const back = 'rnbqkbnr';
    const mk = (type, color) => ({ id: 'p' + uid++, type, color });
    for (let c = 0; c < 8; c++) {
      board[c] = mk(back[c], 'b');
      board[8 + c] = mk('p', 'b');
      board[48 + c] = mk('p', 'w');
      board[56 + c] = mk(back[c], 'w');
    }
    return { board, turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true }, ep: -1, half: 0, full: 1 };
  }

  function attacked(board, s, by) {
    const r = s >> 3, c = s & 7;
    const is = (rr, cc, types) => {
      if (!on(rr, cc)) return false;
      const p = board[rr * 8 + cc];
      return !!p && p.color === by && types.includes(p.type);
    };
    const pr = by === 'w' ? r + 1 : r - 1;
    if (is(pr, c - 1, 'p') || is(pr, c + 1, 'p')) return true;
    for (const [dr, dc] of N_OFF) if (is(r + dr, c + dc, 'n')) return true;
    for (const [dr, dc] of K_OFF) if (is(r + dr, c + dc, 'k')) return true;
    const ray = (dirs, types) => {
      for (const [dr, dc] of dirs) {
        let rr = r + dr, cc = c + dc;
        while (on(rr, cc)) {
          const p = board[rr * 8 + cc];
          if (p) {
            if (p.color === by && types.includes(p.type)) return true;
            break;
          }
          rr += dr;
          cc += dc;
        }
      }
      return false;
    };
    return ray(B_DIR, 'bq') || ray(R_DIR, 'rq');
  }

  const kingSq = (board, color) => board.findIndex((p) => p && p.type === 'k' && p.color === color);
  const inCheck = (st, color) => attacked(st.board, kingSq(st.board, color), opp(color));

  function castles(st, s, out) {
    const { board, turn, castling } = st;
    const home = turn === 'w' ? 60 : 4, enemy = opp(turn);
    if (s !== home || attacked(board, home, enemy)) return;
    if (castling[turn + 'K'] && !board[home + 1] && !board[home + 2] &&
        !attacked(board, home + 1, enemy) && !attacked(board, home + 2, enemy)) {
      out.push({ from: home, to: home + 2, castle: 'K', rookFrom: home + 3, rookTo: home + 1 });
    }
    if (castling[turn + 'Q'] && !board[home - 1] && !board[home - 2] && !board[home - 3] &&
        !attacked(board, home - 1, enemy) && !attacked(board, home - 2, enemy)) {
      out.push({ from: home, to: home - 2, castle: 'Q', rookFrom: home - 4, rookTo: home - 1 });
    }
  }

  function pseudo(st) {
    const { board, turn } = st, out = [];
    for (let s = 0; s < 64; s++) {
      const p = board[s];
      if (!p || p.color !== turn) continue;
      const r = s >> 3, c = s & 7;
      const target = (t) => {
        const q = board[t];
        if (!q) out.push({ from: s, to: t });
        else if (q.color !== turn) out.push({ from: s, to: t, capture: t });
      };

      if (p.type === 'p') {
        const dir = turn === 'w' ? -1 : 1, start = turn === 'w' ? 6 : 1, last = turn === 'w' ? 0 : 7;
        const push = (m) => {
          if (m.to >> 3 === last) for (const promo of 'qrbn') out.push({ ...m, promo });
          else out.push(m);
        };
        const one = s + dir * 8;
        if (on(r + dir, c) && !board[one]) {
          push({ from: s, to: one });
          const two = one + dir * 8;
          if (r === start && !board[two]) out.push({ from: s, to: two, double: true });
        }
        for (const dc of [-1, 1]) {
          if (!on(r + dir, c + dc)) continue;
          const t = (r + dir) * 8 + c + dc, q = board[t];
          if (q && q.color !== turn) push({ from: s, to: t, capture: t });
          else if (t === st.ep) out.push({ from: s, to: t, capture: r * 8 + c + dc, ep: true });
        }
      } else if (p.type === 'n' || p.type === 'k') {
        for (const [dr, dc] of p.type === 'n' ? N_OFF : K_OFF) {
          if (on(r + dr, c + dc)) target((r + dr) * 8 + c + dc);
        }
        if (p.type === 'k') castles(st, s, out);
      } else {
        const dirs = p.type === 'b' ? B_DIR : p.type === 'r' ? R_DIR : B_DIR.concat(R_DIR);
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc;
          while (on(rr, cc)) {
            const t = rr * 8 + cc;
            target(t);
            if (board[t]) break;
            rr += dr;
            cc += dc;
          }
        }
      }
    }
    return out;
  }

  function apply(st, m) {
    const board = st.board.slice();
    const p = board[m.from];
    const captured = m.capture !== undefined ? board[m.capture] : null;
    if (captured) board[m.capture] = null;
    board[m.from] = null;
    board[m.to] = m.promo ? { ...p, type: m.promo } : p;
    if (m.castle) {
      board[m.rookTo] = board[m.rookFrom];
      board[m.rookFrom] = null;
    }
    const castling = { ...st.castling };
    if (p.type === 'k') castling[p.color + 'K'] = castling[p.color + 'Q'] = false;
    for (const s of [m.from, m.to]) {
      if (s === 63) castling.wK = false;
      if (s === 56) castling.wQ = false;
      if (s === 7) castling.bK = false;
      if (s === 0) castling.bQ = false;
    }
    return {
      board,
      turn: opp(st.turn),
      castling,
      ep: m.double ? (m.from + m.to) / 2 : -1,
      half: p.type === 'p' || captured ? 0 : st.half + 1,
      full: st.full + (st.turn === 'b' ? 1 : 0),
    };
  }

  function legalMoves(st) {
    return pseudo(st).filter((m) => {
      const b = apply(st, m).board;
      return !attacked(b, kingSq(b, st.turn), opp(st.turn));
    });
  }

  function san(st, m, legal) {
    const p = st.board[m.from];
    let s;
    if (m.castle) {
      s = m.castle === 'K' ? 'O-O' : 'O-O-O';
    } else if (p.type === 'p') {
      s = (m.capture !== undefined ? FILES[m.from & 7] + 'x' : '') + name(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
    } else {
      const others = legal.filter((o) => o.to === m.to && o.from !== m.from && st.board[o.from].type === p.type);
      let dis = '';
      if (others.length) {
        if (!others.some((o) => (o.from & 7) === (m.from & 7))) dis = FILES[m.from & 7];
        else if (!others.some((o) => o.from >> 3 === m.from >> 3)) dis = String(8 - (m.from >> 3));
        else dis = name(m.from);
      }
      s = p.type.toUpperCase() + dis + (m.capture !== undefined ? 'x' : '') + name(m.to);
    }
    const next = apply(st, m);
    if (inCheck(next, next.turn)) s += legalMoves(next).length ? '+' : '#';
    return s;
  }

  function insufficient(board) {
    const rest = [];
    board.forEach((p, i) => { if (p && p.type !== 'k') rest.push({ type: p.type, i }); });
    if (!rest.length) return true;
    if (rest.length === 1 && (rest[0].type === 'b' || rest[0].type === 'n')) return true;
    if (rest.every((p) => p.type === 'b')) {
      const shade = (i) => ((i >> 3) + (i & 7)) % 2;
      return rest.every((p) => shade(p.i) === shade(rest[0].i));
    }
    return false;
  }

  function key(st) {
    let k = '';
    for (const p of st.board) k += p ? (p.color === 'w' ? p.type.toUpperCase() : p.type) : '.';
    const cs = st.castling;
    const ep = st.ep >= 0 && pseudo(st).some((m) => m.ep) ? st.ep : -1;
    return k + st.turn + (cs.wK ? 'K' : '') + (cs.wQ ? 'Q' : '') + (cs.bK ? 'k' : '') + (cs.bQ ? 'q' : '') + ep;
  }


  // ---------- 추천 / 컴퓨터용 탐색 ----------
  const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  const PST = {
    p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5,
        0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
    n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30,
        -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
    b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10,
        -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
    r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5,
        -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
    q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5,
        0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
    k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30,
        -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
    e: [-50,-40,-30,-20,-20,-30,-40,-50, -30,-20,-10,0,0,-10,-20,-30, -30,-10,20,30,30,20,-10,-30, -30,-10,30,40,40,30,-10,-30,
        -30,-10,30,40,40,30,-10,-30, -30,-10,20,30,30,20,-10,-30, -30,-30,0,0,0,0,-30,-30, -50,-30,-30,-30,-30,-30,-30,-50],
  };
  const MATE = 100000;

  function score(st) {
    const board = st.board;
    let heavy = 0;
    for (const p of board) if (p && p.type !== 'p' && p.type !== 'k') heavy += VAL[p.type];
    const endgame = heavy <= 2600;
    let s = 0;
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (!p) continue;
      const idx = p.color === 'w' ? i : (7 - (i >> 3)) * 8 + (i & 7);
      const t = p.type === 'k' ? (endgame ? PST.e : PST.k) : PST[p.type];
      s += (p.color === 'w' ? 1 : -1) * (VAL[p.type] + t[idx]);
    }
    return st.turn === 'w' ? s : -s;
  }

  function ordered(moves, board) {
    for (const m of moves) {
      m.o = (m.promo === 'q' ? 9000 : 0) +
        (m.capture !== undefined ? 1000 + 10 * VAL[board[m.capture].type || 'p'] - VAL[board[m.from].type] : 0);
    }
    return moves.sort((a, b) => b.o - a.o);
  }

  function quiesce(st, alpha, beta, qd) {
    const stand = score(st);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (qd >= 6) return alpha;
    const moves = ordered(pseudo(st).filter((m) => (m.capture !== undefined || m.promo) && (!m.promo || m.promo === 'q')), st.board);
    for (const m of moves) {
      const nx = apply(st, m);
      if (attacked(nx.board, kingSq(nx.board, st.turn), nx.turn)) continue;
      const v = -quiesce(nx, -beta, -alpha, qd + 1);
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  function search(st, depth, alpha, beta, ply) {
    if (depth <= 0) return quiesce(st, alpha, beta, 0);
    let any = false;
    for (const m of ordered(pseudo(st), st.board)) {
      const nx = apply(st, m);
      if (attacked(nx.board, kingSq(nx.board, st.turn), nx.turn)) continue;
      any = true;
      const v = -search(nx, depth - 1, -beta, -alpha, ply + 1);
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    if (!any) return inCheck(st, st.turn) ? -MATE + ply : 0;
    return alpha;
  }

  // 각 기물별로 가장 좋은 수를 찾는다: { best, byFrom: Map(from -> {move, score}) }
  function analyze(st, depth) {
    const groups = new Map();
    for (const m of legalMoves(st)) {
      if (!groups.has(m.from)) groups.set(m.from, []);
      groups.get(m.from).push(m);
    }
    const byFrom = new Map();
    let best = null;
    for (const [from, moves] of groups) {
      let alpha = -MATE - 1, pick = null;
      for (const m of ordered(moves, st.board)) {
        const v = -search(apply(st, m), depth - 1, -MATE - 1, -alpha, 1);
        if (v > alpha || !pick) { alpha = v; pick = m; }
      }
      byFrom.set(from, { move: pick, score: alpha });
      if (!best || alpha > best.score) best = { move: pick, score: alpha };
    }
    return { best, byFrom };
  }

  return { initial, legalMoves, apply, inCheck, kingSq, san, insufficient, key, analyze };
})();
