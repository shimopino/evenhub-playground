export interface SttSnapshot {
  finalText: string;
  interimText: string;
  finished: boolean;
}

export interface SttClient {
  sendPcm(chunk: Uint8Array): void;
  close(): void;
}

type ProxyMessage =
  | {
      type: "snapshot";
      engine: "soniox";
      finalText: string;
      interimText: string;
      finished: boolean;
    }
  | {
      type: "error";
      message: string;
    };

function toArrayBuffer(chunk: Uint8Array): ArrayBuffer {
  return chunk.buffer.slice(
    chunk.byteOffset,
    chunk.byteOffset + chunk.byteLength,
  ) as ArrayBuffer;
}

function parseMessage(text: string): ProxyMessage | null {
  try {
    return JSON.parse(text) as ProxyMessage;
  } catch {
    return null;
  }
}

export function startSttStream(
  endpointUrl: string,
  onSnapshot: (snap: SttSnapshot) => void,
  onError?: (err: unknown) => void,
): SttClient {
  const ws = new WebSocket(endpointUrl);
  ws.binaryType = "arraybuffer";

  let closed = false;
  let ready = false;
  let started = false;
  const pendingChunks: Uint8Array[] = [];

  const sendStart = () => {
    if (started || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    started = true;
    ws.send(
      JSON.stringify({
        type: "start",
        audio: {
          encoding: "pcm_s16le",
          sampleRateHz: 16000,
          channels: 1,
        },
        language: "ja-JP",
      }),
    );
  };

  ws.onopen = () => {
    if (closed) {
      ws.close();
      return;
    }

    ready = true;
    sendStart();

    for (const chunk of pendingChunks) {
      ws.send(toArrayBuffer(chunk));
    }
    pendingChunks.length = 0;
  };

  ws.onmessage = (event) => {
    if (typeof event.data !== "string") {
      return;
    }

    const message = parseMessage(event.data);
    if (!message) {
      return;
    }

    if (message.type === "error") {
      onError?.(new Error(message.message));
      return;
    }

    onSnapshot({
      finalText: message.finalText,
      interimText: message.interimText,
      finished: message.finished,
    });
  };

  ws.onerror = (event) => {
    onError?.(event);
  };

  ws.onclose = () => {
    if (!closed) {
      onError?.(new Error("STT proxy WebSocket closed unexpectedly."));
    }
  };

  return {
    sendPcm(chunk) {
      if (closed) {
        return;
      }

      const payload = chunk.slice();
      if (!ready || ws.readyState !== WebSocket.OPEN || !started) {
        pendingChunks.push(payload);
        return;
      }

      ws.send(toArrayBuffer(payload));
    },

    close() {
      if (closed) {
        return;
      }

      closed = true;
      pendingChunks.length = 0;

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "stop" }));
        ws.close();
        return;
      }

      if (ws.readyState === WebSocket.CONNECTING) {
        try {
          ws.close();
        } catch {
          // Ignore teardown failures.
        }
      }
    },
  };
}
