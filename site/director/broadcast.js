// Broadcast graphics over a live Director game (?director_live=<url>): the score bar a T20 broadcast shows (team,
// score, overs, powerplay, both batters, the bowler's figures, this over, run rates or the chase) and the pop-ups
// (FOUR, SIX, WICKET, end of over, strategic timeout). Drawn by the page over the canvas, as broadcasters key their
// graphics over the picture.
//
// What the game is showing is ball `played` of the script (host/director.c director_state). Every script ball ends
// in `# <timeline event id>` (director/tools/compile.py), and the match's timeline.json (live_npl.py, served at
// <url>/timeline) has the names and results, so the bar is the timeline replayed up to that ball.
'use strict';

(function (root) {
  const css = `
  #stage { container-type: size; }
  .rcb { position: absolute; inset: 0; pointer-events: none; z-index: 30; color: #fff;
    font-family: "Saira Condensed", "Arial Narrow", sans-serif; font-variant-numeric: tabular-nums; line-height: 1.15; }
  .rcb[hidden] { display: none; }
  .rcb-wrap { position: absolute; left: 2.5cqw; right: 2.5cqw; bottom: 3cqh; display: grid; }
  .rcb-info { justify-self: start; display: flex; gap: 2cqw; padding: .5cqh 1.4cqw; background: rgba(7, 11, 19, .86);
    border-radius: .7cqh .7cqh 0 0; font-size: 2.5cqh; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
  .rcb-info b { color: #f7c948; font-weight: 800; }
  .rcb-info:empty { display: none; }
  .rcb-bar { display: grid; grid-template-columns: 17cqw minmax(0, 1.3fr) minmax(0, 1fr); height: 9.5cqh;
    background: linear-gradient(#162033, #0a0f1a); border-radius: 0 .8cqh .8cqh .8cqh; overflow: hidden;
    box-shadow: 0 .6cqh 2.4cqh rgba(0, 0, 0, .5); }
  .rcb-team { display: grid; grid-template-columns: auto 1fr; grid-template-rows: 1fr auto; align-items: end; column-gap: 1.2cqw;
    padding: .9cqh 1.4cqw .8cqh; background: var(--rcb-c1); color: var(--rcb-t1); border-right: .5cqw solid var(--rcb-c2); }
  .rcb-team .ab { grid-row: 1 / 3; align-self: center; font-size: 3.3cqh; font-weight: 800; letter-spacing: .06em; }
  .rcb-team .sc { font-size: 5cqh; font-weight: 800; line-height: 1; }
  .rcb-team .ov { font-size: 2.3cqh; font-weight: 600; opacity: .9; display: flex; align-items: center; gap: .6cqw; }
  .rcb-team .pp { padding: 0 .5cqw; border-radius: .4cqh; background: #f7c948; color: #111; font-weight: 800; }
  .rcb-bat, .rcb-bowl { display: grid; grid-template-rows: 1fr 1fr; align-items: center; padding: .4cqh 1.6cqw; }
  .rcb-bat { border-right: 1px solid rgba(255, 255, 255, .12); }
  .rcb-bat .p, .rcb-bowl .row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 1cqw; align-items: baseline;
    font-size: 3cqh; font-weight: 600; }
  .rcb-bat .p { opacity: .72; }
  .rcb-bat .p.on { opacity: 1; }
  .rcb-bat .p.on .n::before { content: ""; display: inline-block; width: .9cqh; height: .9cqh; margin-right: .8cqw; border-radius: 50%;
    background: #f7c948; vertical-align: middle; }
  .rcb-bat .n, .rcb-bowl .n { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-transform: uppercase; letter-spacing: .03em; }
  .rcb-bat .r, .rcb-bowl .f { font-weight: 800; }
  .rcb-bat .bf, .rcb-bowl .o { font-size: 2.3cqh; opacity: .7; min-width: 3.6cqw; text-align: right; }
  .rcb-over { display: flex; gap: .5cqw; align-items: center; }
  .rcb-over i { font-style: normal; min-width: 3.3cqh; height: 3.3cqh; padding: 0 .4cqw; display: grid; place-items: center;
    border-radius: 1.7cqh; background: rgba(255, 255, 255, .16); font-size: 2cqh; font-weight: 700; }
  .rcb-over i.b4 { background: #1f7ae0; } .rcb-over i.b6 { background: #8a3ffc; } .rcb-over i.w { background: #e5484d; }
  .rcb-over i.x { background: #8a6d10; }
  .rcb-feature { position: absolute; left: 4cqw; bottom: 19cqh; max-width: 70cqw; padding: 1.2cqh 2cqw;
    background: rgba(7, 11, 19, .94); border-left: .6cqw solid var(--feature-colour); border-radius: .4cqh; }
  .rcb-feature[hidden], .rcb-summary[hidden] { display: none; }
  .rcb-feature .name { font-size: 4.3cqh; font-weight: 800; text-transform: uppercase; }
  .rcb-feature .reason { font-size: 2cqh; color: #f7c948; text-transform: uppercase; letter-spacing: .08em; }
  .rcb-feature .figures, .rcb-summary { font-size: 2.6cqh; }
  .rcb-summary { position: absolute; right: 4cqw; top: 5cqh; max-width: 45cqw; padding: 1cqh 1.6cqw;
    background: rgba(7, 11, 19, .9); border-top: .4cqh solid var(--rcb-c2); text-align: right; }
  .rcb-pop { position: absolute; left: 50%; bottom: 18cqh; transform: translateX(-50%) translateY(1cqh); opacity: 0;
    transition: opacity .25s, transform .25s; text-align: center; padding: 1.4cqh 3.4cqw 1.2cqh; border-radius: .9cqh;
    background: rgba(7, 11, 19, .92); border-bottom: .7cqh solid var(--rcb-c2); min-width: 32cqw; }
  .rcb-pop.show { opacity: 1; transform: translateX(-50%); }
  .rcb-pop .big { font-size: 9cqh; font-weight: 800; letter-spacing: .08em; line-height: 1; }
  .rcb-pop .big.b4 { color: #4ea1ff; } .rcb-pop .big.b6 { color: #b98cff; } .rcb-pop .big.w { color: #ff6b6f; }
  .rcb-pop .big.t { font-size: 5.6cqh; color: #f7c948; }
  .rcb-pop .sub { margin-top: .6cqh; font-size: 3.2cqh; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  .rcb-pop .sub2 { font-size: 2.5cqh; font-weight: 500; opacity: .8; }
  `;

  const legal = (ov) => { const [o, b] = String(ov || '0.0').split('.').map(Number); return o * 6 + (b || 0); };
  const oversOf = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const boundaryOf = (r) => { const b = r.boundary; return b === 6 || b === 'six' ? 6 : b === 4 || b === 'four' ? 4 : 0; };

  function dismissal(w, bowler) {
    const f = (w.fielders || []).join('/');
    switch (w.kind) {
      case 'bowled': return `b ${bowler}`;
      case 'lbw': return `lbw b ${bowler}`;
      case 'caught': return f === bowler || !f ? `c & b ${bowler}` : `c ${f} b ${bowler}`;
      case 'caught_and_bowled': return `c & b ${bowler}`;
      case 'stumped': return `st ${f} b ${bowler}`;
      case 'run_out': return f ? `run out (${f})` : 'run out';
      case 'hit_wicket': return `hit wicket b ${bowler}`;
      default: return String(w.kind || 'out').replace(/_/g, ' ');
    }
  }
  const bowlerWicket = (w) => !['run_out', 'retired_hurt', 'retired_out', 'obstructing_the_field', 'timed_out'].includes(w.kind);

  function chip(r) {
    const ex = r.extras || {};
    if (r.wicket) return ['W', 'w'];
    if (ex.wides) return [`${ex.wides > 1 ? ex.wides - 1 : ''}Wd`, 'x'];
    if (ex.no_balls) return [`${r.runs_bat || ''}Nb`, 'x'];
    if (ex.byes) return [`${ex.byes}b`, 'x'];
    if (ex.leg_byes) return [`${ex.leg_byes}lb`, 'x'];
    const b = boundaryOf(r);
    return [String(r.runs_bat ?? 0), b === 6 ? 'b6' : b === 4 ? 'b4' : ''];
  }

  // The timeline replayed through the first `played` script balls.
  function replay(tl, ids, played, innings) {   // innings: which one to show (default: the one being played)
    const done = new Set(ids.slice(0, played));
    const next = ids[played];
    const where = (id) => tl.innings.findIndex((inn) => inn.events.some((e) => e.id === id));
    let ii = innings ?? (next !== undefined ? where(next) : played ? where(ids[played - 1]) : 0);
    if (ii < 0) ii = 0;
    const inn = tl.innings[ii];
    if (!inn) return null;
    const bat = new Map(), bowl = new Map(), seen = [];
    let last = null, nextEv = null, partnershipRuns = 0, partnershipBalls = 0;
    const batter = (n) => { if (!bat.has(n)) bat.set(n, { r: 0, b: 0, out: null }); return bat.get(n); };
    const bowler = (n) => { if (!bowl.has(n)) bowl.set(n, { balls: 0, runs: 0, w: 0, m: 0 }); return bowl.get(n); };
    for (const e of inn.events) {
      if (e.type === 'delivery' && !done.has(e.id)) { nextEv = e; break; }
      seen.push(e);
      if (e.type === 'over_end') { if (e.maiden) bowler(e.bowler).m++; continue; }
      if (e.type !== 'delivery') continue;
      last = e;
      const r = e.result || {}, ex = r.extras || {};
      partnershipRuns += (r.runs_bat || 0) + Object.values(ex).reduce((sum, n) => sum + n, 0);
      if (!ex.wides && !ex.no_balls) partnershipBalls++;
      const s = batter(e.batter);
      if (!ex.wides) s.b++;
      s.r += r.runs_bat || 0;
      batter(e.non_striker);
      const bw = bowler(e.bowler);
      if (!ex.wides && !ex.no_balls) bw.balls++;
      bw.runs += (r.runs_bat || 0) + (ex.wides || 0) + (ex.no_balls || 0);
      if (r.wicket) {
        batter(r.wicket.batter_out).out = dismissal(r.wicket, e.bowler);
        if (bowlerWicket(r.wicket)) bw.w++;
        partnershipRuns = partnershipBalls = 0;
      }
    }
    const score = last ? last.result.score_after : { runs: 0, wickets: 0, overs: '0.0' };
    const ref = nextEv || last;
    const striker = ref ? (nextEv ? nextEv.batter : last.batter) : null;
    const non = ref ? (nextEv ? nextEv.non_striker : last.non_striker) : null;
    const bowlerName = ref ? ref.bowler : null;
    const overNo = last ? last.over : 0;
    const thisOver = last ? seen.filter((e) => e.type === 'delivery' && e.over === overNo).map((e) => chip(e.result || {})) : [];
    let target = null;
    if (ii === 1) {
      const d = tl.innings[0].events.filter((e) => e.type === 'delivery');
      if (d.length) target = d[d.length - 1].result.score_after.runs + 1;
    }
    return { ii, inn, score, bat, bowl, striker, non, bowlerName, thisOver, target, seen, last,
      partnership: { runs: partnershipRuns, balls: partnershipBalls } };
  }

  // compile.py setup() writes team ids in XI + bench order (or players order when XI is absent).
  // Read that explicit contract rather than infer identity from a possibly stale delivery.
  function playerMap(tl, script) {
    const players = new Map();
    for (const line of script.split('\n').filter((l) => l.startsWith('team '))) {
      const slot = Number(line.match(/\bslot=(\d+)/)?.[1]);
      const team = tl.header.teams.find((t) => t.game_team_slot === slot);
      const raw = line.match(/\bids=(\d+(?:,\d+)*)/)?.[1];
      if (!team || !raw) throw new Error(`broadcast: unresolved team slot ${slot}`);
      const names = (team.xi || team.players.map((p) => p.name)).concat(team.bench || []);
      const ids = raw.split(',').map(Number);
      if (names.length !== ids.length) throw new Error(`broadcast: roster length mismatch for ${team.name}`);
      ids.forEach((id, i) => {
        if (players.has(id)) throw new Error(`broadcast: duplicate player ID ${id}`);
        players.set(id, { name: names[i], team: team.name });
      });
    }
    return players;
  }

  function intervalCards(v, state, players, display = (n) => n) {
    if (!state.interval?.active) return { feature: '', summary: '' };
    const player = players.get(state.featured?.id);
    const reasons = { new_bowler: 'New bowler', bowler: 'Bowler', near_milestone: 'Approaching a milestone', just_out: 'Just out', top_scorer: 'Leading scorer' };
    let feature = '';
    if (player) {
      const bat = v.bat.get(player.name) || { r: 0, b: 0 }, bowl = v.bowl.get(player.name) || { w: 0, runs: 0, balls: 0 };
      // director_state exposes native actor roles: 11 bowler, 12/13 batters.
      const figures = state.featured.role === 11
        ? `${bowl.w}-${bowl.runs} · ${oversOf(bowl.balls)} overs`
        : `${bat.r} run${bat.r === 1 ? '' : 's'} · ${bat.b} ball${bat.b === 1 ? '' : 's'}`;
      feature = `<div class="reason">${esc(reasons[state.featured.reason] || 'Featured player')}</div>`
        + `<div class="name">${esc(display(player.name))}</div><div class="figures">Today · ${esc(figures)}</div>`;
    }
    let summary = '';
    const over = [...v.seen].reverse().find((e) => e.type === 'over_end');
    if (state.interval.over_break && over && over.over === v.last?.over) {
      const bw = v.bowl.get(over.bowler) || { w: 0, runs: 0, balls: 0 };
      summary = `<b>END OF OVER ${over.over + 1} · ${over.runs} RUNS</b><br>`
        + `${esc(display(over.bowler))} ${bw.w}-${bw.runs} (${oversOf(bw.balls)})<br>`
        + `Partnership ${v.partnership.runs} (${v.partnership.balls})`;
    }
    return { feature, summary, team: player?.team };
  }

  function start(M, url, readState) {
    if (!document.querySelector('link[data-rcb]')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.dataset.rcb = '1';
      l.href = 'https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@500;600;700;800&display=swap';
      document.head.appendChild(l);
    }
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
    const el = document.createElement('div');
    el.className = 'rcb';
    el.hidden = true;
    el.innerHTML = '<div class="rcb-wrap"><div class="rcb-info"></div><div class="rcb-bar"></div></div><div class="rcb-pop"></div><div class="rcb-feature" hidden></div><div class="rcb-summary" hidden></div>';
    document.getElementById('stage').appendChild(el);
    const [info, bar, pop] = [el.querySelector('.rcb-info'), el.querySelector('.rcb-bar'), el.querySelector('.rcb-pop')];

    const feature = el.querySelector('.rcb-feature'), summary = el.querySelector('.rcb-summary');
    let players = new Map();
    let tl = null, ids = [], lastPlayed = -1, lastSeen = new Set(), queue = [], popUntil = 0, drawn = '', lastSeekSerial;

    async function load() {
      try {
        const [s, t] = await Promise.all([fetch(url, { cache: 'no-store' }), fetch(url + '/timeline', { cache: 'no-store' })]);
        if (!s.ok || !t.ok) throw new Error(`script HTTP ${s.status}, timeline HTTP ${t.status}`);
        const text = await s.text();
        const timeline = await t.json(), mapped = playerMap(timeline, text);
        tl = timeline; players = mapped;
        ids = text.split('\n').filter((l) => l.startsWith('ball')).map((l) => (l.match(/#\s*(\S+)\s*$/) || [])[1]);
        if (ids.some((x) => !x)) console.warn('broadcast: script balls without a timeline id');
      } catch (e) { console.warn('broadcast graphics:', e); }
    }

    // a live match's real names where a stand-in plays (timeline header teams[].display_names, live_npl.py)
    function disp(n) {
      for (const t of tl.header.teams || []) if (t.display_names && t.display_names[n]) return t.display_names[n];
      return n;
    }
    const outText = (w, bowler) => dismissal({ ...w, fielders: (w.fielders || []).map(disp) }, disp(bowler));
    // dark text on a light team colour
    function ink(hex) {
      const n = parseInt(String(hex).slice(1), 16);
      if (Number.isNaN(n)) return '#fff';
      const lum = 0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255);
      return lum > 150 ? '#111' : '#fff';
    }

    function teamOf(name) { return (tl.header.teams || []).find((t) => t.name === name) || { abbrev: name.slice(0, 3).toUpperCase(), colours: [] }; }

    function draw(v) {
      const team = teamOf(v.inn.batting_team);
      el.style.setProperty('--rcb-c1', team.colours?.[0] || '#2635cc');
      el.style.setProperty('--rcb-c2', team.colours?.[1] || '#e7c467');
      el.style.setProperty('--rcb-t1', ink(team.colours?.[0] || '#2635cc'));
      const balls = legal(v.score.overs), total = (tl.header.overs || 20) * 6;
      const pp = balls < (tl.header.powerplay_overs || 6) * 6;
      const p = (n, on) => {
        if (!n) return '<div class="p"></div>';
        const s = v.bat.get(n) || { r: 0, b: 0 };
        return `<div class="p${on ? ' on' : ''}"><span class="n">${esc(disp(n))}</span><span class="r">${s.r}</span><span class="bf">${s.b}</span></div>`;
      };
      const bw = v.bowl.get(v.bowlerName) || { balls: 0, runs: 0, w: 0, m: 0 };
      const html = `<div class="rcb-team"><span class="ab">${esc(team.abbrev || team.short)}</span>`
        + `<span class="sc">${v.score.runs}-${v.score.wickets}</span><span class="ov">${v.score.overs} ov${pp ? '<span class="pp">P</span>' : ''}</span></div>`
        + `<div class="rcb-bat">${p(v.striker, true)}${p(v.non, false)}</div>`
        + `<div class="rcb-bowl"><div class="row"><span class="n">${esc(disp(v.bowlerName || ''))}</span>`
        + `<span class="f">${bw.w}-${bw.runs}</span><span class="o">${oversOf(bw.balls)}</span></div>`
        + `<div class="rcb-over">${v.thisOver.map(([t, c]) => `<i class="${c}">${esc(t)}</i>`).join('')}</div></div>`;
      if (html !== drawn) { bar.innerHTML = html; drawn = html; }
      const crr = balls ? (v.score.runs * 6 / balls).toFixed(2) : '0.00';
      let line;
      if (v.target) {
        const need = v.target - v.score.runs, left = total - balls;
        line = need <= 0 ? `<span><b>${esc(team.short || v.inn.batting_team)}</b> win</span>`
          : `<span>Need <b>${need}</b> off <b>${left}</b></span><span>RRR <b>${left ? (need * 6 / left).toFixed(2) : '–'}</b></span><span>CRR ${crr}</span>`;
      } else {
        line = `<span>CRR <b>${crr}</b></span>` + (pp ? '<span>Powerplay</span>' : '');
      }
      if (info.innerHTML !== line) info.innerHTML = line;
    }

    function popups(v, fresh) {
      for (const e of fresh) {
        if (e.type === 'strategic_timeout') { queue.push([`<div class="big t">STRATEGIC TIMEOUT</div><div class="sub">${esc(e.team || '')}</div>`, 5000]); continue; }
        if (e.type === 'over_end') {
          const bw = v.bowl.get(e.bowler) || { balls: 0, runs: 0, w: 0, m: 0 };
          queue.push([`<div class="big t">END OF OVER ${e.over + 1}</div><div class="sub">${e.runs} run${e.runs === 1 ? '' : 's'}`
            + `${e.wickets ? `, ${e.wickets} wkt${e.wickets > 1 ? 's' : ''}` : ''} · ${esc(v.inn.batting_team)} ${e.score.runs}-${e.score.wickets}</div>`
            + `<div class="sub2">${esc(disp(e.bowler))} ${oversOf(bw.balls)}-${bw.m}-${bw.runs}-${bw.w}</div>`, 4500]);
          continue;
        }
        if (e.type !== 'delivery') continue;
        const r = e.result || {};
        if (r.wicket) {
          const n = r.wicket.batter_out, s = v.bat.get(n) || { r: 0, b: 0 };
          queue.push([`<div class="big w">WICKET</div><div class="sub">${esc(disp(n))} ${s.r} (${s.b})</div>`
            + `<div class="sub2">${esc(outText(r.wicket, e.bowler))}</div>`, 5000]);
        } else if (boundaryOf(r)) {
          const b = boundaryOf(r);
          queue.push([`<div class="big b${b}">${b === 6 ? 'SIX' : 'FOUR'}</div><div class="sub">${esc(disp(e.batter))}</div>`, 3000]);
        }
      }
    }

    function tick() {
      let g;
      try { g = readState(M); } catch (e) { return; }
      // balls finished, not bowled: the result shows once the game has played it out
      const done = g.done ?? g.played;
      if (!tl || !g.active || (!g.inplay && !g.interval?.active) || g.catchup) {
        el.hidden = true; lastSeen = null; queue = []; popUntil = 0; pop.classList.remove('show'); return;
      }
      el.hidden = false;
      const v = replay(tl, ids, done);
      if (!v) return;
      // seek is the last restored target, not an in-progress flag. A serial change invalidates pop-ups.
      if (lastSeekSerial !== g.seek_serial) {
        queue = []; popUntil = 0; pop.classList.remove('show'); lastSeen = null; lastSeekSerial = g.seek_serial;
      }
      const now = new Set(v.seen.map((e) => e.id));
      // pop-ups only for what just happened: none for what the catch-up went through
      if (lastSeen && done > lastPlayed && done - lastPlayed <= 2) popups(v, v.seen.filter((e) => !lastSeen.has(e.id)));
      if (done < lastPlayed || g.interval?.active) { queue = []; popUntil = 0; pop.classList.remove('show'); }
      lastPlayed = done;
      lastSeen = now;
      draw(v);
      const cards = intervalCards(v, g, players, disp);
      feature.hidden = !cards.feature; summary.hidden = !cards.summary;
      if (feature.innerHTML !== cards.feature) feature.innerHTML = cards.feature;
      if (summary.innerHTML !== cards.summary) summary.innerHTML = cards.summary;
      feature.style.setProperty('--feature-colour', cards.team ? teamOf(cards.team).colours?.[0] || '#e7c467' : '#e7c467');
      const t = performance.now();
      if (t >= popUntil) {
        const nxt = queue.shift();
        if (nxt) { pop.innerHTML = nxt[0]; pop.classList.add('show'); popUntil = t + nxt[1]; }
        else pop.classList.remove('show');
      }
    }

    load();
    setInterval(load, 5000);
    setInterval(tick, 250);
  }

  const api = { start, replay, playerMap, intervalCards };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;   // broadcast_check.js
  else root.RcBroadcast = api;
})(typeof self !== 'undefined' ? self : this);
