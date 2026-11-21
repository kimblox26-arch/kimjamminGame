'use strict';
// ===== 공 스킬 제작 / 융합 / 업그레이드 / 다른 사람 스킬 =====
const SK_COLORS = ['#ff6a3d', '#ffd43b', '#7cff6b', '#25F4EE', '#3d8bff', '#b46bff', '#FE2C55', '#111111'];
const compChips = s => s.comps.map(c => `<span class="cchip">${ic(COMPS[c][1], 13)}${COMPS[c][0]}</span>`).join('');
const skIcon = s => `<div class="sk-ic" style="--c:${s.color}">${ic(COMPS[s.comps[0]][1], 26)}${s.comps.length > 1 ? `<b>+${s.comps.length - 1}</b>` : ''}</div>`;
function skCard(s, acts, extra = '') {
  return `<div class="sk-card" data-id="${s.id}" style="--c:${s.color}">${extra}<div class="sk-row">${skIcon(s)}<div class="sk-info"><div class="sk-name"><b>${esc(s.name)}</b><span class="lv">Lv.${s.lv}</span>${s.fused ? '<span class="fz">융합</span>' : ''}${s.media ? ic('film', 14) : ''}</div><div class="cchips">${compChips(s)}</div><small>쿨타임 ${skillCD(s)}초 · 위력 ×${skillPower(s).toFixed(2)}</small></div></div><div class="sk-acts">${acts}</div></div>`;
}
function equipToggle(u, sid, crit) { // 일반 칸 1개, 크리티컬 칸 1개
  if (crit) { if (!u.critUnlocked) return false; u.crit = u.crit === sid ? null : sid; if (u.crit && (u.equipped || [])[0] === sid) u.equipped = []; }
  else { u.equipped = (u.equipped || [])[0] === sid ? [] : [sid]; if (u.crit === sid) u.crit = null; }
  save('users'); return true;
}
function slotsHTML(u) {
  const n = (u.equipped || []).map(id => D.skills[id]).filter(s => usable(u, s))[0], c = u.critUnlocked && D.skills[u.crit];
  const one = (s, label, crit) => s ? `<button class="slot on ${crit ? 'crit' : ''}" data-un="${s.id}" data-crit="${crit ? 1 : ''}" style="--c:${s.color}">${ic(COMPS[s.comps[0]][1], 22)}<small>${esc(s.name)}</small><em>${label}</em></button>` : `<div class="slot ${crit ? 'crit' : ''}">${ic('plus', 20)}<small>${label} 빈 칸</small></div>`;
  return `<div class="slots">${one(n, '스킬', false)}${u.critUnlocked ? one(usable(u, c) ? c : null, '크리티컬', true) : `<button class="slot buy" data-buy>${ic('plus', 20)}<small>크리티컬 스킬 추가</small><span class="price">${COIN}${CRIT_PRICE}</span></button>`}</div>
    <p class="muted sm center">스킬은 1개만 장착돼요. 크리티컬 스킬은 위력이 2배예요</p>`;
}
async function buyCrit(u) {
  if (u.critUnlocked) return false;
  if (!u.inf && u.coins < CRIT_PRICE) { toast(`코인이 부족해요 (필요 ${CRIT_PRICE}, 보유 ${u.coins})`); return false; }
  if (!await ask(`${CRIT_PRICE}코인으로 크리티컬 스킬 칸을 추가할까요?`, '추가')) return false;
  spend(u, CRIT_PRICE); u.critUnlocked = true; save('users'); AUD.sfx('coin'); toast('크리티컬 스킬 칸이 생겼어요'); return true;
}
function removeSkill(s) {
  delete D.skills[s.id]; Object.values(D.users).forEach(x => x.equipped = (x.equipped || []).filter(id => id !== s.id));
  if (s.media) IDB.del(s.media.key); if (s.sound && s.sound.startsWith('k_')) IDB.del(s.sound);
  save('skills', 'users');
}

screen('skills', (el, p) => {
  const u = me(); p.tab = p.tab || 'mine';
  el.innerHTML = `<div class="hdr"><button class="icon-btn" data-back>${ic('back')}</button><h2>공 스킬 제작</h2><span class="coin-pill">${COIN}<b>${coinText(u)}</b></span></div>
    <div class="seg"><button data-t="mine">내 스킬</button><button data-t="new">${p.edit ? '스킬 편집' : '새로 만들기'}</button><button data-t="fuse">${ic('flask', 15)} 융합</button><i class="seg-ind"></i></div>
    <div class="sk-body scroll"></div>`;
  const body = $('.sk-body', el);
  const tabs = ['mine', 'new', 'fuse'];
  const setTab = (t, anim = true) => {
    const prev = tabs.indexOf(p.tab), nx = tabs.indexOf(t); p.tab = t; if (t !== 'new') p.edit = null;
    $$('.seg button', el).forEach(b => b.classList.toggle('on', b.dataset.t === t)); $('.seg-ind', el).style.transform = `translateX(${nx * 100}%)`;
    $('.seg [data-t=new]', el).textContent = p.edit ? '스킬 편집' : '새로 만들기';
    if (body._leave) body._leave(); body._leave = null;
    ({ mine: skMine, new: skForm, fuse: skFuse })[t](body, u, p, setTab);
    if (anim) { body.style.animation = 'none'; void body.offsetWidth; body.style.animation = `${nx >= prev ? 'tabInR' : 'tabInL'} .35s`; }
    $('.coin-pill b', el).textContent = coinText(u);
  };
  $$('.seg button', el).forEach(b => b.onclick = () => setTab(b.dataset.t));
  el._leave = () => body._leave && body._leave();
  setTab(p.tab, false);
});

function skMine(body, u, p, setTab) {
  const mine = Object.values(D.skills).filter(s => s.owner === u.uid).sort((a, b) => b.created - a.created);
  body.innerHTML = `${slotsHTML(u)}
    <div class="sk-list">${mine.length ? mine.map(s => { const on = (u.equipped || [])[0] === s.id, con = isCrit(u, s); return skCard(s, `<button class="sa ${on ? 'on' : ''}" data-a="eq">${on ? '해제' : '장착'}</button>${u.critUnlocked ? `<button class="sa crit ${con ? 'on' : ''}" data-a="crit">${con ? '크리티컬 해제' : '크리티컬'}</button>` : ''}<button class="sa gold" data-a="up" ${s.lv >= 10 ? 'disabled' : ''}>${ic('up', 14)}${s.lv >= 10 ? 'MAX' : COIN + s.lv}</button><button class="sa ${s.shared ? 'on' : ''}" data-a="share">${ic('share', 14)}${s.shared ? '공유중' : '공유'}</button><button class="sa" data-a="snd">${ic('volume', 14)}</button><button class="sa" data-a="edit">${ic('pencil', 14)}</button><button class="sa del" data-a="del">${ic('x', 14)}</button>`); }).join('') : '<p class="muted center">아직 스킬이 없어요</p>'}</div>
    <p class="muted sm center">업그레이드: 레벨마다 위력 +15%, 쿨타임 -4% · 비용 = 현재 레벨 코인 (1승 = 1코인)</p>`;
  body.onclick = async e => {
    const un = e.target.closest('[data-un]'); if (un) { equipToggle(u, un.dataset.un, !!un.dataset.crit); return skMine(body, u, p, setTab); }
    if (e.target.closest('[data-buy]')) { if (await buyCrit(u)) { skMine(body, u, p, setTab); const cp = $('.coin-pill b'); if (cp) cp.textContent = coinText(u); } return; }
    const b = e.target.closest('[data-a]'); if (!b) return; const s = D.skills[b.closest('[data-id]').dataset.id], a = b.dataset.a;
    if (a === 'eq' || a === 'crit') { equipToggle(u, s.id, a === 'crit'); skMine(body, u, p, setTab); }
    if (a === 'up') {
      if (s.lv >= 10) return; if (!spend(u, s.lv)) return toast(`코인이 부족해요 (필요 ${s.lv}, 보유 ${u.coins})`);
      s.lv++; save('users', 'skills'); AUD.sfx('coin'); skMine(body, u, p, setTab);
      const c = $(`[data-id="${s.id}"]`, body); c && c.classList.add('lvup'); toast(`${s.name} Lv.${s.lv} 달성!`);
      $('.coin-pill b').textContent = coinText(u);
    }
    if (a === 'share') { s.shared = !s.shared; save('skills'); toast(s.shared ? '스킬을 공유했어요. 다른 사람이 쓸 수 있어요' : '공유를 껐어요'); skMine(body, u, p, setTab); }
    if (a === 'snd') AUD.skill(s.sound);
    if (a === 'edit') { p.edit = s.id; setTab('new'); }
    if (a === 'del' && await ask(`'${esc(s.name)}' 스킬을 삭제할까요?`, '삭제', true)) { removeSkill(s); skMine(body, u, p, setTab); }
  };
}

function skForm(body, u, p, setTab) {
  const ed = p.edit && D.skills[p.edit];
  const st = ed ? JSON.parse(JSON.stringify(ed)) : { name: '', color: SK_COLORS[0], comps: [], cd: 6, sound: 'pop', media: null };
  body.innerHTML = `<div class="sk-form">
    <label class="lbl">스킬 이름</label><input class="inp" id="sf-n" maxlength="14" placeholder="예) 초록 폭풍" value="${esc(st.name)}">
    <label class="lbl">색상</label><div class="colors">${SK_COLORS.map(c => `<button class="sw" data-c="${c}" style="--c:${c}"></button>`).join('')}<input type="color" id="sf-c" value="${st.color}"></div>
    <label class="lbl">효과 조합 <small class="muted">여러 개를 골라 섞을 수 있어요 (최대 4개)</small></label>
    <div class="comp-grid">${COMP_KEYS.map(k => `<button class="comp" data-k="${k}">${ic(COMPS[k][1], 22)}<b>${COMPS[k][0]}</b><small>${COMPS[k][2]}</small></button>`).join('')}</div>
    <label class="lbl">쿨타임 <output id="sf-cdv"></output></label><input type="range" id="sf-cd" min="3" max="15" step="0.5" value="${st.cd}">
    <div class="pow"><span>위력</span><div class="pow-bar"><i></i></div><b id="sf-pw"></b></div>
    <p class="muted sm">쿨타임이 길수록 위력이 세져요. 효과를 여러 개 섞으면 하나하나는 약해지지만 합치면 더 강해요.</p>
    <label class="lbl">${ic('music', 16)} 스킬 소리</label>
    <div class="chips" id="sf-snd">${Object.entries(SOUNDS).map(([k, n]) => `<button class="chip" data-s="${k}">${n}</button>`).join('')}<button class="chip" data-s="__up">${ic('upload', 14)} 파일</button></div>
    <label class="lbl">${ic('film', 16)} 스킬 영상·사진 <small class="muted">발동할 때 공 위에 나와요 · 배경 제거 가능</small></label>
    <div class="mbox"></div>
    <div class="chips"><button class="chip" id="sf-mp">${ic('upload', 14)} 갤러리에서 선택</button><button class="chip" id="sf-me">${ic('wand', 14)} 편집·배경제거</button><button class="chip" id="sf-md">${ic('x', 14)} 제거</button></div>
    <button class="btn-play w100" id="sf-save">${ic('check', 20)} ${ed ? '수정 완료' : '스킬 만들기'}</button></div>`;
  let player = null;
  body._leave = () => player && player.destroy();
  const sync = () => {
    $$('.sw', body).forEach(b => b.classList.toggle('on', b.dataset.c === st.color));
    $$('.comp', body).forEach(b => b.classList.toggle('on', st.comps.includes(b.dataset.k)));
    $$('#sf-snd .chip', body).forEach(b => b.classList.toggle('on', b.dataset.s === st.sound || (b.dataset.s === '__up' && AUD.isFile(st.sound))));
    const tmp = { ...st, lv: ed ? ed.lv : 1, fused: ed ? ed.fused : false, comps: st.comps.length ? st.comps : ['proj'] };
    $('#sf-cdv', body).textContent = skillCD(tmp) + '초'; const pw = st.comps.length ? skillPower(tmp) * Math.min(st.comps.length, 1 + (st.comps.length - 1) * .45) : 0;
    $('#sf-pw', body).textContent = '×' + (st.comps.length ? skillPower(tmp).toFixed(2) + ' (각 효과)' : '-'); $('.pow-bar i', body).style.width = Math.min(100, pw * 40) + '%';
  };
  const mediaBox = async () => {
    player && player.destroy(); player = null; const box = $('.mbox', body);
    if (!st.media) { box.innerHTML = `<div class="mbox-empty">${ic('image', 30)}<small>영상이나 사진을 넣어보세요</small></div>`; return; }
    box.innerHTML = ''; const url = await mediaSrc(st.media); if (!url) return;
    player = makePlayer(box, url, st.media.kind, st.media.edits, { fit: 'contain', muted: true }); player.play();
  };
  $('#sf-n', body).oninput = e => st.name = e.target.value;
  $('#sf-c', body).oninput = e => { st.color = e.target.value; sync(); };
  $$('.sw', body).forEach(b => b.onclick = () => { st.color = b.dataset.c; $('#sf-c', body).value = st.color; sync(); });
  $$('.comp', body).forEach(b => b.onclick = () => { const k = b.dataset.k, i = st.comps.indexOf(k); if (i >= 0) st.comps.splice(i, 1); else if (st.comps.length >= 4) toast('효과는 최대 4개까지 섞을 수 있어요'); else { st.comps.push(k); b.classList.add('pop'); setTimeout(() => b.classList.remove('pop'), 300); } sync(); });
  $('#sf-cd', body).oninput = e => { st.cd = +e.target.value; sync(); };
  $$('#sf-snd .chip', body).forEach(b => b.onclick = async () => {
    const s = b.dataset.s;
    if (s === '__up') { const f = await pickFile('audio/*'); if (!f) return; if (f.size > 2e5) return toast('200KB 이하 짧은 소리 파일만 넣을 수 있어요'); st.sound = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }); }
    else st.sound = s;
    AUD.skill(st.sound); sync();
  });
  $('#sf-mp', body).onclick = async () => {
    const f = await pickFile('image/*,video/*'); if (!f) return; if (f.size > 40e6) return toast('40MB 이하 파일만 넣을 수 있어요');
    const kind = f.type.startsWith('video') ? 'video' : 'image', key = await putBlob(f, 'm'), url = await blobURL(key);
    openEditor(url, kind, { key: { mode: 'ai', c: '#00ff00', tol: 90, soft: 50 } }, async e => { st.media = { key, kind, edits: e }; mediaBox(); const asset = await shareBlob(key); if (asset && st.media && st.media.key === key) st.media.asset = asset; }, { ratio: 1 });
  };
  $('#sf-me', body).onclick = async () => { if (!st.media) return toast('먼저 영상이나 사진을 넣어주세요'); const url = await mediaSrc(st.media); openEditor(url, st.media.kind, st.media.edits, e => { st.media.edits = e; mediaBox(); }, { ratio: 1 }); };
  $('#sf-md', body).onclick = () => { st.media = null; mediaBox(); };
  $('#sf-save', body).onclick = () => {
    const name = st.name.trim(); if (!name) return toast('스킬 이름을 적어주세요'); if (!st.comps.length) return toast('효과를 1개 이상 골라주세요');
    if (ed) { Object.assign(ed, { name, color: st.color, comps: st.comps, cd: st.cd, sound: st.sound, media: st.media }); save('skills'); toast('스킬을 수정했어요'); }
    else { const s = mkSkill(u.uid, name, st.color, st.comps, st.cd, { sound: st.sound, media: st.media }); if (!(u.equipped || []).some(id => usable(u, D.skills[id]))) equipToggle(u, s.id, false); save('skills'); toast(`'${name}' 스킬 완성!`); AUD.sfx('ding'); }
    setTab('mine');
  };
  sync(); mediaBox();
}

function skFuse(body, u, p, setTab) {
  const mine = Object.values(D.skills).filter(s => s.owner === u.uid);
  const sel = [];
  body.innerHTML = `<div class="fuse"><p class="muted sm center">내 스킬 2개를 골라 융합하면 효과가 합쳐진 새 스킬이 생겨요 (위력 +10%)</p>
    <div class="fuse-slots"><div class="fslot" data-i="0">${ic('plus', 26)}</div><div class="fuse-ic">${ic('flask', 30)}</div><div class="fslot" data-i="1">${ic('plus', 26)}</div></div>
    <div class="fuse-res"></div>
    <div class="sk-list pick">${mine.map(s => skCard(s, '')).join('') || '<p class="muted center">스킬이 2개 이상 있어야 해요</p>'}</div></div>`;
  const render = () => {
    $$('.fslot', body).forEach((f, i) => { const s = sel[i]; f.innerHTML = s ? `${skIcon(s)}<small>${esc(s.name)}</small>` : ic('plus', 26); f.classList.toggle('on', !!s); });
    $$('.sk-list .sk-card', body).forEach(c => c.classList.toggle('sel', sel.some(s => s.id === c.dataset.id)));
    const r = $('.fuse-res', body);
    if (sel.length < 2) { r.innerHTML = ''; return; }
    const [a, b] = sel, comps = [...new Set([...a.comps, ...b.comps])].slice(0, 5), cd = Math.round(((a.cd + b.cd) / 2 + 1) * 2) / 2;
    const tmp = { name: a.name.slice(0, 7) + b.name.slice(0, 7), color: a.color, comps, cd, lv: 1, fused: true, sound: a.sound, media: a.media || b.media };
    r.innerHTML = `<div class="fuse-prev">${skCard(tmp, '')}<input class="inp" id="fz-n" maxlength="14" value="${esc(tmp.name)}"><button class="btn-play w100" id="fz-go">${ic('flask', 20)} 융합하기</button></div>`;
    $('#fz-go', body).onclick = () => {
      tmp.name = $('#fz-n', body).value.trim() || tmp.name;
      $('.fuse-slots', body).classList.add('merging'); AUD.sfx('boom');
      setTimeout(() => { const s = mkSkill(u.uid, tmp.name, tmp.color, tmp.comps, tmp.cd, { fused: true, sound: tmp.sound, media: tmp.media ? JSON.parse(JSON.stringify(tmp.media)) : null }); save('skills'); AUD.sfx('ding'); toast(`융합 성공! '${s.name}'`); setTab('mine'); }, 900);
    };
  };
  body.onclick = e => {
    const c = e.target.closest('.sk-list .sk-card'); if (!c) { const f = e.target.closest('.fslot'); if (f && sel[+f.dataset.i]) { sel.splice(+f.dataset.i, 1); render(); } return; }
    const s = D.skills[c.dataset.id], i = sel.findIndex(x => x.id === s.id);
    if (i >= 0) sel.splice(i, 1); else if (sel.length < 2) sel.push(s); else { sel[1] = s; }
    render();
  };
  render();
}

// 다른 사람이 공유한 스킬 쓰기
screen('shared', el => {
  const u = me();
  const render = () => {
    const list = Object.values(D.skills).filter(s => s.shared && s.owner !== u.uid && D.users[s.owner] && !D.users[s.owner].banned).sort((a, b) => b.lv - a.lv || b.created - a.created);
    el.innerHTML = `<div class="hdr"><button class="icon-btn" data-back>${ic('back')}</button><h2>다른 사람 스킬 쓰기</h2><span></span></div>
      <div class="scroll pad"><p class="muted sm center">다른 사람이 <b>공유</b>한 스킬만 쓸 수 있어요. 내 스킬은 스킬 제작에서 공유할 수 있어요.</p>
      ${slotsHTML(u)}
      <div class="sk-list">${list.length ? list.map(s => { const o = D.users[s.owner], on = (u.equipped || [])[0] === s.id, con = isCrit(u, s); return skCard(s, `<button class="sa" data-a="snd">${ic('volume', 14)} 소리</button><button class="sa ${on ? 'on' : ''}" data-a="eq">${on ? '해제' : '장착해서 쓰기'}</button>${u.critUnlocked ? `<button class="sa crit ${con ? 'on' : ''}" data-a="crit">${con ? '크리티컬 해제' : '크리티컬로 쓰기'}</button>` : ''}`, `<div class="sk-owner">${avImg(o, 'av-xs')}<span>${nameHTML(o)}</span><small class="muted">@${esc(o.handle)}</small></div>`); }).join('') : '<p class="muted center">아직 공유된 스킬이 없어요</p>'}</div></div>`;
  };
  el.onclick = async e => {
    const un = e.target.closest('[data-un]'); if (un) { equipToggle(u, un.dataset.un, !!un.dataset.crit); return render(); }
    if (e.target.closest('[data-buy]')) { if (await buyCrit(u)) render(); return; }
    const b = e.target.closest('[data-a]'); if (!b) return; const s = D.skills[b.closest('[data-id]').dataset.id], a = b.dataset.a;
    if (a === 'snd') AUD.skill(s.sound);
    if ((a === 'eq' || a === 'crit') && equipToggle(u, s.id, a === 'crit')) { toast((u.equipped || [])[0] === s.id || u.crit === s.id ? `'${s.name}' 장착` : '해제했어요'); render(); }
  };
  render();
});
