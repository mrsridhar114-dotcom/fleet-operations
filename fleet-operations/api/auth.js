// Sign up, sign in, sign out, change password, and the current login.
import { q } from "../lib/db.js";
import { send, fail, who, setSession, clearSession, hashPassword, checkPassword, ownerEmails, newId, readBody } from "../lib/http.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const me = await who(req);
      if (!me) return fail(res, 401, "unauthenticated", "Not signed in");
      return send(res, 200, { user: { id: me.id, name: me.name, email: me.email, isOwner: me.owner, member: me.member, admin: me.admin } });
    }
    if (req.method !== "POST") return fail(res, 405, "bad_request", "Method not allowed");
    const body = await readBody(req), action = body.action;

    if (action === "signup") {
      const email = String(body.email || "").trim().toLowerCase(), name = String(body.name || "").trim().slice(0, 80), pw = String(body.password || "");
      if (!EMAIL.test(email)) return fail(res, 400, "bad_request", "Enter a valid email address.");
      if (!name) return fail(res, 400, "bad_request", "Enter your name.");
      if (pw.length < 8) return fail(res, 400, "bad_request", "Use a password of at least 8 characters.");
      if (process.env.ALLOW_SIGNUP === "false" && !ownerEmails().includes(email)) return fail(res, 403, "signup_closed", "New accounts are switched off. Ask the admin.");
      await who(req); // creates the tables on a new database
      const exists = await q(`select 1 from fleet_users where email = $1`, [email]);
      if (exists.length) return fail(res, 409, "exists", "An account with this email already exists. Sign in instead.");
      const id = newId();
      await q(`insert into fleet_users (id, email, name, pass) values ($1, $2, $3, $4)`, [id, email, name, await hashPassword(pw)]);
      setSession(res, id);
      return send(res, 200, { ok: true });
    }
    if (action === "login") {
      await who(req);
      const email = String(body.email || "").trim().toLowerCase(), pw = String(body.password || "");
      const rows = await q(`select id, pass from fleet_users where email = $1`, [email]);
      if (!rows[0] || !(await checkPassword(pw, rows[0].pass))) return fail(res, 401, "bad_login", "Email or password is wrong.");
      setSession(res, rows[0].id);
      return send(res, 200, { ok: true });
    }
    if (action === "logout") { clearSession(res); return send(res, 200, { ok: true }); }

    const me = await who(req);
    if (!me) return fail(res, 401, "unauthenticated", "Not signed in");
    if (action === "password") {
      const rows = await q(`select pass from fleet_users where id = $1`, [me.id]);
      if (!(await checkPassword(String(body.current || ""), rows[0]?.pass))) return fail(res, 400, "bad_login", "The current password is wrong.");
      if (String(body.next || "").length < 8) return fail(res, 400, "bad_request", "Use a new password of at least 8 characters.");
      await q(`update fleet_users set pass = $2 where id = $1`, [me.id, await hashPassword(String(body.next))]);
      return send(res, 200, { ok: true });
    }
    // An admin sets a temporary password for someone who forgot theirs.
    if (action === "reset") {
      if (!me.admin) return fail(res, 403, "permission_denied", "Only an admin can reset passwords.");
      if (String(body.password || "").length < 8) return fail(res, 400, "bad_request", "Use a password of at least 8 characters.");
      const r = await q(`update fleet_users set pass = $2 where email = $1 returning id`, [String(body.email || "").trim().toLowerCase(), await hashPassword(String(body.password))]);
      if (!r.length) return fail(res, 404, "not_found", "No account with that email.");
      return send(res, 200, { ok: true });
    }
    if (action === "profiles") {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).slice(0, 500);
      if (!ids.length) return send(res, 200, { profiles: {} });
      const rows = await q(`select id, name, email from fleet_users where id = any($1::text[])`, [ids]);
      return send(res, 200, { profiles: Object.fromEntries(rows.map(r => [r.id, { name: me.member ? `${r.name} (${r.email})` : r.name }])) });
    }
    return fail(res, 400, "bad_request", "Unknown action");
  } catch (e) {
    console.error(e);
    return fail(res, e.status || 500, "unavailable", e.status ? e.message : "Server error");
  }
}
