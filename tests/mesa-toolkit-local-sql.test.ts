import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";

test("salvamento versionado do toolkit qualifica version no upsert local", async () => {
  let sql = "";
  let params: unknown[] = [];
  const repository = new (await import("../src/lib/mesa/localPostgresInfrastructure.ts")).LocalPostgresMesaRepository({
    query: async (statement: string, values: unknown[]) => {
      sql = statement;
      params = values;
      return { rows: [{ id: "record", version: 2 }] };
    },
  } as unknown as Pick<Pool, "query">);

  await repository.upsertToolkitRecord({
    id: "record",
    ownerToken: "owner",
    kind: "character",
    name: "Ficha",
    payload: { hp: 10 },
    expectedVersion: 1,
  });

  assert.match(sql, /public\.mesa_toolkit_records\.version\s*=\s*\$6/);
  assert.doesNotMatch(sql, /and version\s*=\s*\$6/);
  assert.equal(params[5], 1);
});
