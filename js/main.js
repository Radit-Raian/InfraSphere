// InfraSphere: wires the sky renderer, SPHEREx data, SIMBAD labels and the page together.

import { CONFIG } from "./config.js";
import { D2R, R2D, lstRad, eqToAltAzVec, altAzVecToEq, hms, dms, compass } from "./astro.js";
import { View } from "./view.js";
import { SkyRenderer } from "./sky-renderer.js";
import { SkyData } from "./sky-data.js";
import { LabelLayer, drawDirections } from "./labels.js";
import { LabelFeed } from "./label-feed.js";
import { attachControls } from "./controls.js";
import * as Simbad from "./simbad.js";
import * as UI from "./ui.js";
import { TileGrid } from "./tiles.js";
import { SolarSystem } from "./solar-system.js";
import { Inspector } from "./inspector.js";
import { StarLayer } from "./star-layer.js";
import { WisePanel } from "./wise.js";
import { initDock } from "./dock.js";
import { horizonSin } from "./landscape.js";
import { wikiCandidates, candidatesFromIdents, fetchWikiBlurb } from "./wiki.js";

const $ = UI.$;

// ---------- state ----------
const state = {
  lat: CONFIG.location.lat, lon: CONFIG.location.lon,
  simMs: Date.now(), speed: 1,
  ground: true, grid: false, eqGrid: false, galGrid: false, directions: true, flip: false,
  tiles: false, asteroids: false, neo: false,
  expo: 1.0, gam: 1.0,
  quality: 2, sharpen: true,
  band: "color",
  groups: { star: true, galaxy: true, cluster: true, nebula: true, other: false },
  selected: null,         // { ra, dec } of the clicked object
  tile: null              // { order, pix } of the clicked tile
};

const view = new View();
let renderer;
try {
  renderer = new SkyRenderer($("sky"));
} catch (e) {
  UI.say(e.message);
  throw e;
}
const labelCtx = $("labels").getContext("2d");
const layer = new LabelLayer();
const sky = new SkyData(renderer, UI.ui);
const feed = new LabelFeed(layer, UI.ui);
const tiles = new TileGrid();
const solar = new SolarSystem(UI.ui);
// Live stars: sharp points, with fainter ones appearing as you zoom in. Simulated sky only; the real SPHEREx maps have
// their stars in the picture, so they cannot be drawn this way.
const stars = new StarLayer();
stars.enabled = CONFIG.simulate;
const inspector = new Inspector(UI.ui);
const wise = new WisePanel(UI.ui);
UI.setInspectHandler((ra, dec, title) => inspector.open({ ra, dec, title }));

let lastInteract = 0;
const markInteract = () => { lastInteract = performance.now(); };
const isIdle = (now, ms) => now - lastInteract > ms && !controls.isInteracting();

let DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  const W = $("sky").clientWidth, H = $("sky").clientHeight;
  renderer.resize(W, H, DPR);
  $("labels").width = Math.round(W * DPR);
  $("labels").height = Math.round(H * DPR);
  view.resize(W, H);
}
window.addEventListener("resize", resize);

const lst = () => lstRad(state.simMs, state.lon);
const centerEq = () => altAzVecToEq(view.basis().f, state.lat, lst());

// ---------- Wikipedia blurb in the info card ----------
// Only for objects that can have an article. Gaia, 2MASS and similar catalogue entries never do, so they skip this and the card
// behaves exactly as before. The lookup starts a moment after the card is shown so it never competes with the SIMBAD answer.
const wikiCache = new Map();     // oid -> blurb or null
const CATALOGUE_ONLY = /^(Gaia|2MASS|WISE|AllWISE|TYC|UCAC|PPMXL|SDSS|USNO|GSC|LEDA|PGC|SSTSL|\[)/i;
async function attachWiki(obj, name) {
  const key = obj.oid;
  if (key === null || key === undefined) return;
  const plain = String(obj.main_id || "").replace(/^(\*\*|\*|V\*|NAME|Cl\*) /, "").trim();
  if (!name && CATALOGUE_ONLY.test(plain)) return;
  const cardIsOn = () => $("info").dataset.key === String(key) && !$("info").classList.contains("hidden");
  if (wikiCache.has(key)) { const b = wikiCache.get(key); UI.setInfoWiki(key, b || { none: true }); return; }
  await new Promise((r) => setTimeout(r, 400));
  if (!cardIsOn()) return;
  UI.setInfoWiki(key, { loading: true });
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12000);
  try {
    let blurb = await fetchWikiBlurb(wikiCandidates(obj.main_id, name ? [name] : []), { signal: ctl.signal });
    if (!blurb && cardIsOn()) {                                   // try all the object's other names (HD, HIP, common names ...)
      let ids = [];
      try { ids = await Simbad.fetchIdents(key, { signal: ctl.signal }); } catch (e) { if (e.name === "AbortError") throw e; }
      blurb = await fetchWikiBlurb(candidatesFromIdents(ids), { signal: ctl.signal });
    }
    wikiCache.set(key, blurb);
    UI.setInfoWiki(key, blurb || { none: true });
  } catch (e) {
    console.warn("Wikipedia lookup failed", e);
    UI.setInfoWiki(key, { none: true });
  } finally { clearTimeout(timer); }
}

// ---------- looking at an object ----------
async function showDetails(obj, name) {
  state.selected = { ra: obj.ra, dec: obj.dec };
  wise.open({ ra: obj.ra, dec: obj.dec, name: name || obj.name || Simbad.prettyName(obj.main_id), group: obj.group });
  UI.showInfoLoading(name || Simbad.prettyName(obj.main_id));
  try {
    const full = obj.oid !== null && obj.oid !== undefined ? await Simbad.fetchDetails(obj.oid) : null;
    UI.showInfo(full || obj, name || obj.name);
    attachWiki(full || obj, name || obj.name);
  } catch (e) {
    UI.showInfo(obj, name || obj.name);
    UI.say("Could not fetch full details (" + e.message + ").", 4000);
  }
}

let lookupSeq = 0;
async function lookupSpot(px, py) {
  // Ask SIMBAD for the closest object within about 14 pixels.
  const d = view.dirFromPixel(px, py);
  const eq = altAzVecToEq(d, state.lat, lst());
  const radius = Math.min(Math.max(view.angleBetweenPixels(px, py, px + 14, py) * R2D, 0.003), 3);
  const seq = ++lookupSeq;                 // a newer click makes an older, slower answer stale
  state.selected = { ra: eq.ra, dec: eq.dec };
  UI.showInfoLoading("Looking up this spot");
  // The WISE window opens at once on the clicked point (it does not need SIMBAD). When SIMBAD answers with an
  // object more than a few arcseconds away, the window is moved onto that object's own catalogue position.
  wise.open({ ra: eq.ra, dec: eq.dec, name: "Sky position" });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const obj = await Simbad.fetchNearest({ ra: eq.ra, dec: eq.dec, radius }, { signal: ctl.signal });
    if (seq !== lookupSeq) return;
    if (!obj) { UI.showInfoMessage("Nothing here", "SIMBAD lists no object within about 14 pixels of that spot. The WISE window shows the exact point you clicked."); return; }
    layer.add([obj]);
    state.selected = { ra: obj.ra, dec: obj.dec };
    const sepArcsec = Math.hypot((obj.ra - eq.ra) * Math.cos(eq.dec * D2R), obj.dec - eq.dec) * 3600;
    if (sepArcsec > 3) wise.open({ ra: obj.ra, dec: obj.dec, name: Simbad.prettyName(obj.main_id), group: obj.group });
    else wise.rename(Simbad.prettyName(obj.main_id));
    UI.showInfo(obj, null);
    attachWiki(obj, null);
  } catch (e) {
    if (seq !== lookupSeq) return;
    console.error("SIMBAD lookup failed", e);
    UI.showInfoMessage("Lookup failed", e.name === "AbortError" ? "SIMBAD did not answer within 15 seconds." : e.message);
  } finally {
    clearTimeout(timer);
  }
}

async function onSkyClick(px, py) {
  const body = solar.pick(px, py, 16);
  if (body) { state.selected = { ra: body.ra, dec: body.dec }; state.tile = null; UI.showSolarInfo(body); return; }
  const hit = layer.pick(px, py, 14);
  if (hit) { state.tile = null; showDetails(hit, hit.name); return; }
  if (state.tiles) {
    const eq = altAzVecToEq(view.dirFromPixel(px, py), state.lat, lst());
    const t = tiles.tileAt(eq.ra, eq.dec);
    state.tile = t; state.selected = null;
    wise.open({ ra: eq.ra, dec: eq.dec, name: "Tile " + t.name });
    UI.showTileCard(t, {
      onInspect: () => inspector.open({ ra: t.ra, dec: t.dec, title: "Tile " + t.name }),
      onLookup: () => { state.tile = null; lookupSpot(px, py); }
    });
    return;
  }
  state.tile = null;
  lookupSpot(px, py);
}

async function searchObject(text) {
  if (!text.trim()) return;
  UI.setBusy("search", "Searching SIMBAD for " + text.trim());
  try {
    const obj = await Simbad.resolveName(text);
    if (!obj) { UI.say("SIMBAD does not know \"" + text.trim() + "\". Try another name, like M31 or Sirius.", 4000); return; }
    const v = eqToAltAzVec(obj.ra, obj.dec, state.lat, lst());
    view.lookAtVec(v);
    view.fov = Math.min(view.fov, 25 * D2R);
    view.clamp();
    layer.add([obj]);
    markInteract();
    if (v[2] < 0) UI.say("That object is below your horizon right now. Switch off Ground or change the time to see it.", 5000);
    showDetails(obj, null);
  } catch (e) {
    UI.say("Search failed (" + e.message + ").", 5000);
  } finally {
    UI.setBusy("search", "");
  }
}

// ---------- controls ----------
const controls = attachControls($("sky"), view, {
  onInteract: markInteract,
  onClick: onSkyClick,
  onHover: (px, py) => {
    const d = view.dirFromPixel(px, py), eq = altAzVecToEq(d, state.lat, lst());
    const alt = Math.asin(Math.max(-1, Math.min(1, d[2]))) * R2D;
    const az = ((Math.atan2(d[1], d[0]) * R2D) + 360) % 360;
    $("hover").innerHTML = `RA <b>${hms(eq.ra)}</b> Dec <b>${dms(eq.dec)}</b><br>Alt <b>${alt.toFixed(1)}°</b> Az <b>${az.toFixed(1)}°</b>`;
  },
  onLeave: () => { $("hover").innerHTML = ""; }
});

// ---------- panel wiring ----------
UI.buildBandButtons((id) => { state.band = id; UI.setActiveBand(id); stars.setBand(id); sky.loadBand(id, state.quality); });
$("quality").addEventListener("change", (e) => { state.quality = parseInt(e.target.value, 10); sky.loadBand(state.band, state.quality); });
// Background light components of the simulated sky (zodiacal, diffuse Galactic, extragalactic, stars and sources)
const BG = { zl: "bg-zl", dgl: "bg-dgl", ebl: "bg-ebl", stars: "bg-stars" };
for (const [comp, id] of Object.entries(BG)) {
  $(id).addEventListener("change", () => {
    const comps = Object.fromEntries(Object.entries(BG).map(([c, i]) => [c, $(i).checked]));
    stars.enabled = CONFIG.simulate && comps.stars;
    if (sky.setComps(comps)) sky.loadBand(state.band, state.quality);
  });
}
if (CONFIG.simulate === false) for (const id of Object.values(BG)) { $(id).disabled = true; }
$("sharp").addEventListener("change", (e) => { state.sharpen = e.target.checked; if (!state.sharpen) renderer.clearPatch(); });

$("lat").value = state.lat; $("lon").value = state.lon;
$("lat").addEventListener("change", (e) => { state.lat = Math.max(-90, Math.min(90, parseFloat(e.target.value) || 0)); });
$("lon").addEventListener("change", (e) => { state.lon = Math.max(-180, Math.min(180, parseFloat(e.target.value) || 0)); });
$("geo").addEventListener("click", () => {
  if (!navigator.geolocation) { UI.say("Location is not available in this browser.", 3000); return; }
  navigator.geolocation.getCurrentPosition(
    (p) => { state.lat = p.coords.latitude; state.lon = p.coords.longitude; $("lat").value = state.lat.toFixed(2); $("lon").value = state.lon.toFixed(2); },
    () => UI.say("Could not get your location. Type latitude and longitude instead.", 3500)
  );
});

$("time").addEventListener("change", (e) => { const t = new Date(e.target.value).getTime(); if (!Number.isNaN(t)) state.simMs = t; });
$("now").addEventListener("click", () => { state.simMs = Date.now(); state.speed = 1; $("speed").value = "1"; });
$("m1h").addEventListener("click", () => { state.simMs -= 3600000; });
$("p1h").addEventListener("click", () => { state.simMs += 3600000; });
$("speed").addEventListener("change", (e) => { state.speed = parseFloat(e.target.value); });

$("proj").addEventListener("change", (e) => { view.proj = parseInt(e.target.value, 10); view.clamp(); });
$("ground").addEventListener("change", (e) => { state.ground = e.target.checked; });
$("grid").addEventListener("change", (e) => { state.grid = e.target.checked; });
$("eqgrid").addEventListener("change", (e) => { state.eqGrid = e.target.checked; });
$("galgrid").addEventListener("change", (e) => { state.galGrid = e.target.checked; });
$("tilegrid").addEventListener("change", (e) => { state.tiles = e.target.checked; if (!state.tiles) state.tile = null; });
$("asteroids").addEventListener("change", (e) => { state.asteroids = e.target.checked; });
$("neo").addEventListener("change", (e) => { state.neo = e.target.checked; });
$("dirs").addEventListener("change", (e) => { state.directions = e.target.checked; });
$("flip").addEventListener("change", (e) => { state.flip = e.target.checked; });
$("expo").addEventListener("input", (e) => { state.expo = parseFloat(e.target.value); });
$("gam").addEventListener("input", (e) => { state.gam = parseFloat(e.target.value); });
for (const g of Object.keys(state.groups)) {
  $("lbl-" + g).checked = state.groups[g];
  $("lbl-" + g).addEventListener("change", (e) => { state.groups[g] = e.target.checked; });
}
$("search").addEventListener("keydown", (e) => { if (e.key === "Enter") searchObject(e.target.value); });
$("searchBtn").addEventListener("click", () => searchObject($("search").value));
initDock();
if (CONFIG.simulate) {
  document.title = "InfraSphere (simulated sky)";
}

$("file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try { sky.useCustomImage(await createImageBitmap(f)); UI.say("Loaded your image", 2000); }
  catch (err) { UI.say("Could not read that image: " + err.message); }
});

// ---------- frame loop ----------
let last = performance.now(), frame = 0;
function tick(now) {
  const dt = Math.min(now - last, 100);
  last = now;
  state.simMs += dt * state.speed;
  const L = lst();

  renderer.render(view, L, state.lat, state);

  const eq = centerEq();
  const ctx = labelCtx;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, view.W, view.H);
  stars.update(view, eq, now);
  const horizon = state.ground ? horizonSin : null;        // hills hide whatever lies behind them
  stars.draw(ctx, view, state.lat, L, { hideBelow: state.ground, horizon });
  if (state.tiles) tiles.draw(ctx, view, state.lat, L, { selected: state.tile });
  if (state.directions) drawDirections(ctx, view);
  layer.draw(ctx, view, state.lat, L, {
    groups: state.groups, showLabels: true, hideBelow: state.ground, horizon,
    maxDrawn: CONFIG.labels.maxDrawn, selected: state.selected, starDots: stars.enabled
  });
  solar.update(state.simMs, { asteroids: state.asteroids, neo: state.neo });
  solar.draw(ctx, view, state.lat, L, { asteroids: state.asteroids, neo: state.neo, hideBelow: state.ground, horizon });

  sky.maybeSharpen({ now, idle: isIdle(now, CONFIG.patch.idleMs), enabled: state.sharpen, flip: state.flip, view, centerEq: eq });
  feed.maybeUpdate({ now, idle: isIdle(now, CONFIG.labels.idleMs), enabled: true, view, centerEq: eq });

  if (frame++ % 8 === 0) {
    const az = ((view.az * R2D) % 360 + 360) % 360;
    $("readout").innerHTML =
      `Direction <b>${compass(az)} ${az.toFixed(0)}°</b>, altitude <b>${(view.alt * R2D).toFixed(0)}°</b>` +
      `<br>RA <b>${hms(eq.ra)}</b>  Dec <b>${dms(eq.dec)}</b>` +
      `<br>Field of view <b>${(view.fov * R2D).toFixed(view.fov * R2D < 10 ? 1 : 0)}°</b>  Sidereal time <b>${hms(L * R2D)}</b>`;
    if (state.speed !== 1 || frame % 64 === 1) UI.setTimeInput(state.simMs);
  }
  requestAnimationFrame(tick);
}

resize();
UI.setTimeInput(state.simMs);
sky.loadBand(state.band, state.quality);
requestAnimationFrame(tick);