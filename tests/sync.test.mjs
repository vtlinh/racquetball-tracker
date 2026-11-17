import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAppsScript } from './fake-apps-script.mjs';

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

test('state, undo, stamp and unstamp round-trip through the sheet backend', async () => {
  await S.pull();
  assert.deepEqual(S.getState().roster, ['Rick', 'Leo', 'Linh', 'Nate', 'Doug']);

  for (const p of ['Rick', 'Leo', 'Linh', 'Nate', 'Doug']) S.togglePlayer(p);
  S.win(0);
  S.win(1);
  S.win(0);
  await settle();
  assert.equal(S.getSync().status, 'idle');

  const remote = backend.get().state;
  assert.equal(remote.data.session.history.length, 3);
  assert.equal(remote.data.undo.length, 8);

  S.undo();
  assert.equal(S.getState().session.history.length, 2, 'undo reverts the last result');
  S.win(1);

  const sessionId = S.getState().session.id;
  assert.ok(S.done());
  await settle();
  assert.equal(rows('Days').length, 5);
  assert.equal(rows('Matches').length, 3);
  assert.equal(S.getState().days.length, 5);
  assert.equal(S.getState().session.history.length, 0);

  S.undo();
  await settle();
  assert.equal(S.getState().session.id, sessionId, 'undo of Done restores the day');
  assert.equal(rows('Days').length, 0, 'and removes the stamped rows');
  assert.equal(S.getState().days.length, 0);

  while (S.canUndo()) S.undo();
  assert.equal(S.getState().session.present.length, 0, 'undo until nothing is left');
  assert.equal(S.getState().session.history.length, 0);
  await settle();
  assert.equal(backend.get().state.data.undo.length, 0);
});

test('works offline and catches up when the connection returns', async () => {
  online = false;
  for (const p of ['Rick', 'Leo', 'Linh', 'Nate']) S.togglePlayer(p);
  S.win(0);
  S.done();
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(S.getSync().status, 'error');
  assert.equal(rows('Days').length, 0);

  online = true;
  await S.flush();
  assert.equal(S.getSync().status, 'idle');
  assert.equal(rows('Days').length, 4);
  assert.equal(rows('Matches').length, 1);
  assert.equal(backend.get().days.length, 4);
});

test('a newer state saved by another device wins over a stale write', async () => {
  const theirs = { session: { ...S.getState().session, present: ['Nate', 'Doug'] }, undo: [] };
  backend.post({ action: 'saveState', updatedAt: Date.now() + 60_000, state: theirs });
  S.togglePlayer('Rick');
  await settle();
  assert.deepEqual(S.getState().session.present, ['Nate', 'Doug']);
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
