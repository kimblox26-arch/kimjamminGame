'use strict';
// ===== 사운드 / 영상 편집 / 배경 제거 / 플레이어 =====
const AUD = {
  ctx: null, master: null, dest: null, bufs: {},
  init() {
    if (this.ctx) return this.ctx;
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    this.ctx = new C(); this.master = this.ctx.createGain(); this.master.gain.value = .8; this.master.connect(this.ctx.destination);
    try { this.dest = this.ctx.createMediaStreamDestination(); this.master.connect(this.dest); } catch (e) { }
    return this.ctx;
  },
  o() { const c = this.init(); if (c && c.state === 'suspended') c.resume(); return c; },
  tone(type, f0, f1, dur, vol = .25, delay = 0) {
    const c = this.o(); if (!c) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + .05);
  },
  noise(dur, vol = .3, f0 = 2000, f1 = 200, type = 'lowpass') {
    const c = this.o(); if (!c) return;
    const n = c.createBuffer(1, c.sampleRate * dur | 0, c.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = c.createBufferSource(); s.buffer = n; const f = c.createBiquadFilter(); f.type = type; const t = c.currentTime;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start();
  },
  sfx(n) {
    switch (n) {
      case 'pop': this.tone('sine', 800, 200, .15); break;
      case 'boom': this.noise(.6, .5, 1500, 60); this.tone('sine', 120, 40, .5, .4); break;
      case 'zap': this.tone('square', 1400, 120, .22, .12); break;
      case 'whoosh': this.noise(.4, .3, 400, 3000, 'bandpass'); break;
      case 'ding': this.tone('sine', 1320, 1300, .6, .2); this.tone('sine', 1980, 1970, .4, .1); break;
      case 'laser': this.tone('sawtooth', 1800, 250, .28, .12); break;
      case 'coin': this.tone('square', 988, 988, .08, .1); this.tone('square', 1319, 1319, .3, .1, .08); break;
      case 'hit': this.tone('triangle', 300, 80, .1, .22); this.noise(.08, .12, 3000, 500); break;
      case 'beep': this.tone('sine', 880, 880, .14, .2); break;
      case 'go': this.tone('square', 660, 1320, .35, .15); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone('square', f, f, .28, .12, i * .12)); break;
      case 'lose': [392, 330, 262].forEach((f, i) => this.tone('triangle', f, f * .97, .4, .2, i * .18)); break;
      case 'click': this.tone('sine', 620, 480, .05, .08); break;
    }
  },
  async load(k) {
    if (this.bufs[k]) return this.bufs[k];
    const c = this.o(); const b = await IDB.get(k).catch(() => null); if (!b || !c) return null;
    try { return this.bufs[k] = await c.decodeAudioData(await b.arrayBuffer()); } catch (e) { return null; }
  },
  playBuf(buf, vol = 1) {
    const c = this.o(); if (!c || !buf) return;
    const s = c.createBufferSource(), g = c.createGain(); g.gain.value = vol; s.buffer = buf; s.connect(g); g.connect(this.master); s.start();
  },
  async skill(snd) { if (!snd || snd === 'none') return; if (snd.startsWith('k_')) this.playBuf(await this.load(snd)); else this.sfx(snd); },
};
const SOUNDS = { none: '없음', pop: '뿅', boom: '쾅', zap: '지잉', whoosh: '슝', ding: '띠링', laser: '퓨웅' };

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
    ctx.font = `${fs}px 'Black Han Sans',Jua,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
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

// 마이크로 소리 녹음 (최대 3초)
async function recordSound() {
  let st; try { st = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) { toast('마이크를 쓸 수 없어요'); return null; }
  return new Promise(res => {
    const r = new MediaRecorder(st), ch = []; r.ondataavailable = e => ch.push(e.data);
    const m = modal(`<div class="rec-ui"><div class="rec-pulse">${ic('mic', 40)}</div><p>녹음 중... (최대 3초)</p><button class="btn-main" data-s>완료</button></div>`);
    const stop = () => { if (r.state !== 'inactive') r.stop(); };
    r.onstop = () => { st.getTracks().forEach(t => t.stop()); m._onclose = null; m.close(); res(new Blob(ch, { type: r.mimeType || 'audio/webm' })); };
    m._onclose = stop; $('[data-s]', m).onclick = stop; r.start(); setTimeout(stop, 3000);
  });
}
