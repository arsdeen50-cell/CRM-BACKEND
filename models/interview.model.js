import mongoose from "mongoose";

export const INTERVIEW_MODES = ["In person", "Video call", "Phone"];
export const INTERVIEW_STATUSES = ["Scheduled", "Done", "No-show", "Cancelled"];
export const RECOMMENDATIONS = ["Strong yes", "Yes", "Maybe", "No"];

/* One interview round with a candidate (an onboarding record): when, how, who interviews, and afterwards the
   rating, recommendation and feedback - so the hiring decision has its reasons written down. */
const interviewSchema = new mongoose.Schema(
  {
    onboardingId: { type: mongoose.Schema.Types.ObjectId, ref: "GoOnBoarding", required: true, index: true },
    candidateName: { type: String, default: "" },
    round: { type: String, required: true, trim: true, maxlength: 80 }, // e.g. Screening call, Portfolio review, Final
    scheduledAt: { type: Date, required: true },
    durationMinutes: { type: Number, default: 30, min: 5, max: 480 },
    mode: { type: String, enum: INTERVIEW_MODES, default: "Video call" },
    location: { type: String, default: "", trim: true, maxlength: 300 }, // address or meeting link
    interviewerIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    interviewerNames: [String],
    status: { type: String, enum: INTERVIEW_STATUSES, default: "Scheduled" },
    rating: { type: Number, min: 1, max: 5 },
    recommendation: { type: String, enum: [...RECOMMENDATIONS, ""], default: "" },
    feedback: { type: String, default: "", maxlength: 4000 },
    feedbackBy: { type: String, default: "" },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);
interviewSchema.index({ scheduledAt: 1, status: 1 });

export const Interview = mongoose.model("Interview", interviewSchema);
