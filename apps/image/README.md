# 画像レンダリングデモ

Even Hub G2 の画像表示を、公式ドキュメントに沿ってひと通り学べるようにまとめたサンプルです。
このアプリは「画像を表示するだけ」に見えますが、実際には以下の論点が詰まっています。

- 画像コンテナは起動時に直接データを流し込めない
- 画像コンテナはイベントを受け取れない
- `updateImageRawData` は同時送信できない
- 端末向けの表示サイズに合わせて、画像をリサイズする
  - SDKに任せることもできるが、描画精度の向上のため事前処理を入れている

## このサンプルでやっていること

以下の画像を読み込み、ブラウザの `canvas` で `288 x 144` に縮小して PNG 化し、Even Hub の画像コンテナに送っています。

![public-free](./public/public-free.jpg)

画面構成は 3 コンテナです。

- `eventLayer`
  - 全画面のテキストコンテナ
  - 背面に置いてタップやダブルタップを拾う
- `status`
  - 状態表示用のテキストコンテナ
  - 読み込み結果やエラーを出す
- `frame`
  - 実際の画像を描画する画像コンテナ

関連コード:

- [src/main.ts](./src/main.ts)
- [src/image/renderer.ts](./src/image/renderer.ts)

## 実装の全体像

起動時の処理は次の順番です。

1. `waitForEvenAppBridge()` で SDK ブリッジを待つ
2. `createStartUpPageContainer()` で `eventLayer` / `status` / `frame` を作る
3. `loadImageBytes()` で画像を取得してリサイズする
4. `updateImageRawData()` で画像コンテナへ送る
5. タップで再読み込み、ダブルタップで終了する

この構成は、公式ドキュメントの「Display & UI System」「Input & Events」「Page Lifecycle」に沿っています。

## なぜ `canvas` で縮小するのか

`updateImageRawData()` は画像コンテナにそのままバイナリを送る API ですが、実際の元画像は大きいことが多いです。
このサンプルでは、ブラウザの `canvas` を中継してサイズを合わせています。

[`src/image/renderer.ts`](./src/image/renderer.ts) の流れは次の通りです。

1. `fetch()` で画像を取得する
2. `blob` を `object URL` にして `Image` に読み込む
3. `canvas` に描画して指定サイズへリサンプルする
4. `canvas.toBlob("image/png")` で PNG に戻す
5. `Uint8Array` に変換して SDK に渡す

ここで PNG を使う理由は、画像コンテナに渡すデータを安定して扱えるからです。
ブラウザ内で完結しているので、外部の画像処理ライブラリなしで実装できます。

## 公式仕様との対応

### 1. 画像コンテナはイベントを受け取れない

公式ドキュメントでは、イベントを受けるのは `isEventCapture: 1` のコンテナです。
画像コンテナそのものはイベント受け取りに使えないため、このサンプルでは全画面のテキストコンテナ `eventLayer` を背面に置いています。

つまり、見た目は画像でも、入力の受け皿はテキストコンテナです。

### 2. 画像更新は起動時に直接送らない

`createStartUpPageContainer()` の段階では画像データをそのまま送れません。
そのため、まずプレースホルダーとして画像コンテナだけを作り、その後に `updateImageRawData()` で中身を更新しています。

### 3. `updateImageRawData()` は並列実行しない

画像送信は同時に複数回走らせてはいけません。
このサンプルでは `rendering` という Promise チェーンを使い、1 回ずつ順番に流すようにしています。

## イベント処理の考え方

[`src/main.ts`](./src/main.ts) のイベント処理は、画像表示アプリでありがちな操作を最小限にまとめています。

- シングルタップ
  - 画像を再読み込み
- ダブルタップ
  - アプリ終了
- システム終了系イベント
  - 後始末して購読解除

特に注意点は `CLICK_EVENT(0)` です。
公式でも説明されている通り、0 は protobuf の都合で `undefined` として届くことがあります。
このサンプルでは `undefined` もクリック扱いにしています。

## シミュレーター上のレンダリング結果

`assets/public-free-converted.png` には、シミュレーター上で変換後にレンダリングされた結果を置いています。
元画像 `public/public-free.jpg` を 576 x 288 のキャンバスに合わせた見え方の確認用です。

![Simulator render](./assets/public-free-converted.png)

元画像:

![Source image](./public/public-free.jpg)

この2つを見比べると、ブラウザ側での縮小と、Even Hub 側の表示がどうつながるかを追いやすくなります。

## 学習ポイント

このサンプルから押さえるべきポイントは次の 4 つです。

1. 表示は HTML ではなく SDK コンテナの合成で作る
2. 画像表示でも、入力を受けるのは別のコンテナに分ける
3. 画像更新は `updateImageRawData()` を 1 本ずつ流す
4. 元画像はブラウザ側でリサイズしてから送る

この方針にしておくと、画像表示を中心にしたアプリでも、イベント処理と表示処理を無理なく分離できます。

## 実装メモ

- `SAMPLE_URL` は `public/public-free.jpg` を指す
- `IMG_W` / `IMG_H` は表示枠のサイズ
- `setStatus()` は `textContainerUpgrade()` で状態文字列を更新する
- `cleanup()` は二重実行されないようガードしている
- `bridge.shutDownPageContainer(1)` で終了確認ダイアログを出す

## 参考資料

以下の公式ドキュメントをベースにしています。

- [Display & UI System](https://hub.evenrealities.com/docs/guides/display)
- [Input & Events](https://hub.evenrealities.com/docs/guides/input-events)
- [Page Lifecycle](https://hub.evenrealities.com/docs/guides/page-lifecycle)

コードの参照先:

- [src/main.ts](./src/main.ts)
- [src/image/renderer.ts](./src/image/renderer.ts)
