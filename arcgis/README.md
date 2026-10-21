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
   `C:\Users\<you>\Documents\ArcGIS\FlowMap\`. It needs, side by side:

   | File | What it is |
   | --- | --- |
   | `FlowMap.pyt` | the toolbox |
   | `flowmap_core.py` | the engine — **replace it at the same time as the `.pyt`** |
   | `FlowMap.pyt.xml` | the toolbox description |
   | `FlowMap.BuildFlowMapPage.pyt.xml` | the help behind every (i) button |
   | `index.html` | the page template the tool fills |
   | `check_install.py` | the doctor, if something goes wrong |

   That is exactly what `node tools/package-arcgis.mjs` produces
   (`dist/arcgis-pro/`, and a zip of the same).
2. In ArcGIS Pro: **Insert → Toolbox → Add Toolbox…** and pick `FlowMap.pyt`.
   If an older FlowMap toolbox is already open, **remove it first** (right-click
   → *Remove*): an old folder left on the machine can otherwise supply an old
   engine.
3. Open **Flow map → Build a flow map page**.

The tool writes one HTML file. Double-click it, or tick *Open the page when it
is written*.

### Parameters — 28, and only two are required

The ten fields facing you, in this order: the table, the output folder, the page
name, then the six columns. Everything else is folded into three collapsible
groups.

| Parameter | Required | What it is |
| --- | --- | --- |
| Flow table or layer | **yes** | A layer, a feature class, a standalone table, a CSV, a JSON or a GeoJSON layer |
| Output folder | **yes** | Browse to it. `index.html` is written inside, or the page name below |
| Page file name | no | Default `index.html`; a name without `.html` gets it added |
| Origin / Destination name field | no | A place name. Not needed when there are coordinates, or a places/outlines layer |
| Value field | no | The quantity to draw. Must hold numbers; empty counts 1 |
| Date or day field | no | Drives the animation |
| Origin / Destination longitude, latitude | no | Degrees, WGS84 |

*Places and outlines*: places layer + its name and group columns, detailed and
coarse outlines + their name columns.

*Text on the page*: open when done, title, subtitle, unit, dot label, group
label, source note. Unit and labels are deduced when left empty.

*More options*: add the flows to the map for the Time Slider, page template,
dataset JSON.

**Every column parameter is a drop-down of the table's own columns.** Not a
text box, not Pro's field control. A filter's *type* and its *list* are two
different things in Pro, and it puts the type back to "Any" when the list is
replaced while empty — a parameter whose type is "Any" is drawn as a text box
however good its list is. So the type is re-asserted after every list change,
and verified: `check_install.py` prints `drop-down (8)` or `TEXT BOX` for each
column parameter, in your copy of Pro. The list is filled when you choose the table,
refilled when you change it, and filled again when the pane is reopened on the
values of the previous run. The tool reads the columns itself — `ListFields`, then `Describe().fields`, then a cursor, then
the JSON file behind a layer added from JSON or GeoJSON — so a layer Pro's own
field control refuses (*"CIMPATH=Map/_name_.json"* is the usual case) still
gives a full list. A column is greyed out until its dataset exists, and a
column the new table does not have is dropped rather than sent on.

**Nothing is guessed from a column name alone.** The tool samples 200 rows and
judges the content: a column of identifiers is never a place name, a text column
is never a value, coordinates must be in degrees, and a date column must read as
a date. What it finds is shown under the parameter while the dialog is open —
*The value column "CSI_CASE" holds no number that can be read (examples:
"CSI-001", "CSI-014")* — and repeated as warnings if a build fails.

**Coordinates are checked against the numbers.** If the column called
longitude holds what are plainly latitudes, the tool says so and swaps them
(`The destination longitude and latitude were read the wrong way round`), so a
mislabeled export cannot silently draw a map of the wrong hemisphere.

### What the page does with the table

- **Coordinates.** Whatever the project's coordinate system, every geometry is
  read through a cursor asking for WGS84 longitude/latitude, so a layer in
  metres still lands in the right place. If the table has no coordinates, names
  are matched against the places layer, then the outline layers: accents, case,
  punctuation and decorations are ignored, so *Ségou*, *SEGOU* and
  *Koutiala (Sikasso)* all find their feature.
- **The time axis.** With a date column, dates become whole days counted from
  the earliest one, so day 0 is the first day of the record and the slider
  drives a real timeline. **Without a date column**, the rows' own order becomes
  a short axis of *steps*: the flows appear one after another, the slider and
  Play do something, and the label says `Step 4` rather than pretending to know
  a date.
  ISO (`2026-01-04`), day-first (`31/01/2026`) and month-first (`01/04/2026`
  = 4 January) are all read, plus a column of plain numbers as day numbers.
  Unreadable dates are reported and treated as the first day.
- **Groups.** A place belongs to one group: the first group the table gives the
  name — in its own column, in the places layer, or inherited from the row —
  wins. A city that appears in ten rows is one dot, not ten.
- **Values.** A row with a value of 0, or a name that cannot be located, is
  dropped — and reported as a warning, never silently. A value column with no
  number at all stops the build before it starts, naming the column.
- **One-place rows.** A point layer is a table of places, not of pairs: each row
  becomes a record *within* that place (the "inside" column of the page's
  table).
- **What the page says when there is no line.** A table with one point per row
  has no movement to draw, and the page says so in its subtitle — the
  households counted *inside* each place travel round that place's ring —
  instead of promising "each line a flow" over a field of dots.
- **One name, two coordinate pairs.** An empty *Origin name field* does not copy
  the destination's name onto the origin: the two ends keep their own
  coordinates, the unnamed end is labelled by its position, and the flow stays a
  line between two places. Copying the name would weld the two ends into one
  dot — 36 rows, 36 dots, not one line.
- **When the two ends really are one point.** If the origin and destination
  coordinates match in every row, the page has no line to draw. It says so:
  the tool warns with the two column pairs by name, the dialog shows the same
  warning next to the coordinate fields, and the page repeats it under the map.
- **Which build made the page.** The tool is labelled `Build a flow map page
  (6.6)`, each run opens with `FlowMap 6.6 - engine 6.6`, and the page's source
  line ends with `Built with FlowMap 6.6`. A toolbox left beside an older
  `flowmap_core.py` refuses to run rather than build the old page silently.

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
though they make the map readable. This is the shape of the table that failed
once: `Village`, `CSI_CASE`, `MILDA_distribuees`, `Lon_dept`, `Lat_dept`,
`Longitude_rep`, `Latitude_rep` — the tool picks the village column, refuses
`CSI_CASE` as a value and counts `MILDA_distribuees`, and pairs the two
coordinate sets the right way round.

### Size

Boundaries and places travel inside the page. A district layer with 400
features and 50 000 vertices is about 1 MB of the page; the tool picks the
outline detail itself from the amount of geometry (0.005° to 0.02°), which
usually halves that with no visible loss. The page draws well with a few
thousand places and a few hundred thousand flows; beyond that, aggregate the
table first.

### The animation, inside Pro as well

*Add the flows to the map, ready for the Time Slider* (on by default) makes the
same run do a second thing:

- a line feature class is written to `FlowMap.gdb` in the output folder, with
  `DAY`, `WHEN`, `ORIGIN`, `DESTINATION` and `VALUE` fields;
- it is added to the active map, time is turned on with `WHEN` as the start
  field, and `FlowMap-flows.lyrx` is saved next to the page.

Then open the **Time Slider** on the map and press play: the animation plays
on your own map, with your basemap and your layout, and the **Animation** tab
exports it as a video. A Python toolbox cannot draw in the map, so this is the
route that puts the animation there rather than in a browser.

If the layer cannot be added (no project open, or a build without the time
API), the page is still written — the tool warns and says which field to pick
by hand in *Layer Properties → Time*. Nothing else is lost.

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

# the checks (59 of them, no dependencies)
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

- runs `flowmap_core.py selftest` (59 checks: names, dates, geometry, the
  dataset, the page, and what a column holds — identifiers, metres, readable
  dates, the swapped coordinate pair);
- drives `FlowMap.pyt` through a stand-in for arcpy (`tools/arcgis/arcpy_stub.py`,
  `tools/arcgis/toolcheck.py`, 110 checks): the 28 parameters, the drop-down
  lists including a JSON layer, the folder and page name, the guessing on the
  table that failed in the field, the swap of two mislabeled coordinate
  columns, cursors, geometry parts, the WGS84 request, messages and warnings,
  the animation layer (feature class, fields, one line per flow, dates, time
  enabled, `.lyrx`), a new toolbox left beside an old engine, and every failure
  path;
- checks the pane itself (`tools/arcgis/dialogcheck.py`, 437 checks): on a
  feature table, a standalone table, a point layer, a shapefile and a layer
  added from JSON, every column parameter is a value list, holds the columns
  of the dataset chosen above it, follows the dataset when it changes, drops a
  column the new table lacks, fills itself when the dialog is reopened
  (`updateMessages` alone), keeps its type as a value list when Pro resets it
  or rebuilds it from an empty list, and accepts every item clicked in it;
- checks the installation itself (`arcgis/check_install.py --stub tools/arcgis`,
  25 checks) and that the help XML matches the toolbox
  (`python3 tools/arcgis/build-help.py --check`);
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
