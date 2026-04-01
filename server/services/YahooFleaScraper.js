/**
 * Yahoo!フリマ(旧PayPayフリマ) Puppeteer スクレイパー
 *
 * @file YahooFleaScraper.js
 * @description Yahoo!フリマから商品データを取得するスクレイパー
 * @version 3.0.0
 * @date 2026-03-27
 *
 * 変更点 v3.0.0:
 *   - search()ごとにbrowser/pageを独立生成・破棄（並列安全）
 *   - puppeteer-extra + StealthPlugin でbot検知回避
 *   - setRequestInterception()で不要リソースをブロック
 *
 * URL構造:
 *   検索: https://paypayfleamarket.yahoo.co.jp/search/{keyword}?page={n}
 *   商品詳細: https://paypayfleamarket.yahoo.co.jp/item/{item_id}
 */

'use strict';

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin  = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());
const browserPool = require('./BrowserPool.cjs');

class YahooFleaScraper {
  constructor() {
    this.baseUrl = 'https://paypayfleamarket.yahoo.co.jp';

    // ERR_ABORTED 連続エラー自動停止
    this.consecutiveAbortCount = 0;
    this.MAX_CONSECUTIVE_ABORTS = 3;
    this.abortedSuspended = false;

    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
    ];
  }

  _getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─────────────────────────────────────────────
  // ブラウザ起動（search()ごとに独立インスタンス）
  // ─────────────────────────────────────────────
  async _launchBrowser() {
    const browser = await puppeteerExtra.launch({
      headless: 'new',
      protocolTimeout: 90000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--window-size=1366,768',
        '--lang=ja-JP,ja',
      ],
      defaultViewport: { width: 1366, height: 768 },
    });
    return browser;
  }

  _forceCloseBrowser(browser) {
    try {
      const pid = browser.process()?.pid;
      if (pid) {
        process.kill(pid, 'SIGKILL');
        console.log(`Force killed browser process PID: ${pid}`);
      }
    } catch (killErr) {
      console.error('Force kill also failed:', killErr.message);
    }
  }

  // ─────────────────────────────────────────────
  // ページ設定（Stealth + リクエストフィルタ）
  // ─────────────────────────────────────────────
  async _setupPage(page) {
    await page.setUserAgent(this._getRandomUserAgent());
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    });

    // 不要リソースをブロック（高速化 + 帯域節約）
    await page.setRequestInterception(true);
    page.on('request', req => {
      const rt = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(rt)) {
        req.abort();
      } else {
        req.continue();
      }
    });
  }

  // ─────────────────────────────────────────────
  // 商品検索
  // ─────────────────────────────────────────────
  async search(keyword, options = {}) {
    // 連続ERR_ABORTEDで自動停止中ならスキップ
    if (this.abortedSuspended) {
      console.log(`⏭️ Yahoo!フリマ: 自動停止中のためスキップ [${keyword}]`);
      return [];
    }

    const SEARCH_TIMEOUT_MS = 60000;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Search timeout: ${keyword} exceeded ${SEARCH_TIMEOUT_MS}ms`)), SEARCH_TIMEOUT_MS)
    );
    return Promise.race([this._searchInternal(keyword, options), timeoutPromise]);
  }

  async _searchInternal(keyword, options = {}) {
    const { min_price, max_price, limit = 20 } = options;

    let browser = null;
    let poolAcquired = false;
    try {
      await browserPool.acquire();
      poolAcquired = true;
      browser = await this._launchBrowser();
      const page = await browser.newPage();
      await this._setupPage(page);

      // ── URL構築 ────────────────────────────────
      const encodedKeyword = encodeURIComponent(keyword);
      const searchUrl = `${this.baseUrl}/search/${encodedKeyword}?page=1`;
      console.log(`🔍 Yahoo!フリマ検索URL: ${searchUrl}`);

      // ── ページ読み込み ──────────────────────────
      await page.goto(searchUrl, {
        waitUntil: 'networkidle2',
        timeout: 90000,
      });
      await this._sleep(3000);

      // ── デバッグスクリーンショット ──────────────
      await page.screenshot({ path: 'debug-yahooflea-page.png' })
        .catch(() => {});

      // ── 商品データ抽出 ──────────────────────────
      let products = [];

      // ════════════════════════════════════════════
      // パターン1: a[href*="/item/"] ベース
      // ════════════════════════════════════════════
      try {
        await page.waitForSelector('a[href*="/item/"]', { timeout: 10000 });

        products = await page.evaluate((minPrice, maxPrice) => {
          const items = [];
          const links = Array.from(document.querySelectorAll('a[href*="/item/"]'));

          for (const link of links) {
            try {
              const card = link.closest('article') ||
                           link.closest('li')      ||
                           link.closest('div[class*="item"]') ||
                           link;

              // 販売中チェック
              const soldEl  = card.querySelector('[class*="sold" i], [class*="SOLD"]');
              const cardText = card.textContent || '';
              const isSold  = soldEl !== null ||
                              cardText.includes('売り切れ') ||
                              cardText.toLowerCase().includes('sold out');
              if (isSold) continue;

              const idMatch = link.href.match(/\/item\/([^/?#]+)/);
              const productId = idMatch ? idMatch[1] : '';
              if (!productId) continue;

              const img     = card.querySelector('img') || link.querySelector('img');
              const imageUrl = img?.src || '';
              let title = (img?.alt || link.textContent || '').trim();
              if (!title || title.length < 3) continue;

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
              // skip individual item errors
            }
          }

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
          products = await page.evaluate((minPrice, maxPrice) => {
            const items  = [];
            const images = Array.from(document.querySelectorAll('img[alt]'));

            for (const img of images) {
              try {
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

                // 販売中チェック
                const soldEl  = card.querySelector('[class*="sold" i]');
                const isSold  = soldEl !== null ||
                                cardText.includes('売り切れ') ||
                                cardText.toLowerCase().includes('sold out');
                if (isSold) continue;

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
                // skip individual item errors
              }
            }

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
        }
      }

      return [];
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (closeErr) {
          console.error('browser.close() failed, force killing:', closeErr.message);
          this._forceCloseBrowser(browser);
        }
      }
      if (poolAcquired) browserPool.release();
    }
  }

  // ─────────────────────────────────────────────
  // 商品詳細
  // ─────────────────────────────────────────────
  async getProductDetail(productId) {
    let browser = null;
    let poolAcquired = false;
    try {
      await browserPool.acquire();
      poolAcquired = true;
      browser = await this._launchBrowser();
      const page = await browser.newPage();
      await this._setupPage(page);

      const url = `${this.baseUrl}/item/${productId}`;
      console.log(`🔍 商品詳細取得: ${url}`);

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

      const detail = await page.evaluate(() => ({
        description: document.querySelector('[class*="description"]')?.textContent?.trim() || '',
        condition:   document.querySelector('[class*="condition"]')?.textContent?.trim()   || '',
        seller_name: document.querySelector('[class*="seller"]')?.textContent?.trim()      || '',
      }));

      return detail;
    } catch (error) {
      console.error('❌ 商品詳細取得エラー:', error.message);
      return {};
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (closeErr) {
          console.error('browser.close() failed, force killing:', closeErr.message);
          this._forceCloseBrowser(browser);
        }
      }
      if (poolAcquired) browserPool.release();
    }
  }

  // ─────────────────────────────────────────────
  // 状態管理
  // ─────────────────────────────────────────────
  resetAbortState() {
    this.consecutiveAbortCount = 0;
    this.abortedSuspended = false;
  }

  // close() は後方互換のため残置（ScrapingServiceのfinally節から呼ばれる）
  async close() {
    // browser/pageはsearch()ごとにfinallyで閉じるため、ここでは何もしない
  }
}

module.exports = YahooFleaScraper;
if (typeof module !== 'undefined' && module.exports) {
  module.exports.default = YahooFleaScraper;
}
