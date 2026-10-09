#!/usr/bin/env node

/**
 * F1.64.9 — executa o benchmark controlado em processos separados.
 *
 * Cada processo usa IDs aleatórios e os testes Postgres removem seus dados ao
 * terminar. A primeira rodada é aquecimento e não entra nas métricas.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const runs = Number(arg("--runs", "6"));
const warmup = Number(arg("--warmup", "1"));
const retries = Number(arg("--retries", "2"));
const outputDir = path.resolve(arg("--output", "/tmp/opencode/mesa-f1649"));
const loader = path.resolve("tests/ts-loader.mjs");
const groups = {
  attack: ["tests/mesa-attack-http-postgres.test.ts", "tests/mesa-attack-resolution-postgres.test.ts"],
  movement: ["tests/mesa-player-move-gateway.test.ts"],
  initiative: ["tests/mesa-player-initiative-gateway.test.ts"],
};

if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(warmup) || warmup < 0 || !Number.isInteger(retries) || retries < 0) {
  throw new Error("--runs deve ser inteiro positivo, --warmup não negativo e --retries não negativo");
}

fs.mkdirSync(outputDir, { recursive: true });
const run = (phase, index, group, files) => {
  const args = ["--experimental-strip-types", "--experimental-loader", loader, "--test", ...files];
  const failures = [];
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    const logPath = path.join(outputDir, `${phase}-${String(index).padStart(2, "0")}-${group}-attempt-${attempt}.jsonl`);
    try {
      execFileSync(process.execPath, args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", fs.openSync(logPath, "w"), fs.openSync(logPath, "a")],
        timeout: 0,
      });
      return { logPath, failures };
    } catch (error) {
      failures.push({ attempt, logPath, message: error instanceof Error ? error.message : String(error) });
    }
  }
  throw new Error(`${phase} ${index} ${group} falhou após ${retries + 1} tentativas`, { cause: failures });
};

const warmupFiles = [];
const failures = [];
for (let index = 1; index <= warmup; index += 1) {
  for (const [group, files] of Object.entries(groups)) {
    const result = run("warmup", index, group, files);
    warmupFiles.push(result.logPath);
    failures.push(...result.failures.map((failure) => ({ phase: "warmup", index, group, ...failure })));
  }
}

const measuredFiles = [];
for (let index = 1; index <= runs; index += 1) {
  for (const [group, files] of Object.entries(groups)) {
    const result = run("measured", index, group, files);
    measuredFiles.push(result.logPath);
    failures.push(...result.failures.map((failure) => ({ phase: "measured", index, group, ...failure })));
  }
}

const inputPath = path.join(outputDir, "measured.jsonl");
const summaryPath = path.join(outputDir, "summary.json");
fs.writeFileSync(inputPath, measuredFiles.map((file) => fs.readFileSync(file, "utf8")).join(""));
execFileSync(process.execPath, ["scripts/mesa-latency-benchmark.mjs", "--input", inputPath], {
  cwd: process.cwd(),
  stdio: ["ignore", fs.openSync(summaryPath, "w"), "inherit"],
});
fs.writeFileSync(path.join(outputDir, "conditions.json"), JSON.stringify({
  environment: "controlled test Postgres/Supabase; disposable random-ID fixtures",
  warmupRuns: warmup,
  measuredRuns: runs,
  retries,
  execution: "sequential processes; no production traffic",
  groups,
  warmupFiles,
  measuredFiles,
  inputPath,
  summaryPath,
  failures,
}, null, 2) + "\n");
console.log(JSON.stringify({ outputDir, inputPath, summaryPath, warmupRuns: warmup, measuredRuns: runs, retries, failures }, null, 2));
