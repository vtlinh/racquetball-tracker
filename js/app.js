import * as L from './logic.js';
import * as S from './store.js';
import { icon, hydrateIcons } from './icons.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
const dayName = (date) =>
  new Date(`${date}T12:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
const matchesText = (n) => `${n} match${n === 1 ? '' : 'es'}`;
/** Crown or poop for a player who played at least one game that day. Shown above the name. */
const dayMark = (name, stars, played) =>
  !(played >= 1) ? '' : name === stars.crown ? '👑' : name === stars.poop ? '💩' : '';
const markHtml = (emoji) =>
  `<span class="mark"${emoji === '👑' ? ' title="Most points"' : emoji === '💩' ? ' title="Fewest points"' : ''}>${emoji}</span>`;

const STATS_SCOPE_KEY = 'rb.statsScope';
const STATS_SCOPES = ['all', 'year', 'month'];

function loadStatsScope() {
  try {
    const saved = localStorage.getItem(STATS_SCOPE_KEY);
    if (STATS_SCOPES.includes(saved)) return saved;
  } catch {}
  return 'all';
}

function rememberStatsScope(scope) {
  try {
    localStorage.setItem(STATS_SCOPE_KEY, scope);
  } catch {}
}

let selected = null;
let statsScope = loadStatsScope();
let statsOffset = 0;
/** null keeps names A–Z. 'desc' puts the higher value first. */
let statsSort = null;
const dayOpen = new Map();

/** Only touch the DOM when markup changed, so a background re-render can't swallow a tap mid-press. */
function put(el, html) {
  if (el._html === html) return;
  el._html = html;
  el.innerHTML = html;
}

const nameBtn = (name, cls = '') =>
  `<button class="name ${cls} ${name === selected ? 'sel' : ''}" data-act="pick" data-name="${esc(name)}">${esc(name)}</button>`;

// ---- render ----------------------------------------------------------------

function render() {
  const { live } = S.getState();
  const history = S.dayHistory();
  renderDay();
  renderTools(live);
  renderCourt(live);
  renderOut(live, history);
  renderPlayers(live, history);
  renderStats();
  if ($('#settingsDlg').open) renderSettings();
}

/** Dates that have at least one recorded match, oldest first. Empty days are skipped. */
function playedDates() {
  return S.allDays()
    .filter((d) => d.matches > 0)
    .map((d) => d.date)
    .sort();
}

/** The nearest played day before the day on screen, or the next played day.
    The forward arrow can also land on today when today has no games yet. */
function neighborDay(dir) {
  const date = S.getViewDate();
  const dates = playedDates();
  if (dir < 0) return dates.filter((d) => d < date).at(-1);
  const next = dates.find((d) => d > date);
  const today = L.localDate();
  if (!next && date < today) return today;
  return next;
}

function renderDay() {
  const date = S.getViewDate();
  const today = S.isToday();
  $('#dayText').textContent = today ? 'Today' : dayName(date);
  $('#dayLabel').classList.toggle('past', !today);
  $('#prevDay').disabled = !neighborDay(-1);
  $('#nextDay').disabled = !neighborDay(1);
  const pick = $('#dayPick');
  pick.max = L.localDate();
  if (document.activeElement !== pick) pick.value = date;
}

function renderTools(live) {
  $('#undoBtn').disabled = !S.canUndo();
  $('#redoBtn').hidden = !S.canRedo();
  $('#shuffleBtn').disabled = !live.match || L.onCourt(live.match).length !== 4;
}

function renderCourt(live) {
  const m = live.match;
  const el = $('#court');
  if (!m) {
    const n = live.present.length;
    put(el, `<p class="empty">${n ? 'Need at least 2 players' : 'Check in who’s here below'}</p>`);
    return;
  }
  const teams = m.sides.map((team, i) => {
    const label = `${esc(team.join(' + '))} won`;
    return `
      <div class="team">
        <div class="team-names">${team.map((p) => nameBtn(p)).join('')}</div>
        <button class="win" data-act="win" data-side="${i}" title="${label}" aria-label="${label}">${icon('trophy')}</button>
      </div>`;
  });
  const ball =
    m.sides.length >= 2
      ? '<span class="ball-trail a"></span><span class="ball-trail b"></span><span class="ball-trail c"></span><span class="ball" aria-hidden="true"></span>'
      : '';
  put(
    el,
    `<div class="court-floor" data-sides="${m.sides.length}">
      <span class="court-line service"></span>
      <span class="court-line short"></span>
      <span class="court-line receive"></span>
      <span class="box-line a"></span>
      <span class="box-line b"></span>
      <span class="box-line c"></span>
      <span class="box-line d"></span>
      <div class="teams" data-sides="${m.sides.length}">${teams.join('')}</div>
      ${ball}
    </div>`,
  );
}

function renderOut(live, history) {
  const m = live.match;
  const el = $('#outRow');
  if (!m) {
    put(el, '');
    return;
  }
  const blocked = L.blockedPair(history);
  const clash = blocked && m.sides.some((t) => t.length === 2 && blocked.every((p) => t.includes(p)));
  const hint = selected
    ? 'tap another name'
    : clash
      ? `<span class="warn">last winners together</span>`
      : 'tap names to swap';
  put(
    el,
    `<span class="out-label">Out</span>
     ${m.out.length ? m.out.map((p) => nameBtn(p, 'pill')).join('') : '<span class="muted">nobody</span>'}
     <span class="hint">${hint}</span>`,
  );
}

function renderPlayers(live, history) {
  const { roster } = S.getState();
  const played = history.flatMap((m) => [...m.sides.flat(), ...(m.out || [])]);
  const names = [...new Set([...roster, ...live.present, ...played])].sort(byName);
  const stats = L.playerStats(history, names);
  const stars = L.dayStars(history);
  const m = live.match;
  put(
    $('#players'),
    names
      .map((p) => {
        const here = live.present.includes(p);
        const out = !!m?.out.includes(p);
        return `<div class="pchip ${here ? '' : 'away'}">
          ${markHtml(dayMark(p, stars, stats[p]?.played))}
          <span class="pchip-line">
            <button class="pname ${here ? 'on' : ''}" data-act="toggle" data-name="${esc(p)}" aria-pressed="${here}"
              title="${here ? `${esc(p)} is in the lineup — tap to leave` : `Include ${esc(p)} in the lineup`}">${esc(p)}</button>
            <button class="btn sit ${out ? 'on' : ''}" data-act="sit" data-name="${esc(p)}" aria-pressed="${out}" ${here ? '' : 'disabled'}
              title="${out ? `${esc(p)} is sitting out — tap to bring back` : `Sit ${esc(p)} out`}">${icon('coffee')}</button>
          </span>
        </div>`;
      })
      .join(''),
  );
}

// ---- stats and results by day -------------------------------------------------

function period() {
  if (statsScope === 'all') return { prefix: '', label: 'All time' };
  const [year, month] = L.localDate().split('-').map(Number);
  if (statsScope === 'month') {
    const index = year * 12 + (month - 1) + statsOffset;
    const y = Math.floor(index / 12);
    const m = index - y * 12;
    const labelDate = new Date(Date.UTC(y, m, 1));
    return {
      prefix: `${y}-${String(m + 1).padStart(2, '0')}`,
      label: labelDate.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' }),
    };
  }
  const y = String(year + statsOffset);
  return { prefix: y, label: y };
}

const periodDays = () => {
  const { prefix } = period();
  const days = S.allDays();
  return prefix ? days.filter((d) => d.date.startsWith(prefix)) : days;
};

const STATS_COLUMNS = [
  { key: 'player', label: 'Player' },
  { key: 'played', label: 'Played' },
  { key: 'wins', label: 'Won' },
  { key: 'pct', label: 'Win %' },
  { key: 'score', label: 'Score' },
];

function sortStatsRows(rows) {
  const sorted = [...rows];
  const byPlayer = (a, b) => byName(a.player, b.player);
  if (!statsSort) return sorted.sort(byPlayer);
  const { key, dir } = statsSort;
  const sign = dir === 'asc' ? 1 : -1;
  const value = (row) => {
    if (key === 'played') return row.played;
    if (key === 'wins') return row.wins;
    if (key === 'pct') return L.winPct(row);
    return row.score;
  };
  return sorted.sort((a, b) => {
    if (key === 'player') return sign * byPlayer(a, b);
    const diff = value(a) - value(b);
    return diff ? sign * diff : byPlayer(a, b);
  });
}

function statsHeader() {
  return STATS_COLUMNS.map((col) => {
    const dir = statsSort?.key === col.key ? statsSort.dir : null;
    const arrow = dir === 'asc' ? '^' : dir === 'desc' ? '↓' : '';
    const aria = dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none';
    return `<th data-sort="${col.key}" role="button" tabindex="0" aria-sort="${aria}">${esc(col.label)}${
      arrow ? `<span class="sort-dir" aria-hidden="true">${arrow}</span>` : ''
    }</th>`;
  }).join('');
}

function cycleStatsSort(key) {
  if (statsSort?.key !== key) statsSort = { key, dir: 'desc' };
  else if (statsSort.dir === 'desc') statsSort = { key, dir: 'asc' };
  else statsSort = null;
  renderStats();
  document.querySelector(`#statsBody th[data-sort="${CSS.escape(key)}"]`)?.focus();
}

function renderStats() {
  document
    .querySelectorAll('#statsSeg button')
    .forEach((b) => b.classList.toggle('on', b.dataset.scope === statsScope));
  const paging = statsScope !== 'all';
  $('#prevPeriod').hidden = !paging;
  $('#nextPeriod').hidden = !paging;
  $('#periodLabel').textContent = period().label;
  const days = periodDays();

  const agg = sortStatsRows(L.aggregate(days.flatMap((d) => d.rows)));
  put(
    $('#statsBody'),
    agg.length
      ? `<table class="stats">
          <thead><tr>${statsHeader()}</tr></thead>
          <tbody>${agg
            .map(
              (r) =>
                `<tr><td>${esc(r.player)}</td><td>${r.played}</td><td>${r.wins}</td><td>${
                  r.played ? `${Math.round(L.winPct(r) * 100)}%` : '–'
                }</td><td>${L.formatScore(r.score)}</td></tr>`,
            )
            .join('')}</tbody></table>`
      : '<p class="stats empty">No results</p>',
  );

  const matches = days.reduce((n, d) => n + d.matches, 0);
  $('#statsNote').textContent = days.length
    ? `${days.length} day${days.length === 1 ? '' : 's'}, ${matchesText(matches)}`
    : '';
  put($('#daysList'), days.map((d) => dayGroup(d)).join(''));
}

function resultTime(m) {
  const label = L.formatTimeET(m.t, 'hhmm');
  if (!label) return '';
  return `<time datetime="${new Date(m.t).toISOString()}" title="Eastern Time">${esc(label)}</time>`;
}

function resultLine(m) {
  const withDelta = (names, won) =>
    names
      .map((p) => {
        const points = L.pointsFor(m, won);
        const tone = points < 0 ? 'down' : 'up';
        return `${esc(p)} <span class="delta ${tone}">${L.formatScore(points)}</span>`;
      })
      .join(' & ');
  const win = withDelta(m.sides[m.win], true);
  const lose = m.sides
    .filter((_, j) => j !== m.win)
    .map((t) => withDelta(t, false))
    .join(', ');
  const out = m.out?.length ? `<span class="muted"> · ${esc(m.out.join(', '))} sat</span>` : '';
  const when = resultTime(m);
  const winners = `${when}${when ? ' ' : ''}<span class="w">${win}</span>`;
  const beaten = `beat ${lose}${out}`;
  if (m.sides.length === 3) return `<span class="res-line">${winners} ${beaten}</span>`;
  return `<span class="res-line">${winners}</span><span class="res-line">${beaten}</span>`;
}

/** Where a score sits from the day's lowest (0, orange) to its highest (1, green). */
function scoreTone(score, low, high) {
  if (!(high > low)) return 0.5;
  return (score - low) / (high - low);
}

function dayGroup(day) {
  const { date, history } = day;
  const viewing = date === S.getViewDate();
  const open = dayOpen.has(date) ? dayOpen.get(date) : date === L.localDate();
  const totals = L.aggregate(day.rows).sort((a, b) => b.score - a.score || byName(a.player, b.player));
  const stars = L.starsOf(totals);
  const low = Math.min(...totals.map((r) => r.score));
  const high = Math.max(...totals.map((r) => r.score));
  const standings = totals
    .map((r) => {
      const emoji = dayMark(r.player, stars, r.played);
      const tone = Math.round(scoreTone(r.score, low, high) * 100);
      return `<span><b>${esc(r.player)}</b>${emoji ? ` ${emoji}` : ''} <span class="pts" style="color: color-mix(in srgb, var(--orange), var(--green) ${tone}%)">${L.formatScore(r.score)}</span></span>`;
    })
    .join('');
  const body = history
    ? `<ol class="results">${history
        .map(
          (m, i) => `<li>
            <b>${i + 1}</b><span class="res">${resultLine(m)}</span>
            <button class="btn sm" data-act="flip" data-date="${date}" data-i="${i}" title="Change winner">${icon('swap')}</button>
            <button class="btn sm" data-act="delMatch" data-date="${date}" data-i="${i}" title="Delete result">${icon('x')}</button>
          </li>`,
        )
        .reverse()
        .join('')}</ol>`
    : `<p class="legacy">No match details for this day.</p>`;
  return `<details class="day ${viewing ? 'viewing' : ''}" name="days" data-date="${date}" ${open ? 'open' : ''}>
    <summary>
      <span class="day-title">${esc(dayName(date))}</span>
      <span class="muted">${matchesText(day.matches)}</span>
      <span class="standings">${standings}</span>
    </summary>
    ${body}
  </details>`;
}

// ---- settings dialog ----------------------------------------------------------

function renderSettings() {
  const { roster } = S.getState();
  $('#rosterList').innerHTML = roster
    .map(
      (p) =>
        `<span class="pill">${esc(p)}<button class="x" data-remove="${esc(p)}" title="Remove ${esc(p)}">${icon('x')}</button></span>`,
    )
    .join('');
}

// ---- events ---------------------------------------------------------------------

let toastTimer = 0;
function toast(msg, withUndo = false) {
  const t = $('#toast');
  const undo = withUndo ? `<button data-act="toastUndo">${icon('undo')}Undo</button>` : '';
  const redo = S.canRedo() ? `<button data-act="toastRedo">${icon('redo')}Redo</button>` : '';
  t.innerHTML = `<span>${msg}</span>${undo}${redo}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

function onPick(name) {
  if (!selected) selected = name;
  else if (selected === name) selected = null;
  else {
    if (!S.swap(selected, name)) refusedSwap();
    selected = null;
  }
  render();
}

function refusedSwap() {
  const pair = L.blockedPair(S.dayHistory());
  if (pair) toast(`${esc(pair.join(' & '))} just won, so they can’t team up next`);
}

function onSit(name) {
  const m = S.getState().live.match;
  if (!m) return;
  const changed = m.out.includes(name) ? S.unbench(name) : S.bench(name);
  if (changed) return;
  toast(m.out.includes(name) ? 'Four players are already on court' : 'Two players stay on court');
}

function goToDay(date) {
  selected = null;
  S.setViewDate(date);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  const act = t?.dataset.act;
  if (!act) {
    if (selected && !e.target.closest('dialog')) {
      selected = null;
      render();
    }
    return;
  }
  const { name, date } = t.dataset;
  const i = +t.dataset.i;
  switch (act) {
    case 'toggle':
      selected = null;
      S.togglePlayer(name);
      break;
    case 'sit':
      selected = null;
      onSit(name);
      break;
    case 'pick':
      e.stopPropagation();
      onPick(name);
      return;
    case 'win': {
      selected = null;
      const team = S.getState().live.match.sides[+t.dataset.side];
      S.win(+t.dataset.side);
      const day = S.isToday() ? '' : ` (${dayName(S.getViewDate())})`;
      const clock = L.formatTimeET(S.dayHistory().at(-1)?.t, 'hhmm');
      const at = clock ? ` at ${clock}` : '';
      toast(`${icon('trophy')} ${esc(team.join(' & '))} won${esc(day)}${esc(at)}`, true);
      break;
    }
    case 'flip': {
      const m = S.dayHistory(date)[i];
      if (m) S.setWinner(date, i, (m.win + 1) % m.sides.length);
      toast('Winner changed', true);
      break;
    }
    case 'delMatch':
      if (!confirm(`Delete result ${i + 1} from ${dayName(date)}?`)) return;
      S.deleteMatch(date, i);
      toast('Result deleted', true);
      break;
    case 'toastUndo':
      S.undo();
      toast('Undone');
      break;
    case 'toastRedo':
      S.redo();
      toast('Redone', true);
      break;
  }
  render();
});

$('#daysList').addEventListener(
  'toggle',
  (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDetailsElement) || !d.classList.contains('day')) return;
    if (!d.open) {
      dayOpen.set(d.dataset.date, false);
      return;
    }
    for (const other of d.parentElement.querySelectorAll('details.day')) {
      if (other !== d) other.open = false;
    }
    for (const date of dayOpen.keys()) dayOpen.set(date, false);
    dayOpen.set(d.dataset.date, true);
  },
  true,
);

const shiftDay = (n) => {
  const date = neighborDay(n);
  if (date) goToDay(date);
};
$('#prevDay').onclick = () => shiftDay(-1);
$('#nextDay').onclick = () => shiftDay(1);
$('#dayPick').onchange = (e) => e.target.value && goToDay(e.target.value);
$('#dayLabel').onclick = (e) => {
  if (e.target === $('#dayPick')) return;
  try {
    $('#dayPick').showPicker();
  } catch {
    $('#dayPick').focus();
  }
};

$('#undoBtn').onclick = () => {
  selected = null;
  S.undo();
  if (S.canRedo()) toast('Undone');
};
$('#redoBtn').onclick = () => {
  selected = null;
  S.redo();
};
$('#shuffleBtn').onclick = () => {
  selected = null;
  S.reshuffle();
};

const openSettings = () => {
  renderSettings();
  $('#settingsDlg').showModal();
};
$('#settingsBtn').onclick = openSettings;

document.querySelectorAll('dialog').forEach((d) => {
  d.addEventListener('click', (e) => {
    const r = d.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if ((e.target === d && outside) || e.target.closest('[data-close]')) d.close();
  });
});

$('#statsSeg').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b || !STATS_SCOPES.includes(b.dataset.scope)) return;
  statsScope = b.dataset.scope;
  statsOffset = 0;
  rememberStatsScope(statsScope);
  renderStats();
};
$('#prevPeriod').onclick = () => (statsOffset--, renderStats());
$('#nextPeriod').onclick = () => (statsOffset++, renderStats());

function statsSortFrom(event) {
  const cell = event.target.closest('#statsBody th, #statsBody td');
  if (!cell?.closest('table.stats')) return;
  const key = cell.closest('table').tHead.rows[0].cells[cell.cellIndex]?.dataset.sort;
  if (key) cycleStatsSort(key);
}
$('#statsBody').addEventListener('click', statsSortFrom);
$('#statsBody').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (!e.target.closest('th[data-sort]')) return;
  e.preventDefault();
  statsSortFrom(e);
});

$('#rosterList').onclick = (e) => {
  const b = e.target.closest('[data-remove]');
  if (!b) return;
  const name = b.dataset.remove;
  if (!confirm(`Remove ${name} from the roster? (Stats are kept.)`)) return;
  S.setRoster(S.getState().roster.filter((p) => p !== name));
};
$('#addPlayerForm').onsubmit = (e) => {
  e.preventDefault();
  const n = $('#newPlayer').value.trim();
  if (n) S.setRoster([...S.getState().roster, n]);
  $('#newPlayer').value = '';
};

/** On two sides the ball stays between the teams and stops on the inner edge of each side's letters.
    On a triple it stays to the right of the stacked names and rebounds off the right wall. */
function rallyBall() {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const trailLag = [4, 9, 15];
  const samples = [];
  let state = null;
  let last = 0;
  const place = (el, x, y) => {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };
  const textPad = (el) => {
    if (el._textPad) return el._textPad;
    const style = getComputedStyle(el);
    el._textPad = { l: parseFloat(style.paddingLeft) || 0, r: parseFloat(style.paddingRight) || 0 };
    return el._textPad;
  };
  const tick = (now) => {
    requestAnimationFrame(tick);
    const ball = document.querySelector('.court-floor .ball');
    if (!ball) {
      state = null;
      samples.length = 0;
      return;
    }
    const floor = ball.parentElement;
    const trails = [...floor.querySelectorAll('.ball-trail')];
    const ballW = ball.offsetWidth;
    const ballH = ball.offsetHeight;
    const floorBox = floor.getBoundingClientRect();
    const triples = floor.dataset.sides === '3';
    let minX = 0;
    let maxX = Math.max(0, floor.clientWidth - ballW);
    let maxY = Math.max(0, floor.clientHeight - ballH);
    if (triples) {
      // The left wall of the rally is the right edge of the letters.
      let nameRight = 0;
      let sawName = false;
      for (const el of floor.querySelectorAll('.name')) {
        const b = el.getBoundingClientRect();
        if (b.width < 1) continue;
        const pad = textPad(el);
        nameRight = Math.max(nameRight, b.right - pad.r - floorBox.left);
        sawName = true;
      }
      if (sawName && floor.clientWidth - nameRight >= ballW + 8) minX = nameRight;
    } else {
      const mid = floorBox.left + floor.clientWidth / 2;
      // The name buttons pad the letters. The stop is the inner edge of those letters, for the full height of the court.
      let laneLeft = 0;
      let laneRight = floor.clientWidth;
      let sawLeft = false;
      let sawRight = false;
      for (const el of floor.querySelectorAll('.name')) {
        const b = el.getBoundingClientRect();
        if (b.width < 1) continue;
        const pad = textPad(el);
        const left = b.left + pad.l - floorBox.left;
        const right = b.right - pad.r - floorBox.left;
        if ((b.left + b.right) / 2 < mid) {
          laneLeft = Math.max(laneLeft, right);
          sawLeft = true;
        } else {
          laneRight = Math.min(laneRight, left);
          sawRight = true;
        }
      }
      if (sawLeft && sawRight && laneRight - laneLeft >= ballW + 4) {
        minX = laneLeft;
        maxX = laneRight - ballW;
      }
    }
    const sides = floor.dataset.sides || '';
    if (state && state.sides !== sides) {
      state = null;
      samples.length = 0;
    }
    if (reduce) {
      place(ball, triples ? (minX + maxX) * 0.5 : maxX * 0.5, maxY * (triples ? 0.4 : 0.45));
      ball.style.transform = 'none';
      trails.forEach((t) => (t.hidden = true));
      return;
    }
    if (!state) {
      const laneW = Math.max(40, maxX - minX);
      state = {
        x: triples ? minX + laneW * 0.4 : maxX * 0.46,
        y: maxY * 0.35,
        vx: triples ? laneW * 0.9 : floor.clientWidth * 0.72,
        vy: floor.clientHeight * 1.25,
        squash: 0,
        wall: 'right',
        sides,
      };
      last = now;
    }
    const dt = Math.min(0.04, last ? (now - last) / 1000 : 0);
    last = now;
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      state.x += state.vx * h;
      state.y += state.vy * h;
      if (state.x <= minX) {
        state.x = minX + (minX - state.x);
        state.vx = Math.abs(state.vx);
        state.squash = 1;
        state.wall = 'left';
      } else if (state.x >= maxX) {
        state.x = maxX - (state.x - maxX);
        state.vx = -Math.abs(state.vx);
        state.squash = 1;
        state.wall = 'right';
      }
      if (state.y <= 0) {
        state.y = -state.y;
        state.vy = Math.abs(state.vy);
        state.squash = 1;
        state.wall = 'top';
      } else if (state.y >= maxY) {
        state.y = maxY - (state.y - maxY);
        state.vy = -Math.abs(state.vy);
        state.squash = 1;
        state.wall = 'bottom';
      }
      state.x = Math.min(maxX, Math.max(minX, state.x));
      state.y = Math.min(maxY, Math.max(0, state.y));
    }
    state.squash *= Math.exp(-dt * 18);
    const k = state.squash;
    const flat = 1 - 0.38 * k;
    const bulge = 1 + 0.16 * k;
    const sideways = state.wall === 'left' || state.wall === 'right';
    ball.style.transformOrigin =
      state.wall === 'left'
        ? '0% 50%'
        : state.wall === 'right'
          ? '100% 50%'
          : state.wall === 'top'
            ? '50% 0%'
            : '50% 100%';
    ball.style.transform = `scale(${(sideways ? flat : bulge).toFixed(3)}, ${(sideways ? bulge : flat).toFixed(3)})`;
    place(ball, state.x, state.y);
    samples.push({ x: state.x, y: state.y });
    if (samples.length > 20) samples.shift();
    trails.forEach((t, i) => {
      const s = samples[samples.length - 1 - trailLag[i]];
      t.hidden = !s;
      if (s) place(t, s.x, s.y);
    });
  };
  requestAnimationFrame(tick);
}

hydrateIcons();
S.subscribe(render);
const watchDay = () => {
  if (S.rollDay()) toast('New day, teams reshuffled');
};
watchDay();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') watchDay();
});
setInterval(watchDay, 60_000);
render();
S.pull();
rallyBall();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js');
}
