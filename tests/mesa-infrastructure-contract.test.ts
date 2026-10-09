import assert from "node:assert/strict";
import test from "node:test";

import { DatabaseQueryError } from "../src/lib/supabaseAdmin.ts";
import { SupabaseMesaRepository, SupabaseResolutionStore } from "../src/lib/mesa/supabaseInfrastructure.ts";

type Call = { name: string; args: Record<string, unknown> };

function fakeClient(options: { data?: unknown; error?: { message: string } | null } = {}) {
  const calls: Call[] = [];
  const queryCalls: Array<{
    table: string;
    filters: Array<[string, string, unknown]>;
    patch?: unknown;
    op?: { type: "insert" | "upsert" | "delete"; rows?: unknown; options?: unknown };
  }> = [];
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      return Promise.resolve({ data: options.data ?? null, error: options.error ?? null });
    },
    from(table: string) {
      const query = {
        filters: [] as Array<[string, string, unknown]>,
        patch: undefined as unknown,
        op: undefined as { type: "insert" | "upsert" | "delete"; rows?: unknown; options?: unknown } | undefined,
        select: () => query,
        order: (column: string, options?: unknown) => {
          query.filters.push(["order", column, options]);
          return query;
        },
        eq: (column: string, value: unknown) => {
          query.filters.push(["eq", column, value]);
          return query;
        },
        is: (column: string, value: unknown) => {
          query.filters.push(["is", column, value]);
          return query;
        },
        update: (patch: unknown) => {
          query.patch = patch;
          return query;
        },
        insert: (rows: unknown) => {
          query.op = { type: "insert", rows };
          return query;
        },
        upsert: (rows: unknown, opts?: unknown) => {
          query.op = { type: "upsert", rows, options: opts };
          return query;
        },
        delete: () => {
          query.op = { type: "delete" };
          return query;
        },
        maybeSingle: () => Promise.resolve({ data: options.data ?? null, error: options.error ?? null }),
        then: (resolve: (value: unknown) => unknown) => resolve({ data: options.data ?? null, error: options.error ?? null }),
      };
      queryCalls.push({ table, filters: query.filters, get patch() { return query.patch; }, get op() { return query.op; } });
      return query;
    },
  };
  return { client, calls, queryCalls };
}

const key = { sessionId: "session-1", combatId: "combat-1", resolutionId: "resolution-1" };

test("MesaRepository preserva escopo de sessão/combate nas leituras e CAS", async () => {
  const fake = fakeClient({ data: [{ id: "combatant-1", combat_id: "combat-1", session_id: "session-1", kind: "enemy", participant_id: null }] });
  const repository = new SupabaseMesaRepository(fake.client as never);

  await repository.findCombatantById("combatant-1", { sessionId: "session-1", combatId: "combat-1" });
  await repository.updateCombatant({
    id: "combatant-1",
    sessionId: "session-1",
    combatId: "combat-1",
    patch: { hp_current: 12 },
    expected: { hp_current: 20 },
  });

  assert.deepEqual(fake.queryCalls[0], {
    table: "mesa_combatants",
    filters: [
      ["eq", "id", "combatant-1"],
      ["eq", "combat_id", "combat-1"],
      ["eq", "session_id", "session-1"],
    ],
    patch: undefined,
    op: undefined,
  });
  assert.deepEqual(fake.queryCalls[1], {
    table: "mesa_combatants",
    filters: [
      ["eq", "id", "combatant-1"],
      ["eq", "session_id", "session-1"],
      ["eq", "combat_id", "combat-1"],
      ["eq", "hp_current", 20],
    ],
    patch: { hp_current: 12 },
    op: undefined,
  });
});

test("materialização: insert, upsert e delete preservam payload, opção e escopo", async () => {
  const fake = fakeClient();
  const repository = new SupabaseMesaRepository(fake.client as never);
  const rows = [{ id: "combatant-1", session_id: "session-1", combat_id: "combat-1", kind: "enemy", name: "Inimigo" }];

  await repository.insertCombatants(rows, "Falha ao criar os combatentes");
  await repository.upsertCombatants(rows, "Falha ao salvar a iniciativa");
  await repository.deleteCombatants({ combatId: "combat-1", sessionId: "session-1" }, "Falha ao limpar combatentes");

  assert.deepEqual(fake.queryCalls[0], {
    table: "mesa_combatants",
    filters: [],
    patch: undefined,
    op: { type: "insert", rows },
  });
  assert.deepEqual(fake.queryCalls[1], {
    table: "mesa_combatants",
    filters: [],
    patch: undefined,
    op: { type: "upsert", rows, options: { onConflict: "id" } },
  });
  assert.deepEqual(fake.queryCalls[2], {
    table: "mesa_combatants",
    filters: [
      ["eq", "combat_id", "combat-1"],
      ["eq", "session_id", "session-1"],
    ],
    patch: undefined,
    op: { type: "delete" },
  });
});

test("HP, débito de ação e ordenação são mapeados como operações condicionais", async () => {
  const fake = fakeClient({ data: [{ id: "combatant-1" }] });
  const repository = new SupabaseMesaRepository(fake.client as never);

  await repository.listCombatantsByCombat("combat-1", "session-1");
  await repository.updateCombatantHp({
    id: "combatant-1",
    sessionId: "session-1",
    combatId: "combat-1",
    patch: { hp_current: 12 },
    expected: { hp_current: 20 },
  });
  await repository.debitCombatantAction({
    id: "combatant-1",
    sessionId: "session-1",
    combatId: "combat-1",
    patch: { actions_remaining: 1, movement_remaining: 4 },
    expected: { actions_remaining: 2, movement_remaining: 6, is_dead: false },
  });

  assert.deepEqual(fake.queryCalls[0].filters, [
    ["eq", "combat_id", "combat-1"],
    ["order", "sort_order", { ascending: true, nullsFirst: false }],
    ["order", "id", { ascending: true }],
    ["eq", "session_id", "session-1"],
  ]);
  assert.deepEqual(fake.queryCalls[1].filters, [
    ["eq", "id", "combatant-1"],
    ["eq", "session_id", "session-1"],
    ["eq", "combat_id", "combat-1"],
    ["eq", "hp_current", 20],
  ]);
  assert.deepEqual(fake.queryCalls[2].filters, [
    ["eq", "id", "combatant-1"],
    ["eq", "session_id", "session-1"],
    ["eq", "combat_id", "combat-1"],
    ["eq", "actions_remaining", 2],
    ["eq", "movement_remaining", 6],
    ["eq", "is_dead", false],
  ]);
});

test("remoção sem escopo é recusada antes de qualquer chamada ao banco", async () => {
  const fake = fakeClient();
  const repository = new SupabaseMesaRepository(fake.client as never);

  await assert.rejects(
    repository.deleteCombatants({} as never, "Falha ao remover o combatente"),
    (error: unknown) =>
      error instanceof DatabaseQueryError && error.message.includes("escopo de remoção vazio"),
  );
  assert.equal(fake.queryCalls.length, 0);
});

test("falha de insert chega como erro de infraestrutura com o contexto do domínio", async () => {
  const fake = fakeClient({ error: { message: "duplicate key value violates unique constraint" } });
  const repository = new SupabaseMesaRepository(fake.client as never);

  await assert.rejects(
    repository.insertCombatants([{ id: "combatant-1" }], "Falha ao criar os combatentes"),
    (error: unknown) =>
      error instanceof DatabaseQueryError &&
      error.message.startsWith("Falha ao criar os combatentes:") &&
      error.message.includes("duplicate key"),
  );
});

test("ResolutionStore mapeia claim, release e commit para RPCs específicos", async () => {
  const fake = fakeClient({ data: [{ claimed: true, status: "processing", claim_token: "claim-1", result: null }] });
  const store = new SupabaseResolutionStore(fake.client as never);

  const claim = await store.claimItemConsume(key);
  await store.releaseItemConsume({ ...key, claimToken: "claim-1" });
  await store.commitMove({ ...key, claimToken: "claim-1", rpcArgs: { p_session_id: key.sessionId, p_combat_id: key.combatId, p_resolution_id: key.resolutionId, p_claim_token: "claim-1" } });
  await store.commitDeathSave({ ...key, claimToken: "claim-1", rpcArgs: { p_resolution_id: key.resolutionId } });
  await store.commitQuickhack({ ...key, claimToken: "claim-1", rpcArgs: { p_resolution_id: key.resolutionId } });

  assert.equal(claim?.claimed, true);
  assert.deepEqual(fake.calls.map((call) => call.name), [
    "claim_mesa_item_consume_resolution",
    "release_mesa_item_consume_resolution",
    "commit_mesa_move_resolution_atomic",
    "commit_mesa_death_save_resolution",
    "commit_mesa_quickhack_resolution",
  ]);
  assert.equal(fake.calls[1].args.p_session_id, key.sessionId);
  assert.equal(fake.calls[1].args.p_claim_token, "claim-1");
});

test("falhas do adapter mantêm erro de infraestrutura e não inventam resultado", async () => {
  const fake = fakeClient({ error: { message: "action_conflict" } });
  const store = new SupabaseResolutionStore(fake.client as never);

  await assert.rejects(
    store.commitAttack({ ...key, claimToken: "claim-1", rpcArgs: { p_resolution_id: key.resolutionId } }),
    (error: unknown) => error instanceof DatabaseQueryError && error.message.includes("action_conflict"),
  );
});
