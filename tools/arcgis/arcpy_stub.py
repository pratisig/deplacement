#!/usr/bin/env python3
"""A stand-in for arcpy, good enough to run FlowMap.pyt outside Windows.

It implements the slice of the documented arcpy API the toolbox uses:
Parameter (+ value, valueAsText, altered, enabled, filter.list, category,
setErrorMessage/setWarningMessage), ListFields, Describe, da.SearchCursor,
env.workspace, AddMessage/AddWarning/AddError, ExecuteError and
SetParameterAsText. Geometries carry a firstPoint, iterate over their parts
and expose getPart(), like the real ones.

This does not replace an ArcGIS Pro install. It makes the glue testable —
parameter wiring, cursor reading, geometry parts, messages, output — on any
machine, which is the part that has nothing to do with the map itself.
"""

from __future__ import annotations


class ExecuteError(Exception):
    pass


class _Filter(object):
    def __init__(self):
        self.list = []


class Parameter(object):
    def __init__(self, **props):
        self.displayName = props.get("displayName", "")
        self.name = props.get("name", "")
        self.datatype = props.get("datatype")
        self.parameterType = props.get("parameterType", "Optional")
        self.direction = props.get("direction", "Input")
        self.parameterDependencies = props.get("parameterDependencies") or []
        self.category = props.get("category", "")
        self.filter = _Filter()
        self.value = props.get("value")
        self.altered = False
        self.enabled = True
        self.errorMessage = None
        self.warningMessage = None

    @property
    def valueAsText(self):
        if self.value is None:
            return None
        if isinstance(self.value, bool):
            return "true" if self.value else "false"
        return str(self.value)

    def setErrorMessage(self, text):
        self.errorMessage = text or None

    def setWarningMessage(self, text):
        self.warningMessage = text or None

    def clearMessage(self):
        self.errorMessage = None
        self.warningMessage = None

    def __repr__(self):
        return "<Parameter %s=%r>" % (self.name, self.value)


class Point(object):
    def __init__(self, x, y):
        self.X = float(x)
        self.Y = float(y)


class Geometry(object):
    """parts: a list of rings, each a list of (x, y) pairs."""

    def __init__(self, parts):
        self.__parts = [[Point(x, y) for x, y in part] for part in parts]
        self.firstPoint = self.__parts[0][0] if self.__parts and self.__parts[0] else None

    def __iter__(self):
        return iter(self.__parts)

    def getPart(self):
        return self.__parts[0] if self.__parts else None


class _Desc(object):
    def __init__(self, dataType, shapeType):
        self.dataType = dataType
        self.shapeType = shapeType


class _Cursor(object):
    def __init__(self, layer, fields, where_clause=None, spatial_reference=None, **extra):
        CURSOR_CALLS.append((str(layer), tuple(str(f) for f in fields), spatial_reference))
        table = TABLES.get(str(layer))
        if table is None:
            raise ExecuteError("The stand-in has no table for %s" % layer)
        self.fields = ["SHAPE@" if str(f).lower() == "shape@" else f for f in fields]
        self.rows = [
            [row["SHAPE@"] if f == "SHAPE@" else row.get(f) for f in self.fields] for row in table["rows"]
        ]

    def __iter__(self):
        return iter(self.rows)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _Da(object):
    @staticmethod
    def SearchCursor(layer, fields, where_clause=None, spatial_reference=None):
        return _Cursor(layer, fields, where_clause, spatial_reference)


class _Env(object):
    workspace = None


def ListFields(layer):
    table = TABLES.get(str(layer))
    if table is None:
        raise ExecuteError("The stand-in has no table for %s" % layer)
    return [type("Field", (), {"name": name, "type": "String"})() for name in table["fields"]]


def Describe(layer):
    table = TABLES.get(str(layer))
    if table is None:
        raise ExecuteError("The stand-in has no table for %s" % layer)
    return _Desc("FeatureClass" if table.get("shapeType") else "Table", table.get("shapeType"))


class SpatialReference(object):
    """Stand-in for arcpy.SpatialReference — enough to see what was asked for."""

    def __init__(self, code):
        self.factoryCode = code

    def __repr__(self):
        return "SpatialReference(%s)" % self.factoryCode


# What the driver registers, and what the toolbox records.
CURSOR_CALLS = []
TABLES = {}
MESSAGES = []
WARNINGS = []
ERRORS = []
PARAMS_SET = []


def AddMessage(line):
    MESSAGES.append(str(line))


def AddWarning(line):
    WARNINGS.append(str(line))


def AddError(line):
    ERRORS.append(str(line))


def SetParameterAsText(index, value):
    PARAMS_SET.append((index, value))


class Messages(object):
    """The object ArcGIS hands to execute() — addMessage/addWarningText."""

    def addMessage(self, line):
        AddMessage(line)

    def addWarningText(self, line):
        AddWarning(line)

    def addErrorMessage(self, line):
        AddError(line)

    def addWarning(self, line):
        AddWarning(line)


def add_layer(name, fields, rows, shape_type=None):
    TABLES[name] = {"fields": list(fields), "rows": list(rows), "shapeType": shape_type}


def reset():
    TABLES.clear()
    CURSOR_CALLS[:] = []
    MESSAGES[:] = []
    WARNINGS[:] = []
    ERRORS[:] = []
    PARAMS_SET[:] = []


da = _Da
env = _Env()
