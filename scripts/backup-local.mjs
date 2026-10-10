#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access, constants, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { absolutePath, postgresTool, safeDatabaseArguments } from "./postgres-binaries.mjs";

const url = process.env.MESA_LOCAL_DATABASE_URL;
const output = process.argv[2] && absolutePath(process.argv[2]);
if (!url || !output) {
  console.error("Usage: MESA_LOCAL_DATABASE_URL=... node scripts/backup-local.mjs backup.dump");
  process.exit(2);
}
try {
  const existing = await stat(output).catch(() => null);
  if (existing) throw new Error(`O arquivo de backup já existe: ${output}. Escolha outro nome.`);
  try {
    await access(dirname(output), constants.R_OK | constants.W_OK);
  } catch {
    throw new Error(`O diretório de destino do backup não existe ou não é gravável: ${dirname(output)}`);
  }
  const dump = await postgresTool("pg_dump");
  const database = safeDatabaseArguments(url);
  const child = spawn(dump, ["--format=custom", "--file", output, database.connectionString], {
    stdio: "inherit",
    env: database.env,
  });
  child.on("error", (error) => {
    console.error(`Não foi possível iniciar pg_dump: ${error.name}`);
    process.exitCode = 1;
  });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Falha ao criar o backup local.");
  process.exit(1);
}
