/* One-off: where two accounts share an employee code, the first one created keeps it and the others get new codes
   (one past the highest in use). Needed before the unique index on empId can be built. Prints what it changes.
   Run from the backend folder: node scripts/fix-duplicate-empids.mjs */
import "dotenv/config";
import mongoose from "mongoose";
import { User } from "../models/user.model.js";
import { nextEmpId } from "../utils/empId.js";

await mongoose.connect(process.env.MONGO_URL, { dbName: process.env.MONGO_DB || undefined });
const dupes = await User.aggregate([{ $match: { empId: { $gt: "" } } }, { $group: { _id: "$empId", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
for (const { _id: code } of dupes) {
  const [, ...others] = await User.find({ empId: code }).sort({ createdAt: 1, _id: 1 });
  for (const u of others) {
    const fresh = await nextEmpId();
    await User.updateOne({ _id: u._id }, { $set: { empId: fresh } });
    console.log(`${u.fullname} (${u.email}): ${code} -> ${fresh}`);
  }
}
if (!dupes.length) console.log("No duplicate employee codes");
await User.createIndexes();
console.log("Unique employee-code index in place");
await mongoose.disconnect();
