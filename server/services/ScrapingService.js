// server/services/ScrapingService.js

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { Op } = require('sequelize');
const { Keyword, Product } = require('../models');
const MercariPuppeteerScraper  = require('./MercariPuppeteerScraper');
const PayPayPuppeteerScraper   = require('./PayPayPuppeteerScraper');
const YahooFleaScraper         = require('./YahooFleaScraper');
const LineNotificationService  = require('./LineNotificationService');

const { loadLayerAConfig, layerAFilter, calcRarityScore } = require('./LayerAFilterService');
const purchaseMasterCache = require('./PurchaseMasterCache');
const { log: runLog } = require('../src/utils/RunLogger');

// ============================================================
// タイトルフィルタ ユーティリティ
// ============================================================

/**
 * 英語機能語のみをノイズとして除外する
 * 数字・単位・短い語は商品スペックとして保持する
 * 例: "no" → 除外 / "93" "30ml" → 保持
 */
function isNoiseWord(word) {
  const stopWords = ['no', 'the', 'for', 'and', 'with', 'from', 'de', 'la', 'le'];
  return stopWords.includes(word);
}

/**
 * テキスト正規化
 * - 全角英数 → 半角
 * - +/＋ → プラス
 * - 装飾記号除去
 * - 全角スペース・連続スペース → 半角スペース1つ
 */
function normalizeText(text) {
  return text.toLowerCase()
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[+＋]/g, 'プラス')
    .replace(/[【】★☆♪◆●○■□▲▼！？『』「」。、・]/g, '')
    .replace(/　/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * タイトルフィルタ本体
 * 判定ロジック（優先順）:
 *   1. ノイズ除去後の有効ワードが0件 → スキップ（全件通過）
 *   2. AND判定: 全有効ワードがタイトルに含まれる → 通過
 *   3. フレーズ一致: スペース除去後のキーワードがタイトルに含まれる → 通過（表記ゆれ救済）
 *   4. 上記すべて失敗 → 除外
 *
 * 対象プラットフォーム: mercari / yahoo_flea / paypay_flea
 */
function applyTitleFilter(products, keywordStr, platform) {
  const normKw = normalizeText(keywordStr);
  const parts  = normKw.split(/\s+/).filter(w => w && !isNoiseWord(w));

  if (parts.length === 0) {
    console.log(`⚠️ [${platform}] タイトルフィルタ: 有効ワードなし → スキップ [${keywordStr}]`);
    runLog(`⚠️ [${platform}] タイトルフィルタ スキップ（有効ワードなし）[${keywordStr}]`);
    return products;
  }

  const noSpaceKw = normKw.replace(/\s+/g, '');

  const filtered = products.filter(p => {
    const normTitle    = normalizeText(p.title || '');
    const noSpaceTitle = normTitle.replace(/\s+/g, '');
    const andMatch     = parts.every(part => normTitle.includes(part));
    const phraseMatch  = noSpaceTitle.includes(noSpaceKw);
    return andMatch || phraseMatch;
  });

  const excluded = products.length - filtered.length;
  if (excluded > 0) {
    console.log(`  🔍 [${platform}] タイトルフィルタ(${parts.join(' & ')}): ${excluded}件除外 → ${filtered.length}件残`);
    runLog(`  🔍 [${platform}] タイトルフィルタ [${keywordStr}]: ${excluded}件除外 ${filtered.length}件残`);
  }

  return filtered;
}

// ============================================================
// platforms フィールド正規化ヘルパー
// ============================================================

/**
 * DBのplatformsフィールドを配列に正規化する
 * 対応形式:
 *   1. 配列                              → そのまま返す
 *   2. JSON文字列 '["mercari","yahoo_flea"]' → JSON.parse して配列化
 *   3. オブジェクト {"mercari":true,...} → true のキーだけ抽出して配列化
 */
function parsePlatforms(rawPlatforms) {
  if (!rawPlatforms) return [];
  if (Array.isArray(rawPlatforms)) return rawPlatforms;
  if (typeof rawPlatforms === 'string') {
    try {
      const parsed = JSON.parse(rawPlatforms);
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'object' && parsed !== null) {
        return Object.keys(parsed).filter(k => parsed[k]);
      }
      return [parsed];
    } catch (e) {
      return [rawPlatforms];
    }
  }
  if (typeof rawPlatforms === 'object') {
    return Object.keys(rawPlatforms).filter(k => rawPlatforms[k]);
  }
  return [];
}

// ============================================================

class ScrapingService {
  constructor() {
    this.scrapers = {
      mercari:     new MercariPuppeteerScraper(),
      paypay_flea: new PayPayPuppeteerScraper(),
      yahoo_flea:  new YahooFleaScraper(),
    };
    this.lineNotificationService = LineNotificationService;
    this.isRunning               = false;
    this.scanCount               = 0;
  }

  getStatus() {
    return this.isRunning;
  }

  async _cleanupZombieBrowsers() {
    const LEAK_THRESHOLD_MS = 3 * 60 * 1000; // 3分超 = ゾンビ判定
    const now = Date.now();
    let killedChrome = 0;
    let cleanedDirs  = 0;

    // ── 1. 3分超の chrome.exe をkill ────────────────────────────────
    try {
      const raw = execSync('tasklist /FI "IMAGENAME eq chrome.exe" /FO CSV /NH', { encoding: 'utf-8' });
      const pids = [];
      for (const line of raw.split('\n')) {
        const m = line.trim().match(/"chrome\.exe","(\d+)"/i);
        if (m) pids.push(parseInt(m[1], 10));
      }

      for (const pid of pids) {
        try {
          const wmicOut = execSync(
            `wmic process where (ProcessId=${pid}) get CreationDate /format:csv`,
            { encoding: 'utf-8', timeout: 5000 }
          );
          for (const wline of wmicOut.split('\n')) {
            const parts = wline.trim().split(',');
            const dateStr = parts[parts.length - 1];
            const dm = dateStr.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
            if (dm) {
              const [, y, mo, d, h, mi, s] = dm;
              const elapsed = now - new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`).getTime();
              if (elapsed >= LEAK_THRESHOLD_MS) {
                try {
                  execSync(`taskkill /F /PID ${pid}`, { encoding: 'utf-8' });
                  killedChrome++;
                  console.log(`🧹 ゾンビChrome kill: PID ${pid}（${Math.round(elapsed / 1000)}秒経過）`);
                } catch (_) {}
              }
              break;
            }
          }
        } catch (_) {}
      }
    } catch (_) {}

    // ── 2. puppeteer_dev_profile 残留ディレクトリを削除 ──────────────
    try {
      const baseTempDir = path.dirname(process.env.TEMP || os.tmpdir());
      const tempDirs = [baseTempDir];
      try {
        for (const entry of fs.readdirSync(baseTempDir, { withFileTypes: true })) {
          if (entry.isDirectory() && /^\d+$/.test(entry.name)) {
            tempDirs.push(path.join(baseTempDir, entry.name));
          }
        }
      } catch (_) {}

      for (const tempDir of tempDirs) {
        try {
          for (const entry of fs.readdirSync(tempDir, { withFileTypes: true })) {
            if (entry.isDirectory() && entry.name.startsWith('puppeteer_dev_')) {
              try {
                fs.rmSync(path.join(tempDir, entry.name), { recursive: true, force: true });
                cleanedDirs++;
              } catch (_) {}
            }
          }
        } catch (_) {}
      }
    } catch (_) {}

    console.log(`🧹 ゾンビクリーンアップ完了: Chrome kill=${killedChrome}件, puppeteer_dev_profile 削除=${cleanedDirs}件`);
  }

  async _cleanupOldProducts() {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const deleted = await Product.destroy({
        where: {
          is_notified: true,
          created_at: { [Op.lt]: thirtyDaysAgo }
        }
      });
      if (deleted > 0) {
        console.log(`🗑️ 古い商品データを自動削除: ${deleted}件（30日以上経過）`);
      }
    } catch (err) {
      console.warn('⚠️ 古い商品データの削除に失敗（スクレイピングは続行）:', err.message);
    }
  }

  async scrapeAllKeywords() {
    if (this.isRunning) {
      console.warn('⚠️ scrapeAllKeywords: 前回スキャンが進行中のためスキップ（重複起動防止）');
      return { success: false, message: '前回スキャンが進行中' };
    }

    this.isRunning = true;
    this.scanCount++;

    const startLabel = `🤖 定期スクレイピング開始 - ${new Date().toLocaleString('ja-JP')} (スキャン #${this.scanCount})`;
    console.log('\n============================================================');
    console.log(startLabel);
    console.log('============================================================\n');
    runLog('============================================================');
    runLog(startLabel);
    runLog('============================================================');

    try {
      // ゾンビChrome・残留userDataDirを先に一掃
      await this._cleanupZombieBrowsers();

      // Yahoo!フリマの自動停止フラグをリセット（前回スキャンの状態を引き継がない）
      if (this.scrapers.yahoo_flea?.resetAbortState) {
        this.scrapers.yahoo_flea.resetAbortState();
      }

      await this._cleanupOldProducts();

      const keywords = await Keyword.findAll();
      console.log(`📋 ${keywords.length}件のキーワードを処理します`);
      runLog(`📋 キーワード数: ${keywords.length}件`);

      const layerAConfig = await loadLayerAConfig();
      console.log(`⚙️ Layer A config: 評価≥${layerAConfig.layer_a_min_rating}%, 経過≤${layerAConfig.layer_a_max_hours}h, 期限≥${layerAConfig.layer_a_min_expiry_months}ヶ月`);

      const CONCURRENCY = parseInt(process.env.SCRAPING_CONCURRENCY || '3', 10);
      const totalBatches = Math.ceil(keywords.length / CONCURRENCY);
      console.log(`🚀 並列処理開始（同時実行数: ${CONCURRENCY} / バッチ数: ${totalBatches}）\n`);

      const startTime = Date.now();

      for (let i = 0; i < keywords.length; i += CONCURRENCY) {
        const batch    = keywords.slice(i, i + CONCURRENCY);
        const batchNum = Math.floor(i / CONCURRENCY) + 1;

        console.log(`\n📦 バッチ ${batchNum}/${totalBatches}: [${batch.map(k => k.keyword).join(' / ')}]`);

        const results = await Promise.allSettled(
          batch.map(keyword => this.scrapeKeyword(keyword, layerAConfig))
        );

        results.forEach((result, idx) => {
          if (result.status === 'rejected') {
            console.error(`  ❌ "${batch[idx].keyword}" 失敗: ${result.reason?.message}`);
            runLog(`  ❌ キーワード失敗 [${batch[idx].keyword}]: ${result.reason?.message}`);
          }
        });

        console.log(`  ✅ バッチ ${batchNum}/${totalBatches} 完了`);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\n✅ 全キーワードのスクレイピング完了（${keywords.length}件 / ${elapsed}秒）\n`);
      runLog(`✅ 巡回完了: ${keywords.length}キーワード / ${elapsed}秒`);

      return { success: true, totalProducts: keywords.length, elapsed };

    } finally {
      // ブラウザを確実に閉じてメモリ解放
      for (const [name, scraper] of Object.entries(this.scrapers)) {
        try {
          if (scraper.cleanup)  await scraper.cleanup();
          else if (scraper.close) await scraper.close();
        } catch (e) {
          console.error(`⚠️ ${name} ブラウザ終了エラー: ${e.message}`);
        }
      }
      this.isRunning = false;
      console.log('🔓 isRunning を false にリセットしました');
    }
  }

  async scrapeKeyword(keyword, layerAConfig) {
    console.log(`\n🔍 キーワード処理: "${keyword.keyword}"`);
    console.log(`📌 使用メソッド: puppeteer`);

    let platforms = parsePlatforms(keyword.platforms);
    if (platforms.length === 0) {
      platforms = keyword.platform ? [keyword.platform] : ['mercari'];
    }

    console.log(`🎯 対象プラットフォーム: ${platforms.join(', ')}`);

    const platformResults = await Promise.allSettled(
      platforms.map(platform => this.scrapePlatform(keyword, platform, layerAConfig))
    );

    platformResults.forEach((result, idx) => {
      if (result.status === 'rejected') {
        console.error(`❌ プラットフォーム "${platforms[idx]}" のスクレイピングエラー:`, result.reason?.message);
      }
    });
  }

  async scrapePlatform(keyword, platform, layerAConfig) {
    console.log(`\n  🔹 プラットフォーム: ${platform}`);

    const scraper = this.scrapers[platform];
    if (!scraper) {
      console.warn(`  ⚠️ プラットフォーム "${platform}" のスクレイパーがありません`);
      runLog(`  ⚠️ スクレイパー未登録: ${platform} [${keyword.keyword}]`);
      return;
    }

    // ① スクレイピング実行
    const products = await scraper.search(keyword.keyword, {
      min_price: keyword.min_price,
      max_price: keyword.max_price,
      limit: 20,
    });
    console.log(`  📦 ${products.length}件の商品を取得（${platform}）`);

    // ② タイトルフィルタ（mercari / yahoo_flea / paypay_flea 共通）
    //    AND条件 + スペース除去フレーズ一致（案③ 正規化AND）
    //    - 全角→半角、+→プラス、記号除去で表記ゆれを吸収
    //    - 数字・単位（93, 30ml 等）はスペック識別子として保持
    //    - 英語機能語（no/the/for 等）のみノイズとして除外
    const FILTER_PLATFORMS = ['mercari', 'yahoo_flea', 'paypay_flea'];
    const filteredProducts = FILTER_PLATFORMS.includes(platform)
      ? applyTitleFilter(products, keyword.keyword, platform)
      : products;

    // ③ DB保存（新規のみ）
    const newProducts = [];
    for (const item of filteredProducts) {
      const [saved, created] = await Product.findOrCreate({
        where: {
          keyword_id: keyword.id,
          product_id: item.product_id,
        },
        defaults: {
          platform,
          title:     item.title,
          price:     item.price,
          url:       item.url,
          image_url: item.image_url,
        },
      });
      if (!created) continue;

      newProducts.push({ ...saved.toJSON(), description: item.description || '' });
      console.log(`  ✨ 新規商品: "${item.title}" (¥${item.price})`);
      runLog(`  ✨ 新着 [${keyword.keyword}/${platform}]: "${item.title}" ¥${item.price}`);
    }

    if (newProducts.length === 0) {
      console.log('  📭 新規商品なし');
      return;
    }
    console.log(`  💾 ${newProducts.length}件の新規商品を保存しました`);

    // ④ CROSSMALL情報取得（キャッシュ参照 — API呼び出しなし）
    let crossmallInfo = null;
    if (keyword.crossmall_item_code) {
      const master = purchaseMasterCache.getMasterItem(keyword.crossmall_item_code);
      if (master) {
        crossmallInfo = {
          item_code: keyword.crossmall_item_code,
          stock: master.stock ?? null,
          price: master.lastSalePrice ?? null,
          sales28: master.sales28 ?? 0,
          sales7: master.sales7 ?? 0,
          lastSaleDate: master.lastSaleDate ?? null,
          deliveryType: master.deliveryType ?? null,
          item_name: null,
        };
        console.log('  ✅ CROSSMALL情報（キャッシュ）:', crossmallInfo);
      } else {
        console.log(`  ⚠️ CROSSMALL キャッシュなし: ${keyword.crossmall_item_code}`);
      }
    }

    // ⑤ Layer A フィルタ → 通知
    const enabled = (process.env.LINE_NOTIFY_ENABLED || 'true') === 'true';
    const groupId = (process.env.LINE_GROUP_ID || '').trim();

    let passCount = 0;
    let failCount = 0;

    for (const product of newProducts) {
      const filterResult = layerAFilter(product, keyword, layerAConfig);

      if (!filterResult.pass) {
        failCount++;
        console.log(`  ⏭️ Layer A 除外: [${filterResult.reason}] "${product.title}"`);
        runLog(`  ⏭️ Layer A除外 [${keyword.keyword}/${platform}]: "${product.title}" 理由: ${filterResult.reason}`);
        continue;
      }

      passCount++;
      console.log(`  ✅ Layer A 通過: "${product.title}"`);
      runLog(`  ✅ Layer A合格 [${keyword.keyword}/${platform}]: "${product.title}" ¥${product.price}`);

      const master = purchaseMasterCache.getMasterItem(keyword.crossmall_item_code);
      const stockDisplay =
        crossmallInfo?.stock != null ? crossmallInfo.stock :
        master?.stock        != null ? master.stock        : null;
      const sales28 = master?.sales28 ?? null;
      const rarity  = calcRarityScore(sales28);

      if (!enabled) {
        console.log('  ℹ️ LINE通知は無効化されています');
        runLog(`  ℹ️ LINE無効化スキップ [${keyword.keyword}]: "${product.title}"`);
      } else if (!groupId) {
        console.log('  ⚠️ LINE_GROUP_ID 未設定のため通知スキップ');
        runLog(`  ⚠️ LINE_GROUP_ID未設定スキップ [${keyword.keyword}]: "${product.title}"`);
      } else {
        try {
          await this.lineNotificationService.notifyPurchaseAlert(groupId, {
            product, keyword, master, crossmallInfo,
            expiryMonths: filterResult.expiryMonths,
            hoursOld:     filterResult.hoursOld,
            stockDisplay, rarity,
          });
          runLog(`  📱 LINE送信✅ [${keyword.keyword}/${platform}]: "${product.title}" ¥${product.price}`);
        } catch (notifyError) {
          console.error('  ❌ LINE通知送信エラー:', notifyError);
          runLog(`  ❌ LINE送信失敗 [${keyword.keyword}/${platform}]: "${product.title}" エラー: ${notifyError.message}`);
        }
      }
    }

    console.log(`  ℹ️ Layer A フィルタ結果 "${keyword.keyword}": 合格=${passCount}件, 不合格=${failCount}件`);
    runLog(`  📊 [${keyword.keyword}/${platform}] Layer A: 合格=${passCount}件 不合格=${failCount}件`);
    console.log('  ✅ スクレイピング完了');
  }
}

module.exports = new ScrapingService();
