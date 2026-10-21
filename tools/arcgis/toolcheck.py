#!/usr/bin/env python3
"""Drive FlowMap.pyt with tools/arcgis/arcpy_stub.py and check what it does.

    python3 tools/arcgis/toolcheck.py --out /tmp/arcgis/tool-page.html \\
        --json /tmp/arcgis/toolcheck.json

Exits non-zero when a check fails. The JSON it writes is the cross-language
contract the node test compares the loaded page against.

The checks are the user's complaints, turned into assertions: a column list
that stays empty, a folder that cannot be browsed, a value column that holds
no number, two coordinate columns read the wrong way round, a name field that
blocks the dialog for nothing, and an animation that never reaches the map.
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.machinery
import importlib.util
import json
import os
import re
import sys
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(HERE))

import arcpy_stub as stub  # noqa: E402

FLOWS = "/project/flows"
PLACES = "/project/places"
DISTRICTS = "/project/districts"
POINTS = "/project/points"
UNPLACEABLE = "/project/unplaceable"
TEXT_VALUE = "/project/synthese_villages"
SWAPPED = "/project/swapped"
ONE_POINT = "/project/synthese_villages_one_point"

CHECKS = []


def check(label, ok, detail=""):
    CHECKS.append((label, bool(ok), detail if not ok else ""))


def install_stub():
    """Make `import arcpy` in the toolbox find the stand-in."""
    module = types.ModuleType("arcpy")
    for name in dir(stub):
        if not name.startswith("__"):
            setattr(module, name, getattr(stub, name))
    sys.modules["arcpy"] = module
    return module


def load_toolbox(path):
    loader = importlib.machinery.SourceFileLoader("FlowMapToolbox", path)
    spec = importlib.util.spec_from_loader("FlowMapToolbox", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def register_layers():
    """The project the checks run against: four tables and a JSON layer."""
    stub.reset()
    stub.add_layer(
        FLOWS,
        ["ORIGIN", "DESTINATION", "HOUSEHOLDS", "DATE", "REGION"],
        [
            {"ORIGIN": "Dakar", "DESTINATION": "Thiès", "HOUSEHOLDS": 120, "DATE": dt.datetime(2026, 1, 14), "REGION": "Ouest"},
            {"ORIGIN": "Dakar", "DESTINATION": "Thiès", "HOUSEHOLDS": 80, "DATE": dt.datetime(2026, 1, 15), "REGION": "Ouest"},
            {"ORIGIN": "Thiès", "DESTINATION": "Diourbel", "HOUSEHOLDS": 45, "DATE": "15/01/2026", "REGION": "Centre"},
            {"ORIGIN": "Thiès", "DESTINATION": "Diourbel", "HOUSEHOLDS": 60, "DATE": "2026-01-16", "REGION": "Centre"},
            {"ORIGIN": "Saint-Louis", "DESTINATION": "Louga", "HOUSEHOLDS": 70, "DATE": "2026-01-17", "REGION": "Nord"},
            {"ORIGIN": "Louga", "DESTINATION": "Diourbel", "HOUSEHOLDS": 35, "DATE": "2026-01-17", "REGION": "Nord"},
            {"ORIGIN": "Kaolack", "DESTINATION": "Tambacounda", "HOUSEHOLDS": 0, "DATE": "2026-01-18", "REGION": "Centre"},
            {"ORIGIN": "Kaolack", "DESTINATION": "Kolda", "HOUSEHOLDS": 25, "DATE": "2026-01-18", "REGION": "Centre"},
            {"ORIGIN": "Ziguinchor", "DESTINATION": "Thiès", "HOUSEHOLDS": 30, "DATE": "not a date", "REGION": "Sud"},
        ],
    )
    stub.add_layer(
        PLACES,
        ["CITY", "REGION"],
        [
            {"CITY": "Dakar", "REGION": "Ouest", "SHAPE@": stub.Geometry([[[-17.4467, 14.6928]]])},
            {"CITY": "Thiès", "REGION": "Ouest", "SHAPE@": stub.Geometry([[[-16.9256, 14.7886]]])},
            {"CITY": "Diourbel", "REGION": "Centre", "SHAPE@": stub.Geometry([[[-16.2325, 14.6544]]])},
            {"CITY": "Saint-Louis", "REGION": "Nord", "SHAPE@": stub.Geometry([[[-16.4896, 16.0326]]])},
            {"CITY": "Louga", "REGION": "Nord", "SHAPE@": stub.Geometry([[[-15.6142, 15.6144]]])},
            {"CITY": "Kaolack", "REGION": "Centre", "SHAPE@": stub.Geometry([[[-16.1656, 14.1652]]])},
            {"CITY": "Ziguinchor", "REGION": "Sud", "SHAPE@": stub.Geometry([[[-16.2733, 12.5833]]])},
        ],
        shape_type="Point",
    )

    def square(lon, lat, name):
        return {
            "NAME": name,
            "SHAPE@": stub.Geometry([[[lon - 0.4, lat - 0.35], [lon + 0.4, lat - 0.35], [lon + 0.4, lat + 0.35], [lon - 0.4, lat + 0.35], [lon - 0.4, lat - 0.35]]]),
        }

    stub.add_layer(
        DISTRICTS,
        ["NAME"],
        [
            square(-17.4467, 14.6928, "Dakar"),
            square(-16.9256, 14.7886, "Thiès"),
            square(-16.2325, 14.6544, "Diourbel"),
            square(-16.4896, 16.0326, "Saint-Louis"),
            square(-15.6142, 15.6144, "Louga"),
            square(-16.1656, 14.1652, "Kaolack"),
            square(-16.2733, 12.5833, "Ziguinchor"),
        ],
        shape_type="Polygon",
    )
    stub.add_layer(
        POINTS,
        ["SITE", "HOUSEHOLDS", "DATE", "SHAPE@"],
        [
            {"SITE": "Dakar", "HOUSEHOLDS": 50, "DATE": "2026-03-01", "SHAPE@": stub.Geometry([[[-17.4467, 14.6928]]])},
            {"SITE": "Thiès", "HOUSEHOLDS": 30, "DATE": "2026-03-02", "SHAPE@": stub.Geometry([[[-16.9256, 14.7886]]])},
        ],
        shape_type="Point",
    )
    stub.add_layer(
        UNPLACEABLE,
        ["ORIGIN", "DESTINATION", "HOUSEHOLDS"],
        [
            {"ORIGIN": "Nowhere", "DESTINATION": "Elsewhere", "HOUSEHOLDS": 5},
            {"ORIGIN": "Ailleurs", "DESTINATION": "Nulle-Part", "HOUSEHOLDS": 7},
        ],
    )
    # the table from the failed run: a case number where a count was wanted,
    # a village name, and two coordinate pairs whose names do not cross
    stub.add_layer(
        TEXT_VALUE,
        [
            "Village",
            "CSI_CASE",
            "MILDA_distribuees",
            "Besoins_estimes_1_MILDA_2_personnes",
            "Lon_dept",
            "Lat_dept",
            "Longitude_rep",
            "Latitude_rep",
        ],
        [
            {
                "Village": "Touba",
                "CSI_CASE": "CSI-001",
                "MILDA_distribuees": 120,
                "Besoins_estimes_1_MILDA_2_personnes": 400,
                "Lon_dept": -16.92,
                "Lat_dept": 14.79,
                "Longitude_rep": -16.45,
                "Latitude_rep": 14.42,
            },
            {
                "Village": "Mbacke",
                "CSI_CASE": "CSI-014",
                "MILDA_distribuees": 80,
                "Besoins_estimes_1_MILDA_2_personnes": 260,
                "Lon_dept": -15.90,
                "Lat_dept": 14.79,
                "Longitude_rep": -15.75,
                "Latitude_rep": 14.60,
            },
            {
                "Village": "Bambey",
                "CSI_CASE": "CSI-095",
                "MILDA_distribuees": 45,
                "Besoins_estimes_1_MILDA_2_personnes": 120,
                "Lon_dept": -16.46,
                "Lat_dept": 14.70,
                "Longitude_rep": -16.30,
                "Latitude_rep": 14.55,
            },
        ],
    )
    # the field table, exactly: one point per row, so every flow starts where
    # it ends and the build has a warning to report
    stub.add_layer(
        ONE_POINT,
        [
            "Village",
            "Menages",
            "Longitude_rep",
            "Latitude_rep",
            "Lon_dept",
            "Lat_dept",
        ],
        [
            {
                "Village": "Dantchiao",
                "Menages": 593,
                "Longitude_rep": 9.09208,
                "Latitude_rep": 12.87795,
                "Lon_dept": 9.09208,
                "Lat_dept": 12.87795,
            },
            {
                "Village": "Garin Madja",
                "Menages": 413,
                "Longitude_rep": 9.07573,
                "Latitude_rep": 12.90398,
                "Lon_dept": 9.07573,
                "Lat_dept": 12.90398,
            },
            {
                "Village": "Kayaka",
                "Menages": 374,
                "Longitude_rep": 9.04356,
                "Latitude_rep": 12.89652,
                "Lon_dept": 9.04356,
                "Lat_dept": 12.89652,
            },
            {
                "Village": "Kioché",
                "Menages": 337,
                "Longitude_rep": 9.03288,
                "Latitude_rep": 12.85948,
                "Lon_dept": 9.03288,
                "Lat_dept": 12.85948,
            },
        ],
    )
    # coordinates whose column names lie about their axis
    stub.add_layer(
        SWAPPED,
        ["ORIGIN", "DESTINATION", "Longitude_orig", "Latitude_orig", "Longitude_dest", "Latitude_dest"],
        [
            {"ORIGIN": "Touba", "DESTINATION": "Mbacke", "Longitude_orig": -16.92, "Latitude_orig": 14.79, "Longitude_dest": 14.42, "Latitude_dest": -16.45},
            {"ORIGIN": "Mbacke", "DESTINATION": "Bambey", "Longitude_orig": -15.90, "Latitude_orig": 14.79, "Longitude_dest": 14.55, "Latitude_dest": -16.30},
            {"ORIGIN": "Bambey", "DESTINATION": "Touba", "Longitude_orig": -16.46, "Latitude_orig": 14.70, "Longitude_dest": 14.79, "Latitude_dest": -16.92},
        ],
    )


def write_json_layer(folder):
    """A GeoJSON file, to stand for the layer added from JSON in Pro."""
    path = os.path.join(folder, "_Synthese_villages_.json")
    data = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "Village": "Touba",
                    "CSI_CASE": "CSI-001",
                    "MILDA_distribuees": 120,
                    "Lon_dept": -16.92,
                    "Lat_dept": 14.79,
                    "Longitude_rep": -16.45,
                    "Latitude_rep": 14.42,
                },
                "geometry": {"type": "Point", "coordinates": [-16.92, 14.79]},
            }
        ],
    }
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle)
    return path


def setp(by_name, name, value):
    by_name[name].value = value
    by_name[name].altered = True


def dialog_checks(module, tool, params, by_name):
    """What the pane shows before any data is chosen."""
    names = [prop[0] for prop in module.PARAMETERS]
    check("the dialog has 28 parameters, as documented", len(params) == 28, len(params))
    check("their names are the documented order", [p.name for p in params] == names, [p.name for p in params])
    check(
        "only two parameters are required: the table and the folder",
        [p.name for p in params if p.parameterType == "Required"] == ["flows", "out_folder"],
        [p.name for p in params if p.parameterType == "Required"],
    )
    check(
        "no required parameter sits in a category",
        all(not p.category for p in params if p.parameterType == "Required"),
        [(p.name, p.category) for p in params if p.parameterType == "Required" and p.category],
    )
    check(
        "the output is a folder, so the pane browses to it",
        str(by_name["out_folder"].datatype) == "DEFolder" and by_name["out_folder"].direction == "Output",
        (by_name["out_folder"].datatype, by_name["out_folder"].direction),
    )
    check("the page name defaults to index.html", by_name["page_name"].value == "index.html", by_name["page_name"].value)
    check(
        "the page name is not a required field",
        by_name["page_name"].parameterType == "Optional",
        by_name["page_name"].parameterType,
    )
    columns = [name for name, _label, kind, _r, _d, _c in module.PARAMETERS if kind == "COLUMN"]
    check("there are twelve column parameters", len(columns) == 12, columns)
    check(
        "every column parameter is a drop-down, not a field control",
        all(
            str(getattr(by_name[name], "datatype", "")) == "GPString"
            and getattr(by_name[name].filter, "type", None) == "ValueList"
            for name in columns
        ),
        [(name, by_name[name].datatype, getattr(by_name[name].filter, "type", None)) for name in columns],
    )
    check(
        "no column parameter asks Pro for a Field",
        all("Field" not in str(by_name[name].datatype) for name in columns),
        [name for name in columns if "Field" in str(by_name[name].datatype)],
    )
    check(
        "the column drop-downs are shut until a dataset is chosen",
        all(by_name[name].enabled is False for name in columns),
        [name for name in columns if by_name[name].enabled],
    )
    check("the template filter is HTML", by_name["template"].filter.list == ["html", "htm"], by_name["template"].filter.list)
    check("the dataset filter is JSON", by_name["out_json"].filter.list == ["json"], by_name["out_json"].filter.list)
    check("the open-when-done box starts ticked", str(by_name["open_page"].value).lower() == "true")
    check("the animation box starts ticked", str(by_name["add_animation"].value).lower() == "true")
    check(
        "the coordinate fields are optional: names can be looked up instead",
        all(by_name[name].parameterType == "Optional" for name in ("o_lon", "o_lat", "d_lon", "d_lat")),
    )
    check(
        "the name fields are optional too: coordinates are enough",
        all(by_name[name].parameterType == "Optional" for name in ("o_name", "d_name")),
    )
    check(
        "only the optional groups carry categories",
        sorted({p.category for p in params if p.category})
        == sorted(["Places and outlines", "Text on the page", "More options"]),
        sorted({p.category for p in params if p.category}),
    )
    check(
        "every parameter has a help text",
        all(str(module.HELP.get(prop[0], "")).strip() for prop in module.PARAMETERS),
        [prop[0] for prop in module.PARAMETERS if not str(module.HELP.get(prop[0], "")).strip()],
    )
    check(
        "the help covers exactly the parameters",
        sorted(module.HELP) == sorted(names),
        sorted(set(module.HELP) ^ set(names)),
    )
    with open(os.path.join(ROOT, "arcgis", "FlowMap.pyt"), "rb") as handle:
        raw = handle.read()
    check("the toolbox is pure ASCII", all(byte < 128 for byte in raw), [i for i, b in enumerate(raw) if b > 127][:5])
    check("the toolbox has no BOM", not raw.startswith(b"\xef\xbb\xbf"))


def column_checks(tool, params, by_name, json_folder):
    """The drop-downs, the guessing and the wording, on the real tables."""
    setp(by_name, "flows", FLOWS)
    tool.updateParameters(params)
    check(
        "choosing a table fills its column drop-downs",
        by_name["o_name"].filter.list == [""] + ["ORIGIN", "DESTINATION", "HOUSEHOLDS", "DATE", "REGION"],
        by_name["o_name"].filter.list,
    )
    check("the drop-down is open once there is a table", by_name["o_name"].enabled is True)
    check(
        "the places columns stay shut until a places layer is chosen",
        by_name["places_name"].filter.list == [""] and by_name["places_name"].enabled is False,
        (by_name["places_name"].filter.list, by_name["places_name"].enabled),
    )
    check("the origin field is guessed from the column names", by_name["o_name"].value == "ORIGIN", by_name["o_name"].value)
    check("the destination field too", by_name["d_name"].value == "DESTINATION", by_name["d_name"].value)
    check("the value field too", by_name["value"].value == "HOUSEHOLDS", by_name["value"].value)
    check("the date field too", by_name["date"].value == "DATE", by_name["date"].value)
    check("the guessed columns are inside the list", by_name["value"].value in by_name["value"].filter.list)
    check(
        "the title defaults to the table name, cleaned up",
        str(by_name["title"].value or "").lower() == "flows",
        by_name["title"].value,
    )
    check(
        "the unit is deduced from the value column",
        str(by_name["unit"].value or "").lower() == "households",
        by_name["unit"].value,
    )

    # the places layer brings its own column list
    setp(by_name, "places", PLACES)
    tool.updateParameters(params)
    check(
        "choosing a places layer fills its name column",
        by_name["places_name"].filter.list == [""] + ["CITY", "REGION"],
        by_name["places_name"].filter.list,
    )
    check("and the group column", by_name["places_group"].filter.list == [""] + ["CITY", "REGION"])
    check("a column of the new table is not carried over blindly", by_name["places_name"].value in (None, "", "CITY"), by_name["places_name"].value)

    # a layer added from a JSON file: Pro's own field control stays empty,
    # this tool reads the file and fills the list
    json_layer = "CIMPATH=Map/_Synthese_villages_.json"
    previous = stub.env.workspace
    stub.env.workspace = json_folder
    tool2 = tool.__class__()
    params2 = tool2.getParameterInfo()
    by2 = {p.name: p for p in params2}
    try:
        setp(by2, "flows", json_layer)
        tool2.updateParameters(params2)
        check(
            "a JSON layer still gets a column list",
            "Village" in by2["o_name"].filter.list and "CSI_CASE" in by2["o_name"].filter.list,
            by2["o_name"].filter.list,
        )
        check(
            "and its columns are guessed, not typed",
            by2["o_name"].value == "Village" and by2["value"].value == "MILDA_distribuees",
            (by2["o_name"].value, by2["value"].value),
        )
        check(
            "the coordinate columns are pre-filled for the JSON layer",
            (by2["o_lon"].value, by2["d_lon"].value) == ("Lon_dept", "Longitude_rep"),
            (by2["o_lon"].value, by2["d_lon"].value),
        )
    finally:
        stub.env.workspace = previous

    # a column that the new table does not have is dropped
    setp(by_name, "flows", DISTRICTS)
    tool.updateParameters(params)
    check(
        "switching tables drops a column the new table does not have",
        by_name["date"].value in (None, "", "DATE"),
        by_name["date"].value,
    )
    check(
        "the old column is gone from the list",
        "HOUSEHOLDS" not in by_name["o_name"].filter.list,
        by_name["o_name"].filter.list,
    )
    setp(by_name, "flows", POINTS)
    tool.updateParameters(params)
    check("a point layer disables the coordinate fields", by_name["o_lon"].enabled is False)
    check(
        "a point layer still lists its own columns",
        by_name["o_name"].filter.list == [""] + ["SITE", "HOUSEHOLDS", "DATE"],
        by_name["o_name"].filter.list,
    )


def warning_path_checks(module, out_dir):
    """A run whose data produces a warning must not die on the warning.

    The field traceback:

        File "FlowMap.pyt", line 1107, in execute
          messages.addWarningText(warning)
        AttributeError: MessagesObject: Get attribute: s does not exist

    ``addWarningText`` is not part of the Messages object ArcGIS Pro hands to
    execute(); the stand-in accepted it, so nothing caught it until a real
    table produced the first warning - after the run had already read the
    rows. The page was never written.
    """
    tool = module.Toolbox().tools[0]()
    params = tool.getParameterInfo()
    by_name = {p.name: p for p in params}
    setp(by_name, "flows", ONE_POINT)
    setp(by_name, "out_folder", out_dir)
    setp(by_name, "page_name", "one-point.html")
    setp(by_name, "open_page", False)
    setp(by_name, "add_animation", False)
    tool.updateParameters(params)
    tool.updateMessages(params)
    check(
        "the identical coordinate pairs are warned about before the run",
        bool(by_name["d_lon"].warningMessage),
        by_name["d_lon"].warningMessage,
    )
    stub.WARNINGS[:] = []
    stub.MESSAGES[:] = []
    raised = None
    try:
        tool.execute(params, stub.Messages())
    except Exception as err:  # noqa: BLE001 - the point is that this is empty
        raised = "%s: %s" % (type(err).__name__, err)
    check("a warning never fails the run", raised is None, raised)
    check(
        "the warning reaches the messages",
        any("start and end at the same point" in line for line in stub.WARNINGS),
        stub.WARNINGS,
    )
    check(
        "and the page is still written",
        os.path.isfile(os.path.join(out_dir, "one-point.html")),
    )
    check(
        "no call uses a method the Messages object does not have",
        not re.search(r"messages\s*\.\s*addWarningText\s*\(", open(os.path.join(ROOT, "arcgis", "FlowMap.pyt"), encoding="utf-8").read()),
    )


def failing_table_checks(module, out_dir):
    """The table that failed in the field: a case number as the value."""
    tool = module.Toolbox().tools[0]()
    params = tool.getParameterInfo()
    by_name = {p.name: p for p in params}
    setp(by_name, "flows", TEXT_VALUE)
    tool.updateParameters(params)
    check(
        "the failing table is guessed with its count, not its case number",
        by_name["value"].value == "MILDA_distribuees",
        by_name["value"].value,
    )
    check(
        "the village column names both ends",
        (by_name["o_name"].value, by_name["d_name"].value) == ("Village", "Village"),
        (by_name["o_name"].value, by_name["d_name"].value),
    )
    check(
        "the two coordinate pairs are read in the right order",
        (by_name["o_lon"].value, by_name["o_lat"].value, by_name["d_lon"].value, by_name["d_lat"].value)
        == ("Lon_dept", "Lat_dept", "Longitude_rep", "Latitude_rep"),
        (by_name["o_lon"].value, by_name["o_lat"].value, by_name["d_lon"].value, by_name["d_lat"].value),
    )
    check("no date is invented from 'estimes'", by_name["date"].value in (None, ""), by_name["date"].value)

    # choose the case number by hand, as the run did
    setp(by_name, "value", "CSI_CASE")
    setp(by_name, "out_folder", out_dir)
    tool.updateParameters(params)
    tool.updateMessages(params)
    check(
        "a value column with no number is refused under the parameter",
        bool(by_name["value"].errorMessage) and "CSI_CASE" in by_name["value"].errorMessage,
        by_name["value"].errorMessage,
    )
    check(
        "the error shows what the column holds",
        bool(by_name["value"].errorMessage) and "CSI-001" in by_name["value"].errorMessage,
        by_name["value"].errorMessage,
    )
    raised = ""
    try:
        tool.execute(params, stub.Messages())
    except stub.ExecuteError as err:
        raised = str(err)
    check(
        "running it anyway fails by name, not with a blank page",
        "CSI_CASE" in raised and "no number" in raised,
        raised,
    )
    check(
        "and the findings are repeated as warnings",
        any("CSI_CASE" in w for w in stub.WARNINGS),
        stub.WARNINGS,
    )
    check("nothing is written when it fails", not os.path.isfile(os.path.join(out_dir, "index.html")))

    # the same table, with the count chosen: it builds
    tool2 = module.Toolbox().tools[0]()
    params2 = tool2.getParameterInfo()
    by2 = {p.name: p for p in params2}
    setp(by2, "flows", TEXT_VALUE)
    setp(by2, "out_folder", out_dir)
    setp(by2, "page_name", "villages.html")
    setp(by2, "open_page", False)
    setp(by2, "add_animation", False)
    tool2.updateParameters(params2)
    tool2.updateMessages(params2)
    page = os.path.join(out_dir, "villages.html")
    tool2.execute(params2, stub.Messages())
    check("the failing table builds once a real count is chosen", os.path.isfile(page), page)


def swapped_checks(module, out_dir):
    """Two coordinate columns whose names lie about their axis."""
    tool = module.Toolbox().tools[0]()
    params = tool.getParameterInfo()
    by_name = {p.name: p for p in params}
    setp(by_name, "flows", SWAPPED)
    setp(by_name, "out_folder", out_dir)
    setp(by_name, "page_name", "swapped.html")
    setp(by_name, "open_page", False)
    setp(by_name, "add_animation", False)
    tool.updateParameters(params)
    check(
        "the names alone put the coordinates the wrong way round",
        (by_name["d_lon"].value, by_name["d_lat"].value) == ("Longitude_dest", "Latitude_dest"),
        (by_name["d_lon"].value, by_name["d_lat"].value),
    )
    json_out = os.path.join(out_dir, "swapped.json")
    setp(by_name, "out_json", json_out)
    tool.execute(params, stub.Messages())
    with open(json_out, encoding="utf-8") as handle:
        dataset = json.load(handle)
    dest = {node[0]: node for node in dataset["nodes"]}
    check(
        "the numbers decide: the destinations land on the map",
        all(-18 < node[2] < -13 and 12 < node[3] < 16 for node in dest.values()),
        dataset["nodes"],
    )
    check(
        "and the swap is reported, not silent",
        any("wrong way round" in w for w in stub.WARNINGS),
        stub.WARNINGS,
    )


def run(module, out_html, out_json):
    """The whole tool, on the project that stands in for ArcGIS Pro."""
    stub.reset()
    register_layers()
    out_dir = os.path.dirname(os.path.abspath(out_html))
    # a GeoJSON file for the "layer added from JSON" case, in its own folder
    json_folder = tempfile.mkdtemp(prefix="flowmap-json-")
    write_json_layer(json_folder)

    tool = module.Toolbox().tools[0]()
    params = tool.getParameterInfo()
    by_name = {p.name: p for p in params}
    dialog_checks(module, tool, params, by_name)
    column_checks(tool, params, by_name, json_folder)

    # ---- a run from a folder and a name --------------------------------
    tool = module.Toolbox().tools[0]()
    params = tool.getParameterInfo()
    by_name = {p.name: p for p in params}
    setp(by_name, "flows", FLOWS)
    setp(by_name, "out_folder", out_dir)
    setp(by_name, "page_name", os.path.basename(out_html))
    setp(by_name, "out_json", out_json)
    setp(by_name, "open_page", False)
    setp(by_name, "add_animation", False)
    setp(by_name, "title", "Where households moved")
    setp(by_name, "places", PLACES)
    setp(by_name, "places_name", "CITY")
    setp(by_name, "places_group", "REGION")
    setp(by_name, "bounds_fine", DISTRICTS)
    setp(by_name, "bounds_fine_name", "NAME")
    tool.updateParameters(params)
    tool.updateMessages(params)
    check("a fully mapped table raises no error", not any(p.errorMessage for p in params), [(p.name, p.errorMessage) for p in params if p.errorMessage])

    tool.execute(params, stub.Messages())
    check("the page was written where the folder says", os.path.isfile(out_html), out_html)
    check(
        "the output folder is handed back to the framework",
        stub.PARAMS_SET == [(1, out_dir)],
        stub.PARAMS_SET,
    )
    check(
        "a bare name gets .html",
        tool._page_path(out_dir, "report") == os.path.join(out_dir, "report.html"),
        tool._page_path(out_dir, "report"),
    )
    check(
        "an empty name means index.html",
        tool._page_path(out_dir, "") == os.path.join(out_dir, "index.html"),
        tool._page_path(out_dir, ""),
    )
    shaped = [call for call in stub.CURSOR_CALLS if "SHAPE@" in call[1]]
    check(
        "every cursor that returns geometry asks for longitude/latitude",
        shaped and all(ref is not None and ref.factoryCode == 4326 for _l, _f, ref in shaped),
        shaped,
    )
    plain = [call for call in stub.CURSOR_CALLS if "SHAPE@" not in call[1]]
    check("a table with no geometry is read as it is", all(ref is None for _l, _f, ref in plain), plain)
    written_messages = list(stub.MESSAGES)
    written_warnings = list(stub.WARNINGS)
    check("messages say what happened", any("Wrote" in line for line in written_messages), written_messages[-1:])
    check(
        "the unreadable date became a warning, not a failure",
        any("could not be read" in line for line in written_warnings),
        written_warnings,
    )
    with open(out_html, encoding="utf-8") as handle:
        page = handle.read()
    check(
        "exactly one dataset block is embedded",
        page.count("<script data-preload>window.__PRELOAD__=") == 1,
    )
    check("the block sits before </head>", page.index("data-preload") < page.index("</head>"))
    check("the page still has no external script", "<script src=" not in page)
    with open(out_json, encoding="utf-8") as handle:
        dataset = json.load(handle)
    check("seven places were found", len(dataset["nodes"]) == 7, len(dataset["nodes"]))
    check("seven flows are kept, the zero and the unknown are not", len(dataset["edges"]) == 7, len(dataset["edges"]))
    check("the axis runs over five days", dataset["maxDay"] == 4, dataset["maxDay"])
    check("the total adds up", abs(dataset["total"] - 440) < 1e-9, dataset["total"])
    check("the unit was deduced from the value column", dataset["meta"]["unit"] == "households", dataset["meta"]["unit"])
    check(
        "groups come from the places layer",
        {node[1] for node in dataset["nodes"]} == {"Ouest", "Centre", "Nord", "Sud"},
        {node[1] for node in dataset["nodes"]},
    )
    check("the outlines came along", len(dataset.get("admin2", {})) == 7, len(dataset.get("admin2", {})))
    thiess = [edge for edge in dataset["edges"] if dataset["nodes"][edge[1]][0] == "Thiès" and dataset["nodes"][edge[2]][0] == "Diourbel"]
    check("a text date and a real date behave the same", sorted(edge[0] for edge in thiess) == [1, 2], thiess)
    check("a row with no date lands on day 0", any(edge[0] == 0 for edge in dataset["edges"]))
    check(
        "the animation layer is not built when the box is unticked",
        not any(name == "CreateFeatureclass" for name, _args, _kw in stub.CALLS),
        stub.CALLS,
    )

    # ---- a point layer carries its own coordinates ----------------------
    stub.reset()
    register_layers()
    tool2 = module.Toolbox().tools[0]()
    p2 = tool2.getParameterInfo()
    b2 = {p.name: p for p in p2}
    setp(b2, "flows", POINTS)
    setp(b2, "out_folder", out_dir)
    setp(b2, "page_name", "points.html")
    setp(b2, "open_page", False)
    setp(b2, "add_animation", False)
    tool2.updateParameters(p2)
    setp(b2, "o_name", "SITE")
    setp(b2, "value", "HOUSEHOLDS")
    setp(b2, "date", "DATE")
    tool2.updateMessages(p2)
    tool2.execute(p2, stub.Messages())
    with open(os.path.join(out_dir, "points.html"), encoding="utf-8") as handle:
        point_page = handle.read()
    payload = point_page.split("window.__PRELOAD__=", 1)[1].split(";</script>", 1)[0]
    point_dataset = json.loads(payload.replace("<\\/", "</"))
    check("both points became places", len(point_dataset["nodes"]) == 2, point_dataset["nodes"])
    check(
        "a point table makes one-place records, not flows between two",
        all(edge[1] == edge[2] for edge in point_dataset["edges"]),
        point_dataset["edges"],
    )
    check(
        "the coordinates came from the geometry",
        point_dataset["nodes"][0][2] < -17 and point_dataset["nodes"][0][3] > 14,
        point_dataset["nodes"][0],
    )
    check("a point table has no outlines", "admin2" not in point_dataset and "admin1" not in point_dataset)

    # ---- the animation layer -------------------------------------------
    stub.reset()
    register_layers()
    stub.MP_PROJECT = True
    anim_dir = os.path.join(out_dir, "anim")
    os.makedirs(anim_dir, exist_ok=True)
    tool3 = module.Toolbox().tools[0]()
    p3 = tool3.getParameterInfo()
    b3 = {p.name: p for p in p3}
    setp(b3, "flows", FLOWS)
    setp(b3, "out_folder", anim_dir)
    setp(b3, "open_page", False)
    setp(b3, "add_animation", True)
    setp(b3, "places", PLACES)
    setp(b3, "places_name", "CITY")
    for name in ("o_name", "d_name", "value", "date"):
        if b3[name].value:
            b3[name].altered = True
    tool3.updateParameters(p3)
    tool3.updateMessages(p3)
    tool3.execute(p3, stub.Messages())
    fc = os.path.join(anim_dir, "FlowMap.gdb", "flowmap_flows")
    check("a file geodatabase was created for the animation", fc in stub.CREATED, list(stub.CREATED))
    check(
        "the line layer carries the fields the Time Slider needs",
        stub.FIELDS.get(fc) == ["DAY", "WHEN", "ORIGIN", "DESTINATION", "VALUE"],
        stub.FIELDS.get(fc),
    )
    rows = stub.INSERTED.get(fc) or []
    check("one line per flow", len(rows) == 7, len(rows))
    check("each line has a shape", all(hasattr(row[0], "points") and len(row[0].points) == 2 for row in rows), rows[:1])
    check(
        "the date field is a real date on the axis",
        all(isinstance(row[2], dt.datetime) for row in rows)
        and min(row[2] for row in rows) >= dt.datetime(2026, 1, 14),
        rows[:1],
    )
    layer = stub.mp.project.activeMap.layers[0] if stub.mp.project.activeMap.layers else None
    check("the layer was added to the map", layer is not None and layer.path == fc, layer.path if layer else None)
    check("time is on for the layer", bool(layer and layer.time.enabled), layer.time.enabled if layer else None)
    check(
        "the time field is the WHEN column",
        bool(layer and layer.time.startTimeFieldName == "WHEN"),
        layer.time.startTimeFieldName if layer else None,
    )
    check(
        "a layer file is saved next to the page",
        os.path.join(anim_dir, "FlowMap-flows.lyrx") in stub.LAYER_FILES,
        stub.LAYER_FILES,
    )
    check(
        "the tool says how to play it",
        any("Time Slider" in line for line in stub.MESSAGES),
        stub.MESSAGES[-3:],
    )
    stub.MP_PROJECT = False

    # ---- without a project the page is still written --------------------
    stub.reset()
    register_layers()
    tool4 = module.Toolbox().tools[0]()
    p4 = tool4.getParameterInfo()
    b4 = {p.name: p for p in p4}
    setp(b4, "flows", FLOWS)
    setp(b4, "out_folder", out_dir)
    setp(b4, "page_name", "nomap.html")
    setp(b4, "open_page", False)
    setp(b4, "add_animation", True)
    setp(b4, "places", PLACES)
    setp(b4, "places_name", "CITY")
    for name in ("o_name", "d_name", "value", "date"):
        b4[name].value = None
        b4[name].altered = False
    tool4.updateParameters(p4)
    tool4.execute(p4, stub.Messages())
    check("the page is written when no map can take the layer", os.path.isfile(os.path.join(out_dir, "nomap.html")))
    check(
        "and the missing map is reported as a warning",
        any("map" in line.lower() for line in stub.WARNINGS),
        stub.WARNINGS,
    )

    # ---- failures are explained, not swallowed -------------------------
    stub.reset()
    register_layers()
    tool5 = module.Toolbox().tools[0]()
    p5 = tool5.getParameterInfo()
    b5 = {p.name: p for p in p5}
    setp(b5, "flows", UNPLACEABLE)
    setp(b5, "o_name", "ORIGIN")
    setp(b5, "d_name", "DESTINATION")
    setp(b5, "value", "HOUSEHOLDS")
    setp(b5, "out_folder", out_dir)
    setp(b5, "page_name", "never.html")
    setp(b5, "open_page", False)
    setp(b5, "add_animation", False)
    raised = ""
    try:
        tool5.updateParameters(p5)
        tool5.updateMessages(p5)
        tool5.execute(p5, stub.Messages())
    except stub.ExecuteError as err:
        raised = str(err)
    check("an impossible table raises a readable error", "No usable rows" in raised, raised)
    check(
        "the error says what to add",
        "longitude" in raised.lower() or "boundary" in raised.lower(),
        raised,
    )
    check("and nothing is written when it fails", not os.path.isfile(os.path.join(out_dir, "never.html")))

    stub.reset()
    register_layers()
    tool6 = module.Toolbox().tools[0]()
    p6 = tool6.getParameterInfo()
    b6 = {p.name: p for p in p6}
    for name, value in (
        ("flows", FLOWS),
        ("out_folder", out_dir),
        ("page_name", "never.html"),
        ("o_name", "ORIGIN"),
        ("d_name", "DESTINATION"),
        ("value", "HOUSEHOLDS"),
        ("date", "DATE"),
        ("places", PLACES),
        ("places_name", "CITY"),
        ("open_page", False),
        ("add_animation", False),
        ("template", os.path.join(out_dir, "nope.html")),
    ):
        setp(b6, name, value)
    raised = ""
    try:
        tool6.updateMessages(p6)
        tool6.execute(p6, stub.Messages())
    except stub.ExecuteError as err:
        raised = str(err)
    check("a missing template is named in the error", "No page template found" in raised, raised)
    check("a message from an earlier pass is cleared", not b6["o_name"].errorMessage, b6["o_name"].errorMessage)

    # an empty output folder is refused by name
    tool7 = module.Toolbox().tools[0]()
    p7 = tool7.getParameterInfo()
    b7 = {p.name: p for p in p7}
    setp(b7, "flows", FLOWS)
    raised = ""
    try:
        tool7.execute(p7, stub.Messages())
    except stub.ExecuteError as err:
        raised = str(err)
    check("no output folder is refused by name", "output folder" in raised.lower(), raised)

    # the engine missing is a message, not a crash
    saved = module.CORE
    module.CORE = None
    raised = ""
    try:
        tool7.execute(p7, stub.Messages())
    except stub.ExecuteError as err:
        raised = str(err)
    module.CORE = saved
    check("a missing engine is explained", "flowmap_core.py" in raised, raised)

    # a new toolbox left beside an old engine: a mix that builds the old page
    # with no complaint, so it is refused by name, here and when it runs
    folder_ = tempfile.mkdtemp()
    pyt = os.path.join(folder_, "FlowMap.pyt")
    with open(os.path.join(ROOT, "arcgis", "FlowMap.pyt"), "r", encoding="utf-8") as fh:
        source = fh.read()
    with open(pyt, "w", encoding="utf-8") as fh:
        fh.write(source)
    with open(os.path.join(ROOT, "arcgis", "flowmap_core.py"), "r", encoding="utf-8") as fh:
        core_text = fh.read()
    old_version = "6.4"
    with open(os.path.join(folder_, "flowmap_core.py"), "w", encoding="utf-8") as fh:
        fh.write(re.sub(r'__version__ = "[^"]*"', '__version__ = "%s"' % old_version, core_text, count=1))
    mixed = load_toolbox(pyt)
    check("an old engine beside a new toolbox is refused", mixed.CORE is None, mixed.CORE_ERROR)
    check(
        "the two versions are named",
        old_version in mixed.CORE_ERROR and mixed.CORE_VERSION in mixed.CORE_ERROR,
        mixed.CORE_ERROR,
    )
    tool8 = mixed.Toolbox().tools[0]()
    p8 = tool8.getParameterInfo()
    check("the dialog still builds", len(p8) > 0, len(p8))
    mixed_by_name = {p.name: p for p in p8}
    setp(mixed_by_name, "flows", FLOWS)
    tool8.updateMessages(p8)
    check(
        "and the reason is shown next to the table",
        old_version in str(mixed_by_name["flows"].warningMessage),
        mixed_by_name["flows"].warningMessage,
    )
    raised = ""
    try:
        tool8.execute(p8, stub.Messages())
    except stub.ExecuteError as err:
        raised = str(err)
    check("running the mix says what to do", "Unzip the whole FlowMap folder" in raised, raised)

    # ---- a warning must not kill the run ------------------------------
    stub.reset()
    register_layers()
    warning_path_checks(module, out_dir)

    # ---- the table that failed in the field ----------------------------
    stub.reset()
    register_layers()
    failing_table_checks(module, out_dir)

    # ---- coordinates whose names lie -----------------------------------
    stub.reset()
    register_layers()
    swapped_checks(module, out_dir)

    return dataset, written_messages, written_warnings


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", required=True, help="where the toolbox writes its page")
    parser.add_argument("--json", required=True, help="where the toolbox writes its dataset")
    parser.add_argument("--report", help="where to write the observed facts as JSON")
    args = parser.parse_args(argv)

    install_stub()
    register_layers()
    folder = os.path.dirname(os.path.abspath(args.out))
    if folder and not os.path.isdir(folder):
        os.makedirs(folder)
    module = load_toolbox(os.path.join(ROOT, "arcgis", "FlowMap.pyt"))
    dataset, messages, warnings = run(module, args.out, args.json)

    failed = [entry for entry in CHECKS if not entry[1]]
    for label, ok, detail in CHECKS:
        print(("  ok   " if ok else "  FAIL ") + label + ("" if ok else "  -> " + str(detail)))
    print("%d of %d checks ok" % (len(CHECKS) - len(failed), len(CHECKS)))

    if args.report:
        with open(args.report, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "page": os.path.abspath(args.out),
                    "json": os.path.abspath(args.json),
                    "meta": dataset["meta"],
                    "nodes": len(dataset["nodes"]),
                    "edges": len(dataset["edges"]),
                    "maxDay": dataset["maxDay"],
                    "total": dataset["total"],
                    "messages": messages,
                    "warnings": warnings,
                },
                handle,
                ensure_ascii=False,
                indent=1,
            )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
