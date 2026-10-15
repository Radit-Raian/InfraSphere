// Keeps the label layer supplied with objects from SIMBAD for whatever part of the sky is on screen.
// It waits until the view is still, asks SIMBAD only for areas it has not already covered,
// and asks for fainter objects as you zoom in.

import { CONFIG } from "./config.js";
import { D2R, R2D, angSepDeg } from "./astro.js";
import * as Simbad from "./simbad.js";

/** Faintest V magnitude to request for a given vertical field of view (degrees). */
export function magLimitForFov(fovDeg) {
  if (fovDeg > 70) return 3.6;
  if (fovDeg > 40) return 5;
  if (fovDeg > 20) return 6.5;
  if (fovDeg > 10) return 8;
  if (fovDeg > 5) return 9.5;
  return 11.5;
}

export class LabelFeed {
  constructor(layer, ui) {
    this.layer = layer;
    this.ui = ui;
    this.coverage = [];       // areas already requested: { ra, dec, radius, mag, full }
    this.busy = false;
    this.lastCheck = 0;
    this.failedAt = -Infinity;
    this.errorShown = false;
  }

  _isCovered(ra, dec, radius, mag) {
    return this.coverage.some((c) => c.mag >= mag && (c.full || angSepDeg(c.ra, c.dec, ra, dec) + radius <= c.radius));
  }

  async maybeUpdate({ now, idle, enabled, view, centerEq }) {
    const L = CONFIG.labels;
    if (!enabled || !idle || this.busy) return;
    if (now - this.lastCheck < L.recheckMs || now - this.failedAt < L.backoffMs) return;
    this.lastCheck = now;

    const mag = magLimitForFov(view.fov * R2D);
    const corner = view.angleBetweenPixels(view.W / 2, view.H / 2, 0, 0) * R2D;
    let radius = Math.min(Math.max(corner * 1.05, 0.05), 90);
    const full = radius > 55;                       // wide view: ask for the whole sky once
    const ra = centerEq.ra, dec = centerEq.dec;
    if (full) radius = 180;
    if (this._isCovered(ra, dec, radius, mag)) return;

    this.busy = true;
    this.ui.setBusy("simbad", "Looking up objects in SIMBAD");
    try {
      const args = { ra, dec, radius, magLimit: mag };
      const [stars, deep] = await Promise.all([
        Simbad.fetchStars({ ...args, top: L.topStars }),
        Simbad.fetchDeepSky({ ...args, top: L.topDeepSky })
      ]);
      this.layer.add([...stars, ...deep]);
      this.coverage.push({ ra, dec, radius, mag, full });
      this.errorShown = false;

      // Familiar names (Sirius, Vega ...) for the brightest stars that do not have one yet.
      const wanted = stars.filter((s) => s.V !== null && s.V < 4 && !this.layer.objs.get(s.oid)?.name).map((s) => s.oid).slice(0, 80);
      if (wanted.length) {
        try { this.layer.setNames(await Simbad.fetchCommonNames(wanted)); } catch (_) { /* names are optional */ }
      }
    } catch (e) {
      this.failedAt = now;
      if (!this.errorShown) {
        this.errorShown = true;
        this.ui.say("SIMBAD labels are unavailable right now (" + e.message + "). The sky still works.", 9000);
      }
    } finally {
      this.busy = false;
      this.ui.setBusy("simbad", "");
    }
  }
}
