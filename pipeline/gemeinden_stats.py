"""S1 Saarland leaderboard: publish the Gemeinde level (contract "Place statistics" → "Gemeinde level", ADR 0051).

    uv run python gemeinden_stats.py [saarland] [--no-levels]

Reads the work files of gemeinden.py (outlines, Zensus, MaStR, DLR, GBIF, roofs) and gemeinde_trees.py (S1b sums,
optional and possibly partial) from data/work/gemeinden/ and writes

    app/public/data/saarland/manifest.json         stats-only manifest (kind 'stats-only', stats, stats_levels)
    app/public/data/saarland/stats/places.json     sle-stats-v1, level 'gemeinde'
    app/public/data/saarland/stats/places.geojson  outlines {id, name_de}, coverage-simplified 50 m

and adds `stats_levels` plus the BKG VG25 credit (the outlines the level switch shows, so the app's „© Quellen“, built
from the tile AOI's `attribution`, names BKG) to the manifests of the Ortsteile AOIs in ORTSTEILE_AOIS (today `overall`)
unless --no-levels. `--levels-only` does just that (idempotent, no work files read). A discipline is `ready` only when every place has it (`discipline_state` 'ready' or 'none'); slow inputs
that are not done for a place are 'pending' there and its values are null, never estimated (R3: computed centrally).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence

from common import APP_DATA, ATTRIBUTION_RLP, ATTRIBUTION_SL, fmt_bytes, update_manifest

import gemeinden as G
import stats as S

AOI = "saarland"
LEVEL = "gemeinde"
LABEL_DE = "Gemeinden im Vergleich"
SIMPLIFY_M = 50.0
PLACES_JSON_MAX = 160 * 1024
GEOJSON_MAX = 200 * 1024
ORTSTEILE_AOIS = ("overall",)
# Place status (catalog draft, plan §4.1). 'building': 3D in preparation or partial; '3d': whole Gemeinde published.
STATUS = {"homburg": "building"}
PLACE_AOI_MIN_PCT = 1.0        # place_aoi is set when at least this share of the Gemeinde lies in the AOI
DISCLAIMER_DE = ("Schätzungen aus Luftdaten (LiDAR) und offenen Statistiken, keine amtlichen Zahlen. Verglichen "
                 "werden ganze Gemeinden (Grenzen: BKG VG25); Ortsteile haben eine eigene Tabelle. Rheinland-Pfalz "
                 "wurde 2022 beflogen, das Saarland 2025.")
CATEGORIES_DE = {"stadt": "Städte", "gemeinde": "Gemeinden"}
PLACE_DISCIPLINES = ("waldanteil", "artenvielfalt", "waldreichste-gemeinde", "baeume-pro-einwohner",
                     "kronenreichste-ortslage")
MUN_DISCIPLINES = ("sonnenstaerkste-gemeinde", "solarpotenzial-genutzt")


# =================================================================================================== pure
def disciplines(ready: Mapping[str, bool]) -> list[dict]:
    def d(id_, name, emoji, desc, measure, unit, method, scope="place", note=None, hib=True):
        out = {"id": id_, "name_de": name, "emoji": emoji, "description_de": desc, "scope": scope,
               "measure": measure, "unit": unit, "higher_is_better": hib, "method": method,
               "ready": bool(ready.get(id_))}
        if note:
            out["note_de"] = note
        return out
    return [
        d("waldanteil", "Waldreichste Gemeinde (Karte)", "🌲",
          "Anteil der Gemeindefläche mit Wald laut Baumartenkarte (DLR, Satellit 2022, 10 m)", "forest_pct", "%",
          "dlr-forest-share-v1"),
        d("waldreichste-gemeinde", "Kronenreichste Gemeinde", "🌳",
          "Kronenfläche der aus LiDAR erkannten Bäume im Verhältnis zur Gemeindefläche", "crown_pct", "%",
          "crown-disc-v1"),
        d("baeume-pro-einwohner", "Bäume pro Einwohner", "👥",
          "Aus LiDAR gemessene Baumkronen je Einwohner der Gemeinde (Zensus 2022)", "trees_per_inhabitant",
          "Bäume/Einw.", "zensus-gemeinde-v1",
          note=("Zählt nur im Laserscan gemessene Kronen: weniger als echte Stämme (dichte Nadelwälder werden "
                "nicht aufgeteilt), daher nicht 1:1 mit den Ortsteilen vergleichbar.")),
        d("kronenreichste-ortslage", "Grünste Ortslage (Kronen)", "🏘️",
          "Anteil der Baumkronen (über 3 m) in der bebauten Ortslage (Gebäude plus 50 m, auch Gewerbe)",
          "ortslage_canopy_pct", "%", "ortslage-bldg-edt-50m-v1"),
        d("sonnenstaerkste-gemeinde", "Sonnenstärkste Gemeinde", "☀️",
          "Installierte Photovoltaik-Leistung je Einwohner (Marktstammdatenregister)", "pv.kwp_per_inhabitant",
          "kWp/Einw.", "mastr-municipality-v1", scope="municipality"),
        d("solarpotenzial-genutzt", "Dachpotenzial genutzt", "🔆",
          "Anteil des geschätzten Dach-PV-Potenzials (LoD2), der schon mit Gebäude-PV belegt ist",
          "pv.used_pct_mid", "%", "roof-pv-potential-v2", scope="municipality",
          note="Schätzung: Dachpotenzial ohne Verschattungs- und Statikprüfung."),
        d("artenvielfalt", "Artenvielfalt", "🦋",
          "Erwartete Artenzahl in 500 zufällig gezogenen Fundmeldungen (GBIF, u. a. iNaturalist): misst, was "
          "beobachtet und gemeldet wurde, nicht die Qualität der Natur", "biodiversity.rarefied_500", "Arten",
          S.BIODIV_ID,
          note=("Grober Hinweis, keine Messung: hängt stark davon ab, wer wo beobachtet. Gemeinden mit weniger als "
                "500 Meldungen: keine Daten.")),
    ]


def discipline_ready(states: Sequence[Mapping[str, str]], ids: Sequence[str]) -> dict[str, bool]:
    """A discipline is ready when no place has it 'pending' (and there is at least one place). Pure."""
    return {i: bool(states) and all(s.get(i) in ("ready", "none") for s in states) for i in ids}


def species_cells_block(d: Mapping[str, Any] | None, min_cells: int = 5) -> dict | None:
    """species-dlr-cell-mix-v1 block (rounded) from a dlr_by_gemeinde.json record. Pure."""
    if not d or int(d.get("class_cells") or 0) < min_cells or not d.get("mix"):
        return None
    forest = int(d["class_cells"]) + int(d.get("loss_cells") or 0)
    mix = []
    for e in d["mix"]:
        v = S.round_to(float(e["share_pct"]), 0.1)
        if v:
            mix.append({"key": e["key"], "share_pct": v, **({"weak": True} if e.get("weak") else {})})
    return {"mix": mix, "dominant": mix[0]["key"], "method": "species-dlr-cell-mix-v1",
            "coverage_pct": S.round_to(100.0 * int(d["class_cells"]) / forest, 0.1) if forest else None,
            "conifer_pct": S.round_to(float(d["conifer_pct"]), 0.1) if d.get("conifer_pct") is not None else None,
            "trees": 0}


def tree_fields(v: Mapping[str, Any] | None, inhabitants: int | None) -> dict[str, Any]:
    """S1b fields of one Gemeinde, rounded per contract; all null when `v` is None (pending). Pure."""
    if not v:
        return {"trees": None, "crown_ha": None, "crown_pct": None, "agb_t": None, "co2_t": None,
                "trees_per_inhabitant": None, "ortslage_canopy_pct": None, "ortslage_area_ha": None}
    tpi = v["trees"] / inhabitants if inhabitants else None
    return {"trees": int(v["trees"]), "crown_ha": S.round_to(v["crown_ha"], 0.1),
            "crown_pct": S.round_to(v["crown_pct"], 0.1), "agb_t": S.round_range(v["agb_t"]),
            "co2_t": S.round_range(v["co2_t"]), "trees_per_inhabitant": S.round_sig(tpi, 2),
            "ortslage_canopy_pct": S.round_to(v["ortslage_canopy_pct"], 0.1),
            "ortslage_area_ha": S.round_to(v["ortslage_area_ha"], 0.1)}


def validate(doc: Mapping[str, Any], features: Sequence[Mapping[str, Any]]) -> None:
    """Contract checks of the Gemeinde-level file (raises ValueError). Pure."""
    errs = []
    if doc.get("format") != "sle-stats-v1" or doc.get("version") != 1 or doc.get("level") != LEVEL:
        errs.append("format/version/level")
    ids = [p["id"] for p in doc["places"]]
    if len(set(ids)) != len(ids):
        errs.append("duplicate place ids")
    mids = {m["id"] for m in doc["municipalities"]}
    disc = {d["id"] for d in doc["disciplines"]}
    for p in doc["places"]:
        if p.get("kind") != "gemeinde" or p.get("status") not in ("3d", "building", "stats"):
            errs.append(f"{p['id']}: kind/status")
        if len(str(p.get("ags", ""))) != 8 or p.get("municipality") not in mids or p["municipality"] != p["id"]:
            errs.append(f"{p['id']}: ags/municipality")
        if p.get("category") not in CATEGORIES_DE:
            errs.append(f"{p['id']}: category")
        if set(p.get("discipline_state", {})) != disc:
            errs.append(f"{p['id']}: discipline_state keys")
        for k, s in p.get("discipline_state", {}).items():
            if s not in ("ready", "pending", "none"):
                errs.append(f"{p['id']}: state {k}={s}")
        if p["state"] == "RLP" and "other-flight" not in p["flags"]:
            errs.append(f"{p['id']}: RLP without other-flight")
        for k in ("tallest", "riesen", "goals", "ortslage"):
            if p.get(k):
                errs.append(f"{p['id']}: {k} must be empty on the Gemeinde level")
    for dsc in doc["disciplines"]:
        if dsc["ready"]:
            for p in doc["places"]:
                if p["discipline_state"].get(dsc["id"]) == "pending":
                    errs.append(f"{dsc['id']} ready but {p['id']} pending")
    if [f["properties"]["id"] for f in features] != ids:
        errs.append("outline ids ≠ place ids")
    S.check_privacy(doc)
    S.check_outline_privacy(features)
    if errs:
        raise ValueError("; ".join(errs[:10]))


# =================================================================================================== I/O
def _load(name: str) -> Any:
    f = G.GEMEINDE_DIR / name
    return json.loads(f.read_text()) if f.exists() else None


def ortsteile_index() -> dict[str, dict[str, Any]]:
    """municipality id → {aoi, places} from the Ortsteile AOIs' stats files."""
    out: dict[str, dict[str, Any]] = {}
    for aoi in ORTSTEILE_AOIS:
        f = APP_DATA / aoi / "stats" / "places.json"
        if not f.exists():
            continue
        d = json.loads(f.read_text())
        for p in d.get("places", []):
            m = p.get("municipality")
            if m:
                out.setdefault(m, {"aoi": aoi, "places": []})["places"].append(p["id"])
    for v in out.values():
        v["places"].sort()
    return out


def aoi_shares(gems: Sequence[Mapping[str, Any]]) -> dict[str, tuple[str, float]]:
    out = {}
    for aoi in ORTSTEILE_AOIS:
        if not (APP_DATA / aoi / "manifest.json").exists():
            continue
        box = S.aoi_box(APP_DATA / aoi)
        for g in gems:
            pct = 100.0 * g["geom"].intersection(box).area / g["geom"].area
            if pct >= PLACE_AOI_MIN_PCT and pct > out.get(g["id"], ("", 0.0))[1]:
                out[g["id"]] = (aoi, pct)
    return out


def build(write_levels: bool = True) -> dict[str, Any]:
    gems = G.load_gemeinden()
    meta = G.outline_meta()
    zensus = (_load("zensus.json") or {}).get("gemeinden", {})
    mastr = _load("mastr_pv.json")
    dlr = (_load("dlr_by_gemeinde.json") or {}).get("gemeinden", {})
    gbif_doc = _load("gbif_by_gemeinde.json")
    gbif = {p["id"]: p for p in (gbif_doc or {}).get("places", [])}
    roofs_doc = _load("roofs_by_gemeinde.json")
    trees_doc = _load("trees_by_gemeinde.json")
    ortsteile = ortsteile_index()
    shares = aoi_shares(gems)
    roofs_ok = bool(roofs_doc) and roofs_doc.get("lod2_complete") is True and roofs_doc["info"]["rlp_tiles"] > 0
    generated = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    places, munis, states = [], [], []
    feats_in = []
    for g in sorted(gems, key=lambda g: S.sort_key_de(g["name_de"])):
        gid = g["id"]
        pop = (zensus.get(gid) or {}).get("inhabitants")
        tr = ((trees_doc or {}).get("gemeinden") or {}).get(gid) or {}
        tv = tr.get("values") if tr.get("done") else None
        st = {
            "waldanteil": "ready" if gid in dlr else "pending",
            "artenvielfalt": "ready" if gid in gbif else "pending",
            "waldreichste-gemeinde": "ready" if tv else "pending",
            "baeume-pro-einwohner": "ready" if tv and pop else ("none" if tv else "pending"),
            "kronenreichste-ortslage": "ready" if tv else "pending",
            "sonnenstaerkste-gemeinde": "ready" if mastr and gid in mastr["municipalities"] and pop else "pending",
            "solarpotenzial-genutzt": "ready" if roofs_ok and mastr else "pending",
        }
        bio = S.biodiversity_block(gbif.get(gid)) if gid in gbif else None
        if bio and bio.get("rarefied_500") is None and st["artenvielfalt"] == "ready":
            st["artenvielfalt"] = "none"
        roof, roof_sup = (S.roof_block((roofs_doc["gemeinden"] or {}).get(gid)) if roofs_ok else (None, False))
        flags = ["pv-municipality-only"]
        epoch = 2025
        if g["state"] == "RLP":
            flags.append("other-flight")
            epoch = 2022
        x, y = S.label_point(g["geom"])
        b = g["geom"].bounds
        aoi = shares.get(gid)
        p = {"id": gid, "name_de": g["name_de"], "kind": "gemeinde", "gemarkungen": [], "ags": g["ags"],
             "state": g["state"], "municipality": gid, "category": g["category"],
             "status": STATUS.get(gid, "stats"), **({"place_aoi": aoi[0]} if aoi else {}),
             **({"ortsteile": ortsteile[gid]} if gid in ortsteile else {}),
             "complete": True, "flags": flags, "suppressed": ["roof_potential"] if roof_sup else [],
             "lidar_epoch": epoch, "label": [int(round(x)), int(round(y))],
             "bbox": [int(b[0]), int(b[1]), int(-(-b[2] // 1)), int(-(-b[3] // 1))],
             "aoi_share_pct": S.round_to(aoi[1], 0.1) if aoi else 0,
             "area_ha": S.round_to(g["geom"].area / 1e4, 0.1), "parcels": None,
             **tree_fields(tv, pop), "ortslage": None,
             "inhabitants": S.round_to(pop, 10) if pop else None, "tallest": None, "pv": None,
             "forest_pct": S.round_to(dlr[gid]["forest_pct"], 0.1) if gid in dlr else None,
             "species": species_cells_block(dlr.get(gid)), "biodiversity": bio, "roof_potential": roof,
             "discipline_state": st}
        if tv:
            rp = tv.get("rlp_pct") or 0.0
            ep = [[2025, S.round_to(100 - rp, 0.1)], [2022, S.round_to(rp, 0.1)]]
            p["lidar_epochs"] = sorted([e for e in ep if e[1] > 0], key=lambda e: -e[1])
            p["lidar_epoch"] = p["lidar_epochs"][0][0]
            if rp >= 1 and "other-flight" not in p["flags"]:   # contract Flag: ≥ 1 % of the cells from another flight
                p["flags"].append("other-flight")
            if (tv.get("lidar_coverage_pct") or 0) < 99.0:
                p["complete"] = False
                p["flags"].append("cut-by-aoi")
        places.append(p)
        states.append(st)
        feats_in.append((gid, g["name_de"], g["geom"]))
        # municipality = the place itself
        mm = (mastr or {}).get("municipalities", {}).get(gid)
        pv = None
        if mm:
            io = mm["in_operation"]
            by_year = S.bucket_years((int(y_), v["units"], v["kwp"]) for y_, v in
                                     (mm.get("by_commissioning_year") or {}).items() if str(y_).isdigit())
            pv = {"source": "mastr", "as_of": mm["fetched"], "systems": int(io["units"]), "kwp": int(round(io["kwp"])),
                  "kwp_per_inhabitant": S.round_sig(io["kwp"] / pop, 2) if pop else None,
                  "small_systems": int(mm["lt_30kw"]["units"]), "by_year": by_year}
        mun = {"id": gid, "name_de": g["name_de"], "state": g["state"], "ags": g["ags"], "places": [gid],
               "inhabitants": S.round_to(pop, 10) if pop else None, "pv": pv}
        if roofs_ok and roof and pv:
            bld = ((mm.get("by_type") or {}).get("Gebäudesolaranlage") or {}).get("kwp", 0.0)
            rp_ = (roofs_doc["gemeinden"] or {}).get(gid) or {}
            import roofs as R
            used = R.used_share(bld, rp_.get("kwp") or [0, 0, 0])
            mun["roof_potential"] = {"places": [gid], "suitable_m2": roof["suitable_m2"], "kwp": roof["kwp"],
                                     "complete": True}
            if used:
                pv["used_pct"] = [S.round_to(v, 0.1) for v in used]
                pv["used_pct_mid"] = pv["used_pct"][1]
                pv["used_pct_reason_de"] = None
        if roofs_ok and mastr:
            st["solarpotenzial-genutzt"] = "ready" if pv and pv.get("used_pct_mid") is not None else "none"
        munis.append(mun)
    ids = [p["id"] for p in places]
    feats = S.outline_features(ids, [p["name_de"] for p in places], [f[2] for f in feats_in], SIMPLIFY_M)
    disc = disciplines(discipline_ready(states, PLACE_DISCIPLINES + MUN_DISCIPLINES))
    inputs = build_inputs(meta, mastr, gbif_doc, roofs_ok, trees_doc)
    tsum = trees_doc or {}
    doc = {
        "format": "sle-stats-v1", "version": 1, "generated": generated, "aoi": AOI, "level": LEVEL,
        "crs": "EPSG:25832", "extent": meta["bbox"],
        "geometry": {"url": "stats/places.geojson", "simplify_m": int(SIMPLIFY_M), "featureCount": len(feats)},
        "min_count": S.MIN_COUNT, "label_de": LABEL_DE, "disclaimer_de": DISCLAIMER_DE,
        "complete": all(d["ready"] for d in disc),
        "progress": {"lidar": {"tiles_done": int(tsum.get("tiles_done", 0)),
                               "tiles_total": int(tsum.get("tiles_total", len(G.all_tiles()))),
                               "pct": S.round_to(100.0 * tsum.get("tiles_done", 0) / max(1, tsum.get("tiles_total", 1)), 0.1),
                               "places_done": int(tsum.get("places_done", 0))}},
        "categories_de": CATEGORIES_DE,
        "inputs": inputs, "method": methods(roofs_doc, gbif_doc, trees_doc), "disciplines": disc,
        "places": places, "municipalities": munis,
        "labels_de": {"species": {c[1]: c[2] for c in __import__("species").CLASSES if c[1] != "canopy_loss"}},
        "attribution": "; ".join(dict.fromkeys(v["attribution"] for v in inputs.values())),
    }
    gj = {"type": "FeatureCollection", "features": feats}
    validate(doc, feats)
    out = APP_DATA / AOI
    (out / "stats").mkdir(parents=True, exist_ok=True)
    pj = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    gs = json.dumps(gj, ensure_ascii=False, separators=(",", ":"))
    for name, text, limit in (("places.json", pj, PLACES_JSON_MAX), ("places.geojson", gs, GEOJSON_MAX)):
        f = out / "stats" / name
        tmp = f.with_suffix(".tmp")
        tmp.write_text(text)
        tmp.replace(f)
        print(f"  wrote {AOI}/stats/{name} ({fmt_bytes(len(text.encode()))})")
        if len(text.encode()) > limit:
            print(f"  ! {name} is above the contract target {fmt_bytes(limit)}", file=sys.stderr)
    levels = stats_levels_value()
    man = {"version": 1, "kind": "stats-only", "aoi": AOI, "name": "Saarland – Gemeinden im Vergleich",
           "crs": "EPSG:25832",
           "stats": {"format": "sle-stats-v1", "url": "stats/places.json", "geometry": "stats/places.geojson",
                     "generated": generated, "places": len(places), "label_de": LABEL_DE, "level": LEVEL},
           "stats_levels": levels, "attribution": doc["attribution"]}
    mf = out / "manifest.json"
    tmp = mf.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(man, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(mf)
    if write_levels:
        write_levels_into_ortsteile(levels)
    G.write_json(G.GEMEINDE_DIR / "stats_report.json", {
        "generated": generated, "ready": {d["id"]: d["ready"] for d in disc},
        "pending": {d["id"]: [p["id"] for p in places if p["discipline_state"][d["id"]] == "pending"]
                    for d in disc}})
    print(f"  {len(places)} Gemeinden; ready: " + ", ".join(d["id"] for d in disc if d["ready"]) +
          "; pending: " + ", ".join(d["id"] for d in disc if not d["ready"]))
    return doc


def stats_levels_value() -> dict:
    """`stats_levels` (sle-stats-levels-v1): Gemeinden first, then every Ortsteile AOI that exists."""
    return {"format": "sle-stats-levels-v1", "levels": [
        {"level": "gemeinde", "aoi": AOI, "label_de": "Gemeinden"},
        *({"level": "ortsteil", "aoi": a, "label_de": "Ortsteile"} for a in ORTSTEILE_AOIS
          if (APP_DATA / a / "manifest.json").exists())]}


def write_levels_into_ortsteile(levels: dict | None = None) -> list[str]:
    """Idempotent: set `stats_levels` in every existing Ortsteile AOI manifest and make sure its `attribution` carries
    the current VG25 credit (superseded VG25 credits replaced). Touches no other key. Returns the AOIs written."""
    levels = levels or stats_levels_value()
    done = []
    for a in ORTSTEILE_AOIS:
        if (APP_DATA / a / "manifest.json").exists():
            update_manifest(APP_DATA / a, {"stats_levels": levels}, attribution=[G.ATTRIBUTION_VG25],
                            drop_attribution=G.ATTRIBUTION_VG25_SUPERSEDED)
            done.append(a)
    return done


def build_inputs(meta, mastr, gbif_doc, roofs_ok, trees_doc) -> dict:
    import species as SP
    import stats_inputs as SI
    today = dt.date.today().isoformat()
    dl = "dl-de/by-2-0"
    inp = {
        "vg25": {"name_de": "Verwaltungsgebiete 1:25 000 (VG25), Gemeindegrenzen", "provider": "BKG", "year": None,
                 "retrieved": meta["queries"][0]["fetched"], "licence": "CC-BY-4.0", "attribution": G.ATTRIBUTION_VG25,
                 "url": "https://gdz.bkg.bund.de/index.php/default/verwaltungsgebiete-1-25-000-stand-31-12-vg25.html"},
        "zensus_gemeinden": {"name_de": "Zensus 2022, Regionaltabelle Bevölkerung (Gemeinden)", "provider": "Destatis",
                             "year": 2022, "retrieved": today, "licence": dl, "attribution": S_ZENSUS,
                             "url": S.ZENSUS_REGIONAL_URL},
        "species_dlr": {"name_de": "Baumarten Deutschland 2022 (DLR, Sentinel-1/-2, 10 m)", "provider": "DLR",
                        "year": 2022, "retrieved": today, "licence": "CC-BY-4.0", "attribution": SP.ATTRIBUTION_DLR,
                        "url": "https://doi.org/10.15489/smh8w3j8i962"},
    }
    if mastr:
        inp["mastr"] = {"name_de": "Marktstammdatenregister, Solareinheiten", "provider": "BNetzA", "year": None,
                        "retrieved": mastr["export_date"], "licence": dl, "attribution": SI.ATTRIBUTION_MASTR,
                        "url": "https://www.marktstammdatenregister.de/"}
    if gbif_doc:
        inp["gbif"] = {"name_de": "GBIF-Fundmeldungen (nur Anzahlen je Gemeinde)", "provider": "GBIF", "year": None,
                       "retrieved": gbif_doc.get("query_date") or today,
                       "licence": "CC0-1.0 / CC-BY-4.0 / CC-BY-NC-4.0 (je Datensatz)",
                       "attribution": gbif_doc["attribution"][0], "url": "https://www.gbif.org",
                       "note_de": gbif_doc.get("attribution_note_de")}
    if roofs_ok:
        from buildings import ATTRIBUTION_LOD2_RLP, ATTRIBUTION_LOD2_SL
        inp["lod2_sl"] = {"name_de": "3D-Gebäudemodell LoD2 Saarland", "provider": "LVGL-SL", "year": None,
                          "retrieved": today, "licence": dl, "attribution": ATTRIBUTION_LOD2_SL}
        inp["lod2_rlp"] = {"name_de": "3D-Gebäudemodell LoD2 Rheinland-Pfalz", "provider": "LVermGeoRP", "year": None,
                           "retrieved": today, "licence": dl, "attribution": ATTRIBUTION_LOD2_RLP}
    if trees_doc and trees_doc.get("places_done"):
        inp["lidar_sl"] = {"name_de": "Laserscanning DGM1/DOM1 Saarland (ALS 2025)", "provider": "LVGL-SL",
                           "year": 2025, "retrieved": today, "licence": dl, "attribution": ATTRIBUTION_SL}
        inp["lidar_rlp"] = {"name_de": "DGM1/DOM1 Rheinland-Pfalz", "provider": "LVermGeoRP", "year": 2022,
                            "retrieved": today, "licence": dl, "attribution": ATTRIBUTION_RLP}
    for k, v in inp.items():
        if not v["attribution"] or ";" in v["attribution"]:
            raise ValueError(f"input {k}: attribution missing or contains ';'")
        if v.get("note_de") is None:
            v.pop("note_de", None)
    return inp


S_ZENSUS = "Zensus 2022, © Statistische Ämter des Bundes und der Länder, dl-de/by-2-0, Daten bearbeitet"


def methods(roofs_doc, gbif_doc, trees_doc) -> dict:
    import gemeinde_trees as GT
    return {
        "outline": {"id": "vg25-gemeinde-v1", "label_de": "Gemeindegrenzen BKG VG25",
                    "params": {"layer": G.VG25_LAYER, "dropped": "ibz 69 (Kondominium)", "simplify_m": SIMPLIFY_M}},
        "inhabitants": {"id": "zensus-gemeinde-v1", "label_de": "Zensus 2022, amtliche Gemeindezahl"},
        "category": {"id": "category-legal-status-v1", "label_de": "Stadt oder Gemeinde (Rechtsstatus, VG25)"},
        "forest": {"id": "dlr-forest-share-v1", "label_de": "Waldfläche laut Baumartenkarte (DLR 2022, 10 m)",
                   "params": {"grid": "dlr-nearest-25832-v1", "forest": "class 0–9 or canopy loss",
                              "assign": "cell centre inside the outline"}},
        "species": {"id": "species-dlr-cell-mix-v1", "label_de": "Baumartenmischung nach Fläche (DLR-Karte 2022)",
                    "params": {"weak": list(S.SPECIES_WEAK)}},
        "pv_mastr": {"id": "mastr-municipality-v1", "label_de": "PV-Einheiten in Betrieb je Gemeinde (MaStR)"},
        "roof_potential": {"id": "roof-pv-potential-v2", "label_de": "Für PV geeignete Dachflächen aus LoD2 (Schätzung)",
                           "params": {"assign": "roof centroid in the outline, same state",
                                      "used_pct": "MaStR Gebäude-PV kWp ÷ potential (lo uses the hi potential)"}},
        "biodiversity": {"id": S.BIODIV_ID, "label_de": "Erwartete Artenzahl in 500 Fundmeldungen (GBIF)",
                         "params": {"query_date": (gbif_doc or {}).get("query_date"),
                                    "caveats": (gbif_doc or {}).get("caveats")}},
        "trees": {"id": GT.METHOD, "label_de": "Gemessene Baumkronen aus dem LiDAR-Kronenmodell (ohne Füllbäume), je 1-km-Kachel gestreamt",
                  "note_de": "Zählt nur gemessene Kronen: weniger als echte Stämme und nicht 1:1 mit der Ortsteil-Ebene vergleichbar.",
                  "params": {"count": "measured tops only (conifer fill trees excluded from the count, kept in crown area and biomass)", "tile_m": GT.TILE, "margin_m": GT.MARGIN, "max_height_m": 60.0,
                             "type": "DLR class under the crown (pseudo-brightness, see gemeinde_trees.py)",
                             "rlp_offset_m": (trees_doc or {}).get("rlp_offset_m")}},
        "crown": {"id": "crown-disc-v1", "label_de": "Kronenfläche = Σ π r²"},
        "biomass": {"id": "crown-allometry-v2", "label_de": "Biomasse aus Höhe und Krone (Schätzung, Faktor 2)",
                    "params": {"rho": "0.42 conifer (DLR type), 0.60 else"}},
        "ortslage": {"id": "ortslage-bldg-edt-50m-v1", "label_de": "Gebäude plus 50 m (ohne Lückenschluss)",
                     "params": {"radius_m": GT.ORTSLAGE_M, "canopy_m": GT.CANOPY_M}},
    }


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("aoi", nargs="?", default=AOI)
    ap.add_argument("--no-levels", action="store_true", help="do not write stats_levels into the Ortsteile AOIs")
    ap.add_argument("--levels-only", action="store_true",
                    help="only write stats_levels + the VG25 credit into the Ortsteile AOIs (no work files read)")
    a = ap.parse_args(argv)
    if a.aoi != AOI:
        sys.exit(f"gemeinden_stats.py publishes the AOI {AOI!r} only")
    if a.levels_only:
        print("  stats_levels + VG25 credit: " + (", ".join(write_levels_into_ortsteile()) or "(no Ortsteile AOI)"))
        return
    build(write_levels=not a.no_levels)


if __name__ == "__main__":
    main()
