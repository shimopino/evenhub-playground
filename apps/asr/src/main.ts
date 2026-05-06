import {
  CreateStartUpPageContainer,
  OsEventTypeList,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from "@evenrealities/even_hub_sdk";

import { startSttStream } from "./asr/stt";
import { mountUi, setStatus, setTranscript } from "./ui";

const MAX_TRANSCRIPT_CHARS = 240;

mountUi();

function resolveProxyUrl(): string {
  const configured = import.meta.env.VITE_STT_PROXY_URL as
    | string
    | undefined;

  if (configured) {
    return configured;
  }

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host || "localhost:5173"}/stt`;
  }

  return "ws://localhost:5173/stt";
}

const PROXY_URL = resolveProxyUrl();

const bridge = await waitForEvenAppBridge();

const eventLayer = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  borderColor: 0,
  paddingLength: 0,
  containerID: 3,
  containerName: "events",
  content: " ",
  isEventCapture: 1,
});

const transcript = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 240,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: "transcript",
  content: "",
  isEventCapture: 0,
});

const status = new TextContainerProperty({
  xPosition: 0,
  yPosition: 240,
  width: 576,
  height: 48,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 2,
  containerName: "status",
  content: "Tap to start",
  isEventCapture: 0,
});

const created = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 3,
    textObject: [eventLayer, transcript, status],
  }),
);

if (created !== 0) {
  setStatus("error", `createStartUpPageContainer failed: ${created}`);
  console.error("Failed to create startup page");
}

let lastTranscriptRender = "";
let lastStatusRender = "";
let transcriptRenderTimer: number | null = null;
let statusRenderTimer: number | null = null;
let transcriptContent = "";
let statusContent = "Tap to start";

let committedTranscript = "";
let liveFinalText = "";
let liveInterimText = "";

let bridgeRenderQueue: Promise<unknown> = Promise.resolve();
let unsubscribe = () => {};
let recording = false;
let starting = false;

let stt: ReturnType<typeof startSttStream> | null = null;

setStatus("idle", "Tap to start");
setTranscript("", "");

function queueTextUpgrade(containerID: number, containerName: string, content: string) {
  bridgeRenderQueue = bridgeRenderQueue
    .catch(() => {})
    .then(() =>
      bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID,
          containerName,
          content,
        }),
      ),
    )
    .catch((error) => {
      console.error(`Failed to render ${containerName}:`, error);
    });
}

function normalizeTranscriptText(text: string): string {
  return text.replaceAll("<end>", "");
}

function trimTranscript(text: string): string {
  const normalized = normalizeTranscriptText(text);
  if (normalized.length <= MAX_TRANSCRIPT_CHARS) {
    return normalized;
  }

  const lines = normalized.split("\n");
  while (lines.length > 1 && lines.join("\n").length > MAX_TRANSCRIPT_CHARS) {
    lines.shift();
  }

  const trimmed = lines.join("\n");
  return trimmed.length <= MAX_TRANSCRIPT_CHARS
    ? trimmed
    : trimmed.slice(trimmed.length - MAX_TRANSCRIPT_CHARS);
}

function buildTranscriptPreview(): string {
  const liveText = `${liveFinalText}${liveInterimText}`.trim();

  if (!committedTranscript) {
    return trimTranscript(liveText);
  }

  if (!liveText) {
    return committedTranscript;
  }

  return trimTranscript(`${committedTranscript}\n${liveText}`);
}

function renderTranscriptUi() {
  const needsSeparator =
    committedTranscript.length > 0 &&
    (liveFinalText.length > 0 || liveInterimText.length > 0);
  const finalText = `${committedTranscript}${needsSeparator ? "\n" : ""}${liveFinalText}`;
  setTranscript(
    normalizeTranscriptText(finalText),
    normalizeTranscriptText(liveInterimText),
  );
}

function scheduleTranscriptRender() {
  if (transcriptRenderTimer !== null) {
    return;
  }

  transcriptRenderTimer = window.setTimeout(() => {
    transcriptRenderTimer = null;

    if (transcriptContent === lastTranscriptRender) {
      return;
    }

    lastTranscriptRender = transcriptContent;
    queueTextUpgrade(1, "transcript", transcriptContent);
  }, 120);
}

function scheduleStatusRender() {
  if (statusRenderTimer !== null) {
    return;
  }

  statusRenderTimer = window.setTimeout(() => {
    statusRenderTimer = null;

    if (statusContent === lastStatusRender) {
      return;
    }

    lastStatusRender = statusContent;
    queueTextUpgrade(2, "status", statusContent);
  }, 80);
}

function setTranscriptContent(text: string) {
  transcriptContent = trimTranscript(text);
  scheduleTranscriptRender();
}

function setStatusContent(text: string) {
  statusContent = text;
  scheduleStatusRender();
}

function summarizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

function showRetryableError(message: string) {
  setStatusContent(`Error: ${message}\nTap to retry`);
  setStatus("error", message);
}

function commitCurrentRecognition() {
  const finalized = liveFinalText.trim();

  if (finalized) {
    const separator = committedTranscript ? "\n" : "";
    committedTranscript = trimTranscript(
      `${committedTranscript}${separator}${finalized}`,
    );
  }

  liveFinalText = "";
  liveInterimText = "";
  setTranscriptContent(committedTranscript);
  renderTranscriptUi();
}

function isSingleTapEvent(
  sysEvent: { eventType?: number } | undefined,
  textEvent: { eventType?: number } | undefined,
) {
  // CLICK_EVENT(0) can be omitted by protobuf serialization on sysEvent.
  const sysTap =
    sysEvent !== undefined &&
    (sysEvent.eventType === OsEventTypeList.CLICK_EVENT ||
      sysEvent.eventType === undefined);
  const textTap = textEvent?.eventType === OsEventTypeList.CLICK_EVENT;
  return sysTap || textTap;
}

function isDoubleTapEvent(
  sysEvent: { eventType?: number } | undefined,
  textEvent: { eventType?: number } | undefined,
) {
  return (
    sysEvent?.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
    textEvent?.eventType === OsEventTypeList.DOUBLE_CLICK_EVENT
  );
}

async function startRecording() {
  if (recording || starting) {
    return;
  }

  starting = true;
  liveFinalText = "";
  liveInterimText = "";
  setStatusContent("Connecting...");
  setStatus("recording", "Connecting · tap to cancel");
  renderTranscriptUi();

  let nextStt: ReturnType<typeof startSttStream> | null = null;

  try {
    nextStt = startSttStream(
      PROXY_URL,
      ({ finalText, interimText }) => {
        liveFinalText = normalizeTranscriptText(finalText);
        liveInterimText = normalizeTranscriptText(interimText);

        setTranscriptContent(buildTranscriptPreview());
        renderTranscriptUi();
      },
      (err) => {
        stopRecording();
        showRetryableError(`STT error: ${summarizeError(err)}`);
        console.error("STT error:", err);
      },
    );
    stt = nextStt;

    await bridge.audioControl(true);

    if (!starting) {
      nextStt?.close();
      if (stt === nextStt) {
        stt = null;
      }
      await bridge.audioControl(false).catch(() => {});
      setStatusContent("Stopped · tap to start");
      setStatus("idle", "Stopped · tap to start");
      return;
    }

    recording = true;
    setStatusContent("Recording... tap to stop");
    setStatus("recording", "Recording · tap to stop");

    if (!transcriptContent) {
      setTranscriptContent("Listening...");
    }
  } catch (err) {
    nextStt?.close();
    if (stt === nextStt) {
      stt = null;
    }
    await bridge.audioControl(false).catch(() => {});
    showRetryableError(summarizeError(err) || "STT startup failed");
    console.error("STT startup failed:", err);
  } finally {
    if (starting) {
      starting = false;
    }
  }
}

function stopRecording() {
  if (!recording && !starting) {
    return;
  }

  recording = false;
  starting = false;

  commitCurrentRecognition();

  void bridge.audioControl(false);
  stt?.close();
  stt = null;

  setStatusContent("Stopped · tap to start");
  setStatus("idle", "Stopped · tap to start");
}

let cleanedUp = false;
function cleanup() {
  if (cleanedUp) {
    return;
  }

  cleanedUp = true;
  recording = false;
  starting = false;

  if (transcriptRenderTimer !== null) {
    window.clearTimeout(transcriptRenderTimer);
    transcriptRenderTimer = null;
  }

  if (statusRenderTimer !== null) {
    window.clearTimeout(statusRenderTimer);
    statusRenderTimer = null;
  }

  void bridge.audioControl(false);
  stt?.close();
  stt = null;
  unsubscribe();
}

unsubscribe = bridge.onEvenHubEvent((event) => {
  const pcm = event.audioEvent?.audioPcm;
  if (pcm && recording) {
    stt?.sendPcm(pcm);
  }

  const sysType = event.sysEvent?.eventType;
  const textType = event.textEvent?.eventType;
  const isSingleTap = isSingleTapEvent(event.sysEvent, event.textEvent);
  const isDoubleTap = isDoubleTapEvent(event.sysEvent, event.textEvent);

  if (event.sysEvent || event.textEvent) {
    console.debug("[asr] input event", {
      sysType,
      textType,
      recording,
      starting,
    });
  }

  if (isSingleTap) {
    if (recording || starting) {
      stopRecording();
    } else {
      void startRecording();
    }
    return;
  }

  if (isDoubleTap) {
    void bridge.shutDownPageContainer(1);
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
