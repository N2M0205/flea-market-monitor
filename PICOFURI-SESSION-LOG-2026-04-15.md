# ピコフリ開発セッションログ
> 日付: 2026-04-15

## 完了した作業

### ✅ 1. browser.close()タイムアウトによるクラッシュ修正
- ブランチ: fix/browser-close-crash → masterマージ済み
- server/server.js に unhandledRejection ハンドラを追加
- browser.close()失敗時もプロセスがクラッシュせずログ出力して継続
- 再起動回数: 24hで8回 → 0回（予測）

### ✅ 2. 商品コード 2314-001876 のCROSSMALLデータ未表示修正
- ブランチ: fix/crossmall-auto-add-sku → masterマージ済み
- 原因: purchase_master_cache.json に未登録（GAS廃止後に追加されたSKU）
- 即時対応: キャッシュに手動追加 + cache/reload
- 根本対応: sync-crossmall-prices.cjs に addMissingSkusFromKeywords() 追加
  - keywordsテーブルのcrossmall_item_codeとキャッシュを突合
  - 未登録SKUを自動でCROSSMALL APIから取得して追加
- server/config/database.js のstorage パスを絶対パス化
- 結果: 157件 → 162件（5件自動追加）

### ✅ 3. 上限仕入価格の計算バグ修正
- ブランチ: fix/purchase-limit-calc → masterマージ済み
- 原因: purchaseLimitがGAS時代のキャッシュ値（陳腐化）を参照していた
  - GAS計算時の lastSalePrice ~¥3,340 → purchaseLimit ¥2,786
  - VPS sync後の lastSalePrice ¥3,120 → 利益計算は正しいが上限仕入と矛盾
- 修正: LineNotificationService.js で purchaseLimit を動的計算に変更
  - purchaseLimit = lastSalePrice × 0.9 - shippingCost
  - 利益計算と同じ変数を参照して一貫性確保
- 検証: 2314-001180 上限仕入 ¥2,786 → ¥2,588（正しい値）

### ✅ 4. git push認証エラーの修正
- 原因: credential managerの認証情報が古くなっていた
- 対応: cmdkeyで古い資格情報を削除 → PAT（Fine-grained token）をremote URLに埋め込み
- 結果: Claude Codeからブラウザ不要でpush可能に

### ✅ 5. health-check.cjs のスクレイピングエラー数監視追加
- 直近スキャンのMercari/Yahoo成功率をログから集計して通知に含める
- 閾値: Mercari成功率50%未満でWarning、25%未満でCritical

## 発見された重要な事実

### purchaseLimitの陳腐化問題
- GAS廃止後、purchaseLimitはキャッシュに固定値として残っていた
- lastSalePriceはVPS syncで更新されるが、purchaseLimitは再計算されなかった
- 結果: 上限仕入と利益計算が異なるlastSalePriceを参照して矛盾

### 新規SKU自動追加の構造的な穴
- GAS廃止後、新規SKUがキャッシュに追加される仕組みがなかった
- keywordsテーブルにcrossmall_item_codeがあってもキャッシュになければ通知に反映されない
- addMissingSkusFromKeywords()で解決

## 未完了タスク
- health-check.cjsの閾値調整（Temp 5GB→10GB、メモリ85%→92%、Chrome 10→15）がまだ反映されていない可能性 → 要確認
- Temp肥大化の再発防止は cleanup-chrome.cjs に追加済み → 動作確認継続

## PM2プロセス構成（変更なし）

| プロセス | 状態 | 役割 |
|---------|------|------|
| picofuri-backend | online | メインスクレイピング（500MB上限） |
| crossmall-sync | cron待機 | 2時間ごとCROSSMALL同期 |
| chrome-cleanup | cron待機 | 30分ごとChrome+Temp掃除 |
| health-check | cron待機 | 30分ごとヘルスチェック（broadcast） |
| pm2-logrotate | online | ログローテーション |

## スクレイピング性能

| 指標 | 値 |
|------|-----|
| Mercari成功率 | 29/29（100%） |
| Yahoo成功率 | 29/29（100%） |
| 処理時間 | 336秒 |
| キーワード数 | 29件 |
