# -*- coding: utf-8 -*-
"""Flow map - an ArcGIS Pro toolbox (7.1).

One tool. Choose a table, pick the columns in the drop-downs, press Run:

  * a single self-contained HTML page with the animated flow map (same page
    as the Yemen example), written to the output folder;
  * the administrative boundaries (regions and districts) of the countries
    the data lies in, downloaded automatically (geoBoundaries) and drawn on
    the page and in the map;
  * in the active ArcGIS Pro map: the boundaries, the flows (time-enabled, so
    the Time Slider plays the animation), and the places (sized by volume).

The column drop-downs are Pro's own "Field" parameters bound to the table
(parameterDependencies). Nothing is filled in by hand, nothing is rewritten
at every callback: that is what makes them real drop-downs.

The engine is flowmap_core.py (standard library only), next to this file.
This file is pure ASCII and never raises while being imported.

Requires ArcGIS Pro 2.9 or later.
"""

import datetime
import json
import os
import sys
import webbrowser

import arcpy

HERE = os.path.dirname(os.path.abspath(__file__))
CORE_VERSION = "7.1"


# --------------------------------------------------------------- the engine


def _find_core():
    for folder in (HERE, os.path.dirname(HERE), os.path.join(os.path.dirname(HERE), "arcgis")):
        if folder:
            candidate = os.path.join(folder, "flowmap_core.py")
            if os.path.isfile(candidate):
                return candidate
    return None


def _load_core(path):
    """Load flowmap_core.py by path, never a stale copy found on sys.path."""
    import importlib.util

    name = "flowmap_core__%s" % abs(hash(path))
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


CORE = None
CORE_ERROR = ""
CORE_FILE = _find_core()
if CORE_FILE:
    try:
        CORE = _load_core(CORE_FILE)
        found = str(getattr(CORE, "__version__", "") or "")
        if found != CORE_VERSION:
            CORE = None
            CORE_ERROR = (
                "This toolbox is FlowMap %s but flowmap_core.py beside it is %s. "
                "Unzip the whole FlowMap folder again." % (CORE_VERSION, found or "unversioned")
            )
    except Exception as err:
        CORE = None
        CORE_ERROR = "%s could not be imported: %s: %s" % (CORE_FILE, type(err).__name__, err)
else:
    CORE_ERROR = "flowmap_core.py was not found. It has to sit next to FlowMap.pyt (looked in %s)." % HERE


# ---------------------------------------------------------------- parameters
#
# name, label, kind, required, category, depends_on
#
# kinds: TABLE (the data), LAYER (a polygon/point layer), FIELD (drop-down of
# the columns of the parameter named in depends_on), FOLDER, FILE, TEXT, BOOL.
# A required parameter carries no category (categories are collapsed in Pro).

TOOL_LABEL = "Build a flow map page (7.1)"

PARAMETERS = (
    ("flows", "Flow table or layer", "TABLE", True, "", ""),
    ("out_folder", "Output folder", "FOLDER", True, "", ""),
    ("page_name", "Page file name", "TEXT", False, "", ""),
    ("o_name", "Place name field (origin)", "FIELD", False, "", "flows"),
    ("d_name", "Place name field (destination)", "FIELD", False, "", "flows"),
    ("value", "Value field (empty counts 1)", "FIELD", False, "", "flows"),
    ("date", "Date or day field", "FIELD", False, "", "flows"),
    ("o_lon", "Origin longitude field", "FIELD", False, "", "flows"),
    ("o_lat", "Origin latitude field", "FIELD", False, "", "flows"),
    ("d_lon", "Destination longitude field", "FIELD", False, "", "flows"),
    ("d_lat", "Destination latitude field", "FIELD", False, "", "flows"),
    ("auto_bounds", "Load the administrative boundaries of the countries in the data", "BOOL", False, "", ""),
    ("country", "Countries (ISO codes, only if the table has no coordinates)", "TEXT", False, "", ""),
    ("places", "Places layer (only if the table has no coordinates)", "LAYER", False, "Optional - your own places and boundaries", ""),
    ("places_name", "Name field in the places layer", "FIELD", False, "Optional - your own places and boundaries", "places"),
    ("places_group", "Group field in the places layer", "FIELD", False, "Optional - your own places and boundaries", "places"),
    ("bounds_fine", "Your own district boundaries (replace the downloaded ones)", "LAYER", False, "Optional - your own places and boundaries", ""),
    ("bounds_fine_name", "Name field in your district boundaries", "FIELD", False, "Optional - your own places and boundaries", "bounds_fine"),
    ("bounds_coarse", "Your own region boundaries (replace the downloaded ones)", "LAYER", False, "Optional - your own places and boundaries", ""),
    ("bounds_coarse_name", "Name field in your region boundaries", "FIELD", False, "Optional - your own places and boundaries", "bounds_coarse"),
    ("open_page", "Open the page when it is written", "BOOL", False, "Text on the page", ""),
    ("title", "Title", "TEXT", False, "Text on the page", ""),
    ("subtitle", "Subtitle", "TEXT", False, "Text on the page", ""),
    ("unit", "Unit of the values (empty: deduced)", "TEXT", False, "Text on the page", ""),
    ("node_label", "What one dot is called", "TEXT", False, "Text on the page", ""),
    ("group_label", "What a group is called", "TEXT", False, "Text on the page", ""),
    ("source", "Source note", "TEXT", False, "Text on the page", ""),
    ("add_animation", "Add boundaries, flows and places to the map (Time Slider animation)", "BOOL", False, "More options", ""),
    ("template", "Page template", "FILE", False, "More options", ""),
    ("out_json", "Also write the dataset (JSON)", "FILE", False, "More options", ""),
)

DATATYPES = {
    "TABLE": "GPTableView",
    "LAYER": "GPFeatureLayer",
    "FIELD": "Field",
    "FOLDER": "DEFolder",
    "FILE": "DEFile",
    "TEXT": "GPString",
    "BOOL": "GPBoolean",
}

# dialog name -> the role the engine knows
PARAM_FOR_ROLE = {
    "oName": "o_name",
    "dName": "d_name",
    "value": "value",
    "date": "date",
    "oLon": "o_lon",
    "oLat": "o_lat",
    "dLon": "d_lon",
    "dLat": "d_lat",
    "oGroup": "",
    "dGroup": "",
}
ROLES_IN_CORE = tuple(PARAM_FOR_ROLE)

HELP = {
    "flows": (
        "The table with one row per flow: where it starts, where it goes, and "
        "optionally how much and when. Browse to a CSV, an Excel sheet, a "
        "table, a feature class, or pick a layer of the map. Pick it first: "
        "every field list below then offers the columns of this table."
    ),
    "out_folder": (
        "The folder the page is written to (index.html, the boundary cache and "
        "FlowMap.gdb with the map layers). Missing folders are created."
    ),
    "page_name": "The name of the HTML file. Empty: index.html.",
    "o_name": (
        "The column holding the place a flow starts from. Leave it empty when "
        "the table has coordinates and no separate name."
    ),
    "d_name": "The column holding the place a flow goes to. Empty: the origin column is used.",
    "value": "The column holding the quantity to draw. It must contain numbers. Empty: every row counts 1.",
    "date": "The date, or a plain day number, that drives the animation. Empty: the rows' order is the axis.",
    "o_lon": "Longitude of the origin, in degrees (WGS84).",
    "o_lat": "Latitude of the origin, in degrees (WGS84).",
    "d_lon": "Longitude of the destination, in degrees. Empty when the destination is the origin.",
    "d_lat": "Latitude of the destination, in degrees. Empty when the destination is the origin.",
    "auto_bounds": (
        "Finds which countries hold the places (from their coordinates) and "
        "downloads their regions (ADM1) and districts (ADM2) from geoBoundaries. "
        "They are drawn on the page and added to the map. They are kept in the "
        "output folder, so a second run needs no internet. Needs an internet "
        "connection the first time; without it the page is still built."
    ),
    "country": (
        "Only needed when the table has place names but no coordinates: the "
        "country or countries to load, as ISO codes separated by commas "
        "(YEM, MLI, SN). Otherwise they are found from the data."
    ),
    "places": "Leave empty in most cases. Only for a table that has place names but NO coordinate columns: a point layer (a village list, for example) whose names are matched to the names in the table to find where each place is.",
    "places_name": "The column of the places layer that holds the place name.",
    "places_group": "The column of the places layer that holds the region a place belongs to. Optional.",
    "bounds_fine": "Your own detailed outlines (districts). They replace the downloaded ones. Optional.",
    "bounds_fine_name": "The column of the detailed outlines holding the name.",
    "bounds_coarse": "Your own coarse outlines (regions). They replace the downloaded ones. Optional.",
    "bounds_coarse_name": "The column of the coarse outlines holding the name.",
    "open_page": "Open the page in the default browser as soon as it is written.",
    "title": "The title at the top of the page. Empty: the name of the table.",
    "subtitle": "A second line under the title. Empty: a sentence describing the map.",
    "unit": "What the values are counted in. Empty: deduced from the value column.",
    "node_label": "What one dot is called on the page: place, village, district.",
    "group_label": "What a group of dots is called: region, province, area.",
    "source": "The credit line at the foot of the page.",
    "add_animation": (
        "Adds to the active map: the boundaries, the flows as a time-enabled "
        "line layer (open the Time Slider and press play) and the places as "
        "points sized by volume. Everything is stored in FlowMap.gdb in the "
        "output folder."
    ),
    "template": "The page to fill with data. Empty: the index.html next to this toolbox.",
    "out_json": "Also write the dataset as JSON. Optional.",
}


def _message(messages, text, level="message"):
    """Write a line into the geoprocessing messages and never fail."""
    names = (
        ("addWarningMessage", "addWarning")
        if level == "warning"
        else ("addMessage",)
    )
    for name in names:
        method = getattr(messages, name, None)
        if callable(method):
            try:
                method(text)
                return True
            except Exception:
                continue
    try:
        (arcpy.AddWarning if level == "warning" else arcpy.AddMessage)(text)
        return True
    except Exception:
        return False


def _say(messages, text):
    return _message(messages, text, "message")


def _warn_text(messages, text):
    return _message(messages, text, "warning")


def _abool(value, default=True):
    if value is None or str(value).strip() == "":
        return default
    return str(value).strip().lower() in ("true", "1", "yes", "oui")


class Toolbox(object):
    def __init__(self):
        self.label = "Flow map"
        self.alias = "flowmap"
        self.description = (
            "Build an animated flow map from a table: an HTML page, the "
            "administrative boundaries of the countries concerned, and "
            "time-enabled layers in the ArcGIS Pro map."
        )
        self.tools = [BuildFlowMapPage]


class BuildFlowMapPage(object):
    def __init__(self):
        self.label = TOOL_LABEL
        self.description = (
            "Version 7.1. Reads a flow table, loads the boundaries of the "
            "countries in the data, writes one HTML file with the animated "
            "flow map, and adds boundaries, flows and places to the map."
        )
        self.canRunInBackground = False

    # ---------------------------------------------------------- parameters
    def getParameterInfo(self):
        params = []
        for name, label, kind, required, category, depends in PARAMETERS:
            param = arcpy.Parameter(
                displayName=label,
                name=name,
                datatype=DATATYPES[kind],
                parameterType="Required" if required else "Optional",
                direction="Input",
            )
            if category:
                param.category = category
            if kind == "FIELD":
                # Pro's own field drop-down, bound to the table parameter
                param.parameterDependencies = [depends]
            params.append(param)

        by_name = {p.name: p for p in params}
        by_name["page_name"].value = "index.html"
        by_name["open_page"].value = True
        by_name["add_animation"].value = True
        by_name["auto_bounds"].value = True
        try:
            by_name["template"].filter.list = ["html", "htm"]
            by_name["out_json"].filter.list = ["json"]
        except Exception:
            pass
        return params

    def isLicensed(self):
        return True

    # ------------------------------------------------------------- reading
    @staticmethod
    def _text(param):
        if param is None:
            return ""
        try:
            return (param.valueAsText or "").strip()
        except Exception:
            return ""

    @staticmethod
    def _refs_of(param):
        """Every form of one dataset arcpy can be handed, best first."""
        refs = []

        def add(value):
            if value is None:
                return
            text = ""
            try:
                text = str(value).strip().strip("'\"")
            except Exception:
                pass
            if text and "<" not in text and text not in refs:
                refs.append(text)
            for attr in ("dataSource", "catalogPath"):
                try:
                    extra = getattr(value, attr, None)
                except Exception:
                    extra = None
                if isinstance(extra, str) and extra.strip() and extra.strip() not in refs:
                    refs.append(extra.strip())

        try:
            add(param.valueAsText)
        except Exception:
            pass
        try:
            value = param.value
        except Exception:
            value = None
        if value not in (None, ""):
            add(value)
            if not isinstance(value, str):
                refs.append(value)
        return refs

    def _search(self, param, fields, **kwargs):
        error = None
        for ref in self._refs_of(param):
            try:
                return arcpy.da.SearchCursor(ref, fields, **kwargs)
            except Exception as err:
                error = err
        if error is not None:
            raise error
        raise arcpy.ExecuteError("No dataset is chosen to read.")

    def _column(self, by_name, name):
        return self._text(by_name.get(name))

    def _mapping_from(self, by_name):
        mapping = {}
        for role in ROLES_IN_CORE:
            param_name = PARAM_FOR_ROLE.get(role)
            mapping[role] = self._column(by_name, param_name) if param_name else ""
        return mapping

    def _is_points(self, param):
        for ref in self._refs_of(param):
            try:
                shape = str(arcpy.Describe(ref).shapeType)
            except Exception:
                continue
            if shape in ("Point", "Multipoint", "PointZ", "PointM"):
                return True
            if shape and shape != "None":
                return False
        return False

    @staticmethod
    def _title_from(text):
        text = str(text or "").strip().strip("'\"")
        text = os.path.basename(text.rstrip("\\/"))
        text = os.path.splitext(text)[0]
        text = text.strip("_ $").replace("_", " ").strip()
        return (text[:1].upper() + text[1:]) if text else "Flow map"

    # -------------------------------------------------------------- dialog
    def updateParameters(self, parameters):
        """Light on purpose: a default title, and points need no coordinates."""
        try:
            by_name = {p.name: p for p in parameters}
            flows = by_name.get("flows")
            title = by_name.get("title")
            if flows is not None and title is not None and flows.value and not title.altered and not title.value:
                title.value = self._title_from(self._text(flows))
        except Exception:
            pass

    def updateMessages(self, parameters):
        """Say what a choice means, from a sample of the rows. Never fails."""
        try:
            by_name = {p.name: p for p in parameters}
            if CORE is None:
                if CORE_ERROR and by_name.get("flows") is not None:
                    by_name["flows"].setWarningMessage(CORE_ERROR)
                return
            flows = by_name.get("flows")
            if flows is None or not self._text(flows):
                return
            mapping = self._mapping_from(by_name)
            chosen = [v for k, v in mapping.items() if v]
            if not chosen:
                return
            fields = []
            for name in chosen:
                if name not in fields:
                    fields.append(name)
            rows = []
            try:
                with self._search(flows, fields) as cursor:
                    for index, values in enumerate(cursor):
                        rows.append(dict(zip(fields, values)))
                        if index >= 199:
                            break
            except Exception:
                return
            for finding in CORE.diagnose_mapping(rows, mapping):
                param = by_name.get(PARAM_FOR_ROLE.get(finding.get("role"), ""))
                if param is None:
                    continue
                if finding.get("level") == "error":
                    param.setErrorMessage(finding.get("text") or "")
                elif finding.get("level") == "warning":
                    param.setWarningMessage(finding.get("text") or "")
        except Exception:
            pass

    # --------------------------------------------------------------- running
    def execute(self, parameters, messages):
        by_name = {p.name: p for p in parameters}
        if CORE is None:
            raise arcpy.ExecuteError(CORE_ERROR or "flowmap_core.py is missing.")
        flows_param = by_name.get("flows")
        flows = self._text(flows_param)
        if not flows:
            raise arcpy.ExecuteError("Choose the flow table or layer.")
        folder = self._text(by_name.get("out_folder"))
        if not folder:
            raise arcpy.ExecuteError("Choose the output folder.")
        folder = os.path.abspath(folder)
        if not os.path.isdir(folder):
            os.makedirs(folder)
        out_html = self._page_path(folder, self._text(by_name.get("page_name")))

        mapping = self._mapping_from(by_name)
        is_points = self._is_points(flows_param)
        located = any(mapping.get(r) for r in ("oName", "dName", "oLon", "oLat", "dLon", "dLat"))
        lookup = any(self._text(by_name.get(n)) for n in ("places", "bounds_fine", "bounds_coarse"))
        if not located and not lookup and not is_points:
            raise arcpy.ExecuteError(
                "No column is chosen. Pick the place-name fields, or the "
                "longitude and latitude fields, in the drop-downs under the table."
            )

        _say(messages, "FlowMap %s" % CORE_VERSION)
        _say(messages, "Reading %s ..." % self._title_from(flows))
        sample = self._read_rows(flows_param, mapping, limit=200)
        pairing = self._apply_pairing(mapping, sample)
        try:
            findings = CORE.diagnose_mapping(sample, mapping)
        except Exception:
            findings = []
        rows = self._read_rows(flows_param, mapping)
        _say(messages, "  %d rows" % len(rows))

        places = []
        if self._text(by_name.get("places")):
            places = self._read_places(
                by_name["places"], self._column(by_name, "places_name"), self._column(by_name, "places_group")
            )
            _say(messages, "  %d places to look names up in" % len(places))

        bounds = {}
        for role, layer_name, label in (
            ("admin2", "bounds_fine", "detailed outlines"),
            ("admin1", "bounds_coarse", "coarse outlines"),
        ):
            if not self._text(by_name.get(layer_name)):
                continue
            name_column = self._column(by_name, layer_name + "_name")
            if not name_column:
                raise arcpy.ExecuteError("Choose the name field of the %s." % label)
            bounds[role] = self._read_boundaries(by_name[layer_name], name_column)
            _say(messages, "  %d %s" % (len(bounds[role]), label))
        user_bounds = bool(bounds)

        # --- boundaries from the web (before the build when the table has no
        # coordinates and the countries were named; after it otherwise)
        want_auto = _abool(by_name["auto_bounds"].value if by_name.get("auto_bounds") is not None else True)
        want_auto = want_auto and not user_bounds
        cache = os.path.join(folder, "admin_cache")
        isos = []
        if want_auto:
            isos, unknown = CORE.parse_countries(self._text(by_name.get("country")))
            if unknown:
                _warn_text(messages, "Unknown country code(s) ignored: %s" % ", ".join(unknown))
        online = {"admin1": {}, "admin2": {}, "files": {}}
        if want_auto and isos:
            online = self._load_online(isos, cache, messages)
            bounds = {k: online[k] for k in ("admin1", "admin2") if online[k]}

        meta = self._meta(by_name, flows, bool(bounds) or want_auto)
        dataset, warnings = self._build(rows, mapping, meta, places, bounds, findings, messages)

        if want_auto and not isos:
            points = [(n[2], n[3]) for n in dataset.get("nodes") or []]
            try:
                isos = CORE.countries_of_points(points)
            except Exception as err:
                isos = []
                _warn_text(
                    messages,
                    "The countries of the data could not be found online (%s: %s). "
                    "The page is built without boundaries; type the country "
                    "codes in 'Countries' to retry." % (type(err).__name__, err),
                )
            if isos:
                _say(messages, "Countries in the data: %s" % ", ".join(isos))
                online = self._load_online(isos, cache, messages)
                bounds = {k: online[k] for k in ("admin1", "admin2") if online[k]}
                if bounds:
                    meta = self._meta(by_name, flows, True)
                    dataset, warnings = self._build(rows, mapping, meta, places, bounds, findings, messages)

        for warning in warnings:
            _warn_text(messages, warning)
        if pairing:
            _warn_text(messages, pairing)

        template = self._text(by_name.get("template")) or self._find_template()
        if not template or not os.path.isfile(template):
            raise arcpy.ExecuteError(
                "No page template found. Put index.html next to FlowMap.pyt or set 'Page template'."
            )
        json_path = self._json_path_out(folder, by_name)
        CORE.build_page(template, dataset, out_html, json_path)
        _say(
            messages,
            "Wrote %s - %d places, %d flows, %d day(s), %s %s."
            % (
                out_html,
                len(dataset["nodes"]),
                len(dataset["edges"]),
                dataset["maxDay"] + 1,
                round(dataset["total"], 3),
                dataset["meta"].get("unit") or "records",
            ),
        )
        if json_path:
            _say(messages, "Also wrote %s" % json_path)

        if _abool(by_name["add_animation"].value if by_name.get("add_animation") is not None else True):
            self._write_map_layers(dataset, folder, online, messages)

        if _abool(by_name["open_page"].value if by_name.get("open_page") is not None else True):
            self._open(out_html)

    def _meta(self, by_name, flows, has_areas):
        group_label = self._text(by_name.get("group_label")) or ("area" if has_areas else "group")
        meta = {
            "title": self._text(by_name.get("title")) or self._title_from(flows),
            "nodeLabel": self._text(by_name.get("node_label")) or "place",
            "groupLabel": group_label,
            "source": self._text(by_name.get("source"))
            or "%s - %s" % (os.path.basename(flows.rstrip("\\/")), "geoBoundaries" if has_areas else "project"),
        }
        unit = self._text(by_name.get("unit"))
        if unit:
            meta["unit"] = unit
        subtitle = self._text(by_name.get("subtitle"))
        if subtitle:
            meta["subtitle"] = subtitle
        return meta

    def _build(self, rows, mapping, meta, places, bounds, findings, messages):
        try:
            return CORE.build_dataset(
                rows,
                dict(mapping),
                meta=meta,
                places=places,
                admin1=bounds.get("admin1"),
                admin2=bounds.get("admin2"),
            )
        except ValueError as err:
            try:
                text = CORE.findings_text(findings)
            except Exception:
                text = ""
            for line in (text or "").splitlines():
                if line.strip():
                    _warn_text(messages, line)
            raise arcpy.ExecuteError(str(err))

    def _load_online(self, isos, cache, messages):
        _say(messages, "Loading boundaries (regions and districts) for %s ..." % ", ".join(isos))
        try:
            result = CORE.load_admin_layers(isos, cache, log=lambda t: _say(messages, "  " + t))
        except Exception as err:
            _warn_text(messages, "Boundaries could not be loaded (%s: %s)." % (type(err).__name__, err))
            return {"admin1": {}, "admin2": {}, "files": {}}
        if not result["admin1"] and not result["admin2"]:
            _warn_text(
                messages,
                "No boundary could be downloaded (no internet, or no data for %s). "
                "The page is built without them." % ", ".join(isos),
            )
        return result

    def _apply_pairing(self, mapping, sample):
        if not sample or not CORE:
            return ""
        o_lon, o_lat = mapping.get("oLon"), mapping.get("oLat")
        d_lon, d_lat = mapping.get("dLon"), mapping.get("dLat")
        if not (o_lon and o_lat and d_lon and d_lat):
            return ""
        origins = [
            (CORE.to_number(row.get(o_lon)), CORE.to_number(row.get(o_lat))) for row in sample
        ]
        origins = [p for p in origins if p[0] is not None and p[1] is not None]
        try:
            verdict, reason = CORE.coordinate_pairing(
                [r.get(d_lon) for r in sample],
                [r.get(d_lat) for r in sample],
                samples=origins,
                labels=(d_lon, d_lat),
            )
        except Exception:
            return ""
        if verdict == "swap":
            mapping["swapDest"] = True
            return reason
        return ""

    @staticmethod
    def _open(path):
        try:
            webbrowser.open("file:///" + os.path.abspath(path).replace("\\", "/"))
        except Exception:
            pass

    @staticmethod
    def _page_path(folder, name):
        name = (name or "").strip() or "index.html"
        path = name if os.path.isabs(name) else os.path.join(folder, name)
        if not os.path.splitext(path)[1]:
            path += ".html"
        return path

    def _json_path_out(self, folder, by_name):
        wanted = self._text(by_name.get("out_json"))
        if not wanted:
            return None
        path = wanted if os.path.isabs(wanted) else os.path.join(folder, wanted)
        if not os.path.splitext(path)[1]:
            path += ".json"
        return path

    @staticmethod
    def _find_template():
        for folder in (HERE, os.path.dirname(HERE), os.path.join(os.path.dirname(HERE), "arcgis")):
            if folder:
                for name in ("index.html", "flow-map.html"):
                    candidate = os.path.join(folder, name)
                    if os.path.isfile(candidate):
                        return candidate
        return None

    # ---------------------------------------------------------------- reading
    @staticmethod
    def _geo(fields):
        if "SHAPE@" not in fields:
            return {}
        try:
            return {"spatial_reference": arcpy.SpatialReference(4326)}
        except Exception:
            return {}

    def _read_rows(self, layer, mapping, limit=None):
        fields = []
        for role in ROLES_IN_CORE:
            name = mapping.get(role)
            # "__x"/"__y" are the geometry's own coordinates, not columns
            if name and not name.startswith("__") and name not in fields:
                fields.append(name)
        is_points = self._is_points(layer)
        use = list(fields) + (["SHAPE@"] if is_points else [])
        if not use:
            raise arcpy.ExecuteError("No column is chosen to read.")
        rows = []
        try:
            with self._search(layer, use, **self._geo(use)) as cursor:
                for values in cursor:
                    row = dict(zip(fields, values[: len(fields)]))
                    if is_points:
                        shape = values[-1]
                        point = getattr(shape, "firstPoint", None) if shape is not None else None
                        row["__x"] = getattr(point, "X", None)
                        row["__y"] = getattr(point, "Y", None)
                    rows.append(row)
                    if limit and len(rows) >= limit:
                        break
        except arcpy.ExecuteError:
            raise
        except Exception as err:
            raise arcpy.ExecuteError(
                "The table could not be read with the columns %s: %s: %s"
                % (", ".join(use), type(err).__name__, err)
            )
        if is_points and not mapping.get("oLon") and not mapping.get("oLat"):
            # no origin coordinate columns chosen: the geometry is the origin
            mapping["oLon"] = "__x"
            mapping["oLat"] = "__y"
        return rows

    def _read_places(self, layer, name_field, group_field):
        if not name_field:
            raise arcpy.ExecuteError("Choose the name field of the places layer.")
        fields = [name_field] + ([group_field] if group_field else [])
        use = list(fields) + ["SHAPE@"]
        places = []
        with self._search(layer, use, **self._geo(use)) as cursor:
            for values in cursor:
                point = getattr(values[-1], "firstPoint", None) if values[-1] is not None else None
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

    def _read_boundaries(self, layer, name_field):
        out = {}
        use = [name_field, "SHAPE@"]
        count = 0
        with self._search(layer, use, **self._geo(use)) as cursor:
            for name, shape in cursor:
                if not name or shape is None:
                    continue
                parts = self._parts(shape)
                count += sum(len(p) for p in parts)
                rings = CORE.clean_rings(parts, decimals=5, tolerance=CORE._tolerance_for(count))
                if rings:
                    out[str(name)] = rings
        return out

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
        except TypeError:
            points = [(p.X, p.Y) for p in geometry.getPart()]
            if points:
                parts.append(points)
        return parts

    # ---------------------------------------------------- layers in the map
    def _write_map_layers(self, dataset, folder, online, messages):
        """Boundaries, flows (time-enabled) and places as layers of the map."""
        try:
            gdb = os.path.join(folder, "FlowMap.gdb")
            if not self._exists(gdb):
                arcpy.management.CreateFileGDB(folder, "FlowMap.gdb")
        except Exception as err:
            _warn_text(messages, "The page is written, but FlowMap.gdb could not be created: %s: %s" % (type(err).__name__, err))
            return

        target = self._target_map(messages)
        added = []

        # 1. boundaries, drawn first so they sit under everything
        for role, fc_name, label in (("admin1", "flowmap_admin1", "Regions"), ("admin2", "flowmap_admin2", "Districts")):
            try:
                files = (online.get("files") or {}).get(role) or []
                fc = self._boundaries_to_gdb(gdb, fc_name, files)
                if fc:
                    layer = self._add_layer(target, fc, label)
                    self._style_polygons(layer, heavy=(role == "admin1"))
                    added.append(label)
            except Exception as err:
                _warn_text(messages, "%s layer not added: %s: %s" % (label, type(err).__name__, err))

        # 2. flows, time-enabled
        flows_layer = None
        try:
            fc, written = self._flows_to_gdb(dataset, gdb)
            _say(messages, "Flows written to %s (%d lines)." % (fc, written))
            flows_layer = self._add_layer(target, fc, "Flows")
            added.append("Flows")
        except Exception as err:
            _warn_text(messages, "The flows layer could not be built: %s: %s" % (type(err).__name__, err))

        # 3. places, sized by volume
        try:
            fc = self._places_to_gdb(dataset, gdb)
            layer = self._add_layer(target, fc, "Places")
            self._style_places(layer)
            added.append("Places")
        except Exception as err:
            _warn_text(messages, "The places layer could not be built: %s: %s" % (type(err).__name__, err))

        if flows_layer is not None:
            self._style_flows(flows_layer)
            if self._enable_time(flows_layer):
                _say(messages, "Time is on for 'Flows': open the Time Slider on the map and press play. The Animation tab exports a video.")
            else:
                _warn_text(
                    messages,
                    "'Flows' is in the map but time could not be switched on by the tool: "
                    "right-click the layer > Properties > Time, choose the WHEN field as start time.",
                )
            try:
                lyrx = os.path.join(folder, "FlowMap-flows.lyrx")
                arcpy.management.SaveToLayerFile(flows_layer, lyrx)
            except Exception:
                pass
        if added:
            _say(messages, "Added to the map: %s." % ", ".join(added))
        try:
            self._zoom(target, "Flows")
        except Exception:
            pass

    @staticmethod
    def _exists(path):
        try:
            return bool(arcpy.Exists(path))
        except Exception:
            return os.path.exists(path)

    def _target_map(self, messages):
        try:
            project = arcpy.mp.ArcGISProject("CURRENT")
            target = project.activeMap
            if target is None:
                maps = project.listMaps()
                target = maps[0] if maps else None
            if target is None:
                _warn_text(messages, "No map is open: the layers are in FlowMap.gdb, add them by hand.")
            return target
        except Exception as err:
            _warn_text(messages, "No project is open (%s): the layers are in FlowMap.gdb." % type(err).__name__)
            return None

    @staticmethod
    def _add_layer(target, fc, name):
        """Add a feature class to the map (replacing an older layer of that name)."""
        if target is None:
            return None
        for old in target.listLayers(name):
            try:
                target.removeLayer(old)
            except Exception:
                pass
        layer = target.addDataFromPath(fc)
        try:
            layer.name = name
        except Exception:
            pass
        return layer

    @staticmethod
    def _zoom(target, name):
        if target is None:
            return
        layers = target.listLayers(name)
        if not layers:
            return
        project = arcpy.mp.ArcGISProject("CURRENT")
        view = project.activeView
        if view is not None and hasattr(view, "camera"):
            view.camera.setExtent(view.getLayerExtent(layers[0], False, True))

    def _boundaries_to_gdb(self, gdb, fc_name, files):
        if not files:
            return None
        fc = os.path.join(gdb, fc_name)
        if self._exists(fc):
            arcpy.management.Delete(fc)
        parts = []
        for index, path in enumerate(files):
            out = fc if len(files) == 1 else os.path.join(gdb, "%s_%d" % (fc_name, index))
            arcpy.conversion.JSONToFeatures(path, out, "POLYGON")
            parts.append(out)
        if len(parts) > 1:
            arcpy.management.Merge(parts, fc)
            for part in parts:
                arcpy.management.Delete(part)
        return fc

    def _flows_to_gdb(self, dataset, gdb):
        fc = os.path.join(gdb, "flowmap_flows")
        if self._exists(fc):
            arcpy.management.Delete(fc)
        arcpy.management.CreateFeatureclass(gdb, "flowmap_flows", "POLYLINE", spatial_reference=arcpy.SpatialReference(4326))
        for name, kind, length in (
            ("DAY", "LONG", None),
            ("WHEN", "DATE", None),
            ("ORIGIN", "TEXT", 120),
            ("DESTINATION", "TEXT", 120),
            ("VALUE", "DOUBLE", None),
        ):
            if length:
                arcpy.management.AddField(fc, name, kind, field_length=length)
            else:
                arcpy.management.AddField(fc, name, kind)
        base = datetime.date(2000, 1, 1)
        start = (dataset.get("meta") or {}).get("dateStart")
        if start:
            try:
                base = datetime.date(*[int(p) for p in str(start).split("-")[:3]])
            except Exception:
                pass
        nodes = dataset.get("nodes") or []
        noon = datetime.time(12, 0, 0)
        written = 0
        with arcpy.da.InsertCursor(fc, ["SHAPE@", "DAY", "WHEN", "ORIGIN", "DESTINATION", "VALUE"]) as cursor:
            for day, i, j, value in dataset.get("edges") or []:
                a, b = nodes[i], nodes[j]
                line = self._line(a, b)
                if line is None:
                    continue
                when = datetime.datetime.combine(base + datetime.timedelta(days=int(day)), noon)
                cursor.insertRow([line, int(day), when, str(a[0]), str(b[0]), float(value)])
                written += 1
        return fc, written

    @staticmethod
    def _line(a, b):
        try:
            if a[2] == b[2] and a[3] == b[3]:
                return None
            return arcpy.Polyline(
                arcpy.Array([arcpy.Point(a[2], a[3]), arcpy.Point(b[2], b[3])]),
                arcpy.SpatialReference(4326),
            )
        except Exception:
            return None

    def _places_to_gdb(self, dataset, gdb):
        fc = os.path.join(gdb, "flowmap_places")
        if self._exists(fc):
            arcpy.management.Delete(fc)
        arcpy.management.CreateFeatureclass(gdb, "flowmap_places", "POINT", spatial_reference=arcpy.SpatialReference(4326))
        for name, kind, length in (
            ("NAME", "TEXT", 120),
            ("GRP", "TEXT", 120),
            ("OUT_TOTAL", "DOUBLE", None),
            ("IN_TOTAL", "DOUBLE", None),
            ("TOTAL", "DOUBLE", None),
        ):
            if length:
                arcpy.management.AddField(fc, name, kind, field_length=length)
            else:
                arcpy.management.AddField(fc, name, kind)
        nodes = dataset.get("nodes") or []
        out_total = [0.0] * len(nodes)
        in_total = [0.0] * len(nodes)
        for _day, i, j, value in dataset.get("edges") or []:
            out_total[i] += float(value)
            in_total[j] += float(value)
        with arcpy.da.InsertCursor(fc, ["SHAPE@XY", "NAME", "GRP", "OUT_TOTAL", "IN_TOTAL", "TOTAL"]) as cursor:
            for index, node in enumerate(nodes):
                cursor.insertRow(
                    [(node[2], node[3]), str(node[0]), str(node[1] or ""), out_total[index], in_total[index], out_total[index] + in_total[index]]
                )
        return fc

    # ----------------------------------------------------------------- style
    # Best effort: a style that fails never costs the layer.
    @staticmethod
    def _style_polygons(layer, heavy=False):
        try:
            symbology = layer.symbology
            symbol = symbology.renderer.symbol
            symbol.color = {"RGB": [0, 0, 0, 0]}
            symbol.outlineColor = {"RGB": [120, 130, 145, 255] if heavy else [150, 160, 170, 255]}
            symbol.outlineWidth = 1.2 if heavy else 0.4
            layer.symbology = symbology
        except Exception:
            pass

    @staticmethod
    def _style_flows(layer):
        try:
            symbology = layer.symbology
            symbology.updateRenderer("GraduatedSymbolsRenderer")
            renderer = symbology.renderer
            renderer.classificationField = "VALUE"
            renderer.breakCount = 5
            renderer.minimumSymbolSize = 1
            renderer.maximumSymbolSize = 6
            layer.symbology = symbology
            try:
                symbology = layer.symbology
                for info in symbology.renderer.classBreakInfos:
                    info.symbol.color = {"RGB": [217, 160, 102, 220]}
                layer.symbology = symbology
            except Exception:
                pass
        except Exception:
            pass

    @staticmethod
    def _style_places(layer):
        try:
            symbology = layer.symbology
            symbology.updateRenderer("GraduatedSymbolsRenderer")
            renderer = symbology.renderer
            renderer.classificationField = "TOTAL"
            renderer.breakCount = 5
            renderer.minimumSymbolSize = 4
            renderer.maximumSymbolSize = 22
            layer.symbology = symbology
            try:
                symbology = layer.symbology
                for info in symbology.renderer.classBreakInfos:
                    info.symbol.color = {"RGB": [57, 135, 229, 200]}
                layer.symbology = symbology
            except Exception:
                pass
        except Exception:
            pass

    @staticmethod
    def _enable_time(layer):
        """Turn time on, trying the call shapes that exist across Pro versions."""
        if layer is None:
            return False
        for call in (
            lambda: layer.enableTime("WHEN"),
            lambda: layer.enableTime(start_time_field="WHEN"),
            lambda: layer.enableTime(startTimeFieldName="WHEN"),
        ):
            try:
                call()
                return True
            except Exception:
                continue
        try:
            layer.time.enabled = True
            layer.time.startTimeField = "WHEN"
            return True
        except Exception:
            return False
