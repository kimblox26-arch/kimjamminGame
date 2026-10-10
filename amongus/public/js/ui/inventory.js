// 인벤토리(장착) / 상점(구매) / 로비 꾸미기
import { $, $$, h, stage, modal, toast, sfx, net, profile, saveProfile } from '../core.js';
import { COLORS, ITEMS, ITEM_TABS } from '../shared/data.js';
import { crewSVG, itemSVG } from './crew.js';
import { screens, go } from './nav.js';
import { updateTop } from './menu.js';

const owns = (type, it) => it[3] === 'free' || profile.owned.includes(`${type}:${it[0]}`);
const sendLook = () => net.send({ t: 'look', look: profile.look });

function grid(type, mode, taken = new Set()) {
  if (type === 'color') {
    return COLORS.map((c, i) => `<button class="itm ${profile.look.color === i ? 'on' : ''} ${taken.has(i) ? 'lock' : ''}" data-color="${i}">
      <div class="colorsw" style="background:linear-gradient(160deg,${c[1]} 60%,${c[2]} 60%)"></div><span class="nm">${c[0]}</span></button>`).join('');
  }
  return ITEMS[type].filter(it => (mode === 'shop' ? it[3] === 'shop' : true)).map(it => {
    const own = owns(type, it), on = profile.look[type] === it[0];
    const tag = mode === 'shop' ? (own ? '보유' : `🫘${it[2]}`) : own ? '' : it[3] === 'code' ? '🔒코드' : `🫘${it[2]}`;
    return `<button class="itm ${on && mode !== 'shop' ? 'on' : ''} ${own || mode === 'shop' ? '' : 'lock'}" data-id="${it[0]}">${itemSVG(type, it[0], profile.look.color)}
      <span class="price">${tag}</span><span class="nm">${it[1]}</span></button>`;
  }).join('');
}

function itemClick(type, id, mode, after) {
  const it = ITEMS[type].find(x => x[0] === id);
  if (mode === 'shop') {
    if (owns(type, it)) return toast('이미 가지고 있는 아이템입니다.');
    if (profile.beans < it[2]) return toast(`콩이 부족합니다. (필요: ${it[2]})`);
    profile.beans -= it[2]; profile.owned.push(`${type}:${id}`); saveProfile(); sfx('task');
    toast(`${it[1]}을(를) 구매했습니다! 인벤토리에서 장착하세요.`);
  } else {
    if (!owns(type, it)) return toast(it[3] === 'code' ? '보상 교환 코드로 얻을 수 있는 아이템입니다. (내 계정 → 보상 교환)' : '상점에서 구매할 수 있습니다.');
    profile.look[type] = id; saveProfile(); sfx('click'); sendLook();
  }
  after();
}

function shell(mode) {
  let tab = mode === 'shop' ? 'hat' : 'color';
  const tabs = mode === 'shop' ? ITEM_TABS.filter(([k]) => ITEMS[k].some(i => i[3] === 'shop')) : [['color', '색상'], ...ITEM_TABS];
  const el = h(`<div class="screen inv"><button class="back2">뒤로</button><div class="titlebar">${mode === 'shop' ? '상점' : '인벤토리'}</div><div class="beans"></div>
    <div class="preview"><div class="pv"></div><div class="pname"></div></div><div class="itabs">${tabs.map(([k, n]) => `<button data-t="${k}">${n}</button>`).join('')}</div><div class="grid"></div></div>`);
  stage().replaceChildren(el);
  const draw = () => {
    $('.beans', el).textContent = `🫘 ${profile.beans}`;
    $('.pv', el).innerHTML = crewSVG(profile.look);
    $('.pname', el).textContent = mode === 'shop' ? '콩은 게임을 하거나 매일 +1 별을 눌러 모을 수 있어요' : COLORS[profile.look.color][0];
    $$('.itabs button', el).forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    $('.grid', el).innerHTML = grid(tab, mode);
  };
  $('.grid', el).onclick = e => {
    const b = e.target.closest('.itm');
    if (!b) return;
    if (b.dataset.color) { profile.look.color = +b.dataset.color; saveProfile(); sfx('click'); sendLook(); draw(); }
    else itemClick(tab, b.dataset.id, mode, draw);
  };
  $$('.itabs button', el).forEach(b => b.onclick = () => { sfx('click'); tab = b.dataset.t; draw(); });
  $('.back2', el).onclick = () => { sfx('click'); go('menu'); updateTop(); };
  if (mode === 'shop') { profile.shopSeen = true; saveProfile(); }
  draw();
}
screens.inventory = () => shell('inv');
screens.shop = () => shell('shop');

// 로비의 노트북/상자: 꾸미기 창 (다른 사람이 쓰는 색은 고를 수 없음)
screens.customize = (takenColors, startTab = 'color') => {
  let tab = startTab;
  const m = modal(`<div style="width:1100px;height:560px;position:relative"><div class="itabs" style="display:flex;gap:6px;margin-left:420px">
    ${[['color', '색상'], ...ITEM_TABS].map(([k, n]) => `<button data-t="${k}" class="obtn" style="min-width:0;height:48px;font-size:22px;padding:0 14px">${n}</button>`).join('')}</div>
    <div class="pv" style="position:absolute;left:0;top:40px;width:400px;height:300px"></div>
    <div class="grid" style="position:absolute;left:420px;right:0;top:70px;bottom:0;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,128px);gap:10px;align-content:start"></div></div>`);
  const draw = () => {
    $('.pv', m.el).innerHTML = crewSVG(profile.look);
    $$('[data-t]', m.el).forEach(b => b.classList.toggle('on', b.dataset.t === tab));
    $('.grid', m.el).innerHTML = grid(tab, 'inv', takenColors());
  };
  $('.grid', m.el).onclick = e => {
    const b = e.target.closest('.itm');
    if (!b) return;
    if (b.dataset.color) {
      if (takenColors().has(+b.dataset.color)) return toast('다른 플레이어가 사용 중인 색입니다.');
      profile.look.color = +b.dataset.color; saveProfile(); sfx('click'); sendLook(); draw();
    } else itemClick(tab, b.dataset.id, 'inv', draw);
  };
  $$('[data-t]', m.el).forEach(b => b.onclick = () => { sfx('click'); tab = b.dataset.t; draw(); });
  draw();
  return m;
};
