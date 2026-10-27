// Timeline: the recorded event list grouped by round; play / pause / step / speed; selecting an event shows its frame and frames its equipment.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const SHORT = { initial_outage: "initial outage", round: "power flow", islanding: "islanding", load_shed: "demand shed", overload: "overload", trip: "trip", termination: "end" };

export function initTimeline(wb) {
  const { store } = wb; const track = $("tl-track");
  $("tl-play").onclick = () => wb.togglePlay(); $("tl-prev").onclick = () => { wb.stop(); wb.goEvent(store.get().playback.i - 1); }; $("tl-next").onclick = () => { wb.stop(); wb.goEvent(store.get().playback.i + 1); };
  $("tl-speed").onchange = (e) => store.set({ playback: { ...store.get().playback, speed: +e.target.value } });
  $("tl-frame").onchange = (e) => store.set({ playback: { ...store.get().playback, autoFrame: e.target.checked } });
  function build() {
    const s = store.get(), r = s.run;
    if (r.status !== "done") { track.innerHTML = `<div class="empty">${r.status === "running" ? "Running…" : r.status === "error" ? "The last run failed; no events to show." : "No cascade recorded yet. Choose a contingency and run it."}</div>`; spark(); return; }
    const byRound = new Map(); r.events.forEach((e) => { if (!byRound.has(e.round)) byRound.set(e.round, []); byRound.get(e.round).push(e); });
    track.innerHTML = [...byRound.entries()].map(([R, evs]) => `<div class="round"><span class="rh">${R === 0 ? "T0" : evs[0].type === "termination" ? "END" : `R${R}`}</span>${evs.map((e) => `<button class="evb ${e.type}" data-i="${e.i}" title="${esc(e.title)}${e.detail ? ` — ${esc(e.detail)}` : ""}"><i></i>${esc(e.type === "round" ? (e.values?.energisedIslands != null ? `flow · ${e.values.energisedIslands} isl.` : `flow · ${s.run.result.frames[e.frame].islands} comp.`) : SHORT[e.type])}${e.entities.length && e.type !== "round" ? ` · ${e.entities.length}` : ""}</button>`).join("")}</div>`).join("");
    track.querySelectorAll(".evb").forEach((b) => (b.onclick = () => { wb.stop(); wb.goEvent(+b.dataset.i); }));
    mark(); spark();
  }
  function mark() {
    const s = store.get(), r = s.run; if (r.status !== "done") { $("tl-now").textContent = "Run a contingency to record its cascade."; return; }
    const ev = r.events[s.playback.i];
    track.querySelectorAll(".evb").forEach((b) => b.setAttribute("aria-current", String(+b.dataset.i === s.playback.i)));
    const cur = track.querySelector(`.evb[data-i="${s.playback.i}"]`); if (cur) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
    $("tl-now").innerHTML = `<b>${ev.round === 0 ? "T0" : `R${ev.round}`} · ${esc(ev.title)}</b>${ev.detail ? ` — ${esc(ev.detail)}` : ""}`;
    $("tl-play").textContent = s.playback.playing ? "Pause" : "Play"; $("tl-play").setAttribute("aria-label", s.playback.playing ? "Pause" : "Play");
    spark();
  }
  function spark() {
    const s = store.get(), svg = $("tl-spark"); if (s.run.status !== "done") { svg.innerHTML = ""; return; }
    const fr = s.run.result.frames, n = fr.length, W = 180, H = 70, x = (i) => (n === 1 ? W / 2 : 6 + (i / (n - 1)) * (W - 12)), y = (v) => 6 + (1 - v) * (H - 14);
    const cur = s.run.events[s.playback.i]?.frame ?? 0;
    svg.innerHTML = `<line x1="0" x2="${W}" y1="${y(1)}" y2="${y(1)}" stroke="#2b2e33"/><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#2b2e33"/>
      <path d="${fr.map((f, i) => `${i ? "L" : "M"}${x(i)},${y(f.load_served)}`).join("")}" fill="none" stroke="#b3afa6" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
      ${fr.map((f, i) => `<circle cx="${x(i)}" cy="${y(f.load_served)}" r="${i === cur ? 3.5 : 2}" fill="${i === cur ? "#f2efe8" : "#8a877f"}"/>`).join("")}
      <text x="${W - 2}" y="${y(fr[cur].load_served) - 5}" text-anchor="end" font-size="9" fill="#e8e5de" font-family="IBM Plex Mono, monospace">${(100 * fr[cur].load_served).toFixed(1)}%</text>`;
  }
  store.sub((s, ch) => { if (ch.has("run")) build(); else if (ch.has("playback")) mark(); });
  build();
}
