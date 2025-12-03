const express = require('express');
const router = express.Router();
const logController = require('../controllers/logController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/logs', authenticateToken, authorizeRole(['admin']), logController.listLogs);

module.exports = router;
