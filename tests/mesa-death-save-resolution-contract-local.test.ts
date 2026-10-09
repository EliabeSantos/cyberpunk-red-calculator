/** Alvo PostgreSQL local do contrato real de Death Save. */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import type { ResolutionCommit } from "../src/lib/mesa/infrastructure.ts";
import { LocalPostgresResolutionStore } from "../src/lib/mesa/localPostgresInfrastructure.ts";
import {
  deathSaveResolutionContractSuite,
  type DeathSaveContractConfig,
  type DeathSaveFixture,
} from "./contract/deathSaveResolutionContractSuite.ts";

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

async function createFixture(pool: Pool): Promise<DeathSaveFixture> {
  const sessionId = randomUUID();
  const otherSessionId = randomUUID();
  const combatId = randomUUID();
  const otherCombatId = randomUUID();
  const actorId = randomUUID();
  const resolutionId = `contract-death-save:${randomUUID()}`;

  await pool.query(
    "insert into public.mesa_sessions (id,name,status,join_code) values ($1,'Death Save A','active',$3),($2,'Death Save B','active',$4)",
    [sessionId, otherSessionId, joinCode(), joinCode()],
  );
  try {
    await pool.query(
      "insert into public.mesa_combats (id,session_id,status,active_combatant_id,initiative_started,event_log) values ($1,$3,'active',$5,true,'[]'::jsonb),($2,$4,'active',null,false,'[]'::jsonb)",
      [combatId, otherCombatId, sessionId, otherSessionId, actorId],
    );
    await pool.query(
      `insert into public.mesa_combatants
       (id,combat_id,session_id,kind,name,actions_max,actions_remaining,movement_max,movement_remaining,hp_current,hp_max,is_dead,conditions,sort_order,death_save_dc,death_save_failures,netrunner_state)
       values ($1,$2,$3,'character','Death Save actor',2,2,6,6,0,40,false,'[]'::jsonb,1,10,0,'{"isJackedIn":false}'::jsonb)`,
      [actorId, combatId, sessionId],
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
      p_session_id: sessionId,
      p_combat_id: combatId,
      p_resolution_id: resolutionId,
      p_claim_token: token,
      p_actor_id: actorId,
      p_dc_before: 10,
      p_dead_before: false,
      p_failures_before: 0,
      p_dc_after: 10,
      p_failures_after: 1,
      p_dead_after: false,
      p_result: { combatantId: actorId, success: false, failuresAfter: 1 },
      p_event_text: null,
      ...overrides,
    },
  });

  return {
    key,
    commitInput,
    async readResolution() {
      const result = await pool.query(
        "select status,result from public.mesa_attack_resolutions where session_id=$1 and combat_id=$2 and resolution_id=$3",
        [sessionId, combatId, resolutionId],
      );
      return result.rows[0] as Record<string, unknown>;
    },
    async readEffects() {
      const result = await pool.query(
        "select death_save_dc,death_save_failures,is_dead,hp_current from public.mesa_combatants where id=$1",
        [actorId],
      );
      return result.rows[0] as Record<string, unknown>;
    },
    async cleanup() {
      await pool.query("delete from public.mesa_sessions where id = any($1)", [[sessionId, otherSessionId]]);
    },
  };
}

const config: DeathSaveContractConfig = {
  createEnvironment: async () => {
    if (!localUrl) return null;
    const databaseName = disposableDatabaseName(localUrl);
    if (!databaseName || !isLocalUrl(localUrl)) {
      throw new Error("MESA_LOCAL_TEST_DATABASE_URL recusada: use um PostgreSQL local descartável");
    }
    const pool = new Pool(poolConfig(localUrl));
    try {
      await pool.query("select 1");
      await pool.query("select id from public.mesa_attack_resolutions limit 1");
      await pool.query("select death_save_dc from public.mesa_combatants limit 1");
    } catch (error) {
      await pool.end();
      throw new Error(`PostgreSQL local sem conexão/schema de Death Save: ${error instanceof Error ? error.message : String(error)}`);
    }
    const store = new LocalPostgresResolutionStore(pool);
    return {
      claim: (key) => store.claimAttack<Record<string, unknown>>(key),
      release: (input) => store.releaseAttack(input),
      commit: (input) => store.commitDeathSave<Record<string, unknown>>(input),
      createFixture: () => createFixture(pool),
      close: () => pool.end(),
    };
  },
  pending: () => "MESA_LOCAL_TEST_DATABASE_URL ausente: contrato de Death Save não executado contra PostgreSQL local",
};

deathSaveResolutionContractSuite(config);
