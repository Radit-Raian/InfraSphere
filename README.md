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
- **Sun, Moon, planets and asteroids** for the chosen date. Asteroids come from JPL orbits (400 brighter ones, plus an optional near-Earth set).

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
| `js/sky-data.js` | Loads SPHEREx maps and zoom-in patches from CDS. |
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
| `js/solar-system.js` | Sun, Moon, planets (Astronomy Engine) and asteroids (JPL orbits). |
| `js/net.js` | `fetch` with a same-origin proxy fallback. |
| `js/vendor/astronomy.js` | Astronomy Engine by Don Cross, MIT licence, bundled so no CDN is needed. |
| `serve.py` | Static server plus the IRSA and JPL forwarding paths. |
| `test/run.js` | Unit tests (`npm test`). |

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

SPHEREx does observe moving solar-system objects, but they are not fixed features. The all-sky HiPS maps are built from exposures taken over many months, and a planet or asteroid is in a different place at every date, so it does not stay as a feature in the combined map. They show up in individual exposures at the position they had that day. This app therefore draws planets and asteroids from orbits for the date you choose, as markers on top of the map. It does not claim they are in the map.

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
- Asteroid positions use two-body orbits and are approximate; planets use Astronomy Engine and are accurate to well under an arcminute.
- Positions use J2000 coordinates with the observer's sidereal time of date, so everything on screen is consistent but could be about a third of a degree off the true altitude and azimuth because precession is not applied.
- The SPHEREx map is a fixed picture from when it was observed. Only the observer's sky rotation is live. Planets, the Moon and asteroids are not drawn yet.
- Band wavelengths in the panel are approximate. Check the IRSA user guide before quoting exact values.
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