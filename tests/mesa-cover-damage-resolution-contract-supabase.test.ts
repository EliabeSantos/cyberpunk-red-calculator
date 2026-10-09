/** Alvo Supabase remoto do contrato real de dano à cobertura. */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ResolutionCommit } from "../src/lib/mesa/infrastructure.ts";
import { SupabaseResolutionStore } from "../src/lib/mesa/supabaseInfrastructure.ts";
import {
  coverDamageResolutionContractSuite,
  type CoverDamageContractConfig,
  type CoverDamageFixture,
} from "./contract/coverDamageResolutionContractSuite.ts";

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

async function createFixture(client: SupabaseClient): Promise<CoverDamageFixture> {
  const sessionId = randomUUID();
  const otherSessionId = randomUUID();
  const combatId = randomUUID();
  const otherCombatId = randomUUID();
  const actorId = randomUUID();
  const resolutionId = `contract-cover:${randomUUID()}`;

  const sessions = await client.from("mesa_sessions").insert([
    { id: sessionId, name: "Cover contract A", status: "active", join_code: joinCode(), tactical_map: tacticalMap },
    { id: otherSessionId, name: "Cover contract B", status: "active", join_code: joinCode(), tactical_map: {} },
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
      name: "Cover actor",
      actions_max: 2,
      actions_remaining: 2,
      movement_max: 6,
      movement_remaining: 6,
      hp_current: 20,
      hp_max: 20,
      is_dead: false,
      conditions: [],
      sort_order: 1,
      combat_ammo: { weapon: 3 },
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
      const result = await client.from("mesa_attack_resolutions").select("status,result").eq("session_id", sessionId).eq("combat_id", combatId).eq("resolution_id", resolutionId).single();
      if (result.error) throw new Error(result.error.message);
      return result.data as Record<string, unknown>;
    },
    async readEffects() {
      const actor = await client.from("mesa_combatants").select("actions_remaining,combat_ammo").eq("id", actorId).single();
      const session = await client.from("mesa_sessions").select("tactical_map").eq("id", sessionId).single();
      if (actor.error || session.error) throw new Error(actor.error?.message ?? session.error?.message);
      const map = session.data.tactical_map as { geometry: { walls: Array<{ id: string; coverHP: number; destroyed: boolean }> } };
      const wall = map.geometry.walls.find((item) => item.id === "wall-contract")!;
      return { actions_remaining: actor.data.actions_remaining, ammo: actor.data.combat_ammo, cover_hp: wall.coverHP, destroyed: wall.destroyed };
    },
    async cleanup() {
      const result = await client.from("mesa_sessions").delete().in("id", [sessionId, otherSessionId]);
      if (result.error) throw new Error(result.error.message);
    },
  };
}

const config: CoverDamageContractConfig = {
  createEnvironment: async () => {
    if (!supabaseUrl || !serviceRoleKey) return null;
    const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const schema = await client.from("mesa_sessions").select("tactical_map").limit(1);
    if (schema.error) throw new Error(`Supabase sem o schema de Cover: ${schema.error.message}`);
    const store = new SupabaseResolutionStore(client);
    return {
      claim: (key) => store.claimAttack<Record<string, unknown>>(key),
      release: (input) => store.releaseAttack(input),
      commit: (input) => store.commitCoverDamage<Record<string, unknown>>(input),
      createFixture: () => createFixture(client),
    };
  },
  pending: () => "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes: contrato de Cover não executado contra Supabase",
};

coverDamageResolutionContractSuite(config);
