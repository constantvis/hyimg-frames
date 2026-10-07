"""routes.py's versions and prune (owner 2026-10-05: Save never overwrites, so undo on the board finds the version it goes back to): the
frame folder check, the version numbers, and that pruning removes only old versions and the files no kept version needs, only inside
that frame's own folder. Everything is in a tmp library."""
import json
import os
import sys
import types

import pytest


def call(fn, obj):
    code, ctype, data = fn(obj if isinstance(obj, bytes) else json.dumps(obj).encode())
    assert ctype == "application/json"
    return code, json.loads(data)


def frame(library, stamp="260105-1200"):
    d = library / "frames" / stamp
    d.mkdir(parents=True)
    return d


def save(d, n, doc=None, render=True):
    rel = f"frames/{d.name}"
    name = "frame.json" if n == 0 else f"frame.{n}.json"
    (d / name).write_text(doc if isinstance(doc, str) else json.dumps(doc or {"render": f"{rel}/render.{n}.png" if n else f"{rel}/render.png", "layers": []}))
    if render:
        (d / ("render.png" if n == 0 else f"render.{n}.png")).write_bytes(b"png")


def touch(d, *names):
    for n in names:
        (d / n).parent.mkdir(parents=True, exist_ok=True)
        (d / n).write_bytes(b"png")


# ---- the frame folder


def test_a_frame_folder_of_the_library_is_resolved(library, routes):
    d = frame(library)
    assert routes._frame_dir("frames/260105-1200") == os.path.realpath(d)


@pytest.mark.parametrize("rel", ["frames/../secret", "frames/a/b", "frames/", "frames", "other/x", "/frames/x", "frames/a b", "frames/a.b", "", None, 3, ["frames/x"]])
def test_anything_but_frames_slash_one_name_is_refused(library, routes, rel):
    with pytest.raises(ValueError):
        routes._frame_dir(rel)


def test_a_frame_folder_that_is_a_symlink_out_of_the_library_is_refused(library, routes, tmp_path):
    (tmp_path / "elsewhere").mkdir()
    (library / "frames/evil").symlink_to(tmp_path / "elsewhere")
    with pytest.raises(ValueError):
        routes._frame_dir("frames/evil")


def test_without_a_library_no_frame_folder_is_resolved(routes):
    with pytest.raises(ValueError, match="no library root"):
        routes._frame_dir("frames/x")


def test_the_servers_config_module_names_the_library_when_the_env_does_not(routes, tmp_path, monkeypatch):
    (tmp_path / "frames/x").mkdir(parents=True)
    monkeypatch.setitem(sys.modules, "config", types.SimpleNamespace(W=str(tmp_path)))
    assert routes._frame_dir("frames/x") == os.path.realpath(tmp_path / "frames/x")


# ---- versions


def test_a_phase_one_frame_is_version_zero_and_the_saves_count_up(library, routes):
    d = frame(library)
    save(d, 0)
    save(d, 1)
    save(d, 12)
    touch(d, "frame.json.bak", "frame.x.json", "frame.1234567.json", "notes.json")
    assert call(routes.versions, {"dir": "frames/260105-1200"}) == (200, {"versions": [0, 1, 12], "next": 13})


def test_a_frame_without_versions_starts_at_one(library, routes):
    frame(library)
    assert call(routes.versions, {"dir": "frames/260105-1200"})[1] == {"versions": [], "next": 1}


def test_a_frame_folder_that_does_not_exist_has_no_versions(library, routes):
    assert call(routes.versions, {"dir": "frames/never-made"})[1] == {"versions": [], "next": 1}


@pytest.mark.parametrize("body", [b"{", b"[]", b"{}", json.dumps({"dir": "../x"}).encode(), json.dumps({"dir": "frames/a/../../b"}).encode()])
def test_versions_answers_400_to_a_bad_request(library, routes, body):
    assert call(routes.versions, body)[0] == 400


# ---- prune


@pytest.fixture
def history(library):
    """versions 0..3 of one frame: a layer and a mask only version 0 used, a layer versions 1 and 3 share, a child layer of version 2"""
    d = frame(library)
    r = f"frames/{d.name}"
    save(d, 0, {"render": f"{r}/render.png", "layers": [{"file": f"{r}/layers/a.png", "mask": {"file": f"{r}/masks/m.png"}}]})
    save(d, 1, {"render": f"{r}/render.1.png", "layers": [{"file": f"{r}/layers/a.1.png"}]})
    save(d, 2, {"render": f"{r}/render.2.png", "layers": [{"id": "g", "children": [{"file": f"{r}/layers/b.2.png"}]}]})
    save(d, 3, {"render": f"{r}/render.3.png", "layers": [{"file": f"{r}/layers/a.1.png", "mask": {"file": f"{r}/masks/m.3.png"}}, {"mask": "inline"}]})
    touch(d, "layers/a.png", "layers/a.1.png", "layers/b.2.png", "masks/m.png", "masks/m.3.png", "layers/notes.txt", "layers/x.y.png", "layers/old.1.png")
    return d


def test_prune_keeps_the_newest_versions_with_every_file_they_need(history, routes):
    code, d = call(routes.prune, {"dir": "frames/260105-1200", "keep": 2})
    assert code == 200 and d["kept"] == [2, 3]
    assert set(d["removed"]) == {"frame.json", "render.png", "frame.1.json", "render.1.png", "layers/a.png", "masks/m.png", "layers/old.1.png"}
    left = {str(p.relative_to(history)) for p in history.rglob("*") if p.is_file()}
    assert left == {"frame.2.json", "render.2.png", "frame.3.json", "render.3.png", "layers/a.1.png", "layers/b.2.png", "masks/m.3.png",
                    "layers/notes.txt", "layers/x.y.png"}


def test_prune_with_nothing_old_removes_nothing_not_even_unused_layers(history, routes):
    d = call(routes.prune, {"dir": "frames/260105-1200"})[1]
    assert d == {"kept": [0, 1, 2, 3], "removed": []}
    assert (history / "layers/old.1.png").exists()


def test_prune_never_touches_another_frames_folder(library, history, routes):
    other = frame(library, "other")
    save(other, 0)
    touch(other, "layers/a.png")
    call(routes.prune, {"dir": "frames/260105-1200", "keep": 1})
    assert (other / "frame.json").exists() and (other / "render.png").exists() and (other / "layers/a.png").exists()


@pytest.mark.parametrize("keep, kept", [(0, [3]), (-4, [3]), (1, [3]), ("2", [2, 3]), (2.9, [2, 3])])
def test_prune_keeps_at_least_one_version(history, routes, keep, kept):
    assert call(routes.prune, {"dir": "frames/260105-1200", "keep": keep})[1]["kept"] == kept


def test_prune_keeps_at_most_fifty_versions(library, routes):
    d = frame(library)
    for n in range(1, 53):
        save(d, n, render=False)
    res = call(routes.prune, {"dir": f"frames/{d.name}", "keep": 1000})[1]
    assert res["kept"] == list(range(3, 53)) and set(res["removed"]) == {"frame.1.json", "frame.2.json"}


@pytest.mark.parametrize("body", [b"{", b"[]", json.dumps({"dir": "frames/x", "keep": "ten"}).encode(), json.dumps({"dir": "frames/x", "keep": None}).encode(),
                                  json.dumps({"dir": "frames/x", "keep": [1]}).encode(), json.dumps({"dir": "../x"}).encode()])
def test_prune_answers_400_to_a_bad_request(library, routes, body):
    assert call(routes.prune, body)[0] == 400


def test_a_kept_version_that_cannot_be_read_still_keeps_its_render(library, routes):
    d = frame(library)
    save(d, 1)
    save(d, 2, "{broken")
    touch(d, "render.2.png")
    res = call(routes.prune, {"dir": f"frames/{d.name}", "keep": 1})[1]
    assert res["kept"] == [2] and (d / "render.2.png").exists() and not (d / "frame.1.json").exists()


def test_a_kept_version_whose_json_is_not_an_object_does_not_break_prune(library, routes):
    d = frame(library)
    save(d, 1)
    save(d, 2, "[1, 2]")
    assert call(routes.prune, {"dir": f"frames/{d.name}", "keep": 1})[0] == 200
