import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";
import { pxTruncate } from "@evenrealities/pretext";

const TITLE_CONTAINER_ID = 1;
const LIST_CONTAINER_ID = 2;
const LOG_CONTAINER_ID = 3;

const SCREEN_WIDTH = 576;
const TEXT_BORDER = 1;
const TEXT_PADDING = 4;
const TEXT_INSET = TEXT_BORDER + TEXT_PADDING;
const TEXT_INNER_WIDTH = SCREEN_WIDTH - TEXT_INSET * 2;

// G2のテキストは行の高さが27px固定で、パディングとボーダーが内側のテキスト領域を狭める。
// 以前のレイアウトではタイトル2行を48px・ログ4行以上を104pxに収めようとしたため、
// LVGLがテキストをスクロール可能にして最終行を切り捨ててしまった。
// pretextで水平方向に切り詰め、各コンテナを明示的な行数に収めることで、
// スクロールに頼らず全ての生成行が完全に表示されるようにする。
const TITLE_LINES = 1;
const LOG_LINES = 3;

const LAYOUT = {
  titleY: 0,
  titleH: 38,
  listY: 42,
  listH: 144,
  logY: 190,
  logH: 98,
};

// リストの選択肢として表示する
const LIST_ITEMS = [
  "Status",
  "Settings",
  "日本語メニュー",
  "Long label wraps or clips?",
  "Timer",
  "ASR",
  "Image test",
  "Exit confirm",
  "Symbols ▲ ▼ ● ○",
  "Last item",
];

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(
      value,
      (_key, v) => {
        if (v instanceof Uint8Array) {
          return {
            type: "Uint8Array",
            length: v.length,
            preview: Array.from(v.slice(0, 8)),
          };
        }
        if (typeof v === "bigint") {
          return v.toString();
        }
        return v;
      },
      2,
    );
  } catch (err) {
    return JSON.stringify({
      stringifyError: String(err),
      fallback: String(value),
    });
  }
}

function localTime(): string {
  return new Date().toLocaleTimeString(undefined, {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

function getEventKind(event: EvenHubEvent): string {
  if (event.listEvent) return "listEvent";
  if (event.textEvent) return "textEvent";
  if (event.sysEvent) return "sysEvent";
  if (event.audioEvent) return "audioEvent";
  return "unknown";
}

function getEventType(event: EvenHubEvent): unknown {
  return (
    event.listEvent?.eventType ??
    event.textEvent?.eventType ??
    event.sysEvent?.eventType
  );
}

function eventTypeName(value: unknown): string {
  if (typeof value !== "number") return String(value);
  return OsEventTypeList[value] ?? String(value);
}

// テキスト処理のために提供されているライブラリ
// 指定した横幅に応じて入力文字列の切り取りを行う。想定サイズ以上なら  ‘…’ を末尾につける
function fitLine(text: string): string {
  return pxTruncate(text, TEXT_INNER_WIDTH);
}

function fitLines(lines: string[], maxLines: number): string {
  return lines.slice(0, maxLines).map(fitLine).join("\n");
}

async function updateTextContainer(id: number, name: string, content: string) {
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: id,
      containerName: name,
      contentOffset: 0,
      contentLength: 0,
      content,
    }),
  );
}

function summarizeListState(event: EvenHubEvent): string {
  const eventType = getEventType(event);
  const kind = getEventKind(event);
  const eventName = eventTypeName(eventType);
  const index = event.listEvent?.currentSelectItemIndex;
  const item = event.listEvent?.currentSelectItemName;

  return fitLines(
    [
      `Selected: ${index ?? "-"}`,
      `Item: ${item ?? "-"}`,
      `${localTime()} ${kind} ${eventName}`,
    ],
    LOG_LINES,
  );
}

const bridge = await waitForEvenAppBridge();
console.log("[list-minimal] bridge ready");

const titleContainer = new TextContainerProperty({
  xPosition: 0,
  yPosition: LAYOUT.titleY,
  width: SCREEN_WIDTH,
  height: LAYOUT.titleH,
  borderWidth: TEXT_BORDER,
  borderColor: 6,
  paddingLength: TEXT_PADDING,
  containerID: TITLE_CONTAINER_ID,
  containerName: "title",
  content: fitLines(["LIST MINIMAL"], TITLE_LINES),
  isEventCapture: 0,
});

const listContainer = new ListContainerProperty({
  xPosition: 0,
  yPosition: LAYOUT.listY,
  width: SCREEN_WIDTH,
  height: LAYOUT.listH,
  borderWidth: 1,
  borderColor: 8,
  paddingLength: 4,
  containerID: LIST_CONTAINER_ID,
  containerName: "list",
  isEventCapture: 1,
  itemContainer: new ListItemContainerProperty({
    itemCount: LIST_ITEMS.length,
    itemWidth: 0,
    isItemSelectBorderEn: 1,
    itemName: LIST_ITEMS,
  }),
});

const logContainer = new TextContainerProperty({
  xPosition: 0,
  yPosition: LAYOUT.logY,
  width: SCREEN_WIDTH,
  height: LAYOUT.logH,
  borderWidth: TEXT_BORDER,
  borderColor: 6,
  paddingLength: TEXT_PADDING,
  containerID: LOG_CONTAINER_ID,
  containerName: "log",
  content: fitLines(
    ["Native list container", "Up/down: select item", "Click: observe result"],
    LOG_LINES,
  ),
  isEventCapture: 0,
});

const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 3,
    textObject: [titleContainer, logContainer],
    listObject: [listContainer],
  }),
);

console.log(
  "[list-minimal] page created",
  result === 0 ? "success" : `failed (${result})`,
);

let renderChain = Promise.resolve();

const unsubscribe = bridge.onEvenHubEvent((event: EvenHubEvent) => {
  console.log("[list-minimal] event", safeStringify(event));

  const sysType = event.sysEvent?.eventType;
  const listType = event.listEvent?.eventType;
  const textType = event.textEvent?.eventType;

  if (
    sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
    sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT
  ) {
    unsubscribe();
    return;
  }

  if (
    sysType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
    listType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
    textType === OsEventTypeList.DOUBLE_CLICK_EVENT
  ) {
    void bridge.shutDownPageContainer(1);
    return;
  }

  renderChain = renderChain
    .then(async () => {
      await updateTextContainer(
        LOG_CONTAINER_ID,
        "log",
        summarizeListState(event),
      );
    })
    .catch((err) => {
      console.error("[list-minimal] render error", err);
    });
});
