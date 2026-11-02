"""Digitised LiDAR features (hand-picked from the relief images in research/img, refined with trace_lines.py)
-> research/lidar_features.geojson (EPSG:25832) + Markdown table with measured DTM statistics.
Usage: features.py <workdir> <out.geojson> <out_table.md>"""
import json, math, sys
from pathlib import Path
import numpy as np, rasterio
from rasterio.features import geometry_mask
from shapely.geometry import Polygon, LineString, Point, mapping
from shapely import affinity

wd = Path(sys.argv[1])
with rasterio.open(wd / "dgm1.tif") as d:
    Z = d.read(1); tf = d.transform
with rasterio.open(wd / "dom1.tif") as d:
    DOM = d.read(1)
CONV = -1.23  # grid convergence at the site (pyproj): true azimuth = grid azimuth + CONV

def rect(cx, cy, L, W, az):
    """rectangle centred at (cx,cy); long side L along grid azimuth az (deg), short side W"""
    a = math.radians(az); u = np.array([math.sin(a), math.cos(a)]); v = np.array([u[1], -u[0]])
    c = np.array([cx, cy]); h, w = L / 2, W / 2
    return Polygon([c + u * h + v * w, c + u * h - v * w, c - u * h - v * w, c - u * h + v * w])
def ellipse(cx, cy, a, b, az=0):
    p = Point(cx, cy).buffer(1, 64); p = affinity.scale(p, b, a); return affinity.rotate(p, -az, origin=(cx, cy))
def circle(cx, cy, r): return Point(cx, cy).buffer(r, 64)
def ring(cx, cy, r_out, r_in): return Point(cx, cy).buffer(r_out, 64).difference(Point(cx, cy).buffer(r_in, 64))

F = []  # (id, kind, name_guess, confidence, geometry, notes, measure_mode)
def add(i, kind, name, conf, geom, notes, mode=None): F.append((i, kind, name, conf, geom, notes, mode))

# ---------------- palace core (Hauptschloss site, Buchenberg west edge) ----------------
add("KB-01", "platform", "Palace terrace / Schlosshof level (court between wings)", "high",
    Polygon([(382192, 5466088), (382262, 5466098), (382258, 5466214), (382215, 5466217), (382186, 5466212)]),
    "Levelled terrace at 344.5-344.9 m (P1, P2) cut into the W-facing slope; slope rises E (345->352 m), falls W (344->339 m). Outline = extent of rectilinear foundations.", "level")
add("KB-02", "foundation", "Southern wing with cellars (S-Flügel)", "high", rect(382227, 5466091, 64, 17, 81.4),
    "N wall traced 382197/5466093.5 -> 382256/5466102.4 (az 81.4 grid, rms 0.85 m). Inner E-W wall at N~5466088; sunken rooms 1.5-2 m below court (P1: 342.4 vs 344.5) = cellars/robbed foundations.", "depth")
add("KB-03", "foundation", "Central E-W wing (main building? corps de logis candidate)", "med", rect(382226, 5466151, 78, 20, 80.8),
    "Band of rubble mounds and robbed-wall trenches N 5466138-5466162; S edge traced az 80.8 grid. Highest debris +0.3-0.6 m (SLRM-5). Width ~15-20 m fits a double-pile wing.", "height")
add("KB-04", "foundation", "Eastern pavilion / corner block at central wing", "med", rect(382259, 5466143, 22, 14, 80.8),
    "Block at E end of KB-03, wall stubs and pit at 382262/5466136.", "height")
add("KB-05", "foundation", "West block (W-Flügel), subdivided rooms", "high", rect(382190, 5466186, 50, 13, 174),
    "Two parallel walls 9-10 m apart with cross walls; W wall traced N-S (az 180.7 grid but rms 1.3 m - road edge interferes); E wall visibly tilted ~-6 deg.", "height")
add("KB-06", "foundation", "NE block (rubble-filled rectangle, robbed-wall trenches around)", "high", rect(382241, 5466196, 28, 13, 172),
    "Closed rectangle of trenches (robbed walls) around a raised rubble core (+0.4-0.6 m).", "height")
add("KB-07", "terrace", "North court scarp (step up to upper plateau 347.8 m)", "high",
    LineString([(382215, 5466217.6), (382244.5, 5466223.6), (382251, 5466222), (382253, 5466170)]),
    "Scarp 2.7-3.0 m (344.8 -> 347.5-347.9 m), N part az 78.4 grid; E arm runs S along E 382251.", "step")
add("KB-08", "pit", "Round pit / well shaft? (E of NE block)", "med", circle(382279.5, 5466190, 2), "D ~3-4 m, depth see table. Wells are documented in the park (source: research/03 B1).", "depth")
add("KB-09", "pit", "Round pit / well shaft? (E of NE block, S)", "med", circle(382288.5, 5466172, 2), "D ~3-4 m.", "depth")
add("KB-10", "path", "Hollow way W of palace (N-S axis road, south part)", "high",
    LineString([(382168.5, 5466114), (382175.7, 5466362.9)]), "Sunken road az 1.6 grid (0.4 true); matches the straight N-S road of the 1836-41 map after -50 m E correction.", "line")
add("KB-11", "avenue", "N-S axis road/avenue north of palace (to Forsthaus / Louisenhof area)", "med",
    LineString([(382179.7, 5466380), (382182, 5466848)]), "Straight path az 0.3 grid, 468 m; double hollow (two parallel tracks ~10 m apart) N of 5466600. Same line as 1836-41 road.", "line")
add("KB-12", "avenue", "East axis avenue (palace axis, W part)", "high",
    LineString([(382199.2, 5466116.8), (382778.3, 5466218.5)]), "Straight path az 80.0 grid (78.8 true), 588 m, parallel to palace walls (80.5+-1.5) -> main E-W axis of the complex. Ends at a path star at ~382785/5466215.", "line")
add("KB-13", "avenue", "East axis avenue (E continuation)", "low",
    LineString([(382788.7, 5466224.6), (383379.2, 5466290.7)]), "az 83.6 grid, rms 3.2 m - weaker/less straight; may be a later forest ride.", "line")
add("KB-14", "avenue", "SSE avenue palace -> Karlslust", "high",
    LineString([(382288.7, 5465984.2), (382592.9, 5465439.4)]), "Dead straight path az 150.8 grid, 624 m; its extension reaches the Karlslust valley near the Barenzwinger. Present in 1836-41 and 1935 maps.", "line")
add("KB-15", "path", "Rondell / path star at end of E axis", "low", circle(382785, 5466215, 12), "Junction of the E avenue with diagonal paths (NE, SE, NW) - possible Jagdstern / rond-point.", None)

# ---------------- north terrace ----------------
add("KB-20", "terrace", "North terrace (levelled platform, same level as palace court)", "high",
    Polygon([(382178, 5466369), (382263, 5466368), (382275.4, 5466469.5), (382278, 5466560), (382182, 5466560)]),
    "Flat 343.8-344.3 m, ~90 x 190 m, cut 3.5-4.8 m into the plateau (S scarp 347.8->344, E scarp 344->348.9). W edge drops naturally to the Sanddorf valley. Interpretation: garden parterre / Marstall or service court terrace - unknown.", "level")
add("KB-21", "terrace", "North terrace E scarp", "high", LineString([(382266, 5466370.9), (382275.4, 5466469.5)]), "az 5.5 grid (4.2 true) - NOT parallel to palace (80.5/170.5): different design phase or later?", "step")
add("KB-22", "terrace", "North terrace S scarp", "high", LineString([(382182, 5466368.8), (382263, 5466367.8)]), "az 90.7 grid; 3.5 m high.", "step")
add("KB-23", "other", "Upper plateau block between palace and N terrace (347.5-347.9 m)", "med",
    Polygon([(382180, 5466230), (382262, 5466226), (382263, 5466365), (382180, 5466366)]), "Flat, ~3 m above both terraces; natural plateau remnant or platform of a demolished building - LiDAR cannot decide.", "level")

# ---------------- Orangerie ----------------
add("KB-30", "wall", "Orangerie: W retaining wall / building front", "high", LineString([(382228.3, 5466005.8), (382245.6, 5465926.7)]),
    "Sharp edge az 167.7 grid (77.7 perpendicular ~ palace axis), 81 m long; step 335.1 -> 340.7 m (5.6 m) in P4. Standing wall remains (OSM 'Orangerie' ruin).", "step")
add("KB-31", "foundation", "Orangerie building footprint (on upper terrace)", "med", rect(382241.5, 5465966, 84, 9, 167.7),
    "Parallel inner line 6-8 m E of KB-30 - building depth ~8-10 m; length ~84 m.", "height")
add("KB-32", "terrace", "Orangerie lower terrace (W, 335 m)", "med", rect(382226, 5465962, 75, 14, 167.7), "Flat bench ~14 m wide below the wall, 335.0 m.", "level")
add("KB-33", "terrace", "Orangerie parterre (upper level 340.4-340.8 m)", "med",
    Polygon([(382246, 5466004), (382281, 5465981), (382309, 5465930), (382283, 5465916), (382249, 5465924)]), "Flat garden terrace E of the Orangerie, bounded E by a V-shaped scarp (~2-3 m) rising to 343-344.7 m.", "level")
add("KB-34", "other", "Circular feature in clearing (basin? modern?)", "low", ring(382263, 5465972, 17, 14), "Two concentric rings D ~34/28 m, very subtle relief; in a meadow clearing. Could be a baroque basin outline or a modern feature.", None)

# ---------------- Karlsbergweiher ----------------
add("KB-40", "pond", "Karlsbergweiher (water surface)", "high",
    Polygon([(381822, 5465895), (381948, 5465900), (381961, 5465878), (381948, 5465857), (381832, 5465850)]),
    "Water level 276.18 m (LiDAR water return), ~130 x 45 m; island at E end.", "level")
add("KB-41", "other", "Karlsbergweiher island", "high", circle(381945, 5465880, 6), "Round island D ~12 m.", "height")
add("KB-42", "dam", "Karlsbergweiher W dam", "med", LineString([(381816, 5465902), (381822, 5465848)]), "Crest ~277 m, downstream valley 274.7 m (P6).", None)

# ---------------- north / Forsthaus ----------------
add("KB-50", "cellar", "Eiskeller (collapsed ice cellar: pit with ring bank)", "high", circle(382508, 5466296, 5), "OSM archaeological site 382520/5466333 is 38 m N - pit here is the clear match.", "depth")
add("KB-51", "pit", "Well at former Forsthaus (Brunnen)", "med", circle(382386, 5466477, 2.5), "Matches OSM 'Brunnen am alten Forsthaus' (382363/5466481) within 23 m.", "depth")
add("KB-52", "platform", "Building platforms at the 1836-41 'Forsthaus' (W of N-S avenue)", "low",
    rect(382203, 5466650, 100, 16, 0), "Raised strip with pits along E 382195-382210; 1836-41 red building marks fall here after -50 m E shift.", "height")
add("KB-53", "other", "Rectangular low-bank enclosure (garden? plantation?)", "low",
    Polygon([(382552, 5466438), (382640, 5466445), (382650, 5466355), (382555, 5466352)]), "Faint banks; could be forestry fencing.", None)

# ---------------- Karlsberger Hof ----------------
add("KB-60", "other", "Karlsberger Hof (existing building complex)", "med",
    Polygon([(381508, 5465945), (381560, 5465945), (381560, 5466025), (381520, 5466025), (381508, 5465970)]),
    "Large building on stepped platform at the foot of the hill; 1836-41 'Carlsbergerhof' building lands here after -50 m E correction. Built-up (DSM), identification medium.", None)

# ---------------- Karlslust ----------------
add("KL-01", "other", "Barenzwinger: moated round island", "high", ring(382935, 5464913, 22, 15), "Round moat/ring D ~44 m with square feature ~10 m inside (centre 382930/5464915); OSM Barenzwinger way.", "depth")
add("KL-02", "terrace", "Terraced parallel-strip complex E of Barenzwinger (kennels/enclosures/garden?)", "med",
    Polygon([(383020, 5464950), (383070.6, 5464858.3), (383112, 5464765), (383063, 5464741), (383023, 5464722), (382985, 5464822), (382962, 5464862)]),
    "Parallelogram ~90 x 220 m; NE scarp az 154.1 grid; 7-9 cross banks az ~75 spaced 15-20 m, each step ~1 m (P7: 300.2 -> 292.5 m); SW corner bank 4.7 m. Function not determinable from LiDAR.", None)
add("KL-03", "other", "Cascade (stepped channel) on N slope, axis E 382815", "med", LineString([(382815, 5464930), (382814, 5464835)]),
    "Straight stepped feature 8-12 m wide; P5: 310.5 -> 271.6 m over 150 m with landings every 10-15 m; ends in KL-04. Axis az ~180 grid.", "line")
add("KL-04", "pond", "Tosbecken (plunge basin) / upper pond", "high",
    Polygon([(382783, 5464815), (382800, 5464826), (382835, 5464824), (382840, 5464805), (382815, 5464795), (382790, 5464800)]), "Water/flat surface 271.6 m.", "level")
add("KL-05", "pond", "Schwanenweiher pond 1 (oval, with two islets)", "high", ellipse(382855, 5464786, 30, 20, 160), "Oval ~40 x 60 m, two round islets D ~5 m.", "level")
add("KL-06", "pond", "Schwanenweiher pond 2", "high",
    Polygon([(382858, 5464740), (382880, 5464748), (382905, 5464712), (382900, 5464690), (382878, 5464683), (382860, 5464700)]), "", "level")
add("KL-07", "pond", "Schwanenweiher pond 3 (small, lower)", "med", circle(382913, 5464690, 11), "", "level")
add("KL-08", "avenue", "Axis S of Tosbecken: stepped avenue/canal to rondell", "med", LineString([(382809.5, 5464785), (382812.8, 5464662)]),
    "Two parallel lines ~9-10 m apart, az 178.5 grid, rising 274 -> 287.5 m in steps; continues the cascade axis across the valley.", "line")
add("KL-09", "other", "Rondell at S end of axis", "med", circle(382815, 5464652, 6), "Round platform/basin D ~12 m at 287.5 m.", "height")
add("KL-10", "foundation", "Tschifflik pavilion ruin: mound with central cellar pit", "high", circle(382618, 5464770, 10),
    "Mound D ~20 m, central pit ~4 x 6 m; OSM 'Tschifflik Pavillon' (1786).", "height")
add("KL-11", "platform", "Oval mound with depression E of Tschifflik", "low", ellipse(382745, 5464750, 13, 8, 160), "~25 x 15 m.", "height")
add("KL-12", "platform", "Eremitage site: ring mound", "low", circle(383155, 5464658, 8), "Ring/mound D ~15 m at the OSM 'Eremitage' point.", "height")
add("KL-13", "other", "Sharp rectangle 50 x 20 m (modern building/hut? check)", "low", rect(382745, 5464610, 50, 20, 70), "Very crisp edges - probably modern.", "height")

def stats(geom, mode):
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        inside = ~geometry_mask([mapping(geom)], Z.shape, tf, all_touched=True)
        ringg = geom.buffer(6).difference(geom.buffer(2))
        out = ~geometry_mask([mapping(ringg)], Z.shape, tf, all_touched=False)
        zi, zo = Z[inside], Z[out]
        ndsm = (DOM - Z)[inside]
        r = {"z_min": float(np.nanmin(zi)), "z_med": float(np.nanmedian(zi)), "z_max": float(np.nanmax(zi)),
             "z_out_med": float(np.nanmedian(zo)), "z_p10": float(np.nanpercentile(zi, 10)), "z_p90": float(np.nanpercentile(zi, 90)),
             "ndsm_med": float(np.nanmedian(ndsm))}
        mrr = geom.minimum_rotated_rectangle; xs, ys = mrr.exterior.coords.xy
        e = [math.hypot(xs[i + 1] - xs[i], ys[i + 1] - ys[i]) for i in range(2)]
        i = int(np.argmax(e)); az = math.degrees(math.atan2(xs[i + 1] - xs[i], ys[i + 1] - ys[i])) % 180
        r.update(L=max(e), W=min(e), az=az, area=geom.area)
        if mode == "height": r["height_m"] = r["z_p90"] - r["z_out_med"]
        if mode == "depth": r["depth_m"] = r["z_out_med"] - r["z_p10"]
        if mode == "level": r["level_m"] = r["z_med"]
        if max(e) / max(min(e), 0.1) < 1.25: r.pop("az")
        return r
    if geom.geom_type == "LineString":
        c = np.array(geom.coords); a, b = c[0], c[-1]
        az = math.degrees(math.atan2(b[0] - a[0], b[1] - a[1])) % 360
        r = {"L": geom.length, "az": az}
        pts = [geom.interpolate(t) for t in np.arange(0, geom.length, 1.0)]
        rows = [int((tf.f - p.y) / -tf.e) for p in pts]; cols = [int((p.x - tf.c) / tf.a) for p in pts]
        zl = Z[rows, cols]; r.update(z_min=float(zl.min()), z_max=float(zl.max()))
        if mode == "step":
            # mean height difference on either side (3-8 m off the line)
            def side(s):
                vals = []
                for t, p in zip(np.arange(0, geom.length, 1.0), pts):
                    q0, q1 = geom.interpolate(max(t - 0.5, 0)), geom.interpolate(min(t + 0.5, geom.length))
                    u = np.array([q1.x - q0.x, q1.y - q0.y]); u /= np.linalg.norm(u); n = np.array([u[1], -u[0]])
                    for o in (4, 6, 8):
                        q = np.array([p.x, p.y]) + s * o * n
                        vals.append(Z[int((tf.f - q[1]) / -tf.e), int((q[0] - tf.c) / tf.a)])
                return float(np.median(vals))
            r["height_m"] = abs(side(1) - side(-1))
        return r
    return {}

feats, rows = [], []
for i, kind, name, conf, g, notes, mode in F:
    s = stats(g, mode)
    props = {"id": i, "kind": kind, "name_guess": name, "confidence": conf,
             "height_m": round(s["height_m"], 2) if "height_m" in s else None,
             "depth_m": round(s["depth_m"], 2) if "depth_m" in s else None,
             "level_m": round(s["level_m"], 2) if "level_m" in s else None,
             "z_min": round(s.get("z_min", float("nan")), 2) if "z_min" in s else None,
             "z_max": round(s.get("z_max", float("nan")), 2) if "z_max" in s else None,
             "length_m": round(s["L"], 1) if "L" in s else None,
             "width_m": round(s["W"], 1) if "W" in s else None,
             "azimuth_grid_deg": round(s["az"], 1) if "az" in s else None,
             "azimuth_true_deg": round((s["az"] + CONV) % (180 if "W" in s else 360), 1) if "az" in s else None,
             "notes": notes, "source": "DGM1 1 m (LVGL-SL 2025 / LVermGeoRP 2022), digitised from SLRM/hillshade/openness"}
    gj = mapping(g); gj = json.loads(json.dumps(gj))
    def rnd(x):
        return [rnd(y) for y in x] if isinstance(x, (list, tuple)) and x and isinstance(x[0], (list, tuple)) else [round(x[0], 1), round(x[1], 1)]
    gj["coordinates"] = rnd(gj["coordinates"])
    feats.append({"type": "Feature", "properties": props, "geometry": gj})
    cen = g.centroid
    dims = f"{s['L']:.0f}" + (f" x {s['W']:.0f}" if "W" in s and g.geom_type != "LineString" else "")
    zs = f"{s['z_min']:.1f}-{s['z_max']:.1f}" if "z_min" in s else ""
    hd = (f"h {s['height_m']:.1f}" if "height_m" in s else "") + (f"d {s['depth_m']:.1f}" if "depth_m" in s else "") + (f"level {s['level_m']:.1f}" if "level_m" in s else "")
    azs = f"{s['az']:.1f} / {(s['az'] + CONV) % (180 if g.geom_type != 'LineString' else 360):.1f}" if "az" in s else ""
    rows.append(f"| {i} | {kind} | {name} | {conf} | {cen.x:.0f} / {cen.y:.0f} | {dims} | {azs} | {zs} | {hd} |")
fc = {"type": "FeatureCollection", "name": "schloss_karlsberg_lidar_features",
      "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::25832"}}, "features": feats}
Path(sys.argv[2]).write_text(json.dumps(fc, ensure_ascii=False, indent=1))
hdr = "| id | kind | name (guess) | conf. | centroid E / N | L x W (m) | az grid / true (deg) | DTM z range (m) | h / d / level (m) |\n|---|---|---|---|---|---|---|---|---|\n"
Path(sys.argv[3]).write_text(hdr + "\n".join(rows) + "\n")
print(hdr + "\n".join(rows))
