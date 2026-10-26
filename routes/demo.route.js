import express from "express";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly } from "../utils/access.js";

/* Only mounted when DEMO_MODE=true: lets the demo admin refill the sample data before a demo. */
const router = express.Router();
// DEMO_SEED picks the sample data set: "agency" (default) or "logistics"
const seed = path.join(path.dirname(fileURLToPath(import.meta.url)), `../scripts/${process.env.DEMO_SEED === "logistics" ? "demo-seed-logistics" : "demo-seed"}.mjs`);
let running = false;

router.post("/reset", isAuthenticated, loadCurrentUser, adminOnly, (req, res) => {
  if (running) return res.status(409).json({ success: false, message: "A reset is already running" });
  running = true;
  execFile(process.execPath, [seed], { cwd: path.dirname(seed) + "/..", env: process.env, timeout: 120000 }, (err, stdout, stderr) => {
    running = false;
    if (err) {
      console.error("Demo reset failed:", stderr || err.message);
      return res.status(500).json({ success: false, message: "Reset failed - check the server log" });
    }
    res.json({ success: true, message: "Sample data reset", output: stdout.trim().split("\n").slice(-2) });
  });
});

export default router;
