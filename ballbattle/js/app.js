'use strict';
// ===== 로딩 / 로그인 / 메인(랭킹·영상·홈·프로필) / 프로필 편집 =====
function seed() {
  // 예전 버전의 AI 상대 정리
  Object.keys(D.users).filter(id => id.startsWith('bot_')).forEach(id => { D.users[id] = undefined; });
  for (const id in D.users) if (!D.users[id]) Reflect.deleteProperty(D.users, id);
  for (const id in D.skills) if (String(D.skills[id].owner).startsWith('bot_')) Reflect.deleteProperty(D.skills, id);
  if (!D.users[DEV_UID]) {
    D.users[DEV_UID] = { uid: DEV_UID, handle: DEV_HANDLE, nick: '초록모자', email: '', age: 0, avatar: '', banner: null, bio: '', coins: 0, wins: 0, losses: 0, subs: [], following: [], equipped: [], created: Date.now() };
  }
  const dv = D.users[DEV_UID]; dv.dev = true; dv.banned = false; if (dv.handle === 'greencap.roblox') dv.handle = DEV_HANDLE;
  if (dv.avatar === 'assets/greencap.jpg') dv.avatar = ''; if (dv.banner && dv.banner.kind === 'url') dv.banner = null; if (String(dv.bio || '').startsWith('팔로워 10만')) dv.bio = '';
  if (!NET.ok) { D.users[DEV_UID].pw = DEV_HASH; save('users', 'skills'); }
}

// --- 로딩 ---
screen('loading', el => {
  el.innerHTML = `<div class="load"><canvas class="load-cv"></canvas>
    <h1 class="logo">${[...T].map((c, i) => `<span class="${T.startsWith('tik') && i < 3 ? 'lg-a' : ''}" style="--d:${.55 + i * .04}s">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('')}</h1>
    <div class="load-info"><div class="load-bar"><i></i></div><div class="load-row"><span class="load-tip">불러오는 중</span><span class="load-pct">0%</span></div></div>
    <div class="welcome"></div><button class="btn-start">${ic('play', 20)} 플레이</button></div>`;
  const bar = $('.load-bar i', el), pct = $('.load-pct', el), tip = $('.load-tip', el); let prog = 0, target = 5; const t0 = performance.now();
  const stopAnim = boxAnim($('.load-cv', el), { fill: () => prog / 100 });
  const iv = setInterval(() => { prog = Math.min(target, prog + Math.max(.4, (target - prog) * .1)); bar.style.width = prog + '%'; pct.textContent = Math.floor(prog) + '%'; if (prog >= 100) { clearInterval(iv); done(); } }, 30);
  const stepTo = (t, s) => { target = t; tip.textContent = s; };
  (async () => {
    try {
      applySettings();
      stepTo(25, '저장소 여는 중'); await withTimeout(IDB.open(), 3000);
      stepTo(45, '글꼴 불러오는 중'); await withTimeout(document.fonts && document.fonts.ready, 1500);
      stepTo(70, '온라인에 연결하는 중'); await connectNet(8000);
      stepTo(88, '실시간 대결 연결하는 중'); await withTimeout(LIVE.init(), 6000);
      seed();
    } catch (e) { }
    await new Promise(r => setTimeout(r, Math.max(0, 1800 - (performance.now() - t0))));
    stepTo(100, NET.ok ? '온라인 연결됨' : '준비 완료');
  })();
  function done() {
    el.querySelector('.load').classList.add('loaded');
    const w = $('.welcome', el), txt = `'${T}'에 오신 것을 환영합니다`;
    w.innerHTML = [...txt].map((c, i) => `<span style="--d:${i * .035}s">${c === ' ' ? '&nbsp;' : esc(c)}</span>`).join('');
    setTimeout(() => $('.btn-start', el).classList.add('show'), txt.length * 35 + 300);
    // 시작하면 항상 로그인·회원가입 화면으로
    $('.btn-start', el).onclick = () => { AUD.o(); applySettings(); setSession(null); go('auth', {}, 'zoom'); };
  }
  el._leave = () => { clearInterval(iv); stopAnim(); };
});

const floatBalls = () => `<div class="float-balls">${Array.from({ length: 7 }, (_, i) => `<i style="--x:${rnd(5, 90)}%;--s:${rint(30, 80)}px;--d:${rnd(0, 6)}s;--t:${rnd(7, 13)}s;--c:${pick(['#25F4EE', '#FE2C55', '#FFD700', '#7CFF6B', '#b46bff'])}"></i>`).join('')}</div>`;
screen('auth', el => {
  el.innerHTML = `<div class="auth">${floatBalls()}<h1 class="logo sm">${T}</h1><p class="muted">틱톡 프로필로 싸우는 공 배틀</p>
    <div class="auth-btns"><button class="btn-main" data-go="login">${ic('user', 20)} 로그인</button><button class="btn-sec" data-go="signup">${ic('plus', 20)} 회원가입</button>
    <div class="or"><span>또는</span></div><div class="g-btn-box"></div></div></div>`;
  $$('[data-go]', el).forEach(b => b.onclick = () => go(b.dataset.go));
  googleButton($('.g-btn-box', el));
});
async function quickLogin() {
  try {
    const snap = await NET.db.collection('data/users/' + NET.cid).get();
    const accts = snap.docs.map(d => ({ uid: d.id, pv: d.data() })).filter(a => D.users[a.uid] && !D.users[a.uid].banned);
    if (!accts.length) return toast('이 계정으로 만든 게임 아이디가 없어요. 먼저 회원가입을 해주세요');
    const pickA = a => { Object.assign(D.users[a.uid], a.pv); enter(D.users[a.uid]); };
    if (accts.length === 1) return pickA(accts[0]);
    sheet('어떤 아이디로 들어갈까요?', accts.map(a => ({ label: '@' + esc(D.users[a.uid].handle), fn: () => pickA(a) })));
  } catch (e) { toast('간편 로그인을 할 수 없어요'); }
}
function googleButton(box) {
  // claude.ai 게임 페이지에서는 구글 로그인 스크립트를 불러올 수 없어서, 지금 로그인한 계정으로 바로 들어가요
  if (NET.ok && NET.cid) { box.innerHTML = `<button class="btn-google">${ic('user', 20)} 지금 계정으로 간편 로그인</button>`; $('button', box).onclick = quickLogin; return; }
  const id = BB_CONFIG.GOOGLE_CLIENT_ID;
  box.innerHTML = `<button class="btn-google">${ic('google', 20)} Google 계정으로 로그인</button>`;
  if (!id) { $('button', box).onclick = () => toast('구글 로그인은 js/config.js 에 GOOGLE_CLIENT_ID 를 넣으면 켜져요'); return; }
  loadScript('https://accounts.google.com/gsi/client').then(() => {
    google.accounts.id.initialize({ client_id: id, callback: r => onGoogle(r.credential) });
    box.innerHTML = ''; google.accounts.id.renderButton(box, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 280 });
  }).catch(() => { $('button', box).onclick = () => toast('구글 로그인을 불러오지 못했어요'); });
}
function onGoogle(cred) {
  try {
    const b = cred.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), pl = JSON.parse(decodeURIComponent(escape(atob(b))));
    const u = Object.values(D.users).find(x => x.google === pl.sub || (pl.email && x.email === pl.email));
    if (u) { if (u.banned) return toast('밴된 계정이에요'); u.google = pl.sub; save('users'); return enter(u); }
    toast('처음이시네요! 틱톡 아이디로 가입을 마무리해주세요');
    go('signup', { google: { sub: pl.sub, email: pl.email, pic: pl.picture } });
  } catch (e) { toast('구글 로그인에 실패했어요'); }
}
function enter(u) { setSession(u.uid); LIVE.hello(u); AUD.sfx('win'); toast(`${u.nick}님 환영해요!`); reset('main', { tab: 'home' }, 'portal'); }

screen('login', el => {
  el.innerHTML = `<div class="auth form">${floatBalls()}<div class="hdr clear"><button class="icon-btn" data-back>${ic('back')}</button><h2>로그인</h2><span></span></div>
    <div class="auth-card"><label class="lbl">아이디 (틱톡 아이디)</label><input class="inp" id="li-h" placeholder="틱톡 아이디" autocomplete="username" autocapitalize="off">
    <label class="lbl">비밀번호</label><input class="inp" id="li-p" type="password" autocomplete="current-password"><div class="err" id="li-e"></div>
    <button class="btn-main w100" id="li-go">로그인</button><div class="or"><span>또는</span></div><div class="g-btn-box"></div>
    <p class="muted center sm">계정이 없나요? <a data-su>회원가입</a></p></div></div>`;
  googleButton($('.g-btn-box', el));
  $('[data-su]', el).onclick = () => go('signup');
  const doIt = async () => {
    const e = $('#li-e', el), hv = $('#li-h', el).value.trim(), u = byHandle(hv) || (hv.toLowerCase().replace(/[._@]/g, '') === 'greencaproblox' ? D.users[DEV_UID] : null);
    if (!u) return e.textContent = '없는 아이디예요';
    const hash = await sha(u.uid + ':' + $('#li-p', el).value);
    if (u.uid === DEV_UID) { if (hash !== DEV_HASH) return e.textContent = '비밀번호가 틀렸어요'; }
    else if (NET.ok) { const pv = await getPriv(u.uid); if (!pv) return e.textContent = '이 Claude 계정에서 만든 아이디가 아니에요'; if (hash !== pv.pw) return e.textContent = '비밀번호가 틀렸어요'; Object.assign(u, pv); }
    else if (hash !== u.pw) return e.textContent = '비밀번호가 틀렸어요';
    if (u.banned) return e.textContent = '밴된 계정이에요';
    enter(u);
  };
  $('#li-go', el).onclick = doIt; $('#li-p', el).onkeydown = e => { if (e.key === 'Enter') doIt(); };
});

screen('signup', (el, p) => {
  const g = p.google || {};
  el.innerHTML = `<div class="auth form">${floatBalls()}<div class="hdr clear"><button class="icon-btn" data-back>${ic('back')}</button><h2>회원가입</h2><span></span></div>
    <div class="auth-card scroll-y">
    <label class="lbl">나이</label><input class="inp" id="su-a" type="number" min="1" max="120" inputmode="numeric">
    <label class="lbl">이메일</label><input class="inp" id="su-e" type="email" value="${esc(g.email || '')}" autocomplete="email">
    <label class="lbl">비밀번호 <small class="muted">6자 이상</small></label><input class="inp" id="su-p" type="password" autocomplete="new-password">
    <label class="lbl">아이디 <small class="muted">본인 틱톡 아이디와 똑같이!</small></label><div class="at-inp"><span>@</span><input class="inp" id="su-h" autocapitalize="off" placeholder="tiktok_id"></div><div class="hint" id="su-hh"></div>
    <label class="lbl">닉네임</label><input class="inp" id="su-n" maxlength="30">
    <div class="err" id="su-err"></div><button class="btn-main w100" id="su-go">가입하기</button></div></div>`;
  const hh = $('#su-hh', el);
  $('#su-h', el).oninput = e => { const v = e.target.value.trim(); const er = v ? handleErr(v) : ''; hh.textContent = v ? (er || `사용 가능해요 · tiktok.com/@${v}`) : ''; hh.className = 'hint ' + (er ? 'bad' : 'good'); };
  $('#su-go', el).onclick = async () => {
    const age = +$('#su-a', el).value, email = $('#su-e', el).value.trim(), pw = $('#su-p', el).value, hd = $('#su-h', el).value.trim().replace(/^@/, ''), nick = $('#su-n', el).value.trim(), err = $('#su-err', el);
    if (!age || age < 1 || age > 120) return err.textContent = '나이를 확인해주세요';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err.textContent = '이메일을 확인해주세요';
    if (Object.values(D.users).some(u => u.email && u.email.toLowerCase() === email.toLowerCase())) return err.textContent = '이미 가입된 이메일이에요';
    if (pw.length < 6) return err.textContent = '비밀번호는 6자 이상이어야 해요';
    const he = handleErr(hd); if (he) return err.textContent = he;
    if (!nick) return err.textContent = '닉네임을 입력해주세요';
    const uid = 'u_' + uid6(), priv = { age, email, pw: await sha(uid + ':' + pw) }; if (g.sub) priv.google = g.sub;
    const u = newUser({ uid, handle: hd, nick, ...priv }); setPriv(uid, priv);
    if (g.pic) fetchAvatar(g.pic, u);
    enter(u);
  };
});
async function fetchAvatar(url, u, notify) {
  try {
    const r = await fetch(url); if (!r.ok) throw 0; const b = await r.blob(); if (!b.type.startsWith('image')) throw 0;
    u.avatar = await squareData(URL.createObjectURL(b)); save('users'); if (notify) { toast('프로필 사진을 불러왔어요'); refresh(); }
  } catch (e) { if (notify) toast('사진을 불러오지 못했어요. 직접 올려주세요'); }
}
function squareData(src, n = 200) {
  return new Promise((res, rej) => {
    const i = new Image(); i.crossOrigin = 'anonymous';
    i.onload = () => { const c = document.createElement('canvas'); c.width = c.height = n; const s = Math.min(i.width, i.height); c.getContext('2d').drawImage(i, (i.width - s) / 2, (i.height - s) / 2, s, s, 0, 0, n, n); res(c.toDataURL('image/jpeg', .85)); };
    i.onerror = rej; i.src = src;
  });
}

// --- 메인 (하단 목록) ---
const TABS = [['rank', '랭킹', 'trophy'], ['feed', '영상', 'clapper'], ['create', '', 'plus'], ['home', '홈', 'home'], ['profile', '프로필', 'user']];
const TAB_R = {};
screen('main', (el, p) => {
  el.innerHTML = `<div class="tab-content"></div><nav class="tabbar">${TABS.map(([k, l, i]) => k === 'create' ? `<button class="tb-create" data-t="create"><span>${ic('plus', 26)}</span></button>` : `<button class="tb tb-${k}" data-t="${k}">${ic(i, 24)}<small>${l}</small></button>`).join('')}</nav>`;
  $$('.tabbar button', el).forEach(b => b.onclick = () => b.dataset.t === 'create' ? go('create', {}, 'up') : switchTab(el, b.dataset.t));
  el._leave = () => { const pg = $('.page:last-child', el); pg && pg._leave && pg._leave(); };
  switchTab(el, p.tab || 'home', true);
});
function switchTab(el, t, first) {
  if (el._tab === t && !first) return;
  const pi = TABS.findIndex(x => x[0] === el._tab), ni = TABS.findIndex(x => x[0] === t), tc = $('.tab-content', el), old = tc.lastElementChild;
  if (old && old._leave) old._leave();
  const page = h(`<div class="page page-${t}"></div>`); tc.appendChild(page);
  el._tab = t; el._p.tab = t; TAB_R[t](page);
  if (old) { if (!first) { const r = ni > pi; old.style.animation = `${r ? 'tabOutL' : 'tabOutR'} .35s forwards`; page.style.animation = `${r ? 'tabInR' : 'tabInL'} .35s`; setTimeout(() => old.remove(), 350); } else old.remove(); }
  $$('.tabbar button', el).forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $('.tabbar', el).classList.toggle('light', t === 'profile');
}

// 홈
TAB_R.home = page => {
  const u = me(), eq = loadout(u), recs = D.recs.filter(r => r.uid === u.uid).slice(0, 3);
  const shared = Object.values(D.skills).filter(s => s.shared && s.owner !== u.uid && D.users[s.owner] && !D.users[s.owner].banned).length;
  page.innerHTML = `<div class="ph hm"><div class="banner"><div class="banner-media"></div></div>
    <button class="glass pen" data-edit>${ic('pencil', 20)}</button>${isDev(u) ? `<button class="glass menu-btn" data-mail>${ic('mail', 21)}${unreadMail() ? `<em class="mail-n">${unreadMail()}</em>` : ''}</button>` : ''}
    <div class="home-prof">${avImg(u, 'av-sq')}<div class="hp-name">${nameHTML(u)}</div><div class="hp-id">@${esc(u.handle)}</div>
      <div class="hm-chips"><span>${ic('trophy', 14)} <b>${u.wins}</b>승</span><span>${COIN} <b>${coinText(u)}</b></span><span class="hm-on"><i class="dot"></i> <b>${LIVE.online()}</b>명 접속 중</span></div></div></div>
    <div class="home-body">
      <button class="play-card" id="hm-play"><canvas class="pc-cv"></canvas><span class="pc-txt"><b>플레이</b><small>지금 접속한 사람과 실시간 대결</small></span><span class="pc-go">${ic('play', 22)}</span></button>
      <div class="hm-tiles"><button class="tile" id="hm-sk">${ic('flask', 24)}<b>공 스킬 제작</b><small>${eq.length ? eq.map(s => esc(s.name)).join(' · ') : '장착한 스킬 없음'}</small></button>
        <button class="tile" id="hm-sh">${ic('users', 24)}<b>다른 사람 스킬 쓰기</b><small>공유된 스킬 ${shared}개</small></button></div>
      ${recs.length ? `<div class="hm-sec"><b>최근 대결</b><button data-more>전체 보기</button></div><div class="hm-recs">${recs.map(r => { const o = D.users[r.opp]; return `<button class="hm-rec" data-rec="${r.id}"><img src="${r.thumb}" alt=""><span class="wl ${r.win ? 'w' : 'l'}">${r.win ? '승' : '패'}</span><small>vs ${esc(o ? o.nick : '?')}</small></button>`; }).join('')}</div>` : ''}
    </div>`;
  mountBanner($('.ph', page), u);
  const stopAnim = boxAnim($('.pc-cv', page));
  const onLive = () => { const b = $('.hm-on b', page); if (b) b.textContent = LIVE.online(); };
  document.addEventListener('livechange', onLive);
  page._leave = () => { stopAnim(); document.removeEventListener('livechange', onLive); };
  $('[data-edit]', page).onclick = () => go('edit');
  const mb = $('[data-mail]', page); if (mb) mb.onclick = () => go('mailbox');
  $('#hm-play', page).onclick = () => go('match', {}, 'zoom');
  $('#hm-sk', page).onclick = () => go('skills');
  $('#hm-sh', page).onclick = () => go('shared');
  const more = $('[data-more]', page); if (more) more.onclick = () => go('create');
  $$('[data-rec]', page).forEach(b => b.onclick = () => { const r = D.recs.find(z => z.id === b.dataset.rec); if (r) go('upload', { key: r.key, kind: 'video' }); });
};

// 랭킹: 빈 자리는 '없음'
TAB_R.rank = page => {
  const u = me(), white = avatarSrc({});
  const render = () => {
    const list = Object.values(D.users).filter(x => !x.banned).sort((a, b) => b.wins - a.wins || b.coins - a.coins);
    const st = x => `<span class="rk-st">${x.wins}승 <i>·</i> ${COIN}${coinText(x)}</span>`;
    const ban = x => isDev(u) && x.uid !== u.uid ? `<button class="mini-ban" data-ban="${esc(x.handle)}">${ic('ban', 12)} 밴</button>` : '';
    const pd = (x, cls, pos, d) => `<div class="pd ${cls} ${x ? '' : 'none'}" ${x ? `data-u="${x.uid}"` : ''} style="--d:${d}s">${pos === 1 ? `<span class="crown">${ic('crown', 30)}</span>` : ''}
      <div class="pd-av"><img src="${x ? avatarSrc(x) : white}" alt=""><span class="pd-n">${pos}</span></div>
      <div class="pd-name">${x ? nameHTML(x) : '없음'}</div><small>${x ? '@' + esc(x.handle) : '&nbsp;'}</small>${x ? st(x) : '<span class="rk-st">&nbsp;</span>'}${x ? ban(x) : ''}<div class="pd-base">${pos}</div></div>`;
    const rows = [];
    for (let i = 3; i < Math.max(10, list.length); i++) {
      const x = list[i];
      rows.push(x ? `<div class="rk ${x.uid === u.uid ? 'me' : ''}" data-u="${x.uid}"><span class="rk-n">${i + 1}</span>${avImg(x, 'av-xs')}<div class="rk-nm"><div>${nameHTML(x)}</div><small>@${esc(x.handle)}</small></div>${st(x)}${ban(x)}</div>`
        : `<div class="rk none"><span class="rk-n">${i + 1}</span><img class="av-xs" src="${white}" alt=""><div class="rk-nm"><div class="muted">없음</div></div></div>`);
    }
    page.innerHTML = `<div class="rank"><h1 class="pg-title">${ic('trophy', 24)} 랭킹</h1><div class="podium">${pd(list[1], 'silver', 2, .2)}${pd(list[0], 'gold', 1, 0)}${pd(list[2], 'bronze', 3, .4)}</div><div class="rk-list">${rows.join('')}</div></div>`;
  };
  page.onclick = e => {
    const b = e.target.closest('[data-ban]'); if (b) return banModal(b.dataset.ban, render);
    const r = e.target.closest('[data-u]'); if (r && r.dataset.u !== u.uid) go('user', { uid: r.dataset.u });
  };
  render();
  const live = () => { if (page.isConnected) render(); else document.removeEventListener('netchange', live); };
  document.addEventListener('netchange', live);
};
TAB_R.feed = page => renderFeedTab(page);

// 프로필 (틱톡 스타일)
function profileView(root, x, self) {
  const u = me(), posts = D.posts.filter(p => p.uid === x.uid), subbed = x.subs.includes(u.uid), hideF = !self && x.hideFollow, locked = !self && x.private;
  const tabs = self ? [['posts', 'grid'], ['recs', 'lock'], ['saved', 'bookmark'], ['liked', 'heart']] : [['posts', 'grid']];
  root.innerHTML = `<div class="ph tk"><div class="banner"><div class="banner-media"></div></div>
    ${self ? `<button class="glass pen" data-edit>${ic('pencil', 20)}</button><button class="glass menu-btn" data-menu>${ic('menu', 22)}</button>` : `<button class="glass pen" data-back>${ic('back', 22)}</button><button class="glass menu-btn" data-more>${ic('dots', 22)}</button>`}
    <div class="tk-info"><div class="tk-left"><h1>${nameHTML(x)}</h1><div class="tk-id">@${esc(x.handle)}</div>
      <div class="tk-stats"><div><b>${hideF ? '-' : fmtN(x.following.length)}</b><small>구독중</small></div><div><b>${hideF ? '-' : fmtN(x.subs.length)}</b><small>구독자</small></div><div><b>${fmtN(userLikes(x))}</b><small>좋아요</small></div></div></div>
      ${avImg(x, 'tk-av')}</div>
    <div class="tk-bio">${esc(x.bio || '').replace(/\n/g, '<br>')}</div>
    ${self ? '' : `<div class="tk-acts"><button class="btn-sub ${subbed ? 'on' : ''}" data-sub>${subbed ? '구독중' : '구독'}</button><button class="btn-ghost dark" data-rep>${ic('flag', 16)} 신고</button>${isDev(u) ? `<button class="btn-ghost dark" data-verify>${ic('check', 16)} ${x.verified ? '인증 빼기' : '인증 주기'}</button><button class="btn-ghost dark" data-ban>${ic('ban', 16)} 밴</button>` : ''}</div>`}</div>
    <div class="ptabs">${tabs.map(([k, i]) => `<button data-pt="${k}" class="pt-${k}">${ic(i, 24)}</button>`).join('')}<i class="pt-ind" style="width:${100 / tabs.length}%"></i></div><div class="pgrid"></div>`;
  mountBanner($('.ph', root), x);
  const grid = $('.pgrid', root);
  const setPT = k => {
    root._pt = k; const i = tabs.findIndex(t => t[0] === k);
    $$('.ptabs button', root).forEach(b => b.classList.toggle('on', b.dataset.pt === k)); $('.pt-ind', root).style.transform = `translateX(${i * 100}%)`;
    let items;
    if (k === 'recs') { const rs = D.recs.filter(r => r.uid === x.uid); grid.innerHTML = rs.map(r => `<div class="gi rec-gi" data-rec="${r.id}"><img src="${r.thumb}" alt=""><span class="wl ${r.win ? 'w' : 'l'}">${r.win ? '승' : '패'}</span><span class="gi-v">${ic('lock', 12)} ${fmtDur(r.dur)}</span></div>`).join('') || '<p class="muted pg-empty">플레이하면 영상이 자동 저장돼요 (나만 보기)</p>'; return; }
    if (locked) { grid.innerHTML = `<p class="muted pg-empty">${ic('lock', 28)}<br>비공개 계정이에요</p>`; grid._ids = []; return; }
    if (k === 'posts') items = posts; if (k === 'saved') items = D.posts.filter(p => p.saves.includes(x.uid)); if (k === 'liked') items = D.posts.filter(p => p.likes.includes(x.uid));
    items = items.filter(p => D.users[p.uid] && !D.users[p.uid].banned);
    grid.innerHTML = items.map(p => `<div class="gi" data-p="${p.id}"><img src="${p.thumb}" alt=""><span class="gi-v">${ic('play', 12)} ${fmtN(p.views)}</span>${p.type === 'video' ? `<span class="gi-t">${ic('film', 12)}</span>` : ''}</div>`).join('') || `<p class="muted pg-empty">${{ posts: '아직 올린 영상이 없어요', saved: '저장한 영상이 없어요', liked: '좋아요한 영상이 없어요' }[k]}</p>`;
    grid._ids = items.map(p => p.id);
  };
  root.onclick = async e => {
    const t = e.target.closest('[data-pt]'); if (t) return setPT(t.dataset.pt);
    const g = e.target.closest('[data-p]'); if (g) return go('viewer', { ids: grid._ids, start: g.dataset.p });
    const r = e.target.closest('[data-rec]'); if (r) { const rc = D.recs.find(z => z.id === r.dataset.rec); return go('upload', { key: rc.key, kind: 'video' }); }
    if (e.target.closest('[data-edit]')) return go('edit');
    if (e.target.closest('[data-menu]')) return sheet('', [{ label: '설정', fn: () => go('settings') }, { label: '로그아웃', danger: true, fn: logout }]);
    if (e.target.closest('[data-verify]')) return verifyModal(x.handle, () => profileView(root, x, self));
    if (e.target.closest('[data-sub]')) { toggleSub(x); return profileView(root, x, self); }
    if (e.target.closest('[data-rep]') || e.target.closest('[data-more]')) return reportUser(x);
    if (e.target.closest('[data-ban]')) return banModal(x.handle, () => back());
  };
  setPT(root._pt || 'posts');
}
TAB_R.profile = page => { page.classList.add('light-page'); profileView(page, me(), true); };
screen('user', (el, p) => { const x = D.users[p.uid]; el.classList.add('light-page'); el.innerHTML = '<div class="scroll"></div>'; if (!x) return back(); if (x.uid === me().uid) return profileView($('.scroll', el), x, true); profileView($('.scroll', el), x, false); });
async function logout() { if (await ask('로그아웃 할까요?', '로그아웃', true)) { setSession(null); LIVE.hello(null); toast('로그아웃했어요'); reset('auth', {}, 'fade'); } }

// 프로필 편집 (보내준 사진 스타일)
screen('edit', el => {
  const u = me(); el.classList.add('light-page');
  el.innerHTML = `<div class="scroll ep"><div class="ph ep-ph" style="--tint:${defTint(u)}"><div class="banner"><div class="banner-media"></div></div>
      <button class="glass ep-back" data-back>${ic('back', 22)}</button><button class="glass ep-bg">배경 변경</button></div>
    <div class="ep-sheet"><div class="ep-av" data-photo>${avImg(u)}<span class="ep-cam">${ic('camera', 36)}</span></div><div class="ep-avtxt" data-photo>사진 변경</div>
    <div class="ep-card"><div class="ep-row" data-f="nick"><span>이름</span><b>${esc(u.nick)}</b>${ic('chevR', 20)}</div>
      <div class="ep-row" data-f="handle"><span>아이디</span><b>${esc(u.handle)}</b>${ic('chevR', 20)}</div>
      <div class="ep-row" data-copy><span></span><b>tiktok.com/@${esc(u.handle)}</b>${ic('copy', 20)}</div></div>
    <div class="ep-label">기본 정보</div>
    <div class="ep-card"><div class="ep-row top" data-f="bio"><span>자기소개</span><b class="pre">${esc(u.bio || '자기소개 추가')}</b>${ic('chevR', 20)}</div></div>
    <button class="ep-logout">${ic('logout', 18)} 로그아웃</button></div></div>`;
  mountBanner($('.ph', el), u);
  $$('[data-photo]', el).forEach(b => b.onclick = async () => { const f = await pickFile('image/*'); if (!f) return; u.avatar = await squareData(URL.createObjectURL(f)); save('users'); toast('프로필 사진을 바꿨어요'); refresh(); });
  $$('[data-f]', el).forEach(r => r.onclick = () => go('field', { f: r.dataset.f }));
  $('[data-copy]', el).onclick = () => navigator.clipboard.writeText(`tiktok.com/@${u.handle}`).then(() => toast('링크를 복사했어요'), () => toast('복사하지 못했어요'));
  $('.ep-logout', el).onclick = logout;
  $('.ep-bg', el).onclick = () => sheet('배경 변경', [
    { label: '사진 업로드', fn: () => uploadBanner(u) },
    { label: '내 게시물에서 선택', fn: () => pickPostBanner(u) },
    { label: '삭제', danger: true, fn: () => setBanner(u, null) },
  ]);
});
function setBanner(u, b) { const old = u.banner; if (old && old.kind === 'image' && old.key && old.key.startsWith('b_')) IDB.del(old.key); u.banner = b; save('users'); toast(b ? '배경을 바꿨어요' : '배경을 삭제했어요'); refresh(); }
async function uploadBanner(u) {
  const f = await pickFile('image/*,video/*'); if (!f) return; if (f.size > 20e6) return toast('20MB 이하만 올릴 수 있어요');
  const key = await putBlob(f, 'b'); setBanner(u, { kind: f.type.startsWith('video') ? 'video' : 'image', key });
  const asset = await shareBlob(key); if (asset && u.banner && u.banner.key === key) { u.banner.asset = asset; save('users'); }
}
function pickPostBanner(u) {
  const ps = D.posts.filter(p => p.uid === u.uid);
  const m = modal(`<h3 class="m-title">게시물 선택</h3><div class="pick-grid"><button class="pick-gal" data-gal>${ic('image', 28)}<small>갤러리에서 선택</small></button>${ps.map(p => `<button data-p="${p.id}"><img src="${p.thumb}" alt=""><small>${esc(p.title)}</small></button>`).join('')}</div>${ps.length ? '' : '<p class="muted sm">아직 올린 영상이 없어요. 갤러리에서 사진이나 동영상을 고를 수 있어요</p>'}`);
  $('[data-gal]', m).onclick = () => { m.close(); uploadBanner(u); };
  $$('[data-p]', m).forEach(b => b.onclick = () => { const p = ps.find(x => x.id === b.dataset.p); m.close(); setBanner(u, { kind: p.kind, key: p.key, asset: p.asset }); });
}
screen('field', (el, p) => {
  const u = me(), F = { nick: ['이름', u.nick, 30], handle: ['아이디', u.handle, 24], bio: ['자기소개', u.bio, 80] }[p.f];
  el.classList.add('light-page');
  el.innerHTML = `<div class="hdr light"><button class="icon-btn" data-back>${ic('back')}</button><h2>${F[0]}</h2><button class="hdr-save">저장</button></div>
    <div class="fd">${p.f === 'bio' ? `<textarea class="inp" maxlength="${F[2]}" rows="4">${esc(F[1])}</textarea>` : `<input class="inp" maxlength="${F[2]}" value="${esc(F[1])}" autocapitalize="off">`}
    <div class="fd-cnt"></div><div class="err"></div>${p.f === 'handle' ? '<p class="muted sm">아이디는 반드시 본인의 틱톡 아이디와 똑같아야 해요. 다른 사람과 중복될 수 없어요.</p>' : ''}</div>`;
  const i = $('.inp', el), cnt = $('.fd-cnt', el), er = $('.err', el);
  const up = () => { cnt.textContent = `${i.value.length}/${F[2]}`; er.textContent = p.f === 'handle' ? handleErr(i.value, u.uid) : ''; };
  i.oninput = up; up(); i.focus();
  $('.hdr-save', el).onclick = () => {
    const v = p.f === 'bio' ? i.value.trim() : i.value.trim().replace(p.f === 'handle' ? /^@/ : /^$/, '');
    if (p.f === 'nick' && !v) return er.textContent = '이름을 입력해주세요';
    if (p.f === 'handle') { const e = handleErr(v, u.uid); if (e) return er.textContent = e; }
    u[p.f] = v; save('users'); toast('저장했어요'); back();
  };
});

// --- 시작 ---
window.addEventListener('load', () => {
  show('loading', {}, 'none');
  const hv = location.hash.match(/^#v=(.+)/);
  if (hv) window._openPost = hv[1];
});
