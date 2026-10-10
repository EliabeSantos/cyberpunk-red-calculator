#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const mode = process.env.MESA_HOSTING_MODE?.trim().toLowerCase();
if (mode !== "local" && mode !== "supabase") {
  console.error("start-host requires MESA_HOSTING_MODE=local or supabase; no hosting-mode fallback is allowed.");
  process.exit(2);
}

// Do not depend on the package-manager-generated node_modules/.bin shim. The
// Windows installer keeps the Next package but electron-builder may omit the
// .bin directory from the packaged application. Invoke the real CLI through
// the bundled/current Node executable instead.
const nextCli = join(appRoot, "node_modules", "next", "dist", "bin", "next");
if (!existsSync(nextCli)) {
  console.error(`Next.js CLI is missing from the installed application: ${nextCli}`);
  process.exit(1);
}
const command = process.execPath;
const args = [nextCli, "start", "--hostname", process.env.MESA_HOSTNAME ?? "0.0.0.0", "--port", process.env.PORT ?? "3000"];

function startServer() {
  const server = spawn(command, args, {
    cwd: appRoot,
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  const stop = () => server.kill("SIGTERM");
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  server.on("exit", (serverCode) => process.exit(serverCode ?? 1));
}

if (mode === "local") {
  const migrate = spawn(process.execPath, [join(appRoot, "scripts", "migrate-local.mjs")], { cwd: appRoot, stdio: "inherit", env: process.env });
  migrate.on("exit", (code, signal) => {
    if (code !== 0 || signal) process.exit(code ?? 1);
    startServer();
  });
} else {
  startServer();
}
