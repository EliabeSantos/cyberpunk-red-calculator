/** Alvo PostgreSQL local do contrato real de NET Action. */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import type { ResolutionCommit } from "../src/lib/mesa/infrastructure.ts";
import { LocalPostgresResolutionStore } from "../src/lib/mesa/localPostgresInfrastructure.ts";
import {
  netActionResolutionContractSuite,
  type NetActionContractConfig,
  type NetActionFixture,
} from "./contract/netActionResolutionContractSuite.ts";

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

const stateBefore = {
  isJackedIn: true,
  architectureId: "arch-1",
  currentFloor: 1,
  netActionsRemaining: 2,
  meatspaceActionUsedForNetrunning: false,
};
const stateAfter = { ...stateBefore, netActionsRemaining: 1, meatspaceActionUsedForNetrunning: true };
const discoveryBefore = {};
const discoveryAfter = { architectureId: "arch-1", discoveredNodeIds: ["node-1"], revealedFileIds: [] };

async function createFixture(pool: Pool): Promise<NetActionFixture> {
  const sessionId = randomUUID();
  const otherSessionId = randomUUID();
  const combatId = randomUUID();
  const otherCombatId = randomUUID();
  const actorId = randomUUID();
  const resolutionId = `contract-net-action:${randomUUID()}`;

  await pool.query(
    "insert into public.mesa_sessions (id,name,status,join_code,net_architectures) values ($1,'NET contract A','active',$3,'[]'::jsonb),($2,'NET contract B','active',$4,'[]'::jsonb)",
    [sessionId, otherSessionId, joinCode(), joinCode()],
  );
  try {
    await pool.query(
      "insert into public.mesa_combats (id,session_id,status,active_combatant_id,initiative_started,event_log) values ($1,$3,'active',$5,true,'[]'::jsonb),($2,$4,'active',null,false,'[]'::jsonb)",
      [combatId, otherCombatId, sessionId, otherSessionId, actorId],
    );
    await pool.query(
      `insert into public.mesa_combatants
       (id,combat_id,session_id,kind,name,actions_max,actions_remaining,movement_max,movement_remaining,hp_current,hp_max,is_dead,conditions,sort_order,netrunner_state,net_discovery)
       values ($1,$2,$3,'character','NET actor',2,2,6,6,20,20,false,'[]'::jsonb,1,$4::jsonb,$5::jsonb)`,
      [actorId, combatId, sessionId, JSON.stringify(stateBefore), JSON.stringify(discoveryBefore)],
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
      p_claim_token: token, p_actor_id: actorId, p_actions_before: 2, p_actions_after: 1,
      p_actor_state_before: stateBefore, p_actor_state_after: stateAfter,
      p_discovery_before: discoveryBefore, p_discovery_after: discoveryAfter,
      p_architecture_before: [], p_architecture_after: [],
      p_result: { action: "pathfinder", success: true, discoveredNodeIds: ["node-1"] },
      p_event_text: null, p_private_to_participant_id: null,
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
      const actor = await pool.query("select actions_remaining,netrunner_state,net_discovery from public.mesa_combatants where id=$1", [actorId]);
      const session = await pool.query("select net_architectures from public.mesa_sessions where id=$1", [sessionId]);
      const actorRow = actor.rows[0] as { actions_remaining: number; netrunner_state: typeof stateAfter; net_discovery: typeof discoveryAfter };
      const architectures = session.rows[0].net_architectures as unknown[];
      return {
        actions_remaining: actorRow.actions_remaining,
        net_actions_remaining: actorRow.netrunner_state.netActionsRemaining,
        meatspace_action_used_for_netrunning: actorRow.netrunner_state.meatspaceActionUsedForNetrunning,
        discovered_node_ids: actorRow.net_discovery.discoveredNodeIds ?? [],
        architecture_count: architectures.length,
      };
    },
    async cleanup() {
      await pool.query("delete from public.mesa_sessions where id = any($1)", [[sessionId, otherSessionId]]);
    },
  };
}

const config: NetActionContractConfig = {
  createEnvironment: async () => {
    if (!localUrl) return null;
    const databaseName = disposableDatabaseName(localUrl);
    if (!databaseName || !isLocalUrl(localUrl)) throw new Error("MESA_LOCAL_TEST_DATABASE_URL recusada: use um PostgreSQL local descartável");
    const pool = new Pool(poolConfig(localUrl));
    try {
      await pool.query("select 1");
      await pool.query("select id from public.mesa_attack_resolutions limit 1");
      await pool.query("select netrunner_state,net_discovery from public.mesa_combatants limit 1");
      await pool.query("select net_architectures from public.mesa_sessions limit 1");
    } catch (error) {
      await pool.end();
      throw new Error(`PostgreSQL local sem conexão/schema de NET: ${error instanceof Error ? error.message : String(error)}`);
    }
    const store = new LocalPostgresResolutionStore(pool);
    return {
      claim: (key) => store.claimAttack<Record<string, unknown>>(key),
      release: (input) => store.releaseAttack(input),
      commit: (input) => store.commitNetAction<Record<string, unknown>>(input),
      createFixture: () => createFixture(pool),
      close: () => pool.end(),
    };
  },
  pending: () => "MESA_LOCAL_TEST_DATABASE_URL ausente: contrato de NET não executado contra PostgreSQL local",
};

netActionResolutionContractSuite(config);
