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
    """A parameter filter, as Pro behaves rather than as the docs describe.

    Pro keeps the *type* and the *list* separately, and puts the type back to
    "Any" when the list is replaced while it is empty; a parameter whose type
    is "Any" is drawn as a text box however good its list is. That behaviour is
    the one that turned six drop-downs into six empty boxes, so it is emulated
    here rather than smoothed over.
    """

    def __init__(self):
        self._list = []
        self._type = "Any"

    @property
    def list(self):
        return self._list

    @list.setter
    def list(self, items):
        self._list = list(items or [])
        if not self._list:
            self._type = "Any"

    @property
    def type(self):
        return self._type

    @type.setter
    def type(self, value):
        self._type = "Any" if (str(value) == "ValueList" and not self._list) else value


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

    @staticmethod
    def InsertCursor(table, fields):
        return _InsertCursor(table, fields)


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
    reset_animation()
    CURSOR_CALLS[:] = []
    MESSAGES[:] = []
    WARNINGS[:] = []
    ERRORS[:] = []
    PARAMS_SET[:] = []


da = _Da
env = _Env()


# ---------------------------------------------------------------- geometry
#
# Enough of the geometry and editing API for the animation layer: a point, an
# array, a polyline, an insert cursor, a geodatabase and a map with time.
# Everything is recorded, so a test can check what the toolbox asked for.


class Array(list):
    def __init__(self, items=None):
        list.__init__(self, list(items or []))

    def add(self, item):
        self.append(item)


class Polyline(object):
    def __init__(self, points=None, spatial_reference=None):
        self.points = list(points or [])
        self.spatial_reference = spatial_reference
        self.firstPoint = self.points[0] if self.points else None

    def __iter__(self):
        return iter([self.points])


CREATED = {}
FIELDS = {}
INSERTED = {}
LAYER_FILES = []
CALLS = []
MP_PROJECT = False


def _call(name, *args, **kwargs):
    CALLS.append((name, args, tuple(sorted(kwargs.items()))))


class _Management(object):
    """management.* as used by the toolbox, recording what it was asked."""

    @staticmethod
    def CreateFileGDB(folder, name):
        _call("CreateFileGDB", folder, name)
        path = folder.rstrip("/\\") + "/" + name
        CREATED[path] = "gdb"
        return path

    @staticmethod
    def CreateFeatureclass(gdb, name, shape_type, spatial_reference=None):
        _call("CreateFeatureclass", gdb, name, shape_type, spatial_reference=spatial_reference)
        path = gdb.rstrip("/\\") + "/" + name
        CREATED[path] = "featureclass"
        FIELDS.setdefault(path, [])
        return path

    @staticmethod
    def AddField(table, name, kind, field_length=None):
        _call("AddField", table, name, kind, field_length=field_length)
        FIELDS.setdefault(table, []).append(name)
        return table

    @staticmethod
    def Delete(path):
        _call("Delete", path)
        CREATED.pop(path, None)

    @staticmethod
    def SaveToLayerFile(layer, out_layer, is_relative_path=None):
        _call("SaveToLayerFile", out_layer)
        LAYER_FILES.append(out_layer)
        return out_layer


management = _Management()


def Exists(path):
    return str(path) in CREATED


class _InsertCursor(object):
    def __init__(self, table, fields):
        self.table = str(table)
        self.fields = list(fields)
        INSERTED.setdefault(self.table, [])

    def insertRow(self, row):
        INSERTED[self.table].append(list(row))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _Time(object):
    def __init__(self):
        self.enabled = False
        self.startTimeFieldName = None
        self.endTimeFieldName = None


class _Layer(object):
    def __init__(self, path):
        self.name = str(path).rstrip("/\\").split("/")[-1]
        self.path = str(path)
        self.time = _Time()
        self.enable_time_calls = []

    def enableTime(self, *args, **kwargs):
        self.enable_time_calls.append((args, kwargs))
        self.time.enabled = True


class _Map(object):
    def __init__(self):
        self.layers = []

    def addDataFromPath(self, path):
        layer = _Layer(path)
        self.layers.append(layer)
        return layer


class _Project(object):
    def __init__(self):
        self.activeMap = _Map()
        self.homeFolder = None
        self.filePath = None

    def listMaps(self):
        return [self.activeMap] if self.activeMap else []


class _Mp(object):
    project = None

    @staticmethod
    def ArcGISProject(name):
        if not MP_PROJECT:
            raise RuntimeError("no ArcGIS Pro project is open")
        if _Mp.project is None:
            _Mp.project = _Project()
        return _Mp.project


mp = _Mp()


def reset_animation():
    """Forget what the animation tests did."""
    CREATED.clear()
    FIELDS.clear()
    INSERTED.clear()
    LAYER_FILES[:] = []
    CALLS[:] = []
    _Mp.project = None
