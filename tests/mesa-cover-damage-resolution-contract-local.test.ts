/** Alvo PostgreSQL local do contrato real de dano à cobertura. */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import type { ResolutionCommit } from "../src/lib/mesa/infrastructure.ts";
import { LocalPostgresResolutionStore } from "../src/lib/mesa/localPostgresInfrastructure.ts";
import {
  coverDamageResolutionContractSuite,
  type CoverDamageContractConfig,
  type CoverDamageFixture,
} from "./contract/coverDamageResolutionContractSuite.ts";

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

const tacticalMap = {
  imageUrl: "",
  enabled: true,
  pixelsPerMeter: 50,
  width: 1000,
  height: 600,
  geometry: {
    walls: [{ id: "wall-contract", type: "wall", start: { x: 10, y: 10 }, end: { x: 10, y: 100 }, thickness: 0.2, coverHP: 20, destroyed: false }],
    doors: [],
  },
};

async function createFixture(pool: Pool): Promise<CoverDamageFixture> {
  const sessionId = randomUUID();
  const otherSessionId = randomUUID();
  const combatId = randomUUID();
  const otherCombatId = randomUUID();
  const actorId = randomUUID();
  const resolutionId = `contract-cover:${randomUUID()}`;

  await pool.query(
    "insert into public.mesa_sessions (id,name,status,join_code,tactical_map) values ($1,'Cover contract A','active',$3,$5::jsonb),($2,'Cover contract B','active',$4,'{}'::jsonb)",
    [sessionId, otherSessionId, joinCode(), joinCode(), JSON.stringify(tacticalMap)],
  );
  try {
    await pool.query(
      "insert into public.mesa_combats (id,session_id,status,active_combatant_id,initiative_started,event_log) values ($1,$3,'active',$5,true,'[]'::jsonb),($2,$4,'active',null,false,'[]'::jsonb)",
      [combatId, otherCombatId, sessionId, otherSessionId, actorId],
    );
    await pool.query(
      `insert into public.mesa_combatants
       (id,combat_id,session_id,kind,name,actions_max,actions_remaining,movement_max,movement_remaining,hp_current,hp_max,is_dead,conditions,sort_order,combat_ammo)
       values ($1,$2,$3,'character','Cover actor',2,2,6,6,20,20,false,'[]'::jsonb,1,$4::jsonb)`,
      [actorId, combatId, sessionId, JSON.stringify({ weapon: 3 })],
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
      p_ammo_before: { weapon: 3 }, p_ammo_after: { weapon: 2 }, p_obstacle_id: "wall-contract",
      p_hp_before: 20, p_hp_after: 13, p_destroyed: false,
      p_result: { combatantId: actorId, obstacleId: "wall-contract", damage: 7 }, p_event_text: null,
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
      const actor = await pool.query("select actions_remaining,combat_ammo from public.mesa_combatants where id=$1", [actorId]);
      const session = await pool.query("select tactical_map from public.mesa_sessions where id=$1", [sessionId]);
      const row = actor.rows[0] as { actions_remaining: number; combat_ammo: Record<string, number> };
      const map = session.rows[0].tactical_map as { geometry: { walls: Array<{ id: string; coverHP: number; destroyed: boolean }> } };
      const wall = map.geometry.walls.find((item) => item.id === "wall-contract")!;
      return { actions_remaining: row.actions_remaining, ammo: row.combat_ammo, cover_hp: wall.coverHP, destroyed: wall.destroyed };
    },
    async cleanup() {
      await pool.query("delete from public.mesa_sessions where id = any($1)", [[sessionId, otherSessionId]]);
    },
  };
}

const config: CoverDamageContractConfig = {
  createEnvironment: async () => {
    if (!localUrl) return null;
    const databaseName = disposableDatabaseName(localUrl);
    if (!databaseName || !isLocalUrl(localUrl)) throw new Error("MESA_LOCAL_TEST_DATABASE_URL recusada: use um PostgreSQL local descartável");
    const pool = new Pool(poolConfig(localUrl));
    try {
      await pool.query("select 1");
      await pool.query("select id from public.mesa_attack_resolutions limit 1");
      await pool.query("select tactical_map from public.mesa_sessions limit 1");
    } catch (error) {
      await pool.end();
      throw new Error(`PostgreSQL local sem conexão/schema de Cover: ${error instanceof Error ? error.message : String(error)}`);
    }
    const store = new LocalPostgresResolutionStore(pool);
    return {
      claim: (key) => store.claimAttack<Record<string, unknown>>(key),
      release: (input) => store.releaseAttack(input),
      commit: (input) => store.commitCoverDamage<Record<string, unknown>>(input),
      createFixture: () => createFixture(pool),
      close: () => pool.end(),
    };
  },
  pending: () => "MESA_LOCAL_TEST_DATABASE_URL ausente: contrato de Cover não executado contra PostgreSQL local",
};

coverDamageResolutionContractSuite(config);
