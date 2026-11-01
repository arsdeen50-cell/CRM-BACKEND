import { User } from "../models/user.model.js";

/* Employee codes run EMP-001, EMP-002 ... The next one is one past the highest code ever used, not the number of
   accounts, so a deleted account never makes a code come round again. */
export const nextEmpId = async (prefix = "EMP-") => {
  const users = await User.find({ empId: { $regex: `^${prefix}\\d+$` } }).select("empId").lean();
  const top = users.reduce((max, u) => Math.max(max, Number(u.empId.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(top + 1).padStart(3, "0")}`;
};

// True for Mongo's duplicate-key error on the employee code (two accounts created at the same moment)
export const isDuplicateEmpId = (err) => err?.code === 11000 && /empId/.test(err.message || "");

// Create a user with the next free code, trying again if someone else took it in the meantime
export const createWithEmpId = async (data, tries = 3) => {
  for (let i = 1; ; i++) {
    try {
      return await User.create({ ...data, empId: await nextEmpId() });
    } catch (err) {
      if (!isDuplicateEmpId(err) || i >= tries) throw err;
    }
  }
};
