// SIMBAD client: every object label and every click lookup goes through here.
// SIMBAD is queried with ADQL over its TAP service (JSON output).
//
// Tables used: basic (one row per object), allfluxes (one column per filter),
// ident (all names of an object).

import { CONFIG } from "./config.js";

// ---------- helpers that need no network ----------

export const adqlEscape = (s) => String(s).replace(/'/g, "''");
const num = (x) => (x === null || x === undefined || x === "" || Number.isNaN(Number(x)) ? null : Number(x));
const fix = (x, n = 6) => Number(x).toFixed(n);

const TYPE_NAMES = {
  "*": "Star", "**": "Double star", "*iC": "Star in a cluster", "*iN": "Star in a nebula", "*iA": "Star in an association",
  "V*": "Variable star", "Pu*": "Pulsating variable", "Mi*": "Mira variable", "Ce*": "Cepheid", "RR*": "RR Lyrae variable",
  "EB*": "Eclipsing binary", "El*": "Ellipsoidal variable", "Er*": "Eruptive variable", "Or*": "Orion variable",
  "TT*": "T Tauri star", "Y*O": "Young stellar object", "Em*": "Emission-line star", "Be*": "Be star",
  "WR*": "Wolf-Rayet star", "WD*": "White dwarf", "Psr": "Pulsar", "N*": "Neutron star", "BH": "Black hole",
  "XB*": "X-ray binary", "RG*": "Red giant", "AB*": "AGB star", "C*": "Carbon star", "S*": "S star",
  "LP*": "Long-period variable", "bC*": "Beta Cephei variable", "sg*": "Evolved supergiant", "s*r": "Red supergiant",
  "s*b": "Blue supergiant", "HB*": "Horizontal branch star", "Ae*": "Herbig Ae/Be star", "Ma*": "Maser star",
  "SN*": "Supernova", "SNR": "Supernova remnant", "PN": "Planetary nebula", "HII": "HII region", "Neb": "Nebula",
  "GNe": "Bright nebula", "RNe": "Reflection nebula", "DNe": "Dark nebula", "MoC": "Molecular cloud", "Cld": "Cloud",
  "ISM": "Interstellar medium", "OpC": "Open cluster", "GlC": "Globular cluster", "Cl*": "Cluster of stars",
  "As*": "Association of stars", "G": "Galaxy", "GiG": "Galaxy in a group", "GiC": "Galaxy in a cluster",
  "GiP": "Galaxy in a pair", "ClG": "Cluster of galaxies", "GrG": "Group of galaxies", "AGN": "Active galactic nucleus",
  "SyG": "Seyfert galaxy", "Sy1": "Seyfert 1 galaxy", "Sy2": "Seyfert 2 galaxy", "QSO": "Quasar", "rG": "Radio galaxy",
  "LIN": "LINER galaxy", "SBG": "Starburst galaxy", "EmG": "Emission-line galaxy", "BiC": "Brightest galaxy in a cluster",
  "IR": "Infrared source", "Rad": "Radio source", "X": "X-ray source", "Mas": "Maser", "Pl": "Planet",
  "mul": "Multiple object", "reg": "Region", "Unc": "Uncertain object"
};
const CLUSTER = new Set(["OpC", "GlC", "Cl*", "As*", "Y*C"]);
const GALAXY = new Set(["G", "GiG", "GiC", "GiP", "ClG", "GrG", "AGN", "SyG", "Sy1", "Sy2", "QSO", "rG", "LIN", "SBG", "EmG", "BiC", "BLL", "Bla", "BClG", "PaG", "IG", "H2G", "LSB"]);
const NEBULA = new Set(["Neb", "GNe", "RNe", "DNe", "HII", "PN", "SNR", "MoC", "Cld", "ISM", "sh", "EmO"]);

export const typeLabel = (otype) => TYPE_NAMES[otype] || otype || "Unknown";

/** "star" | "galaxy" | "cluster" | "nebula" | "other" */
export function typeGroup(otype) {
  const t = String(otype || "");
  if (CLUSTER.has(t)) return "cluster";
  if (GALAXY.has(t)) return "galaxy";
  if (NEBULA.has(t)) return "nebula";
  if (t.includes("*") || t === "Psr" || t === "BH") return "star";
  return "other";
}

const GREEK = {
  alf: "α", bet: "β", gam: "γ", del: "δ", eps: "ε", zet: "ζ", eta: "η", tet: "θ", iot: "ι", kap: "κ",
  lam: "λ", "mu.": "μ", "nu.": "ν", ksi: "ξ", omi: "ο", "pi.": "π", rho: "ρ", sig: "σ", tau: "τ",
  ups: "υ", phi: "φ", chi: "χ", psi: "ψ", ome: "ω"
};

/** "* alf CMa" -> "α CMa", "M  31" -> "M 31", "NAME Pleiades" -> "Pleiades". */
export function prettyName(mainId) {
  let s = String(mainId || "").replace(/\s+/g, " ").trim();
  s = s.replace(/^(\*\*|\*|V\*|NAME|Cl\*) /, "");
  return s.replace(/^(alf|bet|gam|del|eps|zet|eta|tet|iot|kap|lam|mu\.|nu\.|ksi|omi|pi\.|rho|sig|tau|ups|phi|chi|psi|ome)(\d*)(?= |$)/,
    (_, g, d) => GREEK[g] + d);
}

export const simbadUrl = (name) => CONFIG.simbadPage + encodeURIComponent(name);

/** TAP JSON ({metadata, data}) -> array of objects with lower-case keys. */
export function rowsFromTap(json) {
  if (Array.isArray(json)) return json;
  const cols = (json.metadata || []).map((m) => String(m.name).toLowerCase());
  return (json.data || []).map((row) => {
    const o = {};
    cols.forEach((c, i) => { o[c] = row[i]; });
    return o;
  });
}

/** Normalise one SIMBAD row so the rest of the app can trust the types. */
export function normalizeRow(r) {
  const o = {
    oid: num(r.oid), main_id: r.main_id, ra: num(r.ra), dec: num(r.dec),
    otype: r.otype, otype_txt: r.otype_txt, sp_type: r.sp_type || null, morph_type: r.morph_type || null,
    plx: num(r.plx_value), pmra: num(r.pmra), pmdec: num(r.pmdec),
    rv: num(r.rvz_radvel), z: num(r.rvz_redshift), dist: num(r.dist),
    mags: { U: num(r.u), B: num(r.b), V: num(r.v), R: num(r.r), G: num(r.g), J: num(r.j), H: num(r.h), K: num(r.k) }
  };
  o.V = o.mags.V;
  o.group = typeGroup(o.otype);
  o.name = null;
  return o;
}

// ---------- query builders (pure strings, easy to test) ----------

// A cone this wide is the whole sky. SIMBAD can reject a CIRCLE that large, and no filter is needed anyway.
export const isWholeSky = (r) => Number(r) >= 89;
const cone = (ra, dec, r) => `CONTAINS(POINT('ICRS', b.ra, b.dec), CIRCLE('ICRS', ${fix(ra)}, ${fix(dec)}, ${fix(r, 4)})) = 1`;
/** WHERE conditions joined with AND; the cone is left out for a whole-sky request. */
const where = (radius, ra, dec, ...conds) => "WHERE " + [isWholeSky(radius) ? null : cone(ra, dec, radius), ...conds].filter(Boolean).join(" AND ");
const DETAIL_COLS = "b.oid, b.main_id, b.ra, b.dec, b.otype, b.otype_txt, b.sp_type, b.morph_type, b.plx_value, b.pmra, b.pmdec, b.rvz_radvel, b.rvz_redshift, f.U, f.B, f.V, f.R, f.G, f.J, f.H, f.K";

/** Brightest objects (by V magnitude) inside a circle. Inside a cone, objects with no V magnitude are included
 *  too (they come after the measured ones); over the whole sky only measured ones can be ranked. */
export function starsQuery({ ra, dec, radius, magLimit, top }) {
  const whole = isWholeSky(radius);
  const mag = whole ? `f.V < ${fix(magLimit, 2)}` : `(f.V IS NULL OR f.V < ${fix(magLimit, 2)})`;
  return `SELECT TOP ${top} b.oid, b.main_id, b.ra, b.dec, b.otype, f.V ` +
    `FROM basic AS b ${whole ? "JOIN" : "LEFT JOIN"} allfluxes AS f ON b.oid = f.oidref ` +
    `${where(radius, ra, dec, mag)} ORDER BY f.V ASC`;
}

// Over the whole sky, objects are ranked by how often they are cited (nbref), so well-known galaxies and nebulae
// show up even when SIMBAD has no V magnitude for them.
export const WHOLE_SKY_MIN_REFS = 100;

/** Galaxies, clusters and nebulae, with or without a V magnitude. */
export function deepSkyQuery({ ra, dec, radius, magLimit, top }) {
  const types = ["G", "GlC", "OpC", "Cl*", "PN", "HII", "SNR", "GNe", "RNe", "Neb", "AGN", "QSO", "Sy1", "Sy2", "GiG", "GiC", "ClG"]
    .map((t) => `'${adqlEscape(t)}'`).join(", ");
  const whole = isWholeSky(radius);
  const mag = whole ? `b.nbref >= ${WHOLE_SKY_MIN_REFS}` : `(f.V IS NULL OR f.V < ${fix(magLimit + 3, 2)})`;
  return `SELECT TOP ${top} b.oid, b.main_id, b.ra, b.dec, b.otype, f.V ` +
    `FROM basic AS b LEFT JOIN allfluxes AS f ON b.oid = f.oidref ` +
    `${where(radius, ra, dec, `b.otype IN (${types})`, mag)} ` +
    `ORDER BY ${whole ? "b.nbref DESC" : "f.V ASC"}`;
}

/** The single closest object to a point (used when you click empty sky). */
export function nearestQuery({ ra, dec, radius }) {
  return `SELECT TOP 1 ${DETAIL_COLS}, DISTANCE(POINT('ICRS', b.ra, b.dec), POINT('ICRS', ${fix(ra)}, ${fix(dec)})) AS dist ` +
    `FROM basic AS b LEFT JOIN allfluxes AS f ON b.oid = f.oidref ` +
    `${where(radius, ra, dec)} ORDER BY dist ASC`;
}

export function detailsQuery(oid) {
  return `SELECT TOP 1 ${DETAIL_COLS} FROM basic AS b LEFT JOIN allfluxes AS f ON b.oid = f.oidref WHERE b.oid = ${Number(oid)}`;
}

/** Look up an object by any of its names (M31, Sirius, NGC 224, HD 48915 ...). */
export function nameQuery(text) {
  const id = adqlEscape(String(text).trim().replace(/\s+/g, " ").toLowerCase());
  return `SELECT TOP 1 ${DETAIL_COLS} FROM ident AS i JOIN basic AS b ON i.oidref = b.oid ` +
    `LEFT JOIN allfluxes AS f ON b.oid = f.oidref WHERE i.id = '${id}'`;
}

/** Common names ("NAME Sirius") for a list of object ids. */
export function commonNamesQuery(oids) {
  return `SELECT oidref, id FROM ident WHERE oidref IN (${oids.map(Number).filter(Number.isFinite).join(", ")}) AND id LIKE 'NAME %'`;
}

// ---------- network ----------

/** Pull the readable message out of a TAP error (a VOTable with an ERROR info, or plain text). */
export function tapErrorMessage(raw) {
  const text = String(raw || "");
  const m = text.match(/<INFO[^>]*value="ERROR"[^>]*>([\s\S]*?)<\/INFO>/i) || text.match(/<INFO[^>]*name="QUERY_STATUS"[^>]*>([\s\S]*?)<\/INFO>/i);
  const msg = (m ? m[1] : text.replace(/<[^>]*>/g, " ")).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  return msg.slice(0, 300) || "no details";
}

export async function runAdql(query, { signal } = {}) {
  const params = new URLSearchParams({ request: "doQuery", lang: "adql", format: "json", phase: "run", query });
  const useGet = query.length < 1500;
  const res = useGet
    ? await fetch(CONFIG.simbadTap + "?" + params.toString(), { signal })
    : await fetch(CONFIG.simbadTap, {
        method: "POST", signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString()
      });
  const raw = await res.text().catch(() => "");
  if (!res.ok) throw new Error("SIMBAD answered " + res.status + ": " + tapErrorMessage(raw));
  let json;
  try { json = JSON.parse(raw); } catch (_) { throw new Error("SIMBAD returned an error: " + tapErrorMessage(raw)); }
  return rowsFromTap(json);
}

export async function fetchStars(args, opts) { return (await runAdql(starsQuery(args), opts)).map(normalizeRow); }
export async function fetchDeepSky(args, opts) { return (await runAdql(deepSkyQuery(args), opts)).map(normalizeRow); }
export async function fetchNearest(args, opts) { const r = await runAdql(nearestQuery(args), opts); return r.length ? normalizeRow(r[0]) : null; }
export async function fetchDetails(oid, opts) { const r = await runAdql(detailsQuery(oid), opts); return r.length ? normalizeRow(r[0]) : null; }
export async function resolveName(text, opts) { const r = await runAdql(nameQuery(text), opts); return r.length ? normalizeRow(r[0]) : null; }

/** Map of oid -> common name, for the oids that have one. */
export async function fetchCommonNames(oids, opts) {
  const out = new Map();
  if (!oids.length) return out;
  for (const r of await runAdql(commonNamesQuery(oids), opts)) {
    const oid = num(r.oidref);
    if (oid !== null && !out.has(oid)) out.set(oid, String(r.id).replace(/^NAME /, "").trim());
  }
  return out;
}
