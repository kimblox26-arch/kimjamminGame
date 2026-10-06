// 저장/불러오기 (localStorage) — 구조물·부품·접합·찌그러짐·도장까지 그대로 보존
import * as THREE from 'three';
import { Joint } from './structures.js';
import { CAT_BY_ID } from './catalog.js';

const r3 = (v) => [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)];
const KEY = (slot) => 'forge.save.' + slot;

export function serialize(mgr) {
  const out = { v: 1, t: Date.now(), structs: [] };
  for (const s of mgr.structs) {
    const parts = [...s.parts], idx = new Map(parts.map((p, i) => [p, i])), joints = [], jidx = new Map();
    for (const p of parts) for (const j of p.joints) if (!jidx.has(j) && idx.has(j.a) && idx.has(j.b)) { jidx.set(j, joints.length); joints.push([idx.get(j.a), idx.get(j.b)]); }
    const t = s.body.translation(), r = s.body.rotation();
    out.structs.push({
      pos: [t.x, t.y, t.z], rot: [r.x, r.y, r.z, r.w], fixed: s.anchored, joints,
      parts: parts.map((p) => ({
        id: p.def.id, d: p.dims, lp: r3(p.lp), lq: p.lq.toArray().map((x) => +x.toFixed(5)), c: p.paint, pin: p.pinned ? 1 : 0, dn: p.dents, dm: p.damage,
        fs: p.fs.map((f) => [f.kind, r3(f.p), r3(f.n), f.joint ? jidx.get(f.joint) ?? -1 : -1, f.stage | 0, f.bent ? 1 : 0, f.kind === 'mortar' ? +(mgr.time - f.t0).toFixed(1) : 0, f.tan ? r3(f.tan) : 0]),
      })),
    });
  }
  return out;
}

export function deserialize(mgr, data) {
  mgr.clearAll();
  for (const sd of data.structs || []) {
    const S = mgr.newStructure(new THREE.Vector3(...sd.pos), new THREE.Quaternion(...sd.rot), sd.fixed);
    const parts = [];
    for (const pd of sd.parts) {
      const def = CAT_BY_ID[pd.id]; if (!def) { parts.push(null); continue; }
      const p = mgr.createPart(def, pd.d, pd.c ?? null);
      p.lp.fromArray(pd.lp); p.lq.fromArray(pd.lq); p.pinned = !!pd.pin; p.damage = pd.dm || 0;
      mgr.attach(p, S, null, null);
      for (const d of pd.dn || []) mgr.dent(p, new THREE.Vector3(d[0], d[1], d[2]), new THREE.Vector3(d[3], d[4], d[5]), d[6], d[7]);
      parts.push(p);
    }
    const joints = sd.joints.map(([a, b]) => {
      const pa = parts[a], pb = parts[b]; if (!pa || !pb) return null;
      const j = new Joint(pa, pb); pa.joints.add(j); pb.joints.add(j); return j;
    });
    sd.parts.forEach((pd, i) => {
      const p = parts[i]; if (!p) return;
      for (const [kind, lp, ln, ji, stage, bent, age, tan] of pd.fs || []) {
        const j = ji >= 0 ? joints[ji] : null;
        const f = mgr.addFastener(j, p, kind, new THREE.Vector3(...lp), new THREE.Vector3(...ln), { stage, bent: !!bent, t0: mgr.time - age, tan: tan ? new THREE.Vector3(...tan) : null });
        if (kind === 'nail') mgr.setNailStage(f);
      }
    });
    for (const j of joints) if (j && j.fs.length === 0) { j.a.joints.delete(j); j.b.joints.delete(j); }
    mgr.dirty.add(S);
  }
  mgr.flushDirty();
  for (const s of mgr.structs) mgr.rebuildRig(s);
}

export const Store = {
  save(slot, data) { try { localStorage.setItem(KEY(slot), JSON.stringify(data)); return true; } catch (e) { return false; } },
  load(slot) { try { const s = localStorage.getItem(KEY(slot)); return s ? JSON.parse(s) : null; } catch (e) { return null; } },
  info(slot) { const d = this.load(slot); if (!d) return null; return { t: d.t, n: d.structs.reduce((a, s) => a + s.parts.length, 0) }; },
};
