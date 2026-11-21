'use strict';
// ===== 화면 전환 / 모달 / 공통 UI =====
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function toast(m) {
  const t = $('#toast'); t.textContent = m; t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2300);
}
function modal(html, { cls = '' } = {}) {
  const m = h(`<div class="modal-bg"><div class="modal ${cls}">${html}</div></div>`);
  $('#modal-root').appendChild(m);
  m.close = () => { if (m._closed) return; m._closed = 1; m._onclose && m._onclose(); m.classList.add('out'); setTimeout(() => m.remove(), 260); };
  m.addEventListener('click', e => { if (e.target === m) m.close(); });
  return m;
}
function sheet(title, items) {
  const m = modal(`${title ? `<div class="sheet-title">${title}</div>` : ''}${items.map((it, i) => `<button class="sheet-btn ${it.danger ? 'danger' : ''}" data-i="${i}">${it.label}</button>`).join('')}<div class="sheet-gap"></div><button class="sheet-btn" data-i="-1">취소</button>`, { cls: 'sheet' });
  $$('.sheet-btn', m).forEach(b => b.onclick = () => { m.close(); const it = items[+b.dataset.i]; it && it.fn(); });
  return m;
}
function ask(msg, okLabel = '확인', danger) {
  return new Promise(res => {
    const m = modal(`<p class="ask-msg">${msg}</p><div class="row2"><button class="btn-ghost" data-r="0">취소</button><button class="${danger ? 'btn-danger' : 'btn-main'}" data-r="1">${okLabel}</button></div>`);
    m._onclose = () => res(false);
    $$('[data-r]', m).forEach(b => b.onclick = () => { m._onclose = null; res(b.dataset.r === '1'); m.close(); });
  });
}
function pickFile(accept) {
  return new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => res(i.files[0] || null); i.click(); });
}
function loadScript(src) {
  return new Promise((res, rej) => { if ($(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}

// --- 화면 네비게이션 ---
const NAV = { stack: [], cur: null, screens: {} };
function screen(name, fn) { NAV.screens[name] = fn; }
const PUBLIC = ['loading', 'auth', 'login', 'signup'];
function show(name, p = {}, anim = 'push') {
  const u = me();
  if (!PUBLIC.includes(name) && (!u || u.banned)) {
    if (u && u.banned) { setSession(null); toast('밴된 계정이라 로그아웃됐어요'); }
    name = 'auth'; p = {}; NAV.stack = [];
  }
  const old = $('#app>.screen:not(.leaving)');
  if (old && old._leave) old._leave();
  const el = h(`<div class="screen scr-${name}"></div>`);
  el._name = name; el._p = p;
  $('#app').appendChild(el);
  NAV.cur = { name, p };
  NAV.screens[name](el, p);
  if (old) { old.classList.add('leaving', 'out-' + anim); setTimeout(() => old.remove(), 450); }
  el.classList.add('in-' + anim);
  setTimeout(() => el.classList.remove('in-' + anim), 900);
  return el;
}
function go(name, p = {}, anim = 'push') { if (NAV.cur) NAV.stack.push(NAV.cur); return show(name, p, anim); }
function back() { const prev = NAV.stack.pop(); if (prev) show(prev.name, prev.p, 'back'); else show('main', {}, 'back'); }
function reset(name, p = {}, anim = 'fade') { NAV.stack = []; return show(name, p, anim); }
function refresh() { const c = NAV.cur; if (c) show(c.name, c.p, 'none'); }
document.addEventListener('click', e => {
  if (e.target.closest('[data-back]')) back();
});
document.addEventListener('pointerdown', e => { if (e.target.closest('button')) AUD.sfx('click'); });

// 배너 (이미지/영상) + 배경과 이어지는 그라데이션 색
async function mountBanner(root, u) {
  const box = $('.banner-media', root); if (!box) return;
  const b = u.banner; let src = null, kind = 'image';
  if (b) { if (b.kind === 'url') src = b.src; else { src = await mediaSrc(b); kind = b.kind; } }
  if (!src) { box.innerHTML = ''; return; }
  box.innerHTML = kind === 'video' ? `<video src="${src}" autoplay muted loop playsinline></video>` : `<img src="${src}" alt="">`;
}
function defTint() { return '#eef0f3'; }
function tintOf(el, kind) {
  return new Promise(res => {
    const go2 = () => {
      try {
        const c = document.createElement('canvas'); c.width = 16; c.height = 16; const x = c.getContext('2d');
        x.drawImage(el, 0, 0, 16, 16); const d = x.getImageData(0, 10, 16, 6).data; let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        res(`rgb(${r / n | 0},${g / n | 0},${b / n | 0})`);
      } catch (e) { res(null); }
    };
    if (kind === 'video') { if (el.readyState >= 2) go2(); else el.addEventListener('loadeddata', go2, { once: true }); }
    else { if (el.complete && el.naturalWidth) go2(); else { el.onload = go2; el.onerror = () => res(null); } }
    setTimeout(() => res(null), 4000);
  });
}
const avImg = (u, cls = '') => `<img class="${cls}" src="${avatarSrc(u)}" alt="">`;

// --- 신고 / 밴 ---
const REASONS = ['욕설·비매너', '핵·버그 악용', '부적절한 프로필/영상', '스팸·도배', '사칭', '기타'];
function reportUser(u) {
  const m = modal(`<h3 class="m-title">${ic('flag')} 플레이어 신고</h3><p class="m-sub">@${esc(u.handle)} (${esc(u.nick)})</p>
    <div class="radios">${REASONS.map((r, i) => `<label class="radio"><input type="radio" name="rr" value="${r}" ${i ? '' : 'checked'}><span>${r}</span></label>`).join('')}</div>
    <textarea class="inp" id="rp-d" placeholder="자세한 내용 (선택)" maxlength="200"></textarea>
    <div class="row2"><button class="btn-ghost" data-c>취소</button><button class="btn-danger" id="rp-ok">신고하기</button></div>`);
  $('[data-c]', m).onclick = () => m.close();
  $('#rp-ok', m).onclick = () => {
    D.reports.unshift({ id: uid6(), from: me().uid, to: u.uid, reason: $('input[name=rr]:checked', m).value, detail: $('#rp-d', m).value.trim(), t: Date.now() });
    save('reports'); m.close(); toast('신고가 접수됐어요. 개발자가 확인할게요');
  };
}
function banModal(handle = '', onDone) {
  const u0 = me(); if (!isDev(u0)) return;
  const m = modal(`<h3 class="m-title">${ic('ban')} 플레이어 밴</h3>
    <label class="lbl">밴할 아이디</label><input class="inp" id="bn-h" value="${esc(handle)}" placeholder="틱톡 아이디" autocomplete="off">
    <div class="bn-who"></div>
    <label class="lbl">개발자 비밀번호</label><input class="inp" id="bn-p" type="password" placeholder="비밀번호" autocomplete="current-password">
    <div class="err" id="bn-e"></div>
    <div class="row2"><button class="btn-ghost" data-c>취소</button><button class="btn-danger" id="bn-ok">확인</button></div>`);
  const hi = $('#bn-h', m), who = $('.bn-who', m), ok = $('#bn-ok', m);
  const upd = () => {
    const t = byHandle(hi.value);
    who.innerHTML = t ? `${avImg(t, 'av-xs')}<span>${nameHTML(t)}</span>${t.banned ? '<span class="bantag">밴됨</span>' : ''}` : (hi.value ? '<span class="muted">없는 아이디예요</span>' : '');
    ok.textContent = t && t.banned ? '밴 해제' : '확인';
  };
  hi.oninput = upd; upd();
  $('[data-c]', m).onclick = () => m.close();
  ok.onclick = async () => {
    const t = byHandle(hi.value), e = $('#bn-e', m);
    if (!t) return e.textContent = '아이디를 확인해주세요';
    if (t.uid === u0.uid) return e.textContent = '자기 자신은 밴할 수 없어요';
    if (await sha(u0.uid + ':' + $('#bn-p', m).value) !== (u0.uid === DEV_UID ? DEV_HASH : u0.pw)) return e.textContent = '비밀번호가 틀렸어요';
    t.banned = !t.banned; save('users'); m.close();
    toast(t.banned ? `@${t.handle} 님을 밴했어요` : `@${t.handle} 님의 밴을 해제했어요`);
    onDone && onDone(t);
  };
}
function reportsModal() {
  const rs = D.reports;
  const m = modal(`<h3 class="m-title">${ic('flag')} 신고 목록 (${rs.length})</h3><div class="rp-list">${rs.length ? rs.map(r => {
    const a = D.users[r.from], b = D.users[r.to]; if (!b) return '';
    return `<div class="rp-item"><div><b>@${esc(b.handle)}</b> <span class="muted">← @${esc(a ? a.handle : '?')}</span>${b.banned ? '<span class="bantag">밴됨</span>' : ''}</div><div>${esc(r.reason)} · <span class="muted">${ago(r.t)}</span></div>${r.detail ? `<div class="muted">${esc(r.detail)}</div>` : ''}<button class="mini-ban" data-h="${esc(b.handle)}">${ic('ban', 14)} 밴</button></div>`;
  }).join('') : '<p class="muted">신고가 없어요</p>'}</div><button class="btn-ghost w100" data-c>닫기</button>`);
  $('[data-c]', m).onclick = () => m.close();
  $$('.mini-ban', m).forEach(b => b.onclick = () => { m.close(); banModal(b.dataset.h); });
}
