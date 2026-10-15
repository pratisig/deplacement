#!/usr/bin/env python3
"""Drive FlowMap.pyt with tools/arcgis/arcpy_stub.py and check what it does.

    python3 tools/arcgis/toolcheck.py --out /tmp/arcgis/tool-page.html \\
        --json /tmp/arcgis/toolcheck.json

Exits non-zero when a check fails. The JSON it writes is the cross-language
contract the node test compares the loaded page against.
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.machinery
import importlib.util
import json
import os
import sys
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
        ["SITE", "HOUSEHOLDS", "DATE"],
        [
            {"SITE": "Dakar", "HOUSEHOLDS": 50, "DATE": "2026-03-01", "SHAPE@": stub.Geometry([[[-17.4467, 14.6928]]])},
            {"SITE": "Thiès", "HOUSEHOLDS": 20, "DATE": "2026-03-02", "SHAPE@": stub.Geometry([[[-16.9256, 14.7886]]])},
        ],
        shape_type="Point",
    )
    stub.add_layer(
        UNPLACEABLE,
        ["ORIGIN", "DESTINATION", "HOUSEHOLDS"],
        [
            {"ORIGIN": "Nowhere", "DESTINATION": "Elsewhere", "HOUSEHOLDS": 5},
            {"ORIGIN": "Unknown", "DESTINATION": "Nowhere", "HOUSEHOLDS": 5},
        ],
    )


CHECKS = []


def check(label, ok, detail=""):
    CHECKS.append((label, bool(ok), detail))


def run(toolbox_module, out_html, out_json):
    tool = toolbox_module.Toolbox().tools[0]()
    params = tool.getParameterInfo()
    by_name = {p.name: p for p in params}

    def setp(name, value):
        by_name[name].value = value
        by_name[name].altered = True

    # ---- toolbox shape ----------------------------------------------------
    box = toolbox_module.Toolbox()
    check("the toolbox names one tool", box.alias == "flowmap" and len(box.tools) == 1, box.alias)
    check("parameters have unique names", len(by_name) == len(params), len(params))
    order = [p.name for p in params]
    check(
        "the output page is parameter 1, as SetParameterAsText assumes",
        order.index("out_html") == 1,
        order[:3],
    )
    check("the output page is required and is the last write", by_name["out_html"].parameterType == "Required")
    check("lon/lat are optional, so names can be looked up instead", by_name["o_lon"].parameterType == "Optional")
    check("the open-when-done box starts ticked", str(by_name["open_page"].value).lower() == "true")
    check("every parameter has a category", all(p.category for p in params), [p.name for p in params if not p.category])

    # ---- nothing to locate places with ------------------------------------
    setp("flows", FLOWS)
    tool.updateParameters(params)
    check("the mapping is guessed from the column names", by_name["o_name"].value == "ORIGIN", by_name["o_name"].value)
    check("the destination defaults to the origin for one-place tables", by_name["d_name"].value == "DESTINATION", by_name["d_name"].value)
    check("the value column is guessed", by_name["value"].value == "HOUSEHOLDS", by_name["value"].value)
    check("the date column is guessed", by_name["date"].value == "DATE", by_name["date"].value)
    check("the title defaults to the layer name", by_name["title"].value is not None, by_name["title"].value)
    tool.updateMessages(params)
    check(
        "a table with no coordinates and no lookup layer is refused up front",
        bool(by_name["o_name"].errorMessage) and "places layer or an outlines layer" in by_name["o_name"].errorMessage,
        by_name["o_name"].errorMessage,
    )

    # ---- the full run ------------------------------------------------------
    setp("places", PLACES)
    setp("places_name", "CITY")
    setp("places_group", "REGION")
    setp("bounds_fine", DISTRICTS)
    setp("bounds_fine_name", "NAME")
    setp("out_html", out_html)
    setp("out_json", out_json)
    setp("open_page", False)
    setp("title", "Where households moved")
    setp("unit", "households")
    tool.updateMessages(params)
    check("no error once the names can be located", not by_name["o_name"].errorMessage, by_name["o_name"].errorMessage)
    tool.updateParameters(params)
    check("a missing name field on the outlines is refused", not by_name["bounds_fine_name"].errorMessage)

    messages = stub.Messages()
    tool.execute(params, messages)
    check("the page was written", os.path.isfile(out_html), out_html)
    shaped = [c for c in stub.CURSOR_CALLS if "SHAPE@" in c[1]]
    check(
        "every cursor that returns geometry asks for longitude/latitude",
        shaped and all(ref is not None and ref.factoryCode == 4326 for _l, _f, ref in shaped),
        shaped,
    )
    plain = [c for c in stub.CURSOR_CALLS if "SHAPE@" not in c[1]]
    check("a table with no geometry is read as it is", all(ref is None for _l, _f, ref in plain), plain)
    check(
        "the output page is handed back to the tool framework",
        stub.PARAMS_SET == [(1, out_html)],
        stub.PARAMS_SET,
    )
    written_messages = list(stub.MESSAGES)
    written_warnings = list(stub.WARNINGS)
    check("messages say what happened", any("Wrote" in m for m in written_messages), written_messages[-1:])
    check(
        "the unreadable date became a warning, not a failure",
        any("could not be read" in w for w in written_warnings),
        written_warnings,
    )
    with open(out_html, encoding="utf-8") as fh:
        page = fh.read()
    check(
        "exactly one dataset block is embedded",
        page.count("<script data-preload>window.__PRELOAD__=") == 1,
        page.count("<script data-preload>window.__PRELOAD__="),
    )
    check("the block sits before </head>", page.index("data-preload") < page.index("</head>"))
    check("the page still has no external script", "<script src=" not in page)
    with open(out_json, encoding="utf-8") as fh:
        dataset = json.load(fh)
    check("seven places were found", len(dataset["nodes"]) == 7, len(dataset["nodes"]))
    check("seven flows are kept, the zero and the unknown are not", len(dataset["edges"]) == 7, len(dataset["edges"]))
    check("the axis runs over five days", dataset["maxDay"] == 4, dataset["maxDay"])
    check("the total adds up", abs(dataset["total"] - 440) < 1e-9, dataset["total"])
    check("groups come from the places layer", {n[1] for n in dataset["nodes"]} == {"Ouest", "Centre", "Nord", "Sud"}, {n[1] for n in dataset["nodes"]})
    check("the outlines came along", len(dataset.get("admin2", {})) == 7, len(dataset.get("admin2", {})))
    day = {(e[1], e[2]): e[0] for e in dataset["edges"]}
    thiess = [e for e in dataset["edges"] if dataset["nodes"][e[1]][0] == "Thiès" and dataset["nodes"][e[2]][0] == "Diourbel"]
    check("a text date and a real date behave the same", sorted(e[0] for e in thiess) == [1, 2], thiess)
    check("a row with no date lands on day 0", any(e[0] == 0 for e in dataset["edges"]), True)

    # ---- a point layer carries its own coordinates -------------------------
    stub.reset()
    register_layers()  # reset() empties the registry, so put it back
    stub.MESSAGES[:] = []
    stub.WARNINGS[:] = []
    tool2 = toolbox_module.Toolbox().tools[0]()
    p2 = tool2.getParameterInfo()
    b2 = {p.name: p for p in p2}

    def setp2(name, value):
        b2[name].value = value
        b2[name].altered = True

    setp2("flows", POINTS)
    tool2.updateParameters(p2)
    check("a point layer disables the longitude fields", b2["o_lon"].enabled is False)
    setp2("o_name", "SITE")
    setp2("value", "HOUSEHOLDS")
    setp2("date", "DATE")
    point_out = os.path.join(os.path.dirname(out_html), "points.html")
    setp2("out_html", point_out)
    setp2("open_page", False)
    tool2.updateMessages(p2)
    tool2.execute(p2, stub.Messages())
    with open(point_out, encoding="utf-8") as fh:
        point_page = fh.read()
    payload = point_page.split("window.__PRELOAD__=", 1)[1].split(";</script>", 1)[0]
    point_dataset = json.loads(payload.replace("<\\/", "</"))
    check("both points became places", len(point_dataset["nodes"]) == 2, point_dataset["nodes"])
    check(
        "a point table makes one-place records, not flows between two",
        all(e[1] == e[2] for e in point_dataset["edges"]),
        point_dataset["edges"],
    )
    check("the coordinates came from the geometry", point_dataset["nodes"][0][2] < -17 and point_dataset["nodes"][0][3] > 14, point_dataset["nodes"][0])
    check("a point table has no outlines", "admin2" not in point_dataset and "admin1" not in point_dataset)

    # ---- failures are explained, not swallowed ----------------------------
    stub.reset()
    register_layers()
    tool3 = toolbox_module.Toolbox().tools[0]()
    p3 = tool3.getParameterInfo()
    b3 = {p.name: p for p in p3}

    def setp3(name, value):
        b3[name].value = value
        b3[name].altered = True

    setp3("flows", UNPLACEABLE)
    setp3("o_name", "ORIGIN")
    setp3("d_name", "DESTINATION")
    setp3("value", "HOUSEHOLDS")
    setp3("out_html", os.path.join(os.path.dirname(out_html), "never.html"))
    setp3("open_page", False)
    raised = ""
    try:
        tool3.updateParameters(p3)
        tool3.execute(p3, stub.Messages())
    except stub.ExecuteError as err:
        raised = str(err)
    check("an impossible table raises a readable error", "No usable rows" in raised, raised)
    check("and nothing is written when it fails", not os.path.isfile(b3["out_html"].valueAsText))

    stub.reset()
    register_layers()
    tool4 = toolbox_module.Toolbox().tools[0]()
    p4 = tool4.getParameterInfo()
    b4 = {p.name: p for p in p4}
    for name, value in (
        ("flows", FLOWS),
        ("o_name", "ORIGIN"),
        ("d_name", "DESTINATION"),
        ("value", "HOUSEHOLDS"),
        ("date", "DATE"),
        ("places", PLACES),
        ("places_name", "CITY"),
        ("out_html", os.path.join(os.path.dirname(out_html), "never.html")),
        ("open_page", False),
        ("template", os.path.join(os.path.dirname(out_html), "nope.html")),
    ):
        b4[name].value = value
        b4[name].altered = True
    raised = ""
    try:
        tool4.updateMessages(p4)
        tool4.execute(p4, stub.Messages())
    except stub.ExecuteError as err:
        raised = str(err)
    check("a missing template is named in the error", "No page template found" in raised, raised)
    check("a message from an earlier pass is cleared", not b4["o_name"].errorMessage)

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

    failed = [c for c in CHECKS if not c[1]]
    for label, ok, detail in CHECKS:
        print(("  ok   " if ok else "  FAIL ") + label + ("" if ok else "  -> " + str(detail)))
    print("%d of %d checks ok" % (len(CHECKS) - len(failed), len(CHECKS)))

    if args.report:
        with open(args.report, "w", encoding="utf-8") as fh:
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
                fh,
                ensure_ascii=False,
                indent=1,
            )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
