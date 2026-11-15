# InfraSphere: An Infrared Sky Explorer for NASA SPHEREx

A Stellarium-style planetarium that paints the sky with **NASA SPHEREx** infrared data and labels it with **SIMBAD**. Stand on the ground, look up, and the sky turns with time for your latitude and longitude. Tap any spot to ask SIMBAD what is there, see how it changed in WISE images over more than a decade, then open a small patch of sky and compare how it looked in different SPHEREx epochs.

Live demo: https://infrasphere-three.vercel.app

Version 0.2.0. Built for the NASA Space Apps Challenge. Plain HTML, CSS and JavaScript modules. No build step is needed, and no server code is required to view the sky.

> **The challenge:** since 2025, SPHEREx has mapped the entire sky every six months in 102 bands of near-infrared light. Comets, asteroids, stars, brown dwarfs and even new planets reveal themselves by shifting position or brightness between images, but no one person can sift through all that data alone. InfraSphere is the public-facing web tool that displays SPHEREx images of the sky and makes it easy for anyone to see how they change over time.

> **Simulated or real sky?** By default the sky, the tile thumbnails and the epoch-inspector exposures are **simulated** in your browser from a model of the SPHEREx Sky Simulator (see [Simulated Sky and Real Maps](#simulated-sky-and-real-maps)). Nothing is downloaded for them, so they appear at once. Add `?real=1` to the address, for example `http://localhost:8000/?real=1`, to fetch the real SPHEREx maps from CDS and the real exposures from IRSA instead. The page title shows "InfraSphere (simulated sky)" in simulated mode.


<p align="center">
<img src="test/Screenshot from 2026-11-15 01-36-38.png" alt="InfraSphere Web" style="width:100%; height:auto;">
</p>

## Table of Contents

- [Physical Background](#physical-background)
- [Pipeline Overview](#pipeline-overview)
- [Running the App](#running-the-app)
- [Deploying](#deploying)
- [Controls Reference](#controls-reference)
- [Step 1: The Sky View](#step-1-the-sky-view)
- [Simulated Sky and Real Maps](#simulated-sky-and-real-maps)
- [Step 2: Labels and Object Information](#step-2-labels-and-object-information)
- [Step 3: The Tile Grid](#step-3-the-tile-grid)
- [Step 4: The Epoch Inspector](#step-4-the-epoch-inspector)
- [Step 5: WISE Time Series](#step-5-wise-time-series)
- [Step 6: Solar System Objects](#step-6-solar-system-objects)
- [External Services](#external-services)
- [Credits](#credits)
- [License](#license)
- [Associated Papers](#associated-papers)
- [Facilities Used](#facilities-used)

## Physical Background

### Why Compare Epochs?

SPHEREx is an all-sky near-infrared spectral survey (0.75 to 5 µm). Every patch of sky is imaged repeatedly, so the same position is seen on several dates. WISE and NEOWISE have imaged the sky in the mid-infrared since 2010. Anything that changes between those dates stands out against the fixed background.

| Object type | Behaviour between epochs |
| --- | --- |
| Stars, galaxies | Fixed position (stars drift only by milli-arcseconds per year) |
| High-proper-motion stars, brown dwarfs | Visible motion over the WISE years (this is what WiseView is built to show) |
| Main-belt asteroids | Move by tens of arcseconds per hour, so they are in a different place on each date |
| Near-Earth objects | Can move by hundreds to thousands of arcseconds per hour |
| Variable sources | Same position, but the flux changes from date to date |
| Image artifacts, noise peaks | Appear in one exposure only, or at random positions |

### What the App Lets You See

| Observable | What it tells you | Where in InfraSphere |
| --- | --- | --- |
| Infrared brightness in six bands | Colour and temperature of the sky and its sources | Sky view, band buttons and colour composite |
| Components of the infrared background | Which part of the glow is zodiacal, Galactic, extragalactic or from stars | Background light menu (simulated sky) |
| Object name, type, position, photometry, short description | What the source at a spot is | SIMBAD and Wikipedia info card |
| WISE and NEOWISE epochs from 2010 onward | Proper motion and slow variability | WISE panel |
| Difference between two SPHEREx epochs | Moving or variable sources | Epoch inspector: Blink and Difference |
| Brightness in six bands | The infrared spectral shape in coarse steps | Epoch inspector: Bands |
| Flux of one exposure at its own wavelength | A low-resolution 0.75 to 5 µm spectrum of a spot | Epoch inspector: SPHEREx spectrum |
| 2MASS, AllWISE and Gaia magnitudes | The spectral energy distribution of the source | Epoch inspector: Catalogue SED |
| Brightness over time | Variability of a source | Epoch inspector: Light curve |
| Where asteroids are for a date | Which bright dots in an image may be Solar System bodies | Asteroid markers |

### Why Asteroids Are Markers and Not Part of the Sky Map

SPHEREx does observe moving Solar System objects, but they are not fixed features. The all-sky HiPS maps are built from exposures taken over many months, and an asteroid is in a different place at every date, so it does not stay as a feature in the combined map. They show up in individual exposures at the position they had that day. InfraSphere therefore draws asteroids from orbits for the date you choose, as markers on top of the map. It does not claim they are in the map.


## Pipeline Overview

```
index.html + css/style.css        page, canvases, toolbar, popups, side panels
js/main.js                        start-up, panel wiring, frame loop
js/sky-data.js  -> js/sky-renderer.js   sky maps (simulated or real) -> WebGL2 sky for place and time
js/sim-sky.js + js/sky-background.js    the simulated sky: stars, extended objects, zodiacal, Galactic and extragalactic light
js/star-layer.js                  live, sharp stars on the overlay canvas (simulated sky)
js/label-feed.js -> js/simbad.js -> js/labels.js   what to ask SIMBAD, query, draw without overlaps
js/wiki.js                        short Wikipedia description in the info card
js/wise.js                        WISE / NEOWISE time series for the clicked spot
js/healpix.js   -> js/tiles.js    HEALPix tile grid and tile picking
js/irsa.js (or js/sim-irsa.js) -> js/fits.js   exposure list, cutouts, common north-up grid
js/inspector.js + js/photometry.js   blink, difference, bands, spectrum, light curve, catalogue SED, case notes
js/solar-system.js                asteroids for the chosen date
serve.py                          static server + forwarding of IRSA, JPL, SIMBAD and VizieR requests
```

Data flow in one line: **sky map + observer place and time -> sky view -> SIMBAD names, Wikipedia text and WISE epochs on a click -> tile -> exposures -> aligned cutouts -> blink, difference, bands, spectrum, light curve and catalogue SED.**

## Running the App

The page uses ES modules, so it must be served over http. Opening `index.html` by double-click will not work. Use `serve.py`: it is a normal file server that also forwards the requests a browser may refuse to make directly (CORS).

```bash
git clone https://github.com/Radit-Raian/InfraSphere.git
cd InfraSphere
python3 serve.py 8000            # or: npm start
# open http://localhost:8000          (simulated sky)
# open http://localhost:8000/?real=1  (real SPHEREx maps and exposures)
```

`python3 -m http.server 8000` still shows the simulated sky, but SIMBAD, VizieR, JPL and the real IRSA data may fail if the services block direct requests.

### The Forwarding Paths in `serve.py`

The app always tries the real service first and uses these paths only if the browser blocks the direct request.

| Path | Forwards to | Used for |
| --- | --- | --- |
| `/proxy/irsa/...` | `https://irsa.ipac.caltech.edu/` | Real SPHEREx exposure list and cutouts |
| `/proxy/jpl/...` | `https://ssd-api.jpl.nasa.gov/` | Asteroid orbits |
| `/proxy/simbad/...` | `https://simbad.cds.unistra.fr/` | Object labels and click information |
| `/proxy/vizier/...` | `https://tapvizier.cds.unistra.fr/` | Catalogue photometry |

GET and POST are both forwarded. Errors from the real service are passed through unchanged, and an unreachable service gives a 502. Responses are sent with `Cache-Control: no-store` so edited files are always picked up.

### Environment Variables

| Variable | Meaning |
| --- | --- |
| `INFRASPHERE_IRSA` | Alternative IRSA base address |
| `INFRASPHERE_JPL` | Alternative JPL base address |
| `INFRASPHERE_SIMBAD` | Alternative SIMBAD base address |
| `INFRASPHERE_VIZIER` | Alternative VizieR TAP base address |

### Requirements

| Item | Needed for |
| --- | --- |
| A browser with WebGL2 | The sky renderer |
| Python 3 | `serve.py` |
| Node.js and npm | `npm start` and `npm test` (optional) |
| Internet access | SIMBAD, VizieR, Wikipedia, WISE images, JPL, and (with `?real=1`) CDS and IRSA |

### Settings

Everything tunable is in `js/config.js`.

| Group | Setting | Meaning |
| --- | --- | --- |
| Mode | `simulate` | `true` unless the address contains `?real` |
| Sky maps | `hipsRoot`, `hips2fits` | SPHEREx HiPS tiles and the flattening service at CDS |
| SIMBAD | `simbadTap`, `simbadMirrors` | TAP address, and mirrors tried in turn if it fails (CfA Harvard) |
| VizieR | `vizierTap`, `vizierPage` | Catalogue photometry and the VizieR SED page |
| IRSA, JPL | `irsaBase`, `sbdbApi`, `proxy` | Service addresses, and the same-origin paths used if the browser blocks a direct request |
| Observer | `location` | Start-up place (Dhaka, 23.81 N, 90.41 E) |
| Quality | `baseLevels` | All-sky map widths for Fast (1024), Balanced (1024, 2048), High (1024, 2048, 4096) |
| Patch | `patch` | Detail patch size (1536 px), widest field it is used for (80 degrees), idle delay |
| Inspector | `inspector` | Cutout sizes 0.1 to 0.4 degrees (default 0.3), pixel scale 6.15 arcsec, up to 6 parallel downloads, default band D2 |
| WISE | `wise` | See [Step 5](#step-5-wise-time-series) |
| Labels | `labels` | Idle delay, how many labels are drawn (140), how many stars (500) and deep-sky objects (150) are asked for, how many are stored (3000) |

### Tests

```bash
npm test      # runs test/run.js
```

## Deploying

### Vercel

The live demo runs at https://infrasphere-three.vercel.app. `vercel.json` builds `serve.py` with the Python runtime and serves `index.html`, `js/` and `css/` as static files. Requests to `/proxy/...` are routed to `serve.py`, and every other path is served as a file.

Because Vercel serves the page over **https**, the browser cannot show the **http** WiseView page in a frame. On https the WISE panel therefore blinks the unWISE epoch images instead (see [Step 5](#step-5-wise-time-series)).

### GitHub Pages

1. Push the files to the `main` branch.
2. In the repository, open **Settings -> Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then Save.
4. After a minute the site is live at `https://Radit-Raian.github.io/InfraSphere/`.

The `.nojekyll` file is included so GitHub serves the `js/` folder as-is. GitHub Pages cannot run `serve.py`. If services block direct requests from your page, put a small forwarding service (for example a Cloudflare Worker) in front of them and point the settings in `js/config.js` at it.

## Controls Reference

The toolbar at the bottom opens one popup at a time. Click outside a popup or press Esc to close it. The search bar is at the top centre, the location and date and time pills sit at the bottom corners, and the top-left readout shows direction, altitude, RA, Dec, field of view and sidereal time.

| Control | What it contains |
| --- | --- |
| **Infrared band** | Six bands and a colour composite. *Map detail*: Fast (1024), Balanced (up to 2048), High (up to 4096). *Sharpen when zoomed in* |
| **Background light** | Zodiacal light, Diffuse Galactic, Extragalactic, Stars and sources (simulated sky only) |
| **Labels** | Stars, Galaxies, Clusters, Nebulae, Other (Other is off by default) |
| **Solar system** | Asteroids, Near-Earth asteroids |
| **View and grids** | Projection (stereographic or perspective), Ground, Alt-az grid, Equatorial grid, Galactic grid, Directions, InfraSphere tile grid, Brightness and Contrast sliders |
| **Help and troubleshooting** | Usage notes, *Mirror map east-west*, load your own equirectangular all-sky image (RA increasing to the left, north up) |
| **Full screen** | Toggles full screen (hidden if the browser does not support it) |
| **Where you stand** (bottom left) | Latitude, longitude, *Use my location*. The pill shows the place name or the coordinates |
| **When** (bottom right) | Date and time, Now, -1 h, +1 h, speed: Paused, Real time, 1 min/s, 10 min/s, 1 hour/s, 1 day/s |

Drag to look around, scroll or pinch to zoom, and use the arrow keys. The field of view runs from 0.1 degree up to 150 degrees (stereographic) or 120 degrees (perspective). Add `?wisecrop=x,y,w,h` to the address to try another crop of the WiseView page.

### Epoch Inspector Keys

| Key | Action |
| --- | --- |
| Space | Pause or resume the blink |
| 1 / 2 | Pause and show epoch A / epoch B |
| F | Flag or unflag the tile |
| C | Clear the flag |
| Left / Right arrow | Previous or next tile in the batch |
| Esc | Close the inspector (or the WISE panel) |

## Step 1: The Sky View

**Files:** `js/astro.js`, `js/view.js`, `js/sky-data.js`, `js/sky-renderer.js`, `js/landscape.js`, `js/controls.js`

**Purpose:** Show the infrared sky as it would appear overhead for a chosen place and time

1. The observer's latitude, longitude and time give the sidereal time (`astro.js`), which turns J2000 sky coordinates into altitude and azimuth.
2. `view.js` holds the camera (direction, zoom) and the two projections, stereographic and perspective.
3. `sky-data.js` loads a small all-sky map first, replaces it with sharper ones, and fetches a detailed patch when you zoom in and stop moving. The *Map detail* setting limits the map size.
4. `sky-renderer.js` is a WebGL2 shader. For every screen pixel it works out the sky direction, reads the all-sky image (and the detail patch where you are zoomed in), applies brightness and contrast, and draws the alt-az, equatorial and galactic grids.
5. The same shader draws the landscape: a far ridge, hills, trees and a faint town glow above them. `landscape.js` holds the same profile so the overlay can hide stars, labels and asteroids that lie behind the hills.
6. `controls.js` handles drag, wheel, pinch, keyboard and tap input.

## Simulated Sky and Real Maps

| Mode | How to get it | What it shows |
| --- | --- | --- |
| Simulated sky | Default | A procedural sky built in the browser, with four switchable components. Nothing is downloaded |
| Real maps | Add `?real=1` to the address | The real SPHEREx all-sky maps (QR2 HiPS) from CDS, flattened by hips2fits. The epoch inspector then uses real IRSA exposures |
| Your own image | Help menu | Any equirectangular all-sky image, RA increasing to the left, north up |

The simulated sky is a look-alike for browsing, **not** a calibrated simulation and **not** SPHEREx data. Use `?real=1`, or the real exposures, when you need real measurements. Everything is deterministic: the same request always gives the same pixels.

### The Model

The model follows the components of the SPHEREx Sky Simulator (Crill et al. 2025). The four switchable components, and the display, are:

| Component | In the app | Where |
| --- | --- | --- |
| Zodiacal light | Kelsall et al. (1998) interplanetary dust model integrated along the line of sight, shown as the survey sees it (looking about 90 degrees from the Sun) | `js/sky-background.js` |
| Diffuse Galactic light | Far-infrared dust brightness times a fixed conversion spectrum, including the 3.3 µm PAH feature | `js/sky-background.js`, `js/sim-sky.js` |
| Extragalactic light | A faint, nearly flat, slightly clumpy floor | `js/sky-background.js` |
| Stars and sources | A deterministic star catalogue with blackbody colours and some variable stars, unresolved starlight, and extended objects (LMC, SMC, M31, M33, Orion, Carina, Rosette, Pleiades, Centaurus A, North America nebula) | `js/sim-sky.js` |
| Instrument | The six detectors, their band edges, PSF widths and 17 spectral channels each | `js/sim-sky.js` |
| Colour scale | The magma colour bars of Fig. 2 of the paper, log of MJy/sr, per band | `js/sim-sky.js` |

### What Is Exact and What Is Approximate

| Part | Status |
| --- | --- |
| Kelsall dust model and its parameters | Follows Kelsall et al. (1998) |
| Solar spectrum for scattered zodiacal light | A 5772 K blackbody, normalised at 1.25 µm. The paper uses the ASTM E-490 spectrum, which is not bundled |
| Diffuse Galactic conversion spectrum | Read off the figure of the paper, good to roughly 10 per cent |
| Far-infrared dust brightness | A dust template scaled to about 1 MJy/sr at high latitude. The paper uses Planck dust maps, which are not bundled |
| Extragalactic light | The mid-level of the colour range of the paper's figure, with log-normal clumpiness. The halo model behind the paper's maps is not public |
| Stars | A synthetic, Euclidean-like catalogue plus about 20 real bright stars at their true positions |

### Live Stars

An image has a fixed number of pixels, so zooming in only stretches it and stars blur. In simulated mode the sky image therefore carries only the smooth diffuse light, and the stars are drawn every frame as sharp points by `js/star-layer.js`. The faintest star drawn depends on the zoom: zoom in and the limit moves fainter, so more stars appear while the ones already there stay where they are. Up to 12000 stars are drawn at once, colours follow the star's temperature and the chosen band (in the colour composite, band D5 is red, D3 green and D1 blue), and the brightest stars get a soft halo. The live stars use the same catalogue as the epoch inspector, so both show the same stars. With `?real=1` the stars are already in the real maps, so the live layer is switched off.

## Step 2: Labels and Object Information

**Files:** `js/label-feed.js`, `js/simbad.js`, `js/labels.js`, `js/wiki.js`

**Purpose:** Name what is on screen and answer "what is that?" for any tapped spot

### Labels

1. When the view has been still for about 0.6 seconds, `label-feed.js` works out the sky area on screen and how faint to go (a brighter limit when zoomed out, fainter when zoomed in).
2. It asks SIMBAD (ADQL over TAP) for the brightest objects in that area, and separately for galaxies, clusters and nebulae. A wide view asks for the whole sky once, ranking deep-sky objects by how often they are cited. Areas already asked about are not requested again.
3. For the brightest stars it also asks for familiar names stored in SIMBAD.
4. `labels.js` turns each object's RA and Dec into a screen position for your place and time, draws the brightest first, and skips any label that would overlap one already drawn. Deep-sky objects get a ring. In simulated mode a small dot is drawn at each SIMBAD star's true position, so its name never floats over empty sky.
5. If one SIMBAD address fails, the mirrors in `CONFIG.simbadMirrors` are tried in turn.

### What Happens on a Click

| Order | What is under the pointer | Result |
| --- | --- | --- |
| 1 | An asteroid marker | Asteroid info card |
| 2 | A drawn label or ring | SIMBAD details for that object |
| 3 | A tile, with the tile grid switched on | Tile card with **Inspect SPHEREx epochs** and a SIMBAD lookup button |
| 4 | Empty sky | SIMBAD is asked for the closest object within about 14 pixels (15 second time-out) |

Every click also opens the [WISE panel](#step-5-wise-time-series) at that spot. The info card shows the object type, position, spectral type, magnitudes, distance, proper motion and velocity, plus a link to the SIMBAD page.

### Wikipedia Description

For objects that can have an article, the info card adds a short description from Wikipedia. SIMBAD names like `* gam Cas` are spelled out first (Gamma Cassiopeiae), and if nothing matches, all of the object's other SIMBAD names are tried. Only astronomy articles are accepted. Catalogue-only entries (Gaia, 2MASS, WISE and similar) skip the lookup, which starts a moment after the card opens so it never delays the SIMBAD answer. If no article is found, the card simply has no description.

## Step 3: The Tile Grid

**Files:** `js/healpix.js`, `js/tiles.js`

**Purpose:** Let the user pick a small patch of sky to inspect

Switch on **InfraSphere tile grid** in the View menu. The grid is the HEALPix tiling that the SPHEREx maps are built from, and it gets finer as you zoom in (tiles stay at least about 48 pixels across). The finest level is order 7, about 0.46 degree across. Tap a tile to see its metadata, then choose **Inspect SPHEREx epochs**. The HEALPix maths is checked against astropy-healpix.

## Step 4: The Epoch Inspector

**Files:** `js/irsa.js`, `js/sim-irsa.js`, `js/fits.js`, `js/inspector.js`, `js/photometry.js`

**Purpose:** Compare what one tile looked like on different dates, like a blink comparator, and read off its spectrum

### Query and Download

1. A tap on the tile grid picks the finest tile and its centre.
2. IRSA's TAP service (`spherex.artifact` joined to `spherex.plane`) returns every spectral image whose footprint contains the centre, with its observation time (MJD). Reprocessed duplicates are dropped.
3. Exposures are grouped into epochs by the survey number in the file name (`2025W22_1B_...` is survey 1), or by gaps in time if a name cannot be read.
4. For each exposure the IRSA cutout service returns a small FITS file. Only the image extension is read, and the download is cancelled before the large PSF cube. Up to 6 cutouts download in parallel.

### Simulated Exposures

In simulated mode `js/sim-irsa.js` replaces IRSA. For any position it makes a plausible visit history: one pass per roughly six-month survey (survey 1 starts on 2025-05-01), each pass seeing the spot once in each of the 17 spectral channels of each detector, with a few channels missing. Each cutout is a small, randomly rotated detector image (6.15 arcsecond pixels, its own WCS) built from the same sky model as the map, plus zodiacal light that drifts with the seasons, variable stars, PSF, shot noise and read noise. The same exposure of the same spot always gives the same pixels.

### Alignment

Each exposure is rotated differently on the sky, so every image is resampled onto the same north-up grid (east on the left) before it is shown. That makes differences between dates real differences. The reference mosaic comes from the CDS HiPS map (all dates combined), or from the simulation, on the same grid.

### The Workspace

| Area | Contents |
| --- | --- |
| Left | The batch of neighbouring tiles (up to 3 by 3 around the chosen one). Click one to inspect it |
| Centre | Epoch A and epoch B pickers, six views, and display settings |
| Right | Case notes (flag and text, saved in this browser), tile metadata, the spectrum and photometry tools, and every exposure that covered the tile with its date and time (UTC), grouped by survey pass |

### The Six Views

| View | What it shows |
| --- | --- |
| **Blink comparator** | Alternates epoch A and epoch B at 0.5 to 6 Hz |
| **Difference** | A minus B, blue where A is fainter and red where A is brighter |
| **Bands** | The mean image of each of the six detectors for the chosen epoch |
| **Light curve** | Flux in the central 3 by 3 pixels, one point per exposure. Click a point for A, shift-click for B |
| **SPHEREx spectrum** | The same central flux, one point per exposure, plotted against that exposure's own wavelength. In real mode the wavelength of each exposure is not read yet |
| **Catalogue SED** | 2MASS, AllWISE and Gaia DR3 magnitudes of the nearest source, converted to Jy, with the SPHEREx range shaded |

### Display and Photometry Settings

| Setting | Options |
| --- | --- |
| Band | Any of D1 to D6, or all six bands (slower) |
| Size | 0.1, 0.2, 0.3 or 0.4 degrees |
| Stretch, colours | asinh or linear; grey or heat |
| Subtract median, shared scale | Remove the smooth background level; use one brightness scale for all images |
| Photometry radius | 2, 5, 10 or 30 arcsec |
| Buttons | CSV download of the catalogue points, **SPHEREx spectrum (IRSA)** (opens IRSA's spectrophotometry tool and copies the position to the clipboard), **VizieR SED** |

For the catalogue SED, three small VizieR queries run in parallel (2MASS, AllWISE, Gaia DR3), so one slow or failing catalogue does not lose the others. Each takes the nearest source within the chosen radius and converts its magnitudes to flux with Vega zero points and pivot wavelengths.

## Step 5: WISE Time Series

**File:** `js/wise.js`

**Purpose:** Show how the exact spot you clicked changed in WISE and NEOWISE images since 2010

Every click, tile pick and search opens the WISE panel at that point in the side column under the info card. For a click on empty sky it opens immediately on the clicked point and moves to the SIMBAD object's own position if SIMBAD answers with an object more than 3 arcseconds away.

| Situation | What is shown |
| --- | --- |
| App served over http (for example `localhost`) | The WiseView page (byw.tools) for the target, in a frame that is larger than the visible area and shifted so the settings sidebar is cropped away and only the image is left. Buttons: **Full page** (whole WiseView page), **New tab** |
| App served over https (Vercel, GitHub Pages) | A blink of the unWISE epoch images from the Legacy Surveys cutout service: AllWISE (2010 to 2011), then one image per NEOWISE year from 2014 to 2020. Click the image to pause. The label shows the epoch |
| No image can be loaded | A message, and the **New tab** button still opens WiseView |

The field is 176 arcsec wide for stars and 300 arcsec for galaxies, clusters and nebulae. A failure in the panel never stops the SIMBAD lookup. If the crop is off, try `?wisecrop=x,y,w,h`, or press **Full page** to see where the image sits.

## Step 6: Solar System Objects

**File:** `js/solar-system.js`

**Purpose:** Show where asteroids are on the chosen date

1. JPL's Small-Body Database gives each asteroid's orbit: 400 brighter asteroids (absolute magnitude H below 9.5), or up to 300 near-Earth asteroids.
2. The position on the chosen date is computed from the orbit with two-body Kepler motion, good to roughly an arcminute for main-belt asteroids within a year or so of the orbit's epoch, and worse for close approachers.
3. The apparent magnitude comes from H and G (the IAU H,G system).
4. Positions are recomputed when the simulated time moves by more than about 20 seconds. Asteroids are drawn as small diamonds with name labels, and tapping one opens an info card.

The Sun, Moon and planets are computed with Astronomy Engine (`majorBodies()` gives their positions and magnitudes) but are **not drawn**, because a flat coloured dot is not what they look like.

| Body | Source | Accuracy |
| --- | --- | --- |
| Asteroids | JPL Small-Body Database orbits, two-body motion | Approximate |
| Sun, Moon, planets (positions only) | Astronomy Engine (bundled) | Well under an arcminute |

Asteroid markers are not part of the SPHEREx data (see [Why Asteroids Are Markers and Not Part of the Sky Map](#why-asteroids-are-markers-and-not-part-of-the-sky-map)).

## External Services

| Service | Used for | Where in the code |
| --- | --- | --- |
| CDS HiPS maps and hips2fits | Real SPHEREx all-sky maps and zoom-in patches (`?real=1`) | `js/sky-data.js` |
| SIMBAD (TAP), with a CfA Harvard mirror | Labels, names, click information, search | `js/simbad.js` |
| VizieR (TAP) | 2MASS, AllWISE and Gaia photometry for the catalogue SED | `js/photometry.js` |
| IRSA TAP and cutout service | Real SPHEREx exposure list and cutouts (`?real=1`) | `js/irsa.js` |
| IRSA SPHEREx spectrophotometry tool | Linked from the inspector | `js/inspector.js` |
| WiseView (byw.tools) | WISE time series on http pages | `js/wise.js` |
| Legacy Surveys cutout service | unWISE epoch images for the WISE blink on https pages | `js/wise.js` |
| JPL Small-Body Database | Asteroid orbits | `js/solar-system.js` (`sbdbUrl`) |
| Wikipedia REST API | Short object descriptions | `js/wiki.js` |
| Astronomy Engine | Sun, Moon and planet positions | `js/vendor/astronomy.js` |


## Credits

- SPHEREx data: NASA/JPL-Caltech, distributed by IRSA (NASA/IPAC Infrared Science Archive). QR2 data DOI: 10.26131/IRSA652.
- SPHEREx HiPS maps and the hips2fits service: CDS, Strasbourg.
- Simulated sky components modelled after Crill et al. 2025 (SPHEREx Sky Simulator) and Kelsall et al. 1998.
- Astronomy Engine by Don Cross (MIT licence), bundled in `js/vendor/astronomy.js`.
- Asteroid orbits: JPL Small-Body Database.
- This work has made use of the SIMBAD database and the VizieR catalogue access tool, operated at CDS, Strasbourg, France.
- This publication makes use of data products from the Wide-field Infrared Survey Explorer (WISE) and NEOWISE, projects of the University of California, Los Angeles, and the Jet Propulsion Laboratory/California Institute of Technology, funded by NASA.
- This publication makes use of data products from the Two Micron All Sky Survey, a joint project of the University of Massachusetts and IPAC/Caltech, funded by NASA and the NSF.
- This work has made use of data from the European Space Agency mission Gaia, processed by the Gaia Data Processing and Analysis Consortium (DPAC).
- The Legacy Surveys cutout service and WiseView (byw.tools) are used for the WISE time series.
- Short object descriptions come from Wikipedia.
- Built for the NASA Space Apps Challenge.

## License

MIT, see `LICENSE`. The data and services above have their own terms of use.

## Associated Papers

Papers that the code or its data depend on. Entries marked * are named in the source comments; the others are the standard references for the data and services used.

### SPHEREx Mission and Data

| Paper | Used for |
| --- | --- |
| Crill, B. P., et al. 2025, ApJS, 281, 10, "The SPHEREx Sky Simulator"* | The model behind the simulated sky: components, instrument tables (Table 2, Figs 18 and 19), colour scale (Fig. 2), zodiacal light (Sec. 4.1), diffuse Galactic light (Sec. 4.2), extragalactic light, simulated exposures (Secs 3.1, 5, 6.2, 6.4) |
| Crill, B. P., et al. 2020, Proc. SPIE 11443, 114430I, "SPHEREx: NASA's near-infrared spectral all-sky survey" | The mission, the 0.75 to 5 µm range and 102 bands |
| Bock, J. J., et al. 2025, arXiv:2511.02985, "The SPHEREx Satellite Mission" | Mission, instrument and survey design |
| Akeson, R., et al. 2025, arXiv:2511.15823, "The SPHEREx image and spectrophotometry processing pipeline" | The spectral images and cutouts served by IRSA |
| Korngut, P. M., et al. 2026, arXiv:2603.29835, "The SPHEREx Instrument" | Instrument calibration and performance |
| Cukierman, A. J., et al. 2026, ApJS, 286, 22, "Spectral Map Making with SPHEREx" | SPHEREx maps in HEALPix format |

### Models Behind the Simulated Sky

| Paper | Used for |
| --- | --- |
| Kelsall, T., et al. 1998, ApJ, 508, 44, "The COBE Diffuse Infrared Background Experiment Search for the Cosmic Infrared Background. II. Model of the Interplanetary Dust Cloud"* | Zodiacal light model (`js/sky-background.js`) |
| Sano, K., et al. 2016* | Diffuse Galactic light conversion spectrum, as used in the Sky Simulator paper |
| Symons, S., et al. 2023* | Planck dust maps used for the far-infrared brightness in the Sky Simulator paper (replaced here by a dust template) |
| Mirocha, J., et al., in preparation* | Halo model of the extragalactic background light (replaced here by a flat, clumpy floor) |
| Bowell, E., et al. 1989, in Asteroids II, 524 | The H,G system for asteroid magnitudes |

### Catalogues, Surveys and Services

| Paper | Used for |
| --- | --- |
| Wenger, M., et al. 2000, A&AS, 143, 9, "The SIMBAD astronomical database" | Labels, names, click information |
| Ochsenbein, F., Bauer, P., & Marcout, J. 2000, A&AS, 143, 23, "The VizieR database of astronomical catalogues" | Catalogue photometry |
| Skrutskie, M. F., et al. 2006, AJ, 131, 1163, "The Two Micron All Sky Survey (2MASS)" | 2MASS J, H, Ks in the catalogue SED |
| Wright, E. L., et al. 2010, AJ, 140, 1868, "The Wide-field Infrared Survey Explorer (WISE)" | AllWISE W1 to W4 in the catalogue SED, WISE images |
| Mainzer, A., et al. 2011, ApJ, 731, 53, "Preliminary Results from NEOWISE" | NEOWISE epochs |
| Lang, D. 2014, AJ, 147, 108, "unWISE: Unblurred Coadds of the WISE Imaging" | unWISE images in the WISE blink |
| Meisner, A. M., Lang, D., & Schlegel, D. J. 2017, AJ, 153, 38, "Deep Full-sky Coadds from Three Years of WISE and NEOWISE Observations" | unWISE coadds, including the time-resolved epochs |
| Dey, A., et al. 2019, AJ, 157, 168, "Overview of the DESI Legacy Imaging Surveys" | Legacy Surveys cutout service |
| Caselden, D., et al. 2018, ASCL, ascl:1806.004, "WiseView" | The WISE time-series viewer |
| Gaia Collaboration, Vallenari, A., et al. 2023, A&A, 674, A1, "Gaia Data Release 3: Summary of the content and survey properties" | Gaia DR3 magnitudes in the catalogue SED |
| Górski, K. M., et al. 2005, ApJ, 622, 759, "HEALPix" | The tile grid |
| Fernique, P., et al. 2015, A&A, 578, A114, "Hierarchical progressive surveys (HiPS)" | The sky maps format |

## Facilities Used

### Telescopes and Missions

| Facility | What it provides here |
| --- | --- |
| SPHEREx (NASA/JPL-Caltech) | The infrared sky maps and exposures the app is built around |
| WISE and NEOWISE | Mid-infrared images from 2010 onward (WISE panel) and AllWISE photometry |
| Gaia (ESA) | Optical photometry, through VizieR |
| 2MASS | Near-infrared photometry, through VizieR |

### Archives, Databases and Services

| Facility | What it provides here |
| --- | --- |
| IRSA (NASA/IPAC Infrared Science Archive) | SPHEREx exposure list, cutouts and the spectrophotometry tool |
| CDS, Strasbourg | SIMBAD, VizieR, SPHEREx HiPS maps and hips2fits |
| SIMBAD mirror at CfA, Harvard | Fallback for SIMBAD queries |
| JPL Solar System Dynamics (Small-Body Database) | Asteroid orbits |
| Legacy Surveys cutout service | unWISE epoch images |
| WiseView (byw.tools) | WISE time-series viewer |
| Wikipedia | Short object descriptions |
