# InfraSphere

A Stellarium-style planetarium that paints the sky with **NASA SPHEREx** infrared data and labels it with **SIMBAD**.
Stand on the ground, look up, and the sky turns with time for your latitude and longitude. Tap any spot to ask SIMBAD what is there.

Built for the NASA Space Apps Challenge. Plain HTML, CSS and JavaScript modules. No build step and no server code.

## What works today

- First-person sky view with horizon, ground, an altitude-azimuth grid and N/E/S/W marks (stereographic or perspective).
- SPHEREx QR2 sky in six infrared bands plus a color composite.
- Fast start: a small all-sky map loads first, sharper ones replace it, and a detailed patch is fetched when you zoom in and stop moving.
- Observer latitude/longitude and a time control (real time up to one day per second).
- **SIMBAD labels**: names, Greek-letter star names, common names (Sirius, Vega), galaxies, clusters and nebulae, colored by kind. Fainter objects appear as you zoom in.
- **Click anything**: SIMBAD returns the object type, position, spectral type, magnitudes, distance, proper motion and velocity.
- **Search by name** (M31, Sirius, NGC 7000).
- **Unmeasured objects**: galaxies, clusters and nebulae that SIMBAD has no V magnitude for are listed too (ranked by how often they are cited over the whole sky, and after the measured ones inside a zoomed-in view).
- **Equatorial and galactic grids** (View panel), drawn on the sky next to the alt-az grid.
- **InfraSphere tile grid**: the HEALPix tiles the SPHEREx maps are built from, fine enough to pick a 0.46 degree tile when zoomed in. Tap a tile, then **Inspect SPHEREx epochs**.
- **Epoch inspector** (blink comparator): a workspace for one tile. Left: the batch of neighbouring tiles. Centre: pick epoch A and B, then **Blink** between them, show the **Difference**, compare the six **Bands**, or plot a **Light curve**. Right: case notes (flag and text), tile metadata, and every exposure that covered the tile with its date and time (UTC), grouped by survey pass. Keys: Space, 1/2, F, C, arrows, Esc.
- **Asteroids** for the chosen date, from JPL orbits (400 brighter ones, plus an optional near-Earth set). The Sun, Moon and planets are not drawn: a flat coloured dot is not what they look like. Their positions are still computed (`majorBodies` in `js/solar-system.js`).
- **Stellarium-style zoom (simulated sky)**: stars are drawn live as sharp points, not painted into the picture, so they never blur. The faintest star shown depends on the field of view: zoom in and fainter stars appear, and the stars already there stay put and grow slightly. The field of view goes down to 0.1 degrees. The picture itself carries only the smooth diffuse light. It is coloured like the paper's Fig. 2: matplotlib's magma (black, purple, orange, pale yellow) on log10(MJy/sr), each band using the paper's colour-bar range plus 0.5 dex of headroom for the brighter ecliptic and Milky Way; the colour composite is the average of the six bands' colours. Brightness (default 1.0) and Contrast shift that scale. With `?real=1` the real SPHEREx maps are used, their stars are part of the picture, and they do blur when stretched.
- **Simulated sky background** (the default; add `?real=1` for the real data): zodiacal light, diffuse Galactic light and extragalactic light, built the way Section 4 of the SPHEREx Sky Simulator paper (Crill et al. 2025, ApJS 281, 10) describes. Each can be switched on and off under **Background light**. See "Sky background model" below.

## Run it

The page uses ES modules, so it must be served over http (opening `index.html` by double-click will not work).
Use `serve.py`: it is a normal file server that also forwards the IRSA and JPL requests a browser may refuse to make directly (CORS).

```bash
git clone https://github.com/<you>/infrasphere.git
cd infrasphere
python3 serve.py 8000            # or: npm start
# open http://localhost:8000
```

`python3 -m http.server 8000` still shows the sky, but the epoch inspector and asteroids may fail if IRSA or JPL block direct requests.

## Put it on GitHub Pages

1. Create a repository and push these files to the `main` branch.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then Save.
4. After a minute the site is live at `https://<you>.github.io/<repo>/`.

The `.nojekyll` file is included so GitHub serves the `js/` folder as-is.

GitHub Pages cannot run `serve.py`. If IRSA or JPL block direct requests from your page, put a small forwarding service (for example a Cloudflare Worker) in front of them and point `CONFIG.irsaBase` and `CONFIG.sbdbApi` in `js/config.js` at it.

## Project layout

| File | What it does |
| --- | --- |
| `index.html` | The page: canvases, control panel, info card. |
| `css/style.css` | Look and layout. |
| `js/main.js` | Starts everything, wires the panel, runs the frame loop. |
| `js/config.js` | Service addresses, band list, limits. Change settings here. |
| `js/astro.js` | Sidereal time and sky-coordinate maths. No DOM, fully tested. |
| `js/view.js` | The camera: where you look, zoom, and the two projections. |
| `js/sky-renderer.js` | WebGL2 shader that paints the SPHEREx sky for your place and time. |
| `js/sky-data.js` | Loads SPHEREx maps and zoom-in patches from CDS, or asks `sim-sky.js` for a simulated sky. |
| `js/sky-background.js` | Zodiacal light (Kelsall model), diffuse Galactic light and extragalactic light, after the paper's Section 4. No DOM, tested. |
| `js/sim-sky.js` | Simulated SPHEREx sky: instrument tables, stars, extended sources, and the sum of all components, drawn to an image. |
| `js/sim-irsa.js` | Simulated IRSA exposure list and detector cutouts for the epoch inspector, using the same background model. |
| `js/simbad.js` | SIMBAD client: ADQL queries, name tidying, object types. |
| `js/label-feed.js` | Decides which part of the sky to ask SIMBAD about, and how faint to go. |
| `js/labels.js` | Draws labels without overlaps, rings deep-sky objects, picks clicked objects. |
| `js/controls.js` | Drag, wheel, pinch, keyboard and tap handling. |
| `js/ui.js` | Status line, band buttons, object, tile and solar-system info cards. |
| `js/healpix.js` | HEALPix tile maths (checked against astropy-healpix). |
| `js/tiles.js` | Draws the tile grid and picks the tile under a click. |
| `js/fits.js` | Streaming FITS reader, sky coordinates, and the re-alignment onto a common north-up grid. |
| `js/irsa.js` | IRSA TAP query for SPHEREx exposures, cutout download, epoch grouping. |
| `js/inspector.js` | The epoch inspector window. |
| `js/solar-system.js` | Asteroids (JPL orbits) drawn as markers; Sun, Moon and planet positions (Astronomy Engine) without drawing them. |
| `js/star-layer.js` | Live stars for the simulated sky: sharp points from the star generator, with a faintest-star limit that deepens as you zoom. No DOM, tested. |
| `js/net.js` | `fetch` with a same-origin proxy fallback. |
| `js/vendor/astronomy.js` | Astronomy Engine by Don Cross, MIT licence, bundled so no CDN is needed. |
| `serve.py` | Static server plus the IRSA and JPL forwarding paths. |
| `test/run.js` | Unit tests (`npm test`). |

## Sky background model

The simulated sky adds three diffuse components to the stars and extended sources. Code: `js/sky-background.js`. Brightness is in MJy/sr. `npm test` checks the numbers below against the paper.

| Component | What the paper does (Sec. 4) | What this app does | Where it differs |
| --- | --- | --- | --- |
| **Zodiacal light** (4.1) | Modified Kelsall et al. 1998 model: dust cloud, three dust bands, solar ring and Earth-trailing blob, integrated along the line of sight from Earth's position at the date; sunlight scattered with the solar spectrum plus thermal emission. | The same integral to 5.2 AU with Kelsall's Table 1 geometry and Table 2 albedo, phase function and emissivity, evaluated at Earth's real position for the exposure date. The all-sky map uses the survey geometry (Sun 90 degrees away). | The Sun is a 5772 K blackbody scaled as in Kelsall, not the ASTM E-490 spectrum. The paper's extra changes below 1.25 um (Hong 1985 phase function, interpolation from 0.55 um) and its small albedo and emissivity adjustments are not published as numbers, so they are not applied. |
| **Diffuse Galactic light** (4.2) | Far-infrared dust brightness from Planck maps, times a fixed conversion spectrum nu b_nu (Sano et al. 2016, the red curve in Fig. 6), which has a 3.3 um PAH feature. No structure below about 5 arcmin. | Far-infrared brightness times the same nu b_nu, converted to MJy/sr, averaged over each band's 17 spectral channels. | nu b_nu is read off the printed curve (about 10 per cent). The Planck dust map is not shipped, so a procedural dust template stands in, scaled to about 1 MJy/sr at high Galactic latitude, the value the paper quotes. |
| **Extragalactic light** (4.4) | Halo-model maps (Mirocha et al., in preparation) at 1-3 arcsec, one per spectral channel. | A faint, nearly flat, log-normal clumpy floor at the level Fig. 7 shows (about 2e-3 MJy/sr, inside its colour range). | The halo model is not public, so there is no wavelength dependence and no real galaxy clustering. |

What the model reproduces from the paper: the zodiacal spectrum of Fig. 6 (minimum near 3 um, about ten times brighter at 5 um), the factor of about three between the ecliptic and the poles, and the vertical gradients along each detector in the epoch inspector.

## How the labeling works

1. When the view has been still for about half a second, `label-feed.js` works out the sky area on screen and how faint to go (brighter limit when zoomed out, fainter when zoomed in).
2. It asks SIMBAD (ADQL over TAP) for the brightest objects in that area, and separately for galaxies, clusters and nebulae. A wide view asks for the whole sky once. Areas already asked about are not requested again.
3. For the brightest stars it also asks for familiar names stored in SIMBAD.
4. `labels.js` turns each object's RA/Dec into a screen position for your place and time, draws the brightest first, and skips any label that would overlap one already drawn.
5. Clicking uses the same positions. If no label is near, SIMBAD is asked for the closest object within about 14 pixels.

## How the epoch inspector works

1. A tap on the tile grid picks the finest (order 7, about 0.46 degree) tile and its centre.
2. IRSA's TAP service (`spherex.artifact` joined to `spherex.plane`) returns every spectral image whose footprint contains the centre, with its observation time (MJD). Reprocessed duplicates are dropped.
3. Exposures are grouped into epochs by the survey number in the file name (`2025W22_1B_...` is survey 1), or by gaps in time if a name cannot be read.
4. For each exposure the IRSA cutout service returns a small FITS file. Only the image extension is read; the download is cancelled before the large PSF cube. Each exposure is rotated differently on the sky, so every image is resampled onto the same north-up grid (east on the left) before it is shown. That makes differences between dates real differences.
5. The reference mosaic comes from the CDS HiPS map (all dates combined) on the same grid.

## Why there are no planets in the SPHEREx sky

SPHEREx does observe moving solar-system objects, but they are not fixed features. The all-sky HiPS maps are built from exposures taken over many months, and a planet or asteroid is in a different place at every date, so it does not stay as a feature in the combined map. They show up in individual exposures at the position they had that day. This app therefore draws asteroids from orbits for the date you choose, as markers on top of the map, and does not claim they are in the map. It does not draw the Sun, Moon or planets at all.

## Things to check on your first run

I could test the maths, camera and query-building in Node (`npm test`), but I could not open the page in a browser against the live services. Please check these first:

- **Sky map loads.** If the sky stays black, the status line shows the reason. The hips2fits request format is the most likely thing to need a tweak (`js/sky-data.js`).
- **SIMBAD works from your site.** Open the browser console on your GitHub Pages address. If requests are blocked (CORS), the status line says labels are unavailable. The fix is a small proxy.
- **Deep-sky labels appear.** The galaxy/cluster/nebula query filters on SIMBAD object-type codes (`js/simbad.js`, `deepSkyQuery`). If you see stars but no galaxies, check the codes against SIMBAD's object-type list.
- **IRSA from the browser.** The inspector talks to `irsa.ipac.caltech.edu` (TAP and cutouts). I could not reach IRSA from where I built this, so the live calls are untested; the code paths are tested against synthetic FITS files and a mock server. If the inspector says it could not reach IRSA, start the app with `python3 serve.py`. If it reports a query error, the message from IRSA is shown and the column names in `js/irsa.js` (`exposureQuery`) are the first thing to compare with IRSA's SPHEREx cutout tutorial.
- **JPL asteroid orbits.** Same story for `ssd-api.jpl.nasa.gov`; the query is in `js/solar-system.js` (`sbdbUrl`).
- **Orientation.** If east and west look swapped, tick *Mirror map east-west* under Troubleshooting.
- **Galactic center patch.** The blocky patch near the galactic center is in the public QR2 maps, not a drawing bug.

## Limits to state honestly

- Each SPHEREx exposure samples a different wavelength inside its band (the filter changes across the detector), and its central wavelength at your tile is not read here. Compare dates within one band, and treat differences with care.
- Exposures are not zodiacal-light subtracted. The median option removes the smooth background, not structure.
- Cutouts are aligned using the linear (TAN) part of each image's coordinates; the small SIP distortion terms are ignored, which is about a pixel at most.
- Asteroid positions use two-body orbits and are approximate. Planet positions (Astronomy Engine, accurate to well under an arcminute) are computed but not drawn.
- In the simulated sky the stars are generated, not a real catalogue (see "Sky background model"); only the SIMBAD stars, which get a dot at their true position, are real.
- Positions use J2000 coordinates with the observer's sidereal time of date, so everything on screen is consistent but could be about a third of a degree off the true altitude and azimuth because precession is not applied.
- The SPHEREx map is a fixed picture from when it was observed. Only the observer's sky rotation is live.- Band wavelengths in the panel are approximate. Check the IRSA user guide before quoting exact values.
- Clicking returns the nearest SIMBAD object, which can be a faint background object near a bright star. Zoom in for precision.
- Stars use J2000 positions with no proper-motion correction, which is far below a pixel for almost all stars.

## Roadmap

Planned, in a sensible order:

1. Click-to-spectrum for a position, using IRSA's SPHEREx tools.
2. Mark where known asteroids were inside each epoch image.
3. Comet orbits from NASA/JPL.
4. Ice and CO2 overlays for known clouds.
5. Object catalog with 3D views for solar-system bodies.
6. Anomaly reports (needs a small hosted database).

## Credits

- SPHEREx data: NASA/JPL-Caltech, distributed by IRSA (NASA/IPAC Infrared Science Archive). QR2 data DOI: 10.26131/IRSA652.
- SPHEREx HiPS maps and the hips2fits service: CDS, Strasbourg.
- Astronomy Engine by Don Cross (MIT licence), bundled in `js/vendor/astronomy.js`.
- Asteroid orbits: JPL Small-Body Database.
- This work has made use of the SIMBAD database, operated at CDS, Strasbourg, France.

## License

MIT, see `LICENSE`. The data and services above have their own terms of use.