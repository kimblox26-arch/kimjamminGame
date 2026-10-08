// 해랑시 쓰나미 — 공용 상수 · 품질 프리셋 · 구(區) · 감정 · 인물 정의

export const WORLD = 4000;          // 시뮬레이션 영역 한 변 (m)
export const HALF = WORLD / 2;
export const G = 9.81;
export const SAFE_ELEV = 18;        // 이 고도(m) 이상의 땅은 안전 지대

export const QUALITY = {
  low:    { label: '낮음',   sim: 192, terrain: 257, people: 240, shadow: 0,    particles: 1800, pr: 1.0, trees: 1400, landuse: 2048 },
  medium: { label: '보통',   sim: 256, terrain: 385, people: 420, shadow: 2048, particles: 3500, pr: 1.5, trees: 2600, landuse: 2048 },
  high:   { label: '높음',   sim: 320, terrain: 513, people: 600, shadow: 2048, particles: 5000, pr: 2.0, trees: 3600, landuse: 4096, bloom: true },
  ultra:  { label: '울트라', sim: 384, terrain: 641, people: 800, shadow: 4096, particles: 7000, pr: 2.0, trees: 4800, landuse: 4096, bloom: true },
};

export const DISTRICTS = [
  { id: 0, name: '항구구',   color: '#e8a548', desc: '창고 · 컨테이너 부두 · 어선' },
  { id: 1, name: '강변구',   color: '#55b6e0', desc: '강을 따라 늘어선 주택가 · 학교' },
  { id: 2, name: '해변구',   color: '#f2d064', desc: '해수욕장 · 호텔 · 상점가' },
  { id: 3, name: '중앙구',   color: '#e0728f', desc: '고층 빌딩 · 아파트 단지' },
  { id: 4, name: '등대곶구', color: '#86d47f', desc: '등대 · 어촌 마을 · 해안 절벽' },
  { id: 5, name: '산마루구', color: '#a98fe0', desc: '고지대 · 지정 대피소' },
];

export const EMOTIONS = {
  calm:       { name: '평온',     emoji: '🙂', color: '#5ed67d' },
  curious:    { name: '호기심',   emoji: '🤔', color: '#43d3c6' },
  confused:   { name: '당황',     emoji: '😕', color: '#e6d85a' },
  anxious:    { name: '불안',     emoji: '😟', color: '#f2b14a' },
  fear:       { name: '공포',     emoji: '😨', color: '#f2793a' },
  panic:      { name: '패닉',     emoji: '😱', color: '#ff3b3b' },
  determined: { name: '결연',     emoji: '😤', color: '#4d9dff' },
  frozen:     { name: '얼어붙음', emoji: '😶', color: '#c8c8c8' },
  struggle:   { name: '허우적',   emoji: '🆘', color: '#c24bff' },
  relief:     { name: '안도',     emoji: '😮‍💨', color: '#7fd0ff' },
  sad:        { name: '슬픔',     emoji: '😢', color: '#8088ee' },
};

export const PERSON_TYPES = {
  child: { name: '어린이',    h: [1.05, 1.38], walk: 1.05, run: 3.1, dv: 0.22, mass: 25 },
  teen:  { name: '청소년',    h: [1.52, 1.78], walk: 1.35, run: 5.3, dv: 0.5,  mass: 55 },
  man:   { name: '성인 남성', h: [1.66, 1.88], walk: 1.4,  run: 5.4, dv: 0.65, mass: 75 },
  woman: { name: '성인 여성', h: [1.54, 1.72], walk: 1.3,  run: 4.6, dv: 0.5,  mass: 60 },
  elder: { name: '노인',      h: [1.48, 1.72], walk: 0.8,  run: 1.6, dv: 0.3,  mass: 60 },
};

export const SURNAMES = '김이박최정강조윤장임한오서신권황안송류홍전고문양손배백허유남심노하곽성차주우구민진나'.split('');
export const GIVEN = '민서지현준우은하도윤예수진영호연아재태성유혜동소주희경상정미나리건율빈채원시온결찬규혁슬'.split('');

// 상황별 대사 (감정 · 역할)
export const LINES = {
  calm: ['날씨 좋다~', '점심 뭐 먹지?', '바다 예쁘다', '사진 찍어야지', '오늘 손님 많네', '산책하기 딱 좋네'],
  quake: ['지진이다!', '방금 흔들렸어?', '머리 숙여!', '건물에서 떨어져!'],
  confused: ['괜찮은 건가...', '뭔가 이상해', '무슨 일이야?', '방송 나오나?'],
  curious: ['어? 바닷물이 빠지네?', '물고기가 다 보여!', '저게 뭐지?', '영상 찍자!'],
  warned: ['쓰나미 경보래!', '높은 곳으로 가야 해!', '빨리 대피하자!', '재난문자 봤어?'],
  fear: ['저기 파도가!', '도망쳐!!', '물이 들어온다!', '뛰어!!'],
  panic: ['살려주세요!!', '으아아악!', '어디로 가야 돼?!', '안 돼!!'],
  helper: ['제 손 잡으세요!', '제가 도와드릴게요!', '아이 먼저!', '조금만 더 힘내세요!'],
  child: ['엄마!!', '무서워...', '아빠 어디 있어?', '같이 가!'],
  elder: ['아이고...', '다리가...', '먼저들 가게', '천천히...'],
  swept: ['도와줘요!', '잡을 게 없어!', '숨이...', '여기요!!'],
  relief: ['살았다...', '휴...', '다들 괜찮아?', '여기면 안전해'],
  sad: ['우리 집이...', '가족이 안 보여...', '어떡해...', '저 사람들...'],
  roof: ['여기요! 사람 있어요!', '구조해 주세요!', '물이 계속 차올라!'],
  frozen: ['...', '움직일 수가 없어', '말도 안 돼...'],
  anxious: ['괜찮을까...', '불안해...', '빨리 가야 하는데', '가족한테 연락해야 해', '무슨 일이 생긴 거야?'],
};

export const SOURCE_TYPES = {
  quake:     { name: '해저 지진',   icon: '🌋', desc: '단층 융기·침강 — 먼저 바닷물이 빠진 뒤 큰 파도가 온다' },
  landslide: { name: '해저 산사태', icon: '⛰️', desc: '국지적이지만 매우 높은 파도' },
  impact:    { name: '운석 충돌',   icon: '☄️', desc: '거대한 물기둥과 동심원 파동' },
  plane:     { name: '원거리 해일', icon: '🌊', desc: '해안과 나란한 긴 파봉이 밀려온다' },
};
