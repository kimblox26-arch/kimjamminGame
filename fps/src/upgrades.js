// 총기 업그레이드 창 — 처치 포인트로 총기별 화력·반동·탄창·재장전·조준·정확도 강화 (단계별 비용 증가)
import { UPGRADES, upgradeCost } from './profile.js';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const pct = (a, b, inv = false) => { const d = Math.round((b / a - 1) * 100); if (!d) return ''; return `<em>${(inv ? -d : d) > 0 ? '+' : ''}${inv ? -d : d}%</em>`; };

export class UpgradeShop {
  constructor(game) {
    this.g = game; this.sel = null;
    $('btn-upgrade').onclick = () => this.open('menu');
    $('btn-upgrade2').onclick = () => this.open('pause');
    $('btn-upgrade-done').onclick = () => this.close();
    $('up-guns').addEventListener('click', (e) => { const b = e.target.closest('.ug'); if (b) { this.sel = b.dataset.id; this.render(); } });
    $('up-detail').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]'); if (!b) return;
      const u = UPGRADES.find((x) => x.k === b.dataset.k);
      if (this.g.profile.buy(this.sel, u)) { Audio.play('pickup', { vol: 0.6, bus: 'ui' }); this.g.weapons.refreshUpgrades(); this.render(); }
      else Audio.play('dry', { vol: 0.5, bus: 'ui' });
    });
  }
  open(from) {
    this.from = from;
    if (!this.sel) this.sel = this.g.weapons.cur.def.id;
    this.render(); this.g.showScreen('upgrade');
  }
  close() { if (this.from === 'game') this.g.resume(); else this.g.showScreen(this.from || 'menu'); }

  render() {
    const P = this.g.profile, W = this.g.weapons;
    $('up-pts').textContent = P.points.toLocaleString();
    $('up-guns').innerHTML = W.list.map((w) => {
      const n = UPGRADES.reduce((s, u) => s + P.level(w.base.id, u.k), 0);
      return `<button class="ug ${w.base.id === this.sel ? 'on' : ''}" data-id="${w.base.id}">${w.base.name}<small>${n}/${UPGRADES.length * 5}</small></button>`;
    }).join('');
    const w = W.list.find((x) => x.base.id === this.sel) || W.list[0], b = w.base, d = w.def;
    const rows = UPGRADES.map((u) => {
      const lv = P.level(b.id, u.k), max = lv >= u.max, c = upgradeCost(u, lv);
      return `<div class="urow"><div><b>${u.name}</b><small>${u.desc}</small></div><div class="lv">${Array.from({ length: u.max }, (_, i) => `<i class="${i < lv ? 'f' : ''}"></i>`).join('')}</div>
        <button data-k="${u.k}" ${max || P.points < c ? 'disabled' : ''}>${max ? '최대' : `${c} P 강화`}</button></div>`;
    }).join('');
    $('up-detail').innerHTML = `<h3>${b.name}</h3><div class="ud-sub">${b.cal} · ${b.cat || ''}</div>
      <div class="ustats"><div><span>피해</span> ${d.dmg.toFixed(0)} ${pct(b.dmg, d.dmg)}</div><div><span>탄창</span> ${d.mag} ${pct(b.mag, d.mag)}</div><div><span>반동</span> ${(d.recoil.v).toFixed(2)} ${pct(b.recoil.v, d.recoil.v, true)}</div>
      <div><span>재장전</span> ×${d.reloadRate.toFixed(2)}</div><div><span>조준</span> ${(d.adsTime * 1000).toFixed(0)}ms ${pct(b.adsTime || 0.22, d.adsTime, true)}</div><div><span>지향사격</span> ${d.spreadHip.toFixed(2)}° ${pct(b.spreadHip, d.spreadHip, true)}</div></div>${rows}`;
  }
}
