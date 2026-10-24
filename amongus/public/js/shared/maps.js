// 호환용: 예전 코드(v1)가 쓰던 형태로 새 맵 레지스트리를 감싼다. (v2 코드는 maps/index.js 를 직접 사용)
import { getMap, LOBBY as LOBBY2, spawnAt } from './maps/index.js';
export { inPoly, walkable, canStand, getMap, MAP_LIST } from './maps/index.js';
const FLAG = { table: 'table', engine: 'engine', reactorCore: 'core', mapTable: 'map', crate: 'crate' };
const legacy = (m, spawn) => ({ ...m, halls: m.halls.map(h => h.poly), obstacles: m.blockers.map(o => ({ ...o, [FLAG[o.kind] || o.kind]: true })), spawn });
const sk = getMap('skeld');
export const SKELD = legacy(sk, (i, n) => spawnAt(sk, sk.spawn, i, n));
export const LOBBY = legacy(LOBBY2, i => ({ x: 700 + Math.cos(i * 2.4) * 120 * Math.min(1, i), y: 640 + Math.sin(i * 2.4) * 80 * Math.min(1, i) }));
export const ROOM_NAMES = sk.roomNames;
