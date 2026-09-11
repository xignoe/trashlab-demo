#!/usr/bin/env python3
"""Static server for the check-in hub. Serves the repo root so the hub can link to shared/ docs, and redirects / to /checkin/."""
import http.server, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5170

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)
    def do_GET(self):
        if self.path in ("/", ""):
            self.send_response(302); self.send_header("Location", "/checkin/"); self.end_headers(); return
        super().do_GET()
    def guess_type(self, path):
        return "text/plain; charset=utf-8" if path.endswith(".md") else super().guess_type(path)
    def log_message(self, *a):
        pass

http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
