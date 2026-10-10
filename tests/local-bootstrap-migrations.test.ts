import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("bootstrap local aplica migrations antes de iniciar o servidor", async () => {
  const script = await readFile(new URL("../scripts/windows/bootstrap-host.ps1", import.meta.url), "utf8");

  const migrationStart = script.indexOf('if ($env:MESA_HOSTING_MODE -eq "local") {\n  $migrationScript');
  const postgresStart = script.indexOf('if ($env:MESA_HOSTING_MODE -eq "local") { Start-Postgres }');
  const serverStart = script.indexOf("\nStart-App", migrationStart);

  assert.notEqual(migrationStart, -1, "bootstrap não chama o migrador local");
  assert.notEqual(postgresStart, -1, "bootstrap não inicia o PostgreSQL local");
  assert.notEqual(serverStart, -1, "bootstrap não inicia o servidor");
  assert.ok(postgresStart < migrationStart, "migrations executadas antes do PostgreSQL");
  assert.ok(migrationStart < serverStart, "servidor iniciado antes das migrations");
  assert.match(script.slice(migrationStart, serverStart), /migrate-local\.mjs/);
  assert.match(script.slice(migrationStart, serverStart), /migration\.log/);
  assert.match(script.slice(migrationStart, serverStart), /\$LASTEXITCODE -ne 0/);
});
