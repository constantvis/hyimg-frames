"""A small dev server for the editor mockups (Concepts/html): static files plus POST /api/inpaint, the content-aware fill
with LaMa (lama.py). The Hyimg server serves the same routes from routes.py at /api/plugin/frames/(inpaint|subject) (2026-10-05);
the mockups keep talking to this one.

  python3 serve.py 4196 <mockups>/Concepts/html
  POST /api/inpaint {"image": "data:image/png;base64,…", "mask": "data:image/png;base64,…"} → {"image": "data:image/png;base64,…", "ms": 2900}
  POST /api/subject {"image": "data:…"} → {"mask": "data:image/png;base64,…" (white = the subject), "ms": 500}, macOS Vision (subject.py)
Byte ranges are served too, so a <video> can seek.
"""
import http.server
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from routes import ROUTES  # noqa: E402

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4196
ROOT = os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else ".")


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().do_GET()
        size = os.path.getsize(path); m = re.match(r"bytes=(\d*)-(\d*)", rng)
        a = int(m.group(1)) if m.group(1) else 0
        b = int(m.group(2)) if m.group(2) else size - 1
        b = min(b, size - 1)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path)); self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", f"bytes {a}-{b}/{size}"); self.send_header("Content-Length", str(b - a + 1))
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(a); self.wfile.write(f.read(b - a + 1))

    def do_POST(self):
        fn = {"/api/inpaint": ROUTES["inpaint"], "/api/subject": ROUTES["subject"]}.get(self.path)
        if not fn:
            return self.send_error(404)
        try:
            code, ctype, body = fn(self.rfile.read(int(self.headers.get("Content-Length", 0))))
        except Exception as e:
            import json
            code, ctype, body = 500, "application/json", json.dumps({"error": str(e)}, ensure_ascii=False).encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(body)))
        self.end_headers(); self.wfile.write(body)


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
