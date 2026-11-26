import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

function seeded(seed = 1) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

const FIVE = ['Rick', 'Leo', 'Linh', 'Nate', 'Doug'];

function checkIn(names, rng) {
  let s = L.newSession();
  for (const n of names) s = L.setPresent(s, n, true, rng);
  return s;
}

const teammates = (sides, a, b) => sides.some((t) => t.includes(a) && t.includes(b));

test('player count decides the format; only 5+ forces a sit-out', () => {
  const rng = seeded(3);
  const cases = { 2: ['1v1', 0], 3: ['3way', 0], 4: ['2v2', 0], 5: ['2v2', 1] };
  for (const [n, [mode, out]] of Object.entries(cases)) {
    const s = checkIn(FIVE.slice(0, +n), rng);
    assert.equal(L.modeOf(s.match.sides), mode, `n=${n}`);
    assert.equal(s.match.out.length, out, `n=${n}`);
  }
  assert.equal(checkIn(['Rick'], rng).match, null);
});

test('after a 5-player win: a loser sits out, the sitter returns, winners are split', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = seeded(seed);
    let s = checkIn(FIVE, rng);
    const prev = s.match;
    const win = Math.floor(rng() * 2);
    s = L.recordWin(s, win, rng);
    const losers = prev.sides[1 - win];
    const winners = prev.sides[win];
    assert.equal(s.match.out.length, 1);
    assert.ok(losers.includes(s.match.out[0]), 'sit-out comes from the losing team');
    assert.ok(L.onCourt(s.match).includes(prev.out[0]), 'previous sitter plays');
    assert.ok(!teammates(s.match.sides, ...winners), 'winning pair split');
  }
});

test('winning pair is never teamed in the next match (long random sessions, joins and leaves)', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rng = seeded(seed);
    let s = checkIn(FIVE.slice(0, 4), rng);
    for (let i = 0; i < 40; i++) {
      if (i === 10) s = L.setPresent(s, 'Doug', true, rng);
      if (i === 25) s = L.setPresent(s, 'Leo', false, rng);
      if (i === 30) s = L.setPresent(s, 'Leo', true, rng);
      const sides = s.match.sides;
      s = L.recordWin(s, Math.floor(rng() * sides.length), rng);
      const last = s.history.at(-1);
      if (L.modeOf(last.sides) === '2v2' && L.modeOf(s.match.sides) === '2v2') {
        assert.ok(!teammates(s.match.sides, ...L.winnersOf(last)), `seed ${seed} match ${i}`);
      }
    }
  }
});

test('playing time stays balanced with 5 players', () => {
  let worst = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const rng = seeded(seed);
    let s = checkIn(FIVE, rng);
    for (let i = 0; i < 20; i++) s = L.recordWin(s, Math.floor(rng() * 2), rng);
    const st = L.playerStats(s.history, FIVE);
    const played = FIVE.map((p) => st[p].played);
    worst = Math.max(worst, Math.max(...played) - Math.min(...played));
    assert.equal(
      FIVE.reduce((n, p) => n + st[p].out, 0),
      20,
    );
  }
  assert.ok(worst <= 4, `max spread in games played was ${worst}`);
});

test('pairings get distributed: every pair teams up over a session', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const rng = seeded(seed);
    let s = checkIn(FIVE.slice(0, 4), rng);
    for (let i = 0; i < 9; i++) s = L.recordWin(s, Math.floor(rng() * 2), rng);
    const { pc } = L.pairCounts(s.history);
    assert.equal(Object.keys(pc).length, 6, `seed ${seed}: ${JSON.stringify(pc)}`);
    assert.ok(Math.max(...Object.values(pc)) - Math.min(...Object.values(pc)) <= 2);
  }
});

test('a late arrival goes straight in and the teams are reshuffled', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const rng = seeded(seed);
    let s = checkIn(FIVE.slice(0, 4), rng);
    s = L.recordWin(s, 0, rng);
    s = L.recordWin(s, 1, rng);
    const winners = L.winnersOf(s.history.at(-1));
    s = L.setPresent(s, 'Doug', true, rng);
    assert.ok(L.onCourt(s.match).includes('Doug'));
    assert.equal(s.match.out.length, 1);
    assert.ok(!winners.includes(s.match.out[0]), 'a winner does not sit out');
    assert.ok(!teammates(s.match.sides, ...winners));
    assert.deepEqual(s.seen.sort(), [...FIVE].sort());
  }
});

test('manual bench overrides: 4 present with one benched plays cut-throat, and back', () => {
  const rng = seeded(9);
  let s = checkIn(FIVE.slice(0, 4), rng);
  const m3 = L.benchPlayer(s.match, 'Rick', s.history, rng);
  assert.equal(L.modeOf(m3.sides), '3way');
  assert.deepEqual(m3.out, ['Rick']);
  const m2 = L.benchPlayer(m3, 'Leo', s.history, rng);
  assert.equal(L.modeOf(m2.sides), '1v1');
  assert.equal(L.benchPlayer(m2, 'Linh', s.history, rng), m2, 'cannot go below 2 on court');
  const back = L.unbenchPlayer(L.unbenchPlayer(m2, 'Leo', s.history, rng), 'Rick', s.history, rng);
  assert.equal(L.modeOf(back.sides), '2v2');
  assert.equal(back.out.length, 0);

  s = { ...s, match: m3 };
  s = L.recordWin(s, 0, rng);
  assert.equal(s.history.at(-1).sides.length, 3);
  assert.equal(s.match.out.length, 0, 'override lasts one match');
});

test('swap moves players between teams and the bench', () => {
  const m = {
    sides: [
      ['A', 'B'],
      ['C', 'D'],
    ],
    out: ['E'],
  };
  assert.deepEqual(L.swapPlayers(m, 'B', 'C'), {
    sides: [
      ['A', 'C'],
      ['B', 'D'],
    ],
    out: ['E'],
  });
  const benched = L.swapPlayers(m, 'A', 'E', [], seeded(1));
  assert.deepEqual(benched.out, ['A']);
  assert.deepEqual(benched.sides.flat().sort(), ['B', 'C', 'D', 'E']);
});

test('changing who sits out always reshuffles the teams and keeps the last winners apart', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = seeded(seed);
    let s = checkIn(FIVE, rng);
    s = L.recordWin(s, Math.floor(rng() * 2), rng);
    const winners = L.winnersOf(s.history.at(-1));
    const sitter = s.match.out[0];
    const goer = L.onCourt(s.match)[Math.floor(rng() * 4)];
    const inPlace = s.match.sides.map((t) => t.map((p) => (p === goer ? sitter : p)));
    const next = L.swapPlayers(s.match, goer, sitter, s.history, rng);
    assert.deepEqual(next.out, [goer]);
    assert.ok(L.onCourt(next).includes(sitter));
    assert.ok(!teammates(next.sides, ...winners), `seed ${seed}: winners teamed`);
    const legal = L.arrangements(L.onCourt(next), s.history).filter(
      (o) => !teammates(o.sides, ...inPlace[0]) || !teammates(o.sides, ...inPlace[1]),
    );
    if (legal.length) {
      assert.ok(
        !(teammates(next.sides, ...inPlace[0]) && teammates(next.sides, ...inPlace[1])),
        `seed ${seed}: newcomer just took the old spot`,
      );
    }
  }
});

test('a manual swap cannot team up the last winning pair', () => {
  const history = [
    {
      sides: [
        ['A', 'B'],
        ['C', 'D'],
      ],
      out: ['E'],
      win: 0,
      t: 0,
    },
  ];
  const m = {
    sides: [
      ['A', 'C'],
      ['B', 'D'],
    ],
    out: ['E'],
  };
  assert.equal(L.swapPlayers(m, 'C', 'B', history), m, 'refused: A & B just won');
  assert.deepEqual(L.swapPlayers(m, 'C', 'D', history).sides, [
    ['A', 'D'],
    ['B', 'C'],
  ]);
});

test('reshuffle picks a different legal split and keeps the bench', () => {
  const rng = seeded(5);
  let s = checkIn(FIVE, rng);
  s = L.recordWin(s, 0, rng);
  const winners = L.winnersOf(s.history.at(-1));
  for (let i = 0; i < 10; i++) {
    const next = L.reshuffle(s.match, s.history, rng);
    assert.deepEqual(next.out, s.match.out);
    assert.notDeepEqual(
      next.sides.map((t) => [...t].sort().join()).sort(),
      s.match.sides.map((t) => [...t].sort().join()).sort(),
    );
    assert.ok(!teammates(next.sides, ...winners));
    s = { ...s, match: next };
  }
});

test('a win stores the real instant and times are shown in Eastern Time', () => {
  const rng = seeded(4);
  let s = checkIn(['Rick', 'Leo'], rng);
  const before = Date.now();
  s = L.recordWin(s, 0, rng);
  const after = Date.now();
  const t = s.history.at(-1).t;
  assert.ok(t >= before && t <= after, 'win uses a real timestamp');

  // 18:30Z in January is 1:30 PM EST; 16:05Z in July is 12:05 PM EDT; 05:00Z is midnight EST.
  const winter = Date.parse('2026-01-15T18:30:00.000Z');
  const summer = Date.parse('2026-07-15T16:05:00.000Z');
  const midnight = Date.parse('2026-01-15T05:00:00.000Z');
  assert.equal(L.formatTimeET(winter), '1:30 PM');
  assert.equal(L.formatTimeET(winter, 'hhmm'), '13:30');
  assert.equal(L.formatTimeET(summer), '12:05 PM');
  assert.equal(L.formatTimeET(summer, 'hhmm'), '12:05');
  assert.equal(L.formatTimeET(midnight), '12:00 AM');
  assert.equal(L.formatTimeET(midnight, 'hhmm'), '00:00');
  assert.equal(L.formatTimeET(0), '');
  assert.equal(L.formatTimeET(undefined), '');

  s = L.recordWin(s, 0, rng, winter);
  s = L.recordWin(s, 0, rng, summer);
  const { matches } = L.dayRows(s.date, s.history);
  assert.equal(matches[0][9], L.formatTimeET(t, 'hhmm'));
  assert.equal(matches[1][9], '13:30');
  assert.equal(matches[2][9], '12:05');
});

test('dayRows and aggregate produce the per-day rows and period totals', () => {
  const rng = seeded(11);
  let s = checkIn(FIVE, rng);
  for (let i = 0; i < 6; i++) s = L.recordWin(s, 0, rng);
  const { days, matches } = L.dayRows(s.date, s.history, 'now');
  assert.equal(days.length, 5);
  assert.equal(matches.length, 6);
  assert.ok(
    days.every((r) => r[0] === s.date && r[1] === s.date),
    'rows are keyed by date',
  );
  assert.equal(
    days.reduce((n, r) => n + r[3], 0),
    24,
  );
  assert.equal(matches[0][3], '2v2');
  const objs = days.map((r) => ({
    date: r[0],
    player: r[2],
    played: r[3],
    wins: r[4],
    losses: r[5],
    out: r[6],
  }));
  const agg = L.aggregate([...objs, ...objs.map((o) => ({ ...o, date: '1999-01-01' }))], s.date.slice(0, 7));
  assert.equal(agg.length, 5);
  assert.equal(
    agg.reduce((n, r) => n + r.wins, 0),
    12,
  );
});

test('crown: most wins then fewest losses; poop: most losses then fewest wins; ties get nothing', () => {
  const m = (a, b, win, out = []) => ({ sides: [a, b], out, win, t: 0 });
  const h = [
    m(['A', 'B'], ['C', 'D'], 0, ['E']),
    m(['A', 'C'], ['B', 'E'], 0, ['D']),
    m(['A', 'E'], ['C', 'D'], 1, ['B']),
  ];
  // A 2-1, B 1-1, C 2-1, D 1-2, E 0-2: crown tied all the way; poop tie broken by fewer wins
  assert.deepEqual(L.dayStars(h), { crown: null, poop: 'E' });
  // A 3-1, B 1-2, C 2-1, D 2-2, E 0-3
  assert.deepEqual(L.dayStars([...h, m(['A', 'D'], ['B', 'E'], 0, ['C'])]), { crown: 'A', poop: 'E' });
  // A 2-0 beats C 2-1 on losses; D 0-3 has the most losses
  const h3 = [
    m(['A', 'B'], ['C', 'D'], 0),
    m(['A', 'C'], ['B', 'D'], 0),
    m(['C', 'E'], ['B', 'D'], 0, ['A']),
  ];
  assert.deepEqual(L.dayStars(h3), { crown: 'A', poop: 'D' });
  // A 1-1, B 1-1, C 1-1, D 0-1, E 1-0: E has no losses; D lost once with no wins
  const h4 = [m(['A', 'B'], ['C', 'D'], 0, ['E']), m(['C', 'E'], ['A', 'B'], 0, ['D'])];
  assert.deepEqual(L.dayStars(h4), { crown: 'E', poop: 'D' });
  assert.deepEqual(L.dayStars([m(['A', 'B'], ['C', 'D'], 0)]), { crown: null, poop: null });
  assert.deepEqual(L.dayStars([]), { crown: null, poop: null });
});
