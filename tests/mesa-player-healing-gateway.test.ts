/**
 * F1.12.2 — **Player Healing Gateway** (`POST /combat/player-heal`).
 *
 * Prova as promessas da etapa contra Postgres/HTTP REAIS:
 *
 *  1. cura simples passa pelo servidor e persiste na Mesa;
 *  2. HP NUNCA ultrapassa o maxHP (`min(atual + amount, máximo)`);
 *  3. amount inválido (0, negativo, fracionário, não-numérico, ausente) é recusado;
 *  4. alvo inexistente é recusado;
 *  5. alvo inimigo é recusado (inimigo tem caminho próprio);
 *  6. combate inativo rejeita a cura;
 *  7. concorrência/CAS: a corrida nunca perde nem duplica uma cura;
 *  8. falha transacional não deixa estado parcial nem evento;
 *  9. Character Sync leva o novo HP à ficha do Player;
 * 10. retry/idempotência: mesmo `resolutionId` não cura duas vezes.
 *
 * Mais: HP ≤ 0 e `is_dead` são preservados (Death Save intocado), o cliente
 * NUNCA define `hpAfter`/`finalHp`, e sessão encerrada / não-GM são recusados.
 *
 * Ambiente sem SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY: a suíte é skipped.
 */
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env");
} catch {
  // CI sem secrets executa os testes locais, mas marca este suite como skip.
}

const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const db: SupabaseClient | null = configured
  ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  : null;

const sessionId = randomUUID();
const combatId = randomUUID();
const gmParticipantId = randomUUID();
const playerParticipantId = randomUUID();
const gmToken = `gm-${randomUUID()}-token`;
const playerToken = `player-${randomUUID()}-token`;

/** Ficha ligada ao combatente curado — é ela que atravessa o characterSync. */
const healCharacterId = randomUUID();

const healId = randomUUID();
const fullId = randomUUID();
const raceId = randomUUID();
const atomicId = randomUUID();
const casId = randomUUID();
const tamperId = randomUUID();
const lowId = randomUUID();
const deadId = randomUUID();
const enemyId = randomUUID();

const combatantIds = [healId, fullId, raceId, atomicId, casId, tamperId, lowId, deadId, enemyId];
const participantIds = [gmParticipantId, playerParticipantId];
const characterIds = [healCharacterId];

const postgresTest = configured ? test : test.skip;
const resolution = (label: string) => `player-heal-${label}-${randomUUID()}`;

/** Snapshot de personagem com `deathSave` (mesma forma usada em F1.12.1). */
function characterSnapshot(id: string, name: string, type: "character" | "enemy", hp: { current: number; max: number }) {
  return {
    id,
    type,
    name,
    source: { characterId: null, sourceKey: null, enemyId: null },
    stats: { REF: 5, DEX: 5, BODY: 5, MOVE: 6 },
    skills: {},
    weapons: [],
    combat: {
      hp: { current: hp.current, max: hp.max },
      armor: { head: 0, body: 0 },
      criticalInjuries: [],
      conditions: [],
      initiative: null,
      isDead: false,
      // Só personagem tem Death Save — é o que liga o rastreio de lesão no motor.
      ...(type === "character" ? { deathSave: { dc: 0, failures: 0 } } : {}),
    },
  };
}

async function insertCombatant(
  id: string,
  options: {
    kind: "character" | "enemy";
    hp: number;
    hpMax: number;
    sortOrder: number;
    isDead?: boolean;
    participantId?: string | null;
    characterId?: string | null;
  },
): Promise<void> {
  const { error } = await db!.from("mesa_combatants").insert({
    id,
    combat_id: combatId,
    session_id: sessionId,
    kind: options.kind,
    participant_id: options.participantId ?? null,
    character_id: options.characterId ?? null,
    name: id.slice(0, 8),
    actions_max: 2,
    actions_remaining: 2,
    movement_max: 6,
    movement_remaining: 6,
    hp_current: options.hp,
    hp_max: options.hpMax,
    is_dead: options.isDead ?? false,
    conditions: [],
    sort_order: options.sortOrder,
    combat_snapshot: characterSnapshot(id, id.slice(0, 8), options.kind, {
      current: options.hp,
      max: options.hpMax,
    }),
    combat_ammo: null,
    combat_armor: { head: 0, body: 0 },
    critical_injuries: [],
  });
  assert.ifError(error);
}

interface Row {
  hp_current: number;
  hp_max: number;
  is_dead: boolean;
  actions_remaining: number;
}

async function row(id: string): Promise<Row> {
  const { data, error } = await db!
    .from("mesa_combatants")
    .select("hp_current,hp_max,is_dead,actions_remaining")
    .eq("id", id)
    .single();
  if (error || !data) throw error ?? new Error("combatant not found");
  return data as Row;
}

async function eventTexts(): Promise<string[]> {
  const { data, error } = await db!.from("mesa_combats").select("event_log").eq("id", combatId).single();
  if (error || !data) throw error ?? new Error("combat not found");
  const log = (data as { event_log: unknown[] | null }).event_log;
  return Array.isArray(log)
    ? log.map((entry) => String((entry as { text?: unknown }).text ?? ""))
    : [];
}

async function eventCount(): Promise<number> {
  return (await eventTexts()).length;
}

interface PostResult {
  response: Response;
  payload: Record<string, unknown>;
}

async function postPlayerHealing(token: string | undefined, body: Record<string, unknown>): Promise<PostResult> {
  const { POST } = await import("../src/app/api/mesa/[id]/combat/player-heal/route.ts");
  const request = new Request("http://localhost/api/mesa/session/combat/player-heal", {
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

async function getMesaState(token: string): Promise<Record<string, unknown>> {
  const { GET } = await import("../src/app/api/mesa/[id]/route.ts");
  const request = new Request("http://localhost/api/mesa/session", { headers: { "x-mesa-token": token } });
  const response = await GET(request, { params: Promise.resolve({ id: sessionId }) });
  const payload = (await response.json()) as { state: Record<string, unknown> };
  return payload.state;
}

async function rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await db!.rpc(name, args);
  if (response.error) throw new Error(`${name}: ${response.error.message}`);
  return response.data as T;
}

postgresTest("Player Healing Gateway: intenção → servidor → transação → Mesa → ficha", async () => {
  /* ------------------------------ setup ---------------------------------- */

  const { error: sessionError } = await db!.from("mesa_sessions").insert({
    id: sessionId,
    name: "E2E Player Healing Gateway",
    gm_id: gmParticipantId,
    status: "active",
    join_code: sessionId.replace(/-/g, "").slice(0, 5).toUpperCase(),
  });
  assert.ifError(sessionError);

  // `mesa_combatants.character_id` é FK para a CÓPIA da ficha guardada na Mesa.
  const { error: characterError } = await db!.from("mesa_characters").insert({
    id: healCharacterId,
    owner_token: `owner-${randomUUID()}-token`,
    display_name: "HEAL GW",
    sheet: {},
  });
  assert.ifError(characterError);

  const { error: participantError } = await db!.from("mesa_participants").insert([
    { id: gmParticipantId, session_id: sessionId, player_token: gmToken, display_name: "HEAL GM", character_id: null, role: "gm" },
    { id: playerParticipantId, session_id: sessionId, player_token: playerToken, display_name: "HEAL Player", character_id: healCharacterId, role: "player" },
  ]);
  assert.ifError(participantError);

  const { error: combatError } = await db!.from("mesa_combats").insert({
    id: combatId,
    session_id: sessionId,
    status: "active",
    round: 1,
    active_combatant_id: null,
    initiative_started: true,
    event_log: [],
  });
  assert.ifError(combatError);

  await insertCombatant(healId, { kind: "character", hp: 20, hpMax: 30, sortOrder: 0, participantId: playerParticipantId, characterId: healCharacterId });
  await insertCombatant(fullId, { kind: "character", hp: 30, hpMax: 30, sortOrder: 1 });
  await insertCombatant(raceId, { kind: "character", hp: 10, hpMax: 40, sortOrder: 2 });
  await insertCombatant(atomicId, { kind: "character", hp: 20, hpMax: 30, sortOrder: 3 });
  await insertCombatant(casId, { kind: "character", hp: 20, hpMax: 30, sortOrder: 4 });
  await insertCombatant(tamperId, { kind: "character", hp: 25, hpMax: 30, sortOrder: 5 });
  await insertCombatant(lowId, { kind: "character", hp: -5, hpMax: 30, sortOrder: 6 });
  await insertCombatant(deadId, { kind: "character", hp: 2, hpMax: 30, sortOrder: 7, isDead: true });
  await insertCombatant(enemyId, { kind: "enemy", hp: 30, hpMax: 30, sortOrder: 8 });

  const { syncMesaCharacterState } = await import("../src/lib/mesa/characterSync.ts");
  const { createEmptyCharacter } = await import("../src/types/character.ts");

  /* --------------------------- 1. cura simples ---------------------------- */

  const simpleBody = {
    resolutionId: resolution("plain"),
    targetCombatantId: healId,
    amount: 5,
    sourceType: "gm_adjust",
    sourceContext: "bandagem do Mestre",
  };
  const simple = await postPlayerHealing(gmToken, simpleBody);
  assert.equal(simple.response.status, 200, JSON.stringify(simple.payload));
  assert.equal(simple.payload.ok, true);
  assert.equal(simple.payload.updated, true);
  assert.equal(simple.payload.hp, 25, "o HP final é calculado pelo SERVIDOR, não pelo cliente");
  assert.equal(simple.payload.hpMax, 30, "o servidor devolve o maxHP que ele leu da Mesa");
  assert.equal(simple.payload.amountApplied, 5);
  assert.equal(simple.payload.isDead, false, "cura não altera morte");

  const healRow = await row(healId);
  assert.equal(healRow.hp_current, 25, "mesa_combatants.hp = min(atual + amount, máximo)");
  assert.equal(healRow.is_dead, false);
  const eventsAfterSimple = await eventCount();
  assert.equal(eventsAfterSimple, 1, "uma cura = um evento");
  assert.match((await eventTexts())[0], /Cura/, "o evento identifica a cura");
  assert.match((await eventTexts())[0], /\+5/, "o evento traz o valor aplicado");
  assert.match((await eventTexts())[0], /bandagem do Mestre/, "o contexto vira texto do evento");

  /* --------------------------- 9. character sync -------------------------- */

  const state = (await getMesaState(playerToken)) as {
    viewer: { participantId: string | null };
    combatants: Array<Record<string, unknown>>;
  };
  assert.equal(state.viewer.participantId, playerParticipantId);
  const character = createEmptyCharacter(healCharacterId);
  const synced = syncMesaCharacterState(character, state as never);
  assert.equal(synced.combat.hp.current, 25, "Mesa HP 25 → ficha HP 25 (syncMesaCharacterState)");
  assert.equal(synced.combat.isDead, false);

  /* ------------------- 10. idempotência (retry do mesmo id) --------------- */

  const retry = await postPlayerHealing(gmToken, simpleBody);
  assert.equal(retry.response.status, 200);
  assert.deepEqual({ ...retry.payload }, { ...simple.payload }, "retry devolve o MESMO resultado");
  assert.equal((await row(healId)).hp_current, 25, "a cura NÃO é aplicada duas vezes");
  assert.equal(await eventCount(), eventsAfterSimple, "o retry não acrescenta evento");

  /* ------------------------ 2. teto no hpMax ------------------------------ */

  const clamp = await postPlayerHealing(gmToken, {
    resolutionId: resolution("clamp"),
    targetCombatantId: healId,
    amount: 100,
  });
  assert.equal(clamp.response.status, 200, JSON.stringify(clamp.payload));
  assert.equal(clamp.payload.updated, true);
  assert.equal(clamp.payload.hp, 30, "min(25 + 100, 30) = 30");
  assert.equal(clamp.payload.amountApplied, 5, "só a parte que coube foi aplicada");
  assert.equal((await row(healId)).hp_current, 30, "HP nunca ultrapassa o maxHP");
  assert.equal(await eventCount(), eventsAfterSimple + 1);

  const alreadyFull = await postPlayerHealing(gmToken, {
    resolutionId: resolution("full"),
    targetCombatantId: fullId,
    amount: 10,
  });
  assert.equal(alreadyFull.response.status, 200, JSON.stringify(alreadyFull.payload));
  assert.equal(alreadyFull.payload.updated, false, "já no máximo: nada mudou");
  assert.equal(alreadyFull.payload.hp, 30);
  assert.equal(alreadyFull.payload.hpMax, 30);
  assert.equal(alreadyFull.payload.amountApplied, 0);
  assert.equal((await row(fullId)).hp_current, 30, "no máximo: HP intacto");
  assert.equal(await eventCount(), eventsAfterSimple + 1, "sem mudança não há evento nem publicação");

  /* ------------------------- 3. amount inválido --------------------------- */

  for (const amount of [0, -5, 2.5, "10", null]) {
    const invalid = await postPlayerHealing(gmToken, {
      resolutionId: resolution(`amount-${String(amount)}`),
      targetCombatantId: healId,
      amount,
    });
    assert.equal(invalid.response.status, 400, `amount=${JSON.stringify(amount)} → ${JSON.stringify(invalid.payload)}`);
    assert.equal(invalid.payload.code, "invalid_amount");
  }
  const noAmount = await postPlayerHealing(gmToken, {
    resolutionId: resolution("amount-missing"),
    targetCombatantId: healId,
  });
  assert.equal(noAmount.response.status, 400, JSON.stringify(noAmount.payload));
  assert.equal(noAmount.payload.code, "invalid_amount");
  assert.equal((await row(healId)).hp_current, 30, "amount inválido não move HP");
  assert.equal(await eventCount(), eventsAfterSimple + 1, "amount inválido não publica");

  /* ------------------------- 4. alvo inexistente -------------------------- */

  const missingTarget = await postPlayerHealing(gmToken, {
    resolutionId: resolution("missing"),
    targetCombatantId: randomUUID(),
    amount: 5,
  });
  assert.equal(missingTarget.response.status, 404, JSON.stringify(missingTarget.payload));
  assert.equal(missingTarget.payload.code, "target_not_found");

  const noTarget = await postPlayerHealing(gmToken, { resolutionId: resolution("no-target"), amount: 5 });
  assert.equal(noTarget.response.status, 400, JSON.stringify(noTarget.payload));
  assert.equal(noTarget.payload.code, "target_not_found");

  /* -------------------------- 5. alvo inimigo ----------------------------- */

  const enemyHeal = await postPlayerHealing(gmToken, {
    resolutionId: resolution("enemy"),
    targetCombatantId: enemyId,
    amount: 5,
  });
  assert.equal(enemyHeal.response.status, 400, JSON.stringify(enemyHeal.payload));
  assert.equal(enemyHeal.payload.code, "not_a_player");
  assert.equal((await row(enemyId)).hp_current, 30, "inimigo não é afetado por este gateway");

  /* ------------- HP ≤ 0 e morte preservados (regra existente) ------------- */

  const low = await postPlayerHealing(gmToken, {
    resolutionId: resolution("low"),
    targetCombatantId: lowId,
    amount: 10,
  });
  assert.equal(low.response.status, 200, JSON.stringify(low.payload));
  assert.equal(low.payload.hp, 5, "não se inventa regra: HP ≤ 0 pode ser curado");
  assert.equal(low.payload.isDead, false);
  assert.equal((await row(lowId)).hp_current, 5);

  const dead = await postPlayerHealing(gmToken, {
    resolutionId: resolution("dead"),
    targetCombatantId: deadId,
    amount: 5,
  });
  assert.equal(dead.response.status, 200, JSON.stringify(dead.payload));
  assert.equal(dead.payload.hp, 7);
  assert.equal(dead.payload.isDead, true, "cura NÃO muda morte/Death Save");
  const deadRow = await row(deadId);
  assert.equal(deadRow.hp_current, 7, "HP sobe");
  assert.equal(deadRow.is_dead, true, "is_dead intocado (Death Save fora do escopo)");

  /* ------------------------ 8. client tampering --------------------------- */

  const eventsBeforeTamper = await eventCount();
  const tampered = await postPlayerHealing(gmToken, {
    resolutionId: resolution("tamper"),
    targetCombatantId: tamperId,
    amount: 5,
    // Tentativas de autoridade: nenhuma pode ser lida como resultado.
    hpAfter: 99,
    finalHp: 99,
    hp: 1,
    hpCurrent: 99,
    hpMax: 1,
    isDead: true,
    deathSaveDC: 99,
  });
  assert.equal(tampered.response.status, 400, JSON.stringify(tampered.payload));
  assert.equal(tampered.payload.code, "client_authority_forbidden");
  const tamperRow = await row(tamperId);
  assert.equal(tamperRow.hp_current, 25, "HP não mudou");
  assert.equal(tamperRow.is_dead, false, "morte não mudou");
  assert.equal(await eventCount(), eventsBeforeTamper, "nada foi publicado");

  const badContext = await postPlayerHealing(gmToken, {
    resolutionId: resolution("context"),
    targetCombatantId: tamperId,
    amount: 5,
    sourceContext: { evil: true },
  });
  assert.equal(badContext.response.status, 400, JSON.stringify(badContext.payload));
  assert.equal(badContext.payload.code, "invalid_context");
  assert.equal((await row(tamperId)).hp_current, 25, "contexto inválido não move HP");

  const badResolution = await postPlayerHealing(gmToken, {
    resolutionId: "x",
    targetCombatantId: tamperId,
    amount: 5,
  });
  assert.equal(badResolution.response.status, 400, JSON.stringify(badResolution.payload));
  assert.equal(badResolution.payload.code, "invalid_resolution_id");

  /* --------------------------- 7. concorrência ---------------------------- */

  // (a) duas curas HTTP simultâneas: cada uma aplicada conta exatamente uma vez.
  const eventsBeforeRace = await eventCount();
  const raceBody = (id: string) => ({ resolutionId: id, targetCombatantId: raceId, amount: 10 });
  const race = await Promise.all([
    postPlayerHealing(gmToken, raceBody(resolution("race-a"))),
    postPlayerHealing(gmToken, raceBody(resolution("race-b"))),
  ]);
  const statuses = race.map((entry) => entry.response.status);
  for (const status of statuses) {
    assert.ok(status === 200 || status === 409, `status inesperado na corrida: ${status}`);
  }
  const applied = statuses.filter((status) => status === 200).length;
  assert.ok(applied >= 1, "pelo menos uma cura vence a corrida");
  const raceRow = await row(raceId);
  assert.equal(raceRow.hp_current, 10 + 10 * applied, "sem lost update: cada cura vence uma vez");
  assert.equal(await eventCount(), eventsBeforeRace + applied, "só as vencedoras publicam evento");

  // (b) CAS determinístico: quem leu o HP antes do commit do outro perde.
  const casResolutionA = resolution("cas-a");
  const casResolutionB = resolution("cas-b");
  const claims = await Promise.all([
    rpc<Array<{ claimed: boolean; claim_token: string }>>("claim_mesa_attack_resolution", {
      p_session_id: sessionId,
      p_combat_id: combatId,
      p_resolution_id: casResolutionA,
    }),
    rpc<Array<{ claimed: boolean; claim_token: string }>>("claim_mesa_attack_resolution", {
      p_session_id: sessionId,
      p_combat_id: combatId,
      p_resolution_id: casResolutionB,
    }),
  ]);
  assert.equal(claims[0][0].claimed, true);
  assert.equal(claims[1][0].claimed, true);
  const casRow = await row(casId);
  const eventsBeforeCas = await eventCount();
  await rpc("commit_mesa_attack_resolution", {
    p_session_id: sessionId,
    p_combat_id: combatId,
    p_resolution_id: casResolutionA,
    p_claim_token: claims[0][0].claim_token,
    p_actor_id: casId,
    p_target_id: casId,
    p_actions_before: 2,
    p_actions_after: 2,
    p_ammo_before: null,
    p_ammo_after: null,
    p_target_hp_before: casRow.hp_current,
    p_target_dead_before: casRow.is_dead,
    p_target_patch: { hp_current: 25 },
    p_result: { updated: true, hp: 25, hpMax: 30, amountApplied: 5, isDead: false },
    p_event_text: "Cura: primeiro",
  });
  await assert.rejects(
    () =>
      rpc("commit_mesa_attack_resolution", {
        p_session_id: sessionId,
        p_combat_id: combatId,
        p_resolution_id: casResolutionB,
        p_claim_token: claims[1][0].claim_token,
        p_actor_id: casId,
        p_target_id: casId,
        p_actions_before: 2,
        p_actions_after: 2,
        p_ammo_before: null,
        p_ammo_after: null,
        // A linha mudou entre a leitura deste concorrente e o commit.
        p_target_hp_before: casRow.hp_current,
        p_target_dead_before: casRow.is_dead,
        p_target_patch: { hp_current: 25 },
        p_result: { updated: true, hp: 25, hpMax: 30, amountApplied: 5, isDead: false },
        p_event_text: "Cura: perdedor",
      }),
    /hp_conflict/,
  );
  assert.equal((await row(casId)).hp_current, 25, "o perdedor da corrida nunca sobrescreve");
  assert.equal(await eventCount(), eventsBeforeCas + 1, "só o vencedor publica evento");
  await rpc("release_mesa_attack_resolution", {
    p_session_id: sessionId,
    p_combat_id: combatId,
    p_resolution_id: casResolutionB,
    p_claim_token: claims[1][0].claim_token,
  });

  /* -------------------- 8b. falha transacional --------------------------- */

  const eventsBeforeFailure = await eventCount();
  const failingResolutionId = resolution("commit-fail");
  const atomicClaim = await rpc<Array<{ claimed: boolean; claim_token: string }>>("claim_mesa_attack_resolution", {
    p_session_id: sessionId,
    p_combat_id: combatId,
    p_resolution_id: failingResolutionId,
  });
  assert.equal(atomicClaim[0].claimed, true);
  await assert.rejects(
    () =>
      rpc("commit_mesa_attack_resolution", {
        p_session_id: sessionId,
        p_combat_id: combatId,
        p_resolution_id: failingResolutionId,
        p_claim_token: atomicClaim[0].claim_token,
        p_actor_id: atomicId,
        p_target_id: atomicId,
        p_actions_before: 2,
        p_actions_after: 2,
        p_ammo_before: null,
        p_ammo_after: null,
        p_target_hp_before: 999,
        p_target_dead_before: false,
        p_target_patch: { hp_current: 25 },
        p_result: { updated: true, hp: 25, hpMax: 30, amountApplied: 5, isDead: false },
        p_event_text: "não deveria existir",
      }),
    /hp_conflict/,
  );
  const atomicRow = await row(atomicId);
  assert.equal(atomicRow.hp_current, 20, "commit falhou: HP unchanged");
  assert.equal(atomicRow.is_dead, false, "commit falhou: morte unchanged");
  assert.equal(atomicRow.actions_remaining, 2, "commit falhou: nenhuma Action debitada");
  assert.equal(await eventCount(), eventsBeforeFailure, "commit falhou: event absent");
  await rpc("release_mesa_attack_resolution", {
    p_session_id: sessionId,
    p_combat_id: combatId,
    p_resolution_id: failingResolutionId,
    p_claim_token: atomicClaim[0].claim_token,
  });

  /* --------------------------- autorizações ------------------------------- */

  const byPlayer = await postPlayerHealing(playerToken, {
    resolutionId: resolution("player"),
    targetCombatantId: healId,
    amount: 5,
  });
  assert.equal(byPlayer.response.status, 403, JSON.stringify(byPlayer.payload));
  assert.equal(byPlayer.payload.code, "gm_only");

  const noToken = await postPlayerHealing(undefined, {
    resolutionId: resolution("token"),
    targetCombatantId: healId,
    amount: 5,
  });
  assert.equal(noToken.response.status, 401);
  assert.equal(noToken.payload.code, "missing_token");

  /* -------------------------- 6. combate inativo -------------------------- */

  const eventsBeforeFinish = await eventCount();
  const { error: finishCombatError } = await db!.from("mesa_combats").update({ status: "finished" }).eq("id", combatId);
  assert.ifError(finishCombatError);
  const noCombat = await postPlayerHealing(gmToken, {
    resolutionId: resolution("no-combat"),
    targetCombatantId: healId,
    amount: 5,
  });
  assert.equal(noCombat.response.status, 409, JSON.stringify(noCombat.payload));
  assert.equal(noCombat.payload.code, "combat_not_active");
  assert.equal((await row(healId)).hp_current, 30, "combate inativo: HP unchanged");
  assert.equal(await eventCount(), eventsBeforeFinish, "combate inativo: event absent");

  /* -------------------------- sessão encerrada ---------------------------- */

  const { error: finishSessionError } = await db!.from("mesa_sessions").update({ status: "finished" }).eq("id", sessionId);
  assert.ifError(finishSessionError);
  const finished = await postPlayerHealing(gmToken, {
    resolutionId: resolution("session-finished"),
    targetCombatantId: healId,
    amount: 5,
  });
  assert.equal(finished.response.status, 410, JSON.stringify(finished.payload));
  assert.equal(finished.payload.code, "session_finished");
  assert.equal((await row(healId)).hp_current, 30, "sessão encerrada: HP unchanged");
  assert.equal(await eventCount(), eventsBeforeFinish, "sessão encerrada: event absent");
});

after(async () => {
  if (!db) return;
  await db.from("mesa_combatants").delete().in("id", combatantIds);
  await db.from("mesa_combats").delete().eq("id", combatId);
  await db.from("mesa_participants").delete().in("id", participantIds);
  await db.from("mesa_characters").delete().in("id", characterIds);
  await db.from("mesa_sessions").delete().eq("id", sessionId);
});
