import assert from "node:assert/strict";
import test from "node:test";

import {
  createLocalPostgresLifecycle,
  LocalPostgresConnectionError,
  type ManagedLocalPostgresPool,
} from "../src/lib/mesa/hostingInfrastructure.ts";

function fakePool(commands: string[], options: { failCommit?: boolean } = {}): ManagedLocalPostgresPool {
  const client = {
    query: async (sql: string) => {
      commands.push(sql);
      if (sql === "COMMIT" && options.failCommit) throw new Error("commit failed");
      return { rows: [] };
    },
    release: () => commands.push("RELEASE"),
  };
  return {
    query: async (sql: string) => { commands.push(`POOL:${sql}`); return { rows: [] }; },
    connect: async () => client,
    end: async () => undefined,
    on: () => undefined,
  } as never;
}

test("contexto usa uma conexão, confirma e libera somente após commit", async () => {
  const commands: string[] = [];
  const lifecycle = createLocalPostgresLifecycle(fakePool(commands), "transaction-test");
  const context = await lifecycle.beginTransaction();
  await context.query("select 1");
  await context.commit();
  await context.release();

  assert.deepEqual(commands, ["BEGIN", "select 1", "COMMIT", "RELEASE"]);
  assert.equal(lifecycle.activeOperations, 0);
  await assert.rejects(context.query("select 2"), LocalPostgresConnectionError);
});

test("rollback e release ocorrem sem reutilizar o contexto", async () => {
  const commands: string[] = [];
  const lifecycle = createLocalPostgresLifecycle(fakePool(commands), "rollback-test");
  const context = await lifecycle.beginTransaction();
  await context.query("update mesa_combatants set hp_current = 1");
  await context.rollback();
  await context.release();

  assert.deepEqual(commands, ["BEGIN", "update mesa_combatants set hp_current = 1", "ROLLBACK", "RELEASE"]);
  assert.equal(lifecycle.activeOperations, 0);
});

test("falha de commit não é mascarada e permite rollback controlado", async () => {
  const commands: string[] = [];
  const lifecycle = createLocalPostgresLifecycle(fakePool(commands, { failCommit: true }), "commit-failure-test");
  const context = await lifecycle.beginTransaction();
  await assert.rejects(context.commit());
  await context.rollback();
  await context.release();

  assert.deepEqual(commands, ["BEGIN", "COMMIT", "ROLLBACK", "RELEASE"]);
  assert.equal(lifecycle.activeOperations, 0);
});

test("duas transações recebem contextos e conexões independentes", async () => {
  const commands: string[] = [];
  const lifecycle = createLocalPostgresLifecycle(fakePool(commands), "isolation-test");
  const first = await lifecycle.beginTransaction();
  const second = await lifecycle.beginTransaction();
  assert.notEqual(first, second);
  assert.equal(lifecycle.activeOperations, 2);
  await first.rollback();
  await first.release();
  assert.equal(lifecycle.activeOperations, 1);
  await second.rollback();
  await second.release();
  assert.equal(lifecycle.activeOperations, 0);
});

test("repository e resolution store compartilham o client da operação", async () => {
  const commands: string[] = [];
  const lifecycle = createLocalPostgresLifecycle(fakePool(commands), "shared-client-test");
  const context = await lifecycle.beginTransaction();

  await context.repository.findSessionById("session-a");
  await context.resolutionStore.findAttack({
    sessionId: "session-a",
    combatId: "combat-a",
    resolutionId: "resolution-a",
  });
  await context.commit();
  await context.release();

  assert.deepEqual(commands, [
    "BEGIN",
    "select * from public.mesa_sessions where id = $1 limit 1",
    "select combat_id,status,claim_token,result from public.mesa_attack_resolutions where session_id=$1 and combat_id=$2 and resolution_id=$3 order by created_at desc limit 1",
    "COMMIT",
    "RELEASE",
  ]);
});

test("falha depois de reservar battle e materializar combatants desfaz a operação inteira", async () => {
  const commands: string[] = [];
  const lifecycle = createLocalPostgresLifecycle(fakePool(commands), "composite-rollback-test");
  const context = await lifecycle.beginTransaction();

  await assert.rejects(
    (async () => {
      try {
        await context.query("insert into public.mesa_battles (session_id) values ($1)", ["session-a"]);
        await context.query("insert into public.mesa_combatants (combat_id, session_id) values ($1, $2)", ["combat-a", "session-a"]);
        await context.query("update public.mesa_combats set event_log = $1::jsonb", ["[]"]);
        throw new Error("falha intermediária simulada");
      } catch (error) {
        await context.rollback();
        throw error;
      }
    })(),
    /falha intermediária simulada/,
  );
  await context.release();

  assert.deepEqual(commands, [
    "BEGIN",
    "insert into public.mesa_battles (session_id) values ($1)",
    "insert into public.mesa_combatants (combat_id, session_id) values ($1, $2)",
    "update public.mesa_combats set event_log = $1::jsonb",
    "ROLLBACK",
    "RELEASE",
  ]);
});

test("PATCH/DELETE mantêm locks e escrita no mesmo contexto", async () => {
  const commands: string[] = [];
  const lifecycle = createLocalPostgresLifecycle(fakePool(commands), "combatant-mutation-test");
  const context = await lifecycle.beginTransaction();

  await context.query("select id from public.mesa_combatants where id = $1 and session_id = $2 for update", ["combatant-a", "session-a"]);
  await context.query("select id from public.mesa_combats where id = $1 and session_id = $2 for update", ["combat-a", "session-a"]);
  await context.query("update public.mesa_combatants set conditions = $1::jsonb where id = $2 and combat_id = $3 and session_id = $4", ["[]", "combatant-a", "combat-a", "session-a"]);
  await context.query("delete from public.mesa_combatants where id = $1 and combat_id = $2 and session_id = $3", ["combatant-a", "combat-a", "session-a"]);
  await context.commit();
  await context.release();

  assert.equal(commands[0], "BEGIN");
  assert.equal(commands.at(-2), "COMMIT");
  assert.equal(commands.at(-1), "RELEASE");
});

test("avanço de turno futuro deve reverter combatants, combate e log juntos", async () => {
  const commands: string[] = [];
  const lifecycle = createLocalPostgresLifecycle(fakePool(commands), "advance-turn-rollback-test");
  const context = await lifecycle.beginTransaction();

  await assert.rejects(
    (async () => {
      try {
        await context.query("select id from public.mesa_combats where id = $1 and session_id = $2 for update", ["combat-a", "session-a"]);
        await context.query("select id from public.mesa_combatants where combat_id = $1 and session_id = $2 for update", ["combat-a", "session-a"]);
        await context.query("update public.mesa_combatants set actions_remaining = $1 where id = $2", [0, "previous"]);
        await context.query("update public.mesa_combats set active_combatant_id = $1 where id = $2", ["next", "combat-a"]);
        await context.query("update public.mesa_combats set event_log = $1::jsonb where id = $2", ["[]", "combat-a"]);
        throw new Error("falha em dependência de avanço");
      } catch (error) {
        await context.rollback();
        throw error;
      }
    })(),
    /falha em dependência de avanço/,
  );
  await context.release();

  assert.equal(commands.at(-2), "ROLLBACK");
  assert.equal(commands.at(-1), "RELEASE");
});

test("adapters locais expõem as escritas de turno sobre o mesmo contexto", async () => {
  const commands: string[] = [];
  const lifecycle = createLocalPostgresLifecycle(fakePool(commands), "turn-adapter-preparation-test");
  const context = await lifecycle.beginTransaction();

  await context.repository.updateCombatant({
    id: "combatant-a",
    combatId: "combat-a",
    sessionId: "session-a",
    patch: { actions_remaining: 0, movement_remaining: 0 },
    expected: { actions_remaining: 2 },
  });
  await context.repository.updateCombat("combat-a", "session-a", {
    active_combatant_id: "combatant-b",
    round: 2,
  });
  const log = await context.repository.findCombatEventLog("combat-a", "session-a");
  await context.repository.replaceCombatEventLog("combat-a", "session-a", log);
  await context.repository.updateSession("session-a", { updated_at: "now" });
  const architectures = await context.repository.findSessionNetArchitectures("session-a");
  await context.repository.updateSessionNetArchitectures("session-a", architectures);
  await context.repository.updateBattle("battle-a", "session-a", { event_log: log });
  await context.repository.completeBattle("battle-a", "session-a", {
    status: "completed",
    ended_at: "now",
    final_round: 2,
    combatants: [],
    event_log: log,
  });

  await context.commit();
  await context.release();
  assert.equal(commands[0], "BEGIN");
  assert.equal(commands.at(-2), "COMMIT");
  assert.equal(commands.at(-1), "RELEASE");
});

test("ordem de locks do avanço local precede combatants, log e commit", async () => {
  const commands: string[] = [];
  const lifecycle = createLocalPostgresLifecycle(fakePool(commands), "advance-lock-order-test");
  const context = await lifecycle.beginTransaction();
  await context.query("select id from public.mesa_sessions where id = $1 for update", ["session-a"]);
  await context.query("select id from public.mesa_combats where id = $1 and session_id = $2 for update", ["combat-a", "session-a"]);
  await context.query("select id from public.mesa_battles where session_id = $1 and status = 'active' for update", ["session-a"]);
  await context.query("select id from public.mesa_combatants where combat_id = $1 and session_id = $2 order by sort_order for update", ["combat-a", "session-a"]);
  await context.query("update public.mesa_combats set status = $1 where id = $2", ["finished", "combat-a"]);
  await context.query("update public.mesa_battles set status = $1 where id = $2 and status = 'active'", ["completed", "battle-a"]);
  await context.commit();
  await context.release();

  assert.deepEqual(commands.slice(0, 5), [
    "BEGIN",
    "select id from public.mesa_sessions where id = $1 for update",
    "select id from public.mesa_combats where id = $1 and session_id = $2 for update",
    "select id from public.mesa_battles where session_id = $1 and status = 'active' for update",
    "select id from public.mesa_combatants where combat_id = $1 and session_id = $2 order by sort_order for update",
  ]);
});
