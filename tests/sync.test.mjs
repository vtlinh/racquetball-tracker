import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAppsScript } from './fake-apps-script.mjs';
import * as L from '../js/logic.js';

const API = 'https://script.google.com/macros/s/fake/exec';
const backend = loadAppsScript();
let online = true;

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
};
globalThis.location = { search: `?api=${encodeURIComponent(API)}`, pathname: '/' };
globalThis.history = { replaceState() {} };
globalThis.document = { addEventListener() {}, visibilityState: 'visible' };
globalThis.addEventListener = () => {};
globalThis.fetch = async (url, opts = {}) => {
  if (!online) throw new TypeError('Failed to fetch');
  assert.ok(String(url).startsWith(API));
  const json = opts.method === 'POST' ? backend.post(JSON.parse(opts.body)) : backend.get();
  return { ok: true, status: 200, json: async () => json };
};

const S = await import('../js/store.js');
const settle = async () => {
  await new Promise((r) => setTimeout(r, 450));
  await S.flush();
};
const rows = (tab) =>
  backend.sheets
    .get(tab)
    .data.slice(1)
    .filter((r) => r.some((v) => v !== ''));

const today = () => S.getViewDate();
const matchRows = (date) => rows('Matches').filter((r) => r[0] === date);

test('results are written per day automatically; undo only reverts result changes', async () => {
  await S.pull();
  assert.deepEqual(S.getState().roster, ['Rick', 'Leo', 'Linh', 'Nate', 'Doug']);

  for (const p of ['Rick', 'Leo', 'Linh', 'Nate', 'Doug']) S.togglePlayer(p);
  S.reshuffle();
  assert.equal(S.canUndo(), false, 'check-ins and shuffles are not undoable');
  S.win(0);
  S.win(1);
  S.win(0);
  await settle();
  assert.equal(S.getSync().status, 'idle');
  assert.equal(rows('Days').length, 5, 'one row per player for today, no Done needed');
  assert.equal(matchRows(today()).length, 3);
  assert.ok(
    rows('Days').every((r) => r[1] === today()),
    'rows are keyed by date',
  );

  const remote = backend.get().state.data;
  assert.equal(remote.log[today()].length, 3);
  assert.equal(remote.undo.length, 3, 'only results are on the undo stack');
  assert.equal(remote.redo.length, 0, 'a new result clears redo');

  const lineup = S.getState().live.match;
  const third = S.dayHistory().at(-1);
  S.togglePlayer('Doug');
  const afterToggle = S.getState().live.match;
  S.undo();
  assert.equal(S.dayHistory().length, 2, 'undo reverts the last result');
  assert.equal(S.canRedo(), true, 'undo can be redone');
  assert.ok(S.getState().live.present.includes('Doug'), 'players in the restored lineup are back');
  assert.notEqual(S.getState().live.match, lineup);
  S.redo();
  assert.equal(S.dayHistory().at(-1), third, 'redo puts the result back');
  assert.equal(S.canRedo(), false);
  assert.equal(S.getState().live.match, afterToggle, 'redo restores the court from before the undo');
  S.undo();
  assert.equal(S.dayHistory().length, 2);
  await settle();
  assert.equal(matchRows(today()).length, 2);
  assert.equal(backend.get().state.data.redo.length, 1);

  const first = S.dayHistory()[0];
  S.setWinner(today(), 0, 1 - first.win);
  await settle();
  assert.equal(matchRows(today())[0][7], first.sides[1 - first.win].join('+'), 'winner edited in the sheet');

  S.deleteMatch(today(), 0);
  await settle();
  assert.equal(matchRows(today()).length, 1);
  S.undo();
  await settle();
  assert.equal(matchRows(today()).length, 2, 'undo brings a deleted result back');
});

test('results can be added to and edited on any past day', async () => {
  const past = '2026-11-01';
  S.setViewDate(past);
  assert.equal(S.getViewDate(), past);
  S.win(0);
  S.win(1);
  S.setViewDate(null);
  await settle();
  assert.equal(S.dayHistory(past).length, 2);
  assert.equal(matchRows(past).length, 2);
  assert.ok(S.allDays().some((d) => d.date === past && d.matches === 2));
  assert.equal(S.allDays()[0].date, today(), 'newest day first');

  S.deleteDays([past]);
  await settle();
  assert.equal(matchRows(past).length, 0);
  assert.equal(S.dayHistory(past).length, 0);

  while (S.canUndo()) S.undo();
  await settle();
  assert.equal(rows('Days').length, 0, 'undoing every result clears the day from the sheet');
  assert.deepEqual(backend.get().state.data.undo, []);
});

test('works offline and catches up when the connection returns', async () => {
  online = false;
  S.win(0);
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(S.getSync().status, 'error');
  assert.equal(matchRows(today()).length, 0);

  online = true;
  await S.flush();
  assert.equal(S.getSync().status, 'idle');
  assert.equal(matchRows(today()).length, 1);
  assert.ok(backend.get().days.length >= 4);
});

test('a newer state saved by another device wins over a stale write', async () => {
  const theirs = { log: S.getState().log, live: { present: ['Nate', 'Doug'], match: null }, undo: [] };
  backend.post({ action: 'saveState', updatedAt: Date.now() + 60_000, state: theirs });
  S.togglePlayer('Rick');
  await settle();
  assert.deepEqual(S.getState().live.present, ['Nate', 'Doug']);
});

test('roster edits are written to the Players tab', async () => {
  S.setRoster([...S.getState().roster, 'Guest']);
  await settle();
  assert.deepEqual(
    rows('Players').map((r) => r[0]),
    ['Rick', 'Leo', 'Linh', 'Nate', 'Doug', 'Guest'],
  );
});

test('appending grows the grid instead of failing past the last row', () => {
  const sh = backend.sheets.get('Matches');
  sh.maxRows = sh.getLastRow();
  const res = backend.post({
    action: 'stamp',
    session: 'grow',
    days: [],
    matches: [['2026-10-22', 'grow', 1, '2v2', 'A+B', 'C+D', '', 'A+B', '', '10:00']],
  });
  assert.equal(res.ok, true);
  assert.equal(rows('Matches').at(-1)[1], 'grow');
});

test('data saved by the previous version moves into the per-day log', async () => {
  const history = [
    {
      sides: [
        ['A', 'B'],
        ['C', 'D'],
      ],
      out: [],
      win: 0,
      t: 1,
    },
  ];
  const v1 = {
    roster: ['A', 'B', 'C', 'D'],
    session: { id: 'x', date: '2026-10-05', present: ['A', 'B', 'C', 'D'], seen: [], match: null, history },
    undo: [{ s: {}, h: 0 }],
    days: [{ date: '2026-09-01', session: 'old', player: 'A', played: 3, wins: 2, losses: 1, out: 0 }],
    updatedAt: 1,
    pending: [],
    dirty: false,
  };
  mem.set('rb.state.v1', JSON.stringify(v1));
  const S1 = await import('../js/store.js?v1');
  const st = S1.getState();
  assert.deepEqual(st.log, { '2026-10-05': history });
  assert.deepEqual(st.live.present, ['A', 'B', 'C', 'D']);
  assert.equal(st.live.day, null);
  assert.equal(S1.rollDay('2026-11-26'), false, 'a saved lineup with no day is dated without a reshuffle');
  assert.equal(S1.getState().live.day, '2026-11-26');
  assert.equal(S1.getState().live.match, null);
  assert.deepEqual(st.undo, []);
  assert.deepEqual(
    S1.allDays().map((d) => [d.date, d.matches]),
    [
      ['2026-10-05', 1],
      ['2026-09-01', 3],
    ],
  );
  await S1.flush();
  assert.equal(matchRows('2026-10-05').length, 1, 'the unstamped v1 day is written to the sheet');
});

test('a new Eastern Time day deals the same players a fresh lineup', () => {
  const names = ['Rick', 'Leo', 'Linh', 'Nate'];
  for (const p of [...S.getState().live.present]) {
    if (!names.includes(p)) S.togglePlayer(p);
  }
  for (const p of names) {
    if (!S.getState().live.present.includes(p)) S.togglePlayer(p);
  }
  if (!S.dayHistory().length) S.win(0);
  assert.equal(S.getState().live.day, L.localDate());
  const present = [...S.getState().live.present];
  let seed = 9;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const fresh = L.planMatch(present, [], rng);
  seed = 9;
  assert.equal(S.rollDay('2099-04-02', rng), true);
  assert.equal(S.getState().live.day, '2099-04-02');
  assert.deepEqual([...S.getState().live.present], present);
  assert.deepEqual(S.getState().live.match.sides, fresh.sides);
  assert.deepEqual(S.getState().live.match.out, fresh.out);
  assert.equal(S.dayHistory().length > 0, true, "today's results stay put");
  assert.equal(S.rollDay('2099-04-02'), false);
});
