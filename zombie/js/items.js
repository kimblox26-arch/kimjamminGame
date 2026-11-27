// 아이템 / 파밍(수색 가능한 보관함·전리품 테이블·희귀도·무게) / 상호작용 레지스트리
import * as THREE from 'three';
import { rng, hash2 } from './util.js';

export const RARITY = { c: ['일반', '#d6d6d6'], u: ['고급', '#5fd35f'], r: ['희귀', '#4fa3ff'], e: ['영웅', '#c27bff'], l: ['전설', '#ffa53a'] };
// kind, w(kg), r(희귀도), 기타
export const ITEMS = {
  water: { name: '생수 500ml', kind: 'drink', val: 35, w: 0.5, r: 'c' }, juice: { name: '이온음료', kind: 'drink', val: 30, w: 0.5, r: 'c' },
  coffee: { name: '캔커피', kind: 'drink', val: 10, st: 35, stress: -5, w: 0.25, r: 'c' }, energy: { name: '에너지 드링크', kind: 'drink', val: 12, st: 100, w: 0.3, r: 'u' },
  soju: { name: '소주', kind: 'drink', val: 5, stress: -25, w: 0.4, r: 'c' },
  ramen: { name: '컵라면', kind: 'food', val: 28, w: 0.15, r: 'c' }, can: { name: '참치 통조림', kind: 'food', val: 35, w: 0.3, r: 'c' }, bar: { name: '에너지바', kind: 'food', val: 15, w: 0.08, r: 'c' },
  rice: { name: '즉석밥', kind: 'food', val: 30, w: 0.25, r: 'c' }, choco: { name: '초코바', kind: 'food', val: 10, hope: 4, w: 0.08, r: 'c' }, kimbap: { name: '삼각김밥', kind: 'food', val: 22, w: 0.15, r: 'c' },
  mre: { name: '전투식량', kind: 'food', val: 70, hope: 5, w: 0.45, r: 'r' },
  bandage: { name: '붕대', kind: 'heal', val: 20, w: 0.1, r: 'c' }, pills: { name: '진통제', kind: 'heal', val: 8, stress: -15, w: 0.05, r: 'u' }, medkit: { name: '구급상자', kind: 'heal', val: 60, w: 0.9, r: 'r' },
  cig: { name: '담배', kind: 'misc', stress: -12, w: 0.05, r: 'c', use: true },
  pistolAmmo: { name: '9mm 탄(8발)', kind: 'ammo', weapon: 'pistol', count: 8, w: 0.1, r: 'u' }, rifleAmmo: { name: '5.56mm 탄(15발)', kind: 'ammo', weapon: 'rifle', count: 15, w: 0.2, r: 'r' },
  shells: { name: '12게이지 산탄(5발)', kind: 'ammo', weapon: 'shotgun', count: 5, w: 0.25, r: 'r' },
  bat: { name: '야구방망이', kind: 'weapon', weapon: 'bat', w: 1.0, r: 'c' }, knife: { name: '식칼', kind: 'weapon', weapon: 'knife', w: 0.3, r: 'c' }, pipe: { name: '쇠파이프', kind: 'weapon', weapon: 'pipe', w: 1.5, r: 'c' },
  golf: { name: '골프채', kind: 'weapon', weapon: 'golf', w: 0.8, r: 'c' }, crowbar: { name: '빠루(쇠지렛대)', kind: 'weapon', weapon: 'crowbar', w: 1.6, r: 'u' }, baton: { name: '경찰봉', kind: 'weapon', weapon: 'baton', w: 0.6, r: 'u' },
  axe: { name: '소방도끼', kind: 'weapon', weapon: 'axe', w: 2.2, r: 'r' },
  pistol: { name: '권총', kind: 'weapon', weapon: 'pistol', w: 0.9, r: 'r' }, shotgun: { name: '산탄총', kind: 'weapon', weapon: 'shotgun', w: 3.4, r: 'e' }, rifle: { name: '소총', kind: 'weapon', weapon: 'rifle', w: 3.6, r: 'e' },
  flashlight: { name: '손전등', kind: 'tool', w: 0.3, r: 'c' }, radio: { name: '휴대용 라디오', kind: 'tool', w: 0.5, r: 'u' }, battery: { name: '건전지', kind: 'misc', w: 0.05, r: 'c', use: true },
  tape: { name: '청테이프', kind: 'misc', w: 0.2, r: 'c' },
  helmetMoto: { name: '오토바이 헬멧', kind: 'armor', slot: 'head', def: 0.15, dur: 80, w: 1.2, r: 'u' }, helmetMil: { name: '방탄 헬멧', kind: 'armor', slot: 'head', def: 0.22, dur: 140, w: 1.4, r: 'r' },
  padding: { name: '두꺼운 롱패딩', kind: 'armor', slot: 'body', def: 0.12, dur: 60, w: 1.5, r: 'c' }, vestPolice: { name: '방검 조끼', kind: 'armor', slot: 'body', def: 0.3, dur: 120, w: 2.5, r: 'r' },
  vestMil: { name: '방탄조끼', kind: 'armor', slot: 'body', def: 0.42, dur: 200, w: 4.0, r: 'e' },
  bagSchool: { name: '책가방 (+8kg)', kind: 'bag', cap: 8, w: 0, r: 'u' }, bagHike: { name: '등산 배낭 (+18kg)', kind: 'bag', cap: 18, w: 0, r: 'r' }, bagMil: { name: '군용 더플백 (+30kg)', kind: 'bag', cap: 30, w: 0, r: 'e' },
  gold: { name: '금반지', kind: 'misc', w: 0.01, r: 'l' }
};
// 전리품 테이블: [아이템, 가중치, 최소, 최대], rolls:[min,max]
export const LOOT = {
  shelf: { name: '진열대', t: 1.4, rolls: [1, 4], e: [['water', 6], ['ramen', 6], ['kimbap', 4], ['bar', 4], ['choco', 3], ['juice', 3], ['can', 3], ['rice', 3], ['coffee', 3], ['soju', 2], ['battery', 2], ['tape', 1], ['cig', 2]] },
  cooler: { name: '음료 냉장고', t: 1.0, rolls: [1, 3], e: [['water', 6, 1, 2], ['juice', 5], ['coffee', 4], ['soju', 3], ['energy', 2]] },
  counter: { name: '계산대', t: 1.6, rolls: [1, 3], e: [['battery', 3, 1, 3], ['cig', 3], ['pills', 1], ['choco', 2], ['bagSchool', 0.25], ['gold', 0.08]] },
  pharmacy: { name: '의약품 진열대', t: 1.6, rolls: [1, 3], e: [['bandage', 6, 1, 3], ['pills', 5], ['medkit', 1.4], ['energy', 1]] },
  locker: { name: '경찰 사물함', t: 2.2, rolls: [1, 3], e: [['pistolAmmo', 5, 1, 2], ['pistol', 0.8], ['baton', 1.5], ['vestPolice', 0.8], ['shells', 1.2], ['shotgun', 0.25], ['bandage', 2], ['helmetMoto', 0.6]] },
  military: { name: '군용 보급 상자', t: 2.4, rolls: [2, 4], e: [['rifleAmmo', 6, 1, 2], ['rifle', 0.7], ['mre', 4, 1, 2], ['vestMil', 0.6], ['helmetMil', 0.9], ['bagMil', 0.5], ['medkit', 1], ['bandage', 2]] },
  car: { name: '차량', t: 1.8, rolls: [0, 2], e: [['water', 2], ['bar', 2], ['choco', 2], ['bandage', 1], ['pills', 1], ['battery', 2], ['coffee', 2], ['cig', 2], ['pistolAmmo', 0.3], ['bagSchool', 0.4], ['golf', 0.6], ['crowbar', 0.4], ['gold', 0.05], ['padding', 0.4]] },
  policecar: { name: '경찰차', t: 2.0, rolls: [1, 3], e: [['pistolAmmo', 5, 1, 2], ['shells', 2], ['shotgun', 0.3], ['vestPolice', 0.4], ['baton', 1], ['bandage', 2]] },
  trash: { name: '쓰레기 더미', t: 1.2, rolls: [0, 2], e: [['tape', 2], ['battery', 1.5], ['can', 1], ['ramen', 1], ['soju', 1], ['pipe', 0.6], ['cig', 1]] },
  parcel: { name: '택배 상자', t: 1.4, rolls: [1, 2], e: [['ramen', 3, 1, 3], ['coffee', 2, 2, 4], ['choco', 2], ['padding', 1], ['helmetMoto', 0.5], ['bagHike', 0.4], ['energy', 1.5], ['battery', 1.5], ['gold', 0.06]] },
  fireBox: { name: '소화전함', t: 1.5, rolls: [1, 1], e: [['axe', 1]] },
  corpse_walker: { name: '시체', t: 1.4, rolls: [0, 2], e: [['water', 1], ['bar', 1], ['battery', 1], ['cig', 1.5], ['pills', 0.6], ['bandage', 0.6], ['gold', 0.06], ['choco', 1]] },
  corpse_police: { name: '경찰 시체', t: 1.6, rolls: [1, 2], e: [['pistolAmmo', 3, 1, 2], ['baton', 0.6], ['pistol', 0.3], ['bandage', 1], ['vestPolice', 0.15]] },
  corpse_soldier: { name: '군인 시체', t: 1.8, rolls: [1, 3], e: [['rifleAmmo', 4], ['mre', 2], ['helmetMil', 0.35], ['vestMil', 0.15], ['rifle', 0.2], ['bandage', 1.5]] },
  corpse_brute: { name: '거구 시체', t: 1.6, rolls: [1, 3], e: [['can', 2], ['soju', 2], ['crowbar', 0.6], ['pipe', 0.6], ['gold', 0.15], ['cig', 2]] }
};
export function rollLoot(table, id) {
  const T = LOOT[table] || LOOT.trash, R = rng((hash2(id.length, [...id].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7), 99) * 4e9) | 0);
  const n = T.rolls[0] + Math.floor(R() * (T.rolls[1] - T.rolls[0] + 1)), tot = T.e.reduce((a, e) => a + e[1], 0), out = [];
  for (let i = 0; i < n; i++) {
    let x = R() * tot; for (const [it, wt, mn = 1, mx = 1] of T.e) { x -= wt; if (x <= 0) { const c = mn + Math.floor(R() * (mx - mn + 1)); const ex = out.find(o => o[0] === it); if (ex) ex[1] += c; else out.push([it, c]); break; } }
  }
  return out;
}

const COL = { drink: 0x5aa9e6, food: 0xe0a040, heal: 0xe04040, ammo: 0xb8a060, weapon: 0x777777, tool: 0x333333, misc: 0x999999, armor: 0x445544, bag: 0x334455 };
let geos = null;
function g() {
  return geos ||= {
    drink: new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), food: new THREE.BoxGeometry(0.12, 0.1, 0.12), heal: new THREE.BoxGeometry(0.22, 0.12, 0.16),
    ammo: new THREE.BoxGeometry(0.1, 0.06, 0.08), weapon: new THREE.BoxGeometry(0.08, 0.08, 0.8), tool: new THREE.BoxGeometry(0.06, 0.06, 0.22), misc: new THREE.BoxGeometry(0.08, 0.02, 0.14),
    armor: new THREE.SphereGeometry(0.15, 10, 6), bag: new THREE.BoxGeometry(0.3, 0.4, 0.15)
  };
}
const mats = {};
// 바닥에 놓인 개별 아이템
export class ItemManager {
  constructor(game) { this.game = game; this.byOwner = new Map(); }
  spawn(list, owner) {
    const G = g(), arr = [];
    for (const it of list) {
      if (this.game.taken.has(it.id)) continue;
      const def = ITEMS[it.type]; if (!def) continue;
      const m = new THREE.Mesh(G[def.kind], mats[def.kind] ||= new THREE.MeshStandardMaterial({ color: COL[def.kind], roughness: 0.5, metalness: def.kind === 'weapon' ? 0.4 : 0.05 }));
      m.position.set(it.x, it.y + 0.06, it.z); m.rotation.y = (it.id.length * 1.7) % 6.28; m.castShadow = true; this.game.scene.add(m);
      const inter = this.game.inter.add({ pos: m.position, r: 1.6, label: def.name + ' 줍기', hold: 0, owner,
        act: () => { if (!this.game.player.give(it.type, it.n || 1)) return; this.game.taken.add(it.id); this.game.scene.remove(m); this.game.inter.remove(inter); this.game.audio.play('pickup'); } });
      arr.push({ m, inter });
    }
    this.byOwner.set(owner, (this.byOwner.get(owner) || []).concat(arr));
  }
  removeOwner(owner) { const a = this.byOwner.get(owner); if (!a) return; for (const { m, inter } of a) { this.game.scene.remove(m); this.game.inter.remove(inter); } this.byOwner.delete(owner); }
}

// 수색 가능한 보관함 + 전리품 창
export class LootManager {
  constructor(game) {
    this.game = game; this.state = new Map(); this.open = null; this.corpses = new Map();
    const $ = id => document.getElementById(id);
    this.el = { root: $('loot'), title: $('loot-title'), list: $('loot-list'), wt: $('loot-weight') };
    $('loot-all').onclick = () => this.takeAll(); $('loot-close').onclick = () => this.close();
  }
  // c: {id, table, name?, pos, owner}
  add(c) {
    const T = LOOT[c.table]; const name = c.name || T.name;
    return this.game.inter.add({ pos: c.pos, r: c.r || 2.0, owner: c.owner,
      label: () => { const s = this.state.get(c.id); return !s ? `${name} 수색` : s.length ? `${name} 열기 (${s.reduce((a, x) => a + x[1], 0)})` : `${name} (비어 있음)`; },
      hold: () => this.state.has(c.id) ? 0.25 : T.t,
      cond: () => { const s = this.state.get(c.id); return !s || s.length > 0; },
      onHold: () => { if (!this._snd && !this.state.has(c.id)) { this._snd = true; this.game.audio.play('rummage', { pos: c.pos }); } }, onRelease: () => this._snd = false,
      act: () => { this._snd = false; if (!this.state.has(c.id)) { this.state.set(c.id, rollLoot(c.table, c.id)); this.game.zombies.noise(c.pos, 6); this.game.emit('searched', c); } this.show(c, name); } });
  }
  addCorpse(z) {
    if (this.corpses.has(z.id) || z.scripted) return;
    const tb = 'corpse_' + (z.type === 'police' || z.type === 'soldier' || z.type === 'brute' ? z.type : 'walker');
    const pos = new THREE.Vector3(); setTimeout(() => { if (!this.game.zombies.list.includes(z)) return; z.h.b.spine.getWorldPosition(pos); const it = this.add({ id: 'z' + z.id + '_' + Math.round(z.pos.x) + '_' + Math.round(z.pos.z), table: tb, pos, r: 2.0, owner: 'corpse' }); this.corpses.set(z.id, it); }, 1200);
  }
  removeCorpse(z) { const it = this.corpses.get(z.id); if (it) { this.game.inter.remove(it); this.corpses.delete(z.id); } }
  show(c, name) {
    const g = this.game; this.open = { c, name };
    g._noMenu = true; document.exitPointerLock?.(); g.player.enabled = false; g.player.keys = {};
    this.el.root.classList.remove('hidden'); this.render(); g.audio.play('ui');
  }
  render() {
    const g = this.game, P = g.player, s = this.state.get(this.open.c.id), L = this.el.list;
    this.el.title.textContent = this.open.name; L.innerHTML = '';
    if (!s.length) L.innerHTML = '<div class="it empty">아무것도 없다</div>';
    s.forEach((e, i) => {
      const d = ITEMS[e[0]], [rn, rc] = RARITY[d.r || 'c'], row = document.createElement('div'); row.className = 'it';
      row.innerHTML = `<span style="color:${rc}">${d.name}${e[1] > 1 ? ' ×' + e[1] : ''}</span><small>${rn} · ${(d.w * e[1]).toFixed(2)}kg</small>`;
      row.onclick = () => { this.take(i); }; L.appendChild(row);
    });
    this.el.wt.textContent = `가방 무게 ${P.weight().toFixed(1)} / ${P.capacity()} kg`;
  }
  take(i) {
    const P = this.game.player, s = this.state.get(this.open.c.id), e = s[i]; if (!e) return;
    const n = P.canCarry(e[0], e[1]); if (n <= 0) { this.game.ui.notify('가방이 꽉 찼다 (무게 초과)'); this.game.audio.play('dryfire'); return; }
    P.give(e[0], n); e[1] -= n; if (e[1] <= 0) s.splice(i, 1); this.game.audio.play('pickup'); this.render();
  }
  takeAll() { const s = this.state.get(this.open.c.id); for (let i = s.length - 1; i >= 0; i--) this.take(i); if (!s.length) this.close(); }
  close() { if (!this.open) return; this.open = null; this.el.root.classList.add('hidden'); const g = this.game; g.player.enabled = true; setTimeout(() => { g._noMenu = false; }, 200); g.requestLock(); }
  save() { return [...this.state.entries()].filter(([k]) => !k.startsWith('z')); }
  load(a) { this.state = new Map(a || []); }
}

// 상호작용 레지스트리
export class Interactions {
  constructor() { this.list = []; }
  add(o) { o.r ??= 1.8; this.list.push(o); return o; }
  remove(o) { const i = this.list.indexOf(o); if (i >= 0) this.list.splice(i, 1); }
  removeOwner(owner) { this.list = this.list.filter(o => o.owner !== owner); }
  best(eye, dir) {
    let b = null, bs = -1;
    for (const o of this.list) {
      if (o.cond && !o.cond()) continue;
      const dx = o.pos.x - eye.x, dy = o.pos.y - eye.y, dz = o.pos.z - eye.z, d = Math.hypot(dx, dy, dz);
      if (d > o.r) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / (d || 1);
      if (dot < (d < 0.8 ? 0.3 : 0.78)) continue;
      const s = dot * 2 - d / o.r; if (s > bs) { bs = s; b = o; }
    }
    return b;
  }
}
