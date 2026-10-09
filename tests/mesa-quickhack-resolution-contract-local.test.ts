/** Alvo PostgreSQL local do contrato real de Quickhack. */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import type { ResolutionCommit } from "../src/lib/mesa/infrastructure.ts";
import { LocalPostgresResolutionStore } from "../src/lib/mesa/localPostgresInfrastructure.ts";
import {
  quickhackResolutionContractSuite,
  type QuickhackContractConfig,
  type QuickhackFixture,
} from "./contract/quickhackResolutionContractSuite.ts";

const localUrl = process.env.MESA_LOCAL_TEST_DATABASE_URL;

function disposableDatabaseName(url: string): string | null {
  const withoutScheme = url.replace(/^[^/]*\/\/*/, "").split(/[?#]/)[0];
  const dbName = withoutScheme.split("/").pop() ?? "";
  return /(contract|test|tmp|disposable)/.test(dbName) ? dbName : null;
}

function isLocalUrl(url: string): boolean {
  return /^(postgresql|postgres):\/\/(localhost|127\.0\.0\.1|\[::1\])\//.test(url)
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

const actorStateBefore = { isJackedIn: true, netActionsRemaining: 2, meatspaceActionUsedForNetrunning: false };
const actorStateAfter = { ...actorStateBefore, netActionsRemaining: 1, meatspaceActionUsedForNetrunning: true };
const targetSuppliesBefore = { inventory: [{ itemId: "chipware-1", item: "Chipware", quantity: 1 }] };
const targetSuppliesAfter = { inventory: [] };

async function createFixture(pool: Pool): Promise<QuickhackFixture> {
  const sessionId = randomUUID();
  const otherSessionId = randomUUID();
  const combatId = randomUUID();
  const otherCombatId = randomUUID();
  const actorId = randomUUID();
  const targetId = randomUUID();
  const resolutionId = `contract-quickhack:${randomUUID()}`;

  await pool.query(
    "insert into public.mesa_sessions (id,name,status,join_code) values ($1,'Quickhack contract A','active',$3),($2,'Quickhack contract B','active',$4)",
    [sessionId, otherSessionId, joinCode(), joinCode()],
  );
  try {
    await pool.query(
      "insert into public.mesa_combats (id,session_id,status,active_combatant_id,initiative_started,event_log) values ($1,$3,'active',$5,true,'[]'::jsonb),($2,$4,'active',null,false,'[]'::jsonb)",
      [combatId, otherCombatId, sessionId, otherSessionId, actorId],
    );
    await pool.query(
      `insert into public.mesa_combatants
       (id,combat_id,session_id,kind,name,actions_max,actions_remaining,movement_max,movement_remaining,hp_current,hp_max,is_dead,conditions,sort_order,netrunner_state,net_effects,supplies)
       values ($1,$2,$3,'character','Quickhack actor',2,2,6,6,20,20,false,'[]'::jsonb,1,$4::jsonb,'[]'::jsonb,'{}'::jsonb),
              ($5,$2,$3,'enemy','Quickhack target',2,2,6,6,20,20,false,'[]'::jsonb,2,'{}'::jsonb,'[]'::jsonb,$6::jsonb)`,
      [actorId, combatId, sessionId, JSON.stringify(actorStateBefore), targetId, JSON.stringify(targetSuppliesBefore)],
    );
  } catch (error) {
    await pool.query("delete from public.mesa_sessions where id = any($1)", [[sessionId, otherSessionId]]);
    throw error;
  }

  const key = { sessionId, combatId, resolutionId };
  const commitInput = (
    token: string,
    overrides: Record<string, unknown> = {},
  ): ResolutionCommit<Record<string, unknown>> => ({
    ...key,
    claimToken: token,
    rpcArgs: {
      p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: resolutionId,
      p_claim_token: token, p_actor_id: actorId, p_target_id: targetId,
      p_actions_before: 2, p_actions_after: 1, p_actor_state_before: actorStateBefore, p_actor_state_after: actorStateAfter,
      p_target_hp_before: 20, p_target_dead_before: false, p_target_patch: { hp_current: 15, is_dead: false },
      p_target_effects: [{ id: "effect-1", quickhackId: "system_reset" }], p_target_conditions: ["unconscious"],
      p_target_supplies_before: targetSuppliesBefore, p_target_supplies_after: targetSuppliesAfter,
      p_result: { quickhackId: "system_reset", targetCombatantId: targetId, success: true }, p_event_text: null,
      ...overrides,
    },
  });

  return {
    key,
    commitInput,
    async readResolution() {
      const result = await pool.query("select status,result from public.mesa_attack_resolutions where session_id=$1 and combat_id=$2 and resolution_id=$3", [sessionId, combatId, resolutionId]);
      return result.rows[0] as Record<string, unknown>;
    },
    async readEffects() {
      const target = await pool.query("select hp_current,is_dead,net_effects,conditions,supplies from public.mesa_combatants where id=$1", [targetId]);
      const actor = await pool.query("select actions_remaining from public.mesa_combatants where id=$1", [actorId]);
      const targetRow = target.rows[0] as { hp_current: number; is_dead: boolean; net_effects: unknown[]; conditions: unknown[]; supplies: { inventory?: Array<{ quantity?: number }> } };
      return {
        actions_remaining: (actor.rows[0] as { actions_remaining: number }).actions_remaining,
        target_hp: targetRow.hp_current,
        target_dead: targetRow.is_dead,
        target_effect_count: targetRow.net_effects.length,
        target_condition_count: targetRow.conditions.length,
        target_supply_quantity: targetRow.supplies.inventory?.[0]?.quantity ?? 0,
      };
    },
    async cleanup() {
      await pool.query("delete from public.mesa_sessions where id = any($1)", [[sessionId, otherSessionId]]);
    },
  };
}

const config: QuickhackContractConfig = {
  createEnvironment: async () => {
    if (!localUrl) return null;
    const databaseName = disposableDatabaseName(localUrl);
    if (!databaseName || !isLocalUrl(localUrl)) throw new Error("MESA_LOCAL_TEST_DATABASE_URL recusada: use um PostgreSQL local descartável");
    const pool = new Pool(poolConfig(localUrl));
    try {
      await pool.query("select 1");
      await pool.query("select id from public.mesa_attack_resolutions limit 1");
      await pool.query("select net_effects from public.mesa_combatants limit 1");
    } catch (error) {
      await pool.end();
      throw new Error(`PostgreSQL local sem conexão/schema de Quickhack: ${error instanceof Error ? error.message : String(error)}`);
    }
    const store = new LocalPostgresResolutionStore(pool);
    return {
      claim: (key) => store.claimAttack<Record<string, unknown>>(key),
      release: (input) => store.releaseAttack(input),
      commit: (input) => store.commitQuickhack<Record<string, unknown>>(input),
      createFixture: () => createFixture(pool),
      close: () => pool.end(),
    };
  },
  pending: () => "MESA_LOCAL_TEST_DATABASE_URL ausente: contrato de Quickhack não executado contra PostgreSQL local",
};

quickhackResolutionContractSuite(config);
