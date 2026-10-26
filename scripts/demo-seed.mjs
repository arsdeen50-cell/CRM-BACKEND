/* Fills a DEMO copy of the CRM with sample data (fictional people and businesses, example.com emails).
   WIPES the database first, so it refuses to run unless DEMO_MODE=true and the database name contains "demo".

   Usage (on the demo backend, with it running):  node scripts/demo-seed.mjs
   Reads MONGO_URL, SECRET_KEY, PORT and DEMO_PASSWORD from .env. Every demo login uses DEMO_PASSWORD. */
import "dotenv/config";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const { MONGO_URL, SECRET_KEY, DEMO_PASSWORD } = process.env;
const API = `http://127.0.0.1:${process.env.PORT || 8000}/api/v1`;
if (process.env.DEMO_MODE !== "true") throw new Error("Refusing to run: DEMO_MODE is not true");
if (!DEMO_PASSWORD || DEMO_PASSWORD.length < 10) throw new Error("Set DEMO_PASSWORD (10+ characters) in .env");

await mongoose.connect(MONGO_URL);
const db = mongoose.connection.db;
if (!/demo/i.test(db.databaseName)) throw new Error(`Refusing to wipe database "${db.databaseName}" - its name must contain "demo"`);
for (const c of await db.collections()) await c.deleteMany({});
console.log(`Wiped ${db.databaseName}`);

const DAY = 86400000;
const IST = 330 * 60000;
const today = new Date();
const todayKey = new Date(today.getTime() + IST).toISOString().slice(0, 10);
// A moment on a local (IST) day: daysAgo 0 = today, hh:mm local time
const at = (daysAgo, hh, mm = 0) => new Date(Date.parse(`${new Date(Date.parse(todayKey) - daysAgo * DAY).toISOString().slice(0, 10)}T00:00:00Z`) - IST + (hh * 60 + mm) * 60000);
const inDays = (n) => new Date(today.getTime() + n * DAY);
const rnd = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647); // repeatable "random"
const r = rnd(42);

/* ---------- people ---------- */
const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
const PEOPLE = [
  { key: "admin", fullname: "Aisha Verma", email: "admin@demo.example.com", role: "admin", designation: "Founder & CEO", empId: "DEMO-001" },
  { key: "rohan", fullname: "Rohan Mehta", email: "rohan@demo.example.com", designation: "Account Manager", empId: "DEMO-002", team: "Sales Team", subRole: "Account Manager", lead: true },
  { key: "neha", fullname: "Neha Kapoor", email: "employee@demo.example.com", designation: "Content Creator", empId: "DEMO-003", team: "SMM Team", subRole: "Content Creator", lead: true },
  { key: "kabir", fullname: "Kabir Singh", email: "kabir@demo.example.com", designation: "Videographer", empId: "DEMO-004", team: "Production Team", subRole: "Videographer" },
  { key: "ishaan", fullname: "Ishaan Rao", email: "ishaan@demo.example.com", designation: "UI Developer", empId: "DEMO-005", team: "Website Team", subRole: "UI Developer" },
  { key: "dev", fullname: "Dev Malhotra", email: "dev@demo.example.com", designation: "Graphic Designer", empId: "DEMO-006", team: "Branding & Design Team", subRole: "Graphic Designer" },
  { key: "tara", fullname: "Tara Nair", email: "intern@demo.example.com", designation: "Social Media Intern", empId: "DEMO-007", team: "SMM Team", subRole: "Social Strategist", intern: true },
];
const ids = {};
for (const [i, p] of PEOPLE.entries()) {
  ids[p.key] = (await db.collection("users").insertOne({ fullname: p.fullname, email: p.email, role: p.role || "employee", designation: p.designation, empId: p.empId, password: hash, phoneNumber: 9000000001 + i, profile: { profilePhoto: "" }, teams: [], isActive: true, createdAt: new Date(), updatedAt: new Date() })).insertedId;
}
const T = Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, jwt.sign({ userId: id, role: k === "admin" ? "admin" : "employee" }, SECRET_KEY)]));
const call = async (who, method, path, body) => {
  const res = await fetch(API + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${T[who]}` }, body: body ? JSON.stringify(body) : undefined });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${d.message || d.msg || ""}`);
  return d;
};

/* ---------- teams, HR settings, profiles ---------- */
const { teams } = await call("admin", "GET", "/team");
const team = (name) => teams.find((t) => t.name === name);
for (const p of PEOPLE.filter((x) => x.team)) await call("admin", "PUT", `/team/members/${ids[p.key]}`, { teams: [{ team: team(p.team)._id, subRole: p.subRole, isLead: !!p.lead }] });

const { settings } = await call("admin", "PUT", "/hr/settings", { officeStart: "10:00", graceMinutes: 15, fullDayHours: 8, halfDayHours: 4, weeklyOffs: [0], shifts: [{ name: "Interns", start: "14:00", fullDayHours: 6, halfDayHours: 3 }] });
const internShift = settings.shifts[0]._id;
const year = Number(todayKey.slice(0, 4));
for (const h of [{ date: `${year}-12-25`, name: "Christmas" }, { date: `${year + 1}-01-01`, name: "New Year's Day", optional: true }, { date: `${year + 1}-01-26`, name: "Republic Day" }]) await call("admin", "POST", "/hr/holidays", h);

const joined = [900, 640, 420, 300, 260, 180, 50];
for (const [i, p] of PEOPLE.entries()) {
  await call("admin", "PUT", `/hr/employees/${ids[p.key]}`, {
    designation: p.designation,
    employmentType: p.intern ? "Internship" : "Full Time",
    status: p.intern || i === 5 ? "Probation" : "Active",
    dateOfJoining: inDays(-joined[i]).toISOString(),
    dob: new Date(Date.UTC(1990 + i, (today.getUTCMonth() + (i === 3 ? 0 : i + 2)) % 12, i === 3 ? Math.min(28, new Date(todayKey).getUTCDate() + 2) : 10 + i)).toISOString(),
    workLocation: "Mumbai",
    ...(p.intern && { shiftId: internShift }),
    ...(i === 2 && { punchRule: "wfh" }),
  });
}

/* ---------- attendance: about six weeks + today ---------- */
const att = [];
for (let d = 45; d >= 0; d--) {
  const local = new Date(Date.parse(todayKey) - d * DAY);
  if (local.getUTCDay() === 0) continue; // Sunday off
  for (const p of PEOPLE) {
    if (p.key === "kabir" && d === 4) continue; // one absence
    const intern = !!p.intern;
    const inH = intern ? 13 : 9, inM = intern ? 50 + Math.floor(r() * 30) : 40 + Math.floor(r() * 40); // mostly on time, the odd late arrival
    const punchIn = at(d, inH, inM);
    if (d === 0) {
      const nowLocalMin = (today.getTime() + IST) % DAY / 60000;
      if (nowLocalMin < inH * 60 + inM || p.key === "dev") continue; // not in yet / running late today
      att.push({ userId: ids[p.key], punchIn, breaks: [], totalBreakTime: 0, punchInLocation: { status: "off" } });
      continue;
    }
    const outH = intern ? 20 : 19, outM = intern ? 30 + Math.floor(r() * 30) : Math.floor(r() * 40);
    const bStart = at(d, intern ? 17 : 13, 30), bEnd = at(d, intern ? 17 : 14, intern ? 50 : 0);
    att.push({ userId: ids[p.key], punchIn, punchOut: at(d, outH, outM), breaks: [{ breakStart: bStart, breakEnd: bEnd }], totalBreakTime: (bEnd - bStart) / 1000, punchInLocation: { status: "off" } });
  }
}
await db.collection("attendances").insertMany(att.map((a) => ({ ...a, createdAt: a.punchIn, updatedAt: a.punchOut || a.punchIn })));

/* ---------- leave ---------- */
const lv1 = await call("kabir", "POST", "/leave", { leaveType: "Sick", startDate: at(4, 12).toISOString(), endDate: at(4, 12).toISOString(), reason: "Fever" });
await call("admin", "PUT", `/leave/${(lv1.leave || lv1.data || lv1)._id}/status`, { status: "Approved" });
await call("ishaan", "POST", "/leave", { leaveType: "Vacation", startDate: inDays(5).toISOString(), endDate: inDays(6).toISOString(), reason: "Family function" });

/* ---------- clients + pipeline ---------- */
const LEADS = [
  { brand: "Bloom Bakery", person: "Meera Joshi", industry: "Food & Beverage", services: ["Social Media Management"], source: "Instagram", value: 45000, stage: "Won", follow: 10 },
  { brand: "Northwind Fitness", person: "Arjun Desai", industry: "Fitness", services: ["Social Media Management", "Video Production"], source: "Referral", value: 120000, stage: "Won", follow: 14 },
  { brand: "Lumen Skincare", person: "Priya Iyer", industry: "Beauty", services: ["Influencer Marketing", "Branding"], source: "Website", value: 250000, stage: "Won", follow: 20 },
  { brand: "UrbanNest Realty", person: "Sameer Khan", industry: "Real Estate", services: ["Website Development", "SEO"], source: "LinkedIn", value: 180000, stage: "Negotiation", follow: -1 },
  { brand: "Saffron Kitchen", person: "Anita Rao", industry: "Restaurant", services: ["Social Media Management"], source: "Walk-in", value: 35000, stage: "Proposal Sent", follow: 0 },
  { brand: "Peak Physio", person: "Vikram Shah", industry: "Healthcare", services: ["SEO", "Google Ads"], source: "Referral", value: 60000, stage: "Qualified", follow: 2 },
  { brand: "TrailHead Outdoors", person: "Karan Bhatia", industry: "Retail", services: ["Branding", "Website Development"], source: "Cold outreach", value: 300000, stage: "Lead", follow: -3 },
  { brand: "Copper Cup Café", person: "Sana Sheikh", industry: "Food & Beverage", services: ["Photography"], source: "Instagram", value: 25000, stage: "Lost", follow: null, reason: "Went with a cheaper freelancer" },
  { brand: "Verde Interiors", person: "Nikhil Menon", industry: "Interior Design", services: ["Social Media Management", "Photography"], source: "Website", value: 75000, stage: "Lead", follow: 1 },
];
const leads = {};
for (const [i, l] of LEADS.entries()) {
  const slug = l.brand.toLowerCase().replace(/[^a-z]+/g, "");
  const { leadSource } = await call("admin", "POST", "/leadsource", {
    brandName: l.brand, contactPerson: l.person, email: `${slug}@example.com`, phone: `90000100${String(i).padStart(2, "0")}`, industry: l.industry, location: "Mumbai",
    serviceType: l.services, leadSourceType: l.source, leadStatusType: l.stage === "Lead" ? "New Lead" : "In Discussion", dealValue: l.value,
    teamAssigned: "Sales Team", createdBy: "Rohan Mehta", ...(l.follow !== null && { nextFollowUpDate: at(-l.follow, 11).toISOString() }),
  }).then((d) => ({ leadSource: d.leadSource || d.lead || d.data }));
  const order = ["Lead", "Qualified", "Proposal Sent", "Negotiation", "Won"];
  const target = l.stage === "Lost" ? ["Qualified", "Lost"] : order.slice(1, order.indexOf(l.stage) + 1);
  for (const stage of target) await call("admin", "PATCH", `/leadsource/${leadSource._id}/stage`, { stage, changedBy: "Rohan Mehta", ...(stage === "Lost" && { reason: l.reason }) });
  await call("rohan", "POST", `/leadsource/${leadSource._id}/activity`, { type: i % 2 ? "Call" : "WhatsApp", outcome: l.stage === "Lost" ? "Not interested" : "Interested", note: `Discussed ${l.services.join(" and ").toLowerCase()} for ${l.brand}` });
  leads[l.brand] = { ...leadSource, ...l };
}

/* ---------- proposals ---------- */
const rate = { "Social Media Management": 30000, "Video Production": 45000, "Influencer Marketing": 90000, Branding: 60000, "Website Development": 120000, SEO: 25000, "Google Ads": 20000, Photography: 15000 };
const proposals = {};
for (const brand of ["Bloom Bakery", "Northwind Fitness", "Lumen Skincare", "UrbanNest Realty", "Saffron Kitchen"]) {
  const l = leads[brand];
  const { proposal } = await call("admin", "POST", "/proposal", { leadId: l._id, items: l.services.map((s) => ({ service: s, quantity: 1, unit: s.includes("Website") || s === "Branding" ? "project" : "month", rate: rate[s] })), taxPercent: 18, intro: `Thanks for the time, ${l.person.split(" ")[0]}. Here is what we propose for ${brand}.` });
  await call("admin", "PATCH", `/proposal/${proposal._id}/status`, { status: "Sent" });
  if (l.stage === "Won") await call("admin", "PATCH", `/proposal/${proposal._id}/status`, { status: "Accepted" });
  proposals[brand] = proposal;
}

/* ---------- projects for won deals ---------- */
const projects = {};
for (const brand of ["Bloom Bakery", "Northwind Fitness", "Lumen Skincare"]) {
  const d = await call("admin", "POST", `/project/from-lead/${leads[brand]._id}`, {});
  projects[brand] = d.project || d.data;
}

/* ---------- retainers ---------- */
const retainers = {};
for (const [brand, fee, deliverables, mgr] of [
  ["Bloom Bakery", 30000, [{ type: "Post", platform: "Instagram", perMonth: 12 }, { type: "Reel", platform: "Instagram", perMonth: 4 }], "Neha Kapoor"],
  ["Northwind Fitness", 75000, [{ type: "Reel", platform: "Instagram", perMonth: 8 }, { type: "Video", platform: "YouTube", perMonth: 2 }], "Rohan Mehta"],
]) {
  const l = leads[brand];
  const d = await call("admin", "POST", "/retainer", { name: `${brand} - monthly social`, clientId: l.clientId, clientName: brand, leadId: l._id, projectId: projects[brand]?._id, services: l.services, monthlyFee: fee, taxPercent: 18, billingDay: 1, paymentTermsDays: 7, startDate: inDays(-75).toISOString(), endDate: inDays(brand === "Bloom Bakery" ? 20 : 200).toISOString(), autoRenew: false, deliverables, accountManager: mgr, autoInvoice: false });
  retainers[brand] = d.retainer;
}

/* ---------- invoices ---------- */
const inv = async (brand, items, issuedDaysAgo, dueDaysAgo, pay) => {
  const l = leads[brand];
  const { invoice } = await call("admin", "POST", "/invoice", { clientId: l.clientId, clientName: brand, billingName: brand, billingEmail: `${brand.toLowerCase().replace(/[^a-z]+/g, "")}@example.com`, items, taxPercent: 18, issueDate: inDays(-issuedDaysAgo).toISOString(), dueDate: inDays(-dueDaysAgo).toISOString(), leadId: l._id, projectId: projects[brand]?._id });
  await call("admin", "POST", `/invoice/${invoice._id}/mark-sent`, {});
  if (pay) await call("admin", "POST", `/invoice/${invoice._id}/payments`, { amount: pay === "full" ? invoice.total : pay, method: "UPI", paidAt: inDays(-Math.max(0, dueDaysAgo + 2)).toISOString(), reference: "Sample payment" });
  return invoice;
};
await inv("Lumen Skincare", [{ service: "Brand identity", quantity: 1, rate: 60000 }, { service: "Influencer campaign - phase 1", quantity: 1, rate: 90000 }], 40, 30, "full");
await inv("Bloom Bakery", [{ service: "Social media management (last month)", quantity: 1, rate: 30000 }], 30, 23, "full");
await inv("Northwind Fitness", [{ service: "Social media + video (last month)", quantity: 1, rate: 75000 }], 26, 19, 40000);
await inv("Bloom Bakery", [{ service: "Social media management (this month)", quantity: 1, rate: 30000 }], 3, -4, null);

/* ---------- content calendar ---------- */
const CONTENT = [
  ["Bloom Bakery", "Festive menu launch reel", "Reel", "Instagram", 2, "In Progress", "Neha Kapoor"],
  ["Bloom Bakery", "Behind the oven - carousel", "Carousel", "Instagram", -1, "Changes Requested", "Tara Nair"],
  ["Bloom Bakery", "Customer review post", "Post", "Instagram", -6, "Published", "Tara Nair"],
  ["Bloom Bakery", "Weekend offer story", "Story", "Instagram", 4, "Idea", "Tara Nair"],
  ["Northwind Fitness", "30-day challenge teaser", "Reel", "Instagram", 1, "Client Review", "Kabir Singh"],
  ["Northwind Fitness", "Trainer spotlight video", "Video", "YouTube", 6, "In Progress", "Kabir Singh"],
  ["Northwind Fitness", "Transformation story", "Post", "Instagram", -4, "Published", "Neha Kapoor"],
  ["Northwind Fitness", "Membership offer ad", "Ad", "Facebook", 3, "Internal Review", "Dev Malhotra"],
  ["Lumen Skincare", "Creator unboxing round-up", "Reel", "Instagram", 5, "Approved", "Neha Kapoor"],
  ["Lumen Skincare", "Launch announcement", "Post", "LinkedIn", -2, "Scheduled", "Dev Malhotra"],
];
for (const [brand, title, type, platform, d, status, assignee] of CONTENT) {
  const l = leads[brand];
  await call("admin", "POST", "/content", { clientId: l.clientId, clientName: brand, retainerId: retainers[brand]?._id, projectId: projects[brand]?._id, title, type, platform, scheduledDate: at(-d, 18).toISOString(), status, assignee, brief: `${type} for ${brand}` });
}

/* ---------- tasks ---------- */
const TASKS = [
  ["Edit Northwind challenge teaser", "Cut a 30s version for Instagram", "kabir", 1, "In Progress"],
  ["Bloom carousel - apply client changes", "Swap photo 3 and fix the price on slide 2", "tara", -1, "Pending"],
  ["UrbanNest homepage wireframe", "Desktop + mobile, 3 sections", "ishaan", 3, "In Progress"],
  ["Lumen launch creatives", "4 static posts in brand colours", "dev", 2, "Pending"],
  ["Monthly report - Bloom Bakery", "Reach, followers, top posts", "neha", 0, "Pending"],
  ["Shoot plan for Northwind trainer video", "Shot list + location", "kabir", 5, "Pending"],
  ["Fix contact form on UrbanNest staging", "Form doesn't submit on Safari", "ishaan", -2, "Completed"],
];
await db.collection("tasks").insertMany(TASKS.map(([title, description, who, due, status]) => ({ title, description, startDate: inDays(-3), endDate: at(-due, 19), assignedTo: [{ user: ids[who], status }], createdBy: ids.admin, createdAt: new Date(), updatedAt: new Date() })));

/* ---------- time tracking ---------- */
for (const [who, brand, d, minutes, description] of [
  ["kabir", "Northwind Fitness", 1, 240, "Shoot - challenge teaser"], ["kabir", "Northwind Fitness", 0, 120, "Editing"], ["neha", "Bloom Bakery", 1, 180, "Captions + scheduling"],
  ["dev", "Lumen Skincare", 2, 300, "Launch creatives"], ["ishaan", "UrbanNest Realty", 1, 360, "Wireframes"], ["tara", "Bloom Bakery", 1, 150, "Carousel design"], ["neha", "Lumen Skincare", 3, 120, "Creator coordination"],
]) await call(who, "POST", "/time", { date: at(d, 12).toISOString(), minutes, clientId: leads[brand].clientId, clientName: brand, projectId: projects[brand]?._id, description, billable: true });

console.log(`Demo data ready: ${PEOPLE.length} people, ${LEADS.length} leads, ${CONTENT.length} content items, ${TASKS.length} tasks, ${att.length} attendance records`);
console.log("Logins: admin@demo.example.com (admin), employee@demo.example.com (employee), intern@demo.example.com (intern) - password = DEMO_PASSWORD");
await mongoose.disconnect();
