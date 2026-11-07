// Daily reminders for the office: renewals due within 30 days (drivers, conductors, vehicles) and maintenance overdue or
// due within 5,000 km. Worked out here the same way as the app's Renewals and Maintenance summary pages: keep in step with
// the app (DOCS, DOC_RULES, MT_TYPES, mtNow, mtDue).
import { q } from "./db.js";

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const todayIST = () => new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
const shiftDay = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
export const dmy = iso => ISO.test(iso || "") ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
const nf = n => Math.round(n).toLocaleString("en-IN");

const TW = "Two Wheeler";
const DOCS = [["fcDate", "FC"], ["insuranceExp", "Insurance"], ["taxExp", "Tax"], ["permitExp", "Permit"], ["permitAuthExp", "Permit authorization"],
  ["pollutionExp", "Pollution"], ["rcValidity", "RC renewal"], ["speedGovExp", "Speed governor"], ["gpsExp", "GPS tracker"]];
const transportVehicle = (t, u) => t === "Auto" || t === TW ? false : t !== "Car" || u === "Public service";
const DOC_RULES = {
  permitExp: (t) => t !== TW && t !== "Car", permitAuthExp: t => t === "12 Wheeler Truck", speedGovExp: transportVehicle, gpsExp: transportVehicle,
  rcValidity: (t, u) => u !== "Public service" && t !== "Bus" && t !== "12 Wheeler Truck"
};
const docApplies = (k, t, u) => !DOC_RULES[k] || DOC_RULES[k](t, u);
const PERSON_DATES = { drivers: [["valTR", "Transport licence (TR)"], ["valNT", "Non-transport licence (NT)"]], conductors: [["clValid", "Conductor licence"], ["faValid", "First-aid certificate"]] };

const MT_TYPES = [
  { k: "oil", name: "Oil service", gap: 75000 }, { k: "gear", name: "Gear box oil", gap: 100000 }, { k: "housing", name: "Housing oil", gap: 100000 },
  { k: "hub", name: "Hub grease", gap: 35000 }, { k: "lining", name: "Brake lining", gap: 60000 }, { k: "clutch", name: "Clutch plate", gap: 80000 },
  { k: "air", name: "Air filter", gap: 100000 }, { k: "tappet", name: "Tappet adjustment", gap: 50000 }, { k: "battery", name: "Battery" },
  { k: "drum", name: "Brake drum" }, { k: "clutchkit", name: "Clutch kit service" }, { k: "kingpin", name: "King pin" },
  { k: "steer", name: "Steering ends" }, { k: "align", name: "Wheel alignment" }, { k: "nozzle", name: "Pump and nozzle service" },
  { k: "ratchet", name: "Ratchets" }, { k: "dynamo", name: "Dynamo service" }, { k: "engine", name: "Engine work" }, { k: "other", name: "Other work" }];
const MT_POS = { fl: "Front left", fr: "Front right", bl: "Back left", br: "Back right", sl: "Second axle left", sr: "Second axle right", dl: "Dummy left", dr: "Dummy right" };
const mtType = k => MT_TYPES.find(t => t.k === k) || { k, name: k };
const itemName = it => mtType(it.k).name + (it.pos && MT_POS[it.pos] ? " · " + MT_POS[it.pos] : "");

// The records the reminders need.
export async function loadRecords() {
  const colls = ["vehicles", "drivers", "conductors", "maintLog", "maintTypes", "fuelLog", "trips", "bookings", "truckTrips", "appMeta"];
  const rows = await q(`select coll, id, data from fleet_docs where not deleted and coll = any($1::text[])`, [colls]);
  const D = Object.fromEntries(colls.map(c => [c, []]));
  for (const r of rows) D[r.coll].push({ id: r.id, ...(r.data || {}) });
  return D;
}

function odoPairs(v) { return (v?.odoPairs || []).filter(p => p.date && num(p.meter) >= 0 && num(p.actual) > 0 && num(p.ratio) > 0).sort((a, b) => a.date.localeCompare(b.date)); }
function odoActual(v, date, reading) {
  const P = odoPairs(v).filter(p => !date || p.date <= date), m = num(reading), below = P.filter(p => num(p.meter) <= m);
  const L = below.length ? below : P.length ? P : odoPairs(v);
  const p = L.reduce((b, p) => !b || Math.abs(m - num(p.meter)) < Math.abs(m - num(b.meter)) || (Math.abs(m - num(p.meter)) === Math.abs(m - num(b.meter)) && p.date > b.date) ? p : b, null);
  return p ? num(p.actual) + (m - num(p.meter)) / num(p.ratio) : null;
}

// Everything due, as on `today`.
export function computeReminders(D, today = todayIST()) {
  const soon = shiftDay(today, 30), renewals = [], maint = [];
  const plate = v => v.plateNo || [v.make, v.model].filter(Boolean).join(" ") || "Vehicle";
  for (const [coll, dates] of Object.entries(PERSON_DATES))
    for (const p of D[coll]) { if ((p.status || "Active") === "Inactive") continue;
      for (const [k, what] of dates) if (ISO.test(p[k] || "") && p[k] <= soon) renewals.push({ kind: coll === "drivers" ? "Driver" : "Conductor", id: p.id, name: p.name || "", what, k, date: p[k], n: dayDiff(today, p[k]), mobile: p.mobile || "" }); }
  const fleet = D.vehicles.filter(v => v.status !== "Sold / Scrapped");
  for (const v of fleet) for (const [k, what] of DOCS)
    if (docApplies(k, v.type, v.usage) && ISO.test(v[k] || "") && v[k] <= soon) renewals.push({ kind: "Vehicle", id: v.id, name: plate(v), what, k, date: v[k], n: dayDiff(today, v[k]) });
  renewals.sort((a, b) => a.n - b.n || a.name.localeCompare(b.name));

  // Maintenance: the app's mtDue for every vehicle in service that has maintenance entered.
  const gapsDoc = D.maintTypes.find(x => x.id === "gaps") || {};
  const gapAt = (L, k, pos) => (pos && num(L?.[k + "|" + pos])) || num(L?.[k]) || 0;
  const act = (v, date, km) => v && num(km) && odoPairs(v).length ? Math.round(odoActual(v, date, km)) : num(km);
  for (const v of fleet) {
    const log = D.maintLog.filter(x => x.vehicleId === v.id); if (!log.length) continue;
    const xAct = x => x.src === "excel" || x.kmAct ? num(x.km) : act(v, x.date, x.km), pts = [], add = (date, km) => { if (date && num(km)) pts.push([date, act(v, date, km), num(km)]); };
    log.forEach(x => { if (x.date && num(x.km)) pts.push([x.date, xAct(x), num(x.km)]); });
    D.fuelLog.filter(f => f.vehicleId === v.id).forEach(f => add(f.date, f.odo));
    D.trips.filter(t => t.vehicleId === v.id).forEach(t => add(t.date, t.odo));
    D.bookings.filter(b => b.vehicleId === v.id).forEach(b => add(b.to || b.from, b.endKm));
    D.truckTrips.filter(l => l.vehicleId === v.id).forEach(l => { add(l.to || l.from, l.endKm); (l.fuels || []).forEach(f => add(f.date, f.odo)); });
    let now = null;
    if (pts.length) { const best = pts.reduce((a, p) => p[0] > a[0] || (p[0] === a[0] && p[1] > a[1]) ? p : a), since = shiftDay(best[0], -365);
      const first = pts.filter(p => p[0] >= since && p[0] <= best[0]).reduce((a, p) => p[0] < a[0] ? p : a, best), days = dayDiff(first[0], best[0]);
      now = { km: best[1], date: best[0], perDay: days >= 14 && best[1] > first[1] ? (best[1] - first[1]) / days : 0 }; }
    const last = new Map();
    log.forEach(x => (x.items || []).forEach(it => { const id = it.k + "|" + (it.pos || ""), cur = last.get(id), a = xAct(x); if (!cur || x.date > cur.date || (x.date === cur.date && a > cur.a)) last.set(id, { it, date: x.date, a }); }));
    const jobs = [];
    for (const { it, date, a } of last.values()) {
      const set = gapAt(gapsDoc.bus?.[v.id], it.k, it.pos) || gapAt(gapsDoc.cls?.[v.type], it.k, it.pos) || gapAt(gapsDoc.gaps, it.k, it.pos);
      const gap = set || (gapsDoc.gaps?.[it.k] === 0 ? 0 : mtType(it.k).gap || 0);
      const next = !set && num(it.next) > a ? num(it.next) : gap && a ? a + gap : null, left = next != null && now ? next - now.km : null;
      if (left == null || left > 5000) continue;
      jobs.push({ job: itemName(it), k: it.k, pos: it.pos || "", lastDate: date, lastKm: a, next, left, st: left <= 0 ? "over" : "soon" });
    }
    if (jobs.length) maint.push({ id: v.id, plate: plate(v), nowKm: now?.km || 0, nowDate: now?.date || "", jobs: jobs.sort((x, y) => x.left - y.left) });
  }
  maint.sort((a, b) => a.jobs[0].left - b.jobs[0].left);
  return { today, renewals, maint };
}

// The email: two tables, red for expired / overdue, orange for due soon.
export function reminderEmail(R, appUrl) {
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const nM = R.maint.reduce((a, m) => a + m.jobs.length, 0), nR = R.renewals.length;
  const red = "background:#fde0e0", orange = "background:#fde9cf", td = "padding:6px 10px;border-bottom:1px solid #e3e6ea;font:14px Arial,sans-serif", th = td + ";background:#eef1f4;text-align:left;font-weight:bold";
  const when = n => n < 0 ? `Expired ${-n} day${n === -1 ? "" : "s"} ago` : n === 0 ? "Expires today" : `In ${n} day${n === 1 ? "" : "s"}`;
  const ren = nR ? `<h3 style="font:bold 16px Arial,sans-serif">Renewals due within 30 days (${nR})</h3><table style="border-collapse:collapse;min-width:520px"><tr><th style="${th}">Who / vehicle</th><th style="${th}">Document</th><th style="${th}">Date</th><th style="${th}"></th></tr>` +
    R.renewals.map(x => `<tr style="${x.n < 0 ? red : x.n <= 7 ? orange : ""}"><td style="${td}"><b>${esc(x.name)}</b> <span style="color:#5c6977">${x.kind}</span></td><td style="${td}">${esc(x.what)}</td><td style="${td}">${dmy(x.date)}</td><td style="${td}">${when(x.n)}</td></tr>`).join("") + `</table>` : "";
  const mt = nM ? `<h3 style="font:bold 16px Arial,sans-serif">Maintenance due (${nM})</h3><table style="border-collapse:collapse;min-width:520px"><tr><th style="${th}">Maintenance</th><th style="${th}">Last service</th><th style="${th};text-align:right">Next service km</th><th style="${th};text-align:right">Km left</th></tr>` +
    R.maint.map(m => `<tr><td style="${td};background:#dde7f3" colspan="4"><b>${esc(m.plate)}</b> · now about ${nf(m.nowKm)} km${m.nowDate ? ` (${dmy(m.nowDate)})` : ""}</td></tr>` +
      m.jobs.map(j => `<tr style="${j.st === "over" ? red : orange}"><td style="${td}">${esc(j.job)}</td><td style="${td}">${dmy(j.lastDate)} · ${nf(j.lastKm)} km</td><td style="${td};text-align:right">${nf(j.next)}</td><td style="${td};text-align:right">${j.left <= 0 ? nf(-j.left) + " km over" : nf(j.left) + " km"}</td></tr>`).join("")).join("") + `</table>` : "";
  const subject = nR || nM ? `Fleet reminders ${dmy(R.today)}: ${[nR ? `${nR} renewal${nR === 1 ? "" : "s"}` : "", nM ? `${nM} maintenance` : ""].filter(Boolean).join(", ")} due` : `Fleet reminders ${dmy(R.today)}: nothing due`;
  const html = `<div style="font:14px Arial,sans-serif;color:#18212b"><p>Good morning. Here is what needs attention as on <b>${dmy(R.today)}</b>.</p>${ren}${mt}${nR || nM ? "" : "<p>Nothing is due in the next 30 days or 5,000 km.</p>"}` +
    `<p style="margin-top:18px">To send these to the drivers on WhatsApp, open <a href="${esc(appUrl)}/#reminders">Reminders</a> in the app.</p><p style="color:#8a96a3;font-size:12px">Red: expired or overdue · Orange: due soon. Sent automatically every morning.</p></div>`;
  const text = [`Fleet reminders as on ${dmy(R.today)}`, ...R.renewals.map(x => `${x.name} (${x.kind}): ${x.what} ${dmy(x.date)} - ${when(x.n)}`),
    ...R.maint.flatMap(m => m.jobs.map(j => `${m.plate}: ${j.job} - next at ${nf(j.next)} km, ${j.left <= 0 ? nf(-j.left) + " km over" : nf(j.left) + " km left"}`)), `Open ${appUrl}/#reminders to send them on WhatsApp.`].join("\n");
  return { subject, html, text, count: nR + nM };
}

// Who gets the emails: the addresses typed in Reminders, or every admin (owners and Admin users with a login).
export async function recipients(settings) {
  if (settings?.to === "list") return String(settings.list || "").split(/[,;\s]+/).map(s => s.trim()).filter(s => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  const owners = (process.env.OWNER_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const rows = await q(`select u.email from fleet_users u join fleet_docs d on d.coll = 'appUsers' and not d.deleted and d.data->>'accountId' = u.id
    and d.data->>'status' = 'Active' and d.data->>'role' = 'Admin'`);
  return [...new Set([...owners, ...rows.map(r => String(r.email).toLowerCase())])];
}
