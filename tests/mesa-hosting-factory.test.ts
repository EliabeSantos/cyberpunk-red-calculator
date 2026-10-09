import assert from "node:assert/strict";
import test from "node:test";

import type { MesaEventTransport } from "../src/lib/mesa/infrastructure.ts";
import {
  createMesaHostingInfrastructure,
  MesaHostingConfigurationError,
} from "../src/lib/mesa/hostingInfrastructure.ts";

const localPool = { query: async (..._args: unknown[]) => ({ rows: [] }) } as never;
const eventTransport: MesaEventTransport = {
  publishInvalidation: async () => undefined,
  subscribeInvalidation: () => null,
};

test("factory seleciona Supabase somente quando o modo é supabase", async () => {
  const fakeClient = {} as never;
  const infrastructure = await createMesaHostingInfrastructure("supabase", { supabaseClient: fakeClient });

  assert.equal(infrastructure.mode, "supabase");
  assert.equal(infrastructure.repository.constructor.name, "SupabaseMesaRepository");
  assert.equal(infrastructure.resolutionStore.constructor.name, "SupabaseResolutionStore");
  assert.equal(infrastructure.eventTransport.constructor.name, "SupabaseMesaEventTransport");
});

test("factory cria somente adapters locais quando o transporte local é fornecido", async () => {
  const infrastructure = await createMesaHostingInfrastructure("local", {
    localPool,
    localEventTransport: eventTransport,
  });

  assert.equal(infrastructure.mode, "local");
  assert.equal(infrastructure.repository.constructor.name, "LocalPostgresMesaRepository");
  assert.equal(infrastructure.resolutionStore.constructor.name, "LocalPostgresResolutionStore");
  assert.equal(infrastructure.eventTransport, eventTransport);
});

test("modo local não exige credenciais nem inicializa cliente Supabase", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const infrastructure = await createMesaHostingInfrastructure("local", {
      localPool,
      localEventTransport: eventTransport,
    });
    assert.equal(infrastructure.mode, "local");
    assert.equal(infrastructure.repository.constructor.name, "LocalPostgresMesaRepository");
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("modo local com transporte, mas sem URL do banco, falha sem abrir pool", async () => {
  const previousUrl = process.env.MESA_LOCAL_DATABASE_URL;
  delete process.env.MESA_LOCAL_DATABASE_URL;
  try {
    await assert.rejects(
      createMesaHostingInfrastructure("local", { localEventTransport: eventTransport }),
      (error: unknown) => error instanceof MesaHostingConfigurationError
        && error.code === "incomplete_mode"
        && error.missingComponents[0] === "MESA_LOCAL_DATABASE_URL",
    );
  } finally {
    if (previousUrl === undefined) delete process.env.MESA_LOCAL_DATABASE_URL;
    else process.env.MESA_LOCAL_DATABASE_URL = previousUrl;
  }
});

test("modo ausente ou inválido não escolhe um backend automaticamente", async () => {
  const previousMode = process.env.MESA_HOSTING_MODE;
  try {
    delete process.env.MESA_HOSTING_MODE;
    await assert.rejects(
      createMesaHostingInfrastructure(undefined, {}),
      (error: unknown) => error instanceof MesaHostingConfigurationError && error.code === "missing_mode",
    );
  } finally {
    if (previousMode === undefined) delete process.env.MESA_HOSTING_MODE;
    else process.env.MESA_HOSTING_MODE = previousMode;
  }
  await assert.rejects(
    createMesaHostingInfrastructure("sqlite" as never, {}),
    (error: unknown) => error instanceof MesaHostingConfigurationError && error.code === "invalid_mode",
  );
});
