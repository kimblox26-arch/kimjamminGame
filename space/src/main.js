// ORBITER — 진입점
// DOM 을 수집하고 Game 을 만든 뒤, 메뉴/버튼 이벤트를 연결한다.

import { Game } from './game/game.js';
import { bus, EVT } from './core/events.js';
import { audio } from './audio/audio.js';
import { buildPreset, PRESET_BUILDERS } from './build/presets.js';
import { Craft } from './build/craft.js';
import {
  saveBlueprint,
  loadBlueprint,
  deleteBlueprint,
  exportBlueprintFile,
  importBlueprintFile,
  listSaves,
  readSave,
  deleteSave,
  resetSettings,
  resetProgress,
  storageUsage,
} from './core/storage.js';
import { AP_MODE } from './flight/autopilot.js';
import { PART_COUNT } from './build/partdefs.js';
import { BODY_DEFS } from './world/bodies.js';

const LOADING_TIPS = [
  '궤도에 오르는 것은 높이 올라가는 게 아니라, 옆으로 아주 빨리 움직이는 것입니다.',
  '중력 선회: 고도 10 km 부터 조금씩 기울이면 연료가 크게 절약됩니다.',
  '진공 엔진은 대기권에서 추력이 반 토막 납니다. 1단에는 해면용을 쓰세요.',
  '이륙 추중비 1.4~1.8 이 가장 효율적입니다. 너무 높으면 공기와 싸우게 됩니다.',
  '핀은 무게중심보다 아래에 달아야 로켓이 곧게 섭니다.',
  '아레스의 대기는 0.6 %. 낙하산만으로는 절대 멈추지 못합니다.',
  '연료가 부족하면 근점에서 나눠서 분사하세요. 오베르트 효과가 도와줍니다.',
  '착륙할 때는 수평 속도를 먼저 죽이세요. 그 다음이 수직입니다.',
  '재진입 각도가 얕으면 튕겨 나가고, 가파르면 타버립니다.',
  '핵열 엔진은 액체연료만 씁니다. 탱크의 산화제를 비우면 Δv 가 크게 늘어납니다.',
  'M 키로 지도를 열고, 기동 노드를 드래그해 궤도를 설계하세요.',
  '타임워프는 대기권 밖에서만 고배속이 가능합니다.',
];

function $(id) {
  return document.getElementById(id);
}

function collectDom() {
  return {
    flightCanvas: $('flight-canvas'),
    hudCanvas: $('hud-canvas'),
    mapCanvas: $('map-canvas'),
    buildCanvas: $('build-canvas'),
    buildPalette: $('part-palette'),
    buildCategories: $('part-categories'),
    buildStats: $('build-stats'),
    buildName: $('build-name'),
    hangarList: $('hangar-list'),
    missionList: $('mission-list'),
    missionPanel: $('mission-panel'),
    bodyList: $('body-list'),
    flightLog: $('flight-log'),
    pauseMenu: $('pause-menu'),
    mapToolbar: $('map-toolbar'),
    resultsBody: $('results-body'),
    fpsCounter: $('fps-counter'),
    loadingBar: $('loading-bar'),
    loadingLabel: $('loading-label'),
    loadingTip: $('loading-tip'),
    saveList: $('save-list'),
  };
}

async function boot() {
  const dom = collectDom();

  // 로딩 화면 연출
  const tip = LOADING_TIPS[(Math.random() * LOADING_TIPS.length) | 0];
  if (dom.loadingTip) dom.loadingTip.textContent = tip;
  const steps = [
    ['항성계 생성', 18],
    ['지형 데이터 준비', 38],
    ['부품 카탈로그 적재', 58],
    ['물리 엔진 초기화', 78],
    ['렌더러 준비', 94],
    ['준비 완료', 100],
  ];
  for (const [label, pct] of steps) {
    if (dom.loadingLabel) dom.loadingLabel.textContent = label;
    if (dom.loadingBar) dom.loadingBar.style.width = `${pct}%`;
    await new Promise((r) => setTimeout(r, 90));
  }

  const game = new Game(dom);
  window.ORBITER = game; // 디버그용
  game.start();

  wireNavigation(game, dom);
  wireBuilder(game, dom);
  wireHangar(game, dom);
  wireMissions(game, dom);
  wireFlight(game, dom);
  wireSettings(game, dom);
  wireResults(game, dom);

  // 첫 사용자 입력에 오디오 활성화
  const unlockAudio = () => {
    audio.init();
    audio.resume();
    audio.setVolume('master', game.settings.audio.master);
    audio.setVolume('sfx', game.settings.audio.sfx);
    audio.setVolume('music', game.settings.audio.music);
    if (game.scene.name === 'menu') audio.startMusic('space');
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

  // 통계 표시
  const statEl = $('menu-stats');
  if (statEl) {
    statEl.textContent = `천체 ${BODY_DEFS.length}종 · 부품 ${PART_COUNT}종 · 저장소 ${(
      storageUsage() / 1024
    ).toFixed(0)} KB 사용`;
  }
}

/* ──────────────────────────────────────────────────────────────
 * 네비게이션
 * ────────────────────────────────────────────────────────────── */

function wireNavigation(game, dom) {
  document.addEventListener('click', (e) => {
    const navBtn = e.target.closest('[data-nav]');
    if (navBtn) {
      const target = navBtn.dataset.nav;
      audio.play('click');
      if (target === 'quickstart') {
        const craft = buildPreset('orbiter');
        game.currentCraft = craft;
        game.launch(craft);
      } else if (target === 'continue') {
        game.quickload();
      } else {
        game.go(target);
      }
    }
  });

  // 메뉴 배경 정보
  const fundsEl = $('menu-funds');
  const updateFunds = () => {
    if (fundsEl) {
      fundsEl.textContent = `${game.progress.funds.toLocaleString(
        'ko-KR'
      )} 크레딧 · 과학 ${game.progress.science}`;
    }
  };
  updateFunds();
  bus.on(EVT.SCENE_CHANGE, updateFunds);
  bus.on(EVT.MISSION_COMPLETE, updateFunds);
}

/* ──────────────────────────────────────────────────────────────
 * 설계실
 * ────────────────────────────────────────────────────────────── */

function wireBuilder(game, dom) {
  const b = game.builder;

  $('build-new')?.addEventListener('click', () => {
    b.newCraft();
    audio.play('click');
  });

  $('build-save')?.addEventListener('click', () => {
    b.craft.name = dom.buildName?.value?.trim() || '무명 기체';
    const bp = b.craft.toBlueprint();
    const id = saveBlueprint(bp);
    if (id) {
      b.craft.id = id;
      bus.emit(EVT.TOAST, { text: '설계도 저장 완료', kind: 'success' });
      audio.play('success');
    } else {
      bus.emit(EVT.TOAST, { text: '저장 실패', kind: 'danger' });
    }
  });

  $('build-launch')?.addEventListener('click', () => {
    b.craft.name = dom.buildName?.value?.trim() || b.craft.name;
    game.currentCraft = b.craft.clone();
    game.launch(game.currentCraft);
  });

  $('build-undo')?.addEventListener('click', () => b.undo());
  $('build-redo')?.addEventListener('click', () => b.redo());
  $('build-fit')?.addEventListener('click', () => b.fitView());

  $('build-symmetry')?.addEventListener('click', (e) => {
    b.symmetry = !b.symmetry;
    e.currentTarget.classList.toggle('active', b.symmetry);
    e.currentTarget.textContent = `대칭 ${b.symmetry ? '켜짐' : '꺼짐'}`;
  });

  $('build-stages')?.addEventListener('click', (e) => {
    b.stageEditing = !b.stageEditing;
    e.currentTarget.classList.toggle('active', b.stageEditing);
  });

  $('build-autostage')?.addEventListener('click', () => {
    b.pushHistory();
    b.craft.autoStage();
    b.markChanged(false);
    bus.emit(EVT.TOAST, { text: '스테이지 자동 배정' });
  });

  $('build-export')?.addEventListener('click', () => {
    b.craft.name = dom.buildName?.value?.trim() || b.craft.name;
    exportBlueprintFile(b.craft.toBlueprint());
  });

  const importInput = $('build-import-file');
  $('build-import')?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const bp = await importBlueprintFile(file);
      b.loadCraft(Craft.fromBlueprint(bp));
      bus.emit(EVT.TOAST, { text: '설계도 불러오기 완료', kind: 'success' });
    } catch (err) {
      bus.emit(EVT.TOAST, { text: `불러오기 실패: ${err.message}`, kind: 'danger' });
    }
    e.target.value = '';
  });

  const searchInput = $('part-search');
  searchInput?.addEventListener('input', (e) => {
    b.search = e.target.value;
    b.renderPalette(dom.buildPalette);
  });
  searchInput?.addEventListener('focus', () => game.input.captureText());
  searchInput?.addEventListener('blur', () => game.input.releaseText());
  dom.buildName?.addEventListener('focus', () => game.input.captureText());
  dom.buildName?.addEventListener('blur', () => game.input.releaseText());
  dom.buildName?.addEventListener('change', (e) => {
    b.craft.name = e.target.value.trim() || '무명 기체';
  });

  // 스테이지 조정 단축 버튼
  $('stage-up')?.addEventListener('click', () => {
    if (b.selectedPart) b.setPartStage(b.selectedPart, b.selectedPart.stage - 1);
  });
  $('stage-down')?.addEventListener('click', () => {
    if (b.selectedPart) b.setPartStage(b.selectedPart, b.selectedPart.stage + 1);
  });
}

/* ──────────────────────────────────────────────────────────────
 * 격납고
 * ────────────────────────────────────────────────────────────── */

function wireHangar(game, dom) {
  dom.hangarList?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const { act, id } = btn.dataset;
    audio.play('click');

    if (act === 'launch') {
      const craft = buildPreset(id);
      if (craft) {
        game.currentCraft = craft;
        const meta = PRESET_BUILDERS.find((p) => p.id === id);
        if (meta?.start) {
          game.launch(craft, {
            startInOrbit: true,
            body: game.system.get(meta.start.body) ?? game.home,
            altitude: meta.start.altitude,
          });
        } else {
          game.launch(craft);
        }
      }
    } else if (act === 'edit') {
      const craft = buildPreset(id);
      if (craft) {
        game.builder.loadCraft(craft);
        game.go('builder');
      }
    } else if (act === 'launch-saved') {
      const bp = loadBlueprint(id);
      if (bp) {
        const craft = Craft.fromBlueprint(bp);
        craft.fillAll(1);
        game.currentCraft = craft;
        game.launch(craft);
      }
    } else if (act === 'edit-saved') {
      const bp = loadBlueprint(id);
      if (bp) {
        game.builder.loadCraft(Craft.fromBlueprint(bp));
        game.go('builder');
      }
    } else if (act === 'delete-saved') {
      if (confirm('이 설계도를 삭제할까요?')) {
        deleteBlueprint(id);
        game.refreshHangar();
      }
    }
  });
}

/* ──────────────────────────────────────────────────────────────
 * 임무
 * ────────────────────────────────────────────────────────────── */

function wireMissions(game, dom) {
  dom.missionList?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act="start-mission"]');
    if (!btn) return;
    audio.play('click');
    const id = btn.dataset.id;
    game.missions.start(id, game.vessel);
    game.missions.completed = false;
    bus.emit(EVT.TOAST, { text: '임무를 수락했습니다. 기체를 준비하세요.' });
    game.go('hangar');
  });
}

/* ──────────────────────────────────────────────────────────────
 * 비행 화면
 * ────────────────────────────────────────────────────────────── */

function wireFlight(game, dom) {
  $('flight-map')?.addEventListener('click', () => game.toggleMap());
  $('flight-recover')?.addEventListener('click', () => game.recover());
  $('flight-abort')?.addEventListener('click', () => {
    if (confirm('임무를 중단하고 우주센터로 돌아갈까요?')) {
      game.endFlight('aborted');
    }
  });
  $('flight-quicksave')?.addEventListener('click', () => game.quicksave());
  $('flight-hud')?.addEventListener('click', (e) => {
    game.hud.visible = !game.hud.visible;
    e.currentTarget.classList.toggle('active', game.hud.visible);
  });

  // 오토파일럿 버튼
  const apButtons = [
    ['ap-ascent', AP_MODE.ASCENT],
    ['ap-circularize', AP_MODE.CIRCULARIZE],
    ['ap-land', AP_MODE.LAND],
    ['ap-hover', AP_MODE.HOVER],
    ['ap-kill', AP_MODE.KILL_ROTATION],
    ['ap-node', AP_MODE.NODE],
  ];
  for (const [id, mode] of apButtons) {
    $(id)?.addEventListener('click', () => {
      if (!game.autopilot) return;
      if (game.autopilot.mode === mode) {
        game.autopilot.disable();
      } else if (mode === AP_MODE.NODE) {
        game.autopilot.setMode(mode, { node: game.planner.next });
      } else {
        game.autopilot.setMode(mode);
      }
      audio.play('click');
    });
  }

  // 지도 툴바
  $('map-add-node')?.addEventListener('click', () => game.addManeuverNode());
  $('map-clear-nodes')?.addEventListener('click', () => {
    game.planner.clear();
    bus.emit(EVT.TOAST, { text: '기동 노드 삭제' });
  });
  $('map-focus-vessel')?.addEventListener('click', () => {
    if (game.vessel) game.mapView.focusOn(game.vessel.body, game.universeTime);
  });
  $('map-set-target')?.addEventListener('click', () => {
    const b = game.mapView.selectedBody;
    if (b) {
      game.mapView.setTarget(b);
      game.targetBody = b;
      bus.emit(EVT.TOAST, { text: `${b.name} 을(를) 목표로 지정` });
    } else {
      bus.emit(EVT.TOAST, { text: '먼저 천체를 클릭하세요', kind: 'warn' });
    }
  });

  // 일시정지 메뉴
  $('pause-resume')?.addEventListener('click', () => game.togglePauseMenu());
  $('pause-save')?.addEventListener('click', () => game.quicksave());
  $('pause-load')?.addEventListener('click', () => game.quickload());
  $('pause-menu-exit')?.addEventListener('click', () => {
    game.paused = false;
    if (dom.pauseMenu) dom.pauseMenu.hidden = true;
    game.endFlight('aborted');
  });

  // 터치 컨트롤
  wireTouchControls(game);
}

function wireTouchControls(game) {
  const input = game.input;
  for (const el of document.querySelectorAll('[data-hold]')) {
    const action = el.dataset.hold;
    const down = (e) => {
      e.preventDefault();
      input.pressVirtual(action);
      el.classList.add('pressed');
    };
    const up = () => {
      input.releaseVirtual(action);
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  const throttleSlider = $('touch-throttle');
  throttleSlider?.addEventListener('input', (e) => {
    if (game.vessel) game.vessel.setThrottle(Number(e.target.value) / 100);
  });
}

/* ──────────────────────────────────────────────────────────────
 * 설정
 * ────────────────────────────────────────────────────────────── */

function wireSettings(game, dom) {
  const bind = (id, path, transform = (v) => v) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('change', () => {
      const value = el.type === 'checkbox' ? el.checked : transform(el.value);
      const keys = path.split('.');
      let obj = game.settings;
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
      obj[keys[keys.length - 1]] = value;
      game.saveSettingsFromPanel();
    });
    if (el.type === 'range') {
      el.addEventListener('input', () => {
        const value = transform(el.value);
        const keys = path.split('.');
        let obj = game.settings;
        for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
        obj[keys[keys.length - 1]] = value;
        game.saveSettingsFromPanel();
      });
    }
  };

  bind('set-quality', 'graphics.quality');
  bind('set-starfield', 'graphics.starfield');
  bind('set-trajectory', 'graphics.showTrajectoryPrediction');
  bind('set-shake', 'graphics.screenShake', Number);
  bind('set-fps', 'graphics.showFps');
  bind('set-master', 'audio.master', Number);
  bind('set-sfx', 'audio.sfx', Number);
  bind('set-music', 'audio.music', Number);
  bind('set-difficulty', 'gameplay.difficulty');
  bind('set-heat', 'gameplay.reentryHeat');
  bind('set-drag', 'gameplay.atmosphericDrag');
  bind('set-sensitivity', 'controls.controlSensitivity', Number);

  $('settings-reset')?.addEventListener('click', () => {
    if (confirm('설정을 초기화할까요?')) {
      game.settings = resetSettings();
      game.refreshSettingsPanel();
      game.saveSettingsFromPanel();
    }
  });

  $('progress-reset')?.addEventListener('click', () => {
    if (confirm('모든 진행도(자금·업적·기록)를 삭제할까요? 되돌릴 수 없습니다.')) {
      game.progress = resetProgress();
      game.missions.progress = game.progress;
      bus.emit(EVT.TOAST, { text: '진행도 초기화 완료' });
    }
  });

  // 세이브 목록
  const refreshSaves = () => {
    const el = dom.saveList;
    if (!el) return;
    el.innerHTML = '';
    const saves = listSaves();
    if (!saves.length) {
      el.innerHTML = '<p class="muted">저장된 비행이 없습니다.</p>';
      return;
    }
    for (const s of saves) {
      const row = document.createElement('div');
      row.className = 'save-row';
      row.innerHTML = `
        <div>
          <b>${s.label}</b>
          <span>${s.craftName} · ${s.body} · ${s.situation}</span>
          <em>${new Date(s.savedAt).toLocaleString('ko-KR')}</em>
        </div>
        <div class="save-actions">
          <button data-save-act="load" data-id="${s.id}">불러오기</button>
          <button data-save-act="delete" data-id="${s.id}" class="danger">삭제</button>
        </div>`;
      el.appendChild(row);
    }
  };
  refreshSaves();
  bus.on(EVT.SCENE_CHANGE, (p) => {
    if (p.scene === 'settings') refreshSaves();
  });

  dom.saveList?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-save-act]');
    if (!btn) return;
    const { saveAct, id } = btn.dataset;
    if (saveAct === 'load') {
      const data = readSave(id);
      if (data) game.loadSaveData(data);
    } else if (saveAct === 'delete') {
      deleteSave(id);
      refreshSaves();
    }
  });
}

/* ──────────────────────────────────────────────────────────────
 * 결과 화면
 * ────────────────────────────────────────────────────────────── */

function wireResults(game, dom) {
  $('results-menu')?.addEventListener('click', () => game.go('menu'));
  $('results-hangar')?.addEventListener('click', () => game.go('hangar'));
  $('results-retry')?.addEventListener('click', () => {
    if (game.currentCraft) {
      game.launch(game.currentCraft.clone());
    } else {
      game.go('hangar');
    }
  });
}

/* 시작 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
