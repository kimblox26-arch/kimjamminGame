// 아이템 정의 + 월드 아이템(메시+상호작용) 관리
import * as THREE from 'three';

export const ITEMS = {
  water: { name: '생수 500ml', kind: 'drink', val: 35 }, ramen: { name: '컵라면', kind: 'food', val: 28 }, can: { name: '참치 통조림', kind: 'food', val: 35 },
  bar: { name: '에너지바', kind: 'food', val: 15 }, rice: { name: '즉석밥', kind: 'food', val: 30 }, choco: { name: '초코바', kind: 'food', val: 10, hope: 4 },
  kimbap: { name: '삼각김밥', kind: 'food', val: 22 }, juice: { name: '이온음료', kind: 'drink', val: 30 }, soju: { name: '소주', kind: 'drink', val: 5, stress: -25 },
  bandage: { name: '붕대', kind: 'heal', val: 20 }, medkit: { name: '구급상자', kind: 'heal', val: 60 }, pills: { name: '진통제', kind: 'heal', val: 8, stress: -15 },
  pistolAmmo: { name: '권총탄(8발)', kind: 'ammo', weapon: 'pistol', count: 8 }, rifleAmmo: { name: '소총탄(15발)', kind: 'ammo', weapon: 'rifle', count: 15 },
  bat: { name: '야구방망이', kind: 'weapon', weapon: 'bat' }, knife: { name: '식칼', kind: 'weapon', weapon: 'knife' }, pipe: { name: '쇠파이프', kind: 'weapon', weapon: 'pipe' },
  pistol: { name: '권총', kind: 'weapon', weapon: 'pistol' }, rifle: { name: '소총', kind: 'weapon', weapon: 'rifle' },
  flashlight: { name: '손전등', kind: 'tool' }, radio: { name: '휴대용 라디오', kind: 'tool' }, battery: { name: '보조배터리', kind: 'misc' }
};
export const LOOT_STORE = ['water', 'water', 'ramen', 'kimbap', 'bar', 'choco', 'juice', 'can', 'rice', 'soju', 'bandage', 'pills'];
export const LOOT_CAR = ['water', 'bar', 'choco', 'bandage', 'pills', 'juice', 'battery', 'pistolAmmo'];

const COL = { drink: 0x5aa9e6, food: 0xe0a040, heal: 0xe04040, ammo: 0xb8a060, weapon: 0x777777, tool: 0x333333, misc: 0x999999 };
let geos = null;
function g() {
  if (geos) return geos;
  geos = {
    drink: new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), food: new THREE.BoxGeometry(0.12, 0.1, 0.12), heal: new THREE.BoxGeometry(0.22, 0.12, 0.16),
    ammo: new THREE.BoxGeometry(0.1, 0.06, 0.08), weapon: new THREE.BoxGeometry(0.08, 0.08, 0.8), tool: new THREE.BoxGeometry(0.06, 0.06, 0.22), misc: new THREE.BoxGeometry(0.08, 0.02, 0.14)
  };
  return geos;
}
const mats = {};
export class ItemManager {
  constructor(game) { this.game = game; this.byOwner = new Map(); }
  // list: [{id, type, x,y,z}] 월드 좌표
  spawn(list, owner) {
    const G = g(), arr = [];
    for (const it of list) {
      if (this.game.taken.has(it.id)) continue;
      const def = ITEMS[it.type]; if (!def) continue;
      const m = new THREE.Mesh(G[def.kind], mats[def.kind] ||= new THREE.MeshStandardMaterial({ color: COL[def.kind], roughness: 0.5, metalness: def.kind === 'weapon' ? 0.4 : 0.05 }));
      m.position.set(it.x, it.y + 0.06, it.z); m.rotation.y = (it.id.length * 1.7) % 6.28; if (def.kind === 'weapon') m.rotation.x = 0;
      m.castShadow = true; this.game.scene.add(m);
      const inter = this.game.inter.add({ pos: m.position, r: 1.6, label: def.name + ' 줍기', hold: 0, owner,
        act: () => { this.game.player.give(it.type, it.n || 1); this.game.taken.add(it.id); this.game.scene.remove(m); this.game.inter.remove(inter); this.game.audio.play('pickup'); } });
      arr.push({ m, inter });
    }
    const prev = this.byOwner.get(owner) || []; this.byOwner.set(owner, prev.concat(arr));
  }
  removeOwner(owner) {
    const a = this.byOwner.get(owner); if (!a) return;
    for (const { m, inter } of a) { this.game.scene.remove(m); this.game.inter.remove(inter); }
    this.byOwner.delete(owner);
  }
}

// 상호작용 레지스트리
export class Interactions {
  constructor() { this.list = []; }
  add(o) { o.r ??= 1.8; this.list.push(o); return o; }
  remove(o) { const i = this.list.indexOf(o); if (i >= 0) this.list.splice(i, 1); }
  removeOwner(owner) { this.list = this.list.filter(o => o.owner !== owner); }
  // 카메라 앞 가장 적합한 대상
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
