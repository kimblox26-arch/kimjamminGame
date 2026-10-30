// 모든 모듈이 같이 쓰는 게임 상태
export const G = {
  time: 0,
  running: false,
  settings: { sound: 0.8, sens: 1 },
  npcs: [], cars: [], pickups: [], hitList: [], corpses: [],
  emit(ev) { for (const n of G.npcs) if (n.alive) n.hear(ev); },
};
