"""Fetch DGM1/DOM1 2025 tiles (LVGL Saarland) + RLP border fill tiles for an AOI and its buffer ring.

Saarland tiles are range-extracted from the county ZIPs on the LVGL open-data Nextcloud share
(HTTP Range requests, so only the ~2 MB members are transferred, not the ~1 GB ZIPs).
RLP tiles are plain files under https://geobasis-rlp.de/data/{dgm1,dom1}/current/tif/.

Usage:  uv run python fetch.py <aoi> [--products dgm1,dom1] [--no-rlp]

Downloaded files are treated as untrusted data: they are only ever opened as rasters.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import rasterio

from common import RLP_RAW, SL_RAW, SSL_CTX, USER_AGENT, fmt_bytes, http_open, load_aoi, sl_name

SHARE_ENTRY = "https://www.shop.lvgl.saarland.de/cloud/freiegeobasisdaten"
CLOUD_BASE = "https://www.shop.lvgl.saarland.de/cloud"
SL_FOLDERS = {"dgm1": "OD_DGM1_2025_tif_LK", "dom1": "OD_DOM1_2025_tif_LK"}
RLP_BASE = "https://geobasis-rlp.de/data/{product}/current/tif/"


# --------------------------------------------------------------------------- LVGL share
class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def resolve_share_token() -> str:
    """Read the 302 Location of the public 'freiegeobasisdaten' link; the share token may change.

    The redirect points to http://…/cloud/index.php/s/<token>, which itself redirects to the site root,
    so we must not follow it blindly.
    """
    opener = urllib.request.build_opener(_NoRedirect, urllib.request.HTTPSHandler(context=SSL_CTX))
    req = urllib.request.Request(SHARE_ENTRY, headers={"User-Agent": USER_AGENT})
    try:
        r = opener.open(req, timeout=30)
        loc, body = r.geturl(), r.read(200_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:  # 3xx surfaces as HTTPError when not followed
        loc, body = e.headers.get("Location", ""), ""
    m = re.search(r"/s/([A-Za-z0-9]+)", loc) or re.search(r"/s/([A-Za-z0-9]{8,})", body)
    if not m:
        sys.exit(f"could not resolve Nextcloud share token (Location: {loc!r})")
    return m.group(1)


def dav_list(url: str) -> list[str]:
    """PROPFIND Depth:1 → list of child names."""
    with http_open(url, method="PROPFIND", headers={"Depth": "1"}) as r:
        tree = ET.fromstring(r.read())
    names = []
    for href in tree.iter("{DAV:}href"):
        name = urllib.parse.unquote(href.text.rstrip("/").rsplit("/", 1)[-1])
        names.append(name)
    return names[1:]  # first entry is the folder itself


class HttpRangeFile(io.RawIOBase):
    """Seekable read-only file over HTTP Range requests (with retries)."""

    def __init__(self, url: str):
        self.url, self.pos, self.requests, self.bytes = url, 0, 0, 0
        with http_open(url, method="HEAD") as r:
            self.size = int(r.headers["Content-Length"])
            if r.headers.get("Accept-Ranges", "").lower() != "bytes":
                print(f"  ! server does not advertise Accept-Ranges for {url}", file=sys.stderr)

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def readinto(self, b):
        if self.pos >= self.size or len(b) == 0:
            return 0
        end = min(self.pos + len(b), self.size) - 1
        for attempt in range(5):
            with http_open(self.url, headers={"Range": f"bytes={self.pos}-{end}"}) as r:
                if r.status != 206 and not (self.pos == 0 and end == self.size - 1):
                    raise IOError(f"expected 206 Partial Content, got {r.status}")
                d = r.read()
            if len(d) == end - self.pos + 1:
                break
            print(f"  ! short read ({len(d)} of {end - self.pos + 1}), retrying", file=sys.stderr)
            time.sleep(2 ** attempt)
        else:
            raise IOError("repeated short reads")
        self.requests += 1
        self.bytes += len(d)
        b[: len(d)] = d
        self.pos += len(d)
        return len(d)


def valid_tif(path: Path) -> bool:
    try:
        with rasterio.open(path) as ds:
            return ds.width >= 1000 and ds.height >= 1000 and ds.crs is not None
    except Exception:
        return False


def fetch_sl(aoi, products: list[str], refresh: bool = False) -> dict:
    SL_RAW.mkdir(parents=True, exist_ok=True)
    tiles = aoi.tiles(buffered=True)
    report: dict = {}
    known_missing_f = SL_RAW / f"_not_in_zip_{aoi.county}.json"  # tiles outside the county ZIP (e.g. in RLP)
    known_missing = set() if refresh or not known_missing_f.exists() else set(json.loads(known_missing_f.read_text()))
    todo = {p: [t for t in tiles if not (SL_RAW / sl_name(p, *t)).exists() and sl_name(p, *t) not in known_missing]
            for p in products}
    if not any(todo.values()):
        print(f"LVGL: all {len(tiles)} tiles × {products} cached")
    token = resolve_share_token() if any(todo.values()) else None
    if token:
        print(f"LVGL share token: {token}")
    for p in products:
        found, missing, fetched = [], [], []
        for t in tiles:
            if (SL_RAW / sl_name(p, *t)).exists():
                found.append(t)
        if todo[p]:
            dav = f"{CLOUD_BASE}/public.php/dav/files/{token}/{SL_FOLDERS[p]}/"
            zips = [n for n in dav_list(dav) if n.endswith(".zip") and f"_{aoi.county}_" in n]
            if len(zips) != 1:
                sys.exit(f"expected one {aoi.county} ZIP in {dav}, found {zips}")
            url = dav + urllib.parse.quote(zips[0])
            rf = HttpRangeFile(url)
            zf = zipfile.ZipFile(io.BufferedReader(rf, buffer_size=4 << 20))
            members = {Path(i.filename).name: i for i in zf.infolist()}
            print(f"LVGL {p}: {zips[0]} ({fmt_bytes(rf.size)}, {len(members)} members, "
                  f"central dir in {rf.requests} requests)")
            for t in todo[p]:
                name = sl_name(p, *t)
                info = members.get(name)
                if info is None:
                    missing.append(t)
                    known_missing.add(name)
                    print(f"  - {name}: not in ZIP (outside Saarland?)")
                    continue
                dst = SL_RAW / name
                part = dst.with_suffix(".part")
                t0, r0 = time.time(), rf.requests
                for attempt in range(3):
                    try:
                        with zf.open(info) as src, open(part, "wb") as out:
                            while chunk := src.read(4 << 20):
                                out.write(chunk)
                        break
                    except Exception as e:  # CRC / network errors → retry the member
                        print(f"  ! {name}: {e} (attempt {attempt + 1})", file=sys.stderr)
                        time.sleep(3)
                else:
                    sys.exit(f"failed to extract {name}")
                if not valid_tif(part):
                    part.unlink()
                    sys.exit(f"{name}: extracted file is not a valid GeoTIFF")
                part.rename(dst)
                fetched.append(t)
                print(f"  + {name}: {fmt_bytes(info.compress_size)} zipped, "
                      f"{rf.requests - r0} requests, {time.time() - t0:.1f}s")
        missing += [t for t in tiles if sl_name(p, *t) in known_missing and t not in missing]
        report[p] = {"cached": found, "fetched": fetched, "missing": missing}
    known_missing_f.write_text(json.dumps(sorted(known_missing), indent=0))
    return report


# --------------------------------------------------------------------------- RLP
def fetch_rlp(aoi, products: list[str]) -> dict:
    RLP_RAW.mkdir(parents=True, exist_ok=True)
    tiles = set(aoi.tiles(buffered=True))
    report: dict = {}
    for p in products:
        base = RLP_BASE.format(product=p)
        with http_open(base) as r:
            listing = r.read().decode("utf-8", "replace")
        avail = {}
        for m in re.finditer(rf'href="({p}_32_(\d+)_(\d+)_1_rp_(\d{{4}})\.tif)"', listing):
            avail[(int(m.group(2)), int(m.group(3)))] = m.group(1)
        wanted = sorted(t for t in tiles if t in avail)
        got = []
        for t in wanted:
            name = avail[t]
            dst = RLP_RAW / name
            got.append(name)
            if dst.exists():
                continue
            t0 = time.time()
            part = dst.with_suffix(".part")
            with http_open(base + name, timeout=120) as r, open(part, "wb") as out:
                while chunk := r.read(1 << 20):
                    out.write(chunk)
            if not valid_tif(part):
                part.unlink()
                sys.exit(f"{name}: not a valid GeoTIFF")
            part.rename(dst)
            print(f"  + RLP {name}: {fmt_bytes(dst.stat().st_size)}, {time.time() - t0:.1f}s")
            time.sleep(0.3)  # be polite
        print(f"RLP {p}: {len(got)} of {len(tiles)} AOI+buffer tiles exist in RLP (cached/fetched)")
        report[p] = got
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("aoi")
    ap.add_argument("--products", default="dgm1,dom1")
    ap.add_argument("--no-rlp", action="store_true")
    ap.add_argument("--refresh", action="store_true", help="re-check tiles previously not found in the ZIP")
    args = ap.parse_args()
    aoi = load_aoi(args.aoi)
    products = args.products.split(",")
    t0 = time.time()
    print(f"AOI {aoi.key}: {aoi.width}×{aoi.height} m + {aoi.buffer_m} m buffer → {len(aoi.tiles())} tiles")
    rep = {"aoi": aoi.key, "sl": fetch_sl(aoi, products, args.refresh)}
    if not args.no_rlp:
        rep["rlp"] = fetch_rlp(aoi, products)
    (SL_RAW.parent / f"fetch_{aoi.key}.json").write_text(json.dumps(rep, indent=1))
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
