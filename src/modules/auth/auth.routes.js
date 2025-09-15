const express = require('express');
const router = express.Router();
const authcontroller= require('./auth.controller');


router.post('/signup',authcontroller.signup);
router.post('/login',authcontroller.login);
router.post('/verifytoken',authcontroller.verifyToken);
router.post('/logout', authcontroller.logout);

module.exports = router;