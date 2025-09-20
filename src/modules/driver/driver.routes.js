const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middlewares/auth');
const driverController = require('./driver.controller');
const multer = require('multer');
// Use memory storage so uploaded files are available as `file.buffer`
const storage = multer.memoryStorage();
const upload = multer({ storage });
// Start an assignment (driver pressed start)
router.post('/startAssignment', driverController.startAssignment);

// OneDrive helper routes
// Get authorization URL to obtain code (open this URL in browser and sign-in with your personal account)
router.get('/onedrive/auth-url', driverController.getOnedriveAuthUrl);
// Exchange authorization code for tokens (POST { code: '...' })
router.post('/onedrive/exchange', driverController.exchangeOnedriveCode);
// Test upload using configured env vars (creates a small PDF and uploads)
router.post('/onedrive/test-upload', driverController.testOneDriveUpload);

// Complete an assignment (driver uploaded POD) - accepts files + checklist
// Fields:
// - podImage (file) - one
// - invoiceImage (file) - one
// - assignedTaskId (string/number)
// - truckNo (string/number)
// - driverName (string)
// - checklist (string; JSON array/object)
router.post(
  '/completeAssignment',
  upload.fields([{ name: 'podImage', maxCount: 1 }, { name: 'invoiceImage', maxCount: 1 }]),
  driverController.completeAssignment
);

module.exports = router;
