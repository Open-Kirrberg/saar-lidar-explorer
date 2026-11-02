"""F13 orthophoto: bbox/pixel-grid maths, WMS URLs, nodata compositing, levels, manifest patch, cache (no network),
plus contract checks of generated `ortho` output (skipped for AOIs where ortho.py has not run)."""
from __future__ import annotations

import io
import json
import sys
import tomllib
import urllib.parse
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ortho  # noqa: E402
from common import APP_DATA, WORK_DIR, load_aoi, merge_manifest  # noqa: E402
from levels import level_grid  # noqa: E402
from ortho import (  # noqa: E402
    ATTRIBUTION_DOP_SL, WmsClient, WmsError, block_mean_rgb, cache_name, chunk_bbox, chunk_clamped, composite_over,
    downsample2, image_layer_patch, pixel_centre, wms_getmap_url,
)

E0, N0, H = 381000, 5465000, 3000      # Karlsberg
NTOP = N0 + H


# ------------------------------------------------------------------------------------------- grid maths
def test_chunk_bbox_on_chunk_edges_and_tiles_aoi():
    assert chunk_bbox(E0, NTOP, 0, 0) == (381000, 5467500, 381500, 5468000)       # NW chunk
    assert chunk_bbox(E0, NTOP, 5, 5) == (383500, 5465000, 384000, 5465500)       # SE chunk
    assert chunk_bbox(E0, NTOP, 2, 1) == (382000, 5467000, 382500, 5467500)       # i east, j south
    # the 6 × 6 chunk bboxes tile the AOI exactly (no gaps/overlaps)
    area = sum((b[2] - b[0]) * (b[3] - b[1]) for b in (chunk_bbox(E0, NTOP, i, j) for i in range(6) for j in range(6)))
    assert area == 3000 * 3000
    boxes = [chunk_bbox(E0, NTOP, i, j) for i in range(6) for j in range(6)]
    assert min(b[0] for b in boxes) == E0 and max(b[2] for b in boxes) == E0 + 3000
    assert min(b[1] for b in boxes) == N0 and max(b[3] for b in boxes) == NTOP


def test_pixel_centre_contract_formula():
    # contract: E = E0 + i·500 + (px + 0.5)·s, N = N0 + height − j·500 − (py + 0.5)·s, s = 500 / ppc
    assert pixel_centre(E0, NTOP, 0, 0, 0, 0, 1000) == (381000.25, 5467999.75)
    assert pixel_centre(E0, NTOP, 1, 2, 999, 999, 1000) == (381999.75, 5466500.25)
    assert pixel_centre(E0, NTOP, 0, 0, 0, 0, 500) == (381000.5, 5467999.5)   # 1 m/px = DTM cell centre
    # a WMS GetMap of the chunk bbox at W × H px has pixel centres minx + (px+0.5)·(w/W), maxy − (py+0.5)·(h/H)
    for i, j, px, py in [(0, 0, 0, 0), (3, 4, 517, 12), (5, 5, 999, 999)]:
        minx, miny, maxx, maxy = chunk_bbox(E0, NTOP, i, j)
        s = (maxx - minx) / 1000
        assert pixel_centre(E0, NTOP, i, j, px, py, 1000) == (minx + (px + 0.5) * s, maxy - (py + 0.5) * s)


def test_half_metre_pixels_nest_in_1m_cells():
    # 0.5 m pixels 2c, 2c+1 straddle the 1 m cell c centre (PixelIsArea) → the 2×2 mean is the cell's value
    for c in (0, 1, 250, 499):
        e_a, _ = pixel_centre(E0, NTOP, 0, 0, 2 * c, 0, 1000)
        e_b, _ = pixel_centre(E0, NTOP, 0, 0, 2 * c + 1, 0, 1000)
        assert (e_a + e_b) / 2 == E0 + c + 0.5


def test_getmap_url_axis_order_and_params():
    bbox = chunk_bbox(E0, NTOP, 0, 0)
    u = wms_getmap_url(ortho.SL_DOP_WMS, "sl_dop20_rgb", bbox, 1000, 1000)
    q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(u).query, keep_blank_values=True))
    assert q["VERSION"] == "1.3.0" and q["CRS"] == "EPSG:25832" and "SRS" not in q
    assert q["BBOX"] == "381000,5467500,381500,5468000"   # minE,minN,maxE,maxN (EPSG:25832 is E,N in 1.3.0 too)
    assert (q["WIDTH"], q["HEIGHT"], q["FORMAT"], q["TRANSPARENT"]) == ("1000", "1000", "image/png", "TRUE")
    assert q["LAYERS"] == "sl_dop20_rgb" and q["STYLES"] == ""
    u2 = wms_getmap_url(ortho.RLP_DOP_WMS, "rp_dop20", bbox, 1000, 1000, fmt="image/png; mode=24bit")
    assert "FORMAT=image%2Fpng%3B%20mode%3D24bit" in u2 or "FORMAT=image/png%3B%20mode%3D24bit" in u2
    q2 = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(u2).query))
    assert q2["FORMAT"] == "image/png; mode=24bit"
    u3 = wms_getmap_url("https://x/proxy?", "1", (1.5, 2, 3, 4), 10, 20, version="1.1.1", transparent=False)
    q3 = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(u3).query))
    assert q3["SRS"] == "EPSG:25832" and "CRS" not in q3 and q3["BBOX"] == "1.5,2,3,4" and "TRANSPARENT" not in q3
    assert u3.startswith("https://x/proxy?SERVICE=WMS")


def test_cache_name_is_aoi_independent():
    b = chunk_bbox(E0, NTOP, 1, 1)
    assert cache_name("sl_dop20_rgb", b, 1000) == "sl_dop20_rgb_381500_5467000_500x500m_1000px.png"
    # the same chunk seen from the overall AOI (origin 378000, top 5468000) has the same name
    assert cache_name("sl_dop20_rgb", chunk_bbox(378000, 5468000, 7, 1), 1000) == cache_name("sl_dop20_rgb", b, 1000)


# ------------------------------------------------------------------------------------------- pixels
def _rgba(rgb, a, shape=(4, 4)):
    out = np.zeros((*shape, 4), np.uint8)
    out[..., :3] = rgb
    out[..., 3] = a
    return out


def test_composite_fills_nodata_per_pixel():
    sl = _rgba((200, 100, 50), 255)
    sl[0, :, 3] = 0                       # first row: SL nodata
    sl[1, 0, 3] = 128                     # partial alpha (anti-aliased data edge)
    rlp = _rgba((10, 20, 30), 255)
    rlp[0, 0, 3] = 0                      # one pixel without any data
    rgb, cov = composite_over([sl, rlp])
    assert (rgb[2:] == (200, 100, 50)).all() and (cov[2:] == 1).all()       # SL wins where it has data
    assert (rgb[0, 1:] == (10, 20, 30)).all()                               # RLP fills SL nodata
    assert (rgb[0, 0] == (0, 0, 0)).all() and cov[0, 0] == 0                # no data anywhere → black
    w = 128 / 255
    assert np.allclose(rgb[1, 0], np.rint(np.array([200, 100, 50]) * w + np.array([10, 20, 30]) * (1 - w)), atol=1)
    rgb1, cov1 = composite_over([sl])
    assert (rgb1[0] == 0).all() and (cov1[0] == 0).all()                    # SL only: nodata stays black
    rgb2, _ = composite_over([sl], background=(255, 255, 255))
    assert (rgb2[0] == 255).all()


def test_downsample2_and_block_mean_rgb():
    a = np.zeros((4, 4, 3), np.uint8)
    a[:2, :2] = (10, 20, 30)
    a[:2, 2:] = (0, 0, 0)
    a[2:, :2] = [[(0, 0, 0), (100, 100, 100)], [(100, 100, 100), (0, 0, 0)]]
    d = downsample2(a)
    assert d.shape == (2, 2, 3) and tuple(d[0, 0]) == (10, 20, 30) and tuple(d[1, 0]) == (50, 50, 50)
    # 3 × 3 at f = 2: edge clamp padding (as levels.block_mean)
    b = np.arange(27, dtype=np.uint8).reshape(3, 3, 3)
    m = block_mean_rgb(b, 2)
    assert m.shape == (2, 2, 3)
    assert tuple(m[1, 1]) == tuple(b[2, 2])                         # padded corner = clamped last cell
    assert tuple(m[0, 0]) == tuple(np.rint(b[:2, :2].reshape(-1, 3).mean(0)).astype(np.uint8))


def test_chunk_clamped_edge():
    img = np.arange(6 * 7, dtype=np.int32).reshape(6, 7)
    w = chunk_clamped(img, 1, 1, cs=4)                   # rows 4..7, cols 4..7 → clamped to 5 / 6
    assert w.shape == (4, 4) and w[0, 0] == img[4, 4] and w[-1, -1] == img[5, 6] and w[0, -1] == img[4, 6]
    rgb = np.zeros((6, 7, 3), np.uint8)
    assert chunk_clamped(rgb, 1, 1, cs=4).shape == (4, 4, 3)


# ------------------------------------------------------------------------------------------- manifest
def _manifest():
    lay = {"vat": {"path": "relief/vat/{i}_{j}.png", "encoding": "u8", "min": 0, "max": 1},
           "bldg": {"path": "relief/bldg/{i}_{j}.png", "encoding": "u8", "min": 0, "max": 1}}
    return {"version": 2, "layers": lay, "xyz": {"vat": {"url": "x"}}, "models": {"buildings": {"path": "m"}},
            "attribution": "A",
            "levels": [{"level": 0, "cellSize": 1, "layers": dict(lay)},
                       {"level": 1, "cellSize": 2, "layers": {"vat": {"path": "levels/1/vat/{i}_{j}.png"},
                                                             "ortho": {"path": "stale"}}},
                       {"level": 2, "cellSize": 4, "layers": {"vat": {"path": "levels/2/vat/{i}_{j}.png"},
                                                             "ortho": {"path": "stale"}}}]}


def test_image_layer_patch_keeps_foreign_keys():
    m = _manifest()
    e0 = {"path": "ortho/{i}_{j}.webp", "encoding": "rgb", "pixelsPerChunk": 1000}
    e1 = {**e0, "path": "ortho/levels/1/{i}_{j}.webp", "pixelsPerChunk": 500}
    patch = image_layer_patch(m, "ortho", e0, {1: e1})
    assert patch["layers"] == {"ortho": e0}
    out = merge_manifest(m, patch, merge=["layers"], attribution=[ATTRIBUTION_DOP_SL])
    assert set(out["layers"]) == {"vat", "bldg", "ortho"}
    assert out["xyz"] == m["xyz"] and out["models"] == m["models"]
    lv = out["levels"]
    assert set(lv[0]["layers"]) == {"vat", "bldg", "ortho"} and lv[0]["layers"]["ortho"] == e0
    assert lv[1]["layers"]["ortho"] == e1 and lv[1]["layers"]["vat"] == m["levels"][1]["layers"]["vat"]
    assert "ortho" not in lv[2]["layers"]                      # stale coarse entry withdrawn
    assert lv[1]["cellSize"] == 2 and out["version"] == 2
    assert out["attribution"] == f"A; {ATTRIBUTION_DOP_SL}"
    assert m["levels"][1]["layers"]["ortho"] == {"path": "stale"}  # input not mutated


def test_image_layer_patch_v1_manifest_has_no_levels():
    m = _manifest()
    del m["levels"]
    patch = image_layer_patch(m, "ortho", {"path": "p"}, {1: {"path": "q"}})
    assert "levels" not in patch


# ------------------------------------------------------------------------------------------- cache / HTTP
def _png_bytes(size=(8, 8), color=(1, 2, 3, 255)):
    buf = io.BytesIO()
    Image.new("RGBA", size, color).save(buf, "PNG")
    return buf.getvalue()


def test_client_uses_cache_without_network(tmp_path, monkeypatch):
    c = WmsClient(tmp_path / "sl")
    (tmp_path / "sl").mkdir()
    (tmp_path / "sl" / "a.png").write_bytes(_png_bytes())
    monkeypatch.setattr(c, "fetch", lambda url: pytest.fail("network used"))
    arr = c.image("http://unused", "a.png", (8, 8))
    assert arr.shape == (8, 8, 4) and tuple(arr[0, 0]) == (1, 2, 3, 255) and c.cached == 1


def test_client_links_sibling_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(ortho, "RAW_DIR", tmp_path)
    (tmp_path / "ortho" / "other" / "sl").mkdir(parents=True)
    (tmp_path / "ortho" / "other" / "sl" / "a.png").write_bytes(_png_bytes())
    c = WmsClient(tmp_path / "ortho" / "mine" / "sl", share_glob="ortho/*/sl")
    monkeypatch.setattr(c, "fetch", lambda url: pytest.fail("network used"))
    c.image("http://unused", "a.png", (8, 8))
    assert (tmp_path / "ortho" / "mine" / "sl" / "a.png").exists() and c.linked == 1


def test_client_refetches_wrong_size_and_validates(tmp_path, monkeypatch):
    c = WmsClient(tmp_path)
    (tmp_path / "a.png").write_bytes(_png_bytes((4, 4)))
    monkeypatch.setattr(c, "fetch", lambda url: (_png_bytes((8, 8)), "image/png"))
    assert c.image("u", "a.png", (8, 8)).shape == (8, 8, 4)
    assert Image.open(tmp_path / "a.png").size == (8, 8)
    with pytest.raises(WmsError):
        c.image("u", "b.png", (16, 16))              # service returned the wrong size → error, nothing cached
    assert not (tmp_path / "b.png").exists()


class _Resp:
    def __init__(self, data, ctype):
        self.data, self.headers = data, {"Content-Type": ctype}

    def read(self):
        return self.data

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_client_retries_non_image_answer_and_primes_once(tmp_path, monkeypatch):
    monkeypatch.setattr(ortho.time, "sleep", lambda s: None)
    calls = []
    answers = [_Resp(b"prime", "image/png"), _Resp(b"<ServiceException/>", "text/xml"), _Resp(b"img", "image/png")]

    def fake_open(url, timeout=None):
        calls.append(url)
        return answers.pop(0)

    c = WmsClient(tmp_path, cookies=True, prime_url="PRIME", retries=3)
    monkeypatch.setattr(c.opener, "open", fake_open)
    assert c.fetch("REAL") == (b"img", "image/png")
    assert calls == ["PRIME", "REAL", "REAL"] and c.requests == 3
    answers.append(_Resp(b"x", "text/html"))
    answers.append(_Resp(b"x", "text/html"))
    answers.append(_Resp(b"x", "text/html"))
    with pytest.raises(WmsError):
        c.fetch("REAL")
    assert calls.count("PRIME") == 1


# ------------------------------------------------------------------------------------------- generated output
_KNOWN = [k for k in tomllib.loads((Path(__file__).resolve().parents[1] / "aois.toml").read_text()) if k != "defaults"]


def _built(key):
    out = []
    for k in _KNOWN:
        mf = APP_DATA / k / "manifest.json"
        if mf.exists() and key in (json.loads(mf.read_text()).get("layers") or {}):
            out.append(k)
    return out


ORTHO_AOIS = _built("ortho")


def check_image_layer(aoi: str, key: str, ppc0: int, fmt: str, attribution: str) -> dict:
    """Shared contract check for an rgb image layer (also used by test_historic.py)."""
    a = load_aoi(aoi)
    m = json.loads((APP_DATA / aoi / "manifest.json").read_text())
    e = m["layers"][key]
    assert e["encoding"] == "rgb" and e["format"] == fmt and e["kind"] == "image" and e["pixelsPerChunk"] == ppc0
    assert e["path"].endswith("." + fmt) and isinstance(e["label_de"], str) and e["label_de"]
    assert attribution in m["attribution"].split("; ") and "min" not in e
    nx, ny = a.width // 500, a.height // 500
    assert m["chunks"] == {"nx": nx, "ny": ny}
    for j in range(ny):
        for i in range(nx):
            p = APP_DATA / aoi / e["path"].format(i=i, j=j)
            with Image.open(p) as im:
                assert im.size == (ppc0, ppc0) and im.mode == "RGB", p
    for lv in m.get("levels") or []:
        le = lv["layers"].get(key)
        if lv["level"] == 0:
            assert le == e
            continue
        assert le is not None, f"level {lv['level']} lacks {key}"
        assert le["pixelsPerChunk"] == 500 and le["encoding"] == "rgb" and le["label_de"] == e["label_de"]
        g = level_grid(a.width, a.height, lv["level"])
        assert lv["chunks"] == g["chunks"]
        for j in range(g["chunks"]["ny"]):
            for i in range(g["chunks"]["nx"]):
                with Image.open(APP_DATA / aoi / le["path"].format(i=i, j=j)) as im:
                    assert im.size == (500, 500)
    return m


@pytest.mark.skipif(not ORTHO_AOIS, reason="no AOI with layers.ortho")
@pytest.mark.parametrize("aoi", ORTHO_AOIS)
def test_generated_ortho(aoi):
    m = check_image_layer(aoi, "ortho", 1000, "webp", ATTRIBUTION_DOP_SL)
    assert m["layers"]["ortho"]["label_de"] == "Luftbild (DOP20)"
    rep = json.loads((WORK_DIR / aoi / "ortho.json").read_text())
    assert rep["chunks"] == m["chunks"]["nx"] * m["chunks"]["ny"]
    if rep["rlpFilledPx"]:
        assert ortho.ATTRIBUTION_DOP_RLP in m["attribution"]


def _grad(a):
    gy, gx = np.gradient(a.astype(np.float64))
    return np.hypot(gx, gy)


def image_shift(a: np.ndarray, b: np.ndarray, maxs: int = 12) -> tuple[float, float, float]:
    """(dx, dy, ncc) shift of a relative to b in px (dx > 0: a's content lies east/right) by FFT cross-correlation
    of normalised arrays with a parabolic sub-pixel peak fit."""
    a = (a - a.mean()) / (a.std() + 1e-9)
    b = (b - b.mean()) / (b.std() + 1e-9)
    c = np.fft.fftshift(np.fft.ifft2(np.fft.fft2(a) * np.conj(np.fft.fft2(b))).real)
    cy, cx = np.array(c.shape) // 2
    win = c[cy - maxs:cy + maxs + 1, cx - maxs:cx + maxs + 1]
    py, px = np.unravel_index(np.argmax(win), win.shape)

    def para(v, p):
        if p in (0, len(v) - 1):
            return 0.0
        return 0.5 * (v[p - 1] - v[p + 1]) / (v[p - 1] - 2 * v[p] + v[p + 1])
    return px - maxs + para(win[py, :], px), py - maxs + para(win[:, px], py), float(win[py, px] / a.size)


def test_image_shift_sign():
    rng = np.random.default_rng(1)
    b = rng.random((128, 128))
    b = (b + np.roll(b, 1, 0) + np.roll(b, 1, 1)) / 3
    dx, dy, ncc = image_shift(np.roll(b, (3, -5), axis=(0, 1)), b)
    assert (round(dx, 3), round(dy, 3)) == (-5, 3) and ncc > 0.9


@pytest.mark.skipif(not ORTHO_AOIS, reason="no AOI with layers.ortho")
@pytest.mark.parametrize("aoi", ORTHO_AOIS)
def test_ortho_aligned_with_dsm(aoi):
    """Numeric alignment: ortho gradient vs DSM gradient (roof edges) on the most built-up chunks (by the LoD2
    building mask when buildings.py has run, else by steep DSM steps), |offset| < 1 m (catches half-chunk,
    axis-order and flip errors)."""
    import rasterio
    dsm_p, bldg_p = WORK_DIR / aoi / "dsm.tif", WORK_DIR / aoi / "bldg.tif"
    if not dsm_p.exists():
        pytest.skip("no work DSM")
    with rasterio.open(dsm_p) as src:
        dsm = src.read(1)
    bldg = None
    if bldg_p.exists():
        with rasterio.open(bldg_p) as src:
            bldg = src.read(1) if src.shape == dsm.shape else None
    m = json.loads((APP_DATA / aoi / "manifest.json").read_text())
    e = m["layers"]["ortho"]
    nx, ny = m["chunks"]["nx"], m["chunks"]["ny"]
    score = {}
    for j in range(ny):
        for i in range(nx):
            sl = np.s_[j * 500:(j + 1) * 500, i * 500:(i + 1) * 500]
            score[(i, j)] = float((bldg[sl] > 0.5).mean()) if bldg is not None else float((_grad(dsm[sl]) > 2.0).mean())
    best = sorted(score, key=score.get, reverse=True)[:3]
    good = 0
    for i, j in best:
        with Image.open(APP_DATA / aoi / e["path"].format(i=i, j=j)) as im:
            img = np.asarray(im.convert("L"), np.float64)
        up = e["pixelsPerChunk"] // 500
        ref = np.kron(dsm[j * 500:(j + 1) * 500, i * 500:(i + 1) * 500], np.ones((up, up)))
        dx, dy, ncc = image_shift(_grad(img), _grad(ref))
        if ncc < 0.02:
            continue
        good += 1
        assert abs(dx / up) < 1.0 and abs(dy / up) < 1.0, f"chunk {i},{j}: offset {dx / up:.2f}, {dy / up:.2f} m"
    assert good >= 2, "ortho does not correlate with the DSM on built-up chunks"
