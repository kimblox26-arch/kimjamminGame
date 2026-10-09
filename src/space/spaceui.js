// FREE FREELY 우주 탐사 - HTML UI: 항성계 선택, 비행 버튼·터치 조이스틱·스로틀, 키 변경, 조작법
import { icon, buttonHTML, bodyIcon } from '../ui/icons.js';
import { SPACE_KEY_LABELS, SPACE_KEYS_DEFAULT, keyName, loadSpaceKeys, saveSpaceKeys } from './keys.js';
import { TIERS, formatSpeed } from './consts.js';

const SYSTEMS = [
  { id: 'sol', feature: 'earth', title: '태양계', sub: '지구 저궤도에서 출발' },
  { id: 'proxima', feature: 'proxima-c', title: '프록시마 켄타우리계', sub: '적색왜성 · 용암 행성 · 얼음 행성' },
  { id: 'trappist', feature: 'trappist-e', title: '트라피스트-1계', sub: '붉은 태양 아래 바다 행성' },
  { id: 'rigel', feature: 'rigel-b', title: '리겔계', sub: '청색 초거성 · 고리 행성 · 사막 행성' },
];

/** 항성계 선택 화면 */
export function buildSystemSelect(space, onStart) {
  const grid = document.getElementById('systems-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const s of SYSTEMS) {
    const sys = space.uni.byId[s.id];
    const feat = space.uni.byId[s.feature];
    const card = document.createElement('div');
    card.className = 'sys-card frame-panel ico-host';
    const bodies = sys.children.filter((c) => c.kind !== 'belt');
    card.innerHTML = `
      <h4>${icon('system', { size: 22 })} ${s.title}</h4>
      <div class="sys-prev"></div>
      <p>${sys.desc}<br><b style="color:var(--cyan)">${s.sub}</b></p>
      <div class="sys-bodies">${bodies.map((b) => `<span>${icon(bodyIcon(b), { size: 14, glow: false })}${b.name}</span>`).join('')}</div>
      ${buttonHTML('launch', '이 항성계에서 출발', { primary: true, attrs: `data-sys="${s.id}"` })}`;
    card.querySelector('.sys-prev').appendChild(space.previews.element(feat, 128));
    card.querySelector('[data-sys]').onclick = () => onStart(s.id);
    grid.appendChild(card);
  }
}

/** 비행 중 버튼 · 터치 조작 */
export function buildSpaceUI(space, app) {
  const root = document.getElementById('space-ui');
  root.innerHTML = `
    <div class="sp-tiers">${TIERS.map((t) => buttonHTML('tier' + t.id, `${t.id}단계`, { small: true, cls: 'tier' + t.id + (t.id >= 4 ? ' primary' : ''), attrs: `data-sp="tier${t.id}" title="${t.name} · ${formatSpeed(t.max)}"` })).join('')}</div>
    <div class="sp-buttons">
      ${buttonHTML('assist', '관성 보조', { small: true, attrs: 'data-sp="assist"', key: 'Z' })}
      ${buttonHTML('gear', '착륙 장치', { small: true, attrs: 'data-sp="gear"', key: 'G' })}
      ${buttonHTML('view', '시점', { small: true, attrs: 'data-sp="view"', key: 'C' })}
      ${buttonHTML('map', '지도', { small: true, attrs: 'data-sp="map"', key: 'M' })}
      ${buttonHTML('target', '목표', { small: true, attrs: 'data-sp="target"', key: 'T' })}
      ${buttonHTML('autopilot', '정렬', { small: true, attrs: 'data-sp="align"', key: 'H' })}
      ${buttonHTML('orbit', '궤도선', { small: true, attrs: 'data-sp="orbit"', key: 'O' })}
      ${buttonHTML('pause', '일시정지', { small: true, attrs: 'data-sp="pause"', key: 'ESC' })}
    </div>
    <div class="sp-stick" aria-label="조종 스틱">
      <svg viewBox="0 0 140 140"><defs><filter id="spglow"><feGaussianBlur stdDeviation="2.5"/></filter></defs>
        <circle cx="70" cy="70" r="62" fill="rgba(8,22,34,0.55)" stroke="#62e6ff" stroke-opacity="0.5" stroke-width="2"/>
        <circle cx="70" cy="70" r="62" fill="none" stroke="#62e6ff" stroke-opacity="0.35" stroke-width="5" filter="url(#spglow)"/>
        <path d="M70 14v14M70 112v14M14 70h14M112 70h14" stroke="#62e6ff" stroke-opacity="0.6" stroke-width="2" stroke-linecap="round"/>
        <circle cx="70" cy="70" r="38" fill="none" stroke="#62e6ff" stroke-opacity="0.25" stroke-dasharray="3 5"/>
        <g class="knob"><circle cx="70" cy="70" r="20" fill="rgba(98,230,255,0.25)" stroke="#bff6ff" stroke-width="2"/><circle cx="70" cy="70" r="6" fill="#ffa94d"/></g>
      </svg>
    </div>
    <div class="sp-throttle" aria-label="스로틀">
      <svg viewBox="0 0 64 190">
        <path d="M14 4h36l10 10v162l-10 10H14L4 176V14Z" fill="rgba(8,22,34,0.55)" stroke="#62e6ff" stroke-opacity="0.5" stroke-width="2"/>
        <rect class="fill" x="22" y="20" width="20" height="150" fill="rgba(255,169,77,0.55)"/>
        <rect x="22" y="20" width="20" height="150" fill="none" stroke="#62e6ff" stroke-opacity="0.35"/>
        <g class="handle"><path d="M10 0h44l-4 6H14Z" fill="#ffa94d"/><rect x="10" y="-2" width="44" height="4" fill="#ffd9a8"/></g>
        <text x="32" y="186" text-anchor="middle" font-size="10" fill="#cfe6f2" font-family="Rajdhani, sans-serif">스로틀</text>
      </svg>
    </div>`;
  root.querySelectorAll('[data-sp]').forEach((b) => {
    b.addEventListener('click', () => {
      const a = b.dataset.sp;
      if (a === 'pause') app.togglePause();
      else space._onAction(a);
      b.blur();
    });
  });
  // 조이스틱
  const stick = root.querySelector('.sp-stick');
  const knob = stick.querySelector('.knob');
  let active = null;
  const setStick = (e) => {
    const r = stick.getBoundingClientRect();
    let nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = ((e.clientY - r.top) / r.height) * 2 - 1;
    const l = Math.hypot(nx, ny); if (l > 1) { nx /= l; ny /= l; }
    space.virtual.roll = nx; space.virtual.pitch = -ny;
    knob.setAttribute('transform', `translate(${nx * 40} ${ny * 40})`);
  };
  stick.addEventListener('pointerdown', (e) => { active = e.pointerId; stick.setPointerCapture(e.pointerId); setStick(e); });
  stick.addEventListener('pointermove', (e) => { if (active === e.pointerId) setStick(e); });
  const end = () => { active = null; space.virtual.roll = 0; space.virtual.pitch = 0; knob.setAttribute('transform', ''); };
  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);
  // 스로틀
  const thr = root.querySelector('.sp-throttle');
  const fill = thr.querySelector('.fill'), handle = thr.querySelector('.handle');
  let tActive = null;
  const setThr = (e) => {
    const r = thr.getBoundingClientRect();
    const v = Math.max(0, Math.min(1, 1 - ((e.clientY - r.top) / r.height * 190 - 20) / 150));
    space.virtual.throttle = v;
  };
  thr.addEventListener('pointerdown', (e) => { tActive = e.pointerId; thr.setPointerCapture(e.pointerId); setThr(e); });
  thr.addEventListener('pointermove', (e) => { if (tActive === e.pointerId) setThr(e); });
  thr.addEventListener('pointerup', () => { tActive = null; });
  // 상태 동기화
  return () => {
    const f = space.flight;
    const v = f.throttle;
    fill.setAttribute('y', String(20 + 150 * (1 - v)));
    fill.setAttribute('height', String(150 * v));
    handle.setAttribute('transform', `translate(0 ${20 + 150 * (1 - v)})`);
    const set = (k, on) => { const b = root.querySelector(`[data-sp="${k}"]`); if (b) b.classList.toggle('on', !!on); };
    for (let i = 1; i <= 5; i++) set('tier' + i, f.tier === i);
    set('assist', f.fa); set('gear', f.gearDown); set('orbit', space.orbitOn); set('align', space.autoAlign); set('map', space.map.open);
    set('view', space.view === 'cockpit');
  };
}

/** 설정 화면: 우주 탐사 키 변경 */
export function buildKeySettings(container, onChange) {
  if (!container) return;
  const keys = loadSpaceKeys();
  const render = () => {
    container.innerHTML = `<h4>${icon('keyboard', { size: 18 })} 키 변경 (우주 탐사)</h4>
      <p class="hint">버튼을 누른 뒤 새 키를 누르세요. ESC 는 취소.</p>
      ${Object.keys(SPACE_KEY_LABELS).map((a) => `<div class="key-bind-row"><span>${SPACE_KEY_LABELS[a]}</span>${buttonHTML('keyboard', keys[a].map(keyName).join(' / '), { small: true, attrs: `data-bind="${a}"` })}</div>`).join('')}
      <div style="margin-top:10px">${buttonHTML('reset', '키 배치 기본값으로', { small: true, attrs: 'data-bind-reset' })}</div>`;
    container.querySelectorAll('[data-bind]').forEach((b) => {
      b.onclick = () => {
        b.classList.add('listening');
        b.querySelector('.sbtn-label').textContent = '키를 누르세요';
        const h = (e) => {
          e.preventDefault(); e.stopPropagation();
          window.removeEventListener('keydown', h, true);
          if (e.code !== 'Escape') {
            const a = b.dataset.bind;
            // 다른 동작에서 같은 키 제거
            for (const k in keys) keys[k] = keys[k].filter((c) => c !== e.code);
            keys[a] = [e.code];
            saveSpaceKeys(keys);
            onChange && onChange(keys);
          }
          render();
        };
        window.addEventListener('keydown', h, true);
      };
    });
    const r = container.querySelector('[data-bind-reset]');
    if (r) r.onclick = () => { Object.assign(keys, JSON.parse(JSON.stringify(SPACE_KEYS_DEFAULT))); saveSpaceKeys(keys); onChange && onChange(keys); render(); };
  };
  render();
}

/** 조작법 화면: 우주 탐사 */
export function spaceControlsHTML() {
  const keys = loadSpaceKeys();
  const row = (a) => `<div class="key-row"><kbd>${keys[a].map(keyName).join(' / ')}</kbd><span>${SPACE_KEY_LABELS[a]}</span></div>`;
  return `
    <div class="key-group"><h4>${icon('modeSpace', { size: 18 })} 우주 탐사 — 비행</h4>
      ${['pitchDown', 'pitchUp', 'rollLeft', 'rollRight', 'yawLeft', 'yawRight', 'throttleUp', 'throttleDown', 'throttleZero', 'liftUp', 'liftDown', 'brake'].map(row).join('')}
      <div class="key-row"><kbd>마우스 휠</kbd><span>스로틀 미세 조절</span></div>
      <div class="key-row"><kbd>우클릭 드래그</kbd><span>시점 둘러보기</span></div>
    </div>
    <div class="key-group"><h4>${icon('tier5', { size: 18 })} 우주 탐사 — 속도 · 항법</h4>
      ${['tier1', 'tier2', 'tier3', 'tier4', 'tier5', 'tierNext', 'map', 'target', 'align', 'orbit'].map(row).join('')}
    </div>
    <div class="key-group"><h4>${icon('ship', { size: 18 })} 우주 탐사 — 시스템</h4>
      ${['assist', 'gear', 'lights', 'view', 'respawn', 'hud'].map(row).join('')}
      <div class="key-row"><kbd>ESC</kbd><span>일시정지</span></div>
    </div>
    <div class="key-group"><h4>${icon('gamepad', { size: 18 })} 게임패드 (우주 탐사)</h4>
      <div class="key-row"><kbd>왼쪽 스틱</kbd><span>롤 · 피치</span></div>
      <div class="key-row"><kbd>오른쪽 스틱</kbd><span>요 · 수직 추력</span></div>
      <div class="key-row"><kbd>RT / LT</kbd><span>스로틀 증가 / 감소</span></div>
      <div class="key-row"><kbd>A / B</kbd><span>속도 단계 올림 / 내림</span></div>
      <div class="key-row"><kbd>X / Y</kbd><span>관성 보조 / 항법 지도</span></div>
      <div class="key-row"><kbd>LB / RB</kbd><span>시점 / 목표 순환</span></div>
      <div class="key-row"><kbd>방향키 위 / 아래</kbd><span>착륙 장치 / 목표 정렬</span></div>
      <div class="key-row"><kbd>Start</kbd><span>일시정지 · 메뉴에서는 방향키로 이동, A 로 선택, B 로 뒤로</span></div>
    </div>
    <div class="key-group"><h4>${icon('touch', { size: 18 })} 터치</h4>
      <p class="hint">왼쪽 조이스틱으로 피치·롤, 오른쪽 스로틀 막대로 속도, 하단 1~5단계 버튼과 오른쪽 기능 버튼으로 모든 조작이 가능합니다.</p>
    </div>`;
}
