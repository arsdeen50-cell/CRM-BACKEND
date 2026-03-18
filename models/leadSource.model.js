import mongoose from "mongoose";

const leadSourceSchema = new mongoose.Schema(
  {
    series: { type: String },
    
    // Fixed: Changed arrays to single values or proper arrays
    serviceType: { 
      type: [String],
      required: true 
    },
    leadSourceType: { 
      type: String, 
      required: true 
    },
    leadStatusType: { 
      type: String, 
      required: true 
    },

    projectAccountHandledBy: { type: String },
    teamAssigned: { type: String },
    teamMember: { type: String },
    priority: { type: String },
    proposalSent: { type: String },
    convertedToProject: { type: String },
    createdBy: { type: String },
    documents: [{
      fileName: { type: String },
      fileUrl: { type: String },
      uploadedAt: { type: Date, default: Date.now }
    }],
  },
  { timestamps: true }
);

// Fixed: Auto-incrementing series
leadSourceSchema.pre("save", async function (next) {
  if (!this.series) {
    const year = new Date().getFullYear();
    
    // Find the count of leads for this year to create incremental number
    const count = await mongoose.model("LeadSource").countDocuments({
      series: new RegExp(`CRM-LEAD-${year}-`)
    });
    
    this.series = `CRM-LEAD-${year}-${(count + 1).toString().padStart(4, '0')}`;
  }
  next();
});

export const LeadSource = mongoose.model("LeadSource", leadSourceSchema);