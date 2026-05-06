import { spawnSync } from "node:child_process";

const DEFAULT_BASE_URL = "http://127.0.0.1:9898";
const DEFAULT_ACTIONS = ["down", "down", "click", "up"];
const VALID_ACTIONS = new Set(["up", "down", "click", "double_click"]);

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.SIMULATOR_BASE_URL || DEFAULT_BASE_URL,
    clear: false,
    actions: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--base-url") {
      options.baseUrl = argv[++i];
      continue;
    }

    if (arg === "--port") {
      options.baseUrl = `http://127.0.0.1:${argv[++i]}`;
      continue;
    }

    if (arg === "--clear") {
      options.clear = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    options.actions.push(arg);
  }

  if (options.actions.length === 0) {
    options.actions = DEFAULT_ACTIONS;
  }

  for (const action of options.actions) {
    if (!VALID_ACTIONS.has(action)) {
      throw new Error(
        `Invalid action "${action}". Use: ${Array.from(VALID_ACTIONS).join(", ")}`,
      );
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage:
  pnpm list:minimal:sim-logs [--port 9898] [--clear] [actions...]

Actions:
  up down click double_click

Defaults:
  base URL: ${DEFAULT_BASE_URL}
  actions:  ${DEFAULT_ACTIONS.join(" ")}

Examples:
  pnpm list:minimal:sim-logs
  pnpm list:minimal:sim-logs --clear down down click
  pnpm list:minimal:sim-logs --port 9899 up click
`);
}

function curl(args, { parseJson = false } = {}) {
  const result = spawnSync("curl", ["-sS", ...args], {
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const detail = result.stderr || `curl exited with ${result.status}`;
    throw new Error(
      `${detail.trim()}\nStart the simulator with: pnpm --filter @evenhub-playground/list-minimal simulator`,
    );
  }

  const stdout = result.stdout.trim();
  if (!parseJson) {
    return stdout;
  }

  try {
    return stdout ? JSON.parse(stdout) : {};
  } catch (error) {
    throw new Error(`Failed to parse JSON response: ${stdout}\n${error.message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatEntry(entry) {
  const timestamp = new Date(entry.ts).toISOString();
  return `[${entry.id}] ${timestamp} ${entry.level}: ${entry.message}`;
}

function printEntries(entries) {
  if (entries.length === 0) {
    console.log("(no new console entries)");
    return;
  }

  for (const entry of entries) {
    console.log(formatEntry(entry));
  }
}

function getConsole(baseUrl, sinceId) {
  const url =
    sinceId === null
      ? `${baseUrl}/api/console`
      : `${baseUrl}/api/console?since_id=${sinceId}`;
  return curl([url], { parseJson: true });
}

function lastEntryId(entries, fallback) {
  return entries.reduce((max, entry) => Math.max(max, entry.id), fallback);
}

function sendInput(baseUrl, action) {
  return curl(
    [
      "-X",
      "POST",
      `${baseUrl}/api/input`,
      "-H",
      "Content-Type: application/json",
      "-d",
      JSON.stringify({ action }),
    ],
    { parseJson: true },
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log(`[sim] base URL: ${options.baseUrl}`);
  const ping = curl([`${options.baseUrl}/api/ping`]);
  if (ping !== "pong") {
    throw new Error(`Unexpected ping response: ${ping}`);
  }

  if (options.clear) {
    curl(["-X", "DELETE", `${options.baseUrl}/api/console`]);
    console.log("[sim] cleared console buffer");
  }

  const initial = getConsole(options.baseUrl, null);
  let sinceId =
    initial.entries && initial.entries.length > 0
      ? lastEntryId(initial.entries, 0)
      : null;
  console.log("[sim] current console entries:");
  printEntries(initial.entries ?? []);

  for (const action of options.actions) {
    console.log(`\n[sim] input: ${action}`);
    sendInput(options.baseUrl, action);
    await sleep(350);

    const next = getConsole(options.baseUrl, sinceId);
    const entries = next.entries ?? [];
    printEntries(entries);
    sinceId = lastEntryId(entries, sinceId ?? 0);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
