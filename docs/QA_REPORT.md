# QA / 検証レポート

## 自動検証

- `node --check app.js` — PASS
- `node --check src/core.js` — PASS
- `node --check src/db.js` — PASS
- `node --check sw.js` — PASS
- `npm test` — PASS（5 tests）
- Manifest JSON parse — PASS
- PWA icon assets (192px / 512px / Apple touch icon) — PASS
- HTTP static resource checks (`index.html`, `app.js`, `manifest.webmanifest`) — PASS（HTTP 200）

## 自動テスト項目

1. 5桁固定点数の入力検証、0.000・99.999の境界
2. 平均点の整数演算・四捨五入、最高点・歌唱回数・最終日時
3. NFKC・大文字小文字を考慮した部分一致検索
4. お気に入り・採点済み・未採点の絞り込みと採点順
5. JSONバックアップの妥当性確認、ID競合時に既存データを上書きしないマージ計画

## 未実施の実機確認

この実行環境では Chromium headless の起動処理がタイムアウトし、ブラウザ操作によるE2E確認を完了できませんでした。また iPhone Safari / Android Chrome の実機は未確認です。初回デプロイ前に、次を実機で確認してください。

- PWAホーム画面追加と standalone 起動
- 初回キャッシュ後のオフライン起動・CRUD・バックアップ復元
- 数字キーボード表示とボトムシートの視認性
- iOS / Android のセーフエリア・画面回転・文字サイズ変更
- ピンチ／ダブルタップズーム抑止の実機挙動

ここに記載した未実施項目を、実機検証済みとは扱いません。
