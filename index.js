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
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());

/* ================= CORS ================= */
const allowedOrigins = [
  "https://crm.arsdeen.cloud",
  "https://www.crm.arsdeen.cloud",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.options("*", cors());

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

/* ================= GLOBAL ERROR HANDLER ================= */
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

/* ================= START SERVER ================= */
const PORT = process.env.PORT || 8001;

app.listen(PORT, async () => {
  await connectDB();
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});