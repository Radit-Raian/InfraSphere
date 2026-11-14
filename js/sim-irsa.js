// Simulated stand-in for the IRSA TAP query and cutout service used by the epoch inspector.
//  findExposures  -> a plausible SPHEREx visit history for any position: one pass per ~6 month survey, each pass
//                    seeing the spot once in each of the 17 spectral channels of each detector (paper Secs 3.1, 5; Fig 3).
//  fetchCutout    -> a small rotated detector image (6.15" pixels, own WCS) built from the same sky model as the map,
//                    plus zodiacal light that drifts with the seasons, variable stars, PSF, shot noise and read noise (Secs 6.2, 6.4).
// Images are deterministic: the same exposure of the same spot always gives the same pixels.

import { BANDS, bandIndex, fieldAt, restValue, zlAt, zlShapeOfBeta, eclOf, gatherStars, starLimit, starRatio, variability, splat, mulberry32, hashStr } from "./sim-sky.js";
import { makeWcs } from "./fits.js";

const D2R = Math.PI / 180;
const PIX = 6.15 / 3600;                               // degrees per SPHEREx pixel
const OMEGA = (PIX * D2R) ** 2;                        // sr per pixel
const MJD_S1 = 60796;                                  // 2025-05-01, start of survey 1
const SURVEY_DAYS = 182.625;
const T_EXP = 112.5;                                   // seconds

const nowMjd = () => Date.now() / 86400000 + 40587;
const sunLon = (mjd) => (((280.46 + 0.9856474 * (mjd - 51544.5)) % 360) + 360) % 360;

/** Rows shaped like IRSA's CSV: { uri, mjd, band }. The names follow the real level-2 file pattern. */
export function simulatedRows({ ra, dec, bands }, now = nowMjd()) {
  const ids = (bands && bands.length ? bands : BANDS.map((b) => b.id)).filter((b) => bandIndex(b) >= 0);
  const e = eclOf(ra, dec), cosb = Math.max(Math.cos(e.lat * D2R), 0.05);
  const half = Math.min(90, 7 / cosb);                 // visibility window grows toward the ecliptic poles (days)
  const rows = [];
  for (let s = 1; s <= 4; s++) {
    const t0 = MJD_S1 + (s - 1) * SURVEY_DAYS;
    if (t0 > now) break;
    const lead = ((((e.lon - 90 - sunLon(t0)) % 180) + 180) % 180) / 0.9856474;   // days until the Sun is 90 deg away
    const tc = t0 + lead;
    for (const id of ids) {
      const k = bandIndex(id);
      for (let ch = 0; ch < BANDS[k].ch.length; ch++) {
        const rng = mulberry32(hashStr(`${s}|${id}|${ch}|${ra.toFixed(3)}|${dec.toFixed(3)}`));
        if (rng() < 0.06) continue;                    // not every channel is caught every pass
        const mjd = tc + (rng() - 0.5) * 2 * half;
        if (mjd > now || mjd < t0) continue;
        const d = new Date((mjd - 40587) * 86400000), yr = d.getUTCFullYear();
        const week = Math.min(53, 1 + Math.floor((d - Date.UTC(yr, 0, 1)) / (7 * 86400000)));
        const name = `level2_${yr}W${String(week).padStart(2, "0")}_${s}B_${String(ch).padStart(4, "0")}_0${id}_spx_l2b-v11-${yr}-${100 + ch}.fits`;
        rows.push({ uri: "/sim/" + name, mjd: String(mjd), band: "SPHEREx-" + id });
      }
    }
  }
  return rows;
}

// ---------- the local scene around a position, shared by every exposure of it ----------
const scenes = [];
function getScene(ra, dec, size) {
  const key = `${ra.toFixed(5)},${dec.toFixed(5)},${size.toFixed(4)}`;
  let sc = scenes.find((s) => s.key === key);
  if (sc) return sc;
  const side = size * 1.5;                             // north-up area wide enough to cover a rotated square cutout
  const ns = Math.max(48, Math.min(240, Math.round(side * 3600 / 12)));
  const a0 = ra * D2R, d0 = dec * D2R;
  const c = [Math.cos(d0) * Math.cos(a0), Math.cos(d0) * Math.sin(a0), Math.sin(d0)];
  const e = [-Math.sin(a0), Math.cos(a0), 0], nn = [-Math.sin(d0) * Math.cos(a0), -Math.sin(d0) * Math.sin(a0), Math.cos(d0)];
  const area = (side * 1.1) ** 2;
  const stars = gatherStars(ra, dec, side * 0.75 + 0.05, starLimit(area, OMEGA, 9000), 9000);
  // tangent offsets (degrees) of every star
  const xi = new Float32Array(stars.n), eta = new Float32Array(stars.n), keep = [];
  for (let i = 0; i < stars.n; i++) {
    const a = stars.ra[i] * D2R, d = stars.dec[i] * D2R, v = [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
    const cosc = v[0] * c[0] + v[1] * c[1] + v[2] * c[2];
    if (cosc < 0.5) continue;
    xi[i] = ((v[0] * e[0] + v[1] * e[1] + v[2] * e[2]) / cosc) / D2R;
    eta[i] = ((v[0] * nn[0] + v[1] * nn[1] + v[2] * nn[2]) / cosc) / D2R;
    if (Math.abs(xi[i]) < side * 0.6 && Math.abs(eta[i]) < side * 0.6) keep.push(i);
  }
  const ecl = eclOf(ra, dec);
  sc = { key, ra, dec, side, ns, sc: side / ns, c, e, nn, stars, xi, eta, keep, base: {}, shape: zlShapeOfBeta(ecl.lat * D2R), lon: ecl.lon };
  scenes.unshift(sc); if (scenes.length > 4) scenes.pop();
  return sc;
}
/** Zodiacal-free sky for one detector band over the scene (MJy/sr), computed once per band. */
function baseMap(sc, k) {
  if (sc.base[k]) return sc.base[k];
  const out = new Float32Array(sc.ns * sc.ns);
  const pixRad = sc.sc * D2R, oct = Math.max(2, Math.min(11, Math.floor(Math.log2(0.5 / (pixRad * 12))) + 1));
  for (let j = 0; j < sc.ns; j++) for (let i = 0; i < sc.ns; i++) {
    const xi = -(i + 0.5 - sc.ns / 2) * pixRad, eta = (sc.ns / 2 - (j + 0.5)) * pixRad;
    const x = sc.c[0] + xi * sc.e[0] + eta * sc.nn[0], y = sc.c[1] + xi * sc.e[1] + eta * sc.nn[1], z = sc.c[2] + xi * sc.e[2] + eta * sc.nn[2];
    const n = 1 / Math.hypot(x, y, z);
    fieldAt(x * n, y * n, z * n, oct);
    out[j * sc.ns + i] = restValue(k);
  }
  return (sc.base[k] = out);
}

function gauss(rng) { return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng()); }

const NAME = /level2_(\d{4})W(\d{2})_(\d)B_(\d+)_0(D\d)_spx/;
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A cutout of one simulated exposure: { img: { nx, ny, data, header }, wcs }. */
export async function simulatedCutout(exposure, ra, dec, size, { signal } = {}) {
  if (signal && signal.aborted) { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
  await tick();                                        // keep the page responsive while many are made
  const m = String(exposure.uri).match(NAME);
  if (!m) throw new Error("not a simulated exposure");
  const k = bandIndex(m[5]), ch = Number(m[4]), B = BANDS[k], lam = B.ch[ch];
  const rng = mulberry32(hashStr(exposure.uri + ra.toFixed(4) + dec.toFixed(4)));
  const sc = getScene(ra, dec, size);
  const base = baseMap(sc, k);

  // rotated detector frame, east to the left like a normal image
  const n = Math.max(16, Math.min(520, Math.round(size / PIX)));
  const th = rng() * 2 * Math.PI, ct = Math.cos(th), st = Math.sin(th);
  const cd = [-PIX * ct, PIX * st, PIX * st, PIX * ct], det = cd[0] * cd[3] - cd[1] * cd[2];
  const inv = [cd[3] / det, -cd[1] / det, -cd[2] / det, cd[0] / det];
  const cp = (n + 1) / 2;
  const header = new Map(Object.entries({ NAXIS: 2, NAXIS1: n, NAXIS2: n, CRVAL1: ra, CRVAL2: dec, CRPIX1: cp, CRPIX2: cp, CD1_1: cd[0], CD1_2: cd[1], CD2_1: cd[2], CD2_2: cd[3] }));

  // zodiacal light: spectrum from the paper, latitude shape, a seasonal drift and a little exposure-to-exposure scatter
  const tf = 1 + 0.06 * Math.cos(2 * Math.PI * (exposure.mjd - 61000) / 365.25) * Math.min(1, sc.shape) + 0.02 * (rng() - 0.5);
  const slope = (B.hi - B.lo) / 2040;                  // um per pixel along the spectral axis
  const data = new Float32Array(n * n), s2 = sc.ns;
  for (let iy = 0; iy < n; iy++) {
    const zl = zlAt(lam + slope * (iy - n / 2)) * sc.shape * tf;
    for (let ix = 0; ix < n; ix++) {
      const u = ix + 1 - cp, v = iy + 1 - cp;
      const xi = cd[0] * u + cd[1] * v, eta = cd[2] * u + cd[3] * v;
      const fi = s2 / 2 - xi / sc.sc - 0.5, fj = s2 / 2 - eta / sc.sc - 0.5;
      const i0 = Math.max(0, Math.min(s2 - 2, Math.floor(fi))), j0 = Math.max(0, Math.min(s2 - 2, Math.floor(fj)));
      const tx = Math.min(1, Math.max(0, fi - i0)), ty = Math.min(1, Math.max(0, fj - j0));
      const a = base[j0 * s2 + i0], b = base[j0 * s2 + i0 + 1], c = base[(j0 + 1) * s2 + i0], d = base[(j0 + 1) * s2 + i0 + 1];
      data[iy * n + ix] = zl + (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }

  // stars, with this exposure's wavelength gradient and the date for variable ones
  const stars = sc.stars, psfPx = (B.fwhm / 2.355) / 3600 / PIX, sig = Math.max(psfPx, 0.6);
  for (const i of sc.keep) {
    const u = inv[0] * sc.xi[i] + inv[1] * sc.eta[i], v = inv[2] * sc.xi[i] + inv[3] * sc.eta[i];
    const fx = cp + u - 1, fy = cp + v - 1;
    if (fx < -10 || fy < -10 || fx > n + 10 || fy > n + 10) continue;
    const l = lam + slope * (fy - n / 2);
    const F = stars.f[i] * starRatio(stars.T[i], l) * variability(stars, i, exposure.mjd);
    const amp = F * 1e-6 / (OMEGA * 2 * Math.PI * sig * sig);
    splat(data, n, n, fx, fy, sig, sig, amp, false);
    if (amp > 2) splat(data, n, n, fx, fy, sig * 5, sig * 5, 0.04 * F * 1e-6 / (OMEGA * 2 * Math.PI * 25 * sig * sig), false);
  }

  // noise: shot noise of the ramp slope (x sqrt(6/5)) plus read noise, both in MJy/sr
  const readE = 3.7e-3 * (B.cds / Math.SQRT2), dark = 0.02;
  for (let p = 0; p < data.length; p++) {
    const I = Math.max(data[p], 0), r = I * B.g + dark;
    const sh = Math.sqrt(1.2 * r / T_EXP) / B.g, rd = readE / B.g;
    data[p] += Math.sqrt(sh * sh + rd * rd) * gauss(rng);
  }
  return { img: { nx: n, ny: n, data, header }, wcs: makeWcs(header) };
}
