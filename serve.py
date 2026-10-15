#!/usr/bin/env python3
"""Serve InfraSphere and forward the few requests browsers will not make directly.

Usage:  python3 serve.py [port]        (default 8000)

It is a normal static file server, plus two forwarding paths used by the epoch inspector and the asteroid layer:
  /proxy/irsa/...  ->  https://irsa.ipac.caltech.edu/...      (SPHEREx exposure list and cutouts)
  /proxy/jpl/...   ->  https://ssd-api.jpl.nasa.gov/...       (asteroid orbits)
The app tries the real service first and only uses these paths if the browser blocks the direct request (CORS).
"""
import os
import sys
import shutil
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

TARGETS = {
    "/proxy/irsa/": os.environ.get("INFRASPHERE_IRSA", "https://irsa.ipac.caltech.edu/"),
    "/proxy/jpl/": os.environ.get("INFRASPHERE_JPL", "https://ssd-api.jpl.nasa.gov/"),
}


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        for prefix, target in TARGETS.items():
            if self.path.startswith(prefix):
                return self.forward(target.rstrip("/") + "/" + self.path[len(prefix):])
        return super().do_GET()

    def forward(self, url):
        req = urllib.request.Request(url, headers={"User-Agent": "InfraSphere-dev-proxy", "Accept": "*/*"})
        try:
            resp = urllib.request.urlopen(req, timeout=120)
        except urllib.error.HTTPError as e:      # pass the service's own error through
            resp = e
        except Exception as e:                   # could not reach the service at all
            self.send_error(502, "Could not reach " + url.split("/")[2] + ": " + str(e))
            return
        try:
            self.send_response(resp.status if hasattr(resp, "status") else resp.code)
            for h in ("Content-Type", "Content-Length"):
                if resp.headers.get(h):
                    self.send_header(h, resp.headers[h])
            self.end_headers()
            shutil.copyfileobj(resp, self.wfile, 65536)
        except (BrokenPipeError, ConnectionResetError):
            pass                                  # the page cancelled the download on purpose (it only needs the image)
        finally:
            resp.close()

    def log_message(self, fmt, *args):
        if "/proxy/" in (args[0] if args else ""):
            sys.stderr.write("proxy  " + fmt % args + "\n")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    here = os.path.dirname(os.path.abspath(__file__))
    os.chdir(here)
    print(f"InfraSphere: http://localhost:{port}   (Ctrl+C to stop)")
    ThreadingHTTPServer(("", port), Handler).serve_forever()
