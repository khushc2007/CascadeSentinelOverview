// B · Grid Autopsy: forensic inspection of the current run at the current frame. Entity (attributes, state, history, events, neighbours),
// Events (filter + search), Islands, Compare (initial vs final, DC vs stored AC), Findings (exportable report with metric provenance).
import { $, esc, pc, int, rankText, GRID_NAME, ENGINE_NAME, toast } from "./util.js";
import { findingsMarkdown } from "../shared/core/scenario.js";
import { METRICS, EVIDENCE } from "./provenance.js";

const TABS = [["entity", "Entity"], ["events", "Events"], ["islands", "Islands"], ["compare", "Compare"], ["findings", "Findings"]];
const TYPES = [["initial_outage", "outage"], ["overload", "overload"], ["trip", "trip"], ["islanding", "islanding"], ["load_shed", "load shed"], ["round", "round"], ["termination", "end"]];
const STATE_TXT = { initial_outage: "initial outage (T0)", tripped: "tripped by the cascade", unavailable: "out of service in the base case", deenergized: "de-energised", overload: "above rating", warning: "80–100% of rating", normal: "in service" };
const KEYRE = /^\s*(bus|b|branch|line|transformer|l|br|gen|generator|g|load|ld)?\s*#?\s*(\d+)\s*$/i;

export function parseEntity(text, model) {
  const m = KEYRE.exec(text || ""); if (!m) return null; const kind = (m[1] || "bus").toLowerCase(), n = +m[2];
  const key = /^(branch|line|transformer|l|br)$/.test(kind) ? `branch:${n}` : /^(gen|generator|g)$/.test(kind) ? `gen:${n}` : /^(load|ld)$/.test(kind) ? `load:${n}` : `bus:${n}`;
  return model.byKey.has(key) ? key : null;
}

export function initAutopsy(bx) {
  const { store } = bx, el = $("right"); let tab = "entity", filt = new Set(TYPES.map((t) => t[0]).filter((t) => t !== "round")), q = "";
  const embed = !!document.querySelector('meta[name="blacksky-embed"]');
  el.innerHTML = `<header><h2>Grid Autopsy</h2><button class="btn sm ghost sheet-toggle" id="au-sheet" aria-label="Collapse or expand panel">▾</button></header>
    <div class="tabs" role="tablist">${TABS.map(([k, n]) => `<button role="tab" id="au-t-${k}" data-tab="${k}" aria-controls="au-body">${n}</button>`).join("")}</div><div class="body" id="au-body" role="tabpanel"></div>`;
  const body = $("au-body");
  el.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; render(true); } });
  el.querySelector(".tabs").addEventListener("keydown", (e) => { if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return; const i = TABS.findIndex((t) => t[0] === tab); tab = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length][0]; render(true); $(`au-t-${tab}`).focus(); });
  $("au-sheet").onclick = () => { el.classList.toggle("collapsed"); $("au-sheet").setAttribute("aria-expanded", String(!el.classList.contains("collapsed"))); };
  body.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.key) bx.select(b.dataset.key, { focus: true });
    else if (b.dataset.ev != null) { bx.pause(); bx.goEvent(+b.dataset.ev); }
    else if (b.dataset.type) { filt.has(b.dataset.type) ? filt.delete(b.dataset.type) : filt.add(b.dataset.type); render(); }
    else if (b.dataset.frame) bx.frameKeys(b.dataset.frame.split(" "), 12);
    else if (b.id === "au-focus") bx.focus(store.get().selection);
    else if (b.id === "au-clear") bx.select(null);
    else if (b.id === "au-first") { bx.pause(); bx.goEvent(0); }
    else if (b.id === "au-last") { bx.pause(); bx.goEvent(store.get().run.events.length - 1); }
    else if (b.id === "au-ac") { const r = bx.runOnNet(); bx.run({ engine: "stored-ac", outage: r.result.outage, policy: "all_overloaded", label: `${r.label} · stored AC` }); }
    else if (b.id === "au-dc") { const r = bx.runOnNet(); bx.run({ engine: "browser-dc", outage: r.result.outage, policy: "all_overloaded", label: r.label.replace(" · stored AC", "") }); }
    else if (b.id === "au-copy") { const t = $("au-md"); navigator.clipboard?.writeText(t.value).then(() => toast("Findings copied"), () => { t.select(); toast("Copy blocked: text selected, press Ctrl/Cmd+C"); }) ?? (t.select(), toast("Text selected: press Ctrl/Cmd+C")); }
    else if (b.id === "au-dl") { const t = $("au-md").value, r = bx.runOnNet(), a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([t], { type: "text/markdown" })); a.download = `blacksky_${r.grid}_${r.result.outage.join("-")}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  });
  body.addEventListener("input", (e) => { if (e.target.id === "au-q") { q = e.target.value; renderList(); } });
  body.addEventListener("keydown", (e) => { if (e.target.id === "au-find" && e.key === "Enter") { const k = parseEntity(e.target.value, store.get().net.model); if (k) bx.select(k, { focus: true }); else toast("No such entity. Try: bus 69, branch 12, gen 3, load 59"); } });

  // ------------------------------------------------------------------ entity
  function entity(s) {
    const m = s.net.model, r = bx.runOnNet(), v = bx.view(), key = s.selection;
    const find = `<div class="sec"><label class="micro" for="au-find">Find an entity</label><div class="row"><input class="ctl" id="au-find" style="flex:1" placeholder="bus 69 · branch 12 · gen 3 · load 59" autocomplete="off"></div>
      ${key ? "" : `<p class="note">Or click any bus, line, generator or demand facility in the scene. Every value below is read from the run's frames at the current timeline position.</p>`}</div>`;
    if (!key) return find;
    const e = m.byKey.get(key), fi = bx.frameIndex(), frames = r ? r.result.frames : [];
    const evs = r ? r.events.filter((x) => x.entities.includes(key) || (e.kind === "load" && x.entities.includes(`bus:${e.busId}`))) : [];
    let attrs = [], state = [], hist = "", nb = [];
    const btn = (k, t) => `<button class="btn sm" data-key="${k}">${esc(t)}</button>`;
    if (e.kind === "branch") {
      const st = v.branches[e.l];
      attrs = [["Type", e.transformer ? "transformer" : "line"], ["From → to", `bus ${e.fromId} → bus ${e.toId}`], ["Reactance x", `${e.x_pu.toFixed(4)} pu`], ["DC rating", `${e.rating_dc_mw.toFixed(1)} MW`], ["AC rating", `${e.rating_ac_mva.toFixed(1)} MVA`], ["Base-case loading", pc(e.base_loading_dc)], ["Base case", e.in_service ? "in service" : "out of service"], ...(e.parallel_count > 1 ? [["Parallel circuit", `${e.parallel_index + 1} of ${e.parallel_count}`]] : [])];
      state = [["State", STATE_TXT[st.state]], ["Loading", st.u == null ? "–" : pc(st.u)], ["Flow", st.flow_mw == null ? (r ? "not recorded" : "–") : `${st.flow_mw.toFixed(1)} MW`]];
      if (r) { const tr = r.result.outage.includes(e.l) ? "initial outage (T0)" : r.trips.has(e.l) ? `tripped in round ${r.trips.get(e.l)}` : "never removed";
        state.push(["Trip history", tr]);
        hist = `<div class="sec"><span class="micro">Loading by round ${bx.ib("loading")}</span><div class="spark" aria-label="Loading by round">${frames.map((f, j) => { const u = f.out_of_service.includes(e.l) ? null : f.loading[e.l]; const h = u == null ? 0 : Math.min(100, (u / 1.4) * 100);
          return `<i class="${u == null ? "x" : u > 1 ? "o" : u > 0.8 ? "w" : ""}" style="height:${h.toFixed(0)}%" title="Round ${j + 1}: ${u == null ? "out of service" : pc(u)}"></i>`; }).join("")}</div>
          <div class="note mono" style="font-size:11px">${frames.map((f, j) => `R${j + 1} ${f.out_of_service.includes(e.l) ? "out" : pc(f.loading[e.l], 0)}`).join(" · ")}</div></div>`; }
      nb = [btn(`bus:${e.fromId}`, `bus ${e.fromId}`), btn(`bus:${e.toId}`, `bus ${e.toId}`), ...m.branches.filter((b) => b.l !== e.l && ((b.from === e.from && b.to === e.to) || (b.from === e.to && b.to === e.from))).map((b) => btn(b.key, `parallel ${b.l}`))];
    } else if (e.kind === "bus") {
      const st = v.buses[e.i];
      attrs = [["Bus number", e.id], ["Base voltage", e.base_kv ? `${e.base_kv} kV` : "not given"], ["Demand", `${e.load_mw.toFixed(1)} MW`], ["Generators", e.gens.length || "none"], ["Branches", e.branches.length], ...(e.is_slack ? [["Role", "slack bus"]] : [])];
      state = [["Energised", st.energized ? "yes" : "no (no generation in its island)"], ["Island", st.component == null ? (r ? "not recorded" : "–") : st.mainIsland ? "main island" : `component ${st.component}`], ["Demand served", st.served_fraction == null ? (st.energized ? "energised; curtailment not recorded" : "0%") : pc(st.served_fraction)]];
      if (r) hist = `<div class="sec"><span class="micro">Energised by round</span><div class="note mono" style="font-size:11px">${frames.map((f, j) => `R${j + 1} ${f.energized_buses.includes(e.id) ? (f.factor ? pc(f.factor[e.i], 0) : "on") : "dark"}`).join(" · ")}</div></div>`;
      const adj = new Map(); e.branches.forEach((l) => { const b = m.branches[l], o = b.from === e.i ? b.toId : b.fromId; adj.set(o, (adj.get(o) || []).concat(l)); });
      nb = [...[...adj.keys()].sort((a, b) => a - b).map((id) => btn(`bus:${id}`, `bus ${id}`)), ...e.branches.map((l) => btn(`branch:${l}`, `${m.branches[l].transformer ? "xfmr" : "line"} ${l}`)), ...e.gens.map((g) => btn(`gen:${g}`, `gen ${g}`)), ...(e.load_mw > 0 ? [btn(`load:${e.id}`, "demand")] : [])];
    } else if (e.kind === "gen") {
      const st = v.gens[e.g];
      attrs = [["Bus", e.busId], ["Pmax", `${e.pmax_mw.toFixed(1)} MW`], ["Pmin", `${e.pmin_mw.toFixed(1)} MW`], ["Base dispatch", `${e.pg0_mw.toFixed(1)} MW`], ["Base case", e.in_service ? "in service" : "out of service"]];
      state = [["Online", st.energized && e.in_service ? "yes" : "no (isolated)"], ["Dispatch", st.pg_mw == null ? (r ? "not recorded" : "–") : `${st.pg_mw.toFixed(1)} MW`]];
      nb = [btn(`bus:${e.busId}`, `bus ${e.busId}`)];
    } else {
      const bs = v.buses[e.bus], f = bs.served_fraction;
      attrs = [["Bus", e.busId], ["Base demand", `${e.demand_mw.toFixed(1)} MW`]];
      state = [["Served", f == null ? (bs.energized ? "energised; curtailment not recorded" : "0 MW") : `${(e.demand_mw * f).toFixed(1)} MW (${pc(f)})`], ["Shed", f == null ? (bs.energized ? "not recorded" : `${e.demand_mw.toFixed(1)} MW`) : `${(e.demand_mw * (1 - f)).toFixed(1)} MW`]];
      nb = [btn(`bus:${e.busId}`, `bus ${e.busId}`)];
    }
    const kv = (rows) => `<dl class="kv">${rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join("")}</dl>`;
    return `${find}<div class="sec"><div class="row"><b style="font-size:15px;font-weight:600;flex:1;min-width:0;color:var(--ice)">${esc(bx.label(key))}</b><button class="btn sm" id="au-focus">Focus</button><button class="btn sm ghost" id="au-clear" aria-label="Clear selection">×</button></div>${kv(attrs)}</div>
      <div class="sec"><span class="micro">${r ? `State at round ${fi + 1}` : "Base case"}</span>${kv(state)}</div>${hist}
      ${r ? `<div class="sec"><span class="micro">Events involving it (${evs.length})</span>${evs.length ? `<div class="list">${evs.map(evRow).join("")}</div>` : `<p class="note">None: the cascade did not touch it directly.</p>`}</div>` : ""}
      <div class="sec"><span class="micro">Neighbours</span><div class="row">${nb.join("")}</div></div>`;
  }
  const evRow = (x) => { const cur = store.get().playback.i === x.i; return `<button data-ev="${x.i}" ${cur ? 'aria-current="true"' : ""}><span class="r">R${x.round}</span><span><span class="tag ${x.type}">${x.type.replace("_", " ")}</span> <span class="tt">${esc(x.title)}</span>${x.detail ? `<span class="dd">${esc(x.detail.length > 160 ? `${x.detail.slice(0, 160)}…` : x.detail)}</span>` : ""}</span></button>`; };

  // ------------------------------------------------------------------ events
  function eventsTab(s) {
    const r = bx.runOnNet(); if (!r) return noRun(s);
    const counts = {}; r.events.forEach((e) => (counts[e.type] = (counts[e.type] || 0) + 1));
    return `<div class="sec"><div class="chips" role="group" aria-label="Event types">${TYPES.filter(([t]) => counts[t]).map(([t, n]) => `<button data-type="${t}" aria-pressed="${filt.has(t)}">${n} · ${counts[t]}</button>`).join("")}</div>
      <input class="ctl" id="au-q" placeholder="Search events: branch, bus, text" value="${esc(q)}" autocomplete="off" aria-label="Search events"></div><div class="sec" id="au-list"></div>`;
  }
  function renderList() {
    const box = $("au-list"), r = bx.runOnNet(); if (!box || !r) return; const qq = q.trim().toLowerCase();
    const hits = r.events.filter((e) => filt.has(e.type) && (!qq || `${e.title} ${e.detail || ""} ${e.entities.join(" ")} r${e.round}`.toLowerCase().includes(qq)));
    box.innerHTML = `<span class="micro">${hits.length} of ${r.events.length} events</span>${hits.length ? `<div class="list">${hits.map(evRow).join("")}</div>` : `<p class="note">No event matches.</p>`}`;
  }

  // ------------------------------------------------------------------ islands
  function islandsTab(s) {
    const r = bx.runOnNet(), v = bx.view(); if (!r) return noRun(s); const m = s.net.model, f = v.frame;
    if (!f.component) return `<div class="m-info">Island membership per bus is recorded only by the browser engine. This ${esc(ENGINE_NAME[r.engine])} result reports ${f.islands} connected component${f.islands > 1 ? "s" : ""} and ${m.nBus - f.energized_buses.length} de-energised buses at this round.</div>`;
    const groups = new Map(); m.buses.forEach((b, i) => { const st = v.buses[i]; const g = st.energized ? st.component : "dark"; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(b); });
    const rows = [...groups.entries()].filter(([g]) => g !== "dark").sort((a, b) => b[1].length - a[1].length).map(([g, bs], j) => {
      const dem = bs.reduce((a, b) => a + b.load_mw, 0), srv = bs.reduce((a, b) => a + b.load_mw * (f.factor ? f.factor[b.i] : 1), 0), gens = bs.flatMap((b) => b.gens), cap = gens.reduce((a, g2) => a + m.gens[g2].pmax_mw, 0);
      return `<div style="display:block"><div class="row" style="justify-content:space-between"><b style="color:var(--tx-1);font-weight:500">${j === 0 ? "Main island" : `Island ${j + 1}`}</b><button class="btn sm" data-frame="${bs.map((b) => b.key).join(" ")}">Frame</button></div>
        <dl class="kv"><dt>Buses</dt><dd>${bs.length}</dd><dt>Demand</dt><dd>${dem.toFixed(1)} MW</dd><dt>Served</dt><dd>${srv.toFixed(1)} MW (${dem ? pc(srv / dem) : "–"})</dd><dt>Generators</dt><dd>${gens.length} · ${cap.toFixed(0)} MW Pmax</dd></dl>
        ${bs.length <= 24 ? `<div class="note mono" style="font-size:11px">buses ${bs.map((b) => b.id).join(", ")}</div>` : ""}</div>`; });
    const dark = groups.get("dark") || [];
    return `<div class="sec"><span class="micro">Round ${bx.frameIndex() + 1}: ${rows.length} energised island${rows.length > 1 ? "s" : ""} ${bx.ib("islands")}</span><div class="list">${rows.join("")}</div></div>
      <div class="sec"><span class="micro">De-energised: ${dark.length} bus${dark.length === 1 ? "" : "es"}</span>${dark.length ? `<div class="note mono" style="font-size:11px">${dark.map((b) => b.id).join(", ")}</div><div class="row"><button class="btn sm" data-frame="${dark.map((b) => b.key).join(" ")}">Frame the dark buses</button></div>` : `<p class="note">Every bus still has generation in its island.</p>`}</div>`;
  }

  // ------------------------------------------------------------------ compare
  function compareTab(s) {
    const r = bx.runOnNet(); if (!r) return noRun(s); const m = s.net.model, F = r.result.frames, a = F[0], b = F[F.length - 1];
    const live = (fi) => r.events.find((e) => e.type === "round" && e.frame === fi)?.values?.energisedIslands;
    const row = (k, x, y) => `<tr><td>${k}</td><td>${x}</td><td>${y}</td></tr>`;
    const lost = a.energized_buses.filter((id) => !b.energized_buses.includes(id)), byRound = new Map(); r.trips.forEach((rd, l) => byRound.set(rd, (byRound.get(rd) || []).concat(l)));
    const tbl = `<table class="t"><thead><tr><th></th><th>Round 1 (after T0)</th><th>Final, round ${F.length}</th></tr></thead><tbody>
      ${row("Demand served", pc(a.load_served), pc(b.load_served))}${row("Branches out of service", a.out_of_service.length, b.out_of_service.length)}
      ${row("Buses de-energised", m.nBus - a.energized_buses.length, m.nBus - b.energized_buses.length)}${live(0) == null ? row("Connected components", a.islands, b.islands) : row("Energised islands", live(0), live(F.length - 1))}
      ${row("Branches above rating", a.overloaded.length, b.overloaded.length)}</tbody></table>`;
    const st = r.result.outage, stored = s.net.stored.get(st.slice().sort((x, y) => x - y).join(",")), dcac = stored && stored.ac;
    let acSec = "";
    if (dcac) {
      const d = r.mode === "ac" ? stored.dc : r.result, ac = r.mode === "ac" ? r.result : stored.ac, tr = (x) => (x.trips_per_round || x.frames.map((f) => f.tripped)).flat().length;
      acSec = `<div class="sec"><span class="micro">Same set, DC vs AC</span><table class="t"><thead><tr><th></th><th>DC</th><th>AC (stored)</th></tr></thead><tbody>
        ${row("S, final unserved", pc(d.metrics.S, 2), `${pc(ac.metrics.S, 2)}${ac.metrics.S_total != null && Math.abs(ac.metrics.S_total - ac.metrics.S) > 1e-9 ? ` … ${pc(ac.metrics.S_total, 2)}` : ""}`)}
        ${row("S₀, initial", pc(d.metrics.S0, 2), pc(ac.metrics.S0, 2))}${row("Rounds", d.metrics.rounds, ac.metrics.rounds)}${row("Secondary trips", tr(d), tr(ac))}${row("Status", d.metrics.status, ac.metrics.status)}</tbody></table>
        <p class="note">The AC run is a stored Python Newton–Raphson result (an interval S … S_total where island solutions fail). AC results are not ranked against the DC tables.</p>
        <div class="row">${r.mode === "ac" ? `<button class="btn sm" id="au-dc">Replay the DC run</button>` : `<button class="btn sm" id="au-ac">Replay the AC run</button>`}</div></div>`;
    } else acSec = `<div class="sec"><p class="note">No stored AC run exists for this set (stored AC covers the ten most damaging sets per table and the example sets on IEEE-14/30, plus the IEEE-118 pair examples). With the API online, the Arena can request one for IEEE-14/30.</p></div>`;
    return `<div class="sec"><span class="micro">Initial vs final</span>${tbl}<div class="row"><button class="btn sm" id="au-first">View initial</button><button class="btn sm" id="au-last">View final</button></div></div>
      <div class="sec"><span class="micro">What changed</span><dl class="kv"><dt>Buses that went dark</dt><dd>${lost.length ? lost.join(", ") : "none"}</dd>
      ${[...byRound.keys()].sort((x, y) => x - y).map((rd) => `<dt>Tripped in round ${rd}</dt><dd>${byRound.get(rd).join(", ")}</dd>`).join("") || "<dt>Trips</dt><dd>none</dd>"}</dl></div>${acSec}`;
  }

  // ------------------------------------------------------------------ findings
  function findingsTab(s) {
    const r = bx.runOnNet(); if (!r) return noRun(s); const m = s.net.model;
    let md = findingsMarkdown({ model: m, scenario: { result: r.result, engineLabel: ENGINE_NAME[r.engine], source: r.source }, events: r.events, rank: r.rank, evidence: EVIDENCE[r.engine]?.cls });
    md += `\n\n## Stages\n\n${r.stages.map((x) => `- ${x.title}: ${x.occurred ? x.summary : `did not occur. ${x.summary}`}`).join("\n")}`;
    md += `\n\n## Metric definitions\n\n${["S", "S0", "C", "rounds", "trips", "rank", "loading"].map((k) => `- ${METRICS[k].label} [${METRICS[k].unit}]: ${METRICS[k].definition} Source: ${METRICS[k].source}. Scope: ${METRICS[k].scope}.`).join("\n")}`;
    md += `\n\nGenerated by BLACKSKY Command (${GRID_NAME[r.grid]}).`;
    return `<div class="sec"><p class="note">A plain-text report of this run: outage set, result, event sequence, stages, model provenance and metric definitions.</p>
      <div class="row"><button class="btn" id="au-copy">Copy report</button>${embed ? "" : `<button class="btn" id="au-dl">Download .md</button>`}</div><textarea class="md" id="au-md" readonly aria-label="Findings report">${esc(md)}</textarea></div>`;
  }
  const noRun = (s) => `<p class="note">${s.run.status === "running" ? "Running…" : s.run.status === "error" ? `The last run failed: ${esc(s.run.error)}` : "No run on this network yet. Pick a scenario in the Theater or build one in the Arena."}</p>`;

  function render(tabChanged = false) {
    const s = store.get(); if (s.mode !== "autopsy" || !s.net) return;
    TABS.forEach(([k]) => $(`au-t-${k}`).setAttribute("aria-selected", String(k === tab)));
    const keepScroll = tabChanged ? 0 : body.scrollTop, act = document.activeElement?.id;
    body.innerHTML = tab === "entity" ? entity(s) : tab === "events" ? eventsTab(s) : tab === "islands" ? islandsTab(s) : tab === "compare" ? compareTab(s) : findingsTab(s);
    if (tab === "events") renderList();
    body.scrollTop = keepScroll; if (act && $(act) && body.contains($(act))) { const a = $(act); a.focus(); if (a.setSelectionRange && a.value) a.setSelectionRange(a.value.length, a.value.length); }
  }
  bx.autopsyTab = (t) => { tab = t; render(true); };
  store.sub((s, ch) => {
    if (s.mode !== "autopsy") return;
    if (ch.has("selection") && s.selection && tab !== "entity") tab = "entity";
    if (["mode", "run", "net", "selection"].some((k) => ch.has(k))) render(ch.has("mode") || ch.has("net"));
    else if (ch.has("playback")) { if (tab === "events") { document.querySelectorAll("#au-list [data-ev]").forEach((b) => { if (+b.dataset.ev === s.playback.i) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); }); } else if (tab !== "findings") render(); }
  });
}
