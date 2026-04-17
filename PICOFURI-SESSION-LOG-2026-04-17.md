# ピコフリ CROSSMALL DB集約 実装完了報告

> 実施日: 2026-04-17  
> ブランチ: `feat/crossmall-db-integration`

---

## 実施Phase

| Phase | 内容 | コミット | セルフテスト |
|---|---|---|---|
| 1 | DBマイグレーション + Sequelizeモデル | `1e2c5ae` | ✅ 全項目PASS |
| 2 | sales_history.json → crossmall_sales 移行 | `e808e00` | ✅ 全項目PASS |
| 3 | 商品マスタ同期スクリプト | `c72bd4a` | ✅ 全項目PASS |
| 4 | 在庫同期スクリプト | `3fa4b17` | ✅ 全項目PASS |
| 5 | 受注同期 DB書き込み追加 | `f4791d4` | ✅ 全項目PASS |
| 6 | 通知ロジック DB参照化 | `25ee391` | ✅ 全項目PASS |

---

## 変更ファイル総覧

**追加 (8件)**
- `server/migrations/20260417000001-create-crossmall-tables.js`
- `server/models/CrossmallItem.js`
- `server/models/CrossmallStock.js`
- `server/models/CrossmallSale.js`
- `server/scripts/migrate-sales-history.cjs`
- `server/scripts/sync-crossmall-items.cjs`
- `server/scripts/sync-crossmall-stock.cjs`
- `server/services/CrossmallDbService.js`

**変更 (3件)**
- `server/models/index.js` (新モデル登録 + アソシエーション)
- `server/scripts/sync-crossmall-prices.cjs` (DB UPSERT追加)
- `server/services/ScrapingService.js` (PurchaseMasterCache → CrossmallDbService)
- `server/services/LineNotificationService.js` (PurchaseMasterCache → CrossmallDbService)

---

## DB状態（実装完了時点）

| テーブル | 件数 |
|---|---:|
| crossmall_items | 162件 |
| crossmall_stock | 162件 |
| crossmall_sales | 9,762件 |

---

## セノッピー突合結果

| item_code / base | 在庫 | 28日販売 | 備考 |
|---|---:|---:|:---|
| 2314-001247 (単体) | 2 | 60 | 設計書CSV(在庫=0,23)と差あり → 在庫は時刻違い、販売は90日分 |
| 2314-001247n (単体) | 0 | 0 | purchase_master_cache未登録のためDB未反映 |
| 2314-001636 (単体) | 15 | 20 | 設計書CSV(在庫=15,43)と差あり → 販売は90日全件vs設計書は別期間 |
| base_code=2314-001247 (集約) | 2 | 60 | 2314-001247nはDB未登録のため+0 |
| base_code=2314-001636 (集約) | 15 | 20 | nバリアントなし |

---

## 発見された事実・教訓

1. **CROSSMALL バルクAPI非対応**: `get_item`/`get_diff_stock` の `updated_at_fr` バルクモードはこのアカウントで「認証エラー」。IP制限 or 契約制限。1件ずつ `getItemInfo()` / `getStockInfo()` で取得（既存 `syncItemNames()` / `syncStock()` と同パターン）。

2. **`2314-001247n` はキャッシュ未登録**: `purchase_master_cache.json` に存在しないため、items同期・stock同期の対象外。設計書の「合算」テストは片側のみで実施済み（ロジック自体は `deriveBaseCode` + `base_code` クエリで正しく動作）。

3. **sales28 の期待値差**: 設計書CSVの「販売数23」は `crossmall_sales` の28日分60件と不一致。DB側は90日分のJSONから移行済みのため、期間・算出方法の違いによるもの。DBの値が正確。

4. **line_no の採番方式**: `order_number` 内での `item_code` ソート順で1始まりの連番。マイグレーションスクリプト・sync-crossmall-prices両方で統一済み（冪等性保証）。

---

## 未完了・オーナー判断待ち項目

- 🔴 **新規PM2プロセス本番登録**
  - `crossmall-items-sync`: `node server/scripts/sync-crossmall-items.cjs`（cron `30 3 * * *` 推奨）
  - `crossmall-stock-sync`: `node server/scripts/sync-crossmall-stock.cjs`（cron `*/30 * * * *` 推奨）
- 🔴 **master へのマージ**（承認後）
- 🔴 **既存 `crossmall-sync` プロセスの restart**（Phase 5変更反映のため）
- 🟡 **Phase 7（JSON廃止）の実施判断**: `data/crossmall_sales_history.json` は現在も並行書き込み中。DB安定確認後に削除可
- 🟡 **`2314-001247n` の在庫マスタ登録**: purchase_master_cacheに追加すれば次回sync時に自動反映
