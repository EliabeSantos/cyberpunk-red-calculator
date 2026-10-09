import assert from "node:assert/strict";
import test from "node:test";

import {
  closeLocalPostgresLifecycles,
  createLocalPostgresLifecycle,
  getLocalPostgresLifecycle,
  LocalPostgresAvailabilityError,
  LocalPostgresConnectionError,
  LocalPostgresShutdownTimeoutError,
  type ManagedLocalPostgresPool,
} from "../src/lib/mesa/hostingInfrastructure.ts";

function fakePool(options: {
  query?: (...args: unknown[]) => Promise<unknown>;
  end?: () => Promise<void>;
} = {}): ManagedLocalPostgresPool {
  return {
    query: options.query ?? (async () => ({ rows: [{ ok: 1 }] })),
    end: options.end ?? (async () => undefined),
    on: () => undefined,
  } as never;
}

test("lifecycle faz health check, reutiliza o pool por URL e fecha uma vez", async () => {
  let queries = 0;
  let ends = 0;
  const pool = fakePool({
    query: async () => { queries += 1; return { rows: [{ ok: 1 }] }; },
    end: async () => { ends += 1; },
  });
  const first = await getLocalPostgresLifecycle("postgres:///lifecycle-test", { createPool: () => pool });
  const second = await getLocalPostgresLifecycle("postgres:///lifecycle-test", { createPool: () => { throw new Error("pool duplicado"); } });

  assert.equal(first, second);
  assert.equal(first.state, "ready");
  assert.equal(queries, 1);
  await closeLocalPostgresLifecycles();
  assert.equal(ends, 1);
  await closeLocalPostgresLifecycles();
  assert.equal(ends, 1);
});

test("falha de disponibilidade não expõe a URL e permite recuperação", async () => {
  let available = false;
  const lifecycle = createLocalPostgresLifecycle(fakePool({
    query: async () => {
      if (!available) throw new Error("connection refused postgres://user:secret@host/db");
      return { rows: [{ ok: 1 }] };
    },
  }));

  await assert.rejects(lifecycle.checkAvailability(), (error: unknown) => {
    assert.ok(error instanceof LocalPostgresAvailabilityError);
    assert.equal(error.message.includes("secret"), false);
    return true;
  });
  assert.equal(lifecycle.state, "degraded");
  available = true;
  await lifecycle.checkAvailability();
  assert.equal(lifecycle.state, "ready");
});

test("encerramento bloqueia novas operações e aguarda a operação ativa", async () => {
  let releaseQuery: (() => void) | undefined;
  const query = new Promise<void>((resolve) => { releaseQuery = resolve; });
  let ended = false;
  const lifecycle = createLocalPostgresLifecycle(fakePool({
    query: async () => { await query; return { rows: [] }; },
    end: async () => { ended = true; },
  }));
  const active = lifecycle.pool.query("select 1");
  await new Promise<void>((resolve) => setImmediate(resolve));
  const closing = lifecycle.close(100);
  await assert.rejects(lifecycle.pool.query("select 2"), LocalPostgresConnectionError);
  assert.equal(lifecycle.state, "closing");
  releaseQuery?.();
  await active;
  await closing;
  assert.equal(ended, true);
  assert.equal(lifecycle.state, "closed");
});

test("timeout de shutdown não descarta operação ativa", async () => {
  const query = new Promise<void>(() => undefined);
  const lifecycle = createLocalPostgresLifecycle(fakePool({ query: async () => { await query; return { rows: [] }; } }));
  const active = lifecycle.pool.query("select 1");
  await new Promise<void>((resolve) => setImmediate(resolve));
  await assert.rejects(lifecycle.close(1), LocalPostgresShutdownTimeoutError);
  assert.equal(lifecycle.state, "closing");
  assert.equal(lifecycle.activeOperations, 1);
  void active;
});
