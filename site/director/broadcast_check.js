// Check for broadcast.js's replay: a recorded live match's timeline + script replayed to the end of each innings
// must give the NPL scorecard's figures (batters' runs/balls, bowlers' runs/wickets) for every name the two share.
//   node web/director/broadcast_check.js director/live/match3
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { replay, playerMap, intervalCards } = require('./broadcast.js');

if (process.argv[2] === '--interval') {
  const match = JSON.parse(fs.readFileSync(path.join(__dirname, '../../director/live/match3/timeline.json'), 'utf8'));
  const script = fs.readFileSync(path.join(__dirname, '../../director/live/match3/script.txt'), 'utf8');
  const players = playerMap(match, script);
  assert.equal(players.get(32795).name, 'Lalit Rajbanshi');
  assert.equal(players.get(32813).name, 'Mark Watt');
  assert.throws(() => playerMap(match, script.replace('ids=32813,', 'ids=1,' ).replace('ids=32797,', 'ids=1,')), /duplicate player ID/);
  assert.throws(() => playerMap(match, script.replace('ids=32813,', 'ids=')), /roster length mismatch/);
  const deliveries = match.innings[0].events.filter((e) => e.type === 'delivery');
  const ids = deliveries.map((e) => e.id);
  const v = replay(match, ids, 6, 0);
  const state = { interval: { active: true, over_break: true }, featured: { id: 32795, reason: 'new_bowler', role: 11 } };
  const cards = intervalCards(v, state, players);
  assert.match(cards.feature, /New bowler/);
  assert.match(cards.feature, /Today · 0-0 · 0.0 overs/);
  assert.match(intervalCards(v, { ...state, featured: { id: 32813, role: 12, reason: 'just_out' } }, players).feature, /1 run · 5 balls/);
  assert.equal(cards.team, 'Janakpur Bolts');
  assert.match(cards.summary, /END OF OVER 1 · 4 RUNS/);
  assert.match(cards.summary, /Partnership 0 \(0\)/);
  assert.equal(intervalCards(v, { ...state, interval: { active: false } }, players).feature, '');
  assert.equal(intervalCards(v, { ...state, featured: { id: -1 } }, players).feature, '');
  assert.equal(intervalCards(v, { ...state, interval: { active: true, over_break: false } }, players).summary, '');
  assert.match(intervalCards(v, state, players, () => '<script>').feature, /&lt;script&gt;/);
  const next = replay(match, ids, 7, 0);
  assert.equal(intervalCards(next, state, players).summary, '');
  // A wide contributes partnership runs but not a legal ball; a wicket starts a new stand.
  const fixture = { innings: [{ events: [
    { id: 'a', type: 'delivery', batter: 'A', non_striker: 'B', bowler: 'C', over: 0,
      result: { runs_bat: 1, extras: {}, score_after: { runs: 1, wickets: 0, overs: '0.1' } } },
    { id: 'b', type: 'delivery', batter: 'B', non_striker: 'A', bowler: 'C', over: 0,
      result: { runs_bat: 0, extras: { wides: 2 }, score_after: { runs: 3, wickets: 0, overs: '0.1' } } }
  ] }] };
  assert.deepEqual(replay(fixture, ['a', 'b'], 2).partnership, { runs: 3, balls: 1 });
  console.log(`interval graphics checks passed; ${players.size} explicit roster IDs resolved`);
  process.exit(0);
}

const dir = process.argv[2];
if (!dir) { console.error('usage: broadcast_check.js <director/live/matchN>'); process.exit(2); }
const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'));
const ids = fs.readFileSync(path.join(dir, 'script.txt'), 'utf8').split('\n').filter((l) => l.startsWith('ball'))
  .map((l) => (l.match(/#\s*(\S+)\s*$/) || [])[1]);
const card = JSON.parse(fs.readFileSync(path.join(dir, 'scorecard_latest.json'), 'utf8')).data;
let bad = 0, compared = 0;
tl.innings.forEach((inn, ii) => {
  const lastId = [...inn.events].reverse().find((e) => e.type === 'delivery' && ids.includes(e.id))?.id;
  if (!lastId) return;
  const v = replay(tl, ids, ids.indexOf(lastId) + 1, ii);
  const real = (card.innings || [])[ii];
  if (!real) return;
  const want = real.score ?? `${real.runs}/${real.wickets}`;
  console.log(`innings ${ii + 1}: replay ${v.score.runs}/${v.score.wickets} (${v.score.overs}), feed ${want} (${real.overs})`);
  if (v.score.runs !== real.runs || v.score.wickets !== real.wickets) { bad++; console.log('  SCORE MISMATCH'); }
  for (const b of real.batting || []) {
    const s = v.bat.get(b.name);
    if (!s) continue;
    compared++;
    if (s.r !== b.runs || s.b !== b.balls) { bad++; console.log(`  batter ${b.name}: replay ${s.r} (${s.b}), feed ${b.runs} (${b.balls})`); }
  }
  for (const b of real.bowling || []) {
    const s = v.bowl.get(b.name);
    if (!s) continue;
    compared++;
    if (s.runs !== b.runs || s.w !== b.wickets) { bad++; console.log(`  bowler ${b.name}: replay ${s.w}-${s.runs}, feed ${b.wickets}-${b.runs}`); }
  }
});
console.log(`${compared} figures compared, ${bad} mismatches`);
process.exit(bad ? 1 : 0);
