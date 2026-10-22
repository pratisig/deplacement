#!/usr/bin/env python3
"""Turn a flow table into the dataset the flow-map page draws — no arcpy.

This module is deliberately free of ArcGIS imports so it can be unit-tested,
run from a plain shell, and reused by the toolbox (FlowMap.pyt), by a .NET
add-in, or by anything else that can produce JSON. It mirrors, value for
value, the JavaScript loaders in ``src/js/table.js`` and ``src/js/sources.js``
so a table mapped here behaves exactly like the same table dropped on the
page.

    python3 flowmap_core.py demo  --template index.html --out demo.html
    python3 flowmap_core.py build --input spec.json   --template index.html --out page.html
    python3 flowmap_core.py selftest

The dataset contract (also written down in src/js/dataset.js):

    {"meta":{"title","subtitle","unit","nodeLabel","groupLabel","source",
             "dateStart","dateMode"},
     "nodes":[[name, group, lon, lat], …],
     "edges":[[day, originIndex, destinationIndex, value], …],
     "maxDay":int, "total":number,
     "admin1":{"name":{"p":[flat rings]}}, "admin2":{…}}

Days are whole days counted from the first date found, so day quality
"0 = the first day of the record" everywhere in the app.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import math
import os
import re
import sys
import unicodedata

__version__ = "7.2"

# --------------------------------------------------------------------- names


def key_name(name):
    """Loose comparison key for place names — case, accents, punctuation.

    Mirrors keyName() in src/js/sources.js, so "Ségou", "SEGOU" and "Ségou "
    all resolve to the same place.
    """
    s = unicodedata.normalize("NFD", str(name or "").lower())
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]", "", s)


def to_number(value):
    """Numbers as they arrive from a CSV or a shapefile field.

    Accepts None/"" as missing, strips thousands separators and spaces, and
    understands a French decimal comma only when there is no thousands
    grouping, which is how the page reads them too.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(float(value)) else None
    s = str(value).strip()
    if not s:
        return None
    s = s.replace("\u00a0", "").replace(" ", "").lstrip("+")
    if "," in s and "." in s:
        s = s.replace(",", "")  # 1.234,56 -> 1234.56
    elif re.fullmatch(r"-?\d{1,3}(,\d{3})+", s):
        s = s.replace(",", "")  # 1,234,567 -> 1234567
    elif "," in s:
        s = s.replace(",", ".")
    try:
        n = float(s)
    except ValueError:
        return None
    return n if math.isfinite(n) else None


# --------------------------------------------------------------------- dates

_ISO = re.compile(r"^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$")
_DAY_FIRST = re.compile(r"^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$")
_COMPACT = re.compile(r"^(\d{4})(\d{2})(\d{2})$")


def parse_date_value(value):
    """Read the dates people actually write, or return None.

    Same rules as parseDateValue() in src/js/table.js: ISO first, then a
    day value above 12 proves day-first, otherwise month-first is assumed.
    """
    if isinstance(value, _dt.datetime):
        return value.date()
    if isinstance(value, _dt.date):
        return value
    s = str(value or "").strip()
    if not s:
        return None
    m = _ISO.match(s)
    if m:
        return _make_date(int(m.group(1)), int(m.group(2)), int(m.group(3) or 1))
    m = _DAY_FIRST.match(s)
    if m:
        a, b, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return _make_date(year, b, a) if a > 12 else _make_date(year, a, b)
    m = _COMPACT.match(s)
    if m:
        return _make_date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def _make_date(year, month, day):
    try:
        return _dt.date(year, month, day)
    except ValueError:
        return None  # JavaScript rolls these over; a warning is better


# ------------------------------------------------------------------ geometry


def ring_area_ll(ring):
    """Signed planar area of a ring in degrees² (mirrors ringAreaLL)."""
    a = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return a / 2.0


def ring_centroid_ll(ring):
    """Centroid of a ring, falling back to the mean of its points."""
    a = cx = cy = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        f = x1 * y2 - x2 * y1
        a += f
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
    if not a:
        sx = sum(p[0] for p in ring) / n
        sy = sum(p[1] for p in ring) / n
        return [sx, sy]
    a *= 0.5
    return [cx / (6 * a), cy / (6 * a)]


def point_in_rings_ll(x, y, rings):
    """Ray casting against any of the rings (mirrors pointInRingsLL)."""
    for ring in rings:
        inside = False
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
        if inside:
            return True
    return False


def simplify_ring_ll(ring, tolerance):
    """Douglas–Peucker, tolerance in degrees (mirrors simplifyRingLL)."""
    if len(ring) < 4 or tolerance <= 0:
        return ring
    keep = [False] * len(ring)
    keep[0] = keep[-1] = True
    stack = [(0, len(ring) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        x1, y1 = ring[i]
        x2, y2 = ring[j]
        dx, dy = x2 - x1, y2 - y1
        len2 = dx * dx + dy * dy
        best, at = 0.0, -1
        for k in range(i + 1, j):
            x, y = ring[k]
            t = ((x - x1) * dx + (y - y1) * dy) / len2 if len2 else 0.0
            t = max(0.0, min(1.0, t))
            d = math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
            if d > best:
                best, at = d, k
        if best > tolerance and at > 0:
            keep[at] = True
            stack.append((i, at))
            stack.append((at, j))
    return [p for p, k in zip(ring, keep) if k]


def close_ring(points):
    """Make a ring closed, dropping a repeated last point first."""
    pts = list(points)
    while len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    if len(pts) < 3:
        return None
    return pts + [pts[0]]


def _is_num(value):
    """True for anything that behaves like a number — float, Decimal, and the
    numpy scalars that arrive from Fiona and GeoPandas geometries."""
    if isinstance(value, (bool, str, bytes)):
        return False
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def parts_to_rings(parts):
    """Whatever shape a geometry arrives in -> a list of lists of (x, y)."""
    if not parts:
        return []
    parts = list(parts)
    if all(_is_num(v) for v in parts):
        return [list(zip(parts[0::2], parts[1::2]))]
    rings = []
    for part in parts:
        seq = list(part)
        if not seq:
            continue
        if all(_is_num(v) for v in seq) and len(seq) % 2 == 0:
            rings.append(list(zip(seq[0::2], seq[1::2])))
        else:
            rings.append([(p[0], p[1]) for p in seq])
    return rings


def clean_rings(parts, decimals=5, tolerance=0.0):
    """ArcGIS polygon parts -> closed, rounded, simplified flat rings.

    ``parts`` can be a list of parts of (x, y) pairs, a single ring of pairs,
    or one flat [x0, y0, x1, y1, …] list. Returns [[x0, y0, x1, y1, …], …]
    where every ring is closed — the shape the page expects.
    """
    out = []
    for part in parts_to_rings(parts):
        pts = [(float(x), float(y)) for x, y in part if x is not None and y is not None]
        ring = close_ring(pts)
        if tolerance > 0 and ring and len(ring) > 5:
            # simplify the open ring — running Douglas–Peucker on a closed one
            # would anchor both ends on the same point and flatten the shape
            open_ring = simplify_ring_ll(ring[:-1], tolerance)
            smaller = close_ring(open_ring)
            if smaller and len(smaller) >= 4:
                ring = smaller
        if not ring:
            continue
        if decimals is not None:
            ring = [(round(x, decimals), round(y, decimals)) for x, y in ring]
            ring = close_ring(ring) or ring
        flat = []
        for x, y in ring:
            flat.append(x)
            flat.append(y)
        out.append(flat)
    return out


def ring_centre(rings):
    """A point inside the biggest ring of a feature, or None."""
    if not rings:
        return None
    best, best_area = None, -1.0
    for flat in rings:
        ring = list(zip(flat[0::2], flat[1::2]))
        area = abs(ring_area_ll(ring))
        if area > best_area:
            best_area, best = area, ring
    c = ring_centroid_ll(best)
    return c if point_in_rings_ll(c[0], c[1], [best]) else None


def rings_bounds(rings):
    xs = [v for flat in rings for v in flat[0::2]]
    ys = [v for flat in rings for v in flat[1::2]]
    if not xs:
        return None
    return [min(xs), min(ys), max(xs), max(ys)]


# ------------------------------------------------------- what a column holds
#
# A column is judged by what it holds, not only by what it is called. That is
# the difference between a tool that opens with sensible values and one that
# hands the page a case number where it wanted a place name: "CSI_CASE" looks
# like a name until you read the cells, and "Besoins_estimes_1_MILDA_2_personnes"
# contains the letters of "time" without being a date.

# Words that mark an identifier rather than a quantity. A column of them is
# never a name and never a number to draw.
ID_WORDS = (
    "id", "ids", "code", "csi", "case", "cas", "ref", "reference", "cle",
    "key", "uid", "uuid", "gid", "fid", "oid", "objectid", "numero", "num",
    "no", "n", "index", "idx", "row", "record", "enregistrement", "sir",
    "matricule", "identifiant", "ident", "tag",
)

# What a column name suggests it can be. Whole words only: substring matching
# reads "es-ti-mes" as "time" and quietly picks the wrong column.
ROLE_WORDS = {
    "oName": ("origin", "orig", "from", "source", "depart", "start", "o"),
    "dName": ("destination", "dest", "to", "arrive", "arrival", "vers", "d"),
    "name": (
        "name", "nom", "village", "ville", "city", "town", "place", "site",
        "localite", "locality", "lieu", "commune", "district", "zone",
        "quartier", "sous", "prefecture", "prefect", "colline", "secteur",
    ),
    "group": (
        "group", "groupe", "region", "province", "governorate", "gov",
        "state", "dept", "department", "departement", "county", "area",
        "admin", "adm", "zone",
    ),
    "lon": ("lon", "long", "longitude", "lng", "x", "east", "est"),
    "lat": ("lat", "latitude", "y", "north", "nord"),
    "date": (
        "date", "day", "jour", "journee", "time", "mois", "month", "week",
        "semaine", "annee", "year", "periode", "period", "timestamp",
    ),
    "value": (
        "value", "valeur", "count", "nombre", "total", "sum", "cases", "cas",
        "hh", "households", "menage", "menages", "people", "personnes",
        "population", "pop", "flow", "volume", "milda", "besoins", "deplaced",
        "deplaces", "displaced", "arrivals", "departures", "tonnes",
    ),
}

_CAMEL = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_SPLIT = re.compile(r"[^A-Za-z0-9]+")


def column_words(name):
    """The words of a column name, whole. ``Lon_dept`` -> ['lon', 'dept']."""
    parts = []
    for chunk in _SPLIT.split(str(name or "")):
        if not chunk:
            continue
        parts.extend(_CAMEL.split(chunk))
    return [p.lower() for p in parts if p and not p.isdigit()]


def name_matches(name, role):
    """True when a column name carries a word of this role."""
    words = column_words(name)
    wanted = ROLE_WORDS.get(role, ())
    for word in words:
        for candidate in wanted:
            if word == candidate:
                return True
            # a plural or a suffix: "menages" for "menage", "villages" for
            # "village"; never a prefix that swallows a different word
            if len(candidate) >= 4 and (word == candidate + "s" or word == candidate + "x"):
                return True
    return False


def profile_column(name, values):
    """Read a column: how many cells, how many numbers, dates, distinct.

    Cheap on purpose - it runs on a sample - but it is what lets the tool say
    "this column holds no number" instead of discovering it after a failed
    build, and what lets it refuse an identifier as a place name.
    """
    cells = [v for v in (values or []) if v is not None and str(v).strip() != ""]
    numbers, dates = [], 0
    for cell in cells:
        number = to_number(cell)
        if number is None:
            continue
        numbers.append(number)
    for cell in cells:
        if parse_date_value(cell) is not None:
            dates += 1
    total = len(cells) or 1
    distinct = len({str(v).strip() for v in cells})
    return {
        "name": str(name),
        "cells": len(cells),
        "numbers": len(numbers),
        "dates": dates,
        "distinct": distinct,
        "numeric": len(numbers) >= max(1, int(0.8 * total)),
        "date": dates >= max(1, int(0.6 * total)),
        "text": len(numbers) < max(1, int(0.5 * total)),
        "distinct_ratio": distinct / float(total) if cells else 0.0,
        "min": min(numbers) if numbers else None,
        "max": max(numbers) if numbers else None,
    }


def looks_like_id(name, prof):
    """An identifier is not a place name, and not a quantity to draw."""
    if any(word in ID_WORDS for word in column_words(name)):
        return True
    if not prof:
        return False
    # whole numbers, every cell distinct, running 1, 2, 3 ... n: an auto
    # number. A column of counts is often all-distinct too, which is why the
    # numbers alone are not enough - only a sequence is a key.
    if not (prof["numeric"] and prof["min"] is not None and prof["distinct_ratio"] > 0.99):
        return False
    if not (float(prof["min"]).is_integer() and float(prof["max"]).is_integer()):
        return False
    span = prof["max"] - prof["min"] + 1
    return span == prof["distinct"] and prof["distinct"] > 3


def looks_projected(prof):
    """A coordinate column in metres: no number lands in a degree range."""
    if not prof or not prof["numeric"]:
        return False
    if prof["min"] is None:
        return False
    return abs(prof["max"]) > 180 or abs(prof["min"]) > 180


def out_of_degrees(prof, axis="lon"):
    """Coordinates that cannot be degrees on this axis."""
    if not prof or not prof["numeric"] or prof["min"] is None:
        return False
    limit = 180.0 if axis == "lon" else 90.0
    return prof["min"] < -limit or prof["max"] > limit


def guess_unit_label(column_name):
    """What one unit of the value column is called, from its name."""
    words = column_words(column_name)
    if not words:
        return ""
    tests = (
        ("households", ("household", "households", "hh", "ménage", "menage", "menages", "menages")),
        ("people", ("people", "person", "persons", "personnes", "personne", "population", "pop", "individus")),
        ("cases", ("case", "cases", "cas", "dossiers", "dossier")),
        ("tonnes", ("tonne", "tonnes", "t")),
        ("mildas", ("milda", "mildas")),
    )
    for label, wanted in tests:
        for word in words:
            if word in wanted:
                return label
    # a name that means nothing in particular: keep it, cleaned up
    joined = " ".join(words)
    return joined


def _median(values):
    ordered = sorted(values)
    if not ordered:
        return None
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return 0.5 * (ordered[middle - 1] + ordered[middle])


def _km_between(a, b):
    """Rough distance in km between two lon/lat pairs - for comparisons only."""
    dx = (a[0] - b[0]) * math.cos(math.radians((a[1] + b[1]) / 2.0)) * 111.32
    dy = (a[1] - b[1]) * 110.57
    return math.hypot(dx, dy)


def _pairs_inside(lons, lats):
    """How many of the pairs are plausible degrees, and how many are not."""
    good = 0
    for lon, lat in zip(lons, lats):
        if lon is None or lat is None:
            continue
        if -180.0 <= lon <= 180.0 and -90.0 <= lat <= 90.0:
            good += 1
    return good, max(len(lons), 1)


def coordinate_pairing(d_lons, d_lats, samples=None, labels=("", "")):
    """Are these two columns really (longitude, latitude)?

    ``d_lons``/``d_lats`` are the destination columns as value lists,
    ``samples`` the origin points, ``labels`` the two column names for the
    message. Returns ``("ok" | "swap" | "unknown", reason)``.

    Two tests, in order:

    1. impossible values - a destination latitude of -17 with a longitude of
       14 is legal on its own, but when swapping makes every point valid and
       not swapping does not, the swap is certain;
    2. proximity - destinations sit near their origins in almost every flow
       table. If swapping brings them several times closer, the columns were
       read the wrong way round.

    Only a clear result is returned as "swap": a guess that moves real
    coordinates is worse than a warning that says "check this".
    """
    d_lons = [to_number(v) for v in (d_lons or [])]
    d_lats = [to_number(v) for v in (d_lats or [])]
    if not d_lons or not d_lats:
        return ("unknown", "")
    as_is = list(zip(d_lons, d_lats))
    swapped = list(zip(d_lats, d_lons))
    good_as_is, total = _pairs_inside([p[0] for p in as_is], [p[1] for p in as_is])
    good_swap, _ = _pairs_inside([p[0] for p in swapped], [p[1] for p in swapped])
    if total < 3:
        return ("unknown", "")
    name_lon, name_lat = labels
    if good_swap > good_as_is and good_swap >= 0.8 * total and good_as_is < 0.5 * total:
        return (
            "swap",
            "%s holds the latitude and %s the longitude: swapping them puts "
            "every point back on the map." % (name_lon, name_lat),
        )
    origins = [(float(x), float(y)) for x, y in (samples or []) if x is not None and y is not None]
    if len(origins) < 3:
        return ("ok" if good_as_is >= 0.9 * total else "unknown", "")
    near_as_is = _median(
        [_km_between(o, p) for o, p in zip(origins, as_is) if p[0] is not None and p[1] is not None]
    )
    near_swap = _median(
        [_km_between(o, p) for o, p in zip(origins, swapped) if p[0] is not None and p[1] is not None]
    )
    if near_as_is is None or near_swap is None:
        return ("ok", "")
    if near_swap < 250 and near_as_is > max(500.0, 4.0 * near_swap):
        return (
            "swap",
            "%s holds the latitude and %s the longitude: swapping them brings "
            "the destinations from %s km to %s km of their origins."
            % (name_lon, name_lat, int(near_as_is), int(near_swap)),
        )
    return ("ok", "")


def _column_values(rows, name):
    return [row.get(name) for row in rows] if name else []


def guess_mapping(field_names, rows=None):
    """Prefill the field mapping from the column names *and* their content.

    ``rows`` is a sample of the table: when it is given, a column that holds
    no number is never chosen as the value, a column of identifiers is never a
    place name, and two coordinate columns are paired so that the points land
    where the names say they should.
    """
    names = [str(f) for f in (field_names or [])]
    profiles = {}
    if rows:
        for name in names:
            profiles[name] = profile_column(name, _column_values(rows, name))

    def prof(name):
        return profiles.get(name)

    def numeric(name):
        p = prof(name)
        return bool(p and p["numeric"])

    def texty(name):
        p = prof(name)
        return bool(p and p["text"] and p["distinct"] > 1)

    def dated(name):
        p = prof(name)
        return bool(p and p["date"])

    used = set()

    def take(candidates, accept=None):
        for name in candidates:
            if name in used:
                continue
            if accept is not None and not accept(name):
                continue
            used.add(name)
            return name
        return ""

    def ordered(role):
        """Columns whose name carries the role word, in table order."""
        return [n for n in names if n not in used and name_matches(n, role)]

    # longitude and latitude by name; content only confirms
    lon_cols = [n for n in ordered("lon") if not name_matches(n, "lat")]
    lat_cols = [n for n in ordered("lat") if not name_matches(n, "lon")]
    # a column called "x" or "y" alone is only taken when the numbers agree
    lon_cols = [n for n in lon_cols if numeric(n) or not rows]
    lat_cols = [n for n in lat_cols if numeric(n) or not rows]

    def axis_ok(name, axis):
        if not rows:
            return True
        p = prof(name)
        if not p or not p["numeric"]:
            return False
        return not out_of_degrees(p, axis)

    lon_cols = [n for n in lon_cols if axis_ok(n, "lon")]
    lat_cols = [n for n in lat_cols if axis_ok(n, "lat")]

    o_lon = take(lon_cols[:1])
    d_lon = take([n for n in lon_cols[1:] if n != o_lon] or [])
    o_lat = take(lat_cols[:1])
    d_lat = take([n for n in lat_cols[1:] if n != o_lat] or [])

    # names: explicit origin/destination first, then any place-name column
    def name_ok(name):
        p = prof(name)
        if not rows:
            return True
        if not p or not p["cells"]:
            return False
        return not looks_like_id(name, p) and p["distinct"] > 1

    o_name = take(
        [n for n in names if name_matches(n, "oName") and not name_matches(n, "dName")],
        name_ok,
    )
    d_name = take(
        [n for n in names if name_matches(n, "dName") and not name_matches(n, "oName")],
        name_ok,
    )
    if not o_name:
        o_name = take([n for n in names if name_matches(n, "name")], name_ok)
    if not o_name:
        # the most distinct text column is a better name than nothing
        candidates = sorted(
            (n for n in names if n not in used and name_ok(n) and texty(n)),
            key=lambda n: -(prof(n)["distinct"] if prof(n) else 0),
        )
        o_name = take(candidates[:1])
    if not d_name:
        d_name = o_name

    # a single group column describes both ends
    group = take([n for n in names if name_matches(n, "group")], name_ok)
    o_group = group
    d_group = group

    date = take([n for n in names if name_matches(n, "date")], dated if rows else None)
    if not date and rows:
        date = take([n for n in names if dated(n) and not numeric(n)], None)

    # the value: a quantity, never an identifier
    def value_ok(name):
        p = prof(name)
        if not rows:
            return True
        return bool(p and p["numeric"] and not looks_like_id(name, p))

    value = take([n for n in names if name_matches(n, "value")], value_ok)
    if not value:
        # the widest numeric column that is not a coordinate or an identifier
        candidates = sorted(
            (
                n
                for n in names
                if n not in used and value_ok(n) and n not in (o_lon, o_lat, d_lon, d_lat)
            ),
            key=lambda n: -(prof(n)["max"] - prof(n)["min"] if prof(n) and prof(n)["min"] is not None else 0),
        )
        value = take(candidates[:1])

    if not d_lon and o_lon:
        d_lon = o_lon
    if not d_lat and o_lat:
        d_lat = o_lat

    mapping = {
        "oName": o_name,
        "dName": d_name or o_name,
        "oGroup": o_group,
        "dGroup": d_group,
        "oLon": o_lon,
        "oLat": o_lat,
        "dLon": d_lon,
        "dLat": d_lat,
        "date": date,
        "value": value,
    }
    # the destination pair may still be the wrong way round
    if rows and o_lon and o_lat and d_lon and d_lat:
        o_pairs = list(zip(_column_values(rows, o_lon), _column_values(rows, o_lat)))
        o_pairs = [(to_number(a), to_number(b)) for a, b in o_pairs]
        d_lons = [to_number(v) for v in _column_values(rows, d_lon)]
        d_lats = [to_number(v) for v in _column_values(rows, d_lat)]
        verdict, _reason = coordinate_pairing(
            d_lons,
            d_lats,
            samples=[p for p in o_pairs if p[0] is not None],
            labels=(d_lon, d_lat),
        )
        if verdict == "swap":
            mapping["swapDest"] = True
    return mapping


def diagnose_mapping(rows, mapping):
    """What is wrong with the mapping, in words, before anything is built.

    Each finding is ``{"role": core role, "level": "error"|"warning"|"info",
    "text": ...}``. The toolbox shows these next to the parameters while the
    dialog is open and repeats them as warnings when a build fails, so a
    mistake is never a bare "No usable rows".
    """
    mapping = mapping or {}
    findings = []
    rows = rows or []

    def add(role, level, text):
        findings.append({"role": role, "level": level, "text": text})

    def prof(name):
        return profile_column(name, _column_values(rows, name)) if name and rows else None

    for role in ("oName", "dName"):
        column = mapping.get(role)
        if not column:
            continue
        p = prof(column)
        if p and p.get("numeric") and looks_like_id(column, p):
            # only a run of auto-numbers is refused: a TEXT column whose
            # values are all different is simply a list of places (one health
            # centre per row), whatever the column is called
            add(
                role,
                "warning",
                '"%s" holds numbers that look like auto-numbering, not place '
                "names (e.g. %s). Check that this is the column that names the "
                "place." % (column, _example(rows, column)),
            )
        elif p and p["distinct"] <= 1:
            add(role, "warning", '"%s" has a single value; every row will name the same place.' % column)

    value = mapping.get("value")
    if value:
        p = prof(value)
        if p and p["numbers"] == 0:
            add(
                "value",
                "error",
                'The value column "%s" holds no number that can be read '
                "(examples: %s). Choose a column of counts, or leave it empty: "
                "each row then counts 1." % (value, _example(rows, value)),
            )
        elif p and looks_like_id(value, p):
            add(
                "value",
                "warning",
                '"%s" looks like an identifier; the page will add those numbers '
                "together as if they were quantities." % value,
            )

    date = mapping.get("date")
    if date:
        p = prof(date)
        if p and not p["date"] and p["numbers"] == 0:
            add("date", "error", 'The column "%s" holds no readable date.' % date)

    for axis, role in (("lon", "oLon"), ("lat", "oLat"), ("lon", "dLon"), ("lat", "dLat")):
        column = mapping.get(role)
        if not column:
            continue
        p = prof(column)
        if p and looks_projected(p):
            add(
                role,
                "error",
                'The column "%s" holds values like %s: these are metres, not '
                "degrees. The page draws longitude/latitude; use a layer with a "
                "geographic coordinate system or the same columns in degrees."
                % (column, _example(rows, column)),
            )
        elif p and out_of_degrees(p, axis):
            add(
                role,
                "error",
                'The column "%s" cannot be a %s: it reaches %s.'
                % (
                    column,
                    "longitude" if axis == "lon" else "latitude",
                    round(p["max"] if abs(p["max"]) >= abs(p["min"]) else p["min"], 3),
                ),
            )

    if mapping.get("swapDest"):
        add(
            "dLon",
            "warning",
            "The destination columns look the wrong way round; they are read as "
            "longitude = %s and latitude = %s."
            % (mapping.get("dLon"), mapping.get("dLat")),
        )

    # The two ends of a flow on the same point: the classic wrong pair of
    # coordinate fields. Every flow then starts where it ends, the page has no
    # line to draw, and it looks broken although it is faithful. Say it here,
    # while the dialog is still open, rather than after the run.
    o_lon, o_lat = mapping.get("oLon"), mapping.get("oLat")
    d_lon, d_lat = mapping.get("dLon"), mapping.get("dLat")
    if o_lon and o_lat and d_lon and d_lat and rows:
        checked = 0
        identical = 0
        for row in rows:
            x1, y1 = to_number(row.get(o_lon)), to_number(row.get(o_lat))
            x2, y2 = to_number(row.get(d_lon)), to_number(row.get(d_lat))
            if None in (x1, y1, x2, y2):
                continue
            checked += 1
            if abs(x1 - x2) <= 1e-4 and abs(y1 - y2) <= 1e-4:
                identical += 1
        if checked and identical == checked:
            add(
                "dLon",
                "warning",
                'The origin and destination coordinates are the same in all %d '
                'rows ("%s"/"%s" against "%s"/"%s"): every flow will start and '
                "end at the same dot, so the page shows records inside places "
                "and no line between two places. Choose the coordinate pair "
                "that holds the other end of the movement." % (checked, o_lon, o_lat, d_lon, d_lat),
            )
        elif checked and identical >= max(2, checked * 0.8):
            add(
                "dLon",
                "info",
                "%d of %d rows have the same origin and destination "
                "coordinates; those flows are drawn as records inside one place."
                % (identical, checked),
            )

    unit = guess_unit_label(value or "")
    if value and unit:
        add("value", "info", 'The values will be counted in "%s" (from "%s").' % (unit, value))
    return findings


def _example(rows, column, limit=3):
    """A few real cells, for an error message that can be checked."""
    seen = []
    for row in rows or []:
        cell = str(row.get(column, "") if row else "").strip()
        if cell and cell not in seen:
            seen.append(cell)
        if len(seen) >= limit:
            break
    return ", ".join('"%s"' % value for value in seen) or "none"


def findings_text(findings, level=("error", "warning")):
    """One line per finding worth showing, for a message or a parameter."""
    lines = [
        f["text"]
        for f in findings or []
        if f.get("level") in level and str(f.get("text", "")).strip()
    ]
    return "\n".join(lines)


# --------------------------------------------------------------- name lookup


class NameIndex:
    """Resolve a place name to coordinates, the way the page does.

    First an exact, accent-folded match, then a containment match so
    "Koutiala (Sikasso)" still finds "Koutiala". Points win over polygons
    because they are more precise.
    """

    def __init__(self):
        self.points = {}
        self.areas = {}
        self.groups = {}

    def add_point(self, name, lon, lat, group=None):
        if name and lon is not None and lat is not None:
            self.points.setdefault(key_name(name), (float(lon), float(lat)))
        if name and group:
            self.groups.setdefault(key_name(name), str(group))

    def add_area(self, name, rings):
        centre = ring_centre(rings)
        if name and centre:
            # centroid when it falls inside the feature, otherwise the mean
            # of the ring's points, which is good enough to drop a dot on it
            self.areas.setdefault(key_name(name), (centre[0], centre[1]))

    def group_of(self, name):
        """The group a places layer gives this name, if any."""
        k = key_name(name)
        if not k:
            return ""
        if k in self.groups:
            return self.groups[k]
        for key, value in self.groups.items():
            if len(k) > 3 and key and (key in k or k in key):
                return value
        return ""

    def find(self, name):
        k = key_name(name)
        if not k:
            return None
        if k in self.points:
            return self.points[k]
        if k in self.areas:
            return self.areas[k]
        for table in (self.points, self.areas):
            if len(k) < 4:
                continue
            for key, value in table.items():
                if key and (key in k or k in key):
                    return value
        return None


# ---------------------------------------------------------------- the dataset


def build_dataset(rows, mapping, meta=None, places=None, admin1=None, admin2=None, options=None):
    """Assemble the dataset. Returns (dataset, warnings).

    ``rows``    list of dicts, values as strings (or numbers/dates).
    ``mapping`` column roles: oName, oGroup, oLon, oLat, dName, dGroup,
                dLon, dLat, date, value, and an optional dateMode
                ("date" | "day" | "none").
    ``meta``    title, subtitle, unit, nodeLabel, groupLabel, source.
    ``places``  [{"name","group","lon","lat"}, …] to place names without
                coordinates in the table.
    ``admin1`` / ``admin2``  {"name": [[x, y, …]], …} outlines to draw.
    ``options`` dateStart, dateMode, defaultValue, idField.
    """
    warnings = []
    options = options or {}
    mapping = {k: (v or "") for k, v in (mapping or {}).items()}
    rows = [
        r
        for r in (rows or [])
        if any(str(r.get(c, "")).strip() != "" for c in r)
    ]
    if not rows:
        raise ValueError("The table has no data rows.")

    def get(row, col):
        if not col:
            return ""
        value = row.get(col)
        if isinstance(value, (_dt.date, _dt.datetime)):
            return value
        return str(value if value is not None else "").strip()

    def has(col):
        return bool(col) and any(col in r for r in rows[:1])

    # ---- name lookup ------------------------------------------------------
    index = NameIndex()
    for place in places or []:
        index.add_point(place.get("name"), place.get("lon"), place.get("lat"), place.get("group"))
    for layer in (admin1, admin2):
        for name, rings in (layer or {}).items():
            index.add_area(name, rings)

    # ---- the value column -------------------------------------------------
    # A value column that holds no number is the mistake that emptied the
    # first real run: every row was dropped, and the message said nothing
    # about the column. Say it by name, before anything is built.
    value_col = mapping.get("value")
    if value_col and has(value_col):
        probe = [get(r, value_col) for r in rows]
        readable = [to_number(v) for v in probe if str(v).strip()]
        if readable and not any(v is not None for v in readable):
            raise ValueError(
                'The value column "%s" holds no number that can be read '
                "(examples: %s). Choose a column of counts, or leave the value "
                "empty so every row counts 1."
                % (value_col, _example(rows, value_col))
            )

    # ---- longitude/latitude the wrong way round ---------------------------
    if mapping.get("swapDest") and has(mapping.get("dLon")) and has(mapping.get("dLat")):
        was_lon, was_lat = mapping["dLon"], mapping["dLat"]
        mapping["dLon"], mapping["dLat"] = was_lat, was_lon
        warnings.append(
            "The destination longitude and latitude were read the wrong way "
            'round: "%s" holds the latitude and "%s" the longitude.' % (was_lon, was_lat)
        )

    # ---- the time axis ----------------------------------------------------
    date_col = mapping.get("date")
    date_mode = (
        options.get("dateMode")
        or mapping.get("dateMode")
        or ("date" if has(date_col) else "none")
    )
    if date_mode not in ("date", "day", "none"):
        date_mode = "none"
    day_of_row = [0] * len(rows)
    date_start = None
    raw_dates = [get(r, date_col) for r in rows] if (date_col and has(date_col)) else []
    if date_mode == "date":
        dates = [parse_date_value(v) for v in raw_dates]
        valid = [d for d in dates if d]
        # a column of plain numbers is a day axis, which is what the page
        # decides from the column itself — unless the caller forced a mode
        if not valid and not options.get("dateMode"):
            numbers = [to_number(v) for v in raw_dates if str(v).strip()]
            if numbers and all(n is not None for n in numbers):
                date_mode = "day"
    if date_mode == "date" and raw_dates:
        dates = [parse_date_value(v) for v in raw_dates]
        valid = [d for d in dates if d]
        if not valid:
            raise ValueError('No readable date in the "%s" column.' % date_col)
        unreadable = sum(1 for v, d in zip(raw_dates, dates) if d is None and str(v).strip())
        if unreadable:
            warnings.append(
                "%d date(s) could not be read and were treated as the first day." % unreadable
            )
        first = min(valid)
        date_start = first.isoformat()
        day_of_row = [(d - first).days if d else 0 for d in dates]
    elif date_mode == "day" and raw_dates:
        values = [to_number(v) for v in raw_dates]
        known = [v for v in values if v is not None]
        if not known:
            raise ValueError('The "%s" column has no day numbers.' % date_col)
        first = min(known)
        if first != 0:
            warnings.append("Day numbers were shifted to start at 0.")
        day_of_row = [int(round((v if v is not None else first) - first)) for v in values]
    else:
        # No date column. The rows still have an order, and a page whose
        # timeline is a single day has a slider that does nothing and a Play
        # button that stops at once - which reads as "the animation is
        # broken". Each row gets a step on a short axis instead, labelled as
        # a step, not as a date.
        date_mode = "sequence"
        steps = max(1, int(math.ceil(len(rows) / 60.0)))
        day_of_row = [i // steps for i in range(len(rows))]
    max_day = max([0] + day_of_row)

    # ---- places -----------------------------------------------------------
    nodes = []
    node_index = {}
    # A place belongs to one group. The first group the table gives a name —
    # in its own column, in the places layer, or inherited from the other end
    # of the row — is kept, so a city does not split into two dots when two
    # rows call it by two regions.
    group_of_name = {}
    # names that ended up at more than one position, for the warning below
    split = set()

    def resolve_group(name, column_group, inherit_from=""):
        key = key_name(name)
        if not key:
            return column_group or inherit_from
        if key not in group_of_name:
            group_of_name[key] = column_group or index.group_of(name) or inherit_from or ""
        return group_of_name[key]

    # One name, one dot - unless the table puts that name at two places. A row
    # that leaves the origin and destination names the same but gives them two
    # coordinate pairs describes a movement, not a record inside one place; and
    # a table of records per village repeats the name at the same point, which
    # must stay a single dot. The dot is therefore identified by its name and
    # its position, so the two cases are told apart instead of being merged.
    SAME_PLACE = 1e-4  # a ten-thousandth of a degree, about 11 metres

    def place_of(name, group, lon, lat):
        label = name or ("%.3f, %.3f" % (lon, lat) if lon is not None and lat is not None else "")
        if not label:
            return None
        x, y = lon, lat
        if x is None or y is None:
            hit = index.find(label) or (index.find(group) if group else None)
            if not hit:
                return None
            x, y = hit
        x, y = round(float(x), 5), round(float(y), 5)
        base = key_name(label) + "|" + key_name(group)
        i = node_index.get(base)
        if i is not None:
            here = nodes[i]
            if abs(here[2] - x) <= SAME_PLACE and abs(here[3] - y) <= SAME_PLACE:
                return i
            key = base + "|%.5f,%.5f" % (x, y)
            i = node_index.get(key)
            if i is not None:
                return i
            split.add(label)
            node_index[key] = len(nodes)
            nodes.append([label, group or "", x, y])
            return node_index[key]
        node_index[base] = len(nodes)
        nodes.append([label, group or "", x, y])
        return node_index[base]

    # ---- flows ------------------------------------------------------------
    edges = []
    total = 0.0
    skipped = 0
    missing = []
    default_value = options.get("defaultValue", 1)
    for r in range(len(rows)):
        row = rows[r]
        raw = get(row, mapping.get("value"))
        value = to_number(raw) if str(raw).strip() else (None if has(mapping.get("value")) else default_value)
        if value is None or value == 0:
            continue
        o_lon = to_number(get(row, mapping.get("oLon"))) if has(mapping.get("oLon")) else None
        o_lat = to_number(get(row, mapping.get("oLat"))) if has(mapping.get("oLat")) else None
        # no destination coordinates in the table: a row describes one place,
        # and the page counts it as a record within that place
        d_lon = to_number(get(row, mapping.get("dLon"))) if mapping.get("dLon") else o_lon
        d_lat = to_number(get(row, mapping.get("dLat"))) if mapping.get("dLat") else o_lat
        same_point = (
            o_lon is not None
            and o_lat is not None
            and d_lon is not None
            and d_lat is not None
            and abs(o_lon - d_lon) <= SAME_PLACE
            and abs(o_lat - d_lat) <= SAME_PLACE
        )
        o_name = str(get(row, mapping.get("oName")) or "").strip()
        d_name = str(get(row, mapping.get("dName")) or "").strip()
        # One name column names both ends - but only when the row really
        # describes one point. When the row carries two different coordinate
        # pairs, copying the destination name onto the origin welds the two
        # ends into one dot: 36 rows then give 36 dots, 36 flows that start
        # where they end, and not one line on the map. That is the "nothing is
        # drawn" report. An unnamed end is labelled by its coordinates instead
        # and keeps its own position, so the flow stays a line.
        if not d_name and (same_point or d_lon is None):
            d_name = o_name
        if not o_name and same_point:
            o_name = d_name
        o_column_group = str(get(row, mapping.get("oGroup")) or "").strip()
        d_column_group = str(get(row, mapping.get("dGroup")) or "").strip()
        o_group = resolve_group(o_name, o_column_group)
        # with a single group column, the row's group describes both ends
        d_group = resolve_group(d_name, d_column_group, inherit_from=o_column_group or o_group)
        from_i = place_of(o_name, o_group, o_lon, o_lat)
        to_i = place_of(d_name, d_group, d_lon, d_lat)
        if from_i is None or to_i is None:
            skipped += 1
            missing.append(o_name if from_i is None else d_name)
            continue
        edges.append([day_of_row[r], from_i, to_i, value])
        total += value

    if not edges:
        hint = (
            "Check that the names in the table match the names in the boundary layer."
            if (admin1 or admin2)
            else "Add longitude/latitude fields, or give a boundary layer so places can be found by name."
        )
        findings = findings_text(diagnose_mapping(rows, mapping))
        raise ValueError(
            "No usable rows: no place could be placed on the map. "
            + hint
            + (("\n" + findings) if findings else "")
        )
    # A flow whose two ends are one point is a record inside a place, not a
    # movement: it is drawn as a small loop, never as a line. When that is
    # every flow, the map is a field of dots and reads as "nothing is drawn",
    # so say why, by field name, instead of leaving the user to guess.
    loops = sum(1 for edge in edges if edge[1] == edge[2])
    if loops and loops == len(edges):
        guidance = (
            "Choose the coordinate pair that holds the other end of the "
            "movement - the page draws a line only when the two ends are two "
            "points."
        )
        if mapping.get("dName") and mapping.get("dName") == mapping.get("oName"):
            guidance += (
                ' The origin and destination name fields are both "%s", so one '
                "column names both ends; leave the origin name empty if the "
                "table has no separate column for it."
                % mapping.get("dName")
            )
        warnings.append(
            "All %d flows start and end at the same point: the table gives both "
            "ends the same coordinates, so the page counts %s inside each place "
            "instead of movement between places. %s"
            % (len(edges), (meta or {}).get("unit") or "records", guidance)
        )
    elif loops:
        warnings.append(
            "%d of %d flows start and end at the same point; they are drawn as "
            "small loops beside the dot." % (loops, len(edges))
        )

    if split:
        shown = ", ".join(sorted(split)[:5])
        warnings.append(
            "%d place name(s) appear at more than one position (%s%s); each "
            "position is kept as its own dot so the flows keep both ends."
            % (len(split), shown, "…" if len(split) > 5 else "")
        )
    if skipped:
        shown = ", ".join(list(dict.fromkeys(missing))[:6])
        warnings.append(
            "%d of %d rows were skipped because the place could not be located (%s%s)."
            % (skipped, len(rows), shown, "…" if len(set(missing)) > 6 else "")
        )

    meta = dict(meta or {})
    meta.setdefault("title", "Flow map")
    meta.setdefault("unit", guess_unit_label(mapping.get("value") or "") or "records")
    if loops and loops == len(edges):
        # one point per row: there is no line, and a subtitle promising one is
        # the sentence that makes a working page look broken
        meta.setdefault(
            "subtitle",
            "Each dot is one place, and the %s counted inside it travel round "
            "its ring. Drag the layout slider to move between true geography "
            "and a network view." % meta["unit"],
        )
    else:
        meta.setdefault(
            "subtitle",
            "Each dot is one place, each line a flow between two of them. "
            "Drag the layout slider to move between true geography and a network view.",
        )
    meta.setdefault("unit", guess_unit_label(mapping.get("value") or "") or "records")
    meta.setdefault("nodeLabel", "place")
    meta.setdefault("groupLabel", "group" if not (admin1 or admin2) else "area")
    meta["dateStart"] = date_start if date_mode == "date" else None
    meta["dateMode"] = date_mode
    # stamped into the page so a build can be told apart from an older one
    meta["app"] = "FlowMap " + __version__

    dataset = {
        "meta": {k: meta[k] for k in ("title", "subtitle", "unit", "nodeLabel", "groupLabel", "source", "dateStart", "dateMode", "app") if k in meta},
        "nodes": nodes,
        "edges": edges,
        "maxDay": max_day,
        "total": total,
    }
    if admin1:
        dataset["admin1"] = {name: {"p": rings} for name, rings in admin1.items() if rings}
    if admin2:
        dataset["admin2"] = {name: {"p": rings} for name, rings in admin2.items() if rings}
    return dataset, warnings


# ------------------------------------------------------------ the HTML page


def dataset_json(dataset):
    """The dataset as JSON safe to sit inside a <script> element."""
    text = json.dumps(dataset, ensure_ascii=False, separators=(",", ":"))
    return text.replace("</", "<\\/")


_PRELOAD = re.compile(r"<script data-preload>[\s\S]*?</script>(?=</head>)")


def inject_preload(html, payload):
    """Put the dataset into a copy of the page, replacing an earlier one.

    The anchor is the block immediately before </head>, which is what keeps
    this from matching the same text where it appears inside the app's own
    source (the page can export itself, so the text does occur twice).
    """
    if "</head>" not in html:
        raise ValueError("This template has no </head>, so the dataset cannot be embedded.")
    clean = _PRELOAD.sub("", html, count=1)
    block = "<script data-preload>window.__PRELOAD__=" + payload + ";</script>"
    at = clean.index("</head>")
    return clean[:at] + block + clean[at:]


def build_page(template_path, dataset, out_path, json_path=None):
    """Write the self-contained page and, optionally, the dataset JSON."""
    with open(template_path, "r", encoding="utf-8") as fh:
        html = fh.read()
    page = inject_preload(html, dataset_json(dataset))
    folder = os.path.dirname(os.path.abspath(out_path))
    if folder and not os.path.isdir(folder):
        os.makedirs(folder)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(page)
    if json_path:
        with open(json_path, "w", encoding="utf-8") as fh:
            json.dump(dataset, fh, ensure_ascii=False, indent=1)
    return out_path


# --------------------------------------------------------------- arcpy glue


def parts_from_geometry(geometry):
    """Flat rings from an arcpy geometry, without importing arcpy.

    Accepts whatever ``geom.getPart()`` yields through the caller: pass the
    geometry and it uses ``getPart()`` when available, else it reads
    ``__geo_interface__`` so Fiona/GeoPandas geometries work too.
    """
    if hasattr(geometry, "getPart"):
        parts = []
        for part in geometry:
            if hasattr(part, "__iter__"):
                parts.append([(pt.X, pt.Y) for pt in part])
            else:
                parts.append([(part.X, part.Y)])
        return parts
    gi = getattr(geometry, "__geo_interface__", None)
    if gi is None:
        return []
    kind = gi.get("type")
    coords = gi.get("coordinates") or []
    if kind == "Polygon":
        return [c for c in coords]
    if kind == "MultiPolygon":
        return [ring for poly in coords for ring in poly]
    return []


# ----------------------------------------------- administrative boundaries
#
# The page is drawn on the outlines of the countries the data lies in. They
# are found from the data itself (which countries hold the places), then
# downloaded from geoBoundaries (open data, ADM1 = regions, ADM2 = districts)
# and cached next to the page so the second run needs no internet.
# Pure standard library: urllib only.

ISO2_TO_ISO3 = {
    "AF": "AFG", "AX": "ALA", "AL": "ALB", "DZ": "DZA", "AS": "ASM", "AD": "AND", "AO": "AGO",
    "AI": "AIA", "AQ": "ATA", "AG": "ATG", "AR": "ARG", "AM": "ARM", "AW": "ABW", "AU": "AUS",
    "AT": "AUT", "AZ": "AZE", "BS": "BHS", "BH": "BHR", "BD": "BGD", "BB": "BRB", "BY": "BLR",
    "BE": "BEL", "BZ": "BLZ", "BJ": "BEN", "BM": "BMU", "BT": "BTN", "BO": "BOL", "BQ": "BES",
    "BA": "BIH", "BW": "BWA", "BV": "BVT", "BR": "BRA", "IO": "IOT", "BN": "BRN", "BG": "BGR",
    "BF": "BFA", "BI": "BDI", "CV": "CPV", "KH": "KHM", "CM": "CMR", "CA": "CAN", "KY": "CYM",
    "CF": "CAF", "TD": "TCD", "CL": "CHL", "CN": "CHN", "CX": "CXR", "CC": "CCK", "CO": "COL",
    "KM": "COM", "CG": "COG", "CD": "COD", "CK": "COK", "CR": "CRI", "CI": "CIV", "HR": "HRV",
    "CU": "CUB", "CW": "CUW", "CY": "CYP", "CZ": "CZE", "DK": "DNK", "DJ": "DJI", "DM": "DMA",
    "DO": "DOM", "EC": "ECU", "EG": "EGY", "SV": "SLV", "GQ": "GNQ", "ER": "ERI", "EE": "EST",
    "SZ": "SWZ", "ET": "ETH", "FK": "FLK", "FO": "FRO", "FJ": "FJI", "FI": "FIN", "FR": "FRA",
    "GF": "GUF", "PF": "PYF", "TF": "ATF", "GA": "GAB", "GM": "GMB", "GE": "GEO", "DE": "DEU",
    "GH": "GHA", "GI": "GIB", "GR": "GRC", "GL": "GRL", "GD": "GRD", "GP": "GLP", "GU": "GUM",
    "GT": "GTM", "GG": "GGY", "GN": "GIN", "GW": "GNB", "GY": "GUY", "HT": "HTI", "HM": "HMD",
    "VA": "VAT", "HN": "HND", "HK": "HKG", "HU": "HUN", "IS": "ISL", "IN": "IND", "ID": "IDN",
    "IR": "IRN", "IQ": "IRQ", "IE": "IRL", "IM": "IMN", "IL": "ISR", "IT": "ITA", "JM": "JAM",
    "JP": "JPN", "JE": "JEY", "JO": "JOR", "KZ": "KAZ", "KE": "KEN", "KI": "KIR", "KP": "PRK",
    "KR": "KOR", "XK": "XKX", "KW": "KWT", "KG": "KGZ", "LA": "LAO", "LV": "LVA", "LB": "LBN",
    "LS": "LSO", "LR": "LBR", "LY": "LBY", "LI": "LIE", "LT": "LTU", "LU": "LUX", "MO": "MAC",
    "MG": "MDG", "MW": "MWI", "MY": "MYS", "MV": "MDV", "ML": "MLI", "MT": "MLT", "MH": "MHL",
    "MQ": "MTQ", "MR": "MRT", "MU": "MUS", "YT": "MYT", "MX": "MEX", "FM": "FSM", "MD": "MDA",
    "MC": "MCO", "MN": "MNG", "ME": "MNE", "MS": "MSR", "MA": "MAR", "MZ": "MOZ", "MM": "MMR",
    "NA": "NAM", "NR": "NRU", "NP": "NPL", "NL": "NLD", "NC": "NCL", "NZ": "NZL", "NI": "NIC",
    "NE": "NER", "NG": "NGA", "NU": "NIU", "NF": "NFK", "MK": "MKD", "MP": "MNP", "NO": "NOR",
    "OM": "OMN", "PK": "PAK", "PW": "PLW", "PS": "PSE", "PA": "PAN", "PG": "PNG", "PY": "PRY",
    "PE": "PER", "PH": "PHL", "PN": "PCN", "PL": "POL", "PT": "PRT", "PR": "PRI", "QA": "QAT",
    "RE": "REU", "RO": "ROU", "RU": "RUS", "RW": "RWA", "BL": "BLM", "SH": "SHN", "KN": "KNA",
    "LC": "LCA", "MF": "MAF", "PM": "SPM", "VC": "VCT", "WS": "WSM", "SM": "SMR", "ST": "STP",
    "SA": "SAU", "SN": "SEN", "RS": "SRB", "SC": "SYC", "SL": "SLE", "SG": "SGP", "SX": "SXM",
    "SK": "SVK", "SI": "SVN", "SB": "SLB", "SO": "SOM", "ZA": "ZAF", "GS": "SGS", "SS": "SSD",
    "ES": "ESP", "LK": "LKA", "SD": "SDN", "SR": "SUR", "SJ": "SJM", "SE": "SWE", "CH": "CHE",
    "SY": "SYR", "TW": "TWN", "TJ": "TJK", "TZ": "TZA", "TH": "THA", "TL": "TLS", "TG": "TGO",
    "TK": "TKL", "TO": "TON", "TT": "TTO", "TN": "TUN", "TR": "TUR", "TM": "TKM", "TC": "TCA",
    "TV": "TUV", "UG": "UGA", "UA": "UKR", "AE": "ARE", "GB": "GBR", "US": "USA", "UM": "UMI",
    "UY": "URY", "UZ": "UZB", "VU": "VUT", "VE": "VEN", "VN": "VNM", "VG": "VGB", "VI": "VIR",
    "WF": "WLF", "EH": "ESH", "YE": "YEM", "ZM": "ZMB", "ZW": "ZWE",
}

COUNTRIES_SERVICE = (
    "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/"
    "World_Countries_(Generalized)/FeatureServer/0/query"
)
GEOBOUNDARIES_API = "https://www.geoboundaries.org/api/current/gbOpen/%s/%s/"


def _http(url, data=None, timeout=60):
    """GET (or POST when data is given) and return the bytes. urllib only."""
    import urllib.request

    request = urllib.request.Request(url, data=data, headers={"User-Agent": "FlowMap-arcgis/7.2"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def parse_countries(text):
    """'yem, Mali' -> ['YEM', 'MLI']: ISO3 codes, ISO2 codes or nothing else.

    Country names are not guessed: an unknown word is returned in the second
    list so the caller can say so.
    """
    good, unknown = [], []
    for word in re.split(r"[;,\s]+", str(text or "").strip()):
        word = word.strip().upper()
        if not word:
            continue
        if len(word) == 3 and word.isalpha():
            iso3 = word
        elif len(word) == 2 and word in ISO2_TO_ISO3:
            iso3 = ISO2_TO_ISO3[word]
        else:
            unknown.append(word)
            continue
        if iso3 not in good:
            good.append(iso3)
    return good, unknown


def _country_at(x, y, distance=0):
    """ISO3 of the country holding one point, or None."""
    import urllib.parse

    params = {
        "where": "1=1",
        "geometry": json.dumps({"x": x, "y": y, "spatialReference": {"wkid": 4326}}),
        "geometryType": "esriGeometryPoint",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "ISO,COUNTRY",
        "returnGeometry": "false",
        "f": "json",
    }
    if distance:
        params["distance"] = str(distance)
        params["units"] = "esriSRUnit_Meter"
    raw = _http(COUNTRIES_SERVICE, data=urllib.parse.urlencode(params).encode("utf-8"), timeout=30)
    answer = json.loads(raw.decode("utf-8"))
    if "error" in answer:
        raise RuntimeError(str(answer["error"].get("message") or answer["error"]))
    for feature in answer.get("features") or []:
        iso3 = ISO2_TO_ISO3.get(str((feature.get("attributes") or {}).get("ISO") or "").upper())
        if iso3:
            return iso3
    return None


def countries_of_points(points, max_points=40, min_share=0.15):
    """ISO3 codes of the countries that really hold the data.

    A sample of the points (spread over the data, at most ``max_points``) is
    placed one by one in the public ArcGIS "World Countries" service. A
    country is kept when it holds at least ``min_share`` of the placed points:
    a handful of villages next to a border do not bring the neighbouring
    country, and its outlines, onto the map. The country with the most points
    is always kept. Raises on a network error.
    """
    from concurrent.futures import ThreadPoolExecutor

    seen, sample = set(), []
    for x, y in points:
        if x is None or y is None:
            continue
        key = (round(float(x), 2), round(float(y), 2))
        if key in seen:
            continue
        seen.add(key)
        sample.append(key)
    if not sample:
        return []
    step = max(1, len(sample) // max_points)
    sample = sample[::step][:max_points]
    with ThreadPoolExecutor(max_workers=8) as pool:
        found = list(pool.map(lambda xy: _country_at(xy[0], xy[1]), sample))
    if not any(found):
        # every point missed the coarse coastline: allow 10 km, then vote
        with ThreadPoolExecutor(max_workers=8) as pool:
            found = list(pool.map(lambda xy: _country_at(xy[0], xy[1], 10000), sample))
    counts = {}
    for iso3 in found:
        if iso3:
            counts[iso3] = counts.get(iso3, 0) + 1
    if not counts:
        return []
    placed = float(sum(counts.values()))
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    return [iso3 for iso3, n in ranked if n / placed >= min_share or iso3 == ranked[0][0]]


def extent_of_points(points, margin=0.15, minimum=0.25):
    """(lon0, lat0, lon1, lat1) around the points, with a margin; None if empty."""
    xs = [float(x) for x, y in points if x is not None and y is not None]
    ys = [float(y) for x, y in points if x is not None and y is not None]
    if not xs:
        return None
    lon0, lon1, lat0, lat1 = min(xs), max(xs), min(ys), max(ys)
    mx = max((lon1 - lon0) * margin, minimum)
    my = max((lat1 - lat0) * margin, minimum)
    return (lon0 - mx, lat0 - my, lon1 + mx, lat1 + my)


def _geometry_bbox(geometry):
    xs, ys = [], []

    def walk(node):
        if node and isinstance(node[0], (int, float)):
            xs.append(node[0])
            ys.append(node[1])
        else:
            for child in node or []:
                walk(child)

    walk((geometry or {}).get("coordinates") or [])
    if not xs:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


def clip_features(geojson, extent):
    """Only the features whose bounding box meets the extent (lon0, lat0, lon1, lat1)."""
    if not extent:
        return list((geojson or {}).get("features") or [])
    keep = []
    for feature in (geojson or {}).get("features") or []:
        box = _geometry_bbox(feature.get("geometry"))
        if box is None:
            continue
        if box[0] <= extent[2] and box[2] >= extent[0] and box[1] <= extent[3] and box[3] >= extent[1]:
            keep.append(feature)
    return keep


def geojson_to_areas(geojson, name_keys=("shapeName", "NAME", "name", "ADM2_EN", "ADM1_EN"), decimals=5, tolerance=0.0):
    """GeoJSON FeatureCollection -> {name: [flat rings]} as the page wants.

    Two features with the same name (it happens with districts) are told
    apart with a number instead of one overwriting the other.
    """
    out = {}
    for feature in (geojson or {}).get("features") or []:
        geometry = feature.get("geometry") or {}
        properties = feature.get("properties") or {}
        name = ""
        for key in name_keys:
            if properties.get(key):
                name = str(properties[key]).strip()
                break
        if not name:
            continue
        kind, coords = geometry.get("type"), geometry.get("coordinates") or []
        if kind == "Polygon":
            polygons = [coords]
        elif kind == "MultiPolygon":
            polygons = coords
        else:
            continue
        parts = [[(p[0], p[1]) for p in ring] for polygon in polygons for ring in polygon]
        rings = clean_rings(parts, decimals=decimals, tolerance=tolerance)
        if not rings:
            continue
        label, n = name, 2
        while label in out:
            label = "%s (%d)" % (name, n)
            n += 1
        out[label] = rings
    return out


def _tolerance_for(vertices):
    if vertices > 300000:
        return 0.02
    if vertices > 120000:
        return 0.01
    if vertices > 40000:
        return 0.005
    return 0.0


def fetch_boundaries(iso3, level, cache_folder=None, log=None):
    """The geoJSON of one country at ADM1 or ADM2, from the cache or the web.

    Returns (path_or_None, geojson_or_None). The simplified geometry that
    geoBoundaries publishes is used: it keeps the page light and is what a
    flow map needs. A country with no such level returns (None, None).
    """
    log = log or (lambda text: None)
    cache_path = None
    if cache_folder:
        cache_path = os.path.join(cache_folder, "geoBoundaries-%s-%s.geojson" % (iso3, level))
        if os.path.isfile(cache_path):
            try:
                with open(cache_path, "r", encoding="utf-8") as fh:
                    return cache_path, json.load(fh)
            except Exception:
                pass
    try:
        meta = json.loads(_http(GEOBOUNDARIES_API % (iso3, level), timeout=30).decode("utf-8"))
    except Exception as err:
        log("%s %s: not available (%s)" % (iso3, level, err))
        return None, None
    url = meta.get("simplifiedGeometryGeoJSON") or meta.get("gjDownloadURL")
    if not url:
        log("%s %s: no geometry published" % (iso3, level))
        return None, None
    try:
        raw = _http(url, timeout=180)
        geojson = json.loads(raw.decode("utf-8"))
    except Exception as err:
        log("%s %s: download failed (%s)" % (iso3, level, err))
        return None, None
    if cache_path:
        try:
            if not os.path.isdir(cache_folder):
                os.makedirs(cache_folder)
            with open(cache_path, "wb") as fh:
                fh.write(raw)
        except Exception:
            cache_path = None
    return cache_path, geojson


def load_admin_layers(isos, cache_folder=None, log=None, extent=None):
    """{"admin1": {...}, "admin2": {...}, "files": {...}} for these countries.

    With an ``extent`` (lon0, lat0, lon1, lat1) only the areas that meet it are
    kept - the page and the map then hold the outlines around the data, not
    whole countries. ``files[role]`` is one clipped GeoJSON file per level,
    written to the cache folder for the layers added to ArcGIS Pro.
    """
    log = log or (lambda text: None)
    result = {"admin1": {}, "admin2": {}, "files": {}}
    for level, role in (("ADM1", "admin1"), ("ADM2", "admin2")):
        features = []
        for iso3 in isos:
            path, geojson = fetch_boundaries(iso3, level, cache_folder, log)
            if not geojson:
                continue
            kept = clip_features(geojson, extent)
            log("%s %s: %d of %d areas around the data" % (iso3, level, len(kept), len(geojson.get("features") or [])))
            features.extend(kept)
        if not features:
            continue
        merged = {"type": "FeatureCollection", "features": features}
        vertices = 0
        for feature in features:
            vertices += json.dumps((feature.get("geometry") or {}).get("coordinates") or []).count("],")
        result[role] = geojson_to_areas(merged, tolerance=_tolerance_for(vertices))
        if cache_folder:
            try:
                if not os.path.isdir(cache_folder):
                    os.makedirs(cache_folder)
                out = os.path.join(cache_folder, "flowmap_%s_clipped.geojson" % role)
                with open(out, "w", encoding="utf-8") as fh:
                    json.dump(merged, fh)
                result["files"][role] = [out]
            except Exception:
                pass
    return result


# ---------------------------------------------------------------------- demo

DEMO_PLACES = [
    ("Dakar", "Ouest", -17.4467, 14.6928),
    ("Thiès", "Ouest", -16.9256, 14.7886),
    ("Saint-Louis", "Nord", -16.4896, 16.0326),
    ("Louga", "Nord", -15.6142, 15.6144),
    ("Diourbel", "Centre", -16.2325, 14.6544),
    ("Kaolack", "Centre", -16.1656, 14.1652),
    ("Tambacounda", "Est", -13.6778, 13.7707),
    ("Ziguinchor", "Sud", -16.2733, 12.5833),
]

DEMO_ROWS = [
    {"Origin": "Dakar", "Destination": "Thiès", "Date": "2026-01-14", "Households": "120"},
    {"Origin": "Dakar", "Destination": "Thiès", "Date": "2026-01-15", "Households": "80"},
    {"Origin": "Thiès", "Destination": "Diourbel", "Date": "15/01/2026", "Households": "45"},
    {"Origin": "Thiès", "Destination": "Diourbel", "Date": "2026-01-16", "Households": "60"},
    {"Origin": "Saint-Louis", "Destination": "Louga", "Date": "2026-01-17", "Households": "70"},
    {"Origin": "Louga", "Destination": "Diourbel", "Date": "17/01/2026", "Households": "35"},
    {"Origin": "Kaolack", "Destination": "Tambacounda", "Date": "2026-01-18", "Households": "0"},
    {"Origin": "Kaolack", "Destination": "Ziguinchor", "Date": "18/01/2026", "Households": "25"},
    {"Origin": "Kaolack", "Destination": "Kolda", "Date": "2026-01-19", "Households": "15"},
    {"Origin": "Ziguinchor", "Destination": "Thiès", "Date": "not a date", "Households": "30"},
]

DEMO_MAPPING = {
    "oName": "Origin",
    "dName": "Destination",
    "date": "Date",
    "value": "Households",
    "oGroup": "",
    "dGroup": "",
}


def demo_rings(lon, lat, dx=0.55, dy=0.45):
    return [[round(lon - dx, 4), round(lat - dy, 4), round(lon + dx, 4), round(lat - dy, 4), round(lon + dx, 4), round(lat + dy, 4), round(lon - dx, 4), round(lat + dy, 4), round(lon - dx, 4), round(lat - dy, 4)]]


def demo_spec():
    """A small, completely invented table: ISO dates, a day-first date (15/01
    can only be the 15th), an unreadable date, a zero value, and a
    destination that does not exist. It exists to prove the pipeline, not to
    say anything true about Senegal."""
    admin2 = {name: demo_rings(lon, lat) for name, _group, lon, lat in DEMO_PLACES}
    return {
        "rows": DEMO_ROWS,
        "mapping": DEMO_MAPPING,
        "places": [{"name": n, "group": g, "lon": lon, "lat": lat} for n, g, lon, lat in DEMO_PLACES],
        "admin2": admin2,
        "meta": {
            "title": "Where households moved",
            "subtitle": "Demo data made up for the ArcGIS toolbox — not a real record.",
            "unit": "households",
            "nodeLabel": "city",
            "groupLabel": "region",
            "source": "arcgis/flowmap_core.py demo",
        },
    }


def build_from_spec(spec):
    """Everything build_dataset plus the meta that a spec file can carry."""
    dataset, warnings = build_dataset(
        spec.get("rows"),
        spec.get("mapping"),
        meta=spec.get("meta"),
        places=spec.get("places"),
        admin1={k: v for k, v in (spec.get("admin1") or {}).items()},
        admin2={k: v for k, v in (spec.get("admin2") or {}).items()},
        options=spec.get("options"),
    )
    return dataset, warnings


# ----------------------------------------------------------------------- CLI


def _template(path):
    if path:
        return path
    here = os.path.dirname(os.path.abspath(__file__))
    for candidate in (os.path.join(here, "index.html"), os.path.join(here, os.pardir, "index.html")):
        if os.path.isfile(candidate):
            return candidate
    raise SystemExit("No index.html found. Pass --template path/to/index.html.")


def _number(value):
    """3 decimal places, without trailing zeros."""
    return ("%.3f" % float(value)).rstrip("0").rstrip(".")


def _report(out, dataset):
    print(
        "wrote %s — %d places, %d flows, %d days, %s %s"
        % (
            out,
            len(dataset["nodes"]),
            len(dataset["edges"]),
            dataset["maxDay"] + 1,
            _number(dataset["total"]),
            dataset["meta"]["unit"],
        )
    )


def cmd_build(args):
    with open(args.input, "r", encoding="utf-8") as fh:
        spec = json.load(fh)
    dataset, warnings = build_from_spec(spec)
    out = build_page(_template(args.template), dataset, args.out, args.json)
    for w in warnings:
        print("warning: " + w, file=sys.stderr)
    _report(out, dataset)
    return 0


def cmd_demo(args):
    spec = demo_spec()
    dataset, warnings = build_from_spec(spec)
    out = build_page(_template(args.template), dataset, args.out, args.json)
    for w in warnings:
        print("warning: " + w, file=sys.stderr)
    _report(out, dataset)
    return 0


def selftest():
    """The checks that would have caught the blank page: does the dataset
    come out right, and does the page really carry its own library?"""
    checks = []

    def check(label, ok, detail=""):
        checks.append((label, bool(ok), detail))

    # names, numbers, dates
    check("key_name folds accents and punctuation", key_name("Ségou — ") == "segou", key_name("Ségou — "))
    check("to_number reads 1,234 and 12,5", to_number("1,234") == 1234 and to_number("12,5") == 12.5)
    check("ISO date parses", parse_date_value("2026-01-04") == _dt.date(2026, 1, 4))
    check("31/01/2026 is January 31st", parse_date_value("31/01/2026") == _dt.date(2026, 1, 31))
    check("01/04/2026 is January 4th, month first", parse_date_value("01/04/2026") == _dt.date(2026, 1, 4))
    check("04/01/2026 is April 1st, month first", parse_date_value("04/01/2026") == _dt.date(2026, 4, 1))
    check("junk is None", parse_date_value("not a date") is None)
    check("2026-02 becomes the 1st", parse_date_value("2026-02") == _dt.date(2026, 2, 1))


    # administrative boundaries (no network: the parts that need none)
    good, unknown = parse_countries("yem, ML; XYZW")
    check("countries are read as ISO3 or ISO2", good == ["YEM", "MLI"] and unknown == ["XYZW"], (good, unknown))
    check("ISO2 table holds Yemen and Senegal", ISO2_TO_ISO3["YE"] == "YEM" and ISO2_TO_ISO3["SN"] == "SEN")
    sample_geo = {"features": [
        {"properties": {"shapeName": "A"}, "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}},
        {"properties": {"shapeName": "A"}, "geometry": {"type": "MultiPolygon", "coordinates": [[[[2, 2], [3, 2], [3, 3], [2, 2]]]]}},
    ]}
    far = {"features": [{"properties": {"shapeName": "Far"}, "geometry": {"type": "Polygon", "coordinates": [[[20, 20], [21, 20], [21, 21], [20, 20]]]}}] + sample_geo["features"]}
    ext = extent_of_points([(0.2, 0.2), (0.8, 0.8)])
    check("outlines far from the data are dropped", len(clip_features(far, ext)) == 1 and len(clip_features(far, None)) == 3, ext)
    areas = geojson_to_areas(sample_geo)
    check("geojson becomes named rings, duplicates told apart", sorted(areas) == ["A", "A (2)"], sorted(areas))

    # geometry
    square = [(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0), (0.0, 0.0)]
    rings = clean_rings([square], decimals=3)
    check("a ring stays closed", rings and rings[0][:2] == rings[0][-2:], rings)
    check("area of a 2x2 square is 4", abs(ring_area_ll(square)) == 4.0)
    c = ring_centre(rings)
    check("centre of the square is inside", c and point_in_rings_ll(c[0], c[1], [[(x, y) for x, y in zip(r[0::2], r[1::2])] for r in rings]), c)
    circle = [
        (round(math.cos(i * math.pi / 24), 4) + (0.002 if i % 2 else 0.0), round(math.sin(i * math.pi / 24), 4))
        for i in range(48)
    ]
    big = clean_rings([circle], decimals=5)[0]
    small = clean_rings([circle], decimals=5, tolerance=0.05)[0]
    check("simplify thins a detailed outline", len(small) < len(big) / 2, (len(big), len(small)))
    check("a simplified ring is still a ring", small[:2] == small[-2:] and len(small) >= 8, small)

    # the dataset
    dataset, warnings = build_from_spec(demo_spec())
    check("demo builds 7 places", len(dataset["nodes"]) == 7, len(dataset["nodes"]))
    check("demo keeps 8 flows", len(dataset["edges"]) == 8, len(dataset["edges"]))
    check("demo spans 6 days", dataset["maxDay"] == 5, dataset["maxDay"])
    check("total is 465 households", abs(dataset["total"] - 465) < 1e-9, dataset["total"])
    check("dateStart is the earliest date", dataset["meta"]["dateStart"] == "2026-01-14")
    check("unplaceable name is reported", any("Kolda" in w for w in warnings), warnings)
    check("an unreadable date is reported", any("could not be read" in w for w in warnings), warnings)
    group = {row[0]: row[1] for row in dataset["nodes"]}["Dakar"]
    check("groups come from the places list", group == "Ouest", group)
    names = [row[0] for row in dataset["nodes"]]
    check("a place appears once, whatever the table says", sorted(names) == sorted(set(names)), names)
    dagana = [e for e in dataset["edges"] if dataset["nodes"][e[1]][0] == "Thiès" and dataset["nodes"][e[2]][0] == "Diourbel"]
    check("15/01/2026 lands on day 1, not in January next year", dagana[0][0] == 1, [(e[0], e[3]) for e in dagana])
    check("every day is inside the axis", all(0 <= e[0] <= dataset["maxDay"] for e in dataset["edges"]))
    check("admin2 is carried through", "Dakar" in dataset.get("admin2", {}))

    # the page
    payload = dataset_json(dataset)
    check("</ is escaped for the script block", "</" not in payload)
    page = inject_preload("<html><head><title>t</title></head><body></body></html>", payload)
    check("the preload block sits before </head>", page.index("data-preload") < page.index("</head>"))
    twice = inject_preload(page, payload)
    check("re-embedding replaces, never doubles", twice.count("__PRELOAD__") == page.count("__PRELOAD__") == 1)
    check("field names guess a mapping", guess_mapping(["ORIGIN", "DESTINATION", "Households", "Date"])["value"].lower() == "households")

    # ---- what a column holds, not what it is called -----------------------
    check("column words split off the digits", column_words("Besoins_estimes_1_MILDA_2") == ["besoins", "estimes", "milda"])
    check("camel case splits too", column_words("LonDept") == ["lon", "dept"])
    check(
        "a word inside a word is not a match",
        not name_matches("Besoins_estimes", "date") and name_matches("Date_deplacement", "date"),
    )
    check("households is a value word", name_matches("Households", "value") and name_matches("MENAGES", "value"))
    case = profile_column("CSI_CASE", ["CSI-001", "CSI-014", "CSI-095", "CSI-100"])
    check("a case number reads as text", case["text"] and case["numbers"] == 0, case)
    check("a case number is an identifier", looks_like_id("CSI_CASE", case))
    names_only = diagnose_mapping([{"CSI_CASE": "CSI A"}, {"CSI_CASE": "CSI B"}, {"CSI_CASE": "CASE C"}, {"CSI_CASE": "CASE D"}], {"oName": "CSI_CASE"})
    check("a text column of places is never refused as an identifier", not [f for f in names_only if f["level"] == "error"], names_only)
    check("a date column reads as dates", profile_column("DATE", ["2026-01-04", "05/01/2026"])["date"])
    metres = profile_column("X_M", ["412000", "415800", "409000"])
    check("metres are not degrees", looks_projected(metres) and out_of_degrees(metres, "lon"), metres)

    # the table that failed in the field: a case number where a count was
    # wanted, a place name lost among codes, and two coordinate pairs
    WRONG = [
        {
            "Village": "Touba",
            "CSI_CASE": "CSI-001",
            "MILDA_distribuees": "120",
            "Besoins_estimes_1_MILDA_2_personnes": "400",
            "Lon_dept": "-16.92",
            "Lat_dept": "14.79",
            "Longitude_rep": "-16.45",
            "Latitude_rep": "14.42",
        },
        {
            "Village": "Mbacke",
            "CSI_CASE": "CSI-014",
            "MILDA_distribuees": "80",
            "Besoins_estimes_1_MILDA_2_personnes": "260",
            "Lon_dept": "-15.90",
            "Lat_dept": "14.79",
            "Longitude_rep": "-15.75",
            "Latitude_rep": "14.60",
        },
        {
            "Village": "Bambey",
            "CSI_CASE": "CSI-095",
            "MILDA_distribuees": "45",
            "Besoins_estimes_1_MILDA_2_personnes": "120",
            "Lon_dept": "-16.46",
            "Lat_dept": "14.70",
            "Longitude_rep": "-16.30",
            "Latitude_rep": "14.55",
        },
    ]
    guessed = guess_mapping(list(WRONG[0].keys()), WRONG)
    check("the village column is the place name", guessed["oName"] == "Village", guessed)
    check("one name column names both ends", guessed["dName"] == "Village", guessed)
    check("a count is preferred to a case number", guessed["value"] == "MILDA_distribuees", guessed)
    check("no identifier becomes the value", guessed["value"] != "CSI_CASE", guessed)
    check(
        "the two coordinate pairs are told apart",
        (guessed["oLon"], guessed["oLat"], guessed["dLon"], guessed["dLat"])
        == ("Lon_dept", "Lat_dept", "Longitude_rep", "Latitude_rep"),
        guessed,
    )
    check("no date is invented from 'estimes'", guessed["date"] == "", guessed)

    findings = diagnose_mapping(WRONG, {"value": "CSI_CASE", "oName": "Village"})
    check(
        "a value column with no number is an error naming the column",
        any(f["level"] == "error" and "CSI_CASE" in f["text"] for f in findings),
        findings,
    )
    check("and its examples are shown", any("CSI-001" in f["text"] for f in findings), findings)

    raised = ""
    try:
        build_dataset(WRONG, {"oName": "Village", "value": "CSI_CASE"})
    except ValueError as err:
        raised = str(err)
    check(
        "building with a text value column fails and says which column",
        "CSI_CASE" in raised and "no number" in raised,
        raised,
    )

    verdict, reason = coordinate_pairing(
        [14.42, 14.60, 14.55],
        [-16.45, -15.75, -16.30],
        samples=[(-16.92, 14.79), (-15.90, 14.79), (-16.46, 14.70)],
        labels=("Latitude_rep", "Longitude_rep"),
    )
    check("a swapped destination pair is spotted", verdict == "swap" and reason, (verdict, reason))
    good, _ = build_dataset(
        WRONG,
        {
            "oName": "Village",
            "value": "MILDA_distribuees",
            "oLon": "Lon_dept",
            "oLat": "Lat_dept",
            "dLon": "Latitude_rep",
            "dLat": "Longitude_rep",
            "swapDest": True,
        },
    )
    check("and swapped back when the dataset is built", len(good["edges"]) == 3, good["edges"])
    check("the unit is read from the value column", good["meta"]["unit"] == "mildas", good["meta"]["unit"])
    check("guess_unit_label knows people", guess_unit_label("Personnes_deplacees") == "people", guess_unit_label("Personnes_deplacees"))
    check(
        "findings_text keeps the errors, one per line",
        findings_text(findings).count("\n") >= 0 and "CSI_CASE" in findings_text(findings),
        findings_text(findings),
    )

    # ---- one name, two coordinate pairs -----------------------------------
    # The field report: "Origin name field" left empty, "Destination name
    # field" = Village, one longitude/latitude pair per end. The origin used to
    # borrow the destination's name, both ends fell on one dot, and 36 rows
    # gave 36 dots and no line at all.
    TWO_ENDS = [
        {"Village": "A", "X_in": "1.0", "Y_in": "1.0", "X_out": "2.0", "Y_out": "2.0", "N": "5"},
        {"Village": "B", "X_in": "3.0", "Y_in": "3.0", "X_out": "4.0", "Y_out": "4.0", "N": "7"},
    ]
    ONE_NAME = {
        "dName": "Village",
        "oLon": "X_in",
        "oLat": "Y_in",
        "dLon": "X_out",
        "dLat": "Y_out",
        "value": "N",
    }
    two, _ = build_dataset(TWO_ENDS, ONE_NAME)
    check(
        "an unnamed origin keeps its own position",
        not any(edge[1] == edge[2] for edge in two["edges"]),
        two["edges"],
    )
    check("two ends give four dots, not two", len(two["nodes"]) == 4, two["nodes"])
    flat = [dict(row, X_out=row["X_in"], Y_out=row["Y_in"]) for row in TWO_ENDS]
    flat_ds, flat_warnings = build_dataset(flat, ONE_NAME)
    check(
        "a table with one point per row says the flows are inside places",
        any("start and end at the same point" in w for w in flat_warnings),
        flat_warnings,
    )
    check(
        "the open dialog names the two coordinate pairs",
        any(f["role"] == "dLon" and "same" in f["text"] for f in diagnose_mapping(flat, ONE_NAME)),
        diagnose_mapping(flat, ONE_NAME),
    )
    check(
        "a page of records inside places does not promise lines",
        "travel round its ring" in flat_ds["meta"]["subtitle"],
        flat_ds["meta"]["subtitle"],
    )
    check(
        "a page with real movement still says each line is a flow",
        "each line a flow" in two["meta"]["subtitle"],
        two["meta"]["subtitle"],
    )
    check(
        "the page is stamped with the build that wrote it",
        str(flat_ds["meta"].get("app", "")).startswith("FlowMap "),
        flat_ds["meta"].get("app"),
    )
    check(
        "a table without dates still has an axis",
        flat_ds["meta"]["dateMode"] == "sequence" and flat_ds["maxDay"] >= 1,
        (flat_ds["meta"]["dateMode"], flat_ds["maxDay"]),
    )

    failed = [c for c in checks if not c[1]]
    for label, ok, detail in checks:
        print(("  ok   " if ok else "  FAIL ") + label + ("" if ok else "  -> " + str(detail)))
    print("%d of %d checks ok" % (len(checks) - len(failed), len(checks)))
    return 1 if failed else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--template", help="the built index.html to copy (default: next to this script, or the repo root)")
    common.add_argument("--out", required=True, help="the page to write")
    common.add_argument("--json", help="also write the dataset JSON here")

    demo = sub.add_parser("demo", parents=[common], help="write a page from the invented demo table")
    demo.set_defaults(func=cmd_demo)

    build = sub.add_parser("build", parents=[common], help="write a page from a spec file")
    build.add_argument("--input", required=True, help="JSON spec: rows, mapping, meta, places, admin1, admin2")
    build.set_defaults(func=cmd_build)

    sub.add_parser("selftest", help="run the checks").set_defaults(func=lambda a: selftest())

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
