const axios = require('axios');
const crypto = require('crypto');
const xml2js = require('xml2js');

/**
 * CROSSMALL WebAPI サービス（注文データ対応版）
 * 
 * 機能:
 * - 在庫数取得 (get_stock)
 * - 最後に売れた金額取得 (get_order_detail)
 */
class CrossmallService {
  constructor() {
    this.config = {
      apiUrl: process.env.CROSSMALL_API_URL || 'https://crossmall.jp/webapi2',
      account: process.env.CROSSMALL_ACCOUNT || '3663',
      authKey: process.env.CROSSMALL_AUTH_KEY || '3O2EP5CPXB'
    };

    console.log('✅ CROSSMALL API クライアント初期化完了');
    console.log(`  - Account: ${this.config.account}`);
    console.log(`  - API URL: ${this.config.apiUrl}`);
  }

  /**
   * 商品コードをクリーニング（末尾の n, s を削除）
   */
  cleanItemCode(itemCode) {
    if (!itemCode) return itemCode;
    return itemCode.replace(/[ns]$/, '');
  }

  /**
   * MD5署名を生成（仕様書準拠）
   */
  generateSigning(params) {
    const sortedKeys = Object.keys(params).sort();
    const parts = sortedKeys.map(key => `${key}=${params[key]}`);
    const queryString = parts.join('&');
    const stringToSign = queryString + this.config.authKey;
    const signing = crypto.createHash('md5').update(stringToSign, 'utf8').digest('hex');
    
    if (process.env.DEBUG_CROSSMALL === 'true') {
      console.log('🔐 署名生成:', { queryString, stringToSign, signing });
    }
    
    return signing;
  }

  /**
   * CROSSMALL API リクエスト
   */
  async makeRequest(endpoint, params = {}) {
    try {
      const requestParams = { account: this.config.account, ...params };
      const signing = this.generateSigning(requestParams);
      const finalParams = { ...requestParams, signing };

      const response = await axios.get(`${this.config.apiUrl}/${endpoint}`, {
        params: finalParams,
        timeout: 30000,
        validateStatus: () => true
      });

      if (response.status !== 200) {
        console.error(`❌ CROSSMALL API HTTPエラー (${endpoint}): ${response.status}`);
        return null;
      }

      const parser = new xml2js.Parser({ explicitArray: false });
      const result = await parser.parseStringPromise(response.data);

      const resultStatus = this.extractResultStatus(result);
      if (resultStatus && resultStatus.GetStatus === 'error') {
        console.error(`❌ CROSSMALL API エラー (${endpoint}): ${resultStatus.Message}`);
        return null;
      }

      return result;
    } catch (error) {
      console.error(`❌ CROSSMALL API リクエストエラー (${endpoint}):`, error.message);
      return null;
    }
  }

  /**
   * XMLレスポンスからResultStatusを抽出
   */
  extractResultStatus(result) {
    const rootKey = Object.keys(result)[0];
    const root = result[rootKey];
    
    if (root && root.ResultSet && root.ResultSet.ResultStatus) {
      return root.ResultSet.ResultStatus;
    }
    
    return null;
  }

  /**
   * 在庫情報を取得
   */
  async getStockInfo(itemCode) {
    try {
      console.log(`🔍 CROSSMALL在庫取得開始: ${itemCode}`);

      const result = await this.makeRequest('get_stock', { item_code: itemCode });

      if (!result) {
        console.log(`⚠️ CROSSMALL在庫情報なし: ${itemCode}`);
        return null;
      }

      const resultSet = result.GetStock?.ResultSet;
      if (!resultSet || !resultSet.Result) {
        console.log(`⚠️ CROSSMALL在庫データなし: ${itemCode}`);
        return null;
      }

      const results = Array.isArray(resultSet.Result) ? resultSet.Result : [resultSet.Result];
      const firstResult = results[0];
      
      const stockInfo = {
        item_code: firstResult.ItemCode || itemCode,
        stock: parseInt(firstResult.StockNum || firstResult.stock || 0),
        item_name: firstResult.ItemName || null
      };

      console.log(`✅ CROSSMALL在庫取得成功: ${itemCode} - 在庫数: ${stockInfo.stock}`);
      return stockInfo;
    } catch (error) {
      console.error(`❌ CROSSMALL在庫取得エラー: ${itemCode}`, error.message);
      return null;
    }
  }

  /**
   * 日付をフォーマット (YYYY-MM-DD)
   */
  _formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * 指定期間の注文を1回のAPIコールで取得（最大100件）
   * @returns {{ orderNumbers: string[], orderMeta: Map<string, { deliveryType: string }> }}
   */
  async _fetchOrdersForRange(fromDate, toDate) {
    const result = await this.makeRequest('get_order', {
      order_date_fr: this._formatDate(fromDate),
      order_date_to: this._formatDate(toDate)
    });

    if (!result) return { orderNumbers: [], orderMeta: new Map() };

    const resultSet = result.GetOrder?.ResultSet;
    if (!resultSet || !resultSet.Result) return { orderNumbers: [], orderMeta: new Map() };

    const results = Array.isArray(resultSet.Result) ? resultSet.Result : [resultSet.Result];
    const orderNumbers = [];
    const orderMeta = new Map();

    for (const r of results) {
      if (!r.order_number) continue;
      orderNumbers.push(r.order_number);
      orderMeta.set(r.order_number, {
        deliveryType: r.delivery_type_name || ''
      });
    }

    return { orderNumbers, orderMeta };
  }

  /**
   * 過去N日間の注文番号リスト＋メタ情報を取得
   * API上限100件/リクエストのため、7日間ごとに分割して取得
   * @returns {{ orderNumbers: string[], orderMetaMap: Map<string, { deliveryType: string }> }}
   */
  async getOrderNumbers(days = 28) {
    try {
      const now = new Date();
      const globalStart = new Date();
      globalStart.setDate(now.getDate() - days);

      const CHUNK_DAYS = 7;
      const orderSet = new Set();
      const orderMetaMap = new Map();

      console.log(`🔍 注文番号取得: ${this._formatDate(globalStart)} ~ ${this._formatDate(now)} (${CHUNK_DAYS}日分割)`);

      // 古い方から新しい方へ7日ずつ取得
      let chunkStart = new Date(globalStart);
      let chunkIndex = 0;

      while (chunkStart < now) {
        const chunkEnd = new Date(chunkStart);
        chunkEnd.setDate(chunkEnd.getDate() + CHUNK_DAYS - 1);
        if (chunkEnd > now) chunkEnd.setTime(now.getTime());

        const { orderNumbers: numbers, orderMeta } = await this._fetchOrdersForRange(chunkStart, chunkEnd);
        for (const n of numbers) orderSet.add(n);
        for (const [k, v] of orderMeta) orderMetaMap.set(k, v);

        chunkIndex++;
        console.log(`  [${chunkIndex}] ${this._formatDate(chunkStart)}~${this._formatDate(chunkEnd)}: ${numbers.length}件 (累計: ${orderSet.size})`);

        chunkStart.setDate(chunkStart.getDate() + CHUNK_DAYS);
        await new Promise(r => setTimeout(r, 50));
      }

      const orderNumbers = [...orderSet].sort();
      console.log(`✅ ${orderNumbers.length}件の注文を取得 (${chunkIndex}回のAPIコール)`);
      return { orderNumbers, orderMetaMap };
    } catch (error) {
      console.error('❌ 注文番号取得エラー:', error.message);
      return { orderNumbers: [], orderMetaMap: new Map() };
    }
  }

  /**
   * 注文詳細から商品コードの販売価格を取得
   */
  async getOrderDetail(orderNumber) {
    try {
      const result = await this.makeRequest('get_order_detail', {
        order_number: orderNumber
      });

      if (!result) return [];

      const resultSet = result.GetOrderDetail?.ResultSet;
      if (!resultSet || !resultSet.Result) return [];

      const results = Array.isArray(resultSet.Result) ? resultSet.Result : [resultSet.Result];
      
      return results.map(r => ({
        item_code: this.cleanItemCode(r.item_code || r.ItemCode || ''),
        unit_price: parseFloat(r.unit_price || r.UnitPrice || 0),
        order_number: orderNumber
      }));
    } catch (error) {
      console.error(`❌ 注文詳細取得エラー (${orderNumber}):`, error.message);
      return [];
    }
  }

  /**
   * 最後に売れた金額と28日間の販売個数を取得
   * @returns {{ lastPrice: number|null, salesCount: number }}
   */
  async getLastSalePriceAndCount(itemCode, days = 28) {
    try {
      console.log(`🔍 CROSSMALL販売価格・個数取得開始: ${itemCode} (過去${days}日間)`);

      const cleanedItemCode = this.cleanItemCode(itemCode);

      // 1. 注文番号リストを取得
      const { orderNumbers } = await this.getOrderNumbers(days);

      if (orderNumbers.length === 0) {
        console.log('⚠️ 該当期間に注文なし');
        return { lastPrice: null, salesCount: 0 };
      }

      let lastPrice = null;
      let salesCount = 0;

      // 2. 全注文を走査して販売個数をカウント＆直近価格を取得
      for (let i = orderNumbers.length - 1; i >= 0; i--) {
        const orderNumber = orderNumbers[i];

        // 50ms待機（API負荷軽減）
        await new Promise(resolve => setTimeout(resolve, 50));

        const details = await this.getOrderDetail(orderNumber);

        // 該当商品を検索
        const matched = details.filter(d =>
          d.item_code === cleanedItemCode || d.item_code === itemCode
        );

        for (const item of matched) {
          if (item.unit_price > 0) {
            salesCount++;
            if (lastPrice === null) {
              lastPrice = item.unit_price;
            }
          }
        }
      }

      if (lastPrice !== null) {
        console.log(`✅ CROSSMALL販売情報取得成功: ${itemCode} - ¥${lastPrice}, ${salesCount}個販売`);
      } else {
        console.log(`⚠️ CROSSMALL販売実績なし: ${itemCode}`);
      }

      return { lastPrice, salesCount };
    } catch (error) {
      console.error(`❌ CROSSMALL販売価格取得エラー: ${itemCode}`, error.message);
      return { lastPrice: null, salesCount: 0 };
    }
  }

  /**
   * 在庫数と最後に売れた金額を同時に取得
   */
  async getStockAndPrice(itemCode, days = 28) {
    try {
      console.log(`🔍 CROSSMALL在庫・販売価格取得開始: ${itemCode}`);

      // 在庫情報を取得
      const stockInfo = await this.getStockInfo(itemCode);

      // 販売価格・販売個数を取得
      const { lastPrice, salesCount } = await this.getLastSalePriceAndCount(itemCode, days);

      if (!stockInfo && lastPrice === null) {
        console.log(`⚠️ CROSSMALL情報なし: ${itemCode}`);
        return null;
      }

      const result = {
        item_code: itemCode,
        stock: stockInfo?.stock || 0,
        price: lastPrice,
        sales28: salesCount,
        item_name: stockInfo?.item_name || null
      };

      console.log(`✅ CROSSMALL取得完了: ${itemCode} - 在庫: ${result.stock}, 販売価格: ¥${result.price || 'N/A'}, 28日販売: ${result.sales28}個`);

      return result;
    } catch (error) {
      console.error(`❌ CROSSMALL取得エラー: ${itemCode}`, error.message);
      return null;
    }
  }
  /**
   * 全注文から全SKUの最新販売価格＋配送種別をまとめて取得
   * @param {number} days - 過去何日間を対象にするか
   * @returns {Map<string, { price: number, orderNumber: string, deliveryType: string }>}
   */
  async getAllLastSalePrices(days = 90) {
    console.log(`🔍 CROSSMALL 全SKU販売価格一括取得開始 (過去${days}日間)`);

    const { orderNumbers, orderMetaMap } = await this.getOrderNumbers(days);
    if (orderNumbers.length === 0) {
      console.log('⚠️ 該当期間に注文なし');
      return new Map();
    }

    // 全注文の詳細を取得して、SKUごとに最新価格を記録
    // orderNumbersは昇順（古い順）なので、後のものが新しい
    const priceMap = new Map();
    let processed = 0;

    for (const orderNumber of orderNumbers) {
      const details = await this.getOrderDetail(orderNumber);
      const meta = orderMetaMap.get(orderNumber);

      for (const d of details) {
        if (d.item_code && d.unit_price > 0) {
          priceMap.set(d.item_code, {
            price: d.unit_price,
            orderNumber: d.order_number,
            deliveryType: meta?.deliveryType || ''
          });
        }
      }
      processed++;
      if (processed % 50 === 0) {
        console.log(`  ${processed}/${orderNumbers.length} 注文処理済み`);
      }
      await new Promise(r => setTimeout(r, 30));
    }

    console.log(`✅ 全SKU販売価格取得完了: ${priceMap.size}種類のSKU`);
    return priceMap;
  }
}

module.exports = CrossmallService;