// The shared records. Every collection the app uses (vehicles, drivers, trips, bookings, history…) is a set of JSON documents
// in one table. Clients pull changes with "sync" (by version number) and write one document at a time.
import { q } from "../lib/db.js";
import { send, fail, who, readBody } from "../lib/http.js";

const COLL = /^[A-Za-z0-9_]{1,64}$/, ID = /^[A-Za-z0-9_\-:.@]{1,200}$/;
const OPEN = ["appUsers", "accessRequests"]; // what someone not yet approved may read
const MAX_DOC = 256 * 1024;

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return fail(res, 405, "bad_request", "Method not allowed");
    const me = await who(req);
    if (!me) return fail(res, 401, "unauthenticated", "Not signed in");
    const b = await readBody(req), op = b.op;

    if (op === "sync") {
      const since = Math.max(0, Number(b.since) || 0), limit = Math.min(5000, Math.max(100, Number(b.limit) || 3000));
      const rows = me.member
        ? await q(`select coll, id, data, deleted, ver from fleet_docs where ver > $1 order by ver limit $2`, [since, limit])
        : await q(`select coll, id, data, deleted, ver from fleet_docs where ver > $1 and coll = any($3::text[]) order by ver limit $2`, [since, limit, OPEN]);
      const out = rows.map(r => ({ c: r.coll, id: r.id, d: r.deleted ? null : r.data, v: Number(r.ver) }));
      return send(res, 200, { rows: out, more: out.length === limit, ver: out.length ? out[out.length - 1].v : since, scope: me.member ? "member" : "limited" });
    }

    if (op === "set" || op === "update" || op === "delete") {
      const coll = String(b.coll || ""), id = String(b.id || "");
      if (!COLL.test(coll) || !ID.test(id)) return fail(res, 400, "invalid_argument", "Bad collection or id");
      // Not yet approved: only their own access request.
      if (!me.member && !(coll === "accessRequests" && id === me.id)) return fail(res, 403, "permission_denied", "Your login is not approved yet.");
      if (op === "delete") {
        const r = await q(`update fleet_docs set deleted = true, data = '{}'::jsonb, ver = nextval('fleet_ver'), updated_at = now() where coll = $1 and id = $2 returning ver`, [coll, id]);
        return send(res, 200, { ok: true, ver: Number(r[0]?.ver || 0) });
      }
      const data = b.data && typeof b.data === "object" && !Array.isArray(b.data) ? b.data : null;
      if (!data) return fail(res, 400, "invalid_argument", "Data must be an object");
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
