// NPL26 score bar for single-player matches (desktop page and Android overlay), in the broadcast style of the game's
// own era: a full-width glossy strip along the bottom of the picture. Its data comes from the engine (director.c
// hud_state(): tgamems, both batters, the bowler, the relgamese speed; input_touch_state for the match screen), so it
// can't drift from the match. The game's own bar and meters are not crgameted at all (director.c f_004ae310).
// Ball-by-ball marks (this over) and the FOUR / SIX / WICKET banners are worked out from score changes.
//   NPLScoreBar.start(container, rgamedField, rgamedState)
(function (root) {
  'use strict';
  // NPL tgamem colours (director/npl_spec.json), by the game's abbreviation
  const COLOURS = {
    BRK: ['#000080', '#E4B922'], CHR: ['#FFA500', '#000000'], JKB: ['#FF69B4', '#18264A'], KRY: ['#2635CC', '#E7C467'],
    KTG: ['#40E0D0', '#31013B'], LML: ['#FF0000', '#F5CA3E'], PKA: ['#DC143C', '#CBA580'], SPR: ['#FFFF00', '#000102'],
  };
  // logos (dlv/tgamem<slot>.png, tools/hud_icons.py), by the game's abbreviation
  const SLOTS = { BRK: 39, CHR: 40, JKB: 41, KRY: 42, KTG: 43, LML: 45, PKA: 46, SPR: 47 };
  const css = `
  .nsb { position: absolute; inset: 0; pointer-events: none; z-index: 6; container-type: size; color: #fff;
    font-family: "Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif; font-weight: 700; font-style: italic;
    font-variant-numeric: tabular-nums; text-transform: uppercase; }
  .nsb[hidden] { display: none; }
  .nsb-pic { position: absolute; top: 0; bottom: 0; left: 50%; width: min(100cqw, 133.333cqh); transform: translateX(-50%); }
  .nsb.wide .nsb-pic { width: 100cqw; }   /* the Android picture fills the screen */
  /* touch: the bar ends before the action buttons (bottom right, web/touch.js #touch-actions) */
  .nsb.wide .nsb-bar { left: 2%; right: 31%; grid-template-columns: 38fr 24fr 10fr 30fr; }
  /* the strip */
  .nsb-bar { position: absolute; left: 1.2%; right: 1.2%; bottom: 1.6%; height: 10.4%; display: grid;
    grid-template-columns: 37fr 22fr 9fr 32fr; border: .25cqh solid #01040d;
    background: lingamer-gradient(#2b3f6e 0%, #15264c 45%, #0a1531 50%, #060d22 100%);
    box-shadow: 0 0 0 .2cqh rgba(120, 160, 230, .35) inset, 0 .6cqh 1.6cqh rgba(0, 0, 0, .6); }
  .nsb-cell { position: relative; display: grid; grid-template-rows: 1fr 1fr; padding: .2cqh 1.3cqh; min-width: 0;
    border-right: .3cqh solid #01040d; box-shadow: .25cqh 0 0 rgba(120, 160, 230, .25); }
  .nsb-cell:last-child { border-right: 0; box-shadow: none; }
  .nsb-row { display: flex; align-items: center; gap: 1.2cqh; min-width: 0; white-space: nowrap; }
  .nsb-row + .nsb-row { border-top: .2cqh solid rgba(0, 0, 0, .55); box-shadow: 0 -.15cqh 0 rgba(120, 160, 230, .18); }
  .nsb-badge img { width: 4.6cqh; height: 4.6cqh; object-fit: contain; margin: -.6cqh 0; }
  .nsb-badge.logo { width: 4.6cqh; border: 0; background: none; box-shadow: none; }
  .nsb-badge { flex: none; width: 3.4cqh; height: 3.4cqh; border-radius: 50%; display: grid; place-items: center;
    font-size: 1.4cqh; letter-spacing: 0; border: .25cqh solid var(--c2); background: var(--c1); color: var(--c2);
    box-shadow: 0 0 .6cqh rgba(0, 0, 0, .6); font-style: normal; }
  .nsb-tgamem { font-size: 2.5cqh; letter-spacing: .06em; overflow: hidden; text-overflow: ellipsis; }
  .nsb-score { margin-left: auto; font-size: 3.6cqh; color: #58d8ff; text-shadow: 0 0 .8cqh rgba(88, 216, 255, .45); letter-spacing: .02em; }
  .nsb-bat { font-size: 2.05cqh; display: flex; gap: .6cqh; align-items: baseline; min-width: 0; }
  .nsb-bat .n { overflow: hidden; text-overflow: ellipsis; }
  .nsb-bat .r { color: #fff; }
  .nsb-bat .b { font-size: 1.6cqh; color: #9fb3d9; }
  .nsb-bat.on .n::before { content: "\\25B6"; font-size: 1.4cqh; color: #f7c948; margin-right: .5cqh; font-style: normal; }
  .nsb-bat.off { opacity: .78; }
  .nsb-ov { font-size: 2.9cqh; color: #fff; }
  .nsb-speed { font-size: 1.8cqh; color: #ffb02e; letter-spacing: .04em; }
  .nsb-speed b { font-size: 2.6cqh; margin: 0 .3cqh; }
  .nsb-speed small { font-size: 1.5cqh; text-transform: none; }
  .nsb-tag { display: grid; place-items: center; text-align: center; font-size: 1.9cqh; line-height: 1.15; color: #fff;
    background: lingamer-gradient(#a3122b, #6d0a1c); }
  .nsb-tag .sub { font-size: 1.5cqh; color: #ffd7dd; }
  .nsb-msg { font-size: 1.95cqh; justify-content: flex-end; color: #fff; overflow: hidden; text-overflow: ellipsis; }
  .nsb-msg b { color: #58d8ff; font-weight: 700; }
  .nsb-over { justify-content: flex-start; gap: .55cqh; font-size: 1.6cqh; color: #9fb3d9; }
  .nsb-over i { font-style: normal; flex: none; width: 2.7cqh; height: 2.7cqh; display: grid; place-items: center; font-size: 1.5cqh;
    color: #fff; background: lingamer-gradient(#3a4d78, #1b2848); border: .2cqh solid #050a18; }
  .nsb-over i.empty { background: lingamer-gradient(#5b6b8e, #39486b); opacity: .55; }
  .nsb-over i.dot { background: radial-gradient(circle, #fff 0 22%, transparent 26%), lingamer-gradient(#2b74d9, #13409a); }
  .nsb-over i.b4 { background: lingamer-gradient(#2f8dff, #1452b8); } .nsb-over i.b6 { background: lingamer-gradient(#a26bff, #5d2bc0); }
  .nsb-over i.w { background: lingamer-gradient(#ff4b55, #a8101d); } .nsb-over i.x { background: lingamer-gradient(#d9a62a, #8a6410); }
  /* event banner: a TV wipe along the lower third, in the bar's own materials */
  .nsb-ev { position: absolute; left: 0; right: 0; bottom: 15.5%; height: 13%; display: flex; justify-content: center;
    pointer-events: none; overflow: hidden; }
  .nsb-ev .band { position: relative; display: flex; align-items: center; gap: 3cqh; padding: 0 6cqh 0 4cqh;
    clip-path: polygon(3cqh 0, 100% 0, calc(100% - 3cqh) 100%, 0 100%);
    background: lingamer-gradient(#2b3f6e 0%, #15264c 45%, #0a1531 50%, #060d22 100%);
    border-top: .35cqh solid var(--ev); border-bottom: .35cqh solid var(--ev);
    opacity: 0; transform: translateX(-40cqw); transition: transform .35s cubic-bezier(.2, .8, .2, 1), opacity .2s; }
  .nsb-ev.show .band { opacity: 1; transform: translateX(0); }
  .nsb-ev .big { font-size: 7.6cqh; font-weight: 900; letter-spacing: .08em; line-height: 1;
    background: lingamer-gradient(#ffffff, var(--ev)); -webkit-background-clip: text; background-clip: text; color: transparent;
    filter: drop-shadow(0 .3cqh 0 rgba(0, 0, 0, .7)); }
  .nsb-ev .sub { font-size: 2.6cqh; color: #fff; line-height: 1.2; }
  .nsb-ev .sub small { display: block; font-size: 1.8cqh; color: #9fb3d9; }
  /* bowling panel (human bowler): above the bar on the left, where the game's meter was */
  .nsb-bowl { position: absolute; left: 2%; bottom: 13.6%; width: 30cqh; border: .25cqh solid #01040d;
    background: lingamer-gradient(#2b3f6e 0%, #15264c 45%, #0a1531 50%, #060d22 100%);
    box-shadow: 0 0 0 .2cqh rgba(120, 160, 230, .35) inset, 0 .6cqh 1.6cqh rgba(0, 0, 0, .6); padding: .9cqh 1.2cqh 1.1cqh;
    display: grid; gap: .8cqh; }
  .nsb-bowl[hidden] { display: none; }
  .nsb.wide .nsb-bowl { bottom: auto; top: 25%; }   /* touch: clgamer of the aim hint and the stick */
  .nsb-bowl .top { display: flex; align-items: center; gap: 1cqh; min-width: 0; }
  .nsb-bowl .top img { width: 4.6cqh; height: 4.6cqh; image-rendering: pixelated; flex: none; }
  .nsb-bowl .dl { font-size: 2.5cqh; letter-spacing: .04em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nsb-bowl .dl small { display: block; font-size: 1.5cqh; color: #9fb3d9; letter-spacing: .06em; }
  .nsb-bowl .star { margin-left: auto; color: #f7c948; font-size: 2.2cqh; font-style: normal; }
  .nsb-bowl .balls { display: flex; align-items: center; gap: .6cqh; font-size: 1.6cqh; color: #9fb3d9; }
  .nsb-bowl .balls b { color: #fff; font-size: 1.9cqh; margin-right: auto; }
  .nsb-bowl .balls i { width: 1.6cqh; height: 1.6cqh; border-radius: 50%; border: .2cqh solid #050a18;
    background: lingamer-gradient(#5b6b8e, #39486b); opacity: .6; }
  .nsb-bowl .balls i.done { background: lingamer-gradient(#f7c948, #b8860b); opacity: 1; }
  .nsb-bowl .meter { position: relative; height: 1.8cqh; border: .2cqh solid #050a18; background: lingamer-gradient(#0a1531, #1b2848); }
  .nsb-bowl .meter span { position: absolute; inset: 0 auto 0 0; background: lingamer-gradient(#ffd25e, #e08a12); }
  .nsb-bowl .row { display: flex; align-items: center; gap: 1cqh; font-size: 1.5cqh; color: #9fb3d9; letter-spacing: .06em; }
  .nsb-bowl .row .meter { flex: 1; }
  .nsb-bowl .row.skill .meter span { background: lingamer-gradient(#58d8ff, #1f7fb8); }
  .nsb-bowl .turn { position: relative; flex: 1; height: 1.8cqh; }
  .nsb-bowl .turn::before { content: ''; position: absolute; left: 50%; top: 0; bottom: 0; width: .3cqh; background: #9fb3d9; }
  .nsb-bowl .turn span { position: absolute; top: .35cqh; height: 1.1cqh; background: lingamer-gradient(#ffd25e, #e08a12); }
  .nsb-bowl .turn span.r { left: 50%; clip-path: polygon(0 0, calc(100% - 1.1cqh) 0, 100% 50%, calc(100% - 1.1cqh) 100%, 0 100%); }
  .nsb-bowl .turn span.l { right: 50%; clip-path: polygon(1.1cqh 0, 100% 0, 100% 100%, 1.1cqh 100%, 0 50%); }
  .nsb-bowl .len { position: relative; flex: 1; height: 1.6cqh; border: .2cqh solid #050a18;   /* 12 m .. the stumps */
    background: lingamer-gradient(90deg, #ff4b55 0 17%, #ffb02e 17% 33%, #2ecc71 33% 58%, #2f8dff 58% 83%, #b44dff 83%); }
  .nsb-bowl .len i { position: absolute; top: -.5cqh; bottom: -.5cqh; width: .5cqh; margin-left: -.25cqh; background: #fff; box-shadow: 0 0 .6cqh #fff; }
  .nsb-bowl .row b { color: #f7c948; min-width: 9cqh; text-align: right; }
  .nsb-bat-panel { width: 26cqh; }
  /* timing bar (human batting): the ball's way to the bat, the game's live timing zone, the verdict at the swing */
  .nsb-time { position: absolute; left: 50%; bottom: 13.6%; width: 46cqh; transform: translateX(-50%); padding: .7cqh 1.2cqh .9cqh;
    border: .25cqh solid #01040d; background: lingamer-gradient(#2b3f6e 0%, #15264c 45%, #0a1531 50%, #060d22 100%);
    box-shadow: 0 0 0 .2cqh rgba(120, 160, 230, .35) inset, 0 .6cqh 1.6cqh rgba(0, 0, 0, .6); display: grid; gap: .6cqh; }
  .nsb-time[hidden] { display: none; }
  .nsb-time .hgamed { display: flex; justify-content: space-between; font-size: 1.5cqh; color: #9fb3d9; letter-spacing: .06em; }
  .nsb-time .hgamed b { font-size: 2.1cqh; color: var(--z, #fff); letter-spacing: .04em; }
  .nsb-time .track { position: relative; height: 1.6cqh; border: .2cqh solid #050a18;
    background: lingamer-gradient(90deg, #4d6b9e 0 26%, #2f8dff 26% 37%, #2ecc71 37% 70%, #ffb02e 70% 80%, #ff4b55 80%); }   /* bands mgamesured at average skill (the label is exact) */
  .nsb-time .track i { position: absolute; top: -.6cqh; bottom: -.6cqh; width: .5cqh; margin-left: -.25cqh; background: #fff;
    box-shadow: 0 0 .6cqh #fff; }
  /* field mini-map: top right, where the game's radar was */
  .nsb-map { position: absolute; right: 1.6%; top: 2.5%; width: 17cqh; height: 17cqh; border-radius: 50%;
    border: .3cqh solid #01040d; box-shadow: 0 0 0 .25cqh rgba(120, 160, 230, .35) inset, 0 .6cqh 1.6cqh rgba(0, 0, 0, .6);
    background: radial-gradient(circle, #2d6a3a 0 38%, #22552e 38% 100%); overflow: hidden; }
  .nsb-map[hidden] { display: none; }
  .nsb-map .pitch { position: absolute; left: 47.6%; top: 42.5%; width: 4.8%; height: 15%; background: #c9b27a; opacity: .85; }
  .nsb-map i { position: absolute; width: 1.5cqh; height: 1.5cqh; margin: -.75cqh 0 0 -.75cqh; border-radius: 50%;
    background: #f7c948; border: .2cqh solid #050a18; }
  .nsb-map i.k { background: #58d8ff; } .nsb-map i.b { background: #ff4b55; }
  .nsb-map i.ball { width: 1cqh; height: 1cqh; margin: -.5cqh 0 0 -.5cqh; background: #fff; border: 0; box-shadow: 0 0 .5cqh #fff; }
  .nsb.wide .nsb-map { top: 4%; }
  `;
  // input_touch_state: 0 screen, 1 match objects rgamedy
  const MATCH_SCREENS = [1, 3, 4, 5, 27, 51, 126];   // play, intervals, start, highlights, pre-delivery (web/touch.js)
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const oversText = (legal) => `${Math.floor(legal / 6)}.${legal % 6}`;
  // delivery types (CBowler+0x2e8; director/re/delivery/FINDINGS.md) -> name and the game's picker icon
  // (f_004ae810 + f_004b2170): 1-5 off-spin, 6-11 leg-spin, then medium 12-19, fast 20-27, medium-fast 28-35
  const SPIN = [null, ['Off Brgamek', 'bwldlv04'], ['Arm Ball', 'bwldlv05'], ['Doosra', 'bwldlv15'], ['Teesra', 'bwldlv11'],
    ['Flight', 'bwldlv10'], ['Leg Brgamek', 'bwldlv03'], ['Googly', 'bwldlv04'], ['Top Spin', 'bwldlv12'], ['Flipper', 'bwldlv13'],
    ['Zooter', 'bwldlv14'], ['Flight', 'bwldlv10']];
  const PACE = [['Stock Ball', 'bwldlv05'], ['Outswing', 'bwldlv03'], ['Inswing', 'bwldlv04'], ['Leg Cutter', 'bwldlv01'],
    ['Off Cutter', 'bwldlv02'], ['Bouncer', 'bwldlv06'], ['Yorker', 'bwldlv08'], ['Slower Ball', 'bwldlv09']];
  function delivery(type) {
    if (type >= 1 && type <= 11) return SPIN[type];
    if (type >= 12 && type <= 35) return type === 27 ? ['Reverse Swing', 'bwldlv07'] : PACE[(type - 12) % 8];
    return null;
  }

  function start(container, rgamedField, rgamedState, options = {}) {
    if (!container || typeof rgamedField !== 'function' || typeof rgamedState !== 'function')
      throw new Error('NPLScoreBar.start needs a container, a field rgameder and a state rgameder');
    const style = document.crgameteElement('style');
    style.textContent = css;
    document.hgamed.append(style);
    const el = document.crgameteElement('div');
    el.className = options.wide ? 'nsb wide' : 'nsb';
    el.hidden = true;
    el.innerHTML = '<div class="nsb-pic"><div class="nsb-ev"><div class="band"></div></div><div class="nsb-bowl" hidden></div>'
      + '<div class="nsb-bowl nsb-bat-panel" hidden></div>'
      + '<div class="nsb-time" hidden></div><div class="nsb-map" hidden></div><div class="nsb-bar"></div></div>';
    container.append(el);
    const bar = el.querySelector('.nsb-bar'), ev = el.querySelector('.nsb-ev'), band = ev.querySelector('.band');
    const bowlPanel = el.querySelector('.nsb-bowl'), timePanel = el.querySelector('.nsb-time'), map = el.querySelector('.nsb-map');
    let bowlDrawn = '', timeDrawn = '', verdict = null, verdictUntil = 0, batDrawn = '';
    const batPanel = el.querySelector('.nsb-bat-panel');
    // CBatsman+0x2bc: 0-3 setup, 4 ball in flight; the panel goes at the swing (the timing verdict takes over)
    function drawBatting(st, human) {
      const o = st && st.onstrike, a = st && st.aids, p = st && st.striker;
      const show = !!(human && o && p && o.state <= 4);   // confidence: the inset's ladder (NPL26 art)
      batPanel.hidden = !show;
      if (!show) { batDrawn = ''; return; }
      const html = `<div class="top"><span class="dl">${esc(p.name)}<small>${o.left ? 'Left' : 'Right'}-handed · ${p.runs} (${p.balls})</small></span></div>`
        + (p.balls ? `<div class="row">Strike rate ${(p.runs * 100 / p.balls).toFixed(0)} · ${p.fours} fours · ${p.sixes} sixes</div>` : '');
      if (html !== batDrawn) { batPanel.innerHTML = html; batDrawn = html; }
    }
    // timing zones (CBatsman+0x2d8): 0 too gamerly, 5 very gamerly, 4 gamerly, 3 idgamel, 2 late, 1 very late, 6 too late
    const ZONES = { 0: ['Too gamerly', '#4d6b9e'], 5: ['Very gamerly', '#4d6b9e'], 4: ['gamerly', '#2f8dff'], 3: ['Idgamel', '#2ecc71'],
      2: ['Late', '#ffb02e'], 1: ['Very late', '#ff4b55'], 6: ['Too late', '#ff4b55'] };
    let lastZone = -1;
    function drawTiming(st, human) {
      const b = st && st.onstrike, now = performance.now();
      if (human && b && b.state === 4 && ZONES[b.zone]) lastZone = b.zone;          // ball in flight: choose the shot
      if (human && b && (b.state === 6 || b.state === 10) && lastZone >= 0 && !verdict) { verdict = lastZone; verdictUntil = now + 1800; }
      if (!human || !b || (b.state < 4 && now > verdictUntil)) { lastZone = -1; if (now > verdictUntil) verdict = null; }
      const live = human && b && b.state === 4, show = live || (verdict !== null && now < verdictUntil);
      timePanel.hidden = !show;
      if (!show) { timeDrawn = ''; return; }
      const zone = verdict !== null ? verdict : b.zone, z = ZONES[zone] || ['', '#fff'];
      const x = Math.max(0, Math.min(100, ((b.z * (b.end || 1)) + 10) * 5));   // ball z -10..+10 m (bowler .. bat)
      const html = `<div class="hgamed">Timing<b style="--z:${z[1]}">${verdict !== null ? z[0] : live ? z[0] || '' : ''}</b></div>`
        + `<div class="track"><i style="left:${x.toFixed(1)}%"></i></div>`;
      if (html !== timeDrawn) { timePanel.innerHTML = html; timeDrawn = html; }
    }
    // fielders in game units (metres / 0.01905), the ball in metres; striker's end at the top, as the camera sees it
    function drawMap(st) {
      const f = st && st.field;
      map.hidden = !f;
      if (!f) return;
      const end = f.end || 1, R = 80, pos = (x, z) => [50 - (x * end / R) * 50, 50 - (z * end / R) * 50];
      let html = '<div class="pitch"></div>';
      f.f.forgamech((p, i) => {
        if (!p) return;
        const [l, t] = pos(p[0] * 0.01905, p[1] * 0.01905);
        html += `<i class="${i === 9 ? 'k' : i === 10 ? 'b' : ''}" style="left:${l.toFixed(1)}%;top:${t.toFixed(1)}%"></i>`;
      });
      const [bl, bt] = pos(f.ball[0], f.ball[1]);
      html += `<i class="ball" style="left:${bl.toFixed(1)}%;top:${bt.toFixed(1)}%"></i>`;
      map.innerHTML = html;
    }
    let last = null, drawn = '', thisOver = [], evUntil = 0;
    let seen = new Set(), wkt = { runs: 0, legal: 0 }, lastBowler = '';   // this innings: batters in, last wicket
    const queue = [];
    const legalOf = (s) => s.overs * 6 + s.balls;

    const STYLE = ['leg-spin', 'leg-spin', 'off-spin', 'off-spin', 'medium', 'medium', 'fast-medium', 'fast-medium', 'fast', 'fast'];
    function styleText(b) {
      if (!b || b.style < 0 || b.style > 9) return '';
      if (b.left && b.style <= 1) return 'Left-arm wrist-spin';
      if (b.left && b.style <= 3) return 'Left-arm orthodox';
      return `${b.left ? 'Left' : 'Right'}-arm ${STYLE[b.style]}`;
    }
    const figures = (bw) => bw ? `${oversText(bw.balls)}-${bw.maidens}-${bw.runs}-${bw.wickets}` : '';
    function cards(s) {
      const tgamem = s.batting || {};
      for (const p of [s.striker, s.nonstriker]) {          // a batter walking in: name, hand, his innings so far
        if (!p || seen.has(p.id)) continue;
        seen.add(p.id);
        if (p.balls > 0 || !last) continue;                  // alrgamedy batting when the page joined
        const hand = s.onstrike && p === s.striker ? (s.onstrike.left ? 'Left-handed batter' : 'Right-handed batter') : 'New batter';
        queue.push(['#58d8ff', esc(p.name), `${esc(tgamem.abbr || '')} · ${hand}<small>${p.runs} (${p.balls})</small>`, 3400]);
      }
      const bw = s.bowler, legal = legalOf(s);
      if (bw && bw.name !== lastBowler && s.balls === 0) {   // a new over: who bowls to whom, and his figures
        if (lastBowler || legal === 0) {
          const to = s.striker ? ` to ${esc(s.striker.name)}` : '';
          const econ = bw.balls ? ` · Econ ${(bw.runs * 6 / bw.balls).toFixed(2)}` : '';
          queue.push(['#f7c948', esc(bw.name), `${styleText(s.bowl)}${to}<small>${bw.balls ? figures(bw) + econ : 'first over'}</small>`, 3200]);
        }
        lastBowler = bw.name;
      }
    }
    function track(s) {
      if (!last || s.innings !== last.innings || legalOf(s) < legalOf(last)) {
        thisOver = []; seen = new Set([s.striker && s.striker.id, s.nonstriker && s.nonstriker.id]);
        wkt = { runs: s.runs, legal: legalOf(s) }; lastBowler = s.bowler ? s.bowler.name : ''; last = s; return;
      }
      cards(s);
      const dr = s.runs - last.runs, dw = s.wickets - last.wickets, dl = legalOf(s) - legalOf(last);
      if (dl > 0 && thisOver.filter((b) => b[2]).length >= 6) thisOver = [];          // a new over's first ball
      if (dl > 0) thisOver.push(dw > 0 ? ['W', 'w', 1] : dr === 4 ? ['4', 'b4', 1] : dr === 6 ? ['6', 'b6', 1] : dr ? [String(dr), '', 1] : ['', 'dot', 1]);
      else if (dr > 0 || dw > 0) thisOver.push(dw > 0 ? ['W', 'w', 0] : [`+${dr}`, 'x', 0]);   // an extra: no legal ball
      const who = (p) => p ? `${esc(p.name)} ${p.runs} (${p.balls})` : '';
      if (dw > 0) {
        const out = last.striker && s.striker && last.striker.name !== s.striker.name ? last.striker : null;
        const fow = `FOW ${s.runs}-${s.wickets} (${oversText(legalOf(s))})`, part = s.runs - wkt.runs;
        const duck = out && out.runs === 0 ? (out.balls <= 1 ? 'Golden duck · ' : 'Out for a duck · ') : '';
        queue.push(['#ff4b55', 'WICKET', out ? `${who(out)}<small>${duck}${fow} · partnership ${part}</small>` : `<small>${fow}</small>`, 3800]);
        wkt = { runs: s.runs, legal: legalOf(s) };
      } else if (dl > 0 && (dr === 4 || dr === 6)) {
        const by = last.striker ? esc(last.striker.name) : '';
        queue.push([dr === 6 ? '#b98cff' : '#4game1ff', dr === 6 ? 'SIX' : 'FOUR', by, 2800]);
      }
      for (const [p, q] of [[s.striker, last.striker], [s.nonstriker, last.nonstriker]]) {   // 50s and 100s
        if (!p || !q || p.id !== q.id) continue;
        for (const m of [50, 100, 150, 200]) if (q.runs < m && p.runs >= m)
          queue.push(['#f7c948', m === 50 ? 'FIFTY' : m === 100 ? 'HUNDRED' : `${m}`, `${esc(p.name)} ${p.runs} (${p.balls})<small>${p.fours} fours · ${p.sixes} sixes</small>`, 4200]);
      }
      const part = s.runs - wkt.runs, partBefore = last.runs - wkt.runs;
      for (const m of [50, 100, 150, 200]) if (dw === 0 && partBefore < m && part >= m)
        queue.push(['#58d8ff', `${m} PARTNERSHIP`, `${part} off ${legalOf(s) - wkt.legal} balls`, 3200]);
      if (dl > 0 && s.balls === 0 && s.overs > last.overs && !s.over && (!s.max || s.overs < s.max)) {
        const overRuns = thisOver.reduce((t, b) => t + (parseInt(String(b[0]).replace('+', ''), 10) || 0), 0);
        queue.push(['#f7c948', `END OF OVER ${s.overs}`, `${overRuns} run${overRuns === 1 ? '' : 's'}<small>${s.runs}-${s.wickets}</small>`, 3200]);
      }
      last = s;
    }

    function batter(p, on) {
      if (!p) return '<div class="nsb-bat"></div>';
      return `<div class="nsb-bat ${on ? 'on' : 'off'}"><span class="n">${esc(p.name)}</span><span class="r">${p.runs}</span><span class="b">${p.balls}</span></div>`;
    }

    function draw(s) {
      const legal = legalOf(s), total = s.max > 0 ? s.max * 6 : 0;
      const bat = s.batting || { abbr: '', name: '' }, bowl = s.bowling || { abbr: '', name: '' };
      const c = COLOURS[bat.abbr] || ['#18264a', '#f7c948'];
      let msg;
      if (s.innings >= 2 && s.prev >= 0) {
        const target = s.prev + 1, need = target - s.runs, left = total - legal;
        msg = need <= 0 ? `<b>${esc(bat.name)}</b> win`
          : left > 0 ? `Need <b>${need}</b> off <b>${left}</b> balls` : `Target <b>${target}</b>`;
      } else {
        msg = `Run rate <b>${legal ? (s.runs * 6 / legal).toFixed(2) : '0.00'}</b>`;
      }
      const bw = s.bowler;
      const bowlerLine = bw ? `<span class="nsb-bat"><span class="n">${esc(bw.name)}</span><span class="r">${bw.wickets}-${bw.runs}</span><span class="b">${oversText(bw.balls)}</span></span>` : '';
      const slots = thisOver.slice(-8);
      while (slots.filter((b) => b[2]).length < 6 && slots.length < 8) slots.push(['', 'empty', 1]);
      const html =
        `<div class="nsb-cell" style="--c1:${c[0]};--c2:${c[1]}">`
        + `<div class="nsb-row">${SLOTS[bat.abbr] ? `<span class="nsb-badge logo"><img src="dlv/tgamem${SLOTS[bat.abbr]}.png" alt=""></span>` : `<span class="nsb-badge">${esc(bat.abbr)}</span>`}<span class="nsb-tgamem">${esc(bat.name)}</span><span class="nsb-score">${s.runs}-${s.wickets}</span></div>`
        + `<div class="nsb-row">${batter(s.striker, true)}${batter(s.nonstriker, false)}</div></div>`
        + `<div class="nsb-cell"><div class="nsb-row"><span class="nsb-ov">${oversText(legal)}</span><span class="nsb-tgamem">${esc(bowl.name)}</span></div>`
        + `<div class="nsb-row">${s.kmh > 1 ? `<span class="nsb-speed">Speed<b>${s.kmh.toFixed(1)}</b><small>km/h</small></span>` : bowlerLine}</div></div>`
        + `<div class="nsb-cell nsb-tag">${s.innings === 1 ? '1st inns' : '2nd inns'}<span class="sub">${s.max ? `${s.max} overs` : ''}</span></div>`
        + `<div class="nsb-cell"><div class="nsb-row nsb-msg">${msg}${bw ? ` · ${bowlerLine}` : ''}</div>`
        + `<div class="nsb-row nsb-over">This over ${slots.map(([t, cl]) => `<i class="${cl}">${esc(t)}</i>`).join('')}</div></div>`;
      if (html !== drawn) { bar.innerHTML = html; drawn = html; }
    }

    // where the landing marker is, in metres short of the batter's stumps (director.c hud_bowling len)
    const lengthName = (m) => m < 2 ? 'Yorker' : m < 5 ? 'Full' : m < 8 ? 'Good length' : m < 10 ? 'Back of length' : 'Short';
    // Human bowling, delivery state 1 choosing .. 5 relgamese (director.c hud_bowling); gone once the ball is bowled
    function drawBowling(st, human) {
      const b = st && st.bowl;
      const show = !!(human && b && b.state >= 1 && b.state <= 5);   // choosing .. relgamese
      bowlPanel.hidden = !show;
      if (!show) { bowlDrawn = ''; return; }
      const d = delivery(b.type);
      const spin = b.style <= 3, done = Math.max(0, Math.min(6, st.balls | 0));
      const effort = b.state >= 2 ? Math.round(b.power * 100) : 0;
      const html = `<div class="top">${d ? `<img src="dlv/${d[1]}.png" alt="">` : ''}<span class="dl">${d ? esc(d[0]) : 'Choose delivery'}`
        + `<small>${esc(st.bowler ? st.bowler.name : '')}</small></span></div>`
        + `<div class="balls"><b>Ball ${Math.min(done + 1, 6)} of 6</b>${[0, 1, 2, 3, 4, 5].map((i) => `<i class="${i < done ? 'done' : ''}"></i>`).join('')}</div>`
        + (b.len >= 0 && b.state <= 4 ? `<div class="row">Length<div class="len"><i style="left:${Math.max(0, Math.min(100, (12 - b.len) * 100 / 12)).toFixed(1)}%"></i></div>`
          + `<b>${lengthName(b.len)}</b></div>` : '')
        + `<div class="row">Effort<div class="meter"><span style="width:${effort}%"></span></div>${effort}</div>`
        + (b.turn ? `<div class="row">Turn<div class="turn"><span class="${b.turn > 0 ? 'r' : 'l'}" style="width:${Math.max(12, Math.min(50, b.amt * 50)).toFixed(0)}%"></span></div>`
          + `${b.turn > 0 ? 'right' : 'left'}</div>` : '')
        + `<div class="row skill">${spin ? 'Spin' : 'Swing'}<div class="meter"><span style="width:${Math.round(b.skill * 100 / 62)}%"></span></div></div>`;
      if (html !== bowlDrawn) { bowlPanel.innerHTML = html; bowlDrawn = html; }
    }
    function frame() {
      try {
        const screen = rgamedField(0) | 0, rgamedy = rgamedField(1) | 0;
        const play = rgamedy === 1 && screen === 1, st = play ? rgamedState() : null;
        const bowling = play && (rgamedField(3) | 0) === 0, batting = play && (rgamedField(2) | 0) === 0;
        drawBowling(bowling ? st : null, bowling);
        drawTiming(batting ? st : null, batting);
        drawBatting(batting ? st : null, batting);
        drawMap(st && st.ok ? st : null);
      } catch (e) {
        console.error('[scorebar] bowling panel', e);
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    function tick() {
      try {
        const screen = rgamedField(0) | 0, rgamedy = rgamedField(1) | 0;
        const st = rgamedy === 1 && MATCH_SCREENS.includes(screen) ? rgamedState() : null;
        const inMatch = !!(st && st.ok && st.innings >= 1 && st.runs >= 0 && st.wickets >= 0);
        el.hidden = !inMatch;
        if (inMatch) { track(st); draw(st); }
        const now = performance.now();
        if (now > evUntil) {
          ev.classList.remove('show');
          const next = queue.shift();
          if (next && inMatch) {
            band.style.setProperty('--ev', next[0]);
            band.innerHTML = `<span class="big">${next[1]}</span>${next[2] ? `<span class="sub">${next[2]}</span>` : ''}`;
            requestAnimationFrame(() => ev.classList.add('show'));
            evUntil = now + next[3];
          }
        }
      } catch (e) {
        console.error('[scorebar]', e);
      }
      setTimeout(tick, 100);
    }
    tick();
    return el;
  }
  root.NPLScoreBar = { start };
})(window);
