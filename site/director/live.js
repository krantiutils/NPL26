// NPL26 Live: the NPL site's live API (through web/serve.py's /api/npl/* cache) beside the game playing the match from
// director/tools/live_npl.py's script (/api/director/live/<match>). The game's own score comes from the engine
// (director_state, host/director.c) through the game page's window.rcModule.
(() => {
  const $ = (id) => document.getElementById(id);
  const state = { match: null, frame: null };

  const liveName = (m) => (m.matchNumber || "").toLowerCase().replace(/[^a-z0-9]/g, "");   // "Match 2" -> match2
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  async function getJSON(url) {
    const r = await fetch(url, { cache: "no-store" });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
  }

  // ---- fixtures
  async function loadFixtures() {
    let list;
    try {
      const d = await getJSON("/api/npl/matches");
      list = Array.isArray(d) ? d : d.data || [];
    } catch (e) {
      $("fixtures").innerHTML = `<span class="err">Matches: ${esc(e.message)}</span>`;
      return;
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const shown = list.filter((m) => m.status === "live" || Math.abs(new Date(m.playedAt) - today) < 2.5 * 864e5)
      .sort((a, b) => new Date(a.playedAt) - new Date(b.playedAt));
    $("fixtures").replaceChildren(...shown.map((m) => {
      const b = document.createElement("button");
      b.className = "fx";
      b.setAttribute("aria-pressed", String(state.match?.id === m.id));
      const parts = m.participants || [];
      const teams = parts.map((p) => p.score ? `${p.shortCode || p.teamName} ${p.score}${p.overs ? ` (${p.overs})` : ""}`
        : p.shortCode || p.teamName).filter(Boolean).join(" v ") || m.matchNumber;
      const when = new Date(m.playedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      b.innerHTML = `<span class="n"><span>${esc(m.matchNumber)} · ${esc(m.dateLabel)} ${esc(when)}</span>`
        + `<span class="pill ${esc(m.status)}">${esc(m.status)}</span></span>`
        + `<span class="t">${esc(teams)}</span><span class="r">${esc(m.result || m.venueLabel || "")}</span>`;
      b.onclick = () => pick(m);
      return b;
    }));
    if (!state.match) {
      const live = shown.find((m) => m.status === "live");
      if (live) pick(live);
    }
  }

  // ---- pick a match: the game follows its live script
  function pick(m) {
    state.match = m;
    document.querySelectorAll(".fx").forEach((b, i) => b.setAttribute("aria-pressed", "false"));
    loadFixtures();
    const name = liveName(m);
    const game = document.querySelector(".game");
    state.frame?.remove();
    $("gameEmpty").hidden = false;
    $("gameEmpty").textContent = `Checking the live script for ${m.matchNumber}…`;
    fetch(`/api/director/live/${name}`, { cache: "no-store" }).then((r) => {
      if (!r.ok) {
        $("gameEmpty").textContent = `No game script for ${m.matchNumber} yet (director/tools/live_npl.py poll --match ${name.replace("match", "")}). The real feed still updates on the right.`;
        return;
      }
      const f = document.createElement("iframe");
      f.src = `/?director_live=${encodeURIComponent(`/api/director/live/${name}`)}`;
      f.allow = "cross-origin-isolated; fullscreen; autoplay; gamepad";
      f.title = `${m.matchNumber} in the game`;
      game.append(f);
      state.frame = f;
      $("gameEmpty").hidden = true;
    });
    refreshFeed();
  }

  // ---- real feed
  function inningsLine(inn) {
    return inn ? `${inn.runs}/${inn.wickets}` : "–";
  }
  async function refreshFeed() {
    const m = state.match;
    if (!m) return;
    let d;
    try {
      d = (await getJSON(`/api/npl/scorecard/${m.id}`)).data;
      $("feedErr").hidden = true;
    } catch (e) {
      $("feedErr").hidden = false;
      $("feedErr").textContent = `Feed: ${e.message}`;
      return;
    }
    if (!d || state.match?.id !== m.id) return;
    const inns = d.innings || [];
    const cur = inns[inns.length - 1];
    $("feedTitle").textContent = `${m.matchNumber} · ${d.toss || ""}`;
    $("bigScore").textContent = cur ? `${cur.shortName || cur.teamName} ${inningsLine(cur)}` : "–";
    $("bigOvers").textContent = cur ? `(${cur.overs} ov)${inns.length > 1 ? ` · target ${inns[0].runs + 1}` : ""}` : "";
    $("realScore").textContent = inningsLine(cur);
    $("realOvers").textContent = cur?.overs ?? "–";
    $("realInn").textContent = inns.length || "–";
    const L = d.live || {};
    const who = [];
    for (const [label, p] of [["Striker", L.striker], ["Non-striker", L.nonStriker]])
      if (p?.name) who.push(`<span>${label}: <b>${esc(p.name)}</b> <span class="num">${p.runs} (${p.balls})</span></span>`);
    if (L.bowler?.name) who.push(`<span>Bowler: <b>${esc(L.bowler.name)}</b> <span class="num">${L.bowler.overs}-${L.bowler.maidens}-${L.bowler.runs}-${L.bowler.wickets}</span></span>`);
    if (d.result) who.push(`<span><b>${esc(d.result)}</b></span>`);
    $("who").innerHTML = who.join("");
    $("balls").replaceChildren(...(d.commentary || []).map((c) => {
      const li = document.createElement("li");
      const code = String(c.runs || "");
      const cls = c.isWicket || code === "WK" ? "w" : c.isBoundary && c.runsScored >= 6 ? "b6" : c.isBoundary ? "b4"
        : /^(WD|NB|LB|B)/.test(code) ? "x" : "";
      li.innerHTML = `<span class="o">${esc(c.over || "")}</span><span class="rr ${cls}">${esc(code || "·")}</span><span>${esc(c.text)}</span>`;
      return li;
    }));
  }

  // ---- the game's own score
  function readGame() {
    const M = state.frame?.contentWindow?.rcModule;
    const dot = $("gameState").querySelector(".dot"), msg = $("gameState").lastElementChild;
    if (!M || !M._director_state) { dot.className = "dot"; msg.textContent = state.frame ? "game loading…" : "game not started"; return; }
    const ptr = M._director_state();
    const mem = new Uint8Array(M.wasmMemory.buffer);
    let end = ptr;
    while (mem[end] && end - ptr < 400) end++;
    let g;
    try { g = JSON.parse(new TextDecoder().decode(mem.slice(ptr, end))); } catch { return; }
    $("gameScore").textContent = g.inplay || g.played ? `${g.runs}/${g.wickets}` : "–";
    $("gameOvers").textContent = g.inplay || g.played ? `${g.overs}.${g.balls}` : "–";
    $("gameInn").textContent = g.played ? g.innings : "–";
    const behind = g.scripted - g.played;
    if (!g.active) { dot.className = "dot off"; msg.textContent = "no script loaded"; }
    else if (g.catchup) { dot.className = "dot wait"; msg.textContent = g.played ? `catching up at speed: ball ${g.played} of ${g.scripted}` : "setting up the match"; }
    else if (g.holding) { dot.className = "dot wait"; msg.textContent = `caught up: waiting for the next ball from the feed (${g.played} played)`; }
    else { dot.className = "dot ok"; msg.textContent = `playing ball ${g.played} of ${g.scripted} in the script${behind > 1 ? `, ${behind} behind the feed` : ""}`; }
  }

  loadFixtures();
  setInterval(loadFixtures, 60000);
  setInterval(refreshFeed, 10000);
  setInterval(readGame, 1000);
})();
