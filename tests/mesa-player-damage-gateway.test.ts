/**
 * F1.12.1 — **Player Damage Gateway** (`POST /combat/player-damage`).
 *
 * Prova as promessas da etapa contra Postgres/HTTP REAIS:
 *
 *  1. dano externo simples resolve no Damage Engine e persiste na Mesa;
 *  2. a persistência bate com o resultado do motor (`mesa_combatants.hp`);
 *  3. o estado da Mesa converge na ficha pelo `characterSync` de F1.12;
 *  4. o gateway NÃO ignora Armor (absorção + degradação de SP);
 *  5. Critical Injury produzida chega à ficha SEM duplicação;
 *  6. HP ≤ 0 chega à ficha sem alterar Death Save/isDead;
 *  7. falha no commit não deixa estado parcial nem evento;
 *  8. `finalHp`/`finalArmor`/`isDead` NUNCA são aceitos como autoridade;
 *  9. dano A + dano B concorrentes não se sobrescrevem;
 * 10. caminhos legados que alteravam HP de Player são recusados durante o
 *     combate (`PATCH /combatants`), preservando o ajuste de inimigo.
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
const characterId = randomUUID();
const gmToken = `gm-${randomUUID()}-token`;
const playerToken = `player-${randomUUID()}-token`;

/** Vítima ligada à ficha do jogador — é ela que atravessa o characterSync. */
const victimId = randomUUID();
const armoredId = randomUUID();
const concurrentId = randomUUID();
const atomicId = randomUUID();
const tamperId = randomUUID();
const enemyId = randomUUID();

/** Alvo ligado a OUTRA ficha: é a que recebe a Critical Injury. */
const criticalCharacterId = randomUUID();
const criticalParticipantId = randomUUID();
const criticalToken = `crit-${randomUUID()}-token`;
const criticalId = randomUUID();

/** Alvo ligado a uma terceira ficha: é a que chega a HP ≤ 0 (Mortal Wound). */
const mortalCharacterId = randomUUID();
const mortalParticipantId = randomUUID();
const mortalToken = `mrt-${randomUUID()}-token`;
const mortalId = randomUUID();

const combatantIds = [victimId, armoredId, criticalId, mortalId, concurrentId, atomicId, tamperId, enemyId];
const participantIds = [gmParticipantId, playerParticipantId, criticalParticipantId, mortalParticipantId];
const characterIds = [characterId, criticalCharacterId, mortalCharacterId];

const postgresTest = configured ? test : test.skip;
const resolution = (label: string) => `player-damage-${label}-${randomUUID()}`;

/** Snapshot de personagem com `deathSave` (é o que liga o rastreio de lesão). */
function characterSnapshot(
  id: string,
  name: string,
  type: "character" | "enemy",
  armor: { head: number; body: number },
) {
  const snapshot = {
    id,
    type,
    name,
    source: { characterId: null, sourceKey: null, enemyId: null },
    stats: { REF: 5, DEX: 5, BODY: 5, MOVE: 6 },
    skills: {},
    weapons: [],
    combat: {
      hp: { current: 30, max: 30 },
      armor,
      criticalInjuries: [],
      conditions: [],
      initiative: null,
      isDead: false,
      // Só personagem tem Death Save — é o que liga o rastreio de lesão no motor.
      ...(type === "character" ? { deathSave: { dc: 0, failures: 0 } } : {}),
    },
  };
  return snapshot;
}

async function insertCombatant(
  id: string,
  options: {
    kind: "character" | "enemy";
    hp: number;
    armor: { head: number; body: number };
    participantId?: string | null;
    characterId?: string | null;
    sortOrder: number;
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
    hp_max: options.hp,
    is_dead: false,
    conditions: [],
    sort_order: options.sortOrder,
    combat_snapshot: characterSnapshot(id, id.slice(0, 8), options.kind, options.armor),
    combat_ammo: null,
    combat_armor: { ...options.armor },
    critical_injuries: [],
  });
  assert.ifError(error);
}

interface Row {
  hp_current: number;
  hp_max: number;
  is_dead: boolean;
  combat_armor: { head: number; body: number } | null;
  critical_injuries: unknown[] | null;
  actions_remaining: number;
}

async function row(id: string): Promise<Row> {
  const { data, error } = await db!
    .from("mesa_combatants")
    .select("hp_current,hp_max,is_dead,combat_armor,critical_injuries,actions_remaining")
    .eq("id", id)
    .single();
  if (error || !data) throw error ?? new Error("combatant not found");
  return data as Row;
}

async function eventCount(): Promise<number> {
  const { data, error } = await db!.from("mesa_combats").select("event_log").eq("id", combatId).single();
  if (error || !data) throw error ?? new Error("combat not found");
  const log = (data as { event_log: unknown[] | null }).event_log;
  return Array.isArray(log) ? log.length : 0;
}

interface PostResult {
  response: Response;
  payload: Record<string, unknown>;
}

async function postPlayerDamage(token: string | undefined, body: Record<string, unknown>): Promise<PostResult> {
  const { POST } = await import("../src/app/api/mesa/[id]/combat/player-damage/route.ts");
  const request = new Request("http://localhost/api/mesa/session/combat/player-damage", {
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

async function patchCombatants(token: string, body: Record<string, unknown>): Promise<PostResult> {
  const { PATCH } = await import("../src/app/api/mesa/[id]/combatants/route.ts");
  const request = new Request("http://localhost/api/mesa/session/combatants", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-mesa-token": token },
    body: JSON.stringify(body),
  });
  const response = await PATCH(request, { params: Promise.resolve({ id: sessionId }) });
  return { response, payload: (await response.json()) as Record<string, unknown> };
}

async function patchParticipant(token: string, body: Record<string, unknown>): Promise<PostResult> {
  const { PATCH } = await import("../src/app/api/mesa/[id]/participant/route.ts");
  const request = new Request("http://localhost/api/mesa/session/participant", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-mesa-token": token },
    body: JSON.stringify(body),
  });
  const response = await PATCH(request, { params: Promise.resolve({ id: sessionId }) });
  return { response, payload: (await response.json()) as Record<string, unknown> };
}

async function postCombatHp(token: string, body: Record<string, unknown>): Promise<PostResult> {
  const { POST } = await import("../src/app/api/mesa/[id]/combat/hp/route.ts");
  const request = new Request("http://localhost/api/mesa/session/combat/hp", {
    method: "POST",
    headers: { "content-type": "application/json", "x-mesa-token": token },
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

postgresTest("Player Damage Gateway: intenção → Engine → transação → Mesa → ficha", async () => {
  /* ------------------------------ setup ---------------------------------- */

  const { error: sessionError } = await db!.from("mesa_sessions").insert({
    id: sessionId,
    name: "E2E Player Damage Gateway",
    gm_id: gmParticipantId,
    status: "active",
    join_code: sessionId.replace(/-/g, "").slice(0, 5).toUpperCase(),
  });
  assert.ifError(sessionError);

  // `mesa_combatants.character_id` é FK para a CÓPIA da ficha guardada na Mesa.
  for (const id of characterIds) {
    const { error } = await db!.from("mesa_characters").insert({
      id,
      owner_token: `owner-${randomUUID()}-token`,
      display_name: `GW ${id.slice(0, 6)}`,
      sheet: {},
    });
    assert.ifError(error);
  }

  const { error: participantError } = await db!.from("mesa_participants").insert([
    { id: gmParticipantId, session_id: sessionId, player_token: gmToken, display_name: "GW GM", character_id: null, role: "gm" },
    { id: playerParticipantId, session_id: sessionId, player_token: playerToken, display_name: "GW Player", character_id: characterId, role: "player" },
    { id: criticalParticipantId, session_id: sessionId, player_token: criticalToken, display_name: "GW Crit", character_id: criticalCharacterId, role: "player" },
    { id: mortalParticipantId, session_id: sessionId, player_token: mortalToken, display_name: "GW Mortal", character_id: mortalCharacterId, role: "player" },
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

  await insertCombatant(victimId, { kind: "character", hp: 30, armor: { head: 0, body: 0 }, participantId: playerParticipantId, characterId, sortOrder: 0 });
  await insertCombatant(armoredId, { kind: "character", hp: 30, armor: { head: 0, body: 11 }, sortOrder: 1 });
  await insertCombatant(criticalId, { kind: "character", hp: 30, armor: { head: 0, body: 0 }, participantId: criticalParticipantId, characterId: criticalCharacterId, sortOrder: 2 });
  await insertCombatant(mortalId, { kind: "character", hp: 5, armor: { head: 0, body: 0 }, participantId: mortalParticipantId, characterId: mortalCharacterId, sortOrder: 3 });
  await insertCombatant(concurrentId, { kind: "character", hp: 30, armor: { head: 0, body: 0 }, sortOrder: 4 });
  await insertCombatant(atomicId, { kind: "character", hp: 30, armor: { head: 0, body: 0 }, sortOrder: 5 });
  await insertCombatant(tamperId, { kind: "character", hp: 30, armor: { head: 0, body: 0 }, sortOrder: 6 });
  await insertCombatant(enemyId, { kind: "enemy", hp: 30, armor: { head: 0, body: 0 }, sortOrder: 7 });

  const { syncMesaCharacterState } = await import("../src/lib/mesa/characterSync.ts");
  const { createEmptyCharacter } = await import("../src/types/character.ts");

  /* ------------------- 1+2. dano externo simples e persistência ----------- */

  const plainBody = {
    resolutionId: resolution("plain"),
    targetCombatantId: victimId,
    hpBefore: 30,
    amount: 10,
    hitLocation: "body",
    sourceType: "fall",
    sourceContext: "queda do telhado",
  };
  const plain = await postPlayerDamage(gmToken, plainBody);
  assert.equal(plain.response.status, 200, JSON.stringify(plain.payload));
  assert.equal(plain.payload.ok, true);
  assert.equal(plain.payload.updated, true);
  assert.equal(plain.payload.hp, 20, "o HP devolvido vem do motor, não do cliente");
  assert.equal(plain.payload.isDead, false, "política player: dano não mata");

  const victimRow = await row(victimId);
  assert.equal(victimRow.hp_current, 20, "mesa_combatants.hp = resultado do dano");
  assert.equal(victimRow.is_dead, false);
  const eventsAfterPlain = await eventCount();
  assert.equal(eventsAfterPlain, 1, "a resolução grava UM evento no commit");

  /* --------------------------- 3. character sync -------------------------- */

  const state = (await getMesaState(playerToken)) as {
    viewer: { participantId: string | null };
    combatants: Array<Record<string, unknown>>;
  };
  assert.equal(state.viewer.participantId, playerParticipantId);
  const character = createEmptyCharacter(characterId);
  const synced = syncMesaCharacterState(character, state as never);
  assert.equal(synced.combat.hp.current, 20, "Mesa HP 20 → ficha HP 20 (syncMesaCharacterState)");
  assert.equal(synced.combat.isDead, false);

  /* -------------------- 3b. idempotência (retry do mesmo id) -------------- */

  const retry = await postPlayerDamage(gmToken, plainBody);
  assert.equal(retry.response.status, 200);
  assert.deepEqual({ ...retry.payload }, { ...plain.payload }, "retry devolve o MESMO resultado");
  assert.equal((await row(victimId)).hp_current, 20, "o dano NÃO é aplicado duas vezes");
  assert.equal(await eventCount(), eventsAfterPlain, "o retry não acrescenta evento");

  /* ---------------------------- 4. Armor ---------------------------------- */

  const armored = await postPlayerDamage(gmToken, {
    resolutionId: resolution("armor"),
    targetCombatantId: armoredId,
    hpBefore: 30,
    amount: 13,
    sourceType: "explosion",
  });
  assert.equal(armored.response.status, 200, JSON.stringify(armored.payload));
  const armoredRow = await row(armoredId);
  assert.equal(armoredRow.hp_current, 28, "13 de dano − SP 11 = 2 no HP: a armadura foi aplicada");
  assert.equal(armoredRow.combat_armor?.body, 10, "dano acima do SP degrada a veste em 1 (regra do Engine)");

  const absorbed = await postPlayerDamage(gmToken, {
    resolutionId: resolution("absorbed"),
    targetCombatantId: armoredId,
    hpBefore: 28,
    amount: 5,
  });
  assert.equal(absorbed.response.status, 200, JSON.stringify(absorbed.payload));
  const absorbedRow = await row(armoredId);
  assert.equal(absorbedRow.hp_current, 28, "dano menor que o SP é totalmente absorvido");
  assert.equal(absorbedRow.combat_armor?.body, 10, "sem penetração não há degradação");

  /* ------------------------ 5. Critical Injury ---------------------------- */

  const critical = await postPlayerDamage(gmToken, {
    resolutionId: resolution("ci"),
    targetCombatantId: criticalId,
    hpBefore: 30,
    amount: 10,
    hitLocation: "body",
    damageRolls: [6, 6],
  });
  assert.equal(critical.response.status, 200, JSON.stringify(critical.payload));
  const criticalRow = await row(criticalId);
  assert.equal((criticalRow.critical_injuries ?? []).length, 1, "2+ seis geram UMA lesão na Mesa");
  const damageResult = critical.payload.damageResult as { criticalInjury?: unknown; hpAfter: number } | undefined;
  assert.ok(damageResult?.criticalInjury, "o DamageResult expõe a lesão que este dano rolou");
  assert.equal(damageResult.hpAfter, criticalRow.hp_current, "HP persistido = HP resolvido pelo motor");
  assert.ok(criticalRow.hp_current < 20, "o bônus de dano da lesão entrou na conta");

  const criticalState = (await getMesaState(criticalToken)) as never;
  const sheet = syncMesaCharacterState(createEmptyCharacter(criticalCharacterId), criticalState);
  assert.equal(sheet.combat.criticalInjuries.length, 1, "Mesa CI = ficha CI");
  assert.equal(sheet.combat.hp.current, criticalRow.hp_current, "HP do alvo de CI também sincroniza");
  const sheetTwice = syncMesaCharacterState(sheet, criticalState);
  assert.equal(sheetTwice, sheet, "reaplicar o sync não duplica a lesão");

  /* -------------------------- 6. Mortal Wound ----------------------------- */

  const eventsBeforeMortal = await eventCount();
  const mortal = await postPlayerDamage(gmToken, {
    resolutionId: resolution("mortal"),
    targetCombatantId: mortalId,
    hpBefore: 5,
    amount: 10,
    sourceType: "chooh2",
  });
  assert.equal(mortal.response.status, 200, JSON.stringify(mortal.payload));
  const mortalRow = await row(mortalId);
  assert.equal(mortalRow.hp_current, -5, "HP ≤ 0 persistido (allowNegativeHp da política player)");
  assert.equal(mortalRow.is_dead, false, "Death Save continua sendo quem mata — dano não muda morte");
  assert.equal(await eventCount(), eventsBeforeMortal + 1, "uma resolução = um evento");

  const mortalState = (await getMesaState(mortalToken)) as never;
  const mortalCombatant = syncMesaCharacterState(createEmptyCharacter(mortalCharacterId), mortalState);
  assert.equal(mortalCombatant.combat.hp.current, -5, "HP ≤ 0 chega à ficha");
  assert.equal(mortalCombatant.combat.isDead, false);
  assert.equal(mortalCombatant.combat.deathSaveDC, 0, "deathSaveDC intocado (fora do escopo)");
  assert.equal(mortalCombatant.combat.criticalInjuries.length, 0, "Mortal Wound não injeta lesão sozinho");

  /* ------------------------ 8. client tampering --------------------------- */

  const eventsBeforeTamper = await eventCount();
  const tampered = await postPlayerDamage(gmToken, {
    resolutionId: resolution("tamper"),
    targetCombatantId: tamperId,
    hpBefore: 30,
    amount: 10,
    // Tentativas de autoridade: nenhuma pode ser lida como resultado.
    finalHp: 0,
    hp: 999,
    hpCurrent: 1,
    finalArmor: { head: 99, body: 99 },
    armor: { head: 99, body: 99 },
    criticalInjuries: [{ id: "fake" }],
    isDead: true,
    deathSaveDC: 99,
  });
  assert.equal(tampered.response.status, 400, JSON.stringify(tampered.payload));
  assert.equal(tampered.payload.code, "client_authority_forbidden");
  const tamperRow = await row(tamperId);
  assert.equal(tamperRow.hp_current, 30, "HP não mudou");
  assert.equal(tamperRow.is_dead, false, "morte não mudou");
  assert.deepEqual(tamperRow.combat_armor, { head: 0, body: 0 }, "armor não mudou");
  assert.equal((tamperRow.critical_injuries ?? []).length, 0, "lesão não mudou");
  assert.equal(await eventCount(), eventsBeforeTamper, "nada foi publicado");

  // O MESMO caminho legado que permitia HP final: PATCH /combatants.
  const legacyPatch = await patchCombatants(gmToken, { combatantId: tamperId, patch: { hpCurrent: 1, isDead: true } });
  assert.equal(legacyPatch.response.status, 409, JSON.stringify(legacyPatch.payload));
  assert.equal(legacyPatch.payload.code, "mesa_authoritative");
  assert.equal((await row(tamperId)).hp_current, 30, "caminho legado não altera HP de Player durante o combate");

  // Ferramenta do Mestre para INIMIGO continua funcionando (fora do escopo).
  const enemyPatch = await patchCombatants(gmToken, { combatantId: enemyId, patch: { hpCurrent: 12 } });
  assert.equal(enemyPatch.response.status, 200, JSON.stringify(enemyPatch.payload));
  assert.equal((await row(enemyId)).hp_current, 12, "ajuste manual de inimigo preservado");

  /* ----------------------- 7. atomicidade do commit ----------------------- */

  const eventsBeforeRefusal = await eventCount();
  const refused = await postPlayerDamage(gmToken, {
    resolutionId: resolution("refused"),
    targetCombatantId: atomicId,
    hpBefore: 30,
    amount: 0,
  });
  assert.equal(refused.response.status, 400, JSON.stringify(refused.payload));
  const refusedRow = await row(atomicId);
  assert.equal(refusedRow.hp_current, 30, "recusa do motor: HP unchanged");
  assert.deepEqual(refusedRow.combat_armor, { head: 0, body: 0 }, "Armor unchanged");
  assert.equal((refusedRow.critical_injuries ?? []).length, 0, "CI unchanged");
  assert.equal(await eventCount(), eventsBeforeRefusal, "event absent");

  // Fronteira transacional real: commit com precondição velha → rollback total.
  const failingResolutionId = resolution("commit-fail");
  const atomicClaim = await rpc<Array<{ claimed: boolean; claim_token: string }>>("claim_mesa_attack_resolution", {
    p_session_id: sessionId,
    p_combat_id: combatId,
    p_resolution_id: failingResolutionId,
  });
  assert.equal(atomicClaim[0].claimed, true);
  const eventsBeforeCommitFailure = await eventCount();
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
        p_target_patch: { hp_current: 1 },
        p_result: { updated: true },
        p_event_text: "não deveria existir",
      }),
    /hp_conflict/,
  );
  const afterFailedCommit = await row(atomicId);
  assert.equal(afterFailedCommit.hp_current, 30, "commit falhou: HP unchanged");
  assert.deepEqual(afterFailedCommit.combat_armor, { head: 0, body: 0 }, "commit falhou: Armor unchanged");
  assert.equal((afterFailedCommit.critical_injuries ?? []).length, 0, "commit falhou: CI unchanged");
  assert.equal(await eventCount(), eventsBeforeCommitFailure, "commit falhou: event absent");
  await rpc("release_mesa_attack_resolution", {
    p_session_id: sessionId,
    p_combat_id: combatId,
    p_resolution_id: failingResolutionId,
    p_claim_token: atomicClaim[0].claim_token,
  });

  /* -------------------------- 9. concorrência ----------------------------- */

  const eventsBeforeRace = await eventCount();
  const raceBody = (id: string) => ({
    resolutionId: id,
    targetCombatantId: concurrentId,
    hpBefore: 30,
    amount: 10,
  });
  const race = await Promise.all([
    postPlayerDamage(gmToken, raceBody(resolution("race-a"))),
    postPlayerDamage(gmToken, raceBody(resolution("race-b"))),
  ]);
  const statuses = race.map((entry) => entry.response.status).sort();
  assert.deepEqual(statuses, [200, 409], "exatamente uma resolução vence a corrida");
  const raceRow = await row(concurrentId);
  assert.equal(raceRow.hp_current, 20, "dano A + dano B nunca se sobrescrevem por cima (20, não 10)");
  assert.equal(await eventCount(), eventsBeforeRace + 1, "só o vencedor publica evento");

  /* -------------------------- autorizações -------------------------------- */

  const byPlayer = await postPlayerDamage(playerToken, {
    resolutionId: resolution("player"),
    targetCombatantId: victimId,
    hpBefore: 20,
    amount: 10,
  });
  assert.equal(byPlayer.response.status, 403, JSON.stringify(byPlayer.payload));
  assert.equal(byPlayer.payload.code, "gm_only");

  const legacyHpPush = await postCombatHp(playerToken, {
    hp: 1,
    hpMax: 1,
    isDead: true,
    hpBefore: 30,
  });
  assert.equal(legacyHpPush.response.status, 409, JSON.stringify(legacyHpPush.payload));
  assert.equal(legacyHpPush.payload.code, "mesa_authoritative");

  // F1.14.6: reenviar uma ficha inteira durante o combate não pode alterar a
  // cópia server-side que alimenta snapshots/resoluções futuras.
  const sheetDuringCombat = await patchParticipant(playerToken, {
    characterId,
    sheet: { id: characterId, schemaVersion: 2, combat: { hp: { current: 1, max: 1 } } },
  });
  assert.equal(sheetDuringCombat.response.status, 409, JSON.stringify(sheetDuringCombat.payload));
  assert.equal(sheetDuringCombat.payload.code, "mesa_authoritative");

  for (const patch of [
    { hpCurrent: 1 },
    { isDead: true },
    { combatArmor: { head: 99, body: 99 } },
    { combat_ammo: { pistol: 0 } },
    { actionsRemaining: 0 },
    { movementRemaining: 0 },
    { initiative: 99 },
    { criticalInjuries: [{ id: "fake" }] },
    { conditions: ["fake"] },
  ]) {
    const forbidden = await patchCombatants(playerToken, { combatantId: victimId, patch });
    assert.equal(forbidden.response.status, 403, JSON.stringify({ patch, payload: forbidden.payload }));
    assert.equal(forbidden.payload.code, "gm_only");
  }

  const noToken = await postPlayerDamage(undefined, {
    resolutionId: resolution("token"),
    targetCombatantId: victimId,
    hpBefore: 20,
    amount: 10,
  });
  assert.equal(noToken.response.status, 401);
  assert.equal(noToken.payload.code, "missing_token");

  const againstEnemy = await postPlayerDamage(gmToken, {
    resolutionId: resolution("enemy"),
    targetCombatantId: enemyId,
    hpBefore: 12,
    amount: 10,
  });
  assert.equal(againstEnemy.response.status, 400, JSON.stringify(againstEnemy.payload));
  assert.equal(againstEnemy.payload.code, "not_a_player");
  assert.equal((await row(enemyId)).hp_current, 12, "inimigo não é afetado por este gateway");

  const missingTarget = await postPlayerDamage(gmToken, {
    resolutionId: resolution("missing"),
    targetCombatantId: randomUUID(),
    hpBefore: 30,
    amount: 10,
  });
  assert.equal(missingTarget.response.status, 404);
  assert.equal(missingTarget.payload.code, "target_not_found");

  const stale = await postPlayerDamage(gmToken, {
    resolutionId: resolution("stale"),
    targetCombatantId: victimId,
    hpBefore: 30, // o victim já está com 20
    amount: 10,
  });
  assert.equal(stale.response.status, 409, JSON.stringify(stale.payload));
  assert.equal(stale.payload.code, "stale_hp");
  assert.equal((await row(victimId)).hp_current, 20, "estado defasado do cliente não move HP");
});

after(async () => {
  if (!db) return;
  await db.from("mesa_combatants").delete().in("id", combatantIds);
  await db.from("mesa_combats").delete().eq("id", combatId);
  await db.from("mesa_participants").delete().in("id", participantIds);
  await db.from("mesa_characters").delete().in("id", characterIds);
  await db.from("mesa_sessions").delete().eq("id", sessionId);
});
