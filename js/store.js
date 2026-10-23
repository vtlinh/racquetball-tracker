import * as L from './logic.js';
import { DEFAULT_API_URL } from './config.js';

const STATE_KEY = 'rb.state.v1';
const CFG_KEY = 'rb.cfg.v1';
const UNDO_LIMIT = 500;

const listeners = new Set();
let state = loadLocal();
let cfg = loadCfg();
let sync = { status: cfg.apiUrl ? 'idle' : 'local', error: '' };
let flushing = null;
let inflight = null;
let flushTimer = 0;

function loadLocal() {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY));
    if (s && s.session) return { pending: [], dirty: false, days: [], undo: [], ...s };
  } catch {}
  return {
    roster: [...L.DEFAULT_ROSTER],
    session: L.newSession(),
    undo: [],
    days: [],
    updatedAt: 0,
    pending: [],
    dirty: false,
  };
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

function snapshot(kind = 'step', extra = {}) {
  const { history, ...rest } = state.session;
  const entry = kind === 'step' ? { s: rest, h: history.length } : { full: state.session, ...extra };
  return [...state.undo, entry].slice(-UNDO_LIMIT);
}

function act(nextSession, extra = {}) {
  if (nextSession === state.session) return;
  commit({ undo: snapshot(), session: nextSession, ...extra });
}

// ---- actions ------------------------------------------------------------

export const togglePlayer = (name) =>
  act(L.setPresent(state.session, name, !state.session.present.includes(name)));

export const win = (sideIdx) => act(L.recordWin(state.session, sideIdx));

const withMatch = (match) => match !== state.session.match && act({ ...state.session, match });

export const swap = (a, b) => withMatch(L.swapPlayers(state.session.match, a, b));
export const bench = (name) => withMatch(L.benchPlayer(state.session.match, name, state.session.history));
export const unbench = (name) => withMatch(L.unbenchPlayer(state.session.match, name, state.session.history));
export const reshuffle = () => withMatch(L.reshuffle(state.session.match, state.session.history));

export function done() {
  const s = state.session;
  if (!s.history.length) return false;
  const { days, matches } = L.dayRows(s);
  const dayObjs = days.map(rowToDay);
  commit({
    undo: snapshot('full', { unstamp: s.id }),
    session: L.newSession(),
    days: [...state.days.filter((d) => d.session !== s.id), ...dayObjs],
    pending: [...state.pending, { action: 'stamp', session: s.id, days, matches }],
  });
  return true;
}

export function reset() {
  const keep = state.session.present;
  let session = L.newSession();
  for (const p of keep) session = L.setPresent(session, p, true);
  commit({ undo: snapshot('full'), session });
}

export const canUndo = () => state.undo.length > 0;

export function undo() {
  if (!state.undo.length) return;
  const undoStack = [...state.undo];
  const e = undoStack.pop();
  const next = { undo: undoStack };
  if (e.full) {
    next.session = e.full;
    if (e.unstamp) {
      next.days = state.days.filter((d) => d.session !== e.unstamp);
      const stampQueued = state.pending.some(
        (p) => p.action === 'stamp' && p.session === e.unstamp && p !== inflight,
      );
      next.pending = stampQueued
        ? state.pending.filter((p) => p.session !== e.unstamp)
        : [...state.pending, { action: 'unstamp', session: e.unstamp }];
    }
  } else {
    next.session = { ...e.s, history: state.session.history.slice(0, e.h) };
  }
  commit(next);
}

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

const rowToDay = (r) => ({
  date: r[0],
  session: r[1],
  player: r[2],
  played: +r[3],
  wins: +r[4],
  losses: +r[5],
  out: +r[6],
});

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
    const localOnly = state.days.filter((d) => stamps.has(d.session));
    next.days = [
      ...remote.days.filter((d) => !unstamps.has(d.session) && !stamps.has(d.session)),
      ...localOnly,
    ];
  }
  if (remote.roster?.length && !state.pending.some((p) => p.action === 'roster')) next.roster = remote.roster;
  const rs = remote.state;
  if (rs?.data?.session && rs.updatedAt > state.updatedAt && !state.dirty) {
    next.session = rs.data.session;
    next.undo = rs.data.undo || [];
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
        state: { session: state.session, undo: state.undo },
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
