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
import { buildCity, makeTraffic, ROADS } from './city.js';
import { buildStorage, buildCourt } from './places.js';
import { Mover, STORE_COLLIDERS } from './move.js';
import { Crime } from './crime.js';
import { makePistol, makeRifle } from './weapons.js';
import { MiniMap } from './map.js';
import { Pedestrians } from './peds.js';
import { HAIR_TIME } from './hair.js';
import { LightManager, mergeStatic } from './perf.js';
import { Features } from './features.js';
import { productMesh } from './products.js';
import { Crowd } from './crowd.js';
import { Driving } from './drive.js';
import { Missions } from './missions.js';
import { buildArmory, buildTower, buildCafe, Animals, TOWER, ARMORY } from './world2.js';
import { buildPrison } from './prison.js';
import { Physics, StreetProps } from './physics.js';
import { Metro } from './metro.js';
import { PRISON, COURT } from './places.js';
import { buildCourthouse } from './courthouse.js';
import { buildUnderpass, UNDER } from './underpass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { LUTPass } from 'three/addons/postprocessing/LUTPass.js';
import { LUTCubeLoader } from 'three/addons/loaders/LUTCubeLoader.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const IS_MOBILE = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
const settings = Object.assign({ quality: IS_MOBILE ? 'mid' : 'high', myVoice: 'm', tts: true, sens: 1 }, JSON.parse(localStorage.getItem('ns_set') || '{}'));
if (settings.gv !== 3) { settings.gv = 3; settings.quality = IS_MOBILE ? 'mid' : 'high'; }   // 렉 줄인 버전: 폰 기본 '중'(빛 번짐·색보정), PC '상'
window.__q = settings.quality;   // 그래픽 대폭 향상 버전: 기본 품질 올림
const saveSet = () => { try { localStorage.setItem('ns_set', JSON.stringify(settings)); } catch (e) { } };

const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.85;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 1, 0.03, 720);
const yawObj = new THREE.Group(); yawObj.add(camera); scene.add(yawObj);
let composer = null;

// 그래픽 품질: 최상(그림자 + 주변광 차폐 GTAO + SMAA + 빛 번짐 + 영화 색보정) / 상(그림자 + SMAA + 빛 번짐 + 색보정) / 중 / 하
let lut = null; new LUTCubeLoader().load('assets/tex/grade.cube', r => { lut = r; if (lutPass) lutPass.lut = r.texture3D; });
let lutPass = null;
function applyQuality() {
  const q = settings.quality, pr = { ultra: Math.min(devicePixelRatio, 2), high: Math.min(devicePixelRatio, 1.5), mid: Math.min(devicePixelRatio, 1.2), low: Math.min(devicePixelRatio, 0.85) }[q] || 1;
  renderer.setPixelRatio(pr); resize();
  const sh = q === 'ultra' || q === 'high'; if (renderer.shadowMap.enabled !== sh) { renderer.shadowMap.enabled = sh; renderer.shadowMap.type = THREE.PCFSoftShadowMap; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => (m.needsUpdate = true)); }); }
  if (keyLight) { keyLight.castShadow = sh; keyLight.shadow.mapSize.setScalar(q === 'ultra' ? 2048 : 1024); keyLight.shadow.map?.dispose(); keyLight.shadow.map = null; }
  composer = null; lutPass = null;
  if (q !== 'low') {
    const w = innerWidth, h = innerHeight; composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: q === 'ultra' ? 4 : 0 }));
    composer.addPass(new RenderPass(scene, camera));
    if (q === 'ultra') { const ao = new GTAOPass(scene, camera, w, h); ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.2, scale: 1.1, samples: 12 }); ao.blendIntensity = 0.85; composer.addPass(ao); }
    // 빛 번짐 전에 잘못된 값(NaN·무한대) 지우기 — 한 점이라도 있으면 번짐이 화면 전체로 퍼져 검게 됨
    composer.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null } }, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c)) || any(isinf(c))) c = vec4(0.,0.,0.,1.); gl_FragColor = vec4(min(c.rgb, vec3(60.)), c.a); }' }));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.5, 1.75));
    { lutPass = new LUTPass({ intensity: 0.22 }); if (lut) lutPass.lut = lut.texture3D; composer.addPass(lutPass); }
    composer.addPass(new OutputPass());
    if (q !== 'mid') composer.addPass(new SMAAPass(w * pr, h * pr));
    composer.setSize(w, h);
  }
}
// 그림자를 드리우는 핵심 조명 하나: 매장 안이면 천장, 밖이면 가장 가까운 가로등, 지하·건물 안이면 머리 위
let keyLight = null;
window.__gfx = { get composer() { return composer; }, get keyLight() { return keyLight; }, get lutPass() { return lutPass; } };
function makeKeyLight() {
  keyLight = new THREE.SpotLight(0xfff2dc, 0, 26, 0.95, 0.65, 1.3); keyLight.castShadow = renderer.shadowMap.enabled; keyLight.shadow.bias = -0.0006; keyLight.shadow.normalBias = 0; keyLight.shadow.camera.near = 0.3; keyLight.shadow.mapSize.setScalar(settings.quality === 'ultra' ? 2048 : 1024);
  scene.add(keyLight, keyLight.target);
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
  const C = store.C, list = [...game.items.filter(i => !i.scanned || i.cig).map(i => i.mesh), ...store.cigSlots, store.mw, C.pos, C.drawer.group, C.reader, store.counterHit, ...armory.hits, ...cafe.hits, prison.ventHit, prison.holeHit, prison.bedHit, ...(features?.aimTargets() || []), ...(store.merch.looseMeshes || [])];
  let aim = null, hitD = 99;
  for (const hit of ray.intersectObjects(list, true)) {
    let o = hit.object;
    if (o.userData.loose) { const e = o.userData.entries[hit.instanceId]; if (e?.messy) { aim = { type: 'mess', entry: e, label: '넘어진 상품 · 정리하기' }; hitD = hit.distance; break; } continue; }
    while (o && !o.userData.item && !o.userData.cig && !o.userData.aim) o = o.parent;
    if (!o) continue;
    hitD = hit.distance;
    if (o.userData.item) { const it = o.userData.item; if (it.scanned) continue; aim = { type: 'item', item: it, label: `${it.name} · ${it.price.toLocaleString()}원` }; }
    else if (o.userData.cig) aim = { type: 'cig', obj: o, label: `${o.userData.cig.id}번 ${o.userData.cig.name} · ${o.userData.cig.price.toLocaleString()}원` };
    else aim = { type: o.userData.aim, obj: o, label: { mw: '전자레인지', guns: '총기 보관함', counter: '계산대', ammo: '탄약 상자', cafe: '카운터 · 아메리카노 4,500원', vent: '헐거운 환풍구', fence: '울타리 개구멍', bed: '침대' }[o.userData.aim] || features?.label(o.userData.aim) || '' };
    break;
  }
  // 사람 (총이면 멀리까지)
  ray.far = crime.weapon === 'fist' ? 2.4 : 40;
  const TG = crime.targets(), ph = ray.intersectObjects(TG.map(t => t[0]), false)[0];   // 손님·사장님·행인·경찰·법정 사람 모두 조준됨
  if (ph && ph.distance < hitD) { const c = TG.find(t => t[0] === ph.object)?.[1]; if (c) aim = { type: 'person', c, label: `${c.type?.name || ''}` }; }
  if (aim?.type === 'bed') { const sn = crime.sentenceNow; aim.label = !sn ? '침대' : sn.death ? '침대 · 사형수 (출소 없음)' : sn.life ? `침대 · 무기징역 (가석방까지 ${Math.max(0, 20 - (crime.served || 0))}년)` : `침대 · 남은 형기 ${Math.max(0, (sn.years || 0) - (crime.served || 0))}년`; }
  game.aim = aim;
  const dot = $('dot'); dot.className = aim ? 'on ' + aim.type : '';
  $('aimLabel').textContent = aim ? aim.label : '';
  let lab = { cig: '담배 꺼내기', mw: '데우기', mess: '정리하기', guns: '총 꺼내기', ammo: '탄약 보충', cafe: '커피 주문', vent: '환풍구 뜯기', fence: '개구멍 통과', bed: '잠자기 (형기 보내기)', atm: 'ATM', noodle: '컵라면 먹기', spill: '닦기' }[aim?.type], ready = !!aim && !['counter', 'person'].includes(aim.type);
  if (driving.ride) { lab = driving.ride.kind === 'bus' ? '버스 내리기' : '내리기'; ready = true; }
  else if (!aim || aim.type === 'person') { const n = driving.near(); if (n) { lab = driving.label(n); ready = true; } else if (nearElevator()) { lab = '엘리베이터'; ready = true; } }
  { const nr = !driving.ride && !crime.inPrison && driving.near(), br = $('bRide'); br.classList.toggle('hidden', !nr); if (nr) { const t = driving.label(nr); if (br.dataset.t !== t) { br.dataset.t = t; br.querySelector('b').textContent = t; } br._n = nr; } }
  $('bScan').querySelector('b').textContent = lab || '바코드 찍기';
  $('bScan').classList.toggle('ready', ready);
  $('bPay').classList.toggle('ready', !!aim && aim.type !== 'cig' && !!game.cur && !game.items.some(i => !i.scanned && !i.refund));
  $('bAtk').classList.toggle('ready', aim?.type === 'person');
}
$('bRide').addEventListener('click', e => { e.stopPropagation(); const n = $('bRide')._n; if (!driving.ride && n && driving.near()) driving.enter(driving.near()); });
// 키보드 (PC)
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space' && game?.running) { e.preventDefault(); }
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

const _camW = new THREE.Vector3();
let cityEnv = null, lampT = 0, lightMgr = null, features = null;
let physics, streetProps, metro, courthouse;
let store, hands, game, vehicles, city, traffic, storage, mover, crime, minimap, under, sky, hemi, ugLight, peds, crowd, driving, missions, armory, tower, cafe, prison, animals;
paintIcons();
async function boot() {
  const bar = $('loadbar'), txt = $('loadtxt'); let p = [0, 0, 0];
  const prog = () => (bar.style.width = (p[0] * 20 + p[1] * 60 + p[2] * 20) + '%');
  makeKeyLight(); applyQuality();
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
  city = buildCity(scene, { onCollider: c => colliders.push(c), holes: [...UNDER.stairs, ARMORY.stair] });
  for (let i = colliders.length - 1; i >= 0; i--) { const c = colliders[i]; if (Math.abs(c.z0 + 14.1) < 0.05 && (Math.abs(c.x0 - 20.4) < 0.05 || Math.abs(c.x0 - 4.9) < 0.05)) colliders.splice(i, 1); }  // 들어갈 수 있는 건물(달빛타워·카페)은 벽만
  const col = c => colliders.push(c);
  armory = buildArmory(scene, col); tower = buildTower(scene, col); cafe = buildCafe(scene, col, audio); prison = buildPrison(scene, col, PRISON); animals = new Animals(scene, audio);
  placeProps(col);
  under = buildUnderpass(scene, c => colliders.push(c)); buildSky();
  storage = buildStorage(scene, c => colliders.push(c));
  const courtB = buildCourt(scene);
  vehicles.car.visible = false; traffic = makeTraffic(scene, vehicles, audio, CAR_COLORS, {
    obstacles: () => { const out = [], me = yawObj.position; if (game?.running) out.push({ x: me.x, z: me.z, player: true }); for (const c of crowd?.people() || []) { const p = c.person?.root?.position; if (p && !c.dead && Math.abs(p.y) < 1 && Math.abs(p.z - 10.5) < 400) out.push({ x: p.x, z: p.z, person: c }); } return out; },
    hit: (c, v, dir, sp) => crime.carHit(c, dir, sp, false) });
  mover = new Mover({ yawObj, camera, look, audio, colliders }); Person.blockers = colliders;
  traffic.spawnParked(0xc21a1a, false, -30, 5.5, Math.PI / 2, true);   // 가게 옆에 세워 둔 빨간 페라리
  game = new Game({ renderer, scene, camera, store, hands, audio, voice, settings, look });
  crime = new Crime({ game, scene, camera, yawObj, look, audio, hands, vehicles, mover, colliders });
  peds = new Pedestrians({ scene, audio, game, crime, yawObj, camera }); crime.peds = peds; crime.extra = []; crime.prison = prison; courtB.prison.visible = false;
  crowd = new Crowd({ game, crime, peds, yawObj, colliders, mover });
  driving = new Driving({ scene, camera, yawObj, look, mover, audio, hands, vehicles, traffic, crime, game, colliders, crowd }); crime.drive = driving;
  driving.hitPerson = (c, dir, sp, byMe) => crime.carHit(c, dir, sp, byMe); crowd.traffic = traffic; crowd.drive = driving;
  // 물리엔진: 건물·차·사람·물건이 서로 겹치지 않고 부딪힘
  physics = new Physics({ scene, colliders, audio }); driving.phys = physics;
  for (const ch of scene.userData.physChairs || []) physics.addProp(ch, { hx: 0.22, hy: 0.4, hz: 0.21, mass: 2.5, snd: 'plastic' });
  const W2c = city.ROADW / 2, segs = (lines, a0, a1, cut) => { const out = []; let a = a0; for (const c of [...cut].sort((p, q) => p - q)) { if (c - W2c - 3 > a) out.push([a, c - W2c - 3]); a = Math.max(a, c + W2c + 3); } if (a1 > a) out.push([a, a1]); return out; };
  const coreCurbs = me => { const out = [], R = 60; if (me.x < ROADS.X0 - 80 || me.x > ROADS.X1 + 80 || me.z < ROADS.Z0 - 80 || me.z > ROADS.Z1 + 80) return out;
    for (const r of ROADS.EW) { if (Math.abs(r.z0 - me.z) > R + 10) continue; for (const [a, b] of segs(null, Math.max(ROADS.X0, me.x - R), Math.min(ROADS.X1, me.x + R), ROADS.NS)) { out.push({ ax: 'x', c: r.z0, a: r === ROADS.main ? Math.max(a, b > 16 && a < -16 ? a : a) : a, b, out: -1, main: r === ROADS.main }); out.push({ ax: 'x', c: r.z1, a, b, out: 1 }); } }
    for (const cx of ROADS.NS) { if (Math.abs(cx - me.x) > R + 10) continue; for (const [a, b] of segs(null, Math.max(ROADS.Z0, me.z - R), Math.min(ROADS.Z1, me.z + R), ROADS.EW.map(r => (r.z0 + r.z1) / 2))) { out.push({ ax: 'z', c: cx - W2c, a, b, out: -1 }); out.push({ ax: 'z', c: cx + W2c, a, b, out: 1 }); } }
    return out.filter(s => !(s.main && s.out === -1 && me.x > -40 && me.x < 40) || true).map(s => s.main && s.out === -1 ? { ...s, skip: [-16, 20] } : s); };
  // 수도권(서울 크기) 확장: 가까운 구역만 그때그때 만듦
  metro = new Metro({ scene, city, colliders, lamps: city.lamps,
    spawnCar: (x, z, ry, moving) => { const v = traffic.spawnParked(CAR_COLORS[Math.random() * CAR_COLORS.length | 0], Math.random() < 0.12, x, z, ry); if (moving) v.snd = audio.play('engine', { pos: v.mesh.position, loop: true, vol: 0.9, rate: 0.6 }); return v; },
    removeCar: v => { if (driving.ride?.obj === v.mesh) return; const i = traffic.list.indexOf(v); if (i >= 0) traffic.list.splice(i, 1); v.snd?.stop?.(); v.snd = null; v.mesh.removeFromParent(); } });
  metro.audio = audio; metro.ride = () => driving.ride?.obj; peds.extraSegs = me => metro.sidewalks(me);
  streetProps = new StreetProps({ physics, scene, colliders, curbs: me => coreCurbs(me).concat(metro.curbs(me)) });
  driving.spawnDriver = car => { const S = car.userData.size; return peds.addFleeing(car.localToWorld(new THREE.Vector3(S.x / 2 + 0.9, 0, S.z * 0.1)), yawObj.position.clone()); };
  mover.onBump = (p, sp) => { store.merch.shake(p); audio.play('bag', { pos: p, vol: 0.3, rate: 1.9 }); audio.play('key', { pos: p, vol: 0.25, rate: 1.6 }); if (sp > 2.4 && Math.random() < 0.45) store.merch.knockNear(p, 1.4); };
  minimap = new MiniMap({ city, yawObj, look, markers: () => {
    const out = [];
    for (const c of peds.list) out.push({ x: c.person.root.position.x, z: c.person.root.position.z, kind: c.dead ? 'dead' : 'person' });
    for (const c of game.customers) out.push({ x: c.person.root.position.x, z: c.person.root.position.z, kind: c.dead ? 'dead' : 'person' });
    if (game.boss) out.push({ x: game.boss.root.position.x, z: game.boss.root.position.z, kind: game.bossDead ? 'dead' : 'person' });
    for (const o of crime.officers) out.push({ x: o.root.position.x, z: o.root.position.z, kind: o.dead ? 'dead' : 'cop' });
    out.push(...(missions?.markers() || []));
    for (const P of crime.cars || []) out.push({ x: P.car.position.x, z: P.car.position.z, kind: 'police', r: 1.6 });
    for (const v of traffic.list) if (v.mesh.visible && v.parked && v.mesh !== driving.ride?.obj) out.push({ x: v.mesh.position.x, z: v.mesh.position.z, kind: 'ride', r: 1.3 });
    for (const b of driving.bikes) out.push({ x: b.position.x, z: b.position.z, kind: 'ride', r: 0.8 });
    return out;
  } }); minimap.metro = metro;
  missions = new Missions({ scene, audio, game, crime, peds, yawObj, look, traffic, drive: driving, minimap, city, tower: TOWER, extra: crime.extra }); crime.money = (n, w) => missions.money(n, w); missions.money(0);
  features = new Features({ scene, camera, yawObj, audio, game, hands, missions, crime, renderer, drive: driving, productMesh, render: () => (composer ? composer.render() : renderer.render(scene, camera)) }); missions.features = features; features.skyMat = sky?.children[0]?.material; crime.features = features; peds.features = features;
  crime.onEscape = () => (features.stat('escapes'), toast('탈옥수가 됐어요. 경찰을 피해 도시로 숨어드세요! (휴대폰에서 미션·일자리)', 'bad', 4000));
  courthouse = buildCourthouse(scene, colliders, COURT, courtB.court); crime.courthouse = courthouse;
  crime.courtGroup = courtB.court; crime.worldRoots = [store.root, city.root, storage.group, courtB.court, under.group, armory.group, tower.group, cafe.group, prison.group];
  crime.onExit = () => { crime.cleanup(); peds.clear(); toMenu(); }; crime.onRestart = () => { crime.cleanup(); peds.clear(); startShift(1); };
  game.crime = crime; game.onShop = () => openShop(); game.mover = mover; game.yawObjDist = () => Math.hypot(yawObj.position.x - SPOT.cam.x, yawObj.position.z - SPOT.cam.z);
  game.onExit = () => toMenu(); game.onNext = (d) => startShift(d);
  // 그림자 받기·드리우기 + 바깥(거리) 반사 환경맵 한 번 찍기
  scene.traverse(o => { if (o.isMesh) { o.receiveShadow = true; if (o.isSkinnedMesh) o.castShadow = true; } });
  for (const o of store.root.children) if (o.isMesh && (!o.isInstancedMesh || settings.quality === 'ultra')) o.castShadow = true;
  try { const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.UnsignedByteType }), cc = new THREE.CubeCamera(0.1, 200, rt); cc.position.set(8, 2.4, 10.5); scene.add(cc); const sv = sky.visible; cc.update(renderer, scene); scene.remove(cc); cityEnv = new THREE.PMREMGenerator(renderer).fromCubemap(rt.texture).texture; rt.dispose(); void sv; } catch (e) { console.warn('city env', e); }
  // 성능: 실내 소품 재질별로 합치기 + 조명 관리자(내 주변 4개만)
  // 편의점: 상호작용 물체(상품·담배·계산대 장비·문·전자레인지 등)는 빼고 진열대·벽·장식만 합침
  { const C = store.C, keepSet = new Set([C.pos, C.drawer?.group, C.reader, store.mw, store.door, store.staffDoor, C.scanner?.stand, C.scanner?.gun, C.printer, C.paper, C.monitor, store.counterHit, ...(store.cigSlots || [])].filter(Boolean));
    const skipStore = o => keepSet.has(o) || (o.userData && Object.keys(o.userData).length > 0) || o.isInstancedMesh;
    console.log('perf: store merged', mergeStatic(store.root, skipStore)); }
  let merged = 0; for (const [g, skip] of [[tower.group, o => o === tower.evCar], [cafe.group, () => false], [armory.group, () => false], [prison.group, o => o === prison.vent], [storage.group, () => false], [courtB.court, () => false], [courthouse.group, () => false]]) merged += mergeStatic(g, skip);
  lightMgr = new LightManager(scene, [keyLight, ugLight, crime.fx.flashLight, prison.spot]); const nl = lightMgr.harvest(); console.log('perf: merged', merged, 'lights pooled', nl);
  window.__ns = { game, look, store, hands, camera, scene, yawObj, audio, THREE, Person, TYPES, billMesh, coinMesh, renderer, crime, mover, traffic, city, minimap, under, peds, driving, missions, tower, prison, crowd, elevatorRide, features, get physics() { return physics; }, get metro() { return metro; }, get streetProps() { return streetProps; } };
  store.mw.userData.aim = 'mw';
  for (const o of [store.C.pos, store.C.drawer.group, store.C.reader]) o.userData.aim = 'counter';
  const hitBox = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.08, 3.6), new THREE.MeshBasicMaterial()); hitBox.visible = false; hitBox.position.set(2.6, 0.93, 0.6); hitBox.userData.aim = 'counter'; scene.add(hitBox); store.counterHit = hitBox;
  game.voiceOK = false;   // 직접 말하기 없앰: 대답은 화면 선택지로
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
    <div class="opt">그래픽 ${sel('sQ', [['ultra', '최상 (그림자·주변광 차폐·색보정)'], ['high', '상 (그림자·색보정)'], ['mid', '중'], ['low', '하 (빠름)']], settings.quality)}</div>
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
$('bScan').onclick = () => {
  audio.resume(); const a = game.aim;
  if (driving.ride) return driving.exit();
  if (a?.type === 'ammo') { crime.ammo = { pistol: 15, rifle: 30 }; crime.hud(); audio.play('key', { vol: 0.9, rate: 0.7 }); audio.play('bag', { vol: 0.5, rate: 0.6 }); return toast('탄약을 가득 채웠어요', 'good', 1500); }
  if (a?.type === 'cafe') { if (missions.money(0) < 4500) return toast('돈이 부족해요', 'bad', 1500); missions.money(-4500, '아메리카노'); crime.hp = Math.min(100, crime.hp + 30); crime.hpHud(); audio.play('register', { vol: 0.6 }); return game.say({ type: { name: '바리스타', id: 'barista' }, person: { talk: 0, gesture() { }, smile: 0 }, voice: [1.15, 1.02], gender: 'f', vIdx: 2, mood: 70 }, ['아메리카노 나왔습니다~ 맛있게 드세요!', 'happy']); }
  if (a && ['atm', 'noodle', 'spill'].includes(a.type)) return features.act(a);
  if (a?.type === 'vent') return crime.ventTry();
  if (a?.type === 'bed') return crime.sleepInCell();
  if (a?.type === 'fence') return crime.escape();
  if (!a || a.type === 'person') { const n = driving.near(); if (n) return driving.enter(n); if (nearElevator()) return elevatorMenu(); }
  game.doPrimary();
};
// 엘리베이터: 앞에 서면 버튼 → 층 고르기 → 문 닫힘 → 칸이 올라감(안에서) → 문 열림 '띵'
function nearElevator() { const p = yawObj.position, E = TOWER.ev, f = p.y - 1.55; return !driving.ride && p.x > E.x0 - 0.4 && p.x < E.x1 + 0.4 && p.z > E.z1 - 1.6 && p.z < E.z1 + 1.6 && tower.stops.some(y => Math.abs(y - f) < 0.6); }
function elevatorMenu() {
  const f = yawObj.position.y - 1.55, cur = tower.stops.reduce((a, y) => Math.abs(y - f) < Math.abs(a - f) ? y : a, 0);
  modal(`<h2>엘리베이터</h2><p>몇 층으로 갈까요?</p>`, [['1층 로비', 'gray', () => elevatorRide(cur, 0)], ['5층 사무실', 'blue', () => elevatorRide(cur, TOWER.f5)], ['옥상 (R)', 'blue', () => elevatorRide(cur, TOWER.roof)], ['닫기', 'gray', () => { }]]);
}
async function elevatorRide(from, to) {
  if (from === to) return; const car = tower.evCar, E = TOWER.ev, cx = (E.x0 + E.x1) / 2, sleep = ms => new Promise(r => setTimeout(r, ms));
  mover.enabled = false; car.position.y = from; tower.setDoors(1); audio.play('chime', { vol: 0.5, rate: 1.6 });
  yawObj.position.set(cx, from + 1.55, car.position.z - 0.1); look.yaw = Math.PI; await sleep(500); tower.setDoors(0); audio.play('door', { vol: 0.5, rate: 1.4 });
  const t0 = performance.now(), dur = 1500 + Math.abs(to - from) * 90, hum = audio.play('engine', { vol: 0.35, rate: 0.32, loop: true });
  await new Promise(res => { const step = () => { const k = Math.min(1, (performance.now() - t0) / dur), e = k * k * (3 - 2 * k); car.position.y = from + (to - from) * e; yawObj.position.y = car.position.y + 1.55; if (k < 1) requestAnimationFrame(step); else res(); }; step(); });
  hum?.stop?.(); audio.play('chime', { vol: 0.8, rate: 1.9 }); tower.setDoors(1); await sleep(400);
  yawObj.position.set(cx, to + 1.55, E.z1 + 0.6); look.yaw = Math.PI; mover.enabled = true; toast({ 0: '1층 로비', [TOWER.f5]: '5층 사무실', [TOWER.roof]: '옥상' }[to] + '입니다', '', 1500);
}
$('bPay').onclick = () => { audio.resume(); game.doCheckout(); };
$('bTurn').onclick = () => look.turnTo(Math.abs(Math.atan2(Math.sin(look.yaw - Math.PI / 2), Math.cos(look.yaw - Math.PI / 2))) < 1.5 ? -Math.PI / 2 : Math.PI / 2);
$('bMic').onclick = () => { audio.resume(); };
$('b112').onclick = () => game.call112();
$('bPause').onclick = () => pause();
// 달리기 버튼 (누르고 있는 동안)
{ const b = $('bRun'), on = v => { mover.runHold = v; b.classList.toggle('on', v); };   // 누를 때마다 달리기 켜기/끄기 (조이스틱 끝까지 밀어도 달림)
  b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); on(!mover.runHold); }); }
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
  if (game?.running || crime?.inCourt) mover.update(dt);
  traffic?.update(dt, game?.running ? yawObj.position : null); city?.update(dt); crime?.update(dt);
  hands?.update(dt, t);
  updateAim(dt); updateLiquids(dt);
  if (game?.running) minimap?.update(dt);
  if (game?.running) features?.update(dt, crime.indoor() || yawObj.position.y - 1.55 < -1);
  prison?.tick?.(dt, yawObj.position); metro?.update(dt, yawObj.position); courthouse?.update(dt, yawObj.position);
  if (game?.running && !crime?.inCourt) { peds?.update(dt, !crime.inPrison); crowd?.update(dt); driving?.update(dt); physics?.update(dt, yawObj.position, crowd.people(), traffic.list); streetProps?.update(dt, yawObj.position); missions?.update(dt); animals?.update(dt, yawObj.position); store.merch.update(dt); const cw = camera.getWorldPosition(new THREE.Vector3()); for (const c of crime.extra) c.person.update(dt, cw); }
  if (game?.running) doors(dt);
  if (game?.running && (posT += dt) > 0.5) { posT = 0; game.renderPos(); }
  envUpdate(dt); HAIR_TIME.value += dt; lightMgr?.update(dt, camera.getWorldPosition(_camW));
  if (fridgeDoor) { const near = yawObj.position.distanceTo(fridgeDoor.pos.clone().setY(yawObj.position.y)) < 2.1; const k0 = fridgeDoor.k; fridgeDoor.k += ((near ? 1 : 0) - fridgeDoor.k) * Math.min(1, dt * 3); fridgeDoor.piv.rotation.y = -fridgeDoor.k * 1.35; if (near && k0 < 0.05) audio.play('door', { pos: fridgeDoor.pos, vol: 0.4, rate: 1.6 }); }
  camera.updateMatrixWorld();
  audio.setListener(camera.getWorldPosition(new THREE.Vector3()), camera.getWorldQuaternion(new THREE.Quaternion()));
  composer ? composer.render() : renderer.render(scene, camera);
}
// 실제 가구·냉장고 모델 배치: 카페 음료 냉장고(가까이 가면 문이 열림), 달빛타워 로비 벨벳 소파·의자, 대표이사실 의자, 페라리 한 대
let fridgeDoor = null;
function placeProps(col) {
  const V = vehicles, f = V.fridge; f.position.set(18.95, 0, -5.45); scene.add(f); col({ x0: 18.45, x1: 19.45, z0: -6, z1: -4.9 });
  const door = ['FridgeDoor', 'FridgeDoorInner', 'FridgeGlass'].map(n => f.getObjectByName(n)).filter(Boolean);
  if (door.length) { f.updateMatrixWorld(true); const bb = new THREE.Box3(); door.forEach(d => bb.expandByObject(d)); const piv = new THREE.Group(); piv.position.copy(f.worldToLocal(new THREE.Vector3(bb.min.x, 0, bb.max.z))); f.add(piv); piv.updateMatrixWorld(true); door.forEach(d => piv.attach(d)); fridgeDoor = { piv, k: 0, pos: f.position.clone() }; }
  V.sofa.position.set(25, 0, -4.55); scene.add(V.sofa);
  const c1 = V.chair; c1.position.set(27.4, 0, -4.4); c1.rotation.y = -0.4; scene.add(c1);
  const c2 = V.chair.clone(true); c2.position.set(37.5, TOWER.f5, 0.55); c2.rotation.y = Math.PI; scene.add(c2);
}
// 밤하늘(그라데이션·별·달) — 내 위치를 따라다님
function buildSky() {
  const geo = new THREE.SphereGeometry(240, 32, 16), mat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uDawn: { value: 0 } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform float uDawn; varying vec3 vP; void main(){ float h = clamp(vP.y, -0.1, 1.); vec3 top = mix(vec3(0.01,0.015,0.04), vec3(0.16,0.27,0.48), uDawn), hor = mix(vec3(0.09,0.07,0.09), vec3(0.95,0.55,0.38), uDawn); vec3 c = mix(hor, top, pow(max(h,0.),0.45)); gl_FragColor = vec4(c,1.); }' });
  sky = new THREE.Group(); const dome = new THREE.Mesh(geo, mat); dome.renderOrder = -2; sky.add(dome);
  const mc = document.createElement('canvas'); mc.width = mc.height = 128; const g = mc.getContext('2d'); const gr = g.createRadialGradient(64, 64, 20, 64, 64, 64); gr.addColorStop(0, 'rgba(255,250,230,1)'); gr.addColorStop(0.42, 'rgba(255,245,215,1)'); gr.addColorStop(0.5, 'rgba(255,240,200,.35)'); gr.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); g.fillStyle = 'rgba(200,190,170,.35)'; for (const [x, y, r] of [[54, 52, 7], [72, 70, 9], [60, 78, 5]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(mc), fog: false, depthWrite: false })); moon.position.set(-90, 120, -170); moon.scale.setScalar(26); sky.add(moon);
  scene.add(sky);
  scene.traverse(o => { if (o.isHemisphereLight) hemi = o; });
  ugLight = new THREE.PointLight(0xf2f6ff, 0, 16, 1.4); scene.add(ugLight);
}
// 실내·바깥·지하에 따라 안개 거리와 빛 바꾸기
function envUpdate(dt) {
  if (!sky) return;
  { const p = yawObj.position, inS = p.x > -5.6 && p.x < 5.2 && p.z > -8.4 && p.z < 4.4 && p.y < 3 && p.y > 0 && !crime?.inPrison; document.body.classList.toggle('outside', !inS); }
  const p = yawObj.position, feet = p.y - 1.55, ug = feet < -1.2 && Math.abs(p.z) < 40, inStore = p.x > -5.4 && p.x < 5 && p.z > -8.2 && p.z < 4.2 && !ug;
  const k = Math.min(1, dt * 2.5), fn = ug ? 10 : inStore ? 14 : 40, ff = ug ? 60 : inStore ? 50 : (window.__q === 'low' ? 330 : window.__q === 'mid' ? 440 : 560);
  scene.fog.near += (fn - scene.fog.near) * k; scene.fog.far += (ff - scene.fog.far) * k;
  sky.position.copy(camera.getWorldPosition(new THREE.Vector3())); sky.visible = !ug;
  ugLight.intensity += ((ug ? 14 : 0) - ugLight.intensity) * k; ugLight.position.set(p.x, UNDER.ceil - 0.5, p.z);
  if (hemi) { hemi.intensity += ((ug ? 0.85 : inStore ? 0.32 : 1.0 + (features?.dawn || 0) * 0.8) - hemi.intensity) * k; if (features?.flashK && !inStore && !ug) hemi.intensity = 1 + features.flashK; hemi.groundColor.setHex(inStore || ug ? 0x6a6458 : 0x8a6a48); }   // 바깥: 도시 불빛이 퍼진 밤 주변광
  // 반사 환경: 매장·지하 안 / 거리
  const want = (inStore || ug) ? scene.userData.storeEnv : (cityEnv || scene.userData.storeEnv); if (want && scene.environment !== want) scene.environment = want;
  // 그림자 조명 위치
  if (keyLight && (lampT -= dt) < 0) {
    lampT = 0.4; const L = keyLight, f = p.y - 1.55;
    if (inStore) { L.position.set(-0.3, 2.95, 0.2); L.target.position.set(-0.3, 0, 0.7); L.intensity = 9; L.distance = 12; L.angle = 1.25; L.color.setHex(0xfff6ea); }
    else if (Math.abs(f) < 0.6 && city?.lamps?.length) { let best = null, bd = 1e9; for (const l of city.lamps) { const d = (l.x - p.x) ** 2 + (l.z - p.z) ** 2; if (d < bd) { bd = d; best = l; } } L.position.set(best.x, 6.2, best.z); L.target.position.set(best.tx, 0, best.tz); L.intensity = 45; L.distance = 30; L.angle = 0.95; L.color.setHex(0xffc98a); }
    else { L.intensity = 0; }   // 다른 실내는 자체 조명만
    L.target.updateMatrixWorld();
  }
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
