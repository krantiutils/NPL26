// Kaka — the between-ball host. Presentation only: draws in its own layer and
// never touches game state. Loaded as a classic script by web/index.html:
//   const p = RcPersona.mount(document.getElementById('stage'));
//   p.enter(); p.setTalking(0..1); p.openPanel({kind,title,lines}); p.exit();
//
// The panel is the "little screen" he opens; `kind` colours its header:
// replay (red) / stat (blue) / poll (green) / decision (gold).
(function (root) {
  'use strict';

  const SVG = `
<svg viewBox="0 0 320 200" aria-hidden="true">
  <g class="tablet" transform-origin="202 104">
    <rect x="76" y="40" width="126" height="124" rx="10" class="tframe"/>
    <rect x="83" y="47" width="112" height="110" rx="6" class="tscreen"/>
    <g class="tcontent">
      <rect x="90" y="54" width="98" height="10" rx="3" class="tbar"/>
      <text x="90" y="82" class="ttitle t1"></text>
      <text x="90" y="94" class="ttitle t2"></text>
      <text x="90" y="113" class="tline l1"></text>
      <text x="90" y="126" class="tline l2"></text>
      <text x="90" y="139" class="tline l3"></text>
    </g>
  </g>

  <path d="M192 200 q0-54 56-54 q56 0 56 54 z" class="body"/>
  <rect x="238" y="144" width="28" height="10" rx="4" class="collar"/>
  <path d="M206 152 q-26 2-34-22" class="arm" fill="none"/>

  <g class="head">
    <circle cx="252" cy="86" r="46" class="skin"/>
    <path d="M206 78 a46 46 0 0 1 92 0 z" class="cap"/>
    <rect x="196" y="74" width="34" height="9" rx="4" class="capbrim"/>
    <g class="eyes">
      <ellipse cx="238" cy="88" rx="6" ry="7" class="eye"/>
      <ellipse cx="266" cy="88" rx="6" ry="7" class="eye"/>
      <circle cx="239" cy="89" r="2.4" class="pupil"/>
      <circle cx="267" cy="89" r="2.4" class="pupil"/>
    </g>
    <path d="M238 108 q14 8 28 0" class="stache"/>
    <path d="M230 106 q8 10 16 4" class="stache"/>
    <path d="M274 106 q-8 10-16 4" class="stache"/>
    <ellipse cx="252" cy="118" rx="11" ry="3" class="mouth"/>
  </g>
</svg>`;

  // the panel is 98 px wide inside a 320 px viewBox: two lines of ~17 chars
  function wrap(text) {
    const words = String(text || '').toUpperCase().split(/\s+/).filter(Boolean);
    const out = [''];
    for (const w of words) {
      const i = out.length - 1;
      if ((out[i] + ' ' + w).trim().length <= 17) out[i] = (out[i] + ' ' + w).trim();
      else if (out.length < 2) out.push(w);
      else out[1] = (out[1] + ' ' + w).slice(0, 17);
    }
    return out;
  }

  function mount(container) {
    const root_ = document.createElement('div');
    root_.className = 'kaka';
    root_.innerHTML = SVG;
    container.append(root_);

    const mouth = root_.querySelector('.mouth');
    const eyes = root_.querySelector('.eyes');
    const tablet = root_.querySelector('.tablet');
    const titles = [root_.querySelector('.t1'), root_.querySelector('.t2')];
    const lines = [root_.querySelector('.l1'), root_.querySelector('.l2'), root_.querySelector('.l3')];

    let blink = null;

    const api = {
      get el() { return root_; },

      enter() {
        if (root_.classList.contains('in')) return api;
        root_.classList.remove('out');
        root_.classList.add('in');
        blink = blink || setInterval(() => {
          eyes.classList.add('blink');
          setTimeout(() => eyes.classList.remove('blink'), 130);
        }, 3800);
        return api;
      },

      exit() {
        root_.classList.add('out');
        root_.classList.remove('in');
        return api;
      },

      /** level 0..1 — mouth opening */
      setTalking(level) {
        const v = Math.max(0, Math.min(1, Number(level) || 0));
        mouth.setAttribute('ry', (3 + v * 9).toFixed(1));
        return api;
      },

      /** kind: replay | stat | poll | decision */
      openPanel(opts) {
        const o = opts || {};
        tablet.classList.add('open');
        tablet.dataset.kind = o.kind || 'stat';
        const w = wrap(o.title || '');
        titles.forEach((t, i) => { t.textContent = w[i] || ''; });
        lines.forEach((t, i) => { t.textContent = String((o.lines || [])[i] || '').slice(0, 19); });
        return api;
      },

      closePanel() {
        tablet.classList.remove('open');
        return api;
      },
    };

    return api;
  }

  const api = { mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RcPersona = api;
})(typeof self !== 'undefined' ? self : this);
