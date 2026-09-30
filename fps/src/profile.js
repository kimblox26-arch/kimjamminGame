// 플레이어 프로필: 닉네임 · 포인트 · 총기별 업그레이드 — 로컬 저장(+로그인 시 클라우드 동기화)
export const UPGRADES = [
  { k: 'dmg', name: '화력', desc: '탄 피해 +8%/단계', max: 5, cost: 120 },
  { k: 'rec', name: '반동 제어', desc: '반동 −9%/단계', max: 5, cost: 100 },
  { k: 'mag', name: '확장 탄창', desc: '탄창·예비탄 +12%/단계', max: 5, cost: 90 },
  { k: 'rel', name: '재장전 숙련', desc: '재장전 속도 +9%/단계', max: 5, cost: 80 },
  { k: 'ads', name: '조준 속도', desc: '정조준 시간 −8%/단계', max: 5, cost: 70 },
  { k: 'acc', name: '정확도', desc: '지향사격 산포 −10%/단계', max: 5, cost: 90 },
];
export const upgradeCost = (u, lvl) => Math.round(u.cost * (1 + lvl * 0.85));

const KEY = 'kjm-fps-profile';
export class Profile {
  constructor() {
    this.nick = ''; this.points = 0; this.up = {}; this.uid = null; this.provider = 'guest'; this.best = 0; this.kills = 0;
    this.listeners = [];
    this.load();
  }
  load() { try { Object.assign(this, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* 저장소 사용 불가 */ } this.listeners = this.listeners || []; }
  data() { return { nick: this.nick, points: this.points, up: this.up, best: this.best, kills: this.kills }; }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify({ ...this.data(), uid: this.uid, provider: this.provider })); } catch { /* 무시 */ }
    for (const f of this.listeners) try { f(this); } catch { /* 무시 */ }
  }
  onChange(f) { this.listeners.push(f); }
  level(id, k) { return this.up[id]?.[k] || 0; }
  buy(id, u) {
    const lv = this.level(id, u.k);
    if (lv >= u.max) return false;
    const c = upgradeCost(u, lv);
    if (this.points < c) return false;
    this.points -= c; (this.up[id] || (this.up[id] = {}))[u.k] = lv + 1;
    this.save(); return true;
  }
  add(n) { this.points += n; this.save(); }
}

// 업그레이드가 반영된 무기 제원 (원본 def 는 유지)
export function applyUpgrades(base, L = {}) {
  const l = (k) => L[k] || 0, r = base.recoil || {};
  const d = { ...base, recoil: { ...r } };
  d.dmg = base.dmg * (1 + 0.08 * l('dmg'));
  d.recoil.v = (r.v || 0) * (1 - 0.09 * l('rec')); d.recoil.h = (r.h || 0) * (1 - 0.09 * l('rec')); if (r.kick) d.recoil.kick = r.kick * (1 - 0.06 * l('rec'));
  d.mag = Math.round(base.mag * (1 + 0.12 * l('mag'))); d.reserve = Math.round((base.reserve || 0) * (1 + 0.12 * l('mag')));
  d.reloadRate = 1 + 0.09 * l('rel');
  d.adsTime = (base.adsTime || 0.22) * (1 - 0.08 * l('ads'));
  d.spreadHip = (base.spreadHip || 2) * (1 - 0.1 * l('acc')); d.moveSpread = (base.moveSpread || 2) * (1 - 0.08 * l('acc'));
  return d;
}
