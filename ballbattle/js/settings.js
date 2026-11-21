'use strict';
// ===== 설정 =====
const SET_DEF = { sfx: true, vol: 80, click: true, skillSnd: true, countSnd: true, dmgNum: true, shake: true, trail: true, autoRec: true, recQ: 'mid', reduceMotion: false, fontSize: 'mid', autoplay: true, muteVideo: false, dataSaver: false };
const SET = Object.assign({}, SET_DEF, LS.get('settings', {}));
function setOpt(k, v) { SET[k] = v; LS.set('settings', SET); applySettings(); }
function applySettings() {
  document.body.classList.toggle('reduce-motion', !!SET.reduceMotion);
  const a = $('#app'); if (a) a.style.zoom = { sm: .92, mid: 1, lg: 1.1 }[SET.fontSize] || 1;
  if (AUD.master) AUD.master.gain.value = SET.sfx ? SET.vol / 100 * .9 : 0;
}
const coinText = u => u.inf ? '무한' : fmtN(u.coins);
function spend(u, n) { if (u.inf) return true; if (u.coins < n) return false; u.coins -= n; return true; }

const stSw = (k, label, sub, on) => `<label class="st-row"><div class="st-t"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</div><input type="checkbox" class="switch" data-set="${k}" ${(on ?? SET[k]) ? 'checked' : ''}></label>`;
const stNav = (id, label, icn, val = '', cls = '') => `<button class="st-row ${cls}" data-nav="${id}">${ic(icn, 20)}<div class="st-t"><b>${label}</b></div><span class="st-val">${val}</span>${ic('chevR', 18)}</button>`;
const stSeg = (k, label, opts) => `<div class="st-row"><div class="st-t"><b>${label}</b></div><div class="st-seg">${opts.map(([v, n]) => `<button data-seg="${k}" data-v="${v}" class="${SET[k] === v ? 'on' : ''}">${n}</button>`).join('')}</div></div>`;
const stRng = (k, label) => `<div class="st-row"><div class="st-t"><b>${label}</b></div><input type="range" class="st-rng" min="0" max="100" data-rng="${k}" value="${SET[k]}"><span class="st-val">${SET[k]}</span></div>`;
const stGroup = (title, rows) => `<div class="st-g">${title ? `<div class="st-h">${title}</div>` : ''}<div class="st-card">${rows.join('')}</div></div>`;
function bindSettings(el, onNav, onUser) {
  el.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.set) { if (t.dataset.set.startsWith('u.')) onUser(t.dataset.set.slice(2), t.checked); else setOpt(t.dataset.set, t.checked); }
  });
  el.addEventListener('input', e => { const t = e.target; if (t.dataset.rng) { setOpt(t.dataset.rng, +t.value); t.nextElementSibling.textContent = t.value; } });
  el.addEventListener('click', e => {
    const s = e.target.closest('[data-seg]'); if (s) { setOpt(s.dataset.seg, s.dataset.v); $$(`[data-seg="${s.dataset.seg}"]`, el).forEach(b => b.classList.toggle('on', b === s)); return; }
    const n = e.target.closest('[data-nav]'); if (n) onNav(n.dataset.nav);
  });
}

screen('settings', el => {
  const u = me(), recs = D.recs.filter(r => r.uid === u.uid);
  el.innerHTML = `<div class="hdr light"><button class="icon-btn" data-back>${ic('back')}</button><h2>설정</h2><span></span></div><div class="scroll st">
    ${stGroup('계정', [stNav('edit', '프로필 편집', 'pencil'), stNav('pw', '비밀번호 변경', 'lock'), stNav('privacy', '개인정보', 'eye')])}
    ${stGroup('소리', [stSw('sfx', '효과음'), stRng('vol', '효과음 크기'), stSw('click', '버튼 소리'), stSw('skillSnd', '스킬 소리'), stSw('countSnd', '카운트다운 소리')])}
    ${stGroup('게임', [stSw('dmgNum', '피해 숫자 보이기'), stSw('shake', '화면 흔들림'), stSw('trail', '공 꼬리 효과'), stSw('autoRec', '플레이 자동 녹화'), stSeg('recQ', '녹화 화질', [['low', '낮음'], ['mid', '보통'], ['high', '높음']])])}
    ${stGroup('화면', [stSw('reduceMotion', '애니메이션 줄이기'), stSeg('fontSize', '글자 크기', [['sm', '작게'], ['mid', '보통'], ['lg', '크게']])])}
    ${stGroup('영상', [stSw('autoplay', '영상 자동 재생'), stSw('muteVideo', '소리 끄고 시작'), stSw('dataSaver', '데이터 절약', '영상을 누를 때만 재생해요')])}
    ${stGroup('도움', [stNav('bug', '버그 제보', 'bug', `${COIN} +${BUG_REWARD}`)])}
    ${stGroup('저장 공간', [`<div class="st-row"><div class="st-t"><b>플레이 영상</b><small>${recs.length}개 저장됨</small></div><button class="st-btn" data-clear>모두 지우기</button></div>`])}
    ${isDev(u) ? stGroup('개발자', [stNav('mailbox', '우편함', 'mail', unreadMail() || ''), stNav('ban', '플레이어 밴', 'ban'), stNav('verify', '인증마크 주기', 'check')]) : ''}
    ${stGroup('정보', [`<div class="st-row"><div class="st-t"><b>게임</b></div><span class="st-val">${esc(T)}</span></div>`, `<div class="st-row"><div class="st-t"><b>버전</b></div><span class="st-val">1</span></div>`, `<div class="st-row"><div class="st-t"><b>온라인</b></div><span class="st-val">${NET.ok ? '연결됨' : '이 기기에만 저장'}</span></div>`])}
    <button class="st-logout">${ic('logout', 18)} 로그아웃</button></div>`;
  bindSettings(el, id => {
    if (id === 'edit') go('edit'); if (id === 'privacy') go('privacy'); if (id === 'pw') changePw(u);
    if (id === 'mailbox') go('mailbox'); if (id === 'bug') bugReport(u); if (id === 'ban') banModal(''); if (id === 'verify') verifyModal('');
  });
  $('[data-clear]', el).onclick = async () => {
    if (!recs.length) return toast('지울 영상이 없어요');
    if (!await ask(`플레이 영상 ${recs.length}개를 모두 지울까요?`, '지우기', true)) return;
    recs.forEach(r => { if (!D.posts.some(p => p.key === r.key)) IDB.del(r.key); }); D.recs = D.recs.filter(r => r.uid !== u.uid); save('recs'); toast('지웠어요'); refresh();
  };
  $('.st-logout', el).onclick = logout;
});

screen('privacy', el => {
  const u = me(); let taps = 0;
  el.innerHTML = `<div class="hdr light"><button class="icon-btn" data-back>${ic('back')}</button><h2 class="pv-title">개인정보</h2><span></span></div><div class="scroll st">
    ${stGroup('', [stSw('u.private', '비공개 계정', '다른 사람이 내 영상을 볼 수 없어요', u.private), stSw('u.hideFollow', '구독 수 숨기기', '다른 사람에게 구독중·구독자 수를 숨겨요', u.hideFollow)])}
    ${stGroup('내 정보', [`<div class="st-row"><div class="st-t"><b>아이디</b></div><span class="st-val">@${esc(u.handle)}</span></div>`, `<div class="st-row"><div class="st-t"><b>이메일</b></div><span class="st-val">${esc(u.email || '-')}</span></div>`, `<div class="st-row"><div class="st-t"><b>나이</b></div><span class="st-val">${u.age || '-'}</span></div>`])}
    <div class="st-g hack-g" hidden>${`<div class="st-card">${stNav('hack', '해킹', 'wand')}</div>`}</div></div>`;
  // 숨겨진 해킹 메뉴: '개인정보' 제목을 5번 누르면 나타나요
  $('.pv-title', el).onclick = () => { if (++taps >= 5) $('.hack-g', el).hidden = false; };
  bindSettings(el, id => { if (id === 'hack') hackLogin(); }, (k, v) => { u[k] = v; save('users'); toast('저장했어요'); });
});
function hackLogin() {
  const m = modal(`<h3 class="m-title">${ic('lock')} 해킹</h3><input class="inp" id="hk-p" type="password" placeholder="비밀번호"><div class="err" id="hk-e"></div><div class="row2"><button class="btn-ghost" data-c>취소</button><button class="btn-main" id="hk-ok">확인</button></div>`);
  $('[data-c]', m).onclick = () => m.close();
  $('#hk-ok', m).onclick = async () => { if (await sha(DEV_UID + ':' + $('#hk-p', m).value) !== DEV_HASH) return $('#hk-e', m).textContent = '비밀번호가 틀렸어요'; m.close(); go('hack'); };
}
screen('hack', el => {
  const u = me();
  el.innerHTML = `<div class="hdr light"><button class="icon-btn" data-back>${ic('back')}</button><h2>해킹</h2><span></span></div><div class="scroll st">
    ${stGroup('', [stSw('u.inf', '돈 무한', '켜면 코인을 마음껏 쓸 수 있어요', u.inf)])}
    <p class="st-note">지금 코인: <b class="hk-c">${coinText(u)}</b></p></div>`;
  bindSettings(el, () => { }, (k, v) => { u[k] = v; save('users'); AUD.sfx('coin'); $('.hk-c', el).textContent = coinText(u); toast(v ? '돈 무한 켜짐' : '돈 무한 꺼짐'); });
});
function changePw(u) {
  if (u.uid === DEV_UID) return toast('개발자 비밀번호는 바꿀 수 없어요');
  const m = modal(`<h3 class="m-title">${ic('lock')} 비밀번호 변경</h3><input class="inp" id="pw0" type="password" placeholder="지금 비밀번호"><input class="inp" id="pw1" type="password" placeholder="새 비밀번호 (6자 이상)" style="margin-top:8px"><input class="inp" id="pw2" type="password" placeholder="새 비밀번호 확인" style="margin-top:8px"><div class="err" id="pwe"></div><div class="row2"><button class="btn-ghost" data-c>취소</button><button class="btn-main" id="pwok">바꾸기</button></div>`);
  $('[data-c]', m).onclick = () => m.close();
  $('#pwok', m).onclick = async () => {
    const e = $('#pwe', m), a = $('#pw0', m).value, b = $('#pw1', m).value;
    const cur = NET.ok ? (await getPriv(u.uid) || {}).pw : u.pw;
    if (await sha(u.uid + ':' + a) !== cur) return e.textContent = '지금 비밀번호가 틀렸어요';
    if (b.length < 6) return e.textContent = '새 비밀번호는 6자 이상이어야 해요';
    if (b !== $('#pw2', m).value) return e.textContent = '새 비밀번호가 서로 달라요';
    u.pw = await sha(u.uid + ':' + b);
    if (NET.ok) setPriv(u.uid, { pw: u.pw, email: u.email || '', age: u.age || 0 }); else save('users');
    m.close(); toast('비밀번호를 바꿨어요');
  };
}
function verifyModal(handle = '', onDone) {
  if (!isDev(me())) return;
  const m = modal(`<h3 class="m-title">${BADGE} 인증마크 주기</h3><label class="lbl">아이디</label><input class="inp" id="vf-h" value="${esc(handle)}" placeholder="틱톡 아이디" autocomplete="off"><div class="bn-who"></div><div class="row2"><button class="btn-ghost" data-c>취소</button><button class="btn-main" id="vf-ok">인증마크 주기</button></div>`);
  const hi = $('#vf-h', m), ok = $('#vf-ok', m), who = $('.bn-who', m);
  const upd = () => { const t = byHandle(hi.value); who.innerHTML = t ? `${avImg(t, 'av-xs')}<span>${nameHTML(t)}</span>` : (hi.value ? '<span class="muted">없는 아이디예요</span>' : ''); ok.textContent = t && t.verified ? '인증마크 빼기' : '인증마크 주기'; };
  hi.oninput = upd; upd(); $('[data-c]', m).onclick = () => m.close();
  ok.onclick = () => { const t = byHandle(hi.value); if (!t) return toast('아이디를 확인해주세요'); if (isDev(t)) return toast('개발자는 이미 인증돼 있어요'); t.verified = !t.verified; save('users'); m.close(); toast(t.verified ? `@${t.handle} 님에게 인증마크를 줬어요` : `@${t.handle} 님의 인증마크를 뺐어요`); onDone && onDone(); };
}

// ===== 버그 제보 → 개발자 우편함 =====
const BUG_REWARD = 10, BUG_GAP = 10 * 60 * 1000; // 같은 사람은 10분에 한 번
const unreadMail = () => D.bugs.filter(b => !b.read).length;
function bugReport(u) {
  const last = D.bugs.filter(b => b.uid === u.uid).sort((a, b) => b.t - a.t)[0];
  const m = modal(`<h3 class="m-title">${ic('bug')} 버그 제보</h3><p class="m-sub">제보하면 ${COIN} ${BUG_REWARD}코인을 드려요. 개발자 우편함으로 가요.</p>
    <div class="bug-who">${avImg(u, 'av-xs')}<span>${nameHTML(u)}</span><small class="muted">@${esc(u.handle)}</small></div>
    <textarea class="inp" id="bg-t" maxlength="500" rows="5" placeholder="어디서 어떤 문제가 생겼는지 적어주세요"></textarea><div class="err" id="bg-e"></div>
    <div class="row2"><button class="btn-ghost" data-c>취소</button><button class="btn-main" id="bg-ok">제보하기</button></div>`);
  $('[data-c]', m).onclick = () => m.close();
  $('#bg-ok', m).onclick = () => {
    const t = $('#bg-t', m).value.trim(), e = $('#bg-e', m);
    if (t.length < 5) return e.textContent = '5자 이상 적어주세요';
    if (last && Date.now() - last.t < BUG_GAP) return e.textContent = `제보는 10분에 한 번 할 수 있어요 (${Math.ceil((BUG_GAP - (Date.now() - last.t)) / 60000)}분 남음)`;
    D.bugs.unshift({ id: 'b_' + uid6(), uid: u.uid, text: t, t: Date.now(), read: false });
    u.coins += BUG_REWARD; save('bugs', 'users'); m.close(); AUD.sfx('coin'); toast(`제보 고마워요! ${BUG_REWARD}코인을 받았어요`);
  };
}
screen('mailbox', (el, p) => {
  const u = me(); if (!isDev(u)) return back();
  p.tab = p.tab || 'bugs';
  const render = () => {
    const bugs = D.bugs, reps = D.reports;
    const who = id => { const x = D.users[id]; return x ? `${avImg(x, 'av-xs')}<div class="ml-who"><span>${nameHTML(x)}</span><small>@${esc(x.handle)}</small></div>` : `<img class="av-xs" src="${avatarSrc({})}" alt=""><div class="ml-who"><span class="muted">탈퇴한 사용자</span></div>`; };
    const list = p.tab === 'bugs'
      ? bugs.map(b => `<div class="ml ${b.read ? '' : 'new'}" data-id="${b.id}"><div class="ml-top">${who(b.uid)}<small class="muted">${ago(b.t)}</small></div><p class="ml-text">${esc(b.text)}</p><div class="ml-acts">${b.read ? '<small class="muted">읽음</small>' : `<button class="sa" data-read>읽음 표시</button>`}<button class="sa del" data-del>${ic('x', 14)} 삭제</button></div></div>`).join('')
      : reps.map(r => { const t = D.users[r.to]; return `<div class="ml" data-rid="${r.id}"><div class="ml-top">${who(r.from)}<small class="muted">${ago(r.t)}</small></div><p class="ml-text"><b>@${esc(t ? t.handle : '?')}</b> 신고 · ${esc(r.reason)}${r.detail ? '<br>' + esc(r.detail) : ''}</p><div class="ml-acts">${t ? `<button class="mini-ban" data-ban="${esc(t.handle)}">${ic('ban', 12)} 밴</button>` : ''}<button class="sa del" data-rdel>${ic('x', 14)} 삭제</button></div></div>`; }).join('');
    el.innerHTML = `<div class="hdr light"><button class="icon-btn" data-back>${ic('back')}</button><h2>우편함</h2><span></span></div>
      <div class="seg"><button data-t="bugs" class="${p.tab === 'bugs' ? 'on' : ''}">버그 제보 ${unreadMail() ? `<em class="ml-n">${unreadMail()}</em>` : ''}</button><button data-t="reports" class="${p.tab === 'reports' ? 'on' : ''}">신고 ${reps.length}</button><i class="seg-ind" style="width:calc((100% - 8px)/2);transform:translateX(${p.tab === 'bugs' ? 0 : 100}%)"></i></div>
      <div class="scroll ml-list">${list || `<div class="empty">${ic('mail', 44)}<p>우편함이 비어 있어요</p></div>`}</div>`;
  };
  el.onclick = e => {
    const t = e.target.closest('[data-t]'); if (t) { p.tab = t.dataset.t; return render(); }
    const card = e.target.closest('[data-id]');
    if (card && e.target.closest('[data-read]')) { const b = D.bugs.find(x => x.id === card.dataset.id); if (b) { b.read = true; save('bugs'); render(); } return; }
    if (card && e.target.closest('[data-del]')) { D.bugs = D.bugs.filter(x => x.id !== card.dataset.id); save('bugs'); return render(); }
    const rc = e.target.closest('[data-rid]');
    if (rc && e.target.closest('[data-rdel]')) { D.reports = D.reports.filter(x => x.id !== rc.dataset.rid); save('reports'); return render(); }
    const bn = e.target.closest('[data-ban]'); if (bn) return banModal(bn.dataset.ban, render);
  };
  render();
  const live = ev => { if (!el.isConnected) return document.removeEventListener('netchange', live); if (ev.detail === 'bugs' || ev.detail === 'reports') render(); };
  document.addEventListener('netchange', live);
});
