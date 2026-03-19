// server/services/LineNotificationService.js  ← 既存ファイルに対する差分（修正版）
//
// 変更箇所サマリー:
//   ① notifyPurchaseAlert() を新規追加（仕入れ推奨アラート送信）
//   ② buildPurchaseAlertText() を新規追加（テキスト組み立て）
//   ③ 既存 notifyNewProducts() と createProductListMessage() はそのまま保持
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CrossmallService = require('./CrossmallService');

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

    try {
      this.crossmall = new CrossmallService();
    } catch (e) {
      console.warn('⚠️ CrossmallService 初期化に失敗:', e?.message || e);
      this.crossmall = null;
    }

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

  // ② 新規: 通知テキスト組み立て
  buildPurchaseAlertText(params) {
    const { product, master, expiryMonths, hoursOld, stockDisplay, rarity } = params;

    const price         = Number(product?.price) || 0;
    const purchaseLimit = master?.purchaseLimit   != null ? `¥${Math.round(Number(master.purchaseLimit)).toLocaleString()}` : '─';
    const stockText     = stockDisplay            != null ? `${stockDisplay}個` : '─';

    // 賞味期限テキスト
    let expiryText = '❓期限不明';
    if (expiryMonths !== null) {
      const now = new Date();
      const expYear  = now.getFullYear() + Math.floor((now.getMonth() + expiryMonths) / 12);
      const expMonth = ((now.getMonth() + expiryMonths) % 12) + 1;
      expiryText = `${expYear}年${expMonth}月（残${expiryMonths}ヶ月）✅`;
    }

    // 出品経過時間テキスト
    let timeText;
    if (hoursOld < 1) {
      timeText = `${Math.round(hoursOld * 60)}分前 🔥`;
    } else if (hoursOld < 24) {
      timeText = `${Math.floor(hoursOld)}時間前`;
    } else {
      timeText = `${Math.floor(hoursOld / 24)}日前`;
    }

    // 希少度テキスト
    const rarityText = rarity ? `${rarity.emoji} ${rarity.label}` : '─';

    const lines = [
      '🛒 仕入れ推奨アラート',
      `【商品名】${product?.title || '─'}`,
      `【価格】¥${price.toLocaleString()}（送料無料）`,
      `【上限仕入価格】${purchaseLimit}`,
      `【在庫数】${stockText}`,
      `【賞味期限】${expiryText}`,
      `【出品】${timeText}`,
      `【希少度】${rarityText}`,
      `🔗 ${product?.url || '─'}`,
    ];

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
      if (keyword?.crossmall_item_code && this.crossmall) {
        try {
          crossmallInfo = await this.crossmall.getStockAndPrice(keyword.crossmall_item_code, 28);
        } catch (e) {
          console.error('❌ CROSSMALL情報取得エラー:', e?.message || e);
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

    let msg = `🆕 新商品が見つかりました！\n`;
    msg += `キーワード: "${keyword?.keyword || '（不明）'}"\n`;
    msg += `━━━━━━━━━━━━━━━━\n\n`;

    if (crossmallInfo) {
      msg += `📊 在庫情報（CROSSMALL）\n`;
      msg += `├ 商品コード: ${crossmallInfo.item_code}\n`;
      msg += `├ 残在庫数: ${crossmallInfo.stock}個\n`;
      msg += crossmallInfo.price
        ? `└ 最後に売れた金額: ¥${Number(crossmallInfo.price).toLocaleString()}\n`
        : `└ 最後に売れた金額: 販売実績なし\n`;
      msg += `\n━━━━━━━━━━━━━━━━\n\n`;
    }

    displayProducts.forEach((p, i) => {
      msg += `📦 商品 ${i + 1}\n`;
      msg += `タイトル: ${p.title}\n`;
      msg += `価格: ¥${Number(p.price || 0).toLocaleString()}\n`;
      msg += `🔗 ${p.url}\n`;
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
