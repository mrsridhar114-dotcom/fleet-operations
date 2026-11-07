// Backups: every live record of every collection, as one JSON file the app can load back (Storage › Backup & restore).
import { q } from "./db.js";

// One page of records, oldest change first, after version `since`, kept under about `budget` bytes (a response may be
// at most 4.5 MB on Vercel). `next` is the version to ask from next time; `more` says whether to ask again.
export async function backupPage(since = 0, budget = 3e6) {
  const LIMIT = 2000, rows = await q(`select coll, id, data, ver from fleet_docs where not deleted and ver > $1 order by ver limit ${LIMIT}`, [since]);
  const out = []; let size = 0, next = since;
  for (const r of rows) {
    const s = JSON.stringify(r.data).length + String(r.id).length + String(r.coll).length + 24;
    if (out.length && size + s > budget) break;
    out.push({ c: r.coll, id: r.id, d: r.data }); size += s; next = Number(r.ver);
  }
  return { rows: out, next, more: out.length < rows.length || rows.length === LIMIT };
}

// The backup file: { app, kind: "backup", version: 2, exportedAt, exportedBy, counts, collections: { coll: [{ id, ...data }] } }.
export function backupFile(rows, by) {
  const collections = {};
  for (const r of rows) (collections[r.c] ||= []).push({ id: r.id, ...(r.d || {}) });
  const counts = Object.fromEntries(Object.entries(collections).map(([k, v]) => [k, v.length]));
  return { app: "Fleet Operations", kind: "backup", version: 2, exportedAt: new Date().toISOString(), exportedBy: by, counts, collections };
}

// Every record at once (the weekly backup email).
export async function backupAll(by) {
  const rows = []; let since = 0;
  for (;;) { const p = await backupPage(since, 2e7); rows.push(...p.rows); since = p.next; if (!p.more || !p.rows.length) break; }
  return backupFile(rows, by);
}
