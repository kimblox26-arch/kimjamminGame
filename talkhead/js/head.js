'use strict';
/* 사실적인 머리 정중 시상 단면 렌더러
   - 절차적 질감(근육 결, 해면뼈, 지방 소엽, 피질, 점막, 연골, 머리카락) + 안쪽 그림자 음영
   - 움직이지 않는 구조는 캐시 캔버스에 한 번만 그리고, 턱·혀·입술·연구개·성대만 매 프레임 그림
   가상좌표: 머리가 왼쪽을 봄, 대략 x 200~850, y 100~1150 */
const Head = (() => {
  const lerp = (a, b, t) => a + (b - a) * t, cl = (x, a, b) => x < a ? a : x > b ? b : x;
  const sst = (a, b, x) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mix = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t), 0];
  const hsh = n => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
  const FONT = "Pretendard,'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',system-ui,sans-serif";
  const AIR = '#07090d', MUC = 'rgba(214,112,122,.95)';

  const MODES = {
    boy:   { s: .9,  cr: 1.05, fx: .9,   fy: .86, lar: -10, adam: 0,  brow: 0, lip: 1,    hair: 'boy' },
    girl:  { s: .88, cr: 1.05, fx: .88,  fy: .85, lar: -12, adam: 0,  brow: 0, lip: 1.12, hair: 'girl' },
    man:   { s: 1,   cr: 1,    fx: 1.03, fy: 1.05, lar: 28, adam: 1,  brow: 1, lip: .95,  hair: 'man' },
    woman: { s: .96, cr: 1,    fx: .97,  fy: .98, lar: 10,  adam: .2, brow: 0, lip: 1.15, hair: 'woman' },
  };
  const NUM = ['s', 'cr', 'fx', 'fy', 'lar', 'adam', 'brow', 'lip'];
  const M = Object.assign({}, MODES.man); let MT = MODES.man;
  const HW = { boy: 0, girl: 0, man: 1, woman: 0 };
  let X, JA = 0, TIME = 0, SC = 1;
  const PIV = [560, 478];

  function jw(p) {
    const a = -JA * (p.length > 2 ? p[2] : 0);
    if (!a) return [p[0], p[1], 0];
    const dx = p[0] - PIV[0], dy = p[1] - PIV[1], c = Math.cos(a), s = Math.sin(a);
    return [PIV[0] + dx * c - dy * s, PIV[1] + dx * s + dy * c, 0];
  }
  function W(p) {
    let x = p[0], y = p[1];
    x = 520 + (x - 520) * lerp(M.cr, M.fx, sst(330, 470, y));
    y = y < 400 ? 400 - (400 - y) * M.cr : 400 + (y - 400) * M.fy;
    y += M.lar * sst(720, 830, p[1]);
    return [520 + (x - 520) * M.s, 1040 + (y - 1040) * M.s];
  }
  const T = p => W(jw(p));

  // ---------- 절차적 질감 ----------
  const TEX = (() => {
    const N = 256; let sd = 7; const R = () => (sd = sd * 16807 % 2147483647) / 2147483647;
    const C3 = (a, b, t) => { t = cl(t, 0, 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
    function latt(px, py) {
      const g = new Float32Array(px * py); for (let i = 0; i < g.length; i++) g[i] = R();
      return (x, y) => {
        const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        const x0 = (xi % px + px) % px, x1 = (x0 + 1) % px, y0 = (yi % py + py) % py, y1 = (y0 + 1) % py;
        const a = g[y0 * px + x0], b = g[y0 * px + x1], c = g[y1 * px + x0], d = g[y1 * px + x1];
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
      };
    }
    function fbm(px, py, oct) {
      const L = []; let n = 0;
      for (let o = 0; o < oct; o++) { const w = Math.pow(.5, o); L.push([latt(px << o, py << o), px << o, py << o, w]); n += w; }
      return (x, y) => { let s = 0; for (const [f, a, b, w] of L) s += f(x / N * a, y / N * b) * w; return s / n; };
    }
    function worley(g) {
      const P = []; for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) P.push([(i + R()) / g * N, (j + R()) / g * N]);
      return (x, y) => {
        const ci = Math.floor(x / N * g), cj = Math.floor(y / N * g); let f1 = 1e9, f2 = 1e9;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const p = P[((cj + dj + g) % g) * g + (ci + di + g) % g];
          let dx = p[0] - x, dy = p[1] - y;
          if (dx > N / 2) dx -= N; else if (dx < -N / 2) dx += N;
          if (dy > N / 2) dy -= N; else if (dy < -N / 2) dy += N;
          const d = dx * dx + dy * dy; if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
        }
        return [Math.sqrt(f1), Math.sqrt(f2)];
      };
    }
    function make(fn) {
      const c = document.createElement('canvas'); c.width = c.height = N;
      const x = c.getContext('2d'), im = x.createImageData(N, N), d = im.data;
      for (let y = 0; y < N; y++) for (let i = 0; i < N; i++) { const v = fn(i, y), k = (y * N + i) * 4; d[k] = v[0]; d[k + 1] = v[1]; d[k + 2] = v[2]; d[k + 3] = 255; }
      x.putImageData(im, 0, 0); return c;
    }
    const fib = fbm(3, 48, 4), fine = fbm(16, 16, 3), soft = fbm(6, 6, 4), strand = fbm(2, 64, 4), wm = fbm(4, 24, 3), w1 = worley(9), w2 = worley(20);
    return {
      muscle: make((x, y) => { const c = C3([104, 18, 28], [192, 62, 66], fib(x, y) * 1.6 - .3), k = .86 + fine(x, y) * .28; return [c[0] * k, c[1] * k, c[2] * k]; }),
      fat: make((x, y) => { const [a, b] = w1(x, y), n = fine(x, y); return b - a < 2.2 ? C3([190, 132, 86], [212, 156, 100], n) : C3([248, 218, 146], [222, 176, 98], a / 24 + n * .35); }),
      bone: make((x, y) => { const [a, b] = w2(x, y); return C3([240, 229, 202], C3([176, 132, 98], [206, 172, 130], soft(x, y)), (b - a - 1.1) / 2.4); }),
      cortex: make((x, y) => C3([190, 128, 120], [234, 186, 174], soft(x, y) * 1.4 - .2)),
      white: make((x, y) => C3([222, 206, 190], [250, 243, 233], wm(x, y) * 1.5 - .25)),
      mucosa: make((x, y) => C3([176, 70, 82], [234, 138, 142], fine(x, y) * 1.5 - .25)),
      cart: make((x, y) => C3([178, 198, 208], [234, 242, 246], fine(x, y) * 1.5 - .25)),
      hair: make((x, y) => C3([20, 12, 9], [100, 68, 48], Math.pow(strand(x, y), 1.6) * 1.7)),
    };
  })();
  const PAT = new WeakMap();
  function pat(n, deg = 0, s = .55) {
    let m = PAT.get(X); if (!m) PAT.set(X, m = {});
    const p = m[n] || (m[n] = X.createPattern(TEX[n], 'repeat'));
    p.setTransform(new DOMMatrix().rotateSelf(deg).scaleSelf(s)); return p;
  }

  // ---------- 경로·음영 도우미 ----------
  function spl(p, q, closed) {
    const n = q.length, g = i => closed ? q[(i + n) % n] : q[cl(i, 0, n - 1)];
    p.moveTo(q[0][0], q[0][1]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = g(i - 1), b = g(i), c = g(i + 1), d = g(i + 2);
      p.bezierCurveTo(b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6, c[0] - (d[0] - b[0]) / 6, c[1] - (d[1] - b[1]) / 6, c[0], c[1]);
    }
    if (closed) p.closePath();
  }
  const PS = (pts, closed = true) => { const p = new Path2D(); spl(p, pts.map(T), closed); return p; };
  const PL = (pts, closed = true) => { const p = new Path2D(); pts.forEach((a, i) => { const q = T(a); i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1]); }); if (closed) p.closePath(); return p; };
  const EL = (c, rx, ry, rot = 0) => { const q = T(c), p = new Path2D(); p.ellipse(q[0], q[1], rx * M.s, ry * M.s, rot, 0, 7); return p; };
  const fill = (p, c) => { X.fillStyle = c; X.fill(p); };
  const strk = (p, c, w) => { X.strokeStyle = c; X.lineWidth = w; X.stroke(p); };
  const clipDo = (p, fn) => { X.save(); X.clip(p); fn(); X.restore(); };
  function inset(p, b = 9, a = .45, oy = 1.5) { // 안쪽 그림자 → 입체감
    clipDo(p, () => {
      const h = new Path2D(); h.rect(-3000, -3000, 7000, 7000); h.addPath(p);
      X.shadowColor = `rgba(12,0,2,${a})`; X.shadowBlur = b * SC; X.shadowOffsetY = oy * SC; X.fillStyle = '#000'; X.fill(h, 'evenodd');
    });
  }
  function shade(p, a, b, la = .14, da = .3) {
    const A = W(a), B = W(b), g = X.createLinearGradient(A[0], A[1], B[0], B[1]);
    g.addColorStop(0, `rgba(255,248,240,${la})`); g.addColorStop(.55, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(25,0,0,${da})`); fill(p, g);
  }
  function tissue(p, tex, o = {}) {
    fill(p, pat(tex, o.deg || 0, o.s || .55));
    if (o.tint) fill(p, o.tint);
    if (o.a) shade(p, o.a, o.b, o.la, o.da);
    if (o.ins !== 0) inset(p, o.ins || 8, o.ia ?? .45);
    if (o.line) strk(p, o.line, o.lw || .8);
  }
  function bone(p, a, b, rim = 2.6) { // 해면뼈 + 치밀뼈 테두리
    tissue(p, 'bone', { a, b, ins: 6, ia: .3 });
    clipDo(p, () => strk(p, '#f3eada', rim * 2));
    strk(p, 'rgba(110,90,62,.85)', .8);
  }
  const cart = p => tissue(p, 'cart', { ins: 4, ia: .35, line: 'rgba(225,238,246,.8)' });
  const muscle = (p, deg, a, b) => tissue(p, 'muscle', { deg, a, b, ins: 7, ia: .5, line: 'rgba(80,10,18,.6)' });
  function resample(a, n) {
    const c = [0]; for (let i = 1; i < a.length; i++) c.push(c[i - 1] + Math.hypot(a[i][0] - a[i - 1][0], a[i][1] - a[i - 1][1]));
    const o = []; for (let k = 0; k < n; k++) {
      const d = c[c.length - 1] * k / (n - 1); let i = 1; while (i < a.length - 1 && c[i] < d) i++;
      o.push(mix(a[i - 1], a[i], (d - c[i - 1]) / (c[i] - c[i - 1] || 1)));
    }
    return o;
  }
  const cum = p => { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return c; };
  function along(p, c, d) {
    if (d <= 0) return [p[0][0], p[0][1], 1, 0];
    for (let i = 1; i < p.length; i++) if (d <= c[i]) { const t = (d - c[i - 1]) / (c[i] - c[i - 1] || 1); return [lerp(p[i - 1][0], p[i][0], t), lerp(p[i - 1][1], p[i][1], t), p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]]; }
    return null;
  }
  const yAt = (a, x) => {
    if (x <= a[0][0]) return a[0][1];
    for (let i = 1; i < a.length; i++) if (x <= a[i][0]) return lerp(a[i - 1][1], a[i][1], (x - a[i - 1][0]) / (a[i][0] - a[i - 1][0]));
    return a[a.length - 1][1];
  };
  let seed = 11; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;

  // ---------- 해부 구조 (정중 시상 단면) ----------
  const SKA = [[770, 1150], [752, 880], [740, 735], [764, 632], [798, 490], [799, 345], [746, 205], [622, 117], [490, 101], [367, 135], [293, 226], [270, 320], [262, 368], [276, 402], [252, 460], [206, 524], [214, 548], [249, 561]];
  const SKB = [[258, 655, 1], [249, 700, 1], [272, 756, 1], [340, 784, .9], [402, 798, .55], [426, 826, .2], [428, 866, 0], [440, 960, 0], [446, 1150, 0]];
  const CR = [[284, 398], [275, 362], [283, 300], [305, 236], [372, 152], [490, 117], [616, 131], [726, 211], [773, 335], [769, 470], [738, 545], [693, 575], [652, 562], [612, 548], [577, 520], [546, 498], [520, 470], [470, 442], [400, 432], [330, 424], [298, 414]];
  const CRI = CR.map(p => [515 + (p[0] - 515) * .935, 330 + (p[1] - 330) * .935]);
  const SB = [[298, 414], [330, 424], [400, 432], [470, 442], [520, 470], [546, 498], [577, 520], [612, 548], [600, 557], [575, 552], [552, 545], [545, 520], [515, 492], [450, 458], [360, 451], [290, 458], [280, 440]];
  // 뇌
  const CB = [[316, 408], [302, 360], [307, 302], [326, 247], [386, 172], [492, 140], [607, 153], [708, 226], [746, 334], [744, 412], [722, 428], [690, 430], [655, 424], [628, 412], [606, 396], [588, 404], [570, 420], [540, 432], [505, 440], [480, 432], [452, 428], [400, 423], [350, 416]].map((p, i) => i && i < 10 ? [520 + (p[0] - 520) * 1.03, 330 + (p[1] - 330) * 1.03] : p);
  const CCP = [[408, 350], [414, 318], [440, 296], [490, 285], [560, 288], [610, 302], [630, 324], [628, 346], [612, 356], [598, 342], [586, 320], [550, 305], [490, 304], [452, 312], [432, 330], [428, 350], [434, 366], [424, 372], [412, 366]];
  const LV = [[440, 348], [452, 318], [490, 306], [550, 307], [584, 322], [596, 342], [570, 346], [520, 340], [470, 346]];
  const FORNIX = [[600, 344], [570, 350], [520, 352], [478, 360], [455, 378], [450, 398]];
  const V3 = [[468, 382], [492, 398], [506, 428], [484, 432], [464, 402]];
  const HYP = [[470, 396], [510, 398], [530, 422], [506, 434], [478, 430]];
  const MB = [[568, 392], [612, 385], [628, 405], [620, 432], [604, 446], [572, 440], [562, 416]];
  const PONS = [[566, 440], [606, 446], [618, 472], [614, 502], [592, 514], [570, 502], [560, 470]];
  const MED = [[580, 508], [614, 502], [624, 525], [632, 552], [636, 580], [620, 580], [606, 556], [588, 532]];
  const V4 = [[616, 464], [634, 480], [620, 505]];
  const CBL = [[628, 440], [660, 428], [704, 432], [734, 450], [742, 478], [736, 510], [716, 532], [682, 548], [650, 542], [634, 522], [626, 500], [636, 480], [624, 462]];
  const TENT = [[744, 430], [700, 434], [656, 428], [628, 440]];
  const SULCI = [
    [[405, 398], [392, 352], [402, 302], [440, 264], [510, 250], [582, 254], [632, 270], [652, 248], [660, 196]],
    [[404, 352], [410, 316], [440, 292], [490, 280], [560, 283], [612, 298], [634, 324]],
    [[640, 350], [664, 300], [690, 252], [714, 226]], [[630, 394], [668, 392], [706, 400], [742, 396]],
    [[522, 252], [516, 206], [530, 160]], [[568, 150], [574, 178]], [[330, 404], [380, 410], [440, 418]],
    [[318, 330], [345, 300], [362, 270], [372, 236]], [[340, 372], [360, 350], [378, 330]], [[400, 190], [430, 214], [452, 196], [470, 168]],
    [[600, 186], [612, 220], [602, 244]], [[676, 330], [700, 352], [726, 348]], [[662, 410], [700, 416]],
  ];
  { // 이랑: 바깥 윤곽과 나란한 고랑 + 그 사이를 잇는 짧은 고랑
    const ARC = resample(CB.slice(0, 11), 70), C0 = [525, 335];
    const at = (p, s, w = 0) => { const x = C0[0] + (p[0] - C0[0]) * s, y = C0[1] + (p[1] - C0[1]) * s, dx = x - C0[0], dy = y - C0[1], L = Math.hypot(dx, dy); return [x + dx / L * w, y + dy / L * w]; };
    for (const s of [.9, .79, .69]) {
      const ph = rnd() * 6, pts = ARC.map((p, i) => at(p, s, Math.sin(i * .55 + ph) * 4));
      for (let i = 1; i < pts.length - 3;) { const n = 5 + Math.floor(rnd() * 5); SULCI.push(pts.slice(i, Math.min(pts.length - 1, i + n + 1))); i += n + 2; }
    }
    for (let i = 0; i < 22; i++) {
      const j = 3 + Math.floor(i / 22 * 64 + rnd() * 2), s0 = .99 - rnd() * .12, s1 = s0 - .1 - rnd() * .06;
      const a = at(ARC[j], s0), b = at(ARC[j + 1], s1); SULCI.push([a, mix(a, b, .5), b]);
    }
  }
  const ARBOR = [];
  (function br(x, y, a, len, w, d) {
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; ARBOR.push([[x, y], [(x + x2) / 2 + Math.sin(a) * 2, (y + y2) / 2 - Math.cos(a) * 2], [x2, y2], w]);
    if (d) for (const da of [-.5, 0, .5]) br(x2, y2, a + da + (rnd() - .5) * .3, len * .6, w * .58, d - 1);
  })(632, 484, 0, 6, 8, 0);
  for (const a of [-1.5, -.9, -.3, .3, .9, 1.45]) (function br(x, y, a, len, w, d) {
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len; ARBOR.push([[x, y], [(x + x2) / 2, (y + y2) / 2], [x2, y2], w]);
    if (d) for (const da of [-.45, .1, .5]) br(x2, y2, a + da + (rnd() - .5) * .3, len * .62, w * .55, d - 1);
  })(638, 484, a, a > 1 || a < -1 ? 22 : 30, 6, 2);
  // 코·입천장·인두
  const NAS = [[227, 549], [238, 522], [258, 482], [290, 458], [360, 451], [450, 458], [515, 492], [545, 520], [552, 545], [520, 550], [470, 546], [380, 542], [300, 544], [250, 553]];
  const CONCHA = [
    [[300, 532], [330, 520], [400, 517], [455, 524], [472, 535], [440, 539], [380, 535], [320, 541]],
    [[330, 500], [370, 490], [430, 489], [475, 500], [482, 511], [450, 509], [380, 505]],
    [[400, 474], [440, 469], [480, 478], [492, 489], [460, 486], [420, 482]],
  ];
  const PAL = [[246, 553], [300, 544], [380, 542], [470, 546], [478, 551], [470, 557], [420, 553], [360, 554], [320, 561], [289, 573], [280, 582], [262, 578], [254, 566]];
  const ROOF = [[262, 604], [274, 590], [289, 573], [320, 561], [360, 554], [420, 553], [470, 557], [500, 553]];
  const TCLIP = [[150, 1150], [150, 606], [262, 606], [274, 590], [289, 573], [320, 561], [360, 554], [420, 553], [470, 557], [480, 540], [600, 540], [600, 1150]];
  const PHX = [[470, 557], [505, 548], [530, 532], [545, 520], [552, 545], [556, 600], [557, 650], [554, 750], [549, 838], [537, 862], [524, 866], [518, 900], [518, 1150], [464, 1150], [462, 900], [458, 875], [456, 866], [466, 846], [480, 836], [478, 800], [472, 770], [482, 720], [492, 660], [488, 600], [478, 570]];
  const PWALL = [[545, 520], [552, 545], [556, 600], [557, 650], [554, 750], [549, 838], [537, 862]];
  const PREV = [[552, 545], [572, 548], [600, 557], [580, 575], [576, 1150], [553, 1150], [551, 880], [555, 750], [558, 650], [557, 600]];
  const ESO = [[521, 876], [550, 872], [553, 1150], [521, 1150]];
  // 목
  const NM = [[656, 566], [693, 577], [738, 548], [770, 512], [790, 500], [782, 560], [768, 600], [757, 632], [742, 680], [730, 735], [734, 800], [742, 880], [750, 1000], [758, 1150], [656, 1150]];
  const VB = [[660, 705], [717, 762], [774, 819], [831, 876], [888, 933], [945, 992], [1004, 1050], [1062, 1108], [1120, 1166]];
  const C2 = [[598, 552], [611, 550], [617, 568], [624, 588], [625, 650], [579, 652], [576, 610], [586, 590], [594, 572]];
  const STRAP = [[454, 792], [468, 790], [460, 850], [462, 900], [466, 1150], [452, 1150], [446, 900], [444, 850]];
  const CRIC = [[514, 870], [528, 866], [531, 924], [516, 926]], ARY = [[512, 846], [524, 842], [529, 866], [514, 869]];
  const VENT = [[460, 848], [512, 851], [512, 857], [460, 855]], VENTR = [[462, 857], [510, 858], [510, 862], [462, 861]];
  // 턱·치아 (1 = 턱과 함께 움직임)
  const SYM = [[262, 628], [256, 665], [258, 705], [268, 738], [290, 754], [318, 752], [324, 734], [314, 706], [300, 680], [292, 654], [290, 630]].map(p => [p[0], p[1], 1]);
  const UI = [[259, 606], [252, 590], [252, 574], [257, 558], [266, 549], [274, 551], [280, 563], [281, 576], [277, 590], [268, 601]];
  const UIP = [[265, 590], [268, 575], [272, 557], [274, 554], [275, 560], [272, 577], [269, 591]];
  const LI = [[274, 597], [268, 610], [266, 625], [268, 645], [273, 662], [278, 664], [284, 648], [287, 628], [284, 610], [280, 598]].map(p => [p[0], p[1], 1]);
  const LIP = [[276, 612], [276, 632], [276, 655], [278, 657], [279, 632], [279, 613]].map(p => [p[0], p[1], 1]);
  const EPI = [[480, 838], [484, 800], [494, 770], [505, 750], [512, 754], [503, 790], [492, 838]];
  const FLOOR = [[[318, 734, 1], [470, 768, .35], [468, 780, .35], [320, 748, 1]], [[306, 746, 1], [464, 786, .35], [460, 795, .35], [304, 756, 1]], [[302, 752, 1], [428, 800, .3], [426, 808, .3], [300, 760, 1]]];
  // 머리카락
  const HIN = [[292, 232], [367, 135], [490, 101], [622, 117], [746, 205], [799, 345], [798, 490], [764, 632]];
  const HD = []; for (let i = 0; i < HIN.length - 1; i++) for (let k = 0; k < 4; k++) HD.push(mix(HIN[i], HIN[i + 1], k / 4)); HD.push([764, 632, 0]);
  const radial = (p, t) => { const dx = p[0] - 520, dy = p[1] - 430, L = Math.hypot(dx, dy); return [p[0] + dx / L * t, p[1] + dy / L * t, 0]; };
  function cap(th, spike, end) {
    const m = Math.round((HD.length - 1) * end), inn = HD.slice(0, m + 1);
    return { out: inn.map((p, i) => radial(p, th * Math.pow(Math.sin(Math.PI * i / m), .5) * (spike && i % 2 ? 1.5 : 1))), inn: inn.map(p => radial(p, -3)) };
  }
  const CAPS = { boy: cap(24, true, 1), man: cap(15, false, .93), woman: cap(20, false, 1), girl: cap(22, false, 1) };
  const LONGH = { out: resample([[622, 112], [760, 190], [826, 330], [846, 560], [852, 800], [828, 990], [790, 1010]], 16), inn: resample([[622, 112], [746, 205], [799, 345], [798, 490], [766, 632], [752, 740], [768, 900], [790, 1010]], 16) };
  const PONY = { out: resample([[792, 300], [838, 296], [878, 370], [890, 480], [868, 600], [846, 640]], 12), inn: resample([[792, 300], [808, 340], [840, 410], [852, 520], [846, 640]], 12) };
  const BANGS = [[292, 232], [303, 210], [336, 190], [322, 238], [303, 282], [284, 302], [279, 262]];
  const CHIN = [[258, 655], [249, 700], [272, 756], [340, 784], [402, 798]];
  const STUB = [];
  for (let i = 0; i < 160; i++) {
    const s = rnd() * (CHIN.length - 1.001), k = Math.floor(s), f = s - k, a = CHIN[k], b = CHIN[k + 1];
    const tx = b[0] - a[0], ty = b[1] - a[1], L = Math.hypot(tx, ty), dep = 1 + rnd() * 6;
    STUB.push([lerp(a[0], b[0], f) + ty / L * dep, lerp(a[1], b[1], f) - tx / L * dep, 1]);
  }
  // 신경·뇌 활동
  const NV = {
    read: [[712, 385], [690, 350], [650, 320], [600, 280], [520, 262], [440, 300], [380, 370], [372, 390]],
    tongue: [[505, 170], [545, 300], [585, 420], [612, 520], [598, 585], [565, 650], [520, 705], [470, 725], [420, 690]],
    lips: [[505, 170], [545, 300], [585, 420], [600, 480], [580, 530], [520, 566], [400, 600], [300, 640], [255, 620]],
    jaw: [[505, 170], [545, 300], [585, 420], [598, 470], [570, 520], [540, 600]],
    voice: [[505, 170], [545, 300], [585, 420], [612, 520], [612, 600], [590, 700], [548, 800], [500, 866]],
  };
  const NVC = { read: '120,210,255', tongue: '255,150,150', lips: '255,190,110', jaw: '255,230,120', voice: '150,255,180' };
  const AREA = { broca: [372, 392, '255,140,40'], motor: [505, 175, '255,210,60'], wern: [650, 322, '255,120,60'], aud: [585, 255, '255,170,70'], vis: [712, 388, '255,190,90'] };

  // ---------- 움직이는 구조 ----------
  function lips(S) {
    const r = S.lr, sp = S.ls, c = S.lc, d = S.ld, L = M.lip - 1;
    const ulF = [236 - 14 * r + 6 * sp - L * 10, 589 + 2 * r + c * 1.5, 0];
    const ulS = [247 - 9 * r + 4 * sp, 605 + 3 * c - d * 2, 0];
    let llS = jw([248, 612, 1]), llF = jw([237, 631, 1]);
    llS = [llS[0] - 9 * r + 4 * sp, llS[1]]; llF = [llF[0] - 13 * r - L * 10, llF[1]];
    llS = mix(llS, [ulS[0] + 1, ulS[1] + 2], c); llF = mix(llF, [llF[0], Math.min(llF[1], ulS[1] + 24)], c);
    llS = mix(llS, [265, 603], d); llF = mix(llF, [250, 622], d);
    return { ulF, ulS, llS, llF };
  }
  function tongue(S) {
    const tip = mix(jw([292, 617, 1]), [S.tipX, S.tipY], S.tipA);
    const jd = jw([S.bodyX, S.bodyY, 1]);
    const body = [lerp(S.bodyX, jd[0], .3), lerp(S.bodyY, jd[1], .3)];
    const blade = [lerp(tip[0], body[0], .45), lerp(tip[1], body[1], .55) + 5 * (1 - S.tipA * .5)];
    const fb = cl((body[0] - 348) / 104, 0, 1), low = cl((body[1] - 590) / 50, 0, 1);
    const back = mix([lerp(445, 488, fb), body[1] + 18 + 10 * low], [478, 566], S.back);
    const rx = 486 + 30 * fb + 22 * low;
    const u0 = [tip, blade, body, back, [rx, Math.max(645, back[1] + 18)], jw([rx - 6, 712, .3])], up = [tip];
    for (let i = 1; i < u0.length; i++) {
      const a = u0[i - 1], b = u0[i], k = i === 1 ? .06 : .13;
      up.push([(a[0] + b[0]) / 2 + (b[1] - a[1]) * k, (a[1] + b[1]) / 2 - (b[0] - a[0]) * k], b);
    }
    for (const p of up.slice(1, 8)) p[1] = Math.max(p[1], yAt(ROOF, p[0]) + 1.5);
    const under = [jw([470, 770, .4]), jw([430, 750, .7]), jw([360, 730, 1]), jw([314, 704, 1]), jw([296, 666, 1]), mix(jw([298, 634, 1]), [tip[0] + 6, tip[1] + 14], S.tipA)];
    return { up: up.map(p => [p[0], p[1], 0]), all: [...up, ...under].map(p => [p[0], p[1], 0]), body: [body[0], body[1], 0] };
  }
  function velum(S) {
    const v = S.vel, E = mix([546, 551], [508, 616], v), Mi = mix([510, 543], [492, 586], v);
    return [[470, 545, 0], [Mi[0] + 3, Mi[1] - 8, 0], [E[0] + 2, E[1] - 4, 0], [E[0] - 3, E[1] + 5, 0], [Mi[0] - 5, Mi[1] + 9, 0], [468, 559, 0]];
  }
  const oralPoly = L => [L.ulS, [259, 606], [268, 600], [276, 588], [289, 573], [320, 561], [360, 554], [420, 553], [470, 557], [505, 550], [530, 560], [532, 650], [528, 720], [512, 760], [496, 800], [482, 836], [470, 790, .3], [430, 752, .7], [360, 732, 1], [314, 704, 1], [296, 666, 1], [290, 640, 1], [285, 614, 1], [277, 599, 1], L.llS];

  // ---------- 효과 상태 ----------
  const parts = [], rings = [], notes = [], pulses = [], lastPulse = {};
  const act = { broca: 0, motor: 0, wern: 0, aud: 0, vis: 0 };
  let accO = 0, accN = 0, accR = 0, accM = 0, AP = null, CPATH = null;

  function airPaths(L, TG) {
    const u = TG.up;
    const ty = x => { for (let i = 1; i < 7; i++) if (x <= u[i][0]) return lerp(u[i - 1][1], u[i][1], cl((x - u[i - 1][0]) / (u[i][0] - u[i - 1][0] || 1), 0, 1)); return u[6][1]; };
    const oy = x => { const r = yAt(ROOF, x); return (r + Math.min(ty(x), r + 60)) / 2; };
    const lm = [(L.ulS[0] + L.llS[0]) / 2, (L.ulS[1] + L.llS[1]) / 2];
    const G = [[490, 866], [520, 830], [533, 760], [531, 690], [524, 630]];
    const o = [...G, ...[470, 420, 370, 320, 290].map(x => [x, oy(x)]), lm, [150, lm[1] + 4]].map(W);
    const n = [...G.slice(0, 4), [536, 600], [536, 540], [522, 512], [470, 513], [380, 511], [300, 512], [252, 532], [228, 549], [150, 562]].map(W);
    return { o, n, oc: cum(o), nc: cum(n) };
  }
  const closeIdx = p => p.lab ? 10 : p.tip ? 9 : p.back ? 5 : -1;
  function spawn(k, fr, inh, d0, v0) {
    if (parts.length > 360) return;
    const tot = (k === 'o' ? AP.oc : AP.nc).at(-1);
    parts.push({ k, d: d0 ?? (inh ? tot : 0), v: v0 ?? (inh ? -1 : 1) * (k === 'n' ? 150 : 230) * (.8 + Math.random() * .5), j: (Math.random() - .5) * 10, fr });
  }
  function step(dt, S, I, L, TG) {
    for (const k in act) act[k] *= Math.exp(-dt * 1.6);
    if (I.active) act.aud = Math.max(act.aud, S.voice * .6);
    AP = airPaths(L, TG);
    const p = I.p || {}, ci = S.cl > .5 ? closeIdx(p) : -1;
    AP.clD = ci >= 0 ? AP.oc[ci] : Infinity;
    let rO, rN, inh = false;
    if (I.active && !p.rest) { rO = (.35 + S.voice * .4 + S.fric * 1.4) * 60; rN = S.vel * 45; }
    else { const br = Math.sin(TIME * 2 * Math.PI / 4.8); rO = I.active ? 6 : 0; rN = Math.abs(br) * 22 * S.vel; inh = br < 0 && !I.active; }
    if (!I.air) rO = rN = 0;
    accO += rO * dt; accN += rN * dt;
    while (accO >= 1) { accO--; spawn('o', S.fric > .4, false); }
    while (accN >= 1) { accN--; spawn('n', false, inh); }
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i]; q.d += q.v * dt;
      if (q.k === 'o' && q.v > 0 && q.d > AP.clD - 6) { q.d = AP.clD - 6 - Math.random() * 10; q.v = 40; q.held = 1; }
      else if (q.held && AP.clD === Infinity) { q.held = 0; q.v = 520 + Math.random() * 220; q.fr = true; }
      if (q.d > (q.k === 'o' ? AP.oc : AP.nc).at(-1) || q.d < 0) parts.splice(i, 1);
    }
    if (I.active && S.voice > .5 && S.cl < .5 && S.lc < .5) { accR += dt; if (accR > .12) { accR = 0; rings.push({ r: 4, a: .5 }); } }
    for (let i = rings.length - 1; i >= 0; i--) { rings[i].r += 170 * dt; rings[i].a -= dt * .9; if (rings[i].a <= 0) rings.splice(i, 1); }
    if (I.sing && I.active) {
      accM += dt;
      if (accM > .42) { accM = 0; const lm = AP.o[10]; notes.push({ x: lm[0] - 10, y: lm[1] - 10, vx: -40 - Math.random() * 30, vy: -50 - Math.random() * 30, a: 1, c: Math.random() < .5 ? '♪' : '♫' }); }
    }
    for (let i = notes.length - 1; i >= 0; i--) { const n = notes[i]; n.x += n.vx * dt; n.y += n.vy * dt; n.a -= dt * .45; if (n.a <= 0) notes.splice(i, 1); }
    for (let i = pulses.length - 1; i >= 0; i--) { pulses[i].d += 950 * dt; if (pulses[i].d > 2000) pulses.splice(i, 1); }
  }
  function pulse(k) { if (TIME - (lastPulse[k] || -1) < .08) return; lastPulse[k] = TIME; pulses.push({ k, d: 0 }); }

  // ---------- 고정 구조 그리기 (캐시) ----------
  function hairShape(o, a, b, n = 30) {
    const p = PS([...o.out, ...o.inn.slice().reverse()]);
    tissue(p, 'hair', { s: .5, a, b, la: .16, da: .45, ins: 7, ia: .65 });
    clipDo(p, () => {
      for (let i = 0; i < n; i++) {
        const t = (i + .5) / n, pts = o.out.map((q, j) => mix(q, o.inn[j], cl(t + (hsh(i * 31 + j) - .5) * .1, 0, 1)));
        strk(PS(pts, false), i % 3 ? 'rgba(140,100,72,.22)' : 'rgba(8,4,2,.4)', .9);
      }
    });
  }
  function background(w, h) {
    const g = X.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#12161d'); g.addColorStop(1, '#0a0c10');
    X.fillStyle = g; X.fillRect(0, 0, w, h);
  }
  function staticBack() { // 머리 뒤(머리카락) + 은은한 조명
    const c = W([500, 480]), g = X.createRadialGradient(c[0], c[1], 40, c[0], c[1], 620 * M.s);
    g.addColorStop(0, 'rgba(120,140,170,.16)'); g.addColorStop(1, 'rgba(120,140,170,0)'); X.fillStyle = g; X.fillRect(-500, -500, 2500, 2500);
    if (HW.woman > .02) { X.globalAlpha = HW.woman; hairShape(LONGH, [760, 200], [840, 1000], 40); }
    if (HW.girl > .02) { X.globalAlpha = HW.girl; hairShape(PONY, [800, 300], [880, 640], 24); }
    X.globalAlpha = 1;
  }
  function staticFront() {
    // 인두·후두·기관 공기
    const phx = PL(PHX); fill(phx, AIR); inset(phx, 10, .7);
    // 목 뒤 근육
    muscle(PL(NM), 84, [660, 560], [770, 1000]);
    for (const f of [[[700, 590], [720, 700], [715, 800], [720, 900], [730, 1150]], [[742, 575], [748, 640], [728, 740], [732, 880], [742, 1150]], [[680, 620], [690, 760], [688, 1150]]]) strk(PS(f, false), 'rgba(255,225,205,.22)', 1.3);
    // 척추관: 경막·뇌척수액·척수
    fill(PL([[626, 556], [656, 560], [656, 1150], [626, 1150]]), '#1d2633');
    strk(PL([[626, 556], [626, 1150]], false), 'rgba(235,238,242,.75)', 1.4); strk(PL([[656, 560], [656, 1150]], false), 'rgba(235,238,242,.75)', 1.4);
    tissue(PS([[631, 552], [645, 552], [648, 700], [649, 1150], [633, 1150], [632, 700]]), 'white', { deg: 90, s: .45, a: [630, 700], b: [650, 700], la: .2, da: .3, ins: 4, ia: .3 });
    // 인두 뒤 근육·점막·아데노이드
    muscle(PL(PREV), 88, [552, 600], [580, 600]);
    strk(PS(PWALL, false), MUC, 5);
    tissue(EL([541, 528], 13, 9, .6), 'mucosa', { tint: 'rgba(120,40,60,.25)', ins: 5 });
    // 척추뼈
    bone(PS(C2), [580, 560], [625, 650]); bone(EL([585, 572], 9, 9), [576, 563], [594, 581]); bone(EL([690, 582], 14, 9), [676, 573], [704, 591]);
    bone(PS([[656, 602], [700, 610], [716, 626], [712, 648], [660, 650]]), [656, 602], [716, 650]);
    let prev = 652;
    VB.forEach(([y0, y1], i) => {
      const d = PL([[577, prev + 1], [625, prev + 2], [625, y0 - 1], [577, y0 - 1]]); fill(d, '#cfd5d8'); fill(EL([601, (prev + y0) / 2], 12, 2.5), 'rgba(140,160,175,.8)'); inset(d, 3, .3);
      bone(PS([[579, y0], [621, y0 + 2], [625, y0 + 8], [625, y1 - 6], [621, y1], [579, y1 + 2], [575, y1 - 5], [575, y0 + 5]]), [575, y0], [625, y1]);
      const ex = i === 4 ? 18 : 0;
      bone(PS([[656, y0 + 4], [704, y0 + 16], [714 + ex, y0 + 30], [702, y0 + 42], [656, y0 + 44]]), [656, y0], [714, y0 + 44]);
      fill(PL([[655, prev + 6], [663, prev + 6], [663, y0 + 2], [655, y0 + 2]]), '#d8b64c');
      prev = y1 + 2;
    });
    strk(PL([[574, 560], [574, 1150]], false), 'rgba(236,232,220,.6)', 1.5); strk(PL([[626, 560], [626, 1150]], false), 'rgba(236,232,220,.5)', 1.2);
    strk(PS([[772, 522], [740, 600], [722, 700], [716, 800], [734, 900]], false), 'rgba(238,232,215,.45)', 2);
    // 식도
    muscle(PL(ESO), 90, [521, 900], [553, 900]); strk(PL([[536, 880], [537, 1150]], false), 'rgba(236,150,158,.9)', 2);
    // 앞목: 띠근육·갑상샘·후두 연골·기관
    muscle(PS(STRAP), 95, [444, 800], [468, 1100]);
    tissue(EL([453, 955], 7, 20), 'muscle', { tint: 'rgba(110,50,10,.35)', ins: 5 });
    cart(PS([[454, 806], [446 - 6 * M.adam, 828], [448, 860], [452, 896], [462, 896], [460, 860], [460, 812]]));
    cart(EL([460, 908], 6, 7)); cart(PS(CRIC)); cart(PS(ARY));
    tissue(PS(VENT), 'mucosa', { ins: 3 }); fill(PL(VENTR), '#120406');
    for (let y = 935; y < 1150; y += 21) cart(EL([466, y], 5, 7));
    strk(PL([[517, 880], [517, 1150]], false), 'rgba(170,50,62,.9)', 3);
    // 머리뼈 바닥·접형동·머리뼈
    bone(PS(SB), [300, 420], [600, 560]);
    const ss = EL([507, 476], 16, 9); fill(ss, AIR); inset(ss, 6, .8);
    const ring = new Path2D(); ring.addPath(PS(CR)); ring.addPath(PS(CRI));
    fill(ring, pat('bone')); X.save(); X.clip(ring, 'evenodd'); shade(ring, [350, 150], [750, 550], .18, .3); X.restore();
    strk(PS(CR), '#f3eada', 4.5); strk(PS(CRI), '#efe5d2', 3); strk(PS(CR), 'rgba(110,90,62,.8)', .8);
    fill(PS(CRI), '#273142'); inset(PS(CRI), 8, .6);
    brain();
    // 코안
    const nas = PS(NAS); fill(nas, AIR); inset(nas, 10, .75); strk(nas, 'rgba(206,110,120,.75)', 3);
    CONCHA.forEach(c => tissue(PS(c), 'mucosa', { a: [380, 470], b: [420, 545], ins: 5, ia: .55, line: 'rgba(90,20,30,.5)' }));
    cart(PS([[257, 460], [232, 500], [216, 524], [224, 532], [244, 508], [266, 474]]));
    strk(PS([[284, 398], [270, 430], [257, 458]], false), '#f1e6cf', 6); strk(PS([[284, 398], [270, 430], [257, 458]], false), 'rgba(110,90,62,.7)', .8);
    // 경구개
    bone(PS(PAL), [260, 540], [470, 575], 2.2);
    strk(PS(ROOF.slice(1), false), MUC, 4.5);
    for (let x = 296; x < 350; x += 12) strk(PS([[x, yAt(ROOF, x) + 1], [x + 5, yAt(ROOF, x + 5) + 3.5], [x + 10, yAt(ROOF, x + 10) + 1]], false), 'rgba(240,160,165,.8)', 1.6);
    // 머리카락
    for (const k in CAPS) {
      if (HW[k] < .02) continue;
      X.globalAlpha = HW[k]; hairShape(CAPS[k], [400, 120], [780, 600]);
      if (k === 'girl' || k === 'woman') tissue(PS(BANGS), 'hair', { deg: 60, s: .5, a: [300, 200], b: [300, 300], ins: 5, ia: .6 });
      if (k === 'girl') { const t = EL([800, 300], 10, 10); fill(t, '#e0557f'); inset(t, 4, .5); }
    }
    X.globalAlpha = 1;
    CPATH = PS(CB);
  }
  function brain() {
    const cb = PS(CB);
    tissue(cb, 'cortex', { s: .45, a: [380, 160], b: [640, 440], la: .18, da: .3, ins: 0 });
    clipDo(cb, () => {
      for (const s of SULCI) {
        const p = PS(s, false); strk(p, 'rgba(70,18,28,.14)', 11); strk(p, 'rgba(80,22,32,.22)', 6); strk(p, 'rgba(88,26,36,.75)', 2.2);
        X.save(); X.translate(-1.6, -1.8); strk(p, 'rgba(255,232,224,.3)', 2); X.restore();
      }
    });
    inset(cb, 16, .55, 2);
    tissue(PS(CCP), 'white', { a: [500, 280], b: [500, 370], ins: 4, ia: .35, line: 'rgba(150,110,100,.6)' });
    const lv = PS(LV); fill(lv, '#2b3242'); fill(lv, 'rgba(215,195,195,.14)'); inset(lv, 6, .6);
    tissue(EL([536, 372], 44, 22, -.12), 'cortex', { tint: 'rgba(110,50,50,.2)', a: [520, 350], b: [540, 395], ins: 7 });
    strk(PS(FORNIX, false), '#efe2d4', 6); strk(PS(FORNIX, false), 'rgba(255,255,255,.35)', 1.5);
    fill(PS(V3), 'rgba(40,46,62,.92)');
    tissue(PS(HYP), 'cortex', { tint: 'rgba(130,60,60,.18)', ins: 3 });
    fill(EL([452, 388], 4, 4), '#f3e9dd'); tissue(EL([470, 434], 10, 5), 'white', { ins: 2 });
    strk(PS([[492, 434], [499, 446]], false), '#d39a8f', 3);
    tissue(EL([500, 453], 11, 7), 'cortex', { tint: 'rgba(160,70,60,.25)', ins: 4 });
    tissue(EL([524, 430], 5, 5), 'white', { ins: 2 }); tissue(EL([624, 378], 7, 5), 'cortex', { tint: 'rgba(150,90,40,.25)', ins: 2 });
    for (const s of [MB, PONS, MED]) tissue(PS(s), 'white', { tint: 'rgba(214,150,138,.32)', a: [560, 400], b: [630, 560], ins: 6, ia: .4 });
    for (let i = 0; i < 4; i++) strk(PS([[566, 452 + i * 13], [592, 455 + i * 13], [612, 462 + i * 13]], false), 'rgba(160,90,80,.3)', 1);
    strk(PS([[598, 396], [606, 420], [610, 444]], false), '#2b3242', 2); fill(PL(V4), '#2b3242');
    const cbl = PS(CBL);
    tissue(cbl, 'cortex', { tint: 'rgba(110,40,50,.12)', s: .4, ins: 0 });
    clipDo(cbl, () => {
      for (let s = .92; s > .25; s -= .085) strk(PS(CBL.map(p => [688 + (p[0] - 688) * s, 490 + (p[1] - 490) * s])), 'rgba(90,28,40,.4)', 1.3);
      for (const [a, m, b, w] of ARBOR) { const p = PS([a, m, b], false); strk(p, '#f2e5d8', w); }
    });
    inset(cbl, 10, .55);
    strk(PS(TENT, false), 'rgba(232,228,232,.7)', 2);
  }

  // ---------- 움직이는 구조 그리기 ----------
  function tooth(sh, cut, pulp, a, b) {
    const p = PS(sh); fill(p, '#ecdfc3');
    clipDo(p, () => { const A = T(a), B = T(b), g = X.createLinearGradient(A[0], A[1], B[0], B[1]); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#dfe6ea'); fill(PL(cut), g); });
    fill(PS(pulp), '#d27d86'); inset(p, 4, .35); strk(p, 'rgba(110,96,76,.85)', .8);
  }
  function tongueDraw(TG) {
    const tp = PS(TG.all), up = PS(TG.up.slice(0, 9), false);
    X.save(); X.clip(PS(TCLIP));
    tissue(tp, 'muscle', { deg: -25, s: .5, ins: 0 });
    clipDo(tp, () => {
      const o = T([314, 724, 1]), u = TG.up;
      for (let i = 0; i <= 26; i++) {
        const s = i / 26 * 9.4, k = Math.min(9, Math.floor(s)), q = W(mix(u[k], u[k + 1], s - k));
        X.beginPath(); X.moveTo(o[0], o[1]); X.lineTo(q[0], q[1]); X.strokeStyle = 'rgba(70,8,18,.28)'; X.lineWidth = 1.1; X.stroke();
      }
      strk(up, 'rgba(232,132,138,.95)', 9);
      const pts = TG.up.slice(0, 9).map(W), c = cum(pts);
      for (let i = 0; i < 60; i++) { const q = along(pts, c, c.at(-1) * (i + .5) / 60); if (!q) continue; const L = Math.hypot(q[2], q[3]) || 1; X.beginPath(); X.arc(q[0] - q[3] / L * 1.5 + q[2] / L * hsh(i) * 2, q[1] + q[2] / L * 1.5, .9 * M.s, 0, 7); X.fillStyle = 'rgba(255,205,205,.45)'; X.fill(); }
      X.save(); X.translate(0, 2.2); strk(up, 'rgba(255,240,240,.28)', 1.4); X.restore();
    });
    inset(tp, 12, .55, 2);
    strk(tp, 'rgba(70,8,18,.7)', .9);
    X.restore();
  }
  function lipsDraw(L) {
    const o = (p, x, y) => [p[0] + x, p[1] + y, 0];
    tissue(PS([[252, 566, 0], [243, 579, 0], o(L.ulF, 4, 0), o(L.ulS, 3, -3), [257, 598, 0], [257, 574, 0]]), 'muscle', { deg: 75, ins: 6, ia: .5 });
    tissue(PS([o(L.llS, 3, 3), o(L.llF, 4, 0), jw([252, 648, 1]), jw([265, 642, 1]), jw([266, 614, 1])]), 'muscle', { deg: 105, ins: 6, ia: .5 });
    const up = PS([[242, 578, 0], L.ulF, L.ulS, [L.ulS[0] + 10, L.ulS[1] - 2, 0], [255, 592, 0]]);
    const lo = PS([L.llS, [L.llS[0] + 10, L.llS[1] + 2, 0], jw([258, 628, 1]), jw([246, 642, 1]), L.llF]);
    for (const p of [up, lo]) tissue(p, 'mucosa', { tint: 'rgba(150,25,45,.32)', ins: 4, ia: .4 });
    const h = T(mix(L.llF, L.llS, .4)); X.beginPath(); X.ellipse(h[0] - 1, h[1] + 2, 3 * M.s, 1.4 * M.s, -.6, 0, 7); X.fillStyle = 'rgba(255,240,240,.35)'; X.fill();
  }
  function folds(S) {
    const v = S.voice > .3 ? S.voice : 0, o = v ? Math.sin(TIME * 90) * 1.4 * v : 0;
    const f = dy => PS([[458, 862 + dy], [516, 864 + dy], [516, 873 + dy], [458, 871 + dy]]);
    if (v) { X.globalAlpha = .45; fill(f(-1.5 - o), 'rgba(250,236,232,.9)'); X.globalAlpha = 1; }
    const p = f(o * .5); tissue(p, 'mucosa', { tint: 'rgba(255,240,236,.74)', ins: 3, ia: .3 });
    if (v) { const c = T([488, 867]), g = X.createRadialGradient(c[0], c[1], 0, c[0], c[1], 26); g.addColorStop(0, `rgba(160,255,190,${.35 * v})`); g.addColorStop(1, 'rgba(160,255,190,0)'); X.fillStyle = g; X.fillRect(c[0] - 30, c[1] - 30, 60, 60); }
  }
  function activity() {
    if (!CPATH) return;
    clipDo(CPATH, () => {
      X.globalCompositeOperation = 'screen';
      for (const k in AREA) {
        const v = act[k]; if (v < .03) continue;
        const a = AREA[k], q = W(a), r = (34 + 18 * v) * M.s, g = X.createRadialGradient(q[0], q[1], 0, q[0], q[1], r);
        g.addColorStop(0, `rgba(${a[2]},${.75 * v})`); g.addColorStop(.5, `rgba(${a[2]},${.3 * v})`); g.addColorStop(1, `rgba(${a[2]},0)`);
        X.fillStyle = g; X.fillRect(q[0] - r, q[1] - r, r * 2, r * 2);
      }
      X.globalCompositeOperation = 'source-over';
    });
  }
  function effects(I) {
    if (I.nerves) {
      for (const k in NV) strk(PS(NV[k], false), k === 'read' ? 'rgba(160,215,255,.13)' : 'rgba(245,225,150,.2)', 1.6);
      for (const p of pulses) {
        const pts = NV[p.k].map(W), c = cum(pts);
        for (let t = 0; t < 4; t++) {
          const q = along(pts, c, p.d - t * 12); if (!q) continue;
          X.beginPath(); X.arc(q[0], q[1], 4.5 - t, 0, 7); X.fillStyle = `rgba(${NVC[p.k]},${.95 - t * .22})`; X.fill();
        }
      }
    }
    for (const q of parts) {
      const path = q.k === 'o' ? AP.o : AP.n, c = q.k === 'o' ? AP.oc : AP.nc, s = along(path, c, q.d); if (!s) continue;
      const fr = q.fr && q.k === 'o' && q.d > AP.oc[6];
      const L = Math.hypot(s[2], s[3]) || 1, j = q.j + (fr ? (Math.random() - .5) * 8 : 0);
      X.beginPath(); X.arc(s[0] - s[3] / L * j, s[1] + s[2] / L * j, fr ? 2 : 1.6, 0, 7);
      X.fillStyle = fr ? 'rgba(240,250,255,.8)' : q.k === 'n' ? 'rgba(150,200,255,.45)' : 'rgba(140,215,255,.55)'; X.fill();
    }
    const lm = AP.o[10];
    for (const r of rings) { X.beginPath(); X.arc(lm[0], lm[1], r.r, Math.PI * .72, Math.PI * 1.28); X.strokeStyle = `rgba(170,230,255,${r.a})`; X.lineWidth = 1.5; X.stroke(); }
    X.font = '600 28px ' + FONT; X.textAlign = 'center'; X.textBaseline = 'alphabetic';
    for (const n of notes) { X.fillStyle = `rgba(255,214,120,${n.a})`; X.fillText(n.c, n.x, n.y); }
  }
  function labels(L, TG, VL, k) {
    const z = Math.max(12.5, 10.5 / k), items = [
      ['L', '대뇌', [380, 250]], ['L', '브로카 영역', [372, 392]], ['L', '비강 (콧속)', [300, 505]], ['L', '코선반', [400, 520]],
      ['L', '경구개', [360, 547]], ['L', '입술', L.ulF], ['L', '앞니', [262, 588]], ['L', '혀', TG.body], ['L', '아래턱뼈', [290, 735, 1]],
      ['L', '설골', [478, 776, .35]], ['L', '갑상연골', [450, 850]], ['L', '기관 (숨길)', [466, 1010]],
      ['R', '운동 피질', [505, 175]], ['R', '두개골', [730, 230]], ['R', '뇌량', [560, 292]], ['R', '시상', [540, 372]], ['R', '소뇌', [700, 492]],
      ['R', '뇌하수체', [500, 453]], ['R', '뇌간', [592, 478]], ['R', '연구개', VL[2]], ['R', '인두 (목구멍)', [540, 690]], ['R', '후두개', [506, 758]],
      ['R', '성대', [505, 868]], ['R', '척수', [641, 760]], ['R', '척추뼈', [600, 800]], ['R', '목 근육', [720, 840]], ['R', '식도', [536, 1040]]];
    X.font = `600 ${z}px ${FONT}`; X.textBaseline = 'middle';
    for (const side of ['L', 'R']) {
      const g = items.filter(i => i[0] === side).map(i => ({ t: i[1], a: T(i[2]) })).sort((a, b) => a.a[1] - b.a[1]);
      let y = -1e9;
      for (const it of g) {
        y = Math.max(it.a[1], y + z * 1.45);
        const x = side === 'L' ? 196 : 866, ex = side === 'L' ? x + 6 : x - 6;
        X.beginPath(); X.moveTo(ex, y); X.lineTo(lerp(ex, it.a[0], .2), y); X.lineTo(it.a[0], it.a[1]);
        X.strokeStyle = 'rgba(255,255,255,.45)'; X.lineWidth = .8; X.stroke();
        X.beginPath(); X.arc(it.a[0], it.a[1], 2.6, 0, 7); X.fillStyle = '#fff'; X.fill(); X.strokeStyle = 'rgba(0,0,0,.6)'; X.lineWidth = 1; X.stroke();
        X.textAlign = side === 'L' ? 'right' : 'left';
        X.shadowColor = 'rgba(0,0,0,.8)'; X.shadowBlur = 4 * SC / 2; X.fillStyle = 'rgba(240,244,250,.95)'; X.fillText(it.t, x, y); X.shadowBlur = 0;
      }
    }
  }

  // ---------- 캐시 ----------
  const CA = document.createElement('canvas'), CBV = document.createElement('canvas');
  let cacheKey = '';
  function ensureCache(main, mtx) {
    const key = [main.width, main.height, ...mtx.map(v => v.toFixed(2)), ...NUM.map(k => M[k].toFixed(3)), ...Object.values(HW).map(v => v.toFixed(2))].join('|');
    if (key === cacheKey) return;
    cacheKey = key;
    const keep = X;
    for (const [c, fn] of [[CA, staticBack], [CBV, staticFront]]) {
      if (c.width !== main.width || c.height !== main.height) { c.width = main.width; c.height = main.height; }
      X = c.getContext('2d'); X.setTransform(1, 0, 0, 1, 0, 0); X.clearRect(0, 0, c.width, c.height);
      if (c === CA) background(c.width, c.height);
      X.setTransform(...mtx); X.lineJoin = 'round'; X.lineCap = 'round'; fn();
    }
    X = keep;
  }

  // ---------- 메인 ----------
  function frame(ctx, S, I, dt) {
    X = ctx; TIME += dt;
    const ke = 1 - Math.exp(-dt * 5);
    for (const k of NUM) { M[k] = lerp(M[k], MT[k], ke); if (Math.abs(M[k] - MT[k]) < .002) M[k] = MT[k]; }
    for (const k in HW) { const t = MT.hair === k ? 1 : 0; HW[k] = lerp(HW[k], t, ke); if (Math.abs(HW[k] - t) < .01) HW[k] = t; }
    const d = I.dpr, k = Math.min(I.w / 920, I.h / 1110), ox = (I.w - 920 * k) / 2 - 40 * k, oy = (I.h - 1110 * k) / 2 + 4 * k;
    const mtx = [d * k, 0, 0, d * k, d * ox, d * oy]; SC = d * k;
    ensureCache(ctx.canvas, mtx);
    X.setTransform(1, 0, 0, 1, 0, 0); X.drawImage(CA, 0, 0);
    X.setTransform(...mtx); X.lineJoin = 'round'; X.lineCap = 'round';

    JA = S.jaw * .2;
    const L = lips(S), TG = tongue(S), VL = velum(S);
    step(dt, S, I, L, TG);

    // 피부 아래 지방층 + 피부 단면
    const top = [...SKA.map((p, i) => i === 12 ? [p[0] - M.brow * 6, p[1]] : p), L.ulF, L.ulS];
    const bot = [L.llS, L.llF, ...SKB.map((p, i) => i === 6 ? [p[0] - M.adam * 12, p[1], 0] : p)];
    const sil = PS([...top, ...bot]);
    tissue(sil, 'fat', { deg: 15, s: .7, a: [300, 200], b: [700, 1000], la: .1, da: .2, ins: 0 });
    const tp = PS(top, false), bp = PS(bot, false);
    clipDo(sil, () => { strk(tp, '#c9876e', 11); strk(bp, '#c9876e', 11); strk(tp, '#e2a48a', 6); strk(bp, '#e2a48a', 6); });
    strk(tp, 'rgba(120,70,55,.9)', 1.2); strk(bp, 'rgba(120,70,55,.9)', 1.2);

    X.setTransform(1, 0, 0, 1, 0, 0); X.drawImage(CBV, 0, 0); X.setTransform(...mtx);

    const oral = PL(oralPoly(L)); fill(oral, AIR); inset(oral, 10, .7);
    FLOOR.forEach((f, i) => tissue(PS(f), 'muscle', { deg: 10 + i * 4, ins: 0, line: 'rgba(70,8,18,.6)' }));
    bone(PS(SYM), [258, 630], [320, 750]);
    tooth(LI, [[250, 580, 1], [300, 580, 1], [300, 623, 1], [250, 623, 1]], LIP, [270, 600, 1], [286, 620, 1]);
    if (HW.man > .02) { X.globalAlpha = HW.man; X.fillStyle = 'rgba(40,26,20,.55)'; for (const p of STUB) { const q = T(p); X.fillRect(q[0], q[1], 1.3, 1.3); } X.globalAlpha = 1; }
    bone(EL([478, 776, .35], 11, 8), [470, 768], [488, 784], 2);
    tissue(PS(EPI), 'cart', { tint: 'rgba(225,190,110,.35)', ins: 3, line: MUC, lw: 2.4 });
    folds(S);
    tongueDraw(TG);
    const vp = PS(VL); tissue(vp, 'muscle', { deg: 30, ins: 0 }); clipDo(vp, () => strk(vp, MUC, 7)); inset(vp, 7, .5); strk(vp, 'rgba(70,8,18,.6)', .8);
    tooth(UI, [[240, 577], [295, 579], [295, 620], [240, 620]], UIP, [255, 585], [278, 600]);
    lipsDraw(L);
    activity();
    effects(I);

    const c = W([420, 300]), g = X.createRadialGradient(c[0], c[1], 80, c[0], c[1], 900);
    g.addColorStop(0, 'rgba(255,250,240,.05)'); g.addColorStop(.6, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.35)');
    X.fillStyle = g; X.fillRect(-200, -200, 1400, 1500);
    const f0 = W([0, 1060]), fg = X.createLinearGradient(0, f0[1] - 30, 0, f0[1] + 80);
    fg.addColorStop(0, 'rgba(10,12,16,0)'); fg.addColorStop(1, 'rgba(10,12,16,1)'); X.fillStyle = fg; X.fillRect(150, f0[1] - 30, 800, 300);
    if (I.labels) labels(L, TG, VL, k);
  }

  // 후두경으로 위에서 본 성대
  function glottis(g, S, w, h) {
    g.save(); g.clearRect(0, 0, w, h); g.translate(w / 2, h / 2); g.scale(w / 110, h / 110); g.translate(-50, -50);
    g.beginPath(); g.arc(50, 50, 50, 0, 7); g.clip();
    let gr = g.createRadialGradient(50, 52, 4, 50, 52, 52); gr.addColorStop(0, '#5a141c'); gr.addColorStop(.55, '#b4464f'); gr.addColorStop(1, '#4a1016');
    g.fillStyle = gr; g.fillRect(0, 0, 100, 100);
    const gap = S.voice > .3 ? 1.2 + 4.5 * S.voice * (.5 + .5 * Math.sin(TIME * 2 * Math.PI * 12)) : 2 + S.glot * 20;
    g.beginPath(); g.moveTo(49, 20); g.lineTo(51, 20); g.lineTo(50 + gap, 80); g.lineTo(50 - gap, 80); g.closePath();
    gr = g.createLinearGradient(0, 20, 0, 80); gr.addColorStop(0, '#120305'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fill();
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(50 + s * 30, 18); g.lineTo(50 + s * 48, 22); g.lineTo(50 + s * 40, 86); g.lineTo(50 + s * (gap + 14), 84); g.closePath(); g.fillStyle = '#c8606a'; g.fill();
      g.beginPath(); g.moveTo(50 + s * 1, 20); g.lineTo(50 + s * 30, 18); g.lineTo(50 + s * (gap + 14), 84); g.lineTo(50 + s * gap, 80); g.closePath();
      gr = g.createLinearGradient(50, 0, 50 + s * 20, 0); gr.addColorStop(0, '#fbf3ef'); gr.addColorStop(1, '#d8b8b4'); g.fillStyle = gr; g.fill();
      g.beginPath(); g.arc(50 + s * (gap + 9), 88, 8, 0, 7); g.fillStyle = '#d98a8f'; g.fill();
    }
    g.beginPath(); g.ellipse(50, 6, 34, 12, 0, 0, Math.PI); g.fillStyle = '#e3a79c'; g.fill();
    g.restore();
  }

  return {
    frame, glottis,
    setMode(k) { MT = MODES[k] || MODES.man; },
    word() { act.vis = .9; act.wern = .9; act.broca = .95; pulse('read'); },
    phone(p, prev) {
      act.motor = .9; act.broca = Math.max(act.broca, .5);
      if (p.v || p.tip || p.back) pulse('tongue');
      if (p.lc || p.lr > .3 || p.ld) pulse('lips');
      if (prev && Math.abs((p.jaw || 0) - (prev.jaw || 0)) > .2) pulse('jaw');
      if (!!p.voice !== !!(prev && prev.voice)) pulse('voice');
    },
    burst(p) {
      if (!AP) return; const i = closeIdx(p); if (i < 0) return;
      for (let k = 0; k < (p.asp ? 22 : 12); k++) spawn('o', true, false, AP.oc[i] + Math.random() * 6, 520 + Math.random() * 260);
    },
  };
})();
