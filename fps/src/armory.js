// 무기고 — 주무기/보조무기 선택 (TAB 또는 메뉴에서)
import { DEFS } from './weapons.js';

const $ = (id) => document.getElementById(id);
const CATS = ['돌격소총', '기관단총', '경기관총', '지정사수소총', '저격소총', '대물저격총', '산탄총', '권총'];
const bar = (v) => `<i><u style="width:${Math.round(Math.min(1, v) * 100)}%"></u></i>`;

export class Armory {
  constructor(game) {
    this.g = game; this.tab = 0;
    this.el = $('armory-list');
    $('arm-tab0').onclick = () => this.setTab(0);
    $('arm-tab1').onclick = () => this.setTab(1);
    $('btn-armory-done').onclick = () => this.close();
    this.el.addEventListener('click', (e) => {
      const c = e.target.closest('.wcard'); if (!c) return;
      this.g.weapons.setLoadout(this.tab, c.dataset.id);
      this.g.weapons.slot = this.tab;
      this.render();
    });
  }

  open(from) {
    this.from = from;
    this.render();
    this.g.showScreen('armory');
  }

  close() {
    this.g.saveLoadout?.();
    if (this.from === 'game') this.g.resume(); else this.g.showScreen(this.from || 'menu');
  }

  setTab(t) { this.tab = t; this.render(); }

  render() {
    const W = this.g.weapons, cur = W.list[W.loadout[this.tab]].def.id;
    $('arm-tab0').classList.toggle('on', this.tab === 0);
    $('arm-tab1').classList.toggle('on', this.tab === 1);
    $('arm-cur').textContent = `1 ${W.list[W.loadout[0]].def.name}  ·  2 ${W.list[W.loadout[1]].def.name}`;
    const defs = DEFS.filter((d) => (this.tab === 1) === (d.slot === 1));
    let h = '';
    for (const cat of CATS) {
      const L = defs.filter((d) => d.cat === cat); if (!L.length) continue;
      h += `<h4>${cat}</h4><div class="wgrid">`;
      for (const d of L) {
        const dps = d.dmg * (d.pellets || 1) * Math.min(d.rpm, 900) / 60;
        h += `<div class="wcard${d.id === cur ? ' on' : ''}" data-id="${d.id}">
          <b>${d.name}</b><small>${d.cal}${d.scope ? ` · ${d.scope}배율` : ''}</small>
          <div class="st"><span>위력</span>${bar(Math.sqrt(d.dmg * (d.pellets || 1) / 260))}<span>연사</span>${bar(d.rpm / 1100)}<span>사거리</span>${bar(d.range[1] / 800)}<span>DPS</span>${bar(dps / 600)}</div>
          <p>${d.desc || ''}</p><em>${d.mag}발 · ${d.modes.join('/')}</em></div>`;
      }
      h += '</div>';
    }
    this.el.innerHTML = h;
  }
}
