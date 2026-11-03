// 영상 찍기: 게임 화면을 캔버스에 매 프레임 다시 그려서(움직임·소리 포함) 동영상으로 녹화한다
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
}
const GameRecorder = (() => {
  const W = 720, TOP = 84, BAR = 64, H = TOP + BAR + W + BAR;
  const $ = (id) => document.getElementById(id);
  const MARK = {
    sel: 'rgba(255,255,51,0.5)', move: 'rgba(246,246,105,0.78)', take: 'rgba(246,246,105,0.78)',
    rec: 'rgba(38,198,218,0.62)', best: 'rgba(38,198,218,0.62)', check: 'rgba(225,60,45,0.7)',
  };
  // 캔버스용 기물 그림: 페이지 CSS 대신 SVG 안에 색을 직접 넣는다
  const STYLE = '<style>.o{stroke-width:4;stroke-linejoin:round}.w .o{fill:#707070;stroke:#707070}' +
    '.b .o{fill:#2a2928;stroke:#2a2928}.f{stroke:none}.w .f{fill:url(#gw)}.b .f{fill:url(#gb)}' +
    '.ln{fill:none;stroke-width:4;stroke-linecap:round}.ln.soft{stroke-width:2.5;opacity:.5}' +
    '.w .ln{stroke:#707070}.b .ln{stroke:#2a2928}.w .ey{fill:#4a4a4a}.b .ey{fill:#9a9895}</style>';
  const images = {};
  function pieceImage(kind) {
    if (images[kind]) return images[kind];
    const defs = document.querySelector('.defs defs').outerHTML;
    const svg = pieceSVG(kind[1], kind[0])
      .replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" ')
      .replace('aria-hidden="true">', 'aria-hidden="true">' + defs + STYLE);
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    images[kind] = img;
    return img;
  }
  const ready = (img) => img.complete && img.naturalWidth > 0;

  let canvas, ctx, rec = null, chunks = [], raf = 0;

  function text(str, x, y, font, color, align = 'left') {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }

  function drawBar(id, y) {
    const bar = $(id);
    if (bar.dataset.color) {
      const img = pieceImage(bar.dataset.color + 'k');
      if (ready(img)) ctx.drawImage(img, 18, y + 10, 44, 44);
    }
    const turn = bar.classList.contains('turn');
    text(bar.querySelector('.pbar-name').textContent, 74, y + BAR / 2, '900 26px "Noto Sans KR", sans-serif', turn ? '#ffffff' : '#bab8b5');
    const count = bar.querySelector('.pbar-count b').textContent;
    const label = bar.querySelector('.pbar-count small').textContent;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.roundRect(W - 190, y + 12, 172, 40, 20);
    ctx.fill();
    text(label, W - 172, y + BAR / 2, '700 18px "Noto Sans KR", sans-serif', '#bab8b5');
    text(count, W - 34, y + BAR / 2, '900 26px Orbitron, "Noto Sans KR", monospace', '#ffffff', 'right');
  }

  function overlay(bw, bh, title, sub) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, bw, bh);
    ctx.fillStyle = 'rgba(30,29,27,0.95)';
    ctx.beginPath();
    ctx.roundRect(bw * 0.18, bh * 0.38, bw * 0.64, bh * 0.24, 18);
    ctx.fill();
    text(title, bw / 2, bh * (sub ? 0.46 : 0.5), `400 ${bw * 0.075}px "Black Han Sans", "Noto Sans KR", sans-serif`, '#ffffff', 'center');
    if (sub) text(sub, bw / 2, bh * 0.54, `900 ${bw * 0.045}px "Noto Sans KR", sans-serif`, '#81b64c', 'center');
  }

  function frame() {
    const board = $('board'), b = board.getBoundingClientRect();
    if (b.width > 0) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#16201a');
      g.addColorStop(1, '#0f1311');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      text($('timer').textContent, 24, TOP / 2, '900 40px Orbitron, "Noto Sans KR", monospace', '#ffffff');
      text($('modeTag').textContent, W - 24, TOP / 2, '900 26px "Noto Sans KR", sans-serif', '#4aa6e2', 'right');
      drawBar('barTop', TOP);
      drawBar('barBottom', TOP + BAR + W);

      const k = W / b.width, sq = b.width / 8;
      ctx.save();
      ctx.translate(0, TOP + BAR);
      ctx.scale(k, k);
      ctx.beginPath();
      ctx.rect(0, 0, b.width, b.height);
      ctx.clip();
      // 칸과 좌표
      [...$('squares').children].forEach((el, i) => {
        const r = i >> 3, c = i & 7, light = el.classList.contains('l');
        ctx.fillStyle = light ? '#ebecd0' : '#779556';
        ctx.fillRect(c * sq, r * sq, sq + 0.5, sq + 0.5);
        const color = light ? '#779556' : '#ebecd0', font = `900 ${Math.max(10, sq * 0.2)}px "Noto Sans KR", sans-serif`;
        const rank = el.querySelector('.rank'), file = el.querySelector('.file');
        if (rank) text(rank.textContent, c * sq + sq * 0.06, r * sq + sq * 0.14, font, color);
        if (file) text(file.textContent, c * sq + sq * 0.94, r * sq + sq * 0.86, font, color, 'right');
      });
      // 칸 표시
      for (const el of $('marks').children) {
        const m = el.getBoundingClientRect();
        const cls = [...el.classList].reverse().find((x) => MARK[x]);
        if (!cls) continue;
        ctx.fillStyle = MARK[cls];
        ctx.fillRect(m.left - b.left, m.top - b.top, m.width, m.height);
      }
      // 기물: 움직이는 중인 위치·기울기·크기·투명도까지 그대로
      for (const el of $('pieces').children) {
        if (!el.dataset.kind || !el.body) continue;
        const img = pieceImage(el.dataset.kind);
        if (!ready(img)) continue;
        const p = el.getBoundingClientRect();
        const cs = getComputedStyle(el.body);
        const alpha = Number(cs.opacity) * Number(getComputedStyle(el).opacity);
        if (alpha <= 0.01) continue;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.left - b.left + p.width * 0.5, p.top - b.top + p.height * 0.84);
        const mt = cs.transform.match(/matrix\(([^)]+)\)/);
        if (mt) {
          const v = mt[1].split(',').map(Number);
          ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
        }
        ctx.drawImage(img, -p.width * 0.5, -p.height * 0.84, p.width, p.height);
        ctx.restore();
      }
      if (!$('ready').hidden) overlay(b.width, b.height, $('btnGo').textContent.trim(), '');
      if (!$('veil').hidden) overlay(b.width, b.height, $('veilTitle').textContent, $('veilText').textContent);
      ctx.restore();
    }
    raf = requestAnimationFrame(frame);
  }

  const supported = () => !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);

  function start() {
    if (rec || !supported()) return false;
    canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(30);
    const audio = Sound.stream();
    if (audio) audio.getAudioTracks().forEach((t) => stream.addTrack(t));
    // H.264 mp4 가 되면 그것(아이폰에서도 재생), 아니면 webm, 마지막으로 그냥 mp4
    const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    const type = types.find((t) => MediaRecorder.isTypeSupported(t));
    try {
      rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 5000000 } : undefined);
    } catch (e) {
      rec = null;
      return false;
    }
    chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    frame();
    rec.start(500);
    return true;
  }

  function stop() {
    return new Promise((resolve) => {
      if (!rec) { resolve(null); return; }
      const r = rec;
      rec = null;
      r.onstop = () => {
        cancelAnimationFrame(raf);
        const type = r.mimeType || 'video/webm';
        resolve(chunks.length ? { blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' } : null);
      };
      r.stop();
    });
  }

  return { start, stop, supported, isOn: () => !!rec };
})();
