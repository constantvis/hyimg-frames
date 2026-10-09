"""Fast unit tests of the frames plugin's server side (inpaint/): routes.py, lama.py, serve.py. No LaMa model, no onnxruntime session,
no macOS Vision, no server, no network: the heavy parts are stand-ins.

  python3 -m pytest tests/unit -q

The modules are loaded by file path under names of their own (as Hyimg's server and routes._mod() load them), so nothing of inpaint/
is left on sys.path. Each test runs with the HYIMG_* settings cleared and the LaMa model pointed at a file that does not exist.
"""
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

import pytest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
INPAINT = ROOT / "inpaint"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# The core's guard (hyimg/tests/procguard.py) also when pytest runs tests/unit alone, which does not load tests/conftest.py: the
# session's own cache folder, and the check of the person's ~/Library/Caches/Hyimg when the session ends
_GUARD = Path(os.environ.get("HYIMG_REPO") or ROOT.parent / "hyimg") / "tests" / "procguard.py"
procguard = sys.modules.get("procguard")
if procguard is None and _GUARD.is_file():
    _spec = importlib.util.spec_from_file_location("procguard", _GUARD)
    procguard = sys.modules["procguard"] = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(procguard)
if procguard:
    procguard.install()
CACHE = procguard.CACHE if procguard else tempfile.mkdtemp(prefix="hyimg-test-cache-")

for _k in [k for k in os.environ if k.startswith(("HYIMG_", "REVIEW_"))]:
    del os.environ[_k]
os.environ["HYIMG_CACHE_ROOT"] = CACHE   # cleared with the rest and put back: nothing falls back to ~/Library/Caches/Hyimg
os.environ["HYIMG_LAMA"] = "/nonexistent/hyimg-unit/lama_fp32.onnx"   # lama.py reads it at import


def load(name, unique):
    spec = importlib.util.spec_from_file_location(unique, INPAINT / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    for k in [k for k in os.environ if k.startswith(("HYIMG_", "REVIEW_"))]:
        monkeypatch.delenv(k)
    monkeypatch.setenv("HYIMG_CACHE_ROOT", CACHE)
    monkeypatch.setenv("HYIMG_LAMA", "/nonexistent/hyimg-unit/lama_fp32.onnx")
    monkeypatch.delitem(sys.modules, "config", raising=False)


@pytest.fixture
def routes():
    """a fresh routes.py: its own _MODS, so a stand-in lama or subject put there stays in this test"""
    return load("routes", "hyimg_frames_routes_unit")


@pytest.fixture(scope="session")
def lama_module():
    pytest.importorskip("numpy")
    pytest.importorskip("PIL")
    return load("lama", "hyimg_frames_lama_unit")


@pytest.fixture
def lama(lama_module, monkeypatch):
    """lama.py with no session loaded and the model path in nowhere; a test sets its own stand-in session"""
    monkeypatch.setattr(lama_module, "_sess", None)
    monkeypatch.setattr(lama_module, "MODEL", "/nonexistent/hyimg-unit/lama_fp32.onnx")
    return lama_module


@pytest.fixture
def library(tmp_path, monkeypatch):
    lib = tmp_path / "lib"
    (lib / "frames").mkdir(parents=True)
    monkeypatch.setenv("HYIMG_LIBRARY_ROOT", str(lib))
    return lib


def pytest_sessionfinish(session, exitstatus):   # once a session, with tests/conftest.py or without it
    if procguard:
        procguard.finish(session)
