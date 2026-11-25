// 성능: (1) 조명 관리자 — 장면 전체의 수십 개 조명을 '내 주변 4개'로 줄여 매 화면 계산량을 크게 줄임 (조명 개수 고정 → 셰이더 재컴파일·끊김 없음)
//       (2) 정적 물체 합치기 — 같은 재질끼리 하나로 합쳐 그리기 호출 수를 줄임
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export class LightManager {
  constructor(scene, keep, n = 4) {
    this.scene = scene; this.keep = new Set(keep); this.reg = []; this.t = 0;
    this.pool = Array.from({ length: n }, () => { const l = new THREE.PointLight(0xffffff, 0, 10, 1.5); scene.add(l); this.keep.add(l); return l; });
  }
  // 장면의 조명을 등록 정보(위치용 앵커·색·세기·거리)로 바꾸고 실제 조명은 뺌
  harvest() {
    const found = []; this.scene.traverse(o => { if ((o.isPointLight || o.isSpotLight) && !this.keep.has(o)) found.push(o); });
    for (const l of found) {
      const a = new THREE.Object3D(); a.position.copy(l.position); l.parent.add(a);
      this.reg.push({ a, color: l.color.clone(), intensity: l.intensity, distance: l.distance || 12, decay: l.decay ?? 1.6, src: l, spot: l.isSpotLight });
      l.removeFromParent(); l.visible = false;
    }
    return found.length;
  }
  update(dt, cam) {
    if ((this.t -= dt) > 0) { for (const p of this.pool) if (p.userData.e) this.sync(p, p.userData.e, dt); return; }
    this.t = 0.25; if (this.harvest()) { }
    const v = new THREE.Vector3(), cand = [];
    for (const e of this.reg) { if (!e.a.parent || !isVisible(e.a)) continue; e.a.getWorldPosition(v); const d = v.distanceTo(cam); if (d < e.distance * 1.4 + 2) cand.push([d / (e.distance + 1) - e.src.intensity * 0.0005, e]); }
    cand.sort((a, b) => a[0] - b[0]);
    this.pool.forEach((p, i) => { const e = cand[i]?.[1] || null; if (p.userData.e !== e) { p.userData.e = e; if (e) { e.a.getWorldPosition(p.position); p.intensity = 0; } } });
    for (const p of this.pool) if (p.userData.e) this.sync(p, p.userData.e, dt); else p.intensity *= 0.5;
  }
  sync(p, e, dt) { e.a.getWorldPosition(p.position); p.color.copy(e.src.color); p.distance = e.distance; p.decay = e.decay; const target = e.src.intensity * (e.spot ? 0.25 : 1); p.intensity += (target - p.intensity) * Math.min(1, dt * 8 + 0.15); }
}
function isVisible(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }

// 정적 물체 합치기: group 안의 보이는 단일 재질 메시를 재질별로 합침. skip(o) 가 true 인 것과 그 아래는 그대로 둠
export function mergeStatic(group, skip = () => false) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert(), buckets = new Map(), victims = [];
  const walk = o => {
    if (o !== group && skip(o)) return;
    if (o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && o.visible && !Array.isArray(o.material) && !o.userData.aim && !o.userData.keep && o.geometry.attributes.position) {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      const key = o.material.uuid; if (!buckets.has(key)) buckets.set(key, { m: o.material, list: [], cast: false }); const b = buckets.get(key); b.list.push(g); b.cast ||= o.castShadow;
      victims.push(o);
    }
    for (const c of [...o.children]) walk(c);
  };
  walk(group);
  let saved = 0;
  for (const { m, list, cast } of buckets.values()) {
    if (list.length < 2) continue;
    const merged = mergeGeometries(list); if (!merged) continue;
    const mesh = new THREE.Mesh(merged, m); mesh.receiveShadow = true; mesh.castShadow = cast; mesh.matrixAutoUpdate = false; group.add(mesh); saved += list.length - 1;
    for (const o of victims) if (o.material === m) o.removeFromParent();
  }
  return saved;
}
