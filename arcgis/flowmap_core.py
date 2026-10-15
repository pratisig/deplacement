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

__version__ = "1.0.0"

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
        date_mode = "none"
    max_day = max([0] + day_of_row)

    # ---- places -----------------------------------------------------------
    nodes = []
    node_index = {}
    # A place belongs to one group. The first group the table gives a name —
    # in its own column, in the places layer, or inherited from the other end
    # of the row — is kept, so a city does not split into two dots when two
    # rows call it by two regions.
    group_of_name = {}

    def resolve_group(name, column_group, inherit_from=""):
        key = key_name(name)
        if not key:
            return column_group or inherit_from
        if key not in group_of_name:
            group_of_name[key] = column_group or index.group_of(name) or inherit_from or ""
        return group_of_name[key]

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
        key = key_name(label) + "|" + key_name(group)
        i = node_index.get(key)
        if i is None:
            i = len(nodes)
            node_index[key] = i
            nodes.append([label, group or "", round(float(x), 5), round(float(y), 5)])
        return i

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
        o_name = str(get(row, mapping.get("oName")) or "").strip()
        d_name = str(get(row, mapping.get("dName")) or "").strip() or o_name
        o_column_group = str(get(row, mapping.get("oGroup")) or "").strip()
        d_column_group = str(get(row, mapping.get("dGroup")) or "").strip()
        o_group = resolve_group(o_name, o_column_group)
        # with a single group column, the row's group describes both ends
        d_group = resolve_group(d_name, d_column_group, inherit_from=o_column_group or o_group)
        o_lon = to_number(get(row, mapping.get("oLon"))) if has(mapping.get("oLon")) else None
        o_lat = to_number(get(row, mapping.get("oLat"))) if has(mapping.get("oLat")) else None
        # no destination coordinates in the table: a row describes one place,
        # and the page counts it as a record within that place
        d_lon = to_number(get(row, mapping.get("dLon"))) if mapping.get("dLon") else o_lon
        d_lat = to_number(get(row, mapping.get("dLat"))) if mapping.get("dLat") else o_lat
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
        raise ValueError("No usable rows: no place could be placed on the map. " + hint)
    if skipped:
        shown = ", ".join(list(dict.fromkeys(missing))[:6])
        warnings.append(
            "%d of %d rows were skipped because the place could not be located (%s%s)."
            % (skipped, len(rows), shown, "…" if len(set(missing)) > 6 else "")
        )

    meta = dict(meta or {})
    meta.setdefault("title", "Flow map")
    meta.setdefault(
        "subtitle",
        "Each dot is one place, each line a flow between two of them. "
        "Drag the layout slider to move between true geography and a network view.",
    )
    meta.setdefault("unit", "records")
    meta.setdefault("nodeLabel", "place")
    meta.setdefault("groupLabel", "group" if not (admin1 or admin2) else "area")
    meta["dateStart"] = date_start if date_mode == "date" else None
    meta["dateMode"] = date_mode

    dataset = {
        "meta": {k: meta[k] for k in ("title", "subtitle", "unit", "nodeLabel", "groupLabel", "source", "dateStart", "dateMode") if k in meta},
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


def guess_mapping(field_names):
    """Prefill the field mapping from the column names — the same guesses
    the page makes in src/js/table.js, so the dialog opens sensibly."""
    lower = {f: str(f).lower() for f in field_names}
    used = set()

    def pick(pattern, exclude=()):
        rx = re.compile(pattern, re.I)
        for f in field_names:
            if f in used or f in exclude:
                continue
            if rx.search(lower[f]):
                used.add(f)
                return f
        return ""

    mapping = {
        "oName": pick(r"^orig|\borig|^from|^source|^o_?name|depart|départ|^o_?loc"),
        "dName": pick(r"^dest|\bdest|^to\b|^arriv|^d_?name|^vers|^d_?loc"),
        "oGroup": pick(r"o_?group|orig.*(group|prov|gov|region)|from.*(group|prov|gov)"),
        "dGroup": pick(r"d_?group|dest.*(group|prov|gov|region)|to.*(group|prov|gov)"),
        "oLon": pick(r"o_?(lon|lng|x)|orig.*(lon|lng|x)|from.*(lon|lng|x)|longitude.*(orig|from|o\b)"),
        "oLat": pick(r"o_?lat|orig.*lat|from.*lat|latitude.*(orig|from|o\b)"),
        "dLon": pick(r"d_?(lon|lng|x)|dest.*(lon|lng|x)|to.*(lon|lng|x)|longitude.*(dest|to)"),
        "dLat": pick(r"d_?lat|dest.*lat|to.*lat|latitude.*(dest|to)"),
        "date": pick(r"date|day|jour|week|month|time|mois|semaine|periode|période"),
        "value": pick(r"value|count|nombre|total|cases|cas|hh|household|menage|ménage|people|pop|flow|vol"),
    }
    if not mapping["oLon"]:
        mapping["oLon"] = pick(r"lon|lng|x")
    if not mapping["oLat"]:
        mapping["oLat"] = pick(r"lat|\by\b")
    if not mapping["dLon"] and mapping["oLon"]:
        mapping["dLon"] = mapping["oLon"]
    if not mapping["dLat"] and mapping["oLat"]:
        mapping["dLat"] = mapping["oLat"]
    if not mapping["dName"] and mapping["oName"]:
        mapping["dName"] = mapping["oName"]
    # the mode is decided from the column itself when the dataset is built —
    # plain numbers become a day axis without anyone choosing it
    return mapping


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
