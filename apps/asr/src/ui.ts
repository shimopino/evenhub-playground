type Status = "idle" | "recording" | "error";

let statusEl: HTMLDivElement | null = null;
let finalEl: HTMLSpanElement | null = null;
let interimEl: HTMLSpanElement | null = null;

export function mountUi() {
  const app = document.querySelector("#app");
  if (!app) {
    return;
  }

  app.innerHTML = `
    <div class="panel">
      <header>
        <h1>ASR Demo</h1>
        <div id="status" class="status status-idle">Tap to start</div>
      </header>
      <main class="transcript" aria-live="polite" aria-atomic="true">
        <span id="final"></span><span id="interim" class="interim"></span>
      </main>
      <footer>Double-tap the glasses temple to exit.</footer>
    </div>
  `;

  statusEl = app.querySelector("#status");
  finalEl = app.querySelector("#final");
  interimEl = app.querySelector("#interim");
  injectStyles();
}

export function setStatus(kind: Status, text: string) {
  if (!statusEl) {
    return;
  }

  statusEl.className = `status status-${kind}`;
  statusEl.textContent = text;
}

export function setTranscript(finalText: string, interimText: string) {
  if (!finalEl || !interimEl) {
    return;
  }

  finalEl.textContent = finalText;
  interimEl.textContent = interimText;
}

function injectStyles() {
  const css = `
    :root {
      color-scheme: dark;
    }

    html,
    body {
      margin: 0;
      height: 100%;
      background: #232323;
      color: #e5e5e5;
      font:
        16px/1.4 -apple-system,
        BlinkMacSystemFont,
        "Helvetica Neue",
        system-ui,
        sans-serif;
      touch-action: manipulation;
      -webkit-text-size-adjust: 100%;
      overscroll-behavior: none;
    }

    #app {
      display: flex;
      height: 100%;
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: 16px;
      width: 100%;
      max-width: 640px;
      margin: 0 auto;
      padding: 24px;
      box-sizing: border-box;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    h1 {
      font-size: 18px;
      font-weight: 600;
      margin: 0;
      letter-spacing: 0.02em;
    }

    .status {
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid transparent;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .status-idle {
      color: #a7a7a7;
      border-color: #3e3e3e;
    }

    .status-recording {
      color: #3cfa44;
      border-color: #3cfa44;
      background: rgba(60, 250, 68, 0.08);
    }

    .status-error {
      color: #ff453a;
      border-color: #ff453a;
      background: rgba(255, 69, 58, 0.08);
    }

    .transcript {
      flex: 1;
      overflow: auto;
      background: #2e2e2e;
      border: 1px solid #3e3e3e;
      color: #e5e5e5;
      border-radius: 12px;
      padding: 20px;
      font-size: 18px;
      line-height: 1.5;
      min-height: 180px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .interim {
      color: #919191;
    }

    footer {
      font-size: 12px;
      color: #7b7b7b;
      text-align: center;
    }
  `;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}
