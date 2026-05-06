import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROXY_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(PROXY_DIR, "..");

loadEnvFile(path.join(APP_DIR, ".env"));
loadEnvFile(path.join(APP_DIR, ".env.local"));
loadEnvFile(path.join(PROXY_DIR, ".env"));
loadEnvFile(path.join(PROXY_DIR, ".env.local"));

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3001);
const PATH = "/stt";
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

function sendFrame(socket, opcode, payload) {
  const body = Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(String(payload), "utf8");

  const length = body.length;
  let header;

  if (length < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x80 | opcode;
    header[1] = length;
  } else if (length < 0x10000) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(length, 6);
  }

  socket.write(Buffer.concat([header, body]));
}

function sendText(socket, text) {
  sendFrame(socket, 0x1, Buffer.from(text, "utf8"));
}

function sendClose(socket, code = 1000, reason = "") {
  const reasonLength = Buffer.byteLength(reason);
  const payload = Buffer.allocUnsafe(2 + reasonLength);
  payload.writeUInt16BE(code, 0);
  if (reasonLength > 0) {
    payload.write(reason, 2);
  }
  sendFrame(socket, 0x8, payload);
}

function unmask(payload, mask) {
  const output = Buffer.allocUnsafe(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    output[index] = payload[index] ^ mask[index % 4];
  }
  return output;
}

function parseFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      const high = buffer.readUInt32BE(offset + 2);
      const low = buffer.readUInt32BE(offset + 6);
      if (high !== 0) {
        throw new Error("WebSocket frame too large");
      }
      length = low;
      headerLength = 10;
    }

    const maskOffset = offset + headerLength;
    const payloadOffset = masked ? maskOffset + 4 : maskOffset;
    const frameLength = payloadOffset + length - offset;

    if (offset + frameLength > buffer.length) break;

    let payload = buffer.subarray(payloadOffset, payloadOffset + length);
    if (masked) {
      payload = unmask(payload, buffer.subarray(maskOffset, maskOffset + 4));
    }

    frames.push({ fin, opcode, payload });
    offset += frameLength;
  }

  return { frames, remainder: buffer.subarray(offset) };
}

function createBrowserSocket(socket) {
  let buffer = Buffer.alloc(0);
  let closed = false;

  const api = {
    onText: null,
    onBinary: null,
    onClose: null,
    onError: null,
    sendText(text) {
      if (!closed) {
        sendText(socket, text);
      }
    },
    close(code = 1000, reason = "") {
      if (closed) return;
      closed = true;
      try {
        sendClose(socket, code, reason);
      } catch {
        // ignore teardown failures
      }
      socket.end();
    },
  };

  socket.on("data", (chunk) => {
    if (closed) {
      return;
    }

    buffer = Buffer.concat([buffer, chunk]);

    try {
      const parsed = parseFrames(buffer);
      buffer = parsed.remainder;

      for (const frame of parsed.frames) {
        if (!frame.fin) {
          throw new Error("Fragmented WebSocket frames are not supported");
        }

        if (frame.opcode === 0x1) {
          api.onText?.(frame.payload.toString("utf8"));
          continue;
        }

        if (frame.opcode === 0x2) {
          api.onBinary?.(frame.payload);
          continue;
        }

        if (frame.opcode === 0x8) {
          closed = true;
          api.onClose?.();
          sendClose(socket);
          socket.end();
          return;
        }

        if (frame.opcode === 0x9) {
          sendFrame(socket, 0x0a, frame.payload);
        }
      }
    } catch (error) {
      api.onError?.(error);
      api.close(1002, "Protocol error");
    }
  });

  socket.on("close", () => {
    closed = true;
    api.onClose?.();
  });

  socket.on("error", (error) => {
    if (!closed) {
      api.onError?.(error);
    }
  });

  return api;
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

function createSonioxSession(browser) {
  const apiKey = process.env.SONIOX_API_KEY;
  let upstream = null;
  let upstreamReady = false;
  let closed = false;
  let started = false;
  let finalText = "";
  let interimText = "";
  const pendingAudio = [];

  function sendSnapshot(finished = false) {
    browser.sendText(makeSnapshotPayload(finalText, interimText, finished));
  }

  function fail(message) {
    browser.sendText(makeErrorPayload(message));
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
        browser.sendText(makeErrorPayload("Soniox WebSocket closed unexpectedly."));
      }
      closed = true;
      browser.close(1000, "Soniox closed");
    };
  }

  function ensureStarted() {
    if (started) {
      return;
    }

    started = true;
    startUpstream();
  }

  function start() {
    ensureStarted();
  }

  function sendAudio(chunk) {
    if (closed) {
      return;
    }

    ensureStarted();

    if (!upstreamReady || !upstream) {
      pendingAudio.push(Buffer.from(chunk));
      return;
    }

    upstream.send(chunk);
  }

  function stop() {
    if (closed) {
      return;
    }

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

    browser.close(1000, "Soniox stopped");
  }

  return { start, sendAudio, stop };
}

function handshake(socket, key) {
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );
}

const server = http.createServer();

server.on("upgrade", (request, socket) => {
  const url = new URL(request.url || "", "http://localhost");
  if (url.pathname !== PATH) {
    socket.destroy();
    return;
  }

  const upgrade = String(request.headers.upgrade || "").toLowerCase();
  const connection = String(request.headers.connection || "").toLowerCase();
  const key = request.headers["sec-websocket-key"];
  if (upgrade !== "websocket" || !connection.includes("upgrade") || !key) {
    socket.destroy();
    return;
  }

  handshake(socket, key);

  const browser = createBrowserSocket(socket);
  const session = createSonioxSession(browser);

  browser.onText = (text) => {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      browser.sendText(makeErrorPayload("Invalid JSON message."));
      return;
    }

    if (message.type === "start") {
      session.start();
      return;
    }

    if (message.type === "stop") {
      session.stop();
    }
  };

  browser.onBinary = (chunk) => {
    session.sendAudio(chunk);
  };

  browser.onClose = () => {
    session.stop();
  };

  browser.onError = () => {
    session.stop();
  };
});

server.listen(PORT, HOST, () => {
  const hasApiKey = Boolean(process.env.SONIOX_API_KEY);
  console.log(`ASR proxy listening on ws://${HOST}:${PORT}${PATH}`);
  console.log(`SONIOX_API_KEY: ${hasApiKey ? "loaded" : "missing"}`);
});
