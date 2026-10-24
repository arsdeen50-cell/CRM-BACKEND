import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";

import connectDB from "./utils/db.js";
import userRouter from "./routes/user.route.js";
import companyRoute from "./routes/comapny.route.js";
import jobRoute from "./routes/job.route.js";
import applicationRoute from "./routes/application.route.js";
import attendanceRoute from "./routes/attendance.route.js";
import taskRoute from "./routes/task.routes.js";
import leaveRoute from "./routes/leave.route.js";
import leadSourceRoute from "./routes/leadSource.route.js";
import goOnBoardingRoute from "./routes/goOnBoarding.route.js";
import leadClientRoute from "./routes/leadClient.route.js";
import designationRoute from "./routes/designation.route.js";
import proposalRoute from "./routes/proposal.route.js";
import projectRoute from "./routes/project.route.js";
import templateRoute from "./routes/template.route.js";
import auditRoute from "./routes/audit.route.js";
import messagingRoute from "./routes/messaging.route.js";
import sequenceRoute from "./routes/sequence.route.js";
import leadFormRoute from "./routes/leadForm.route.js";
import targetRoute from "./routes/target.route.js";
import invoiceRoute from "./routes/invoice.route.js";
import retainerRoute from "./routes/retainer.route.js";
import contentRoute from "./routes/content.route.js";
import timeRoute from "./routes/time.route.js";
import publicRoute from "./routes/public.route.js";
import teamRoute from "./routes/team.route.js";
import hrRoute from "./routes/hr.route.js";
import dashboardRoute from "./routes/dashboard.route.js";
import { backfillLeaveDays } from "./controllers/hr.controller.js";
import { scrubSignupPasswords } from "./controllers/goOnBoarding.controller.js";
import { portalRouter, portalAccessRouter } from "./routes/portal.route.js";
import { startFollowUpDigest } from "./utils/followupDigest.js";
import { startSequenceRunner } from "./utils/sequenceRunner.js";
import { startBillingRunner } from "./utils/billingRunner.js";
import { startExitRunner } from "./utils/exitService.js";
import { ensureSalesTeam } from "./utils/salesAccess.js";

/* ================= LOAD ENV ================= */
dotenv.config({ path: "/var/www/CRM_OWN/Backend/.env" });

if (!process.env.SECRET_KEY) {
  throw new Error("❌ SECRET_KEY not loaded. Check .env path.");
}

const app = express();

/* ================= TRUST PROXY ================= */
/* Required when running behind nginx with HTTPS */
app.set("trust proxy", 1);

/* ================= BODY PARSERS ================= */
// Keep the raw body: Meta and Razorpay webhooks are verified by signing the exact bytes received
app.use(express.json({ limit: "50mb", verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());

/* ================= CORS ================= */
// Browsers may call the API only from the CRM site. Requests without an Origin header (server-to-server
// webhooks, curl, mobile apps) are not affected - CORS is a browser rule, not authentication.
// CORS_EXTRA_ORIGINS (comma separated) adds origins, e.g. http://localhost:3000 for local development.
const allowedOrigins = [
  "https://crm.arsdeen.cloud",
  "https://www.crm.arsdeen.cloud",
  "https://api.crm.arsdeen.cloud", // pages the API serves itself
  ...String(process.env.CORS_EXTRA_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean),
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    console.log("❌ Blocked CORS:", origin);
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin", "X-Portal-Token"],
};
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

/* ================= SESSION ================= */
app.use(
  session({
    name: "crm.sid",
    secret: process.env.SECRET_KEY,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true, // ALWAYS true when using HTTPS
      sameSite: "none", // Required for cross-subdomain
      domain: ".arsdeen.cloud",
    },
  })
);

/* ================= HEALTH CHECK ================= */
app.get("/", (req, res) => {
  res.json({ status: "CRM API running 🚀" });
});

/* ================= ROUTES ================= */
app.use("/api/v1/user", userRouter);
app.use("/api/v1/company", companyRoute);
app.use("/api/v1/job", jobRoute);
app.use("/api/v1/application", applicationRoute);
app.use("/api/v1/attendance", attendanceRoute);
app.use("/api/v1/task", taskRoute);
app.use("/api/v1/leave", leaveRoute);
app.use("/api/v1/leadsource", leadSourceRoute);
app.use("/api/v1/onboarding", goOnBoardingRoute);
app.use("/api/v1/leadclient", leadClientRoute);
app.use("/api/v1/designation", designationRoute);
app.use("/api/v1/proposal", proposalRoute);
app.use("/api/v1/project", projectRoute);
app.use("/api/v1/template", templateRoute);
app.use("/api/v1/audit", auditRoute);
app.use("/api/v1/messages", messagingRoute);
app.use("/api/v1/sequence", sequenceRoute);
app.use("/api/v1/leadform", leadFormRoute);
app.use("/api/v1/target", targetRoute);
app.use("/api/v1/invoice", invoiceRoute);
app.use("/api/v1/retainer", retainerRoute);
app.use("/api/v1/content", contentRoute);
app.use("/api/v1/time", timeRoute);
app.use("/api/v1/portal-access", portalAccessRouter);
app.use("/api/v1/portal", portalRouter);
app.use("/api/v1/public", publicRoute);
app.use("/api/v1/team", teamRoute);
app.use("/api/v1/hr", hrRoute);
app.use("/api/v1/dashboard", dashboardRoute);
/* ================= GLOBAL ERROR HANDLER ================= */
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 8000;

app.listen(PORT, async () => {
  await connectDB();
  ensureSalesTeam().catch((err) => console.error("Sales team setup failed:", err.message));
  backfillLeaveDays().catch((err) => console.error("Leave day backfill failed:", err.message));
  scrubSignupPasswords().catch((err) => console.error("Signup password scrub failed:", err.message));
  startFollowUpDigest();
  startSequenceRunner();
  startBillingRunner();
  startExitRunner();
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});