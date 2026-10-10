// 설정: 일반 / 그래픽 / 데이터 (게임 방 안에서는 데이터 탭이 사라짐)
import { $, $$, h, modal, sfx, settings, saveSettings, updateMusicVolume, profile, device, me, net, confirmBox } from '../core.js';
import { screens, app } from './nav.js';

const ROWS = {
  일반: [
    ['music', '음악 볼륨', 'range', 0, 1], ['sfx', '효과음 볼륨', 'range', 0, 1],
    ['control', '조작 방식', 'tog', [['joystick', '조이스틱'], ['touch', '터치']]], ['joySize', '조이스틱 크기', 'range', 0.6, 1.4],
    ['lang', '언어', 'tog', [['ko', '한국어']]], ['censor', '채팅 검열', 'bool'], ['invites', '친구 및 로비 초대 허용', 'bool'],
    ['streamer', '스트리머 모드 (코드 숨기기)', 'bool'], ['colorblind', '색맹 모드 (색 이름 표시)', 'bool'],
  ],
  그래픽: [
    ['fullscreen', '전체 화면', 'full'], ['resolution', '해상도', 'tog', [[0.5, '50%'], [0.75, '75%'], [1, '100%']]],
    ['fps', '프레임 제한', 'tog', [[30, '30'], [60, '60'], [0, '무제한']]], ['lighting', '조명 효과', 'bool'], ['bgAnim', '메뉴 배경 애니메이션', 'bool'],
  ],
  데이터: [
    ['ads', '맞춤형 광고', 'bool'], ['analytics', '익명 사용 통계 보내기', 'bool'], ['privacy', '개인정보 처리방침', 'btn'],
    ['export', '내 데이터 내보내기', 'btn'], ['wipe', '이 기기의 데이터 삭제', 'btn'], ['delacc', '계정 삭제', 'btn'],
  ],
};

screens.settings = ({ onLeave } = {}) => {
  const tabs = app.inRoom ? ['일반', '그래픽'] : ['일반', '그래픽', '데이터'];
  let tab = '일반';
  const m = modal(`<div class="set-tabs">${tabs.map(t => `<button data-t="${t}">${t}</button>`).join('')}</div><div class="set-body"></div>
    ${onLeave ? '<div class="row-c"><button class="obtn leave" style="border-color:#f55">게임 나가기</button></div>' : ''}`);
  if (onLeave) $('.leave', m.el).onclick = () => { m.close(); onLeave(); };
  const render = () => {
    $$('.set-tabs button', m.el).forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    const body = $('.set-body', m.el);
    body.innerHTML = ROWS[tab].map(([k, label, type, a, b]) => {
      let ctl = '';
      if (type === 'range') ctl = `<input type="range" min="${a}" max="${b}" step="0.05" value="${settings[k]}" data-k="${k}">`;
      else if (type === 'bool') ctl = `<div class="tog"><button data-k="${k}" data-v="1" class="${settings[k] ? 'on' : ''}">켬</button><button data-k="${k}" data-v="0" class="${settings[k] ? '' : 'on'}">끔</button></div>`;
      else if (type === 'tog') ctl = `<div class="tog">${a.map(([v, l]) => `<button data-k="${k}" data-v="${v}" class="${String(settings[k]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
      else if (type === 'full') ctl = `<div class="tog"><button data-full="1" class="${document.fullscreenElement ? 'on' : ''}">켬</button><button data-full="0" class="${document.fullscreenElement ? '' : 'on'}">끔</button></div>`;
      else if (type === 'btn') { if (k === 'delacc' && !me.account) return ''; ctl = `<button class="obtn" data-btn="${k}" style="min-width:160px;height:48px;font-size:22px">${k === 'privacy' ? '보기' : k === 'export' ? '내보내기' : '삭제'}</button>`; }
      return `<div class="set-row"><span>${label}</span>${ctl}</div>`;
    }).join('');
    $$('input[type=range]', body).forEach(r => r.oninput = () => { settings[r.dataset.k] = +r.value; saveSettings(); if (r.dataset.k === 'music') updateMusicVolume(); });
    $$('[data-k][data-v]', body).forEach(b => b.onclick = () => {
      sfx('click');
      const k = b.dataset.k, v = b.dataset.v, def = typeof settings[k];
      settings[k] = def === 'boolean' ? v === '1' : def === 'number' ? +v : v;
      saveSettings(); render(); window.dispatchEvent(new Event('settings'));
    });
    $$('[data-full]', body).forEach(b => b.onclick = async () => {
      try { if (b.dataset.full === '1') await document.documentElement.requestFullscreen(); else if (document.fullscreenElement) await document.exitFullscreen(); } catch { /* 미지원 */ }
      setTimeout(render, 200);
    });
    $$('[data-btn]', body).forEach(b => b.onclick = () => action(b.dataset.btn));
  };
  $$('.set-tabs button', m.el).forEach(b => b.onclick = () => { sfx('click'); tab = b.dataset.t; render(); });
  render();
};

async function action(k) {
  sfx('click');
  if (k === 'privacy') modal(`<h2 style="font-size:40px">개인정보 처리방침</h2><div style="width:800px;font-size:21px;line-height:1.7">
    <p>이 팬 제작 게임은 다음 정보만 저장합니다.</p><ul><li>이 기기: 설정, 꾸미기·통계·콩 (브라우저 저장소)</li><li>서버(계정을 만든 경우): 이메일, 암호화된 비밀번호, 생일, 게임 이름, 친구 목록, 만 14세 미만의 경우 보호자 이메일</li></ul>
    <p>보호자 이메일은 인증 메일 발송에만 쓰입니다. 계정 삭제 시 서버의 정보가 모두 지워집니다.</p></div>`);
  if (k === 'export') {
    const blob = new Blob([JSON.stringify({ settings, profile, device: { birth: device.birth, region: device.region }, account: me.account }, null, 2)], { type: 'application/json' });
    const a = h(`<a download="amongus-data.json" href="${URL.createObjectURL(blob)}"></a>`); a.click();
  }
  if (k === 'wipe' && await confirmBox('이 기기에 저장된 설정, 꾸미기, 통계, 로그인 정보가 모두 지워집니다.\n계속할까요?', '삭제')) {
    Object.keys(localStorage).filter(x => x.startsWith('au_')).forEach(x => localStorage.removeItem(x));
    location.reload();
  }
  if (k === 'delacc' && await confirmBox('계정을 영구 삭제할까요?', '삭제')) { net.send({ t: 'deleteAccount' }); device.token = ''; localStorage.setItem('au_device', JSON.stringify(device)); }
}
