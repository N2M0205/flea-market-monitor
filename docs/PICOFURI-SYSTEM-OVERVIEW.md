# ピコフリ システム全体仕様書

**最終更新**: 2026-04-27  
**バージョン**: 2.0.0-alpha  
**対象環境**: Win VPS (ConoHa) 160.251.227.206

---

## 目次

1. [システム概要](#1-システム概要)
2. [アーキテクチャ全体図](#2-アーキテクチャ全体図)
3. [PM2プロセス一覧](#3-pm2プロセス一覧)
4. [スクレイピング機能の詳細](#4-スクレイピング機能の詳細)
5. [通知機能](#5-通知機能)
6. [CROSSMALL連携](#6-crossmall連携)
7. [在庫アラート機能](#7-在庫アラート機能inventory-alert)
8. [Telegram Bot機能](#8-telegram-bot機能)
9. [データ構造](#9-データ構造)
10. [環境変数（.env）](#10-環境変数env)
11. [防御レイヤー（7重防御）](#11-防御レイヤー7重防御)
12. [ヘルスチェックの監視項目と閾値](#12-ヘルスチェックの監視項目と閾値)
13. [操作手順](#13-操作手順)
14. [トラブルシューティング](#14-トラブルシューティング)
15. [既知の制約・未解決課題](#15-既知の制約未解決課題)
16. [ファイル構成](#16-ファイル構成)

---

## 1. システム概要

### ピコフリとは

**フリマ監視 → LINE通知システム**。メルカリ・Yahoo!フリマを10分間隔でスクレイピングし、登録キーワードに合致する新着商品を検出。CROSSMALL（在庫管理SaaS）の在庫・販売実績情報と組み合わせてLINEグループに通知する。仕入れ判断を支援するためのツール。

### 開発・運用体制

| 役割 | 担当 |
|------|------|
| 設計・方針決定 | Claude（チャット） |
| 実装・テスト | Claude Code（VPS上） |
| オーナー承認 | N2M0205 |
| GitHub | [N2M0205/flea-market-monitor](https://github.com/N2M0205/flea-market-monitor) |

### ホスティング環境

| 項目 | 値 |
|------|-----|
| 種別 | ConoHa Win VPS |
| OS | Windows Server 2022 Datacenter |
| グローバルIP | 160.251.227.206（固定・CROSSMALL IP制限用） |
| RAM | 8GB |
| Node.js | v22.14.0 以上（v18.0.0 が最低要件） |
| DB | SQLite（`server/database.sqlite`）※NODE_ENV=development |
| PM2 | プロセスマネージャ |

### 主要技術スタック

| カテゴリ | 技術 |
|----------|------|
| バックエンド | Node.js + Express v4.18.2 |
| ORM | Sequelize v6.35.1 |
| DB | SQLite3 v5.1.7 / better-sqlite3 v12.8.0 |
| スクレイピング | Puppeteer v24.37.3 + puppeteer-extra v3.3.6 + Stealth Plugin v2.11.2 |
| スケジューラー | node-cron v3.0.3 |
| LINE通知 | @line/bot-sdk v9.3.0（MessagingApiClient） |
| Telegram Bot | node-telegram-bot-api v0.67.0（polling方式） |
| フロントエンド | React v18.2.0 + MUI v5.14.20 + Vite v5.0.8 |

---

## 2. アーキテクチャ全体図

```
╔══════════════════════════════════════════════════════════════════╗
║  VPS (Windows Server 2022)   160.251.227.206                    ║
║                                                                  ║
║  ┌──────────────────────────────────────────────────────────┐   ║
║  │  PM2 プロセスマネージャ                                  │   ║
║  │                                                          │   ║
║  │  常時起動                                                │   ║
║  │  ├─ picofuri-backend  (server/server.js)                │   ║
║  │  │   └─ SchedulerService → */10 * * * * → scrape()     │   ║
║  │  ├─ telegram-bot      (server/scripts/telegram-bot.cjs) │   ║
║  │  └─ pm2-logrotate     (module)                          │   ║
║  │                                                          │   ║
║  │  cronプロセス（実行後停止）                               │   ║
║  │  ├─ crossmall-sync        cron: 0 */2 * * *             │   ║
║  │  ├─ crossmall-stock-sync  cron: */30 * * * *            │   ║
║  │  ├─ crossmall-items-sync  cron: 30 3 * * *              │   ║
║  │  ├─ chrome-cleanup        cron: */30 * * * *            │   ║
║  │  ├─ health-check          cron: 0,30 * * * *            │   ║
║  │  └─ inventory-alert       cron: 0 23 * * * (=JST 8:00) │   ║
║  └──────────────────────────────────────────────────────────┘   ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝

【スクレイピングフロー】

  SchedulerService（*/10 * * * *）
        │
        ▼
  ScrapingService.scrapeAllKeywords()
        │
        ├─[前処理] ゾンビChrome kill（3分超のPID）
        │          puppeteer_dev_* dir削除
        │          notified済30日超productを削除
        │
        ├─[キーワード取得] Keywords テーブル全件
        │
        ├─[バッチ処理] CONCURRENCY（デフォルト3）件ずつ並列
        │   │
        │   ├─[プラットフォーム並列]
        │   │   ├─ MercariPuppeteerScraper.search()
        │   │   └─ YahooFleaScraper.search()
        │   │
        │   ├─[タイトルフィルタ] AND条件 + スペース除去フレーズ一致
        │   │
        │   ├─[DB保存] Product.findOrCreate（重複防止）
        │   │
        │   ├─[CROSSMALL情報取得] CrossmallDbService（DB参照のみ）
        │   │   └─ crossmall_stock + crossmall_sales を集約
        │   │
        │   └─[Layer Aフィルタ → LINE通知]
        │       └─ 通過 → LineNotificationService.notifyPurchaseAlert()
        │
        └─[後処理] 全ブラウザfinallyで強制close

【CROSSMALL同期フロー】

  crossmall-sync（0 */2 * * *）
        │
        ▼
  sync-crossmall-prices.cjs
        │
        ├─ CrossmallService.getOrderList() ← CROSSMALL API
        ├─ crossmall_sales テーブルへUPSERT
        ├─ CrossmallSalesHistory（JSON）更新
        └─ PurchaseMasterCache 更新

  crossmall-stock-sync（*/30 * * * *）
        │
        ▼
  sync-crossmall-stock.cjs
        │
        ├─ CrossmallItem テーブルから SKU一覧取得
        ├─ CrossmallService.getStockInfo(sku) × 全件（1秒/件）
        ├─ crossmall_stock テーブルへUPSERT
        └─ InventoryAlertService.runSyncAlertCheck()
            ├─ 急減検知（前回比50%以上減少 + 有効残4日以下）
            └─ 2時間チェック（🔴/⚫ SKU構成変化で送信）

【データの流れ】

  フリマサイト ──→ Puppeteer ──→ Products(DB) ──→ LINE通知
                                    ↓ (not found = new)
  CROSSMALL ──→ crossmall_sales(DB) ──→ 利益計算 ──→ LINE通知
               crossmall_stock(DB) ──→ 在庫数表示
               crossmall_items(DB) ──→ 商品名取得
```

---

## 3. PM2プロセス一覧

### 3-1. picofuri-backend

| 項目 | 値 |
|------|-----|
| ID | 4 |
| 種別 | 常時起動（fork mode） |
| スクリプト | `server/server.js` |
| ポート | 3001（`process.env.PORT \|\| 3001`） |
| メモリ上限 | 500MB（`max_memory_restart`） |
| 役割 | メインスクレイピング + Express API + スケジューラー |
| 起動コマンド | `pm2 start server/server.js --name picofuri-backend --max-memory-restart 500M` |

**主要な処理**:
- `SchedulerService` が node-cron で `*/10 * * * *` を管理
- `ScrapingService.scrapeAllKeywords()` を10分ごとに実行
- Express REST API（`/api/keywords`, `/api/products` 等）を提供
- unhandledRejection を catch してクラッシュを防ぐ

---

### 3-2. crossmall-sync

| 項目 | 値 |
|------|-----|
| ID | 1 |
| 種別 | cron（実行後停止） |
| スクリプト | `server/scripts/sync-crossmall-prices.cjs` |
| cron | `0 */2 * * *`（2時間ごと） |
| 役割 | CROSSMALL受注データ蓄積 + 急減チェック + 2時間Telegram簡易レポート |

**処理フロー**:
1. CrossmallSalesHistoryから前回同期状態を読み込み
2. 初回: 過去90日分を1日単位で分割取得（1秒/件待機）
3. 2回目以降: 前回最新注文日 - 2日マージンから差分取得
4. crossmall_sales テーブルへUPSERT（`(order_number, line_no)` でPK）
5. 90日超の古いレコードを自動パージ
6. PurchaseMasterCache（JSON）に sales7/sales28/lastSalePrice を反映

**定数**:

| 定数 | 値 |
|------|-----|
| INITIAL_FETCH_DAYS | 90日 |
| FETCH_MARGIN_DAYS | 2日 |
| PRUNE_DAYS | 90日 |
| FETCH_DELAY_MS | 1000ms |
| SAVE_INTERVAL | 50件ごとに中間保存 |

---

### 3-3. crossmall-stock-sync

| 項目 | 値 |
|------|-----|
| ID | 9 |
| 種別 | cron（実行後停止） |
| スクリプト | `server/scripts/sync-crossmall-stock.cjs` |
| cron | `*/30 * * * *`（30分ごと） |
| 役割 | 在庫数リアルタイム同期（162件フルスキャン、約3分） |

**処理フロー**:
1. `crossmall_items` テーブルからSKU一覧を取得
2. `CrossmallService.getStockInfo(sku)` を1件ずつ呼び出し（DELAY_MS=1000ms）
3. `crossmall_stock` テーブルへUPSERT
4. `InventoryAlertService.runSyncAlertCheck()` で急減・2時間チェック実行

**制約**: get_diff_stock の updated_at_fr バルクモードはこのアカウントで認証エラーのため未使用（Issue A'）

---

### 3-4. crossmall-items-sync

| 項目 | 値 |
|------|-----|
| ID | 8 |
| 種別 | cron（実行後停止） |
| スクリプト | `server/scripts/sync-crossmall-items.cjs` |
| cron | `30 3 * * *`（毎日 3:30 UTC = 12:30 JST） |
| 役割 | 商品マスタ同期（新規SKU検知） |

**処理フロー**:
1. `data/purchase_master_cache.json` の SKUを全件読み込み
2. DB未登録のSKUのみ `CrossmallService.getItemInfo()` でAPI取得
3. `crossmall_items` テーブルへUPSERT（`base_code` も導出して保存）
4. 初回のみ全件取得（157件×1秒≒2.6分）、2回目以降は未登録分のみ（通常0件で即終了）

---

### 3-5. chrome-cleanup

| 項目 | 値 |
|------|-----|
| ID | 2 |
| 種別 | cron（実行後停止） |
| スクリプト | `server/scripts/cleanup-chrome.cjs` |
| cron | `*/30 * * * *`（30分ごと） |
| 役割 | 残留Chrome/Tempクリーンアップ |

**閾値**:

| 種別 | 閾値 | 動作 |
|------|------|------|
| 孤立Chromeプロセス（backnedの子でない） | 起動から5分以上経過 | taskkillで強制終了 |
| backendの子Chromeプロセス | 起動から3分以上経過 | taskkillで強制終了 |
| `puppeteer_dev_*` dir | 即時 | fs.rmSync |
| `chromium_*` / `chrome_*` dir | 即時 | fs.rmSync |
| `.tmp` ファイル | 1時間以上経過 | 削除 |
| `tmp*` フォルダ | 1時間以上経過 | 削除 |

---

### 3-6. health-check

| 項目 | 値 |
|------|-----|
| ID | 3 |
| 種別 | cron（実行後停止） |
| スクリプト | `server/scripts/health-check.cjs` |
| cron | `0,30 * * * *`（0分と30分） |
| 役割 | VPSヘルスチェック + LINE broadcast警告 |
| 状態ファイル | `data/health_check_state.json` |

**通知方式**: fetch直接方式 `https://api.line.me/v2/bot/message/broadcast`（@line/bot-sdk不使用）  
**通知条件**: 異常が1件でもある場合のみ送信（正常時は送信しない）

---

### 3-7. inventory-alert

| 項目 | 値 |
|------|-----|
| ID | 7 |
| 種別 | cron（実行後停止） |
| スクリプト | `server/scripts/inventory-alert.cjs` |
| cron | `0 23 * * *`（UTC 23:00 = JST 8:00） |
| 役割 | 毎朝8:00 在庫サマリー（LINE=スリム / Telegram=フル） |
| 履歴ファイル | `data/inventory_alert_history.json` |

---

### 3-8. telegram-bot

| 項目 | 値 |
|------|-----|
| ID | 5 |
| 種別 | 常時起動（polling） |
| スクリプト | `server/scripts/telegram-bot.cjs` |
| メモリ上限 | 200MB |
| 役割 | キーワード管理 + 📦在庫ボタン（即時サマリー）+ 💡推奨→即追加 |
| 依存node_modules | `server/node_modules/`（プロジェクトルートではない） |

---

### 3-9. pm2-logrotate

| 項目 | 値 |
|------|-----|
| 種別 | PM2モジュール（常時起動） |
| バージョン | 3.0.0 |
| 役割 | ログファイル自動ローテーション |

---

### 3-10. cc-bot（参考: 別プロジェクト）

| 項目 | 値 |
|------|-----|
| ID | 6 |
| スクリプト | `C:\Users\Administrator\cc-bot\claude-code-bot-v3.cjs` |
| 役割 | Claude Code管理Bot（flea-market-monitorとは別プロジェクト） |

---

### PM2プロセス一覧（現在の稼働状況）

```
┌────┬─────────────────────────┬───────┬──────────┬───────────┐
│ id │ name                    │ mode  │ status   │ cron      │
├────┼─────────────────────────┼───────┼──────────┼───────────┤
│  4 │ picofuri-backend        │ fork  │ online   │ -         │
│  5 │ telegram-bot            │ fork  │ online   │ -         │
│  1 │ crossmall-sync          │ fork  │ stopped  │ 0 */2 * * *     │
│  9 │ crossmall-stock-sync    │ fork  │ stopped  │ */30 * * * *    │
│  8 │ crossmall-items-sync    │ fork  │ stopped  │ 30 3 * * *      │
│  2 │ chrome-cleanup          │ fork  │ stopped  │ */30 * * * *    │
│  3 │ health-check            │ fork  │ stopped  │ 0,30 * * * *    │
│  7 │ inventory-alert         │ fork  │ stopped  │ 0 23 * * *      │
│  0 │ pm2-logrotate           │ -     │ online   │ (module)        │
└────┴─────────────────────────┴───────┴──────────┴─────────────────┘
```

---

## 4. スクレイピング機能の詳細

### 4-1. 対象プラットフォーム

| プラットフォーム | URL | スクレイパークラス |
|-----------------|-----|-------------------|
| メルカリ | `https://jp.mercari.com/search?keyword=...&sort=created_time&order=desc&status=on_sale` | `MercariPuppeteerScraper` |
| Yahoo!フリマ | `https://paypayfleamarket.yahoo.co.jp/search/{keyword}?page=1` | `YahooFleaScraper` |
| PayPayフリマ | ※非推奨（コードあり、実運用外） | `PayPayPuppeteerScraper` |

### 4-2. 監視サイクル

- スケジュール: `*/10 * * * *`（10分ごと）
- 重複起動防止: `isRunning` フラグで前回スキャン実行中はスキップ

### 4-3. 並列処理設定

```
SCRAPING_CONCURRENCY（.envで設定、デフォルト3）
 └─ キーワードをCONCURRENCY件ずつバッチ処理
     └─ 各キーワード内でプラットフォームをPromise.allSettledで並列処理
```

BrowserPool（`server/services/BrowserPool.cjs`）:
- `MAX_BROWSERS = 12`（同時起動上限）
- `ACQUIRE_TIMEOUT_MS = 60000`（60秒でタイムアウト）

### 4-4. 待機戦略

| スクレイパー | 起動設定 | ページ待機 |
|-------------|----------|-----------|
| Mercari | headless:'new', protocolTimeout:90000ms | `waitUntil:'domcontentloaded'` + `waitForSelector('[data-testid="item-cell"]', {timeout:10000})` |
| Yahoo!フリマ | headless:'new', protocolTimeout:90000ms | `waitUntil:'domcontentloaded'` + requestInterception（画像/CSS/フォントブロック） |

**User-Agent**: Chrome 135/136（Windows/Mac）とFirefox 136の4種類からランダム選択  
**Stealth Plugin**: puppeteer-extra-plugin-stealth で bot 検知回避

### 4-5. Mercari セレクタ（フォールバックチェーン）

1. `[data-testid="item-cell"]`（プライマリ）
2. `li[data-testid]`（セカンダリ）
3. `a[href*="/item/"]`（テーシャリ）

**CAPTCHA検知**: `.g-recaptcha` 存在 or h1 の "access denied" テキストで検知（バイパス不可）

### 4-6. Yahoo!フリマの自動停止

連続 ERR_ABORTED エラーが `MAX_CONSECUTIVE_ABORTS = 3` 回に達した場合、当該スキャンサイクル中は自動停止する。次回スキャン開始時に `resetAbortState()` でリセット。

### 4-7. フィルタリング

**タイトルフィルタ（全プラットフォーム共通）**:

```
normalizeText():
  全角英数 → 半角
  +/＋ → "プラス"
  装飾記号（【】★☆等）除去
  全角スペース・連続スペース → 半角スペース1個

判定ロジック（優先順）:
  1. 有効ワードが0件（全部ストップワード） → 全件通過
  2. AND判定: 全有効ワードがタイトルに含まれる → 通過
  3. フレーズ一致: スペース除去後のキーワードがタイトルに含まれる → 通過（表記ゆれ救済）
  4. 上記全て失敗 → 除外

ストップワード（除外しない）: no, the, for, and, with, from, de, la, le
```

**Layer A フィルタ**（`server/services/LayerAFilterService.js`）:

| 条件 | デフォルト閾値 | 設定ファイル |
|------|---------------|-------------|
| 下限価格 | keyword.min_price | DB |
| 上限価格 | keyword.max_price | DB |
| 出品者評価 | 90%以上 | `server/config/layerA.json` |
| 出品経過時間 | 48時間以内 | `server/config/layerA.json` |
| 賞味期限残存 | 5ヶ月以上 | `server/config/layerA.json` |
| NG語句 | 開封済/使用済/ジャンク/破損等17語 | LayerAFilterService.js（ハードコード） |
| 除外キーワード | keyword.exclude_keywords | DB |

**商品スキャン上限**: 1キーワード1プラットフォームあたり `limit: 20` 件

### 4-8. データ保持期間

- 通知済み(notified=true)かつ30日超の Products は次回スキャン開始時に自動削除

---

## 5. 通知機能

### 5-1. LINE通知（スクレイピング → グループ）

**送信方式**: `@line/bot-sdk v9.3.0` の `MessagingApiClient.pushMessage()` を使用  
**送信先**: `LINE_GROUP_ID`（単一グループ）  
**停止方法**: `LINE_NOTIFY_ENABLED=false` を .env に書いて `pm2 restart picofuri-backend --update-env`

**仕入れ推奨アラートフォーマット** (`notifyPurchaseAlert()`):

```
🛒 商品タイトル
¥1,000
🔗 https://jp.mercari.com/item/m123456789

📦 在庫0個 | 28日50個 | 7日10個 | 最終4/15
💰 直近販売¥2,000 | 上限仕入¥1,200
✅ 利益見込み +¥200（送料¥620）利益率10.0%
```

**送料マップ** (deliveryType → 送料):

| 配送種別 | 送料 |
|----------|------|
| 宅配便(日本郵便 楽天倉庫出荷) | ¥620 |
| 追跡可能メール便(日本郵便) | ¥220 |
| メール便(日本郵便) | ¥340 |
| 宅配便(佐川急便) | ¥550 |
| 上記以外・不明 | ¥620（デフォルト） |

**上限仕入計算**:
- ≤¥3,000: `lastSalePrice × 0.9 - 送料 - 300`（固定¥300利益）
- >¥3,000: `lastSalePrice × 0.78 - 送料`（利益率12%確保）

**利益見込み計算**:
```
profit = lastSalePrice × 0.9 - shippingCost - fleaMarketPrice
profitRate = profit / lastSalePrice × 100
```

---

### 5-2. LINE broadcast（ヘルスチェック・在庫アラート）

**送信方式**: fetch直接 `POST https://api.line.me/v2/bot/message/broadcast`（@line/bot-sdk不使用）  
**送信先**: LINEボットを友達追加した全ユーザー  
**使用箇所**:
- `health-check.cjs`: 異常検知時
- `inventory-alert.cjs`: 毎朝8:00サマリー

---

### 5-3. Telegram通知

**送信方式**: fetch直接 `POST https://api.telegram.org/bot{TOKEN}/sendMessage`  
**送信先**: `TELEGRAM_ADMIN_ID`（管理者のみ）  
**4096文字制限**: 行単位で分割して複数メッセージ送信  
**使用箇所**:
- `crossmall-sync`: 2時間ごとの簡易レポート
- `inventory-alert.cjs`: 毎朝8:00詳細サマリー
- `telegram-bot.cjs`: インタラクティブ操作への応答

---

## 6. CROSSMALL連携

### 6-1. API使用箇所

| スクリプト | API | 頻度 | 用途 |
|-----------|-----|------|------|
| crossmall-sync | `get_order`（受注一覧） | 2時間ごと | 販売履歴蓄積 |
| crossmall-stock-sync | `get_stock`（在庫照会） | 30分ごと × 全SKU | 在庫数更新 |
| crossmall-items-sync | `get_item`（商品マスタ） | 毎日3:30 × 未登録分のみ | 商品名取得 |
| picofuri-backend | **API呼び出しなし** | - | DB参照のみ |

**CROSSMALL API エンドポイント**: `https://crossmall.jp/webapi2`  
**アカウントID**: `CROSSMALL_ACCOUNT=3663`

### 6-2. ページネーション（order_number方式）

- `order_number`単体でページネーション可
- `condition`パラメータを付けると署名エラーになるため使用しない
- 1リクエストあたり100件上限

### 6-3. 認証・署名

`CrossmallService.generateSigning()` でパラメータを連結してHMAC-SHA1署名を生成。パラメータ値は`encodeURIComponent`を適用（2026-04-18 予防的修正済み）。現行の全API呼び出しはASCII安全パラメータのみのため本番影響なし。

**既知の問題**: `get_diff_stock` / `get_item` の `updated_at_fr` に `HH:MM:SS` 付きdatetimeを渡すと認証エラー（CROSSMALL サーバー側バリデーション）。`YYYY-MM-DD` 形式は認証OKだが TotalResult=0 で運用不可（Issue A'）。

### 6-4. IP制限

CROSSMALL APIはVPSの固定IP（160.251.227.206）からのみアクセス可能。ローカルからは実行不可。

### 6-5. キャッシュファイル

| ファイル | 用途 | 更新タイミング |
|---------|------|---------------|
| `data/purchase_master_cache.json` | 在庫マスタ + 販売統計（items: 数値インデックスキー、SKUは `.sku` フィールド） | crossmall-sync実行後 |
| `data/crossmall_sales_history.json` | 販売履歴（`sales: { [sku]: [{date, price, orderNumber, deliveryType}] }`） | crossmall-sync実行後 |

**PurchaseMasterCache更新**: `POST /api/cache/reload` エンドポイントで再読み込み（`pm2 restart` 不要）。

### 6-6. CrossmallDbService の主要関数

| 関数 | 処理 |
|------|------|
| `deriveBaseCode(itemCode)` | 末尾 `n` サフィックスを除去（例: `2314-001247n` → `2314-001247`） |
| `getStockAndPriceByBaseCode(baseCode)` | base_code で集約（n変種・通常品を合算）。stock合計・最新販売価格・sales7/28・配送種別を返す |
| `getStockAndPriceByItemCode(itemCode)` | 単一SKU照会 |

---

## 7. 在庫アラート機能（inventory-alert）

### 7-1. 設計仕様

参照: `PICOFURI-DESIGN-INVENTORY-ALERT-V2.1.md`

**対象SKU**: `2314-*` かつ（販売実績あり OR stock≥1）  
**デフォルトリードタイム**: `DEFAULT_LEAD_TIME=5`（日）

### 7-2. 分析アルゴリズム

```
1. 欠品日数算出（outOfStockSince から経過日数）
2. 期間別販売数（7日/14日/28日）
3. 実効日販計算（欠品期間を除外）
   effectiveDailyRate = sales / (periodDays - outOfStockDays)
4. 在庫日数（3期間の最短予測）
   stockDays = min(stock/rate28, stock/rate14, stock/rate7)
5. トレンド判定
   rate7/rate28 ≥ 1.5 → accelerating
   rate7/rate28 ≤ 0.5 → decelerating
   rate28<0.3 かつ rate7≥1.0 → new_surge
6. 有効残日数
   effectiveRemainingDays = stockDays - leadTime
7. 6段階分類
```

### 7-3. 6段階分類

| レベル | emoji | 条件 |
|--------|-------|------|
| `critical_accelerating` | 🔴📈 | stock>0, effectiveRemainingDays≤0, trend=accelerating/new_surge |
| `critical` | 🔴 | stock>0, effectiveRemainingDays≤0, trend=stable |
| `warning` | 🟡 | stock>0, effectiveRemainingDays≤4 |
| `ok` | 🟢 | stock>0, effectiveRemainingDays>4 |
| `out_of_stock` | ⚫ | stock=0 |
| `price_review` | 💰 | trend=decelerating（販売減速）|
| `dead_stock` | ⚪ | sales28=0 かつ effectiveRemainingDays=Infinity |

**分類優先順位**: critical_accelerating > out_of_stock > critical > warning > price_review > dead_stock > ok

### 7-4. 急減アラート

```
条件: 前回比50%以上減少
    かつ 有効残日数≤4日
    かつ 24時間以内に未送信
→ Telegramに即時送信
```

### 7-5. 2時間チェック

```
crossmall-stock-sync実行後に呼ばれる
条件: 🔴/⚫ SKUリストが前回と異なる（件数が同じでも中身変化なら送信）
→ Telegramに送信
```

### 7-6. 通知フォーマット

**LINE版（スリム）**:
```
📊 2026/04/27 08:00 在庫状況

🔴 即対応 3件
[SKU名 / 在庫N個 / 残X日]

⚫ 欠品中 5件（上位のみ）
[SKU名 / 欠品X日]

📦 補充検討 10件（上位のみ）
[SKU名 / 在庫N個 / 残X日]

📋 集計: 🔴3 🟡5 🟢10 ⚫5 💰2 ⚪1
```

**Telegram版（フル）**:
```
🔴/🟡 全件リスト
⚫ 30日以内の全件
💰 利益上位5件
本日補充リスト（昨日販売分）
```

### 7-7. 補充リスト

- 在庫日数30日以上はスキップ（在庫過多）
- 昨日判定はJST基準（`_getYesterdayJST()`）

### 7-8. InlineKeyboard（Telegram Bot）

```
inventoryCache Map（10分TTL）
  └─ handleInventory()
      ├─ サマリー（件数のみ）表示
      ├─ カテゴリ InlineKeyboard送信
      │   callback_data: 'cat:{category}' （64バイト制限内）
      └─ カテゴリ選択 → 詳細を新メッセージ送信
          └─ 戻るボタン → deleteMessage で詳細削除
```

---

## 8. Telegram Bot機能

### 8-1. ボット情報

| 項目 | 値 |
|------|-----|
| ボット名 | @picofuri_admin_bot |
| 管理者 | `TELEGRAM_ADMIN_ID`（環境変数）でADMIN_IDのみ操作可 |
| 動作方式 | long polling（`TelegramBot(token, { polling: true })`） |
| 会話状態管理 | `userStates Map`（step prefix方式: `reg:`, `del:` 等） |

### 8-2. 常設キーボード（MAIN_KEYBOARD）

```
[📋 一覧] [➕ 追加]
[🗑 削除]  [🚫 除外設定]
[💰 価格設定] [📦 在庫] [📊 ステータス]
```

### 8-3. 主要コマンド・ボタン動作

| ボタン | 動作 |
|--------|------|
| 📋 一覧 | 登録キーワード全件を価格範囲・プラットフォーム付きで表示 |
| ➕ 追加 | 対話式（キーワード → min_price → max_price → platforms → SKUコード） |
| 🗑 削除 | 番号選択で削除。min_price/max_price未設定時は明示的に0/999999を渡す |
| 🚫 除外設定 | キーワード選択 → 除外語句入力（カンマ区切り） |
| 💰 価格設定 | min_price/max_priceの変更 |
| 📦 在庫 | `generateAlert({skipRecommendations:true})` で即時サマリー表示 |
| 📊 ステータス | PM2プロセス状況・最終スキャン情報 |

### 8-4. フリマ推奨の即追加

```
callback_data: 'add:{sku}'
  → handleAddMonitor()
      → Keyword.create()（min_price=0, max_price=999999 を明示）
      → editMessageReplyMarkup でボタンを「追加済み」に更新
```

---

## 9. データ構造

### 9-1. DBテーブル一覧

#### Keywords テーブル

| カラム | 型 | 内容 |
|--------|-----|------|
| id | UUID | PK |
| user_id | UUID | FK → Users |
| keyword | STRING(100) | 監視キーワード |
| min_price | DECIMAL(10,2) | 最低価格（DEFAULT 0、NULLは渡さないこと） |
| max_price | DECIMAL(10,2) | 最高価格（DEFAULT 999999、NULLは渡さないこと） |
| exclude_keywords | TEXT | 除外キーワード（カンマ区切り） |
| global_exclude_enabled | BOOLEAN | 全体除外キーワード有効フラグ（DEFAULT true） |
| platforms | JSON | `{mercari:true, yahoo_flea:true, rakuma:true, yahoo_auction:true}` |
| conditions | JSON | 商品状態フィルタ |
| free_shipping_only | BOOLEAN | 送料無料のみ（DEFAULT false） |
| line_group_id | STRING(50) | LINE通知先グループID |
| crossmall_item_code | STRING(50) | CROSSMALL商品コード（n変種を含む） |
| item_codes | TEXT | 紐付けSKUコード（カンマ区切り複数可） |
| is_active | BOOLEAN | 監視有効フラグ（DEFAULT true） |
| detection_count | INTEGER | 検出商品数（DEFAULT 0） |
| last_checked_at | DATE | 最終チェック日時 |

**重要**: `min_price`/`max_price` は DB で NOT NULL。`Keyword.create()`/`update()` で価格未設定時は明示的に `0`/`999999` を渡すこと（`null` を渡すと SQLITE_CONSTRAINT → SequelizeUniqueConstraintError の誤認を誘発）。

#### Products テーブル

| カラム | 型 | 内容 |
|--------|-----|------|
| id | UUID | PK |
| keyword_id | UUID | FK → Keywords（CASCADE DELETE） |
| platform | ENUM | mercari / yahoo_flea / rakuma / yahoo_auction |
| product_id | STRING | プラットフォーム側の商品ID |
| title | STRING(500) | 商品タイトル |
| price | DECIMAL(10,2) | 価格 |
| url | TEXT | 商品URL |
| image_url | TEXT | 画像URL（nullable） |
| condition | STRING | 商品状態（nullable） |
| seller_id | STRING | 出品者ID（nullable） |
| free_shipping | BOOLEAN | 送料無料フラグ（nullable） |
| listed_at | DATE | 出品日時（nullable） |
| notified | BOOLEAN | 通知済みフラグ（DEFAULT false） |

**ユニーク制約**: `(keyword_id, product_id)`  
**自動削除**: notified=true かつ作成から30日超を次回スキャン冒頭で削除

#### crossmall_items テーブル

| カラム | 型 | 内容 |
|--------|-----|------|
| item_code | TEXT | PK（SKU） |
| item_name | TEXT | 商品名 |
| unit_price | DECIMAL | 単価 |
| base_code | TEXT | 末尾n除去コード |
| synced_at | DATE | 同期日時 |

#### crossmall_stock テーブル

| カラム | 型 | 内容 |
|--------|-----|------|
| item_code | TEXT | PK（SKU） |
| stock_count | INTEGER | 在庫数 |
| synced_at | DATE | 同期日時 |

#### crossmall_sales テーブル

| カラム | 型 | 内容 |
|--------|-----|------|
| order_number | STRING | PK（複合） |
| line_no | INTEGER | PK（複合）、item_codeソートで採番 |
| item_code | STRING | SKU |
| order_date | DATE | 受注日 |
| amount | INTEGER | 数量 |
| unit_price | DECIMAL | 単価 |
| delivery_type | STRING | 配送種別名 |
| synced_at | DATE | 同期日時 |

**保持期間**: 90日超は自動パージ（crossmall-sync実行時）

#### その他のテーブル

| テーブル | 用途 |
|---------|------|
| Users | ユーザー認証（シングルテナント） |
| Notifications | 通知履歴 |
| PriceHistory | 価格変動追跡 |
| Settings | システム設定（Layer A閾値含む） |
| AuditLog | 操作監査ログ |
| LineLinkCode | LINEアカウント連携（レガシー） |

---

### 9-2. 主要JSONキャッシュファイル（`data/` ディレクトリ）

| ファイル | 用途 | 更新者 |
|---------|------|--------|
| `purchase_master_cache.json` | 在庫マスタ + 販売統計（items: 数値インデックスキー、SKUは `.sku` フィールド） | crossmall-sync |
| `crossmall_sales_history.json` | 販売履歴（`{sales: {[sku]: [{date, price, orderNumber, deliveryType}]}}`） | crossmall-sync |
| `inventory_alert_history.json` | アラート送信履歴（重複送信防止用、日付キー） | inventory-alert |
| `inventory_alert_state.json` | アラート状態（`outOfStockSince`, `previousStock`, `lastTwoHourCheckSkus`） | crossmall-stock-sync |
| `health_check_state.json` | 再起動回数の前回値・前回チェック時刻 | health-check |
| `crossmall_itemcode_mapping.json` | SKU → base_code手動マッピング | 手動 |
| `crossmall_items.tsv` | アイテムマスタTSVダンプ | 手動 |
| `global_exclude_keywords.json` | システム全体の除外キーワードリスト | 手動 |

---

## 10. 環境変数（.env）

設定ファイルパス: `server/.env`

### アプリケーション設定

| 変数名 | デフォルト値 | 説明 |
|--------|------------|------|
| `NODE_ENV` | `development` | **必ず development**。productionにするとPostgreSQL接続エラー |
| `PORT` | `3001` | Expressサーバーポート |
| `DATABASE_URL` | `sqlite:./database.sqlite` | DB接続文字列 |
| `ENABLE_SCHEDULER` | `true` | スクレイピングスケジューラー有効化 |

### スクレイピング設定

| 変数名 | デフォルト値 | 説明 |
|--------|------------|------|
| `SCRAPING_INTERVAL` | `*/10 * * * *` | スクレイピングcron式 |
| `SCRAPING_CONCURRENCY` | `3` | キーワード並列処理数 |
| `SCRAPING_METHOD` | `puppeteer` | スクレイパー種別 |
| `PUPPETEER_HEADLESS` | `true` | ヘッドレス動作 |
| `PUPPETEER_TIMEOUT` | `30000` | Puppeteerタイムアウト（ms） |

### LINE設定

| 変数名 | 説明 |
|--------|------|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging APIチャンネルアクセストークン |
| `LINE_CHANNEL_SECRET` | LINEチャンネルシークレット |
| `LINE_GROUP_ID` | 通知先LINEグループID（例: `C6f948420b716fbb3daa6da26b69d483d`） |
| `LINE_NOTIFY_ENABLED` | `true` / `false`（緊急停止用） |
| `LINE_NOTIFY_NEW_PRODUCTS` | `true`（新着通知有効） |
| `LINE_NOTIFY_PRICE_DROP` | `false`（価格下落通知無効） |

### Telegram設定

| 変数名 | 説明 |
|--------|------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot APIトークン |
| `TELEGRAM_ADMIN_ID` | 管理者のTelegram User ID（例: `8656466812`） |

### CROSSMALL設定

| 変数名 | 説明 |
|--------|------|
| `CROSSMALL_API_URL` | `https://crossmall.jp/webapi2` |
| `CROSSMALL_ACCOUNT` | `3663`（アカウントID） |
| `CROSSMALL_API_KEY` | APIキー |

### その他

| 変数名 | デフォルト値 | 説明 |
|--------|------------|------|
| `LOG_LEVEL` | `info` | ログレベル |
| `RUN_LOG_ENABLED` | `true` | RunLogger有効化 |
| `DEFAULT_LEAD_TIME` | `5` | 在庫アラートのデフォルトリードタイム（日） |

---

## 11. 防御レイヤー（7重防御）

```
【クラッシュ・メモリリーク対策の7重防御】

第1層: browser.close() finally + SIGKILL
  - scrapeAllKeywords() の finally ブロックで全ブラウザを強制close
  - MercariPuppeteerScraper._forceCloseBrowser() で PID SIGKILL
  - YahooFleaScraper も独立ブラウザを毎回生成・破棄

第2層: BrowserPool MAX=12
  - 同時起動ブラウザを12個に制限
  - 超過時は60秒でタイムアウトしてエラー
  - FIFO キューで順番待ち

第3層: chrome-cleanup（30分毎、Temp掃除含む）
  - 孤立Chrome: 5分超でtaskkill
  - backend子Chrome: 3分超でtaskkill
  - puppeteer_dev_*: 即時削除
  - Tempファイル: 1時間超で削除

第4層: PM2 max-memory-restart 500MB
  - picofuri-backend が500MBを超えると自動restart
  - telegram-bot は200MB上限

第5層: pm2-logrotate
  - PM2ログファイルの自動ローテーション
  - ディスク逼迫防止

第6層: health-check + LINE broadcast警告
  - 30分ごとに全指標監視
  - 異常時のみLINE broadcast送信

第7層: レースコンディション対策（FK確認）
  - scrapeKeyword() でDB保存前にKeyword.findByPk()で存在確認
  - スキャン中のキーワード削除によるFOREIGN KEY エラーを防ぐ
```

---

## 12. ヘルスチェックの監視項目と閾値

実装ファイル: `server/scripts/health-check.cjs`

### 全監視項目

| 監視項目 | Warning閾値 | Critical閾値 | 取得方法 |
|---------|------------|-------------|---------|
| ディスク空き容量 | < 5GB | < 2GB | `(Get-PSDrive C).Free`（PowerShell） |
| Tempフォルダサイズ | > 10GB | > 20GB | 再帰サイズ計算（10秒タイムアウト） |
| メモリ使用率 | > 92% | > 97% | `wmic OS get FreePhysicalMemory,TotalVisibleMemorySize` |
| Chromeプロセス数 | > 50個 | > 80個 | `tasklist \| findstr chrome.exe` |
| picofuri-backendのstatus | - | online以外 | `pm2 jlist` |
| 30分間の再起動回数 | - | ≥ 5回増加 | `pm2 jlist` の restart_time 差分 |
| スクレイピング処理時間 | > 600秒 | - | PM2ログ解析 |
| Mercari成功率 | < 50% | < 25% | PM2ログ解析 |
| Yahoo!フリマ成功率 | < 80% | - | PM2ログ解析 |

### 判定ロジック

```
1件でもok=false → LINE broadcast送信
criticalが1件以上 → メッセージ冒頭に「🚨 緊急」
warningのみ → 「⚠️ 警告」
```

### ログ解析の仕組み

`~/.pm2/logs/picofuri-backend-out.log` の末尾10,000行から最新完了スキャンを抽出:
- スキャン開始: `"定期スクレイピング開始"` を含む行
- スキャン終了: `"全キーワードのスクレイピング完了"` を含む行
- Mercari成功: `"✅ .+ → \d+件取得"` パターン
- Yahoo成功: `"✅ Yahoo!フリマ.*整形完了"` パターン

---

## 13. 操作手順

### 13-1. 通常運用での確認コマンド

```bash
# プロセス一覧確認
pm2 list

# プロセス詳細確認
pm2 show picofuri-backend

# リアルタイムログ
pm2 logs picofuri-backend
pm2 logs telegram-bot
pm2 logs crossmall-sync

# 最新ログ（直近200行）
pm2 logs picofuri-backend --lines 200

# リソース使用状況（リアルタイム）
pm2 monit
```

### 13-2. ログの見方

```
【PM2ログファイルの場所】
標準出力: C:\Users\Administrator\.pm2\logs\{name}-out.log
標準エラー: C:\Users\Administrator\.pm2\logs\{name}-error.log

【RunLogger（スクレイピング詳細ログ）】
server/logs/ 配下に日次ファイル（RUN_LOG_ENABLED=true 時）

【重要なログパターン】
✅ 全キーワードのスクレイピング完了（XX件 / YY秒）  ← スキャン完了
🤖 定期スクレイピング開始                           ← スキャン開始
❌ LINE通知送信エラー                                ← LINE障害
🚨 ゾンビChrome kill: PID XXXX                      ← Chrome蓄積
⚠️ scrapeAllKeywords: 前回スキャンが進行中          ← 重複起動スキップ
```

### 13-3. PM2基本操作

```bash
# 再起動（env変更時は --update-env 必須）
pm2 restart picofuri-backend --update-env
pm2 restart telegram-bot --update-env

# 停止・起動
pm2 stop picofuri-backend
pm2 start picofuri-backend

# 削除（承認後のみ）
# pm2 delete picofuri-backend  ← オーナー承認後のみ実行

# 設定を永続化（プロセス追加・削除後）
pm2 save

# pm2 resurrect（OS再起動後の自動復旧）
pm2 startup  # 初回のみ実行
```

### 13-4. picofuri-backend の安全な再起動タイミング

```
スキャン間隔: 10分
スキャン実行時間: 約250秒（通常）

1. pm2 logs picofuri-backend で「次回実行予定」または
   「全キーワードのスクレイピング完了」を確認
2. スキャン終了直後（空白3〜4分）に restart
3. 数秒で起動完了 → スキャン欠落なし
```

### 13-5. ブランチ戦略

```bash
# 必ず作業ブランチを切る（mainへの直接pushは禁止）
git checkout -b feat/機能名
git checkout -b fix/バグ名
git checkout -b refactor/リファクタ名

# 差分確認（マージ前必須）
git diff main

# マージ: オーナー承認後のみ
# 問題時の即復旧
git revert HEAD
```

### 13-6. 緊急時: LINE通知停止

```bash
# .env に追記
LINE_NOTIFY_ENABLED=false

# 反映
pm2 restart picofuri-backend --update-env

# 復旧時
LINE_NOTIFY_ENABLED=true
pm2 restart picofuri-backend --update-env
```

---

## 14. トラブルシューティング

### 14-1. VPSフリーズ（ConoHa管理画面から）

```
1. ConoHa コンソールにログイン
2. 対象VPSを選択 → 「強制再起動」
3. VPS起動後: pm2 resurrect（pm2 startupで登録済みなら自動起動）
4. pm2 list でプロセス確認
5. pm2 save で設定を再保存（念のため）
```

### 14-2. ディスク満杯

```bash
# Tempディレクトリ確認（PowerShell）
(Get-ChildItem $env:TEMP | Measure-Object -Property Length -Sum).Sum / 1GB

# 手動クリーンアップ
node server/scripts/cleanup-chrome.cjs

# PM2ログ削除
pm2 flush

# data/*.json のサイズ確認
ls -lah data/
```

### 14-3. Chrome蓄積（50個超）

```bash
# Chromeプロセス数確認
tasklist | findstr chrome.exe | wc -l

# 手動クリーンアップ実行
node server/scripts/cleanup-chrome.cjs

# それでも蓄積する場合 → picofuri-backend 再起動
pm2 restart picofuri-backend --update-env
```

### 14-4. メルカリ商品0件

```bash
# セレクタ変更の確認
# server/services/MercariPuppeteerScraper.js の _extractProducts() を確認
# デバッグスクリーンショット確認（取得後に自動保存）
ls server/debug-mercari-page.png

# セレクタ変更の場合: data-testid="item-cell" が廃止されていないか確認
```

### 14-5. LINE通知未着

```bash
# トークン有効確認
curl -X GET https://api.line.me/v2/bot/info \
  -H "Authorization: Bearer {LINE_CHANNEL_ACCESS_TOKEN}"

# グループID確認（LINE_GROUP_ID が正しいか）
# Messaging API → Webhook で受信イベントのdestination確認

# 実際の送信ログ確認
pm2 logs picofuri-backend | grep "LINE通知"
```

### 14-6. crossmall-syncの反映 → 在庫情報が古い

```bash
# 手動でcache reload（pm2 restart不要）
curl -X POST http://localhost:3001/api/cache/reload

# crossmall-sync を手動実行
node server/scripts/sync-crossmall-prices.cjs

# crossmall-stock-sync を手動実行
node server/scripts/sync-crossmall-stock.cjs
```

### 14-7. DBマイグレーション失敗

```bash
# マイグレーション実行前に必ずバックアップ
cp server/database.sqlite server/database.sqlite.bak_$(date +%Y%m%d_%H%M%S)

# undo は慎重に（連鎖でproductsテーブルまで消えるリスクあり）
# undo前に db:migrate:undo のdown定義を事前確認すること
```

### 14-8. LINE通知フラッド（大量送信）

```bash
# 即時停止
echo "LINE_NOTIFY_ENABLED=false" >> server/.env
pm2 restart picofuri-backend --update-env

# 原因調査（is_notifiedバグが主因の可能性）
# products テーブルの notified カラムを確認
```

### 14-9. CROSSMALL API認証エラー

```
原因1: IP制限 → VPSのIPが変更されていないか確認（160.251.227.206）
原因2: APIキー有効期限 → CROSSMALL管理画面で確認
原因3: updated_at_fr に時刻付きdatetimeを渡した → YYYY-MM-DDのみ使用（Issue A'）
原因4: conditionパラメータを付けた → 署名エラー → 使用禁止
```

---

## 15. 既知の制約・未解決課題

### 15-1. 技術的制約

| 制約 | 詳細 |
|------|------|
| CROSSMALL API 100件上限 | 1リクエストあたりの上限。order_numberページネーションで回避 |
| PurchaseMasterCacheの手動reload | `POST /api/cache/reload` が必要（pm2 restartはこの目的では不要） |
| crossmall-stock-syncの低速性 | 162件×1秒≒3分。get_diff_stockが使えれば30秒未満になるが Issue A'により未実現 |
| SQLite書き込み競合 | busy_timeout=10000msで対処。高負荷時はPostgreSQL移行が根本解決 |
| Windows専用 | `tasklist`/`wmic`/PowerShellコマンドを使用。Linux非対応 |
| BrowserPool 60秒タイムアウト | 12ブラウザ全使用中に新規取得すると60秒後にエラー |

### 15-2. 未解決Issue

**Issue A'（CROSSMALL get_diff_stock）**:
> `get_diff_stock` / `get_item` の `updated_at_fr` に `HH:MM:SS` 付き datetimeを渡すと、署名方式によらず認証エラー。`YYYY-MM-DD`（日付のみ）は認証OKだが TotalResult=0 で運用不可。真因はCROSSMALL問い合わせが必要。

**Issue A''（crossmall-stock-sync高速化）**:
> Issue A' が解決すれば get_diff_stock で30秒未満に短縮可能。代替として待機500ms→250msへの短縮余地あり。

### 15-3. 既知の障害リスク

| リスク | 影響 | 対処 |
|--------|------|------|
| メルカリDOM変更（data-testid廃止） | スクレイピング0件 | セレクタのフォールバック強化が必要 |
| LINE通知未着（ログ上は成功） | 仕入れ機会損失 | 未解決（LINE API側の問題の可能性） |
| SQLite×高並列書き込み | ロックエラー | 高負荷時はPostgreSQL移行 |
| Chrome CAPTCHA | メルカリ0件 | 検知のみ、バイパス不可 |

### 15-4. 未実装機能

- 在庫アラート Phase 4（曜日パターン分析・セット品統合）
- メルカリセレクタのフォールバック強化（data-testid廃止リスク対応）

---

## 16. ファイル構成

```
flea-market-monitor/
│
├── CLAUDE.md                          作業ルール・重要な教訓
├── package.json                       フロントエンド依存（React + Vite）
├── vite.config.js                     Viteビルド設定
├── index.html                         SPAエントリーポイント
│
├── docs/
│   ├── PICOFURI-SYSTEM-OVERVIEW.md    本ドキュメント
│   └── (設計ドキュメント各種)
│
├── client/                            React フロントエンド
│   └── src/                           コンポーネント・ページ
│
├── data/                              ランタイムキャッシュ（Git管理外）
│   ├── purchase_master_cache.json     在庫マスタ（items: 数値インデックス）
│   ├── crossmall_sales_history.json   販売履歴 + 前回同期状態
│   ├── inventory_alert_history.json   アラート送信履歴（重複防止）
│   ├── inventory_alert_state.json     在庫アラート状態（急減・2時間チェック）
│   ├── health_check_state.json        ヘルスチェック状態（再起動カウント）
│   ├── crossmall_itemcode_mapping.json SKU→base_code手動マッピング
│   ├── crossmall_items.tsv            アイテムマスタTSV
│   └── global_exclude_keywords.json   システム全体除外キーワード
│
└── server/
    ├── server.js                      エントリーポイント（DB接続→Express→Scheduler）
    ├── app.js                         Express設定・ルーター登録・Middleware
    ├── database.sqlite                SQLiteデータベース（開発環境）
    ├── package.json                   バックエンド依存（Express, Puppeteer等）
    │
    ├── config/
    │   ├── database.js                Sequelize設定
    │   ├── layerA.json                Layer Aフィルタ閾値（評価/時間/期限）
    │   └── globalExcludeKeywords.js   グローバル除外キーワード設定
    │
    ├── models/
    │   ├── index.js                   Sequelizeモデル初期化・エクスポート
    │   ├── Keyword.js                 監視キーワード
    │   ├── Product.js                 スクレイピング結果
    │   ├── CrossmallItem.js           CROSSMALL商品マスタ
    │   ├── CrossmallStock.js          CROSSMALL在庫
    │   ├── CrossmallSale.js           CROSSMALL販売履歴
    │   ├── User.js                    ユーザー認証
    │   ├── Notification.js            通知履歴
    │   ├── PriceHistory.js            価格変動
    │   ├── Setting.js                 システム設定
    │   ├── AuditLog.js                操作監査
    │   └── LineLinkCode.js            LINEアカウント連携（レガシー）
    │
    ├── services/
    │   ├── ScrapingService.js         スクレイピング統括（メインループ）
    │   ├── MercariPuppeteerScraper.js メルカリスクレイパー
    │   ├── YahooFleaScraper.js        Yahoo!フリマスクレイパー
    │   ├── PayPayPuppeteerScraper.js  PayPayフリマ（非推奨）
    │   ├── BrowserPool.cjs            ブラウザ同時起動制限セマフォ（MAX=12）
    │   ├── LineNotificationService.js LINE通知（pushMessage + broadcast）
    │   ├── LineService.js             LINE API補助
    │   ├── CrossmallService.js        CROSSMALL API クライアント
    │   ├── CrossmallDbService.js      CROSSMALL DBクエリ（deriveBaseCode等）
    │   ├── CrossmallSalesHistory.js   販売履歴状態管理（JSON）
    │   ├── InventoryAlertService.js   在庫アラート分析（6段階分類）
    │   ├── PurchaseMasterCache.js     purchase_master_cache.jsonの読み込み
    │   ├── SchedulerService.js        node-cronスケジューラー
    │   └── LayerAFilterService.js     Layer Aフィルタ（5条件判定）
    │
    ├── scripts/
    │   ├── health-check.cjs           VPSヘルスチェック（cron: 0,30 * * * *）
    │   ├── cleanup-chrome.cjs         Chrome/Tempクリーンアップ（cron: */30 * * * *）
    │   ├── sync-crossmall-prices.cjs  受注データ蓄積（cron: 0 */2 * * *）
    │   ├── sync-crossmall-stock.cjs   在庫同期（cron: */30 * * * *）
    │   ├── sync-crossmall-items.cjs   商品マスタ同期（cron: 30 3 * * *）
    │   ├── inventory-alert.cjs        毎朝サマリー（cron: 0 23 * * *）
    │   ├── telegram-bot.cjs           Telegram Bot（常時起動）
    │   ├── db-cleanup.cjs             DB古レコード削除（レガシー、PM2未登録）
    │   ├── import-n-variants.cjs      n変種一括インポート（手動）
    │   ├── migrate-keywords-to-item-codes.cjs  マイグレーション（手動）
    │   ├── migrate-sales-history.cjs   販売履歴マイグレーション（手動）
    │   └── (test-*.cjs)               テスト用スクリプト
    │
    ├── routes/
    │   ├── auth.js                    認証 API
    │   ├── keywords.js                キーワード CRUD API
    │   ├── products.js                商品照会 API
    │   ├── scraping.js                手動スクレイピングトリガー
    │   ├── sync.js                    CROSSMALL同期トリガー
    │   └── settings.js                設定管理 API
    │
    ├── middleware/                     Express ミドルウェア
    ├── controllers/                    コントローラー
    ├── migrations/                     Sequelizeマイグレーション
    ├── logs/                           RunLogger日次ログファイル
    └── src/
        └── utils/
            └── RunLogger.js           スクレイピング詳細ログ（logs/配下に書き込み）
```

---

## 付録: クイックリファレンス

### 正常動作の確認チェックリスト

```
[ ] pm2 list → picofuri-backend: online
[ ] pm2 list → telegram-bot: online
[ ] pm2 logs picofuri-backend | grep "定期スクレイピング開始" → 10分以内に存在
[ ] pm2 logs picofuri-backend | grep "全キーワードのスクレイピング完了" → 存在
[ ] data/purchase_master_cache.json → 更新日時が2時間以内
[ ] data/crossmall_sales_history.json → 更新日時が2時間以内
```

### よく使うコマンド一覧

```bash
pm2 list                          # プロセス一覧
pm2 logs picofuri-backend -f      # リアルタイムログ
pm2 restart picofuri-backend --update-env  # 再起動（.env変更時）
pm2 show crossmall-sync           # cronジョブ設定確認

node server/scripts/health-check.cjs      # ヘルスチェック手動実行
node server/scripts/cleanup-chrome.cjs   # Chrome手動クリーンアップ
node server/scripts/sync-crossmall-prices.cjs  # 受注データ手動同期
node server/scripts/sync-crossmall-stock.cjs   # 在庫手動同期
node server/scripts/inventory-alert.cjs  # 在庫アラート手動実行

curl -X POST http://localhost:3001/api/cache/reload  # キャッシュ再読み込み
```

---

*本ドキュメントは実装コードを直接参照して作成した。推測による記述はない。*
