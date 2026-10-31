// 운전석 계기판: 주간제어기(핸들), 속도계(ATC), 압력계, 표시등, 안내
import { clamp } from './geo.js';
import { ICON } from './icons.js';

const $ = id => document.getElementById(id);
function fit(cv) {
  const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return [g, w, h];
}
const fmtD = d => d >= 1000 ? (d / 1000).toFixed(d >= 10000 ? 0 : 1) + ' km' : d >= 20 ? Math.round(d) + ' m' : d.toFixed(1) + ' m';

export class HUD {
  constructor() {
    this.lever = $('c-lever'); this.speed = $('c-speed'); this.press = $('c-press'); this.stopbar = $('c-stop');
    this.msgT = 0;
    let drag = false;
    const act = e => {
      if (!this.sim) return;
      const r = this.lever.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, s = this.sim;
      const rows = this.rows(r.height), idx = clamp(Math.round((y - rows.top) / rows.step), 0, rows.n - 1);
      if (s.two) { if (x < r.width / 2) s.setPower(s.NP - clamp(idx, 0, s.NP)); else s.setBrake(clamp(idx, 0, s.NB + 1)); }
      else s.setHandle(s.NP - idx);
    };
    this.lever.addEventListener('pointerdown', e => { drag = true; this.lever.setPointerCapture(e.pointerId); act(e); this.onLever?.(); });
    this.lever.addEventListener('pointermove', e => { if (drag) act(e); });
    this.lever.addEventListener('pointerup', () => drag = false);
  }
  bind(sim, info) {
    this.sim = sim; this.info = info; $('h-line').textContent = info.lineName; $('h-line').style.background = info.color; $('h-train').textContent = info.trainName;
    // 운전 버튼: 누르고 있으면 한 단씩 계속 움직인다
    const D = sim.two
      ? [['up', '역행 올림|역행', 'W', 'pw', () => sim.powerUp()], ['down', '역행 내림|역행', 'S', 'pw', () => sim.powerDown()], ['up', '제동 걸기|제동', 'E', 'br', () => sim.brakeUp()], ['down', '제동 풀기|제동', 'D', 'br', () => sim.brakeDown()], ['stop', '비상|비상', 'BS', 'eb', () => sim.emergency()]]
      : [['up', '역행|역행', 'W', 'pw', () => sim.powerUp()], ['neutral', '중립|중립', 'N', 'nt', () => sim.neutral()], ['down', '제동|제동', 'S', 'br', () => sim.powerDown()], ['stop', '비상|비상', 'BS', 'eb', () => sim.emergency()]];
    const box = $('drive-btns'); box.innerHTML = '';
    for (const [ic, labels, key, cls, fn] of D) {
      const [label, short] = labels.split('|');
      const b = document.createElement('button'); b.className = cls; b.title = `${label === '비상' ? '비상제동' : label} (${key === 'BS' ? 'Backspace' : key})`;
      b.innerHTML = `<span>${ICON[ic]}</span><i class="lf">${label}</i><i class="ls">${short}</i><kbd>${key}</kbd>`;
      let t = 0; const stop = () => { clearTimeout(t); t = 0; };
      b.addEventListener('pointerdown', e => { e.preventDefault(); fn(); stop(); if (cls !== 'eb') { const rep = () => { fn(); t = setTimeout(rep, 220); }; t = setTimeout(rep, 450); } });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stop);
      box.appendChild(b);
    }
    // 역전기: 눌러서 바로 선택
    const rev = $('rev'); rev.innerHTML = '';
    this.revBtns = ['R', 'N', 'F'].map((k, i) => {
      const b = document.createElement('button'); b.textContent = k; b.title = ['후진', '중립', '전진'][i];
      b.addEventListener('pointerdown', e => { e.preventDefault(); sim.setReverser(i - 1); }); rev.appendChild(b); return b;
    });
  }
  rows(h) {
    const s = this.sim, n = s.two ? Math.max(s.NP + 1, s.NB + 2) : s.NP + s.NB + 2;
    const top = 26, step = (h - top - 14) / (n - 1); return { n, top, step };
  }
  msg(t, warn) { const el = $('h-msg'); el.textContent = t; el.className = 'toast show' + (warn ? ' warn' : ''); this.msgT = 3.5; }

  update(dt, sim, extra) {
    this.msgT -= dt;
    if (!this.speed.clientWidth) return;
    this.acc = (this.acc || 0) + dt; if (this.acc < 1 / 30) return; this.acc = 0; if (this.msgT < 0 && this.msgT > -1) $('h-msg').className = 'toast';
    if (this.lever.clientWidth) this.drawLever(sim);
    this.drawSpeed(sim, extra);
    if (this.press.clientWidth) this.drawPress(sim);
    // 표시등
    const lamp = (id, on, cls = '') => { const el = $(id); el.className = 'lamp ' + (on ? 'on ' + cls : ''); };
    lamp('l-door', sim.doors === 'closed', 'g'); lamp('l-panto', sim.spec.kind === 'diesel' ? sim.engine : sim.panto > 0.98, 'g');
    lamp('l-vcb', sim.spec.kind === 'diesel' ? sim.rpm > 380 : sim.vcb, 'g'); lamp('l-atc', sim.atcBrake || sim.atcWarn, 'r');
    lamp('l-eb', sim.eb, 'r'); lamp('l-comp', sim.comp, 'y');
    $('l-panto').querySelector('i').textContent = sim.spec.kind === 'diesel' ? '엔진' : '팬터';
    $('l-vcb').querySelector('i').textContent = sim.spec.kind === 'diesel' ? '발전' : '주차단';
    $('l-atc').querySelector('i').textContent = sim.sys;
    this.revBtns.forEach((b, i) => b.classList.toggle('on', sim.reverser === i - 1));
    // 운행 정보
    const st = sim.nextSt, d = st ? sim.dist(sim.stopOf(st)) : 0;
    $('h-next').textContent = sim.finished ? '운행 완료' : st ? st.name : '-';
    $('h-dist').textContent = sim.finished ? '' : fmtD(Math.max(0, d));
    $('h-dest').textContent = sim.route[sim.route.length - 1].name + ' 행';
    $('h-door').textContent = '내리실 문 ' + sim.doorSide;
    const t = sim.t, hh = Math.floor(t / 3600), mm = Math.floor(t / 60) % 60, ss = Math.floor(t % 60);
    $('h-time').textContent = `${hh ? hh + ':' : ''}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    $('h-odo').textContent = (sim.odo / 1000).toFixed(1) + ' km';
    $('h-clock').textContent = extra.clock;
    const hint = sim.hint(); const he = $('h-hint'); he.textContent = hint; he.style.opacity = hint ? 1 : 0;
    // 정차 위치 막대
    const show = st && d < 350 && d > -15 && !sim.finished;
    this.stopbar.parentElement.style.opacity = show ? 1 : 0;
    if (show && this.stopbar.clientWidth) this.drawStop(d);
  }

  drawLever(s) {
    const [g, w, h] = fit(this.lever), R = this.rows(h);
    g.clearRect(0, 0, w, h);
    g.font = '700 11px "Noto Sans KR",sans-serif'; g.textBaseline = 'middle';
    const col = (x0, x1, labels, cur, title) => {
      g.fillStyle = 'rgba(255,255,255,.55)'; g.textAlign = 'center'; g.fillText(title, (x0 + x1) / 2, 10);
      g.fillStyle = '#10161c'; g.fillRect(x0 + 18, R.top - 8, 10, R.step * (labels.length - 1) + 16);
      labels.forEach(([t, c], i) => {
        const y = R.top + i * R.step; g.fillStyle = c; g.textAlign = 'right'; g.fillText(t, x0 + 14, y);
        g.fillRect(x0 + 30, y - 1, 8, 2);
      });
      const y = R.top + cur * R.step;
      g.fillStyle = '#2a3037'; g.fillRect(x0 + 10, y - 7, x1 - x0 - 14, 14);
      const gr = g.createLinearGradient(0, y - 7, 0, y + 7); gr.addColorStop(0, '#f1f3f5'); gr.addColorStop(1, '#9aa3ab');
      g.fillStyle = gr; g.beginPath(); g.roundRect(x0 + 12, y - 6, x1 - x0 - 18, 12, 4); g.fill();
      g.fillStyle = '#e0453a'; g.beginPath(); g.arc(x1 - 10, y, 7, 0, 7); g.fill();
    };
    if (s.two) {
      const P = []; for (let i = s.NP; i >= 0; i--) P.push([i ? 'P' + i : '0', i ? '#6fb4ff' : '#ddd']);
      const B = [['운전', '#ddd']]; for (let i = 1; i <= s.NB; i++) B.push(['B' + i, '#ffb35c']); B.push(['비상', '#ff5a4a']);
      col(0, w / 2 - 4, P, s.NP - s.power, '역행'); col(w / 2 + 4, w, B, s.brake, '제동');
    } else {
      const L = []; for (let i = s.NP; i >= 1; i--) L.push(['P' + i, '#6fb4ff']); L.push(['N', '#ddd']);
      for (let i = 1; i <= s.NB; i++) L.push(['B' + i, '#ffb35c']); L.push(['EB', '#ff5a4a']);
      col(w * 0.15, w * 0.85, L, s.NP - s.handle, '주간제어기');
    }
  }

  drawSpeed(s, extra) {
    const [g, w, h] = fit(this.speed), cx = w / 2, cy = h / 2 + 4, r = Math.min(w, h) / 2 - 10;
    const max = s.spec.maxKmh > 200 ? 350 : s.spec.maxKmh > 120 ? 200 : 120, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const A = v => a0 + (a1 - a0) * clamp(v / max, 0, 1);
    g.clearRect(0, 0, w, h);
    const bg = g.createRadialGradient(cx, cy, r * 0.2, cx, cy, r); bg.addColorStop(0, '#1b232b'); bg.addColorStop(1, '#0c1116');
    g.fillStyle = bg; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill();
    g.strokeStyle = '#3a444e'; g.lineWidth = 2; g.stroke();
    // ATC 띠
    g.lineWidth = 7; g.strokeStyle = '#1fbf6a'; g.beginPath(); g.arc(cx, cy, r - 6, a0, A(s.atc)); g.stroke();
    g.strokeStyle = '#b8352c'; g.beginPath(); g.arc(cx, cy, r - 6, A(s.atc), a1); g.stroke();
    // 눈금
    const big = max > 200 ? 50 : 20, small = max > 200 ? 10 : 5;
    g.fillStyle = '#d8dee4'; g.font = `600 ${r * 0.11}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let v = 0; v <= max; v += small) {
      const a = A(v), c = Math.cos(a), sn = Math.sin(a), l = v % big === 0 ? 14 : 7;
      g.strokeStyle = '#c8d0d8'; g.lineWidth = v % big === 0 ? 2 : 1; g.beginPath(); g.moveTo(cx + c * (r - 12), cy + sn * (r - 12)); g.lineTo(cx + c * (r - 12 - l), cy + sn * (r - 12 - l)); g.stroke();
      if (v % big === 0) g.fillText(v, cx + c * (r - 36), cy + sn * (r - 36));
    }
    // 제한 표시 삼각형
    const al = A(s.atc); g.fillStyle = '#ffd23f'; g.beginPath(); g.moveTo(cx + Math.cos(al) * (r - 12), cy + Math.sin(al) * (r - 12)); g.lineTo(cx + Math.cos(al - 0.05) * (r + 2), cy + Math.sin(al - 0.05) * (r + 2)); g.lineTo(cx + Math.cos(al + 0.05) * (r + 2), cy + Math.sin(al + 0.05) * (r + 2)); g.fill();
    // 바늘
    const kmh = Math.abs(s.kmh), an = A(kmh);
    g.strokeStyle = '#ff8a1f'; g.lineWidth = 3.5; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx - Math.cos(an) * 12, cy - Math.sin(an) * 12); g.lineTo(cx + Math.cos(an) * (r - 18), cy + Math.sin(an) * (r - 18)); g.stroke();
    g.fillStyle = '#2b333b'; g.beginPath(); g.arc(cx, cy, 9, 0, 7); g.fill();
    g.fillStyle = s.atcWarn ? '#ff5a4a' : '#fff'; g.font = `800 ${r * 0.3}px "Rajdhani",sans-serif`; g.fillText(Math.floor(kmh), cx, cy + r * 0.36);
    g.fillStyle = '#8b96a0'; g.font = `600 ${r * 0.09}px sans-serif`; g.fillText('km/h', cx, cy + r * 0.56);
    g.fillStyle = '#1fbf6a'; g.font = `800 ${r * 0.13}px sans-serif`; g.fillText(`${s.sys} ${Math.round(s.atc)}`, cx, cy - r * 0.32);
    if (extra.nextLim) { g.fillStyle = '#ffd23f'; g.font = `600 ${r * 0.085}px sans-serif`; g.fillText(`앞 ${fmtD(extra.nextLim.d)} ${extra.nextLim.v}`, cx, cy - r * 0.16); }
  }

  drawPress(s) {
    const [g, w, h] = fit(this.press), cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 6, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, A = v => a0 + (a1 - a0) * clamp(v / 1000, 0, 1);
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#e9e6dc'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); g.strokeStyle = '#555'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#222'; g.font = `600 ${r * 0.13}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let v = 0; v <= 1000; v += 100) { const a = A(v); g.strokeStyle = '#333'; g.lineWidth = v % 200 ? 1 : 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4)); g.lineTo(cx + Math.cos(a) * (r - 12), cy + Math.sin(a) * (r - 12)); g.stroke(); if (v % 200 === 0) g.fillText(v / 100, cx + Math.cos(a) * (r - 24), cy + Math.sin(a) * (r - 24)); }
    const needle = (v, c) => { const a = A(v); g.strokeStyle = c; g.lineWidth = 2.5; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14)); g.stroke(); };
    needle(s.mr, '#111'); needle(s.bc, '#d12a1f');
    g.fillStyle = '#333'; g.beginPath(); g.arc(cx, cy, 5, 0, 7); g.fill();
    g.font = `700 ${r * 0.12}px sans-serif`; g.fillStyle = '#d12a1f'; g.fillText('BC ' + Math.round(s.bc), cx, cy + r * 0.42); g.fillStyle = '#111'; g.fillText('MR ' + Math.round(s.mr), cx, cy + r * 0.6);
    g.font = `600 ${r * 0.1}px sans-serif`; g.fillStyle = '#555'; g.fillText('×100 kPa', cx, cy - r * 0.35);
  }

  drawStop(d) {
    const [g, w, h] = fit(this.stopbar); g.clearRect(0, 0, w, h);
    const range = d > 60 ? 350 : 60, y = v => 10 + (1 - clamp(v / range, -0.05, 1)) * (h - 30);
    g.fillStyle = 'rgba(10,14,18,.75)'; g.fillRect(0, 0, w, h);
    for (let v = 0; v <= range; v += range / 6) { g.fillStyle = '#556'; g.fillRect(w * 0.55, y(v), w * 0.3, 1); }
    g.fillStyle = '#ffd23f'; g.fillRect(w * 0.3, y(0) - 2, w * 0.6, 4);
    g.fillStyle = Math.abs(d) <= 1 ? '#1fbf6a' : d < 0 ? '#ff5a4a' : '#fff';
    g.beginPath(); g.moveTo(w * 0.5, y(d)); g.lineTo(w * 0.2, y(d) - 6); g.lineTo(w * 0.2, y(d) + 6); g.fill();
    g.font = '700 12px sans-serif'; g.textAlign = 'center'; g.fillText(d.toFixed(Math.abs(d) < 20 ? 1 : 0), w / 2, h - 10);
  }
}
