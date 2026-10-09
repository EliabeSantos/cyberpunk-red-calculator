import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { SupabaseResolutionStore } from "../src/lib/mesa/supabaseInfrastructure.ts";
import { resolutionClaimContractSuite, type ResolutionClaimContractConfig, type ResolutionFamily, type ResolutionFixture } from "./contract/resolutionClaimContractSuite.ts";

try { process.loadEnvFile(".env"); } catch { /* alvo fica skipado */ }
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

function code(): string { return randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase(); }

async function createFixture(client: SupabaseClient, family: ResolutionFamily): Promise<ResolutionFixture> {
  const sessionId = randomUUID();
  const otherSessionId = randomUUID();
  const combatId = randomUUID();
  const otherCombatId = randomUUID();
  const actorId = randomUUID();
  const targetId = randomUUID();
  const claimToken = randomUUID();
  const resolutionId = `contract-${family}:${randomUUID()}`;
  const table = family === "attack" ? "mesa_attack_resolutions" : "mesa_reload_resolutions";
  const { error: sessionError } = await client.from("mesa_sessions").insert([
    { id: sessionId, name: "Resolution A", status: "active", join_code: code() },
    { id: otherSessionId, name: "Resolution B", status: "active", join_code: code() },
  ]);
  if (sessionError) throw new Error(sessionError.message);
  try {
    const { error: combatError } = await client.from("mesa_combats").insert([
      { id: combatId, session_id: sessionId, status: "active" },
      { id: otherCombatId, session_id: otherSessionId, status: "active" },
    ]);
    if (combatError) throw new Error(combatError.message);
    const { error: actorError } = await client.from("mesa_combatants").insert([
      { id: actorId, combat_id: combatId, session_id: sessionId, kind: "character", name: "Actor", actions_max: 2, actions_remaining: 2, movement_max: 6, movement_remaining: 6, hp_current: 10, hp_max: 10, is_dead: false, combat_ammo: { weapon: 1 }, supplies: { inventory: [] } },
      { id: targetId, combat_id: combatId, session_id: sessionId, kind: "enemy", name: "Target", actions_max: 2, actions_remaining: 2, movement_max: 6, movement_remaining: 6, hp_current: 10, hp_max: 10, is_dead: false, combat_ammo: { weapon: 1 }, supplies: { inventory: [] } },
    ]);
    if (actorError) throw new Error(actorError.message);
    if (family === "reload") {
      const { error } = await client.from("mesa_combats").update({ active_combatant_id: actorId }).eq("id", combatId);
      if (error) throw new Error(error.message);
    }
    const { error: resolutionError } = await client.from(table).insert({ session_id: sessionId, combat_id: combatId, resolution_id: resolutionId, claim_token: claimToken, status: "processing" });
    if (resolutionError) throw new Error(resolutionError.message);
    await client.from(table).delete().eq("session_id", sessionId).eq("combat_id", combatId).eq("resolution_id", resolutionId);
  } catch (error) {
    await client.from("mesa_sessions").delete().in("id", [sessionId, otherSessionId]);
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
      p_target_dead_before: false, p_target_patch: { hp_current: 5, is_dead: false }, p_result: { family, applied: true }, p_event_text: null,
    } : {
      p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: resolutionId, p_claim_token: token,
      p_actor_id: actorId, p_weapon_id: "weapon", p_magazine: 2, p_actions_before: 2, p_actions_after: 1,
      p_ammo_before: { weapon: 1 }, p_ammo_after: { weapon: 2 }, p_supplies_before: { inventory: [] }, p_supplies_after: { inventory: [] }, p_result: { family, applied: true }, p_event_text: null,
    },
  });
  return {
    family, key, claimToken, commitInput,
    async abandonClaim() { const result = await client.from(table).update({ updated_at: new Date(Date.now() - 31_000).toISOString() }).eq("session_id", sessionId).eq("combat_id", combatId).eq("resolution_id", resolutionId); if (result.error) throw new Error(result.error.message); },
    async readResolution() { const result = await client.from(table).select("*").eq("session_id", sessionId).eq("combat_id", combatId).eq("resolution_id", resolutionId).single(); if (result.error) throw new Error(result.error.message); return result.data as Record<string, unknown>; },
    async readEffects() { const actor = await client.from("mesa_combatants").select("actions_remaining,combat_ammo,hp_current").eq("id", actorId).single(); const target = await client.from("mesa_combatants").select("hp_current").eq("id", targetId).single(); if (actor.error || target.error) throw new Error(actor.error?.message ?? target.error?.message); return family === "attack" ? { actions_remaining: actor.data.actions_remaining, hp_current: target.data.hp_current } : { actions_remaining: actor.data.actions_remaining, combat_ammo: actor.data.combat_ammo }; },
    async cleanup() { await client.from("mesa_sessions").delete().in("id", [sessionId, otherSessionId]); },
  };
}

const config: ResolutionClaimContractConfig = {
  createEnvironment: async () => {
    if (!url || !key) return null;
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await client.from("mesa_attack_resolutions").select("id").limit(1);
    if (error) throw new Error(`alvo Supabase indisponível: ${error.message}`);
    const store = new SupabaseResolutionStore(client);
    return {
      label: "Supabase remoto",
      claim: (family, item) => family === "attack" ? store.claimAttack<Record<string, unknown>>(item) : store.claimReload<Record<string, unknown>>(item),
      recover: (family, item) => family === "attack" ? store.recoverAttack<Record<string, unknown>>(item) : store.recoverReload<Record<string, unknown>>(item),
      release: (family, item) => family === "attack" ? store.releaseAttack(item) : store.releaseReload(item),
      commit: (family, input) => family === "attack" ? store.commitAttack<Record<string, unknown>>(input) : store.commitReload<Record<string, unknown>>(input),
      createFixture: (family) => createFixture(client, family),
    };
  },
  pending: () => "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes: contratos de claims remotos não executados",
};

resolutionClaimContractSuite(config);
