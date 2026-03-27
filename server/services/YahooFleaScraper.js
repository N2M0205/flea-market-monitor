/**
 * Yahoo!フリマ(旧PayPayフリマ) Puppeteer スクレイパー
 *
 * @file YahooFleaScraper.js
 * @description Yahoo!フリマから商品データを取得するスクレイパー
 * @version 2.1.0
 * @date 2026-03-10
 *
 * 変更点 v2.1.0:
 *   - 販売中商品のみ取得するフィルタを追加（SOLD OUT・売り切れを除外）
 *
 * URL構造:
 *   検索: https://paypayfleamarket.yahoo.co.jp/search/{keyword}?page={n}
 *   商品詳細: https://paypayfleamarket.yahoo.co.jp/item/{item_id}
 */

'use strict';

const puppeteer = require('puppeteer');

class YahooFleaScraper {
  constructor() {
    this.browser = null;
    this.page    = null;
    this.baseUrl = 'https://paypayfleamarket.yahoo.co.jp';

    // ERR_ABORTED 連続エラー自動停止
    this.consecutiveAbortCount = 0;
    this.MAX_CONSECUTIVE_ABORTS = 3;
    this.abortedSuspended = false;
  }

  // ─────────────────────────────────────────────
  // ブラウザ初期化
  // ─────────────────────────────────────────────
  async initBrowser() {
    // 前回のブラウザが死んでいたら参照をクリアして再起動
    if (this.browser) {
      try {
        if (!this.browser.isConnected()) {
          console.log('⚠️ Yahoo!フリマ: 前回のブラウザが切断済み。再起動します');
          this.browser = null;
          this.page = null;
        }
      } catch (_) {
        this.browser = null;
        this.page = null;
      }
    }
    if (this.browser) return;

    console.log('🌐 Yahoo!フリマ Puppeteerブラウザを起動中...');

    this.browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--single-process',
        '--window-size=1920,1080',
      ],
    });

    this.page = await this.browser.newPage();

    await this.page.setViewport({ width: 1920, height: 1080 });
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    console.log('✅ Yahoo!フリマ Puppeteerブラウザ起動完了');
  }

  // ─────────────────────────────────────────────
  // 待機
  // ─────────────────────────────────────────────
  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─────────────────────────────────────────────
  // 商品検索
  // ─────────────────────────────────────────────
  async search(keyword, options = {}) {
    const { min_price, max_price, limit = 20 } = options;

    // 連続ERR_ABORTEDで自動停止中ならスキップ
    if (this.abortedSuspended) {
      console.log(`⏭️ Yahoo!フリマ: 自動停止中のためスキップ [${keyword}]`);
      return [];
    }

    try {
      await this.initBrowser();

      // ── URL構築 ────────────────────────────────
      const encodedKeyword = encodeURIComponent(keyword);
      const searchUrl = `${this.baseUrl}/search/${encodedKeyword}?page=1`;
      console.log(`🔍 Yahoo!フリマ検索URL: ${searchUrl}`);

      // ── ページ読み込み ──────────────────────────
      await this.page.goto(searchUrl, {
        waitUntil: 'networkidle2',
        timeout: 90000,
      });
      await this.wait(3000);

      // ── デバッグスクリーンショット ──────────────
      await this.page.screenshot({ path: 'debug-yahooflea-page.png' })
        .catch(() => {});

      // ── 商品データ抽出 ──────────────────────────
      let products = [];

      // ════════════════════════════════════════════
      // パターン1: a[href*="/item/"] ベース
      // ════════════════════════════════════════════
      try {
        await this.page.waitForSelector('a[href*="/item/"]', { timeout: 10000 });

        products = await this.page.evaluate((minPrice, maxPrice) => {
          const items = [];
          const links = Array.from(document.querySelectorAll('a[href*="/item/"]'));

          console.log(`[Browser] 商品リンク数: ${links.length}`);

          for (const link of links) {
            try {
              // カード要素
              const card = link.closest('article') ||
                           link.closest('li')      ||
                           link.closest('div[class*="item"]') ||
                           link;

              // ── 販売中チェック（★ 追加）─────────────
              const soldEl  = card.querySelector('[class*="sold" i], [class*="SOLD"]');
              const cardText = card.textContent || '';
              const isSold  = soldEl !== null ||
                              cardText.includes('売り切れ') ||
                              cardText.toLowerCase().includes('sold out');
              if (isSold) continue;
              // ─────────────────────────────────────────

              // 商品ID
              const idMatch = link.href.match(/\/item\/([^/?#]+)/);
              const productId = idMatch ? idMatch[1] : '';
              if (!productId) continue;

              // 画像・タイトル
              const img     = card.querySelector('img') || link.querySelector('img');
              const imageUrl = img?.src || '';
              let title = (img?.alt || link.textContent || '').trim();
              if (!title || title.length < 3) continue;

              // 価格（3段階フォールバック）
              let price = '0';

              // 方法1: 円を含む要素
              for (const el of Array.from(card.querySelectorAll('*'))) {
                const text = el.textContent || '';
                const m    = text.match(/([¥￥]?\s*[\d,]+)\s*円/);
                if (m) {
                  price = m[1].replace(/[¥￥,\s]/g, '');
                  if (price && price !== '0') break;
                }
              }

              // 方法2: リンクテキスト全体
              if (price === '0') {
                const m = (link.textContent || '').match(/([¥￥]?\s*[\d,]+)\s*円/);
                if (m) price = m[1].replace(/[¥￥,\s]/g, '');
              }

              // 方法3: 数字のみ抽出
              if (price === '0') {
                const nums = (card.textContent || '').match(/\d{2,}/g);
                if (nums) {
                  const large = nums.filter(n => parseInt(n) >= 100);
                  if (large.length) price = large[0];
                }
              }

              const priceNum = parseInt(price, 10);
              if (minPrice && priceNum < minPrice) continue;
              if (maxPrice && priceNum > maxPrice) continue;

              const url = link.href || '';
              if (productId && title && price !== '0' && url) {
                items.push({ product_id: productId, title, price, url, image_url: imageUrl });
              }
            } catch (e) {
              console.error('[Browser] 商品処理エラー:', e.message);
            }
          }

          console.log(`[Browser] パターン1 抽出: ${items.length}件`);
          return items;
        }, min_price, max_price);

        console.log(`✅ パターン1: ${products.length}件取得`);

      } catch (err) {
        console.warn(`⚠️ パターン1失敗: ${err.message}`);
      }

      // ════════════════════════════════════════════
      // パターン2: imgベース フォールバック
      // ════════════════════════════════════════════
      if (products.length === 0) {
        console.log('🔄 パターン2を試行中...');

        try {
          products = await this.page.evaluate((minPrice, maxPrice) => {
            const items  = [];
            const images = Array.from(document.querySelectorAll('img[alt]'));

            for (const img of images) {
              try {
                // 親をたどってリンクを探す
                let link = null;
                let cur  = img.parentElement;
                for (let i = 0; i < 5 && cur; i++) {
                  if (cur.tagName === 'A' && cur.href?.includes('/item/')) {
                    link = cur; break;
                  }
                  const lc = cur.querySelector('a[href*="/item/"]');
                  if (lc) { link = lc; break; }
                  cur = cur.parentElement;
                }
                if (!link) continue;

                const idMatch   = link.href.match(/\/item\/([^/?#]+)/);
                const productId = idMatch ? idMatch[1] : '';
                if (!productId) continue;

                const title = (img.alt || '').trim();
                if (!title || title.length < 3) continue;

                const card    = link.closest('article') || link.closest('li') || link;
                const cardText = card.textContent || '';

                // ── 販売中チェック（★ 追加）──────────
                const soldEl  = card.querySelector('[class*="sold" i]');
                const isSold  = soldEl !== null ||
                                cardText.includes('売り切れ') ||
                                cardText.toLowerCase().includes('sold out');
                if (isSold) continue;
                // ─────────────────────────────────────

                let price = '0';
                const m   = cardText.match(/([¥￥]?\s*[\d,]+)\s*円/);
                if (m) price = m[1].replace(/[¥￥,\s]/g, '');

                const priceNum = parseInt(price, 10);
                if (minPrice && priceNum < minPrice) continue;
                if (maxPrice && priceNum > maxPrice) continue;

                if (productId && title && price !== '0') {
                  items.push({
                    product_id: productId,
                    title,
                    price,
                    url: link.href,
                    image_url: img.src || '',
                  });
                }
              } catch (e) {
                console.error('[Browser] パターン2 商品処理エラー:', e.message);
              }
            }

            console.log(`[Browser] パターン2 抽出: ${items.length}件`);
            return items;
          }, min_price, max_price);

          console.log(`✅ パターン2: ${products.length}件取得`);

        } catch (err) {
          console.warn(`⚠️ パターン2失敗: ${err.message}`);
        }
      }

      // ── データ整形 ───────────────────────────────
      const formatted = products.slice(0, limit).map(p => ({
        product_id:   String(p.product_id).trim(),
        platform:     'yahoo_flea',
        title:        String(p.title).trim(),
        price:        parseInt(p.price, 10) || 0,
        url:          String(p.url).trim(),
        image_url:    String(p.image_url || '').trim() || null,
        condition:    null,
        seller_id:    null,
        free_shipping: null,
        listed_at:    new Date(),
      }));

      console.log(`✅ Yahoo!フリマ: ${formatted.length}件整形完了`);
      // 成功したら連続エラーカウンタをリセット
      this.consecutiveAbortCount = 0;
      return formatted;

    } catch (error) {
      console.error('❌ Yahoo!フリマスクレイピングエラー:', error.message);

      // ERR_ABORTED 連続検知 → 自動停止
      if (error.message.includes('ERR_ABORTED')) {
        this.consecutiveAbortCount++;
        console.warn(`⚠️ Yahoo!フリマ ERR_ABORTED 連続 ${this.consecutiveAbortCount}/${this.MAX_CONSECUTIVE_ABORTS} 回`);
        if (this.consecutiveAbortCount >= this.MAX_CONSECUTIVE_ABORTS) {
          this.abortedSuspended = true;
          console.error(`🚫 Yahoo!フリマ: ERR_ABORTED ${this.MAX_CONSECUTIVE_ABORTS}回連続のため、今回スキャンの残りキーワードをスキップします`);
          await this.close();
        }
      }

      // detached Frame / Connection closed → ブラウザを破棄して次回再起動
      if (error.message.includes('detached') || error.message.includes('Connection closed') || error.message.includes('Protocol error')) {
        console.log('🔄 Yahoo!フリマ: クラッシュ検知。ブラウザを破棄します');
        await this.close();
      }
      return [];
    }
  }

  // ─────────────────────────────────────────────
  // 商品詳細
  // ─────────────────────────────────────────────
  async getProductDetail(productId) {
    try {
      await this.initBrowser();
      const url = `${this.baseUrl}/item/${productId}`;
      console.log(`🔍 商品詳細取得: ${url}`);

      await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

      const detail = await this.page.evaluate(() => ({
        description: document.querySelector('[class*="description"]')?.textContent?.trim() || '',
        condition:   document.querySelector('[class*="condition"]')?.textContent?.trim()   || '',
        seller_name: document.querySelector('[class*="seller"]')?.textContent?.trim()      || '',
      }));

      return detail;
    } catch (error) {
      console.error('❌ 商品詳細取得エラー:', error.message);
      return {};
    }
  }

  // ─────────────────────────────────────────────
  // ブラウザを閉じる
  // ─────────────────────────────────────────────
  resetAbortState() {
    this.consecutiveAbortCount = 0;
    this.abortedSuspended = false;
  }

  async close() {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.page    = null;
      console.log('✅ Yahoo!フリマ Puppeteerブラウザを閉じました');
    }
  }
}

module.exports = YahooFleaScraper;
if (typeof module !== 'undefined' && module.exports) {
  module.exports.default = YahooFleaScraper;
}