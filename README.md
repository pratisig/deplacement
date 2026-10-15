# deplacement

**Yemen displacement network** — where Yemeni households moved between districts,
day by day, from 4 January to 11 October 2026 (IOM DTM Rapid Displacement
Tracking, district level).

![The map view](docs/map.png)

`index.html` is the whole app: one file, no build needed to run it, no API key,
no server. Open it and it works, including offline — the data and the
administrative limits are inside the file.

## Using it

* **Network** — a force-directed graph: one dot per district, one curved line per
  route, dots coloured by net arrivals (blue) / departures (orange) / balanced
  (grey), and small travellers moving along the busiest routes.
* **Map** — the same data at each district's real coordinates, over a background
  map, with **district limits** and **governorate limits** drawn on top. The
  *Limits* button cycles districts → governorates → off, and hovering a district
  highlights it.
* **Basemap** — Dark, Light, Terrain, Satellite or None. Every one of them is a
  public tile server with no account and no key.
* **Timeline** — drag the slider or press *Play* to run through the period; the
  header date, the totals, the table and the routes all follow it.
* **Table** — the fifteen busiest districts for the selected day, with arrivals,
  departures, moves inside the district and the net figure.

## Basemaps: keyless by design

CARTO basemaps now answer `403 Required API key`, and the standard OpenStreetMap
tile servers refuse requests that do not come from a browser on their own site,
which is where the original `403` came from. Both are gone. What is used instead:

| Style | First choice | Then |
| --- | --- | --- |
| Dark | Esri *World Dark Gray Canvas* | Wikimedia Maps → OSM France → OSM |
| Light | Esri *World Light Gray Canvas* | Wikimedia Maps → OSM France → OSM |
| Terrain | OpenTopoMap | Wikimedia Maps → OSM France → OSM |
| Satellite | Esri *World Imagery* (dimmed) | CyclOSM → OSM France → OSM |
| None | — (limits only) | — |

* **Nothing needs a key, a token or a sign-up.**
* If a server refuses the tiles (403, blocked, offline), the map **moves on to the
  next provider by itself** and says so in the line under the controls — it never
  fails silently into a grey void. A single missing tile is not treated as a dead
  server: it takes a sustained run of failures, and picking a style again retries
  from the top.
* Light providers used under the Dark style are filtered through CSS
  `invert/hue-rotate`, so a fallback still matches the dark theme.
* Commercial providers were avoided on purpose; the OSM project servers stay last
  in every chain because their [tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
  is the strictest. Still, these are third-party services: for a permanent
  deployment, point the `PROV` table in `src/js/tiles.js` at your own tile
  server.

## Administrative limits

Both layers are embedded in `index.html`, so they never depend on a tile API or
on the network:

* **Governorates** — Natural Earth 1:10m admin-1 (public domain).
* **Districts** — DIVA-GIS district layer, recovered from a TopoJSON file whose
  declared transform does not match its own coordinates (see `data/README.md`).

Projection is real Web Mercator, shared by the tiles, the district dots and the
limits, which is why they line up exactly. The zoom is the deepest one whose
256 px tiles still land on ~110 CSS px, and the frame covers the whole country,
Socotra included.

## Layout

```
index.html               the built app — the only file a visitor needs
src/template.html        page shell: markup, controls, notes
src/styles.css           dark theme
src/js/                  the app, split into load-order modules
  core.js                DOM handles, theme colours, formatters
  dataset.js             districts, routes, map frame
  projection.js          Web Mercator, tiling and limit projection
  tiles.js               tile providers, fallback chains, status line
  limits.js              district and governorate outlines
  aggregate.js           day-by-day totals and route list
  simulate.js            force layout / map pinning
  render.js              one draw pass
  ui.js                  controls, events, boot
data/                    the three embedded payloads (see data/README.md)
test/                    Node test suite (stubbed DOM, canvas, d3, tiles)
tools/build-boundaries.mjs   rebuild the boundary payloads from source
tools/render-map.mjs         render the map view to a PNG for eyeballing
build.mjs                glues src/ + data/ into index.html
```

The modules have no imports: `build.mjs` concatenates them in the order above, so
they end up in one `<script>` and `index.html` stays a single file. Nothing in
`src/` is loaded by a browser directly.

## Working on it

```sh
npm install          # prettier only
npm run build        # src/ + data/  ->  index.html
npm run check        # fail if index.html is out of date
npm test             # 17 tests: data, projection, fallback, limits, rendering
npm run render       # write tools/out/map-check.png
npm run boundaries   # rebuild data/boundaries-*.json from source
npm run serve        # static server on :8000
```

The test suite loads the built page in Node with a stubbed DOM, canvas, d3 and
image loader, then drives it: it clicks the controls, fires tile loads and
failures by hand, and checks the numbers against the raw dataset. That is how the
provider fallback and the limit toggles are verified without a browser — and how
the geometry is checked, by testing every district point against its own polygon.

CI (`.github/workflows/ci.yml`) runs formatting, `build --check`, the tests and
the render on every push.

## Data

Source: IOM DTM Rapid Displacement Tracking, district level. Households are
counted from assessments and added up from 4 January to the chosen date, so a
family assessed twice counts twice — which is why the totals here are movements
recorded, not a snapshot of people displaced. See `data/README.md` for the exact
payloads, their licences and the rebuild procedure.

## Licence

MIT for the code (see `LICENSE`). The data keeps the licence of its source:
Natural Earth is public domain, DIVA-GIS boundaries are free for non-commercial
use, and the displacement figures belong to IOM DTM. The basemaps belong to their
providers and carry their own attribution, which the app prints on the map.
