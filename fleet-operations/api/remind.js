// Daily reminders and the weekly backup, by email.
// GET  (Vercel Cron, every day at 8:00 am India time, see vercel.json): needs the CRON_SECRET setting. Emails the renewals and
//      maintenance due to the people chosen in the app's Reminders page (all admins unless addresses are typed there), when
//      anything is due; on Sundays also emails a backup of every record (Storage › Backup & restore can load it back).
// POST (an admin in the app): { op: "status" } says what is set up; { op: "test", backup } sends the emails now.
import zlib from "node:zlib";
import { q } from "../lib/db.js";
import { send, fail, who, readBody } from "../lib/http.js";
import { sendMail, mailReady } from "../lib/mail.js";
import { loadRecords, computeReminders, reminderEmail, recipients, todayIST } from "../lib/remind.js";
import { backupAll } from "../lib/backup.js";

const MAX_ATTACH = 20 * 1024 * 1024; // Gmail takes up to 25 MB; keep clear of it
const appUrl = req => `https://${req.headers["x-forwarded-host"] || req.headers.host || ""}`;
const settingsOf = D => ({ emailOn: true, backupWeekly: true, to: "admins", list: "", ...(D.appMeta.find(x => x.id === "reminders") || {}) });
async function saveRun(data) {
  await q(`insert into fleet_docs (coll, id, data, ver, deleted) values ('appMeta', 'reminderRun', $1::jsonb, nextval('fleet_ver'), false)
    on conflict (coll, id) do update set data = excluded.data, ver = excluded.ver, deleted = false, updated_at = now()`, [JSON.stringify(data)]);
}

async function run(req, { force, backup }) {
  const D = await loadRecords(), S = settingsOf(D), to = await recipients(S), today = todayIST(), out = { at: new Date().toISOString(), today, to: to.length };
  if (!to.length) return { ...out, note: "No one to send to: no admin has a login with an email, and no address is typed in Reminders." };
  if (force || S.emailOn !== false) {
    const R = computeReminders(D, today), M = reminderEmail(R, appUrl(req));
    out.items = M.count;
    if (M.count || force) { await sendMail({ to: to.join(", "), subject: M.subject, html: M.html, text: M.text }); out.sent = true; }
  }
  const sunday = new Date(Date.now() + 5.5 * 36e5).getUTCDay() === 0;
  if (backup || (!force && sunday && S.backupWeekly !== false)) {
    const file = await backupAll("Weekly backup"), gz = zlib.gzipSync(Buffer.from(JSON.stringify(file)));
    const records = Object.values(file.counts).reduce((a, n) => a + n, 0), name = `fleet-operations-backup-${today}.json.gz`;
    const big = gz.length > MAX_ATTACH;
    await sendMail({ to: to.join(", "), subject: `Fleet backup ${today.split("-").reverse().join("/")}: ${records.toLocaleString("en-IN")} records`,
      text: big ? `The backup is ${(gz.length / 1048576).toFixed(1)} MB, too large to email. Take it from Storage › Backup & restore in the app.`
        : `The weekly backup of every record is attached (${name}). Keep this email. To load it back, open Storage › Backup & restore in the app and choose this file.`,
      attachments: big ? [] : [{ filename: name, content: gz, contentType: "application/gzip" }] });
    out.backup = { records, bytes: gz.length, attached: !big };
  }
  await saveRun(out);
  return out;
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const secret = process.env.CRON_SECRET || "";
      if (secret.length < 16 || req.headers.authorization !== `Bearer ${secret}`) return fail(res, 401, "unauthenticated", "Not allowed");
      if (!mailReady()) return fail(res, 503, "unavailable", "Email isn't set up.");
      return send(res, 200, await run(req, {}));
    }
    if (req.method !== "POST") return fail(res, 405, "bad_request", "Method not allowed");
    const me = await who(req);
    if (!me) return fail(res, 401, "unauthenticated", "Not signed in");
    if (me.access?.users !== "edit") return fail(res, 403, "permission_denied", "Only an admin can do this.");
    const b = await readBody(req);
    if (b.op === "status") {
      const D = await loadRecords(), S = settingsOf(D);
      return send(res, 200, { cron: (process.env.CRON_SECRET || "").length >= 16, mail: mailReady(), to: await recipients(S), last: D.appMeta.find(x => x.id === "reminderRun") || null });
    }
    if (b.op === "test") {
      if (!mailReady()) return fail(res, 503, "unavailable", "Email isn't set up for this app yet (GMAIL_USER and GMAIL_APP_PASSWORD in Vercel).");
      return send(res, 200, await run(req, { force: true, backup: !!b.backup }));
    }
    return fail(res, 400, "bad_request", "Unknown op");
  } catch (e) {
    console.error(e);
    return fail(res, e.status || 500, "unavailable", e.status ? e.message : "Server error");
  }
}
