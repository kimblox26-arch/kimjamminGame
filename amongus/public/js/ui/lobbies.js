// 게임 찾기 / 게임 만들기 / 코드 입력 / 로컬 주최 / 플레이 방법
import { $, $$, h, esc, stage, modal, toast, sfx, net, me, device, saveDevice, profile } from '../core.js';
import { MAPS, REGIONS, TAGS, CHAT_LANGS, KO, defaultSettings, fmtSetting, SETTINGS, VERSION } from '../shared/data.js';
import { crewSVG, mapIcon } from './crew.js';
import { screens, go } from './nav.js';
import { displayName } from './menu.js';

const mapName = id => MAPS.find(m => m.id === id)?.name || id;
const regionSel = cur => `<select class="dd region">${REGIONS.map(([k, n]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
const opt = (on, label, data = '', dis = false) => `<button class="ob ${on ? 'on' : ''}" ${data} ${dis ? 'disabled' : ''}>${label}<i class="chk"></i></button>`;
const hintBox = text => `<div class="hint"><svg class="q" viewBox="-60 -60 250 190">${crewSVG({ color: 0 }).replace(/^<svg[^>]*>|<\/svg>$/g, '')}<text x="-30" y="-10" font-size="70" fill="#e33" stroke="#fff" stroke-width="4" font-weight="900">?</text></svg>${text}</div>`;

// ---------- 게임 찾기 ----------
const F = { gameType: 'classic', maps: new Set(), imps: new Set(), roles: null, sizes: new Set(), tags: new Set(), chatType: null, langs: new Set() };
const SIZES = [['소규모', 4, 6], ['중규모', 7, 10], ['대규모', 11, 13], ['최대규모', 14, 15]];
const activeCount = () => [F.maps.size, F.imps.size, F.roles !== null, F.sizes.size, F.tags.size, F.chatType !== null, F.langs.size].filter(Boolean).length;
const match = g => g.gameType === F.gameType && (!F.maps.size || F.maps.has(g.map)) && (!F.imps.size || F.imps.has(g.impostors)) && (F.roles === null || g.roles === F.roles)
  && (!F.sizes.size || [...F.sizes].some(i => g.max >= SIZES[i][1] && g.max <= SIZES[i][2])) && (!F.tags.size || F.tags.has(g.tag))
  && (F.chatType === null || g.chatType === F.chatType) && (!F.langs.size || F.langs.has(g.chatLang));

screens.find = () => {
  let list = [], total = 0, ftab = '일반';
  const el = h(`<div class="screen dark"><button class="back2">뒤로</button><div class="titlebar">게임 찾기</div>
    <div class="fbar">${regionSel(device.region)}<div class="mid"></div><div class="act"><span class="ac"></span> 활성 상태 필터<button class="clr">필터 지우기</button></div></div>
    <div class="glist"></div><div class="boatcnt"><b class="bc">0</b>온라인 수송선</div><button class="refresh">새로 고침</button>
    <div class="fpanel closed"><button class="ftab"><span>필터</span></button><div class="ttabs"><button data-t="일반">일반</button><button data-t="채팅">채팅</button></div>
      <div class="fbody">${hintBox('아래 필터를 사용하여 검색 범위를 좁혀보세요.')}<div class="opts"></div></div><div class="bottom"><b class="mc">0</b> 일치하는 항목을 발견했습니다! &nbsp; <b class="ac2">0</b> 활성 상태 필터</div></div></div>`);
  stage().replaceChildren(el);
  const refresh = () => net.send({ t: 'listOnline', region: device.region });
  const draw = () => {
    $('.mid', el).textContent = F.gameType === 'hns' ? '숨바꼭질' : '클래식';
    $('.ac', el).textContent = $('.ac2', el).textContent = activeCount();
    const shown = list.filter(match);
    $('.mc', el).textContent = shown.length;
    $('.bc', el).textContent = total > 200 ? '200+' : total;
    $('.glist', el).innerHTML = shown.map(g => `<div class="grow" data-c="${g.code}"><div class="bgcrew">${crewSVG({ color: 8 })}${crewSVG({ color: 4 })}${crewSVG({ color: 8 })}</div>
      <div class="mapname">${mapIcon(g.map)}${mapName(g.map)}</div><div class="tags"><span>플레이어 속도 ${fmtSetting(SETTINGS[2], g.speed)}</span><span>역할 ${g.roles ? '켬' : '끔'}</span></div>
      <div class="cnt">🧑 ${g.n}/${g.max}</div><button class="more" data-more="${g.code}">더 보기...</button></div>`).join('') || `<div class="empty">조건에 맞는 게임이 없습니다.<br>새로 고침하거나 직접 게임을 만들어 보세요!</div>`;
    $$('.grow', el).forEach(r => r.onclick = e => {
      sfx('click');
      const g = list.find(x => x.code === r.dataset.c);
      if (e.target.dataset.more) return detail(g);
      net.send({ t: 'join', code: g.code });
    });
    drawFilters();
  };
  const drawFilters = () => {
    $$('.ttabs button', el).forEach(b => b.classList.toggle('on', b.dataset.t === ftab));
    const o = $('.opts', el);
    o.innerHTML = ftab === '일반' ? `
      <div class="orow"><span class="lab">게임 유형</span>${opt(F.gameType === 'classic', '클래식', 'data-gt="classic"')}${opt(F.gameType === 'hns', '숨바꼭질', 'data-gt="hns"')}</div>
      <div class="orow"><span class="lab">맵</span>${MAPS.map(m => `<button class="mapb ${F.maps.has(m.id) ? 'on' : ''}" data-map="${m.id}" title="${m.name}">${mapIcon(m.id)}<i class="chk"></i></button>`).join('')}</div>
      <div class="orow"><span class="lab">임포스터 수</span>${[1, 2, 3].map(n => opt(F.imps.has(n), n, `data-imp="${n}"`)).join('')}</div>
      <div class="orow"><span class="lab">역할</span>${opt(F.roles === true, '켬', 'data-role="1"')}${opt(F.roles === false, '끔', 'data-role="0"')}</div>
      <div class="orow"><span class="lab">로비 크기</span>${SIZES.map((s, i) => opt(F.sizes.has(i), s[0], `data-size="${i}"`)).join('')}</div>
      <div class="orow"><span class="lab">태그</span>${TAGS.slice(1).map((t, i) => opt(F.tags.has(i + 1), t, `data-tag="${i + 1}"`)).join('')}</div>`
      : `<div class="orow"><span class="lab">채팅 유형</span>${opt(F.chatType === 'free', '자유 채팅', 'data-ct="free"')}${opt(F.chatType === 'quick', '빠른 채팅', 'data-ct="quick"')}</div>
      <div class="orow" style="align-items:flex-start"><span class="lab">채팅 언어</span><div class="langs">${CHAT_LANGS.map((l, i) => opt(F.langs.has(i), l, `data-lang="${i}"`)).join('')}</div></div>`;
    const tog = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));
    o.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      sfx('click');
      const d = b.dataset;
      if (d.gt) F.gameType = d.gt;
      if (d.map) tog(F.maps, d.map);
      if (d.imp) tog(F.imps, +d.imp);
      if (d.role) F.roles = F.roles === (d.role === '1') ? null : d.role === '1';
      if (d.size) tog(F.sizes, +d.size);
      if (d.tag) tog(F.tags, +d.tag);
      if (d.ct) F.chatType = F.chatType === d.ct ? null : d.ct;
      if (d.lang) tog(F.langs, +d.lang);
      draw();
    };
  };
  $$('.ttabs button', el).forEach(b => b.onclick = () => { sfx('click'); ftab = b.dataset.t; drawFilters(); });
  $$('.ftab', el).forEach(b => b.onclick = () => { sfx('click'); $('.fpanel', el).classList.toggle('closed'); });
  $('.clr', el).onclick = () => { Object.assign(F, { maps: new Set(), imps: new Set(), roles: null, sizes: new Set(), tags: new Set(), chatType: null, langs: new Set() }); draw(); };
  $('.region', el).onchange = e => { device.region = e.target.value; saveDevice(); refresh(); };
  $('.back2', el).onclick = () => { sfx('click'); off(); go('menu', 'online'); };
  $('.refresh', el).onclick = () => { sfx('click'); refresh(); };
  const off = net.on('list', m => { if (m.kind !== 'online' || !el.isConnected) return; list = m.rooms; total = m.total; draw(); });
  refresh(); draw();
  const iv = setInterval(() => (el.isConnected ? refresh() : (clearInterval(iv), off())), 5000);
};
function detail(g) {
  const m = modal(`<h2 style="font-size:40px">${esc(g.host)}님의 게임</h2><div style="width:640px;font-size:24px;line-height:1.9">
    <div>맵: ${mapName(g.map)} · ${g.gameType === 'hns' ? '숨바꼭질' : '클래식'}</div><div>인원: ${g.n}/${g.max} · 임포스터 ${g.impostors}명</div>
    <div>채팅: ${g.chatType === 'free' ? '자유 채팅' : '빠른 채팅'} · ${CHAT_LANGS[g.chatLang]}</div><div>태그: ${TAGS[g.tag]} · 역할 ${g.roles ? '켬' : '끔'}</div>
    <div>플레이어 속도: ${fmtSetting(SETTINGS[2], g.speed)}</div><div class="row-c"><button class="obtn">참가</button></div></div>`);
  $('.obtn', m.el).onclick = () => { m.close(); net.send({ t: 'join', code: g.code }); };
}

// ---------- 게임 만들기 ----------
screens.create = (mode = 'online', gameType = 'classic') => {
  const s = { ...defaultSettings(), gameType };
  let tab = '일반';
  const el = h(`<div class="screen dark"><button class="back2">뒤로</button><div class="titlebar">게임 만들기</div>
    <div class="ccard"><div class="art">${cardArt()}</div><div class="bn"></div></div>
    <div class="ttabs" style="left:676px;top:112px"><button data-t="일반" style="width:272px">일반</button><button data-t="채팅" style="width:272px">채팅</button></div>
    <div class="cpanel" style="top:176px">${hintBox('다음 설정값을 지정하여 로비를 맞춤 설정하세요.')}<div class="opts" style="padding-left:96px;inset:90px 0 0 0"></div></div>
    <button class="makebtn" style="left:796px">게임 만들기</button></div>`);
  stage().replaceChildren(el);
  const draw = () => {
    $('.bn', el).textContent = mapName(s.map);
    $$('.ttabs button', el).forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    const o = $('.opts', el);
    const child = me.status !== 'green';
    o.innerHTML = tab === '일반' ? `
      <div class="orow"><span class="lab">게임 유형</span>${opt(s.gameType === 'classic', '클래식', 'data-gt="classic" style="width:220px"')}${opt(s.gameType === 'hns', '숨바꼭질', 'data-gt="hns" style="width:220px"')}</div>
      <div class="orow"><span class="lab">맵</span>${MAPS.map(m => `<button class="mapb ${s.map === m.id ? 'on' : ''} ${m.ready ? '' : 'lock'}" data-map="${m.id}" title="${m.name}${m.ready ? '' : ' (준비 중)'}">${mapIcon(m.id)}<i class="chk"></i></button>`).join('')}</div>
      <div class="orow"><span class="lab">용량</span><div class="cap"><button data-cap="-1">-</button><span class="n">${crewSVG({ color: 0 }, { noPet: true })}${s.maxPlayers}</span><button data-cap="1">+</button></div></div>
      <div class="orow"><span class="lab">태그</span>${TAGS.map((t, i) => opt(s.tag === i, t, `data-tag="${i}" style="width:140px"`)).join('')}</div>
      <div class="orow"><span class="lab">${mode === 'online' ? '지역' : '공개 범위'}</span>${mode === 'online' ? regionSel(device.region) : '<span style="font-size:22px;color:#aaa">같은 와이파이에 연결된 사람만 볼 수 있어요</span>'}</div>
      <div class="orow"><span class="lab">역할</span>${opt(s.roles, '켬', 'data-roles="1"')}${opt(!s.roles, '끔', 'data-roles="0"')}</div>`
      : `<div class="orow"><span class="lab">채팅 유형</span>${opt(s.chatType === 'free', '자유 채팅', 'data-ct="free" style="width:220px"')}${opt(s.chatType === 'quick', '빠른 채팅', 'data-ct="quick" style="width:220px"')}</div>
      ${child ? '<p style="margin-left:162px;color:#29e9d5;font-size:19px">핑크불/청록불 계정은 어떤 로비에서든 빠른 채팅만 쓸 수 있어요.</p>' : ''}
      <div class="orow" style="align-items:flex-start"><span class="lab">채팅 언어</span><div class="langs">${CHAT_LANGS.map((l, i) => opt(s.chatLang === i, l, `data-lang="${i}"`)).join('')}</div></div>`;
    $('.region', o)?.addEventListener('change', e => { device.region = e.target.value; saveDevice(); });
  };
  $('.opts', el).onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    sfx('click');
    const d = b.dataset;
    if (d.gt) s.gameType = d.gt;
    if (d.map) { if (MAPS.find(m => m.id === d.map).ready) s.map = d.map; else toast(`${mapName(d.map)} 맵은 아직 준비 중입니다.`); }
    if (d.cap) s.maxPlayers = Math.min(15, Math.max(4, s.maxPlayers + +d.cap));
    if (d.tag) s.tag = +d.tag;
    if (d.roles) s.roles = d.roles === '1';
    if (d.ct) s.chatType = d.ct;
    if (d.lang) {
      s.chatLang = +d.lang;
      if (s.chatLang === KO && mode === 'online' && device.region !== 'as') { device.region = 'as'; saveDevice(); toast('한국어 로비는 아시아 서버에서 열립니다. 지역을 아시아로 바꿨어요.'); }
    }
    draw();
  };
  $$('.ttabs button', el).forEach(b => b.onclick = () => { sfx('click'); tab = b.dataset.t; draw(); });
  $('.back2', el).onclick = () => { sfx('click'); mode === 'online' ? go('menu', 'online') : go('host'); };
  $('.makebtn', el).onclick = () => {
    sfx('click');
    if (mode === 'online' && s.chatLang === KO && device.region !== 'as') return toast('한국어 로비는 아시아 지역에서만 만들 수 있어요.');
    net.send({ t: 'create', mode, region: device.region, settings: s });
  };
  draw();
};
function cardArt() {
  const c = (col, x, y, sc, o = {}) => `<g transform="translate(${x} ${y}) scale(${sc})">${crewSVG({ color: col, ...o }).replace('<svg', '<svg width="250" height="180"')}</g>`;
  return `<svg viewBox="0 0 320 600" width="320" height="600"><rect width="320" height="600" fill="#2a3352"/><path d="M0 230 Q160 170 320 230 V600 H0Z" fill="#b7b29f"/>
    <path d="M0 260 L320 260 M0 330 L320 330 M0 400 L320 400 M0 470 L320 470 M60 230 L20 600 M160 220 L160 600 M260 230 L300 600" stroke="#a29d89" stroke-width="3"/>
    <circle cx="70" cy="40" r="44" fill="#1e7d36" stroke="#000" stroke-width="5"/><circle cx="270" cy="60" r="40" fill="#fff" stroke="#000" stroke-width="5"/>
    ${c(10, -40, 170, .7, { hat: 'crown' })}${c(14, 50, 160, .65)}<ellipse cx="190" cy="330" rx="90" ry="30" fill="#3a6aa8" stroke="#000" stroke-width="5"/>
    ${c(7, -60, 330, .8)}${c(0, 70, 360, .9, { flip: true })}<path d="M60 520 C100 480 160 500 140 560 Z" fill="#f2a5c4" stroke="#000" stroke-width="5"/></svg>`;
}

// ---------- 코드 입력 ----------
screens.enterCode = () => {
  const m = modal(`<h2 style="font-size:44px">코드 입력</h2><input class="inp" maxlength="6" placeholder="ABCDEF" style="text-align:center;letter-spacing:14px;font-size:44px;height:80px;text-transform:uppercase">
    <p class="err"></p><div class="row-c"><button class="obtn">참가</button></div>`, { cls: 'small' });
  const inp = $('.inp', m.el);
  inp.oninput = () => (inp.value = inp.value.toUpperCase().replace(/[^A-Z]/g, ''));
  setTimeout(() => inp.focus(), 50);
  const go2 = () => { if (inp.value.length !== 6) return ($('.err', m.el).textContent = '6자리 코드를 입력하세요.'); net.send({ t: 'join', code: inp.value }); m.close(); };
  $('.obtn', m.el).onclick = go2;
  inp.onkeydown = e => e.key === 'Enter' && go2();
};

// ---------- 로컬: 주최 화면 ----------
screens.host = () => {
  const el = h(`<div class="screen dark host"><div class="topbar" style="z-index:5"><div class="acct-ico"></div><div class="light ${me.status}"></div><div class="tb-name">${esc(displayName())}</div><button class="friend-btn">친구</button></div>
    <div class="avatar">${crewSVG({ ...profile.look, color: 7 }, { noPet: true })}</div><h1>주최</h1><div class="uline"></div>
    <div class="mk">만들기 <button data-gt="classic">클래식</button><button data-gt="hns">숨바꼭질</button></div>
    <div class="gl-lab">참가 가능한 게임</div><div class="gl"></div><button class="btmback">뒤로</button><button class="helpq">?</button><div class="vtext">${VERSION}</div></div>`);
  stage().replaceChildren(el);
  el.prepend(h('<div class="space" style="z-index:0"></div>'));
  $$('[data-gt]', el).forEach(b => b.onclick = () => { sfx('click'); off(); go('create', 'local', b.dataset.gt); });
  $('.btmback', el).onclick = () => { sfx('click'); off(); go('menu', 'play'); };
  $('.friend-btn', el).onclick = () => toast('로컬 게임은 같은 와이파이에 연결된 친구가 이 화면에서 바로 참가할 수 있어요.');
  $('.helpq', el).onclick = () => modal(`<p class="cb-msg" style="text-align:center">로컬 게임은 <b>같은 와이파이(공유기)</b>에 연결된 기기끼리만 보이고 참가할 수 있어요.\n\n한 명이 [만들기]로 게임을 열면,\n같은 와이파이의 다른 사람 화면의 "참가 가능한 게임"에 나타납니다.</p>`, { cls: 'small' });
  const off = net.on('list', m => {
    if (m.kind !== 'local' || !el.isConnected) return;
    $('.gl', el).innerHTML = m.rooms.map(g => `<button data-c="${g.code}">${crewSVG(g.look || {}, { noPet: true })}<span>${esc(g.host)}</span><span style="margin-left:auto">${mapName(g.map)} · ${g.gameType === 'hns' ? '숨바꼭질' : '클래식'} · 🧑 ${g.n}/${g.max}</span></button>`).join('')
      || '<p style="color:#888;text-align:center;font-size:22px;margin-top:110px">같은 와이파이에서 열린 게임을 찾는 중…</p>';
    $$('.gl [data-c]', el).forEach(b => b.onclick = () => { sfx('click'); net.send({ t: 'join', code: b.dataset.c }); });
  });
  const iv = setInterval(() => (el.isConnected ? net.send({ t: 'listLocal' }) : (clearInterval(iv), off())), 2000);
  net.send({ t: 'listLocal' });
};

// ---------- 플레이 방법 ----------
const SLIDES = [
  [{ color: 10 }, '<b>크루원</b>은 우주선을 고치는 임무를 모두 끝내거나,<br>회의에서 투표로 임포스터를 찾아 추방하면 승리합니다.'],
  [{ color: 0, hat: 'horns' }, '<b style="color:#f33">임포스터</b>는 크루원을 몰래 처치하고, 벤트로 이동하고,<br>사보타주로 혼란을 일으켜 크루원 수를 임포스터 수만큼 줄이면 승리합니다.'],
  [{ color: 5 }, '시체를 발견하면 <b>신고</b>, 수상하면 식당의 <b>긴급 버튼</b>!<br>회의에서 토론하고 투표하세요. 동점이거나 건너뛰기가 많으면 아무도 추방되지 않아요.'],
  [{ color: 3, pet: 'mini' }, '<b>조작</b>: 왼쪽 아래 조이스틱 또는 WASD/방향키로 이동<br>E/스페이스 = 사용 · Q = 처치 · R = 신고 · Tab = 지도'],
  [{ color: 6 }, '<b>사보타주</b>: 원자로·산소는 제한 시간 안에 두 곳을 고쳐야 하고,<br>조명이 꺼지면 크루원의 시야가 좁아집니다. 통신 방해 중엔 임무 목록이 사라져요.'],
];
screens.howto = () => {
  let i = 0;
  const el = h(`<div class="screen dark howto"><button class="back2">뒤로</button><div class="titlebar">플레이 방법</div><div class="slide"></div>
    <div class="nav"><button class="obtn prev">이전</button><button class="obtn next">다음</button></div></div>`);
  stage().replaceChildren(el);
  const draw = () => { $('.slide', el).innerHTML = `${crewSVG(SLIDES[i][0])}<p>${SLIDES[i][1]}</p><p style="color:#888">${i + 1} / ${SLIDES.length}</p>`; };
  $('.prev', el).onclick = () => { sfx('click'); i = (i + SLIDES.length - 1) % SLIDES.length; draw(); };
  $('.next', el).onclick = () => { sfx('click'); i = (i + 1) % SLIDES.length; draw(); };
  $('.back2', el).onclick = () => { sfx('click'); go('menu', 'play'); };
  draw();
};
