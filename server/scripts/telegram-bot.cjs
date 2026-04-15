'use strict';

/**
 * ピコフリ Telegram Bot - キーワード管理
 *
 * 機能:
 *   - キーワード一覧表示
 *   - キーワード追加（対話式）
 *   - キーワード削除（対話式）
 *   - 除外キーワード設定（対話式）
 *   - システムステータス表示
 *
 * 起動:
 *   node server/scripts/telegram-bot.cjs
 */

const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// .env を server/.env から読み込む
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// CWD を server/ に変更 → database.sqlite の相対パスが正しく解決される
process.chdir(path.join(__dirname, '..'));

const TelegramBot = require('node-telegram-bot-api');
const db = require('../models');
const { sequelize, Keyword, Product, User } = db;
const InventoryAlertService = require('../services/InventoryAlertService');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 設定
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID
  ? parseInt(process.env.TELEGRAM_ADMIN_ID, 10)
  : null;

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN が .env に設定されていません');
  process.exit(1);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Bot 初期化
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// 会話状態管理（Telegram UserID → state object）
const userStates = new Map();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 共通キーボード
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MAIN_KEYBOARD = {
  reply_markup: {
    keyboard: [
      [{ text: '📋 一覧' }, { text: '➕ 追加' }],
      [{ text: '🗑 削除' }, { text: '🚫 除外設定' }],
      [{ text: '💰 価格設定' }, { text: '📦 在庫' }, { text: '📊 ステータス' }]
    ],
    resize_keyboard: true,
    persistent: true
  }
};

/**
 * メインキーボード付きメッセージ送信
 */
async function replyWithKeyboard(chatId, text) {
  await bot.sendMessage(chatId, text, MAIN_KEYBOARD);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DB ヘルパー
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 既存キーワードまたはユーザーから user_id を取得
 */
async function getDefaultUserId() {
  const kw = await Keyword.findOne();
  if (kw) return kw.user_id;
  const user = await User.findOne();
  if (user) return user.id;
  return null;
}

/**
 * キーワード1件を表示用文字列に変換
 */
function formatKeyword(kw, index) {
  const minPrice = kw.min_price !== null && parseFloat(kw.min_price) > 0
    ? `¥${parseInt(kw.min_price).toLocaleString()}`
    : 'なし';
  const maxPrice = kw.max_price !== null && parseFloat(kw.max_price) > 0
    ? `¥${parseInt(kw.max_price).toLocaleString()}`
    : 'なし';
  const sku = kw.crossmall_item_code || 'なし';
  const excludes = kw.exclude_keywords
    ? kw.exclude_keywords.split(',').map(s => s.trim()).filter(Boolean).join(', ')
    : 'なし';
  return `${index + 1}. ${kw.keyword}\n   SKU: ${sku} | 最低: ${minPrice} | 上限: ${maxPrice}\n   除外: ${excludes}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// メッセージハンドラ
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = (msg.text || '').trim();

  console.log(`[受信] from=${userId} chat=${chatId} text="${text}"`);

  // TELEGRAM_ADMIN_ID 未設定: 最初のメッセージで ID を案内
  if (!ADMIN_ID) {
    await bot.sendMessage(
      chatId,
      `あなたのTelegram IDは ${userId} です。\n.envのTELEGRAM_ADMIN_IDにこの値を設定してください`
    );
    return;
  }

  // 認可チェック
  if (userId !== ADMIN_ID) return;

  // キャンセル
  if (text === '❌ キャンセル' || text === '/cancel') {
    userStates.delete(userId);
    await replyWithKeyboard(chatId, 'キャンセルしました');
    return;
  }

  // /start
  if (text === '/start') {
    userStates.delete(userId);
    await replyWithKeyboard(chatId, 'ピコフリ管理Bot へようこそ！\n操作を選択してください。');
    return;
  }

  // メインメニューボタン（フロー中でも割り込み可能 → 状態リセット）
  if (text === '📋 一覧') {
    userStates.delete(userId);
    await handleList(chatId);
    return;
  }
  if (text === '➕ 追加') {
    userStates.delete(userId);
    await handleAddStart(chatId, userId);
    return;
  }
  if (text === '🗑 削除') {
    userStates.delete(userId);
    await handleDeleteStart(chatId);
    return;
  }
  if (text === '🚫 除外設定') {
    userStates.delete(userId);
    await handleExcludeStart(chatId);
    return;
  }
  if (text === '💰 価格設定') {
    userStates.delete(userId);
    await handlePriceStart(chatId);
    return;
  }
  if (text === '📦 在庫') {
    userStates.delete(userId);
    await handleInventory(chatId);
    return;
  }
  if (text === '📊 ステータス') {
    userStates.delete(userId);
    await handleStatus(chatId);
    return;
  }

  // 会話フロー中の入力処理
  const state = userStates.get(userId);
  if (state) {
    await handleStateFlow(chatId, userId, text, state);
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// コールバッククエリハンドラ（InlineKeyboard）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  await bot.answerCallbackQuery(query.id);

  if (!ADMIN_ID || userId !== ADMIN_ID) return;

  const state = userStates.get(userId) || { step: 'idle' };

  // ─── 追加フロー ───
  if (data === 'skip_sku') {
    userStates.set(userId, { ...state, sku: null, step: 'add_price' });
    await bot.sendMessage(chatId, '最低価格を入力してください（例: 1500）', {
      reply_markup: {
        inline_keyboard: [[{ text: '⏭ スキップ（制限なし）', callback_data: 'skip_price' }]]
      }
    });

  } else if (data === 'skip_price') {
    userStates.set(userId, { ...state, price: null, step: 'add_max_price' });
    await bot.sendMessage(chatId, '上限価格を入力してください（例: 5000）\nこの価格を超える出品は通知されません', {
      reply_markup: {
        inline_keyboard: [[{ text: '⏭ スキップ（制限なし）', callback_data: 'skip_max_price' }]]
      }
    });

  } else if (data === 'skip_max_price') {
    userStates.set(userId, { ...state, max_price: null, step: 'add_confirm' });
    await showAddConfirm(chatId, userId);

  } else if (data === 'add_confirm') {
    await handleAddConfirm(chatId, userId);

  // ─── 削除フロー ───
  } else if (data.startsWith('delete_select_')) {
    const kwId = data.slice('delete_select_'.length);
    await handleDeleteSelect(chatId, kwId);

  } else if (data.startsWith('delete_confirm_')) {
    const kwId = data.slice('delete_confirm_'.length);
    await handleDeleteConfirm(chatId, kwId);

  // ─── 除外設定フロー ───
  } else if (data.startsWith('exclude_select_')) {
    const kwId = data.slice('exclude_select_'.length);
    await handleExcludeSelect(chatId, userId, kwId);

  } else if (data.startsWith('exclude_clear_')) {
    const kwId = data.slice('exclude_clear_'.length);
    userStates.delete(userId);
    await handleExcludeClear(chatId, kwId);

  // ─── 価格設定フロー ───
  } else if (data.startsWith('setprice_')) {
    const kwId = data.slice('setprice_'.length);
    await handleSetPriceSelect(chatId, userId, kwId);

  } else if (data.startsWith('editmin_')) {
    const kwId = data.slice('editmin_'.length);
    userStates.set(userId, { step: 'edit_price', editTarget: 'min_price', keywordId: kwId });
    await bot.sendMessage(chatId, '新しい最低価格を入力してください（例: 1500）', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🗑 削除（制限なし）', callback_data: `clearprice_min_${kwId}` }],
          [{ text: '❌ キャンセル', callback_data: 'cancel' }]
        ]
      }
    });

  } else if (data.startsWith('editmax_')) {
    const kwId = data.slice('editmax_'.length);
    userStates.set(userId, { step: 'edit_price', editTarget: 'max_price', keywordId: kwId });
    await bot.sendMessage(chatId, '新しい上限価格を入力してください（例: 5000）', {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🗑 削除（制限なし）', callback_data: `clearprice_max_${kwId}` }],
          [{ text: '❌ キャンセル', callback_data: 'cancel' }]
        ]
      }
    });

  } else if (data.startsWith('clearprice_min_')) {
    const kwId = data.slice('clearprice_min_'.length);
    userStates.delete(userId);
    await handleClearPrice(chatId, kwId, 'min_price');

  } else if (data.startsWith('clearprice_max_')) {
    const kwId = data.slice('clearprice_max_'.length);
    userStates.delete(userId);
    await handleClearPrice(chatId, kwId, 'max_price');

  // ─── 汎用キャンセル ───
  } else if (data === 'cancel') {
    userStates.delete(userId);
    await replyWithKeyboard(chatId, 'キャンセルしました');
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📋 一覧
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function handleList(chatId) {
  try {
    const keywords = await Keyword.findAll({
      where: { is_active: true },
      order: [['created_at', 'ASC']]
    });

    if (keywords.length === 0) {
      await replyWithKeyboard(chatId, '登録されているキーワードはありません');
      return;
    }

    const lines = keywords.map((kw, i) => formatKeyword(kw, i));
    const text = `📋 監視キーワード一覧（${keywords.length}件）\n\n${lines.join('\n\n')}`;
    await replyWithKeyboard(chatId, text);
  } catch (err) {
    console.error('[telegram-bot] 一覧取得エラー:', err.message);
    await replyWithKeyboard(chatId, `❌ エラー: ${err.message}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ➕ 追加フロー
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function handleAddStart(chatId, userId) {
  userStates.set(userId, { step: 'add_keyword' });
  await bot.sendMessage(chatId, 'キーワードを入力してください');
}

async function handleStateFlow(chatId, userId, text, state) {
  if (state.step === 'add_keyword') {
    userStates.set(userId, { ...state, keyword: text, step: 'add_sku' });
    await bot.sendMessage(chatId, '商品コード（SKU）を入力してください', {
      reply_markup: {
        inline_keyboard: [[{ text: '⏭ スキップ（SKUなし）', callback_data: 'skip_sku' }]]
      }
    });

  } else if (state.step === 'add_sku') {
    userStates.set(userId, { ...state, sku: text, step: 'add_price' });
    await bot.sendMessage(chatId, '最低価格を入力してください（例: 1500）', {
      reply_markup: {
        inline_keyboard: [[{ text: '⏭ スキップ（制限なし）', callback_data: 'skip_price' }]]
      }
    });

  } else if (state.step === 'add_price') {
    const price = parseInt(text, 10);
    if (isNaN(price) || price < 0) {
      await bot.sendMessage(chatId, '数値を入力してください（例: 1500）', {
        reply_markup: {
          inline_keyboard: [[{ text: '⏭ スキップ（制限なし）', callback_data: 'skip_price' }]]
        }
      });
      return;
    }
    userStates.set(userId, { ...state, price, step: 'add_max_price' });
    await bot.sendMessage(chatId, '上限価格を入力してください（例: 5000）\nこの価格を超える出品は通知されません', {
      reply_markup: {
        inline_keyboard: [[{ text: '⏭ スキップ（制限なし）', callback_data: 'skip_max_price' }]]
      }
    });

  } else if (state.step === 'add_max_price') {
    const maxPrice = parseInt(text, 10);
    if (isNaN(maxPrice) || maxPrice < 0) {
      await bot.sendMessage(chatId, '数値を入力してください（例: 5000）', {
        reply_markup: {
          inline_keyboard: [[{ text: '⏭ スキップ（制限なし）', callback_data: 'skip_max_price' }]]
        }
      });
      return;
    }
    userStates.set(userId, { ...state, max_price: maxPrice, step: 'add_confirm' });
    await showAddConfirm(chatId, userId);

  } else if (state.step === 'exclude_input') {
    await handleExcludeInput(chatId, userId, text, state);

  } else if (state.step === 'edit_price') {
    await handleEditPriceInput(chatId, userId, text, state);
  }
}

async function showAddConfirm(chatId, userId) {
  const state = userStates.get(userId);
  const priceText = state.price != null ? `¥${state.price.toLocaleString()}` : 'なし';
  const maxPriceText = state.max_price != null ? `¥${state.max_price.toLocaleString()}` : 'なし';
  const skuText = state.sku || 'なし';

  const confirmText =
    `以下の内容で追加しますか？\n` +
    `キーワード: ${state.keyword}\n` +
    `商品コード: ${skuText}\n` +
    `最低価格: ${priceText}\n` +
    `上限価格: ${maxPriceText}\n` +
    `監視: メルカリ + Yahoo`;

  await bot.sendMessage(chatId, confirmText, {
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ 追加する', callback_data: 'add_confirm' },
        { text: '❌ キャンセル', callback_data: 'cancel' }
      ]]
    }
  });
}

async function handleAddConfirm(chatId, userId) {
  const state = userStates.get(userId);
  userStates.delete(userId);

  if (!state || !state.keyword) {
    await replyWithKeyboard(chatId, '❌ セッションが切れました。最初からやり直してください');
    return;
  }

  try {
    const dbUserId = await getDefaultUserId();
    if (!dbUserId) {
      await replyWithKeyboard(chatId, '❌ ユーザーが見つかりません。先にシステムをセットアップしてください');
      return;
    }

    await Keyword.create({
      user_id: dbUserId,
      keyword: state.keyword,
      crossmall_item_code: state.sku || null,
      min_price: state.price != null ? state.price : null,
      max_price: state.max_price != null ? state.max_price : null,
      platforms: JSON.stringify(['mercari', 'yahoo_flea']),
      is_active: true
    });

    await replyWithKeyboard(chatId, `✅ キーワード追加完了\n「${state.keyword}」を登録しました`);
  } catch (err) {
    console.error('[telegram-bot] キーワード追加エラー:', err.message);
    await replyWithKeyboard(chatId, `❌ エラー: ${err.message}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🗑 削除フロー
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function handleDeleteStart(chatId) {
  try {
    const keywords = await Keyword.findAll({
      where: { is_active: true },
      order: [['created_at', 'ASC']]
    });

    if (keywords.length === 0) {
      await replyWithKeyboard(chatId, '登録されているキーワードはありません');
      return;
    }

    const buttons = keywords.map(kw => [
      { text: kw.keyword, callback_data: `delete_select_${kw.id}` }
    ]);
    buttons.push([{ text: '❌ キャンセル', callback_data: 'cancel' }]);

    await bot.sendMessage(chatId, '削除するキーワードを選択してください:', {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (err) {
    console.error('[telegram-bot] 削除一覧取得エラー:', err.message);
    await replyWithKeyboard(chatId, `❌ エラー: ${err.message}`);
  }
}

async function handleDeleteSelect(chatId, kwId) {
  try {
    const kw = await Keyword.findByPk(kwId);
    if (!kw) {
      await replyWithKeyboard(chatId, '❌ キーワードが見つかりません');
      return;
    }

    await bot.sendMessage(chatId, `「${kw.keyword}」を削除しますか？`, {
      reply_markup: {
        inline_keyboard: [[
          { text: '🗑 削除する', callback_data: `delete_confirm_${kwId}` },
          { text: '❌ キャンセル', callback_data: 'cancel' }
        ]]
      }
    });
  } catch (err) {
    console.error('[telegram-bot] 削除選択エラー:', err.message);
    await replyWithKeyboard(chatId, `❌ エラー: ${err.message}`);
  }
}

async function handleDeleteConfirm(chatId, kwId) {
  try {
    const kw = await Keyword.findByPk(kwId);
    if (!kw) {
      await replyWithKeyboard(chatId, '❌ キーワードが見つかりません');
      return;
    }
    const kwName = kw.keyword;
    await kw.destroy();
    await replyWithKeyboard(chatId, `✅ 「${kwName}」を削除しました`);
  } catch (err) {
    console.error('[telegram-bot] 削除確認エラー:', err.message);
    await replyWithKeyboard(chatId, `❌ エラー: ${err.message}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🚫 除外設定フロー
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function handleExcludeStart(chatId) {
  try {
    const keywords = await Keyword.findAll({
      where: { is_active: true },
      order: [['created_at', 'ASC']]
    });

    if (keywords.length === 0) {
      await replyWithKeyboard(chatId, '登録されているキーワードはありません');
      return;
    }

    const buttons = keywords.map(kw => [
      { text: kw.keyword, callback_data: `exclude_select_${kw.id}` }
    ]);
    buttons.push([{ text: '❌ キャンセル', callback_data: 'cancel' }]);

    await bot.sendMessage(chatId, '除外設定するキーワードを選択してください:', {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (err) {
    console.error('[telegram-bot] 除外一覧取得エラー:', err.message);
    await replyWithKeyboard(chatId, `❌ エラー: ${err.message}`);
  }
}

async function handleExcludeSelect(chatId, userId, kwId) {
  try {
    const kw = await Keyword.findByPk(kwId);
    if (!kw) {
      await replyWithKeyboard(chatId, '❌ キーワードが見つかりません');
      return;
    }

    const current = kw.exclude_keywords
      ? kw.exclude_keywords.split(',').map(s => s.trim()).filter(Boolean).join(', ')
      : 'なし';

    userStates.set(userId, { step: 'exclude_input', kwId, kwName: kw.keyword });

    await bot.sendMessage(
      chatId,
      `📌 「${kw.keyword}」の現在の除外キーワード: ${current}\n\n追加する除外キーワードを入力してください（カンマ区切りで複数可）`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🗑 除外をクリア', callback_data: `exclude_clear_${kwId}` }],
            [{ text: '❌ キャンセル', callback_data: 'cancel' }]
          ]
        }
      }
    );
  } catch (err) {
    console.error('[telegram-bot] 除外選択エラー:', err.message);
    await replyWithKeyboard(chatId, `❌ エラー: ${err.message}`);
  }
}

async function handleExcludeInput(chatId, userId, text, state) {
  userStates.delete(userId);
  try {
    const kw = await Keyword.findByPk(state.kwId);
    if (!kw) {
      await replyWithKeyboard(chatId, '❌ キーワードが見つかりません');
      return;
    }

    const newExcludes = text.split(',').map(s => s.trim()).filter(Boolean);
    const existing = kw.exclude_keywords
      ? kw.exclude_keywords.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const merged = [...new Set([...existing, ...newExcludes])];

    await kw.update({ exclude_keywords: merged.join(',') });
    await replyWithKeyboard(
      chatId,
      `✅ 「${kw.keyword}」の除外キーワードを更新しました: ${merged.join(', ')}`
    );
  } catch (err) {
    console.error('[telegram-bot] 除外入力エラー:', err.message);
    await replyWithKeyboard(chatId, `❌ エラー: ${err.message}`);
  }
}

async function handleExcludeClear(chatId, kwId) {
  try {
    const kw = await Keyword.findByPk(kwId);
    if (!kw) {
      await replyWithKeyboard(chatId, '❌ キーワードが見つかりません');
      return;
    }
    await kw.update({ exclude_keywords: null });
    await replyWithKeyboard(chatId, `✅ 「${kw.keyword}」の除外キーワードをクリアしました`);
  } catch (err) {
    console.error('[telegram-bot] 除外クリアエラー:', err.message);
    await replyWithKeyboard(chatId, `❌ エラー: ${err.message}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 💰 価格設定フロー
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function handlePriceStart(chatId) {
  try {
    const keywords = await Keyword.findAll({
      where: { is_active: true },
      order: [['created_at', 'ASC']]
    });

    if (keywords.length === 0) {
      await replyWithKeyboard(chatId, '登録されているキーワードはありません');
      return;
    }

    const buttons = keywords.map(kw => [
      { text: kw.keyword, callback_data: `setprice_${kw.id}` }
    ]);
    buttons.push([{ text: '❌ キャンセル', callback_data: 'cancel' }]);

    await bot.sendMessage(chatId, '価格設定するキーワードを選択してください:', {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (err) {
    console.error('[telegram-bot] 価格設定一覧エラー:', err.message);
    await replyWithKeyboard(chatId, `❌ エラー: ${err.message}`);
  }
}

async function handleSetPriceSelect(chatId, userId, kwId) {
  try {
    const kw = await Keyword.findByPk(kwId);
    if (!kw) {
      await replyWithKeyboard(chatId, '❌ キーワードが見つかりません');
      return;
    }

    const minText = kw.min_price != null && parseFloat(kw.min_price) > 0
      ? `¥${parseInt(kw.min_price).toLocaleString()}`
      : 'なし';
    const maxText = kw.max_price != null && parseFloat(kw.max_price) > 0
      ? `¥${parseInt(kw.max_price).toLocaleString()}`
      : 'なし';

    await bot.sendMessage(
      chatId,
      `💰 「${kw.keyword}」の現在の価格設定\n最低価格: ${minText}\n上限価格: ${maxText}\n\n変更する項目を選択してください:`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📉 最低価格を変更', callback_data: `editmin_${kwId}` }],
            [{ text: '📈 上限価格を変更', callback_data: `editmax_${kwId}` }],
            [{ text: '❌ キャンセル', callback_data: 'cancel' }]
          ]
        }
      }
    );
  } catch (err) {
    console.error('[telegram-bot] 価格設定選択エラー:', err.message);
    await replyWithKeyboard(chatId, `❌ エラー: ${err.message}`);
  }
}

async function handleEditPriceInput(chatId, userId, text, state) {
  userStates.delete(userId);
  try {
    const kw = await Keyword.findByPk(state.keywordId);
    if (!kw) {
      await replyWithKeyboard(chatId, '❌ キーワードが見つかりません');
      return;
    }

    const newPrice = parseInt(text, 10);
    if (isNaN(newPrice) || newPrice < 0) {
      await replyWithKeyboard(chatId, '❌ 数値を入力してください（例: 1500）');
      return;
    }

    const label = state.editTarget === 'min_price' ? '最低価格' : '上限価格';
    await kw.update({ [state.editTarget]: newPrice });
    await replyWithKeyboard(
      chatId,
      `✅ 「${kw.keyword}」の${label}を ¥${newPrice.toLocaleString()} に更新しました`
    );
  } catch (err) {
    console.error('[telegram-bot] 価格入力エラー:', err.message);
    await replyWithKeyboard(chatId, `❌ エラー: ${err.message}`);
  }
}

async function handleClearPrice(chatId, kwId, field) {
  try {
    const kw = await Keyword.findByPk(kwId);
    if (!kw) {
      await replyWithKeyboard(chatId, '❌ キーワードが見つかりません');
      return;
    }
    const label = field === 'min_price' ? '最低価格' : '上限価格';
    await kw.update({ [field]: null });
    await replyWithKeyboard(chatId, `✅ 「${kw.keyword}」の${label}を削除しました（制限なし）`);
  } catch (err) {
    console.error('[telegram-bot] 価格削除エラー:', err.message);
    await replyWithKeyboard(chatId, `❌ エラー: ${err.message}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📦 在庫アラート
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** 行単位で maxLen 文字に分割（4096文字制限対応） */
function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    const next = current ? current + '\n' + line : line;
    if (next.length > maxLen) {
      if (current) chunks.push(current.trim());
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

// フォーマットユーティリティ（inventory-alert.cjs の Telegram 版と同じ仕様）
function _daysSince(dateStr) {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000));
}
function _fmtDate(dateStr) {
  if (!dateStr) return 'なし';
  const [, m, d] = dateStr.split('-');
  return `${parseInt(m)}/${parseInt(d)}`;
}
function _trendLabel(trend) {
  return { accelerating: '📈加速', stable: '➡️安定', decelerating: '📉減速', new_surge: '⚡急伸', unknown: '⏸不明' }[trend] ?? trend;
}
function _fmtCritical(a) {
  const rem = isFinite(a.effectiveRemainingDays) ? `有効残${a.effectiveRemainingDays.toFixed(1)}日` : '不動';
  return `  ${a.itemName}（残${a.stock}個/${rem}/${_trendLabel(a.trend)}）`;
}
function _fmtWarning(a) {
  return `  ${a.itemName}（残${a.stock}個/有効残${a.effectiveRemainingDays.toFixed(1)}日/${_trendLabel(a.trend)}）`;
}
function _fmtOutOfStock(a) {
  const days = _daysSince(a.lastSaleDate);
  const rate = a.effectiveDailyRate28 > 0 ? `実力${a.effectiveDailyRate28.toFixed(1)}個/日` : '販売ゼロ';
  return `  ${a.itemName}（0個/${rate}/最終${_fmtDate(a.lastSaleDate)}/${days}日前）`;
}
function _fmtPriceReview(a) {
  return `  ${a.itemName}（残${a.stock}個/28日${a.sales28}個→7日${a.sales7}個📉）`;
}
function _fmtRecommend(r) {
  const label = r.reason === 'new_surge' ? '⚡急伸' : '未監視';
  return `  ${r.itemName}（28日${r.sales28}個/在庫${r.stock}個/${label}）`;
}
function _fmtReplenishmentItem(item) {
  if (item.level === 'out_of_stock') return `  ${item.itemName}: 昨日${item.yesterdaySales}個 → 欠品中！`;
  const badge = { critical_accelerating: '/🔴危険', critical: '/🔴危険', warning: '/🟡注意', price_review: '/💰価格見直し' }[item.level] || '';
  return `  ${item.itemName}: 昨日${item.yesterdaySales}個 → ${item.yesterdaySales}個補充（残${item.stock}個${badge}）`;
}

function buildInventoryMessage(result, today, leadTime) {
  const { alerts, summary, recommendations, replenishmentList } = result;

  const criticalAcc = alerts.filter(a => a.level === 'critical_accelerating');
  const outOfStock  = alerts.filter(a => a.level === 'out_of_stock');
  const critical    = alerts.filter(a => a.level === 'critical');
  const warning     = alerts.filter(a => a.level === 'warning');
  const priceReview = alerts.filter(a => a.level === 'price_review');

  const outRecent = outOfStock.filter(a => _daysSince(a.lastSaleDate) <= 30);
  const outOld    = outOfStock.filter(a => _daysSince(a.lastSaleDate) >  30);
  const totalCritical = criticalAcc.length + critical.length;
  const L = [];

  L.push(`📊 在庫日報 ${today}（リードタイム: ${leadTime}日）`);
  L.push('');

  if (criticalAcc.length > 0) {
    L.push(`🔴📈 仕入れ急げ: ${criticalAcc.length}件`);
    criticalAcc.forEach(a => L.push(_fmtCritical(a)));
    L.push('');
  }

  L.push(`⚫ 欠品中: ${outOfStock.length}件`);
  if (outRecent.length > 0) outRecent.forEach(a => L.push(_fmtOutOfStock(a)));
  if (outOld.length > 0) L.push(`  他${outOld.length}件（30日超未販売）`);
  if (outOfStock.length === 0) L.push('  なし');
  L.push('');

  if (critical.length > 0) {
    L.push(`🔴 危険: ${critical.length}件`);
    critical.forEach(a => L.push(_fmtCritical(a)));
    L.push('');
  }

  if (warning.length > 0) {
    L.push(`🟡 注意: ${warning.length}件`);
    warning.forEach(a => L.push(_fmtWarning(a)));
    L.push('');
  }

  if (priceReview.length > 0) {
    L.push(`💰 価格見直し: ${priceReview.length}件`);
    priceReview.slice(0, 5).forEach(a => L.push(_fmtPriceReview(a)));
    if (priceReview.length > 5) L.push(`  他${priceReview.length - 5}件`);
    L.push('');
  }

  L.push(`📋 全体: ${summary.total}件 / 🔴${totalCritical} 🟡${summary.warning} 🟢${summary.ok} ⚫${summary.out_of_stock} 💰${summary.price_review} ⚪${summary.dead_stock}`);

  if (replenishmentList) {
    const { items, skippedCount } = replenishmentList;
    if (items.length > 0 || skippedCount > 0) {
      const totalQty = items.reduce((s, i) => s + i.yesterdaySales, 0);
      L.push('');
      L.push('📦 本日補充リスト（前日販売分）');
      items.forEach(item => L.push(_fmtReplenishmentItem(item)));
      L.push(`  計: ${items.length}商品 / ${totalQty}個補充`);
      if (skippedCount > 0) L.push(`  ⏭ スキップ（在庫30日以上）: ${skippedCount}件`);
    }
  }

  if (recommendations.length > 0) {
    L.push('');
    L.push(`💡 フリマ監視おすすめ: ${recommendations.length}件`);
    recommendations.forEach(r => L.push(_fmtRecommend(r)));
  }

  return L.join('\n');
}

async function handleInventory(chatId) {
  try {
    await bot.sendMessage(chatId, '📦 在庫アラート計算中...');

    const service = new InventoryAlertService();
    const result = await service.generateAlert();

    const today = new Date().toLocaleDateString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).replace(/\//g, '-');

    const msg = buildInventoryMessage(result, today, service.defaultLeadTime);
    const chunks = splitMessage(msg, 4096);

    for (let i = 0; i < chunks.length; i++) {
      if (i === chunks.length - 1) {
        await replyWithKeyboard(chatId, chunks[i]);
      } else {
        await bot.sendMessage(chatId, chunks[i]);
      }
    }
  } catch (err) {
    console.error('[telegram-bot] 在庫アラートエラー:', err.message);
    await replyWithKeyboard(chatId, `❌ エラー: ${err.message}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📊 ステータス
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function handleStatus(chatId) {
  try {
    // ディスク空き容量（Windows: PowerShell）
    let diskFree = 'N/A';
    try {
      const psOut = execSync('powershell -Command "(Get-PSDrive C).Free"', { encoding: 'utf8', timeout: 5000 });
      const bytes = parseInt(psOut.trim(), 10);
      if (!isNaN(bytes)) {
        diskFree = `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
      }
    } catch {}

    // メモリ空き
    const freeMemMB = Math.round(os.freemem() / (1024 * 1024));

    // 最終スキャン時刻
    let lastScanText = '不明';
    try {
      const [row] = await sequelize.query(
        'SELECT MAX(created_at) as last_scan FROM products',
        { type: sequelize.QueryTypes.SELECT }
      );
      if (row && row.last_scan) {
        const diffMs = Date.now() - new Date(row.last_scan).getTime();
        const diffMin = Math.round(diffMs / 60000);
        lastScanText = diffMin < 60 ? `${diffMin}分前` : `${Math.round(diffMin / 60)}時間前`;
      }
    } catch {}

    // PM2 ステータス
    let pm2Status = '不明';
    try {
      const pm2List = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8', timeout: 5000 }));
      const backend = pm2List.find(p =>
        p.name === 'picofuri-backend' || p.name === 'backend'
      );
      if (backend) {
        const s = backend.pm2_env.status;
        pm2Status = s === 'online' ? 'online ✅' : s;
      }
    } catch {}

    // キーワード件数
    const keywordCount = await Keyword.count({ where: { is_active: true } });

    const statusText =
      `📊 ピコフリ ステータス\n\n` +
      `💾 ディスク空き: ${diskFree}\n` +
      `🧠 メモリ空き: ${freeMemMB} MB\n` +
      `⏱ 最終スキャン: ${lastScanText}\n` +
      `📡 PM2 backend: ${pm2Status}\n` +
      `🔑 監視キーワード: ${keywordCount}件`;

    await replyWithKeyboard(chatId, statusText);
  } catch (err) {
    console.error('[telegram-bot] ステータス取得エラー:', err.message);
    await replyWithKeyboard(chatId, `❌ ステータス取得エラー: ${err.message}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 起動
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function start() {
  try {
    await sequelize.authenticate();
    console.log('✅ データベース接続成功');
  } catch (err) {
    console.error('❌ データベース接続失敗:', err.message);
    process.exit(1);
  }

  bot.on('polling_error', (err) => {
    console.error('[telegram-bot] ポーリングエラー:', err.code, err.message);
  });

  console.log('🤖 Telegram Botが起動しました');
  console.log(`📡 管理者ID: ${ADMIN_ID != null ? ADMIN_ID : '未設定（初回メッセージで取得）'}`);
  console.log('⌛ メッセージ待機中...');
}

start();
