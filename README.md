# deplacement

**Yemen displacement network** — a single self-contained page that shows how
households moved between Yemen's districts between 4 January and 11 October
2026 (IOM DTM Rapid Displacement Tracking, district level).

Open `index.html` in a browser. No build step, no server, no API key.

## What is in it

* **Network layout** (default) — a force-directed graph: one dot per district,
  one curved line per route, dots coloured by net arrivals/departures, little
  lights travelling along the routes.
* **Map layout** — the same data on a real map of Yemen, with **district
  limits** (Natural Earth ADM2) and **governorate limits** (geoBoundaries
  ADM1) drawn on top. The *Limits* button switches between districts,
  governorates and none.
* Timeline slider and *Play* button to move through the days, a table view of
  the 15 busiest districts, and hover details for every district.

## Background maps (no API key, no sign-up)

The map view uses public tile servers only:

| Style | Source | URL pattern |
| --- | --- | --- |
| Dark | Esri World Dark Gray Canvas | `server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}` |
| Light | Esri World Light Gray Canvas | `server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}` |
| Satellite | Esri World Imagery | `server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` |
| Terrain | OpenTopoMap | `a.tile.opentopomap.org/{z}/{x}/{y}.png` |
| Fallbacks | Wikimedia Maps, OpenStreetMap France, CyclOSM, OpenStreetMap | — |

CARTO basemaps are **not** used: they now answer `403` with
*"Required API key"*, and the standard OpenStreetMap tile servers refuse
requests without a referrer (`403`). Instead every style has a fallback chain:
if a server will not serve the tiles the page switches to the next one on its
own and says so in the line under the controls.

Tiles are drawn with a true Web Mercator projection, so districts, boundaries
and tiles line up exactly.

## Boundaries

* Governorates — [geoBoundaries](https://www.geoboundaries.org) `gbOpen` ADM1
  for Yemen (ODbL), simplified and embedded in the page.
* Districts — Natural Earth ADM2 for Yemen, remapped onto the same grid and
  embedded in the page.

Both are inlined, so the page works with no network access for the outlines.

## Files

* `index.html` — the whole thing: data, boundaries, styles and script.
