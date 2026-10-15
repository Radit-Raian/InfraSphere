// Loads the SPHEREx sky for the renderer.
//  1) A small all-sky map arrives first, then sharper ones replace it.
//  2) When you zoom in and stop moving, a detailed patch of just that part of the sky is fetched.
// Both come from the CDS hips2fits service, which flattens the SPHEREx HiPS tiles on request.

import { CONFIG } from "./config.js";
import { angSepDeg } from "./astro.js";

export class SkyData {
  constructor(renderer, ui) {
    this.renderer = renderer;
    this.ui = ui;
    this.band = "color";
    this.cache = new Map();
    this.token = 0;
    this.ctl = null;
    this.patchCtl = null;
    this.patchBusy = false;
    this.lastCheck = 0;
    this.patch = { ra: 0, dec: 0, fov: 0 };
  }

  async _fetchImage(params, signal) {
    const res = await fetch(CONFIG.hips2fits + "?" + params.toString(), { signal, mode: "cors" });
    if (!res.ok) throw new Error("server answered " + res.status);
    return createImageBitmap(await res.blob());
  }

  _label(id) { return id === "color" ? "color composite" : id; }

  async loadBand(id, level) {
    this.band = id;
    if (this.ctl) this.ctl.abort();
    if (this.patchCtl) this.patchCtl.abort();
    this.renderer.clearPatch();
    this.ctl = new AbortController();
    const ctl = this.ctl, token = ++this.token;
    const sizes = (CONFIG.baseLevels[level] || CONFIG.baseLevels[2]).filter((w) => w <= this.renderer.maxTex);
    try {
      for (let i = 0; i < sizes.length; i++) {
        const width = sizes[i], key = id + ":" + width;
        let bmp = this.cache.get(key);
        if (!bmp) {
          this.ui.setBusy("sky", "Loading " + this._label(id) + " sky (" + width + " px)" + (i > 0 ? ", sharpening" : ""));
          bmp = await this._fetchImage(new URLSearchParams({
            hips: CONFIG.hipsRoot + id, width: String(width), height: String(width / 2),
            fov: "360", projection: "CAR", coordsys: "icrs", ra: "0", dec: "0", format: "jpg"
          }), ctl.signal);
          this.cache.set(key, bmp);
        }
        if (token !== this.token) return;
        this.renderer.setBase(bmp);
      }
      this.ui.setBusy("sky", "");
      this.lastCheck = 0;
    } catch (e) {
      if (e.name === "AbortError") return;
      this.ui.setBusy("sky", "");
      this.ui.say("Could not load the sky map (" + e.message + "). Check your connection, or load your own image under Troubleshooting.");
    }
  }

  /** Called every frame; does nothing unless the view is zoomed in and has been still for a moment. */
  async maybeSharpen({ now, idle, enabled, flip, view, centerEq }) {
    const P = CONFIG.patch;
    if (!enabled || flip || !this.renderer.hasSky || this.patchBusy || !idle) return;
    if (now - this.lastCheck < P.recheckMs) return;
    this.lastCheck = now;

    const D2R = Math.PI / 180;
    const aspect = Math.max(1, view.W / view.H);
    const need = (view.fov / D2R) * aspect * 1.2;          // degrees across the screen, with margin
    if (need > P.maxFovDeg) { this.renderer.clearPatch(); return; }
    if (this.renderer.hasPatch) {
      const sep = angSepDeg(centerEq.ra, centerEq.dec, this.patch.ra, this.patch.dec);
      if (this.patch.fov >= need * 0.9 && this.patch.fov <= need * 2.4 && sep <= this.patch.fov * 0.12) return;
    }

    const fovDeg = Math.max(need, 2);
    const bandAtStart = this.band;
    this.patchBusy = true;
    this.patchCtl = new AbortController();
    this.ui.setBusy("patch", "Sharpening this part of the sky");
    try {
      const bmp = await this._fetchImage(new URLSearchParams({
        hips: CONFIG.hipsRoot + this.band, width: String(P.size), height: String(P.size),
        fov: fovDeg.toFixed(3), projection: "TAN", coordsys: "icrs",
        ra: centerEq.ra.toFixed(5), dec: centerEq.dec.toFixed(5), format: "jpg"
      }), this.patchCtl.signal);
      if (bandAtStart === this.band) {
        this.patch = { ra: centerEq.ra, dec: centerEq.dec, fov: fovDeg };
        this.renderer.setPatch(bmp, this.patch);
      }
    } catch (e) {
      if (e.name !== "AbortError") this.ui.say("Sharpening failed (" + e.message + "). The base map still works.", 3500);
    } finally {
      this.patchBusy = false;
      this.ui.setBusy("patch", "");
    }
  }

  /** Use an image the user supplied (equirectangular, RA increasing to the left, north up). */
  useCustomImage(bitmap) {
    if (this.ctl) this.ctl.abort();
    this.renderer.clearPatch();
    this.renderer.setBase(bitmap);
  }
}
