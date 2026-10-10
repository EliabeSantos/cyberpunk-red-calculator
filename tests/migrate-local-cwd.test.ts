import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.MESA_LOCAL_MIGRATION_TEST_DATABASE_URL;
const script = fileURLToPath(new URL("../scripts/migrate-local.mjs", import.meta.url));

test("migrador local resolve migrations fora do diretório corrente", { skip: !databaseUrl }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), "mesa-migration-cwd-"));
  try {
    const { stdout } = await execFileAsync(process.execPath, [script], {
      cwd,
      env: { ...process.env, MESA_LOCAL_DATABASE_URL: databaseUrl },
    });
    assert.match(stdout, /Applying 20260923120000_mesa_discord_configs\.sql|^$/m);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
