/**
 * F1.13.1 — Player Inventory Authority: POST /combat/item-consume.
 *
 * F1.13.2 — o `itemId` passou a ser o IDENTIFICADOR ESTÁVEL (`medkit`,
 * `first_aid`…), nunca o rótulo exibido; as entradas legadas (sem `itemId`)
 * continuam localizáveis porque o servidor deriva o mesmo id do nome.
 *
 * Segue o mesmo padrão de mesa-attack-http-postgres.test.ts:
 * montagem real no Supabase + chamada direta à route handler.
 * Sem .env → suite inteira skip.
 */
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
const playerActorId = randomUUID();
const gmActorId = randomUUID();
const otherActorId = randomUUID();
const combatantIds = [playerActorId, gmActorId, otherActorId];

const playerToken = `player-${randomUUID()}-token`;
const gmToken = `gm-${randomUUID()}-token`;

const postgresTest = configured ? test : test.skip;

function snapshot(id: string, kind: "character" | "enemy", supplies?: Record<string, unknown>) {
  return {
    id,
    type: kind,
    name: kind === "character" ? "Actor" : "Enemy",
    source: { characterId: null, sourceKey: null, enemyId: null },
    stats: { REF: 100, DEX: 0 },
    skills: { handgun: { stat: "REF", level: 10 }, evasion: { stat: "DEX", level: 0 } },
    weapons: kind === "character" ? [{ id: "w-1", name: "Pistol", damage: "20d6", skill: "handgun", attackType: "handgun", magazine: 8, ammo: 8 }] : [],
    combat: { hp: { current: 20, max: 20 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false },
    ...(supplies ? { supplies } : {}),
  };
}

async function postConsume(
  token: string | undefined,
  body: Record<string, unknown>,
): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const { POST } = await import("../src/app/api/mesa/[id]/combat/item-consume/route.ts");
  const response = await POST(
    new Request("http://localhost/api/mesa/session/combat/item-consume", {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { "x-mesa-token": token } : {}) },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: sessionId }) },
  );
  return { response, payload: (await response.json()) as Record<string, unknown> };
}

async function insertCombatant(
  id: string,
  participantId: string | null,
  s: ReturnType<typeof snapshot>,
  actions = 2,
  supplies?: Record<string, unknown>,
) {
  const row = {
    id, combat_id: combatId, session_id: sessionId, kind: s.type, participant_id: participantId,
    name: s.name, actions_max: 2, actions_remaining: actions, movement_max: 6, movement_remaining: 6,
    hp_current: 20, hp_max: 20, is_dead: false, conditions: [],
    combat_snapshot: s, combat_ammo: { "w-1": 8 },
    ...(supplies ? { supplies } : {}),
    combat_armor: { head: 0, body: 0 }, critical_injuries: [],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await db!.from("mesa_combatants").insert(row as any);
  assert.ifError(error);
}

postgresTest("setup", async () => {
  const { error: e1 } = await db!.from("mesa_sessions").insert({
    id: sessionId, name: "F1.13.1 item consume", gm_id: gmParticipantId, status: "active",
    join_code: `T${sessionId.slice(0, 4).toUpperCase()}`,
  });
  assert.ifError(e1);
  const { error: e2 } = await db!.from("mesa_participants").insert([
    { id: playerParticipantId, session_id: sessionId, player_token: playerToken, display_name: "Player", character_id: null, role: "player" },
    { id: gmParticipantId, session_id: sessionId, player_token: gmToken, display_name: "GM", character_id: null, role: "gm" },
  ]);
  assert.ifError(e2);
  const { error: e3 } = await db!.from("mesa_combats").insert({
    id: combatId, session_id: sessionId, status: "active", round: 1,
    active_combatant_id: playerActorId, initiative_started: true, event_log: [],
  });
  assert.ifError(e3);

  await insertCombatant(playerActorId, playerParticipantId, snapshot(playerActorId, "character"), 2, {
    weaponId: "w-1", ammo: 8, magazine: 8,
    inventory: [{ item: "Medkit", quantity: 2 }, { item: "First Aid", quantity: 1 }],
  });
  await insertCombatant(gmActorId, null, snapshot(gmActorId, "character"), 2);
  await insertCombatant(otherActorId, null, snapshot(otherActorId, "character"), 2, {
    inventory: [{ item: "Medkit", quantity: 5 }],
  });
});

postgresTest("1. consumo válido → committed, quantidade reduz, action debitada", async () => {
  const { response, payload } = await postConsume(playerToken, {
    resolutionId: randomUUID(), actorCombatantId: playerActorId, itemId: "medkit", amount: 1,
  });
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.committed, true);
  assert.equal(payload.itemName, "Medkit");
  assert.equal(payload.itemId, "medkit", "id estável devolvido (catálogo/slug, nunca o rótulo)");
  assert.equal(payload.quantityBefore, 2);
  assert.equal(payload.quantityAfter, 1);
  assert.equal(payload.consumed, 1);
  assert.equal(payload.actionsBefore, 2);
  assert.equal(payload.actionsAfter, 1);
  const row = await db!.from("mesa_combatants").select("supplies,actions_remaining").eq("id", playerActorId).single();
  const inv = (row.data?.supplies as { inventory: Array<{ item: string; quantity: number; itemId?: string }> })?.inventory ?? [];
  assert.equal(inv.find((i) => i.item === "Medkit")?.quantity, 1);
  assert.equal(inv.find((i) => i.item === "Medkit")?.itemId, "medkit", "entrada legada ganhou o id estável na escrita");
  assert.equal(row.data?.actions_remaining, 1);
});

postgresTest("2. item inexistente → 400 item_not_found (e o RÓTULO não vale como id)", async () => {
  const missing = await postConsume(playerToken, {
    resolutionId: randomUUID(), actorCombatantId: playerActorId, itemId: "elixir", amount: 1,
  });
  assert.equal(missing.response.status, 400);
  assert.equal(missing.payload.code, "item_not_found");
  // F1.13.2 — identidade é o `itemId` ESTÁVEL, não o nome exibido: mandar o
  // rótulo ("Medkit") já não localiza a entrada.
  const byLabel = await postConsume(playerToken, {
    resolutionId: randomUUID(), actorCombatantId: playerActorId, itemId: "Medkit", amount: 1,
  });
  assert.equal(byLabel.response.status, 400);
  assert.equal(byLabel.payload.code, "item_not_found");
});

postgresTest("3. quantidade insuficiente → 400 insufficient_quantity", async () => {
  const { response, payload } = await postConsume(playerToken, {
    resolutionId: randomUUID(), actorCombatantId: playerActorId, itemId: "first_aid", amount: 5,
  });
  assert.equal(response.status, 400);
  assert.equal(payload.code, "insufficient_quantity");
  // nada consumido
  const row = await db!.from("mesa_combatants").select("supplies").eq("id", playerActorId).single();
  const inv = (row.data?.supplies as { inventory: Array<{ item: string; quantity: number }> })?.inventory ?? [];
  assert.equal(inv.find((i) => i.item === "First Aid")?.quantity, 1);
});

postgresTest("4. amount inválido (0 / negativo / não-inteiro) → 400", async () => {
  for (const amount of [0, -1, 1.5, "x"]) {
    const { response, payload } = await postConsume(playerToken, {
      resolutionId: randomUUID(), actorCombatantId: playerActorId, itemId: "medkit", amount,
    });
    assert.equal(response.status, 400, `amount=${String(amount)}`);
    assert.equal(payload.code, "invalid_action", `amount=${String(amount)}`);
  }
});

postgresTest("5. actor inválido → 404 combatant_not_found", async () => {
  const { response, payload } = await postConsume(playerToken, {
    resolutionId: randomUUID(), actorCombatantId: randomUUID(), itemId: "medkit", amount: 1,
  });
  assert.equal(response.status, 404);
  assert.equal(payload.code, "combatant_not_found");
});

postgresTest("6. sessão/combate inválidos → 404 / 409", async () => {
  const { POST } = await import("../src/app/api/mesa/[id]/combat/item-consume/route.ts");
  const r1 = await POST(
    new Request("http://localhost/api/mesa/session/combat/item-consume", { method: "POST", headers: { "content-type": "application/json", "x-mesa-token": playerToken }, body: JSON.stringify({ resolutionId: randomUUID(), actorCombatantId: playerActorId, itemId: "medkit", amount: 1 }) }),
    { params: Promise.resolve({ id: randomUUID() as unknown as string }) },
  );
  assert.equal(r1.status, 404);
});

postgresTest("7. player tentando consumir item de outro combatant → 403 combatant_not_owned", async () => {
  const { response, payload } = await postConsume(playerToken, {
    resolutionId: randomUUID(), actorCombatantId: otherActorId, itemId: "medkit", amount: 1,
  });
  assert.equal(response.status, 403);
  assert.equal(payload.code, "combatant_not_owned");
});

postgresTest("8. retry com mesmo resolutionId → idempotente", async () => {
  await db!.from("mesa_combatants").update({ supplies: { inventory: [{ item: "Medkit", quantity: 1 }] }, actions_remaining: 2 }).eq("id", playerActorId);
  const rid = randomUUID();
  const a = await postConsume(playerToken, { resolutionId: rid, actorCombatantId: playerActorId, itemId: "medkit", amount: 1 });
  assert.equal(a.response.status, 200);
  assert.equal(a.payload.committed, true);
  const b = await postConsume(playerToken, { resolutionId: rid, actorCombatantId: playerActorId, itemId: "medkit", amount: 1 });
  assert.equal(b.response.status, 200);
  assert.equal(b.payload.committed, false);
  assert.equal(b.payload.quantityAfter, 0); // só uma vez consumiu
  const row = await db!.from("mesa_combatants").select("supplies,actions_remaining").eq("id", playerActorId).single();
  const inv = (row.data?.supplies as { inventory: Array<{ item: string; quantity: number }> })?.inventory ?? [];
  assert.equal(inv.find((i) => i.item === "Medkit"), undefined, "qty 0 remove a entrada da mochila");
  assert.equal(row.data?.actions_remaining, 1, "uma única Action debitada entre as duas chamadas");
});

postgresTest("9. dois consumos concorrentes não consomem a mesma unidade", async () => {
  // repõe 1 unidade e 2 Actions
  await db!.from("mesa_combatants").update({ supplies: { inventory: [{ item: "Medkit", quantity: 1 }] }, actions_remaining: 2 }).eq("id", playerActorId);
  const ridA = randomUUID();
  const ridB = randomUUID();
  const body = { actorCombatantId: playerActorId, itemId: "medkit", amount: 1 };
  const [a, b] = await Promise.all([
    postConsume(playerToken, { resolutionId: ridA, ...body }),
    postConsume(playerToken, { resolutionId: ridB, ...body }),
  ]);
  // Exatamente UM commita. O outro perde: ou 409 (CAS divergiu entre leitura e
  // commit) ou 400 (leu o estoque já zerado). Nunca os dois.
  const committed = [a, b].filter((x) => x.response.status === 200 && x.payload.committed === true);
  assert.equal(committed.length, 1, `exatamente um commit; respostas: ${JSON.stringify([a.payload, b.payload])}`);
  const row = await db!.from("mesa_combatants").select("supplies,actions_remaining").eq("id", playerActorId).single();
  const inv = (row.data?.supplies as { inventory: Array<{ item: string; quantity: number }> })?.inventory ?? [];
  assert.equal(inv.find((i) => i.item === "Medkit"), undefined, "só uma unidade consumida (e ela saiu da mochila)");
  assert.equal(row.data?.actions_remaining, 1, "só uma Action debitada");
});

postgresTest("10. quantidade restante correta após consumo parcial", async () => {
  await db!.from("mesa_combatants").update({ supplies: { inventory: [{ item: "Medkit", quantity: 3 }] }, actions_remaining: 2 }).eq("id", playerActorId);
  const { payload } = await postConsume(playerToken, { resolutionId: randomUUID(), actorCombatantId: playerActorId, itemId: "medkit", amount: 2 });
  assert.equal(payload.quantityAfter, 1);
});

postgresTest("11. evento publicado corretamente", async () => {
  await db!.from("mesa_combatants").update({ supplies: { inventory: [{ item: "First Aid", quantity: 2 }] }, actions_remaining: 2 }).eq("id", playerActorId);
  const { payload } = await postConsume(playerToken, { resolutionId: randomUUID(), actorCombatantId: playerActorId, itemId: "first_aid", amount: 1 });
  assert.equal(payload.itemName, "First Aid");
  assert.equal(payload.consumed, 1);
  assert.equal(payload.quantityAfter, 1);
  const { data: combat } = await db!.from("mesa_combats").select("event_log").eq("id", combatId).single();
  const log = (combat?.event_log as Array<{ text: string }>) ?? [];
  assert.ok(log.some((e) => /consumiu/.test(e.text) && /First Aid/.test(e.text)), `evento encontrado em: ${JSON.stringify(log)}`);
});

postgresTest("12. commit com CAS divergente → consumption_conflict e nada muda", async () => {
  // Prova a atomicidade na própria RPC: o commit só aplica se `supplies` e
  // `actions_remaining` ainda estiverem exatamente como foram lidos.
  const before = { inventory: [{ item: "Medkit", quantity: 3 }] };
  await db!.from("mesa_combatants").update({ supplies: before, actions_remaining: 2 }).eq("id", playerActorId);

  const rid = randomUUID();
  const claim = await db!.rpc("claim_mesa_item_consume_resolution", {
    p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: rid,
  });
  assert.ifError(claim.error);
  const claimRow = (claim.data as Array<{ claimed: boolean; claim_token: string }>)[0];
  assert.equal(claimRow?.claimed, true);

  // Outra "mão" alterou o estoque entre claim e commit → CAS deve recusar.
  const { error } = await db!.rpc("commit_mesa_item_consume_resolution", {
    p_session_id: sessionId, p_combat_id: combatId, p_resolution_id: rid,
    p_claim_token: claimRow.claim_token, p_actor_id: playerActorId,
    p_actions_before: 2, p_actions_after: 1,
    p_supplies_before: { inventory: [{ item: "Medkit", quantity: 99 }] },
    p_supplies_after: { inventory: [{ item: "Medkit", quantity: 2 }] },
    p_item_name: "Medkit", p_amount: 1,
    p_result: { nota: "não deve persistir" },
    p_event_text: "ISTO NAO DEVE APARECER",
  });
  assert.ok(error && /consumption_conflict/.test(error.message), `esperava consumption_conflict, veio: ${error?.message ?? "nenhum erro"}`);

  const cur = await db!.from("mesa_combatants").select("supplies,actions_remaining").eq("id", playerActorId).single();
  assert.deepEqual(cur.data?.supplies, before, "supplies intactos");
  assert.equal(cur.data?.actions_remaining, 2, "Action não debitada");

  const log = await db!.from("mesa_combats").select("event_log").eq("id", combatId).single();
  assert.ok(!(log.data?.event_log as Array<{ text: string }>).some((e) => /ISTO NAO DEVE APARECER/.test(e.text)), "evento não registrado");

  const res = await db!.from("mesa_item_consume_resolutions").select("status").eq("resolution_id", rid).single();
  assert.equal(res.data?.status, "processing", "resolução não foi marcada como commitada");
});

after(async () => {
  if (!db) return;
  await db.from("mesa_item_consume_resolutions").delete().in("session_id", [sessionId]);
  await db.from("mesa_combatants").delete().in("id", combatantIds);
  await db.from("mesa_combats").delete().eq("id", combatId);
  await db.from("mesa_participants").delete().in("id", [playerParticipantId, gmParticipantId]);
  await db.from("mesa_sessions").delete().eq("id", sessionId);
});
