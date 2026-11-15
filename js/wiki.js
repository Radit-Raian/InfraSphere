// Short description of an object from Wikipedia, shown in the info card ("Gamma Cassiopeiae, also named Tiansi, is ...  more on Wikipedia").
// SIMBAD gives names like "* gam Cas"; Wikipedia titles are "Gamma Cassiopeiae", so Bayer and Flamsteed names are spelled out first.
// No DOM, so the name handling can be tested in Node.

const API = "https://en.wikipedia.org/api/rest_v1/page/summary/";

const GREEK = {
  alf: "Alpha", bet: "Beta", gam: "Gamma", del: "Delta", eps: "Epsilon", zet: "Zeta", eta: "Eta", tet: "Theta", iot: "Iota", kap: "Kappa",
  lam: "Lambda", "mu.": "Mu", "nu.": "Nu", ksi: "Xi", omi: "Omicron", "pi.": "Pi", rho: "Rho", sig: "Sigma", tau: "Tau",
  ups: "Upsilon", phi: "Phi", chi: "Chi", psi: "Psi", ome: "Omega"
};

// IAU abbreviation -> genitive form used in star names
const GENITIVE = {
  And: "Andromedae", Ant: "Antliae", Aps: "Apodis", Aqr: "Aquarii", Aql: "Aquilae", Ara: "Arae", Ari: "Arietis", Aur: "Aurigae",
  Boo: "Boötis", Cae: "Caeli", Cam: "Camelopardalis", Cnc: "Cancri", CVn: "Canum Venaticorum", CMa: "Canis Majoris", CMi: "Canis Minoris",
  Cap: "Capricorni", Car: "Carinae", Cas: "Cassiopeiae", Cen: "Centauri", Cep: "Cephei", Cet: "Ceti", Cha: "Chamaeleontis", Cir: "Circini",
  Col: "Columbae", Com: "Comae Berenices", CrA: "Coronae Australis", CrB: "Coronae Borealis", Crv: "Corvi", Crt: "Crateris", Cru: "Crucis",
  Cyg: "Cygni", Del: "Delphini", Dor: "Doradus", Dra: "Draconis", Equ: "Equulei", Eri: "Eridani", For: "Fornacis", Gem: "Geminorum",
  Gru: "Gruis", Her: "Herculis", Hor: "Horologii", Hya: "Hydrae", Hyi: "Hydri", Ind: "Indi", Lac: "Lacertae", Leo: "Leonis", LMi: "Leonis Minoris",
  Lep: "Leporis", Lib: "Librae", Lup: "Lupi", Lyn: "Lyncis", Lyr: "Lyrae", Men: "Mensae", Mic: "Microscopii", Mon: "Monocerotis", Mus: "Muscae",
  Nor: "Normae", Oct: "Octantis", Oph: "Ophiuchi", Ori: "Orionis", Pav: "Pavonis", Peg: "Pegasi", Per: "Persei", Phe: "Phoenicis",
  Pic: "Pictoris", Psc: "Piscium", PsA: "Piscis Austrini", Pup: "Puppis", Pyx: "Pyxidis", Ret: "Reticuli", Sge: "Sagittae", Sgr: "Sagittarii",
  Sco: "Scorpii", Scl: "Sculptoris", Sct: "Scuti", Ser: "Serpentis", Sex: "Sextantis", Tau: "Tauri", Tel: "Telescopii", Tri: "Trianguli",
  TrA: "Trianguli Australis", Tuc: "Tucanae", UMa: "Ursae Majoris", UMi: "Ursae Minoris", Vel: "Velorum", Vir: "Virginis", Vol: "Volantis", Vul: "Vulpeculae"
};

/** Wikipedia article titles to try for a SIMBAD main id (and any familiar names), best guess first. */
export function wikiCandidates(mainId, names = []) {
  const id = String(mainId || "").replace(/\s+/g, " ").trim();
  const out = [];
  const add = (t) => { if (t && !out.includes(t)) out.push(t); };

  let m = id.match(/^(?:\*{1,2}|V\*) (alf|bet|gam|del|eps|zet|eta|tet|iot|kap|lam|mu\.|nu\.|ksi|omi|pi\.|rho|sig|tau|ups|phi|chi|psi|ome)(\d*) ([A-Za-z]{2,3})$/);
  if (m && GENITIVE[m[3]]) add(`${GREEK[m[1]]}${m[2] ? String(Number(m[2])) : ""} ${GENITIVE[m[3]]}`);
  m = id.match(/^(?:\*{1,2}|V\*) (\d{1,3}) ([A-Za-z]{2,3})$/);                       // Flamsteed: "* 61 Cyg"
  if (m && GENITIVE[m[2]]) add(`${m[1]} ${GENITIVE[m[2]]}`);

  for (const n of names) add(n);
  if (/^NAME /.test(id)) add(id.slice(5).trim());

  const plain = id.replace(/^(\*\*|\*|V\*|NAME|Cl\*) /, "");
  m = plain.match(/^M (\d+)$/);
  if (m) add("Messier " + m[1]);
  if (/^(NGC|IC|HD|HR|HIP|PSR|SN|3C|Abell|Sh2|LDN|Cl) ?\S/.test(plain) && !/^V\*/.test(id)) add(plain);
  return out;
}

const ASTRO = /\b(star|stars|galaxy|nebula|cluster|supernova|quasar|pulsar|binary|constellation|variable|remnant|nova|dwarf|giant|supergiant|asteroid|planet|comet|magnitude|astronomical)\b/i;

/** Plain-text blurb: parentheses (pronunciations, abbreviations) dropped, cut at a word near `max` characters. */
export function tidyExtract(text, max = 330) {
  let s = String(text || "").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i++) s = s.replace(/\s*\([^()]*\)/g, "");
  s = s.replace(/\s+([,;.])/g, "$1").replace(/\s{2,}/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40)).replace(/[,;:\s]+$/, "") + "…";
}

/** First candidate that is a real astronomy article: { title, text, url }, or null. */
export async function fetchWikiBlurb(candidates, { signal } = {}) {
  for (const title of candidates) {
    let res;
    try { res = await fetch(API + encodeURIComponent(title.replace(/ /g, "_")) + "?redirect=true", { signal, headers: { Accept: "application/json" } }); }
    catch (e) { if (e && e.name === "AbortError") throw e; continue; }
    if (!res.ok) continue;
    let j;
    try { j = await res.json(); } catch (_) { continue; }
    if (!j || j.type !== "standard" || !j.extract) continue;
    if (!ASTRO.test(j.extract.slice(0, 400)) && !ASTRO.test(j.description || "")) continue;
    const url = (j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page) || "https://en.wikipedia.org/wiki/" + encodeURIComponent(j.title.replace(/ /g, "_"));
    return { title: j.title, text: tidyExtract(j.extract), url };
  }
  return null;
}

/** Titles to try from all of an object's SIMBAD identifiers: Bayer/Flamsteed names first, then common names, then catalogues. */
export function candidatesFromIdents(ids, limit = 8) {
  const rank = (id) => (/^(\*{1,2}|V\*) /.test(id) && !/^(\*{1,2}|V\*) [A-Z]/.test(id) ? 0 : /^NAME /.test(id) ? 1 : /^(M|NGC|IC) /.test(id) ? 2 : 3);
  const out = [];
  for (const id of [...ids].sort((a, b) => rank(a) - rank(b))) for (const t of wikiCandidates(id)) if (!out.includes(t)) out.push(t);
  return out.slice(0, limit);
}