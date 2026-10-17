// Sign up, sign in, sign out, change password, and the current login.
import crypto from "node:crypto";
import { q } from "../lib/db.js";
import { send, fail, who, setSession, renewSession, clearSession, hashPassword, checkPassword, ownerEmails, newId, readBody } from "../lib/http.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_TRIES = 5;
const sha = s => crypto.createHash("sha256").update(String(s)).digest("base64url");
const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const weakPin = p => /^(\d)\1{3}$/.test(p) || ["1234", "2345", "3456", "4567", "5678", "6789", "4321", "9876", "0123"].includes(p);

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const me = await who(req);
      if (!me) return fail(res, 401, "unauthenticated", "Not signed in");
      renewSession(req, res);
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
      setSession(res, id, body.remember !== false);
      return send(res, 200, { ok: true });
    }
    if (action === "login") {
      await who(req);
      const email = String(body.email || "").trim().toLowerCase(), pw = String(body.password || "");
      const rows = await q(`select id, pass from fleet_users where email = $1`, [email]);
      if (!rows[0] || !(await checkPassword(pw, rows[0].pass))) return fail(res, 401, "bad_login", "Email or password is wrong.");
      setSession(res, rows[0].id, body.remember !== false);
      return send(res, 200, { ok: true });
    }
    // Quick sign-in with the PIN set on this phone.
    if (action === "pinlogin") {
      await who(req);
      const gone = () => fail(res, 404, "pin_gone", "PIN sign-in isn't set up on this phone. Sign in with your email and password.");
      const rows = await q(`select id, user_id, secret_hash, pin_hash, fails from fleet_pins where id = $1`, [String(body.device || "")]);
      const row = rows[0];
      if (!row || !sameHash(sha(body.secret || ""), row.secret_hash)) return gone();
      if (!(await checkPassword(String(body.pin || ""), row.pin_hash))) {
        const left = PIN_TRIES - (row.fails + 1);
        if (left <= 0) { await q(`delete from fleet_pins where id = $1`, [row.id]); return fail(res, 401, "pin_locked", "Too many wrong PINs. Sign in with your email and password."); }
        await q(`update fleet_pins set fails = fails + 1 where id = $1`, [row.id]);
        return fail(res, 401, "bad_pin", `Wrong PIN. ${left} ${left === 1 ? "try" : "tries"} left.`);
      }
      const u = await q(`select id, name from fleet_users where id = $1`, [row.user_id]);
      if (!u[0]) { await q(`delete from fleet_pins where id = $1`, [row.id]); return gone(); }
      await q(`update fleet_pins set fails = 0, used_at = now() where id = $1`, [row.id]);
      setSession(res, row.user_id, true);
      return send(res, 200, { ok: true });
    }
    if (action === "logout") { clearSession(res); return send(res, 200, { ok: true }); }

    const me = await who(req);
    if (!me) return fail(res, 401, "unauthenticated", "Not signed in");
    // Set or change the PIN for this phone (replaces this phone's earlier PIN).
    if (action === "pinset") {
      const pin = String(body.pin || "");
      if (!/^\d{4}$/.test(pin)) return fail(res, 400, "bad_request", "The PIN must be 4 digits.");
      if (weakPin(pin)) return fail(res, 400, "bad_request", "That PIN is too easy to guess. Avoid 1234 or the same digit four times.");
      if (body.device) await q(`delete from fleet_pins where id = $1 and user_id = $2`, [String(body.device), me.id]);
      const id = newId(), secret = newId(40);
      await q(`insert into fleet_pins (id, user_id, secret_hash, pin_hash) values ($1, $2, $3, $4)`, [id, me.id, sha(secret), await hashPassword(pin)]);
      return send(res, 200, { device: id, secret, user: { id: me.id, name: me.name, email: me.email } });
    }
    if (action === "pinoff") {
      await q(`delete from fleet_pins where id = $1 and user_id = $2`, [String(body.device || ""), me.id]);
      return send(res, 200, { ok: true });
    }
    if (action === "password") {
      const rows = await q(`select pass from fleet_users where id = $1`, [me.id]);
      if (!(await checkPassword(String(body.current || ""), rows[0]?.pass))) return fail(res, 400, "bad_login", "The current password is wrong.");
      if (String(body.next || "").length < 8) return fail(res, 400, "bad_request", "Use a new password of at least 8 characters.");
      await q(`update fleet_users set pass = $2 where id = $1`, [me.id, await hashPassword(String(body.next))]);
      await q(`delete from fleet_pins where user_id = $1 and id <> $2`, [me.id, String(body.device || "")]); // other phones must sign in again
      return send(res, 200, { ok: true });
    }
    // An admin sets a temporary password for someone who forgot theirs.
    if (action === "reset") {
      if (!me.admin) return fail(res, 403, "permission_denied", "Only an admin can reset passwords.");
      if (String(body.password || "").length < 8) return fail(res, 400, "bad_request", "Use a password of at least 8 characters.");
      const r = await q(`update fleet_users set pass = $2 where email = $1 returning id`, [String(body.email || "").trim().toLowerCase(), await hashPassword(String(body.password))]);
      if (!r.length) return fail(res, 404, "not_found", "No account with that email.");
      await q(`delete from fleet_pins where user_id = $1`, [r[0].id]); // a lost phone's PIN stops working too
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
