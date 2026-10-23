// Phone helpers. WhatsApp wants digits with country code; 10-digit numbers are assumed to be Indian (+91).
export const digitsOnly = (p = "") => String(p || "").replace(/\D/g, "");
export const normalizePhone = (p = "") => {
  const d = digitsOnly(p);
  if (!d) return "";
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith("0")) return `91${d.slice(1)}`;
  return d;
};
export const samePhone = (a, b) => {
  const x = digitsOnly(a), y = digitsOnly(b);
  return x.length >= 10 && y.length >= 10 && x.slice(-10) === y.slice(-10);
};
export const isRealPhone = (p = "") => !!p && !/^not public$/i.test(String(p).trim()) && digitsOnly(p).length >= 10;
export const isRealEmail = (e = "") => !!e && /@/.test(e) && !/placeholder\.invalid$/i.test(e);
