'use strict';
// ===== 사운드 / 영상 편집 / 배경 제거 / 플레이어 =====
const AUD = {
  ctx: null, master: null, dest: null, nb: null, bufs: {},
  init() {
    if (this.ctx) return this.ctx;
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    this.ctx = new C(); this.master = this.ctx.createGain(); this.master.gain.value = typeof SET !== 'undefined' ? (SET.sfx ? SET.vol / 100 * .9 : 0) : .9;
    const comp = this.ctx.createDynamicsCompressor(); this.master.connect(comp); comp.connect(this.ctx.destination);
    try { this.dest = this.ctx.createMediaStreamDestination(); comp.connect(this.dest); } catch (e) { }
    const n = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.nb = n;
    return this.ctx;
  },
  o() { const c = this.init(); if (c && c.state === 'suspended') c.resume(); return c; },
  env(g, t, att, dur, vol) { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + att); g.gain.exponentialRampToValueAtTime(.0001, t + att + dur); },
  tone(type, f0, f1, dur, vol = .2, delay = 0, att = .004) {
    if (this.quiet) return; const c = this.o(); if (!c) return; const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, att, dur, vol); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + att + dur + .05);
  },
  noise(dur, vol = .2, type = 'lowpass', f0 = 2000, f1 = f0, delay = 0, q = 1, att = .003) {
    if (this.quiet) return; const c = this.o(); if (!c) return; const t = c.currentTime + delay, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.nb; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, att, dur, vol); s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 1.5); s.stop(t + att + dur + .05);
  },
  sfx(n) {
    if (typeof SET !== 'undefined' && (!SET.sfx || (n === 'click' && !SET.click) || ((n === 'beep' || n === 'go') && !SET.countSnd))) return;
    const v = .9 + Math.random() * .2, R = (a, b) => a + Math.random() * (b - a);
    switch (n) {
      case 'click': this.tone('sine', 1500 * v, 800, .03, .04); break; // 버튼: 살짝 톡
      case 'hit': this.noise(.06, .25, 'bandpass', 2600 * v, 1400, 0, 2.5); this.tone('triangle', 540 * v, 190, .08, .14); break; // 막대 딱
      case 'bump': this.tone('sine', 160 * v, 55, .2, .35); this.noise(.07, .14, 'lowpass', 900, 300); break; // 공끼리 쿵
      case 'thud': this.noise(.11, .22, 'lowpass', 1500 * v, 220); this.tone('sine', 240 * v, 90, .09, .15); break; // 탄환 퍽
      case 'pew': this.tone('square', 1300 * v, 360, .11, .05); this.tone('sine', 1900 * v, 520, .1, .06); break;
      case 'boom': this.noise(.9, .5, 'lowpass', 2600, 60); this.tone('sine', 110, 32, .7, .45); this.noise(.3, .2, 'bandpass', 900, 250, 0, .8); break;
      case 'bang': this.noise(.35, .45, 'lowpass', 3200, 180); this.tone('sine', 190, 60, .22, .3); break;
      case 'whoosh': this.noise(.45, .3, 'bandpass', 280, 2600, 0, 1.3, .05); break;
      case 'zap': for (let i = 0; i < 6; i++) this.noise(.035, .22, 'highpass', R(2500, 6000), 2000, i * .03); this.tone('sawtooth', 95, 60, .3, .07); break;
      case 'laser': this.tone('sawtooth', 2300 * v, 260, .3, .06); this.tone('sine', 1150 * v, 130, .3, .09); break;
      case 'heal': [523, 659, 784, 1047].forEach((f, i) => this.tone('sine', f, f, .35, .07, i * .07)); this.tone('triangle', 2093, 2093, .5, .03, .28); break;
      case 'shield': this.tone('triangle', 660, 990, .4, .08); this.tone('sine', 1320, 1980, .4, .05, .05); this.noise(.3, .05, 'highpass', 6000); break;
      case 'freeze': for (let i = 0; i < 6; i++) this.tone('sine', R(2000, 3600), R(1800, 3400), .16, .04, i * .04); this.noise(.25, .07, 'highpass', 5000); break;
      case 'poison': for (let i = 0; i < 5; i++) this.tone('sine', R(250, 500), R(520, 900), .07, .08, i * .06); break;
      case 'tele': this.tone('sine', 300, 2400, .16, .08); this.tone('sine', 2400, 300, .16, .08, .16); break;
      case 'grow': this.tone('sawtooth', 90, 260, .45, .06); this.noise(.45, .08, 'lowpass', 300, 1400); break;
      case 'vamp': this.tone('sawtooth', 110, 70, .35, .08); this.noise(.35, .12, 'bandpass', 520, 200, 0, 3); break;
      case 'meteor': this.tone('sine', 2400, 500, .75, .05); this.noise(.75, .06, 'bandpass', 3000, 600, 0, 2); break;
      case 'vine': this.noise(.25, .18, 'bandpass', 700, 300, 0, 2); this.tone('triangle', 200, 140, .2, .08); break;
      case 'coin': this.tone('sine', 1568, 1568, .12, .12); this.tone('sine', 2093, 2093, .35, .12, .08); this.tone('sine', 3136, 3136, .25, .03, .08); break;
      case 'beep': this.tone('sine', 1000, 980, .08, .18); this.noise(.015, .08, 'highpass', 4000); break;
      case 'go': [392, 494, 587, 784].forEach(f => this.tone('sawtooth', f, f, .45, .035)); this.noise(.35, .1, 'highpass', 5000); break;
      case 'win': [[523, 659, 784], [587, 740, 880], [784, 988, 1175, 1568]].forEach((ch, i) => ch.forEach(f => this.tone('triangle', f, f, i === 2 ? .7 : .18, .06, i * .16))); this.noise(.8, .08, 'highpass', 6000, 6000, .32); break;
      case 'lose': this.tone('sawtooth', 392, 370, .3, .05); this.tone('sawtooth', 349, 330, .3, .05, .28); this.tone('sawtooth', 294, 220, .7, .06, .56); break;
      // 스킬 소리 선택용
      case 'pop': this.tone('sine', 500 * v, 1300, .06, .16); this.tone('sine', 900, 320, .08, .07, .05); break;
      case 'ding': this.tone('sine', 1320, 1310, .7, .16); this.tone('sine', 2640, 2630, .4, .05); break;
      case 'tada': [523, 659, 784, 1047].forEach(f => this.tone('triangle', f, f, .6, .05, .1)); this.tone('triangle', 392, 392, .1, .06); this.noise(.6, .07, 'highpass', 7000, 7000, .1); break;
      case 'glass': for (let i = 0; i < 7; i++) this.tone('sine', R(2500, 5200), R(2400, 5000), R(.1, .35), .05, i * .025); this.noise(.2, .15, 'highpass', 5000); break;
      case 'buzz': this.tone('sawtooth', 70, 95, .5, .09); this.tone('square', 140, 190, .5, .03); break;
      case 'sparkle': [1047, 1319, 1568, 2093, 2637, 3136].forEach((f, i) => this.tone('sine', f, f, .12, .05, i * .045)); break;
      case 'drum': this.tone('sine', 170, 50, .25, .45); this.tone('sine', 170, 50, .35, .45, .2); this.noise(.06, .1, 'lowpass', 1200); break;
      case 'spring': this.tone('sine', 280, 1000, .14, .14); this.tone('sine', 1000, 240, .3, .12, .14); break;
    }
  },
  async load(k) {
    if (this.bufs[k]) return this.bufs[k];
    const c = this.o(); if (!c) return null; let ab = null;
    try {
      if (k.startsWith('data:')) { const bin = atob(k.split(',')[1]); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); ab = u8.buffer; }
      else { const b = await IDB.get(k); if (!b) return null; ab = await b.arrayBuffer(); }
      return this.bufs[k] = await c.decodeAudioData(ab);
    } catch (e) { return null; }
  },
  playBuf(buf, vol = 1) {
    const c = this.o(); if (!c || !buf) return;
    const s = c.createBufferSource(), g = c.createGain(); g.gain.value = vol; s.buffer = buf; s.connect(g); g.connect(this.master); s.start();
  },
  isFile: snd => !!snd && (snd.startsWith('k_') || snd.startsWith('data:')),
  async skill(snd) { if (!snd || snd === 'none') return; if (this.isFile(snd)) this.playBuf(await this.load(snd)); else this.sfx(snd); },
};
const SOUNDS = { none: '없음', pop: '뿅', boom: '쾅', bang: '펑', zap: '지지직', whoosh: '슝', ding: '띠링', laser: '퓨웅', tada: '짠', glass: '쨍그랑', buzz: '부웅', sparkle: '뾰로롱', drum: '두둥', spring: '띠요옹' };

// AI 사람 인식 배경 제거 (MediaPipe, 처음 사용할 때만 불러옴)
const SEG = {
  p: null, seg: null, ts: 0,
  load() {
    return this.p || (this.p = (async () => {
      const V = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
      const v = await import(V + '/vision_bundle.mjs');
      const fs = await v.FilesetResolver.forVisionTasks(V + '/wasm');
      this.seg = await v.ImageSegmenter.createFromOptions(fs, {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite' },
        runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true,
      });
      return this.seg;
    })().catch(e => { this.p = null; throw e; }));
  },
  apply(ctx) {
    if (!this.seg) { this.load().catch(() => { }); return; }
    const cv = ctx.canvas, W = cv.width, H = cv.height;
    this.ts = Math.max(this.ts + 1, performance.now());
    try {
      this.seg.segmentForVideo(cv, this.ts, r => {
        const m = r.confidenceMasks && r.confidenceMasks[0]; if (!m) return;
        const a = m.getAsFloat32Array(); const id = ctx.getImageData(0, 0, W, H), d = id.data;
        for (let i = 0, j = 3; i < a.length; i++, j += 4) { const v = a[i]; d[j] = v < .3 ? 0 : v > .7 ? d[j] : d[j] * (v - .3) / .4; }
        ctx.putImageData(id, 0, 0);
      });
    } catch (e) { }
  },
};

const ADJ = { br: 100, ct: 100, sat: 100, hue: 0, blur: 0, gray: 0, inv: 0, sep: 0 };
const PRESETS = [['원본', {}], ['흑백', { gray: 100 }], ['빈티지', { sep: 55, ct: 110, sat: 85 }], ['비비드', { sat: 175, ct: 115 }], ['따뜻', { sep: 30, sat: 130, br: 105 }], ['시원', { hue: -18, sat: 90, br: 105 }], ['네온', { sat: 260, ct: 140 }], ['반전', { inv: 100 }], ['몽환', { blur: 1.5, br: 115, sat: 125 }], ['어둡게', { br: 70, ct: 125 }], ['레트로', { sep: 40, hue: -10, ct: 130, sat: 70 }]];
function edits0(o) {
  return Object.assign({ start: 0, end: 0, speed: 1, ...ADJ, preset: 0, flipH: false, flipV: false, rot: 0, zoom: 1, op: 1, key: { mode: 'off', c: '#00ff00', tol: 90, soft: 50 }, text: '', tc: '#ffffff', ts: 30, ty: 85, vol: 1, mute: false }, JSON.parse(JSON.stringify(o || {})));
}
function filterStr(e) { return `brightness(${e.br}%) contrast(${e.ct}%) saturate(${e.sat}%) hue-rotate(${e.hue}deg) blur(${e.blur}px) grayscale(${e.gray}%) invert(${e.inv}%) sepia(${e.sep}%)`; }
function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function drawEdited(ctx, src, e, W, H, fit = 'contain') {
  const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
  ctx.clearRect(0, 0, W, H); if (!sw) return;
  const rot = ((e.rot || 0) % 360 + 360) % 360, swp = rot === 90 || rot === 270;
  const bw = swp ? sh : sw, bh = swp ? sw : sh;
  const s = (fit === 'cover' ? Math.max(W / bw, H / bh) : Math.min(W / bw, H / bh)) * (e.zoom || 1);
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(rot * Math.PI / 180); ctx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
  ctx.globalAlpha = e.op ?? 1; ctx.filter = filterStr(e);
  ctx.drawImage(src, -sw * s / 2, -sh * s / 2, sw * s, sh * s);
  ctx.restore(); ctx.filter = 'none';
  const k = e.key || {};
  if (k.mode === 'color') chroma(ctx, W, H, k); else if (k.mode === 'ai') SEG.apply(ctx);
  if (e.text) {
    ctx.save(); const fs = e.ts * W / 360;
    ctx.font = `700 ${fs}px 'IBM Plex Sans KR',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = fs / 6; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
    ctx.strokeText(e.text, W / 2, H * e.ty / 100); ctx.fillStyle = e.tc; ctx.fillText(e.text, W / 2, H * e.ty / 100); ctx.restore();
  }
}
function chroma(ctx, W, H, k) {
  let id; try { id = ctx.getImageData(0, 0, W, H); } catch (e) { return; }
  const d = id.data, [kr, kg, kb] = hex2rgb(k.c), t = +k.tol, s = Math.max(1, +k.soft);
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.abs(d[i] - kr) + Math.abs(d[i + 1] - kg) + Math.abs(d[i + 2] - kb);
    if (dist < t) d[i + 3] = 0; else if (dist < t + s) d[i + 3] = d[i + 3] * (dist - t) / s;
  }
  ctx.putImageData(id, 0, 0);
}
function autoKey(src) { // 모서리 색을 배경색으로 추정
  const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); x.drawImage(src, 0, 0, 32, 32);
  const d = x.getImageData(0, 0, 32, 32).data; let r = 0, g = 0, b = 0, n = 0;
  for (const [px, py] of [[1, 1], [30, 1], [1, 30], [30, 30], [16, 1], [1, 16], [30, 16]]) { const i = (py * 32 + px) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  return '#' + [r, g, b].map(v => (v / n | 0).toString(16).padStart(2, '0')).join('');
}
function loadEl(src, kind) {
  return new Promise((res, rej) => {
    if (kind === 'image') { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; return; }
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    v.onloadeddata = () => res(v); v.onerror = rej; v.src = src; v.load();
  });
}
function fixDur(v) { // MediaRecorder 영상은 길이가 Infinity 로 나와서 보정
  return new Promise(res => {
    if (isFinite(v.duration) && v.duration > 0) return res(v.duration);
    const f = () => { if (isFinite(v.duration)) { v.removeEventListener('durationchange', f); v.currentTime = 0; res(v.duration); } };
    v.addEventListener('durationchange', f); v.currentTime = 1e7;
    setTimeout(() => { v.removeEventListener('durationchange', f); res(isFinite(v.duration) ? v.duration : 10); }, 3000);
  });
}
function seekTo(v, t) { return new Promise(r => { v.addEventListener('seeked', () => r(), { once: true }); v.currentTime = t; setTimeout(r, 1500); }); }
async function makeThumb(src, kind, e, w = 180, hh = 320) {
  const el = await loadEl(src, kind);
  if (kind === 'video') { await fixDur(el); await seekTo(el, (e.start || 0) + .1); }
  const c = document.createElement('canvas'); c.width = w; c.height = hh; const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, w, hh); const t = document.createElement('canvas'); t.width = w; t.height = hh;
  drawEdited(t.getContext('2d'), el, e, w, hh, 'cover'); x.drawImage(t, 0, 0);
  return c.toDataURL('image/jpeg', .65);
}

// 편집된 영상을 캔버스로 재생
function makePlayer(box, src, kind, edits, { fit = 'contain', muted = false } = {}) {
  const e = edits0(edits), cv = document.createElement('canvas'); box.appendChild(cv);
  const ctx = cv.getContext('2d', { willReadFrequently: e.key.mode !== 'off' });
  const q = e.key.mode !== 'off' ? 1 : Math.min(2, devicePixelRatio || 1);
  const size = () => { cv.width = Math.max(2, box.clientWidth * q | 0); cv.height = Math.max(2, box.clientHeight * q | 0); };
  size();
  let el = null, raf = 0, alive = true, playing = false;
  const P = {
    el: null,
    play() { playing = true; if (el && kind === 'video') { el.playbackRate = e.speed; el.play().catch(() => { el.muted = true; el.play().catch(() => { }); }); } },
    pause() { playing = false; if (el && kind === 'video') el.pause(); },
    toggle() { playing ? P.pause() : P.play(); return playing; },
    destroy() { alive = false; cancelAnimationFrame(raf); if (el && kind === 'video') { el.pause(); el.removeAttribute('src'); el.load(); } cv.remove(); },
  };
  loadEl(src, kind).then(async x => {
    if (!alive) return; el = P.el = x;
    if (kind === 'video') {
      await fixDur(el); if (!alive) return;
      el.muted = muted || e.mute; el.volume = Math.min(1, e.vol); el.currentTime = e.start || 0;
      if (playing) P.play();
    }
    const loop = () => {
      if (!alive) return;
      if (kind === 'video') {
        const end = e.end && e.end > e.start ? e.end : el.duration;
        if (el.currentTime >= end - .03 || el.ended) { el.currentTime = e.start || 0; if (playing) el.play().catch(() => { }); }
      }
      if (cv.width !== (box.clientWidth * q | 0)) size();
      drawEdited(ctx, el, e, cv.width, cv.height, fit);
      raf = requestAnimationFrame(loop);
    };
    loop();
  }).catch(() => { });
  return P;
}

// ===== 편집기 =====
const ED_TOOLS = [['trim', '자르기', 'scissors', 1], ['speed', '속도', 'gauge', 1], ['filter', '필터', 'sparkle'], ['adj', '보정', 'sliders'], ['bg', '배경제거', 'wand'], ['text', '텍스트', 'text'], ['xf', '회전·반전', 'flip'], ['zoom', '확대·투명', 'zoom'], ['vol', '볼륨', 'volume', 1]];
async function openEditor(src, kind, edits, onDone, { ratio = 1 } = {}) {
  const e = edits0(edits); let el;
  try { el = await loadEl(src, kind); } catch (x) { toast('파일을 열 수 없어요'); return; }
  let dur = 0;
  if (kind === 'video') { dur = await fixDur(el); if (!e.end || e.end > dur) e.end = dur; el.muted = false; el.currentTime = e.start; }
  const tools = ED_TOOLS.filter(t => !t[3] || kind === 'video');
  const m = h(`<div class="editor">
    <div class="ed-top"><button class="icon-btn" data-x>${ic('x')}</button><b>편집</b><button class="ed-ok">완료</button></div>
    <div class="ed-stage"><canvas style="aspect-ratio:1/${ratio}"></canvas>${kind === 'video' ? `<button class="ed-pp">${ic('play', 30)}</button>` : ''}</div>
    ${kind === 'video' ? `<div class="ed-tl"><input type="range" class="ed-seek" min="0" max="${dur}" step="0.01" value="${e.start}"><span class="ed-tm"></span></div>` : ''}
    <div class="ed-panel"></div>
    <div class="ed-tools">${tools.map(([k, n, i]) => `<button data-t="${k}">${ic(i, 22)}<small>${n}</small></button>`).join('')}</div>
  </div>`);
  $('#modal-root').appendChild(m);
  const cv = $('canvas', m), W = 360, H = Math.round(360 * ratio); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  let playing = false, raf = 0, tool = tools[0][0];
  const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${Math.floor(t * 10 % 10)}`;
  const loop = () => {
    if (kind === 'video') {
      if (playing && el.currentTime >= e.end - .03) { el.currentTime = e.start; }
      const sk = $('.ed-seek', m); if (sk && playing) sk.value = el.currentTime;
      $('.ed-tm', m).textContent = `${fmt(el.currentTime)} / ${fmt(e.end - e.start)} 구간`;
    }
    drawEdited(ctx, el, e, W, H, 'contain');
    raf = requestAnimationFrame(loop);
  };
  loop();
  const setPlay = v => { playing = v; if (v) { el.playbackRate = e.speed; el.volume = Math.min(1, e.vol); el.muted = e.mute; el.play().catch(() => { }); } else el.pause(); const b = $('.ed-pp', m); if (b) b.innerHTML = ic(v ? 'pause' : 'play', 30); b && b.classList.toggle('dim', v); };
  if (kind === 'video') { $('.ed-pp', m).onclick = () => setPlay(!playing); $('.ed-seek', m).oninput = ev => { el.currentTime = +ev.target.value; }; }
  const close = () => { cancelAnimationFrame(raf); if (kind === 'video') el.pause(); m.classList.add('out'); setTimeout(() => m.remove(), 250); };
  $('[data-x]', m).onclick = close;
  $('.ed-ok', m).onclick = () => { close(); onDone(e); };
  const rng = (label, k, min, max, step, unit = '') => { const v = k.split('.').reduce((o, p) => o[p], e); return `<label class="ed-rng"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}"><output>${(+v).toFixed(step < 1 ? 1 : 0)}${unit}</output></label>`; };
  const chips = (k, list) => `<div class="chips">${list.map(([v, n]) => `<button class="chip ${String(k.split('.').reduce((o, p) => o[p], e)) === String(v) ? 'on' : ''}" data-set="${k}" data-v="${v}">${n}</button>`).join('')}</div>`;
  const panel = () => {
    const P = $('.ed-panel', m); let x = '';
    if (tool === 'trim') x = rng('시작', 'start', 0, dur, .05, 's') + rng('끝', 'end', 0, dur, .05, 's');
    if (tool === 'speed') x = chips('speed', [[.25, '0.25x'], [.5, '0.5x'], [.75, '0.75x'], [1, '1x'], [1.5, '1.5x'], [2, '2x'], [3, '3x']]);
    if (tool === 'filter') x = `<div class="chips">${PRESETS.map(([n], i) => `<button class="chip ${e.preset == i ? 'on' : ''}" data-pre="${i}">${n}</button>`).join('')}</div>`;
    if (tool === 'adj') x = rng('밝기', 'br', 0, 200, 1, '%') + rng('대비', 'ct', 0, 200, 1, '%') + rng('채도', 'sat', 0, 300, 1, '%') + rng('색조', 'hue', -180, 180, 1, '°') + rng('흐림', 'blur', 0, 10, .1, 'px') + rng('세피아', 'sep', 0, 100, 1, '%') + rng('흑백', 'gray', 0, 100, 1, '%');
    if (tool === 'bg') {
      x = chips('key.mode', [['off', '끄기'], ['ai', 'AI 사람 인식'], ['color', '색상(크로마키)']]);
      if (e.key.mode === 'ai') x += `<p class="muted sm">${SEG.seg ? 'AI 배경 제거 준비 완료' : 'AI 모델 불러오는 중... (인터넷 필요)'}</p>`;
      if (e.key.mode === 'color') x += `<div class="row-c"><label class="ed-rng"><span>배경색</span><input type="color" data-k="key.c" value="${e.key.c}"></label><button class="chip" data-auto>${ic('wand', 16)} 자동 감지</button></div>` + rng('범위', 'key.tol', 0, 300, 1) + rng('부드럽게', 'key.soft', 0, 200, 1);
    }
    if (tool === 'text') x = `<input class="inp" data-k="text" placeholder="텍스트 입력" value="${esc(e.text)}" maxlength="40"><div class="row-c"><label class="ed-rng"><span>색</span><input type="color" data-k="tc" value="${e.tc}"></label></div>` + rng('크기', 'ts', 12, 80, 1) + rng('위치', 'ty', 5, 95, 1, '%');
    if (tool === 'xf') x = `<div class="chips"><button class="chip" data-rot>${ic('rotate', 16)} 90° 회전</button><button class="chip ${e.flipH ? 'on' : ''}" data-tg="flipH">${ic('flip', 16)} 좌우 반전</button><button class="chip ${e.flipV ? 'on' : ''}" data-tg="flipV">상하 반전</button></div>`;
    if (tool === 'zoom') x = rng('확대', 'zoom', .5, 3, .05, 'x') + rng('투명도', 'op', .1, 1, .05);
    if (tool === 'vol') x = rng('볼륨', 'vol', 0, 1, .05) + `<div class="chips"><button class="chip ${e.mute ? 'on' : ''}" data-tg="mute">음소거</button></div>`;
    P.innerHTML = x;
    $$('.ed-tools button', m).forEach(b => b.classList.toggle('on', b.dataset.t === tool));
  };
  const setK = (k, v) => { const ps = k.split('.'); let o = e; while (ps.length > 1) o = o[ps.shift()]; o[ps[0]] = v; };
  m.addEventListener('input', ev => {
    const t = ev.target, k = t.dataset.k; if (!k) return;
    let v = t.type === 'range' ? +t.value : t.value; setK(k, v);
    if (k === 'start' && e.start > e.end - .2) { e.start = Math.max(0, e.end - .2); t.value = e.start; }
    if (k === 'end' && e.end < e.start + .2) { e.end = Math.min(dur, e.start + .2); t.value = e.end; }
    if ((k === 'start' || k === 'end') && kind === 'video') el.currentTime = k === 'start' ? e.start : Math.max(e.start, e.end - .5);
    if (k === 'vol') el.volume = Math.min(1, v); if (k === 'speed') el.playbackRate = v;
    const o = t.type === 'range' && t.parentElement.querySelector('output'); if (o) o.textContent = (+v).toFixed(+t.step < 1 ? 1 : 0);
  });
  m.addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.t) { tool = b.dataset.t; panel(); return; }
    if (b.dataset.set) { const v = b.dataset.v; setK(b.dataset.set, isNaN(+v) ? v : +v); if (b.dataset.set === 'speed') el.playbackRate = e.speed; if (b.dataset.set === 'key.mode' && v === 'ai') SEG.load().then(panel).catch(() => toast('AI 모델을 불러오지 못했어요')); panel(); }
    if (b.dataset.pre != null) { Object.assign(e, ADJ, PRESETS[+b.dataset.pre][1]); e.preset = +b.dataset.pre; panel(); }
    if (b.dataset.tg) { e[b.dataset.tg] = !e[b.dataset.tg]; if (b.dataset.tg === 'mute') el.muted = e.mute; panel(); }
    if (b.hasAttribute('data-rot')) e.rot = (e.rot + 90) % 360;
    if (b.hasAttribute('data-auto')) { try { e.key.c = autoKey(el); } catch (x) { } panel(); }
  });
  panel();
}

