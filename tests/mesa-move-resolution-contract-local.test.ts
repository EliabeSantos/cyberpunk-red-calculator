import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import { LocalPostgresMoveResolutionStore } from "../src/lib/mesa/localPostgresInfrastructure.ts";
import { moveResolutionContractSuite, type MoveContractConfig, type MoveFixture } from "./contract/moveResolutionContractSuite.ts";

const url = process.env.MESA_LOCAL_TEST_DATABASE_URL;

function dbName(value: string): string | null {
  const path = value.replace(/^[^/]*\/\/*/, "").split(/[?#]/)[0];
  const name = path.split("/").pop() ?? "";
  return /(contract|test|tmp|disposable)/.test(name) ? name : null;
}

function poolConfig(value: string): { host?: string; database?: string; connectionString?: string } {
  const socket = value.match(/^(?:postgresql|postgres):\/\/(?:[^/@]*@)?\/([^?#]+)/);
  return socket
    ? { host: process.env.MESA_LOCAL_PG_SOCKET_DIR || "/var/run/postgresql", database: socket[1] }
    : { connectionString: value };
}

async function fixture(pool: Pool): Promise<MoveFixture> {
  const sessionId = randomUUID();
  const otherSessionId = randomUUID();
  const combatId = randomUUID();
  const otherCombatId = randomUUID();
  const actorId = randomUUID();
  const claimToken = randomUUID();
  const resolutionId = `contract-move:${randomUUID()}`;
  await pool.query(
    "insert into public.mesa_sessions (id,name,status,join_code) values ($1,'Move A','active',$3),($2,'Move B','active',$4)",
    [sessionId, otherSessionId, randomUUID().replace(/-/g, '').slice(0, 5).toUpperCase(), randomUUID().replace(/-/g, '').slice(0, 5).toUpperCase()],
  );
  try {
    await pool.query("insert into public.mesa_combats (id,session_id,status) values ($1,$3,'active'),($2,$4,'active')", [combatId, otherCombatId, sessionId, otherSessionId]);
    await pool.query(
      `insert into public.mesa_combatants
       (id,combat_id,session_id,kind,name,actions_max,actions_remaining,movement_max,movement_remaining,hp_current,hp_max,is_dead,position)
       values ($1,$2,$3,'character','Mover',2,2,6,6,10,10,false,$4::jsonb)`,
      [actorId, combatId, sessionId, JSON.stringify({ x: 0.2, y: 0.5 })],
    );
    await pool.query(
      `insert into public.mesa_attack_resolutions
       (session_id,combat_id,resolution_id,claim_token,status)
       values ($1,$2,$3,$4,'processing')`,
      [sessionId, combatId, resolutionId, claimToken],
    );
  } catch (error) {
    await pool.query("delete from public.mesa_sessions where id = any($1)", [[sessionId, otherSessionId]]);
    throw error;
  }
  return {
    sessionId, combatId, otherSessionId, otherCombatId, actorId, claimToken, resolutionId,
    async cleanup() {
      await pool.query("delete from public.mesa_sessions where id = any($1)", [[sessionId, otherSessionId]]);
    },
  };
}

const config: MoveContractConfig = {
  createEnvironment: async () => {
    if (!url) return null;
    const name = dbName(url);
    if (!name || !/^(postgres|postgresql):\/\//.test(url)) {
      throw new Error("MESA_LOCAL_TEST_DATABASE_URL recusada: use um banco PostgreSQL local marcado como descartável");
    }
    const pool = new Pool(poolConfig(url));
    await pool.query("select id from public.mesa_attack_resolutions limit 1");
    return {
      label: `PostgreSQL local (${name})`,
      commitMove: (input) => new LocalPostgresMoveResolutionStore(pool).commitMove(input),
      createFixture: () => fixture(pool),
      readActor: async (id) => (await pool.query("select * from public.mesa_combatants where id=$1", [id])).rows[0],
      readResolution: async (item) => (await pool.query("select * from public.mesa_attack_resolutions where session_id=$1 and combat_id=$2 and resolution_id=$3", [item.sessionId, item.combatId, item.resolutionId])).rows[0],
      close: () => pool.end(),
    };
  },
  pending: () => "MESA_LOCAL_TEST_DATABASE_URL ausente: contrato de movimento local não executado",
};

moveResolutionContractSuite(config);
