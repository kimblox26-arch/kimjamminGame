'use strict';
// ===== 스킬 만들기 도구: 그림 그리기 / 영상 소리로 스킬 소리 만들기 =====
const DR_COLORS = ['#111111', '#ffffff', '#FE2C55', '#ff922b', '#ffd43b', '#51cf66', '#25F4EE', '#4dabf7', '#7048e8', '#e64980', '#8d6e63'];
function openDraw(baseSrc, onDone) {
  const m = h(`<div class="editor light-ed"><div class="ed-top"><button class="icon-btn" data-x>${ic('x')}</button><b>그림 그리기</b><button class="ed-ok">완료</button></div>
    <div class="dr-stage"><canvas class="dr-cv" width="512" height="512"></canvas></div>
    <div class="dr-tools">
      <div class="dr-row">${DR_COLORS.map(c => `<button class="dr-col" data-col="${c}" style="--c:${c}"></button>`).join('')}<input type="color" class="dr-pick" value="#111111"></div>
      <div class="dr-row">${[5, 12, 26].map(s => `<button class="dr-size" data-size="${s}"><i style="width:${4 + s / 1.5}px;height:${4 + s / 1.5}px"></i></button>`).join('')}
        <button class="dr-btn" data-tool="pen">${ic('pencil', 17)} 펜</button><button class="dr-btn" data-tool="erase">지우개</button><button class="dr-btn" data-tool="fill">채우기</button></div>
      <div class="dr-row"><button class="dr-btn" data-undo>${ic('rotate', 17)} 되돌리기</button><button class="dr-btn" data-clear>${ic('x', 17)} 전체 지우기</button></div>
    </div></div>`);
  $('#modal-root').appendChild(m);
  const cv = $('.dr-cv', m), x = cv.getContext('2d', { willReadFrequently: true }); x.lineCap = 'round'; x.lineJoin = 'round';
  let col = '#111111', size = 12, tool = 'pen', last = null; const undo = [];
  const ui = () => {
    $$('.dr-col', m).forEach(b => b.classList.toggle('on', b.dataset.col === col)); $$('.dr-size', m).forEach(b => b.classList.toggle('on', +b.dataset.size === size));
    $$('[data-tool]', m).forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
  };
  if (baseSrc) loadEl(baseSrc, 'image').then(i => x.drawImage(i, 0, 0, 512, 512)).catch(() => { });
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * 512 / r.width, (e.clientY - r.top) * 512 / r.height]; };
  const snap = () => { undo.push(x.getImageData(0, 0, 512, 512)); if (undo.length > 25) undo.shift(); };
  cv.onpointerdown = e => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId); snap(); const p = pos(e);
    if (tool === 'fill') return fill(p[0] | 0, p[1] | 0);
    last = p; stroke(p, p);
  };
  cv.onpointermove = e => { if (!last) return; const p = pos(e); stroke(last, p); last = p; };
  cv.onpointerup = cv.onpointercancel = () => { last = null; };
  function stroke(a, b) {
    x.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
    x.strokeStyle = col; x.lineWidth = size; x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); x.globalCompositeOperation = 'source-over';
  }
  function fill(sx, sy) { // 같은 색 영역 채우기
    const id = x.getImageData(0, 0, 512, 512), d = id.data, i0 = (sy * 512 + sx) * 4, t = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
    const [r, g, b] = hex2rgb(col); if (t[0] === r && t[1] === g && t[2] === b && t[3] === 255) return;
    const same = i => Math.abs(d[i] - t[0]) + Math.abs(d[i + 1] - t[1]) + Math.abs(d[i + 2] - t[2]) + Math.abs(d[i + 3] - t[3]) < 60;
    const st = [sx, sy]; const seen = new Uint8Array(512 * 512);
    while (st.length) { const yy = st.pop(), xx = st.pop(); if (xx < 0 || yy < 0 || xx > 511 || yy > 511) continue; const k = yy * 512 + xx; if (seen[k]) continue; seen[k] = 1; const i = k * 4; if (!same(i)) continue; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; st.push(xx + 1, yy, xx - 1, yy, xx, yy + 1, xx, yy - 1); }
    x.putImageData(id, 0, 0);
  }
  m.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.col) { col = b.dataset.col; if (tool === 'erase') tool = 'pen'; }
    if (b.dataset.size) size = +b.dataset.size;
    if (b.dataset.tool) tool = b.dataset.tool;
    if (b.hasAttribute('data-undo')) { const u = undo.pop(); if (u) x.putImageData(u, 0, 0); }
    if (b.hasAttribute('data-clear')) { snap(); x.clearRect(0, 0, 512, 512); }
    ui();
  });
  $('.dr-pick', m).oninput = e => { col = e.target.value; if (tool === 'erase') tool = 'pen'; ui(); };
  const close = () => { m.classList.add('out'); setTimeout(() => m.remove(), 250); };
  $('[data-x]', m).onclick = close;
  $('.ed-ok', m).onclick = () => {
    const d = x.getImageData(0, 0, 512, 512).data; let any = false; for (let i = 3; i < d.length; i += 16) if (d[i]) { any = true; break; }
    if (!any) return toast('그림을 그려주세요');
    const t = document.createElement('canvas'); t.width = t.height = 128; t.getContext('2d').drawImage(cv, 0, 0, 128, 128);
    cv.toBlob(b => { close(); onDone(b, t.toDataURL('image/png')); }, 'image/png');
  };
  ui();
}

// --- 영상 소리를 잘라서 스킬 소리 만들기 ---
const SND_RATE = 16000, SND_MAX = 3;
async function openSoundMaker(onDone) {
  const recs = D.recs.filter(r => r.uid === (me() || {}).uid);
  const pickM = modal(`<h3 class="m-title">${ic('music')} 어떤 영상의 소리를 쓸까요?</h3>
    <button class="btn-main w100" data-gal>${ic('image', 18)} 갤러리에서 동영상 선택</button>
    ${recs.length ? `<p class="lbl">내 플레이 영상</p><div class="pick-grid">${recs.map(r => `<button data-rec="${r.id}"><img src="${r.thumb}" alt=""><small>${MAPS[r.map].name} · ${fmtDur(r.dur)}</small></button>`).join('')}</div>` : ''}`);
  const blob = await new Promise(res => {
    pickM._onclose = () => res(null);
    $('[data-gal]', pickM).onclick = async () => { const f = await pickFile('video/*'); pickM._onclose = null; pickM.close(); res(f); };
    $$('[data-rec]', pickM).forEach(b => b.onclick = async () => { const r = recs.find(z => z.id === b.dataset.rec); pickM._onclose = null; pickM.close(); res(r ? await IDB.get(r.key) : null); });
  });
  if (!blob) return;
  const ctx = AUD.o(); let src = null;
  try { src = await ctx.decodeAudioData(await blob.arrayBuffer()); } catch (e) { }
  if (!src || src.duration < .1) return toast('이 영상에서 소리를 읽지 못했어요. 다른 영상을 골라주세요');
  const ch0 = src.getChannelData(0), dur = src.duration;
  const st = { start: 0, len: Math.min(1.5, dur), vol: 1, speed: 1, rev: false, fade: true };
  const m = h(`<div class="editor light-ed"><div class="ed-top"><button class="icon-btn" data-x>${ic('x')}</button><b>소리 만들기</b><button class="ed-ok">완료</button></div>
    <div class="sm-body"><canvas class="sm-wave" width="720" height="220"></canvas><div class="sm-time"></div>
      <label class="ed-rng"><span>시작</span><input type="range" data-k="start" min="0" max="${dur.toFixed(2)}" step="0.01" value="0"><output></output></label>
      <label class="ed-rng"><span>길이</span><input type="range" data-k="len" min="0.2" max="${Math.min(SND_MAX, dur).toFixed(2)}" step="0.05" value="${st.len}"><output></output></label>
      <label class="ed-rng"><span>크기</span><input type="range" data-k="vol" min="0" max="2" step="0.05" value="1"><output></output></label>
      <div class="chips">${[[.5, '0.5x 굵게'], [.75, '0.75x'], [1, '1x'], [1.5, '1.5x'], [2, '2x 가늘게']].map(([v, n]) => `<button class="chip ${v === 1 ? 'on' : ''}" data-speed="${v}">${n}</button>`).join('')}</div>
      <div class="chips"><button class="chip" data-tg="rev">거꾸로</button><button class="chip on" data-tg="fade">부드럽게 시작·끝</button></div>
      <button class="btn-sec w100" data-play>${ic('play', 18)} 들어보기</button></div></div>`);
  $('#modal-root').appendChild(m);
  const wv = $('.sm-wave', m), wx = wv.getContext('2d');
  const peaks = Array.from({ length: 720 }, (_, i) => { const a = Math.floor(i / 720 * ch0.length), b = Math.floor((i + 1) / 720 * ch0.length); let mx = 0; for (let j = a; j < b; j += 8) mx = Math.max(mx, Math.abs(ch0[j])); return mx; });
  const draw = () => {
    wx.clearRect(0, 0, 720, 220); const s0 = st.start / dur * 720, s1 = Math.min(dur, st.start + st.len) / dur * 720;
    wx.fillStyle = 'rgba(254,44,85,.12)'; wx.fillRect(s0, 0, s1 - s0, 220);
    peaks.forEach((p, i) => { wx.fillStyle = i >= s0 && i <= s1 ? '#FE2C55' : '#c9c9d1'; const hh = Math.max(2, p * 200); wx.fillRect(i, 110 - hh / 2, 1, hh); });
    wx.fillStyle = '#111'; wx.fillRect(s0, 0, 2, 220); wx.fillRect(s1 - 2, 0, 2, 220);
    $('.sm-time', m).textContent = `${st.start.toFixed(2)}초부터 ${Math.min(st.len, dur - st.start).toFixed(2)}초 · 전체 ${dur.toFixed(1)}초`;
    $$('[data-k]', m).forEach(i => i.nextElementSibling.textContent = (+st[i.dataset.k]).toFixed(2));
  };
  async function render() { // 고른 구간을 효과까지 적용해서 새 소리로
    const a = Math.floor(st.start * src.sampleRate), n = Math.max(1, Math.floor(Math.min(st.len, dur - st.start) * src.sampleRate));
    const seg = ctx.createBuffer(1, n, src.sampleRate), sd = seg.getChannelData(0);
    for (let c = 0; c < src.numberOfChannels; c++) { const cd = src.getChannelData(c); for (let i = 0; i < n; i++) sd[i] += (cd[a + i] || 0) / src.numberOfChannels; }
    if (st.rev) sd.reverse();
    const outLen = Math.ceil(n / src.sampleRate / st.speed * SND_RATE), off = new OfflineAudioContext(1, outLen, SND_RATE);
    const s = off.createBufferSource(), g = off.createGain(), T = outLen / SND_RATE; s.buffer = seg; s.playbackRate.value = st.speed;
    g.gain.setValueAtTime(st.fade ? 0 : st.vol, 0); if (st.fade) { g.gain.linearRampToValueAtTime(st.vol, Math.min(.03, T / 4)); g.gain.setValueAtTime(st.vol, Math.max(0, T - .08)); g.gain.linearRampToValueAtTime(0, T); }
    s.connect(g); g.connect(off.destination); s.start(); return off.startRendering();
  }
  m.addEventListener('input', e => { const k = e.target.dataset.k; if (!k) return; st[k] = +e.target.value; if (st.start > dur - .2) st.start = Math.max(0, dur - .2); draw(); });
  m.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.speed) { st.speed = +b.dataset.speed; $$('[data-speed]', m).forEach(x => x.classList.toggle('on', x === b)); }
    if (b.dataset.tg) { st[b.dataset.tg] = !st[b.dataset.tg]; b.classList.toggle('on', st[b.dataset.tg]); }
    if (b.hasAttribute('data-play')) AUD.playBuf(await render());
  });
  const close = () => { m.classList.add('out'); setTimeout(() => m.remove(), 250); };
  $('[data-x]', m).onclick = close;
  $('.ed-ok', m).onclick = async () => { const out = await render(); close(); onDone(wavURL(out), +out.duration.toFixed(1)); };
  draw();
}
function wavURL(buf) { // 16비트 모노 WAV → data URL (스킬과 함께 저장)
  const d = buf.getChannelData(0), n = d.length, sr = buf.sampleRate, ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab);
  const ws = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, d[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  const u8 = new Uint8Array(ab); let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return 'data:audio/wav;base64,' + btoa(bin);
}
