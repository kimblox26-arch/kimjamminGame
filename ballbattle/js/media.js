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
      case 'click': this.noise(.018, .06, 'highpass', 3500 * v); break; // 톡
      case 'enter': this.noise(.7, .2, 'bandpass', 220, 3400, 0, 1, .3); this.noise(.5, .06, 'highpass', 7000, 9000, .35); [261.6, 329.6, 392, 523.3].forEach((f, i) => this.tone('sine', f, f, 1.3, .06, .3 + i * .05, .03)); this.tone('sine', 65.4, 65.4, 1, .14, .3, .02); break; // 휘익 + 화음
      case 'hit': this.noise(.05, .3, 'bandpass', 1900 * v, 900, 0, 2.2); this.tone('sine', 140 * v, 55, .07, .3); break; // 탁
      case 'bump': this.tone('sine', 210 * v, 70, .16, .4); this.noise(.06, .16, 'lowpass', 1200, 300); break; // 퉁
      case 'thud': this.noise(.12, .28, 'lowpass', 1600 * v, 180); this.tone('sine', 100 * v, 45, .12, .3); break; // 퍽
      case 'pew': this.noise(.14, .22, 'bandpass', 3200 * v, 700, 0, 1.6, .005); break; // 슉
      case 'boom': this.noise(1, .55, 'lowpass', 2400, 50); this.tone('sine', 85, 28, .8, .5); this.noise(.3, .2, 'bandpass', 700, 200, 0, .7); break; // 쾅
      case 'bang': this.noise(.35, .45, 'lowpass', 3000, 160); this.tone('sine', 120, 40, .25, .35); break; // 펑
      case 'whoosh': this.noise(.45, .3, 'bandpass', 260, 2600, 0, 1.2, .08); break; // 휙
      case 'zap': for (let i = 0; i < 7; i++) this.noise(.03, .22, 'highpass', R(2500, 7000), 1800, i * .028); this.noise(.25, .1, 'bandpass', 900, 400, 0, 4); break; // 지지직
      case 'laser': this.noise(.28, .2, 'bandpass', 5200 * v, 1200, 0, 6); this.noise(.12, .12, 'highpass', 6000, 3000); break; // 치익
      case 'heal': this.noise(.6, .07, 'highpass', 6000, 9000, 0, 1, .15); [784, 988, 1319].forEach((f, i) => this.tone('sine', f, f, .7, .035, i * .08, .03)); break; // 반짝
      case 'shield': this.noise(.5, .12, 'bandpass', 1800, 4200, 0, 3, .05); this.tone('sine', 520, 540, .5, .04, 0, .05); break; // 위잉
      case 'freeze': for (let i = 0; i < 6; i++) this.tone('sine', R(2600, 4200), R(2500, 4000), R(.08, .25), .03, i * .03); this.noise(.3, .1, 'highpass', 6000); break; // 쨍
      case 'poison': for (let i = 0; i < 6; i++) this.noise(.05, .14, 'bandpass', R(500, 1400), R(300, 900), i * .055, 8); break; // 보글
      case 'tele': this.noise(.18, .2, 'bandpass', 400, 5000, 0, 2); this.noise(.18, .2, 'bandpass', 5000, 400, .18, 2); break; // 슝-
      case 'grow': this.noise(.5, .16, 'lowpass', 250, 1600, 0, 1, .1); this.tone('sine', 70, 130, .5, .2, 0, .1); break; // 부웅
      case 'vamp': this.noise(.35, .2, 'bandpass', 600, 180, 0, 3); this.tone('sine', 90, 60, .3, .2); break; // 흡
      case 'meteor': this.noise(.8, .12, 'bandpass', 4500, 500, 0, 3, .1); break; // 휘이잉
      case 'vine': this.noise(.25, .2, 'bandpass', 800, 300, 0, 2); this.noise(.08, .1, 'lowpass', 600, 200, .12); break; // 스륵
      case 'spring': this.tone('sine', 160, 420, .12, .2); this.noise(.06, .1, 'bandpass', 1500, 2500); break; // 통!
      case 'coin': [2100, 2950, 4200].forEach((f, i) => this.tone('sine', f, f * .998, .45 - i * .1, .06 / (i + 1), 0, .002)); this.noise(.02, .1, 'highpass', 5000); break; // 칭
      case 'ding': [1568, 2350, 3136].forEach((f, i) => this.tone('sine', f, f, .7 - i * .15, .05 / (i + 1), 0, .003)); break;
      case 'beep': this.tone('sine', 190, 105, .25, .45); this.noise(.04, .12, 'lowpass', 900, 300); break; // 둥 (북)
      case 'go': this.tone('sine', 120, 45, .45, .55); this.noise(.9, .22, 'highpass', 5000, 7000, .02, 1, .005); this.noise(.15, .2, 'lowpass', 1500, 300); break; // 쿵 + 챙
      case 'win': for (let i = 0; i < 14; i++) this.noise(.06, .12, 'bandpass', R(900, 2200), R(700, 1800), .1 + i * R(.05, .1), 1.5); this.noise(1.6, .12, 'bandpass', 1100, 1300, 0, .6, .3); this.tone('sine', 98, 49, .4, .4); [523.3, 659.3, 784].forEach((f, i) => this.tone('triangle', f, f, .9, .04, .2 + i * .08, .02)); break; // 와아 + 박수
      case 'lose': this.noise(.9, .2, 'bandpass', 1200, 160, 0, 1.5, .05); this.tone('sine', 150, 55, .8, .3, .1); break; // 휘융-
      case 'pop': this.noise(.05, .3, 'bandpass', 1400, 2600, 0, 3); this.tone('sine', 400, 900, .06, .12); break;
      case 'tada': this.tone('sine', 98, 49, .3, .35); [523.3, 659.3, 784, 1047].forEach(f => this.tone('triangle', f, f, .7, .04, .08, .02)); this.noise(.8, .1, 'highpass', 6000, 8000, .08); break;
      case 'glass': for (let i = 0; i < 8; i++) this.tone('sine', R(2500, 5500), R(2400, 5000), R(.1, .35), .04, i * .02, .002); this.noise(.25, .2, 'highpass', 4500); break;
      case 'buzz': this.noise(.5, .18, 'bandpass', 120, 160, 0, 6); this.tone('sawtooth', 60, 70, .5, .05); break;
      case 'sparkle': for (let i = 0; i < 6; i++) this.tone('sine', R(2000, 4000), R(2000, 4000), .15, .03, i * .05, .002); this.noise(.4, .05, 'highpass', 8000); break;
      case 'drum': this.tone('sine', 170, 50, .25, .5); this.tone('sine', 170, 50, .35, .5, .2); this.noise(.06, .12, 'lowpass', 1200); break;
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
  return Object.assign({ start: 0, end: 0, speed: 1, ...ADJ, preset: 0, flipH: false, flipV: false, rot: 0, zoom: 1, op: 1, key: { mode: 'off', c: '#00ff00', tol: 90, soft: 50 }, ol: { w: 0, c: '#ffffff' }, vig: 0, text: '', tc: '#ffffff', ts: 30, ty: 85, vol: 1, mute: false }, JSON.parse(JSON.stringify(o || {})));
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
  if (e.ol && e.ol.w > 0) outlineFx(ctx, W, H, e.ol);
  if (e.vig > 0) { const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .25, W / 2, H / 2, Math.max(W, H) * .75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${e.vig / 100})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  if (e.text) {
    ctx.save(); const fs = e.ts * W / 360;
    ctx.font = `700 ${fs}px 'IBM Plex Sans KR',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = fs / 6; ctx.strokeStyle = '#000'; ctx.lineJoin = 'round';
    ctx.strokeText(e.text, W / 2, H * e.ty / 100); ctx.fillStyle = e.tc; ctx.fillText(e.text, W / 2, H * e.ty / 100); ctx.restore();
  }
}
const _ol = {};
function outlineFx(ctx, W, H, o) { // 배경을 지운 뒤 사람·물체 둘레에 테두리
  const mk = n => { const c = _ol[n] || (_ol[n] = document.createElement('canvas')); if (c.width !== W || c.height !== H) { c.width = W; c.height = H; } const x = c.getContext('2d'); x.clearRect(0, 0, W, H); return [c, x]; };
  const [a, ax] = mk('a'), [b, bx] = mk('b'); ax.drawImage(ctx.canvas, 0, 0);
  for (let i = 0; i < 12; i++) { const t = i / 12 * Math.PI * 2; bx.drawImage(a, Math.cos(t) * o.w, Math.sin(t) * o.w); }
  bx.globalCompositeOperation = 'source-in'; bx.fillStyle = o.c; bx.fillRect(0, 0, W, H); bx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H); ctx.drawImage(b, 0, 0); ctx.drawImage(a, 0, 0);
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
const ED_TOOLS = [['trim', '자르기', 'scissors', 1], ['speed', '속도', 'gauge', 1], ['filter', '필터', 'sparkle'], ['adj', '보정', 'sliders'], ['bg', '배경제거', 'wand'], ['text', '텍스트', 'text'], ['ol', '외곽선', 'pencil'], ['vig', '분위기', 'eye'], ['xf', '회전·반전', 'flip'], ['zoom', '확대·투명', 'zoom'], ['vol', '볼륨', 'volume', 1]];
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
    if (tool === 'ol') x = `<p class="muted sm">배경을 지운 뒤 쓰면 스티커처럼 테두리가 생겨요</p><div class="row-c"><label class="ed-rng"><span>색</span><input type="color" data-k="ol.c" value="${e.ol.c}"></label></div>` + rng('두께', 'ol.w', 0, 12, 1);
    if (tool === 'vig') x = rng('가장자리 어둡게', 'vig', 0, 90, 1);
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

