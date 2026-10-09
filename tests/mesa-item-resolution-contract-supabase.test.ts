/** Alvo Supabase remoto da suíte compartilhada de consumo/cura por item. */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { ResolutionCommit } from "../src/lib/mesa/infrastructure.ts";
import { SupabaseResolutionStore } from "../src/lib/mesa/supabaseInfrastructure.ts";
import {
  itemResolutionContractSuite,
  type ItemResolutionContractConfig,
  type ItemResolutionFixture,
  type ItemResolutionKind,
} from "./contract/itemResolutionContractSuite.ts";

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

async function createFixture(client: SupabaseClient, kind: ItemResolutionKind): Promise<ItemResolutionFixture> {
  const sessionId = randomUUID();
  const otherSessionId = randomUUID();
  const combatId = randomUUID();
  const otherCombatId = randomUUID();
  const actorId = randomUUID();
  const resolutionId = `contract-item-${kind}:${randomUUID()}`;
  const suppliesBefore = { inventory: [{ item: "Medkit", itemId: "medkit", quantity: 1 }] };
  const suppliesAfter = { inventory: [] };

  const sessions = await client.from("mesa_sessions").insert([
    { id: sessionId, name: "Item contract A", status: "active", join_code: joinCode() },
    { id: otherSessionId, name: "Item contract B", status: "active", join_code: joinCode() },
  ]);
  if (sessions.error) throw new Error(sessions.error.message);
  try {
    const combats = await client.from("mesa_combats").insert([
      { id: combatId, session_id: sessionId, status: "active", active_combatant_id: actorId, initiative_started: true, event_log: [] },
      { id: otherCombatId, session_id: otherSessionId, status: "active", initiative_started: false, event_log: [] },
    ]);
    if (combats.error) throw new Error(combats.error.message);
    const combatants = await client.from("mesa_combatants").insert({
      id: actorId,
      combat_id: combatId,
      session_id: sessionId,
      kind: "character",
      name: "Item actor",
      actions_max: 2,
      actions_remaining: 2,
      movement_max: 6,
      movement_remaining: 6,
      hp_current: 10,
      hp_max: 20,
      is_dead: false,
      conditions: [],
      sort_order: 1,
      supplies: suppliesBefore,
    });
    if (combatants.error) throw new Error(combatants.error.message);
  } catch (error) {
    await client.from("mesa_sessions").delete().in("id", [sessionId, otherSessionId]);
    throw error;
  }

  const key = { sessionId, combatId, resolutionId };
  const commitInput = (
    token: string,
    overrides: Record<string, unknown> = {},
  ): ResolutionCommit<Record<string, unknown>> => {
    const rpcArgs = kind === "consume"
      ? {
        p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: resolutionId,
        p_claim_token: token, p_actor_id: actorId, p_actions_before: 2, p_actions_after: 1,
        p_supplies_before: suppliesBefore, p_supplies_after: suppliesAfter,
        p_item_name: "Medkit", p_amount: 1, p_result: { kind, committed: true }, p_event_text: null,
      }
      : {
        p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: resolutionId,
        p_claim_token: token, p_actor_id: actorId, p_actions_before: 2, p_actions_after: 1,
        p_supplies_before: suppliesBefore, p_supplies_after: suppliesAfter,
        p_hp_before: 10, p_hp_after: 15, p_item_name: "Medkit", p_amount: 5,
        p_result: { kind, committed: true }, p_event_text: null,
      };
    return { ...key, claimToken: token, rpcArgs: { ...rpcArgs, ...overrides } };
  };

  return {
    key,
    claimToken: "",
    commitInput,
    async readResolution() {
      const result = await client
        .from("mesa_item_consume_resolutions")
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
        .select("actions_remaining,supplies,hp_current")
        .eq("id", actorId)
        .single();
      if (result.error) throw new Error(result.error.message);
      const row = result.data as { actions_remaining: number; supplies: { inventory?: Array<{ quantity?: number }> }; hp_current: number };
      return {
        actions_remaining: row.actions_remaining,
        inventory_quantity: row.supplies.inventory?.[0]?.quantity ?? 0,
        hp_current: row.hp_current,
      };
    },
    async cleanup() {
      const result = await client.from("mesa_sessions").delete().in("id", [sessionId, otherSessionId]);
      if (result.error) throw new Error(result.error.message);
    },
  };
}

const config: ItemResolutionContractConfig = {
  createEnvironment: async () => {
    if (!supabaseUrl || !serviceRoleKey) return null;
    const client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const schema = await client.from("mesa_item_consume_resolutions").select("id").limit(1);
    if (schema.error) throw new Error(`Supabase sem o schema da Mesa: ${schema.error.message}`);
    const store = new SupabaseResolutionStore(client);
    return {
      claim: (key) => store.claimItemConsume<Record<string, unknown>>(key),
      release: (input) => store.releaseItemConsume(input),
      commit: (kind, input) => kind === "consume"
        ? store.commitItemConsume<Record<string, unknown>>(input)
        : store.commitItemHeal<Record<string, unknown>>(input),
      createFixture: (kind) => createFixture(client, kind),
    };
  },
  pending: () => "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes: contrato de itens não executado contra Supabase",
};

itemResolutionContractSuite(config);
