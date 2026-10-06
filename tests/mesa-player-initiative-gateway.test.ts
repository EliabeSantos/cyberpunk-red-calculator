/**
 * F1.14.2 — **Player Initiative Gateway** (`POST /combat/initiative`).
 *
 * Prova as promessas da etapa contra Postgres/HTTP REAIS:
 *
 *  1. o Player registra a PRÓPRIA iniciativa e ela persiste em
 *     `mesa_combatants.initiative` (+ `initiative_detail` calculado aqui);
 *  2. o Mestre não entra por este gateway (403 `player_only`);
 *  3. registrar a iniciativa de OUTRO combatente é recusado;
 *  4. ids/token inválidos são recusados;
 *  5. sem combate ativo → 409;
 *  6. sessão encerrada → 410;
 *  7. inimigo (não é personagem) e combatente derrotado são recusados;
 *  8. idempotência: a MESMA `resolutionId` não grava duas vezes;
 *  9. já registrada → 409 `initiative_already_registered` (sem sobrescrita);
 * 10. a trava EXISTENTE `initiative_started` continua valendo → 409;
 * 11. campos derivados (ordem/turno/ações) são recusados → 400;
 * 12. valor fora do envelope da fórmula / não inteiro → 400;
 *     + o estado da Mesa leva a iniciativa à ficha (`getMesaState` → sync);
 *     + `rollInitiativeForAll` do Mestre PRESERVA o valor registrado.
 *
 * Sem SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY a suíte inteira é skipped.
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

const postgresTest = configured ? test : test.skip;

const sessionId = randomUUID();
const combatId = randomUUID();
const playerParticipantId = randomUUID();
const gmParticipantId = randomUUID();
const characterId = randomUUID();

const playerToken = `player-${randomUUID()}-token`;
const gmToken = `gm-${randomUUID()}-token`;

/** Do PRÓPIO combatente do jogador — é quem este gateway aceita registrar. */
const ownerId = randomUUID();
/** Personagem do jogador para os casos de recusa (valor nunca chega a ser gravado). */
const spareId = randomUUID();
/** Personagem sem participante — posse de outro jogador/Mestre. */
const otherId = randomUUID();
/** Inimigo do Mestre que, por engano, aponta para o participante. */
const enemyId = randomUUID();
/** Combatente derrotado. */
const deadId = randomUUID();
/** Combatente separado para o cenário de idempotência (nunca disputa o valor). */
const idemId = randomUUID();

const combatantIds = [ownerId, spareId, otherId, enemyId, deadId, idemId];
const participantIds = [gmParticipantId, playerParticipantId];

const rid = (label: string) => `player-initiative-test-${label}-${randomUUID()}`;

/** A resolução do cenário 1 — reutilizada no cenário 10 para provar que a
 * idempotência vale mesmo depois que o Mestre trancou a iniciativa. */
const REGISTER_RESOLUTION = rid("register");

interface PostResult {
  response: Response;
  payload: Record<string, unknown>;
}

async function post(
  token: string | undefined,
  body: Record<string, unknown>,
  sessionIdOverride?: string,
): Promise<PostResult> {
  const { POST } = await import("../src/app/api/mesa/[id]/combat/initiative/route.ts");
  const request = new Request("http://localhost/api/mesa/session/combat/initiative", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { "x-mesa-token": token } : {}),
    },
    body: JSON.stringify(body),
  });
  const response = await POST(request, { params: Promise.resolve({ id: sessionIdOverride ?? sessionId }) });
  return { response, payload: (await response.json()) as Record<string, unknown> };
}

async function getMesaState(token: string): Promise<Record<string, unknown>> {
  const { GET } = await import("../src/app/api/mesa/[id]/route.ts");
  const request = new Request("http://localhost/api/mesa/session", { headers: { "x-mesa-token": token } });
  const response = await GET(request, { params: Promise.resolve({ id: sessionId }) });
  const payload = (await response.json()) as { state: Record<string, unknown> };
  return payload.state;
}

interface Row {
  initiative: number | null;
  initiative_detail: { total?: number; refBonus?: number; expression?: string } | null;
}

/** Leitura DIRETA do banco — o payload do POST nunca é a prova da persistência. */
async function row(id: string): Promise<Row> {
  const { data, error } = await db!
    .from("mesa_combatants")
    .select("initiative, initiative_detail")
    .eq("id", id)
    .single();
  if (error || !data) throw error ?? new Error("combatant not found");
  return data as Row;
}

async function eventTexts(): Promise<string[]> {
  const { data, error } = await db!.from("mesa_combats").select("event_log").eq("id", combatId).single();
  if (error || !data) throw error ?? new Error("combat not found");
  const log = (data as { event_log: unknown[] | null }).event_log;
  return Array.isArray(log) ? log.map((entry) => String((entry as { text?: unknown }).text ?? "")) : [];
}

async function setInitiativeStarted(value: boolean): Promise<void> {
  const { error } = await db!.from("mesa_combats").update({ initiative_started: value }).eq("id", combatId);
  assert.ifError(error);
}

async function insertCombatant(
  id: string,
  options: {
    kind: "character" | "enemy";
    sortOrder: number;
    participantId?: string | null;
    characterId?: string | null;
    isDead?: boolean;
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
    hp_current: options.isDead ? 0 : 20,
    hp_max: 30,
    is_dead: options.isDead ?? false,
    conditions: [],
    sort_order: options.sortOrder,
    combat_snapshot: {
      id,
      type: options.kind,
      name: id.slice(0, 8),
      source: { characterId: null, sourceKey: null, enemyId: null },
      stats: { REF: 5, DEX: 5 },
      skills: {},
      weapons: [],
      combat: {
        hp: { current: 20, max: 30 },
        armor: { head: 0, body: 0 },
        criticalInjuries: [],
        conditions: [],
        initiative: null,
        isDead: false,
      },
    },
    combat_ammo: null,
    combat_armor: { head: 0, body: 0 },
    critical_injuries: [],
  });
  assert.ifError(error);
}

postgresTest("setup: mesa, participantes, combate SEM trava de iniciativa", async () => {
  const { error: e1 } = await db!.from("mesa_sessions").insert({
    id: sessionId,
    name: "F1.14.2 player initiative",
    gm_id: gmParticipantId,
    status: "active",
    join_code: sessionId.replace(/-/g, "").slice(0, 5).toUpperCase(),
  });
  assert.ifError(e1);

  // Ficha da Mesa: é de onde sai o `refBonus` do `initiative_detail`.
  const { error: e2 } = await db!.from("mesa_characters").insert({
    id: characterId,
    owner_token: `owner-${randomUUID()}-token`,
    display_name: "INIT GW",
    sheet: { stats: { REF: 5 } },
  });
  assert.ifError(e2);

  const { error: e3 } = await db!.from("mesa_participants").insert([
    { id: playerParticipantId, session_id: sessionId, player_token: playerToken, display_name: "Player", character_id: characterId, role: "player" },
    { id: gmParticipantId, session_id: sessionId, player_token: gmToken, display_name: "GM", character_id: null, role: "gm" },
  ]);
  assert.ifError(e3);

  const { error: e4 } = await db!.from("mesa_combats").insert({
    id: combatId,
    session_id: sessionId,
    status: "active",
    round: 1,
    active_combatant_id: null,
    initiative_started: false,
    event_log: [],
  });
  assert.ifError(e4);

  await insertCombatant(ownerId, { kind: "character", sortOrder: 0, participantId: playerParticipantId, characterId });
  await insertCombatant(spareId, { kind: "character", sortOrder: 1, participantId: playerParticipantId });
  await insertCombatant(otherId, { kind: "character", sortOrder: 2 });
  await insertCombatant(enemyId, { kind: "enemy", sortOrder: 3, participantId: playerParticipantId });
  await insertCombatant(deadId, { kind: "character", sortOrder: 4, participantId: playerParticipantId, isDead: true });
  await insertCombatant(idemId, { kind: "character", sortOrder: 5, participantId: playerParticipantId });
});

postgresTest("1. Player registra a própria iniciativa → 200 e persiste no servidor", async () => {
  const before = await eventTexts();
  const { response, payload } = await post(playerToken, {
    resolutionId: REGISTER_RESOLUTION,
    actorCombatantId: ownerId,
    initiative: 17,
  });

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true);
  assert.equal(payload.kind, "initiative");
  assert.equal(payload.combatantId, ownerId);
  assert.equal(payload.initiative, 17, "o servidor devolve o valor que ELE gravou");
  assert.equal(payload.registered, true);
  assert.equal(payload.committed, true);

  const stored = await row(ownerId);
  assert.equal(stored.initiative, 17, "mesa_combatants.initiative = 17");
  assert.equal(stored.initiative_detail?.total, 17);
  assert.equal(stored.initiative_detail?.refBonus, 5, "refBonus lido da ficha guardada na Mesa, não do request");

  const events = await eventTexts();
  assert.equal(events.length, before.length + 1, "um registro = um evento");
  assert.match(events[events.length - 1], /iniciativa registrada/i);
  assert.match(events[events.length - 1], /17/);
});

postgresTest("8. retry idempotente → mesmo resultado, sem gravar de novo", async () => {
  const resolutionId = rid("replay");
  const first = await post(playerToken, { resolutionId, actorCombatantId: idemId, initiative: 21 });
  assert.equal(first.response.status, 200, JSON.stringify(first.payload));
  assert.equal(first.payload.committed, true);
  assert.equal((await row(idemId)).initiative, 21, "primeira gravação");

  const eventsAfterFirst = await eventTexts();
  const second = await post(playerToken, { resolutionId, actorCombatantId: idemId, initiative: 21 });
  assert.equal(second.response.status, 200, JSON.stringify(second.payload));
  const { committed: firstCommitted, ...firstBody } = first.payload;
  const { committed: secondCommitted, ...secondBody } = second.payload;
  assert.equal(firstCommitted, true, "primeira gravação commitada");
  assert.equal(secondCommitted, false, "replay não reexecuta");
  assert.deepEqual(secondBody, firstBody, "retry devolve o MESMO resultado");
  assert.equal((await row(idemId)).initiative, 21, "a iniciativa NÃO foi regravada");
  assert.equal((await eventTexts()).length, eventsAfterFirst.length, "o retry não acrescenta evento");
});

postgresTest("2. Mestre é recusado (403 player_only); corpo vazio não vira rolagem", async () => {
  const gm = await post(gmToken, {
    resolutionId: rid("gm"),
    actorCombatantId: ownerId,
    initiative: 3,
  });
  assert.equal(gm.response.status, 403, JSON.stringify(gm.payload));
  assert.equal(gm.payload.code, "player_only");

  // Corpo vazio = operação legada do Mestre. Um Player não entra nela por acidente.
  const empty = await post(playerToken, {});
  assert.equal(empty.response.status, 403, JSON.stringify(empty.payload));
  assert.equal(empty.payload.code, "gm_only", "o caminho do Mestre continua sendo só do Mestre");
  assert.equal((await row(ownerId)).initiative, 17, "nada mudou");
});

postgresTest("3. registrar iniciativa de OUTRO combatente → 403 combatant_not_owned", async () => {
  const { response, payload } = await post(playerToken, {
    resolutionId: rid("not-owned"),
    actorCombatantId: otherId,
    initiative: 12,
  });
  assert.equal(response.status, 403, JSON.stringify(payload));
  assert.equal(payload.code, "combatant_not_owned");
  assert.equal((await row(otherId)).initiative, null, "nada foi gravado no combatente alheio");
});

postgresTest("4. ids e token inválidos → 404 / 401", async () => {
  const unknownCombatant = await post(playerToken, {
    resolutionId: rid("unknown-combatant"),
    actorCombatantId: randomUUID(),
    initiative: 12,
  });
  assert.equal(unknownCombatant.response.status, 404);
  assert.equal(unknownCombatant.payload.code, "combatant_not_found");

  const unknownSession = await post(
    playerToken,
    { resolutionId: rid("unknown-session"), actorCombatantId: ownerId, initiative: 12 },
    randomUUID(),
  );
  assert.equal(unknownSession.response.status, 404);
  assert.equal(unknownSession.payload.code, "session_not_found");

  const withoutToken = await post(undefined, {
    resolutionId: rid("no-token"),
    actorCombatantId: ownerId,
    initiative: 12,
  });
  assert.equal(withoutToken.response.status, 401);
  assert.equal(withoutToken.payload.code, "missing_token");

  const stranger = await post(`stranger-${randomUUID()}-token`, {
    resolutionId: rid("stranger"),
    actorCombatantId: ownerId,
    initiative: 12,
  });
  assert.equal(stranger.response.status, 403);
  assert.equal(stranger.payload.code, "not_participant");

  assert.equal((await row(ownerId)).initiative, 17, "nenhuma recusa alterou a iniciativa");
});

postgresTest("7. inimigo (não é personagem) e combatente derrotado → recusa", async () => {
  const enemy = await post(playerToken, {
    resolutionId: rid("enemy"),
    actorCombatantId: enemyId,
    initiative: 14,
  });
  assert.equal(enemy.response.status, 400, JSON.stringify(enemy.payload));
  assert.equal(enemy.payload.code, "not_a_player");
  assert.equal((await row(enemyId)).initiative, null);

  const dead = await post(playerToken, {
    resolutionId: rid("dead"),
    actorCombatantId: deadId,
    initiative: 14,
  });
  assert.equal(dead.response.status, 403, JSON.stringify(dead.payload));
  assert.equal(dead.payload.code, "combatant_defeated");
  assert.equal((await row(deadId)).initiative, null);
});

postgresTest("9. valor já registrado → 409 initiative_already_registered (sem sobrescrita)", async () => {
  const { response, payload } = await post(playerToken, {
    resolutionId: rid("already"),
    actorCombatantId: ownerId,
    initiative: 4,
  });
  assert.equal(response.status, 409, JSON.stringify(payload));
  assert.equal(payload.code, "initiative_already_registered");
  assert.equal((await row(ownerId)).initiative, 17, "o valor original continua intacto");
});

postgresTest("11. cliente não manda ordem/turno/ações → 400 client_authority_forbidden", async () => {
  const forbidden = [
    { initiativeOrder: [ownerId] },
    { activeCombatant: ownerId },
    { activeCombatantId: ownerId },
    { turn: 3 },
    { round: 3 },
    { actionsRemaining: 2 },
    { sortOrder: 9 },
    { initiativeDetail: { total: 30 } },
    { initiativeStarted: true },
    { eventLog: [] },
  ];
  for (const extra of forbidden) {
    const { response, payload } = await post(playerToken, {
      resolutionId: rid(`forbidden-${Object.keys(extra)[0]}`),
      actorCombatantId: spareId,
      initiative: 11,
      ...extra,
    });
    assert.equal(response.status, 400, `${JSON.stringify(extra)} → ${JSON.stringify(payload)}`);
    assert.equal(payload.code, "client_authority_forbidden", JSON.stringify(extra));
  }
  // Autoridade de resultado do cliente (HP/armadura/lesão) também continua proibida.
  const hp = await post(playerToken, {
    resolutionId: rid("forbidden-hp"),
    actorCombatantId: spareId,
    initiative: 11,
    hpAfter: 99,
  });
  assert.equal(hp.response.status, 400);
  assert.equal(hp.payload.code, "client_authority_forbidden");

  assert.equal((await row(spareId)).initiative, null, "nada foi gravado");
});

postgresTest("12. valor fora do envelope / não inteiro → 400 invalid_initiative", async () => {
  for (const value of [2.5, "11", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 31, -11, 999]) {
    const { response, payload } = await post(playerToken, {
      resolutionId: rid(`value-${String(value)}`),
      actorCombatantId: spareId,
      initiative: value,
    });
    assert.equal(response.status, 400, `initiative=${JSON.stringify(value)} → ${JSON.stringify(payload)}`);
    assert.equal(payload.code, "invalid_initiative", `initiative=${JSON.stringify(value)}`);
  }

  // Limites do envelope, aceitos (e gravados) — inclusive o negativo.
  for (const value of [-10, 0, 30]) {
    await db!.from("mesa_combatants").update({ initiative: null, initiative_detail: null }).eq("id", spareId);
    const { response, payload } = await post(playerToken, {
      resolutionId: rid(`edge-${value}`),
      actorCombatantId: spareId,
      initiative: value,
    });
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.equal((await row(spareId)).initiative, value);
  }
  await db!.from("mesa_combatants").update({ initiative: null, initiative_detail: null }).eq("id", spareId);

  const missingResolution = await post(playerToken, {
    actorCombatantId: spareId,
    initiative: 11,
  });
  assert.equal(missingResolution.response.status, 400);
  assert.equal(missingResolution.payload.code, "invalid_resolution_id");
  assert.equal((await row(spareId)).initiative, null, "nenhuma tentativa deixou valor para trás");
});

postgresTest("10. trava do Mestre (initiative_started) → 409 initiative_already_rolled", async () => {
  await setInitiativeStarted(true);
  const { response, payload } = await post(playerToken, {
    resolutionId: rid("after-gm-roll"),
    actorCombatantId: spareId,
    initiative: 15,
  });
  assert.equal(response.status, 409, JSON.stringify(payload));
  assert.equal(payload.code, "initiative_already_rolled");
  assert.equal((await row(spareId)).initiative, null, "a trava bloqueia o registro");

  // Um retry de uma resolução JÁ resolvida não é recusado pela trava: a
  // idempotência vem antes, então o cliente recebe o resultado gravado.
  const replay = await post(playerToken, {
    resolutionId: REGISTER_RESOLUTION,
    actorCombatantId: ownerId,
    initiative: 17,
  });
  assert.equal(replay.response.status, 200, JSON.stringify(replay.payload));
  assert.equal(replay.payload.committed, false, "retry devolve o resultado já gravado");
  assert.equal(replay.payload.initiative, 17);
  assert.equal((await row(ownerId)).initiative, 17, "nada foi regravado");

  await setInitiativeStarted(false);
});

postgresTest("5. combate inativo → 409 combat_not_active", async () => {
  const { error } = await db!.from("mesa_combats").update({ status: "finished" }).eq("id", combatId);
  assert.ifError(error);
  const { response, payload } = await post(playerToken, {
    resolutionId: rid("no-combat"),
    actorCombatantId: spareId,
    initiative: 13,
  });
  assert.equal(response.status, 409, JSON.stringify(payload));
  assert.equal(payload.code, "combat_not_active");
  assert.equal((await row(spareId)).initiative, null);
  const restore = await db!.from("mesa_combats").update({ status: "active" }).eq("id", combatId);
  assert.ifError(restore.error);
});

postgresTest("6. sessão encerrada → 410 session_finished", async () => {
  const { error } = await db!.from("mesa_sessions").update({ status: "finished" }).eq("id", sessionId);
  assert.ifError(error);
  const { response, payload } = await post(playerToken, {
    resolutionId: rid("session-finished"),
    actorCombatantId: spareId,
    initiative: 13,
  });
  assert.equal(response.status, 410, JSON.stringify(payload));
  assert.equal(payload.code, "session_finished");
  assert.equal((await row(spareId)).initiative, null);
  const restore = await db!.from("mesa_sessions").update({ status: "active" }).eq("id", sessionId);
  assert.ifError(restore.error);
});

postgresTest("retorno: estado da Mesa leva a iniciativa até a ficha do Player", async () => {
  const state = (await getMesaState(playerToken)) as {
    viewer: { participantId: string | null };
    combatants: Array<Record<string, unknown>>;
  };
  assert.equal(state.viewer.participantId, playerParticipantId);
  const entry = state.combatants.find((combatant) => combatant.id === ownerId);
  assert.ok(entry, "o combatente do Player aparece no estado");
  assert.equal(entry?.initiative, 17, "GET /api/mesa/[id] devolve a iniciativa gravada");
  assert.equal((entry?.initiativeDetail as { total?: number } | null)?.total, 17);

  const { syncMesaCharacterState } = await import("../src/lib/mesa/characterSync.ts");
  const { createEmptyCharacter } = await import("../src/types/character.ts");
  const synced = syncMesaCharacterState(createEmptyCharacter(characterId), state as never);
  assert.equal(synced.combat.initiative, 17, "syncMesaCharacterState projeta a iniciativa na ficha");
});

postgresTest("14. rollInitiativeForAll do Mestre PRESERA a iniciativa já registrada", async () => {
  const before = await row(ownerId);
  assert.equal(before.initiative, 17);

  const { response, payload } = await post(gmToken, {});
  assert.equal(response.status, 200, JSON.stringify(payload));

  const owner = await row(ownerId);
  assert.equal(owner.initiative, 17, "o valor registrado pelo Player não é descartado pela rolagem do Mestre");
  assert.deepEqual(owner.initiative_detail, before.initiative_detail, "nem o detail");
  assert.equal((await row(idemId)).initiative, 21, "idem: valores registrados pelo gateway são preservados");

  for (const id of [spareId, otherId, enemyId]) {
    const entry = await row(id);
    assert.equal(typeof entry.initiative, "number", `${id} rolado pela rolagem coletiva`);
  }

  const { data: combat, error } = await db!.from("mesa_combats").select("initiative_started, active_combatant_id").eq("id", combatId).single();
  assert.ifError(error);
  assert.equal((combat as { initiative_started: boolean }).initiative_started, true, "a rolagem do Mestre abre o turno como sempre");
  assert.ok((combat as { active_combatant_id: string | null }).active_combatant_id, "um combatente ficou ativo");

  // A trava agora vale para todo mundo — inclusive para o Player.
  const after = await post(playerToken, {
    resolutionId: rid("after-lock"),
    actorCombatantId: spareId,
    initiative: 9,
  });
  assert.equal(after.response.status, 409);
  assert.equal(after.payload.code, "initiative_already_rolled");
});

after(async () => {
  if (!db) return;
  await db.from("mesa_attack_resolutions").delete().eq("session_id", sessionId);
  await db.from("mesa_combatants").delete().in("id", combatantIds);
  await db.from("mesa_combats").delete().eq("id", combatId);
  await db.from("mesa_participants").delete().in("id", participantIds);
  await db.from("mesa_characters").delete().eq("id", characterId);
  await db.from("mesa_sessions").delete().eq("id", sessionId);
});
