'use strict';
/* 음성 읽기(Web Speech API) + 실시간 조음 동기화 + UI */
(() => {
  const $ = s => document.querySelector(s);
  const cl = (x, a, b) => x < a ? a : x > b ? b : x;
  const cv = $('#cv'), ctx = cv.getContext('2d'), gcv = $('#glot'), gctx = gcv.getContext('2d');
  const meters = [...document.querySelectorAll('.meter i')];
  let lastGs = '';
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  const NT = window.AndroidTTS || null; // 안드로이드 앱(APK)에서 주입하는 기기 음성 엔진
  const ntH = {}; let ntSeq = 0;
  window.__tts = (id, ev, a) => {
    const h = ntH[id]; if (!h) return;
    if (ev === 'start') h.start(); else if (ev === 'range') h.range(a);
    else { delete ntH[id]; ev === 'done' ? h.end() : h.err(); }
  };

  // 조음 상태(부드럽게 따라감) & 각 값의 반응 속도
  const S = { jaw: .03, lc: 1, lr: 0, ls: 0, ld: 0, tipA: 0, tipX: 289, tipY: 578, bodyX: 398, bodyY: 592, back: 0, vel: .9, voice: 0, fric: 0, glot: .8, cl: 0 };
  const SPD = { jaw: 16, lc: 34, lr: 12, ls: 12, ld: 30, tipA: 32, tipX: 30, tipY: 30, bodyX: 13, bodyY: 13, back: 30, vel: 14, voice: 40, fric: 40, glot: 30, cl: 40 };
  const IDLE = { jaw: .03, lc: 1, body: P.REST, vel: .9, glot: .8, rest: 1 };
  const PAUSE = P.PH._;
  // 모드별 목소리: g 선호 성별, pm/pf 남/여 목소리일 때 음높이, r 속도, f 노래 반주 기본음(Hz)
  const VP = {
    boy: { g: 'm', pm: 1.35, pf: 1.05, r: 1.05, f: 247 }, girl: { g: 'f', pm: 1.75, pf: 1.5, r: 1.05, f: 294 },
    man: { g: 'm', pm: .9, pf: .55, r: .97, f: 131 }, woman: { g: 'f', pm: 1.3, pf: 1.05, r: 1, f: 220 },
  };
  const opt = { labels: true, air: true, nerves: true, rate: 1, voice: '' };
  const calib = {};
  let mode = 'man', play = null, voices = [], lastF = null, AC = null, note = null, DPR = 1, force = null;

  // ---------- 목소리 ----------
  function gender(v) {
    const n = v.name;
    if (/female|woman|girl|여성|yuna|sunhi|seoyeon|heami|jimin|yujin|sora|zira|samantha|karen|victoria|susan|hazel|aria|jenny|ava|allison|kate|serena|moira|tessa|fiona|libby|sonia|michelle|emma|google 한국|google us english/i.test(n)) return 'f';
    if (/(?<!fe)male|\bman\b|boy|남성|injoon|hyunsu|bongjin|gookmin|david|mark|guy|daniel|alex|fred|george|james|ryan|christopher|eric|roger|aaron|arthur|thomas|oliver/i.test(n)) return 'm';
    return '?';
  }
  function voiceFor(lang) {
    const vp = VP[mode]; let v = null;
    if (opt.voice) v = voices.find(x => x.voiceURI === opt.voice) || null;
    if (!v) {
      const L = voices.filter(x => (x.lang || '').toLowerCase().replace('_', '-').startsWith(lang.slice(0, 2)));
      v = L.find(x => gender(x) === vp.g) || L.find(x => x.default) || L[0] || null;
    }
    const g = v ? gender(v) : '?';
    return { v, pitch: g === 'm' ? vp.pm : g === 'f' ? vp.pf : (vp.pm + vp.pf) / 2, rate: vp.r, key: v ? v.name : 'none' };
  }
  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices();
    const sel = $('#voice'), cur = sel.value;
    sel.innerHTML = '<option value="">자동 (모드에 맞게)</option>' + voices
      .filter(v => /^(ko|en)/i.test(v.lang)).concat(voices.filter(v => !/^(ko|en)/i.test(v.lang)))
      .map(v => `<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})</option>`).join('');
    sel.value = cur;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const langOf = t => /[가-힣ㄱ-ㆎ]/.test(t) ? 'ko-KR' : 'en-US';

  // ---------- 문장 나누기 ----------
  function chunks(text) {
    const parts = text.match(/[^.!?。\n]+[.!?。]*\n?|[.!?。\n]+/g) || [text], out = [];
    let buf = '';
    for (const s of parts) {
      if ((buf + s).length > 160 && buf) { out.push(buf); buf = ''; }
      buf += s; if (buf.length > 60) { out.push(buf); buf = ''; }
    }
    if (buf) out.push(buf);
    return out.flatMap(c => { const r = []; while (c.length > 200) { let k = c.lastIndexOf(' ', 200); if (k < 50) k = 200; r.push(c.slice(0, k)); c = c.slice(k); } r.push(c); return r; })
      .filter(c => /[\p{L}\p{N}]/u.test(c));
  }

  // ---------- 노래: 제목 글자마다 음표를 붙여 부르기 ----------
  function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; }
  function rng(a) { return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function song(title) {
    const lang = langOf(title), R = rng(hash(title)), SC = [0, 2, 4, 5, 7, 9, 12, 14];
    const re = lang === 'ko-KR' ? /[가-힣]|[a-zA-Z'’]+|\d|\s+|./g : /[a-zA-Z'’]+|\d+|\s+|./g;
    const syl = (title.match(re) || []).map(s => /^\s+$/.test(s) ? null : /[\p{L}\p{N}]/u.test(s) ? s : undefined).filter(s => s !== undefined);
    const n = syl.filter(Boolean).length, items = [];
    let idx = 2, c = 0;
    for (const s of syl) {
      if (!s) { if (items.length) items.push({ silent: 1, lang, units: 1, words: [], flat: [{ p: PAUSE, q: { k: '_', g: '' }, wi: -1, u0: 0, u1: 1 }], noteDur: .22 }); continue; }
      c++; idx = cl(idx + [-2, -1, -1, 0, 1, 1, 2][Math.floor(R() * 7)], 0, SC.length - 1);
      if (c === n) idx = R() < .5 ? 0 : 5;
      const it = P.build(s, lang, true);
      if (!it.flat.length) continue;
      Object.assign(it, { sing: 1, semi: SC[idx], noteDur: c === n ? .9 : .45, pitchMul: Math.pow(2, SC[idx] / 12) * .85, rateMul: c === n ? .6 : .8, label: s });
      items.push(it);
    }
    return items;
  }

  // ---------- 재생 ----------
  function audio() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* 소리 없음 */ } }
    if (AC && AC.state === 'suspended') AC.resume();
  }
  function playNote(f) {
    endNote(); if (!AC) return;
    const t = AC.currentTime, o = AC.createOscillator(), o2 = AC.createOscillator(), g = AC.createGain();
    o.type = 'triangle'; o.frequency.value = f; o2.type = 'sine'; o2.frequency.value = f / 2;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.07, t + .03); g.gain.exponentialRampToValueAtTime(.035, t + .4);
    o.connect(g); o2.connect(g); g.connect(AC.destination); o.start(t); o2.start(t); note = { o, o2, g };
  }
  function endNote() {
    if (!note || !AC) return;
    const t = AC.currentTime; note.g.gain.cancelScheduledValues(t); note.g.gain.setTargetAtTime(0, t, .06);
    note.o.stop(t + .4); note.o2.stop(t + .4); note = null;
  }

  function start(items, sing) {
    stop();
    if (!items.length) { msg('읽을 글자가 없어요.'); return; }
    audio(); if (synth && !voices.length) loadVoices();
    play = { items, i: -1, sing };
    document.body.classList.add('speaking');
    if (sing) $('#now').innerHTML = items.map((x, i) => x.silent ? ' ' : `<span data-i="${i}">${esc(x.label)}</span>`).join('');
    next();
  }
  function stop() {
    const was = play; play = null; lastF = null;
    if (NT) { if (was) NT.stop(); for (const k in ntH) delete ntH[k]; }
    else if (synth && (was || synth.speaking || synth.pending)) synth.cancel();
    if (was) was.items.forEach(it => clearTimeout(it.watch));
    endNote(); document.body.classList.remove('speaking');
    $('#phG').textContent = '·'; $('#phIpa').textContent = ''; $('#phCat').textContent = '대기 중'; $('#phDesc').textContent = '읽기를 누르면 실시간으로 분석해요';
  }
  function next() {
    const pl = play; if (!pl) return;
    endNote(); pl.i++;
    const it = pl.items[pl.i];
    if (!it) { stop(); return; }
    const vp = voiceFor(it.lang), rate = vp.rate * opt.rate * (it.rateMul || 1);
    it.key = vp.key; it.rate = rate;
    it.spu = it.sing || it.silent ? it.noteDur / it.units : (calib[vp.key] || .095) / rate;
    it.fi = 0; it.wi = -1;
    if (!pl.sing) showItem(it);
    if (NT && !it.silent) {
      const id = 'u' + (++ntSeq), g = VP[mode];
      ntH[id] = {
        start: () => { if (play === pl && !it.t0) begin(pl, it, false); },
        range: ci => { if (play === pl && it.t0 && !it.sim) boundary(it, ci); },
        end: () => { if (play !== pl || it.sim) return; if (!it.t0) begin(pl, it, true); else finish(it); },
        err: () => { if (play === pl && !it.sim) { if (!it.t0) begin(pl, it, true); else finish(it); } },
      };
      NT.speak(id, it.text, it.lang, cl(g.pf * (it.pitchMul || 1), .1, 2), cl(rate, .3, 3));
      it.watch = setTimeout(() => { if (play === pl && !it.t0) { delete ntH[id]; begin(pl, it, true); msg('기기 음성 엔진이 대답하지 않아 입 모양만 보여줘요.'); } }, 4000);
      return;
    }
    if (it.silent || !synth || !voices.length) { begin(pl, it, true); return; }
    const u = new SpeechSynthesisUtterance(it.text);
    u.lang = it.lang; if (vp.v) u.voice = vp.v;
    u.pitch = cl(vp.pitch * (it.pitchMul || 1), .1, 2); u.rate = cl(rate, .3, 3);
    u.onstart = () => { if (play === pl && !it.t0) begin(pl, it, false); };
    u.onboundary = e => { if (play === pl && it.t0 && !it.sim && (!e.name || e.name === 'word')) boundary(it, e.charIndex); };
    u.onend = () => { if (play !== pl || it.sim) return; if (!it.t0) begin(pl, it, true); else finish(it); };
    u.onerror = () => { if (play === pl && !it.sim) { if (!it.t0) begin(pl, it, true); else finish(it); } };
    it.u = u; synth.speak(u);
    it.watch = setTimeout(() => {
      if (play === pl && !it.t0) { begin(pl, it, true); synth.cancel(); msg('음성 엔진이 대답하지 않아 소리 없이 입 모양만 보여줘요.'); }
    }, 2500);
  }
  function begin(pl, it, sim) {
    clearTimeout(it.watch);
    it.t0 = performance.now(); it.sim = sim; it.bnd = false;
    if (sim) it.simEnd = it.t0 + it.units * it.spu * 1000;
    if (it.sing) { playNote(VP[mode].f * Math.pow(2, it.semi / 12)); hl(`[data-i="${pl.i}"]`); }
  }
  function boundary(it, ci) {
    let wi = 0; for (let i = 0; i < it.words.length; i++) if (it.words[i].s <= ci) wi = i;
    const now = performance.now();
    if (it.bnd && wi > it.bwi) { // 실제 말하는 속도에 맞춰 보정
      const du = it.words[wi].u0 - it.words[it.bwi].u0, m = (now - it.bt) / 1000 / du;
      if (m > .02 && m < .4) it.spu += (m - it.spu) * .35;
    }
    it.bnd = true; it.bwi = wi; it.bt = now; it.fi = it.words[wi].f0;
  }
  function finish(it) {
    if (!it.sim && !it.bnd && !it.sing && it.units > 3) {
      const m = (performance.now() - it.t0) / 1000 / it.units * it.rate;
      calib[it.key] = cl((calib[it.key] || .095) * .5 + m * .5, .04, .2);
    }
    next();
  }

  // 지금 이 순간 소리 내는 음소 찾기
  function current(now) {
    const pl = play; if (!pl) return null;
    const it = pl.items[pl.i];
    if (!it || !it.t0) return { p: PAUSE, active: false };
    if (it.sim && now >= it.simEnd) { finish(it); return { p: PAUSE, active: !!play }; }
    let u;
    if (it.bnd) { const w = it.words[it.bwi]; u = Math.min(w.u0 + (now - it.bt) / 1000 / it.spu, w.u1 - .001); }
    else u = (now - it.t0) / 1000 / it.spu;
    if (u >= it.units) return { p: PAUSE, active: true, it };
    while (it.fi < it.flat.length - 1 && it.flat[it.fi].u1 <= u) it.fi++;
    const f = it.flat[it.fi];
    const wi = it.bnd ? it.bwi : f.wi;
    if (wi !== it.wi && wi >= 0) { it.wi = wi; if (!pl.sing) hl(`[data-w="${wi}"]`); Head.word(); }
    return { p: f.p, f, it, active: true };
  }

  function target(p) {
    const b = p.body || P.REST;
    return {
      jaw: p.jaw ?? .1, lc: p.lc || 0, lr: p.lr || 0, ls: p.ls || 0, ld: p.ld || 0,
      tipA: p.tip ? 1 : 0, tipX: p.tip ? p.tip[0] : S.tipX, tipY: p.tip ? p.tip[1] : S.tipY,
      bodyX: b[0], bodyY: b[1], back: p.back || 0, vel: p.vel || 0, voice: p.voice || 0, fric: p.fric || 0,
      glot: p.glot ?? (p.voice ? 0 : p.rest ? .8 : .5), cl: (p.stop || p.hold || (p.vel && !p.v && !p.rest)) ? 1 : 0,
    };
  }
  function onPhone(f) {
    const prev = lastF; lastF = f;
    if (prev && prev.p.stop) Head.burst(prev.p);
    Head.phone(f.p, prev && prev.p);
    const d = P.DESC[f.q.k] || ['', ''];
    $('#phG').textContent = f.q.g || '·'; $('#phIpa').textContent = f.q.k === '_' ? '' : `/${f.q.k}/`;
    $('#phCat').textContent = d[0]; $('#phDesc').textContent = d[1];
  }

  // ---------- 화면 ----------
  function showItem(it) {
    let h = '', k = 0;
    it.words.forEach((w, i) => { h += esc(it.text.slice(k, w.s)) + `<span data-w="${i}">${esc(it.text.slice(w.s, w.e))}</span>`; k = w.e; });
    $('#now').innerHTML = h + esc(it.text.slice(k));
  }
  function hl(sel) {
    document.querySelectorAll('#now .on').forEach(e => e.classList.remove('on'));
    const e = document.querySelector('#now ' + sel); if (e) e.classList.add('on');
  }
  let msgT = 0;
  function msg(t) { const m = $('#msg'); m.textContent = t; clearTimeout(msgT); msgT = setTimeout(() => { m.textContent = ''; }, 6000); }

  const NAMES = { boy: '어린 남자', girl: '어린 여자', man: '성인 남자', woman: '성인 여자' };
  const F0 = { boy: 260, girl: 290, man: 120, woman: 210 };
  const SKIN = { skin: 1, xray: 1, section: 0 };
  let state = 'title', view = 'xray', skinA = 1, hudT = 0;

  function fit(c) {
    const r = c.getBoundingClientRect(), w = Math.max(1, Math.round(r.width * DPR)), h = Math.max(1, Math.round(r.height * DPR));
    if (c.width === w && c.height === h) return false; c.width = w; c.height = h; return true;
  }
  function resize() { DPR = Math.min(2, window.devicePixelRatio || 1); fit(cv); fit(gcv); }
  function thumbs() {
    const rest = Object.assign({}, S, { jaw: .03, lc: 1, lr: 0, ls: 0, ld: 0, tipA: 0, back: 0, bodyX: 398, bodyY: 592 });
    document.querySelectorAll('canvas.thumb').forEach(c => { if (c.getBoundingClientRect().width < 2) return; fit(c); Head.snapshot(c.closest('[data-mode]').dataset.mode, c, rest); c.dataset.done = 1; });
  }
  function setState(s) {
    state = s; document.body.classList.toggle('state-title', s === 'title'); document.body.classList.toggle('state-game', s === 'game');
    if (s === 'title') { stop(); $('#now').textContent = ''; }
    requestAnimationFrame(() => { resize(); document.querySelectorAll('canvas.thumb:not([data-done])').length && thumbs(); });
  }
  function setMode(k) {
    mode = k; Head.setMode(k); $('#modeName').textContent = NAMES[k];
    document.querySelectorAll('.char').forEach(x => { const on = x.dataset.mode === k; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    const cur = current(now);
    if (cur && cur.f && cur.f !== lastF) onPhone(cur.f);
    if (!cur) lastF = null;
    const p = force || (cur ? cur.p : IDLE), T = target(p);
    for (const k in SPD) S[k] += (T[k] - S[k]) * (1 - Math.exp(-SPD[k] * dt));
    const tgt = state === 'title' ? 1 : SKIN[view];
    skinA += (tgt - skinA) * (1 - Math.exp(-dt * 6)); if (Math.abs(tgt - skinA) < .005) skinA = tgt;

    Head.frame(ctx, S, { active: !!(cur && cur.active) || !!force, p, sing: !!(play && play.sing), labels: opt.labels && state === 'game', air: opt.air, nerves: opt.nerves,
      skin: skinA, lens: state === 'game' && view === 'xray', bg: true, fx: true, w: cv.width / DPR, h: cv.height / DPR, dpr: DPR }, dt);
    if (state === 'game') {
      Head.glottis(gctx, S, gcv.width, gcv.height);
      const tng = cl(Math.max(S.tipA * .9, S.back, cl((618 - S.bodyY) / 45, 0, 1) * .8 + Math.abs(S.bodyX - 398) / 120), 0, 1);
      [tng, Math.max(S.lc, S.lr, S.ls * .7, S.ld), S.jaw, S.voice, 1 - S.vel].forEach((v, i) => { meters[i].style.transform = `scaleX(${cl(v, 0, 1).toFixed(3)})`; });
      const gs = S.voice > .5 ? '떨림 · 유성음' : S.glot > .65 ? '활짝 열림 · 숨쉬기' : '열림 · 무성음';
      if (gs !== lastGs) { lastGs = gs; $('#glotState').textContent = gs; }
      if (now - hudT > 120) {
        hudT = now;
        const it = play && play.items[play.i], semi = it && it.semi ? it.semi : 0;
        $('#hudF0').textContent = S.voice > .5 ? Math.round(F0[mode] * Math.pow(2, semi / 12) * (.97 + .06 * Math.sin(now / 90))) : '---';
        $('#hudPh').textContent = lastF && lastF.q.k !== '_' ? `/${lastF.q.k}/` : '---';
        $('#hudSt').textContent = play ? (play.sing ? 'SINGING' : 'SPEAKING') : 'STANDBY';
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------- 이벤트 ----------
  const readText = () => { const t = $('#txt').value.trim(); if (!t) return msg('텍스트 칸에 글을 적어 주세요.'); start(chunks(t).map(c => P.build(c, langOf(c))).filter(c => c.flat.length), false); };
  $('#read').onclick = readText;
  $('#stop').onclick = () => { stop(); $('#now').textContent = ''; };
  $('#songRead').onclick = () => { const t = $('#song').value.trim(); if (!t) return msg('노래 제목을 적어 주세요.'); start([P.build(t, langOf(t))].filter(c => c.flat.length), false); };
  $('#songSing').onclick = () => { const t = $('#song').value.trim(); if (!t) return msg('노래 제목을 적어 주세요.'); start(song(t), true); };
  $('#txt').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); readText(); } });
  $('#song').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#songSing').click(); } });
  document.querySelectorAll('.char').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => {
    view = b.dataset.view; document.querySelectorAll('[data-view]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
  });
  $('#startBtn').onclick = () => setState('game');
  $('#homeBtn').onclick = () => setState('title');
  $('#helpBtn').onclick = () => { const h = $('#help'); h.hidden = !h.hidden; $('#helpBtn').setAttribute('aria-expanded', !h.hidden); };
  document.addEventListener('keydown', e => {
    const typing = /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement.tagName);
    if (state === 'title' && e.key === 'Enter' && !typing && !/BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); setState('game'); }
    else if (state === 'game' && e.key === 'Escape') setState('title');
  });
  $('#rate').oninput = e => { opt.rate = +e.target.value; $('#rateV').textContent = opt.rate.toFixed(1) + 'x'; };
  $('#voice').onchange = e => { opt.voice = e.target.value; };
  document.querySelectorAll('.tool').forEach(b => b.onclick = () => { opt[b.dataset.opt] = !opt[b.dataset.opt]; b.classList.toggle('on', opt[b.dataset.opt]); b.setAttribute('aria-pressed', opt[b.dataset.opt]); });
  if (window.innerWidth < 600) { opt.labels = false; const b = $('.tool[data-opt=labels]'); b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); }
  new ResizeObserver(resize).observe($('#stage'));
  if (NT) $('#voice').innerHTML = '<option value="">기기 기본 음성</option>';
  else if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }
  else msg('이 브라우저는 음성 읽기를 지원하지 않아요. 입 모양만 보여줄게요.');

  // 돋보기: 마우스를 움직이거나 손가락으로 끌어서 이동
  const lensMove = e => { if (state === 'game' && view === 'xray' && (e.pointerType === 'mouse' || e.buttons)) Head.lensTo(e.offsetX, e.offsetY); };
  cv.addEventListener('pointermove', lensMove); cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); Head.lensTo(e.offsetX, e.offsetY); });
  const back = () => { if (state === 'game') { setState('title'); return true; } return false; };
  window.TalkHead = { S, start, stop, setState, back, setForce: k => { force = k ? Object.assign({}, P.PH[k]) : null; } }; // 테스트용
  resize(); requestAnimationFrame(frame);
  requestAnimationFrame(() => requestAnimationFrame(thumbs));
  if (document.fonts) document.fonts.ready.then(resize);
})();
