# Flow map inside ArcGIS Pro

The map is one self-contained HTML page: no server, no API key, no internet
connection, one file you can email. This folder makes ArcGIS Pro produce that
file from the layers already in a project.

| Route | What it is | Works today |
| --- | --- | --- |
| **A. Python toolbox** | `FlowMap.pyt` — a tool in the Pro tool pane that reads your layers and writes the page | Yes, on Windows, any Pro 2.9+ |
| **B. From Python** | `flowmap_core.py` — the same pipeline as a library or a command line | Yes, anywhere Python 3 runs |
| **C. Dockpane add-in** | A page docked inside Pro, refreshed from the current map | Needs a .NET add-in; recipe below |

All three produce the same page, from the same dataset, because they share
`flowmap_core.py`.

---

## A. The Python toolbox

### Install

1. Copy this whole folder somewhere permanent, for example
   `C:\Users\<you>\Documents\ArcGIS\FlowMap\`. It needs `FlowMap.pyt`,
   `flowmap_core.py` and the built `index.html` side by side — that is exactly
   what `node tools/package-arcgis.mjs` produces (`dist/arcgis-pro/`, and a zip
   of the same).
2. In ArcGIS Pro: **Insert → Toolbox → Add Toolbox…** and pick `FlowMap.pyt`.
3. Open **Flow map → Build a flow map page**.

The tool writes one HTML file. Double-click it, or tick *Open the page when it
is written*.

### Parameters

**1 · Input**

| Parameter | Notes |
| --- | --- |
| Flow table or layer | A table, a geodatabase table, a CSV in the project, or a feature layer |
| Output page (HTML) | Where the page goes |
| Places to look names up | Optional point layer: gives every name a position |
| Name field in the places layer | Matches the flow table's names |
| Group field in the places layer | Optional: colours and groups the dots |

**2 · Outlines**

| Parameter | Notes |
| --- | --- |
| Detailed outlines | Optional polygons, drawn under everything (districts, communes) |
| Name field in the outlines | Lets a name in the table be found on the map |
| Coarse outlines | Optional second polygon layer (provinces, regions) |
| Outline detail in degrees | Douglas–Peucker tolerance; 0 keeps every vertex. 0.001° ≈ 110 m, 0.01° ≈ 1.1 km |

**3 · Columns** — Origin name (required), Destination name (required), Value
(default 1), Date or day number, Origin/Destination group, Origin/Destination
longitude and latitude. The tool guesses these from the column names on the
first run; change anything it got wrong.

**4 · Text on the page** — Title, Subtitle, Unit, *What one dot is called*,
*What a group is called*, Source note.

**5 · Output** — *Also write the dataset (JSON)* for reuse elsewhere, and
*Open the page when it is written*.

### What the page does with the table

- **Coordinates.** Whatever the project's coordinate system, every geometry is
  read through a cursor asking for WGS84 longitude/latitude, so a layer in
  metres still lands in the right place. If the table has no coordinates, names
  are matched against the places layer, then the outline layers: accents, case,
  punctuation and decorations are ignored, so *Ségou*, *SEGOU* and
  *Koutiala (Sikasso)* all find their feature.
- **The time axis.** Dates become whole days counted from the earliest one, so
  day 0 is the first day of the record and the slider drives a real timeline.
  ISO (`2026-01-04`), day-first (`31/01/2026`) and month-first (`01/04/2026`
  = 4 January) are all read, plus a column of plain numbers as day numbers.
  Unreadable dates are reported and treated as the first day.
- **Groups.** A place belongs to one group: the first group the table gives the
  name — in its own column, in the places layer, or inherited from the row —
  wins. A city that appears in ten rows is one dot, not ten.
- **Values.** A row with a value of 0, or a name that cannot be located, is
  dropped — and reported as a warning, never silently.
- **One-place rows.** A point layer is a table of places, not of pairs: each row
  becomes a record *within* that place (the "inside" column of the page's
  table).

### Recipes

**Displacement table + district polygons.** Flows: your OD table. Origin name:
`origin_district`; Destination name: `destination_district`; Value:
`households`; Date: `assessment_date`. Detailed outlines: your district
polygons, name field `district`. Nothing else is needed: the names in the table
are matched to the polygons, and the dots land on the districts they belong to.

**Points layer (events).** Flows: the point layer. Origin name and Destination
name: the same field (the tool fills in the second). Value and Date: as usual.
The longitude/latitude parameters are disabled and the geometry is used.

**Longitude/latitude columns.** Map Origin longitude/origin latitude (and,
if the table has them, destination longitude/latitude). No outlines are needed,
though they make the map readable.

### Size

Boundaries and places travel inside the page. A district layer with 400
features and 50 000 vertices is about 1 MB of the page; *Outline detail in
degrees* at 0.005 usually cuts that by more than half with no visible loss.
The page draws well with a few thousand places and a few hundred thousand
flows; beyond that, aggregate the table first.

---

## B. From Python

No ArcGIS needed. Everything the toolbox does with arcpy happens in the
toolbox; the rest is plain Python:

```bash
# a page from the invented demo table, to see the shape of things
python3 flowmap_core.py demo --out demo.html
# …and the same page drawn through the page's own projection code, no browser:
node tools/render-map.mjs --html demo.html --out docs/arcgis-demo.png

# a page from a spec file
python3 flowmap_core.py build --input spec.json --out page.html --json dataset.json

# the checks (28 of them, no dependencies)
python3 flowmap_core.py selftest
```

`spec.json` is `{"rows": […], "mapping": {…}, "meta": {…}, "places": […],
"admin1": {…}, "admin2": {…}}`, and the library is just as usable directly:

```python
import flowmap_core as core

dataset, warnings = core.build_dataset(rows, mapping, meta=meta, places=places, admin2=areas)
core.build_page("index.html", dataset, "page.html", "dataset.json")
```

That is how the toolbox itself calls it, so anything you write this way behaves
identically — including from a Jupyter notebook in the Pro Python environment,
or from a scheduled script that refreshes the page every night.

---

## C. A dockpane inside Pro

The page can live in a dockpane, refreshed from whatever is selected on the
map. This route needs a .NET add-in, so it has to be built on Windows with the
**ArcGIS Pro SDK for .NET** — nothing in this repository can build or test it.
The pieces:

1. **Project.** Visual Studio → *ArcGIS Pro Module Add-in* (Pro 3.x, .NET 6+).
   In `Config.daml`, add a dockpane and a button on the *Map* tab.
2. **Show the page.** Put a `WebView2` (NuGet `Microsoft.Web.WebView2`) in the
   dockpane's `UserControl`, then serve this folder to it without a web server:

   ```csharp
   await webView.EnsureCoreWebView2Async();
   webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
       "flowmap.local", appFolder, CoreWebView2HostResourceAccessKind.Allow);
   webView.CoreWebView2.Navigate("https://flowmap.local/index.html");
   ```

   `index.html` works from a virtual host name because the page is a single
   file with nothing else to fetch.
3. **Refresh from the map.** Your button reads the chosen table with
   `ArcGIS.Core.Data` (or writes a CSV next to the page), then calls the tested
   core to rebuild the page:

   ```csharp
   var python = Path.Combine(ArcGISProInstallPath, "bin", "Python",
                             "envs", "arcgispro-py3", "python.exe");
   Process.Start(python, $"\"{corePath}\" build --input spec.json --out \"{appFolder}\\index.html\"");
   webView.CoreWebView2.Reload();
   ```

   The add-in stays a thin UI: mapping fields, writing a spec, and letting
   `flowmap_core.py` — the code this repository tests — do the work. (Calling
   the Python of the Pro environment also means no second Python to install.)
4. **Publish.** The same add-in can be shared as a `.esriAddinX`, or the
   toolbox can be published as a *web tool* through ArcGIS Online/Enterprise,
   which runs it server-side and hands back the page.

Ask here if you want this add-in written: it is a self-contained job (DAML +
dockpane + the spec writer) that needs Windows and the Pro SDK to build and
verify — the part that decides what the page shows already exists and is
tested.

---

## What is checked, and what is not

`npm test` runs `test/arcgis.test.mjs`, which:

- runs `flowmap_core.py selftest` (29 checks: names, dates, geometry, the
  dataset, the page);
- drives `FlowMap.pyt` through a stand-in for arcpy (`tools/arcgis/arcpy_stub.py`,
  `tools/arcgis/toolcheck.py`, 41 checks): parameter wiring, field guessing,
  cursors, geometry parts, the WGS84 request, messages and warnings, the two
  failure paths;
- loads the page the toolbox wrote in the project's own browser harness and
  compares it, number for number, with the dataset the toolbox reported.

What that cannot do is run real ArcGIS Pro: the stand-in follows the documented
arcpy API, so **a first run on your machine is still the acceptance test**.
Things worth a look on that first run: your field names against the guessed
mapping, the group field if your table has one, and the outline detail if the
page feels heavy.

## Known limitations

- One tool, one page: no editing back into the project. The page's exports (GIF,
  video, SHP, GeoJSON, GeoParquet, CSV) are the way back.
- A place is a name; two places with the same name in different groups are told
  apart only by the group field.
- Attribute granularity: the page draws places and flows, not individual
  households or GPS traces.
- The page is untranslated English apart from what the tool's text parameters
  set (title, subtitle, source, labels).
