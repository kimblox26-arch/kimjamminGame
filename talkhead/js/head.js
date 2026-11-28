'use strict';
/* 2D 머리 옆모습 단면 렌더러 — 뼈·근육·혀·치아·뇌·성대·공기 흐름
   가상좌표: 머리가 왼쪽을 봄, 대략 x 200~850, y 100~1150 */
const Head = (() => {
  const lerp = (a, b, t) => a + (b - a) * t, cl = (x, a, b) => x < a ? a : x > b ? b : x;
  const sst = (a, b, x) => { const t = cl((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mix = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t), 0];
  const FONT = "'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',system-ui,sans-serif";

  // 모드별 얼굴 비율: s 전체크기, cr 머리뼈, fx/fy 얼굴 가로/세로, lar 후두 높이, adam 울대뼈, brow 눈썹뼈, lip 입술 두께
  const MODES = {
    boy:   { s: .9,  cr: 1.05, fx: .9,   fy: .86, lar: -10, adam: 0,  brow: 0, lip: 1,    hair: 'boy' },
    girl:  { s: .88, cr: 1.05, fx: .88,  fy: .85, lar: -12, adam: 0,  brow: 0, lip: 1.12, hair: 'girl' },
    man:   { s: 1,   cr: 1,    fx: 1.03, fy: 1.05, lar: 28, adam: 1,  brow: 1, lip: .95,  hair: 'man' },
    woman: { s: .96, cr: 1,    fx: .97,  fy: .98, lar: 10,  adam: .2, brow: 0, lip: 1.15, hair: 'woman' },
  };
  const NUM = ['s', 'cr', 'fx', 'fy', 'lar', 'adam', 'brow', 'lip'];
  const M = Object.assign({}, MODES.man); let MT = MODES.man;
  const HW = { boy: 0, girl: 0, man: 1, woman: 0 };
  let X, JA = 0, TIME = 0;
  const PIV = [560, 478]; // 턱관절

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

  // ---------- 그리기 도우미 ----------
  function sp(q, closed) {
    const n = q.length, g = i => closed ? q[(i + n) % n] : q[cl(i, 0, n - 1)];
    X.moveTo(q[0][0], q[0][1]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = g(i - 1), b = g(i), c = g(i + 1), d = g(i + 2);
      X.bezierCurveTo(b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6, c[0] - (d[0] - b[0]) / 6, c[1] - (d[1] - b[1]) / 6, c[0], c[1]);
    }
    if (closed) X.closePath();
  }
  function shape(pts, closed = true) { X.beginPath(); sp(pts.map(T), closed); }
  function poly(pts) { X.beginPath(); pts.forEach((p, i) => { const q = T(p); i ? X.lineTo(q[0], q[1]) : X.moveTo(q[0], q[1]); }); X.closePath(); }
  function fs(f, s, lw = 1.5) { if (f) { X.fillStyle = f; X.fill(); } if (s) { X.strokeStyle = s; X.lineWidth = lw; X.stroke(); } }
  function line(pts, s, lw, dash) { X.beginPath(); sp(pts.map(T), false); X.setLineDash(dash || []); fs(null, s, lw); X.setLineDash([]); }
  function ell(c, rx, ry, rot = 0) { const q = T(c), k = M.s; X.beginPath(); X.ellipse(q[0], q[1], rx * k, ry * k, rot, 0, 7); }
  function rrect(x, y, w, h, r) {
    X.beginPath(); X.moveTo(x + r, y); X.arcTo(x + w, y, x + w, y + h, r); X.arcTo(x + w, y + h, x, y + h, r);
    X.arcTo(x, y + h, x, y, r); X.arcTo(x, y, x + w, y, r); X.closePath();
  }
  const yAt = (a, x) => {
    if (x <= a[0][0]) return a[0][1];
    for (let i = 1; i < a.length; i++) if (x <= a[i][0]) return lerp(a[i - 1][1], a[i][1], (x - a[i - 1][0]) / (a[i][0] - a[i - 1][0]));
    return a[a.length - 1][1];
  };
  const cum = p => { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return c; };
  function along(p, c, d) {
    if (d <= 0) return p[0];
    for (let i = 1; i < p.length; i++) if (d <= c[i]) { const t = (d - c[i - 1]) / (c[i] - c[i - 1] || 1); return [lerp(p[i - 1][0], p[i][0], t), lerp(p[i - 1][1], p[i][1], t), p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]]; }
    return null;
  }
  let seed = 11; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;

  const C = {
    bone: '#ece2cb', boneS: '#a8977a', air: '#0a1729', muscle: '#d4505c', muscleD: '#8a2232', tooth: '#fbf8ef',
    cart: 'rgba(185,220,240,.6)', brain: '#f0a3b4', brainD: 'rgba(150,55,85,.55)', hair: 'rgba(38,26,20,.92)', skinL: 'rgba(255,214,192,.8)',
  };

  // ---------- 고정 구조 ----------
  const SKA = [[738, 1150], [724, 880], [716, 730], [748, 630], [796, 490], [799, 345], [746, 205], [622, 117], [490, 101], [367, 135], [293, 226], [270, 320], [262, 368], [276, 402], [252, 460], [206, 524], [214, 548], [249, 561]];
  const SKB = [[258, 655, 1], [249, 700, 1], [273, 751, 1], [340, 778, .9], [402, 793, .55], [428, 826, .2], [436, 866, 0], [450, 960, 0], [456, 1150, 0]];
  const CR = [[284, 398], [275, 362], [283, 300], [305, 236], [372, 152], [490, 117], [616, 131], [726, 211], [773, 335], [769, 470], [738, 545], [693, 575], [652, 562], [612, 548], [577, 520], [546, 498], [520, 470], [470, 442], [400, 432], [330, 424], [298, 414]];
  const scl = (a, k) => a.map(p => [515 + (p[0] - 515) * k, 330 + (p[1] - 330) * k]);
  const CRI = scl(CR, .935), BR = scl(CR, .9);
  const BS = [[572, 418], [612, 410], [628, 468], [642, 548], [646, 600], [626, 600], [616, 548], [594, 478]];
  const NAS = [[227, 549], [238, 522], [258, 482], [290, 456], [360, 449], [450, 456], [520, 478], [548, 505], [551, 535], [520, 546], [470, 544], [380, 541], [300, 543], [250, 553]];
  const MAX = [[262, 470], [290, 442], [380, 438], [470, 448], [480, 500], [476, 556], [420, 556], [340, 559], [290, 577], [278, 580], [256, 566], [248, 540], [256, 500]];
  const PAL = [[256, 550], [300, 543], [380, 541], [470, 544], [476, 550], [470, 557], [420, 553], [360, 554], [320, 561], [289, 573], [279, 578], [258, 566]];
  const MAND = [[268, 642], [262, 690], [275, 737], [320, 750], [420, 742], [500, 727], [545, 700], [566, 650], [572, 560], [566, 505], [560, 478], [548, 490], [540, 530], [522, 512], [506, 560], [480, 600], [440, 612], [360, 618], [300, 630], [289, 642]].map(p => [p[0], p[1], 1]);
  const UI = [[256, 572], [250, 588], [258, 605], [267, 604], [274, 591], [279, 574]];
  const LI = [[269, 634, 1], [268, 616, 1], [273, 598, 1], [280, 598, 1], [287, 614, 1], [289, 634, 1]];
  const ROOF = [[262, 604], [274, 590], [289, 573], [320, 561], [360, 554], [420, 553], [470, 557], [500, 553]];
  const TCLIP = [[150, 1150], [150, 606], [262, 606], [274, 590], [289, 573], [320, 561], [360, 554], [420, 553], [470, 557], [480, 540], [600, 540], [600, 1150]];
  const LOBES = [
    ['rgba(255,170,120,.13)', [[100, 40], [540, 40], [525, 128], [510, 190], [492, 260], [478, 320], [468, 372], [392, 402], [200, 560]]],
    ['rgba(255,230,140,.11)', [[540, 40], [900, 40], [705, 195], [700, 260], [706, 320], [625, 335], [580, 350], [520, 370], [468, 372], [478, 320], [492, 260], [510, 190], [525, 128]]],
    ['rgba(190,150,255,.14)', [[900, 40], [900, 600], [700, 600], [706, 320], [700, 260], [705, 195]]],
    ['rgba(120,220,255,.11)', [[392, 402], [450, 390], [520, 370], [580, 350], [625, 335], [706, 320], [700, 600], [300, 600]]],
  ];
  const SULCI = [[[525, 128], [510, 190], [492, 260], [478, 320], [468, 372]], [[392, 402], [450, 390], [520, 370], [580, 350], [625, 335]], [[705, 195], [700, 260], [706, 320]]];
  const AREA = { broca: [372, 390, '255,150,60'], motor: [470, 318, '255,230,90'], wern: [594, 392, '80,220,255'], aud: [528, 404, '120,255,170'], vis: [742, 362, '190,140,255'], ang: [652, 318, '120,170,255'] };
  const GYRI = [];
  for (let i = 0; i < 58; i++) {
    let x = 300 + rnd() * 460, y = 140 + rnd() * 330, a = rnd() * 6.28; const g = [[x, y]];
    for (let k = 0; k < 7; k++) { a += (rnd() - .5) * 1.8; x += Math.cos(a) * 15; y += Math.sin(a) * 15; g.push([x, y]); }
    GYRI.push(g);
  }
  const NV = {
    read: [[742, 362], [690, 330], [650, 318], [600, 380], [540, 372], [460, 368], [375, 388], [420, 350], [466, 322]],
    tongue: [[466, 322], [540, 400], [606, 476], [612, 532], [592, 600], [545, 680], [480, 712], [420, 672]],
    lips: [[466, 322], [540, 400], [600, 470], [598, 522], [520, 566], [400, 604], [300, 642], [252, 622]],
    jaw: [[466, 322], [540, 400], [590, 456], [556, 520], [526, 600]],
    voice: [[466, 322], [540, 400], [606, 480], [612, 560], [582, 700], [540, 800], [496, 864]],
  };
  const NVC = { read: '110,220,255', tongue: '255,120,140', lips: '255,170,90', jaw: '255,230,100', voice: '150,255,170' };

  // 머리카락
  const HIN = [[292, 232], [367, 135], [490, 101], [622, 117], [746, 205], [799, 345], [796, 490], [748, 630]];
  const HD = []; for (let i = 0; i < HIN.length - 1; i++) for (let k = 0; k < 4; k++) HD.push(mix(HIN[i], HIN[i + 1], k / 4)); HD.push([748, 630, 0]);
  function cap(th, spike, end) {
    const m = Math.round((HD.length - 1) * end), inn = HD.slice(0, m + 1);
    const push = (p, t) => { const dx = p[0] - 520, dy = p[1] - 430, L = Math.hypot(dx, dy); return [p[0] + dx / L * t, p[1] + dy / L * t]; };
    const out = inn.map((p, i) => push(p, th * Math.pow(Math.sin(Math.PI * i / m), .5) * (spike && i % 2 ? 1.6 : 1)));
    return [...out, ...inn.map(p => push(p, -3)).reverse()];
  }
  const CAPS = { boy: cap(24, true, 1), man: cap(15, false, .93), woman: cap(20, false, 1), girl: cap(22, false, 1) };
  const BANGS = [[292, 232], [303, 210], [336, 190], [322, 238], [303, 282], [284, 302], [279, 262]];
  const LONGH = [[622, 112], [760, 190], [826, 330], [846, 560], [852, 800], [828, 990], [770, 1010], [742, 900], [730, 740], [752, 632], [796, 490], [799, 345], [746, 205]];
  const PONY = [[792, 300], [838, 296], [878, 370], [890, 480], [868, 600], [846, 640], [852, 520], [840, 410], [808, 340]];
  const CHIN = [[258, 655], [249, 700], [273, 751], [340, 778], [402, 793]];
  const STUB = [];
  for (let i = 0; i < 120; i++) {
    const s = rnd() * (CHIN.length - 1.001), k = Math.floor(s), f = s - k, a = CHIN[k], b = CHIN[k + 1];
    const tx = b[0] - a[0], ty = b[1] - a[1], L = Math.hypot(tx, ty), dep = 2 + rnd() * 12;
    STUB.push([lerp(a[0], b[0], f) + ty / L * dep, lerp(a[1], b[1], f) - tx / L * dep, 1]);
  }

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
    for (let i = 1; i < u0.length; i++) { // 사이점을 바깥으로 부풀려 둥근 혀 모양
      const a = u0[i - 1], b = u0[i], k = i === 1 ? .06 : .13;
      up.push([(a[0] + b[0]) / 2 + (b[1] - a[1]) * k, (a[1] + b[1]) / 2 - (b[0] - a[0]) * k], b);
    }
    for (const p of up.slice(1, 8)) p[1] = Math.max(p[1], yAt(ROOF, p[0]) + 1.5);
    const under = [jw([470, 770, .4]), jw([430, 750, .7]), jw([360, 730, 1]), jw([312, 702, 1]), jw([295, 664, 1]), mix(jw([298, 634, 1]), [tip[0] + 6, tip[1] + 14], S.tipA)];
    return { up, all: [...up, ...under].map(p => [p[0], p[1], 0]), body: [body[0], body[1]] };
  }
  function velum(S) {
    const v = S.vel, E = mix([546, 551], [508, 616], v), Mi = mix([510, 543], [492, 586], v);
    return [[470, 545, 0], [Mi[0] + 3, Mi[1] - 8, 0], [E[0] + 2, E[1] - 4, 0], [E[0] - 3, E[1] + 5, 0], [Mi[0] - 5, Mi[1] + 9, 0], [468, 559, 0]];
  }
  const airPoly = L => [L.ulS, [262, 604], [274, 590], [289, 573], [320, 561], [360, 554], [420, 553], [470, 557], [505, 548], [530, 530], [549, 512], [555, 560], [557, 650], [554, 750], [549, 838], [537, 862], [522, 869], [516, 900], [518, 1150], [462, 1150], [460, 900], [458, 869], [466, 846], [478, 834], [470, 792], [466, 762], [440, 744, .6], [380, 727, 1], [320, 712, 1], [296, 682, 1], [288, 646, 1], [285, 614, 1], [277, 599, 1], L.llS];

  // ---------- 효과 상태 ----------
  const parts = [], rings = [], notes = [], pulses = [], lastPulse = {};
  const act = { broca: 0, motor: 0, wern: 0, aud: 0, vis: 0, ang: 0 };
  const hud = { g: '', ipa: '', cat: '', desc: '', a: 0 };
  let blink = 0, nextBlink = 2, accO = 0, accN = 0, accR = 0, accM = 0, AP = null;

  function airPaths(L, TG) {
    const u = TG.up;
    const ty = x => { for (let i = 1; i < 7; i++) if (x <= u[i][0]) return lerp(u[i - 1][1], u[i][1], cl((x - u[i - 1][0]) / (u[i][0] - u[i - 1][0] || 1), 0, 1)); return u[6][1]; };
    const oy = x => { const r = yAt(ROOF, x); return (r + Math.min(ty(x), r + 60)) / 2; };
    const lm = [(L.ulS[0] + L.llS[0]) / 2, (L.ulS[1] + L.llS[1]) / 2];
    const G = [[490, 866], [520, 830], [533, 760], [531, 690], [524, 630]];
    const o = [...G, ...[470, 420, 370, 320, 290].map(x => [x, oy(x)]), lm, [150, lm[1] + 4]].map(W);
    const n = [...G.slice(0, 4), [536, 600], [536, 540], [525, 512], [470, 498], [380, 502], [300, 506], [252, 530], [228, 549], [150, 562]].map(W);
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
    if (I.active) act.aud = Math.max(act.aud, S.voice * .75);
    nextBlink -= dt; if (nextBlink < 0) { blink = 1; nextBlink = 2 + Math.random() * 4; } blink = Math.max(0, blink - dt * 7);
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
    if (I.active && S.voice > .5 && S.cl < .5 && S.lc < .5) { accR += dt; if (accR > .12) { accR = 0; rings.push({ r: 4, a: .7 }); } }
    for (let i = rings.length - 1; i >= 0; i--) { rings[i].r += 170 * dt; rings[i].a -= dt * 1.1; if (rings[i].a <= 0) rings.splice(i, 1); }
    if (I.sing && I.active) {
      accM += dt;
      if (accM > .42) { accM = 0; const lm = AP.o[10]; notes.push({ x: lm[0] - 10, y: lm[1] - 10, vx: -40 - Math.random() * 30, vy: -50 - Math.random() * 30, a: 1, c: Math.random() < .5 ? '♪' : '♫' }); }
    }
    for (let i = notes.length - 1; i >= 0; i--) { const n = notes[i]; n.x += n.vx * dt; n.y += n.vy * dt; n.a -= dt * .45; if (n.a <= 0) notes.splice(i, 1); }
    for (let i = pulses.length - 1; i >= 0; i--) { pulses[i].d += 950 * dt; if (pulses[i].d > 2000) pulses.splice(i, 1); }
  }
  function pulse(k) { if (TIME - (lastPulse[k] || -1) < .08) return; lastPulse[k] = TIME; pulses.push({ k, d: 0 }); }

  // ---------- 뇌 ----------
  function brain() {
    shape(CR); fs(C.bone, C.boneS, 2);
    shape(CRI); fs('#203454');
    X.save(); shape(BR); fs(C.brain); X.clip();
    for (const [c, p] of LOBES) { poly(p); fs(c); }
    for (const g of GYRI) line(g, C.brainD, 1.6);
    for (const s of SULCI) line(s, 'rgba(120,35,60,.8)', 2.6);
    for (const k in AREA) {
      const v = act[k] + .06, a = AREA[k], q = W(a), r = (38 + 14 * v) * M.s;
      const g = X.createRadialGradient(q[0], q[1], 0, q[0], q[1], r);
      g.addColorStop(0, `rgba(${a[2]},${Math.min(.9, v)})`); g.addColorStop(1, `rgba(${a[2]},0)`);
      X.fillStyle = g; X.fillRect(q[0] - r, q[1] - r, r * 2, r * 2);
    }
    X.restore();
    shape(BR); fs(null, 'rgba(255,190,205,.8)', 1.5);
    // 소뇌
    const c = W([668, 482]), k = M.s * M.cr;
    X.save(); X.beginPath(); X.ellipse(c[0], c[1], 58 * k, 38 * k, -.25, 0, 7); fs('#e48da2', 'rgba(255,190,205,.8)', 1.5); X.clip();
    for (let i = 1; i < 9; i++) { X.beginPath(); X.ellipse(c[0] + 10 * k, c[1] + 14 * k, i * 8 * k, i * 5.5 * k, -.25, 3.3, 6.1); fs(null, 'rgba(130,40,70,.6)', 1.4); }
    X.restore();
    shape(BS); fs('#e9a3b4', 'rgba(255,200,210,.8)', 1.2);
  }

  function neckBack() {
    for (const y0 of [575, 640, 700, 760, 820, 880, 940, 1000, 1060, 1120]) {
      shape([[572, y0], [616, y0], [621, y0 + 6], [621, y0 + 42], [616, y0 + 48], [572, y0 + 48], [567, y0 + 42], [567, y0 + 6]]); fs(C.bone, C.boneS, 1.2);
      poly([[569, y0 + 50], [620, y0 + 50], [620, y0 + 58], [569, y0 + 58]]); fs('rgba(140,190,230,.5)');
      shape([[652, y0 + 6], [704, y0 + 20], [708, y0 + 32], [652, y0 + 40]]); fs('rgba(236,226,203,.8)', C.boneS, 1);
    }
    line([[622, 560], [622, 1150]], 'rgba(236,226,203,.5)', 3); line([[652, 560], [652, 1150]], 'rgba(236,226,203,.5)', 3);
    line([[630, 560], [636, 700], [640, 1150]], '#f1b9c6', 15);
    line([[553, 520], [558, 600], [560, 700], [557, 800], [552, 870]], 'rgba(212,80,92,.55)', 9);
    poly([[526, 880], [548, 876], [550, 1150], [526, 1150]]); fs('rgba(160,50,65,.75)');
    line([[537, 885], [538, 1150]], 'rgba(255,150,160,.5)', 1.5);
  }

  function larynx(S) {
    shape([[448, 806], [441 - M.adam * 6, 842], [447, 892], [474, 896], [476, 812]]); fs(C.cart, 'rgba(200,235,255,.8)', 1.2);
    shape([[452, 898], [458, 920], [522, 922], [524, 893], [512, 889]]); fs(C.cart, 'rgba(200,235,255,.7)', 1);
    for (let y = 930; y < 1150; y += 22) { poly([[458, y], [468, y], [468, y + 11], [458, y + 11]]); fs(C.cart); }
    shape([[478, 836], [483, 800], [494, 770], [505, 750], [511, 756], [503, 790], [492, 836]]); fs('rgba(240,222,160,.92)', 'rgba(255,240,190,.9)', 1);
    shape([[450, 770, .35], [500, 764, .35], [504, 773, .35], [452, 781, .35]]); fs(C.bone, C.boneS, 1);
    const vib = S.voice > .3 ? Math.sin(TIME * 70) * 3 * S.voice : 0, gap = S.glot * 8;
    poly([[458, 856], [487 - gap + vib, 866], [458, 878]]); fs(C.muscle);
    poly([[522, 857], [493 + gap - vib, 867], [522, 879]]); fs(C.muscle);
    if (S.voice > .3) { const a = T([490, 866]); X.beginPath(); X.arc(a[0], a[1], 9 + vib * 2, 0, 7); fs(`rgba(150,255,170,${.35 * S.voice})`); }
  }

  function tongueDraw(TG) {
    X.save(); X.beginPath(); sp(TCLIP.map(W), true); X.clip();
    X.beginPath(); sp(TG.all.map(W), true);
    const a = W(TG.body), g = X.createRadialGradient(a[0], a[1] - 10, 5, a[0], a[1] + 40, 140);
    g.addColorStop(0, '#f07a80'); g.addColorStop(1, C.muscleD); fs(g, '#ff9aa0', 1.8);
    X.clip();
    const o = W(jw([302, 702, 1])), up = TG.up;
    for (let i = 0; i <= 14; i++) {
      const s = i / 14 * 9.2, k = Math.min(9, Math.floor(s)), f = s - k, p = W(mix(up[k], up[k + 1], f));
      X.beginPath(); X.moveTo(o[0], o[1]); X.lineTo(p[0], p[1]); fs(null, 'rgba(120,20,35,.35)', 1.6);
    }
    X.beginPath(); sp(up.slice(0, 9).map(p => { const q = W(p); return [q[0], q[1] + 9]; }), false); fs(null, 'rgba(255,170,175,.35)', 2);
    X.restore();
  }

  function teeth() {
    for (const x of [322, 358, 394, 430]) {
      shape([[x, 558], [x + 32, 558], [x + 32, 588], [x, 588]]); fs('rgba(251,248,239,.16)', 'rgba(251,248,239,.35)', 1);
      shape([[x, 591, 1], [x + 32, 591, 1], [x + 32, 620, 1], [x, 620, 1]]); fs('rgba(251,248,239,.16)', 'rgba(251,248,239,.35)', 1);
    }
    shape(LI); fs(C.tooth, '#c9c2ae', 1.2);
    shape(UI); fs(C.tooth, '#c9c2ae', 1.2);
  }

  function face(S, L) {
    // 입술 근육(구륜근)
    ell(mix(mix(L.ulF, L.ulS, .5), [252, 578], .4), 8, 6); fs('rgba(212,80,92,.45)');
    ell(mix(mix(L.llF, L.llS, .5), jw([250, 640, 1]), .4), 8, 6); fs('rgba(212,80,92,.45)');
    // 눈
    ell([306, 412], 27, 27); fs('rgba(0,0,0,.35)');
    X.save(); ell([306, 412], 21, 21); fs('rgba(238,243,247,.85)'); X.clip();
    ell([288, 412], 4.5, 10); fs('#4a7fb5'); ell([286, 412], 2.5, 5); fs('#111');
    const lid = T([306, 391 + 13 + 29 * blink]), e = T([330, 0]);
    X.fillStyle = 'rgba(230,175,155,.95)'; X.fillRect(lid[0] - 40, lid[1] - 60, 80, 60);
    X.beginPath(); X.moveTo(lid[0] - 25, lid[1]); X.lineTo(e[0], lid[1]); fs(null, '#3a2a20', 2);
    X.restore();
    if (HW.girl + HW.woman > .05) { X.globalAlpha = HW.girl + HW.woman; line([[284, 403 + 29 * blink], [276, 398 + 26 * blink]], '#2a1c15', 2.4); X.globalAlpha = 1; }
    line([[282, 384], [300, 378], [322, 380], [338, 386]], C.hair, 5 + 3 * M.brow);
    // 귀 (반투명)
    shape([[602, 414], [626, 400], [649, 412], [657, 446], [646, 492], [628, 522], [612, 524], [606, 502], [612, 474], [600, 446]]);
    fs('rgba(255,200,180,.08)', 'rgba(255,214,192,.35)', 2);
    line([[616, 425], [637, 418], [645, 446], [634, 480]], 'rgba(255,214,192,.3)', 1.5);
  }

  function hair() {
    for (const k in CAPS) {
      if (HW[k] < .02) continue;
      X.globalAlpha = HW[k]; shape(CAPS[k]); fs(C.hair, 'rgba(90,60,45,.6)', 1);
      if (k === 'girl' || k === 'woman') { shape(BANGS); fs(C.hair); }
      if (k === 'girl') { ell([800, 300], 10, 10); fs('#ff6fa8'); }
      if (k === 'man') for (const p of STUB) { const q = T(p); X.fillStyle = 'rgba(40,28,22,.5)'; X.fillRect(q[0], q[1], 2, 2); }
    }
    X.globalAlpha = 1;
  }
  function hairBack() {
    if (HW.woman > .02) { X.globalAlpha = HW.woman; shape(LONGH); fs(C.hair); }
    if (HW.girl > .02) { X.globalAlpha = HW.girl; shape(PONY); fs(C.hair); }
    X.globalAlpha = 1;
  }

  function effects(I) {
    // 신경 (희미한 선) + 신호
    for (const k in NV) line(NV[k].slice(k === 'read' ? 0 : 1), `rgba(${NVC[k]},.16)`, 2, [5, 6]);
    for (const p of pulses) {
      const pts = NV[p.k].map(W), c = cum(pts);
      for (let t = 0; t < 3; t++) {
        const q = along(pts, c, p.d - t * 16); if (!q) continue;
        X.beginPath(); X.arc(q[0], q[1], 6 - t * 1.6, 0, 7); fs(`rgba(${NVC[p.k]},${.9 - t * .28})`);
      }
    }
    // 공기
    for (const q of parts) {
      const path = q.k === 'o' ? AP.o : AP.n, c = q.k === 'o' ? AP.oc : AP.nc, s = along(path, c, q.d); if (!s) continue;
      const fr = q.fr && q.k === 'o' && q.d > AP.oc[6];
      const L = Math.hypot(s[2], s[3]) || 1, j = q.j + (fr ? (Math.random() - .5) * 8 : 0);
      X.beginPath(); X.arc(s[0] - s[3] / L * j, s[1] + s[2] / L * j, fr ? 2.4 : 2, 0, 7);
      fs(fr ? 'rgba(235,250,255,.85)' : q.k === 'n' ? 'rgba(150,200,255,.6)' : 'rgba(120,225,255,.7)');
    }
    const lm = AP.o[10];
    for (const r of rings) { X.beginPath(); X.arc(lm[0], lm[1], r.r, Math.PI * .7, Math.PI * 1.3); fs(null, `rgba(150,255,190,${r.a})`, 2); }
    X.font = '700 30px ' + FONT; X.textAlign = 'center';
    for (const n of notes) { X.fillStyle = `rgba(255,220,120,${n.a})`; X.fillText(n.c, n.x, n.y); }
  }

  function labels(L, TG, VL, k) {
    const z = Math.max(13, 11 / k), items = [
      ['L', '운동 피질', [470, 318]], ['L', '브로카 영역', [372, 390]], ['L', '눈', [300, 412]], ['L', '비강 (콧속)', [330, 506]],
      ['L', '경구개', [380, 548]], ['L', '입술', L.ulF], ['L', '앞니', [266, 600]], ['L', '혀', TG.body], ['L', '턱뼈', [290, 724, 1]], ['L', '설골', [476, 772, .35]],
      ['R', '대뇌', [610, 215]], ['R', '두개골', [735, 250]], ['R', '베르니케 영역', [594, 392]], ['R', '뇌간', [612, 470]], ['R', '소뇌', [690, 488]],
      ['R', '연구개', VL[2]], ['R', '인두 (목구멍)', [540, 690]], ['R', '후두개', [506, 758]], ['R', '척추뼈', [594, 800]], ['R', '성대', [500, 866]],
      ['R', '척수', [638, 920]], ['R', '기관 (숨길)', [488, 1010]], ['R', '식도', [537, 1040]]];
    X.font = `600 ${z}px ${FONT}`; X.textBaseline = 'middle';
    for (const side of ['L', 'R']) {
      const g = items.filter(i => i[0] === side).map(i => ({ t: i[1], a: T(i[2]) })).sort((a, b) => a.a[1] - b.a[1]);
      let y = -1e9;
      for (const it of g) {
        y = Math.max(it.a[1], y + z * 1.5);
        const x = side === 'L' ? 200 : 862;
        X.beginPath(); X.moveTo(side === 'L' ? x + 5 : x - 5, y); X.lineTo(it.a[0], it.a[1]); fs(null, 'rgba(150,200,255,.35)', 1);
        X.beginPath(); X.arc(it.a[0], it.a[1], 2.5, 0, 7); fs('rgba(180,225,255,.9)');
        X.textAlign = side === 'L' ? 'right' : 'left'; X.fillStyle = 'rgba(225,238,255,.92)'; X.fillText(it.t, x, y);
      }
    }
  }

  function hudDraw(S, I) {
    hud.a = lerp(hud.a, I.active ? 1 : 0, .08);
    X.textBaseline = 'alphabetic';
    if (hud.a > .02) {
      X.globalAlpha = hud.a; rrect(36, 84, 240, 150, 14); fs('rgba(10,24,44,.8)', 'rgba(110,200,255,.45)', 1.5);
      X.textAlign = 'left'; X.font = '700 60px ' + FONT; X.fillStyle = '#fff'; X.fillText(hud.g, 54, 148);
      const w = X.measureText(hud.g).width; X.font = '600 24px ' + FONT; X.fillStyle = '#7fd6ff'; X.fillText(hud.ipa, 62 + w, 146);
      X.font = '700 17px ' + FONT; X.fillStyle = '#ffd27a'; X.fillText(hud.cat, 54, 178);
      X.font = '500 14px ' + FONT; X.fillStyle = 'rgba(225,238,255,.92)';
      let ln = '', yy = 202;
      for (const ch of hud.desc) { if (X.measureText(ln + ch).width > 205) { X.fillText(ln, 54, yy); ln = ''; yy += 19; } ln += ch; }
      X.fillText(ln, 54, yy); X.globalAlpha = 1;
    }
    // 성대 위에서 본 모습
    const cx = 112, cy = 985, R = 56;
    X.textAlign = 'center'; X.font = '600 14px ' + FONT; X.fillStyle = 'rgba(225,238,255,.9)'; X.fillText('성대 (위에서 본 모습)', cx, 915);
    X.beginPath(); X.arc(cx, cy, R, 0, 7); fs('#13060a', 'rgba(110,200,255,.45)', 1.5);
    const g = S.voice > .3 ? 2 + 6 * S.voice * (.5 + .5 * Math.sin(TIME * 2 * Math.PI * 11)) : 3 + S.glot * 24;
    X.save(); X.beginPath(); X.arc(cx, cy, R - 2, 0, 7); X.clip();
    X.beginPath(); X.moveTo(cx - 60, cy - 40); X.lineTo(cx - 1, cy - 36); X.lineTo(cx - g, cy + 32); X.lineTo(cx - 60, cy + 40); fs('#e06470', '#ffb0b6', 1.2);
    X.beginPath(); X.moveTo(cx + 60, cy - 40); X.lineTo(cx + 1, cy - 36); X.lineTo(cx + g, cy + 32); X.lineTo(cx + 60, cy + 40); fs('#e06470', '#ffb0b6', 1.2);
    X.beginPath(); X.arc(cx - g - 8, cy + 36, 8, 0, 7); X.arc(cx + g + 8, cy + 36, 8, 0, 7); fs('#f3c6a8');
    X.restore();
    X.fillStyle = S.voice > .5 ? '#9dffb4' : '#9fd0ff';
    X.fillText(S.voice > .5 ? '떨림 (유성음)' : S.glot > .65 ? '활짝 열림 (숨쉬기)' : '열림 (무성음)', cx, 1064);
    // 근육 활동 막대
    const tng = cl(Math.max(S.tipA * .9, S.back, cl((618 - S.bodyY) / 45, 0, 1) * .8 + Math.abs(S.bodyX - 398) / 120), 0, 1);
    const bars = [['혀', tng, '#ff7a86'], ['입술', Math.max(S.lc, S.lr, S.ls * .7, S.ld), '#ffad5c'], ['턱', S.jaw, '#ffe066'], ['성대', S.voice, '#7dffa0'], ['연구개', 1 - S.vel, '#7fd6ff']];
    X.textAlign = 'left'; X.fillStyle = 'rgba(225,238,255,.9)'; X.fillText('근육 활동', 196, 915);
    bars.forEach(([n, v, c], i) => {
      const y = 940 + i * 27;
      X.fillStyle = 'rgba(225,238,255,.85)'; X.font = '500 13px ' + FONT; X.fillText(n, 196, y + 4);
      rrect(250, y - 7, 150, 11, 5); fs('rgba(255,255,255,.08)');
      if (v > .01) { rrect(250, y - 7, Math.max(10, 150 * v), 11, 5); fs(c); }
    });
  }

  // ---------- 메인 ----------
  function frame(ctx, S, I, dt) {
    X = ctx; TIME += dt;
    const ke = 1 - Math.exp(-dt * 5);
    for (const k of NUM) M[k] = lerp(M[k], MT[k], ke);
    for (const k in HW) HW[k] = lerp(HW[k], MT.hair === k ? 1 : 0, ke);
    JA = S.jaw * .2;
    const L = lips(S), TG = tongue(S), VL = velum(S);
    step(dt, S, I, L, TG);
    X.lineJoin = 'round'; X.lineCap = 'round';

    hairBack();
    const top = [...SKA.map((p, i) => i === 12 ? [p[0] - M.brow * 6, p[1]] : p), L.ulF, L.ulS];
    const bot = [L.llS, L.llF, ...SKB.map((p, i) => i === 6 ? [p[0] - M.adam * 12, p[1], 0] : p)];
    shape([...top, ...bot]);
    const sc = W([480, 520]), gr = X.createRadialGradient(sc[0], sc[1], 50, sc[0], sc[1], 560);
    gr.addColorStop(0, 'rgba(255,196,170,.22)'); gr.addColorStop(1, 'rgba(255,170,150,.1)'); fs(gr);
    shape(top, false); fs(null, C.skinL, 2.2); shape(bot, false); fs(null, C.skinL, 2.2);

    neckBack();
    brain();
    shape(MAX); fs('rgba(236,226,203,.55)', 'rgba(168,151,122,.6)', 1);
    shape(NAS); fs(C.air, 'rgba(120,170,220,.3)', 1);
    for (const [x, y, rx, ry] of [[372, 522, 56, 9], [384, 499, 46, 8], [424, 477, 30, 6]]) { ell([x, y], rx, ry); fs('rgba(230,140,150,.75)'); }
    line([[284, 398], [270, 430], [257, 458]], C.bone, 6); line([[257, 458], [232, 495], [212, 522]], C.cart, 5);

    poly(airPoly(L)); fs(C.air);
    shape(MAND); const a = T([262, 640, 1]), b = T([575, 640, 1]), mg = X.createLinearGradient(a[0], 0, b[0], 0);
    mg.addColorStop(0, 'rgba(236,226,203,.95)'); mg.addColorStop(.45, 'rgba(236,226,203,.5)'); mg.addColorStop(1, 'rgba(236,226,203,.18)'); fs(mg, 'rgba(168,151,122,.7)', 1.2);
    line([[302, 706, 1], [380, 738, .8], [470, 772, .35]], 'rgba(212,80,92,.75)', 12);
    larynx(S);
    tongueDraw(TG);
    shape(VL); fs(C.muscle, '#ff9aa0', 1.5);
    poly(PAL); fs(C.bone, C.boneS, 1);
    teeth();
    face(S, L);
    hair();
    // 깨물근 (반투명)
    const ct = 1 - S.jaw;
    shape([[478 - 8 * ct, 488], [540, 492], [552, 700, 1], [505 - 10 * ct, 722, 1]]); fs(`rgba(220,70,80,${.12 + .1 * ct})`, 'rgba(255,120,120,.3)', 1);
    effects(I);

    const f0 = W([0, 1040]), fg = X.createLinearGradient(0, f0[1] - 20, 0, f0[1] + 90);
    fg.addColorStop(0, 'rgba(6,16,29,0)'); fg.addColorStop(1, 'rgba(6,16,29,1)'); X.fillStyle = fg; X.fillRect(150, f0[1] - 20, 800, 200);
    if (I.labels) labels(L, TG, VL, I.k);
    hudDraw(S, I);
  }

  return {
    frame,
    setMode(k) { MT = MODES[k] || MODES.man; },
    hud(o) { Object.assign(hud, o); },
    word() { act.vis = .9; act.ang = .7; act.wern = .9; act.broca = .95; pulse('read'); },
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
