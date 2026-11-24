#!/usr/bin/env python3
"""Tiny local labelling server: serves this folder, saves answers to labels.json (one entry per clip)."""
import json, os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
LABELS = os.path.join(HERE, "labels.json")


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/labels":
            body = open(LABELS, "rb").read() if os.path.exists(LABELS) else b"{}"
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/label":
            self.send_error(404); return
        item = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        labels = json.load(open(LABELS)) if os.path.exists(LABELS) else {}
        labels[str(item["id"])] = item
        tmp = LABELS + ".tmp"
        json.dump(labels, open(tmp, "w"), indent=1); os.replace(tmp, LABELS)
        self.send_response(204); self.end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f"http://localhost:{port}", flush=True)
ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
