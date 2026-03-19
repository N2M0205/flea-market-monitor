const puppeteer = require('puppeteer');

/**
 * PayPayフリマ(Yahoo!フリマ) Puppeteerスクレイパー
 * 
 * @description
 * PayPayフリマ(2024年よりYahoo!フリマに名称変更)の商品情報を
 * Puppeteerを使用してスクレイピングするクラス
 * 
 * @author ピコフリ開発チーム
 * @version 1.0.0
 * @date 2026-02-17
 */
class PayPayPuppeteerScraper {
  constructor() {
    this.browser = null;
    this.baseUrl = 'https://paypayfleamarket.yahoo.co.jp';
  }

  /**
   * ブラウザを初期化
   */
  async initBrowser() {
    if (!this.browser) {
      console.log('🌐 Puppeteerブラウザを起動中... (PayPayフリマ)');
      this.browser = await puppeteer.launch({
        headless: true, // 本番はtrue、デバッグ時はfalseで画面表示
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
      });
      console.log('✅ Puppeteerブラウザ起動完了 (PayPayフリマ)');
    }
  }

  /**
   * ページ遷移を待つ(waitForTimeout代替)
   */
  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * PayPayフリマ検索
   * 
   * @param {string} keyword - 検索キーワード
   * @param {object} options - オプション
   * @param {number} options.min_price - 最低価格
   * @param {number} options.max_price - 最高価格
   * @param {string} options.sort - ソート順 (new: 新着順, price_asc: 価格安い順, price_desc: 価格高い順)
   * @param {number} options.limit - 取得件数上限
   * @returns {Promise<Array>} 商品データの配列
   */
  async search(keyword, options = {}) {
    const {
      min_price = null,
      max_price = null,
      sort = 'new', // new, price_asc, price_desc
      limit = 20
    } = options;

    try {
      await this.initBrowser();

      // 検索URLを構築
      // PayPayフリマのURL形式: /search/{keyword}?price_from=&price_to=&sort=
      let searchUrl = `${this.baseUrl}/search/${encodeURIComponent(keyword)}`;
      const params = new URLSearchParams();

      if (min_price) params.append('price_from', min_price);
      if (max_price) params.append('price_to', max_price);
      
      // ソート設定
      // new: 新着順(デフォルト), score: おすすめ順, price_asc: 安い順, price_desc: 高い順
      if (sort && sort !== 'new') {
        params.append('sort', sort);
      }

      const queryString = params.toString();
      if (queryString) {
        searchUrl += `?${queryString}`;
      }

      console.log('🔍 PayPayフリマ検索URL:', searchUrl);

      const page = await this.browser.newPage();

      // ビューポート設定
      await page.setViewport({ width: 1920, height: 1080 });

      // User-Agent設定
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // 自動化検出を回避
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      console.log('📡 ページ読み込み開始... (PayPayフリマ)');

      // ページ移動(タイムアウト90秒)
      await page.goto(searchUrl, {
        waitUntil: 'networkidle2',
        timeout: 90000
      });

      console.log('✅ ページ読み込み完了 (PayPayフリマ)');

      // ページが完全に読み込まれるまで待機
      await this.wait(3000);

      // デバッグ用スクリーンショット
      const screenshotPath = 'debug-paypay-page.png';
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`📸 デバッグスクリーンショット保存: ${screenshotPath}`);

      // 商品リストを取得
      console.log('🔍 商品要素を検索中... (PayPayフリマ)');

      let products = [];

      // セレクタパターン1: data-testid属性ベース
      try {
        // PayPayフリマの商品カードセレクタを待機
        await page.waitForSelector('[class*="ProductCard"], [class*="sc-"], a[href*="/item/"]', { 
          timeout: 10000 
        });

        products = await page.evaluate(() => {
          // 商品カードの要素を取得
          // PayPayフリマの構造: 商品カードはaタグでラップされている
          const items = Array.from(document.querySelectorAll('a[href*="/item/"]'));
          
          return items.map(item => {
            // URLを取得
            const url = item.href;
            
            // 商品IDを抽出 (例: /item/abc123 → abc123)
            let productId = '';
            const urlMatch = url.match(/\/item\/([^/?]+)/);
            if (urlMatch) {
              productId = urlMatch[1];
            }

            // 画像URLを取得
            const img = item.querySelector('img');
            const imageUrl = img?.src || img?.dataset?.src || '';

            // タイトルを取得
            // imgのalt属性、またはテキストコンテンツから取得
            let title = img?.alt || '';
            if (!title) {
              const titleElement = item.querySelector('[class*="title"], [class*="Title"], span, div');
              title = titleElement?.textContent?.trim() || '';
            }

            // 価格を取得
            let price = '0';
            const priceElements = Array.from(item.querySelectorAll('span, div, p'));
            for (const el of priceElements) {
              const text = el.textContent.trim();
              // ¥記号と数字を含むテキストを検索
              if (text.includes('¥') || text.match(/[0-9,]+円/)) {
                price = text.replace(/[^0-9]/g, '');
                if (price) break;
              }
            }

            // SOLD表示のチェック
            const soldElement = item.querySelector('[class*="sold"], [class*="Sold"], [class*="SOLD"]');
            const isSold = soldElement !== null;

            return {
              product_id: productId,
              title: title,
              price: price,
              url: url,
              image_url: imageUrl,
              is_sold: isSold
            };
          }).filter(item => {
            // 有効なデータのみフィルタ
            return item.product_id && 
                   item.title && 
                   item.price !== '0' && 
                   !item.is_sold; // 販売済みを除外
          });
        });

        console.log(`✅ セレクタパターン1で${products.length}件取得 (PayPayフリマ)`);

      } catch (err) {
        console.error('❌ PayPayフリマスクレイピングエラー:', err.message);
        
        // フォールバック: より広範なセレクタで再試行
        try {
          products = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            return links
              .filter(link => link.href.includes('/item/'))
              .slice(0, 20)
              .map((link, index) => {
                const img = link.querySelector('img');
                const url = link.href;
                const productId = url.match(/\/item\/([^/?]+)/)?.[1] || `temp_${Date.now()}_${index}`;
                
                // 価格抽出
                let price = '0';
                const text = link.textContent;
                const priceMatch = text.match(/¥?\s*([0-9,]+)\s*円?/);
                if (priceMatch) {
                  price = priceMatch[1].replace(/,/g, '');
                }

                return {
                  product_id: productId,
                  title: img?.alt || '商品名不明',
                  price: price,
                  url: url,
                  image_url: img?.src || '',
                  is_sold: false
                };
              })
              .filter(item => item.price !== '0');
          });
          console.log(`✅ フォールバックで${products.length}件取得 (PayPayフリマ)`);
        } catch (fallbackErr) {
          console.error('❌ フォールバックも失敗:', fallbackErr.message);
        }
      }

      await page.close();

      // データ整形
      const formattedProducts = products.slice(0, limit).map(item => ({
        product_id: item.product_id,
        platform: 'paypay_flea',
        title: item.title.substring(0, 200), // タイトル長制限
        price: parseFloat(item.price) || 0,
        url: item.url.startsWith('http') ? item.url : `${this.baseUrl}${item.url}`,
        image_url: item.image_url,
        condition: null,
        seller_id: null,
        free_shipping: null,
        listed_at: new Date()
      }));

      console.log(`✅ ${formattedProducts.length}件の商品データを整形しました (PayPayフリマ)`);
      return formattedProducts;

    } catch (error) {
      console.error('❌ PayPayフリマPuppeteerスクレイピングエラー:', error.message);
      console.error('スタックトレース:', error.stack);
      throw error;
    }
  }

  /**
   * 商品詳細を取得
   * 
   * @param {string} productId - 商品ID
   * @returns {Promise<object|null>} 商品詳細データ
   */
  async getProductDetail(productId) {
    try {
      await this.initBrowser();
      const page = await this.browser.newPage();
      const url = `${this.baseUrl}/item/${productId}`;

      console.log('🔍 商品詳細取得:', url);

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await this.wait(2000);

      const detail = await page.evaluate(() => {
        // 商品詳細ページから情報を抽出
        const getTextContent = (selector) => {
          const element = document.querySelector(selector);
          return element?.textContent?.trim() || '';
        };

        return {
          description: getTextContent('[class*="description"], [class*="Description"]'),
          condition: getTextContent('[class*="condition"], [class*="Condition"]'),
          seller_name: getTextContent('[class*="seller"], [class*="Seller"]'),
          category: getTextContent('[class*="category"], [class*="Category"]'),
          brand: getTextContent('[class*="brand"], [class*="Brand"]')
        };
      });

      await page.close();
      console.log('✅ 商品詳細取得完了 (PayPayフリマ)');
      return detail;

    } catch (error) {
      console.error('❌ PayPayフリマ商品詳細取得エラー:', error.message);
      return null;
    }
  }

  /**
   * ブラウザを閉じる
   */
  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.log('🔒 Puppeteerブラウザを閉じました (PayPayフリマ)');
    }
  }
}

module.exports = PayPayPuppeteerScraper;

// ESM互換性のため
if (typeof module !== 'undefined' && module.exports) {
  module.exports.default = PayPayPuppeteerScraper;
}
