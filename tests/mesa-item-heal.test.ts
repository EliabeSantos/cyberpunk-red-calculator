/**
 * F1.13.2 — uso ATÔMICO de item de cura: POST /combat/item-heal.
 *
 * A cadeia inteira acontece numa ÚNICA resolução/transação:
 *
 *   validar → consumir → calcular cura → aplicar HP → evento → commit
 *
 * Mesmo padrão das outras suítes Postgres (montagem real no Supabase +
 * chamada direta à route handler). Sem .env → suíte inteira skip.
 */
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { resolveSupplyItemId } from "../src/data/supplyItems.ts";

try {
  process.loadEnvFile(".env");
} catch {
  // sem credenciais a suíte fica explicitamente skip
}

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const db: SupabaseClient | null = configured
  ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  : null;

const sessionId = randomUUID();
const combatId = randomUUID();
const playerParticipantId = randomUUID();
const gmParticipantId = randomUUID();
const healerActorId = randomUUID();
const otherActorId = randomUUID();
const combatantIds = [healerActorId, otherActorId];

const playerToken = `player-${randomUUID()}-token`;
const gmToken = `gm-${randomUUID()}-token`;

const postgresTest = configured ? test : test.skip;

type InventoryEntry = { item: string; quantity: number; itemId?: string };
type Supplies = { inventory: InventoryEntry[] };

function snapshot(id: string, hpCurrent = 10) {
  return {
    id,
    type: "character",
    name: "Healer",
    source: { characterId: null, sourceKey: null, enemyId: null },
    stats: { REF: 100, DEX: 0 },
    skills: { handgun: { stat: "REF", level: 10 }, evasion: { stat: "DEX", level: 0 } },
    weapons: [{ id: "w-1", name: "Pistol", damage: "20d6", skill: "handgun", attackType: "handgun", magazine: 8, ammo: 8 }],
    combat: { hp: { current: hpCurrent, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false },
  };
}

async function postHeal(
  token: string | undefined,
  body: Record<string, unknown>,
  sessionIdOverride?: string,
): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const { POST } = await import("../src/app/api/mesa/[id]/combat/item-heal/route.ts");
  const response = await POST(
    new Request("http://localhost/api/mesa/session/combat/item-heal", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-mesa-token": token } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: sessionIdOverride ?? sessionId }) },
  );
  return { response, payload: (await response.json()) as Record<string, unknown> };
}

/** Estado atual do curandeiro, lido DIRETO do banco (nunca do payload). */
async function healerState() {
  const { data, error } = await db!
    .from("mesa_combatants")
    .select("hp_current, hp_max, actions_remaining, supplies")
    .eq("id", healerActorId)
    .single();
  assert.ifError(error);
  const row = data as { hp_current: number; hp_max: number; actions_remaining: number; supplies: Supplies };
  return {
    hp: row.hp_current,
    hpMax: row.hp_max,
    actions: row.actions_remaining,
    inventory: row.supplies?.inventory ?? ([] as InventoryEntry[]),
    // A leitura usa o MESMO resolvedor do servidor: entradas legadas (sem
    // `itemId`) continuam localizáveis pelo id derivado do nome.
    qty: (itemId: string) =>
      (row.supplies?.inventory ?? []).find((entry) => resolveSupplyItemId(entry) === itemId)?.quantity ?? 0,
  };
}

/** Reseta o cenário: HP, Actions e mochila (entradas LEGADAS, sem `itemId`). */
async function seedHealer(input: { hp: number; actions?: number; inventory: InventoryEntry[] }) {
  await db!.from("mesa_combatants").update({
    hp_current: input.hp,
    hp_max: 20,
    actions_remaining: input.actions ?? 2,
    is_dead: false,
    supplies: { weaponId: "w-1", ammo: 8, magazine: 8, inventory: input.inventory },
  }).eq("id", healerActorId);
}

async function eventLog(): Promise<string[]> {
  const { data } = await db!.from("mesa_combats").select("event_log").eq("id", combatId).single();
  return ((data?.event_log ?? []) as Array<{ text: string }>).map((entry) => entry.text);
}

postgresTest("setup", async () => {
  const { error: e1 } = await db!.from("mesa_sessions").insert({
    id: sessionId, name: "F1.13.2 item heal", gm_id: gmParticipantId, status: "active",
    join_code: `H${sessionId.slice(0, 4).toUpperCase()}`,
  });
  assert.ifError(e1);
  const { error: e2 } = await db!.from("mesa_participants").insert([
    { id: playerParticipantId, session_id: sessionId, player_token: playerToken, display_name: "Player", character_id: null, role: "player" },
    { id: gmParticipantId, session_id: sessionId, player_token: gmToken, display_name: "GM", character_id: null, role: "gm" },
  ]);
  assert.ifError(e2);
  const { error: e3 } = await db!.from("mesa_combats").insert({
    id: combatId, session_id: sessionId, status: "active", round: 1,
    active_combatant_id: healerActorId, initiative_started: true, event_log: [],
  });
  assert.ifError(e3);

  for (const id of combatantIds) {
    const { error } = await db!.from("mesa_combatants").insert({
      id, combat_id: combatId, session_id: sessionId, kind: "character",
      participant_id: id === healerActorId ? playerParticipantId : null,
      name: id === healerActorId ? "Healer" : "Other",
      actions_max: 2, actions_remaining: 2, movement_max: 6, movement_remaining: 6,
      hp_current: 10, hp_max: 20, is_dead: false, conditions: [],
      combat_snapshot: snapshot(id), combat_ammo: { "w-1": 8 }, combat_armor: { head: 0, body: 0 },
      critical_injuries: [],
      supplies: { inventory: [{ item: "Stim", quantity: 2 }] },
    } as never);
    assert.ifError(error);
  }
  await seedHealer({ hp: 10, inventory: [{ item: "Stim", quantity: 2 }] });
});

postgresTest("1. item válido → consumo + cura + Action no MESMO commit", async () => {
  await seedHealer({ hp: 10, inventory: [{ item: "Stim", quantity: 2 }] });
  const before = await eventLog();

  const { response, payload } = await postHeal(playerToken, {
    resolutionId: randomUUID(), actorCombatantId: healerActorId, itemId: "stim",
  });
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.committed, true, "resolução commitada");
  assert.equal(payload.itemId, "stim");
  assert.equal(payload.itemName, "Stim");
  assert.equal(payload.hpBefore, 10);
  assert.equal(payload.hpAfter, 15, "Stim devolve 5 HP (regra existente)");
  assert.equal(payload.hpMax, 20);
  assert.equal(payload.restored, 5);
  assert.equal(payload.quantityBefore, 2);
  assert.equal(payload.quantityAfter, 1);
  assert.equal(payload.actionsBefore, 2);
  assert.equal(payload.actionsAfter, 1);

  const state = await healerState();
  assert.equal(state.hp, 15, "HP aplicado");
  assert.equal(state.qty("stim"), 1, "uma unidade consumida");
  assert.equal(state.actions, 1, "1 Action debitada");

  // Os três efeitos vêm JUNTOS: um único evento novo para uma única transação.
  const added = (await eventLog()).slice(before.length);
  assert.equal(added.length, 1, `exatamente um evento: ${JSON.stringify(added)}`);
});

postgresTest("2. segundo item de cura do sistema é aceito (mesma regra, outro valor)", async () => {
  await seedHealer({ hp: 5, inventory: [{ item: "MaxDoc", quantity: 1 }] });
  const { payload } = await postHeal(playerToken, {
    resolutionId: randomUUID(), actorCombatantId: healerActorId, itemId: "maxdoc",
  });
  assert.equal(payload.itemName, "MaxDoc");
  assert.equal(payload.hpAfter, 15, "MaxDoc devolve 10 HP (regra existente)");
  assert.equal(payload.restored, 10);
  const state = await healerState();
  assert.equal(state.hp, 15);
  assert.equal(state.qty("maxdoc"), 0, "única unidade consumida e a entrada sai da mochila");
  assert.equal(state.actions, 1);
});

postgresTest("3. item inexistente → 400 item_not_found; nada muda", async () => {
  await seedHealer({ hp: 10, inventory: [{ item: "Stim", quantity: 2 }] });
  const { response, payload } = await postHeal(playerToken, {
    resolutionId: randomUUID(), actorCombatantId: healerActorId, itemId: "elixir",
  });
  assert.equal(response.status, 400);
  assert.equal(payload.code, "item_not_found");
  const state = await healerState();
  assert.equal(state.hp, 10, "HP preservado");
  assert.equal(state.qty("stim"), 2, "item preservado");
  assert.equal(state.actions, 2, "Action preservada");
});

postgresTest("4. item sem quantidade → 400 insufficient_quantity", async () => {
  await seedHealer({ hp: 10, inventory: [{ item: "Stim", quantity: 0 }] });
  const { response, payload } = await postHeal(playerToken, {
    resolutionId: randomUUID(), actorCombatantId: healerActorId, itemId: "stim",
  });
  assert.equal(response.status, 400);
  assert.equal(payload.code, "insufficient_quantity");
  const state = await healerState();
  assert.equal(state.hp, 10, "HP preservado");
  assert.equal(state.actions, 2, "Action preservada");
});

postgresTest("5. item não utilizável (não restaura HP) → 400 item_not_healing", async () => {
  // Basic Medkit é GEAR de Primeiros Socorros (+2 no teste), não restaura HP;
  // munição também não. Nenhum dos dois vira regra de cura nova aqui.
  await seedHealer({ hp: 10, inventory: [
    { item: "Basic Medkit", quantity: 1 },
    { item: "Pistol Ammunition", quantity: 16 },
  ] });
  for (const itemId of ["basic_medkit", "pistol_ammo"]) {
    const { response, payload } = await postHeal(playerToken, {
      resolutionId: randomUUID(), actorCombatantId: healerActorId, itemId,
    });
    assert.equal(response.status, 400, itemId);
    assert.equal(payload.code, "item_not_healing", itemId);
  }
  const state = await healerState();
  assert.equal(state.hp, 10, "HP preservado");
  assert.equal(state.qty("basic_medkit"), 1, "item preservado");
  assert.equal(state.qty("pistol_ammo"), 16, "munição preservada");
  assert.equal(state.actions, 2, "Action preservada");
});

postgresTest("6. HP nunca ultrapassa maxHP (e no teto não há o que curar)", async () => {
  // 18/20 + 5 do Stim → exatamente o teto.
  await seedHealer({ hp: 18, inventory: [{ item: "Stim", quantity: 2 }] });
  const { payload } = await postHeal(playerToken, {
    resolutionId: randomUUID(), actorCombatantId: healerActorId, itemId: "stim",
  });
  assert.equal(payload.hpAfter, 20, "limitado a hpMax");
  assert.equal(payload.restored, 2, "só o que faltava");
  assert.equal((await healerState()).hp, 20);

  // Já no teto: recusa (mesma lógica do uso de item pelo GM) e não gasta nada.
  await seedHealer({ hp: 20, inventory: [{ item: "Stim", quantity: 1 }] });
  const refused = await postHeal(playerToken, {
    resolutionId: randomUUID(), actorCombatantId: healerActorId, itemId: "stim",
  });
  assert.equal(refused.response.status, 409);
  assert.equal(refused.payload.code, "already_full_hp");
  const state = await healerState();
  assert.equal(state.qty("stim"), 1, "item preservado");
  assert.equal(state.actions, 2, "Action preservada");
});

postgresTest("7. falha de CURA (CAS do HP divergente) → item e Action preservados", async () => {
  await seedHealer({ hp: 10, inventory: [{ item: "Stim", quantity: 2 }] });
  const rid = randomUUID();
  const claim = await db!.rpc("claim_mesa_item_consume_resolution", {
    p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: rid,
  });
  assert.ifError(claim.error);
  const claimRow = (claim.data as Array<{ claimed: boolean; claim_token: string }>)[0];
  assert.equal(claimRow?.claimed, true);

  // A mochila é passada EXATAMENTE como está no banco (entrada legada, sem
  // `itemId`): o único campo divergente é o HP.
  const supplies = { inventory: [{ item: "Stim", quantity: 2 }] };
  const { error } = await db!.rpc("commit_mesa_item_heal_resolution", {
    p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: rid,
    p_claim_token: claimRow.claim_token, p_actor_id: healerActorId,
    p_actions_before: 2, p_actions_after: 1,
    p_supplies_before: supplies, p_supplies_after: { inventory: [{ item: "Stim", quantity: 1 }] },
    p_hp_before: 99, // divergente: o HP mudou entre leitura e commit
    p_hp_after: 99 + 5,
    p_item_name: "Stim", p_amount: 5,
    p_result: { nota: "não deve persistir" },
    p_event_text: "ISTO NAO DEVE APARECER",
  });
  assert.ok(error && /consumption_conflict/.test(error.message), `esperava consumption_conflict; veio: ${error?.message ?? "sem erro"}`);

  const state = await healerState();
  assert.equal(state.hp, 10, "HP preservado");
  assert.equal(state.qty("stim"), 2, "item preservado");
  assert.equal(state.actions, 2, "Action preservada");
  assert.ok(!(await eventLog()).some((text) => /ISTO NAO DEVE APARECER/.test(text)), "evento não publicado");

  const res = await db!.from("mesa_item_consume_resolutions").select("status").eq("resolution_id", rid).single();
  assert.equal(res.data?.status, "processing", "resolução não ficou committed");
});

postgresTest("8. falha de CONSUMO (CAS da mochila divergente) → HP preservado", async () => {
  await seedHealer({ hp: 10, inventory: [{ item: "Stim", quantity: 2 }] });
  const rid = randomUUID();
  const claim = await db!.rpc("claim_mesa_item_consume_resolution", {
    p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: rid,
  });
  assert.ifError(claim.error);
  const claimRow = (claim.data as Array<{ claimed: boolean; claim_token: string }>)[0];
  assert.equal(claimRow?.claimed, true);

  const { error } = await db!.rpc("commit_mesa_item_heal_resolution", {
    p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: rid,
    p_claim_token: claimRow.claim_token, p_actor_id: healerActorId,
    p_actions_before: 2, p_actions_after: 1,
    p_supplies_before: { inventory: [{ item: "Stim", quantity: 99, itemId: "stim" }] }, // divergente
    p_supplies_after: { inventory: [{ item: "Stim", quantity: 98, itemId: "stim" }] },
    p_hp_before: 10, p_hp_after: 15,
    p_item_name: "Stim", p_amount: 5,
    p_result: { nota: "não deve persistir" },
    p_event_text: "ISTO NAO DEVE APARECER",
  });
  assert.ok(error && /consumption_conflict/.test(error.message), `esperava consumption_conflict; veio: ${error?.message ?? "sem erro"}`);

  const state = await healerState();
  assert.equal(state.hp, 10, "HP preservado");
  assert.equal(state.qty("stim"), 2, "item preservado");
  assert.equal(state.actions, 2, "Action preservada");
  assert.ok(!(await eventLog()).some((text) => /ISTO NAO DEVE APARECER/.test(text)), "evento não publicado");
});

postgresTest("9. retry idempotente → não cura nem debita duas vezes", async () => {
  await seedHealer({ hp: 10, inventory: [{ item: "Stim", quantity: 2 }] });
  const rid = randomUUID();

  const first = await postHeal(playerToken, { resolutionId: rid, actorCombatantId: healerActorId, itemId: "stim" });
  assert.equal(first.response.status, 200);
  assert.equal(first.payload.committed, true);

  const second = await postHeal(playerToken, { resolutionId: rid, actorCombatantId: healerActorId, itemId: "stim" });
  assert.equal(second.response.status, 200);
  assert.equal(second.payload.committed, false, "replay não reexecuta");
  assert.equal(second.payload.hpAfter, 15, "devolve o resultado gravado");

  const state = await healerState();
  assert.equal(state.hp, 15, "curou UMA vez");
  assert.equal(state.qty("stim"), 1, "consumiu UMA vez");
  assert.equal(state.actions, 1, "debitou UMA Action");
});

postgresTest("10. dois requests concorrentes → no máximo um commit", async () => {
  await seedHealer({ hp: 10, inventory: [{ item: "Stim", quantity: 1 }] });
  const body = { actorCombatantId: healerActorId, itemId: "stim" };
  const [a, b] = await Promise.all([
    postHeal(playerToken, { resolutionId: randomUUID(), ...body }),
    postHeal(playerToken, { resolutionId: randomUUID(), ...body }),
  ]);
  const committed = [a, b].filter((entry) => entry.response.status === 200 && entry.payload.committed === true);
  assert.equal(committed.length, 1, `exatamente um commit; respostas: ${JSON.stringify([a.payload, b.payload])}`);

  const state = await healerState();
  assert.equal(state.qty("stim"), 0, "só uma unidade (e ela saiu da mochila)");
  assert.equal(state.hp, 15, "curou uma vez só");
  assert.equal(state.actions, 1, "debitou uma Action só");
});

postgresTest("11. evento publicado com ator, item e resultado da cura", async () => {
  await seedHealer({ hp: 10, inventory: [{ item: "Stim", quantity: 2 }] });
  const before = (await eventLog()).length;
  await postHeal(playerToken, { resolutionId: randomUUID(), actorCombatantId: healerActorId, itemId: "stim" });
  const log = await eventLog();
  const last = log[log.length - 1];
  assert.ok(log.length > before, "evento novo no registro");
  assert.ok(/usou Stim/.test(last), `evento cita o item: ${last}`);
  assert.ok(/\+5 HP/.test(last), `evento cita a cura: ${last}`);
  assert.ok(/15\/20/.test(last), `evento cita o HP final: ${last}`);
  assert.ok(/1 restante/.test(last), `evento cita o estoque restante: ${last}`);
});

postgresTest("12. stable item ID: o RÓTULO não localiza a entrada, o id sim", async () => {
  await seedHealer({ hp: 10, inventory: [{ item: "Stim", quantity: 2 }] });
  const byLabel = await postHeal(playerToken, {
    resolutionId: randomUUID(), actorCombatantId: healerActorId, itemId: "Stim",
  });
  assert.equal(byLabel.response.status, 400);
  assert.equal(byLabel.payload.code, "item_not_found");
  assert.equal((await healerState()).hp, 10, "nada mudou");

  const byId = await postHeal(playerToken, {
    resolutionId: randomUUID(), actorCombatantId: healerActorId, itemId: "stim",
  });
  assert.equal(byId.response.status, 200);
  assert.equal(byId.payload.itemId, "stim");
  const entry = (await healerState()).inventory.find((item) => item.itemId === "stim");
  assert.ok(entry, "id estável persistido na escrita");
  assert.equal(entry?.item, "Stim", "rótulo continua sendo só apresentação");
});

postgresTest("13. cliente não manda estado final → 400 client_authority_forbidden", async () => {
  await seedHealer({ hp: 10, inventory: [{ item: "Stim", quantity: 2 }] });
  for (const extra of [{ hpAfter: 40 }, { supplies: { inventory: [] } }, { quantityAfter: 0 }, { restored: 99 }]) {
    const { response, payload } = await postHeal(playerToken, {
      resolutionId: randomUUID(), actorCombatantId: healerActorId, itemId: "stim", ...extra,
    });
    assert.equal(response.status, 400, JSON.stringify(extra));
    assert.equal(payload.code, "client_authority_forbidden", JSON.stringify(extra));
  }
  const state = await healerState();
  assert.equal(state.hp, 10);
  assert.equal(state.qty("stim"), 2);
  assert.equal(state.actions, 2);
});

postgresTest("14. sessão inválida → 404; combatente de outro → 403", async () => {
  const wrongSession = await postHeal(playerToken, {
    resolutionId: randomUUID(), actorCombatantId: healerActorId, itemId: "stim",
  }, randomUUID());
  assert.equal(wrongSession.response.status, 404);

  const notOwned = await postHeal(playerToken, {
    resolutionId: randomUUID(), actorCombatantId: otherActorId, itemId: "stim",
  });
  assert.equal(notOwned.response.status, 403);
  assert.equal(notOwned.payload.code, "combatant_not_owned");
});

postgresTest("15. inventário legado migrado corretamente pela migration", async () => {
  // Espelho do que `20261010000000_mesa_supply_item_ids.sql` faz nas linhas já
  // gravadas: id em tudo, pilhas do mesmo item somadas, lixo descartado.
  const { data, error } = await db!.rpc("normalize_mesa_supplies", {
    p_supplies: {
      weaponId: "w-1", ammo: 8, magazine: 8,
      inventory: [
        { item: "Stim", quantity: 2 },
        { item: "  stim ", quantity: 3 },
        { item: "Pistol Ammunition", quantity: 16 },
        { item: "Trauma Patch", quantity: 1 },
        { item: "Medkit", quantity: 0 },
        { item: "", quantity: 4 },
      ],
    },
  });
  assert.ifError(error);
  const supplies = data as { weaponId: string; ammo: number; magazine: number; inventory: InventoryEntry[] };
  assert.equal(supplies.weaponId, "w-1", "resto da mochila intacto");
  assert.equal(supplies.ammo, 8);
  assert.equal(supplies.magazine, 8);
  assert.deepEqual(
    supplies.inventory.map((entry) => [entry.itemId, entry.item, entry.quantity]),
    [
      ["stim", "Stim", 5],
      ["pistol_ammo", "Pistol Ammunition", 16],
      ["trauma_patch", "Trauma Patch", 1],
    ],
    "id estável em tudo + pilhas somadas + qty 0 descartada",
  );
});

after(async () => {
  if (!db) return;
  await db.from("mesa_item_consume_resolutions").delete().in("session_id", [sessionId]);
  await db.from("mesa_combatants").delete().in("id", combatantIds);
  await db.from("mesa_combats").delete().eq("id", combatId);
  await db.from("mesa_participants").delete().in("id", [playerParticipantId, gmParticipantId]);
  await db.from("mesa_sessions").delete().eq("id", sessionId);
});
