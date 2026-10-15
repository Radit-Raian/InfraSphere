// The epoch inspector: a "blink comparator" workspace for one sky tile.
//   left   : batch of neighbouring tiles (click to jump, ← → to step)
//   centre : epoch A / epoch B, and four ways to compare them: Blink, Difference, Bands, Light curve
//   right  : case notes (flag + text), tile metadata, and EVERY exposure that covered the tile with its date
// Every image is re-aligned onto the same north-up grid, so differences between dates are real differences.

import { CONFIG } from "./config.js";
import * as Irsa from "./irsa.js";
import { makeGrid, reproject, gridToSky, median, quantile } from "./fits.js";
import { ang2pix, pix2ang, tileSizeDeg, tileName } from "./healpix.js";

const ORDER = 7;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const PALETTE = ["#f2557a", "#6fb7ff", "#ffc857", "#7bd88f", "#c792ea", "#ff9e64"];
const STAGE = 640;

// ---------- drawing helpers ----------

const HEAT = (t) => [Math.min(255, t * 3 * 255), Math.min(255, Math.max(0, t * 3 - 1) * 255), Math.min(255, Math.max(0, t * 3 - 2) * 255)];
const GREY = (t) => [t * 255, t * 255, t * 255];
const DIV = (t) => (t < 0.5 ? [80 + t * 2 * 175, 120 + t * 2 * 135, 255] : [255, 255 - (t - 0.5) * 2 * 175, 255 - (t - 0.5) * 2 * 215]);

/** Float array + limits -> RGBA bytes. */
export function colorize(arr, n, lo, hi, { stretch = "asinh", cmap = "gray" } = {}) {
  const out = new Uint8ClampedArray(n * n * 4);
  const f = cmap === "heat" ? HEAT : cmap === "div" ? DIV : GREY;
  const span = hi - lo || 1, norm = Math.asinh(10);
  for (let k = 0; k < arr.length; k++) {
    const v = arr[k];
    if (!Number.isFinite(v)) { out[k * 4] = 26; out[k * 4 + 1] = 19; out[k * 4 + 2] = 24; out[k * 4 + 3] = 255; continue; }
    let t = Math.min(1, Math.max(0, (v - lo) / span));
    if (stretch === "asinh" && cmap !== "div") t = Math.asinh(10 * t) / norm;
    const c = f(t);
    out[k * 4] = c[0]; out[k * 4 + 1] = c[1]; out[k * 4 + 2] = c[2]; out[k * 4 + 3] = 255;
  }
  return out;
}

const fmtTime = Irsa.fmtDateTime;
const noteKey = (name) => "infrasphere.notes." + name;
const loadNote = (name) => { try { return JSON.parse(localStorage.getItem(noteKey(name))) || {}; } catch { return {}; } };
const saveNote = (name, v) => { try { localStorage.setItem(noteKey(name), JSON.stringify(v)); } catch { /* storage may be blocked */ } };

export class Inspector {
  constructor(ui) {
    this.ui = ui;
    this.root = document.getElementById("inspector");
    this.ctl = null;
    this.entries = new Map();      // id -> { id, title, sub, kind, state, arr, med, bitmap, ... }
    this.epochs = [];
    this.A = null; this.B = null; this.userPicked = false;
    this.pos = null; this.grid = null; this.tile = null;
    this.limits = null;
    this.mode = "blink"; this.showB = false; this.paused = false;
    this.batch = []; this.stageArr = null; this.curvePts = [];
    this.off = document.createElement("canvas");
    this._build();
    this.timer = null;
    window.addEventListener("keydown", (e) => this._key(e));
  }

  get isOpen() { return !this.root.classList.contains("hidden"); }

  // ---------- layout ----------

  _build() {
    const r = this.root;
    r.innerHTML = "";

    // header
    const head = el("header", "ix-head");
    const t = el("div"); this.titleEl = el("h2"); this.subEl = el("p", "note"); t.append(this.titleEl, this.subEl);
    const x = el("button", "btn", "Close ✕"); x.addEventListener("click", () => this.close());
    head.append(t, x);

    // left: batch
    const left = el("aside", "ix-left");
    this.batchHead = el("h3", "ix-h", "SKY TILE BATCH");
    this.batchEl = el("div", "ix-batch");
    left.append(this.batchHead, this.batchEl, el("p", "note", "Neighbouring order-7 HEALPix tiles (about 0.46° each). Click one to inspect it."));

    // centre: toolbar + stage
    const mid = el("section", "ix-mid");
    const bar = el("div", "ix-bar");
    const sel = (label, cls) => { const l = el("label", "ix-sel " + cls); l.append(el("span", null, label)); const s = el("select"); l.append(s); return [l, s]; };
    const [aL, aS] = sel("EPOCH A", "a"); const [bL, bS] = sel("EPOCH B", "b");
    this.selA = aS; this.selB = bS;
    aS.addEventListener("change", () => this._setFromSelect("A", aS.value));
    bS.addEventListener("change", () => this._setFromSelect("B", bS.value));
    this.modeBtns = {};
    const modes = el("div", "ix-modes");
    for (const [id, label] of [["blink", "BLINK COMPARATOR"], ["diff", "DIFFERENCE"], ["bands", "BANDS"], ["curve", "LIGHT CURVE"]]) {
      const b = el("button", "ix-mode", label); b.addEventListener("click", () => this.setMode(id));
      this.modeBtns[id] = b; modes.append(b);
    }
    const rate = el("label", "ix-rate"); rate.append(el("span", null, "RATE"));
    this.rateI = el("input"); this.rateI.type = "range"; this.rateI.min = "0.5"; this.rateI.max = "6"; this.rateI.step = "0.5"; this.rateI.value = "1.5";
    this.rateV = el("b", null, "1.5 Hz");
    this.rateI.addEventListener("input", () => { this.rateV.textContent = this.rateI.value + " Hz"; this._restartBlink(); });
    rate.append(this.rateI, this.rateV);
    bar.append(aL, bL, modes, rate);

    // settings
    const set = el("div", "ix-set");
    const mk = (label, node) => { const l = el("label", null, label + " "); l.append(node); return l; };
    this.bandSel = el("select");
    for (const b of CONFIG.bands.filter((b) => b.id !== "color")) this.bandSel.add(new Option(`${b.name} ${b.range}`, b.id));
    this.bandSel.add(new Option("All six bands (slow)", "all"));
    this.bandSel.value = CONFIG.inspector.defaultBand;
    this.sizeSel = el("select");
    for (const s of CONFIG.inspector.sizes) this.sizeSel.add(new Option(s + "°", String(s)));
    this.sizeSel.value = String(CONFIG.inspector.defaultSize);
    this.stretchSel = el("select"); this.stretchSel.add(new Option("asinh", "asinh")); this.stretchSel.add(new Option("linear", "linear"));
    this.cmapSel = el("select"); this.cmapSel.add(new Option("Grey", "gray")); this.cmapSel.add(new Option("Heat", "heat"));
    const chk = (label, checked) => { const l = el("label", "check"); const i = el("input"); i.type = "checkbox"; i.checked = checked; l.append(i, document.createTextNode(" " + label)); return [l, i]; };
    const [subL, subI] = chk("Subtract median", true); this.subI = subI;
    const [shL, shI] = chk("Shared scale", true); this.sharedI = shI;
    this.loadBtn = el("button", "btn primary", "Load");
    this.loadBtn.addEventListener("click", () => this.load());
    set.append(mk("Band", this.bandSel), mk("Size", this.sizeSel), mk("Stretch", this.stretchSel), mk("Colors", this.cmapSel), subL, shL, this.loadBtn);
    for (const c of [this.stretchSel, this.cmapSel, this.sharedI]) c.addEventListener("change", () => this.renderAll());
    this.subI.addEventListener("change", () => { for (const g of this.epochs) this._computeMean(g); this.renderAll(); });
    this.sizeSel.addEventListener("change", () => this.load());
    this.bandSel.addEventListener("change", () => { this._buildBatch(true); this.load(); });

    this.statusEl = el("p", "note ix-status");

    // stage
    const wrap = el("div", "ix-stagewrap");
    this.stage = el("canvas", "ix-stage"); this.stage.width = this.stage.height = STAGE;
    this.labelEl = el("div", "ix-label");
    this.ringEl = el("div", "ix-ring");
    this.bandsBtn = el("button", "btn primary ix-bandsbtn hidden", "Load all six bands");
    this.bandsBtn.addEventListener("click", () => { this.bandSel.value = "all"; this._buildBatch(true); this.load(); });
    wrap.append(this.stage, this.ringEl, this.labelEl, this.bandsBtn);
    this.stage.addEventListener("mousemove", (ev) => this._hover(ev));
    this.stage.addEventListener("mouseleave", () => this._readout());
    this.stage.addEventListener("click", (ev) => this._stageClick(ev));
    this.readEl = el("p", "ix-read");
    const keys = el("p", "note ix-keys");
    keys.innerHTML = "<b>Space</b> pause/blink · <b>1</b> <b>2</b> show A / B · <b>F</b> flag · <b>C</b> clear flag · <b>← →</b> tiles · <b>Esc</b> close";
    mid.append(bar, set, this.statusEl, wrap, this.readEl, keys);

    // right: notes, metadata, epochs
    const right = el("aside", "ix-right");
    right.append(el("h3", "ix-h", "CASE NOTES"));
    this.flagBtn = el("button", "btn", "⚑ Flag this tile"); this.flagBtn.addEventListener("click", () => this._toggleFlag());
    this.noteTa = el("textarea", "ix-note"); this.noteTa.rows = 3; this.noteTa.placeholder = "What changed between epochs? (saved in this browser)";
    this.noteTa.addEventListener("input", () => { if (!this.tile) return; const n = loadNote(this.tile.name); n.text = this.noteTa.value; saveNote(this.tile.name, n); });
    right.append(this.flagBtn, this.noteTa);
    right.append(el("h3", "ix-h", "TILE METADATA"));
    this.metaEl = el("table", "ix-meta");
    right.append(this.metaEl);
    this.epochHead = el("h3", "ix-h", "ALL EPOCHS");
    this.epochsEl = el("div", "ix-epochs");
    this.noteEl = el("p", "note",
      "Each exposure samples a different wavelength inside its band (the filter changes across the detector), so compare dates within one band. Images are not zodiacal-light subtracted; the median option removes the smooth background level.");
    right.append(this.epochHead, this.epochsEl, this.noteEl);

    const body = el("div", "ix-body");
    body.append(left, mid, right);
    r.append(head, body);
    this._markModes();
  }

  // ---------- open / close ----------

  open({ ra, dec, title }, { keepBatch = false } = {}) {
    this.pos = { ra, dec };
    const pix = ang2pix(ORDER, ra, dec);
    this.tile = { order: ORDER, pix, name: tileName(ORDER, pix), size: tileSizeDeg(ORDER) };
    this.titleEl.textContent = (title && !/^Tile /.test(title) ? title + " · " : "") + "Tile " + this.tile.name;
    this.subEl.textContent = `RA ${ra.toFixed(4)}°  Dec ${dec.toFixed(4)}° (J2000)`;
    this.root.classList.remove("hidden");
    if (!keepBatch) this._buildBatch(false); else this._markBatch();
    const n = loadNote(this.tile.name);
    this.noteTa.value = n.text || ""; this._markFlag(!!n.flag);
    this._restartBlink();
    this.load();
  }

  close() {
    if (this.ctl) this.ctl.abort();
    clearInterval(this.timer); this.timer = null;
    this.root.classList.add("hidden");
  }

  say(msg, isError = false) { this.statusEl.textContent = msg || ""; this.statusEl.classList.toggle("error", !!isError); }

  // ---------- tile batch ----------

  _bandId() { const b = this.bandSel.value; return b === "all" ? "color" : b; }

  _buildBatch(refreshOnly) {
    if (!refreshOnly || !this.batch.length) {
      const { ra, dec } = this.pos, step = tileSizeDeg(ORDER), seen = new Map();
      const cosd = Math.max(0.2, Math.cos(dec * Math.PI / 180));
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const pix = ang2pix(ORDER, ((ra + dx * step / cosd) % 360 + 360) % 360, Math.max(-89.9, Math.min(89.9, dec + dy * step)));
        if (!seen.has(pix)) seen.set(pix, { pix, name: tileName(ORDER, pix), dist: dx * dx + dy * dy });
      }
      this.batch = [...seen.values()].sort((a, b) => a.dist - b.dist || a.pix - b.pix);
      for (const b of this.batch) { [b.ra, b.dec] = pix2ang(ORDER, b.pix); }
      this.batch.sort((a, b) => a.pix - b.pix);
    }
    this.batchHead.textContent = `SKY TILE BATCH · ${this.batch.length}`;
    this.batchEl.innerHTML = "";
    for (const b of this.batch) {
      const f = el("figure", "ix-tile");
      const img = el("img"); img.alt = b.name; img.loading = "lazy";
      img.src = CONFIG.hips2fits + "?" + new URLSearchParams({
        hips: CONFIG.hipsRoot + this._bandId(), width: "112", height: "112", fov: String(tileSizeDeg(ORDER)),
        projection: "TAN", coordsys: "icrs", ra: b.ra.toFixed(5), dec: b.dec.toFixed(5), format: "jpg"
      }).toString();
      const cap = el("figcaption", null, b.name);
      f.append(img, cap);
      f.addEventListener("click", () => this.open({ ra: b.ra, dec: b.dec, title: "Tile " + b.name }, { keepBatch: true }));
      b.fig = f;
      this.batchEl.append(f);
    }
    this._markBatch();
  }

  _markBatch() {
    for (const b of this.batch) {
      const cur = this.tile && b.pix === this.tile.pix;
      b.fig.classList.toggle("cur", cur);
      const flagged = !!loadNote(b.name).flag;
      b.fig.classList.toggle("flagged", flagged);
    }
  }

  _stepTile(d) {
    if (!this.batch.length || !this.tile) return;
    const i = this.batch.findIndex((b) => b.pix === this.tile.pix);
    const b = this.batch[(i + d + this.batch.length) % this.batch.length];
    this.open({ ra: b.ra, dec: b.dec, title: "Tile " + b.name }, { keepBatch: true });
  }

  _toggleFlag() {
    if (!this.tile) return;
    const n = loadNote(this.tile.name); n.flag = !n.flag; saveNote(this.tile.name, n);
    this._markFlag(n.flag); this._markBatch();
  }
  _markFlag(on) { this.flagBtn.classList.toggle("primary", on); this.flagBtn.textContent = on ? "⚑ Flagged" : "⚑ Flag this tile"; }

  // ---------- keyboard ----------

  _key(e) {
    if (!this.isOpen) return;
    if (e.key === "Escape") { this.close(); return; }
    const t = e.target && e.target.tagName;
    if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") { if (!(t === "INPUT" && e.target.type === "checkbox")) return; }
    if (e.code === "Space") { e.preventDefault(); this.paused = !this.paused; this._markModes(); this._drawStage(); }
    else if (e.code === "Digit1") { this.paused = true; this.showB = false; this.setMode("blink", true); }
    else if (e.code === "Digit2") { this.paused = true; this.showB = true; this.setMode("blink", true); }
    else if (e.code === "KeyF") this._toggleFlag();
    else if (e.code === "KeyC") { const n = loadNote(this.tile.name); n.flag = false; saveNote(this.tile.name, n); this._markFlag(false); this._markBatch(); }
    else if (e.code === "ArrowLeft") { e.preventDefault(); this._stepTile(-1); }
    else if (e.code === "ArrowRight") { e.preventDefault(); this._stepTile(1); }
  }

  // ---------- modes ----------

  setMode(m, keepPause) {
    this.mode = m;
    if (!keepPause && m === "blink") this.paused = false;
    this._markModes(); this._restartBlink(); this._drawStage();
  }

  _markModes() {
    for (const [id, b] of Object.entries(this.modeBtns)) b.classList.toggle("on", id === this.mode);
    this.modeBtns.blink.textContent = this.mode === "blink" && this.paused ? "BLINK (PAUSED)" : "BLINK COMPARATOR";
  }

  _restartBlink() {
    clearInterval(this.timer); this.timer = null;
    if (!this.isOpen) return;
    this.timer = setInterval(() => {
      if (this.mode !== "blink" || this.paused || !this.A || !this.B) return;
      this.showB = !this.showB; this._drawStage();
    }, 1000 / Number(this.rateI.value));
  }

  // ---------- loading ----------

  async load() {
    if (!this.pos) return;
    if (this.ctl) this.ctl.abort();
    const ctl = this.ctl = new AbortController();
    const { ra, dec } = this.pos;
    const size = Number(this.sizeSel.value);
    const band = this.bandSel.value;
    this.entries.clear(); this.epochs = []; this.A = this.B = null; this.userPicked = false; this.limits = null;
    this.epochsEl.innerHTML = ""; this._fillSelects(); this._meta();
    this.grid = makeGrid(ra, dec, size, CONFIG.inspector.pixelScaleArcsec / 3600);
    this.off.width = this.off.height = this.grid.n;
    this.say("Asking IRSA which SPHEREx exposures cover this spot… (this can take 10 to 20 seconds)");
    this.loadBtn.disabled = true; this.loadBtn.textContent = "Loading…";
    this._drawStage();

    const mosaicDone = this._loadMosaic(band, ctl);

    const finish = () => { this.loadBtn.disabled = false; this.loadBtn.textContent = "Retry"; };
    let exposures;
    try {
      exposures = await Irsa.findExposures({ ra, dec, bands: band === "all" ? null : [band] }, { signal: ctl.signal });
    } catch (e) {
      if (e.name !== "AbortError") this.say("Could not list SPHEREx exposures: " + e.message + "  (Press Retry. If it keeps failing, run the app with `python3 serve.py`.)", true);
      finish(); return;
    }
    if (ctl.signal.aborted) return;
    if (!exposures.length) { this.say("IRSA lists no SPHEREx exposures covering this position" + (band === "all" ? "" : " in " + band) + " yet. Try another band.", true); finish(); this._meta(); return; }

    this.epochs = Irsa.groupEpochs(exposures);
    this._buildEpochs();
    this._fillSelects();
    this._meta();
    const jobs = this.epochs.flatMap((g) => g.items.map((e) => ({ g, e })));
    let done = 0, failed = 0, next = 0;
    const reqSize = Math.min(0.5, size * 1.45);      // rotated detector: ask for more so the corners are covered
    const total = jobs.length;
    const worker = async () => {
      while (next < jobs.length && !ctl.signal.aborted) {
        const { g, e } = jobs[next++];
        const ent = this.entries.get(e.key);
        try {
          const { img, wcs } = await Irsa.fetchCutout(e, ra, dec, reqSize, { signal: ctl.signal });
          ent.arr = reproject(img, wcs, this.grid);
          ent.med = median(ent.arr);
          ent.state = Number.isFinite(ent.med) ? "ok" : "empty";
        } catch (err) {
          if (err.name === "AbortError") return;
          ent.state = "failed"; ent.error = err.message; failed++;
        }
        done++;
        this.say(`Loaded ${done} of ${total} exposures${failed ? ` (${failed} failed)` : ""}.`);
        this._epochProgress(g);
        this._renderEntry(ent);
        if (done % 6 === 0 || done === total) { this._autoPick(); this.renderAll(); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONFIG.inspector.maxParallel, total) }, worker));
    await mosaicDone;
    if (ctl.signal.aborted) return;
    finish();
    const bad = [...this.entries.values()].filter((x) => x.state === "failed" && x.kind === "arr");
    const ok = total - failed;
    if (!ok) this.say(`None of the ${total} exposure cutouts could be downloaded. First error: ${bad[0] ? bad[0].error : "unknown"}. Press Retry, and make sure the app was started with \`python3 serve.py\`.`, true);
    else this.say(`${ok} of ${total} exposures loaded across ${this.epochs.length} epoch${this.epochs.length > 1 ? "s" : ""}.` + (bad.length ? ` ${bad.length} failed (first: ${bad[0].error}).` : ""), bad.length > 0 && ok === 0);
    this._autoPick();
    this.renderAll();
  }

  async _loadMosaic(band, ctl) {
    const id = band === "all" ? "color" : band;
    const n = 512;
    const url = CONFIG.hips2fits + "?" + new URLSearchParams({
      hips: CONFIG.hipsRoot + id, width: String(n), height: String(n), fov: String(this.grid.size),
      projection: "TAN", coordsys: "icrs", ra: this.pos.ra.toFixed(6), dec: this.pos.dec.toFixed(6), format: "jpg"
    }).toString();
    const ent = { id: "mosaic", title: "Mosaic (all epochs)", sub: "combined map from CDS", kind: "img", state: "loading" };
    this.entries.set("mosaic", ent);
    this._fillSelects();
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) throw new Error("server answered " + res.status);
      ent.bitmap = await createImageBitmap(await res.blob());
      ent.state = "ok";
    } catch (e) { if (e.name === "AbortError") return; ent.state = "failed"; ent.error = e.message; }
    if (ctl.signal.aborted) return;
    this._fillSelects();
    if (!this.A && ent.state === "ok") { this.A = ent; this._syncSelects(); }
    this._drawStage();
  }

  /** Once epoch data has arrived, put the first epoch in A and the last in B, unless the user chose. */
  _autoPick() {
    if (this.userPicked) return;
    let pool = this.epochs.map((g) => g.meanEnt).filter((x) => x.state === "ok");
    if (pool.length < 2) pool = [...this.entries.values()].filter((x) => x.exp && x.state === "ok");
    if (!pool.length) return;
    this.A = pool[0]; this.B = pool.length > 1 ? pool[pool.length - 1] : null;
    this._syncSelects();
  }

  // ---------- selects, epoch list, metadata ----------

  _optLabel(ent) { return ent.exp ? `${fmtTime(ent.exp.mjd)} · ${ent.exp.band || ""}` : ent.title; }

  _fillSelects() {
    for (const s of [this.selA, this.selB]) {
      s.innerHTML = "";
      const none = s === this.selB ? new Option("— none —", "") : null;
      if (none) s.add(none);
      const m = this.entries.get("mosaic");
      if (m) s.add(new Option(m.title, "mosaic"));
      for (const g of this.epochs) {
        const og = document.createElement("optgroup"); og.label = `${g.label} · ${Irsa.fmtDate(g.mjdMin)} → ${Irsa.fmtDate(g.mjdMax)}`;
        og.append(new Option(`${g.label} mean (${g.items.length} exposures)`, g.meanEnt.id));
        for (const e of g.items) og.append(new Option(this._optLabel(this.entries.get(e.key)), e.key));
        s.add(og);
      }
    }
    this._syncSelects();
  }

  _syncSelects() { this.selA.value = this.A ? this.A.id : ""; this.selB.value = this.B ? this.B.id : ""; }

  _setFromSelect(which, id) {
    const ent = id ? this.entries.get(id) : null;
    this.userPicked = true;
    if (which === "A") this.A = ent; else this.B = ent;
    this.renderAll();
  }

  _meta() {
    const t = this.tile, g = this.grid;
    const exps = [...this.entries.values()].filter((x) => x.exp);
    const mjds = exps.map((x) => x.exp.mjd);
    const bandId = this.bandSel.value, b = CONFIG.bands.find((x) => x.id === bandId);
    const rows = [
      ["Tile", t ? t.name : "—"],
      ["Centre RA", this.pos ? this.pos.ra.toFixed(4) + "°" : "—"],
      ["Centre Dec", this.pos ? this.pos.dec.toFixed(4) + "°" : "—"],
      ["Tile size", t ? t.size.toFixed(3) + "° (HEALPix order " + ORDER + ")" : "—"],
      ["View", g ? `${g.size}° · ${g.n}×${g.n} px · ${CONFIG.inspector.pixelScaleArcsec}″/px` : "—"],
      ["Epochs", String(this.epochs.length)],
      ["Exposures", String(exps.length)],
      ["Date span", mjds.length ? `${Irsa.fmtDate(Math.min(...mjds))} → ${Irsa.fmtDate(Math.max(...mjds))}` : "—"],
      ["Instrument", "NASA SPHEREx"],
      ["Band", bandId === "all" ? "all six detectors" : b ? `${b.name} ${b.range}` : bandId],
      ["Source", "IRSA (exposures) · CDS (mosaic)"]
    ];
    this.metaEl.innerHTML = "";
    for (const [k, v] of rows) { const tr = el("tr"); tr.append(el("th", null, k), el("td", null, v)); this.metaEl.append(tr); }
    this.epochHead.textContent = `ALL EPOCHS · ${this.epochs.length} · ${exps.length} EXPOSURES`;
  }

  _buildEpochs() {
    this.epochsEl.innerHTML = "";
    this.epochs.forEach((g, gi) => {
      g.color = PALETTE[gi % PALETTE.length];
      const sec = el("div", "ix-epoch");
      const h = el("div", "ix-epoch-h");
      const dot = el("span", "ix-dot"); dot.style.background = g.color;
      g.prog = el("span", "note", "");
      h.append(dot, el("b", null, g.label), document.createTextNode(` ${Irsa.fmtDate(g.mjdMin)} → ${Irsa.fmtDate(g.mjdMax)} · ${g.items.length} `), g.prog);
      sec.append(h);
      g.meanEnt = { id: g.id + ":mean", title: g.label + " mean", sub: `${g.items.length} exposures averaged · ${Irsa.fmtDate(g.mjdMin)} → ${Irsa.fmtDate(g.mjdMax)}`, kind: "arr", state: "loading", epoch: g, color: g.color };
      this.entries.set(g.meanEnt.id, g.meanEnt);
      sec.append(this._row(g.meanEnt, `${g.label} mean`, "average of all exposures below"));
      for (const e of g.items) {
        const ent = { id: e.key, title: fmtTime(e.mjd), sub: `${e.band || ""} · ${e.obsId || e.key.slice(-30)}`, kind: "arr", state: "loading", exp: e, g, color: g.color };
        this.entries.set(e.key, ent);
        sec.append(this._row(ent, fmtTime(e.mjd), `${e.band || ""}${e.band ? " " + Irsa.bandRange(e.band) : ""}`));
      }
      this.epochsEl.append(sec);
    });
  }

  _row(ent, main, subtext) {
    const row = el("div", "ix-row");
    const c = el("canvas"); c.width = c.height = this.grid.n; ent.canvas = c;
    const txt = el("div", "ix-rowtxt"); txt.append(el("b", null, main), el("span", null, subtext));
    const a = el("button", "ix-ab a", "A"), b = el("button", "ix-ab b", "B");
    a.title = "Show as epoch A"; b.title = "Show as epoch B";
    a.addEventListener("click", (ev) => { ev.stopPropagation(); this._pick(ent, false); });
    b.addEventListener("click", (ev) => { ev.stopPropagation(); this._pick(ent, true); });
    row.append(c, txt, a, b);
    row.addEventListener("click", () => this._pick(ent, false));
    row.addEventListener("contextmenu", (ev) => { ev.preventDefault(); this._pick(ent, true); });
    ent.fig = row;
    this._renderEntry(ent);
    return row;
  }

  _pick(ent, asB) {
    if (ent.state !== "ok") return;
    this.userPicked = true;
    if (asB) this.B = ent; else this.A = ent;
    this._syncSelects(); this.renderAll();
  }

  _computeMean(g) {
    const arr = g.items.map((e) => this.entries.get(e.key));
    const ok = arr.filter((x) => x.state === "ok");
    const m = g.meanEnt;
    if (!ok.length) { m.state = arr.some((x) => x.state === "loading") ? "loading" : "empty"; return; }
    const n = this.grid.n * this.grid.n, sum = new Float64Array(n), cnt = new Uint16Array(n);
    for (const x of ok) for (let k = 0; k < n; k++) { const v = x.arr[k] - (this.subI.checked ? x.med : 0); if (Number.isFinite(v)) { sum[k] += v; cnt[k]++; } }
    m.arr = Float32Array.from(sum, (s, k) => (cnt[k] ? s / cnt[k] : NaN));
    m.med = 0; m.baked = true; m.state = "ok";
    m.sub = `${ok.length} exposures averaged · ${Irsa.fmtDate(g.mjdMin)} → ${Irsa.fmtDate(g.mjdMax)}`;
  }

  _epochProgress(g) {
    const arr = g.items.map((e) => this.entries.get(e.key));
    const done = arr.filter((x) => x.state !== "loading").length;
    g.prog.textContent = done < arr.length ? `loading ${done}/${arr.length}…` : "";
    if (done === arr.length) { this._computeMean(g); this._renderEntry(g.meanEnt); }
  }

  // ---------- rendering ----------

  _display(ent) {
    if (ent.kind !== "arr" || !ent.arr) return null;
    if (ent.baked) return ent.arr;
    if (!this.subI.checked) return ent.arr;
    const m = ent.med, out = new Float32Array(ent.arr.length);
    for (let k = 0; k < out.length; k++) out[k] = ent.arr[k] - m;
    return out;
  }

  _updateLimits() {
    const pool = [];
    for (const ent of this.entries.values()) {
      if (ent.kind !== "arr" || ent.state !== "ok" || ent.epoch) continue;
      const d = this._display(ent);
      const stride = Math.max(1, Math.floor(d.length / 4000));
      for (let k = 0; k < d.length; k += stride) pool.push(d[k]);
    }
    this.limits = pool.length ? [quantile(pool, 0.02), quantile(pool, 0.995)] : null;
  }

  _limitsFor(arr) {
    if (this.sharedI.checked && this.limits) return this.limits;
    return [quantile(arr, 0.02), quantile(arr, 0.995)];
  }

  /** Entry (or a given array) -> something drawImage can draw, or null. */
  _raster(ent, arrOverride, cmapOverride) {
    if (ent && ent.kind === "img") return ent.bitmap || null;
    const arr = arrOverride || (ent && this._display(ent));
    if (!arr) return null;
    const n = this.grid.n;
    let lo, hi; const cmap = cmapOverride || this.cmapSel.value;
    if (cmapOverride === "div") { const a = quantile(Array.from(arr, Math.abs), 0.98) || 1; lo = -a; hi = a; }
    else [lo, hi] = this._limitsFor(arr);
    const c = this.off; c.width = c.height = n;
    c.getContext("2d").putImageData(new ImageData(colorize(arr, n, lo, hi, { stretch: this.stretchSel.value, cmap }), n, n), 0, 0);
    return c;
  }

  _renderEntry(ent) {
    if (ent.canvas) {
      const ctx = ent.canvas.getContext("2d"), n = ent.canvas.width;
      const src = ent.state === "ok" ? this._raster(ent) : null;
      if (src) { ctx.imageSmoothingEnabled = false; ctx.drawImage(src, 0, 0, n, n); } else { ctx.fillStyle = "#1a1318"; ctx.fillRect(0, 0, n, n); }
    }
    if (ent.fig) {
      ent.fig.classList.toggle("loading", ent.state === "loading");
      ent.fig.classList.toggle("bad", ent.state === "failed" || ent.state === "empty");
      ent.fig.classList.toggle("selA", this.A === ent);
      ent.fig.classList.toggle("selB", this.B === ent);
      ent.fig.title = ent.state === "failed" ? ent.error || "failed" : ent.state === "empty" ? "no data at this position in this exposure" : "";
    }
  }

  renderAll() {
    this._updateLimits();
    for (const ent of this.entries.values()) this._renderEntry(ent);
    this._drawStage();
  }

  // ---------- the stage ----------

  _label(parts, cls) {
    this.labelEl.className = "ix-label " + (cls || "");
    this.labelEl.textContent = "";
    this.labelEl.append(...parts.map((p, i) => { const s = el(i === 0 ? "b" : "span", null, p); return s; }));
  }

  _drawStage() {
    if (!this.grid) return;
    const ctx = this.stage.getContext("2d"), W = STAGE;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#120b0f"; ctx.fillRect(0, 0, W, W);
    this.stageArr = null;
    this.bandsBtn.classList.add("hidden");
    this.ringEl.style.display = this.mode === "curve" || this.mode === "bands" ? "none" : "";
    const blank = (msg) => { ctx.fillStyle = "#a8939b"; ctx.font = "15px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText(msg, W / 2, W / 2); ctx.textAlign = "left"; };

    if (this.mode === "blink") {
      const ent = this.A && this.B ? (this.showB ? this.B : this.A) : this.A;
      if (!ent) { blank(this.entries.size ? "Loading… pick epoch A and B above" : ""); this._label(["NO IMAGE"]); return; }
      const src = this._raster(ent);
      if (src) ctx.drawImage(src, 0, 0, W, W); else blank(ent.state === "loading" ? "Loading…" : "No data for this image");
      this.stageArr = ent.kind === "arr" ? this._display(ent) : null;
      const which = this.A && this.B ? (this.showB ? "B" : "A") : "A";
      this._label([`EPOCH ${which}`, ent.title, ent.sub], which === "B" ? "b" : "a");
    } else if (this.mode === "diff") {
      if (!(this.A && this.B)) { blank("Pick epoch A and epoch B to see A − B"); this._label(["DIFFERENCE"]); return; }
      if (this.A.kind !== "arr" || this.B.kind !== "arr") { blank("The mosaic is a picture. Pick two SPHEREx epochs or exposures."); this._label(["DIFFERENCE"]); return; }
      const a = this._display(this.A), b = this._display(this.B);
      const d = new Float32Array(a.length);
      for (let k = 0; k < d.length; k++) d[k] = a[k] - b[k];
      this.stageArr = d;
      ctx.drawImage(this._raster(null, d, "div"), 0, 0, W, W);
      this._label(["A − B", `${this.A.title}  minus  ${this.B.title}`, "blue = fainter in A · red = brighter in A"], "d");
    } else if (this.mode === "bands") this._drawBands(ctx, W, blank);
    else this._drawCurve(ctx, W, blank);
  }

  _drawBands(ctx, W, blank) {
    const g = this.epochs.find((e) => this.A && (this.A.epoch === e || this.A.g === e)) || this.epochs[0];
    this._label(["BANDS", g ? g.label : "no epoch loaded", "mean of each detector in this epoch"], "d");
    if (!g) { blank("Load epochs first"); return; }
    const cell = W / 3, y0 = (W - 2 * cell) / 2, n = this.grid.n, N = n * n;
    const ids = CONFIG.bands.filter((b) => b.id !== "color").map((b) => b.id);
    let have = 0;
    ids.forEach((id, i) => {
      const x = (i % 3) * cell, y = y0 + Math.floor(i / 3) * cell;
      const items = g.items.map((e) => this.entries.get(e.key)).filter((en) => en.state === "ok" && en.exp.band === id);
      ctx.fillStyle = "#1a1318"; ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);
      const b = CONFIG.bands.find((q) => q.id === id);
      if (items.length) {
        have++;
        const sum = new Float64Array(N), cnt = new Uint16Array(N);
        for (const en of items) for (let k = 0; k < N; k++) { const v = en.arr[k] - (this.subI.checked ? en.med : 0); if (Number.isFinite(v)) { sum[k] += v; cnt[k]++; } }
        const mean = Float32Array.from(sum, (s, k) => (cnt[k] ? s / cnt[k] : NaN));
        const [lo, hi] = [quantile(mean, 0.02), quantile(mean, 0.995)];
        const c = this.off; c.width = c.height = n;
        c.getContext("2d").putImageData(new ImageData(colorize(mean, n, lo, hi, { stretch: this.stretchSel.value, cmap: this.cmapSel.value }), n, n), 0, 0);
        ctx.drawImage(c, x + 2, y + 2, cell - 4, cell - 4);
      }
      ctx.fillStyle = "rgba(10,7,9,.7)"; ctx.fillRect(x + 2, y + cell - 24, cell - 4, 20);
      ctx.fillStyle = "#f1e8ea"; ctx.font = "12px system-ui, sans-serif";
      ctx.fillText(`${id} ${b ? b.range : ""}${items.length ? " · " + items.length + " exp" : " · not loaded"}`, x + 8, y + cell - 9);
    });
    if (have < 2) { this.bandsBtn.classList.remove("hidden"); }
  }

  _flux(ent) {
    const n = this.grid.n, c = n >> 1, d = this._display(ent);
    let s = 0, k = 0;
    for (let j = c - 1; j <= c + 1; j++) for (let i = c - 1; i <= c + 1; i++) { const v = d[j * n + i]; if (Number.isFinite(v)) { s += v; k++; } }
    return k ? s / k : NaN;
  }

  _drawCurve(ctx, W, blank) {
    this._label(["LIGHT CURVE", "central 3×3 pixels, one point per exposure", "click = A · shift-click = B"], "d");
    const pts = [];
    for (const g of this.epochs) for (const e of g.items) {
      const ent = this.entries.get(e.key);
      if (ent.state !== "ok") continue;
      const y = this._flux(ent); if (Number.isFinite(y)) pts.push({ ent, x: e.mjd, y, color: g.color });
    }
    this.curvePts = [];
    if (pts.length < 2) { blank("Need at least two loaded exposures"); return; }
    const L = 70, R = 24, T = 64, B = 70, w = W - L - R, h = W - T - B;
    let x0 = Math.min(...pts.map((p) => p.x)), x1 = Math.max(...pts.map((p) => p.x));
    let y0 = Math.min(...pts.map((p) => p.y)), y1 = Math.max(...pts.map((p) => p.y));
    if (x1 - x0 < 1) { x0 -= 1; x1 += 1; }
    const pad = (y1 - y0 || 1) * 0.1; y0 -= pad; y1 += pad;
    const X = (v) => L + ((v - x0) / (x1 - x0)) * w, Y = (v) => T + h - ((v - y0) / (y1 - y0)) * h;
    ctx.strokeStyle = "#3a2630"; ctx.fillStyle = "#a8939b"; ctx.font = "12px system-ui, sans-serif"; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const yv = y0 + ((y1 - y0) * i) / 4, yy = Y(yv);
      ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(L + w, yy); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(yv.toPrecision(3), L - 6, yy + 4);
      const xv = x0 + ((x1 - x0) * i) / 4, xx = X(xv);
      ctx.beginPath(); ctx.moveTo(xx, T); ctx.lineTo(xx, T + h); ctx.stroke();
      ctx.textAlign = "center"; ctx.fillText(Irsa.fmtDate(xv), xx, T + h + 18);
    }
    ctx.save(); ctx.translate(16, T + h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center";
    ctx.fillText(this.subI.checked ? "flux above image median (MJy/sr)" : "flux (MJy/sr)", 0, 0); ctx.restore();
    ctx.textAlign = "left";
    for (const p of pts) {
      const px = X(p.x), py = Y(p.y);
      this.curvePts.push({ px, py, ent: p.ent });
      ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.fill();
      for (const [sel, col] of [[this.A, "#f2557a"], [this.B, "#6fb7ff"]]) if (sel === p.ent) { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 9, 0, 7); ctx.stroke(); }
    }
    ctx.fillStyle = "#a8939b"; ctx.fillText("Each exposure samples a different wavelength, so scatter is not always variability.", L, W - 14);
  }

  _stageClick(ev) {
    if (this.mode !== "curve" || !this.curvePts.length) return;
    const r = this.stage.getBoundingClientRect(), k = STAGE / r.width;
    const x = (ev.clientX - r.left) * k, y = (ev.clientY - r.top) * k;
    let best = null, bd = 14 * 14;
    for (const p of this.curvePts) { const d = (p.px - x) ** 2 + (p.py - y) ** 2; if (d < bd) { bd = d; best = p; } }
    if (best) this._pick(best.ent, ev.shiftKey);
  }

  _readout(txt) { this.readEl.textContent = txt || "Hover the image for position and value."; }

  _hover(ev) {
    if (!this.grid || this.mode === "bands" || this.mode === "curve") return;
    const r = this.stage.getBoundingClientRect(), n = this.grid.n;
    const i = Math.floor(((ev.clientX - r.left) / r.width) * n), j = Math.floor(((ev.clientY - r.top) / r.height) * n);
    if (i < 0 || j < 0 || i >= n || j >= n) return;
    const [ra, dec] = gridToSky(this.grid, i + 0.5, j + 0.5);
    let txt = `RA ${ra.toFixed(4)}°   Dec ${dec.toFixed(4)}°   FOV ${this.grid.size}°`;
    if (this.stageArr) { const v = this.stageArr[j * n + i]; txt += Number.isFinite(v) ? `   value ${v.toPrecision(4)} MJy/sr` : "   no data"; }
    this._readout(txt);
  }
}