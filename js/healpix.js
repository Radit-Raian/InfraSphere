// HEALPix (nested scheme) helpers for the tile grid. This is the same tiling the SPHEREx HiPS maps use.
// No DOM, no network. All angles in degrees unless a name says otherwise.

const D2R = Math.PI / 180, R2D = 180 / Math.PI, PI = Math.PI;
const JRLL = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4];
const JPLL = [1, 3, 5, 7, 0, 2, 4, 6, 1, 3, 5, 7];

export const nsideOf = (order) => 2 ** order;
export const npixOf = (order) => 12 * 4 ** order;
/** Rough edge length of a tile in degrees. */
export const tileSizeDeg = (order) => Math.sqrt(41252.96 / npixOf(order));

// spread the bits of x into the even bit positions (and compact them again)
function spread(x) {
  let r = 0;
  for (let i = 0; i < 16; i++) r += ((x >> i) & 1) * 2 ** (2 * i);
  return r;
}
function compact(v) {
  let r = 0;
  for (let i = 0; i < 16; i++) r += (Math.floor(v / 2 ** (2 * i)) & 1) << i;
  return r;
}

/** RA/Dec (deg) -> nested pixel index at the given order. */
export function ang2pix(order, raDeg, decDeg) {
  const nside = 2 ** order;
  const z = Math.sin(decDeg * D2R), za = Math.abs(z);
  let phi = (raDeg * D2R) % (2 * PI);
  if (phi < 0) phi += 2 * PI;
  const tt = phi / (PI / 2);                       // in [0, 4)
  let face, ix, iy;
  if (za <= 2 / 3) {
    const t1 = nside * (0.5 + tt), t2 = nside * z * 0.75;
    const jp = Math.floor(t1 - t2), jm = Math.floor(t1 + t2);
    const ifp = Math.floor(jp / nside), ifm = Math.floor(jm / nside);
    face = ifp === ifm ? (ifp & 3) | 4 : ifp < ifm ? ifp & 3 : (ifm & 3) + 8;
    ix = jm & (nside - 1);
    iy = nside - (jp & (nside - 1)) - 1;
  } else {
    let ntt = Math.floor(tt); if (ntt >= 4) ntt = 3;
    const tp = tt - ntt, tmp = nside * Math.sqrt(3 * (1 - za));
    let jp = Math.floor(tp * tmp), jm = Math.floor((1 - tp) * tmp);
    jp = Math.min(jp, nside - 1); jm = Math.min(jm, nside - 1);
    if (z >= 0) { face = ntt; ix = nside - jm - 1; iy = nside - jp - 1; }
    else { face = ntt + 8; ix = jp; iy = jm; }
  }
  return face * nside * nside + spread(ix) + 2 * spread(iy);
}

/** Position on a face (fx, fy in 0..1 across the face, like healpix x/y) -> RA/Dec in degrees. */
function faceToAng(face, x, y) {
  let jr = JRLL[face] - x - y, nr, z;
  if (jr < 1) { nr = jr; z = 1 - (nr * nr) / 3; }
  else if (jr > 3) { nr = 4 - jr; z = (nr * nr) / 3 - 1; }
  else { nr = 1; z = (2 - jr) * 2 / 3; }
  let tmp = JPLL[face] * nr + x - y;
  if (tmp < 0) tmp += 8;
  if (tmp >= 8) tmp -= 8;
  const phi = nr < 1e-15 ? 0 : (PI / 4) * tmp / nr;
  return [phi * R2D, Math.asin(Math.max(-1, Math.min(1, z))) * R2D];
}

function pixToXYF(order, pix) {
  const nside = 2 ** order, per = nside * nside;
  const face = Math.floor(pix / per), ipf = pix - face * per;
  return { face, ix: compact(ipf), iy: compact(Math.floor(ipf / 2)), nside };
}

/** Centre of a tile -> [ra, dec] in degrees. */
export function pix2ang(order, pix) {
  const { face, ix, iy, nside } = pixToXYF(order, pix);
  return faceToAng(face, (ix + 0.5) / nside, (iy + 0.5) / nside);
}

/** Outline of a tile as [ra, dec] points (step points per side, so edges can be drawn as curves). */
export function boundary(order, pix, step = 1) {
  const { face, ix, iy, nside } = pixToXYF(order, pix);
  const pts = [];
  const c = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let s = 0; s < 4; s++) {
    const [ax, ay] = c[s], [bx, by] = c[(s + 1) % 4];
    for (let k = 0; k < step; k++) {
      const t = k / step;
      pts.push(faceToAng(face, (ix + ax + (bx - ax) * t) / nside, (iy + ay + (by - ay) * t) / nside));
    }
  }
  return pts;
}

/** "7/12345" */
export const tileName = (order, pix) => order + "/" + pix;

/** HiPS tile address used by the CDS servers, e.g. Norder7/Dir10000/Npix12345 */
export const hipsPath = (order, pix) => `Norder${order}/Dir${Math.floor(pix / 10000) * 10000}/Npix${pix}`;
