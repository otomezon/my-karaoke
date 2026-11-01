# My Karaoke PWA 1.3.0

スマートフォン向けの個人用カラオケレパートリー・採点履歴管理PWAです。HTML/CSS/JavaScriptのみで構成し、曲・採点履歴・設定は IndexedDB に保存します。外部APIやアカウント、アプリ用サーバーは不要です。

## 起動

PWA・Service Worker・IndexedDB を利用するため、`file://` で直接開かず、HTTPS または localhost で配信してください。

```bash
cd my-karaoke-pwa
python3 -m http.server 4173
```

PCのブラウザで `http://localhost:4173` を開きます。スマートフォンにインストールする場合は、GitHub Pages等のHTTPS対応静的ホスティングへフォルダ内のファイルを配置し、そのHTTPS URLを端末で開いてください（Service WorkerとPWAインストールにはHTTPSが必要です。localhostは開発用の例外です）。

- iPhone：SafariでHTTPS URLを開き、共有メニューから「ホーム画面に追加」。
- Android：ChromeでHTTPS URLを開き、メニューから「アプリをインストール」または「ホーム画面に追加」。

初回にオンラインで読み込んだ後は、Service Worker のキャッシュによりオフライン起動できます。

## 主な機能

- 曲の登録・編集・削除、お気に入り
- 曲名・アーティスト名の部分一致検索（NFKC正規化）
- お気に入り／採点済み／未採点の絞り込み
- 登録順・新着順・曲名順・アーティスト名順・平均点順・最高点順・歌唱回数順・最近歌った順
- 5桁固定の採点入力（例：93863 → 93.863点）
- 採点履歴の追加・編集・削除、直後の取り消し
- 平均点・最高点・歌唱回数・最終歌唱日時の自動集計
- JSONバックアップ、置き換え復元、ID競合を避ける追加インポート
- ダークテーマ、スマートフォン向けレイアウト、PWA・オフラインキャッシュ

## データについて

データはブラウザのオリジン単位で IndexedDB に保存されます。同じ端末でもブラウザや配信URL（オリジン）が変わるとデータは共有されません。ブラウザデータの消去・端末故障・機種変更に備え、設定画面から定期的にJSONバックアップを取得してください。データを外部サーバーへ送信する処理はありません。

## テスト

Node.js 20 以降を推奨します。

```bash
npm test
```

ブラウザ実機でのPWAインストール、オフライン起動、IndexedDB、ファイル保存・復元、iOS Safari / Android Chrome の数字キーボード・セーフエリア・ズーム抑止については実機確認が必要です。

## 画面倍率

viewport を `width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no` とし、CSS `touch-action: pan-x pan-y` を使用しています。OSやブラウザのアクセシビリティ拡大機能など、アプリ外の挙動まで全環境で抑止できるものではありません。文字サイズ変更により画面が狭くなった場合は、ズームではなくスクロール・折り返しで閲覧する設計です。
