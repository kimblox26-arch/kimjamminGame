// MIRA HQ — 임시 자리표시 맵 (맵 작업에서 교체됨)
const floor = [[200, 200], [2200, 200], [2200, 1600], [200, 1600]];
export default {
  id: 'mira', name: 'MIRA HQ', ko: '미라 HQ', w: 2400, h: 1800, placeholder: true,
  theme: { outside: 'space' },
  rooms: [{ id: 'main', name: '중앙', poly: floor, floor: 'metal' }], halls: [], props: [],
  stations: { a: { x: 600, y: 400 }, b: { x: 1800, y: 400 }, c: { x: 600, y: 1400 }, d: { x: 1800, y: 1400 }, e: { x: 1200, y: 400 } },
  vents: {}, doors: [], sabotages: {},
  tasks: [
    { id: 't1', name: '배선 수리하기', kind: 'common', game: 'wires', seq: ['a'] }, { id: 't2', name: '카드 긁기', kind: 'common', game: 'card', seq: ['b'] },
    { id: 't3', name: '데이터 업로드', kind: 'long', game: 'upload', seq: ['c'] }, { id: 't4', name: '샘플 검사', kind: 'long', game: 'scan', seq: ['d'] },
    { id: 't5', name: '원자로 가동', kind: 'long', game: 'simon', seq: ['e'] }, { id: 't6', name: '배전기 보정하기', kind: 'short', game: 'calib', seq: ['a'] },
    { id: 't7', name: '항로 조종', kind: 'short', game: 'steer', seq: ['b'] }, { id: 't8', name: '보호막', kind: 'short', game: 'shields', seq: ['c'] },
    { id: 't9', name: '필터 청소', kind: 'short', game: 'leaves', seq: ['d'] }, { id: 't10', name: '소행성', kind: 'short', game: 'asteroids', seq: ['e'] },
  ],
  button: { x: 1200, y: 900 }, spawn: { x: 1200, y: 900, rx: 300, ry: 250 }, meetingSpawn: { x: 1200, y: 900, rx: 300, ry: 250 },
};
