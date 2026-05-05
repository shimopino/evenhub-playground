// 参考資料（公式）
// - https://hub.evenrealities.com/docs/getting-started/overview
// - https://hub.evenrealities.com/docs/getting-started/architecture
// - https://hub.evenrealities.com/docs/guides/input-events
// - https://hub.evenrealities.com/docs/guides/device-apis
// - https://hub.evenrealities.com/docs/getting-started/installation
import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  waitForEvenAppBridge,
} from "@evenrealities/even_hub_sdk";

// 公式推奨の初期化経路。
// waitForEvenAppBridge() は、Even Hub 側の native bridge が使える状態になるまで待つ。
// 以降の SDK 呼び出しは、この bridge を起点に行う。
const bridge = await waitForEvenAppBridge();

const mainText = new TextContainerProperty({
  // G2 の表示キャンバスは 576x288px。
  // ここでは左上 (0,0) から画面全体を 1 つの text container で埋めている。
  xPosition: 0,
  yPosition: 0,
  // width / height はコンテナ領域のサイズ。
  // 画面全体を使うのでスクリーンサイズそのままを指定する。
  width: 576,
  height: 288,
  // borderWidth = 0 なので枠線は描画されない。
  // borderColor は 4bit greyscale の色番号だが、この設定では実質参照されない。
  // borderWidth: 0,
  borderWidth: 1,
  // borderColor の値は 0〜15 のグレースケール番号。
  // 5 は中間値だが、borderWidth が 0 のため見た目には影響しない。
  borderColor: 5,
  // paddingLength はコンテナ内側の余白(px)。
  // 文字を端に寄せすぎないための最小限の余白を入れている。
  paddingLength: 4,
  // containerID / containerName は、後で rebuild や textContainerUpgrade する際の識別子。
  // containerID はページ内で一意である必要がある。
  containerID: 1,
  containerName: "main",
  // createStartUpPageContainer() で渡す text content は最大 1000 文字。
  // 改行は \n で明示する。
  content: "Hello from G2!\nDouble-tap to exit.",
  // 1 にしたコンテナが入力イベントの受け口になる。
  // ページ内で isEventCapture: 1 は必ず 1 つだけ。
  isEventCapture: 1,
});

// コンテナというものが、グラス画面上に配置するUIの基本単位
// 種類ごとに役割が異なる
// - TextContainerProperty : 文字を表示する
// - ListContainerProperty : 選択式のリストを表示する
// - ImageContainerProperty : 画像の表示枠になる
//
// 1ページあたりの上限として
// - 合計12個まで
// - テキスト・リストは8個まで
// - 画像は4個まで

// createStartUpPageContainer() は起動時に 1 回だけ呼ぶ初期レイアウト登録 API。
// containerTotalNum は、このページに置くコンテナ総数を示す。
const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    // このサンプルは text container 1 個だけなので 1。
    containerTotalNum: 1,
    // textObject / listObject / imageObject に、ページ上の全コンテナ定義をまとめて渡す。
    textObject: [mainText],
  }),
);

// createStartUpPageContainer() の戻り値は 0 = success, 1 = invalid, 2 = oversize, 3 = outOfMemory。
console.log("Page created:", result === 0 ? "success" : `failed (${result})`);

// onEvenHubEvent() は textEvent / listEvent / sysEvent / audioEvent をまとめて受ける。
// このサンプルでは、イベントのうち終了に必要なものだけを見ている。
const unsubscribe = bridge.onEvenHubEvent((event) => {
  // protobuf の都合で 0 相当の値は undefined になることがあるため、nullish coalescing を使う。
  const sysType = event.sysEvent?.eventType ?? null;
  const textType = event.textEvent?.eventType ?? null;

  // DOUBLE_CLICK_EVENT(3) は「終了導線」。
  // shutDownPageContainer(1) は確認ダイアログ付き終了で、ユーザーがキャンセルできる。
  if (
    sysType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
    textType === OsEventTypeList.DOUBLE_CLICK_EVENT
  ) {
    bridge.shutDownPageContainer(1);
    return;
  }

  // SYSTEM_EXIT_EVENT(7) はユーザーが退出を確定した後に来る system-level event。
  // ABNORMAL_EXIT_EVENT(6) は接続断などの想定外終了。
  // 本来ここで timers / hardware / listener の後始末を行う。
  if (
    sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
    sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT
  ) {
    // onEvenHubEvent() は unsubscribe 関数を返すので、ページ終了時に必ず解除する。
    unsubscribe();
  }
});
