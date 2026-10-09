#!/usr/bin/env node
/** Apply the checked-in PostgreSQL schema exactly once per filename. */
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const connectionString = process.env.MESA_LOCAL_DATABASE_URL;
if (!connectionString) {
  console.error("MESA_LOCAL_DATABASE_URL is required; refusing to guess a database.");
  process.exit(2);
}

const migrationsDir = join(process.cwd(), "supabase", "migrations");
const files = (await readdir(migrationsDir))
  .filter((file) => file.endsWith(".sql"))
  .sort();
// The Cover Damage migration was corrected before this checksum ledger was
// introduced in some installations. Accept only the exact pre-correction
// digest; the follow-up migration below still repairs the function.
const legacyChecksums = new Map([
  ["20261016000000_mesa_cover_damage_resolution.sql", "14c1ee9ebe83917da846767cd0800bd044414e9696ae570adb843da9306aa73a"],
]);
const pool = new Pool({ connectionString, max: 4 });
let client;
try {
  client = await pool.connect();
} catch (error) {
  console.error(`Não foi possível conectar ao PostgreSQL local: ${error instanceof Error ? error.message : String(error)}`);
  await pool.end().catch(() => undefined);
  process.exit(1);
}
try {
  await client.query("select pg_advisory_lock(hashtext('cyberpunk-red-calculator-schema'))");
  await client.query("create extension if not exists pgcrypto");
  await client.query(`create table if not exists public.mesa_schema_migrations (
    version text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`);
  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), "utf8");
    const checksum = (await import("node:crypto")).createHash("sha256").update(sql).digest("hex");
    const existing = await client.query("select checksum from public.mesa_schema_migrations where version = $1", [file]);
    if (existing.rowCount) {
      if (existing.rows[0].checksum !== checksum && existing.rows[0].checksum !== legacyChecksums.get(file)) {
        throw new Error(`Migration changed after application: ${file}`);
      }
      continue;
    }
    console.log(`Applying ${file}`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.mesa_schema_migrations(version, checksum) values ($1, $2)", [file, checksum]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw new Error(`Migration failed (${file}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  await client.query("select pg_advisory_unlock(hashtext('cyberpunk-red-calculator-schema'))").catch(() => undefined);
  client.release();
  await pool.end();
}
