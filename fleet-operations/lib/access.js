// Who may read and change which records. The app hides screens and buttons by role; these checks make the server
// enforce the same rules, so a signed-in user can't get round them by sending requests directly.
// Keep in step with MODULES / ROLES in the app.

const VE = ["none", "view", "edit"];
const LEVELS = {
  dashboard: ["none", "view"], vehicles: VE, drivers: VE, conductors: VE, trips: VE,
  bookings: ["none", "view", "request", "edit"], tripsheets: ["none", "view", "update", "edit"],
  fuel: VE, maintenance: VE, users: VE
};
const FULL = Object.fromEntries(Object.entries(LEVELS).map(([m, l]) => [m, l.at(-1)]));

// The access a person has: owners and Admins get everything; others get their User master settings.
export function accessOf(owner, rec) {
  if (owner || rec?.role === "Admin") return { ...FULL };
  const a = {};
  for (const [m, levels] of Object.entries(LEVELS)) {
    let l = rec?.access?.[m] || "none";
    if (!levels.includes(l)) l = levels.at(-1);
    a[m] = l;
  }
  return a;
}

// Which module looks after each collection.
const MOD_OF = {
  vehicles: "vehicles", vehicleHistory: "vehicles",
  drivers: "drivers", driverHistory: "drivers",
  conductors: "conductors", conductorHistory: "conductors",
  trips: "trips", tripMonths: "trips", tripYears: "trips", truckTrips: "trips", truckRounds: "trips",
  fuelLog: "fuel"
};
const HISTORY = /History$/;
const AUDIT = ["auditLog", "auditSessions"];
const isAdmin = a => a.users === "edit";
const seesBookings = a => a.bookings !== "none" || a.tripsheets !== "none";

// Collections a person may download. Master lists stay readable for every approved user because other screens
// need them (vehicle and driver pickers); bookings (money) and the activity log are kept to those who use them.
export function canRead(a, coll) {
  if (isAdmin(a)) return true;
  if (coll === "bookings" || coll === "bookingHistory") return seesBookings(a);
  if (AUDIT.includes(coll)) return false;
  return true;
}
// A fingerprint of what someone may read; when it changes, their app reloads everything it is now allowed to see.
export const readScope = a => isAdmin(a) ? "member:all" : `member:${seesBookings(a) ? "b" : ""}`;

const OPEN_STATUS = ["draft", "pending", "rejected"];
const today = () => new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10); // India time
const sameExcept = (x, y, keys) => {
  const strip = o => JSON.stringify(Object.keys(o || {}).filter(k => !keys.includes(k)).sort().map(k => [k, o[k]]));
  return strip(x) === strip(y);
};

// May this person make this change? prev is the stored record (null when new); next is the record after the change.
// Returns "" when allowed, otherwise the reason.
export function canWrite(a, me, op, coll, id, prev, next) {
  if (isAdmin(a)) return "";
  const no = "You don't have permission to change this.";
  if (coll === "appUsers") return "Only an admin can change users.";
  if (coll === "accessRequests") return id === me.id ? "" : no;
  if (AUDIT.includes(coll)) return op === "delete" ? no : "";
  if (coll === "appMeta") return op === "delete" ? no : "";

  if (coll === "bookingHistory") return op !== "delete" && !prev && (a.bookings !== "none" && a.bookings !== "view" || a.tripsheets === "update" || a.tripsheets === "edit" || next?.byName === "Automatic") ? "" : no;
  if (HISTORY.test(coll)) {
    const m = MOD_OF[coll];
    return m && a[m] === "edit" && op !== "delete" && !prev ? "" : no;
  }
  if (coll === "bookings") return bookingRule(a, op, prev, next) ? "" : no;

  const m = MOD_OF[coll];
  if (!m) return no; // anything new is admin-only until a rule is added here
  return a[m] === "edit" ? "" : no;
}

function bookingRule(a, op, prev, next) {
  if (a.bookings === "edit") return true;
  if (op === "delete") return a.bookings === "request" && !!prev && ["draft", "rejected"].includes(prev.status);
  // Booking planner: their own drafts and requests, which an admin then approves.
  if (a.bookings === "request" && (!prev || OPEN_STATUS.includes(prev.status)) && OPEN_STATUS.includes(next.status)) return true;
  // Trip update: fills in the trip sheet of an existing booking without changing the booking itself.
  if ((a.tripsheets === "update" || a.tripsheets === "edit") && prev && next.status === prev.status) {
    if (a.tripsheets === "edit") return true;
    const ts = next.tsStatus || "";
    return ts === (prev.tsStatus || "") || ["", "draft", "submitted"].includes(ts);
  }
  // Any copy of the app moves a confirmed booking to "On trip" on its start date.
  if (a.bookings !== "none" && prev && prev.status === "booked" && next.status === "ontrip" && prev.from && prev.from <= today()
    && sameExcept(prev, next, ["status", "autoOnTripOn"])) return true;
  return false;
}
