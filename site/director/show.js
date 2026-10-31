// The show runner: between deliveries, put something on screen instead of the
// engine's dead time (fielders resetting, bowler walking back).
//
// Presentation only. It reads the same inputs the broadcast graphics use — the
// game's director_state (host/director.c) for which ball is playing, and the live
// script + timeline (/api/director/live/<match>[/timeline]) for what happened —
// and never writes to either.
//
// Priority (highest first). A live ball always wins:
//   1 live ball  2 event replay  3 reaction  4 over card  5 persona  6 idle
//
// Loaded after broadcast.js by web/index.html; active only with ?director_live=.
(function (root) {
  'use strict';

  const source = new URLSearchParams(location.search).get('director_live');
  if (!source || !root.RcPersona) return;

  const stage = document.getElementById('stage');
  if (!stage) return;

  const LOG = (...a) => console.log('[show]', ...a);

  const persona = root.RcPersona.mount(stage);

  // --- tuning (constants, not magic numbers sprinkled around) ---
  const COOLDOWN_MS = 900;     // minimum quiet time between segments
  const WICKET_MS = 5200;
  const BOUNDARY_MS = 4400;
  const OVER_MS = 4200;
  const STAT_MS = 3800;
  const MAX_PER_BALL = 1;
  const IDLE_MS = 8000;         // nothing on screen for this long -> Kaka says something

  let ids = [];                 // script ball -> timeline event id
  let events = new Map();       // event id -> timeline event
  let played = -1;
  let shownForBall = -1;
  let cooldownUntil = 0;
  let active = null;            // { until, talkTimer }
  let lastOverCard = -1;
  let lastStatOver = -1;
  let lastShownAt = 0;

  const now = () => performance.now();

  // ---- load the script + timeline (same files broadcast.js reads) ----
  async function load() {
    try {
      const [s, t] = await Promise.all([
        fetch(source, { cache: 'no-store' }),
        fetch(source + '/timeline', { cache: 'no-store' }),
      ]);
      if (!s.ok || !t.ok) return;
      const text = await s.text();
      ids = text.split('\n').filter((l) => l.startsWith('ball')).map((l) => (l.match(/#\s*(\S+)\s*$/) || [])[1]);
      const tl = await t.json();
      const map = new Map();
      for (const inn of tl.innings || []) for (const e of inn.events || []) if (e.id) map.set(e.id, e);
      events = map;
      LOG('loaded', ids.length, 'balls,', events.size, 'events');
    } catch (e) {
      LOG('load failed:', e.message);
    }
  }

  // ---- game state (director_state JSON in the wasm memory) ----
  function readState() {
    const M = root.rcModule;
    if (!M || !M._director_state) return null;
    const ptr = M._director_state();
    const mem = new Uint8Array(M.wasmMemory.buffer);
    let end = ptr;
    while (mem[end] && end - ptr < 400) end++;
    try { return JSON.parse(new TextDecoder().decode(mem.slice(ptr, end))); } catch { return null; }
  }

  // ---- what the ball said ----
  function eventFor(ballIndex) {
    const id = ids[ballIndex];
    return id ? events.get(id) : null;
  }

  const score = (e) => {
    const s = e && e.result && e.result.score_after;
    return s ? `${s.runs}/${s.wickets}` : '';
  };

  function decide(g, e) {
    if (!e) return null;
    const r = e.result || {};
    if (r.wicket) {
      const kind = r.wicket.kind || 'out';
      const fielder = (r.wicket.fielders || [])[0];
      return {
        kind: 'decision',
        title: `WICKET — ${kind}`,
        lines: [r.wicket.batter_out || e.batter, fielder ? `c ${fielder}` : `b ${e.bowler}`, score(e)],
        ms: WICKET_MS,
        why: 'wicket',
      };
    }
    if (r.boundary === 'six' || r.boundary === 'four') {
      const big = r.boundary === 'six';
      return {
        kind: 'replay',
        title: `${big ? 'SIX' : 'FOUR'} — ${String(e.shot && e.shot.type || '').replace(/_/g, ' ')}`,
        lines: [e.batter, e.bowler, score(e)],
        ms: BOUNDARY_MS,
        why: r.boundary,
      };
    }
    // end of an over: an over card, once per over
    if (e.ball === 6 && e.over !== lastOverCard) {
      lastOverCard = e.over;
      return {
        kind: 'stat',
        title: `END OF OVER ${e.over}`,
        lines: [e.bowler, score(e), `over ${e.over} done`],
        ms: OVER_MS,
        why: 'over card',
      };
    }
    // nothing happened: a stat every other over, so Kaka is not wallpaper
    if (e.over !== lastStatOver && e.over % 2 === 0 && e.ball === 3) {
      lastStatOver = e.over;
      return {
        kind: 'stat',
        title: 'AT THE HALF',
        lines: [e.batter, `${e.bowler} bowling`, score(e)],
        ms: STAT_MS,
        why: 'periodic stat',
      };
    }
    return null;
  }

  // ---- segment lifecycle ----
  function talkLoop() {
    const t0 = now();
    (function step() {
      if (!active) return;
      const t = (now() - t0) / 1000;
      const level = 0.35 + 0.5 * Math.abs(Math.sin(t * 9.0)) * (0.6 + 0.4 * Math.sin(t * 2.3));
      persona.setTalking(Math.min(1, level));
      requestAnimationFrame(step);
    })();
  }

  function startSegment(seg) {
    active = { until: now() + seg.ms };
    cooldownUntil = active.until + COOLDOWN_MS;
    lastShownAt = now();
    persona.enter().openPanel({ kind: seg.kind, title: seg.title, lines: seg.lines });
    talkLoop();
    LOG('segment:', seg.why, '|', seg.title, '|', (seg.ms / 1000).toFixed(1) + 's');
  }

  function endSegment(reason) {
    if (!active) return;
    LOG('segment end:', reason);
    persona.setTalking(0).closePanel().exit();
    active = null;
  }

  // ---- the tick ----
  function tick() {
    const g = readState();
    if (!g) return;

    // Only talk when the engine is caught up and waiting for the next ball from
    // the feed (`holding`). `inplay` is useless here: this build reports it as 1
    // for the whole match, not for the ball in flight.
    if (!g.holding) { endSegment('engine busy'); return; }

    if (typeof g.played === 'number' && g.played !== played) {
      played = g.played;
      if (played > 0 && shownForBall !== played - 1) {
        const e = eventFor(played - 1);
        const seg = decide(g, e);
        if (seg && now() >= cooldownUntil) {
          shownForBall = played - 1;
          startSegment(seg);
        }
      }
    }

    if (active && now() >= active.until) endSegment('done');

    // dead air between quiet balls: say something rather than showing the walk-back
    if (!active && now() - lastShownAt > IDLE_MS) {
      const e = eventFor(Math.max(0, played - 1));
      startSegment({
        kind: 'stat',
        title: 'NPL LIVE',
        lines: [e && e.batter ? e.batter : 'watch party',
                e && e.bowler ? e.bowler : '',
                e ? `score ${score(e)}` : ''],
        ms: STAT_MS,
        why: 'idle filler',
      });
    }
  }

  // The stable URL points at director/live/current, which follows the match on air.
  // When it flips to another match the engine already holds the previous one, so the
  // only correct move is a reload -- otherwise we quietly keep playing the old game.
  let matchTag = null;
  async function watchMatch() {
    try {
      const r = await fetch(source, { cache: 'no-store' });
      if (!r.ok) return;
      const first = (await r.text()).split('\n')[0];
      if (matchTag === null) matchTag = first;
      else if (first !== matchTag) {
        console.log('[show] match changed, reloading:', first);
        location.reload();
      }
    } catch (e) {}
  }

  load();
  watchMatch();
  setInterval(load, 5000);
  setInterval(watchMatch, 15000);
  setInterval(tick, 250);

  // let the streamer / a test drive it by hand
  root.RcShow = {
    say: (kind, title, lines, ms) => startSegment({ kind, title, lines, ms: ms || 4000, why: 'manual' }),
    stop: () => endSegment('manual'),
    state: () => ({ played, active: !!active, ids: ids.length, events: events.size }),
    read: () => readState(),
    kaka: () => { const el = document.querySelector('.kaka'); return el ? el.className : null; },
  };
})(typeof self !== 'undefined' ? self : this);
