// 역할 정의 (서버/클라이언트 공용) — 최신 원작(v19.0.0, 2026-09) 기준 13개 역할
// opts 형식: [키, 라벨, 종류(i 정수/f 실수/b 켬끔), 최소, 최대, 간격, 기본값, 단위, 그룹, 0일 때 표시]
// 설정 저장: settings.roleSet = { [role]: { max, chance, ...opts } }

const CREW = '#8CFFFF', IMP = '#FF1919';

export const ROLE_DEFS = {
  crewmate: { team: 'crew', name: '크루원', en: 'Crewmate', color: CREW, accent: '#8CFFFF', icon: '🧑‍🚀',
    blurb: '임무를 수행하세요', desc: '임무를 모두 끝내거나 임포스터를 찾아 방출하세요.' },
  impostor: { team: 'impostor', name: '임포스터', en: 'Impostor', color: IMP, accent: '#FF1919', icon: '🔪',
    blurb: '처치 및 방해 공작', desc: '들키지 않게 크루원을 처치하세요. 환풍구와 방해 공작을 쓸 수 있습니다.' },

  // ---- 크루원 역할 ----
  engineer: { team: 'crew', name: '기술자', alias: '엔지니어', en: 'Engineer', color: CREW, accent: '#F5A623', icon: '🔧',
    blurb: '환풍구로 이동 가능', desc: '임포스터처럼 환풍구에 들어가 연결된 환풍구로 이동할 수 있습니다. 환풍구 안에 머무를 수 있는 시간이 정해져 있습니다.',
    ability: { id: 'vent', label: '환풍구', offLabel: '나가기', icon: '🕳️', kind: 'toggle', cdKey: 'ventCooldown', durKey: 'ventMaxTime' },
    opts: [['ventCooldown', '환풍구 사용 쿨다운', 'f', 5, 60, 5, 30, '초'], ['ventMaxTime', '환풍구에서 머무를 수 있는 최대 시간', 'f', 0, 60, 5, 15, '초', null, '무제한']] },
  scientist: { team: 'crew', name: '과학자', en: 'Scientist', color: CREW, accent: '#45D7F0', icon: '🧪',
    blurb: '언제든 바이탈 모니터에 접근 가능', desc: '어디서든 휴대용 바이탈 모니터를 열 수 있습니다. 배터리는 열어 둔 동안 닳고, 임무를 완료하면 충전됩니다.',
    ability: { id: 'vitals', label: '바이탈', icon: '💓', kind: 'toggle', cdKey: 'vitalsCooldown', durKey: 'batteryDuration' },
    opts: [['vitalsCooldown', '바이탈 체크 표시 쿨다운', 'f', 5, 60, 5, 15, '초'], ['batteryDuration', '배터리 지속 시간', 'f', 5, 30, 5, 5, '초']] },
  tracker: { team: 'crew', name: '추적자', en: 'Tracker', color: CREW, accent: '#3FD07A', icon: '📡',
    blurb: '지도로 크루원 추적 가능', desc: '가까운 플레이어에게 추적기를 붙이면 일정 시간 동안 지도에서 그 플레이어의 위치를 볼 수 있습니다.',
    ability: { id: 'track', label: '추적', offLabel: '추적 해제', icon: '📡', kind: 'toggle', target: true, cdKey: 'trackCooldown', durKey: 'trackDuration' },
    opts: [['trackCooldown', '추적 쿨다운', 'f', 10, 120, 5, 15, '초'], ['trackDuration', '추적 효과 지속 시간', 'f', 10, 120, 5, 30, '초'], ['trackDelay', '추적 지연', 'i', 0, 3, 1, 1, '초', null, '실시간']] },
  noisemaker: { team: 'crew', name: '노이즈 메이커', alias: '소음 유발자', en: 'Noisemaker', color: CREW, accent: '#FF6FB5', icon: '📢',
    blurb: '사망 시 알림 보내기', desc: '처치당하면 모두에게 시체 위치를 알리는 경보가 울립니다. (방출되거나 통신 방해 중이면 울리지 않습니다)',
    opts: [['impostorAlert', '임포스터 알림 받기', 'b', 0, 1, 1, 1], ['alertDuration', '알림 기간', 'i', 1, 15, 1, 10, '초']] },
  detective: { team: 'crew', name: '탐정', en: 'Detective', color: CREW, accent: '#C8A165', icon: '🕵️',
    blurb: '용의자를 심문해 사건 해결하기', desc: '시체가 신고되면 사건 파일이 생깁니다. 플레이어를 심문하면 그 사람이 사망 시각에 실제로 어디 있었는지 노트에 기록됩니다.',
    ability: { id: 'interrogate', label: '심문', icon: '🔍', kind: 'once', target: true },
    ability2: { id: 'notes', label: '노트', icon: '📓', kind: 'panel' },
    abilities: [{ id: 'notes', label: '노트', icon: '📓', kind: 'panel' }, { id: 'interrogate', label: '심문', icon: '🔍', kind: 'once', target: true }],
    opts: [['suspectLimit', '사건당 용의자 수', 'i', 2, 4, 1, 3, '명']] },
  judge: { team: 'crew', name: '판사', en: 'Judge', color: CREW, accent: '#B784F5', icon: '⚖️',
    blurb: '한 번의 판결로 투표 뒤집기', desc: '임무를 일정 비율 끝내면 기각 능력이 열립니다. 회의 중 한 번, 지목한 사람이 임포스터면 그 사람이, 아니면 판사 자신이 방출됩니다.',
    ability: { id: 'overrule', label: '기각', icon: '⚖️', kind: 'meeting', target: true, once: true },
    opts: [['taskPercent', '기각 해금에 필요한 임무 비율', 'i', 0, 100, 10, 50, '%']] },
  guardian: { team: 'crew', name: '수호천사', en: 'Guardian Angel', color: CREW, accent: '#FFE27A', icon: '😇', ghost: true,
    blurb: '크루원을 보호하세요', desc: '유령이 되면 배정될 수 있습니다. 살아있는 플레이어에게 보호막을 씌워 한 번의 처치를 막습니다.',
    ability: { id: 'protect', label: '보호', icon: '🛡️', kind: 'once', target: true, cdKey: 'protectCooldown', durKey: 'protectDuration' },
    opts: [['protectCooldown', '보호 쿨다운', 'f', 35, 120, 5, 60, '초'], ['protectDuration', '보호 지속 시간', 'f', 5, 30, 5, 10, '초'], ['protectVisible', '임포스터에게 보호 표시', 'b', 0, 1, 1, 0]] },
  influencer: { team: 'crew', name: '인플루언서', en: 'Influencer', color: CREW, accent: '#FF9DE2', icon: '🔮', ghost: true,
    blurb: '그림 메시지로 크루원 돕기', desc: '유령이 되면 배정될 수 있습니다. 살아있는 플레이어 근처에서 그림 6개 중 최대 3개를 골라 메시지로 보냅니다.',
    ability: { id: 'message', label: '메시지', icon: '💬', kind: 'panel', target: true, cdKey: 'messageCooldown' },
    opts: [['messageCooldown', '메시지 쿨다운', 'f', 10, 60, 5, 20, '초']] },

  // ---- 임포스터 역할 ----
  shapeshifter: { team: 'impostor', name: '형상 변환자', alias: '변신술사', en: 'Shapeshifter', color: IMP, accent: '#E0503A', icon: '🎭',
    blurb: '다른 플레이어로 변신', desc: '다른 플레이어의 모습과 이름으로 변신합니다. 지속 시간이 끝나거나 변신 해제를 누르면 돌아옵니다.',
    ability: { id: 'shift', label: '변신', offLabel: '변신 해제', icon: '🎭', kind: 'toggle', target: true, pick: true, cdKey: 'shiftCooldown', durKey: 'shiftDuration' },
    opts: [['shiftDuration', '형상 변환 지속 시간', 'f', 0, 30, 5, 30, '초', null, '무제한'], ['shiftCooldown', '형상 변환 쿨다운', 'f', 5, 90, 5, 10, '초'], ['leaveEvidence', '형상 변환 증거 남기기', 'b', 0, 1, 1, 1]] },
  phantom: { team: 'impostor', name: '팬텀', en: 'Phantom', color: IMP, accent: '#9A6BFF', icon: '👻',
    blurb: '투명 상태로 변신', desc: '살아있는 크루원에게 보이지 않게 됩니다. 사라진 동안에는 처치·신고·임무를 할 수 없습니다.',
    ability: { id: 'vanish', label: '사라지기', offLabel: '나타나기', icon: '👻', kind: 'toggle', cdKey: 'vanishCooldown', durKey: 'vanishDuration' },
    opts: [['vanishDuration', '사라짐 효과 지속 기간', 'f', 10, 90, 10, 30, '초'], ['vanishCooldown', '사라짐 쿨다운', 'f', 5, 60, 5, 15, '초']] },
  viper: { team: 'impostor', name: '바이퍼', en: 'Viper', color: IMP, accent: '#7CE03A', icon: '🐍',
    blurb: '처치 후 시체 용해하기', desc: '처치 대신 산을 뿌립니다. 시체는 3단계에 걸쳐 녹아 사라지며, 다 녹은 시체는 신고할 수 없습니다.',
    ability: { id: 'acid', label: '산', icon: '🧪', kind: 'kill', target: true, replacesKill: true },
    opts: [['dissolveTime', '용해 시간', 'f', 5, 60, 5, 15, '초']] },
};

// 역할 설정 화면에 보이는 순서 (크루원 역할 → 유령 역할 → 임포스터 역할)
export const ROLE_ORDER = ['engineer', 'scientist', 'tracker', 'noisemaker', 'detective', 'judge', 'guardian', 'influencer', 'shapeshifter', 'phantom', 'viper'];
export const roleTeam = r => ROLE_DEFS[r]?.team || 'crew';
export const isImpRole = r => roleTeam(r) === 'impostor';
export const isGhostRole = r => !!ROLE_DEFS[r]?.ghost;
export const roleName = r => ROLE_DEFS[r]?.name || r;
export const CREW_ROLES = ROLE_ORDER.filter(r => !isImpRole(r));
export const IMP_ROLES = ROLE_ORDER.filter(isImpRole);
export const GHOST_ROLES = ROLE_ORDER.filter(isGhostRole);
// 역할 수·확률 범위 [최소, 최대, 간격]
export const ROLE_SET_RANGE = { max: [0, 15, 1], chance: [0, 100, 10], impMax: [0, 3, 1] };

export function defaultRoleSet() {
  const o = {};
  for (const r of ROLE_ORDER) {
    o[r] = { max: 0, chance: 0 };
    for (const d of ROLE_DEFS[r].opts || []) o[r][d[0]] = d[6];
  }
  return o;
}
// "다양한 역할" 프리셋: 추적자·기술자·과학자·수호천사·형상 변환자·팬텀 각 1명 100%
export const ROLES_GALORE = ['tracker', 'engineer', 'scientist', 'guardian', 'shapeshifter', 'phantom'];
export const roleOn = (rs, r) => !!rs?.[r] && rs[r].max > 0 && rs[r].chance > 0;
// 역할 옵션 값 (없으면 기본값)
export function roleOpt(settings, role, key) {
  const v = settings?.roleSet?.[role]?.[key];
  if (v !== undefined && v !== null) return v;
  const d = ROLE_DEFS[role]?.opts?.find(o => o[0] === key);
  return d ? d[6] : 0;
}

// 탐정 노트: 범인 추측 항목
export const DETECTIVE_GUESS = [['impostor', '임포스터'], ['shapeshifter', '형상 변환자'], ['phantom', '팬텀'], ['viper', '바이퍼']];
export const DETECTIVE_PREP = [['by', '에게'], ['in', '에서'], ['maybe', '아마도']];

// 인플루언서 메시지 그림 (6개가 무작위로 나오고 최대 3개 전송). id 는 클라이언트 그림(panels.js INFLUENCE)과 같다.
export const INFLUENCER_IMAGES = [
  { id: 'c_red', icon: '🔴', label: '빨강 계열' }, { id: 'c_blue', icon: '🔵', label: '파랑 계열' }, { id: 'c_green', icon: '🟢', label: '초록 계열' },
  { id: 'c_yellow', icon: '🟡', label: '노랑 계열' }, { id: 'c_pink', icon: '🟣', label: '분홍·보라 계열' }, { id: 'c_bw', icon: '⚫', label: '검정·하양 계열' },
  { id: 'up', icon: '⬆️', label: '위쪽' }, { id: 'down', icon: '⬇️', label: '아래쪽' }, { id: 'left', icon: '⬅️', label: '왼쪽' }, { id: 'right', icon: '➡️', label: '오른쪽' },
  { id: 'vitals', icon: '💓', label: '바이탈' }, { id: 'bulb', icon: '💡', label: '조명' }, { id: 'vent', icon: '🕳️', label: '환풍구' }, { id: 'knife', icon: '🔪', label: '처치' },
  { id: 'eye', icon: '👁️', label: '목격' }, { id: 'question', icon: '❓', label: '모르겠음' }, { id: 'skull', icon: '💀', label: '시체' }, { id: 'shield', icon: '🛡️', label: '보호' },
  { id: 'cam', icon: '📹', label: '카메라' }, { id: 'admin', icon: '🗺️', label: '관리실' }, { id: 'meeting', icon: '📢', label: '회의' }, { id: 'task', icon: '📋', label: '임무' },
  { id: 'check', icon: '✅', label: '안전' }, { id: 'cross', icon: '❌', label: '수상함' }, { id: 'door', icon: '🚪', label: '문' }, { id: 'ladder', icon: '🪜', label: '사다리' },
  { id: 'clock', icon: '⏰', label: '시간' },
];
// wheel: 한 번에 보이는 그림 수, maxSend: 최대 전송 수, refreshes: 새로고침 횟수(보내기 쿨다운 = 메시지 쿨다운의 절반), showMs: 받는 쪽 표시 시간
export const INFLUENCER = { wheel: 6, maxSend: 3, refreshes: 1, showMs: 4000 };
