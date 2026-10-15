// fetch() with a fallback: some services do not allow requests straight from a web page (CORS).
// If a direct request fails, the same path is retried through the same-origin proxy that serve.py provides.
import { CONFIG } from "./config.js";

const routes = {};           // service -> "direct" | "proxy", remembered once one works

const origins = () => ({ irsa: CONFIG.irsaBase, jpl: new URL(CONFIG.sbdbApi).origin });

/** service: "irsa" | "jpl"; url: the full https address. Resolves with a fetch Response. */
export async function svcFetch(service, url, init = {}) {
  const origin = origins()[service];
  const viaProxy = () => fetch(CONFIG.proxy[service] + url.slice(origin.length), init);
  if (routes[service] === "proxy") return viaProxy();
  try {
    const res = await fetch(url, init);
    routes[service] = "direct";
    return res;
  } catch (e) {
    if (e && e.name === "AbortError") throw e;
    let res;
    try { res = await viaProxy(); } catch (e2) { if (e2 && e2.name === "AbortError") throw e2; res = null; }
    if (res && res.status !== 404) { routes[service] = "proxy"; return res; }
    throw new Error("the browser could not reach " + new URL(origin).hostname +
      " (blocked or offline). Start the app with `python3 serve.py` instead of `python3 -m http.server`; it forwards these requests.");
  }
}
