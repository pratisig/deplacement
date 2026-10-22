# -*- coding: utf-8 -*-
"""FlowMap installation doctor.

Run it with the Python of ArcGIS Pro (Python Command Prompt) or any Python 3:

    python check_install.py

It checks that the files sit side by side, that the engine and the toolbox are
the same build, that the toolbox's 12 column parameters are Pro "Field"
drop-downs bound to a table, and that the boundary services can be reached.
"""

import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
failed = 0


def ok(label, detail=""):
    print("  ok    " + label + ("  (%s)" % detail if detail else ""))


def bad(label, detail=""):
    global failed
    failed += 1
    print("  FAIL  " + label + ("  -> %s" % detail if detail else ""))


def main():
    for name in ("FlowMap.pyt", "flowmap_core.py", "index.html"):
        (ok if os.path.isfile(os.path.join(HERE, name)) else bad)("file " + name)

    core = None
    try:
        spec = importlib.util.spec_from_file_location("flowmap_core", os.path.join(HERE, "flowmap_core.py"))
        core = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(core)
        ok("engine loads", core.__version__)
    except Exception as err:
        bad("engine loads", repr(err))

    try:
        import arcpy  # noqa: F401

        ok("arcpy is available")
        have_arcpy = True
    except Exception:
        print("  --    arcpy not found: toolbox checks skipped (run this in ArcGIS Pro's Python)")
        have_arcpy = False

    if have_arcpy:
        from importlib.machinery import SourceFileLoader

        try:
            module = SourceFileLoader("flowmap_toolbox", os.path.join(HERE, "FlowMap.pyt")).load_module()
            (ok if module.CORE is not None else bad)("toolbox and engine are the same build", module.CORE_ERROR)
            params = module.BuildFlowMapPage().getParameterInfo()
            fields = [p for p in params if p.datatype == "Field"]
            good = [p for p in fields if list(p.parameterDependencies or [])]
            (ok if fields and len(good) == len(fields) else bad)(
                "column parameters are Field drop-downs bound to a table", "%d of %d" % (len(good), len(fields))
            )
        except Exception as err:
            bad("toolbox loads", repr(err))

    if core is not None:
        try:
            raw = core._http(core.GEOBOUNDARIES_API % ("YEM", "ADM1"), timeout=20)
            json.loads(raw.decode("utf-8"))
            ok("geoBoundaries is reachable")
        except Exception as err:
            bad("geoBoundaries is reachable (needed the first time, per country)", repr(err))
        try:
            found = core.countries_of_points([(44.2, 15.4)])
            (ok if found == ["YEM"] else bad)("country detection from coordinates", ",".join(found))
        except Exception as err:
            bad("country detection from coordinates", repr(err))

    print("\n%s" % ("All checks passed." if not failed else "%d check(s) failed." % failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
