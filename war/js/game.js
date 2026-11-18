// 게임 핵심: 상태, 경제, 전쟁, 적 반격, 저장, 아래 창(패널), 지도 위 도시 버튼
(function () {
  // ───────── 공통 UI ─────────
  const UI = (window.UI = {});
  const $ = (id) => document.getElementById(id);
  UI.$ = $;
  UI.screen = null;
  UI.show = (id) => {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('show', s.id === id));
    UI.screen = id;
  };
  UI.fade = (fn) => {
    const f = $('fade');
    f.classList.add('on');
    setTimeout(() => { fn(); setTimeout(() => f.classList.remove('on'), 150); }, 850);
  };
  UI.modal = (html, onBind) => {
    const m = $('modal'), c = $('modalCard');
    c.innerHTML = html;
    c.querySelectorAll('.wob').forEach((e) => SK.wob(e));
    m.classList.remove('hidden');
    if (onBind) onBind(c);
  };
  UI.close = () => $('modal').classList.add('hidden');
  UI.isModal = () => !$('modal').classList.contains('hidden');
  UI.confirm = (title, text, yes, onYes, cls = 'red') => UI.modal(
    `<h2 class="wob">${title}</h2><p>${text}</p><div class="acts"><button class="btn" data-a="no"><span class="wob">취소</span></button><button class="btn ${cls}" data-a="yes"><span class="wob">${yes}</span></button></div>`,
    (c) => {
      c.querySelector('[data-a=no]').onclick = () => { SFX.play('click'); UI.close(); };
      c.querySelector('[data-a=yes]').onclick = () => { SFX.play('click'); UI.close(); onYes(); };
    });
  UI.toast = (text, kind = '', icon = 'info') => {
    const box = $('toasts');
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.innerHTML = `<img src="${SK.icon(icon, 64)}" alt="">${text}`;
    box.prepend(d);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 400); }, kind === 'bad' ? 6000 : 4200);
  };
  const fmt = (n) => Math.floor(n).toLocaleString('ko-KR');
  const batchim = (w) => { const c = w.charCodeAt(w.length - 1); return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : 0; };
  const J = (w, a, b) => w + (batchim(w) ? a : b);
  const RO = (w) => { const b = batchim(w); return w + (b && b !== 8 ? '으로' : '로'); };
  UI.fmt = fmt; UI.J = J; UI.RO = RO;

  // ───────── 규칙 ─────────
  const SAVE_KEY = 'zollaWar.saves.v1';
  const UNITS = {
    inf: { name: '국군 보병', icon: 'infantry', cost: 10, pow: 1, base: 0, desc: '총을 든 용감한 졸라맨' },
    tank: { name: 'K2 흑표', icon: 'tank', cost: 80, pow: 10, base: 1, desc: '세계 최강 K-전차' },
    art: { name: 'K9 자주포', icon: 'artillery', cost: 180, pow: 24, base: 2, desc: '천둥처럼 쾅! 쾅!' },
    jet: { name: 'KF-21 보라매', icon: 'jet', cost: 450, pow: 64, base: 3, desc: '하늘을 지배하는 K-전투기' },
  };
  const range = (l) => 9 + 5 * l;
  const BUILD = {
    factory: { name: '공장', icon: 'factory', base: 200, mul: 1.9, max: 10, desc: (l) => `세금 수입 +${25 * l}%` },
    base: { name: '군사기지', icon: 'base', base: 250, mul: 2.1, max: 8, desc: (l) => `공격 사거리 ${range(l)}° / 새 무기` },
    fort: { name: '요새', icon: 'fort', base: 150, mul: 1.8, max: 8, desc: (l) => `적 반격 방어 +${30 * l}%` },
    hospital: { name: '병원', icon: 'hospital', base: 180, mul: 1.9, max: 8, desc: (l) => `지지율 회복 ${(regenOf(l) * 60).toFixed(0)}/분` },
    kculture: { name: '한류 센터', icon: 'kpop', base: 300, mul: 2, max: 6, desc: (l) => `한류 설득 성공률 +${5 * l}%` },
    taxman: { name: '자동 징수원', icon: 'taxman', base: 400, mul: 2, max: 6, desc: (l) => (l ? `${l}명이 대신 세금을 걷어요` : '세금을 대신 걷어줘요') },
  };
  const regenOf = (h) => 0.1 + 0.06 * h;
  const TAX = [
    { name: '낮음', mul: 0.6, drain: 0.03, desc: '수입 60% · 국민이 좋아해요' },
    { name: '보통', mul: 1, drain: 0.1, desc: '수입 100% · 무난해요' },
    { name: '높음', mul: 1.7, drain: 0.3, desc: '수입 170% · 국민이 화나요' },
  ];
  const POLICY = {
    food: { name: '무료 급식', icon: 'food', cost: (n) => 80 + 12 * n, gain: 6, cd: 0, desc: '지지율 +6' },
    festival: { name: '치맥 축제', icon: 'chicken', cost: (n) => 250 + 30 * n, gain: 15, cd: 60, desc: '지지율 +15' },
    speech: { name: '대국민 담화', icon: 'speech', cost: () => 0, gain: 3, cd: 40, desc: '공짜 · 지지율 +3' },
    draft: { name: '징병', icon: 'draft', cost: () => 0, gain: -4, cd: 30, desc: '보병 무료 입대 · 지지율 -4' },
  };

  const G = (window.GAME = { UNITS, BUILD, TAX });
  let map, K, S = null, cities, countries;
  let taxCd = [], floats = [], buttons = [], inRange = [], pending = null, tab = 'make';
  let lastPanel = '', lastHud = '', dirtyMap = true, bulkCd = 0;
  let combo = 0, lastHit = 0, fever = 0, parts = [], crate = null, newsT = 0, achT = 0, lastCity = '서울';
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);

  G.state = () => S; // 디버그용
  G._crate = () => crate && map.toScreen(crate.x, crate.y);
  G.init = (m) => { map = m; K = m.koreaIdx; cities = m.cities; countries = m.countries; bindMap(); bindPanel(); };

  // ───────── 저장 ─────────
  G.saves = () => { try { const a = JSON.parse(localStorage.getItem(SAVE_KEY)); if (Array.isArray(a)) return [a[0] || null, a[1] || null, a[2] || null]; } catch (e) { /* 저장 없음 */ } return [null, null, null]; };
  const writeSaves = (a) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(a)); } catch (e) { /* 저장 불가 */ } };
  G.deleteSlot = (i) => { const a = G.saves(); a[i] = null; writeSaves(a); };
  G.wipe = () => { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 무시 */ } };
  G.save = () => {
    if (!S || S.ended === 'sad') return;
    S.view = { ...map.view };
    const a = G.saves(); a[S.slot] = S; writeSaves(a);
  };
  G.newWorld = (slot) => {
    const a = G.saves();
    const used = a.map((s) => s && s.name).filter(Boolean);
    let n = 1; while (used.includes(`제${n}세계`)) n++;
    a[slot] = {
      v: 1, slot, name: `제${n}세계`, created: Date.now(), updated: Date.now(), played: 0,
      money: 200, approval: 62, tax: 1, units: { inf: 30, tank: 0, art: 0, jet: 0 },
      bld: { factory: 0, base: 0, fort: 0, hospital: 0, taxman: 0 },
      owner: cities.map((c) => c.country), dmg: {}, wins: 0, losses: 0, taxed: 0,
      cds: {}, nextAttack: 90, nextEvent: 80, ended: null, storyDone: false,
    };
    writeSaves(a);
    return a[slot];
  };
  G.ownedCount = (st) => st.owner.filter((o) => o === K).length;
  G.progress = (st) => G.ownedCount(st) / cities.length;
  G.thumb = (canvas, st) => {
    map.recolor((id) => st.owner[id] ?? cities[id].country);
    const g = canvas.getContext('2d');
    canvas.width = 500; canvas.height = 180;
    g.fillStyle = '#6aa6d6'; g.fillRect(0, 0, 500, 180);
    g.drawImage(map.rasterCanvas, 0, 0, map.RW, map.RH, 0, 0, 500, 500 * map.RH / map.RW);
  };

  // ───────── 시작 / 종료 ─────────
  G.enter = (slot) => {
    const a = G.saves();
    S = a[slot];
    if (!S) return;
    S.slot = slot;
    if (S.owner.length !== cities.length) S.owner = cities.map((c, i) => S.owner[i] ?? c.country);
    taxCd = cities.map(() => 0); floats = []; pending = null; bulkCd = 0;
    S.bld = { factory: 0, base: 0, fort: 0, hospital: 0, taxman: 0, kculture: 0, ...S.bld };
    S.ach = S.ach || {};
    if (S.nextCrate == null) S.nextCrate = S.played + 25;
    if (S.nextChoice == null) S.nextChoice = S.played + 60;
    if (S.rank == null) S.rank = rankOf();
    combo = 0; fever = 0; parts = []; crate = null; newsT = 0;
    map.recolor((id) => S.owner[id]);
    computeRange();
    UI.show('scr-game');
    G.resize();
    if (S.view && S.view.s) { Object.assign(map.view, S.view); map.clamp(); } else G.home();
    lastPanel = ''; renderPanel(true); renderHud(true);
    SFX.song('game');
    news();
    if (S.played < 1) setTimeout(() => UI.toast('도시 가운데의 <b>세금</b> 버튼을 눌러 돈을 모으고, 아래 창에서 군대를 만들어 <b>전쟁하기</b>로 도시를 뺏으세요!', 'good', 'info'), 600);
  };
  G.leave = () => { G.save(); S = null; UI.close(); };
  G.active = () => !!S;
  G.home = () => {
    const W = map.W, H = map.H;
    map.focus(127.8, 36.2, Math.max(40, Math.min(W / 22, H / 14)));
    dirtyMap = true;
  };
  G.resize = () => {
    const wrap = $('mapWrap'), W = wrap.clientWidth, H = wrap.clientHeight, d = dpr();
    if (!W || !H) return;
    for (const id of ['mapBase', 'mapTop']) { const c = $(id); c.width = W * d; c.height = H * d; }
    map.resize(W, H);
    dirtyMap = true;
  };

  // ───────── 계산 ─────────
  const owned = () => { const r = []; S.owner.forEach((o, i) => o === K && r.push(i)); return r; };
  const power = () => Object.keys(UNITS).reduce((s, k) => s + S.units[k] * UNITS[k].pow, 0);
  G.power = () => (S ? power() : 0);
  const geoDist = (a, b) => {
    let dl = Math.abs(a.lon - b.lon); if (dl > 180) dl = 360 - dl;
    return Math.hypot(dl * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180), a.lat - b.lat);
  };
  function computeRange() {
    const mine = owned().map((i) => cities[i]), R = range(S.bld.base);
    inRange = cities.map((c) => S.owner[c.id] !== K && mine.some((m) => geoDist(m, c) <= R));
  }
  const tierOf = (ci) => countries[ci].tier || 1;
  const cityTax = (id) => {
    const c = cities[id], size = c.capital ? 3 : 2;
    return Math.round((5 + 3 * size) * TAX[S.tax].mul * (1 + 0.25 * S.bld.factory) * (1 + 0.15 * (countries[c.country].tier || 0)));
  };
  const alarm = () => 1 + Math.min(1.5, 0.012 * G.ownedCount(S));
  const baseDef = (id) => {
    const c = cities[id], o = S.owner[id], cn = countries[o];
    let d = 25 * tierOf(o) * (c.capital && c.country === o ? 1.6 : 1) * alarm();
    if (S.owner[cn.capital] === K) d *= 0.6; // 수도가 함락된 나라는 사기 저하
    return d;
  };
  const defOf = (id) => {
    const b = baseDef(id), dm = S.dmg[id];
    let v = b;
    if (dm) v -= Math.max(0, dm.v - (S.played - dm.t) * b * 0.01);
    return Math.max(5, Math.round(v));
  };
  G.defOf = (id) => defOf(id);
  const chanceOf = (P, D) => (P <= 0 ? 0 : (P * P) / (P * P + D * D));

  // ───────── 세금 ─────────
  function collect(id, auto) {
    const now = performance.now();
    if (taxCd[id] > now || S.owner[id] !== K) return false;
    taxCd[id] = now + 1000;
    let v = cityTax(id) * (auto === 'bulk' ? 0.7 : 1), big = false;
    if (!auto) {
      combo = now - lastHit < 1600 ? combo + 1 : 1; lastHit = now;
      S.best = Math.max(S.best || 0, combo);
      v *= 1 + Math.min(combo, 50) * 0.01;
      if (combo === 30 && fever < now) {
        fever = now + 10000; S.fevers = (S.fevers || 0) + 1;
        SFX.play('fever'); UI.toast('<b>피버 타임!</b> 10초 동안 세금 2배, 지지율도 안 떨어져요!', 'good', 'coin');
      }
      if (Math.random() < 0.04) { big = true; v *= 5; S.jackpots = (S.jackpots || 0) + 1; SFX.play('jackpot'); }
    }
    const fev = fever > now;
    if (fev) v *= 2;
    v = Math.round(v);
    S.money += v; S.taxed += v;
    if (!fev) S.approval -= TAX[S.tax].drain * (auto ? 0.5 : 1);
    floats.push({ id, text: (big ? '대박! +' : '+') + fmt(v), t: 0, big });
    if (!auto) {
      for (let i = 0; i < (big ? 12 : 4); i++) parts.push({ id, x: 0, y: -6, vx: (Math.random() - 0.5) * 160, vy: -120 - Math.random() * 160, t: 0 });
      if (!big) SFX.play('coin');
    }
    return true;
  }
  function bulkCollect() {
    if (bulkCd > performance.now()) return;
    let n = 0;
    owned().forEach((id) => { if (collect(id, 'bulk')) n++; });
    if (n) { SFX.play('coin'); bulkCd = performance.now() + 10000; } else SFX.play('deny');
  }

  // ───────── 전쟁 ─────────
  function openWar(id) {
    const c = cities[id];
    if (!inRange[id]) {
      SFX.play('deny');
      UI.toast(`${c.name}${batchim(c.name) ? '은' : '는'} 사거리 밖이에요. <b>시설</b> 탭에서 군사기지를 올리세요.`, 'bad', 'base');
      return;
    }
    if (power() <= 0) { SFX.play('deny'); UI.toast('군대가 없어요! <b>생성</b> 탭에서 병사를 만드세요.', 'bad', 'infantry'); return; }
    SFX.play('drum');
    G.onWar && G.onWar(id);
  }
  G.chance = chanceOf;
  G.warPrep = (id) => {
    const c = cities[id], ei = S.owner[id], en = countries[ei];
    return { id, city: c.name, capital: c.capital && c.country === ei, boss: c.capital && c.country === ei && tierOf(ei) >= 4, enemy: en.name, rgb: en.rgb, D: defOf(id), P0: power(), units: { ...S.units } };
  };
  // 전투 계산 + 결과 적용 (화면은 war.js)
  G.fight = (id, f) => {
    const c = cities[id], ei = S.owner[id], en = countries[ei];
    const P = power() * f, D = defOf(id), ch = chanceOf(P, D);
    const win = Math.random() < ch;
    const loss = win ? Math.min(0.5, Math.max(0.03, (0.5 * D) / (P + D))) : Math.min(0.8, Math.max(0.35, 0.35 + (0.4 * D) / (P + D)));
    const sent = {}, lost = {}, before = { ...S.units };
    Object.keys(UNITS).forEach((k) => { sent[k] = Math.round(S.units[k] * f); lost[k] = Math.min(sent[k], Math.floor(sent[k] * loss + Math.random())); S.units[k] -= lost[k]; });
    const r = { win, P: Math.round(P), D, ch, loss, sent, lost, before, city: c.name, enemy: en.name, rgb: en.rgb, capital: c.capital && c.country === ei };
    r.boss = r.capital && tierOf(ei) >= 4;
    if (win) {
      S.wins++;
      capture(id, r, r.capital ? 6 : 3);
      if (r.boss) { r.bonus = Math.round(D * 4); S.money += r.bonus; S.bosses = (S.bosses || 0) + 1; }
    } else {
      const prev = S.dmg[id];
      const cur = prev ? Math.max(0, prev.v - (S.played - prev.t) * baseDef(id) * 0.01) : 0;
      S.dmg[id] = { v: cur + P * 0.6, t: S.played };
      S.losses++; S.approval -= 5; r.gain = -5;
      r.Dafter = defOf(id);
    }
    r.after = { ...S.units }; r.power = power(); r.approval = S.approval;
    r.owned = G.ownedCount(S); r.total = cities.length;
    G.save();
    return r;
  };
  function capture(id, r, gain) {
    const en = countries[S.owner[id]], prev = inRange.slice();
    S.owner[id] = K; delete S.dmg[id];
    r.gain = gain;
    r.allMine = en.cities.every((ci) => S.owner[ci] === K);
    if (r.allMine) r.gain += 2;
    S.approval = Math.min(100, S.approval + r.gain);
    map.recolor((i) => S.owner[i]); computeRange(); dirtyMap = true;
    r.newTargets = inRange.filter((v, i) => v && !prev[i]).length;
    lastCity = cities[id].name;
    news(`속보: 국군, ${lastCity} ${r.kpop ? '한류로 평화 통합!' : '점령!'}`);
  }
  // 한류로 설득 (전투 없이 도시 얻기)
  G.persuadeInfo = (id) => {
    const c = cities[id], ei = S.owner[id], cap = c.capital && c.country === ei;
    let ch = 0.72 - tierOf(ei) * 0.09;
    if (cap) ch *= 0.7;
    ch = ch * (0.55 + (Math.max(0, S.approval) / 100) * 0.6) + 0.05 * (S.bld.kculture || 0) + (S.hallyu || 0);
    return { cost: Math.round(defOf(id) * 5 + 120), chance: Math.max(0.05, Math.min(0.9, ch)) };
  };
  G.persuade = (id) => {
    const { cost, chance } = G.persuadeInfo(id);
    if (S.money < cost) return null;
    const c = cities[id], ei = S.owner[id], en = countries[ei], D = defOf(id);
    S.money -= cost;
    const zero = {}; Object.keys(UNITS).forEach((k) => (zero[k] = 0));
    const r = { kpop: true, win: Math.random() < chance, cost, ch: chance, P: 0, D, sent: zero, lost: zero, city: c.name, enemy: en.name, rgb: en.rgb, capital: c.capital && c.country === ei };
    if (r.win) { capture(id, r, 4); S.kwins = (S.kwins || 0) + 1; SFX.play('kpop'); }
    else { S.approval -= 2; r.gain = -2; r.Dafter = D; }
    r.after = { ...S.units }; r.power = power(); r.approval = S.approval;
    r.owned = G.ownedCount(S); r.total = cities.length;
    G.save();
    return r;
  };
  G.afterWar = () => { renderPanel(true); renderHud(true); checkEnd(); };

  function checkEnd() {
    if (!S || S.ended) return;
    if (S.approval <= 0) {
      S.ended = 'sad';
      G.deleteSlot(S.slot);
      G.onEnding && G.onEnding('sad', stats());
      S = null;
    } else if (G.ownedCount(S) === cities.length) {
      S.ended = 'happy';
      G.save();
      G.onEnding && G.onEnding('happy', stats());
    }
  }
  const stats = () => ({ played: S.played, wins: S.wins, losses: S.losses, taxed: S.taxed, owned: G.ownedCount(S), total: cities.length, name: S.name });

  // ───────── 적 반격 / 사건 ─────────
  function planAttack() {
    const mine = owned();
    if (mine.length < 8) { S.nextAttack = S.played + 30; return; }
    const pairs = [];
    mine.forEach((m) => {
      let best = -1, bd = 9;
      cities.forEach((c) => { if (S.owner[c.id] !== K) { const d = geoDist(cities[m], c); if (d < bd) { bd = d; best = c.id; } } });
      if (best >= 0) pairs.push([m, best]);
    });
    S.nextAttack = S.played + 55 + Math.random() * 55;
    if (!pairs.length) return;
    const [target, from] = pairs[Math.floor(Math.random() * pairs.length)];
    const A = Math.round(baseDef(from) * (0.6 + Math.random() * 0.6));
    pending = { target, from, country: S.owner[from], A, at: S.played + 8 };
    const cn = countries[pending.country].name, tn = cities[target].name;
    UI.toast(`<b>${cn}군</b>이 <b>${RO(tn)}</b> 진격 중! (공격력 ${fmt(A)}) 8초 안에 군대를 늘리거나 요새를 지으세요!`, 'bad', 'alarm');
    SFX.play('alarm');
  }
  function resolveAttack() {
    const p = pending; pending = null;
    if (S.owner[p.target] !== K) return;
    const D = power() * 0.5 * (1 + 0.3 * S.bld.fort) + 15;
    const tn = cities[p.target].name, cn = countries[p.country].name;
    const lose = (frac) => Object.keys(UNITS).forEach((k) => (S.units[k] -= Math.floor(S.units[k] * frac)));
    if (D * (0.75 + Math.random() * 0.5) >= p.A) {
      lose(0.04); S.approval = Math.min(100, S.approval + 1);
      UI.toast(`${tn} 방어 성공! ${J(cn + '군', '을', '를')} 물리쳤습니다. 지지율 +1`, 'good', 'fort');
      SFX.play('win');
    } else {
      lose(0.1); S.owner[p.target] = p.country;
      const big = cities[p.target].country === K && cities[p.target].capital;
      S.approval -= big ? 16 : 6;
      UI.toast(`${J(tn, '이', '가')} ${cn}에게 함락되었습니다... 지지율 -${big ? 16 : 6}`, 'bad', 'alarm');
      SFX.play('lose');
      map.recolor((i) => S.owner[i]); computeRange(); dirtyMap = true;
    }
    G.save(); checkEnd();
  }
  const EVENTS = [
    () => { const v = 100 + 20 * G.ownedCount(S); S.money += v; return [`경제 호황! 수출이 늘어 국고 +${fmt(v)}`, 'good', 'coin']; },
    () => { S.approval -= 7; return ['대통령 측근 스캔들 의혹... 지지율 -7', 'bad', 'approval']; },
    () => { const n = 10 + G.ownedCount(S); S.units.inf += n; return [`애국 졸라맨 ${n}명이 자원 입대했습니다!`, 'good', 'infantry']; },
    () => { const v = 50 * G.ownedCount(S); S.money += v; return [`새 에테르 광맥 발견! 국고 +${fmt(v)}`, 'good', 'coin']; },
    () => { const v = Math.floor(S.money * 0.1); S.money -= v; return [`태풍 피해 복구비 -${fmt(v)}`, 'bad', 'coin']; },
    () => { S.approval = Math.min(100, S.approval + 5); return ['국가대표팀 우승! 국민이 기뻐합니다. 지지율 +5', 'good', 'festival']; },
  ];

  // ───────── 재미 요소: 선택지 사건, 보급 상자, 업적, 칭호, 속보 ─────────
  const keyIdx = (key) => countries.findIndex((c) => c.key === key);
  const ownsAll = (key) => { const i = keyIdx(key); return i >= 0 && countries[i].cities.every((ci) => S.owner[ci] === K); };
  const H = {
    ap: (x) => (S.approval = Math.min(100, S.approval + x)),
    money: (x) => (S.money = Math.max(0, S.money + x)),
    pay: (x) => (S.money >= x ? ((S.money -= x), true) : false),
    unit: (k, x) => (S.units[k] = Math.max(0, S.units[k] + x)),
    chance: (p) => Math.random() < p,
    hallyu: (x) => (S.hallyu = Math.min(0.3, (S.hallyu || 0) + x)),
    ownsAll,
    weaken: (key, frac) => { const i = keyIdx(key); if (i < 0) return; countries[i].cities.forEach((ci) => { if (S.owner[ci] !== K) S.dmg[ci] = { v: baseDef(ci) * frac, t: S.played }; }); },
  };
  function choiceEvent() {
    const list = window.K_EVENTS.filter((e) => !e.cond || e.cond(S, H));
    const e = list[Math.floor(Math.random() * list.length)], n = G.ownedCount(S);
    SFX.play('page');
    UI.modal(`<div class="ev"><img class="ev-pic" src="${SK.icon(e.icon, 96)}" alt=""><div><p class="ev-tag">긴급 결정</p><h2 class="wob">${e.title}</h2><p>${e.text(n)}</p></div></div>
      <div class="ev-acts"><button class="btn big" data-c="a"><span class="wob">${e.a.label(n)}</span></button><button class="btn big dark" data-c="b"><span class="wob">${e.b.label(n)}</span></button></div>`, (c) => {
      c.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => {
        SFX.play('click'); UI.close();
        const [t, k] = e[b.dataset.c].fn(S, n, H);
        UI.toast(t, k, e.icon); SFX.play(k === 'bad' ? 'deny' : 'buy');
        renderHud(true); checkEnd();
      }));
    });
  }
  function dropCrate() {
    const mine = owned();
    if (!mine.length) return;
    const vis = mine.filter((id) => { const [x, y] = map.toScreen(cities[id].x, cities[id].y); return x > 40 && y > 40 && x < map.W - 40 && y < map.H - 40; });
    const id = (vis.length ? vis : mine)[Math.floor(Math.random() * (vis.length || mine.length))];
    const c = cities[id], s = map.view.s;
    crate = { x: c.x + ((Math.random() - 0.5) * 70) / s, y: c.y - (30 + Math.random() * 30) / s, born: S.played };
    UI.toast(`<b>보급 상자</b>가 ${c.name} 근처에 떨어지고 있어요! 눌러서 열어 보세요.`, 'good', 'crate');
    SFX.play('crate');
  }
  function openCrate() {
    const n = G.ownedCount(S), r = Math.random(), [x, y] = [crate.x, crate.y];
    crate = null; S.nextCrate = S.played + 30 + Math.random() * 25;
    let t, k = '';
    if (r < 0.06) {
      S.legends = (S.legends || 0) + 1; k = 'good';
      const pick = Math.floor(Math.random() * 3);
      if (pick === 0) { const m = 2 + Math.floor(n / 10); S.units.jet += m; t = `<b>전설!</b> KF-21 보라매 ${m}대 획득!`; }
      else if (pick === 1) { const m = 600 + 120 * n; S.money += m; t = `<b>전설!</b> 에테르 금고 ₩${fmt(m)} 획득!`; }
      else { H.ap(15); t = '<b>전설!</b> 국민 감동 편지 100만 통! 지지율 +15'; }
      SFX.play('jackpot');
    } else if (r < 0.32) {
      k = 'good';
      if (Math.random() < 0.5) { const m = 2 + Math.floor(n / 8); S.units.tank += m; t = `<b>희귀!</b> K2 흑표 ${m}대 획득!`; }
      else { const m = 20 + 3 * n; S.units.inf += m; t = `<b>희귀!</b> 국군 보병 ${m}명 합류!`; }
      SFX.play('cheer');
    } else {
      const m = 80 + 25 * n; S.money += m; t = `<b>일반</b> 보급품 ₩${fmt(m)} 획득!`; SFX.play('buy');
    }
    UI.toast(t, k, 'crate');
    for (let i = 0; i < 14; i++) parts.push({ wx: x, wy: y, x: 0, y: 0, vx: (Math.random() - 0.5) * 220, vy: -160 - Math.random() * 160, t: 0 });
    renderHud(true);
  }
  const rankOf = () => { const o = G.ownedCount(S); let r = 0; window.K_RANKS.forEach(([m], i) => { if (o >= m) r = i; }); return r; };
  function checkAch() {
    const X = { owned: G.ownedCount(S), ownsAll };
    for (const a of window.K_ACH) {
      if (S.ach[a.id] || !a.check(S, X)) continue;
      S.ach[a.id] = 1; S.money += a.reward;
      UI.toast(`업적 달성: <b>${a.name}</b>! 보상 ₩${fmt(a.reward)}`, 'good', 'star');
      SFX.play('cheer');
      if (a.id === 'korea') { H.ap(20); G.onUnify && G.onUnify(); }
    }
    const r = rankOf();
    if (r > S.rank) { S.rank = r; UI.toast(`새 칭호: <b>${window.K_RANKS[r][1]}</b>`, 'good', 'star'); SFX.play('win'); }
  }
  function news(text) {
    if (!text) {
      const enemies = countries.filter((c) => c.cities.some((ci) => S.owner[ci] !== K));
      const X = { enemy: (enemies[Math.floor(Math.random() * enemies.length)] || countries[K]).name, power: fmt(power()), last: lastCity, ap: Math.ceil(Math.max(0, S.approval)), left: cities.length - G.ownedCount(S) };
      const L = window.K_NEWS;
      text = L[Math.floor(Math.random() * L.length)](X);
    }
    newsT = 0;
    const el = $('tickerText');
    el.textContent = text;
    el.style.animation = 'none'; void el.offsetWidth;
    el.style.animation = `tick ${Math.max(12, text.length * 0.38)}s linear`;
  }

  // ───────── 매 프레임 ─────────
  let hudT = 0, saveT = 0, autoT = 0, autoIdx = 0;
  G.tick = (dt) => {
    if (!S || S.ended === 'sad') return;
    const paused = UI.isModal();
    if (!paused && !S.ended) {
      checkEnd();
      if (!S || S.ended) return;
      S.played += dt;
      S.approval = Math.min(100, S.approval + regenOf(S.bld.hospital) * dt);
      if (S.bld.taxman) {
        autoT += dt;
        const every = 2 / S.bld.taxman;
        if (autoT >= every) {
          autoT = 0;
          const mine = owned();
          for (let k = 0; k < mine.length; k++) { autoIdx = (autoIdx + 1) % mine.length; if (collect(mine[autoIdx], true)) break; }
        }
      }
      if (S.played >= S.nextAttack && !pending) planAttack();
      if (pending && S.played >= pending.at) resolveAttack();
      if (!S) return;
      if (S.played >= S.nextEvent) {
        S.nextEvent = S.played + 70 + Math.random() * 70;
        const [t, k, i] = EVENTS[Math.floor(Math.random() * EVENTS.length)]();
        UI.toast(t, k, i);
      }
      if (!crate && S.played >= S.nextCrate) dropCrate();
      if (crate && S.played - crate.born > 25) { crate = null; S.nextCrate = S.played + 25 + Math.random() * 20; }
      if (S.played >= S.nextChoice && G.ownedCount(S) >= 6) { S.nextChoice = S.played + 100 + Math.random() * 60; choiceEvent(); }
      achT += dt; if (achT > 1) { achT = 0; checkAch(); }
      newsT += dt; if (newsT > 22) news();
      if (S.approval < 20 && !S.warned) { S.warned = true; UI.toast('국회에서 <b>탄핵 소추안</b>이 논의되고 있습니다! 지지율을 올리세요!', 'bad', 'alarm'); SFX.play('alarm'); }
      if (S.approval > 30) S.warned = false;
      checkEnd();
      if (!S) return;
    }
    floats.forEach((f) => (f.t += dt)); floats = floats.filter((f) => f.t < 1.2);
    parts.forEach((q) => { q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 520 * dt; }); parts = parts.filter((q) => q.t < 1);
    hudT += dt; saveT += dt;
    if (hudT > 0.15) { hudT = 0; renderHud(); renderPanel(); }
    if (saveT > 8) { saveT = 0; G.save(); }
  };

  // ───────── HUD ─────────
  function renderHud(force) {
    if (!S) return;
    const ap = Math.max(0, S.approval);
    const d = new Date(2048, 2, 1 + Math.floor(S.played / 6));
    const key = [Math.floor(S.money), power(), Math.ceil(ap), G.ownedCount(S), d.getDate(), S.rank].join('|');
    if (key === lastHud && !force) return;
    lastHud = key;
    $('hudMoney').innerHTML = `${SK.img('coin', 30)}${fmt(S.money)}`;
    $('hudPower').innerHTML = `${SK.img('power', 30)}${fmt(power())}`;
    const el = $('hudApproval');
    el.classList.toggle('low', ap < 20);
    el.innerHTML = `${SK.img('approval', 30)}<span class="bar"><i style="width:${ap}%"></i></span>${Math.ceil(ap)}%`;
    $('hudCities').innerHTML = `${SK.img('city', 30)}${G.ownedCount(S)} / ${cities.length}`;
    $('hudRank').innerHTML = `${SK.img('star', 26)}${window.K_RANKS[S.rank || 0][1]}`;
    $('hudDate').innerHTML = `${SK.img('calendar', 30)}${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  }

  // ───────── 아래 창 ─────────
  const TABS = [['make', '생성', 'infantry'], ['tax', '세금', 'coin'], ['build', '시설', 'factory'], ['policy', '정책', 'speech'], ['info', '정보', 'info']];
  function bindPanel() {
    $('tabs').innerHTML = TABS.map(([k, n, i]) => `<button class="tab" data-tab="${k}">${SK.img(i, 26)}<span class="wob">${n}</span></button>`).join('');
    $('tabs').querySelectorAll('.wob').forEach((e) => SK.wob(e));
    $('tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; SFX.play('click'); tab = b.dataset.tab; renderPanel(true); };
    $('tabBody').onclick = (e) => {
      const b = e.target.closest('[data-act]'); if (!b || b.disabled || !S) return;
      const [act, k, n] = b.dataset.act.split(':');
      if (act === 'buy') buy(k, +n);
      if (act === 'up') upgrade(k);
      if (act === 'rate') { S.tax = +k; SFX.play('click'); }
      if (act === 'bulk') bulkCollect();
      if (act === 'pol') policy(k);
      renderPanel(true); renderHud(true);
    };
  }
  const upCost = (k) => Math.round(BUILD[k].base * BUILD[k].mul ** S.bld[k]);
  function buy(k, n) {
    const u = UNITS[k];
    if (S.bld.base < u.base) return SFX.play('deny');
    if (n === 0) n = Math.floor(S.money / u.cost);
    const cost = u.cost * n;
    if (n <= 0 || S.money < cost) return SFX.play('deny');
    S.money -= cost; S.units[k] += n; SFX.play('buy');
  }
  function upgrade(k) {
    const c = upCost(k);
    if (S.bld[k] >= BUILD[k].max || S.money < c) return SFX.play('deny');
    S.money -= c; S.bld[k]++; SFX.play('buy');
    if (k === 'base') { computeRange(); UI.toast(`군사기지 ${S.bld.base}단계! 사거리 ${range(S.bld.base)}°`, 'good', 'base'); }
  }
  function policy(k) {
    const p = POLICY[k], n = G.ownedCount(S), cost = p.cost(n);
    if ((S.cds[k] || 0) > S.played || S.money < cost) return SFX.play('deny');
    S.money -= cost; S.approval = Math.min(100, S.approval + p.gain);
    if (k === 'draft') { const m = 10 + 2 * n; S.units.inf += m; UI.toast(`징병으로 보병 ${m}명 입대. 국민들은 불만이에요.`, '', 'draft'); }
    if (p.cd) S.cds[k] = S.played + p.cd;
    SFX.play(k === 'draft' ? 'drum' : 'cheer');
    checkEnd();
  }
  const card = (o) => `<div class="card ${o.cls || ''}">${o.cnt ? `<span class="cnt">${o.cnt}</span>` : ''}${o.lv ? `<span class="lv">${o.lv}</span>` : ''}<img class="pic" src="${SK.icon(o.icon, 96)}" alt=""><h4>${o.title}</h4><div class="d">${o.desc}</div><div class="row">${o.btns}</div></div>`;
  const btn = (act, label, ok, cls = '') => `<button class="btn ${cls}" data-act="${act}" ${ok ? '' : 'disabled'}>${label}</button>`;
  function renderPanel(force) {
    if (!S) return;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
    let h = '';
    const m = S.money, n = G.ownedCount(S);
    if (tab === 'make') {
      h = '<div class="cards">' + Object.entries(UNITS).map(([k, u]) => {
        const lock = S.bld.base < u.base;
        return card({
          icon: u.icon, title: u.name, cnt: fmt(S.units[k]) + (k === 'inf' ? '명' : '대'), cls: lock ? 'locked' : '',
          desc: lock ? `군사기지 ${u.base}단계 필요` : `${u.desc}<br>전투력 ${u.pow} · ₩${fmt(u.cost)}`,
          btns: lock ? '' : btn(`buy:${k}:1`, '+1', m >= u.cost) + btn(`buy:${k}:10`, '+10', m >= u.cost * 10) + btn(`buy:${k}:0`, '최대', m >= u.cost),
        });
      }).join('') + '</div>';
    } else if (tab === 'tax') {
      const per = owned().reduce((s, id) => s + cityTax(id), 0);
      const left = Math.max(0, bulkCd - performance.now());
      h = '<div class="cards">' + TAX.map((t, i) => card({
        icon: 'coin', title: `세율 ${t.name}`, cls: S.tax === i ? 'sel' : '', desc: t.desc + `<br>세금 1번당 지지율 -${t.drain}`,
        btns: btn(`rate:${i}`, S.tax === i ? '선택됨' : '선택', S.tax !== i),
      })).join('') + card({
        icon: 'taxman', title: '한 번에 걷기', desc: `모든 도시에서 70%씩<br>(10초에 한 번)`,
        btns: `<button class="btn cd-btn" data-act="bulk" ${left > 0 ? 'disabled' : ''} style="position:relative;overflow:hidden">모두 걷기${left > 0 ? `<b class="cdv" style="position:absolute;left:0;top:0;bottom:0;width:${(left / 100).toFixed(0)}%;background:rgba(20,15,10,.5)"></b>` : ''}</button>`,
      }) + `<div class="card"><img class="pic" src="${SK.icon('city', 96)}" alt=""><h4>세금 정보</h4><div class="d">도시 ${n}곳 한 바퀴 = ₩${fmt(per)}<br>지금까지 ₩${fmt(S.taxed)} 걷음<br>도시 가운데 <b>세금</b> 버튼을 눌러요</div></div></div>`;
    } else if (tab === 'build') {
      h = '<div class="cards">' + Object.entries(BUILD).map(([k, b]) => {
        const l = S.bld[k], max = l >= b.max, c = max ? 0 : upCost(k);
        return card({ icon: b.icon, title: b.name, lv: `${l}단계`, desc: b.desc(l) + (max ? '' : `<br>다음: ${b.desc(l + 1)}`), btns: max ? '<b>최고 단계</b>' : btn(`up:${k}`, `업그레이드 ₩${fmt(c)}`, m >= c) });
      }).join('') + '</div>';
    } else if (tab === 'policy') {
      h = '<div class="cards">' + Object.entries(POLICY).map(([k, p]) => {
        const c = p.cost(n), cd = Math.max(0, (S.cds[k] || 0) - S.played);
        return card({ icon: p.icon, title: p.name, desc: p.desc + (c ? `<br>비용 ₩${fmt(c)}` : '') + (p.cd ? `<br>대기 ${p.cd}초` : ''), btns: btn(`pol:${k}`, cd > 0 ? `${Math.ceil(cd)}초 후` : '실행', cd <= 0 && m >= c) });
      }).join('') + '</div>';
    } else {
      const conquered = countries.filter((c) => c.cities.every((i) => S.owner[i] === K)).map((c) => c.name);
      const t = Math.floor(S.played);
      h = `<div class="info"><div class="col"><h4>${S.name}</h4><p>세계 통일 ${(G.progress(S) * 100).toFixed(1)}% (${n} / ${cities.length} 도시)<br>플레이 시간 ${Math.floor(t / 60)}분 ${t % 60}초<br>전투 ${S.wins}승 ${S.losses}패<br>사거리 ${range(S.bld.base)}°</p></div>
        <div class="col"><h4>군대</h4><p>${Object.entries(UNITS).map(([k, u]) => `${u.name} ${fmt(S.units[k])}`).join(' · ')}<br>총 전투력 ${fmt(power())}</p><h4>정복한 나라 (${conquered.length})</h4><p>${conquered.join(', ') || '아직 없음'}</p></div>
        <div class="col"><h4>업적 (${window.K_ACH.filter((a) => S.ach[a.id]).length} / ${window.K_ACH.length})</h4><div class="achs">${window.K_ACH.map((a) => `<span class="ach ${S.ach[a.id] ? 'on' : ''}" title="${a.desc} · ₩${fmt(a.reward)}"><img src="${SK.icon(S.ach[a.id] ? 'star' : 'starOff', 48)}" alt="">${a.name}<small>${a.desc}</small></span>`).join('')}</div></div>
        <div class="col"><h4>하는 법</h4><p>1. 내 도시 가운데 <b>세금</b> 버튼으로 돈을 모아요 (1초 쿨타임)<br>2. <b>생성</b> 탭에서 군대를 만들어요<br>3. 적 도시의 <b>전쟁하기</b> 버튼으로 도시를 뺏어요<br>4. 세금을 빠르게 연속으로 걷으면 <b>콤보</b>! 30콤보면 <b>피버 타임</b><br>5. 하늘에서 떨어지는 <b>보급 상자</b>를 눌러 보세요<br>6. 돈이 많으면 <b>한류</b>로 싸우지 않고 도시를 얻을 수 있어요<br>7. 지지율이 0%가 되면 <b>탄핵</b>! 전 세계를 통일하면 승리!</p></div></div>`;
    }
    if (h !== lastPanel || force) { lastPanel = h; $('tabBody').innerHTML = h; }
  }

  // ───────── 지도 그리기 ─────────
  G.draw = () => {
    if (!S) return;
    const d = dpr(), v = map.view;
    if (dirtyMap || (SK.wobble && G._lastFrame !== SK.frame)) {
      G._lastFrame = SK.frame; dirtyMap = false;
      map.drawBase($('mapBase').getContext('2d'), d);
    }
    const g = $('mapTop').getContext('2d'), W = map.W, H = map.H, now = performance.now();
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, W, H);
    buttons = [];
    const s = v.s, big = s >= 13;
    const list = [];
    for (const c of cities) {
      const [x, y] = map.toScreen(c.x, c.y);
      if (x < -80 || y < -60 || x > W + 80 || y > H + 60) continue;
      list.push([c, x, y]);
    }
    list.sort((a, b) => a[2] - b[2]);
    for (const [c, x, y] of list) {
      const mine = S.owner[c.id] === K;
      if (!big) {
        const r = c.capital ? 4 : 3;
        g.fillStyle = mine ? '#b8302a' : '#3a2e26';
        g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
        g.strokeStyle = '#fbf5e6'; g.lineWidth = 1.2; g.stroke();
        if (s > 7 && c.capital) SK.text(g, c.name, x, y - 11, { size: 12, color: '#2a2420', stroke: 'rgba(255,250,235,.8)', strokeW: 3, seed: c.id });
        continue;
      }
      const bs = Math.min(15, s * 0.45);
      SK.building(g, x, y - 13, bs, { fill: mine ? '#f2c8b8' : '#e9dcc0', capital: c.capital, seed: c.id * 7 });
      SK.text(g, c.name, x, y + 22, { size: 14, color: '#2a2420', stroke: 'rgba(255,250,235,.85)', strokeW: 3, seed: c.id });
      if (mine) {
        const bw = 56, bh = 22, bx = x - bw / 2, by = y - bh / 2;
        SK.rect(g, bx, by, bw, bh, { fill: '#fff1b8', w: 1.8, j: 0.9, passes: 1, seed: c.id * 3 });
        SK.coin(g, bx + 11, y, 6.5, { seed: c.id });
        SK.text(g, '세금', bx + 35, y + 1, { size: 15, seed: c.id + 1 });
        const left = taxCd[c.id] - now;
        if (left > 0) { g.fillStyle = 'rgba(20,15,10,.5)'; g.fillRect(bx + 1, by + 1, (bw - 2) * (left / 1000), bh - 2); }
        buttons.push({ x: bx, y: by, w: bw, h: bh, act: 'tax', id: c.id });
      } else {
        const ok = inRange[c.id];
        const bw = ok ? 72 : 66, bh = 22, bx = x - bw / 2, by = y - bh / 2;
        g.globalAlpha = ok ? 1 : 0.6;
        SK.rect(g, bx, by, bw, bh, { fill: ok ? '#f4a596' : '#d6cdbd', w: 1.8, j: 0.9, passes: 1, seed: c.id * 3 });
        if (ok) { SK.swords(g, bx + 11, y, 5.5); SK.text(g, '전쟁하기', bx + 43, y + 1, { size: 14, seed: c.id + 2 }); }
        else SK.text(g, '사거리 밖', x, y + 1, { size: 13, seed: c.id + 2, color: '#5a4a3a' });
        g.globalAlpha = 1;
        buttons.push({ x: bx, y: by, w: bw, h: bh, act: 'war', id: c.id });
      }
    }
    // 반격 경보
    if (pending) {
      const c = cities[pending.target], [x, y] = map.toScreen(c.x, c.y), p = (now / 600) % 1;
      g.strokeStyle = `rgba(200,40,30,${1 - p})`; g.lineWidth = 3;
      g.beginPath(); g.arc(x, y, 14 + p * 30, 0, 7); g.stroke();
      SK.text(g, `${Math.ceil(pending.at - S.played)}`, x + 36, y - 18, { size: 22, color: '#c8282a', stroke: '#fff', strokeW: 4 });
    }
    // 떠오르는 돈
    for (const f of floats) {
      const c = cities[f.id], [x, y] = map.toScreen(c.x, c.y);
      g.globalAlpha = Math.max(0, 1 - f.t / 1.2);
      SK.text(g, f.text, x + 18, y - 22 - f.t * 34, { size: f.big ? 28 : 18, color: f.big ? '#d0302a' : '#b07a00', stroke: '#fffbe8', strokeW: 4, seed: 9 });
      g.globalAlpha = 1;
    }
    // 튀는 동전
    for (const q of parts) {
      const [bx, by] = q.id != null ? map.toScreen(cities[q.id].x, cities[q.id].y) : map.toScreen(q.wx, q.wy);
      const x = bx + q.x, y = by + q.y;
      g.globalAlpha = Math.max(0, 1 - q.t);
      g.fillStyle = '#f0c53e'; g.strokeStyle = '#8a6410'; g.lineWidth = 1.3;
      g.beginPath(); g.ellipse(x, y, 4.5 * Math.abs(Math.cos(q.t * 9)) + 1, 4.5, 0, 0, 7); g.fill(); g.stroke();
    }
    g.globalAlpha = 1;
    // 보급 상자
    if (crate) {
      const age = S.played - crate.born, p = Math.min(1, age / 2.5);
      let [x, y] = map.toScreen(crate.x, crate.y);
      y -= (1 - p) * 140;
      const blink = age > 20 && Math.floor(now / 200) % 2;
      if (!blink) {
        if (p < 1) {
          SK.ellipse(g, x, y - 46, 24, 14, { fill: '#e8483c', w: 1.6, passes: 1, seed: 71 });
          g.fillStyle = '#fbf5e6'; g.fillRect(x - 6, y - 58, 12, 12);
          [-20, -7, 7, 20].forEach((dx, i) => SK.line(g, x + dx, y - 40, x + dx * 0.3, y - 12, { w: 1, passes: 1, seed: 72 + i }));
        } else {
          const pr = (now / 700) % 1;
          g.strokeStyle = `rgba(255,200,40,${1 - pr})`; g.lineWidth = 3;
          g.beginPath(); g.arc(x, y - 2, 16 + pr * 22, 0, 7); g.stroke();
        }
        SK.rect(g, x - 13, y - 13, 26, 22, { fill: '#b5874e', w: 1.8, passes: 1, seed: 75, hatch: { gap: 5, color: 'rgba(0,0,0,.15)' } });
        SK.line(g, x - 13, y - 2, x + 13, y - 2, { w: 1.4, passes: 1, seed: 76 });
        SK.line(g, x, y - 13, x, y + 9, { w: 1.4, passes: 1, seed: 77 });
        SK.star(g, x, y - 2, 5, { seed: 78 });
      }
      buttons.push({ x: x - 22, y: y - 22, w: 44, h: 40, act: 'crate' });
    }
    // 콤보 / 피버
    const fev = fever > now;
    if (fev) {
      const a = 0.35 + 0.25 * Math.sin(now / 90);
      g.strokeStyle = `rgba(255,190,30,${a})`; g.lineWidth = 14; g.strokeRect(0, 0, W, H);
      SK.text(g, `피버 타임! 세금 x2  ${Math.ceil((fever - now) / 1000)}`, W / 2, 30, { size: 30, color: '#d0302a', stroke: '#fff6c0', strokeW: 6, angle: Math.sin(now / 150) * 0.03 });
    }
    if (combo >= 3 && now - lastHit < 1600) {
      const pop = Math.max(0, 1 - (now - lastHit) / 180), y0 = fev ? 68 : 34;
      SK.text(g, `${combo} 콤보!`, W / 2, y0, { size: 26 + pop * 10 + Math.min(combo, 50) * 0.2, color: combo >= 30 ? '#d0302a' : '#2a2420', stroke: '#fffbe8', strokeW: 5, seed: combo });
      const left = 1 - (now - lastHit) / 1600;
      g.fillStyle = 'rgba(42,36,32,.25)'; g.fillRect(W / 2 - 50, y0 + 18, 100, 5);
      g.fillStyle = combo >= 30 ? '#d0302a' : '#e0a020'; g.fillRect(W / 2 - 50, y0 + 18, 100 * left, 5);
    } else if (combo && now - lastHit >= 1600) combo = 0;
  };

  // ───────── 지도 조작 ─────────
  function hit(x, y) {
    for (let i = buttons.length - 1; i >= 0; i--) { const b = buttons[i]; if (x >= b.x - 2 && x <= b.x + b.w + 2 && y >= b.y - 2 && y <= b.y + b.h + 2) return b; }
    return null;
  }
  function bindMap() {
    const cv = $('mapTop'), pts = new Map();
    let drag = null, pinch = null;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', (e) => {
      SFX.unlock();
      cv.setPointerCapture(e.pointerId);
      const [x, y] = pos(e); pts.set(e.pointerId, [x, y]);
      if (pts.size === 1) drag = { x, y, cx: map.view.cx, cy: map.view.cy, moved: false };
      if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: map.view.s }; drag = null; }
    });
    cv.addEventListener('pointermove', (e) => {
      const [x, y] = pos(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, [x, y]);
      if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const f = (pinch.s * d) / pinch.d / map.view.s;
        map.zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, f); dirtyMap = true;
        return;
      }
      if (drag && pts.size === 1) {
        const dx = x - drag.x, dy = y - drag.y;
        if (Math.hypot(dx, dy) > 6) drag.moved = true;
        if (drag.moved) {
          cv.classList.add('drag');
          map.view.cx = drag.cx - dx / map.view.s; map.view.cy = drag.cy - dy / map.view.s; map.clamp(); dirtyMap = true;
          $('tip').style.display = 'none';
        }
        return;
      }
      const b = hit(x, y);
      cv.classList.toggle('hand', !!b);
      showTip(b, x, y);
    });
    const up = (e) => {
      const [x, y] = pos(e);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      cv.classList.remove('drag');
      if (drag && !drag.moved && pts.size === 0) click(x, y);
      if (pts.size === 0) drag = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); drag = null; pinch = null; });
    cv.addEventListener('pointerleave', () => { $('tip').style.display = 'none'; });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = pos(e); map.zoomAt(x, y, Math.exp(-e.deltaY * 0.0015)); dirtyMap = true; }, { passive: false });
    $('zoomIn').onclick = () => { SFX.play('click'); map.zoomAt(map.W / 2, map.H / 2, 1.5); dirtyMap = true; };
    $('zoomOut').onclick = () => { SFX.play('click'); map.zoomAt(map.W / 2, map.H / 2, 1 / 1.5); dirtyMap = true; };
    $('zoomHome').onclick = () => { SFX.play('click'); G.home(); };
  }
  function click(x, y) {
    if (!S) return;
    const b = hit(x, y);
    if (b) { if (b.act === 'tax') collect(b.id); else if (b.act === 'crate') openCrate(); else openWar(b.id); return; }
    if (map.view.s < 13) { map.zoomAt(x, y, 2); dirtyMap = true; }
  }
  function showTip(b, x, y) {
    const tip = $('tip');
    if (!b || !S) { tip.style.display = 'none'; return; }
    if (b.act === 'crate') { tip.innerHTML = '<b>보급 상자</b><br>눌러서 열어 보세요!'; tip.style.display = 'block'; tip.style.left = x + 16 + 'px'; tip.style.top = y + 16 + 'px'; return; }
    const c = cities[b.id], o = countries[S.owner[c.id]];
    tip.innerHTML = b.act === 'tax'
      ? `<b>${c.name}</b> (우리 땅)<br>세금 ₩${fmt(cityTax(c.id))} / 1번`
      : `<b>${o.name} ${c.name}</b>${c.capital && c.country === S.owner[c.id] ? (tierOf(S.owner[c.id]) >= 4 ? ' (보스!)' : ' (수도)') : ''}<br>방어력 ${fmt(defOf(c.id))} · 세금 ₩${fmt(cityTax(c.id))}<br>${inRange[c.id] ? '공격 가능' : '사거리 밖'}`;
    tip.style.display = 'block';
    const W = map.W;
    tip.style.left = Math.min(W - 250, x + 16) + 'px'; tip.style.top = y + 16 + 'px';
  }
})();
