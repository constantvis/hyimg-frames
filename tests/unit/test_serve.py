"""serve.py, the small dev server of the editor mockups: its POST routing to routes.py and its byte ranges (so a <video> can seek). The
handler is driven without a socket (its rfile and wfile are in memory) and routes.py is a stand-in, so no port is opened."""
import importlib.util
import io
import json
import sys
import types
from email.message import Message
from pathlib import Path

import pytest

SERVE = Path(__file__).resolve().parents[2] / "inpaint" / "serve.py"


@pytest.fixture
def serve(tmp_path, monkeypatch):
    """serve.py loaded with the site in tmp_path and a stand-in routes module (serve.py puts inpaint/ on sys.path: it is put back)"""
    calls = []

    def inpaint(body, query=None):
        calls.append(("inpaint", body))
        return 200, "application/json", b'{"image": "x"}'

    def subject(body, query=None):
        raise RuntimeError("Vision went away")

    monkeypatch.setitem(sys.modules, "routes", types.SimpleNamespace(ROUTES={"inpaint": inpaint, "subject": subject}))
    monkeypatch.setattr(sys, "path", list(sys.path))
    monkeypatch.setattr(sys, "argv", ["serve.py", "0", str(tmp_path)])
    spec = importlib.util.spec_from_file_location("hyimg_frames_serve_unit", SERVE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.calls = calls
    return mod


def request(serve, method, path, headers=None, body=b""):
    h = object.__new__(serve.H)
    h.directory, h.path, h.command = serve.ROOT, path, method
    h.request_version, h.requestline, h.client_address = "HTTP/1.1", f"{method} {path} HTTP/1.1", ("127.0.0.1", 0)
    h.headers = Message()
    for k, v in (headers or {}).items():
        h.headers[k] = v
    if body:
        h.headers["Content-Length"] = str(len(body))
    h.rfile, h.wfile = io.BytesIO(body), io.BytesIO()
    getattr(h, "do_" + method)()
    head, _, data = h.wfile.getvalue().partition(b"\r\n\r\n")
    lines = head.decode("latin-1").split("\r\n")
    hdrs = dict(line.split(": ", 1) for line in lines[1:])
    return int(lines[0].split()[1]), hdrs, data


def test_the_site_root_and_port_come_from_the_command_line(serve, tmp_path):
    assert serve.ROOT == str(tmp_path) and serve.PORT == 0


def test_post_api_inpaint_goes_to_the_inpaint_route_with_the_body(serve):
    code, hdrs, data = request(serve, "POST", "/api/inpaint", body=b'{"image": "a"}')
    assert code == 200 and hdrs["Content-Type"] == "application/json" and data == b'{"image": "x"}'
    assert hdrs["Cache-Control"] == "no-store" and hdrs["Content-Length"] == str(len(data))
    assert serve.calls == [("inpaint", b'{"image": "a"}')]


def test_a_post_to_any_other_path_is_404(serve):
    assert request(serve, "POST", "/api/plugin/frames/prune", body=b"{}")[0] == 404
    assert serve.calls == []


def test_a_route_that_raises_answers_500_with_the_error_as_json(serve):
    code, hdrs, data = request(serve, "POST", "/api/subject", body=b"{}")
    assert code == 500 and json.loads(data) == {"error": "Vision went away"}


@pytest.fixture
def clip(tmp_path):
    (tmp_path / "clip.mp4").write_bytes(b"0123456789")
    return tmp_path / "clip.mp4"


@pytest.mark.parametrize("rng, span, body", [("bytes=2-5", "2-5", b"2345"), ("bytes=4-", "4-9", b"456789"), ("bytes=0-999", "0-9", b"0123456789"),
                                             ("bytes=0-0", "0-0", b"0")])
def test_a_byte_range_is_answered_206_with_only_those_bytes(serve, clip, rng, span, body):
    code, hdrs, data = request(serve, "GET", "/clip.mp4", {"Range": rng})
    assert code == 206 and data == body
    assert hdrs["Content-Range"] == f"bytes {span}/10" and hdrs["Content-Length"] == str(len(body)) and hdrs["Accept-Ranges"] == "bytes"
    assert hdrs["Content-Type"] == "video/mp4"


def test_without_a_range_the_whole_file_is_sent(serve, clip):
    code, hdrs, data = request(serve, "GET", "/clip.mp4")
    assert code == 200 and data == b"0123456789"


def test_a_range_on_a_file_that_is_not_there_is_404(serve, clip):
    assert request(serve, "GET", "/nothing.mp4", {"Range": "bytes=0-1"})[0] == 404


def test_a_suffix_range_sends_the_last_bytes(serve, clip):
    code, hdrs, data = request(serve, "GET", "/clip.mp4", {"Range": "bytes=-3"})
    assert code == 206 and data == b"789" and hdrs["Content-Range"] == "bytes 7-9/10"
