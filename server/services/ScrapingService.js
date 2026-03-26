// server/services/ScrapingService.js

const { Op } = require('sequelize');
const { Keyword, Product } = require('../models');
const MercariPuppeteerScraper  = require('./MercariPuppeteerScraper');
const PayPayPuppeteerScraper   = require('./PayPayPuppeteerScraper');
const YahooFleaScraper         = require('./YahooFleaScraper');
const LineNotificationService  = require('./LineNotificationService');
const CrossmallService         = require('./CrossmallService');

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

class ScrapingService {
  constructor() {
    this.scrapers = {
      mercari:     new MercariPuppeteerScraper(),
      paypay_flea: new PayPayPuppeteerScraper(),
      yahoo_flea:  new YahooFleaScraper(),
    };
    this.lineNotificationService = LineNotificationService;
    this.crossmallService        = new CrossmallService();
    this.isRunning               = false;
    this.scanCount               = 0;
  }

  getStatus() {
    return this.isRunning;
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

    let platforms = [];
    if (keyword.platforms) {
      if (Array.isArray(keyword.platforms)) {
        platforms = keyword.platforms;
      } else if (typeof keyword.platforms === 'string') {
        try {
          platforms = JSON.parse(keyword.platforms);
        } catch (e) {
          platforms = [keyword.platforms];
        }
      }
    } else if (keyword.platform) {
      platforms = [keyword.platform];
    } else {
      platforms = ['mercari'];
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
      const exists = await Product.findOne({
        where: { platform, product_id: item.product_id },
      });
      if (exists) continue;

      const saved = await Product.create({
        keyword_id:  keyword.id,
        platform,
        product_id:  item.product_id,
        title:       item.title,
        price:       item.price,
        url:         item.url,
        image_url:   item.image_url,
        is_notified: false,
      });
      newProducts.push({ ...saved.toJSON(), description: item.description || '' });
      console.log(`  ✨ 新規商品: "${item.title}" (¥${item.price})`);
      runLog(`  ✨ 新着 [${keyword.keyword}/${platform}]: "${item.title}" ¥${item.price}`);
    }

    if (newProducts.length === 0) {
      console.log('  📭 新規商品なし');
      return;
    }
    console.log(`  💾 ${newProducts.length}件の新規商品を保存しました`);

    // ④ CROSSMALL情報取得（任意）
    let crossmallInfo = null;
    if (keyword.crossmall_item_code) {
      try {
        crossmallInfo = await this.crossmallService.getStockAndPrice(
          keyword.crossmall_item_code, 28
        );
        console.log('  ✅ CROSSMALL情報取得成功:', crossmallInfo);
      } catch (error) {
        console.error('  ❌ CROSSMALL情報取得エラー:', error.message);
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
