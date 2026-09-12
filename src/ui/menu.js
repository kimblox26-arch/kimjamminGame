// FREE FREELY - 화면/메뉴 관리 (메인, 격납고, 임무, 설정, 조작법, 일시정지)
import { Settings, DEFAULTS } from '../core/settings.js';
import { PRESETS, loadDesigns } from '../craft/presets.js';
import { analyzeBlueprint } from '../craft/assembler.js';
import { CAMERA_MODES } from '../core/camera.js';
import { clamp } from '../core/utils.js';

export const MISSIONS = [
  {
    id: 'free', name: '자유 비행', icon: '🛫', craft: null,
    desc: '제한 없이 하늘을 누빈다. 기체를 골라 이륙하자.',
    detail: '목표 없음 · 활주로에서 시작 · 날씨와 시간 설정 자유',
  },
  {
    id: 'rings', name: '링 코스 타임어택', icon: '⏱️', craft: 'fighter',
    desc: '8개의 홀로그램 링을 순서대로 통과해 최단 기록을 세운다.',
    detail: '추천 기체: 전투기 · 저공 고속 비행 주의',
  },
  {
    id: 'carrier', name: '항공모함 착함', icon: '🚢', craft: 'fighter', airborne: true,
    desc: '흔들리는 갑판에 정확히 내려앉는다. 강하율이 생명.',
    detail: '공중 시작 · 갑판 위 접지 + 정지 성공 시 클리어',
  },
  {
    id: 'balloon', name: '열기구 유람', icon: '🎈', craft: 'balloon',
    desc: '버너와 배기 밸브만으로 고도 1,500 m 를 유지하며 바람을 읽는다.',
    detail: '목표: 3분간 1,200~1,800 m 유지',
  },
  {
    id: 'space', name: '우주 도달', icon: '🚀', craft: 'spaceship',
    desc: '로켓을 점화해 고도 100 km 우주 경계선을 넘는다.',
    detail: '대기권 돌파 후 무중력 · RCS 자세 제어 필요',
  },
  {
    id: 'storm', name: '폭풍 돌파', icon: '⛈️', craft: 'airliner', weather: 'storm', airborne: true,
    desc: '난기류와 번개 속에서 여객기를 안정적으로 조종해 활주로로 귀환한다.',
    detail: '공중 시작 · 강풍/난류 최대 · 활주로 착륙 시 클리어',
  },
  {
    id: 'water', name: '수상 착륙', icon: '🌊', craft: 'floatplane',
    desc: '바다에 부드럽게 내려앉아 물보라를 즐긴다.',
    detail: '해상 착수 후 30 km/h 이하로 감속 성공 시 클리어',
  },
  {
    id: 'glide', name: '활공 챌린지', icon: '🪂', craft: 'glider', airborne: true, altitude: 2200,
    desc: '엔진 없이 열상승풍을 타고 최대한 멀리, 오래 떠 있는다.',
    detail: '공중 시작 · 5분 이상 비행 시 클리어',
  },
];

const KEY_GUIDE = [
  ['비행 조종', [
    ['W / S', '기수 내림 / 올림 (피치)'],
    ['A / D', '좌 / 우 롤'],
    ['Q / E', '좌 / 우 요 (러더)'],
    ['Shift / Ctrl', '스로틀 증가 / 감소'],
    ['Tab', '애프터버너 (제트 전용)'],
    ['Space', '열기구 버너 / 로켓 점화'],
    ['C', '열기구 배기 밸브 (하강)'],
  ]],
  ['기체 시스템', [
    ['G', '착륙장치 접개'],
    ['F / V', '플랩 내림 / 올림'],
    ['B', '휠 브레이크'],
    ['X', '에어브레이크'],
    ['H', '자동조종 순환 (수평→고도→방위)'],
    ['R / T', '트림 조정'],
    ['L', '착륙등 / 항법등'],
    ['I', '엔진 시동 / 정지'],
    ['P', '비상 낙하산'],
  ]],
  ['무장 / 기타', [
    ['J', '기관총 · 기관포 발사'],
    ['K', '플레어 살포'],
    ['N', '시점 변경 (1인칭 ↔ 3인칭 ↔ 궤도 ↔ 시네마틱 ↔ 관제탑)'],
    ['M', '뒤돌아보기'],
    ['Z', '미니맵 확대'],
    ['U', '시간 빠르게 (낮/밤)'],
    ['O', '기체 리스폰'],
    ['ESC', '일시정지 / 메뉴'],
    ['마우스 우클릭 드래그', '시점 둘러보기'],
  ]],
];

export class UIManager {
  constructor(game) {
    this.game = game;
    this.el = {};
    const ids = ['screen-loading', 'screen-menu', 'screen-hangar', 'screen-missions', 'screen-settings',
      'screen-controls', 'screen-pause', 'screen-crash', 'flight-ui', 'builder-root', 'toast',
      'loading-bar', 'loading-label', 'loading-tip', 'hangar-grid', 'mission-grid', 'settings-body',
      'controls-body', 'crash-body', 'flight-top', 'flight-buttons', 'throttle-slider', 'stick-pad',
      'cloud-overlay', 'underwater-overlay', 'damage-overlay', 'flash-overlay', 'menu-craft-info'];
    for (const id of ids) this.el[id] = document.getElementById(id);
    this.selectedCraft = PRESETS[0];
    this.selectedMission = MISSIONS[0];
    this.screen = 'screen-loading';
    this._bindMenu();
    this._buildSettings();
    this._buildControls();
    this.buildHangar();
    this.buildMissions();
  }

  /* ------------------------------ 화면 전환 ------------------------------ */
  show(id) {
    for (const key of ['screen-loading', 'screen-menu', 'screen-hangar', 'screen-missions', 'screen-settings', 'screen-controls']) {
      if (this.el[key]) this.el[key].classList.toggle('active', key === id);
    }
    this.screen = id;
    document.body.dataset.screen = id;
  }

  hideAllScreens() {
    for (const key of ['screen-loading', 'screen-menu', 'screen-hangar', 'screen-missions', 'screen-settings', 'screen-controls']) {
      if (this.el[key]) this.el[key].classList.remove('active');
    }
    this.screen = 'none';
    document.body.dataset.screen = 'flight';
  }

  setLoading(p, label) {
    if (this.el['loading-bar']) this.el['loading-bar'].style.width = Math.round(clamp(p, 0, 1) * 100) + '%';
    if (label && this.el['loading-label']) this.el['loading-label'].textContent = label;
  }

  toast(msg, kind = 'info', ms = 2600) {
    const t = this.el.toast;
    if (!t) return;
    const d = document.createElement('div');
    d.className = 'toast-item ' + kind;
    d.textContent = msg;
    t.appendChild(d);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 400); }, ms);
  }

  /* ------------------------------ 메인 메뉴 ------------------------------ */
  _bindMenu() {
    document.querySelectorAll('[data-nav]').forEach((b) => {
      b.addEventListener('click', () => {
        const nav = b.dataset.nav;
        this.game.audio.ui('click');
        if (nav === 'fly') this.game.startFlight(this.selectedCraft, this.selectedMission);
        else if (nav === 'builder') this.game.openBuilder();
        else if (nav === 'menu') this.show('screen-menu');
        else this.show('screen-' + nav);
      });
      b.addEventListener('pointerenter', () => this.game.audio.ui('hover'));
    });
    document.querySelectorAll('[data-pause-act]').forEach((b) => {
      b.addEventListener('click', () => {
        this.game.audio.ui('click');
        const a = b.dataset.pauseAct;
        if (a === 'resume') this.game.setPaused(false);
        else if (a === 'settings') { this.game.setPaused(false); this.game.quitToMenu(); this.show('screen-settings'); }
        else if (a === 'builder') { this.game.setPaused(false); this.game.openBuilder(); }
        else if (a === 'menu') { this.game.setPaused(false); this.game.quitToMenu(); }
        else if (a === 'respawn') { this.game.setPaused(false); this.game.respawn(); }
      });
    });
    document.querySelectorAll('[data-crash-act]').forEach((b) => {
      b.addEventListener('click', () => {
        this.game.audio.ui('click');
        const a = b.dataset.crashAct;
        if (a === 'respawn') this.game.respawn();
        else if (a === 'menu') this.game.quitToMenu();
      });
    });
  }

  /* ------------------------------ 격납고 ------------------------------ */
  buildHangar() {
    const grid = this.el['hangar-grid'];
    if (!grid) return;
    const mine = loadDesigns();
    const all = [...PRESETS, ...mine.map((m) => ({ ...m, mine: true }))];
    grid.innerHTML = '';
    for (const bp of all) {
      const s = analyzeBlueprint(bp);
      const card = document.createElement('div');
      card.className = 'craft-card';
      card.innerHTML = `
        <div class="cc-top">
          <div class="cc-name">${bp.name}</div>
          <div class="cc-kind">${bp.mine ? '내 설계' : kindName(bp.kind)}</div>
        </div>
        <div class="cc-desc">${bp.desc || '직접 설계한 기체'}</div>
        <div class="cc-bars">
          ${bar('속도', clamp(s.topSpeed / 700, 0, 1))}
          ${bar('기동성', clamp(s.twr * 0.7 + (s.wingArea > 0 ? 40 / Math.max(20, s.wingLoading) : 0), 0, 1))}
          ${bar('안정성', clamp(0.35 + s.staticMargin * 2.2, 0, 1))}
          ${bar('항속', clamp(s.fuel / 900, 0, 1))}
        </div>
        <div class="cc-stats">
          <span>${Math.round(s.mass)} kg</span><span>${(s.thrust / 1000).toFixed(0)} kN</span>
          <span>${s.wingArea.toFixed(0)} m²</span><span>${isFinite(s.stallSpeed) ? Math.round(s.stallSpeed * 3.6) + ' km/h 실속' : '부력 비행'}</span>
        </div>
        <div class="cc-tags">${(bp.tags || []).map((t) => `<span>${t}</span>`).join('')}</div>
        <div class="cc-btns">
          <button class="btn btn-primary" data-pick>이 기체로 비행</button>
          <button class="btn btn-ghost" data-edit>설계 열기</button>
        </div>`;
      card.querySelector('[data-pick]').onclick = () => {
        this.selectedCraft = bp;
        this.game.audio.ui('confirm');
        this.game.startFlight(bp, this.selectedMission);
      };
      card.querySelector('[data-edit]').onclick = () => {
        this.selectedCraft = bp;
        this.game.audio.ui('click');
        this.game.openBuilder(bp);
      };
      card.onpointerenter = () => {
        this.selectedCraft = bp;
        this.updateMenuCraftInfo();
      };
      grid.appendChild(card);
    }
    this.updateMenuCraftInfo();
  }

  updateMenuCraftInfo() {
    const box = this.el['menu-craft-info'];
    if (!box) return;
    const bp = this.selectedCraft;
    const s = analyzeBlueprint(bp);
    box.innerHTML = `
      <div class="mci-label">선택된 기체</div>
      <div class="mci-name">${bp.name}</div>
      <div class="mci-desc">${bp.desc || '사용자 설계 기체'}</div>
      <div class="mci-stats">
        <div><span>질량</span><b>${Math.round(s.mass)} kg</b></div>
        <div><span>추력</span><b>${(Math.max(s.thrust, s.thrustAB) / 1000).toFixed(0)} kN</b></div>
        <div><span>날개</span><b>${s.wingArea.toFixed(0)} m²</b></div>
        <div><span>최고속도</span><b>${Math.round(s.topSpeed * 3.6)} km/h</b></div>
      </div>
      <div class="mci-label">선택된 임무</div>
      <div class="mci-mission">${this.selectedMission.icon} ${this.selectedMission.name}</div>`;
  }

  /* ------------------------------ 임무 ------------------------------ */
  buildMissions() {
    const grid = this.el['mission-grid'];
    if (!grid) return;
    grid.innerHTML = '';
    for (const m of MISSIONS) {
      const card = document.createElement('div');
      card.className = 'mission-card';
      const best = localStorage.getItem('freefreely.best.' + m.id);
      card.innerHTML = `
        <div class="mc-icon">${m.icon}</div>
        <div class="mc-name">${m.name}</div>
        <div class="mc-desc">${m.desc}</div>
        <div class="mc-detail">${m.detail}</div>
        ${best ? `<div class="mc-best">최고 기록: ${best}</div>` : ''}
        <button class="btn btn-primary" data-start>임무 시작</button>`;
      card.querySelector('[data-start]').onclick = () => {
        this.selectedMission = m;
        const craft = m.craft ? PRESETS.find((p) => p.id === m.craft) : this.selectedCraft;
        this.selectedCraft = craft || this.selectedCraft;
        this.game.audio.ui('confirm');
        this.game.startFlight(this.selectedCraft, m);
      };
      card.onpointerenter = () => { this.selectedMission = m; this.updateMenuCraftInfo(); };
      grid.appendChild(card);
    }
  }

  /* ------------------------------ 설정 ------------------------------ */
  _buildSettings() {
    const body = this.el['settings-body'];
    if (!body) return;
    const groups = [
      {
        title: '그래픽', items: [
          { k: 'quality', label: '품질 프리셋', type: 'select', options: [['low', '낮음'], ['medium', '보통'], ['high', '높음'], ['ultra', '울트라']] },
          { k: 'renderScale', label: '렌더 배율', type: 'range', min: 0.5, max: 1.5, step: 0.05 },
          { k: 'shadows', label: '그림자', type: 'toggle' },
          { k: 'bloom', label: '블룸 (빛 번짐)', type: 'toggle' },
          { k: 'volumetricClouds', label: '입체 구름', type: 'toggle' },
          { k: 'cloudDensity', label: '구름 밀도', type: 'range', min: 0.2, max: 2, step: 0.1 },
          { k: 'fov', label: '시야각 (FOV)', type: 'range', min: 55, max: 100, step: 1 },
        ],
      },
      {
        title: '사운드', items: [
          { k: 'masterVolume', label: '전체 볼륨', type: 'range', min: 0, max: 1, step: 0.05 },
          { k: 'engineVolume', label: '엔진음', type: 'range', min: 0, max: 1, step: 0.05 },
          { k: 'windVolume', label: '바람소리', type: 'range', min: 0, max: 1, step: 0.05 },
          { k: 'effectVolume', label: '효과음', type: 'range', min: 0, max: 1, step: 0.05 },
          { k: 'musicVolume', label: '메뉴 음악', type: 'range', min: 0, max: 1, step: 0.05 },
        ],
      },
      {
        title: '조작', items: [
          { k: 'sensitivity', label: '조작 감도', type: 'range', min: 0.4, max: 2, step: 0.05 },
          { k: 'assistLevel', label: '비행 보조', type: 'select', options: [['normal', '보통 (권장)'], ['high', '강함 — 초보자'], ['off', '끔 — 완전 수동']] },
          { k: 'invertPitch', label: '피치 반전', type: 'toggle' },
          { k: 'mouseFlight', label: '마우스 비행 (클릭해 잠금)', type: 'toggle' },
          { k: 'units', label: '단위', type: 'select', options: [['metric', '미터법 (km/h, m)'], ['imperial', '항공 단위 (kt, ft)']] },
          { k: 'onScreenControls', label: '화면 조이스틱·스로틀', type: 'select', options: [['auto', '자동 (터치 기기)'], ['on', '항상 표시'], ['off', '숨김']] },
        ],
      },
      {
        title: '월드 / 날씨', items: [
          { k: 'timeOfDay', label: '시각 (시)', type: 'range', min: 0, max: 24, step: 0.25 },
          { k: 'dayNightRunning', label: '밤낮 순환', type: 'toggle' },
          { k: 'dayLengthMinutes', label: '하루 길이 (분)', type: 'range', min: 2, max: 60, step: 1 },
          { k: 'weather', label: '날씨', type: 'select', options: [['clear', '맑음'], ['cloudy', '구름 조금'], ['overcast', '흐림'], ['storm', '폭풍']] },
          { k: 'windStrength', label: '풍속 (m/s)', type: 'range', min: 0, max: 30, step: 0.5 },
          { k: 'turbulence', label: '난류', type: 'range', min: 0, max: 2, step: 0.1 },
          { k: 'seaState', label: '파도 높이', type: 'range', min: 0, max: 2, step: 0.1 },
        ],
      },
    ];
    body.innerHTML = groups.map((g) => `
      <div class="set-group">
        <h4>${g.title}</h4>
        ${g.items.map((it) => this._settingRow(it)).join('')}
      </div>`).join('') + `
      <div class="set-group">
        <h4>초기화</h4>
        <button class="btn btn-ghost" id="set-reset">모든 설정 기본값으로</button>
      </div>`;

    body.querySelectorAll('[data-set]').forEach((input) => {
      const key = input.dataset.set;
      const apply = () => {
        let v;
        if (input.type === 'checkbox') v = input.checked;
        else if (input.type === 'range') v = parseFloat(input.value);
        else v = input.value;
        Settings.set(key, v);
        const out = body.querySelector(`[data-out="${key}"]`);
        if (out) out.textContent = formatSetting(key, v);
        this.game.onSettingsChanged(key, v);
        this._syncSettings();
      };
      input.addEventListener('input', apply);
      input.addEventListener('change', apply);
    });
    const reset = body.querySelector('#set-reset');
    if (reset) reset.onclick = () => { Settings.reset(); this._syncSettings(); this.game.onSettingsChanged('*'); this.toast('설정을 초기화했습니다'); };
    this._syncSettings();
  }

  _settingRow(it) {
    const v = Settings.get(it.k);
    if (it.type === 'toggle') {
      return `<label class="set-row"><span>${it.label}</span>
        <input type="checkbox" data-set="${it.k}" ${v ? 'checked' : ''}>
        <i class="switch"></i></label>`;
    }
    if (it.type === 'range') {
      return `<label class="set-row"><span>${it.label}</span>
        <input type="range" data-set="${it.k}" min="${it.min}" max="${it.max}" step="${it.step}" value="${v}">
        <b data-out="${it.k}">${formatSetting(it.k, v)}</b></label>`;
    }
    return `<label class="set-row"><span>${it.label}</span>
      <select data-set="${it.k}">${it.options.map((o) => `<option value="${o[0]}" ${o[0] === v ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></label>`;
  }

  _syncSettings() {
    const body = this.el['settings-body'];
    if (!body) return;
    body.querySelectorAll('[data-set]').forEach((input) => {
      const v = Settings.get(input.dataset.set);
      if (input.type === 'checkbox') input.checked = !!v;
      else input.value = v;
      const out = body.querySelector(`[data-out="${input.dataset.set}"]`);
      if (out) out.textContent = formatSetting(input.dataset.set, v);
    });
  }

  /* ------------------------------ 조작법 ------------------------------ */
  _buildControls() {
    const body = this.el['controls-body'];
    if (!body) return;
    body.innerHTML = KEY_GUIDE.map((g) => `
      <div class="key-group">
        <h4>${g[0]}</h4>
        ${g[1].map((k) => `<div class="key-row"><kbd>${k[0]}</kbd><span>${k[1]}</span></div>`).join('')}
      </div>`).join('') + `
      <div class="key-group">
        <h4>시점</h4>
        ${CAMERA_MODES.map((m, i) => `<div class="key-row"><kbd>N ×${i + 1}</kbd><span>${m.name}</span></div>`).join('')}
      </div>
      <div class="key-group">
        <h4>화면 버튼</h4>
        <p class="hint">비행 중 화면 하단의 버튼과 좌측 조이스틱, 우측 스로틀 슬라이더로도 모든 조작이 가능합니다.
        터치 기기에서도 동일하게 작동합니다.</p>
      </div>`;
  }

  /* ------------------------------ 비행 UI ------------------------------ */
  setFlightUI(on) {
    if (this.el['flight-ui']) this.el['flight-ui'].hidden = !on;
  }

  updateFlightTop(info) {
    const el = this.el['flight-top'];
    if (!el) return;
    el.innerHTML = `
      <div class="ft-item"><span>기체</span><b>${info.craft}</b></div>
      <div class="ft-item"><span>임무</span><b>${info.mission}</b></div>
      <div class="ft-item"><span>시각</span><b>${info.clock}</b></div>
      <div class="ft-item"><span>날씨</span><b>${info.weather}</b></div>
      <div class="ft-item"><span>풍향/풍속</span><b>${info.wind}</b></div>
      <div class="ft-item"><span>시점</span><b>${info.camera}</b></div>
      <div class="ft-item"><span>FPS</span><b>${info.fps}</b></div>`;
  }

  setButtonState(action, active) {
    const b = document.querySelector(`[data-btn="${action}"]`);
    if (b) b.classList.toggle('on', !!active);
  }

  showPause(on) {
    if (this.el['screen-pause']) this.el['screen-pause'].hidden = !on;
  }

  showCrash(on, info) {
    const el = this.el['screen-crash'];
    if (!el) return;
    el.hidden = !on;
    if (on && info) {
      this.el['crash-body'].innerHTML = `
        <div class="crash-reason">${info.reason}</div>
        <div class="crash-stats">
          <div><span>비행 시간</span><b>${info.time}</b></div>
          <div><span>이동 거리</span><b>${info.distance}</b></div>
          <div><span>최고 고도</span><b>${info.maxAlt}</b></div>
          <div><span>최고 속도</span><b>${info.maxSpeed}</b></div>
          <div><span>착륙 횟수</span><b>${info.landings}</b></div>
        </div>`;
    }
  }

  setOverlay(name, amount) {
    const el = this.el[name];
    if (el) el.style.opacity = String(clamp(amount, 0, 1));
  }
}

function bar(label, v) {
  return `<div class="cc-bar"><span>${label}</span><i><b style="width:${Math.round(clamp(v, 0, 1) * 100)}%"></b></i></div>`;
}

function kindName(k) {
  return { plane: '프로펠러기', fighter: '전투기', airliner: '여객기', balloon: '열기구', spacecraft: '우주선', glider: '글라이더' }[k] || '항공기';
}

function formatSetting(key, v) {
  if (typeof v === 'boolean') return v ? 'ON' : 'OFF';
  if (key === 'timeOfDay') {
    const h = Math.floor(v), m = Math.round((v - h) * 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  if (key === 'fov') return Math.round(v) + '°';
  if (key === 'dayLengthMinutes') return Math.round(v) + '분';
  if (key === 'windStrength') return v.toFixed(1) + ' m/s';
  if (typeof v === 'number') return v.toFixed(2);
  return String(v);
}

void DEFAULTS;
