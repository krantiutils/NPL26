// Director timeline rules: JSON-Schema subset validator + cricket replay (scorecard + consistency checks).
// DOM-free so node can run it. Port of director/tools/validate.py: keep the two in sync; the drift test is
// director/tools/test_rules_parity.py (runs both on mutated timelines and compares where errors land).

const KNOWN_KEYWORDS = new Set([
  "$schema", "$id", "$defs", "$ref", "$comment", "title", "description", "default", "examples",
  "type", "properties", "required", "additionalProperties", "enum", "const", "items", "minItems", "maxItems",
  "uniqueItems", "minimum", "maximum", "exclusiveMinimum", "pattern", "minLength", "oneOf", "anyOf",
]);
const isNum = (v) => typeof v === "number";
const TYPE_CHECKS = {
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
  array: Array.isArray,
  string: (v) => typeof v === "string",
  integer: (v) => Number.isInteger(v),
  number: isNum,
  boolean: (v) => typeof v === "boolean",
  null: (v) => v === null,
};
const j = (v) => (JSON.stringify(v) ?? "undefined").slice(0, 60);

export class SchemaValidator {
  constructor(schema) {
    this.root = schema;
    this.checkKeywords(schema, "#");
  }
  checkKeywords(node, where) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const unknown = Object.keys(node).filter((k) => !KNOWN_KEYWORDS.has(k));
    if (unknown.length) throw new Error(`${where}: unsupported schema keyword(s) ${unknown}`);
    for (const key of ["properties", "$defs"])
      for (const [n, sub] of Object.entries(node[key] || {})) this.checkKeywords(sub, `${where}/${key}/${n}`);
    for (const key of ["items", "additionalProperties"])
      if (node[key] && typeof node[key] === "object") this.checkKeywords(node[key], `${where}/${key}`);
    for (const key of ["oneOf", "anyOf"]) (node[key] || []).forEach((s, i) => this.checkKeywords(s, `${where}/${key}/${i}`));
  }
  resolve(ref) {
    if (!ref.startsWith("#/")) throw new Error(`only local $ref supported: ${ref}`);
    return ref.slice(2).split("/").reduce((n, p) => n[p], this.root);
  }
  validate(inst) {
    const errs = [];
    this.v(inst, this.root, "$", errs);
    return errs;
  }
  v(inst, s, path, errs) {
    if (s.$ref) this.v(inst, this.resolve(s.$ref), path, errs);
    if (s.type) {
      const types = [].concat(s.type);
      if (!types.some((t) => TYPE_CHECKS[t](inst))) {
        errs.push(`${path}: expected ${types.join("/")}, got ${j(inst)}`);
        return;
      }
    }
    if ("const" in s && inst !== s.const) errs.push(`${path}: must be ${JSON.stringify(s.const)}`);
    if (s.enum && !s.enum.includes(inst)) errs.push(`${path}: ${j(inst)} not one of ${JSON.stringify(s.enum)}`);
    if (typeof inst === "string") {
      if (s.minLength != null && inst.length < s.minLength) errs.push(`${path}: shorter than ${s.minLength}`);
      if (s.pattern && !new RegExp(s.pattern, "u").test(inst)) errs.push(`${path}: '${inst}' does not match ${s.pattern}`);
    }
    if (isNum(inst)) {
      if (s.minimum != null && inst < s.minimum) errs.push(`${path}: ${inst} < minimum ${s.minimum}`);
      if (s.maximum != null && inst > s.maximum) errs.push(`${path}: ${inst} > maximum ${s.maximum}`);
      if (s.exclusiveMinimum != null && inst <= s.exclusiveMinimum) errs.push(`${path}: ${inst} <= ${s.exclusiveMinimum}`);
    }
    if (Array.isArray(inst)) {
      if (s.minItems != null && inst.length < s.minItems) errs.push(`${path}: fewer than ${s.minItems} items`);
      if (s.maxItems != null && inst.length > s.maxItems) errs.push(`${path}: more than ${s.maxItems} items`);
      if (s.uniqueItems) {
        const seen = inst.map((x) => JSON.stringify(x));
        const dup = seen.filter((x, i) => seen.indexOf(x) !== i);
        if (dup.length) errs.push(`${path}: duplicate items ${dup}`);
      }
      if (s.items) inst.forEach((x, i) => this.v(x, s.items, `${path}[${i}]`, errs));
    }
    if (TYPE_CHECKS.object(inst)) {
      for (const k of s.required || []) if (!(k in inst)) errs.push(`${path}: missing required '${k}'`);
      const props = s.properties || {};
      for (const [k, val] of Object.entries(inst)) {
        if (k in props) this.v(val, props[k], `${path}.${k}`, errs);
        else if (s.additionalProperties === false) errs.push(`${path}: unknown property '${k}'`);
        else if (s.additionalProperties && typeof s.additionalProperties === "object")
          this.v(val, s.additionalProperties, `${path}.${k}`, errs);
      }
    }
    if (s.anyOf && !s.anyOf.some((b) => this.sub(inst, b, path).length === 0))
      errs.push(`${path}: matches none of the allowed forms`);
    if (s.oneOf) this.oneOf(inst, s.oneOf, path, errs);
  }
  sub(inst, s, path) {
    const e = [];
    this.v(inst, s, path, e);
    return e;
  }
  // Discriminated on "type" when every branch has a const type.
  branchFor(branches, inst) {
    const resolved = branches.map((b) => (b.$ref ? this.resolve(b.$ref) : b));
    const consts = resolved.map((b) => b.properties?.type?.const);
    if (!consts.every(Boolean) || !TYPE_CHECKS.object(inst)) return { consts: null };
    return { consts, branch: resolved[consts.indexOf(inst.type)] };
  }
  oneOf(inst, branches, path, errs) {
    const { consts, branch } = this.branchFor(branches, inst);
    if (consts) {
      if (!branch) errs.push(`${path}.type: '${inst.type}' not one of ${JSON.stringify(consts)}`);
      else this.v(inst, branch, path, errs);
      return;
    }
    const ok = branches.filter((b) => this.sub(inst, b, path).length === 0);
    if (ok.length !== 1) errs.push(`${path}: must match exactly one form, matched ${ok.length}`);
  }
}

// ------------------------------------------------------------------------------------------------- replay

const CREDIT_BOWLER = new Set(["bowled", "caught", "caught_and_bowled", "lbw", "stumped", "hit_wicket"]);
const ON_NO_BALL_OR_FREE_HIT = new Set(["run_out", "obstructing_the_field", "retired_hurt", "retired_out"]);
const ON_WIDE = new Set(["stumped", "run_out", "hit_wicket", "obstructing_the_field", "retired_hurt", "retired_out"]);
const NON_STRIKER_KINDS = new Set(["run_out", "obstructing_the_field", "retired_hurt", "retired_out"]);
const MILESTONE_MIN = { batter_fifty: 50, batter_hundred: 100, team_fifty: 50, team_hundred: 100, team_150: 150,
  team_200: 200, bowler_three_wickets: 3, bowler_five_wickets: 5 };

export const oversStr = (legal) => `${Math.floor(legal / 6)}.${legal % 6}`;
export const posXY = (positions, name) => {
  const [a, d] = positions[name];
  return [d * Math.sin((a * Math.PI) / 180), d * Math.cos((a * Math.PI) / 180)];
};
export const inCircle = (x, y, r) => Math.hypot(x, y - Math.min(Math.max(y, 0), 20.12)) <= r;

export function describeOut(wk, bowler) {
  const f = wk.fielders || [];
  return ({
    bowled: `b ${bowler}`, lbw: `lbw b ${bowler}`, hit_wicket: `hit wicket b ${bowler}`,
    caught: `c ${f[0] ?? "?"} b ${bowler}`, caught_and_bowled: `c & b ${bowler}`,
    stumped: `st ${f[0] ?? "?"} b ${bowler}`, run_out: `run out (${f.join(" / ") || "?"})`,
  })[wk.kind] ?? wk.kind.replaceAll("_", " ");
}

class Innings {
  constructor(number, bat, bowl, overs, target) {
    Object.assign(this, { number, bat, bowl, overs, target });
    this.runs = this.wkts = this.legal = 0;
    this.extras = { wides: 0, no_balls: 0, byes: 0, leg_byes: 0, penalty: 0 };
    this.batters = new Map();
    this.bowlers = new Map();
    this.striker = this.non = null;
    this.started = this.pendingNew = false;
    this.retired = new Set();
    this.overBowler = this.lastOverBowler = null;
    this.overRuns = this.overConceded = this.overWkts = 0;
    this.completedOver = null;
    this.freeHit = false;
    this.closed = null;
    this.reviewsLost = {};
    this.timeouts = {};
    this.maxOutside = 2;
    this.endParity = null;
    this.fow = [];
    this.field = null;
    this.snapshotDrift = 0; // score snapshots that disagree; only the first is an error
  }
  batter(n) {
    if (!this.batters.has(n)) this.batters.set(n, { runs: 0, balls: 0, fours: 0, sixes: 0, out: null });
    return this.batters.get(n);
  }
  bowler(n) {
    if (!this.bowlers.has(n)) this.bowlers.set(n, { balls: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, no_balls: 0 });
    return this.bowlers.get(n);
  }
  score() {
    return { runs: this.runs, wickets: this.wkts, overs: oversStr(this.legal) };
  }
}

const sameScore = (a, b) => a.runs === b.runs && a.wickets === b.wickets && a.overs === b.overs;

// Replays a schema-valid timeline. Returns {errors, warnings, innings, result, states}; states[i][k] is the
// situation after event k of innings i (for the UI: score, batters, bowler, effective field, issues).
export function replay(doc, vocab) {
  const errors = [], warnings = [];
  const h = doc.header;
  const teams = Object.fromEntries(h.teams.map((t) => [t.name, t]));
  const active = Object.fromEntries(h.teams.map((t) => [t.name, new Set(t.xi)]));
  const squad = Object.fromEntries(h.teams.map((t) => [t.name, new Set(t.players.map((p) => p.name))]));
  const style = Object.fromEntries(h.teams.flatMap((t) => t.players.map((p) => [p.name, p.bowls ?? null])));
  const maxOvers = Math.ceil(h.overs / 5);
  const nReviews = h.reviews_per_innings ?? 2;
  const powerplay = h.powerplay_overs ?? 6;
  const innings = [], states = [];
  let result = null;
  let issues = null; // issues of the event being processed
  const err = (w, m) => { errors.push(`${w}: ${m}`); issues?.push({ level: "error", msg: m }); };
  const warn = (w, m) => { warnings.push(`${w}: ${m}`); issues?.push({ level: "warning", msg: m }); };
  const playerIn = (team, name, w, what, useSquad = false) => {
    const pool = useSquad ? squad[team] : active[team];
    if (!pool.has(name)) {
      err(w, `${what} '${name}' is not ${useSquad ? "in the squad" : "playing"} for ${team}`);
      return false;
    }
    return true;
  };

  // header
  {
    const w = "header";
    if (Object.keys(teams).length !== 2) err(w, "the two teams need different names");
    if (!teams[h.toss.winner]) err(w, `toss winner '${h.toss.winner}' is not a team`);
    if (new Set(h.venue.ends).size !== 2) err(w, "venue.ends must name two different ends");
    for (const t of h.teams) {
      const tw = `${w} team ${t.name}`;
      const names = t.players.map((p) => p.name);
      names.filter((n, i) => names.indexOf(n) !== i).forEach((n) => err(tw, `player '${n}' listed more than once`));
      for (const n of [...t.xi, ...(t.bench || [])]) if (!names.includes(n)) err(tw, `'${n}' in xi/bench but not in players`);
      if (t.xi.some((n) => (t.bench || []).includes(n))) err(tw, "a player is both in the XI and on the bench");
      for (const role of ["captain", "wicket_keeper"]) if (!t.xi.includes(t[role])) err(tw, `${role} '${t[role]}' not in the XI`);
      const bowlers = t.xi.filter((n) => style[n]);
      if (bowlers.length * maxOvers < h.overs) warn(tw, `only ${bowlers.length} bowlers in the XI cannot bowl ${h.overs} overs`);
    }
  }
  const ids = new Map();
  for (const inn of doc.innings) for (const e of inn.events) if (e.id) ids.set(e.id, (ids.get(e.id) || 0) + 1);
  for (const [i, n] of ids) if (n > 1) err("ids", `id '${i}' used ${n} times`);

  const snapshot = (inn, w, msg) => {
    if (++inn.snapshotDrift === 1) err(w, `${msg} (later score snapshots in this innings are not reported separately)`);
  };
  const checkClose = (inn) => {
    if (inn.target != null && inn.runs >= inn.target) inn.closed = "target reached";
    else if (inn.wkts >= active[inn.bat].size - 1) inn.closed = "all out";
    else if (inn.legal >= inn.overs * 6) inn.closed = "overs complete";
  };

  const handlers = {
    delivery(inn, e, w) {
      const res = e.result, ex = res.extras || {};
      const wd = ex.wides || 0, nb = ex.no_balls || 0, b = ex.byes || 0, lb = ex.leg_byes || 0, pen = ex.penalty || 0;
      const rb = res.runs_bat, boundary = res.boundary ?? null, wk = res.wicket;
      const legal = !wd && !nb;
      inn.completedOver = null;
      if (inn.closed) return err(w, `delivery after the innings closed (${inn.closed})`);
      const expOver = Math.floor(inn.legal / 6), expBall = (inn.legal % 6) + 1;
      if (e.over !== expOver || e.ball !== expBall) err(w, `ball ${e.over}.${e.ball} but the score says this is ${expOver}.${expBall}`);
      const expId = `i${inn.number}-${e.over}.${e.ball}`;
      if (e.id && !e.id.startsWith(expId)) warn(w, `id '${e.id}' does not follow the convention ${expId}[x<n>]`);

      const bowler = e.bowler, striker = e.batter, non = e.non_striker;
      playerIn(inn.bowl, bowler, w, "bowler");
      playerIn(inn.bat, striker, w, "batter");
      playerIn(inn.bat, non, w, "non_striker");
      if (striker === non) err(w, "batter and non_striker are the same player");
      for (const n of [striker, non]) {
        const out = inn.batters.get(n)?.out;
        if (out && out !== "retired hurt") err(w, `${n} is already out (${out})`);
      }
      if (!inn.started) {
        inn.started = true;
        inn.striker = striker; inn.non = non;
        inn.batter(striker); inn.batter(non);
      } else if (inn.pendingNew) {
        const stay = [inn.striker, inn.non].filter(Boolean);
        const pair = new Set([striker, non]);
        if (!stay.every((n) => pair.has(n))) err(w, `after the wicket ${stay[0] ?? "?"} should still be batting, got ${striker} & ${non}`);
        for (const n of pair) {
          if (stay.includes(n)) continue;
          if (inn.batters.has(n) && !inn.retired.has(n)) err(w, `${n} has already batted`);
          inn.retired.delete(n);
          inn.batter(n).out = null;
        }
        inn.striker = striker; inn.non = non; inn.pendingNew = false;
      } else if (striker !== inn.striker || non !== inn.non) {
        err(w, `expected ${inn.striker} on strike and ${inn.non} at the other end, got ${striker} / ${non}`);
        inn.striker = striker; inn.non = non;
      }

      if (inn.overBowler == null) {
        if (bowler === inn.lastOverBowler) err(w, `${bowler} bowled the previous over too`);
        if (inn.bowler(bowler).balls >= maxOvers * 6) err(w, `${bowler} has already bowled the maximum ${maxOvers} overs`);
        inn.overBowler = bowler;
        inn.overRuns = inn.overConceded = inn.overWkts = 0;
        const end = e.bowling_end;
        if (end) {
          const k = h.venue.ends.indexOf(end);
          if (k < 0) err(w, `bowling_end '${end}' not one of venue.ends`);
          else {
            const parity = (k + expOver) % 2;
            if (inn.endParity == null) inn.endParity = parity;
            else if (parity !== inn.endParity) warn(w, `over ${expOver} bowled from ${end}: ends should alternate each over`);
          }
        }
      } else if (bowler !== inn.overBowler) err(w, `${bowler} bowls during ${inn.overBowler}'s over (use a bowler_change event)`);
      const st = style[bowler];
      if (st == null) warn(w, `${bowler} has no bowling style in the header`);
      else if (!vocab.bowling_styles[st].deliveries.includes(e.delivery.type)) warn(w, `${e.delivery.type} is not a ${st} delivery`);

      if (wd && (nb || rb || b || lb)) err(w, "a wide cannot also have no-ball, bat runs, byes or leg-byes (put them in wides)");
      if (b && lb) err(w, "byes and leg-byes on the same ball");
      if (rb && (b || lb)) err(w, "runs off the bat and byes/leg-byes on the same ball");
      if (nb && !res.no_ball_reason) warn(w, "no-ball without no_ball_reason");
      if (boundary === 6 && rb !== 6) err(w, "a six must be runs_bat 6");
      if (boundary === 4 && ![rb, b, lb, wd ? wd - 1 : -1].includes(4)) err(w, "boundary 4 but no component scored 4 (runs_bat, byes, leg_byes or wides=5)");
      const run = e.running || {};
      if (boundary == null && (rb === 4 || rb === 6) && !run.runs && !run.overthrows)
        warn(w, `runs_bat ${rb} without boundary set and without running.runs: all-run ${rb}?`);
      const total = rb + wd + nb + b + lb + pen;

      if (res.free_hit != null && res.free_hit !== inn.freeHit) err(w, `free_hit is ${res.free_hit} but should be ${inn.freeHit}`);
      if (wk) {
        const { kind, batter_out: out } = wk;
        if (out !== striker && out !== non) err(w, `batter_out '${out}' is not at the crease`);
        else if (out === non && !NON_STRIKER_KINDS.has(kind)) err(w, `the non-striker cannot be out ${kind}`);
        if ((nb || inn.freeHit) && !ON_NO_BALL_OR_FREE_HIT.has(kind)) err(w, `cannot be out ${kind} off a ${nb ? "no-ball" : "free hit"}`);
        if (wd && !ON_WIDE.has(kind)) err(w, `cannot be out ${kind} off a wide`);
        const fielders = wk.fielders || [];
        for (const f of fielders) playerIn(inn.bowl, f, w, "fielder", true);
        if (kind === "caught" && !fielders.length) err(w, "caught needs the catcher in wicket.fielders");
        if (kind === "caught_and_bowled" && !(fielders.length === 0 || (fielders.length === 1 && fielders[0] === bowler)))
          err(w, "caught_and_bowled: fielders must be empty or the bowler");
        if (kind === "stumped" && !(fielders.length === 1 && fielders[0] === teams[inn.bowl].wicket_keeper))
          warn(w, `stumped by ${fielders}, header wicket-keeper is ${teams[inn.bowl].wicket_keeper}`);
        if (kind === "run_out" && !fielders.length) warn(w, "run out without fielders");
      }
      for (const f of e.fielding || []) playerIn(inn.bowl, f.player, w, "fielder", true);
      const ro = run.run_out_attempt;
      if (ro && ro.out && !(wk && wk.kind === "run_out" && wk.batter_out === ro.batter))
        err(w, "run_out_attempt.out is true but the result has no matching run-out wicket");
      if (wk && wk.kind === "run_out" && ro && !ro.out) err(w, "run-out wicket but run_out_attempt.out is false");
      checkReview(inn, e, w, wk);
      const sh = e.shot;
      if (sh?.animation && sh.type !== "none" && !(vocab.shots[sh.type] || []).some((a) => a.animation === sh.animation))
        warn(w, `animation ${sh.animation} is not a ${sh.type} animation`);
      checkField(inn, e, w);

      inn.runs += total;
      Object.entries({ wides: wd, no_balls: nb, byes: b, leg_byes: lb, penalty: pen }).forEach(([k, v]) => (inn.extras[k] += v));
      const bs = inn.batter(striker);
      bs.runs += rb;
      bs.balls += wd ? 0 : 1;
      if (boundary === 4 && rb === 4) bs.fours++;
      if (boundary === 6) bs.sixes++;
      const bw = inn.bowler(bowler);
      const conceded = rb + wd + nb;
      bw.runs += conceded;
      bw.balls += legal ? 1 : 0;
      bw.wides += wd ? 1 : 0;
      bw.no_balls += nb;
      inn.overRuns += total;
      inn.overConceded += conceded;

      const derived = boundary ? 0 : rb + b + lb + Math.max(wd - 1, 0);
      const completed = run.runs ?? derived;
      if (run.runs != null && !boundary && !run.overthrows && run.runs !== derived)
        err(w, `running.runs ${run.runs} but the scored runs mean ${derived} were run`);
      if (completed % 2) [inn.striker, inn.non] = [inn.non, inn.striker];

      if (wk) {
        const { kind, batter_out: out } = wk;
        if (kind !== "retired_hurt") {
          inn.wkts++;
          inn.overWkts++;
          inn.fow.push({ wicket: inn.wkts, runs: inn.runs, overs: oversStr(inn.legal + (legal ? 1 : 0)), batter: out });
          if (CREDIT_BOWLER.has(kind)) bw.wickets++;
        } else inn.retired.add(out);
        inn.batter(out).out = describeOut(wk, bowler);
        if (inn.striker === out) inn.striker = null;
        else if (inn.non === out) inn.non = null;
        inn.pendingNew = true;
      }
      if (legal) {
        inn.legal++;
        if (inn.legal % 6 === 0) {
          const maiden = inn.overConceded === 0;
          if (maiden) bw.maidens++;
          inn.completedOver = [inn.legal / 6 - 1, inn.overBowler, inn.overRuns, inn.overWkts, maiden];
          [inn.striker, inn.non] = [inn.non, inn.striker];
          inn.lastOverBowler = inn.overBowler;
          inn.overBowler = null;
          if (inn.legal / 6 === powerplay) inn.maxOutside = 5;
        }
      }
      const nxt = Boolean(nb) || (Boolean(wd) && inn.freeHit);
      if (res.free_hit_next != null && res.free_hit_next !== nxt) err(w, `free_hit_next is ${res.free_hit_next} but should be ${nxt}`);
      inn.freeHit = nxt;
      const sa = res.score_after;
      if (sa && !sameScore(sa, inn.score()))
        snapshot(inn, w, `score_after ${sa.runs}/${sa.wickets} (${sa.overs}) but the balls add up to ${inn.runs}/${inn.wkts} (${oversStr(inn.legal)})`);
      checkClose(inn);
    },
    over_end(inn, e, w) {
      const c = inn.completedOver;
      if (!c) return err(w, "over_end not straight after the last ball of an over");
      const [over, bowler, runs, wkts, maiden] = c;
      for (const [k, v] of [["over", over], ["bowler", bowler], ["runs", runs], ["wickets", wkts], ["maiden", maiden]])
        if (k in e && e[k] !== v) err(w, `over_end ${k} ${JSON.stringify(e[k])} but the over gives ${JSON.stringify(v)}`);
      if (e.score && !sameScore(e.score, inn.score())) snapshot(inn, w, `over_end score ${JSON.stringify(e.score)} but it is ${JSON.stringify(inn.score())}`);
    },
    bowler_change(inn, e, w) {
      playerIn(inn.bowl, e.to, w, "bowler");
      if (e.reason === "tactical") return;
      if (inn.overBowler == null) return err(w, `${e.reason} bowler change outside an over`);
      if ((e.from ?? inn.overBowler) !== inn.overBowler) err(w, `from ${e.from} but ${inn.overBowler} is bowling`);
      if (e.to === inn.overBowler || e.to === inn.lastOverBowler) err(w, `${e.to} cannot finish this over`);
      inn.overBowler = e.to;
    },
    drinks() {},
    cutscene() {},
    strategic_timeout(inn, e, w) {
      if (!teams[e.team]) err(w, `timeout team '${e.team}' is not playing`);
      if (inn.legal % 6) warn(w, "strategic timeout in the middle of an over");
      inn.timeouts[e.team] = (inn.timeouts[e.team] || 0) + 1;
      if (inn.timeouts[e.team] > 1) warn(w, `${e.team} takes more than one strategic timeout this innings`);
    },
    injury(inn, e, w) {
      const p = e.player;
      if (!active[inn.bat].has(p) && !active[inn.bowl].has(p)) err(w, `injured player '${p}' is not playing`);
      if (e.outcome === "retired_hurt") {
        if (p !== inn.striker && p !== inn.non) return err(w, `${p} retires hurt but is not batting`);
        inn.retired.add(p);
        inn.batter(p).out = "retired hurt";
        if (inn.striker === p) inn.striker = null; else inn.non = null;
        inn.pendingNew = true;
      }
    },
    substitution(inn, e, w) {
      const t = e.team;
      if (!teams[t]) return err(w, `team '${t}' is not playing`);
      playerIn(t, e.player_in, w, "player_in", true);
      if (e.kind === "fielding") return;
      if (!active[t].has(e.player_out)) err(w, `${e.player_out} is not playing for ${t}`);
      if (active[t].has(e.player_in)) err(w, `${e.player_in} is already playing`);
      active[t].delete(e.player_out);
      active[t].add(e.player_in);
    },
    rain_delay(inn, e, w) {
      if (e.revised_overs != null) inn.overs = e.revised_overs;
      if (e.revised_target != null) {
        if (inn.target == null) err(w, "revised_target in the first innings");
        inn.target = e.revised_target;
      }
      checkClose(inn);
    },
    innings_break(inn, e, w) {
      if (inn.number !== 1) err(w, "innings_break belongs at the end of the first innings");
      if (!inn.closed) err(w, `innings_break but the innings is not over (${inn.runs}/${inn.wkts} in ${oversStr(inn.legal)})`);
      if (e.score && !sameScore(e.score, inn.score())) err(w, `innings_break score ${JSON.stringify(e.score)} but it is ${JSON.stringify(inn.score())}`);
      if (e.target != null && e.target !== inn.runs + 1) err(w, `innings_break target ${e.target} but it should be ${inn.runs + 1}`);
    },
    powerplay_change(inn, e) {
      inn.maxOutside = e.max_outside_circle ?? (e.phase === "powerplay" ? 2 : 5);
    },
    milestone(inn, e, w) {
      const need = MILESTONE_MIN[e.kind];
      if (need == null) return;
      let have;
      if (e.kind.startsWith("team")) have = inn.runs;
      else if (e.kind.startsWith("batter")) have = inn.batters.get(e.player)?.runs ?? -1;
      else have = inn.bowlers.get(e.player)?.wickets ?? -1;
      if (have < need) err(w, `milestone ${e.kind} for ${e.player || inn.bat} but they only have ${have}`);
    },
    match_end(inn, e, w) {
      const res = e.result;
      const expected = computeResult();
      result = expected;
      for (const [k, v] of Object.entries(expected)) {
        if (k in res && res[k] !== v) err(w, `match_end result.${k} is ${JSON.stringify(res[k])} but the scores give ${JSON.stringify(v)}`);
        if (!(k in res) && k !== "balls_remaining") err(w, `match_end result is missing ${k} (${JSON.stringify(v)})`);
      }
      const pom = e.player_of_match;
      if (pom && !Object.values(active).some((s) => s.has(pom))) err(w, `player_of_match '${pom}' did not play`);
    },
  };

  function checkReview(inn, e, w, wk) {
    const rv = e.review, um = e.umpire || {};
    if (!rv) {
      if (um.decision === "out" && !wk) err(w, "umpire gave it out but there is no wicket (missing review?)");
      if (wk && um.decision === "not_out") err(w, "wicket but the umpire said not out and nothing was reviewed");
      return;
    }
    const flip = { out: "not_out", not_out: "out" };
    const final = rv.outcome === "overturned" ? flip[rv.original_decision] : rv.original_decision;
    if ((rv.final_decision ?? final) !== final)
      err(w, `review final_decision ${rv.final_decision} but ${rv.outcome} of ${rv.original_decision} gives ${final}`);
    if (um.decision && um.decision !== rv.original_decision) warn(w, "umpire.decision differs from review.original_decision");
    if (rv.type === "no_ball_check") {
      if (final === "not_out" && !(e.result.extras || {}).no_balls) err(w, "no-ball check overturned the dismissal but the ball is not a no-ball");
    } else if ((final === "out") !== Boolean(wk && wk.kind !== "retired_hurt"))
      err(w, `review ends ${final} but the result ${wk ? "has" : "has no"} wicket`);
    if (rv.type === "DRS") {
      if (!rv.by) return err(w, "DRS review needs 'by' (batting/bowling)");
      const team = rv.by === "batting" ? inn.bat : inn.bowl;
      if ((inn.reviewsLost[team] || 0) >= nReviews) err(w, `${team} has no reviews left`);
      const retained = rv.outcome !== "upheld";
      if ((rv.review_retained ?? retained) !== retained) err(w, `review_retained should be ${retained} for outcome ${rv.outcome}`);
      if (!retained) inn.reviewsLost[team] = (inn.reviewsLost[team] || 0) + 1;
    }
  }

  function checkField(inn, e, w) {
    const field = e.field;
    if (!field?.length) return;
    inn.field = field;
    let out = 0;
    for (const slot of field) {
      playerIn(inn.bowl, slot.player, w, "field player", true);
      let x, y;
      if (slot.x_m != null && slot.y_m != null) [x, y] = [slot.x_m, slot.y_m];
      else if (slot.position) [x, y] = posXY(vocab.positions, slot.position);
      else { err(w, `field slot for ${slot.player} has neither position nor x_m/y_m`); continue; }
      if (!inCircle(x, y, vocab.ground.inner_circle_radius_m)) out++;
    }
    if (out > inn.maxOutside) warn(w, `${out} fielders outside the circle, at most ${inn.maxOutside} allowed now`);
    const names = field.map((s) => s.player);
    if (new Set(names).size !== names.length) err(w, "a fielder is placed twice");
  }

  function computeResult() {
    if (innings.length < 2) return { type: "no_result" };
    const [a, b] = innings;
    if (!b.closed) return { type: "no_result" };
    if (b.runs >= b.target)
      return { type: "win", winner: b.bat, margin_wickets: active[b.bat].size - 1 - b.wkts, balls_remaining: b.overs * 6 - b.legal };
    if (b.runs === b.target - 1) return { type: "tie" };
    return { type: "win", winner: a.bat, margin_runs: b.target - 1 - b.runs };
  }

  let lastTime = null;
  doc.innings.forEach((raw, k) => {
    const w0 = `innings ${raw.number}`;
    if (raw.number !== k + 1) err(w0, `innings number ${raw.number} at position ${k + 1}`);
    const bat = raw.batting_team, bowl = raw.bowling_team;
    const names = Object.keys(teams);
    if (!(names.includes(bat) && names.includes(bowl) && bat !== bowl)) err(w0, `batting/bowling teams '${bat}'/'${bowl}' are not the two header teams`);
    const firstBat = h.toss.decision === "bat" ? h.toss.winner : names.find((n) => n !== h.toss.winner);
    const expectedBat = k === 0 ? firstBat : names.find((n) => n !== firstBat);
    if (bat !== expectedBat) err(w0, `${bat} bats but the toss (${h.toss.winner} chose to ${h.toss.decision}) says ${expectedBat}`);
    let target = raw.target ?? null;
    if (k === 1) {
      const prev = innings[0];
      if (!prev.closed) err(w0, "second innings starts before the first is complete");
      if (target == null) target = prev.runs + 1;
      else if (target !== prev.runs + 1) err(w0, `target ${target} but first innings made ${prev.runs} (target ${prev.runs + 1})`);
    } else if (target != null) err(w0, "first innings cannot have a target");
    const inn = new Innings(raw.number, bat, bowl, h.overs, target);
    inn.maxOutside = powerplay ? 2 : 5;
    innings.push(inn);
    const st = [];
    states.push(st);
    raw.events.forEach((e, idx) => {
      const w = `innings ${raw.number} event ${idx} (${e.id || e.type})`;
      issues = [];
      const t = e.timing?.real_time;
      if (t) {
        if (lastTime && t < lastTime) warn(w, `real_time ${t} earlier than previous ${lastTime}`);
        lastTime = t;
      }
      if (result) err(w, "event after match_end");
      const fn = handlers[e.type];
      if (fn) fn(inn, e, w);
      else err(w, `unknown event type ${e.type}`);
      st.push({
        score: inn.score(), target: inn.target, striker: inn.striker, non: inn.non,
        bowler: inn.overBowler ?? inn.lastOverBowler, field: inn.field, freeHit: inn.freeHit, closed: inn.closed, issues,
        completedOver: inn.completedOver && [...inn.completedOver],
      });
    });
    issues = null;
    if (inn.snapshotDrift > 1) warn(w0, `${inn.snapshotDrift - 1} more score snapshots disagree`);
    if (!inn.closed && !result) warn(w0, `incomplete: ${inn.runs}/${inn.wkts} in ${oversStr(inn.legal)}`);
  });
  if (!result) warn("match", "no match_end event (match incomplete)");
  return { errors, warnings, innings, result, states };
}

// Schema first; the cricket replay only runs on schema-valid input (it trusts the shapes).
export function validateTimeline(doc, schema, vocab) {
  if (schema) {
    const errs = new SchemaValidator(schema).validate(doc);
    if (errs.length) return { errors: errs, warnings: [], innings: [], result: null, states: [], schemaFailed: true };
  }
  return replay(doc, vocab);
}
