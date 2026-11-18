// 화면 흐름: 로딩 → 메인 → 세계 선택 → (어두워짐) 스토리 3장 → 게임 → 엔딩
(function () {
  const $ = UI.$;
  const SET_KEY = 'zollaWar.settings';
  const settings = (GAME.settings = { vol: 70, music: true, wobble: true, fast: false });
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SET_KEY)) || {}); } catch (e) { /* 기본값 */ }
  const saveSettings = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) { /* 무시 */ } };
  const applySettings = () => { SFX.vol = settings.vol / 100; SFX.setMusic(settings.music); SK.wobble = settings.wobble; };
  applySettings();

  let map = null, storySlot = -1, page = 0, ending = null, settingsBack = 'scr-menu';
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const fitCanvas = (c) => {
    const w = c.clientWidth, h = c.clientHeight, d = dpr();
    if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) { c.width = Math.round(w * d); c.height = Math.round(h * d); }
    const g = c.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
    return [g, w, h];
  };
  const click = (id, fn) => { $(id).onclick = (e) => { SFX.unlock(); SFX.play('click'); fn(e); }; };

  // ───────── 메인 화면 ─────────
  const toMenu = () => {
    map.recolor((id) => map.cities[id].country);
    UI.show('scr-menu');
    const c = $('menuMap');
    map.resize(c.clientWidth, c.clientHeight);
    map.view.s = map.minScale() * 1.12; map.view.cy = miller(18); map.clamp();
    SFX.song('menu');
  };
  click('btnPlay', () => { renderWorlds(); UI.show('scr-worlds'); });
  click('btnSettings', () => { settingsBack = 'scr-menu'; openSettings(); });
  click('btnExit', () => UI.confirm('게임 나가기', '정말 게임을 나가시겠어요?', '나가기', () => {
    SFX.stopSong();
    UI.fade(() => { UI.show('scr-bye'); try { window.close(); } catch (e) { /* 브라우저가 막음 */ } });
  }));
  click('btnBack', () => UI.fade(toMenu));

  // ───────── 세계 선택 ─────────
  function renderWorlds() {
    const saves = GAME.saves();
    $('worldList').innerHTML = saves.map((s, i) => s ? `
      <div class="world-card">
        <h3>${s.name} ${s.ended === 'happy' ? '<span class="badge">통일 완료</span>' : ''}</h3>
        <canvas data-thumb="${i}"></canvas>
        <div class="meta">세계 통일 ${(GAME.progress(s) * 100).toFixed(1)}% · 도시 ${GAME.ownedCount(s)}곳<br>플레이 ${Math.floor(s.played / 60)}분 · ${new Date(s.updated || s.created).toLocaleDateString('ko-KR')}</div>
        <div class="acts"><button class="btn small" data-go="${i}">계속하기</button><button class="btn small dark icon" data-del="${i}" title="삭제">${SK.img('trash', 28)}</button></div>
      </div>` : '<div class="world-card empty"><span class="wob">빈 자리</span></div>').join('');
    $('worldList').querySelectorAll('.wob').forEach((e) => SK.wob(e));
    $('worldList').querySelectorAll('[data-thumb]').forEach((c) => GAME.thumb(c, saves[+c.dataset.thumb]));
    $('worldList').querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { SFX.play('click'); continueWorld(+b.dataset.go); }));
    $('worldList').querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
      SFX.play('click');
      const s = saves[+b.dataset.del];
      UI.confirm('세계 삭제', `<b>${s.name}</b>을(를) 지울까요? 되돌릴 수 없어요.`, '삭제', () => { GAME.deleteSlot(+b.dataset.del); renderWorlds(); });
    }));
    const free = saves.findIndex((s) => !s);
    $('btnNewSession').disabled = free < 0;
    SK.wob($('btnNewSession').firstElementChild, free < 0 ? '세계는 3개까지만 만들 수 있어요' : '+ 새 세션');
  }
  click('btnWorldsBack', toMenu);
  click('btnNewSession', () => {
    const free = GAME.saves().findIndex((s) => !s);
    if (free < 0) return;
    GAME.newWorld(free);
    SFX.stopSong();
    UI.fade(() => openStory(free));
  });
  function continueWorld(i) {
    const s = GAME.saves()[i];
    if (!s) return;
    if (!s.storyDone) return UI.fade(() => openStory(i));
    UI.fade(() => GAME.enter(i));
  }

  // ───────── 스토리 ─────────
  function openStory(slot) {
    storySlot = slot; page = 0;
    UI.show('scr-story');
    showPage();
  }
  function showPage() {
    const st = STORY[page];
    SK.wob($('storyNum'), `${page + 1} / ${STORY.length}`);
    SK.wob($('storyTitle'), st.title);
    const p = $('storyText');
    p.innerHTML = '';
    [...st.text].forEach((ch, i) => {
      if (ch === ' ') { p.appendChild(document.createTextNode(' ')); return; }
      const s = document.createElement('span');
      s.className = 'ch'; s.textContent = ch;
      s.style.animationDelay = `${i * 22}ms`;
      s.style.transform = `rotate(${(Math.sin(i * 7.3) * 3).toFixed(1)}deg)`;
      p.appendChild(s);
    });
    $('btnSkip').classList.toggle('hidden', page !== 0);
    SK.wob($('btnNext').firstElementChild, page === STORY.length - 1 ? '게임 시작' : '다음 →');
    $('btnNext').classList.toggle('red', page === STORY.length - 1);
    SFX.song(page === 2 ? 'menu' : 'sad');
  }
  const startGame = () => {
    const a = GAME.saves();
    if (a[storySlot]) { a[storySlot].storyDone = true; try { localStorage.setItem('zollaWar.saves.v1', JSON.stringify(a)); } catch (e) { /* 무시 */ } }
    UI.fade(() => GAME.enter(storySlot));
  };
  click('btnSkip', startGame);
  click('btnNext', () => {
    if (page >= STORY.length - 1) return startGame();
    SFX.play('page');
    const el = document.querySelector('.story-page');
    el.classList.add('turn');
    setTimeout(() => { page++; showPage(); el.classList.remove('turn'); }, 450);
  });

  // ───────── 설정 ─────────
  function openSettings() {
    $('setVol').value = settings.vol;
    $('setMusic').checked = settings.music;
    $('setWobble').checked = settings.wobble;
    $('setFast').checked = settings.fast;
    UI.show('scr-settings');
  }
  $('setVol').oninput = (e) => { settings.vol = +e.target.value; applySettings(); saveSettings(); };
  $('setVol').onchange = () => SFX.play('coin');
  $('setMusic').onchange = (e) => { settings.music = e.target.checked; applySettings(); saveSettings(); };
  $('setWobble').onchange = (e) => { settings.wobble = e.target.checked; applySettings(); saveSettings(); };
  $('setFast').onchange = (e) => { settings.fast = e.target.checked; saveSettings(); };
  click('btnSettingsBack', () => {
    if (settingsBack === 'scr-game' && GAME.active()) { UI.show('scr-game'); GAME.resize(); } else toMenu();
  });
  click('btnWipe', () => UI.confirm('저장 데이터 지우기', '모든 세계가 사라집니다. 정말 지울까요?', '모두 지우기', () => { GAME.wipe(); UI.toast('저장 데이터를 모두 지웠어요.', '', 'trash'); }));

  // ───────── 게임 안 메뉴 ─────────
  click('btnPause', () => UI.modal(`<h2 class="wob">일시 정지</h2><p>게임은 자동으로 저장돼요.</p>
    <div class="acts" style="justify-content:center;flex-direction:column;align-items:center">
      <button class="btn big" data-a="resume"><span class="wob">계속하기</span></button>
      <button class="btn" data-a="settings"><span class="wob">설정</span></button>
      <button class="btn dark" data-a="quit"><span class="wob">저장하고 메인 화면으로</span></button>
    </div>`, (c) => {
    c.querySelector('[data-a=resume]').onclick = () => { SFX.play('click'); UI.close(); };
    c.querySelector('[data-a=settings]').onclick = () => { SFX.play('click'); UI.close(); settingsBack = 'scr-game'; openSettings(); };
    c.querySelector('[data-a=quit]').onclick = () => { SFX.play('click'); GAME.leave(); UI.fade(toMenu); };
  }));

  // ───────── 남북 통일 ─────────
  GAME.onUnify = () => {
    SFX.play('cheer');
    UI.modal(`<h2 class="wob">남북 통일!</h2><canvas class="battle" id="unifyCv"></canvas>
      <p>70년 넘게 갈라져 있던 한반도가 마침내 하나가 되었습니다! 남과 북의 졸라맨들이 얼싸안고 기뻐합니다.</p>
      <p><b>보상: 지지율 +20, ₩2,000</b></p>
      <div class="acts"><button class="btn big red" id="unifyOk"><span class="wob">우리의 소원은 통일!</span></button></div>`, (c) => {
      const cv = c.querySelector('#unifyCv'), t0 = performance.now();
      const draw = () => {
        if (!document.body.contains(cv) || UI.$('modal').classList.contains('hidden')) return;
        const [g, w, h] = fitCanvas(cv);
        ART.unify(g, w, h, (performance.now() - t0) / 1000);
        requestAnimationFrame(draw);
      };
      requestAnimationFrame(draw);
      c.querySelector('#unifyOk').onclick = () => { SFX.play('click'); UI.close(); };
    });
  };

  // ───────── 엔딩 ─────────
  GAME.onEnding = (kind, st) => {
    UI.close();
    SFX.stopSong();
    if (kind === 'happy') map.recolor(() => map.koreaIdx);
    UI.fade(() => {
      ending = { kind, t: 0 };
      UI.show('scr-ending');
      const sad = kind === 'sad';
      SK.wob($('endTitle'), sad ? '탄핵...' : '세계 통일!');
      $('endTitle').style.color = sad ? '#3a3a5a' : '#c8303a';
      $('endText').innerHTML = sad
        ? '국민의 마음을 잃은 대통령은 결국 국회에서 탄핵되었습니다. 군대는 흩어지고, 세계는 다시 끝없는 혼란 속으로 빠져들었습니다...<br><b>이 세계의 기록은 사라졌습니다. 처음부터 다시 시작해야 합니다.</b>'
        : '마침내 전 세계가 대한민국의 깃발 아래 하나가 되었습니다. 푸른 밤 이후 처음으로, 세상의 모든 총성이 멈췄습니다. 사람들은 거리로 나와 춤을 추며 평화를 노래했습니다.';
      const m = Math.floor(st.played / 60);
      $('endStats').textContent = `${st.name} · 도시 ${st.owned}/${st.total} · ${st.wins}승 ${st.losses}패 · 걷은 세금 ₩${UI.fmt(st.taxed)} · ${m}분 플레이`;
      SK.wob($('btnEnd').firstElementChild, sad ? '처음부터 다시' : '메인 화면으로');
      const card = document.querySelector('.end-card');
      card.classList.remove('show'); setTimeout(() => card.classList.add('show'), 50);
      SFX.play(sad ? 'lose' : 'cheer');
      setTimeout(() => SFX.song(sad ? 'sad' : 'happy'), 1500);
    });
  };
  click('btnEnd', () => { ending = null; GAME.leave(); UI.fade(toMenu); });

  // ───────── 메인 루프 ─────────
  let last = performance.now(), menuFrame = -1;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const t = now / 1000;
    SK.frame = SK.wobble ? Math.floor(t / 0.2) % 1000 : 0;
    switch (UI.screen) {
      case 'scr-loading': { const c = $('loadArt'); const g = c.getContext('2d'); ART.loading(g, 240, 140, t); break; }
      case 'scr-menu': {
        map.view.cx += dt * 3; map.clamp();
        const [g] = fitCanvas($('menuMap'));
        if (map.W !== $('menuMap').clientWidth || map.H !== $('menuMap').clientHeight) map.resize($('menuMap').clientWidth, $('menuMap').clientHeight);
        map.drawBase(g, dpr(), { compass: true });
        const [f, w, h] = fitCanvas($('menuFx'));
        ART.march(f, w, h, t);
        menuFrame = SK.frame;
        break;
      }
      case 'scr-story': { const [g, w, h] = fitCanvas($('storyArt')); ART.story[page](g, w, h, t); break; }
      case 'scr-game': GAME.tick(dt); GAME.draw(); break;
      case 'scr-war': WAR.frame(dt); break;
      case 'scr-result': WAR.resultFrame(dt); break;
      case 'scr-ending': if (ending) { ending.t += dt; const [g, w, h] = fitCanvas($('endArt')); (ending.kind === 'sad' ? ART.sad : ART.happy)(g, w, h, ending.t, map); } break;
      case 'scr-bye': { const [g, w, h] = fitCanvas($('byeArt')); ART.bye(g, w, h, t); break; }
    }
    requestAnimationFrame(loop);
  }

  window.addEventListener('resize', () => { if (UI.screen === 'scr-game') GAME.resize(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) GAME.save(); });
  window.addEventListener('beforeunload', () => GAME.save());

  // ───────── 시작 ─────────
  document.documentElement.style.setProperty('--paper', `url(${SK.paperURL()})`);
  document.querySelectorAll('.wob').forEach((e) => SK.wob(e));
  ['zoomIn', 'zoomOut', 'zoomHome'].forEach((id, i) => ($(id).innerHTML = SK.img(['plus', 'minus', 'home'][i], 34)));
  $('zoomHome').title = '대한민국으로';
  $('btnPause').innerHTML = `${SK.img('menu', 26)} <span class="wob">메뉴</span>`;
  SK.wob($('btnPause').querySelector('.wob'));
  UI.show('scr-loading');
  requestAnimationFrame(loop);
  const fonts = document.fonts ? Promise.race([
    Promise.all([document.fonts.load('700 20px Gaegu'), document.fonts.load('400 20px "Nanum Pen Script"')]),
    new Promise((r) => setTimeout(r, 3000)),
  ]).catch(() => {}) : Promise.resolve();
  fonts.then(() => setTimeout(() => {
    map = new WorldMap(window.WORLD_GEO, window.COUNTRY_TABLE);
    GAME.init(map);
    window.__map = map;
    document.querySelectorAll('.wob').forEach((e) => SK.wob(e, e.textContent));
    UI.fade(toMenu);
  }, 60));
  document.addEventListener('pointerdown', () => SFX.unlock(), { once: true });
})();
