// The shared records. Every collection the app uses (vehicles, drivers, trips, bookings, history…) is a set of JSON documents
// in one table. Clients pull changes with "sync" (by version number) and write one document at a time.
import { q } from "../lib/db.js";
import { send, fail, who, readBody } from "../lib/http.js";
import { canRead, canWrite, readScope } from "../lib/access.js";

const COLL = /^[A-Za-z0-9_]{1,64}$/, ID = /^[A-Za-z0-9_\-:.@]{1,200}$/;
const OPEN = ["appUsers", "accessRequests"]; // what someone not yet approved may read
const MAX_DOC = 256 * 1024;
const KEEP_DAYS = 30; // deleted records can be restored for this long
const ALL_COLLS = ["bookings", "bookingHistory", "auditLog", "auditSessions"]; // the ones canRead may hide

// A diesel fill belongs to a closed trip when the booking it is linked to (before or after the change) is closed.
async function fuelTripClosed(coll, prev, next) {
  if (coll !== "fuelLog") return false;
  const ids = [...new Set([prev?.bookingId, next?.bookingId].filter(x => typeof x === "string" && x))];
  if (!ids.length) return false;
  const r = await q(`select 1 from fleet_docs where coll = 'bookings' and id = any($1::text[]) and not deleted and coalesce(data->>'closedOn', '') <> '' limit 1`, [ids]);
  return r.length > 0;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return fail(res, 405, "bad_request", "Method not allowed");
    const me = await who(req);
    if (!me) return fail(res, 401, "unauthenticated", "Not signed in");
    const b = await readBody(req), op = b.op;

    if (op === "sync") {
      const since = Math.max(0, Number(b.since) || 0), limit = Math.min(5000, Math.max(100, Number(b.limit) || 3000));
      const hidden = ALL_COLLS.filter(c => !canRead(me.access, c));
      const rows = me.member
        ? await q(`select coll, id, data, deleted, ver from fleet_docs where ver > $1 and coll <> all($3::text[]) order by ver limit $2`, [since, limit, hidden])
        : await q(`select coll, id, data, deleted, ver from fleet_docs where ver > $1 and coll = any($3::text[]) order by ver limit $2`, [since, limit, OPEN]);
      const out = rows.map(r => ({ c: r.coll, id: r.id, d: r.deleted ? null : r.data, v: Number(r.ver) }));
      return send(res, 200, { rows: out, more: out.length === limit, ver: out.length ? out[out.length - 1].v : since, scope: me.member ? readScope(me.access) : "limited" });
    }

    if (op === "set" || op === "update" || op === "delete") {
      const coll = String(b.coll || ""), id = String(b.id || "");
      if (!COLL.test(coll) || !ID.test(id)) return fail(res, 400, "invalid_argument", "Bad collection or id");
      // Not yet approved: only their own access request.
      if (!me.member && !(coll === "accessRequests" && id === me.id)) return fail(res, 403, "permission_denied", "Your login is not approved yet.");
      const cur = await q(`select data from fleet_docs where coll = $1 and id = $2 and not deleted`, [coll, id]);
      const prev = cur[0]?.data || null;
      if (op === "delete") {
        if (!prev) return send(res, 200, { ok: true, ver: 0 });
        const why = canWrite(me.access, me, op, coll, id, prev, null, await fuelTripClosed(coll, prev, null));
        if (why) return fail(res, 403, "permission_denied", why);
        // The record goes to the recycle bin first, so an admin can bring it back for 30 days.
        await q(`insert into fleet_trash (coll, id, data, deleted_by, deleted_by_name) values ($1, $2, $3::jsonb, $4, $5)`, [coll, id, JSON.stringify(prev), me.id, me.name || me.email]);
        await q(`delete from fleet_trash where deleted_at < now() - interval '${KEEP_DAYS} days'`);
        const r = await q(`update fleet_docs set deleted = true, data = '{}'::jsonb, ver = nextval('fleet_ver'), updated_at = now() where coll = $1 and id = $2 returning ver`, [coll, id]);
        return send(res, 200, { ok: true, ver: Number(r[0]?.ver || 0) });
      }
      const data = b.data && typeof b.data === "object" && !Array.isArray(b.data) ? b.data : null;
      if (!data) return fail(res, 400, "invalid_argument", "Data must be an object");
      const next = op === "update" ? { ...(prev || {}), ...data } : data;
      const why = canWrite(me.access, me, op, coll, id, prev, next, await fuelTripClosed(coll, prev, next));
      if (why) return fail(res, 403, "permission_denied", why);
      const json = JSON.stringify(data);
      if (Buffer.byteLength(json) > MAX_DOC) return fail(res, 400, "invalid_argument", "Record is larger than 256 KB");
      if (op === "set") {
        const r = await q(`insert into fleet_docs (coll, id, data, ver, deleted) values ($1, $2, $3::jsonb, nextval('fleet_ver'), false)
          on conflict (coll, id) do update set data = excluded.data, ver = excluded.ver, deleted = false, updated_at = now() returning ver`, [coll, id, json]);
        return send(res, 200, { ok: true, ver: Number(r[0].ver) });
      }
      const r = await q(`update fleet_docs set data = data || $3::jsonb, ver = nextval('fleet_ver'), updated_at = now() where coll = $1 and id = $2 and not deleted returning ver`, [coll, id, json]);
      if (!r.length) return fail(res, 404, "not_found", "No such record");
      return send(res, 200, { ok: true, ver: Number(r[0].ver) });
    }

    // Admins: the recycle bin. Records deleted in the last 30 days, newest first, and putting one back.
    if (op === "trash" || op === "restore") {
      if (me.access?.users !== "edit") return fail(res, 403, "permission_denied", "Only an admin can see deleted records.");
      await q(`delete from fleet_trash where deleted_at < now() - interval '${KEEP_DAYS} days'`);
      if (op === "trash") {
        const rows = await q(`select tid, coll, id, data, deleted_by_name, deleted_at from fleet_trash order by deleted_at desc limit 300`);
        return send(res, 200, { items: rows.map(r => ({ tid: Number(r.tid), coll: r.coll, id: r.id, data: r.data, by: r.deleted_by_name || "", at: new Date(r.deleted_at).toISOString() })), keepDays: KEEP_DAYS });
      }
      const t = (await q(`select coll, id, data from fleet_trash where tid = $1`, [Number(b.tid) || 0]))[0];
      if (!t) return fail(res, 404, "not_found", "This record is no longer in the recycle bin.");
      const live = await q(`select 1 from fleet_docs where coll = $1 and id = $2 and not deleted`, [t.coll, t.id]);
      if (live.length) return fail(res, 409, "exists", "A record with the same id exists again, so this one can't be put back.");
      const r = await q(`insert into fleet_docs (coll, id, data, ver, deleted) values ($1, $2, $3::jsonb, nextval('fleet_ver'), false)
        on conflict (coll, id) do update set data = excluded.data, ver = excluded.ver, deleted = false, updated_at = now() returning ver`, [t.coll, t.id, JSON.stringify(t.data)]);
      await q(`delete from fleet_trash where tid = $1`, [Number(b.tid)]);
      return send(res, 200, { ok: true, ver: Number(r[0].ver) });
    }

    // Owner only: load a backup file made with "Full backup (JSON)", a batch at a time.
    if (op === "import") {
      if (!me.owner) return fail(res, 403, "permission_denied", "Only the owner can import a backup.");
      const docs = Array.isArray(b.docs) ? b.docs.slice(0, 500) : [];
      let n = 0;
      for (const d of docs) {
        const coll = String(d.coll || ""), id = String(d.id || "");
        if (!COLL.test(coll) || !ID.test(id) || !d.data || typeof d.data !== "object") continue;
        await q(`insert into fleet_docs (coll, id, data, ver, deleted) values ($1, $2, $3::jsonb, nextval('fleet_ver'), false)
          on conflict (coll, id) do update set data = excluded.data, ver = excluded.ver, deleted = false, updated_at = now()`, [coll, id, JSON.stringify(d.data)]);
        n++;
      }
      return send(res, 200, { ok: true, imported: n });
    }
    return fail(res, 400, "bad_request", "Unknown op");
  } catch (e) {
    console.error(e);
    return fail(res, e.status || 500, "unavailable", e.status ? e.message : "Server error");
  }
}
