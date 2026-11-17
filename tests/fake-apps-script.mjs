// Minimal in-memory stand-in for the Apps Script services used by apps-script/Code.gs.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class Sheet {
  constructor(name, rows = 1000) {
    this.name = name;
    this.data = [];
    this.maxRows = rows;
  }
  getLastRow() {
    for (let r = this.data.length; r > 0; r--) if ((this.data[r - 1] || []).some((v) => v !== '')) return r;
    return 0;
  }
  getMaxRows() {
    return this.maxRows;
  }
  insertRowsAfter(_after, n) {
    this.maxRows += n;
  }
  setFrozenRows() {}
  deleteRows(start, n) {
    this.data.splice(start - 1, n);
  }
  getRange(row, col, nr = 1, nc = 1) {
    if (row + nr - 1 > this.maxRows)
      throw new Error(`Range exceeds grid (${row + nr - 1} > ${this.maxRows})`);
    const sh = this;
    const cell = (r, c) => (sh.data[r - 1] ||= [])[c - 1] ?? '';
    const set = (r, c, v) => {
      const line = (sh.data[r - 1] ||= []);
      while (line.length < c - 1) line.push('');
      line[c - 1] = v;
    };
    return {
      getRow: () => row,
      getValue: () => cell(row, col),
      setValue: (v) => set(row, col, v),
      getValues: () =>
        Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(row + i, col + j))),
      setValues: (vals) => vals.forEach((line, i) => line.forEach((v, j) => set(row + i, col + j, v))),
      clearContent: () => {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) set(row + i, col + j, '');
      },
      setNumberFormat() {},
    };
  }
}

export function loadAppsScript() {
  const sheets = new Map();
  const ss = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => {
      const s = new Sheet(n);
      sheets.set(n, s);
      return s;
    },
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({
        text,
        setMimeType() {
          return this;
        },
      }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);
  return {
    sheets,
    get: () => JSON.parse(ctx.doGet().text),
    post: (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text),
  };
}
