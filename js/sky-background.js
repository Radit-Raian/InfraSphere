// Sky background model after Crill et al. 2025, ApJS 281, 10 ("The SPHEREx Sky Simulator"), Section 4:
//   4.1  zodiacal light (ZL)             modified Kelsall et al. 1998 model, integrated along the line of sight
//   4.2  diffuse Galactic light (DGL)    far-infrared dust brightness times a fixed conversion spectrum nu*b_nu
//   4.4  extragalactic background (EBL)  faint-galaxy / halo light, a nearly flat, slightly clumpy floor
// Pure maths: no DOM, no network, no imports. Brightness is in MJy/sr, wavelengths in um, distances in AU.
//
// What follows the paper exactly, and what had to be approximated, is listed next to each part below.

const D2R = Math.PI / 180, TWO_PI = 2 * Math.PI;

// ---------- radiation ----------
const HC_K = 14387.769;                 // h c / k_B in um K
const BNU1 = 3.9728916e13;              // 2 h c / (1 um)^3 expressed in MJy/sr
/** Planck function B_nu(T) in MJy/sr. */
export const planckMJy = (lam, T) => BNU1 / (lam * lam * lam) / (Math.exp(HC_K / (lam * T)) - 1);

// The paper builds the scattered light from the full ASTM E-490 solar spectrum, normalised to Kelsall at 1.25 um.
// E-490 is not bundled here; a 5772 K blackbody agrees with it to a few per cent between 1 and 5 um, and the
// normalisation to Kelsall at 1.25 um is kept (Kelsall's own albedo and phase function are used as they are).
const T_SUN = 5772, OMEGA_SUN = 6.794e-5;      // K, sr (solar disc seen from 1 AU)
/** Solar flux density at 1 AU, MJy. */
export const solarMJy = (lam) => OMEGA_SUN * planckMJy(lam, T_SUN);

// ---------- 4.1 Zodiacal light: Kelsall et al. 1998 (Table 1) ----------
const aN = (deg) => deg * D2R;
const frame = (incDeg, nodeDeg) => ({ sI: Math.sin(aN(incDeg)), cI: Math.cos(aN(incDeg)), sO: Math.sin(aN(nodeDeg)), cO: Math.cos(aN(nodeDeg)) });

export const KELSALL = {
  cloud: { n0: 1.13e-7, alpha: 1.34, beta: 4.14, gamma: 0.942, mu: 0.189, x0: 0.0119, y0: 0.00548, z0: -0.00215, ...frame(2.03, 77.7) },
  bands: [
    { n: 5.59e-10, dz: aN(8.78), v: 0.10, p: 4, dR: 1.5, ...frame(0.56, 80.0) },
    { n: 1.99e-9, dz: aN(1.99), v: 0.90, p: 4, dR: 0.94, ...frame(1.2, 30.3) },
    { n: 1.44e-10, dz: aN(15.0), v: 0.05, p: 4, dR: 1.5, ...frame(0.8, 80.0) }
  ],
  ring: { n: 1.83e-8, R: 1.03, sr: 0.025, sz: 0.054 },
  blob: { n: 1.9e-8, R: 1.06, sr: 0.10, sz: 0.091, th: aN(-10), sth: aN(12.1) },
  rb: frame(0.49, 22.3),
  T0: 286, delta: 0.467
};

// Albedo, phase function (Phi = N [C0 + C1 Theta + exp(C2 Theta)]) and emissivity factors, at Kelsall's wavelengths.
// Emissivity columns: smooth cloud, dust bands, ring + blob. Kelsall sets the albedo to zero at 4.9 um.
const K_LAM = [1.25, 2.2, 3.5, 4.9];
const K_ALB = [0.204, 0.255, 0.210, 0];
const K_C = [[-0.942, 0.121, -0.165], [-0.527, 0.187, -0.598], [-0.431, 0.172, -0.633], [-0.431, 0.172, -0.633]];
const K_E = [[1, 1, 1], [1, 1, 1], [1.66, 1.66, 1.66], [0.997, 0.359, 1.06]];

const paramCache = new Map();
/** Albedo, phase function and emissivities at any wavelength: linear in ln(lambda) between Kelsall's four
 *  wavelengths, held at the end values outside them. */
export function zlParams(lam) {
  const key = Math.round(lam * 1e4);
  let p = paramCache.get(key);
  if (p) return p;
  let i = 0;
  while (i < K_LAM.length - 2 && lam > K_LAM[i + 1]) i++;
  const t = Math.min(1, Math.max(0, Math.log(lam / K_LAM[i]) / Math.log(K_LAM[i + 1] / K_LAM[i])));
  const mix = (a, b) => a + (b - a) * t;
  const E = [0, 1, 2].map((j) => mix(K_E[i][j], K_E[i + 1][j]));
  const A = Math.max(0, mix(K_ALB[i], K_ALB[i + 1]));
  // The coefficients C0..C2 are a delicate cancellation, so they are not interpolated. Instead the two neighbouring
  // phase functions, each normalised to 1 over 4 pi sr (N), are blended: Phi = (1 - t) Phi_i + t Phi_i+1.
  const norm = (C) => 1 / (TWO_PI * (2 * C[0] + Math.PI * C[1] + (1 + Math.exp(C[2] * Math.PI)) / (1 + C[2] * C[2])));
  const lo = K_C[i], hi = K_C[i + 1];
  p = { lam, A, t, lo, hi, Nlo: norm(lo), Nhi: norm(hi), E, F: solarMJy(lam) };
  paramCache.set(key, p);
  return p;
}
/** Scattering phase function (per sr, integrates to 1 over the sphere) at wavelength parameters p and angle theta. */
export function zlPhase(p, th) {
  const a = p.Nlo * (p.lo[0] + p.lo[1] * th + Math.exp(p.lo[2] * th));
  if (p.t <= 0) return a;
  return (1 - p.t) * a + p.t * p.Nhi * (p.hi[0] + p.hi[1] * th + Math.exp(p.hi[2] * th));
}

/** The three dust densities (AU^-1) at heliocentric ecliptic (X, Y, Z), written to o[0..2]:
 *  smooth cloud, the three dust bands together, solar ring + Earth-trailing blob. thetaRel is the longitude
 *  of the point relative to Earth's. */
function dustDensity(X, Y, Z, thetaRel, o) {
  const K = KELSALL, c = K.cloud;
  const xp = X - c.x0, yp = Y - c.y0, zp = Z - c.z0;
  const Rc = Math.max(Math.sqrt(xp * xp + yp * yp + zp * zp), 1e-3);
  const R = Math.max(Math.sqrt(X * X + Y * Y + Z * Z), 1e-3);
  const zeta = Math.abs((xp * c.sO * c.sI - yp * c.cO * c.sI + zp * c.cI) / Rc);
  const g = zeta < c.mu ? (zeta * zeta) / (2 * c.mu) : zeta - c.mu / 2;
  o[0] = c.n0 * Math.pow(Rc, -c.alpha) * Math.exp(-c.beta * Math.pow(g, c.gamma));

  let nb = 0;
  for (let i = 0; i < 3; i++) {
    const b = K.bands[i];
    const zt = Math.abs((xp * b.sO * b.sI - yp * b.cO * b.sI + zp * b.cI) / Rc) / b.dz;
    const z6 = zt * zt * zt * zt * zt * zt;
    nb += (3 * b.n / R) * Math.exp(-z6) * (b.v + Math.pow(zt, b.p)) * (1 - Math.exp(-Math.pow(R / b.dR, 20)));
  }
  o[1] = nb;

  const rb = K.rb, zr = Math.abs(xp * rb.sO * rb.sI - yp * rb.cO * rb.sI + zp * rb.cI);
  const r = K.ring, bl = K.blob;
  const dRing = R - r.R, dBlob = R - bl.R, dth = thetaRel - bl.th;
  o[2] = r.n * Math.exp(-(dRing * dRing) / (2 * r.sr * r.sr) - zr / r.sz) +
    bl.n * Math.exp(-(dBlob * dBlob) / (2 * bl.sr * bl.sr) - zr / bl.sz - (dth * dth) / (2 * bl.sth * bl.sth));
}

// ---------- Earth ----------
/** Earth's heliocentric ecliptic longitude (radians) and distance (AU) at a Modified Julian Date. */
export function earthState(mjd) {
  const d = mjd - 51544.5;
  const M = (357.528 + 0.9856003 * d) * D2R;
  const sunLon = (280.460 + 0.9856474 * d + 1.915 * Math.sin(M) + 0.020 * Math.sin(2 * M)) * D2R;
  const lon = (((sunLon + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI;
  return { lon, r: 1.00014 - 0.01671 * Math.cos(M) - 0.00014 * Math.cos(2 * M) };
}

// ---------- line-of-sight integration ----------
const S_MAX = 5.2;                            // AU: Kelsall integrates out to 5.2 AU
const wrapPi = (a) => { a = (a + Math.PI) % TWO_PI; if (a < 0) a += TWO_PI; return a - Math.PI; };

/** Reusable buffers for one line of sight (so that big grids do not allocate). */
export class Los {
  constructor(n) {
    this.n = n;
    this.theta = new Float64Array(n);       // scattering angle at each step
    this.invR2 = new Float64Array(n);       // 1 / R^2 (sunlight dilution)
    this.temp = new Float64Array(n);        // dust temperature
    this.w = new Float64Array(3 * n);       // density * step length, per component
    const u = new Float64Array(n), ds = new Float64Array(n), q = 1.6;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      u[i] = S_MAX * Math.pow(t, q);        // steps are shorter close to Earth, where the dust is densest
      ds[i] = (S_MAX * q * Math.pow(t, q - 1)) / n;
    }
    this.u = u; this.ds = ds;
    this.rho = new Float64Array(3);
  }

  /** Fill the buffers for the direction (lon, lat), both in radians in the ecliptic frame, seen from Earth at
   *  heliocentric longitude earthLon and distance earthR. */
  fill(lon, lat, earthLon, earthR) {
    const cb = Math.cos(lat), dx = cb * Math.cos(lon), dy = cb * Math.sin(lon), dz = Math.sin(lat);
    const ex = earthR * Math.cos(earthLon), ey = earthR * Math.sin(earthLon);
    const rho = this.rho, K = KELSALL;
    for (let i = 0; i < this.n; i++) {
      const s = this.u[i];
      const X = ex + s * dx, Y = ey + s * dy, Z = s * dz;
      const R2 = X * X + Y * Y + Z * Z, R = Math.max(Math.sqrt(R2), 1e-3);
      dustDensity(X, Y, Z, wrapPi(Math.atan2(Y, X) - earthLon), rho);
      const ds = this.ds[i];
      this.w[3 * i] = rho[0] * ds; this.w[3 * i + 1] = rho[1] * ds; this.w[3 * i + 2] = rho[2] * ds;
      const cosT = -(X * dx + Y * dy + Z * dz) / R;             // angle between sunlight and the ray to Earth
      this.theta[i] = Math.acos(Math.max(-1, Math.min(1, cosT)));
      this.invR2[i] = 1 / Math.max(R2, 1e-6);
      this.temp[i] = K.T0 * Math.pow(R, -K.delta);
    }
    return this;
  }

  /** Zodiacal light (MJy/sr) at one wavelength:
   *  sum over dust of  n ds [ A F / R^2 * Phi(Theta)  +  (1 - A) E B_nu(T) ]   (Kelsall 1998, Eq. 1). */
  at(lam) {
    const p = zlParams(lam), w = this.w;
    let scat = 0, therm = 0;
    for (let i = 0; i < this.n; i++) {
      const wsum = w[3 * i] + w[3 * i + 1] + w[3 * i + 2];
      if (p.A > 0) scat += this.invR2[i] * zlPhase(p, this.theta[i]) * wsum;
      const x = HC_K / (lam * this.temp[i]);
      if (x < 60) {
        therm += (p.E[0] * w[3 * i] + p.E[1] * w[3 * i + 1] + p.E[2] * w[3 * i + 2]) / (Math.exp(x) - 1);
      }
    }
    // the Planck factor was left out of the loop; every step shares the same BNU1 / lam^3
    return p.A * p.F * scat + (1 - p.A) * (BNU1 / (lam * lam * lam)) * therm;
  }
}

/** Zodiacal light for one position on the sky and one date, at several wavelengths.
 *  eclLonDeg / eclLatDeg: ecliptic coordinates of the direction. mjd: date of the exposure. */
export function zodiacalLight(lams, eclLonDeg, eclLatDeg, mjd, steps = 240) {
  const e = earthState(mjd);
  const los = new Los(steps).fill(eclLonDeg * D2R, eclLatDeg * D2R, e.lon, e.r);
  return lams.map((l) => los.at(l));
}

// ---------- survey-geometry zodiacal sky (the all-sky map) ----------
// SPHEREx looks about 90 degrees away from the Sun. For every direction we therefore take the two dates on which
// the Sun is 90 degrees to either side, and average them. The result is a fixed, smooth all-sky picture of what
// the survey sees, on a grid that is finer near the ecliptic where the dust bands are narrow.
const GRID_LON = 144;                                    // 2.5 degrees
const BETA_NODES = (() => {
  const a = [];
  for (let b = -90; b <= 90; b += (Math.abs(b) < 30 ? (Math.abs(b) < 10 ? 1 : 2) : 3)) a.push(b);
  if (a[a.length - 1] !== 90) a.push(90);
  return a;
})();
const BETA_LOOKUP = (() => {                              // 0.5 degree steps -> lower node index
  const t = new Int16Array(361);
  for (let i = 0, j = 0; i <= 360; i++) { const b = -90 + i / 2; while (j < BETA_NODES.length - 2 && b >= BETA_NODES[j + 1]) j++; t[i] = j; }
  return t;
})();

const surveyCache = new Map();

/** Build (once per set of wavelengths) the survey-geometry zodiacal map.
 *  Resolves to { at(eclLonRad, eclLatRad, k) } with k the index into lams. */
export function zodiacalSurveyMap(lams, { signal, tick } = {}) {
  const key = lams.join(",");
  if (surveyCache.has(key)) return surveyCache.get(key);
  const nb = BETA_NODES.length, K = lams.length;
  const grid = new Float32Array(nb * GRID_LON * K);
  const los = new Los(96), P = Math.PI / 2;
  const promise = (async () => {
    for (let j = 0; j < nb; j++) {
      const lat = BETA_NODES[j] * D2R;
      for (let i = 0; i < GRID_LON; i++) {
        const lon = (i / GRID_LON) * TWO_PI;
        for (let k = 0; k < K; k++) grid[(j * GRID_LON + i) * K + k] = 0;
        for (const side of [-1, 1]) {                 // Sun 90 degrees behind, and 90 degrees ahead
          const earthLon = lon + side * P;
          los.fill(lon, lat, earthLon, 1);
          for (let k = 0; k < K; k++) grid[(j * GRID_LON + i) * K + k] += 0.5 * los.at(lams[k]);
        }
      }
      if (tick) {
        await tick();
        if (signal && signal.aborted) { surveyCache.delete(key); const e = new Error("aborted"); e.name = "AbortError"; throw e; }
      }
    }
    return {
      lams,
      at(lon, lat, k) {
        let u = (lon / TWO_PI) * GRID_LON; u -= Math.floor(u / GRID_LON) * GRID_LON;
        const i0 = Math.floor(u), tx = u - i0, i1 = (i0 + 1) % GRID_LON;
        const bd = Math.max(-90, Math.min(90, lat / D2R));
        const j0 = BETA_LOOKUP[Math.min(359, Math.max(0, Math.floor((bd + 90) * 2)))], j1 = Math.min(nb - 1, j0 + 1);
        const ty = Math.min(1, Math.max(0, (bd - BETA_NODES[j0]) / (BETA_NODES[j1] - BETA_NODES[j0] || 1)));
        const a = grid[(j0 * GRID_LON + i0) * K + k], b = grid[(j0 * GRID_LON + i1) * K + k];
        const c = grid[(j1 * GRID_LON + i0) * K + k], d = grid[(j1 * GRID_LON + i1) * K + k];
        return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
      }
    };
  })();
  surveyCache.set(key, promise);
  promise.catch(() => surveyCache.delete(key));
  return promise;
}

// ---------- 4.2 Diffuse Galactic light ----------
// Paper: DGL = (far-infrared dust brightness) x (nu*b_nu), with nu*b_nu the best-fitting conversion spectrum of
// Sano et al. 2016 (the red curve of the paper's Fig. 6). It is "fixed": the same spectrum everywhere on the sky,
// brightest at optical wavelengths, with a broad polycyclic aromatic hydrocarbon (PAH) feature at 3.3 um.
// Table below: nu*b_nu in nW m^-2 sr^-1 per MJy sr^-1 of far-infrared brightness, read off the red curve of Fig. 6
// (the paper prints the curve, not a table), so it is good to roughly 10 per cent.
export const NU_B_NU = [
  [0.75, 12.5], [0.80, 11.5], [0.90, 9.8], [1.00, 8.5], [1.10, 7.4], [1.25, 6.0], [1.50, 4.4], [1.75, 3.5],
  [2.00, 3.0], [2.25, 2.65], [2.50, 2.45], [2.75, 2.35], [3.00, 2.3], [3.15, 3.2], [3.25, 6.6], [3.30, 8.3],
  [3.38, 6.2], [3.45, 4.0], [3.55, 3.2], [3.80, 2.8], [4.20, 2.4], [4.60, 2.1], [5.00, 1.9]
];
/** nu*b_nu at a wavelength (um), nW m^-2 sr^-1 per MJy sr^-1. */
export function nuBnu(lam) {
  const t = NU_B_NU;
  if (lam <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (lam <= t[i][0]) return t[i - 1][1] + ((lam - t[i - 1][0]) / (t[i][0] - t[i - 1][0])) * (t[i][1] - t[i - 1][1]);
  return t[t.length - 1][1];
}
/** DGL surface brightness (MJy/sr) produced by 1 MJy/sr of far-infrared emission, at one wavelength.
 *  I_nu = (nu b_nu) * I_FIR / nu, and nu = c / lambda gives the factor lambda / 2997.9. */
export const dglPerFir = (lam) => (nuBnu(lam) * lam) / 2997.92458;
/** The same, averaged over a list of wavelengths (a band's spectral channels, so the 3.3 um feature is seen). */
export const dglBandPerFir = (lams) => lams.reduce((s, l) => s + dglPerFir(l), 0) / lams.length;

// The paper takes the far-infrared brightness from Planck dust maps (Symons et al. 2023, Sec. 4.3.1). Those maps are
// not shipped with this app, so js/sim-sky.js draws a Galactic dust template instead, scaled so that high latitudes
// sit near 1 MJy/sr, which is the value the paper quotes for them.
export const FIR_HIGH_LAT_MJY = 1.0;
/** The paper's DGL has no structure smaller than about 5 arcmin. */
export const DGL_MIN_SCALE_ARCMIN = 5;

// ---------- 4.4 Extragalactic background light ----------
// Paper: the EBL comes from the halo model of Mirocha et al. (in preparation), as 1-3 arcsec maps at each of the 102
// spectral channels (its Fig. 7). That model is not public. Fig. 7 draws all four example wavelengths
// (0.74, 1.62, 3.81 and 5.01 um) on the same colour range, log10(I_nu) = -3.2 ... -2.4 MJy/sr, so the level used here
// is the middle of that range at every wavelength, with a log-normal clumpiness about as wide as the figure shows.
export const EBL_MEAN_MJY = 1.8e-3;
export const EBL_SIGMA_LN = 0.25;
/** Mean EBL surface brightness (MJy/sr) at a wavelength. */
export const eblMean = () => EBL_MEAN_MJY;
/** Log-normal multiplier with mean 1 from a unit-variance Gaussian variate g. */
export const eblFactor = (g) => Math.exp(EBL_SIGMA_LN * g - 0.5 * EBL_SIGMA_LN * EBL_SIGMA_LN);
