import { HrSettings, Holiday, LeaveAdjustment, ShiftRoster, LEAVE_TYPES } from "../models/hr.model.js";
import { Leave } from "../models/leave.model.js";
import { localDayKey, TZ_OFFSET_MIN } from "./config.js";

export const getHrSettings = async () => {
  let s = await HrSettings.findOne({ key: "default" });
  if (!s) s = await HrSettings.create({ key: "default" });
  return s;
};

// The working hours that apply to someone: their shift, or the Regular office timing when they have none
export const shiftOf = (settings, shiftId) => {
  const s = shiftId && (settings.shifts || []).find((x) => String(x._id) === String(shiftId));
  const base = { graceMinutes: settings.graceMinutes || 0 };
  return s
    ? { ...base, id: String(s._id), name: s.name, start: s.start, timeZone: s.timeZone || "", fullDayHours: s.fullDayHours, halfDayHours: s.halfDayHours }
    : { ...base, id: "", name: "Regular", start: settings.officeStart, timeZone: "", fullDayHours: settings.fullDayHours, halfDayHours: settings.halfDayHours };
};

export const validTimeZone = (tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
// Minutes east of UTC for a zone on a date (e.g. America/New_York: -240 in summer, -300 in winter)
const zoneOffsetMin = (tz, date) => {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value || "GMT";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
};
const hhmm = (s = "00:00") => {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
// When a shift starts on a business day, as minutes after local (CRM time zone) midnight. A US 6:00 Eastern start
// is 15:30 IST in summer and 16:30 IST in winter.
export const shiftStartMin = (shift, dayKey) => {
  if (!shift.timeZone) return hhmm(shift.start);
  const diff = TZ_OFFSET_MIN - zoneOffsetMin(shift.timeZone, new Date(`${dayKey}T12:00:00Z`));
  return (((hhmm(shift.start) + diff) % 1440) + 1440) % 1440;
};
export const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/* Who works which shift on which day: the roster entry for that day if there is one, else the profile's shift.
   Returns a function (userId, dayKey) -> { ...shift, off }. */
export const shiftResolver = async (settings, profiles, fromKey, toKey) => {
  const userIds = profiles.map((p) => p.userId);
  const entries = await ShiftRoster.find({ userId: { $in: userIds }, date: { $gte: fromKey, $lte: toKey } }).lean();
  const rostered = new Map(entries.map((e) => [`${e.userId}|${e.date}`, e]));
  const profileShift = new Map(profiles.map((p) => [String(p.userId), p.shiftId]));
  return (userId, dayKey) => {
    const e = rostered.get(`${userId}|${dayKey}`);
    if (e) return { ...shiftOf(settings, e.off ? null : e.shiftId), off: !!e.off, rostered: true };
    return { ...shiftOf(settings, profileShift.get(String(userId))), off: false, rostered: false };
  };
};

const DAY = 86400000;
const dayKeyToDate = (k) => new Date(`${k}T00:00:00Z`);
export const dayKeysBetween = (fromKey, toKey) => {
  const out = [];
  for (let t = dayKeyToDate(fromKey).getTime(); t <= dayKeyToDate(toKey).getTime(); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};
export const weekday = (key) => dayKeyToDate(key).getUTCDay();
export const monthKeys = (month) => {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return dayKeysBetween(`${month}-01`, `${month}-${String(last).padStart(2, "0")}`);
};
// Start of a business-time-zone day as a UTC instant
export const localDayStart = (key) => new Date(dayKeyToDate(key).getTime() - TZ_OFFSET_MIN * 60000);

export const holidayMap = async (fromKey, toKey) => {
  const list = await Holiday.find({ date: { $gte: fromKey, $lte: toKey } }).lean();
  return new Map(list.map((h) => [h.date, h]));
};

// Working days between two dates (inclusive): weekly offs and non-optional holidays are skipped
export const countLeaveDays = async (start, end, halfDay = false) => {
  const settings = await getHrSettings();
  const a = localDayKey(start), b = localDayKey(end);
  if (b < a) return 0;
  const holidays = await holidayMap(a, b);
  const days = dayKeysBetween(a, b).filter((k) => !settings.weeklyOffs.includes(weekday(k)) && !(holidays.get(k) && !holidays.get(k).optional)).length;
  return halfDay ? (days ? 0.5 : 0) : days;
};

// Leave year containing a date, e.g. { year: 2026, start: 2026-04-01, end: 2027-03-31 } when it starts in April
export const leaveYearOf = (date, startMonth = 1) => {
  const key = localDayKey(date);
  const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7));
  const year = m >= startMonth ? y : y - 1;
  const start = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(year + 1, startMonth - 1, 0));
  return { year, startKey: start, endKey: endDate.toISOString().slice(0, 10) };
};

// Quota, used (approved), pending and available days per leave type for one person and leave year
export const leaveBalance = async (userId, date = new Date()) => {
  const settings = await getHrSettings();
  const { year, startKey, endKey } = leaveYearOf(date, settings.leaveYearStartMonth);
  const [leaves, adjustments] = await Promise.all([
    Leave.find({ employee: userId, status: { $in: ["Approved", "Pending"] }, startDate: { $gte: localDayStart(startKey), $lt: new Date(localDayStart(endKey).getTime() + DAY) } }).lean(),
    LeaveAdjustment.find({ userId, year }).lean(),
  ]);
  const types = {};
  for (const t of LEAVE_TYPES) {
    const base = settings.leaveQuotas?.[t];
    const extra = adjustments.filter((a) => a.leaveType === t).reduce((s, a) => s + a.days, 0);
    const quota = base === null || base === undefined ? null : base + extra;
    const used = leaves.filter((l) => l.leaveType === t && l.status === "Approved").reduce((s, l) => s + (l.days || 0), 0);
    const pending = leaves.filter((l) => l.leaveType === t && l.status === "Pending").reduce((s, l) => s + (l.days || 0), 0);
    types[t] = { quota, adjustments: extra, used, pending, available: quota === null ? null : Math.max(0, quota - used - pending), unpaid: settings.unpaidLeaveTypes.includes(t) };
  }
  return { year, from: startKey, to: endKey, types };
};
