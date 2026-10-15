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

const $ = UI.$;

// ---------- state ----------
const state = {
  lat: CONFIG.location.lat, lon: CONFIG.location.lon,
  simMs: Date.now(), speed: 1,
  ground: true, grid: true, eqGrid: false, galGrid: false, directions: true, flip: false,
  tiles: false, planets: true, asteroids: false, neo: false,
  expo: 1.4, gam: 1.0,
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
const inspector = new Inspector(UI.ui);
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

// ---------- looking at an object ----------
async function showDetails(obj, name) {
  state.selected = { ra: obj.ra, dec: obj.dec };
  UI.showInfoLoading(name || Simbad.prettyName(obj.main_id));
  try {
    const full = obj.oid !== null && obj.oid !== undefined ? await Simbad.fetchDetails(obj.oid) : null;
    UI.showInfo(full || obj, name || obj.name);
  } catch (e) {
    UI.showInfo(obj, name || obj.name);
    UI.say("Could not fetch full details (" + e.message + ").", 4000);
  }
}

async function lookupSpot(px, py) {
  // Ask SIMBAD for the closest object within about 14 pixels.
  const d = view.dirFromPixel(px, py);
  const eq = altAzVecToEq(d, state.lat, lst());
  const radius = Math.min(Math.max(view.angleBetweenPixels(px, py, px + 14, py) * R2D, 0.003), 3);
  state.selected = { ra: eq.ra, dec: eq.dec };
  UI.showInfoLoading("Looking up this spot");
  try {
    const obj = await Simbad.fetchNearest({ ra: eq.ra, dec: eq.dec, radius });
    if (!obj) { UI.showInfoMessage("Nothing here", "SIMBAD lists no object within about 14 pixels of that spot."); return; }
    layer.add([obj]);
    state.selected = { ra: obj.ra, dec: obj.dec };
    UI.showInfo(obj, null);
  } catch (e) {
    UI.showInfoMessage("Lookup failed", e.message);
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
UI.buildBandButtons((id) => { state.band = id; UI.setActiveBand(id); sky.loadBand(id, state.quality); });
$("quality").addEventListener("change", (e) => { state.quality = parseInt(e.target.value, 10); sky.loadBand(state.band, state.quality); });
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
$("planets").addEventListener("change", (e) => { state.planets = e.target.checked; });
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
$("toggle").addEventListener("click", () => $("panel").classList.toggle("hidden"));
if (window.innerWidth < 700) $("panel").classList.add("hidden");

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

  const ctx = labelCtx;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, view.W, view.H);
  if (state.tiles) tiles.draw(ctx, view, state.lat, L, { selected: state.tile });
  if (state.directions) drawDirections(ctx, view);
  layer.draw(ctx, view, state.lat, L, {
    groups: state.groups, showLabels: true, hideBelow: state.ground,
    maxDrawn: CONFIG.labels.maxDrawn, selected: state.selected
  });
  solar.update(state.simMs, { asteroids: state.asteroids, neo: state.neo });
  solar.draw(ctx, view, state.lat, L, { planets: state.planets, asteroids: state.asteroids, neo: state.neo, hideBelow: state.ground });

  const eq = centerEq();
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