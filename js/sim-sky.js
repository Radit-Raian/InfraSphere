// Simulated SPHEREx sky. Replaces the CDS hips2fits requests with a procedural model, so nothing is downloaded.
//
// The model follows the components of the SPHEREx Sky Simulator (Crill et al. 2025, ApJS 281, 10):
//   zodiacal light   smooth, steep rise toward 5 um, ~3x brighter at the ecliptic than at the poles (Sec 4.1, Fig 6)
//   diffuse Galactic dust/starlight  disk + bulge, dust lanes that dim short wavelengths, 3.3 um PAH emission (Sec 4.2)
//   compact sources  a deterministic star catalog with Euclidean-like counts, each with a blackbody colour (Sec 4.3)
//   extended sources LMC, SMC, M31, M33, Orion, Carina ... as simple elliptical profiles (Sec 4.4)
//   instrument       the six detectors, their band edges, PSF widths and 17 spectral channels (Table 2, Figs 18-19)
// It is a look-alike for browsing, not a calibrated simulation. Everything is deterministic: same request, same pixels.
// The three diffuse backgrounds (zodiacal light, diffuse Galactic light, extragalactic light) live in
// js/sky-background.js and follow Section 4 of the paper; this file adds them to the stars and extended sources.
// No DOM at import time, so it can be tested in Node.

import { zodiacalSurveyMap, dglBandPerFir, FIR_HIGH_LAT_MJY, eblMean, eblFactor } from "./sky-background.js";

const D2R = Math.PI / 180, R2D = 180 / Math.PI, TWO_PI = 2 * Math.PI;

// ---------- instrument tables (paper Table 2, Figs 18 and 19) ----------
export const BANDS = [
  { id: "D1", lo: 0.73, hi: 1.13, c: 0.93, fwhm: 4.0, g: 8.29, cds: 17.2, ch: [0.753, 0.771, 0.790, 0.809, 0.829, 0.848, 0.869, 0.890, 0.911, 0.933, 0.956, 0.978, 1.002, 1.026, 1.051, 1.077, 1.103] },
  { id: "D2", lo: 1.08, hi: 1.67, c: 1.37, fwhm: 3.8, g: 8.39, cds: 16.5, ch: [1.111, 1.138, 1.166, 1.194, 1.223, 1.253, 1.283, 1.314, 1.345, 1.378, 1.411, 1.445, 1.481, 1.517, 1.554, 1.592, 1.631] },
  { id: "D3", lo: 1.61, hi: 2.45, c: 2.03, fwhm: 3.6, g: 7.90, cds: 17.2, ch: [1.655, 1.694, 1.734, 1.774, 1.817, 1.860, 1.904, 1.949, 1.994, 2.041, 2.089, 2.139, 2.189, 2.240, 2.293, 2.346, 2.398] },
  { id: "D4", lo: 2.38, hi: 3.87, c: 3.10, fwhm: 4.3, g: 9.87, cds: 10.8, ch: [2.444, 2.504, 2.573, 2.644, 2.717, 2.792, 2.870, 2.950, 3.032, 3.117, 3.204, 3.292, 3.384, 3.476, 3.571, 3.669, 3.769] },
  { id: "D5", lo: 3.79, hi: 4.44, c: 4.12, fwhm: 5.2, g: 2.05, cds: 13.9, ch: [3.825, 3.859, 3.893, 3.927, 3.962, 3.997, 4.032, 4.068, 4.104, 4.140, 4.176, 4.213, 4.250, 4.286, 4.324, 4.361, 4.398] },
  { id: "D6", lo: 4.39, hi: 5.02, c: 4.70, fwhm: 5.5, g: 1.68, cds: 11.6, ch: [4.426, 4.459, 4.492, 4.525, 4.558, 4.592, 4.627, 4.661, 4.696, 4.731, 4.766, 4.801, 4.836, 4.871, 4.908, 4.944, 4.981] }
];
export const bandIndex = (id) => BANDS.findIndex((b) => b.id === id);

// Display: the scale of the paper's Fig. 2 (see PAPER_RANGE and magma below). `soft` (MJy/sr) only picks how far the
// scale moves down when the zodiacal light is switched off (see stretchSoft); `headroom` (dex) lifts the top of every
// band's range so that the ecliptic, about 0.5 dex brighter than the pole, is not all saturated in an all-sky view.
export const SIM = { soft: 0.05, headroom: 0.5, starBudget: 150000 };

/** The colour bars of the paper's Fig. 2, log10(MJy/sr), for bands D1 to D6. */
export const PAPER_RANGE = [[-1.0, -0.7], [-1.0, -0.7], [-1.4, -0.8], [-1.4, -1.0], [-1.2, -0.6], [-0.8, -0.3]];

// matplotlib's "magma" colour map (the one Fig. 2 uses), as 48 stops from 0 to 1, interpolated to 256 entries.
const MAGMA_STOPS = ("000004 02020b 050416 0a0822 100b2d 160f3b 1d1147 251255 2d1161 38106c 400f74 491078 52137c 5a167e 641a80 6b1d81 " +
  "752181 7c2382 862781 8e2a81 962c80 a02f7f a8327d b2357b ba3878 c43c75 cc3f71 d5446d dc4869 e34e65 ea5661 ef5d5e " +
  "f4675c f7705c f97b5d fb8560 fc9065 fd9a6a fea36f feae77 feb77e fec287 fecc8f fed799 fde0a1 fdebac fcf4b6 fcfdbf").split(" ")
  .map((h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)));
const MAGMA = (() => {
  const lut = new Uint8ClampedArray(256 * 3), n = MAGMA_STOPS.length - 1;
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * n, j = Math.min(n - 1, Math.floor(x)), f = x - j;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = MAGMA_STOPS[j][c] * (1 - f) + MAGMA_STOPS[j + 1][c] * f;
  }
  return lut;
})();
/** Writes the magma colour for t (0 to 1) into out[o..o+2]. Anything at or below 0 is black. */
export function magma(t, out, o = 0) {
  if (!(t > 0)) { out[o] = out[o + 1] = out[o + 2] = 0; return; }
  const i = (Math.min(1, t) * 255 + 0.5 | 0) * 3;
  out[o] = MAGMA[i]; out[o + 1] = MAGMA[i + 1]; out[o + 2] = MAGMA[i + 2];
}

// Sky components that can be switched on and off. "stars" covers stars, the unresolved starlight of the Milky Way
// and the extended galaxies and nebulae.
export const COMPONENTS = ["zl", "dgl", "ebl", "stars"];
export const ALL_COMPONENTS = { zl: true, dgl: true, ebl: true, stars: true };
/** "zl,dgl" -> { zl: true, dgl: true, ebl: false, stars: false }. Nothing given means everything; "none" means nothing. */
export function parseComps(text) {
  if (text === null || text === undefined || text === "") return { ...ALL_COMPONENTS };
  const set = new Set(String(text).split(","));
  return Object.fromEntries(COMPONENTS.map((c) => [c, set.has(c)]));
}
export const compsToString = (c) => COMPONENTS.filter((k) => c[k]).join(",") || "none";

// ---------- small utilities ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// value noise on the unit sphere (3-D lattice, so there are no seams or pole pinching)
function hash3(ix, iy, iz, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 1274126177) + Math.imul(seed, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10); fy = fy * fy * fy * (fy * (fy * 6 - 15) + 10); fz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = hash3(ix, iy, iz, seed), b = hash3(ix + 1, iy, iz, seed), c = hash3(ix, iy + 1, iz, seed), d = hash3(ix + 1, iy + 1, iz, seed);
  const e = hash3(ix, iy, iz + 1, seed), f = hash3(ix + 1, iy, iz + 1, seed), g = hash3(ix, iy + 1, iz + 1, seed), h = hash3(ix + 1, iy + 1, iz + 1, seed);
  const x1 = a + (b - a) * fx, x2 = c + (d - c) * fx, x3 = e + (f - e) * fx, x4 = g + (h - g) * fx;
  const y1 = x1 + (x2 - x1) * fy, y2 = x3 + (x4 - x3) * fy;
  return y1 + (y2 - y1) * fz;
}
function fbm(x, y, z, oct, seed) {
  let s = 0, a = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    s += a * vnoise(x * f + o * 17.3, y * f + o * 3.1, z * f - o * 11.7, seed + o);
    norm += a; a *= 0.5; f *= 2.02;
  }
  return s / norm;
}

// ---------- coordinate frames ----------
const GAL = [-0.0548755604, -0.8734370902, -0.4838350155, 0.4941094279, -0.4448296300, 0.7469822445, -0.8676661490, -0.1980763734, 0.4559837762];
const CE = Math.cos(23.4392911 * D2R), SE = Math.sin(23.4392911 * D2R);
const unit = (raDeg, decDeg) => { const a = raDeg * D2R, d = decDeg * D2R; return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)]; };
const wrapPi = (a) => { a = (a + Math.PI) % TWO_PI; if (a < 0) a += TWO_PI; return a - Math.PI; };
export function galOf(x, y, z) {
  const gx = GAL[0] * x + GAL[1] * y + GAL[2] * z, gy = GAL[3] * x + GAL[4] * y + GAL[5] * z, gz = GAL[6] * x + GAL[7] * y + GAL[8] * z;
  return { gx, gy, gz, l: Math.atan2(gy, gx), b: Math.asin(Math.max(-1, Math.min(1, gz))) };
}
/** Ecliptic (longitude, latitude) in degrees for an ICRS position in degrees. */
export function eclOf(raDeg, decDeg) {
  const [x, y, z] = unit(raDeg, decDeg);
  const ey = y * CE + z * SE, ez = -y * SE + z * CE;
  return { lon: ((Math.atan2(ey, x) * R2D) % 360 + 360) % 360, lat: Math.asin(Math.max(-1, Math.min(1, ez))) * R2D };
}

// ---------- spectral model ----------
const C = BANDS.map((b) => b.c);
/** Wavelengths at which the zodiacal light is evaluated for the all-sky maps: the six band centres. */
export const BAND_LAMS = C;

const TAU = C.map((l) => 9 * Math.pow(0.55 / l, 1.7));                                    // dust optical depth per unit column
const GLOW = [0.45, 0.5, 0.45, 0.3, 0.19, 0.11];                                              // unresolved starlight (MJy/sr)

// Diffuse Galactic light (paper Sec. 4.2): I_DGL = (far-infrared brightness) x (conversion spectrum). Per band the
// conversion is averaged over the band's 17 spectral channels, so the 3.3 um PAH feature shows up in band 4.
const DGL_PER_FIR = BANDS.map((b) => dglBandPerFir(b.ch));
// Extragalactic background light (paper Sec. 4.4): a faint, clumpy, nearly flat floor.
const EBL_MEAN = C.map((l) => eblMean(l));
// Far-infrared (100 um) brightness template, MJy/sr = FIR_FLOOR + FIR_SCALE x dust column. The floor keeps the
// Galactic poles from being exactly dark; FIR_SCALE then puts the median of the high-latitude sky (|b| > 30 deg) at
// FIR_HIGH_LAT_MJY (about 1 MJy/sr, the value the paper quotes). The Galactic centre comes out near 150 MJy/sr.
export const FIR_FLOOR = 0.3;
export const FIR_SCALE = ((FIR_HIGH_LAT_MJY - FIR_FLOOR) / 1.354e-2);   // 1.354e-2: median dust column at |b| > 30 deg
// Turns the fbm() noise of the EBL into a unit-variance variate (measured: its log-normal width then comes out at 0.25).
const EBL_GAIN = 8.14;
// The paper's DGL has no structure below ~5 arcmin. The dust noise is built from at most 7 octaves; the finest has
// cells of 1 / (12 * 2.02^6) rad = 4.3 arcmin, however far the view is zoomed in.
const MAX_DUST_OCT = 7;

// Extended objects: position, size (deg), position angle, peak MJy/sr in D1..D6.
const GAL_SPEC = [0.7, 0.8, 0.7, 0.5, 0.2, 0.2], NEB_SPEC = [0.3, 0.35, 0.45, 1.2, 1.4, 1.6];
const sc6 = (a, f) => a.map((v) => v * f);
const OBJS = [
  { ra: 80.894, dec: -69.756, sa: 2.8, sb: 2.0, pa: 170, amp: sc6(GAL_SPEC, 1.1) },        // LMC
  { ra: 13.187, dec: -72.829, sa: 1.3, sb: 0.8, pa: 45, amp: sc6(GAL_SPEC, 0.45) },        // SMC
  { ra: 10.685, dec: 41.269, sa: 1.3, sb: 0.35, pa: 38, amp: sc6(GAL_SPEC, 1.0) },         // M31
  { ra: 10.685, dec: 41.269, sa: 0.12, sb: 0.1, pa: 0, amp: sc6(GAL_SPEC, 3.5) },          // M31 core
  { ra: 23.462, dec: 30.660, sa: 0.3, sb: 0.2, pa: 20, amp: sc6(GAL_SPEC, 0.25) },         // M33
  { ra: 83.822, dec: -5.391, sa: 0.25, sb: 0.25, pa: 0, neb: 1, amp: sc6(NEB_SPEC, 3.0) },         // Orion nebula
  { ra: 83.8, dec: -5.0, sa: 2.0, sb: 1.5, pa: 20, neb: 1, amp: sc6(NEB_SPEC, 0.08) },              // Orion cloud
  { ra: 161.27, dec: -59.68, sa: 0.5, sb: 0.4, pa: 0, neb: 1, amp: sc6(NEB_SPEC, 1.2) },           // Carina
  { ra: 98.0, dec: 4.9, sa: 0.5, sb: 0.5, pa: 0, neb: 1, amp: sc6(NEB_SPEC, 0.35) },               // Rosette
  { ra: 56.75, dec: 24.117, sa: 0.6, sb: 0.6, pa: 0, amp: [0.05, 0.04, 0.03, 0.08, 0.05, 0.04] }, // Pleiades
  { ra: 201.365, dec: -43.019, sa: 0.15, sb: 0.1, pa: 120, amp: sc6(GAL_SPEC, 0.3) },      // Centaurus A
  { ra: 314.7, dec: 44.4, sa: 1.2, sb: 0.8, pa: 30, neb: 1, amp: sc6(NEB_SPEC, 0.25) }             // North America nebula
].map((o) => {
  const c = unit(o.ra, o.dec), a = o.ra * D2R, d = o.dec * D2R;
  return { ...o, c, east: [-Math.sin(a), Math.cos(a), 0], north: [-Math.sin(d) * Math.cos(a), -Math.sin(d) * Math.sin(a), Math.cos(d)],
    cosCut: Math.cos(Math.min(60, 7 * Math.max(o.sa, o.sb)) * D2R), sa: o.sa * D2R, sb: o.sb * D2R, cp: Math.cos(o.pa * D2R), sp: Math.sin(o.pa * D2R) };
});

// ---------- the diffuse field at one direction ----------
// dust: Galactic dust column (also drives the extinction and the nebula filaments); fir: far-infrared brightness,
// MJy/sr; ebl: EBL clumpiness multiplier; glow: unresolved starlight; elon / elat: ecliptic coordinates, radians.
export const FIELD = { dust: 0, fir: 0, ebl: 1, glow: 0, elon: 0, elat: 0 };
const EXT = new Float64Array(OBJS.length);

/** Fills FIELD and EXT (extended-object profiles) for a unit vector. */
export function fieldAt(x, y, z, oct) {
  const g = galOf(x, y, z), ab = Math.abs(g.b), lw = g.l;
  const ey = y * CE + z * SE, ez = -y * SE + z * CE;
  FIELD.elon = Math.atan2(ey, x); FIELD.elat = Math.asin(Math.max(-1, Math.min(1, ez)));
  let n = fbm(g.gx * 12, g.gy * 12, g.gz * 12, Math.min(oct, MAX_DUST_OCT), 11);
  n = clamp01(0.5 + (n - 0.5) * 2.2);
  const clump = smooth(0.3, 0.85, n);
  const disk = Math.exp(-ab / 0.0873), thick = Math.exp(-ab / 0.31);
  FIELD.dust = disk * (0.12 + 1.4 * clump) * (1 + 1.2 * Math.exp(-lw * lw / 0.36)) + 0.10 * thick * n * n + 0.09 * n * n * n;
  FIELD.fir = FIR_FLOOR + FIR_SCALE * FIELD.dust;
  FIELD.glow = Math.exp(-ab / 0.07) * (0.5 + 0.7 * Math.exp(-Math.abs(lw) / 0.9)) +
    2.2 * Math.exp(-(lw * lw / 0.08 + g.b * g.b / 0.02)) + 0.12 * Math.exp(-ab / 0.26);
  // EBL clumpiness: a log-normal field with cells from about 1 degree down to a few arcmin
  FIELD.ebl = eblFactor((fbm(x * 60 + 7.7, y * 60 - 3.1, z * 60 + 1.9, Math.min(oct, 5), 23) - 0.5) * EBL_GAIN);
  for (let o = 0; o < OBJS.length; o++) {
    const ob = OBJS[o];
    const dot = x * ob.c[0] + y * ob.c[1] + z * ob.c[2];
    if (dot < ob.cosCut) { EXT[o] = 0; continue; }
    const e = x * ob.east[0] + y * ob.east[1], nn = x * ob.north[0] + y * ob.north[1] + z * ob.north[2];
    const a = (nn * ob.cp + e * ob.sp) / ob.sa, b = (-nn * ob.sp + e * ob.cp) / ob.sb, r2 = a * a + b * b;
    EXT[o] = r2 > 60 ? 0 : (0.65 * Math.exp(-0.5 * r2) + 0.35 * Math.exp(-Math.sqrt(r2) * 1.1)) * (ob.neb ? 0.3 + 1.4 * n * n : 1);   // nebulae get filaments from the dust noise
  }
}
/** Everything except the zodiacal light, in MJy/sr, for band index k, from the last fieldAt call:
 *  diffuse Galactic light + extragalactic light + unresolved starlight and extended sources.
 *  comps picks which of them to include (default: all). */
export function restValue(k, comps = ALL_COMPONENTS) {
  let v = 0;
  if (comps.dgl) v += DGL_PER_FIR[k] * FIELD.fir;
  if (comps.ebl) v += EBL_MEAN[k] * FIELD.ebl;
  if (comps.stars) {
    v += GLOW[k] * FIELD.glow * Math.exp(-0.8 * TAU[k] * FIELD.dust);
    for (let o = 0; o < OBJS.length; o++) if (EXT[o] > 0) v += OBJS[o].amp[k] * EXT[o];
  }
  return v;
}

// ---------- stars ----------
const DENS1 = 79057 / 41253;                 // stars per deg^2 brighter than 1 Jy at 1.37 um (all-sky mean)
const planck = (lam, T) => Math.pow(lam, -3) / (Math.exp(14388 / (lam * T)) - 1);
const REF = 1.37;
export const starRatio = (T, lam) => planck(lam, T) / planck(REF, T);

// Real bright stars at their true positions (flux at 1.37 um in Jy, rough), so labels from SIMBAD land on something.
const ANCHORS = [
  [101.287, -16.716, 3700, 9900], [95.988, -52.696, 2100, 7000], [213.915, 19.182, 13500, 4300], [279.235, 38.784, 1000, 9600],
  [79.172, 45.998, 1950, 5000], [78.634, -8.202, 850, 12000], [114.825, 5.225, 1780, 6500], [88.793, 7.407, 40000, 3500],
  [24.429, -57.237, 650, 15000], [297.696, 8.868, 930, 8000], [68.980, 16.509, 12400, 3900], [247.352, -26.432, 13000, 3600],
  [201.298, -11.161, 370, 22000], [116.329, 28.026, 2800, 4800], [344.413, -29.622, 410, 8500], [310.358, 45.280, 340, 8500],
  [152.093, 11.967, 260, 12000], [37.955, 89.264, 310, 6000], [219.90, -60.834, 4500, 5700], [186.65, -63.099, 1500, 4000]
];

class Stars {
  constructor(cap) {
    this.n = 0; this.cap = cap;
    this.ra = new Float64Array(cap); this.dec = new Float64Array(cap); this.f = new Float32Array(cap); this.T = new Float32Array(cap);
    this.va = new Float32Array(cap); this.vp = new Float32Array(cap); this.vph = new Float32Array(cap);
  }
  push(ra, dec, f, T, va, vp, vph) {
    if (this.n >= this.cap) return false;
    const i = this.n++;
    this.ra[i] = ra; this.dec[i] = dec; this.f[i] = f; this.T[i] = T; this.va[i] = va; this.vp[i] = vp; this.vph[i] = vph;
    return true;
  }
}

function galMult(raDeg, decDeg) {
  const [x, y, z] = unit(raDeg, decDeg), g = galOf(x, y, z);
  return (0.28 + 3.2 * Math.exp(-Math.abs(g.b) / 0.16) * (1 + 1.2 * Math.exp(-g.l * g.l / 0.5))) / 1.2;
}

/** Faintest star (Jy at 1.37 um) worth drawing: limited by the star budget and by what a pixel could show. */
export function starLimit(areaDeg2, pixSr, budget) {
  const a = DENS1 * areaDeg2, q = (budget / 6) / a;          // /6: the Galactic plane holds several times the mean density
  const sBudget = q <= 1 ? Math.pow(q, -1 / 1.5) : Math.pow(q, -1 / 0.9);
  const sPhys = 0.01 * pixSr * 2 * Math.PI * 0.36 * 1e6;                  // Jy giving a 0.01 MJy/sr peak for a 0.6 px sigma
  return Math.max(sBudget, sPhys);
}

function cellStars(st, jd, ira, nra, Smin) {
  const rng = mulberry32((jd + 90) * 7919 + ira * 104729 + 12345);
  const dmid = jd + 0.5, cd = Math.cos(dmid * D2R), dra = 360 / nra;
  const a = DENS1 * dra * cd * galMult((ira + 0.5) * dra, dmid);
  let x = 0;
  for (;;) {
    x += -Math.log(1 - rng());
    const q = x / a, S = q <= 1 ? Math.pow(q, -1 / 1.5) : Math.pow(q, -1 / 0.9);
    if (S < Smin) break;
    const ra = (ira + rng()) * dra, dec = jd + rng(), r = rng(), r2 = rng(), r3 = rng();
    if (S > 300) continue;
    const T = r < 0.55 ? 3200 + r2 * 1300 : r < 0.85 ? 5000 + r2 * 2000 : 8000 + r2 * 6000;
    const mira = T < 4500 && r3 < 0.12;
    if (!st.push(ra, dec, S, T, mira ? 0.3 + rng() * 0.9 : 0, mira ? 150 + rng() * 300 : 0, rng() * TWO_PI)) break;
  }
}

/** All simulated stars brighter than Smin within radDeg of (ra0, dec0). */
export function gatherStars(ra0, dec0, radDeg, Smin, cap) {
  const st = new Stars(cap);
  const dLo = Math.max(-90, Math.floor(dec0 - radDeg)), dHi = Math.min(90, Math.ceil(dec0 + radDeg));
  const cosMax = Math.cos(Math.min(Math.max(Math.abs(dLo), Math.abs(dHi)), 89.9) * D2R);
  const wide = Math.abs(dLo) >= 90 || Math.abs(dHi) >= 90 || radDeg / Math.max(cosMax, 1e-3) >= 180;
  const rra = radDeg / Math.max(cosMax, 1e-3);
  for (let jd = dLo; jd < Math.min(90, dHi); jd++) {
    const cd = Math.cos((jd + 0.5) * D2R), nra = Math.max(1, Math.round(360 * cd)), dra = 360 / nra;
    if (wide || nra <= 2) { for (let i = 0; i < nra; i++) cellStars(st, jd, i, nra, Smin); continue; }
    const i0 = Math.floor((ra0 - rra) / dra), i1 = Math.floor((ra0 + rra) / dra);
    for (let i = i0; i <= Math.min(i1, i0 + nra - 1); i++) cellStars(st, jd, ((i % nra) + nra) % nra, nra, Smin);
  }
  for (const [ra, dec, f, T] of ANCHORS) st.push(ra, dec, f, T, 0, 0, 0);
  return st;
}

/** Brightness factor of a variable star at a given MJD (1 for constant stars). */
export const variability = (st, i, mjd) => (st.va[i] > 0 && mjd ? Math.pow(10, -0.4 * st.va[i] * Math.sin(TWO_PI * mjd / st.vp[i] + st.vph[i])) : 1);

/** Add a Gaussian star to a float image. wrapX makes the image wrap sideways (all-sky maps). */
export function splat(buf, W, H, fx, fy, sx, sy, amp, wrapX) {
  const rx = Math.min(Math.ceil(3 * sx), 60), ry = Math.ceil(3 * sy);
  const ix0 = Math.round(fx), iy0 = Math.round(fy);
  const ix2 = 1 / (2 * sx * sx), iy2 = 1 / (2 * sy * sy);
  for (let dy = -ry; dy <= ry; dy++) {
    const y = iy0 + dy; if (y < 0 || y >= H) continue;
    const ey = (y - fy) * (y - fy) * iy2, row = y * W;
    for (let dx = -rx; dx <= rx; dx++) {
      let x = ix0 + dx;
      if (wrapX) x = ((x % W) + W) % W; else if (x < 0 || x >= W) continue;
      buf[row + x] += amp * Math.exp(-((ix0 + dx - fx) * (ix0 + dx - fx) * ix2 + ey));
    }
  }
}

// ---------- image geometries ----------
/** Whole sky, equirectangular: RA 0 in the middle, increasing to the left, north up (what the shader expects). */
function carGeom(W, H) {
  return {
    W, H, wrapX: true, pixRad: TWO_PI / W,
    dirUV(u, v, o) { const a = (0.5 - u) * TWO_PI, d = (0.5 - v) * Math.PI, cd = Math.cos(d); o[0] = cd * Math.cos(a); o[1] = cd * Math.sin(a); o[2] = Math.sin(d); },
    starPos(raDeg, decDeg) {
      const a = wrapPi(raDeg * D2R), d = decDeg * D2R, cd = Math.cos(d);
      this.fx = (0.5 - a / TWO_PI) * W - 0.5; this.fy = (0.5 - d / Math.PI) * H - 0.5;
      this.sxm = Math.min(1 / Math.max(cd, 1e-6), 10); this.om = (TWO_PI / W) * (Math.PI / H) * Math.max(cd, 1e-6);
      return true;
    },
    areaDeg2: 41253, centre: [0, 0], radDeg: 200
  };
}
/** Flat patch around (ra0, dec0). The tangent-plane width equals the field of view (radians), as the shader assumes. */
function tanGeom(raDeg, decDeg, fovDeg, W, H) {
  const F = fovDeg * D2R, a0 = raDeg * D2R, d0 = decDeg * D2R, c = unit(raDeg, decDeg);
  const e = [-Math.sin(a0), Math.cos(a0), 0], nn = [-Math.sin(d0) * Math.cos(a0), -Math.sin(d0) * Math.sin(a0), Math.cos(d0)];
  const Fy = F * H / W;
  return {
    W, H, wrapX: false, pixRad: F / W,
    dirUV(u, v, o) {
      const xi = (0.5 - u) * F, eta = (0.5 - v) * Fy;
      const x = c[0] + xi * e[0] + eta * nn[0], y = c[1] + xi * e[1] + eta * nn[1], z = c[2] + xi * e[2] + eta * nn[2], n = 1 / Math.hypot(x, y, z);
      o[0] = x * n; o[1] = y * n; o[2] = z * n;
    },
    starPos(raDeg2, decDeg2) {
      const d = unit(raDeg2, decDeg2), cosc = d[0] * c[0] + d[1] * c[1] + d[2] * c[2];
      if (cosc < 0.1) return false;
      const xi = (d[0] * e[0] + d[1] * e[1] + d[2] * e[2]) / cosc, eta = (d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2]) / cosc;
      this.fx = (0.5 - xi / F) * W - 0.5; this.fy = (0.5 - eta / Fy) * H - 0.5; this.sxm = 1; this.om = (F / W) * (F / W);
      return true;
    },
    areaDeg2: (fovDeg * fovDeg * H / W) * 1.0, centre: [raDeg, decDeg], radDeg: Math.min(180, fovDeg * 0.75 * Math.max(1, H / W) + 0.2)
  };
}

// ---------- rendering ----------
/** Brightness scale (MJy/sr) of the brightest component switched on. The colour scale moves down by log10(SIM.soft / this),
 *  so that a faint component shown alone (the EBL is ~100 times fainter than the zodiacal light) is still visible. */
export function stretchSoft(c) { return c.zl ? SIM.soft : c.stars ? 0.02 : c.dgl ? 0.003 : 0.0003; }
const aborted =(signal) => { if (signal && signal.aborted) { const e = new Error("aborted"); e.name = "AbortError"; throw e; } };
const tick = () => new Promise((r) => setTimeout(r, 0));

function upsample(src, sw, sh, dw, dh, wrapX) {
  if (sw === dw && sh === dh) return Float32Array.from(src);
  const out = new Float32Array(dw * dh);
  for (let j = 0; j < dh; j++) {
    const fy = Math.min(sh - 1, Math.max(0, ((j + 0.5) * sh) / dh - 0.5)), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let i = 0; i < dw; i++) {
      const fx = ((i + 0.5) * sw) / dw - 0.5;
      let x0 = Math.floor(fx); const tx = fx - x0; let x1 = x0 + 1;
      if (wrapX) { x0 = ((x0 % sw) + sw) % sw; x1 = ((x1 % sw) + sw) % sw; } else { x0 = Math.max(0, Math.min(sw - 1, x0)); x1 = Math.max(0, Math.min(sw - 1, x1)); }
      const a = src[y0 * sw + x0], b = src[y0 * sw + x1], c = src[y1 * sw + x0], d = src[y1 * sw + x1];
      out[j * dw + i] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}

/**
 * Render one geometry into RGBA bytes, in the colours of the paper's Fig. 2: log10(MJy/sr) on the magma colour map, with
 * the range of that band's colour bar. bandId "D2" is one band; "color" averages all six bands, each on its own range.
 */
async function renderGeom(geom, bandId, { signal, mjd, comps = ALL_COMPONENTS, points = true } = {}) {
  const composite = bandId === "color";
  const ks = composite ? [0, 1, 2, 3, 4, 5] : [Math.max(0, bandIndex(bandId))];
  const { W, H } = geom;
  const dw = Math.min(W, geom.wrapX ? 2048 : 384), dh = Math.max(2, Math.min(H, Math.round(H * dw / W)));
  const pixD = geom.pixRad * W / dw;
  const oct = Math.max(2, Math.min(10, Math.floor(Math.log2(0.5 / (pixD * 12))) + 1));
  const dif = ks.map(() => new Float32Array(dw * dh));
  // Zodiacal light: the survey-geometry map from the Kelsall-model integration (built once, then reused).
  // No abort signal is passed: the map is shared by every render, so one render's cancel must not break the others.
  const zlMap = comps.zl ? await zodiacalSurveyMap(BAND_LAMS, { tick }) : null;
  aborted(signal);
  const v = [0, 0, 0];
  for (let j = 0; j < dh; j++) {
    for (let i = 0; i < dw; i++) {
      geom.dirUV((i + 0.5) / dw, (j + 0.5) / dh, v);
      fieldAt(v[0], v[1], v[2], oct);
      for (let c = 0; c < ks.length; c++) dif[c][j * dw + i] = (zlMap ? zlMap.at(FIELD.elon, FIELD.elat, ks[c]) : 0) + restValue(ks[c], comps);
    }
    if ((j & 15) === 15) { await tick(); aborted(signal); }
  }

  const sMin = starLimit(geom.areaDeg2, geom.pixRad * geom.pixRad, SIM.starBudget);
  // points = false leaves the individual stars out: the page draws those itself, sharp at any zoom (js/star-layer.js).
  // The unresolved starlight and the extended galaxies and nebulae are smooth, so they stay in the image.
  const stars = comps.stars && points ? gatherStars(geom.centre[0], geom.centre[1], geom.radDeg, sMin, SIM.starBudget * 2) : { n: 0 };
  await tick(); aborted(signal);

  const out = new Uint8ClampedArray(W * H * 4);
  for (let p = 3; p < out.length; p += 4) out[p] = 255;
  const shift = Math.log10(SIM.soft / stretchSoft(comps));        // 0 whenever the zodiacal light is on
  const acc = new Float32Array(W * H);                            // sum over the bands of the position on each band's colour bar
  for (let c = 0; c < ks.length; c++) {
    const k = ks[c], lam = BANDS[k].c, buf = upsample(dif[c], dw, dh, W, H, geom.wrapX);
    const psf = (BANDS[k].fwhm / 2.355) / 206265 / geom.pixRad;
    for (let s = 0; s < stars.n; s++) {
      if (!geom.starPos(stars.ra[s], stars.dec[s])) continue;
      const fx = geom.fx, fy = geom.fy;
      if (!geom.wrapX && (fx < -20 || fy < -20 || fx > W + 20 || fy > H + 20)) continue;
      const F = stars.f[s] * starRatio(stars.T[s], lam) * variability(stars, s, mjd);
      const sig = Math.max(psf, 0.75), sx = sig * geom.sxm, sy = sig;
      const amp = F * 1e-6 / (geom.om * TWO_PI * sx * sy);
      splat(buf, W, H, fx, fy, sx, sy, amp, geom.wrapX);
      if (amp > 2) splat(buf, W, H, fx, fy, Math.min(sx * 5, 60), Math.min(sy * 5, 30), 0.04 * F * 1e-6 / (geom.om * TWO_PI * sx * 5 * sy * 5), geom.wrapX);
    }
    const lo = PAPER_RANGE[k][0] - shift, span = PAPER_RANGE[k][1] + SIM.headroom - shift - lo;
    for (let p = 0; p < W * H; p++) {
      const t = (Math.log10(Math.max(buf[p], 1e-12)) - lo) / span;
      acc[p] += t < 0 ? 0 : t > 1 ? 1 : t;
    }
    await tick(); aborted(signal);
  }
  for (let p = 0; p < W * H; p++) magma(acc[p] / ks.length, out, p * 4);
  return { W, H, data: out };
}

/** Same arguments as the hips2fits URL the app used to build; returns { W, H, data (RGBA bytes) }. */
export async function renderFromParams(params, opts = {}) {
  const p = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  const W = parseInt(p.get("width"), 10), H = parseInt(p.get("height"), 10);
  const band = String(p.get("hips") || "color").replace(/\/+$/, "").split("/").pop();
  const proj = (p.get("projection") || "TAN").toUpperCase();
  const geom = proj === "CAR" ? carGeom(W, H) : tanGeom(parseFloat(p.get("ra")), parseFloat(p.get("dec")), parseFloat(p.get("fov")), W, H);
  return renderGeom(geom, band, { comps: parseComps(p.get("comp")), points: p.get("pts") !== "0", ...opts });
}

/** ImageBitmap, ready for renderer.setBase / setPatch. */
export async function renderSimImage(params, signal) {
  const r = await renderFromParams(params, { signal });
  return createImageBitmap(new ImageData(r.data, r.W, r.H));
}
/** data: URL of a small image, for the tile thumbnails. */
export async function renderSimThumb(params) {
  const r = await renderFromParams(params);
  const cv = document.createElement("canvas"); cv.width = r.W; cv.height = r.H;
  cv.getContext("2d").putImageData(new ImageData(r.data, r.W, r.H), 0, 0);
  return cv.toDataURL("image/jpeg", 0.85);
}
