const express = require('express');
const router = express.Router();
const multer = require('multer');
const {authenticateToken,authorizeRoles} = require('../../middlewares/auth');
const taskController = require('./task.controller');

const upload = multer({ dest: 'uploads/' });
router.post('/upload-excel', upload.single('file'), (req, res, next) => {
  next();
}, taskController.uploadExcel);
// Invoice upload route
router.post('/upload-invoice-excel', upload.single('file'), (req, res, next) => {
  next();
}, taskController.uploadInvoiceExcel);
// router.post('/upload-excel', upload.single('file'), taskController.uploadExcel);

router.get("/getUnassignedTasks", taskController.getUnassignedTasks);
router.get("/getAvailableDrivers", taskController.getAvailableDrivers);

// Get tasks in progress (not completed)
router.get("/getTasksInProgress", authenticateToken, taskController.getTasksInProgress);

// Get completed tasks (last 2 days)
router.get("/getCompletedTasks", authenticateToken, taskController.getCompletedTasks);

// Get tasks assigned to the logged-in driver
router.get('/myTasks', authenticateToken, taskController.getMyAssignedTasks);

// Assign tasks: create entries in AssignedTask_DB
router.post('/assignTasks', authenticateToken,  taskController.assignTasks);

// Update manifestNo and/or invoiceId for assigned tasks (can update multiple by orderNumber or assignedTaskId)
router.post('/assignedTasks/updateInvoiceManifest', authenticateToken, taskController.updateInvoiceManifest);

module.exports = router;
