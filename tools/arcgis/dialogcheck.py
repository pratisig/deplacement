#!/usr/bin/env python3
"""Check that every column parameter really is a drop-down, on every dataset.

    python3 tools/arcgis/dialogcheck.py

`toolcheck.py` proves the tool works. This proves the *pane* works: that each
column parameter is a value list, that the list holds the columns of the
dataset chosen above it, that the list follows the dataset when it changes,
and that a value picked from the list is accepted by the validation - on a
feature table, a standalone table, a point layer, a shapefile and a layer
added from a JSON file (where ArcGIS Pro's own field control gives nothing).

The checks are written from the user's side of the dialog: what is in the
drop-down, and what happens when you click an item in it.
"""

from __future__ import annotations

import argparse
import importlib.machinery
import importlib.util
import json
import os
import sys
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

import arcpy_stub as stub  # noqa: E402

CHECKS = []


def check(label, ok, detail=""):
    CHECKS.append((label, bool(ok), "" if ok else str(detail)))


def install_stub():
    module = types.ModuleType("arcpy")
    for name in dir(stub):
        if not name.startswith("__"):
            setattr(module, name, getattr(stub, name))
    sys.modules["arcpy"] = module
    return module


def load_toolbox():
    loader = importlib.machinery.SourceFileLoader("FlowMapToolboxDialog", os.path.join(ROOT, "arcgis", "FlowMap.pyt"))
    spec = importlib.util.spec_from_loader("FlowMapToolboxDialog", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


# The table from the failed run, with the column names as they are in it.
SYNTHESE = [
    "Village",
    "CSI_CASE",
    "MILDA_distribuees",
    "Besoins_estimes_1_MILDA_2_personnes",
    "Lon_dept",
    "Lat_dept",
    "Longitude_rep",
    "Latitude_rep",
]


def register():
    stub.reset()
    # a feature table, no geometry
    stub.add_layer(
        "/project/flows",
        ["ORIGIN", "DESTINATION", "HOUSEHOLDS", "DATE", "REGION"],
        [
            {"ORIGIN": "Dakar", "DESTINATION": "Thiès", "HOUSEHOLDS": 120, "DATE": "2026-01-14", "REGION": "Ouest"},
            {"ORIGIN": "Thiès", "DESTINATION": "Diourbel", "HOUSEHOLDS": 45, "DATE": "2026-01-15", "REGION": "Centre"},
        ],
    )
    # a standalone table with nothing in common with it
    stub.add_layer(
        "/project/districts",
        ["NAME", "CODE", "POPULATION"],
        [{"NAME": "Dakar", "CODE": "DK", "POPULATION": 3500000}],
    )
    # a point layer: SHAPE is a column Pro lists, and must not be offered
    stub.add_layer(
        "/project/points",
        ["SITE", "HOUSEHOLDS", "DATE", "SHAPE"],
        [{"SITE": "Dakar", "HOUSEHOLDS": 50, "DATE": "2026-03-01"}],
        shape_type="Point",
    )
    # a shapefile: OBJECTID and SHAPE are listed by Pro, SHAPE must be dropped
    stub.add_layer(
        "/project/villages",
        ["OBJECTID", "VILLAGE", "MENAGES", "SHAPE"],
        [{"OBJECTID": 1, "VILLAGE": "Touba", "MENAGES": 120}],
        shape_type="Point",
    )
    # the eight columns of the table that failed in the field
    stub.add_layer(
        "/project/synthese",
        SYNTHESE,
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
            }
        ],
    )


def write_json_layer(folder):
    """The layer added from a JSON file, as Pro describes it."""
    path = os.path.join(folder, "_Synthese_villages_.json")
    feature = {
        "type": "Feature",
        "properties": {
            "Village": "Touba",
            "CSI_CASE": "CSI-001",
            "MILDA_distribuees": 120,
            "Besoins_estimes_1_MILDA_2_personnes": 400,
            "Lon_dept": -16.92,
            "Lat_dept": 14.79,
            "Longitude_rep": -16.45,
            "Latitude_rep": 14.42,
        },
        "geometry": {"type": "Point", "coordinates": [-16.92, 14.79]},
    }
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"type": "FeatureCollection", "features": [feature]}, handle)
    return path


def fresh_tool(module):
    tool = module.Toolbox().tools[0]()
    params = tool.getParameterInfo()
    return tool, params, {p.name: p for p in params}


def columns_of(module):
    return [name for name, _label, kind, _r, _d, _c in module.PARAMETERS if kind == "COLUMN"]


# The eight column parameters whose list comes from the flow table. The four
# others belong to the places layer and the two outline layers.
FLOW_COLUMNS = ("o_name", "d_name", "value", "date", "o_lon", "o_lat", "d_lon", "d_lat")


def check_shape(module, label, dataset, expected, disabled=()):
    """One dataset, from choosing it to clicking in every drop-down."""
    tool, params, by_name = fresh_tool(module)
    by_name["flows"].value = dataset
    by_name["flows"].altered = True
    tool.updateParameters(params)

    for name in columns_of(module):
        if name not in FLOW_COLUMNS:
            check(
                "%s: %s stays shut, its dataset is not chosen" % (label, name),
                by_name[name].filter.list == [""] and by_name[name].enabled is False,
                (by_name[name].filter.list, by_name[name].enabled),
            )

    columns = FLOW_COLUMNS
    for name in columns:
        param = by_name[name]
        kind = getattr(param.filter, "type", None)
        check("%s: %s is a value list" % (label, name), kind == "ValueList", kind)
        listable = getattr(param.filter, "list", None) or []
        check(
            "%s: %s offers the table's columns" % (label, name),
            listable == [""] + list(expected),
            listable,
        )
        if name in disabled:
            check("%s: %s is greyed out" % (label, name), param.enabled is False, param.enabled)
        else:
            check("%s: %s is open" % (label, name), param.enabled is True, param.enabled)

    # click every item of every list, as a user would, and check each is accepted
    for name in columns:
        param = by_name[name]
        for item in (getattr(param.filter, "list", None) or [])[1:]:
            param.value = item
            param.altered = True
            tool.updateMessages(params)
            check(
                "%s: choosing %r in %s raises nothing" % (label, item, name),
                not (param.errorMessage and "is not a column" in str(param.errorMessage)),
                param.errorMessage,
            )
        param.value = None
        param.altered = False
    return by_name


def check_type_survives(module):
    """A replaced list must not leave a column parameter as a text box.

    Pro keeps a filter's type and its list apart, and puts the type back to
    "Any" when the list is replaced while it is empty. A parameter whose type
    is "Any" is a text box - which is what the pane showed on the real run,
    with the values filled in and no drop-down arrow in sight. So this is
    checked directly: break the type, run a pass, and demand it back.
    """
    print("\nThe filter type survives a list change")
    tool, params, by_name = fresh_tool(module)
    by_name["flows"].value = "/project/synthese"
    by_name["flows"].altered = True
    tool.updateParameters(params)
    for name in FLOW_COLUMNS:
        param = by_name[name]
        param.filter.type = "Any"  # what Pro does to a filter it rebuilds
        tool.updateParameters(params)
        check(
            "%s is a value list again after the type was reset" % name,
            str(param.filter.type) == "ValueList",
            param.filter.type,
        )
        param.filter.list = []  # and what an empty rebuild leaves behind
        tool.updateParameters(params)
        check(
            "%s keeps its columns after an empty rebuild" % name,
            param.filter.list == [""] + SYNTHESE and str(param.filter.type) == "ValueList",
            (param.filter.list, param.filter.type),
        )
    check(
        "the empty entry is still first, so a column can be cleared",
        by_name["value"].filter.list[0] == "",
        by_name["value"].filter.list[:1],
    )


def check_follows(module):
    """Changing the dataset must change the list, and drop what is gone."""
    print("\nThe list follows the dataset")
    tool, params, by_name = fresh_tool(module)
    by_name["flows"].value = "/project/flows"
    by_name["flows"].altered = True
    tool.updateParameters(params)
    by_name["value"].value = "HOUSEHOLDS"
    by_name["value"].altered = True
    check(
        "a chosen column survives a pass with no change",
        by_name["value"].value == "HOUSEHOLDS",
        by_name["value"].value,
    )
    by_name["flows"].value = "/project/districts"
    tool.updateParameters(params)
    check(
        "the list is replaced by the new table's columns",
        by_name["value"].filter.list == [""] + ["NAME", "CODE", "POPULATION"],
        by_name["value"].filter.list,
    )
    check(
        "a column the new table lacks is cleared",
        by_name["value"].value in (None, ""),
        by_name["value"].value,
    )
    check(
        "the value list never holds a None or a number",
        all(isinstance(item, str) for item in by_name["value"].filter.list),
        by_name["value"].filter.list,
    )
    check(
        "the empty entry comes first, so a column can be cleared",
        by_name["value"].filter.list[0] == "",
        by_name["value"].filter.list[:1],
    )


def check_reopen(module):
    """Opening the tool again on a table: the lists must already be full.

    ArcGIS Pro does not promise to call updateParameters when a dialog opens
    with the values of the previous run; updateMessages is the call that is
    made. If only updateParameters filled the lists, the pane would come back
    with a table chosen and empty drop-downs - the very thing to avoid.
    """
    print("\nReopening the tool on a table")
    tool, params, by_name = fresh_tool(module)
    by_name["flows"].value = "/project/synthese"
    by_name["flows"].altered = True
    # deliberately no updateParameters(): this is the call Pro makes on open
    tool.updateMessages(params)
    check(
        "updateMessages alone fills the drop-downs",
        by_name["o_name"].filter.list == [""] + SYNTHESE,
        by_name["o_name"].filter.list,
    )
    check(
        "and the pane is not told the columns are missing",
        not by_name["o_name"].errorMessage,
        by_name["o_name"].errorMessage,
    )


def check_places_columns(module):
    """A second dataset brings its own drop-downs - places and outlines."""
    print("\nThe places and outlines columns")
    tool, params, by_name = fresh_tool(module)
    by_name["flows"].value = "/project/flows"
    by_name["flows"].altered = True
    tool.updateParameters(params)
    check(
        "the places columns are shut with no places layer",
        by_name["places_name"].filter.list == [""] and by_name["places_name"].enabled is False,
        (by_name["places_name"].filter.list, by_name["places_name"].enabled),
    )
    by_name["places"].value = "/project/points"
    tool.updateParameters(params)
    check(
        "choosing a places layer fills its own drop-down",
        by_name["places_name"].filter.list == [""] + ["SITE", "HOUSEHOLDS", "DATE"],
        by_name["places_name"].filter.list,
    )
    check(
        "and it is open",
        by_name["places_name"].enabled is True,
        by_name["places_name"].enabled,
    )
    by_name["bounds_fine"].value = "/project/villages"
    tool.updateParameters(params)
    check(
        "a shapefile's SHAPE column is not offered",
        by_name["bounds_fine_name"].filter.list == [""] + ["OBJECTID", "VILLAGE", "MENAGES"],
        by_name["bounds_fine_name"].filter.list,
    )
    check(
        "the flow table's own drop-downs are untouched by that",
        by_name["o_name"].filter.list == [""] + ["ORIGIN", "DESTINATION", "HOUSEHOLDS", "DATE", "REGION"],
        by_name["o_name"].filter.list,
    )


def run():
    register()
    folder = tempfile.mkdtemp(prefix="flowmap-dialog-")
    write_json_layer(folder)
    module = load_toolbox()

    print("\nEvery dataset, every column drop-down")
    check_shape(module, "table", "/project/flows", ["ORIGIN", "DESTINATION", "HOUSEHOLDS", "DATE", "REGION"])
    check_shape(
        module,
        "standalone table",
        "/project/districts",
        ["NAME", "CODE", "POPULATION"],
    )
    check_shape(
        module,
        "point layer",
        "/project/points",
        ["SITE", "HOUSEHOLDS", "DATE"],
        disabled=("o_lon", "o_lat", "d_lon", "d_lat"),
    )
    check_shape(
        module,
        "shapefile",
        "/project/villages",
        ["OBJECTID", "VILLAGE", "MENAGES"],
        disabled=("o_lon", "o_lat", "d_lon", "d_lat"),
    )
    check_shape(module, "the field table", "/project/synthese", SYNTHESE)

    # the layer that made the pane show empty text boxes
    print("\nA layer added from a JSON file")
    previous = stub.env.workspace
    stub.env.workspace = folder
    try:
        check_shape(module, "JSON layer", "CIMPATH=Map/_Synthese_villages_.json", SYNTHESE)
    finally:
        stub.env.workspace = previous

    check_type_survives(module)
    check_follows(module)
    check_reopen(module)
    check_places_columns(module)
    return module


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.parse_args(argv)
    install_stub()
    run()
    failed = [entry for entry in CHECKS if not entry[1]]
    for label, ok, detail in CHECKS:
        print(("  ok   " if ok else "  FAIL ") + label + ("" if ok else "  -> " + detail))
    print("%d of %d checks ok" % (len(CHECKS) - len(failed), len(CHECKS)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
