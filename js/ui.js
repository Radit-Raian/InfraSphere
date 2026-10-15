// Small helpers for the page: status messages, band buttons, the object info card.

import { CONFIG } from "./config.js";
import { hms, dms } from "./astro.js";
import { prettyName, typeLabel, simbadUrl } from "./simbad.js";

export const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- status line ----------
const busy = new Map();
let transient = "";
let transientTimer = 0;
function renderStatus() {
  const text = [...busy.values(), transient].filter(Boolean).join(" · ");
  const el = $("status");
  el.textContent = text;
  el.style.display = text ? "block" : "none";
}
/** Show a long-running activity under a key; pass "" to clear it. */
export function setBusy(key, text) { if (text) busy.set(key, text); else busy.delete(key); renderStatus(); }
/** Show a message; with `ms` it disappears by itself. */
export function say(msg, ms) {
  transient = msg;
  clearTimeout(transientTimer);
  if (msg && ms) transientTimer = setTimeout(() => { transient = ""; renderStatus(); }, ms);
  renderStatus();
}
export const ui = { setBusy, say };

// ---------- band buttons ----------
export function buildBandButtons(onSelect) {
  const wrap = $("bands");
  CONFIG.bands.forEach((b, i) => {
    const btn = document.createElement("button");
    btn.className = "band" + (i === 0 ? " active" : "");
    btn.dataset.id = b.id;
    btn.innerHTML = `<span>${esc(b.name)}</span><small>${esc(b.range)}</small>`;
    btn.addEventListener("click", () => onSelect(b.id));
    wrap.appendChild(btn);
  });
}
export function setActiveBand(id) {
  document.querySelectorAll(".band").forEach((el) => el.classList.toggle("active", el.dataset.id === id));
}

// ---------- time input ----------
const pad = (n) => String(n).padStart(2, "0");
export function setTimeInput(ms) {
  const d = new Date(ms);
  $("time").value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- object info card ----------
let inspectHandler = null;
/** The page registers what "Inspect SPHEREx epochs" does: fn(raDeg, decDeg, title). */
export function setInspectHandler(fn) { inspectHandler = fn; }
const AU_KM = 149597870.7;
export function hideInfo() { $("info").classList.add("hidden"); }

export function showInfoLoading(title) {
  const el = $("info");
  el.classList.remove("hidden");
  el.innerHTML = `<div class="info-head"><h3>${esc(title)}</h3><button class="btn close" aria-label="Close">×</button></div><p class="note">Asking SIMBAD...</p>`;
  el.querySelector(".close").addEventListener("click", hideInfo);
}

export function showInfoMessage(title, message) {
  const el = $("info");
  el.classList.remove("hidden");
  el.innerHTML = `<div class="info-head"><h3>${esc(title)}</h3><button class="btn close" aria-label="Close">×</button></div><p class="note">${esc(message)}</p>`;
  el.querySelector(".close").addEventListener("click", hideInfo);
}

function row(label, value) { return value ? `<tr><th>${esc(label)}</th><td>${value}</td></tr>` : ""; }

/** o is a normalised SIMBAD row (see simbad.normalizeRow). */
export function showInfo(o, commonName) {
  const el = $("info");
  el.classList.remove("hidden");
  const title = commonName || prettyName(o.main_id);

  const mags = Object.entries(o.mags).filter(([, v]) => v !== null).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(" · ");
  let distance = "";
  if (o.plx && o.plx > 0) {
    const pc = 1000 / o.plx;
    distance = `${(pc * 3.2616).toFixed(pc < 100 ? 1 : 0)} light-years (${pc.toFixed(pc < 100 ? 1 : 0)} pc)`;
  }
  const pm = o.pmra !== null && o.pmdec !== null ? `${o.pmra.toFixed(1)}, ${o.pmdec.toFixed(1)} mas/yr (RA, Dec)` : "";
  const motion = o.z !== null ? `redshift z = ${o.z.toPrecision(4)}` : o.rv !== null ? `${o.rv.toFixed(1)} km/s radial velocity` : "";

  el.innerHTML = `
    <div class="info-head"><h3>${esc(title)}</h3><button class="btn close" aria-label="Close">×</button></div>
    <p class="type">${esc(typeLabel(o.otype))}</p>
    <table>
      ${commonName ? row("SIMBAD name", esc(prettyName(o.main_id))) : ""}
      ${row("Position (J2000)", `${hms(o.ra)}, ${dms(o.dec)}`)}
      ${row("Spectral type", o.sp_type ? esc(o.sp_type) : "")}
      ${row("Morphology", o.morph_type ? esc(o.morph_type) : "")}
      ${row("Magnitudes", mags)}
      ${row("Distance", distance)}
      ${row("Proper motion", pm)}
      ${row("Velocity", motion)}
    </table>
    <div class="links">
      <a href="${esc(simbadUrl(o.main_id))}" target="_blank" rel="noopener">Open in SIMBAD</a>
      <a href="${esc(CONFIG.irsaPage)}" target="_blank" rel="noopener">SPHEREx data at IRSA</a>
    </div>
    ${inspectHandler ? '<div class="row"><button class="btn primary" id="info-inspect">Inspect SPHEREx epochs here</button></div>' : ""}
    <p class="note">Object data from SIMBAD.</p>`;
  el.querySelector(".close").addEventListener("click", hideInfo);
  const ib = el.querySelector("#info-inspect");
  if (ib) ib.addEventListener("click", () => inspectHandler(o.ra, o.dec, title));
}

/** Card for a clicked InfraSphere tile. */
export function showTileCard(tile, { onInspect, onLookup }) {
  const el = $("info");
  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="info-head"><h3>Tile ${esc(tile.name)}</h3><button class="btn close" aria-label="Close">×</button></div>
    <p class="type">InfraSphere tile (HEALPix order ${tile.order}, about 0.46° across)</p>
    <table>${row("Centre (J2000)", `${hms(tile.ra)}, ${dms(tile.dec)}`)}</table>
    <div class="row" style="margin-top:10px">
      <button class="btn primary" id="tile-inspect">Inspect SPHEREx epochs</button>
      <button class="btn" id="tile-lookup">Ask SIMBAD here</button>
    </div>
    <p class="note">Inspect lists every SPHEREx exposure that covered this tile and shows them side by side.</p>`;
  el.querySelector(".close").addEventListener("click", hideInfo);
  el.querySelector("#tile-inspect").addEventListener("click", onInspect);
  el.querySelector("#tile-lookup").addEventListener("click", onLookup);
}

/** Card for a clicked Sun, Moon, planet or asteroid. */
export function showSolarInfo(o) {
  const el = $("info");
  el.classList.remove("hidden");
  const kind = o.kind === "asteroid" ? (o.near ? "Near-Earth asteroid" : "Asteroid") : o.kind === "sun" ? "Star (the Sun)" : o.kind === "moon" ? "Moon" : "Planet";
  const dist = o.kind === "moon" ? `${Math.round(o.dist * AU_KM).toLocaleString("en-US")} km` : `${o.dist.toFixed(3)} AU (${(o.dist * 8.317).toFixed(1)} light-minutes)`;
  el.innerHTML = `
    <div class="info-head"><h3>${esc(o.name)}</h3><button class="btn close" aria-label="Close">×</button></div>
    <p class="type">${esc(kind)}</p>
    <table>
      ${row("Position (J2000)", `${hms(o.ra)}, ${dms(o.dec)}`)}
      ${row("Distance from Earth", dist)}
      ${row("Apparent magnitude", o.mag !== null && o.mag !== undefined ? o.mag.toFixed(1) : "")}
      ${row("Absolute magnitude H", o.H !== undefined ? o.H.toFixed(1) : "")}
    </table>
    <p class="note">${o.kind === "asteroid"
      ? "Position computed from the JPL orbit for the time shown (approximate, within about an arcminute for most main-belt asteroids)."
      : "Position computed for the time shown."} SPHEREx catches moving objects only in single exposures, so they are not part of the combined sky map.</p>
    <div class="links"><a href="${esc(CONFIG.irsaPage)}" target="_blank" rel="noopener">SPHEREx data at IRSA</a></div>`;
  el.querySelector(".close").addEventListener("click", hideInfo);
}
