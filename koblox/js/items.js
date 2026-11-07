// 아이템 카탈로그 — 모든 아이템은 데이터로만 정의하고, 모양은 avatar.js 가 만든다.
// slot: 장착 칸, cat: 화면 분류, price: 코벅스 가격(0 = 기본 지급)

export const SLOTS = ['skin', 'head', 'body', 'rleg', 'face', 'shirt', 'pants', 'hat', 'hair', 'faceacc', 'neck', 'back', 'aura', 'anim'];
export const OPTIONAL = new Set(['hat', 'hair', 'faceacc', 'neck', 'back', 'aura']);

const L = [];
const add = (slot, id, name, price, extra = {}) => L.push({ slot, id, name, price, ...extra });

// 피부색
[['skin_yellow', '노랑', '#f5cd30'], ['skin_light', '밝은 살구', '#f2c8a0'], ['skin_tan', '황갈색', '#d39b6a'],
 ['skin_brown', '갈색', '#8d5a3b'], ['skin_dark', '진한 갈색', '#5a3825'], ['skin_white', '흰색', '#f2f2f2'],
 ['skin_gray', '회색', '#a3a3a3'], ['skin_blue', '하늘색', '#7fb8ff'], ['skin_green', '연두', '#8fd16a'],
 ['skin_pink', '분홍', '#ff9ec7'], ['skin_purple', '보라', '#a98bff'], ['skin_black', '검정', '#2a2a2a']]
  .forEach(([id, n, c]) => add('skin', id, n, 0, { color: c }));

// 머리
add('head', 'head_default', '기본 머리', 0, { size: [1.2, 1.2, 1.2] });
add('head', 'head_big', '큰 머리', 50, { size: [1.6, 1.6, 1.6] });
add('head', 'head_small', '작은 머리', 50, { size: [0.9, 0.9, 0.9] });
add('head', 'head_long', '길쭉 머리', 80, { size: [1.1, 1.6, 1.1] });
add('head', 'head_wide', '넓적 머리', 80, { size: [1.7, 1.1, 1.2] });
add('head', 'head_headless', '헤드리스', 31000, { size: [1.2, 1.2, 1.2], headless: true, rare: true });

// 체형
add('body', 'body_normal', '기본 체형', 0, { leg: 1, torso: 1, w: 1 });
add('body', 'body_tall', '키다리', 40, { leg: 1.35, torso: 1.15, w: 0.9 });
add('body', 'body_slim', '날씬이', 40, { leg: 1.1, torso: 1, w: 0.78 });
add('body', 'body_chunky', '튼튼이', 40, { leg: 0.9, torso: 1, w: 1.25 });
add('body', 'body_mini', '꼬마', 60, { leg: 0.6, torso: 0.75, w: 0.9 });

// 오른쪽 다리
add('rleg', 'rleg_default', '기본 다리', 0);
add('rleg', 'rleg_koblox', '코블록스 다리', 17000, { koblox: true, rare: true });
add('rleg', 'rleg_robot', '로봇 다리', 900, { robot: true });

// 얼굴
[['face_smile', '미소', 0], ['face_grin', '활짝 웃음', 0], ['face_wink', '윙크', 20], ['face_cool', '쿨한 얼굴', 40],
 ['face_surprised', '깜짝', 20], ['face_angry', '화남', 30], ['face_hearts', '하트 눈', 60], ['face_sleepy', '졸림', 25],
 ['face_tongue', '메롱', 35], ['face_cat', '고양이 입', 45], ['face_blush', '수줍음', 50], ['face_evil', '악당 미소', 120],
 ['face_stars', '반짝 눈', 200], ['face_cry', '눈물', 40]]
  .forEach(([id, n, p]) => add('face', id, n, p));

// 셔츠 (pattern 은 avatar.js 의 텍스처 그리기 방식)
[['shirt_white', '흰 티셔츠', 0, '#f4f4f4'], ['shirt_red', '빨간 티셔츠', 0, '#d93a3a'], ['shirt_blue', '파란 티셔츠', 0, '#2f6fe4'],
 ['shirt_green', '초록 티셔츠', 0, '#2fae5a'], ['shirt_black', '검은 티셔츠', 0, '#222'],
 ['shirt_logo', '코블록스 티셔츠', 10, '#111', 'logo', '#ff3b5c'], ['shirt_stripes', '줄무늬 티', 30, '#ffffff', 'stripes', '#1f4fbf'],
 ['shirt_check', '체크 남방', 40, '#c0392b', 'check', '#5a1010'], ['shirt_suit', '정장', 120, '#1d2433', 'suit', '#ffffff'],
 ['shirt_santa', '산타 옷', 150, '#d61f26', 'santa', '#ffffff'], ['shirt_rainbow', '무지개 티', 100, '#ff0000', 'rainbow'],
 ['shirt_heart', '하트 티', 60, '#ff8fbf', 'heart', '#e0144c'], ['shirt_star', '별 티', 60, '#1b1f4d', 'star', '#ffd43b'],
 ['shirt_hoodie', '후드티', 80, '#7a7f8c', 'hoodie', '#5b606c'], ['shirt_sport', '축구 유니폼', 70, '#e8202a', 'sport', '#ffffff'],
 ['shirt_camo', '밀리터리', 80, '#4b5a2e', 'camo', '#2f3a1c']]
  .forEach(([id, n, p, c, pat = 'solid', c2 = '#fff']) => add('shirt', id, n, p, { color: c, pattern: pat, color2: c2 }));

// 바지
[['pants_black', '검은 바지', 0, '#222'], ['pants_blue', '파란 바지', 0, '#2c4f9e'], ['pants_gray', '회색 바지', 0, '#6b6f78'],
 ['pants_red', '빨간 바지', 20, '#b52222'], ['pants_white', '흰 바지', 20, '#ececec'], ['pants_jeans', '청바지', 40, '#3d6fb0', 'jeans', '#2a4f80'],
 ['pants_suit', '정장 바지', 100, '#1d2433', 'suit', '#11151f'], ['pants_santa', '산타 바지', 120, '#d61f26', 'santa', '#ffffff'],
 ['pants_camo', '밀리터리 바지', 80, '#4b5a2e', 'camo', '#2f3a1c'], ['pants_green', '초록 바지', 20, '#2b7a3d']]
  .forEach(([id, n, p, c, pat = 'solid', c2 = '#fff']) => add('pants', id, n, p, { color: c, pattern: pat, color2: c2 }));

// 모자
[['hat_cap_red', '빨간 야구모자', 50, 'cap', '#d62a2a'], ['hat_cap_blue', '파란 야구모자', 50, 'cap', '#2a5ad6'],
 ['hat_tophat', '신사 모자', 150, 'tophat', '#151515'], ['hat_crown', '황금 왕관', 1000, 'crown', '#ffc928'],
 ['hat_santa', '산타 모자', 200, 'santa', '#d61f26'], ['hat_beanie', '비니', 60, 'beanie', '#3c8d5a'],
 ['hat_wizard', '마법사 모자', 250, 'wizard', '#4a2a9c'], ['hat_bunny', '토끼 귀', 180, 'bunny', '#ffffff'],
 ['hat_cat', '고양이 귀', 150, 'catears', '#ff9a3c'], ['hat_horns', '악마 뿔', 400, 'horns', '#b5121b'],
 ['hat_halo', '천사 고리', 800, 'halo', '#ffe680'], ['hat_headphones', '헤드폰', 120, 'headphones', '#222'],
 ['hat_cowboy', '카우보이 모자', 130, 'cowboy', '#8a5a2b'], ['hat_cone', '고깔 콘', 75, 'cone', '#ff7a1a'],
 ['hat_valk', '날개 투구', 2500, 'valk', '#dfe6ee'], ['hat_dom', '어둠의 왕관', 9999, 'dom', '#1a1a2e']]
  .forEach(([id, n, p, kind, c]) => add('hat', id, n, p, { kind, color: c, rare: p >= 2500 }));

// 헤어
[['hair_short_brown', '짧은 갈색 머리', 0, 'short', '#5b3a21'], ['hair_short_black', '짧은 검은 머리', 0, 'short', '#151515'],
 ['hair_long_brown', '긴 갈색 머리', 40, 'long', '#6b4226'], ['hair_pony_blonde', '금발 포니테일', 60, 'pony', '#f1cc5a'],
 ['hair_spiky_orange', '삐죽 주황 머리', 70, 'spiky', '#ff7a1a'], ['hair_afro', '아프로', 80, 'afro', '#1d1d1d'],
 ['hair_bob_pink', '분홍 단발', 90, 'bob', '#ff7eb6'], ['hair_spiky_blue', '삐죽 파란 머리', 70, 'spiky', '#3a7bff'],
 ['hair_long_white', '긴 흰 머리', 120, 'long', '#f0f0f0']]
  .forEach(([id, n, p, kind, c]) => add('hair', id, n, p, { kind, color: c }));

// 얼굴 장신구
[['fa_sunglasses', '선글라스', 40, 'sunglasses', '#111'], ['fa_glasses', '동그란 안경', 30, 'glasses', '#333'],
 ['fa_mask', '마스크', 25, 'mask', '#f2f2f2'], ['fa_eyepatch', '해적 안대', 35, 'eyepatch', '#111'],
 ['fa_mustache', '콧수염', 20, 'mustache', '#3a2412'], ['fa_visor', '사이버 바이저', 90, 'visor', '#28e0ff']]
  .forEach(([id, n, p, kind, c]) => add('faceacc', id, n, p, { kind, color: c }));

// 목
[['neck_scarf_red', '빨간 목도리', 60, 'scarf', '#d61f26'], ['neck_scarf_snow', '눈꽃 목도리', 80, 'scarf', '#f4f4f4'],
 ['neck_bowtie', '나비넥타이', 40, 'bowtie', '#c4161c'], ['neck_chain', '금 목걸이', 300, 'chain', '#ffcc33']]
  .forEach(([id, n, p, kind, c]) => add('neck', id, n, p, { kind, color: c }));

// 등
[['back_angel', '천사 날개', 500, 'angel', '#ffffff'], ['back_bat', '박쥐 날개', 450, 'bat', '#2a1636'],
 ['back_cape', '빨간 망토', 200, 'cape', '#c4161c'], ['back_backpack', '배낭', 90, 'backpack', '#2f6fe4'],
 ['back_sword', '등에 멘 검', 250, 'sword', '#cfd8e3'], ['back_jetpack', '제트팩', 350, 'jetpack', '#8a96a8'],
 ['back_butterfly', '나비 날개', 400, 'butterfly', '#a35cff']]
  .forEach(([id, n, p, kind, c]) => add('back', id, n, p, { kind, color: c }));

// 이펙트
[['aura_sparkle', '반짝이 오라', 150, '#fff6a0'], ['aura_fire', '불꽃 오라', 300, '#ff6a1a'], ['aura_bubble', '비눗방울 오라', 120, '#9fe3ff'],
 ['aura_heart', '하트 오라', 200, '#ff4f8b']]
  .forEach(([id, n, p, c]) => add('aura', id, n, p, { color: c }));

// 애니메이션
[['anim_default', '기본 애니메이션', 0], ['anim_robot', '로봇 애니메이션', 100], ['anim_ninja', '닌자 애니메이션', 150],
 ['anim_zombie', '좀비 애니메이션', 120], ['anim_stylish', '스타일리시 애니메이션', 130]]
  .forEach(([id, n, p]) => add('anim', id, n, p));

// 감정 표현 (장착하지 않고 보유만 하면 게임에서 사용)
[['emote_wave', '손 흔들기', 0], ['emote_point', '가리키기', 0], ['emote_cheer', '환호', 0], ['emote_dance', '신나는 춤', 50],
 ['emote_sit', '앉기', 30], ['emote_spin', '빙글빙글', 80], ['emote_flex', '근육 자랑', 60]]
  .forEach(([id, n, p]) => add('emote', id, n, p));

// 장비 (보유하면 게임 속 가방(핫바)에 들어간다)
[['gear_sword', '클래식 검', 150, '휘둘러서 블록을 부숴요.'], ['gear_gravity', '중력 코일', 300, '들고 있으면 몸이 가벼워져 높이 뛰어요.'],
 ['gear_speed', '스피드 코일', 250, '들고 있으면 두 배로 빨리 달려요.'], ['gear_rocket', '로켓 발사기', 600, '로켓을 쏴서 날아오르거나 블록을 부숴요.'],
 ['gear_builder', '블록 빌더', 200, '화면을 눌러 블록을 쌓아요.'], ['gear_balloon', '빨간 풍선', 120, '들고 있으면 천천히 떨어져요.']]
  .forEach(([id, n, p, d]) => add('gear', id, n, p, { desc: d }));

export const ITEMS = L;
export const ITEM = Object.fromEntries(L.map(i => [i.id, i]));

export const DEFAULT_EQUIP = {
  skin: 'skin_yellow', head: 'head_default', body: 'body_normal', rleg: 'rleg_default', face: 'face_smile',
  shirt: 'shirt_blue', pants: 'pants_black', hat: null, hair: 'hair_short_brown', faceacc: null, neck: null,
  back: null, aura: null, anim: 'anim_default',
};

// 화면 분류
export const CATS = [
  { id: 'body', name: '신체', subs: [['skin', '피부색'], ['head', '머리'], ['face', '얼굴'], ['body', '체형'], ['rleg', '다리']] },
  { id: 'cloth', name: '복장', subs: [['shirt', '셔츠'], ['pants', '바지']] },
  { id: 'acc', name: '장신구', subs: [['hat', '모자'], ['hair', '헤어'], ['faceacc', '얼굴'], ['neck', '목'], ['back', '등'], ['aura', '이펙트']] },
  { id: 'anim', name: '애니메이션', subs: [['anim', '애니메이션']] },
  { id: 'emote', name: '감정 표현', subs: [['emote', '감정 표현']] },
  { id: 'gear', name: '장비', subs: [['gear', '장비']] },
];

export const CREATORS = ['Koblox', 'BlockMaker', 'K-Studio', 'PixelHan', 'Hangul_Dev', 'Koblox'];
export const creatorOf = it => CREATORS[(it.id.length + it.price) % CREATORS.length];

// 배지 (게임 속 행동으로 얻는다)
export const BADGES = [
  { id: 'welcome', name: 'Test 첫 방문', desc: 'Test 에 처음 들어왔어요.', color: '#3b82ff' },
  { id: 'jumper', name: '점프 마스터', desc: '점프를 100번 했어요.', color: '#22c55e' },
  { id: 'sky', name: '하늘 높이', desc: '높이 50 스터드까지 올라갔어요.', color: '#38bdf8' },
  { id: 'dancer', name: '첫 감정 표현', desc: '게임에서 감정 표현을 했어요.', color: '#f472b6' },
  { id: 'oops', name: '앗 부서졌다', desc: '캐릭터가 10번 부서졌어요.', color: '#ef4444' },
  { id: 'builder', name: '건축가', desc: '블록 빌더로 블록을 50개 쌓았어요.', color: '#f59e0b' },
  { id: 'boom', name: '로켓 점프', desc: '로켓 폭발로 날아올랐어요.', color: '#fb923c' },
  { id: 'creator', name: '크리에이터', desc: '스튜디오에서 체험을 처음 게시했어요.', color: '#a855f7' },
  { id: 'coin', name: '반짝반짝', desc: '코인을 처음 주웠어요.', color: '#facc15' },
  { id: 'finish', name: '완주', desc: '체크포인트를 5개 지났어요.', color: '#14b8a6' },
  { id: 'shopper', name: '첫 쇼핑', desc: '마켓플레이스에서 아이템을 처음 샀어요.', color: '#ec4899' },
  { id: 'rich', name: '코벅스 부자', desc: '코벅스를 100,000 개 모았어요.', color: '#eab308' },
];
