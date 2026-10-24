import express from "express";
import isAuthenticated from "../middlewares/isAuthentications.js";
import { loadCurrentUser, adminOnly } from "../utils/access.js";
import { singleUpload } from "../middlewares/multer.js";
import * as c from "../controllers/hr.controller.js";
import * as x from "../controllers/exit.controller.js";

const router = express.Router();
router.use(isAuthenticated, loadCurrentUser);

// Settings and holidays (everyone reads; admins change)
router.get("/settings", c.getSettings);
router.put("/settings", adminOnly, c.updateSettings);
router.get("/holidays", c.getHolidays);
router.post("/holidays", adminOnly, c.saveHoliday);
router.put("/holidays/:id", adminOnly, c.saveHoliday);
router.delete("/holidays/:id", adminOnly, c.deleteHoliday);

// Leave balances (admin all, Team Lead team, else self) and quota adjustments (admin)
router.get("/leave-balances", c.getLeaveBalances);
router.get("/leave-adjustments", adminOnly, c.getLeaveAdjustments);
router.post("/leave-adjustments", adminOnly, c.addLeaveAdjustment);

// Attendance report and corrections
router.get("/attendance-report", c.getAttendanceReport);
router.get("/corrections", c.getCorrections);
router.post("/corrections", c.requestCorrection);
router.post("/corrections/:id/decide", c.decideCorrection);

// People
router.get("/employees", c.getDirectory);
router.post("/employees/from-onboarding/:onboardingId", adminOnly, c.profileFromOnboarding);
router.get("/employees/:userId", c.getEmployee);
router.put("/employees/:userId", c.updateEmployee);
router.post("/employees/:userId/documents", singleUpload, c.uploadDocument);
router.get("/employees/:userId/documents/:docId", c.downloadDocument);
router.delete("/employees/:userId/documents/:docId", adminOnly, c.deleteDocument);

// Payroll (admin) and my payslips
router.get("/payroll/my", c.myPayslips);
router.get("/payroll/payslips/:id/pdf", c.payslipPdf);
router.get("/salary", adminOnly, c.getSalaryStructures);
router.put("/salary/:userId", adminOnly, c.saveSalaryStructure);
router.delete("/salary/:id", adminOnly, c.deleteSalaryStructure);
router.get("/payroll/runs", adminOnly, c.getPayrollRuns);
router.post("/payroll/runs", adminOnly, c.generatePayroll);
router.get("/payroll/runs/:id", adminOnly, c.getPayrollRun);
router.post("/payroll/runs/:id/finalize", adminOnly, c.setPayrollStatus);
router.post("/payroll/runs/:id/reopen", adminOnly, c.setPayrollStatus);
router.post("/payroll/runs/:id/email", adminOnly, c.emailPayslips);
router.delete("/payroll/runs/:id", adminOnly, c.deletePayrollRun);
router.put("/payroll/payslips/:id", adminOnly, c.updatePayslip);

// Exits (admin)
router.get("/exits", adminOnly, x.listExits);
router.get("/exits/:userId", adminOnly, x.getExit);
router.post("/exits/:userId/start", adminOnly, x.startExitRoute);
router.put("/exits/:userId", adminOnly, x.updateExit);
router.post("/exits/:userId/handover", adminOnly, x.handoverRoute);
router.post("/exits/:userId/deactivate", adminOnly, x.deactivateRoute);
router.post("/exits/:userId/reactivate", adminOnly, x.reactivateRoute);
router.post("/exits/:userId/settlement", adminOnly, x.draftSettlementRoute);
router.put("/exits/:userId/settlement", adminOnly, x.updateSettlement);
router.get("/exits/:userId/settlement/pdf", adminOnly, x.settlementPdf);
router.get("/exits/:userId/letters/:type", adminOnly, x.letterPdf);
router.post("/exits/:userId/letters/:type", adminOnly, x.letterPdf);

export default router;
