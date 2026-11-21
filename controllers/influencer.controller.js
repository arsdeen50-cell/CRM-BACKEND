import mongoose from "mongoose";
import { Influencer, INFLUENCER_PLATFORMS, INFLUENCER_STATUSES, COLLAB_STATUSES, TIERS, handleKey } from "../models/influencer.model.js";
import { LeadClient } from "../models/leadClient.model.js";
import { displayName, escapeRegex, isAdminReq } from "../utils/access.js";
import { logAudit, diffFields } from "../utils/audit.js";

/* Influencer database: creators, their platforms and reach, rates, contacts, and campaigns done for clients.
   Open to admins and teams with Influencers access (see routes/influencer.route.js). */

const fail = (res, err, code = 500) => res.status(err.status || code).json({ success: false, message: err.message || "Server error" });
const validId = (id) => mongoose.Types.ObjectId.isValid(id);
const str = (v, max = 300) => String(v ?? "").trim().slice(0, max);
const num = (v, max = 1e12) => {
  const n = Number(String(v ?? "").replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
};
const list = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[,;|]/)).map((s) => str(s, 60)).filter(Boolean).slice(0, 30);
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const audit = (req, inf, action, summary, changes) => logAudit(req, { entityType: "Influencer", entityId: inf._id, entityLabel: inf.name, action, summary, changes });
const date = (v) => {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const cleanPlatform = (p = {}) => ({
  platform: pick(p.platform, INFLUENCER_PLATFORMS, "Other"),
  handle: str(p.handle, 100).replace(/^@+/, ""),
  url: /^https?:\/\//i.test(str(p.url, 500)) ? str(p.url, 500) : "",
  followers: num(p.followers),
  avgViews: num(p.avgViews),
  engagementRate: Math.min(100, Math.round(num(p.engagementRate) * 100) / 100),
});

// Body -> safe influencer fields (collaborations are edited through their own endpoints)
const fields = (b = {}) => {
  const out = {};
  const set = (k, v) => b[k] !== undefined && (out[k] = v);
  set("name", str(b.name, 150));
  set("platforms", (Array.isArray(b.platforms) ? b.platforms : []).slice(0, 12).map(cleanPlatform).filter((p) => p.handle || p.url || p.followers));
  set("niches", list(b.niches));
  set("languages", list(b.languages));
  for (const k of ["city", "state", "country", "gender", "phone", "managerName", "managerPhone", "owner"]) set(k, str(b[k], 150));
  for (const k of ["email", "managerEmail"]) set(k, str(b[k], 200).toLowerCase());
  set("rates", (Array.isArray(b.rates) ? b.rates : []).slice(0, 20).map((r) => ({ deliverable: str(r.deliverable, 100), amount: num(r.amount), note: str(r.note, 200) })).filter((r) => r.deliverable || r.amount));
  set("currency", str(b.currency, 5).toUpperCase() || "INR");
  set("openToBarter", !!b.openToBarter);
  set("status", pick(b.status, INFLUENCER_STATUSES, "Prospect"));
  set("rating", Math.min(5, Math.round(num(b.rating))));
  set("tags", list(b.tags));
  set("notes", str(b.notes, 5000));
  return out;
};

// Another live influencer already using one of these handles, email or phone?
const findDuplicate = async ({ platforms = [], email = "", phone = "" }, exceptId) => {
  const or = [];
  const keys = platforms.map(handleKey).filter(Boolean);
  if (keys.length) or.push({ handles: { $in: keys } });
  if (email) or.push({ email });
  const digits = String(phone).replace(/\D/g, "").slice(-10);
  if (digits.length === 10) or.push({ phone: new RegExp(`${digits.slice(0, 5)}\\D*${digits.slice(5)}$`) });
  if (!or.length) return null;
  return Influencer.findOne({ isDeleted: { $ne: true }, ...(exceptId && { _id: { $ne: exceptId } }), $or: or }).select("name").lean();
};

const filterFrom = (q = {}) => {
  const f = { isDeleted: { $ne: true } };
  if (q.q) {
    const rx = new RegExp(escapeRegex(str(q.q, 100)), "i");
    f.$or = [{ name: rx }, { "platforms.handle": rx }, { niches: rx }, { city: rx }, { tags: rx }, { email: rx }, { managerName: rx }, { "collaborations.clientName": rx }, { "collaborations.campaign": rx }];
  }
  if (q.platform) f["platforms.platform"] = q.platform;
  if (q.niche) f.niches = new RegExp(`^${escapeRegex(q.niche)}$`, "i");
  if (q.city) f.city = new RegExp(`^${escapeRegex(q.city)}$`, "i");
  if (q.language) f.languages = new RegExp(`^${escapeRegex(q.language)}$`, "i");
  if (q.tier) f.tier = q.tier;
  if (q.status) f.status = q.status;
  if (q.owner) f.owner = q.owner;
  if (q.barter === "true") f.openToBarter = true;
  if (q.clientId && validId(q.clientId)) f["collaborations.clientId"] = new mongoose.Types.ObjectId(q.clientId);
  const min = num(q.minFollowers);
  const max = num(q.maxFollowers);
  if (min || max) f.followers = { ...(min && { $gte: min }), ...(max && { $lte: max }) };
  return f;
};
const SORTS = { followers: { followers: -1 }, name: { name: 1 }, recent: { updatedAt: -1 }, rating: { rating: -1, followers: -1 } };

// GET /influencer?q&platform&niche&city&language&tier&status&owner&barter&clientId&minFollowers&maxFollowers&sort&page&limit
export const listInfluencers = async (req, res) => {
  try {
    const filter = filterFrom(req.query);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const page = Math.max(1, Number(req.query.page) || 1);
    const [rows, total, facets] = await Promise.all([
      Influencer.find(filter)
        .select("-collaborations.links -notes")
        .sort(SORTS[req.query.sort] || SORTS.followers)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Influencer.countDocuments(filter),
      Influencer.aggregate([
        { $match: { isDeleted: { $ne: true } } },
        {
          $facet: {
            niches: [{ $unwind: "$niches" }, { $group: { _id: "$niches", n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }, { $limit: 100 }],
            cities: [{ $match: { city: { $ne: "" } } }, { $group: { _id: "$city", n: { $sum: 1 } } }, { $sort: { n: -1, _id: 1 } }, { $limit: 100 }],
            languages: [{ $unwind: "$languages" }, { $group: { _id: "$languages", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 50 }],
            owners: [{ $match: { owner: { $ne: "" } } }, { $group: { _id: "$owner" } }, { $sort: { _id: 1 } }],
            status: [{ $group: { _id: "$status", n: { $sum: 1 } } }],
            tier: [{ $group: { _id: "$tier", n: { $sum: 1 } } }],
            total: [{ $count: "n" }],
          },
        },
      ]),
    ]);
    const fc = facets[0] || {};
    res.json({
      success: true,
      influencers: rows.map((r) => {
        const collabs = r.collaborations || [];
        const done = collabs.filter((c) => c.status === "Completed");
        const { collaborations, ...rest } = r;
        return { ...rest, collabCount: collabs.length, lastCollab: collabs.map((c) => c.date).filter(Boolean).sort((a, b) => b - a)[0] || null, clients: [...new Set(done.map((c) => c.clientName).filter(Boolean))].slice(0, 5) };
      }),
      total,
      page,
      pages: Math.ceil(total / limit),
      options: {
        platforms: INFLUENCER_PLATFORMS,
        statuses: INFLUENCER_STATUSES,
        collabStatuses: COLLAB_STATUSES,
        tiers: TIERS,
        niches: (fc.niches || []).map((x) => x._id),
        cities: (fc.cities || []).map((x) => x._id),
        languages: (fc.languages || []).map((x) => x._id),
        owners: (fc.owners || []).map((x) => x._id),
      },
      summary: {
        total: fc.total?.[0]?.n || 0,
        byStatus: Object.fromEntries((fc.status || []).map((x) => [x._id, x.n])),
        byTier: Object.fromEntries((fc.tier || []).filter((x) => x._id).map((x) => [x._id, x.n])),
      },
    });
  } catch (err) {
    fail(res, err);
  }
};

const load = async (id) => (validId(id) ? Influencer.findOne({ _id: id, isDeleted: { $ne: true } }) : null);

export const getInfluencer = async (req, res) => {
  try {
    const inf = await load(req.params.id);
    if (!inf) return res.status(404).json({ success: false, message: "Influencer not found" });
    res.json({ success: true, influencer: inf });
  } catch (err) {
    fail(res, err);
  }
};

export const createInfluencer = async (req, res) => {
  try {
    const data = fields(req.body);
    if (!data.name) return res.status(400).json({ success: false, message: "Enter the influencer's name" });
    const dup = await findDuplicate(data);
    if (dup && !req.body?.allowDuplicate) return res.status(409).json({ success: false, message: `${dup.name} already has this handle, email or phone`, duplicateId: dup._id });
    const inf = await Influencer.create({ ...data, createdBy: displayName(req), updatedBy: displayName(req) });
    audit(req, inf, "create", "Influencer added");
    res.status(201).json({ success: true, influencer: inf });
  } catch (err) {
    fail(res, err, 400);
  }
};

export const updateInfluencer = async (req, res) => {
  try {
    const inf = await load(req.params.id);
    if (!inf) return res.status(404).json({ success: false, message: "Influencer not found" });
    const data = fields(req.body);
    if (data.name === "") delete data.name;
    // Only what changed is checked, so a record knowingly saved as a duplicate can still be edited
    const changed = {
      platforms: (data.platforms || []).filter((p) => !inf.handles.includes(handleKey(p))),
      email: data.email !== undefined && data.email !== inf.email ? data.email : "",
      phone: data.phone !== undefined && data.phone !== inf.phone ? data.phone : "",
    };
    const dup = await findDuplicate(changed, inf._id);
    if (dup && !req.body?.allowDuplicate) return res.status(409).json({ success: false, message: `${dup.name} already has this handle, email or phone`, duplicateId: dup._id });
    const before = inf.toObject();
    Object.assign(inf, data, { updatedBy: displayName(req) });
    await inf.save();
    audit(req, inf, "update", "", diffFields(before, inf.toObject()));
    res.json({ success: true, influencer: inf });
  } catch (err) {
    fail(res, err, 400);
  }
};

// DELETE /influencer/:id - admins only; kept in the database (hidden), campaign history stays on record
export const deleteInfluencer = async (req, res) => {
  try {
    if (!isAdminReq(req)) return res.status(403).json({ success: false, message: "Only admins can delete influencers. Set the status to \"Do not use\" instead." });
    const inf = await load(req.params.id);
    if (!inf) return res.status(404).json({ success: false, message: "Influencer not found" });
    inf.isDeleted = true;
    inf.updatedBy = displayName(req);
    await inf.save();
    audit(req, inf, "delete", "Influencer deleted");
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
};

/* ---------- Campaigns with clients ---------- */
const collabFields = async (b = {}) => {
  const out = {
    campaign: str(b.campaign, 150),
    deliverables: str(b.deliverables, 500),
    fee: num(b.fee),
    barter: !!b.barter,
    date: date(b.date),
    status: pick(b.status, COLLAB_STATUSES, "Planned"),
    links: (Array.isArray(b.links) ? b.links : String(b.links || "").split(/\s+|,/)).map((l) => str(l, 500)).filter((l) => /^https?:\/\//i.test(l)).slice(0, 20),
    results: str(b.results, 1000),
    rating: Math.min(5, Math.round(num(b.rating))),
  };
  if (b.clientId && validId(b.clientId)) {
    const c = await LeadClient.findOne({ _id: b.clientId, isDeleted: { $ne: true } }).select("brandName").lean();
    if (!c) throw Object.assign(new Error("Client not found"), { status: 400 });
    out.clientId = c._id;
    out.clientName = c.brandName;
  } else {
    out.clientId = undefined;
    out.clientName = str(b.clientName, 150);
  }
  return out;
};

// After a completed campaign the influencer has been worked with
const bumpStatus = (inf) => {
  if (inf.collaborations.some((c) => c.status === "Completed") && ["Prospect", "Contacted", "In talks"].includes(inf.status)) inf.status = "Worked with";
};

export const addCollaboration = async (req, res) => {
  try {
    const inf = await load(req.params.id);
    if (!inf) return res.status(404).json({ success: false, message: "Influencer not found" });
    const c = await collabFields(req.body);
    if (!c.campaign && !c.clientName) return res.status(400).json({ success: false, message: "Enter the client or campaign" });
    inf.collaborations.push({ ...c, addedBy: displayName(req) });
    bumpStatus(inf);
    inf.updatedBy = displayName(req);
    await inf.save();
    audit(req, inf, "update", `Campaign added: ${c.campaign || c.clientName}`);
    res.status(201).json({ success: true, influencer: inf });
  } catch (err) {
    fail(res, err, 400);
  }
};

export const updateCollaboration = async (req, res) => {
  try {
    const inf = await load(req.params.id);
    const c = inf?.collaborations.id(req.params.collabId);
    if (!c) return res.status(404).json({ success: false, message: "Campaign not found" });
    Object.assign(c, await collabFields(req.body));
    bumpStatus(inf);
    inf.updatedBy = displayName(req);
    await inf.save();
    res.json({ success: true, influencer: inf });
  } catch (err) {
    fail(res, err, 400);
  }
};

export const deleteCollaboration = async (req, res) => {
  try {
    const inf = await load(req.params.id);
    const c = inf?.collaborations.id(req.params.collabId);
    if (!c) return res.status(404).json({ success: false, message: "Campaign not found" });
    c.deleteOne();
    inf.updatedBy = displayName(req);
    await inf.save();
    audit(req, inf, "update", "Campaign removed");
    res.json({ success: true, influencer: inf });
  } catch (err) {
    fail(res, err);
  }
};

/* ---------- Import / export ---------- */
/* POST /influencer/import { rows: [{ name, instagram, instagramFollowers, youtube, youtubeSubscribers, ... }] }
   Rows come from the CSV template (parsed in the browser). Duplicates (same handle, email or phone) are skipped. */
const PLATFORM_COLUMNS = [
  ["Instagram", "instagram", "instagramFollowers", "instagramEngagement", "instagramAvgViews"],
  ["YouTube", "youtube", "youtubeSubscribers", "youtubeEngagement", "youtubeAvgViews"],
  ["Facebook", "facebook", "facebookFollowers", "", ""],
  ["X", "x", "xFollowers", "", ""],
  ["LinkedIn", "linkedin", "linkedinFollowers", "", ""],
];
const RATE_COLUMNS = [["Instagram reel", "rateReel"], ["Instagram post", "ratePost"], ["Instagram story", "rateStory"], ["YouTube video", "rateYoutube"]];
const fromUrl = (v) => {
  const s = str(v, 500);
  if (!/^https?:\/\//i.test(s)) return { handle: s, url: "" };
  const m = s.match(/^https?:\/\/[^/]+\/(?:@)?([^/?#]+)/i);
  return { handle: m ? decodeURIComponent(m[1]) : "", url: s };
};

export const importInfluencers = async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 2000) : [];
    if (!rows.length) return res.status(400).json({ success: false, message: "No rows to import" });
    const result = { created: 0, skipped: 0, errors: [] };
    for (const [i, r] of rows.entries()) {
      const platforms = PLATFORM_COLUMNS.map(([platform, h, f, er, v]) => {
        if (!r[h] && !r[f]) return null;
        const { handle, url } = fromUrl(r[h]);
        return cleanPlatform({ platform, handle, url, followers: r[f], engagementRate: er ? r[er] : 0, avgViews: v ? r[v] : 0 });
      }).filter(Boolean);
      const data = fields({
        name: r.name,
        platforms,
        niches: r.niches,
        languages: r.languages,
        city: r.city,
        state: r.state,
        country: r.country || "India",
        gender: r.gender,
        email: r.email,
        phone: r.phone,
        managerName: r.managerName,
        managerPhone: r.managerPhone,
        managerEmail: r.managerEmail,
        rates: RATE_COLUMNS.map(([deliverable, k]) => ({ deliverable, amount: r[k] })),
        openToBarter: /^(y|yes|true|1)$/i.test(String(r.openToBarter || "").trim()),
        status: INFLUENCER_STATUSES.find((s) => s.toLowerCase() === String(r.status || "").trim().toLowerCase()) || "Prospect",
        owner: r.owner,
        tags: r.tags,
        notes: r.notes,
      });
      if (!data.name) {
        result.errors.push({ row: i + 2, message: "Name is missing" });
        continue;
      }
      if (await findDuplicate(data)) {
        result.skipped++;
        continue;
      }
      try {
        await Influencer.create({ ...data, createdBy: displayName(req), updatedBy: displayName(req) });
        result.created++;
      } catch (err) {
        result.errors.push({ row: i + 2, message: err.message });
      }
    }
    logAudit(req, { entityType: "Influencer", action: "import", summary: `Imported ${result.created} influencers (${result.skipped} duplicates skipped)` });
    res.json({ success: true, ...result });
  } catch (err) {
    fail(res, err);
  }
};

// GET /influencer/export - CSV of the filtered list (admins only), in the import template's columns
export const exportInfluencers = async (req, res) => {
  try {
    if (!isAdminReq(req)) return res.status(403).json({ success: false, message: "Only admins can export the influencer list" });
    const rows = await Influencer.find(filterFrom(req.query)).sort({ followers: -1 }).lean();
    const cols = ["name", ...PLATFORM_COLUMNS.flatMap(([, h, f, er, v]) => [h, f, er, v].filter(Boolean)), "niches", "languages", "city", "state", "country", "gender", "email", "phone", "managerName", "managerPhone", "managerEmail", ...RATE_COLUMNS.map(([, k]) => k), "openToBarter", "status", "owner", "tags", "tier", "campaigns", "notes"];
    const csv = (v) => {
      let s = String(v ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // keep spreadsheet formulas from running
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(",")];
    for (const r of rows) {
      const o = { ...r, niches: (r.niches || []).join(", "), languages: (r.languages || []).join(", "), tags: (r.tags || []).join(", "), openToBarter: r.openToBarter ? "Yes" : "No", campaigns: (r.collaborations || []).length };
      for (const [platform, h, f, er, v] of PLATFORM_COLUMNS) {
        const p = (r.platforms || []).find((x) => x.platform === platform);
        if (!p) continue;
        o[h] = p.url || (p.handle ? `@${p.handle}` : "");
        o[f] = p.followers || "";
        if (er) o[er] = p.engagementRate || "";
        if (v) o[v] = p.avgViews || "";
      }
      for (const [deliverable, k] of RATE_COLUMNS) o[k] = (r.rates || []).find((x) => x.deliverable === deliverable)?.amount || "";
      lines.push(cols.map((c) => csv(o[c])).join(","));
    }
    logAudit(req, { entityType: "Influencer", action: "export", summary: `Exported ${rows.length} influencers` });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="influencers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`﻿${lines.join("\n")}`);
  } catch (err) {
    fail(res, err);
  }
};
