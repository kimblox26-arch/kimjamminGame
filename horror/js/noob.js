// 1인칭 시점용 로블록스 클래식 뉴비 팔 — 무언가를 집거나 열 때만 손이 나온다
import * as THREE from 'three';

const S = 0.32;
export const NOOB = { yellow: 0xF5CD30, blue: 0x0D69AC, green: 0xA4BD47 };

export function createArms() {
  const mY = new THREE.MeshStandardMaterial({ color: NOOB.yellow, roughness: 0.5 });
  const mB = new THREE.MeshStandardMaterial({ color: NOOB.blue, roughness: 0.6 });
  const root = new THREE.Group(); root.scale.setScalar(0.85);
  const arm = (side) => {
    const piv = new THREE.Group(); piv.position.set(side * 0.27, -0.4, 0.02); root.add(piv);
    const a = new THREE.Mesh(new THREE.BoxGeometry(S * 0.8, S * 0.8, 2 * S * 0.8), mY); a.position.z = -S * 0.8; piv.add(a);
    const t = new THREE.Mesh(new THREE.BoxGeometry(S * 0.84, S * 0.84, 0.06), mB); t.position.z = 0.02; piv.add(t);
    return piv;
  };
  const right = arm(1), left = arm(-1);
  const st = { reach: 0, side: 1, hurt: 0 };
  return {
    root, right, left,
    update(dt) {
      st.reach = Math.max(0, st.reach - dt * 2.2);
      const rc = Math.sin(Math.min(1, st.reach) * Math.PI);
      const up = (sd) => (st.side === sd ? rc : 0);
      right.rotation.set(-1.25 + up(1) * 1.55, 0.08, 0); right.position.z = 0.02 - up(1) * 0.2;
      left.rotation.set(-1.25 + up(-1) * 1.55, -0.08, 0); left.position.z = 0.02 - up(-1) * 0.2;
      root.position.set(0, 0, 0);
      if (st.hurt > 0) { st.hurt -= dt; root.position.x = (Math.random() - 0.5) * 0.06; }
      root.visible = rc > 0.02;
    },
    reach() { st.reach = 1; st.side = Math.random() < 0.7 ? 1 : -1; },
    hurt() { st.hurt = 0.4; },
  };
}
