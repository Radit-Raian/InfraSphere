// Live stars for the simulated sky, drawn as sharp points on the overlay canvas every frame.
//
// Why not paint them into the sky image? An image has a fixed number of pixels, so zooming in only stretches it and the
// stars blur. Here the sky image carries only the smooth diffuse light, and the stars are a catalog: every star has a
// position and a brightness, and the faintest one drawn depends on how far you are zoomed in. Zoom in and the limit
// moves fainter, so more stars appear; the ones already there stay where they are and get a little bigger.
//
// The catalog is the Simulator's star generator (js/sim-sky.js, gatherStars): deterministic, so the same star is in the
// same place whatever the zoom, and the epoch inspector sees the same stars. No DOM at import time, so it can be tested.

import { D2R, R2D, angSepDeg } from "./astro.js";
import { BANDS, bandIndex, gatherStars, starLimit, starRatio } from "./sim-sky.js";

export const STAR_BUDGET = 12000;      // most stars drawn at once (in the Galactic plane; elsewhere there are fewer)
export const STAR_FLOOR = 1e-4;        // faintest star ever generated, Jy at 1.37 um (about 21st magnitude in H)
const GATHER_CAP = 120000;             // most stars held in memory
const TWO_PI = 2 * Math.PI;

/** Faintest star (Jy at 1.37 um) to draw for a view: the zoomed-in, the fainter. fovRad is the vertical field of view. */
export function viewLimit(fovRad, aspect, budget = STAR_BUDGET) {
  const h = fovRad * R2D;
  const area = Math.min(41253, h * h * Math.max(1, aspect) * 0.85);     // deg^2 on screen
  return Math.max(starLimit(area, 0, budget), STAR_FLOOR);
}

/**
 * Returns project(ux, uy, uz, out): a star's unit vector in the equatorial frame (J2000) -> out = [x, y, up, north, east], where x and
 * y are CSS pixels (the same as View.project) and up is the height above the horizon (-1 .. 1). It returns false when
 * the star cannot be shown. Written without trigonometry so that thousands of stars cost little.
 */
export function makeProjector(view, latDeg, lst) {
  const { f, r, u } = view.basis();
  const lat = latDeg * D2R, sl = Math.sin(lat), cl = Math.cos(lat), sL = Math.sin(lst), cL = Math.cos(lst);
  const W = view.W, H = view.H, stereo = view.proj === 0;
  const k = stereo ? (H / 2) / (2 * Math.tan(view.fov / 4)) : (H / 2) / Math.tan(view.fov / 2);
  return (ux, uy, uz, out) => {
    const xH = ux * cL + uy * sL, yH = sL * ux - cL * uy;               // hour-angle frame
    const n = -xH * sl + uz * cl, e = -yH, up = xH * cl + uz * sl;     // (north, east, up)
    const c = n * f[0] + e * f[1] + up * f[2];
    const vx = n * r[0] + e * r[1] + up * r[2], vy = n * u[0] + e * u[1] + up * u[2];
    if (stereo) {
      if (c < -0.99) return false;
      const q = (2 * k) / (1 + c);                                      // 2 tan(theta/2) / sin(theta) = 2 / (1 + cos theta)
      out[0] = W / 2 + vx * q; out[1] = H / 2 - vy * q;
    } else {
      if (c <= 0.05) return false;
      out[0] = W / 2 + (vx / c) * k; out[1] = H / 2 - (vy / c) * k;
    }
    out[2] = up; out[3] = n; out[4] = e;
    return true;
  };
}

// ---------- colour ----------
const N_TEMP = 24, T_LO = 2800, T_HI = 15000, N_ALPHA = 10;
const tempOf = (i) => T_LO * Math.pow(T_HI / T_LO, i / (N_TEMP - 1));
const tempIndex = (T) => Math.max(0, Math.min(N_TEMP - 1, Math.round(Math.log(T / T_LO) / Math.log(T_HI / T_LO) * (N_TEMP - 1))));
const COMPOSITE = [[4, 2.2], [2, 1.1], [0, 1.0]];        // the colour composite: D5 red, D3 green, D1 blue, and their gains

/** Brightness in the shown band, relative to the star's 1.37 um flux, for each temperature bin; and the colour of each. */
function bandTables(id) {
  const ratio = new Float32Array(N_TEMP), rgb = [];
  for (let i = 0; i < N_TEMP; i++) {
    const T = tempOf(i);
    if (id === "color") {
      const ch = COMPOSITE.map(([k, g]) => g * starRatio(T, BANDS[k].c));
      const m = Math.max(...ch);
      ratio[i] = m;
      rgb.push(ch.map((v) => Math.round(255 * (0.4 + 0.6 * v / m))));           // keep the hue, but never fully saturated
    } else {
      ratio[i] = starRatio(T, BANDS[Math.max(0, bandIndex(id))].c);
      rgb.push([255, 250, 244]);
    }
  }
  return { ratio, rgb };
}

export class StarLayer {
  constructor() {
    this.enabled = true;
    this.cache = null;               // the stars held in memory, see _gather
    this.sMin = Infinity;            // faintest star drawn for the current view (Jy at 1.37 um)
    this.drawn = 0;                  // stars drawn last frame
    this.lastGen = -1e9;
    this.band = "color";
    this._out = [0, 0, 0, 0, 0];
    this._buckets = Array.from({ length: N_TEMP * N_ALPHA }, () => []);
    this._glow = [];
    this.setBand("color");
  }

  setBand(id) {
    this.band = id;
    this.tables = bandTables(id);
    this.styles = this.tables.rgb.map(([r, g, b]) => Array.from({ length: N_ALPHA }, (_, a) => `rgba(${r},${g},${b},${(0.35 + 0.65 * a / (N_ALPHA - 1)).toFixed(3)})`));
    if (this.cache) this._shade(this.cache);
  }

  /** Brightness in the shown band for every cached star. */
  _shade(c) {
    c.fb = new Float32Array(c.n);
    for (let i = 0; i < c.n; i++) c.fb[i] = c.f[i] * this.tables.ratio[c.ti[i]];
  }

  _gather(eq, radDeg, full) {
    const sMin = Math.max(STAR_FLOOR, this.sMin * 0.4);           // a little deeper than needed, so zooming on needs no new stars
    const R = full ? 180 : Math.min(180, radDeg * 1.5 + 0.5);
    const st = gatherStars(eq.ra, eq.dec, R, sMin, GATHER_CAP);
    const n = st.n, ux = new Float32Array(n), uy = new Float32Array(n), uz = new Float32Array(n), ti = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const a = st.ra[i] * D2R, d = st.dec[i] * D2R, cd = Math.cos(d);
      ux[i] = cd * Math.cos(a); uy[i] = cd * Math.sin(a); uz[i] = Math.sin(d);
      ti[i] = tempIndex(st.T[i]);
    }
    const c = { ra: eq.ra, dec: eq.dec, rad: R, full, sMin, n, ux, uy, uz, ti, f: st.f };
    this._shade(c);
    this.cache = c;
  }

  /** Call every frame. eq: { ra, dec } in degrees at the centre of the view. */
  update(view, eq, now) {
    if (!this.enabled) return;
    const aspect = view.W / view.H, h = view.fov * R2D;
    this.sMin = viewLimit(view.fov, aspect);
    const rad = 0.5 * h * Math.sqrt(1 + aspect * aspect) * 1.1 + 0.3;
    const full = rad > 70;
    const c = this.cache;
    const covers = c && (c.full || (!full && angSepDeg(c.ra, c.dec, eq.ra, eq.dec) + rad <= c.rad));
    if (covers && c.sMin <= this.sMin * 1.0001) return;
    if (c && now - this.lastGen < 200) return;                    // let a zoom or a drag settle for a moment
    this._gather(eq, rad, full);
    this.lastGen = now;
  }

  /** opts: { hideBelow }. Draws onto a 2D canvas context whose units are CSS pixels. */
  draw(ctx, view, latDeg, lst, opts = {}) {
    this.drawn = 0;
    const c = this.cache;
    if (!this.enabled || !c) return;
    const sMin = this.sMin, project = makeProjector(view, latDeg, lst), out = this._out;
    const B = this._buckets, glow = this._glow, W = view.W, H = view.H, grey = this.band !== "color";
    for (const b of B) b.length = 0;
    glow.length = 0;
    const { fb, ti, ux, uy, uz, n } = c;
    for (let i = 0; i < n; i++) {
      const F = fb[i];
      if (F < sMin) continue;
      if (!project(ux[i], uy[i], uz[i], out)) continue;
      const x = out[0], y = out[1];
      if (x < -8 || x > W + 8 || y < -8 || y > H + 8) continue;
      if (opts.hideBelow && out[2] < (opts.horizon ? opts.horizon(out[3], out[4]) : -0.004)) continue;
      const m = Math.log10(F / sMin);                              // decades above the faintest star shown
      const r = Math.min(6.5, 0.55 + 0.9 * m);
      const a = Math.min(N_ALPHA - 1, Math.floor(2 + m * 9));
      B[(grey ? 0 : ti[i]) * N_ALPHA + a].push(x, y, r);
      if (m > 1.9) glow.push(x, y, r, grey ? 0 : ti[i]);
      this.drawn++;
    }
    for (let a = 0; a < N_ALPHA; a++) for (let t = 0; t < N_TEMP; t++) {
      const arr = B[t * N_ALPHA + a];
      if (!arr.length) continue;
      ctx.fillStyle = this.styles[t][a];
      ctx.beginPath();
      for (let j = 0; j < arr.length; j += 3) {
        const x = arr[j], y = arr[j + 1], r = arr[j + 2];
        if (r < 1.1) ctx.rect(x - r, y - r, 2 * r, 2 * r);       // faint stars: a pixel or two
        else { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TWO_PI); }
      }
      ctx.fill();
    }
    for (let j = 0; j < glow.length; j += 4) {                    // a soft halo round the brightest ones
      const x = glow[j], y = glow[j + 1], r = glow[j + 2], rgb = this.tables.rgb[glow[j + 3]];
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.5);
      g.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.35)`);
      g.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - r * 3.5, y - r * 3.5, r * 7, r * 7);
    }
  }
}