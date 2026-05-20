# ピコフリ セッションログ 2026-05-20

## 完了した作業一覧

### 1. Yahoo!フリマ 商品状態フィルタ実装（`feat: 商品状態フィルタ追加`）
- **コミット**: `568f88f`
- **ブランチ**: `fix/yahoo-condition-filter` → master マージ済み
- LayerAFilterService.js に条件5.5を追加（`ALLOWED_CONDITIONS = ['新品、未使用']`）
- NG_WORDS に商品状態ラベルを追加（未使用に近い・目立った傷や汚れなし等）
- YahooFleaScraper.js で condition 抽出を追加（search結果HTMLでは取得不可のため NG_WORDS が主防御）

### 2. 過剰在庫スキップ（`fix: 過剰在庫のLINE通知をスキップ`）
- **コミット**: `9749417`
- **ブランチ**: `fix/skip-overstock-notification` → master マージ済み
- ScrapingService.js でLayer A通過後・通知前に在庫日数チェックを追加
- 在庫日数 > 60日 または ∞（sales28=0）の場合は通知スキップ

### 3. セット商品の単価自動検出（`feat: セット商品の単価自動検出・利益計算に適用`）
- **コミット**: `ccc12a5`
- **ブランチ**: `fix/set-product-unit-price` → master マージ済み
- `server/utils/priceUtils.js` 新規作成（`detectSetQuantity()`）
- タイトルから2〜10個セットを検出（×N/N個セット/N袋/N本/N点/N箱）
- ScrapingService.js でsetQty・unitPrice算出、LINE通知に反映
- LineNotificationService.js で `effectivePrice`（単価換算）で利益計算

### 4. 1キーワード複数SKU対応 フェーズ1: DB・マッチングロジック（`feat(phase1)`）
- **コミット**: `43885ab`
- `server/models/KeywordVariant.js` 新規作成（keyword_variantsテーブル定義）
- `server/migrations/20260520000001-create-keyword-variants.js` 新規作成・実行済み
- `server/utils/variantMatcher.js` 新規作成（`matchVariant(title, variants)`）
- `server/models/index.js` にKeywordVariant追加・アソシエーション定義

### 5. 1キーワード複数SKU対応 フェーズ2: 通知への適用（`feat(phase2)`）
- **コミット**: `3d8b9df`
- ScrapingService.js にバリアントプリロードブロック追加（④.5）
- 全バリアントのCROSSMALL情報をloop前に一括取得（variantCrossmallMap）
- productCrossmallInfo / variantUnknown を通知パラメータに反映
- LineNotificationService.js に `variantUnknown` 警告表示追加

### 6. 1キーワード複数SKU対応 フェーズ3: Telegram Bot UI（`feat(phase3)`）
- **コミット**: `dc3ab82`
- telegram-bot.cjs に `🧬 バリアント` ボタン追加（MAIN_KEYBOARD 4行目）
- バリアント追加フロー: 商品コード入力 → CROSSMALL照合 → バリアント名 → マッチワード → 確認 → 登録
- バリアント削除フロー: 一覧表示 → 選択 → 確認 → 実行
- callback_data: `vmenu_` / `vadd_` / `vdel_` / `vdelc_` / `vdelx_` / `vdone_`
- userStates step: `var:code` / `var:name` / `var:words` / `var:confirm`

### 7. detectSetQuantity() 全角数字対応（`fix: 全角数字対応`）
- **コミット**: `e623639`
- priceUtils.js 先頭で全角数字（０-９）・全角スペースを半角に正規化
- 「２袋セット」「１０本セット」等が正しく検出されるように
- テスト: 8/8 passed（全角・半角・境界値）

### 8. calcJudgement() 判定ワード刷新（`fix: calcJudgement()を判定ワード刷新`）
- **コミット**: `4d46d34`
- LineNotificationService.js の calcJudgement() を3値→10値に細分化
- 新判定: ⚠️個数確認 / ❌赤字 / ❌利益なし / ❌利益薄い / 🚨緊急仕入 / 💎高利益 / ✅即買い / 🔥レア即買 / 🤔売行鈍い / 🤔要検討
- テスト: 18/18 passed（境界値全件）

---

## 変更ファイル一覧

| ファイル | 変更種別 | 関連コミット |
|---|---|---|
| `server/services/LayerAFilterService.js` | 修正 | 568f88f |
| `server/services/YahooFleaScraper.js` | 修正 | 568f88f |
| `server/services/ScrapingService.js` | 修正 | 9749417, 43885ab, 3d8b9df |
| `server/services/LineNotificationService.js` | 修正 | ccc12a5, 3d8b9df, 4d46d34 |
| `server/utils/priceUtils.js` | 新規 | ccc12a5, e623639 |
| `server/utils/variantMatcher.js` | 新規 | 43885ab |
| `server/models/KeywordVariant.js` | 新規 | 43885ab |
| `server/models/index.js` | 修正 | 43885ab |
| `server/migrations/20260520000001-create-keyword-variants.js` | 新規 | 43885ab |
| `server/scripts/telegram-bot.cjs` | 修正 | dc3ab82 |

---

## 発見された事実・教訓

### 出品レア度（totalListingCount）は常に取得失敗
- YahooFleaScraper.js の `page.evaluate()` でDOMから「N件」形式を探しているが一度もヒットしていない
- `catch(_) {}` で黙って握り潰しているため長期間気づかなかった
- Mercari は実装自体なし（totalListingCount をセットしていない）
- 結果: `rarityLabel` が常に `''` → `isRare = false` → レア判定は全通知で無効状態
- 修正するにはYahoo!フリマの実際のDOM構造を調査してセレクタを特定する必要あり

### telegram-bot.cjs 編集の罠（再確認）
- CRLF + UTF-8多バイト文字の組み合わせで Edit ツールが失敗する
- 全ての編集は `node スクリプト.cjs` 経由（Write tool でスクリプト作成 → node実行）
- `node -e` は shell quoting で `\n` が実際の改行に化けるケースあり → スクリプトファイル方式が確実
- プロジェクトルートは `"type": "module"` のため `.cjs` 拡張子必須

### keyword_variants テーブル
- マイグレーション実行済み（DB作成確認済み）
- UUID PK、keyword_id（FK）、item_code（50文字）、variant_name（100文字）、match_words（JSON TEXT）、sort_order
- Telegram Bot から直接操作可能（DBアクセス不要）

---

## 未完了タスク・次回やること

### 優先度高
1. **出品レア度の修正**: Yahoo!フリマのDOM調査 → `totalListingCount` 取得セレクタ修正
   - 現状: 常に「取得失敗」表示
   - Mercari も実装追加が必要

2. **バリアント機能の実運用テスト**: 実際にキーワードにバリアントを登録して通知が正しく振り分けられるか確認

### 優先度中
3. **在庫アラート Phase 4**: 曜日パターン・セット品統合（未実装）
4. **Issue A''**: crossmall-stock-sync の高速化（get_diff_stock 未使用、現状30秒間隔で約5分）

### 既知の未解決課題（引き継ぎ）
- LINE通知未着（ログ上は送信成功だが届かないケースあり）
- メルカリセレクタのフォールバック強化（data-testid廃止リスク）
- Issue A'（未解決）: CROSSMALL get_diff_stock の datetime パラメータ認証エラー

---

## 現在のPM2プロセス構成

| id | name | status | uptime | memory |
|---|---|---|---|---|
| 4 | picofuri-backend | online | 2m | 80.6mb |
| 5 | telegram-bot | online | 24m | 77.8mb |
| 6 | cc-bot | online | 30D | 33.2mb |
| 11 | pricera-bot | online | 4h | 151.7mb |
| 17 | pricera-dashboard | online | 3h | 80.6mb |
| 18 | pricera-tunnel | online | 14h | 31.1mb |
| 1 | crossmall-sync | stopped (cron) | - | - |
| 2 | chrome-cleanup | stopped (cron) | - | - |
| 7 | inventory-alert | stopped (cron) | - | - |
| 8 | crossmall-items-sync | stopped (cron) | - | - |
| 9 | crossmall-stock-sync | stopped (cron) | - | - |
| 12 | health-check | stopped (cron) | - | - |
| 0 | pm2-logrotate | online (module) | - | 65.2mb |
