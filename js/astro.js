// Time, sidereal time and coordinate maths. No DOM, no network.
//
// Local frame used everywhere: vector = (north, east, up).
// Azimuth is measured from north through east.

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
const TWO_PI = 2 * Math.PI;

/** Local sidereal time in radians for a UTC time (ms since epoch) and east longitude (deg). */
export function lstRad(simMs, lonDeg) {
  const jd = simMs / 86400000 + 2440587.5;
  const d = jd - 2451545.0;
  const gmstDeg = 280.46061837 + 360.98564736629 * d;
  let lst = (gmstDeg + lonDeg) % 360;
  if (lst < 0) lst += 360;
  return lst * D2R;
}

/** RA/Dec (deg, J2000) -> unit vector (north, east, up) for an observer. */
export function eqToAltAzVec(raDeg, decDeg, latDeg, lst) {
  const dec = decDeg * D2R, lat = latDeg * D2R;
  const H = lst - raDeg * D2R;
  const xH = Math.cos(dec) * Math.cos(H);
  const yH = Math.cos(dec) * Math.sin(H);
  const zH = Math.sin(dec);
  const sl = Math.sin(lat), cl = Math.cos(lat);
  return [-xH * sl + zH * cl, -yH, xH * cl + zH * sl];
}

/** Unit vector (north, east, up) -> { ra, dec } in degrees. */
export function altAzVecToEq(v, latDeg, lst) {
  const lat = latDeg * D2R;
  const sl = Math.sin(lat), cl = Math.cos(lat);
  const xH = v[2] * cl - v[0] * sl;
  const yH = -v[1];
  const zH = v[2] * sl + v[0] * cl;
  const H = Math.atan2(yH, xH);
  let ra = (lst - H) % TWO_PI;
  if (ra < 0) ra += TWO_PI;
  return { ra: ra * R2D, dec: Math.asin(Math.max(-1, Math.min(1, zH))) * R2D };
}

/** Unit vector -> { az, alt } in radians. */
export function vecToAzAlt(v) {
  return { az: Math.atan2(v[1], v[0]), alt: Math.asin(Math.max(-1, Math.min(1, v[2]))) };
}

/** Angular separation of two RA/Dec points in degrees. */
export function angSepDeg(ra1, dec1, ra2, dec2) {
  const a = ra1 * D2R, b = dec1 * D2R, c = ra2 * D2R, d = dec2 * D2R;
  const x = Math.sin(b) * Math.sin(d) + Math.cos(b) * Math.cos(d) * Math.cos(a - c);
  return Math.acos(Math.max(-1, Math.min(1, x))) * R2D;
}

export const hms = (raDeg) => {
  const h = raDeg / 15, hh = Math.floor(h), m = (h - hh) * 60;
  return hh + "h " + m.toFixed(1) + "m";
};
export const dms = (decDeg) => {
  const sign = decDeg < 0 ? "-" : "+", a = Math.abs(decDeg), d = Math.floor(a);
  return sign + d + "° " + ((a - d) * 60).toFixed(0) + "′";
};
export const compass = (azDeg) =>
  ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((((azDeg % 360) + 360) % 360) / 45) % 8];
