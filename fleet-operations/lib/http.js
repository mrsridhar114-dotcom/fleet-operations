import crypto from "node:crypto";
import { promisify } from "node:util";
import { q, ensureSchema } from "./db.js";

const scrypt = promisify(crypto.scrypt);
const COOKIE = "fo_session";
const DAYS = 30;

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
export const fail = (res, status, code, error) => send(res, status, { code, error });

function secret() {
  const s = process.env.SESSION_SECRET || "";
  if (s.length < 32) throw Object.assign(new Error("SESSION_SECRET must be at least 32 characters"), { status: 500 });
  return s;
}
const b64u = b => Buffer.from(b).toString("base64url");
const sign = v => crypto.createHmac("sha256", secret()).update(v).digest("base64url");

export function setSession(res, userId) {
  const body = b64u(JSON.stringify({ u: userId, e: Date.now() + DAYS * 864e5 }));
  const secure = process.env.VERCEL ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${body}.${sign(body)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${secure}`);
}
export function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
function readSession(req) {
  const raw = (req.headers.cookie || "").split(/;\s*/).find(c => c.startsWith(COOKIE + "="));
  if (!raw) return null;
  const [body, mac] = raw.slice(COOKIE.length + 1).split(".");
  if (!body || !mac) return null;
  const want = sign(body);
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  try { const s = JSON.parse(Buffer.from(body, "base64url").toString()); return s.e > Date.now() ? s.u : null; } catch { return null; }
}

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function checkPassword(pw, stored) {
  const [kind, salt, key] = String(stored).split("$");
  if (kind !== "scrypt") return false;
  const got = await scrypt(pw, Buffer.from(salt, "base64"), 64), want = Buffer.from(key, "base64");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export const ownerEmails = () => (process.env.OWNER_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

// Who is calling, and what they may do. Owners (OWNER_EMAILS) can do everything. Anyone else needs an Active user in the
// User master linked to their login; until then they can only read the user list and send an access request.
export async function who(req) {
  await ensureSchema();
  const uid = readSession(req);
  if (!uid) return null;
  const rows = await q(`select id, email, name from fleet_users where id = $1`, [uid]);
  const user = rows[0];
  if (!user) return null;
  const owner = ownerEmails().includes(user.email);
  let member = owner, admin = owner;
  if (!owner) {
    const r = await q(`select data->>'role' as role from fleet_docs where coll = 'appUsers' and not deleted and data->>'accountId' = $1 and data->>'status' = 'Active' limit 1`, [user.id]);
    member = r.length > 0; admin = r[0]?.role === "Admin";
  }
  return { ...user, owner, member, admin };
}

export function newId(n = 20) { return crypto.randomBytes(Math.max(16, n)).toString("base64url").replace(/[-_]/g, "").slice(0, n).padEnd(n, "0"); }

// Vercel parses JSON request bodies into req.body.
export async function readBody(req) {
  const b = req.body;
  if (typeof b === "string") { try { return JSON.parse(b || "{}"); } catch { return {}; } }
  if (Buffer.isBuffer(b)) { try { return JSON.parse(b.toString() || "{}"); } catch { return {}; } }
  return b && typeof b === "object" ? b : {};
}
