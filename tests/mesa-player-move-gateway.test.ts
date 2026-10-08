/** F1.14.3 — movimento do Player no Postgres real, por metros ou coordenadas. */
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveAction, applyAction } from "../src/lib/combatEngine.ts";
import { moveMesa, MesaApiError } from "../src/lib/mesa/client.ts";
import { createEmptyCharacter } from "../src/types/character.ts";

try { process.loadEnvFile(".env"); } catch { /* Sem credenciais → skip. */ }
const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const db: SupabaseClient | null = configured
  ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  : null;
const postgresTest = configured ? test : test.skip;
const sessionId = randomUUID();
const combatId = randomUUID();
const gmId = randomUUID();
const playerId = randomUUID();
const otherId = randomUUID();
const actorId = randomUUID();
const outsiderId = randomUUID();
const enemyId = randomUUID();
const gmToken = `gm-${randomUUID()}-token`;
const playerToken = `player-${randomUUID()}-token`;
const otherToken = `other-${randomUUID()}-token`;
const intent = (distance: number, actorCombatantId = actorId, resolutionId = randomUUID()) =>
  ({ resolutionId, actorCombatantId, distance });

async function post(token: string | undefined, body: Record<string, unknown>) {
  const { POST } = await import("../src/app/api/mesa/[id]/combat/move/route.ts");
  const response = await POST(new Request("http://localhost/api/mesa/session/combat/move", {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-mesa-token": token } : {}) },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: sessionId }) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

async function budget(id = actorId) {
  const { data, error } = await db!.from("mesa_combatants")
    .select("movement_remaining,actions_remaining").eq("id", id).single();
  assert.ifError(error);
  return data as { movement_remaining: number; actions_remaining: number };
}

async function setCombat(patch: Record<string, unknown>) {
  const { error } = await db!.from("mesa_combats").update(patch).eq("id", combatId);
  assert.ifError(error);
}

postgresTest("setup", async () => {
  const { error: s } = await db!.from("mesa_sessions").insert({
    id: sessionId, name: "Player move gateway", gm_id: gmId, status: "active",
    join_code: sessionId.replace(/-/g, "").slice(0, 5).toUpperCase(),
  });
  assert.ifError(s);
  const { error: p } = await db!.from("mesa_participants").insert([
    { id: gmId, session_id: sessionId, player_token: gmToken, role: "gm", display_name: "GM" },
    { id: playerId, session_id: sessionId, player_token: playerToken, role: "player", display_name: "Player" },
    { id: otherId, session_id: sessionId, player_token: otherToken, role: "player", display_name: "Outro" },
  ]);
  assert.ifError(p);
  const { error: c } = await db!.from("mesa_combats").insert({
    id: combatId, session_id: sessionId, status: "active", round: 1,
    active_combatant_id: actorId, initiative_started: true, event_log: [],
  });
  assert.ifError(c);
  for (const id of [actorId, outsiderId, enemyId]) {
    const { error } = await db!.from("mesa_combatants").insert({
      id, combat_id: combatId, session_id: sessionId,
      kind: id === enemyId ? "enemy" : "character", name: id.slice(0, 8),
      participant_id: id === actorId || id === enemyId ? playerId : otherId,
      actions_max: 2, actions_remaining: 0, movement_max: 12, movement_remaining: 12,
      hp_current: 20, hp_max: 20, is_dead: false, conditions: [],
    });
    assert.ifError(error);
  }
});

postgresTest("trajetória bloqueada é rejeitada pelo servidor para Player e GM sem débito", async () => {
  const { error: mapError } = await db!.from("mesa_sessions").update({ tactical_map: {
    imageUrl: "", enabled: true, width: 1000, height: 600, pixelsPerMeter: 50,
    geometry: {
      walls: [{ id: "gateway-wall", type: "wall", start: { x: 0.5, y: 0.2 }, end: { x: 0.5, y: 0.8 }, thickness: 0.02 }],
      doors: [],
    },
  } }).eq("id", sessionId);
  assert.ifError(mapError);
  const { error: positionError } = await db!.from("mesa_combatants").update({ position: { x: 0.1, y: 0.5 } }).in("id", [actorId, enemyId]);
  assert.ifError(positionError);
  const beforePlayer = await budget(actorId);
  const beforeEnemy = await budget(enemyId);
  const targetPosition = { x: 0.9, y: 0.5 };

  const player = await post(playerToken, { resolutionId: randomUUID(), actorCombatantId: actorId, targetPosition });
  assert.equal(player.status, 409, JSON.stringify(player.body));
  assert.equal(player.body.code, "movement_blocked");
  const gm = await post(gmToken, { resolutionId: randomUUID(), actorCombatantId: enemyId, targetPosition });
  assert.equal(gm.status, 409, JSON.stringify(gm.body));
  assert.equal(gm.body.code, "movement_blocked");
  assert.deepEqual(await budget(actorId), beforePlayer);
  assert.deepEqual(await budget(enemyId), beforeEnemy);

  const { error: restoreError } = await db!.from("mesa_sessions").update({ tactical_map: {} }).eq("id", sessionId);
  assert.ifError(restoreError);
});

postgresTest("1/8/10/13: move 0 Action; replay não move de novo; estado normal da Mesa", async () => {
  const body = intent(4);
  const first = await post(playerToken, body);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.movementRemaining, 8);
  assert.equal(first.body.actionsRemaining, 0, "movimento custa ZERO Action mesmo com 0 restantes");
  assert.equal(first.body.committed, true);
  assert.deepEqual(await budget(), { movement_remaining: 8, actions_remaining: 0 });
  const again = await post(playerToken, body);
  assert.equal(again.status, 200);
  assert.equal(again.body.committed, false);
  assert.equal(again.body.movementRemaining, 8);
  assert.deepEqual(await budget(), { movement_remaining: 8, actions_remaining: 0 });
  const changed = await post(playerToken, { ...body, distance: 2 });
  assert.equal(changed.body.code, "resolution_conflict", "mesmo id não autoriza outra intenção");
  const stranger = await post(otherToken, body);
  assert.equal(stranger.body.code, "combatant_not_owned", "replay não vaza resultado a outro Player");

  const { GET } = await import("../src/app/api/mesa/[id]/route.ts");
  const response = await GET(new Request("http://localhost/api/mesa/session", {
    headers: { "x-mesa-token": playerToken },
  }), { params: Promise.resolve({ id: sessionId }) });
  const payload = await response.json() as { state: { combatants: Array<{ id: string; movementRemaining: number; actionsRemaining: number }> } };
  const me = payload.state.combatants.find((entry) => entry.id === actorId);
  assert.equal(me?.movementRemaining, 8);
  assert.equal(me?.actionsRemaining, 0);
});

postgresTest("2/15: não controla outro; GM usa ação legada, não gateway Player", async () => {
  const other = await post(playerToken, intent(1, outsiderId));
  assert.equal(other.status, 403);
  assert.equal(other.body.code, "combatant_not_owned");
  assert.equal((await budget(outsiderId)).movement_remaining, 12);
  const gm = await post(gmToken, intent(1));
  assert.equal(gm.status, 403);
  assert.equal(gm.body.code, "player_only");
});

postgresTest("3/4/5: fora do turno, combate inativo e sessão finished", async () => {
  const noToken = await post(undefined, intent(1));
  assert.equal(noToken.status, 401);
  assert.equal(noToken.body.code, "missing_token");
  await setCombat({ initiative_started: false });
  const pending = await post(playerToken, intent(1));
  assert.equal(pending.body.code, "initiative_not_started");
  await setCombat({ initiative_started: true });
  await setCombat({ active_combatant_id: outsiderId });
  const turn = await post(playerToken, intent(1));
  assert.equal(turn.body.code, "not_your_turn");
  await setCombat({ active_combatant_id: actorId, status: "finished" });
  const stopped = await post(playerToken, intent(1));
  assert.equal(stopped.body.code, "combat_not_active");
  await setCombat({ status: "active" });
  const { error } = await db!.from("mesa_sessions").update({ status: "finished" }).eq("id", sessionId);
  assert.ifError(error);
  const finished = await post(playerToken, intent(1));
  assert.equal(finished.status, 410);
  assert.equal(finished.body.code, "session_finished");
  const restored = await db!.from("mesa_sessions").update({ status: "active" }).eq("id", sessionId);
  assert.ifError(restored.error);
  assert.equal((await budget()).movement_remaining, 8);
});

postgresTest("6/7/9: distância inválida/excessiva e estado derivado recusados", async () => {
  for (const distance of [0, -1, 1.5, "2", null, 9999999999999999]) {
    const refused = await post(playerToken, { ...intent(1), distance });
    assert.equal(refused.status, 400, JSON.stringify(refused.body));
    assert.equal(refused.body.code, "invalid_distance");
  }
  const excess = await post(playerToken, intent(9));
  assert.equal(excess.body.code, "movement_exhausted");
  for (const extra of [{ position: { x: 1 } }, { movementRemaining: 12 }, { actionsRemaining: 2 },
    { hp: 99 }, { armor: 0 }, { initiative: 10 }, { activeCombatant: actorId }, { isValid: true },
    { round: 2 }, { turn: 2 }]) {
    const refused = await post(playerToken, { ...intent(1), ...extra });
    assert.equal(refused.status, 400, JSON.stringify(extra));
    assert.equal(refused.body.code, "client_authority_forbidden");
  }
  assert.equal((await budget()).movement_remaining, 8);
});

postgresTest("11: concorrência: somente um CAS vence no mesmo orçamento", async () => {
  const [a, b] = await Promise.all([post(playerToken, intent(6)), post(playerToken, intent(6))]);
  assert.equal([a, b].filter((entry) => entry.status === 200 && entry.body.committed).length, 1,
    JSON.stringify([a, b]));
  assert.equal([a, b].filter((entry) => entry.body.code === "movement_conflict" || entry.body.code === "movement_exhausted").length, 1);
  assert.deepEqual(await budget(), { movement_remaining: 2, actions_remaining: 0 });
});

postgresTest("concorrência com mesma resolutionId aplica exatamente uma vez", async () => {
  const body = intent(1);
  const [a, b] = await Promise.all([post(playerToken, body), post(playerToken, body)]);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.deepEqual([a.body.committed, b.body.committed].sort(), [false, true]);
  assert.equal((await budget()).movement_remaining, 1);
});

postgresTest("personagem derrotado e inimigo não se movimentam pelo gateway", async () => {
  const { error } = await db!.from("mesa_combatants").update({ is_dead: true }).eq("id", actorId);
  assert.ifError(error);
  const dead = await post(playerToken, intent(1));
  assert.equal(dead.body.code, "combatant_defeated");
  const restored = await db!.from("mesa_combatants").update({ is_dead: false }).eq("id", actorId);
  assert.ifError(restored.error);
  await setCombat({ active_combatant_id: enemyId });
  const enemy = await post(playerToken, intent(1, enemyId));
  assert.equal(enemy.body.code, "not_a_player");
  await setCombat({ active_combatant_id: actorId });
  assert.equal((await budget()).movement_remaining, 1);
});

postgresTest("Player não pode contornar o gateway pelo /combat/action; GM mantém fluxo legado", async () => {
  const { POST } = await import("../src/app/api/mesa/[id]/combat/action/route.ts");
  async function legacy(token: string) {
    const response = await POST(new Request("http://localhost/api/mesa/session/combat/action", {
      method: "POST", headers: { "content-type": "application/json", "x-mesa-token": token },
      body: JSON.stringify({ combatantId: actorId, actionType: "move", meters: 1 }),
    }), { params: Promise.resolve({ id: sessionId }) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  }
  const player = await legacy(playerToken);
  assert.equal(player.status, 403);
  assert.equal(player.body.code, "move_gateway_required");
  assert.equal((await budget()).movement_remaining, 1);
  const gm = await legacy(gmToken);
  assert.equal(gm.status, 200, JSON.stringify(gm.body));
  assert.equal((await budget()).movement_remaining, 0, "GM não foi afetado");
});

test("14: sem Mesa, resolveAction/applyAction conservam movimento local e custo 0", () => {
  const economy = { actionsMax: 2, actionsRemaining: 0, movementMax: 12, movementRemaining: 12 };
  assert.deepEqual(resolveAction({
    combatStatus: "active", initiativeStarted: true, activeCombatantId: actorId,
    actorRole: "player", actorOwnsCombatant: true,
    combatant: { id: actorId, isDead: false, ...economy }, actionType: "move", meters: 3,
  }), { ok: true, cost: 0 });
  assert.deepEqual(applyAction(economy, "move", 3), { ...economy, movementRemaining: 9 });
});

test("12: falha do gateway não muta ficha/estado local nem envia valores finais", async () => {
  const character = createEmptyCharacter("local-unchanged");
  const before = structuredClone(character);
  const original = globalThis.fetch;
  let sent: Record<string, unknown> = {};
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(String(options?.body)) as Record<string, unknown>;
    return Response.json({ ok: false, code: "not_your_turn", error: "Aguarde seu turno." }, { status: 403 });
  };
  try {
    await assert.rejects(moveMesa({ sessionId: "session", actorCombatantId: "mine", distance: 2 }),
      (error: unknown) => error instanceof MesaApiError && error.code === "not_your_turn");
    assert.deepEqual(Object.keys(sent).sort(), ["actorCombatantId", "distance", "resolutionId"].sort());
    assert.deepEqual(character, before, "nenhuma mutação/rollback local necessária");
  } finally {
    globalThis.fetch = original;
  }
});

after(async () => {
  if (!db) return;
  await db.from("mesa_attack_resolutions").delete().eq("session_id", sessionId);
  await db.from("mesa_combatants").delete().in("id", [actorId, outsiderId, enemyId]);
  await db.from("mesa_combats").delete().eq("id", combatId);
  await db.from("mesa_participants").delete().in("id", [gmId, playerId, otherId]);
  await db.from("mesa_sessions").delete().eq("id", sessionId);
});
