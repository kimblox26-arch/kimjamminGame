// ───────── 상태 · UI ─────────
const $ = s => document.querySelector(s);
const SAVE_KEY = 'srpg_save_v1';
const DEFAULT = () => ({ gems: 100000, skills: { attack: 1, critical: 1, fireball: 1 }, gear: {}, slots: ['attack', 'critical', 'fireball', null], equip: { head: null, body: null, legs: null }, lv: 1 });
let S = (() => { try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); if (d && d.skills) return Object.assign(DEFAULT(), d); } catch (e) {} return DEFAULT(); })();
S.skills.attack = S.skills.attack || 1; S.skills.critical = S.skills.critical || 1;
let saveT = 0;
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }, 150); };

const cds = [0, 0, 0, 0], cdMax = [1, 1, 1, 1];
let kind = 'skill', autoGap = 0;
const SCARF = [['#e8364f', '#ff8a9a', '#a01a30'], ['#e8364f', '#ff8a9a', '#a01a30'], ['#3fa9ff', '#a8dcff', '#1d5aa8'],
  ['#2f9e6b', '#5fd39a', '#1b6343'], ['#ffd23f', '#fff3b0', '#b8860b'], ['#ff5ad9', '#ffb0f0', '#8a1f7a']];

function stats() {
  let crit = 5, atk = 0, cdr = 0;
  const e = S.equip;
  if (e.head) crit += gearValue(GEAR_BY_ID[e.head], S.gear[e.head]);
  if (e.body) atk += gearValue(GEAR_BY_ID[e.body], S.gear[e.body]);
  if (e.legs) cdr += gearValue(GEAR_BY_ID[e.legs], S.gear[e.legs]);
  return { crit: Math.min(100, crit), atk, cdr: Math.min(60, cdr) };
}
const gearObj = () => ({ head: GEAR_BY_ID[S.equip.head] || null, body: GEAR_BY_ID[S.equip.body] || null, legs: GEAR_BY_ID[S.equip.legs] || null });

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show'); }
function setGems(n) {
  S.gems = Math.max(0, n); $('#gems').textContent = S.gems.toLocaleString(); save();
  const g = $('.gems'); g.classList.remove('pulse'); void g.offsetWidth; g.classList.add('pulse');
}
const icon = cv => { cv.className = 'px-icon'; return cv; };

// ── 플레이어/능력치 ──
function refreshPlayer() {
  const g = gearObj();
  E.player.sprite = buildPlayerSprite(g);
  E.gear = { head: g.head ? g.head.r : -1, body: g.body ? g.body.r : -1, legs: g.legs ? g.legs.r : -1 };
  [E.player.scarf, E.player.scarfL, E.player.scarfD] = SCARF[g.body ? g.body.r : 0];
  const top = Math.max(E.gear.head, E.gear.body, E.gear.legs);
  E.player.aura = top >= 5 ? 'rainbow' : top === 4 ? '#ffd23f' : null;
  const st = stats();
  $('#stats').innerHTML = `<span>⚔ 공격력 <b>+${st.atk.toFixed(0)}%</b></span><span>✦ 치명타 <b>${st.crit.toFixed(0)}%</b></span><span>⏱ 쿨감 <b>${st.cdr.toFixed(0)}%</b></span>`;
}

// ── 스킬 바 ──
function buildSkillbar() {
  const bar = $('#skillbar'); bar.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const b = document.createElement('button');
    b.className = 'slot';
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
    if (sk) { ic.appendChild(icon(skillIcon(id))); b.querySelector('.sname').textContent = `${sk.name} Lv.${S.skills[id]}`; }
    else { ic.textContent = '+'; b.querySelector('.sname').textContent = '비어있음'; }
  });
}
function tryCast(i, auto) {
  const id = S.slots[i];
  if (!id) { if (!auto) { SFX.error(); toast('위 목록에서 스킬을 눌러 장착하세요'); } return; }
  if (cds[i] > 0) return;
  const sk = SKILL_BY_ID[id];
  if (sk.basic && E.player.busy) return;
  cdMax[i] = cds[i] = sk.cd * (1 - stats().cdr / 100);
  E.cast(sk, S.skills[id] || 1);
  showBanner(sk);
}
function testCast(id) {
  const sk = SKILL_BY_ID[id];
  if (sk.basic && E.player.busy) return;
  E.cast(sk, S.skills[id] || 1); showBanner(sk);
}
function showBanner(sk) {
  const b = $('#banner');
  b.className = 'banner r' + sk.r;
  b.innerHTML = `<small>${rarName(sk)}</small>${sk.name}`;
  void b.offsetWidth; b.classList.add('show');
}
E.onTick = dt => {
  const slots = document.querySelectorAll('.slot'), auto = $('#auto').checked;
  autoGap -= dt;
  for (let i = 0; i < 4; i++) {
    if (cds[i] > 0) cds[i] = Math.max(0, cds[i] - dt);
    const b = slots[i]; if (!b) continue;
    const h = (cds[i] > 0 ? cds[i] / cdMax[i] * 100 : 0).toFixed(0) + '%';
    const cd = b.querySelector('.cd'), ct = b.querySelector('.cdt');
    if (cd.style.height !== h) cd.style.height = h;
    const txt = cds[i] > 0 ? cds[i].toFixed(1) : '';
    if (ct.textContent !== txt) ct.textContent = txt;
    b.classList.toggle('ready', cds[i] <= 0 && !!S.slots[i]);
    if (auto && autoGap <= 0 && cds[i] <= 0 && S.slots[i] && E.alive() && !E.G.frozen && !E.player.busy) { tryCast(i, true); autoGap = 0.7; }
  }
};
E.onKill = gems => { setGems(S.gems + gems); };
E.onSlime = s => {
  $('#slime-name').innerHTML = `${s.king ? '👑 킹 ' : SLIME_COLORS[(s.lv - 1) % 6].name + ' '}슬라임 <b>Lv.${s.lv}</b>`;
  S.lv = s.lv; save();
};
E.stats = stats;
E.startLevel = S.lv;

// ── 상단 목록 (스킬 · 머리 · 몸 · 다리) ──
function listBtn(cls, cv, name, sub, badge) {
  const b = document.createElement('button');
  b.className = 'lbtn ' + cls;
  b.innerHTML = `<span class="li"></span><span class="lt"><b>${name}</b><small>${sub}</small></span>${badge ? `<span class="badge">${badge}</span>` : ''}`;
  b.querySelector('.li').appendChild(icon(cv));
  return b;
}
function renderLists() {
  const ls = $('#list-skill'); ls.innerHTML = '';
  let own = 0;
  SKILLS.forEach(sk => {
    const lv = S.skills[sk.id], slot = S.slots.indexOf(sk.id);
    if (lv && !sk.basic) own++;
    const b = listBtn(`r${sk.r}${lv ? '' : ' locked'}${slot >= 0 ? ' on' : ''}${sk.basic ? ' basic' : ''}`, skillIcon(sk.id),
      lv ? sk.name : '???', lv ? `${rarName(sk)} · Lv.${lv}` : RAR[sk.r].name, slot >= 0 ? slot + 1 : '');
    b.addEventListener('click', () => { if (!lv) { SFX.error(); toast('스킬 뽑기로 획득할 수 있어요'); return; } SFX.click(); openSkillModal(sk.id); });
    ls.appendChild(b);
  });
  $('#cnt-skill').textContent = `${own}/${GACHA_SKILLS.length}`;
  ['head', 'body', 'legs'].forEach(slot => {
    const el = $('#list-' + slot); el.innerHTML = '';
    let n = 0;
    GEAR.filter(g => g.slot === slot).forEach(g => {
      const lv = S.gear[g.id], on = S.equip[slot] === g.id;
      if (lv) n++;
      const b = listBtn(`r${g.r}${lv ? '' : ' locked'}${on ? ' on' : ''}`, gearIcon(g),
        lv ? g.name : '???', lv ? `${g.stat} +${gearValue(g, lv)}${g.unit} · Lv.${lv}` : RAR[g.r].name, on ? '착용' : '');
      b.addEventListener('click', () => {
        if (!lv) { SFX.error(); toast('장비 뽑기로 획득할 수 있어요'); return; }
        S.equip[slot] = on ? null : g.id; save();
        on ? SFX.click() : SFX.equip();
        toast(on ? `${g.name} 해제` : `${g.name} 착용! ${g.stat} +${gearValue(g, lv)}${g.unit}`);
        renderAll();
        if (!on) { const p = E.player; E.burst(p.x, GROUND - 14, 30, ['#ffffff', RAR[g.r].color, RAR[g.r].dark], { spd: 50, life: 0.8, add: true, r: 6 }); }
      });
      el.appendChild(b);
    });
    $('#cnt-' + slot).textContent = `${n}/6`;
  });
}
function openSkillModal(id) {
  const sk = SKILL_BY_ID[id], lv = S.skills[id], per = Math.round(sk.dmg * (1 + 0.15 * (lv - 1)));
  const box = $('#modal-box');
  box.className = 'pbox modal-box r' + sk.r;
  const slotBtns = [0, 1, 2, 3].map(i => `<button class="pbtn sm ${S.slots[i] === id ? 'on' : ''}" data-s="${i}">${i + 1}번 슬롯${S.slots[i] && S.slots[i] !== id ? `<small>${SKILL_BY_ID[S.slots[i]].name}</small>` : ''}</button>`).join('');
  box.innerHTML = `<div class="md-head"><div class="md-icon"></div><div><div class="md-rar">${rarName(sk)} 스킬</div><div class="md-name">${sk.name} <small>Lv.${lv}</small></div></div></div>
    <p class="md-desc">${sk.desc}</p>
    <div class="md-stats"><span>피해 <b>${per}${sk.hits > 1 ? ' × ' + sk.hits : ''}</b></span><span>쿨타임 <b>${sk.cd}초</b></span>${sk.basic ? '' : '<span>중복 획득 시 <b>+15%</b></span>'}</div>
    <div class="md-label">장착할 슬롯</div><div class="md-slots">${slotBtns}</div>
    <div class="md-foot"><button class="pbtn test">▶ 테스트 시전</button>${S.slots.includes(id) ? '<button class="pbtn sm danger un">해제</button>' : ''}<button class="pbtn sm close">닫기</button></div>`;
  box.querySelector('.md-icon').appendChild(icon(skillIcon(id)));
  box.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.s, prev = S.slots.indexOf(id);
    if (prev >= 0) S.slots[prev] = S.slots[i];
    S.slots[i] = id; cds[i] = 0; if (prev >= 0) cds[prev] = 0;
    save(); SFX.equip(); closeModal(); renderAll(); toast(`${sk.name} → ${i + 1}번 슬롯`);
  }));
  box.querySelector('.test').addEventListener('click', () => { closeModal(); $('#arena').scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => testCast(id), 250); });
  const un = box.querySelector('.un');
  if (un) un.addEventListener('click', () => { S.slots[S.slots.indexOf(id)] = null; save(); SFX.click(); closeModal(); renderAll(); });
  box.querySelector('.close').addEventListener('click', () => { SFX.click(); closeModal(); });
  $('#modal').hidden = false;
}
function closeModal() { $('#modal').hidden = true; }

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
    el.querySelector('.chest').appendChild(icon(cv));
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
    const pool = kind === 'skill' ? GACHA_SKILLS.filter(s => s.r === rar) : GEAR.filter(g => g.r === rar);
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
Gacha.onClose = () => renderAll();
function setKind(k) {
  kind = k;
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.kind === k));
  $('#gacha-box').dataset.kind = k;
  $('#gacha-desc').textContent = k === 'skill' ? `${GACHA_SKILLS.length}종 스킬 중 하나를 뽑아요. 중복이면 스킬 레벨 업!` : '머리 · 몸 · 다리 장비 18종 중 하나를 뽑아요. 중복이면 장비 레벨 업!';
}

function renderAll() { renderSkillbar(); renderLists(); refreshPlayer(); }

// ── 캔버스 크기 ──
function fit() {
  const cv = $('#game'), w = $('#arena').clientWidth;
  let s = w / W;
  if (s >= 2 && Math.floor(s) / s > 0.94) s = Math.floor(s);
  cv.style.width = W * s + 'px'; cv.style.height = H * s + 'px';
}

// ── 시작 ──
(() => {
  const [cv, c] = PX.mk(8, 7);
  PX.sprite(c, ['..KKKK..', '.K3311K.', 'K331111K', 'K111112K', '.K1122K.', '..K12K..', '...KK...'], { K: '#140c1c', 1: '#4ab8e8', 2: '#2a6fb0', 3: '#d8f6ff' }, 0, 0);
  document.documentElement.style.setProperty('--gem', `url(${cv.toDataURL()})`);
})();
buildSkillbar();
renderBoxes();
setKind('skill');
renderAll();
setGems(S.gems);
Gacha.init();
E.start($('#game'));
fit(); window.addEventListener('resize', fit);

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { SFX.tab(); setKind(t.dataset.kind); }));
$('#btn-atk').addEventListener('click', () => testCast('attack'));
$('#btn-crit').addEventListener('click', () => testCast('critical'));
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); return; }
  if (e.repeat || !$('#gacha-ov').hidden || !$('#modal').hidden) return;
  if (e.key === ' ') { e.preventDefault(); testCast('attack'); return; }
  if (e.key === 'c' || e.key === 'C') { testCast('critical'); return; }
  const i = '1234'.indexOf(e.key);
  if (i >= 0) tryCast(i);
});
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
$('#btn-gems').addEventListener('click', () => { SFX.coin(); setGems(S.gems + 10000); toast('테스트용 보석 +10,000'); });
$('#btn-unlock').addEventListener('click', () => {
  SKILLS.forEach(s => { if (!S.skills[s.id]) S.skills[s.id] = 1; });
  GEAR.forEach(g => { if (!S.gear[g.id]) S.gear[g.id] = 1; });
  ['timestop', 'omega', 'holysword', 'meteor'].forEach(id => { if (!S.slots.includes(id)) { const e = S.slots.indexOf(null); if (e >= 0) S.slots[e] = id; } });
  save(); SFX.open(3); renderAll(); toast('모든 스킬·옷 해금! 위 목록에서 장착/테스트 해보세요');
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
