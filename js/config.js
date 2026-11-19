// All tunable settings and service addresses live here.
export const CONFIG = {
  // true: the sky maps, tile thumbnails and epoch-inspector exposures are generated in the browser from a model of the
  // SPHEREx Sky Simulator (js/sim-sky.js, js/sim-irsa.js). Nothing is downloaded for them, so they appear at once.
  // false (or open the page with ?real=1): fetch the real SPHEREx data from CDS and IRSA as before.
  simulate: !(typeof location !== "undefined" && new URLSearchParams(location.search).has("real")),

  // SPHEREx QR2 sky maps as HiPS tiles (CDS), flattened on demand by hips2fits.
  hipsRoot: "https://alasky.cds.unistra.fr/SPHEREx/",
  hips2fits: "https://alasky.cds.unistra.fr/hips-image-services/hips2fits",

  // SIMBAD table access service, used for every object label.
  // CDS Strasbourg is down (security incident), so the IDIA mirror in South Africa goes first.
  simbadTap: "https://simbad.idia.ac.za/simbad/sim-tap/sync",
  // Tried in order if the address above fails.
  simbadMirrors: [
    "https://simbad.cfa.harvard.edu/simbad/sim-tap/sync",
    "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
  ],
  simbadPage: "https://simbad.cds.unistra.fr/simbad/sim-id?Ident=",

  // VizieR TAP (CDS): catalogue photometry (2MASS, AllWISE, Gaia) for the epoch inspector's spectrum view.
  vizierTap: "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync",
  vizierPage: "https://vizier.cds.unistra.fr/vizier/sed/",
  spherexSpectroTool: "https://irsa.ipac.caltech.edu/applications/spherex/tool-spectrophotometry",

  irsaPage: "https://irsa.ipac.caltech.edu/Missions/spherex.html",

  // IRSA: TAP lists every SPHEREx exposure that covers a position; the cutout service returns a small
  // piece of one exposure. JPL: orbits of asteroids.
  irsaBase: "https://irsa.ipac.caltech.edu",
  sbdbApi: "https://ssd-api.jpl.nasa.gov/sbdb_query.api",
  // If the browser blocks a direct request (CORS), the app retries through these same-origin paths,
  // which serve.py forwards. Plain "python3 -m http.server" has no such paths.
  proxy: { irsa: "/proxy/irsa", jpl: "/proxy/jpl", simbad: "/proxy/simbad", vizier: "/proxy/vizier" },

  // Where the observer stands at start-up (editable in the page).
  location: { lat: 23.81, lon: 90.41, name: "Dhaka" },

  // D1 to D6 are the six SPHEREx detector maps. Wavelengths are approximate.
  bands: [
    { id: "color", name: "Color composite", range: "all six bands" },
    { id: "D1", name: "Band 1", range: "~0.75-1.1 µm" },
    { id: "D2", name: "Band 2", range: "~1.1-1.6 µm" },
    { id: "D3", name: "Band 3", range: "~1.6-2.4 µm" },
    { id: "D4", name: "Band 4", range: "~2.4-3.8 µm" },
    { id: "D5", name: "Band 5", range: "~3.8-4.4 µm" },
    { id: "D6", name: "Band 6", range: "~4.4-5.0 µm" }
  ],

  // Quality level -> widths (px) of the all-sky maps loaded one after another.
  baseLevels: { 1: [1024], 2: [1024, 2048], 3: [1024, 2048, 4096] },

  // Epoch inspector: cutout sizes (degrees, shown), the sky pixel size of SPHEREx, and parallel downloads.
  inspector: { sizes: [0.1, 0.2, 0.3, 0.4], defaultSize: 0.3, pixelScaleArcsec: 6.15, maxParallel: 6, defaultBand: "D2" },

  // Detailed patch fetched when the view is zoomed in and still.
  patch: { size: 1536, maxFovDeg: 80, idleMs: 450, recheckMs: 600 },

  // WISE time series (WiseView, byw.tools), opened for the spot you click. `params` are the WiseView settings
  // from the example address (ra, dec and size are filled in per click). Size is the field width in arcseconds.
  // The page is shown in a frame of `frame` pixels, and only the `crop` rectangle of it is visible: the left
  // settings sidebar is cut off (it is about 260 px wide) and only the blinking image is left. If the crop is off, open the app with ?wisecrop=x,y,w,h to
  // try values, or press "Full page" in the window to see where the image sits.
  wise: {
    enabled: true,
    base: "http://byw.tools/wiseview",
    // Used instead when the app itself is served over https (Vercel, GitHub Pages ...). Set to "" if byw.tools has no https;
    // the panel then shows a button that opens WiseView in a new tab.
    secureBase: "",
    size: 176, deepSkySize: 300,
    // WiseView zoom for each field size, so the image is about 545 px wide and fills the crop.
    zoom: { star: 9, deep: 5 },
    frame: { w: 1400, h: 900 },
    crop: { x: 285, y: 43, w: 540, h: 540 },
    params: {
      band: 2, speed: 500, minbright: "-50.0000", maxbright: "500.0000", window: 0.5, diff_window: 1, linear: 1,
      color: "", zoom: 9, border: 0, gaia: 0, invert: 1, maxdyr: 0, scandir: 0, neowise: 0, diff: 0, outer_epochs: 0,
      unique_window: 1, smooth_scan: 0, shift: 0, pmra: 0, pmdec: 0,
      synth_a: 0, synth_a_sub: 0, synth_a_ra: "", synth_a_dec: "", synth_a_w1: "", synth_a_w2: "", synth_a_pmra: 0, synth_a_pmdec: 0, synth_a_mjd: "",
      synth_b: 0, synth_b_sub: 0, synth_b_ra: "", synth_b_dec: "", synth_b_w1: "", synth_b_w2: "", synth_b_pmra: 0, synth_b_pmdec: 0, synth_b_mjd: ""
    }
  },

  // SIMBAD label feed.
  labels: { idleMs: 600, recheckMs: 700, backoffMs: 20000, maxDrawn: 140, topStars: 500, topDeepSky: 150, maxStored: 3000 }
};