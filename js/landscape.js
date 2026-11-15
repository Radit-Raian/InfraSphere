// The horizon: hazy far hills, and a near ridge of rolling hills with big rounded tree crowns and a few pointed pines,
// drawn black against the sky like Stellarium's landscape. The same formulas are written in GLSL in sky-renderer.js
// (keep them in sync). Having them here too lets the overlay canvas (stars, labels, asteroids) hide anything that sits
// behind the hills and trees, so nothing floats over the silhouette.
// u is azimuth / 360 deg (north = 0, east = 0.25). All heights are altitudes in radians. No DOM.

const TAU = 2 * Math.PI;
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/** PCG integer hash -> 0..1. Integer maths, so the GPU and this copy agree exactly. */
export function hash(n) {
  let x = n >>> 0;
  x = (Math.imul(x, 747796405) + 2891336453) >>> 0;
  x = Math.imul(((x >>> ((x >>> 28) + 4)) ^ x) >>> 0, 277803737) >>> 0;
  x = ((x >>> 22) ^ x) >>> 0;
  return (x & 0xFFFF) / 65535;
}

/** Smooth 1-D value noise, 0..1. */
function vnoise(x) {
  const i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
  return hash(i) * (1 - s) + hash(i + 1) * s;
}

/** One tree in each of N cells round the horizon. Its height, width and position in the cell come from the hash; the crown is
 *  a scalloped dome, or (one in five) a pointed pine. Returns the height at u (0 between trees). */
function treeLayer(u, N, salt, hMin, hMax, wMin, wMax) {
  const t = u * N, cell = Math.floor(t), f = t - cell;
  const h1 = hash(cell * 7 + salt), h2 = hash(cell * 7 + salt + 1), h3 = hash(cell * 7 + salt + 2);
  const w = wMin + (wMax - wMin) * h2, c = 0.5 + (1 - w) * (h3 - 0.5);
  const x = (f - c) / (0.5 * w);
  if (Math.abs(x) >= 1) return 0;
  const H = hMin + (hMax - hMin) * h1;
  const dome = Math.sqrt(1 - x * x) * (0.88 + 0.12 * Math.cos(x * 9 + h3 * 6.2832));
  return H * (h3 > 0.8 ? 1 - Math.abs(x) : dome);
}

/** Smooth ground line of the near hills (about 1 to 4 degrees). */
export function hillRidge(u) {
  return Math.max(0.020 + 0.012 * Math.sin(TAU * 2 * u + 1.3) + 0.008 * Math.sin(TAU * 5 * u + 0.4) + 0.004 * Math.sin(TAU * 11 * u + 2.0)
    + 0.020 * Math.pow(Math.max(Math.sin(TAU * u + 0.5), 0), 3), 0);
}

/** Tree tops above the hill line: big trees (3 to 6 degrees) in some directions, small ones (1 to 2 degrees) in others. */
export function treeHeight(u) {
  const uu = u - Math.floor(u);
  const z1 = smoothstep(0.2, 0.6, 0.5 + 0.5 * Math.sin(TAU * 3 * u + 0.9));
  const z2 = smoothstep(0.3, 0.7, 0.5 + 0.5 * Math.sin(TAU * 2 * u + 3.1));
  const h = Math.max(z1 * treeLayer(uu, 22, 11, 0.045, 0.105, 0.6, 0.98), z2 * treeLayer(uu, 71, 53, 0.014, 0.038, 0.7, 1.0));
  return h > 0 ? h * (0.94 + 0.12 * vnoise(uu * 600)) : 0;       // a little ragged at the edge
}

/** Near ridge: hills plus trees. */
export function frontHorizon(u) { return hillRidge(u) + treeHeight(u); }

/** Far ridge: higher and smoother, drawn in a hazy colour behind the near one. */
export function farHorizon(u) {
  return Math.max(0.050 + 0.030 * Math.sin(TAU * u + 4.0) + 0.016 * Math.sin(TAU * 3 * u + 0.2) + 0.008 * Math.sin(TAU * 7 * u + 1.0) + 0.004 * Math.sin(TAU * 19 * u), 0);
}

// sin(altitude) of the highest ridge, sampled once round the horizon so the per-star test is a table lookup.
const SAMPLES = 16384;
let table = null;
function build() {
  table = new Float32Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) { const u = i / SAMPLES; table[i] = Math.sin(Math.max(frontHorizon(u), farHorizon(u))); }
}

/** sin(altitude) of the highest ridge in the direction (north, east). A point is hidden if its "up" is below this. */
export function horizonSin(north, east) {
  if (!table) build();
  let u = Math.atan2(east, north) / TAU; u -= Math.floor(u);
  const i = Math.floor(u * SAMPLES);
  return Math.max(table[i], table[(i + 1) % SAMPLES]);
}