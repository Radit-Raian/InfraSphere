import { D2R } from "./astro.js";

/** The camera: where you look (azimuth/altitude), how wide (fov), and how it is projected. */
export class View {
  constructor() {
    this.az = 180 * D2R;
    this.alt = 35 * D2R;
    this.fov = 100 * D2R;   // vertical field of view
    this.proj = 0;          // 0 = stereographic, 1 = perspective
    this.W = 1;
    this.H = 1;
  }

  resize(W, H) { this.W = W; this.H = H; }
  get maxFov() { return (this.proj === 1 ? 120 : 150) * D2R; }
  get minFov() { return 0.5 * D2R; }

  clamp() {
    this.alt = Math.max(-90 * D2R, Math.min(90 * D2R, this.alt));
    this.fov = Math.max(this.minFov, Math.min(this.maxFov, this.fov));
  }

  basis() {
    const ca = Math.cos(this.az), sa = Math.sin(this.az);
    const ch = Math.cos(this.alt), sh = Math.sin(this.alt);
    return { f: [ch * ca, ch * sa, sh], r: [-sa, ca, 0], u: [-sh * ca, -sh * sa, ch] };
  }

  lookAtVec(v) {
    this.az = Math.atan2(v[1], v[0]);
    this.alt = Math.asin(Math.max(-1, Math.min(1, v[2])));
  }

  /** Screen pixel (CSS px) -> unit direction (north, east, up). */
  dirFromPixel(px, py) {
    const { f, r, u } = this.basis();
    const qx = (px - this.W / 2) / (this.H / 2), qy = (this.H / 2 - py) / (this.H / 2);
    const rq = Math.hypot(qx, qy);
    const v = [r[0] * qx + u[0] * qy, r[1] * qx + u[1] * qy, r[2] * qx + u[2] * qy];
    if (this.proj === 0) {
      const th = 2 * Math.atan((rq * 2 * Math.tan(this.fov / 4)) / 2);
      const s = rq > 1e-9 ? Math.sin(th) / rq : 0, c = Math.cos(th);
      return [f[0] * c + v[0] * s, f[1] * c + v[1] * s, f[2] * c + v[2] * s];
    }
    const t = Math.tan(this.fov / 2);
    const d = [f[0] + v[0] * t, f[1] + v[1] * t, f[2] + v[2] * t];
    const n = Math.hypot(d[0], d[1], d[2]);
    return [d[0] / n, d[1] / n, d[2] / n];
  }

  /** Unit direction -> screen pixel [x, y], or null if it cannot be shown. */
  project(d) {
    const { f, r, u } = this.basis();
    const c = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    const vx = d[0] * r[0] + d[1] * r[1] + d[2] * r[2];
    const vy = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    const halfH = this.H / 2;
    if (this.proj === 0) {
      const th = Math.acos(Math.max(-1, Math.min(1, c)));
      if (th > Math.PI * 0.97) return null;
      const rr = 2 * Math.tan(th / 2), k = halfH / (2 * Math.tan(this.fov / 4));
      const s = Math.hypot(vx, vy);
      if (s < 1e-9) return [this.W / 2, this.H / 2];
      return [this.W / 2 + (vx / s) * rr * k, this.H / 2 - (vy / s) * rr * k];
    }
    if (c <= 0.05) return null;
    const k = halfH / Math.tan(this.fov / 2);
    return [this.W / 2 + (vx / c) * k, this.H / 2 - (vy / c) * k];
  }

  /** Angle in radians between the sky directions under two screen pixels. */
  angleBetweenPixels(ax, ay, bx, by) {
    const a = this.dirFromPixel(ax, ay), b = this.dirFromPixel(bx, by);
    return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  }
}
