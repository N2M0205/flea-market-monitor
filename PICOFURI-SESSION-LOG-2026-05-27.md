# ピコフリ セッションログ 2026-05-27

## 作業概要
`listed_at` 伝搬バグの調査・修正・デプロイ・動作確認

---

## 完了した作業

### 1. バグ調査：古い出品商品が大量LINE通知される問題
- **症状**: 出品日時が古すぎる（売り切れ含む）商品が大量にLINEに通知される
- **調査方法**: ScrapingService.js / LayerAFilterService.js / ログ解析

### 2. 根本原因の特定
**ScrapingService.js に 2つのバグ**:

```
スクレイパー → item.listed_at を正しく取得（Yahoo: stm, Mercari: _parseRelativeTime）
  ↓
findOrCreate(defaults: { platform, title, price, url, image_url })
  ← ❌ listed_at が defaults に未設定 → DB に NULL で保存
  ↓
newProducts.push({ ...saved.toJSON(), description, condition })
  ← ❌ item.listed_at が引き継がれない
  ↓
LayerAFilter.calcHoursFromNow(product)
  listed_at=null → created_at（DB登録時刻≒現在）にフォールバック
  → 経過時間≒0h → 48時間フィルタを常時通過 → 古い商品が全通知
```

**影響**: Yahoo!フリマで最古 6176時間（257日前）の商品がLINEに通知されていた

### 3. 修正: fix/listed-at-propagation
**変更ファイル**: `server/services/ScrapingService.js`（2行）

```diff
 defaults: {
   platform, title, price, url, image_url,
+  listed_at: item.listed_at || null,       // ①DBに正確な出品日時を保存
 },
 
-newProducts.push({ ...saved.toJSON(), description, condition });
+newProducts.push({ ...saved.toJSON(), description, condition,
+  listed_at: item.listed_at || saved.listed_at });  // ②LayerAに正しい日時を渡す
```

### 4. デプロイ
- `git merge fix/listed-at-propagation` → master `300eb8e`
- `pm2 restart picofuri-backend --update-env` 完了

### 5. 動作確認（修正後初回スキャン #1 / 17:10〜17:18）

| 項目 | 件数 |
|---|---|
| ✨ 新規登録（DB新規） | 45件 |
| ⏭️ 経過時間超過ブロック | **39件**（修正の成果） |
| 📱 LINE送信✅ | **4件**（修正前なら45件全通知） |

**ブロック例**:
- オキシカット: 2683.5h（112日前）→ ブロック
- ToyLaBO: 6176.0h（257日前）→ ブロック（最古）
- アルマダ 1000ml: 4316.3h（180日前）→ ブロック
- アレルナイト: 4315.2h（180日前）→ ブロック

---

## コミットハッシュ

| コミット | 内容 |
|---|---|
| `e7dc536` | fix: listed_at を findOrCreate defaults と newProducts に伝搬 |
| `300eb8e` | Merge fix/listed-at-propagation into master |

---

## 発見された事実・教訓

1. **listed_at はモデルに定義済みだが保存されていなかった**
   - `Product.js` には `listed_at: DataTypes.DATE` が存在する
   - しかし `ScrapingService.js` の `findOrCreate` defaults に含まれていなかった
   - スクレイパーは正しく取得しているのに、保存フローで捨てられていた

2. **LayerAFilter の calcHoursFromNow は created_at にフォールバックする**
   - フォールバック順: `listed_at` → `listedAt` → `created_at` → `createdAt`
   - `created_at`（DB登録時刻）は常に「現在」なので経過時間≒0になる
   - これが「古い商品でも経過時間チェックをすり抜ける」原因

3. **LINE 429 Rate Limit エラーが大量発生していた**
   - 修正前のログに `LINE broadcast失敗 (429)` が大量出力されていた
   - 古い商品を大量通知しようとしてレートリミットに引っかかっていた
   - 修正後は通知件数が激減するため自然解消の見込み

4. **Yahoo!フリマは stm（UNIXタイム）で出品日時を正確に取得できる**
   - `listed_at: p.stm ? new Date(p.stm * 1000) : null`
   - 修正後はこれが DB に保存され LayerA で正しく機能する

5. **「大量通知」のパターン**
   - DB に存在しない古い商品（数ヶ月前出品）が検索結果に現れると
     「新規」として大量登録→ listed_at=null → 全通知 が発生する
   - 特に pm2 restart 後の最初のスキャンで顕著（DBキャッシュなし）

---

## 未完了タスク・次回やること

### 要調査
- [ ] **Mercari の `_parseRelativeTime` の精度確認**
  - 「3日前」「1週間前」等の相対時間テキストをどこまで正確に変換できるか
  - 変換失敗時は `listed_at=null` → Mercari は許容設計（現状維持）

- [ ] **LINE 429 エラーの経過観察**
  - 通知件数が減れば自然解消のはず
  - 数日後に再確認（エラー頻度が下がったか）

### 既知の残課題（今回スコープ外）
- スクレイピング完了〜通知送信の間に売り切れた商品の通知防止
- `notified=false` のまま残るレコードの掃除（30日後削除の対象外）
- Mercari セレクタのフォールバック強化

---

## PM2 プロセス状態（セッション終了時点）

| id | name | status | uptime | mem |
|----|------|--------|--------|-----|
| 9 | cc-bot | online | 5D | 23.3mb |
| 5 | chrome-cleanup | stopped | - | - |
| 11 | crossmall-items-sync | stopped | - | - |
| 10 | crossmall-stock-sync | stopped | - | - |
| 4 | crossmall-sync | stopped | - | - |
| 6 | health-check | stopped | - | - |
| 7 | inventory-alert | stopped | - | - |
| 12 | manual-price-bot | online | 24h | 11.3mb |
| **3** | **picofuri-backend** | **online** | **15m** | **126.5mb** |
| 0 | pricera-bot | online | 2D | 12.9mb |
| 1 | pricera-dashboard | online | 5D | 8.8mb |
| 2 | pricera-tunnel | online | 5D | 7.3mb |
| 8 | telegram-bot | online | 5D | 23.9mb |
