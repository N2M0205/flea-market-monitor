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
