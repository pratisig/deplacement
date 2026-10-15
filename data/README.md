# Data

This directory holds the **built-in example**: a flow table plus two boundary
layers. The page at runtime builds exactly the same structure from any table a
user loads (`src/js/sources.js`), so nothing here is special-cased.

| File | What it is | Source | Licence |
| --- | --- | --- | --- |
| `displacement.json` | 227 districts with their centre point and governorate, and 2 832 routes (day, origin, destination, households) | IOM DTM Rapid Displacement Tracking, district level, 4 Jan – 11 Oct 2026 | IOM DTM terms of use |
| `boundaries-adm1.json` | 21 governorate outlines (`p` = rings, `c` = label point) | Natural Earth 1:10m admin-1 states and provinces | public domain |
| `boundaries-adm2.json` | district outlines, keyed by the district name used in the dataset | DIVA-GIS Yemen districts, via the [topography](https://github.com/tanaynistala/topography) TopoJSON mirror | DIVA-GIS: free for non-commercial use |
| `example.meta.json` | title, unit, labels and first date of the example | — | — |

Format notes:

* Coordinates are the flat `[lon0, lat0, lon1, lat1, …]` form, rounded to 3 decimals
  (~100 m, well under one screen pixel at country scale). Polygons are simplified
  with Douglas–Peucker, so they are meant for drawing, not for area measurement.
* `boundaries-adm1.json` is keyed by governorate name as spelled in
  `displacement.json`. `boundaries-adm2.json` is keyed by district name from the
  same file, which is what lets the page highlight a district on hover.
* The district layer's own TopoJSON declares a transform that does not match its
  coordinates; `tools/build-boundaries.mjs` recovers the geographic placement by
  fitting it to the governorate outlines and then refining on the district names.
  That script is the only thing that knows about the quirk.

Rebuild both boundary files from source with:

```sh
npm run boundaries            # downloads to .cache/, then writes data/boundaries-*.json
npm run boundaries -- --offline
```
