import mongoose from "mongoose";

export const EXPENSE_CATEGORIES = ["Travel", "Food", "Client meeting", "Software / subscriptions", "Equipment", "Shoot / production", "Office supplies", "Other"];
export const EXPENSE_STATUSES = ["Submitted", "Approved", "Rejected", "Paid"];
export const PAYMENT_METHODS = ["Bank transfer", "UPI", "Cash", "With salary"];

/* An expense someone paid for the company and wants back: they submit it with a receipt, an admin approves
   or rejects it, and marks it paid once reimbursed. The receipt file sits on the server's private disk. */
const expenseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    employeeName: { type: String, default: "" },
    date: { type: Date, required: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, default: "Other" },
    amount: { type: Number, required: true, min: 1 },
    description: { type: String, required: true, trim: true },
    client: { type: String, default: "", trim: true }, // the client or project it was for, if any
    receipt: { storedName: String, name: String, mimeType: String, size: Number },
    status: { type: String, enum: EXPENSE_STATUSES, default: "Submitted", index: true },
    decidedBy: { type: String, default: "" },
    decidedAt: Date,
    decisionNote: { type: String, default: "" },
    paidBy: { type: String, default: "" },
    paidAt: Date,
    paymentMethod: { type: String, default: "" },
    paymentRef: { type: String, default: "" },
  },
  { timestamps: true }
);
expenseSchema.index({ date: -1 });

export const Expense = mongoose.model("Expense", expenseSchema);
