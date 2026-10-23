import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly } from "../utils/access.js";
import * as c from "../controllers/time.controller.js";

const router = express.Router();
router.use(isAuthenticated, loadCurrentUser);
router.get("/options", c.getOptions);
router.get("/rates", adminOnly, c.getRates);
router.put("/rates/:userId", adminOnly, c.setRate);
router.get("/profitability", adminOnly, c.getProfitability);
router.get("/", c.getEntries);
router.post("/", c.createEntry);
router.put("/:id", c.updateEntry);
router.delete("/:id", c.deleteEntry);
export default router;
