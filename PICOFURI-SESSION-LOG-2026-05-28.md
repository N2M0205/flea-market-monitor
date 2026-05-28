# ピコフリ セッションログ 2026-05-28

## セッション概要
- 日付: 2026-05-28
- 内容: Telegram キーワード一覧「message is too long」エラー修正

---

## 完了した作業

### 1. Telegram キーワード一覧 メッセージ分割修正
- **問題**: キーワード49件の一覧表示が4096字制限を超え `ETELEGRAM: 400 Bad Request: message is too long` が発生
- **原因箇所**: `server/scripts/telegram-bot.cjs` の `handleList()` 内 line 353
  - `lines.join('\n\n')` で全件を1メッセージに結合して送信していた
  - 推定文字数: 約4,280字（ヘッダ22字 + 49件×85字平均 + セパレータ96字）
- **修正内容**: 4000字を超えそうになったら中間送信し、次のチャンクへ移行するループに変更
  - `CHUNK_LIMIT = 4000`
  - ヘッダ（件数表示）は最初のメッセージのみ
  - 中間メッセージは `bot.sendMessage`（キーボードなし）
  - 最後のメッセージのみ `replyWithKeyboard`（メインキーボード付与）
- **推定分割数**: 2通（1通目: ヘッダ＋約45件、2通目: 残り4件）
- **ブランチ**: `fix/telegram-list-split`
- **PM2**: `telegram-bot` を restart 済み

---

## 変更ファイルとコミットハッシュ

| ハッシュ | 内容 | ファイル |
|---------|------|---------|
| `2d22a22` | fix: Telegramキーワード一覧を4000字超えで複数メッセージに分割 | server/scripts/telegram-bot.cjs |
| `f7e58bb` | Merge fix/telegram-list-split into master | — |

---

## 発見された事実・教訓

- Telegram の 4096 字制限はバイト数ではなく文字数カウント（日本語も1字=1）
- `replyWithKeyboard()` は常にメインキーボードを付けるため、中間メッセージは `bot.sendMessage()` を直接呼ぶ必要がある
- キーワード件数が増えるにつれ超過リスクは高まるが、4000字/チャンクの分割方式なら件数上限なし
- 修正前エラーは `telegram-bot-error.log` に3件記録（修正前の📋 一覧ボタン連打分）

---

## 未完了タスク

- Telegram 「📋 一覧」で実際に2通分割されることのユーザー確認（bot 操作が必要）
- 既知の未解決課題（CLAUDE.md 記載）:
  1. LINE通知未着（ログ上は送信成功だが届かないケースあり）
  2. メルカリセレクタのフォールバック強化
  3. 在庫アラート Phase 4（曜日パターン・セット品統合）未実装

---

## PM2 状態（セッション終了時）

| プロセス | 状態 | uptime | メモリ |
|---------|------|--------|--------|
| picofuri-backend | online | 19h | 160.5mb |
| telegram-bot | online | 5m（restart後） | 23.4mb |
| cc-bot | online | 6D | 23.3mb |
| manual-price-bot | online | 43h | 11.9mb |
| pricera-bot | online | 100m | 10.6mb |
| pricera-dashboard | online | 5D | 8.8mb |
| pricera-tunnel | online | 5D | 7.3mb |
| chrome-cleanup / crossmall-* / health-check / inventory-alert | stopped（cronジョブ、正常） | — | — |
