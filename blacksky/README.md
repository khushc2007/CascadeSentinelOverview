# BLACKSKY COMMAND

**GRID DOOMSDAY FINDER · BLACKSKY COMMAND — Power Grid Contingency Intelligence.**
A separate website, next to the original Grid Doomsday Finder workbench (`app/`), with its own entry point, visual identity, navigation
and deployment target. Three coordinated experiences over one run, one event list and one playback cursor:

| Route | Experience | What it does |
|---|---|---|
| `#theater` (default) | Cascade Command Theater | Guided DETECT → TRACE → CASCADE → ISLAND → ASSESS replay; play/pause/step/scrub/speed, follow-events camera, Orbit/Recon/Track, 3-D/Schematic, reset, replay. Stages that did not happen say so. |
| `#autopsy` | Grid Autopsy | Inspect any bus, branch, generator, load or transformer: attributes, state at the current frame, loading or energisation by round, trip history, events, neighbours; event filter + search; islands; initial vs final; DC vs stored AC; findings report with metric provenance. |
| `#arena` | Contingency Arena | Network → contingency → engine and trip rule → validation → run → observe/inspect → score → compare with the table's most damaging set → save/replay (this browser). |

The score is `100 × (1 − (rank − 1) / N)`: the share of all k-branch sets that are no more damaging than yours, where rank comes from the
exhaustive DC table (exact inside the stored top 500, histogram-estimated below). AC results, other trip rules and k without a table are
shown but not scored. S is a fraction of the IEEE test case's demand under a quasi-steady-state model with synthetic ratings; the layout
is synthetic (Kamada–Kawai), not geographic. No live grid data; no quantum hardware.

## Layout
```
blacksky/
  site/                 ← the deployable static site (Root Directory for hosting)
    index.html          entry point (own CSS tokens, vendored fonts)
    js/                 BLACKSKY modules: main, state, engine, stages, score, provenance, scene, labels, timeline, theater, autopsy, arena, palette, util
    shared/             byte-for-byte copies of app/js/core/{cascade,model,events,encoding,scenario}.js and app/js/three/{layout,camera,loader}.js
    data/               byte-for-byte copies of app/data (grids, cascade models, exhaustive-table summaries, stored DC/AC runs)
    vendor/             three.js r160 (MIT, THREE_LICENSE)
    fonts/              Archivo, JetBrains Mono (SIL OFL 1.1; licence files included)
    vercel.json         static hosting headers for this site only
    SHARED_SOURCES.txt  sha256 of every shared copy and its source
  serve.py              local server: site at /, the unchanged FastAPI app at /api
  test/logic.test.mjs   node unit tests on real data
  DESIGN.md             design system
  REVIEW_1.md … REVIEW_3.md, review/   the three formal reviews with before/after screenshots
```
`scripts/build_blacksky.py` refreshes `shared/` and `data/` from `app/`; `--check` fails if any copy drifted. Nothing in `app/` or
`doomsday/` is modified by BLACKSKY.

## Run locally
```bash
# static only (browser engine + stored runs; the API chip says "API offline")
cd blacksky/site && python -m http.server 8010            # → http://127.0.0.1:8010/

# with the optional Python engines (same origin, API mounted at /api); needs the api extra: pip install -e ".[api]"
PYTHONPATH=. python -m uvicorn blacksky.serve:app --port 8010   # or: make blacksky-serve
```
The original site is unchanged and still runs with `make serve` (http://127.0.0.1:8000/). Side effect of mounting the unchanged API: under
`blacksky.serve` the original workbench UI is also reachable at `/api/`.

## Deploy (independent of the original site)
**Vercel — a new, separate project** (do not reuse or edit any existing project):
| Setting | Value |
|---|---|
| Framework preset | Other |
| Root Directory | `blacksky/site` |
| Build command | *(none — leave empty / override to empty)* |
| Output directory | `.` |
| Install command | *(none)* |
| Environment variables | none required |
| Config file | `blacksky/site/vercel.json` (security and cache headers only) |

CLI equivalent, run by someone with a Vercel account (not done in this session — no credentials):
`cd blacksky/site && vercel deploy --prod` and answer "link to new project". Any static host works the same way: publish the contents of
`blacksky/site/` as the web root.

A static deployment has no API: `/api/health` returns 404 and the page shows "API offline"; the browser DC engine and the stored DC/AC runs
work fully. To offer the Python engines, run `blacksky/serve.py` (or any server that mounts `doomsday.api.app:app` at `/api` on the same
origin). To point the page at an API elsewhere, edit `<meta name="blacksky-api" content="api/">` in `index.html` to that base URL; the
original API sends no CORS headers, so a cross-origin API needs a proxy or CORS middleware in front of it. No credentials are sent and none
are stored in the browser.

### Environment variables
| Variable | Used by | Default |
|---|---|---|
| `BLACKSKY_SITE_DIR` | `blacksky/serve.py` | `blacksky/site` |
| `GDF_APP_DIR`, `GDF_DATA_DIR` | the original API (unchanged behaviour) | `app/`, `app/data/` |

The static site itself reads no environment variables.

### Published page
`scripts/export_blacksky_page.py` builds `build/blacksky_page/` (document wrappers stripped, fonts inlined, `blacksky-embed` meta hides the
file download, vendor included). That build was published as its own private claude.ai artifact, separate from the workbench artifact.

## Test
```bash
make blacksky-test       # build_blacksky --check, node --test blacksky/test/*.test.mjs, pytest integration + e2e
```
