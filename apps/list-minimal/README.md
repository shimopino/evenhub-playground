# リスト最小サンプル

`ListContainerProperty` を使った G2 グラスのネイティブリスト挙動を確認するための最小サンプルです。

中央にリストコンテナを配置し、上下入力で選択がどう移動するか、クリックやダブルクリック時に画面表示がどう変わるかを確認できます。生イベントの詳細ログを解析するためのアプリではなく、リスト UI の基本挙動を目視で確認することを目的にしています。

## 主な検証目的

- `ListContainerProperty` を `isEventCapture: 1` にした時の選択移動を確認する
- 選択中 item の index と label が取得できるか確認する
- 日本語、記号、長い item label がリスト内でどう表示されるか確認する
- リストコンテナとテキストコンテナを同じページに置いた時の収まりを確認する

## 画面構成

| 領域 | Container | 役割 |
|---|---|---|
| 上部 | `TextContainerProperty` | アプリ名 |
| 中央 | `ListContainerProperty` | 操作用の検証リスト |
| 下部 | `TextContainerProperty` | 選択中 item と入力種別の 3 行要約 |

`isEventCapture: 1` は中央のリストコンテナだけに設定しています。

## テキスト表示の注意点

G2 のテキストは行高 27px 固定で、`paddingLength` と `borderWidth` はコンテナの内側表示領域を削ります。コンテナ高さだけを見て文字数を決めると、実際には内側の高さが足りず、スクロールバーが出たり末尾行が見切れたりします。

このアプリでは `@evenrealities/pretext` の `pxTruncate()` を使い、タイトルは 1 行、下部表示は 3 行に固定して、生成した各行が横幅に収まるようにしています。

## 操作方法

- 上下入力: リスト選択の移動を確認
- シングルタップ: 選択状態の表示を確認
- ダブルタップ: 終了確認ダイアログを表示

## 実行

```bash
pnpm --filter @evenhub-playground/list-minimal dev
```

別ターミナルでシミュレータを起動します。

```bash
pnpm --filter @evenhub-playground/list-minimal simulator
```

シミュレータ起動後、HTTP API に入力を送りながら WebView console log を確認できます。

```bash
pnpm list:minimal:sim-logs
```

任意の入力列を指定する場合:

```bash
pnpm list:minimal:sim-logs --clear down down click up
```
