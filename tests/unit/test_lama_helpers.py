"""lama.py without the model: the crop around the mask, the box blur and normalised convolution, the seam match (owner 2026-10-05: on
burgundy the healed spot came out lighter than around it) and fill() around a stand-in onnxruntime session."""
import sys
import types

import pytest

np = pytest.importorskip("numpy")


class Session:
    """an InferenceSession stand-in: answers one colour everywhere, in 0..1 or 0..255 as some LaMa exports do"""

    def __init__(self, rgb, scale=1.0):
        self.rgb, self.scale, self.feeds = rgb, scale, []

    def run(self, outputs, feeds):
        self.feeds.append(feeds)
        out = np.empty((1, 3, 512, 512), np.float32)
        for c in range(3):
            out[0, c] = self.rgb[c] / 255 * self.scale
        return [out]


def no_session():
    raise AssertionError("the model must not run")


# ---- _box


def test_an_empty_mask_has_no_box(lama):
    assert lama._box(np.zeros((50, 60), np.uint8)) is None


def test_a_small_stroke_gets_at_least_64_px_of_surroundings_in_a_square(lama):
    m = np.zeros((400, 400), np.uint8)
    m[100, 100] = 255
    assert lama._box(m) == (36, 165, 36, 165)


def test_a_large_stroke_gets_surroundings_of_six_tenths_of_its_size(lama):
    m = np.zeros((1000, 1000), np.uint8)
    m[400:600, 450:550] = 255
    y0, y1, x0, x1 = lama._box(m)
    assert (y0, y1) == (280, 720) and y1 - y0 == x1 - x0


def test_a_stroke_in_the_corner_gets_a_box_shifted_inside_the_picture(lama):
    m = np.zeros((400, 400), np.uint8)
    m[5, 5] = 255
    assert lama._box(m) == (0, 70, 0, 70)


def test_a_stroke_wider_than_the_picture_is_tall_gets_the_full_height(lama):
    m = np.zeros((100, 1000), np.uint8)
    m[40:60, 100:900] = 255
    assert lama._box(m) == (0, 100, 0, 1000)


def test_the_box_always_holds_the_whole_mask_and_stays_inside_the_picture(lama):
    rng = np.random.default_rng(7)
    for _ in range(60):
        h, w = rng.integers(20, 300, 2)
        m = np.zeros((h, w), np.uint8)
        ys, xs = sorted(rng.integers(0, h, 2)), sorted(rng.integers(0, w, 2))
        m[ys[0]:ys[1] + 1, xs[0]:xs[1] + 1] = 255
        y0, y1, x0, x1 = lama._box(m)
        assert 0 <= y0 < y1 <= h and 0 <= x0 < x1 <= w
        assert m[y0:y1, x0:x1].sum() == m.sum()


# ---- _blur and _nconv


def naive_blur(a, r):
    for ax in (0, 1):
        n = a.shape[ax]
        idx = [np.clip(np.arange(n) + k, 0, n - 1) for k in range(-r, r + 1)]
        a = sum(np.take(a, i, axis=ax) for i in idx) / (2 * r + 1)
    return a


@pytest.mark.parametrize("r", [1, 2, 4])
def test_the_box_blur_is_the_mean_over_its_radius_with_the_edges_clamped(lama, r):
    a = np.random.default_rng(r).random((13, 9, 3))
    assert np.allclose(lama._blur(a, r), naive_blur(a, r))


def test_a_blur_of_radius_under_one_changes_nothing(lama):
    a = np.arange(12.0).reshape(3, 4)
    assert lama._blur(a, 0) is a


def test_normalised_convolution_takes_only_the_weighted_pixels(lama):
    val = np.full((20, 20, 3), 200.0)
    w = np.zeros((20, 20))
    val[:, :10], w[:, :10] = 10.0, 1
    assert np.allclose(lama._nconv(val, w, 5), 10.0)


# ---- seam_match


def scene(fill_delta, size=60, hole=(20, 40)):
    src = np.empty((size, size, 3), np.uint8)
    src[:] = (120, 20, 40)   # burgundy
    out = src.copy()
    h = np.zeros((size, size), bool)
    h[hole[0]:hole[1], hole[0]:hole[1]] = True
    out[h] = np.clip(src[h].astype(int) + fill_delta, 0, 255)
    return src, out, h


def test_a_fill_lighter_than_calm_surroundings_takes_their_colour(lama):
    src, out, hole = scene(10)
    res = lama.seam_match(src, out, hole)
    assert res.dtype == np.uint8
    assert np.abs(res[hole].astype(int) - src[hole]).max() <= 1
    assert np.array_equal(res[~hole], out[~hole])


def test_a_matched_fill_is_exactly_the_colour_of_calm_surroundings(lama):
    src, out, hole = scene(10)
    assert np.array_equal(lama.seam_match(src, out, hole)[hole], src[hole])


def test_the_fill_moves_by_at_most_fourteen_levels(lama):
    src, out, hole = scene(40)
    res = lama.seam_match(src, out, hole)
    assert np.array_equal(res[hole].astype(int) - out[hole], np.full((hole.sum(), 3), -14))


def test_around_an_edge_or_a_pattern_the_fill_is_left_as_lama_made_it(lama):
    src, out, hole = scene(10)
    noise = np.random.default_rng(1).integers(0, 256, src.shape).astype(np.uint8)
    src[~hole], out[~hole] = noise[~hole], noise[~hole]
    assert np.array_equal(lama.seam_match(src, out, hole), out)


def test_a_hole_of_under_nine_pixels_is_not_matched(lama):
    src, out, hole = scene(10, hole=(20, 22))
    assert lama.seam_match(src, out, hole) is out


# ---- fill


def test_an_empty_mask_gives_back_a_copy_without_running_the_model(lama, monkeypatch):
    monkeypatch.setattr(lama, "session", no_session)
    rgb = np.random.default_rng(2).integers(0, 256, (30, 40, 3)).astype(np.uint8)
    res = lama.fill(rgb, np.full((30, 40), 127, np.uint8))   # 127 and below is not a stroke
    assert np.array_equal(res, rgb) and res is not rgb


def test_the_model_gets_a_512_square_picture_and_a_binary_mask(lama, monkeypatch):
    s = Session((120, 20, 40))
    monkeypatch.setattr(lama, "session", lambda: s)
    rgb = np.zeros((300, 200, 4), np.uint8)
    m = np.zeros((300, 200), np.uint8)
    m[100:120, 80:90] = 200
    assert lama.fill(rgb, m).shape == (300, 200, 3)
    feeds = s.feeds[0]
    assert feeds["image"].shape == (1, 3, 512, 512) and feeds["image"].dtype == np.float32
    assert feeds["image"].max() <= 1.0
    assert feeds["mask"].shape == (1, 1, 512, 512) and set(np.unique(feeds["mask"])) == {0.0, 1.0}


@pytest.mark.parametrize("scale", [1.0, 255.0])
def test_the_hole_is_filled_and_nothing_outside_the_crop_changes(lama, monkeypatch, scale):
    monkeypatch.setattr(lama, "session", lambda: Session((90, 160, 30), scale))
    rgb = np.zeros((400, 400, 3), np.uint8)
    rgb[:] = (90, 160, 30)
    rgb[195:205, 195:205] = (255, 255, 255)   # the spot to heal
    m = np.zeros((400, 400), np.uint8)
    m[195:205, 195:205] = 255
    res = lama.fill(rgb, m)
    assert np.abs(res[198:202, 198:202].astype(int) - (90, 160, 30)).max() <= 2   # the inside of the stroke
    left = (res[195:205, 195:205, 0].astype(float) - 90) / (255 - 90)            # how much of the old white is left
    assert left.max() <= 0.25
    y0, y1, x0, x1 = lama._box((m > 127).astype(np.uint8) * 255)
    outside = np.ones((400, 400), bool)
    outside[y0:y1, x0:x1] = False
    assert np.array_equal(res[outside], rgb[outside])


@pytest.mark.xfail(strict=True, reason="lama.py:107 the feather (GaussianBlur(2) of a mask widened by only 2 px at :98) reaches into the "
                                       "painted stroke: its edge keeps 11 %, its corners 20 % of the old pixels, the rim the widening is meant to prevent")
def test_every_painted_pixel_is_replaced_by_the_fill(lama, monkeypatch):
    monkeypatch.setattr(lama, "session", lambda: Session((90, 160, 30)))
    rgb = np.zeros((400, 400, 3), np.uint8)
    rgb[:] = (90, 160, 30)
    rgb[195:205, 195:205] = (255, 255, 255)
    m = np.zeros((400, 400), np.uint8)
    m[195:205, 195:205] = 255
    left = (lama.fill(rgb, m)[195:205, 195:205, 0].astype(float) - 90) / (255 - 90)
    assert left.max() <= 0.03


# ---- session


@pytest.fixture
def fake_ort(monkeypatch):
    made = []

    class SessionOptions:
        log_severity_level = 0

    def InferenceSession(path, opts, providers=None):
        made.append({"path": path, "log": opts.log_severity_level, "providers": providers})
        return object()

    monkeypatch.setitem(sys.modules, "onnxruntime", types.SimpleNamespace(SessionOptions=SessionOptions, InferenceSession=InferenceSession))
    return made


def test_without_the_model_file_the_session_fails_and_is_not_kept(lama, fake_ort):
    with pytest.raises(FileNotFoundError, match="LaMa model is missing"):
        lama.session()
    assert lama._sess is None and fake_ort == []


def test_the_session_is_made_once_on_the_cpu_and_kept(lama, fake_ort, monkeypatch, tmp_path):
    model = tmp_path / "lama_fp32.onnx"
    model.write_bytes(b"onnx")
    monkeypatch.setattr(lama, "MODEL", str(model))
    a, b = lama.session(), lama.session()
    assert a is b and fake_ort == [{"path": str(model), "log": 3, "providers": ["CPUExecutionProvider"]}]


def test_the_model_path_comes_from_hyimg_lama_with_the_home_folder_expanded(monkeypatch):
    import importlib.util
    from pathlib import Path
    monkeypatch.setenv("HYIMG_LAMA", "~/models/x.onnx")
    spec = importlib.util.spec_from_file_location("hyimg_frames_lama_env_unit", Path(__file__).resolve().parents[2] / "inpaint/lama.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.MODEL == str(Path.home() / "models/x.onnx")
