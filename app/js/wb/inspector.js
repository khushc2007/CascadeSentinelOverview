// Inspector (selected entity), Scenario (contingency, engine, validation, result, save/export), Compare (two saved runs), header status,
// and the Model & data drawer. Fields that the data does not provide are shown as "Unavailable", never estimated.
import { findingsMarkdown, compareRows } from "../core/scenario.js";
const $ = (id) => document.getElementById(id);
const pc = (x, d = 1) => (x == null ? null : `${(100 * x).toFixed(d)}%`);
const NA = `<dd class="na">Unavailable</dd>`;
const dd = (v) => (v == null || v === "" ? NA : `<dd>${v}</dd>`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function initInspector(wb) {
  const { store } = wb;
  // ================================================================ inspector
  function renderInspector() {
    const s = store.get(), m = s.model, v = wb.view(), box = $("ins"); if (!m || !v) return;
    if (!s.selection) { box.innerHTML = `<p class="faint" style="margin:0;font-size:12px">Select a bus, branch, generator or demand column in the scene or the explorer. <span class="kbd">Shift</span>+click or double-click a branch to add it to the contingency.</p>`; return; }
    const e = m.byKey.get(s.selection); if (!e) { box.innerHTML = ""; return; }
    const res = s.run.status === "done" ? s.run.result : null, evs = res ? s.run.events.filter((x) => x.entities.includes(e.key)) : [];
    let h = "";
    if (e.kind === "branch") {
      const st = v.branches[e.l], inC = s.contingency.includes(e.l);
      const stateTxt = { initial_outage: "Out of service · initial outage", tripped: `Out of service · tripped in round ${st.tripRound}`, overload: "In service · above rating (trips this round)", warning: "In service · 80–100% of rating", deenergized: "De-energised (both ends without generation)", normal: "In service", unavailable: "Out of service in the base case" }[st.state];
      const dir = st.flow_mw == null ? null : st.flow_mw >= 0 ? `bus ${e.fromId} → bus ${e.toId}` : `bus ${e.toId} → bus ${e.fromId}`;
      h = `<div class="ins-title">${e.transformer ? "Transformer" : "Line"} ${e.l}<small>${e.key} · bus ${e.fromId} – bus ${e.toId}</small></div>
        <dl class="kv"><dt>state</dt><dd>${stateTxt}</dd>${["initial_outage", "tripped", "unavailable"].includes(st.state) ? `<dt>DC flow</dt><dd>0 MW (open)</dd>` : `<dt>DC flow</dt>${dd(st.flow_mw == null ? null : `${Math.abs(st.flow_mw).toFixed(1)} MW`)}<dt>direction</dt>${dd(dir)}
        <dt>loading (${res?.mode === "ac" ? "AC, |S| / MVA rating" : "DC, |P| / MW rating"})</dt>${dd(pc(st.u))}`}<dt>DC rating</dt><dd>${e.rating_dc_mw.toFixed(1)} MW</dd><dt>AC rating</dt><dd>${e.rating_ac_mva.toFixed(1)} MVA</dd>
        <dt>base-case loading</dt><dd>${pc(e.base_loading_dc)}</dd><dt>reactance x</dt><dd>${e.x_pu.toFixed(5)} p.u.</dd>${e.parallel_count > 1 ? `<dt>parallel circuits</dt><dd>${e.parallel_count}</dd>` : ""}</dl>
        <div class="row"><button class="btn sm" id="i-add">${inC ? "Remove from contingency" : "Add to contingency"}</button><button class="btn sm" id="i-focus">Focus</button><button class="btn sm" id="i-nb">Endpoints</button><button class="btn sm" id="i-hood" aria-pressed="${!!s.layers.neighbourhood}">${s.layers.neighbourhood ? "Show whole network" : "Neighbourhood (2 hops)"}</button></div>`;
    } else if (e.kind === "bus") {
      const st = v.buses[e.i], served = st.served_fraction;
      h = `<div class="ins-title">Bus ${e.id}<small>${e.key}${e.is_slack ? " · base-case slack" : ""}</small></div>
        <dl class="kv"><dt>state</dt><dd>${st.energized ? "energised" : "de-energised (no generation in its island)"}</dd><dt>island</dt>${dd(st.component == null ? (res ? null : "connected network") : st.mainIsland ? "main island" : `island ${st.component}`)}
        <dt>demand (λ = 1.10)</dt><dd>${e.load_mw.toFixed(1)} MW</dd><dt>served</dt>${dd(served == null ? null : `${(e.load_mw * served).toFixed(1)} MW (${pc(served)})`)}
        <dt>base voltage</dt>${dd(e.base_kv ? `${e.base_kv} kV` : null)}<dt>generators</dt><dd>${e.gens.length ? e.gens.map((g) => `G${g}`).join(", ") : "none"}</dd>
        <dt>branches</dt><dd>${e.branches.length}</dd></dl>
        <div class="chips">${e.branches.map((l) => `<button class="btn sm" data-goto="branch:${l}" title="${esc(wb.entityLabel(`branch:${l}`))}">${l}</button>`).join("")}</div>
        <div class="row"><button class="btn sm" id="i-focus">Focus</button><button class="btn sm" id="i-hood" aria-pressed="${!!s.layers.neighbourhood}">${s.layers.neighbourhood ? "Show whole network" : "Neighbourhood (2 hops)"}</button>${e.gens.length ? `<button class="btn sm" data-goto="gen:${e.gens[0]}">Generator</button>` : ""}${e.load_mw > 0 ? `<button class="btn sm" data-goto="load:${e.id}">Demand</button>` : ""}</div>`;
    } else if (e.kind === "gen") {
      const st = v.gens[e.g];
      h = `<div class="ins-title">Generator ${e.g}<small>${e.key} · at bus ${e.busId}</small></div>
        <dl class="kv"><dt>state</dt><dd>${st.energized ? "energised" : "de-energised island"}</dd><dt>Pmax</dt><dd>${e.pmax_mw.toFixed(1)} MW</dd><dt>Pmin</dt><dd>${e.pmin_mw.toFixed(1)} MW</dd>
        <dt>base dispatch (lossless)</dt><dd>${e.pg0_mw.toFixed(1)} MW</dd><dt>dispatch at this event</dt>${dd(res ? (st.pg_mw == null ? null : `${st.pg_mw.toFixed(1)} MW`) : `${e.pg0_mw.toFixed(1)} MW`)}<dt>Q limits, voltage set-point</dt>${NA}</dl>
        <div class="row"><button class="btn sm" data-goto="bus:${e.busId}">Bus ${e.busId}</button><button class="btn sm" id="i-focus">Focus</button></div>`;
    } else {
      const f = v.buses[e.bus].served_fraction;
      h = `<div class="ins-title">Demand at bus ${e.busId}<small>${e.key}</small></div>
        <dl class="kv"><dt>demand (λ = 1.10)</dt><dd>${e.demand_mw.toFixed(1)} MW</dd><dt>served</dt>${dd(f == null ? null : `${(e.demand_mw * f).toFixed(1)} MW`)}<dt>shed</dt>${dd(f == null ? null : `${(e.demand_mw * (1 - f)).toFixed(1)} MW (${pc(1 - f)})`)}
        <dt>reactive demand</dt>${NA}<dt>customers / location</dt>${NA}</dl>
        <p class="faint" style="margin:0;font-size:11.5px">A test-case load: an aggregate demand at a bus, not a known town or customer group.</p>
        <div class="row"><button class="btn sm" data-goto="bus:${e.busId}">Bus ${e.busId}</button><button class="btn sm" id="i-focus">Focus</button></div>`;
    }
    if (evs.length) h += `<div><div class="micro" style="margin-bottom:4px">events involving it</div>${evs.map((x) => `<button class="btn sm" data-ev="${x.i}" style="margin:0 4px 4px 0">R${x.round} · ${esc(x.title)}</button>`).join("")}</div>`;
    h += `<details><summary class="faint" style="cursor:pointer;font-size:11.5px">Provenance</summary><p class="faint" style="font-size:11.5px;margin:6px 0 0">Topology and demand: official MATPOWER 8.1 ${m.id} (commit ${String(m.provenance.matpower_commit).slice(0, 12)}), loads scaled by λ = 1.10. Ratings: synthetic (${esc(m.ratingFamily)}, docs/RATING_EXTENSION.md). Flows: DC power flow of the cascade engine${res && !res.frames[0].flow ? " (not returned by the API for this result)" : ""}. Position in the scene: synthetic layout.</p></details>`;
    box.innerHTML = h;
    const sel = s.selection;
    box.querySelectorAll("[data-goto]").forEach((b) => (b.onclick = () => wb.select(b.dataset.goto, { focus: true })));
    box.querySelectorAll("[data-ev]").forEach((b) => (b.onclick = () => { wb.stop(); wb.goEvent(+b.dataset.ev); }));
    const f = $("i-focus"); if (f) f.onclick = () => wb.focus(sel);
    const a = $("i-add"); if (a) a.onclick = () => wb.toggleContingency(e.l);
    const hood = $("i-hood"); if (hood) hood.onclick = () => wb.toggleNeighbourhood();
    const nb = $("i-nb"); if (nb) nb.onclick = () => wb.rig && wb.rig.frame([wb.gs.entityPos(`bus:${e.fromId}`), wb.gs.entityPos(`bus:${e.toId}`)], { minRadius: 6 });
  }

  // ================================================================ scenario
  function renderScenario() {
    const s = store.get(), m = s.model, box = $("scn"); if (!m) return; const v = wb.validate(), r = s.run;
    const ranSame = r.status === "done" && wb.sameSet(r.result.outage, s.contingency);
    const engines = [["browser-dc", "Browser · DC (JS engine)", true, ""], ["pre-ac", "Precomputed · AC (stored Python run)", wb.acPrecomputed(), " — not stored for this set"],
      ["api-dc", "API · DC (Python)", s.api.available, " — API not reachable"], ["api-ac", "API · AC (Python)", s.api.available, " — API not reachable"]];
    let h = `<dl class="kv"><dt>network</dt><dd>${m.id.toUpperCase().replace("IEEE", "IEEE-")} · ${m.nBus} buses · ${m.nBranch} branches · ${m.gens.length} generators</dd><dt>source data</dt><dd>MATPOWER 8.1 (official)</dd></dl>
      <div><div class="micro" style="margin-bottom:4px">contingency · k = ${s.contingency.length}</div><div class="chips">${s.contingency.length ? s.contingency.map((l) => `<span class="cchip">${l} · ${m.branches[l].fromId}–${m.branches[l].toId}<button aria-label="Remove branch ${l}" data-rm="${l}">×</button></span>`).join("") : `<span class="faint" style="font-size:12px">Add branches from the scene (Shift+click), the explorer (+) or a table scenario.</span>`}</div></div>
      <div class="row">${s.contingency.length ? `<button class="btn sm" id="s-clear">Clear</button>` : ""}<button class="btn sm" id="s-worst">Worst ${s.tableKs.includes(3) ? 3 : s.tableKs.slice(-1)[0] ?? ""}-set from table</button></div>
      <label class="micro" for="s-engine">engine</label><select class="sel" id="s-engine">${engines.map(([k, n, ok, why]) => `<option value="${k}" ${s.config.engine === k ? "selected" : ""} ${ok || s.config.engine === k ? "" : "disabled"}>${n}${ok ? "" : why}</option>`).join("")}</select>
      <label class="micro" for="s-policy">trip policy</label><select class="sel" id="s-policy"><option value="all_overloaded" ${s.config.policy === "all_overloaded" ? "selected" : ""}>all overloaded branches per round (default)</option><option value="most_overloaded_first" ${s.config.policy === "most_overloaded_first" ? "selected" : ""}>most overloaded branch first</option></select>
      <dl class="kv"><dt>stress λ · trip factor · max rounds</dt><dd>1.10 · ${m.config.trip_factor} · ${m.config.max_rounds}</dd><dt>ratings</dt><dd>synthetic (${esc(m.ratingFamily)})</dd><dt>execution</dt><dd>${{ "browser-dc": "computed in this browser", "pre-ac": "read from the data files", "api-dc": "sent to the API (precomputed first, else live)", "api-ac": "sent to the API (precomputed first, else live)" }[s.config.engine]}</dd></dl>
      ${v.errors.map((x) => `<div class="msg err">${esc(x)}</div>`).join("")}${v.warnings.map((x) => `<div class="msg wrn">${esc(x)}</div>`).join("")}${v.info.map((x) => `<div class="msg inf">${esc(x)}</div>`).join("")}
      <div class="row"><button class="btn primary" id="s-run" ${v.ok && r.status !== "running" ? "" : "disabled"}>${r.status === "running" ? "Running…" : "Run analysis"}</button>${r.status === "running" && s.config.engine !== "browser-dc" ? `<button class="btn sm" id="s-cancel">Cancel</button>` : ""}</div>`;
    if (r.status === "error") h += `<div class="msg err"><b>Run failed.</b> ${esc(r.error)}<br><span class="faint">No result is shown in its place.</span></div>`;
    if (r.status === "done") {
      const M = r.result.metrics;
      h += `<div style="border-top:1px solid var(--rule);padding-top:10px;display:grid;gap:8px">
        <div class="micro">result ${ranSame ? "" : "· <span style='color:var(--warn)'>for a different contingency than selected</span>"}</div>
        <div class="res"><div><span class="micro">S</span><b>${pc(M.S)}</b><span class="faint" style="font-size:11px">unserved at end</span></div><div><span class="micro">S₀</span><b>${pc(M.S0)}</b><span class="faint" style="font-size:11px">initial islanding</span></div><div><span class="micro">C = S − S₀</span><b>${pc(M.C)}</b><span class="faint" style="font-size:11px">by the cascade</span></div></div>
        <div class="splitbar" aria-hidden="true"><i style="width:${100 * M.S0}%;background:var(--warn)"></i><i style="width:${100 * M.C}%;background:var(--fail)"></i></div>
        ${M.S_total != null && Math.abs(M.S_total - M.S) > 1e-9 ? `<div class="msg wrn">AC interval: S between ${pc(M.S)} (load-shed ladder) and ${pc(M.S_total)} (failed islands fully lost).</div>` : ""}
        <dl class="kv"><dt>status · rounds</dt><dd>${M.status} · ${M.rounds}</dd><dt>secondary trips</dt><dd>${(r.result.trips_per_round || []).flat().length}</dd><dt>rank</dt>${dd(r.rank ? (r.rank.zero ? `no demand lost (tied with ${r.rank.tiedZero.toLocaleString("en-US")})` : `${r.rank.exact ? "#" : "≈#"}${r.rank.rank.toLocaleString("en-US")} of ${r.rank.N.toLocaleString("en-US")}`) : null)}
        <dt>engine</dt><dd>${esc(r.engineLabel.split(" (")[0])}</dd><dt>source</dt><dd>${esc(r.source)}</dd><dt>time</dt>${dd(r.ms == null ? null : `${r.ms.toFixed(r.ms < 10 ? 2 : 0)} ms`)}</dl>
        <p class="faint" style="margin:0;font-size:11.5px">S is the fraction of the test case's base demand unserved at termination under this quasi-steady-state model. It is not a blackout probability or a real-world impact estimate.</p>
        <div class="row"><button class="btn sm" id="s-save">Save</button><button class="btn sm" id="s-export">Export findings</button><button class="btn sm" id="s-replay">Replay</button>
          ${r.result.mode !== "ac" && wb.acAvailable() ? `<button class="btn sm" id="s-dcac" title="Run the same set with the AC model and compare">Compare DC vs AC</button>` : ""}</div></div>`;
    }
    box.innerHTML = h;
    box.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => wb.toggleContingency(+b.dataset.rm)));
    const on = (id, f) => { const el = $(id); if (el) el.onclick = f; };
    on("s-clear", () => wb.setContingency([])); on("s-run", () => wb.run()); on("s-cancel", () => wb.cancel()); on("s-save", () => wb.save()); on("s-replay", () => wb.play()); on("s-export", () => exportFindings()); on("s-dcac", () => wb.compareDcAc());
    on("s-worst", () => { const k = s.tableKs.includes(3) ? 3 : s.tableKs.slice(-1)[0]; if (k) wb.loadSet(s.gridId, s.dists[k].top[0][1], false); });
    $("s-engine").onchange = (e) => store.set({ config: { ...store.get().config, engine: e.target.value } });
    $("s-policy").onchange = (e) => store.set({ config: { ...store.get().config, policy: e.target.value } });
  }
  function exportFindings() {
    const s = store.get(), r = s.run; if (r.status !== "done") return;
    const md = findingsMarkdown({ model: s.model, scenario: { result: r.result, engineLabel: r.engineLabel, source: r.source }, events: r.events, rank: r.rank,
      evidence: r.engine === "api-ac" || r.engine === "api-dc" ? "measured (Python engine via the API)" : "recomputation of the measured DC model in this browser (parity-tested JS port)" });
    $("modal-t").textContent = "Findings (Markdown)"; $("modal-b").innerHTML = `<textarea id="md" readonly aria-label="Findings text"></textarea><div class="row"><button class="btn primary sm" id="md-copy">Copy to clipboard</button><span class="faint" style="font-size:12px">Select-all and copy also works.</span></div>`;
    $("md").value = md; $("modal").hidden = false; $("md").focus(); $("md").select();
    $("md-copy").onclick = () => { navigator.clipboard?.writeText(md).then(() => wb.toast("Copied"), () => { $("md").select(); wb.toast("Clipboard blocked here: the text is selected, press Ctrl/Cmd-C"); }) ?? ($("md").select()); };
  }
  $("modal-x").onclick = () => ($("modal").hidden = true);
  $("modal").addEventListener("click", (e) => { if (e.target.id === "modal") $("modal").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { $("modal").hidden = true; $("diag").hidden = true; $("h-diag").setAttribute("aria-expanded", "false"); } });

  // ================================================================ compare
  function renderCompare() {
    const s = store.get(), box = $("cmp"); $("cmp-n").textContent = s.saved.length ? `(${s.saved.length})` : "";
    if (s.saved.length < 2) { box.innerHTML = `<p class="faint" style="margin:0;font-size:12px">Save at least two runs to compare them. The camera stays where it is when you switch between them, so the same region is seen under both scenarios.</p>${s.saved.length ? `<div class="row"><button class="btn sm" data-show="${s.saved[0].id}">Show ${s.saved[0].id}</button></div>` : ""}`; bindShow(box); return; }
    const a = s.saved.find((x) => x.id === s.compare.a) || s.saved[s.saved.length - 2], b = s.saved.find((x) => x.id === s.compare.b) || s.saved[s.saved.length - 1];
    const opt = (sel) => s.saved.map((x) => `<option value="${x.id}" ${x.id === sel ? "selected" : ""}>${x.id} · {${x.outage.join(",")}}</option>`).join("");
    const rows = compareRows(a, b);
    box.innerHTML = `<div class="row"><select class="sel" id="c-a" aria-label="Run A">${opt(a.id)}</select><select class="sel" id="c-b" aria-label="Run B">${opt(b.id)}</select></div>
      <table class="cmp"><thead><tr><th></th><th>A · ${a.id}</th><th>B · ${b.id}</th></tr></thead><tbody>${rows.map(([n, x, y]) => `<tr><td>${n}</td><td class="${x !== y ? "diff" : ""}">${esc(x)}</td><td class="${x !== y ? "diff" : ""}">${esc(y)}</td></tr>`).join("")}</tbody></table>
      <div class="row"><button class="btn sm" data-show="${a.id}" aria-pressed="${s.compare.showing === a.id}">Show A</button><button class="btn sm" data-show="${b.id}" aria-pressed="${s.compare.showing === b.id}">Show B</button><span class="faint" style="font-size:11.5px">${s.compare.showing ? `showing ${s.compare.showing}` : ""}</span></div>`;
    $("c-a").onchange = (e) => store.set({ compare: { ...store.get().compare, a: e.target.value, b: b.id } });
    $("c-b").onchange = (e) => store.set({ compare: { ...store.get().compare, b: e.target.value, a: a.id } });
    bindShow(box);
  }
  const bindShow = (box) => box.querySelectorAll("[data-show]").forEach((x) => (x.onclick = () => wb.show(store.get().saved.find((y) => y.id === x.dataset.show))));

  // ================================================================ header + diagnostics
  function renderHeader() {
    const s = store.get(), m = s.model; if (!m) return; const r = s.run;
    $("h-cont").textContent = s.contingency.length ? `k = ${s.contingency.length} · ${s.contingency.map((l) => `${m.branches[l].fromId}–${m.branches[l].toId}`).join(", ")}` : "none selected";
    const ranSame = r.status === "done" && wb.sameSet(r.result.outage, s.contingency);
    const st = r.status === "running" ? ["running", "running…"] : r.status === "error" ? ["error", "failed"] : r.status === "done" ? (ranSame ? ["done", r.engine === "browser-dc" ? "done · browser DC" : r.engine === "saved" ? "saved run" : `done · ${r.engine.replace("api-", "API ").toUpperCase()}`] : ["stale", "result is for another set"]) : ["", "not run"];
    $("h-status").className = `pill hide-sm ${st[0]}`; $("h-status").lastChild.textContent = st[1];
    $("h-sev").innerHTML = r.status === "done" ? `<span title="final unserved fraction of base demand">S <b>${pc(r.result.metrics.S)}</b></span><span title="cascade-induced part, C = S − S₀">C <b>${pc(r.result.metrics.C)}</b></span>${r.rank && !r.rank.zero ? `<span>rank <b>${r.rank.exact ? "#" : "≈#"}${r.rank.rank.toLocaleString("en-US")}</b>/${r.rank.N.toLocaleString("en-US")}</span>` : ""}` : "";
    $("h-run").disabled = !wb.validate().ok || r.status === "running";
  }
  $("h-run").onclick = () => wb.run();
  $("h-diag").onclick = () => { const d = $("diag"); d.hidden = !d.hidden; $("h-diag").setAttribute("aria-expanded", String(!d.hidden)); if (!d.hidden) renderDiag(); };
  function renderDiag() {
    const s = store.get(), m = s.model, r = s.run, info = wb.gs ? wb.gs.info() : null; if (!m) return;
    $("diag").innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center"><b>Model &amp; data</b><button class="btn sm" id="dg-x">Close</button></div>
      <h3>Cascade model</h3><dl class="kv"><dt>type</dt><dd>quasi-steady-state DC overload cascade</dd><dt>stress λ</dt><dd>1.10 (loads and non-slack generation)</dd><dt>trip rule</dt><dd>loading &gt; ${m.config.trip_factor} + ${m.config.overload_tol}</dd>
        <dt>policy</dt><dd>${s.config.policy}</dd><dt>max rounds</dt><dd>${m.config.max_rounds}</dd><dt>redispatch</dt><dd>${m.config.redispatch} (pro-rata), then uniform curtailment</dd><dt>severity</dt><dd>S = 1 − served / base demand; τ = ${m.severity.tau}, δ = ${m.severity.delta}</dd></dl>
      <h3>Data</h3><dl class="kv"><dt>case</dt><dd>MATPOWER 8.1 ${m.id}</dd><dt>commit</dt><dd>${String(m.provenance.matpower_commit).slice(0, 12)}</dd><dt>file sha256</dt><dd>${String(m.provenance.file_sha256).slice(0, 24)}…</dd><dt>ratings</dt><dd>synthetic · ${esc(m.ratingFamily)}</dd><dt>base demand</dt><dd>${m.totalLoadMw.toFixed(1)} MW</dd></dl>
      <h3>Units</h3><p class="muted" style="font-size:12px;margin:0">Flows and ratings in MW (DC) or MVA (AC ratings); reactance in per unit on ${100} MVA; loading = |flow| / DC rating; S, S₀, C as fractions of base demand. Scene distances are scene units (su) of a synthetic layout.</p>
      <h3>Current result</h3><dl class="kv"><dt>engine</dt>${dd(r.status === "done" ? esc(r.engineLabel) : null)}<dt>source</dt>${dd(r.status === "done" ? esc(r.source) : null)}<dt>evidence</dt>${dd(r.status === "done" ? (r.engine.startsWith("api") ? "measured run of the Python engine" : "browser recomputation of the measured DC model; JS = Python on 700 parity runs") : null)}</dl>
      <h3>Known limitations</h3><ul class="muted" style="font-size:12px;margin:0;padding-left:18px"><li>DC screening fails the pre-registered DC-vs-AC agreement rule on every evaluable table (E3, F2): treat DC rankings as screening.</li><li>Rankings change completely with the synthetic rating rule (E11, F3); utility ratings are needed for operational meaning.</li><li>No protection, dynamics or operator action are modelled.</li><li>The layout is synthetic; elevation encodes voltage class only.</li></ul>
      <h3>Renderer (measured in this browser)</h3><dl class="kv"><dt>frame rate</dt>${dd(info?.fps ? `${info.fps.toFixed(0)} fps (while animating)` : null)}<dt>frame interval</dt>${dd(info?.frameMs ? `${info.frameMs.toFixed(1)} ms (average while animating)` : null)}<dt>quality</dt>${dd(info?.quality)}<dt>draw calls</dt>${dd(info?.calls)}<dt>triangles</dt>${dd(info?.triangles?.toLocaleString("en-US"))}<dt>geometries</dt>${dd(info?.geometries)}</dl>`;
    $("dg-x").onclick = () => { $("diag").hidden = true; $("h-diag").setAttribute("aria-expanded", "false"); };
  }
  wb.renderDiag = renderDiag;

  store.sub((s, ch) => {
    if (["selection", "model", "run", "playback", "contingency", "layers"].some((k) => ch.has(k))) renderInspector();
    if (["model", "run", "contingency", "config", "api"].some((k) => ch.has(k))) { renderScenario(); renderHeader(); }
    if (["saved", "compare"].some((k) => ch.has(k))) renderCompare();
    if (!$("diag").hidden && ["run", "model", "config"].some((k) => ch.has(k))) renderDiag();
  });
  renderCompare();
}
