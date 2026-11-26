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

test('a day always picks the same restaurant, and the next game day picks another', () => {
  const list = ['Pho', ' pho ', 'Pizza', 'Tacos', 'Ramen'];
  assert.deepEqual(L.cleanRestaurants(list), [
    { name: 'Pho', weight: 1 },
    { name: 'Pizza', weight: 1 },
    { name: 'Tacos', weight: 1 },
    { name: 'Ramen', weight: 1 },
  ]);
  assert.deepEqual(
    L.cleanRestaurants([
      { name: ' Pho ', weight: 5 },
      { name: 'pho', weight: 2 },
      { name: 'Pizza', weight: 9 },
      { name: 'Tacos', weight: 0 },
      'Ramen',
    ]),
    [
      { name: 'Pho', weight: 5 },
      { name: 'Pizza', weight: 1 },
      { name: 'Tacos', weight: 1 },
      { name: 'Ramen', weight: 1 },
    ],
  );
  assert.equal(L.restaurantFor('2026-01-01', ['  '], []), '');
  assert.equal(L.restaurantFor('2026-01-01', ['Pho'], ['2026-01-01']), 'Pho');
  assert.equal(L.restaurantFor('2026-01-02', ['Pho'], ['2026-01-01', '2026-01-02']), 'Pho');

  const days = [];
  for (let i = 1; i <= 40; i++) days.push(`2026-01-${String(i).padStart(2, '0')}`);
  const picks = days.map((d) => L.restaurantFor(d, list, days));
  assert.deepEqual(
    picks,
    days.map((d) => L.restaurantFor(d, list, days)),
    'the same list and game days pick the same places again',
  );
  for (let i = 1; i < picks.length; i++) assert.notEqual(picks[i], picks[i - 1]);

  const wed = L.restaurantFor('2026-01-03', list, ['2026-01-01', '2026-01-03']);
  assert.equal(wed, L.restaurantFor('2026-01-03', list, ['2026-01-01', '2026-01-03']));
  assert.notEqual(wed, L.restaurantFor('2026-01-01', list, ['2026-01-01', '2026-01-03']));
  const tuesday = L.restaurantFor('2026-01-02', list, ['2026-01-01', '2026-01-03']);
  assert.notEqual(tuesday, L.restaurantFor('2026-01-01', list, ['2026-01-01', '2026-01-03']));
  assert.equal(wed, L.restaurantFor('2026-01-03', list, ['2026-01-01', '2026-01-03']));

  assert.equal(
    L.restaurantFor('2026-01-01', list, ['2026-01-01']),
    L.restaurantFor('2026-01-01', list, days),
    'later game days do not change the first game day',
  );

  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const second = L.restaurantFor('2026-01-03', names, ['2026-01-01', '2026-01-03']);
  for (let month = 2; month <= 9; month++) {
    const d = `2026-0${month}-03`;
    assert.equal(
      L.restaurantFor(d, names, ['2026-01-01', d]),
      second,
      'one next() after the first game day, whatever that later date is',
    );
  }
  assert.notEqual(
    L.restaurantFor('2026-01-05', names, ['2026-01-01', '2026-01-02', '2026-01-05']),
    L.restaurantFor('2026-01-05', names, ['2026-01-01', '2026-01-05']),
    'a game day in the gap takes its own next(), so the day after it moves',
  );

  const weighted = [
    { name: 'Pho', weight: 5 },
    { name: 'Pizza', weight: 1 },
    { name: 'Tacos', weight: 1 },
  ];
  const weightedDays = Array.from({ length: 90 }, (_, i) => L.addDays('2026-03-01', i));
  const heavy = weightedDays.map((d) => L.restaurantFor(d, weighted, weightedDays));
  const counts = { Pho: 0, Pizza: 0, Tacos: 0 };
  for (const name of heavy) counts[name]++;
  assert.ok(counts.Pho > counts.Pizza && counts.Pho > counts.Tacos, `weight 5 leads the draws: ${JSON.stringify(counts)}`);
  for (let i = 1; i < heavy.length; i++) assert.notEqual(heavy[i], heavy[i - 1]);
  assert.deepEqual(
    heavy,
    weightedDays.map((d) => L.restaurantFor(d, weighted, weightedDays)),
  );
  const even = weightedDays.map((d) => L.restaurantFor(d, ['Pho', 'Pizza', 'Tacos'], weightedDays));
  assert.notDeepEqual(heavy, even, 'raising a weight changes the sequence');
});

test('personal weights average, and a name that did not pick counts as that average', () => {
  const list = [
    { name: 'Pho', weight: 1 },
    { name: 'Pizza', weight: 1 },
    { name: 'Tacos', weight: 1 },
  ];
  const days = Array.from({ length: 40 }, (_, i) => L.addDays('2026-04-01', i));
  const asBase = (weight) =>
    days.map((d) =>
      L.restaurantFor(
        d,
        list.map((r) => ({ ...r, weight: r.name === 'Pho' ? weight : 1 })),
        days,
      ),
    );
  assert.deepEqual(
    days.map((d) => L.restaurantFor(d, list, days, { Linh: { Pho: 5 } })),
    asBase(5),
    'one vote of 5 is not pulled down by names that left it blank',
  );
  assert.deepEqual(
    days.map((d) => L.restaurantFor(d, list, days, { Linh: { Pho: 5 }, Rick: { Pho: 1 } })),
    asBase(3),
    '5 and 1 average to 3',
  );
  assert.deepEqual(L.cleanMealPicks({ Linh: { Pho: 9, Gone: 2 }, ' rick ': { pho: 4 } }, list), {
    rick: { Pho: 4 },
  });
});

test('the shown weight is the average, or the list weight when nobody picked', () => {
  const pho = { name: 'Pho', weight: 1 };
  assert.equal(L.restaurantWeight(pho, {}), 1);
  assert.equal(L.restaurantWeight(pho, { Linh: { Pho: 5 } }), 5);
  assert.equal(L.restaurantWeight(pho, { Linh: { Pho: 5 }, Rick: { Pho: 1 } }), 3);
  assert.equal(L.formatWeight(3), '3');
  assert.equal(L.formatWeight(10 / 3), '3.3');
});

test('a removed restaurant keeps its score and comes back with the same weight', () => {
  const list = [
    { name: 'Pho', weight: 4 },
    { name: 'Pizza', weight: 1 },
  ];
  const picks = { Linh: { Pho: 5 } };
  const removed = L.withoutRestaurant(list, 'pho');
  assert.deepEqual(removed, [
    { name: 'Pho', weight: 4, removed: true },
    { name: 'Pizza', weight: 1 },
  ]);
  assert.deepEqual(L.cleanMealPicks(picks, removed), picks);
  assert.deepEqual(
    L.rankedRestaurants(removed, picks).map((r) => r.name),
    ['Pizza'],
  );
  for (const date of ['2026-05-01', '2026-05-02', '2026-05-03']) {
    assert.equal(L.restaurantFor(date, removed, ['2026-05-01', '2026-05-02', '2026-05-03'], picks), 'Pizza');
  }
  const back = L.withRestaurant(removed, 'PHO');
  assert.deepEqual(back, list);
  assert.equal(L.restaurantWeight(back[0], L.cleanMealPicks(picks, back)), 5);
  assert.deepEqual(L.withRestaurant(back, 'Pho'), back);
});

test('a restaurant keeps the address picked for it, and maps opens there', () => {
  const added = L.withRestaurant([], {
    name: ' Near ',
    address: ' 10 Main St, Reston, VA ',
    lat: 38.96,
    lng: -77.36,
    km: 1,
  });
  assert.deepEqual(added, [{ name: 'Near', weight: 1, address: '10 Main St, Reston, VA', lat: 38.96, lng: -77.36 }]);
  const moved = L.updateRestaurantAddress(added, 'near', { name: 'Other', address: '1 Oak St', lat: 1, lng: 2 });
  assert.equal(moved[0].name, 'Near');
  assert.equal(moved[0].weight, 1);
  assert.equal(moved[0].address, '1 Oak St');
  assert.equal(moved[0].lat, 1);
  assert.equal(L.mapsUrl({ name: 'Near' }, 'web'), '');
  assert.equal(L.mapsUrl(moved[0], 'web'), 'https://www.google.com/maps/search/?api=1&query=1%2C2');
  assert.match(L.mapsUrl(moved[0], 'android'), /^geo:1,2\?q=1,2\(/);
  assert.match(L.mapsUrl(moved[0], 'ios'), /^https:\/\/maps\.apple\.com\/\?ll=1,2&q=Near$/);
  const places = L.placesFromPhoton(
    [
      { properties: { name: 'Far', street: 'A St', city: 'Farville', state: 'NJ' }, geometry: { coordinates: [-74, 40.8] } },
      {
        properties: { name: 'Near', housenumber: '10', street: 'Main St', city: 'Reston', state: 'VA' },
        geometry: { coordinates: [-77.36, 38.96] },
      },
    ],
    { lat: 38.95, lng: -77.35 },
  );
  assert.deepEqual(
    places.map((p) => p.name),
    ['Near', 'Far'],
  );
  assert.equal(places[0].address, '10 Main St, Reston, VA');
  assert.ok(places[0].km < places[1].km);
  assert.equal(L.formatMiles(places[0].km), '0.9 mi');
  const dupes = L.placesFromPhoton(
    [
      {
        properties: { name: 'Viva Margarita', housenumber: '163', street: 'Old River Road', city: 'Edgewater', state: 'New Jersey' },
        geometry: { coordinates: [-73.9927111, 40.8064909] },
      },
      {
        properties: { name: 'Viva Margarita', housenumber: '163', street: 'Old River Road', city: 'Edgewater', state: 'New Jersey' },
        geometry: { coordinates: [-73.9925604, 40.8064665] },
      },
      {
        properties: { name: 'Viva Margarita', housenumber: '10', street: 'Other St', city: 'Reston', state: 'VA' },
        geometry: { coordinates: [-77.36, 38.96] },
      },
    ],
    { lat: 38.95, lng: -77.35 },
  );
  assert.deepEqual(
    dupes.map((p) => p.address),
    ['10 Other St, Reston, VA', '163 Old River Road, Edgewater, New Jersey'],
  );
  const google = L.placesFromGoogle([
    { name: ' Obaltan ', address: ' Abbott Boulevard, Fort Lee, NJ, USA ', distanceMeters: 2100, placeId: 'a' },
    { name: 'Obaltan', address: 'Abbott Boulevard, Fort Lee, NJ, USA', distanceMeters: 2200, placeId: 'a2' },
    { name: 'Other', placeId: 'b' },
  ]);
  assert.deepEqual(
    google.map((p) => p.name),
    ['Obaltan', 'Other'],
  );
  assert.equal(google[0].address, 'Abbott Boulevard, Fort Lee, NJ, USA');
  assert.equal(google[0].placeId, 'a');
  assert.equal(google[0].km, 2.1);
  assert.equal(L.formatMiles(google[0].km), '1.3 mi');
  const fromGym = L.placesFromPhoton(
    [
      {
        properties: { name: 'Obaltan', housenumber: '799', street: 'Abbott Blvd', city: 'Fort Lee', state: 'NJ' },
        geometry: { coordinates: [-73.982913, 40.831492] },
      },
    ],
    L.GYM,
  );
  assert.equal(L.formatMiles(fromGym[0].km), '6.7 mi');
  assert.equal(L.placeCity('799 Abbott Blvd, Fort Lee, NJ 07024, USA'), 'Fort Lee');
  assert.equal(L.placeCity('163 Old River Road, Edgewater, New Jersey'), 'Edgewater');
  assert.equal(L.placeCity('Abbott Boulevard, Fort Lee, NJ, USA'), 'Fort Lee');
  assert.equal(L.placeCity('10 Main Street, Springfield'), 'Springfield');
  assert.equal(L.placeCity('123 Broadway, New York, NY 10001, USA'), 'New York');
  assert.equal(L.placeCity(''), '');
  assert.equal(L.placeCity('Obaltan'), '');
  assert.equal(google[1].km, undefined);
});

test('restaurants are ordered by weight, then by name', () => {
  assert.deepEqual(
    L.rankedRestaurants([
      { name: 'Tacos', weight: 1 },
      { name: 'ramen', weight: 5 },
      { name: 'Pho', weight: 5 },
      { name: 'Pizza', weight: 3 },
    ]).map((r) => r.name),
    ['Pho', 'ramen', 'Pizza', 'Tacos'],
  );
  assert.deepEqual(
    L.rankedRestaurants(
      [
        { name: 'Tacos', weight: 1 },
        { name: 'Pho', weight: 5 },
        { name: 'Ramen', weight: 5 },
        { name: 'Pizza', weight: 3 },
      ],
      { Linh: { Pho: 1, Pizza: 5 } },
    ).map((r) => r.name),
    ['Pizza', 'Ramen', 'Pho', 'Tacos'],
    'a personal pick replaces the list weight in the ranking',
  );
});

test('a browser can claim a free name, and not one another browser holds', () => {
  const roster = ['Linh', 'Rick'];
  const claim = L.nextClaims({}, roster, 'Linh', 'dev-a');
  assert.equal(claim.ok, true);
  assert.deepEqual(claim.claims, { Linh: 'dev-a' });
  assert.equal(L.nextClaims(claim.claims, roster, 'Linh', 'dev-b').ok, false);
  assert.deepEqual(L.nextClaims(claim.claims, roster, 'Rick', 'dev-a').claims, { Rick: 'dev-a' });
  const freed = L.releaseClaims(claim.claims, 'dev-a');
  assert.equal(freed.who, 'Linh');
  assert.deepEqual(freed.claims, {});
  assert.equal(L.nextClaims(freed.claims, roster, 'Linh', 'dev-b').ok, true);
  assert.deepEqual(L.cleanClaims({ Linh: 'dev-a', linh: 'dev-b', Rick: 'dev-a' }), { Linh: 'dev-a' });
});

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

test('the playing day is the Eastern Time calendar date', () => {
  // 01:48Z on Nov 26 is still 8:48 PM EST on Nov 25. Midnight EST is 05:00Z; midnight EDT is 04:00Z.
  assert.equal(L.localDate(new Date('2026-11-26T01:48:00Z')), '2026-11-25');
  assert.equal(L.localDate(new Date('2026-11-26T04:59:00Z')), '2026-11-25');
  assert.equal(L.localDate(new Date('2026-11-26T05:00:00Z')), '2026-11-26');
  assert.equal(L.localDate(new Date('2026-07-15T03:59:00Z')), '2026-07-14');
  assert.equal(L.localDate(new Date('2026-07-15T04:00:00Z')), '2026-07-15');
  assert.equal(L.addDays('2026-11-25', 1), '2026-11-26');
  assert.equal(L.addDays('2026-11-25', -1), '2026-11-24');
  assert.equal(L.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(L.addDays('2024-03-01', -1), '2024-02-29');
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
  assert.equal(
    agg.reduce((n, r) => n + r.score, 0),
    0,
    'doubles points cancel when score falls back to wins minus losses',
  );
});

test('points: +4/-4 in singles, +3/-3 in doubles, +6/-3 in triples, sitters unchanged', () => {
  const dbl = L.playerStats([
    {
      sides: [
        ['A', 'B'],
        ['C', 'D'],
      ],
      out: ['E'],
      win: 0,
      t: 0,
    },
  ]);
  assert.equal(dbl.A.score, 3);
  assert.equal(dbl.B.score, 3);
  assert.equal(dbl.C.score, -3);
  assert.equal(dbl.D.score, -3);
  assert.equal(dbl.E.score, 0);
  assert.equal(dbl.E.played, 0);

  const singleMatch = { sides: [['A'], ['B']], out: [], win: 1, t: 0 };
  const single = L.playerStats([singleMatch]);
  assert.equal(single.A.score, -4);
  assert.equal(single.B.score, 4);
  assert.equal(L.pointsFor(singleMatch, false), -4);
  assert.equal(L.pointsFor(singleMatch, true), 4);

  const triple = [{ sides: [['A'], ['B'], ['C']], out: [], win: 0, t: 0 }];
  const cut = L.playerStats(triple);
  assert.equal(cut.A.score, L.pointsFor(triple[0], true));
  assert.equal(L.pointsFor(triple[0], true), 6);
  assert.equal(L.pointsFor(triple[0], false), -3);
  assert.equal(cut.A.score, 6);
  assert.equal(cut.B.score, -3);
  assert.equal(cut.C.score, -3);
  assert.deepEqual(L.dayStars(triple), { crown: 'A', poop: null });
  assert.deepEqual(L.dayStars([...triple, { sides: [['B'], ['A'], ['C']], out: [], win: 0, t: 0 }]), {
    crown: null,
    poop: 'C',
  });

  assert.equal(L.formatScore(1), '+1');
  assert.equal(L.formatScore(0.5), '+0.5');
  assert.equal(L.formatScore(3), '+3');
  assert.equal(L.formatScore(-1), '-1');
  assert.equal(L.formatScore(-0.5), '-0.5');
  assert.equal(L.formatScore(0), '0');
});

test('crown is the unique high score and poop is the unique low score', () => {
  const m = (a, b, win, out = []) => ({ sides: [a, b], out, win, t: 0 });
  const h = [
    m(['A', 'B'], ['C', 'D'], 0, ['E']),
    m(['A', 'C'], ['B', 'E'], 0, ['D']),
    m(['A', 'E'], ['C', 'D'], 1, ['B']),
  ];
  // Scores: A +3, B 0, C +3, D 0, E -6. The high score is tied, so no crown.
  assert.deepEqual(L.dayStars(h), { crown: null, poop: 'E' });
  // Scores: A +6, B -3, C +3, D +3, E -9.
  assert.deepEqual(L.dayStars([...h, m(['A', 'D'], ['B', 'E'], 0, ['C'])]), { crown: 'A', poop: 'E' });
  // Scores: A +6, B -3, C +3, D -9, E +3.
  const h3 = [
    m(['A', 'B'], ['C', 'D'], 0),
    m(['A', 'C'], ['B', 'D'], 0),
    m(['C', 'E'], ['B', 'D'], 0, ['A']),
  ];
  assert.deepEqual(L.dayStars(h3), { crown: 'A', poop: 'D' });
  // Scores: A 0, B 0, C 0, D -3, E +3.
  const h4 = [m(['A', 'B'], ['C', 'D'], 0, ['E']), m(['C', 'E'], ['A', 'B'], 0, ['D'])];
  assert.deepEqual(L.dayStars(h4), { crown: 'E', poop: 'D' });
  // E sat both games. Scores among those who played: A +6, B 0, C 0, D -6.
  const satAll = [m(['A', 'B'], ['C', 'D'], 0, ['E']), m(['A', 'C'], ['B', 'D'], 0, ['E'])];
  assert.deepEqual(L.dayStars(satAll), { crown: 'A', poop: 'D' });
  // A record with no games played cannot take a mark, even with a wild win-loss line.
  assert.deepEqual(
    L.starsOf([
      { player: 'A', played: 2, wins: 2, losses: 0 },
      { player: 'B', played: 2, wins: 0, losses: 2 },
      { player: 'C', played: 0, wins: 5, losses: 9 },
    ]),
    { crown: 'A', poop: 'B' },
  );
  // Points outrank the win total: B has fewer wins and the higher score.
  assert.deepEqual(
    L.starsOf([
      { player: 'A', played: 5, wins: 3, losses: 2, score: 1 },
      { player: 'B', played: 2, wins: 2, losses: 0, score: 2 },
      { player: 'C', played: 2, wins: 0, losses: 2, score: -2 },
    ]),
    { crown: 'B', poop: 'C' },
  );
  const row = (player, score) => ({ player, played: 1, score });
  assert.deepEqual(L.starsOf([row('A', 5), row('B', 0), row('C', -1)]), { crown: 'A', poop: 'C' });
  assert.deepEqual(L.starsOf([row('A', 5), row('B', 5), row('C', -1)]), { crown: null, poop: 'C' });
  assert.deepEqual(L.starsOf([row('A', 5), row('B', 0), row('C', 0)]), { crown: 'A', poop: null });
  assert.deepEqual(L.starsOf([row('A', 1), row('B', 1), row('C', 1)]), { crown: null, poop: null });
  assert.deepEqual(L.starsOf([row('A', 4)]), { crown: null, poop: null });
  assert.deepEqual(L.dayStars([m(['A', 'B'], ['C', 'D'], 0)]), { crown: null, poop: null });
  assert.deepEqual(L.dayStars([]), { crown: null, poop: null });
});
