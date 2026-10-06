// 렌더러 + 후처리 (MSAA · GTAO 앰비언트 오클루전 · 블룸 · ACES 톤매핑)
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

export const QUALITY = {
  low: { name: '낮음', pr: 0.75, shadow: 1024, ao: false, bloom: false, msaa: 0, soft: false },
  medium: { name: '중간', pr: 1, shadow: 2048, ao: false, bloom: true, msaa: 4, soft: true },
  high: { name: '높음', pr: 1.25, shadow: 2048, ao: true, bloom: true, msaa: 4, soft: true },
  ultra: { name: '울트라', pr: 2, shadow: 4096, ao: true, bloom: true, msaa: 4, soft: true },
};

export class Renderer {
  constructor(canvas, qkey) {
    const r = (this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false }));
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 0.92;
    r.shadowMap.enabled = true; this.q = QUALITY[qkey] || QUALITY.high; this.qkey = qkey;
    r.shadowMap.type = this.q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  }
  setup(scene, camera) {
    this.scene = scene; this.camera = camera; this.build(); addEventListener('resize', () => this.resize());
  }
  build() {
    const r = this.r, q = this.q, w = innerWidth, h = innerHeight;
    r.setPixelRatio(Math.min(devicePixelRatio, q.pr)); r.setSize(w, h, false);
    this.composer?.dispose?.();
    const pr = r.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: q.msaa });
    const c = (this.composer = new EffectComposer(r, rt));
    c.addPass(new RenderPass(this.scene, this.camera));
    if (q.ao) {
      const ao = (this.ao = new GTAOPass(this.scene, this.camera, w * pr, h * pr));
      ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 0.6, scale: 1.0, samples: q === QUALITY.ultra ? 16 : 10 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      ao.blendIntensity = 0.85; c.addPass(ao);
    } else this.ao = null;
    if (q.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.55, 1.0); c.addPass(this.bloom); }
    c.addPass(new OutputPass());
    this.resize();
  }
  setQuality(key) {
    this.q = QUALITY[key] || QUALITY.high; this.qkey = key;
    this.r.shadowMap.type = this.q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap; this.r.shadowMap.needsUpdate = true;
    this.build();
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.r.setSize(w, h, false); this.composer.setSize(w, h);
  }
  render() { this.composer.render(); }
}
