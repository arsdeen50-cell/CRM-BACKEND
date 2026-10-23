import { HrSettings, Holiday, LeaveAdjustment, LEAVE_TYPES } from "../models/hr.model.js";
import { Leave } from "../models/leave.model.js";
import { localDayKey, TZ_OFFSET_MIN } from "./config.js";

export const getHrSettings = async () => {
  let s = await HrSettings.findOne({ key: "default" });
  if (!s) s = await HrSettings.create({ key: "default" });
  return s;
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
