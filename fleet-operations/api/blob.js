// Attached files (photos and PDFs). Stored in the database; served at /_blob/<id> to signed-in, approved users.
import { q } from "../lib/db.js";
import { send, fail, who, newId } from "../lib/http.js";

const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
const MAX_FILE = 4 * 1024 * 1024; // Vercel functions accept request bodies up to about 4.5 MB
const maxBytes = () => (Number(process.env.MAX_FILE_STORAGE_MB) || 400) * 1024 * 1024;
const MAX_FILES = 10000;

export default async function handler(req, res) {
  try {
    const me = await who(req);
    if (!me) return fail(res, 401, "unauthenticated", "Not signed in");
    if (!me.member) return fail(res, 403, "not_granted", "Your login is not approved yet.");
    const url = new URL(req.url, "http://x"), id = url.searchParams.get("id");

    if (req.method === "GET" && id) {
      const r = await q(`select type, name, data from fleet_blobs where id = $1`, [id]);
      if (!r[0]) { res.statusCode = 404; return res.end("Not found"); }
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
      if (body.length > MAX_FILE) return fail(res, 413, "too_large", "Files can be up to 4 MB.");
      const used = await q(`select count(*)::int as n, coalesce(sum(size), 0)::bigint as b from fleet_blobs`);
      if (Number(used[0].n) >= MAX_FILES || Number(used[0].b) + body.length > maxBytes()) return fail(res, 507, "quota_or_state", "File storage is full.");
      const nid = newId(32);
      await q(`insert into fleet_blobs (id, type, name, size, data, owner) values ($1, $2, $3, $4, $5, $6)`, [nid, type, name, body.length, body.toString("base64"), me.id]);
      return send(res, 200, { id: nid, url: `/_blob/${nid}`, sizeBytes: body.length, contentType: type });
    }
    if (req.method === "DELETE" && id) {
      const r = await q(`delete from fleet_blobs where id = $1 returning id`, [id]);
      return send(res, 200, { deleted: r.length > 0 });
    }
    return fail(res, 405, "bad_request", "Method not allowed");
  } catch (e) {
    console.error(e);
    return fail(res, e.status || 500, "unavailable", e.status ? e.message : "Server error");
  }
}
