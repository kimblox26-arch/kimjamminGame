// 추가 미니게임: 범용(파라미터) 임무 + 각 맵 전용 임무 + 사보타주/문 수리
// 계약: GAMES2[id] = (el, done, ctx) => cleanup|undefined  (mgkit.js 참고)
import { S, sfx, at, svg, dragger, msg, rand, shuffle, animate } from './mgkit.js';

// 공용 배경: 금속 패널 + 나사
const DEFS = `<defs><linearGradient id="mg-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#77838a"/><stop offset="1" stop-color="#3f494f"/></linearGradient>
  <linearGradient id="mg-screen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16303a"/><stop offset="1" stop-color="#0a161c"/></linearGradient>
  <linearGradient id="mg-btn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4aa3ff"/><stop offset="1" stop-color="#1d5fb8"/></linearGradient>
  <radialGradient id="mg-red" cx=".4" cy=".35"><stop offset="0" stop-color="#ff8a80"/><stop offset="1" stop-color="#b71c1c"/></radialGradient></defs>`;
const screws = () => [[22, 22], [598, 22], [22, 598], [598, 598]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="#9aa5ab" stroke="#2b3236" stroke-width="3"/><path d="M${x - 5} ${y}h10" stroke="#2b3236" stroke-width="3"/>`).join('');
const bg = (inner = '', screen = true) => `${DEFS}<rect width="${S}" height="${S}" fill="url(#mg-metal)"/>${screws()}${screen ? '<rect x="40" y="60" width="540" height="520" rx="18" fill="url(#mg-screen)" stroke="#1b2125" stroke-width="6"/>' : ''}${inner}`;
const T = (x, y, s, size = 26, color = '#fff', extra = '') => `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="700" fill="${color}" font-family="sans-serif" ${extra}>${s}</text>`;
const btn = (x, y, w, h, label, cls = 'go', fill = 'url(#mg-btn)') => `<g class="${cls}" style="cursor:pointer"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${fill}" stroke="#0d2a4d" stroke-width="4"/>${T(x + w / 2, y + h / 2 + 10, label, 28, '#fff', 'pointer-events="none"')}</g>`;
const P = (c, k, d) => (c.params && c.params[k] !== undefined ? c.params[k] : d);
const label = (el, c, d) => msg(el, P(c, 'label', d));
// 진행바 기반 (다운로드/대기 등)
function progress(el, c, done, { seconds, title, from, to, auto }) {
  const s = svg(el, bg(`<g transform="translate(70 130)"><rect width="150" height="110" rx="10" fill="#f7c948" stroke="#5a4300" stroke-width="5"/><rect y="-20" width="70" height="30" rx="6" fill="#f7c948" stroke="#5a4300" stroke-width="5"/>${T(75, 150, from, 22, '#cfe')}</g>
    <g transform="translate(400 130)"><rect width="150" height="110" rx="10" fill="#f7c948" stroke="#5a4300" stroke-width="5"/><rect y="-20" width="70" height="30" rx="6" fill="#f7c948" stroke="#5a4300" stroke-width="5"/>${T(75, 150, to, 22, '#cfe')}</g>
    <g class="file" opacity="0"><rect width="40" height="50" rx="4" fill="#fff" stroke="#333" stroke-width="3"/></g>
    <rect x="70" y="360" width="480" height="38" rx="8" fill="#0b1a20" stroke="#2fe38a" stroke-width="3"/><rect class="bar" x="74" y="364" width="0" height="30" rx="6" fill="#2fe38a"/>${T(310, 438, '', 24, '#9fd', 'class="pt"')}
    ${auto ? '' : btn(210, 470, 200, 74, title)}`));
  const bar = s.querySelector('.bar'), pt = s.querySelector('.pt'), file = s.querySelector('.file');
  let stop = null;
  const run = () => {
    if (stop) return;
    const t0 = performance.now();
    stop = animate((dt, t) => {
      const p = Math.min(1, (t - t0) / (seconds * 1000));
      bar.setAttribute('width', 472 * p); pt.textContent = `${Math.round(p * 100)}%  · 남은 시간 ${Math.ceil(seconds * (1 - p))}초`;
      const f = ((t - t0) / 900) % 1; file.setAttribute('opacity', p < 1 ? 1 : 0); file.setAttribute('transform', `translate(${125 + f * 330} ${170 - Math.sin(f * Math.PI) * 90})`);
      if (p >= 1) { done(); return false; }
    });
  };
  if (auto) run(); else s.querySelector('.go').onclick = run;
  return () => stop?.();
}

export const GAMES2 = {
  // ---------- 범용 ----------
  hold(el, done, c) {
    const secs = P(c, 'seconds', 3), icon = P(c, 'icon', '✋');
    const s = svg(el, bg(`<circle cx="310" cy="330" r="170" fill="#0b1a20" stroke="#2b3a40" stroke-width="10"/><circle class="ring" cx="310" cy="330" r="170" fill="none" stroke="#2fe38a" stroke-width="14" stroke-dasharray="0 1100" transform="rotate(-90 310 330)"/>
      <g class="pad" style="cursor:pointer"><circle cx="310" cy="330" r="130" fill="url(#mg-red)" stroke="#5a0000" stroke-width="8"/>${T(310, 352, icon, 80, '#fff', 'pointer-events="none"')}</g>`));
    label(el, c, '버튼을 누르고 있으세요');
    let p = 0, holding = false;
    const ring = s.querySelector('.ring');
    dragger(el, { down: () => { holding = true; }, up: () => (holding = false) });
    return animate(dt => {
      if (holding) p = Math.min(1, p + dt / secs);
      ring.setAttribute('stroke-dasharray', `${1068 * p} 1100`);
      if (p >= 1) { done(); return false; }
    });
  },
  tap(el, done, c) {
    const n = P(c, 'count', 6), icon = P(c, 'icon', '⭐');
    const pts = Array.from({ length: n }, () => [rand(110, 510), rand(150, 520)]);
    const s = svg(el, bg(pts.map(([x, y], i) => `<g class="it" data-i="${i}" style="cursor:pointer"><circle cx="${x}" cy="${y}" r="42" fill="rgba(255,255,255,.08)"/>${T(x, y + 18, icon, 52, '#fff', 'pointer-events="none"')}</g>`).join('')));
    label(el, c, `${n}개를 모두 누르세요`);
    let left = n;
    s.onclick = e => { const g = e.target.closest('.it'); if (!g) return; g.remove(); sfx('click'); if (--left <= 0) done(); };
  },
  drag(el, done, c) {
    const n = P(c, 'count', 5), icon = P(c, 'icon', '📦'), target = P(c, 'target', '🗑️');
    const items = Array.from({ length: n }, (_, i) => ({ x: rand(90, 250), y: 130 + i * (400 / n) + rand(0, 30), on: true }));
    const s = svg(el, bg(`<rect x="380" y="200" width="180" height="230" rx="18" fill="#0b2a20" stroke="#2fe38a" stroke-width="5" stroke-dasharray="14 10"/>${T(470, 340, target, 90)}<g class="its"></g>`));
    const g = s.querySelector('.its');
    const draw = () => (g.innerHTML = items.map((it, i) => (it.on ? T(it.x, it.y + 20, icon, 56, '#fff', `data-i="${i}"`) : '')).join(''));
    draw(); label(el, c, '물건을 오른쪽 칸으로 옮기세요');
    let cur = -1;
    dragger(el, {
      down: ([x, y]) => { cur = items.findIndex(it => it.on && Math.hypot(it.x - x, it.y - y) < 46); if (cur < 0) return false; },
      move: ([x, y]) => { items[cur].x = x; items[cur].y = y; draw(); },
      up: ([x, y]) => { if (x > 370 && x < 570 && y > 190 && y < 440) { items[cur].on = false; sfx('click'); draw(); if (!items.some(i => i.on)) done(); } },
    });
  },
  idcode(el, done, c) {
    const code = String(P(c, 'code', Math.floor(10000 + Math.random() * 90000)));
    let typed = '';
    const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, '✗', 0, '✓'];
    const s = svg(el, bg(`<g transform="translate(60 90) rotate(-4)"><rect width="200" height="130" rx="12" fill="#f4f6f8" stroke="#333" stroke-width="4"/><rect x="14" y="16" width="56" height="70" rx="6" fill="#9fc3ff"/>${T(135, 50, 'ID', 26, '#333')}${T(100, 112, code, 32, '#111')}</g>
      <rect x="290" y="80" width="280" height="64" rx="8" fill="#000" stroke="#2fe38a" stroke-width="3"/>${T(430, 124, '', 36, '#2fe38a', 'class="d"')}
      ${keys.map((k, i) => `<g data-k="${k}" style="cursor:pointer"><rect x="${300 + (i % 3) * 92}" y="${170 + Math.floor(i / 3) * 96}" width="80" height="82" rx="12" fill="#3d474d" stroke="#1b2125" stroke-width="4"/>${T(340 + (i % 3) * 92, 222 + Math.floor(i / 3) * 96, k, 34, '#fff', 'pointer-events="none"')}</g>`).join('')}`));
    label(el, c, '카드의 ID 코드를 입력하세요');
    s.onclick = e => {
      const k = e.target.closest('[data-k]')?.dataset.k;
      if (k === undefined) return;
      sfx('click');
      if (k === '✗') typed = '';
      else if (k === '✓') { if (typed === code) return done(); typed = ''; msg(el, '코드가 틀렸습니다'); }
      else if (typed.length < code.length) typed += k;
      s.querySelector('.d').textContent = typed;
    };
  },
  dial(el, done, c) {
    const target = rand(-120, 120);
    let a = target > 0 ? -140 : 140, okT = 0;
    const s = svg(el, bg(`<path d="M120 300 A190 190 0 0 1 500 300" fill="none" stroke="#2b3a40" stroke-width="30"/><path class="zone" fill="none" stroke="#2fe38a" stroke-width="30"/>
      <g transform="translate(310 420)"><circle r="120" fill="#55626a" stroke="#1b2125" stroke-width="8"/><g class="k"><rect x="-10" y="-112" width="20" height="56" rx="6" fill="#ffd23f"/></g><circle r="30" fill="#2b3338"/></g>
      <g class="needle"><line x1="310" y1="300" x2="310" y2="130" stroke="#ff5252" stroke-width="6"/></g>`));
    const ang = d => (d * Math.PI) / 180, zone = s.querySelector('.zone');
    const z0 = ang(target * 0.75 - 90 - 8), z1 = ang(target * 0.75 - 90 + 8);
    zone.setAttribute('d', `M${310 + Math.cos(z0) * 190} ${300 + Math.sin(z0) * 190} A190 190 0 0 1 ${310 + Math.cos(z1) * 190} ${300 + Math.sin(z1) * 190}`);
    label(el, c, '다이얼을 돌려 바늘을 초록색에 맞추세요');
    dragger(el, { down: () => {}, move: ([x, y]) => { a = Math.max(-160, Math.min(160, (Math.atan2(x - 310, 420 - y) * 180) / Math.PI)); } });
    return animate(dt => {
      s.querySelector('.k').setAttribute('transform', `rotate(${a})`);
      s.querySelector('.needle').setAttribute('transform', `rotate(${a * 0.75} 310 300)`);
      okT = Math.abs(a - target) < 9 ? okT + dt : 0;
      if (okT > 0.7) { done(); return false; }
    });
  },
  switches(el, done, c) {
    const n = Math.min(8, P(c, 'count', 6)), sw = Array.from({ length: n }, () => Math.random() < 0.5);
    if (sw.every(Boolean)) sw[0] = false;
    const w = 480 / n;
    const s = svg(el, bg(sw.map((_, i) => `<g data-i="${i}" style="cursor:pointer"><rect x="${70 + i * w + 6}" y="200" width="${w - 12}" height="240" rx="12" fill="#2b3338" stroke="#1b2125" stroke-width="4"/>
      <rect class="k" x="${70 + i * w + 16}" width="${w - 32}" height="100" rx="10" fill="#d9dee2" pointer-events="none"/><circle class="led" cx="${70 + i * w + w / 2}" cy="480" r="16" pointer-events="none"/></g>`).join('')));
    const draw = () => s.querySelectorAll('[data-i]').forEach((g, i) => { g.querySelector('.k').setAttribute('y', sw[i] ? 214 : 326); g.querySelector('.led').setAttribute('fill', sw[i] ? '#3f3' : '#400'); });
    draw(); label(el, c, '스위치를 모두 켜세요');
    s.onclick = e => { const g = e.target.closest('[data-i]'); if (!g) return; sw[+g.dataset.i] = !sw[+g.dataset.i]; sfx('click'); draw(); if (sw.every(Boolean)) done(); };
  },
  sequence(el, done, c) {
    const n = P(c, 'count', 6), cells = 9;
    const order = Array.from({ length: n }, () => Math.floor(Math.random() * cells));
    let i = 0;
    const s = svg(el, bg(Array.from({ length: cells }, (_, k) => `<rect data-i="${k}" x="${120 + (k % 3) * 130}" y="${130 + Math.floor(k / 3) * 130}" width="110" height="110" rx="14" fill="#2b3a40" stroke="#1b2125" stroke-width="5" style="cursor:pointer"/>`).join('')));
    const lit = () => s.querySelectorAll('[data-i]').forEach(r => r.setAttribute('fill', +r.dataset.i === order[i] ? '#ffd23f' : '#2b3a40'));
    lit(); label(el, c, `켜지는 칸을 차례대로 누르세요 (0/${n})`);
    s.onclick = e => {
      const k = e.target.dataset?.i;
      if (k === undefined) return;
      if (+k !== order[i]) { sfx('click'); return; }
      sfx('vote'); i++; msg(el, `켜지는 칸을 차례대로 누르세요 (${i}/${n})`);
      if (i >= n) return done();
      lit();
    };
  },
  fill(el, done, c) {
    const col = P(c, 'color', '#3fa9ff'), lo = rand(0.55, 0.7), hi = lo + 0.12;
    let p = 0, holding = false;
    const s = svg(el, bg(`<rect x="220" y="100" width="180" height="400" rx="20" fill="#0b1a20" stroke="#9fb" stroke-width="5"/><rect class="liq" x="226" width="168" rx="14" fill="${col}"/>
      <rect x="200" y="${500 - hi * 400}" width="220" height="${(hi - lo) * 400}" fill="none" stroke="#ffd23f" stroke-width="4" stroke-dasharray="10 8"/>${btn(430, 420, 140, 80, '붓기', 'pump')}`));
    label(el, c, '노란 선 사이에서 멈추세요');
    dragger(el, { down: ([x, y]) => { if (x < 420 || y < 410) return false; holding = true; }, up: () => { holding = false; if (p >= lo && p <= hi) { done(); stop(); } else if (p > hi) { p = 0; msg(el, '너무 많이 부었습니다! 다시'); } } });
    const stop = animate(dt => {
      if (holding) p = Math.min(1, p + dt * 0.35);
      const l = s.querySelector('.liq'); l.setAttribute('y', 494 - p * 388); l.setAttribute('height', p * 388);
    });
    return stop;
  },
  wait(el, done, c) {
    label(el, c, '잠시 기다리세요');
    return progress(el, c, done, { seconds: P(c, 'seconds', 10), title: '', from: '측정', to: '결과', auto: true });
  },
  sort(el, done, c) {
    const groups = P(c, 'groups', ['🍎', '🍌', '🍇']), n = 7;
    const items = Array.from({ length: n }, () => ({ g: Math.floor(Math.random() * groups.length), x: rand(100, 520), y: rand(130, 330), on: true }));
    const bw = 480 / groups.length;
    const s = svg(el, bg(`${groups.map((gname, i) => `<rect x="${70 + i * bw + 8}" y="400" width="${bw - 16}" height="150" rx="14" fill="#0b2a20" stroke="#2fe38a" stroke-width="4"/>${T(70 + i * bw + bw / 2, 500, gname, 60)}`).join('')}<g class="its"></g>`));
    const g = s.querySelector('.its');
    const draw = () => (g.innerHTML = items.map(it => (it.on ? T(it.x, it.y + 18, groups[it.g], 52) : '')).join(''));
    draw(); label(el, c, '같은 종류끼리 아래 칸에 나누세요');
    let cur = -1;
    dragger(el, {
      down: ([x, y]) => { cur = items.findIndex(it => it.on && Math.hypot(it.x - x, it.y - y) < 44); if (cur < 0) return false; },
      move: ([x, y]) => { items[cur].x = x; items[cur].y = y; draw(); },
      up: ([x, y]) => {
        const bin = Math.floor((x - 70) / bw);
        if (y > 390 && bin === items[cur].g) { items[cur].on = false; sfx('click'); if (!items.some(i => i.on)) done(); }
        else if (y > 390) { items[cur].y = 300; msg(el, '다른 칸입니다'); }
        draw();
      },
    });
  },
  find(el, done, c) {
    const tx = rand(-500, 500), ty = rand(-400, 400);
    let ox = 0, oy = 0, sx = 0, sy = 0;
    const stars = Array.from({ length: 70 }, () => `<circle cx="${rand(-900, 900)}" cy="${rand(-800, 800)}" r="${rand(1, 4)}" fill="#fff"/>`).join('');
    const s = svg(el, bg(`<clipPath id="mg-lens"><circle cx="310" cy="320" r="240"/></clipPath><g clip-path="url(#mg-lens)"><rect x="70" y="80" width="480" height="480" fill="#030812"/><g class="sky">${stars}${T(tx, ty, '🪐', 70)}</g></g>
      <circle cx="310" cy="320" r="240" fill="none" stroke="#1b2125" stroke-width="14"/><circle cx="310" cy="320" r="34" fill="none" stroke="#2fe38a" stroke-width="4"/><path d="M310 260v30M310 350v30M250 320h30M340 320h30" stroke="#2fe38a" stroke-width="4"/>`));
    label(el, c, '화면을 끌어 행성을 가운데에 맞추세요');
    const sky = s.querySelector('.sky'), put = () => sky.setAttribute('transform', `translate(${310 + ox} ${320 + oy})`);
    put();
    dragger(el, {
      down: ([x, y]) => { sx = x - ox; sy = y - oy; },
      move: ([x, y]) => { ox = Math.max(-700, Math.min(700, x - sx)); oy = Math.max(-700, Math.min(700, y - sy)); put(); },
      up: () => { if (Math.hypot(tx + ox, ty - 20 + oy) < 40) done(); },
    });
  },
  match(el, done, c) {
    const n = Math.min(6, P(c, 'pairs', 4)), pool = ['🔺', '🔷', '⭐', '🌙', '💎', '🍀'];
    const cards = shuffle([...pool.slice(0, n), ...pool.slice(0, n)]).map(v => ({ v, open: false, gone: false }));
    const cols = 4, w = 120, h = 130;
    const s = svg(el, bg(cards.map((_, i) => `<g data-i="${i}" style="cursor:pointer"><rect x="${70 + (i % cols) * 125}" y="${110 + Math.floor(i / cols) * 140}" width="${w}" height="${h}" rx="14" stroke="#1b2125" stroke-width="4"/><text x="${70 + (i % cols) * 125 + w / 2}" y="${110 + Math.floor(i / cols) * 140 + 85}" text-anchor="middle" font-size="56" pointer-events="none"></text></g>`).join('')));
    const draw = () => s.querySelectorAll('[data-i]').forEach((g, i) => { const cd = cards[i]; g.style.opacity = cd.gone ? 0.15 : 1; g.querySelector('rect').setAttribute('fill', cd.open ? '#e8eef2' : '#3a6aa8'); g.querySelector('text').textContent = cd.open || cd.gone ? cd.v : ''; });
    draw(); label(el, c, '같은 그림 짝을 찾으세요');
    let first = -1, busy = false;
    s.onclick = e => {
      const g = e.target.closest('[data-i]'), i = g && +g.dataset.i;
      if (g == null || busy || cards[i].open || cards[i].gone) return;
      cards[i].open = true; sfx('click'); draw();
      if (first < 0) { first = i; return; }
      const j = first; first = -1; busy = true;
      setTimeout(() => {
        if (cards[i].v === cards[j].v) { cards[i].gone = cards[j].gone = true; }
        cards[i].open = cards[j].open = false; busy = false; draw();
        if (cards.every(cd => cd.gone)) done();
      }, 500);
    };
  },
  slider(el, done, c) {
    const target = rand(0.15, 0.85);
    let v = target > 0.5 ? 0.05 : 0.95;
    const s = svg(el, bg(`<rect x="90" y="300" width="440" height="20" rx="10" fill="#0b1a20"/><rect x="${90 + target * 440 - 18}" y="270" width="36" height="80" rx="8" fill="none" stroke="#2fe38a" stroke-width="5"/>
      <g class="kn"><rect x="-22" y="276" width="44" height="68" rx="10" fill="#ffd23f" stroke="#5a4300" stroke-width="4"/></g>`));
    const put = () => s.querySelector('.kn').setAttribute('transform', `translate(${90 + v * 440} 0)`);
    put(); label(el, c, '슬라이더를 초록 칸에 맞추세요');
    dragger(el, { down: () => {}, move: ([x]) => { v = Math.max(0, Math.min(1, (x - 90) / 440)); put(); }, up: () => { if (Math.abs(v - target) < 0.035) done(); } });
  },
  rotate(el, done, c) {
    const rot = [0, 0, 0, 0].map(() => (1 + Math.floor(Math.random() * 3)) * 90);
    const pieces = ['M0 0H110V110H0Z', 'M0 0H110V110H0Z', 'M0 0H110V110H0Z', 'M0 0H110V110H0Z'];
    const s = svg(el, bg(pieces.map((d, i) => `<g data-i="${i}" style="cursor:pointer" transform="translate(${190 + (i % 2) * 125} ${180 + Math.floor(i / 2) * 125})"><g class="r"><path d="${d}" fill="#3a6aa8" stroke="#1b2125" stroke-width="4"/>
      <path d="M55 12L80 50H66V96H44V50H30Z" fill="#ffd23f"/></g></g>`).join('')));
    const draw = () => s.querySelectorAll('[data-i]').forEach((g, i) => g.querySelector('.r').setAttribute('transform', `rotate(${rot[i]} 55 55)`));
    draw(); label(el, c, '조각을 눌러 모든 화살표를 위로 맞추세요');
    s.onclick = e => { const g = e.target.closest('[data-i]'); if (!g) return; const i = +g.dataset.i; rot[i] = (rot[i] + 90) % 360; sfx('click'); draw(); if (rot.every(r => r === 0)) done(); };
  },
  clean(el, done, c) {
    const icon = P(c, 'icon', '💎');
    el.insertAdjacentHTML('beforeend', `<svg class="full" viewBox="0 0 ${S} ${S}">${bg(T(310, 380, icon, 220))}</svg><canvas width="${S}" height="${S}" style="position:absolute;inset:0;width:100%;height:100%"></canvas>`);
    const cv = el.querySelector('canvas'), g = cv.getContext('2d');
    g.fillStyle = '#6b5a3a'; g.globalAlpha = 0.95;
    for (let i = 0; i < 70; i++) { g.beginPath(); g.arc(rand(170, 450), rand(170, 470), rand(20, 60), 0, 7); g.fill(); }
    label(el, c, '문질러서 닦으세요');
    const total = () => { const d = g.getImageData(150, 150, 320, 340).data; let n = 0; for (let i = 3; i < d.length; i += 64) if (d[i] > 40) n++; return n; };
    const start = total();
    g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 1;
    let rubbing = false, n = 0;
    cv.addEventListener('pointerdown', e => { rubbing = true; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointerup', () => (rubbing = false));
    cv.addEventListener('pointermove', e => {
      if (!rubbing) return;
      const [x, y] = at(e, el); g.beginPath(); g.arc(x, y, 38, 0, 7); g.fill();
      if (++n % 10 === 0 && total() < start * 0.12) done();
    });
  },

  // ---------- 맵 임무 전용 ----------
  download(el, done, c) { return progress(el, c, done, { seconds: P(c, 'seconds', 8), title: '다운로드', from: '이 방', to: '내 태블릿' }); },
  upload(el, done, c) { return progress(el, c, done, { seconds: P(c, 'seconds', 8), title: '업로드', from: '내 태블릿', to: '본부' }); },
  divert(el, done) {
    const n = 8, t = Math.floor(Math.random() * n), v = Array(n).fill(0);
    const s = svg(el, bg(Array.from({ length: n }, (_, i) => `<rect x="${78 + i * 60}" y="160" width="20" height="340" rx="10" fill="#0b1a20"/>
      <rect class="k" data-i="${i}" x="${68 + i * 60}" width="40" height="40" rx="8" fill="${i === t ? '#ffd23f' : '#55626a'}" stroke="#1b2125" stroke-width="3"/>
      <circle cx="${88 + i * 60}" cy="130" r="12" fill="${i === t ? '#f33' : '#333'}"/>`).join('')));
    msg(el, '빨간 불이 켜진 슬라이더를 끝까지 올리세요');
    const put = () => s.querySelectorAll('.k').forEach((k, i) => k.setAttribute('y', 460 - v[i] * 300));
    put();
    dragger(el, { down: ([x]) => { if (Math.abs(x - (88 + t * 60)) > 40) return false; }, move: ([, y]) => { v[t] = Math.max(0, Math.min(1, (480 - y) / 300)); put(); }, up: () => { if (v[t] > 0.95) done(); } });
  },
  accept_power(el, done) {
    const s = svg(el, bg(`<g class="sw" style="cursor:pointer"><rect x="230" y="190" width="160" height="260" rx="20" fill="#2b3338" stroke="#1b2125" stroke-width="6"/><rect class="k" x="250" y="330" width="120" height="100" rx="14" fill="#d9dee2"/></g>
      <path class="bolt" d="M330 90L270 170H310L290 240L360 150H318Z" fill="#555"/>`));
    msg(el, '스위치를 올려 전력을 받으세요');
    s.querySelector('.sw').onclick = () => { s.querySelector('.k').setAttribute('y', 210); s.querySelector('.bolt').setAttribute('fill', '#ffd23f'); sfx('task'); setTimeout(done, 300); };
  },
  fuel_fill(el, done, c) { return GAMES2.hold(el, done, { params: { seconds: 3, icon: '⛽', label: P(c, 'label', '버튼을 눌러 연료통을 채우세요') } }); },
  fuel_empty(el, done, c) { return GAMES2.hold(el, done, { params: { seconds: 3, icon: '🛢️', label: P(c, 'label', '버튼을 눌러 엔진에 연료를 넣으세요') } }); },
  inspect_start(el, done, c) {
    const s = svg(el, bg(`${[0, 1, 2, 3, 4].map(i => `<rect x="${110 + i * 85}" y="200" width="50" height="200" rx="20" fill="#cfe9ff" stroke="#333" stroke-width="4"/>`).join('')}${btn(200, 450, 220, 80, '검사 시작')}`));
    msg(el, '샘플 검사를 시작하세요 (60초 뒤 결과 확인)');
    s.querySelector('.go').onclick = () => { try { sessionStorage.setItem('au_insp_' + (c.station || ''), String(Date.now())); } catch { /* 저장 불가 */ } done(); };
  },
  inspect_result(el, done, c) {
    let t0 = 0;
    try { t0 = +sessionStorage.getItem('au_insp_' + (c.station || '')) || 0; } catch { /* 저장 불가 */ }
    const left = () => Math.ceil((t0 + 60000 - Date.now()) / 1000);
    const bad = Math.floor(Math.random() * 5);
    const s = svg(el, bg(`${[0, 1, 2, 3, 4].map(i => `<g data-i="${i}" style="cursor:pointer"><rect x="${110 + i * 85}" y="200" width="50" height="200" rx="20" fill="#cfe9ff" stroke="#333" stroke-width="4"/>
      <rect class="liq" x="${114 + i * 85}" y="290" width="42" height="106" rx="16" fill="#3fa9ff"/></g>`).join('')}${T(310, 500, '', 30, '#ffd23f', 'class="cd"')}`));
    const stop = animate(() => {
      const l = left();
      s.querySelector('.cd').textContent = l > 0 ? `남은 시간 ${l}초` : '';
      if (l <= 0) { s.querySelectorAll('[data-i]').forEach((g, i) => g.querySelector('.liq').setAttribute('fill', i === bad ? '#ff3b3b' : '#3fa9ff')); msg(el, '이상한 샘플을 고르세요'); return false; }
      msg(el, '검사 중입니다…');
    });
    s.onclick = e => { const g = e.target.closest('[data-i]'); if (!g || left() > 0) return; if (+g.dataset.i === bad) done(); else msg(el, '정상 샘플입니다. 다시 고르세요'); };
    return stop;
  },
  numbers(el, done, c) {
    const n = Math.min(12, P(c, 'count', 10)), nums = shuffle(Array.from({ length: n }, (_, i) => i + 1)), cols = n > 9 ? 5 : 3;
    let next = 1;
    const s = svg(el, bg(nums.map((v, i) => `<g data-v="${v}" style="cursor:pointer"><rect x="${80 + (i % cols) * (460 / cols)}" y="${150 + Math.floor(i / cols) * 120}" width="${460 / cols - 14}" height="100" rx="12" fill="#2b3a40" stroke="#1b2125" stroke-width="4"/>
      ${T(80 + (i % cols) * (460 / cols) + (460 / cols - 14) / 2, 150 + Math.floor(i / cols) * 120 + 64, v, 38, '#fff', 'pointer-events="none"')}</g>`).join('')));
    label(el, c, `1부터 ${n}까지 순서대로 누르세요`);
    s.onclick = e => {
      const g = e.target.closest('[data-v]');
      if (!g) return;
      if (+g.dataset.v === next) { g.querySelector('rect').setAttribute('fill', '#1d7a4a'); sfx('click'); if (++next > n) done(); }
      else { next = 1; s.querySelectorAll('[data-v] rect').forEach(r => r.setAttribute('fill', '#2b3a40')); msg(el, '틀렸습니다! 처음부터'); }
    };
  },
  chart(el, done) {
    const pts = [[110, 470], [220, 320], [330, 420], [430, 230], [520, 140]];
    let i = 1, ship = [...pts[0]];
    const s = svg(el, bg(`<path d="M${pts.map(p => p.join(' ')).join(' L')}" fill="none" stroke="#2fe38a" stroke-width="4" stroke-dasharray="12 10"/>${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="16" fill="#0b2a20" stroke="#2fe38a" stroke-width="4"/>`).join('')}<g class="ship"><path d="M0 -26L18 18L0 8L-18 18Z" fill="#ffd23f" stroke="#5a4300" stroke-width="3"/></g>`));
    const put = () => s.querySelector('.ship').setAttribute('transform', `translate(${ship[0]} ${ship[1]})`);
    put(); msg(el, '배를 끌어 점을 차례대로 지나가세요');
    dragger(el, {
      down: ([x, y]) => { if (Math.hypot(x - ship[0], y - ship[1]) > 60) return false; },
      move: ([x, y]) => { ship = [x, y]; put(); if (Math.hypot(x - pts[i][0], y - pts[i][1]) < 26) { sfx('click'); if (++i >= pts.length) done(); } },
      up: () => { ship = [...pts[i - 1]]; put(); },
    });
  },
  vent_clean(el, done) {
    const n = 6;
    const s = svg(el, bg(`${Array.from({ length: 7 }, (_, k) => `<rect x="90" y="${130 + k * 64}" width="440" height="14" rx="6" fill="#2b3338"/>`).join('')}
      ${Array.from({ length: n }, () => `<g class="it" style="cursor:pointer">${T(rand(130, 490), rand(170, 540), ['🍂', '🧦', '🦴', '🪨', '📄'][Math.floor(Math.random() * 5)], 50)}</g>`).join('')}`));
    msg(el, '벤트 안의 쓰레기를 모두 치우세요');
    let left = n;
    s.onclick = e => { const g = e.target.closest('.it'); if (!g) return; g.remove(); sfx('click'); if (--left <= 0) done(); };
  },

  // ---------- 사보타주 / 문 ----------
  comms_code(el, done, c) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    return GAMES2.idcode(el, () => { c.fix?.(true); done(); }, { ...c, params: { code, label: `통신 코드 ${code} 를 입력하세요` } });
  },
  seismic(el, done, c) {
    let v = rand(0.05, 0.25), okT = 0;
    const s = svg(el, bg(`<rect x="290" y="110" width="40" height="420" rx="18" fill="#0b1a20"/><rect x="250" y="${110 + 420 * 0.45}" width="120" height="${420 * 0.1}" fill="rgba(47,227,138,.25)" stroke="#2fe38a" stroke-width="4"/>
      <g class="kn"><rect x="240" y="-28" width="140" height="56" rx="12" fill="#ffd23f" stroke="#5a4300" stroke-width="4"/></g><path class="wave" fill="none" stroke="#ff5252" stroke-width="4"/>`));
    msg(el, '손잡이를 초록 줄에 맞추고 잠시 유지하세요');
    dragger(el, { down: () => {}, move: ([, y]) => { v = Math.max(0, Math.min(1, (y - 110) / 420)); } });
    return animate((dt, t) => {
      s.querySelector('.kn').setAttribute('transform', `translate(0 ${110 + v * 420})`);
      const off = Math.abs(v - 0.5);
      let d = 'M60 320'; for (let x = 0; x <= 160; x += 8) d += ` L${60 + x} ${320 + Math.sin(x / 10 + t / 90) * 80 * (off * 2 + 0.05)}`;
      s.querySelector('.wave').setAttribute('d', d);
      okT = off < 0.05 ? okT + dt : 0;
      if (okT > 1) { c.fix?.(true); done(); return false; }
    });
  },
  crash(el, done, c) {
    const code = String(Math.floor(10000 + Math.random() * 90000));
    return GAMES2.idcode(el, () => { c.fix?.(true); done(); }, { ...c, params: { code, label: `추락 방지: 비행 코드 ${code} 를 입력하세요` } });
  },
  mixup(el, done, c) {
    let n = 0;
    const s = svg(el, bg(`<g class="m" style="cursor:pointer">${T(310, 400, '🍄', 260)}</g>${T(310, 520, '', 28, '#ffd23f', 'class="cnt"')}`));
    msg(el, '버섯을 여러 번 눌러 포자를 털어내세요');
    s.querySelector('.m').onclick = () => {
      n++; sfx('click'); s.querySelector('.cnt').textContent = `${n}/8`;
      s.querySelector('.m').setAttribute('transform', `translate(310 330) scale(${1 - n * 0.05}) translate(-310 -330)`);
      if (n >= 8) { c.fix?.(true); done(); }
    };
  },
  lever(el, done, c) { // 레버를 끝까지 내리기(params.up 이면 올리기)
    const up = !!P(c, 'up', false);
    let v = up ? 1 : 0;
    const s = svg(el, bg(`<rect x="280" y="140" width="60" height="360" rx="24" fill="#0b1a20"/>${T(310, 125, up ? '▲' : '', 30, '#ffd23f')}${T(310, 545, up ? '' : '▼', 30, '#ffd23f')}<g class="kn"><rect x="230" y="-36" width="160" height="72" rx="16" fill="url(#mg-red)" stroke="#5a0000" stroke-width="5"/></g>`));
    label(el, c, up ? '레버를 끝까지 올리세요' : '레버를 끝까지 내리세요');
    const put = () => s.querySelector('.kn').setAttribute('transform', `translate(0 ${150 + v * 340})`);
    put();
    dragger(el, { down: () => !c.locked?.(), move: ([, y]) => { v = Math.max(0, Math.min(1, (y - 150) / 340)); put(); }, up: () => { if (up ? v < 0.07 : v > 0.93) done(); else { v = up ? 1 : 0; put(); } } });
  },
  wifi(el, done, c) { // Wi-Fi 재부팅: 레버 내림 → 60초 → 레버 올림
    const key = 'au_wifi_' + (c.station || '');
    let t0 = 0;
    try { t0 = +sessionStorage.getItem(key) || 0; } catch { /* 저장 불가 */ }
    if (!c.step) return GAMES2.lever(el, () => { try { sessionStorage.setItem(key, String(Date.now())); } catch { /* 저장 불가 */ } done(); }, { params: { label: '레버를 내려 Wi-Fi를 끄세요 (60초 뒤 다시 켜기)' } });
    const left = () => Math.ceil((t0 + 60000 - Date.now()) / 1000);
    const stop = GAMES2.lever(el, () => { msg(el, '재부팅 완료'); done(); }, { params: { up: true }, locked: () => left() > 0 });
    const tick = animate(() => { const l = left(); msg(el, l > 0 ? `${l}초 후 돌아오세요` : '레버를 올려 Wi-Fi를 켜세요'); if (l <= 0) return false; });
    return () => { stop?.(); tick(); };
  },
  door_switch(el, done) { // 폴루스 문: 차단기 재설정 (빨갛게 켜진 스위치를 모두 내리기)
    const n = 8, lit = shuffle([...Array(n).keys()]).slice(0, 4), on = new Set(lit);
    const s = svg(el, bg(`${T(310, 115, '차단기 재설정', 30, '#ffd23f')}${[...Array(n).keys()].map(i => { const x = 75 + (i % 4) * 125, y = 170 + Math.floor(i / 4) * 200;
      return `<g data-i="${i}" style="cursor:pointer"><rect x="${x}" y="${y}" width="96" height="160" rx="12" fill="#1b2328" stroke="#0b0f12" stroke-width="5"/><circle class="led" cx="${x + 48}" cy="${y + 22}" r="10"/><rect class="sw" x="${x + 26}" width="44" height="70" rx="8" stroke="#111" stroke-width="4"/></g>`; }).join('')}`));
    msg(el, '켜진 차단기를 모두 내려 문을 여세요');
    const draw = () => s.querySelectorAll('[data-i]').forEach(g => { const i = +g.dataset.i, y = 170 + Math.floor(i / 4) * 200, u = on.has(i);
      g.querySelector('.led').setAttribute('fill', u ? '#ff3b3b' : '#3a2222'); const w = g.querySelector('.sw'); w.setAttribute('y', u ? y + 42 : y + 80); w.setAttribute('fill', u ? '#ffd23f' : '#9aa5ab'); });
    draw();
    s.onclick = e => { const g = e.target.closest('[data-i]'); if (!g) return; const i = +g.dataset.i; if (on.has(i)) on.delete(i); else on.add(i); sfx('click'); draw(); if (!on.size) done(); };
  },
  door_panel(el, done, c) {
    const pick = Math.floor(Math.random() * 3);
    if (pick === 0) return GAMES2.hold(el, done, { params: { seconds: 1.5, icon: '🔓', label: '버튼을 눌러 문을 여세요' } });
    if (pick === 1) return GAMES2.idcode(el, done, { params: { label: '코드를 입력해 문을 여세요' } });
    return GAMES2.switches(el, done, { params: { count: 4, label: '스위치를 모두 켜서 문을 여세요' } });
  },
};
