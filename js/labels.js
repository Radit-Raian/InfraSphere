// Draws SIMBAD object labels (and the N/E/S/W marks) on the overlay canvas.
// Brighter objects are placed first, and a label that would overlap an earlier one is skipped.

import { D2R, eqToAltAzVec } from "./astro.js";
import { prettyName } from "./simbad.js";
import { CONFIG } from "./config.js";

export const GROUP_COLORS = {
  star: "#f1e8ea", galaxy: "#ffb86b", cluster: "#9fd6ff", nebula: "#ff8fb1", other: "#c9b8ff"
};
const FONT = "12px 'Segoe UI', system-ui, sans-serif";
const priority = (o) => (o.V === null || o.V === undefined ? 7 : o.V);

export class LabelLayer {
  constructor() {
    this.objs = new Map();   // oid -> object
    this.screen = [];        // what was drawn last frame: { o, x, y }
    this._order = null;
  }

  add(rows) {
    for (const o of rows) {
      if (o.oid === null || o.ra === null || o.dec === null) continue;
      const prev = this.objs.get(o.oid);
      if (prev) {
        if (o.name) prev.name = o.name;
        if (prev.V === null && o.V !== null) prev.V = o.V;
        prev.display = prev.name || prettyName(prev.main_id);
        continue;
      }
      o.display = o.name || prettyName(o.main_id);
      this.objs.set(o.oid, o);
    }
    if (this.objs.size > CONFIG.labels.maxStored) {
      const keep = [...this.objs.values()].sort((a, b) => priority(a) - priority(b)).slice(0, CONFIG.labels.maxStored - 500);
      this.objs = new Map(keep.map((o) => [o.oid, o]));
    }
    this._order = null;
  }

  setNames(map) {
    for (const [oid, name] of map) {
      const o = this.objs.get(oid);
      if (o) { o.name = name; o.display = name; }
    }
  }

  has(oid) { return this.objs.has(oid); }

  _sorted() {
    if (!this._order) this._order = [...this.objs.values()].sort((a, b) => priority(a) - priority(b));
    return this._order;
  }

  /** opts: { groups, showLabels, hideBelow, maxDrawn, selected } */
  draw(ctx, view, latDeg, lst, opts) {
    this.screen.length = 0;
    ctx.font = FONT;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const placed = [];
    let drawn = 0;

    for (const o of this._sorted()) {
      if (!opts.groups[o.group]) continue;
      const v = eqToAltAzVec(o.ra, o.dec, latDeg, lst);
      if (opts.hideBelow && v[2] < -0.004) continue;
      const p = view.project(v);
      if (!p || p[0] < -20 || p[0] > view.W + 20 || p[1] < -20 || p[1] > view.H + 20) continue;
      this.screen.push({ o, x: p[0], y: p[1] });

      const color = GROUP_COLORS[o.group] || GROUP_COLORS.other;
      if (o.group !== "star") {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 6, 0, 2 * Math.PI);
        ctx.stroke();
      }
      if (!opts.showLabels || drawn >= opts.maxDrawn) continue;

      const text = o.display;
      const w = ctx.measureText(text).width;
      const rect = [p[0] + 9, p[1] - 8, p[0] + 11 + w, p[1] + 8];
      let clash = false;
      for (const r of placed) {
        if (rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1]) { clash = true; break; }
      }
      if (clash) continue;
      placed.push(rect);
      drawn++;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(10,7,9,0.85)";
      ctx.strokeText(text, p[0] + 10, p[1]);
      ctx.fillStyle = color;
      ctx.fillText(text, p[0] + 10, p[1]);
    }

    if (opts.selected) {
      const p = view.project(eqToAltAzVec(opts.selected.ra, opts.selected.dec, latDeg, lst));
      if (p) {
        ctx.strokeStyle = "#f2557a";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 12, 0, 2 * Math.PI);
        ctx.moveTo(p[0] - 18, p[1]); ctx.lineTo(p[0] - 12, p[1]);
        ctx.moveTo(p[0] + 12, p[1]); ctx.lineTo(p[0] + 18, p[1]);
        ctx.moveTo(p[0], p[1] - 18); ctx.lineTo(p[0], p[1] - 12);
        ctx.moveTo(p[0], p[1] + 12); ctx.lineTo(p[0], p[1] + 18);
        ctx.stroke();
      }
    }
  }

  /** Nearest drawn object within maxPx of a screen point, or null. */
  pick(x, y, maxPx) {
    let best = null, bestD = maxPx;
    for (const s of this.screen) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= bestD) { best = s.o; bestD = d; }
    }
    return best;
  }
}

/** N, NE, E ... marks along the horizon. */
export function drawDirections(ctx, view) {
  ctx.font = "600 15px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ["N", "NE", "E", "SE", "S", "SW", "W", "NW"].forEach((nm, i) => {
    const a = i * 45 * D2R;
    const p = view.project([Math.cos(a), Math.sin(a), 0]);
    if (!p || p[0] < -40 || p[0] > view.W + 40 || p[1] < -40 || p[1] > view.H + 40) return;
    ctx.fillStyle = nm === "N" ? "#f2557a" : nm.length === 1 ? "#f1e8ea" : "rgba(241,232,234,0.65)";
    ctx.fillText(nm, p[0], p[1] - 16);
    ctx.fillRect(p[0] - 0.5, p[1] - 6, 1, 6);
  });
}
