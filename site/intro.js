// Optional intro before the game: team panels with player art slamming in, then a poster, over music.
// Plays when the server has intro/intro.json (serve.py --intro <dir>):
//   {"panels": [{"player": "p0.png", "bg": "bg0.png", "title": "t0.png"}, ...], "poster": "poster.jpg",
//    "music": "anthem.mp3"}
// Any key or click skips. Resolves when it ends (or at once when there is no intro).
'use strict';

async function playIntro(stage) {
  const res = await fetch('intro/intro.json').catch(() => null);
  if (!res?.ok) return;
  const spec = await res.json();
  const url = (f) => 'intro/' + f;
  const load = (f) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url(f); });
  // everything decoded first, so no panel pops in half-loaded
  const panels = await Promise.all(spec.panels.map(async (p) =>
    ({ player: await load(p.player), bg: await load(p.bg), title: await load(p.title) })));
  const poster = spec.poster ? await load(spec.poster) : null;

  const root = document.createElement('div');
  root.style.cssText = 'position:absolute;inset:0;z-index:50;overflow:hidden;background:#000;cursor:pointer';
  const style = document.createElement('style');
  style.textContent = `
    @keyframes npl-wipe { from { clip-path: polygon(0 0,0 0,-20% 100%,-20% 100%) } to { clip-path: polygon(0 0,120% 0,100% 100%,-20% 100%) } }
    @keyframes npl-slam { 0% { transform: translateX(60%) scale(1.25) rotate(4deg); opacity: 0 }
                          60% { transform: translateX(-3%) scale(.98) rotate(-1deg); opacity: 1 }
                          100% { transform: translateX(0) scale(1) rotate(0) } }
    @keyframes npl-title { 0% { transform: translateY(80px) rotate(-6deg); opacity: 0 } 100% { transform: none; opacity: 1 } }
    @keyframes npl-drift { from { transform: scale(1) } to { transform: scale(1.06) } }
    @keyframes npl-fade { from { opacity: 1 } to { opacity: 0 } }
    .npl-layer { position:absolute; inset:0 }
    .npl-bg { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; animation: npl-wipe .35s ease-out both, npl-drift 3s linear both }
    .npl-player { position:absolute; bottom:-4%; height:96%; left:50%; translate:-50% 0; animation: npl-slam .45s cubic-bezier(.2,1.4,.4,1) .12s both }
    .npl-title { position:absolute; left:6%; bottom:8%; max-width:70%; animation: npl-title .35s ease-out .4s both }
    .npl-poster { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; animation: npl-wipe .5s ease-out both, npl-drift 5s linear both }
    .npl-skip { position:absolute; right:16px; bottom:12px; color:#fff; font:600 13px system-ui; opacity:.7; text-shadow:0 1px 3px #000 }`;
  root.appendChild(style);
  const skip = document.createElement('div');
  skip.className = 'npl-skip';
  skip.textContent = 'Click or press any key to skip';
  stage.appendChild(root);

  const audio = new Audio(url(spec.music));
  audio.volume = 0.85;
  audio.play().catch(() => {});        // started from the Play click, so the browser allows it

  let done = false, finish;
  const ended = new Promise((ok) => { finish = ok; });
  const stop = () => { if (!done) { done = true; finish(); } };
  root.addEventListener('click', stop);
  window.addEventListener('keydown', stop, { once: true });
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const show = (els) => {
    const layer = document.createElement('div');
    layer.className = 'npl-layer';
    for (const e of els) layer.appendChild(e);
    root.insertBefore(layer, skip.parentNode ? skip : null);
    // keep two layers: the new one wipes in over the previous
    while (root.querySelectorAll('.npl-layer').length > 2) root.querySelector('.npl-layer').remove();
  };
  const img = (i, cls) => { const e = i.cloneNode(); e.className = cls; return e; };
  root.appendChild(skip);

  (async () => {
    for (const p of panels) {
      if (done) return;
      show([img(p.bg, 'npl-bg'), img(p.player, 'npl-player'), img(p.title, 'npl-title')]);
      await wait(1700);
    }
    if (poster && !done) { show([img(poster, 'npl-poster')]); await wait(4500); }
    stop();
  })();

  await ended;
  window.removeEventListener('keydown', stop);
  // music fades out over a second while the game starts
  const v0 = audio.volume;
  for (let k = 1; k <= 10; k++) setTimeout(() => { audio.volume = v0 * (1 - k / 10); if (k === 10) audio.pause(); }, k * 100);
  root.style.animation = 'npl-fade .4s ease-out both';
  setTimeout(() => root.remove(), 450);
}
