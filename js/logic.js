// Pure lineup logic. No DOM, no storage; `rng` is injectable for tests.

export const DEFAULT_ROSTER = ['Rick', 'Leo', 'Linh', 'Nate', 'Doug'];
export const MAX_ON_COURT = 4;

/** 24 Hour Fitness, 260 Route 4, Paramus. Restaurant distance is measured from here. */
export const GYM = { lat: 40.913763, lng: -74.049378 };

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const EASTERN = 'America/New_York';

/** Calendar date in Eastern Time, `YYYY-MM-DD`. Evening games stay on that ET day. */
export function localDate(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Add calendar days to a `YYYY-MM-DD` date. */
export function addDays(date, n) {
  const [y, m, d] = String(date).split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + n));
  const p = (x) => String(x).padStart(2, '0');
  return `${utc.getUTCFullYear()}-${p(utc.getUTCMonth() + 1)}-${p(utc.getUTCDate())}`;
}

/** Weights a restaurant can have. 5 is picked most often. */
export const MEAL_WEIGHTS = [1, 2, 3, 4, 5];

function placeFields(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const address = String(raw.address || '').trim().replace(/\s+/g, ' ').slice(0, 180);
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  const extra = {};
  if (address) extra.address = address;
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    extra.lat = Math.round(lat * 1e6) / 1e6;
    extra.lng = Math.round(lng * 1e6) / 1e6;
  }
  return extra;
}

/** Trimmed restaurant names, first spelling kept, later case-duplicates dropped.
    A plain string weighs 1. Anything outside 1–5 becomes 1. A removed place stays in the
    list so its weight and scores can come back. An address is kept when one was picked. */
export function cleanRestaurants(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const name = String(raw?.name ?? raw ?? '').trim().replace(/\s+/g, ' ');
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const weight = Math.round(Number(raw?.weight));
    const entry = { name, weight: MEAL_WEIGHTS.includes(weight) ? weight : 1, ...placeFields(raw) };
    if (raw?.removed) entry.removed = true;
    out.push(entry);
  }
  return out;
}

/** Hide a place without dropping its weight or address. Scores stored for that name stay put. */
export function withoutRestaurant(list, name) {
  const key = String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return cleanRestaurants(list).map((r) => (r.name.toLocaleLowerCase() === key ? { ...r, removed: true } : r));
}

/** Add a place, or bring back one that was removed, with its previous weight. */
export function withRestaurant(list, place) {
  const raw = typeof place === 'string' ? { name: place } : place || {};
  const trimmed = String(raw.name || '').trim().replace(/\s+/g, ' ');
  const key = trimmed.toLocaleLowerCase();
  const clean = cleanRestaurants(list);
  if (!key) return clean;
  const existing = clean.find((r) => r.name.toLocaleLowerCase() === key);
  const picked = placeFields(raw);
  if (!existing) return cleanRestaurants([...clean, { name: trimmed, weight: 1, ...picked }]);
  if (!existing.removed) return clean;
  const next = { name: existing.name, weight: existing.weight, ...placeFields(existing) };
  if (picked.address) {
    next.address = picked.address;
    delete next.lat;
    delete next.lng;
    if (picked.lat != null) {
      next.lat = picked.lat;
      next.lng = picked.lng;
    }
  }
  return clean.map((r) => (r === existing ? next : r));
}

/** Replace the address of a place already on the list. The name and score stay. */
export function updateRestaurantAddress(list, name, place) {
  const key = String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const picked = placeFields(place);
  if (!key || !picked.address) return cleanRestaurants(list);
  return cleanRestaurants(list).map((r) => {
    if (r.name.toLocaleLowerCase() !== key) return r;
    const next = { name: r.name, weight: r.weight, address: picked.address };
    if (r.removed) next.removed = true;
    if (picked.lat != null) {
      next.lat = picked.lat;
      next.lng = picked.lng;
    }
    return next;
  });
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const lat1 = a.lat * rad;
  const lat2 = b.lat * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Street and city from a Photon place, when the search result has them. */
export function formatPlaceAddress(props = {}) {
  const street = [props.housenumber, props.street].filter(Boolean).join(' ');
  const city = props.city || props.town || props.village || props.locality || '';
  const region = props.state || '';
  return [street, [city, region].filter(Boolean).join(', ')].filter(Boolean).join(', ');
}

/** Named places from a Photon response. With a location, the nearest one is first.
    The same name at the same address is listed once. */
export function placesFromPhoton(features, here) {
  const found = [];
  for (const feature of features || []) {
    const props = feature?.properties || {};
    const name = String(props.name || '').trim().replace(/\s+/g, ' ');
    const [lng, lat] = feature?.geometry?.coordinates || [];
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const place = { name, lat, lng };
    const address = formatPlaceAddress(props);
    if (address) place.address = address;
    if (here) place.km = distanceKm(here, place);
    found.push(place);
  }
  if (here) found.sort((a, b) => a.km - b.km || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const out = [];
  const seen = new Set();
  for (const place of found) {
    const where = place.address
      ? place.address.toLocaleLowerCase()
      : `${place.lat.toFixed(3)},${place.lng.toFixed(3)}`;
    const key = `${place.name.toLocaleLowerCase()}|${where}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }
  return out;
}

/** Place predictions from Google, in the order Google returned them.
    The same name at the same address is listed once. `distanceMeters` becomes kilometers. */
export function placesFromGoogle(predictions) {
  const out = [];
  const seen = new Set();
  for (const raw of predictions || []) {
    const name = String(raw?.name || '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const address = String(raw?.address || '').trim().replace(/\s+/g, ' ');
    const where = address ? address.toLocaleLowerCase() : String(raw?.placeId || name).toLocaleLowerCase();
    const key = `${name.toLocaleLowerCase()}|${where}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const place = { name };
    if (address) place.address = address;
    const meters = Number(raw?.distanceMeters);
    if (Number.isFinite(meters)) place.km = meters / 1000;
    if (raw?.placeId) place.placeId = raw.placeId;
    out.push(place);
  }
  return out;
}

const REGION =
  /^(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)(?:\s+\d{5}(?:-\d{4})?)?$/i;
const REGION_NAMES = new Set([
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware',
  'district of columbia', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa',
  'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota',
  'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey',
  'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon',
  'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah',
  'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming',
]);

function isRegion(part) {
  return REGION.test(part) || REGION_NAMES.has(part.toLowerCase());
}

/** City from a saved place address, such as Fort Lee in "799 Abbott Blvd, Fort Lee, NJ 07024, USA". */
export function placeCity(address) {
  let parts = String(address || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (/^(?:usa|u\.s\.a\.|us|united states(?: of america)?)$/i.test(parts.at(-1) || '')) parts = parts.slice(0, -1);
  if (parts.length < 2) return '';
  const last = parts[parts.length - 1];
  return isRegion(last) ? parts[parts.length - 2] : last;
}

export function formatMiles(km) {
  const mi = Number(km) * 0.621371;
  if (!Number.isFinite(mi)) return '';
  if (mi < 10) return `${(Math.round(mi * 10) / 10).toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

/** A link that opens the maps app at this place. `platform` is ios, android, or web. */
export function mapsUrl(place, platform) {
  const fields = placeFields(place);
  const name = String(place?.name || '').trim();
  if (!fields.address && fields.lat == null) return '';
  if (platform === 'ios') {
    if (fields.lat != null) return `https://maps.apple.com/?ll=${fields.lat},${fields.lng}&q=${encodeURIComponent(name || fields.address)}`;
    return `https://maps.apple.com/?q=${encodeURIComponent(fields.address)}`;
  }
  if (platform === 'android') {
    if (fields.lat != null) return `geo:${fields.lat},${fields.lng}?q=${fields.lat},${fields.lng}(${encodeURIComponent(name || fields.address)})`;
    return `geo:0,0?q=${encodeURIComponent(fields.address)}`;
  }
  const query = fields.lat != null ? `${fields.lat},${fields.lng}` : fields.address;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** A fixed number from the first game day's date. The same day always seeds the same sequence. */
function seedFromDay(date) {
  let n = 0xa5c39e17;
  for (let i = 0; i < date.length; i++) n = Math.imul(n ^ date.charCodeAt(i), 0x5bd1e995);
  return n >>> 0;
}

function nextRand(n) {
  n = Math.imul(n ^ (n >>> 15), 0x27bb2ee6);
  n = Math.imul(n ^ (n >>> 13), 0x165667b1);
  return (n ^ (n >>> 16)) >>> 0;
}

/** One weight per person per restaurant still on the list. Blank and out-of-range picks are dropped. */
export function cleanMealPicks(picks, restaurants) {
  const list = cleanRestaurants(restaurants);
  const byKey = new Map(list.map((r) => [r.name.toLocaleLowerCase(), r.name]));
  const out = {};
  const seen = new Set();
  for (const [person, weights] of Object.entries(picks || {})) {
    const who = String(person).trim().replace(/\s+/g, ' ');
    const key = who.toLocaleLowerCase();
    if (!who || seen.has(key) || !weights || typeof weights !== 'object') continue;
    seen.add(key);
    const mine = {};
    for (const [rawName, rawWeight] of Object.entries(weights)) {
      const canonical = byKey.get(String(rawName).trim().replace(/\s+/g, ' ').toLocaleLowerCase());
      const weight = Math.round(Number(rawWeight));
      if (!canonical || !MEAL_WEIGHTS.includes(weight)) continue;
      mine[canonical] = weight;
    }
    if (Object.keys(mine).length) out[who] = mine;
  }
  return out;
}

/** Name → browser id. The first spelling and the first browser for a name win. */
export function cleanClaims(claims) {
  const out = {};
  const names = new Set();
  const devices = new Set();
  for (const [person, device] of Object.entries(claims || {})) {
    const who = String(person).trim().replace(/\s+/g, ' ');
    const id = String(device || '').trim();
    const key = who.toLocaleLowerCase();
    if (!who || !id || names.has(key) || devices.has(id)) continue;
    names.add(key);
    devices.add(id);
    out[who] = id;
  }
  return out;
}

/** Claim `name` for this browser. A name another browser already holds is refused. */
export function nextClaims(claims, roster, name, deviceId) {
  const clean = cleanClaims(claims);
  const id = String(deviceId || '').trim();
  const wanted = String(name || '').trim().replace(/\s+/g, ' ');
  const match = (roster || []).find((n) => n.toLocaleLowerCase() === wanted.toLocaleLowerCase());
  if (!id || !match) return { ok: false, claims: clean };
  const holder = Object.entries(clean).find(([n]) => n.toLocaleLowerCase() === match.toLocaleLowerCase());
  if (holder && holder[1] !== id) return { ok: false, claims: clean };
  const next = {};
  for (const [n, dev] of Object.entries(clean)) if (dev !== id) next[n] = dev;
  next[match] = id;
  return { ok: true, claims: next };
}

/** Drop this browser's claim. The name is free for someone else. */
export function releaseClaims(claims, deviceId) {
  const id = String(deviceId || '').trim();
  const clean = cleanClaims(claims);
  const next = {};
  let who = '';
  for (const [n, dev] of Object.entries(clean)) {
    if (dev === id) who = n;
    else next[n] = dev;
  }
  return { who, claims: next };
}

function votesFor(restaurant, picks) {
  const key = restaurant.toLocaleLowerCase();
  const votes = [];
  for (const weights of Object.values(picks || {})) {
    for (const [name, weight] of Object.entries(weights || {})) {
      if (name.toLocaleLowerCase() === key) votes.push(weight);
    }
  }
  return votes;
}

function weightParts(entry, picks) {
  const votes = votesFor(entry.name, picks);
  if (!votes.length) return [entry.weight, 1];
  return [votes.reduce((sum, w) => sum + w, 0), votes.length];
}

/** The weight used for ranking: the average of personal picks, or the list weight when nobody picked. */
export function restaurantWeight(entry, picks = {}) {
  const [num, den] = weightParts(entry, cleanMealPicks(picks, [entry]));
  return num / den;
}

/** One decimal only when the average is not a whole number. */
export function formatWeight(n) {
  const v = Math.round(+n * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Highest weight first. Equal weights are ordered by name. Removed places stay out. */
export function rankedRestaurants(list, picks = {}) {
  const entries = cleanRestaurants(list).filter((r) => !r.removed);
  const votes = cleanMealPicks(picks, entries);
  return [...entries].sort((a, b) => {
    const [an, ad] = weightParts(a, votes);
    const [bn, bd] = weightParts(b, votes);
    const byRank = bn * ad - an * bd;
    if (byRank) return byRank;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function chooseRestaurant(entries, prev, n, picks) {
  let choices = entries.length > 1 && prev ? entries.filter((e) => e.name !== prev) : entries;
  if (!choices.length) choices = entries;
  const parts = choices.map((entry) => {
    const votes = votesFor(entry.name, picks);
    const weight = votes.length ? votes.reduce((sum, w) => sum + w, 0) / votes.length : entry.weight;
    return { name: entry.name, weight };
  });
  const total = parts.reduce((sum, part) => sum + part.weight, 0);
  let roll = (n / 4294967296) * total;
  for (const part of parts) {
    if (roll < part.weight) return part.name;
    roll -= part.weight;
  }
  return parts[parts.length - 1].name;
}

/** The place for `date`. `gameDays` are dates that already have games.
    The first game day seeds the sequence. Each later game day calls next() once.
    A day with no games is not a step, so it does not move the days after it.
    A higher weight is picked more often. Personal picks average together, and a name
    that did not pick counts as that average. The list weight is used when nobody picked.
    The next game day gets a different place unless the list has only one. */
export function restaurantFor(date, list, gameDays = [], picks = {}) {
  const entries = rankedRestaurants(list, picks);
  const votes = cleanMealPicks(picks, entries);
  if (!entries.length) return '';
  if (entries.length === 1) return entries[0].name;
  const days = [...new Set((gameDays || []).filter((d) => d && d < date))].sort();
  days.push(date);
  let n = seedFromDay(days[0]);
  let prev = '';
  let pick = chooseRestaurant(entries, prev, n, votes);
  for (let i = 1; i < days.length; i++) {
    n = nextRand(n);
    prev = pick;
    pick = chooseRestaurant(entries, prev, n, votes);
  }
  return pick;
}

export function newSession() {
  return { id: uid(), date: localDate(), present: [], seen: [], match: null, history: [] };
}

export const modeOf = (sides) =>
  !sides ? '' : sides.length === 3 ? '3way' : sides[0].length === 2 ? '2v2' : '1v1';

/** Points one player gains or loses for a match. Sitters are not on a side. */
export const pointsFor = (m, won) => {
  const mode = modeOf(m.sides);
  if (mode === '2v2') return won ? 3 : -3;
  if (mode === '3way') return won ? 6 : -3;
  return won ? 4 : -4;
};

export const winnersOf = (m) => m.sides[m.win];
export const losersOf = (m) => m.sides.filter((_, i) => i !== m.win).flat();
export const onCourt = (match) => (match ? match.sides.flat() : []);

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const teamKey = (team) => [...team].sort().join('+');
const matchupKey = (sides) => sides.map(teamKey).sort().join(' v ');

export function playerStats(history, names = []) {
  const s = {};
  const get = (n) => (s[n] ??= { played: 0, wins: 0, losses: 0, out: 0, score: 0 });
  names.forEach(get);
  for (const m of history) {
    m.sides.forEach((side, i) =>
      side.forEach((p) => {
        const r = get(p);
        const won = i === m.win;
        r.played++;
        if (won) r.wins++;
        else r.losses++;
        r.score += pointsFor(m, won);
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
    const a = (by[r.player] ??= {
      player: r.player,
      days: 0,
      played: 0,
      wins: 0,
      losses: 0,
      out: 0,
      score: 0,
    });
    a.days++;
    a.played += +r.played || 0;
    a.wins += +r.wins || 0;
    a.losses += +r.losses || 0;
    a.out += +r.out || 0;
    a.score += r.score != null ? +r.score : (+r.wins || 0) - (+r.losses || 0);
  }
  return Object.values(by).sort(
    (x, y) => winPct(y) - winPct(x) || y.wins - x.wins || x.player.localeCompare(y.player),
  );
}

export const winPct = (r) => (r.played ? r.wins / r.played : 0);

/** Signed points, with a plus on positive totals. Halves stay one decimal. */
export function formatScore(n) {
  const v = Math.round(+n * 10) / 10;
  const text = Number.isInteger(v) ? String(v) : v.toFixed(1);
  return v > 0 ? `+${text}` : text;
}

/**
 * Crown: the highest score. Poop: the lowest score.
 * Only someone who played at least one game is eligible. A tie for either
 * names no one. Someone who would hold both keeps only the crown.
 */
export const dayStars = (history) =>
  starsOf(Object.entries(playerStats(history)).map(([player, r]) => ({ player, ...r })));

/** Same as dayStars, from per-player totals ({ player, played, score } or wins and losses). */
export function starsOf(records) {
  const ranked = records
    .filter((r) => r.played >= 1)
    .map((r) => ({
      p: r.player,
      score: r.score != null ? +r.score : (+r.wins || 0) - (+r.losses || 0),
    }));
  if (ranked.length < 2) return { crown: null, poop: null };
  const high = [...ranked].sort((a, b) => b.score - a.score);
  const low = [...ranked].sort((a, b) => a.score - b.score);
  const crown = high[0].score === high[1].score ? null : high[0].p;
  const poop = low[0].score === low[1].score ? null : low[0].p;
  return { crown, poop: poop === crown ? null : poop };
}
