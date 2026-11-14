# InfraSphere

A Stellarium-style planetarium for the infrared sky. Stand on the ground, look up, and the sky turns with time for your latitude and longitude. The sky is painted in the style of NASA's **SPHEREx** mission, and every name comes from **SIMBAD**. Plain HTML, CSS and JavaScript modules, with WebGL2 for the sky. There is no build step.

![colour scale](https://img.shields.io/badge/colour%20scale-magma-8c2981) ![tests](https://img.shields.io/badge/tests-67%20passing-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue)

<p align="center">
<img src="test/Screenshot from 2026-11-15 01-36-38.png" alt="InfraSphere Web" style="width:100%; height:auto;">
</p>

## Contents

1. [Quick start](#quick-start)
2. [Features](#features)
3. [Controls](#controls)
4. [Simulated and real sky](#simulated-and-real-sky)
5. [Sky background model](#sky-background-model)
6. [Credits and license](#credits-and-license)

## Quick start

You need Python 3 (for `serve.py`) and, optionally, Node 18+ to run the tests.

```bash
git clone https://github.com/Radit-Raian/InfraSphere.git
cd InfraSphere
python3 serve.py 8000          # or: npm start
# open http://localhost:8000
```

The page uses ES modules, so it must be served over http; double-clicking `index.html` will not work. Use `serve.py` rather than `python3 -m http.server`: it sends no-cache headers (so edited files always reload) and provides the proxy paths below.

| Path | Forwards to | Used for |
| --- | --- | --- |
| `/proxy/simbad/` | `simbad.cds.unistra.fr` | Object labels and click lookups, if the browser blocks the direct request. |
| `/proxy/irsa/` | `irsa.ipac.caltech.edu` | SPHEREx exposure list and cutouts. |
| `/proxy/jpl/` | `ssd-api.jpl.nasa.gov` | Asteroid orbits. |

The app always tries the real service first and uses a proxy path only if that fails.

```bash
npm test                       # 67 tests, no dependencies
```

## Features

**Sky and camera**
- First-person view with horizon, ground, an altitude-azimuth grid and N/E/S/W marks. Stereographic or perspective projection.
- Your latitude and longitude (or "Use my location") and a time control from real time up to one day per second.
- Optional equatorial and galactic grids.
- Field of view from 100 degrees down to 0.1 degrees.

**SPHEREx sky**
- Six infrared bands (about 0.75 to 5 micrometres) plus a colour composite.
- Coloured like the paper's Fig. 2: matplotlib's magma (black, purple, orange, pale yellow) on log10 brightness. See [Colour scale](#colour-scale).
- Simulated sky by default; real SPHEREx maps with `?real=1`.

**Stellarium-style zoom (simulated sky)**
- Stars are drawn live as sharp points, never painted into the picture, so they never blur.
- The faintest star shown depends on the field of view. Zoom in and fainter stars appear; the stars already visible stay where they are and grow slightly.

**Background light (simulated sky)**
- Zodiacal light, diffuse Galactic light, extragalactic light, and stars and sources, each switchable under **Background light**.

**SIMBAD**
- Labels with Greek-letter and common names (Sirius, Vega), galaxies, clusters and nebulae, coloured by kind. Fainter objects appear as you zoom in.
- Tap any spot: SIMBAD returns the object type, position, spectral type, magnitudes, distance, proper motion and velocity.
- Search by name (M31, Sirius, NGC 7000).

**Epoch inspector**
- The **InfraSphere tile grid** shows the HEALPix tiles the SPHEREx maps are built from (down to 0.46 degrees). Tap a tile, then **Inspect SPHEREx epochs**.
- A blink-comparator workspace for one tile: pick epoch A and B and **Blink**, show the **Difference**, compare the six **Bands**, or plot a **Light curve**. Case notes, tile metadata, and every exposure with its date and time (UTC), grouped by survey pass.

**Solar system**
- Asteroids for the chosen date from JPL orbits (400 brighter ones, plus an optional near-Earth set).
- The Sun, Moon and planets are not drawn: a flat coloured dot is not what they look like. Their positions are still computed (`majorBodies` in `js/solar-system.js`).

## Controls

| Action | Input |
| --- | --- |
| Look around | Drag, or arrow keys |
| Zoom | Scroll or pinch |
| Identify an object | Tap or click it |
| Brightness, Contrast | Sliders under **View** |
| Epoch inspector | Space, 1/2, F, C, arrows, Esc |

## Simulated and real sky

| | Simulated (default) | Real (`?real=1`) |
| --- | --- | --- |
| Sky picture | Generated in the browser from a model of the SPHEREx Sky Simulator. Nothing is downloaded, so it appears at once. | SPHEREx QR2 HiPS maps from CDS, flattened by hips2fits. A small map loads first, sharper ones replace it, and a detailed patch loads when you zoom in and stop. |
| Stars | A deterministic generated catalogue, drawn live. Real SIMBAD stars get a dot at their true position. | Part of the real map. They blur when stretched. |
| Epoch inspector | Simulated exposures and detector cutouts from the same model. | Real exposures from IRSA. |

Open the page with `?real=1` to switch. The caption at the bottom says which mode you are in.


## Sky background model

The simulated sky adds three diffuse components to the stars and extended sources. Code: `js/sky-background.js`. Brightness is in MJy/sr. All three follow Section 4 of Crill et al. 2025, ApJS 281, 10 (the SPHEREx Sky Simulator paper), and `npm test` checks the numbers against it.

| Component | Methodology | Paper link |
| --- | --- | --- |
| **Zodiacal light** | Modified Kelsall et al. 1998 model: dust cloud, three dust bands, circumsolar ring and Earth-trailing blob, integrated along the line of sight to 5.2 AU from Earth's position on the date. Scattered sunlight plus thermal emission, using Kelsall's geometry, albedo, phase function and emissivity. The all-sky map uses the survey geometry (Sun 90 degrees away). | [Crill et al. 2025, Sec. 4.1](https://arxiv.org/abs/2505.24856) |
| **Diffuse Galactic light** | Far-infrared dust brightness times a fixed conversion spectrum nu b_nu (Sano et al. 2016; the red curve in the paper's Fig. 6, with its 3.3 um PAH feature), converted to MJy/sr and averaged over each band's 17 spectral channels. A procedural dust template stands in for the Planck map, scaled to about 1 MJy/sr at high Galactic latitude. | [Crill et al. 2025, Sec. 4.2](https://arxiv.org/abs/2505.24856) |
| **Extragalactic light** | A faint, nearly flat, log-normal clumpy floor at the level of the paper's Fig. 7 (about 2e-3 MJy/sr), standing in for the halo-model maps, which are not public. | [Crill et al. 2025, Sec. 4.4](https://arxiv.org/abs/2505.24856) |



## Credits and license

- Sky background model after Crill et al. 2025, ApJS 281, 10 (SPHEREx Sky Simulator), with Kelsall et al. 1998 (zodiacal cloud) and Sano et al. 2016 (diffuse Galactic light).
- SPHEREx data: NASA/JPL-Caltech, distributed by IRSA. QR2 DOI: 10.26131/IRSA652.
- SPHEREx HiPS maps and the hips2fits service: CDS, Strasbourg.
- Astronomy Engine by Don Cross (MIT licence), bundled in `js/vendor/astronomy.js`.
- Asteroid orbits: JPL Small-Body Database.
- This work has made use of the SIMBAD database, operated at CDS, Strasbourg, France.

MIT, see `LICENSE`. The data and services above have their own terms of use.
