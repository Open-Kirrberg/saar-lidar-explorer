"""Product importer, shape recipes and gallery (synthetic fixtures only; the real hq folder is never read here).

    cd pipeline && uv run python -I -m pytest -q -p no:cacheprovider ../zones/baeckerei-heusser/products
"""
from __future__ import annotations

import ast
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

PRODUCTS = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
if str(PRODUCTS) not in sys.path:
    sys.path.insert(0, str(PRODUCTS))

import gallery as G  # noqa: E402
import import_products as I  # noqa: E402
import shapes as S  # noqa: E402

FORBIDDEN_KEYS = ("allergen", "image", "allergens_source", "allergen_recipe")


@pytest.fixture(scope="module")
def doc() -> dict:
    return I.import_dir(FIXTURES)


def by_id(doc: dict) -> dict:
    return {p["id"]: p for p in doc["products"]}


# ------------------------------------------------------------------------------------------- importer


def test_import_skips_template_and_sorts(doc):
    assert doc["schema"] == "bh-products-v1"
    assert doc["count"] == 8 == len(doc["products"])
    nums = [p["numeric_id"] for p in doc["products"]]
    assert nums == sorted(nums) == [1, 3, 10, 20, 21, 30, 40, 41]


def test_importer_skips_symlinks(tmp_path):
    src, outside = tmp_path / "src", tmp_path / "elsewhere"
    src.mkdir()
    outside.mkdir()
    (src / "10-brezel.md").write_bytes((FIXTURES / "10-brezel.md").read_bytes())
    (outside / "1-testbrot-750g.md").write_bytes((FIXTURES / "1-testbrot-750g.md").read_bytes())
    (src / "1-link.md").symlink_to(outside / "1-testbrot-750g.md")
    assert [p.name for p in I.source_files(src)] == ["10-brezel.md"]
    assert [p["id"] for p in I.import_dir(src)["products"]] == ["brezel"]


def test_sahnerollen_are_waffle_rolls(doc):
    """The shop's text: cream-filled waffle rolls, sold singly or as several (not a sliced sponge roll)."""
    d = by_id(doc)
    one, several = d["sahnerollen-1-stueck"], d["sahnerollen"]
    assert one["shape"] == "sahnerolle" and one["sale_unit"] == "Stück" and one["piece_of"] == "sahnerollen"
    assert several["shape"] == "sahnerollen" and several["sale_unit"] is None
    w, dd, h = one["size_m"]
    assert 0.10 <= w <= 0.13 and 0.03 <= dd <= 0.036 and 0.03 <= h <= 0.036
    assert "rolle" not in {one["shape"], several["shape"]}


def test_no_allergens_or_images(doc):
    text = I.dumps(doc).lower()
    for key in FORBIDDEN_KEYS:
        assert f'"{key}' not in text
    assert "/assets/" not in text and ".svg" not in text
    for p in doc["products"]:
        assert not any(k.startswith(("allergen", "image")) for k in p)


def test_fields(doc):
    p = by_id(doc)["kornbrot-750g"]
    assert p["name_de"] == "Testbrot 750g" and p["category"] == "brot"
    assert p["price_eur"] == 3.9 and p["weight_g"] == 750 and p["sale_unit"] == "Laib"
    assert p["info_de"] == "Erster Absatz mit einer Zeilenumbruch-Fortsetzung."
    assert p["short_de"] == "Ein erfundenes Testbrot."
    assert p["source"] == "hq-products" and p["source_file"] == "1-testbrot-750g"
    assert p["shape"] == "laib-oval" and p["size_basis"] == "weight"
    assert by_id(doc)["brezel"]["short_de"] == "Laugenbrezel: mit Salz."
    unknown = by_id(doc)["neues-gebaeck"]
    assert unknown["shape_guess"] is True and unknown["shape"] in S.RECIPES and unknown["available"] is False


def test_name_fixes_keep_source(doc):
    d = by_id(doc)
    assert d["schokobroetchen"]["name_de"] == "Schokobrötchen"
    assert d["schokobroetchen"]["name_src"] == "Sckokobrötchen"
    assert d["kranzkuchen-gefuellt-test"]["name_de"] == "Kranzkuchen gefüllt (Test)"
    assert d["kranzkuchen-gefuellt-test-1-4-stueck"]["name_de"] == "Kranzkuchen gefüllt (Test) (1/4 Stück)"
    fixed = {f["id"] for f in doc["name_fix"]}
    assert fixed == {"schokobroetchen", "kranzkuchen-gefuellt-test", "kranzkuchen-gefuellt-test-1-4-stueck"}
    assert all(f["why"] for f in doc["name_fix"])


def test_piece_of_and_sale_unit(doc):
    d = by_id(doc)
    q = d["kranzkuchen-gefuellt-test-1-4-stueck"]
    assert q["piece_of"] == "kranzkuchen-gefuellt-test" and q["sale_unit"] == "1/4"
    assert q["shape"] == "kranzkuchen-viertel"
    assert d["kranzkuchen-gefuellt-test"]["sale_unit"] == "ganzer Kuchen"
    assert "piece_of" not in d["kranzkuchen-gefuellt-test"]


def test_info_clip(doc):
    info = by_id(doc)["schokobroetchen"]["info_de"]
    assert 150 <= len(info) <= I.INFO_MAX and info.endswith(".")
    long = "wort " * 100
    c = I.clip(long.strip())
    assert len(c) <= I.INFO_MAX and c.endswith("…")


def test_importer_deterministic_cli(tmp_path):
    outs = []
    for k in range(2):
        out = tmp_path / f"p{k}.json"
        subprocess.run([sys.executable, "-I", str(PRODUCTS / "import_products.py"), str(FIXTURES), "--out", str(out)],
                       check=True, capture_output=True)
        outs.append(out.read_bytes())
    assert outs[0] == outs[1]
    assert str(FIXTURES).encode() not in outs[0]   # no absolute paths


def test_importer_is_stdlib_only():
    tree = ast.parse((PRODUCTS / "import_products.py").read_text(encoding="utf-8"))
    mods = {a.name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
    mods |= {n.module.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}
    assert mods <= {"__future__", "argparse", "json", "re", "sys", "pathlib"}


# ------------------------------------------------------------------------------------------- recipes


def rule_products() -> list[dict]:
    """One synthetic product per importer rule (+ the fallbacks), sized like the importer would."""
    out = []
    for i, (rx, shape, params) in enumerate(I.RULES):
        size, sigma, _ = I.size_for(shape, params, None)
        prm = {k: v for k, v in params.items() if k != "size"}
        out.append({"id": f"rule-{i}", "shape": shape, "shape_params": prm, "size_m": size, "sigma_m": sigma})
    for cat, shape in I.FALLBACK.items():
        size, sigma, _ = I.size_for(shape, {}, None)
        out.append({"id": f"fallback-{cat}", "shape": shape, "shape_params": {}, "size_m": size, "sigma_m": sigma})
    return out


def test_every_shape_has_a_recipe_and_size():
    shapes = {s for _, s, _ in I.RULES} | set(I.FALLBACK.values())
    assert shapes <= set(S.RECIPES)
    assert set(S.RECIPES) == set(I.SIZES)


def test_committed_products_json_matches_recipes():
    path = PRODUCTS / "products.json"
    if not path.exists():
        pytest.skip("products.json not generated")
    doc = json.loads(path.read_text(encoding="utf-8"))
    assert all(p["shape"] in S.RECIPES for p in doc["products"])
    text = path.read_text(encoding="utf-8").lower()
    assert '"allergen' not in text and '"image' not in text


@pytest.mark.parametrize("prod", rule_products(), ids=lambda p: f"{p['id']}:{p['shape']}")
def test_recipe_budget_fit_and_sanity(prod):
    for idx in range(3):
        parts = S.build(prod, idx)
        tri = S.triangles(parts)
        assert 0 < tri <= S.budget(prod["shape"]), (idx, tri)
        for q in parts:
            assert np.isfinite(q.v).all()
            assert q.mat in S.PALETTE or q.mat in S.shade.materials()
            assert len(q.t) and q.t.max() < len(q.v)
    lo, hi = S.bbox(S.build(prod, 0, vary=False))
    w, d, h = prod["size_m"]
    np.testing.assert_allclose(hi - lo, [w, h, d], rtol=0.02, atol=1e-3)
    assert abs(lo[1]) < 1e-6                                     # base on the tray
    assert abs(lo[0] + hi[0]) < 0.02 * w and abs(lo[2] + hi[2]) < 0.02 * d   # centred


def test_budgets():
    assert S.BUDGET_SMALL == 300 and S.BUDGET_LARGE == 800
    assert S.budget("brezel") == 300 and S.budget("torte") == 800
    assert S.LARGE <= set(S.RECIPES)


@pytest.mark.parametrize("prod", rule_products(), ids=lambda p: p["id"])
def test_plausible_sizes(prod):
    w, d, h = prod["size_m"]
    assert 0.05 <= w <= 0.65 and 0.02 <= d <= 0.45 and 0.015 <= h <= 0.13
    assert w >= d * 0.99 or prod["shape"] in ("kuchen-stueck",)    # x = longest extent (wedge points along z)
    assert prod["sigma_m"] >= 0.01


def _rule(shape: str, **params) -> dict:
    for p in rule_products():
        if p["shape"] == shape and all(p["shape_params"].get(k) == v for k, v in params.items()):
            return p
    raise LookupError(shape)


def test_paint_keeps_quad_bands_whole():
    """`paint` switches lathe quads as a whole (no saw-tooth borders), for every layer."""
    body = S.lathe([(1.0, 0.0), (1.0, 0.3), (1.0, 0.8), (0.0, 1.0)], 12, mat="a")
    c = S.tri_centroids(body)
    parts = S.paint(body, [(c[:, 1] > 0.85, "b"), (c[:, 1] < 0.25, "c")])
    assert {q.mat for q in parts} == {"a", "b", "c"}
    assert S.triangles(parts) == body.triangles
    for q in parts:
        y = q.v[:, 1]
        if q.mat == "c":
            assert y.max() <= 0.3 + 1e-9                        # exactly the bottom band
        if q.mat == "a":
            assert y.min() >= 0.3 - 1e-9 and y.max() <= 0.8 + 1e-9


@pytest.mark.parametrize("shape,params", [("kastenbrot", {}), ("kastenkuchen", {}), ("rosinenbrot", {})])
def test_loaf_tops_have_no_lid(shape, params):
    """Tin loaves / loaf cakes are one body: the top overhangs the tin wall by ≤ 3.5 mm and has no loose flaps."""
    prod = _rule(shape, **params)
    parts = S.build(prod, 0, vary=False)
    body = [q for q in parts if q.mat in S.CRUSTS or q.mat in ("zuckerguss", "schoko", "koerner", "hafer", "mehl")]
    v = np.concatenate([q.v for q in body])
    h = v[:, 1].max()
    wall = np.abs(v[v[:, 1] < 0.5 * h][:, 2]).max()
    top = np.abs(v[v[:, 1] > 0.75 * h][:, 2]).max()
    assert top - wall <= 0.004                                    # 3 mm muffin top + the tin's slight taper
    assert len([q for q in parts if q.mat in S.CRUSTS]) <= 2       # tin wall + crown, no separate lid part


def test_zopf_has_no_see_through_gaps():
    """Seen from above, the braid's centre line is covered from end to end (lobes over a continuous core)."""
    for filled in (False, True):
        prod = dict(_rule("zopf", filled=filled), id=f"zopf-{filled}")
        parts = S.build(prod, 0, vary=False)
        w = prod["size_m"][0]
        xs = np.linspace(-0.40 * w, 0.40 * w, 60)
        _, _, ok = S.Surface(parts).hit(np.column_stack([xs, np.zeros_like(xs)]))
        assert ok.all()


def test_sahnerolle_cream_ends():
    one = S.build(_rule("sahnerolle"), 0, vary=False)
    mats = [q.mat for q in one]
    assert mats.count("sahne") == 2 and "waffel" in mats
    xw = np.concatenate([q.v for q in one if q.mat == "waffel"])[:, 0]
    xs = np.concatenate([q.v for q in one if q.mat == "sahne"])[:, 0]
    assert xs.min() < xw.min() and xs.max() > xw.max()             # cream shows at both ends
    several = S.build(_rule("sahnerollen"), 0, vary=False)
    assert [q.mat for q in several].count("waffel") == 5


def test_poppy_is_grey_not_navy():
    import colorsys
    for tok in ("mohn", "mohn-hell"):
        r, g, b = (int(S.PALETTE[tok][i:i + 2], 16) / 255 for i in (1, 3, 5))
        _, s, _ = colorsys.rgb_to_hsv(r, g, b)
        assert s < 0.15, tok


def test_variation_bounds_and_determinism():
    for i in range(200):
        va = S.variation(f"p{i}", i % 4)
        assert 0.94 <= va["scale"] <= 1.06 and 0.98 <= va["stretch"] <= 1.02
        assert -15 <= va["rot_deg"] <= 15 and 0.94 <= va["tone"] <= 1.04
    assert S.variation("brezel", 1) == S.variation("brezel", 1) != S.variation("brezel", 2)
    p = rule_products()[0]
    a, b = S.build(p, 1), S.build(p, 1)
    assert all(np.array_equal(x.v, y.v) for x, y in zip(a, b))


def test_palette_tokens_are_hex():
    for k, v in S.PALETTE.items():
        assert len(v) == 7 and v.startswith("#") and int(v[1:], 16) >= 0, k


# ------------------------------------------------------------------------------------------- gallery


def test_gallery_deterministic(tmp_path, doc):
    src = tmp_path / "products.json"
    src.write_text(I.dumps(doc), encoding="utf-8")
    a = G.build_gallery(src, tmp_path / "a")
    G.build_gallery(src, tmp_path / "b")
    assert (tmp_path / "a" / "gallery.glb").read_bytes() == (tmp_path / "b" / "gallery.glb").read_bytes()
    assert (tmp_path / "a" / "gallery.json").read_bytes() == (tmp_path / "b" / "gallery.json").read_bytes()
    assert a["totals"]["products"] == doc["count"] and not a["totals"]["over_budget"]
    glb = (tmp_path / "a" / "gallery.glb").read_bytes()
    assert glb[:4] == b"glTF"
    n = int.from_bytes(glb[12:16], "little")
    gl = json.loads(glb[20:20 + n])
    names = {nd["name"] for nd in gl["nodes"]}
    assert {f"produkte/{p['id']}" for p in doc["products"]} <= names
