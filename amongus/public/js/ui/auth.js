// 연령 확인, 로그인/계정 만들기/게스트, 계정 관리, 보호자 인증
import { $, $$, h, esc, stage, modal, toast, sfx, net, me, device, saveDevice, isChildBirth, confirmBox } from '../core.js';
import { screens } from './nav.js';

// 목록에서 하나 고르는 팝업 (스크린샷의 월/일/년 선택창)
function pickList(title, items, cur) {
  return new Promise(res => {
    const back = h(`<div class="modal-back" style="background:rgba(0,0,0,.4)"><div class="pick-title">${title}</div><div class="pick-list">
      ${items.map(([v, label]) => `<button data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${label}</button>`).join('')}</div></div>`);
    stage().append(back);
    back.onclick = e => { const b = e.target.closest('[data-v]'); if (b || e.target === back) { sfx('click'); back.remove(); res(b ? b.dataset.v : null); } };
  });
}

export function ageCheck() {
  return new Promise(res => {
    const val = { m: '', d: '', y: '' };
    const m = modal(`<div class="agebox"><h1>연령 확인</h1><p style="font-size:30px;margin:0">생일을 입력하세요.</p>
      <div class="row"><button class="selbtn" data-k="m">월</button><button class="selbtn" data-k="d">일</button><button class="selbtn" data-k="y">년</button></div>
      <div class="row"><button class="obtn sub" style="width:300px">제출</button><button class="obtn q" style="min-width:68px;width:68px;padding:0">?</button></div><p class="err"></p></div>`, { close: false });
    const now = new Date().getFullYear();
    const lists = { m: ['월', Array.from({ length: 12 }, (_, i) => [i + 1, `${i + 1}월`])], d: ['일', Array.from({ length: 31 }, (_, i) => [i + 1, i + 1])], y: ['년', Array.from({ length: 100 }, (_, i) => [now - i, now - i])] };
    $$('.selbtn', m.el).forEach(b => b.onclick = async () => {
      sfx('click');
      const k = b.dataset.k, v = await pickList(lists[k][0], lists[k][1], val[k]);
      if (v == null) return;
      val[k] = +v; b.textContent = lists[k][1].find(x => String(x[0]) === v)[1]; b.classList.add('set');
    });
    $('.q', m.el).onclick = () => modal(`<p class="cb-msg" style="text-align:center">나이에 맞는 안전한 플레이 환경을 위해 생일을 확인합니다.\n만 14세 미만은 <b style="color:#29e9d5">청록불</b> 계정이 되어\n빠른 채팅만 사용할 수 있고, 온라인 플레이에는 보호자 이메일 인증이 필요합니다.</p>`, { cls: 'small' });
    $('.sub', m.el).onclick = () => {
      sfx('click');
      const { m: mo, d, y } = val, dt = new Date(y, mo - 1, d);
      if (!mo || !d || !y || dt.getMonth() !== mo - 1 || dt > new Date()) return ($('.err', m.el).textContent = '올바른 생일을 선택하세요.');
      device.birth = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      saveDevice(); m.back.remove(); res();
    };
  });
}

export function signIn() {
  return new Promise(res => {
    const child = isChildBirth(device.birth);
    const m = modal(`<div style="width:760px;text-align:center"><h2>AMONG US 계정</h2>
      <p style="font-size:22px;color:#bbb">계정으로 로그인하면 <b style="color:#3f3">초록불</b>이 켜지고 자유 채팅·이름 변경·친구 기능을 쓸 수 있어요.<br>
      게스트는 <b style="color:#ff5ed1">핑크불</b>, 만 14세 미만은 <b style="color:#29e9d5">청록불</b>이며 빠른 채팅만 쓸 수 있습니다.</p>
      <div class="row-c" style="flex-direction:column;align-items:center;gap:14px"><button class="obtn" data-a="login" style="width:420px">로그인</button>
      <button class="obtn" data-a="reg" style="width:420px">계정 만들기</button><button class="obtn" data-a="guest" style="width:420px">게스트로 플레이</button></div>
      ${child ? '<p style="color:#29e9d5;font-size:20px">만 14세 미만: 계정을 만들면 보호자 이메일로 인증 메일이 발송됩니다.</p>' : ''}</div>`, { close: false });
    $$('[data-a]', m.el).forEach(b => b.onclick = async () => {
      sfx('click');
      const a = b.dataset.a;
      if (a === 'guest') { device.chose = true; device.token = ''; saveDevice(); m.back.remove(); return res(); }
      m.back.style.display = 'none';
      const ok = await authForm(a === 'reg');
      if (ok) { m.back.remove(); res(); } else m.back.style.display = '';
    });
  });
}

// 로그인/가입 폼. 성공하면 true
export function authForm(register) {
  return new Promise(res => {
    const child = isChildBirth(device.birth);
    const m = modal(`<h2>${register ? '계정 만들기' : '로그인'}</h2><div class="form">
      <label>이메일</label><input class="inp" name="email" type="email" autocomplete="email">
      <label>비밀번호 ${register ? '(6자 이상)' : ''}</label><input class="inp" name="pass" type="password" autocomplete="${register ? 'new-password' : 'current-password'}">
      ${register && !child ? '<label>게임 이름 (1~10자)</label><input class="inp" name="name" maxlength="10">' : ''}
      ${register && child ? '<label>보호자 이메일 (인증 메일이 발송됩니다)</label><input class="inp" name="parentEmail" type="email">' : ''}
      <p class="err"></p><div class="row-c" style="margin:0"><button class="obtn go">${register ? '만들기' : '로그인'}</button></div></div>`, { onClose: () => res(false) });
    const v = n => $(`[name=${n}]`, m.el)?.value || '';
    $('.go', m.el).onclick = () => {
      sfx('click');
      if (!net.open) return ($('.err', m.el).textContent = '서버에 연결 중입니다. 잠시 후 다시 시도하세요.');
      net.send(register ? { t: 'register', email: v('email'), pass: v('pass'), name: v('name'), parentEmail: v('parentEmail'), birth: device.birth } : { t: 'login', email: v('email'), pass: v('pass') });
      const offOk = net.on('authOk', a => {
        offOk(); offErr();
        device.token = a.token; device.chose = true; saveDevice();
        m.back.remove(); res(true);
        if (a.created && child) toast('보호자 이메일로 인증 메일을 보냈습니다. 인증이 끝나면 온라인 플레이가 가능합니다.', 5000);
      });
      const offErr = net.on('authErr', a => { offOk(); offErr(); $('.err', m.el).textContent = a.msg; });
    };
  });
}

// 계정 관리 (내 계정 → 계정 관리)
screens.accountManage = () => {
  const a = me.account;
  const st = { green: ['초록불', '#3f3', '로그인한 계정 · 모든 기능 사용 가능'], pink: ['핑크불', '#ff5ed1', '게스트 계정 · 빠른 채팅만 가능, 이름 변경 불가'],
    teal: ['청록불', '#29e9d5', '만 14세 미만 · 빠른 채팅만 가능, 온라인은 보호자 인증 필요'], off: ['연결 안 됨', '#888', ''] }[me.status];
  const m = modal(`<h2>계정 관리</h2><div style="width:760px;font-size:24px;line-height:1.9">
    <div>상태: <b style="color:${st[1]}">● ${st[0]}</b> <span style="color:#aaa;font-size:20px">${st[2]}</span></div>
    <div>계정: ${a ? esc(a.email) : '게스트 (로그인하지 않음)'}</div><div>생일: ${esc(a?.birth || device.birth)}</div>
    ${a?.child ? `<div>보호자 이메일: ${esc(a.parentEmail)} — ${a.parentVerified ? '<b style="color:#3f3">인증 완료</b>' : '<b style="color:#fc3">인증 대기 중</b>'}</div>` : ''}
    <div class="row-c" style="flex-wrap:wrap">${a ? `${a.child && !a.parentVerified ? '<button class="obtn" data-a="resend">인증 메일 다시 보내기</button>' : ''}
      <button class="obtn" data-a="logout">로그아웃</button><button class="obtn" data-a="del" style="border-color:#f55;color:#f88">계정 삭제</button>`
    : `<button class="obtn" data-a="login">로그인</button><button class="obtn" data-a="reg">계정 만들기</button><button class="obtn" data-a="age">연령 다시 확인</button>`}</div></div>`);
  $$('[data-a]', m.el).forEach(b => b.onclick = async () => {
    sfx('click');
    const k = b.dataset.a;
    if (k === 'resend') net.send({ t: 'resendParent' });
    if (k === 'logout') { net.send({ t: 'logout', token: device.token, guestName: device.guestName }); device.token = ''; saveDevice(); m.close(); }
    if (k === 'del' && await confirmBox('계정을 삭제하면 되돌릴 수 없습니다.\n정말 삭제할까요?', '삭제')) { net.send({ t: 'deleteAccount' }); device.token = ''; saveDevice(); m.close(); }
    if (k === 'login' || k === 'reg') { m.close(); await authForm(k === 'reg'); }
    if (k === 'age') { m.close(); await ageCheck(); net.send({ t: 'hello', token: device.token, birth: device.birth, guestName: device.guestName }); }
  });
};
net.on('account', a => { me.account = a.account; toast(a.account.parentVerified ? '보호자 인증이 완료되었습니다! 이제 온라인에서 플레이할 수 있어요.' : '계정 정보가 갱신되었습니다.', 4000); });
