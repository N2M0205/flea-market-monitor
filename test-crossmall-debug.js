/**
 * CROSSMALL API デバッグテスト
 * レスポンスの詳細を確認
 */

require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const xml2js = require('xml2js');

// 設定
const config = {
  apiUrl: process.env.CROSSMALL_API_URL || 'https://crossmall.jp/webapi2',
  account: process.env.CROSSMALL_ACCOUNT || '3663',
  authKey: process.env.CROSSMALL_AUTH_KEY || '3O2EP5CPXB'
};

console.log('===================================');
console.log('🔍 CROSSMALL API デバッグテスト');
console.log('===================================\n');
console.log('📋 設定情報:');
console.log(`  - API URL: ${config.apiUrl}`);
console.log(`  - Account: ${config.account}`);
console.log(`  - Auth Key: ${config.authKey.substring(0, 4)}****\n`);

/**
 * MD5署名を生成
 */
function generateSignature(params) {
  // パラメータをソートしてURLエンコード
  const sortedKeys = Object.keys(params).sort();
  const queryString = sortedKeys
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  // 認証鍵を付与してMD5ハッシュ化
  const stringToSign = queryString + config.authKey;
  const signature = crypto.createHash('md5').update(stringToSign).digest('hex');

  console.log('🔐 署名生成:');
  console.log(`  - Query String: ${queryString}`);
  console.log(`  - String to Sign: ${stringToSign}`);
  console.log(`  - MD5 Signature: ${signature}\n`);

  return signature;
}

/**
 * APIリクエストを送信（デバッグ版）
 */
async function testApiRequest(endpoint, params = {}) {
  try {
    // 基本パラメータ
    const requestParams = {
      account: config.account,
      ...params
    };

    // 署名を生成
    const signature = generateSignature(requestParams);
    requestParams.sign = signature;

    // リクエストURL
    const url = `${config.apiUrl}/${endpoint}`;
    
    console.log(`📡 リクエスト送信:`);
    console.log(`  - URL: ${url}`);
    console.log(`  - Params:`, requestParams);
    console.log('');

    // リクエスト送信
    const response = await axios.get(url, {
      params: requestParams,
      timeout: 30000,
      validateStatus: () => true // すべてのステータスコードを受け入れ
    });

    console.log(`📥 レスポンス受信:`);
    console.log(`  - Status: ${response.status} ${response.statusText}`);
    console.log(`  - Headers:`, response.headers);
    console.log(`  - Data (raw):\n${response.data.substring(0, 1000)}\n`);

    // XMLをパース
    if (response.status === 200) {
      try {
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(response.data);
        
        console.log('✅ XML パース成功:');
        console.log(JSON.stringify(result, null, 2));
        
        return result;
      } catch (parseError) {
        console.error('❌ XML パースエラー:', parseError.message);
        return null;
      }
    } else {
      console.error(`❌ HTTPエラー: ${response.status}`);
      return null;
    }
  } catch (error) {
    console.error('❌ リクエストエラー:', error.message);
    if (error.response) {
      console.error('  - Status:', error.response.status);
      console.error('  - Data:', error.response.data);
    }
    return null;
  }
}

/**
 * メインテスト
 */
async function runTests() {
  const itemCode = '2314-000521'; // セノッピー

  console.log('===================================');
  console.log('🧪 テスト1: 在庫情報取得 (get_stock)');
  console.log('===================================\n');
  
  await testApiRequest('get_stock', {
    item_code: itemCode
  });

  console.log('\n\n===================================');
  console.log('🧪 テスト2: 商品情報取得 (get_item)');
  console.log('===================================\n');
  
  await testApiRequest('get_item', {
    item_code: itemCode
  });

  console.log('\n\n===================================');
  console.log('🏁 テスト完了');
  console.log('===================================');
}

// テスト実行
runTests().catch(console.error);