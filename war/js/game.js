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
  UI.fmt = fmt; UI.J = J;

  // ───────── 규칙 ─────────
  const SAVE_KEY = 'zollaWar.saves.v1';
  const UNITS = {
    inf: { name: '보병', icon: 'infantry', cost: 10, pow: 1, base: 0, desc: '총을 든 용감한 졸라맨' },
    tank: { name: '탱크', icon: 'tank', cost: 80, pow: 10, base: 1, desc: '튼튼한 강철 전차' },
    art: { name: '대포', icon: 'artillery', cost: 180, pow: 24, base: 2, desc: '멀리서 쾅! 쾅!' },
    jet: { name: '전투기', icon: 'jet', cost: 450, pow: 64, base: 3, desc: '하늘을 지배한다' },
  };
  const range = (l) => 9 + 5 * l;
  const BUILD = {
    factory: { name: '공장', icon: 'factory', base: 200, mul: 1.9, max: 10, desc: (l) => `세금 수입 +${25 * l}%` },
    base: { name: '군사기지', icon: 'base', base: 250, mul: 2.1, max: 8, desc: (l) => `공격 사거리 ${range(l)}° / 새 무기` },
    fort: { name: '요새', icon: 'fort', base: 150, mul: 1.8, max: 8, desc: (l) => `적 반격 방어 +${30 * l}%` },
    hospital: { name: '병원', icon: 'hospital', base: 180, mul: 1.9, max: 8, desc: (l) => `지지율 회복 ${(regenOf(l) * 60).toFixed(0)}/분` },
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
    festival: { name: '축제 개최', icon: 'festival', cost: (n) => 250 + 30 * n, gain: 15, cd: 60, desc: '지지율 +15' },
    speech: { name: '대국민 연설', icon: 'speech', cost: () => 0, gain: 3, cd: 40, desc: '공짜 · 지지율 +3' },
    draft: { name: '징병', icon: 'draft', cost: () => 0, gain: -4, cd: 30, desc: '보병 무료 입대 · 지지율 -4' },
  };

  const G = (window.GAME = { UNITS, BUILD, TAX });
  let map, K, S = null, cities, countries;
  let taxCd = [], floats = [], buttons = [], inRange = [], pending = null, tab = 'make';
  let lastPanel = '', lastHud = '', dirtyMap = true, bulkCd = 0;
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);

  G.state = () => S; // 디버그용
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
    map.recolor((id) => S.owner[id]);
    computeRange();
    UI.show('scr-game');
    G.resize();
    if (S.view && S.view.s) { Object.assign(map.view, S.view); map.clamp(); } else G.home();
    lastPanel = ''; renderPanel(true); renderHud(true);
    SFX.song('game');
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
    const v = cityTax(id) * (auto === 'bulk' ? 0.7 : 1);
    S.money += v; S.taxed += v;
    S.approval -= TAX[S.tax].drain * (auto ? 0.5 : 1);
    floats.push({ id, text: '+' + fmt(v), t: 0 });
    if (!auto) SFX.play('coin');
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
    const c = cities[id], en = countries[S.owner[id]];
    if (!inRange[id]) {
      SFX.play('deny');
      UI.toast(`${c.name}${batchim(c.name) ? '은' : '는'} 사거리 밖이에요. <b>시설</b> 탭에서 군사기지를 올리세요.`, 'bad', 'base');
      return;
    }
    const P0 = power(), D = defOf(id);
    if (P0 <= 0) { SFX.play('deny'); UI.toast('군대가 없어요! <b>생성</b> 탭에서 병사를 만드세요.', 'bad', 'infantry'); return; }
    let f = [0.25, 0.5, 0.75, 1].find((x) => chanceOf(P0 * x, D) >= 0.8) || 1;
    SFX.play('drum');
    const body = () => {
      const P = Math.round(P0 * f), ch = chanceOf(P, D);
      return `<h2 class="wob">${en.name} · ${c.name} 공격</h2>
        <div class="vs"><span>${SK.img('power', 26)} 투입 전투력 <b>${fmt(P)}</b></span><span>${SK.img('fort', 26)} 적 방어력 <b>${fmt(D)}</b></span></div>
        <div class="force">투입 병력: ${[0.25, 0.5, 0.75, 1].map((x) => `<button class="btn small ${x === f ? 'sel' : ''}" data-f="${x}">${x * 100}%</button>`).join('')}</div>
        <div class="chance"><i style="width:${(ch * 100).toFixed(0)}%"></i><span>예상 승률 ${(ch * 100).toFixed(0)}%</span></div>
        <p style="font-size:16px;font-weight:400">${c.capital ? '<b>수도</b>를 함락하면 그 나라의 다른 도시들 방어력이 크게 떨어져요. ' : ''}지면 병력을 잃지만 적 방어력도 깎여요.</p>
        <div class="acts"><button class="btn" data-a="no"><span class="wob">취소</span></button><button class="btn red big" data-a="go"><span class="wob">공격 개시!</span></button></div>`;
    };
    const bind = (card) => {
      card.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { SFX.play('click'); f = +b.dataset.f; UI.modal(body(), bind); }));
      card.querySelector('[data-a=no]').onclick = () => { SFX.play('click'); UI.close(); };
      card.querySelector('[data-a=go]').onclick = () => fight(id, f);
    };
    UI.modal(body(), bind);
  }

  function fight(id, f) {
    const c = cities[id], enIdx = S.owner[id], en = countries[enIdx];
    const P = power() * f, D = defOf(id), ch = chanceOf(P, D);
    const win = Math.random() < ch;
    const loss = win ? Math.min(0.5, Math.max(0.03, (0.5 * D) / (P + D))) : Math.min(0.8, Math.max(0.35, 0.35 + (0.4 * D) / (P + D)));
    const sent = {}, lost = {};
    Object.keys(UNITS).forEach((k) => { sent[k] = Math.round(S.units[k] * f); lost[k] = Math.min(sent[k], Math.floor(sent[k] * loss + Math.random())); });
    UI.modal(`<h2 class="wob">${c.name} 전투</h2><canvas class="battle" id="battleCv"></canvas><p class="hint" style="font-size:15px">화면을 누르면 건너뛰어요</p><div class="acts" id="battleActs"></div>`);
    ART.battle($('battleCv'), {
      ourPower: P, enemyPower: D, win, ourLoss: loss, enemyLoss: win ? 0.75 : 0.35, units: sent,
      cityName: `${en.name} ${c.name}`, fast: G.settings.fast, seed: id * 31 + S.wins,
    }).then(() => {
      Object.keys(UNITS).forEach((k) => (S.units[k] -= lost[k]));
      const lostTxt = Object.keys(UNITS).filter((k) => lost[k]).map((k) => `${UNITS[k].name} ${fmt(lost[k])}`).join(', ') || '없음';
      let msg;
      if (win) {
        S.owner[id] = K; delete S.dmg[id]; S.wins++;
        S.approval = Math.min(100, S.approval + (c.capital ? 6 : 3));
        const allMine = en.cities.every((ci) => S.owner[ci] === K);
        msg = `<p><b>${c.name}</b>${batchim(c.name) ? '을' : '를'} 점령했습니다! 지지율 +${c.capital ? 6 : 3}</p>${allMine ? `<p><b>${en.name}</b> 전체를 정복했습니다! 지지율 +2</p>` : ''}`;
        if (allMine) S.approval = Math.min(100, S.approval + 2);
        SFX.play('win');
        map.recolor((i) => S.owner[i]); computeRange(); dirtyMap = true;
      } else {
        const prev = S.dmg[id];
        const cur = prev ? Math.max(0, prev.v - (S.played - prev.t) * baseDef(id) * 0.01) : 0;
        S.dmg[id] = { v: cur + P * 0.6, t: S.played };
        S.losses++; S.approval -= 5;
        msg = `<p>공격에 실패했습니다... 지지율 -5</p><p style="font-size:16px">적 방어력이 ${fmt(D)}에서 ${fmt(defOf(id))}까지 줄었어요. 다시 도전하세요!</p>`;
        SFX.play('lose');
      }
      $('battleActs').insertAdjacentHTML('beforebegin', `${msg}<p style="font-size:16px">잃은 병력: ${lostTxt}</p>`);
      $('battleActs').innerHTML = '<button class="btn big" id="battleOk"><span class="wob">확인</span></button>';
      SK.wob($('battleOk').firstChild);
      $('battleOk').onclick = () => { SFX.play('click'); UI.close(); G.save(); checkEnd(); };
    });
  }

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
      if (S.approval < 20 && !S.warned) { S.warned = true; UI.toast('국회에서 <b>탄핵 소추안</b>이 논의되고 있습니다! 지지율을 올리세요!', 'bad', 'alarm'); SFX.play('alarm'); }
      if (S.approval > 30) S.warned = false;
      checkEnd();
      if (!S) return;
    }
    floats.forEach((f) => (f.t += dt)); floats = floats.filter((f) => f.t < 1.2);
    hudT += dt; saveT += dt;
    if (hudT > 0.15) { hudT = 0; renderHud(); renderPanel(); }
    if (saveT > 8) { saveT = 0; G.save(); }
  };

  // ───────── HUD ─────────
  function renderHud(force) {
    if (!S) return;
    const ap = Math.max(0, S.approval);
    const d = new Date(2048, 2, 1 + Math.floor(S.played / 6));
    const key = [Math.floor(S.money), power(), Math.ceil(ap), G.ownedCount(S), d.getDate()].join('|');
    if (key === lastHud && !force) return;
    lastHud = key;
    $('hudMoney').innerHTML = `${SK.img('coin', 30)}${fmt(S.money)}`;
    $('hudPower').innerHTML = `${SK.img('power', 30)}${fmt(power())}`;
    const el = $('hudApproval');
    el.classList.toggle('low', ap < 20);
    el.innerHTML = `${SK.img('approval', 30)}<span class="bar"><i style="width:${ap}%"></i></span>${Math.ceil(ap)}%`;
    $('hudCities').innerHTML = `${SK.img('city', 30)}${G.ownedCount(S)} / ${cities.length}`;
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
        <div class="col"><h4>하는 법</h4><p>1. 내 도시 가운데 <b>세금</b> 버튼으로 돈을 모아요 (1초 쿨타임)<br>2. <b>생성</b> 탭에서 군대를 만들어요<br>3. 적 도시의 <b>전쟁하기</b> 버튼으로 도시를 뺏어요<br>4. 세금을 많이 걷으면 지지율이 떨어져요. 0%가 되면 <b>탄핵</b>!<br>5. 전 세계를 대한민국으로 통일하면 승리!</p></div></div>`;
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
      SK.text(g, f.text, x + 18, y - 22 - f.t * 34, { size: 18, color: '#b07a00', stroke: '#fffbe8', strokeW: 4, seed: 9 });
      g.globalAlpha = 1;
    }
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
    if (b) { if (b.act === 'tax') collect(b.id); else openWar(b.id); return; }
    if (map.view.s < 13) { map.zoomAt(x, y, 2); dirtyMap = true; }
  }
  function showTip(b, x, y) {
    const tip = $('tip');
    if (!b || !S) { tip.style.display = 'none'; return; }
    const c = cities[b.id], o = countries[S.owner[c.id]];
    tip.innerHTML = b.act === 'tax'
      ? `<b>${c.name}</b> (우리 땅)<br>세금 ₩${fmt(cityTax(c.id))} / 1번`
      : `<b>${o.name} ${c.name}</b>${c.capital && c.country === S.owner[c.id] ? ' (수도)' : ''}<br>방어력 ${fmt(defOf(c.id))} · 세금 ₩${fmt(cityTax(c.id))}<br>${inRange[c.id] ? '공격 가능' : '사거리 밖'}`;
    tip.style.display = 'block';
    const W = map.W;
    tip.style.left = Math.min(W - 250, x + 16) + 'px'; tip.style.top = y + 16 + 'px';
  }
})();
