#!/usr/bin/env node
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { Pool } from "pg";
import { absolutePath, postgresTool, safeDatabaseArguments } from "./postgres-binaries.mjs";

const url = process.env.MESA_LOCAL_DATABASE_URL;
const input = process.argv[2] && absolutePath(process.argv[2]);
const allowOverwrite = process.argv.includes("--allow-overwrite");
if (!url || !input || (allowOverwrite && process.env.MESA_RESTORE_CONFIRM !== "I_UNDERSTAND")) {
  console.error("Usage: MESA_LOCAL_DATABASE_URL=... node scripts/restore-local.mjs backup.dump [--allow-overwrite]");
  console.error("A restauração exige um banco vazio; use --allow-overwrite somente com MESA_RESTORE_CONFIRM=I_UNDERSTAND.");
  process.exit(2);
}
try {
  const backup = await stat(input);
  if (!backup.isFile()) throw new Error("O backup informado não é um arquivo regular.");
  const restore = await postgresTool("pg_restore");
  const database = safeDatabaseArguments(url);
  const pool = new Pool({ connectionString: database.connectionString, max: 1, password: database.env.PGPASSWORD });
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
  args.push("--dbname", database.connectionString, input);
  const child = spawn(restore, args, { stdio: "inherit", env: database.env });
  child.on("error", (error) => {
    console.error(`Não foi possível iniciar pg_restore: ${error.name}`);
    process.exitCode = 1;
  });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Falha ao restaurar o backup local.");
  process.exit(1);
}
