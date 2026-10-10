// 시작: 화면 맞춤 → 연령 확인 → 로그인/게스트 → 로딩(초록 크루원 회전) → 공지
import { stage, net, me, device, saveDevice, profile, useProfile, sleep } from './core.js';
import { app, go } from './ui/nav.js';
import { updateTop, refreshMenu } from './ui/menu.js';
import { ageCheck, signIn } from './ui/auth.js';
import './ui/settings.js';
import './ui/lobbies.js';
import './ui/inventory.js';
import './game/play.js';

function fit() { stage().style.transform = `translate(-50%,-50%) scale(${Math.min(innerWidth / 1600, innerHeight / 720)})`; }
addEventListener('resize', fit);
fit();

let welcomed = null;
const welcome = new Promise(r => (welcomed = r));
net.on('welcome', m => {
  Object.assign(me, { id: m.id, status: m.status, name: m.name, account: m.account });
  if (!m.account) me.friends = { friends: [], requests: [] };
  if (!m.account && device.token) { device.token = ''; saveDevice(); }
  useProfile(m.account ? m.account.id : 'guest');
  net.send({ t: 'look', look: profile.look });
  welcomed();
  refreshMenu();
});
net.on('close', () => { me.status = 'off'; updateTop(); });

(async () => {
  go('menu');
  if (!device.birth) await ageCheck();
  net.connect();
  if (!device.chose && !device.token) await signIn();
  const t0 = performance.now();
  await welcome;
  await sleep(Math.max(0, 1800 - (performance.now() - t0)));
  app.loading = false;
  updateTop();
  if (!app.inRoom) go('news', 0);
})();
