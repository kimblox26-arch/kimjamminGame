// 대기실(드롭십) 맵
const floor = [[150, 330], [1250, 330], [1250, 920], [150, 920]];
export default {
  id: 'lobby', name: 'LOBBY', w: 1400, h: 1000, theme: { outside: 'space' },
  rooms: [{ id: 'lobby', name: '', poly: floor, floor: 'ship' }], halls: [],
  props: [
    { kind: 'crate', x: 260, y: 690, w: 170, h: 150, block: true }, { kind: 'crate', x: 960, y: 610, w: 170, h: 160, block: true },
    { kind: 'crate', x: 335, y: 400, w: 120, h: 95, block: true, laptop: true }, { kind: 'crate', x: 940, y: 400, w: 120, h: 95, block: true, box: true },
  ],
  stations: { laptop: { x: 395, y: 520 }, box: { x: 1000, y: 520 } },
  vents: {}, tasks: [], sabotages: {}, doors: [],
  spawn: { x: 700, y: 640, rx: 160, ry: 110 },
};
