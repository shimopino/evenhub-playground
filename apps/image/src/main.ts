import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import { loadImageBytes } from "./image/renderer";

const SAMPLE_URL = `${import.meta.env.BASE_URL}public-free.jpg`;

const bridge = await waitForEvenAppBridge();

// 画像のコンテナはイベントをキャプチャすることができない
// そこで、画像のコンテナの背後にテキストコンテナを配置して入力を受け付けることができるようにする
const eventLayer = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  borderColor: 0,
  paddingLength: 0,
  containerID: 1,
  containerName: "eventLayer",
  content: " ",
  isEventCapture: 1,
});

const statusLine = new TextContainerProperty({
  xPosition: 0,
  yPosition: 220,
  width: 576,
  height: 40,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 2,
  containerName: "status",
  content: "Loading…",
  isEventCapture: 0,
});

// 画像コンテナは 288x144 が上限なので、その中で元画像の縦横比を保つ
// 画像コンテナの横幅： 20 ~ 288
// 画像コンテナの縦幅： 20 ~ 144
const IMG_W = 288;
const IMG_H = 144;
const image = new ImageContainerProperty({
  xPosition: (576 - IMG_W) / 2,
  yPosition: 40,
  width: IMG_W,
  height: IMG_H,
  containerID: 3,
  containerName: "frame",
});

const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 3,
    textObject: [eventLayer, statusLine],
    imageObject: [image],
  }),
);
if (created !== 0) {
  console.error("createStartUpPageContainer failed:", created);
}

async function setStatus(text: string) {
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: 2,
      containerName: "status",
      content: text,
    }),
  );
}

// 制約として、 updateImageRawData は 同時に複数発行してはいけず、同期的に処理する必要がある
// https://hub.evenrealities.com/docs/guides/page-lifecycle
// https://hub.evenrealities.com/docs/guides/display
let rendering: Promise<unknown> = Promise.resolve();
async function pushFrame(bytes: Uint8Array) {
  // この関数が呼び出されるたびに、既存の rendering の後続に画像更新の処理をつなげている
  rendering = rendering.then(async () => {
    const result = await bridge.updateImageRawData(
      new ImageRawDataUpdate({
        containerID: 3,
        containerName: "frame",
        imageData: bytes,
      }),
    );
    if (result !== "success") {
      await setStatus(`Render: ${result}`);
      console.error("updateImageRawData:", result);
    }
  });
  // 関数の呼び出し元も、
  await rendering;
}

try {
  const bytes = await loadImageBytes(SAMPLE_URL, IMG_W, IMG_H);
  await pushFrame(bytes);
  await setStatus("Tap to reload · double-tap to exit");
} catch (err) {
  console.error(err);
  await setStatus(
    `Load failed: ${err instanceof Error ? err.message : String(err)}`,
  );
}

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  unsubscribe();
}

// 制約としての整理
// - Protobuf では0の値は省略されてしまうため、 CLICK_EVENT(0) は undefined で到達する
// - シングルタップとダブルタップは event.sysEvent として検出される
// - スクロールは event.textEvent として検出される
// - ダブルタップでのアプリの終了は、ルートレベルでのチェック機構となる
//   - これは必ずイベントとして発火させることで、ユーザーはいつでもアプリを閉じることができる
const unsubscribe = bridge.onEvenHubEvent((event) => {
  const hasSysEvent = event.sysEvent !== undefined;
  const sysType = event.sysEvent?.eventType;
  const textType = event.textEvent?.eventType ?? null;

  // ダブルクリックは sysEvent できているが、念のための保険として textEvent も見ている
  // 削除してしまってもよいかもしれない
  if (
    sysType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
    textType === OsEventTypeList.DOUBLE_CLICK_EVENT
  ) {
    bridge.shutDownPageContainer(1);
    return;
  }

  // CLICK_EVENT(0) は protobuf 上では undefined で届くことがあるため、
  // sysEvent の存在と eventType 未設定の両方をクリックとして扱う
  if (
    hasSysEvent &&
    (sysType === OsEventTypeList.CLICK_EVENT || sysType === undefined)
  ) {
    loadImageBytes(SAMPLE_URL, IMG_W, IMG_H)
      .then(pushFrame)
      .catch((err) => console.error(err));
    return;
  }

  if (
    sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
    sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT
  ) {
    cleanup();
  }
});

window.addEventListener("beforeunload", cleanup);

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <main style="margin:auto;padding:24px;max-width:640px;text-align:center;">
    <h1 style="font-size:18px;font-weight:600;margin:0 0 8px;">Image Demo</h1>
    <p style="color:#919191;font-size:14px;margin:0;">
      Check the glasses — <code>public/public-free.jpg</code> should render.
      Tap to reload, double-tap to exit. Drop a new PNG/JPG into
      <code>public/</code> and point <code>SAMPLE_URL</code> at it.
    </p>
  </main>
`;
