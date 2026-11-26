import * as L from './logic.js';
import * as S from './store.js';
import { icon, hydrateIcons } from './icons.js';
import { SHEET_URL } from './config.js';

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
const star = (name, { crown, poop }) => (name === crown ? ' 👑' : name === poop ? ' 💩' : '');

let selected = null;
let statsScope = 'month';
let statsOffset = 0;
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
  renderSync();
  renderCourt(live);
  renderOut(live, history);
  renderPlayers(live, history);
  renderStats();
  if ($('#settingsDlg').open) renderSettings();
}

function renderDay() {
  const date = S.getViewDate();
  const today = S.isToday();
  $('#dayText').textContent = today ? 'Today' : dayName(date);
  $('#dayLabel').classList.toggle('past', !today);
  $('#nextDay').disabled = today;
  const pick = $('#dayPick');
  pick.max = L.localDate();
  if (document.activeElement !== pick) pick.value = date;
}

function renderTools(live) {
  $('#undoBtn').disabled = !S.canUndo();
  $('#shuffleBtn').disabled = !live.match || L.onCourt(live.match).length !== 4;
}

function renderSync() {
  const { status } = S.getSync();
  const { pending, dirty } = S.getState();
  const waiting = pending.length || dirty;
  const text = {
    local: 'Saved in this browser.',
    idle: waiting
      ? 'Saved in this browser. Waiting to sync…'
      : 'Saved in this browser and synced to the sheet.',
    syncing: 'Saved in this browser. Syncing…',
    error: 'Saved in this browser. Sheet sync failed, retrying.',
  }[status];
  const el = $('#syncLine');
  el.textContent = text;
  el.classList.toggle('err', status === 'error');
}

function renderCourt(live) {
  const m = live.match;
  const el = $('#court');
  if (!m) {
    const n = live.present.length;
    put(el, `<p class="empty">${n ? 'Need at least 2 players' : 'Check in who’s here below'}</p>`);
    return;
  }
  const letters = 'ABC';
  const teams = m.sides.map(
    (team, i) => `
      <div class="team">
        <div class="team-label">Team ${letters[i]}</div>
        <div class="team-names">${team.map((p) => nameBtn(p)).join('')}</div>
        <button class="win" data-act="win" data-side="${i}" title="${esc(team.join(' + '))} won">${icon('trophy')}Win</button>
      </div>`,
  );
  put(el, `<div class="teams">${teams.join('<div class="vs"><span>vs</span></div>')}</div>`);
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
  const st = L.playerStats(history, names);
  const stars = L.dayStars(history);
  const m = live.match;
  put(
    $('#players'),
    names
      .map((p) => {
        const here = live.present.includes(p);
        const out = !!m?.out.includes(p);
        const r = st[p];
        return `<div class="prow ${here ? '' : 'away'}">
          <span class="pname">${esc(p)}${star(p, stars)}</span>
          <span>${r.played}</span><span>${r.wins}</span><span>${r.out}</span>
          <button class="btn sit ${out ? 'on' : ''}" data-act="sit" data-name="${esc(p)}" ${here ? '' : 'disabled'}
            title="${out ? `${esc(p)} is sitting out — tap to bring back` : `Sit ${esc(p)} out`}">${icon('coffee')}</button>
          <button class="btn here ${here ? 'on' : ''}" data-act="toggle" data-name="${esc(p)}" aria-pressed="${here}"
            title="${here ? 'Here — tap if leaving' : 'Tap to check in'}">${icon(here ? 'here' : 'away')}</button>
        </div>`;
      })
      .join(''),
  );
}

// ---- stats and results by day -------------------------------------------------

function period() {
  const d = new Date();
  if (statsScope === 'month') {
    d.setDate(1);
    d.setMonth(d.getMonth() + statsOffset);
    return {
      prefix: L.localDate(d).slice(0, 7),
      label: d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
    };
  }
  const y = String(d.getFullYear() + statsOffset);
  return { prefix: y, label: y };
}

const periodDays = () => S.allDays().filter((d) => d.date.startsWith(period().prefix));

function renderStats() {
  document
    .querySelectorAll('#statsSeg button')
    .forEach((b) => b.classList.toggle('on', b.dataset.scope === statsScope));
  $('#periodLabel').textContent = period().label;
  const days = periodDays();
  $('#clearPeriod').disabled = !days.length;

  const agg = L.aggregate(days.flatMap((d) => d.rows)).sort((a, b) => byName(a.player, b.player));
  put(
    $('#statsBody'),
    agg.length
      ? `<table class="stats">
          <thead><tr><th>Player</th><th>Played</th><th>Won</th><th>Win %</th><th>Sat</th></tr></thead>
          <tbody>${agg
            .map(
              (r) =>
                `<tr><td>${esc(r.player)}</td><td>${r.played}</td><td>${r.wins}</td><td>${
                  r.played ? `${Math.round(L.winPct(r) * 100)}%` : '–'
                }</td><td>${r.out}</td></tr>`,
            )
            .join('')}</tbody></table>`
      : '<p class="stats empty">No results</p>',
  );

  const matches = days.reduce((n, d) => n + d.matches, 0);
  $('#statsNote').textContent = days.length
    ? `${days.length} day${days.length === 1 ? '' : 's'}, ${matchesText(matches)}`
    : '';
  put($('#daysList'), days.map((d, i) => dayGroup(d, i === 0)).join(''));
}

function resultTime(m) {
  const label = L.formatTimeET(m.t);
  if (!label) return '';
  return `<time datetime="${new Date(m.t).toISOString()}" title="Eastern Time">${esc(label)} ET</time>`;
}

function resultLine(m) {
  const win = m.sides[m.win].join(' & ');
  const lose = m.sides
    .filter((_, j) => j !== m.win)
    .map((t) => t.join(' & '))
    .join(', ');
  const out = m.out?.length ? `<span class="muted"> · ${esc(m.out.join(', '))} sat</span>` : '';
  const when = resultTime(m);
  return `${when}${when ? ' ' : ''}<span class="w">${esc(win)}</span> beat ${esc(lose)}${out}`;
}

function dayGroup(day, newest) {
  const { date, history } = day;
  const viewing = date === S.getViewDate();
  const open = dayOpen.has(date) ? dayOpen.get(date) : newest || viewing;
  const totals = L.aggregate(day.rows).sort(
    (a, b) => b.wins - a.wins || a.losses - b.losses || byName(a.player, b.player),
  );
  const stars = L.starsOf(totals);
  const standings = totals
    .map((r) => `<span><b>${esc(r.player)}</b>${star(r.player, stars)} ${r.wins}-${r.losses}</span>`)
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
  return `<details class="day ${viewing ? 'viewing' : ''}" data-date="${date}" ${open ? 'open' : ''}>
    <summary>
      <span class="day-title">${esc(dayName(date))}</span>
      <span class="muted">${matchesText(day.matches)}</span>
      ${viewing ? '' : `<button class="btn sm" data-act="goDay" data-date="${date}" title="Add results to this day">${icon('pencil')}</button>`}
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
  const url = S.getApiUrl();
  if (document.activeElement !== $('#apiUrl')) $('#apiUrl').value = url;
  const { status, error } = S.getSync();
  $('#syncInfo').textContent = !url
    ? 'Not connected: data is kept in this browser until the sheet is connected.'
    : status === 'error'
      ? `Connected, last sync failed: ${error}`
      : 'Connected: results, the live lineup and the roster are stored in the sheet.';
}

// ---- events ---------------------------------------------------------------------

let toastTimer = 0;
function toast(msg, withUndo = false) {
  const t = $('#toast');
  t.innerHTML = `<span>${msg}</span>${withUndo ? `<button data-act="toastUndo">${icon('undo')}Undo</button>` : ''}`;
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
  if (m.out.includes(name)) S.unbench(name);
  else if (m.out.length) S.swap(name, m.out[0]);
  else S.bench(name);
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
      const clock = L.formatTimeET(S.dayHistory().at(-1)?.t);
      const at = clock ? ` at ${clock} ET` : '';
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
    case 'goDay':
      e.preventDefault();
      goToDay(date);
      return;
    case 'toastUndo':
      $('#toast').hidden = true;
      S.undo();
      break;
  }
  render();
});

$('#daysList').addEventListener(
  'toggle',
  (e) => {
    const d = e.target.closest?.('details.day');
    if (d) dayOpen.set(d.dataset.date, d.open);
  },
  true,
);

const shiftDay = (n) => {
  const d = new Date(`${S.getViewDate()}T12:00`);
  d.setDate(d.getDate() + n);
  goToDay(L.localDate(d));
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
};
$('#shuffleBtn').onclick = () => {
  selected = null;
  S.reshuffle();
};

const openSettings = () => {
  renderSettings();
  $('#settingsDlg').showModal();
};
$('#syncLine').onclick = openSettings;

document.querySelectorAll('dialog').forEach((d) => {
  d.addEventListener('click', (e) => {
    const r = d.getBoundingClientRect();
    const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    if ((e.target === d && outside) || e.target.closest('[data-close]')) d.close();
  });
});

$('#statsSeg').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  statsScope = b.dataset.scope;
  statsOffset = 0;
  renderStats();
};
$('#prevPeriod').onclick = () => (statsOffset--, renderStats());
$('#nextPeriod').onclick = () => (statsOffset++, renderStats());
$('#clearPeriod').onclick = () => {
  const days = periodDays();
  if (!days.length) return;
  const n = days.length;
  if (
    !confirm(
      `Delete all results for ${n} day${n === 1 ? '' : 's'} in ${period().label}? This can’t be undone.`,
    )
  )
    return;
  S.deleteDays(days.map((d) => d.date));
  toast('Deleted');
};

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
$('#apiForm').onsubmit = (e) => {
  e.preventDefault();
  S.setApiUrl($('#apiUrl').value);
  toast(S.getApiUrl() ? 'Sheet connected' : 'Sheet disconnected');
};
$('#sheetLink').href = SHEET_URL;
$('#copyScript').onclick = async () => {
  try {
    const code = await (await fetch('apps-script/Code.gs')).text();
    await navigator.clipboard.writeText(code);
    toast('Apps Script copied');
  } catch {
    window.open('apps-script/Code.gs', '_blank');
  }
};
$('#syncNow').onclick = () => S.flush().then(S.pull);

hydrateIcons();
S.subscribe(render);
render();
S.pull();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js');
}
