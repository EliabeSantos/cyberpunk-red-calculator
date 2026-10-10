/** Alvo PostgreSQL local da suíte compartilhada de consumo/cura por item. */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import { LocalPostgresResolutionStore } from "../src/lib/mesa/localPostgresInfrastructure.ts";
import type { ResolutionCommit } from "../src/lib/mesa/infrastructure.ts";
import {
  itemResolutionContractSuite,
  type ItemResolutionContractConfig,
  type ItemResolutionFixture,
  type ItemResolutionKind,
} from "./contract/itemResolutionContractSuite.ts";

const localUrl = process.env.MESA_LOCAL_TEST_DATABASE_URL;

function disposableDatabaseName(url: string): string | null {
  const withoutScheme = url.replace(/^[^/]*\/\/*/, "").split(/[?#]/)[0];
  const dbName = withoutScheme.split("/").pop() ?? "";
  return /(contract|test|tmp|disposable)/.test(dbName) ? dbName : null;
}

function isLocalUrl(url: string): boolean {
  return /^(?:postgresql|postgres):\/\/(?:[^/@]*@)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//.test(url)
    || (/^(postgresql|postgres):\/\//.test(url) && !/\/\/[^/@]*@/.test(url));
}

function poolConfig(url: string): { host?: string; database?: string; connectionString?: string } {
  const socket = url.match(/^(?:postgresql|postgres):\/\/(?:[^/@]*@)?\/([^?#]+)/);
  return socket
    ? { host: process.env.MESA_LOCAL_PG_SOCKET_DIR || "/var/run/postgresql", database: socket[1] }
    : { connectionString: url };
}

function joinCode(): string {
  return randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase();
}

async function createFixture(pool: Pool, kind: ItemResolutionKind): Promise<ItemResolutionFixture> {
  const sessionId = randomUUID();
  const otherSessionId = randomUUID();
  const combatId = randomUUID();
  const otherCombatId = randomUUID();
  const actorId = randomUUID();
  const resolutionId = `contract-item-${kind}:${randomUUID()}`;
  const item = { item: "Medkit", itemId: "medkit", quantity: 1 };
  const suppliesBefore = { inventory: [item] };
  const suppliesAfter = { inventory: [] };

  await pool.query(
    "insert into public.mesa_sessions (id,name,status,join_code) values ($1,'Item contract A','active',$3),($2,'Item contract B','active',$4)",
    [sessionId, otherSessionId, joinCode(), joinCode()],
  );
  try {
    await pool.query(
      "insert into public.mesa_combats (id,session_id,status,active_combatant_id,initiative_started,event_log) values ($1,$3,'active',$5,true,'[]'::jsonb),($2,$4,'active',null,false,'[]'::jsonb)",
      [combatId, otherCombatId, sessionId, otherSessionId, actorId],
    );
    await pool.query(
      `insert into public.mesa_combatants
       (id,combat_id,session_id,kind,name,actions_max,actions_remaining,movement_max,movement_remaining,hp_current,hp_max,is_dead,conditions,sort_order,supplies)
       values ($1,$2,$3,'character','Item actor',2,2,6,6,10,20,false,'[]'::jsonb,1,$4::jsonb)`,
      [actorId, combatId, sessionId, JSON.stringify(suppliesBefore)],
    );
  } catch (error) {
    await pool.query("delete from public.mesa_sessions where id = any($1)", [[sessionId, otherSessionId]]);
    throw error;
  }

  const key = { sessionId, combatId, resolutionId };
  const commitInput = (
    token: string,
    overrides: Record<string, unknown> = {},
  ): ResolutionCommit<Record<string, unknown>> => {
    const rpcArgs = kind === "consume"
      ? {
        p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: resolutionId,
        p_claim_token: token, p_actor_id: actorId, p_actions_before: 2, p_actions_after: 1,
        p_supplies_before: suppliesBefore, p_supplies_after: suppliesAfter,
        p_item_name: "Medkit", p_amount: 1, p_result: { kind, committed: true }, p_event_text: null,
      }
      : {
        p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: resolutionId,
        p_claim_token: token, p_actor_id: actorId, p_actions_before: 2, p_actions_after: 1,
        p_supplies_before: suppliesBefore, p_supplies_after: suppliesAfter,
        p_hp_before: 10, p_hp_after: 15, p_item_name: "Medkit", p_amount: 5,
        p_result: { kind, committed: true }, p_event_text: null,
      };
    return { ...key, claimToken: token, rpcArgs: { ...rpcArgs, ...overrides } };
  };

  return {
    key,
    claimToken: "",
    commitInput,
    async readResolution() {
      const result = await pool.query(
        "select status,result from public.mesa_item_consume_resolutions where session_id=$1 and combat_id=$2 and resolution_id=$3",
        [sessionId, combatId, resolutionId],
      );
      return result.rows[0] as Record<string, unknown>;
    },
    async readEffects() {
      const result = await pool.query(
        "select actions_remaining,supplies,hp_current from public.mesa_combatants where id=$1",
        [actorId],
      );
      const row = result.rows[0] as { actions_remaining: number; supplies: { inventory?: Array<{ quantity?: number }> }; hp_current: number };
      return {
        actions_remaining: row.actions_remaining,
        inventory_quantity: row.supplies.inventory?.[0]?.quantity ?? 0,
        hp_current: row.hp_current,
      };
    },
    async cleanup() {
      await pool.query("delete from public.mesa_sessions where id = any($1)", [[sessionId, otherSessionId]]);
    },
  };
}

const config: ItemResolutionContractConfig = {
  createEnvironment: async () => {
    if (!localUrl) return null;
    const databaseName = disposableDatabaseName(localUrl);
    if (!databaseName || !isLocalUrl(localUrl)) {
      throw new Error("MESA_LOCAL_TEST_DATABASE_URL recusada: use um PostgreSQL local descartável");
    }
    const pool = new Pool(poolConfig(localUrl));
    try {
      await pool.query("select 1");
      await pool.query("select id from public.mesa_item_consume_resolutions limit 1");
    } catch (error) {
      await pool.end();
      throw new Error(`PostgreSQL local sem conexão/schema da Mesa: ${error instanceof Error ? error.message : String(error)}`);
    }
    const store = new LocalPostgresResolutionStore(pool);
    return {
      claim: (key) => store.claimItemConsume<Record<string, unknown>>(key),
      release: (input) => store.releaseItemConsume(input),
      commit: (kind, input) => kind === "consume"
        ? store.commitItemConsume<Record<string, unknown>>(input)
        : store.commitItemHeal<Record<string, unknown>>(input),
      createFixture: (kind) => createFixture(pool, kind),
      close: () => pool.end(),
    };
  },
  pending: () => "MESA_LOCAL_TEST_DATABASE_URL ausente: contrato de itens não executado contra PostgreSQL local",
};

itemResolutionContractSuite(config);
