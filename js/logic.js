// Pure lineup logic. No DOM, no storage; `rng` is injectable for tests.

export const DEFAULT_ROSTER = ['Rick', 'Leo', 'Linh', 'Nate', 'Doug'];
export const MAX_ON_COURT = 4;

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function newSession() {
  return { id: uid(), date: localDate(), present: [], seen: [], match: null, history: [] };
}

export const modeOf = (sides) =>
  !sides ? '' : sides.length === 3 ? '3way' : sides[0].length === 2 ? '2v2' : '1v1';

export const winnersOf = (m) => m.sides[m.win];
export const losersOf = (m) => m.sides.filter((_, i) => i !== m.win).flat();
export const onCourt = (match) => (match ? match.sides.flat() : []);

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const teamKey = (team) => [...team].sort().join('+');
const matchupKey = (sides) => sides.map(teamKey).sort().join(' v ');

export function playerStats(history, names = []) {
  const s = {};
  const get = (n) => (s[n] ??= { played: 0, wins: 0, losses: 0, out: 0 });
  names.forEach(get);
  for (const m of history) {
    m.sides.forEach((side, i) =>
      side.forEach((p) => {
        const r = get(p);
        r.played++;
        if (i === m.win) r.wins++;
        else r.losses++;
      }),
    );
    (m.out || []).forEach((p) => get(p).out++);
  }
  return s;
}

export function pairCounts(history) {
  const pc = {};
  const mc = {};
  for (const m of history) {
    if (modeOf(m.sides) !== '2v2') continue;
    for (const [a, b] of m.sides) pc[pairKey(a, b)] = (pc[pairKey(a, b)] || 0) + 1;
    const k = matchupKey(m.sides);
    mc[k] = (mc[k] || 0) + 1;
  }
  return { pc, mc };
}

/** The last result's winning pair (2v2 only) — they must not be teammates next. */
export function blockedPair(history) {
  const last = history.at(-1);
  if (!last || modeOf(last.sides) !== '2v2') return null;
  return winnersOf(last);
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...rest] = arr;
  return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)];
}

const isBlocked = (team, blocked) =>
  !!blocked && team.length === 2 && team.includes(blocked[0]) && team.includes(blocked[1]);

/** All legal side arrangements for the given on-court players, each with a score (lower = better). */
export function arrangements(active, history) {
  if (active.length < 2) return [];
  if (active.length !== 4) return [{ sides: active.map((p) => [p]), score: 0 }];
  const { pc, mc } = pairCounts(history);
  const blocked = blockedPair(history);
  const [a, b, c, d] = active;
  return [
    [
      [a, b],
      [c, d],
    ],
    [
      [a, c],
      [b, d],
    ],
    [
      [a, d],
      [b, c],
    ],
  ]
    .filter((sides) => !sides.some((t) => isBlocked(t, blocked)))
    .map((sides) => ({
      sides,
      score:
        (pc[pairKey(...sides[0])] || 0) +
        (pc[pairKey(...sides[1])] || 0) +
        0.1 * (mc[matchupKey(sides)] || 0),
    }));
}

function pickBest(options, rng) {
  if (!options.length) return null;
  const min = Math.min(...options.map((o) => o.score));
  const best = options.filter((o) => o.score - min < 1e-9);
  return best[Math.floor(rng() * best.length)];
}

/**
 * Sit-out priority (first = sits out first):
 *   1. losers of the last match (winners stay on, per the house rule),
 *   2. everyone else except the last winners,
 *   3. the last winners;
 * within a tier, whoever has played the most today sits first, then whoever has sat out least.
 */
function sitOutKey(p, st, history) {
  const last = history.at(-1);
  let tier = 1;
  if (last) {
    if (losersOf(last).includes(p)) tier = 0;
    else if (winnersOf(last).includes(p)) tier = 2;
  }
  const r = st[p] || { played: 0, out: 0 };
  return [tier, -r.played, r.out];
}

const cmpKey = (x, y) => {
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

/** Choose who sits out and how the rest are split, given who is present. */
export function planMatch(present, history, rng = Math.random) {
  if (present.length < 2) return null;
  const outCount = Math.max(0, present.length - MAX_ON_COURT);
  const st = playerStats(history, present);

  let outChoices = [[]];
  if (outCount > 0) {
    const ranked = shuffle(present, rng)
      .map((p) => ({ p, k: sitOutKey(p, st, history) }))
      .sort((x, y) => cmpKey(x.k, y.k));
    const boundary = ranked[outCount - 1].k;
    const fixed = ranked.filter((r) => cmpKey(r.k, boundary) < 0).map((r) => r.p);
    const tied = ranked.filter((r) => cmpKey(r.k, boundary) === 0).map((r) => r.p);
    outChoices = combinations(tied, outCount - fixed.length).map((c) => [...fixed, ...c]);
  }

  const options = outChoices.flatMap((out) => {
    const active = shuffle(
      present.filter((p) => !out.includes(p)),
      rng,
    );
    return arrangements(active, history).map((a) => ({ ...a, out }));
  });
  const best = pickBest(options, rng);
  return best && { sides: best.sides, out: best.out };
}

/** Re-split the current on-court players into a different legal arrangement, keeping the bench. */
export function reshuffle(match, history, rng = Math.random) {
  if (!match) return match;
  const active = onCourt(match);
  const current = matchupKey(match.sides);
  const all = arrangements(shuffle(active, rng), history);
  const others = all.filter((a) => matchupKey(a.sides) !== current);
  const pick = pickBest(others.length ? others : all, rng);
  return pick ? { sides: pick.sides, out: [...match.out] } : match;
}

/** Rebuild sides after the on-court set changed by one (manual bench/unbench). */
function reshape(active, prevSides, history, rng) {
  if (active.length < 2) return null;
  if (active.length === 4) {
    const keep = prevSides && prevSides.length === 2 && prevSides.every((t) => t.length === 2);
    if (keep && active.every((p) => prevSides.flat().includes(p))) return prevSides;
    return pickBest(arrangements(shuffle(active, rng), history), rng).sides;
  }
  return active.map((p) => [p]);
}

export function benchPlayer(match, name, history, rng = Math.random) {
  if (!match || !onCourt(match).includes(name)) return match;
  const active = onCourt(match).filter((p) => p !== name);
  if (active.length < 2) return match;
  return { sides: reshape(active, null, history, rng), out: [...match.out, name] };
}

export function unbenchPlayer(match, name, history, rng = Math.random) {
  if (!match || !match.out.includes(name)) return match;
  const active = onCourt(match);
  if (active.length >= MAX_ON_COURT) return match;
  return {
    sides: reshape([...active, name], null, history, rng),
    out: match.out.filter((p) => p !== name),
  };
}

/**
 * Swap two players' spots. Court<->bench changes who plays, so the teams are re-picked (never just
 * the newcomer dropped into the old spot when another legal split exists). Court<->court swaps that
 * would team up the last winning pair are refused (the same match is returned).
 */
export function swapPlayers(match, a, b, history = [], rng = Math.random) {
  if (!match || a === b) return match;
  const sw = (p) => (p === a ? b : p === b ? a : p);
  const swapped = { sides: match.sides.map((t) => t.map(sw)), out: match.out.map(sw) };
  const benchChanged = match.out.includes(a) !== match.out.includes(b);
  if (benchChanged) {
    const active = onCourt(swapped);
    if (active.length !== 4) return swapped;
    const inPlace = matchupKey(swapped.sides);
    const all = arrangements(shuffle(active, rng), history);
    const fresh = all.filter((o) => matchupKey(o.sides) !== inPlace);
    const pick = pickBest(fresh.length ? fresh : all, rng);
    return pick ? { sides: pick.sides, out: swapped.out } : swapped;
  }
  const blocked = blockedPair(history);
  return swapped.sides.some((t) => isBlocked(t, blocked)) ? match : swapped;
}

export function recordWin(session, sideIdx, rng = Math.random, now = Date.now()) {
  const m = session.match;
  if (!m || sideIdx < 0 || sideIdx >= m.sides.length) return session;
  const history = [...session.history, { sides: m.sides, out: m.out, win: sideIdx, t: now }];
  return { ...session, history, match: planMatch(session.present, history, rng) };
}

export function setPresent(session, name, isPresent, rng = Math.random) {
  const has = session.present.includes(name);
  if (has === isPresent) return session;
  const present = isPresent ? [...session.present, name] : session.present.filter((p) => p !== name);
  const seen = session.seen.includes(name) || !isPresent ? session.seen : [...session.seen, name];
  const date = session.present.length || session.history.length ? session.date : localDate();
  return { ...session, date, present, seen, match: planMatch(present, session.history, rng) };
}

const EASTERN = 'America/New_York';

/**
 * Wall clock of a win's real timestamp (epoch ms) in Eastern Time.
 * 'hhmm' is 24-hour "13:30" for the sheet; the default is "1:30 PM" for the UI.
 * Missing or non-positive values return ''.
 */
export function formatTimeET(ms, kind = 'label') {
  const n = +ms;
  if (!Number.isFinite(n) || n <= 0) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(n));
  const hh = parts.find((p) => p.type === 'hour')?.value;
  const mm = parts.find((p) => p.type === 'minute')?.value;
  if (hh == null || mm == null) return '';
  let h = Number(hh);
  if (h === 24) h = 0;
  if (kind === 'hhmm') return `${String(h).padStart(2, '0')}:${mm}`;
  return `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Rows for the Days and Matches tabs. A day's rows are keyed by its date (the Session column). */
export function dayRows(date, history, stampedAt = new Date().toISOString()) {
  const names = [...new Set(history.flatMap((m) => [...m.sides.flat(), ...(m.out || [])]))];
  const st = playerStats(history, names);
  const days = names.map((p) => {
    const r = st[p];
    return [date, date, p, r.played, r.wins, r.losses, r.out, stampedAt];
  });
  const matches = history.map((m, i) => {
    const sides = m.sides.map((t) => t.join('+'));
    return [
      date,
      date,
      i + 1,
      modeOf(m.sides),
      sides[0] || '',
      sides[1] || '',
      sides[2] || '',
      sides[m.win],
      (m.out || []).join('+'),
      formatTimeET(m.t, 'hhmm'),
    ];
  });
  return { days, matches };
}

/** Aggregate stamped Days rows ({date, player, played, wins, losses, out}) by a date prefix. */
export function aggregate(rows, prefix) {
  const by = {};
  for (const r of rows) {
    if (prefix && !String(r.date).startsWith(prefix)) continue;
    const a = (by[r.player] ??= { player: r.player, days: 0, played: 0, wins: 0, losses: 0, out: 0 });
    a.days++;
    a.played += +r.played || 0;
    a.wins += +r.wins || 0;
    a.losses += +r.losses || 0;
    a.out += +r.out || 0;
  }
  return Object.values(by).sort(
    (x, y) => winPct(y) - winPct(x) || y.wins - x.wins || x.player.localeCompare(y.player),
  );
}

export const winPct = (r) => (r.played ? r.wins / r.played : 0);

/**
 * Crown: most wins, then fewest losses. Poop: most losses, then fewest wins.
 * A tie that survives the tiebreak names no one; someone holding both keeps only the crown.
 */
export const dayStars = (history) =>
  starsOf(Object.entries(playerStats(history)).map(([player, r]) => ({ player, ...r })));

/** Same as dayStars, from per-player totals ({ player, played, wins, losses }). */
export function starsOf(records) {
  const ranked = records.filter((r) => r.played).map((r) => ({ p: r.player, w: r.wins, l: r.losses }));
  if (ranked.length < 2) return { crown: null, poop: null };
  const outright = (key) => {
    const [a, b] = [...ranked].sort((x, y) => cmpKey(key(x), key(y)));
    return cmpKey(key(a), key(b)) === 0 ? null : a.p;
  };
  const crown = outright((r) => [-r.w, r.l]);
  const poop = outright((r) => [-r.l, r.w]);
  return { crown, poop: poop === crown ? null : poop };
}
