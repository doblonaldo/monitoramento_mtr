const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const authLimiter = require('../middleware/rateLimiter');

router.post('/login', authLimiter, authController.login);
router.post('/logout', authenticateToken, authController.logout);
router.post('/auth/setup-password', authController.setupPassword);
router.post('/auth/reset-password', authController.resetPassword);

module.exports = router;
