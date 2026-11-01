import mongoose from "mongoose";

export const OFFER_FIELD_TYPES = ["text", "textarea", "number", "money", "date"];
export const SIGNERS = ["both", "Arsalan", "Fardeen"]; // who signs the letter

/* An offer-letter template for a kind of role (internship, full-time, contract ...). HR picks one per candidate,
   fills in its fields (stipend or salary, probation, hours ...) and the letter is built from it.
   Text may use {{placeholders}}: the candidate's details (candidateName, designation, positionType, doj, doe,
   duration, company) and the keys of the template's own fields. A section whose body is exactly
   {{keyResponsibilities}} or {{whatYoullGain}} lists those from the onboarding record. Lines starting "- " are bullets. */
const fieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, match: /^[a-zA-Z][a-zA-Z0-9]{0,39}$/ },
    label: { type: String, required: true, trim: true },
    type: { type: String, enum: OFFER_FIELD_TYPES, default: "text" },
    required: { type: Boolean, default: false },
    default: { type: String, default: "" },
    inPayTable: { type: Boolean, default: false }, // money fields listed in the pay table
  },
  { _id: false }
);

const offerTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    positionType: { type: String, default: "Any" }, // suggested for this position type
    designations: { type: [String], default: [] }, // and/or these designations
    title: { type: String, default: "{{positionType}} Offer - {{designation}}" },
    intro: { type: String, default: "" },
    payTitle: { type: String, default: "Compensation" },
    payAmountLabel: { type: String, default: "Amount" }, // heading of the amount column, e.g. "Monthly (₹)"
    payTotalLabel: { type: String, default: "" }, // when set, the pay table ends with a total row under this label
    signedBy: { type: String, enum: SIGNERS, default: "both" },
    sections: { type: [{ heading: String, body: String, _id: false }], default: [] },
    fields: { type: [fieldSchema], default: [] },
    terms: { type: [String], default: [] },
    closing: { type: String, default: "" },
    active: { type: Boolean, default: true },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

export const OfferTemplate = mongoose.model("OfferTemplate", offerTemplateSchema);
