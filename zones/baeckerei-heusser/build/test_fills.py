"""Fill states of the built twin (docs/zone-contract.md „Fills“): pure parts, no local data needed.

    cd pipeline && uv run python -I -m pytest -q -p no:cacheprovider ../zones/baeckerei-heusser/build/test_fills.py
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[2] / "pipeline")]

import build as B  # noqa: E402

A = {"product": "kornbrot-500g", "count": 1}
C = {"product": "mischbrot-500g", "count": 2}


def test_shared_entries_are_one_node():
    recs = B.plan_fill_nodes([("morgens", {"slots": {"s/a": A, "s/b": C}}), ("mittags", {"slots": {"s/a": dict(A)}})])
    assert [(r["name"], r["fills"]) for r in recs] == [("produkt/s/a", ["morgens", "mittags"]), ("produkt/s/b", ["morgens"])]


def test_different_entry_in_the_same_slot_is_a_variant_node():
    recs = B.plan_fill_nodes([("morgens", {"slots": {"s/a": A}}), ("abends", {"slots": {"s/a": dict(A, count=3)}}),
                              ("leer", {"slots": {}})])
    assert [(r["name"], r["slot"], r["fills"]) for r in recs] == [("produkt/s/a", "s/a", ["morgens"]),
                                                                 ("produkt/s/a@abends", "s/a", ["abends"])]
    assert B.product_slot("produkt/s/a@abends") == "s/a" and B.product_slot("produkt/s/a") == "s/a"


def test_load_fills_puts_the_start_state_first():
    ids = [fid for fid, _ in B.load_fills("feierabend")]
    assert ids[0] == "feierabend" and set(ids) == {"morgens", "feierabend"}
    assert [fid for fid, _ in B.load_fills(B.DEFAULT_FILL)][0] == B.DEFAULT_FILL


def test_catalogue_fills_block():
    cat_doc = {"consent": {"prices": True}, "objects": [
        {"id": "theke", "name_de": "Theke", "info_de": "Hier wird bedient.", "status": "built", "discover": True}]}
    products = {"products": [{"id": "kornbrot-500g", "name_de": "Kornbrot"}, {"id": "mischbrot-500g", "name_de": "Mischbrot"}]}
    pa = {"kind": "product", "item": "kornbrot-500g"}
    pc = {"kind": "product", "item": "mischbrot-500g"}
    ware = {"kind": "ware", "item": "glas-honig"}
    one = B.catalogue_json(cat_doc, products, {"morgens": {"s/a": pa}})
    assert "fills" not in one and one["discoverable"] == ["kornbrot-500g", "theke"]
    two = B.catalogue_json(cat_doc, products, {"abends": {"s/b": pc, "s/w": ware}, "morgens": {"s/a": pa, "s/b": pc}},
                           {"abends": {"name_de": "Abends ", "info_de": "Spät."}, "morgens": {"name_de": "Morgens"}})
    assert two["discoverable"] == ["mischbrot-500g", "kornbrot-500g", "theke"]
    assert two["fills"] == {"default": "abends", "states": [
        {"id": "abends", "name_de": "Abends", "info_de": "Spät.", "products": ["mischbrot-500g"]},
        {"id": "morgens", "name_de": "Morgens", "info_de": "", "products": ["kornbrot-500g", "mischbrot-500g"]}]}
