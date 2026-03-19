const db = require('../models');
const { Op } = require('sequelize');

/**
 * 商品一覧取得
 */
exports.getProducts = async (req, res) => {
  try {
    const { keyword_id, platform, min_price, max_price, page = 1, limit = 20 } = req.query;
    const userId = req.user.id;

    // ページネーション
    const offset = (page - 1) * limit;

    // クエリ条件
    const where = {};
    if (platform) where.platform = platform;
    if (min_price) where.price = { [Op.gte]: min_price };
    if (max_price) where.price = { ...where.price, [Op.lte]: max_price };

    // 商品取得
    const { count, rows: products } = await db.Product.findAndCountAll({
      where,
      include: [
        {
          model: db.Keyword,
          as: 'keyword',
          where: {
            user_id: userId,
            ...(keyword_id && { id: keyword_id })
          },
          attributes: ['id', 'keyword']
        }
      ],
      order: [['created_at', 'DESC']],
      limit: parseInt(limit),
      offset: offset
    });

    res.json({
      success: true,
      data: products,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(count / limit)
      }
    });

  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      success: false,
      error: '商品一覧の取得に失敗しました'
    });
  }
};

/**
 * 商品詳細取得
 */
exports.getProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const product = await db.Product.findOne({
      where: { id },
      include: [
        {
          model: db.Keyword,
          as: 'keyword',
          where: { user_id: userId },
          attributes: ['id', 'keyword', 'min_price', 'max_price']
        },
        {
          model: db.PriceHistory,
          as: 'priceHistories',
          order: [['checked_at', 'DESC']],
          limit: 10
        }
      ]
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error: '商品が見つかりません'
      });
    }

    res.json({
      success: true,
      data: product
    });

  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      success: false,
      error: '商品の取得に失敗しました'
    });
  }
};

/**
 * 商品削除
 */
exports.deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const product = await db.Product.findOne({
      where: { id },
      include: [
        {
          model: db.Keyword,
          as: 'keyword',
          where: { user_id: userId }
        }
      ]
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        error: '商品が見つかりません'
      });
    }

    await product.destroy();

    res.json({
      success: true,
      message: '商品を削除しました'
    });

  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({
      success: false,
      error: '商品の削除に失敗しました'
    });
  }
};
