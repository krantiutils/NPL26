// Engine adapter: the only thing the Director UI knows about the game.
//
//   setupMatch(header)        -> Promise   configure teams/venue/conditions and get to the first ball
//   playEvent(event, ctx)     -> Promise   play one timeline event to completion; resolves {ok, ms}
//                                          ctx = {innings, index, state} (state = replay situation after it)
//   onState(cb)               -> unsubscribe   cb({engine, phase, event, progress, message})
//   setSpeed(x)               global playback multiplier (multiplies event.timing.playback_speed)
//   stop()                    abort the event in progress (its promise resolves {ok:false, aborted:true})
//
// The real implementation will drive the WASM build (web/loader.js) once the engine hooks exist. Until then
// StubEngine simulates believable durations and logs, so the UI is fully usable. A real engine can be injected
// by setting globalThis.directorEngine before director.js loads.

const PHASES = {
  delivery: [["run_up", 2.4], ["release", 0.8], ["shot", 0.6], ["fielding", 1.6], ["result", 1.4]],
  default: [["cutscene", 2]],
};

export class StubEngine {
  constructor() {
    this.name = "stub";
    this.listeners = new Set();
    this.speed = 1;
    this.abort = null;
  }
  onState(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit(s) {
    for (const cb of this.listeners) {
      try { cb({ engine: this.name, ...s }); } catch (err) { console.error("onState listener failed", err); }
    }
  }
  setSpeed(x) {
    if (!(x > 0)) throw new RangeError(`speed must be > 0, got ${x}`);
    this.speed = x;
  }
  stop() {
    this.abort?.();
  }
  async setupMatch(header) {
    if (!header?.teams?.length) throw new Error("setupMatch: header.teams missing");
    const [a, b] = header.teams;
    this.emit({ phase: "setup", progress: 0, message: `setup ${a.name} v ${b.name} at ${header.venue?.name} (${header.overs} overs, ${header.time_of_day ?? "day"}, ${header.weather ?? "?"})` });
    await this.wait(900);
    this.emit({ phase: "ready", progress: 1, message: `toss: ${header.toss.winner} chose to ${header.toss.decision}` });
  }

  // Seconds of game time the event would take at 1x.
  plan(e) {
    const steps = (PHASES[e.type] || PHASES.default).map(([p, s]) => [p, s]);
    const pres = e.presentation || {};
    if (e.type === "delivery") {
      const r = e.result || {};
      if (r.boundary) steps.push(["boundary", 2]);
      if (r.wicket) steps.push(["wicket", 3]);
      if (e.review) steps.push(["review", Math.min((e.review.duration_s ?? 40) * 0.15, 9)]);
    } else {
      const d = e.duration_s ?? e.treatment_s ?? 0;
      if (d) steps[0][1] = Math.min(Math.max(d * 0.04, 1.5), 6);
    }
    if (pres.cutscene && e.type === "delivery") steps.push([`cutscene:${pres.cutscene}`, 2.5]);
    for (const rp of pres.replays || []) steps.push([`replay:${rp.camera}`, Math.min(3 / (rp.speed || 1), 9)]);
    const gap = e.timing?.gap_before_s ?? 0;
    if (gap) steps.unshift(["gap", gap]);
    return steps;
  }

  async playEvent(e, ctx = {}) {
    const steps = this.plan(e);
    const rate = this.speed * (e.timing?.playback_speed ?? 1);
    const total = steps.reduce((s, [, t]) => s + t, 0);
    let done = 0;
    const started = performance.now();
    this.emit({ phase: "start", event: e, progress: 0, message: describe(e) });
    for (const [phase, secs] of steps) {
      this.emit({ phase, event: e, progress: done / total, message: phase });
      const ok = await this.wait((secs * 1000) / rate);
      if (!ok) {
        this.emit({ phase: "aborted", event: e, progress: done / total, message: "stopped" });
        return { ok: false, aborted: true, ms: performance.now() - started };
      }
      done += secs;
    }
    this.emit({ phase: "done", event: e, progress: 1, message: ctx.state ? `${ctx.state.score.runs}/${ctx.state.score.wickets} (${ctx.state.score.overs})` : "done" });
    return { ok: true, ms: performance.now() - started };
  }

  wait(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.abort = null; resolve(true); }, ms);
      this.abort = () => { clearTimeout(t); this.abort = null; resolve(false); };
    });
  }
}

export function describe(e) {
  if (e.type !== "delivery") return `${e.type}${e.kind ? " " + e.kind : ""}${e.team ? " " + e.team : ""}`;
  const r = e.result || {}, d = e.delivery || {}, s = e.shot || {};
  const ex = Object.entries(r.extras || {}).filter(([, v]) => v).map(([k, v]) => `${v}${k}`).join(" ");
  return `${e.over}.${e.ball} ${e.bowler} to ${e.batter}: ${d.type} ${d.pace_kph}kph ${d.line}/${d.length}` +
    ` -> ${s.type ?? "-"}${s.edge && s.edge !== "none" ? ` (${s.edge} edge)` : ""}` +
    ` = ${r.runs_bat}${ex ? " +" + ex : ""}${r.boundary ? ` [${r.boundary}]` : ""}${r.wicket ? ` WICKET ${r.wicket.kind} ${r.wicket.batter_out}` : ""}`;
}

export function createEngine() {
  return globalThis.directorEngine ?? new StubEngine();
}
