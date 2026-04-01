'use strict';

// ── puppeteer-extra + Stealth Plugin に変更 ──────────────────────
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin  = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());
// ──────────────────────────────────────────────────────────────────

const path = require('path');
const { execSync } = require('child_process');
const browserPool = require('./BrowserPool.cjs');

class MercariPuppeteerScraper {
  constructor() {
    this.baseUrl = 'https://jp.mercari.com';
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
    return new Promise(r => setTimeout(r, ms));
  }

  async _killZombieChrome() {
    try { execSync('taskkill /F /IM chrome.exe /T 2>nul', { stdio: 'ignore' }); } catch (_) {}
    await this._sleep(1000);
  }

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

  async _setupPage(page) {
    const ua = this._getRandomUserAgent();
    await page.setUserAgent(ua);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    });
    // リクエスト傍受（画像・フォントを除外してロード高速化）
    await page.setRequestInterception(true);
    page.on('request', req => {
      const rt = req.resourceType();
      if (['font', 'media'].includes(rt)) {
        req.abort();
      } else {
        req.continue();
      }
    });
  }

  async search(keyword, options = {}) {
    const SEARCH_TIMEOUT_MS = 60000;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Search timeout: ${keyword} exceeded ${SEARCH_TIMEOUT_MS}ms`)), SEARCH_TIMEOUT_MS)
    );
    return Promise.race([this._searchInternal(keyword, options), timeoutPromise]);
  }

  async _searchInternal(keyword, options = {}) {
    const { minPrice = null, maxPrice = null, limit = 20 } = options;
    const results = [];

    let browser = null;
    let page = null;
    let poolAcquired = false;
    try {
      await browserPool.acquire();
      poolAcquired = true;
      browser = await this._launchBrowser();
      page = await browser.newPage();
      await this._setupPage(page);

      // URL構築
      const params = new URLSearchParams({ keyword });
if (minPrice) params.set('price_min', String(minPrice));
if (maxPrice) params.set('price_max', String(maxPrice));
params.set('sort',   'created_time'); // 新着順
params.set('order',  'desc');         // 降順
params.set('status', 'on_sale');      // 販売中のみ ← 追加
const searchUrl = `${this.baseUrl}/search?${params.toString()}`;
      console.log(`🔍 Mercari検索: ${keyword} → ${searchUrl}`);

      // ── ページ遷移（高速） ────────────────────────────────────
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // ── 商品要素の出現を待つ（SPAの描画完了を待機） ──────────
      try {
        await page.waitForSelector('[data-testid="item-cell"]', { timeout: 20000 });
      } catch (e) {
        console.log('⚠️ item-cell 出現待機タイムアウト（20秒）— 商品0件の可能性');
      }

      // ── 追加の安定待機（描画バッファ） ─────────────────────────
      await this._sleep(2000 + Math.random() * 2000);

      // ── デバッグ用スクリーンショット & HTMLダンプ ──────────────
      const ssPath = path.join(__dirname, '..', 'debug-mercari-page.png');
      await page.screenshot({ path: ssPath, fullPage: false });
      console.log(`📸 スクリーンショット保存: ${ssPath}`);

      const title = await page.title().catch(() => '(取得不可)');
      console.log(`📄 ページタイトル: ${title}`);

      // ── 要素数デバッグ ──────────────────────────────────────────
      const counts = await page.evaluate(() => ({
        itemCell:       document.querySelectorAll('[data-testid="item-cell"]').length,
        merThumbnail:   document.querySelectorAll('.merItemThumbnail').length,
        linkToItem:     document.querySelectorAll('a[href*="/item/"]').length,
        listContainer:  document.querySelectorAll('ul, ol').length,
      })).catch(() => ({}));
      console.log('🔢 要素カウント:', JSON.stringify(counts));

      // ── 実CAPTCHA判定（DOM要素ベース）──────────────────────────
      const isCaptcha = await page.evaluate(() => {
        if (document.querySelector('.g-recaptcha, [data-sitekey], iframe[src*="recaptcha"]')) return true;
        const h1 = (document.querySelector('h1')?.textContent || '').toLowerCase();
        return h1.includes('access denied') || h1.includes('アクセスが拒否');
      }).catch(() => false);

      if (isCaptcha) {
        console.warn('⚠️ 実CAPTCHAを検知 - このキーワードをスキップします');
        return [];
      }
      console.log('✅ CAPTCHA検知なし');

      // ── 商品描画待機（スケルトン解消まで最大30秒）──────────────
      console.log('⏳ 商品の実描画を待機中（最大30秒）...');
      await page.waitForFunction(() => {
        const cells = document.querySelectorAll('[data-testid="item-cell"]');
        if (!cells.length) {
          // フォールバック：a[href*="/item/"] が存在するか
          return document.querySelectorAll('a[href*="/item/"]').length > 0;
        }
        const first = cells[0];
        const hasImg  = !!(first.querySelector('img[src]')?.src?.startsWith('http'));
        const hasText = (first.textContent || '').replace(/\s/g, '').length > 5;
        return hasImg || hasText;
      }, { timeout: 30000 }).catch(() => {
        console.warn('⚠️ 描画待機タイムアウト（30秒経過）');
      });

      // ── パターン1: data-testid="item-cell" ─────────────────────
      let items = await page.$$('[data-testid="item-cell"]').catch(() => []);
      console.log(`🔍 パターン1 [item-cell]: ${items.length}件`);

      // ── パターン2: .merItemThumbnail (CSSクラス) ──────────────────
      if (!items.length) {
        items = await page.$$('.merItemThumbnail').catch(() => []);
        console.log(`🔍 パターン2 [.merItemThumbnail]: ${items.length}件`);
      }

      // ── パターン3: a[href*="/item/"] ───────────────────────────
      if (!items.length) {
        const links = await page.$$eval('a[href*="/item/"]', els =>
          [...new Map(els.map(e => [e.href, e])).values()].slice(0, 40).map(el => {
            let title = el.querySelector('img')?.alt || el.textContent?.trim() || '';
            title = title.replace(/のサムネイル$/, '').trim();
            return {
              url:      el.href,
              title,
              image:    el.querySelector('img')?.src || '',
              priceRaw: el.querySelector('[class*="price"], [class*="Price"]')?.textContent || '',
            };
          })
        ).catch(() => []);
        console.log(`🔍 パターン3 [a[href*="/item/"]]: ${links.length}件`);
        if (links.length) {
          return links.slice(0, limit).map(l => ({
            product_id: l.url.split('/item/')[1]?.split('?')[0] || '',
            platform:   'mercari',
            title:      l.title,
            price:      parseInt((l.priceRaw.replace(/[^0-9]/g, '') || '0'), 10),
            url:        l.url,
            image_url:  l.image,
            listed_at:  null,
          }));
        }
      }

      if (!items.length) {
        // ── 最終フォールバック: HTMLスニペット出力 ─────────────
        const snippet = await page.evaluate(() => document.body?.innerHTML?.slice(0, 3000) || '').catch(() => '');
        console.warn('⚠️ 商品要素が見つかりません。HTMLスニペット:');
        console.warn(snippet);
        return [];
      }

      // ── 商品データ抽出 ─────────────────────────────────────────
      for (const item of items.slice(0, limit)) {
        try {
          const data = await item.evaluate(el => {
            const anchor    = el.querySelector('a[href*="/item/"]') || el.closest('a');
            const url       = anchor?.href || '';
            const imgs      = el.querySelector('img');
            const priceEl   = el.querySelector('[class*="price"], [class*="Price"], mer-price');
            const priceText = priceEl?.textContent || '';

            // タイトル取得: img.alt → name/title要素 → テキスト
            let title = imgs?.alt || el.querySelector('[class*="name"],[class*="title"]')?.textContent?.trim() || '';
            // メルカリのalt属性は「〇〇のサムネイル」形式なのでサフィックスを除去
            title = title.replace(/のサムネイル$/, '').trim();

            // 出品時間テキスト取得（例: "1時間前", "3日前"）
            const timeEl = el.querySelector('[class*="created"], [class*="time"], [class*="updated"]');
            const timeText = timeEl?.textContent?.trim() || '';

            return {
              url,
              title,
              price:    priceText.replace(/[^0-9]/g, ''),
              image:    imgs?.src || '',
              timeText,
            };
          }).catch(() => null);

          if (!data || !data.url) continue;
          const productId = data.url.split('/item/')[1]?.split('?')[0] || '';
          results.push({
            product_id: productId,
            platform:   'mercari',
            title:      data.title,
            price:      parseInt(data.price || '0', 10),
            url:        data.url,
            image_url:  data.image,
            listed_at:  this._parseRelativeTime(data.timeText),
          });
        } catch (e) {
          console.warn(`商品抽出エラー: ${e.message}`);
        }
      }

      console.log(`✅ ${keyword} → ${results.length}件取得`);
      return results;

    } catch (err) {
      console.error(`❌ Mercari検索エラー [${keyword}]: ${err.message}`);
      return [];
    } finally {
      if (page) await page.close().catch(() => {});
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

  /**
   * 相対時間テキスト（例: "3分前", "2時間前", "1日前"）をISO文字列に変換
   * パースできない場合は null を返す
   */
  _parseRelativeTime(text) {
    if (!text) return null;
    const now = Date.now();

    const m = text.match(/(\d+)\s*(秒|分|時間|日|ヶ月|か月)/);
    if (!m) return null;

    const num  = parseInt(m[1], 10);
    const unit = m[2];
    const msMap = {
      '秒':    1000,
      '分':    60 * 1000,
      '時間':  60 * 60 * 1000,
      '日':    24 * 60 * 60 * 1000,
      'ヶ月':  30 * 24 * 60 * 60 * 1000,
      'か月':  30 * 24 * 60 * 60 * 1000,
    };
    const ms = msMap[unit];
    if (!ms) return null;

    return new Date(now - num * ms).toISOString();
  }

  async getProductDetail(url) {
    let browser = null;
    let page = null;
    let poolAcquired = false;
    try {
      await browserPool.acquire();
      poolAcquired = true;
      browser = await this._launchBrowser();
      page = await browser.newPage();
      await this._setupPage(page);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this._sleep(2000);

      const detail = await page.evaluate(() => {
        const title   = document.querySelector('h1')?.textContent?.trim() || '';
        const price   = document.querySelector('[class*="price"], mer-price')?.textContent?.trim() || '';
        const desc    = document.querySelector('[data-testid="description"], [class*="description"]')?.textContent?.trim() || '';
        const img     = document.querySelector('img[src*="static.mercdn"]')?.src || '';
        const sellerEl = document.querySelector('[data-testid="seller-info-name"]');
        const seller  = sellerEl?.textContent?.trim() || '';
        return { title, price, description: desc, image_url: img, seller };
      }).catch(() => ({}));

      return detail;
    } catch (err) {
      console.error(`❌ 商品詳細取得エラー: ${err.message}`);
      return null;
    } finally {
      if (page) await page.close().catch(() => {});
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

  // cleanup() は後方互換のため残置（ScrapingServiceのfinally節から呼ばれる）
  async cleanup() {
    // browser/pageはsearch()ごとにfinallyで閉じるため、ここでは何もしない
  }
}

module.exports = MercariPuppeteerScraper;
