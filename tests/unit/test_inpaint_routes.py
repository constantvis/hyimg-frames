"""routes.py's inpaint and subject routes (owner 2026-10-05: the editor's content-aware fill and subject mask live in Hyimg's own server):
request parsing, the 503 «fallback: local» answers when LaMa or Vision is not there, and what goes in and out of the model. LaMa and
Vision are stand-ins put into routes._MODS."""
import base64
import io
import json
import types

import pytest

np = pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")


def png_url(im):
    b = io.BytesIO()
    im.save(b, "PNG")
    return "data:image/png;base64," + base64.b64encode(b.getvalue()).decode()


def from_url(url):
    assert url.startswith("data:image/png;base64,")
    return Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1])))


def call(fn, obj):
    code, ctype, data = fn(obj if isinstance(obj, bytes) else json.dumps(obj).encode())
    assert ctype == "application/json"
    return code, json.loads(data)


@pytest.fixture
def fake_lama(routes, tmp_path):
    model = tmp_path / "lama_fp32.onnx"
    model.write_bytes(b"onnx")
    seen = []

    def fill(rgb, mask):
        seen.append((rgb.copy(), mask.copy()))
        return 255 - rgb
    mod = types.SimpleNamespace(MODEL=str(model), fill=fill, seen=seen)
    routes._MODS["lama"] = mod
    return mod


@pytest.fixture
def picture():
    im = Image.new("RGBA", (6, 4), (10, 20, 30, 255))
    im.putpixel((0, 0), (200, 100, 50, 0))
    im.putpixel((5, 3), (1, 2, 3, 128))
    return im


# ---- inpaint


def test_without_the_lama_model_inpaint_answers_503_and_tells_the_editor_to_fill_by_itself(routes, tmp_path):
    routes._MODS["lama"] = types.SimpleNamespace(MODEL=str(tmp_path / "missing.onnx"), fill=None)
    code, d = call(routes.inpaint, b"not even json")
    assert code == 503 and d["fallback"] == "local" and "missing.onnx" in d["error"]


def test_inpaint_gives_the_model_rgb_and_a_mask_scaled_to_the_picture_and_keeps_the_alpha(routes, fake_lama, picture):
    mask = Image.new("L", (3, 2), 0)
    mask.putpixel((1, 1), 255)
    code, d = call(routes.inpaint, {"image": png_url(picture), "mask": png_url(mask)})
    assert code == 200 and isinstance(d["ms"], int)
    rgb, m = fake_lama.seen[0]
    assert rgb.shape == (4, 6, 3) and m.shape == (4, 6)
    assert m.max() > 127 and m[0, 0] == 0   # resized smoothly, the stroke still reads as a stroke
    out = from_url(d["image"])
    assert out.mode == "RGBA" and out.size == (6, 4)
    assert out.getpixel((0, 0)) == (55, 155, 205, 0)
    assert out.getpixel((5, 3)) == (254, 253, 252, 128)


def test_inpaint_takes_plain_base64_without_the_data_prefix(routes, fake_lama, picture):
    url = png_url(picture).split(",", 1)[1]
    assert call(routes.inpaint, {"image": url, "mask": url})[0] == 200


@pytest.mark.parametrize("body", [
    b"{broken",
    b"[]",
    b"null",
    json.dumps({"image": "data:image/png;base64,AAAA"}).encode(),                   # no mask
    json.dumps({"mask": "data:image/png;base64,AAAA"}).encode(),                    # no image
    json.dumps({"image": "data:image/png;base64,bm90IGEgcGljdHVyZQ==", "mask": "data:image/png;base64,bm90IGEgcGljdHVyZQ=="}).encode(),
    json.dumps({"image": "data:image/png;base64,A", "mask": "data:image/png;base64,A"}).encode(),   # bad padding
])
def test_inpaint_answers_400_to_a_request_it_cannot_read(routes, fake_lama, body):
    code, d = call(routes.inpaint, body)
    assert code == 400 and d["error"].startswith("bad request")
    assert fake_lama.seen == []


def test_inpaint_answers_400_when_the_image_is_not_a_string(routes, fake_lama):
    assert call(routes.inpaint, {"image": 5, "mask": 5})[0] == 400


# ---- subject


@pytest.fixture
def fake_subject(routes):
    seen = []

    def mask(data):
        seen.append(data)
        m = np.zeros((3, 5), np.uint8)
        m[1, 2] = 255
        return m
    routes._MODS["subject"] = types.SimpleNamespace(mask=mask, seen=seen)
    return routes._MODS["subject"]


def test_subject_hands_the_picture_bytes_to_vision_and_answers_a_png_mask(routes, fake_subject, picture):
    url = png_url(picture)
    code, d = call(routes.subject, {"image": url})
    assert code == 200 and isinstance(d["ms"], int)
    assert fake_subject.seen == [base64.b64decode(url.split(",", 1)[1])]
    m = from_url(d["mask"])
    assert m.mode == "L" and m.size == (5, 3) and m.getpixel((2, 1)) == 255 and m.getpixel((0, 0)) == 0


@pytest.mark.parametrize("body", [b"{", b"[]", b"{}", json.dumps({"image": "data:image/png;base64,A"}).encode()])
def test_subject_answers_400_to_a_request_it_cannot_read(routes, fake_subject, body):
    assert call(routes.subject, body)[0] == 400
    assert fake_subject.seen == []


def test_without_macos_vision_subject_answers_503_and_tells_the_editor_to_find_it_by_itself(routes, monkeypatch, picture):
    def no_vision(name):
        raise ImportError("No module named 'Vision'")
    monkeypatch.setattr(routes, "_mod", no_vision)
    code, d = call(routes.subject, {"image": png_url(picture)})
    assert code == 503 and d["fallback"] == "local" and "Vision" in d["error"]


def test_a_request_subject_cannot_read_is_a_400_even_without_vision(routes, monkeypatch):
    monkeypatch.setattr(routes, "_mod", lambda name: (_ for _ in ()).throw(ImportError("no Vision")))
    assert call(routes.subject, b"{")[0] == 400


def test_a_vision_failure_is_left_to_the_server_which_answers_500(routes):
    def mask(data):
        raise RuntimeError("Vision: request failed")
    routes._MODS["subject"] = types.SimpleNamespace(mask=mask)
    with pytest.raises(RuntimeError):
        routes.subject(json.dumps({"image": "data:image/png;base64,AAAA"}).encode())


def test_subject_answers_400_when_the_image_is_not_a_string(routes, fake_subject):
    assert call(routes.subject, {"image": ["data:..."]})[0] == 400


# ---- loading lama.py and subject.py


def test_a_helper_module_is_loaded_once_from_the_plugin_folder_under_a_name_of_its_own(routes, monkeypatch, tmp_path):
    (tmp_path / "helper.py").write_text("LOADS = []\nLOADS.append(1)\n")
    monkeypatch.setattr(routes, "HERE", str(tmp_path))
    a, b = routes._mod("helper"), routes._mod("helper")
    assert a is b and a.LOADS == [1] and a.__name__ == "hyimg_frames_helper"
    import sys
    assert "hyimg_frames_helper" not in sys.modules and "helper" not in sys.modules


def test_a_helper_that_cannot_be_imported_is_not_remembered(routes, monkeypatch, tmp_path):
    (tmp_path / "helper.py").write_text("import a_module_that_is_not_there\n")
    monkeypatch.setattr(routes, "HERE", str(tmp_path))
    with pytest.raises(ImportError):
        routes._mod("helper")
    assert "helper" not in routes._MODS


def test_the_routes_table_names_the_four_routes(routes):
    assert set(routes.ROUTES) == {"inpaint", "subject", "versions", "prune"}
