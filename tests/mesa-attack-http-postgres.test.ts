import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env");
} catch {
  // Ambiente sem Supabase: a suíte fica explicitamente bloqueada/skipped.
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
const concurrentActorId = randomUUID();
const actionActorId = randomUUID();
const hitTargetId = randomUUID();
const missTargetId = randomUUID();
const concurrentTargetId = randomUUID();
const actionTargetId = randomUUID();
const combatantIds: string[] = [playerActorId, gmActorId, concurrentActorId, actionActorId, hitTargetId, missTargetId, concurrentTargetId, actionTargetId];
const playerToken = `player-${randomUUID()}-token`;
const gmToken = `gm-${randomUUID()}-token`;

const snapshot = (id: string, name: string, kind: "character" | "enemy", target: "hit" | "miss" = "hit") => ({
  id,
  type: kind,
  name,
  source: { characterId: null, sourceKey: null, enemyId: null },
    stats: target === "miss" ? { REF: 1, DEX: 100 } : { REF: 100, DEX: 0 },
  skills: target === "miss"
    ? { handgun: { stat: "REF", level: 0 }, evasion: { stat: "DEX", level: 100 } }
    : { handgun: { stat: "REF", level: 10 }, evasion: { stat: "DEX", level: 0 } },
  weapons: kind === "character"
    ? [{ id: "weapon-http", name: "HTTP Pistol", damage: "20d6", skill: "handgun", attackType: "handgun", magazine: 1, ammo: 1 }]
    : [],
  combat: {
    hp: { current: 20, max: 20 },
    armor: { head: 0, body: 0 },
    criticalInjuries: [],
    conditions: [],
    initiative: null,
    isDead: false,
    ...(kind === "character" ? { deathSave: { dc: 10, failures: 0 } } : {}),
  },
});

const postgresTest = configured ? test : test.skip;

async function postAttack(token: string | undefined, body: Record<string, unknown>): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const { POST } = await import("../src/app/api/mesa/[id]/combat/attack/route.ts");
  const request = new Request("http://localhost/api/mesa/session/combat/attack", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-mesa-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
  const response = await POST(request, { params: Promise.resolve({ id: sessionId }) });
  return { response, payload: (await response.json()) as Record<string, unknown> };
}

async function postReload(token: string | undefined, body: Record<string, unknown>): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const { POST } = await import("../src/app/api/mesa/[id]/combat/reload/route.ts");
  const request = new Request("http://localhost/api/mesa/session/combat/reload", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-mesa-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
  const response = await POST(request, { params: Promise.resolve({ id: sessionId }) });
  return { response, payload: (await response.json()) as Record<string, unknown> };
}

async function getMesaState(token: string): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const { GET } = await import("../src/app/api/mesa/[id]/route.ts");
  const request = new Request("http://localhost/api/mesa/session", {
    headers: { "x-mesa-token": token },
  });
  const response = await GET(request, { params: Promise.resolve({ id: sessionId }) });
  return { response, payload: (await response.json()) as Record<string, unknown> };
}

async function insertCombatant(id: string, participantId: string | null, combatSnapshot: ReturnType<typeof snapshot>, actions = 2, supplies?: Record<string, unknown>): Promise<void> {
  const { error } = await db!.from("mesa_combatants").insert({
    id,
    combat_id: combatId,
    session_id: sessionId,
    kind: combatSnapshot.type,
    participant_id: participantId,
    name: combatSnapshot.name,
    actions_max: 2,
    actions_remaining: actions,
    movement_max: 6,
    movement_remaining: 6,
    hp_current: 20,
    hp_max: 20,
    is_dead: false,
    conditions: [],
    sort_order: combatantIds.indexOf(id),
    combat_snapshot: combatSnapshot,
    combat_ammo: { "weapon-http": 1 },
    ...(supplies ? { supplies } : {}),
    combat_armor: { head: 0, body: 0 },
    critical_injuries: [],
  });
  assert.ifError(error);
}

async function row(id: string): Promise<Record<string, unknown>> {
  const { data, error } = await db!.from("mesa_combatants").select("actions_remaining,combat_ammo,hp_current,is_dead,combat_armor,critical_injuries").eq("id", id).single();
  if (error || !data) throw error ?? new Error("combatant not found");
  return data as Record<string, unknown>;
}

postgresTest("POST /combat/attack atravessa autorização, Engine, commit e retry reais", async () => {
  const { error: sessionError } = await db!.from("mesa_sessions").insert({
    id: sessionId,
    name: "E2E HTTP Attack",
    gm_id: gmParticipantId,
    status: "active",
    join_code: `H${sessionId.slice(0, 4).toUpperCase()}`,
  });
  assert.ifError(sessionError);
  const { error: participantError } = await db!.from("mesa_participants").insert([
    { id: playerParticipantId, session_id: sessionId, player_token: playerToken, display_name: "HTTP Player", character_id: null, role: "player" },
    { id: gmParticipantId, session_id: sessionId, player_token: gmToken, display_name: "HTTP GM", character_id: null, role: "gm" },
  ]);
  assert.ifError(participantError);
  const { error: combatError } = await db!.from("mesa_combats").insert({
    id: combatId,
    session_id: sessionId,
    status: "active",
    round: 1,
    active_combatant_id: playerActorId,
    initiative_started: true,
    event_log: [],
  });
  assert.ifError(combatError);

  await insertCombatant(playerActorId, playerParticipantId, snapshot(playerActorId, "Player Actor", "character"), 2, {
    inventory: [{ item: "Pistol Ammunition", quantity: 2 }],
  });
  await insertCombatant(gmActorId, null, snapshot(gmActorId, "GM Actor", "character"));
  await insertCombatant(concurrentActorId, null, snapshot(concurrentActorId, "Concurrent Actor", "character"));
  await insertCombatant(actionActorId, playerParticipantId, snapshot(actionActorId, "Action Actor", "character"), 1);
  await insertCombatant(hitTargetId, null, snapshot(hitTargetId, "Hit Target", "character"));
  await insertCombatant(missTargetId, null, snapshot(missTargetId, "Miss Target", "enemy", "miss"));
  await insertCombatant(concurrentTargetId, null, snapshot(concurrentTargetId, "Concurrent Target", "enemy"));
  await insertCombatant(actionTargetId, null, snapshot(actionTargetId, "Action Target", "enemy"));

  const hitBody = {
    resolutionId: `http-hit-${randomUUID()}`,
    actorId: playerActorId,
    targetId: hitTargetId,
    weaponId: "weapon-http",
    skillId: "handgun",
    attackType: "handgun",
    attackMode: "aimed",
    aimedTarget: "head",
    // Tentativas de tampering: o endpoint deve ignorá-las.
    roll: { total: 999 },
    total: 999,
    defenseValue: 0,
    damage: 999,
    rawDamage: 999,
    hpAfter: 0,
    ammoAfter: 999,
    DEX: 999,
    Evasion: 999,
  };
  const firstHit = await postAttack(playerToken, hitBody);
  assert.equal(firstHit.response.status, 200);
  assert.equal(firstHit.payload.ok, true);
  assert.ok(firstHit.payload.attackResult);
  assert.ok(firstHit.payload.weaponDamage);
  assert.ok(firstHit.payload.damageResult);
  assert.equal(firstHit.payload.ammoAfter, 0);
  assert.equal(firstHit.payload.actionAfter, 1);
  const firstDamage = firstHit.payload.damageResult as { hpAfter: number };
  const { data: persistedResolution } = await db!.from("mesa_attack_resolutions").select("status,result").eq("resolution_id", hitBody.resolutionId).single();
  assert.equal(persistedResolution?.status, "committed");
  const firstResult = { ...firstHit.payload };
  delete firstResult.ok;
  assert.deepEqual(persistedResolution?.result, firstResult);
  const hitRow = await row(hitTargetId);
  assert.equal(hitRow.hp_current, firstDamage.hpAfter);
  assert.equal(hitRow.actions_remaining, 2);
  assert.deepEqual(hitRow.combat_armor, { head: 0, body: 0 });
  const weaponRolls = (firstHit.payload.weaponDamage as { rolls?: number[] }).rolls ?? [];
  if (weaponRolls.filter((roll) => roll === 6).length >= 2) {
    assert.ok((hitRow.critical_injuries as unknown[]).length >= 1);
  }

  const retryHit = await postAttack(playerToken, hitBody);
  assert.equal(retryHit.response.status, 200);
  const retryResult = { ...retryHit.payload };
  delete retryResult.ok;
  assert.deepEqual(retryResult, firstResult);
  assert.equal((await row(playerActorId)).actions_remaining, 1);
  assert.equal((await row(playerActorId)).combat_ammo && ((await row(playerActorId)).combat_ammo as { [key: string]: number })["weapon-http"], 0);

  const reloadBody = {
    resolutionId: `http-reload-${randomUUID()}`,
    weaponId: "weapon-http",
    ammoAfter: 999,
    reserveAfter: 999,
    reloadAmount: 999,
  };
  const reload = await postReload(playerToken, reloadBody);
  assert.equal(reload.response.status, 200);
  assert.equal(reload.payload.ammoAfter, 1);
  assert.equal(reload.payload.actionsAfter, 0);
  assert.equal(((await row(playerActorId)).combat_ammo as { [key: string]: number })["weapon-http"], 1);
  const reloadedState = await getMesaState(playerToken);
  const reloadedCombatant = (reloadedState.payload.state as { combatants: Array<{ id: string; supplies?: { inventory?: Array<{ item: string; quantity: number }> } }> }).combatants.find((combatant) => combatant.id === playerActorId);
  assert.deepEqual(reloadedCombatant?.supplies?.inventory, [{ item: "Pistol Ammunition", quantity: 1 }]);

  const reloadRetry = await postReload(playerToken, reloadBody);
  assert.equal(reloadRetry.response.status, 200);
  assert.deepEqual(reloadRetry.payload, reload.payload);
  assert.equal((await row(playerActorId)).actions_remaining, 0);

  const playerState = await getMesaState(playerToken);
  assert.equal(playerState.response.status, 200);
  const state = playerState.payload.state as { combatants: Array<{ id: string; ammoByWeapon?: Record<string, number> | null }> };
  assert.equal(state.combatants.find((combatant) => combatant.id === playerActorId)?.ammoByWeapon?.["weapon-http"], 1);

  const { data: combatAfterRetry } = await db!.from("mesa_combats").select("event_log").eq("id", combatId).single();
  assert.equal((combatAfterRetry?.event_log as Array<{ text: string }>).filter((event) => event.text.includes("Player Actor")).length, 2);

  // O GM autentica e pode controlar qualquer combatente, mas não pode
  // atravessar a autoridade do turno. Neste ponto Player Actor continua ativo.
  const outOfTurnResolution = `http-gm-out-of-turn-${randomUUID()}`;
  const outOfTurn = await postAttack(gmToken, {
    resolutionId: outOfTurnResolution,
    actorId: gmActorId,
    targetId: missTargetId,
    weaponId: "weapon-http",
    skillId: "handgun",
    attackType: "handgun",
    attackMode: "aimed",
    aimedTarget: "head",
  });
  assert.equal(outOfTurn.response.status, 403);
  assert.equal(outOfTurn.payload.code, "not_your_turn");
  assert.equal((await row(gmActorId)).actions_remaining, 2);
  assert.equal(((await row(gmActorId)).combat_ammo as { [key: string]: number })["weapon-http"], 1);
  assert.equal((await row(missTargetId)).hp_current, 20);
  const { data: rejectedResolution } = await db!.from("mesa_attack_resolutions").select("status").eq("resolution_id", outOfTurnResolution).maybeSingle();
  assert.equal(rejectedResolution, null);

  const { error: gmTurnError } = await db!.from("mesa_combats").update({ active_combatant_id: gmActorId }).eq("id", combatId);
  assert.ifError(gmTurnError);

  const gmAttack = await postAttack(gmToken, {
    resolutionId: `http-gm-${randomUUID()}`,
    actorId: gmActorId,
    targetId: missTargetId,
    weaponId: "weapon-http",
    skillId: "handgun",
    attackType: "handgun",
    attackMode: "aimed",
    aimedTarget: "head",
  });
  assert.equal(gmAttack.response.status, 200);
  assert.ok(gmAttack.payload.attackResult);
  assert.equal(gmAttack.payload.damageResult, undefined);
  assert.equal(gmAttack.payload.ammoAfter, 0);
  assert.equal((await row(gmActorId)).actions_remaining, 1);
  assert.equal((await row(missTargetId)).hp_current, 20);

  const { error: concurrentTurnError } = await db!.from("mesa_combats").update({ active_combatant_id: concurrentActorId }).eq("id", combatId);
  assert.ifError(concurrentTurnError);

  const playerOutOfTurnResolution = `http-player-out-of-turn-${randomUUID()}`;
  const playerOutOfTurn = await postAttack(playerToken, {
    resolutionId: playerOutOfTurnResolution,
    actorId: actionActorId,
    targetId: actionTargetId,
    weaponId: "weapon-http",
    skillId: "handgun",
    attackType: "handgun",
    attackMode: "aimed",
    aimedTarget: "head",
  });
  assert.equal(playerOutOfTurn.response.status, 403);
  assert.equal(playerOutOfTurn.payload.code, "not_your_turn");
  assert.equal((await row(actionActorId)).actions_remaining, 1);
  assert.equal(((await row(actionActorId)).combat_ammo as { [key: string]: number })["weapon-http"], 1);

  const concurrentBody = (resolutionId: string) => ({
    resolutionId,
    actorId: concurrentActorId,
    targetId: concurrentTargetId,
    weaponId: "weapon-http",
    skillId: "handgun",
    attackType: "handgun",
    attackMode: "aimed",
    aimedTarget: "head",
  });
  const sameResolution = `http-concurrent-${randomUUID()}`;
  const sameResponses = await Promise.all([postAttack(gmToken, concurrentBody(sameResolution)), postAttack(gmToken, concurrentBody(sameResolution))]);
  assert.equal(sameResponses.filter((item) => item.response.status === 200).length, 2);
  assert.deepEqual(sameResponses[0].payload, sameResponses[1].payload);
  assert.equal((await row(concurrentActorId)).actions_remaining, 1);
  assert.equal(((await row(concurrentActorId)).combat_ammo as { [key: string]: number })["weapon-http"], 0);

  const { error: actionTurnError } = await db!.from("mesa_combats").update({ active_combatant_id: actionActorId }).eq("id", combatId);
  assert.ifError(actionTurnError);

  const differentBody = (resolutionId: string) => ({
    ...concurrentBody(resolutionId),
    actorId: actionActorId,
    targetId: actionTargetId,
  });
  const differentA = postAttack(gmToken, differentBody(`http-different-a-${randomUUID()}`));
  const differentB = postAttack(gmToken, differentBody(`http-different-b-${randomUUID()}`));
  const differentResponses = await Promise.all([differentA, differentB]);
  // As duas resoluções são PRÓPRIAS (resolutionId diferente), então exatamente
  // UMA pode aplicar o orçamento de ação — nunca dois commits. O código da
  // recusa do perdedor depende do momento em que ele leu o estado:
  //   409 action_conflict      → leu antes do commit e perdeu o CAS;
  //   403 insufficient_actions → leu depois, com o orçamento já gasto;
  //   400 target_defeated      → leu depois, com o alvo já derrotado.
  // Os três são recusas legítimas do servidor; o invariante testado aqui é
  // "uma aplicação e uma recusa", não qual delas ocorre.
  assert.equal(differentResponses.filter((item) => item.response.status === 200).length, 1);
  const rejected = differentResponses.filter((item) => item.response.status !== 200);
  assert.equal(rejected.length, 1, "a disputa precisa terminar com exatamente uma recusa");
  const rejection = `${rejected[0].response.status}:${rejected[0].payload.code ?? ""}`;
  assert.ok(
    ["409:action_conflict", "403:insufficient_actions", "400:target_defeated"].includes(rejection),
    `rejeição fora do conjunto esperado: ${rejection}`,
  );

  const forbidden = await postAttack(playerToken, { ...concurrentBody(`http-forbidden-${randomUUID()}`), actorId: gmActorId, targetId: missTargetId });
  assert.equal(forbidden.response.status, 403);
  assert.equal(forbidden.payload.code, "combatant_not_owned");

  const missingTarget = await postAttack(playerToken, { ...concurrentBody(`http-target-${randomUUID()}`), targetId: randomUUID() });
  assert.equal(missingTarget.response.status, 404);
  assert.equal(missingTarget.payload.code, "target_not_found");

  const { error: defeatError } = await db!.from("mesa_combatants").update({ is_dead: true }).eq("id", missTargetId);
  assert.ifError(defeatError);
  const defeatedTarget = await postAttack(gmToken, {
    resolutionId: `http-defeated-${randomUUID()}`,
    actorId: gmActorId,
    targetId: missTargetId,
    weaponId: "weapon-http",
    skillId: "handgun",
    attackType: "handgun",
    attackMode: "aimed",
    aimedTarget: "head",
  });
  assert.equal(defeatedTarget.response.status, 400);
  assert.equal(defeatedTarget.payload.code, "target_defeated");

  const missingToken = await postAttack(undefined, concurrentBody(`http-token-${randomUUID()}`));
  assert.equal(missingToken.response.status, 401);
  assert.equal(missingToken.payload.code, "missing_token");
});

after(async () => {
  if (!db) return;
  await db.from("mesa_combatants").delete().in("id", combatantIds);
  await db.from("mesa_combats").delete().eq("id", combatId);
  await db.from("mesa_participants").delete().in("id", [playerParticipantId, gmParticipantId]);
  await db.from("mesa_sessions").delete().eq("id", sessionId);
});
