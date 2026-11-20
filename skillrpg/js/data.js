// ───────── 등급 · 상자 · 스킬 · 장비 데이터 ─────────
const RAR = [
  { name: '일반', color: '#c8c8d0', dark: '#5e5e6e' },
  { name: '희귀', color: '#4aa8ff', dark: '#1d5aa8' },
  { name: '에픽', color: '#b45cff', dark: '#6522a8' },
  { name: '고급', color: '#ff5a3c', dark: '#a8261a' },
  { name: '전설', color: '#ffd23f', dark: '#b8860b' },
  { name: '신화', color: '#ff5ad9', dark: '#8a1f7a' },
];

// 5000 상자는 합계가 105%라서 희귀 40% → 35% 로 조정
const BOXES = [
  { tier: 0, name: '나무 상자', cost: 100, rates: [60, 35, 5, 0, 0, 0] },
  { tier: 1, name: '강철 상자', cost: 300, rates: [35, 45, 19, 1, 0, 0] },
  { tier: 2, name: '황금 상자', cost: 1000, rates: [35, 30, 20, 10, 5, 0] },
  { tier: 3, name: '신화 상자', cost: 5000, rates: [0, 35, 30, 20, 10, 5] },
];

const SKILLS = [
  { id: 'attack', name: '일반 공격', r: 0, basic: true, dmg: 40, hits: 1, cd: 0.5, desc: '검을 들고 순식간에 돌진해 베어낸다' },
  { id: 'critical', name: '크리티컬 공격', r: 3, basic: true, dmg: 75, hits: 1, cd: 2.5, desc: '힘을 모아 반드시 치명타가 터지는 X자 베기' },
  { id: 'fireball', name: '파이어볼', r: 0, dmg: 60, hits: 1, cd: 1.2, desc: '불꽃 구체를 날려 폭발시킨다' },
  { id: 'iceshard', name: '아이스 샤드', r: 0, dmg: 22, hits: 3, cd: 1.4, desc: '얼음 파편 3발을 연속으로 쏜다' },
  { id: 'rock', name: '바위 투척', r: 0, dmg: 75, hits: 1, cd: 1.8, desc: '커다란 바위를 포물선으로 던진다' },
  { id: 'windslash', name: '바람 베기', r: 0, dmg: 55, hits: 1, cd: 1.0, desc: '초승달 모양의 칼바람을 날린다' },
  { id: 'chain', name: '체인 라이트닝', r: 1, dmg: 50, hits: 3, cd: 2.5, desc: '번개가 세 방향에서 연쇄 타격한다' },
  { id: 'poison', name: '독안개', r: 1, dmg: 24, hits: 8, cd: 3.5, desc: '독병을 던져 지속 피해를 준다' },
  { id: 'daggers', name: '그림자 단검', r: 1, dmg: 32, hits: 5, cd: 2.6, desc: '그림자 단검 5자루가 날아간다' },
  { id: 'pillar', name: '화염 기둥', r: 1, dmg: 42, hits: 4, cd: 3.0, desc: '땅속에서 거대한 불기둥이 솟는다' },
  { id: 'meteor', name: '메테오', r: 2, dmg: 440, hits: 1, cd: 5.0, desc: '하늘에서 불타는 운석을 떨어뜨린다' },
  { id: 'blizzard', name: '블리자드', r: 2, dmg: 46, hits: 10, cd: 5.0, desc: '눈보라와 얼음 가시로 적을 얼린다' },
  { id: 'storm', name: '썬더 스톰', r: 2, dmg: 92, hits: 5, cd: 5.0, desc: '먹구름을 불러 낙뢰 5연타' },
  { id: 'dragon', name: '드래곤 브레스', r: 3, dmg: 48, hits: 16, cd: 6.0, desc: '용의 혼을 불러 화염을 뿜는다' },
  { id: 'blackhole', name: '블랙홀', r: 3, dmg: 55, hits: 11, cd: 7.0, desc: '모든 것을 빨아들인 뒤 붕괴한다' },
  { id: 'holysword', name: '천상의 성검', r: 4, dmg: 1500, hits: 1, cd: 8.0, desc: '하늘에서 거대한 성검이 내리꽂힌다' },
  { id: 'phoenix', name: '불사조', r: 4, dmg: 230, hits: 6, cd: 8.0, desc: '불사조가 하늘을 돌아 적을 관통한다' },
  { id: 'omega', name: '오메가 캐논', r: 5, dmg: 250, hits: 14, cd: 10.0, desc: '우주를 가르는 궁극의 빛줄기' },
  { id: 'timestop', name: '시간 정지', r: 5, dmg: 300, hits: 12, cd: 12.0, desc: '시간을 멈추고 수없이 베어낸다' },
];
const GACHA_SKILLS = SKILLS.filter(s => !s.basic);
const rarName = sk => sk.basic ? '기본' : RAR[sk.r].name;
const SKILL_BY_ID = Object.fromEntries(SKILLS.map(s => [s.id, s]));

const SLOTS = ['face', 'body', 'head', 'weapon', 'acc'];
const SLOT_NAME = { face: '얼굴', body: '의상', head: '모자', weapon: '무기', acc: '장식' };
const GEAR_DEF = {
  face: { stat: '보석 획득', vals: [5, 10, 16, 25, 40, 60], names: ['갈색 단발', '검은 바가지머리', '금발 포니테일', '은발 긴머리', '불꽃 머리', '별빛 머리'] },
  body: { stat: '공격력', vals: [5, 12, 22, 35, 55, 80], names: ['천 튜닉', '가죽 갑옷', '미스릴 사슬갑옷', '용비늘 갑옷', '성기사 판금갑옷', '은하 로브'] },
  head: { stat: '치명타', vals: [3, 6, 10, 15, 22, 30], names: ['천 두건', '강철 투구', '마법사 모자', '뿔 투구', '황금 왕관', '별빛 후광관'] },
  weapon: { stat: '치명타 피해', vals: [10, 20, 35, 50, 75, 100], names: ['목검', '강철 검', '마법 지팡이', '용의 창', '황금 성검', '별빛 지팡이'] },
  acc: { stat: '쿨타임 감소', vals: [3, 6, 10, 14, 20, 28], names: ['빨간 목도리', '파란 망토', '나비 날개', '악마 날개', '천사 날개', '은하 날개'] },
};
const GEAR = [];
SLOTS.forEach(slot => { const d = GEAR_DEF[slot]; for (let r = 0; r < 6; r++) GEAR.push({ id: slot + r, slot, r, name: d.names[r], stat: d.stat, unit: '%', val: d.vals[r] }); });
const GEAR_BY_ID = Object.fromEntries(GEAR.map(g => [g.id, g]));
const gearValue = (g, lv) => +(g.val * (1 + 0.1 * (lv - 1))).toFixed(1);

// ───────── 스킬 아이콘 (16x16) ─────────
const ICONS = {
  attack(c) {
    PX.line(c, 3, 13, 13, 3, '#140c1c', 4); PX.line(c, 4, 12, 13, 3, '#c8d4e4', 2); PX.line(c, 5, 11, 13, 3, '#ffffff', 1);
    PX.line(c, 2, 9, 7, 14, '#140c1c', 3); PX.line(c, 2, 9, 7, 14, '#ffd23f', 1); PX.line(c, 1, 15, 3, 13, '#6b3f1f', 2);
    PX.rect(c, 11, 1, 1, 3, '#8ef6ff'); PX.rect(c, 13, 6, 2, 1, '#8ef6ff');
  },
  critical(c) {
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; PX.line(c, 9, 7, 9 + Math.cos(a) * 7, 7 + Math.sin(a) * 7, i % 2 ? '#ffd23f' : '#ff5a3c', 2); }
    PX.disc(c, 9, 7, 3, '#ffffff');
    PX.line(c, 2, 14, 10, 6, '#140c1c', 4); PX.line(c, 3, 13, 10, 6, '#ffffff', 2);
    PX.line(c, 1, 10, 6, 15, '#140c1c', 3); PX.line(c, 1, 10, 6, 15, '#e8364f', 1);
  },
  fireball(c) {
    PX.line(c, 2, 3, 7, 7, '#e8401c', 2); PX.line(c, 3, 9, 7, 8, '#ff8a1f', 2); PX.line(c, 6, 2, 8, 6, '#ff8a1f', 2);
    PX.disc(c, 10, 9, 4.5, '#e8401c'); PX.disc(c, 10, 9, 3.3, '#ff8a1f'); PX.disc(c, 10, 9, 2, '#ffd23f'); PX.rect(c, 9, 8, 1, 1, '#fff');
  },
  iceshard(c) {
    [[3, 13, 7, 3], [7, 14, 11, 4], [11, 13, 14, 5]].forEach(([a, b, d, e]) => {
      PX.line(c, a, b, d, e, '#2a6fb0', 3); PX.line(c, a, b, d, e, '#8ef6ff', 1); PX.rect(c, d, e, 1, 1, '#fff');
    });
  },
  rock(c) {
    PX.disc(c, 8, 9, 5.5, '#140c1c'); PX.disc(c, 8, 9, 4.6, '#7a6a5a'); PX.disc(c, 7, 8, 3, '#9a8a78');
    PX.rect(c, 6, 6, 2, 1, '#c8b8a0'); PX.rect(c, 10, 11, 2, 1, '#584838'); PX.rect(c, 2, 14, 2, 1, '#b09878'); PX.rect(c, 13, 14, 1, 1, '#b09878');
  },
  windslash(c) {
    PX.ring(c, 5, 8, 8, '#2fa87a', 1, 2, -1.2, 1.2); PX.ring(c, 5, 8, 7, '#bff5e0', 1, 1, -1.1, 1.1); PX.ring(c, 4, 8, 5, '#6fe0b0', 1, 1, -0.9, 0.9);
    PX.rect(c, 1, 4, 3, 1, '#bff5e0'); PX.rect(c, 0, 11, 3, 1, '#bff5e0');
  },
  chain(c) {
    const p = [[9, 1], [5, 6], [9, 7], [4, 12], [6, 15]];
    for (let i = 0; i < p.length - 1; i++) { PX.line(c, ...p[i], ...p[i + 1], '#4aa8ff', 3); }
    for (let i = 0; i < p.length - 1; i++) { PX.line(c, ...p[i], ...p[i + 1], '#fff8a0', 1); }
    PX.line(c, 9, 7, 13, 10, '#8ef6ff', 1);
  },
  poison(c) {
    PX.rect(c, 6, 2, 4, 4, '#140c1c'); PX.rect(c, 7, 3, 2, 3, '#c8e8ff'); PX.rect(c, 6, 1, 4, 1, '#7a5230');
    PX.disc(c, 8, 10, 5, '#140c1c'); PX.disc(c, 8, 10, 4, '#5ad35a'); PX.rect(c, 5, 7, 7, 2, '#c8e8ff');
    PX.rect(c, 6, 9, 2, 2, '#b8f5a8'); PX.rect(c, 11, 3, 2, 2, '#a8f060'); PX.rect(c, 13, 1, 1, 1, '#a8f060');
  },
  daggers(c) {
    [[2, 14, 10, 6], [6, 14, 14, 6]].forEach(([a, b, d, e]) => {
      PX.line(c, a + 3, b - 3, d, e, '#e6e9ef', 2); PX.rect(c, d, e, 1, 1, '#fff');
      PX.line(c, a, b, a + 2, b - 2, '#6522a8', 2); PX.line(c, a + 1, b - 4, a + 4, b - 1, '#b45cff', 1);
    });
  },
  pillar(c) {
    PX.rect(c, 4, 1, 8, 14, '#e8401c'); PX.rect(c, 5, 0, 6, 15, '#ff8a1f'); PX.rect(c, 6, 2, 4, 13, '#ffd23f'); PX.rect(c, 7, 3, 2, 12, '#fff');
    PX.rect(c, 1, 14, 14, 2, '#8a1f1f'); PX.rect(c, 2, 5, 1, 2, '#ffd23f'); PX.rect(c, 13, 8, 1, 2, '#ff8a1f');
  },
  meteor(c) {
    PX.line(c, 1, 1, 9, 9, '#8a1f1f', 4); PX.line(c, 2, 1, 9, 8, '#e8401c', 2); PX.line(c, 4, 4, 9, 9, '#ffd23f', 1);
    PX.disc(c, 10, 10, 5, '#140c1c'); PX.disc(c, 10, 10, 4, '#7a3a2a'); PX.disc(c, 9, 9, 2, '#ff8a1f'); PX.rect(c, 8, 8, 1, 1, '#fff3a0');
  },
  blizzard(c) {
    PX.line(c, 8, 1, 8, 15, '#8ef6ff', 1); PX.line(c, 2, 4, 14, 12, '#8ef6ff', 1); PX.line(c, 2, 12, 14, 4, '#8ef6ff', 1);
    PX.disc(c, 8, 8, 2, '#ffffff');
    [[8, 1], [8, 15], [2, 4], [14, 12], [2, 12], [14, 4]].forEach(([x, y]) => PX.rect(c, x - 1, y - 1, 3, 3, '#d8f6ff'));
  },
  storm(c) {
    PX.disc(c, 5, 5, 3.5, '#5a5a78'); PX.disc(c, 10, 4, 4, '#6e6e8c'); PX.rect(c, 2, 5, 12, 3, '#5a5a78');
    PX.line(c, 9, 8, 6, 12, '#ffe066', 2); PX.line(c, 6, 12, 10, 11, '#ffe066', 2); PX.line(c, 10, 11, 7, 15, '#fff8a0', 2);
  },
  dragon(c) {
    PX.sprite(c, DRAGON_HEAD, DRAGON_PAL, 0, 3);
  },
  blackhole(c) {
    PX.disc(c, 8, 8, 7, '#5a1fa8'); PX.ring(c, 8, 8, 6, '#ff9af0', 0.45, 2); PX.disc(c, 8, 8, 4, '#b45cff'); PX.disc(c, 8, 8, 3, '#05020a');
    PX.rect(c, 2, 2, 1, 1, '#fff'); PX.rect(c, 13, 12, 1, 1, '#fff');
  },
  holysword(c) {
    PX.line(c, 3, 13, 12, 4, '#140c1c', 4); PX.line(c, 4, 12, 12, 4, '#e6e9ef', 2); PX.rect(c, 12, 3, 1, 1, '#fff');
    PX.line(c, 2, 9, 7, 14, '#ffd23f', 2); PX.line(c, 1, 15, 3, 13, '#7a5230', 2); PX.rect(c, 0, 15, 1, 1, '#ffd23f');
  },
  phoenix(c) {
    PX.tri(c, 7, 8, 1, 1, 4, 10, '#e8401c'); PX.tri(c, 7, 8, 14, 1, 10, 10, '#e8401c');
    PX.tri(c, 7, 8, 3, 3, 5, 9, '#ff8a1f'); PX.tri(c, 7, 8, 12, 3, 9, 9, '#ff8a1f');
    PX.disc(c, 7, 9, 2.5, '#ffd23f'); PX.line(c, 7, 11, 5, 15, '#e8401c', 2); PX.line(c, 7, 11, 9, 15, '#ff8a1f', 1); PX.rect(c, 7, 7, 1, 1, '#fff');
  },
  omega(c) {
    PX.rect(c, 3, 5, 13, 6, '#ff5ad9'); PX.rect(c, 3, 6, 13, 4, '#8ef6ff'); PX.rect(c, 3, 7, 13, 2, '#ffffff');
    PX.disc(c, 4, 8, 4, '#ffffff'); PX.ring(c, 4, 8, 5, '#ffd23f');
  },
  timestop(c) {
    PX.disc(c, 8, 8, 7, '#140c1c'); PX.disc(c, 8, 8, 6, '#f2ece0'); PX.ring(c, 8, 8, 6, '#ffd23f');
    PX.line(c, 8, 8, 8, 4, '#140c1c'); PX.line(c, 8, 8, 11, 9, '#e8364f');
    [[8, 3], [13, 8], [8, 13], [3, 8]].forEach(([x, y]) => PX.rect(c, x, y, 1, 1, '#140c1c'));
  },
};
const DRAGON_HEAD = [
  '...KK...........',
  '..K44K...KK.....',
  '..K444KKK11K....',
  '.K11111111111K..',
  'K111111111W11KK.',
  'K1111111111111K.',
  'K22111111111111K',
  '.K2222K1111111KK',
  '..KKKK.K22222K..',
  '........KKKKK...',
];
const DRAGON_PAL = { K: '#140c1c', 1: '#d8323c', 2: '#8a1f2a', 4: '#ffd23f', W: '#fff3a0' };

function skillIcon(id, size = 16) {
  const [cv, c] = PX.mk(16, 16);
  ICONS[id](c);
  return cv;
}
