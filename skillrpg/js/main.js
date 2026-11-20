// ───────── 상태 · UI ─────────
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const SAVE_KEY = 'srpg_save_v1';
const NO_EQUIP = () => ({ face: null, body: null, head: null, weapon: null, acc: null });
const DEFAULT = () => ({ gems: 100000, skills: { attack: 1, critical: 1, fireball: 1 }, gear: {}, equip: NO_EQUIP(), main: 'attack', lv: 1, view: 'char', tab: 'attack', slot: 'face', log: [], menu: true });
let S = (() => { try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); if (d && d.skills) return Object.assign(DEFAULT(), d); } catch (e) {} return DEFAULT(); })();
S.skills.attack = S.skills.attack || 1; S.skills.critical = S.skills.critical || 1;
if (!S.skills[S.main]) S.main = 'attack';
S.equip = Object.assign(NO_EQUIP(), S.equip);
Object.keys(S.equip).forEach(k => { const g = GEAR_BY_ID[S.equip[k]]; if (!SLOTS.includes(k)) delete S.equip[k]; else if (!g || g.slot !== k) S.equip[k] = null; });
if (!SLOTS.includes(S.slot)) S.slot = 'face';
if (!Array.isArray(S.log)) S.log = [];
let saveT = 0;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }, 150); };

let sel = null;            // 왼쪽 상세 정보 { t: 'skill' | 'gear', id }
const DAY_LIMIT = 3;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
function dailyLeft(key) { if (!S.daily || S.daily.day !== today()) S.daily = { day: today(), used: {} }; return Math.max(0, DAY_LIMIT - (S.daily.used[key] || 0)); }
function useDaily(key) { dailyLeft(key); S.daily.used[key] = (S.daily.used[key] || 0) + 1; }
const FUSE_COST = [200, 500, 1500, 4000, 10000];
let fuseTier = 0, fuseSel = [];
let cd = 0, cdMax = 1, autoGap = 0;

function stats() {
  const v = slot => { const id = S.equip[slot]; return id ? gearValue(GEAR_BY_ID[id], S.gear[id] || 1) : 0; };
  return { crit: Math.min(100, 5 + v('head')), atk: v('body'), critDmg: v('weapon'), cdr: Math.min(60, v('acc')), gem: v('face') };
}
const STAT_LIST = [['atk', '공격력', '+', '%'], ['crit', '치명타', '', '%'], ['critDmg', '치명타 피해', '+', '%'], ['cdr', '쿨타임 감소', '', '%'], ['gem', '보석 획득', '+', '%']];
const statsHTML = () => { const st = stats(); return STAT_LIST.map(([k, n, p, u]) => `<div><span>${n}</span><b>${p}${Math.round(st[k])}${u}</b></div>`).join(''); };
const gearObj = () => Object.fromEntries(SLOTS.map(s => [s, GEAR_BY_ID[S.equip[s]] || null]));
const ownCount = list => list.filter(x => (x.slot ? S.gear : S.skills)[x.id]).length;
const isMobile = () => matchMedia('(max-width: 920px)').matches;

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); }
function setGems(n) {
  S.gems = Math.max(0, n); $('#gems').textContent = S.gems.toLocaleString(); save();
  const g = $('.gem-pill'); g.classList.remove('pulse'); void g.offsetWidth; g.classList.add('pulse');
  if (!sel) renderDetail();
  if (S.view === 'home') renderHome();
}
function addLog(icon, html, r = 0) {
  const d = new Date();
  S.log.unshift({ t: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, icon, html, r });
  if (S.log.length > 80) S.log.length = 80;
  save();
}
function logHTML(list) {
  if (!list.length) return '<li class="empty">아직 기록이 없어요. 슬라임을 잡거나 상자를 열어 보세요!</li>';
  return list.map(e => `<li class="r${e.r}"><time>${e.t}</time><span class="li-ic">${e.icon}</span><span>${e.html}</span></li>`).join('');
}

// ── 캐릭터 그림 (미리보기 · 사이드바 · 홈) ──
function refreshPlayer() {
  const g = gearObj();
  E.player.sprite = buildPlayerSprite(g);
  E.gear = { top: Math.max(-1, ...SLOTS.map(s => g[s] ? g[s].r : -1)) };
  ['#preview', '#prof-cv', '#home-cv'].forEach(id => { const c = $(id).getContext('2d'); c.imageSmoothingEnabled = false; c.clearRect(0, 0, AV_W, AV_H); c.drawImage(E.player.sprite, 0, 0); });
  $('#prof-sub').textContent = `슬라임 Lv.${S.lv} 사냥 중`;
}

// ── 왼쪽 상세 정보 ──
function renderDetail() {
  const d = $('#detail');
  let h = '';
  if (sel && sel.t === 'gear') {
    const g = GEAR_BY_ID[sel.id], lv = S.gear[g.id], on = S.equip[g.slot] === g.id;
    h = `<div class="d-title r${g.r}"><b>${lv ? g.name : '???'}</b><span class="rt">${RAR[g.r].name}</span></div>
      <div class="d-sub">${SLOT_NAME[g.slot]}${lv ? ' · Lv.' + lv : ''}</div>
      <div class="d-lbl">장비 보너스</div><div><span class="bchip">${g.stat} +${gearValue(g, lv || 1)}${g.unit}</span></div>
      ${lv ? `<div class="d-btns"><button class="btn ${on ? 'ghost' : 'primary'}" id="d-act" type="button">${on ? '해제하기' : '착용하기'}</button></div>` : '<p class="d-desc">장비 뽑기에서 얻을 수 있어요.</p>'}`;
  } else if (sel && sel.t === 'skill') {
    const sk = SKILL_BY_ID[sel.id], lv = S.skills[sk.id], on = S.main === sk.id;
    const per = Math.round(sk.dmg * (1 + 0.15 * ((lv || 1) - 1)));
    h = `<div class="d-title r${sk.r}"><b>${lv ? sk.name : '???'}</b><span class="rt">${rarName(sk)}</span></div>
      <p class="d-desc">${lv ? sk.desc : '스킬 상자에서 얻을 수 있어요.'}</p>
      <div class="d-kv"><span>피해</span><b>${per}${sk.hits > 1 ? ' × ' + sk.hits : ''}</b><span>쿨타임</span><b>${sk.cd}초</b>${lv ? `<span>레벨</span><b>Lv.${lv}</b>` : ''}</div>
      <div class="d-sub">모은 스킬 ${ownCount(GACHA_SKILLS)}/${GACHA_SKILLS.length}</div>
      ${lv ? `<div class="d-btns"><button class="btn ${on ? 'on' : 'primary'}" id="d-act" type="button">${on ? '장착 중' : '장착하기'}</button><button class="btn ghost" id="d-test" type="button">공격해 보기</button></div>` : ''}`;
  } else {
    h = `<div class="d-title"><b>모험가</b><span class="rt lvl">슬라임 Lv.${S.lv} 사냥 중</span></div>
      <div class="d-gem">보유 보석 <i class="gem"></i><b>${S.gems.toLocaleString()}</b></div>
      <p class="d-desc">스킬과 장비를 모아 나만의 모험가를 꾸며 보세요!</p>`;
  }
  h += `<div class="d-lbl">능력치</div><div class="stats">${statsHTML()}</div><div class="d-lbl">착용 중</div><div class="eq" id="eq"></div>`;
  d.innerHTML = h;
  const eq = d.querySelector('#eq');
  SLOTS.forEach(slot => {
    const g = GEAR_BY_ID[S.equip[slot]], b = document.createElement('button');
    b.type = 'button'; b.className = 'eqrow' + (g ? ' r' + g.r : ' empty');
    b.innerHTML = `<span class="ei"></span><span><small>${SLOT_NAME[slot]}</small><b>${g ? g.name : '없음'}</b></span>${g ? `<em>${g.stat} +${gearValue(g, S.gear[g.id])}${g.unit}</em>` : ''}`;
    if (g) b.querySelector('.ei').appendChild(fitIcon(gearIcon(g), 40));
    b.addEventListener('click', () => { SFX.click(); S.slot = slot; sel = g ? { t: 'gear', id: g.id } : null; go('closet'); });
    eq.appendChild(b);
  });
  const act = d.querySelector('#d-act'), test = d.querySelector('#d-test');
  if (act && sel.t === 'gear') act.addEventListener('click', () => toggleGear(GEAR_BY_ID[sel.id]));
  if (act && sel.t === 'skill') act.addEventListener('click', () => equipSkill(sel.id));
  if (test) test.addEventListener('click', () => { equipSkill(sel.id, true); go('attack'); attack(); });
}

// ── 장착 ──
function toggleGear(g) {
  const on = S.equip[g.slot] === g.id;
  S.equip[g.slot] = on ? null : g.id; save();
  on ? SFX.click() : SFX.equip();
  toast(on ? `${g.name} 해제` : `${g.name} 착용! ${g.stat} +${gearValue(g, S.gear[g.id])}${g.unit}`);
  if (!on) E.burst(E.player.x, GROUND - 24, 30, ['#ffffff', RAR[g.r].color, RAR[g.r].dark], { spd: 50, life: 0.8, r: 8 });
  renderAll();
}
function equipSkill(id, quiet) {
  if (S.main === id) return;
  S.main = id; cd = 0; save();
  if (!quiet) { SFX.equip(); toast(`${SKILL_BY_ID[id].name} 장착!`); }
  renderAll();
}

// ── 카드 ──
function card(cls, cv, name, sub, tag, box = 72) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'icard ' + cls;
  b.innerHTML = `<span class="ic"></span><span class="nm">${name}</span><span class="rr">${sub}</span>${tag ? `<span class="tag">${tag}</span>` : ''}`;
  b.querySelector('.ic').appendChild(fitIcon(cv, box, box));
  return b;
}
function gearCard(g, onClick, box) {
  const lv = S.gear[g.id], on = S.equip[g.slot] === g.id;
  const b = card(`r${g.r}${lv ? '' : ' locked'}${on ? ' on' : ''}${sel && sel.id === g.id ? ' sel' : ''}`, gearIcon(g), lv ? g.name : '???', lv ? `${RAR[g.r].name} · Lv.${lv}` : RAR[g.r].name, on ? '장착중' : '', box);
  b.addEventListener('click', onClick);
  return b;
}
function skillCard(s, onClick, box) {
  const lv = S.skills[s.id], on = S.main === s.id;
  const b = card(`r${s.r}${lv ? '' : ' locked'}${on ? ' on' : ''}${sel && sel.id === s.id ? ' sel' : ''}`, skillIcon(s.id), lv ? s.name : '???', lv ? `${rarName(s)} · Lv.${lv}` : RAR[s.r].name, on ? '장착 중' : '', box);
  b.addEventListener('click', onClick);
  return b;
}

// ── 내 옷장 ──
function renderCloset() {
  $$('#subtabs button').forEach(b => b.classList.toggle('on', b.dataset.slot === S.slot));
  const grid = $('#closet-grid'); grid.innerHTML = '';
  GEAR.filter(g => g.slot === S.slot).forEach(g => grid.appendChild(gearCard(g, () => {
    sel = { t: 'gear', id: g.id };
    if (!S.gear[g.id]) { SFX.error(); renderAll(); return; }
    if (S.equip[g.slot] !== g.id) toggleGear(g); else { SFX.click(); renderAll(); }
  })));
}

// ── 공격 테스트 ──
function renderAttack() {
  const sk = SKILL_BY_ID[S.main];
  const chip = $('#atk-chip'); chip.className = 'chip r' + sk.r; chip.innerHTML = `<i></i>${sk.name}`;
  const grid = $('#skill-grid'); grid.innerHTML = '';
  SKILLS.forEach(s => grid.appendChild(skillCard(s, () => {
    sel = { t: 'skill', id: s.id };
    if (!S.skills[s.id]) { SFX.error(); renderAll(); return; }
    if (S.main !== s.id) equipSkill(s.id); else { SFX.click(); renderAll(); }
  }, 56)));
}
function showBanner(sk, sub) {
  const b = $('#banner');
  b.className = 'banner r' + (sub ? 4 : sk.r);
  b.innerHTML = `<small>${sub || rarName(sk)}</small>${sk.name}`;
  void b.offsetWidth; b.classList.add('show');
}
function startCd(sk) { cdMax = cd = Math.max(0.3, sk.cd * (1 - stats().cdr / 100)); }
function attack() {
  if (cd > 0 || E.player.busy) return;
  const sk = SKILL_BY_ID[S.main];
  startCd(sk); E.cast(sk, S.skills[sk.id] || 1); showBanner(sk);
}
function critical() {
  if (cd > 0 || E.player.busy) return;
  const main = SKILL_BY_ID[S.main];
  if (main.basic) { const sk = SKILL_BY_ID.critical; startCd(sk); E.cast(sk, S.skills.critical || 1); showBanner(sk); return; }
  startCd(main);
  E.critMode(3.6); E.flash('#fff3c0', 0.15, 0.6); SFX.clang();
  { const t = E.target(); critText(t.x, t.top - 20); }
  E.cast(main, S.skills[main.id] || 1);
  showBanner(main, '크리티컬');
}
E.onTick = dt => {
  if (cd > 0) cd = Math.max(0, cd - dt);
  const w = (cd > 0 ? cd / cdMax * 100 : 0).toFixed(1) + '%';
  $$('.abtn').forEach(b => { const f = b.firstElementChild; if (f.style.width !== w) f.style.width = w; b.classList.toggle('cool', cd > 0); });
  autoGap -= dt;
  if ($('#auto').checked && cd <= 0 && autoGap <= 0 && E.alive() && !E.G.frozen && !E.player.busy && S.view === 'char' && S.tab === 'attack') { autoGap = 0.4; attack(); }
};
E.onKill = (gems, lv) => {
  const got = Math.round(gems * (1 + stats().gem / 100));
  setGems(S.gems + got);
  addLog('🟢', `${lv % 5 === 0 ? '킹 슬라임' : '슬라임'} Lv.${lv} 처치 · 보석 +${got.toLocaleString()}`, lv % 5 === 0 ? 4 : 0);
};
E.onSlime = s => {
  $('#slime-name').innerHTML = `${s.king ? '👑 킹 ' : SLIME_COLORS[(s.lv - 1) % 6].name + ' '}슬라임 <b>Lv.${s.lv}</b>`;
  S.lv = s.lv; save();
  $('#prof-sub').textContent = `슬라임 Lv.${S.lv} 사냥 중`;
};
E.stats = stats;
E.startLevel = S.lv;

// ── 뽑기 ──
function renderBoxes(kind) {
  const wrap = $(kind === 'skill' ? '#skill-boxes' : '#gear-boxes');
  wrap.innerHTML = `<div class="limit-note">상자마다 하루 ${DAY_LIMIT}번 열 수 있어요 (10회 뽑기도 1번으로 세요)<button class="linkbtn" type="button">횟수 채우기 (테스트)</button></div>`;
  wrap.querySelector('.linkbtn').addEventListener('click', () => { S.daily = { day: today(), used: {} }; save(); SFX.coin(); renderBoxes('gear'); renderBoxes('skill'); toast('오늘 열 수 있는 횟수를 다시 채웠어요'); });
  const pool = kind === 'skill' ? GACHA_SKILLS : GEAR;
  BOXES.forEach(b => {
    const el = document.createElement('div');
    el.className = 'brow t' + b.tier;
    const [cv, c] = PX.mk(36, 26); drawChest(c, 18, 25, b.tier, { time: 0.1 });
    const bar = b.rates.map((r, i) => r ? `<i class="r${i}" style="width:${r}%"></i>` : '').join('');
    const rates = b.rates.map((r, i) => r ? `<span class="r${i}">${RAR[i].name}</span> ${r}%` : '').filter(Boolean).join(' · ');
    const name = kind === 'skill' ? b.name.replace('상자', '스킬 상자') : b.name.replace('상자', '장비 상자');
    const left = dailyLeft(kind + b.tier);
    el.innerHTML = `<div class="bimg"></div>
      <div class="binfo"><div class="bt"><b>${name}</b><span class="pill">모은 ${kind === 'skill' ? '스킬' : '장비'} ${ownCount(pool)}/${pool.length}</span></div><div class="bar">${bar}</div><div class="rates">${rates}</div><div class="daily${left ? '' : ' none'}">${left ? `오늘 ${left}번 남았어요 (${left}/${DAY_LIMIT})` : '오늘은 다 열었어요 · 내일 다시 열 수 있어요'}</div></div>
      <div class="bbtns"><button class="btn primary p1" type="button"${left ? '' : ' disabled'}>${kind === 'skill' ? '열기' : '뽑기'} <i class="gem"></i>${b.cost.toLocaleString()}</button><button class="btn outline p10" type="button"${left ? '' : ' disabled'}>10회 <i class="gem"></i>${(b.cost * 10).toLocaleString()}</button></div>`;
    cv.className = 'px-icon'; el.querySelector('.bimg').appendChild(cv);
    el.querySelector('.p1').addEventListener('click', () => pull(kind, b, 1));
    el.querySelector('.p10').addEventListener('click', () => pull(kind, b, 10));
    wrap.appendChild(el);
  });
}
function roll(rates) {
  let r = Math.random() * rates.reduce((a, b) => a + b, 0);
  for (let i = 0; i < rates.length; i++) { if (r < rates[i]) return i; r -= rates[i]; }
  return rates.findIndex(x => x > 0);
}
function pull(kind, box, count) {
  const cost = box.cost * count;
  if (!dailyLeft(kind + box.tier)) { SFX.error(); toast('오늘은 이 상자를 다 열었어요. 내일 다시 열 수 있어요'); return; }
  if (S.gems < cost) { SFX.error(); toast(`보석이 부족해요 (필요 ${cost.toLocaleString()})`); return; }
  useDaily(kind + box.tier);
  SFX.click();
  setGems(S.gems - cost);
  const results = [];
  for (let i = 0; i < count; i++) {
    const rar = roll(box.rates);
    const item = pick(kind === 'skill' ? GACHA_SKILLS.filter(s => s.r === rar) : GEAR.filter(g => g.r === rar));
    const store = kind === 'skill' ? S.skills : S.gear;
    const isNew = !store[item.id];
    store[item.id] = (store[item.id] || 0) + 1;
    if (isNew && kind === 'gear' && !S.equip[item.slot]) S.equip[item.slot] = item.id;
    results.push({ kind, item, rar, isNew, lv: store[item.id] });
  }
  const label = kind === 'skill' ? box.name.replace('상자', '스킬 상자') : box.name.replace('상자', '장비 상자');
  results.slice().reverse().forEach(r => addLog(kind === 'skill' ? '✨' : '🎁', `${label}에서 <b>${r.item.name}</b>(${RAR[r.rar].name}) ${r.isNew ? '획득!' : '레벨 업 → Lv.' + r.lv}`, r.rar));
  save();
  Gacha.play(box, results, kind === 'skill' ? '스킬' : '장비');
}
Gacha.onClose = () => renderAll();

// ── 장비 합성 ──
function renderFuse() {
  const t = fuseTier, owned = id => S.gear[id] || 0;
  const cnt = {}; fuseSel = fuseSel.filter(id => { cnt[id] = (cnt[id] || 0) + 1; return GEAR_BY_ID[id].r === t && cnt[id] <= owned(id); });
  const pills = $('#fuse-pills'); pills.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pill2 r' + i + (i === t ? ' on' : '');
    b.innerHTML = `<i></i>${RAR[i].name} → ${RAR[i + 1].name}`;
    b.addEventListener('click', () => { SFX.tab(); fuseTier = i; fuseSel = []; renderFuse(); });
    pills.appendChild(b);
  }
  const slots = $('#fuse-slots'); slots.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const id = fuseSel[i], b = document.createElement('button'); b.type = 'button';
    b.className = 'fslot' + (id ? ' r' + t + ' full' : '');
    if (id) { b.appendChild(fitIcon(gearIcon(GEAR_BY_ID[id]), 48)); b.addEventListener('click', () => { SFX.click(); fuseSel.splice(i, 1); renderFuse(); }); }
    slots.appendChild(b);
  }
  slots.insertAdjacentHTML('beforeend', `<span class="farrow">→</span><span class="fslot res r${t + 1}">?</span>`);
  const go = $('#fuse-go'); go.disabled = fuseSel.length < 3;
  go.innerHTML = `합성하기 <i class="gem"></i>${FUSE_COST[t].toLocaleString()}`;
  $('#fuse-label').textContent = `보유한 ${RAR[t].name} 장비 (선택됨: ${fuseSel.length}/3)`;
  const grid = $('#fuse-grid'); grid.innerHTML = '';
  const list = GEAR.filter(g => g.r === t && owned(g.id));
  if (!list.length) { grid.innerHTML = `<p class="empty-msg">합성할 수 있는 ${RAR[t].name} 장비가 없어요. 장비 뽑기로 모아 보세요!</p>`; return; }
  list.forEach(g => {
    const k = fuseSel.filter(x => x === g.id).length;
    const b = card(`r${g.r}${k ? ' on' : ''}`, gearIcon(g), g.name, `${SLOT_NAME[g.slot]} · 보유 ${owned(g.id)}개`, k ? `선택 ${k}` : '', 60);
    b.addEventListener('click', () => {
      if (fuseSel.length >= 3 || k >= owned(g.id)) { SFX.error(); toast(fuseSel.length >= 3 ? '3개를 모두 골랐어요' : '가진 개수만큼만 고를 수 있어요'); return; }
      SFX.click(); fuseSel.push(g.id); renderFuse();
    });
    grid.appendChild(b);
  });
}
function doFuse() {
  const t = fuseTier, cost = FUSE_COST[t];
  if (fuseSel.length < 3) return;
  if (S.gems < cost) { SFX.error(); toast(`보석이 부족해요 (필요 ${cost.toLocaleString()})`); return; }
  setGems(S.gems - cost);
  fuseSel.forEach(id => { S.gear[id]--; if (S.gear[id] <= 0) { delete S.gear[id]; const g = GEAR_BY_ID[id]; if (S.equip[g.slot] === id) S.equip[g.slot] = null; } });
  const item = pick(GEAR.filter(g => g.r === t + 1)), isNew = !S.gear[item.id];
  S.gear[item.id] = (S.gear[item.id] || 0) + 1;
  if (isNew && !S.equip[item.slot]) S.equip[item.slot] = item.id;
  addLog('🔮', `장비 합성으로 <b>${item.name}</b>(${RAR[item.r].name}) ${isNew ? '획득!' : '레벨 업 → Lv.' + S.gear[item.id]}`, item.r);
  fuseSel = []; save();
  Gacha.play({ name: '장비 합성', title: `장비 합성 · ${RAR[t].name} 3개 → ${RAR[t + 1].name}`, tier: [0, 1, 2, 2, 3][t], cost: 0 }, [{ kind: 'gear', item, rar: item.r, isNew, lv: S.gear[item.id] }], '장비');
}

// ── 홈 · 기록 · 도감 ──
function renderHome() {
  $('#home-sub').innerHTML = `슬라임 Lv.${S.lv} 사냥 중 · 보유 보석 <i class="gem"></i><b>${S.gems.toLocaleString()}</b>`;
  $('#home-stats').innerHTML = statsHTML();
  const rows = [['스킬', GACHA_SKILLS], ...SLOTS.map(s => [SLOT_NAME[s], GEAR.filter(g => g.slot === s)])];
  $('#home-prog').innerHTML = rows.map(([n, list]) => { const o = ownCount(list); return `<div class="prog-row"><span>${n}</span><span class="pb"><i style="width:${o / list.length * 100}%"></i></span><span>${o}/${list.length}</span></div>`; }).join('');
  $('#home-log').innerHTML = logHTML(S.log.slice(0, 6));
}
function renderLog() { $('#log-list').innerHTML = logHTML(S.log); $('#log-count').textContent = `${S.log.length}개`; }
function renderDex() {
  const d = $('#dex'); d.innerHTML = '';
  const total = GACHA_SKILLS.length + GEAR.length, own = ownCount(GACHA_SKILLS) + ownCount(GEAR);
  d.insertAdjacentHTML('beforeend', `<h3 class="ch">도감 <small>수집률 ${Math.round(own / total * 100)}% · ${own}/${total}</small></h3>`);
  const sec = (title, list, mk) => {
    const s = document.createElement('div'); s.className = 'dex-sec';
    s.innerHTML = `<h4>${title} <small>${ownCount(list)}/${list.length}</small></h4><div class="igrid"></div>`;
    const g = s.querySelector('.igrid'); list.forEach(x => g.appendChild(mk(x))); d.appendChild(s);
  };
  sec('스킬', SKILLS.filter(s => !s.basic), s => skillCard(s, () => { SFX.click(); sel = { t: 'skill', id: s.id }; go('attack'); }, 48));
  SLOTS.forEach(slot => sec(SLOT_NAME[slot], GEAR.filter(g => g.slot === slot), g => gearCard(g, () => { SFX.click(); sel = { t: 'gear', id: g.id }; S.slot = slot; go('closet'); }, 56)));
}

// ── 이동 ──
function go(target) {
  if (['attack', 'closet', 'gear', 'fuse'].includes(target)) { S.view = 'char'; S.tab = target; } else S.view = target;
  save(); applyNav();
  if (isMobile()) $('#shell').classList.remove('open');
  window.scrollTo({ top: 0 });
}
function applyNav() {
  const key = S.view === 'char' ? S.tab : S.view;
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== S.view; });
  $$('.snav [data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === key));
  $$('#toptabs [data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === S.view));
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  $$('.pane').forEach(p => { p.hidden = p.dataset.pane !== S.tab; });
  renderAll();
  if (S.view === 'char' && S.tab === 'attack') fit();
}
function renderAll() {
  refreshPlayer(); renderDetail(); renderCloset(); renderAttack(); renderBoxes('gear'); renderBoxes('skill'); renderFuse();
  if (S.view === 'home') renderHome();
  if (S.view === 'log') renderLog();
  if (S.view === 'dex') renderDex();
}
function fit() {
  const cv = $('#game'), w = $('#arena').clientWidth;
  if (!w) return;
  let s = w / W;
  if (s >= 2 && Math.floor(s) / s > 0.94) s = Math.floor(s);
  cv.style.width = W * s + 'px'; cv.style.height = H * s + 'px';
}
function setMenu() {
  $('#shell').classList.toggle('collapsed', !S.menu);
  $('#btn-menu span').textContent = isMobile() ? '메뉴' : S.menu ? '메뉴 접기' : '메뉴 펼치기';
}

// ── 시작 ──
(() => {
  const [cv, c] = PX.mk(8, 7);
  PX.sprite(c, ['..KKKK..', '.K3311K.', 'K331111K', 'K111112K', '.K1122K.', '..K12K..', '...KK...'], { K: '#1b2333', 1: '#4ab8e8', 2: '#2a6fb0', 3: '#d8f6ff' }, 0, 0);
  document.documentElement.style.setProperty('--gem', `url(${cv.toDataURL()})`);
})();
Gacha.init();
setMenu();
applyNav();
setGems(S.gems);
E.start($('#game'));
fit();
window.addEventListener('resize', () => { fit(); setMenu(); });

$$('[data-go]').forEach(b => b.addEventListener('click', () => { SFX.tab(); go(b.dataset.go === 'char' ? S.tab : b.dataset.go); }));
$$('#tabs button').forEach(b => b.addEventListener('click', () => { SFX.tab(); go(b.dataset.tab); }));
$$('#subtabs button').forEach(b => b.addEventListener('click', () => { SFX.tab(); S.slot = b.dataset.slot; save(); renderCloset(); }));
$('#btn-menu').addEventListener('click', () => {
  SFX.click();
  if (isMobile()) $('#shell').classList.toggle('open');
  else { S.menu = !S.menu; save(); setMenu(); setTimeout(fit, 0); }
});
$('#scrim').addEventListener('click', () => $('#shell').classList.remove('open'));
$('#btn-atk').addEventListener('click', attack);
$('#fuse-go').addEventListener('click', doFuse);
$('#fuse-clear').addEventListener('click', () => { SFX.click(); fuseSel = []; renderFuse(); });
$('#btn-crit').addEventListener('click', critical);
window.addEventListener('keydown', e => {
  if (e.repeat || !$('#gacha-ov').hidden || S.view !== 'char' || S.tab !== 'attack') return;
  if (e.target.closest && e.target.closest('input, textarea')) return;
  if (e.key === ' ') { e.preventDefault(); attack(); }
  else if (e.key === 'c' || e.key === 'C') critical();
});
$('#btn-gems').addEventListener('click', () => { SFX.coin(); setGems(S.gems + 10000); toast('테스트용 보석 +10,000'); });
$('#btn-unlock').addEventListener('click', () => {
  SKILLS.forEach(s => { if (!S.skills[s.id]) S.skills[s.id] = 1; });
  GEAR.forEach(g => { if (!S.gear[g.id]) S.gear[g.id] = 1; });
  addLog('🔓', '테스트용으로 모든 스킬과 장비를 열었어요');
  save(); SFX.open(3); renderAll(); toast('모든 스킬과 장비를 열었어요');
});
const muteBtn = $('#btn-mute');
const setMuteLabel = () => { muteBtn.textContent = SFX.muted ? '🔇 소리 꺼짐' : '🔊 소리'; };
setMuteLabel();
muteBtn.addEventListener('click', () => { SFX.toggle(); setMuteLabel(); SFX.click(); });
const resetBtn = $('#btn-reset');
let resetArm = 0;
resetBtn.addEventListener('click', () => {
  if (!resetArm) {
    resetBtn.classList.add('warn'); resetBtn.textContent = '한 번 더 누르면 초기화';
    resetArm = setTimeout(() => { resetArm = 0; resetBtn.classList.remove('warn'); resetBtn.textContent = '초기화'; }, 3000);
    return;
  }
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  location.reload();
});
