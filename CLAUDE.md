# ピコフリ作業ルール

## 絶対ルール
- mainを直接編集しない。必ずブランチを切る
- ブランチ名: feat/ fix/ refactor/
- mainマージはオーナー承認後のみ
- マージ前にgit diff mainで差分提示
- 問題時はgit revertで即復旧

## ファイル操作
- 全ファイル編集OK
- .env変更時は変更前の値を記録
- DB操作前にバックアップ必須

## PM2
- restart/stop OK
- delete は承認後のみ
- PM2再起動はマージ後にオーナー指示があってから

## プロジェクト概要
ピコフリ（flea-market-monitor）= フリマ監視→LINE通知システム
- メルカリ・Yahoo!フリマを10分間隔でスクレイピング
- 新着商品検出→CROSSMALL在庫/価格情報付きでLINE通知
- Telegram Botでキーワード管理（@picofuri_admin_bot）

## 環境
- Win VPS: 160.251.227.206（ConoHa, 8GB RAM）本番
- Node.js + Express + SQLite（NODE_ENV=development ※productionにするとPostgreSQL接続エラー）
- GitHub: N2M0205/flea-market-monitor

## PM2プロセス構成
| プロセス | 種別 | 役割 |
|---------|------|------|
| picofuri-backend | 常時起動（500MB上限） | メインスクレイピング + API |
| crossmall-sync | cron 0 */2 * * * | CROSSMALL同期 + 急減チェック + 2時間Telegram簡易レポート |
| chrome-cleanup | cron */30 * * * * | Chrome/Tempクリーンアップ |
| health-check | cron 0,30 * * * * | ヘルスチェック + LINE通知 |
| db-cleanup | cron 0 3 * * * | DB 90日超レコード削除 |
| pm2-logrotate | 常時 | ログローテーション |
| telegram-bot | 常時起動（200MB上限） | Telegramキーワード管理 + 📦在庫ボタン（即時サマリー）+ 💡推奨→即追加 |
| inventory-alert | cron 0 23 * * * | 毎朝8時在庫サマリー（LINE=スリム / Telegram=フル） |

## 重要な教訓（過去の障害から）
- platformsフィールドは3形式ある（配列/JSON文字列/オブジェクト）→ parsePlatforms()で正規化すること
- Mercariスクレイピング: waitUntil='domcontentloaded' + waitForSelector が安定。networkidle2はタイムアウトする
- Yahoo!フリマ: search()ごとに独立ブラウザ生成必須（共有するとERR_ABORTED）
- CROSSMALL API: order_number単体でページネーション可。conditionを付けると署名エラー
- .envをPowerShellで作るとBOM問題 → node -e "fs.writeFileSync()" を使う
- PM2 --update-env フラグ必須（env変更時）
- PurchaseMasterCacheはPOST /api/cache/reload で更新（pm2 restart不要）
- CROSSMALL get_stock APIはItemNameを返さない。商品名取得には get_item API（getItemInfo()）を使うこと
- syncItemNames()は初回のみ全件取得（157件×1秒≒2.6分）、2回目以降はitem_name未設定分のみ（通常0件で即終了）
- purchase_master_cache.json の items は数値インデックスがキー。SKUは item.sku フィールドにある（Object.values()でループすること）
- LINE broadcast は fetch直接方式（@line/bot-sdk不使用）。health-check.cjs の sendLineAlert() を参照
- Telegram送信は4096文字制限あり。超える場合は行単位で分割送信が必要
- 在庫アラート Phase 1(11f5bac) + Phase 2(172078e) + Phase 3(e95991b) 完了
- previousStock は syncStock() 後に毎回更新（2時間ごとの比較が正しく機能する）
- 2時間チェックのスキップ判定は SKUリスト完全一致方式（件数同じでも中身変化なら送信）
- generateAlert({ skipRecommendations: true }) でDB不要の軽量実行が可能
- 毎朝サマリーに本日補充リスト追加済み(e95991b)。在庫日数30日以上はスキップ（在庫過多）。昨日判定はJST基準（_getYesterdayJST()）。generateAlert()戻り値にreplenishmentListが含まれる
- LINE通知はスリム化済み（🔴即対応+⚫欠品+📦補充+📋集計のみ）。詳細はTelegramで確認
- 上限仕入価格: ≤3000円は固定300円利益（×0.9-送料-300）、>3000円は利益率12%（×0.78-送料）
- デフォルトリードタイム: 5日（process.env.DEFAULT_LEAD_TIME || '5'）
- Telegram 📦在庫ボタン: サマリー（件数のみ）＋カテゴリ InlineKeyboard 方式。handleInventory() → editMessageText でサマリー表示 → カテゴリボタン押下で詳細を新メッセージ送信
- カテゴリ詳細は editMessageText ではなく新メッセージ送信（長さ超過時の対策）。戻るボタンは deleteMessage で詳細を削除
- 在庫アラート結果は10分 TTL キャッシュ（inventoryCache Map）で保持。連続ボタン操作時の再計算を防ぐ
- ⚫欠品中は直近30日/30日超で分離表示。直近30日は20件/ページのページネーション（cat:oos:pN）
- フリマ推奨の即追加: callback_data 'add:{sku}' → handleAddMonitor() → Keyword.create() + editMessageReplyMarkup でボタン更新
- InlineKeyboard callback_data は64バイト制限。'cat:xxx' / 'add:{sku}' 形式で十分短い
- telegram-bot.cjs の node_modules は server/ 配下（プロジェクトルートからは見えない）

## 既知の未解決課題
1. LINE通知未着（ログ上は送信成功だが届かないケースあり）
2. メルカリセレクタのフォールバック強化（data-testid廃止リスク）
3. 在庫アラート Phase 4（曜日パターン・セット品統合）未実装

## 役割分担
- Claude（チャット）= 設計担当：方針決定・レビュー
- Claude Code（VPS）= 実行担当：実装・テスト
- 決定は実装前に必ず議論する
