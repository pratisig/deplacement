# -*- coding: utf-8 -*-
"""Flow map — an ArcGIS Pro toolbox.

One tool: it reads a flow table (or a points layer), resolves the places,
optionally takes outline layers, and writes a **single self-contained HTML
page** that opens in any browser. The page holds the map, the animation, the
slider, the search, the table view and the exports; it needs no server, no
API key and no internet connection.

Install (ArcGIS Pro):

    1. Put this folder somewhere permanent, e.g.
       C:\\Users\\<you>\\Documents\\ArcGIS\\FlowMap\\
    2. In Pro: Insert > Toolbox > Add Toolbox… and pick FlowMap.pyt.
    3. Open the tool, choose your layers, press Run.

The heavy lifting lives in flowmap_core.py, which imports nothing but the
Python standard library, so the whole pipeline can be tested (and used from
a .NET add-in, or from a plain shell) without ArcGIS:

    python flowmap_core.py demo  --out demo.html
    python flowmap_core.py build --input spec.json --out page.html

Requires ArcGIS Pro 2.9 or later (Python 3). Tested against Pro 3.x APIs;
see the notes in README.md about what is and is not verifiable off Windows.
"""

import os
import sys
import webbrowser

import arcpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    import flowmap_core as core  # noqa: E402
except ImportError:  # pragma: no cover - a broken install is worth a real error
    raise arcpy.ExecuteError(
        "flowmap_core.py must sit next to FlowMap.pyt in the same folder."
    )

FIELD = "Field"
NUMBER = "GPDouble"
TEXT = "GPString"
BOOL = "GPBoolean"

# The page draws longitude/latitude, so every geometry is read through a
# cursor that reprojects it: most Pro projects are stored in metres, and a
# projected coordinate read as if it were a degree lands nowhere.
GEOGRAPHIC = "4326"


def wgs84():
    return arcpy.SpatialReference(int(GEOGRAPHIC))

# The columns the page needs, and how the tool labels them.
ROLES = (
    ("o_name", "Origin name", True),
    ("d_name", "Destination name", True),
    ("value", "Value (default 1)", False),
    ("date", "Date or day number", False),
    ("o_group", "Origin group", False),
    ("d_group", "Destination group", False),
    ("o_lon", "Origin longitude", False),
    ("o_lat", "Origin latitude", False),
    ("d_lon", "Destination longitude", False),
    ("d_lat", "Destination latitude", False),
)

# Their names in flowmap_core.build_dataset().
CORE_ROLE = {
    "o_name": "oName",
    "d_name": "dName",
    "o_group": "oGroup",
    "d_group": "dGroup",
    "o_lon": "oLon",
    "o_lat": "oLat",
    "d_lon": "dLon",
    "d_lat": "dLat",
    "date": "date",
    "value": "value",
}

TEMPLATE_NAMES = ("index.html", "flow-map.html")
POINT_TYPES = ("Point", "Multipoint")


class Toolbox(object):
    def __init__(self):
        self.label = "Flow map"
        self.alias = "flowmap"
        self.description = (
            "Build a self-contained, offline flow-map page — places, flows, "
            "time slider and GIS exports — from a table inside the project."
        )
        self.tools = [BuildFlowMapPage]


class BuildFlowMapPage(object):
    def __init__(self):
        self.label = "Build a flow map page"
        self.description = (
            "Read a flow table, resolve the places, and write one HTML file "
            "that draws an animated flow map. The page works offline, needs "
            "no API key, and can export GIF, video, SHP, GeoJSON, GeoParquet "
            "and CSV."
        )
        self.canRunInBackground = False

    # ------------------------------------------------------------- parameters
    def getParameterInfo(self):
        params = [
            arcpy.Parameter(
                displayName="Flow table or layer",
                name="flows",
                datatype=["GPTableView", "DETable", "DEFeatureClass", "GPFeatureLayer"],
                parameterType="Required",
                direction="Input",
            ),
            arcpy.Parameter(
                displayName="Output page (HTML)",
                name="out_html",
                datatype="DEFile",
                parameterType="Required",
                direction="Output",
            ),
        ]
        # the columns, right after the table they belong to
        for name, label, required in ROLES:
            params.append(
                arcpy.Parameter(
                    displayName=label + " field",
                    name=name,
                    datatype=FIELD,
                    parameterType="Required" if required else "Optional",
                    direction="Input",
                    parameterDependencies=["flows"],
                )
            )
        params += [
            arcpy.Parameter(
                displayName="Page template",
                name="template",
                datatype="DEFile",
                parameterType="Optional",
                direction="Input",
            ),
            arcpy.Parameter(
                displayName="Places to look names up (optional)",
                name="places",
                datatype=["DEFeatureClass", "GPFeatureLayer"],
                parameterType="Optional",
                direction="Input",
            ),
            arcpy.Parameter(
                displayName="Name field in the places layer",
                name="places_name",
                datatype=FIELD,
                parameterType="Optional",
                direction="Input",
                parameterDependencies=["places"],
            ),
            arcpy.Parameter(
                displayName="Group field in the places layer",
                name="places_group",
                datatype=FIELD,
                parameterType="Optional",
                direction="Input",
                parameterDependencies=["places"],
            ),
            arcpy.Parameter(
                displayName="Detailed outlines (optional)",
                name="bounds_fine",
                datatype=["DEFeatureClass", "GPFeatureLayer"],
                parameterType="Optional",
                direction="Input",
            ),
            arcpy.Parameter(
                displayName="Name field in the outlines",
                name="bounds_fine_name",
                datatype=FIELD,
                parameterType="Optional",
                direction="Input",
                parameterDependencies=["bounds_fine"],
            ),
            arcpy.Parameter(
                displayName="Coarse outlines (optional)",
                name="bounds_coarse",
                datatype=["DEFeatureClass", "GPFeatureLayer"],
                parameterType="Optional",
                direction="Input",
            ),
            arcpy.Parameter(
                displayName="Name field in the coarse outlines",
                name="bounds_coarse_name",
                datatype=FIELD,
                parameterType="Optional",
                direction="Input",
                parameterDependencies=["bounds_coarse"],
            ),
            arcpy.Parameter(
                displayName="Outline detail in degrees (0 keeps every vertex)",
                name="tolerance",
                datatype=NUMBER,
                parameterType="Optional",
                direction="Input",
            ),
            arcpy.Parameter(
                displayName="Title",
                name="title",
                datatype=TEXT,
                parameterType="Optional",
                direction="Input",
            ),
            arcpy.Parameter(
                displayName="Subtitle",
                name="subtitle",
                datatype=TEXT,
                parameterType="Optional",
                direction="Input",
            ),
            arcpy.Parameter(
                displayName="Unit of the values",
                name="unit",
                datatype=TEXT,
                parameterType="Optional",
                direction="Input",
            ),
            arcpy.Parameter(
                displayName="What one dot is called",
                name="node_label",
                datatype=TEXT,
                parameterType="Optional",
                direction="Input",
            ),
            arcpy.Parameter(
                displayName="What a group is called",
                name="group_label",
                datatype=TEXT,
                parameterType="Optional",
                direction="Input",
            ),
            arcpy.Parameter(
                displayName="Source note",
                name="source",
                datatype=TEXT,
                parameterType="Optional",
                direction="Input",
            ),
            arcpy.Parameter(
                displayName="Also write the dataset (JSON)",
                name="out_json",
                datatype="DEFile",
                parameterType="Optional",
                direction="Output",
            ),
            arcpy.Parameter(
                displayName="Open the page when it is written",
                name="open_page",
                datatype=BOOL,
                parameterType="Optional",
                direction="Input",
            ),
        ]
        by_name = {p.name: p for p in params}
        by_name["tolerance"].value = 0
        by_name["open_page"].value = True
        by_name["unit"].value = "households"
        by_name["node_label"].value = "place"
        by_name["group_label"].value = "area"
        by_name["template"].filter.list = ["html", "htm"]
        by_name["out_html"].filter.list = ["html", "htm"]

        # categories turn into collapsible groups in the tool pane
        for p in params:
            if p.name in ("flows", "out_html", "places", "places_name", "places_group"):
                p.category = "1 · Input"
            elif p.name in ("bounds_fine", "bounds_fine_name", "bounds_coarse", "bounds_coarse_name", "tolerance"):
                p.category = "2 · Outlines"
            elif p.name in [r[0] for r in ROLES] + ["template"]:
                p.category = "3 · Columns"
            elif p.name in ("out_json", "open_page"):
                p.category = "5 · Output"
            else:
                p.category = "4 · Text on the page"
        return params

    def isLicensed(self):
        return True

    def updateParameters(self, parameters):
        by_name = {p.name: p for p in parameters}
        flows = by_name["flows"].value
        if not flows:
            return
        try:
            names = [f.name for f in arcpy.ListFields(flows)]
        except Exception:
            return

        # first run on a layer: prefill the columns the way the page would
        if getattr(self, "_guessed_for", None) != str(flows):
            guessed = core.guess_mapping(names)
            for param_name, role in CORE_ROLE.items():
                param = by_name.get(param_name)
                if param is not None and not param.altered and role in guessed:
                    param.value = guessed[role] or None
            self._guessed_for = str(flows)
            if not by_name["title"].altered:
                by_name["title"].value = getattr(flows, "name", None) or os.path.basename(str(flows))
        if not by_name["d_name"].value and by_name["o_name"].value:
            by_name["d_name"].value = by_name["o_name"].value
        if by_name["tolerance"].value is None:
            by_name["tolerance"].value = 0
        # a point layer carries its own coordinates
        if self._is_points(flows):
            for lon, lat in (("o_lon", "o_lat"), ("d_lon", "d_lat")):
                by_name[lon].enabled = False
                by_name[lat].enabled = False
        return

    def updateMessages(self, parameters):
        for param in parameters:
            self._clear(param)
        by_name = {p.name: p for p in parameters}
        flows = by_name["flows"].value
        if flows and not by_name["o_name"].value:
            by_name["o_name"].setErrorMessage("Choose the field holding the origin name.")
        if by_name["places"].value and not by_name["places_name"].value:
            by_name["places_name"].setErrorMessage("Choose the name field of the places layer.")
        for bounds, name in (("bounds_fine", "bounds_fine_name"), ("bounds_coarse", "bounds_coarse_name")):
            if by_name[bounds].value and not by_name[name].value:
                by_name[name].setErrorMessage(
                    "Choose the name field — the page matches it against the flow table."
                )
        has_coords = bool(by_name["o_lon"].value and by_name["o_lat"].value) or (
            flows and self._is_points(flows)
        )
        has_lookup = bool(by_name["places"].value or by_name["bounds_fine"].value or by_name["bounds_coarse"].value)
        if flows and not has_coords and not has_lookup:
            by_name["o_name"].setErrorMessage(
                "Without coordinates, the page needs a places layer or an outlines layer "
                "to find these names on the map."
            )
        return

    # ---------------------------------------------------------------- running
    def execute(self, parameters, messages):
        by_name = {p.name: p for p in parameters}
        flows = by_name["flows"].valueAsText
        out_html = by_name["out_html"].valueAsText
        if not out_html:
            raise arcpy.ExecuteError("Choose where to write the page.")
        tolerance = float(by_name["tolerance"].value or 0)
        decimals = 5

        mapping = {}
        for param_name, role in CORE_ROLE.items():
            value = by_name[param_name].valueAsText
            mapping[role] = value or ""
        self._fill_geometry_columns(flows, mapping, by_name)

        messages.addMessage("Reading %s…" % flows)
        rows = self._read_rows(flows, mapping)
        messages.addMessage("  %d rows" % len(rows))

        places = []
        if by_name["places"].value:
            places = self._read_places(
                by_name["places"].valueAsText,
                by_name["places_name"].valueAsText,
                by_name["places_group"].valueAsText,
            )
            messages.addMessage("  %d places to look names up in" % len(places))

        admin2 = []
        if by_name["bounds_fine"].value:
            admin2 = self._read_boundaries(
                by_name["bounds_fine"].valueAsText,
                by_name["bounds_fine_name"].valueAsText,
                decimals,
                tolerance,
            )
            messages.addMessage("  %d detailed outlines" % len(admin2[0]))
        admin1 = []
        if by_name["bounds_coarse"].value:
            admin1 = self._read_boundaries(
                by_name["bounds_coarse"].valueAsText,
                by_name["bounds_coarse_name"].valueAsText,
                decimals,
                tolerance,
            )
            messages.addMessage("  %d coarse outlines" % len(admin1[0]))

        meta = {
            "title": by_name["title"].valueAsText or "Flow map",
            "subtitle": by_name["subtitle"].valueAsText or None,
            "unit": by_name["unit"].valueAsText or "records",
            "nodeLabel": by_name["node_label"].valueAsText or "place",
            "groupLabel": by_name["group_label"].valueAsText or ("area" if (admin1 or admin2) else "group"),
            "source": by_name["source"].valueAsText or ("%s — %s" % (arcpy.env.workspace or "project", os.path.basename(flows))),
        }
        try:
            dataset, warnings = core.build_dataset(
                rows,
                mapping,
                meta=meta,
                places=places,
                admin1=admin1[0] if admin1 else None,
                admin2=admin2[0] if admin2 else None,
            )
        except ValueError as err:
            raise arcpy.ExecuteError(str(err))
        for warning in warnings:
            messages.addWarningText(warning)

        template = by_name["template"].valueAsText or self._find_template()
        if not template or not os.path.isfile(template):
            raise arcpy.ExecuteError(
                "No page template found. Point the Page template parameter at "
                "index.html (the built flow-map page)."
            )
        core.build_page(template, dataset, out_html, by_name["out_json"].valueAsText or None)
        arcpy.SetParameterAsText(1, out_html)  # the output page, declared second

        messages.addMessage(
            "Wrote %s — %d places, %d flows, %d days, %s %s."
            % (
                out_html,
                len(dataset["nodes"]),
                len(dataset["edges"]),
                dataset["maxDay"] + 1,
                round(dataset["total"], 3),
                dataset["meta"]["unit"],
            )
        )
        messages.addMessage(
            "The page is self-contained: it opens in any browser, works offline, "
            "and can export GIF, video, SHP, GeoJSON, GeoParquet and CSV."
        )
        if str(by_name["open_page"].value).lower() in ("true", "1"):
            try:
                webbrowser.open("file:///" + os.path.abspath(out_html).replace("\\", "/"))
            except Exception:
                pass
        return

    # ----------------------------------------------------------------- helpers
    @staticmethod
    def _geo(fields):
        """Ask the cursor for longitude/latitude, but only when it returns
        geometry — a plain table has nothing to reproject."""
        return {"spatial_reference": wgs84()} if "SHAPE@" in fields else {}

    @staticmethod
    def _clear(param):
        """Drop a message from an earlier pass; clearMessage() is the Pro way."""
        if hasattr(param, "clearMessage"):
            param.clearMessage()
        else:
            param.setErrorMessage("")
        return

    def _is_points(self, layer):
        try:
            return arcpy.Describe(layer).shapeType in POINT_TYPES
        except Exception:
            return False

    def _fill_geometry_columns(self, layer, mapping, by_name):
        """A point layer carries coordinates; use them unless told otherwise."""
        if self._is_points(layer):
            if not mapping["oLon"]:
                mapping["oLon"] = "__x"
            if not mapping["oLat"]:
                mapping["oLat"] = "__y"
            for lon, lat in (("o_lon", "o_lat"), ("d_lon", "d_lat")):
                by_name[lon].enabled = False
                by_name[lat].enabled = False

    def _read_rows(self, layer, mapping):
        wanted = [mapping[role] for role in ("oName", "dName", "oGroup", "dGroup", "oLon", "oLat", "dLon", "dLat", "date", "value")]
        fields = [f for f in dict.fromkeys(wanted) if f and not f.startswith("__")]
        is_points = self._is_points(layer)
        use = fields + (["SHAPE@"] if is_points else [])
        rows = []
        with arcpy.da.SearchCursor(layer, use, **self._geo(use)) as cursor:
            for values in cursor:
                row = dict(zip(fields, values[: len(fields)]))
                if is_points:
                    shape = values[-1]
                    point = shape.firstPoint if shape is not None else None
                    row["__x"] = getattr(point, "X", None)
                    row["__y"] = getattr(point, "Y", None)
                rows.append(row)
        return rows

    def _read_places(self, layer, name_field, group_field):
        fields = [name_field] + ([group_field] if group_field else [])
        places = []
        use = fields + ["SHAPE@"]
        with arcpy.da.SearchCursor(layer, use, **self._geo(use)) as cursor:
            for values in cursor:
                shape = values[-1]
                point = shape.firstPoint if shape is not None else None
                if point is None:
                    continue
                places.append(
                    {
                        "name": values[0],
                        "group": values[1] if group_field else None,
                        "lon": point.X,
                        "lat": point.Y,
                    }
                )
        return places

    def _read_boundaries(self, layer, name_field, decimals, tolerance):
        """{name: [flat rings]} for one outline layer."""
        out = {}
        use = [name_field, "SHAPE@"]
        with arcpy.da.SearchCursor(layer, use, **self._geo(use)) as cursor:
            for name, shape in cursor:
                if not name or shape is None:
                    continue
                rings = core.clean_rings(self._parts(shape), decimals=decimals, tolerance=tolerance)
                if rings:
                    out[str(name)] = rings
        return (out,)

    @staticmethod
    def _parts(geometry):
        parts = []
        try:
            for part in geometry:
                if part is None:
                    continue
                points = [(p.X, p.Y) for p in part if p is not None]
                if points:
                    parts.append(points)
        except TypeError:  # single-part geometries on older readers
            points = [(p.X, p.Y) for p in geometry.getPart()]
            if points:
                parts.append(points)
        return parts

    @staticmethod
    def _find_template():
        here = os.path.dirname(os.path.abspath(__file__))
        for folder in (here, os.path.dirname(here)):
            for name in TEMPLATE_NAMES:
                candidate = os.path.join(folder, name)
                if os.path.isfile(candidate):
                    return candidate
        return None
