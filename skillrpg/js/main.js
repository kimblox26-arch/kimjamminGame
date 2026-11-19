// ───────── 상태 · UI ─────────
const $ = s => document.querySelector(s);
const SAVE_KEY = 'srpg_save_v1';
const DEFAULT = () => ({ gems: 100000, skills: { fireball: 1 }, gear: {}, slots: ['fireball', null, null, null], equip: { head: null, body: null, legs: null }, lv: 1 });
let S = (() => { try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); if (d && d.skills) return Object.assign(DEFAULT(), d); } catch (e) {} return DEFAULT(); })();
let saveT = 0;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }, 150); };

const cds = [0, 0, 0, 0], cdMax = [1, 1, 1, 1];
let kind = 'skill', autoGap = 0;

function stats() {
  let crit = 5, atk = 0, cdr = 0;
  const e = S.equip;
  if (e.head) crit += gearValue(GEAR_BY_ID[e.head], S.gear[e.head]);
  if (e.body) atk += gearValue(GEAR_BY_ID[e.body], S.gear[e.body]);
  if (e.legs) cdr += gearValue(GEAR_BY_ID[e.legs], S.gear[e.legs]);
  return { crit: Math.min(100, crit), atk, cdr: Math.min(60, cdr) };
}
const gearObj = () => ({ head: GEAR_BY_ID[S.equip.head] || null, body: GEAR_BY_ID[S.equip.body] || null, legs: GEAR_BY_ID[S.equip.legs] || null });

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
}
function setGems(n) {
  S.gems = Math.max(0, n); $('#gems').textContent = S.gems.toLocaleString(); save();
  const g = $('.gems'); g.classList.remove('pulse'); void g.offsetWidth; g.classList.add('pulse');
}
function scaledCanvas(src, cls) { src.className = 'px-icon ' + (cls || ''); return src; }

// ── 플레이어/능력치 ──
function refreshPlayer() {
  const g = gearObj();
  E.player.sprite = buildPlayerSprite(g);
  E.gear = { head: g.head ? g.head.r : -1, body: g.body ? g.body.r : -1, legs: g.legs ? g.legs.r : -1 };
  const pv = $('#preview').getContext('2d');
  pv.imageSmoothingEnabled = false; pv.clearRect(0, 0, 24, 34); pv.drawImage(E.player.sprite, 0, 0);
  const st = stats();
  $('#stats').innerHTML = `<span>⚔ 공격력 <b>+${st.atk.toFixed(0)}%</b></span><span>✦ 치명타 <b>${st.crit.toFixed(0)}%</b></span><span>⏱ 쿨감 <b>${st.cdr.toFixed(0)}%</b></span>`;
}

// ── 스킬 바 ──
function buildSkillbar() {
  const bar = $('#skillbar'); bar.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const b = document.createElement('button');
    b.className = 'slot'; b.dataset.i = i;
    b.innerHTML = `<span class="key">${i + 1}</span><div class="sicon"></div><div class="sname"></div><div class="cd"></div><div class="cdt"></div>`;
    b.addEventListener('pointerdown', e => { e.preventDefault(); tryCast(i); });
    bar.appendChild(b);
  }
}
function renderSkillbar() {
  document.querySelectorAll('.slot').forEach((b, i) => {
    const id = S.slots[i], sk = SKILL_BY_ID[id];
    b.className = 'slot' + (sk ? ' r' + sk.r : ' empty');
    const ic = b.querySelector('.sicon'); ic.innerHTML = '';
    if (sk) { ic.appendChild(scaledCanvas(skillIcon(id))); b.querySelector('.sname').textContent = `${sk.name} Lv.${S.skills[id]}`; }
    else { ic.textContent = '+'; b.querySelector('.sname').textContent = '비어있음'; }
  });
}
function tryCast(i, auto) {
  const id = S.slots[i];
  if (!id) { if (!auto) { SFX.error(); toast('아래 가방에서 스킬을 눌러 장착하세요'); } return; }
  if (cds[i] > 0) return;
  const sk = SKILL_BY_ID[id];
  cdMax[i] = cds[i] = sk.cd * (1 - stats().cdr / 100);
  E.cast(sk, S.skills[id] || 1);
  showBanner(sk);
}
function testCast(id) {
  const sk = SKILL_BY_ID[id];
  E.cast(sk, S.skills[id] || 1); showBanner(sk);
}
function showBanner(sk) {
  const b = $('#banner');
  b.className = 'banner r' + sk.r;
  b.innerHTML = `<small>${RAR[sk.r].name}</small>${sk.name}`;
  void b.offsetWidth; b.classList.add('show');
}
E.onTick = dt => {
  const slots = document.querySelectorAll('.slot');
  autoGap -= dt;
  for (let i = 0; i < 4; i++) {
    if (cds[i] > 0) cds[i] = Math.max(0, cds[i] - dt);
    const b = slots[i]; if (!b) continue;
    const p = cds[i] > 0 ? cds[i] / cdMax[i] * 100 : 0;
    const cd = b.querySelector('.cd'), ct = b.querySelector('.cdt');
    const h = p.toFixed(0) + '%';
    if (cd.style.height !== h) cd.style.height = h;
    const txt = cds[i] > 0 ? cds[i].toFixed(1) : '';
    if (ct.textContent !== txt) ct.textContent = txt;
    b.classList.toggle('ready', cds[i] <= 0 && !!S.slots[i]);
    if ($('#auto').checked && autoGap <= 0 && cds[i] <= 0 && S.slots[i] && E.alive() && !E.G.frozen) { tryCast(i, true); autoGap = 0.7; }
  }
};
E.onKill = gems => { setGems(S.gems + gems); };
E.onSlime = s => {
  $('#slime-name').innerHTML = `${s.king ? '👑 킹 ' : SLIME_COLORS[(s.lv - 1) % 6].name + ' '}슬라임 <b>Lv.${s.lv}</b>`;
  S.lv = s.lv; save();
};
E.stats = stats;
E.startLevel = S.lv;

// ── 뽑기 ──
function renderBoxes() {
  const wrap = $('#boxes'); wrap.innerHTML = '';
  BOXES.forEach(b => {
    const el = document.createElement('div');
    el.className = 'boxcard t' + b.tier;
    const [cv, c] = PX.mk(36, 26); drawChest(c, 18, 25, b.tier, { time: 0.1 });
    const rates = b.rates.map((r, i) => r ? `<li class="r${i}"><i></i>${RAR[i].name}<b>${r}%</b></li>` : '').join('');
    el.innerHTML = `<div class="chest"></div><div class="bname">${b.name}</div><div class="bcost"><i class="gem"></i>${b.cost.toLocaleString()}</div><ul class="rates">${rates}</ul>
      <div class="bbtns"><button class="pbtn p1">1회<small><i class="gem"></i>${b.cost.toLocaleString()}</small></button><button class="pbtn p10">10회<small><i class="gem"></i>${(b.cost * 10).toLocaleString()}</small></button></div>`;
    el.querySelector('.chest').appendChild(scaledCanvas(cv));
    el.querySelector('.p1').addEventListener('click', () => pull(b, 1));
    el.querySelector('.p10').addEventListener('click', () => pull(b, 10));
    wrap.appendChild(el);
  });
}
function roll(rates) {
  let r = Math.random() * rates.reduce((a, b) => a + b, 0);
  for (let i = 0; i < rates.length; i++) { if (r < rates[i]) return i; r -= rates[i]; }
  return rates.findIndex(x => x > 0);
}
function pull(box, count) {
  const cost = box.cost * count;
  if (S.gems < cost) { SFX.error(); toast(`보석이 부족해요! (필요 ${cost.toLocaleString()})`); return; }
  SFX.click();
  setGems(S.gems - cost);
  const results = [];
  for (let i = 0; i < count; i++) {
    const rar = roll(box.rates);
    const pool = kind === 'skill' ? SKILLS.filter(s => s.r === rar) : GEAR.filter(g => g.r === rar);
    const item = pick(pool);
    const store = kind === 'skill' ? S.skills : S.gear;
    const isNew = !store[item.id];
    store[item.id] = (store[item.id] || 0) + 1;
    if (isNew && kind === 'skill') { const e = S.slots.indexOf(null); if (e >= 0) S.slots[e] = item.id; }
    if (isNew && kind === 'gear' && !S.equip[item.slot]) S.equip[item.slot] = item.id;
    results.push({ kind, item, rar, isNew, lv: store[item.id] });
  }
  save();
  Gacha.play(box, results, kind === 'skill' ? '스킬' : '장비');
}
Gacha.onClose = () => { renderAll(); };

// ── 가방 ──
function renderInventory() {
  // 장비 슬롯
  const es = $('#eslots'); es.innerHTML = '';
  ['head', 'body', 'legs'].forEach(slot => {
    const id = S.equip[slot], g = GEAR_BY_ID[id];
    const el = document.createElement('button');
    el.className = 'eslot' + (g ? ' r' + g.r : ' empty');
    el.innerHTML = `<div class="eicon"></div><div class="etext"><small>${SLOT_NAME[slot]}</small><b>${g ? g.name + ' Lv.' + S.gear[id] : '없음'}</b><span>${g ? g.stat + ' +' + gearValue(g, S.gear[id]) + g.unit : '장비 뽑기로 획득'}</span></div>`;
    if (g) el.querySelector('.eicon').appendChild(scaledCanvas(gearIcon(g)));
    el.addEventListener('click', () => { if (g) { S.equip[slot] = null; SFX.click(); save(); renderAll(); toast(`${g.name} 해제`); } });
    es.appendChild(el);
  });
  // 스킬 목록
  const sg = $('#skill-grid'); sg.innerHTML = '';
  let own = 0;
  SKILLS.forEach(sk => {
    const lv = S.skills[sk.id], el = document.createElement('button');
    el.className = `icard r${sk.r}` + (lv ? '' : ' locked');
    const slot = S.slots.indexOf(sk.id);
    if (lv) own++;
    el.innerHTML = `<div class="ic"></div><div class="nm">${lv ? sk.name : '???'}</div><div class="lv">${lv ? 'Lv.' + lv : RAR[sk.r].name}</div>${slot >= 0 ? `<span class="badge">${slot + 1}</span>` : ''}`;
    el.querySelector('.ic').appendChild(scaledCanvas(skillIcon(sk.id)));
    el.addEventListener('click', () => { if (!lv) { SFX.error(); toast('스킬 뽑기로 획득할 수 있어요'); return; } SFX.click(); openSkillModal(sk.id); });
    sg.appendChild(el);
  });
  $('#skill-count').textContent = `${own} / ${SKILLS.length}`;
  // 장비 목록
  const gg = $('#gear-grid'); gg.innerHTML = '';
  let gown = 0;
  GEAR.forEach(g => {
    const lv = S.gear[g.id], el = document.createElement('button');
    const on = S.equip[g.slot] === g.id;
    if (lv) gown++;
    el.className = `icard r${g.r}` + (lv ? '' : ' locked') + (on ? ' on' : '');
    el.innerHTML = `<div class="ic"></div><div class="nm">${lv ? g.name : '???'}</div><div class="lv">${lv ? `${SLOT_NAME[g.slot]} Lv.${lv}` : RAR[g.r].name + ' ' + SLOT_NAME[g.slot]}</div>${on ? '<span class="badge">착용</span>' : ''}`;
    el.querySelector('.ic').appendChild(scaledCanvas(gearIcon(g)));
    el.addEventListener('click', () => {
      if (!lv) { SFX.error(); toast('장비 뽑기로 획득할 수 있어요'); return; }
      S.equip[g.slot] = on ? null : g.id; save();
      on ? SFX.click() : SFX.equip();
      toast(on ? `${g.name} 해제` : `${g.name} 착용! ${g.stat} +${gearValue(g, lv)}${g.unit}`);
      renderAll();
    });
    gg.appendChild(el);
  });
  $('#gear-count').textContent = `${gown} / ${GEAR.length}`;
}
function openSkillModal(id) {
  const sk = SKILL_BY_ID[id], lv = S.skills[id], per = Math.round(sk.dmg * (1 + 0.15 * (lv - 1)));
  const m = $('#modal'), box = $('#modal-box');
  box.className = 'pbox modal-box r' + sk.r;
  const slotBtns = [0, 1, 2, 3].map(i => `<button class="pbtn sm ${S.slots[i] === id ? 'on' : ''}" data-s="${i}">${i + 1}번 슬롯${S.slots[i] && S.slots[i] !== id ? `<small>${SKILL_BY_ID[S.slots[i]].name}</small>` : ''}</button>`).join('');
  box.innerHTML = `<div class="md-head"><div class="md-icon"></div><div><div class="md-rar">${RAR[sk.r].name} 스킬</div><div class="md-name">${sk.name} <small>Lv.${lv}</small></div></div></div>
    <p class="md-desc">${sk.desc}</p>
    <div class="md-stats"><span>피해 <b>${per}${sk.hits > 1 ? ' × ' + sk.hits : ''}</b></span><span>쿨타임 <b>${sk.cd}초</b></span><span>중복 획득 시 <b>+15%</b></span></div>
    <div class="md-label">장착할 슬롯</div><div class="md-slots">${slotBtns}</div>
    <div class="md-foot"><button class="pbtn test">▶ 테스트 시전</button>${S.slots.includes(id) ? '<button class="pbtn sm danger un">해제</button>' : ''}<button class="pbtn sm close">닫기</button></div>`;
  box.querySelector('.md-icon').appendChild(scaledCanvas(skillIcon(id)));
  box.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.s, prev = S.slots.indexOf(id);
    if (prev >= 0) S.slots[prev] = S.slots[i];
    S.slots[i] = id; cds[i] = 0; if (prev >= 0) cds[prev] = 0;
    save(); SFX.equip(); closeModal(); renderAll(); toast(`${sk.name} → ${i + 1}번 슬롯`);
  }));
  box.querySelector('.test').addEventListener('click', () => { closeModal(); testCast(id); $('#arena').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  const un = box.querySelector('.un');
  if (un) un.addEventListener('click', () => { S.slots[S.slots.indexOf(id)] = null; save(); SFX.click(); closeModal(); renderAll(); });
  box.querySelector('.close').addEventListener('click', () => { SFX.click(); closeModal(); });
  m.hidden = false;
}
function closeModal() { $('#modal').hidden = true; }

function renderAll() { renderSkillbar(); renderInventory(); refreshPlayer(); }

// ── 캔버스 크기 (정수 배율 우선) ──
function fit() {
  const cv = $('#game'), w = $('#arena').clientWidth;
  let s = w / W;
  if (s >= 2 && Math.floor(s) / s > 0.94) s = Math.floor(s);
  cv.style.width = W * s + 'px'; cv.style.height = H * s + 'px';
}

// ── 시작 ──
function gemIconURL() {
  const [cv, c] = PX.mk(8, 7);
  PX.sprite(c, ['..KKKK..', '.K3311K.', 'K331111K', 'K111112K', '.K1122K.', '..K12K..', '...KK...'], { K: '#140c1c', 1: '#4ab8e8', 2: '#2a6fb0', 3: '#d8f6ff' }, 0, 0);
  return cv.toDataURL();
}
document.documentElement.style.setProperty('--gem', `url(${gemIconURL()})`);
buildSkillbar();
renderBoxes();
renderAll();
setGems(S.gems);
Gacha.init();
E.start($('#game'));
fit(); window.addEventListener('resize', fit);

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
  kind = t.dataset.kind; SFX.tab();
  $('#gacha-box').dataset.kind = kind;
  $('#gacha-desc').textContent = kind === 'skill' ? '17종 스킬 중 하나를 뽑아요. 중복이면 스킬 레벨 업!' : '머리 · 몸 · 다리 장비 18종 중 하나를 뽑아요. 중복이면 장비 레벨 업!';
}));
window.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.key === 'Escape') { closeModal(); return; }
  if (!$('#gacha-ov').hidden || !$('#modal').hidden) return;
  const i = '1234'.indexOf(e.key);
  if (i >= 0) tryCast(i);
});
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
$('#btn-gems').addEventListener('click', () => { SFX.coin(); setGems(S.gems + 10000); toast('테스트용 보석 +10,000'); });
$('#btn-unlock').addEventListener('click', () => {
  SKILLS.forEach(s => { if (!S.skills[s.id]) S.skills[s.id] = 1; });
  GEAR.forEach(g => { if (!S.gear[g.id]) S.gear[g.id] = 1; });
  ['timestop', 'omega', 'holysword', 'meteor'].forEach(id => { if (!S.slots.includes(id)) { const e = S.slots.indexOf(null); if (e >= 0) S.slots[e] = id; } });
  save(); SFX.open(3); renderAll(); toast('모든 스킬·장비 해금! 가방에서 장착/테스트 해보세요');
});
const muteBtn = $('#btn-mute');
const setMuteLabel = () => { muteBtn.textContent = SFX.muted ? '🔇 소리' : '🔊 소리'; };
setMuteLabel();
muteBtn.addEventListener('click', () => { SFX.toggle(); setMuteLabel(); SFX.click(); });
$('#btn-reset').addEventListener('click', () => {
  if (!confirm('저장된 진행 상황을 모두 지울까요?')) return;
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  location.reload();
});
