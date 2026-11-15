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
  open({ ra, dec, name, group }) {
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
    if (!base) {
      const p = el("div", "wise-blocked");
      p.append(el("p", "note", "WiseView is only available over plain http, and browsers block that inside an https page."));
      const a = el("a", "btn primary", "Open WiseView in a new tab");
      a.href = url; a.target = "_blank"; a.rel = "noopener";
      p.append(a);
      this.view.appendChild(p);
      this.root.classList.remove("hidden");
      this._layout();
      return;
    }
    const fr = document.createElement("iframe");
    fr.title = "WISE epochs" + (name ? " for " + name : ""); fr.loading = "eager"; fr.referrerPolicy = "no-referrer";
    fr.src = url;
    this.frameEl = fr;
    this.view.appendChild(fr);
    this.root.classList.remove("hidden");
    this._layout();
  }

  /** Update the name only (the frame is not reloaded). */
  rename(name) { if (this.target) { this.target.name = name; this.tabLink.title = "Open WiseView for " + name + " in a new tab"; } }

  close() {
    this.root.classList.add("hidden");
    this.view.innerHTML = "";
    this.frameEl = null;
  }
}