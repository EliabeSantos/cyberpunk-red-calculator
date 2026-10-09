#!/usr/bin/env node
import { spawn } from "node:child_process";
import { platform } from "node:os";

if (process.env.MESA_HOSTING_MODE !== "local") {
  console.error("start:local requires MESA_HOSTING_MODE=local; no hosting-mode fallback is allowed.");
  process.exit(2);
}

const migrate = spawn(process.execPath, ["scripts/migrate-local.mjs"], { stdio: "inherit", env: process.env });
migrate.on("exit", (code, signal) => {
  if (code !== 0 || signal) process.exit(code ?? 1);
  const command = platform() === "win32" ? "next.cmd" : "next";
  const server = spawn(command, ["start", "--hostname", process.env.MESA_HOSTNAME ?? "0.0.0.0", "--port", process.env.PORT ?? "3000"], { stdio: "inherit", env: process.env });
  const stop = () => server.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  server.on("exit", (serverCode) => process.exit(serverCode ?? 1));
});
