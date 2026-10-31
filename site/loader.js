// the base game in the browser: copies the player's own game folder into OPFS (once; it never leaves the
// computer), starts the recompiled build (build/recomp.js), replays its frames with WebGPU and feeds it
// input and audio.
//
// URL options: ?mute (no audio) ?fps (frame rate in the console) ?log (host log) ?autoplay
//              ?exe=<name> (the executable inside the game folder, if not the profile's default)
//              ?pads=N (game controllers to expose, default 1, at most 4)
//              ?queue=1 (frames queued ahead of the display, default 2: 1 cuts 16 ms of input latency online
//              on a machine that simulates a frame well within 16 ms, else it hitches)
//              ?netplay=<url> (the room server for online play, see server/; default: this page's origin)
//              ?join=<room code>
//
// Online play (netplay.js, host/netplay.c): players meet in a room on the server; when the host starts,
// every page boots the game in deterministic lockstep mode with fresh saves, and only pad inputs travel.
// Each player's keyboard and first gamepad merge into one local pad; mouse and raw keys are off.
'use strict';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
if (params.get('broadcast')) document.body.classList.add('broadcast');   // streamer.py: the picture only
const OPFS_DIR = 'rcgame';
const MARKER = '.installed.json';   // { version } once every file is copied
const NETPLAY_BASE = new URL(params.get('netplay') || './', location.href).href.replace(/\/?$/, '/');
const status = (t) => { $('status').textContent = t; };
// the launcher's screens (index.html): loading, home, online, lobby
const show = (view) => { for (const v of document.querySelectorAll('#panel .view')) v.classList.toggle('hidden', v.id !== 'view-' + view); };
const fail = (e) => { status('Error: ' + e.message); $('panel').classList.remove('hidden'); show('loading'); };
const mb = (n) => (n / 1e6).toFixed(0);

// ------------------------------------------------------------------ game files in OPFS

async function gameDir(create) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIR, { create });
}

async function readMarker() {
  try {
    const f = await (await (await gameDir(false)).getFileHandle(MARKER)).getFile();
    return JSON.parse(await f.text());
  } catch { return null; }
}

async function writeMarker(version) {
  const fh = await (await gameDir(true)).getFileHandle(MARKER, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify({ version, at: new Date().toISOString() }));
  await w.close();
}

async function fileHandle(dir, relPath, create) {
  const parts = relPath.split('/');
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create });
  return dir.getFileHandle(parts[parts.length - 1], { create });
}

async function importFromPicker(fileList) {
  // the whole folder, minus its own name: <picked>/a/b.dat -> a/b.dat
  const list = [...fileList].map((f) => ({ f, dest: f.webkitRelativePath.split('/').slice(1).join('/') }))
    .filter((e) => e.dest);
  if (!list.some((e) => e.dest.toLowerCase().endsWith('.exe'))) throw new Error('No .exe in that folder.');
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry(OPFS_DIR, { recursive: true }); } catch {}
  await navigator.storage.persist?.();
  const dir = await gameDir(true);
  const total = list.reduce((s, e) => s + e.f.size, 0);
  let done = 0;
  $('progress').classList.remove('hidden');
  for (const e of list) {
    status(`Copying ${e.dest} (${mb(done)} / ${mb(total)} MB)`);
    const w = await (await fileHandle(dir, e.dest, true)).createWritable();
    await w.write(e.f);
    await w.close();
    done += e.f.size;
    $('progress').value = done / total;
  }
  const sig = list.map((e) => `${e.dest}:${e.f.size}`).sort().join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sig));
  await writeMarker([...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join(''));
  $('progress').classList.add('hidden');
}

// serve.py --game: the server has the game folder, so copy it from there without asking. A list of what was
// copied (path -> size:mtime) lives next to the files, so a reload only copies files that changed.
const SYNCED = '.served.json';
let servedExe = null;

async function syncFromServer() {
  const res = await fetch('game/index.json').catch(() => null);
  if (!res?.ok) return false;
  const index = await res.json();
  servedExe = index.exe;
  const dir = await gameDir(true);
  let have = {};
  try { have = JSON.parse(await (await (await dir.getFileHandle(SYNCED)).getFile()).text()); } catch {}
  const stamp = (f) => `${f.size}:${f.mtime}`;
  const todo = index.files.filter((f) => have[f.path] !== stamp(f));
  const total = todo.reduce((s, f) => s + f.size, 0);
  let done = 0;
  if (todo.length) $('progress').classList.remove('hidden');
  await navigator.storage.persist?.();
  for (const f of todo) {
    status(`Loading ${f.path} (${mb(done)} / ${mb(total)} MB)`);
    const r = await fetch('game/' + f.path.split('/').map(encodeURIComponent).join('/'));
    if (!r.ok) throw new Error(`Couldn't load ${f.path} from the server (HTTP ${r.status}).`);
    const w = await (await fileHandle(dir, f.path, true)).createWritable();
    await r.body.pipeTo(w);   // closes w
    done += f.size;
    $('progress').value = done / total;
    have[f.path] = stamp(f);
    const m = await (await dir.getFileHandle(SYNCED, { create: true })).createWritable();
    await m.write(JSON.stringify(have));   // after each file: an interrupted copy resumes where it stopped
    await m.close();
  }
  // files the folder no longer has (a mod that leaves one out) go too, or the game would still find them
  const served = new Set(index.files.map((f) => f.path));
  for (const path of Object.keys(have)) {
    if (served.has(path)) continue;
    try {
      const parts = path.split('/');
      let d = dir;
      for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
      await d.removeEntry(parts[parts.length - 1]);
    } catch (e) { if (e.name !== 'NotFoundError') throw e; }
    delete have[path];
  }
  const m = await (await dir.getFileHandle(SYNCED, { create: true })).createWritable();
  await m.write(JSON.stringify(have));
  await m.close();
  $('progress').classList.add('hidden');
  status(todo.length ? `Game files downloaded (${mb(total)} MB updated).` : 'Game files up to date.');
  const sig = index.files.map(stamp).join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sig));
  await writeMarker([...new Uint8Array(digest)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join(''));
  return true;
}

// ------------------------------------------------------------------ input

// KeyboardEvent.code -> USB HID usage (what host/input.c's key table uses)
const HID = {};
for (let i = 0; i < 26; i++) HID['Key' + String.fromCharCode(65 + i)] = 4 + i;
for (let i = 1; i <= 9; i++) HID['Digit' + i] = 29 + i;
HID.Digit0 = 39;
Object.assign(HID, {
  Enter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44, Minus: 45, Equal: 46, BracketLeft: 47, BracketRight: 48,
  Backslash: 49, Semicolon: 51, Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56, CapsLock: 57,
  PrintScreen: 70, ScrollLock: 71, Pause: 72, Insert: 73, Home: 74, PageUp: 75, Delete: 76, End: 77, PageDown: 78,
  ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82, NumLock: 83, NumpadDivide: 84, NumpadMultiply: 85,
  NumpadSubtract: 86, NumpadAdd: 87, NumpadEnter: 88, Numpad0: 98, NumpadDecimal: 99,
  ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227, ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231,
});
for (let i = 1; i <= 12; i++) HID['F' + i] = 57 + i;
for (let i = 1; i <= 9; i++) HID['Numpad' + i] = 88 + i;

// Netplay: the keyboard drives this player's pad (the game itself gets no keys or mouse, which would desync).
// Bit 4 is LB, which the game sees as L1: its modifier for lofted shots (the in-game tutorial: "L1 + shot
// button" to hit a six; on the keyboard that's Shift), so Shift holds it as well as Q. The game pauses only
// on the keyboard's Esc, not the pad's Start, so Esc is bit 20: host/netplay.c applies it to the DirectInput
// keyboard on every peer, with the pad inputs (NP_KEY_ESC). Backspace is B, back in menus.
const NET_KEYS = {   // KeyboardEvent.code -> standard-gamepad bit (20: Esc key)
  Enter: 0, Space: 0, KeyS: 0, Escape: 20, Backspace: 1, KeyD: 1, KeyA: 2, KeyW: 3, KeyQ: 4, KeyE: 5,
  ShiftLeft: 4, ShiftRight: 4,
  Digit1: 6, Digit3: 7, Tab: 8, KeyP: 9, ArrowUp: 12, ArrowDown: 13, ArrowLeft: 14, ArrowRight: 15,
};
let netKeyBits = 0;
let netKeyPressed = 0;   // keys pressed since the last poll, so a tap shorter than a frame still counts

function hookInput(M, net) {
  const canvas = $('canvas');
  if (net) {
    const key = (down) => (e) => {
      const bit = NET_KEYS[e.code];
      if (bit === undefined) return;
      e.preventDefault();
      if (down) { netKeyBits |= 1 << bit; netKeyPressed |= 1 << bit; } else netKeyBits &= ~(1 << bit);
      pollLocalPad(M);   // straight to the game: waiting for the next animation frame would add up to 16 ms
    };
    window.addEventListener('keydown', key(true));
    window.addEventListener('keyup', key(false));
    window.addEventListener('blur', () => { netKeyBits = 0; pollLocalPad(M); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    return;
  }
  const key = (down) => (e) => {
    const u = HID[e.code];
    if (u === undefined || e.repeat) return;
    if (!(e.metaKey && !down)) e.preventDefault();
    M._input_key_hid(u, down ? 1 : 0);
  };
  window.addEventListener('keydown', key(true));
  window.addEventListener('keyup', key(false));
  if (window.NPLTouch?.attach(M)) return;
  // The game draws its own cursor and reads relative motion. Lock the pointer when the browser allows
  // it (then the system cursor can't leave the game); without a lock, motion over the canvas still works.
  canvas.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== canvas) {
      const p = canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {});
    }
    M._input_mouse_button([0, 2, 1][e.button] ?? 0, 1);
  });
  window.addEventListener('mouseup', (e) => M._input_mouse_button([0, 2, 1][e.button] ?? 0, 0));
  canvas.addEventListener('mousemove', (e) => M._input_mouse_move(e.movementX, e.movementY));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// Gamepads (Gamepad API, polled every animation frame). Browsers only expose a pad after a button press
// on it. The game sees each pad as a DirectInput "Logitech Dual Action USB" (host/dinput.c); ?pads=N exposes
// N of them (default 1, at most 4). Like the native feeder (host/window.c), slots are DirectInput pad
// numbers handed out in connection order, not the browser's gamepad.index (which can start above 0, e.g.
// after a reconnect), and a pad keeps its slot until it is unplugged.
// With mapping 'standard' buttons and axes are already in the layout input_gamepad() takes. Other pads
// (older DirectInput-era ones such as the Logitech Precision) report buttons in HID order, as Windows
// DirectInput presents them and as the game's controltypes.csv expects; their axes are indexed by HID
// usage (X Y Z Rx Ry Rz ...), so the right stick is Z/Rz and Chrome puts the hat switch at axes[9].
const PAD_SLOTS = 4;
const padLast = Array.from({ length: PAD_SLOTS }, () => '');
const padSlotIndex = Array(PAD_SLOTS).fill(-1);   // slot -> gamepad.index
const padHats = new Set();   // gamepad.index of pads whose axes[9] is a hat switch
// raw button n -> standard-layout bit that host/dinput.c turns back into DirectInput button n
const STD_FOR_RAW = [2, 0, 1, 3, 4, 5, 6, 7, 9, 8, 10, 11];
// Chrome's hat axis: -1 = up, then clockwise in steps of 2/7; anything outside [-1, 1] is centred
const HAT_DIRS = [1 << 12, (1 << 12) | (1 << 15), 1 << 15, (1 << 13) | (1 << 15), 1 << 13, (1 << 13) | (1 << 14), 1 << 14, (1 << 12) | (1 << 14)];
const axis16 = (v) => Math.round(Math.max(-1, Math.min(1, v || 0)) * 32767);

function readPad(g) {
  let buttons = 0;
  if (g.mapping === 'standard') {
    g.buttons.forEach((b, i) => { if (i < 17 && (b.pressed || b.value > 0.3)) buttons |= 1 << i; });
    return { buttons, ax: [0, 1, 2, 3].map((i) => axis16(g.axes[i])) };
  }
  g.buttons.forEach((b, i) => { if (i < STD_FOR_RAW.length && (b.pressed || b.value > 0.3)) buttons |= 1 << STD_FOR_RAW[i]; });
  // axes[9] is only taken as a hat once it has shown the centred value, so a plain axis resting at 0 isn't
  // read as d-pad down
  const hat = g.axes[9];
  if (hat > 1.1) padHats.add(g.index);
  else if (padHats.has(g.index) && hat >= -1.01) buttons |= HAT_DIRS[Math.round((hat + 1) * 3.5) % 8];
  const ry = g.axes.length > 5 ? g.axes[5] : g.axes[3];
  return { buttons, ax: [axis16(g.axes[0]), axis16(g.axes[1]), axis16(g.axes[2]), axis16(ry)] };
}

// Netplay: one local pad, the first connected gamepad merged with the keyboard (host/netplay.c sends it).
// Called from the key handlers and from a 1 ms timer (not just the animation frame), so a change reaches
// the game thread within a few ms wherever it is in its frame.
let netLast = '';
function pollLocalPad(M) {
  const g = (navigator.getGamepads ? [...navigator.getGamepads()] : []).find((p) => p && p.connected);
  const { buttons, ax } = g ? readPad(g) : { buttons: 0, ax: [0, 0, 0, 0] };
  const b = buttons | netKeyBits | netKeyPressed;
  netKeyPressed = 0;
  const key = `${b}:${ax.join(',')}`;
  if (key === netLast) return;
  netLast = key;
  M._input_gamepad(0, 1, b, ax[0], ax[1], ax[2], ax[3]);
}

function pollGamepads(M) {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((g) => g && g.connected) : [];
  // free the slots of unplugged pads, then give new pads the lowest free slot
  for (let s = 0; s < PAD_SLOTS; s++)
    if (padSlotIndex[s] >= 0 && !pads.some((g) => g.index === padSlotIndex[s])) { padHats.delete(padSlotIndex[s]); padSlotIndex[s] = -1; }
  for (const g of pads) {
    if (padSlotIndex.includes(g.index)) continue;
    const s = padSlotIndex.indexOf(-1);
    if (s < 0) break;
    padSlotIndex[s] = g.index;
    console.log(`gamepad ${g.index} -> pad ${s}: ${g.id} (${g.mapping || 'non-standard'} mapping, ${g.buttons.length} buttons, ${g.axes.length} axes)`);
  }
  for (let slot = 0; slot < PAD_SLOTS; slot++) {
    const g = pads.find((p) => p.index === padSlotIndex[slot]);
    const { buttons, ax } = g ? readPad(g) : { buttons: 0, ax: [0, 0, 0, 0] };
    const connected = g ? 1 : 0;
    const key = `${connected}:${buttons}:${ax.join(',')}`;
    if (key === padLast[slot]) continue;
    padLast[slot] = key;
    M._input_gamepad(slot, connected, buttons, ax[0], ax[1], ax[2], ax[3]);
  }
}

// ------------------------------------------------------------------ audio

async function startAudio(M) {
  if (params.has('mute')) return;
  const ctx = new AudioContext({ sampleRate: 44100, latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule('audio-worklet.js');
  const node = new AudioWorkletNode(ctx, 'rc-ring', { outputChannelCount: [2] });
  node.port.postMessage({ memory: M.wasmMemory, ring: M._rc_audio_ring() });
  node.connect(ctx.destination);
  if (params.get('app') === '1') {
    // Observe a parallel branch: the original node -> destination playback path is unchanged.
    // AnalyserNode can report its input without an output connection. No PCM leaves the phone.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    node.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let power = 0, peak = 0, nonFinite = 0;
      for (const value of samples) {
        if (!Number.isFinite(value)) { nonFinite++; continue; }
        power += value * value;peak = Math.max(peak,Math.abs(value));
      }
      console.log('[audio-output]', JSON.stringify({state: ctx.state, sampleRate: ctx.sampleRate,
        time: ctx.currentTime, rms: Math.sqrt(power / samples.length), peak, nonFinite}));
    }, 5000);
  }
  const resume = () => ctx.resume();
  window.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', resume);
}

// ------------------------------------------------------------------ run

function sizeCanvas() {
  const canvas = $('canvas');
  const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (params.get('app') === '1') {
    // The phone's 2x canvas was GPU-heavy in a real match. Keep the native picture
    // at 480 render pixels high, with one uniform scale so CSS touch geometry stays valid.
    const scale = Math.max(640 / Math.max(1, r.width), 480 / Math.max(1, r.height));
    canvas.width = Math.max(1, Math.round(r.width * scale));
    canvas.height = Math.max(1, Math.round(r.height * scale));
    console.log('[app-render]', JSON.stringify({width: canvas.width, height: canvas.height,
      cssWidth: r.width, cssHeight: r.height, devicePixelRatio: window.devicePixelRatio}));
  } else {
    canvas.width = Math.max(640, Math.round(r.width * dpr));
    canvas.height = Math.max(480, Math.round(r.height * dpr));
  }
}

// A netplay session: every peer starts from the same empty saves folder, kept apart from this browser's
// normal saves (one per player slot, so two tabs of one browser can play each other).
const netSaves = (session) => `rcnetplay-${session.you}`;
async function clearNetSaves(session) {
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry(netSaves(session), { recursive: true }); } catch { /* not there yet */ }
}

function showNetStatus(M, session) {
  const el = $('netstatus');
  el.classList.remove('hidden');
  let lastFrame = 0, lastT = performance.now();
  setInterval(() => {
    const frame = M._netplay_status(0), desync = M._netplay_status(2), stalls = M._netplay_status(3);
    const now = performance.now();
    // the game thread always idles until the next frame's inputs arrive; it's only "waiting" when that
    // holds the game below full speed
    const fps = ((frame - lastFrame) * 1000) / Math.max(1, now - lastT);
    lastFrame = frame; lastT = now;
    el.classList.toggle('bad', !!desync);
    // the round trip the inputs ride on, and how many frames the delay failed to cover (a stall is a
    // frame that waited over 10 ms for the others' inputs: the game froze that long)
    const trips = session.client.trips();
    const path = trips.direct ? `direct ${trips.direct} ms` : `relayed ${trips.room} ms`;
    el.textContent = desync ? `Out of sync since frame ${desync}: restart the session`
      : `Online · player ${session.you + 1} of ${session.players} · delay ${session.delay}` +
        ` · ${path}` + (stalls ? ` · ${stalls} stalls` : '') +
        (session.reconnecting ? ' · reconnecting…' : frame > 300 && fps < 50 ? ' · waiting for players' : '') +
        (session.left?.size ? ` · ${session.left.size} left` : '');
  }, 1000);
}

// A loading bar over the stage, from the end of the intro to the game's first frame.
function loadingBar(stage) {
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;inset:0;z-index:40;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:flex-end;padding-bottom:12%;background:#000;color:#fff;font:600 14px system-ui;gap:10px';
  el.innerHTML = '<div style="width:min(60%,520px);height:8px;border-radius:4px;background:#333;overflow:hidden">' +
    '<div style="height:100%;width:0;background:#e0103a;transition:width .2s"></div></div><div></div>';
  stage.appendChild(el);
  const [bar, text] = [el.firstChild.firstChild, el.lastChild];
  return {
    set(frac, msg) { bar.style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%'; text.textContent = msg; },
    done() { el.remove(); },
  };
}

// The game's "Click to continue" title screen only waits for a key: press it for the player. The current
// frontend screen is a pointer at guest 0x95bfe8 with its id as a u16 at +4; the title is screen 822.
// Live Director: re-fetch the script every 10 s and hand a changed copy to the engine (host/director.c takes it on
// its own thread: director_buffer, fill, director_submit). A failed fetch is logged and retried on the next poll.
function followDirector(M, url, first) {
  let last = first, pending = Promise.resolve();
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // One owner serializes polls and recording seeks, including their fetches.
  M.rcDirectorRefresh = (seek = false) => {
    const update = async () => {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`director live: HTTP ${r.status}`);
      const text = await r.text();
      const count = text.split(/\r?\n/).filter((line) => line.startsWith('ball ')).length;
      if (seek && !count) throw new Error('The recording is before the first logged delivery. Seek to a later point.');
      const deadline = performance.now() + 30000;
      if (text !== last) {
        const previousUpdate = directorState(M).update_serial;
        const bytes = new TextEncoder().encode(text);
        let ptr;
        while (!(ptr = M._director_buffer(bytes.length))) {
          if (performance.now() > deadline) throw new Error('director update buffer timed out');
          await delay(20);
        }
        new Uint8Array(M.wasmMemory.buffer).set(bytes, ptr);
        M._director_submit();
        while (directorState(M).update_serial <= previousUpdate) {
          if (performance.now() > deadline) throw new Error('director script acceptance timed out');
          await delay(20);
        }
        last = text;
      }
      if (seek) {
        const initial = directorState(M), before = initial.seek_serial, attempt = initial.seek_attempt;
        if (M._director_seek(count) < 0) throw new Error(`director rejected seek to ball ${count}`);
        for (;;) {
          const state = directorState(M);
          if (state.seek_attempt > attempt && state.seek_error) throw new Error(`director cannot restore ball ${state.seek_error}`);
          if (state.seek_serial > before && state.seek === count) return state;
          if (performance.now() > deadline) throw new Error(`director seek to ball ${count} timed out`);
          await delay(20);
        }
      }
      return directorState(M);
    };
    const result = pending.then(update);
    pending = result.catch((error) => { console.warn('director live:', error); });
    return result;
  };
  setInterval(() => M.rcDirectorRefresh().catch((error) => console.warn('director live:', error)), 10000);
}

// Director: the bar stays over the menus and a late join's catch-up (nothing is drawn then) and goes when the
// game reaches the ball being played.
function directorState(M) {
  const ptr = M._director_state(), mem = new Uint8Array(M.wasmMemory.buffer);
  let end = ptr;
  while (mem[end] && end - ptr < 400) end++;
  return JSON.parse(new TextDecoder().decode(mem.slice(ptr, end)));
}
function directorLoading(M, bar) {
  const timer = setInterval(() => {
    let g;
    try { g = directorState(M); } catch (e) { console.warn('director state:', e); return; }
    if (g.seek_error) {
      bar.set(1, `Cannot seek to ball ${g.seek_error}: the script is incomplete or inconsistent. See the Director log.`);
      return;
    }
    if (!g.active || (g.inplay && !g.catchup)) { clearInterval(timer); bar.done(); return; }
    bar.set(0.9 + 0.1 * (g.scripted ? g.played / g.scripted : 0),
      g.played ? `Catching up with the match: ball ${g.played} of ${g.scripted}…` : 'Setting up the match…');
  }, 250);
}

function skipTitle(M) {
  let base = -1, seenAt = 0;
  const findBase = () => {          // wasm offset of guest address 0: the exe's PE header is at 0x400000
    const mem = new Uint8Array(M.wasmMemory.buffer);
    for (let i = mem.indexOf(0x4d, 0x400000); i >= 0 && i < mem.length - 0x1000; i = mem.indexOf(0x4d, i + 1))
      if (mem[i + 1] === 0x5a && mem[i + 2] === 0x90) {
        const pe = mem[i + 0x3c] | mem[i + 0x3d] << 8;
        if (pe >= 0x40 && pe < 0x400 && mem[i + pe] === 0x50 && mem[i + pe + 1] === 0x45 && !mem[i + pe + 2]) {
          // the mapped image, not a file copy of the exe: .rdata holds "l3%s" at 0x7988b0 once it's mapped
          const b = i - 0x400000, s = b + 0x7988b0;
          if (s > 0 && s + 4 < mem.length && mem[s] === 0x6c && mem[s + 1] === 0x33 && mem[s + 2] === 0x25 && mem[s + 3] === 0x73) return b;
        }
      }
    return -1;
  };
  const timer = setInterval(() => {
    if (base < 0 && (base = findBase()) < 0) return;
    const dv = new DataView(M.wasmMemory.buffer);
    const p = dv.getUint32(base + 0x95bfe8, true);
    const id = p ? dv.getUint16(base + p + 4, true) : -1;
    if (id !== 822) {
      if (seenAt) clearInterval(timer);                 // the title has gone: done
      return;
    }
    const now = performance.now();
    if (!seenAt) { seenAt = now; return; }
    // keys are ignored while the screen is still fading in: press every 2 s until it moves on
    if (now - seenAt < 1500 || now - (skipTitle.last || 0) < 2000) return;
    skipTitle.last = now;
    M._input_key_hid(HID.KeyS, 1);
    setTimeout(() => M._input_key_hid(HID.KeyS, 0), 120);
  }, 250);
  setTimeout(() => clearInterval(timer), 5 * 60000);   // give up if the title never shows
}

// The engine (recomp.wasm), downloaded with progress: progress(loaded, total).
async function fetchWasm(progress) {
  const r = await fetch('build/recomp.wasm');
  if (!r.ok) throw new Error(`Couldn't load the game engine (HTTP ${r.status}).`);
  const total = +r.headers.get('Content-Length') || 0;
  const reader = r.body.getReader(), parts = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); loaded += value.length;
    progress(loaded, total);
  }
  const buf = new Uint8Array(loaded);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf.buffer;
}

async function run(session) {
  $('panel').classList.add('hidden');
  let got = [0, 0], onProgress = () => {};
  const wasm = fetchWasm((l, t) => { got = [l, t]; onProgress(); });   // downloads while the intro plays
  // Director mode (?director=<url of a compiled script>, director/tools/compile.py): the engine plays it
  // ?director_live=<url>: the same, from a script that keeps growing as a real match is played (polled below)
  const directorUrl = params.get('director') || params.get('director_live');
  // intro.js; online and Director games skip it
  if (!session && !directorUrl) await playIntro($('stage')).catch((e) => console.warn('intro:', e));
  const bar = loadingBar($('stage'));
  onProgress = () => bar.set(got[1] ? got[0] / got[1] * 0.85 : 0.1,
    `Loading game engine… ${(got[0] / 1e6).toFixed(0)}${got[1] ? ' / ' + (got[1] / 1e6).toFixed(0) : ''} MB`);
  onProgress();
  fullscreenTip();
  if (session) await clearNetSaves(session);
  sizeCanvas();
  const script = document.createElement('script');
  script.src = 'build/recomp.js';
  await new Promise((ok, fail) => { script.onload = ok; script.onerror = fail; document.head.appendChild(script); });
  const wasmBinary = await wasm;
  let directorText = null;
  if (directorUrl) {
    bar.set(0.88, 'Loading the Director script…');
    const r = await fetch(directorUrl, { cache: 'no-store' });
    if (!r.ok) { bar.set(1, `Director script ${directorUrl}: HTTP ${r.status}`); throw new Error('director script'); }
    directorText = await r.text();
    const start = params.get('start');
    if (start !== null) {
      if (!/^[1-9]\d*$/.test(start) || Number(start) > 1024) throw new Error('start must be a ball index from 1 to 1024');
      directorText += `\nseek ball=${start}\n`;
    } else if (params.get('director_live')) {
      // a live match joined late: start at the latest ball the feed has (seek, no catch-up), then follow ball by ball
      const balls = directorText.split('\n').filter((l) => l.startsWith('ball ')).length;
      if (balls > 1) directorText += `\nseek ball=${balls}\n`;
    }
  }
  bar.set(0.9, 'Starting the game…');
  let firstFrame = false;
  const M = await createRecomp({
    // compile the engine from the bytes already downloaded (this build ignores the wasmBinary option)
    instantiateWasm(imports, ready) {
      WebAssembly.instantiate(wasmBinary, imports).then((r) => ready(r.instance, r.module))
        .catch((e) => { bar.set(1, 'The game engine failed to start: ' + e.message); throw e; });
      return {};
    },
    arguments: ['/opfs/' + OPFS_DIR],
    print: (t) => console.log(t),
    printErr: (t) => console.log(t),
    preRun: [(m) => {
      if (params.has('mute')) m.ENV.RC_NO_AUDIO = '1';
      if (params.get('exe') || servedExe) m.ENV.RC_EXE = params.get('exe') || servedExe;
      if (params.has('log')) m.ENV.RC_LOG = '1';
      if (params.has('pathtrace')) m.ENV.RC_PATH_TRACE = '/dev/stderr';   // archive paths the game opens (data pruning)
      if (params.has('sidelog')) m.ENV.RC_SIDE_LOG = '1';   // team-select controller sides (host/director.c side_log)
      if (params.has('pads')) m.ENV.RC_PADS = params.get('pads');
      if (params.has('queue')) m.ENV.RC_QUEUE = params.get('queue');
      if (directorText) m.ENV.RC_DIRECTOR_TEXT = directorText;
      if (directorText && params.get('director_live')) m.ENV.RC_DIRECTOR_LIVE = '1';
      // the clock counts frames, so the menus and a late join's catch-up run as fast as frames can be made
      // (host/director.c turns on turbo there)
      if (directorText) m.ENV.RC_DETERMINISTIC = '1';
      if (session) Object.assign(m.ENV, RcNetplay.gameEnv(session), { RC_USERDATA: '/opfs/' + netSaves(session) });
      m.ENV.RC_LOG_FPS = params.has('fps') ? '1' : '';
      if (!params.has('fps')) delete m.ENV.RC_LOG_FPS;
    }],
  });
  const canvas = $('canvas');
  M._rc_gpu_init(canvas.width, canvas.height);
  new ResizeObserver(() => { sizeCanvas(); M._rc_set_canvas_size(canvas.width, canvas.height); }).observe(canvas);
  hookInput(M, !!session);
  if (session) { session.client.attach(M); showNetStatus(M, session); }
  startAudio(M).catch((e) => console.warn('audio unavailable:', e));
  const poll = session ? pollLocalPad : pollGamepads;
  // Online, present at most 60 times a second: every Present is a lockstep frame, and the input delay and
  // the time a frame has to simulate are counted in those (netplay.js: autoDelay), so following a 120 Hz
  // display would halve both. Solo play follows the display. A frame is due every 1/60 s, with a little
  // tolerance so a 60 Hz display's own jitter doesn't skip one.
  let due = 0;
  const frame = (t) => {
    poll(M);
    if (!session || t >= due - 4) {
      if (M._rc_gpu_pump(1)) {
        due = Math.max(due + 1000 / 60, t - 4);
        if (!firstFrame) { firstFrame = true; if (!directorText) bar.done(); }   // the game is drawing: the bar goes
      }
    } else M._rc_gpu_pump(0);   // mid-frame readbacks only
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  if (!session && !directorText) skipTitle(M);   // the Director's own autopilot drives the menus
  if (params.get('director_live')) followDirector(M, params.get('director_live'), directorText);
  if (directorText) directorLoading(M, bar);
  // broadcast graphics (director/broadcast.js) need the live match's timeline for the names
  if (params.get('director_live') && window.RcBroadcast) RcBroadcast.start(M, params.get('director_live'), directorState);
  if (params.get('director_live') && window.RcCommentary) RcCommentary.start(M, params.get('director_live'), directorState);
  window.rcModule = M;   // the live page (web/director/live.html) reads the game's score from here
  // readbacks mid-frame are answered without waiting for vsync; online, the pad is also sampled here
  setInterval(() => { if (session) poll(M); M._rc_gpu_pump(0); }, 1);
  // Online, a hidden tab still has to present frames (browsers pause requestAnimationFrame there), or the
  // lockstep would freeze every other player with it.
  if (session) setInterval(() => { if (document.hidden) { poll(M); M._rc_gpu_pump(1); } }, 16);
  canvas.focus();
  window.recomp = M;
}

async function boot() {
  if (!crossOriginIsolated) { status('This page needs cross-origin isolation (COOP/COEP headers; see web/serve.py).'); return; }
  if (!navigator.gpu) { status('This browser has no WebGPU. Use a current Chrome, Edge or Safari.'); return; }
  // navigator.gpu can exist with no usable adapter (GPU or driver blocklisted, hardware acceleration off,
  // Remote Desktop / VM): say so instead of starting a game that can only show a black screen
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null) ||
    await navigator.gpu.requestAdapter().catch(() => null) ||
    await navigator.gpu.requestAdapter({ forceFallbackAdapter: true }).catch(() => null);
  if (!adapter) {
    const firefox = /Firefox\//.test(navigator.userAgent);
    status('WebGPU is switched on in this browser but it found no usable graphics adapter. ' +
      (firefox ? 'Firefox only enables WebGPU for some GPUs and drivers (see about:support, "WebGPU"); Chrome or Edge usually work. '
        : 'Check that hardware acceleration is on in the browser settings and the graphics driver is up to date. ') +
      'Remote Desktop and virtual machines often have no GPU for the browser.');
    return;
  }
  if (adapter.isFallbackAdapter || adapter.info?.isFallbackAdapter)
    console.warn('WebGPU: only a software (fallback) adapter is available; the game will be slow');
  if (!navigator.storage?.getDirectory) { status('This browser has no Origin Private File System.'); return; }
  const ready = () => {
    show('home');
    // Director pages (?director=, ?director_live=) go straight to the match
    if (params.has('autoplay') || params.has('director') || params.has('director_live')) $('play').click();
  };
  $('play').onclick = () => run().catch(fail);
  for (const b of document.querySelectorAll('[data-go]')) b.onclick = () => show(b.dataset.go);
  $('folder').onchange = async (e) => {
    $('pick').classList.add('hidden');
    try { await importFromPicker(e.target.files); ready(); }
    catch (err) { status(err.message); $('pick').classList.remove('hidden'); }
  };
  const showPicker = (msg) => {
    status(msg);
    $('pick').classList.remove('hidden');
    $('help').classList.remove('hidden');
  };

  $('reset').onclick = (e) => { e.preventDefault(); show('loading'); showPicker('Choose your the base game folder.'); };
  try {
    if (await syncFromServer()) { ready(); return; }
  } catch (err) { status(err.message); return; }
  if (!(await readMarker())) {
    showPicker('Choose your the base game folder to start.');
    return;
  }
  ready();
}

// ------------------------------------------------------------------ fullscreen

// The stage (game + overlays) goes fullscreen; the canvas grows with it and the game letterboxes its 4:3
// picture inside. Alt+Enter (Option+Enter on a Mac) toggles it, as in PC games of the time; it is caught
// before the game's own key handling so Enter doesn't also reach a menu.
function setupFullscreen() {
  const stage = $('stage');
  const active = () => document.fullscreenElement || document.webkitFullscreenElement;
  const toggle = () => {
    if (active()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (stage.requestFullscreen || stage.webkitRequestFullscreen).call(stage)?.catch?.(() => {});
    $('canvas').focus();
  };
  if (!stage.requestFullscreen && !stage.webkitRequestFullscreen) { $('fs').classList.add('hidden'); return; }
  $('fs').onclick = toggle;
  const swallow = (e) => {
    if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    if (!e.altKey) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'keydown' && !e.repeat) toggle();
  };
  window.addEventListener('keydown', swallow, true);
  window.addEventListener('keyup', swallow, true);
  const sync = () => {
    $('fs-icon').setAttribute('d', active() ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5');
    $('fs').title = active() ? 'Exit fullscreen (Alt+Enter or Esc)' : 'Fullscreen (Alt+Enter)';
  };
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('webkitfullscreenchange', sync);
  // the button shows while the mouse moves over the stage and fades after a few still seconds
  let idle;
  const wake = () => { stage.classList.add('awake'); clearTimeout(idle); idle = setTimeout(() => stage.classList.remove('awake'), 2500); };
  stage.addEventListener('mousemove', wake);
  stage.addEventListener('mouseleave', () => stage.classList.remove('awake'));
  wake();
}

// once the game starts: a short hint, so players learn the shortcut
function fullscreenTip() {
  const tip = $('fstip');
  if (document.fullscreenElement || document.webkitFullscreenElement || $('fs').classList.contains('hidden')) return;
  tip.classList.remove('hidden');
  tip.style.opacity = '1';
  setTimeout(() => { tip.style.opacity = '0'; }, 5000);
  setTimeout(() => tip.classList.add('hidden'), 5500);
}

// ------------------------------------------------------------------ online lobby

async function buildVersion() {
  // peers must run the same build and game files, or their simulations diverge
  const marker = await readMarker();
  const wasm = await fetch('build/recomp.wasm', { method: 'HEAD' }).catch(() => null);
  // the ETag comes back weak (W/"...") when the response is compressed: compare only its value
  const etag = (wasm?.headers.get('ETag') || '').replace(/^W\//, '').replace(/"/g, '');
  return `${marker?.version || 'local'}:${etag || wasm?.headers.get('Content-Length') || '?'}`;
}

function setupOnline() {
  const msg = (t) => { $('np-msg').textContent = t; $('np-lobbymsg').textContent = t; };
  try {
    $('np-name').value = localStorage.getItem('rc-name') || '';
    const region = localStorage.getItem('rc-region');
    if ([...$('np-region').options].some((o) => o.value === region)) $('np-region').value = region;
  } catch { /* storage blocked */ }
  if (params.get('join')) $('np-code').value = params.get('join').toUpperCase();
  let client = null;
  let lastPlayers = [];

  // create: the host's first connection, which places the room in `region` (the Worker's location hint)
  async function enter(code, create) {
    if (client) return;
    const name = $('np-name').value.trim() || 'Player';
    try { localStorage.setItem('rc-name', name); localStorage.setItem('rc-region', $('np-region').value); } catch { /* storage blocked */ }
    msg('Connecting…');
    let iceServers;   // from the first ticket (TURN credentials last a day)
    const roomUrl = async () => {   // a fresh ticket each time (they expire after an hour)
      const res = await fetch(NETPLAY_BASE + '_netplay_ticket', { cache: 'no-store' });
      if (!res.ok) throw new Error('Online play is not available on this server.');
      const { ticket, iceServers: ice } = await res.json();
      iceServers ??= ice;
      const url = new URL(`netplay/${code}?ticket=${encodeURIComponent(ticket)}`, NETPLAY_BASE);
      if (create) { url.searchParams.set('create', '1'); url.searchParams.set('region', $('np-region').value); create = false; }
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      return url.href;
    };
    let url;
    try { url = await roomUrl(); } catch (e) { msg(e.message); return; }
    const invite = new URL(location.href);
    invite.search = `?join=${code}` + (params.get('netplay') ? `&netplay=${encodeURIComponent(params.get('netplay'))}` : '');
    $('np-room').textContent = code;
    $('invite').textContent = invite.href;
    const version = await buildVersion();
    let session = null;
    const left = new Set();
    const me = client = RcNetplay.connect({
      url, name, version, reconnectUrl: roomUrl, iceServers, relayOnly: params.get('turn') === 'only',
      onReconnect(state) { if (session) session.reconnecting = state === 'connecting'; },
      onLobby(l) {
        if (client !== me) return;   // a room this page already left
        if (l.started) { msg('That game has already started.'); leave(); return; }
        if ($('view-lobby').classList.contains('hidden')) { msg(''); show('lobby'); }
        $('np-colo').textContent = l.colo ? `Server in ${l.colo}` : '';
        $('np-players').innerHTML = '';
        const mine = l.players.find((p) => p.slot === l.you);
        const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
        for (const p of l.players) {
          const li = el('li');
          const direct = p.slot === l.you ? 0 : Math.max(mine?.p2p?.[p.slot] || 0, p.p2p?.[l.you] || 0);
          const link = p.slot === l.you ? (p.rtt ? `${p.rtt} ms to the room` : 'Connected')
            : direct ? `Direct connection · ${direct} ms` : 'Connected through the room';
          const who = el('div', 'who');
          who.append(el('b', null, p.name), el('small', null, link));
          li.append(el('div', 'avatar', (p.name || '?').trim().charAt(0).toUpperCase() || '?'), who);
          if (p.slot === 0) li.append(el('span', 'tag', 'Host'));
          if (p.slot === l.you) li.append(el('span', 'tag', 'You'));
          $('np-players').appendChild(li);
        }
        if (l.players.length < 2) {
          const li = el('li', 'empty');
          li.append(el('div', 'avatar', '?'), el('div', 'who', 'Waiting for your friend to join…'));
          $('np-players').appendChild(li);
        }
        $('np-hostctl').classList.toggle('hidden', !l.host);
        $('np-start').disabled = l.players.length !== 2;
        if (l.players.length > 2) msg('This is a 1v1 game: only two players can be in the room.');
        lastPlayers = l.players;
        const auto = RcNetplay.autoDelay(l.players);
        $('np-delay').options[0].textContent = `Auto (${auto} frames, ${Math.round(auto * 1000 / 60)} ms)`;
        $('np-wait').classList.toggle('hidden', l.host);
      },
      onStart(s) {
        session = { ...s, client, left };
        run(session).catch(fail);
      },
      onLeft(slot) { left.add(slot); },
      onError(e) { msg(e); setTimeout(() => { if ($('np-msg').textContent === e) msg(''); }, 8000); },
      onClose() { if (!session && client === me) { client = null; show('online'); msg('Disconnected from the room.'); } },
    });
  }
  function leave() {
    const c = client;
    client = null;
    c?.close();
    show('online');
  }
  $('np-leave').onclick = () => { leave(); msg(''); };
  $('np-copy').onclick = async () => {
    const b = $('np-copy');
    try { await navigator.clipboard.writeText($('invite').textContent); b.textContent = 'Link copied'; }
    catch { b.textContent = 'Copy failed: share the code instead'; }
    setTimeout(() => { b.textContent = 'Copy invite link'; }, 2000);
  };

  const code5 = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  $('np-host').onclick = () => enter(code5(), true).catch((e) => msg(e.message));
  $('np-join').onclick = () => {
    const code = $('np-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(code)) { msg('Enter the room code from the host.'); return; }
    enter(code).catch((e) => msg(e.message));
  };
  $('np-start').onclick = () => {
    const v = $('np-delay').value;
    client?.start(v === 'auto' ? RcNetplay.autoDelay(lastPlayers) : Number(v));
  };
}

// Keyboard cheat sheet beside the stage: in-game prompts use controller glyphs (triangle/circle/×/square,
// L1, R1), so keyboard players need a reference. The CSS (index.html) reserves the panel's space on
// viewports wide enough and shrinks the stage to match; the body's .kbd-off class (set when the player
// dismisses the panel, remembered in localStorage) hides the panel and lets the stage reclaim the space.
function setupKbdHelp() {
  const off = () => { try { return localStorage.getItem('rc-kbd') === 'hide'; } catch { return false; } };
  const save = (v) => { try { localStorage.setItem('rc-kbd', v); } catch { /* storage blocked */ } };
  const apply = () => document.body.classList.toggle('kbd-off', off());
  $('kbd-close').onclick = () => { save('hide'); apply(); };
  $('kbd-show').onclick = () => { save('show'); apply(); };
  apply();
}

setupFullscreen();
setupKbdHelp();
boot();
