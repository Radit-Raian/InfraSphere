// A small FITS reader and sky re-aligner, enough for SPHEREx spectral-image cutouts.
//  - readFitsImage: streams a multi-extension FITS file and stops after the first 2-D image extension
//    (a cutout also carries a ~5 MB PSF cube we never need, so we cancel the download once the image is in).
//  - makeWcs / reproject: each exposure has its own rotation, so every cutout is resampled onto one
//    north-up grid (east on the left, like the sky) so different dates line up pixel for pixel.
// No DOM needed, so it can be tested in Node.

const BLOCK = 2880;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

/** Parse one header starting at `offset` in `bytes`. Returns null if the END card is not in the bytes yet. */
export function parseHeader(bytes, offset = 0) {
  const cards = new Map();
  let pos = offset;
  while (pos + BLOCK <= bytes.length) {
    for (let c = 0; c < 36; c++) {
      let line = "";
      const base = pos + c * 80;
      for (let k = 0; k < 80; k++) line += String.fromCharCode(bytes[base + k]);
      const key = line.slice(0, 8).trim();
      if (key === "END") return { cards, end: pos + BLOCK };
      if (line[8] !== "=" || key === "HIERARCH" || key === "COMMENT" || key === "HISTORY") continue;
      let v = line.slice(10).trim();
      if (v[0] === "'") {
        let s = "", i = 1;
        while (i < v.length) {
          if (v[i] === "'") { if (v[i + 1] === "'") { s += "'"; i += 2; continue; } break; }
          s += v[i++];
        }
        cards.set(key, s.trimEnd());
      } else {
        const slash = v.indexOf("/");
        if (slash >= 0) v = v.slice(0, slash).trim();
        if (v === "T") cards.set(key, true);
        else if (v === "F") cards.set(key, false);
        else { const n = Number(v.replace(/[dD]/, "e")); cards.set(key, Number.isNaN(n) ? v : n); }
      }
    }
    pos += BLOCK;
  }
  return null;
}

const dataBytes = (h) => {
  const nax = h.get("NAXIS") || 0;
  if (!nax) return 0;
  let n = 1;
  for (let i = 1; i <= nax; i++) n *= h.get("NAXIS" + i) || 0;
  n = n * Math.abs(h.get("BITPIX") || 8) / 8 + (h.get("PCOUNT") || 0);
  return Math.ceil(n / BLOCK) * BLOCK;
};

function decodeImage(bytes, off, h) {
  const nx = h.get("NAXIS1"), ny = h.get("NAXIS2"), bp = h.get("BITPIX");
  const dv = new DataView(bytes.buffer, bytes.byteOffset + off, nx * ny * Math.abs(bp) / 8);
  const out = new Float32Array(nx * ny);
  const bs = h.get("BSCALE") ?? 1, bz = h.get("BZERO") ?? 0;
  const blank = h.get("BLANK");
  for (let i = 0; i < out.length; i++) {
    let v;
    if (bp === -32) v = dv.getFloat32(i * 4, false);
    else if (bp === -64) v = dv.getFloat64(i * 8, false);
    else if (bp === 16) v = dv.getInt16(i * 2, false);
    else if (bp === 32) v = dv.getInt32(i * 4, false);
    else if (bp === 8) v = dv.getUint8(i);
    else throw new Error("Unsupported FITS BITPIX " + bp);
    out[i] = blank !== undefined && v === blank ? NaN : v * bs + bz;
  }
  return { nx, ny, data: out };
}

/** Walk the HDUs in `bytes` and return the first 2-D image after the primary header, or null if more bytes are needed. */
function findImage(bytes) {
  let pos = 0;
  for (let hdu = 0; hdu < 6; hdu++) {
    const hd = parseHeader(bytes, pos);
    if (!hd) return null;
    const h = hd.cards, size = dataBytes(h);
    const isImage = hdu > 0 && (h.get("XTENSION") === "IMAGE" || h.get("XTENSION") === "'IMAGE'") && h.get("NAXIS") === 2;
    if (isImage || (hdu === 0 && h.get("NAXIS") === 2)) {
      if (bytes.length < hd.end + h.get("NAXIS1") * h.get("NAXIS2") * Math.abs(h.get("BITPIX")) / 8) return null;
      return { header: h, ...decodeImage(bytes, hd.end, h) };
    }
    pos = hd.end + size;
  }
  throw new Error("No image extension found in the FITS file");
}

/** Decode a FITS file already in memory (ArrayBuffer or Uint8Array). */
export function readFitsBuffer(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const r = findImage(bytes);
  if (!r) throw new Error("FITS file is truncated");
  return r;
}

/** Stream a fetch Response and stop downloading as soon as the first image extension is complete. */
export async function readFitsImage(response) {
  if (!response.body || !response.body.getReader) return readFitsBuffer(await response.arrayBuffer());
  const reader = response.body.getReader();
  let bytes = new Uint8Array(0);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) { const n = new Uint8Array(bytes.length + value.length); n.set(bytes); n.set(value, bytes.length); bytes = n; }
      const r = findImage(bytes);
      if (r) { reader.cancel().catch(() => {}); return r; }
      if (done) throw new Error("FITS file ended before the image was complete");
    }
  } catch (e) { reader.cancel().catch(() => {}); throw e; }
}

// ---------- WCS (TAN projection, linear terms) ----------

/** Build a pixel <-> sky converter from a FITS header (CRVAL/CRPIX and PC or CD matrix). SIP terms are ignored. */
export function makeWcs(h) {
  const g = (k, d) => (h.has(k) ? h.get(k) : d);
  let m;
  if (h.has("CD1_1")) m = [g("CD1_1", 0), g("CD1_2", 0), g("CD2_1", 0), g("CD2_2", 0)];
  else {
    const c1 = g("CDELT1", 1), c2 = g("CDELT2", 1);
    m = [g("PC1_1", 1) * c1, g("PC1_2", 0) * c1, g("PC2_1", 0) * c2, g("PC2_2", 1) * c2];
  }
  const det = m[0] * m[3] - m[1] * m[2];
  const inv = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
  const ra0 = g("CRVAL1", 0) * D2R, dec0 = g("CRVAL2", 0) * D2R;
  const cp1 = g("CRPIX1", 0), cp2 = g("CRPIX2", 0);
  const sd0 = Math.sin(dec0), cd0 = Math.cos(dec0);
  return {
    pixelScaleDeg: Math.sqrt(Math.abs(det)),
    /** FITS pixel (1-based x, y) -> [ra, dec] degrees */
    pixToSky(x, y) {
      const u = x - cp1, v = y - cp2;
      const xi = (m[0] * u + m[1] * v) * D2R, eta = (m[2] * u + m[3] * v) * D2R;
      const rho = Math.hypot(xi, eta), c = Math.atan(rho);
      if (rho < 1e-14) return [ra0 * R2D, dec0 * R2D];
      const dec = Math.asin(Math.cos(c) * sd0 + (eta * Math.sin(c) * cd0) / rho);
      const ra = ra0 + Math.atan2(xi * Math.sin(c), rho * cd0 * Math.cos(c) - eta * sd0 * Math.sin(c));
      return [((ra * R2D) % 360 + 360) % 360, dec * R2D];
    },
    /** [ra, dec] degrees -> FITS pixel (1-based) */
    skyToPix(raDeg, decDeg) {
      const ra = raDeg * D2R, dec = decDeg * D2R, dra = ra - ra0;
      const cosc = sd0 * Math.sin(dec) + cd0 * Math.cos(dec) * Math.cos(dra);
      if (cosc <= 1e-9) return null;
      const xi = (Math.cos(dec) * Math.sin(dra)) / cosc * R2D;
      const eta = (cd0 * Math.sin(dec) - sd0 * Math.cos(dec) * Math.cos(dra)) / cosc * R2D;
      return [cp1 + inv[0] * xi + inv[1] * eta, cp2 + inv[2] * xi + inv[3] * eta];
    }
  };
}

/** The output grid every image is resampled onto: north up, east left, centred on (ra, dec). */
export function makeGrid(raDeg, decDeg, sizeDeg, scaleDeg) {
  const n = Math.max(8, Math.round(sizeDeg / scaleDeg));
  return { ra: raDeg, dec: decDeg, n, scale: sizeDeg / n, size: sizeDeg };
}

/** Grid pixel (i right, j down, centres at integers + 0.5) -> [ra, dec]. */
export function gridToSky(grid, i, j) {
  const c = grid.n / 2;
  const xi = -(i - c) * grid.scale * D2R, eta = (c - j) * grid.scale * D2R;
  const ra0 = grid.ra * D2R, dec0 = grid.dec * D2R;
  const rho = Math.hypot(xi, eta), cc = Math.atan(rho);
  if (rho < 1e-14) return [grid.ra, grid.dec];
  const dec = Math.asin(Math.cos(cc) * Math.sin(dec0) + (eta * Math.sin(cc) * Math.cos(dec0)) / rho);
  const ra = ra0 + Math.atan2(xi * Math.sin(cc), rho * Math.cos(dec0) * Math.cos(cc) - eta * Math.sin(dec0) * Math.sin(cc));
  return [((ra * R2D) % 360 + 360) % 360, dec * R2D];
}

/** Resample a FITS image onto the grid (bilinear). Pixels the image does not cover, or bad pixels, become NaN. */
export function reproject(img, wcs, grid) {
  const { nx, ny, data } = img;
  const out = new Float32Array(grid.n * grid.n).fill(NaN);
  for (let j = 0; j < grid.n; j++) {
    for (let i = 0; i < grid.n; i++) {
      const [ra, dec] = gridToSky(grid, i + 0.5, j + 0.5);
      const p = wcs.skyToPix(ra, dec);
      if (!p) continue;
      const fx = p[0] - 1, fy = p[1] - 1;            // 0-based array coordinates
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= nx || y0 + 1 >= ny) continue;
      const tx = fx - x0, ty = fy - y0;
      const a = data[y0 * nx + x0], b = data[y0 * nx + x0 + 1], c = data[(y0 + 1) * nx + x0], d = data[(y0 + 1) * nx + x0 + 1];
      if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) continue;
      out[j * grid.n + i] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}

// ---------- statistics for display ----------

export function median(values) {
  const v = [];
  for (const x of values) if (Number.isFinite(x)) v.push(x);
  if (!v.length) return NaN;
  v.sort((a, b) => a - b);
  return v[v.length >> 1];
}
/** Value at quantile q (0..1) of the finite values. */
export function quantile(values, q) {
  const v = [];
  for (const x of values) if (Number.isFinite(x)) v.push(x);
  if (!v.length) return NaN;
  v.sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.max(0, Math.floor(q * (v.length - 1))))];
}
