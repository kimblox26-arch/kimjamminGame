// SKY BLADE — 산 이름 표지 (실제 산 정상: Overture/OSM peak, 높이 m)
//  - 카메라에서 9 km 안의 정상 중 높은 순 24개만, 화면에서 거의 같은 크기로 보이게 거리 비례 크기
import * as THREE from 'three';
import { origin } from './frame.js';

function tag(name, ele) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const t1 = '▲ ' + name, t2 = ele + ' m';
  g.font = '700 40px system-ui, "Noto Sans KR", sans-serif';
  const w = Math.ceil(Math.max(g.measureText(t1).width, 140)) + 36;
  c.width = w; c.height = 100;
  g.font = '700 40px system-ui, "Noto Sans KR", sans-serif';
  g.fillStyle = 'rgba(15,25,20,0.55)'; g.beginPath(); g.roundRect(0, 0, w, 100, 18); g.fill();
  g.fillStyle = '#fff'; g.textBaseline = 'top'; g.fillText(t1, 18, 10);
  g.font = '600 28px system-ui, sans-serif'; g.fillStyle = '#cfe8d0'; g.fillText(t2, 18, 58);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: true, fog: false }));
  s.userData.aspect = w / 100;
  return s;
}

export class PeakLabels {
  constructor(scene, peaks, heightAt) {
    this.scene = scene;
    this.peaks = peaks.map(([name, x, z, ele]) => ({ name, x, z, ele, y: Math.max(heightAt(x, z), ele - 15), s: null }));
    this.peaks.sort((a, b) => b.ele - a.ele);
    this.t = 0;
  }
  update(dt, camAbs, show) {
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.5;
      let n = 0;
      for (const P of this.peaks) {
        const d = Math.hypot(P.x - camAbs.x, P.z - camAbs.z);
        const on = show && this.enabled !== false && d < 9000 && d > 60 && n < 24 && P.ele > 80;
        if (on) n++;
        if (on && !P.s) { P.s = tag(P.name, P.ele); this.scene.add(P.s); }
        if (!on && P.s) { this.scene.remove(P.s); P.s.material.map.dispose(); P.s.material.dispose(); P.s = null; }
      }
    }
    for (const P of this.peaks) {
      if (!P.s) continue;
      const d = Math.hypot(P.x - camAbs.x, P.y - camAbs.y, P.z - camAbs.z);
      const k = Math.min(60, d * 0.035);
      P.s.scale.set(k * P.s.userData.aspect, k, 1);
      P.s.position.set(P.x - origin.x, P.y + k * 0.8 + 6 - origin.y, P.z - origin.z);
    }
  }
}
