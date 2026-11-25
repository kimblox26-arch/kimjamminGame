// 총 모델(권총·소총, 부품 단위) + 사격 효과: 총구 화염, 탄피, 벽 탄흔·불꽃, 피 튀김·바닥 피 웅덩이
import * as THREE from 'three';

function ctex(w, h, draw, rep) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); } return t; }
const noiseBump = (dense = 1) => ctex(128, 128, (g, w, h) => { const id = g.createImageData(w, h); for (let i = 0; i < w * h; i++) { const v = 128 + (Math.random() - 0.5) * 120 * dense; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; } g.putImageData(id, 0, 0); }, [3, 3]);
const serr = ctex(128, 32, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 8) { g.fillStyle = '#202020'; g.fillRect(x, 0, 3, h); g.fillStyle = '#d0d0d0'; g.fillRect(x + 3, 0, 1, h); } });
const steel = (o = {}) => new THREE.MeshStandardMaterial({ color: 0x24262a, metalness: 0.85, roughness: 0.32, envMapIntensity: 1.2, ...o });
const poly = (o = {}) => new THREE.MeshStandardMaterial({ color: 0x1b1c1e, metalness: 0.1, roughness: 0.75, bumpMap: noiseBump(), bumpScale: 1.2, ...o });
const B = (g, sx, sy, sz, x, y, z, m, rx = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); b.position.set(x, y, z); b.rotation.x = rx; g.add(b); return b; };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C = (g, r, l, x, y, z, m, seg = 16) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, seg), m); c.rotation.x = Math.PI / 2; c.position.set(x, y, z); g.add(c); return c; };

// 옆모습 윤곽(앞 = +f, 위 = +y)을 두께 w 로 뽑아낸 부품 (모서리 둥글게)
function side(pts, w, m, bevel = 0.0012, holes = []) {
  const s = new THREE.Shape(pts.map(([f, y]) => new THREE.Vector2(f, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([f, y]) => new THREE.Vector2(f, y))));
  const g = new THREE.ExtrudeGeometry(s, { depth: w - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -(w - bevel * 2) / 2); g.rotateY(Math.PI / 2); // f → -z(총구 방향), 두께 → x
  return new THREE.Mesh(g, m);
}
// 단면(x,y)을 길이 L 만큼 z 로 뽑기
function prism(pts, L, m, bevel = 0.001) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: L - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 }); g.translate(0, 0, -(L - bevel * 2) / 2);
  return new THREE.Mesh(g, m);
}
const stipple = ctex(256, 256, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); for (let i = 0; i < 5000; i++) { g.fillStyle = Math.random() < 0.5 ? '#3a3a3a' : '#c8c8c8'; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 1 + Math.random() * 1.6, 0, 7); g.fill(); } }, [6, 6]);
const brushed = ctex(256, 64, (g, w, h) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, h); for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.25})`; g.fillRect(0, Math.random() * h, w, 1); } }, [2, 2]);
const DOT = new THREE.MeshBasicMaterial({ color: 0xf4f4e8, toneMapped: false }), TRIT = new THREE.MeshBasicMaterial({ color: 0x9dff7a, toneMapped: false });
// 각인(레이저 마킹) 글자판: 총 옆면에 붙는 얇은 판
function engrave(lines, w, h, px = 26) { const t = ctex(512, Math.round(512 * h / w), (g, W, H) => { g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(205,205,200,.75)'; g.font = `700 ${px}px monospace`; lines.forEach((l, i) => g.fillText(l, 6, px + i * (px + 6))); }); t.colorSpace = THREE.SRGBColorSpace; return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, transparent: true, depthWrite: false, metalness: 0.6, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 })); }
// 권총 (총구 = -z). 실제 9mm 자동권총 비율: 슬라이드(톱니·배출구·약실 덮개 보임), 폴리머 프레임(레일·방아쇠울·돌기 손잡이·비버테일), 탄창 바닥판, 조작부, 야광 가늠쇠
export function makePistol() {
  const g = new THREE.Group();
  const slideM = new THREE.MeshStandardMaterial({ color: 0x232527, metalness: 0.72, roughness: 0.42, bumpMap: brushed, bumpScale: 0.6, envMapIntensity: 1.3 });
  const frameM = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.05, roughness: 0.78, envMapIntensity: 0.8 });
  const gripM = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.05, roughness: 0.9, bumpMap: stipple, bumpScale: 2.2 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.9, roughness: 0.28, envMapIntensity: 1.4 }), black = new THREE.MeshBasicMaterial({ color: 0x050505 });
  // 슬라이드: 위 모서리 깎인 단면
  const slide = new THREE.Group(); g.add(slide);
  const sl = prism([[-0.0125, 0], [0.0125, 0], [0.0125, 0.019], [0.0085, 0.0275], [-0.0085, 0.0275], [-0.0125, 0.019]], 0.187, slideM, 0.0012); sl.position.set(0, 0.018, -0.0615); slide.add(sl);
  for (let i = 0; i < 8; i++) for (const sx of [-1, 1]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.017, 0.0014), black); r.position.set(sx * 0.01255, 0.029, 0.026 - i * 0.0034); slide.add(r); }      // 뒤 톱니
  for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.014, 0.0012), black); r.position.set(sx * 0.01255, 0.028, -0.125 - i * 0.0033); slide.add(r); }    // 앞 톱니
  const port = new THREE.Mesh(new THREE.BoxGeometry(0.0095, 0.002, 0.034), black); port.position.set(0.0042, 0.0458, -0.033); slide.add(port);                                                     // 배출구
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.0024, 0.026), steel); hood.position.set(0.0042, 0.0455, -0.033); slide.add(hood);                                                     // 약실 덮개
  const ext = new THREE.Mesh(new THREE.BoxGeometry(0.0015, 0.004, 0.012), steel); ext.position.set(0.0128, 0.04, -0.018); slide.add(ext);                                                          // 추출기
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.0058, 0.0058, 0.004, 20), steel); crown.rotation.x = Math.PI / 2; crown.position.set(0, 0.033, -0.156); slide.add(crown);
  const bore = new THREE.Mesh(new THREE.CircleGeometry(0.0046, 16), black); bore.rotation.y = Math.PI; bore.position.set(0, 0.033, -0.1582); slide.add(bore);
  // 가늠쇠(야광점)·가늠자(흰 점 두 개)
  const fs = new THREE.Mesh(new THREE.BoxGeometry(0.0035, 0.0055, 0.006), steel); fs.position.set(0, 0.0485, -0.146); slide.add(fs);
  const fd = new THREE.Mesh(new THREE.CircleGeometry(0.0012, 10), TRIT); fd.position.set(0, 0.0495, -0.1428); slide.add(fd);
  for (const sx of [-1, 1]) { const rs = new THREE.Mesh(new THREE.BoxGeometry(0.0055, 0.006, 0.007), steel); rs.position.set(sx * 0.0047, 0.0485, 0.022); slide.add(rs); const d = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 10), DOT); d.position.set(sx * 0.0047, 0.0495, 0.0257); slide.add(d); }
  // 프레임 (옆모습): 레일·방아쇠울 앞·손잡이·비버테일
  const frame = side([[0.1, 0.004], [0.1, 0.019], [-0.03, 0.019], [-0.043, 0.017], [-0.05, 0.009], [-0.042, 0.002], [-0.048, -0.02], [-0.068, -0.1], [-0.024, -0.104], [-0.02, -0.07], [-0.016, -0.064], [-0.017, -0.052], [-0.012, -0.046], [-0.012, -0.034], [-0.006, -0.027], [-0.004, -0.008], [0.0, 0.004]], 0.0235, frameM, 0.0015);
  g.add(frame);
  const grip = side([[-0.042, 0.0], [-0.048, -0.02], [-0.066, -0.096], [-0.026, -0.1], [-0.019, -0.066], [-0.015, -0.035], [-0.006, -0.026], [-0.004, -0.006]], 0.0245, gripM, 0.0012); g.add(grip);   // 돌기 손잡이 면
  const guard = side([[0.0, 0.004], [0.052, 0.004], [0.056, -0.003], [0.052, -0.03], [0.044, -0.033], [-0.002, -0.026], [-0.004, -0.008]], 0.012, frameM, 0.001, [[[0.006, -0.001], [0.046, -0.001], [0.047, -0.006], [0.044, -0.026], [0.004, -0.021]]]); g.add(guard);
  for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.0022, 0.004), frameM); r.position.set(0, 0.0045, -0.078 - i * 0.009); g.add(r); }  // 레일 홈
  // 방아쇠 (안전 블레이드 포함), 탄창 멈치, 슬라이드 멈치, 분해 레버
  const trig = side([[0.032, -0.002], [0.034, -0.012], [0.03, -0.022], [0.026, -0.02], [0.028, -0.011], [0.027, -0.002]], 0.006, frameM, 0.0008); g.add(trig);
  const tb = new THREE.Mesh(new THREE.BoxGeometry(0.0018, 0.008, 0.002), steel); tb.position.set(0, -0.012, -0.0332); g.add(tb);
  const mr = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.007, 0.008), frameM); mr.position.set(-0.0128, -0.004, -0.004); g.add(mr);
  const ss = new THREE.Mesh(new THREE.BoxGeometry(0.0018, 0.004, 0.016), steel); ss.position.set(-0.0122, 0.015, -0.012); g.add(ss);
  for (const sx of [-1, 1]) { const tk = new THREE.Mesh(new THREE.BoxGeometry(0.0016, 0.003, 0.007), steel); tk.position.set(sx * 0.0122, 0.014, -0.045); g.add(tk); }
  // 탄창 (바닥판) — 장전 때 빠짐
  const mag = new THREE.Group(); g.add(mag);
  const mb = side([[-0.022, -0.096], [-0.066, -0.1], [-0.069, -0.108], [-0.024, -0.104]], 0.0255, frameM, 0.0012); mag.add(mb);
  const mbody = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.09, 0.032), steel); mbody.position.set(0, -0.06, 0.032); mbody.rotation.x = -0.22; mag.add(mbody); mbody.visible = false;
  for (const sx of [-1, 1]) { const e = engrave(sx > 0 ? ['DALBIT ARMS  9x19'] : ['DB-17  AUSTRIA'], 0.085, 0.011, 34); e.position.set(sx * 0.0131, 0.03, -0.085); e.rotation.y = sx * Math.PI / 2; slide.add(e); }
  { const e = engrave(['SN 26KR0412'], 0.04, 0.006, 40); e.position.set(0.0124, 0.006, -0.06); e.rotation.y = Math.PI / 2; g.add(e); }
  g.userData.mag = mag; g.userData.slide = slide; g.userData.cap = 15; g.userData.magwell = V(0, -0.1, 0.035);
  g.userData.muzzle = new THREE.Vector3(0, 0.033, -0.17); g.userData.eject = new THREE.Vector3(0.012, 0.047, -0.033); g.userData.auto = false; g.userData.name = '권총';
  // 두 손 파지(이등변 자세): 오른손 = 손잡이 감싸고 검지는 방아쇠, 왼손 = 오른손을 감싸 받침. p=손목, F=손가락 방향, up=손등 방향
  g.userData.base = V(0.095, -0.118, -0.42); g.userData.rot0 = [0.03, 0.03, 0]; g.userData.run = { p: V(-0.02, -0.07, 0.06), r: [-0.55, 0.35, 0.2] };
  g.userData.hold = { R: { p: V(0.026, -0.078, 0.078), F: V(-0.1, 0.12, -1), up: V(1, 0.1, 0), pose: 'trigger' }, L: { p: V(-0.04, -0.105, 0.042), F: V(0.3, 0.38, -0.87), up: V(-0.95, 0.2, 0.05), pose: 'support' } };
  g.scale.setScalar(1.2);
  return g;
}
// 소총 (총구 = -z). M4 계열: 상·하부 리시버(알루미늄), 피카티니 레일, 장전손잡이, 전진기, 배출구 덮개·노리쇠, 탄창 삽입구, 손잡이, 개머리판(완충관), 8각 총열덮개(M-LOK), 총열·소염기, 도트사이트
export function makeRifle() {
  const g = new THREE.Group();
  const alu = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, metalness: 0.55, roughness: 0.44, bumpMap: brushed, bumpScale: 0.5, envMapIntensity: 1.2 });
  const poly = new THREE.MeshStandardMaterial({ color: 0x18191b, metalness: 0.05, roughness: 0.85 }), gripM = new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.92, bumpMap: stipple, bumpScale: 2.2 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x1f2022, metalness: 0.85, roughness: 0.32, envMapIntensity: 1.3 }), black = new THREE.MeshBasicMaterial({ color: 0x050505 }), rubber = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.95 });
  const add = (m, x, y, z, rx = 0, ry = 0, rz = 0) => { m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };
  const B = (sx, sy, sz, m, x, y, z, rx = 0) => add(new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m), x, y, z, rx);
  const Cz = (r, l, m, x, y, z, seg = 16) => add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, seg), m), x, y, z, Math.PI / 2);
  // 상부 리시버 + 레일
  add(prism([[-0.015, -0.008], [0.015, -0.008], [0.015, 0.022], [0.011, 0.03], [-0.011, 0.03], [-0.015, 0.022]], 0.21, alu, 0.0015), 0, 0, -0.035);
  B(0.022, 0.006, 0.2, alu, 0, 0.033, -0.04); for (let i = 0; i < 18; i++) B(0.024, 0.004, 0.0055, alu, 0, 0.038, 0.055 - i * 0.0105);
  B(0.04, 0.008, 0.016, poly, 0, 0.022, 0.082); B(0.012, 0.006, 0.02, poly, 0.022, 0.024, 0.08);                             // 장전손잡이(T자 + 걸쇠)
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.006, 0.026, 12), steel), 0.02, 0.014, 0.038, 0, 0, Math.PI / 2 - 0.5); // 전진기
  B(0.003, 0.016, 0.05, black, 0.0153, 0.008, -0.01);                                                                         // 배출구
  const bolt = B(0.004, 0.013, 0.046, steel, 0.0135, 0.008, -0.01);                                                         // 노리쇠 (쏘면 움직임)
  const dc = B(0.0015, 0.014, 0.05, alu, 0.017, -0.006, -0.01); dc.rotation.z = 0.9;                                          // 열린 배출구 덮개
  B(0.005, 0.012, 0.012, alu, 0.017, 0.016, 0.03);                                                                            // 탄피 굴절판
  // 하부 리시버 + 탄창 삽입구 + 핀·조정간
  add(prism([[-0.0148, -0.034], [0.0148, -0.034], [0.0148, -0.008], [-0.0148, -0.008]], 0.24, alu, 0.0015), 0, 0, -0.02);
  add(side([[0.13, -0.034], [0.05, -0.034], [0.048, -0.062], [0.134, -0.064]], 0.034, alu, 0.0015), 0, 0, 0);
  for (const z of [-0.12, 0.085]) for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.003, 12), steel); p.rotation.z = Math.PI / 2; p.position.set(sx * 0.0158, -0.02, z); g.add(p); }
  B(0.003, 0.004, 0.018, steel, -0.0162, -0.018, 0.05).rotation.x = 0.4;                                                     // 조정간
  B(0.003, 0.012, 0.01, steel, -0.016, -0.03, -0.045);                                                                        // 노리쇠 멈치
  // 방아쇠울·방아쇠
  add(side([[0.03, -0.034], [0.034, -0.05], [-0.03, -0.05], [-0.034, -0.034]], 0.014, alu, 0.001, [[[0.026, -0.036], [0.028, -0.046], [-0.026, -0.046], [-0.028, -0.036]]]), 0, 0, 0);
  add(side([[0.004, -0.034], [0.006, -0.042], [0.002, -0.047], [-0.001, -0.046], [0.002, -0.041], [0.0, -0.034]], 0.005, steel, 0.0006), 0, 0, 0);
  // 권총형 손잡이 (손가락 홈, 돌기)
  add(side([[-0.032, -0.03], [-0.02, -0.03], [-0.026, -0.06], [-0.032, -0.07], [-0.034, -0.085], [-0.045, -0.118], [-0.082, -0.122], [-0.085, -0.112], [-0.062, -0.03]], 0.03, gripM, 0.0025), 0, 0, 0);
  // 완충관 + 개머리판 (접이식 6단)
  Cz(0.0155, 0.2, alu, 0, 0.006, 0.2, 20); for (let i = 0; i < 6; i++) B(0.004, 0.003, 0.004, black, 0, -0.0095, 0.14 + i * 0.018);
  add(side([[-0.17, 0.03], [-0.34, 0.03], [-0.36, 0.032], [-0.365, -0.07], [-0.345, -0.075], [-0.3, -0.04], [-0.2, -0.016], [-0.17, -0.012]], 0.04, poly, 0.003), 0, 0, 0);
  add(side([[-0.36, 0.034], [-0.372, 0.034], [-0.376, -0.076], [-0.364, -0.076]], 0.044, rubber, 0.002), 0, 0, 0);
  // 8각 총열 덮개 (M-LOK 홈) + 위 레일 연장
  const mlok = ctex(512, 64, (c, w, h) => { c.fillStyle = '#9a9a9a'; c.fillRect(0, 0, w, h); for (let x = 14; x < w; x += 42) { c.fillStyle = '#0a0a0a'; c.beginPath(); c.roundRect ? c.roundRect(x, 18, 30, 28, 8) : c.rect(x, 18, 30, 28); c.fill(); } }, [1, 8]);
  const hgM = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, metalness: 0.5, roughness: 0.48, bumpMap: mlok, bumpScale: 4, envMapIntensity: 1.1 });
  const hg = Cz(0.026, 0.33, hgM, 0, 0.002, -0.305, 8); hg.rotation.y = Math.PI / 8;
  B(0.02, 0.006, 0.33, alu, 0, 0.03, -0.305); for (let i = 0; i < 30; i++) B(0.022, 0.004, 0.0055, alu, 0, 0.035, -0.148 - i * 0.0107);
  // 총열·가스블록·소염기(새장형)
  Cz(0.0085, 0.2, steel, 0, 0.004, -0.565); Cz(0.0115, 0.056, steel, 0, 0.004, -0.693, 12);
  for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i - 2) * 0.55, s = new THREE.Mesh(new THREE.BoxGeometry(0.0025, 0.004, 0.03), black); s.position.set(Math.cos(a) * 0.0112, 0.004 - Math.sin(a) * 0.0112, -0.698); s.rotation.z = a; g.add(s); }
  const mzF = new THREE.Mesh(new THREE.CircleGeometry(0.0055, 12), black); mzF.position.set(0, 0.004, -0.7215); mzF.rotation.y = Math.PI; g.add(mzF);
  // 도트사이트 (튜브형, 렌즈, 다이얼) + 마운트
  B(0.02, 0.03, 0.04, alu, 0, 0.052, -0.04);
  Cz(0.0175, 0.11, alu, 0, 0.082, -0.05, 24); Cz(0.02, 0.012, rubber, 0, 0.082, -0.105, 24); Cz(0.02, 0.012, rubber, 0, 0.082, 0.005, 24);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 16), alu), 0, 0.104, -0.05); add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 16), alu), 0.023, 0.082, -0.05, 0, 0, Math.PI / 2);
  const lensM = new THREE.MeshPhysicalMaterial({ color: 0x223344, metalness: 0.2, roughness: 0.02, clearcoat: 1, transparent: true, opacity: 0.55, envMapIntensity: 2 });
  const lf = new THREE.Mesh(new THREE.CircleGeometry(0.0158, 24), lensM); lf.position.set(0, 0.082, -0.111); lf.rotation.y = Math.PI; g.add(lf);
  const lr = new THREE.Mesh(new THREE.CircleGeometry(0.0158, 24), lensM); lr.position.set(0, 0.082, 0.0115); g.add(lr);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0014, 10), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false })); dot.position.set(0, 0.082, -0.06); g.add(dot);
  // 탄창 (휘어진 30발, 옆 홈, 바닥판) — 장전 때 빠짐
  const ms = new THREE.Shape(); ms.moveTo(0, 0); ms.lineTo(0.064, 0); ms.quadraticCurveTo(0.082, -0.1, 0.056, -0.2); ms.lineTo(-0.008, -0.192); ms.quadraticCurveTo(0.016, -0.09, 0, 0);
  const mg = new THREE.ExtrudeGeometry(ms, { depth: 0.024, bevelEnabled: true, bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 1 }); mg.translate(-0.032, 0, -0.012); mg.rotateY(Math.PI / 2);
  const magG = new THREE.Group(); magG.position.set(0, -0.034, -0.088); g.add(magG);
  magG.add(new THREE.Mesh(mg, new THREE.MeshStandardMaterial({ color: 0x232426, metalness: 0.4, roughness: 0.55 })));
  const bp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.07), poly); bp.position.set(0, -0.198, 0.008); bp.rotation.x = 0.12; magG.add(bp);
  { const e = engrave(['SAFE', '', 'SEMI', '', 'AUTO'], 0.022, 0.03, 30); e.position.set(-0.0156, -0.02, 0.055); e.rotation.y = -Math.PI / 2; g.add(e); }
  { const e = engrave(['DALBIT DEFENSE  M4-K', 'CAL 5.56 NATO  SN 0412'], 0.08, 0.016, 26); e.position.set(-0.0156, -0.022, -0.03); e.rotation.y = -Math.PI / 2; g.add(e); }
  g.userData.mag = magG; g.userData.bolt = bolt; g.userData.cap = 30; g.userData.magwell = V(0, -0.06, -0.09);
  g.userData.muzzle = new THREE.Vector3(0, 0.004, -0.73); g.userData.eject = new THREE.Vector3(0.02, 0.01, -0.01); g.userData.auto = true; g.userData.name = '소총';
  // 오른손 = 권총손잡이, 왼손 = 총열 덮개 아래 받침. 달릴 땐 총구를 왼쪽 아래로 내림(로우 레디)
  g.userData.base = V(0.125, -0.165, -0.3); g.userData.rot0 = [0.02, 0.04, 0]; g.userData.run = { p: V(-0.03, -0.06, 0.05), r: [-0.5, 0.55, 0.35] };
  g.userData.hold = { R: { p: V(0.03, -0.088, 0.115), F: V(-0.08, 0.1, -1), up: V(1, 0.15, 0), pose: 'trigger' }, L: { p: V(-0.04, -0.078, -0.25), F: V(0.55, 0.28, -0.78), up: V(-0.45, -0.88, 0), pose: 'support' } };
  return g;
}

// ── 효과 ──
const floorAt = p => (p.y < -1.2 && Math.abs(p.z) < 40 ? -4.2 : 0);
const smokeTex = ctex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
const flashTex = ctex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64); gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.25, 'rgba(255,200,90,.9)'); gr.addColorStop(1, 'rgba(255,120,20,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(255,230,150,.9)'; g.lineWidth = 6; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62); g.stroke(); } });
const bloodTex = ctex(128, 128, (g, w, h) => { for (let i = 0; i < 26; i++) { const r = 6 + Math.random() * 22, x = 64 + (Math.random() - 0.5) * 70, y = 64 + (Math.random() - 0.5) * 70; const gr = g.createRadialGradient(x, y, 1, x, y, r); gr.addColorStop(0, 'rgba(90,0,0,.95)'); gr.addColorStop(0.7, 'rgba(110,5,5,.85)'); gr.addColorStop(1, 'rgba(110,5,5,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); } });
const holeTex = ctex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 1, 32, 32, 30); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.25, 'rgba(20,20,20,.9)'); gr.addColorStop(0.5, 'rgba(60,60,60,.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
export class FX {
  constructor(scene) { this.scene = scene; this.parts = []; this.decals = []; this.brass = new THREE.MeshStandardMaterial({ color: 0xc9a040, metalness: 0.9, roughness: 0.3 }); this.bloodM = new THREE.MeshBasicMaterial({ color: 0x7a0000 }); }
  muzzle(gun) {
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    f.scale.setScalar(gun.userData.auto ? 0.22 : 0.16); f.position.copy(gun.userData.muzzle); f.material.rotation = Math.random() * 6; gun.add(f);
    const L = new THREE.PointLight(0xffb050, 25, 6); L.position.copy(gun.userData.muzzle); gun.add(L);
    setTimeout(() => { gun.remove(f); gun.remove(L); f.material.dispose(); }, 55);
    // 탄피 배출
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.02, 8), this.brass); gun.localToWorld(s.position.copy(gun.userData.eject)); this.scene.add(s);
    const right = new THREE.Vector3(1, 0.6, 0.2).applyQuaternion(gun.getWorldQuaternion(new THREE.Quaternion()));
    this.parts.push({ m: s, v: right.multiplyScalar(2 + Math.random()), spin: new THREE.Vector3(Math.random() * 20, Math.random() * 20, 0), life: 3, bounce: true, tink: true, fl: floorAt(s.position) });
    this.smoke(gun.localToWorld(gun.userData.muzzle.clone()));
  }
  // 총구 연기 (천천히 퍼지며 사라짐)
  smoke(p, color = 0xb8b8b8, sc = 1) {
    for (let i = 0; i < 2; i++) { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color, transparent: true, depthWrite: false, opacity: 0.3 })); m.position.copy(p); m.material.rotation = Math.random() * 6; this.scene.add(m);
      this.parts.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.25 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3), life: 1.3, L: 1.3, smoke: true, s0: 0.04 * sc, s1: (0.28 + Math.random() * 0.15) * sc }); }
  }
  // 떨어지는 물건 (빈 탄창)
  drop(obj, v) { this.scene.add(obj); this.parts.push({ m: obj, v, spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, 0), life: 8, bounce: true, tink: true, fl: floorAt(obj.position) }); }
  // 사람 맞음: 피가 총알 방향으로 튐
  blood(p, dir, n = 14) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.008 + Math.random() * 0.012, 5, 4), this.bloodM); m.position.copy(p); this.scene.add(m);
      const v = dir.clone().multiplyScalar(1.5 + Math.random() * 2.5).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.6, (Math.random() - 0.5) * 2));
      this.parts.push({ m, v, life: 1.2, blood: true, fl: floorAt(p) });
    }
  }
  // 바닥 피 웅덩이 (점점 커짐)
  pool(p, max = 1.1) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: bloodTex, transparent: true, depthWrite: false, roughness: 0.15, metalness: 0.1, color: 0xffffff }));
    m.rotation.set(-Math.PI / 2, 0, Math.random() * 6); m.position.set(p.x, floorAt(p) + 0.006 + this.decals.length * 0.0004, p.z); m.scale.setScalar(0.05); m.renderOrder = 2; this.scene.add(m);
    this.decals.push(m); this.parts.push({ m, grow: max, life: 99 });
  }
  splat(p) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.25), new THREE.MeshBasicMaterial({ map: bloodTex, transparent: true, depthWrite: false })); m.rotation.set(-Math.PI / 2, 0, Math.random() * 6); m.position.set(p.x, floorAt(p) + 0.007, p.z); this.scene.add(m); this.decals.push(m); }
  // 벽·물건 맞음: 탄흔 + 불꽃
  impact(hit) {
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), new THREE.MeshBasicMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    d.position.copy(hit.point).addScaledVector(n, 0.003); d.lookAt(d.position.clone().add(n)); this.scene.add(d); this.decals.push(d);
    // 벽 조각·먼지
    for (let i = 0; i < 5; i++) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.012), this.chipM ||= new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.9 })); c.position.copy(hit.point); this.scene.add(c); this.parts.push({ m: c, v: n.clone().multiplyScalar(1.5 + Math.random() * 2).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2)), spin: new THREE.Vector3(9, 7, 0), life: 1.6, bounce: true, fl: floorAt(hit.point) }); }
    this.smoke(hit.point.clone().addScaledVector(n, 0.05), 0xb8b0a4, 0.5);
    for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.006, 4, 3), new THREE.MeshBasicMaterial({ color: 0xffd080, toneMapped: false })); s.position.copy(hit.point); this.scene.add(s); this.parts.push({ m: s, v: n.clone().multiplyScalar(2).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)), life: 0.25, fl: floorAt(hit.point) }); }
    return d;
  }
  update(dt, audio) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]; p.life -= dt;
      if (p.grow) { p.m.scale.setScalar(Math.min(p.grow, p.m.scale.x + dt * 0.25)); continue; }
      if (p.smoke) { const k = 1 - p.life / p.L; p.m.position.addScaledVector(p.v, dt); p.v.multiplyScalar(Math.exp(-dt * 2)); p.m.scale.setScalar(p.s0 + k * p.s1); p.m.material.opacity = 0.32 * (1 - k); p.m.material.rotation += dt * 0.4; if (p.life <= 0) { p.m.removeFromParent(); p.m.material.dispose(); this.parts.splice(i, 1); } continue; }
      p.v.y -= 9.8 * dt; p.m.position.addScaledVector(p.v, dt); if (p.spin) { p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt; }
      const fl = p.fl ?? 0;
      if (p.m.position.y < fl + 0.005) {
        if (p.blood) { if (Math.random() < 0.35) this.splat(p.m.position); p.life = 0; }
        else if (p.bounce && p.v.y < -0.5) { p.v.y *= -0.35; p.v.x *= 0.5; p.v.z *= 0.5; p.m.position.y = fl + 0.005; if (p.tink) { audio?.play(Math.random() < 0.5 ? 'brass1' : 'brass2', { pos: p.m.position, vol: 0.45, rate: 0.95 + Math.random() * 0.15, dur: 0.6 }); p.tink = false; } }
        else { p.m.position.y = fl + 0.005; p.v.set(0, 0, 0); if (p.spin) p.spin.set(0, 0, 0); }
      }
      if (p.life <= 0) { p.m.removeFromParent(); this.parts.splice(i, 1); }
    }
    while (this.decals.length > 60) this.decals.shift().removeFromParent();
  }
  clear() { for (const p of this.parts) p.m.removeFromParent(); for (const d of this.decals) d.removeFromParent(); this.parts = []; this.decals = []; }
}
