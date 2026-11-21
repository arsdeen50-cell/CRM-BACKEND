import crypto from "crypto";
import mongoose from "mongoose";
import { Campaign, CAMPAIGN_STATUSES, ENTRY_STATUSES, METRIC_KEYS, campaignTotals } from "../models/campaign.model.js";
import { Influencer, INFLUENCER_PLATFORMS } from "../models/influencer.model.js";
import { LeadClient } from "../models/leadClient.model.js";
import { cleanPlatform, findDuplicate, fromUrl } from "./influencer.controller.js";
import { displayName, escapeRegex, isAdminReq } from "../utils/access.js";
import { logAudit } from "../utils/audit.js";
import { company } from "../utils/proposalPdf.js";

/* Influencer campaigns per client: details, roster of influencers with deliverables / fees / post links / results,
   CSV import of a roster, and a read-only share link for the client. Admins + teams with Influencers access. */

const fail = (res, err, code = 500) => res.status(err.status || code).json({ success: false, message: err.message || "Server error" });
const validId = (id) => mongoose.Types.ObjectId.isValid(id);
const str = (v, max = 300) => String(v ?? "").trim().slice(0, max);
const num = (v, max = 1e13) => {
  const s = String(v ?? "").trim().replace(/[,₹\s]/g, "");
  const m = s.match(/^([\d.]+)\s*([kKmMlL]|cr)?$/);
  if (!m) return 0;
  const mult = { k: 1e3, m: 1e6, l: 1e5, cr: 1e7 }[String(m[2] || "").toLowerCase()] || 1;
  const n = Number(m[1]) * mult;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n * 100) / 100, max) : 0;
};
const list = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[,;|]/)).map((s) => str(s, 60)).filter(Boolean).slice(0, 30);
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const date = (v) => {
  if (v === null || v === "") return null;
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const links = (v) => (Array.isArray(v) ? v : String(v || "").split(/[\s,]+/)).map((l) => str(l, 500)).filter((l) => /^https?:\/\//i.test(l)).slice(0, 20);
const audit = (req, c, action, summary) => logAudit(req, { entityType: "Campaign", entityId: c._id, entityLabel: c.name, action, summary });
const withTotals = (c) => ({ ...(c.toObject ? c.toObject() : c), totals: campaignTotals(c) });

const loadCampaign = async (id) => (validId(id) ? Campaign.findOne({ _id: id, isDeleted: { $ne: true } }) : null);

const campaignFields = async (b = {}) => {
  const out = {};
  const set = (k, v) => b[k] !== undefined && (out[k] = v);
  set("name", str(b.name, 150));
  set("objective", str(b.objective, 100));
  set("brief", str(b.brief, 5000));
  set("startDate", date(b.startDate));
  set("endDate", date(b.endDate));
  set("status", pick(b.status, CAMPAIGN_STATUSES, "Planning"));
  set("platforms", list(b.platforms).filter((p) => INFLUENCER_PLATFORMS.includes(p)));
  set("hashtags", list(b.hashtags).map((h) => (h.startsWith("#") ? h : `#${h}`)));
  set("budget", num(b.budget));
  set("owner", str(b.owner, 100));
  set("resultsSummary", str(b.resultsSummary, 5000));
  if (b.clientId !== undefined || b.clientName !== undefined) {
    if (b.clientId && validId(b.clientId)) {
      const c = await LeadClient.findOne({ _id: b.clientId, isDeleted: { $ne: true } }).select("brandName").lean();
      if (!c) throw Object.assign(new Error("Client not found"), { status: 400 });
      out.clientId = c._id;
      out.clientName = c.brandName;
    } else {
      out.clientId = undefined;
      out.clientName = str(b.clientName, 150);
    }
  }
  return out;
};

// GET /campaign?q&clientId&status&influencerId
export const listCampaigns = async (req, res) => {
  try {
    const f = { isDeleted: { $ne: true } };
    if (req.query.q) {
      const rx = new RegExp(escapeRegex(str(req.query.q, 100)), "i");
      f.$or = [{ name: rx }, { clientName: rx }, { objective: rx }, { hashtags: rx }, { "entries.name": rx }];
    }
    if (req.query.clientId && validId(req.query.clientId)) f.clientId = req.query.clientId;
    if (CAMPAIGN_STATUSES.includes(req.query.status)) f.status = req.query.status;
    if (req.query.influencerId && validId(req.query.influencerId)) f["entries.influencerId"] = req.query.influencerId;
    const rows = await Campaign.find(f).select("-brief -entries.notes").sort({ startDate: -1, createdAt: -1 }).lean();
    const clients = await Campaign.aggregate([{ $match: { isDeleted: { $ne: true } } }, { $group: { _id: { id: "$clientId", name: "$clientName" }, n: { $sum: 1 } } }, { $sort: { "_id.name": 1 } }]);
    res.json({
      success: true,
      campaigns: rows.map((c) => {
        const { entries, ...rest } = c;
        const t = campaignTotals(c);
        return { ...rest, totals: t, preview: entries.filter((e) => e.status !== "Dropped").slice(0, 6).map((e) => ({ name: e.name, handle: e.handle })) };
      }),
      clients: clients.map((c) => ({ _id: c._id.id, name: c._id.name, campaigns: c.n })),
      options: { statuses: CAMPAIGN_STATUSES, entryStatuses: ENTRY_STATUSES, platforms: INFLUENCER_PLATFORMS, metrics: METRIC_KEYS },
    });
  } catch (err) {
    fail(res, err);
  }
};

export const getCampaign = async (req, res) => {
  try {
    const c = await loadCampaign(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Campaign not found" });
    // Current status / contacts live on the influencer; the entry keeps the campaign-time snapshot
    const infs = await Influencer.find({ _id: { $in: c.entries.map((e) => e.influencerId) } }).select("name status tier email phone isDeleted").lean();
    const byId = new Map(infs.map((i) => [String(i._id), i]));
    res.json({
      success: true,
      campaign: { ...withTotals(c), entries: c.entries.map((e) => ({ ...e.toObject(), influencer: byId.get(String(e.influencerId)) || null })) },
      options: { statuses: CAMPAIGN_STATUSES, entryStatuses: ENTRY_STATUSES, platforms: INFLUENCER_PLATFORMS, metrics: METRIC_KEYS },
    });
  } catch (err) {
    fail(res, err);
  }
};

export const createCampaign = async (req, res) => {
  try {
    const data = await campaignFields(req.body);
    if (!data.name) return res.status(400).json({ success: false, message: "Name the campaign" });
    if (!data.clientId && !data.clientName) return res.status(400).json({ success: false, message: "Pick the client" });
    const c = await Campaign.create({ ...data, createdBy: displayName(req), updatedBy: displayName(req) });
    audit(req, c, "create", `Campaign for ${c.clientName}`);
    res.status(201).json({ success: true, campaign: withTotals(c) });
  } catch (err) {
    fail(res, err, 400);
  }
};

export const updateCampaign = async (req, res) => {
  try {
    const c = await loadCampaign(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Campaign not found" });
    const data = await campaignFields(req.body);
    if (data.name === "") delete data.name;
    if (data.clientId === undefined && data.clientName === "") {
      delete data.clientId;
      delete data.clientName;
    }
    Object.assign(c, data, { updatedBy: displayName(req) });
    await c.save();
    audit(req, c, "update", "Campaign details updated");
    res.json({ success: true, campaign: withTotals(c) });
  } catch (err) {
    fail(res, err, 400);
  }
};

export const deleteCampaign = async (req, res) => {
  try {
    if (!isAdminReq(req)) return res.status(403).json({ success: false, message: "Only admins can delete campaigns" });
    const c = await loadCampaign(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Campaign not found" });
    c.isDeleted = true;
    c.share.enabled = false;
    await c.save();
    audit(req, c, "delete", "Campaign deleted");
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
};

/* ---------- Roster ---------- */
const snapshot = (inf, platform) => {
  const p = (inf.platforms || []).find((x) => x.platform === platform) || [...(inf.platforms || [])].sort((a, b) => (b.followers || 0) - (a.followers || 0))[0] || {};
  return { influencerId: inf._id, name: inf.name, platform: p.platform || "", handle: p.handle || "", profileUrl: p.url || "", followers: p.followers || 0 };
};

const metrics = (m = {}, prev = {}) => Object.fromEntries(METRIC_KEYS.map((k) => [k, m[k] !== undefined ? num(m[k]) : Number(prev[k]) || 0]));

const entryFields = (b = {}, prev = {}) => {
  const out = {};
  const set = (k, v) => b[k] !== undefined && (out[k] = v);
  set("deliverables", str(b.deliverables, 500));
  set("fee", num(b.fee));
  set("barter", !!b.barter);
  set("status", pick(b.status, ENTRY_STATUSES, prev.status || "Shortlisted"));
  set("postDate", date(b.postDate));
  set("links", links(b.links));
  set("featured", !!b.featured);
  set("notes", str(b.notes, 2000));
  set("platform", pick(b.platform, INFLUENCER_PLATFORMS, prev.platform || ""));
  set("handle", str(b.handle, 100).replace(/^@+/, ""));
  set("followers", num(b.followers));
  if (b.metrics !== undefined) out.metrics = metrics(b.metrics, prev.metrics?.toObject?.() || prev.metrics);
  return out;
};

// Influencers who posted for a client have been worked with
const markWorkedWith = async (entries) => {
  const ids = entries.filter((e) => ["Posted", "Paid"].includes(e.status)).map((e) => e.influencerId);
  if (ids.length) await Influencer.updateMany({ _id: { $in: ids }, status: { $in: ["Prospect", "Contacted", "In talks"] } }, { $set: { status: "Worked with" } });
};

// POST /campaign/:id/entries { influencerIds: [...] } or { influencer: { name, platform, handle, followers, url } }
export const addEntries = async (req, res) => {
  try {
    const c = await loadCampaign(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Campaign not found" });
    const have = new Set(c.entries.map((e) => String(e.influencerId)));
    const platform = c.platforms?.[0];
    let added = 0;
    if (req.body?.influencer) {
      const b = req.body.influencer;
      const parsed = fromUrl(b.url || b.handle || "");
      const p = cleanPlatform({ platform: b.platform || platform || "Instagram", handle: parsed.handle, url: parsed.url, followers: num(b.followers) });
      const data = { name: str(b.name, 150), platforms: p.handle || p.url || p.followers ? [p] : [] };
      if (!data.name) return res.status(400).json({ success: false, message: "Enter the influencer's name" });
      let inf = await findDuplicate(data);
      inf = inf ? await Influencer.findById(inf._id) : await Influencer.create({ ...data, createdBy: displayName(req), updatedBy: displayName(req) });
      if (!have.has(String(inf._id))) {
        c.entries.push({ ...snapshot(inf, p.platform), ...entryFields(req.body), addedBy: displayName(req) });
        added++;
      }
    } else {
      const ids = (Array.isArray(req.body?.influencerIds) ? req.body.influencerIds : []).filter(validId).slice(0, 300);
      const infs = await Influencer.find({ _id: { $in: ids }, isDeleted: { $ne: true } }).lean();
      for (const inf of infs) {
        if (have.has(String(inf._id))) continue;
        c.entries.push({ ...snapshot(inf, platform), status: "Shortlisted", addedBy: displayName(req) });
        have.add(String(inf._id));
        added++;
      }
    }
    c.updatedBy = displayName(req);
    await c.save();
    await markWorkedWith(c.entries);
    if (added) audit(req, c, "update", `${added} influencer${added === 1 ? "" : "s"} added`);
    res.status(201).json({ success: true, added, campaign: withTotals(c) });
  } catch (err) {
    fail(res, err, 400);
  }
};

export const updateEntry = async (req, res) => {
  try {
    const c = await loadCampaign(req.params.id);
    const e = c?.entries.id(req.params.entryId);
    if (!e) return res.status(404).json({ success: false, message: "Influencer not in this campaign" });
    Object.assign(e, entryFields(req.body, e));
    c.updatedBy = displayName(req);
    await c.save();
    await markWorkedWith([e]);
    res.json({ success: true, campaign: withTotals(c) });
  } catch (err) {
    fail(res, err, 400);
  }
};

export const removeEntry = async (req, res) => {
  try {
    const c = await loadCampaign(req.params.id);
    const e = c?.entries.id(req.params.entryId);
    if (!e) return res.status(404).json({ success: false, message: "Influencer not in this campaign" });
    e.deleteOne();
    c.updatedBy = displayName(req);
    await c.save();
    res.json({ success: true, campaign: withTotals(c) });
  } catch (err) {
    fail(res, err);
  }
};

/* POST /campaign/:id/import { rows: [{ name, platform, handle (or profile link), followers, deliverables, fee, status,
   postDate, links, views, reach, impressions, likes, comments, shares, saves, clicks, notes }] }
   Each row is matched to an influencer already in the CRM (same handle, else same name); anyone new is created. */
export const importRoster = async (req, res) => {
  try {
    const c = await loadCampaign(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Campaign not found" });
    const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 1000) : [];
    if (!rows.length) return res.status(400).json({ success: false, message: "No rows to import" });
    const result = { added: 0, updated: 0, createdInfluencers: 0, errors: [] };
    for (const [i, r] of rows.entries()) {
      try {
        const name = str(r.name, 150);
        const { handle, url } = fromUrl(r.handle || r.profile || r.link || "");
        const platformGuess = /youtube|youtu\.be/i.test(url) ? "YouTube" : /instagram/i.test(url) ? "Instagram" : /facebook/i.test(url) ? "Facebook" : "";
        const platform = pick(INFLUENCER_PLATFORMS.find((p) => p.toLowerCase() === str(r.platform).toLowerCase()), INFLUENCER_PLATFORMS, platformGuess || c.platforms?.[0] || "Instagram");
        if (!name && !handle) {
          result.errors.push({ row: i + 2, message: "Name or handle is missing" });
          continue;
        }
        const p = cleanPlatform({ platform, handle, url, followers: num(r.followers) });
        let inf = null;
        const dup = await findDuplicate({ platforms: p.handle ? [p] : [] });
        if (dup) inf = await Influencer.findById(dup._id);
        if (!inf && name) inf = await Influencer.findOne({ isDeleted: { $ne: true }, name: new RegExp(`^${escapeRegex(name)}$`, "i") });
        if (!inf) {
          inf = await Influencer.create({ name: name || `@${p.handle}`, platforms: p.handle || p.url || p.followers ? [p] : [], createdBy: displayName(req), updatedBy: displayName(req) });
          result.createdInfluencers++;
        } else if (p.handle && !inf.platforms.some((x) => x.platform === p.platform)) {
          inf.platforms.push(p);
          await inf.save();
        }
        const fields = entryFields({
          deliverables: r.deliverables,
          fee: r.fee,
          barter: /^(y|yes|true|1|barter)$/i.test(str(r.barter)),
          status: ENTRY_STATUSES.find((s) => s.toLowerCase() === str(r.status).toLowerCase()) || (links(r.links).length ? "Posted" : undefined),
          postDate: r.postDate || undefined,
          links: r.links,
          notes: r.notes,
          metrics: Object.fromEntries(METRIC_KEYS.filter((k) => r[k] !== undefined && r[k] !== "").map((k) => [k, r[k]])),
        });
        const existing = c.entries.find((e) => String(e.influencerId) === String(inf._id));
        if (existing) {
          Object.assign(existing, fields);
          result.updated++;
        } else {
          const snap = snapshot(inf, p.platform);
          if (p.followers) snap.followers = p.followers;
          c.entries.push({ ...snap, ...fields, addedBy: displayName(req) });
          result.added++;
        }
      } catch (err) {
        result.errors.push({ row: i + 2, message: err.message });
      }
    }
    c.updatedBy = displayName(req);
    await c.save();
    await markWorkedWith(c.entries);
    audit(req, c, "import", `Roster import: ${result.added} added, ${result.updated} updated`);
    res.json({ success: true, ...result, campaign: withTotals(c) });
  } catch (err) {
    fail(res, err);
  }
};

/* ---------- Client report link ---------- */
// POST /campaign/:id/share { enabled, showFees, showBudget, regenerate }
export const shareCampaign = async (req, res) => {
  try {
    const c = await loadCampaign(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Campaign not found" });
    const b = req.body || {};
    if (b.enabled !== undefined) c.share.enabled = !!b.enabled;
    if (b.showFees !== undefined) c.share.showFees = !!b.showFees;
    if (b.showBudget !== undefined) c.share.showBudget = !!b.showBudget;
    if (!c.share.token || b.regenerate) c.share.token = crypto.randomBytes(24).toString("base64url");
    c.updatedBy = displayName(req);
    await c.save();
    audit(req, c, "update", c.share.enabled ? "Client report link on" : "Client report link off");
    res.json({ success: true, share: c.share });
  } catch (err) {
    fail(res, err);
  }
};

// Public, no login: what a client sees. No influencer contacts, internal notes or (unless switched on) fees.
export const publicCampaign = (c, company) => {
  const showFees = !!c.share?.showFees;
  const entries = (c.entries || [])
    .filter((e) => e.status !== "Dropped")
    .sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || (b.metrics?.views || 0) - (a.metrics?.views || 0))
    .map((e) => ({
      name: e.name,
      platform: e.platform,
      handle: e.handle,
      profileUrl: e.profileUrl,
      followers: e.followers,
      deliverables: e.deliverables,
      status: ["Posted", "Paid"].includes(e.status) ? "Posted" : e.status === "Content in review" ? "In production" : e.status === "Confirmed" ? "Confirmed" : "Planned",
      postDate: e.postDate,
      links: e.links,
      metrics: e.metrics,
      featured: !!e.featured,
      ...(showFees && { fee: e.fee, barter: e.barter }),
    }));
  const totals = campaignTotals(c);
  if (!showFees) {
    delete totals.spend;
    delete totals.costPerView;
  }
  return {
    name: c.name,
    clientName: c.clientName,
    objective: c.objective,
    brief: c.brief,
    startDate: c.startDate,
    endDate: c.endDate,
    status: c.status,
    platforms: c.platforms,
    hashtags: c.hashtags,
    resultsSummary: c.resultsSummary,
    ...(c.share?.showBudget && { budget: c.budget, currency: c.currency }),
    totals,
    entries,
    company,
    updatedAt: c.updatedAt,
  };
};

const campaignByToken = (token) => (token && token.length >= 20 ? Campaign.findOne({ "share.token": token, "share.enabled": true, isDeleted: { $ne: true } }) : null);

// GET /public/campaign/:token
export const viewPublicCampaign = async (req, res) => {
  try {
    const c = await campaignByToken(req.params.token);
    if (!c) return res.status(404).json({ success: false, message: "This campaign report isn't available" });
    await Campaign.updateOne({ _id: c._id }, { $inc: { "share.views": 1 }, $set: { "share.lastViewedAt": new Date() } });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    const { gstin, ...brand } = company();
    res.json({ success: true, campaign: publicCampaign(c, brand) });
  } catch (err) {
    fail(res, err);
  }
};
