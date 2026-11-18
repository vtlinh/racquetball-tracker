import * as L from './logic.js';
import { DEFAULT_API_URL } from './config.js';

const STATE_KEY = 'rb.state.v1';
const CFG_KEY = 'rb.cfg.v1';
const UNDO_LIMIT = 100;

const blankLive = () => ({ present: [], match: null });

const listeners = new Set();
let flushing = null;
let inflight = null;
let flushTimer = 0;
let viewDate = null;
let state = loadLocal();
let cfg = loadCfg();
let sync = { status: cfg.apiUrl ? 'idle' : 'local', error: '' };

/**
 * state.log    { 'YYYY-MM-DD': [{ sides, out, win, t }] } — every result, by day
 * state.live   { present, match } — who is here and the lineup on court
 * state.undo   [{ date, history, match }] — match changes only
 * state.legacy stamped Days rows that have no match log (v1 data, other devices' unsynced days)
 */
function blank() {
  return {
    roster: [...L.DEFAULT_ROSTER],
    live: blankLive(),
    log: {},
    undo: [],
    legacy: [],
    updatedAt: 0,
    pending: [],
    dirty: false,
  };
}

/** v1 kept one live session that was stamped by hand; its unstamped matches become that day's log. */
function fromV1(session) {
  const log = {};
  if (session?.history?.length) log[session.date] = session.history;
  return { live: { present: session?.present || [], match: session?.match || null }, log };
}

function loadLocal() {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY));
    if (s?.log) return { ...blank(), ...s };
    if (s?.session) {
      const v2 = {
        ...blank(),
        roster: s.roster || L.DEFAULT_ROSTER,
        pending: s.pending || [],
        legacy: s.days || [],
      };
      Object.assign(v2, fromV1(s.session), { dirty: true, updatedAt: Date.now() });
      for (const [date, h] of Object.entries(v2.log)) v2.pending = stampOps(v2.pending, date, h);
      return v2;
    }
  } catch {}
  return blank();
}

function loadCfg() {
  let c = {};
  try {
    c = JSON.parse(localStorage.getItem(CFG_KEY)) || {};
  } catch {}
  const fromUrl = new URLSearchParams(location.search).get('api');
  if (fromUrl) {
    c.apiUrl = fromUrl.trim();
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
    history.replaceState(null, '', location.pathname);
  }
  if (!c.apiUrl && DEFAULT_API_URL) c.apiUrl = DEFAULT_API_URL;
  return c;
}

const persist = () => localStorage.setItem(STATE_KEY, JSON.stringify(state));
const emit = () => listeners.forEach((fn) => fn());

export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const getState = () => state;
export const getSync = () => sync;
export const getApiUrl = () => cfg.apiUrl || '';

function setSync(patch) {
  sync = { ...sync, ...patch };
  emit();
}

function commit(next, { remoteState = true } = {}) {
  state = { ...state, ...next, updatedAt: Date.now() };
  if (remoteState) state.dirty = true;
  persist();
  emit();
  scheduleFlush();
}

// ---- the day being viewed/recorded (this device only) --------------------

export const getViewDate = () => viewDate || L.localDate();
export const isToday = () => getViewDate() === L.localDate();
export function setViewDate(date) {
  viewDate = !date || date >= L.localDate() ? null : date;
  emit();
}

export const dayHistory = (date = getViewDate()) => state.log[date] || [];

// ---- per-day sync ---------------------------------------------------------

/** Replace any queued write for this day with one that mirrors its current results. */
function stampOps(pending, date, history) {
  const rest = pending.filter(
    (p) => !(p.session === date && (p.action === 'stamp' || p.action === 'unstamp') && p !== inflight),
  );
  if (!history.length) return [...rest, { action: 'unstamp', session: date }];
  const { days, matches } = L.dayRows(date, history);
  return [...rest, { action: 'stamp', session: date, days, matches }];
}

function withDay(log, date, history) {
  const next = { ...log };
  if (history.length) next[date] = history;
  else delete next[date];
  return next;
}

/** Change one day's results; undoable. `match` replaces the lineup when given. */
function setDay(date, history, match) {
  const entry = { date, history: dayHistory(date), match: state.live.match };
  commit({
    log: withDay(state.log, date, history),
    pending: stampOps(state.pending, date, history),
    undo: [...state.undo, entry].slice(-UNDO_LIMIT),
    ...(match !== undefined && { live: { ...state.live, match } }),
  });
}

const session = (date = getViewDate()) => ({
  date,
  present: state.live.present,
  seen: [],
  match: state.live.match,
  history: dayHistory(date),
});

// ---- results (undoable) ----------------------------------------------------

export function win(sideIdx) {
  const s = session();
  const next = L.recordWin(s, sideIdx);
  if (next !== s) setDay(s.date, next.history, next.match);
}

/** Change who won a recorded match. Fixing the latest result today re-picks the next lineup. */
export function setWinner(date, idx, sideIdx) {
  const h = dayHistory(date);
  if (!h[idx] || h[idx].win === sideIdx) return;
  const history = h.map((m, i) => (i === idx ? { ...m, win: sideIdx } : m));
  const replan = date === getViewDate() && idx === h.length - 1;
  setDay(date, history, replan ? L.planMatch(state.live.present, history) : undefined);
}

export function deleteMatch(date, idx) {
  const h = dayHistory(date);
  if (!h[idx]) return;
  setDay(
    date,
    h.filter((_, i) => i !== idx),
  );
}

export const canUndo = () => state.undo.length > 0;

export function undo() {
  const e = state.undo.at(-1);
  if (!e) return;
  const live = e.match
    ? {
        present: [...new Set([...state.live.present, ...L.onCourt(e.match), ...e.match.out])],
        match: e.match,
      }
    : state.live;
  commit({
    undo: state.undo.slice(0, -1),
    log: withDay(state.log, e.date, e.history),
    pending: stampOps(state.pending, e.date, e.history),
    live,
  });
}

/** Delete whole days (local log and the sheet). Not undoable. */
export function deleteDays(dates) {
  const drop = new Set(dates);
  let log = state.log;
  let pending = state.pending;
  for (const d of drop) {
    log = withDay(log, d, []);
    pending = stampOps(pending, d, []);
  }
  const legacy = state.legacy.filter((r) => !drop.has(r.date));
  for (const id of new Set(state.legacy.filter((r) => drop.has(r.date)).map((r) => r.session))) {
    if (!drop.has(id)) pending = [...pending, { action: 'unstamp', session: id }];
  }
  commit({ log, pending, legacy, undo: state.undo.filter((e) => !drop.has(e.date)) });
}

// ---- lineup (not undoable) -------------------------------------------------

export function togglePlayer(name) {
  const s = session();
  const next = L.setPresent(s, name, !s.present.includes(name));
  if (next !== s) commit({ live: { present: next.present, match: next.match } });
}

function withMatch(match) {
  if (match === state.live.match) return false;
  commit({ live: { ...state.live, match } });
  return true;
}

export const swap = (a, b) => withMatch(L.swapPlayers(state.live.match, a, b, dayHistory()));
export const bench = (name) => withMatch(L.benchPlayer(state.live.match, name, dayHistory()));
export const unbench = (name) => withMatch(L.unbenchPlayer(state.live.match, name, dayHistory()));
export const reshuffle = () => withMatch(L.reshuffle(state.live.match, dayHistory()));

// ---- stats ------------------------------------------------------------------

const rowToDay = (r) => ({
  date: r[0],
  session: r[1],
  player: r[2],
  played: +r[3],
  wins: +r[4],
  losses: +r[5],
  out: +r[6],
});

/** Days rows without a log don't carry a match count; whoever stayed all session played or sat every match. */
function legacyMatches(rows) {
  const most = {};
  for (const r of rows) most[r.session] = Math.max(most[r.session] || 0, (+r.played || 0) + (+r.out || 0));
  return Object.values(most).reduce((a, b) => a + b, 0);
}

/** Every day with results, newest first: { date, rows (per player), history (null for legacy), matches }. */
export function allDays() {
  const days = Object.entries(state.log).map(([date, history]) => ({
    date,
    history,
    rows: L.dayRows(date, history).days.map(rowToDay),
    matches: history.length,
  }));
  const logged = new Set(Object.keys(state.log));
  const legacy = {};
  for (const r of state.legacy) if (!logged.has(r.date)) (legacy[r.date] ||= []).push(r);
  for (const [date, rows] of Object.entries(legacy))
    days.push({ date, history: null, rows, matches: legacyMatches(rows) });
  return days.sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ---- settings -----------------------------------------------------------------

export function setRoster(roster) {
  const clean = [...new Set(roster.map((n) => n.trim()).filter(Boolean))];
  commit(
    {
      roster: clean,
      pending: [...state.pending.filter((p) => p.action !== 'roster'), { action: 'roster', roster: clean }],
    },
    { remoteState: false },
  );
}

export function setApiUrl(url) {
  cfg = { ...cfg, apiUrl: url.trim() };
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
  setSync({ status: cfg.apiUrl ? 'idle' : 'local', error: '' });
  if (cfg.apiUrl) {
    state = { ...state, dirty: true };
    pull();
  }
}

// ---- Google Sheet sync (Apps Script web app) -----------------------------

async function call(body) {
  const url = cfg.apiUrl;
  const res = body
    ? await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      })
    : await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Sheet error');
  return json;
}

function adoptRemote(remote) {
  const next = {};
  const pendingSessions = (action) =>
    new Set(state.pending.filter((p) => p.action === action).map((p) => p.session));
  if (Array.isArray(remote.days)) {
    const stamps = pendingSessions('stamp');
    const unstamps = pendingSessions('unstamp');
    next.legacy = [
      ...remote.days.filter((d) => !unstamps.has(d.session) && !stamps.has(d.session)),
      ...state.legacy.filter((d) => stamps.has(d.session)),
    ];
  }
  if (remote.roster?.length && !state.pending.some((p) => p.action === 'roster')) next.roster = remote.roster;
  const rs = remote.state;
  const data = rs?.data;
  if (data && rs.updatedAt > state.updatedAt && !state.dirty) {
    if (data.log) {
      next.log = data.log;
      next.live = data.live || blankLive();
      next.undo = data.undo || [];
    } else if (data.session) {
      Object.assign(next, fromV1(data.session), { undo: [] });
    }
    next.updatedAt = rs.updatedAt;
  }
  state = { ...state, ...next };
  persist();
  emit();
}

export async function pull() {
  if (!cfg.apiUrl) return;
  try {
    setSync({ status: 'syncing' });
    adoptRemote(await call());
    setSync({ status: 'idle', error: '' });
    if (state.dirty || state.pending.length) scheduleFlush(0);
  } catch (err) {
    setSync({ status: 'error', error: String(err.message || err) });
  }
}

function scheduleFlush(delay = 400) {
  if (!cfg.apiUrl) return;
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, delay);
}

export function flush() {
  if (!cfg.apiUrl) return Promise.resolve();
  if (!flushing) {
    flushing = drain().finally(() => {
      flushing = null;
      inflight = null;
    });
  }
  return flushing;
}

async function drain() {
  try {
    setSync({ status: 'syncing' });
    while (state.pending.length || state.dirty) {
      if (state.pending.length) {
        inflight = state.pending[0];
        await call(inflight);
        state = { ...state, pending: state.pending.filter((p) => p !== inflight) };
        inflight = null;
        persist();
        continue;
      }
      state = { ...state, dirty: false };
      persist();
      const res = await call({
        action: 'saveState',
        updatedAt: state.updatedAt,
        state: { log: state.log, live: state.live, undo: state.undo },
      });
      if (res.stale && res.state) adoptRemote(res);
    }
    setSync({ status: 'idle', error: '' });
  } catch (err) {
    state = { ...state, dirty: true };
    persist();
    setSync({ status: 'error', error: String(err.message || err) });
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 15000);
  }
}

addEventListener('online', () => scheduleFlush(0));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !state.dirty && !state.pending.length) pull();
});
