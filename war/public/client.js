/* 픽셀 월드 워 — 브라우저 클라이언트 (렌더링 · 입력 · UI · 접속) */
(() => {
  'use strict';
  const { UNITS, SEA, NUKE, FX_BOOM, FX_MISSILE, FX_NUKE } = WarSim;
  const $ = (s) => document.querySelector(s);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = $('#cv'), ctx = cv.getContext('2d');
  const mapCv = document.createElement('canvas'), mctx = mapCv.getContext('2d');

  let W = 0, H = 0, C = [], owner = null, img = null, px32 = null;
  let col = null, dark = null;
  let my = 0, stats = null, myWars = new Set(), warKey = '';
  let mapReady = false, queue = [], conn = null;
  let dirty = null;
  const units = new Map();
  let snapT = 0, snapGen = 0;
  const fxs = [];
  const sel = new Set();
  const cam = { x: 0, y: 0, s: 1 };
  let mode = null; // null | 'select' | 유닛 번호
  let qty = 1, ratio = 0.4, infoId = -1, lastClick = null, mouse = null, box = null;
  let flash = 0;

  const pack = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  const SEA_C = [pack(22, 38, 74), pack(24, 41, 79), pack(21, 36, 71)];
  const MY_BORDER = pack(255, 255, 255), WAR_BORDER = pack(255, 40, 40);
  const flag = (iso) => (/^[A-Z]{2}$/.test(iso || '') ? String.fromCodePoint(...[...iso].map((ch) => 127397 + ch.charCodeAt(0))) : '🏳️');
  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)));
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => '&#' + ch.charCodeAt(0) + ';');
  const st = (id) => (stats && stats.c[id]) || null;
  const alive = (id) => id > 0 && Array.isArray(st(id));
  const cname = (id) => (C[id] ? C[id].name : '?');

  // ───────── 지도 픽셀 ─────────
  function paint(i) {
    const o = owner[i];
    if (o === SEA) {
      const x = i % W, y = (i / W) | 0;
      px32[i] = SEA_C[((x * 7) ^ (y * 13) ^ (x * y)) % 3];
      return;
    }
    const x = i % W;
    const l = owner[x > 0 ? i - 1 : i + W - 1], r = owner[x < W - 1 ? i + 1 : i - W + 1];
    const u = i >= W ? owner[i - W] : SEA, d = i + W < owner.length ? owner[i + W] : SEA;
    const border = (l !== o && l !== SEA) || (r !== o && r !== SEA) || (u !== o && u !== SEA) || (d !== o && d !== SEA);
    px32[i] = border ? (o === my && my ? MY_BORDER : myWars.has(o) ? WAR_BORDER : dark[o]) : col[o];
  }
  function markDirty(x0, y0, x1, y1) {
    if (!dirty) dirty = [x0, y0, x1, y1];
    else {
      if (x0 < dirty[0]) dirty[0] = x0;
      if (y0 < dirty[1]) dirty[1] = y0;
      if (x1 > dirty[2]) dirty[2] = x1;
      if (y1 > dirty[3]) dirty[3] = y1;
    }
  }
  function setPix(i, o) {
    owner[i] = o;
    const x = i % W, y = (i / W) | 0;
    paint(i);
    paint(x > 0 ? i - 1 : i + W - 1);
    paint(x < W - 1 ? i + 1 : i - W + 1);
    if (y > 0) paint(i - W);
    if (y < H - 1) paint(i + W);
    if (x === 0 || x === W - 1) markDirty(0, Math.max(0, y - 1), W - 1, Math.min(H - 1, y + 1));
    else markDirty(x - 1, Math.max(0, y - 1), x + 1, Math.min(H - 1, y + 1));
  }
  function repaintAll() {
    if (!owner) return;
    for (let i = 0; i < owner.length; i++) paint(i);
    markDirty(0, 0, W - 1, H - 1);
  }

  // ───────── 유닛 스프라이트 (7x7 픽셀 아트) ─────────
  const SPR = [
    ['..XXX..', '.XoooX.', '..XwX..', '.XoooX.', '..XoX..', '.XoXoX.', '.XX.XX.'],
    ['.......', '...XXXX', '.XXoX..', 'XoooooX', 'XXXXXXX', 'XwXwXwX', '.XXXXX.'],
    ['......X', '.....XX', '...XoX.', '..XooX.', '.XoooX.', 'XXXXXXX', '.XwXwX.'],
    ['X.....X', '.X...X.', '..XoX..', '.XoooX.', 'XoooooX', 'XXXXXXX', '.XwXwX.'],
    ['...X...', '..XoX..', '..XwX..', '.XoooX.', 'XoooooX', '..XoX..', '.XoXoX.'],
    ['...X...', '..XoX..', 'XXXoXXX', 'XoooooX', 'XXXoXXX', '..XoX..', '.XXXXX.'],
    ['.......', '...X...', '..XoX..', '.XXoXXX', 'XoooooX', '.XwwwX.', '..XXX..'],
    ['...X...', '..XwX..', '..XoX..', '..XoX..', '..XoX..', '.XoXoX.', '.X...X.'],
    ['...X...', '..XyX..', '..XyX..', '..XoX..', '..XoX..', '.XyXyX.', '.X...X.'],
  ];
  const sprites = new Map();
  function sprite(t, o) {
    const key = t * 65536 + o + (o === my ? 1 << 30 : 0);
    let c = sprites.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 7;
    const g = c.getContext('2d');
    const oc = C[o] ? C[o].color : [200, 200, 200];
    const pal = { X: o === my ? '#fff' : '#0b0b12', o: `rgb(${oc})`, w: '#e8f0ff', y: '#ffd400' };
    SPR[t].forEach((row, y) => [...row].forEach((ch, x) => {
      if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1); }
    }));
    sprites.set(key, c);
    return c;
  }

  // ───────── 카메라 ─────────
  const sx = (wx) => cv.width / 2 + (wx - cam.x) * cam.s;
  const sy = (wy) => cv.height / 2 + (wy - cam.y) * cam.s;
  const wx = (px) => cam.x + (px - cv.width / 2) / cam.s;
  const wy = (py) => cam.y + (py - cv.height / 2) / cam.s;
  const wrap = (x) => ((x % W) + W) % W;
  const wdx = (dx) => (dx > W / 2 ? dx - W : dx < -W / 2 ? dx + W : dx);
  const minS = () => Math.min(cv.width / W, cv.height / H) * 0.9;
  function clampCam() {
    cam.s = Math.max(minS(), Math.min(60 * dpr, cam.s));
    cam.x = wrap(cam.x);
    cam.y = Math.max(0, Math.min(H, cam.y));
  }
  function zoomAt(px, py, f) {
    const ax = wx(px), ay = wy(py);
    cam.s *= f;
    clampCam();
    cam.x = ax - (px - cv.width / 2) / cam.s;
    cam.y = ay - (py - cv.height / 2) / cam.s;
    clampCam();
  }
  function focus(id, zoom) {
    const s = st(id), c = C[id];
    if (!c) return;
    cam.x = (s && s[7] != null ? s[7] : c.lx) + 0.5;
    cam.y = (s && s[8] != null ? s[8] : c.ly) + 0.5;
    if (zoom) {
      const px = s ? s[0] : c.px;
      cam.s = (Math.min(cv.width, cv.height) * 0.35) / Math.max(6, Math.sqrt(px) * 1.6);
    }
    clampCam();
  }
  function cellAt(x, y) {
    const cy = Math.floor(y);
    if (cy < 0 || cy >= H || !owner) return -1;
    return cy * W + Math.floor(wrap(x));
  }

  // ───────── 렌더링 ─────────
  function resize() {
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
      if (W) clampCam();
    }
  }
  function unitPos(u, now) {
    const a = Math.min(1, (now - snapT) / 200);
    return [wrap(u.fx + wdx(u.x - u.fx) * a), u.fy + (u.y - u.fy) * a];
  }
  const keys = new Set();
  let lastFrame = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    resize();
    ctx.fillStyle = '#0b1530';
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (!mapReady) return;
    // 키보드 이동
    const pan = (700 * dt) / cam.s;
    if (keys.has('a') || keys.has('arrowleft')) cam.x -= pan;
    if (keys.has('d') || keys.has('arrowright')) cam.x += pan;
    if (keys.has('w') || keys.has('arrowup')) cam.y -= pan;
    if (keys.has('s') || keys.has('arrowdown')) cam.y += pan;
    clampCam();
    if (dirty) {
      mctx.putImageData(img, 0, 0, dirty[0], dirty[1], dirty[2] - dirty[0] + 1, dirty[3] - dirty[1] + 1);
      dirty = null;
    }
    ctx.imageSmoothingEnabled = false;
    const vx0 = wx(0), vx1 = wx(cv.width), vy0 = Math.max(0, Math.floor(wy(0))), vy1 = Math.min(H, Math.ceil(wy(cv.height)));
    for (let k = Math.floor(vx0 / W); k <= Math.floor(vx1 / W); k++) {
      const a = Math.max(0, Math.floor(vx0 - k * W)), b = Math.min(W, Math.ceil(vx1 - k * W));
      if (b <= a || vy1 <= vy0) continue;
      ctx.drawImage(mapCv, a, vy0, b - a, vy1 - vy0, sx(k * W + a), sy(vy0), (b - a) * cam.s, (vy1 - vy0) * cam.s);
    }
    const copies = (x) => {
      const d = wdx(x - cam.x), half = cv.width / 2 / cam.s + 4, out = [];
      for (let k = -1; k <= 1; k++) if (Math.abs(d + k * W) < half) out.push(cv.width / 2 + (d + k * W) * cam.s);
      return out;
    };
    drawLabels(copies);
    drawUnits(now, copies);
    drawFx(now, copies);
    if (box) {
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = dpr;
      ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
      ctx.setLineDash([]);
    }
    // 소환 미리보기
    if (typeof mode === 'number' && mouse) {
      const g = sprite(mode, my || 1), ps = Math.max(2, Math.round(cam.s * 0.4)) * 7;
      ctx.globalAlpha = 0.7;
      ctx.drawImage(g, mouse.x - ps / 2, mouse.y - ps / 2, ps, ps);
      ctx.globalAlpha = 1;
      if (UNITS[mode].dom === 'M') {
        ctx.strokeStyle = mode === NUKE ? '#ffd400' : '#ff6b3d';
        ctx.lineWidth = dpr;
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, UNITS[mode].blast * cam.s, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,250,220,${Math.min(0.85, flash)})`;
      ctx.fillRect(0, 0, cv.width, cv.height);
      flash -= dt * 1.5;
    }
  }
  function drawLabels(copies) {
    if (!stats) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let id = 1; id < C.length; id++) {
      const s = stats.c[id];
      if (!Array.isArray(s)) continue;
      let fs = Math.sqrt(s[0]) * cam.s * 0.11;
      if (fs < 9 * dpr) { if (cam.s < 9 * dpr) continue; fs = 9 * dpr; }
      fs = Math.min(fs, 20 * dpr);
      const y = sy(s[8] + 0.5);
      if (y < -20 || y > cv.height + 20) continue;
      ctx.font = `${Math.round(fs)}px Galmuri11, sans-serif`;
      ctx.lineWidth = Math.max(2, fs / 4);
      const label = (s[5] ? '🎮' : '') + C[id].name;
      for (const x of copies(s[7] + 0.5)) {
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        ctx.strokeText(label, x, y - fs * 0.8);
        ctx.fillStyle = id === my ? '#ffd34d' : myWars.has(id) ? '#ff8080' : '#fff';
        ctx.fillText(label, x, y - fs * 0.8);
        if (cam.s > 3 * dpr) ctx.fillText('★', x, y);
      }
    }
  }
  function drawUnits(now, copies) {
    const ps = Math.max(1, Math.min(5 * dpr, Math.round(cam.s * 0.4))), size = ps * 7;
    for (const u of units.values()) {
      const [x, y] = unitPos(u, now);
      const py = sy(y);
      if (py < -size || py > cv.height + size) continue;
      const g = sprite(u.t, u.o);
      for (const px of copies(x)) {
        ctx.drawImage(g, Math.round(px - size / 2), Math.round(py - size / 2), size, size);
        if (sel.has(u.id)) {
          ctx.strokeStyle = '#ffd34d';
          ctx.lineWidth = dpr;
          ctx.strokeRect(px - size / 2 - 2, py - size / 2 - 2, size + 4, size + 4);
        }
        if (u.hp < 250 && size >= 14) {
          ctx.fillStyle = '#000';
          ctx.fillRect(px - size / 2, py - size / 2 - 4 * dpr, size, 2 * dpr);
          ctx.fillStyle = u.hp > 120 ? '#4dd77a' : '#ff4d4d';
          ctx.fillRect(px - size / 2, py - size / 2 - 4 * dpr, (size * u.hp) / 255, 2 * dpr);
        }
      }
    }
  }
  const SHOT = ['#fff2a8', '#ffb347', '#ff7b39', '#9ff3ff', '#fffaa0', '#ffe14d', '#ffd9a0'];
  function drawFx(now, copies) {
    for (let k = fxs.length - 1; k >= 0; k--) {
      const f = fxs[k], age = now - f.t0;
      const life = f.k < FX_BOOM ? 160 : f.k === FX_BOOM ? 450 : f.k === FX_MISSILE ? 800 : 3500;
      if (age > life) { fxs.splice(k, 1); continue; }
      const a = age / life;
      for (const x of copies(f.x1)) {
        const y = sy(f.y1);
        if (f.k < FX_BOOM) {
          ctx.strokeStyle = SHOT[f.k - 1] || '#fff';
          ctx.globalAlpha = 1 - a;
          ctx.lineWidth = Math.max(1, cam.s * 0.15);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + wdx(f.x2 - f.x1) * cam.s, sy(f.y2));
          ctx.stroke();
        } else {
          const r = Math.max(2 * dpr, f.x2 * cam.s * (0.4 + a * 0.8));
          ctx.globalAlpha = 1 - a;
          if (f.k === FX_NUKE) {
            ctx.fillStyle = a < 0.15 ? '#ffffff' : '#ff9a2e';
            ctx.beginPath();
            ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff3b0';
            ctx.lineWidth = 3 * dpr;
            ctx.beginPath();
            ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            ctx.fillStyle = f.k === FX_MISSILE ? '#ff5a1f' : '#ffb02e';
            const q = Math.round(r);
            ctx.fillRect(x - q, y - q, q * 2, q * 2);
            ctx.fillStyle = '#fff6c8';
            ctx.fillRect(x - q / 2, y - q / 2, q, q);
          }
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  // ───────── 네트워크 메시지 ─────────
  async function gunzip(bytes) {
    const ds = new DecompressionStream('gzip');
    const ab = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint16Array(ab);
  }
  function onMeta(m) {
    W = m.w;
    H = m.h;
    C = m.countries;
    col = new Uint32Array(C.length);
    dark = new Uint32Array(C.length);
    C.forEach((c, i) => {
      const [r, g, b] = c.color;
      col[i] = pack(r, g, b);
      dark[i] = pack(r * 0.62, g * 0.62, b * 0.62);
    });
    mapCv.width = W;
    mapCv.height = H;
    img = mctx.createImageData(W, H);
    px32 = new Uint32Array(img.data.buffer);
    resize();
    cam.x = W / 2;
    cam.y = H * 0.45;
    cam.s = cv.width / W;
    clampCam();
    buildCountryList();
  }
  function onMap(grid) {
    owner = grid;
    repaintAll();
    mapReady = true;
    for (const b of queue) onTick(b);
    queue = [];
  }
  function onBinary(buf) {
    const kind = new Uint8Array(buf, 0, 1)[0];
    if (kind === 1) {
      mapReady = false;
      gunzip(new Uint8Array(buf, 1)).then(onMap);
    } else if (kind === 2) {
      if (mapReady) onTick(buf);
      else queue.push(buf);
    }
  }
  function onTick(buf) {
    const dv = new DataView(buf), now = performance.now();
    let o = 1;
    const flags = dv.getUint8(o++), np = dv.getUint32(o, true);
    o += 4;
    for (let k = 0; k < np; k++, o += 6) setPix(dv.getUint32(o, true), dv.getUint16(o + 4, true));
    const nf = dv.getUint16(o, true);
    o += 2;
    for (let k = 0; k < nf; k++, o += 9) {
      const f = { k: dv.getUint8(o), x1: dv.getUint16(o + 1, true) / 20, y1: dv.getUint16(o + 3, true) / 20, x2: dv.getUint16(o + 5, true) / 20, y2: dv.getUint16(o + 7, true) / 20, t0: now };
      if (f.k === FX_NUKE) {
        const d = Math.abs(wdx(f.x1 - cam.x)) * cam.s;
        if (d < cv.width) flash = 1;
      }
      if (fxs.length < 1500) fxs.push(f);
    }
    if (!(flags & 1)) return;
    const nu = dv.getUint32(o, true);
    o += 4;
    const gen = ++snapGen;
    for (let k = 0; k < nu; k++, o += 12) {
      const id = dv.getUint32(o, true), x = dv.getUint16(o + 7, true) / 20, y = dv.getUint16(o + 9, true) / 20;
      let u = units.get(id);
      if (u) {
        const [cx, cy] = unitPos(u, now);
        u.fx = cx;
        u.fy = cy;
        u.x = x;
        u.y = y;
        if (Math.abs(wdx(x - cx)) > 30) { u.fx = x; u.fy = y; }
      } else {
        u = { id, t: dv.getUint8(o + 4), o: dv.getUint16(o + 5, true), x, y, fx: x, fy: y };
        units.set(id, u);
      }
      u.hp = dv.getUint8(o + 11);
      u.gen = gen;
    }
    for (const u of units.values()) if (u.gen !== gen) { units.delete(u.id); sel.delete(u.id); }
    snapT = now;
    if (sel.size) updateSelInfo();
  }
  function onJson(m) {
    switch (m.t) {
      case 'meta': return onMeta(m);
      case 'stats': return onStats(m);
      case 'you': return onYou(m.id);
      case 'ev': return news(m.m, m.k);
      case 'err': return toast(m.m, 'err');
      case 'info': return toast(m.m);
      case 'dead':
        toast('💀 우리나라가 멸망했습니다… 새 나라를 선택하세요', 'err', 6000);
        return onYou(0);
      case 'peaceOffer': return peaceToast(m.from);
    }
  }
  function send(m) {
    if (conn) conn.send(m);
  }

  function connect() {
    if (window.WAR_EMBED || location.protocol === 'file:') return startLocal();
    let opened = false;
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      opened = true;
      conn = { send: (m) => ws.readyState === 1 && ws.send(JSON.stringify(m)) };
      $('#netMode').textContent = '🌐 온라인 멀티플레이 서버 접속됨';
    };
    ws.onmessage = (e) => (typeof e.data === 'string' ? onJson(JSON.parse(e.data)) : onBinary(e.data));
    ws.onclose = () => {
      if (!opened) startLocal();
      else toast('서버 연결이 끊어졌습니다. 새로고침 해주세요', 'err', 1e9);
    };
  }
  // 서버 없이 브라우저 안에서 시뮬레이션을 돌리는 싱글플레이 모드
  async function startLocal() {
    $('#netMode').textContent = '🤖 싱글플레이 (서버 없음 · AI 국가들과 대전)';
    let meta, gz;
    try {
      if (window.WAR_EMBED) {
        meta = window.WAR_EMBED.meta;
        gz = Uint8Array.from(atob(window.WAR_EMBED.map), (ch) => ch.charCodeAt(0));
      } else {
        let base = 'data/';
        let r = await fetch(base + 'countries.json').catch(() => null);
        if (!r || !r.ok) { base = '../data/'; r = await fetch(base + 'countries.json'); }
        meta = await r.json();
        gz = new Uint8Array(await (await fetch(base + 'map.bin.gz')).arrayBuffer());
      }
    } catch (e) {
      $('#netMode').textContent = '❌ 지도 데이터를 불러오지 못했습니다. 웹서버(npm start)로 열어주세요';
      return;
    }
    const grid = await gunzip(gz);
    const game = new WarSim.Game(meta, grid.slice());
    game.addPlayer('local');
    conn = { send: (m) => game.command('local', m) };
    onMeta(meta);
    onMap(grid);
    onJson(game.stats());
    setInterval(() => {
      game.step();
      onTick(game.encodeTick(game.tick % 2 === 0));
      for (const { to, msg } of game.drainOut()) if (!to || to === 'local') onJson(msg);
      if (game.tick % 10 === 0) onJson(game.stats());
    }, 100);
  }

  // ───────── UI ─────────
  function onYou(id) {
    my = id;
    sel.clear();
    sprites.clear();
    mode = null;
    $('#start').classList.toggle('hidden', !!id);
    $('#top').classList.toggle('hidden', !id);
    $('#build').classList.toggle('hidden', !id);
    myWars = new Set();
    warKey = '';
    repaintAll();
    if (id) {
      focus(id, true);
      toast(`${flag(C[id].iso)} ${C[id].name} 지휘 시작! 나라를 클릭해 선전포고하세요`);
      showInfo(-1);
    } else buildCountryList();
    updateMode();
  }
  function onStats(m) {
    stats = m;
    const me = st(my);
    if (my && me) {
      const wars = me[6].slice().sort((a, b) => a - b), key = wars.join(',');
      if (key !== warKey) {
        warKey = key;
        myWars = new Set(wars);
        repaintAll();
      }
      $('#meName').innerHTML = `${flag(C[my].iso)} ${esc(C[my].name)}`;
      $('#money').textContent = fmt(me[1]);
      $('#income').textContent = `+${me[4]}/s`;
      $('#troops').textContent = fmt(me[2]);
      $('#cap').textContent = `/${fmt(me[3])}`;
      $('#land').textContent = fmt(me[0]);
      $('#unitCount').textContent = me[10];
      document.querySelectorAll('#unitBtns button').forEach((b, t) => {
        b.disabled = me[1] < UNITS[t].cost;
        if (t === NUKE) b.querySelector('.c').textContent = me[9] > 0 ? `⏳${me[9]}s` : fmt(UNITS[t].cost);
      });
    }
    renderSide();
    if (infoId >= 0) showInfo(infoId, true);
    if (!$('#start').classList.contains('hidden') && !$('#clist').matches(':hover')) buildCountryList();
  }
  function renderSide() {
    const order = [];
    for (let id = 1; id < C.length; id++) if (alive(id)) order.push(id);
    order.sort((a, b) => stats.c[b][0] - stats.c[a][0]);
    const rank = order.indexOf(my) + 1;
    if (my) $('#rankNo').textContent = rank ? `${rank}/${order.length}` : '-';
    if ($('#side').matches(':hover')) return;
    const top = order.slice(0, 10);
    if (my && rank > 10) top.push(my);
    $('#rank').innerHTML = top.map((id) => `<li data-id="${id}" value="${order.indexOf(id) + 1}" class="${id === my ? 'me' : ''}">${flag(C[id].iso)} ${esc(C[id].name)} <small>${fmt(stats.c[id][0])}${stats.c[id][5] ? ' 🎮' : ''}</small></li>`).join('');
    const box = $('#warsBox');
    box.classList.toggle('hidden', !myWars.size);
    $('#wars').innerHTML = [...myWars].filter(alive).map((id) => `<div><span data-id="${id}">⚔️ ${esc(C[id].name)} <small>${fmt(stats.c[id][0])}</small></span><button data-act="attack" data-id="${id}" title="공격">🔥</button><button data-act="peace" data-id="${id}" title="평화 제안">🕊️</button></div>`).join('');
  }
  let infoActs = null;
  function showInfo(id, refresh) {
    if (!refresh || id !== infoId) infoActs = null;
    infoId = id;
    const el = $('#info');
    if (id < 0 || !C[id]) return el.classList.add('hidden');
    el.classList.remove('hidden');
    if (!$('#infoBody')) el.innerHTML = '<div id="infoBody"></div><div class="acts" id="infoActs"></div>';
    const [body, acts] = infoHtml(id);
    $('#infoBody').innerHTML = body;
    // 버튼은 내용이 바뀔 때만 다시 그린다 (매초 갱신 중 클릭이 씹히지 않게)
    if (acts !== infoActs) {
      $('#infoActs').innerHTML = acts;
      infoActs = acts;
      if ($('#ratio')) $('#ratio').value = Math.round(ratio * 100);
      updRatio();
    }
  }
  function infoHtml(id) {
    const s = st(id), c = C[id];
    if (id === 0) {
      return [`<h3>🏳️ 무주지</h3><small>남극 등 주인 없는 땅 · 누구나 점령 가능</small>
        <div class="grid"><span>영토</span><span>${fmt(s ? s[0] : 0)} 픽셀</span></div>`,
        my ? `${slider()}<button class="red" data-act="attack" data-id="0">🔥 점령 작전 (<b class="rv"></b> 병력)</button>` : ''];
    }
    if (!Array.isArray(s)) return [`<h3>${flag(c.iso)} ${esc(c.name)}</h3><p>💀 멸망한 나라입니다</p>`, ''];
    const atWar = myWars.has(id), isMe = id === my;
    const ctrl = s[5] ? `🎮 ${esc(s[5])}` : '🤖 AI';
    const wars = s[6].filter(alive).map((e) => `<span class="tag war">${esc(C[e].name)}</span>`).join('') || '<small>없음</small>';
    let acts = '';
    if (!my) {
      acts = s[5] ? '<small>다른 플레이어가 지휘 중</small>' : `<button class="green" data-act="join" data-id="${id}">🎮 이 나라로 플레이</button>`;
    } else if (!isMe) {
      acts = atWar
        ? `${slider()}<button class="red" data-act="attack" data-id="${id}">🔥 공격! 땅 뺏기 (<b class="rv"></b> 병력)</button>
           <button data-act="peace" data-id="${id}">🕊️ 평화 제안</button>`
        : `<button class="red" data-act="declare" data-id="${id}">⚔️ 선전포고</button>`;
    }
    return [`<h3>${flag(c.iso)} ${esc(c.name)}</h3><small>${esc(c.en)} · ${ctrl}${isMe ? ' · 우리나라' : atWar ? ' · <b style="color:var(--red)">전쟁 중</b>' : ''}</small>
      <div class="grid">
        <span>영토</span><span>${fmt(s[0])} 픽셀</span>
        <span>병력</span><span>${fmt(s[2])} / ${fmt(s[3])}</span>
        <span>자금</span><span>${fmt(s[1])} (+${s[4]}/s)</span>
        <span>유닛</span><span>${s[10]}</span>
        <span>전쟁</span><span>${wars}</span>
      </div>`, acts];
  }
  const slider = () => '<label>투입 병력 <b class="rv"></b><input type="range" id="ratio" min="10" max="100" step="10"></label>';
  const updRatio = () => document.querySelectorAll('.rv').forEach((b) => (b.textContent = Math.round(ratio * 100) + '%'));
  function act(a, id) {
    if (a === 'join') return send({ t: 'join', id, name: $('#pname').value.trim() || '플레이어' });
    if (a === 'declare') return send({ t: 'declare', id });
    if (a === 'peace') return send({ t: 'peace', id });
    if (a === 'attack') {
      const p = lastClick && lastClick.id === id ? lastClick : {};
      send({ t: 'attack', id, r: ratio, x: p.x, y: p.y });
    }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) return act(b.dataset.act, +b.dataset.id);
    const li = e.target.closest('#rank li, #wars span');
    if (li) {
      focus(+li.dataset.id, true);
      showInfo(+li.dataset.id);
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'ratio') return;
    ratio = e.target.value / 100;
    updRatio();
  });

  function news(m, k) {
    const d = document.createElement('div');
    d.textContent = m;
    d.className = k || '';
    const box = $('#news');
    box.prepend(d);
    while (box.children.length > 7) box.lastChild.remove();
    setTimeout(() => (d.style.opacity = '0'), 12000);
    setTimeout(() => d.remove(), 13000);
    if (my && (m.includes(C[my].name) || k === 'nuke')) toast(m, k === 'war' || k === 'dead' ? 'err' : '', 4000);
  }
  function toast(m, cls, ms = 2800) {
    const d = document.createElement('div');
    d.textContent = m;
    d.className = cls || '';
    $('#toasts').append(d);
    while ($('#toasts').children.length > 4) $('#toasts').firstChild.remove();
    setTimeout(() => d.remove(), ms);
    return d;
  }
  function peaceToast(from) {
    const d = toast(`🕊️ ${WarSim.josa(C[from].name, '이', '가')} 평화를 제안했습니다`, '', 20000);
    const yes = document.createElement('button');
    yes.textContent = '수락';
    yes.className = 'green';
    yes.onclick = () => { send({ t: 'acceptPeace', id: from }); d.remove(); };
    const no = document.createElement('button');
    no.textContent = '거절';
    no.onclick = () => d.remove();
    d.append(yes, no);
  }

  function buildUnitButtons() {
    $('#unitBtns').innerHTML = UNITS.map((u, t) => `<button data-u="${t}" title="${u.name}"><span>${u.icon} ${u.name} <span class="k">[${t + 1}]</span></span><span class="c">${fmt(u.cost)}</span></button>`).join('');
    document.querySelectorAll('#unitBtns button').forEach((b) => (b.onclick = () => setMode(mode === +b.dataset.u ? null : +b.dataset.u)));
    document.querySelectorAll('.q').forEach((b) => (b.onclick = () => {
      qty = +b.dataset.q;
      document.querySelectorAll('.q').forEach((x) => x.classList.toggle('on', x === b));
    }));
    $('#mSelect').onclick = () => setMode(mode === 'select' ? null : 'select');
    $('#mAll').onclick = selectAll;
    $('#mNone').onclick = () => { sel.clear(); setMode(null); updateSelInfo(); };
    $('#btnHome').onclick = () => my && focus(my, true);
    $('#btnChange').onclick = () => { send({ t: 'leave' }); };
    $('#btnWatch').onclick = () => $('#start').classList.add('hidden');
    $('#btnHelp').onclick = () => $('#help').classList.toggle('hidden');
    $('#help').onclick = () => $('#help').classList.add('hidden');
    $('#search').oninput = buildCountryList;
    try { $('#pname').value = localStorage.getItem('pww-name') || ''; } catch (e) { /* 저장소 사용 불가 */ }
    $('#pname').onchange = () => { try { localStorage.setItem('pww-name', $('#pname').value); } catch (e) { /* 무시 */ } };
  }
  function setMode(m) {
    mode = m;
    updateMode();
  }
  function updateMode() {
    document.querySelectorAll('#unitBtns button').forEach((b) => b.classList.toggle('on', +b.dataset.u === mode));
    $('#mSelect').classList.toggle('on', mode === 'select');
    cv.classList.toggle('spawn', mode !== null);
    const m = $('#mode');
    if (typeof mode === 'number') {
      const u = UNITS[mode];
      m.textContent = u.dom === 'M' ? `${u.icon} ${u.name}: 목표 지점을 클릭하세요 (Esc 취소)` : `${u.icon} ${u.name} ×${qty}: ${u.dom === 'S' ? '우리 해안 근처 바다' : '우리 땅'}을 클릭해 소환 (Esc 취소)`;
    } else if (mode === 'select') m.textContent = '⬚ 선택 모드: 드래그로 유닛 선택 → 클릭한 곳으로 이동';
    else m.textContent = sel.size ? '우클릭(또는 선택 모드에서 클릭)으로 이동 명령' : '';
  }
  function selectAll() {
    sel.clear();
    for (const u of units.values()) if (u.o === my && UNITS[u.t].dom !== 'M') sel.add(u.id);
    updateSelInfo();
  }
  function updateSelInfo() {
    const cnt = {};
    for (const id of sel) {
      const u = units.get(id);
      if (u) cnt[u.t] = (cnt[u.t] || 0) + 1;
    }
    $('#selInfo').textContent = sel.size ? '선택: ' + Object.entries(cnt).map(([t, n]) => `${UNITS[t].icon}${n}`).join(' ') : '';
    updateMode();
  }
  function buildCountryList() {
    if (!C.length) return;
    const q = $('#search').value.trim().toLowerCase();
    const list = C.filter((c) => c.id && (!stats || alive(c.id)) && (!q || c.name.toLowerCase().includes(q) || c.en.toLowerCase().includes(q)));
    list.sort((a, b) => (st(b.id) ? st(b.id)[0] : b.px) - (st(a.id) ? st(a.id)[0] : a.px));
    $('#clist').innerHTML = list.map((c) => {
      const s = st(c.id), taken = s && s[5];
      return `<div data-pick="${c.id}" class="${taken ? 'taken' : ''}"><span class="sw" style="background:rgb(${c.color})"></span><span class="n">${flag(c.iso)} ${esc(c.name)} <small>${esc(c.en)}</small></span><span class="p">${taken ? '🎮 ' + esc(s[5]) + ' · ' : ''}${fmt(s ? s[0] : c.px)}px</span></div>`;
    }).join('');
  }
  $('#clist').addEventListener('click', (e) => {
    const d = e.target.closest('[data-pick]');
    if (d) act('join', +d.dataset.pick);
  });

  // ───────── 입력 ─────────
  const pointers = new Map();
  let drag = null, pinch = null;
  const P = (e) => ({ x: e.clientX * dpr, y: e.clientY * dpr });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, P(e));
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      drag = null;
      box = null;
    } else if (pointers.size === 1) {
      const p = P(e);
      drag = { x: p.x, y: p.y, cx: cam.x, cy: cam.y, moved: false, btn: e.button, box: mode === 'select' && e.button === 0 || (e.shiftKey && e.button === 0) };
    }
  });
  cv.addEventListener('pointermove', (e) => {
    const p = P(e);
    mouse = p;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my2 = (a.y + b.y) / 2;
      cam.x -= (mx - pinch.mx) / cam.s;
      cam.y -= (my2 - pinch.my) / cam.s;
      zoomAt(mx, my2, d / pinch.d);
      pinch = { d, mx, my: my2 };
    } else if (drag) {
      if (!drag.moved && Math.hypot(p.x - drag.x, p.y - drag.y) > 6 * dpr) drag.moved = true;
      if (drag.moved) {
        if (drag.box) box = { x0: Math.min(drag.x, p.x), y0: Math.min(drag.y, p.y), x1: Math.max(drag.x, p.x), y1: Math.max(drag.y, p.y) };
        else {
          cam.x = drag.cx - (p.x - drag.x) / cam.s;
          cam.y = drag.cy - (p.y - drag.y) / cam.s;
          clampCam();
        }
      }
    }
    hover(p, e);
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag) return;
    const p = P(e), d = drag;
    drag = null;
    if (d.box && box) {
      if (!e.shiftKey) sel.clear();
      const now = performance.now();
      for (const u of units.values()) {
        if (u.o !== my || UNITS[u.t].dom === 'M') continue;
        const [x, y] = unitPos(u, now), X = cv.width / 2 + wdx(x - cam.x) * cam.s, Y = sy(y);
        if (X >= box.x0 && X <= box.x1 && Y >= box.y0 && Y <= box.y1) sel.add(u.id);
      }
      box = null;
      updateSelInfo();
      return;
    }
    if (!d.moved && e.type === 'pointerup') click(p, d.btn);
  };
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('pointerleave', () => { mouse = null; $('#hover').style.display = 'none'; });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e.clientX * dpr, e.clientY * dpr, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  function click(p, btn) {
    if (!mapReady) return;
    const x = wrap(wx(p.x)), y = wy(p.y), i = cellAt(x, y);
    if (btn === 2) {
      if (sel.size) moveSel(x, y);
      return;
    }
    if (typeof mode === 'number') {
      if (!my) return toast('먼저 나라를 선택하세요', 'err');
      send({ t: 'spawn', u: mode, x, y, n: UNITS[mode].dom === 'M' ? 1 : qty });
      return;
    }
    if (mode === 'select' && sel.size) return moveSel(x, y);
    if (i < 0 || owner[i] === SEA) return showInfo(-1);
    lastClick = { id: owner[i], x, y };
    showInfo(owner[i]);
  }
  function moveSel(x, y) {
    send({ t: 'move', ids: [...sel], x, y });
    fxs.push({ k: FX_BOOM, x1: x, y1: y, x2: 0.6, y2: 0, t0: performance.now() });
  }
  function hover(p, e) {
    const el = $('#hover');
    if (!mapReady || e.pointerType === 'touch') return;
    const i = cellAt(wrap(wx(p.x)), wy(p.y));
    if (i < 0 || owner[i] === SEA) { el.style.display = 'none'; return; }
    const o = owner[i];
    el.style.display = 'block';
    el.style.left = p.x / dpr + 14 + 'px';
    el.style.top = p.y / dpr + 14 + 'px';
    el.textContent = o ? `${flag(C[o].iso)} ${C[o].name}${myWars.has(o) ? ' ⚔️' : ''}` : '🏳️ 무주지';
  }
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k >= '1' && k <= '9' && my) setMode(mode === +k - 1 ? null : +k - 1);
    else if (k === 'escape') { setMode(null); sel.clear(); updateSelInfo(); showInfo(-1); }
    else if (k === 'q' && my) setMode(mode === 'select' ? null : 'select');
    else if (k === 'e' && my) selectAll();
    else if (k === ' ' && my) { e.preventDefault(); focus(my, true); }
    else if (k === '+' || k === '=') zoomAt(cv.width / 2, cv.height / 2, 1.25);
    else if (k === '-') zoomAt(cv.width / 2, cv.height / 2, 0.8);
    else keys.add(k);
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());

  buildUnitButtons();
  connect();
  requestAnimationFrame(frame);
})();
