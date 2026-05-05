# イベントデバッガー

G2 グラスから送信される生イベント（ `EvenHubEvent` ）をリアルタイムでキャプチャし、その内容を JSON 形式で画面に表示するデバッグ用アプリです。

初期状態は以下の画面が表示されます。

![初期状態](./assets/01-initial.png)

## 主な機能

- イベントキャプチャ: タップ、スワイプ、リング操作、ライフサイクルイベントなど、すべての EvenHubEvent を捕捉します。
- JSON インスペクション: 取得したイベントオブジェクトを整形して表示。Uint8Array（音声データ）や bigint もデバッグしやすいように文字列化して処理します。
  - ただ実装上は音声イベントには対応できていないです
- スクロール対応: ログが長い場合でも、G2 のスワイプ操作でログを上下にスクロールして確認できます。

## 実装のポイント

src/main.ts では、実機開発で直面するいくつかの技術的制約に対処しています。

### 1. テキストコンテナの文字数制限

textContainerUpgrade で更新できるテキストには上限（約 1,800 文字程度）があります。これを超えると更新が反映されないため、アプリ側で切り詰め処理を行っています。

```typescript
const CHAR_LIMIT = 1800;
function trim(text: string): string {
  if (text.length <= CHAR_LIMIT) return text;
  return text.slice(0, CHAR_LIMIT) + "\n...truncated";
}
```

### 2. 特殊型のシリアライズ

JSON.stringify ではそのまま扱えない型を、デバッグに適した形式に変換しています。

- `Uint8Array` : 音声データなどが含まれる場合、全バイナリを出力するとログが埋まるため、長さと先頭数バイトのみを抽出します。
- `bigint` : 文字列に変換してシリアライズエラーを回避します。

### 3. 状態管理と描画の排他制御

イベントが連続して発生した際に描画処理が競合しないよう、Promise チェーン（renderChain）を用いて非同期の updateContainer 呼び出しを順次実行しています。

## 動作確認結果と仕様の差異（重要）

実機およびシミュレーターでの動作確認を通じて、SDK の型定義やドキュメントと実際の挙動の間に以下のような特徴があることが分かりました。

### CLICK_EVENT (0) の不定性

シングルタップ時に発行される CLICK_EVENT は、内部的な Protobuf の仕様により、値が 0 の場合にフィールド自体が省略（undefined）されることがあります。

- 対策: sysEvent が存在し、かつ eventType が 0 または undefined の場合にクリックとして判定する必要があります。

### イベントソースの分離

操作の種類によって、イベントが格納されるプロパティが異なります。

| 操作 | 主なイベントプロパティ | 挙動の特徴 |
|---|---|---|
| タップ系 | sysEvent | isEventCapture: 1 を設定したコンテナに関わらず、システム全体のイベントとして飛んでくる傾向があります。 |
| スクロール系 | textEvent | isEventCapture: 1 を設定したコンテナに対する操作として、containerID と共に飛んできます。この時 sysEvent は undefined になることがあります。 |

### isEventCapture の役割

ページ内に 1 つだけ設定する isEventCapture: 1 は、主 *スワイプ（スクロール）イベントを受け取る対象 を決定します。タップイベントは、どのコンテナに設定していても（あるいは設定していなくても）アプリに届きますが、スクロールを検知したいコンテナには必ずこのフラグが必要です。

## 各イベントのキャプチャ例

以下にシミュレーター上で実行したときのイベントログを載せる。

イミュレータ上では右テンプルの入力として扱われる。

eventSource|入力元
:--|:--
1|右テンプル
2|リング（R1）
3|左テンプル

### シングルタップ (CLICK)

sysEvent として検知されます。前述の通り eventType は省略されることが多いです。

1枚目

![Click1](./assets/04-click-1.png)

2枚目

![Click2](./assets/04-click-2.png)

### スクロール (SCROLL_TOP / BOTTOM)

textEvent として検知され、操作されたコンテナの情報が含まれます。

1枚目

![Scroll Down1](./assets/03-down-1.png)

2枚目

![Scroll Down2](./assets/03-down-2.png)

### ダブルタップ (DOUBLE_CLICK)

アプリ終了のトリガーとしてよく使われます。sysEvent または textEvent のいずれか、あるいは両方で検知される可能性があります。

1枚目

![Double Click1](./assets/05-dbclick-1.png)

2枚目

![Double Click2](./assets/05-dbclick-2.png)
