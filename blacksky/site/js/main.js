// BLACKSKY COMMAND — orchestration. One network, one current run, one event list, one playback cursor: the Theater, the Autopsy and the
// Arena are three views over the same state, so the scene, the timeline and every panel always show the same frame.
// Simulation, events, view state, validation and ranking come from the shared modules in ./shared (copied byte-for-byte from app/js by
// scripts/build_blacksky.py); nothing here re-implements the cascade model.
import { createStore } from "./state.js";
import { $, esc, pc, int, RM, GRID_NAME, ENGINE_NAME, toast } from "./util.js";
import { loadThree, webglAvailable } from "../shared/three/loader.js";
import { CameraRig } from "../shared/three/camera.js";
import { buildEvents, tripRounds } from "../shared/core/events.js";
import { viewState } from "../shared/core/encoding.js";
import { rankOf } from "../shared/core/scenario.js";
import { entityLabel } from "../shared/core/model.js";
import { getJSON, loadNetwork, runScenario, apiAvailable, apiBase } from "./engine.js";
import { deriveStages, stageAt } from "./stages.js";
import { BlackskyScene } from "./scene.js";
import { METRICS, EVIDENCE } from "./provenance.js";
import { CSS } from "./palette.js";
import { initLabels } from "./labels.js";
import { initTimeline } from "./timeline.js";
import { initTheater } from "./theater.js";
import { initAutopsy } from "./autopsy.js";
import { initArena } from "./arena.js";

const MODES = ["theater", "autopsy", "arena"];
const DWELL = { initial_outage: 1900, round: 650, islanding: 1500, load_shed: 1300, overload: 1700, trip: 1700, termination: 0 };
export const TABLE_POLICY = "all_overloaded";                 // the exhaustive DC tables were computed with this trip policy

async function boot() {
  const store = createStore({
    mode: MODES.includes(location.hash.slice(1)) ? location.hash.slice(1) : "theater",
    netId: null, net: null, loading: true, run: { status: "idle" }, playback: { i: 0, playing: false, speed: 1 },
    selection: null, hover: null, follow: true, camera: { mode: "orbit", schematic: false }, reduced: RM,
    api: { state: "checking" }, arena: { draft: [], engine: "browser-dc", policy: "all_overloaded" }, featured: [], featuredId: null,
  });
  const bx = { store, toast };
  window.__blacksky = bx;                                       // test hook (read-only use in e2e tests)

  // ------------------------------------------------------------------ renderer
  const canvas = $("gl"); let T = null, gs = null, rig = null;
  const fatal = (msg) => { const f = $("fatal"); f.hidden = false; f.textContent = msg; $("boot").hidden = true; };
  if (!webglAvailable()) fatal("WebGL is not available in this browser, so the 3-D scene cannot start. The panels and timeline still work.");
  else {
    try { T = await loadThree(); } catch { fatal("three.js could not be loaded (no local copy and no access to the pinned CDN build). The panels and timeline still work."); }
    if (T) { gs = new BlackskyScene(T, canvas); rig = new CameraRig(T, gs, canvas, { onChange: () => {} }); rig.reduced = RM; gs.reduced = RM; }
  }
  bx.gs = gs; bx.rig = rig;

  // ------------------------------------------------------------------ data
  const index = await getJSON("index.json");
  if (!index) { fatal("The network index (data/index.json) could not be loaded. Check that the data folder was deployed with the site."); document.body.dataset.ready = "error"; return; }
  bx.index = index;

  bx.loadNet = async (id) => {
    const s0 = store.get(); if (s0.netId === id && s0.net) return s0.net;
    stopPlayback(); if (inflight) inflight.abort(); ++seq;
    store.set({ loading: true });
    let net; try { net = await loadNetwork(id, index); } catch (e) { store.set({ loading: false }); toast(String(e.message || e)); return null; }
    if (gs) { gs.build(net.model, { schematic: store.get().camera.schematic }); rig.setScene(gs.L); panelOffset(); bx.overview(true); }
    $("net-sel").value = id;
    store.set({ netId: id, net, loading: false, run: { status: "idle" }, selection: null, hover: null, playback: { ...store.get().playback, i: 0, playing: false }, arena: { ...store.get().arena, draft: [] } });
    return net;
  };

  // ------------------------------------------------------------------ runs (one event model for all engines)
  let seq = 0, inflight = null;
  bx.run = async (cfg) => {
    const net = store.get().net; if (!net) return null;
    stopPlayback(); if (inflight) inflight.abort(); const id = ++seq, ctl = new AbortController(); inflight = ctl;
    store.set({ run: { status: "running", id, cfg } });
    await new Promise((r) => setTimeout(r, 0));
    let out;
    try { out = await runScenario(net, { ...cfg, signal: ctl.signal }); }
    catch (e) { if (id !== seq) return null; store.set({ run: { status: "error", id, cfg, error: String(e.message || e) } }); return null; }
    finally { if (inflight === ctl) inflight = null; }
    if (id !== seq) return null;
    const res = out.result, mode = res.mode === "ac" ? "ac" : "dc", k = res.outage.length;
    const events = buildEvents(res, net.model), trips = tripRounds(res), policy = res.policy || cfg.policy || TABLE_POLICY;
    const rank = mode === "dc" && policy === TABLE_POLICY && net.dists[k] ? rankOf(net.dists[k], res.metrics.S) : null;
    const ties = rank && rank.exact && !rank.zero ? net.dists[k].top.filter(([v]) => Math.abs(v - res.metrics.S) <= 1e-9).length : null;
    const run = { status: "done", id, cfg, grid: net.id, engine: out.engine, source: out.source, ms: out.ms, result: res, events, trips, rank, ties, mode, policy, k,
      stages: deriveStages(res, events, net.model, rank), label: cfg.label || `${GRID_NAME[net.id]} · {${res.outage.join(", ")}}` };
    store.set({ run, playback: { ...store.get().playback, i: 0, playing: false } });
    goEvent(0);
    return run;
  };
  bx.cancel = () => { if (inflight) { inflight.abort(); } };
  bx.sameSet = (a, b) => a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);

  // ------------------------------------------------------------------ playback
  let ptimer = 0;
  function stopPlayback() { clearTimeout(ptimer); ptimer = 0; const p = store.get().playback; if (p.playing) store.set({ playback: { ...p, playing: false } }); }
  function frameEvent(ev) {
    if (!gs || !rig) return; const s = store.get();
    if (ev.type === "termination") { bx.overview(); return; }
    const keys = ev.entities.length ? ev.entities : ev.type === "round" ? null : s.run.result.outage.map((l) => `branch:${l}`);
    if (keys) rig.frame(keys.filter((k) => s.net.model.byKey.has(k)).flatMap((k) => gs.entityPoints(k)), { minRadius: 10, ms: 800 });
  }
  function goEvent(i, { frame = true } = {}) {
    const s = store.get(); if (s.run.status !== "done") return; const n = s.run.events.length; i = Math.max(0, Math.min(n - 1, i));
    store.set({ playback: { ...s.playback, i } });
    if (frame && s.follow) frameEvent(s.run.events[i]);
  }
  function play() {
    const s = store.get(); if (s.run.status !== "done") return;
    const start = s.playback.i >= s.run.events.length - 1 ? 0 : s.playback.i;
    store.set({ playback: { ...s.playback, playing: true } }); goEvent(start);
    const tick = () => { const st = store.get(); if (!st.playback.playing) return;
      if (st.playback.i >= st.run.events.length - 1) { store.set({ playback: { ...st.playback, playing: false } }); return; }
      const ev = st.run.events[st.playback.i];
      ptimer = setTimeout(() => { if (!store.get().playback.playing) return; goEvent(store.get().playback.i + 1); tick(); }, (DWELL[ev.type] ?? 1000) / st.playback.speed); };
    tick();
  }
  Object.assign(bx, {
    goEvent, play, pause: stopPlayback, togglePlay: () => (store.get().playback.playing ? stopPlayback() : play()),
    step: (d) => { stopPlayback(); goEvent(store.get().playback.i + d); },
    reset: () => { stopPlayback(); goEvent(0, { frame: false }); bx.overview(); },
    replay: () => { stopPlayback(); goEvent(0, { frame: false }); play(); },
    setSpeed: (v) => store.set({ playback: { ...store.get().playback, speed: v } }),
    goStage: (id) => { const st = store.get().run.stages?.find((x) => x.id === id); if (st && st.occurred && st.eventIndex >= 0) { stopPlayback(); goEvent(st.eventIndex); } },
  });
  bx.currentEvent = () => { const s = store.get(); return s.run.status === "done" ? s.run.events[s.playback.i] : null; };
  bx.currentStage = () => { const s = store.get(); return s.run.status === "done" ? stageAt(s.run.stages, s.playback.i) : null; };

  // ------------------------------------------------------------------ view state (shared encoding) → scene
  let view = null;
  bx.frameIndex = () => { const ev = bx.currentEvent(); return ev ? ev.frame : null; };
  bx.view = () => view;
  bx.runOnNet = () => { const s = store.get(); return s.run.status === "done" && s.run.grid === s.netId ? s.run : null; };
  function computeView() {
    const s = store.get(); if (!s.net) return (view = null); const r = bx.runOnNet();
    view = r ? viewState(s.net.model, r.result, bx.frameIndex(), r.trips) : viewState(s.net.model, null, 0); return view;
  }
  function syncScene() {
    computeView(); if (!gs || !view) return; const s = store.get();
    gs.reduced = s.reduced; rig.reduced = s.reduced; gs.setView(view, { flow: true });
    gs.highlight("sel", s.selection); gs.highlight("hov", s.hover && s.hover !== s.selection ? s.hover : null); syncArm();
  }
  function syncArm() { if (!gs) return; const s = store.get(), r = bx.runOnNet(); gs.arm(s.mode === "arena" && !(r && bx.sameSet(r.result.outage, s.arena.draft)) ? s.arena.draft : []); }

  // ------------------------------------------------------------------ selection
  bx.label = (key) => entityLabel(store.get().net.model, key);
  bx.select = (key, { focus = false } = {}) => {
    const m = store.get().net?.model; const k = key && m && m.byKey.has(key) ? key : null;
    store.set({ selection: k }); if (focus && k) bx.focus(k);
  };
  bx.focus = (key) => { if (gs && key) rig.frame(gs.entityPoints(key), { minRadius: 16 }); };
  bx.frameKeys = (keys, minRadius = 8) => { if (gs && keys.length) rig.frame(keys.flatMap((k) => gs.entityPoints(k)), { minRadius }); };

  // ------------------------------------------------------------------ modes and routing (#theater, #autopsy, #arena)
  bx.setMode = (m) => { if (!MODES.includes(m)) return; store.set({ mode: m }); if (location.hash.slice(1) !== m) history.replaceState(null, "", `#${m}`); };
  window.addEventListener("hashchange", () => { const m = location.hash.slice(1); if (MODES.includes(m)) store.set({ mode: m }); });
  document.querySelectorAll(".modes a").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); bx.setMode(a.dataset.mode); }));
  $("net-sel").onchange = async (e) => { await bx.loadNet(e.target.value); };

  // ------------------------------------------------------------------ camera
  bx.setCameraMode = (m) => { if (!rig) return; if (m === "follow" && !store.get().selection) { toast("Select an entity to track it"); return; } rig.setMode(m); store.set({ camera: { ...store.get().camera, mode: m } }); };
  bx.setSchematic = (on) => { if (!gs) return; gs.build(store.get().net.model, { schematic: on }); rig.setSchematic(on); rig.setScene(gs.L); gs.resize(); if (!on) bx.overview(true); store.set({ camera: { ...store.get().camera, schematic: on, mode: on ? "orbit" : store.get().camera.mode } }); syncScene(); };
  // overview: the whole network from the south at 52° elevation, fitted to the part of the canvas that no panel covers
  bx.zoom = (dir) => { if (rig) { rig.anim = null; rig._zoom(dir * 320); } };        // buttons and +/- keys (touch screens have no wheel)
  bx.overview = (instant = false) => {
    if (!gs || !gs.L) return; const b = gs.L.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, sx = b.maxX - b.minX, sz = b.maxZ - b.minZ;
    if (store.get().camera.schematic) { rig.frame(gs.L.bus.map((p) => [p.x, p.top, p.z]), { ms: instant ? 0 : 800 }); return; }
    if (rig.mode === "recon") bx.setCameraMode("orbit");
    const r = canvas.getBoundingClientRect(), asp = Math.max(200, r.width - 2 * Math.abs(gs.offsetX || 0)) / Math.max(1, r.height), t = Math.tan((gs.persp.fov / 2) * Math.PI / 180), el = (52 * Math.PI) / 180;
    const dist = (across, deep) => Math.max(across / 2 / (t * asp * 0.82), (deep / 2 * Math.sin(el) + 1.5) / (t * 0.86), 8);
    const dS = dist(sx, sz), dE = dist(sz, sx);                     // view from the south, or from the east when that fits a portrait canvas better
    if (dE < dS * 0.85) rig.to([cx + dE * Math.cos(el), dE * Math.sin(el), cz], [cx, 0, cz], instant ? 0 : 800);
    else rig.to([cx, dS * Math.sin(el), cz + dS * Math.cos(el)], [cx, 0, cz], instant ? 0 : 800);
  };
  function panelOffset() {
    if (!gs) return; const s = store.get(), wide = innerWidth > 900, pw = wide ? ($(s.mode === "autopsy" ? "right" : "left").offsetWidth + 12) / 2 : 0;
    const dx = !wide ? 0 : s.mode === "autopsy" ? -pw : pw; document.documentElement.style.setProperty("--offx", `${dx}px`); if (dx !== gs.offsetX) { gs.setOffset(dx); rig._apply(); }
  }
  bx.panelOffset = panelOffset; addEventListener("resize", panelOffset);

  // ------------------------------------------------------------------ pointer picking
  if (gs) {
    let raf = 0, xy = null;
    canvas.addEventListener("pointermove", (e) => { if (rig.drag) return; xy = [e.offsetX, e.offsetY, e.pointerType]; if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (!xy) return;
      const k = gs.pick(xy[0], xy[1], xy[2] === "touch" ? 16 : 9); if (k !== store.get().hover) store.set({ hover: k }); canvas.classList.toggle("pointing", !!k); }); });
    canvas.addEventListener("pointerleave", () => { xy = null; if (store.get().hover) store.set({ hover: null }); });
    canvas.addEventListener("click", (e) => {
      if ((rig.lastDragMoved || 0) > 4) return;
      const k = gs.pick(e.offsetX, e.offsetY, e.pointerType === "touch" ? 16 : 10);
      if (k && k.startsWith("branch:") && store.get().mode === "arena" && (e.shiftKey || e.altKey)) { bx.toggleDraft(+k.split(":")[1]); return; }
      bx.select(k);
    });
    canvas.addEventListener("dblclick", (e) => { const k = gs.pick(e.offsetX, e.offsetY, 10); if (k && k.startsWith("branch:") && store.get().mode === "arena") bx.toggleDraft(+k.split(":")[1]); else if (k) bx.focus(k); });
  }

  // ------------------------------------------------------------------ keyboard
  window.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input:not([type=range]), textarea, select, [contenteditable]")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return; const s = store.get(), k = e.key;
    if (!$("help").hidden) { if (k === "Escape" || k === "?") bx.help(false); return; }
    if (s.camera.mode === "recon" && "wasdrfWASDRF".includes(k) && k.length === 1) return;
    if (e.target.type === "range" && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(k)) return;   // the scrubber handles its own keys
    if (k === " " && !(e.target.closest && e.target.closest("button, a"))) { e.preventDefault(); bx.togglePlay(); }
    else if (k === "ArrowRight" || k === "]") { e.preventDefault(); bx.step(1); }
    else if (k === "ArrowLeft" || k === "[") { e.preventDefault(); bx.step(-1); }
    else if (k === "Home") bx.reset();
    else if (k === "1" || k === "2" || k === "3") bx.setMode(MODES[+k - 1]);
    else if (k === "f" || k === "F") { if (s.selection) bx.focus(s.selection); }
    else if (k === "o" || k === "O") bx.overview();
    else if (k === "+" || k === "=") bx.zoom(-1);
    else if (k === "-" || k === "_") bx.zoom(1);
    else if (k === "?") bx.help(true);
    else if (k === "Escape") { if (!$("pop").hidden) bx.explain(null); else if (s.camera.mode === "recon") bx.setCameraMode("orbit"); else if (s.selection) bx.select(null); }
  });

  // ------------------------------------------------------------------ metric provenance popover
  const pop = $("pop");
  bx.explain = (key, anchor) => {
    const m = key && METRICS[key]; if (!m) { pop.hidden = true; return; }
    pop.innerHTML = `<h5>${esc(m.label)}</h5><dl><dt>Means</dt><dd>${esc(m.definition)}</dd><dt>Unit</dt><dd>${esc(m.unit)}</dd><dt>Source</dt><dd>${esc(m.source)}</dd><dt>Scope</dt><dd>${esc(m.scope)}</dd></dl>`;
    pop.hidden = false; const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = `${Math.max(12, Math.min(innerWidth - w - 12, r.left - 8))}px`; pop.style.top = `${r.bottom + h + 8 < innerHeight ? r.bottom + 6 : Math.max(12, r.top - h - 6)}px`;
  };
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-explain]");
    if (b) { e.stopPropagation(); bx.explain(pop.hidden || pop.dataset.k !== b.dataset.explain ? b.dataset.explain : null, b); pop.dataset.k = pop.hidden ? "" : b.dataset.explain; return; }
    if (!pop.hidden && !e.target.closest("#pop")) { pop.hidden = true; pop.dataset.k = ""; }
  });
  bx.ib = (key) => `<button class="ib" data-explain="${key}" aria-label="What is ${esc(METRICS[key].label)}?">i</button>`;

  // ------------------------------------------------------------------ help
  bx.help = (on) => {
    const h = $("help"); h.hidden = !on; if (!on) { $("help-btn").focus(); return; }
    $("help-card").innerHTML = `<div class="row" style="justify-content:space-between"><h3 id="help-h">BLACKSKY Command</h3><button class="btn sm" id="help-x">Close</button></div>
      <p class="note" style="margin:4px 0 10px">Three ways into the same run: <b>Theater</b> replays a cascade in five stages, <b>Autopsy</b> inspects every entity and event, <b>Arena</b> builds, validates, runs and ranks your own contingency. The scene, timeline and panels always show the same frame.</p>
      <table>${[["Space", "play / pause"], ["← → or [ ]", "previous / next event"], ["Home", "reset to the start"], ["1 2 3", "Theater / Autopsy / Arena"], ["drag · right-drag · wheel", "orbit · pan · zoom (Schematic: drag pans)"],
        ["Recon: W A S D R F", "fly; drag to look; Esc returns to Orbit"], ["click", "select an entity (labels, Autopsy)"], ["Arena: Shift+click, double-click", "add / remove a branch in the contingency"], ["F / O", "focus selection / overview"], ["+ / −", "zoom in / out (also the dock buttons)"], ["Esc", "close popover, leave Recon, clear selection"], ["?", "this help"]]
        .map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")}</table>
      <h4 style="margin:14px 0 6px;font-size:13px">Legend</h4><div id="help-legend" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px 14px;font-size:12px;color:var(--tx-2)">${legendItems().join("")}</div>
      <h4 style="margin:14px 0 4px;font-size:13px">What this is — and is not</h4>
      <ul class="note" style="margin:0;padding-left:18px">
        <li>Networks are the official MATPOWER IEEE 14/30/118-bus test cases. The 3-D layout is a synthetic (Kamada–Kawai) drawing, <b>not geography</b>; elevation shows voltage class.</li>
        <li>The cascade is a quasi-steady-state DC overload model with <b>synthetic thermal ratings</b>; AC results are stored or API runs of the Python Newton–Raphson model.</li>
        <li>S is the fraction of the test case's demand left unserved under this model. It is <b>not a probability of blackout</b> and not a real-world impact estimate.</li>
        <li>Ranks come from exhaustive DC tables of every k-branch set (k ≤ 4 on IEEE-14/30, k ≤ 3 on IEEE-118). AC results are never ranked against them.</li>
        <li>No live or real-time grid data is used. Nothing here ran on quantum hardware.</li></ul>
      ${gs ? `<p class="note" style="margin-top:10px">Renderer on this device: ${esc(gs.qualityLabel())}${gs.fps.value ? ` · ${gs.fps.value.toFixed(0)} fps while animating` : ""} · ${gs.info().calls} draw calls. Rendering adapts down on slow (software) renderers; results never depend on it.</p>` : ""}`;
    $("help-x").onclick = () => bx.help(false); $("help-x").focus();
  };
  $("help-btn").onclick = () => bx.help(true);
  $("help").addEventListener("click", (e) => { if (e.target.id === "help") bx.help(false); });

  // ------------------------------------------------------------------ chrome: mode tabs, status chips, readout, legend
  function renderChrome(s, ch) {
    if (ch.has("mode")) { document.querySelectorAll(".modes a").forEach((a) => a.toggleAttribute("aria-current", false) || (a.dataset.mode === s.mode && a.setAttribute("aria-current", "page")));
      $("left").hidden = s.mode === "autopsy"; $("right").hidden = s.mode !== "autopsy"; document.title = `BLACKSKY Command · ${s.mode[0].toUpperCase()}${s.mode.slice(1)}`; }
    if (ch.has("api")) { const a = s.api.state; $("api-dot").className = `dot ${a === "ok" ? "ok" : a === "checking" ? "wait" : ""}`;
      $("api-txt").textContent = a === "ok" ? "API online" : a === "checking" ? "API: checking" : "API offline";
      $("api-chip").title = a === "ok" ? `Python API reachable at ${apiBase()}: API DC/AC engines are available in the Arena.` : `No API at ${apiBase()} (static deployment, or blacksky/serve.py not running). Browser and stored engines still work.`; }
    if (ch.has("run") || ch.has("loading") || ch.has("net")) {
      const r = s.run, dot = $("eng-dot"), tx = $("eng-txt");
      if (s.loading) { dot.className = "dot wait"; tx.textContent = "loading network"; }
      else if (r.status === "running") { dot.className = "dot wait"; tx.textContent = `running · ${ENGINE_NAME[r.cfg.engine]}`; }
      else if (r.status === "error") { dot.className = "dot bad"; tx.textContent = "run failed"; }
      else if (r.status === "done") { dot.className = "dot ok"; tx.textContent = `${ENGINE_NAME[r.engine]} · ${r.ms < 1000 ? `${r.ms.toFixed(0)} ms` : `${(r.ms / 1000).toFixed(1)} s`}`; }
      else { dot.className = s.net ? "dot ok" : "dot"; tx.textContent = s.net ? "browser engine ready" : "engine loading"; }
      $("boot").hidden = !!s.net || !s.loading;
    }
  }
  function renderReadout() {
    const s = store.get(), el = $("readout"); if (!s.net || !view) { el.innerHTML = ""; return; }
    const r = bx.runOnNet(), f = view.frame, m = s.net.model, served = r ? view.loadServed : 1, dark = view.buses.filter((b) => !b.energized).length;
    const out = view.branches.filter((b) => b.state === "initial_outage" || b.state === "tripped").length, R = r ? r.result.frames.length : 0;
    const live = r ? r.events.filter((e) => e.type === "round" && e.frame === (f ? bx.frameIndex() : 0)).map((e) => e.values.energisedIslands)[0] : null;
    const src = r ? `${r.cfg.origin === "arena" ? "Arena" : "Theater"} · ${r.label}` : "Base case (no run)";
    el.innerHTML = `<div class="cell src"><div class="k">Showing</div><div class="v" title="${esc(src)}">${esc(src)}</div></div><div class="cell"><div class="k">Demand served ${bx.ib("S")}</div><div class="v" style="color:var(--lamp)">${pc(served)}</div><div class="lamp-bar"><i style="width:${(100 * served).toFixed(1)}%"></i></div></div>
      <div class="cell"><div class="k">Buses dark</div><div class="v">${dark}<span class="faint" style="font-size:12px"> / ${m.nBus}</span></div></div>
      <div class="cell opt"><div class="k">Branches out</div><div class="v">${out}<span class="faint" style="font-size:12px"> / ${m.nBranch}</span></div></div>
      <div class="cell opt"><div class="k">${live == null && f ? "Components" : "Islands"} ${bx.ib("islands")}</div><div class="v">${live ?? (f ? f.islands : 1)}</div></div>
      <div class="cell"><div class="k">Round ${bx.ib("rounds")}</div><div class="v">${r ? `${(bx.frameIndex() ?? 0) + 1}<span class="faint" style="font-size:12px"> / ${R}</span>` : "base"}</div></div>`;
  }
  function legendItems() {
    const s = store.get(), r = bx.runOnNet(), ac = r && r.mode === "ac", unknown = gs && gs.lampUnknown;
    return [
      `<span class="it"><span class="sw" style="background:${CSS.lamp}"></span><span>${unknown ? "lit = energised (per-bus curtailment not recorded)" : "lamp = demand served"}</span></span>`,
      `<span class="it"><span class="sw" style="background:${CSS.green}"></span><span>generator online</span></span>`,
      `<span class="it"><span class="sw" style="background:#a8742a"></span><span>80–100% of ${ac ? "AC" : "DC"} rating</span></span>`,
      `<span class="it"><span class="sw" style="background:${CSS.amber};height:5px"></span><span>above rating</span></span>`,
      `<span class="it"><span class="sw dash"></span><span>initial outage (T0)</span></span>`,
      `<span class="it"><span class="sw dash" style="opacity:.55;height:2px"></span><span>tripped by the cascade (R<i>n</i>)</span></span>`,
      `<span class="it"><span class="sw" style="background:${CSS.ice}"></span><span>selection</span></span>`,
      `<span class="it faint">layout synthetic, not geographic${s.net && s.net.model.kvs.length > 1 ? "; height = voltage class" : ""}</span>`];
  }
  let legendOpen = innerWidth >= 1600;
  function renderLegend() {
    const s = store.get(), el = $("legend"); if (!s.net) return; el.dataset.side = s.mode === "autopsy" ? "left" : "right"; el.classList.toggle("closed", !legendOpen);
    el.innerHTML = `<div class="lg-h"><span class="micro">Legend</span><button id="lg-t" aria-expanded="${legendOpen}">${legendOpen ? "Hide" : "Show"}</button></div>${legendOpen ? legendItems().join("") : ""}`;
    $("lg-t").onclick = () => { legendOpen = !legendOpen; renderLegend(); };
  }
  bx.legendItems = legendItems;

  // ------------------------------------------------------------------ store → everything
  store.sub((s, ch) => {
    renderChrome(s, ch); if (ch.has("mode")) panelOffset();
    if (["net", "run", "playback", "reduced", "mode"].some((k) => ch.has(k))) { syncScene(); renderReadout(); renderLegend(); }
    else {
      if (ch.has("selection") || ch.has("hover")) { if (gs) { gs.highlight("sel", s.selection); gs.highlight("hov", s.hover && s.hover !== s.selection ? s.hover : null); } }
      if (ch.has("arena") || ch.has("mode")) syncArm();
    }
    if (ch.has("selection") && s.camera.mode === "follow" && !s.selection) bx.setCameraMode("orbit");
  });

  // ------------------------------------------------------------------ render loop (draws only when something changed, or while flow animates)
  if (gs) {
    new ResizeObserver(() => { gs.resize(); rig._apply && rig.L && rig._apply(); }).observe($("stage"));
    let last = performance.now();
    const loop = (t) => { const dt = Math.min((t - last) / 1000, 0.05); last = t;
      if (!document.hidden && gs.model) { const s = store.get(); rig.update(dt, s.camera.mode === "follow" && s.selection ? gs.entityPos(s.selection) : null); if (gs.render(dt)) bx.onFrame && bx.onFrame(); }
      requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ panels
  initLabels(bx); initTimeline(bx); initTheater(bx); initAutopsy(bx); initArena(bx);
  if (innerWidth <= 900) { $("left").classList.add("collapsed"); $("right").classList.add("collapsed"); document.querySelectorAll(".sheet-toggle").forEach((b) => b.setAttribute("aria-expanded", "false")); }
  renderChrome(store.get(), new Set(["mode", "api", "run"]));

  // optional API (never required)
  apiAvailable().then((ok) => store.set({ api: { state: ok ? "ok" : "off" } }));

  // featured scenarios (from the stored data files; numbers are recomputed when they run)
  const feat = []; const add = async (grid, file, pick, title, sub) => { const d = await getJSON(file); const r = d && pick(d); if (r && r.dc) feat.push({ id: `${grid}:${r.dc.outage.join("-")}`, grid, outage: r.dc.outage, title, sub, hasAc: !!r.ac }); };
  await add("ieee118", "top_cascades_ieee118_k3.json", (d) => d[0], "Worst triple · IEEE 118", "Top of the exhaustive table of all 3-branch sets");
  await add("ieee118", "top_cascades_ieee118_k2.json", (d) => d[0], "Worst pair · IEEE 118", "Top of the exhaustive table of all 2-branch sets");
  await add("ieee30", "top_cascades_ieee30_k3.json", (d) => d[0], "Worst triple · IEEE 30", "Stored AC run available: Autopsy → Compare");
  await add("ieee30", "examples_ieee30_k3.json", (d) => d.isolation_only, "Isolation without cascade · IEEE 30", "Demand is lost at once; nothing trips");
  await add("ieee14", "examples_ieee14_k2.json", (d) => d.benign, "Absorbed outage · IEEE 14", "The network rides through: no trips, no lost demand");
  store.set({ featured: feat });
  bx.playFeatured = async (id, { autoplay = false } = {}) => {
    const f = store.get().featured.find((x) => x.id === id); if (!f) return;
    store.set({ featuredId: id }); await bx.loadNet(f.grid); const r = await bx.run({ engine: "browser-dc", outage: f.outage, policy: TABLE_POLICY, label: f.title });
    if (r) { if (autoplay && !store.get().reduced) play(); else bx.overview(); }
  };
  await bx.loadNet("ieee118");
  if (feat.length) await bx.playFeatured(feat[0].id);
  document.body.dataset.ready = "1";
}

boot().catch((e) => { document.body.dataset.ready = "error"; const f = document.getElementById("fatal"); f.hidden = false; f.textContent = `BLACKSKY could not start: ${e && e.message ? e.message : e}`; console.error(e); });
