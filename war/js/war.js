// 전쟁 화면 (위: 적국, 아래: 아군, 오른쪽: 전투 기록) + 결과 화면 (승리 / 패배)
(function () {
  const $ = UI.$, fmt = UI.fmt, J = UI.J;
  const WAR = (window.WAR = {});
  const UN = GAME.UNITS;
  const HELM = '#5f7a3a';
  const FR = [0.25, 0.5, 0.75, 1];
  let st = null, bg = null;
  const rgb = (c, k = 1, a = 1) => `rgba(${c.map((v) => Math.min(255, Math.round(v * k))).join(',')},${a})`;
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const fit = (c) => {
    const w = c.clientWidth, h = c.clientHeight, d = dpr();
    if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); bg = null; }
    const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
    return [g, w, h];
  };
  const sentOf = (f) => { const s = {}; Object.keys(UN).forEach((k) => (s[k] = Math.round(st.prep.units[k] * f))); return s; };
  const unitTxt = (u) => Object.keys(UN).filter((k) => u[k] > 0).map((k) => `${UN[k].name} ${fmt(u[k])}${k === 'inf' ? '명' : '대'}`).join(', ') || '없음';

  // ───────── 열기 ─────────
  WAR.open = (id) => {
    const prep = GAME.warPrep(id);
    const f = FR.find((x) => GAME.chance(prep.P0 * x, prep.D) >= 0.8) || 1;
    st = { id, prep, f, phase: 'prep', t: 0, T: GAME.settings.fast ? 3.2 : 6.5, seed: (id * 31 + Date.now()) % 100000, tracers: [], booms: [], craters: [], logAt: 0 };
    build(null);
    UI.fade(() => { UI.show('scr-war'); SFX.song('war'); sidePrep(); });
  };
  GAME.onWar = WAR.open;

  // 졸라맨 배치 (u,v 는 화면 비율 좌표)
  function build(res) {
    const r = SK.rng(st.seed);
    const P = st.prep.P0 * st.f, D = st.prep.D;
    const nO = Math.max(5, Math.min(24, Math.round(Math.sqrt(P) * 1.4)));
    const nE = Math.max(5, Math.min(24, Math.round(Math.sqrt(D) * 1.4)));
    const T = st.T;
    const mk = (side, n, lossFrac) => {
      const arr = [], dead = Math.round(n * lossFrac), per = Math.min(10, Math.ceil(n / 2));
      for (let i = 0; i < n; i++) {
        const row = Math.floor(i / per), col = i % per, cnt = Math.min(per, n - row * per);
        arr.push({
          side, u: 0.5 + (col - (cnt - 1) / 2) * (0.8 / per) + (r() - 0.5) * 0.03 + (row % 2) * 0.02,
          v: side > 0 ? 0.21 + row * 0.055 + (r() - 0.5) * 0.015 : 0.78 + row * 0.07 + (r() - 0.5) * 0.015,
          hk: side > 0 ? 0.07 + row * 0.006 : 0.095 + row * 0.01,
          die: res && i < dead ? T * (0.26 + r() * 0.5) : 1e9, seed: i * 17 + (side > 0 ? 900 : 0), off: r() * 6,
        });
      }
      return arr;
    };
    const s = res ? res.sent : sentOf(st.f);
    st.sol = [...mk(1, nE, res ? (res.win ? 0.75 : 0.35) : 0), ...mk(-1, nO, res ? res.loss : 0)];
    st.nE = nE; st.nO = nO;
    st.veh = [];
    const nt = s.tank ? Math.min(3, Math.ceil(s.tank / 5)) : 0, na = s.art ? Math.min(2, Math.ceil(s.art / 4)) : 0;
    for (let i = 0; i < nt; i++) st.veh.push({ k: 'tank', side: -1, u: 0.2 + i * 0.3, v: 0.9, s: 0.06 });
    for (let i = 0; i < na; i++) st.veh.push({ k: 'art', side: -1, u: 0.12 + i * 0.72, v: 0.97, s: 0.05 });
    const et = D > 150 ? Math.min(3, Math.floor(D / 150)) : 0;
    for (let i = 0; i < et; i++) st.veh.push({ k: 'tank', side: 1, u: 0.25 + i * 0.25, v: 0.33, s: 0.04 });
    st.jet = s.jet > 0;
    st.booms = [];
    if (res) {
      const nb = (s.art ? 4 : 0) + (st.jet ? 3 : 0) + 2;
      for (let i = 0; i < nb; i++) st.booms.push({ t: T * (0.28 + r() * 0.45), u: 0.15 + r() * 0.7, v: i % 4 === 3 ? 0.8 + r() * 0.1 : 0.2 + r() * 0.14, seed: i + 5, done: false });
    }
  }

  // ───────── 오른쪽 창 ─────────
  function sidePrep() {
    const p = st.prep, P = Math.round(p.P0 * st.f), ch = GAME.chance(P, p.D);
    $('warSide').innerHTML = `
      <h2 class="wob">${p.enemy} · ${p.city}</h2>
      <p class="war-sub">${p.capital ? '이 나라의 <b>수도</b>입니다! 함락하면 다른 도시들이 약해져요.' : '전쟁을 준비하세요.'}</p>
      <div class="war-box"><span>${SK.img('fort', 26)} 적 방어력</span><b>${fmt(p.D)}</b></div>
      <div class="war-box"><span>${SK.img('power', 26)} 투입 전투력</span><b>${fmt(P)}</b></div>
      <div class="force">투입 병력: ${FR.map((x) => `<button class="btn small ${x === st.f ? 'sel' : ''}" data-f="${x}">${x * 100}%</button>`).join('')}</div>
      <p class="war-units">출전: ${unitTxt(sentOf(st.f))}</p>
      <div class="chance"><i style="width:${(ch * 100).toFixed(0)}%"></i><span>예상 승률 ${(ch * 100).toFixed(0)}%</span></div>
      <p class="war-tip">지더라도 적 방어력이 깎여서 다음 공격이 쉬워져요.</p>
      <div class="war-acts"><button class="btn dark" id="warBack"><span class="wob">후퇴</span></button><button class="btn red big" id="warGo"><span class="wob">공격 개시!</span></button></div>`;
    $('warSide').querySelectorAll('.wob').forEach((e) => SK.wob(e));
    $('warSide').querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => { SFX.play('click'); st.f = +b.dataset.f; build(null); sidePrep(); }));
    $('warBack').onclick = () => { SFX.play('click'); st = null; UI.fade(backToMap); };
    $('warGo').onclick = attack;
  }

  function attack() {
    SFX.play('drum');
    const res = (st.res = GAME.fight(st.id, st.f));
    st.phase = 'fight'; st.t = 0; st.tracers = []; st.craters = [];
    build(res);
    $('warSide').innerHTML = '<h2 class="wob">전투 기록</h2><ul id="warLog"></ul><div id="warDone" class="war-acts"></div>';
    SK.wob($('warSide').querySelector('.wob'));
    // 기록할 내용
    const T = st.T, s = res.sent, en = res.enemy, c = res.city, L = [];
    L.push([0.02, `공격 개시! 아군 ${unitTxt(s)}이 ${UI.RO(c)} 진격합니다.`]);
    L.push([0.14, `${en}군이 진지에서 맞섭니다. (방어력 ${fmt(res.D)})`]);
    L.push([0.24, '탕! 탕! 총격전이 시작되었습니다!']);
    if (s.art) L.push([0.32, '아군 대포가 적 진지를 포격합니다. 쾅!']);
    if (s.jet) L.push([0.38, '아군 전투기가 하늘을 가르며 폭탄을 떨어뜨립니다!']);
    if (s.tank) L.push([0.44, '아군 탱크가 적의 방어선을 밀어붙입니다.']);
    L.push([0.52, res.win ? '적의 방어선이 흔들리기 시작합니다!' : `${en}군의 반격이 거셉니다!`, res.win ? 'good' : 'bad']);
    if (res.lost.inf) L.push([0.6, `아군 보병 ${fmt(res.lost.inf)}명이 쓰러졌습니다...`, 'bad']);
    L.push([0.7, res.win ? `${en}군이 후퇴하기 시작합니다!` : '아군이 더 버티지 못합니다...', res.win ? 'good' : 'bad']);
    L.push([0.84, res.win ? `${J(c, '을', '를')} 점령했습니다! 태극기를 꽂았습니다.` : '후퇴! 작전은 실패했습니다.', res.win ? 'good' : 'bad']);
    st.log = L.map(([at, text, cls]) => ({ at: at * T, text, cls: cls || '', shown: false }));
  }

  function finish() {
    if (st.phase === 'done') return;
    st.phase = 'done';
    st.log.forEach((e) => !e.shown && showLog(e));
    $('warDone').innerHTML = '<button class="btn big" id="warResult"><span class="wob">결과 보기 →</span></button>';
    SK.wob($('warResult').firstChild);
    $('warResult').onclick = () => { SFX.play('click'); UI.fade(showResult); };
  }
  function showLog(e) {
    e.shown = true;
    const li = document.createElement('li');
    li.className = e.cls;
    li.innerHTML = `<b class="tm">${(e.at).toFixed(1)}초</b>${e.text}`;
    $('warLog').appendChild(li);
    $('warLog').scrollTop = 1e6;
  }

  // ───────── 전투 그리기 ─────────
  function drawBg(W, H) {
    bg = document.createElement('canvas');
    const d = dpr(); bg.width = W * d; bg.height = H * d;
    const g = bg.getContext('2d'); g.scale(d, d);
    const old = SK.wobble; SK.wobble = false;
    ART.wash(g, W, H, '#b9c487', '#a9b56f', 7);
    const r = SK.rng(3);
    // 적 도시
    g.fillStyle = rgb(st.prep.rgb, 1, 0.55); g.fillRect(0, 0, W, H * 0.13);
    for (let x = 8; x < W; x += 34 + r() * 20) SK.building(g, x, H * 0.12, 16 + r() * 10, { fill: rgb(st.prep.rgb, 1.05), seed: x });
    SK.line(g, 0, H * 0.13, W, H * 0.13, { w: 2.4, seed: 1 });
    // 풀
    g.strokeStyle = 'rgba(60,90,30,.45)'; g.lineWidth = 1.3; g.beginPath();
    for (let i = 0; i < 160; i++) { const x = r() * W, y = H * 0.15 + r() * H * 0.85; g.moveTo(x - 3, y - 4); g.lineTo(x, y); g.lineTo(x + 3, y - 5); }
    g.stroke();
    // 나무
    for (let i = 0; i < 6; i++) {
      const x = i < 3 ? 15 + r() * 40 : W - 15 - r() * 40, y = H * (0.3 + r() * 0.5), s = 14 + r() * 8;
      SK.line(g, x, y, x, y - s, { w: 2.5, color: '#6a4a2a', seed: i });
      SK.ellipse(g, x, y - s - s * 0.5, s * 0.7, s * 0.6, { fill: '#7da55a', w: 1.8, seed: 20 + i });
    }
    // 모래주머니 참호
    const bags = (v, n) => { for (let i = 0; i < n; i++) SK.ellipse(g, W * (0.08 + (i * 0.84) / (n - 1)), H * v + (i % 2) * 3, W * 0.024, H * 0.014, { fill: '#c9b48a', w: 1.4, seed: i * 3 + v * 100, passes: 1 }); };
    bags(0.37, 18); bags(0.7, 18);
    // 가운데 전선
    g.setLineDash([10, 8]); g.strokeStyle = 'rgba(120,40,30,.45)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, H * 0.535); g.lineTo(W, H * 0.535); g.stroke(); g.setLineDash([]);
    SK.wobble = old;
  }

  function banner(g, x, y, w, isEnemy, hp, label, value) {
    SK.rect(g, x, y, w, 52, { fill: 'rgba(251,245,230,.92)', w: 2, j: 1, passes: 1, seed: isEnemy ? 5 : 6 });
    if (isEnemy) SK.flag(g, x + 18, y + 44, 30, { color: rgb(st.prep.rgb, 0.85), seed: 7 });
    else SK.flag(g, x + 18, y + 44, 30, { korea: true, seed: 8 });
    SK.text(g, label, x + 52, y + 15, { size: 17, align: 'left', seed: 3 });
    SK.text(g, value, x + w - 10, y + 15, { size: 16, align: 'right', color: '#5a4a3a', seed: 4 });
    const bw = w - 62;
    SK.rect(g, x + 52, y + 29, bw, 14, { fill: '#f6e2d6', w: 1.6, j: 0.6, passes: 1, seed: 9 });
    g.fillStyle = isEnemy ? '#d0453a' : '#6fb64f';
    g.fillRect(x + 54, y + 31, Math.max(0, (bw - 4) * hp), 10);
  }

  WAR.frame = (dt) => {
    if (!st) return;
    const [g, W, H] = fit($('warCv'));
    if (!bg) drawBg(W, H);
    g.drawImage(bg, 0, 0, W, H);
    const T = st.T, fighting = st.phase !== 'prep';
    if (fighting) st.t += dt;
    const t = st.t, res = st.res;
    const adv = fighting ? Math.min(1, t / (T * 0.2)) : 0, ease = 1 - (1 - adv) ** 2;
    const endP = fighting ? Math.max(0, (t - T * 0.78) / (T * 0.22)) : 0;
    const inFight = fighting && adv >= 1 && endP === 0;
    // 구덩이
    st.craters.forEach((c) => SK.ellipse(g, c.u * W, c.v * H, 16, 7, { fill: 'rgba(70,55,40,.55)', w: 1.2, passes: 1, seed: c.seed }));
    // 차량
    st.veh.forEach((v, i) => {
      const y = (v.v + (v.side > 0 ? 0.06 : -0.06) * ease) * H, s = v.s * H;
      if (v.k === 'tank') SK.tank(g, v.u * W, y, s, { dir: i % 2 ? -1 : 1, color: v.side > 0 ? rgb(st.prep.rgb, 0.7) : '#7d8a52', seed: 300 + i });
      else SK.cannon(g, v.u * W, y, s, { dir: 1, seed: 310 + i });
    });
    // 졸라맨
    const winSide = res ? (res.win ? -1 : 1) : 0;
    const pos = (s) => {
      let v = s.v + (s.side > 0 ? 0.07 : -0.07) * ease;
      if (endP > 0 && t < s.die && s.side !== winSide) v += (s.side > 0 ? -1 : 1) * endP * 0.6;
      return [s.u * W, v * H, s.hk * H];
    };
    const list = st.sol.map((s) => [s, ...pos(s)]).sort((a, b) => a[2] - b[2]);
    let deadE = 0, deadO = 0;
    for (const [s, x, y, h] of list) {
      const alive = t < s.die;
      if (!alive) s.side > 0 ? deadE++ : deadO++;
      const fall = alive ? 0 : Math.min(1, (t - s.die) * 4);
      let pose = fighting && adv < 1 ? 'walk' : 'stand';
      if (endP > 0 && alive) pose = s.side === winSide ? 'cheer' : 'run';
      SK.stick(g, x, y, h, {
        pose: fall ? 'stand' : pose, dir: s.u < 0.5 ? 1 : -1, t: t * 9 + s.off, fall, gun: pose === 'stand' || pose === 'walk',
        helmet: s.side > 0 ? rgb(st.prep.rgb, 0.7) : HELM, color: s.side > 0 ? '#3a1e1a' : '#2a2420', seed: s.seed, eyes: s.side > 0,
      });
    }
    // 총알
    if (inFight) {
      const alive = list.filter(([s]) => t < s.die);
      for (let k = 0; k < 2; k++) {
        const a = alive[Math.floor(Math.random() * alive.length)], b = alive.filter(([s]) => s.side !== (a && a[0].side));
        if (!a || !b.length) break;
        const tg = b[Math.floor(Math.random() * b.length)];
        st.tracers.push({ x1: a[1], y1: a[2] - a[3] * 0.6, x2: tg[1] + (Math.random() - 0.5) * 20, y2: tg[2] - tg[3] * 0.5, t0: t });
      }
      if (Math.random() < 0.25) SFX.play('shot');
    }
    st.tracers = st.tracers.filter((tr) => t - tr.t0 < 0.22);
    g.strokeStyle = 'rgba(255,205,60,.95)'; g.lineWidth = 2; g.lineCap = 'round'; g.beginPath();
    for (const tr of st.tracers) {
      const p = (t - tr.t0) / 0.22, q = Math.max(0, p - 0.25);
      g.moveTo(tr.x1 + (tr.x2 - tr.x1) * q, tr.y1 + (tr.y2 - tr.y1) * q); g.lineTo(tr.x1 + (tr.x2 - tr.x1) * p, tr.y1 + (tr.y2 - tr.y1) * p);
    }
    g.stroke();
    // 전투기
    if (st.jet && fighting && t > T * 0.25 && t < T * 0.7) {
      const p = (t - T * 0.25) / (T * 0.45);
      SK.jet(g, -60 + p * (W + 120), H * 0.47, H * 0.05, { seed: 320 });
    }
    // 폭발
    st.booms.forEach((b) => {
      const p = (t - b.t) / 0.6;
      if (p < 0 || p > 1) return;
      if (!b.done) { b.done = true; SFX.play('boom'); st.craters.push({ u: b.u, v: b.v, seed: b.seed }); }
      SK.boom(g, b.u * W, b.v * H, 16 + p * 32, p, b.seed);
    });
    if (endP > 0 && res.win) SK.flag(g, W / 2, H * 0.5, H * 0.1 * Math.min(1, endP * 2), { korea: true, t, seed: 9 });
    // 위: 적국, 아래: 아군
    const bw = Math.min(330, W - 24);
    const hpE = 1 - deadE / st.nE, hpO = 1 - deadO / st.nO;
    banner(g, 12, Math.max(4, H * 0.065 - 26), bw, true, hpE, `적군: ${st.prep.enemy}`, `방어력 ${fmt(st.prep.D * hpE)}`);
    banner(g, 12, H - 64, bw, false, hpO, '아군: 대한민국', `전투력 ${fmt(st.prep.P0 * st.f * hpO)}`);
    if (st.phase === 'prep') SK.text(g, '공격 준비 중...', W / 2, H * 0.535, { size: 26, color: 'rgba(120,40,30,.8)', stroke: '#fbf5e6', strokeW: 5 });
    if (endP > 0.3) {
      g.globalAlpha = Math.min(1, (endP - 0.3) * 3);
      SK.text(g, res.win ? '승리!' : '패배...', W / 2, H * 0.535, { size: 64, color: res.win ? '#c8303a' : '#3a4a6a', stroke: '#fffdf5', strokeW: 8, seed: 3 });
      g.globalAlpha = 1;
    }
    ART.paperFrame(g, W, H);
    // 기록
    if (fighting && st.log) st.log.forEach((e) => { if (!e.shown && t >= e.at) showLog(e); });
    if (fighting && t >= T) finish();
  };
  // 화면을 누르면 빨리 감기
  $('warCv').addEventListener('click', () => { if (st && st.phase === 'fight') st.t = Math.max(st.t, st.T); });

  // ───────── 결과 화면 ─────────
  function showResult() {
    const r = st.res, win = r.win;
    UI.show('scr-result');
    SFX.stopSong();
    SFX.play(win ? 'win' : 'lose');
    $('scr-result').classList.toggle('lose', !win);
    const stamp = $('resStamp');
    SK.wob(stamp, win ? '승리!' : '패배...');
    stamp.className = 'res-stamp ' + (win ? 'win' : 'lose');
    void stamp.offsetWidth; stamp.classList.add('go');
    // 위: 다른 나라
    $('resEnemyName').innerHTML = `${SK.img('swords', 26)} ${r.enemy}군 · ${r.city}`;
    $('resEnemyText').innerHTML = win
      ? `방어력 ${fmt(r.D)} → <b>0</b> (괴멸)<br>${r.city} 수비대가 무너졌습니다.${r.capital ? '<br>수도가 함락되었습니다!' : ''}`
      : `방어력 ${fmt(r.D)} → <b>${fmt(r.Dafter)}</b><br>${r.enemy}군이 도시를 지켜냈습니다.`;
    // 아래: 아군
    $('resOurText').innerHTML = `투입 전투력 <b>${fmt(r.P)}</b> (예상 승률 ${(r.ch * 100).toFixed(0)}%)<br>` +
      Object.keys(UN).filter((k) => r.sent[k] > 0).map((k) => `${UN[k].name} ${fmt(r.sent[k])} → ${fmt(r.sent[k] - r.lost[k])}${r.lost[k] ? ` <span class="neg">(-${fmt(r.lost[k])})</span>` : ''}`).join('<br>') +
      `<br>남은 총 전투력 <b>${fmt(r.power)}</b>`;
    // 오른쪽: 어떻게 됐는지
    const it = [];
    if (win) {
      it.push(['good', `<b>${J(r.city, '을', '를')}</b> 점령했습니다!`]);
      if (r.capital) it.push(['good', `${r.enemy}의 수도가 함락되어 남은 도시들의 사기가 크게 떨어졌습니다.`]);
      if (r.allMine) it.push(['good', `<b>${r.enemy}</b> 전체를 정복했습니다!`]);
      it.push(['good', `지지율 +${r.gain}% (지금 ${Math.ceil(r.approval)}%)`]);
      if (r.newTargets) it.push(['', `새로 공격할 수 있는 도시 ${r.newTargets}곳이 생겼습니다.`]);
    } else {
      it.push(['bad', `<b>${r.city}</b> 공격에 실패했습니다.`]);
      it.push(['bad', `지지율 -5% (지금 ${Math.max(0, Math.ceil(r.approval))}%)`]);
      it.push(['', `적 방어력이 ${fmt(r.D)}에서 ${fmt(r.Dafter)}까지 줄었습니다.`]);
      it.push(['', r.ch < 0.5 ? `예상 승률이 ${(r.ch * 100).toFixed(0)}%로 낮았어요. 군대를 더 키워서 다시 도전하세요.` : '아쉽게 운이 따르지 않았어요. 바로 다시 도전해 보세요!']);
      if (r.approval < 20) it.push(['bad', '지지율이 위험합니다! 탄핵되지 않게 정책을 쓰세요.']);
    }
    it.push([win ? '' : 'bad', `잃은 병력: ${unitTxt(r.lost)}`]);
    it.push(['', `세계 통일 ${((r.owned / r.total) * 100).toFixed(1)}% (${r.owned} / ${r.total} 도시)`]);
    $('resList').innerHTML = it.map(([c, t]) => `<li class="${c}">${t}</li>`).join('');
    st.rt = 0;
  }
  WAR.resultFrame = (dt) => {
    if (!st || !st.res) return;
    st.rt += dt;
    const t = st.rt, win = st.res.win;
    // 위: 적군
    {
      const [g, W, H] = fit($('resEnemyArt'));
      ART.wash(g, W, H, rgb(st.prep.rgb, 0.95), '#efe5cf', 13);
      ART.ground(g, W, H, H * 0.72, win ? '#b8b090' : '#b9c98a', 4);
      for (let x = 10; x < W * 0.4; x += 30) SK.building(g, x, H * 0.72, 14 + ((x * 7) % 9), { fill: rgb(st.prep.rgb), seed: x });
      if (win) SK.flag(g, W * 0.22, H * 0.4, 30, { korea: true, t, seed: 3 });
      for (let i = 0; i < 6; i++) {
        const x = W * (0.45 + i * 0.09), y = H * (0.86 + (i % 2) * 0.05);
        if (win && i % 2 === 0) SK.stick(g, x, y, H * 0.26, { fall: 1, color: '#3a1e1a', helmet: rgb(st.prep.rgb, 0.7), seed: i, eyes: false });
        else if (win) {
          SK.stick(g, x, y, H * 0.3, { pose: 'cheer', t: 0, color: '#3a1e1a', helmet: rgb(st.prep.rgb, 0.7), seed: i });
          SK.flag(g, x + 8, y - H * 0.25, H * 0.13, { color: '#fffdf5', t: t + i, seed: 40 + i });
        } else {
          SK.stick(g, x, y, H * 0.3, { pose: 'cheer', t: t * 2 + i, color: '#3a1e1a', helmet: rgb(st.prep.rgb, 0.7), seed: i });
          if (i % 2) SK.flag(g, x + 10, y - H * 0.24, H * 0.13, { color: rgb(st.prep.rgb, 0.85), t: t + i, seed: 40 + i });
        }
      }
      ART.paperFrame(g, W, H);
    }
    // 아래: 아군
    {
      const [g, W, H] = fit($('resOurArt'));
      ART.wash(g, W, H, win ? '#bcdcf2' : '#9aa0aa', '#efe5cf', 17);
      ART.ground(g, W, H, H * 0.72, win ? '#a8cf7a' : '#8f9a7a', 6);
      for (let i = 0; i < 7; i++) {
        const x = W * (0.12 + i * 0.12), y = H * (0.86 + (i % 2) * 0.05);
        if (win) {
          SK.stick(g, x, y, H * 0.32, { pose: 'cheer', t: t * 2 + i, helmet: HELM, seed: 60 + i });
          if (i % 3 === 1) SK.flag(g, x + 10, y - H * 0.26, H * 0.14, { korea: true, t: t + i, seed: 70 + i });
        } else if (i % 3 === 0) SK.stick(g, x, y, H * 0.28, { fall: 1, helmet: HELM, seed: 60 + i, eyes: false });
        else SK.stick(g, x - ((t * 10) % 30), y, H * 0.32, { pose: 'sad', dir: -1, helmet: HELM, t: t * 3, seed: 60 + i });
      }
      ART.paperFrame(g, W, H);
    }
  };

  function backToMap() {
    UI.show('scr-game');
    GAME.resize();
    SFX.song('game');
    GAME.afterWar();
  }
  $('btnResultOk').onclick = () => { SFX.play('click'); st = null; UI.fade(backToMap); };
})();
