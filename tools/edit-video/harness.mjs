// 게임을 헤드리스 크로미움에서 가상 시간으로 한 프레임씩 진행시키며 촬영하는 공용 하네스
import { chromium } from 'playwright';

export const W = Number(process.env.W || 1280), H = Number(process.env.H || 720);

export async function openGame() {
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('PAGEERR', e.message));
  await page.addInitScript(() => {
    const realNow = performance.now.bind(performance);
    const realRAF = window.requestAnimationFrame.bind(window);
    const vt = (window.__vt = { on: false, t: 0, cb: null });
    performance.now = () => (vt.on ? vt.t : realNow());
    window.requestAnimationFrame = (cb) => {
      if (vt.on) { vt.cb = cb; return 1; }
      return realRAF(cb);
    };
    try {
      localStorage.setItem('freefreely.settings.v1', JSON.stringify({ onScreenControls: 'off', renderScale: 1, shadows: true, bloom: true, antialias: true }));
    } catch (e) { /* noop */ }
  });
  await page.goto('http://localhost:8080/index.html');
  await page.waitForFunction(() => window.__FREEFREELY__ && window.__FREEFREELY__.state === 'menu', null, { timeout: 180000 });
  // 가상 시간 전환 + 렌더 직전 카메라 훅 설치
  await page.evaluate(() => {
    const g = window.__FREEFREELY__;
    window.__vt.t = performance.now();
    window.__vt.on = true;
    const origRender = g._render.bind(g);
    g._render = () => {
      if (window.__camHook) window.__camHook(g);
      origRender();
    };
    document.body.classList.add('rec');
    const st = document.createElement('style');
    st.textContent = '#hud,#toast,#flight-ui,#screen-menu,#screen-crash,#screen-pause,.stick-wrap,.throttle-wrap{display:none!important}';
    document.head.appendChild(st);
  });
  return { browser, page };
}

/** dtSim 만큼 게임을 진행시키고 화면을 JPEG 로 저장 */
export async function step(page, dtSim) {
  await page.evaluate((dt) => {
    const vt = window.__vt;
    vt.t += dt * 1000;
    const cb = vt.cb; vt.cb = null;
    if (cb) cb();
  }, dtSim);
}

import fs from 'fs';
/** 진행 + 같은 태스크에서 캔버스를 바로 읽어 JPEG 저장 (DOM 오버레이 제외) */
export async function frame(page, dtSim, file) {
  const url = await page.evaluate((dt) => {
    const vt = window.__vt;
    vt.t += dt * 1000;
    const cb = vt.cb; vt.cb = null;
    if (cb) cb();
    return document.getElementById('gl').toDataURL('image/jpeg', 0.94);
  }, dtSim);
  if (file) fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
}
export async function shot(page, file) {
  await page.screenshot({ path: file, type: 'jpeg', quality: 93 });
}
