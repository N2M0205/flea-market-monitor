'use strict';
/**
 * Yahoo!フリマ condition 取得確認スクリプト
 * 実行: node server/scripts/test-yahoo-condition.cjs
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const YahooFleaScraper = require('../services/YahooFleaScraper');

async function main() {
  const scraper = new YahooFleaScraper();
  const keyword = 'アルガンオイル';  // 監視中の任意キーワード

  console.log(`\n🔍 Yahoo!フリマ condition 取得テスト: "${keyword}"\n`);

  try {
    const results = await scraper.search(keyword, { limit: 5 });

    if (!results || results.length === 0) {
      console.log('❌ 商品が取得できませんでした');
      return;
    }

    console.log(`✅ ${results.length}件取得\n`);
    for (const p of results) {
      const cond = p.condition ?? '(null - 未取得)';
      console.log(`  📦 [${cond}] ${p.title.slice(0, 40)} ¥${p.price}`);
    }

    const withCond = results.filter(p => p.condition !== null);
    console.log(`\n📊 condition 取得率: ${withCond.length}/${results.length}`);
    if (withCond.length > 0) {
      const uniq = [...new Set(withCond.map(p => p.condition))];
      console.log('  取得値一覧:', uniq);
    } else {
      console.log('  → condition は検索結果HTMLに含まれていません（NG_WORDSで補完）');
    }
  } catch (err) {
    console.error('❌ エラー:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
