// All tunable settings and service addresses live here.
export const CONFIG = {
  // SPHEREx QR2 sky maps as HiPS tiles (CDS), flattened on demand by hips2fits.
  hipsRoot: "https://alasky.cds.unistra.fr/SPHEREx/",
  hips2fits: "https://alasky.cds.unistra.fr/hips-image-services/hips2fits",

  // SIMBAD (CDS) table access service, used for every object label.
  simbadTap: "https://simbad.cds.unistra.fr/simbad/sim-tap/sync",
  simbadPage: "https://simbad.cds.unistra.fr/simbad/sim-id?Ident=",

  irsaPage: "https://irsa.ipac.caltech.edu/Missions/spherex.html",

  // IRSA: TAP lists every SPHEREx exposure that covers a position; the cutout service returns a small
  // piece of one exposure. JPL: orbits of asteroids.
  irsaBase: "https://irsa.ipac.caltech.edu",
  sbdbApi: "https://ssd-api.jpl.nasa.gov/sbdb_query.api",
  // If the browser blocks a direct request (CORS), the app retries through these same-origin paths,
  // which serve.py forwards. Plain "python3 -m http.server" has no such paths.
  proxy: { irsa: "/proxy/irsa", jpl: "/proxy/jpl" },

  // Where the observer stands at start-up (editable in the page).
  location: { lat: 23.81, lon: 90.41 },

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

  // SIMBAD label feed.
  labels: { idleMs: 600, recheckMs: 700, backoffMs: 20000, maxDrawn: 140, topStars: 500, topDeepSky: 150, maxStored: 3000 }
};