const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

router.get('/categories', categoryController.listCategories);
router.post('/categories', authenticateToken, authorizeRole(['editor', 'admin']), categoryController.addCategory);
router.delete('/categories/:category', authenticateToken, authorizeRole(['editor', 'admin']), categoryController.deleteCategory);

module.exports = router;
