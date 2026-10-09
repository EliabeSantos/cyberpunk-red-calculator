/** Alvo Supabase remoto do contrato real de NET Action. */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ResolutionCommit } from "../src/lib/mesa/infrastructure.ts";
import { SupabaseResolutionStore } from "../src/lib/mesa/supabaseInfrastructure.ts";
import {
  netActionResolutionContractSuite,
  type NetActionContractConfig,
  type NetActionFixture,
} from "./contract/netActionResolutionContractSuite.ts";

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

async function createFixture(client: SupabaseClient): Promise<NetActionFixture> {
  const sessionId = randomUUID();
  const otherSessionId = randomUUID();
  const combatId = randomUUID();
  const otherCombatId = randomUUID();
  const actorId = randomUUID();
  const resolutionId = `contract-net-action:${randomUUID()}`;

  const sessions = await client.from("mesa_sessions").insert([
    { id: sessionId, name: "NET contract A", status: "active", join_code: joinCode(), net_architectures: [] },
    { id: otherSessionId, name: "NET contract B", status: "active", join_code: joinCode(), net_architectures: [] },
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
      name: "NET actor",
      actions_max: 2,
      actions_remaining: 2,
      movement_max: 6,
      movement_remaining: 6,
      hp_current: 20,
      hp_max: 20,
      is_dead: false,
      conditions: [],
      sort_order: 1,
      netrunner_state: stateBefore,
      net_discovery: discoveryBefore,
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
      const result = await client.from("mesa_attack_resolutions").select("status,result").eq("session_id", sessionId).eq("combat_id", combatId).eq("resolution_id", resolutionId).single();
      if (result.error) throw new Error(result.error.message);
      return result.data as Record<string, unknown>;
    },
    async readEffects() {
      const actor = await client.from("mesa_combatants").select("actions_remaining,netrunner_state,net_discovery").eq("id", actorId).single();
      const session = await client.from("mesa_sessions").select("net_architectures").eq("id", sessionId).single();
      if (actor.error || session.error) throw new Error(actor.error?.message ?? session.error?.message);
      const actorState = actor.data.netrunner_state as typeof stateAfter;
      const discovery = actor.data.net_discovery as typeof discoveryAfter;
      return {
        actions_remaining: actor.data.actions_remaining,
        net_actions_remaining: actorState.netActionsRemaining,
        meatspace_action_used_for_netrunning: actorState.meatspaceActionUsedForNetrunning,
        discovered_node_ids: discovery.discoveredNodeIds ?? [],
        architecture_count: (session.data.net_architectures as unknown[]).length,
      };
    },
    async cleanup() {
      const result = await client.from("mesa_sessions").delete().in("id", [sessionId, otherSessionId]);
      if (result.error) throw new Error(result.error.message);
    },
  };
}

const config: NetActionContractConfig = {
  createEnvironment: async () => {
    if (!supabaseUrl || !serviceRoleKey) return null;
    const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const schema = await client.from("mesa_combatants").select("netrunner_state,net_discovery").limit(1);
    if (schema.error) throw new Error(`Supabase sem o schema de NET: ${schema.error.message}`);
    const store = new SupabaseResolutionStore(client);
    return {
      claim: (key) => store.claimAttack<Record<string, unknown>>(key),
      release: (input) => store.releaseAttack(input),
      commit: (input) => store.commitNetAction<Record<string, unknown>>(input),
      createFixture: () => createFixture(client),
    };
  },
  pending: () => "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes: contrato de NET não executado contra Supabase",
};

netActionResolutionContractSuite(config);
