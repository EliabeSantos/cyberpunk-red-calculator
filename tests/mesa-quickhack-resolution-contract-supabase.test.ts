/** Alvo Supabase remoto do contrato real de Quickhack. */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ResolutionCommit } from "../src/lib/mesa/infrastructure.ts";
import { SupabaseResolutionStore } from "../src/lib/mesa/supabaseInfrastructure.ts";
import {
  quickhackResolutionContractSuite,
  type QuickhackContractConfig,
  type QuickhackFixture,
} from "./contract/quickhackResolutionContractSuite.ts";

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

const actorStateBefore = { isJackedIn: true, netActionsRemaining: 2, meatspaceActionUsedForNetrunning: false };
const actorStateAfter = { ...actorStateBefore, netActionsRemaining: 1, meatspaceActionUsedForNetrunning: true };
const targetSuppliesBefore = { inventory: [{ itemId: "chipware-1", item: "Chipware", quantity: 1 }] };
const targetSuppliesAfter = { inventory: [] };

async function createFixture(client: SupabaseClient): Promise<QuickhackFixture> {
  const sessionId = randomUUID();
  const otherSessionId = randomUUID();
  const combatId = randomUUID();
  const otherCombatId = randomUUID();
  const actorId = randomUUID();
  const targetId = randomUUID();
  const resolutionId = `contract-quickhack:${randomUUID()}`;

  const sessions = await client.from("mesa_sessions").insert([
    { id: sessionId, name: "Quickhack contract A", status: "active", join_code: joinCode() },
    { id: otherSessionId, name: "Quickhack contract B", status: "active", join_code: joinCode() },
  ]);
  if (sessions.error) throw new Error(sessions.error.message);
  try {
    const combats = await client.from("mesa_combats").insert([
      { id: combatId, session_id: sessionId, status: "active", active_combatant_id: actorId, initiative_started: true, event_log: [] },
      { id: otherCombatId, session_id: otherSessionId, status: "active", initiative_started: false, event_log: [] },
    ]);
    if (combats.error) throw new Error(combats.error.message);
    const combatants = await client.from("mesa_combatants").insert([
      { id: actorId, combat_id: combatId, session_id: sessionId, kind: "character", name: "Quickhack actor", actions_max: 2, actions_remaining: 2, movement_max: 6, movement_remaining: 6, hp_current: 20, hp_max: 20, is_dead: false, conditions: [], sort_order: 1, netrunner_state: actorStateBefore, net_effects: [], supplies: {} },
      { id: targetId, combat_id: combatId, session_id: sessionId, kind: "enemy", name: "Quickhack target", actions_max: 2, actions_remaining: 2, movement_max: 6, movement_remaining: 6, hp_current: 20, hp_max: 20, is_dead: false, conditions: [], sort_order: 2, netrunner_state: {}, net_effects: [], supplies: targetSuppliesBefore },
    ]);
    if (combatants.error) throw new Error(combatants.error.message);
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
      const result = await client.from("mesa_attack_resolutions").select("status,result").eq("session_id", sessionId).eq("combat_id", combatId).eq("resolution_id", resolutionId).single();
      if (result.error) throw new Error(result.error.message);
      return result.data as Record<string, unknown>;
    },
    async readEffects() {
      const target = await client.from("mesa_combatants").select("hp_current,is_dead,net_effects,conditions,supplies").eq("id", targetId).single();
      const actor = await client.from("mesa_combatants").select("actions_remaining").eq("id", actorId).single();
      if (target.error || actor.error) throw new Error(target.error?.message ?? actor.error?.message);
      const targetSupplies = target.data.supplies as { inventory?: Array<{ quantity?: number }> };
      return {
        actions_remaining: actor.data.actions_remaining,
        target_hp: target.data.hp_current,
        target_dead: target.data.is_dead,
        target_effect_count: (target.data.net_effects as unknown[]).length,
        target_condition_count: (target.data.conditions as unknown[]).length,
        target_supply_quantity: targetSupplies.inventory?.[0]?.quantity ?? 0,
      };
    },
    async cleanup() {
      const result = await client.from("mesa_sessions").delete().in("id", [sessionId, otherSessionId]);
      if (result.error) throw new Error(result.error.message);
    },
  };
}

const config: QuickhackContractConfig = {
  createEnvironment: async () => {
    if (!supabaseUrl || !serviceRoleKey) return null;
    const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const schema = await client.from("mesa_combatants").select("net_effects,supplies").limit(1);
    if (schema.error) throw new Error(`Supabase sem o schema de Quickhack: ${schema.error.message}`);
    const store = new SupabaseResolutionStore(client);
    return {
      claim: (key) => store.claimAttack<Record<string, unknown>>(key),
      release: (input) => store.releaseAttack(input),
      commit: (input) => store.commitQuickhack<Record<string, unknown>>(input),
      createFixture: () => createFixture(client),
    };
  },
  pending: () => "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes: contrato de Quickhack não executado contra Supabase",
};

quickhackResolutionContractSuite(config);
