#!/usr/bin/env python3
"""Check the exported files with the reference libraries.

    pip install pyarrow pyshp pillow
    node --test test/export.test.mjs      # writes tools/out/export-check.*
    python3 tools/verify-exports.py

The Node tests check structure; this checks that other people's readers agree.
"""
import json
import sys
import zipfile
from pathlib import Path

OUT = Path(__file__).parent / "out"
failures = []


def check(label, fn):
    try:
        detail = fn()
        print(f"  ok   {label}" + (f" — {detail}" if detail else ""))
    except Exception as exc:  # noqa: BLE001 - report anything at all
        failures.append(label)
        print(f"  FAIL {label} — {type(exc).__name__}: {exc}")


def geojson():
    path = OUT / "export-check.geojson"
    data = json.loads(path.read_text())
    kinds = {}
    for f in data["features"]:
        kinds[f["properties"]["kind"]] = kinds.get(f["properties"]["kind"], 0) + 1
        if f["properties"]["kind"] == "area":
            for ring in f["geometry"]["coordinates"]:
                assert ring[0] == ring[-1], "ring not closed"''
    assert kinds.get("place", 0) > 200, kinds
    assert kinds.get("flow", 0) > 100, kinds
    assert kinds.get("area", 0) > 200, kinds
    return ", ".join(f"{v} {k}" for k, v in sorted(kinds.items()))


def parquet():
    import pyarrow.parquet as pq

    path = OUT / "export-check.parquet"
    table = pq.read_table(path)
    meta = pq.read_metadata(path)
    assert table.num_rows > 500, table.num_rows
    names = table.schema.names
    for col in ("kind", "name", "geometry", "value"):
        assert col in names, names
    kv = {k.decode(): v.decode() for k, v in (meta.metadata or {}).items()}
    assert "geo" in kv, kv.keys()
    geo = json.loads(kv["geo"])
    assert geo["primary_column"] == "geometry", geo
    assert geo["columns"]["geometry"]["encoding"] == "WKB", geo
    kinds = set(table.column("kind").to_pylist())
    assert kinds == {"place", "flow", "area"}, kinds
    return f"{table.num_rows} rows, columns {names}, geo v{geo['version']}"


def parquet_wkb():
    """The geometry column must parse as WKB — the point of GeoParquet."""
    import pyarrow.parquet as pq

    table = pq.read_table(OUT / "export-check.parquet").to_pydict()
    seen = set()
    checked = 0
    for kind, wkb in zip(table["kind"], table["geometry"]):
        if kind in seen:
            continue
        seen.add(kind)
        order, gtype = wkb[0], int.from_bytes(wkb[1:5], "little")
        assert order == 1, "little endian expected"
        if gtype == 1:
            x = int.from_bytes(wkb[5:13], "little", signed=False)
            import struct

            lon, lat = struct.unpack("<dd", wkb[5:21])
            assert -180 <= lon <= 180 and -90 <= lat <= 90, (lon, lat)
        elif gtype == 2:
            n = int.from_bytes(wkb[5:9], "little")
            assert len(wkb) == 9 + n * 16, (n, len(wkb))
        elif gtype == 3:
            rings = int.from_bytes(wkb[5:9], "little")
            assert rings >= 1, rings
            at = 9
            for _ in range(rings):
                n = int.from_bytes(wkb[at : at + 4], "little")
                at += 4 + n * 16
            assert at == len(wkb), (at, len(wkb))
        checked += 1
    assert checked == 3, checked
    return "point, linestring and polygon all parse"


def parquet_geopandas():
    """If geopandas is around, this is the real-world reader test."""
    import geopandas as gpd

    gdf = gpd.read_parquet(OUT / "export-check.parquet")
    assert len(gdf) > 500
    points = gdf[gdf["kind"] == "place"]
    assert points.geometry.iloc[0].geom_type == "Point"
    bounds = points.total_bounds
    assert 41 < bounds[0] < 55 and 11 < bounds[1] < 20, bounds
    return f"{len(gdf)} features, {len(points)} points, crs={gdf.crs}"


def shapefiles():
    import shapefile

    with zipfile.ZipFile(OUT / "export-check-shp.zip") as zf:
        names = zf.namelist()
        assert "places.shp" in names and "flows.shp" in names, names
        zf.extractall(OUT / "shp")
    reader = shapefile.Reader(str(OUT / "shp" / "places.shp"))
    assert reader.shapeTypeName == "POINT", reader.shapeTypeName
    assert len(reader) > 200, len(reader)
    names = [f[0].lower() for f in reader.fields[1:]]
    assert "name" in names and "value" in names, names
    rec = dict(zip(names, reader.record(0)))
    assert rec["name"], rec
    bb = reader.bbox
    assert 41 < bb[0] < 55 and 11 < bb[1] < 20, bb

    flows = shapefile.Reader(str(OUT / "shp" / "flows.shp"))
    assert flows.shapeTypeName == "POLYLINE", flows.shapeTypeName
    assert len(flows) > 100

    areas = shapefile.Reader(str(OUT / "shp" / "areas.shp"))
    assert areas.shapeTypeName == "POLYGON", areas.shapeTypeName
    assert len(areas) > 200, len(areas)
    return f"{len(reader)} places, {len(flows)} flows, {len(areas)} areas"


def prj():
    text = (OUT / "shp" / "places.prj").read_text()
    assert "WGS 84" in text and "EPSG" in text, text[:60]
    return text[:38] + "…"


def gif():
    from PIL import Image, ImageSequence

    with Image.open(OUT / "export-check.gif") as im:
        assert im.format == "GIF", im.format
        # each yielded frame is the same object, so copy what we need here
        frames = [f.convert("RGB").copy() for f in ImageSequence.Iterator(im)]
        assert im.size == (32, 24), im.size
        assert len(frames) >= 2, len(frames)
        a, b = frames[0].tobytes(), frames[1].tobytes()
        assert a != b, "frames look identical"
        assert len(set(frames[0].getdata())) > 8, "the first frame has real content"
        return f"{len(frames)} frames of {im.size[0]}×{im.size[1]}"


if __name__ == "__main__":
    if not OUT.exists():
        sys.exit("run `node --test test/export.test.mjs` first — it writes tools/out/")
    print("verifying exports with the reference readers")
    check("GeoJSON", geojson)
    check("GeoParquet (pyarrow)", parquet)
    check("GeoParquet geometry (WKB)", parquet_wkb)
    check("GeoParquet (geopandas)", parquet_geopandas)
    check("shapefile (pyshp)", shapefiles)
    check("projection file (.prj)", prj)
    check("animated GIF (Pillow)", gif)
    print()
    if failures:
        print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
        sys.exit(1)
    print("every export reads back correctly")
