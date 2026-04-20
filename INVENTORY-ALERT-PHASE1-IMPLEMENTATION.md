# 在庫アラート Phase 1 実装指示書

> 作成日: 2026-04-15
> ブランチ名: `feat/inventory-alert`
> 設計書: PICOFURI-DESIGN-INVENTORY-ALERT-V2.1.md
> 目的: 毎朝8時に在庫状況サマリーをLINE broadcast + Telegram送信

---

## 重要な前提

- LINE通知は **broadcast方式**（pushMessageではなくbroadcast）
  - health-check.cjs と同じ送信方式を使うこと
  - グループID宛のpushMessageは使わない
- Telegram通知は TELEGRAM_ADMIN_ID 宛に sendMessage
- mainを直接編集しない。ブランチで作業

---

## 実装前の確認（まずこれを実行して結果を報告）

### 確認1: 対象商品数の把握

```javascript
// 2314-* の全商品数を集計
const fs = require('fs');
const path = require('path');

// 販売履歴から2314-*を集計
const history = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'server/data/crossmall_sales_history.json'), 'utf8'
));
const historySKUs = Object.keys(history.sales || {}).filter(sku => sku.startsWith('2314-'));

// キャッシュから2314-*を集計
const cache = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'server/data/purchase_master_cache.json'), 'utf8'
));
const cacheSKUs = Object.keys(cache.items || {}).filter(sku => sku.startsWith('2314-'));
const cacheWithStock = cacheSKUs.filter(sku => (cache.items[sku].stock || 0) > 0);

// ユニーク結合
const allSKUs = [...new Set([...historySKUs, ...cacheSKUs])];

console.log('=== 対象商品数 ===');
console.log('販売履歴あり(2314-*): ' + historySKUs.length);
console.log('キャッシュ登録(2314-*): ' + cacheSKUs.length);
console.log('在庫1以上(2314-*): ' + cacheWithStock.length);
console.log('ユニーク合計: ' + allSKUs.length);
```

### 確認2: computeStats() が sales14 を計算しているか

```bash
grep -n "sales14\|sales_14\|14.*day\|14日" server/services/CrossmallSalesHistory.js server/scripts/sync-crossmall-prices.cjs
```

sales14 がなければ追加が必要。

### 確認3: health-check.cjs のbroadcast送信コードを確認

```bash
# broadcast送信のコード部分を表示
grep -A 10 "broadcast\|Broadcast" server/scripts/health-check.cjs
```

同じ送信ロジックを流用する。

### 確認4: telegram-bot.cjs の sendMessage コード確認

```bash
# Telegram送信のコード部分を表示
grep -A 5 "sendMessage\|TELEGRAM" server/scripts/telegram-bot.cjs | head -30
```

---

## 実装タスク

### タスク1: InventoryAlertService.js（新規作成）

`server/services/InventoryAlertService.js`

#### 責務
- 対象SKUの抽出
- 3期間（28日/14日/7日）の実効日販計算
- 在庫日数計算（3期間最短予測）
- トレンド判定（加速/安定/減速/新規急伸）
- リードタイムを加味した有効残日数計算
- 分類（🔴🟡🟢⚫💰⚪）
- フリマ未監視の売れ筋推奨リスト生成

#### クラス設計

```javascript
class InventoryAlertService {
  constructor(options = {}) {
    this.defaultLeadTime = options.leadTime || 3; // デフォルト3日
    this.accelerationThreshold = 1.5;  // 加速判定
    this.decelerationThreshold = 0.5;  // 減速判定
  }

  /**
   * メイン: 全対象SKUの在庫アラート結果を生成
   * @returns {Object} { alerts, summary, recommendations }
   */
  async generateAlert() { ... }

  /**
   * 対象SKUを抽出
   * 条件: 2314-* かつ (販売実績あり or stock>=1)
   * 在庫0かつ販売ゼロは除外
   */
  _getTargetSKUs() { ... }

  /**
   * 1 SKUの在庫アラート情報を計算
   * @returns {Object} {
   *   sku, itemName, stock,
   *   sales28, sales14, sales7,
   *   effectiveDailyRate28, effectiveDailyRate14, effectiveDailyRate7,
   *   stockDays, trend, effectiveRemainingDays,
   *   level, lastSaleDate, outOfStockDays
   * }
   */
  _analyzeSKU(sku, stockInfo, salesData) { ... }

  /**
   * 実効日販を計算（欠品期間を除外）
   * @param {number} sales - 期間内の販売数
   * @param {number} periodDays - 期間の暦日数（28/14/7）
   * @param {number} outOfStockDays - 期間内の欠品日数
   * @returns {number} 実効日販
   */
  _calcEffectiveDailyRate(sales, periodDays, outOfStockDays) { ... }

  /**
   * トレンド判定
   * @returns {string} 'accelerating' | 'stable' | 'decelerating' | 'new_surge' | 'unknown'
   */
  _determineTrend(rate28, rate7) { ... }

  /**
   * 分類
   * @returns {string} 'critical_accelerating' | 'critical' | 'warning' | 'ok' | 'out_of_stock' | 'price_review' | 'dead_stock'
   */
  _classify(stock, effectiveRemaining, trend, sales28) { ... }

  /**
   * フリマ未監視の推奨リスト生成
   */
  _generateRecommendations(alerts) { ... }
}
```

#### データソース
- `purchase_master_cache.json` → stock, item_name, sales28, sales7, lastSaleDate
- `crossmall_sales_history.json` → 詳細な注文履歴（sales14計算用）
- `inventory_alert_state.json` → 前回の在庫状態（欠品追跡用）
- DBの `Keywords` テーブル → crossmall_item_code（フリマ推奨用）

#### sales14の計算
computeStats()にsales14がない場合、InventoryAlertService内でcrossmall_sales_history.jsonから直接計算する:

```javascript
// crossmall_sales_history.json の sales[sku] は配列
// [{ date, price, orderNumber, deliveryType }, ...]
const now = new Date();
const d14 = new Date(now - 14 * 24 * 60 * 60 * 1000);
const sales14 = orders.filter(o => new Date(o.date) >= d14).length;
```

---

### タスク2: inventory-alert.cjs（新規作成）

`server/scripts/inventory-alert.cjs`

#### 責務
- 毎朝8:00 JST に実行（PM2 cron）
- InventoryAlertService.generateAlert() を呼び出し
- 前日の結果と比較して新規/悪化/改善を判定
- LINE broadcast でサマリー送信
- Telegram sendMessage でサマリー送信
- 結果を inventory_alert_history.json に保存（翌日比較用）

#### LINE broadcast 送信

health-check.cjs のbroadcast送信コードを参考にすること。
基本構造:

```javascript
const { messagingApi } = await import('@line/bot-sdk');
const client = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});
await client.broadcast({ type: 'text', text: message });
```

※ 上記は参考コード。health-check.cjs の実際のコードに合わせること。

#### Telegram sendMessage

```javascript
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

async function sendTelegram(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_ADMIN_ID,
      text: text,
      parse_mode: 'HTML'  // or 'Markdown'
    })
  });
}
```

#### メッセージフォーマット

設計書v2.1のセクション5-Aの通知フォーマットに従う。
LINE版は各カテゴリ上位5件のみ。
Telegram版は全件（ただし4096文字制限があるので分割送信）。

---

### タスク3: inventory_alert_state.json（新規作成）

`server/data/inventory_alert_state.json`

初期構造:

```json
{
  "lastUpdated": "2026-04-15T...",
  "outOfStockSince": {
    "2314-000546": "2026-04-10T00:00:00Z"
  },
  "previousStock": {
    "2314-000546": 15,
    "2314-001452": 100
  },
  "lastAlertSent": {
    "2314-000546": "2026-04-15T08:00:00Z"
  }
}
```

- `outOfStockSince`: stock=0になった日時。stock>0に戻ったら削除
- `previousStock`: 前回sync時の在庫数（急減チェック用、Phase 2で使用）
- `lastAlertSent`: 急減アラート最終送信日時（Phase 2で使用。24時間抑制用）

---

### タスク4: PM2登録

```bash
cd C:\Users\Administrator\Desktop\flea-market-monitor
pm2 start server/scripts/inventory-alert.cjs --name inventory-alert --cron "0 23 * * *" --no-autorestart
pm2 save
```

※ UTC 23:00 = JST 08:00

---

## テスト手順

### テスト1: InventoryAlertService の単体テスト

```bash
cd C:\Users\Administrator\Desktop\flea-market-monitor
node -e "
const InventoryAlertService = require('./server/services/InventoryAlertService');
const service = new InventoryAlertService();
service.generateAlert().then(result => {
  console.log('=== アラート結果 ===');
  console.log('対象SKU数:', result.alerts.length);
  console.log('サマリー:', JSON.stringify(result.summary, null, 2));
  console.log('');
  console.log('🔴 危険:', result.alerts.filter(a => a.level.includes('critical')).length);
  console.log('🟡 注意:', result.alerts.filter(a => a.level === 'warning').length);
  console.log('🟢 余裕:', result.alerts.filter(a => a.level === 'ok').length);
  console.log('⚫ 欠品:', result.alerts.filter(a => a.level === 'out_of_stock').length);
  console.log('💰 価格見直し:', result.alerts.filter(a => a.level === 'price_review').length);
  console.log('⚪ 不動在庫:', result.alerts.filter(a => a.level === 'dead_stock').length);
  console.log('');
  console.log('--- 🔴 危険 上位5件 ---');
  result.alerts.filter(a => a.level.includes('critical')).slice(0, 5).forEach(a => {
    console.log(a.sku, a.itemName, '残' + a.stock + '個', '有効残' + a.effectiveRemainingDays.toFixed(1) + '日', a.trend);
  });
  console.log('');
  console.log('--- 💡 フリマ推奨 ---');
  (result.recommendations || []).forEach(r => {
    console.log(r.sku, r.itemName, '28日' + r.sales28 + '個', '未監視');
  });
  process.exit();
}).catch(err => { console.error(err); process.exit(1); });
"
```

### テスト2: inventory-alert.cjs の手動実行（LINE + Telegram送信テスト）

```bash
node server/scripts/inventory-alert.cjs
```

確認ポイント:
- LINE broadcast でサマリーが届くこと
- Telegram でサマリーが届くこと
- inventory_alert_history.json が保存されること
- エラーが出ていないこと

### テスト3: PM2登録後の動作確認

```bash
pm2 status  # inventory-alert が stopped(cron) で表示されること
pm2 logs inventory-alert --lines 10  # エラーなし
```

---

## 実行手順まとめ

1. **確認1〜4を実行して結果を報告**（実装には進まない）
2. オーナー承認後に実装開始
3. タスク1（InventoryAlertService.js）を実装 → 単体テスト
4. タスク2（inventory-alert.cjs）を実装 → 手動実行テスト
5. タスク3（state.json初期化）
6. タスク4（PM2登録）
7. git diff master で差分提示 → 承認 → マージ

---

## 注意事項

- mainを直接編集しない。`feat/inventory-alert` ブランチで作業
- LINE送信はbroadcast方式（グループpushMessageではない）
- Telegram送信は4096文字制限あり。超える場合は分割送信
- 在庫日数の計算で0除算に注意（販売ゼロの場合は Infinity ではなく「不動在庫」扱い）
- .env の TELEGRAM_BOT_TOKEN と TELEGRAM_ADMIN_ID が設定済みか確認
- LINE_CHANNEL_ACCESS_TOKEN が設定済みか確認
- Phase 1では急減アラート(5-C)と2時間チェック(5-B)は実装しない。毎朝サマリーのみ
