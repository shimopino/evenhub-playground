import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";

const VITE_PORT = 5173;

function isPrivateIpv4(address) {
  const octets = address.split(".").map(Number);

  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  if (octets[0] === 10) {
    return true;
  }

  if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
    return true;
  }

  return octets[0] === 192 && octets[1] === 168;
}

function resolveLanIpv4() {
  const interfaces = networkInterfaces();

  for (const entries of Object.values(interfaces)) {
    if (!entries) {
      continue;
    }

    for (const entry of entries) {
      if (entry.internal || entry.family !== "IPv4") {
        continue;
      }

      if (isPrivateIpv4(entry.address)) {
        return entry.address;
      }
    }
  }

  return null;
}

const lanIp = resolveLanIpv4();

if (!lanIp) {
  console.error(
    "No private LAN IPv4 found. Connect to the same LAN as Even Hub and retry.",
  );
  process.exit(1);
}

const child = spawn(
  "pnpm",
  [
    "exec",
    "evenhub",
    "qr",
    "--http",
    "--ip",
    lanIp,
    "--port",
    String(VITE_PORT),
    "--path",
    "/",
  ],
  {
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
