import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";

const TITLE_ID = 1;
const BODY_ID = 2;
const CHAR_LIMIT = 1800;

type AppState = "waiting" | "logging";

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
    timeZoneName: "long",
  });
}

function getEventKind(event: EvenHubEvent): string {
  if (event.textEvent) return "textEvent";
  if (event.listEvent) return "listEvent";
  if (event.sysEvent) return "sysEvent";
  if (event.audioEvent) return "audioEvent";
  return "unknown";
}

function getEventType(event: EvenHubEvent): unknown {
  // audioEvent has only audioPcm — no eventType field
  return (
    event.textEvent?.eventType ??
    event.listEvent?.eventType ??
    event.sysEvent?.eventType
  );
}

function trim(text: string): string {
  if (text.length <= CHAR_LIMIT) return text;
  return text.slice(0, CHAR_LIMIT) + "\n...truncated";
}

async function updateContainer(id: number, name: string, content: string) {
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

const bridge = await waitForEvenAppBridge();
console.log("[event-debugger] bridge ready");

const titleContainer = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 56,
  borderWidth: 1,
  borderColor: 6,
  paddingLength: 6,
  containerID: TITLE_ID,
  containerName: "title",
  content: "EVENT DEBUGGER",
  isEventCapture: 0,
});

const bodyContainer = new TextContainerProperty({
  xPosition: 0,
  yPosition: 64,
  width: 576,
  height: 224,
  borderWidth: 1,
  borderColor: 6,
  paddingLength: 6,
  containerID: BODY_ID,
  containerName: "body",
  content: "Perform any input\nto capture an event.\n\n(tap, swipe, ring...)",
  isEventCapture: 1,
});

const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 2,
    textObject: [titleContainer, bodyContainer],
  }),
);

console.log(
  "[event-debugger] page created",
  result === 0 ? "success" : `failed (${result})`,
);

let state: AppState = "waiting";
let renderChain = Promise.resolve();

async function showWaiting() {
  await updateContainer(TITLE_ID, "title", "EVENT DEBUGGER");
  await updateContainer(
    BODY_ID,
    "body",
    "Perform any input\nto capture an event.\n\n(tap, swipe, ring...)",
  );
}

async function showLog(event: EvenHubEvent) {
  const detail = trim(
    safeStringify({
      at: localTime(),
      kind: getEventKind(event),
      eventType: getEventType(event),
      source: event.sysEvent?.eventSource,
      raw: event,
    }),
  );

  await updateContainer(TITLE_ID, "title", "Tap / Dbl-tap: next capture");
  await updateContainer(BODY_ID, "body", detail);
}

const unsubscribe = bridge.onEvenHubEvent((event: EvenHubEvent) => {
  const sysType = event.sysEvent?.eventType;
  const textType = event.textEvent?.eventType;

  if (
    sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
    sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT
  ) {
    unsubscribe();
    return;
  }

  if (state === "waiting") {
    state = "logging";
    renderChain = renderChain
      .then(() => showLog(event))
      .catch((err) => {
        console.error("[event-debugger] showLog error", err);
      });
    return;
  }

  // ログを出力している画面では、シングルタップかダブルタップでのみ、イベントの受け付け画面に戻りたい
  // シングルタップは本来は CLICK_EVENT = 0 だが undefined で解釈され、 sysEvent のみが設定されていることがある
  // スクロールイベントの場合は textEvent で送信され、 sysEvent 自体が undefined となる挙動となる
  // そのため sysEvent の存在確認と textEvent で検知した内容でスクロールの判断ができる
  const hasSysEvent = event.sysEvent !== undefined;
  const isClick =
    hasSysEvent &&
    (sysType === OsEventTypeList.CLICK_EVENT || sysType === undefined);
  const isDblClick =
    sysType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
    textType === OsEventTypeList.DOUBLE_CLICK_EVENT;

  if (isClick || isDblClick) {
    state = "waiting";
    renderChain = renderChain.then(showWaiting).catch((err) => {
      console.error("[event-debugger] showWaiting error", err);
    });
  }
});
