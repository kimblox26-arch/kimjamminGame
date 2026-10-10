// 임무 미니게임 + 사보타주 수리 화면. 각 함수는 (el, done, ctx) 를 받고 정리 함수를 돌려줌
import { shuffle } from '../shared/data.js';
import { sfx } from '../core.js';

const S = 620;
const at = (e, el) => { const r = el.getBoundingClientRect(); return [(e.clientX - r.left) * S / r.width, (e.clientY - r.top) * S / r.height]; };
const svg = (el, inner) => { el.insertAdjacentHTML('beforeend', `<svg class="full" viewBox="0 0 ${S} ${S}">${inner}</svg>`); return el.lastElementChild; };
function dragger(el, { down, move, up }) {
  let on = false;
  el.addEventListener('pointerdown', e => { const p = at(e, el); if (down(p, e) !== false) { on = true; el.setPointerCapture(e.pointerId); } });
  el.addEventListener('pointermove', e => on && move?.(at(e, el), e));
  const end = e => { if (on) { on = false; up?.(at(e, el), e); } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
const msg = (el, text) => { let m = el.querySelector('.t'); if (!m) { m = document.createElement('div'); m.className = 't'; el.append(m); } m.textContent = text; };

export const GAMES = {
  wires(el, done) {
    const cols = ['#e53935', '#1e5bff', '#ffd600', '#d500f9'], L = shuffle([0, 1, 2, 3]), R = shuffle([0, 1, 2, 3]), y = i => 140 + i * 120;
    const s = svg(el, `<rect width="${S}" height="${S}" fill="#2a2f33"/><rect x="0" y="0" width="120" height="${S}" fill="#4a3f33"/><rect x="500" y="0" width="120" height="${S}" fill="#4a3f33"/>
      ${L.map((c, i) => `<rect x="0" y="${y(i) - 17}" width="90" height="34" fill="${cols[c]}"/><rect x="88" y="${y(i) - 20}" width="24" height="40" fill="#bbb"/>`).join('')}
      ${R.map((c, i) => `<rect x="530" y="${y(i) - 17}" width="90" height="34" fill="${cols[c]}"/><rect x="508" y="${y(i) - 20}" width="24" height="40" fill="#bbb"/>`).join('')}<g class="ln"></g><line class="tmp" stroke-width="22" stroke-linecap="round"/>`);
    const ln = s.querySelector('.ln'), tmp = s.querySelector('.tmp'), fixed = new Set();
    let cur = -1;
    dragger(el, {
      down: ([x, yy]) => { cur = x < 140 ? L.findIndex((_, i) => Math.abs(y(i) - yy) < 40) : -1; if (cur < 0 || fixed.has(cur)) return false; tmp.setAttribute('stroke', cols[L[cur]]); },
      move: ([x, yy]) => { tmp.setAttribute('x1', 110); tmp.setAttribute('y1', y(cur)); tmp.setAttribute('x2', x); tmp.setAttribute('y2', yy); },
      up: ([x, yy]) => {
        tmp.removeAttribute('x2');
        const j = x > 460 ? R.findIndex((_, i) => Math.abs(y(i) - yy) < 45) : -1;
        tmp.setAttribute('x1', 0); tmp.setAttribute('y1', 0); tmp.setAttribute('x2', 0); tmp.setAttribute('y2', 0);
        if (j >= 0 && R[j] === L[cur]) {
          fixed.add(cur); sfx('click');
          ln.insertAdjacentHTML('beforeend', `<line x1="110" y1="${y(cur)}" x2="510" y2="${y(j)}" stroke="${cols[L[cur]]}" stroke-width="22" stroke-linecap="round"/>`);
          if (fixed.size === 4) done();
        }
      },
    });
  },
  card(el, done) {
    const s = svg(el, `<rect width="${S}" height="${S}" fill="#5b6a70"/><rect x="40" y="90" width="540" height="150" rx="10" fill="#2c3438"/><rect x="40" y="160" width="540" height="14" fill="#111"/>
      <rect x="430" y="110" width="120" height="34" fill="#111"/><text class="scr" x="440" y="134" fill="#3f3" font-size="18">카드를 넣으세요</text>
      <rect x="140" y="380" width="340" height="220" rx="16" fill="#7a4a24"/><g class="cd"><rect x="190" y="330" width="240" height="150" rx="12" fill="#e6e9ef" stroke="#333" stroke-width="4"/><rect x="210" y="350" width="70" height="80" fill="#9fc3ff"/><rect x="300" y="360" width="110" height="12" fill="#888"/></g>`);
    const cd = s.querySelector('.cd'), scr = s.querySelector('.scr');
    let inSlot = false, sx = 0, t0 = 0, x = 0;
    const place = () => cd.setAttribute('transform', inSlot ? `translate(${x - 150} -230)` : '');
    dragger(el, {
      down: ([px, py]) => {
        if (!inSlot) { if (py > 320) { inSlot = true; x = 150; place(); scr.textContent = '카드를 긁으세요'; } return false; }
        if (py > 280 || py < 80) return false;
        sx = px; t0 = performance.now();
      },
      move: ([px]) => { x = Math.max(150, Math.min(470, 150 + px - sx)); place(); },
      up: () => {
        const dt = performance.now() - t0;
        if (x < 460) scr.textContent = '끝까지 긁으세요';
        else if (dt < 550) scr.textContent = '너무 빠릅니다';
        else if (dt > 1500) scr.textContent = '너무 느립니다';
        else { scr.textContent = '승인되었습니다'; return done(); }
        x = 150; place();
      },
    });
  },
  align(el, done) {
    let y = Math.random() < 0.5 ? 120 : 500;
    const s = svg(el, `<rect width="${S}" height="${S}" fill="#3a4246"/><path d="M80 310 L560 310" stroke="#8f8" stroke-width="3" stroke-dasharray="10 8"/>
      <path d="M520 60 A300 300 0 0 1 520 560" fill="none" stroke="#222" stroke-width="40"/><g class="ar"><path d="M420 0 L520 -26 L520 26 Z" fill="#ffd23f" stroke="#000" stroke-width="4"/><line x1="80" y1="0" x2="420" y2="0" stroke="#ffd23f" stroke-width="4" stroke-dasharray="6 8"/></g>`);
    const ar = s.querySelector('.ar'), set = () => ar.setAttribute('transform', `translate(0 ${y})`);
    set(); msg(el, '화살표를 가운데 선에 맞추세요');
    dragger(el, { down: () => {}, move: ([, py]) => { y = Math.max(60, Math.min(560, py)); set(); }, up: () => { if (Math.abs(y - 310) < 14) { y = 310; set(); done(); } } });
  },
  calib(el, done) {
    const dials = [0, 1, 2].map(i => ({ a: Math.random() * 360, sp: 140 + i * 60, lock: false }));
    const s = svg(el, `<rect width="${S}" height="${S}" fill="#33393c"/>${dials.map((_, i) => `<g transform="translate(200 ${120 + i * 180})"><circle r="70" fill="#111" stroke="#666" stroke-width="6"/>
      <path d="M0 -70 L0 -50" stroke="#3f3" stroke-width="8"/><g class="nd"><line x1="0" y1="0" x2="0" y2="-62" stroke="#ffd23f" stroke-width="10"/></g></g>
      <rect class="bt" data-i="${i}" x="380" y="${90 + i * 180}" width="170" height="60" rx="10" fill="#2f7fd6"/><text x="465" y="${130 + i * 180}" text-anchor="middle" font-size="26" fill="#fff" pointer-events="none">보정</text>`).join('')}`);
    const nds = s.querySelectorAll('.nd');
    let raf, last = performance.now();
    const loop = t => { const dt = (t - last) / 1000; last = t; dials.forEach((d, i) => { if (!d.lock) d.a = (d.a + d.sp * dt) % 360; nds[i].setAttribute('transform', `rotate(${d.a})`); }); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    s.querySelectorAll('.bt').forEach(b => b.onclick = () => {
      const i = +b.dataset.i, d = dials[i];
      if (dials.slice(0, i).some(x => !x.lock) || d.lock) return;
      if (d.a < 20 || d.a > 340) { d.lock = true; d.a = 0; b.setAttribute('fill', '#2a2'); sfx('click'); if (dials.every(x => x.lock)) done(); }
      else dials.forEach(x => (x.lock = false, x.a = Math.random() * 360)), s.querySelectorAll('.bt').forEach(x => x.setAttribute('fill', '#2f7fd6'));
    });
    msg(el, '바늘이 초록 표시에 오면 위부터 누르세요');
    return () => cancelAnimationFrame(raf);
  },
  leaves(el, done) {
    const lv = Array.from({ length: 6 }, () => ({ x: 280 + Math.random() * 280, y: 100 + Math.random() * 420, r: Math.random() * 360 }));
    const s = svg(el, `<rect width="${S}" height="${S}" fill="#7fa3ad"/><rect x="0" y="180" width="110" height="260" fill="#2b3236"/>${[0, 1, 2, 3, 4].map(i => `<rect x="10" y="${200 + i * 48}" width="90" height="10" fill="#444"/>`).join('')}<g class="lv"></g>`);
    const g = s.querySelector('.lv');
    const draw = () => { g.innerHTML = lv.map((l, i) => `<path data-i="${i}" transform="translate(${l.x} ${l.y}) rotate(${l.r})" d="M-34 0 Q0 -30 34 0 Q0 30 -34 0 Z" fill="#4c9a2a" stroke="#234" stroke-width="3"/>`).join(''); };
    draw();
    let cur = -1;
    dragger(el, {
      down: ([x, y]) => { cur = lv.findIndex(l => Math.hypot(l.x - x, l.y - y) < 44); if (cur < 0) return false; },
      move: ([x, y]) => { lv[cur].x = x; lv[cur].y = y; draw(); },
      up: ([x, y]) => { if (x < 110 && y > 170 && y < 450) { lv.splice(cur, 1); sfx('click'); draw(); if (!lv.length) done(); } },
    });
    msg(el, '나뭇잎을 왼쪽 배출구로 버리세요');
  },
  steer(el, done) {
    let x = 120 + Math.random() * 380, y = 120 + Math.random() * 380;
    const s = svg(el, `<rect width="${S}" height="${S}" fill="#0c1a33"/><circle cx="310" cy="310" r="260" fill="none" stroke="#2c6" stroke-width="3"/><circle cx="310" cy="310" r="40" fill="none" stroke="#2c6" stroke-width="3"/>
      <path d="M310 40 V580 M40 310 H580" stroke="#2c6" stroke-width="2"/><g class="ch"><circle r="34" fill="none" stroke="#fff" stroke-width="6"/><path d="M-50 0 H50 M0 -50 V50" stroke="#fff" stroke-width="4"/></g>`);
    const ch = s.querySelector('.ch'), set = () => ch.setAttribute('transform', `translate(${x} ${y})`);
    set(); msg(el, '조준선을 가운데로 옮기세요');
    dragger(el, { down: () => {}, move: ([px, py]) => { x = px; y = py; set(); }, up: () => { if (Math.hypot(x - 310, y - 310) < 30) { x = y = 310; set(); done(); } } });
  },
  asteroids(el, done) {
    let need = 15, rocks = [], raf, t0 = performance.now();
    const s = svg(el, `<rect width="${S}" height="${S}" fill="#020814"/><g class="rk"></g><text class="n" x="20" y="600" fill="#3f3" font-size="24"></text>`);
    const g = s.querySelector('.rk'), n = s.querySelector('.n');
    const loop = t => {
      const dt = Math.min(0.05, (t - t0) / 1000); t0 = t;
      if (Math.random() < dt * 2.2) rocks.push({ x: 660, y: 60 + Math.random() * 500, vx: -(120 + Math.random() * 140), vy: (Math.random() - 0.5) * 80, r: 22 + Math.random() * 22 });
      rocks = rocks.filter(r => (r.x += r.vx * dt, r.y += r.vy * dt, r.x > -60));
      g.innerHTML = rocks.map((r, i) => `<circle data-i="${i}" cx="${r.x}" cy="${r.y}" r="${r.r}" fill="#8a7a6a" stroke="#ccc" stroke-width="3"/>`).join('');
      n.textContent = `남은 소행성: ${need}`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    el.addEventListener('pointerdown', e => {
      const [x, y] = at(e, el), i = rocks.findIndex(r => Math.hypot(r.x - x, r.y - y) < r.r + 14);
      g.insertAdjacentHTML('beforeend', `<path d="M${x - 20} ${y} H${x + 20} M${x} ${y - 20} V${y + 20}" stroke="#3f3" stroke-width="4"/>`);
      if (i >= 0) { rocks.splice(i, 1); sfx('click'); if (--need <= 0) { cancelAnimationFrame(raf); done(); } }
    });
    return () => cancelAnimationFrame(raf);
  },
  garbage(el, done) {
    let p = 0, hold = false, raf, t0 = performance.now();
    const s = svg(el, `<rect width="${S}" height="${S}" fill="#4b5357"/><rect x="120" y="60" width="300" height="480" fill="#2d3336" stroke="#111" stroke-width="6"/><rect class="tr" x="130" y="70" width="280" height="460" fill="#6d5a3a"/>
      <rect x="480" y="120" width="30" height="360" fill="#222"/><g class="lv"><rect x="455" y="100" width="80" height="60" rx="10" fill="#d33"/></g>`);
    const tr = s.querySelector('.tr'), lv = s.querySelector('.lv');
    const loop = t => {
      const dt = (t - t0) / 1000; t0 = t;
      if (hold) p = Math.min(1, p + dt / 2.2);
      tr.setAttribute('height', 460 * (1 - p)); tr.setAttribute('y', 70 + 460 * p);
      lv.setAttribute('transform', `translate(0 ${hold ? 300 : 0})`);
      if (p >= 1) { cancelAnimationFrame(raf); return done(); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    dragger(el, { down: ([x]) => { if (x < 430) return false; hold = true; }, up: () => (hold = false) });
    msg(el, '오른쪽 레버를 누르고 있으세요');
    return () => cancelAnimationFrame(raf);
  },
  shields(el, done) {
    const hx = [[310, 160], [200, 240], [420, 240], [310, 310], [200, 390], [420, 390], [310, 460]];
    const red = new Set(shuffle([0, 1, 2, 3, 4, 5, 6]).slice(0, 3 + Math.floor(Math.random() * 3)));
    const hex = (x, y) => Array.from({ length: 6 }, (_, i) => `${x + 70 * Math.cos(i * Math.PI / 3)},${y + 70 * Math.sin(i * Math.PI / 3)}`).join(' ');
    const s = svg(el, `<rect width="${S}" height="${S}" fill="#1e2a33"/>${hx.map(([x, y], i) => `<polygon data-i="${i}" points="${hex(x, y)}" stroke="#000" stroke-width="5"/>`).join('')}`);
    const draw = () => s.querySelectorAll('polygon').forEach((p, i) => p.setAttribute('fill', red.has(i) ? '#e53935' : '#f4f4f4'));
    draw();
    s.onclick = e => { const i = e.target.dataset?.i; if (i === undefined) return; red.has(+i) ? red.delete(+i) : red.add(+i); sfx('click'); draw(); if (!red.size) done(); };
    msg(el, '빨간 칸을 모두 눌러 보호막을 켜세요');
  },
  simon(el, done) {
    let round = 1, seq = [], input = [], busy = true;
    const s = svg(el, `<rect width="${S}" height="${S}" fill="#2a3135"/>${Array.from({ length: 9 }, (_, i) => `<rect data-i="${i}" x="${90 + (i % 3) * 150}" y="${110 + Math.floor(i / 3) * 150}" width="130" height="130" rx="10" fill="#444"/>`).join('')}`);
    const cells = s.querySelectorAll('rect[data-i]');
    const flash = (i, c = '#4af') => { cells[i].setAttribute('fill', c); setTimeout(() => cells[i].setAttribute('fill', '#444'), 350); };
    const play = async () => {
      busy = true; input = []; msg(el, `원자로 가동 ${round}/4 — 순서를 기억하세요`);
      seq.push(Math.floor(Math.random() * 9));
      for (const i of seq) { await new Promise(r => setTimeout(r, 550)); flash(i); }
      busy = false;
    };
    s.onclick = e => {
      const i = e.target.dataset?.i;
      if (busy || i === undefined) return;
      flash(+i, '#3f3'); input.push(+i);
      if (seq[input.length - 1] !== +i) { msg(el, '틀렸습니다! 처음부터'); round = 1; seq = []; return setTimeout(play, 700); }
      if (input.length === seq.length) { if (++round > 4) return done(); setTimeout(play, 500); }
    };
    play();
  },
  scan(el, done, c) {
    let p = 0, raf, t0;
    const s = svg(el, `<rect width="${S}" height="${S}" fill="#26323a"/><rect x="60" y="80" width="500" height="40" fill="#111"/><rect class="b" x="60" y="80" width="0" height="40" fill="#3f3"/>
      <rect x="230" y="160" width="160" height="300" rx="20" fill="#355" stroke="#6ff" stroke-width="4"/><rect class="ln" x="230" y="160" width="160" height="6" fill="#6f6"/>
      <rect class="go" x="210" y="500" width="200" height="70" rx="12" fill="#2f7fd6"/><text x="310" y="545" text-anchor="middle" font-size="28" fill="#fff" pointer-events="none">스캔 시작</text>`);
    const b = s.querySelector('.b'), ln = s.querySelector('.ln');
    s.querySelector('.go').onclick = () => {
      if (raf) return;
      c.visual('scan', true); t0 = performance.now();
      const loop = t => { p = (t - t0) / 8000; b.setAttribute('width', 500 * Math.min(1, p)); ln.setAttribute('y', 160 + ((t / 4) % 294)); if (p >= 1) { c.visual('scan', false); return done(); } raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    };
    return () => { cancelAnimationFrame(raf); if (p < 1 && raf) c.visual('scan', false); };
  },
  upload(el, done, c) {
    const dl = c.station.startsWith('dl_');
    let raf;
    const s = svg(el, `<rect width="${S}" height="${S}" fill="#dfe6ea"/><rect x="60" y="140" width="140" height="110" fill="#f7c948" stroke="#333" stroke-width="4"/><rect x="420" y="140" width="140" height="110" fill="#f7c948" stroke="#333" stroke-width="4"/>
      <text x="130" y="290" text-anchor="middle" font-size="22" fill="#333">${dl ? '이 방' : '내 태블릿'}</text><text x="490" y="290" text-anchor="middle" font-size="22" fill="#333">${dl ? '내 태블릿' : '본부'}</text>
      <rect x="60" y="360" width="500" height="40" fill="#999"/><rect class="b" x="60" y="360" width="0" height="40" fill="#2a2"/><text class="pt" x="310" y="440" text-anchor="middle" font-size="24" fill="#333"></text>
      <rect class="go" x="210" y="480" width="200" height="70" rx="12" fill="#2f7fd6"/><text x="310" y="525" text-anchor="middle" font-size="28" fill="#fff" pointer-events="none">${dl ? '다운로드' : '업로드'}</text>`);
    s.querySelector('.go').onclick = () => {
      if (raf) return;
      const t0 = performance.now();
      const loop = t => { const p = Math.min(1, (t - t0) / 6000); s.querySelector('.b').setAttribute('width', 500 * p); s.querySelector('.pt').textContent = `${Math.round(p * 100)}%`; if (p >= 1) return done(); raf = requestAnimationFrame(loop); };
      raf = requestAnimationFrame(loop);
    };
    return () => cancelAnimationFrame(raf);
  },

  // ----- 사보타주 수리 -----
  hand(el, done, c) {
    const s = svg(el, `<rect width="${S}" height="${S}" fill="#1b2b3a"/><rect class="pad" x="160" y="120" width="300" height="380" rx="30" fill="#2b4d6b" stroke="#6cf" stroke-width="6"/>
      <path d="M260 450 V260 M300 450 V220 M340 450 V230 M380 450 V270 M230 460 Q200 380 220 340" stroke="#6cf" stroke-width="22" stroke-linecap="round" fill="none" opacity=".6"/>`);
    const pad = s.querySelector('.pad');
    msg(el, '손바닥을 누르고 있으세요 (반대편도 동시에 필요)');
    dragger(el, { down: () => { pad.setAttribute('fill', '#3a8fd6'); c.fix(true); }, up: () => { pad.setAttribute('fill', '#2b4d6b'); c.fix(false); } });
    return () => c.fix(false);
  },
  keypad(el, done, c) {
    const code = String(Math.floor(10000 + Math.random() * 90000));
    let typed = '';
    const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, '✗', 0, '✓'];
    const s = svg(el, `<rect width="${S}" height="${S}" fill="#3b3f42"/><rect x="40" y="60" width="170" height="150" fill="#fff59d" transform="rotate(-6 120 130)"/>
      <text x="125" y="120" text-anchor="middle" font-size="22" fill="#333">오늘의 코드</text><text x="125" y="170" text-anchor="middle" font-size="40" fill="#111" font-weight="bold">${code}</text>
      <rect x="260" y="50" width="320" height="60" fill="#111"/><text class="d" x="420" y="92" text-anchor="middle" font-size="36" fill="#3f3"></text>
      ${keys.map((k, i) => `<g data-k="${k}"><rect x="${270 + (i % 3) * 105}" y="${140 + Math.floor(i / 3) * 110}" width="95" height="95" rx="10" fill="#666"/><text x="${317 + (i % 3) * 105}" y="${200 + Math.floor(i / 3) * 110}" text-anchor="middle" font-size="36" fill="#fff" pointer-events="none">${k}</text></g>`).join('')}`);
    s.onclick = e => {
      const k = e.target.closest('[data-k]')?.dataset.k;
      if (k === undefined) return;
      sfx('click');
      if (k === '✗') typed = '';
      else if (k === '✓') { if (typed === code) { c.fix(true); return done(); } typed = ''; }
      else if (typed.length < 5) typed += k;
      s.querySelector('.d').textContent = typed;
    };
  },
  lights(el, done, c) {
    const sw = Array.from({ length: 5 }, () => Math.random() < 0.5);
    if (sw.every(Boolean)) sw[2] = false;
    const s = svg(el, `<rect width="${S}" height="${S}" fill="#2f3437"/>${sw.map((_, i) => `<g data-i="${i}"><rect x="${70 + i * 100}" y="200" width="80" height="220" rx="10" fill="#555"/><rect class="k" x="${85 + i * 100}" width="50" height="80" rx="8" fill="#ddd" pointer-events="none"/><circle class="led" cx="${110 + i * 100}" cy="460" r="16" pointer-events="none"/></g>`).join('')}`);
    const draw = () => s.querySelectorAll('[data-i]').forEach((g, i) => { g.querySelector('.k').setAttribute('y', sw[i] ? 215 : 325); g.querySelector('.led').setAttribute('fill', sw[i] ? '#3f3' : '#300'); });
    draw(); msg(el, '스위치를 모두 위로 올리세요');
    s.onclick = e => { const g = e.target.closest('[data-i]'); if (!g) return; sw[+g.dataset.i] = !sw[+g.dataset.i]; sfx('click'); draw(); if (sw.every(Boolean)) { c.fix(true); done(); } };
  },
  comms(el, done, c) {
    const target = Math.random() * 300 - 150;
    let a = target > 0 ? -150 : 150, okT = 0, raf, t0 = performance.now();
    const s = svg(el, `<rect width="${S}" height="${S}" fill="#1f262a"/><rect x="60" y="60" width="500" height="220" fill="#000"/><path class="wv" fill="none" stroke="#3f3" stroke-width="4"/>
      <g transform="translate(310 440)"><circle r="110" fill="#555" stroke="#222" stroke-width="8"/><g class="dl"><rect x="-8" y="-104" width="16" height="50" fill="#ffd23f"/></g></g>`);
    const wv = s.querySelector('.wv'), dl = s.querySelector('.dl');
    const loop = t => {
      const off = Math.abs(a - target) / 300, dt = (t - t0) / 1000; t0 = t;
      let d = 'M60 170';
      for (let x = 0; x <= 500; x += 10) d += ` L${60 + x} ${170 + Math.sin(x / 20 + t / 200) * 60 * (0.1 + off) + (Math.random() - 0.5) * 120 * off}`;
      wv.setAttribute('d', d); dl.setAttribute('transform', `rotate(${a})`);
      okT = off < 0.04 ? okT + dt : 0;
      if (okT > 0.8) { c.fix(true); return done(); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    dragger(el, { down: () => {}, move: ([x, y]) => { a = Math.max(-150, Math.min(150, Math.atan2(x - 310, 440 - y) * 180 / Math.PI)); } });
    msg(el, '다이얼을 돌려 신호를 맞추세요');
    return () => cancelAnimationFrame(raf);
  },
};

// 미니게임 창 열기
export function openGame(parent, name, title, ctx, onDone) {
  const back = document.createElement('div');
  back.className = 'mg-back';
  back.innerHTML = `<div class="mg"><button class="xbtn">✕</button></div>`;
  parent.append(back);
  const el = back.firstElementChild;
  let cleanup = null, finished = false;
  const close = () => { cleanup?.(); back.remove(); ctx.onClose?.(); };
  el.querySelector('.xbtn').onclick = () => { sfx('click'); close(); };
  const done = () => {
    if (finished) return;
    finished = true; sfx('task');
    el.insertAdjacentHTML('beforeend', '<div class="done">완료!</div>');
    setTimeout(() => { close(); onDone?.(); }, 700);
  };
  cleanup = GAMES[name](el, done, ctx) || null;
  if (title && !el.querySelector('.t')) el.insertAdjacentHTML('beforeend', `<div class="t">${title}</div>`);
  return { close, el };
}
