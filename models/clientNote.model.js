import mongoose from "mongoose";

/* A note on a client, written by the team. "@Name" mentions notify the people mentioned. */
const clientNoteSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "LeadClient", required: true, index: true },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    authorName: { type: String, default: "" },
    pinned: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const ClientNote = mongoose.model("ClientNote", clientNoteSchema);
