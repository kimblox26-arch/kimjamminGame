'use strict';
// ===== 공 스킬 제작 / 융합 / 업그레이드 / 다른 사람 스킬 =====
const SK_COLORS = ['#ff6a3d', '#ffd43b', '#7cff6b', '#25F4EE', '#3d8bff', '#b46bff', '#FE2C55', '#111111'];
const compChips = s => s.spec ? [optName('spawn', s.spec.spawn), s.spec.spawn === 'dash' ? '' : optName('move', s.spec.move), s.spec.effect !== 'none' ? optName('effect', s.spec.effect) : '', `피해 ${s.spec.dmg}${s.spec.spawn !== 'dash' && s.spec.count > 1 ? '×' + s.spec.count : ''}`].filter(Boolean).map(t => `<span class="cchip">${t}</span>`).join('')
  : (s.comps || []).map(c => `<span class="cchip">${ic(COMPS[c][1], 13)}${COMPS[c][0]}</span>`).join('');
const skIcon = s => `<div class="sk-ic" style="--c:${s.color}">${s.pic ? `<img src="${s.pic}" alt="">` : ic(skIc(s), 26)}${(s.comps || []).length > 1 ? `<b>+${s.comps.length - 1}</b>` : ''}</div>`;
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
  const one = (s, label, crit) => s ? `<button class="slot on ${crit ? 'crit' : ''}" data-un="${s.id}" data-crit="${crit ? 1 : ''}" style="--c:${s.color}">${ic(skIc(s), 22)}<small>${esc(s.name)}</small><em>${label}</em></button>` : `<div class="slot ${crit ? 'crit' : ''}">${ic('plus', 20)}<small>${label} 빈 칸</small></div>`;
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
    <p class="muted sm center">업그레이드: 레벨마다 위력 +15% · 비용 = 현재 레벨 코인 (1승 = 1코인)</p>`;
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
  const st = ed ? JSON.parse(JSON.stringify(ed)) : { name: '', color: SK_COLORS[0], cd: 6, sound: 'none', media: null, pic: null };
  const P = st.spec = { ...SPEC0, ...(st.spec || {}) };
  const chips = k => `<div class="chips" data-ck="${k}">${SPEC_OPT[k].map(([v, n]) => `<button class="chip" data-v="${v}">${n}</button>`).join('')}</div>`;
  const rng = (k, label, min, max, step, unit = '') => `<label class="ed-rng sp-rng"><span>${label}</span><input type="range" data-sk="${k}" min="${min}" max="${max}" step="${step}" value="${P[k]}"><output data-u="${unit}"></output></label>`;
  const tg = (k, label) => `<button class="chip" data-tk="${k}">${label}</button>`;
  body.innerHTML = `<div class="sk-form">
    <div class="sp-prev"><canvas width="300" height="300"></canvas><div class="sp-meter"><span>위력 사용량</span><div class="pow-bar"><i></i></div><b id="sp-cost"></b></div><small class="sp-warn"></small></div>
    <label class="lbl">스킬 이름</label><input class="inp" id="sf-n" maxlength="14" placeholder="예) 초록 폭풍" value="${esc(st.name)}">
    <label class="lbl">색상</label><div class="colors">${SK_COLORS.map(c => `<button class="sw" data-c="${c}" style="--c:${c}"></button>`).join('')}<input type="color" id="sf-c" value="${st.color}"></div>
    <div class="sp-sec"><h4>${ic('sparkle', 16)} 스타일</h4>
      <label class="lbl">모양</label>${chips('shape')}
      <div class="chips"><button class="chip on-key" id="sf-draw">${ic('pencil', 14)} 그림 그리기</button></div>
      ${rng('size', '크기', 6, 40, 1)}
      <div class="chips">${tg('trail', '꼬리 효과')}${tg('glow', '빛나기')}${tg('spin', '빙글빙글')}</div></div>
    <div class="sp-sec"><h4>${ic('gauge', 16)} 작동 원리</h4>
      <label class="lbl">어디서 나와요?</label>${chips('spawn')}
      <label class="lbl">어떻게 움직여요?</label>${chips('move')}
      ${rng('count', '개수', 1, 8, 1, '개')}${rng('spread', '퍼짐', 0, 360, 5, '°')}${rng('speed', '속도', 80, 600, 10)}${rng('life', '지속', .3, 5, .1, '초')}</div>
    <div class="sp-sec"><h4>${ic('burst', 16)} 맞으면</h4>
      ${rng('dmg', '피해', 1, 30, 1)}${rng('knock', '밀어내기', 0, 600, 10)}${rng('explode', '폭발 범위', 0, 120, 5)}
      <label class="lbl">추가 효과</label>${chips('effect')}<div class="chips">${tg('pierce', '관통 (여러 번 맞힘)')}</div></div>
    <div class="sp-sec"><h4>${ic('heal', 16)} 쓸 때 내 공</h4>${rng('heal', '회복', 0, 30, 1)}${rng('shield', '방어막', 0, 40, 1)}</div>
    <div class="sp-sec"><h4>${ic('film', 16)} 발동할 때 나오는 영상·사진 <small class="muted">선택</small></h4><div class="mbox"></div>
      <div class="chips"><button class="chip" id="sf-mp">${ic('upload', 14)} 갤러리에서 선택</button><button class="chip" id="sf-me">${ic('wand', 14)} 편집·배경제거</button><button class="chip" id="sf-md">${ic('x', 14)} 제거</button></div></div>
    <div class="sp-sec"><h4>${ic('music', 16)} 스킬 소리 <small class="muted">영상 소리를 잘라서 만들어요</small></h4>
      <div class="snd-box"><span class="snd-st"></span><div class="chips"><button class="chip on-key" id="sf-sm">${ic('film', 14)} 영상에서 소리 만들기</button><button class="chip" id="sf-sp">${ic('play', 14)} 듣기</button><button class="chip" id="sf-sd">${ic('x', 14)} 없애기</button></div></div></div>
    <button class="btn-play w100" id="sf-save">${ic('check', 20)} ${ed ? '수정 완료' : '스킬 만들기'}</button></div>`;
  let player = null, rb = 0;
  const prev = specPreview($('.sp-prev canvas', body), () => ({ ...st, sound: 'none', media: null, lv: ed ? ed.lv : 1, fused: ed ? ed.fused : false, spec: { ...P } }));
  body._leave = () => { player && player.destroy(); prev.stop(); };
  const sync = (rebuild = true) => {
    $$('.sw', body).forEach(b => b.classList.toggle('on', b.dataset.c === st.color));
    $$('[data-ck]', body).forEach(g => $$('.chip', g).forEach(b => b.classList.toggle('on', P[g.dataset.ck] === b.dataset.v)));
    $$('[data-tk]', body).forEach(b => b.classList.toggle('on', !!P[b.dataset.tk]));
    $$('[data-sk]', body).forEach(i => { const o = i.nextElementSibling; o.textContent = (+P[i.dataset.sk]).toFixed(+i.step < 1 ? 1 : 0) + o.dataset.u; });
    const cost = specCost(P), over = cost > SPEC_BUDGET, bar = $('.sp-meter .pow-bar i', body);
    bar.style.width = Math.min(100, cost / SPEC_BUDGET * 100) + '%'; bar.style.background = over ? '#e03131' : ''; $('#sp-cost', body).textContent = `${Math.round(cost)} / ${SPEC_BUDGET}`;
    $('.sp-warn', body).textContent = over ? `너무 강해서 위력이 ${Math.round(specScale(P) * 100)}%로 줄어요` : '';
    $('.snd-st', body).textContent = st.sound && st.sound.startsWith('data:') ? `영상 소리 ${st.sndLen ? st.sndLen + '초' : ''}` : st.sound && st.sound !== 'none' ? '예전 소리' : '소리 없음';
    if (rebuild) { clearTimeout(rb); rb = setTimeout(() => prev.rebuild(), 150); }
  };
  const mediaBox = async () => {
    player && player.destroy(); player = null; const box = $('.mbox', body);
    if (!st.media) { box.innerHTML = `<div class="mbox-empty">${ic('image', 28)}<small>없음</small></div>`; return; }
    box.innerHTML = ''; const url = await mediaSrc(st.media); if (!url) return;
    player = makePlayer(box, url, st.media.kind, st.media.edits, { fit: 'contain', muted: true }); player.play();
  };
  body.oninput = e => { const k = e.target.dataset.sk; if (k) { P[k] = +e.target.value; sync(); } };
  body.onclick = e => {
    const c = e.target.closest('[data-ck] .chip'); if (c) { const k = c.parentElement.dataset.ck; if (k === 'shape' && c.dataset.v === 'drawing' && !st.pic) { toast('먼저 그림을 그려주세요'); return $('#sf-draw', body).click(); } P[k] = c.dataset.v; return sync(); }
    const t = e.target.closest('[data-tk]'); if (t) { P[t.dataset.tk] = !P[t.dataset.tk]; return sync(); }
  };
  $('#sf-n', body).oninput = e => st.name = e.target.value;
  $('#sf-c', body).oninput = e => { st.color = e.target.value; sync(); };
  $$('.sw', body).forEach(b => b.onclick = () => { st.color = b.dataset.c; $('#sf-c', body).value = st.color; sync(); });
  $('#sf-draw', body).onclick = async () => {
    const base = st.drawKey ? await blobURL(st.drawKey) : st.pic;
    openDraw(base, async (blob, pic) => { st.pic = pic; P.shape = 'drawing'; sync(); st.drawKey = await putBlob(blob, 'd'); });
  };
  $('#sf-sm', body).onclick = () => openSoundMaker((url, len) => { st.sound = url; st.sndLen = len; AUD.bufs[url] = null; AUD.skill(url); sync(false); });
  $('#sf-sp', body).onclick = () => { if (!st.sound || st.sound === 'none') return toast('먼저 소리를 만들어주세요'); AUD.skill(st.sound); };
  $('#sf-sd', body).onclick = () => { st.sound = 'none'; st.sndLen = 0; sync(false); };
  $('#sf-mp', body).onclick = async () => {
    const f = await pickFile('image/*,video/*'); if (!f) return; if (f.size > 40e6) return toast('40MB 이하 파일만 넣을 수 있어요');
    const kind = f.type.startsWith('video') ? 'video' : 'image', key = await putBlob(f, 'm'), url = await blobURL(key);
    openEditor(url, kind, { key: { mode: 'ai', c: '#00ff00', tol: 90, soft: 50 } }, async e => { st.media = { key, kind, edits: e }; mediaBox(); const asset = await shareBlob(key); if (asset && st.media && st.media.key === key) st.media.asset = asset; }, { ratio: 1 });
  };
  $('#sf-me', body).onclick = async () => { if (!st.media) return toast('먼저 영상이나 사진을 넣어주세요'); const url = await mediaSrc(st.media); openEditor(url, st.media.kind, st.media.edits, e => { st.media.edits = e; mediaBox(); }, { ratio: 1 }); };
  $('#sf-md', body).onclick = () => { st.media = null; mediaBox(); };
  $('#sf-save', body).onclick = () => {
    const name = st.name.trim(); if (!name) return toast('스킬 이름을 적어주세요');
    if (P.shape === 'drawing' && !st.pic) P.shape = 'circle';
    const data = { name, color: st.color, comps: [], cd: SKILL_CD, spec: { ...P }, sound: st.sound, sndLen: st.sndLen || 0, media: st.media, pic: st.pic || null, drawKey: st.drawKey || null };
    if (ed) { Object.assign(ed, data); save('skills'); toast('스킬을 수정했어요'); }
    else { const sk = mkSkill(u.uid, name, st.color, [], SKILL_CD, data); if (!(u.equipped || []).some(id => usable(u, D.skills[id]))) equipToggle(u, sk.id, false); save('skills'); toast(`'${name}' 스킬 완성!`); AUD.sfx('ding'); }
    setTab('mine');
  };
  sync(false); mediaBox();
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
    const [a, b] = sel, A = a.spec, B = b.spec;
    const spec = A || B ? { ...SPEC0, ...(A || B), ...(A && B ? { effect: B.effect !== 'none' ? B.effect : A.effect, explode: Math.max(A.explode, B.explode), heal: Math.max(A.heal, B.heal), shield: Math.max(A.shield, B.shield), pierce: A.pierce || B.pierce, count: Math.max(A.count, B.count) } : {}) } : null;
    const comps = spec ? [] : [...new Set([...(a.comps || []), ...(b.comps || [])])].slice(0, 5), cd = SKILL_CD;
    const tmp = { name: a.name.slice(0, 7) + b.name.slice(0, 7), color: a.color, comps, cd, spec, lv: 1, fused: true, sound: a.sound, media: a.media || b.media, pic: a.pic || b.pic || null };
    r.innerHTML = `<div class="fuse-prev">${skCard(tmp, '')}<input class="inp" id="fz-n" maxlength="14" value="${esc(tmp.name)}"><button class="btn-play w100" id="fz-go">${ic('flask', 20)} 융합하기</button></div>`;
    $('#fz-go', body).onclick = () => {
      tmp.name = $('#fz-n', body).value.trim() || tmp.name;
      $('.fuse-slots', body).classList.add('merging'); AUD.sfx('boom');
      setTimeout(() => { const s = mkSkill(u.uid, tmp.name, tmp.color, tmp.comps, tmp.cd, { fused: true, spec: tmp.spec, pic: tmp.pic, sound: tmp.sound, media: tmp.media ? JSON.parse(JSON.stringify(tmp.media)) : null }); save('skills'); AUD.sfx('ding'); toast(`융합 성공! '${s.name}'`); setTab('mine'); }, 900);
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
