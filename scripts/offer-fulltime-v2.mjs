/* One-off: bring in the new Full-time offer letter (salary breakdown, notice period, leave, 11 terms).
   The existing "Full-time employee" template is kept, renamed "... (old)" and switched off, so candidates
   already using it are unaffected. Run from the backend folder: node scripts/offer-fulltime-v2.mjs */
import "dotenv/config";
import mongoose from "mongoose";
import { OfferTemplate } from "../models/offerTemplate.model.js";
import { FULL_TIME_TEMPLATE } from "../templatesOnBoarding/offerFromTemplate.js";

await mongoose.connect(process.env.MONGO_URL);
if (await OfferTemplate.exists({ name: FULL_TIME_TEMPLATE.name, "fields.key": "basicSalary" })) {
  console.log("New full-time template already in place");
} else {
  const old = await OfferTemplate.updateMany({ name: FULL_TIME_TEMPLATE.name }, { $set: { name: `${FULL_TIME_TEMPLATE.name} (old)`, active: false } });
  if (old.matchedCount || (await OfferTemplate.exists({}))) {
    await OfferTemplate.create({ ...FULL_TIME_TEMPLATE, updatedBy: "System" });
    console.log(`Added the new full-time template; ${old.modifiedCount} old one(s) switched off`);
  } else console.log("No templates yet - the new one is created with the starter set when HR first opens offer letters");
}
await mongoose.disconnect();
