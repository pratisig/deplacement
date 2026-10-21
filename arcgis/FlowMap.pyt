# -*- coding: utf-8 -*-
"""Flow map - an ArcGIS Pro toolbox.

One tool: it reads a flow table (or a points layer), resolves the places,
optionally takes outline layers, and writes a **single self-contained HTML
page** that opens in any browser. It can also add the flows to the current
map, ready for the Time Slider, so the animation plays inside Pro.

Install (ArcGIS Pro):

    1. Put this folder somewhere permanent, e.g.
       C:\\Users\\<you>\\Documents\\ArcGIS\\FlowMap\\
    2. In Pro: Insert > Toolbox > Add Toolbox... and pick FlowMap.pyt.
    3. Open the tool, choose your table and your output folder, press Run.

Every column parameter is a drop-down filled with the columns of the table
you chose - the tool reads them itself, so a plain table, a feature class, a
layer added from a JSON file and a CSV all behave the same. No column has to
be typed by hand.

The heavy lifting lives in flowmap_core.py, which imports nothing but the
Python standard library, so the whole pipeline can be tested (and used from
a .NET add-in, or from a plain shell) without ArcGIS:

    python flowmap_core.py demo  --out demo.html
    python flowmap_core.py build --input spec.json --out page.html

Requires ArcGIS Pro 2.9 or later (Python 3). This file is deliberately pure
ASCII and never raises while being imported or while the dialog is built: a
toolbox that cannot load is a tool nobody can use.
"""

import datetime
import json
import os
import sys
import traceback
import webbrowser

import arcpy

HERE = os.path.dirname(os.path.abspath(__file__))


# --------------------------------------------------------------- the engine
#
# flowmap_core.py does all the work that decides what the page shows. It is
# loaded by path, on purpose: ArcGIS Pro keeps one Python session for the
# whole session, so a bare `import flowmap_core` can find a copy left in some
# other toolbox folder - a stale engine, silently driving the new toolbox.
# That is exactly what happened once; it will not happen again.


def _find_core():
    """The file holding flowmap_core.py, or None."""
    folders = [
        HERE,
        os.path.dirname(HERE),
        os.path.join(os.path.dirname(HERE), "arcgis"),
    ]
    for folder in folders:
        if not folder:
            continue
        candidate = os.path.join(folder, "flowmap_core.py")
        if os.path.isfile(candidate):
            return candidate
    return None


def _load_core(path):
    """Load flowmap_core.py from this path, whatever else is on sys.path."""
    name = "flowmap_core__%s" % abs(hash(path))
    if name in sys.modules:
        return sys.modules[name]
    import importlib.util

    if sys.version_info < (3, 5):  # pragma: no cover - Pro ships 3.x
        raise ImportError("ArcGIS Pro 2.9 or later is needed for this toolbox")
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# The engine and the toolbox are shipped together and must be the same build.
# A new .pyt left beside an old flowmap_core.py loads without complaint and then
# builds a page with the old rules - which is indistinguishable, from the user's
# side, from a bug. Refuse the mix by name.
CORE_VERSION = "6.8"

CORE = None
CORE_ERROR = ""
CORE_FILE = _find_core()
CORE_FOLDER = os.path.dirname(CORE_FILE) if CORE_FILE else None
if CORE_FILE:
    try:
        CORE = _load_core(CORE_FILE)
    except Exception as err:  # a damaged copy is worth a readable message
        CORE = None
        CORE_ERROR = "%s could not be imported: %s: %s" % (
            CORE_FILE,
            type(err).__name__,
            err,
        )
    else:
        found_version = str(getattr(CORE, "__version__", "") or "")
        if found_version != CORE_VERSION:
            CORE = None
            CORE_ERROR = (
                "This toolbox is FlowMap %s, but the engine beside it (%s) is "
                "%s. Unzip the whole FlowMap folder again and add the toolbox "
                "from that folder: an old engine builds a page with the old "
                "rules, and the page then shows none of the new behaviour."
                % (CORE_VERSION, os.path.basename(CORE_FILE), found_version or "unversioned")
            )
else:
    CORE_ERROR = (
        "flowmap_core.py was not found. It has to sit next to FlowMap.pyt. "
        "Looked in: %s and %s" % (HERE, os.path.dirname(HERE) or "-")
    )


# ---------------------------------------------------------------- parameters
#
# name, label, kind, required, direction, category
#
# A required parameter never carries a category: category members are
# collapsed in the Geoprocessing pane, so a required one hidden inside a
# category leaves the tool impossible to fill in. Everything required is at
# the top, where it is seen first.
#
# Four kinds of parameter and no more: TABLE is the data, FOLDER is where the
# page goes, COLUMN is a drop-down of that data's columns, TEXT is a word.

# The tool label is the heading of the Geoprocessing pane, so it is also the
# one place where a user can see which build is installed: a screenshot of the
# dialog says "6.8" or it does not. build-help.py reads this same string for
# the XML documentation, so the label and the help cannot drift apart.
TOOL_LABEL = "Build a flow map page (6.8)"

PARAMETERS = (
    ("flows", "Flow table or layer", "TABLE", True, "Input", ""),
    ("out_folder", "Output folder", "FOLDER", True, "Output", ""),
    ("page_name", "Page file name", "TEXT", False, "Input", ""),
    ("o_name", "Place name field (origin)", "COLUMN", False, "Input", ""),
    ("d_name", "Place name field (destination)", "COLUMN", False, "Input", ""),
    ("value", "Value field (empty counts 1)", "COLUMN", False, "Input", ""),
    ("date", "Date or day field", "COLUMN", False, "Input", ""),
    ("o_lon", "Origin longitude field", "COLUMN", False, "Input", ""),
    ("o_lat", "Origin latitude field", "COLUMN", False, "Input", ""),
    ("d_lon", "Destination longitude field", "COLUMN", False, "Input", ""),
    ("d_lat", "Destination latitude field", "COLUMN", False, "Input", ""),
    ("places", "Places to look names up", "LAYER", False, "Input", "Places and outlines"),
    ("places_name", "Name field in the places layer", "COLUMN", False, "Input", "Places and outlines"),
    ("places_group", "Group field in the places layer", "COLUMN", False, "Input", "Places and outlines"),
    ("bounds_fine", "Detailed outlines", "LAYER", False, "Input", "Places and outlines"),
    ("bounds_fine_name", "Name field in the outlines", "COLUMN", False, "Input", "Places and outlines"),
    ("bounds_coarse", "Coarse outlines", "LAYER", False, "Input", "Places and outlines"),
    ("bounds_coarse_name", "Name field in the coarse outlines", "COLUMN", False, "Input", "Places and outlines"),
    ("open_page", "Open the page when it is written", "BOOL", False, "Input", "Text on the page"),
    ("title", "Title", "TEXT", False, "Input", "Text on the page"),
    ("subtitle", "Subtitle", "TEXT", False, "Input", "Text on the page"),
    ("unit", "Unit of the values (empty: deduced)", "TEXT", False, "Input", "Text on the page"),
    ("node_label", "What one dot is called", "TEXT", False, "Input", "Text on the page"),
    ("group_label", "What a group is called", "TEXT", False, "Input", "Text on the page"),
    ("source", "Source note", "TEXT", False, "Input", "Text on the page"),
    ("add_animation", "Add the flows to the map, ready for the Time Slider", "BOOL", False, "Input", "More options"),
    ("template", "Page template", "FILE", False, "Input", "More options"),
    ("out_json", "Also write the dataset (JSON)", "FILE", False, "Output", "More options"),
)

# The typed dialog, and the plainer fallbacks used if a build refuses one.
TYPED_TYPES = {
    "TABLE": ["GPTableView", "DETable", "DEFeatureClass", "GPFeatureLayer"],
    "LAYER": ["GPFeatureLayer", "DEFeatureClass"],
    "COLUMN": "GPString",
    "FOLDER": "DEFolder",
    "FILE": "DEFile",
    "TEXT": "GPString",
    "BOOL": "GPBoolean",
}
SIMPLE_TYPES = {
    "TABLE": "GPTableView",
    "LAYER": "DEFeatureClass",
    "COLUMN": "GPString",
    "FOLDER": "DEFolder",
    "FILE": "DEFile",
    "TEXT": "GPString",
    "BOOL": "GPBoolean",
}
PLAIN_TYPES = {
    "TABLE": "GPString",
    "LAYER": "GPString",
    "COLUMN": "GPString",
    "FOLDER": "GPString",
    "FILE": "GPString",
    "TEXT": "GPString",
    "BOOL": "GPBoolean",
}

# A column drop-down always has something in it, even before a table has been
# chosen. Pro draws a GPString parameter whose filter is "Any" - or whose value
# list is empty - as a plain text box with no arrow, and a text box is how a
# column gets typed by hand and how a typo gets into a run. So each list holds
# a placeholder until its dataset can be read, the parameter is never emptied,
# and a placeholder is never passed to the engine as if it were a column.
PLACEHOLDER_NO_FLOWS = "(choose the flow table or layer first)"
PLACEHOLDER_NO_PLACES = "(choose the places layer first)"
PLACEHOLDER_NO_BOUNDS = "(choose the outline layer first)"
PLACEHOLDER_NO_COLUMNS = "(no column could be read from this table)"
PLACEHOLDERS = (
    PLACEHOLDER_NO_FLOWS,
    PLACEHOLDER_NO_PLACES,
    PLACEHOLDER_NO_BOUNDS,
    PLACEHOLDER_NO_COLUMNS,
)

# Every column parameter, and the dataset its drop-down is read from.
COLUMN_SOURCES = {
    "o_name": "flows",
    "d_name": "flows",
    "value": "flows",
    "date": "flows",
    "o_lon": "flows",
    "o_lat": "flows",
    "d_lon": "flows",
    "d_lat": "flows",
    "places_name": "places",
    "places_group": "places",
    "bounds_fine_name": "bounds_fine",
    "bounds_coarse_name": "bounds_coarse",
}

# Dialog name -> the role the engine knows. The engine keeps three roles the
# dialog no longer asks for (origin and destination group, outline detail):
# they are read with .get(), never indexed.
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

# What each parameter means, for the information button and the tool help.
# tools/arcgis/build-help.py turns this into the two .pyt.xml files that
# ArcGIS Pro reads; without them the (i) buttons are empty.
HELP = {
    "flows": (
        "The table that holds one row per flow: where it starts, where it goes, "
        "and optionally how much, when, and in which group. A layer, a feature "
        "class, a standalone table, a CSV, a JSON or a GeoJSON all work. "
        "Pick it first: every column list below is filled with its columns, "
        "and nothing is chosen for you - each field is yours to pick."
    ),
    "out_folder": (
        "The folder the page is written to. Browse to it: a folder you can "
        "navigate to, not a path to type. index.html is written inside it, or "
        "the name given in 'Page file name'. Missing folders are created."
    ),
    "page_name": (
        "The name of the HTML file, written inside the output folder. Leave it "
        "empty for index.html. A name without .html gets it added."
    ),
    "o_name": (
        "The column holding the place a flow starts from. Leave it empty when "
        "the table has no separate column for it: the origin is then labelled "
        "by its coordinates, which is what it is, and the flow stays a line "
        "between two points. Not needed at all when a places layer or an "
        "outlines layer can locate the names."
    ),
    "d_name": (
        "The column holding the place a flow goes to. Empty: the origin column "
        "is used for both ends, and a row whose two coordinate pairs are the "
        "same point counts as a record inside that place. When the origins and "
        "destinations are told apart by their coordinates rather than by their "
        "names, either put the same column in both name fields - the two "
        "positions stay two dots - or leave the origin name empty: its end is "
        "then labelled by its position and the flow is still a line."
    ),
    "value": (
        "The column holding the quantity to draw - households, people, cases, "
        "MILDA, tonnes. It must contain numbers: a column of text codes is "
        "refused by name. Leave it empty and every row counts 1."
    ),
    "date": (
        "The column holding the date, or a plain day number, that drives the "
        "animation. Leave it empty and everything happens on one day."
    ),
    "o_lon": (
        "The longitude of the place a flow starts from, in degrees (WGS84). "
        "A column in metres is reported as an error rather than drawn "
        "off the map."
    ),
    "o_lat": (
        "The latitude of the place a flow starts from, in degrees (WGS84). "
        "The tool checks that this column and the longitude column are the "
        "right way round, and swaps them if they are not."
    ),
    "d_lon": (
        "The longitude of the place a flow goes to, in degrees. Leave empty "
        "when the destination is the origin."
    ),
    "d_lat": (
        "The latitude of the place a flow goes to, in degrees. Leave empty "
        "when the destination is the origin."
    ),
    "places": (
        "A point layer giving the coordinates of the names in the flow table, "
        "for tables that have no coordinates of their own. Optional."
    ),
    "places_name": (
        "The column of the places layer that holds the place name: it is "
        "matched against the names in the flow table, ignoring case, accents "
        "and punctuation."
    ),
    "places_group": (
        "The column of the places layer that holds the region or group a place "
        "belongs to. Optional: it colours the dots."
    ),
    "bounds_fine": (
        "The detailed outlines (districts, communes, admin 2). They are drawn "
        "on the page and their names can locate places. Optional."
    ),
    "bounds_fine_name": (
        "The column of the detailed outlines holding the name to match against "
        "the flow table. Required when outlines are chosen."
    ),
    "bounds_coarse": (
        "The coarse outlines (provinces, governorates, admin 1), drawn under "
        "the detailed ones. Optional."
    ),
    "bounds_coarse_name": (
        "The column of the coarse outlines holding the name to match against "
        "the flow table. Required when coarse outlines are chosen."
    ),
    "open_page": (
        "Open the page in the default browser as soon as it is written. "
        "The page is a single file: it can be moved, mailed or put on a "
        "shared drive and it still works offline."
    ),
    "title": (
        "The title written at the top of the page. Empty: the name of the "
        "table, cleaned up."
    ),
    "subtitle": (
        "A second line under the title. Empty: a sentence describing what the "
        "dots and lines are."
    ),
    "unit": (
        "What the values are counted in: households, people, cases, MILDA. "
        "Empty: deduced from the value column, or 'records'."
    ),
    "node_label": (
        "What one dot is called on the page: place, village, district. "
        "Empty: 'place'."
    ),
    "group_label": (
        "What a group of dots is called: region, province, area. "
        "Empty: 'area' when outlines are given, otherwise 'group'."
    ),
    "source": (
        "The credit line at the foot of the page. Empty: the table name and "
        "the workspace."
    ),
    "add_animation": (
        "Also write the flows as a line feature class with a date field, add "
        "it to the current map and turn time on, so the Time Slider plays the "
        "animation in Pro itself and can export it as a video. The feature "
        "class and a .lyrx are saved in the output folder."
    ),
    "template": (
        "The page to fill with data: the built index.html. Empty: the "
        "index.html next to this toolbox."
    ),
    "out_json": (
        "Also write the dataset as JSON, for a script, a database or another "
        "page. Optional."
    ),
}


def _message(messages, text, level="message"):
    """Write a line into the Geoprocessing messages, and never fail.

    ArcGIS Pro hands execute() a Messages object whose methods are
    addMessage, addWarningMessage and addErrorMessage. There is no
    addWarningText, though the name reads as if there were: the stand-in this
    toolbox is tested with used to accept it, so the call shipped, and the
    first real run whose data produced a warning died with

        AttributeError: MessagesObject: Get attribute: s does not exist

    after the page had already been built. The names are tried in turn, and
    the arcpy globals are the last resort, so a message is never worth a
    failed run.
    """
    names = (
        ("addWarningMessage", "addWarningText", "addWarning", "AddWarning")
        if level == "warning"
        else ("addMessage", "AddMessage")
    )
    for name in names:
        method = getattr(messages, name, None)
        if callable(method):
            try:
                method(text)
                return True
            except Exception:
                continue
    fallback = arcpy.AddWarning if level == "warning" else arcpy.AddMessage
    try:
        fallback(text)
        return True
    except Exception:
        return False


def _say(messages, text):
    return _message(messages, text, "message")


def _warn_text(messages, text):
    return _message(messages, text, "warning")


def _abool(value, default=True):
    """Pro hands booleans back as True, 'true', '1' or None."""
    if value is None or str(value).strip() == "":
        return default
    return str(value).strip().lower() in ("true", "1", "yes", "oui")


class Toolbox(object):
    def __init__(self):
        self.label = "Flow map"
        self.alias = "flowmap"
        self.description = (
            "Build a self-contained, offline flow-map page - places, flows, "
            "time slider, search and GIS exports - from a table in the project. "
            "Optionally add the same flows to the map for the Time Slider."
        )
        self.tools = [BuildFlowMapPage]


class BuildFlowMapPage(object):
    def __init__(self):
        self.label = TOOL_LABEL
        self.description = (
            "Version 6.8. Read a flow table, resolve the places, and write one HTML file "
            "that draws an animated flow map. The page works offline, needs no "
            "API key, and can export GIF, video, SHP, GeoJSON, GeoParquet and "
            "CSV. The flows can also be added to the current map as a "
            "time-enabled layer."
        )
        self.canRunInBackground = False
        self._table = None
        self._sample = None
        self._sample_for = None
        self._findings = None
        self._columns_cache = {}

    # ---------------------------------------------------------- parameters
    def getParameterInfo(self):
        """Build the dialog - and keep building it if a datatype is refused.

        Three attempts, from the richest to the plainest. A build that will not
        take a composite datatype still gets the folder browse button and the
        column drop-downs, because a COLUMN is a plain string with a value
        list; only the data parameters lose their type and fall back to text.
        """
        errors = []
        for mode, types in (
            ("full", TYPED_TYPES),
            ("simple", SIMPLE_TYPES),
            ("plain", PLAIN_TYPES),
        ):
            try:
                params = self._build_parameters(types)
                self._mode = mode
                return params
            except Exception as err:
                errors.append("%s: %s" % (mode, err))
        # Nothing worked: a last dialog with one text parameter, so the tool
        # opens and says what is wrong instead of showing a red dot.
        self._mode = "minimal"
        try:
            arcpy.AddWarning(
                "Flow map: the typed dialog could not be built (%s). "
                "A text-only dialog is shown instead." % "; ".join(errors)
            )
        except Exception:
            pass
        return [
            arcpy.Parameter(
                displayName="Flow table or layer",
                name="flows",
                datatype="GPString",
                parameterType="Required",
                direction="Input",
            ),
            arcpy.Parameter(
                displayName="Output folder",
                name="out_folder",
                datatype="GPString",
                parameterType="Required",
                direction="Output",
            ),
        ]

    def _build_parameters(self, types):
        params = []
        for name, label, kind, required, direction, category in PARAMETERS:
            props = {
                "displayName": label,
                "name": name,
                "datatype": types[kind],
                "parameterType": "Required" if required else "Optional",
                "direction": direction,
            }
            if category:
                props["category"] = category
            param = arcpy.Parameter(**props)
            if kind == "COLUMN":
                # A value list is a real drop-down in the pane, and this tool
                # fills it from the columns it reads itself. Pro's own field
                # control is not used: it stays empty for a layer added from a
                # JSON file, which is how a dialog ends up with six boxes to
                # type in.
                #
                # A column parameter is a drop-down from the first moment the
                # pane is drawn, so the list is never empty: it holds the
                # placeholder that tells the user to choose a table first. The
                # list goes in before the type, on purpose - Pro resets a
                # filter to "Any" when the list is replaced while the
                # parameter has no items, and a filter of "Any" is drawn as a
                # text box, which is exactly what a pane of empty boxes is.
                self._sync_columns(param, [], COLUMN_SOURCES.get(name, "flows"))
            params.append(param)

        by_name = {p.name: p for p in params}
        by_name["page_name"].value = "index.html"
        by_name["open_page"].value = True
        by_name["add_animation"].value = True
        for name in ("title", "subtitle", "unit", "node_label", "group_label", "source"):
            if name in by_name:
                by_name[name].value = None
        try:
            by_name["template"].filter.list = ["html", "htm"]
            by_name["out_json"].filter.list = ["json"]
        except Exception:
            pass
        return params

    # ------------------------------------------------------------- reading
    @staticmethod
    def _text(param):
        value = param.valueAsText
        return (value or "").strip()

    @staticmethod
    def _placeholder_for(source):
        """The words a column drop-down shows before its dataset exists."""
        if source == "places":
            return PLACEHOLDER_NO_PLACES
        if source in ("bounds_fine", "bounds_coarse"):
            return PLACEHOLDER_NO_BOUNDS
        return PLACEHOLDER_NO_FLOWS

    @staticmethod
    def _is_placeholder(text):
        return str(text or "").strip() in PLACEHOLDERS

    def _column(self, by_name, name):
        """A column chosen in a drop-down, never a placeholder.

        Every place that reads a column goes through here, so the words
        "choose the flow table first" can never end up as a field name in a
        cursor - the one way a placeholder could do harm.
        """
        param = by_name.get(name)
        if param is None:
            return ""
        text = self._text(param)
        return "" if self._is_placeholder(text) else text

    def _columns_of(self, dataset):
        """The columns of a dataset, whatever kind of dataset it is.

        Four ways, in order, because the first one is not always available:
        ListFields, Describe().fields, a cursor that reports its own fields,
        and - for a layer added from a JSON or GeoJSON file - the file itself.
        That last one is what makes a JSON layer usable in the dialog.
        """
        if not dataset:
            return []
        key = str(dataset)
        if key in self._columns_cache:
            return self._columns_cache[key]
        names = self._read_column_names(dataset)
        self._columns_cache[key] = names
        return names

    def _read_column_names(self, dataset):
        names = []
        try:
            for field in arcpy.ListFields(dataset):
                name = getattr(field, "name", None)
                if name:
                    names.append(str(name))
        except Exception:
            pass
        if not names:
            try:
                describe = arcpy.Describe(dataset)
                for field in getattr(describe, "fields", None) or []:
                    name = getattr(field, "name", None)
                    if name:
                        names.append(str(name))
            except Exception:
                pass
        if not names:
            # a layer added from a JSON or GeoJSON file: Pro can list no field
            # for it, so the file itself is read
            names = self._json_columns(dataset)
        return self._clean_columns(names)

    @staticmethod
    def _clean_columns(names):
        """Drop the geometry columns and anything empty or repeated."""
        out = []
        for name in names:
            text = str(name or "").strip()
            if not text or text in out:
                continue
            upper = text.upper()
            if upper in ("SHAPE", "SHAPE@", "SHAPE_LENGTH", "SHAPE_LENG", "SHAPE_AREA", "GEOMETRY"):
                continue
            if upper.startswith("SHAPE_"):
                continue
            out.append(text)
        return out

    @staticmethod
    def _json_path(dataset):
        """The JSON or GeoJSON file behind a layer, if there is one.

        A layer added from a JSON file is described by Pro as
        CIMPATH=Map/_name_.json: relative, and not a path you can open. The
        file is searched for in the workspaces and folders a project uses.
        """
        text = str(dataset or "").strip()
        if not text:
            return None
        if "=" in text and text.split("=", 1)[0].strip().upper() == "CIMPATH":
            text = text.split("=", 1)[1].strip()
        if text.lower().startswith("file:///"):
            text = text[8:]
        if not text.lower().endswith((".json", ".geojson")):
            return None
        candidates = [text]
        folders = []
        try:
            folders.append(arcpy.env.workspace)
        except Exception:
            pass
        try:
            project = arcpy.mp.ArcGISProject("CURRENT")
            folders.append(getattr(project, "homeFolder", None))
            folders.append(os.path.dirname(getattr(project, "filePath", "") or ""))
        except Exception:
            pass
        folders.extend([os.getcwd(), HERE, os.path.dirname(HERE)])
        for folder in list(folders):
            if folder and os.path.isdir(str(folder)):
                for root, _dirs, files in os.walk(str(folder)):
                    for name in files:
                        if name.lower().endswith((".json", ".geojson")):
                            candidates.append(os.path.join(root, name))
                    # one level is enough; a project folder is not a disk
                    if root.count(os.sep) - str(folder).count(os.sep) > 2:
                        _dirs[:] = []
        wanted = os.path.basename(text).lower()
        for candidate in candidates:
            if not candidate:
                continue
            path = str(candidate)
            if not path.lower().endswith((".json", ".geojson")):
                continue
            if not os.path.isfile(path):
                continue
            if os.path.basename(path).lower() == wanted or path == text:
                return path
        return None

    def _json_columns(self, dataset):
        """Column names from the JSON file itself."""
        path = None
        try:
            path = self._json_path(dataset)
        except Exception:
            path = None
        if not path:
            return []
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except Exception:
            try:
                with open(path, "r", encoding="utf-8-sig") as handle:
                    data = json.load(handle)
            except Exception:
                return []
        return self._keys_of(data)

    @staticmethod
    def _keys_of(data):
        """The keys of a GeoJSON FeatureCollection, a list of objects, or a
        {fields: [...]} description."""
        if isinstance(data, dict):
            if isinstance(data.get("fields"), list) and data["fields"]:
                first = data["fields"][0]
                if isinstance(first, dict):
                    return [str(field.get("name") or field.get("fieldName") or "") for field in data["fields"]]
                return [str(field) for field in data["fields"]]
            features = data.get("features")
            if isinstance(features, list) and features:
                feature = features[0] or {}
                properties = feature.get("properties") or {}
                return [str(key) for key in properties.keys()]
            if isinstance(data.get("records"), list) and data["records"]:
                return [str(key) for key in (data["records"][0] or {}).keys()]
        if isinstance(data, list) and data and isinstance(data[0], dict):
            return [str(key) for key in data[0].keys()]
        return []

    def _sample_for_table(self, layer, names, limit=200):
        """Up to 200 rows of the table, read once and kept.

        This is what makes the guesses honest: a column is judged by what it
        holds, so a case number is never taken for a place name and a text
        column is never taken for a count.
        """
        key = str(layer)
        if self._sample_for == key:
            return self._sample
        rows = []
        fields = [name for name in names if name]
        if fields:
            try:
                with arcpy.da.SearchCursor(layer, fields) as cursor:
                    for index, values in enumerate(cursor):
                        rows.append(dict(zip(fields, values)))
                        if index + 1 >= limit:
                            break
            except Exception:
                rows = []
        self._sample = rows
        self._sample_for = key
        return rows

    def _mapping_from(self, by_name):
        """The engine mapping, from the dialog values that are set."""
        mapping = {}
        for role in ROLES_IN_CORE:
            param_name = PARAM_FOR_ROLE.get(role)
            mapping[role] = self._column(by_name, param_name) if param_name else ""
        return mapping

    # -------------------------------------------------------------- guessing
    @staticmethod
    def _title_from(layer):
        """A readable title from a layer name - never from its repr."""
        text = str(layer or "").strip()
        if "<" in text and "object at 0x" in text:
            return "Flow map"
        text = text.strip("'\"")
        if "=" in text and text.split("=", 1)[0].strip().upper() == "CIMPATH":
            text = text.split("=", 1)[1]
        text = os.path.basename(text.rstrip("\\/"))
        text = os.path.splitext(text)[0]
        text = text.strip("_ $").replace("_", " ").strip()
        if not text:
            return "Flow map"
        return text[:1].upper() + text[1:]

    def _refresh_lists(self, by_name):
        """Fill every column drop-down from the dataset it belongs to.

        Called from updateParameters *and* from updateMessages: Pro does not
        promise to call updateParameters when a dialog opens again on the
        values of the previous run, and a pane that comes back with a table
        chosen and twelve empty lists is the very thing this tool exists to
        stop. updateMessages is called; so the lists are filled there too.
        """
        for name, source in COLUMN_SOURCES.items():
            param = by_name.get(name)
            if param is None:
                continue
            dataset = by_name.get(source)
            dataset = dataset.value if dataset is not None else None
            columns = self._columns_of(dataset) if dataset else []
            self._sync_columns(param, columns, source, dataset_present=bool(dataset))
        # the last word: a column parameter is a drop-down, on every pass
        self._keep_lists(by_name)

    def _keep_lists(self, by_name):
        """Assert, on every callback, that the column parameters are lists.

        Pro is free to rebuild a parameter between two calls to the dialog -
        and a value list becomes a text box when its filter type goes back to
        "Any" or its list is emptied. Both are repaired here, and the ones
        that could not be repaired are named on the table parameter instead of
        being left for the user to discover.
        """
        broken = []
        for name in COLUMN_SOURCES:
            param = by_name.get(name)
            if param is None:
                continue
            try:
                kind = str(getattr(param.filter, "type", "") or "")
                items = list(getattr(param.filter, "list", None) or [])
            except Exception:
                continue
            if kind != "ValueList" or not items:
                self._force_value_list(param)
                try:
                    kind = str(getattr(param.filter, "type", "") or "")
                    items = list(getattr(param.filter, "list", None) or [])
                except Exception:
                    continue
            if kind != "ValueList" or not items:
                broken.append(name)
        flows = by_name.get("flows")
        if flows is not None and broken:
            flows.setWarningMessage(
                "Pro refused the column lists for: %s. They are text boxes in "
                "this session; type a column name exactly, or reopen the tool. "
                "Nothing else is affected." % ", ".join(broken)
            )

    @staticmethod
    def _force_value_list(param, options=None):
        """Make a column parameter a drop-down, and keep it one.

        Setting the list and setting the type are two different things, and
        Pro can put the type back to "Any" when the list is replaced - a
        parameter whose filter is "Any" is drawn as a text box, however good
        the list behind it is. So the type is asserted after every list change,
        and verified rather than assumed.
        """
        if options is not None:
            try:
                param.filter.list = list(options)
            except Exception:
                pass
        for _attempt in range(2):
            try:
                if str(getattr(param.filter, "type", "")) != "ValueList":
                    param.filter.type = "ValueList"
            except Exception:
                pass
            try:
                if str(getattr(param.filter, "type", "")) == "ValueList":
                    return True
            except Exception:
                return False
            # some builds only accept the type once the list has an item; an
            # empty entry is a legitimate item - it clears the field
            try:
                if not list(getattr(param.filter, "list", None) or []):
                    param.filter.list = [""]
            except Exception:
                pass
        return False

    def _sync_columns(self, param, columns, source="flows", dataset_present=False):
        """Fill one column drop-down from the dataset it belongs to.

        Three rules, and each one is a way a pane ends up full of text boxes:

        - the list is **never empty**: with no dataset it holds a placeholder,
          because Pro draws an empty value list as a plain text box;
        - the list is real column names, read from the dataset the parameter
          depends on, so a column can be picked and never typed;
        - the parameter stays **enabled**, so the arrow Pro draws for a value
          list is drawn - a disabled parameter is the other way a drop-down
          looks like a box.

        A column the new dataset does not have is dropped instead of being
        sent to the engine as a name that does not exist.
        """
        if param is None:
            return
        columns = [name for name in columns if name]
        if columns:
            options = [""] + columns
        elif dataset_present:
            # a dataset is chosen but Pro returns no field for it: say that,
            # rather than asking for a table that is already there
            options = [PLACEHOLDER_NO_COLUMNS]
        else:
            options = [self._placeholder_for(source)]
        # list, then type: a replaced list can reset the type to "Any"
        self._force_value_list(param, options)
        try:
            param.enabled = True
        except Exception:
            pass
        value = self._text(param)
        if not columns:
            if value and not self._is_placeholder(value):
                try:
                    param.value = None
                except Exception:
                    pass
            return
        if value and value not in columns:
            try:
                param.value = None
            except Exception:
                pass
        self._force_value_list(param)

    def _apply_pairing(self, mapping, sample):
        """Swap the destination columns if the numbers say they are crossed."""
        if not sample or not CORE:
            return ""
        o_lon, o_lat = mapping.get("oLon"), mapping.get("oLat")
        d_lon, d_lat = mapping.get("dLon"), mapping.get("dLat")
        if not (o_lon and o_lat and d_lon and d_lat):
            return ""
        d_lons = [row.get(d_lon) for row in sample]
        d_lats = [row.get(d_lat) for row in sample]
        origins = [
            (CORE.to_number(row.get(o_lon)), CORE.to_number(row.get(o_lat)))
            for row in sample
        ]
        origins = [point for point in origins if point[0] is not None and point[1] is not None]
        try:
            verdict, reason = CORE.coordinate_pairing(
                d_lons, d_lats, samples=origins, labels=(d_lon, d_lat)
            )
        except Exception:
            return ""
        if verdict == "swap":
            mapping["swapDest"] = True
            return reason
        return ""

    def _update_parameters(self, parameters):
        by_name = {param.name: param for param in parameters}
        flows = by_name.get("flows")
        if flows is None:
            return
        key = str(flows.value) if flows.value else ""
        if key != self._table:
            self._table = key
            self._sample = None
            self._sample_for = None
            self._findings = None

        # 1. every column drop-down follows its dataset
        self._refresh_lists(by_name)

        if CORE is None or not flows.value:
            return
        names = self._columns_of(flows.value)
        if not names:
            return
        sample = self._sample_for_table(flows.value, names)

        # 2. the title defaults to the table's name, and nothing else does.
        #
        # The column fields are deliberately NOT filled in. They used to be
        # guessed from the column names and their contents, which is how a
        # run once went out with the destination's name on both ends of every
        # flow: a guess is invisible, so a wrong guess looks like the user's
        # own choice. The lists are offered, the user picks. What the tool
        # still does is *read* a choice and say what it means - see the
        # findings below and the warnings at build time.
        title = by_name.get("title")
        if title is not None and not title.altered and not title.value:
            # valueAsText, never value: for a layer, value is an ArcGIS
            # object whose str() is "<MappingTableObject object at 0x...>"
            title.value = self._title_from(self._text(flows))

        # 3. the value column decides what the unit is called, when unset
        unit = by_name.get("unit")
        value_column = self._text(by_name.get("value")) if by_name.get("value") else ""
        if unit is not None and not unit.altered and not self._text(unit) and value_column and CORE:
            try:
                unit.value = CORE.guess_unit_label(value_column) or None
            except Exception:
                pass

        # 4. a point layer carries its own coordinates
        if self._is_points(flows.value):
            for lon, lat in (("o_lon", "o_lat"), ("d_lon", "d_lat")):
                for name in (lon, lat):
                    param = by_name.get(name)
                    if param is not None:
                        try:
                            param.enabled = False
                        except Exception:
                            pass

        # 5. what the current choices do to the data, as the user changes them
        mapping = self._mapping_from(by_name)
        try:
            findings = CORE.diagnose_mapping(sample, mapping)
        except Exception:
            findings = []
        self._findings = findings
        for finding in findings:
            param = by_name.get(PARAM_FOR_ROLE.get(finding.get("role"), ""))
            if param is None:
                continue
            if finding.get("level") == "error":
                param.setErrorMessage(finding.get("text") or "")
            elif finding.get("level") == "warning":
                param.setWarningMessage(finding.get("text") or "")

        # assigning a value can put the filter type back to "Any" on some
        # builds, so the drop-downs are asserted again after the guessing
        self._keep_lists(by_name)

    def updateParameters(self, parameters):
        """Never let a guess break the dialog: a red dot here helps nobody."""
        try:
            self._update_parameters(parameters)
        except Exception as err:
            try:
                arcpy.AddWarning(
                    "Flow map: a suggestion could not be worked out (%s: %s). "
                    "The dialog still works." % (type(err).__name__, err)
                )
            except Exception:
                pass

    # ------------------------------------------------------------ validation
    def _update_messages(self, parameters):
        by_name = {param.name: param for param in parameters}
        for param in parameters:
            self._clear(param)
        if CORE is None and CORE_ERROR:
            flows = by_name.get("flows")
            if flows is not None:
                flows.setWarningMessage(CORE_ERROR)
            return
        # the lists first: every check below reads a column back
        self._refresh_lists(by_name)
        flows = by_name.get("flows")
        if flows is None or not flows.value:
            return
        names = self._columns_of(flows.value)
        if not names:
            flows.setWarningMessage(
                "The columns of this table could not be read. A layer added from "
                "a JSON file should still work; if the list below stays empty, "
                "add the table to the map first."
            )
            return

        # a column that is not in its dataset is refused here, not later
        for name, source in COLUMN_SOURCES.items():
            param = by_name.get(name)
            if param is None:
                continue
            dataset = by_name.get(source)
            dataset = dataset.value if dataset is not None else None
            columns = self._columns_of(dataset) if dataset else []
            value = self._text(param)
            if value and columns and value not in columns:
                param.setErrorMessage(
                    '"%s" is not a column of the table chosen above. '
                    "Pick one from the list." % value
                )

        # the engine's findings, placed under the parameter they concern
        mapping = self._mapping_from(by_name)
        sample = self._sample_for_table(flows.value, names)
        try:
            findings = CORE.diagnose_mapping(sample, mapping) if CORE else []
        except Exception:
            findings = []
        for finding in findings:
            param = by_name.get(PARAM_FOR_ROLE.get(finding.get("role"), ""))
            if param is None:
                continue
            if finding.get("level") == "error":
                param.setErrorMessage(finding.get("text") or "")
            elif finding.get("level") == "warning":
                param.setWarningMessage(finding.get("text") or "")

        # nothing chosen yet: a warning, not an error - the pane is not broken,
        # it is empty, and the lists below it hold the answer
        chosen = self._mapping_from(by_name)
        if not any(
            chosen.get(role) for role in ("oName", "dName", "oLon", "oLat", "dLon", "dLat")
        ) and not self._is_points(flows.value):
            flows.setWarningMessage(
                "No column chosen yet: pick them from the lists below. The "
                "place names, or the coordinates, are the least the page needs."
            )

        # can these names be put on a map at all?
        coords = all(self._text(by_name.get(name)) for name in ("o_lon", "o_lat"))
        lookup = any(
            by_name.get(name) is not None and by_name[name].value
            for name in ("places", "bounds_fine", "bounds_coarse")
        )
        if not coords and not lookup and not self._is_points(flows.value):
            if self._text(by_name.get("o_name")):
                flows.setErrorMessage(
                    "These names cannot be placed yet: give the longitude and "
                    "latitude columns, or a places layer, or an outlines layer, "
                    "so the page knows where each name is."
                )

        # an outlines layer without its name column cannot be matched
        for bounds, name in (("bounds_fine", "bounds_fine_name"), ("bounds_coarse", "bounds_coarse_name")):
            if by_name.get(bounds) is not None and by_name[bounds].value:
                if by_name.get(name) is not None and not self._text(by_name[name]):
                    by_name[name].setErrorMessage(
                        "Choose the name column of these outlines: the page "
                        "matches it against the flow table."
                    )

    def updateMessages(self, parameters):
        try:
            self._update_messages(parameters)
        except Exception:
            pass

    # --------------------------------------------------------------- running
    def execute(self, parameters, messages):
        by_name = {param.name: param for param in parameters}
        if CORE is None:
            raise arcpy.ExecuteError(CORE_ERROR or "flowmap_core.py is missing.")
        flows = self._text(by_name.get("flows"))
        if not flows:
            raise arcpy.ExecuteError("Choose the flow table or layer.")

        folder = self._text(by_name.get("out_folder"))
        if not folder:
            raise arcpy.ExecuteError(
                "Choose the output folder: browse to the folder the page is "
                "written into."
            )
        folder = os.path.abspath(folder)
        if not os.path.isdir(folder):
            try:
                os.makedirs(folder)
            except Exception as err:
                raise arcpy.ExecuteError("The output folder could not be created: %s" % err)
        out_html = self._page_path(folder, self._text(by_name.get("page_name")))

        # Nothing chosen yet is a thing a person does - press Run on a fresh
        # pane - and "The table has no data rows" is not an answer to it.
        mapping = self._mapping_from(by_name)
        located_by_columns = any(
            mapping.get(role) for role in ("oName", "dName", "oLon", "oLat", "dLon", "dLat")
        )
        located_by_layer = any(
            by_name.get(name) is not None and by_name[name].value
            for name in ("places", "bounds_fine", "bounds_coarse")
        )
        if not located_by_columns and not located_by_layer and not self._is_points(flows):
            raise arcpy.ExecuteError(
                "No column is chosen yet, so there is nothing to place on the "
                "map. Pick the columns in the drop-downs below the table: the "
                "place names, or the longitude and latitude, or choose a places "
                "layer under 'Places and outlines'. Every list holds the "
                "columns of the table you chose."
            )

        names = self._columns_of(flows)
        sample = self._sample_for_table(flows, names) if names else []
        pairing = self._apply_pairing(mapping, sample)
        findings = []
        try:
            findings = CORE.diagnose_mapping(sample, mapping)
        except Exception:
            findings = []

        _say(
            messages,
            "FlowMap %s - engine %s"
            % (CORE_VERSION, getattr(CORE, "__version__", "?"))
        )
        _say(messages, "Reading %s ..." % flows)
        try:
            rows = self._read_rows(flows, mapping)
        except arcpy.ExecuteError:
            raise
        _say(messages, "  %d rows" % len(rows))

        places = []
        if by_name.get("places") is not None and by_name["places"].value:
            places = self._read_places(
                by_name["places"].valueAsText,
                self._column(by_name, "places_name"),
                self._column(by_name, "places_group"),
            )
            _say(messages, "  %d places to look names up in" % len(places))

        bounds = {}
        for role, name_param, label in (
            ("admin2", "bounds_fine", "detailed outlines"),
            ("admin1", "bounds_coarse", "coarse outlines"),
        ):
            if by_name.get(name_param) is None or not by_name[name_param].value:
                continue
            name_column = self._column(by_name, "%s_name" % name_param)
            if not name_column:
                raise arcpy.ExecuteError(
                    "Choose the name column of the %s." % label
                )
            bounds[role], tolerance = self._read_boundaries(
                by_name[name_param].valueAsText, name_column
            )
            _say(messages, "  %d %s" % (len(bounds[role]), label))

        title = self._text(by_name.get("title")) or self._title_from(flows)
        unit = self._text(by_name.get("unit"))
        group_label = self._text(by_name.get("group_label"))
        if not group_label:
            group_label = "area" if bounds else "group"
        source = self._text(by_name.get("source")) or "%s - %s" % (
            self._workspace() or "project",
            os.path.basename(flows.rstrip("\\/")),
        )
        meta = {
            "title": title,
            "nodeLabel": self._text(by_name.get("node_label")) or "place",
            "groupLabel": group_label,
            "source": source,
        }
        # an empty unit is not an empty label: it means "deduce it", so the
        # key is left out rather than set to a blank the engine would keep
        if unit:
            meta["unit"] = unit
        subtitle = self._text(by_name.get("subtitle"))
        if subtitle:
            meta["subtitle"] = subtitle

        try:
            dataset, warnings = CORE.build_dataset(
                rows,
                mapping,
                meta=meta,
                places=places,
                admin1=bounds.get("admin1"),
                admin2=bounds.get("admin2"),
            )
        except ValueError as err:
            self._warn(findings, messages)
            raise arcpy.ExecuteError(str(err))
        for warning in warnings:
            _warn_text(messages, warning)
        if pairing:
            _warn_text(messages, pairing)

        template = self._text(by_name.get("template")) or self._find_template()
        if not template or not os.path.isfile(template):
            raise arcpy.ExecuteError(
                "No page template found. Put index.html next to FlowMap.pyt, or "
                "point the Page template parameter at the built flow-map page."
            )
        json_path = self._json_path_out(folder, by_name)
        CORE.build_page(template, dataset, out_html, json_path)
        try:
            arcpy.SetParameterAsText(1, folder)  # the output folder, declared second
        except Exception:
            pass

        _say(messages, 
            "Wrote %s - %d places, %d flows, %d day(s), %s %s."
            % (
                out_html,
                len(dataset["nodes"]),
                len(dataset["edges"]),
                dataset["maxDay"] + 1,
                round(dataset["total"], 3),
                dataset["meta"].get("unit") or "records",
            )
        )
        _say(messages, 
            "The page is one self-contained file: it opens in any browser, "
            "works offline, and exports GIF, video, SHP, GeoJSON, GeoParquet "
            "and CSV."
        )
        if json_path:
            _say(messages, "Also wrote %s" % json_path)

        if by_name.get("add_animation") is not None and _abool(by_name["add_animation"].value):
            self._write_time_layer(dataset, folder, messages)

        if by_name.get("open_page") is not None and _abool(by_name["open_page"].value):
            self._open(out_html)

    def _warn(self, findings, messages):
        """Repeat the findings as warnings when a build fails."""
        if not CORE:
            return
        try:
            text = CORE.findings_text(findings)
        except Exception:
            text = ""
        for line in (text or "").splitlines():
            if line.strip():
                _warn_text(messages, line)

    @staticmethod
    def _open(path):
        try:
            webbrowser.open("file:///" + os.path.abspath(path).replace("\\", "/"))
        except Exception:
            pass

    @staticmethod
    def _workspace():
        try:
            return arcpy.env.workspace
        except Exception:
            return None

    @staticmethod
    def _page_path(folder, name):
        """Where the page goes: the folder, plus the name given or index.html."""
        name = (name or "").strip() or "index.html"
        path = name if os.path.isabs(name) else os.path.join(folder, name)
        root, ext = os.path.splitext(path)
        if not ext:
            path += ".html"
        return path

    def _json_path_out(self, folder, by_name):
        param = by_name.get("out_json")
        wanted = self._text(param) if param is not None else ""
        if not wanted:
            return None
        if wanted.endswith(("/", "\\")) or os.path.isdir(wanted):
            return os.path.join(wanted, "flowmap-dataset.json")
        path = wanted if os.path.isabs(wanted) else os.path.join(folder, wanted)
        if not os.path.splitext(path)[1]:
            path += ".json"
        return path

    # ---------------------------------------------------------------- reading
    @staticmethod
    def _geo(fields):
        """Ask the cursor for longitude/latitude, but only when it returns
        geometry - a plain table has nothing to reproject."""
        if "SHAPE@" not in fields:
            return {}
        try:
            return {"spatial_reference": arcpy.SpatialReference(4326)}
        except Exception:
            return {}

    @staticmethod
    def _clear(param):
        try:
            if hasattr(param, "clearMessage"):
                param.clearMessage()
            else:
                param.setErrorMessage("")
                param.setWarningMessage("")
        except Exception:
            pass

    def _is_points(self, layer):
        try:
            return str(arcpy.Describe(layer).shapeType) in ("Point", "Multipoint", "PointZ", "PointM")
        except Exception:
            return False

    def _read_rows(self, layer, mapping):
        wanted = [mapping.get(role) for role in ROLES_IN_CORE]
        fields = []
        for name in wanted:
            if name and name not in fields:
                fields.append(name)
        is_points = self._is_points(layer)
        use = list(fields) + (["SHAPE@"] if is_points else [])
        rows = []
        try:
            with arcpy.da.SearchCursor(layer, use, **self._geo(use)) as cursor:
                for values in cursor:
                    row = dict(zip(fields, values[: len(fields)]))
                    if is_points:
                        shape = values[-1]
                        point = getattr(shape, "firstPoint", None) if shape is not None else None
                        row["__x"] = getattr(point, "X", None)
                        row["__y"] = getattr(point, "Y", None)
                    rows.append(row)
        except arcpy.ExecuteError:
            raise
        except Exception as err:
            raise arcpy.ExecuteError(
                "The table could not be read with the columns %s: %s: %s"
                % (", ".join(use), type(err).__name__, err)
            )
        if is_points:
            for row in rows:
                if row.get("__x") is not None and not mapping.get("oLon"):
                    mapping["oLon"] = "__x"
                if row.get("__y") is not None and not mapping.get("oLat"):
                    mapping["oLat"] = "__y"
        return rows

    def _read_places(self, layer, name_field, group_field):
        if not name_field:
            raise arcpy.ExecuteError(
                "Choose the name column of the places layer."
            )
        fields = [name_field] + ([group_field] if group_field else [])
        places = []
        use = list(fields) + ["SHAPE@"]
        with arcpy.da.SearchCursor(layer, use, **self._geo(use)) as cursor:
            for values in cursor:
                shape = values[-1]
                point = getattr(shape, "firstPoint", None) if shape is not None else None
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
        """({name: [flat rings]}, tolerance) for one outline layer.

        The detail is chosen from the size of the layer instead of being asked
        for: a thousand districts drawn vertex by vertex make a page nobody can
        open, and nobody wants to think about degrees when they ask for a map.
        """
        out = {}
        use = [name_field, "SHAPE@"]
        count = 0
        with arcpy.da.SearchCursor(layer, use, **self._geo(use)) as cursor:
            for name, shape in cursor:
                if not name or shape is None:
                    continue
                parts = self._parts(shape)
                count += sum(len(part) for part in parts)
                rings = CORE.clean_rings(parts, decimals=5, tolerance=self._tolerance(count))
                if rings:
                    out[str(name)] = rings
        return out, self._tolerance(count)

    @staticmethod
    def _tolerance(vertices):
        """Outline simplification, in degrees, from the amount of geometry."""
        if vertices > 300000:
            return 0.02
        if vertices > 120000:
            return 0.01
        if vertices > 40000:
            return 0.005
        return 0.0

    @staticmethod
    def _parts(geometry):
        parts = []
        try:
            for part in geometry:
                if part is None:
                    continue
                points = [(point.X, point.Y) for point in part if point is not None]
                if points:
                    parts.append(points)
        except TypeError:
            points = [(point.X, point.Y) for point in geometry.getPart()]
            if points:
                parts.append(points)
        return parts

    @staticmethod
    def _find_template():
        folders = [HERE, os.path.dirname(HERE), os.path.join(os.path.dirname(HERE), "arcgis")]
        for folder in folders:
            if not folder:
                continue
            for name in ("index.html", "flow-map.html"):
                candidate = os.path.join(folder, name)
                if os.path.isfile(candidate):
                    return candidate
        return None

    # ------------------------------------------------------------- animation
    def _write_time_layer(self, dataset, folder, messages):
        """The same flows as a time-enabled line layer in the current map.

        A Python toolbox cannot draw in the map, but it can build the layer
        that the map's Time Slider plays: a line feature class with a date
        field and a value, added to the active map with time turned on, and
        saved as a .lyrx next to the page. Every step can fail on its own
        (no project, no 3D Analyst-free geodatabase permission, an older
        build with no time API), so each one is wrapped: the page is already
        written and the tool never loses it over an animation.
        """
        try:
            gdb = os.path.join(folder, "FlowMap.gdb")
            if not self._exists(gdb):
                arcpy.management.CreateFileGDB(folder, "FlowMap.gdb")
            fc = os.path.join(gdb, "flowmap_flows")
            if self._exists(fc):
                arcpy.management.Delete(fc)
            arcpy.management.CreateFeatureclass(
                gdb,
                "flowmap_flows",
                "POLYLINE",
                spatial_reference=arcpy.SpatialReference(4326),
            )
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
                    base = datetime.date(*[int(part) for part in str(start).split("-")[:3]])
                except Exception:
                    base = datetime.date(2000, 1, 1)
            nodes = dataset.get("nodes") or []
            fields = ["SHAPE@", "DAY", "WHEN", "ORIGIN", "DESTINATION", "VALUE"]
            mid = datetime.time(12, 0, 0)
            written = 0
            with arcpy.da.InsertCursor(fc, fields) as cursor:
                for day, start_index, end_index, value in dataset.get("edges") or []:
                    a = nodes[start_index]
                    b = nodes[end_index]
                    points = self._line(a, b)
                    if points is None:
                        continue
                    when = datetime.datetime.combine(
                        base + datetime.timedelta(days=int(day)), mid
                    )
                    cursor.insertRow(
                        [points, int(day), when, str(a[0]), str(b[0]), float(value)]
                    )
                    written += 1
            _say(messages, 
                "Added the flows to a time-enabled layer: %s (%d lines)."
                % (fc, written)
            )
            self._add_to_map(fc, folder, messages)
        except Exception as err:
            _warn_text(messages, 
                "The page is written, but the animation layer could not be built: "
                "%s: %s" % (type(err).__name__, err)
            )

    @staticmethod
    def _exists(path):
        try:
            return bool(arcpy.Exists(path))
        except Exception:
            return os.path.exists(path)

    @staticmethod
    def _line(a, b):
        """A two-point polyline in WGS84, or None when a point is missing."""
        try:
            return arcpy.Polyline(
                arcpy.Array([arcpy.Point(a[2], a[3]), arcpy.Point(b[2], b[3])]),
                arcpy.SpatialReference(4326),
            )
        except Exception:
            return None

    def _add_to_map(self, fc, folder, messages):
        """Add the layer, turn time on, save a layer file. Best effort."""
        layer = None
        try:
            project = arcpy.mp.ArcGISProject("CURRENT")
            target = project.activeMap
            if target is None:
                maps = project.listMaps()
                target = maps[0] if maps else None
            if target is None:
                _warn_text(messages, 
                    "No map is open, so the layer was not added. Add %s to a map "
                    "by hand." % fc
                )
                return
            layer = target.addDataFromPath(fc)
        except Exception as err:
            _warn_text(messages, 
                "The layer was created but not added to the map (%s: %s). "
                "Add %s to a map by hand." % (type(err).__name__, err, fc)
            )
            return

        enabled = self._enable_time(layer)
        if enabled:
            _say(messages, 
                "Time is on for the layer: open the Time Slider on the map and "
                "press play. The Animation tab exports it as a video."
            )
        else:
            _warn_text(messages, 
                "The layer is in the map but time could not be turned on by the "
                'tool. Right-click the layer > Properties > Time and choose the '
                '"WHEN" field as the start time.'
            )
        lyrx = os.path.join(folder, "FlowMap-flows.lyrx")
        try:
            arcpy.management.SaveToLayerFile(layer, lyrx)
            _say(messages, "Saved the layer file %s" % lyrx)
        except Exception:
            pass

    @staticmethod
    def _enable_time(layer):
        """Turn time on, trying the two APIs that exist across Pro versions."""
        try:
            layer.time.enabled = True
            layer.time.startTimeFieldName = "WHEN"
            return True
        except Exception:
            pass
        for call in (
            lambda: layer.enableTime("WHEN"),
            lambda: layer.enableTime(startTimeFieldName="WHEN"),
        ):
            try:
                call()
                return True
            except Exception:
                continue
        return False
