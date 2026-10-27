/* Sample data for a logistics back-office (BPO) demo: a Mumbai team of ~30, organised by client account, working
   India-day (US after-hours) and US Eastern/Central shifts for US freight brokers, 3PLs and carriers. Everyone and every business here is fictional (example.com emails, 555-01xx phones).
   WIPES the database first, so it refuses to run unless DEMO_MODE=true and the database name contains "demo".

   Usage (on the demo backend, with it running):  node scripts/demo-seed-logistics.mjs
   Reads MONGO_URL, SECRET_KEY, PORT and DEMO_PASSWORD from .env; the three demo logins can have their own
   passwords (DEMO_PASSWORD_ADMIN / _EMPLOYEE / _AGENT). */
import "dotenv/config";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { shiftStartMin } from "../utils/hrCalendar.js";

const { MONGO_URL, SECRET_KEY, DEMO_PASSWORD } = process.env;
const API = `http://127.0.0.1:${process.env.PORT || 8000}/api/v1`;
if (process.env.DEMO_MODE !== "true") throw new Error("Refusing to run: DEMO_MODE is not true");
if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 10) throw new Error("Set DEMO_PASSWORD (10+ characters) in .env");

await mongoose.connect(MONGO_URL);
const db = mongoose.connection.db;
if (!/demo/i.test(db.databaseName)) throw new Error(`Refusing to wipe database "${db.databaseName}" - its name must contain "demo"`);
for (const c of await db.collections()) await c.deleteMany({});
console.log(`Wiped ${db.databaseName}`);

const DAY = 86400000, HOUR = 3600000;
const IST = 330 * 60000;
const now = new Date();
const todayKey = new Date(now.getTime() + IST).toISOString().slice(0, 10);
// A moment on a local (IST) day: daysAgo 0 = today, hh:mm local time (hh may be >= 24 for the next morning)
const at = (daysAgo, hh, mm = 0) => new Date(Date.parse(`${new Date(Date.parse(todayKey) - daysAgo * DAY).toISOString().slice(0, 10)}T00:00:00Z`) - IST + (hh * 60 + mm) * 60000);
const inDays = (n) => new Date(now.getTime() + n * DAY);
const rnd = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const r = rnd(7);
const pick = (arr) => arr[Math.floor(r() * arr.length)];

/* ---------- teams = client accounts (created before anything reads them, so the agency defaults are never added) ---------- */
const TEAMS = [
  { name: "Sales Team", subRoles: ["Business Development Manager", "Account Manager"], color: "#16a34a", access: { sales: true, outreach: true } },
  { name: "Redline - After-hours Desk", subRoles: ["Desk Lead", "Track & Trace Executive", "Check-call Agent", "Customer Service Rep"], color: "#2563eb" },
  { name: "Redline - Dispatch", subRoles: ["Dispatch Lead", "Senior Dispatcher", "Dispatcher", "Scheduling Coordinator"], color: "#ff785a" },
  { name: "Prairie Haul - Billing & AR", subRoles: ["AR Lead", "AR Executive", "Collections Specialist"], color: "#7c3aed" },
  { name: "Bluewater 3PL - Docs & AP", subRoles: ["Team Lead", "Document Processor", "Data Entry Operator", "AP Executive"], color: "#0d9488" },
  { name: "Quality & Training", subRoles: ["QA Analyst", "Trainer"], color: "#475569" },
];
const teamIds = {};
for (const t of TEAMS) teamIds[t.name] = (await db.collection("teams").insertOne({ ...t, description: "", isActive: true, createdBy: "System", createdAt: now, updatedAt: now })).insertedId;

/* ---------- shifts: India day for the US after-hours desk, US Eastern/Central day shifts (they move with US daylight saving) ---------- */
const DAYD = "India day (US after-hours)", ET6 = "US 6-3 ET", ET7 = "US 7-4 ET", ET8 = "US 8-5 ET", CT8 = "US 8-5 CT", REG = "Regular", ROT = "Rotating";
const SHIFTS = [
  { name: DAYD, start: "09:00", timeZone: "", fullDayHours: 9, halfDayHours: 4.5 },
  { name: ET6, start: "06:00", timeZone: "America/New_York", fullDayHours: 9, halfDayHours: 4.5 },
  { name: ET7, start: "07:00", timeZone: "America/New_York", fullDayHours: 9, halfDayHours: 4.5 },
  { name: ET8, start: "08:00", timeZone: "America/New_York", fullDayHours: 9, halfDayHours: 4.5 },
  { name: CT8, start: "08:00", timeZone: "America/Chicago", fullDayHours: 9, halfDayHours: 4.5 },
];

/* ---------- people: [key, name, designation, team, subRole, usual shift, lead] (Rotating = planned week by week) ---------- */
const STAFF = [
  ["admin", "Aisha Verma", "Director - Operations", null, null, REG],
  ["rohan", "Rohan Mehta", "Business Development Manager", "Sales Team", "Business Development Manager", REG, true],
  ["simran", "Simran Kaur", "Account Manager", "Sales Team", "Account Manager", ET8],
  ["farhan", "Farhan Qureshi", "Desk Lead", "Redline - After-hours Desk", "Desk Lead", DAYD, true],
  ["sneha", "Sneha Pillai", "Track & Trace Executive", "Redline - After-hours Desk", "Track & Trace Executive", DAYD],
  ["vivek", "Vivek Joshi", "Track & Trace Executive", "Redline - After-hours Desk", "Track & Trace Executive", DAYD],
  ["ananya", "Ananya Iyer", "Check-call Agent", "Redline - After-hours Desk", "Check-call Agent", DAYD],
  ["omkar", "Omkar Sawant", "Check-call Agent", "Redline - After-hours Desk", "Check-call Agent", DAYD],
  ["aditya", "Aditya Kamath", "Customer Service Rep", "Redline - After-hours Desk", "Customer Service Rep", DAYD],
  ["nidhi", "Nidhi Saxena", "Customer Service Rep", "Redline - After-hours Desk", "Customer Service Rep", DAYD],
  ["neha", "Neha Kapoor", "Dispatch Lead", "Redline - Dispatch", "Dispatch Lead", ET7, true],
  ["kabir", "Kabir Singh", "Senior Dispatcher", "Redline - Dispatch", "Senior Dispatcher", ET6],
  ["riya", "Riya Desai", "Dispatcher", "Redline - Dispatch", "Dispatcher", ET6],
  ["arjun", "Arjun Nair", "Dispatcher", "Redline - Dispatch", "Dispatcher", ET7],
  ["pooja", "Pooja Shetty", "Dispatcher", "Redline - Dispatch", "Dispatcher", ET7],
  ["yash", "Yash Patil", "Dispatcher", "Redline - Dispatch", "Dispatcher", ET8],
  ["varun", "Varun Chawla", "Scheduling Coordinator", "Redline - Dispatch", "Scheduling Coordinator", ET8],
  ["meera", "Meera Rao", "AR Lead", "Prairie Haul - Billing & AR", "AR Lead", CT8, true],
  ["ishaan", "Ishaan Rao", "AR Executive", "Prairie Haul - Billing & AR", "AR Executive", CT8],
  ["tanvi", "Tanvi Kulkarni", "AR Executive", "Prairie Haul - Billing & AR", "AR Executive", CT8],
  ["aman", "Aman Gupta", "Collections Specialist", "Prairie Haul - Billing & AR", "Collections Specialist", CT8],
  ["zoya", "Zoya Sheikh", "Team Lead", "Bluewater 3PL - Docs & AP", "Team Lead", ET8, true],
  ["divya", "Divya Thakur", "Document Processor", "Bluewater 3PL - Docs & AP", "Document Processor", ROT],
  ["sahil", "Sahil Khan", "Document Processor", "Bluewater 3PL - Docs & AP", "Document Processor", ROT],
  ["prachi", "Prachi Jain", "Data Entry Operator", "Bluewater 3PL - Docs & AP", "Data Entry Operator", ROT],
  ["karan", "Karan Bhatia", "Data Entry Operator", "Bluewater 3PL - Docs & AP", "Data Entry Operator", ROT],
  ["nikita", "Nikita Shah", "AP Executive", "Bluewater 3PL - Docs & AP", "AP Executive", ROT],
  ["rahul", "Rahul Menon", "AP Executive", "Bluewater 3PL - Docs & AP", "AP Executive", ROT],
  ["isha", "Isha Malhotra", "QA Analyst", "Quality & Training", "QA Analyst", REG, true],
  ["dev", "Dev Malhotra", "Trainer", "Quality & Training", "Trainer", REG],
];
// The three demo logins
const LOGINS = { admin: ["admin@demo.example.com", process.env.DEMO_PASSWORD_ADMIN], neha: ["employee@demo.example.com", process.env.DEMO_PASSWORD_EMPLOYEE], arjun: ["agent@demo.example.com", process.env.DEMO_PASSWORD_AGENT] };
const defaultHash = await bcrypt.hash(DEMO_PASSWORD, 10);
const ids = {};
for (const [i, [key, fullname, designation, team, subRole, , lead]] of STAFF.entries()) {
  const email = LOGINS[key]?.[0] || `${fullname.split(" ")[0].toLowerCase()}@demo.example.com`;
  const password = LOGINS[key]?.[1] ? await bcrypt.hash(LOGINS[key][1], 10) : defaultHash;
  const teams = team ? [{ team: teamIds[team], teamName: team, subRole, isLead: !!lead }] : [];
  ids[key] = (await db.collection("users").insertOne({ fullname, email, role: key === "admin" ? "admin" : "employee", designation, empId: `ACS-${String(101 + i)}`, password, phoneNumber: 9000000101 + i, profile: { profilePhoto: "" }, teams, isActive: true, createdAt: now, updatedAt: now })).insertedId;
}
const T = Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, jwt.sign({ userId: id, role: k === "admin" ? "admin" : "employee" }, SECRET_KEY)]));
const call = async (who, method, path, body) => {
  const res = await fetch(API + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${T[who]}` }, body: body ? JSON.stringify(body) : undefined });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${d.message || d.msg || ""}`);
  return d;
};

/* ---------- HR settings: Mon-Fri (US week), 10-minute grace ---------- */
const { settings } = await call("admin", "PUT", "/hr/settings", { officeStart: "10:00", graceMinutes: 10, fullDayHours: 8, halfDayHours: 4, weeklyOffs: [0, 6], shifts: SHIFTS });
const shiftId = Object.fromEntries(settings.shifts.map((s) => [s.name, s._id]));
const SHIFT_DEF = { [REG]: { start: "10:00", timeZone: "", len: 9 }, ...Object.fromEntries(SHIFTS.map((s) => [s.name, { start: s.start, timeZone: s.timeZone, len: 9.9 }])) };
const year = Number(todayKey.slice(0, 4));
// US client holidays the floor is closed for
const thanksgiving = (() => { const d = new Date(Date.UTC(year, 10, 1)); const first = (11 - d.getUTCDay()) % 7 + 1; return `${year}-11-${String(first + 21).padStart(2, "0")}`; })();
for (const h of [{ date: thanksgiving, name: "Thanksgiving (US clients closed)" }, { date: `${year}-12-25`, name: "Christmas (US clients closed)" }, { date: `${year + 1}-01-01`, name: "New Year's Day (US clients closed)" }]) await call("admin", "POST", "/hr/holidays", h);

for (const [i, [key, , designation, , , shift]] of STAFF.entries()) {
  await call("admin", "PUT", `/hr/employees/${ids[key]}`, {
    designation, employmentType: "Full Time", status: i > 26 ? "Probation" : "Active",
    dateOfJoining: inDays(-(60 + ((i * 97) % 1100))).toISOString(),
    dob: new Date(Date.UTC(1988 + (i % 12), (i * 5) % 12, 1 + ((i * 7) % 27))).toISOString(),
    workLocation: "Mumbai - Ghatkopar", ...(shiftId[shift] && { shiftId: shiftId[shift] }),
  });
}
// A birthday coming up, for the dashboard
await db.collection("employeeprofiles").updateOne({ userId: ids.sneha }, { $set: { dob: new Date(Date.UTC(1995, new Date(inDays(2)).getUTCMonth(), new Date(inDays(2)).getUTCDate())) } });

/* ---------- roster for the Bluewater team (no fixed shifts): rotates weekly, planned by their Team Lead ---------- */
const dayKeyOf = (daysAgo) => new Date(Date.parse(todayKey) - daysAgo * DAY).toISOString().slice(0, 10);
const weekNo = (key) => Math.floor((Date.parse(key) / DAY + 3) / 7); // Monday-based week number
const ROTATION = [ET6, ET8, DAYD];
const rotaShift = (i, key) => ROTATION[(i + weekNo(key)) % ROTATION.length];
const rotating = STAFF.filter((s) => s[5] === ROT).map((s) => s[0]);
const rosterDocs = [];
for (let d = 45; d >= -13; d--) {
  const key = dayKeyOf(d), wd = new Date(key).getUTCDay();
  if (wd === 0 || wd === 6) continue;
  rotating.forEach((who, i) => rosterDocs.push({ userId: ids[who], date: key, shiftId: shiftId[rotaShift(i, key)], off: false, by: "Zoya Sheikh", createdAt: now, updatedAt: now }));
}
await db.collection("shiftrosters").insertMany(rosterDocs);
const shiftFor = (key, who) => (rotating.includes(who) ? rotaShift(rotating.indexOf(who), key) : STAFF.find((s) => s[0] === who)[5]);

/* ---------- attendance: about six weeks, Mon-Fri; times follow each day's shift in IST ---------- */
const att = [];
for (let d = 45; d >= 0; d--) {
  const key = dayKeyOf(d), wd = new Date(key).getUTCDay();
  if (wd === 0 || wd === 6) continue;
  for (const [who] of STAFF) {
    if ((who === "yash" && d === 6) || (who === "divya" && d === 11)) continue; // two absences (one on leave)
    const def = SHIFT_DEF[shiftFor(key, who)];
    const startMin = shiftStartMin(def, key);
    const jitter = r() < 0.08 ? 11 + Math.floor(r() * 20) : -12 + Math.floor(r() * 20); // mostly on time, the odd late arrival
    const punchIn = at(d, 0, startMin + jitter);
    if (punchIn > now) continue; // shift hasn't started yet
    const out = new Date(punchIn.getTime() + (def.len + r() * 0.5) * HOUR);
    const bStart = new Date(punchIn.getTime() + 4.5 * HOUR), bEnd = new Date(bStart.getTime() + 45 * 60000);
    const done = out <= now;
    att.push({
      userId: ids[who], punchIn, ...(done && { punchOut: out }),
      breaks: bStart < now ? [{ breakStart: bStart, ...(bEnd < now ? { breakEnd: bEnd } : { breakEnd: null }) }] : [],
      totalBreakTime: bEnd < now ? 45 * 60 : 0, punchInLocation: { status: "off" },
      createdAt: punchIn, updatedAt: done ? out : punchIn,
    });
  }
}
await db.collection("attendances").insertMany(att);

/* ---------- leave ---------- */
const lv = await call("divya", "POST", "/leave", { leaveType: "Sick", startDate: at(11, 12).toISOString(), endDate: at(11, 12).toISOString(), reason: "Fever" });
await call("admin", "PUT", `/leave/${(lv.leave || lv.data || lv)._id}/status`, { status: "Approved" });
await call("pooja", "POST", "/leave", { leaveType: "Vacation", startDate: inDays(6).toISOString(), endDate: inDays(7).toISOString(), reason: "Family wedding" });
await call("vivek", "POST", "/leave", { leaveType: "Personal", startDate: inDays(3).toISOString(), endDate: inDays(3).toISOString(), reason: "Bank work" });

/* ---------- US clients + pipeline (monthly value = FTEs x rate) ---------- */
const FTE_RATE = 150000; // INR per FTE per month
const CLIENTS = [
  { brand: "Redline Freight Brokerage", person: "Jake Morrison", role: "VP Operations", city: "Dallas, TX", industry: "Freight Brokerage", services: ["Dispatch", "Track and Trace"], fte: [4, 2], source: "Referral", stage: "Won", follow: 12 },
  { brand: "Prairie Haul Logistics", person: "Emily Carter", role: "Controller", city: "Omaha, NE", industry: "Trucking", services: ["Accounts Receivable", "Credit and Collection"], fte: [3, 1], source: "LinkedIn", stage: "Won", follow: 18 },
  { brand: "Bluewater 3PL", person: "Marcus Lee", role: "Director of Finance", city: "Savannah, GA", industry: "3PL", services: ["Document Handling", "Data Entry", "Accounts Payable"], fte: [2, 2, 2], source: "Conference", stage: "Won", follow: 21 },
  { brand: "Summit Line Transport", person: "Sarah Thompson", role: "COO", city: "Denver, CO", industry: "Trucking", services: ["Dispatch", "Scheduling"], fte: [3, 1], source: "Cold email", stage: "Negotiation", follow: -1 },
  { brand: "Coastal Drayage Co.", person: "David Nguyen", role: "Operations Manager", city: "Long Beach, CA", industry: "Drayage", services: ["Track and Trace"], fte: [3], source: "Website", stage: "Proposal Sent", follow: 0 },
  { brand: "Ironbridge Logistics", person: "Rachel Adams", role: "Head of Customer Experience", city: "Chicago, IL", industry: "3PL", services: ["Customer Service Support"], fte: [6], source: "LinkedIn", stage: "Qualified", follow: 2 },
  { brand: "Northstar Reefer Lines", person: "Tom Becker", role: "CFO", city: "Minneapolis, MN", industry: "Refrigerated Trucking", services: ["Accounts Payable"], fte: [2], source: "Referral", stage: "Lead", follow: -3 },
  { brand: "Granite State Carriers", person: "Laura Kim", role: "Office Manager", city: "Manchester, NH", industry: "Trucking", services: ["Accounts Receivable"], fte: [2], source: "Cold email", stage: "Lost", follow: null, reason: "Chose an onshore vendor" },
  { brand: "Lone Pine Expedite", person: "Chris Walker", role: "Owner", city: "Phoenix, AZ", industry: "Expedited Freight", services: ["Data Entry"], fte: [2], source: "Website", stage: "Lead", follow: 1 },
];
const leads = {};
for (const [i, c] of CLIENTS.entries()) {
  const slug = c.brand.toLowerCase().replace(/[^a-z]+/g, "");
  const fteTotal = c.fte.reduce((a, b) => a + b, 0);
  const d = await call("admin", "POST", "/leadsource", {
    brandName: c.brand, contactPerson: c.person, role: c.role, email: `${slug}@example.com`, phone: `+1 555-01${String(10 + i)}`, industry: c.industry, location: c.city,
    serviceType: c.services, leadSourceType: c.source, leadStatusType: c.stage === "Lead" ? "New Lead" : "In Discussion", dealValue: fteTotal * FTE_RATE,
    teamAssigned: "Sales Team", createdBy: "Rohan Mehta", ...(c.follow !== null && { nextFollowUpDate: at(-c.follow, 20, 30).toISOString() }), // US morning
  });
  const lead = d.leadSource || d.lead || d.data;
  const order = ["Lead", "Qualified", "Proposal Sent", "Negotiation", "Won"];
  for (const stage of c.stage === "Lost" ? ["Qualified", "Lost"] : order.slice(1, order.indexOf(c.stage) + 1)) await call("admin", "PATCH", `/leadsource/${lead._id}/stage`, { stage, changedBy: "Rohan Mehta", ...(stage === "Lost" && { reason: c.reason }) });
  await call("rohan", "POST", `/leadsource/${lead._id}/activity`, { type: i % 3 === 0 ? "Meeting" : i % 2 ? "Call" : "Email", outcome: c.stage === "Lost" ? "Not interested" : c.stage === "Lead" ? "Sent" : "Interested", note: `${c.person} (${c.role}) - ${fteTotal} FTE for ${c.services.join(", ").toLowerCase()}, US ${c.city.endsWith("CA") || c.city.endsWith("AZ") ? "Pacific/Mountain" : "Central/Eastern"} hours` });
  leads[c.brand] = { ...lead, ...c, fteTotal };
}

/* ---------- proposals (per FTE per month) ---------- */
for (const brand of ["Redline Freight Brokerage", "Prairie Haul Logistics", "Bluewater 3PL", "Summit Line Transport", "Coastal Drayage Co."]) {
  const l = leads[brand];
  const { proposal } = await call("admin", "POST", "/proposal", {
    leadId: l._id, taxPercent: 18,
    title: `Dedicated offshore team for ${brand}`,
    intro: `Thanks for the call, ${l.person.split(" ")[0]}. Below is a dedicated team covering your ${l.services.join(", ").toLowerCase()} during US business hours, with a 2-week transition and a shared SOP.`,
    items: l.services.map((s, j) => ({ service: `${s} - dedicated FTE`, quantity: l.fte[j], unit: "FTE / month", rate: FTE_RATE })),
    terms: "Monthly billing in advance. 30 days' notice to change headcount. Team works your US time zone, Monday to Friday.",
  });
  await call("admin", "PATCH", `/proposal/${proposal._id}/status`, { status: "Sent" });
  if (l.stage === "Won") await call("admin", "PATCH", `/proposal/${proposal._id}/status`, { status: "Accepted" });
}

/* ---------- client transitions (projects) and monthly contracts (retainers) ---------- */
const projects = {}, WON = ["Redline Freight Brokerage", "Prairie Haul Logistics", "Bluewater 3PL"];
for (const brand of WON) projects[brand] = (await call("admin", "POST", `/project/from-lead/${leads[brand]._id}`, {})).project;
const contractStart = { "Redline Freight Brokerage": -240, "Prairie Haul Logistics": -150, "Bluewater 3PL": -70 };
for (const brand of WON) {
  const l = leads[brand];
  await call("admin", "POST", "/retainer", { name: `${brand} - ${l.fteTotal} FTE contract`, clientId: l.clientId, clientName: brand, leadId: l._id, projectId: projects[brand]?._id, services: l.services, monthlyFee: l.fteTotal * FTE_RATE, taxPercent: 18, billingDay: 1, paymentTermsDays: 15, startDate: inDays(contractStart[brand]).toISOString(), endDate: inDays(contractStart[brand] + 365).toISOString(), autoRenew: true, renewalMonths: 12, noticeDays: 30, deliverables: [], accountManager: "Simran Kaur", autoInvoice: false });
}

/* ---------- invoices ---------- */
const invoice = async (brand, label, issuedDaysAgo, dueDaysAgo, pay) => {
  const l = leads[brand];
  const { invoice: inv } = await call("admin", "POST", "/invoice", {
    clientId: l.clientId, clientName: brand, billingName: brand, billingEmail: `accounts@${brand.toLowerCase().replace(/[^a-z]+/g, "")}.example.com`,
    items: l.services.map((s, j) => ({ service: `${s} - ${l.fte[j]} FTE (${label})`, quantity: l.fte[j], rate: FTE_RATE })),
    taxPercent: 18, issueDate: inDays(-issuedDaysAgo).toISOString(), dueDate: inDays(-dueDaysAgo).toISOString(), leadId: l._id, projectId: projects[brand]?._id, period: label,
  });
  await call("admin", "POST", `/invoice/${inv._id}/mark-sent`, {});
  if (pay) await call("admin", "POST", `/invoice/${inv._id}/payments`, { amount: pay === "full" ? inv.total : pay, method: "Bank transfer", paidAt: inDays(-Math.max(0, dueDaysAgo - 3)).toISOString(), reference: "Sample wire" });
};
const lastMonth = new Date(Date.UTC(year, new Date(todayKey).getUTCMonth() - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
const thisMonth = new Date(todayKey).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
await invoice("Redline Freight Brokerage", lastMonth, 30, 15, "full");
await invoice("Prairie Haul Logistics", lastMonth, 30, 15, "full");
await invoice("Bluewater 3PL", lastMonth, 30, 15, 500000); // part-paid, rest overdue
await invoice("Redline Freight Brokerage", thisMonth, 2, -13, null);
await invoice("Prairie Haul Logistics", thisMonth, 2, -13, null);
await invoice("Bluewater 3PL", thisMonth, 2, -13, null);

/* ---------- daily work (tasks) ---------- */
const TASKS = [
  ["Redline: book 18 loads on the morning board", "Post and cover today's lanes, update rate confirmations in the TMS", "kabir", 0, "In Progress"],
  ["Redline: check calls for in-transit loads", "Call drivers on all loads past pickup, update ETAs, email the shipper on any delay", "sneha", 0, "In Progress"],
  ["Prairie Haul: follow up invoices over 45 days", "Call and email AP contacts on the aging list, log promises to pay", "aman", -1, "Pending"],
  ["Prairie Haul: weekly AR aging report", "Send the aging summary to the controller by Friday US time", "meera", 2, "Pending"],
  ["Bluewater: index last week's PODs and BOLs", "Match each document to its load and flag missing signatures", "divya", -2, "Pending"],
  ["Bluewater: carrier invoice batch for payment", "Check 42 carrier invoices against rate confirmations before the payment run", "rahul", 1, "In Progress"],
  ["Summit Line: trial dispatch shift (2 nights)", "Shadow their dispatcher on US Mountain time, note SOP gaps", "neha", 4, "Pending"],
  ["Coastal Drayage: draft Track & Trace SOP", "Port appointment checks, container status updates, escalation matrix", "farhan", 3, "Pending"],
  ["QA: score 20 recorded check calls", "Use the call-quality checklist; share scores with team leads", "isha", 1, "Pending"],
  ["Train two new dispatchers on load boards", "2-hour session + practice lanes", "dev", 5, "Pending"],
  ["Redline: fix duplicate entries in the load tracker", "Duplicate rows from Monday's import", "prachi", -3, "Completed"],
  ["Ironbridge: send 24x7 support pricing options", "Two options: night shift only vs full 24x7 cover", "rohan", 1, "Pending"],
];
await db.collection("tasks").insertMany(TASKS.map(([title, description, who, due, status]) => ({ title, description, startDate: inDays(-3), endDate: at(-due, 20), assignedTo: [{ user: ids[who], status }], createdBy: ids.admin, createdAt: now, updatedAt: now })));

/* ---------- time logged per client (for profit per client) ---------- */
// Fully loaded cost per hour (salary + seat, systems, management overhead)
for (const [key, cost] of Object.entries({ kabir: 620, arjun: 540, pooja: 540, sneha: 560, vivek: 560, meera: 700, tanvi: 580, aman: 600, divya: 480, sahil: 480, rahul: 620, prachi: 460 })) await call("admin", "PUT", `/time/rates/${ids[key]}`, { hourlyCost: cost });
const WORK = { "Redline Freight Brokerage": [["kabir", "Load booking and dispatch"], ["arjun", "Dispatch"], ["pooja", "Dispatch"], ["sneha", "Track & trace check calls"], ["vivek", "Track & trace"]], "Prairie Haul Logistics": [["meera", "AR review"], ["tanvi", "Invoicing and AR follow-ups"], ["aman", "Collections calls"]], "Bluewater 3PL": [["divya", "POD/BOL indexing"], ["sahil", "Document handling"], ["rahul", "Carrier payments"], ["prachi", "Data entry"]] };
const timeEntries = [];
for (let d = 40; d >= 1; d--) {
  const wd = new Date(Date.parse(todayKey) - d * DAY).getUTCDay();
  if (wd === 0 || wd === 6) continue;
  for (const [brand, people] of Object.entries(WORK)) for (const [who, description] of people) {
    timeEntries.push([who, { date: at(d, 12).toISOString(), minutes: 420 + Math.floor(r() * 60), clientId: leads[brand].clientId, clientName: brand, projectId: projects[brand]?._id, description, billable: true }]);
  }
}
for (let i = 0; i < timeEntries.length; i += 20) await Promise.all(timeEntries.slice(i, i + 20).map(([who, body]) => call(who, "POST", "/time", body)));

console.log(`Demo data ready: ${STAFF.length} people, ${CLIENTS.length} US clients, ${TASKS.length} tasks, ${att.length} attendance records`);
console.log("Logins: admin@demo.example.com, employee@demo.example.com, agent@demo.example.com - passwords are in DEMO_LOGINS.txt");
await mongoose.disconnect();
