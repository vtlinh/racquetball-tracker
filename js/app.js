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

let selected = null;
let statsScope = 'today';
let statsOffset = 0;

const PALETTE = [210, 12, 140, 275, 38, 185, 330, 95];

function hue(name) {
  const i = S.getState().roster.indexOf(name);
  if (i >= 0) return PALETTE[i % PALETTE.length];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

/** Only touch the DOM when markup changed, so a background re-render can't swallow a tap mid-press. */
function put(el, html) {
  if (el._html === html) return;
  el._html = html;
  el.innerHTML = html;
}

const chip = (name, { cls = '', attrs = '', extra = '' } = {}) =>
  `<button class="chip ${cls}" style="--h:${hue(name)}" data-name="${esc(name)}" ${attrs}>${esc(name)}${extra}</button>`;

// ---- render ----------------------------------------------------------------

function render() {
  const { session, roster } = S.getState();
  const st = L.playerStats(session.history, roster);
  renderPlayers(session, roster);
  renderCourt(session);
  renderTools(session);
  renderToday(session, st);
  renderLog(session);
  renderSync();
  if ($('#statsDlg').open) renderStats();
  if ($('#settingsDlg').open) renderSettings();
}

function renderPlayers(session, roster) {
  const extras = session.present.filter((p) => !roster.includes(p));
  put(
    $('#players'),
    [...roster, ...extras]
      .map((p) => {
        const on = session.present.includes(p);
        return chip(p, {
          cls: on ? 'on' : 'off',
          attrs: `data-act="toggle" aria-pressed="${on}" title="${on ? 'Here — tap if leaving' : 'Tap to check in'}"`,
        });
      })
      .join('') + `<button class="chip add" data-act="addGuest" title="Add player">${icon('plus')}</button>`,
  );
}

function renderCourt(session) {
  const m = session.match;
  const el = $('#court');
  if (!m) {
    const n = session.present.length;
    put(el, `<p class="empty">${n ? 'Need at least 2 players' : 'Tap players who are here (2–5)'}</p>`);
    return;
  }
  const mode = L.modeOf(m.sides);
  const blocked = L.blockedPair(session.history);
  const clash = blocked && m.sides.some((t) => t.length === 2 && blocked.every((p) => t.includes(p)));
  const label = { '2v2': '2 v 2', '1v1': '1 v 1', '3way': 'Cut-throat' }[mode];
  const sel = (p) => (p === selected ? 'sel' : '');

  const sides = m.sides
    .map(
      (team, i) => `
      <div class="side">
        <div class="side-players">${team.map((p) => chip(p, { cls: `on ${sel(p)}`, attrs: 'data-act="pick"' })).join('')}</div>
        <button class="win-btn" data-act="win" data-side="${i}" title="${esc(team.join(' + '))} won">${icon('trophy')}</button>
      </div>`,
    )
    .join(`<span class="vs">vs</span>`);

  const canBench = selected && L.onCourt(m).includes(selected) && L.onCourt(m).length > 2;
  const canUnbench = selected && m.out.includes(selected) && L.onCourt(m).length < L.MAX_ON_COURT;

  put(
    el,
    `
    <div class="court-head">
      <span class="tag">${label}</span>
      <span class="tag muted">Match ${session.history.length + 1}</span>
      ${clash ? `<span class="tag warn" title="Last winners are teamed up">${icon('warn')}winners together</span>` : ''}
      ${canUnbench ? `<button class="tag action" data-act="unbench">${icon('up')}to court</button>` : ''}
    </div>
    <div class="sides n${m.sides.length}">${sides}</div>
    <div class="bench ${canBench ? 'target' : ''}" data-act="bench" title="Sitting out">
      ${icon('bench')}
      ${m.out.map((p) => chip(p, { cls: `sit ${sel(p)}`, attrs: 'data-act="pick"' })).join('')}
      ${canBench ? '<span class="hint">tap to sit out</span>' : m.out.length ? '' : '<span class="hint">no one sitting</span>'}
    </div>`,
  );
}

function renderTools(session) {
  const n = S.getState().undo.length;
  $('#undoBtn').disabled = !n;
  $('#undoCount').textContent = n || '';
  $('#shuffleBtn').disabled = !session.match || L.onCourt(session.match).length !== 4;
  $('#doneBtn').disabled = !session.history.length;
  $('#resetBtn').disabled = !session.history.length && !session.present.length;
}

function statsTable(rows, { days = false } = {}) {
  if (!rows.length) return '<p class="empty">No games yet</p>';
  return `<table class="stats">
    <thead><tr><th></th>${days ? '<th title="Days">D</th>' : ''}<th title="Played">P</th><th title="Wins">W</th><th title="Losses">L</th><th title="Sat out">Out</th><th>Win%</th></tr></thead>
    <tbody>${rows
      .map(
        (r) =>
          `<tr><td><span class="dot" style="--h:${hue(r.player)}"></span>${esc(r.player)}</td>${
            days ? `<td>${r.days}</td>` : ''
          }<td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.out}</td><td>${
            r.played ? Math.round(L.winPct(r) * 100) : '–'
          }</td></tr>`,
      )
      .join('')}</tbody></table>`;
}

function todayRows(session, st) {
  const names = [...new Set([...session.seen, ...session.present])];
  return names.map((p) => ({ player: p, ...(st[p] || { played: 0, wins: 0, losses: 0, out: 0 }) }));
}

function renderToday(session, st) {
  const el = $('#today');
  if (!session.history.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  put(el, statsTable(todayRows(session, st)));
}

function renderLog(session) {
  const h = session.history;
  const items = h
    .map((m, i) => {
      const sides = m.sides.map(
        (t, j) => `<span class="${j === m.win ? 'w' : 'l'}">${esc(t.join('+'))}</span>`,
      );
      const out = m.out?.length
        ? `<span class="muted"> · ${icon('bench')}${esc(m.out.join(', '))}</span>`
        : '';
      return `<li><b>${i + 1}</b>${sides.join('<i>v</i>')}${out}</li>`;
    })
    .reverse()
    .join('');
  put($('#log'), h.length ? `<ol>${items}</ol>` : '');
}

function renderSync() {
  const { status, error } = S.getSync();
  const pending = S.getState().pending.length + (S.getState().dirty ? 1 : 0);
  const map = {
    local: ['phone', 'Saved on this device only — connect the Google Sheet in settings'],
    idle: ['cloud', 'Synced with Google Sheet'],
    syncing: ['sync', 'Syncing…'],
    error: ['cloudOff', `Sync failed (${error}) — will retry`],
  };
  const [ic, title] = status === 'idle' && pending ? ['sync', 'Waiting to sync'] : map[status];
  const btn = $('#syncBtn');
  put(btn, icon(ic, status === 'syncing' ? 'spin' : ''));
  btn.title = title;
  btn.className = `icon-btn sync-${status}`;
}

// ---- stats dialog ------------------------------------------------------------

function periodPrefix() {
  const d = new Date();
  if (statsScope === 'month') {
    d.setDate(1);
    d.setMonth(d.getMonth() + statsOffset);
    return {
      prefix: L.localDate(d).slice(0, 7),
      label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    };
  }
  const y = String(d.getFullYear() + statsOffset);
  return { prefix: y, label: y };
}

function renderStats() {
  const { session, days } = S.getState();
  document
    .querySelectorAll('#statsSeg button')
    .forEach((b) => b.classList.toggle('on', b.dataset.scope === statsScope));
  const period = $('#statsPeriod');
  if (statsScope === 'today') {
    period.hidden = true;
    const st = L.playerStats(session.history, session.seen);
    $('#statsBody').innerHTML =
      `<p class="muted small">${esc(session.date)} · ${session.history.length} matches (live, not stamped yet)</p>` +
      statsTable(todayRows(session, st)) +
      pairTable(session.history);
    return;
  }
  period.hidden = false;
  const { prefix, label } = periodPrefix();
  $('#periodLabel').textContent = label;
  const rows = days.filter((d) => String(d.date).startsWith(prefix));
  const dates = [...new Set(rows.map((r) => r.date))].sort().reverse();
  $('#statsBody').innerHTML =
    `<p class="muted small">${dates.length} day${dates.length === 1 ? '' : 's'} stamped</p>` +
    statsTable(L.aggregate(rows), { days: true }) +
    (statsScope === 'month' && dates.length
      ? `<h4>Days</h4><ul class="days">${dates
          .map((dt) => {
            const line = L.aggregate(rows.filter((r) => r.date === dt))
              .map((r) => `${esc(r.player)} ${r.wins}-${r.losses}`)
              .join(' · ');
            return `<li><b>${esc(dt.slice(5))}</b> ${line}</li>`;
          })
          .join('')}</ul>`
      : '');
}

function pairTable(history) {
  const { pc } = L.pairCounts(history);
  const entries = Object.entries(pc).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '';
  return `<h4>Teammates today</h4><p class="small pairs">${entries
    .map(([k, n]) => `<span>${esc(k.replace('|', '+'))} <b>${n}</b></span>`)
    .join('')}</p>`;
}

// ---- settings dialog ----------------------------------------------------------

function renderSettings() {
  const { roster } = S.getState();
  $('#rosterList').innerHTML = roster
    .map(
      (p) =>
        `<span class="chip on" style="--h:${hue(p)}">${esc(p)}<button class="x" data-remove="${esc(p)}" title="Remove ${esc(p)}">${icon('x')}</button></span>`,
    )
    .join('');
  const url = S.getApiUrl();
  if (document.activeElement !== $('#apiUrl')) $('#apiUrl').value = url;
  const { status, error } = S.getSync();
  $('#syncInfo').textContent = !url
    ? 'Not connected: data is kept on this device until the sheet is connected.'
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
    case 'addGuest': {
      const n = prompt('Player name')?.trim();
      if (!n) return;
      const { roster } = S.getState();
      if (!roster.includes(n)) S.setRoster([...roster, n]);
      if (!S.getState().session.present.includes(n)) S.togglePlayer(n);
      break;
    }
    case 'pick':
      e.stopPropagation();
      onPick(name);
      return;
    case 'bench':
      if (selected) {
        S.bench(selected);
        selected = null;
      }
      break;
    case 'unbench':
      if (selected) {
        S.unbench(selected);
        selected = null;
      }
      break;
    case 'win': {
      selected = null;
      const m = S.getState().session.match;
      const team = m.sides[+t.dataset.side];
      S.win(+t.dataset.side);
      toast(`${icon('trophy')} ${esc(team.join(' + '))} won`, true);
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
  if (S.done()) toast(`${icon('done')} Day stamped`, true);
};

$('#syncBtn').onclick = () => (S.getApiUrl() ? S.flush().then(S.pull) : openSettings());
$('#statsBtn').onclick = () => {
  statsOffset = 0;
  renderStats();
  $('#statsDlg').showModal();
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
  if (!b) return;
  statsScope = b.dataset.scope;
  statsOffset = 0;
  renderStats();
};
$('#prevPeriod').onclick = () => (statsOffset--, renderStats());
$('#nextPeriod').onclick = () => (statsOffset++, renderStats());

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
