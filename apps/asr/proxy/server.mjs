import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const PROXY_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(PROXY_DIR, "..");

loadEnvFile(path.join(APP_DIR, ".env"));
loadEnvFile(path.join(APP_DIR, ".env.local"));
loadEnvFile(path.join(PROXY_DIR, ".env"));
loadEnvFile(path.join(PROXY_DIR, ".env.local"));

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3001);
const PROXY_PATH = "/stt";
const SONIOX_WS_URL = "wss://stt-rt.soniox.com/transcribe-websocket";
const SONIOX_MODEL = process.env.SONIOX_MODEL || "stt-rt-v4";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const source = fs.readFileSync(filePath, "utf8");
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function makeSnapshotPayload(finalText, interimText, finished) {
  return JSON.stringify({
    type: "snapshot",
    engine: "soniox",
    finalText,
    interimText,
    finished,
  });
}

function makeErrorPayload(message) {
  return JSON.stringify({
    type: "error",
    message,
  });
}

function createSonioxSession(browserWs) {
  const apiKey = process.env.SONIOX_API_KEY;
  let upstream = null;
  let upstreamReady = false;
  let closed = false;
  let started = false;
  let finalText = "";
  let interimText = "";
  const pendingAudio = [];

  function sendSnapshot(finished = false) {
    if (closed) return;
    try {
      browserWs.send(makeSnapshotPayload(finalText, interimText, finished));
    } catch {
      // ignore teardown failures
    }
  }

  function fail(message) {
    if (closed) return;
    try {
      browserWs.send(makeErrorPayload(message));
    } catch {
      // ignore teardown failures
    }
    stop();
  }

  function startUpstream() {
    if (!apiKey) {
      fail("Missing SONIOX_API_KEY.");
      return;
    }

    upstream = new WebSocket(SONIOX_WS_URL);
    upstream.binaryType = "arraybuffer";

    upstream.onopen = () => {
      if (closed) {
        upstream.close();
        return;
      }

      upstreamReady = true;
      upstream.send(
        JSON.stringify({
          api_key: apiKey,
          model: SONIOX_MODEL,
          audio_format: "pcm_s16le",
          sample_rate: 16000,
          num_channels: 1,
          language_hints: ["ja"],
          enable_endpoint_detection: true,
        }),
      );

      for (const chunk of pendingAudio) {
        upstream.send(chunk);
      }
      pendingAudio.length = 0;
    };

    upstream.onmessage = (event) => {
      if (typeof event.data !== "string") {
        return;
      }

      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.error_message || message.error_code) {
        fail(message.error_message || `Soniox error ${message.error_code}`);
        return;
      }

      if (Array.isArray(message.tokens)) {
        interimText = "";

        for (const token of message.tokens) {
          const text = typeof token?.text === "string" ? token.text : "";
          if (!text || text === "<end>") {
            continue;
          }

          if (token.is_final) {
            finalText += text;
          } else {
            interimText += text;
          }
        }

        sendSnapshot(Boolean(message.finished));

        if (message.finished) {
          stop();
        }
      }
    };

    upstream.onerror = () => {
      if (!closed) {
        fail("Soniox connection error.");
      }
    };

    upstream.onclose = () => {
      if (!closed) {
        fail("Soniox WebSocket closed unexpectedly.");
      }
    };
  }

  function start() {
    if (started) return;
    started = true;
    startUpstream();
  }

  function sendAudio(chunk) {
    if (closed) return;
    start();
    if (!upstreamReady || !upstream) {
      pendingAudio.push(Buffer.from(chunk));
      return;
    }
    upstream.send(chunk);
  }

  function stop() {
    if (closed) return;
    closed = true;
    pendingAudio.length = 0;

    try {
      if (upstreamReady && upstream && upstream.readyState === WebSocket.OPEN) {
        upstream.send(Buffer.alloc(0));
      }
      upstream?.close();
    } catch {
      // ignore teardown failures
    }

    try {
      browserWs.close(1000, "Soniox stopped");
    } catch {
      // ignore teardown failures
    }
  }

  return { start, sendAudio, stop };
}

const wss = new WebSocketServer({ host: HOST, port: PORT, path: PROXY_PATH });

wss.on("listening", () => {
  const hasApiKey = Boolean(process.env.SONIOX_API_KEY);
  console.log(`ASR proxy listening on ws://${HOST}:${PORT}${PROXY_PATH}`);
  console.log(`SONIOX_API_KEY: ${hasApiKey ? "loaded" : "missing"}`);
});

wss.on("connection", (ws) => {
  const session = createSonioxSession(ws);

  ws.on("message", (data) => {
    if (Buffer.isBuffer(data)) {
      session.sendAudio(data);
      return;
    }

    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      try {
        ws.send(makeErrorPayload("Invalid JSON message."));
      } catch {
        // ignore teardown failures
      }
      return;
    }

    if (message.type === "start") {
      session.start();
    } else if (message.type === "stop") {
      session.stop();
    }
  });

  ws.on("close", () => {
    session.stop();
  });

  ws.on("error", () => {
    session.stop();
  });
});
