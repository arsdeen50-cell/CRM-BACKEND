import mongoose from "mongoose";
import { Interview, INTERVIEW_MODES, INTERVIEW_STATUSES, RECOMMENDATIONS } from "../models/interview.model.js";
import { GoOnBoarding } from "../models/GoOnBoarding.model.js";
import { User } from "../models/user.model.js";
import { notify } from "../utils/notify.js";
import { companyName } from "../utils/config.js";

const fail = (res, err, code = 500) => res.status(err.status || code).json({ success: false, message: err.message || "Server error" });
const validId = (id) => mongoose.Types.ObjectId.isValid(id);
const by = (req) => req.currentUser?.fullname || "HR";
const when = (d) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// The fields HR may set, cleaned; throws on bad input
const clean = async (b = {}, existing) => {
  const out = {};
  if (b.round !== undefined) {
    out.round = String(b.round).trim().slice(0, 80);
    if (!out.round) throw Object.assign(new Error("Name the round, e.g. Screening call"), { status: 400 });
  }
  if (b.scheduledAt !== undefined) {
    const d = new Date(b.scheduledAt);
    if (isNaN(d)) throw Object.assign(new Error("Pick the date and time"), { status: 400 });
    out.scheduledAt = d;
  }
  if (b.durationMinutes !== undefined) out.durationMinutes = Math.min(480, Math.max(5, Number(b.durationMinutes) || 30));
  if (b.mode !== undefined) out.mode = INTERVIEW_MODES.includes(b.mode) ? b.mode : "Video call";
  if (b.location !== undefined) out.location = String(b.location).trim().slice(0, 300);
  if (b.interviewerIds !== undefined) {
    const ids = (Array.isArray(b.interviewerIds) ? b.interviewerIds : []).filter(validId);
    const people = await User.find({ _id: { $in: ids }, isActive: { $ne: false } }).select("fullname").lean();
    out.interviewerIds = people.map((p) => p._id);
    out.interviewerNames = people.map((p) => p.fullname);
  }
  if (b.status !== undefined) out.status = INTERVIEW_STATUSES.includes(b.status) ? b.status : existing?.status || "Scheduled";
  if (b.rating !== undefined) out.rating = b.rating === null || b.rating === "" ? undefined : Math.min(5, Math.max(1, Math.round(Number(b.rating)) || 1));
  if (b.recommendation !== undefined) out.recommendation = RECOMMENDATIONS.includes(b.recommendation) ? b.recommendation : "";
  if (b.feedback !== undefined) out.feedback = String(b.feedback).slice(0, 4000);
  return out;
};

// GET /onboarding/:id/interviews
export const listInterviews = async (req, res) => {
  try {
    if (!validId(req.params.id)) return res.status(404).json({ success: false, message: "Candidate not found" });
    const interviews = await Interview.find({ onboardingId: req.params.id }).sort({ scheduledAt: 1 }).lean();
    const rated = interviews.filter((i) => i.rating);
    res.json({
      success: true,
      interviews,
      summary: { rounds: interviews.length, done: interviews.filter((i) => i.status === "Done").length, averageRating: rated.length ? Math.round((rated.reduce((t, i) => t + i.rating, 0) / rated.length) * 10) / 10 : null },
      modes: INTERVIEW_MODES,
      statuses: INTERVIEW_STATUSES,
      recommendations: RECOMMENDATIONS,
    });
  } catch (err) {
    fail(res, err);
  }
};

// POST /onboarding/:id/interviews - schedule a round (interviewers get a notification)
export const createInterview = async (req, res) => {
  try {
    const ob = validId(req.params.id) && (await GoOnBoarding.findById(req.params.id).select("candidateName").lean());
    if (!ob) return res.status(404).json({ success: false, message: "Candidate not found" });
    const data = await clean(req.body);
    if (!data.round || !data.scheduledAt) return res.status(400).json({ success: false, message: "Give the round a name and a date and time" });
    const interview = await Interview.create({ ...data, onboardingId: ob._id, candidateName: ob.candidateName, createdBy: by(req) });
    if (interview.interviewerIds.length) {
      notify(interview.interviewerIds, { kind: "interview", title: `Interview: ${ob.candidateName} (${interview.round})`, body: `${when(interview.scheduledAt)} · ${interview.mode}${interview.location ? ` · ${interview.location}` : ""}`, link: `/crm/goonboarding/${ob._id}` }, { email: true, exclude: req.id });
    }
    res.status(201).json({ success: true, interview });
  } catch (err) {
    fail(res, err);
  }
};

// PUT /onboarding/:id/interviews/:iid - reschedule, or record the outcome and feedback
export const updateInterview = async (req, res) => {
  try {
    const interview = validId(req.params.iid) && (await Interview.findOne({ _id: req.params.iid, onboardingId: req.params.id }));
    if (!interview) return res.status(404).json({ success: false, message: "Interview not found" });
    const data = await clean(req.body, interview);
    if (data.feedback !== undefined || data.rating !== undefined || data.recommendation !== undefined) data.feedbackBy = by(req);
    Object.assign(interview, data);
    if (data.rating === undefined && req.body.rating !== undefined) interview.rating = undefined;
    await interview.save();
    res.json({ success: true, interview });
  } catch (err) {
    fail(res, err);
  }
};

export const deleteInterview = async (req, res) => {
  try {
    const out = validId(req.params.iid) ? await Interview.deleteOne({ _id: req.params.iid, onboardingId: req.params.id }) : { deletedCount: 0 };
    if (!out.deletedCount) return res.status(404).json({ success: false, message: "Interview not found" });
    res.json({ success: true });
  } catch (err) {
    fail(res, err);
  }
};

// GET /onboarding/:id/interviews/:iid/ics - a calendar invite to add to Google Calendar / Outlook / Apple Calendar
const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
export const interviewIcs = async (req, res) => {
  try {
    const i = validId(req.params.iid) && (await Interview.findOne({ _id: req.params.iid, onboardingId: req.params.id }).lean());
    if (!i) return res.status(404).json({ success: false, message: "Interview not found" });
    const end = new Date(new Date(i.scheduledAt).getTime() + (i.durationMinutes || 30) * 60000);
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${icsText(companyName())}//CRM//EN`, "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:interview-${i._id}@crm`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(i.scheduledAt)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsText(`Interview: ${i.candidateName} - ${i.round}`)}`,
      `DESCRIPTION:${icsText([`${i.mode}`, i.interviewerNames?.length ? `Interviewers: ${i.interviewerNames.join(", ")}` : "", i.location].filter(Boolean).join("\n"))}`,
      ...(i.location ? [`LOCATION:${icsText(i.location)}`] : []),
      i.status === "Cancelled" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
      "END:VEVENT", "END:VCALENDAR",
    ];
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="interview-${String(i.candidateName || "candidate").replace(/[^\w-]+/g, "-")}.ics"`);
    res.send(lines.join("\r\n"));
  } catch (err) {
    fail(res, err);
  }
};

// GET /onboarding/interviews/upcoming - the next two weeks, for the onboarding list
export const upcomingInterviews = async (req, res) => {
  try {
    const now = new Date();
    const interviews = await Interview.find({ status: "Scheduled", scheduledAt: { $gte: new Date(now.getTime() - 2 * 3600 * 1000), $lte: new Date(now.getTime() + 14 * 86400000) } }).sort({ scheduledAt: 1 }).limit(50).lean();
    res.json({ success: true, interviews });
  } catch (err) {
    fail(res, err);
  }
};
