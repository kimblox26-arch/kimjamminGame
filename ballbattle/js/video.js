'use strict';
// ===== 영상 만들기 / 올리기 / 영상보기(숏츠·동영상) / 라이브 =====
const fmtDur = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
screen('create', el => {
  const u = me(), recs = D.recs.filter(r => r.uid === u.uid);
  el.innerHTML = `<div class="hdr"><button class="icon-btn" data-back>${ic('back')}</button><h2>영상 만들기</h2><span></span></div>
    <div class="scroll pad"><button class="btn-sec w100" id="cr-gal">${ic('image', 20)} 갤러리에서 동영상 선택</button>
    <h3 class="sec-t">${ic('film', 18)} 자동 저장된 플레이 <small class="muted">${recs.length}개</small></h3>
    <div class="rec-grid">${recs.length ? recs.map(r => { const o = D.users[r.opp]; return `<div class="rec" data-id="${r.id}"><img src="${r.thumb}" alt=""><span class="wl ${r.win ? 'w' : 'l'}">${r.win ? '승리' : '패배'}</span><div class="rec-meta"><b>vs ${esc(o ? o.nick : '?')}</b><small>${MAPS[r.map].name} · ${fmtDur(r.dur)} · ${ago(r.t)}</small></div><button class="rec-del" data-del>${ic('x', 14)}</button></div>`; }).join('') : `<p class="muted">게임을 플레이하면 영상이 자동으로 저장돼요</p>`}</div></div>`;
  $('#cr-gal', el).onclick = async () => {
    const f = await pickFile('video/*'); if (!f) return; if (f.size > 150e6) return toast('150MB 이하 영상만 올릴 수 있어요');
    const key = await putBlob(f, 'v'); go('upload', { key, kind: 'video' });
  };
  $$('.rec', el).forEach(c => c.onclick = async e => {
    const r = D.recs.find(x => x.id === c.dataset.id);
    if (e.target.closest('[data-del]')) { if (await ask('이 플레이 영상을 지울까요?', '삭제', true)) { D.recs = D.recs.filter(x => x !== r); if (!D.posts.some(p => p.key === r.key)) IDB.del(r.key); save('recs'); refresh(); } return; }
    go('upload', { key: r.key, kind: 'video' });
  });
});

screen('upload', async (el, p) => {
  const u = me(), st = { edits: edits0(), type: 'short' };
  el.innerHTML = `<div class="hdr"><button class="icon-btn" data-back>${ic('back')}</button><h2>게시물 올리기</h2><span></span></div>
    <div class="scroll pad"><div class="up-prev"></div>
    <button class="btn-sec w100" id="up-ed">${ic('wand', 20)} 편집하기 <small>자르기·속도·필터·보정·배경제거·텍스트·회전·확대·볼륨</small></button>
    <label class="lbl">제목</label><input class="inp" id="up-t" maxlength="60" placeholder="제목을 입력하세요">
    <label class="lbl">설명</label><textarea class="inp" id="up-d" maxlength="300" placeholder="설명 (선택)"></textarea>
    <label class="lbl">종류</label><div class="seg2"><button data-ty="short" class="on">${ic('clapper', 16)} 숏츠</button><button data-ty="video">${ic('film', 16)} 동영상</button></div>
    <button class="btn-play w100" id="up-go">${ic('upload', 20)} 올리기</button></div>`;
  const url = await blobURL(p.key); if (!url) { toast('영상을 찾을 수 없어요'); return back(); }
  let player = null; const mk = () => { player && player.destroy(); player = makePlayer($('.up-prev', el), url, p.kind, st.edits, { fit: 'contain' }); player.play(); };
  mk(); el._leave = () => player && player.destroy();
  $('.up-prev', el).onclick = () => player.toggle();
  $('#up-ed', el).onclick = () => { player.pause(); openEditor(url, p.kind, st.edits, e => { st.edits = e; mk(); }, { ratio: 16 / 9 }); };
  $$('.seg2 button', el).forEach(b => b.onclick = () => { st.type = b.dataset.ty; $$('.seg2 button', el).forEach(x => x.classList.toggle('on', x === b)); });
  $('#up-go', el).onclick = async () => {
    const title = $('#up-t', el).value.trim(); if (!title) return toast('제목을 입력해주세요');
    const btn = $('#up-go', el); btn.disabled = true; btn.innerHTML = '<span class="spin"></span> 올리는 중...';
    let thumb = ''; try { thumb = await makeThumb(url, p.kind, st.edits); } catch (e) { }
    const post = { id: 'p_' + uid6(), uid: u.uid, key: p.key, kind: p.kind, edits: st.edits, title, desc: $('#up-d', el).value.trim(), type: st.type, likes: [], saves: [], comments: [], shares: 0, views: 0, t: Date.now(), thumb };
    if (NET.ok) { btn.innerHTML = '<span class="spin"></span> 온라인에 올리는 중...'; post.asset = await shareBlob(p.key); if (!post.asset) { btn.disabled = false; btn.innerHTML = `${ic('upload', 20)} 올리기`; return toast('영상을 올리지 못했어요 (20MB 이하, 올리기 권한 필요)'); } }
    D.posts.unshift(post); save('posts', 'users'); AUD.sfx('ding'); toast('영상이 올라갔어요!');
    reset('main', { tab: 'profile' }, 'fade');
  };
});

// --- 피드 (숏츠 / 동영상) ---
function feedItem(p) {
  const o = D.users[p.uid], u = me(); if (!o) return '';
  const liked = p.likes.includes(u.uid), saved = p.saves.includes(u.uid), subbed = o.subs.includes(u.uid), self = o.uid === u.uid;
  return `<div class="fi ${p.type}" data-id="${p.id}"><div class="fi-media"></div>
    ${p.type === 'video' ? `<div class="fi-vtitle">${esc(p.title)}</div>` : ''}
    <div class="fi-side">
      <button data-a="like" class="${liked ? 'on' : ''}">${ic('heart', 30)}<span>${fmtN(likeCount(p))}</span></button>
      <button data-a="cmt">${ic('comment', 30)}<span>${fmtN(p.comments.length)}</span></button>
      <button data-a="save" class="${saved ? 'on' : ''}">${ic('bookmark', 30)}<span>${fmtN(p.saves.length)}</span></button>
      <button data-a="share">${ic('share', 30)}<span>${fmtN(p.shares)}</span></button>
      <button data-a="more">${ic('dots', 26)}</button></div>
    <div class="fi-info"><div class="fi-user"><img data-a="user" class="fi-av" src="${avatarSrc(o)}" alt=""><b data-a="user">@${esc(o.handle)}</b>${isDev(o) ? BADGE : ''}${self ? '' : `<button data-a="sub" class="sub ${subbed ? 'on' : ''}">${subbed ? '구독중' : '구독'}</button>`}</div>
      <div class="fi-title">${esc(p.title)}</div>${p.desc ? `<div class="fi-desc">${esc(p.desc)}</div>` : ''}<div class="fi-views">${ic('eye', 13)} 조회수 ${fmtN(p.views)}</div></div>
    <div class="fi-paused">${ic('play', 64)}</div></div>`;
}
function mountFeed(box, list, startId) {
  if (!list.length) { box.innerHTML = `<div class="empty">${ic('clapper', 56)}<p>아직 영상이 없어요</p><button class="btn-main" id="fe-mk">${ic('plus', 18)} 영상 만들기</button></div>`; $('#fe-mk', box).onclick = () => go('create'); return { destroy() { } }; }
  box.innerHTML = `<div class="feed">${list.map(feedItem).join('')}</div>`;
  const feed = $('.feed', box), players = {};
  const act = async item => {
    const p = D.posts.find(x => x.id === item.dataset.id); if (!p) return; item._on = true;
    if (!item._viewed) { item._viewed = 1; p.views++; save('posts'); }
    if (players[p.id]) return players[p.id].play();
    const url = await mediaSrc(p); if (!url || !item._on || players[p.id]) return;
    players[p.id] = makePlayer($('.fi-media', item), url, p.kind, p.edits, { fit: p.type === 'short' ? 'cover' : 'contain' }); players[p.id].play();
  };
  const deact = item => { item._on = false; item._viewed = 0; const pl = players[item.dataset.id]; if (pl) { pl.destroy(); delete players[item.dataset.id]; } item.classList.remove('paused'); };
  const io = new IntersectionObserver(es => es.forEach(en => en.intersectionRatio > .6 ? act(en.target) : deact(en.target)), { root: feed, threshold: [0, .6, 1] });
  $$('.fi', feed).forEach(i => io.observe(i));
  if (startId) { const it = $(`.fi[data-id="${startId}"]`, feed); if (it) setTimeout(() => { feed.scrollTop = it.offsetTop; }, 0); }
  feed.addEventListener('click', async e => {
    const item = e.target.closest('.fi'); if (!item) return; const p = D.posts.find(x => x.id === item.dataset.id), u = me(), o = D.users[p.uid];
    const b = e.target.closest('[data-a]');
    if (!b) { const pl = players[p.id]; if (pl) item.classList.toggle('paused', !pl.toggle()); return; }
    const a = b.dataset.a;
    function toggle(k) {
      const i = p[k].indexOf(u.uid); i >= 0 ? p[k].splice(i, 1) : p[k].push(u.uid); save('posts');
      const btn = $(`[data-a="${k === 'likes' ? 'like' : 'save'}"]`, item); btn.classList.toggle('on', i < 0); btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump');
      $('span', btn).textContent = fmtN(k === 'likes' ? likeCount(p) : p.saves.length);
    }
    if (a === 'like') toggle('likes');
    if (a === 'save') { toggle('saves'); toast(p.saves.includes(u.uid) ? '저장했어요' : '저장을 취소했어요'); }
    if (a === 'cmt') openComments(p, n => $('[data-a="cmt"] span', item).textContent = fmtN(n));
    if (a === 'share') { await sharePost(p); $('[data-a="share"] span', item).textContent = fmtN(p.shares); }
    if (a === 'user') go('user', { uid: o.uid });
    if (a === 'sub') { toggleSub(o); $$(`.fi [data-a="sub"]`, feed).forEach(x => { if (D.posts.find(q => q.id === x.closest('.fi').dataset.id).uid === o.uid) { const s = o.subs.includes(u.uid); x.classList.toggle('on', s); x.textContent = s ? '구독중' : '구독'; } }); }
    if (a === 'more') {
      const items = [{ label: '신고하기', fn: () => reportUser(o) }];
      if (o.uid === u.uid || isDev(u)) items.push({ label: '영상 삭제', danger: true, fn: async () => { if (await ask('이 영상을 삭제할까요?', '삭제', true)) { D.posts = D.posts.filter(x => x !== p); if (!D.recs.some(r => r.key === p.key)) IDB.del(p.key); save('posts'); toast('삭제했어요'); refresh(); } } });
      if (isDev(u) && o.uid !== u.uid) items.push({ label: '이 플레이어 밴', danger: true, fn: () => banModal(o.handle) });
      sheet('', items);
    }
  });
  return { destroy() { io.disconnect(); Object.values(players).forEach(p => p.destroy()); } };
}
function toggleSub(o) {
  const u = me(), i = o.subs.indexOf(u.uid);
  if (i >= 0) { o.subs.splice(i, 1); u.following = u.following.filter(x => x !== o.uid); toast('구독을 취소했어요'); }
  else { o.subs.push(u.uid); u.following.push(o.uid); toast(`@${o.handle} 님을 구독했어요`); AUD.sfx('ding'); }
  save('users');
}
async function sharePost(p) {
  const url = location.href.split('#')[0] + '#v=' + p.id;
  let ok = false;
  if (navigator.share) { try { await navigator.share({ title: p.title, text: `${p.title} - ${T}`, url }); ok = true; } catch (e) { if (e && e.name === 'AbortError') return; } }
  if (!ok) { try { await navigator.clipboard.writeText(url); toast('링크를 복사했어요'); ok = true; } catch (e) { toast('공유할 수 없어요'); } }
  if (ok) { p.shares++; save('posts'); }
}
function openComments(p, onChange) {
  const row = c => { const o = D.users[c.uid]; return o ? `<div class="cm">${avImg(o, 'av-xs')}<div><b>@${esc(o.handle)}</b>${isDev(o) ? BADGE : ''} <small class="muted">${ago(c.t)}</small><p>${esc(c.text)}</p></div></div>` : ''; };
  const m = modal(`<div class="cm-hd">댓글 <b>${p.comments.length}</b>개</div><div class="cm-list">${p.comments.map(row).join('') || '<p class="muted center">첫 댓글을 남겨보세요</p>'}</div>
    <div class="cm-in">${avImg(me(), 'av-xs')}<input class="inp" placeholder="댓글 추가..." maxlength="150"><button class="icon-btn">${ic('send')}</button></div>`, { cls: 'sheet cm-sheet' });
  const inp = $('.cm-in input', m), send = () => {
    const t = inp.value.trim(); if (!t) return; const c = { uid: me().uid, text: t, t: Date.now() }; p.comments.push(c); save('posts');
    const l = $('.cm-list', m); if (p.comments.length === 1) l.innerHTML = ''; l.insertAdjacentHTML('beforeend', row(c)); l.scrollTop = l.scrollHeight;
    $('.cm-hd b', m).textContent = p.comments.length; inp.value = ''; onChange && onChange(p.comments.length);
  };
  $('.cm-in button', m).onclick = send; inp.onkeydown = e => { if (e.key === 'Enter') send(); };
}

const FEED_TABS = [['short', '숏츠'], ['video', '동영상'], ['live', '라이브']];
function renderFeedTab(page) {
  page.innerHTML = `<div class="feed-tabs">${FEED_TABS.map(([k, n]) => `<button data-f="${k}">${k === 'live' ? ic('live', 15) : ''}${n}</button>`).join('')}</div><div class="feed-box"></div>`;
  let cur = null; const box = $('.feed-box', page);
  const setF = f => {
    page._f = f; cur && cur.destroy(); cur = null;
    $$('.feed-tabs button', page).forEach(b => b.classList.toggle('on', b.dataset.f === f));
    const u = me(), ok = p => D.users[p.uid] && !D.users[p.uid].banned;
    if (f === 'live') return liveTab(box);
    const list = D.posts.filter(ok).filter(p => f === 'subs' ? u.following.includes(p.uid) : p.type === f);
    if (f === 'subs' && !list.length) { box.innerHTML = `<div class="empty">${ic('users', 56)}<p>구독한 크리에이터의 영상이 여기에 나와요</p></div>`; return; }
    cur = mountFeed(box, list);
  };
  $$('.feed-tabs button', page).forEach(b => b.onclick = () => setF(b.dataset.f));
  page._leave = () => cur && cur.destroy();
  setF(page._f || 'short');
}
function liveTab(box) {
  const u = me(), n = u.subs.length, ok = n >= 15;
  box.innerHTML = `<div class="live-tab"><div class="live-ic ${ok ? 'ok' : ''}">${ic(ok ? 'live' : 'lock', 54)}</div><h2>라이브 방송</h2>
    <p class="muted">구독자 15명부터 라이브를 할 수 있어요</p>
    <div class="live-prog"><i style="width:${Math.min(100, n / 15 * 100)}%"></i></div><b>${n} / 15명</b>
    <button class="btn-play" id="lv-go" ${ok ? '' : 'disabled'}>${ic('live', 20)} 라이브 시작</button>
    ${ok ? '' : '<p class="muted sm">영상을 올리면 구독자가 늘어날 수 있어요</p>'}</div>`;
  $('#lv-go', box).onclick = () => ok && go('live', {}, 'zoom');
}

screen('viewer', (el, p) => {
  el.innerHTML = `<button class="icon-btn vw-back" data-back>${ic('back')}</button><div class="feed-box full"></div>`;
  const list = p.ids.map(id => D.posts.find(x => x.id === id)).filter(Boolean);
  const f = mountFeed($('.feed-box', el), list, p.start); el._leave = () => f.destroy();
});

screen('live', async el => {
  const u = me();
  el.innerHTML = `<div class="live"><video autoplay playsinline muted></video><div class="lv-top"><span class="lv-badge">LIVE</span><button class="icon-btn lv-end">${ic('x')}</button></div>
    <div class="lv-host">${avImg(u, 'av-xs')}<span>${nameHTML(u)}</span></div><div class="lv-chat"></div><div class="lv-hearts"></div>
    <div class="lv-in"><input class="inp" placeholder="채팅 보내기..." maxlength="80"><button class="icon-btn" id="lv-s">${ic('send')}</button><button class="icon-btn lv-h">${ic('heart')}</button></div></div>`;
  let stream = null; const iv = [];
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true }); $('video', el).srcObject = stream; }
  catch (e) { toast('카메라를 쓸 수 없어서 화면 없이 방송해요'); }
  const chat = (who, t) => { const c = $('.lv-chat', el); if (!c) return; c.insertAdjacentHTML('beforeend', `<div class="lv-msg">${avImg(who, 'av-xs')}<b>${esc(who.nick)}</b><span>${esc(t)}</span></div>`); while (c.children.length > 7) c.firstChild.remove(); };
  const heart = () => { const hh = h(`<i style="--x:${rnd(-30, 30)}px;color:${pick(['#FE2C55', '#25F4EE', '#FFD700', '#ff7ab6'])}">${ic('heart', 28)}</i>`); $('.lv-hearts', el).appendChild(hh); setTimeout(() => hh.remove(), 2000); };
  const end = () => { iv.forEach(clearInterval); stream && stream.getTracks().forEach(t => t.stop()); };
  el._leave = end;
  const send = () => { const i = $('.lv-in input', el), t = i.value.trim(); if (!t) return; chat(u, t); i.value = ''; };
  $('#lv-s', el).onclick = send; $('.lv-in input', el).onkeydown = e => { if (e.key === 'Enter') send(); }; $('.lv-h', el).onclick = heart;
  $('.lv-end', el).onclick = async () => { if (await ask('라이브를 끝낼까요?', '종료', true)) { end(); back(); } };
});
