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

---

# ピコフリ開発セッションログ（続）
> 日付: 2026-04-15（午後セッション）

## 完了した作業

### ✅ 6. 上限仕入価格の計算ロジック変更（価格帯別）
ブランチ: fix/purchase-limit-formula → master (744a8cd)
- ≤3000円: lastSalePrice × 0.9 - 送料 - 300（固定300円利益確保）
- >3000円: lastSalePrice × 0.78 - 送料（利益率12%確保）
- calcProfit()・通知フォーマット変更なし

### ✅ 7. LINE通知スリム化
ブランチ: fix/line-notification-slim → master (c845e42)
- LINE = ダッシュボード形式（🔴即対応 全件 / ⚫欠品 上位5件 / 📦補充 上位10件 / 📋集計）
- Telegram = 全情報維持（変更なし）
- 削除: 🟡注意個別リスト / 💰価格見直し個別リスト / 💡フリマ推奨
- 新規関数: fmtCriticalSlim / fmtOutOfStockSlim / fmtReplenishmentItemSlim / buildReplenishmentSectionLine
- buildLineMessage から leadTime パラメータを除去

### ✅ 8. Telegram📦在庫ボタン追加
ブランチ: feat/telegram-inventory-button → master (2bd06a4)
- MAIN_KEYBOARD 3行目に「📦 在庫」追加
- handleInventory(): generateAlert() → buildInventoryMessage() → 4096文字分割送信
- InventoryAlertService を起動時1回 require
- フォーマット関数群を _ プレフィックスで telegram-bot.cjs 内にインライン実装

### ✅ 9. フリマ推奨→即追加ボタン
ブランチ: feat/telegram-recommend-add → master (3743eb0)
- 推奨リストを InlineKeyboard 付き別メッセージで送信（buildInventoryMessage から分離）
- callback_data: 'add:{sku}'（64バイト制限内）
- handleAddMonitor(): 重複チェック → Keyword.create() → editMessageReplyMarkup でボタン更新
- getItemNameFromCache(): purchase_master_cache.json から SKU→商品名取得（失敗時はSKUをフォールバック）
- fs require 追加、INVENTORY_CACHE_FILE パス定数追加

### ✅ 10. リードタイム5日に変更
コミット: 2baac66 → master
- InventoryAlertService.js: process.env.DEFAULT_LEAD_TIME || '3' → '5'

## PM2プロセス構成（最終）
| プロセス | 種別 | 役割 |
|---------|------|------|
| picofuri-backend | 常時起動 | メインスクレイピング + API |
| crossmall-sync | cron 0 */2 * * * | CROSSMALL同期 + 急減チェック + 2時間Telegram |
| chrome-cleanup | cron */30 * * * * | Chrome/Tempクリーンアップ |
| health-check | cron 0,30 * * * * | ヘルスチェック + LINE broadcast |
| db-cleanup | cron 0 3 * * * | DB 90日超レコード削除 |
| pm2-logrotate | 常時 | ログローテーション |
| telegram-bot | 常時起動 | Telegramキーワード管理 + 📦在庫 + 💡即追加 |
| inventory-alert | cron 0 23 * * * | 毎朝8時在庫サマリー |

## 未完了タスク
### 🟡 中優先度
1. メルカリセレクタのフォールバック強化
2. LINE通知未着問題の調査
3. 在庫アラート Phase 4（曜日パターン・セット品統合）

### 🟢 低優先度
4. 単価自動計算（商品名からの個数抽出）
5. Linux VPSへの移行検討
6. Cloudflare Tunnel導入
7. iOSアプリ開発

## 教訓
- purchase_master_cache.jsonのitemsは数値インデックスがキー。SKUはitem.skuフィールド
- get_stock APIはItemNameを返さない。商品名取得にはget_itemを使う
- LINE broadcastはfetch直接方式（SDK不使用）
- Telegram送信は4096文字制限あり、分割送信が必要
- 在庫日数計算は28日/14日/7日の最短を採用（加速を見逃さない）
- 欠品期間は販売ペース計算から除外すべき（実力日販の正確性）
- telegram-bot.cjsの node_modules は server/ 配下（プロジェクトルートからは見えない）
- InlineKeyboard callback_data は64バイト制限。'add:{sku}' 形式で十分

### ✅ 12. Telegram 📦在庫カテゴリボタン化
ブランチ: feat/telegram-inventory-categories → master (b9c5e4f)
- サマリー1メッセージ+カテゴリボタンでUI改善
- ⚫欠品中は20件/ページのページネーション
- 詳細は商品名+数値の2行表示、区切り線で視認性向上
- 在庫アラート結果を10分キャッシュ（連続操作対策）
