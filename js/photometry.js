// Instant catalogue photometry for the epoch inspector: 2MASS, AllWISE and Gaia DR3 magnitudes of whatever sits at a position,
// from the VizieR TAP service (CDS), converted to flux in Jy and drawn as a spectral energy distribution.
// Three small queries run in parallel, so one catalogue being slow or down does not lose the others.
// The Network part needs a browser; the maths (magToJy, parsePhotRows, sedPoints) does not.

import { CONFIG } from "./config.js";
import { svcFetch } from "./net.js";
import { parseCsv } from "./irsa.js";

// zero point (Jy, Vega system), pivot wavelength (um)
const BANDS = {
  twomass: { table: "II/246/out", ra: "RAJ2000", dec: "DEJ2000", cat: "2MASS",
    f: [["J", "Jmag", "e_Jmag", 1594, 1.235], ["H", "Hmag", "e_Hmag", 1024, 1.662], ["Ks", "Kmag", "e_Kmag", 666.7, 2.159]] },
  allwise: { table: "II/328/allwise", ra: "RAJ2000", dec: "DEJ2000", cat: "AllWISE",
    f: [["W1", "W1mag", "e_W1mag", 309.54, 3.353], ["W2", "W2mag", "e_W2mag", 171.787, 4.603], ["W3", "W3mag", "e_W3mag", 31.674, 11.561], ["W4", "W4mag", "e_W4mag", 8.363, 22.088]] },
  gaia: { table: "I/355/gaiadr3", ra: "RA_ICRS", dec: "DE_ICRS", cat: "Gaia DR3",
    f: [["BP", "BPmag", null, 3552.01, 0.511], ["G", "Gmag", null, 3228.75, 0.622], ["RP", "RPmag", null, 2554.95, 0.777]] }
};
export const CAT_COLORS = { "Gaia DR3": "#6fb7ff", "2MASS": "#ffc857", "AllWISE": "#f2557a" };

export const magToJy = (m, zp) => zp * Math.pow(10, -0.4 * m);

/** Position argument for VizieR links: "58.82850-9.92660". */
export function posParam(ra, dec) {
  const r = ((Number(ra) % 360) + 360) % 360, d = Math.max(-90, Math.min(90, Number(dec)));
  return r.toFixed(5) + (d < 0 ? "-" : "+") + Math.abs(d).toFixed(5);
}

/** ADQL for the nearest source of one catalogue within radius arcsec. */
export function bandQuery(key, ra, dec, radiusArcsec) {
  const B = BANDS[key];
  const cols = B.f.flatMap(([, m, e], i) => [`"${m}" AS m${i}`, e ? `"${e}" AS e${i}` : null]).filter(Boolean).join(", ");
  const pt = `POINT('ICRS', "${B.ra}", "${B.dec}")`, here = `POINT('ICRS', ${Number(ra).toFixed(6)}, ${Number(dec).toFixed(6)})`;
  return `SELECT TOP 1 ${cols}, DISTANCE(${pt}, ${here}) * 3600 AS d FROM "${B.table}" ` +
    `WHERE 1 = CONTAINS(${pt}, CIRCLE('ICRS', ${Number(ra).toFixed(6)}, ${Number(dec).toFixed(6)}, ${(radiusArcsec / 3600).toFixed(6)})) ORDER BY d`;
}

/** CSV rows of one catalogue query -> [{ lam, jy, ejy, filter, cat, sep }] */
export function sedPoints(key, rows) {
  const B = BANDS[key], out = [];
  if (!rows || !rows.length) return out;
  const r = rows[0], sep = Number(r.d);
  B.f.forEach(([name, , , zp, lam], i) => {
    const raw = r["m" + i];
    if (raw === undefined || raw === "" || raw === null) return;
    const m = Number(raw);
    if (!Number.isFinite(m)) return;
    const jy = magToJy(m, zp), e = Number(r["e" + i]);
    out.push({ lam, jy, ejy: Number.isFinite(e) && e > 0 ? jy * 0.4 * Math.LN10 * e : null, filter: name, cat: B.cat, mag: m, sep: Number.isFinite(sep) ? sep : null });
  });
  return out;
}

const TIMEOUT_MS = 15000;

async function runBand(key, ra, dec, radius, signal) {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  if (signal) signal.addEventListener("abort", onAbort);
  try { return await runBandOnce(key, ra, dec, radius, ctl.signal); }
  catch (e) { if (timedOut) throw new Error(BANDS[key].cat + ": no answer from VizieR in " + TIMEOUT_MS / 1000 + " s"); throw e; }
  finally { clearTimeout(timer); if (signal) signal.removeEventListener("abort", onAbort); }
}

async function runBandOnce(key, ra, dec, radius, signal) {
  const params = new URLSearchParams({ REQUEST: "doQuery", LANG: "ADQL", FORMAT: "csv", QUERY: bandQuery(key, ra, dec, radius) });
  const res = await svcFetch("vizier", CONFIG.vizierTap + "?" + params.toString(), { signal });
  const text = await res.text();
  if (!res.ok || /^\s*</.test(text)) throw new Error(BANDS[key].cat + ": VizieR answered " + res.status + " " + text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120));
  return sedPoints(key, parseCsv(text));
}

/** { pts: sorted by wavelength, errors: [messages for catalogues that failed] } */
export async function fetchPhotometry(ra, dec, radius = 5, { signal } = {}) {
  const keys = Object.keys(BANDS);
  const res = await Promise.allSettled(keys.map((k) => runBand(k, ra, dec, radius, signal)));
  if (signal && signal.aborted) { const e = new Error("aborted"); e.name = "AbortError"; throw e; }
  const pts = [], errors = [];
  res.forEach((r) => { if (r.status === "fulfilled") pts.push(...r.value); else errors.push(r.reason && r.reason.message ? r.reason.message : String(r.reason)); });
  return { pts: pts.sort((a, b) => a.lam - b.lam), errors };
}

export const toCsv = (pts) => ["wavelength_um,flux_Jy,flux_err_Jy,filter,catalogue,mag", ...pts.map((p) =>
  [p.lam, p.jy.toExponential(5), p.ejy ? p.ejy.toExponential(5) : "", p.filter, p.cat, p.mag].join(","))].join("\n");

const sci = (v) => (v >= 0.01 && v < 1000 ? String(Number(v.toPrecision(3))) : v.toExponential(2));
export const describe = (p) => `${p.cat} ${p.filter} · ${sci(p.lam)} µm · ${sci(p.jy)} Jy · mag ${p.mag.toFixed(2)}${p.sep !== null ? " · " + p.sep.toFixed(1) + "″ away" : ""}`;

/** Draw the SED on a W x W canvas context. Returns the screen position of each point: [{ x, y, p }]. */
export function drawSed(ctx, W, pts, msg) {
  ctx.textAlign = "center"; ctx.font = "15px system-ui, sans-serif";
  if (!pts.length) { ctx.fillStyle = "#a8939b"; ctx.fillText(msg || "No catalogue photometry here", W / 2, W / 2); ctx.textAlign = "left"; return []; }
  const L = 74, R = 24, T = 64, B = 70, w = W - L - R, h = W - T - B;
  const x0 = Math.log10(0.4), x1 = Math.log10(30);
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { lo = Math.min(lo, p.jy); hi = Math.max(hi, p.jy); }
  const y0 = Math.floor(Math.log10(lo) - 0.3), y1 = Math.ceil(Math.log10(hi) + 0.3);
  const X = (lam) => L + ((Math.log10(lam) - x0) / (x1 - x0)) * w, Y = (jy) => T + h - ((Math.log10(jy) - y0) / (y1 - y0)) * h;

  ctx.fillStyle = "rgba(242,85,122,0.10)"; ctx.fillRect(X(0.75), T, X(5.0) - X(0.75), h);       // SPHEREx coverage
  ctx.fillStyle = "rgba(242,85,122,0.8)"; ctx.font = "12px system-ui, sans-serif"; ctx.fillText("SPHEREx 0.75–5 µm", (X(0.75) + X(5)) / 2, T + 16);
  ctx.strokeStyle = "#3a2630"; ctx.fillStyle = "#a8939b"; ctx.lineWidth = 1;
  for (const t of [0.5, 1, 2, 3, 5, 10, 20]) {
    const x = X(t); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + h); ctx.stroke();
    ctx.fillText(String(t), x, T + h + 18);
  }
  ctx.fillText("wavelength (µm)", L + w / 2, T + h + 40);
  ctx.textAlign = "right";
  const step = Math.max(1, Math.ceil((y1 - y0) / 6));
  for (let k = y0; k <= y1; k += step) { const y = Y(10 ** k); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + w, y); ctx.stroke(); ctx.fillText("1e" + k, L - 6, y + 4); }
  ctx.save(); ctx.translate(16, T + h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText("flux (Jy)", 0, 0); ctx.restore();

  const screen = [];
  ctx.strokeStyle = "rgba(200,190,200,0.35)"; ctx.beginPath();
  pts.forEach((p, i) => { const x = X(p.lam), y = Y(p.jy); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.stroke();
  for (const p of pts) {
    const x = X(p.lam), y = Y(p.jy), col = CAT_COLORS[p.cat] || "#fff";
    if (p.ejy) { ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, Y(p.jy + p.ejy)); ctx.lineTo(x, Y(Math.max(p.jy - p.ejy, p.jy * 0.05))); ctx.stroke(); }
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 7); ctx.fill();
    ctx.fillStyle = "#d9c9ce"; ctx.textAlign = "center"; ctx.font = "11px system-ui, sans-serif"; ctx.fillText(p.filter, x, y - 10);
    screen.push({ x, y, p });
  }
  let lx = L + 8;
  ctx.textAlign = "left"; ctx.font = "12px system-ui, sans-serif";
  for (const [cat, col] of Object.entries(CAT_COLORS)) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(lx, T + h - 14, 5, 0, 7); ctx.fill(); ctx.fillStyle = "#d9c9ce"; ctx.fillText(cat, lx + 10, T + h - 10); lx += 90; }
  return screen;
}