// A · Cascade Command Theater: a guided replay in five stages (DETECT → TRACE → CASCADE → ISLAND → ASSESS) over the current run.
// Stages and their text are derived from the run's own events (stages.js); a stage that did not happen says so.
import { $, esc, pc, int, rankText, GRID_NAME } from "./util.js";
import { EVIDENCE } from "./provenance.js";

export function initTheater(bx) {
  const { store } = bx, el = $("left");
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || store.get().mode !== "theater") return;
    if (b.dataset.stage) bx.goStage(b.dataset.stage);
    else if (b.id === "th-play") { if (store.get().run.status === "done") bx.togglePlay(); }
    else if (b.id === "th-inspect") bx.setMode("autopsy");
    else if (b.id === "th-sheet") { el.classList.toggle("collapsed"); b.setAttribute("aria-expanded", String(!el.classList.contains("collapsed"))); }
    else if (b.id === "th-retry") { const f = store.get().featuredId; if (f) bx.playFeatured(f); }
  });
  el.addEventListener("change", (e) => { if (e.target.id === "th-scn" && e.target.value) bx.playFeatured(e.target.value, { autoplay: true }); });

  function render() {
    const s = store.get(); if (s.mode !== "theater") return;
    const r = bx.runOnNet(), fe = s.featured, cur = r && fe.find((f) => f.grid === r.grid && bx.sameSet(f.outage, r.result.outage) && r.engine === "browser-dc");
    const ev = bx.currentEvent(), stg = bx.currentStage(), v = bx.view();
    const head = `<header><h2>Cascade Command Theater</h2><button class="btn sm ghost sheet-toggle" id="th-sheet" aria-label="Collapse or expand panel" aria-expanded="${!el.classList.contains("collapsed")}">▾</button></header>`;
    const scen = `<div class="sec"><label class="micro" for="th-scn">Scenario</label>
      <select class="ctl" id="th-scn">${cur ? "" : `<option value="">${r ? esc(`Current run · ${r.label}`) : s.run.status === "running" ? "Running…" : "Choose a scenario"}</option>`}${fe.map((f) => `<option value="${f.id}" ${cur && cur.id === f.id ? "selected" : ""}>${esc(f.title)}</option>`).join("")}</select>
      ${cur ? `<div class="note">${esc(cur.sub)}.</div>` : ""}
      ${r ? `<div class="row"><button class="btn primary cta" id="th-play"><svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="${s.playback.playing ? "M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z" : "M4 2.5v11l9.5-5.5z"}" fill="currentColor"/></svg>${s.playback.playing ? "Pause" : s.playback.i >= r.events.length - 1 ? "Replay the cascade" : s.playback.i ? "Resume" : "Play the cascade"}</button><span class="ev-badge" title="${esc(EVIDENCE[r.engine]?.text || "")}">${esc(EVIDENCE[r.engine]?.cls || r.engine)}</span></div>` : ""}</div>`;
    if (s.run.status === "error") { el.innerHTML = head + `<div class="body">${scen}<div class="m-err">${esc(s.run.error)}</div><button class="btn" id="th-retry">Retry</button></div>`; return; }
    if (!r) { el.innerHTML = head + `<div class="body">${scen}<div class="note">${s.run.status === "running" ? "Running the cascade engine…" : s.loading ? "Loading network…" : "Pick a scenario to replay."}</div></div>`; return; }
    const kWord = ["", "one-branch", "two-branch", "three-branch", "four-branch"][r.k] || `${r.k}-branch`, M = r.result.metrics;
    const brief = `<div class="brief"><div class="big mono">${pc(M.S)}${r.mode === "ac" && M.S_total != null && Math.abs(M.S_total - M.S) > 1e-9 ? `<span style="font-size:22px"> – ${pc(M.S_total)}</span>` : ""}</div><p>${r.rank && !r.rank.zero
      ? `of the demand on the ${GRID_NAME[r.grid]} test case is left unserved under the DC cascade model when these ${r.k} branches are removed${r.rank.exact ? "" : " (rank estimated from the histogram)"}: rank <b>${r.rank.exact ? "#" : "≈ #"}${int(r.rank.rank)}</b>${r.ties > 1 ? ` (tied with ${int(r.ties - 1)} other set${r.ties > 2 ? "s" : ""})` : ""} of <b>${int(r.rank.N)}</b> ${kWord} outage sets in the exhaustive DC table, after ${M.rounds} rounds of overload trips.`
      : r.rank && r.rank.zero ? `of the demand on the ${GRID_NAME[r.grid]} test case is lost under the DC cascade model: the network absorbs these ${r.k} outages, like ${int(r.rank.tiedZero)} of the ${int(r.rank.N)} ${kWord} sets in the table.`
      : `of the demand on the ${GRID_NAME[r.grid]} test case left unserved (${r.mode === "ac" ? "AC run, not ranked against the DC tables" : "no exhaustive table for this k"}), after ${M.rounds} rounds.`}</p></div>`;
    const rail = `<div class="stages" role="group" aria-label="Stages">${r.stages.map((st, j) => { const cls = !st.occurred ? "none" : stg && st.eventIndex >= 0 && st.eventIndex < (stg.eventIndex ?? 0) ? "done" : "";
      return `<button data-stage="${st.id}" class="${cls}" ${stg && stg.id === st.id ? 'aria-current="step"' : ""} ${st.occurred ? "" : 'aria-disabled="true"'} title="${esc(st.occurred ? st.title : `${st.title}: did not occur in this run`)}"><span class="n">0${j + 1}</span><span class="t">${st.title}</span><span class="bar2"></span></button>`; }).join("")}</div>`;
    const idx = r.stages.indexOf(stg) + 1, notOcc = r.stages.filter((x) => !x.occurred);
    const card = `<div class="sec stagecard"><span class="micro">Stage 0${idx} / 05 · round ${ev.frame + 1} of ${r.result.frames.length}</span><h3>${stg.title}</h3><p class="lede">${esc(stg.summary)}</p>
      ${notOcc.length ? `<div class="note">Did not occur in this run: ${notOcc.map((x) => `<b>${x.title}</b>`).join(", ")}.</div>` : ""}
      ${ev.i === stg.eventIndex && (stg.id === "detect" || stg.id === "assess") ? "" : `<div class="evline ${ev.type}"><span class="micro">Event ${ev.i + 1} of ${r.events.length}</span><b>${esc(ev.title)}</b>${esc(ev.detail || "")}</div>`}</div>`;
    const tripsSoFar = v.branches.filter((b) => b.state === "tripped").length, dark = v.buses.filter((b) => !b.energized).length, m = r.result.metrics;
    const now = `<div class="sec"><span class="micro">At this frame</span><div class="metrics">
      <div><div class="k">Demand unserved ${bx.ib("S")}</div><div class="v">${pc(1 - v.loadServed)}</div></div>
      <div><div class="k">Secondary trips ${bx.ib("trips")}</div><div class="v">${tripsSoFar}</div></div>
      <div><div class="k">Buses de-energised</div><div class="v">${dark}</div></div>
      <div><div class="k">Overloaded now ${bx.ib("loading")}</div><div class="v">${v.branches.filter((b) => b.overloaded).length}</div></div></div></div>`;
    const fin = `<div class="sec"><span class="micro">Outcome of this run</span><dl class="kv">
      <dt>S, final unserved ${bx.ib("S")}</dt><dd>${pc(m.S, 2)}</dd><dt>S₀, initial ${bx.ib("S0")}</dt><dd>${pc(m.S0, 2)}</dd><dt>C, cascade-induced ${bx.ib("C")}</dt><dd>${pc(m.C, 2)}</dd>
      <dt>Rounds ${bx.ib("rounds")}</dt><dd>${m.rounds}</dd><dt>Rank ${bx.ib("rank")}</dt><dd>${r.rank ? rankText(r.rank) : r.mode === "ac" ? "AC: not ranked" : "no table"}</dd>
      <dt>Network</dt><dd>${GRID_NAME[r.grid]}</dd><dt>Outage set</dt><dd>{${r.result.outage.join(", ")}}</dd></dl>
      ${r.ties > 1 ? `<div class="note">${int(r.ties)} sets in the table share this S exactly; all of them hold rank #${r.rank.rank}.</div>` : ""}</div>`;
    const sel = s.selection ? `<div class="sec"><div class="row"><span class="dim" style="flex:1;min-width:0">Selected: <b style="color:var(--ice);font-weight:500">${esc(bx.label(s.selection))}</b></span><button class="btn sm" id="th-inspect">Inspect in Autopsy</button></div></div>` : "";
    const lim = `<div class="sec"><p class="note">${r.mode === "ac" ? "AC (Newton–Raphson) quasi-steady-state model" : "DC quasi-steady-state model"} on an IEEE test case with synthetic ratings and a synthetic, non-geographic layout. S is a share of the test case's demand, not a blackout probability.</p></div>`;
    const keep = el.querySelector(".body")?.scrollTop || 0;
    el.innerHTML = head + `<div class="body">${brief}${scen}${rail}${card}${now}${fin}${sel}${lim}</div>`;
    el.querySelector(".body").scrollTop = keep;
  }
  store.sub((s, ch) => { if (["mode", "run", "playback", "featured", "selection", "net", "loading"].some((k) => ch.has(k))) render(); });
  render();
}
