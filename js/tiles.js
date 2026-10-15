// The InfraSphere tile grid: the HEALPix tiling that the SPHEREx HiPS maps use, drawn over the sky.
// The grid gets finer as you zoom in (down to tiles about 0.46 degrees across), and clicking picks the
// finest tile under the pointer so its SPHEREx exposures can be inspected.

import { ang2pix, pix2ang, boundary, tileSizeDeg, npixOf } from "./healpix.js";
import { altAzVecToEq } from "./astro.js";

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const INSPECT_ORDER = 7;            // finest tile the SPHEREx maps are built at (about 0.46 degrees)

export class TileGrid {
  constructor() {
    this.outlines = new Map();             // "order/pix" -> [{x,y,z} per outline point, equatorial unit vectors]
    this.visible = [];                     // tiles on screen: { order, pix }
    this._sig = "";
    this.order = 0;
    this.cellPx = 0;
  }

  /** Pick the grid level so a tile is at least about 48 pixels across. */
  orderFor(view) {
    const pxPerDeg = view.H / Math.max(view.fov * R2D, 1e-6);
    const o = Math.floor(Math.log2(Math.max(1e-6, (tileSizeDeg(0) * pxPerDeg) / 48)));
    return Math.max(0, Math.min(INSPECT_ORDER, o));
  }

  /** The finest tile containing a sky position. */
  tileAt(raDeg, decDeg, order = INSPECT_ORDER) {
    const pix = ang2pix(order, raDeg, decDeg);
    const [ra, dec] = pix2ang(order, pix);
    return { order, pix, ra, dec, name: order + "/" + pix };
  }

  _outline(order, pix, step) {
    const key = order + "/" + pix + "/" + step;
    let o = this.outlines.get(key);
    if (!o) {
      o = boundary(order, pix, step).map(([ra, dec]) => {
        const a = ra * D2R, d = dec * D2R, c = Math.cos(d);
        return [c * Math.cos(a), c * Math.sin(a), Math.sin(d)];
      });
      if (this.outlines.size > 20000) this.outlines.clear();
      this.outlines.set(key, o);
    }
    return o;
  }

  _findVisible(view, latDeg, lst, order, cellPx) {
    const sig = [view.az.toFixed(3), view.alt.toFixed(3), view.fov.toFixed(3), view.W, view.H, view.proj, latDeg, lst.toFixed(3), order].join("|");
    if (sig === this._sig) return;
    this._sig = sig;
    const seen = new Set();
    const stepPx = Math.max(16, cellPx / 2.2);
    for (let y = -stepPx; y <= view.H + stepPx; y += stepPx) {
      for (let x = -stepPx; x <= view.W + stepPx; x += stepPx) {
        const eq = altAzVecToEq(view.dirFromPixel(Math.min(Math.max(x, 0), view.W), Math.min(Math.max(y, 0), view.H)), latDeg, lst);
        seen.add(ang2pix(order, eq.ra, eq.dec));
      }
    }
    this.visible = [...seen].map((pix) => ({ order, pix }));
  }

  /** opts: { selected: {order,pix}|null, hideBelow } */
  draw(ctx, view, latDeg, lst, opts = {}) {
    const order = this.orderFor(view);
    const cellPx = (tileSizeDeg(order) * view.H) / Math.max(view.fov * R2D, 1e-6);
    this.order = order; this.cellPx = cellPx;
    this._findVisible(view, latDeg, lst, order, cellPx);

    // equatorial -> (north, east, up) for this moment
    const sl = Math.sin(latDeg * D2R), cl = Math.cos(latDeg * D2R), cs = Math.cos(lst), ss = Math.sin(lst);
    const toLocal = (e) => {
      const xH = cs * e[0] + ss * e[1], yH = ss * e[0] - cs * e[1], zH = e[2];
      return [-xH * sl + zH * cl, -yH, xH * cl + zH * sl];
    };
    const step = cellPx > 160 ? 6 : cellPx > 90 ? 3 : 1;
    const maxEdge = cellPx * 3 + 120;

    const project = (order2, pix, st) => {
      const pts = [];
      for (const e of this._outline(order2, pix, st)) {
        const v = toLocal(e);
        if (opts.hideBelow && v[2] < -0.25) { /* allow tiles that straddle the horizon */ }
        const p = view.project(v);
        if (!p) return null;
        pts.push(p);
      }
      for (let i = 0; i < pts.length; i++) {
        const q = pts[(i + 1) % pts.length];
        if (Math.hypot(pts[i][0] - q[0], pts[i][1] - q[1]) > maxEdge) return null;
      }
      return pts;
    };

    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(242,85,122,0.55)";
    ctx.beginPath();
    const labels = [];
    for (const t of this.visible) {
      const pts = project(t.order, t.pix, step);
      if (!pts) continue;
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      if (cellPx > 90) {
        const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
        if (c[0] > 0 && c[0] < view.W && c[1] > 0 && c[1] < view.H) labels.push([t, c]);
      }
    }
    ctx.stroke();

    if (labels.length && labels.length < 160) {
      ctx.font = "11px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(242,200,210,0.75)";
      for (const [t, c] of labels) ctx.fillText(t.order + "/" + t.pix, c[0], c[1]);
    }

    if (opts.selected) {
      const s = opts.selected;
      const pts = project(s.order, s.pix, 8);
      if (pts) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        ctx.fillStyle = "rgba(242,85,122,0.18)";
        ctx.fill();
        ctx.lineWidth = 2.2; ctx.strokeStyle = "#f2557a";
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
