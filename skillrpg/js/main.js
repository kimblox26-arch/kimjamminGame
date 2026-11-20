// ───────── 상태 · UI ─────────
const $ = s => document.querySelector(s);
const SAVE_KEY = 'srpg_save_v1';
const DEFAULT = () => ({ gems: 100000, skills: { attack: 1, critical: 1, fireball: 1 }, gear: {}, equip: { head: null, body: null, legs: null }, main: 'attack', lv: 1, tab: 'attack', slot: 'head' });
let S = (() => { try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); if (d && d.skills) return Object.assign(DEFAULT(), d); } catch (e) {} return DEFAULT(); })();
S.skills.attack = S.skills.attack || 1; S.skills.critical = S.skills.critical || 1;
if (!S.skills[S.main]) S.main = 'attack';
let saveT = 0;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }, 150); };

let sel = null;            // 왼쪽 상세 정보에 보여줄 항목 { t: 'skill' | 'gear', id }
let cd = 0, cdMax = 1;     // 공격 버튼 쿨타임
let autoGap = 0;

function stats() {
  let crit = 5, atk = 0, cdr = 0;
  const e = S.equip;
  if (e.head) crit += gearValue(GEAR_BY_ID[e.head], S.gear[e.head]);
  if (e.body) atk += gearValue(GEAR_BY_ID[e.body], S.gear[e.body]);
  if (e.legs) cdr += gearValue(GEAR_BY_ID[e.legs], S.gear[e.legs]);
  return { crit: Math.min(100, crit), atk, cdr: Math.min(60, cdr) };
}
const gearObj = () => ({ head: GEAR_BY_ID[S.equip.head] || null, body: GEAR_BY_ID[S.equip.body] || null, legs: GEAR_BY_ID[S.equip.legs] || null });
const icon = cv => { cv.className = 'px-icon'; return cv; };
const ownCount = list => list.filter(x => (x.slot ? S.gear : S.skills)[x.id]).length;

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); }
function setGems(n) {
  S.gems = Math.max(0, n); $('#gems').textContent = S.gems.toLocaleString(); save();
  const g = $('.gem-pill'); g.classList.remove('pulse'); void g.offsetWidth; g.classList.add('pulse');
  if (!sel) renderDetail();
}

// ── 왼쪽: 미리보기 + 상세 정보 ──
function refreshPlayer() {
  const g = gearObj();
  E.player.sprite = buildPlayerSprite(g);
  E.gear = { head: g.head ? g.head.r : -1, body: g.body ? g.body.r : -1, legs: g.legs ? g.legs.r : -1 };
  const pv = $('#preview').getContext('2d');
  pv.imageSmoothingEnabled = false; pv.clearRect(0, 0, 24, 34); pv.drawImage(E.player.sprite, 0, 0);
}
function renderDetail() {
  const d = $('#detail'), st = stats();
  let h = '';
  if (sel && sel.t === 'gear') {
    const g = GEAR_BY_ID[sel.id], lv = S.gear[g.id], on = S.equip[g.slot] === g.id;
    h = `<div class="d-title r${g.r}"><b>${lv ? g.name : '???'}</b><span class="rt">${RAR[g.r].name}</span></div>
      <div class="d-sub">${SLOT_NAME[g.slot]} 장비${lv ? ' · Lv.' + lv : ''}</div>
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
  h += `<div class="d-lbl">능력치</div><div class="stats"><div><span>공격력</span><b>+${st.atk.toFixed(0)}%</b></div><div><span>치명타</span><b>${st.crit.toFixed(0)}%</b></div><div><span>쿨타임 감소</span><b>${st.cdr.toFixed(0)}%</b></div></div>
    <div class="d-lbl">착용 중</div><div class="eq" id="eq"></div>`;
  d.innerHTML = h;
  const eq = d.querySelector('#eq');
  ['head', 'body', 'legs'].forEach(slot => {
    const g = GEAR_BY_ID[S.equip[slot]], b = document.createElement('button');
    b.type = 'button'; b.className = 'eqrow' + (g ? ' r' + g.r : ' empty');
    b.innerHTML = `<span class="ei"></span><span><small>${SLOT_NAME[slot]}</small><b>${g ? g.name : '없음'}</b></span>${g ? `<em>${g.stat} +${gearValue(g, S.gear[g.id])}${g.unit}</em>` : ''}`;
    if (g) b.querySelector('.ei').appendChild(icon(gearIcon(g)));
    b.addEventListener('click', () => { SFX.click(); S.slot = slot; if (g) sel = { t: 'gear', id: g.id }; setTab('closet'); renderAll(); });
    eq.appendChild(b);
  });
  const act = d.querySelector('#d-act'), test = d.querySelector('#d-test');
  if (act && sel.t === 'gear') act.addEventListener('click', () => toggleGear(GEAR_BY_ID[sel.id]));
  if (act && sel.t === 'skill') act.addEventListener('click', () => equipSkill(sel.id));
  if (test) test.addEventListener('click', () => { equipSkill(sel.id, true); setTab('attack'); attack(); });
}

// ── 장비 / 스킬 장착 ──
function toggleGear(g) {
  const on = S.equip[g.slot] === g.id;
  S.equip[g.slot] = on ? null : g.id; save();
  on ? SFX.click() : SFX.equip();
  toast(on ? `${g.name} 해제` : `${g.name} 착용! ${g.stat} +${gearValue(g, S.gear[g.id])}${g.unit}`);
  if (!on) E.burst(E.player.x, GROUND - 14, 30, ['#ffffff', RAR[g.r].color, RAR[g.r].dark], { spd: 50, life: 0.8, r: 6 });
  renderAll();
}
function equipSkill(id, quiet) {
  if (S.main === id) return;
  S.main = id; cd = 0; save();
  if (!quiet) { SFX.equip(); toast(`${SKILL_BY_ID[id].name} 장착!`); }
  renderAll();
}

// ── 내 옷장 ──
function renderCloset() {
  document.querySelectorAll('#subtabs button').forEach(b => b.classList.toggle('on', b.dataset.slot === S.slot));
  const grid = $('#closet-grid'); grid.innerHTML = '';
  GEAR.filter(g => g.slot === S.slot).forEach(g => {
    const lv = S.gear[g.id], on = S.equip[g.slot] === g.id;
    const b = card(`r${g.r}${lv ? '' : ' locked'}${on ? ' on' : ''}${sel && sel.id === g.id ? ' sel' : ''}`, gearIcon(g), lv ? g.name : '???', lv ? `${RAR[g.r].name} · Lv.${lv}` : RAR[g.r].name, on ? '장착중' : '');
    b.addEventListener('click', () => {
      sel = { t: 'gear', id: g.id };
      if (!lv) { SFX.error(); renderAll(); return; }
      if (!on) toggleGear(g); else { SFX.click(); renderAll(); }
    });
    grid.appendChild(b);
  });
}
function card(cls, cv, name, sub, tag) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'icard ' + cls;
  b.innerHTML = `<span class="ic"></span><span class="nm">${name}</span><span class="rr">${sub}</span>${tag ? `<span class="tag">${tag}</span>` : ''}`;
  b.querySelector('.ic').appendChild(icon(cv));
  return b;
}

// ── 공격 테스트 ──
function renderAttack() {
  const sk = SKILL_BY_ID[S.main];
  const chip = $('#atk-chip'); chip.className = 'chip r' + sk.r; chip.innerHTML = `<i></i>${sk.name}`;
  const grid = $('#skill-grid'); grid.innerHTML = '';
  SKILLS.forEach(s => {
    const lv = S.skills[s.id], on = S.main === s.id;
    const b = card(`r${s.r}${lv ? '' : ' locked'}${on ? ' on' : ''}${sel && sel.id === s.id ? ' sel' : ''}`, skillIcon(s.id), lv ? s.name : '???', lv ? `${rarName(s)} · Lv.${lv}` : RAR[s.r].name, on ? '장착 중' : '');
    b.addEventListener('click', () => {
      sel = { t: 'skill', id: s.id };
      if (!lv) { SFX.error(); renderAll(); return; }
      if (!on) equipSkill(s.id); else { SFX.click(); renderAll(); }
    });
    grid.appendChild(b);
  });
}
function showBanner(sk) {
  const b = $('#banner');
  b.className = 'banner r' + sk.r;
  b.innerHTML = `<small>${rarName(sk)}</small>${sk.name}`;
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
  if (main.basic) {                       // 기본 공격이면 크리티컬 공격 기술로
    const sk = SKILL_BY_ID.critical;
    startCd(sk); E.cast(sk, S.skills.critical || 1); showBanner(sk);
    return;
  }
  startCd(main);                          // 다른 스킬은 모든 타격이 치명타
  E.critMode(3.6);
  E.flash('#fff3c0', 0.15, 0.6); SFX.clang();
  { const t = E.target(); critText(t.x, t.top - 30); }
  E.cast(main, S.skills[main.id] || 1);
  const b = $('#banner'); b.className = 'banner r4'; b.innerHTML = `<small>크리티컬</small>${main.name}`; void b.offsetWidth; b.classList.add('show');
}
E.onTick = dt => {
  if (cd > 0) cd = Math.max(0, cd - dt);
  const w = (cd > 0 ? cd / cdMax * 100 : 0).toFixed(1) + '%';
  document.querySelectorAll('.abtn').forEach(b => {
    const f = b.firstElementChild; if (f.style.width !== w) f.style.width = w;
    b.classList.toggle('cool', cd > 0);
  });
  autoGap -= dt;
  if ($('#auto').checked && cd <= 0 && autoGap <= 0 && E.alive() && !E.G.frozen && !E.player.busy && S.tab === 'attack') { autoGap = 0.4; attack(); }
};
E.onKill = gems => setGems(S.gems + gems);
E.onSlime = s => {
  $('#slime-name').innerHTML = `${s.king ? '👑 킹 ' : SLIME_COLORS[(s.lv - 1) % 6].name + ' '}슬라임 <b>Lv.${s.lv}</b>`;
  S.lv = s.lv; save();
};
E.stats = stats;
E.startLevel = S.lv;

// ── 뽑기 (장비 / 스킬) ──
function renderBoxes(kind) {
  const wrap = $(kind === 'skill' ? '#skill-boxes' : '#gear-boxes'); wrap.innerHTML = '';
  const pool = kind === 'skill' ? GACHA_SKILLS : GEAR;
  BOXES.forEach(b => {
    const el = document.createElement('div');
    el.className = 'brow t' + b.tier;
    const [cv, c] = PX.mk(36, 26); drawChest(c, 18, 25, b.tier, { time: 0.1 });
    const bar = b.rates.map((r, i) => r ? `<i class="r${i}" style="width:${r}%"></i>` : '').join('');
    const rates = b.rates.map((r, i) => r ? `<span class="r${i}">${RAR[i].name}</span> ${r}%` : '').filter(Boolean).join(' · ');
    const name = kind === 'skill' ? b.name.replace('상자', '스킬 상자') : b.name.replace('상자', '장비 상자');
    el.innerHTML = `<div class="bimg"></div>
      <div class="binfo"><div class="bt"><b>${name}</b><span class="pill">모은 ${kind === 'skill' ? '스킬' : '장비'} ${ownCount(pool)}/${pool.length}</span></div><div class="bar">${bar}</div><div class="rates">${rates}</div></div>
      <div class="bbtns"><button class="btn primary p1" type="button">${kind === 'skill' ? '열기' : '뽑기'} <i class="gem"></i>${b.cost.toLocaleString()}</button><button class="btn outline p10" type="button">10회 <i class="gem"></i>${(b.cost * 10).toLocaleString()}</button></div>`;
    el.querySelector('.bimg').appendChild(icon(cv));
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
  if (S.gems < cost) { SFX.error(); toast(`보석이 부족해요 (필요 ${cost.toLocaleString()})`); return; }
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
  save();
  Gacha.play(box, results, kind === 'skill' ? '스킬' : '장비');
}
Gacha.onClose = () => renderAll();

// ── 탭 ──
function setTab(t) {
  S.tab = t; save();
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('.pane').forEach(p => { p.hidden = p.dataset.pane !== t; });
  if (t === 'attack') fit();
}
function renderAll() { refreshPlayer(); renderDetail(); renderCloset(); renderAttack(); renderBoxes('gear'); renderBoxes('skill'); }
function fit() {
  const cv = $('#game'), w = $('#arena').clientWidth;
  if (!w) return;
  let s = w / W;
  if (s >= 2 && Math.floor(s) / s > 0.94) s = Math.floor(s);
  cv.style.width = W * s + 'px'; cv.style.height = H * s + 'px';
}

// ── 시작 ──
(() => {
  const [cv, c] = PX.mk(8, 7);
  PX.sprite(c, ['..KKKK..', '.K3311K.', 'K331111K', 'K111112K', '.K1122K.', '..K12K..', '...KK...'], { K: '#1b2333', 1: '#4ab8e8', 2: '#2a6fb0', 3: '#d8f6ff' }, 0, 0);
  document.documentElement.style.setProperty('--gem', `url(${cv.toDataURL()})`);
})();
Gacha.init();
setTab(S.tab);
renderAll();
setGems(S.gems);
E.start($('#game'));
fit(); window.addEventListener('resize', fit);

document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => { SFX.tab(); setTab(b.dataset.tab); }));
document.querySelectorAll('#subtabs button').forEach(b => b.addEventListener('click', () => { SFX.tab(); S.slot = b.dataset.slot; save(); renderCloset(); }));
$('#btn-atk').addEventListener('click', attack);
$('#btn-crit').addEventListener('click', critical);
window.addEventListener('keydown', e => {
  if (e.repeat || !$('#gacha-ov').hidden || S.tab !== 'attack') return;
  if (e.target.closest && e.target.closest('input, textarea')) return;
  if (e.key === ' ') { e.preventDefault(); attack(); }
  else if (e.key === 'c' || e.key === 'C') critical();
});
$('#btn-gems').addEventListener('click', () => { SFX.coin(); setGems(S.gems + 10000); toast('테스트용 보석 +10,000'); });
$('#btn-unlock').addEventListener('click', () => {
  SKILLS.forEach(s => { if (!S.skills[s.id]) S.skills[s.id] = 1; });
  GEAR.forEach(g => { if (!S.gear[g.id]) S.gear[g.id] = 1; });
  save(); SFX.open(3); renderAll(); toast('모든 스킬과 장비를 열었어요');
});
const muteBtn = $('#btn-mute');
const setMuteLabel = () => { muteBtn.textContent = SFX.muted ? '🔇 소리 꺼짐' : '🔊 소리'; };
setMuteLabel();
muteBtn.addEventListener('click', () => { SFX.toggle(); setMuteLabel(); SFX.click(); });
// 초기화: 한 번 더 눌러야 실행
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
