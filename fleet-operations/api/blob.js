// Attached files (photos and PDFs). Stored in the database; served at /_blob/<id> to signed-in, approved users.
import { q } from "../lib/db.js";
import { send, fail, who, newId } from "../lib/http.js";

const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
const MAX_FILE = 4 * 1024 * 1024; // Vercel functions accept request bodies up to about 4.5 MB, so bigger files arrive in parts
const MAX_TOTAL = 20 * 1024 * 1024; // largest file, sent as several parts of up to 3 MB
const PART_ID = /^[A-Za-z0-9_-]{8,64}$/;
const maxBytes = () => (Number(process.env.MAX_FILE_STORAGE_MB) || 400) * 1024 * 1024;
const MAX_FILES = 10000;

export default async function handler(req, res) {
  try {
    const me = await who(req);
    if (!me) return fail(res, 401, "unauthenticated", "Not signed in");
    if (!me.member) return fail(res, 403, "not_granted", "Your login is not approved yet.");
    const url = new URL(req.url, "http://x"), id = url.searchParams.get("id");

    if (req.method === "GET" && id) {
      const r = await q(`select type, name, size, parts, case when parts > 0 then '' else data end as data from fleet_blobs where id = $1`, [id]);
      if (!r[0]) { res.statusCode = 404; return res.end("Not found"); }
      if (Number(r[0].parts) > 0) {
        // A large file is sent one stored part at a time; streamed responses aren't held to the 4.5 MB limit.
        res.statusCode = 200;
        res.setHeader("Content-Type", r[0].type);
        res.setHeader("Content-Length", Number(r[0].size));
        res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (r[0].name) res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(r[0].name)}`);
        for (let i = 0; i < Number(r[0].parts); i++) {
          const p = await q(`select data from fleet_blob_parts where upload_id = $1 and idx = $2`, [id, i]);
          if (!p[0]) break;
          res.write(Buffer.from(p[0].data, "base64"));
        }
        return res.end();
      }
      const buf = Buffer.from(r[0].data, "base64");
      res.statusCode = 200;
      res.setHeader("Content-Type", r[0].type);
      res.setHeader("Content-Length", buf.length);
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (r[0].name) res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(r[0].name)}`);
      return res.end(buf);
    }
    if (req.method === "GET") {
      const rows = await q(`select id, type, size, created_at from fleet_blobs order by created_at`);
      const bytes = rows.reduce((a, r) => a + Number(r.size), 0);
      return send(res, 200, { assets: rows.map(r => ({ id: r.id, url: `/_blob/${r.id}`, contentType: r.type, sizeBytes: Number(r.size), createdAt: new Date(r.created_at).toISOString() })),
        usage: { files: rows.length, bytes, maxFiles: MAX_FILES, maxBytes: maxBytes() } });
    }
    if (req.method === "POST") {
      const type = String(req.headers["x-file-type"] || "").toLowerCase(), name = decodeURIComponent(String(req.headers["x-file-name"] || "")).slice(0, 200);
      const body = Buffer.isBuffer(req.body) ? req.body : req.body ? Buffer.from(req.body) : Buffer.alloc(0);
      if (!TYPES.includes(type)) return fail(res, 415, "unsupported_type", "Attach a PDF or a photo (JPG, PNG, WebP).");
      if (!body.length) return fail(res, 400, "bad_request", "The file is empty.");
      if (body.length > MAX_FILE) return fail(res, 413, "too_large", "Files can be up to 20 MB.");
      const parts = Number(req.headers["x-parts"] || 0);
      if (parts > 1) {
        // One part of a large file. Part 0 starts the upload and gets its id; the last part finishes it.
        const idx = Number(req.headers["x-part"]), total = Number(req.headers["x-file-size"] || 0);
        if (!Number.isInteger(idx) || idx < 0 || idx >= parts || parts > 10 || !(total > 0)) return fail(res, 400, "bad_request", "Bad file part.");
        if (total > MAX_TOTAL) return fail(res, 413, "too_large", "Files can be up to 20 MB.");
        let uid = String(req.headers["x-upload-id"] || "");
        if (idx === 0) {
          await q(`delete from fleet_blob_parts where created_at < now() - interval '1 day' and upload_id not in (select id from fleet_blobs)`);
          const used = await q(`select count(*)::int as n, coalesce(sum(size), 0)::bigint as b from fleet_blobs`);
          if (Number(used[0].n) >= MAX_FILES || Number(used[0].b) + total > maxBytes()) return fail(res, 507, "quota_or_state", "File storage is full.");
          uid = newId(32);
        } else if (!PART_ID.test(uid)) return fail(res, 400, "bad_request", "Bad file part.");
        await q(`insert into fleet_blob_parts (upload_id, idx, data, owner) values ($1, $2, $3, $4) on conflict (upload_id, idx) do update set data = excluded.data`, [uid, idx, body.toString("base64"), me.id]);
        if (idx < parts - 1) return send(res, 200, { uploadId: uid, part: idx });
        const got = await q(`select count(*)::int as n, coalesce(sum(length(data)), 0)::bigint as l from fleet_blob_parts where upload_id = $1`, [uid]);
        if (Number(got[0].n) !== parts) return fail(res, 400, "bad_request", "Some parts of the file are missing. Try again.");
        await q(`insert into fleet_blobs (id, type, name, size, data, owner, parts) values ($1, $2, $3, $4, '', $5, $6)`, [uid, type, name, total, me.id, parts]);
        return send(res, 200, { id: uid, url: `/_blob/${uid}`, sizeBytes: total, contentType: type });
      }
      const used = await q(`select count(*)::int as n, coalesce(sum(size), 0)::bigint as b from fleet_blobs`);
      if (Number(used[0].n) >= MAX_FILES || Number(used[0].b) + body.length > maxBytes()) return fail(res, 507, "quota_or_state", "File storage is full.");
      const nid = newId(32);
      await q(`insert into fleet_blobs (id, type, name, size, data, owner) values ($1, $2, $3, $4, $5, $6)`, [nid, type, name, body.length, body.toString("base64"), me.id]);
      return send(res, 200, { id: nid, url: `/_blob/${nid}`, sizeBytes: body.length, contentType: type });
    }
    if (req.method === "DELETE" && id) {
      const r = await q(`delete from fleet_blobs where id = $1 returning id`, [id]);
      await q(`delete from fleet_blob_parts where upload_id = $1`, [id]);
      return send(res, 200, { deleted: r.length > 0 });
    }
    return fail(res, 405, "bad_request", "Method not allowed");
  } catch (e) {
    console.error(e);
    return fail(res, e.status || 500, "unavailable", e.status ? e.message : "Server error");
  }
}
