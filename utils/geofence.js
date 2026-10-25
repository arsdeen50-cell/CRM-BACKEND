import { EmployeeProfile } from "../models/hr.model.js";
import { getHrSettings } from "./hrCalendar.js";

// Great-circle distance in metres
export const distanceMeters = (a, b) => {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

const validCoord = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

// Geofence settings plus the person's punch rule, for the punch button
export const geofenceFor = async (userId) => {
  const [settings, profile] = await Promise.all([getHrSettings(), EmployeeProfile.findOne({ userId }).select("punchRule").lean()]);
  const g = settings.geofence || {};
  const on = !!g.enabled && validCoord(g.lat, g.lng);
  return { enabled: on, mode: g.mode || "flag", name: g.name || "Office", lat: g.lat, lng: g.lng, radiusMeters: g.radiusMeters || 200, punchRule: profile?.punchRule || "office" };
};

/* Check a punch against the office geofence. body = { lat, lng, accuracy } from the browser (optional).
   Returns { location } to store on the attendance record, or { error } when a punch-in must be refused.
   Device accuracy (capped at 100 m) is allowed as slack so a weak GPS fix near the edge isn't flagged. */
export const checkPunch = async (userId, body = {}, { isPunchIn = true } = {}) => {
  const g = await geofenceFor(userId);
  const lat = Number(body.lat), lng = Number(body.lng);
  const accuracy = Number.isFinite(Number(body.accuracy)) ? Math.round(Number(body.accuracy)) : undefined;
  const shared = validCoord(lat, lng);
  const base = shared ? { lat, lng, accuracy } : {};

  if (!g.enabled) return { location: shared ? { ...base, status: "off" } : undefined };
  if (g.punchRule !== "office") return { location: { ...base, status: "exempt" } };

  if (!shared) {
    if (isPunchIn && g.mode === "block") return { error: "Allow location access to punch in - punch-in only works from the office" };
    return { location: { status: "unknown" } };
  }
  const distance = Math.round(distanceMeters({ lat, lng }, g));
  const inside = distance <= g.radiusMeters + Math.min(accuracy || 0, 100);
  if (!inside && isPunchIn && g.mode === "block") {
    const away = distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${distance} m`;
    return { error: `You're ${away} from ${g.name}. Punch-in only works within ${g.radiusMeters} m of it - ask HR if you're working from elsewhere today` };
  }
  return { location: { ...base, distance, status: inside ? "inside" : "outside" } };
};
