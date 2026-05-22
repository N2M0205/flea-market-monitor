# ピコフリ セッションログ 2026-05-22

## 日付
2026-05-22（JST）

---

## 完了した作業一覧

### 1. unit_price ÷ amount バグの根本修正（コード）

**コミット:** `7668fcc` (ブランチ `fix/unit-price-division-bug` → master マージ済み)

**変更ファイル:** `server/services/CrossmallService.js`（1ファイル、2行変更）

**内容:**
```diff
- const amountTotal = parseFloat(r.unit_price || r.UnitPrice || 0);
+ const unitPrice = parseFloat(r.unit_price || r.UnitPrice || 0);
  const qty = Math.max(1, parseInt(r.amount || r.Amount || 1));
  return {
    amount: qty,
-   unit_price: Math.round(amountTotal / qty),  // ← 除算バグ
+   unit_price: Math.round(unitPrice),            // ← 修正
  };
```

CROSSMALL API の `unit_price` は常に**単価（per-unit）**を返す。  
2026-05-19 の 2be7702 が「合計額÷数量」と誤解したのが根本原因。

**確認根拠:** 同日同商品（2314-001848）で amount=1 と amount=10 の注文が、  
どちらも `raw_unit_price=6710` を返した → 単価であることが確定。

---

### 2. postFix 期間（2026-05-20〜22）の誤値 12件を手動修正

**対象:** 2be7702 適用後に記録された multi-unit 注文（amount>1）の誤単価

| SKU | 注文番号 | 個数 | 誤値 | 正値 |
|-----|---------|------|------|------|
| 2314-001848 | 00252963 | ×10 | ¥671 | ¥6,710 |
| global-0011 | 00252940 | ×5 | ¥616 | ¥3,080 |
| 2314-001313 | 00252907 | ×4 | ¥370 | ¥1,480 |
| 2314-001452-5 | 00252938 | ×2 | ¥4,600 | ¥9,200 |
| 2314-000815 | 00252868 | ×2 | ¥3,950 | ¥7,900 |
| 2314-001811 | 00252832 | ×2 | ¥2,388 | ¥4,775 |
| 2314-001265 | 00252920 | ×2 | ¥1,910 | ¥3,820 |
| 2314-001598 | 00252943 | ×2 | ¥723 | ¥1,445 |
| 2314-001598 | 00252948 | ×3 | ¥482 | ¥1,445 |
| 2314-001313 | 00252946 | ×2 | ¥760 | ¥1,520 |
| import-0127 | 00252835 | ×2 | ¥931 | ¥1,862 |
| import-0123 | 00252826 | ×3 | ¥660 | ¥1,980 |

**修正したデータ:**
- `data/crossmall_sales_history.json`（gitignore対象）
- `data/purchase_master_cache.json`（gitignore対象）
- SQLite `crossmall_sales` テーブル（UPDATE直接実行）

---

### 3. fix_sales_history.cjs 連鎖被害の調査と 2,382件の歴史データ復元

**背景:** 2026-05-20 04:53 に実行した `fix_sales_history.cjs` が  
2be7702 の誤値（例: 2195/5=439）を postFix 基準として使ったため、  
本来正常な preFix 期間レコードを誤修正していた（2,397件中 2,382件が誤修正）。

**復元対象 SKU（❌誤修正、バックアップから復元）:**

| SKU | 復元件数 | 復元後中央値 |
|-----|---------|-----------|
| 2314-001452 | 1,757件 | ¥1,975 |
| 2314-000546 | 390件 | ¥1,700 |
| 2314-001452-2 | 81件 | ¥3,540 |
| 2314-000829 | 119件 | ¥3,050 |
| 2314-001296 | 32件 | ¥1,960 |
| 2314-001338 | 3件 | ¥7,720 |
| **合計** | **2,382件** | |

**維持したSKU（✅正しい修正と判断）:**
- 2314-001462, 2314-001860, global-0108（bakPre/curPost 比率≈2.0 → 元から合計額だった）

**使用バックアップ:** `data/crossmall_sales_history.json.bak_2026-05-20T0453`  
**新バックアップ保存:** `data/crossmall_sales_history.json.bak_2026-05-22`

---

### 4. sync-crossmall-prices.cjs 手動実行

- 新規注文 11件取得
- 261件の lastSalePrice 更新
- 所要時間 20.5秒

---

### 5. picofuri-backend 再起動

```
pm2 restart picofuri-backend --update-env
```

---

## 発見された事実・教訓

### 【最重要】CROSSMALL API unit_price の真の仕様

```
get_order_detail の unit_price フィールドは常に「単価（per-unit）」を返す。
amount（数量）で割る必要はない。
```

- **誤った前提（2be7702）:** 「複数個注文時は合計額を返す」→ ÷amount した  
- **証拠:** 同日同商品で amount=1 と amount=10 どちらも raw_unit_price=6710  
- **正しいコード:** `unit_price: Math.round(parseFloat(r.unit_price || 0))`

### 【連鎖バグのパターン】誤値が基準になって正常データを破壊する

```
① バグA（2be7702）: multi-unit 注文の単価を 1/N に縮小して記録
② スクリプトB（fix_sales_history.cjs）: ①の誤値を"正しい基準"として使用
③ 正常な preFix データが ①と同じ 1/N に誤修正される
```

→ fix スクリプトを書く際は「基準値自体が正しいか」を必ず API で確認すること

### 【教訓】multi-unit 注文が急増すると歴史データが連鎖汚染される

- 大量注文（×10, ×5等）が来ると、誤値が各所の基準計算に影響する
- `lastSalePrice` は最新レコードなので即座に誤値になる
- 異常検知: `lastSalePrice < 通常価格 × 0.3` でアラートを検討

### 【注意】postFix 期間の multi-unit バグ未修正レコードが残存

以下の SKU に postFix 期間の軽度バグ値が残っている（lastSalePrice への影響なし）:
- 2314-001452: order 00252751（×5, ¥439）、×2 レコード数件（¥1098）
- 2314-001296: order ×2（¥980）
- 2314-001338: order ×2（¥3860）
- 2314-000546: order ×2（¥888）

これらは最新レコードではないため通知精度への影響なし。次回以降で個別修正可。

---

## 変更ファイルとコミット

| ファイル | 変更種別 | コミット |
|---------|---------|---------|
| `server/services/CrossmallService.js` | バグ修正（÷amount 削除） | `7668fcc` |
| `data/crossmall_sales_history.json` | 12件修正 + 2,382件復元（gitignore） | — |
| `data/purchase_master_cache.json` | 8 SKU の lastSalePrice 修正（gitignore） | — |
| `server/database.sqlite` | crossmall_sales 12件修正（gitignore） | — |
| `data/crossmall_sales_history.json.bak_2026-05-22` | 復元前バックアップ（gitignore） | — |

---

## 未完了タスク・次回やること

### 優先度高
1. **postFix 期間の残存バグ値を個別修正**  
   2314-001452(00252751,×5), 2314-001296(×2), 2314-001338(×2), 2314-000546(×2)  
   → CROSSMALL API で raw 値確認 → sales_history + DB 修正

2. **要確認SKUのAPIベリファイ**  
   - `cica-0001`: postFix なし、preFix のみ 3件修正（÷2）が正しかったか未確認  
   - `2314-001513`: bakPre¥6,800 vs curPost¥2,640（2.58倍、3個口？）

### 優先度中
3. **lastSalePrice 異常検知の実装検討**  
   `通常価格 × 0.3` 以下の lastSalePrice が記録されたらアラート  
   → multi-unit バグの早期発見に有効

### 優先度低
4. **CLAUDE.md の unit_price 教訓を更新**  
   「合計額」→「単価（per-unit）」に訂正済み（memory ファイルで対応）

---

## 現在のPM2プロセス構成

| id | name | status | uptime | memory |
|----|------|--------|--------|--------|
| 3 | picofuri-backend | ✅ online | 2m | 67MB |
| 8 | telegram-bot | ✅ online | 8h | 12MB |
| 9 | cc-bot | ✅ online | 8h | 16MB |
| 0 | pricera-bot | ✅ online | 2h | 63MB |
| 1 | pricera-dashboard | ✅ online | 5h | 9MB |
| 2 | pricera-tunnel | ✅ online | 5h | 8MB |
| 4 | crossmall-sync | stopped (cron) | — | — |
| 5 | chrome-cleanup | stopped (cron) | — | — |
| 6 | health-check | stopped (cron) | — | — |
| 7 | inventory-alert | stopped (cron) | — | — |
| 10 | crossmall-stock-sync | stopped (cron) | — | — |
| 11 | crossmall-items-sync | stopped (cron) | — | — |

---

## 今セッションの要約

「尿酸と脂肪のダブルバスター」の lastSalePrice=¥671（正常値¥6,710 の 1/10）を入口として、
2026-05-19 の getOrderDetail 修正（2be7702）が CROSSMALL API の仕様を誤解していたことを発見。
コード修正・12件の postFix データ修正・2,382件の preFix データ復元を実施し、
全 SKU の lastSalePrice が正常値に戻ったことを確認して完了。
