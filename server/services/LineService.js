// server/services/LineService.js
const line = require('@line/bot-sdk');

class LineService {
  constructor() {
    this.client = null;
    this.initialize();
  }

  /**
   * LINE Messaging API クライアント初期化
   */
  initialize() {
    const config = {
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
      channelSecret: process.env.LINE_CHANNEL_SECRET || ''
    };

    // トークンが設定されている場合のみクライアントを初期化
    if (config.channelAccessToken && config.channelSecret) {
      try {
        this.client = new line.messagingApi.MessagingApiClient(config);
        console.log('✅ LINE Messaging API クライアント初期化完了');
      } catch (error) {
        console.error('❌ LINE Messaging API クライアント初期化エラー:', error.message);
        this.client = null;
      }
    } else {
      console.warn('⚠️  LINE認証情報が設定されていません（.envを確認してください）');
      this.client = null;
    }
  }

  /**
   * メッセージ送信
   * @param {string} userId - LINE User ID
   * @param {string} message - 送信メッセージ
   */
  async sendMessage(userId, message) {
    if (!this.client) {
      console.warn('⚠️  LINE クライアントが初期化されていません');
      return false;
    }

    try {
      await this.client.pushMessage({
        to: userId,
        messages: [
          {
            type: 'text',
            text: message
          }
        ]
      });
      console.log(`✅ LINE メッセージ送信成功: ${userId}`);
      return true;
    } catch (error) {
      console.error('❌ LINE メッセージ送信エラー:', error.message);
      return false;
    }
  }

  /**
   * リッチメッセージ送信
   * @param {string} userId - LINE User ID
   * @param {Array} messages - メッセージ配列
   */
  async sendMessages(userId, messages) {
    if (!this.client) {
      console.warn('⚠️  LINE クライアントが初期化されていません');
      return false;
    }

    try {
      await this.client.pushMessage({
        to: userId,
        messages: messages
      });
      console.log(`✅ LINE メッセージ送信成功: ${userId}`);
      return true;
    } catch (error) {
      console.error('❌ LINE メッセージ送信エラー:', error.message);
      return false;
    }
  }

  /**
   * 商品通知メッセージを作成
   * @param {Object} product - 商品情報
   * @returns {Object} LINE メッセージオブジェクト
   */
  createProductNotificationMessage(product) {
    const {
      title,
      price,
      platform,
      url,
      image_url,
      crossmall_stock_quantity
    } = product;

    const platformEmoji = {
      mercari: '🛒',
      yahoo_flea: '🏪',
      rakuma: '📦'
    };

    const emoji = platformEmoji[platform] || '🔍';
    const stockInfo = crossmall_stock_quantity !== null && crossmall_stock_quantity !== undefined
      ? `\n📊 在庫: ${crossmall_stock_quantity}個`
      : '';

    return {
      type: 'flex',
      altText: `${emoji} 新着商品: ${title}`,
      contents: {
        type: 'bubble',
        hero: image_url ? {
          type: 'image',
          url: image_url,
          size: 'full',
          aspectRatio: '20:13',
          aspectMode: 'cover',
          action: {
            type: 'uri',
            uri: url
          }
        } : undefined,
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [
            {
              type: 'text',
              text: title,
              weight: 'bold',
              size: 'lg',
              wrap: true
            },
            {
              type: 'box',
              layout: 'baseline',
              margin: 'md',
              contents: [
                {
                  type: 'text',
                  text: `¥${price.toLocaleString()}`,
                  size: 'xl',
                  color: '#FF6B6B',
                  weight: 'bold',
                  flex: 0
                }
              ]
            },
            {
              type: 'text',
              text: `${emoji} ${platform}${stockInfo}`,
              size: 'sm',
              color: '#999999',
              margin: 'md'
            }
          ]
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'primary',
              height: 'sm',
              action: {
                type: 'uri',
                label: '商品ページを開く',
                uri: url
              }
            }
          ]
        }
      }
    };
  }

  /**
   * 商品通知を送信
   * @param {string} userId - LINE User ID
   * @param {Object} product - 商品情報
   */
  async sendProductNotification(userId, product) {
    const message = this.createProductNotificationMessage(product);
    return await this.sendMessages(userId, [message]);
  }

  /**
   * 複数商品の通知を送信
   * @param {string} userId - LINE User ID
   * @param {Array} products - 商品情報配列
   */
  async sendProductNotifications(userId, products) {
    if (!products || products.length === 0) {
      return false;
    }

    // LINE は最大5件まで同時送信可能
    const messages = products.slice(0, 5).map(product => 
      this.createProductNotificationMessage(product)
    );

    return await this.sendMessages(userId, messages);
  }
}

// シングルトンインスタンスをエクスポート
module.exports = new LineService();
