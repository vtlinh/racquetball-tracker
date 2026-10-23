/**
 * Racquetball 2v2 lineup — Google Sheets backend.
 *
 * Install: open the spreadsheet > Extensions > Apps Script, replace Code.gs with this file,
 * then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 * Paste the /exec URL into the app's settings.
 *
 * GET  -> { ok, state: {updatedAt, data}, roster: [...], days: [...] }
 * POST (text/plain JSON body) with action:
 *   saveState { updatedAt, state }   live session + undo stack (State tab, chunked)
 *   stamp     { session, days, matches }  conclude a day (replaces rows of the same session)
 *   unstamp   { session }            remove a stamped session (undo of Done)
 *   roster    { roster }             replace the Players tab
 */

const TABS = {
  Days: ['Date', 'Session', 'Player', 'Played', 'Wins', 'Losses', 'SatOut', 'StampedAt'],
  Matches: ['Date', 'Session', 'Match', 'Mode', 'Side1', 'Side2', 'Side3', 'Winner', 'SatOut', 'Time'],
  Players: ['Name'],
  State: [0, 'Live session JSON (A1 = updated-at ms, A2:A = JSON chunks). Managed by the app, do not edit.'],
};
const CHUNK = 45000;

function doGet() {
  return out_(readAll_());
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (req.action) {
      case 'saveState': {
        const cur = readState_();
        if (cur.updatedAt > req.updatedAt) return out_({ ok: true, stale: true, state: cur });
        writeState_(req.updatedAt, req.state);
        return out_({ ok: true });
      }
      case 'stamp':
        unstamp_(req.session);
        append_('Days', req.days);
        append_('Matches', req.matches);
        return out_({ ok: true });
      case 'unstamp':
        unstamp_(req.session);
        return out_({ ok: true });
      case 'roster': {
        const sh = tab_('Players');
        if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).clearContent();
        if (req.roster.length) sh.getRange(2, 1, req.roster.length, 1).setValues(req.roster.map((n) => [n]));
        return out_({ ok: true });
      }
      default:
        return out_({ ok: false, error: 'Unknown action: ' + req.action });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function tab_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    const head = TABS[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]);
    if (name !== 'State') sh.setFrozenRows(1);
  }
  return sh;
}

function readAll_() {
  const tz = Session.getScriptTimeZone();
  const days = rows_('Days').map((r) => ({
    date: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : String(r[0]),
    session: String(r[1]),
    player: String(r[2]),
    played: +r[3] || 0,
    wins: +r[4] || 0,
    losses: +r[5] || 0,
    out: +r[6] || 0,
  }));
  const roster = rows_('Players')
    .map((r) => String(r[0]).trim())
    .filter(String);
  return { ok: true, state: readState_(), roster: roster, days: days };
}

function rows_(name) {
  const sh = tab_(name);
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh
    .getRange(2, 1, n, TABS[name].length)
    .getValues()
    .filter((r) => r[0] !== '' && r[0] !== null);
}

function readState_() {
  const sh = tab_('State');
  const updatedAt = +sh.getRange(1, 1).getValue() || 0;
  const n = sh.getLastRow() - 1;
  if (n < 1) return { updatedAt: updatedAt, data: null };
  const json = sh
    .getRange(2, 1, n, 1)
    .getValues()
    .map((r) => r[0])
    .join('');
  let data = null;
  try {
    data = json ? JSON.parse(json) : null;
  } catch (err) {}
  return { updatedAt: updatedAt, data: data };
}

function writeState_(updatedAt, data) {
  const sh = tab_('State');
  const json = JSON.stringify(data);
  const chunks = [];
  for (let i = 0; i < json.length; i += CHUNK) chunks.push([json.slice(i, i + CHUNK)]);
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 1).clearContent();
  if (chunks.length) {
    const r = sh.getRange(2, 1, chunks.length, 1);
    r.setNumberFormat('@');
    r.setValues(chunks);
  }
  sh.getRange(1, 1).setValue(updatedAt);
}

function append_(name, rows) {
  if (!rows || !rows.length) return;
  const sh = tab_(name);
  const width = TABS[name].length;
  const start = sh.getLastRow() + 1;
  const missing = start + rows.length - 1 - sh.getMaxRows();
  if (missing > 0) sh.insertRowsAfter(sh.getMaxRows(), missing);
  const r = sh.getRange(start, 1, rows.length, width);
  sh.getRange(start, 1, rows.length, 2).setNumberFormat('@');
  r.setValues(rows.map((row) => row.slice(0, width).concat(Array(Math.max(0, width - row.length)).fill(''))));
}

function unstamp_(session) {
  if (!session) return;
  ['Days', 'Matches'].forEach((name) => {
    const sh = tab_(name);
    const n = sh.getLastRow() - 1;
    if (n < 1) return;
    const ids = sh.getRange(2, 2, n, 1).getValues();
    for (let i = n - 1; i >= 0;) {
      if (String(ids[i][0]) !== String(session)) {
        i--;
        continue;
      }
      let j = i;
      while (j - 1 >= 0 && String(ids[j - 1][0]) === String(session)) j--;
      sh.deleteRows(j + 2, i - j + 1);
      i = j - 1;
    }
  });
}
