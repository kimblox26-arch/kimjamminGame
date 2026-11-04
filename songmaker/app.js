'use strict';
// KIM 송메이커 — 격자를 눌러 멜로디와 리듬을 만드는 웹 작곡기 (WebAudio 실시간 합성, 외부 라이브러리 없음)

const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_KO = ['도', '도#', '레', '레#', '미', '파', '파#', '솔', '솔#', '라', '라#', '시'];
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
const SCALE_KEYS = Object.keys(SCALES);
const HUES = [352, 18, 38, 58, 96, 150, 176, 198, 220, 250, 280, 318]; // 음높이(12음)마다 고유 색
const noteColor = (pc, on) => `hsl(${HUES[pc]} 85% ${on ? 80 : 63}%)`;

// 직접 그린 아이콘 (32×32 선 그림)
const ICONS = {
  piano: '<rect x="3" y="7" width="26" height="18" rx="2"/><path d="M9.5 16v9M16 16v9M22.5 16v9"/><rect class="f" x="7.5" y="7" width="4" height="9" rx=".6"/><rect class="f" x="14" y="7" width="4" height="9" rx=".6"/><rect class="f" x="20.5" y="7" width="4" height="9" rx=".6"/>',
  marimba: '<rect x="3" y="4" width="4.5" height="19" rx="1.5"/><rect x="9.5" y="4" width="4.5" height="16" rx="1.5"/><rect x="16" y="4" width="4.5" height="13" rx="1.5"/><rect x="22.5" y="4" width="4.5" height="10" rx="1.5"/><path d="M14 29l10-7"/><circle class="f" cx="25.5" cy="21" r="2.6"/>',
  violin: '<path d="M16 2.5v8"/><path d="M14 2.5h4"/><path d="M13 10.5h6c2.2 0 3 2.2 1.6 3.9 2.6 1.4 3.2 4.3 2 6.8-1 2-3.6 3.3-6.6 3.3s-5.6-1.3-6.6-3.3c-1.2-2.5-.6-5.4 2-6.8C10 12.7 10.8 10.5 13 10.5z"/><path d="M13.5 16.5v3.5M18.5 16.5v3.5"/><path d="M4 29L27 6" stroke-width="1.5"/>',
  flute: '<rect x="2" y="14" width="28" height="6" rx="3"/><circle class="f" cx="9" cy="17" r="1.3"/><circle class="f" cx="14.5" cy="17" r="1.3"/><circle class="f" cx="19.5" cy="17" r="1.3"/><circle class="f" cx="24.5" cy="17" r="1.3"/><path d="M5 10c1.3-2.6 3.7-2.6 5 0M12 8c1.3-2.6 3.7-2.6 5 0" stroke-width="1.6"/>',
  synth: '<path d="M2 16h4l4-9 6 18 6-18 4 9h4"/>',
  pads: '<rect x="4" y="4" width="24" height="24" rx="3"/><rect class="f" x="8" y="8" width="6.5" height="6.5" rx="1.2"/><rect x="17.5" y="8" width="6.5" height="6.5" rx="1.2"/><rect x="8" y="17.5" width="6.5" height="6.5" rx="1.2"/><rect class="f" x="17.5" y="17.5" width="6.5" height="6.5" rx="1.2"/>',
  drum: '<ellipse cx="16" cy="15" rx="11" ry="4"/><path d="M5 15v8c0 2.2 4.9 4 11 4s11-1.8 11-4v-8"/><path d="M10 18.6v7.6M16 19v8M22 18.6v7.6"/><path d="M7 3l8 10M25 3l-8 10"/>',
  block: '<rect x="3" y="14" width="21" height="12" rx="3"/><path d="M7.5 20h12"/><path d="M21 9.5l8-6"/><circle class="f" cx="19" cy="11" r="2.8"/>',
  conga: '<ellipse cx="16" cy="6" rx="7" ry="2.5"/><path d="M9 6l2.2 22h9.6L23 6"/><path d="M10.1 15h11.8M10.9 22.5h10.2"/>',
  undo: '<path d="M9 13h12a6 6 0 0 1 0 12h-6"/><path d="M13 8l-5 5 5 5"/>',
  trash: '<path d="M6 9h20M13 9V6h6v3M8 9l1.5 17h13L24 9"/><path d="M14 13v9M18 13v9"/>',
  link: '<path d="M14 18a5 5 0 0 0 7 0l4-4a5 5 0 0 0-7-7l-2 2"/><path d="M18 14a5 5 0 0 0-7 0l-4 4a5 5 0 0 0 7 7l2-2"/>',
  down: '<path d="M16 4v15M10 13l6 6 6-6M5 22v4h22v-4"/>',
  sliders: '<path d="M5 9h22M5 16h22M5 23h22"/><circle class="b" cx="11" cy="9" r="2.8"/><circle class="b" cx="21" cy="16" r="2.8"/><circle class="b" cx="14" cy="23" r="2.8"/>',
  len: '<path d="M5 16h22M10 11l-5 5 5 5M22 11l5 5-5 5M3 8v16M29 8v16"/>',
  height: '<path d="M16 5v22M11 10l5-5 5 5M11 22l5 5 5-5M8 3h16M8 29h16"/>',
  minus: '<path d="M8 16h16" stroke-width="3"/>',
  plus: '<path d="M8 16h16M16 8v16" stroke-width="3"/>',
};
const svgIcon = name => `<svg class="d" viewBox="0 0 32 32" aria-hidden="true">${ICONS[name]}</svg>`;
document.querySelectorAll('[data-ico]').forEach(el => { el.innerHTML = svgIcon(el.dataset.ico); });

const DEF = { bars: 4, beats: 4, split: 2, scale: 'major', root: 0, octave: 4, rows: 15, tempo: 120, inst: 0, perc: 0 };
let S = { ...DEF };
let R = 0, C = 0, mel = null, drm = null; // mel: R*C, drm: 2*C (0=높은 소리, 1=낮은 소리)

const scaleOf = s => SCALES[s.scale] || SCALES.major;
const rowsOf = s => s.rows;
const colsOf = s => s.bars * s.beats * s.split;
function rowMidiOf(s, r) {
  const sc = scaleOf(s), n = sc.length;
  return 12 * (s.octave + 1) + s.root + 12 * Math.floor(r / n) + sc[r % n];
}
const MAX_BARS = 64, MAX_ROWS = 72, MAX_MIDI = 108; // 맨 위 음은 C8 까지
function maxRowsOf(s) { let r = 0; while (r < MAX_ROWS && rowMidiOf(s, r) <= MAX_MIDI) r++; return r; }
const rowMidi = r => rowMidiOf(S, r);
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const stepDur = () => 60 / S.tempo / S.split;

/* ───────────── 오디오 ───────────── */
let ac = null, bus = null;
function makeBus(ctx) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.ratio.value = 4;
  comp.connect(ctx.destination);
  const out = ctx.createGain(); out.gain.value = 0.75; out.connect(comp);
  const rev = ctx.createConvolver();
  const len = ctx.sampleRate * 1.8 | 0, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  rev.buffer = ir;
  const rg = ctx.createGain(); rg.gain.value = 0.25; rev.connect(rg); rg.connect(comp);
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  return { ctx, out, rev, noise };
}
function audio() {
  if (!ac) { ac = new (window.AudioContext || window.webkitAudioContext)(); bus = makeBus(ac); }
  if (ac.state === 'suspended') ac.resume();
  return bus;
}
function vgain(b, send = 0) {
  const g = b.ctx.createGain(); g.gain.value = 0; g.connect(b.out);
  if (send) { const s = b.ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(b.rev); }
  return g;
}
function osc(b, type, f, t, end, dest, det = 0, lvl = 1) {
  const o = b.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
  if (lvl !== 1) { const g = b.ctx.createGain(); g.gain.value = lvl; o.connect(g); g.connect(dest); } else o.connect(dest);
  o.start(t); o.stop(end); return o;
}
function filt(b, type, f, q, dest) {
  const n = b.ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q) n.Q.value = q; n.connect(dest); return n;
}
function noiseSrc(b, t, dur, dest) {
  const s = b.ctx.createBufferSource(); s.buffer = b.noise; s.connect(dest); s.start(t); s.stop(t + dur); return s;
}
function env(g, t, peak, dec, att = 0.002) {
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + att); g.gain.exponentialRampToValueAtTime(0.001, t + dec);
}
function sustain(g, t, d, peak, att, rel) { // 누르고 있는 동안 유지 → 놓으면 사라짐
  const hold = t + Math.max(att, d);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + att);
  g.gain.setValueAtTime(peak, hold); g.gain.exponentialRampToValueAtTime(0.001, hold + rel);
  return hold + rel;
}
function vibrato(b, t, end, oscs, rate, cents, delay = 0.1) {
  const l = b.ctx.createOscillator(), lg = b.ctx.createGain();
  l.frequency.value = rate; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(cents, t + delay + 0.2);
  l.connect(lg); oscs.forEach(o => lg.connect(o.detune)); l.start(t); l.stop(end);
}

const INSTRUMENTS = [
  { name: '피아노', icon: 'piano', gm: 0, play(b, f, t) {
    const dec = Math.max(0.6, 2.6 - f / 500), end = t + dec;
    const g = vgain(b, 0.3);
    const lp = filt(b, 'lowpass', Math.min(f * 8, 12000), 0, g);
    lp.frequency.setValueAtTime(Math.min(f * 8, 12000), t); lp.frequency.exponentialRampToValueAtTime(Math.max(f * 2, 400), end);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.36, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.25); g.gain.exponentialRampToValueAtTime(0.001, end);
    osc(b, 'triangle', f, t, end, lp); osc(b, 'sawtooth', f, t, end, lp, 4, 0.14); osc(b, 'sine', f * 2, t, end, lp, 0, 0.2);
  } },
  { name: '마림바', icon: 'marimba', gm: 12, play(b, f, t) {
    const dec = Math.max(0.3, 1.1 - f / 1400);
    const g = vgain(b, 0.25); env(g, t, 0.5, dec, 0.003); osc(b, 'sine', f, t, t + dec, g);
    const g2 = vgain(b); env(g2, t, 0.14, 0.09, 0.001); osc(b, 'sine', f * 4, t, t + 0.12, g2);
  } },
  { name: '현악기', icon: 'violin', gm: 48, play(b, f, t, d) {
    const g = vgain(b, 0.45), end = sustain(g, t, d, 0.15, 0.09, 0.35);
    const lp = filt(b, 'lowpass', 1600 + f, 0.7, g);
    const o = [osc(b, 'sawtooth', f, t, end, lp, -7), osc(b, 'sawtooth', f, t, end, lp, 7)];
    vibrato(b, t, end, o, 5.5, 8);
  } },
  { name: '관악기', icon: 'flute', gm: 73, play(b, f, t, d) {
    const g = vgain(b, 0.35), end = sustain(g, t, d, 0.24, 0.05, 0.18);
    const lp = filt(b, 'lowpass', f * 3, 0, g);
    const o = [osc(b, 'triangle', f, t, end, lp), osc(b, 'sine', f * 2, t, end, lp, 0, 0.15)];
    vibrato(b, t, end, o, 5, 10, 0.15);
    const bg = b.ctx.createGain(); bg.gain.value = 0.05; bg.connect(g);
    noiseSrc(b, t, end - t, filt(b, 'bandpass', f * 2, 1.5, bg));
  } },
  { name: '신시사이저', icon: 'synth', gm: 81, play(b, f, t, d) {
    const g = vgain(b, 0.2), hold = t + Math.max(0.1, d), end = hold + 0.15;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.17, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.1); g.gain.setValueAtTime(0.11, hold); g.gain.exponentialRampToValueAtTime(0.001, end);
    const lp = filt(b, 'lowpass', 4000, 6, g);
    lp.frequency.setValueAtTime(4500, t); lp.frequency.exponentialRampToValueAtTime(Math.max(f * 2, 300), t + 0.25);
    osc(b, 'square', f, t, end, lp, 0, 0.45); osc(b, 'sawtooth', f, t, end, lp, 9, 0.55);
  } },
];

function kick(b, t, len = 0.45, from = 150) {
  const g = vgain(b, 0.05); env(g, t, 0.9, len);
  const o = osc(b, 'sine', from, t, t + len + 0.05, g);
  o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(42, t + len * 0.8);
}
function snare(b, t) {
  const g = vgain(b, 0.15); env(g, t, 0.45, 0.2); noiseSrc(b, t, 0.22, filt(b, 'highpass', 1200, 0, g));
  const g2 = vgain(b); env(g2, t, 0.3, 0.1); osc(b, 'triangle', 190, t, t + 0.12, g2);
}
function hat(b, t) {
  const g = vgain(b, 0.05); env(g, t, 0.28, 0.06, 0.001); noiseSrc(b, t, 0.08, filt(b, 'highpass', 7000, 0, g));
}
function block(b, t, f) {
  const g = vgain(b, 0.15); env(g, t, 0.5, 0.09, 0.001);
  osc(b, 'sine', f, t, t + 0.1, g); osc(b, 'triangle', f * 1.48, t, t + 0.1, g, 0, 0.3);
}
function conga(b, t, f) {
  const g = vgain(b, 0.15); env(g, t, 0.55, 0.35, 0.002);
  const o = osc(b, 'sine', f, t, t + 0.4, g);
  o.frequency.setValueAtTime(f * 1.4, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
}
const KITS = [
  { name: '일렉트로닉', icon: 'pads', hi: hat, lo: (b, t) => kick(b, t, 0.8, 120), gm: [42, 36] },
  { name: '드럼 세트', icon: 'drum', hi: snare, lo: (b, t) => kick(b, t), gm: [38, 36] },
  { name: '우드블록', icon: 'block', hi: (b, t) => block(b, t, 1700), lo: (b, t) => block(b, t, 950), gm: [76, 77] },
  { name: '콩가', icon: 'conga', hi: (b, t) => conga(b, t, 420), lo: (b, t) => conga(b, t, 230), gm: [62, 64] },
];

function scheduleStep(b, c, t) {
  const d = stepDur(), inst = INSTRUMENTS[S.inst], kit = KITS[S.perc];
  for (let r = 0; r < R; r++) if (mel[r * C + c]) inst.play(b, mtof(rowMidi(r)), t, d);
  if (drm[c]) kit.hi(b, t);
  if (drm[C + c]) kit.lo(b, t);
}

/* ───────────── 재생 ───────────── */
let playing = false, nextT = 0, step = 0, timer = 0, queue = [], cur = -1;
function tick() {
  while (nextT < ac.currentTime + 0.12) {
    step %= C; // 재생 중에 길이를 줄여도 안전하게
    scheduleStep(bus, step, nextT);
    queue.push([step, nextT]);
    nextT += stepDur();
    step = (step + 1) % C;
  }
}
function play() {
  audio(); playing = true; step = 0; queue = []; nextT = ac.currentTime + 0.06;
  tick(); timer = setInterval(tick, 25); setPlayIcon(); requestAnimationFrame(frame);
}
function stop() {
  playing = false; clearInterval(timer); queue = []; cur = -1; setPlayIcon(); draw();
}
const toggle = () => playing ? stop() : play();
function frame() {
  if (!playing) return;
  let changed = false;
  while (queue.length && queue[0][1] <= ac.currentTime) { cur = queue.shift()[0]; changed = true; }
  if (changed) { follow(); draw(); }
  requestAnimationFrame(frame);
}
function follow() {
  const x = cur * cw, sl = wrap.scrollLeft;
  if (x < sl || x + cw > sl + vw) wrap.scrollLeft = x;
}
function setPlayIcon() {
  $('#playIcon').setAttribute('d', playing ? 'M6 6h12v12H6z' : 'M7 4l13 8-13 8z');
  $('#playBtn').setAttribute('aria-label', playing ? '정지' : '재생');
}

/* ───────────── 격자 그리기 ───────────── */
const wrap = $('#gridWrap'), sizer = $('#sizer'), cv = $('#grid'), g = cv.getContext('2d');
const GAP = 8;
let cw = 30, rh = 20, dh = 36, melH = 0, W = 0, H = 0, vw = 0, vh = 0, dpr = 1;

function layout() {
  for (let pass = 0; pass < 2; pass++) { // 스크롤바가 생기면 크기가 바뀌므로 한 번 더 계산
    vw = wrap.clientWidth; vh = wrap.clientHeight;
    dh = Math.round(clamp(vh * 0.08, 30, 48));
    rh = Math.max(16, (vh - 2 * dh - GAP) / R);
    cw = Math.max(26, vw / C);
    melH = rh * R; W = cw * C; H = melH + GAP + 2 * dh;
    sizer.style.width = (W <= vw + 0.5 ? vw : Math.ceil(W)) + 'px';
    sizer.style.height = (H <= vh + 0.5 ? vh : Math.ceil(H)) + 'px';
  }
  dpr = window.devicePixelRatio || 1;
  cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
  cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
  draw();
}

function rrect(x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h);
  g.fill();
}

function draw() {
  const sx = wrap.scrollLeft, sy = wrap.scrollTop, n = scaleOf(S).length;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#12141c'; g.fillRect(0, 0, vw, vh);
  g.translate(-sx, -sy);
  const c0 = Math.max(0, Math.floor(sx / cw)), c1 = Math.min(C - 1, Math.ceil((sx + vw) / cw));
  const dy = melH + GAP;

  for (let r = 0; r < R; r += n) { g.fillStyle = '#191c28'; g.fillRect(sx, (R - 1 - r) * rh, vw, rh); } // 으뜸음 줄
  g.fillStyle = '#171a25'; g.fillRect(sx, dy, vw, 2 * dh);
  if (cur >= 0) { g.fillStyle = '#ffffff12'; g.fillRect(cur * cw, 0, cw, H); }

  // 가로선
  g.lineWidth = 1;
  g.strokeStyle = '#242838'; g.beginPath();
  for (let r = 1; r < R; r++) { const y = Math.round(r * rh) + 0.5; g.moveTo(sx, y); g.lineTo(sx + vw, y); }
  g.moveTo(sx, Math.round(dy + dh) + 0.5); g.lineTo(sx + vw, Math.round(dy + dh) + 0.5);
  g.stroke();
  g.strokeStyle = '#3a3f57'; g.beginPath();
  for (let r = n; r < R; r += n) { const y = Math.round((R - r) * rh) + 0.5; g.moveTo(sx, y); g.lineTo(sx + vw, y); }
  g.stroke();

  // 세로선: 마디 > 박자 > 쪼갠 박자
  const per = S.beats * S.split, kinds = [['#202432', c => c % S.split], ['#30354b', c => c % S.split === 0 && c % per], ['#4c5374', c => c % per === 0]];
  for (const [col, test] of kinds) {
    g.strokeStyle = col; g.beginPath();
    for (let c = c0; c <= c1 + 1; c++) if (test(c)) {
      const x = Math.round(c * cw) + 0.5;
      g.moveTo(x, 0); g.lineTo(x, melH); g.moveTo(x, dy); g.lineTo(x, dy + 2 * dh);
    }
    g.stroke();
  }

  // 음표
  const rad = Math.min(6, rh / 4, cw / 4);
  for (let c = c0; c <= c1; c++) {
    const on = c === cur;
    for (let r = 0; r < R; r++) {
      if (!mel[r * C + c]) continue;
      const pc = rowMidi(r) % 12;
      g.fillStyle = noteColor(pc, on);
      if (on) { g.shadowColor = noteColor(pc, false); g.shadowBlur = 14; }
      rrect(c * cw + 1.5, (R - 1 - r) * rh + 1.5, cw - 3, rh - 3, rad);
      g.shadowBlur = 0;
    }
    // 리듬: 위=삼각형, 아래=원
    const cx = c * cw + cw / 2, s = Math.min(cw, dh) * 0.3;
    for (let k = 0; k < 2; k++) {
      const hitOn = drm[k * C + c], cy = dy + k * dh + dh / 2;
      g.fillStyle = hitOn ? (on ? '#ffffff' : k ? '#7fb2ff' : '#c7a4ff') : '#ffffff10';
      g.beginPath();
      if (k === 0) { g.moveTo(cx, cy - s); g.lineTo(cx + s, cy + s * 0.8); g.lineTo(cx - s, cy + s * 0.8); g.closePath(); }
      else g.arc(cx, cy, s * 0.9, 0, Math.PI * 2);
      g.fill();
    }
  }

  // 옥타브 이름표 (고정)
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.font = '10px system-ui,sans-serif'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff55';
  for (let r = 0; r < R; r += n) {
    const m = rowMidi(r), y = (R - 1 - r) * rh + rh / 2 - sy;
    if (y > -rh && y < vh) g.fillText(NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1), 4, y);
  }
}
let drawQueued = false;
wrap.addEventListener('scroll', () => {
  if (drawQueued) return; drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
});
new ResizeObserver(layout).observe($('#stage'));

/* ───────────── 입력 (클릭·드래그로 그리기, 두 손가락으로 이동) ───────────── */
function hit(e) {
  const rc = wrap.getBoundingClientRect(), lx = e.clientX - rc.left, ly = e.clientY - rc.top;
  if (lx < 0 || ly < 0 || lx >= vw || ly >= vh) return null; // 스크롤바 위
  const x = lx + wrap.scrollLeft, y = ly + wrap.scrollTop, c = Math.floor(x / cw);
  if (c < 0 || c >= C) return null;
  if (y < melH) { const r = R - 1 - Math.floor(y / rh); return { a: 'm', i: r * C + c, r }; }
  const k = Math.floor((y - melH - GAP) / dh);
  if (k < 0 || k > 1) return null;
  return { a: 'd', i: k * C + c, k };
}
function preview(h) {
  const b = audio(), t = ac.currentTime + 0.01;
  if (h.a === 'm') INSTRUMENTS[S.inst].play(b, mtof(rowMidi(h.r)), t, stepDur());
  else KITS[S.perc][h.k ? 'lo' : 'hi'](b, t);
}
const pts = new Map();
let paint = null, pan = null;
const avgPt = () => { let x = 0, y = 0; for (const p of pts.values()) { x += p.x; y += p.y; } return { x: x / pts.size, y: y / pts.size }; };
function paintAt(h) {
  if (!h || h.a !== paint.a) return;
  const arr = h.a === 'm' ? mel : drm;
  if (arr[h.i] === paint.v) return;
  arr[h.i] = paint.v; paint.changed = true;
  if (paint.v && !playing) preview(h);
  draw();
}
wrap.addEventListener('pointerdown', e => {
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size >= 2) { // 두 손가락 → 화면 이동 (그리던 것은 취소)
    if (paint) { if (paint.changed) undo(); else undoStack.pop(); paint = null; }
    pan = avgPt(); return;
  }
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const h = hit(e); if (!h) return;
  e.preventDefault();
  try { wrap.setPointerCapture(e.pointerId); } catch (_) {}
  pushUndo();
  paint = { a: h.a, v: (h.a === 'm' ? mel : drm)[h.i] ? 0 : 1, changed: false };
  paintAt(h);
});
wrap.addEventListener('pointermove', e => {
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pan) {
    const p = avgPt();
    wrap.scrollLeft -= p.x - pan.x; wrap.scrollTop -= p.y - pan.y; pan = p; return;
  }
  if (paint) {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) paintAt(hit(ev));
  }
});
function endPointer(e) {
  pts.delete(e.pointerId);
  if (pts.size < 2) pan = null;
  if (pts.size === 0 && paint) {
    if (!paint.changed) undoStack.pop(); else save();
    paint = null;
  }
}
wrap.addEventListener('pointerup', endPointer);
wrap.addEventListener('pointercancel', endPointer);
wrap.addEventListener('contextmenu', e => e.preventDefault());
wrap.addEventListener('wheel', e => { // 세로 스크롤이 없으면 휠로 가로 이동
  if (wrap.scrollHeight <= wrap.clientHeight + 1 && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    wrap.scrollLeft += e.deltaY; e.preventDefault();
  }
}, { passive: false });

/* ───────────── 되돌리기 · 저장 · 공유 ───────────── */
const undoStack = [];
function pushUndo() {
  undoStack.push({ S: { ...S }, mel: mel.slice(), drm: drm.slice() });
  if (undoStack.length > 60) undoStack.shift();
}
function undo() {
  const u = undoStack.pop();
  if (!u) { toast('되돌릴 것이 없어요'); return; }
  S = u.S; setGrid(u.mel, u.drm); updateUI(); save();
}
function setGrid(m, d) {
  R = rowsOf(S); C = colsOf(S);
  mel = m || new Uint8Array(R * C); drm = d || new Uint8Array(2 * C);
  layout();
}
// 설정이 바뀌면 같은 시간·같은 음의 음표를 최대한 유지
function regrid(oldS, oldMel, oldDrm) {
  const oR = rowsOf(oldS), oC = colsOf(oldS), nR = rowsOf(S), nC = colsOf(S);
  const m = new Uint8Array(nR * nC), d = new Uint8Array(2 * nC);
  const byMidi = new Map();
  for (let r = 0; r < nR; r++) byMidi.set(rowMidiOf(S, r), r);
  for (let c = 0; c < oC; c++) {
    const nc = c * S.split / oldS.split;
    if (!Number.isInteger(nc) || nc >= nC) continue;
    for (let r = 0; r < oR; r++) {
      if (!oldMel[r * oC + c]) continue;
      const nr = oldS.scale === S.scale ? r : byMidi.get(rowMidiOf(oldS, r)); // 같은 음계면 그대로 이조
      if (nr !== undefined && nr < nR) m[nr * nC + nc] = 1;
    }
    for (let k = 0; k < 2; k++) if (oldDrm[k * oC + c]) d[k * nC + nc] = 1;
  }
  setGrid(m, d);
}

const b64e = bytes => { let s = ''; for (const x of bytes) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const b64d = str => { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; return Uint8Array.from(atob(str), ch => ch.charCodeAt(0)); };
function pack() {
  const all = new Uint8Array(mel.length + drm.length); all.set(mel); all.set(drm, mel.length);
  const bytes = new Uint8Array(Math.ceil(all.length / 8));
  all.forEach((v, i) => { if (v) bytes[i >> 3] |= 1 << (i & 7); });
  const head = [S.bars, S.beats, S.split, SCALE_KEYS.indexOf(S.scale), S.root, S.octave, S.rows, S.tempo, S.inst, S.perc, 2].join('.');
  return head + '~' + b64e(bytes);
}
function unpack(str) {
  try {
    const [head, data] = String(str).split('~');
    const v = head.split('.').map(Number);
    if (v.length < 10 || v.some(x => !Number.isFinite(x))) return false;
    const s = {
      bars: clamp(v[0] | 0, 1, MAX_BARS), beats: clamp(v[1] | 0, 2, 7), split: clamp(v[2] | 0, 1, 4),
      scale: SCALE_KEYS[v[3]] || 'major', root: clamp(v[4] | 0, 0, 11), octave: clamp(v[5] | 0, 1, 6),
      tempo: clamp(v[7] | 0, 40, 240),
      inst: clamp(v[8] | 0, 0, INSTRUMENTS.length - 1), perc: clamp(v[9] | 0, 0, KITS.length - 1),
    };
    // 옛 형식(10칸)은 7번째 값이 옥타브 수
    s.rows = clamp(v.length > 10 ? v[6] | 0 : scaleOf(s).length * clamp(v[6] | 0, 1, 3) + 1, 2, maxRowsOf(s));
    const bytes = b64d(data || ''), nm = rowsOf(s) * colsOf(s), nd = 2 * colsOf(s);
    const bit = i => (bytes[i >> 3] >> (i & 7)) & 1;
    const m = new Uint8Array(nm), d = new Uint8Array(nd);
    for (let i = 0; i < nm; i++) m[i] = bit(i);
    for (let i = 0; i < nd; i++) d[i] = bit(nm + i);
    S = s; setGrid(m, d); return true;
  } catch (_) { return false; }
}
const KEY = 'kimSongMaker.v1';
function save() { try { localStorage.setItem(KEY, pack()); } catch (_) {} }
function load() {
  const h = location.hash.match(/s=([^&]+)/);
  if (h && unpack(decodeURIComponent(h[1]))) return;
  try { const v = localStorage.getItem(KEY); if (v && unpack(v)) return; } catch (_) {}
  setGrid();
}
async function share() {
  const url = location.href.split('#')[0] + '#s=' + pack();
  history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); toast('링크를 복사했어요! 친구에게 보내 보세요'); }
  catch (_) { prompt('이 링크를 복사하세요', url); }
}

/* ───────────── 내보내기 (WAV · MIDI) ───────────── */
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function exportWav() {
  if (playing) stop();
  toast('WAV 파일을 만드는 중…');
  const sr = 44100, d = stepDur(), len = C * d + 2.5;
  const oc = new OfflineAudioContext(2, Math.ceil(sr * len), sr), b = makeBus(oc);
  for (let c = 0; c < C; c++) scheduleStep(b, c, 0.02 + c * d);
  const buf = await oc.startRendering();
  const ch = 2, n = buf.length, ab = new ArrayBuffer(44 + n * ch * 2), v = new DataView(ab);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * ch * 2, true);
  const L = buf.getChannelData(0), Rt = buf.getChannelData(1);
  for (let i = 0, o = 44; i < n; i++) for (const s0 of [L[i], Rt[i]]) {
    const s = clamp(s0, -1, 1); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
  }
  download(new Blob([ab], { type: 'audio/wav' }), 'kim-song.wav');
  toast('WAV 저장 완료!');
}
function exportMidi() {
  const ppq = 480, st = ppq / S.split, ev = [], kit = KITS[S.perc];
  for (let c = 0; c < C; c++) {
    const t0 = Math.round(c * st), t1 = Math.round((c + 1) * st);
    for (let r = 0; r < R; r++) if (mel[r * C + c]) { const m = rowMidi(r); ev.push([t0, 0x90, m, 96], [t1, 0x80, m, 0]); }
    for (let k = 0; k < 2; k++) if (drm[k * C + c]) { const m = kit.gm[k]; ev.push([t0, 0x99, m, 110], [t0 + (st >> 1), 0x89, m, 0]); }
  }
  ev.sort((a, b) => a[0] - b[0] || (a[1] & 0x10) - (b[1] & 0x10)); // 같은 시점이면 끄기 먼저
  const vlq = x => { const o = [x & 0x7f]; while ((x >>= 7)) o.unshift((x & 0x7f) | 0x80); return o; };
  const us = Math.round(6e7 / S.tempo);
  const trk = [0, 0xff, 0x51, 3, us >> 16 & 255, us >> 8 & 255, us & 255, 0, 0xff, 0x58, 4, S.beats, 2, 24, 8, 0, 0xc0, INSTRUMENTS[S.inst].gm];
  let last = 0;
  for (const [t, a, b2, c2] of ev) { trk.push(...vlq(t - last), a, b2, c2); last = t; }
  trk.push(0, 0xff, 0x2f, 0);
  const L = trk.length;
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, ppq >> 8, ppq & 255, 0x4d, 0x54, 0x72, 0x6b, L >>> 24, L >> 16 & 255, L >> 8 & 255, L & 255];
  download(new Blob([new Uint8Array([...head, ...trk])], { type: 'audio/midi' }), 'kim-song.mid');
  toast('MIDI 저장 완료!');
}

/* ───────────── UI ───────────── */
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2200);
}
function updateUI() {
  const i = INSTRUMENTS[S.inst], k = KITS[S.perc];
  $('#instIcon').innerHTML = svgIcon(i.icon); $('#instName').textContent = i.name;
  $('#percIcon').innerHTML = svgIcon(k.icon); $('#percName').textContent = k.name;
  $('#tempo').value = S.tempo; $('#tempoVal').textContent = S.tempo;
  $('#lenIn').value = S.bars; $('#rowsIn').value = S.rows; $('#rowsIn').max = maxRowsOf(S);
}
// 길이·높이·음계 등 격자 설정 바꾸기 (재생 중에도 가능, 되돌리기 가능)
const GRID_KEYS = ['bars', 'beats', 'split', 'scale', 'root', 'octave', 'rows'];
function applySettings(n) {
  const next = { ...S, ...n };
  next.bars = clamp(Math.round(next.bars) || 1, 1, MAX_BARS);
  next.beats = clamp(Math.round(next.beats) || 4, 2, 7);
  const maxR = maxRowsOf(next);
  if (n.rows > maxR) toast(`높이는 최대 ${maxR}줄 (시작 옥타브를 낮추면 더 늘어나요)`);
  next.rows = clamp(Math.round(next.rows) || 2, 2, maxR);
  if (GRID_KEYS.every(k => next[k] === S[k])) { updateUI(); return; }
  pushUndo();
  const oldS = { ...S }; S = next;
  regrid(oldS, mel, drm); updateUI(); save();
}
document.querySelectorAll('.spin button').forEach(btn => {
  btn.onclick = () => applySettings({ [btn.dataset.k]: S[btn.dataset.k] + +btn.dataset.d });
});
$('#lenIn').onchange = e => applySettings({ bars: +e.target.value });
$('#rowsIn').onchange = e => applySettings({ rows: +e.target.value });
document.querySelectorAll('.spin input').forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); }));
$('#playBtn').onclick = toggle;
$('#instBtn').onclick = () => {
  S.inst = (S.inst + 1) % INSTRUMENTS.length; updateUI(); save();
  if (!playing) { const b = audio(), t = ac.currentTime + 0.01; INSTRUMENTS[S.inst].play(b, mtof(rowMidi(0) + 12), t, 0.4); }
};
$('#percBtn').onclick = () => {
  S.perc = (S.perc + 1) % KITS.length; updateUI(); save();
  if (!playing) { const b = audio(), t = ac.currentTime + 0.01; KITS[S.perc].lo(b, t); KITS[S.perc].hi(b, t + 0.2); }
};
$('#tempo').oninput = e => { S.tempo = +e.target.value; $('#tempoVal').textContent = S.tempo; };
$('#tempo').onchange = save;
$('#undoBtn').onclick = undo;
$('#clearBtn').onclick = () => {
  if (!mel.some(Boolean) && !drm.some(Boolean)) return;
  pushUndo(); mel.fill(0); drm.fill(0); draw(); save(); toast('모두 지웠어요 (되돌리기 가능)');
};
$('#shareBtn').onclick = share;
$('#wavBtn').onclick = () => exportWav().catch(err => toast('WAV 저장 실패: ' + err.message));
$('#midiBtn').onclick = exportMidi;

const dlg = $('#settings'), form = dlg.querySelector('form');
form.root.innerHTML = NOTE_NAMES.map((n, i) => `<option value="${i}">${n} (${NOTE_KO[i]})</option>`).join('');
$('#setBtn').onclick = () => {
  for (const k of GRID_KEYS) form[k].value = S[k];
  dlg.showModal();
};
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'ok') return;
  const f = form, n = {
    bars: +f.bars.value, rows: +f.rows.value, beats: +f.beats.value, split: +f.split.value,
    scale: f.scale.value, root: +f.root.value, octave: +f.octave.value,
  };
  // 음계만 바꾸고 높이는 그대로 두면 같은 음역(옥타브)이 되도록 줄 수를 맞춤
  if (n.scale !== S.scale && n.rows === S.rows)
    n.rows = Math.round((S.rows - 1) / scaleOf(S).length * SCALES[n.scale].length) + 1;
  applySettings(n);
});

document.addEventListener('keydown', e => {
  if (dlg.open || e.target.closest('input,select,textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); undo(); }
});

load();
updateUI();
