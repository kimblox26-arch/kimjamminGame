// 실제 편의점 느낌을 만드는 디테일: 선반 머리판·행사 쪽지(1+1)·엔드캡 행사 매대·바닥 그림자·천장 격자 조명·
// 창가 취식대(의자·온수기)·가게 앞 파라솔 테이블
import * as THREE from 'three';

export function addDecor({ root, scene, B, std, canvasTex, FONT, shelfSlots, merch }) {
  const R = (a) => a[Math.random() * a.length | 0];
  // ── 바닥 접촉 그림자 (가구 밑이 어두워야 바닥에 붙어 보임) ──
  const shTex = canvasTex('shadow', 128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(0.6, 'rgba(0,0,0,.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const shMat = new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, opacity: 0.9 });
  const shadow = (x, z, sx, sz, o = 0.9) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), shMat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.003, z); m.renderOrder = 1; if (o !== 0.9) { m.material = shMat.clone(); m.material.opacity = o; } root.add(m); };
  shadow(-3, 0, 1.4, 4.6); shadow(-1, 0, 1.4, 4.6); shadow(-4.8, 0, 0.9, 5.8); shadow(-1.35, -3.3, 6.8, 0.9);
  shadow(2.55, 0.6, 1.0, 4.0); shadow(4.35, 0.9, 0.8, 3.2); shadow(-1.5, 3.3, 1.8, 1.0); shadow(-4.4, 3.45, 1.0, 0.9); shadow(-3.1, 3.55, 2.2, 0.8, 0.6);

  // ── 천장: 600mm 격자 + 정사각 LED 평판 조명 ──
  const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(2.2) });
  const frameMat = std({ color: 0xcfd3d8, roughness: 0.4, metalness: 0.4 });
  for (let x = -4.2; x <= 3.8; x += 1.8) for (let z = -3.0; z <= 3.2; z += 1.8) {
    B.box(ledMat, 0.58, 0.012, 0.58, x, 2.792, z); B.box(frameMat, 0.62, 0.01, 0.02, x, 2.79, z - 0.3); B.box(frameMat, 0.62, 0.01, 0.02, x, 2.79, z + 0.3); B.box(frameMat, 0.02, 0.01, 0.62, x - 0.3, 2.79, z); B.box(frameMat, 0.02, 0.01, 0.62, x + 0.3, 2.79, z);
  }
  // ── 곤돌라 머리판 (카테고리) + 바닥 걸레받이 ──
  const heads = { '-3:-1': '라면 · 컵라면', '-3:1': '과자 · 스낵', '-1:-1': '쿠키 · 사탕', '-1:1': '생활용품', '-4.85:1': '스낵 · 안주' };
  for (const [k, txt] of Object.entries(heads)) {
    const [cx, s] = k.split(':').map(Number), len = cx === -4.85 ? 5.2 : 4, hgt = cx === -4.85 ? 1.9 : 1.45;
    const t = canvasTex('head' + k, 2048, 96, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#1f2d4a'; g.fillRect(0, h - 12, w, 12); g.fillStyle = '#ffc53d'; g.fillRect(0, 0, 18, h); g.fillStyle = '#1f2d4a'; g.font = `900 58px ${FONT}`; g.fillText(txt, 40, 68); g.fillStyle = '#d62828'; g.font = `900 46px ${FONT}`; g.textAlign = 'right'; g.fillText('1+1 · 2+1 행사중', w - 24, 62); });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.1, 0.1), new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }));
    m.position.set(cx + s * 0.035, hgt + 0.06, 0); m.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2; root.add(m);
    B.box(std({ color: 0xb9bec5, roughness: 0.5 }), 0.03, 0.11, len, cx + s * 0.017, hgt + 0.06, 0);
  }
  // ── 선반 행사 쪽지 (선반 끝에 수직으로 튀어나온 노란/빨간 카드) ──
  const popT = ['1+1', '2+1', '할인', 'NEW', '인기'], popTex = {};
  for (const t of popT) popTex[t] = canvasTex('pop' + t, 128, 160, (g, w, h) => { g.fillStyle = t === '할인' ? '#d62828' : t === 'NEW' ? '#118ab2' : '#ffd400'; g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 14); g.fill(); g.fillStyle = t === '1+1' || t === '2+1' || t === '인기' ? '#d62828' : '#fff'; g.font = `900 ${t.length > 2 ? 44 : 54}px ${FONT}`; g.textAlign = 'center'; g.fillText(t, w / 2, 92); g.font = `800 20px ${FONT}`; g.fillText('행사상품', w / 2, 132); });
  for (const sl of shelfSlots) {
    if (Math.random() < 0.45) continue;
    const t = R(popT), m = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.095), new THREE.MeshStandardMaterial({ map: popTex[t], roughness: 0.5, side: THREE.DoubleSide, transparent: true }));
    m.position.set(sl.cx + sl.s * 0.49, sl.y - 0.02, sl.z0 + Math.random() * (sl.z1 - sl.z0)); root.add(m);
  }
  // ── 엔드캡 행사 매대: 곤돌라 끝(입구 쪽)에 상자 쌓기 + 큰 POP ──
  for (const cx of [-3, -1]) {
    B.box(std({ color: 0xffffff, roughness: 0.4 }), 0.9, 0.08, 0.5, cx, 0.04, 2.28);
    for (let lv = 0; lv < 4; lv++) for (let i = 0; i < 4; i++) for (let d = 0; d < 2; d++) merch.add('box', cx - 0.32 + i * 0.21, 0.08 + lv * 0.12, 2.18 + d * 0.15, 0, (cx === -3 ? 5 : 21) + (lv % 2), 1);
    const pop = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.42), new THREE.MeshStandardMaterial({ roughness: 0.5, map: canvasTex('endpop' + cx, 512, 300, (g, w, h) => { g.fillStyle = '#d62828'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffd400'; g.font = `900 130px ${FONT}`; g.textAlign = 'center'; g.fillText(cx === -3 ? '1+1' : '2+1', w / 2, 150); g.fillStyle = '#fff'; g.font = `800 44px ${FONT}`; g.fillText(cx === -3 ? '이번 주 과자 행사' : '쿠키 골라담기', w / 2, 230); }) }));
    pop.position.set(cx, 0.9, 2.56); root.add(pop);
    B.box(std({ color: 0xdddddd, metalness: 0.6, roughness: 0.3 }), 0.015, 0.45, 0.015, cx, 0.5, 2.55);
  }
  // ── 창가 취식대 (높은 테이블 + 의자 3개) + 컵라면 온수기 + 냅킨 ──
  const top = std({ color: 0xe9e4da, roughness: 0.35 }), chrome = std({ color: 0xc9ced4, metalness: 0.9, roughness: 0.25 });
  B.box(top, 1.7, 0.035, 0.42, -3.12, 1.02, 3.62);
  B.box(chrome, 0.04, 1.0, 0.04, -3.9, 0.5, 3.62); B.box(chrome, 0.04, 1.0, 0.04, -2.35, 0.5, 3.62);
  for (const x of [-3.65, -3.12, -2.6]) {
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.06, 20), std({ color: 0x2b2f36, roughness: 0.6 })); seat.position.set(x, 0.72, 3.2); root.add(seat);
    B.add(chrome, new THREE.CylinderGeometry(0.025, 0.025, 0.7, 10), x, 0.35, 3.2); B.add(chrome, new THREE.CylinderGeometry(0.2, 0.22, 0.02, 20), x, 0.01, 3.2);
    B.add(chrome, new THREE.TorusGeometry(0.16, 0.012, 6, 20).rotateX(Math.PI / 2), x, 0.3, 3.2);
  }
  const hw = new THREE.Group(); hw.position.set(-2.15, 0, 3.6); root.add(hw);
  hw.add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.9, 0.38), std({ color: 0xf4f4f4, roughness: 0.4 }))); hw.children[0].position.y = 0.45;
  const hwTop = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 0.34), std({ color: 0xd8dbe0, roughness: 0.3, metalness: 0.6 })); hwTop.position.y = 1.11; hw.add(hwTop);
  const hwFace = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), new THREE.MeshBasicMaterial({ map: canvasTex('hwface', 256, 150, (g, w, h) => { g.fillStyle = '#1f2d4a'; g.fillRect(0, 0, w, h); g.fillStyle = '#ff5a5a'; g.font = `900 34px ${FONT}`; g.fillText('온수', 18, 52); g.fillStyle = '#fff'; g.font = `700 20px ${FONT}`; g.fillText('컵라면 물 받는 곳', 18, 92); g.fillStyle = '#7fe3ff'; g.fillText('뜨거우니 조심하세요', 18, 126); }) }));
  hwFace.position.set(0, 1.18, -0.171); hwFace.rotation.y = Math.PI; hw.add(hwFace);
  for (const dx of [-0.08, 0.08]) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.06, 8), chrome); sp.position.set(dx, 0.94, -0.15); hw.add(sp); }
  const nap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.1), std({ color: 0xffffff, roughness: 0.8 })); nap.position.set(-3.75, 1.08, 3.65); root.add(nap);
  const eatSign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.18), new THREE.MeshStandardMaterial({ map: canvasTex('eat', 256, 92, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#2a9d8f'; g.fillRect(0, 0, w, 12); g.fillStyle = '#1f2d4a'; g.font = `900 34px ${FONT}`; g.textAlign = 'center'; g.fillText('취식 공간', w / 2, 62); }) }));
  eatSign.position.set(-3.12, 1.3, 3.9); eatSign.rotation.y = Math.PI; root.add(eatSign);
  // ── 가게 앞 초록 파라솔 테이블 (한국 편의점 밤 풍경) ──
  const green = std({ color: 0x2f7d32, roughness: 0.45 }), white = std({ color: 0xf2f2f2, roughness: 0.6 });
  const parasolTex = canvasTex('parasol', 512, 64, (g, w, h) => { for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#ffffff' : '#1f2d4a'; g.fillRect(i * w / 8, 0, w / 8, h); } g.fillStyle = '#ffc53d'; g.font = `900 30px ${FONT}`; g.fillText('달빛24', 30, 44); g.fillText('달빛24', 286, 44); });
  for (const [tx, tz] of [[-3.6, 5.45], [-1.6, 5.5]]) {
    const t = new THREE.Group(); t.position.set(tx, 0.06, tz); root.add(t);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 28), green); disc.position.y = 0.72; t.add(disc);
    for (let i = 0; i < 4; i++) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.72, 8), green); const a = i * Math.PI / 2 + 0.4; leg.position.set(Math.cos(a) * 0.3, 0.36, Math.sin(a) * 0.3); leg.rotation.set(Math.sin(a) * 0.15, 0, -Math.cos(a) * 0.15); t.add(leg); }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.1, 8), white); pole.position.y = 1.05; t.add(pole);
    const umb = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.42, 16, 1, true), new THREE.MeshStandardMaterial({ map: parasolTex, roughness: 0.7, side: THREE.DoubleSide })); umb.position.y = 2.05; t.add(umb);
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 0.5, ch = new THREE.Group(); ch.position.set(Math.cos(a) * 0.65, 0, Math.sin(a) * 0.65); ch.rotation.y = -a - Math.PI / 2; t.add(ch);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.4), green); seat.position.y = 0.42; ch.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.03), green); back.position.set(0, 0.62, -0.2); back.rotation.x = -0.12; ch.add(back);
      for (const [lx, lz] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.42, 6), green); l.position.set(lx, 0.21, lz); ch.add(l); }
    }
    if (tx < -2) { for (let i = 0; i < 2; i++) merch.add('can', tx + 0.1 + i * 0.1, 0.81, tz - 0.05, 0, 3 + i * 9); }
  }
}
