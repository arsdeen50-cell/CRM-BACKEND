import mongoose from "mongoose";

export const PIPELINE_STAGES = [
  "Lead",
  "Qualified",
  "Proposal Sent",
  "Negotiation",
  "Won",
  "Lost",
];

const stageHistorySchema = new mongoose.Schema(
  {
    stage: { type: String, enum: PIPELINE_STAGES, required: true },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: String },
    reason: { type: String },
  },
  { _id: false }
);

const activityLogSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["Call", "Email", "Meeting", "Note"], default: "Note" },
    note: { type: String },
    loggedBy: { type: String },
    loggedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const leadSourceSchema = new mongoose.Schema(
  {
    series: { type: String },

    // Client reference
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LeadClient",
    },
    clientName: {
      type: String,
      trim: true,
    },

    // Service and lead details
    serviceType: {
      type: [String],
      required: true,
    },
    leadSourceType: {
      type: String,
      required: true,
    },
    leadStatusType: {
      type: String,
      required: true,
    },

    // Pipeline
    pipelineStage: {
      type: String,
      enum: PIPELINE_STAGES,
      default: "Lead",
    },
    stageHistory: [stageHistorySchema],

    // Deal details
    dealValue: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      default: "INR",
    },
    expectedCloseDate: { type: Date },

    nextFollowUpDate: { type: Date },

    // Activity
    activityLog: [activityLogSchema],

    // Lost reason
    lostReason: { type: String },

    // Assignment
    projectAccountHandledBy: { type: String },
    teamAssigned: { type: String },
    teamMember: { type: String },
    priority: { type: String },
    proposalSent: { type: String },
    convertedToProject: { type: String },
    createdBy: { type: String },
    
    // Documents
    documents: [
      {
        fileName: { type: String },
        fileUrl: { type: String },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// Auto-generate series number
leadSourceSchema.pre("save", async function (next) {
  if (!this.series) {
    const year = new Date().getFullYear();
    const count = await mongoose.model("LeadSource").countDocuments({
      series: new RegExp(`CRM-LEAD-${year}-`),
    });
    this.series = `CRM-LEAD-${year}-${(count + 1).toString().padStart(4, "0")}`;
  }

  if (this.isNew && (!this.stageHistory || this.stageHistory.length === 0)) {
    this.stageHistory = [
      {
        stage: this.pipelineStage || "Lead",
        changedAt: new Date(),
        changedBy: this.createdBy || "System",
      },
    ];
  }

  next();
});

// Middleware to populate clientId automatically on find queries
leadSourceSchema.pre(/^find/, function(next) {
  this.populate('clientId');
  next();
});

export const LeadSource = mongoose.model("LeadSource", leadSourceSchema);