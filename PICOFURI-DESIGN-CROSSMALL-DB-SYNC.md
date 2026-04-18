# ピコフリ CROSSMALL DB集約 実装指示書（自律実行版）

> 作成日: 2026-04-17  
> 対象: Claude Code（VPS実行環境）  
> ブランチ: `feat/crossmall-db-integration`  
> 実行モード: **自律実行（Phase 1〜6を連続実施、完了まで検証ループ）**

---

## 0. 実行ルール（厳守）

### 0.1 自律実行方針

**Claude Code はこのドキュメントに従い、Phase 1 から Phase 6 まで連続して実装・検証・コミットする。** オーナーへの途中確認は原則不要。ただし以下の例外あり：

### 0.2 必ず停止してオーナーに確認する項目（途中停止条件）

- ❌ **master への直接コミット** ← 絶対禁止
- ❌ **master へのマージ** ← 最終成果物のマージは必ず承認後
- ❌ **本番 PM2 プロセスの登録・削除・restart**（`pm2 start` / `pm2 delete` / `pm2 restart` を **本番プロセス名** で実行）
- ❌ **`.env` の変更**
- ❌ **`data/crossmall_sales_history.json` の削除**（移動も禁止。Phase 7 で判断）
- ❌ **既存DBテーブルのスキーマ変更**（追加はOK、既存カラム変更は禁止）
- ❌ **定義済みセルフテストが失敗し、2回リトライしても解決しない場合** → 状況を整理して停止

### 0.3 自律的に進めてよい項目

- ✅ `feat/crossmall-db-integration` ブランチへのコミット・push
- ✅ 新規ファイルの作成
- ✅ 既存ファイルへの指示書記載範囲での変更
- ✅ マイグレーション実行・ロールバック（sequelize-cli）
- ✅ ローカル手動実行（node コマンドでスクリプト実行）
- ✅ **テスト用PM2プロセス**（名前に `-test` を付ける。例: `crossmall-items-sync-test`）の起動・停止・削除

### 0.4 検証ループ

各 Phase 完了時に **セルフテスト（各Phase内に記載）を実行し、全項目 PASS するまで次 Phase に進まない**。失敗した場合：

1. 原因を特定
2. 修正を実装
3. 再度セルフテスト実行
4. 2回リトライしても解決しなければ停止して報告

### 0.5 コミット粒度

各 Phase 完了（セルフテスト全PASS後）ごとに1コミット。コミットメッセージ例：

```
feat(crossmall-db): Phase 1 - add 3 tables and Sequelize models

- crossmall_items / crossmall_stock / crossmall_sales migration
- Sequelize models with base_code derivation
- All self-tests passed
```

各コミット後に `git push origin feat/crossmall-db-integration`。

### 0.6 セッションログ

作業開始時に `PICOFURI-SESSION-LOG-2026-04-17.md` を作成（存在しなければ）。各 Phase 完了時に追記：

- 完了内容
- 変更ファイル一覧（コミットハッシュ込み）
- セルフテスト結果
- 所要時間
- 発見した事実・教訓

---

## 1. 背景と目的

### 現状の問題
- 通知時に CROSSMALL API を都度呼び出している（`ScrapingService.getStockAndPrice()` など）→ 通知遅延・API失敗の温床
- `PurchaseMasterCache` はメモリ＋JSON の二重管理で、`crossmall-sync` 後に `pm2 restart` しないと反映されない
- `data/crossmall_sales_history.json` が大きくなっており、JOIN的な集計ができない
- 同一物理商品の複数カタログ（`2314-001247` と `2314-001247n`）が集計できていない → 販売個数が大幅過小評価

### ゴール
- CROSSMALL 3種データ（商品マスタ／在庫／受注）をすべて SQLite に集約
- 通知時のCROSSMALL API呼び出しをゼロにする
- `n` サフィックス問題を `base_code` カラムで解消
- 後続の「在庫アラートシステム」がこのDBをそのまま使える基盤を作る

---

## 2. DB設計

### 2.1 追加テーブル（3本）

```sql
-- 商品マスタ
CREATE TABLE crossmall_items (
  item_code TEXT PRIMARY KEY,
  item_name TEXT NOT NULL,
  unit_price INTEGER,                    -- 売上単価(税別)
  notax_purchase_price INTEGER,          -- 仕入単価(税別)
  taxin_purchase_price INTEGER,          -- 仕入単価(税込)
  freight_type TEXT,                     -- 送料区分
  base_code TEXT NOT NULL,               -- 正規化済み基底コード（末尾'n'除去）
  crossmall_updated_at DATETIME,
  synced_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);
CREATE INDEX idx_items_name ON crossmall_items(item_name);
CREATE INDEX idx_items_base ON crossmall_items(base_code);

-- 在庫（最新のみ保持・差分更新）
CREATE TABLE crossmall_stock (
  item_code TEXT PRIMARY KEY,
  stock_count INTEGER NOT NULL,
  crossmall_updated_at DATETIME,
  synced_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (item_code) REFERENCES crossmall_items(item_code)
);

-- 販売履歴
CREATE TABLE crossmall_sales (
  order_number TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  item_code TEXT NOT NULL,
  order_date DATETIME NOT NULL,
  amount INTEGER NOT NULL,
  unit_price INTEGER,
  amount_price INTEGER,
  delivery_type TEXT,
  synced_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (order_number, line_no)
);
CREATE INDEX idx_sales_item_date ON crossmall_sales(item_code, order_date);
CREATE INDEX idx_sales_date ON crossmall_sales(order_date);
```

### 2.2 `base_code` 導出ルール

```javascript
function deriveBaseCode(itemCode) {
  if (typeof itemCode !== 'string') return itemCode;
  return itemCode.endsWith('n') ? itemCode.slice(0, -1) : itemCode;
}
```

※末尾 `n` は「複数カタログ」の1文字のみ除去。

### 2.3 既存テーブルとの関係

既存の `keywords` テーブルは **本件では変更しない**。キーワード↔item_code 複数紐付けは別タスクで対応。

---

## 3. 同期戦略

### 3.1 PM2プロセス構成（本件完了後）

| プロセス | cron | 役割 | 本件での扱い |
|---|---|---|---|
| picofuri-backend | 常時起動 | スクレイピング＋通知 | Phase 6 で DB参照に変更 |
| crossmall-sync | `0 */2 * * *` | 受注同期 | Phase 5 で DB書き込みに変更 |
| **crossmall-items-sync** | `30 3 * * *` | 商品マスタ同期 | **Phase 3で新規（本番登録は承認待ち）** |
| **crossmall-stock-sync** | `*/30 * * * *` | 在庫差分同期（30分ごと） | **Phase 4で新規（本番登録は承認待ち）** |
| chrome-cleanup | `*/30 * * * *` | Chrome掃除 | 変更なし |
| health-check | `0,30 * * * *` | 監視 | 変更なし |
| db-cleanup | `0 3 * * *` | DB 90日超削除 | Phase 7 で対象拡張 |
| pm2-logrotate | 常時 | ログローテ | 変更なし |
| telegram-bot | 常時起動 | Telegram Bot | 変更なし |
| cc-bot | 常時起動 | Claude Code Bot | 変更なし |

### 3.2 APIエンドポイント

| 同期対象 | API | 備考 |
|---|---|---|
| 商品マスタ | `get_item` | `item_code` 指定の1件取得のみ実動確認済み |
| 在庫 | `get_stock` | `item_code` 指定の1件取得（162件ループ、約3分） |
| 在庫差分 | `get_diff_stock` | ⚠️ `updated_at_fr` に時刻成分を含むと認証エラー（Issue A'）。現行未使用 |
| 受注 | `get_order` | 既存 `sync-crossmall-prices.cjs` 流用 |

仕様: プロジェクト知識 `webapi2_202405291300_v2_2_44_1.pdf`

### 3.3 署名バグ調査結果（Issue A / 2026-04-18 完了）

**generateSigning() のバグ（予防的修正済み）**
- 旧コード: `${key}=${params[key]}` — raw値を直接連結
- 新コード: `${key}=${encodeURIComponent(String(params[key]))}` — URLエンコード適用
- 現行の全 `makeRequest()` 呼び出しは ASCII 安全パラメータのみ（item_code / YYYY-MM-DD / order_number）のため raw == encoded → 本番影響なし
- コミット: `89ef7ac` (fix/crossmall-signing-prevention → master)

**get_diff_stock / get_item (差分) が使えない理由 (Issue A')**
- `updated_at_fr='YYYY-MM-DD HH:MM:SS'` を渡すと 3 種類の署名方式（raw / %20 / +）すべてで「認証エラー」
- 3 種の署名はすべて異なる値 → サーバーが署名検証前にリクエストを弾いている
- `YYYY-MM-DD`（時刻なし）は認証 OK / TotalResult=0（フィルタ機能せず）
- 結論: **CROSSMALL サーバー側のバリデーション仕様** であり、クライアント側の署名修正では解決不可
- 対処: CROSSMALL サポートへの問合せ推奨（仕様書で datetime フォーマット要確認）

---

## 4. 実装フェーズ（自律実行）

### Phase 1: DBマイグレーション＋モデル定義

**タスク:**
1. `server/migrations/20260417000001-create-crossmall-tables.js` 作成（3テーブル + index）
2. `server/models/CrossmallItem.js` / `CrossmallStock.js` / `CrossmallSale.js` 作成
   - アソシエーション: `CrossmallItem.hasOne(CrossmallStock)` / `hasMany(CrossmallSale)`
   - `base_code` は Sequelize `beforeValidate` hook または model setter で自動導出
3. `server/models/index.js` にモデル登録
4. マイグレーション実行: `cd server && npx sequelize-cli db:migrate`

**セルフテスト:**
- [ ] `sqlite3 database.sqlite ".tables"` で3テーブルが存在
- [ ] `sqlite3 database.sqlite ".schema crossmall_items"` で全カラム・インデックス確認
- [ ] 既存テーブル（`keywords`, `products` 等）が変更されていない（`.schema` で比較）
- [ ] ロールバック: `npx sequelize-cli db:migrate:undo` → テーブル消失確認 → `db:migrate` で再作成
- [ ] Sequelizeから`CrossmallItem.findAll()`がエラーなく動く（一時的な`node -e`で確認）

**成功条件:** 全項目 PASS → コミット → push → Phase 2 へ

---

### Phase 2: sales_history.json → crossmall_sales 移行

**タスク:**
1. `server/scripts/migrate-sales-history.cjs` 作成
2. 処理内容:
   - `data/crossmall_sales_history.json` を読む
   - 先頭でJSONスキーマをログ出力（1件サンプル表示）
   - 各レコードを `crossmall_sales` に UPSERT（PK: `order_number` + `line_no`）
   - 進捗を100件ごとに `console.log`
   - 完了時に件数・日付範囲サマリを出力
3. 実行: `node server/scripts/migrate-sales-history.cjs`
4. **元JSONは削除せず残す**（§0.2 参照）

**セルフテスト:**
- [ ] 移行件数 = JSON内レコード数
- [ ] `SELECT COUNT(*) FROM crossmall_sales` が JSONの件数と一致
- [ ] `SELECT MIN(order_date), MAX(order_date) FROM crossmall_sales` の範囲が JSON と一致
- [ ] 再実行して重複INSERTが0件（冪等性）
- [ ] 任意のitem_codeで `SELECT COUNT(*) FROM crossmall_sales WHERE item_code = 'XXX'` が JSON内該当件数と一致

**成功条件:** 全項目 PASS → コミット → push → Phase 3 へ

---

### Phase 3: 商品マスタ同期スクリプト

**タスク:**
1. `server/scripts/sync-crossmall-items.cjs` 作成
2. 処理内容:
   - 前回同期時刻 = `SELECT MAX(synced_at) FROM crossmall_items`（なければ90日前）
   - `get_item` API を `updated_at_fr` 指定で呼ぶ
   - 100件ページネーション対応
   - 各レコードを UPSERT（PK: `item_code`）
   - `base_code` を `deriveBaseCode()` で計算してセット
   - 1秒/回 のウェイト
3. 手動実行: `node server/scripts/sync-crossmall-items.cjs`
4. **本番PM2登録はしない** （§0.2参照。テストPM2なら `crossmall-items-sync-test` で登録OK）

**セルフテスト:**
- [ ] 初回実行で全件（概算150〜160件）が `crossmall_items` に入る
- [ ] 2回目実行で差分のみ処理される（全件更新されない）
- [ ] `SELECT item_code, base_code FROM crossmall_items WHERE item_code LIKE '%n' LIMIT 10` で `n` 除去が正しく動作
- [ ] `2314-001247` と `2314-001247n` の `base_code` が両方 `'2314-001247'`
- [ ] エラーログなし、API呼び出し成功

**成功条件:** 全項目 PASS → コミット → push → Phase 4 へ

---

### Phase 4: 在庫同期スクリプト

**タスク:**
1. `server/scripts/sync-crossmall-stock.cjs` 作成
2. 処理内容:
   - 前回同期時刻 = `SELECT MAX(synced_at) FROM crossmall_stock`（なければ90日前）
   - `get_diff_stock` API を `updated_at_fr` 指定で呼ぶ
   - ページネーション対応
   - 各レコードを UPSERT（PK: `item_code`）
   - `crossmall_items` 未登録の `item_code` はログ警告してスキップ
3. 手動実行: `node server/scripts/sync-crossmall-stock.cjs`
4. **本番PM2登録はしない**

**セルフテスト:**
- [ ] 初回実行でUPSERT件数ログ出力
- [ ] 2回目実行（直後）で差分が0〜極少数件
- [ ] `SELECT COUNT(*) FROM crossmall_stock` が妥当（`crossmall_items` 件数以下）
- [ ] `SELECT item_code, stock_count FROM crossmall_stock WHERE item_code = '2314-001247'` が取れる
- [ ] エラーログなし

**成功条件:** 全項目 PASS → コミット → push → Phase 5 へ

---

### Phase 5: 受注同期を DB書き込みに切り替え

**タスク:**
1. 既存 `server/scripts/sync-crossmall-prices.cjs` を改修
2. 既存のページネーション・2時間同期ロジックは維持
3. 各レコードを `crossmall_sales` に UPSERT（PK: `order_number` + `line_no`）
4. **既存JSON書き込みもそのまま残す**（Phase 7で廃止判断）
5. 手動実行: `node server/scripts/sync-crossmall-prices.cjs`

**セルフテスト:**
- [ ] 実行後、`crossmall_sales` に差分レコードが追加されている
- [ ] JSONファイルも更新されている（併用動作確認）
- [ ] 2回目実行で重複INSERTが発生しない
- [ ] `SELECT COUNT(*) FROM crossmall_sales` と JSON件数が近似（JSON側に delivery_type 等未記録のレコードがある場合は差が出るので、差の原因を説明可能にする）
- [ ] 既存の `crossmall-sync` PM2プロセスは **このPhaseでは restart しない**（§0.2 参照）

**成功条件:** 全項目 PASS → コミット → push → Phase 6 へ

---

### Phase 6: 通知ロジックを DB参照に切り替え

**タスク:**
1. 現行の `ScrapingService.js` / `CrossmallService.js` / `PurchaseMasterCache` を読み、CROSSMALL API直叩き箇所を特定
2. 新規サービス `server/services/CrossmallDbService.js` を作成
   - `getStockAndPriceByItemCode(itemCode)` — 単一item_code版（後方互換）
   - `getStockAndPriceByBaseCode(baseCode)` — `n`サフィックス含めて集約
   - メソッド返り値は既存 `getStockAndPrice()` と互換形式（呼び出し側変更を最小化）
3. 通知生成箇所で `CrossmallDbService` を呼ぶように差し替え
4. `PurchaseMasterCache` への参照を削除 or DB参照に置き換え
5. `ScrapingService.js` 内の CROSSMALL API直叩きを削除

**セルフテスト:**
- [ ] セノッピー関連 item_code (`2314-001247` / `2314-001247n` / `2314-001636`) で `getStockAndPriceByBaseCode('2314-001247')` を呼んだ時、在庫・販売数が `2314-001247` と `2314-001247n` の合算値
- [ ] `grep -rn "crossmall.jp/webapi2" server/services/` で `CrossmallService.js`（同期スクリプト用）以外にAPI直叩きが残っていない
- [ ] `grep -rn "PurchaseMasterCache" server/` でキャッシュ参照がゼロ
- [ ] 通知生成の単体テスト（mock or 手動）で旧実装と同等のメッセージが生成される
- [ ] 通知処理時間が従来より短縮されている（ログのタイムスタンプで比較）

**成功条件:** 全項目 PASS → コミット → push → 全Phase完了

---

## 5. 完了時報告フォーマット

全Phase完了後、`PICOFURI-SESSION-LOG-2026-04-17.md` に以下をまとめ、オーナーに報告：

```markdown
# ピコフリ CROSSMALL DB集約 実装完了報告

## 実施Phase
| Phase | 内容 | コミット | セルフテスト |
|---|---|---|---|
| 1 | DBマイグレーション | <hash> | ✅ 全項目PASS |
| 2 | sales_history 移行 | <hash> | ✅ 全項目PASS |
| 3 | items同期スクリプト | <hash> | ✅ 全項目PASS |
| 4 | stock同期スクリプト | <hash> | ✅ 全項目PASS |
| 5 | 受注同期 DB書き込み | <hash> | ✅ 全項目PASS |
| 6 | 通知ロジック DB参照 | <hash> | ✅ 全項目PASS |

## 変更ファイル総覧
- 追加: XX件
- 変更: XX件
- 削除: XX件

## DB状態
- crossmall_items: XXX件
- crossmall_stock: XXX件
- crossmall_sales: X,XXX件

## セノッピー突合結果
| item_code / base | 在庫 | 28日販売 | CSV実績との一致 |
|---|---:|---:|:---:|
| 2314-001247 (単体) | 0 | 23 | ✅ |
| 2314-001247n (単体) | 0 | 65 | ✅ |
| 2314-001636 (単体) | 15 | 43 | ✅ |
| base_code=2314-001247 (集約) | 0 | 88 | ✅ |

## 発見された事実・教訓

## 未完了・オーナー判断待ち項目
- 新規PM2プロセス本番登録（crossmall-items-sync / crossmall-stock-sync）
- master マージ
- Phase 7（JSON廃止）の実施判断
- 既存 crossmall-sync プロセスの restart
```

---

## 6. ロールバック手順

異常時：

```bash
# Phase 1〜4
git checkout master
cd server && npx sequelize-cli db:migrate:undo  # 必要に応じて

# Phase 5
git checkout master server/scripts/sync-crossmall-prices.cjs

# Phase 6
git revert <該当コミット>
# picofuri-backend のrestartは本番プロセスに触れるので §0.2 でオーナー承認待ち
```

---

## 7. 参考情報

### プロジェクト構成
- リポジトリ: `N2M0205/flea-market-monitor`
- VPS: ConoHa Windows VPS (160.251.227.206)
- Node.js v22.14.0 / PM2 / SQLite
- `NODE_ENV=development`（`production` は PostgreSQL接続エラー）

### CROSSMALL API
- ベース: `https://crossmall.jp/webapi2`
- アカウント: 3663
- 認証: IP制限 + MD5署名（`CrossmallService.js` 参照）

### 既知の落とし穴
- PowerShellの `Out-File` は BOM付与 → `node -e "fs.writeFileSync()"` を使う
- `NODE_ENV=production` 禁止
- PM2環境変数変更時は `--update-env` フラグ必須

### セノッピー実績データ（Phase 6 検証用）
`item_order_0417151646.csv`（2026-04-17出力）より：

| item_code | 在庫 | 販売数 |
|---|---:|---:|
| 2314-001247 | 0 | 23 |
| 2314-001247n | 0 | 65 |
| 2314-001636 | 15 | 43 |

base_code='2314-001247' で集約したら 在庫=0, 販売=88 になるはず。
base_code='2314-001636' で集約したら 在庫=15, 販売=43 になるはず（`n`バリアントなし）。

---

*本ドキュメントに従って、Phase 1 から Phase 6 まで自律的に実装・検証・コミットしてください。停止条件（§0.2）に該当する場合のみオーナーに確認してください。*
