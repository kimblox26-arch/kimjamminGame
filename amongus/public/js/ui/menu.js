// 메인 화면 (상단바, 메뉴 버튼, 오른쪽 창: 우주/플레이/온라인/내 계정), 공지, 크레딧, 친구
import { $, $$, h, esc, stage, modal, toast, sfx, music, net, me, profile, saveProfile, settings, xpNeed } from '../core.js';
import { VERSION, NOTICES, COLORS, REDEEM, ITEMS } from '../shared/data.js';
import { crewSVG } from './crew.js';
import { screens, app, go } from './nav.js';

const LOGO = `<svg viewBox="0 0 370 105"><g fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round">
  <path d="M8 100 V40 C8 8 54 8 54 40 V100 H40 V86 H22 V100 Z"/><rect x="30" y="30" width="34" height="20" rx="10"/></g>
  <text x="62" y="100" fill="none" stroke="#fff" stroke-width="3.2" font-size="118" font-family="'Arial Narrow','Roboto Condensed','Liberation Sans Narrow',sans-serif" textLength="300" lengthAdjust="spacingAndGlyphs">MONG US</text></svg>`;
const BOX = `<svg viewBox="0 0 110 90"><path d="M20 40 L55 26 L92 40 L92 76 L55 88 L20 76 Z" fill="#3b6b4f" stroke="#000" stroke-width="5"/><path d="M20 40 L55 54 L92 40 M55 54 V88" stroke="#000" stroke-width="4" fill="none"/><path d="M40 28 L70 28 L70 8 L40 8 Z" fill="#222" stroke="#000" stroke-width="4"/><rect x="34" y="26" width="42" height="7" rx="3" fill="#222" stroke="#000" stroke-width="3"/></svg>`;
const STAR = `<svg viewBox="0 0 110 90"><path d="M30 10 L38 32 L60 32 L42 46 L50 70 L30 54 L10 70 L18 46 L0 32 L22 32 Z" fill="#ffd23f" stroke="#000" stroke-width="4"/><path d="M54 36 h30 l8 40 h-46 Z" fill="#4a5ec9" stroke="#000" stroke-width="4"/><circle cx="76" cy="22" r="12" fill="#d33" stroke="#000" stroke-width="4"/></svg>`;
const SIGN = `<svg viewBox="0 0 190 184"><path d="M120 120 L178 110 L182 184 L118 184 Z" fill="#4c5254" stroke="#222" stroke-width="5"/><path d="M106 126 L170 116" stroke="#2b3133" stroke-width="10"/>
  <path d="M30 40 C44 10 92 6 112 30 C140 30 158 58 140 80 C150 104 120 124 96 112 C80 132 40 126 36 104 C10 98 6 58 30 40 Z" fill="#f5c842" stroke="#3a2a00" stroke-width="6"/>
  <text x="64" y="92" font-size="54" font-weight="900" fill="#3a2a00" transform="rotate(-18 80 80)">+1</text></svg>`;
const ICONS = { news: '📢', acct: '🪪', settings: '🛠️' };

let panel = 'space', acctTab = 'acct', friendsOpen = false;
const unread = () => NOTICES.filter(n => !profile.readNews.includes(n.date)).length;
const lightCls = () => (me.status === 'off' || app.loading ? 'off' : me.status);
export const displayName = () => (settings.streamer ? 'XXXXXXXXXX' : me.account ? me.account.friendCode : me.name);

screens.menu = (p = 'space') => {
  panel = p;
  app.inRoom = false;
  music(true);
  const el = h(`<div class="screen menu-bg">
    <div class="topbar"><div class="acct-ico"></div><div class="light"></div><div class="tb-name"></div><button class="friend-btn">친구<i class="badge hidden"></i></button></div>
    <div class="logo">${LOGO}</div>
    <div class="menu-panel">
      <button class="bigbtn" data-a="play"><span class="ico">${crewSVG({ color: 0 }, { frame: 1 })}</span>플레이</button>
      <button class="bigbtn" data-a="inv"><span class="ico">${BOX}</span>인벤토리</button>
      <button class="bigbtn" data-a="shop"><span class="ico">${STAR}</span>상점${profile.shopSeen ? '' : '<i class="badge">!</i>'}</button>
      <hr>
      <button class="smallbtn" data-a="news"><span class="ico">${ICONS.news}</span>게임 뉴스<i class="badge news-b"></i></button>
      <button class="smallbtn" data-a="acct"><span class="ico">${ICONS.acct}</span>내 계정</button>
      <button class="smallbtn" data-a="settings"><span class="ico">${ICONS.settings}</span>설정</button>
      <button class="credit" data-a="credits">크레딧</button>
    </div>
    <div class="version">${VERSION}</div>
    <div class="vp"><div class="vp-in"></div></div>
    <div class="sign" title="매일 콩 받기">${SIGN}</div>
    <div class="loader ${app.loading ? '' : 'done'}">${crewSVG({ color: 2 })}</div>
  </div>`);
  stage().replaceChildren(el);
  el.addEventListener('click', e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    sfx('click');
    if (app.loading && a !== 'settings' && a !== 'credits') return toast('불러오는 중입니다…');
    ({ play: () => setPanel('play'), inv: () => go('inventory'), shop: () => go('shop'), news: openNews, acct: () => setPanel('account'),
      settings: () => go('settings', {}), credits: openCredits })[a]?.();
  });
  $('.acct-ico', el).onclick = $('.tb-name', el).onclick = () => !app.loading && setPanel('account');
  $('.friend-btn', el).onclick = () => { sfx('click'); toggleFriends(); };
  $('.sign', el).onclick = daily;
  updateTop();
  setPanel(panel);
};

export function updateTop() {
  const el = stage().querySelector('.topbar');
  if (!el) return;
  $('.light', el).className = 'light ' + lightCls();
  $('.tb-name', el).textContent = app.loading ? '' : displayName();
  $('.acct-ico', el).innerHTML = me.status === 'green' ? crewSVG(profile.look, { noPet: true }) : '<span style="font-size:28px;color:#999">☁</span>';
  const n = unread(), b = $('.news-b');
  if (b) { b.textContent = n > 9 ? '9+' : n; b.classList.toggle('hidden', !n); }
  const fb = $('.friend-btn .badge', el), rq = me.friends.requests.length;
  fb.textContent = rq; fb.classList.toggle('hidden', !rq);
  $('.loader')?.classList.toggle('done', !app.loading);
  if (friendsOpen) renderFriends();
}

function setPanel(p) {
  panel = p;
  const vp = $('.vp-in');
  if (!vp) return;
  if (p === 'play') {
    vp.innerHTML = `<div class="vp-head">플레이</div>
      <div class="cards"><button class="card" data-p="local"><div class="art">${artLocal()}</div><div class="lbl">로컬</div></button>
      <button class="card" data-p="online"><div class="art">${artOnline()}</div><div class="lbl">온라인</div></button></div>
      <div class="subbtns"><button data-p="howto">플레이 방법</button><button data-p="practice">연습 모드</button></div>`;
  } else if (p === 'online') {
    vp.innerHTML = `<button class="back">뒤로</button><div class="vp-head">온라인</div>
      <div class="cards" style="top:112px"><div style="display:flex;flex-direction:column;gap:8px">
        <button class="card dim" data-p="create" style="height:174px;width:252px"><div class="art">${artCreate()}</div><div class="lbl" style="font-size:32px">게임 만들기</div></button>
        <button class="card dim" data-p="code" style="height:174px;width:252px"><div class="art">${artCode()}</div><div class="lbl" style="font-size:32px">코드 입력</div></button></div>
        <button class="card" data-p="find" style="height:356px;width:300px"><div class="art">${artFind()}</div><div class="lbl">게임 찾기</div></button></div>`;
    $('.back', vp).onclick = () => { sfx('click'); setPanel('play'); };
  } else if (p === 'account') {
    renderAccount(vp);
    return;
  } else {
    vp.innerHTML = `<div class="space">${stars()}${settings.bgAnim ? floaters() : ''}<div class="glass"></div></div>`;
  }
  $$('[data-p]', vp).forEach(b => b.onclick = () => {
    sfx('click');
    const k = b.dataset.p;
    if (k === 'local') go('host');
    else if (k === 'online') {
      if (me.status === 'teal' && !me.account?.parentVerified) return needParent();
      setPanel('online');
    }
    else if (k === 'howto') go('howto');
    else if (k === 'practice') practice();
    else if (k === 'create') go('create', 'online');
    else if (k === 'code') go('enterCode');
    else if (k === 'find') go('find');
  });
}
function needParent() {
  const m = modal(`<h2 style="font-size:40px">보호자 인증 필요</h2><p class="cb-msg" style="font-size:24px;text-align:center">만 14세 미만 계정(청록불)은 보호자가 이메일로 인증해야\n온라인에서 플레이할 수 있습니다.\n로컬 플레이와 연습 모드는 바로 할 수 있어요.</p>
    <div class="row-c"><button class="obtn">계정 관리</button></div>`, { cls: 'small' });
  $('.obtn', m.el).onclick = () => { m.close(); go('accountManage'); };
}
function practice() {
  const m = modal(`<h2 style="font-size:44px">연습 모드</h2><p style="text-align:center;font-size:24px">더미들과 함께 스켈드를 자유롭게 둘러보세요.</p>
    <div class="row-c"><button class="obtn" data-r="crew">크루원으로</button><button class="obtn" data-r="impostor">임포스터로</button></div>`, { cls: 'small' });
  $$('[data-r]', m.el).forEach(b => b.onclick = () => { m.close(); net.send({ t: 'create', mode: 'practice', role: b.dataset.r }); });
}

// ---------- 오른쪽 창 그림 ----------
const g = (look, x, y, s = 1, o = {}) => `<g transform="translate(${x} ${y}) scale(${s})">${crewSVG(look, o).replace('<svg', '<svg width="250" height="180"')}</g>`;
const artLocal = () => `<svg viewBox="0 0 274 272" width="274" height="272"><rect width="274" height="272" fill="#2b3c5c"/><rect x="0" y="180" width="274" height="92" fill="#3a3550"/>
  <rect x="100" y="22" width="60" height="44" fill="#6a4a2a" stroke="#000" stroke-width="4"/><rect x="108" y="30" width="44" height="28" fill="#5aa0c8"/>
  ${g({ color: 5 }, 70, 40, .5)}<rect x="20" y="120" width="240" height="120" rx="20" fill="#a5523a" stroke="#000" stroke-width="5"/>
  ${g({ color: 10 }, -30, 80, .8)}${g({ color: 8 }, 70, 80, .8, { flip: true })}<rect x="10" y="190" width="254" height="60" rx="14" fill="#b8603f" stroke="#000" stroke-width="5"/></svg>`;
const artOnline = () => `<svg viewBox="0 0 274 272" width="274" height="272"><rect width="274" height="272" fill="#1b2142"/><circle cx="40" cy="40" r="2" fill="#fff"/><circle cx="220" cy="90" r="2" fill="#fff"/>
  ${g({ color: 0, hat: 'none' }, -40, 0, .9)}<path d="M140 120 L230 40 L190 130 L260 120 L150 250 L180 150 L120 160 Z" fill="#ffd23f" stroke="#000" stroke-width="4"/>
  ${g({ color: 1, visor: 'shades' }, 40, 120, .85, { flip: true })}<circle cx="240" cy="40" r="30" fill="#fff" stroke="#000" stroke-width="4"/><text x="222" y="54" font-size="36">📢</text></svg>`;
const artCreate = () => `<svg viewBox="0 0 252 116" width="252" height="116"><rect width="252" height="116" fill="#4b4642"/><rect x="150" y="10" width="90" height="100" fill="#6b7a80" stroke="#000" stroke-width="4"/>${g({ color: 7 }, -30, -20, .75)}${g({ color: 9 }, 90, 0, .7, { flip: true })}</svg>`;
const artCode = () => `<svg viewBox="0 0 252 116" width="252" height="116"><rect width="252" height="116" fill="#dfe6e8"/><rect x="0" y="0" width="252" height="40" fill="#111"/>
  <text x="14" y="32" font-size="30" fill="#fff" letter-spacing="18" font-family="monospace">AMOG</text>${g({ color: 14 }, -40, 10, .7)}</svg>`;
const artFind = () => `<svg viewBox="0 0 300 298" width="300" height="298"><rect width="300" height="298" fill="#6c7880"/><rect x="20" y="40" width="110" height="200" rx="8" fill="#515c63" stroke="#222" stroke-width="5"/>
  <rect x="170" y="40" width="110" height="200" rx="8" fill="#515c63" stroke="#222" stroke-width="5"/><rect x="0" y="240" width="300" height="60" fill="#8a969c"/>
  ${g({ color: 12 }, -10, 110, 1)}${g({ color: 9 }, 90, 100, .9, { flip: true })}${g({ color: 7 }, -80, 90, .8)}
  <rect x="200" y="14" width="80" height="30" rx="6" fill="#222"/><text x="212" y="36" font-size="20" fill="#fff">🧑 8/15</text></svg>`;
function stars() {
  let s = '';
  for (let i = 0; i < 70; i++) s += `${Math.random() * 1080 | 0}px ${Math.random() * 560 | 0}px 0 ${Math.random() < .2 ? 1 : 0}px #fff,`;
  return `<div class="stars" style="box-shadow:${s.slice(0, -1)}"></div>`;
}
function floaters() {
  let s = '';
  const cs = [7, 10, 11, 3];
  cs.forEach((c, i) => {
    const y = 60 + i * 120, d = 22 + i * 7;
    s += `<div class="floater" style="--x0:-200px;--y0:${y}px;--x1:1150px;--y1:${y + (i % 2 ? -80 : 80)}px;--r:${i % 2 ? -540 : 540}deg;animation-duration:${d}s;animation-delay:-${i * 6}s">${crewSVG({ color: c })}</div>`;
  });
  return s;
}

// ---------- 내 계정 ----------
function renderAccount(vp) {
  vp.innerHTML = `<div class="vp-head">내 계정</div><div class="tabs"><button data-t="acct">계정</button><button data-t="stats">통계</button><button data-t="redeem">보상 교환</button></div><div class="acct-body"></div>`;
  $$('.tabs button', vp).forEach(b => { b.classList.toggle('on', b.dataset.t === acctTab); b.onclick = () => { sfx('click'); acctTab = b.dataset.t; renderAccount(vp); }; });
  const body = $('.acct-body', vp);
  if (acctTab === 'acct') {
    const code = me.account?.friendCode || '없음 (게스트)';
    const hgt = 3 + (me.name.length % 3), wgt = 80 + (me.name.charCodeAt(0) % 40);
    body.innerHTML = `<div class="idcard"><div class="f" style="left:250px;top:18px">친구 코드</div><div class="v code" style="left:250px;top:42px;font-size:22px">●●●●●●●●</div>
      <button class="eye" title="친구 코드 보기">👁</button>
      <div class="pic">${crewSVG(profile.look, { noPet: true })}</div>
      <div class="f" style="left:250px;top:84px">사용자 이름</div><div class="v" style="left:250px;top:106px;font-size:32px">${esc(me.name)}</div>
      <div class="f" style="left:250px;top:150px">키</div><div class="v" style="left:250px;top:172px">${hgt}'${(hgt * 2) % 12}"</div>
      <div class="f" style="left:370px;top:150px">무게</div><div class="v" style="left:370px;top:172px">${wgt}lbs</div>
      <div class="f" style="left:250px;top:208px">레벨</div><div class="v" style="left:250px;top:230px">${profile.level}</div>
      <div class="f" style="left:340px;top:200px">경험치</div><div class="xpbar"><i style="width:${(profile.xp / xpNeed()) * 100}%"></i></div>
      <div class="copied hidden">텍스트가 복사되었습니다!</div></div>
      <div class="acct-btns"><button class="obtn mng">계정 관리</button><button class="obtn ren" ${me.status === 'green' ? '' : 'disabled'}>이름 변경</button></div>`;
    let shown = false;
    $('.eye', body).onclick = () => {
      sfx('click'); shown = !shown;
      $('.code', body).textContent = shown ? code : '●●●●●●●●';
      if (shown && me.account) navigator.clipboard?.writeText(code).then(() => { const c = $('.copied', body); c.classList.remove('hidden'); setTimeout(() => c.classList.add('hidden'), 1800); }).catch(() => {});
    };
    $('.mng', body).onclick = () => { sfx('click'); go('accountManage'); };
    $('.ren', body).onclick = () => { sfx('click'); renameBox(); };
    $('.acct-btns', body).insertAdjacentHTML('afterend', me.status === 'green' ? '' : `<p style="position:absolute;left:300px;top:506px;width:520px;text-align:center;color:#aaa;font-size:18px">이름 변경은 로그인한 계정(초록불)에서만 가능합니다.</p>`);
  } else if (acctTab === 'stats') {
    const s = profile.stats, rows = [['시작한 게임', s.started], ['완료한 게임', s.finished], ['크루원 승리', s.crewWins], ['임포스터 승리', s.impWins],
      ['크루원 게임', s.crewGames], ['임포스터 게임', s.impGames], ['완료한 임무', s.tasks], ['모든 임무 완료', s.allTasks], ['처치 횟수', s.kills],
      ['추방된 횟수', s.ejected], ['긴급 회의 소집', s.meetings], ['시체 신고', s.reports], ['사보타주 수리', s.sabFixed], ['콩', profile.beans], ['레벨', profile.level]];
    body.innerHTML = `<div class="stats">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>`;
  } else {
    body.innerHTML = `<div class="redeem"><p>공지나 이벤트에서 받은 코드를 입력하세요.</p><input class="inp" maxlength="20" placeholder="코드 입력"><div class="row-c"><button class="obtn">교환</button></div><p class="err"></p></div>`;
    $('.obtn', body).onclick = () => {
      const code = $('.inp', body).value.trim().toUpperCase(), r = REDEEM[code];
      if (!r) return ($('.err', body).textContent = '올바르지 않은 코드입니다.');
      const id = r.join(':');
      if (profile.owned.includes(id)) return ($('.err', body).textContent = '이미 받은 보상입니다.');
      profile.owned.push(id); saveProfile(); sfx('task');
      const name = ITEMS[r[0]].find(i => i[0] === r[1])[1];
      $('.err', body).innerHTML = `<span style="color:#4fe3cf">🎁 ${name}을(를) 받았습니다! 인벤토리에서 장착하세요.</span>`;
    };
  }
}
function renameBox() {
  if (me.status !== 'green') return toast('이름 변경은 로그인한 계정(초록불)에서만 할 수 있습니다.');
  const m = modal(`<h2 style="font-size:40px">이름 변경</h2><input class="inp" maxlength="10" value="${esc(me.name)}"><p class="err"></p><div class="row-c"><button class="obtn">확인</button></div>`, { cls: 'small' });
  $('.obtn', m.el).onclick = () => { net.send({ t: 'rename', name: $('.inp', m.el).value }); m.close(); };
}

// ---------- 공지 ----------
function openNews(start = 0) {
  const back = h(`<div class="modal-back"><div class="news"><button class="xbtn">✕</button><div class="inner"><div class="nh"><small>AMONG US</small>공지</div><div class="list"></div><div class="body"></div></div></div></div>`);
  stage().append(back);
  $('.xbtn', back).onclick = () => { sfx('click'); back.remove(); };
  const show = i => {
    const n = NOTICES[i];
    if (!profile.readNews.includes(n.date)) { profile.readNews.push(n.date); saveProfile(); }
    $('.list', back).innerHTML = NOTICES.map((x, j) => `<div class="item ${j === i ? 'on' : ''}" data-i="${j}"><small>${x.date}</small><b>${x.title}</b>${profile.readNews.includes(x.date) ? '' : '<span class="note">!</span>'}</div>`).join('');
    $$('.item', back).forEach(it => it.onclick = () => { sfx('click'); show(+it.dataset.i); });
    $('.body', back).innerHTML = `<div class="d">${n.date}</div><h3>${n.head}</h3><i>${n.sub}</i>${n.body.map(p => `<p>${p}</p>`).join('')}`;
    updateTop();
  };
  show(start);
}
screens.news = openNews;
function openCredits() {
  modal(`<h2>크레딧</h2><div style="font-size:24px;line-height:1.8;text-align:center">
    <p><b>AMONG US 팬 제작 웹 버전</b></p><p>기획·제작: kimjammin</p><p>원작: <b>Among Us</b> © Innersloth LLC</p>
    <p style="color:#aaa;font-size:20px">이 프로젝트는 비상업적 팬 제작물이며 Innersloth와 관련이 없습니다.<br>모든 그림과 소리는 코드로 직접 만들었습니다.</p></div>`);
}

// ---------- 매일 보상 (+1 별) ----------
function daily() {
  if (app.loading) return;
  const today = new Date().toISOString().slice(0, 10);
  if (profile.daily === today) { sfx('click'); return toast('오늘 보상은 이미 받았어요. 내일 다시 오세요!'); }
  profile.daily = today; profile.beans += 50; saveProfile(); sfx('win');
  toast('🫘 콩 50개를 받았습니다!');
}

// ---------- 친구 ----------
function toggleFriends() {
  friendsOpen = !friendsOpen;
  $('.friends')?.remove();
  if (friendsOpen) renderFriends();
}
function renderFriends() {
  let el = $('.friends');
  if (!el) { el = h('<div class="friends"></div>'); stage().append(el); }
  if (me.status !== 'green') {
    el.innerHTML = `<h3 style="margin:0 0 10px">친구</h3><p>친구 기능은 로그인한 계정(초록불)에서만 사용할 수 있습니다.</p><p style="color:#aaa">${me.status === 'teal' ? '만 14세 미만 계정은 친구 기능이 제한됩니다.' : '게스트 계정은 친구를 추가할 수 없습니다.'}</p>`;
    return;
  }
  const f = me.friends;
  el.innerHTML = `<h3 style="margin:0 0 6px">친구</h3><div style="color:#aaa;font-size:18px">내 친구 코드: ${settings.streamer ? '숨김' : esc(me.account.friendCode)}</div>
    <div class="row" style="margin-top:10px"><input class="inp" placeholder="친구 코드 (예: novafox#1234)" style="height:48px;font-size:20px"><button class="obtn" style="min-width:110px;height:48px;font-size:22px">추가</button></div>
    <div class="fl">${f.requests.map(r => `<div class="fi"><span>📨 ${esc(r.name)} <small style="color:#888">${esc(r.code)}</small></span><button data-acc="${r.id}">수락</button><button data-rm="${r.id}">거절</button></div>`).join('')}
    ${f.friends.map(r => `<div class="fi"><i class="dot ${r.online ? 'on' : ''}"></i><span>${esc(r.name)} <small style="color:#888">${esc(r.code)}</small></span>
      ${app.inRoom && r.online ? `<button data-inv="${r.id}">초대</button>` : ''}<button data-rm="${r.id}">삭제</button></div>`).join('') || (f.requests.length ? '' : '<p style="color:#888">아직 친구가 없습니다.</p>')}</div>`;
  $('.obtn', el).onclick = () => net.send({ t: 'friendAdd', code: $('.inp', el).value });
  $$('[data-acc]', el).forEach(b => b.onclick = () => net.send({ t: 'friendAccept', id: b.dataset.acc }));
  $$('[data-rm]', el).forEach(b => b.onclick = () => net.send({ t: 'friendRemove', id: b.dataset.rm }));
  $$('[data-inv]', el).forEach(b => b.onclick = () => { net.send({ t: 'invite', id: b.dataset.inv }); toast('초대를 보냈습니다.'); });
}
net.on('friends', m => { me.friends = { friends: m.friends, requests: m.requests }; updateTop(); });
net.on('invite', m => {
  if (!settings.invites || app.inRoom) return;
  const mm = modal(`<p class="cb-msg">${esc(m.from)}님이 게임에 초대했습니다.</p><div class="row-c"><button class="obtn">참가</button></div>`, { cls: 'small' });
  $('.obtn', mm.el).onclick = () => { mm.close(); net.send({ t: 'join', code: m.code }); };
});
export const refreshMenu = () => { if ($('.menu-bg')) { updateTop(); if (panel === 'account') setPanel('account'); } };
export const colorName = i => COLORS[i]?.[0] || '';
