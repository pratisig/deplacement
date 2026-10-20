#!/usr/bin/env python3
"""Write the two XML files that give the FlowMap toolbox its help.

    python3 tools/arcgis/build-help.py            # write them, dated today
    python3 tools/arcgis/build-help.py --check    # fail if they are out of date
    python3 tools/arcgis/build-help.py --date 20261020

ArcGIS Pro reads a Python toolbox's documentation from XML files associated
with the toolbox *by name*, next to the .pyt:

    FlowMap.pyt.xml                        the toolbox itself
    FlowMap.BuildFlowMapPage.pyt.xml       one per tool class in the .pyt

Each <param> carries the text the information button shows in the
Geoprocessing pane. A .pyt cannot set that text from inside itself, so it is
generated here from the PARAMETERS table and the HELP dictionary of
FlowMap.pyt - parsed with ast, so no arcpy and no Pro are needed, and the
file is never imported.
"""

from __future__ import annotations

import argparse
import ast
import datetime
import os
import sys
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
PYT = os.path.join(ROOT, "arcgis", "FlowMap.pyt")

TOOLBOX_FILE = "FlowMap.pyt.xml"
TOOL_FILE = "FlowMap.BuildFlowMapPage.pyt.xml"

# The datatype written in the XML does not drive the dialog - the .pyt does
# that - but it is what Pro shows in the documentation, so it should be the
# honest one.
DATATYPES = {
    "TABLE": "GPTableView",
    "LAYER": "GPFeatureLayer",
    "COLUMN": "GPString",
    "FOLDER": "DEFolder",
    "FILE": "DEFile",
    "TEXT": "GPString",
    "BOOL": "GPBoolean",
}


def read_pyt(path=PYT):
    """PARAMETERS, HELP and the Toolbox/Tool strings, without importing."""
    with open(path, "r", encoding="utf-8") as handle:
        tree = ast.parse(handle.read(), filename=path)
    found = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name):
            continue
        if target.id in ("PARAMETERS", "HELP"):
            found[target.id] = ast.literal_eval(node.value)
    if "PARAMETERS" not in found:
        raise SystemExit("%s has no PARAMETERS table" % path)
    if "HELP" not in found:
        found["HELP"] = {}
    return found["PARAMETERS"], found["HELP"]


def date_stamp(when=None):
    when = when or datetime.date.today()
    return when.strftime("%Y%m%d")


def esri_block(created, modified):
    return (
        "  <Esri>\n"
        "    <CreaDate>%s</CreaDate>\n"
        "    <CreaTime>00000000</CreaTime>\n"
        "    <ArcGISFormat>1.0</ArcGISFormat>\n"
        "    <SyncOnce>TRUE</SyncOnce>\n"
        "    <ModDate>%s</ModDate>\n"
        "    <ModTime>00000000</ModTime>\n"
        "  </Esri>\n" % (created, modified)
    )


def toolbox_xml(created, modified):
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<metadata xml:lang="en">\n'
        + esri_block(created, modified)
        + '  <toolbox name="FlowMap.pyt" displayname="Flow map" alias="flowmap">\n'
        "    <summary>One self-contained, offline flow-map page from a table in "
        "the project.</summary>\n"
        "    <description>Reads a flow table, resolves the places from columns or "
        "from a points or outlines layer, and writes one HTML file that draws an "
        "animated flow map. Every column is chosen from a drop-down of the "
        "table's own columns. The page works offline, needs no API key, and "
        "exports GIF, video, SHP, GeoJSON, GeoParquet and CSV. The same flows "
        "can be added to the map as a time-enabled layer for the Time "
        "Slider.</description>\n"
        "  </toolbox>\n"
        "</metadata>\n"
    )


def tool_xml(parameters, help_texts, created, modified):
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<metadata xml:lang="en">',
        esri_block(created, modified).rstrip("\n"),
        '  <tool name="BuildFlowMapPage" displayname="Build a flow map page" '
        'toolboxalias="flowmap">',
        "    <summary>Write a self-contained flow-map page, and optionally add "
        "the flows to the map for the Time Slider.</summary>",
        "    <parameters>",
    ]
    for name, label, kind, required, direction, _category in parameters:
        datatype = DATATYPES.get(kind, "GPString")
        reference = help_texts.get(name, "")
        lines.append(
            '      <param name="%s" displayname="%s" datatype="%s" '
            'direction="%s" expression="%s" parameterType="%s">'
            % (
                escape(name),
                escape(label),
                escape(datatype),
                escape(direction),
                escape(name),
                "Required" if required else "Optional",
            )
        )
        lines.append("        <dialogReference>%s</dialogReference>" % escape(reference))
        lines.append("        <pythonReference>%s</pythonReference>" % escape(reference))
        lines.append("      </param>")
    lines += ["    </parameters>", "  </tool>", "</metadata>", ""]
    return "\n".join(lines)


def strip_dates(text):
    """Compare documents without their creation/modification stamps."""
    out = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(("<CreaDate>", "<CreaTime>", "<ModDate>", "<ModTime>")):
            continue
        out.append(line)
    return "\n".join(out)


def write(path, text):
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    return path


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--pyt", default=PYT, help="the toolbox to read")
    parser.add_argument("--out", default=os.path.join(ROOT, "arcgis"), help="where the XML files go")
    parser.add_argument("--date", help="creation date, YYYYMMDD (for reproducible files)")
    parser.add_argument("--check", action="store_true", help="fail if the files do not match the .pyt")
    args = parser.parse_args(argv)

    parameters, help_texts = read_pyt(args.pyt)
    missing = [name for name, *_rest in parameters if not str(help_texts.get(name, "")).strip()]
    if missing:
        raise SystemExit("no help text for: %s" % ", ".join(missing))

    toolbox_path = os.path.join(args.out, TOOLBOX_FILE)
    tool_path = os.path.join(args.out, TOOL_FILE)

    if args.check:
        problems = []
        for path, expected in (
            (toolbox_path, toolbox_xml("", "")),
            (tool_path, tool_xml(parameters, help_texts, "", "")),
        ):
            if not os.path.isfile(path):
                problems.append("%s is missing" % os.path.basename(path))
                continue
            with open(path, "r", encoding="utf-8") as handle:
                actual = handle.read()
            if strip_dates(actual) != strip_dates(expected):
                problems.append("%s does not match FlowMap.pyt" % os.path.basename(path))
        if problems:
            for problem in problems:
                print("  stale: " + problem)
            print("run: python3 tools/arcgis/build-help.py")
            return 1
        print("the ArcGIS help files are up to date (%d parameters)" % len(parameters))
        return 0

    created = args.date or date_stamp()
    modified = args.date or date_stamp()
    if not args.date and os.path.isfile(tool_path):
        # keep the original creation date: a rewrite is not a new document
        with open(tool_path, "r", encoding="utf-8") as handle:
            for line in handle:
                if "<CreaDate>" in line:
                    created = line.strip().replace("<CreaDate>", "").replace("</CreaDate>", "")
                    break
    write(toolbox_path, toolbox_xml(created, modified))
    write(tool_path, tool_xml(parameters, help_texts, created, modified))
    print("wrote %s" % toolbox_path)
    print("wrote %s (%d parameters documented)" % (tool_path, len(parameters)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
