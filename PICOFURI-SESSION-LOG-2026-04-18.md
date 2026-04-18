# ピコフリ Telegram キーワード登録 FSM 実装報告

> 実施日: 2026-04-18
> ブランチ: `feat/telegram-keyword-registration`

---

## 実施Phase

| Phase | 内容 | コミット | セルフテスト |
|---|---|---|---|
| 1 | DB マイグレーション（Keywords.item_codes 追加） | `95c2ed8` | ✅ PASS |
| 2 | 既存キーワード移行（item_code → item_codes） | `6bc5fa7` | ✅ PASS |
| 2.5 | n変種 item_code 自動抱き合わせ | `1bcdc96` | ✅ PASS |
| 3 | 検索API（`GET /api/crossmall/items/search`） | `f66dd82` | ✅ PASS |
| 4 | Telegram FSM（既存「➕追加」拡張、検索→マルチ選択） | `6767c8e` | ✅ PASS（実地検証済み） |
| 4追加 | NOT NULL 制約違反 修正（範囲外の併せ修正） | `fc88282` | ✅ PASS |
| 5 | 管理コマンド（/list, /cancel, /help） | — | ⏭ スキップ（既存UI充足） |
| 6 | ScrapingService 側 item_codes 複数対応 | — | ⏭ スキップ（base_code集約で既に充足） |

---

## Phase 4 実装の概要

### 設計変更（当初案から）

- 新規 `/add` コマンドは作らず、既存の「➕ 追加」フローを拡張
- 新規 `/list` / `/cancel` / `/help` は作らず、既存 Reply Keyboard で代替
- `userStates` の step に `reg:` prefix を付与して既存フローと衝突回避

### FSM ステート遷移

```
ASK_KEYWORD
  ↓ (テキスト入力)
reg:search_query （検索キーワード入力）
  ↓ (テキスト入力)
reg:select_items （Inline Keyboard で ☑/⬜ トグル）
  ↓ (🔽完了)
reg:confirm （確認画面）
  ↓ (✅登録 / 🔄やり直し / ❌キャンセル)
DONE
```

### n変種 自動抱き合わせ

1 商品選択時、同じ `base_code` で末尾 `n` の item_code が CrossmallItem に存在すれば、`item_codes` 配列に自動追加（ユーザー操作不要）。

### DB 書き込み

`Keywords.item_codes` にカンマ区切りで保存。後方互換のため `crossmall_item_code` には先頭の item_code を保存。

---

## NOT NULL バグ（Phase 4 実地テスト1で発覚 → fc88282 で修正）

### 症状

オーナーの初回テストで「マルチ選択UI は正常動作」するが登録確定時に `Validation error` 発生。

### 根本原因

`Keywords.min_price` / `max_price` は SQLite で `NOT NULL DEFAULT 0 / 999999`。Sequelize モデル側の `allowNull` 指定が欠落しているため、Sequelize は `null` の通過を許すが DB が拒否。エラーが `SequelizeUniqueConstraintError` にラップされて返り誤認を誘発。

### 修正3箇所

1. `handleAddConfirm`: `state.price / max_price` 未設定時は `0 / 999999` を渡す
2. `handleClearPrice`: 価格削除時は `null` ではなく DB デフォルト値（0 / 999999）をセット
3. `handleAddMonitor` (💡フリマ推奨即追加): `0 / 999999` 固定（Phase 4 以前から潜在）

### 範囲外判断

`Keyword.js` モデル側の `allowNull: false` 追記は **今回の修正範囲外**。スコープ拡大を避けるため、DB デフォルト値を明示的に渡す方針で対応。

---

## Phase 5 スキップ判断

| 設計書コマンド | 既存UI | 判定 |
|---|---|---|
| `/list` | 「📋 一覧」ボタン | ✅ 充足 |
| `/cancel` | 「❌ キャンセル」ボタン + `/cancel` 文字 | ✅ 充足 |
| `/help` | `/start` の Reply Keyboard メニュー | ✅ 代替充足 |

---

## Phase 6 スキップ判断

設計書 §2.6 の狙いは「複数 item_codes の在庫・販売数集約」だが、`CrossmallDbService.getStockAndPriceByBaseCode()` が既に base_code 単位で集約済み。現行 ScrapingService.js L389-407 の `keyword.crossmall_item_code` → `deriveBaseCode()` → `getStockAndPriceByBaseCode()` のパスで、n 変種を含む複数 SKU は既に合算されている。

`1キーワード = 1 base_code (± n変種)` が実運用の前提であるため、現行コードで Phase 6 の目的は既に達成されている。

異 base_code 混在のサポートが必要になった場合のみ、将来的に ScrapingService L389-407 を約10-20行の改修で対応可能（見積もり 15-25分）。

---

## 完了条件チェック

- [x] Phase 1-4 実装・push 済み
- [x] Telegram で新規キーワード登録が動作する（実地確認済み）
- [x] 既存20キーワードが `item_codes` ベースで動作する（Phase 2/2.5）
- [ ] master merge（オーナー承認待ち）
- [ ] picofuri-backend restart（master merge 後）

---

## 変更ファイル総覧

**追加 (3件)**
- `server/migrations/20260418000001-add-item-codes-to-keywords.js`
- `server/scripts/migrate-keywords-to-item-codes.cjs`
- `server/routes/crossmall.js`

**変更 (3件)**
- `server/models/Keyword.js` (item_codes カラム追加)
- `server/app.js` (crossmall ルート登録)
- `server/scripts/telegram-bot.cjs` (Phase 4 FSM + NOT NULL fix)

---

## テストキーワード残存

実地テスト（セノッピー系2件）は Telegram「🗑 削除」で削除済み。2026-04-18 時点の残存 0件。

---

*次アクション: オーナー承認後に master merge → picofuri-backend restart*
