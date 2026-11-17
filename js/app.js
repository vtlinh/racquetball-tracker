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

let selected = null;
let statsScope = 'month';
let statsOffset = 0;

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
  const { session } = S.getState();
  renderTools(session);
  renderSync();
  renderCourt(session);
  renderOut(session);
  renderPlayers(session);
  renderLog(session);
  renderStats();
  if ($('#settingsDlg').open) renderSettings();
}

function renderTools(session) {
  $('#undoBtn').disabled = !S.canUndo();
  $('#shuffleBtn').disabled = !session.match || L.onCourt(session.match).length !== 4;
  $('#doneBtn').disabled = !session.history.length;
  $('#resetBtn').disabled = !session.history.length && !session.present.length;
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

function renderCourt(session) {
  const m = session.match;
  const el = $('#court');
  if (!m) {
    const n = session.present.length;
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

function renderOut(session) {
  const m = session.match;
  const el = $('#outRow');
  if (!m) {
    put(el, '');
    return;
  }
  const blocked = L.blockedPair(session.history);
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

function renderPlayers(session) {
  const { roster } = S.getState();
  const names = [...new Set([...roster, ...session.present, ...session.seen])].sort(byName);
  const st = L.playerStats(session.history, names);
  const m = session.match;
  put(
    $('#players'),
    names
      .map((p) => {
        const here = session.present.includes(p);
        const out = !!m?.out.includes(p);
        const r = st[p];
        return `<div class="prow ${here ? '' : 'away'}">
          <span class="pname">${esc(p)}</span>
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

function renderLog(session) {
  const h = session.history;
  const items = h
    .map((m, i) => {
      const win = m.sides[m.win].join(' & ');
      const lose = m.sides
        .filter((_, j) => j !== m.win)
        .map((t) => t.join(' & '))
        .join(', ');
      const out = m.out?.length ? `<span class="muted"> · ${esc(m.out.join(', '))} sat</span>` : '';
      return `<li><b>${i + 1}</b><span><span class="w">${esc(win)}</span> beat ${esc(lose)}${out}</span></li>`;
    })
    .reverse()
    .join('');
  put($('#log'), h.length ? `<ol>${items}</ol>` : '<p class="muted small">No results yet today.</p>');
}

// ---- stats -------------------------------------------------------------------

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

/** Days rows don't carry a match count; whoever was there all session played or sat every match. */
function matchCount(rows) {
  const most = {};
  for (const r of rows) most[r.session] = Math.max(most[r.session] || 0, (+r.played || 0) + (+r.out || 0));
  return Object.values(most).reduce((a, b) => a + b, 0);
}

const matchesText = (n) => `${n} match${n === 1 ? '' : 'es'}`;

function periodRows() {
  const { prefix } = period();
  return S.getState().days.filter((d) => String(d.date).startsWith(prefix));
}

function renderStats() {
  document
    .querySelectorAll('#statsSeg button')
    .forEach((b) => b.classList.toggle('on', b.dataset.scope === statsScope));
  $('#periodLabel').textContent = period().label;
  const rows = periodRows();
  $('#clearPeriod').disabled = !rows.length;

  const agg = L.aggregate(rows).sort((a, b) => byName(a.player, b.player));
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
      : '<p class="stats empty">No stamped days</p>',
  );

  const dates = [...new Set(rows.map((r) => r.date))].sort().reverse();
  $('#statsNote').textContent = rows.length
    ? `${dates.length} day${dates.length === 1 ? '' : 's'} stamped, ${matchesText(matchCount(rows))}`
    : '';
  $('#daysFold').hidden = !rows.length;
  put(
    $('#daysList'),
    `<ul class="days">${dates
      .map((dt) => {
        const dayRows = rows.filter((r) => r.date === dt);
        const line = L.aggregate(dayRows)
          .sort((a, b) => byName(a.player, b.player))
          .map((r) => `${esc(r.player)} ${r.wins}-${r.losses}`)
          .join(' · ');
        const label = new Date(`${dt}T12:00`).toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        });
        return `<li><b>${esc(label)}</b><span class="muted">${matchesText(matchCount(dayRows))}</span><span>${line}</span></li>`;
      })
      .join('')}</ul>`,
  );
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
      : 'Connected: live session, days and roster are stored in the sheet.';
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
    S.swap(selected, name);
    selected = null;
  }
  render();
}

function onSit(name) {
  const { session } = S.getState();
  const m = session.match;
  if (!m) return;
  if (m.out.includes(name)) S.unbench(name);
  else if (m.out.length) S.swap(name, m.out[0]);
  else S.bench(name);
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
  const name = t.dataset.name;
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
      const team = S.getState().session.match.sides[+t.dataset.side];
      S.win(+t.dataset.side);
      toast(`${icon('trophy')} ${esc(team.join(' & '))} won`, true);
      break;
    }
    case 'toastUndo':
      $('#toast').hidden = true;
      S.undo();
      break;
  }
  render();
});

$('#undoBtn').onclick = () => {
  selected = null;
  S.undo();
};
$('#shuffleBtn').onclick = () => {
  selected = null;
  S.reshuffle();
};
$('#resetBtn').onclick = () => {
  if (!confirm('Start again? Today’s matches are cleared (you can still undo).')) return;
  selected = null;
  S.reset();
};
$('#doneBtn').onclick = () => {
  const s = S.getState().session;
  if (!confirm(`Done for ${s.date}? Stamps ${s.history.length} matches into the stats.`)) return;
  selected = null;
  if (S.done()) toast(`${icon('check')} Day stamped`, true);
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
  const rows = periodRows();
  const sessions = [...new Set(rows.map((r) => r.session))];
  const days = new Set(rows.map((r) => r.date)).size;
  if (!sessions.length) return;
  if (
    !confirm(
      `Delete ${days} stamped day${days === 1 ? '' : 's'} from ${period().label}? This can’t be undone.`,
    )
  )
    return;
  S.deleteStamped(sessions);
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
