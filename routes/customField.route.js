import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly } from "../utils/access.js";
import * as c from "../controllers/customField.controller.js";

// Custom fields on clients and leads: admins define them, people who can edit the record fill them in
const router = express.Router();
router.use(isAuthenticated, loadCurrentUser);
router.get("/", c.listCustomFields);
router.post("/", adminOnly, c.createCustomField);
router.put("/values/:entity/:id", c.setCustomValues);
router.put("/:id", adminOnly, c.updateCustomField);
router.delete("/:id", adminOnly, c.deleteCustomField);

export default router;
