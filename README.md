# QR Maker

URLを貼るとプレーンなQRコードができるツール。ビルド不要、依存ライブラリはqrcode-generatorのみ(同梱)。

リポジトリ: [git@github.com:daaaaaai/qrcode_maker.git](https://github.com/daaaaaai/qrcode_maker)

## ファイル構成

| ファイル | 役割 |
|---|---|
| index.html | 画面一式 |
| style.css | スタイル(クリーン・ミニマル路線) |
| app.js | QR生成・描画・PNG保存のロジック |
| qrcode.min.js | QRコード生成用ライブラリ(qrcode-generator、CDNから取得してベンダリング。詳細は下記) |

## 使い方

1. `index.html` をブラウザで開く
2. 入力欄にURLを貼る(またはテキストを入力する)。入力と同時にQRコードが出る
3. 「PNGで保存」で画像としてダウンロードする

## 仕様

- **入力は一切加工しない。** `https://` の補完もしなければ、前後の空白を取る以外の変換もしない。
  画面に見えている文字列とQRコードに入る内容を常に一致させるため
- **誤り訂正レベルはM固定**、**型番は内容量から自動決定**。装飾やロゴの埋め込みはしない(プレーンなQRコード)
- 四辺にはQRコードの仕様どおり4モジュールぶんの余白(クワイエットゾーン)を入れる
- PNGは一辺およそ1024pxで出力する。モジュールが整数ピクセルに揃うよう倍率を丸めているため、
  実際のサイズは内容量によって1023〜1036px程度で前後する
- 内容が型番40(最大)にも収まらない場合はQRコードを出さず、その旨を表示する

## 動作確認

`file://` で直接開いて動作する(Chromiumで確認済み)。ネットワーク通信は一切しない。

生成したQRコードを[jsQR](https://github.com/cozmo/jsQR)で読み戻し、入力した文字列と一致することを
確認している(ASCII、クエリ・フラグメント付きURL、日本語を含むURL、1000文字のテキスト)。

## 使用ライブラリ

- **[qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)** v1.4.4(Kazuhiko Arase作) — [MIT License](https://github.com/kazuhikoarase/qrcode-generator/blob/master/LICENSE)
- `qrcode.min.js` は https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js から取得し、ビルド不要でそのまま同梱(vendoring)している

## 既知の注意点

- ライブラリの既定の文字コード変換はLatin-1相当(`charCodeAt` の下位1バイト)のため、そのままでは
  日本語を含む文字列が壊れる。`app.js` で `qrcode.stringToBytes` をUTF-8版に差し替えている
- UTF-8のECIヘッダは付与していない。一般的なリーダーはUTF-8として解釈するが、
  古い読み取り機では日本語が化ける可能性がある
