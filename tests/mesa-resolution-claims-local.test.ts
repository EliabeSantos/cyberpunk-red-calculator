import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import { LocalPostgresResolutionStore } from "../src/lib/mesa/localPostgresInfrastructure.ts";
import { resolutionClaimContractSuite, type ResolutionClaimContractConfig, type ResolutionFamily, type ResolutionFixture } from "./contract/resolutionClaimContractSuite.ts";

const url = process.env.MESA_LOCAL_TEST_DATABASE_URL;

function databaseName(value: string): string | null {
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

function code(): string { return randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase(); }

async function createFixture(pool: Pool, family: ResolutionFamily): Promise<ResolutionFixture> {
  const sessionId = randomUUID();
  const otherSessionId = randomUUID();
  const combatId = randomUUID();
  const otherCombatId = randomUUID();
  const actorId = randomUUID();
  const targetId = randomUUID();
  const claimToken = randomUUID();
  const resolutionId = `contract-${family}:${randomUUID()}`;
  const table = family === "attack" ? "mesa_attack_resolutions" : "mesa_reload_resolutions";

  await pool.query(
    "insert into public.mesa_sessions (id,name,status,join_code) values ($1,'Resolution A','active',$3),($2,'Resolution B','active',$4)",
    [sessionId, otherSessionId, code(), code()],
  );
  try {
    await pool.query("insert into public.mesa_combats (id,session_id,status) values ($1,$3,'active'),($2,$4,'active')", [combatId, otherCombatId, sessionId, otherSessionId]);
    await pool.query(
      `insert into public.mesa_combatants
       (id,combat_id,session_id,kind,name,actions_max,actions_remaining,movement_max,movement_remaining,hp_current,hp_max,is_dead,combat_ammo,supplies)
       values ($1,$2,$3,'character','Actor',2,2,6,6,10,10,false,$4::jsonb,$5::jsonb),
              ($6,$2,$3,'enemy','Target',2,2,6,6,10,10,false,$4::jsonb,$5::jsonb)`,
      [actorId, combatId, sessionId, JSON.stringify({ weapon: 1 }), JSON.stringify({ inventory: [] }), targetId],
    );
    if (family === "reload") {
      await pool.query("update public.mesa_combats set active_combatant_id=$1 where id=$2", [actorId, combatId]);
    }
    await pool.query(
      `insert into public.${table} (session_id,combat_id,resolution_id,claim_token,status)
       values ($1,$2,$3,$4,'processing')`,
      [sessionId, combatId, resolutionId, claimToken],
    );
    // O caso de claim inicial precisa começar sem linha; removemos a linha
    // criada apenas para reservar a chave/fixture e cada adapter a recria.
    await pool.query(`delete from public.${table} where session_id=$1 and combat_id=$2 and resolution_id=$3`, [sessionId, combatId, resolutionId]);
  } catch (error) {
    await pool.query("delete from public.mesa_sessions where id=any($1)", [[sessionId, otherSessionId]]);
    throw error;
  }

  const key = { sessionId, combatId, resolutionId };
  const commitInput = (token: string) => ({
    ...key,
    claimToken: token,
    rpcArgs: family === "attack" ? {
      p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: resolutionId, p_claim_token: token,
      p_actor_id: actorId, p_target_id: targetId, p_actions_before: 2, p_actions_after: 1,
      p_ammo_before: { weapon: 1 }, p_ammo_after: { weapon: 0 }, p_target_hp_before: 10,
      p_target_dead_before: false, p_target_patch: { hp_current: 5, is_dead: false },
      p_result: { family, applied: true }, p_event_text: null,
    } : {
      p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: resolutionId, p_claim_token: token,
      p_actor_id: actorId, p_weapon_id: "weapon", p_magazine: 2, p_actions_before: 2, p_actions_after: 1,
      p_ammo_before: { weapon: 1 }, p_ammo_after: { weapon: 2 }, p_supplies_before: { inventory: [] },
      p_supplies_after: { inventory: [] }, p_result: { family, applied: true }, p_event_text: null,
    },
  });

  return {
    family,
    key,
    claimToken,
    commitInput,
    async abandonClaim() { await pool.query(`update public.${table} set updated_at=now()-interval '31 seconds' where session_id=$1 and combat_id=$2 and resolution_id=$3`, [sessionId, combatId, resolutionId]); },
    async readResolution() { return (await pool.query(`select * from public.${table} where session_id=$1 and combat_id=$2 and resolution_id=$3`, [sessionId, combatId, resolutionId])).rows[0]; },
    async readEffects() {
      const actor = (await pool.query("select actions_remaining,combat_ammo,hp_current from public.mesa_combatants where id=$1", [actorId])).rows[0];
      const target = (await pool.query("select hp_current from public.mesa_combatants where id=$1", [targetId])).rows[0];
      return family === "attack" ? { actions_remaining: actor.actions_remaining, hp_current: target.hp_current } : { actions_remaining: actor.actions_remaining, combat_ammo: actor.combat_ammo };
    },
    async cleanup() { await pool.query("delete from public.mesa_sessions where id=any($1)", [[sessionId, otherSessionId]]); },
  };
}

const config: ResolutionClaimContractConfig = {
  createEnvironment: async () => {
    if (!url) return null;
    const name = databaseName(url);
    if (!name) throw new Error("MESA_LOCAL_TEST_DATABASE_URL recusada: banco não marcado como descartável");
    const pool = new Pool(poolConfig(url));
    await pool.query("select id from public.mesa_attack_resolutions limit 1");
    const store = new LocalPostgresResolutionStore(pool);
    return {
      label: `PostgreSQL local (${name})`,
      claim: (family, key) => family === "attack" ? store.claimAttack<Record<string, unknown>>(key) : store.claimReload<Record<string, unknown>>(key),
      recover: (family, key) => family === "attack" ? store.recoverAttack<Record<string, unknown>>(key) : store.recoverReload<Record<string, unknown>>(key),
      release: (family, key) => family === "attack" ? store.releaseAttack(key) : store.releaseReload(key),
      commit: (family, input) => family === "attack" ? store.commitAttack<Record<string, unknown>>(input) : store.commitReload<Record<string, unknown>>(input),
      createFixture: (family) => createFixture(pool, family),
      close: () => pool.end(),
    };
  },
  pending: () => "MESA_LOCAL_TEST_DATABASE_URL ausente: contratos de claims locais não executados",
};

resolutionClaimContractSuite(config);
