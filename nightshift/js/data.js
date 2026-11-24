// 상품·담배·손님 유형·대사 데이터 (상표는 전부 가상의 이름)
export const PRODUCTS = {
  ramen:   { name: '매운 컵라면', price: 1500, kind: 'cup', c1: '#d8261c', c2: '#fff3d6', txt: '매운컵' },
  ramen2:  { name: '사골 큰사발', price: 1800, kind: 'cup', c1: '#f2efe6', c2: '#7a3b12', txt: '사골' },
  kimbap:  { name: '참치마요 삼각김밥', price: 1300, kind: 'tri', c1: '#1f6b3a', c2: '#ffffff', txt: '참치마요' },
  dosirak: { name: '제육 도시락', price: 4900, kind: 'tray', c1: '#c23a1d', c2: '#fff', txt: '제육도시락' },
  banana:  { name: '바나나맛 우유', price: 1700, kind: 'jar', c1: '#ffd84a', c2: '#2c6b2f', txt: '바나나' },
  water:   { name: '생수 500ml', price: 1000, kind: 'bottle', c1: '#bfe8ff', c2: '#1a5ea8', txt: '맑은샘' },
  cola:    { name: '콜라 캔', price: 1800, kind: 'can', c1: '#c4161c', c2: '#ffffff', txt: 'COLA' },
  cider:   { name: '사이다 캔', price: 1700, kind: 'can', c1: '#2fa84f', c2: '#ffffff', txt: '사이다' },
  coffee:  { name: '아메리카노 캔', price: 1500, kind: 'can', c1: '#3b2418', c2: '#e8c99a', txt: 'COFFEE' },
  energy:  { name: '에너지 드링크', price: 2200, kind: 'can', c1: '#14161a', c2: '#7dff3c', txt: 'ENERGY' },
  beer:    { name: '라거 맥주 500', price: 3000, kind: 'can', c1: '#c9a227', c2: '#1b2a6b', txt: 'LAGER', adult: true },
  soju:    { name: '처음처럼이야 소주', price: 2100, kind: 'soju', c1: '#2e8b3e', c2: '#ffffff', txt: '소주', adult: true },
  hangover:{ name: '숙취해소 음료', price: 3500, kind: 'jar', c1: '#7a4a12', c2: '#ffd36b', txt: '헛개' },
  chips:   { name: '새우 스낵', price: 1700, kind: 'bag', c1: '#f0a020', c2: '#d62020', txt: '새우칩' },
  choco:   { name: '초코 파이', price: 4800, kind: 'box', c1: '#c4161c', c2: '#fff', txt: '초코파이' },
  gum:     { name: '자일리톨 껌', price: 1000, kind: 'small', c1: '#2a9d5c', c2: '#fff', txt: '껌' },
  icecream:{ name: '바닐라 콘', price: 1800, kind: 'small', c1: '#f4f0e6', c2: '#8a1d1d', txt: '콘' },
  condom:  { name: '위생용품', price: 5500, kind: 'small', c1: '#5b2a86', c2: '#fff', txt: 'SAFE' },
  battery: { name: 'AA 건전지', price: 3900, kind: 'small', c1: '#202020', c2: '#e6b800', txt: 'AA' },
};
export const SHELF_ITEMS = ['ramen', 'ramen2', 'chips', 'choco', 'gum', 'battery', 'kimbap', 'dosirak', 'banana', 'hangover'];
export const FRIDGE_ITEMS = ['water', 'cola', 'cider', 'coffee', 'energy', 'beer', 'soju', 'banana'];

// 담배 진열대 (4줄 × 10칸 = 1~40번)
const CIG_NAMES = ['에스 블루', '에스 프레소', '라온 블루', '라온 실버', '마일드 레드', '마일드 골드', '던바 6', '던바 3', '파라 아쿠아', '파라 원',
  '보헴 시가', '보헴 미니', '메비 블루', '메비 원', '카멜 필터', '카멜 블루', '디스 플러스', '디스 오리지널', '토니 레드', '토니 블루',
  '에스 체인지', '에스 원', '라온 체인지', '메비 체인지', '아이스 볼트', '아이스 피트', '시즌 그린', '시즌 블루', '한라 산', '한라 실버',
  '말레 블랙', '말레 화이트', '던바 프로스트', '파라 하이브리드', '메비 하이브리드', '보헴 쿠바', '에스 썸', '카멜 크러쉬', '디스 아프리카', '토니 화이트'];
const CIG_COL = ['#2456b8', '#5b3a29', '#2f8fd4', '#a9b3bd', '#c4161c', '#d6a93a', '#1d2b5e', '#4b6fa8', '#24b3c7', '#e8e8e8'];
export const CIGS = CIG_NAMES.map((name, i) => ({ id: i + 1, name, price: [4500, 4500, 4800, 5000, 4500][i % 5], color: CIG_COL[i % 10] }));

// 손님 유형
// model: man | woman, look: 옷/소품, voice: TTS 높낮이/속도, trouble: 진상 종류
export const TYPES = [
  { id: 'office', name: '퇴근한 직장인', model: 'man', h: 1.78, top: '#2b2f38', bottom: '#1c1f26', voice: [0.95, 1.05], wants: [['beer', 'chips'], ['dosirak'], ['ramen', 'kimbap'], ['hangover']], cig: 0.35, pay: 'card', w: 3 },
  { id: 'student', name: '대학생', model: 'woman', h: 1.62, voice: [1.15, 1.08], wants: [['ramen', 'kimbap', 'banana'], ['chips', 'cola'], ['icecream'], ['coffee', 'energy']], pay: 'card', w: 3 },
  { id: 'night', name: '야식 사러 온 손님', model: 'man', h: 1.74, top: '#6b1d1d', bottom: '#2a2a2a', hat: 'cap', voice: [1.0, 1.0], wants: [['ramen', 'ramen2', 'cola'], ['dosirak', 'cider'], ['chips', 'choco', 'beer']], cig: 0.2, pay: 'cash', w: 3 },
  { id: 'rider', name: '배달 라이더', model: 'man', h: 1.76, top: '#1d3b6b', bottom: '#151515', hat: 'helmet', voice: [0.9, 1.15], wants: [['energy', 'kimbap'], ['coffee'], ['water', 'kimbap']], cig: 0.5, pay: 'cash', w: 2 },
  { id: 'woman', name: '근처 주민', model: 'woman', h: 1.6, voice: [1.2, 1.0], wants: [['water', 'gum'], ['banana', 'choco'], ['battery'], ['condom', 'water']], pay: 'card', w: 2 },
  { id: 'soldier', name: '휴가 나온 군인', model: 'man', h: 1.75, top: '#4a5a33', bottom: '#3d4a2a', hat: 'beanie', voice: [0.95, 1.12], wants: [['ramen', 'ramen2', 'kimbap', 'cola'], ['beer', 'soju', 'chips']], cig: 0.4, pay: 'cash', w: 1 },
  // ─ 진상 ─
  { id: 'drunk', name: '술 취한 아저씨', model: 'man', h: 1.72, top: '#59606b', bottom: '#2b2b2b', voice: [0.85, 0.82], wants: [['soju', 'soju'], ['soju', 'hangover']], cig: 0.6, pay: 'cash', trouble: 'drunk', w: 0 },
  { id: 'rude', name: '반말 손님', model: 'man', h: 1.8, top: '#111111', bottom: '#30343c', hat: 'cap', voice: [0.9, 1.15], wants: [['energy'], ['beer'], ['cola', 'chips']], cig: 0.9, pay: 'throw', trouble: 'rude', w: 0 },
  { id: 'minor', name: '앳된 손님', model: 'man', h: 1.66, top: '#1e2a5a', bottom: '#1e2a5a', hat: 'hood', voice: [1.25, 1.1], wants: [['beer', 'chips'], ['soju', 'cola']], cig: 0.6, pay: 'cash', trouble: 'minor', w: 0 },
  { id: 'haggle', name: '깎아달라는 아저씨', model: 'man', h: 1.7, top: '#6a5a44', bottom: '#3a3a3a', hat: 'cap', voice: [0.9, 1.05], wants: [['choco', 'banana', 'water'], ['dosirak', 'chips']], pay: 'cash', trouble: 'haggle', w: 0 },
  { id: 'refund', name: '환불 요구 손님', model: 'man', h: 1.77, top: '#7a5a2a', bottom: '#222', voice: [0.95, 1.1], wants: [['dosirak']], pay: 'card', trouble: 'refund', w: 0 },
  { id: 'thief', name: '수상한 손님', model: 'man', h: 1.75, top: '#1a1a1a', bottom: '#1a1a1a', hat: 'hood', mask: true, voice: [0.9, 1.0], wants: [['gum'], ['water']], pay: 'cash', trouble: 'thief', w: 0 },
];

// 플레이어 말 → 의도. 순서가 중요 (앞에서부터 검사)
export const INTENTS = [
  ['police', /(경찰|신고|112)/],
  ['out', /(나가|나가주|가주세요|꺼져|영업\s*방해)/],
  ['id', /(신분증|민증|주민등록|나이|몇\s*살|성인|학생이)/],
  ['thief', /(계산\s*안|주머니|cctv|씨씨티비|훔치|넣으신|가방에)/i],
  ['bagask', /(봉투|봉지)/],
  ['point', /(포인트|적립|멤버십|할인\s*카드)/],
  ['receipt', /(영수증)/],
  ['heat', /(데워|전자레인지|렌지)/],
  ['refuse', /(안\s*돼|안됩|안\s*됩|불가|못\s*해|어렵|죄송하지만|규정)/],
  ['sorry', /(죄송|미안|실례)/],
  ['calm', /(진정|천천히|기다려|잠시만|잠깐만)/],
  ['card', /(카드)/],
  ['cash', /(현금)/],
  ['total', /(원\s*입니다|원이요|원\s*입니|얼마|합계|결제\s*도와)/],
  ['bye', /(안녕히|또\s*오세요|감사합니다|고맙습니다|좋은\s*밤|들어가세요)/],
  ['greet', /(어서\s*오|안녕하세요|반갑습니다|어서옵쇼)/],
  ['yes', /^(네|예|넵|알겠|그럼요|물론|맞아|응|좋아요|ok|오케이)/i],
  ['no', /^(아니|없어|없습니다|아뇨|괜찮)/],
  ['rude', /(시발|씨발|병신|꺼지|닥쳐|미친|개새)/],
];

export const PHRASES = ['어서오세요!', '안녕하세요~', '봉투 필요하세요?', '포인트 적립하세요?', '신분증 보여주시겠어요?', '카드 꽂아주세요',
  '현금이세요 카드세요?', '영수증 드릴까요?', '감사합니다 안녕히 가세요!', '죄송하지만 안 됩니다', '잠시만 기다려주세요', '손님 진정하세요',
  '계산 안 하신 거 있으시죠?', '손님 나가주세요', '경찰 부르겠습니다', '네 사장님!', '알겠습니다', '죄송합니다'];

export const L = {
  greetBack: ['네~', '안녕하세요', '수고하세요', '(고개를 끄덕인다)'],
  ignored: ['…인사도 안 하네', '여기 장사 하는 거 맞아요?'],
  slow: ['저기요, 계산 좀 해주세요', '아 빨리 좀 해주세요', '얼마나 걸려요?'],
  leaveAngry: ['아 됐어요, 다른 데 갈게요', '진짜 짜증나네', '여기 다신 안 와'],
  thanks: ['감사합니다~', '수고하세요', '안녕히 계세요', '좋은 밤 되세요'],
  bagYes: ['네 봉투 하나 주세요', '네 주세요'], bagNo: ['아뇨 괜찮아요', '그냥 들고 갈게요'],
  pointNo: ['없어요', '괜찮아요'], pointYes: ['아 네, 010… 아 됐어요 그냥 해주세요'],
  receiptNo: ['버려주세요', '괜찮아요'], receiptYes: ['네 주세요'],
  wrongCig: ['이거 아닌데요?', '아니 그거 말고요', '번호 잘 보세요'],
  shortChange: ['저기요, 거스름돈이 모자란데요?', '돈 덜 주셨어요'],
  overChange: ['어… 많이 주신 것 같은데… 감사합니다!', '(조용히 주머니에 넣는다)'],
  rightChange: ['감사합니다', '네~'],
  cardIn: ['(카드를 꽂는다)'],
  what: ['네?', '뭐라고요?', '…?'],
  rudeReply: ['뭐? 지금 나한테 뭐라 그랬어?', '말 다 했어?'],
  cash: ['현금이요', '여기요'], card: ['카드요', '카드로 할게요'],
};

export const TROUBLE = {
  drunk: {
    enter: ['어이~ 학생~ 여기 소주 어딨어~', '끄윽… 여기가 어디야…'],
    counter: ['아 내가~ 이 동네에서 말이야~ 끅', '학생 몇 살이야~ 내가 옛날에~'],
    pay: ['돈이… 어디 갔지… 이것밖에 없네… 깎아줘~'],
    calm: ['어어 알았어 알았어~ 끅'], out: ['뭐어? 나가라고? …알았어 간다 가!'],
    police: ['경찰? 아니 왜 그래~ 간다고 간다고!'],
  },
  rude: {
    counter: ['야, {cig} 줘. 빨리.', '야 이거 계산.'],
    pay: ['(카드를 던진다) 빨리 해'],
    polite: ['…아, 네. 미안합니다.'], rudeBack: ['너 지금 손님한테 말버릇이 뭐야?'],
  },
  minor: {
    counter: ['저… 이거요.', '{cig} 하나 주세요.'],
    idAsk: ['아… 신분증 집에 두고 왔는데요…', '아 형이 사오라고 해서요…'],
    fake: ['(신분증을 내민다)'],
    refused: ['아 씨… 알겠어요.', '(조용히 나간다)'],
  },
  haggle: {
    counter: ['총각, 이거 좀 깎아줘~ 단골인데~', '이거 유통기한 다 돼가는데 반값에 안 돼?'],
    refused: ['아이고 야박하네~ 알았어 그냥 줘'], sorry: ['에휴~ 알았어 알았어'],
  },
  refund: {
    counter: ['이거 아까 샀는데 맛이 이상해요. 환불해 주세요.', '영수증은 없는데 환불 돼죠?'],
    refused: ['아 규정이 그렇다면… 알겠어요'], angry: ['사장 나오라 그래요!'],
  },
  thief: {
    caught: ['아… 아 그거요… 깜빡했네요…(물건을 꺼낸다)'], escape: ['(빠르게 나간다)'],
  },
};

export const BOSS = {
  intro: ['어 왔어? {name} 씨 오늘 야간 첫날이지?', '손님 들어오면 인사 크게 하고, 미성년자한테 술 담배는 절대 안 돼. 신분증 꼭 확인하고.',
    '계산은 바코드 찍고 포스에서 결제, 현금이면 거스름돈 정확하게. 시재 안 맞으면 곤란해.', '진상 오면 침착하게, 너무 심하면 112 누르고. 그럼 수고해~'],
  visit: ['어 나야. 잘 하고 있나 보러 왔어.', '별일 없었지?'],
  good: ['오~ 잘 하네. 그렇게만 해.', '손님들 반응 좋더라. 수고해~'],
  bad: ['{name} 씨… 아까 CCTV 봤는데 좀 신경 써줘.', '시재가 좀 이상한데? 거스름돈 잘 줘.'],
  minor: ['아니 미성년자한테 술 팔면 어떡해! 영업정지 먹으면 어쩌려고!'],
  end: ['수고했어. 시재 한번 맞춰보자.', '오늘 고생 많았어. 내일도 부탁해~'],
};
