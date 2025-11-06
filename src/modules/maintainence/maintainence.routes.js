const express = require('express');
const router = express.Router();
const { getAllDrivers, batchUpdateDrivers } = require('./maintainence.controller');

// Assuming you have an adminAuth middleware
// const adminAuth = require('../../middlewares/adminAuth');

// Get all drivers (protected admin route)
router.get('/drivers', getAllDrivers);

// Batch update drivers (protected admin route)
router.patch('/drivers/batch-update', batchUpdateDrivers);

module.exports = router;
