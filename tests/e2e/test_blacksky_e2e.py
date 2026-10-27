"""End-to-end journeys through BLACKSKY COMMAND (blacksky/site) in headless Chromium.

Serves blacksky/site over plain HTTP (no API, as on a static deployment) and drives the three experiences: Theater stage navigation and
transport, Autopsy inspection and synchronisation, Arena build → validate → run → score → save → replay. Numbers are checked against the
data files (exhaustive tables, stored runs), never hard-coded. API behaviour is checked twice: with the real FastAPI app (blacksky/serve.py,
when fastapi/uvicorn are installed) and with an intercepted failing API. WebGL is software (SwiftShader); frame rates are not asserted."""
from __future__ import annotations
import functools, http.server, json, socket, socketserver, threading, time
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]
SITE = ROOT / "blacksky" / "site"
DATA = SITE / "data"
pw = pytest.importorskip("playwright.sync_api")


@pytest.fixture(scope="module")
def server():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    httpd = socketserver.ThreadingTCPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=str(SITE))); httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}/"
    httpd.shutdown()


@pytest.fixture(scope="module")
def browser():
    with pw.sync_playwright() as p:
        try:
            b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
        except Exception as e:  # noqa: BLE001
            pytest.skip(f"Chromium not available: {e}")
        yield b
        b.close()


def _open(browser, url, **ctx):
    page = browser.new_page(**ctx); errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    # the API probe is expected to 404 on a static server; every other console error is a failure
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "404" not in m.text and "GL Driver" not in m.text else None)
    page.goto(url); page.wait_for_selector("body[data-ready='1']", timeout=90000)
    return page, errors


def S(page, expr):
    return page.evaluate(f"(() => {{ const bx = window.__blacksky, s = bx.store.get(); return {expr}; }})()")


def J(name):
    return json.loads((DATA / name).read_text())


def test_theater_stages_transport_and_sync(server, browser):
    page, errors = _open(browser, server, viewport={"width": 1440, "height": 900})
    top = J("top_cascades_ieee118_k3.json")[0]["dc"]
    assert S(page, "s.mode") == "theater" and S(page, "s.netId") == "ieee118"
    assert sorted(S(page, "s.run.result.outage")) == sorted(top["outage"])
    assert abs(S(page, "s.run.result.metrics.S") - top["metrics"]["S"]) < 1e-9          # browser engine = stored Python run
    assert S(page, "s.run.rank.rank") == 1 and S(page, "s.run.rank.exact") is True
    assert S(page, "s.playback.i") == 0 and "Detect" in page.inner_text("#left")
    assert "API offline" in page.inner_text("#api-txt")                                   # static server: API absent, said so
    # stage rail: every occurred stage jumps the shared cursor to its first event; scene view follows the event's frame
    for st in ["trace", "cascade", "island", "assess"]:
        page.click(f"#left button[data-stage='{st}']"); page.wait_for_timeout(150)
        i = S(page, "s.playback.i"); assert i == S(page, f"s.run.stages.find((x) => x.id === '{st}').eventIndex")
        assert S(page, "bx.view().frameIndex") == S(page, "s.run.events[s.playback.i].frame")
        assert S(page, "document.getElementById('scrub').value") == str(i)
    assert "assess" in page.inner_text("#left .stagecard").lower()
    # transport: step back/forward, reset, scrub, play/pause, speed
    page.click("#tp-back"); assert S(page, "s.playback.i") == S(page, "s.run.events.length") - 2
    page.click("#tp-fwd"); assert S(page, "s.playback.i") == S(page, "s.run.events.length") - 1
    page.click("#tp-reset"); assert S(page, "s.playback.i") == 0
    page.fill("#scrub", "5"); page.dispatch_event("#scrub", "change"); assert S(page, "s.playback.i") == 5
    page.select_option("#tp-speed", "4"); assert S(page, "s.playback.speed") == 4
    page.click("#tp-play"); page.wait_for_timeout(900); assert S(page, "s.playback.i") > 5
    page.click("#tp-play"); i = S(page, "s.playback.i"); page.wait_for_timeout(1200); assert S(page, "s.playback.i") == i and S(page, "s.playback.playing") is False
    page.click("#tp-replay"); page.wait_for_timeout(50); assert S(page, "s.playback.playing") is True; page.click("#tp-play")
    # keyboard: arrows step, Space toggles, 2 switches mode
    page.click("#tp-reset"); page.locator("body").press("ArrowRight"); assert S(page, "s.playback.i") == 1
    page.locator("body").press("ArrowLeft"); assert S(page, "s.playback.i") == 0
    # camera controls: follow toggle, modes, schematic, zoom, overview
    page.click("#cam-follow"); assert S(page, "s.follow") is False; page.click("#cam-follow"); assert S(page, "s.follow") is True
    page.click("#cam-mode button[data-m='recon']"); assert S(page, "bx.rig.mode") == "recon"; page.click("#cam-mode button[data-m='orbit']")
    page.click("#cam-view button[data-v='schematic']"); assert S(page, "bx.rig.schematic") is True
    assert S(page, "bx.gs.camera === bx.gs.ortho"); page.click("#cam-view button[data-v='spatial']"); assert S(page, "bx.rig.schematic") is False
    d0 = S(page, "bx.rig.p.distanceTo(bx.rig.t)"); page.click("#cam-zin"); assert S(page, "bx.rig.p.distanceTo(bx.rig.t)") < d0
    # featured scenario with stages that do not occur
    page.select_option("#th-scn", label="Absorbed outage · IEEE 14"); page.wait_for_function("window.__blacksky.store.get().run.status === 'done' && window.__blacksky.store.get().netId === 'ieee14'")
    assert S(page, "s.run.stages.filter((x) => !x.occurred).map((x) => x.id)") == ["trace", "cascade", "island"]
    assert "did not occur in this run" in page.inner_text("#left").lower()
    assert not errors, errors
    page.close()


def test_autopsy_inspection_and_network_switch(server, browser):
    page, errors = _open(browser, server + "#autopsy", viewport={"width": 1440, "height": 900})
    assert S(page, "s.mode") == "autopsy" and page.is_visible("#right") and not page.is_visible("#left")
    page.fill("#au-find", "branch 67"); page.press("#au-find", "Enter")
    assert S(page, "s.selection") == "branch:67"; txt = page.inner_text("#au-body").lower()
    assert "line 67" in txt and "initial outage (t0)" in txt and "loading by round" in txt
    # an entity tripped by the cascade: its trip round matches the engine's trips map, and the timeline syncs from its event list
    l = S(page, "[...s.run.trips.keys()][0]"); rd = S(page, f"s.run.trips.get({l})")
    page.fill("#au-find", f"branch {l}"); page.press("#au-find", "Enter")
    assert f"tripped in round {rd}" in page.inner_text("#au-body")
    page.locator("#au-body [data-ev]").first.click(); ev = S(page, "s.run.events[s.playback.i]")
    assert f"branch:{l}" in ev["entities"]
    # neighbours navigate the selection
    page.locator("#au-body button[data-key^='bus:']").first.click(); assert S(page, "s.selection").startswith("bus:")
    # events: filter + search
    page.click("#au-t-events"); n_all = S(page, "s.run.events.filter((e) => e.type !== 'round').length")
    assert f"{n_all} of" in page.inner_text("#au-list").lower()
    page.click("#au-body button[data-type='overload']"); assert S(page, "document.querySelector(\"#au-body button[data-type='overload']\").getAttribute('aria-pressed')") == "false"
    page.fill("#au-q", "tripped"); shown = page.locator("#au-list [data-ev]").count()
    assert shown == S(page, "s.run.events.filter((e) => e.type === 'trip').length")              # every trip event title says "tripped"
    page.click("#au-body button[data-type='trip']"); assert page.locator("#au-list [data-ev]").count() == 0
    # islands at the final frame, compare initial vs final, findings report
    page.click("#tp-reset"); page.keyboard.press("End"); S(page, "bx.goEvent(s.run.events.length - 1)")
    page.click("#au-t-islands"); assert "energised island" in page.inner_text("#au-body").lower()
    page.click("#au-t-compare"); t = page.inner_text("#au-body").lower(); assert "initial vs final" in t and "tripped in round 1" in t
    page.click("#au-t-findings"); md = page.input_value("#au-md")
    assert "not a blackout probability" in md and "Metric definitions" in md and "1,055,240" in md
    # network switch clears the selection and the run; no stale entity survives
    S(page, "bx.select('bus:100')"); page.select_option("#net-sel", "ieee14")
    page.wait_for_function("window.__blacksky.store.get().netId === 'ieee14' && !window.__blacksky.store.get().loading")
    assert S(page, "s.selection") is None and S(page, "s.run.status") == "idle"
    page.click("#au-t-entity"); page.fill("#au-find", "bus 100"); page.press("#au-find", "Enter"); assert S(page, "s.selection") is None
    assert not errors, errors
    page.close()


def test_arena_build_validate_run_score_save_replay(server, browser):
    page, errors = _open(browser, server + "#arena", viewport={"width": 1280, "height": 860})
    d = J("dist_ieee118_k3.json"); o = sorted(d["top"][0][1])
    assert "Waiting for a contingency" in page.inner_text("#left") and page.is_disabled("#ar-run")
    page.fill("#ar-add", ", ".join(map(str, o))); page.press("#ar-add", "Enter")
    assert sorted(S(page, "s.arena.draft")) == o and "Valid contingency" in page.inner_text("#left")
    # API engine without an API: error, run disabled
    page.select_option("#ar-engine", "api-dc"); assert "API is not reachable" in page.inner_text("#left") and page.is_disabled("#ar-run")
    page.select_option("#ar-engine", "browser-dc"); assert page.is_enabled("#ar-run")
    # invalid input is rejected with a message
    page.fill("#ar-add", "999"); page.press("#ar-add", "Enter"); assert "Unknown branch index 999" in page.inner_text("#toast")
    page.click("#ar-run"); page.wait_for_function("window.__blacksky.store.get().run.status === 'done'")
    assert S(page, "s.run.rank.rank") == 1 and S(page, "s.run.cfg.origin") == "arena"
    left = page.inner_text("#left"); assert "100.0" in left and "score = 100 × (1 − (rank − 1) / N)" in left and "Your set is the reference set" in left
    # a mid-table set: score equals the defined formula of the histogram rank
    S(page, "bx.store.set({ arena: { ...s.arena, draft: [0, 1, 2] } })"); page.click("#ar-run"); page.wait_for_function("window.__blacksky.store.get().run.result && window.__blacksky.store.get().run.result.outage.join() === '0,1,2'")
    r = S(page, "s.run.rank"); Sres = S(page, "s.run.result.metrics.S")
    if not r["zero"]:
        expect = round(1000 * (1 - (r["rank"] - 1) / r["N"])) / 10; assert f"{expect:.1f}" in page.inner_text("#left")
    else:
        assert Sres == 0 and "no demand lost" in page.inner_text("#left")
    # AC (stored) on IEEE-30's worst triple: shown, never scored
    page.select_option("#ar-net", "ieee30"); page.wait_for_function("window.__blacksky.store.get().netId === 'ieee30' && !window.__blacksky.store.get().loading")
    t30 = J("top_cascades_ieee30_k3.json")[0]
    S(page, f"bx.store.set({{ arena: {{ ...s.arena, draft: {t30['dc']['outage']}, engine: 'stored-ac' }} }})"); page.click("#ar-run")
    page.wait_for_function("window.__blacksky.store.get().run.mode === 'ac'")
    assert abs(S(page, "s.run.result.metrics.S") - t30["ac"]["metrics"]["S"]) < 1e-12 and S(page, "s.run.rank") is None
    assert "Unranked" in page.inner_text("#left")
    # save, reload, the attempt persists; replay re-runs it
    page.click("#ar-save"); assert S(page, "JSON.parse(localStorage.getItem('blacksky.arena.attempts.v1')).length") == 1
    page.reload(); page.wait_for_selector("body[data-ready='1']", timeout=90000)
    assert page.locator("#left [data-replay]").count() == 1
    page.locator("#left [data-replay]").first.click(); page.wait_for_function("window.__blacksky.store.get().run.mode === 'ac' && window.__blacksky.store.get().netId === 'ieee30'")
    assert not errors, errors
    page.close()


def test_api_failure_is_reported_not_hidden(server, browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 860})
    ctx.route("**/api/health", lambda r: r.fulfill(status=200, content_type="application/json", body='{"status":"ok"}'))
    ctx.route("**/api/cascade", lambda r: r.fulfill(status=500, content_type="application/json", body='{"detail":"engine crashed (simulated)"}'))
    page = ctx.new_page(); page.goto(server + "#arena"); page.wait_for_selector("body[data-ready='1']", timeout=90000)
    assert "API online" in page.inner_text("#api-txt")
    S(page, "bx.store.set({ arena: { ...s.arena, draft: [0, 5], engine: 'api-dc' } })"); page.wait_for_timeout(100)
    page.select_option("#ar-net", "ieee14"); page.wait_for_function("window.__blacksky.store.get().netId === 'ieee14'")
    S(page, "bx.store.set({ arena: { ...s.arena, draft: [0, 5], engine: 'api-dc' } })"); page.click("#ar-run")
    page.wait_for_function("window.__blacksky.store.get().run.status === 'error'")
    assert "API 500: engine crashed (simulated)" in page.inner_text("#left") and "run failed" in page.inner_text("#eng-txt")
    ctx.close()


def test_reduced_motion_and_phone_layout(server, browser):
    page, errors = _open(browser, server, viewport={"width": 390, "height": 844}, reduced_motion="reduce", is_mobile=True, has_touch=True)
    assert S(page, "s.reduced") is True and S(page, "bx.rig.reduced") is True
    assert page.evaluate("document.documentElement.scrollWidth") <= 390
    assert S(page, "document.getElementById('left').classList.contains('collapsed')") is True
    page.click("#th-sheet"); assert S(page, "document.getElementById('left').classList.contains('collapsed')") is False
    page.click("#left button[data-stage='assess']"); assert S(page, "bx.currentStage().id") == "assess"
    assert not errors, errors
    page.close()


def _free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def test_live_api_through_blacksky_server(browser):
    pytest.importorskip("fastapi"); uvicorn = pytest.importorskip("uvicorn")
    from blacksky.serve import app
    port = _free_port(); srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    th = threading.Thread(target=srv.run, daemon=True); th.start()
    for _ in range(100):
        if srv.started: break
        time.sleep(0.1)
    try:
        page, errors = _open(browser, f"http://127.0.0.1:{port}/#arena", viewport={"width": 1280, "height": 860})
        page.wait_for_function("window.__blacksky.store.get().api.state === 'ok'")
        page.select_option("#ar-net", "ieee14"); page.wait_for_function("window.__blacksky.store.get().netId === 'ieee14' && !window.__blacksky.store.get().loading")
        S(page, "bx.store.set({ arena: { ...s.arena, draft: [0, 5], engine: 'api-ac' } })"); page.click("#ar-run")
        page.wait_for_function("window.__blacksky.store.get().run.status === 'done' || window.__blacksky.store.get().run.status === 'error'", timeout=120000)
        assert S(page, "s.run.status") == "done", S(page, "s.run.error")
        assert S(page, "s.run.mode") == "ac" and S(page, "s.run.rank") is None and S(page, "s.run.result.metrics.S") > 0.4   # IEEE-14 {0,5}: DC 0 %, AC ≈ 47 %
        # IEEE-118 is precomputed-only on the API: a non-stored set returns 409 and the page says so
        page.select_option("#ar-net", "ieee118"); page.wait_for_function("window.__blacksky.store.get().netId === 'ieee118' && !window.__blacksky.store.get().loading")
        S(page, "bx.store.set({ arena: { ...s.arena, draft: [3, 4, 5], engine: 'api-dc' } })"); page.click("#ar-run")
        page.wait_for_function("window.__blacksky.store.get().run.status === 'error'", timeout=60000)
        assert "API 409" in page.inner_text("#left")
        assert not [e for e in errors if "409" not in e], errors
        page.close()
    finally:
        srv.should_exit = True; th.join(timeout=10)
