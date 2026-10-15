// Sun, Moon, planets and asteroids.
//  - Sun, Moon and planets come from the Astronomy Engine library (js/vendor/astronomy.js, MIT licence).
//  - Asteroids: JPL's Small-Body Database gives each asteroid's orbit; its position on the chosen date is
//    computed from that orbit (two-body Kepler motion, good to roughly an arcminute for main-belt asteroids
//    within a year or so of the orbit's epoch, worse for close approachers).
// All sky positions here are geocentric J2000 RA/Dec in degrees.

import * as A from "./vendor/astronomy.js";
import { CONFIG } from "./config.js";
import { eqToAltAzVec } from "./astro.js";
import { svcFetch } from "./net.js";

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const OBLIQUITY = 23.4392911 * D2R;           // J2000 mean obliquity
const GAUSS_K = 0.01720209895;                // Gaussian gravitational constant (rad/day, AU^1.5)
export const jdFromMs = (ms) => ms / 86400000 + 2440587.5;

// ---------- orbit maths (no DOM, no network) ----------

/** Solve Kepler's equation E - e sin E = M (radians). */
export function solveKepler(M, e) {
  M = ((M + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
  for (let k = 0; k < 40; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

/** Heliocentric position (AU) in the equatorial J2000 frame from osculating elements and a Julian date. */
export function heliocentricEq(el, jd) {
  const a = el.a, e = el.e;
  const n = GAUSS_K / Math.pow(Math.abs(a), 1.5);                 // rad/day
  const M = el.ma * D2R + n * (jd - el.epoch);
  const E = solveKepler(M, e);
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const w = el.w * D2R, om = el.om * D2R, inc = el.i * D2R;
  const cw = Math.cos(w), sw = Math.sin(w), co = Math.cos(om), so = Math.sin(om), ci = Math.cos(inc), si = Math.sin(inc);
  // orbital plane -> ecliptic
  const xe = (co * cw - so * sw * ci) * xp + (-co * sw - so * cw * ci) * yp;
  const ye = (so * cw + co * sw * ci) * xp + (-so * sw + co * cw * ci) * yp;
  const ze = (sw * si) * xp + (cw * si) * yp;
  // ecliptic -> equatorial
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
  return [xe, ye * c - ze * s, ye * s + ze * c];
}

/** Apparent V magnitude from H, G and the Sun-object / Earth-object / Sun-Earth distances (IAU H,G system). */
export function asteroidMag(H, G, r, delta, R) {
  const cosA = Math.max(-1, Math.min(1, (r * r + delta * delta - R * R) / (2 * r * delta)));
  const alpha = Math.acos(cosA);
  const t = Math.tan(alpha / 2);
  const phi1 = Math.exp(-3.33 * Math.pow(t, 0.63)), phi2 = Math.exp(-1.87 * Math.pow(t, 1.22));
  return H + 5 * Math.log10(r * delta) - 2.5 * Math.log10((1 - G) * phi1 + G * phi2);
}

const raDecOf = (v) => {
  const r = Math.hypot(v[0], v[1], v[2]);
  return { ra: ((Math.atan2(v[1], v[0]) * R2D) % 360 + 360) % 360, dec: Math.asin(v[2] / r) * R2D, dist: r };
};

/** Geocentric RA/Dec and distance of an asteroid from its elements, given Earth's heliocentric vector. */
export function asteroidPosition(el, jd, earth) {
  const h = heliocentricEq(el, jd);
  const g = [h[0] - earth[0], h[1] - earth[1], h[2] - earth[2]];
  const p = raDecOf(g);
  const r = Math.hypot(h[0], h[1], h[2]), R = Math.hypot(earth[0], earth[1], earth[2]);
  return { ra: p.ra, dec: p.dec, dist: p.dist, helio: r, mag: asteroidMag(el.H, el.G, r, p.dist, R) };
}

// ---------- planets, Sun and Moon ----------

const BODY_LIST = [
  ["Sun", A.Body.Sun, "#ffd36b"], ["Moon", A.Body.Moon, "#e8e8f0"],
  ["Mercury", A.Body.Mercury, "#c9b8a6"], ["Venus", A.Body.Venus, "#fff1c9"], ["Mars", A.Body.Mars, "#ff8a65"],
  ["Jupiter", A.Body.Jupiter, "#ffd9a8"], ["Saturn", A.Body.Saturn, "#f0d58c"],
  ["Uranus", A.Body.Uranus, "#9fe6e6"], ["Neptune", A.Body.Neptune, "#8fa8ff"]
];

export function majorBodies(ms) {
  const time = A.MakeTime(new Date(ms));
  const out = [];
  for (const [name, body, color] of BODY_LIST) {
    const v = A.GeoVector(body, time, false);
    const p = raDecOf([v.x, v.y, v.z]);
    let mag = null;
    try { mag = A.Illumination(body, time).mag; } catch (_) { /* optional */ }
    out.push({ id: "body:" + name, kind: name === "Sun" ? "sun" : name === "Moon" ? "moon" : "planet", name, color, ra: p.ra, dec: p.dec, dist: p.dist, mag });
  }
  return out;
}

// ---------- asteroids from JPL SBDB ----------

const SBDB_FIELDS = "full_name,pdes,H,G,e,a,i,om,w,ma,epoch";

export function sbdbUrl({ neo = false, limit = 400, hmax = 9.5, sort = true } = {}) {
  const p = [`fields=${SBDB_FIELDS}`, "sb-kind=a", `limit=${limit}`];
  if (neo) p.push("sb-group=neo"); else p.push("sb-cdata=" + encodeURIComponent(JSON.stringify({ AND: [`H|LT|${hmax}`] })));
  if (sort) p.push("sort=H");
  return CONFIG.sbdbApi + "?" + p.join("&");
}

/** SBDB JSON ({fields, data}) -> orbit records. */
export function parseSbdb(json) {
  const f = json.fields || [], idx = {};
  f.forEach((n, i) => { idx[n] = i; });
  const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  const out = [];
  for (const row of json.data || []) {
    const el = { a: num(row[idx.a]), e: num(row[idx.e]), i: num(row[idx.i]), om: num(row[idx.om]), w: num(row[idx.w]),
      ma: num(row[idx.ma]), epoch: num(row[idx.epoch]), H: num(row[idx.H]), G: num(row[idx.G]) };
    if ([el.a, el.e, el.i, el.om, el.w, el.ma, el.epoch, el.H].some((x) => x === null || Number.isNaN(x))) continue;
    if (el.e >= 1 || el.a <= 0) continue;
    if (el.G === null || Number.isNaN(el.G)) el.G = 0.15;
    const full = String(row[idx.full_name] || row[idx.pdes] || "").replace(/\s+/g, " ").trim();
    out.push({ ...el, id: "ast:" + (row[idx.pdes] || full), name: full.replace(/^\((.*)\)$/, "$1"), pdes: String(row[idx.pdes] || "") });
  }
  return out;
}

// ---------- the layer the page uses ----------

export class SolarSystem {
  constructor(ui, fetcher) {
    this.ui = ui;
    this.fetcher = fetcher || ((url) => svcFetch("jpl", url));
    this.bodies = [];            // Sun, Moon, planets
    this.main = [];              // brighter asteroids (orbits)
    this.neo = [];               // near-Earth asteroids (orbits)
    this.asteroids = [];         // current positions of whichever asteroid sets are switched on
    this.lastMs = NaN;
    this.loading = new Set();
    this.screen = [];
  }

  async _load(kind) {
    if (this.loading.has(kind) || (kind === "main" ? this.main.length : this.neo.length)) return;
    this.loading.add(kind);
    const neo = kind === "neo";
    this.ui.setBusy("ast-" + kind, neo ? "Loading near-Earth asteroid orbits from JPL" : "Loading asteroid orbits from JPL");
    try {
      let res = await this.fetcher(sbdbUrl({ neo, limit: neo ? 300 : 400 }));
      if (!res.ok) res = await this.fetcher(sbdbUrl({ neo, limit: neo ? 300 : 400, sort: false }));   // older API without sort
      if (!res.ok) throw new Error("JPL answered " + res.status);
      const list = parseSbdb(await res.json());
      if (neo) this.neo = list; else this.main = list;
      this.lastMs = NaN;
    } catch (e) {
      this.ui.say("Could not load asteroid orbits (" + e.message + ").", 6000);
    } finally {
      this.loading.delete(kind);
      this.ui.setBusy("ast-" + kind, "");
    }
  }

  /** Recompute positions when the simulated time moved enough to matter. */
  update(ms, { asteroids, neo }) {
    if (asteroids) this._load("main");
    if (neo) this._load("neo");
    if (!(Math.abs(ms - this.lastMs) > 20000) && this._sig === `${asteroids}|${neo}|${this.main.length}|${this.neo.length}`) return;
    this._sig = `${asteroids}|${neo}|${this.main.length}|${this.neo.length}`;
    this.lastMs = ms;
    this.bodies = majorBodies(ms);
    const jd = jdFromMs(ms);
    const e = A.HelioVector(A.Body.Earth, A.MakeTime(new Date(ms)));
    const earth = [e.x, e.y, e.z];
    const list = [...(asteroids ? this.main.map((el) => [el, false]) : []), ...(neo ? this.neo.map((el) => [el, true]) : [])];
    this.asteroids = list.map(([el, near]) => ({ ...asteroidPosition(el, jd, earth), id: el.id, kind: "asteroid", name: el.name, H: el.H, near, color: near ? "#ffb07a" : "#c9d6a8" }));
  }

  /** opts: { planets, asteroids, neo, hideBelow, selectedId } */
  draw(ctx, view, latDeg, lst, opts) {
    this.screen.length = 0;
    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    const items = [];
    if (opts.planets) items.push(...this.bodies);
    if (opts.asteroids || opts.neo) items.push(...this.asteroids);
    const placed = [];
    for (const o of items) {
      const v = eqToAltAzVec(o.ra, o.dec, latDeg, lst);
      if (opts.hideBelow && v[2] < -0.004) continue;
      const p = view.project(v);
      if (!p || p[0] < -20 || p[0] > view.W + 20 || p[1] < -20 || p[1] > view.H + 20) continue;
      this.screen.push({ o, x: p[0], y: p[1] });
      const major = o.kind !== "asteroid";
      ctx.fillStyle = o.color; ctx.strokeStyle = o.color;
      ctx.beginPath();
      if (major) {
        const r = o.kind === "sun" ? 9 : o.kind === "moon" ? 8 : 5;
        ctx.arc(p[0], p[1], r, 0, 2 * Math.PI); ctx.fill();
        if (o.kind === "sun") { ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p[0], p[1], 14, 0, 2 * Math.PI); ctx.stroke(); }
      } else {
        const r = 4.5;                                   // asteroids: small diamond
        ctx.lineWidth = 1.4;
        ctx.moveTo(p[0], p[1] - r); ctx.lineTo(p[0] + r, p[1]); ctx.lineTo(p[0], p[1] + r); ctx.lineTo(p[0] - r, p[1]); ctx.closePath();
        ctx.stroke();
      }
      const text = o.name;
      const w = ctx.measureText(text).width;
      const rect = [p[0] + 11, p[1] - 8, p[0] + 13 + w, p[1] + 8];
      if (!major && placed.some((r) => rect[0] < r[2] && rect[2] > r[0] && rect[1] < r[3] && rect[3] > r[1])) continue;
      placed.push(rect);
      ctx.font = major ? "600 13px 'Segoe UI', system-ui, sans-serif" : "12px 'Segoe UI', system-ui, sans-serif";
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(10,7,9,0.85)";
      ctx.strokeText(text, p[0] + 12, p[1]);
      ctx.fillStyle = o.color; ctx.fillText(text, p[0] + 12, p[1]);
    }
  }

  pick(x, y, maxPx) {
    let best = null, bd = maxPx;
    for (const s of this.screen) { const d = Math.hypot(s.x - x, s.y - y); if (d <= bd) { best = s.o; bd = d; } }
    return best;
  }
}
