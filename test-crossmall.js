/**
 * CROSSMALL API 接続テスト（注文データ対応版）
 * 
 * 使い方:
 * node test-crossmall.js
 */

require('dotenv').config();
const CrossmallService = require('./server/services/CrossmallService');

async function testCrossmall() {
  console.log('===================================');
  console.log('🧪 CROSSMALL API 接続テスト');
  console.log('===================================\n');

  const crossmall = new CrossmallService();

  // テスト対象の商品コード
  const itemCode = '2314-000521'; // セノッピー

  console.log(`📦 テスト商品コード: ${itemCode}\n`);

  try {
    // 1. 在庫情報取得テスト
    console.log('🔍 在庫情報を取得中...');
    const stockInfo = await crossmall.getStockInfo(itemCode);
    
    if (stockInfo) {
      console.log('✅ 在庫情報取得成功:');
      console.log(`   - 商品コード: ${stockInfo.item_code}`);
      console.log(`   - 在庫数: ${stockInfo.stock}`);
      console.log(`   - 商品名: ${stockInfo.item_name || 'N/A'}`);
    } else {
      console.log('⚠️ 在庫情報が取得できませんでした');
    }

    console.log('\n-----------------------------------\n');

    // 2. 最後に売れた金額取得テスト
    console.log('🔍 最後に売れた金額を取得中（過去28日間）...');
    const salePrice = await crossmall.getLastSalePrice(itemCode, 28);
    
    if (salePrice) {
      console.log('✅ 販売価格取得成功:');
      console.log(`   - 商品コード: ${itemCode}`);
      console.log(`   - 最後に売れた金額: ¥${salePrice.toLocaleString()}`);
    } else {
      console.log('⚠️ 販売価格が取得できませんでした（過去28日間に販売実績なし）');
    }

    console.log('\n-----------------------------------\n');

    // 3. 在庫数と販売価格を同時取得（推奨）
    console.log('🔍 在庫数と販売価格を同時取得中...');
    const result = await crossmall.getStockAndPrice(itemCode, 28);
    
    if (result) {
      console.log('✅ 取得成功:');
      console.log(`   - 商品コード: ${result.item_code}`);
      console.log(`   - 商品名: ${result.item_name || 'N/A'}`);
      console.log(`   - 在庫数: ${result.stock}`);
      console.log(`   - 販売価格: ${result.price ? `¥${result.price.toLocaleString()}` : 'N/A（販売実績なし）'}`);
    } else {
      console.log('⚠️ 情報が取得できませんでした');
    }

  } catch (error) {
    console.error('❌ エラー:', error.message);
    console.error('\n詳細:', error);
  }

  console.log('\n===================================');
  console.log('🏁 テスト完了');
  console.log('===================================');
}

// テスト実行
testCrossmall().catch(console.error);