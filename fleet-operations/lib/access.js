// Who may read and change which records. The app hides screens and buttons by role; these checks make the server
// enforce the same rules, so a signed-in user can't get round them by sending requests directly.
// Keep in step with MODULES / ROLES in the app.

const VE = ["none", "view", "edit"];
const LEVELS = {
  dashboard: ["none", "view"], vehicles: VE, drivers: VE, conductors: VE, trips: ["none", "view", "update", "edit"],
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
  routeExpenses: "trips", padiSlabs: "trips", // route bus masters: standard expenses by starting place, padi slabs
  routeSheets: "trips", // the conductor's day sheet, approved into trips by an admin
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

// Closing and reopening a trip: admin only, until it gets a role of its own.
export const canCloseTrips = a => isAdmin(a);
// A closed trip (a spare bus booking, or a route bus day in "trips") is final. Nobody, admin included, may change or
// delete it, or the diesel fills linked to it, until an admin reopens it. Closing and reopening change only the closing
// details, the pending amount closed with it (balAdj) and the totals worked out from them.
const CLOSE_KEYS = ["closedOn", "closedByName", "reopens", "balAdj", "due", "received", "balance", "expense", "profit"];
function closedRule(a, op, coll, prev, next, linkedClosed) {
  const shut = "This trip is closed. An admin must reopen it first.";
  if (coll === "fuelLog") return linkedClosed ? shut : "";
  if (coll !== "bookings" && coll !== "trips") return "";
  const was = !!prev?.closedOn, is = !!next?.closedOn;
  if (op === "delete") return was ? shut : "";
  if (was && is) return sameExcept(prev, next, []) ? "" : shut;
  if (was === is) return "";
  if (!canCloseTrips(a)) return "Only an admin can close or reopen a trip.";
  // An admin may add a trip that is already closed (old trips loaded from Excel by Utility › Data upload).
  if (!prev) return "";
  return sameExcept(prev, next, CLOSE_KEYS) ? "" : "Closing or reopening a trip can't change anything else on the booking.";
}

// May this person make this change? prev is the stored record (null when new); next is the record after the change.
// linkedClosed: for a diesel fill, whether the booking it belongs to (before or after the change) is a closed trip.
// Returns "" when allowed, otherwise the reason.
export function canWrite(a, me, op, coll, id, prev, next, linkedClosed) {
  const shut = closedRule(a, op, coll, prev, next, linkedClosed);
  if (shut) return shut;
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
  // Conductor (route trip sheet: fill & submit): his day sheets while they are not sent yet or were sent back, which he
  // may save or send to the office. Approving, and everything in the route trip sheet itself, stays with the office.
  if (coll === "routeSheets" && a.trips === "update") {
    if (op === "delete") return prev?.status === "draft" ? "" : no;
    const open = !prev || prev.status === "draft" || prev.status === "rejected";
    return open && ["draft", "rejected", "submitted"].includes(next?.status) && !next.approvedOn && (next.status !== "rejected" || prev?.status === "rejected")
      && (next.rejectReason || "") === (next.status === "rejected" ? prev?.rejectReason || "" : "") ? "" : no;
  }

  // Trip sheet diesel: someone who fills in trip sheets may add, change and delete fills linked to a booking.
  if (coll === "fuelLog" && a.fuel !== "edit" && (a.tripsheets === "update" || a.tripsheets === "edit"))
    return (op === "delete" ? !!prev?.bookingId : !!next?.bookingId && (!prev || prev.bookingId === next.bookingId)) ? "" : no;

  const m = MOD_OF[coll];
  if (!m) return no; // anything new is admin-only until a rule is added here
  return a[m] === "edit" ? "" : no;
}

function bookingRule(a, op, prev, next) {
  if (a.bookings === "edit") return true;
  if (op === "delete") return a.bookings === "request" && !!prev && ["draft", "rejected"].includes(prev.status);
  // Booking planner: add payments to any booking that isn't cancelled (parties pay in parts). Earlier payments and
  // everything else on the booking stay exactly as they were; only the totals worked out from the payments change.
  if (a.bookings === "request" && prev && prev.status !== "cancelled" && paymentsAdded(prev, next)) return true;
  // Booking planner: add files (ID proof, payment proof…) to any booking that isn't cancelled; nothing else changes.
  if (a.bookings === "request" && prev && prev.status !== "cancelled" && filesAdded(prev, next)) return true;
  // Booking planner: their own drafts and requests, which an admin then approves.
  if (a.bookings === "request" && (!prev || OPEN_STATUS.includes(prev.status)) && OPEN_STATUS.includes(next.status)) return true;
  // Trip update: fills in the trip sheet of an existing booking without changing the booking itself, nor the driver's
  // advance and its settlement, which belong to the office.
  if ((a.tripsheets === "update" || a.tripsheets === "edit") && prev && next.status === prev.status) {
    if (!sameExcept(pick(prev, DRV_MONEY), pick(next, DRV_MONEY), [])) return false;
    if (a.tripsheets === "edit") return true;
    const ts = next.tsStatus || "";
    return ts === (prev.tsStatus || "") || ["", "draft", "submitted"].includes(ts);
  }
  // Any copy of the app moves a confirmed booking to "On trip" on its start date.
  if (a.bookings !== "none" && prev && prev.status === "booked" && next.status === "ontrip" && prev.from && prev.from <= today()
    && sameExcept(prev, next, ["status", "autoOnTripOn"])) return true;
  return false;
}

const DRV_MONEY = ["drvAdvance", "drvAdvanceOn", "drvAdvanceBy", "drvAdvToll", "drvExpOff", "drvSettle"];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o?.[k] != null).map(k => [k, o[k]]));
function paymentsAdded(prev, next) {
  const p = prev.payments || [], n = next.payments || [];
  return n.length > p.length && JSON.stringify(n.slice(0, p.length)) === JSON.stringify(p)
    && sameExcept(prev, next, ["payments", "due", "received", "balance", "expense", "profit"]);
}
function filesAdded(prev, next) {
  const p = prev.attachments || [], n = next.attachments || [];
  return n.length > p.length && JSON.stringify(n.slice(0, p.length)) === JSON.stringify(p)
    && sameExcept(prev, next, ["attachments", "due", "received", "balance", "expense", "profit"]);
}
