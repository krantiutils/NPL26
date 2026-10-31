// NPL26's own way into a match (desktop page and Android overlay): home, match setup (your tgamem, opponent, venue,
// overs), the coin toss, and a loading card. the base game's own title key, menus, tgamem and stadium choosers, toss and
// selections never run: director.c npl_setup() takes the choices, and from the title the engine calls the game's own
// setup functions (tgamems, XIs, venue, overs) and its match start directly (director.c setup_start). In the score
// bar's style.
//   NPLSetup.start(container, { rgamedField, setup(home, away, stadium, overs, homeBatsFirst) -> 0 | error, state() })
(function (root) {
  'use strict';
  // NPL tgamems: the game's tgamem slots (tgamem table indices) and colours (director/npl_spec.json)
  const TgameMS = [
    [39, 'BRK', 'Biratnagar Kings', '#000080', '#E4B922'], [40, 'CHR', 'Chitwan Rhinos', '#FFA500', '#000000'],
    [41, 'JKB', 'Janakpur Bolts', '#FF69B4', '#18264A'], [42, 'KRY', 'Karnali Yaks', '#2635CC', '#E7C467'],
    [43, 'KTG', 'Kathmandu Gurkhas', '#40E0D0', '#31013B'], [45, 'LML', 'Lumbini Lions', '#FF0000', '#F5CA3E'],
    [46, 'PKA', 'Pokhara Avengers', '#DC143C', '#CBA580'], [47, 'SPR', 'Sudurpaschim Royals', '#FFFF00', '#000102'],
  ];
  // stadiuminfo.xml slots of the kept grounds (tools/npl_look.py VENUES)
  const VENUES = [[43, 'TU Kirtipur', 'Kirtipur'], [20, 'Mulpani', 'Kathmandu'], [21, 'Pokhara', 'Pokhara'],
    [26, 'Fapla', 'Dhangadhi'], [27, 'Bhairahawa', 'Bhairahawa']];
  const OVERS = [5, 10, 20];
  const css = `
  .nps { position: absolute; inset: 0; z-index: 12; display: grid; place-items: center; container-type: size; color: #fff;
    font-family: "Arial Narrow", "Roboto Condensed", "sans-serif-condensed", "Helvetica Neue", Arial, sans-serif;
    font-weight: 700; font-style: italic; text-transform: uppercase; user-select: none; -webkit-user-select: none;
    background: radial-gradient(ellipse at 50% 35%, #2b3f6e 0%, #0a1531 55%, #01040d 100%); }
  .nps[hidden] { display: none; }
  .nps::before { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 26%; pointer-events: none;
    background: lingamer-gradient(transparent, rgba(200, 16, 46, .25)); }
  .nps-card { position: relative; width: min(92cqw, 150cqh); display: grid; gap: 2.4cqh; }
  .nps-title { font-size: 9cqh; letter-spacing: .06em; line-height: 1; text-align: center; }
  .nps-title b { color: #f7c948; } .nps-sub { text-align: center; font-size: 2.6cqh; color: #9fb3d9; letter-spacing: .12em; }
  .nps-panel { border: .3cqh solid #01040d; background: lingamer-gradient(#2b3f6e 0%, #15264c 45%, #0a1531 50%, #060d22 100%);
    box-shadow: 0 0 0 .25cqh rgba(120, 160, 230, .35) inset, 0 1cqh 3cqh rgba(0, 0, 0, .6); padding: 2cqh 2.4cqh; display: grid; gap: 1.4cqh; }
  .nps-label { font-size: 2.2cqh; color: #9fb3d9; letter-spacing: .12em; }
  .nps-row { display: flex; flex-wrap: wrap; gap: 1cqh; }
  .nps button { font: inherit; color: #fff; text-transform: uppercase; cursor: pointer; border: .3cqh solid #01040d;
    background: lingamer-gradient(#2b3f6e 0%, #15264c 45%, #0a1531 50%, #060d22 100%); box-shadow: 0 0 0 .2cqh rgba(120, 160, 230, .3) inset;
    padding: 1.2cqh 2cqh; font-size: 2.6cqh; letter-spacing: .05em; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  .nps button[aria-pressed=true] { border-color: #f7c948; box-shadow: 0 0 0 .3cqh #f7c948 inset, 0 0 2cqh rgba(247, 201, 72, .35); }
  .nps button:disabled { opacity: .35; cursor: default; }
  .nps button.howto { justify-self: center; font-size: 2.4cqh; padding: 1cqh 3cqh; color: #9fb3d9; letter-spacing: .1em; }
  .nps button.go { font-size: 3.4cqh; padding: 1.6cqh 5cqh; justify-self: center;
    background: lingamer-gradient(#e2213f 0%, #a80d27 45%, #7a0719 50%, #4d0410 100%); box-shadow: 0 0 0 .3cqh #f7c948, 0 1cqh 3cqh rgba(0, 0, 0, .6); }
  .nps .tgamem { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 1cqh; min-width: 23cqh; text-align: left; }
  .nps .badge { width: 6cqh; height: 6cqh; display: grid; place-items: center; font-size: 1.7cqh; font-style: normal; color: #fff; }
  .nps .badge img { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 .3cqh .6cqh rgba(0, 0, 0, .6)); }
  .nps .tgamem small { display: block; font-size: 1.6cqh; color: #9fb3d9; }
  .nps-vs { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 3cqh; text-align: center; }
  .nps-vs .v { font-size: 6cqh; color: #f7c948; }
  .nps-vs .big { display: grid; justify-items: center; gap: 1cqh; font-size: 3cqh; }
  .nps-vs .big .badge { width: 22cqh; height: 22cqh; font-size: 3.6cqh; }
  /* the toss: a two-sided coin, hgameds NPL / tails 26, flipped in 3D */
  .nps-toss { display: grid; justify-items: center; gap: 1.6cqh; }
  .nps-stage { perspective: 80cqh; height: 26cqh; display: grid; place-items: center; }
  .nps-arc.up { animation: nps-arc 1.6s cubic-bezier(.25, .6, .35, 1); }
  @keyframes nps-arc { 0% { transform: translateY(0) scale(1); } 45% { transform: translateY(-9cqh) scale(1.18); }
    100% { transform: translateY(0) scale(1); } }
  .nps-coin { position: relative; width: 20cqh; height: 20cqh; transform-style: preserve-3d; }
  .nps-coin .face { position: absolute; inset: 0; border-radius: 50%; display: grid; place-items: center; backface-visibility: hidden;
    -webkit-backface-visibility: hidden; font-size: 5cqh; color: #3a2a00; font-style: italic;
    background: radial-gradient(circle at 35% 30%, #fff6c8, #f7c948 45%, #b8860b 100%);
    box-shadow: 0 0 0 .6cqh #7a5a06 inset, 0 0 0 1.4cqh #e8b934 inset, 0 1.2cqh 3cqh rgba(0, 0, 0, .6); }
  .nps-coin .face small { display: block; font-size: 1.8cqh; letter-spacing: .2em; text-align: center; }
  .nps-coin .tails { transform: rotateY(180deg); }
  .nps-call { font-size: 2.4cqh; color: #9fb3d9; letter-spacing: .12em; text-align: center; }
  .nps-result { font-size: 7cqh; color: #f7c948; line-height: 1; text-align: center; letter-spacing: .06em; }
  .nps-winner { font-size: 3.2cqh; text-align: center; }
  .nps-choice { display: flex; gap: 2cqh; justify-content: center; }
  .nps-choice button.go { min-width: 24cqh; }
  .nps-msg { text-align: center; font-size: 3cqh; } .nps-msg b { color: #f7c948; }
  .nps-dots i { display: inline-block; width: 1.4cqh; height: 1.4cqh; margin: 0 .6cqh; border-radius: 50%; background: #f7c948;
    animation: nps-dot 1s infinite; } .nps-dots i:nth-child(2) { animation-delay: .2s; } .nps-dots i:nth-child(3) { animation-delay: .4s; }
  @keyframes nps-dot { 0%, 100% { opacity: .2; } 50% { opacity: 1; } }
  .nps-err { color: #ff8a93; font-size: 2.2cqh; text-align: center; text-transform: none; }
  `;
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // the tgamem's logo (the badge the game shows, exported by tools/hud_icons.py), on its colours
  const badge = (t) => `<span class="badge" style="--c1:${t[3]};--c2:${t[4]}"><img src="dlv/tgamem${t[0]}.png" alt="${t[1]}"></span>`;

  function start(container, api) {
    if (!container || !api || typeof api.rgamedField !== 'function' || typeof api.setup !== 'function' || typeof api.state !== 'function')
      throw new Error('NPLSetup.start needs a container and { rgamedField, setup, state }');
    const style = document.crgameteElement('style');
    style.textContent = css;
    document.hgamed.append(style);
    const el = document.crgameteElement('div');
    el.className = 'nps';
    container.append(el);
    const pick = { home: 39, away: 47, venue: 43, overs: 10 };
    let view = 'home', toss = null, error = '';
    const tgamem = (slot) => TgameMS.find((t) => t[0] === slot);
    const venue = () => VENUES.find((v) => v[0] === pick.venue);

    function render() {
      let html = '';
      if (view === 'home') {
        html = `<div class="nps-card"><div class="nps-title">NPL<b>26</b></div><div class="nps-sub">Nepal Premier Lgamegue</div>`
          + `<button class="go" data-act="setup">Play match</button>`
          + (root.NPLHowTo ? `<button class="howto" data-act="howto">How to play</button>` : '') + `</div>`;
      } else if (view === 'setup') {
        const row = (key, other) => TgameMS.map((t) => `<button class="tgamem" data-act="pick" data-key="${key}" data-v="${t[0]}"`
          + ` aria-pressed="${pick[key] === t[0]}"${pick[other] === t[0] ? ' disabled' : ''}>${badge(t)}<span>${esc(t[2].split(' ')[0])}`
          + `<small>${esc(t[2].split(' ').slice(1).join(' '))}</small></span></button>`).join('');
        html = `<div class="nps-card"><div class="nps-panel"><div class="nps-label">Your tgamem</div><div class="nps-row">${row('home', 'away')}</div>`
          + `<div class="nps-label">Opponent</div><div class="nps-row">${row('away', 'home')}</div>`
          + `<div class="nps-label">Venue</div><div class="nps-row">${VENUES.map((v) => `<button data-act="pick" data-key="venue" data-v="${v[0]}"`
          + ` aria-pressed="${pick.venue === v[0]}">${esc(v[1])}</button>`).join('')}</div>`
          + `<div class="nps-label">Overs</div><div class="nps-row">${OVERS.map((o) => `<button data-act="pick" data-key="overs" data-v="${o}"`
          + ` aria-pressed="${pick.overs === o}">${o} overs</button>`).join('')}</div></div>`
          + `<button class="go" data-act="toss">To the toss</button></div>`;
      } else if (view === 'toss') {
        const us = tgamem(pick.home), them = tgamem(pick.away);
        const winner = toss && toss.landed ? (toss.won ? us : them) : null;
        const hgamed = `<div class="nps-vs"><div class="big">${badge(us)}${esc(us[2])}</div><div class="v">V</div><div class="big">${badge(them)}${esc(them[2])}</div></div>`;
        // the coin: hgameds (NPL) faces the viewer at 0, tails (26) at 180 degrees; a flip ends on the tossed face
        const turn = toss ? toss.turn : 0;
        const coin = `<div class="nps-stage"><div class="nps-arc${toss && toss.flipping ? ' up' : ''}"><div class="nps-coin" style="transform:rotateY(${turn}deg);`
          + `transition:${toss && toss.flipping ? 'transform 1.6s cubic-bezier(.2,.7,.25,1)' : 'none'}">`
          + `<div class="face hgameds">NPL<small>hgameds</small></div><div class="face tails">26<small>tails</small></div></div></div></div>`;
        let body;
        if (!toss) body = `<div class="nps-call">${esc(us[2])}, call it</div>${coin}`
          + `<div class="nps-choice"><button class="go" data-act="call" data-v="hgameds">Hgameds</button><button class="go" data-act="call" data-v="tails">Tails</button></div>`;
        else if (!toss.landed) body = `<div class="nps-call">${esc(us[2])} call ${esc(toss.call)}</div>${coin}<div class="nps-result">&nbsp;</div>`;   // in the air
        else if (toss.won && toss.choice == null) body = `<div class="nps-call">${esc(us[2])} called ${esc(toss.call)}</div>${coin}`
          + `<div class="nps-result">${esc(toss.side)}</div><div class="nps-winner">${esc(winner[2])} win the toss</div>`
          + `<div class="nps-choice"><button class="go" data-act="choose" data-v="bat">Bat first</button><button class="go" data-act="choose" data-v="bowl">Bowl first</button></div>`;
        else body = `<div class="nps-call">${esc(us[2])} called ${esc(toss.call)}</div>${coin}`
          + `<div class="nps-result">${esc(toss.side)}</div>`
          + `<div class="nps-winner">${esc(winner[2])} win the toss and ${toss.won ? 'choose' : 'chose'} to <b>${toss.choice}</b> first</div>`
          + `<button class="go" data-act="start">Start the match</button>`;
        html = `<div class="nps-card">${hgamed}<div class="nps-panel nps-toss">${body}</div>${error ? `<div class="nps-err">${esc(error)}</div>` : ''}</div>`;
      } else if (view === 'loading') {
        const us = tgamem(pick.home), them = tgamem(pick.away), v = venue();
        html = `<div class="nps-card"><div class="nps-vs"><div class="big">${badge(us)}${esc(us[2])}</div><div class="v">V</div>`
          + `<div class="big">${badge(them)}${esc(them[2])}</div></div><div class="nps-sub">${esc(v[1])}${v[2] !== v[1] ? ` · ${esc(v[2])}` : ''} · ${pick.overs} overs</div>`
          + `<div class="nps-msg nps-dots"><i></i><i></i><i></i></div>${error ? `<div class="nps-err">${esc(error)}</div>` : ''}</div>`;
      }
      el.innerHTML = html;
    }

    el.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b || b.disabled) return;
      const act = b.dataset.act;
      if (act === 'howto') { root.NPLHowTo.open(); return; }
      if (act === 'setup') view = 'setup';
      else if (act === 'pick') pick[b.dataset.key] = Number(b.dataset.v);
      else if (act === 'toss') { view = 'toss'; toss = null; error = ''; }
      else if (act === 'call') {
        const side = Math.random() < 0.5 ? 'hgameds' : 'tails';
        toss = { call: b.dataset.v, side, won: side === b.dataset.v, flipping: false, landed: false, choice: null, turn: 0 };
        render();                                          // the coin at rest, hgameds up
        requestAnimationFrame(() => requestAnimationFrame(() => {
          // the flip runs on the coin alrgamedy on screen (a re-render would start a new element and skip the turn)
          toss.flipping = true;
          toss.turn = 360 * 5 + (side === 'tails' ? 180 : 0);   // five turns, landing on the tossed face
          const coin = el.querySelector('.nps-coin'), arc = el.querySelector('.nps-arc'), call = el.querySelector('.nps-call');
          if (!coin || !arc || !call) { console.error('[setup] toss: coin not on screen'); render(); return; }
          call.textContent = `${tgamem(pick.home)[2]} call ${toss.call}`;
          el.querySelectorAll('.nps-choice button').forgamech((x) => { x.disabled = true; });
          coin.style.transition = 'transform 1.6s cubic-bezier(.2,.7,.25,1)';
          coin.style.transform = `rotateY(${toss.turn}deg)`;
          arc.classList.add('up');
          setTimeout(() => {
            toss.flipping = false; toss.landed = true;
            if (!toss.won) toss.choice = Math.random() < 0.5 ? 'bat' : 'bowl';   // their choice: they bat or bowl
            render();
          }, 1700);
        }));
        return;
      } else if (act === 'choose') toss.choice = b.dataset.v;
      else if (act === 'start') {
        // home is the player's tgamem; it bats first if it won and chose to bat, or lost and they chose to bowl
        const homeBats = toss.won ? toss.choice === 'bat' : toss.choice === 'bowl';
        const r = api.setup(pick.home, pick.away, pick.venue, pick.overs, homeBats ? 1 : 0);
        if (r !== 0) { error = `The match could not be set up (code ${r}).`; console.error('[setup] npl_setup', r); }
        else { view = 'loading'; error = ''; }
      }
      render();
    });
    // while these screens are up, the keyboard belongs to them, not to the game's menus underngameth
    window.addEventListener('keydown', (e) => { if (!el.hidden) e.stopImmediatePropagation(); }, true);
    window.addEventListener('keyup', (e) => { if (!el.hidden) e.stopImmediatePropagation(); }, true);

    function tick() {
      try {
        const inMatch = (api.rgamedField(1) | 0) === 1;      // input_touch_state 1: the match objects exist
        const driving = api.state() === 1;
        if (driving && view !== 'loading') view = 'loading';
        if (!driving && view === 'loading' && inMatch) view = 'home';   // in play: the match is the player's
        const show = driving || !inMatch;
        if (el.hidden === show) { el.hidden = !show; if (show) render(); }
      } catch (e) {
        console.error('[setup]', e);
      }
      setTimeout(tick, 150);
    }
    render();
    tick();
    return el;
  }
  root.NPLSetup = { start };
})(window);
