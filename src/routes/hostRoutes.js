const express = require('express');
const router = express.Router();
const hostController = require('../controllers/hostController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/hosts', hostController.listHosts);
router.get('/hosts/:host', hostController.getHost);
router.get('/hosts/:host/metrics', hostController.getMetrics);
router.post('/hosts', authenticateToken, authorizeRole(['editor', 'admin']), hostController.addHost);
router.delete('/hosts/:host', authenticateToken, authorizeRole(['editor', 'admin']), hostController.deleteHost);

module.exports = router;
