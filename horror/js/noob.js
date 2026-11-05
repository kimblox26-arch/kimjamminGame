// 1인칭 시점용 로블록스 클래식 뉴비 팔 (노란 R6 팔 + 손전등)
import * as THREE from 'three';

const S = 0.32;                       // 1 스터드 (m)
export const NOOB = { yellow: 0xF5CD30, blue: 0x0D69AC, green: 0xA4BD47 };

export function createArms() {
  const mY = new THREE.MeshStandardMaterial({ color: NOOB.yellow, roughness: 0.5 });
  const mB = new THREE.MeshStandardMaterial({ color: NOOB.blue, roughness: 0.6 });
  const root = new THREE.Group(); root.scale.setScalar(0.85);
  const arm = (side) => {
    const piv = new THREE.Group(); piv.position.set(side * 0.27, -0.4, 0.02); root.add(piv);
    const a = new THREE.Mesh(new THREE.BoxGeometry(S * 0.8, S * 0.8, 2 * S * 0.8), mY); a.position.z = -S * 0.8; piv.add(a);
    // 어깨 쪽에 파란 몸통 끝이 살짝 보이게
    const t = new THREE.Mesh(new THREE.BoxGeometry(S * 0.84, S * 0.84, 0.06), mB); t.position.z = 0.02; piv.add(t);
    return piv;
  };
  const right = arm(1), left = arm(-1);
  // 손전등
  const tm = new THREE.MeshStandardMaterial({ color: 0x1e1e22, metalness: 0.6, roughness: 0.4 });
  const torch = new THREE.Group(); torch.position.set(0, 0.04, -0.56); right.add(torch);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.028, 0.2, 12), tm); body.rotation.x = Math.PI / 2; torch.add(body);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.034, 0.07, 14), tm); head.rotation.x = Math.PI / 2; head.position.z = -0.12; torch.add(head);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.044, 14), new THREE.MeshBasicMaterial({ color: 0xfff4d0 })); lens.position.z = -0.156; torch.add(lens);

  const st = { ph: 0, rUp: 1, lUp: 0, reach: 0, swayX: 0, swayY: 0, hurt: 0 };
  return {
    root, right, left, torch, lens,
    update(dt, { speed = 0, run = false, torchOn = true, lookDX = 0, lookDY = 0 }) {
      st.ph += dt * speed * (run ? 2.6 : 3.2);
      const k = Math.min(1, speed / 3);
      st.rUp += ((torchOn ? 1 : 0) - st.rUp) * Math.min(1, dt * 8);
      st.reach = Math.max(0, st.reach - dt * 2.4);
      const rc = Math.sin(Math.min(1, st.reach) * Math.PI);
      st.lUp += ((rc > 0.01 ? 1 : 0) - st.lUp) * Math.min(1, dt * 10);
      st.swayX += (-lookDX * 0.6 - st.swayX) * Math.min(1, dt * 8);
      st.swayY += (lookDY * 0.6 - st.swayY) * Math.min(1, dt * 8);
      const bx = Math.sin(st.ph) * 0.025 * k, by = -Math.abs(Math.cos(st.ph)) * (run ? 0.04 : 0.022) * k;
      root.position.set(bx + st.swayX * 0.05, by + st.swayY * 0.05, 0);
      // 오른팔: 손전등을 앞으로 든다 (끄면 내린다)
      right.rotation.set(0.37 - (1 - st.rUp) * 1.3 + Math.sin(st.ph * 2) * 0.02 * k, 0.06, 0);
      right.position.z = 0.02;
      // 왼팔: 조사할 때 앞으로 뻗는다
      left.rotation.set(-1.2 + st.lUp * 1.45 + rc * 0.1, -0.1, 0);
      left.position.z = 0.02 - rc * 0.2;
      if (st.hurt > 0) { st.hurt -= dt; root.position.x += (Math.random() - 0.5) * 0.06; root.position.y += (Math.random() - 0.5) * 0.06; }
      torch.visible = st.rUp > 0.05;
    },
    reach() { st.reach = 1; },
    hurt() { st.hurt = 0.4; },
  };
}
