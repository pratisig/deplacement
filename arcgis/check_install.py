#!/usr/bin/env python3
"""Check the FlowMap toolbox installation, and show the error Pro hides.

    "C:\\Program Files\\ArcGIS\\Pro\\bin\\Python\\envs\\arcgispro-py3\\python.exe" check_install.py

Run it from the folder holding FlowMap.pyt. It prints one line per thing it
checks, the full parameter layout, and - when something fails - the complete
traceback, which the Geoprocessing pane cuts down to a red cross.

Off Windows, without ArcGIS Pro, it can still check everything that does not
need arcpy:

    python3 check_install.py --stub ../tools/arcgis
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
PYT = os.path.join(HERE, "FlowMap.pyt")
CORE = os.path.join(HERE, "flowmap_core.py")
TOOLBOX_XML = os.path.join(HERE, "FlowMap.pyt.xml")
TOOL_XML = os.path.join(HERE, "FlowMap.BuildFlowMapPage.pyt.xml")

RESULTS = []


def ok(label, detail=""):
    detail = str(detail)
    RESULTS.append((True, label, detail))
    print("  ok   " + label + ((" -> " + detail) if detail else ""))


def bad(label, detail=""):
    detail = str(detail)
    RESULTS.append((False, label, detail))
    print("  FAIL " + label + ((" -> " + detail) if detail else ""))


def check(label, condition, detail=""):
    if condition:
        ok(label, detail)
    else:
        bad(label, detail)
    return bool(condition)


def load_core(path=CORE):
    """Load flowmap_core.py by path, under a name of its own.

    The same rule the toolbox follows: import by name can pick up a copy left
    in another toolbox folder, and then you are debugging the wrong engine.
    """
    import importlib.util

    name = "flowmap_core_check__%s" % abs(hash(path))
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def install_stub(folder):
    """Make `import arcpy` find the stand-in, off Windows."""
    import importlib.util
    import types

    stub_path = os.path.join(folder, "arcpy_stub.py")
    spec = importlib.util.spec_from_file_location("arcpy_stub", stub_path)
    stub = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(stub)
    module = types.ModuleType("arcpy")
    for name in dir(stub):
        if not name.startswith("__"):
            setattr(module, name, getattr(stub, name))
    sys.modules["arcpy"] = module
    return stub


def load_toolbox():
    import importlib.machinery
    import importlib.util

    loader = importlib.machinery.SourceFileLoader("FlowMapToolboxCheck", PYT)
    spec = importlib.util.spec_from_loader("FlowMapToolboxCheck", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def check_files():
    print("\nThe files")
    for path, what in (
        (PYT, "the toolbox"),
        (CORE, "the engine"),
        (TOOLBOX_XML, "the toolbox help"),
        (TOOL_XML, "the parameter help"),
    ):
        check(
            "%s: %s" % (what, os.path.basename(path)),
            os.path.isfile(path),
            "" if os.path.isfile(path) else "missing from %s" % HERE,
        )


def check_pyt():
    print("\nThe toolbox file")
    if not os.path.isfile(PYT):
        return None
    with open(PYT, "rb") as handle:
        raw = handle.read()
    check("it is pure ASCII (a non-ASCII character stops Pro loading it)", all(b < 128 for b in raw),
          "byte %d" % next((i for i, b in enumerate(raw) if b > 127), -1))
    check("it has no byte-order mark", not raw.startswith(b"\xef\xbb\xbf"))
    check("it parses", _parses(raw))
    check(
        "it loads its engine by path, not by name",
        b"_load_core(" in raw and b"\nimport flowmap_core" not in raw and b"    import flowmap_core" not in raw,
    )
    return raw


def _parses(raw):
    try:
        compile(raw.decode("utf-8"), PYT, "exec")
        return True
    except SyntaxError:
        return False


def check_help(parameters):
    print("\nThe parameter help (the information buttons)")
    if not os.path.isfile(TOOL_XML):
        return
    with open(TOOL_XML, "r", encoding="utf-8") as handle:
        text = handle.read()
    count = text.count("<dialogReference>")
    check("one help entry per parameter", count == len(parameters), "%d for %d parameters" % (count, len(parameters)))
    empty = [
        name
        for name, *_rest in parameters
        if 'name="%s"' % name in text and "<dialogReference></dialogReference>" in text.split('name="%s"' % name, 1)[1].split("</param>", 1)[0]
    ]
    check("no help entry is empty", not empty, ", ".join(empty))


def layout(parameters, by_name=None):
    print("\nThe parameter layout (%d parameters)" % len(parameters))
    for name, label, kind, required, direction, category in parameters:
        param = by_name.get(name) if by_name else None
        datatype = getattr(param, "datatype", None) if param is not None else kind
        if isinstance(datatype, list):
            datatype = datatype[0]
        control = ""
        if kind == "COLUMN":
            filter_type = str(getattr(getattr(param, "filter", None), "type", "") or "")
            count = len(list(getattr(getattr(param, "filter", None), "list", None) or []))
            control = ("drop-down" if filter_type == "ValueList" else "TEXT BOX") + " (%d)" % count
        print(
            "    %-18s %-28s %-10s %-8s %-14s%s"
            % (
                name,
                label[:28],
                str(datatype)[:10],
                "required" if required else "optional",
                control,
                (" [%s]" % category) if category else "",
            )
        )


def check_dialog(stub):
    print("\nThe dialog")
    module = load_toolbox()
    tool = module.Toolbox().tools[0]()
    parameters = tool.getParameterInfo()
    by_name = {param.name: param for param in parameters}
    layout(module.PARAMETERS, by_name)
    check("all %d parameters are built" % len(module.PARAMETERS), len(parameters) == len(module.PARAMETERS))
    check("the output is a folder that can be browsed", str(by_name["out_folder"].datatype) == "DEFolder")
    columns = [name for name, _l, kind, _r, _d, _c in module.PARAMETERS if kind == "COLUMN"]
    check(
        "every column is a drop-down the tool fills itself",
        all(getattr(by_name[name].filter, "type", None) == "ValueList" for name in columns),
        ", ".join(name for name in columns if getattr(by_name[name].filter, "type", None) != "ValueList"),
    )
    check(
        "no required parameter is hidden in a category",
        all(not param.category for param in parameters if param.parameterType == "Required"),
    )
    text_boxes = [
        name
        for name in columns
        if str(getattr(by_name[name].filter, "type", "")) != "ValueList"
    ]
    check(
        "every column parameter's filter type is ValueList (a text box means Pro ignored it)",
        not text_boxes,
        ", ".join(text_boxes),
    )
    check(
        "every column drop-down already holds something to choose",
        all(list(getattr(by_name[name].filter, "list", None) or []) for name in columns),
        ", ".join(name for name in columns if not list(getattr(by_name[name].filter, "list", None) or [])),
    )
    check(
        "and they are enabled, so Pro draws their arrow",
        all(by_name[name].enabled is not False for name in columns),
        ", ".join(name for name in columns if by_name[name].enabled is False),
    )
    ok("%d column drop-downs, all of them value lists" % len(columns))
    check_help(module.PARAMETERS)
    return module, tool, parameters, by_name


def check_build(core, stub, tool, parameters, by_name, toolbox_module=None):
    print("\nA small build")
    folder = tempfile.mkdtemp(prefix="flowmap-check-")
    page = os.path.join(folder, "page.html")
    stub.add_layer(
        "check_table",
        ["ORIGIN", "DESTINATION", "HOUSEHOLDS", "DATE", "LON_O", "LAT_O", "LON_D", "LAT_D"],
        [
            {"ORIGIN": "A", "DESTINATION": "B", "HOUSEHOLDS": 12, "DATE": "2026-01-01", "LON_O": 5.0, "LAT_O": 10.0, "LON_D": 6.0, "LAT_D": 11.0},
            {"ORIGIN": "B", "DESTINATION": "C", "HOUSEHOLDS": 8, "DATE": "2026-01-02", "LON_O": 6.0, "LAT_O": 11.0, "LON_D": 7.0, "LAT_D": 10.5},
            {"ORIGIN": "A", "DESTINATION": "C", "HOUSEHOLDS": 3, "DATE": "02/01/2026", "LON_O": 5.0, "LAT_O": 10.0, "LON_D": 7.0, "LAT_D": 10.5},
        ],
    )
    by_name["flows"].value = "check_table"
    by_name["flows"].altered = True
    # the columns are chosen, as a user must: the tool offers them and fills
    # nothing in, on purpose (a guess is invisible, so a wrong one is silent)
    for name, column in (
        ("o_name", "ORIGIN"),
        ("d_name", "DESTINATION"),
        ("value", "HOUSEHOLDS"),
        ("date", "DATE"),
        ("o_lon", "LON_O"),
        ("o_lat", "LAT_O"),
        ("d_lon", "LON_D"),
        ("d_lat", "LAT_D"),
    ):
        by_name[name].value = column
        by_name[name].altered = True
    by_name["out_folder"].value = folder
    by_name["page_name"].value = "page.html"
    by_name["open_page"].value = False
    by_name["add_animation"].value = False
    tool.updateParameters(parameters)
    tool.updateMessages(parameters)
    tool.execute(parameters, stub.Messages())
    check("a small build writes a page", os.path.isfile(page), "%s (%s kB)" % (page, os.path.getsize(page) // 1024 if os.path.isfile(page) else 0))
    if os.path.isfile(page):
        with open(page, encoding="utf-8") as handle:
            text = handle.read()
        check("the page is self-contained", "<script src=" not in text)
        check(
            "the dataset is embedded once",
            text.count("<script data-preload>window.__PRELOAD__=") == 1,
            str(text.count("<script data-preload>window.__PRELOAD__=")),
        )
    warnings = list(getattr(stub, "WARNINGS", []))
    check("the build reports its warnings", True, warnings[0] if warnings else "none")
    check("the core names itself", bool(getattr(core, "__version__", "")), str(getattr(core, "__version__", "")))
    toolbox_version = str(getattr(toolbox_module, "CORE_VERSION", "") or "")
    check(
        "the toolbox and the engine are the same build",
        toolbox_version == str(getattr(core, "__version__", "")),
        "engine %s against toolbox %s" % (getattr(core, "__version__", ""), toolbox_version or "?"),
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--stub", help="folder holding arcpy_stub.py (to check without ArcGIS Pro)")
    args = parser.parse_args(argv)

    print("Flow map toolbox - installation check")
    print("folder: %s" % HERE)
    print("python: %s" % sys.version.split()[0])

    check_files()
    raw = check_pyt()

    core = None
    print("\nThe engine")
    if os.path.isfile(CORE):
        try:
            core = load_core()
            ok("it imports (by path, like the toolbox)", os.path.basename(CORE))
            ok("its version", str(getattr(core, "__version__", "-")))
            if hasattr(core, "selftest"):
                import io
                from contextlib import redirect_stdout

                buffer = io.StringIO()
                with redirect_stdout(buffer):
                    failed = core.selftest()
                tally = [line for line in buffer.getvalue().splitlines() if "checks ok" in line]
                check("its own checks pass", failed == 0, tally[-1] if tally else "")
        except Exception:
            bad("it imports", "traceback below")
            traceback.print_exc()

    if raw is not None and core is not None:
        stub = None
        if args.stub:
            try:
                stub = install_stub(args.stub)
                ok("the arcpy stand-in is installed", args.stub)
            except Exception:
                bad("the arcpy stand-in is installed", args.stub)
                traceback.print_exc()
        else:
            try:
                import arcpy  # noqa: F401

                ok("arcpy is available (this is ArcGIS Pro's Python)")
            except Exception:
                bad(
                    "arcpy is available",
                    "run this with Pro's Python, or add --stub <folder> to check the rest",
                )
        if stub is None:
            try:
                import arcpy as _arcpy

                stub = _arcpy
            except Exception:
                stub = None
        if stub is not None:
            try:
                module, tool, parameters, by_name = check_dialog(stub)
                check_build(core, stub, tool, parameters, by_name, module)
            except Exception:
                bad("the dialog and a build", "traceback below")
                traceback.print_exc()

    failed = [entry for entry in RESULTS if not entry[0]]
    print("")
    if failed:
        print("%d check(s) failed out of %d. The traceback above is the part" % (len(failed), len(RESULTS)))
        print("ArcGIS Pro hides; send it as it is.")
        return 1
    print("everything the toolbox needs is here (%d checks)." % len(RESULTS))
    if not args.stub:
        print("Add a layer, open the tool, and press Run.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
