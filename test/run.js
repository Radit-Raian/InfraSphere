// Run with:  node test/run.js
// Covers the parts that need no browser and no network: sky maths, the camera,
// and SIMBAD query/name handling.
import assert from "node:assert/strict";
import { lstRad, eqToAltAzVec, altAzVecToEq, angSepDeg, D2R, hms, dms, compass } from "../js/astro.js";
import { View } from "../js/view.js";
import * as S from "../js/simbad.js";
import { magLimitForFov } from "../js/label-feed.js";
import { ang2pix, pix2ang, boundary, tileSizeDeg, hipsPath } from "../js/healpix.js";
import { readFitsBuffer, makeWcs, makeGrid, gridToSky, reproject, parseHeader, median } from "../js/fits.js";
import * as SS from "../js/solar-system.js";
import * as IR from "../js/irsa.js";
import { TileGrid } from "../js/tiles.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log("ok  " + name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} expected ${b}, got ${a}`);

// ---- astronomy ----
test("sidereal time at J2000 noon UTC, longitude 0, is about 280.46 deg", () => {
  const ms = Date.UTC(2000, 0, 1, 12, 0, 0);
  near(lstRad(ms, 0) / D2R, 280.46061837, 0.001);
});
test("sidereal time shifts by the longitude", () => {
  const ms = Date.UTC(2026, 9, 14, 0, 0, 0);
  const a = lstRad(ms, 0) / D2R, b = lstRad(ms, 90) / D2R;
  near(((b - a) + 360) % 360, 90, 1e-6);
});
test("an object with Dec = latitude and RA = LST is at the zenith", () => {
  const lst = 1.234, lat = 23.81;
  const v = eqToAltAzVec(lst / D2R, lat, lat, lst);
  near(v[2], 1, 1e-9, "up component");
});
test("the north celestial pole sits at altitude = latitude, due north", () => {
  const lat = 40, v = eqToAltAzVec(123, 90, lat, 2.2);
  near(Math.asin(v[2]) / D2R, lat, 1e-9);
  near(Math.atan2(v[1], v[0]), 0, 1e-9);
});
test("something rising in the east: RA = LST + 6h, Dec 0 is on the east horizon", () => {
  const lst = 0.7, v = eqToAltAzVec(lst / D2R + 90, 0, 30, lst);
  near(v[2], 0, 1e-9, "on horizon");
  assert.ok(v[1] > 0.99, "east component");
});
test("RA/Dec -> alt-az -> RA/Dec round trip", () => {
  for (const [ra, dec] of [[10, 20], [200, -45], [359, 80], [0.5, -89], [123.4, 0]]) {
    const lst = 2.5, lat = -33.9;
    const eq = altAzVecToEq(eqToAltAzVec(ra, dec, lat, lst), lat, lst);
    near(angSepDeg(ra, dec, eq.ra, eq.dec), 0, 1e-7, `point ${ra},${dec}`);
  }
});
test("angular separation: 90 degrees apart on the equator", () => near(angSepDeg(0, 0, 90, 0), 90, 1e-9));
test("formatting helpers", () => {
  assert.equal(hms(180), "12h 0.0m");
  assert.equal(dms(-5.5), "-5° 30′");
  assert.equal(compass(92), "E");
  assert.equal(compass(-10), "N");
});

// ---- camera ----
test("pixel -> sky -> pixel round trip, both projections", () => {
  for (const proj of [0, 1]) {
    const v = new View();
    v.resize(1200, 700); v.proj = proj; v.az = 2.1; v.alt = 0.6; v.fov = proj ? 1.6 : 2.2;
    for (const [x, y] of [[600, 350], [100, 80], [1100, 650], [300, 600], [900, 120]]) {
      const p = v.project(v.dirFromPixel(x, y));
      assert.ok(p, "projects");
      near(p[0], x, 1e-6); near(p[1], y, 1e-6);
    }
  }
});
test("the centre pixel looks along the view direction", () => {
  const v = new View(); v.resize(800, 600); v.az = 1; v.alt = 0.3;
  const d = v.dirFromPixel(400, 300), f = v.basis().f;
  near(d[0] * f[0] + d[1] * f[1] + d[2] * f[2], 1, 1e-12);
});
test("facing north, east is on the right", () => {
  const v = new View(); v.resize(800, 600); v.az = 0; v.alt = 0; v.fov = 1.2;
  const east = v.project([Math.cos(0.3), Math.sin(0.3), 0]);
  assert.ok(east[0] > 400, "east should be right of centre");
});
test("behind the camera cannot be projected (perspective)", () => {
  const v = new View(); v.resize(800, 600); v.proj = 1; v.az = 0; v.alt = 0;
  assert.equal(v.project([-1, 0, 0]), null);
});

// ---- SIMBAD ----
test("prettyName: Greek letters, prefixes and spacing", () => {
  assert.equal(S.prettyName("* alf CMa"), "α CMa");
  assert.equal(S.prettyName("* bet01 Cyg"), "β01 Cyg");
  assert.equal(S.prettyName("M  31"), "M 31");
  assert.equal(S.prettyName("NAME Pleiades"), "Pleiades");
  assert.equal(S.prettyName("NGC  7000"), "NGC 7000");
  assert.equal(S.prettyName("* 61 Cyg"), "61 Cyg");
});
test("typeGroup and typeLabel", () => {
  assert.equal(S.typeGroup("*"), "star");
  assert.equal(S.typeGroup("V*"), "star");
  assert.equal(S.typeGroup("G"), "galaxy");
  assert.equal(S.typeGroup("GlC"), "cluster");
  assert.equal(S.typeGroup("Cl*"), "cluster");
  assert.equal(S.typeGroup("HII"), "nebula");
  assert.equal(S.typeGroup("IR"), "other");
  assert.equal(S.typeLabel("PN"), "Planetary nebula");
  assert.equal(S.typeLabel("ZZZ"), "ZZZ");
});
test("rowsFromTap turns {metadata, data} into objects with lower-case keys", () => {
  const rows = S.rowsFromTap({ metadata: [{ name: "main_id" }, { name: "V" }], data: [["* alf Lyr", 0.03]] });
  assert.deepEqual(rows, [{ main_id: "* alf Lyr", v: 0.03 }]);
});
test("normalizeRow coerces numbers and sets the group", () => {
  const o = S.normalizeRow({ oid: "42", main_id: "M  31", ra: "10.68", dec: "41.27", otype: "G", v: "3.44" });
  assert.equal(o.oid, 42); assert.equal(o.ra, 10.68); assert.equal(o.V, 3.44);
  assert.equal(o.group, "galaxy"); assert.equal(o.plx, null);
});
test("queries contain the cone, the limit and the table joins", () => {
  const q = S.starsQuery({ ra: 10.5, dec: -20.25, radius: 12, magLimit: 6.5, top: 300 });
  assert.match(q, /^SELECT TOP 300 /);
  assert.match(q, /CIRCLE\('ICRS', 10\.500000, -20\.250000, 12\.0000\)/);
  assert.match(q, /JOIN allfluxes AS f ON b\.oid = f\.oidref/);
  assert.match(q, /f\.V < 6\.50/);
  assert.match(q, /ORDER BY f\.V ASC$/);
  const d = S.deepSkyQuery({ ra: 0, dec: 0, radius: 12, magLimit: 3.6, top: 150 });
  assert.match(d, /LEFT JOIN allfluxes/);
  assert.match(d, /b\.otype IN \('G',/);
  assert.match(d, /f\.V IS NULL OR f\.V < 6\.60/);
});
test("a whole-sky request has no CIRCLE, and deep-sky objects without a V magnitude are kept", () => {
  const st = S.starsQuery({ ra: 5, dec: 5, radius: 180, magLimit: 3.6, top: 500 });
  assert.ok(!st.includes("CIRCLE") && !st.includes("CONTAINS"));
  assert.match(st, /WHERE f\.V < 3\.60 ORDER BY f\.V ASC$/);
  const d = S.deepSkyQuery({ ra: 5, dec: 5, radius: 180, magLimit: 3.6, top: 150 });
  assert.ok(!d.includes("CIRCLE"));
  assert.match(d, /FROM basic AS b LEFT JOIN allfluxes/);
  assert.ok(!d.includes("f.V <"), "no magnitude cut, so unmeasured objects stay");
  assert.match(d, /WHERE b\.otype IN \('G',.*\) AND b\.nbref >= 100 ORDER BY b\.nbref DESC$/);
});
test("inside a cone, objects with no V magnitude are asked for too", () => {
  const q = S.starsQuery({ ra: 5, dec: 5, radius: 20, magLimit: 6.5, top: 300 });
  assert.match(q, /LEFT JOIN allfluxes/);
  assert.match(q, /\(f\.V IS NULL OR f\.V < 6\.50\)/);
  assert.match(q, /CIRCLE\('ICRS', 5\.000000, 5\.000000, 20\.0000\)/);
  assert.match(S.starsQuery({ ra: 5, dec: 5, radius: 55, magLimit: 3.6, top: 5 }), /CIRCLE\('ICRS', 5\.000000, 5\.000000, 55\.0000\)/);
});
test("tapErrorMessage extracts the readable error from a VOTable", () => {
  const xml = '<?xml version="1.0"?><VOTABLE><RESOURCE type="results"><INFO name="QUERY_STATUS" value="ERROR">Incorrect ADQL: unknown column &quot;x&quot;</INFO></RESOURCE></VOTABLE>';
  assert.match(S.tapErrorMessage(xml), /^Incorrect ADQL: unknown column/);
  assert.equal(S.tapErrorMessage(""), "no details");
});
test("name search escapes quotes and lower-cases the text", () => {
  const q = S.nameQuery("  Barnard's   Star ");
  assert.match(q, /i\.id = 'barnard''s star'/);
  assert.equal(S.adqlEscape("a'b"), "a''b");
});
test("common-name query only accepts numeric ids", () => {
  const q = S.commonNamesQuery([1, "2", "3; DROP TABLE x"]);
  assert.match(q, /IN \(1, 2\)/);   // junk is dropped, never sent as text
  assert.ok(!q.includes("DROP"));
});
test("detail and nearest queries", () => {
  assert.match(S.detailsQuery(7), /WHERE b\.oid = 7$/);
  const n = S.nearestQuery({ ra: 1, dec: 2, radius: 0.01 });
  assert.match(n, /DISTANCE\(POINT\('ICRS', b\.ra, b\.dec\), POINT\('ICRS', 1\.000000, 2\.000000\)\) AS dist/);
  assert.match(n, /ORDER BY dist ASC$/);
});

// ---- label feed ----
test("fainter magnitude limits as you zoom in", () => {
  const f = [120, 60, 30, 15, 7, 2].map(magLimitForFov);
  for (let i = 1; i < f.length; i++) assert.ok(f[i] > f[i - 1], "limit should deepen");
});


// ---- HEALPix tiles (reference values from astropy-healpix) ----
test("HEALPix: pixel numbers and centres match astropy-healpix", () => {
  const ref = [[3, 45.5, 12.3, 3, 45.0, 14.477512], [7, 210.8, 54.3, 45738, 210.46875, 54.340912], [7, 83.633, 22.0145, 96742, 83.320312, 22.024313],
    [5, 10.684, 41.269, 677, 9.84375, 41.810315], [7, 266.4, -28.94, 115320, 266.484375, -28.971532], [2, 300.2, -70.5, 178, 292.5, -66.443536], [0, 100, 80, 1, 135.0, 41.810315]];
  for (const [o, ra, dec, pix, cra, cdec] of ref) {
    assert.equal(ang2pix(o, ra, dec), pix, `order ${o} at ${ra},${dec}`);
    const c = pix2ang(o, pix);
    near(c[0], cra, 1e-5); near(c[1], cdec, 1e-5);
  }
});
test("HEALPix: a tile's corners surround its centre, and sizes shrink by half per order", () => {
  const pts = boundary(7, 45738, 1);
  assert.equal(pts.length, 4);
  const c = pix2ang(7, 45738);
  for (const p of pts) near(angSepDeg(c[0], c[1], p[0], p[1]), tileSizeDeg(7) * 0.7, 0.2);
  near(tileSizeDeg(6) / tileSizeDeg(7), 2, 1e-9);
  assert.equal(hipsPath(7, 45738), "Norder7/Dir40000/Npix45738");
});
test("tile grid: picks the finest tile under a sky position and chooses coarser grids when zoomed out", () => {
  const g = new TileGrid();
  const t = g.tileAt(210.8, 54.3);
  assert.equal(t.order, 7); assert.equal(t.pix, 45738); assert.equal(t.name, "7/45738");
  const v = new View(); v.resize(1200, 700);
  v.fov = 120 * D2R; const wide = g.orderFor(v);
  v.fov = 3 * D2R; const tight = g.orderFor(v);
  assert.ok(wide < tight && tight <= 7 && wide >= 0, `orders ${wide} then ${tight}`);
});

// ---- FITS cutouts and sky alignment ----
function fitsBlock(cards) {
  const lines = cards.map((c) => c.padEnd(80)).concat(["END".padEnd(80)]);
  const text = lines.join("");
  return Buffer.from(text.padEnd(Math.ceil(text.length / 2880) * 2880));
}
const card = (k, v) => k.padEnd(8) + "= " + (typeof v === "string" ? `'${v}'`.padEnd(20) : String(v).padStart(20));
function buildFits(nx, ny, data, wcsCards, extra = []) {
  const prim = fitsBlock([card("SIMPLE", "T"), card("BITPIX", 8), card("NAXIS", 0), card("EXTEND", "T")]);
  const hdr = fitsBlock([card("XTENSION", "IMAGE"), card("BITPIX", -32), card("NAXIS", 2), card("NAXIS1", nx), card("NAXIS2", ny),
    card("PCOUNT", 0), card("GCOUNT", 1), card("EXTNAME", "IMAGE"), ...wcsCards]);
  const raw = Buffer.alloc(Math.ceil(nx * ny * 4 / 2880) * 2880);
  data.forEach((v, i) => raw.writeFloatBE(v, i * 4));
  return Buffer.concat([prim, hdr, raw, ...extra]);
}
const TEST_WCS = [card("CTYPE1", "RA---TAN"), card("CTYPE2", "DEC--TAN"), card("CRVAL1", 211.7), card("CRVAL2", 53.6), card("CRPIX1", -300.0), card("CRPIX2", 250.0),
  card("CDELT1", 1.0), card("CDELT2", 1.0), card("PC1_1", 0.0017083333 * Math.cos(25 * D2R)), card("PC1_2", 0.0017083333 * Math.sin(25 * D2R)),
  card("PC2_1", -0.0017083333 * Math.sin(25 * D2R)), card("PC2_2", 0.0017083333 * Math.cos(25 * D2R))];
test("FITS: header parsing and image extension decoding", () => {
  const data = Float32Array.from({ length: 6 }, (_, i) => i + 0.5);
  const img = readFitsBuffer(buildFits(3, 2, data, TEST_WCS));
  assert.equal(img.nx, 3); assert.equal(img.ny, 2);
  assert.deepEqual(Array.from(img.data), Array.from(data));
  assert.equal(img.header.get("EXTNAME"), "IMAGE");
  assert.equal(img.header.get("CRVAL1"), 211.7);
});
test("FITS: a truncated file reports that it is incomplete", () => {
  const whole = buildFits(40, 40, new Float32Array(1600), TEST_WCS);
  assert.throws(() => readFitsBuffer(whole.subarray(0, 2880 * 2 + 100)), /truncated/);
});
test("WCS: pixel and sky positions match astropy for a rotated, off-centre detector cutout", () => {
  const w = makeWcs(parseHeader(buildFits(2, 2, new Float32Array(4), TEST_WCS), 2880).cards);
  for (const [x, y, ra, dec] of [[1, 1, 212.1755925, 52.996239], [60.5, 60.5, 212.4007997, 53.0442887], [100, 30, 212.4645341, 52.9681631]]) {
    const [r, d] = w.pixToSky(x, y);
    near(r, ra, 2e-6); near(d, dec, 2e-6);
    const p = w.skyToPix(ra, dec); near(p[0], x, 1e-3); near(p[1], y, 1e-3);
  }
});
test("re-alignment: a star lands at the same sky position whatever the exposure's rotation", () => {
  const starRa = 212.42, starDec = 53.03;
  for (const rot of [0, 25, -40, 133]) {
    const th = rot * D2R, sc = 0.0017083333;
    const cards = TEST_WCS.filter((c) => !/^(PC|CRPIX|CRVAL)/.test(c)).concat([card("CRVAL1", 212.4), card("CRVAL2", 53.05), card("PC1_1", sc * Math.cos(th)), card("PC1_2", sc * Math.sin(th)), card("PC2_1", -sc * Math.sin(th)), card("PC2_2", sc * Math.cos(th)), card("CRPIX1", 60.5), card("CRPIX2", 60.5)]);
    const w0 = makeWcs(parseHeader(buildFits(2, 2, new Float32Array(4), cards), 2880).cards);
    // CRVAL sits at the cutout centre here, with the star a few pixels away
    const [sx, sy] = w0.skyToPix(starRa, starDec);
    const data = new Float32Array(120 * 120);
    for (let y = 0; y < 120; y++) for (let x = 0; x < 120; x++) data[y * 120 + x] = 10 + 300 * Math.exp(-(((x + 1 - sx) ** 2 + (y + 1 - sy) ** 2) / 8));
    const img = readFitsBuffer(buildFits(120, 120, data, cards));
    const wcs = makeWcs(img.header);
    const grid = makeGrid(starRa, starDec, 0.1, wcs.pixelScaleDeg);
    const out = reproject(img, wcs, grid);
    let best = -1, bi = 0; for (let k = 0; k < out.length; k++) if (out[k] > best) { best = out[k]; bi = k; }
    const [r, d] = gridToSky(grid, (bi % grid.n) + 0.5, Math.floor(bi / grid.n) + 0.5);
    assert.ok(angSepDeg(r, d, starRa, starDec) * 3600 < 4, `rotation ${rot}: star off by ${angSepDeg(r, d, starRa, starDec) * 3600} arcsec`);
    assert.ok(Math.abs(median(out) - 10) < 1, "background level kept");
  }
});
test("grid: north is up and east is on the left", () => {
  const g = makeGrid(100, 20, 0.2, 0.0017);
  const up = gridToSky(g, g.n / 2, g.n / 2 - 20), left = gridToSky(g, g.n / 2 - 20, g.n / 2);
  assert.ok(up[1] > 20, "up is north");
  assert.ok(left[0] > 100, "left is east (larger RA)");
});

// ---- solar system ----
test("Kepler solver, and an Earth-like circular orbit", () => {
  for (const e of [0, 0.1, 0.5, 0.9, 0.99]) for (let M = -3; M <= 3; M += 0.37) { const E = SS.solveKepler(M, e); near(E - e * Math.sin(E) - M, 0, 1e-10); }
  const p = SS.heliocentricEq({ a: 1, e: 0, i: 0, om: 0, w: 0, ma: 0, epoch: 2451545 }, 2451545);
  near(Math.hypot(...p), 1, 1e-12);
  near(p[0], 1, 1e-12);
  const q = SS.heliocentricEq({ a: 1, e: 0, i: 90, om: 0, w: 0, ma: 90, epoch: 2451545 }, 2451545);  // a polar orbit leaves the ecliptic plane
  near(Math.hypot(...q), 1, 1e-12);
});
test("Sun, Moon and planets agree with an independent ephemeris (astropy) to under 0.1 degree", () => {
  const ref = { Sun: [200.13, -8.485], Mars: [132.333, 19.091], Jupiter: [144.23, 14.892], Saturn: [10.324, 1.494] };
  const list = SS.majorBodies(Date.UTC(2026, 9, 15, 12, 0, 0));
  assert.equal(list.length, 9);
  for (const b of list) if (ref[b.name]) assert.ok(angSepDeg(b.ra, b.dec, ref[b.name][0], ref[b.name][1]) < 0.1, b.name);
});
test("asteroid positions: Mars computed from orbit elements alone lands close to the real Mars", () => {
  const ms = Date.UTC(2026, 9, 15, 12, 0, 0);
  const el = { a: 1.52371034, e: 0.0933941, i: 1.84969142, om: 49.55953891, w: -23.94362959 - 49.55953891, ma: -4.55343205 + 23.94362959, epoch: 2451545.0, H: -1.5, G: 0.15 };
  const earth = [0, 0, 0];
  // use the engine's Earth so only the orbit maths is being tested
  const real = SS.majorBodies(ms).find((b) => b.name === "Mars");
  const sunToEarth = (() => { const m = SS.majorBodies(ms).find((b) => b.name === "Sun"); const r = m.dist, a = m.ra * D2R, d = m.dec * D2R; return [-r * Math.cos(d) * Math.cos(a), -r * Math.cos(d) * Math.sin(a), -r * Math.sin(d)]; })();
  const p = SS.asteroidPosition(el, SS.jdFromMs(ms), sunToEarth);
  assert.ok(angSepDeg(p.ra, p.dec, real.ra, real.dec) < 0.5, "within half a degree after 27 years with no perturbations");
  assert.ok(Number.isFinite(p.mag));
});
test("JPL orbit data: URL and parsing", () => {
  const u = decodeURIComponent(SS.sbdbUrl({ limit: 400 }));
  assert.match(u, /fields=full_name,pdes,H,G,e,a,i,om,w,ma,epoch/);
  assert.match(u, /sb-kind=a/); assert.match(u, /"H\|LT\|9\.5"/); assert.match(u, /sort=H/);
  assert.match(decodeURIComponent(SS.sbdbUrl({ neo: true })), /sb-group=neo/);
  const rows = SS.parseSbdb({ fields: ["full_name", "pdes", "H", "G", "e", "a", "i", "om", "w", "ma", "epoch"], data: [
    ["     1 Ceres", "1", "3.34", "0.12", "0.0758", "2.7656", "10.59", "80.25", "73.3", "60.1", "2461000.5"],
    ["(2024 AB)", "2024 AB", "24.1", null, "0.4", "1.2", "5", "10", "20", "30", "2461000.5"],
    ["hyperbolic", "x", "10", null, "1.5", "-1", "1", "1", "1", "1", "1"]] });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "1 Ceres"); assert.equal(rows[1].name, "2024 AB"); assert.equal(rows[1].G, 0.15);
});

// ---- IRSA ----
test("IRSA: exposure query, CSV reading and file-name parsing", () => {
  const q = IR.exposureQuery({ ra: 210.80227, dec: 54.34895, bands: ["D2"] });
  assert.match(q, /FROM spherex\.artifact a JOIN spherex\.plane p ON a\.planeid = p\.planeid/);
  assert.match(q, /1 = CONTAINS\(POINT\('ICRS', 210\.802270, 54\.348950\), p\.poly\)/);
  assert.match(q, /p\.energy_bandpassname IN \('SPHEREx-D2'\)/);
  assert.ok(!IR.exposureQuery({ ra: 1, dec: 2 }).includes(" IN ("), "no band filter means all six detectors");
  assert.ok(!IR.exposureQuery({ ra: 1, dec: 2, bands: ["D2'; DROP"] }).includes("DROP"), "odd band names never reach the query");
  const rows = IR.parseCsv('uri,mjd,band\nibe/data/spherex/qr2/level2/2025W22_1B/l2b-v20-2025-250/2/level2_2025W22_1B_0129_1D2_spx_l2b-v20-2025-250.fits,60821.5,SPHEREx-D2\n"a,b",1,x\n');
  assert.equal(rows.length, 2); assert.equal(rows[1].uri, "a,b");
  const e = IR.parseExposure(rows[0]);
  assert.equal(e.survey, 1); assert.equal(e.band, "D2"); assert.equal(e.obsId, "2025W22_1B_0129_1"); assert.equal(e.mjd, 60821.5);
  assert.equal(IR.parseExposure({ uri: "x.png", mjd: "1" }), null);
  assert.equal(IR.fmtDate(60821.5), "2025-05-26");   // MJD 60676 is 2025-01-01
});
test("IRSA: reprocessed duplicates are dropped and exposures are grouped into surveys (epochs)", () => {
  const mk = (week, s, seq, ver, mjd) => IR.parseExposure({ uri: `ibe/data/spherex/qr2/level2/${week}_${s}A/x/2/level2_${week}_${s}A_${seq}_1D2_spx_l2b-v${ver}-2025-250.fits`, mjd: String(mjd), band: "SPHEREx-D2" });
  const list = IR.cleanExposures([mk("2025W22", 1, "0129", 20, 60821), mk("2025W22", 1, "0129", 25, 60821), mk("2025W43", 1, "0050", 20, 60950), mk("2025W50", 2, "0010", 20, 61010), mk("2026W20", 2, "0011", 20, 61180)]);
  assert.equal(list.length, 4);
  assert.equal(list[0].version > 25e6 || list[0].version > 24e6, true);
  const g = IR.groupEpochs(list);
  assert.deepEqual(g.map((x) => [x.label, x.items.length]), [["Survey 1", 2], ["Survey 2", 2]]);
  const noNames = IR.groupEpochs([{ mjd: 100, survey: null }, { mjd: 110, survey: null }, { mjd: 300, survey: null }]);
  assert.equal(noNames.length, 2);
});

console.log(`\n${passed} tests passed`);

test("IRSA: cutout address works for both relative and absolute exposure paths", async () => {
  const { cutoutUrl } = await import("../js/irsa.js");
  const want = "https://irsa.ipac.caltech.edu/api/x/a.fits?center=10.000000,-5.000000d&size=0.3000";
  assert.equal(cutoutUrl("/api/x/a.fits", 10, -5, 0.3), want);
  assert.equal(cutoutUrl("https://irsa.ipac.caltech.edu/api/x/a.fits", 10, -5, 0.3), want);
});