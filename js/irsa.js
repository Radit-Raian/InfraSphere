// IRSA access for the epoch inspector.
//  1) TAP query: every SPHEREx exposure (spectral image) whose footprint covers a position, with its observation time.
//  2) Cutout service: a small piece of one exposure around that position (FITS).
// The query and cutout address formats follow IRSA's own SPHEREx cutout tutorial.

import { CONFIG } from "./config.js";
import { svcFetch } from "./net.js";
import { readFitsImage, makeWcs } from "./fits.js";

/** MJD -> JavaScript Date (UTC). */
export const mjdToDate = (mjd) => new Date((mjd - 40587) * 86400000);
export const fmtDate = (mjd) => mjdToDate(mjd).toISOString().slice(0, 10);
/** "2025-05-14 03:12 UTC" */
export const fmtDateTime = (mjd) => mjdToDate(mjd).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** Tiny CSV reader (handles quoted fields). Returns objects keyed by lower-case column name. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.length > 1 || row[0] !== "") rows.push(row); row = []; }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/** ADQL: all SPHEREx exposures covering the position (optionally only some detectors, e.g. ["D2"]). */
export function exposureQuery({ ra, dec, bands }) {
  const ok = (bands || []).filter((b) => /^D[1-6]$/.test(String(b)));      // only real detector names go into the query
  const band = ok.length ? `AND p.energy_bandpassname IN (${ok.map((b) => `'SPHEREx-${b}'`).join(", ")}) ` : "";
  return `SELECT a.uri AS uri, p.time_bounds_lower AS mjd, p.energy_bandpassname AS band ` +
    `FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid ` +
    `WHERE 1 = CONTAINS(POINT('ICRS', ${Number(ra).toFixed(6)}, ${Number(dec).toFixed(6)}), p.poly) ${band}` +
    `ORDER BY p.time_bounds_lower`;
}

const NAME_RE = /level2_(\d{4})W(\d{2})_(\d)([A-Z])_(\d+)_(\d)(D\d)_spx_l2b-v(\d+)-(\d{4})-(\d+)/;

/** One TAP row -> exposure record, or null if it is not a spectral-image FITS file. */
export function parseExposure(r) {
  const uri = String(r.uri || "");
  const mjd = Number(r.mjd);
  if (!/\.fits$/i.test(uri) || !Number.isFinite(mjd)) return null;
  const m = uri.match(NAME_RE);
  const band = (String(r.band || "").match(/D\d/) || (m ? [m[7]] : [null]))[0];
  const e = { uri, mjd, band, survey: null, week: null, key: uri, version: 0 };
  if (m) {
    e.survey = Number(m[3]);
    e.week = m[1] + "W" + m[2];
    e.obsId = `${m[1]}W${m[2]}_${m[3]}${m[4]}_${m[5]}_${m[6]}`;
    e.key = `${e.obsId}${m[7]}`;
    e.version = Number(m[8]) * 1e7 + Number(m[9]) * 1e3 + Number(m[10]);   // later processing wins
  }
  return e;
}

/** Drop reprocessed duplicates of the same exposure and sort by time. */
export function cleanExposures(list) {
  const best = new Map();
  for (const e of list) { const o = best.get(e.key); if (!o || e.version > o.version) best.set(e.key, e); }
  return [...best.values()].sort((a, b) => a.mjd - b.mjd);
}

/** Group exposures into epochs: by survey pass when the file names give it, otherwise by gaps in time. */
export function groupEpochs(list, gapDays = 45) {
  const items = [...list].sort((a, b) => a.mjd - b.mjd);
  const groups = [];
  if (items.length && items.every((e) => e.survey !== null)) {
    const by = new Map();
    for (const e of items) { if (!by.has(e.survey)) by.set(e.survey, []); by.get(e.survey).push(e); }
    for (const [s, arr] of [...by.entries()].sort((a, b) => a[0] - b[0])) groups.push({ id: "survey" + s, label: "Survey " + s, items: arr });
  } else {
    let cur = null;
    for (const e of items) {
      if (!cur || e.mjd - cur.items[cur.items.length - 1].mjd > gapDays) { cur = { id: "epoch" + (groups.length + 1), label: "Epoch " + (groups.length + 1), items: [] }; groups.push(cur); }
      cur.items.push(e);
    }
  }
  for (const g of groups) { g.mjdMin = g.items[0].mjd; g.mjdMax = g.items[g.items.length - 1].mjd; }
  return groups;
}

export async function findExposures({ ra, dec, bands }, { signal } = {}) {
  const q = exposureQuery({ ra, dec, bands });
  const url = CONFIG.irsaBase + "/TAP/sync?" + new URLSearchParams({ REQUEST: "doQuery", LANG: "ADQL", FORMAT: "csv", QUERY: q }).toString();
  const res = await svcFetch("irsa", url, { signal });
  const text = await res.text();
  if (!res.ok) throw new Error("IRSA answered " + res.status + ": " + text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200));
  if (/^\s*</.test(text)) throw new Error("IRSA returned an error: " + text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200));
  return cleanExposures(parseCsv(text).map(parseExposure).filter(Boolean));
}

/** Address of a cutout of one exposure (size in degrees, centred on ra/dec).
 *  The TAP column may hold a path ("/api/...") or a full https address; either way the result starts with irsaBase
 *  so the same-origin proxy fallback in net.js can slice it correctly. */
export function cutoutPath(uri) {
  let u = String(uri).trim();
  if (/^https?:\/\//i.test(u)) { try { const x = new URL(u); u = x.pathname + x.search; } catch { /* keep as is */ } }
  return u.replace(/^\/+/, "");
}
export const cutoutUrl = (uri, ra, dec, size) => {
  const path = cutoutPath(uri);
  const sep = path.includes("?") ? "&" : "?";
  return `${CONFIG.irsaBase}/${path}${sep}center=${Number(ra).toFixed(6)},${Number(dec).toFixed(6)}d&size=${Number(size).toFixed(4)}`;
};

/** Download one cutout, read only its image, and return { img, wcs }. Retries once. */
export async function fetchCutout(exposure, ra, dec, size, { signal } = {}) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await svcFetch("irsa", cutoutUrl(exposure.uri, ra, dec, size), { signal });
      if (!res.ok) throw new Error("cutout answered " + res.status);
      const img = await readFitsImage(res);
      return { img, wcs: makeWcs(img.header) };
    } catch (e) { if (e.name === "AbortError") throw e; last = e; }
  }
  throw last;
}

/** Nominal wavelength range of a detector, from the app's band list. */
export function bandRange(band) {
  const b = CONFIG.bands.find((x) => x.id === band);
  return b ? b.range : "";
}