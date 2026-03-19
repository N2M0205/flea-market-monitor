const axios = require('axios');

class MercariScraper {
  constructor() {
    // メルカリの非公式API（内部API）
    this.apiBaseUrl = 'https://api.mercari.jp/v2/entities:search';
    this.webBaseUrl = 'https://jp.mercari.com';
    
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'ja',
      'Origin': 'https://jp.mercari.com',
      'Referer': 'https://jp.mercari.com/',
      'X-Platform': 'web',
      'Cache-Control': 'no-cache'
    };
    
    this.useMockData = process.env.USE_MOCK_DATA === 'true';
  }

  /**
   * メルカリAPIで商品検索
   * @param {string} keyword - 検索キーワード
   * @param {object} options - 検索オプション
   * @returns {Promise<Array>} 商品リスト
   */
  async search(keyword, options = {}) {
    // モックデータモード
    if (this.useMockData) {
      return this.getMockData(keyword, options);
    }

    try {
      const {
        min_price = 0,
        max_price = 999999,
        sort = 'created_time',
        limit = 20
      } = options;

      console.log(`🔍 メルカリAPI検索開始: "${keyword}"`);

      // APIリクエストパラメータ
      const requestBody = {
        searchSessionId: this.generateSearchSessionId(),
        indexRouting: 'BY_DISTANCE',
        searchCondition: {
          keyword: keyword,
          excludeKeyword: '',
          sort: this.convertSortOption(sort),
          order: 'desc',
          priceMin: min_price,
          priceMax: max_price,
          status: [
            'on_sale'  // 販売中のみ
          ]
        },
        serviceFrom: 'suruga',
        pageSize: Math.min(limit, 120),  // 最大120件
        pageToken: '',
        defaultDatasets: [
          'DATASET_TYPE_MERCARI',
          'DATASET_TYPE_BEYOND'
        ],
        requestId: this.generateRequestId(),
        includeTopics: true
      };

      console.log(`📡 APIリクエスト送信...`);

      // APIリクエスト
      const response = await axios.post(this.apiBaseUrl, requestBody, {
        headers: this.headers,
        timeout: 15000
      });

      console.log(`✅ APIレスポンス受信: ${response.status}`);

      // レスポンスデータの解析
      const items = response.data?.items || [];
      const products = [];

      for (const item of items) {
        if (products.length >= limit) break;

        try {
          // メルカリの商品データ構造
          const itemData = item.item || item;
          
          if (!itemData.id) continue;

          const product = {
            product_id: itemData.id,
            platform: 'mercari',
            title: itemData.name || '',
            price: parseFloat(itemData.price || 0),
            url: `${this.webBaseUrl}/item/${itemData.id}`,
            image_url: this.getThumbnailUrl(itemData.thumbnails),
            condition: this.getConditionText(itemData.itemConditionId),
            seller_id: itemData.sellerId || null,
            free_shipping: this.checkFreeShipping(itemData.shippingPayer),
            listed_at: itemData.created ? new Date(itemData.created * 1000) : new Date()
          };

          // 価格範囲チェック
          if (product.price >= min_price && product.price <= max_price) {
            products.push(product);
          }
        } catch (err) {
          console.error('商品解析エラー:', err.message);
        }
      }

      console.log(`✅ ${products.length}件の商品を取得しました`);
      return products;

    } catch (error) {
      console.error('❌ メルカリAPI検索エラー:', error.message);
      
      if (error.response) {
        console.error(`   HTTPステータス: ${error.response.status}`);
        console.error(`   レスポンス:`, error.response.data);
      }
      
      // エラー時はモックデータで代替（開発用）
      if (process.env.NODE_ENV === 'development') {
        console.log('⚠️ エラーのため、モックデータを返します');
        return this.getMockData(keyword, options);
      }
      
      return [];
    }
  }

  /**
   * ソートオプションを変換
   */
  convertSortOption(sort) {
    const sortMap = {
      'created_time': 'SORT_CREATED_TIME',
      'price_asc': 'SORT_SCORE',
      'price_desc': 'SORT_SCORE',
      'num_likes': 'SORT_NUM_LIKES'
    };
    return sortMap[sort] || 'SORT_CREATED_TIME';
  }

  /**
   * サムネイル画像URLを取得
   */
  getThumbnailUrl(thumbnails) {
    if (!thumbnails || thumbnails.length === 0) return null;
    return thumbnails[0] || null;
  }

  /**
   * 商品状態テキストを取得
   */
  getConditionText(conditionId) {
    const conditions = {
      1: '新品、未使用',
      2: '未使用に近い',
      3: '目立った傷や汚れなし',
      4: 'やや傷や汚れあり',
      5: '傷や汚れあり',
      6: '全体的に状態が悪い'
    };
    return conditions[conditionId] || '不明';
  }

  /**
   * 送料無料チェック
   */
  checkFreeShipping(shippingPayer) {
    // 2 = 出品者負担（送料込み）
    return shippingPayer === 2;
  }

  /**
   * 検索セッションID生成
   */
  generateSearchSessionId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * リクエストID生成
   */
  generateRequestId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 16)}`;
  }

  /**
   * モックデータを生成（テスト用）
   */
  getMockData(keyword, options = {}) {
    console.log(`🎭 モックデータモード: "${keyword}"`);
    
    const { min_price = 10000, max_price = 30000, limit = 20 } = options;
    const mockProducts = [];
    const count = Math.min(limit, 5);

    for (let i = 1; i <= count; i++) {
      const price = Math.floor(Math.random() * (max_price - min_price) + min_price);
      const productId = `m${Math.floor(Math.random() * 1000000000)}`;
      
      mockProducts.push({
        product_id: productId,
        platform: 'mercari',
        title: `${keyword} 【美品】 商品${i}`,
        price: price,
        url: `https://jp.mercari.com/item/${productId}`,
        image_url: `https://placehold.co/300x300/png?text=${encodeURIComponent(keyword)}`,
        condition: '目立った傷や汚れなし',
        seller_id: `user${Math.floor(Math.random() * 100000)}`,
        free_shipping: Math.random() > 0.5,
        listed_at: new Date(Date.now() - Math.random() * 3600000)
      });
    }

    console.log(`✅ ${mockProducts.length}件のモックデータを生成しました`);
    return mockProducts;
  }

  /**
   * 商品詳細を取得
   */
  async getProductDetail(productId) {
    if (this.useMockData) {
      return {
        condition: '目立った傷や汚れなし',
        free_shipping: true
      };
    }

    try {
      const url = `${this.webBaseUrl}/item/${productId}`;
      const response = await axios.get(url, {
        headers: this.headers,
        timeout: 10000
      });

      // 詳細情報の解析（必要に応じて実装）
      return {
        condition: '取得済み',
        free_shipping: true
      };
    } catch (error) {
      console.error('商品詳細取得エラー:', error.message);
      return null;
    }
  }

  /**
   * 待機
   */
  async wait(ms = 2000) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = MercariScraper;
