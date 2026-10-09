/** Alvo Supabase remoto do contrato real de Death Save. */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ResolutionCommit } from "../src/lib/mesa/infrastructure.ts";
import { SupabaseResolutionStore } from "../src/lib/mesa/supabaseInfrastructure.ts";
import {
  deathSaveResolutionContractSuite,
  type DeathSaveContractConfig,
  type DeathSaveFixture,
} from "./contract/deathSaveResolutionContractSuite.ts";

try {
  process.loadEnvFile(".env");
} catch {
  // Credenciais ausentes deixam o alvo explicitamente skipado.
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function joinCode(): string {
  return randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase();
}

async function createFixture(client: SupabaseClient): Promise<DeathSaveFixture> {
  const sessionId = randomUUID();
  const otherSessionId = randomUUID();
  const combatId = randomUUID();
  const otherCombatId = randomUUID();
  const actorId = randomUUID();
  const resolutionId = `contract-death-save:${randomUUID()}`;

  const sessions = await client.from("mesa_sessions").insert([
    { id: sessionId, name: "Death Save A", status: "active", join_code: joinCode() },
    { id: otherSessionId, name: "Death Save B", status: "active", join_code: joinCode() },
  ]);
  if (sessions.error) throw new Error(sessions.error.message);
  try {
    const combats = await client.from("mesa_combats").insert([
      { id: combatId, session_id: sessionId, status: "active", active_combatant_id: actorId, initiative_started: true, event_log: [] },
      { id: otherCombatId, session_id: otherSessionId, status: "active", initiative_started: false, event_log: [] },
    ]);
    if (combats.error) throw new Error(combats.error.message);
    const combatant = await client.from("mesa_combatants").insert({
      id: actorId,
      combat_id: combatId,
      session_id: sessionId,
      kind: "character",
      name: "Death Save actor",
      actions_max: 2,
      actions_remaining: 2,
      movement_max: 6,
      movement_remaining: 6,
      hp_current: 0,
      hp_max: 40,
      is_dead: false,
      conditions: [],
      sort_order: 1,
      death_save_dc: 10,
      death_save_failures: 0,
      netrunner_state: { isJackedIn: false },
    });
    if (combatant.error) throw new Error(combatant.error.message);
  } catch (error) {
    await client.from("mesa_sessions").delete().in("id", [sessionId, otherSessionId]);
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
      const result = await client
        .from("mesa_attack_resolutions")
        .select("status,result")
        .eq("session_id", sessionId)
        .eq("combat_id", combatId)
        .eq("resolution_id", resolutionId)
        .single();
      if (result.error) throw new Error(result.error.message);
      return result.data as Record<string, unknown>;
    },
    async readEffects() {
      const result = await client
        .from("mesa_combatants")
        .select("death_save_dc,death_save_failures,is_dead,hp_current")
        .eq("id", actorId)
        .single();
      if (result.error) throw new Error(result.error.message);
      return result.data as Record<string, unknown>;
    },
    async cleanup() {
      const result = await client.from("mesa_sessions").delete().in("id", [sessionId, otherSessionId]);
      if (result.error) throw new Error(result.error.message);
    },
  };
}

const config: DeathSaveContractConfig = {
  createEnvironment: async () => {
    if (!supabaseUrl || !serviceRoleKey) return null;
    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const schema = await client.from("mesa_combatants").select("death_save_dc").limit(1);
    if (schema.error) throw new Error(`Supabase sem o schema de Death Save: ${schema.error.message}`);
    const store = new SupabaseResolutionStore(client);
    return {
      claim: (key) => store.claimAttack<Record<string, unknown>>(key),
      release: (input) => store.releaseAttack(input),
      commit: (input) => store.commitDeathSave<Record<string, unknown>>(input),
      createFixture: () => createFixture(client),
    };
  },
  pending: () => "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes: contrato de Death Save não executado contra Supabase",
};

deathSaveResolutionContractSuite(config);
