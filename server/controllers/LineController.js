// server/controllers/LineController.js
const db = require('../models');
const User = db.User;
const LineLinkCode = db.LineLinkCode;

const lineService = require('../services/LineService');

function generate6DigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/**
 * LineLinkCodes テーブルに user_id カラムが無い環境でも落ちないように、
 * SELECTするカラムを明示して user_id を読みに行かないようにする。
 */
const SAFE_LINE_LINKCODE_ATTRS = [
  'id',
  'line_user_id',
  'link_code',
  'is_used',
  'expires_at',
  'created_at',
  'updated_at'
];

const lineController = {
  /**
   * LINE Webhook受信
   */
  async webhook(req, res) {
    try {
      const events = req.body.events;

      for (const event of events) {
        if (event.type === 'follow') {
          await handleFollow(event);
        } else if (event.type === 'message' && event.message.type === 'text') {
          await handleMessage(event);
        }
      }

      return res.status(200).send('OK');
    } catch (error) {
      console.error('❌ LINE Webhook エラー:', error);
      return res.status(500).send('Internal Server Error');
    }
  },

  /**
   * LINE連携コード検証と紐付け
   */
  async linkAccount(req, res) {
    try {
      const { link_code } = req.body;
      const userId = req.user.id;

      if (!link_code || String(link_code).length !== 6) {
        return res.status(400).json({
          success: false,
          error: '6桁の連携コードを入力してください'
        });
      }

      // 連携コード検索（user_id を SELECT しない）
      const linkCodeRecord = await LineLinkCode.findOne({
        attributes: SAFE_LINE_LINKCODE_ATTRS,
        where: { link_code: String(link_code), is_used: false }
      });

      if (!linkCodeRecord) {
        return res.status(404).json({
          success: false,
          error: '連携コードが見つかりません。コードを確認してください。'
        });
      }

      // 有効期限チェック（モデル側に isExpired がある前提：元コード踏襲）
      if (typeof linkCodeRecord.isExpired === 'function' && linkCodeRecord.isExpired()) {
        return res.status(400).json({
          success: false,
          error: '連携コードの有効期限が切れています。もう一度友だち追加してください。'
        });
      }

      // ユーザー更新
      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'ユーザーが見つかりません'
        });
      }

      user.line_user_id = linkCodeRecord.line_user_id;
      await user.save();

      // 連携コードを使用済みに
      // user_id カラムがDBに無くても、ここは is_used の更新だけなのでOK
      linkCodeRecord.is_used = true;
      await linkCodeRecord.save();

      // dev検証のときはLINE送信をスキップ（確実に連携完了まで進める）
      if (!String(linkCodeRecord.line_user_id || '').startsWith('dev-')) {
        await lineService.sendMessage(
          linkCodeRecord.line_user_id,
          '✅ アカウント連携が完了しました！\n今後、商品通知がこちらに届きます。'
        );
      }

      return res.json({
        success: true,
        message: 'LINE連携が完了しました',
        data: { line_user_id: linkCodeRecord.line_user_id }
      });
    } catch (error) {
      console.error('❌ LINE連携エラー:', error);
      return res.status(500).json({
        success: false,
        error: 'LINE連携に失敗しました'
      });
    }
  },

  /**
   * （開発用）ログイン中ユーザー向けに6桁の連携コードを発行
   * - ローカル環境でWebhook無しで「連携」機能を検証するため
   * - 本番環境では無効化（404）
   *
   * @route POST /api/line/dev/generate-code
   * @access Private
   */
  async generateDevLinkCode(req, res) {
    try {
      if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ success: false, error: 'Not Found' });
      }

      // モデル未登録ならここで即わかる
      if (!LineLinkCode) {
        return res.status(500).json({
          success: false,
          error: 'LineLinkCode model is not registered in server/models/index.js'
        });
      }

      const userId = req.user.id;

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'ユーザーが見つかりません'
        });
      }

      const linkCode = generate6DigitCode();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const pseudoLineUserId = `dev-${userId}`;

      await LineLinkCode.create({
        line_user_id: pseudoLineUserId,
        link_code: linkCode,
        expires_at: expiresAt,
        is_used: false
      });

      return res.json({
        success: true,
        message: '開発用連携コードを発行しました',
        data: {
          link_code: linkCode,
          expires_at: expiresAt
        }
      });
    } catch (error) {
      console.error('❌ dev連携コード発行エラー:', error);
      return res.status(500).json({
        success: false,
        error: '開発用連携コードの発行に失敗しました'
      });
    }
  }
};

async function handleFollow(event) {
  const lineUserId = event.source.userId;
  console.log('✅ 友だち追加:', lineUserId);

  const linkCode = generate6DigitCode();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await LineLinkCode.create({
    line_user_id: lineUserId,
    link_code: linkCode,
    expires_at: expiresAt,
    is_used: false
  });

  const message = `🎉 ピコフリへようこそ！

以下の6桁の連携コードをWebサイトの設定画面で入力してください。

【連携コード】
${linkCode}

※ このコードは24時間有効です
※ 連携が完了すると、商品通知がこちらに届きます`;

  await lineService.sendMessage(lineUserId, message);
}

async function handleMessage(event) {
  const lineUserId = event.source.userId;
  const messageText = event.message.text;

  console.log('📩 メッセージ受信:', lineUserId, messageText);

  if (messageText === 'ヘルプ' || messageText === 'help') {
    const helpMessage = `📖 ヘルプ

【コマンド】
・ヘルプ: このメッセージを表示
・連携コード: 新しい連携コードを発行

【お問い合わせ】
https://your-website.com/contact`;

    await lineService.sendMessage(lineUserId, helpMessage);
  } else if (messageText === '連携コード') {
    const linkCode = generate6DigitCode();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await LineLinkCode.create({
      line_user_id: lineUserId,
      link_code: linkCode,
      expires_at: expiresAt,
      is_used: false
    });

    const message = `【連携コード】
${linkCode}

※ このコードは24時間有効です`;

    await lineService.sendMessage(lineUserId, message);
  }
}

module.exports = lineController;
