// Spoken commentary over a live Director game (?director_live=<url>): director/tools/commentator.py writes clips per
// timeline event (<url>/commentary, index.json; clips at <url>/commentary/<file>). The outcome call plays when the
// game releases that ball (state.played goes up) plus the time the ball takes to reach the bat; the rest (named
// detail, over summary, figures, chase) plays once the ball is dead and while the game holds for the next one.
'use strict';

(function (root) {
  const CALL_DELAY_MS = 2600;   // release -> bat in the game; tune here if calls land early/late
  const FILL_GAP_MS = 8000;     // say a colour line (commentator.py FILLERS) after this much silence between balls

  function start(M, url, readState) {
    let ids = [], order = [], clips = {}, lastPlayed = null, lastSerial = null, cur = null, queue = [], blocked = false, quietSince = Date.now(), fillers = [];

    async function load() {
      try {
        const [s, c] = await Promise.all([fetch(url, { cache: 'no-store' }), fetch(url + '/commentary', { cache: 'no-store' })]);
        if (s.ok) ids = (await s.text()).split('\n').filter((l) => l.startsWith('ball')).map((l) => (l.match(/#\s*(\S+)\s*$/) || [])[1]);
        if (c.ok) { clips = (await c.json()).clips || {}; order = Object.keys(clips); }
      } catch (e) { console.warn('commentary:', e); }
    }

    const btn = document.createElement('button');
    btn.textContent = '🔊 Commentary';
    btn.style.cssText = 'position:absolute;top:2cqh;right:2cqw;z-index:40;font:600 2.4cqh sans-serif;padding:.8cqh 1.4cqw;' +
      'border:0;border-radius:.8cqh;background:#f7c948;color:#111;cursor:pointer';
    btn.hidden = true;
    btn.onclick = () => { blocked = false; btn.hidden = true; if (cur) cur.play().catch(() => {}); };
    document.getElementById('stage').appendChild(btn);

    function play(clip) {
      if (cur) cur.pause();
      const a = new Audio(url + '/commentary/' + clip.file);
      if (tapDest) {   // a stream wants the voice too (and it still plays aloud)
        const src = tapCtx.createMediaElementSource(a);
        src.connect(tapDest); src.connect(tapCtx.destination);
      }
      cur = a;
      a.onended = a.onerror = () => { if (cur === a) { cur = null; quietSince = Date.now(); } };
      a.play().catch((e) => { if (e.name === 'NotAllowedError') { blocked = true; btn.hidden = false; } cur = null; });
    }

    // what follows ball `id` in the match: its own detail lines, then events (timeout, innings break, result) up to
    // the next delivery
    function after(id) {
      const out = (clips[id] || []).filter((c) => c.kind !== 'call');
      const isBall = new Set(ids);
      for (let i = order.indexOf(id) + 1; i > 0 && i < order.length && !isBall.has(order[i]); i++) if (order[i] !== 'filler') out.push(...clips[order[i]]);
      return out;
    }

    function tick() {
      if (!M._director_state || blocked) return;
      const s = readState(M);
      if (!s.active) return;
      if (lastPlayed === null) {   // first look: a live join lands mid-match; open with the match chatter
        lastPlayed = s.played; lastSerial = s.seek_serial;
        queue = s.played ? after(ids[s.played - 1]) : (clips.pre || []).slice();
        return;
      }
      if (s.played !== lastPlayed) {
        const jump = s.played - lastPlayed, seeked = s.seek_serial !== lastSerial;
        lastPlayed = s.played; lastSerial = s.seek_serial;
        const id = ids[s.played - 1];
        if (!id) return;
        if (cur) { cur.pause(); cur = null; }
        if (jump === 1 && !s.catchup && !seeked) {
          const call = (clips[id] || []).find((c) => c.kind === 'call');
          queue = [];
          setTimeout(() => { if (call && lastPlayed === s.played) play(call); queue = after(id); }, CALL_DELAY_MS);
        } else {
          queue = after(id);   // a seek: no call for a ball we didn't see bowled
        }
        return;
      }
      // between balls: speak once the ball is dead, one clip at a time; colour when there's nothing new to say
      if (cur || s.done !== s.played) return;
      if (queue.length) play(queue.shift());
      else if (Date.now() - quietSince > FILL_GAP_MS) {
        if (!fillers.length) fillers = (clips.filler || []).slice().sort(() => Math.random() - 0.5);
        if (fillers.length) play(fillers.pop());
      }
    }

    // streamer.py records this (headless Chrome has no speakers for tab capture to hear); the clips still play aloud
    let tapCtx = null, tapDest = null;
    api.tap = () => {
      tapCtx = tapCtx || new AudioContext();
      tapDest = tapDest || tapCtx.createMediaStreamDestination();
      return { ctx: tapCtx, dest: tapDest };
    };

    load();
    setInterval(load, 4000);
    setInterval(tick, 250);
  }

  const api = { start };
  root.RcCommentary = api;
})(typeof window !== 'undefined' ? window : globalThis);
