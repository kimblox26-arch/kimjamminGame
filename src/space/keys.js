// FREE FREELY 우주 탐사 - 키 배치 (설정 화면에서 변경 가능, localStorage 저장)

/** 우주 탐사 기본 키 배치 (설정에서 변경 가능) */
export const SPACE_KEYS_DEFAULT = {
  pitchUp: ['KeyS', 'ArrowDown'], pitchDown: ['KeyW', 'ArrowUp'], rollLeft: ['KeyA', 'ArrowLeft'], rollRight: ['KeyD', 'ArrowRight'],
  yawLeft: ['KeyQ'], yawRight: ['KeyE'], throttleUp: ['ShiftLeft', 'ShiftRight'], throttleDown: ['ControlLeft', 'ControlRight'],
  throttleZero: ['KeyX'], liftUp: ['KeyR'], liftDown: ['KeyF'], brake: ['KeyB'],
  tier1: ['Digit1'], tier2: ['Digit2'], tier3: ['Digit3'], tier4: ['Digit4'], tier5: ['Digit5'], tierNext: ['Tab'],
  assist: ['KeyZ'], gear: ['KeyG'], lights: ['KeyL'], view: ['KeyC'], map: ['KeyM'], target: ['KeyT'], align: ['KeyH'],
  orbit: ['KeyO'], respawn: ['KeyK'], hud: ['F2'],
};
export const SPACE_KEY_LABELS = {
  pitchUp: '기수 올림', pitchDown: '기수 내림', rollLeft: '왼쪽 롤', rollRight: '오른쪽 롤', yawLeft: '왼쪽 요', yawRight: '오른쪽 요',
  throttleUp: '스로틀 증가', throttleDown: '스로틀 감소', throttleZero: '스로틀 0', liftUp: '수직 상승 추력', liftDown: '수직 하강 추력', brake: '역추진 제동',
  tier1: '속도 1단계', tier2: '속도 2단계', tier3: '속도 3단계', tier4: '속도 4단계 (광속)', tier5: '속도 5단계 (은하간)', tierNext: '다음 속도 단계',
  assist: '관성 보조 켜기/끄기', gear: '착륙 장치', lights: '조명', view: '시점 전환', map: '항법 지도', target: '목표 순환', align: '목표 방향 정렬',
  orbit: '궤도 예측선', respawn: '리스폰', hud: 'HUD 표시',
};

export function keyName(code) {
  if (!code) return '-';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map = { ShiftLeft: 'Shift', ShiftRight: 'Shift(R)', ControlLeft: 'Ctrl', ControlRight: 'Ctrl(R)', ArrowUp: '위 방향키', ArrowDown: '아래 방향키', ArrowLeft: '왼 방향키', ArrowRight: '오른 방향키', Space: 'Space', Tab: 'Tab', Escape: 'ESC', Backquote: '`' };
  return map[code] || code;
}

export function loadSpaceKeys() {
  const k = JSON.parse(JSON.stringify(SPACE_KEYS_DEFAULT));
  try { const s = JSON.parse(localStorage.getItem('freefreely.spacekeys') || 'null'); if (s) Object.assign(k, s); } catch (e) { /* 무시 */ }
  return k;
}
export function saveSpaceKeys(k) { try { localStorage.setItem('freefreely.spacekeys', JSON.stringify(k)); } catch (e) { /* 무시 */ } }

