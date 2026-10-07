// 홍보 영상에 쓸 진짜 게임 화면 찍기 (1080×1920). 에뮬레이터 + 여러 학교 계정으로 땅을 알록달록하게 채운 뒤 장면마다 찍는다.
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const fs = require('fs');
const SP = '/tmp/claude-0/-home-user-kimjamminGame/1426f1e1-75d0-5533-8284-d8861f4a6af5/scratchpad/';
const SDK = SP + 'fbsdk/node_modules/firebase/';
const ORIGIN = 'https://192.0.2.2:3443', DBURL = 'https://192.0.2.2:9443?ns=math-land-eater-default-rtdb';
const OUT = SP + 'promo/shots/';
fs.mkdirSync(OUT, { recursive: true });
const plan = JSON.parse(fs.readFileSync(SP + 'promo/plan.json'));
const log = (...a) => console.log(...a);
const NICKS = ['수학천재', '땅부자', '계산왕', '분수마스터', '구구단킹', '도형짱', '번개손', '별빛', '용감한곰', '날쌘토끼', '파란하늘', '초코칩', '햇살', '도토리', '무지개', '해바라기', '꼬마장군', '반짝이', '새싹', '바람'];
(async () => {
  const b = await chromium.launch({ proxy: { server: process.env.HTTPS_PROXY, bypass: '192.0.2.2' } });
  const mk = async () => {
    const ctx = await b.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, serviceWorkers: 'block', ignoreHTTPSErrors: true, isMobile: true, hasTouch: true });
    await ctx.route('https://www.gstatic.com/firebasejs/10.12.2/*', r => r.fulfill({ path: SDK + r.request().url().split('/').pop(), contentType: 'text/javascript' }));
    await ctx.route(ORIGIN + '/play/js/firebase-config.js', async r => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace(/databaseURL: '[^']+'/, `databaseURL: '${DBURL}'`) }); });
    await ctx.route(ORIGIN + '/play/js/shared.js', async r => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace('EVENT_LEN = 2 * 864e5', 'EVENT_LEN = 7 * 864e5') }); });
    await ctx.addInitScript(() => { try { localStorage.setItem('mle_tut', '1'); localStorage.setItem('mle_bgm', 'off'); localStorage.setItem('mle_font', 'cute'); } catch {} });
    const p = await ctx.newPage(); p.errs = [];
    p.on('pageerror', e => p.errs.push(e.message));
    await p.goto(ORIGIN + '/play/');
    return p;
  };
  const intro = async p => { await p.waitForSelector('#introStart:not([hidden])', { timeout: 180000 }); await p.click('#introStart', { force: true }); };
  const api = (p, path, body, tok) => p.evaluate(([path, body, tok]) => window.MLEBackend.api(path, body, tok || localStorage.getItem('mle_token')), [path, body, tok || null]);
  const join = async (p, id, school, nick) => {
    await intro(p); await p.waitForSelector('#auth:not([hidden])');
    await p.click('[data-tab=signup]'); await p.fill('#suId', id); await p.fill('#suPw', '1234'); await p.fill('#suPw2', '1234'); await p.selectOption('#suBirth', '2015');
    await p.click('#signupForm button.primary');
    await p.waitForSelector('#setup:not([hidden])', { timeout: 180000 });
    await p.fill('#stSearch', school); await p.waitForTimeout(500); await p.click('#stList .school-item >> nth=0'); await p.fill('#stNick', nick); await p.click('#setupForm button.primary.big');
    await p.waitForSelector('#game:not([hidden])', { timeout: 150000 }); await p.waitForTimeout(2000);
  };
  const tag = Date.now().toString(36).slice(-4);
  const P = await mk();
  await join(P, 'pm' + tag, '호평초', '수학왕민준');
  await api(P, '/api/debug/unlock', { password: 'kim1234school' });
  const main = plan[0], cut = 170;
  const cb = fs.readFileSync(SP + 'promo/centers.bin'), NC = cb.length / 8, cx = new Float32Array(cb.buffer, cb.byteOffset, NC), cy = new Float32Array(cb.buffer, cb.byteOffset + 4 * NC, NC);
  const hx = cx[main.id] + 45, hy = cy[main.id] + 55; // 학교 표시 오른쪽 아래에 회색 구멍 (영상에서 노랗게 바뀌는 땅)
  const extra = main.cells.map(c => [c, Math.hypot(cx[c] - hx, cy[c] - hy)]).sort((x, y) => x[1] - y[1]).slice(0, 9).map(x => x[0]), holes = new Set(extra);
  // 🗺️ 다른 학교들 땅: 영상용으로 저장소에 한꺼번에 적는다 (한 칸씩 저장하면 너무 오래 걸려서)
  const up = {};
  for (const pl of plan) for (const c of pl.cells) if (!holes.has(c)) up[c] = [pl.id, 0];
  const wr = await fetch('http://127.0.0.1:9000/we019793d0454/g5/c.json?ns=math-land-eater-default-rtdb', { method: 'PATCH', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(up) });
  log('bulk cells', Object.keys(up).length, wr.status);
  await P.waitForTimeout(4000);
  const res = await P.evaluate(async ([id, tag]) => { // 서울 학교 친구 하나 (남산서울타워를 차지할 친구)
    const A = window.MLEBackend.api, s = await A('/api/signup', { username: `p${tag}s`, password: '1234', birthYear: 2015 });
    await A('/api/profile', { schoolId: id, nickname: '서울짱', semester: 1 }, s.token);
    await A('/api/debug/unlock', { password: 'kim1234school' }, s.token);
    return { tokens: [[id, s.token]] };
  }, [plan[20].id, tag]);
  // 👑 랜드마크: 서울 학교가 남산서울타워, 우리 학교가 경복궁
  const w = await api(P, '/api/world');
  const lmBy = id => w.landmarks.find(x => x[1] === id)[0];
  const seoulTok = res.tokens[0][1];
  log('lm tower', (await api(P, '/api/capture', { cell: lmBy('tower'), cheat: true }, seoulTok)).ok, 'palace', (await api(P, '/api/capture', { cell: lmBy('palace'), cheat: true })).ok, 'dokdo', (await api(P, '/api/capture', { cell: lmBy('dokdo'), cheat: true })).ok);
  await P.waitForTimeout(6000); // 랜드마크 저장이 끝나게
  // 🧑‍🎨 내 모습 · 기록 (영상용으로 보기 좋게): 캐릭터, 코인, 시즌 패스 22단계, 랭크 점수, 모험 진행
  await api(P, '/api/debug/coins', { on: true });
  await api(P, '/api/looks/buy', { kind: 'av', id: '🐯' });
  await api(P, '/api/debug/coins', { on: false });
  const edit = async (p, user, fn) => { await p.waitForTimeout(1200); await p.evaluate(([user, fn]) => { const L = JSON.parse(localStorage.getItem('mle_local')); const u = L.users['u_' + user]; new Function('u', fn)(u); localStorage.setItem('mle_local', JSON.stringify(L)); }, [user, fn]); await p.reload(); await intro(p).catch(() => {}); await p.waitForSelector('#game:not([hidden])', { timeout: 150000 }); await p.waitForTimeout(2500); };
  await edit(P, 'pm' + tag, `u.coins = 1280; u.infCoins = false; u.season = { n: 1, xp: 2700, claimed: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18], st: { solved: 420, captures: 160, rankWins: 9, stages: 9, landmarks: 2, trades: 1 }, sm: ['lm', 'tr'] }; u.rank = { s: 1, rp: 1465, w: 41, l: 13, streak: 4, best: 1465, done: [] }; u.adv = { '0-0': 3, '0-1': 3, '0-2': 2, '0-3': 3, '1-0': 3, '1-1': 3, '1-2': 3, '1-3': 2, '2-0': 3, '2-1': 2 };`);
  const shot = async (p, name) => { await p.waitForTimeout(400); await p.screenshot({ path: OUT + name + '.png' }); log('shot', name); };
  const closeAll = p => p.evaluate(() => document.querySelectorAll('.modal:not([hidden])').forEach(m => { m.hidden = true; }));
  // 1) 우리 학교 둘레 (확대) → 땅 몇 칸을 더 차지한 뒤 같은 자리
  await P.click('#zHome'); await P.waitForTimeout(1500); await P.click('#zIn'); await P.waitForTimeout(1500);
  await shot(P, 'map_zoom');
  for (const c of extra) await api(P, '/api/capture', { cell: c, cheat: true });
  await P.waitForTimeout(1500); await shot(P, 'map_zoom_after');
  await P.click('#zOut'); await P.waitForTimeout(1200); await shot(P, 'map_mid');
  await P.click('#zOut'); await P.waitForTimeout(1200); await shot(P, 'map_far');
  await P.click('#zFit'); await P.waitForTimeout(2000); await shot(P, 'map_full');
  // 2) 다른 학교 땅을 눌러 땅 뺏기 → 문제 화면
  await P.click('#zHome'); await P.waitForTimeout(1500);
  const pt = await P.evaluate(() => { // 우리 땅(노랑)도 빈 땅(회색)도 아닌 색깔 칸을 찾는다
    const c = document.querySelector('#map'), x = c.getContext('2d'), W = c.width, H = c.height, d = x.getImageData(0, 0, W, H).data, r = c.getBoundingClientRect();
    for (let rad = 40; rad < Math.min(W, H) / 2; rad += 12) for (let a = 0; a < 6.28; a += 0.2) {
      const px = Math.round(W / 2 + rad * Math.cos(a)), py = Math.round(H * 0.45 + rad * Math.sin(a)); if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const k = (py * W + px) * 4, R = d[k], G = d[k + 1], B = d[k + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      if (mx - mn > 70 && !(R > 220 && G > 160 && B < 90)) return [r.left + px * r.width / W, r.top + py * r.height / H];
    }
    return null;
  });
  if (pt) { await P.mouse.click(pt[0], pt[1]); await P.waitForTimeout(900); await shot(P, 'popup'); await P.click('#btnAtk').catch(() => {}); await P.waitForTimeout(1200); await shot(P, 'quiz'); await closeAll(P); await P.click('#popClose').catch(() => {}); }
  // 3) 랭크 배틀: 친구 Q 와 짝 → VS → 대결 → 승리
  const Q = await mk();
  await join(Q, 'pq' + tag, '판곡초', '번개손지우');
  await edit(Q, 'pq' + tag, `u.rank = { s: 1, rp: 1530, w: 50, l: 20, streak: 2, best: 1530, done: [] }; u.looks = { av: '🦊', own: ['av:🦊'] };`);
  await P.click('#btnHub'); await P.waitForTimeout(900); await shot(P, 'hub');
  await P.click('[data-hub="rank"]'); await P.waitForTimeout(1200); await shot(P, 'rank');
  await P.click('#rkGo'); await P.waitForTimeout(1500); await shot(P, 'rank_search');
  await Q.click('#btnHub'); await Q.waitForTimeout(600); await Q.click('[data-hub="rank"]'); await Q.waitForTimeout(800); await Q.click('#rkGo');
  await P.waitForSelector('#rkResultModal:not([hidden]) .vs-wrap', { timeout: 30000 }); await P.waitForTimeout(700); await shot(P, 'rank_vs');
  await P.waitForSelector('#quizModal:not([hidden])', { timeout: 10000 });
  await api(Q, '/api/rank/progress', { n: 4 }); await api(P, '/api/rank/progress', { n: 5 });
  await P.waitForTimeout(1800); await shot(P, 'rank_quiz');
  await api(P, '/api/rank/progress', { n: 7 });
  await P.waitForSelector('#rkResultModal:not([hidden]) .rr-title', { timeout: 15000 }); await P.waitForTimeout(1600); await shot(P, 'rank_win');
  await closeAll(P);
  // 4) 시즌 패스 · 대항전 · 모험 · 보스 · 랭킹표
  await P.click('#btnHub'); await P.waitForTimeout(600); await P.click('[data-hub="season"]'); await P.waitForTimeout(1200); await shot(P, 'season'); await closeAll(P);
  await P.click('#btnHub'); await P.waitForTimeout(600); await P.click('[data-hub="event"]'); await P.waitForTimeout(1500); await shot(P, 'event');
  await P.click(`#evMarks [data-lm="${lmBy('tower')}"]`); await P.waitForTimeout(2600); await shot(P, 'landmark'); await P.click('#popClose').catch(() => {});
  await P.click('#btnHub'); await P.waitForTimeout(600); await P.click('[data-hub="adv"]'); await P.waitForTimeout(1200); await shot(P, 'adv');
  await P.click('[data-adv="2-2"]', { force: true }); await P.waitForTimeout(1200); await shot(P, 'adv_quiz'); await P.click('#qzClose');
  await P.click('#btnHub'); await P.waitForTimeout(600); await P.click('[data-hub="adv"]'); await P.waitForTimeout(800); await P.click('[data-adv="1-3"]', { force: true }); await P.waitForTimeout(1200); await shot(P, 'boss'); await P.click('#qzClose');
  await P.click('#btnMore'); await P.click('#btnRank'); await P.waitForTimeout(1500); await shot(P, 'ranking'); await closeAll(P);
  await P.click('#btnHub'); await P.waitForTimeout(600); await P.click('[data-hub="eco"]'); await P.waitForTimeout(1000); await shot(P, 'eco'); await closeAll(P);
  log('errs', P.errs.slice(0, 5), Q.errs.slice(0, 5));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
