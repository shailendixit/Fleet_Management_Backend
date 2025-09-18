const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middlewares/auth');
const driverController = require('./driver.controller');

// Start an assignment (driver pressed start)
router.post('/startAssignment', driverController.startAssignment);

// Complete an assignment (driver uploaded POD)
router.post('/completeAssignment', driverController.completeAssignment);

module.exports = router;
