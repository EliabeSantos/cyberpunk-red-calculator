#!/usr/bin/env node
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { join } from "node:path";

const mode = process.env.MESA_HOSTING_MODE?.trim().toLowerCase();
if (mode !== "local" && mode !== "supabase") {
  console.error("start-host requires MESA_HOSTING_MODE=local or supabase; no hosting-mode fallback is allowed.");
  process.exit(2);
}

// Do not depend on npm adding node_modules/.bin to PATH: the Windows
// installer launches this file directly with the bundled node.exe.
const command = join(process.cwd(), "node_modules", ".bin", platform() === "win32" ? "next.cmd" : "next");
const args = ["start", "--hostname", process.env.MESA_HOSTNAME ?? "0.0.0.0", "--port", process.env.PORT ?? "3000"];

function startServer() {
  const server = spawn(command, args, {
    stdio: "inherit",
    env: process.env,
    // Windows cannot spawn a .cmd shim without a shell.
    shell: platform() === "win32",
  });
  const stop = () => server.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  server.on("exit", (serverCode) => process.exit(serverCode ?? 1));
}

if (mode === "local") {
  const migrate = spawn(process.execPath, ["scripts/migrate-local.mjs"], { stdio: "inherit", env: process.env });
  migrate.on("exit", (code, signal) => {
    if (code !== 0 || signal) process.exit(code ?? 1);
    startServer();
  });
} else {
  startServer();
}
