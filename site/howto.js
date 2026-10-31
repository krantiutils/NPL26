// NPL26's How to Play, written once for the game and the web page (both in Facebook's dark-mode style). The controls are the ones web/touch.js drives
// (its button sets per game state): keys on a keyboard, the on-screen buttons on a touch screen.
//   NPLHowTo.attach(container, { touch })  the in-game sheet and its "How to play" pill in a match
//   NPLHowTo.open(tab)                      show the sheet ('bat' | 'bowl' | 'field')
//   NPLHowTo.page(el)                       the web page's version (keys), styled by the page
(function (root) {
  'use strict';
  // [keys, on-screen button, what, detail]; keys [] = nothing to press
  const GUIDE = [
    ['bat', 'Batting', [
      [['←', '↑', '↓', '→'], 'Drag, left side', 'Aim the shot', 'No aim plays a block.'],
      [['S'], 'Shot', 'Play the shot', 'Time it: the timing bar turns IDEAL as the ball arrives.'],
      [['Shift', 'S'], 'Loft', 'Hit it in the air', 'More runs, more risk of a catch.'],
      [['D'], 'Charge', 'Charge down the pitch', 'Before the ball is bowled.'],
      [['A'], 'Leave', 'Leave the ball', ''],
      [['D'], 'Run', 'Run between the wickets', 'After the shot. A (Stay) cancels the run.'],
    ]],
    ['bowl', 'Bowling', [
      [['S'], 'Tap a delivery', 'Pick a delivery', 'S is the stock ball. A, D, W, Shift, Space, Ctrl and Alt bowl the others: the bowling panel names each one and the way it turns.'],
      [['←', '↑', '↓', '→'], 'Drag, left side', 'Aim the landing spot', 'Steer the gold marker on the pitch while the bowler runs in. The panel reads the length: yorker, full, good length, short.'],
      [['S'], 'Release', 'Bowl', 'Hold to fill the effort meter, let go to bowl.'],
      [['↑'], 'Field', 'Set the field', 'Before the delivery: ↑ ↓ to browse, S to pick, W to close.'],
    ]],
    ['field', 'Fielding', [
      [[], '', 'Fielders run by themselves', 'They chase the ball and pick it up. You choose the throw.'],
      [['S'], 'To Bowler', "Throw to the bowler's end", ''],
      [['W'], 'To Keeper', 'Throw to the keeper', ''],
      [['Alt'], 'Direct Hit', 'Go for a direct hit', 'At the stumps.'],
    ]],
  ];
  const FOOT = [[['Esc'], 'Pause', 'pause'], [['S'], 'Continue', 'continue, skip a replay']];
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const caps = (keys) => keys.map((k) => `<kbd>${esc(k)}</kbd>`).join('');

  const css = `
  @font-face { font-family: Poppins; font-style: normal; font-weight: 400; font-display: swap; src: url(fonts/poppins-400.woff2) format('woff2'); }
  @font-face { font-family: Poppins; font-style: normal; font-weight: 500; font-display: swap; src: url(fonts/poppins-500.woff2) format('woff2'); }
  @font-face { font-family: Poppins; font-style: normal; font-weight: 600; font-display: swap; src: url(fonts/poppins-600.woff2) format('woff2'); }
  .nph { position: absolute; inset: 0; z-index: 14; display: grid; place-items: center; container-type: size;
    background: rgba(0, 0, 0, .6); color: #e4e6eb; user-select: none; -webkit-user-select: none;
    font-family: Poppins, "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif; }
  .nph[hidden], .nph-pill[hidden] { display: none; }
  .nph-card { width: min(92cqw, 112cqh); max-height: 92cqh; display: grid; grid-template-rows: auto auto 1fr auto;
    background: #242526; border-radius: 1.2cqh; box-shadow: 0 1.6cqh 4.8cqh rgba(0, 0, 0, .5), 0 0 0 1px rgba(255, 255, 255, .05); overflow: hidden; }
  .nph-head { position: relative; display: grid; place-items: center; height: 8.4cqh; border-bottom: 1px solid #3e4042; }
  .nph-head span { font-size: 2.9cqh; font-weight: 700; }
  .nph button { font: inherit; color: inherit; cursor: pointer; border: 0; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  .nph-x { position: absolute; right: 2cqh; top: 50%; transform: translateY(-50%); width: 5.2cqh; height: 5.2cqh; border-radius: 50%;
    background: #3a3b3c; color: #b0b3b8; font-size: 3.2cqh; line-height: 1; display: grid; place-items: center; }
  .nph-x:hover { background: #4e4f50; }
  .nph-tabs { display: flex; gap: .6cqh; padding: 0 1.6cqh; border-bottom: 1px solid #3e4042; }
  .nph-tabs button { position: relative; padding: 1.8cqh 2.4cqh; margin: .6cqh 0; border-radius: .8cqh; background: transparent;
    color: #b0b3b8; font-size: 2.2cqh; font-weight: 600; }
  .nph-tabs button:hover { background: #3a3b3c; }
  .nph-tabs button[aria-selected=true] { color: #2d88ff; }
  .nph-tabs button[aria-selected=true]::after { content: ""; position: absolute; left: 0; right: 0; bottom: -.6cqh; height: .45cqh;
    border-radius: .45cqh .45cqh 0 0; background: #2d88ff; }
  .nph-tabs button[aria-selected=true]:hover { background: transparent; }
  .nph-steps { list-style: none; margin: 0; padding: 1cqh 1.2cqh; display: grid; align-content: start; overflow: auto; }
  .nph-steps li { display: grid; grid-template-columns: 5.4cqh 19cqh 1fr; align-items: center; gap: 1.6cqh; padding: 1.1cqh 1.2cqh; border-radius: .8cqh; }
  .nph-steps li:hover { background: #3a3b3c; }
  .nph-n { width: 5.4cqh; height: 5.4cqh; border-radius: 50%; display: grid; place-items: center; background: #3a3b3c;
    font-size: 2.2cqh; font-weight: 700; color: #e4e6eb; }
  .nph-in { display: flex; flex-wrap: wrap; gap: .6cqh; }
  .nph kbd { min-width: 3.8cqh; padding: .4cqh 1cqh; text-align: center; font: inherit; font-size: 1.9cqh; font-weight: 600;
    color: #e4e6eb; background: #3a3b3c; border-radius: .8cqh; }
  .nph .tap { padding: .5cqh 1.4cqh; font-size: 1.9cqh; font-weight: 600; color: #fff; background: #1877f2; border-radius: .8cqh; }
  .nph-what b { display: block; font-size: 2.2cqh; font-weight: 600; }
  .nph-what small { display: block; margin-top: .3cqh; font-size: 1.9cqh; color: #b0b3b8; line-height: 1.35; }
  .nph-foot { display: flex; flex-wrap: wrap; gap: 1cqh 3cqh; padding: 1.6cqh 2.4cqh; font-size: 1.9cqh; color: #b0b3b8;
    border-top: 1px solid #3e4042; align-items: center; }
  .nph-foot span { display: inline-flex; gap: .8cqh; align-items: center; }
  .nph-pill { position: absolute; z-index: 13; top: 1.2cqh; left: 50%; transform: translateX(-50%); display: inline-flex; align-items: center;
    gap: .8cqh; padding: .5cqh 1.6cqh .5cqh .5cqh; border: 0; border-radius: 99cqh; background: rgba(36, 37, 38, .88); color: #e4e6eb;
    font: 600 1.9cqh/1.2 Poppins, "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif;
    box-shadow: 0 .2cqh .6cqh rgba(0, 0, 0, .3); opacity: .75; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  .nph-pill:hover { opacity: 1; }
  .nph-pill b { width: 3cqh; height: 3cqh; border-radius: 50%; display: grid; place-items: center; background: #3a3b3c; color: #2d88ff; }
  `;

  let sheet = null, pill = null, tab = 'bat', touch = false;

  function render() {
    const [, , steps] = GUIDE.find((g) => g[0] === tab);
    const how = (keys, tap) => touch ? (tap ? `<span class="tap">${esc(tap)}</span>` : '') : caps(keys);
    sheet.querySelector('.nph-tabs').innerHTML = GUIDE.map(([id, name]) =>
      `<button type="button" role="tab" data-tab="${id}" aria-selected="${id === tab}">${esc(name)}</button>`).join('');
    sheet.querySelector('.nph-steps').innerHTML = steps.map(([keys, tap, what, more], i) =>
      `<li><span class="nph-n">${i + 1}</span><span class="nph-in">${how(keys, tap)}</span>`
      + `<span class="nph-what"><b>${esc(what)}</b>${more ? `<small>${esc(more)}</small>` : ''}</span></li>`).join('');
    sheet.querySelector('.nph-foot').innerHTML = FOOT.map(([keys, tap, what]) =>
      `<span>${how(keys, tap)} ${esc(what)}</span>`).join('') + `<span>${touch ? 'Tap anywhere outside to close' : '← → switch · Esc close'}</span>`;
  }
  function open(t) {
    if (!sheet) { console.error('[howto] open before attach'); return; }
    if (t && GUIDE.some((g) => g[0] === t)) tab = t;
    render();
    sheet.hidden = false;
  }
  const close = () => { if (sheet) sheet.hidden = true; };

  function attach(container, opts = {}) {
    if (!container) throw new Error('NPLHowTo.attach needs a container');
    if (sheet) return sheet;
    touch = opts.touch ?? (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    sheet = document.createElement('div');
    sheet.className = 'nph';
    sheet.hidden = true;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'How to play');
    sheet.innerHTML = '<div class="nph-card"><div class="nph-head"><span>How to play</span>'
      + '<button type="button" class="nph-x" aria-label="Close">×</button></div>'
      + '<div class="nph-tabs" role="tablist"></div><ol class="nph-steps"></ol><div class="nph-foot"></div></div>';
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b && b.dataset.tab) { tab = b.dataset.tab; render(); }
      else if ((b && b.classList.contains('nph-x')) || e.target === sheet) close();
    });
    // while open, the keyboard drives the sheet, not the game underneath
    const keys = (e) => {
      if (sheet.hidden) return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (e.type !== 'keydown') return;
      const i = GUIDE.findIndex((g) => g[0] === tab);
      if (e.key === 'ArrowRight') { tab = GUIDE[(i + 1) % GUIDE.length][0]; render(); }
      else if (e.key === 'ArrowLeft') { tab = GUIDE[(i + GUIDE.length - 1) % GUIDE.length][0]; render(); }
      else if (e.key === 'Escape' || e.key === 'Enter' || e.code === 'KeyW') close();
    };
    window.addEventListener('keydown', keys, true);
    window.addEventListener('keyup', keys, true);
    pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'nph-pill';
    pill.innerHTML = '<b>?</b> How to play';
    pill.hidden = opts.inMatch ? !opts.inMatch() : true;
    // in a match, the tab for what the player is doing now (web/touch.js's mode)
    const MODE_TAB = { batting: 'bat', running: 'bat', bowling: 'bowl', placement: 'bowl', fieldPreset: 'bowl', fielding: 'field' };
    pill.addEventListener('click', () => open(MODE_TAB[root.NPLTouch && root.NPLTouch.state && root.NPLTouch.state.mode]));
    container.append(sheet, pill);
    // the pill shows in a match; NPL26's own screens (web/setup.js) have their own How to play button
    if (opts.inMatch) setInterval(() => {
      try { pill.hidden = !opts.inMatch(); } catch (e) { console.error('[howto]', e); }
    }, 500);
    return sheet;
  }

  // the web page's version: three cards, keys
  function page(el) {
    if (!el) throw new Error('NPLHowTo.page needs an element');
    el.innerHTML = GUIDE.map(([id, name, steps]) => `<section class="ht-card ht-${id}"><h3>${esc(name)}</h3><ol>`
      + steps.map(([keys, , what, more]) => `<li><span class="ht-keys">${caps(keys)}</span>`
        + `<span class="ht-what">${esc(what)}${more ? `<small>${esc(more)}</small>` : ''}</span></li>`).join('')
      + '</ol></section>').join('')
      + `<p class="ht-foot">${FOOT.map(([keys, , what]) => `<span>${caps(keys)} ${esc(what)}</span>`).join('')}`
      + '<span><kbd>Alt</kbd><kbd>Enter</kbd> fullscreen</span><span>On a phone, the on-screen buttons do all of this.</span></p>';
  }

  root.NPLHowTo = { attach, open, close, page, GUIDE };
})(window);
