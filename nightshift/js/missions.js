// 휴대폰(미션·일자리·지갑·지도), 목표 표시(빛기둥 + 화면 화살표 + 미니맵), 일자리(배달 라이더·택시 기사), 스토리 미션 8개
import * as THREE from 'three';
import { $, toast, modal, ic } from './ui.js';
import { Person } from './people.js';
import { TYPES } from './data.js';

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), pk = a => a[Math.random() * a.length | 0];
const won = n => n.toLocaleString() + '원';
const PLACE = ['달빛빌라 3동 앞', '행복아파트 정문', '골목 PC방 앞', '24시 국밥집 앞', '꽃집 앞', '세탁소 앞', '노래방 입구', '약국 앞', '부동산 앞', '은행 ATM 앞'];
const FOOD = ['짜장면 2인분', '치킨 한 마리', '떡볶이 세트', '족발 중(中)', '피자 라지', '국밥 2인분', '햄버거 세트', '마라탕'];
const RIDE = [['기사님, 달빛공원 쪽으로 가 주세요.', 'calm'], ['아저씨, 저 좀 빨리 가 주세요. 늦었어요!', 'annoyed'], ['집까지요. 내비 찍어 드릴게요.', 'tired'], ['기사님, 저기 학교 근처요.', 'calm']];
const BOSS = { type: { name: '사장님 (전화)', id: 'boss' }, person: { talk: 0, gesture() { }, smile: 0 }, voice: [0.92, 0.98], gender: 'm', vIdx: 0, mood: 60 };

export class Missions {
  constructor(app) {
    Object.assign(this, app); this.obj = null; this.job = null; this.active = null; this.t = 0;
    try { this.done = new Set(JSON.parse(localStorage.getItem('ns_story') || '[]')); } catch (e) { this.done = new Set(); }
    // 목표 표시: 빛기둥 + 바닥 고리
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 30, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }));
    beam.geometry.translate(0, 15, 0); const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.06, 8, 40), new THREE.MeshBasicMaterial({ color: 0xffd36b, toneMapped: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
    this.marker = new THREE.Group(); this.marker.add(beam, ring); this.marker.visible = false; this.scene.add(this.marker);
    $('bPhone')?.addEventListener('click', () => this.phone());
    this.STORY = this.story();
  }
  money(n, why) { let w = 0; try { w = +(localStorage.getItem('ns_wallet') ?? 50000); } catch (e) { } w += n; try { localStorage.setItem('ns_wallet', String(w)); } catch (e) { } const el = $('money'); if (el) el.textContent = won(w); if (n && why) toast((n > 0 ? '+' : '') + won(n) + ' · ' + why, n > 0 ? 'good' : 'bad', 2200); return w; }
  // 목표 설정: 위치(월드), 반경, 설명, 도착 시
  goal(text, pos, r = 2.2, onArrive, opt = {}) { this.obj = { text, pos: pos.clone(), r, onArrive, ...opt }; this.marker.position.copy(pos); this.marker.visible = !opt.hidden; this.hud(); }
  clearGoal() { this.obj = null; this.marker.visible = false; this.hud(); }
  hud() { const el = $('objective'); if (!el) return; el.classList.toggle('on', !!this.obj); if (this.obj) el.querySelector('b').textContent = this.obj.text; }
  update(dt) {
    this.t += dt; this.marker.children[1].scale.setScalar(1 + Math.sin(this.t * 4) * 0.08);
    const o = this.obj, me = this.yawObj.position;
    if (o) {
      const d = Math.hypot(o.pos.x - me.x, o.pos.z - me.z), dy = Math.abs(o.pos.y - (me.y - 1.55));
      const el = $('objective'); el.querySelector('i').textContent = d > 1000 ? '' : `${Math.round(d)}m`;
      const ang = Math.atan2(o.pos.x - me.x, o.pos.z - me.z), rel = ang - (this.look.yaw + Math.PI); el.querySelector('em').style.transform = `rotate(${-rel}rad)`;
      if (d < o.r && dy < 1.6 && (!o.cond || o.cond())) { const f = o.onArrive; this.clearGoal(); f?.(); }
    }
    if (this.job?.update) this.job.update(dt);
    if (this.active?.tick) this.active.tick(dt);
  }
  markers() { return this.obj ? [{ x: this.obj.pos.x, z: this.obj.pos.z, kind: 'goal', r: 2 }] : []; }
  // ── 휴대폰 ──
  phone() {
    const w = this.money(0), next = this.STORY.find(m => !this.done.has(m.id));
    const list = this.STORY.map((m, i) => `<div class="opt"><span><b>${i + 1}. ${m.title}</b><br><small style="color:#8a97a6">${m.desc}</small></span><b style="color:${this.done.has(m.id) ? '#2fd3b4' : this.active?.id === m.id ? '#ffd36b' : '#8a97a6'}">${this.done.has(m.id) ? '완료' : this.active?.id === m.id ? '진행 중' : m === next ? '가능' : '잠김'}</b></div>`).join('');
    modal(`<h2>${ic('pos')} 내 휴대폰</h2><p>지갑 <b>${won(w)}</b> · 일자리 <b>${this.job ? this.job.name : '없음'}</b></p><h3 style="margin:10px 0 4px">스토리 미션</h3>${list}`,
      [['닫기', 'gray', () => { }], ['지도', 'gray', () => this.minimap.open(true)], ['카메라', 'gray', () => this.features?.photoMode()], ['갤러리', 'gray', () => this.features?.galleryView()], ['통계', 'gray', () => this.features?.statsView()], ['ATM 잔고', 'gray', () => this.features?.atm()],
        ...(next && !this.active ? [[`미션: ${next.title}`, 'blue', () => this.start(next)]] : []),
        ['일자리', 'blue', () => this.jobs()]]);
  }
  jobs() {
    modal(`<h2>${ic('cash')} 일자리</h2>
      <div class="opt"><span><b>편의점 야간 알바</b><br><small style="color:#8a97a6">계산·진상 응대 (시급 10,030원)</small></span></div>
      <div class="opt"><span><b>배달 라이더</b><br><small style="color:#8a97a6">가게 앞에서 음식 받아 배달 (스쿠터·자전거 추천) 건당 4천~9천원</small></span></div>
      <div class="opt"><span><b>택시 기사</b><br><small style="color:#8a97a6">편의점 앞 택시를 타고 손님을 태워 목적지까지 · 요금</small></span></div>`,
      [['닫기', 'gray', () => { }], ['편의점', 'gray', () => this.goStore()], ['배달', 'blue', () => this.startDelivery()], ['택시', 'blue', () => this.startTaxi()], ...(this.job ? [['그만두기', 'red', () => this.quitJob()]] : [])]);
  }
  quitJob() { this.job?.end?.(); this.job = null; this.clearGoal(); toast('일을 그만뒀어요', '', 1500); }
  goStore() { this.quitJob(); this.goal('편의점 계산대로 가서 근무 시작', V3(3.4, 0, 0.9), 1.6, () => toast('근무 중! 손님을 맞이하세요', 'good', 2000)); }
  sidewalkPoint(minD, maxD) {
    const me = this.yawObj.position, segs = this.peds.segs.filter(s => !s.ug);
    for (let i = 0; i < 60; i++) { const sg = pk(segs), s = sg.a + Math.random() * (sg.b - sg.a), p = this.peds.pt(sg, s), d = Math.hypot(p.x - me.x, p.z - me.z); if (d > minD && d < maxD) return p; }
    return V3(me.x + 40, 0, me.z);
  }
  // ── 배달 라이더 ──
  startDelivery(n = 99, onDone) {
    this.quitJob(); let count = 0, t0 = 0; const self = this;
    this.job = { name: '배달 라이더', update(dt) { t0 += dt; } };
    const pickup = () => this.goal('가게 앞에서 배달 음식 받기', V3(1.1, 0, 5.8), 1.8, () => {
      const food = pk(FOOD), dest = this.sidewalkPoint(50, 170), place = pk(PLACE); t0 = 0; this.audio.play('bag', { vol: 0.9 }); toast(`${food} 받음 → ${place}`, '', 2200);
      this.goal(`${food} 배달 → ${place}`, dest, 2.4, () => {
        const ty = pk(TYPES.filter(t => !t.trouble)), P = new Person(ty, this.audio); P.root.position.copy(dest).add(V3(0.8, 0, 0.8)); P.lookAt(this.yawObj.position); this.scene.add(P.root); this.extra.push({ type: ty, person: P, voice: ty.voice, gender: ty.model === 'woman' ? 'f' : 'm', vIdx: 2, mood: 70 });
        const c = this.extra[this.extra.length - 1]; P.gesture('agree'); this.game.say(c, pk([['오, 빨리 오셨네요! 감사합니다.', 'happy'], ['수고하셨어요~ 맛있게 먹을게요.', 'happy'], ['아, 좀 늦었네요… 그래도 감사해요.', 'tired']]));
        setTimeout(() => { P.dispose(); this.extra.splice(this.extra.indexOf(c), 1); }, 6000);
        this.features?.stat('deliveries'); const pay = 4000 + Math.round(dest.distanceTo(V3(1.1, 0, 5.8)) * 20 / 100) * 100 + (t0 < 60 ? 1000 : 0); this.money(pay, t0 < 60 ? '배달 완료 (빠른 배달 팁)' : '배달 완료'); count++;
        if (count >= n) { self.job = null; onDone?.(); } else pickup();
      });
    });
    pickup(); toast(ic('bag') + '배달 라이더 시작! 편의점 앞 스쿠터를 타면 빨라요', 'good', 2600);
  }
  // ── 택시 기사 ──
  startTaxi(n = 99, onDone) {
    this.quitJob(); let count = 0, pax = null; const self = this;
    const taxi = this.traffic.taxi || (this.traffic.taxi = this.traffic.spawnParked(0xff9f1c, true, -16, 5.4, Math.PI / 2));
    const inTaxi = () => this.drive.ride?.obj === taxi.mesh;
    this.job = { name: '택시 기사', end() { if (pax) { pax.person.dispose(); pax = null; } } };
    const next = () => {
      const at = this.sidewalkPoint(60, 160), ty = pk(TYPES.filter(t => !t.trouble)), P = new Person(ty, this.audio); P.root.position.copy(at); this.scene.add(P.root); P.PT.up = 0.5;
      pax = { type: ty, person: P, voice: ty.voice, gender: ty.model === 'woman' ? 'f' : 'm', vIdx: 3, mood: 60 }; this.extra.push(pax);
      this.goal('손님 태우기 (택시를 손님 옆에 세우세요)', at, 7, () => {
        P.root.visible = false; this.audio.play('door', { vol: 0.8, rate: 1.2 }); this.game.say(pax, pk(RIDE)); const dest = this.sidewalkPoint(120, 260), dist = dest.distanceTo(at);
        this.goal('손님 목적지까지 운전', dest, 7, () => {
          this.audio.play('door', { vol: 0.8, rate: 1.2 }); P.root.visible = true; P.root.position.copy(dest); P.PT.up = 0; this.game.say(pax, pk([['감사합니다, 수고하세요~', 'happy'], ['카드로 할게요. 안녕히 가세요.', 'calm']]));
          this.features?.stat('taxi'); const fare = 4800 + Math.round(dist * 10 / 100) * 100; this.money(fare, '택시 요금'); count++;
          const pp = pax; setTimeout(() => { pp.person.dispose(); this.extra.splice(this.extra.indexOf(pp), 1); }, 5000); pax = null;
          if (count >= n) { self.job = null; onDone?.(); } else next();
        }, { cond: () => inTaxi() && Math.abs(this.drive.ride.v) < 2 });
      }, { cond: () => inTaxi() && Math.abs(this.drive.ride.v) < 2 });
    };
    this.goal('편의점 앞 택시에 타기', taxi.mesh.position, 3.2, next, { cond: inTaxi });
    toast(ic('check') + '택시 기사 시작! 노란 택시에 타세요', 'good', 2400);
  }
  // ── 스토리 ──
  call(lines) { let p = Promise.resolve(); for (const l of lines) p = p.then(() => this.game.say(BOSS, l)); return p; }
  finish(m, reward) { this.done.add(m.id); try { localStorage.setItem('ns_story', JSON.stringify([...this.done])); } catch (e) { } this.active = null; this.clearGoal(); this.audio.play('chime', { vol: 0.8 }); toast(`<b>미션 완료: ${m.title}</b>`, 'good', 2600); if (reward) this.money(reward, m.title); }
  start(m) { if (this.active) return; this.active = m; this.quitJob(); m.run(); }
  story() {
    const T = this.tower, park = this.city.parks?.[0] || { x: -92, z: 130 };
    const M = [
      { id: 'shift', title: '첫 근무', desc: '편의점에서 손님 3명 계산하기', run: () => { const s0 = this.game.st.served; this.call([['어이, 신입! 오늘부터 야간이야. 손님 세 명만 제대로 계산해 봐.', 'calm']]); this.goal('편의점 계산대로', V3(3.4, 0, 0.9), 1.6, null); this.active.tick = () => { if (this.game.st.served - s0 >= 3) this.finish(M[0], 20000); }; } },
      { id: 'tower', title: '사장님 심부름', desc: '달빛타워 5층 대표이사실에 서류 전달 (엘리베이터)', run: () => { this.call([['서류 하나만 갖다 줘. 옆 건물 달빛타워 5층 대표이사실이야. 엘리베이터 타고 올라가.', 'calm']]);
        this.goal('달빛타워 로비로', V3((T.door[0] + T.door[1]) / 2, 0, 3.2), 2, () => this.goal('엘리베이터로 5층 → 대표이사실 책상', V3(37.5, T.f5, 0.9), 1.6, () => { this.audio.play('bill', { vol: 0.8 }); this.call([['오, 벌써 갖다 놨어? 빠르네. 수고했어.', 'happy']]); this.finish(M[1], 30000); })); } },
      { id: 'deliver', title: '배달 대타', desc: '배달 2건 완료하기', run: () => { this.call([['배달 기사가 펑크 냈대. 가게 앞 스쿠터로 두 건만 부탁해!', 'annoyed']]); this.startDelivery(2, () => this.finish(M[2], 20000)); } },
      { id: 'thief', title: '지하상가 소매치기', desc: '지하상가에 나타난 소매치기를 잡기', run: () => { this.call([['지하상가에 소매치기가 나타났대. 가게 바로 앞 지하도로 내려가 봐!', 'angry']]);
        this.goal('지하도(달빛 지하상가)로 내려가기', V3(48, -4.2, 10.5), 4, () => {
          const ty = TYPES.find(t => t.id === 'thief') || TYPES[0], P = new Person({ ...ty, name: '소매치기' }, this.audio); P.root.position.set(66, -4.2, 11.4); this.scene.add(P.root); P.speed = 3.2;
          const c = { type: { ...ty, name: '소매치기' }, person: P, voice: ty.voice || [1, 1.1], gender: 'm', vIdx: 5, mood: 0, ped: true, thief: true }; this.extra.push(c);
          this.game.say(c, ['도, 도망쳐야 돼…!', 'scared']); const run = () => { if (c.dead || c.down) return; P.walk([V3(36 + Math.random() * 36, -4.2, pk([5.4, 11.4, 15.7]))]).then(run); }; run();
          this.goal('소매치기 잡기 (때려서 쓰러뜨리기)', P.root.position, 0.1, null, { hidden: true }); this.active.tick = () => { if (this.obj) this.obj.pos.copy(P.root.position), this.marker.position.copy(P.root.position), this.marker.visible = true; if (c.dead || c.down || (c.hp ?? 100) < 70) { this.game.say(c, ['아, 알았어요! 지갑 돌려드릴게요…', 'sad']); this.finish(M[3], 50000); } };
        }); } },
      { id: 'taxi', title: '택시 아르바이트', desc: '택시 손님 1명 목적지까지 태워 주기', run: () => { this.call([['내 친구가 택시 회사 하는데 오늘 사람이 없대. 한 번만 뛰어 줘.', 'calm']]); this.startTaxi(1, () => this.finish(M[4], 30000)); } },
      { id: 'armory', title: '창고의 비밀', desc: '창고 지하 무기고에서 총 꺼내기', run: () => { this.call([['…창고 바닥에 계단 있는 거 봤지? 전 주인이 뭘 숨겨 놨다더라. 조심해.', 'calm']]);
        this.goal('창고 지하 무기고로 내려가기', V3(3.0, -2.6, -11.5), 2.5, () => { this.goal('총기 보관함에서 총 꺼내기', V3(2.6, -2.6, -12.8), 99, null, { hidden: true }); this.active.tick = () => { if (this.crime.hasGun) this.finish(M[5], 0); }; }); } },
      { id: 'gang', title: '깡패 소탕', desc: '달빛공원에서 행패 부리는 깡패 셋 처리', run: () => { this.call([['공원에서 깡패들이 우리 가게 손님들 괴롭힌대. 네가 좀 가 봐. 다치지 말고.', 'angry']]);
        this.goal('달빛공원으로', V3(park.x, 0, park.z), 8, () => {
          const gang = [0, 1, 2].map(i => { const P = new Person({ id: 'thug', name: '깡패', model: 'man', h: 1.82, top: '#121212', bottom: '#111', hat: 'cap', voice: [0.85, 1.05] }, this.audio); P.root.position.set(park.x + 4 + i * 1.5, 0, park.z + 3); this.scene.add(P.root); const c = { type: { id: 'thug', name: '깡패' }, person: P, voice: [0.85, 1.05], gender: 'm', vIdx: i, mood: 0, ped: true, thug: true, armed: i === 2 }; this.extra.push(c); this.crime.provoke(c); return c; });
          this.active.tick = dt => { for (const c of gang) if (c.aggro) this.crime.fight(c, dt); if (gang.every(c => c.dead || c.down || (c.hp ?? 100) < 40)) this.finish(M[6], 100000); };
        }); } },
      { id: 'roof', title: '옥상의 밤', desc: '달빛타워 옥상에서 사장님 만나기', run: () => { this.call([['오늘 고생 많았다. 달빛타워 옥상으로 올라와. 할 얘기가 있어.', 'calm']]);
        this.goal('달빛타워 옥상 (엘리베이터 R)', V3(31, T.roof, -2), 4, () => this.call([['여기서 보면 우리 동네가 다 보이지? 너 덕분에 가게가 살았다.', 'happy'], ['다음 달부터 정직원이다. 수고했어!', 'happy']]).then(() => this.finish(M[7], 200000))); } },
    ];
    return M;
  }
}
