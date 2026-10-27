// C · Contingency Arena: choose a network, build a k-branch contingency, validate it, run it on a chosen engine, observe and inspect the
// replay, read its score (score.js: a defined function of the exact or histogram rank in the exhaustive DC table), compare it with the
// table's most damaging set, and save attempts locally for replay. Nothing is scored that the tables cannot rank.
import { $, esc, pc, int, rankText, GRID_NAME, ENGINE_NAME, toast, storage } from "./util.js";
import { validateScenario, compareRows, rankOf, MAX_K } from "../shared/core/scenario.js";
import { challengeScore } from "./score.js";
import { setKey } from "./engine.js";

const KEY = "blacksky.arena.attempts.v1";
const ENGINES = [["browser-dc", "Browser · DC (live in this page)"], ["stored-dc", "Stored · DC Python run"], ["stored-ac", "Stored · AC Python run"], ["api-dc", "API · DC Python engine"], ["api-ac", "API · AC Python engine"]];

export function validateArena({ net, draft, engine, policy, apiOk }) {
  const model = net.model, stored = net.stored.get(setKey(draft));
  const base = { "browser-dc": "browser-dc", "stored-dc": "browser-dc", "stored-ac": "pre-ac", "api-dc": "api-dc", "api-ac": "api-ac" }[engine];
  const v = validateScenario({ model, outage: draft, engine: base, apiAvailable: apiOk, tableKs: net.tableKs, acPrecomputed: !!(stored && stored.ac), nPrecomputedAc: [...net.stored.values()].filter((x) => x.ac).length });
  if (engine === "stored-dc" && draft.length && !stored) v.errors.push("No stored DC run for this set. Stored runs cover the ten most damaging sets per table and the example sets; the browser engine runs any set.");
  if ((engine === "stored-dc" || engine === "stored-ac") && policy !== "all_overloaded") v.errors.push("Stored runs were made with the all-overloaded trip policy.");
  if (engine === "stored-dc") v.info = v.info.filter((x) => !/^Retrieved/.test(x)).concat("Retrieved from the data files: a Python DC run made when the demo data was built.");
  if (policy !== "all_overloaded" && draft.length) v.info.push("Most-overloaded-first is a different trip rule from the tables (all-overloaded): the result will run but will not be ranked.");
  if ((engine === "stored-ac" || engine === "api-ac") && draft.length) v.info.push("AC results are shown but never ranked or scored against the DC tables.");
  v.ok = v.errors.length === 0; return v;
}

export function initArena(bx) {
  const { store } = bx, el = $("left");
  let attempts = storage.get(KEY, []); if (!Array.isArray(attempts)) attempts = [];
  let ref = null, confirmClear = false;                 // reference run (most damaging set of the table) for the current network and k
  const persist = () => { if (!storage.set(KEY, attempts)) toast("Browser storage unavailable: attempts are kept for this session only"); };
  const setArena = (p) => store.set({ arena: { ...store.get().arena, ...p } });
  bx.toggleDraft = (l) => {
    const s = store.get(), m = s.net.model, d = s.arena.draft; if (!m.branches[l]) return;
    if (d.includes(l)) { setArena({ draft: d.filter((x) => x !== l) }); return; }
    if (d.length >= MAX_K) { toast(`At most ${MAX_K} branches in one contingency`); return; }
    if (!m.branches[l].in_service) { toast(`Branch ${l} is out of service in the base case`); return; }
    setArena({ draft: [...d, l] });
  };
  const current = () => { const s = store.get(), r = bx.runOnNet(); return r && r.cfg && r.cfg.origin === "arena" && bx.sameSet(r.result.outage, s.arena.draft) && r.cfg.engine === s.arena.engine && (r.cfg.policy || "all_overloaded") === s.arena.policy ? r : null; };
  async function runArena() {
    const s = store.get(), v = validateArena({ net: s.net, draft: s.arena.draft, engine: s.arena.engine, policy: s.arena.policy, apiOk: s.api.state === "ok" });
    if (!v.ok) { toast(v.errors[0]); return; }
    const r = await bx.run({ engine: s.arena.engine, outage: s.arena.draft, policy: s.arena.policy, origin: "arena", label: `Arena · {${[...s.arena.draft].sort((a, b) => a - b).join(", ")}}` });
    if (r && !store.get().reduced) bx.play();
    computeRef();
  }
  function computeRef() {                                // the table's most damaging set, run in the browser engine (does not change the current run)
    const s = store.get(), r = current(); ref = null; if (!r || r.mode === "ac" || !s.net.dists[r.k]) return;
    const top = s.net.dists[r.k].top[0], o = top[1].slice().sort((a, b) => a - b);
    const res = s.net.engine.run(o, { policy: "all_overloaded" }); ref = { grid: s.net.id, outage: o, engineLabel: ENGINE_NAME["browser-dc"], result: res, rank: rankOf(s.net.dists[r.k], res.metrics.S) };
  }
  function save() {
    const r = current(); if (!r) return; const sc = challengeScore({ rank: r.rank, mode: r.mode, k: r.k, tableKs: store.get().net.tableKs, policy: r.policy, ties: r.ties || 1 });
    attempts = [{ id: Date.now(), grid: r.grid, outage: r.result.outage, engine: r.engine, policy: r.policy, S: r.result.metrics.S, score: sc.score, rank: r.rank ? rankText(r.rank) : null }, ...attempts].slice(0, 30);
    persist(); render(); toast("Attempt saved in this browser");
  }
  async function replay(id) {
    const a = attempts.find((x) => x.id === id); if (!a) return;
    if (store.get().netId !== a.grid) await bx.loadNet(a.grid);
    setArena({ draft: [...a.outage], engine: a.engine, policy: a.policy }); await runArena();
  }

  el.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || store.get().mode !== "arena") return; const s = store.get();
    if (b.dataset.rm != null) bx.toggleDraft(+b.dataset.rm);
    else if (b.id === "ar-add-sel") bx.toggleDraft(+s.selection.split(":")[1]);
    else if (b.id === "ar-clear") setArena({ draft: [] });
    else if (b.id === "ar-run") runArena();
    else if (b.id === "ar-cancel") bx.cancel();
    else if (b.id === "ar-play") bx.replay();
    else if (b.id === "ar-inspect") bx.setMode("autopsy");
    else if (b.id === "ar-save") save();
    else if (b.id === "ar-ref") { if (ref) { setArena({ draft: [...ref.outage], engine: "browser-dc", policy: "all_overloaded" }); runArena(); } }
    else if (b.dataset.replay) replay(+b.dataset.replay);
    else if (b.dataset.del) { attempts = attempts.filter((x) => x.id !== +b.dataset.del); persist(); render(); }
    else if (b.id === "ar-clear-all") { if (!confirmClear) { confirmClear = true; render(); } else { attempts = []; confirmClear = false; persist(); render(); } }
    else if (b.id === "ar-clear-no") { confirmClear = false; render(); }
    else if (b.id === "ar-sheet") { el.classList.toggle("collapsed"); b.setAttribute("aria-expanded", String(!el.classList.contains("collapsed"))); }
  });
  el.addEventListener("change", (e) => {
    const t = e.target; if (store.get().mode !== "arena") return;
    if (t.id === "ar-net") bx.loadNet(t.value);
    else if (t.id === "ar-engine") setArena({ engine: t.value });
    else if (t.id === "ar-policy") setArena({ policy: t.value });
  });
  el.addEventListener("keydown", (e) => {
    if (e.target.id !== "ar-add" || e.key !== "Enter") return; e.preventDefault();
    const ids = e.target.value.split(/[\s,]+/).filter(Boolean).map(Number); const bad = ids.filter((x) => !Number.isInteger(x) || x < 0 || x >= store.get().net.model.nBranch);
    if (bad.length) { toast(`Unknown branch index ${bad[0]} (0–${store.get().net.model.nBranch - 1})`); return; }
    ids.forEach((l) => { if (!store.get().arena.draft.includes(l)) bx.toggleDraft(l); }); e.target.value = "";
  });

  function render() {
    const s = store.get(); if (s.mode !== "arena") return; if (!s.net) { el.innerHTML = `<header><h2>Contingency Arena</h2></header><div class="body"><p class="note">Loading network…</p></div>`; return; }
    const m = s.net.model, d = s.arena.draft, a = s.arena, apiOk = s.api.state === "ok", v = validateArena({ net: s.net, draft: d, engine: a.engine, policy: a.policy, apiOk });
    const r = current(), running = s.run.status === "running" && s.run.cfg?.origin === "arena", err = s.run.status === "error" && s.run.cfg?.origin === "arena" ? s.run.error : null;
    const stored = s.net.stored.get(setKey(d)), selBranch = s.selection && s.selection.startsWith("branch:") ? +s.selection.split(":")[1] : null;
    const step = (n, title, state, inner) => `<div class="step ${state}"><span class="no">${state === "done" ? "✓" : n}</span><div class="c"><h4>${title}</h4>${inner}</div></div>`;
    const engOpt = ENGINES.map(([k, n]) => { const why = k.startsWith("api") && !apiOk ? " — API offline" : k === "stored-ac" && !(stored && stored.ac) && d.length ? " — none for this set" : k === "stored-dc" && !stored && d.length ? " — none for this set" : "";
      return `<option value="${k}" ${a.engine === k ? "selected" : ""}>${esc(n + why)}</option>`; }).join("");
    const s1 = step(1, "Network", "done", `<select class="ctl" id="ar-net" aria-label="Network">${["ieee118", "ieee30", "ieee14"].map((g) => `<option value="${g}" ${s.netId === g ? "selected" : ""}>${GRID_NAME[g]}</option>`).join("")}</select>
      <span class="note">${m.nBus} buses · ${m.nBranch} branches · exhaustive tables for k ∈ {${s.net.tableKs.join(", ")}}</span>`);
    const s2 = step(2, `Contingency · k = ${d.length}`, d.length ? "done" : "on", `${d.length ? `<div class="setchips">${d.map((l) => `<span>${l}<button data-rm="${l}" aria-label="Remove branch ${l}">×</button></span>`).join("")}</div>` : `<span class="note">Shift+click or double-click lines in the scene, or type branch indices (0–${m.nBranch - 1}).</span>`}
      <div class="row"><input class="ctl" id="ar-add" style="flex:1;min-width:120px" placeholder="e.g. 6, 67, 140 then Enter" aria-label="Add branch indices">${selBranch != null ? `<button class="btn sm" id="ar-add-sel">${d.includes(selBranch) ? "Remove" : "Add"} line ${selBranch}</button>` : ""}${d.length ? `<button class="btn sm ghost" id="ar-clear">Clear</button>` : ""}</div>
      ${d.length ? `<span class="note mono" style="font-size:11px">${d.map((l) => `${l} = bus ${m.branches[l].fromId}–${m.branches[l].toId}`).join(" · ")}</span>` : ""}`);
    const s3 = step(3, "Engine and trip rule", d.length ? "done" : "", `<select class="ctl" id="ar-engine" aria-label="Engine">${engOpt}</select>
      <select class="ctl" id="ar-policy" aria-label="Trip policy"><option value="all_overloaded" ${a.policy === "all_overloaded" ? "selected" : ""}>Trip every overloaded branch each round</option><option value="most_overloaded_first" ${a.policy !== "all_overloaded" ? "selected" : ""}>Trip only the most overloaded branch</option></select>`);
    const msgs = [...v.errors.map((x) => `<div class="m-err">${esc(x)}</div>`), ...v.warnings.map((x) => `<div class="m-warn">${esc(x)}</div>`), ...v.info.map((x) => `<div class="m-info">${esc(x)}</div>`)];
    const s4 = step(4, "Validate", d.length && v.ok ? "done" : d.length ? "on" : "", d.length ? (v.ok && !v.warnings.length ? `<div class="m-ok">Valid contingency.</div>` : "") + msgs.join("") : `<span class="note">Waiting for a contingency.</span>`);
    const s5 = step(5, "Run", r ? "done" : v.ok && d.length ? "on" : "", `<div class="row"><button class="btn primary" id="ar-run" ${!v.ok || !d.length || running ? "disabled" : ""}>${running ? "Running…" : r ? "Run again" : "Run contingency"}</button>${running ? `<button class="btn" id="ar-cancel">Cancel</button>` : ""}</div>${err ? `<div class="m-err">Run failed: ${esc(err)}</div>` : ""}`);
    let rest = "";
    if (r) {
      const M = r.result.metrics, sc = challengeScore({ rank: r.rank, mode: r.mode, k: r.k, tableKs: s.net.tableKs, policy: r.policy, ties: r.ties || 1 }), trips = (r.result.trips_per_round || r.result.frames.map((f) => f.tripped)).flat().length;
      rest += step(6, "Observe and inspect", "done", `<dl class="kv"><dt>S, final unserved ${bx.ib("S")}</dt><dd>${pc(M.S, 2)}${M.S_total != null && Math.abs(M.S_total - M.S) > 1e-9 ? ` … ${pc(M.S_total, 2)}` : ""}</dd><dt>S₀ / C ${bx.ib("C")}</dt><dd>${pc(M.S0, 1)} / ${pc(M.C, 1)}</dd><dt>Rounds · trips</dt><dd>${M.rounds} · ${trips}</dd><dt>Engine</dt><dd>${esc(ENGINE_NAME[r.engine])}</dd></dl>
        <div class="row"><button class="btn sm" id="ar-play">Replay in scene</button><button class="btn sm" id="ar-inspect">Open in Autopsy</button></div>`);
      const scoreHtml = sc.score == null ? `<div class="m-info">Unranked. ${esc(sc.reason)}</div>`
        : `<div class="score"><span class="big">${sc.score.toFixed(1)}</span><span class="of">/ 100 ${bx.ib("score")}</span></div><div class="row"><span class="badge ${sc.rank && sc.rank.exact && sc.rank.rank <= 10 && !sc.rank.zero ? "top" : ""}">${esc(sc.tier)}</span><span class="mono dim" style="font-size:12px">${esc(rankText(sc.rank))}</span></div>
          <div class="note">${esc(sc.reason)}${r.ties > 1 ? ` ${int(r.ties)} sets share this exact S.` : ""}</div><div class="formula">score = 100 × (1 − (rank − 1) / N)</div>`;
      rest += step(7, "Score", "done", scoreHtml);
      if (ref && ref.grid === r.grid && ref.outage.length === r.k) {
        const same = bx.sameSet(ref.outage, r.result.outage), rows = compareRows({ grid: r.grid, outage: r.result.outage, engineLabel: ENGINE_NAME[r.engine], result: r.result, rank: r.rank }, ref).filter(([n]) => !["Network", "Engine", "Trip policy", "k"].includes(n)).map(([n, x, y]) => [n === "Final islands" ? "Final connected components" : n, x, y]);
        rest += step(8, "Compare with the reference", "done", `<span class="note">Reference: the most damaging ${r.k}-branch set in the exhaustive table, run now in the browser engine.</span>${same ? `<div class="m-ok">Your set is the reference set.</div>` : ""}
          <table class="t"><thead><tr><th></th><th>Yours</th><th>Reference</th></tr></thead><tbody>${rows.map(([n, x, y]) => `<tr><td>${esc(n)}</td><td>${esc(x)}</td><td>${esc(y)}</td></tr>`).join("")}</tbody></table>${same ? "" : `<div class="row"><button class="btn sm" id="ar-ref">Run the reference set</button></div>`}`);
      } else rest += step(8, "Compare with the reference", "", `<span class="note">${r.mode === "ac" ? "AC results are not compared with the DC reference table." : `No exhaustive table for k = ${r.k} on this network, so there is no reference set.`}</span>`);
      rest += step(9, "Save and replay", "on", `<div class="row"><button class="btn sm" id="ar-save">Save attempt</button><span class="note">Saved in this browser only.</span></div>`);
    }
    const list = attempts.length ? `<div class="sec"><div class="row" style="justify-content:space-between"><span class="micro">Saved attempts (${attempts.length})</span>${confirmClear ? `<span class="row"><button class="btn sm" id="ar-clear-all">Delete all</button><button class="btn sm ghost" id="ar-clear-no">Keep</button></span>` : `<button class="btn sm ghost" id="ar-clear-all">Clear</button>`}</div>
      <div class="list">${attempts.map((x) => `<div style="grid-template-columns:1fr auto auto;align-items:center"><span><span class="tt mono">${GRID_NAME[x.grid] ? x.grid.replace("ieee", "IEEE-") : esc(x.grid)} {${x.outage.join(", ")}}</span><span class="dd">${esc(ENGINE_NAME[x.engine] || x.engine)} · S ${pc(x.S, 2)} · ${x.score == null ? "unranked" : `score ${x.score.toFixed(1)} · ${esc(x.rank)}`}</span></span><button class="btn sm" data-replay="${x.id}">Replay</button><button class="btn sm ghost" data-del="${x.id}" aria-label="Delete attempt">×</button></div>`).join("")}</div>
      <p class="note">Replay re-runs the saved configuration; it does not restore a stored result.</p></div>` : "";
    const keep = el.querySelector(".body")?.scrollTop || 0, act = document.activeElement?.id;
    const other = bx.runOnNet() && !r && bx.runOnNet().cfg?.origin !== "arena" ? `<div class="m-info">The scene still shows the Theater run (${esc(bx.runOnNet().label)}). Your run will replace it.</div>` : "";
    el.innerHTML = `<header><h2>Contingency Arena</h2><button class="btn sm ghost sheet-toggle" id="ar-sheet" aria-label="Collapse or expand panel" aria-expanded="${!el.classList.contains("collapsed")}">▾</button></header><div class="body"><p class="note" style="margin:0">Find the k-branch outage that leaves the most demand unserved. The score is your set's position in the exhaustive table of every k-branch set.</p>${other}<div class="steps">${s1}${s2}${s3}${s4}${s5}${rest}</div>${list}</div>`;
    el.querySelector(".body").scrollTop = keep; if (act && $(act)) $(act).focus();
  }
  store.sub((s, ch) => {
    if (ch.has("net")) { ref = null; }
    if (ch.has("run") && s.run.status === "done") computeRef();
    if (s.mode === "arena" && ["mode", "arena", "run", "net", "api", "selection"].some((k) => ch.has(k))) render();
  });
}
