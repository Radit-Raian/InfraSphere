// WISE time-series view: when a spot of the sky is clicked, show the WiseView (byw.tools) blink of unWISE / NEOWISE
// epochs for that exact target. It sits in the same card as the SIMBAD info (see #side in index.html).
// Only the image part of the WiseView page is shown: the page is loaded in a frame that is larger than the visible
// area and shifted, so the settings sidebar is cropped away (CONFIG.wise.crop).

import { CONFIG } from "./config.js";

/** WiseView address for a target. All settings come from CONFIG.wise, so the view opens ready to blink. */
export function wiseUrl(ra, dec, { size, zoom, base } = {}) {
  const w = CONFIG.wise;
  const r = ((Number(ra) % 360) + 360) % 360;
  const d = Math.max(-90, Math.min(90, Number(dec)));
  const parts = [`ra=${r.toFixed(6)}`, `dec=${d.toFixed(6)}`, `size=${Math.round(size || w.size)}`];
  for (const [k, v] of Object.entries({ ...w.params, ...(zoom ? { zoom } : {}) })) parts.push(`${k}=${v}`);
  return (base || w.base) + "#" + parts.join("&");
}

// Used when config.js has no wise.blink section (for example an older config.js is deployed).
const BLINK_DEFAULT = {
  cutout: "https://www.legacysurvey.org/viewer/cutout.jpg", px: 256, ms: 700,
  epochs: [
    { layer: "unwise-w1w2", label: "2010-11 (AllWISE)" },
    { layer: "unwise-neo1", label: "2014 (NEOWISE 1)" }, { layer: "unwise-neo2", label: "2015 (NEOWISE 2)" },
    { layer: "unwise-neo3", label: "2016 (NEOWISE 3)" }, { layer: "unwise-neo4", label: "2017 (NEOWISE 4)" },
    { layer: "unwise-neo5", label: "2018 (NEOWISE 5)" }, { layer: "unwise-neo6", label: "2019 (NEOWISE 6)" },
    { layer: "unwise-neo7", label: "2020 (NEOWISE 7)" }
  ]
};

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

// Optional quick calibration of the crop from the address bar: ?wisecrop=x,y,w,h
function cropFromQuery() {
  try {
    const v = new URLSearchParams(location.search).get("wisecrop");
    if (!v) return null;
    const [x, y, w, h] = v.split(",").map(Number);
    return [x, y, w, h].every(Number.isFinite) ? { x, y, w, h } : null;
  } catch { return null; }
}

export class WisePanel {
  constructor(ui) {
    this.ui = ui;
    this.target = null;
    this.full = false;
    this.root = document.getElementById("wise");
    if (!this.root) {
      this.root = el("aside"); this.root.id = "wise"; this.root.className = "hidden";
      (document.getElementById("side") || document.body).appendChild(this.root);
    }
    this._build();
    window.addEventListener("resize", () => { if (this.isOpen) this._layout(); });
    window.addEventListener("keydown", (e) => { if (e.key === "Escape" && this.isOpen) this.close(); });
  }

  get isOpen() { return !this.root.classList.contains("hidden"); }

  _build() {
    const r = this.root;
    r.innerHTML = "";
    const tools = el("div", "wise-tools");
    this.fullBtn = el("button", "btn", "Full page");
    this.fullBtn.title = "Show the whole WiseView page instead of just the image";
    this.fullBtn.addEventListener("click", () => { this.full = !this.full; this._layout(); });
    this.tabLink = el("a", "btn", "New tab");
    this.tabLink.target = "_blank"; this.tabLink.rel = "noopener";
    const x = el("button", "btn close", "×"); x.setAttribute("aria-label", "Close WISE view");
    x.addEventListener("click", () => this.close());
    tools.append(this.fullBtn, this.tabLink, x);
    this.view = el("div", "wise-view");
    r.append(tools, this.view);
  }

  /** Size and offset the frame so only the crop rectangle of the WiseView page is visible. */
  _layout() {
    const w = CONFIG.wise;
    const c = cropFromQuery() || w.crop;
    const f = w.frame;
    this.root.classList.toggle("full", this.full);          // the side panel widens in full-page mode, so measure after this
    const side = document.getElementById("side");
    const availW = Math.max(200, (side ? side.clientWidth : 380) - 30);
    const k = Math.min(1, availW / c.w);                    // scale the crop down to the panel width; the panel scrolls vertically
    if (this.full) {
      this.view.style.width = Math.min(f.w, availW) + "px";
      this.view.style.height = Math.min(f.h, Math.max(300, window.innerHeight - 260)) + "px";
    } else {
      this.view.style.width = Math.round(c.w * k) + "px";
      this.view.style.height = Math.round(c.h * k) + "px";
    }
    const fr = this.frameEl;
    if (fr) {
      fr.style.width = f.w + "px"; fr.style.height = f.h + "px";
      fr.style.transformOrigin = "0 0";
      fr.style.transform = this.full ? "none" : `scale(${k}) translate(${-c.x}px, ${-c.y}px)`;
    }
    this.fullBtn.textContent = this.full ? "Image only" : "Full page";
  }

  /** Show the WISE epochs for a target: { ra, dec (deg), name?, group? }. A new frame is made every time,
   *  because WiseView only reads its address when the page loads. */
  /** Never throws: a problem here must not stop the SIMBAD lookup that called it. */
  open(target) {
    try { this._open(target); }
    catch (e) { console.error("WISE panel failed", e); try { this.root.classList.add("hidden"); } catch (_) { /* nothing */ } }
  }

  _open({ ra, dec, name, group }) {
    if (!CONFIG.wise.enabled || !Number.isFinite(ra) || !Number.isFinite(dec)) return;
    const deep = group === "galaxy" || group === "nebula" || group === "cluster";
    const w = CONFIG.wise, secure = location.protocol === "https:";
    // An https page cannot show an http frame (the browser blocks it). On https use w.secureBase if there is one.
    const base = secure ? (w.secureBase || "") : w.base;
    const opts = deep ? { size: w.deepSkySize, zoom: w.zoom.deep } : { size: w.size, zoom: w.zoom.star };
    const url = wiseUrl(ra, dec, { ...opts, base: base || w.base });
    this.target = { ra, dec, name, url };
    this.tabLink.href = url;       // a new tab is a normal page visit, so plain http is fine there
    this.tabLink.title = "Open WiseView for " + (name || "this position") + " in a new tab";
    this.view.innerHTML = "";
    this.frameEl = null;
    this._stopBlink();
    this._stopBlink();
    if (!base) { this._openBlink(ra, dec, deep, name, url); return; }
    const fr = document.createElement("iframe");
    fr.title = "WISE epochs" + (name ? " for " + name : ""); fr.loading = "eager"; fr.referrerPolicy = "no-referrer";
    fr.src = url;
    this.frameEl = fr;
    this.view.appendChild(fr);
    this.root.classList.remove("hidden");
    this._layout();
  }

  /** WiseView itself cannot be framed on an https page, so blink the unWISE epoch coadds (AllWISE, then one per NEOWISE year)
   *  from the Legacy Surveys cutout service, which is https and works in plain <img> tags. */
  _openBlink(ra, dec, deep, name, tabUrl) {
    const w = CONFIG.wise, B = { ...BLINK_DEFAULT, ...(w.blink || {}) };
    const arcsec = deep ? w.deepSkySize : w.size, N = B.px;
    const frames = B.epochs.map((e) => ({
      ...e,
      src: `${B.cutout}?ra=${Number(ra).toFixed(6)}&dec=${Number(dec).toFixed(6)}&layer=${e.layer}&pixscale=${(arcsec / N).toFixed(4)}&size=${N}`,
      ok: null, img: new Image()
    }));
    const box = el("div", "wise-blink");
    const pic = el("img"); pic.alt = "WISE epochs"; pic.decoding = "async";
    const ring = el("div", "wise-ring");
    const lab = el("div", "wise-label", "Loading epochs…");
    const note = el("div", "wise-note");
    box.append(pic, ring, lab);
    this.view.append(box);
    this.root.classList.remove("hidden");
    this._layout();
    this.blink = { frames, pic, lab, i: -1, paused: false };
    box.addEventListener("click", () => { if (this.blink) { this.blink.paused = !this.blink.paused; lab.dataset.p = this.blink.paused ? "1" : ""; } });
    let pending = frames.length;
    const done = () => {
      if (--pending > 0) return;
      const ok = frames.filter((f) => f.ok);
      if (ok.length < 2) {
        lab.textContent = ok.length ? "Only one epoch available here" : "No WISE images could be loaded. Use New tab.";
        if (ok.length) { pic.src = ok[0].src; }
      }
    };
    for (const f of frames) {
      f.img.onload = () => { f.ok = true; if (this.blink && this.blink.frames === frames && this.blink.i < 0) this._tick(); done(); };
      f.img.onerror = () => { f.ok = false; done(); };
      f.img.src = f.src;
    }
    this.blinkTimer = setInterval(() => { if (this.blink && !this.blink.paused) this._tick(); }, B.ms);
  }

  _tick() {
    const b = this.blink; if (!b) return;
    const ok = b.frames.filter((f) => f.ok);
    if (!ok.length) return;
    b.i = (b.i + 1) % ok.length;
    const f = ok[b.i];
    b.pic.src = f.src;
    b.lab.textContent = f.label + (b.paused ? " (paused)" : "") + "  ·  click to pause";
  }

  _stopBlink() { clearInterval(this.blinkTimer); this.blinkTimer = null; this.blink = null; }

  /** Update the name only (the frame is not reloaded). */
  rename(name) { if (this.target) { this.target.name = name; this.tabLink.title = "Open WiseView for " + name + " in a new tab"; } }

  close() {
    this._stopBlink();
    this.root.classList.add("hidden");
    this.view.innerHTML = "";
    this.frameEl = null;
  }
}