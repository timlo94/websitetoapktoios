/**
 * db.js — SQLite Database Layer (via sql.js — pure JS, no native deps)
 *
 * Tables:
 *   scans      — every URL scan with timestamp and file count
 *   files      — individual files per scan (id, path, type, hash, size)
 *   changelogs — computed diff between consecutive scans
 */

const initSqlJs = require('sql.js');
const path = require('path');
const fs   = require('fs');

const DB_PATH = path.join(__dirname, '../../server/data/webapk.db');

let db = null;

async function getDb() {
  if (db) return db;

  // Ensure data dir exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const SQL = await initSqlJs();

  // Load existing DB from disk or create fresh
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  // Create schema
  db.run(`
    CREATE TABLE IF NOT EXISTS scans (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      url         TEXT    NOT NULL,
      snapshot_id TEXT    NOT NULL UNIQUE,
      file_count  INTEGER NOT NULL DEFAULT 0,
      scanned_at  INTEGER NOT NULL
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      scan_id     INTEGER NOT NULL,
      file_path   TEXT    NOT NULL,
      file_type   TEXT,
      hash        TEXT,
      size        INTEGER,
      FOREIGN KEY(scan_id) REFERENCES scans(id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS changelogs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      from_scan_id INTEGER,
      to_scan_id   INTEGER NOT NULL,
      url          TEXT    NOT NULL,
      added        TEXT,
      modified     TEXT,
      deleted      TEXT,
      summary      TEXT,
      is_first     INTEGER DEFAULT 0,
      created_at   INTEGER NOT NULL,
      FOREIGN KEY(from_scan_id) REFERENCES scans(id),
      FOREIGN KEY(to_scan_id)   REFERENCES scans(id)
    );
  `);

  persist();
  return db;
}

/** Flush in-memory DB to disk */
function persist() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/* ─────────────────────────────────────────────────
   SCAN operations
───────────────────────────────────────────────── */

/** Insert a new scan record + its files. Returns the scan row id. */
async function insertScan(snapshot) {
  const d = await getDb();

  d.run(
    `INSERT INTO scans (url, snapshot_id, file_count, scanned_at) VALUES (?,?,?,?)`,
    [snapshot.url, snapshot.id, snapshot.fileCount, snapshot.timestamp]
  );

  // Get the inserted row id
  const row = d.exec(`SELECT last_insert_rowid() as id`);
  const scanId = row[0].values[0][0];

  // Insert file rows
  const stmt = d.prepare(
    `INSERT INTO files (scan_id, file_path, file_type, hash, size) VALUES (?,?,?,?,?)`
  );
  for (const f of (snapshot.files || [])) {
    stmt.run([scanId, f.id, f.type || null, f.hash || null, f.size || 0]);
  }
  stmt.free();

  persist();
  return scanId;
}

/** Get the two most recent scans for a given URL (ordered newest first) */
async function getLatestScansForUrl(url) {
  const d = await getDb();
  const res = d.exec(
    `SELECT id, url, snapshot_id, file_count, scanned_at
     FROM scans WHERE url = ? ORDER BY scanned_at DESC LIMIT 2`,
    [url]
  );
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = row[i]);
    return obj;
  });
}

/** Get files for a scan id */
async function getFilesForScan(scanId) {
  const d = await getDb();
  const res = d.exec(
    `SELECT file_path, file_type, hash, size FROM files WHERE scan_id = ?`,
    [scanId]
  );
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = row[i]);
    return obj;
  });
}

/* ─────────────────────────────────────────────────
   CHANGELOG operations
───────────────────────────────────────────────── */

/** Insert a changelog entry */
async function insertChangelog(fromScanId, toScanId, url, diff) {
  const d = await getDb();
  d.run(
    `INSERT INTO changelogs
      (from_scan_id, to_scan_id, url, added, modified, deleted, summary, is_first, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      fromScanId || null,
      toScanId,
      url,
      JSON.stringify(diff.added    || []),
      JSON.stringify(diff.modified || []),
      JSON.stringify(diff.deleted  || []),
      diff.summary || '',
      diff.isFirstScan ? 1 : 0,
      Date.now(),
    ]
  );
  persist();
}

/** Get all changelogs for a URL (newest first) */
async function getChangelogsForUrl(url, limit = 20) {
  const d = await getDb();
  const res = d.exec(
    `SELECT cl.id, cl.from_scan_id, cl.to_scan_id, cl.url, cl.added, cl.modified,
            cl.deleted, cl.summary, cl.is_first, cl.created_at,
            s.scanned_at as scan_time, s.file_count
     FROM changelogs cl
     LEFT JOIN scans s ON s.id = cl.to_scan_id
     WHERE cl.url = ?
     ORDER BY cl.created_at DESC
     LIMIT ?`,
    [url, limit]
  );
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = row[i]);
    // Parse JSON arrays back
    obj.added    = tryParse(obj.added,    []);
    obj.modified = tryParse(obj.modified, []);
    obj.deleted  = tryParse(obj.deleted,  []);
    return obj;
  });
}

/** Get all changelogs (across all URLs), newest first */
async function getAllChangelogs(limit = 50) {
  const d = await getDb();
  const res = d.exec(
    `SELECT cl.id, cl.from_scan_id, cl.to_scan_id, cl.url, cl.added, cl.modified,
            cl.deleted, cl.summary, cl.is_first, cl.created_at,
            s.scanned_at as scan_time, s.file_count
     FROM changelogs cl
     LEFT JOIN scans s ON s.id = cl.to_scan_id
     ORDER BY cl.created_at DESC
     LIMIT ?`,
    [limit]
  );
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = row[i]);
    obj.added    = tryParse(obj.added,    []);
    obj.modified = tryParse(obj.modified, []);
    obj.deleted  = tryParse(obj.deleted,  []);
    return obj;
  });
}

/** Get all scans summary */
async function getAllScans(limit = 50) {
  const d = await getDb();
  const res = d.exec(
    `SELECT id, url, snapshot_id, file_count, scanned_at
     FROM scans ORDER BY scanned_at DESC LIMIT ?`,
    [limit]
  );
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map(row => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = row[i]);
    return obj;
  });
}

function tryParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = {
  getDb,
  insertScan,
  getLatestScansForUrl,
  getFilesForScan,
  insertChangelog,
  getChangelogsForUrl,
  getAllChangelogs,
  getAllScans,
  persist,
};
