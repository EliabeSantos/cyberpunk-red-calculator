import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { SupabaseResolutionStore } from "../src/lib/mesa/supabaseInfrastructure.ts";
import { moveResolutionContractSuite, type MoveContractConfig, type MoveFixture } from "./contract/moveResolutionContractSuite.ts";

try { process.loadEnvFile(".env"); } catch { /* alvo será skipado */ }
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

function code(): string { return randomUUID().replace(/-/g, '').slice(0, 5).toUpperCase(); }

async function fixture(client: SupabaseClient): Promise<MoveFixture> {
  const sessionId = randomUUID();
  const otherSessionId = randomUUID();
  const combatId = randomUUID();
  const otherCombatId = randomUUID();
  const actorId = randomUUID();
  const claimToken = randomUUID();
  const resolutionId = `contract-move:${randomUUID()}`;
  const { error: sessionsError } = await client.from("mesa_sessions").insert([
    { id: sessionId, name: "Move A", status: "active", join_code: code() },
    { id: otherSessionId, name: "Move B", status: "active", join_code: code() },
  ]);
  if (sessionsError) throw new Error(sessionsError.message);
  try {
    const { error: combatError } = await client.from("mesa_combats").insert([
      { id: combatId, session_id: sessionId, status: "active" },
      { id: otherCombatId, session_id: otherSessionId, status: "active" },
    ]);
    if (combatError) throw new Error(combatError.message);
    const { error: actorError } = await client.from("mesa_combatants").insert({
      id: actorId, combat_id: combatId, session_id: sessionId, kind: "character", name: "Mover",
      actions_max: 2, actions_remaining: 2, movement_max: 6, movement_remaining: 6,
      hp_current: 10, hp_max: 10, is_dead: false, position: { x: 0.2, y: 0.5 },
    });
    if (actorError) throw new Error(actorError.message);
    const { error: resolutionError } = await client.from("mesa_attack_resolutions").insert({
      session_id: sessionId, combat_id: combatId, resolution_id: resolutionId,
      claim_token: claimToken, status: "processing",
    });
    if (resolutionError) throw new Error(resolutionError.message);
  } catch (error) {
    await client.from("mesa_sessions").delete().in("id", [sessionId, otherSessionId]);
    throw error;
  }
  return {
    sessionId, combatId, otherSessionId, otherCombatId, actorId, claimToken, resolutionId,
    async cleanup() { await client.from("mesa_sessions").delete().in("id", [sessionId, otherSessionId]); },
  };
}

const config: MoveContractConfig = {
  createEnvironment: async () => {
    if (!url || !key) return null;
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await client.from("mesa_attack_resolutions").select("id").limit(1);
    if (error) throw new Error(`alvo Supabase indisponível: ${error.message}`);
    const store = new SupabaseResolutionStore(client);
    return {
      label: "Supabase remoto",
      commitMove: (input) => store.commitMove(input),
      createFixture: () => fixture(client),
      readActor: async (id) => { const result = await client.from("mesa_combatants").select("*").eq("id", id).single(); if (result.error) throw new Error(result.error.message); return result.data as Record<string, unknown>; },
      readResolution: async (item) => { const result = await client.from("mesa_attack_resolutions").select("*").eq("session_id", item.sessionId).eq("combat_id", item.combatId).eq("resolution_id", item.resolutionId).single(); if (result.error) throw new Error(result.error.message); return result.data as Record<string, unknown>; },
    };
  },
  pending: () => "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes: contrato de movimento remoto não executado",
};

moveResolutionContractSuite(config);
