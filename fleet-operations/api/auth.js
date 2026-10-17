// Sign up, sign in, sign out, change password, and the current login.
import crypto from "node:crypto";
import { q } from "../lib/db.js";
import { sendMail, mailReady } from "../lib/mail.js";
import { send, fail, who, setSession, renewSession, clearSession, hashPassword, checkPassword, ownerEmails, newId, readBody } from "../lib/http.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PIN_TRIES = 5;
const sha = s => crypto.createHash("sha256").update(String(s)).digest("base64url");
const sameHash = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const weakPin = p => /^(\d)\1{3}$/.test(p) || ["1234", "2345", "3456", "4567", "5678", "6789", "4321", "9876", "0123"].includes(p);

// Emailed 6-digit codes, shared by "Forgot password?" and "Forgot PIN?". One live code per person, 15 minutes, 5 tries.
async function sendCode(res, email, name, what) {
  const last = await q(`select extract(epoch from (now() - sent_at)) as age from fleet_pw_codes where email = $1`, [email]);
  if (last[0] && Number(last[0].age) < 60) { fail(res, 429, "too_soon", "A code was just sent. Wait a minute before asking for another."); return false; }
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
  await q(`insert into fleet_pw_codes (email, code_hash, expires_at, tries, sent_at) values ($1, $2, now() + interval '15 minutes', 0, now())
           on conflict (email) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, tries = 0, sent_at = now()`, [email, await hashPassword(code)]);
  const first = String(name || "").split(/\s+/)[0];
  await sendMail({
    to: email, subject: `${code} is your VBS ${what} reset code`,
    text: `Hi ${first},\n\nYour code to reset your VBS fleet app ${what} is ${code}. It works for 15 minutes.\n\nIf you didn't ask for this, ignore this email; nothing changes.`,
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#18212b"><p>Hi ${first.replace(/[<>&]/g, "")},</p><p>Your code to reset your VBS fleet app ${what} is:</p><p style="font-size:30px;font-weight:bold;letter-spacing:6px;margin:16px 0">${code}</p><p>It works for 15 minutes.</p><p style="color:#5c6977">If you didn't ask for this, ignore this email; nothing changes.</p></div>`
  });
  return true;
}
// Checks a code; on a wrong one counts the try. Returns null when it is right, or [status, code, message].
async function checkCode(email, code) {
  const rows = await q(`select code_hash, tries, expires_at > now() as live from fleet_pw_codes where email = $1`, [email]);
  const row = rows[0];
  if (!row || !row.live) return [400, "code_expired", "This code has expired. Ask for a new one."];
  if (await checkPassword(String(code || ""), row.code_hash)) return null;
  const left = 5 - (row.tries + 1);
  if (left <= 0) { await q(`delete from fleet_pw_codes where email = $1`, [email]); return [400, "code_expired", "Too many wrong codes. Ask for a new one."]; }
  await q(`update fleet_pw_codes set tries = tries + 1 where email = $1`, [email]);
  return [400, "bad_code", `Wrong code. ${left} ${left === 1 ? "try" : "tries"} left.`];
}
// Wrong-password limit: after LOGIN_TRIES wrong passwords in a row, sign-in for that email is paused for LOCK_MINUTES.
const LOGIN_TRIES = 8, LOCK_MINUTES = 15;
async function loginLocked(email) {
  const r = await q(`select ceil(extract(epoch from (locked_until - now())) / 60) as mins from fleet_login_fails where email = $1 and locked_until > now()`, [email]);
  return r[0] ? Math.max(1, Number(r[0].mins)) : 0;
}
async function loginFailed(email) {
  // Counts reset if the last wrong try was more than an hour ago.
  const r = await q(`insert into fleet_login_fails (email, fails, last_at) values ($1, 1, now())
    on conflict (email) do update set fails = case when fleet_login_fails.last_at < now() - interval '1 hour' then 1 else fleet_login_fails.fails + 1 end, last_at = now()
    returning fails`, [email]);
  const fails = Number(r[0].fails);
  if (fails >= LOGIN_TRIES) {
    await q(`update fleet_login_fails set fails = 0, locked_until = now() + interval '${LOCK_MINUTES} minutes' where email = $1`, [email]);
    return -1;
  }
  return LOGIN_TRIES - fails;
}
const clearLoginFails = email => q(`delete from fleet_login_fails where email = $1`, [email]);

// Security emails: tell the person when their password or PIN changes, or when sign-in gets locked. Never blocks the action.
async function securityMail(email, name, subject, line) {
  if (!mailReady() || !email) return;
  const when = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  const first = String(name || "").split(/\s+/)[0].replace(/[<>&]/g, "");
  const tail = "If this was you, there's nothing to do. If it wasn't, reset your password from the sign-in page (Forgot password?) and tell your admin straight away.";
  try {
    await sendMail({ to: email, subject: `VBS fleet app: ${subject}`,
      text: `Hi ${first},\n\n${line} (${when} IST)\n\n${tail}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#18212b"><p>Hi ${first},</p><p>${line} <span style="color:#5c6977">(${when} IST)</span></p><p style="color:#5c6977">${tail}</p></div>` });
  } catch (e) { console.error("security mail", e); }
}
const maskEmail = e => e.replace(/^(.)(.*)(.@.*)$/, (m, a, mid, b) => a + "*".repeat(Math.min(mid.length, 6)) + b);
// The PIN row for this phone, checked against the phone's secret.
async function pinRow(body) {
  const rows = await q(`select p.id, p.user_id, p.secret_hash, u.email, u.name from fleet_pins p join fleet_users u on u.id = p.user_id where p.id = $1`, [String(body.device || "")]);
  const row = rows[0];
  return row && sameHash(sha(body.secret || ""), row.secret_hash) ? row : null;
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const me = await who(req);
      if (!me) return fail(res, 401, "unauthenticated", "Not signed in");
      renewSession(req, res);
      return send(res, 200, { user: { id: me.id, name: me.name, email: me.email, isOwner: me.owner, member: me.member, admin: me.admin, mustChange: !!me.must_change } });
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
      const lockedFor = await loginLocked(email);
      if (lockedFor) return fail(res, 429, "locked", `Too many wrong passwords. Try again in ${lockedFor} minute${lockedFor === 1 ? "" : "s"}, or tap "Forgot password?".`);
      const rows = await q(`select id, name, pass from fleet_users where email = $1`, [email]);
      if (!rows[0] || !(await checkPassword(pw, rows[0].pass))) {
        const left = await loginFailed(email);
        if (left < 0) {
          if (rows[0]) await securityMail(email, rows[0].name, "sign-in paused after wrong passwords", `Someone entered a wrong password for your account ${LOGIN_TRIES} times, so sign-in is paused for ${LOCK_MINUTES} minutes.`);
          return fail(res, 429, "locked", `Too many wrong passwords. Sign-in is paused for ${LOCK_MINUTES} minutes. Tap "Forgot password?" to reset it.`);
        }
        return fail(res, 401, "bad_login", left <= 3 ? `Email or password is wrong. ${left} ${left === 1 ? "try" : "tries"} left before sign-in is paused.` : "Email or password is wrong.");
      }
      await clearLoginFails(email);
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
    // "Forgot password?" step 1: email a 6-digit code. The reply never says whether the email has an account.
    if (action === "forgot") {
      await who(req);
      const email = String(body.email || "").trim().toLowerCase();
      if (!EMAIL.test(email)) return fail(res, 400, "bad_request", "Enter a valid email address.");
      if (!mailReady()) return fail(res, 503, "mail_off", "Password reset by email isn't set up yet. Ask your admin to reset your password.");
      const u = await q(`select name from fleet_users where email = $1`, [email]);
      if (!u[0]) return send(res, 200, { ok: true });
      if (!(await sendCode(res, email, u[0].name, "password"))) return;
      return send(res, 200, { ok: true });
    }
    // Step 2: the code plus a new password. Signs the person in.
    if (action === "resetcode") {
      await who(req);
      const email = String(body.email || "").trim().toLowerCase(), code = String(body.code || "").trim(), next = String(body.password || "");
      if (next.length < 8) return fail(res, 400, "bad_request", "Use a new password of at least 8 characters.");
      const bad = await checkCode(email, code);
      if (bad) return fail(res, ...bad);
      const u = await q(`update fleet_users set pass = $2, must_change = false where email = $1 returning id, name`, [email, await hashPassword(next)]);
      await q(`delete from fleet_pw_codes where email = $1`, [email]);
      if (!u[0]) return fail(res, 400, "code_expired", "This code has expired. Ask for a new one.");
      await q(`delete from fleet_pins where user_id = $1`, [u[0].id]); // PINs set with the old password stop working
      await clearLoginFails(email);
      await securityMail(email, u[0].name, "your password was changed", "Your password was reset using a code sent to this email. Any PIN set on your phones was removed.");
      setSession(res, u[0].id, body.remember !== false);
      return send(res, 200, { ok: true });
    }
    // "Forgot PIN?" on a phone that has a PIN: email a code to the PIN's owner (no password needed).
    if (action === "pinforgot") {
      await who(req);
      const row = await pinRow(body);
      if (!row) return fail(res, 404, "pin_gone", "PIN sign-in isn't set up on this phone. Sign in with your email and password.");
      if (!mailReady()) return fail(res, 503, "mail_off", "PIN reset by email isn't set up yet. Sign in with your email and password.");
      if (!(await sendCode(res, row.email, row.name, "PIN"))) return;
      return send(res, 200, { ok: true, email: maskEmail(row.email) });
    }
    // Check the emailed code; if right, swap it for a one-time key that allows choosing the new PIN within 10 minutes.
    if (action === "pinverify") {
      await who(req);
      const row = await pinRow(body);
      if (!row) return fail(res, 404, "pin_gone", "PIN sign-in isn't set up on this phone. Sign in with your email and password.");
      const bad = await checkCode(row.email, String(body.code || "").trim());
      if (bad) return fail(res, ...bad);
      const key = newId(40);
      await q(`update fleet_pw_codes set code_hash = $2, tries = 0, expires_at = now() + interval '10 minutes' where email = $1`, [row.email, await hashPassword(key)]);
      return send(res, 200, { key });
    }
    if (action === "pinreset") {
      await who(req);
      const row = await pinRow(body);
      if (!row) return fail(res, 404, "pin_gone", "PIN sign-in isn't set up on this phone. Sign in with your email and password.");
      const pin = String(body.pin || "");
      if (!/^\d{4}$/.test(pin)) return fail(res, 400, "bad_request", "The PIN must be 4 digits.");
      if (weakPin(pin)) return fail(res, 400, "bad_request", "That PIN is too easy to guess. Avoid 1234 or the same digit four times.");
      const bad = await checkCode(row.email, String(body.key || ""));
      if (bad) return fail(res, 400, "code_expired", "This reset has expired. Tap Forgot PIN? again.");
      await q(`delete from fleet_pw_codes where email = $1`, [row.email]);
      await q(`update fleet_pins set pin_hash = $2, fails = 0, used_at = now() where id = $1`, [row.id, await hashPassword(pin)]);
      await securityMail(row.email, row.name, "your PIN was changed", "The PIN for the VBS fleet app on one of your phones was reset using a code sent to this email.");
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
      // After a temporary password the person is already signed in with it, so it isn't asked again.
      if (!me.must_change && !(await checkPassword(String(body.current || ""), rows[0]?.pass))) return fail(res, 400, "bad_login", "The current password is wrong.");
      if (String(body.next || "").length < 8) return fail(res, 400, "bad_request", "Use a new password of at least 8 characters.");
      await q(`update fleet_users set pass = $2, must_change = false where id = $1`, [me.id, await hashPassword(String(body.next))]);
      await q(`delete from fleet_pins where user_id = $1 and id <> $2`, [me.id, String(body.device || "")]); // other phones must sign in again
      await clearLoginFails(me.email);
      await securityMail(me.email, me.name, "your password was changed", "Your password was changed from inside the app. PINs on your other phones were removed.");
      return send(res, 200, { ok: true });
    }
    // An admin sets a temporary password for someone who forgot theirs.
    if (action === "reset") {
      if (!me.admin) return fail(res, 403, "permission_denied", "Only an admin can reset passwords.");
      if (String(body.password || "").length < 8) return fail(res, 400, "bad_request", "Use a password of at least 8 characters.");
      const email = String(body.email || "").trim().toLowerCase();
      const r = await q(`update fleet_users set pass = $2, must_change = true where email = $1 returning id, name`, [email, await hashPassword(String(body.password))]);
      if (!r.length) return fail(res, 404, "not_found", "No account with that email.");
      await q(`delete from fleet_pins where user_id = $1`, [r[0].id]); // a lost phone's PIN stops working too
      await clearLoginFails(email);
      await securityMail(email, r[0].name, "an admin reset your password", `${String(me.name || "An admin").replace(/[<>&]/g, "")} set a temporary password for your account. You'll be asked to choose a new one when you sign in. Any PIN on your phones was removed.`);
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
