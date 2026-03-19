const express = require('express');
const router = express.Router();
const ProductController = require('../controllers/ProductController');
const { authenticateToken } = require('../middleware/auth');

// すべてのルートに認証を適用
router.use(authenticateToken);

/**
 * @route   GET /api/products
 * @desc    商品一覧取得
 * @access  Private
 */
router.get('/', ProductController.getProducts);

/**
 * @route   GET /api/products/:id
 * @desc    商品詳細取得
 * @access  Private
 */
router.get('/:id', ProductController.getProductById);

/**
 * @route   DELETE /api/products/:id
 * @desc    商品削除
 * @access  Private
 */
router.delete('/:id', ProductController.deleteProduct);

module.exports = router;
