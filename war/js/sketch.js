// 손그림(스케치) 그리기 도구 모음 — 흔들리는 선, 졸라맨, 탱크, 아이콘, 종이 질감
(function () {
  const SK = (window.SK = {});
  SK.FONT = '"Gaegu","Nanum Pen Script","Comic Sans MS",cursive';
  SK.wobble = true; // 선 흔들림(라인 보일) 효과
  SK.frame = 0;
  SK.INK = '#2a2420';

  SK.rng = (seed) => {
    let s = (Math.imul(Math.round(seed) | 0, 2654435761) ^ 0x9e3779b9) | 0;
    if (!s) s = 1;
    return () => {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
  };
  SK.seed = (base) => Math.round(base) + (SK.wobble ? SK.frame * 7919 : 0);

  function trace(ctx, p) {
    ctx.moveTo(p[0][0], p[0][1]);
    if (p.length === 2) { ctx.lineTo(p[1][0], p[1][1]); return; }
    for (let i = 1; i < p.length - 1; i++) {
      ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    }
    const l = p[p.length - 1];
    ctx.lineTo(l[0], l[1]);
  }
  SK.trace = trace;

  function seg(x1, y1, x2, y2, j, r, over = true) {
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
    const n = Math.max(2, Math.min(14, Math.round(L / 16)));
    const nx = -dy / L, ny = dx / L, ux = dx / L, uy = dy / L;
    const bow = (r() - 0.5) * Math.min(L * 0.05, j * 3);
    const ov = over ? r() * 0.8 * j : 0;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const b = Math.sin(t * Math.PI) * bow + (r() - 0.5) * j * 0.5;
      let x = x1 + dx * t + nx * b, y = y1 + dy * t + ny * b;
      if (i === 0) { x -= ux * ov; y -= uy * ov; }
      if (i === n) { x += ux * ov * 1.4; y += uy * ov * 1.4; }
      out.push([x, y]);
    }
    return out;
  }

  function style(ctx, o) {
    ctx.strokeStyle = o.color || SK.INK;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }

  SK.line = (ctx, x1, y1, x2, y2, o = {}) => {
    const r = SK.rng(SK.seed(o.seed ?? x1 * 7 + y1 * 13 + x2 * 3 + y2));
    const w = o.w || 2, j = o.j ?? 1.4, passes = o.passes ?? 2;
    ctx.save(); style(ctx, o);
    for (let p = 0; p < passes; p++) {
      ctx.lineWidth = p ? w * 0.55 : w;
      ctx.globalAlpha = (o.alpha ?? 1) * (p ? 0.5 : 1);
      ctx.beginPath(); trace(ctx, seg(x1, y1, x2, y2, j, r)); ctx.stroke();
    }
    ctx.restore();
  };

  // 다각형 (닫힘). o.fill 이 있으면 살짝 삐져나가게 칠함
  SK.poly = (ctx, pts, o = {}) => {
    const r = SK.rng(SK.seed(o.seed ?? pts[0][0] * 11 + pts[0][1] * 17 + pts.length));
    const j = o.j ?? 1.4, w = o.w ?? 2;
    ctx.save(); style(ctx, o);
    if (o.fill) {
      ctx.fillStyle = o.fill;
      ctx.globalAlpha = o.fillAlpha ?? 1;
      ctx.beginPath();
      pts.forEach(([x, y], i) => {
        const X = x + (r() - 0.5) * j * 2.2, Y = y + (r() - 0.5) * j * 2.2;
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      });
      ctx.closePath(); ctx.fill();
      if (o.hatch) {
        ctx.clip();
        SK._hatchLines(ctx, pts, o.hatch, r);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (w > 0) {
      ctx.save(); style(ctx, o);
      const passes = o.passes ?? 2;
      for (let p = 0; p < passes; p++) {
        ctx.lineWidth = p ? w * 0.55 : w;
        ctx.globalAlpha = (o.alpha ?? 1) * (p ? 0.5 : 1);
        ctx.beginPath();
        const n = o.open ? pts.length - 1 : pts.length;
        for (let i = 0; i < n; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          trace(ctx, seg(a[0], a[1], b[0], b[1], j, r));
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  SK._hatchLines = (ctx, pts, h, r) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    const gap = h.gap || 5;
    ctx.strokeStyle = h.color || 'rgba(0,0,0,.25)';
    ctx.lineWidth = h.w || 1;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let k = x0 - (y1 - y0); k < x1; k += gap) {
      const jx = (r() - 0.5) * gap * 0.5;
      ctx.moveTo(k + jx, y1 + 2);
      ctx.lineTo(k + jx + (y1 - y0) + 4, y0 - 2);
    }
    ctx.stroke();
  };

  SK.rect = (ctx, x, y, w, h, o = {}) =>
    SK.poly(ctx, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], o);

  SK.ellipse = (ctx, cx, cy, rx, ry, o = {}) => {
    const r = SK.rng(SK.seed(o.seed ?? cx * 5 + cy * 9 + rx));
    const n = Math.max(10, Math.min(40, Math.round((rx + ry) / 2.5)));
    const j = o.j ?? Math.min(1.5, (rx + ry) * 0.05);
    const passes = o.passes ?? 2;
    const mk = (over) => {
      const a0 = r() * Math.PI * 2, sweep = Math.PI * 2 + (over ? 0.25 + r() * 0.35 : 0);
      const p = [];
      for (let i = 0; i <= n; i++) {
        const a = a0 + (sweep * i) / n;
        const k = 1 + (r() - 0.5) * 0.08;
        p.push([cx + Math.cos(a) * rx * k + (r() - 0.5) * j, cy + Math.sin(a) * ry * k + (r() - 0.5) * j]);
      }
      return p;
    };
    ctx.save(); style(ctx, o);
    if (o.fill) {
      ctx.fillStyle = o.fill; ctx.globalAlpha = o.fillAlpha ?? 1;
      ctx.beginPath(); trace(ctx, mk(false)); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if ((o.w ?? 2) > 0) {
      for (let p = 0; p < passes; p++) {
        ctx.lineWidth = p ? (o.w ?? 2) * 0.55 : (o.w ?? 2);
        ctx.globalAlpha = (o.alpha ?? 1) * (p ? 0.5 : 1);
        ctx.beginPath(); trace(ctx, mk(true)); ctx.stroke();
      }
    }
    ctx.restore();
  };

  // 글자마다 기울어진 손글씨
  SK.text = (ctx, str, x, y, o = {}) => {
    const size = o.size || 18;
    const r = SK.rng(SK.seed(o.seed ?? str.length * 31 + x + y * 3));
    ctx.save();
    ctx.font = `${o.weight || 700} ${size}px ${SK.FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const chars = [...str];
    const ws = chars.map((c) => ctx.measureText(c).width);
    const sp = o.spacing ?? size * 0.02;
    const total = ws.reduce((a, b) => a + b, 0) + sp * (chars.length - 1);
    let cx = o.align === 'left' ? x : o.align === 'right' ? x - total : x - total / 2;
    const rot = o.rot ?? 0.12;
    chars.forEach((c, i) => {
      const dy = (r() - 0.5) * size * 0.1, a = (r() - 0.5) * rot;
      ctx.save();
      ctx.translate(cx + ws[i] / 2, y + dy);
      ctx.rotate(a + (o.angle || 0));
      if (o.stroke) {
        ctx.lineWidth = o.strokeW || 4; ctx.strokeStyle = o.stroke; ctx.lineJoin = 'round';
        ctx.strokeText(c, 0, 0);
      }
      ctx.fillStyle = o.color || SK.INK;
      ctx.fillText(c, 0, 0);
      ctx.restore();
      cx += ws[i] + sp;
    });
    ctx.restore();
    return total;
  };

  SK.measure = (ctx, str, size, weight = 700) => {
    ctx.save(); ctx.font = `${weight} ${size}px ${SK.FONT}`;
    const w = ctx.measureText(str).width; ctx.restore(); return w + size * 0.02 * str.length;
  };

  // ───────── 졸라맨 ─────────
  // x,y: 발 위치, h: 키. pose: stand|walk|shoot|cheer|wave|sad|run
  SK.stick = (ctx, x, y, h, o = {}) => {
    const dir = o.dir || 1, t = o.t || 0, col = o.color || SK.INK;
    const lw = o.lw || Math.max(1.6, h / 16);
    const seed = o.seed ?? x * 3 + y;
    const L = (x1, y1, x2, y2, k) =>
      SK.line(ctx, x1, y1, x2, y2, { w: lw, color: col, j: h / 60, passes: 1, seed: seed + k });
    ctx.save();
    ctx.translate(x, y);
    if (o.fall) ctx.rotate(-dir * o.fall * Math.PI * 0.5);
    const hr = h * 0.13, headY = -h + hr, neck = -h + hr * 2, sh = neck + h * 0.07, hip = -h * 0.42;
    const pose = o.pose || 'stand';
    let lean = 0;
    if (pose === 'run') lean = dir * h * 0.08;
    if (pose === 'sad') lean = dir * h * 0.04;
    // 다리
    const legL = h * 0.43;
    let a1 = 0.28, a2 = -0.28;
    if (pose === 'walk' || pose === 'run') {
      const amp = pose === 'run' ? 0.75 : 0.5;
      a1 = Math.sin(t) * amp; a2 = -Math.sin(t) * amp;
    }
    if (pose === 'cheer') { const b = Math.abs(Math.sin(t * 2)) * h * 0.08; ctx.translate(0, -b); }
    L(lean * 0.5, hip, lean * 0.5 + Math.sin(a1) * legL * dir, hip + Math.cos(a1) * legL, 1);
    L(lean * 0.5, hip, lean * 0.5 + Math.sin(a2) * legL * dir, hip + Math.cos(a2) * legL, 2);
    // 몸통
    L(lean * 0.5, hip, lean, neck, 3);
    // 팔
    const ax = lean, armL = h * 0.32;
    if (pose === 'shoot') {
      const gx1 = ax + dir * h * 0.05, gy = sh + h * 0.06, gx2 = ax + dir * h * 0.5;
      L(ax, sh, ax + dir * h * 0.22, gy, 4);
      L(ax, sh, ax + dir * h * 0.34, gy - h * 0.02, 5);
      SK.line(ctx, gx1, gy + h * 0.02, gx2, gy - h * 0.03, { w: lw * 1.4, color: '#3b3b3b', passes: 1, j: 0.5, seed: seed + 9 });
    } else if (pose === 'cheer') {
      const w = Math.sin(t * 3) * 0.2;
      L(ax, sh, ax - h * 0.22, sh - armL * (0.9 + w), 4);
      L(ax, sh, ax + h * 0.22, sh - armL * (0.9 - w), 5);
    } else if (pose === 'wave') {
      L(ax, sh, ax - dir * h * 0.18, sh + armL * 0.85, 4);
      const w = Math.sin(t * 4) * 0.35;
      L(ax, sh, ax + dir * h * (0.18 + w * 0.3), sh - armL * 0.9, 5);
    } else if (pose === 'sad') {
      L(ax, sh, ax + dir * h * 0.06, sh + armL, 4);
      L(ax, sh, ax + dir * h * 0.14, sh + armL * 0.95, 5);
    } else {
      const sw = pose === 'walk' || pose === 'run' ? Math.sin(t) * 0.4 : 0.25;
      L(ax, sh, ax + Math.sin(sw) * armL * dir, sh + Math.cos(sw) * armL, 4);
      L(ax, sh, ax - Math.sin(sw) * armL * dir, sh + Math.cos(sw) * armL, 5);
      if (o.gun) SK.line(ctx, ax + dir * h * 0.05, sh + h * 0.2, ax + dir * h * 0.32, sh - h * 0.12, { w: lw * 1.3, color: '#3b3b3b', passes: 1, j: 0.4, seed: seed + 8 });
    }
    // 머리
    const hx = lean + (pose === 'sad' ? dir * h * 0.04 : 0), hy = headY + (pose === 'sad' ? h * 0.03 : 0);
    SK.ellipse(ctx, hx, hy, hr, hr, { w: lw, color: col, fill: o.face || '#fbf6ea', passes: 1, seed: seed + 6 });
    if (o.helmet) {
      ctx.save();
      ctx.fillStyle = o.helmet; ctx.strokeStyle = col; ctx.lineWidth = lw * 0.8;
      ctx.beginPath(); ctx.arc(hx, hy - hr * 0.1, hr * 1.12, Math.PI * 1.05, Math.PI * 1.95); ctx.closePath();
      ctx.fill(); ctx.stroke(); ctx.restore();
    }
    if (o.tie) { // 대통령 넥타이
      SK.poly(ctx, [[lean, neck + 1], [lean + 2.5, neck + h * 0.12], [lean, neck + h * 0.2], [lean - 2.5, neck + h * 0.12]], { fill: o.tie, w: 1, color: col, passes: 1 });
    }
    if (h > 26 && o.eyes !== false) {
      ctx.fillStyle = col;
      const ex = hx + dir * hr * 0.35;
      ctx.beginPath(); ctx.arc(ex - hr * 0.25, hy - hr * 0.15, Math.max(1, hr * 0.1), 0, 7); ctx.arc(ex + hr * 0.25, hy - hr * 0.15, Math.max(1, hr * 0.1), 0, 7); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, lw * 0.6);
      ctx.beginPath();
      if (pose === 'sad') ctx.arc(ex, hy + hr * 0.55, hr * 0.3, Math.PI * 1.15, Math.PI * 1.85);
      else ctx.arc(ex, hy + hr * 0.1, hr * 0.32, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
    ctx.restore();
  };

  // ───────── 무기 / 사물 ─────────
  SK.tank = (ctx, x, y, s, o = {}) => {
    const d = o.dir || 1, c = o.color || '#7d8a52', seed = o.seed ?? x + y;
    const P = (a) => a.map(([px, py]) => [x + px * s * d, y + py * s]);
    SK.poly(ctx, P([[-1, -0.05], [1, -0.05], [0.85, -0.35], [-0.88, -0.35]]), { fill: '#5b5b52', w: s * 0.06, seed });
    for (let i = 0; i < 5; i++) SK.ellipse(ctx, x + (-0.7 + i * 0.35) * s * d, y - 0.2 * s, s * 0.11, s * 0.11, { w: s * 0.04, fill: '#8a8a80', passes: 1, seed: seed + i });
    SK.poly(ctx, P([[-0.9, -0.35], [0.95, -0.35], [0.75, -0.6], [-0.8, -0.6]]), { fill: c, w: s * 0.06, hatch: { gap: s * 0.12, color: 'rgba(0,0,0,.18)' }, seed: seed + 7 });
    SK.ellipse(ctx, x - 0.05 * s * d, y - 0.68 * s, s * 0.36, s * 0.17, { fill: c, w: s * 0.06, passes: 1, seed: seed + 8 });
    SK.line(ctx, x + 0.25 * s * d, y - 0.72 * s, x + 1.25 * s * d, y - 0.8 * s, { w: s * 0.1, passes: 1, seed: seed + 9 });
  };

  SK.cannon = (ctx, x, y, s, o = {}) => {
    const d = o.dir || 1, seed = o.seed ?? x + y;
    SK.line(ctx, x, y - 0.35 * s, x - 0.95 * s * d, y - 0.02 * s, { w: s * 0.08, seed });
    SK.line(ctx, x - 0.25 * s * d, y - 0.45 * s, x + 0.95 * s * d, y - 1.0 * s, { w: s * 0.2, color: '#4a4a40', seed: seed + 2 });
    SK.ellipse(ctx, x, y - 0.35 * s, s * 0.35, s * 0.35, { fill: '#9b7b4b', w: s * 0.07, seed: seed + 3 });
    SK.line(ctx, x - 0.3 * s, y - 0.35 * s, x + 0.3 * s, y - 0.35 * s, { w: s * 0.04, passes: 1, seed: seed + 4 });
    SK.line(ctx, x, y - 0.65 * s, x, y - 0.05 * s, { w: s * 0.04, passes: 1, seed: seed + 5 });
  };

  SK.jet = (ctx, x, y, s, o = {}) => {
    const d = o.dir || 1, c = o.color || '#9aa6ad', seed = o.seed ?? x + y;
    const P = (a) => a.map(([px, py]) => [x + px * s * d, y + py * s]);
    SK.poly(ctx, P([[-0.25, 0], [0.25, 0], [-0.35, 0.55], [-0.5, 0.55]]), { fill: c, w: s * 0.05, seed: seed + 1 });
    SK.poly(ctx, P([[-1, -0.1], [0.75, -0.12], [1.1, 0], [0.75, 0.12], [-1, 0.1]]), { fill: c, w: s * 0.06, hatch: { gap: s * 0.15, color: 'rgba(0,0,0,.15)' }, seed });
    SK.poly(ctx, P([[-0.1, 0], [0.2, 0], [-0.4, -0.55], [-0.55, -0.55]]), { fill: c, w: s * 0.05, seed: seed + 2 });
    SK.poly(ctx, P([[-0.95, -0.05], [-0.7, -0.05], [-0.95, -0.45], [-1.05, -0.45]]), { fill: c, w: s * 0.05, seed: seed + 3 });
    SK.ellipse(ctx, x + 0.55 * s * d, y - 0.08 * s, s * 0.17, s * 0.07, { fill: '#5fa6d6', w: s * 0.04, passes: 1, seed: seed + 4 });
  };

  SK.coin = (ctx, x, y, r, o = {}) => {
    SK.ellipse(ctx, x, y, r, r, { fill: '#f0c53e', w: Math.max(1.2, r * 0.14), seed: o.seed ?? 3 });
    SK.ellipse(ctx, x, y, r * 0.72, r * 0.72, { w: Math.max(0.8, r * 0.07), passes: 1, color: '#9a7414', seed: (o.seed ?? 3) + 1 });
    SK.text(ctx, '₩', x, y + r * 0.05, { size: r * 1.15, color: '#7a5a0a', rot: 0.05, seed: 5 });
  };

  SK.star = (ctx, x, y, r, o = {}) => {
    const p = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
      p.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    SK.poly(ctx, p, { fill: o.fill || '#f2c230', w: o.w ?? Math.max(1, r * 0.15), j: r * 0.06, passes: 1, seed: o.seed ?? x });
  };

  SK.building = (ctx, x, y, s, o = {}) => {
    const f = o.fill || '#e9dcc0', seed = o.seed ?? x + y, w = Math.max(1, s * 0.06);
    const blocks = [[-0.62, 0.62, 0.4], [-0.22, 1, 0.44], [0.24, 0.5, 0.4]];
    blocks.forEach(([bx, bh, bw], i) => {
      SK.rect(ctx, x + bx * s, y - bh * s, bw * s, bh * s, { fill: f, w, j: s * 0.03, passes: 1, seed: seed + i });
      if (s > 9) {
        ctx.fillStyle = 'rgba(40,30,20,.55)';
        for (let wy = y - bh * s + s * 0.14; wy < y - s * 0.12; wy += s * 0.2)
          for (let wx = x + bx * s + s * 0.08; wx < x + (bx + bw) * s - s * 0.08; wx += s * 0.15)
            ctx.fillRect(wx, wy, s * 0.06, s * 0.08);
      }
    });
    if (o.capital) SK.star(ctx, x + 0.0, y - 1.22 * s, s * 0.26, { seed });
  };

  SK.taeguk = (ctx, x, y, r) => {
    ctx.save();
    ctx.fillStyle = '#c8303a';
    ctx.beginPath(); ctx.arc(x, y, r, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#1f4fa0';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#c8303a'; ctx.beginPath(); ctx.arc(x - r / 2, y, r / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1f4fa0'; ctx.beginPath(); ctx.arc(x + r / 2, y, r / 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };

  SK.flag = (ctx, x, y, s, o = {}) => {
    const seed = o.seed ?? x + y;
    SK.line(ctx, x, y, x, y - 1.3 * s, { w: Math.max(1.2, s * 0.07), color: '#5a4630', seed });
    const fx = x, fy = y - 1.3 * s, fw = 0.85 * s, fh = 0.56 * s;
    const wave = o.t ? Math.sin(o.t * 4) * s * 0.05 : 0;
    SK.poly(ctx, [[fx, fy], [fx + fw, fy + wave], [fx + fw, fy + fh + wave], [fx, fy + fh]], { fill: o.korea ? '#fbf8f0' : o.color || '#d84b3c', w: Math.max(1, s * 0.05), j: s * 0.03, passes: 1, seed: seed + 1 });
    if (o.korea) {
      SK.taeguk(ctx, fx + fw / 2, fy + fh / 2 + wave / 2, fh * 0.22);
      ctx.save(); ctx.strokeStyle = '#222'; ctx.lineWidth = Math.max(0.8, s * 0.03);
      [[0.18, 0.2], [0.82, 0.2], [0.18, 0.8], [0.82, 0.8]].forEach(([u, v]) => {
        ctx.beginPath();
        for (let k = -1; k <= 1; k++) { ctx.moveTo(fx + fw * u - fw * 0.07, fy + fh * v + k * fh * 0.06); ctx.lineTo(fx + fw * u + fw * 0.07, fy + fh * v + k * fh * 0.06); }
        ctx.stroke();
      });
      ctx.restore();
    }
  };

  SK.swords = (ctx, x, y, s, o = {}) => {
    const c = o.color || '#3a3a3a', w = Math.max(1.2, s * 0.12);
    SK.line(ctx, x - s, y + s, x + s, y - s, { w, color: c, passes: 1, seed: 1 });
    SK.line(ctx, x + s, y + s, x - s, y - s, { w, color: c, passes: 1, seed: 2 });
    SK.line(ctx, x - s * 0.75, y + s * 0.35, x - s * 0.35, y + s * 0.75, { w, color: '#7a4b22', passes: 1, seed: 3 });
    SK.line(ctx, x + s * 0.75, y + s * 0.35, x + s * 0.35, y + s * 0.75, { w, color: '#7a4b22', passes: 1, seed: 4 });
  };

  // 폭발 낙서
  SK.boom = (ctx, x, y, r, t, seed) => {
    const rr = SK.rng(seed);
    const p = [];
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, k = i % 2 ? 0.55 : 1;
      p.push([x + Math.cos(a) * r * k * (0.8 + rr() * 0.4), y + Math.sin(a) * r * k * (0.8 + rr() * 0.4)]);
    }
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - t);
    SK.poly(ctx, p, { fill: '#f6a33a', w: 2, color: '#a3401c', seed, passes: 1 });
    SK.ellipse(ctx, x, y, r * 0.35, r * 0.35, { fill: '#ffe27a', w: 0, seed: seed + 1 });
    ctx.restore();
  };

  // ───────── 종이 질감 ─────────
  let paperURL = null, paperCanvas = null;
  SK.paper = () => {
    if (paperCanvas) return paperCanvas;
    const S = 384, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#f3ead6'; g.fillRect(0, 0, S, S);
    const id = g.getImageData(0, 0, S, S), d = id.data, r = SK.rng(77);
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * 18;
      d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.9;
    }
    g.putImageData(id, 0, 0);
    for (let i = 0; i < 140; i++) {
      const x = r() * S, y = r() * S, a = r() * Math.PI, l = 6 + r() * 26;
      g.strokeStyle = r() < 0.5 ? 'rgba(120,95,60,.07)' : 'rgba(255,255,255,.18)';
      g.lineWidth = 0.6 + r();
      for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
        g.beginPath(); g.moveTo(x + ox, y + oy);
        g.quadraticCurveTo(x + ox + Math.cos(a) * l * 0.5 + 3, y + oy + Math.sin(a) * l * 0.5, x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
        g.stroke();
      }
    }
    paperCanvas = c;
    return c;
  };
  SK.paperURL = () => paperURL || (paperURL = SK.paper().toDataURL());

  // ───────── 아이콘 (그림) ─────────
  const iconCache = {};
  const ICONS = {
    coin: (g, s) => SK.coin(g, s / 2, s / 2, s * 0.36),
    power: (g, s) => { SK.stick(g, s * 0.5, s * 0.92, s * 0.8, { gun: true, helmet: '#6b7a3a', eyes: false, seed: 4 }); },
    approval: (g, s) => {
      SK.ellipse(g, s / 2, s / 2, s * 0.36, s * 0.36, { fill: '#ffd86a', w: s * 0.06, seed: 2 });
      g.fillStyle = SK.INK; g.beginPath(); g.arc(s * 0.38, s * 0.42, s * 0.04, 0, 7); g.arc(s * 0.62, s * 0.42, s * 0.04, 0, 7); g.fill();
      g.strokeStyle = SK.INK; g.lineWidth = s * 0.05; g.beginPath(); g.arc(s / 2, s * 0.5, s * 0.17, 0.3, Math.PI - 0.3); g.stroke();
    },
    city: (g, s) => SK.building(g, s * 0.52, s * 0.88, s * 0.7, { seed: 3 }),
    calendar: (g, s) => {
      SK.rect(g, s * 0.16, s * 0.22, s * 0.68, s * 0.62, { fill: '#fffaf0', w: s * 0.05, seed: 3 });
      SK.rect(g, s * 0.16, s * 0.22, s * 0.68, s * 0.17, { fill: '#d84b3c', w: s * 0.05, seed: 4 });
      SK.line(g, s * 0.32, s * 0.12, s * 0.32, s * 0.3, { w: s * 0.06, passes: 1 });
      SK.line(g, s * 0.68, s * 0.12, s * 0.68, s * 0.3, { w: s * 0.06, passes: 1 });
    },
    menu: (g, s) => { for (let i = 0; i < 3; i++) SK.line(g, s * 0.2, s * (0.3 + i * 0.2), s * 0.8, s * (0.3 + i * 0.2), { w: s * 0.08, seed: i }); },
    infantry: (g, s) => { SK.stick(g, s * 0.5, s * 0.94, s * 0.82, { gun: true, helmet: '#6b7a3a', seed: 5 }); },
    tank: (g, s) => SK.tank(g, s * 0.45, s * 0.8, s * 0.4, { seed: 6 }),
    artillery: (g, s) => SK.cannon(g, s * 0.45, s * 0.85, s * 0.45, { seed: 7 }),
    jet: (g, s) => SK.jet(g, s * 0.5, s * 0.5, s * 0.4, { seed: 8 }),
    factory: (g, s) => {
      SK.rect(g, s * 0.15, s * 0.5, s * 0.7, s * 0.38, { fill: '#c9a27a', w: s * 0.05, seed: 1 });
      SK.poly(g, [[s * 0.15, s * 0.5], [s * 0.38, s * 0.36], [s * 0.38, s * 0.5], [s * 0.6, s * 0.36], [s * 0.6, s * 0.5]], { open: true, w: s * 0.05, seed: 2 });
      SK.rect(g, s * 0.66, s * 0.18, s * 0.12, s * 0.32, { fill: '#9b6b4a', w: s * 0.05, seed: 3 });
      SK.ellipse(g, s * 0.78, s * 0.1, s * 0.1, s * 0.06, { fill: '#cfcfcf', w: s * 0.03, seed: 4 });
    },
    base: (g, s) => {
      SK.poly(g, [[s * 0.12, s * 0.86], [s * 0.5, s * 0.36], [s * 0.88, s * 0.86]], { fill: '#8c9a5a', w: s * 0.05, seed: 2, hatch: { gap: s * 0.09, color: 'rgba(0,0,0,.2)' } });
      SK.flag(g, s * 0.5, s * 0.38, s * 0.22, { color: '#d84b3c', seed: 3 });
      SK.star(g, s * 0.5, s * 0.7, s * 0.09, { fill: '#fff', seed: 4 });
    },
    fort: (g, s) => {
      SK.poly(g, [[s * 0.1, s * 0.88], [s * 0.1, s * 0.35], [s * 0.25, s * 0.35], [s * 0.25, s * 0.45], [s * 0.42, s * 0.45], [s * 0.42, s * 0.35], [s * 0.58, s * 0.35], [s * 0.58, s * 0.45], [s * 0.75, s * 0.45], [s * 0.75, s * 0.35], [s * 0.9, s * 0.35], [s * 0.9, s * 0.88]], { fill: '#b5aa96', w: s * 0.05, seed: 5 });
      SK.rect(g, s * 0.42, s * 0.62, s * 0.16, s * 0.26, { fill: '#5a4630', w: s * 0.04, seed: 6 });
    },
    hospital: (g, s) => {
      SK.rect(g, s * 0.15, s * 0.25, s * 0.7, s * 0.63, { fill: '#fbf8f0', w: s * 0.05, seed: 1 });
      SK.rect(g, s * 0.43, s * 0.35, s * 0.14, s * 0.42, { fill: '#d84b3c', w: 0, seed: 2 });
      SK.rect(g, s * 0.29, s * 0.49, s * 0.42, s * 0.14, { fill: '#d84b3c', w: 0, seed: 3 });
    },
    taxman: (g, s) => {
      SK.stick(g, s * 0.36, s * 0.94, s * 0.78, { seed: 9 });
      SK.ellipse(g, s * 0.7, s * 0.66, s * 0.16, s * 0.18, { fill: '#c9a27a', w: s * 0.04, seed: 10 });
      SK.text(g, '₩', s * 0.7, s * 0.68, { size: s * 0.2 });
    },
    speech: (g, s) => {
      SK.stick(g, s * 0.5, s * 0.74, s * 0.6, { pose: 'wave', tie: '#d84b3c', seed: 2 });
      SK.poly(g, [[s * 0.28, s * 0.62], [s * 0.72, s * 0.62], [s * 0.66, s * 0.94], [s * 0.34, s * 0.94]], { fill: '#9b6b4a', w: s * 0.05, seed: 3 });
    },
    food: (g, s) => {
      SK.poly(g, [[s * 0.14, s * 0.5], [s * 0.86, s * 0.5], [s * 0.72, s * 0.84], [s * 0.28, s * 0.84]], { fill: '#e8e2d2', w: s * 0.05, seed: 1 });
      SK.ellipse(g, s * 0.5, s * 0.5, s * 0.36, s * 0.07, { fill: '#fff', w: s * 0.04, seed: 2 });
      for (let i = 0; i < 3; i++) SK.poly(g, [[s * (0.36 + i * 0.14), s * 0.4], [s * (0.33 + i * 0.14), s * 0.3], [s * (0.37 + i * 0.14), s * 0.2], [s * (0.34 + i * 0.14), s * 0.1]], { open: true, w: s * 0.03, color: '#999', seed: 3 + i });
    },
    festival: (g, s) => {
      const cs = ['#d84b3c', '#3b7dd8', '#f2c230'];
      cs.forEach((c, i) => {
        const bx = s * (0.3 + i * 0.2), by = s * (0.32 + (i % 2) * 0.1);
        SK.line(g, bx, by + s * 0.15, s * 0.5, s * 0.9, { w: s * 0.02, passes: 1, seed: i });
        SK.ellipse(g, bx, by, s * 0.12, s * 0.15, { fill: c, w: s * 0.04, seed: 5 + i });
      });
    },
    draft: (g, s) => {
      SK.stick(g, s * 0.3, s * 0.94, s * 0.62, { gun: true, helmet: '#6b7a3a', seed: 1, eyes: false });
      SK.stick(g, s * 0.55, s * 0.94, s * 0.72, { gun: true, helmet: '#6b7a3a', seed: 2, eyes: false });
      SK.stick(g, s * 0.8, s * 0.94, s * 0.6, { gun: true, helmet: '#6b7a3a', seed: 3, eyes: false });
    },
    info: (g, s) => {
      SK.rect(g, s * 0.2, s * 0.12, s * 0.6, s * 0.78, { fill: '#fffaf0', w: s * 0.05, seed: 1 });
      for (let i = 0; i < 4; i++) SK.line(g, s * 0.3, s * (0.3 + i * 0.14), s * (i === 3 ? 0.55 : 0.7), s * (0.3 + i * 0.14), { w: s * 0.04, passes: 1, seed: i + 3 });
    },
    swords: (g, s) => SK.swords(g, s / 2, s / 2, s * 0.3),
    plus: (g, s) => { SK.line(g, s * 0.5, s * 0.2, s * 0.5, s * 0.8, { w: s * 0.1 }); SK.line(g, s * 0.2, s * 0.5, s * 0.8, s * 0.5, { w: s * 0.1 }); },
    minus: (g, s) => SK.line(g, s * 0.2, s * 0.5, s * 0.8, s * 0.5, { w: s * 0.1 }),
    home: (g, s) => SK.flag(g, s * 0.3, s * 0.92, s * 0.6, { korea: true, seed: 2 }),
    globe: (g, s) => {
      SK.ellipse(g, s / 2, s / 2, s * 0.38, s * 0.38, { fill: '#6fa8d6', w: s * 0.05, seed: 1 });
      SK.poly(g, [[s * 0.3, s * 0.3], [s * 0.48, s * 0.25], [s * 0.5, s * 0.45], [s * 0.38, s * 0.6], [s * 0.28, s * 0.48]], { fill: '#9cc77a', w: s * 0.03, seed: 2 });
      SK.poly(g, [[s * 0.58, s * 0.5], [s * 0.74, s * 0.46], [s * 0.72, s * 0.68], [s * 0.6, s * 0.74]], { fill: '#9cc77a', w: s * 0.03, seed: 3 });
    },
    trash: (g, s) => {
      SK.poly(g, [[s * 0.25, s * 0.3], [s * 0.75, s * 0.3], [s * 0.68, s * 0.88], [s * 0.32, s * 0.88]], { fill: '#d9d2c2', w: s * 0.05, seed: 1 });
      SK.line(g, s * 0.18, s * 0.26, s * 0.82, s * 0.26, { w: s * 0.06 });
      SK.line(g, s * 0.42, s * 0.16, s * 0.58, s * 0.16, { w: s * 0.06 });
    },
    chicken: (g, s) => {
      SK.line(g, s * 0.55, s * 0.55, s * 0.8, s * 0.8, { w: s * 0.14, passes: 1, seed: 3 });
      SK.line(g, s * 0.55, s * 0.55, s * 0.8, s * 0.8, { w: s * 0.08, color: '#f6f0e0', passes: 1, seed: 4 });
      SK.ellipse(g, s * 0.84, s * 0.78, s * 0.06, s * 0.06, { fill: '#f6f0e0', w: s * 0.03, passes: 1, seed: 5 });
      SK.ellipse(g, s * 0.78, s * 0.85, s * 0.06, s * 0.06, { fill: '#f6f0e0', w: s * 0.03, passes: 1, seed: 6 });
      SK.ellipse(g, s * 0.4, s * 0.4, s * 0.3, s * 0.25, { fill: '#c9772f', w: s * 0.05, seed: 1 });
      g.fillStyle = 'rgba(120,60,10,.35)';
      for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(s * (0.25 + (i % 3) * 0.12), s * (0.3 + Math.floor(i / 3) * 0.08), s * 0.022, 0, 7); g.fill(); }
    },
    kpop: (g, s) => {
      SK.stick(g, s * 0.42, s * 0.95, s * 0.75, { pose: 'cheer', helmet: '#e85a9a', seed: 4, t: 1 });
      SK.line(g, s * 0.24, s * 0.36, s * 0.2, s * 0.48, { w: s * 0.06, passes: 1, seed: 5 });
      SK.ellipse(g, s * 0.25, s * 0.33, s * 0.05, s * 0.05, { fill: '#555', w: s * 0.02, passes: 1, seed: 6 });
      [[0.72, 0.3, '#8a5aa8'], [0.84, 0.5, '#3b7dd8']].forEach(([u, v, c], i) => {
        SK.ellipse(g, s * u, s * v, s * 0.06, s * 0.045, { fill: c, w: s * 0.02, passes: 1, seed: 7 + i });
        SK.line(g, s * (u + 0.05), s * v, s * (u + 0.05), s * (v - 0.2), { w: s * 0.03, color: c, passes: 1, seed: 9 + i });
      });
    },
    crate: (g, s) => {
      SK.ellipse(g, s * 0.5, s * 0.2, s * 0.32, s * 0.15, { fill: '#e8483c', w: s * 0.04, passes: 1, seed: 1 });
      [0.22, 0.4, 0.6, 0.78].forEach((u, i) => SK.line(g, s * u, s * 0.27, s * (0.4 + u * 0.2), s * 0.48, { w: s * 0.02, passes: 1, seed: 2 + i }));
      SK.rect(g, s * 0.25, s * 0.48, s * 0.5, s * 0.42, { fill: '#b5874e', w: s * 0.05, seed: 7, hatch: { gap: s * 0.08, color: 'rgba(0,0,0,.15)' } });
      SK.star(g, s * 0.5, s * 0.69, s * 0.1, { seed: 8 });
    },
    star: (g, s) => SK.star(g, s / 2, s * 0.53, s * 0.42, { seed: 2, w: s * 0.05 }),
    starOff: (g, s) => SK.star(g, s / 2, s * 0.53, s * 0.42, { seed: 2, w: s * 0.05, fill: '#d6cdbd' }),
    alarm: (g, s) => {
      SK.poly(g, [[s * 0.5, s * 0.1], [s * 0.92, s * 0.86], [s * 0.08, s * 0.86]], { fill: '#f2c230', w: s * 0.06, seed: 1 });
      SK.line(g, s * 0.5, s * 0.36, s * 0.5, s * 0.62, { w: s * 0.09, passes: 1 });
      g.fillStyle = SK.INK; g.beginPath(); g.arc(s * 0.5, s * 0.74, s * 0.05, 0, 7); g.fill();
    },
  };
  SK.icon = (name, size = 48) => {
    const k = name + size;
    if (iconCache[k]) return iconCache[k];
    const c = document.createElement('canvas');
    const dpr = 2;
    c.width = c.height = size * dpr;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    const old = SK.wobble; SK.wobble = false;
    (ICONS[name] || ICONS.info)(g, size);
    SK.wobble = old;
    return (iconCache[k] = c.toDataURL());
  };
  SK.img = (name, size = 28, cls = 'ico') => `<img class="${cls}" src="${SK.icon(name, 64)}" width="${size}" height="${size}" alt="">`;

  // DOM 글자 흔들기: 글자마다 살짝 다른 기울기
  SK.wob = (el, text) => {
    if (text !== undefined) el.textContent = text;
    const t = el.textContent;
    const r = SK.rng(t.length * 97 + (t.charCodeAt(0) || 1));
    el.textContent = '';
    for (const ch of t) {
      if (ch === ' ') { el.appendChild(document.createTextNode(' ')); continue; }
      const s = document.createElement('span');
      s.className = 'wl';
      s.textContent = ch;
      s.style.transform = `translateY(${((r() - 0.5) * 3).toFixed(1)}px) rotate(${((r() - 0.5) * 9).toFixed(1)}deg)`;
      el.appendChild(s);
    }
    return el;
  };
})();
