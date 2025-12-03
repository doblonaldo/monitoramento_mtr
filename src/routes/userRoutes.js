const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/users', authenticateToken, authorizeRole(['admin']), userController.listUsers);
router.post('/users/invite', authenticateToken, authorizeRole(['admin']), userController.inviteUser);
router.put('/users/:username', authenticateToken, authorizeRole(['admin']), userController.updateUser);
router.delete('/users/:username', authenticateToken, authorizeRole(['admin']), userController.deleteUser);
router.post('/users/:username/reset-link', authenticateToken, authorizeRole(['admin']), userController.generateResetLink);

module.exports = router;
