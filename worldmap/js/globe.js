// 3D 지구본 보기 (three.js)
import * as THREE from 'three';
import { W, H, canvas as mapCanvas, mapXY } from './world.js';
import { drawLabels } from './labels.js';

const D = Math.PI / 180;
const vec = (lon, lat) => new THREE.Vector3(Math.cos(lat * D) * Math.cos(lon * D), Math.sin(lat * D), -Math.cos(lat * D) * Math.sin(lon * D));

export class Globe {
  constructor(cv, overlay) {
    this.cv = cv; this.ov = overlay; this.og = overlay.getContext('2d');
    this.lon = 127; this.lat = 30; this.dist = 3.2; this.vlon = 0; this.vlat = 0;
    this.ready = false; this.texDirty = false; this.lastUp = 0;
  }
  init() {
    if (this.ready) return;
    this.ready = true;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.cv, antialias: true, alpha: false });
    r.setClearColor(0x05070f);
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    const tex = this.tex = new THREE.CanvasTexture(mapCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = r.capabilities.getMaxAnisotropy();
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 96), new THREE.MeshBasicMaterial({ map: tex }));
    this.scene.add(this.earth);
    // 대기 빛
    const atm = new THREE.Mesh(new THREE.SphereGeometry(1.12, 64, 48), new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: 'varying vec3 n; varying vec3 v; void main(){ n=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.); v=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'varying vec3 n; varying vec3 v; void main(){ float d=-dot(n,v); float a=smoothstep(0.0,0.47,d); gl_FragColor=vec4(0.35,0.6,1.0,1.0)*a*a*0.75; }',
    }));
    this.scene.add(atm);
    // 별
    const pts = new Float32Array(3000 * 3);
    for (let i = 0; i < pts.length; i += 3) { const v = new THREE.Vector3().randomDirection().multiplyScalar(40 + Math.random() * 20); pts.set([v.x, v.y, v.z], i); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, sizeAttenuation: true, transparent: true, opacity: 0.75 })));
  }
  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    if (!this.ready) return;
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false);
    this.cam.aspect = w / h; this.cam.updateProjectionMatrix();
  }
  markDirty() { this.texDirty = true; }
  pan(dx, dy) {
    const s = 2 * Math.tan(17.5 * D) * Math.min(this.dist - 1, 1.6) / this.h / D;
    this.lon -= dx * s; this.lat = Math.max(-85, Math.min(85, this.lat + dy * s));
  }
  zoomAt(sx, sy, f) { this.dist = Math.max(1.08, Math.min(7, 1 + (this.dist - 1) / f)); }
  flyTo(mx, my, span) {
    this.lon = mx / W * 360 - 180; this.lat = 90 - my / H * 180;
    if (span) this.dist = Math.max(1.15, Math.min(4, 1 + span / W * 5));
  }
  camPos() { return vec(this.lon, this.lat).multiplyScalar(this.dist); }
  toMap(sx, sy) {
    const ndc = new THREE.Vector2(sx / this.w * 2 - 1, -(sy / this.h) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, this.cam);
    const o = rc.ray.origin, d = rc.ray.direction;
    const b = o.dot(d), c = o.lengthSq() - 1, disc = b * b - c;
    if (disc < 0) return null;
    const p = o.clone().addScaledVector(d, -b - Math.sqrt(disc));
    const lat = Math.asin(Math.max(-1, Math.min(1, p.y))) / D, lon = Math.atan2(-p.z, p.x) / D;
    return mapXY(lon, lat);
  }
  k() { return (this.h / 2) / (Math.tan(17.5 * D) * (this.dist - 1)) * (Math.PI / H); }
  draw() {
    if (!this.ready) return;
    const now = performance.now();
    if (this.texDirty && now - this.lastUp > 90) { this.tex.needsUpdate = true; this.texDirty = false; this.lastUp = now; }
    this.cam.position.copy(this.camPos());
    this.cam.up.set(0, 1, 0); this.cam.lookAt(0, 0, 0);
    this.cam.updateMatrixWorld();
    this.renderer.render(this.scene, this.cam);
    const og = this.og, { w, h, dpr } = this;
    og.setTransform(dpr, 0, 0, dpr, 0, 0); og.clearRect(0, 0, w, h);
    const cp = this.cam.position, cdir = cp.clone().normalize(), lim = 1 / this.dist + 0.12, v = new THREE.Vector3();
    drawLabels(og, {
      w, h, k: this.k() * 0.7,
      proj: (mx, my) => {
        const lon = mx / W * 360 - 180, lat = 90 - my / H * 180;
        const p = vec(lon, lat);
        if (p.dot(cdir) < lim) return null;
        v.copy(p).project(this.cam);
        return [(v.x + 1) / 2 * w, (1 - v.y) / 2 * h];
      },
    });
    return this.texDirty;
  }
}
