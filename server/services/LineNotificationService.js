// server/services/LineNotificationService.js  ← 既存ファイルに対する差分（修正版）
//
// 変更箇所サマリー:
//   ① notifyPurchaseAlert() を新規追加（仕入れ推奨アラート送信）
//   ② buildPurchaseAlertText() を新規追加（テキスト組み立て）
//   ③ 既存 notifyNewProducts() と createProductListMessage() はそのまま保持
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CrossmallDbService = require('./CrossmallDbService');

// 送料辞書（CROSSMALL delivery_type_name → 送料）
const SHIPPING_COST_MAP = {
  '宅配便(日本郵便 楽天倉庫出荷)': 620,
  '追跡可能メール便(日本郵便)': 220,
  'メール便(日本郵便)': 340,
  '宅配便(佐川急便)': 550,
};
const DEFAULT_SHIPPING_COST = 620;

/**
 * 配送種別から送料を取得
 */
function getShippingCost(deliveryType) {
  if (!deliveryType) return DEFAULT_SHIPPING_COST;
  return SHIPPING_COST_MAP[deliveryType] ?? DEFAULT_SHIPPING_COST;
}

/**
 * 利益計算: 直近販売価格 × 0.9 − 送料 − フリマ出品価格
 */
function calcProfit(lastSalePrice, shippingCost, fleaMarketPrice) {
  return Math.round(lastSalePrice * 0.9 - shippingCost - fleaMarketPrice);
}

class LineNotificationService {
  constructor() {
    this.config = {
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
      channelSecret:      process.env.LINE_CHANNEL_SECRET,
      defaultGroupId:     (process.env.LINE_GROUP_ID || '').trim(),
      notifyEnabled:      (process.env.LINE_NOTIFY_ENABLED || 'true') === 'true',
    };

    this._client        = null;
    this._clientPromise = null;

    if (!this.config.channelAccessToken || !this.config.channelSecret) {
      console.warn('⚠️ LINE認証情報が未設定です（LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET）');
    } else {
      console.log('✅ LINE Messaging API 設定を検出（clientは遅延初期化）');
    }
  }

  // ─────────────────────────────────────────────
  // クライアント初期化（既存・変更なし）
  // ─────────────────────────────────────────────
  async getClient() {
    if (this._client) return this._client;
    if (this._clientPromise) return (this._client = await this._clientPromise);

    this._clientPromise = (async () => {
      if (!this.config.channelAccessToken || !this.config.channelSecret) {
        throw new Error('LINE認証情報が未設定です');
      }
      const sdkModule = await import('@line/bot-sdk');
      const sdk = sdkModule?.default || sdkModule;
      const MessagingApiClient = sdk?.messagingApi?.MessagingApiClient;
      if (!MessagingApiClient) {
        throw new Error('MessagingApiClient が見つかりません（@line/bot-sdk 形式変更の可能性）');
      }
      const client = new MessagingApiClient({
        channelAccessToken: this.config.channelAccessToken,
      });
      console.log('✅ LINE Messaging API クライアント初期化完了（遅延）');
      return client;
    })();

    return (this._client = await this._clientPromise);
  }

  resolveTargetId(targetId) {
    const fromArg = typeof targetId === 'string' ? targetId.trim() : '';
    if (fromArg) return fromArg;
    return this.config.defaultGroupId || '';
  }

  // ─────────────────────────────────────────────
  // ① 新規: 仕入れ推奨アラート通知（1商品1メッセージ）
  // ─────────────────────────────────────────────

  /**
   * Layer A を通過した商品を仕入れ推奨アラートとして通知する
   * @param {string} targetId - LINE グループ ID
   * @param {object} params
   * @param {object} params.product      - 商品オブジェクト（title, price, url）
   * @param {object} params.keyword      - キーワードDBレコード
   * @param {object|null} params.master  - PurchaseMasterCacheのアイテム（purchaseLimit, stock, sales28）
   * @param {object|null} params.crossmallInfo - CrossmallService の結果
   * @param {number|null} params.expiryMonths  - 賞味期限残存月数（null=不明）
   * @param {number}      params.hoursOld      - 出品経過時間（時間）
   * @param {number|null} params.stockDisplay  - 表示用在庫数
   * @param {{ label: string, emoji: string }} params.rarity - 希少度
   */
  async notifyPurchaseAlert(targetId, params) {
    if (!this.config.notifyEnabled) {
      console.log('ℹ️ LINE通知は無効化されています（LINE_NOTIFY_ENABLED=false）');
      return false;
    }

    const to = this.resolveTargetId(targetId);
    if (!to) {
      console.warn('⚠️ LINE送信先が未設定です（LINE_GROUP_ID を .env に設定してください）');
      return false;
    }

    const text = this.buildPurchaseAlertText(params);

    try {
      const client = await this.getClient();
      await client.pushMessage({
        to,
        messages: [{ type: 'text', text }],
      });
      console.log(`✅ 仕入れ推奨アラート送信完了: "${params.product?.title}"`);
      await this.markProductsAsNotified([params.product]);
      return true;
    } catch (error) {
      console.error('❌ LINE通知送信エラー:', error);
      if (error?.body)   console.error('   LINE error body:', error.body);
      if (error?.status) console.error('   status:', error.status);
      return false;
    }
  }

  // ② 通知テキスト組み立て
  buildPurchaseAlertText(params) {
    const { product, master, crossmallInfo, hoursOld } = params;

    const price         = Number(product?.price) || 0;
    const stock         = crossmallInfo?.stock  != null ? crossmallInfo.stock : (master?.stock ?? null);
    // sales28: CROSSMALL APIが0を返す場合はマスターキャッシュにフォールバック
    const sales28       = (crossmallInfo?.sales28 != null && crossmallInfo.sales28 > 0)
      ? crossmallInfo.sales28
      : (master?.sales28 ?? crossmallInfo?.sales28 ?? null);
    const sales7        = master?.sales7 ?? null;
    const lastSaleDate  = master?.lastSaleDate ?? null;
    const lastSalePrice = crossmallInfo?.price  != null ? Number(crossmallInfo.price)
                        : master?.lastSalePrice != null ? Number(master.lastSalePrice)
                        : null;

    // 最終販売日の表示フォーマット (YYYY-MM-DD → M/D)
    const lastSaleDateDisp = lastSaleDate ? lastSaleDate.replace(/^\d{4}-0?(\d+)-0?(\d+)$/, '$1/$2') : '─';

    // 送料・利益見込み計算
    const deliveryType  = crossmallInfo?.deliveryType || master?.deliveryType || '';
    const shippingCost  = getShippingCost(deliveryType);
    // 上限仕入: 3000円以下は300円固定利益、3000円超は利益率12%確保
    let purchaseLimit = null;
    if (lastSalePrice != null) {
      if (lastSalePrice <= 3000) {
        purchaseLimit = Math.round(lastSalePrice * 0.9 - shippingCost - 300);
      } else {
        purchaseLimit = Math.round(lastSalePrice * 0.78 - shippingCost);
      }
    }

    let profitLine = '';
    if (lastSalePrice != null && price > 0) {
      const profit = calcProfit(lastSalePrice, shippingCost, price);
      const profitRate = ((profit / lastSalePrice) * 100).toFixed(1);
      const emoji = profit >= 0 ? '✅' : '⚠️';
      const sign = profit >= 0 ? '+' : '';
      profitLine = `${emoji} 利益見込み ${sign}¥${profit.toLocaleString()}（送料¥${shippingCost}）利益率${profitRate}%`;
    }

    const lines = [
      `🛒 ${product?.title || '─'}`,
      `¥${price.toLocaleString()}`,
      `🔗 ${product?.url || '─'}`,
      '',
      `📦 在庫${stock != null ? stock : '─'}個 | 28日${sales28 != null ? sales28 : '─'}個 | 7日${sales7 != null ? sales7 : '─'}個 | 最終${lastSaleDateDisp}`,
      `💰 直近販売¥${lastSalePrice != null ? lastSalePrice.toLocaleString() : '─'} | 上限仕入¥${purchaseLimit != null ? Math.round(purchaseLimit).toLocaleString() : '─'}`,
    ];

    if (profitLine) {
      lines.push(profitLine);
    }

    return lines.join('\n');
  }

  // ─────────────────────────────────────────────
  // 既存メソッド（変更なし）
  // ─────────────────────────────────────────────

  async notifyNewProducts(targetId, products, keyword) {
    if (!this.config.notifyEnabled) {
      console.log('ℹ️ LINE通知は無効化されています（LINE_NOTIFY_ENABLED=false）');
      return false;
    }

    const to = this.resolveTargetId(targetId);
    if (!to) {
      console.warn('⚠️ LINE送信先が未設定です（LINE_GROUP_ID を .env に設定してください）');
      return false;
    }

    if (!Array.isArray(products) || products.length === 0) {
      console.log('📭 通知する商品がありません');
      return false;
    }

    try {
      const client = await this.getClient();

      let crossmallInfo = null;
      if (keyword?.crossmall_item_code) {
        const baseCode = CrossmallDbService.deriveBaseCode(keyword.crossmall_item_code);
        const dbInfo = await CrossmallDbService.getStockAndPriceByBaseCode(baseCode).catch(() => null);
        if (dbInfo) {
          crossmallInfo = {
            item_code:    keyword.crossmall_item_code,
            stock:        dbInfo.stock ?? null,
            price:        dbInfo.lastSalePrice ?? null,
            sales28:      dbInfo.sales28 ?? 0,
            sales7:       dbInfo.sales7  ?? 0,
            lastSaleDate: dbInfo.lastSaleDate ?? null,
            deliveryType: dbInfo.deliveryType ?? null,
            item_name:    dbInfo.item_name ?? null,
          };
        }
      }

      const message = this.createProductListMessage(products, keyword, crossmallInfo);

      await client.pushMessage({
        to,
        messages: [{ type: 'text', text: message }],
      });

      console.log(`✅ LINE通知送信完了: ${to}`);
      await this.markProductsAsNotified(products);
      return true;
    } catch (error) {
      console.error('❌ LINE通知送信エラー:', error);
      if (error?.body)   console.error('   LINE error body:', error.body);
      if (error?.status) console.error('   status:', error.status);
      return false;
    }
  }

  createProductListMessage(products, keyword, crossmallInfo) {
    const maxDisplay    = 5;
    const displayProducts = products.slice(0, maxDisplay);
    const remainingCount  = products.length - maxDisplay;

    const stock         = crossmallInfo?.stock  ?? null;
    const sales28       = crossmallInfo?.sales28 ?? null;
    const lastSalePrice = crossmallInfo?.price != null ? Number(crossmallInfo.price) : null;
    const deliveryType  = crossmallInfo?.deliveryType || '';
    const shippingCost = getShippingCost(deliveryType);

    let msg = `🆕 "${keyword?.keyword || '（不明）'}" の新着\n`;
    msg += `━━━━━━━━━━━━━━━━\n\n`;

    displayProducts.forEach((p, i) => {
      const price    = Number(p.price || 0);
      const platform = p.platform || p.source || '─';

      msg += `🛒 ${p.title}\n`;
      msg += `¥${price.toLocaleString()}\n`;
      msg += `📍 ${platform}\n`;
      msg += `🔗 ${p.url}\n`;

      if (crossmallInfo) {
        const dispStock   = stock ?? null;
        const dispSales   = sales28 ?? null;
        const dispSales7  = crossmallInfo?.sales7 ?? null;
        const dispLastDate = crossmallInfo?.lastSaleDate
          ? crossmallInfo.lastSaleDate.replace(/^\d{4}-0?(\d+)-0?(\d+)$/, '$1/$2') : '─';
        msg += `📦 在庫${dispStock != null ? dispStock : '─'}個 | 28日${dispSales != null ? dispSales : '─'}個 | 7日${dispSales7 != null ? dispSales7 : '─'}個 | 最終${dispLastDate}\n`;
        msg += `💰 直近販売¥${lastSalePrice != null ? lastSalePrice.toLocaleString() : '─'}\n`;
        if (lastSalePrice != null && price > 0) {
          const profit = calcProfit(lastSalePrice, shippingCost, price);
          const profitRate = ((profit / lastSalePrice) * 100).toFixed(1);
          const emoji = profit >= 0 ? '✅' : '⚠️';
          const sign = profit >= 0 ? '+' : '';
          msg += `${emoji} 利益見込み ${sign}¥${profit.toLocaleString()}（送料¥${shippingCost}）利益率${profitRate}%\n`;
        }
      }

      if (i < displayProducts.length - 1) msg += `\n―――――――――――――――\n\n`;
    });

    if (remainingCount > 0) msg += `\n\n他に ${remainingCount} 件の新着商品があります`;
    return msg;
  }

  async markProductsAsNotified(products) {
    try {
      const { Product } = require('../models');
      const ids = products.map((p) => p.id).filter(Boolean);
      if (ids.length === 0) return;
      await Product.update({ is_notified: true }, { where: { id: ids } });
      console.log(`✅ ${ids.length} 件の商品を通知済みに更新しました`);
    } catch (e) {
      console.error('❌ 通知済み更新エラー:', e);
    }
  }
}

module.exports = new LineNotificationService();
