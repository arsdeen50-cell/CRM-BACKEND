import mongoose from "mongoose";

export const CUSTOM_FIELD_ENTITIES = ["client", "lead"];
export const CUSTOM_FIELD_TYPES = ["text", "long_text", "number", "money", "date", "select", "checkbox", "url"];

/* An extra field admins add to clients or leads without code (e.g. "Ad budget", "Instagram followers",
   "Contract renewal date"). Values live in the record's `custom` object under the field's key. */
const customFieldSchema = new mongoose.Schema(
  {
    entity: { type: String, enum: CUSTOM_FIELD_ENTITIES, required: true, index: true },
    key: { type: String, required: true, match: /^[a-zA-Z][a-zA-Z0-9]{0,39}$/ },
    label: { type: String, required: true, trim: true, maxlength: 60 },
    type: { type: String, enum: CUSTOM_FIELD_TYPES, default: "text" },
    options: { type: [String], default: [] }, // for select
    help: { type: String, default: "", maxlength: 160 },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);
customFieldSchema.index({ entity: 1, key: 1 }, { unique: true });

export const CustomField = mongoose.model("CustomField", customFieldSchema);
