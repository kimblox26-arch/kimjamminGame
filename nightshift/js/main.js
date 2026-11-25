// 시작점: 렌더러, 1인칭 카메라(드래그로 둘러보기, 탭으로 집기), 메인 화면, 로딩, 설정
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildStore, SPOT } from './store.js';
import { loadPeople, Person } from './people.js';
import { buildHands } from './hands.js';
import { Audio, Native, voiceGender } from './audio.js';
import { Voice } from './voice.js';
import { Game } from './game.js';
import { loadVehicles, CAR_COLORS } from './vehicles.js';
import { TYPES } from './data.js';
import { updateLiquids } from './products.js';
import { billMesh, coinMesh } from './counter.js';
import { $, show, modal, toast, mine, ic, paintIcons, won } from './ui.js';
import { buildCity, makeTraffic } from './city.js';
import { buildStorage, buildCourt } from './places.js';
import { Mover, STORE_COLLIDERS } from './move.js';
import { Crime } from './crime.js';
import { makePistol, makeRifle } from './weapons.js';
import { MiniMap } from './map.js';
import { Pedestrians } from './peds.js';
import { buildUnderpass, UNDER } from './underpass.js';

const IS_MOBILE = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
const settings = Object.assign({ quality: IS_MOBILE ? 'mid' : 'high', myVoice: 'm', tts: true, sens: 1 }, JSON.parse(localStorage.getItem('ns_set') || '{}'));
const saveSet = () => { try { localStorage.setItem('ns_set', JSON.stringify(settings)); } catch (e) { } };

const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 1, 0.03, 260);
const yawObj = new THREE.Group(); yawObj.add(camera); scene.add(yawObj);
let composer = null;

function applyQuality() {
  const pr = { high: Math.min(devicePixelRatio, 2), mid: Math.min(devicePixelRatio, 1.4), low: Math.min(devicePixelRatio, 0.9) }[settings.quality];
  renderer.setPixelRatio(pr); resize();
  composer = null;
  if (settings.quality === 'high') {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.5, 1.6));
    composer.addPass(new OutputPass());
    composer.setSize(innerWidth, innerHeight);
  }
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.fov = camera.aspect < 1.2 ? 80 : 68; camera.updateProjectionMatrix();
  composer?.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

// ── 둘러보기 ──
const look = {
  yaw: Math.PI / 2, pitch: -0.36, target: null, menu: true,
  turnTo(y) { let d = y - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.target = this.yaw + d; },
  pitchTo(p) { this.ptarget = p; },
  update(dt) {
    if (this.target !== null) { const k = Math.min(1, dt * 6); this.yaw += (this.target - this.yaw) * k; if (Math.abs(this.target - this.yaw) < 0.002) this.target = null; }
    if (this.ptarget != null) { this.pitch += (this.ptarget - this.pitch) * Math.min(1, dt * 5); if (Math.abs(this.ptarget - this.pitch) < 0.003) this.ptarget = null; }
    yawObj.rotation.y = this.yaw; camera.rotation.x = this.pitch;
  },
};
let down = null;
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), id: e.pointerId }; audio.resume(); });
addEventListener('pointermove', e => {
  if (!down || down.id !== e.pointerId || look.menu || look.frozen) return;
  const dx = e.clientX - down.lx, dy = e.clientY - down.ly; down.lx = e.clientX; down.ly = e.clientY;
  const s = 0.0042 * settings.sens * (IS_MOBILE ? 1.2 : 1);
  look.target = null; look.ptarget = null; look.yaw -= dx * s; look.pitch = Math.max(-1.25, Math.min(0.6, look.pitch - dy * s));
});
addEventListener('pointerup', e => { if (down && down.id === e.pointerId) down = null; });
// 화면 가운데 점이 가리키는 것 (상품·담배·계산대·전자레인지)
const ray = new THREE.Raycaster(), center = new THREE.Vector2(0, 0);
let aimT = 0;
function updateAim(dt) {
  if (!game?.running || (aimT += dt) < 0.08) return; aimT = 0;
  ray.setFromCamera(center, camera); ray.far = 3.4;
  const C = store.C, list = [...game.items.filter(i => !i.scanned || i.cig).map(i => i.mesh), ...store.cigSlots, store.mw, C.pos, C.drawer.group, C.reader, store.counterHit, storage.shop, ...(store.merch.looseMeshes || [])];
  let aim = null, hitD = 99;
  for (const hit of ray.intersectObjects(list, true)) {
    let o = hit.object;
    if (o.userData.loose) { const e = o.userData.entries[hit.instanceId]; if (e?.messy) { aim = { type: 'mess', entry: e, label: '넘어진 상품 · 정리하기' }; hitD = hit.distance; break; } continue; }
    while (o && !o.userData.item && !o.userData.cig && !o.userData.aim) o = o.parent;
    if (!o) continue;
    hitD = hit.distance;
    if (o.userData.item) { const it = o.userData.item; if (it.scanned) continue; aim = { type: 'item', item: it, label: `${it.name} · ${it.price.toLocaleString()}원` }; }
    else if (o.userData.cig) aim = { type: 'cig', obj: o, label: `${o.userData.cig.id}번 ${o.userData.cig.name} · ${o.userData.cig.price.toLocaleString()}원` };
    else aim = { type: o.userData.aim, label: { mw: '전자레인지', guns: '총기 보관함', counter: '계산대' }[o.userData.aim] || '' };
    break;
  }
  // 사람 (총이면 멀리까지)
  ray.far = crime.weapon === 'fist' ? 2.4 : 40;
  const people = [...game.customers.filter(c => !c.dead).map(c => c.person.hitbox), ...(game.boss && !game.bossDead ? [game.boss.hitbox] : [])];
  const ph = ray.intersectObjects(people, false)[0];
  if (ph && ph.distance < hitD) { const pr = ph.object.userData.personRef, c = game.customers.find(x => x.person === pr) || (game.boss === pr ? game.bossC : null); if (c) aim = { type: 'person', c, label: `${c.type.name}` }; }
  game.aim = aim;
  const dot = $('dot'); dot.className = aim ? 'on ' + aim.type : '';
  $('aimLabel').textContent = aim ? aim.label : '';
  $('bScan').querySelector('b').textContent = { cig: '담배 꺼내기', mw: '데우기', mess: '정리하기', guns: '총 꺼내기' }[aim?.type] || '바코드 찍기';
  $('bScan').classList.toggle('ready', !!aim && !['counter', 'person'].includes(aim.type));
  $('bPay').classList.toggle('ready', !!aim && aim.type !== 'cig' && !!game.cur && !game.items.some(i => !i.scanned && !i.refund));
  $('bAtk').classList.toggle('ready', aim?.type === 'person');
}
// 키보드 (PC)
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space' && game?.running) { e.preventDefault(); voice.toggle(); }
  if (e.key === 'Escape') pause();
  if (e.code === 'KeyR' && game?.running) crime?.reload();
});

// ── 소리·목소리·음성인식 ──
const audio = new Audio(); audio.voiceOn = settings.tts;
const reloadVoices = () => audio.loadVoices(settings);
window.__nativeTtsReady = reloadVoices; reloadVoices();
if (window.speechSynthesis) speechSynthesis.onvoiceschanged = reloadVoices;
const voice = new Voice({
  onText: t => game?.hear(t),
  onPartial: t => mine(t, true),
  onLevel: v => ($('micLvl').style.transform = `scaleY(${v})`),
  onState: (s, err) => {
    $('bMic').classList.toggle('on', s === 'on'); $('micTxt').textContent = s === 'on' ? '듣는 중… (다시 누르면 끝)' : '누르고 말하기';
    if (s !== 'on') $('micLvl').style.transform = 'scaleY(0)';
    if (s === 'error' && ['unsupported', 'not-allowed', 'perm', 'service-not-allowed'].includes(err) && game) { game.voiceOK = false; }
    if (s === 'error') toast(err === 'unsupported' ? '이 기기는 음성인식이 안 돼요<br><small>상황마다 대답 버튼이 나와요</small>' : (err === 'no-speech' || err === '7' || err === '6' ? '잘 안 들렸어요. 다시 말해주세요' : (err === 'not-allowed' || err === 'perm' ? '마이크 권한을 허용해 주세요' : '음성인식 오류: ' + err)), 'bad', 2200);
  },
});

let store, hands, game, vehicles, city, traffic, storage, mover, crime, minimap, under, sky, hemi, ugLight, peds;
paintIcons();
async function boot() {
  const bar = $('loadbar'), txt = $('loadtxt'); let p = [0, 0, 0];
  const prog = () => (bar.style.width = (p[0] * 20 + p[1] * 60 + p[2] * 20) + '%');
  applyQuality();
  store = buildStore(renderer, scene, settings.quality);
  txt.textContent = '손님 모델 불러오는 중…';
  await Promise.all([
    audio.init(v => { p[0] = v; prog(); }),
    loadPeople(v => { p[1] = v; prog(); }),
    buildHands(camera, yawObj, $('pname').value).then(h => { hands = h; p[2] = 1; prog(); }),
    loadVehicles(scene).then(v => { vehicles = v; window.__veh = v; }),
  ]);
  // 도시·창고·법정·충돌·이동·범죄
  const colliders = [...STORE_COLLIDERS];
  city = buildCity(scene, { onCollider: c => colliders.push(c), holes: UNDER.stairs });
  under = buildUnderpass(scene, c => colliders.push(c)); buildSky();
  storage = buildStorage(scene, c => colliders.push(c));
  const courtB = buildCourt(scene);
  vehicles.car.visible = false; traffic = makeTraffic(scene, vehicles, audio, CAR_COLORS);
  mover = new Mover({ yawObj, camera, look, audio, colliders }); Person.blockers = colliders;
  game = new Game({ renderer, scene, camera, store, hands, audio, voice, settings, look });
  crime = new Crime({ game, scene, camera, yawObj, look, audio, hands, vehicles, mover });
  // 총기 보관함 안: 소총 2정(세워서) + 권총 2정(선반 위)
  { const cab = storage.cabinet; for (const dx of [-0.17, 0.17]) { const r = makeRifle(); r.rotation.set(Math.PI / 2, 0, 0); r.position.set(dx, 1.32, -0.2); cab.add(r); }
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.3), new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.6, roughness: 0.4 })); shelf.position.set(0, 0.42, -0.12); cab.add(shelf);
    for (const dx of [-0.15, 0.15]) { const p = makePistol(); p.rotation.set(0, Math.PI / 2 + 0.2, Math.PI / 2); p.position.set(dx, 0.45, -0.12); cab.add(p); } }
  peds = new Pedestrians({ scene, audio, game, crime, yawObj, camera }); crime.peds = peds;
  minimap = new MiniMap({ city, yawObj, look, markers: () => {
    const out = [];
    for (const c of peds.list) out.push({ x: c.person.root.position.x, z: c.person.root.position.z, kind: c.dead ? 'dead' : 'person' });
    for (const c of game.customers) out.push({ x: c.person.root.position.x, z: c.person.root.position.z, kind: c.dead ? 'dead' : 'person' });
    if (game.boss) out.push({ x: game.boss.root.position.x, z: game.boss.root.position.z, kind: game.bossDead ? 'dead' : 'person' });
    for (const o of crime.officers) out.push({ x: o.root.position.x, z: o.root.position.z, kind: o.dead ? 'dead' : 'cop' });
    for (const P of crime.cars || []) out.push({ x: P.car.position.x, z: P.car.position.z, kind: 'police', r: 1.6 });
    return out;
  } });
  crime.courtGroup = courtB.court; crime.worldRoots = [store.root, city.root, storage.group, courtB.court, under.group];
  crime.onExit = () => { crime.cleanup(); peds.clear(); toMenu(); }; crime.onRestart = () => { crime.cleanup(); peds.clear(); startShift(1); };
  game.crime = crime; game.onShop = () => openShop(); game.mover = mover; game.yawObjDist = () => Math.hypot(yawObj.position.x - SPOT.cam.x, yawObj.position.z - SPOT.cam.z);
  game.onExit = () => toMenu(); game.onNext = (d) => startShift(d);
  window.__ns = { game, look, store, hands, camera, scene, yawObj, audio, THREE, Person, TYPES, billMesh, coinMesh, renderer, crime, mover, traffic, city, minimap, under, peds };
  store.mw.userData.aim = 'mw';
  for (const o of [store.C.pos, store.C.drawer.group, store.C.reader]) o.userData.aim = 'counter';
  const hitBox = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.08, 3.6), new THREE.MeshBasicMaterial()); hitBox.visible = false; hitBox.position.set(2.6, 0.93, 0.6); hitBox.userData.aim = 'counter'; scene.add(hitBox); store.counterHit = hitBox;
  game.voiceOK = voice.available;
  // 미리 한 번 그려서 셰이더 컴파일
  renderer.compile(scene, camera);
  show('loading', false);
  toMenu();
  requestAnimationFrame(loop);
}

function toMenu() {
  game?.stop(); look.menu = true; setHands(false); if (mover) mover.enabled = false; look.frozen = false;
  $('loading').classList.remove('show'); $('menu').classList.add('show');
  const sv = JSON.parse(localStorage.getItem('ns_save') || '{}'), best = JSON.parse(localStorage.getItem('ns_best') || '{}');
  if (sv.name) $('pname').value = sv.name;
  $('bStart').textContent = sv.day > 1 ? `출근하기 (${sv.day}일차)` : '출근하기';
  $('record').textContent = best.day ? `최고 기록: ${best.day}일차 · ${best.grade}등급` : '';
}
function setHands(on) { if (!hands) return; hands.enabled = on; hands.body.visible = on; }
function startShift(day) {
  const name = ($('pname').value || '김잼민').slice(0, 4);
  audio.resume(); audio.startAmbience(SPOT.outside);
  hands.setName(name);
  const f = $('fade'); f.classList.add('on');
  setTimeout(() => {
    $('menu').classList.remove('show'); show('modal', false);
    game.stop(); look.menu = false; setHands(true); crime.cleanup(); mover.enabled = true; updateWallet();
    yawObj.position.copy(SPOT.cam); look.yaw = Math.PI / 2; look.pitch = -0.36; look.target = null;
    game.start(day, name);
    f.classList.remove('on');
    if (Native?.requestMic) Native.requestMic();
  }, 650);
}
$('bStart').onclick = () => { const sv = JSON.parse(localStorage.getItem('ns_save') || '{}'); startShift(sv.day || 1); };
$('bNew').onclick = () => { try { localStorage.removeItem('ns_save'); } catch (e) { } startShift(1); };
$('bHelp').onclick = () => help();
$('bSet').onclick = () => openSettings();
function help() {
  modal(`<h2>근무 수칙</h2>
  <h3>조작</h3><ul><li>왼쪽 아래 <b>조이스틱</b>으로 걷기 (PC: WASD, Shift 달리기) · 화면을 <b>끌어서</b> 둘러보기</li><li>화면 가운데 <b>점</b>을 맞추고 버튼: 바코드 찍기 · 계산하기 · 정리하기(넘어진 상품) · 상점(창고)</li><li>STAFF ONLY 문 → <b>창고</b>, 출입문 → <b>바깥 거리</b></li><li>공격 버튼: 주먹/권총(창고 상점) — 사람을 해치면 경찰이 와서 체포하고 재판을 받아요</li><li>${ic('mic')} 버튼을 누르고 <b>실제로 말하면</b> 손님이 알아듣고 반응해요 (PC는 스페이스바)</li><li>${ic('talk')} 말하기: 마이크가 안 될 때 문장을 골라 말하기</li></ul>
  <h3>계산 순서</h3><ul><li>손님이 들어오면 <b>"어서오세요!"</b></li><li>계산대 위 상품을 눌러 바코드 찍기 · 담배는 <b>${ic('turn')} 뒤돌아</b> 번호 찾아 집기</li><li>카드: ${ic('pos')} 포스 → 카드결제</li><li>현금: 지폐 눌러 받기 → 포스에 <b>받은 금액</b> 입력 → 현금결제 → ${ic('cash')} 돈통에서 <b>거스름돈을 직접</b> 세서 건네기</li><li>끝나면 <b>"감사합니다, 안녕히 가세요!"</b></li></ul>
  <h3>주의</h3><ul><li>술·담배: 어려 보이면 <b>"신분증 보여주세요"</b> (2007년생까지 판매 가능)</li><li>진상: 취객·반말·깎아달라·환불·도둑… 침착하게 말로 대처, 심하면 ${ic('siren')} 112</li><li>CCTV 가 깜빡이면 누가 물건을 숨긴 것! "계산 안 하신 거 있으시죠?"</li><li>아침 6시에 사장님이 시재(돈통)를 점검합니다</li></ul>`, [['닫기', 'blue', () => { }]]);
}
function openSettings(back) {
  reloadVoices();
  const sel = (id, opts, v) => `<select id="${id}">${opts.map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const vLabel = n => { const g = voiceGender(n), short = n.replace(/^ko-kr-x-|^ko-KR-?/i, '').replace(/-local$/i, ' (기기)').replace(/-network$/i, ' (온라인)'); return (g === 'm' ? '남 · ' : g === 'f' ? '여 · ' : '') + short; };
  const vOpts = [['', '자동']].concat((audio.voices || []).map(v => [v.name, vLabel(v.name)]));
  let eng = null; try { eng = Native?.engines ? JSON.parse(Native.engines()) : null; } catch (e) { }
  const engRow = eng?.list?.length ? `<div class="opt">음성 엔진 ${sel('sE', eng.list.map(e => [e.name, e.label]), Native.engine?.() || eng.current)}</div>` : '';
  modal(`<h2>설정</h2>
    <div class="opt">그래픽 ${sel('sQ', [['high', '상 (빛 번짐)'], ['mid', '중'], ['low', '하 (빠름)']], settings.quality)}</div>
    <div class="opt">내 목소리 ${sel('sMy', [['m', '남자'], ['f', '여자']], settings.myVoice || 'm')}</div>
    <div class="opt">손님 목소리 ${sel('sT', [['1', '켜기'], ['0', '끄기 (자막만)']], settings.tts ? '1' : '0')}</div>
    ${engRow}
    <div class="opt">남자 목소리 <span>${sel('sVM', vOpts, settings.voiceM || '')} <button class="gray mini" id="tVM">듣기</button></span></div>
    <div class="opt">여자 목소리 <span>${sel('sVF', vOpts, settings.voiceF || '')} <button class="gray mini" id="tVF">듣기</button></span></div>
    <div class="opt">시점 감도 ${sel('sS', [['0.6', '느리게'], ['1', '보통'], ['1.5', '빠르게']], String(settings.sens))}</div>
    <p style="margin-top:10px;font-size:12px;color:#8a97a6">목소리: ${(audio.voices || []).length ? `한국어 목소리 ${audio.voices.length}개 (남 ${audio.vm.length} · 여 ${audio.vf.length})` : '한국어 목소리를 찾지 못했어요. 폰 설정 → 텍스트 음성 변환에서 한국어 음성 데이터를 설치하세요'}<br>
    음성인식: ${Native ? '앱 내장 (안드로이드 음성인식)' : (voice.available ? '브라우저 음성인식 (크롬 권장)' : '이 브라우저는 지원 안 함 → 말하기 버튼 사용')}</p>`,
    [['저장', 'blue', () => {
      settings.quality = $('sQ').value; settings.myVoice = $('sMy').value; settings.tts = $('sT').value === '1'; settings.sens = +$('sS').value;
      settings.voiceM = $('sVM').value; settings.voiceF = $('sVF').value;
      if ($('sE') && $('sE').value !== (Native.engine?.() || '')) { Native.setEngine($('sE').value); settings.voiceM = settings.voiceF = ''; }
      audio.voiceOn = settings.tts; saveSet(); reloadVoices(); applyQuality(); game?.renderPos(); if (back) pause();
    }]]);
  const test = (g, id) => { settings[g === 'm' ? 'voiceM' : 'voiceF'] = $(id).value; reloadVoices(); audio.resume(); audio.speak(g === 'm' ? '어서오세요. 봉투 필요하세요?' : '안녕하세요, 카드 결제 도와드릴게요.', { gender: g }); };
  $('tVM').onclick = () => test('m', 'sVM'); $('tVF').onclick = () => test('f', 'sVF');
}
function pause() {
  if (!game?.running) return;
  game.paused = true;
  modal(`<h2>일시정지</h2><p>${game.clock()} · ${game.day}일차</p>`, [['메인으로', 'gray', () => { game.paused = false; toMenu(); }], ['설정', 'gray', () => { openSettings(true); return false; }], ['계속하기', 'blue', () => { game.paused = false; }]]);
}
window.__nativeBack = () => {
  for (const id of ['pos', 'drawer', 'talk', 'idcard', 'modal']) if (!$(id).classList.contains('hidden')) { if (id === 'modal' && game?.paused) game.paused = false; show(id, false); return; }
  pause();
};
// HUD 버튼
$('bScan').onclick = () => { audio.resume(); game.doPrimary(); };
$('bPay').onclick = () => { audio.resume(); game.doCheckout(); };
$('bTurn').onclick = () => look.turnTo(Math.abs(Math.atan2(Math.sin(look.yaw - Math.PI / 2), Math.cos(look.yaw - Math.PI / 2))) < 1.5 ? -Math.PI / 2 : Math.PI / 2);
$('bMic').onclick = () => { audio.resume(); voice.toggle(); };
$('b112').onclick = () => game.call112();
$('bPause').onclick = () => pause();
const atk = $('bAtk');
atk.addEventListener('pointerdown', e => { e.preventDefault(); audio.resume(); crime.press(); });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) atk.addEventListener(ev, () => crime.release());
// 무기 버튼: 짧게 = 무기 바꾸기, 길게 누르기 = 탄창 갈기
{ let t0 = 0, lp = null; const b = $('bWpn');
  b.addEventListener('pointerdown', () => { t0 = performance.now(); lp = setTimeout(() => { lp = null; crime.reload(); }, 450); });
  b.addEventListener('pointerup', () => { if (lp) { clearTimeout(lp); lp = null; crime.cycle(); } });
  b.addEventListener('pointerleave', () => { if (lp) { clearTimeout(lp); lp = null; } }); void t0; }
$('pname').onchange = () => hands?.setName($('pname').value || '김잼민');

// ── 메인 루프 ──
const clock = new THREE.Clock(); let posT = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
  if (look.menu) {
    yawObj.position.set(-1.6 + Math.sin(t * 0.08) * 1.6, 1.55, 11.5); look.yaw = Math.sin(t * 0.05) * 0.08 - 0.1; look.pitch = -0.02;
  }
  look.update(dt);
  game?.update(dt * (window.__speed || 1));
  if (game?.running) mover.update(dt);
  traffic?.update(dt, game?.running ? yawObj.position : null); city?.update(dt); crime?.update(dt);
  hands?.update(dt, t);
  updateAim(dt); updateLiquids(dt);
  if (game?.running) minimap?.update(dt);
  if (game?.running && !crime?.inCourt) peds?.update(dt, true);
  if (game?.running) doors(dt);
  if (game?.running && (posT += dt) > 0.5) { posT = 0; game.renderPos(); }
  envUpdate(dt);
  camera.updateMatrixWorld();
  audio.setListener(camera.getWorldPosition(new THREE.Vector3()), camera.getWorldQuaternion(new THREE.Quaternion()));
  composer ? composer.render() : renderer.render(scene, camera);
}
// 밤하늘(그라데이션·별·달) — 내 위치를 따라다님
function buildSky() {
  const geo = new THREE.SphereGeometry(240, 32, 16), mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'varying vec3 vP; void main(){ float h = clamp(vP.y, -0.1, 1.); vec3 top = vec3(0.01,0.015,0.04), hor = vec3(0.09,0.07,0.09); vec3 c = mix(hor, top, pow(max(h,0.),0.45)); gl_FragColor = vec4(c,1.); }' });
  sky = new THREE.Group(); const dome = new THREE.Mesh(geo, mat); dome.renderOrder = -2; sky.add(dome);
  const sp = []; for (let i = 0; i < 900; i++) { const v = new THREE.Vector3().randomDirection(); if (v.y < 0.12) v.y = 0.12 + Math.random() * 0.8; v.normalize().multiplyScalar(230); sp.push(v.x, v.y, v.z); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  sky.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd8ff, size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.75, depthWrite: false })));
  const mc = document.createElement('canvas'); mc.width = mc.height = 128; const g = mc.getContext('2d'); const gr = g.createRadialGradient(64, 64, 20, 64, 64, 64); gr.addColorStop(0, 'rgba(255,250,230,1)'); gr.addColorStop(0.42, 'rgba(255,245,215,1)'); gr.addColorStop(0.5, 'rgba(255,240,200,.35)'); gr.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); g.fillStyle = 'rgba(200,190,170,.35)'; for (const [x, y, r] of [[54, 52, 7], [72, 70, 9], [60, 78, 5]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(mc), fog: false, depthWrite: false })); moon.position.set(-90, 120, -170); moon.scale.setScalar(26); sky.add(moon);
  scene.add(sky);
  scene.traverse(o => { if (o.isHemisphereLight) hemi = o; });
  ugLight = new THREE.PointLight(0xf2f6ff, 0, 16, 1.4); scene.add(ugLight);
}
// 실내·바깥·지하에 따라 안개 거리와 빛 바꾸기
function envUpdate(dt) {
  if (!sky) return;
  const p = yawObj.position, feet = p.y - 1.55, ug = feet < -1.2 && Math.abs(p.z) < 40, inStore = p.x > -5.4 && p.x < 5 && p.z > -8.2 && p.z < 4.2 && !ug;
  const k = Math.min(1, dt * 2.5), fn = ug ? 10 : inStore ? 14 : 30, ff = ug ? 60 : inStore ? 50 : 200;
  scene.fog.near += (fn - scene.fog.near) * k; scene.fog.far += (ff - scene.fog.far) * k;
  sky.position.copy(camera.getWorldPosition(new THREE.Vector3())); sky.visible = !ug;
  ugLight.intensity += ((ug ? 14 : 0) - ugLight.intensity) * k; ugLight.position.set(p.x, UNDER.ceil - 0.5, p.z);
  if (hemi) hemi.intensity += ((ug ? 0.85 : 0.32) - hemi.intensity) * k;
}
// 지나가는 차
// 문: 가까이 가면 자동으로 열림 (출입문은 딩동)
function doors(dt) {
  const p = yawObj.position;
  if (Math.hypot(p.x - 1.1, p.z - 4) < 1.6) game.openDoor();
  const sd = store.staffDoor, want = Math.hypot(p.x - 3.6, p.z + 4) < 1.4 ? 1 : 0;
  sd.userData.a = (sd.userData.a || 0) + (want - (sd.userData.a || 0)) * Math.min(1, dt * 5);
  if (want && !sd.userData.open) { audio.play('door', { pos: new THREE.Vector3(3.6, 1, -4), vol: 0.5, rate: 0.85 }); } sd.userData.open = want;
  sd.rotation.y = sd.userData.a * 1.45;
}
// 지갑 (월급 모아서 창고 상점에서 사용)
const wallet = { get() { try { return +(localStorage.getItem('ns_wallet') ?? 50000); } catch (e) { return 50000; } }, set(v) { try { localStorage.setItem('ns_wallet', String(v)); } catch (e) { } updateWallet(); } };
function updateWallet() { const el = $('wallet'); if (el) el.textContent = won(wallet.get()); $('bWpn').classList.toggle('hidden', !crime?.hasGun); }
window.__wallet = wallet;
function openShop() {
  const has = crime.hasGun, price = 35000;
  modal(`<h2>${ic('cash')} 창고 상점</h2><p>지갑: <b>${won(wallet.get())}</b></p>
    <div class="opt"><span><b>권총</b> · 9mm 자동권총<br><small style="color:#8a97a6">⚠ 사람을 쏘면 경찰이 출동하고 재판을 받습니다</small></span><b>${won(price)}</b></div>`,
    [['닫기', 'gray', () => { }], [has ? '이미 있음' : '구매', 'blue', () => {
      if (has) return; const w = wallet.get(); if (w < price) { toast('돈이 부족해요', 'bad'); return; }
      wallet.set(w - price); try { localStorage.setItem('ns_gun', '1'); } catch (e) { } audio.play('register', { vol: 0.6 }); toast('권총을 샀어요<br><small>오른쪽 아래 무기 버튼으로 꺼내기</small>', 'good', 2500); updateWallet();
    }]]);
}
boot().catch(e => { $('loadtxt').textContent = '오류: ' + e.message; console.error(e); });
