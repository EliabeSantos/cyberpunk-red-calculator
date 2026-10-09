#!/usr/bin/env node
import { spawn } from "node:child_process";
const url = process.env.MESA_LOCAL_DATABASE_URL;
const output = process.argv[2];
if (!url || !output) {
  console.error("Usage: MESA_LOCAL_DATABASE_URL=... node scripts/backup-local.mjs backup.dump");
  process.exit(2);
}
const child = spawn("pg_dump", ["--format=custom", "--file", output, url], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
