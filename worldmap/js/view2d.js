// 2D 평면 지도 보기 (가로 무한 반복, 확대/이동)
import { W, H, canvas as mapCanvas, M } from './world.js';
import { drawLabels } from './labels.js';

export class View2D {
  constructor(cv, overlay) {
    this.cv = cv; this.ov = overlay;
    this.g = cv.getContext('2d'); this.og = overlay.getContext('2d');
    this.cx = W * 0.53; this.cy = H * 0.36; this.z = 0;
  }
  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    if (!this.z) {
      this.z = h > w ? h / (H * 0.62) : Math.max(this.minZ(), Math.min(w / (W * 0.75), h / (H * 0.62)));
      if (h > w) this.cx = W * 0.68;
    }
    this.clamp();
  }
  minZ() { return Math.max(this.w / W, 0.06); }
  clamp() {
    this.z = Math.min(24, Math.max(this.minZ(), this.z));
    this.cx = ((this.cx % W) + W) % W;
    const half = this.h / 2 / this.z;
    this.cy = H * this.z <= this.h ? H / 2 : Math.min(H - half, Math.max(half, this.cy));
  }
  toMap(sx, sy) { return [this.cx + (sx - this.w / 2) / this.z, this.cy + (sy - this.h / 2) / this.z]; }
  proj = (mx, my) => {
    let dx = mx - this.cx; dx = ((dx + W / 2) % W + W) % W - W / 2;
    return [dx * this.z + this.w / 2, (my - this.cy) * this.z + this.h / 2];
  };
  pan(dx, dy) { this.cx -= dx / this.z; this.cy -= dy / this.z; this.clamp(); }
  zoomAt(sx, sy, f) {
    const [mx, my] = this.toMap(sx, sy);
    this.z *= f; this.clamp();
    this.cx = mx - (sx - this.w / 2) / this.z; this.cy = my - (sy - this.h / 2) / this.z; this.clamp();
  }
  flyTo(mx, my, span) {
    this.cx = mx; this.cy = my;
    if (span) this.z = Math.min(this.w, this.h) * 0.7 / span;
    this.clamp();
  }
  draw() {
    const { g, w, h, z, dpr } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = M.opts.ocean; g.fillRect(0, 0, w, h);
    g.imageSmoothingEnabled = z < 2;
    g.imageSmoothingQuality = 'high';
    const y0 = h / 2 - this.cy * z;
    let x0 = w / 2 - this.cx * z;
    while (x0 > 0) x0 -= W * z;
    for (let x = x0; x < w; x += W * z) {
      g.setTransform(dpr * z, 0, 0, dpr * z, dpr * x, dpr * y0);
      g.drawImage(mapCanvas, 0, 0);
    }
    const og = this.og;
    og.setTransform(dpr, 0, 0, dpr, 0, 0); og.clearRect(0, 0, w, h);
    drawLabels(og, { w, h, k: z, proj: this.proj });
  }
}
