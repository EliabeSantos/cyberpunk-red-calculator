#!/usr/bin/env node
import { spawn } from "node:child_process";
import { Pool } from "pg";
const url = process.env.MESA_LOCAL_DATABASE_URL;
const input = process.argv[2];
const allowOverwrite = process.argv.includes("--allow-overwrite");
if (!url || !input || (allowOverwrite && process.env.MESA_RESTORE_CONFIRM !== "I_UNDERSTAND")) {
  console.error("Usage: MESA_LOCAL_DATABASE_URL=... node scripts/restore-local.mjs backup.dump [--allow-overwrite]");
  console.error("A restauração exige um banco vazio; use --allow-overwrite somente com MESA_RESTORE_CONFIRM=I_UNDERSTAND.");
  process.exit(2);
}
const pool = new Pool({ connectionString: url, max: 1 });
try {
  const result = await pool.query(`
    select count(*)::integer as count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname not in ('pg_catalog', 'information_schema')
      and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
      and c.relnamespace <> 'pg_toast'::regnamespace
  `);
  if (Number(result.rows[0]?.count ?? 0) > 0 && !allowOverwrite) {
    throw new Error("O banco de destino não está vazio; restauração recusada para evitar sobrescrever dados.");
  }
} finally {
  await pool.end();
}
const args = ["--exit-on-error", "--no-owner"];
if (allowOverwrite) args.push("--clean", "--if-exists");
args.push("--dbname", url, input);
const child = spawn("pg_restore", args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
