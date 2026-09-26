/**
 * Camada de dados + regras de autorização da Mesa (SOMENTE SERVIDOR).
 *
 * Toda mutação passa por aqui. A ordem é sempre a mesma:
 *
 *   1. autenticar o participante pelo playerToken enviado no header;
 *   2. buscar o estado ATUAL no banco (nunca aceitar o estado do navegador);
 *   3. validar papel (gm/player), posse do combatente e turno;
 *   4. aplicar a regra pura do Combat Engine (`src/lib/combatEngine.ts`);
 *   5. gravar e publicar o novo estado no Realtime.
 *
 * Se qualquer passo falhar, lança `MesaError` e NADA é alterado.
 *
 * Sem `import "server-only"` para os testes importarem as funções puras fora
 * do bundler; o módulo só é alcançado pelas rotas /api/mesa.
 */

import {
  ACTIONS_PER_TURN,
  MOVEMENT_PER_TURN,
  advanceTurn,
  applyAction,
  movementMetersPerTurn,
  resolveAction,
  rollEnemyInitiative,
  sortByInitiative,
  type CombatActionType,
} from "@/lib/combatEngine";
import { getCyberwareMoveModifier } from "@/lib/cyberwareEffects";
import { generateJoinCode, normalizeJoinCode } from "@/lib/mesa/joinCode";
import type {
  MesaCombat,
  MesaCombatant,
  MesaEvent,
  MesaParticipant,
  MesaSession,
  MesaState,
} from "@/lib/mesa/types";
import { DatabaseQueryError, getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ACTION_LABELS, DENIAL_MESSAGES } from "@/lib/mesa/messages";
import { formatRollEvent, MESA_ROLL_ACTION, parseMesaRoll, rollDenialNote } from "@/lib/mesa/rollPolicy";
import { rollInitiative } from "@/lib/initiative";
import type { Character } from "@/types/character";

/** Erro de domínio com status HTTP correspondente. */
export class MesaError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "invalid_request") {
    super(message);
    this.name = "MesaError";
    this.status = status;
    this.code = code;
  }
}

const MAX_EVENT_LOG = 50;
const JOIN_CODE_ATTEMPTS = 6;

// ---------------------------------------------------------------------------
// Helpers de leitura/escrita
// ---------------------------------------------------------------------------

function db() {
  return getSupabaseAdmin();
}

function sanitizeDisplayName(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (value.length < 1 || value.length > 40) {
    throw new MesaError("Informe um nome de exibição com 1 a 40 caracteres.", 400, "invalid_display_name");
  }
  return value;
}

function sanitizeSessionName(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (value.length < 1 || value.length > 60) {
    throw new MesaError("Informe um nome de mesa com 1 a 60 caracteres.", 400, "invalid_session_name");
  }
  return value;
}

function requireToken(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length < 16) {
    throw new MesaError("Token de jogador ausente ou inválido.", 401, "missing_token");
  }
  return raw.trim();
}

async function query<T>(
  promise: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  context: string,
): Promise<T | null> {
  const { data, error } = await promise;
  if (error) throw new DatabaseQueryError(`${context}: ${error.message}`);
  return data;
}

interface SessionRow {
  id: string;
  name: string;
  gm_id: string | null;
  status: MesaSession["status"];
  join_code: string;
  created_at: string;
}

interface ParticipantRow {
  id: string;
  session_id: string;
  player_token: string;
  display_name: string;
  character_id: string | null;
  role: MesaParticipant["role"];
  created_at: string;
  connected_at: string;
}

interface CombatRow {
  id: string;
  session_id: string;
  status: MesaCombat["status"];
  round: number;
  active_combatant_id: string | null;
  turn_started_at: string | null;
  initiative_started: boolean;
  event_log: MesaEvent[] | null;
  created_at: string;
}

interface CombatantRow {
  id: string;
  combat_id: string;
  session_id: string;
  kind: MesaCombatant["kind"];
  character_id: string | null;
  participant_id: string | null;
  name: string;
  initiative: number | null;
  initiative_detail: MesaCombatant["initiativeDetail"];
  actions_max: number;
  actions_remaining: number;
  movement_max: number;
  movement_remaining: number;
  hp_current: number;
  hp_max: number;
  is_dead: boolean;
  conditions: string[] | null;
  sort_order: number;
}

function toSession(row: SessionRow): MesaSession {
  return {
    id: row.id,
    name: row.name,
    gmId: row.gm_id,
    status: row.status,
    joinCode: row.join_code,
    createdAt: row.created_at,
  };
}

function toParticipant(row: ParticipantRow): MesaParticipant {
  return {
    id: row.id,
    sessionId: row.session_id,
    displayName: row.display_name,
    characterId: row.character_id,
    role: row.role,
    connectedAt: row.connected_at,
  };
}

function toCombat(row: CombatRow): MesaCombat {
  return {
    id: row.id,
    sessionId: row.session_id,
    status: row.status,
    round: row.round,
    activeCombatantId: row.active_combatant_id,
    turnStartedAt: row.turn_started_at,
    initiativeStarted: row.initiative_started,
    eventLog: Array.isArray(row.event_log) ? row.event_log : [],
    createdAt: row.created_at,
  };
}

function toCombatant(row: CombatantRow): MesaCombatant {
  return {
    id: row.id,
    combatId: row.combat_id,
    sessionId: row.session_id,
    kind: row.kind,
    characterId: row.character_id,
    participantId: row.participant_id,
    name: row.name,
    initiative: row.initiative,
    initiativeDetail: row.initiative_detail ?? null,
    actionsMax: row.actions_max,
    actionsRemaining: row.actions_remaining,
    movementMax: row.movement_max,
    movementRemaining: row.movement_remaining,
    hpCurrent: row.hp_current,
    hpMax: row.hp_max,
    isDead: row.is_dead,
    conditions: Array.isArray(row.conditions) ? row.conditions : [],
    sortOrder: row.sort_order,
  };
}

// ---------------------------------------------------------------------------
// Autenticação / autorização
// ---------------------------------------------------------------------------

export interface Actor {
  session: MesaSession;
  participant: MesaParticipant;
}

/** Localiza a sessão pelo id e autentica o participante pelo playerToken. */
export async function authenticate(sessionId: unknown, tokenRaw: unknown): Promise<Actor> {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new MesaError("Mesa não encontrada.", 404, "session_not_found");
  }
  const token = requireToken(tokenRaw);

  const sessionRow = await query(
    db().from("mesa_sessions").select("*").eq("id", sessionId).maybeSingle(),
    "Falha ao consultar a mesa",
  );
  if (!sessionRow) throw new MesaError("Mesa não encontrada.", 404, "session_not_found");

  const participantRow = await query(
    db()
      .from("mesa_participants")
      .select("*")
      .eq("session_id", sessionId)
      .eq("player_token", token)
      .maybeSingle(),
    "Falha ao consultar o participante",
  );
  if (!participantRow) {
    throw new MesaError("Você não participa desta mesa.", 403, "not_participant");
  }

  return { session: toSession(sessionRow as SessionRow), participant: toParticipant(participantRow as ParticipantRow) };
}

/** Exige papel de Mestre — validado no banco, não escondendo botões. */
export function requireGM(actor: Actor): void {
  if (actor.participant.role !== "gm") {
    throw new MesaError("Apenas o Mestre pode executar esta ação.", 403, "gm_only");
  }
}

function requireActiveSession(session: MesaSession): void {
  if (session.status === "finished") {
    throw new MesaError("Esta sessão foi encerrada.", 410, "session_finished");
  }
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

/** Estado completo da mesa, do ponto de vista de quem pede. */
export async function getMesaState(sessionId: string, viewerParticipantId: string | null): Promise<MesaState> {
  const [sessionRow, participantsRow, combatRow, combatantsRow] = await Promise.all([
    query(db().from("mesa_sessions").select("*").eq("id", sessionId).maybeSingle(), "Falha ao consultar a mesa"),
    query(db().from("mesa_participants").select("*").eq("session_id", sessionId).order("created_at"), "Falha ao consultar participantes"),
    query(db().from("mesa_combats").select("*").eq("session_id", sessionId).maybeSingle(), "Falha ao consultar o combate"),
    query(
      db().from("mesa_combatants").select("*").eq("session_id", sessionId).order("sort_order"),
      "Falha ao consultar combatentes",
    ),
  ]);

  if (!sessionRow) throw new MesaError("Mesa não encontrada.", 404, "session_not_found");

  const viewerRow = (participantsRow ?? []).find((row) => row.id === viewerParticipantId);

  return {
    session: toSession(sessionRow as SessionRow),
    participants: (participantsRow ?? []).map((row) => toParticipant(row as ParticipantRow)),
    combat: combatRow ? toCombat(combatRow as CombatRow) : null,
    combatants: (combatantsRow ?? []).map((row) => toCombatant(row as CombatantRow)),
    viewer: viewerRow
      ? {
          participantId: viewerRow.id,
          role: viewerRow.role,
          displayName: viewerRow.display_name,
        }
      : { participantId: null, role: null, displayName: null },
  };
}

/** Estado sem o bloco `viewer` — é o que vai para o Realtime (é igual para todos). */
export type BroadcastState = Omit<MesaState, "viewer">;

export async function getBroadcastState(sessionId: string): Promise<BroadcastState> {
  const state = await getMesaState(sessionId, null);
  return {
    session: state.session,
    participants: state.participants,
    combat: state.combat,
    combatants: state.combatants,
  };
}

// ---------------------------------------------------------------------------
// Criar / entrar na mesa
// ---------------------------------------------------------------------------

async function insertParticipant(
  sessionId: string,
  playerToken: string,
  displayName: string,
  role: MesaParticipant["role"],
): Promise<MesaParticipant> {
  const row = await query(
    db()
      .from("mesa_participants")
      .insert({
        session_id: sessionId,
        player_token: playerToken,
        display_name: displayName,
        role,
      })
      .select("*")
      .single(),
    "Falha ao criar o participante",
  );
  if (!row) throw new MesaError("Não foi possível criar o participante.", 500, "participant_failed");
  return toParticipant(row as unknown as ParticipantRow);
}

/** Cria a mesa e o participante Mestre. Tenta novos códigos em caso de colisão. */
export async function createMesa(input: {
  name: unknown;
  displayName: unknown;
  playerToken: unknown;
}): Promise<{ session: MesaSession; participant: MesaParticipant }> {
  const name = sanitizeSessionName(input.name);
  const displayName = sanitizeDisplayName(input.displayName);
  const playerToken = requireToken(input.playerToken);

  let sessionRow: SessionRow | null = null;
  let lastError: { message: string } | null = null;

  for (let attempt = 0; attempt < JOIN_CODE_ATTEMPTS && !sessionRow; attempt += 1) {
    const joinCode = generateJoinCode();
    const { data, error } = await db()
      .from("mesa_sessions")
      .insert({ name, join_code: joinCode, status: "lobby" })
      .select("*")
      .single();
    if (error) {
      // Colisão de código único → tenta outro; outros erros interrompem.
      if (error.message.includes("duplicate key")) {
        lastError = error;
        continue;
      }
      throw new DatabaseQueryError(`Falha ao criar a mesa: ${error.message}`);
    }
    sessionRow = data as unknown as SessionRow;
    lastError = null;
  }

  if (!sessionRow) {
    throw new DatabaseQueryError(`Falha ao gerar um código de mesa único: ${lastError?.message ?? "sem tentativas"}`);
  }

  try {
    const participant = await insertParticipant(sessionRow.id, playerToken, displayName, "gm");
    await query(
      db().from("mesa_sessions").update({ gm_id: participant.id, updated_at: new Date().toISOString() }).eq("id", sessionRow.id),
      "Falha ao registrar o Mestre",
    );
    return { session: { ...toSession(sessionRow), gmId: participant.id }, participant };
  } catch (error) {
    // Remove a órfã para não deixar mesa sem Mestre.
    await db().from("mesa_sessions").delete().eq("id", sessionRow.id);
    throw error;
  }
}

/** Entra na mesa pelo código. Idempotente: mesmo token entra como mesmo participante. */
export async function joinMesa(input: {
  joinCode: unknown;
  displayName: unknown;
  playerToken: unknown;
}): Promise<{ session: MesaSession; participant: MesaParticipant }> {
  const joinCode = normalizeJoinCode(input.joinCode);
  if (!joinCode) throw new MesaError("Código de mesa inválido.", 400, "invalid_join_code");

  const displayName = sanitizeDisplayName(input.displayName);
  const playerToken = requireToken(input.playerToken);

  const sessionRow = (await query(
    db().from("mesa_sessions").select("*").eq("join_code", joinCode).maybeSingle(),
    "Falha ao consultar a mesa",
  )) as SessionRow | null;
  if (!sessionRow) throw new MesaError("Mesa não encontrada com este código.", 404, "session_not_found");
  if (sessionRow.status === "finished") throw new MesaError("Esta sessão foi encerrada.", 410, "session_finished");

  const existing = (await query(
    db()
      .from("mesa_participants")
      .select("*")
      .eq("session_id", sessionRow.id)
      .eq("player_token", playerToken)
      .maybeSingle(),
    "Falha ao consultar o participante",
  )) as ParticipantRow | null;

  if (existing) {
    const updated = (await query(
      db()
        .from("mesa_participants")
        .update({ connected_at: new Date().toISOString(), display_name: displayName })
        .eq("id", existing.id)
        .select("*")
        .single(),
      "Falha ao atualizar o participante",
    )) as ParticipantRow | null;
    return { session: toSession(sessionRow), participant: toParticipant(updated ?? existing) };
  }

  const participant = await insertParticipant(sessionRow.id, playerToken, displayName, "player");
  return { session: toSession(sessionRow), participant };
}

// ---------------------------------------------------------------------------
// Personagem ↔ sessão
// ---------------------------------------------------------------------------

interface SheetRow {
  id: string;
  owner_token: string;
  display_name: string;
  sheet: Character;
}

/** Guard mínimo: só o que o motor precisa para calcular no servidor. */
function assertCharacterSheet(value: unknown, expectedId: string): Character {
  if (typeof value !== "object" || value === null) {
    throw new MesaError("Ficha de personagem inválida.", 400, "invalid_sheet");
  }
  const sheet = value as Partial<Character>;
  if (sheet.id !== expectedId) {
    throw new MesaError("A ficha enviada não corresponde ao personagem.", 400, "invalid_sheet");
  }
  if (sheet.schemaVersion !== 2) {
    throw new MesaError("Ficha em versão antiga: edite e salve o personagem novamente.", 400, "sheet_version");
  }
  const stats = sheet.stats;
  if (!stats || typeof stats.REF !== "number" || typeof stats.BODY !== "number" || typeof stats.WILL !== "number") {
    throw new MesaError("Ficha sem atributos obrigatórios.", 400, "invalid_sheet");
  }
  const hp = sheet.combat?.hp;
  if (!hp || typeof hp.current !== "number" || typeof hp.max !== "number") {
    throw new MesaError("Ficha sem HP.", 400, "invalid_sheet");
  }
  return sheet as Character;
}

/**
 * Vincula (ou desvincula) um personagem ao participante.
 *
 * A ficha NÃO é duplicada como entidade: guardamos uma cópia do `sheet` para o
 * servidor poder validar cálculos. O personagem de verdade continua no
 * localStorage do jogador e continua funcionando sozinho no modo local.
 */
export async function linkCharacter(input: {
  sessionId: unknown;
  token: unknown;
  characterId: unknown;
  sheet?: unknown;
}): Promise<MesaParticipant> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireActiveSession(session);

  if (input.characterId === null || input.characterId === undefined || input.characterId === "") {
    const cleared = (await query(
      db().from("mesa_participants").update({ character_id: null }).eq("id", participant.id).select("*").single(),
      "Falha ao desvincular o personagem",
    )) as ParticipantRow | null;
    return toParticipant(cleared as ParticipantRow);
  }

  if (typeof input.characterId !== "string") {
    throw new MesaError("Personagem inválido.", 400, "invalid_character");
  }
  const sheet = assertCharacterSheet(input.sheet, input.characterId);

  const token = requireToken(input.token);

  const existing = (await query(
    db().from("mesa_characters").select("*").eq("id", input.characterId).maybeSingle(),
    "Falha ao consultar o personagem",
  )) as SheetRow | null;

  if (existing && existing.owner_token !== token) {
    // Uma ficha só pode ser atualizada por quem a enviou originalmente.
    throw new MesaError("Esta ficha pertence a outro jogador.", 403, "character_owner_mismatch");
  }

  const display = sheet.identity?.name?.trim() || "Personagem";

  await query(
    db()
      .from("mesa_characters")
      .upsert(
        {
          id: input.characterId,
          owner_token: token,
          display_name: display.slice(0, 60),
          sheet,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      )
      .select("id"),
    "Falha ao salvar a ficha",
  );

  const updated = (await query(
    db().from("mesa_participants").update({ character_id: input.characterId }).eq("id", participant.id).select("*").single(),
    "Falha ao vincular o personagem",
  )) as ParticipantRow | null;

  return toParticipant(updated as ParticipantRow);
}

// ---------------------------------------------------------------------------
// Combate
// ---------------------------------------------------------------------------

async function getActiveCombat(sessionId: string): Promise<CombatRow | null> {
  const row = (await query(
    db().from("mesa_combats").select("*").eq("session_id", sessionId).maybeSingle(),
    "Falha ao consultar o combate",
  )) as CombatRow | null;
  return row && row.status === "active" ? row : null;
}

async function appendEvent(combatId: string, event: Omit<MesaEvent, "at">, currentLog: MesaEvent[]): Promise<void> {
  const next = [...currentLog, { at: new Date().toISOString(), ...event }].slice(-MAX_EVENT_LOG);
  await query(
    db().from("mesa_combats").update({ event_log: next, updated_at: new Date().toISOString() }).eq("id", combatId),
    "Falha ao registrar o evento",
  );
}

async function loadSheet(characterId: string): Promise<Character | null> {
  const row = (await query(
    db().from("mesa_characters").select("sheet").eq("id", characterId).maybeSingle(),
    "Falha ao consultar a ficha",
  )) as { sheet: Character } | null;
  return row?.sheet ?? null;
}

/**
 * Orçamento de movimento de um personagem: **MOVE × 2 metros por turno**,
 * já com o bônus de cyberware ativo (ex.: Adrenaline Booster +2 MOVE → 4 m a mais).
 *
 * Ficha sem STAT MOVE usada (só pode acontecer com dado corrompido) cai no
 * fallback do motor (6 m) em vez de zerar o personagem.
 */
function movementBudgetFor(sheet: Character): number {
  const move = sheet.stats?.MOVE;
  if (typeof move !== "number" || !Number.isFinite(move)) return MOVEMENT_PER_TURN;
  // Ficha antiga pode vir sem a lista de cyberware: não derruba o combate por isso.
  const cyberware = Array.isArray(sheet.cyberware) ? sheet.cyberware : [];
  return movementMetersPerTurn(move + getCyberwareMoveModifier({ cyberware }));
}

/** Reinicia (ou cria) o combate da mesa e monta os combatentes vinculados. */
export async function startCombat(input: {
  sessionId: unknown;
  token: unknown;
  enemies?: unknown;
}): Promise<void> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireGM({ session, participant });
  requireActiveSession(session);

  const existingCombat = (await query(
    db().from("mesa_combats").select("*").eq("session_id", session.id).maybeSingle(),
    "Falha ao consultar o combate",
  )) as CombatRow | null;
  if (existingCombat && existingCombat.status === "active") {
    throw new MesaError("Já existe um combate ativo nesta mesa.", 409, "combat_already_active");
  }

  const participantsRow = (await query(
    db().from("mesa_participants").select("*").eq("session_id", session.id),
    "Falha ao consultar participantes",
  )) as ParticipantRow[];

  const linked = participantsRow.filter((row) => row.character_id);
  const enemies = sanitizeEnemies(input.enemies);
  if (linked.length === 0 && enemies.length === 0) {
    throw new MesaError("Vincule ao menos um personagem ou inimigo antes de iniciar o combate.", 400, "no_combatants");
  }

  // Reutiliza a linha de combate (session_id é único) para permitir um novo
  // combate depois de um anterior encerrado.
  let combatId: string;
  if (existingCombat) {
    await query(db().from("mesa_combatants").delete().eq("combat_id", existingCombat.id), "Falha ao limpar combatentes");
    const reset = (await query(
      db()
        .from("mesa_combats")
        .update({
          status: "active",
          round: 1,
          active_combatant_id: null,
          turn_started_at: null,
          initiative_started: false,
          event_log: [],
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingCombat.id)
        .select("*")
        .single(),
      "Falha ao reiniciar o combate",
    )) as CombatRow | null;
    combatId = (reset ?? existingCombat).id;
  } else {
    const created = (await query(
      db()
        .from("mesa_combats")
        .insert({ session_id: session.id, status: "active", round: 1, initiative_started: false, event_log: [] })
        .select("*")
        .single(),
      "Falha ao criar o combate",
    )) as CombatRow | null;
    if (!created) throw new MesaError("Não foi possível iniciar o combate.", 500, "combat_failed");
    combatId = created.id;
  }

  const rows: Record<string, unknown>[] = [];
  let sortOrder = 0;

  for (const row of participantsRow) {
    if (!row.character_id) continue;
    const sheet = await loadSheet(row.character_id);
    if (!sheet) continue;
    // MOVE × 2 metros por turno — mesma regra do modo local, calculada aqui.
    const movement = movementBudgetFor(sheet);
    rows.push({
      combat_id: combatId,
      session_id: session.id,
      kind: "character",
      character_id: row.character_id,
      participant_id: row.id,
      name: (sheet.identity?.name || row.display_name).slice(0, 60),
      actions_max: ACTIONS_PER_TURN,
      actions_remaining: ACTIONS_PER_TURN,
      movement_max: movement,
      movement_remaining: movement,
      hp_current: sheet.combat.hp.current,
      hp_max: sheet.combat.hp.max,
      is_dead: Boolean(sheet.combat.isDead),
      sort_order: sortOrder++,
    });
  }

  for (const enemy of enemies) {
    const movement = enemyMovementBudget(enemy.move);
    rows.push({
      combat_id: combatId,
      session_id: session.id,
      kind: "enemy",
      name: enemy.name,
      initiative_detail: { refBonus: enemy.ref },
      actions_max: ACTIONS_PER_TURN,
      actions_remaining: ACTIONS_PER_TURN,
      movement_max: movement,
      movement_remaining: movement,
      hp_current: enemy.hp,
      hp_max: enemy.hpMax,
      is_dead: false,
      sort_order: sortOrder++,
    });
  }

  if (rows.length === 0) throw new MesaError("Nenhum combatente pôde ser criado.", 400, "no_combatants");

  await query(db().from("mesa_combatants").insert(rows), "Falha ao criar os combatentes");
  await query(db().from("mesa_sessions").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", session.id), "Falha ao atualizar a mesa");
  await appendEvent(combatId, { kind: "combat_started", text: "Combate iniciado" }, []);
}

interface EnemyInput {
  name: string;
  /** HP atual (o do encontro pode já ter dano aplicado). */
  hp: number;
  /** HP máximo do inimigo; quando ausente, o inimigo entra cheio. */
  hpMax: number;
  ref: number;
  /** STAT MOVE do inimigo; `null` quando o cliente não informou (fallback 6 m). */
  move: number | null;
}

/** MOVE × 2 metros quando o encontro informa o MOVE; senão o fallback do motor. */
function enemyMovementBudget(move: number | null): number {
  return move === null ? MOVEMENT_PER_TURN : movementMetersPerTurn(move);
}

function sanitizeEnemies(raw: unknown): EnemyInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new MesaError("Lista de inimigos inválida.", 400, "invalid_enemies");
  if (raw.length > 20) throw new MesaError("Máximo de 20 inimigos por combate.", 400, "too_many_enemies");

  return raw.map((entry) => {
    const enemy = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const name = typeof enemy.name === "string" ? enemy.name.trim().slice(0, 60) : "";
    if (!name) throw new MesaError("Inimigo sem nome.", 400, "invalid_enemy");
    const hp = Math.max(1, Math.floor(Number(enemy.hp ?? 1)));
    const ref = Math.max(1, Math.floor(Number(enemy.ref ?? 5)));
    if (!Number.isFinite(hp)) throw new MesaError("HP do inimigo inválido.", 400, "invalid_enemy");
    const hpMax = Math.max(hp, Math.floor(Number(enemy.hpMax ?? hp)) || hp);
    // MOVE opcional: ausente/inválido → null (orçamento de 6 m, como antes).
    const rawMove = Number(enemy.move);
    const move =
      enemy.move === undefined || enemy.move === null || !Number.isFinite(rawMove)
        ? null
        : Math.max(0, Math.min(20, Math.floor(rawMove)));
    return { name, hp, hpMax, ref, move };
  });
}

/** Adiciona inimigos a um combate já em andamento (somente GM). */
export async function addEnemies(input: {
  sessionId: unknown;
  token: unknown;
  enemies: unknown;
}): Promise<void> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireGM({ session, participant });

  const combat = await getActiveCombat(session.id);
  if (!combat) throw new MesaError("Nenhum combate ativo.", 409, "combat_not_active");

  const enemies = sanitizeEnemies(input.enemies);
  if (enemies.length === 0) throw new MesaError("Informe ao menos um inimigo.", 400, "invalid_enemies");

  const current = (await query(
    db().from("mesa_combatants").select("sort_order").eq("combat_id", combat.id).order("sort_order", { ascending: false }).limit(1),
    "Falha ao consultar combatentes",
  )) as { sort_order: number }[];
  let sortOrder = (current[0]?.sort_order ?? -1) + 1;

  const rows = enemies.map((enemy) => {
    const movement = enemyMovementBudget(enemy.move);
    return {
      combat_id: combat.id,
      session_id: session.id,
      kind: "enemy" as const,
      name: enemy.name,
      // Já em combate: entra no fim da ordem com iniciativa 0.
      initiative: combat.initiative_started ? 0 : null,
      initiative_detail: { refBonus: enemy.ref },
      actions_max: ACTIONS_PER_TURN,
      actions_remaining: ACTIONS_PER_TURN,
      movement_max: movement,
      movement_remaining: movement,
      hp_current: enemy.hp,
      hp_max: enemy.hpMax,
      is_dead: false,
      sort_order: sortOrder++,
    };
  });

  await query(db().from("mesa_combatants").insert(rows), "Falha ao adicionar inimigos");
  await appendEvent(combat.id, { kind: "enemy", text: `${rows.length} inimigo(s) adicionado(s)` }, []);
}

/** Remove um inimigo (somente GM). Personagens de jogador não são removíveis. */
export async function removeCombatant(input: {
  sessionId: unknown;
  token: unknown;
  combatantId: unknown;
}): Promise<void> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireGM({ session, participant });

  const row = (await query(
    db().from("mesa_combatants").select("*").eq("id", String(input.combatantId ?? "")).maybeSingle(),
    "Falha ao consultar o combatente",
  )) as CombatantRow | null;
  if (!row || row.session_id !== session.id) throw new MesaError("Combatente não encontrado.", 404, "combatant_not_found");
  if (row.kind !== "enemy") {
    throw new MesaError("Só é possível remover inimigos. Personagens saem desvinculando a ficha.", 400, "not_enemy");
  }

  const combat = await getActiveCombat(session.id);
  await query(db().from("mesa_combatants").delete().eq("id", row.id), "Falha ao remover o combatente");

  if (combat && combat.active_combatant_id === row.id) {
    await advanceActiveTurn(session.id, combat, combat.event_log ?? []);
  }
}

/** GM ajusta HP, condições, morte ou iniciativa de um combatente. */
export async function updateCombatant(input: {
  sessionId: unknown;
  token: unknown;
  combatantId: unknown;
  patch: unknown;
}): Promise<void> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireGM({ session, participant });

  const row = (await query(
    db().from("mesa_combatants").select("*").eq("id", String(input.combatantId ?? "")).maybeSingle(),
    "Falha ao consultar o combatente",
  )) as CombatantRow | null;
  if (!row || row.session_id !== session.id) throw new MesaError("Combatente não encontrado.", 404, "combatant_not_found");

  const patch = (typeof input.patch === "object" && input.patch !== null ? input.patch : {}) as Record<string, unknown>;
  const update: Record<string, unknown> = {};

  if (typeof patch.hpCurrent === "number" && Number.isFinite(patch.hpCurrent)) {
    const max = row.hp_max;
    const hp = Math.max(-999, Math.min(max, Math.floor(patch.hpCurrent)));
    update.hp_current = hp;
    update.is_dead = hp <= 0 ? Boolean(patch.isDead ?? row.is_dead) : false;
  }
  if (typeof patch.isDead === "boolean") update.is_dead = patch.isDead;
  if (Array.isArray(patch.conditions)) {
    update.conditions = patch.conditions
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.slice(0, 40))
      .slice(0, 12);
  }
  if (typeof patch.initiative === "number" && Number.isFinite(patch.initiative)) {
    update.initiative = Math.floor(patch.initiative);
  }

  if (Object.keys(update).length === 0) throw new MesaError("Nada para atualizar.", 400, "empty_patch");

  await query(db().from("mesa_combatants").update(update).eq("id", row.id), "Falha ao atualizar o combatente");
}

/** Rola a iniciativa de todos (somente GM) e abre o primeiro turno. */
export async function rollInitiativeForAll(input: { sessionId: unknown; token: unknown }): Promise<void> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireGM({ session, participant });

  const combat = await getActiveCombat(session.id);
  if (!combat) throw new MesaError("Nenhum combate ativo.", 409, "combat_not_active");
  if (combat.initiative_started) throw new MesaError("A iniciativa já foi rolada.", 409, "initiative_already_rolled");

  const rows = (await query(
    db().from("mesa_combatants").select("*").eq("combat_id", combat.id),
    "Falha ao consultar combatentes",
  )) as CombatantRow[];

  const rolled: Array<{
    id: string;
    kind: "character" | "enemy";
    name: string;
    initiative: number;
    initiativeDetail: { expression: string; refBonus: number; total: number };
    isDead: boolean;
    sortOrder: number;
  }> = [];

  for (const row of rows) {
    let total = 0;
    let expression = "";
    let refBonus = 0;

    if (row.kind === "character" && row.character_id) {
      const sheet = await loadSheet(row.character_id);
      if (sheet) {
        // Mesma função usada pela ficha local — o Combat Engine não é duplicado.
        const { result } = rollInitiative(sheet);
        total = result.total;
        expression = result.expression;
        refBonus = result.refBonus;
      } else {
        refBonus = 5;
        total = refBonus;
        expression = `REF ${refBonus} (ficha indisponível)`;
      }
    } else {
      const detail = row.initiative_detail as { refBonus?: number } | null;
      refBonus = Math.floor(detail?.refBonus ?? 5);
      total = rollEnemyInitiative(refBonus);
      expression = `REF ${refBonus} + 1d10`;
    }

    rolled.push({
      id: row.id,
      kind: row.kind,
      name: row.name,
      initiative: total,
      initiativeDetail: { expression, refBonus, total },
      isDead: row.is_dead,
      sortOrder: row.sort_order,
    });
  }

  const ordered = sortByInitiative(rolled);
  // O upsert precisa levar a identidade INTEIRA: `combat_id`, `session_id`,
  // `kind` e `name` são NOT NULL sem default e o Postgres valida isso ANTES de
  // resolver o conflito — sem eles a rolagem inteira é rejeitada pelo banco.
  // Colunas fora do payload (HP, condições, orçamentos) não entram no
  // `ON CONFLICT DO UPDATE`, então mantêm o valor que já estão na linha.
  const updates = ordered.map((entry, index) => ({
    id: entry.id,
    combat_id: combat.id,
    session_id: session.id,
    kind: entry.kind,
    name: entry.name,
    initiative: entry.initiative,
    initiative_detail: entry.initiativeDetail,
    sort_order: index,
  }));

  await query(
    db().from("mesa_combatants").upsert(updates, { onConflict: "id" }),
    "Falha ao salvar a iniciativa",
  );

  const alive = ordered.filter((entry) => !entry.isDead);
  const first = alive[0];
  const now = new Date().toISOString();

  await query(
    db()
      .from("mesa_combats")
      .update({
        initiative_started: true,
        active_combatant_id: first ? first.id : null,
        turn_started_at: first ? now : null,
        round: 1,
        updated_at: now,
      })
      .eq("id", combat.id),
    "Falha ao abrir o primeiro turno",
  );

  if (first) {
    // Restaura o orçamento DESTE combatente: ações máximas e MOVE × 2 metros.
    const firstRow = rows.find((row) => row.id === first.id);
    await query(
      db()
        .from("mesa_combatants")
        .update({
          actions_remaining: ACTIONS_PER_TURN,
          movement_remaining: firstRow?.movement_max ?? MOVEMENT_PER_TURN,
        })
        .eq("id", first.id),
      "Falha ao iniciar o turno",
    );
  }

  await appendEvent(
    combat.id,
    { kind: "initiative", text: first ? `Iniciativa rolada — começa ${first.name ?? "o combate"}` : "Iniciativa rolada" },
    combat.event_log ?? [],
  );
}

/** Avança o turno a partir do estado atual do banco. */
async function advanceActiveTurn(sessionId: string, combat: CombatRow, log: MesaEvent[]): Promise<void> {
  const rows = (await query(
    db().from("mesa_combatants").select("*").eq("combat_id", combat.id).order("sort_order"),
    "Falha ao consultar combatentes",
  )) as CombatantRow[];

  const ordered = sortByInitiative(rows.map((row) => ({
    id: row.id,
    initiative: row.initiative,
    isDead: row.is_dead,
    sortOrder: row.sort_order,
  })));

  const order = ordered.map((entry) => entry.id);
  const alive = new Set(ordered.filter((entry) => !entry.isDead).map((entry) => entry.id));
  const advance = advanceTurn(order, combat.active_combatant_id, combat.round, (id) => alive.has(id));
  const now = new Date().toISOString();

  if (advance.kind === "finished") {
    await query(
      db()
        .from("mesa_combats")
        .update({ status: "finished", active_combatant_id: null, turn_started_at: null, updated_at: now })
        .eq("id", combat.id),
      "Falha ao encerrar o combate",
    );
    await appendEvent(combat.id, { kind: "combat_finished", text: "Combate encerrado" }, log);
    return;
  }

  const rowsById = new Map(rows.map((row) => [row.id, row]));

  // Zera o orçamento de quem perdeu o turno e reabre o de quem assumiu.
  if (combat.active_combatant_id) {
    const previous = rowsById.get(combat.active_combatant_id);
    if (previous) {
      await query(
        db().from("mesa_combatants").update({ actions_remaining: 0, movement_remaining: 0 }).eq("id", previous.id),
        "Falha ao encerrar o turno",
      );
    }
  }
  const nextBudget = rowsById.get(advance.activeCombatantId);
  await query(
    db()
      .from("mesa_combatants")
      .update({
        actions_remaining: ACTIONS_PER_TURN,
        movement_remaining: nextBudget?.movement_max ?? MOVEMENT_PER_TURN,
      })
      .eq("id", advance.activeCombatantId),
    "Falha ao iniciar o turno",
  );

  await query(
    db()
      .from("mesa_combats")
      .update({
        active_combatant_id: advance.activeCombatantId,
        round: advance.round,
        turn_started_at: now,
        updated_at: now,
      })
      .eq("id", combat.id),
    "Falha ao avançar o turno",
  );

  const next = rowsById.get(advance.activeCombatantId);
  const event: Omit<MesaEvent, "at"> =
    advance.kind === "round"
      ? { kind: "round", text: `Rodada ${advance.round} — turno de ${next?.name ?? "?"}` }
      : { kind: "turn", text: `Turno de ${next?.name ?? "?"}` };
  await appendEvent(combat.id, event, log);
}

/** Executa uma ação (ataque/item/outro/movimento) validando tudo no servidor. */
export async function performAction(input: {
  sessionId: unknown;
  token: unknown;
  combatantId: unknown;
  actionType: unknown;
  meters?: unknown;
}): Promise<void> {
  const { session, participant } = await authenticate(input.sessionId, input.token);

  const combat = (await query(
    db().from("mesa_combats").select("*").eq("session_id", session.id).maybeSingle(),
    "Falha ao consultar o combate",
  )) as CombatRow | null;

  const row = (await query(
    db().from("mesa_combatants").select("*").eq("id", String(input.combatantId ?? "")).maybeSingle(),
    "Falha ao consultar o combatente",
  )) as CombatantRow | null;
  if (!row || row.session_id !== session.id) throw new MesaError("Combatente não encontrado.", 404, "combatant_not_found");

  const actionType = input.actionType;
  const meters = typeof input.meters === "number" ? input.meters : 0;

  const result = resolveAction({
    combatStatus: combat ? combat.status : null,
    initiativeStarted: combat?.initiative_started ?? false,
    activeCombatantId: combat?.active_combatant_id ?? null,
    actorRole: participant.role,
    actorOwnsCombatant: row.participant_id === participant.id,
    combatant: {
      id: row.id,
      isDead: row.is_dead,
      actionsMax: row.actions_max,
      actionsRemaining: row.actions_remaining,
      movementMax: row.movement_max,
      movementRemaining: row.movement_remaining,
    },
    actionType,
    meters,
  });

  if (!result.ok) {
    throw new MesaError(DENIAL_MESSAGES[result.reason], 403, result.reason);
  }
  if (!combat) throw new MesaError("Nenhum combate ativo.", 409, "combat_not_active");

  const economy = applyAction(
    {
      actionsMax: row.actions_max,
      actionsRemaining: row.actions_remaining,
      movementMax: row.movement_max,
      movementRemaining: row.movement_remaining,
    },
    actionType as CombatActionType,
    meters,
  );

  await query(
    db()
      .from("mesa_combatants")
      .update({
        actions_remaining: economy.actionsRemaining,
        movement_remaining: economy.movementRemaining,
      })
      .eq("id", row.id),
    "Falha ao consumir a ação",
  );

  const label = actionType === "move" ? `Movimento (${Math.floor(meters)}m)` : ACTION_LABELS[actionType as CombatActionType];
  await appendEvent(combat.id, { kind: "action", text: `${row.name}: ${label}` }, combat.event_log ?? []);
}

/**
 * Registra uma rolagem feita NA ficha de um participante conectado à mesa.
 *
 * A rolagem usa a MESMA economia do botão ATAQUE: o servidor valida com
 * `resolveAction` (combate ativo? iniciativa? seu turno? sobrou Action?) e só
 * debita se puder. Fora do turno ela ainda entra no Registro do combate — o
 * dado aconteceu e todo mundo deve ver — só que marcada como "não contou".
 *
 * Sem combate ativo não há registro: devolve `registered: false` e nada muda.
 * O chamador é fire-and-forget; falha aqui nunca pode quebrar a ficha local.
 */
export async function registerRoll(input: {
  sessionId: unknown;
  token: unknown;
  roll: unknown;
}): Promise<{ registered: boolean; debited: boolean }> {
  const parsed = parseMesaRoll(input.roll);
  if (!parsed.ok) throw new MesaError(parsed.reason, 400, "invalid_roll");

  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireActiveSession(session);

  const combat = await getActiveCombat(session.id);
  if (!combat) return { registered: false, debited: false };

  const roll = parsed.roll;
  const actionType = MESA_ROLL_ACTION[roll.type];

  const combatants = (await query(
    db().from("mesa_combatants").select("*").eq("combat_id", combat.id),
    "Falha ao consultar os combatentes",
  )) as CombatantRow[];

  // Só o combatente VINCULADO a este participante pode ser debitado por ele.
  const mine = combatants.find((row) => row.participant_id === participant.id) ?? null;

  // GM rola de fora (tela de encontro/inimigo): reporta o dado, nunca debita
  // Action do combatente — o GM controla inimigos livremente na CPR.
  const canDebit = actionType !== null && participant.role !== "gm" && mine !== null;

  let debited = false;
  let denial: string | null = null;

  if (canDebit) {
    if (!mine) {
      denial = "not_allowed";
    } else {
      const economy = {
        actionsMax: mine.actions_max,
        actionsRemaining: mine.actions_remaining,
        movementMax: mine.movement_max,
        movementRemaining: mine.movement_remaining,
      };
      const result = resolveAction({
        combatStatus: combat.status,
        initiativeStarted: combat.initiative_started,
        activeCombatantId: combat.active_combatant_id,
        actorRole: participant.role,
        actorOwnsCombatant: true,
        combatant: { id: mine.id, isDead: mine.is_dead, ...economy },
        actionType,
        meters: 0,
      });

      if (result.ok) {
        const next = applyAction(economy, actionType, 0);
        await query(
          db().from("mesa_combatants").update({ actions_remaining: next.actionsRemaining }).eq("id", mine.id),
          "Falha ao consumir a ação",
        );
        debited = true;
      } else {
        denial = result.reason;
      }
    }
  }

  const actor = mine?.name ?? participant.displayName;
  const note = actionType && !debited ? rollDenialNote(denial) : "";
  await appendEvent(
    combat.id,
    { kind: "roll", text: formatRollEvent(actor, roll, note) },
    combat.event_log ?? [],
  );

  return { registered: true, debited };
}

/** Finaliza o turno atual (dono do combatente ativo ou GM). */
export async function endTurn(input: { sessionId: unknown; token: unknown }): Promise<void> {
  const { session, participant } = await authenticate(input.sessionId, input.token);

  const combat = await getActiveCombat(session.id);
  if (!combat) throw new MesaError("Nenhum combate ativo.", 409, "combat_not_active");
  if (!combat.initiative_started || !combat.active_combatant_id) {
    throw new MesaError("Nenhum turno em andamento.", 409, "no_active_turn");
  }

  const active = (await query(
    db().from("mesa_combatants").select("*").eq("id", combat.active_combatant_id).maybeSingle(),
    "Falha ao consultar o combatente",
  )) as CombatantRow | null;

  const ownsActive = active?.participant_id === participant.id;
  if (participant.role !== "gm" && !ownsActive) {
    throw new MesaError("Não é a sua vez de finalizar o turno.", 403, "not_your_turn");
  }

  await advanceActiveTurn(session.id, combat, combat.event_log ?? []);
}

/** Encerra o combate mantendo a mesa aberta (somente GM). */
export async function endCombat(input: { sessionId: unknown; token: unknown }): Promise<void> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireGM({ session, participant });

  const combat = await getActiveCombat(session.id);
  if (!combat) throw new MesaError("Nenhum combate ativo.", 409, "combat_not_active");

  await query(
    db()
      .from("mesa_combats")
      .update({ status: "finished", active_combatant_id: null, turn_started_at: null, updated_at: new Date().toISOString() })
      .eq("id", combat.id),
    "Falha ao encerrar o combate",
  );
  await appendEvent(combat.id, { kind: "combat_finished", text: "Combate encerrado pelo Mestre" }, combat.event_log ?? []);
}

/** Encerra a sessão inteira (somente GM). */
export async function finishSession(input: { sessionId: unknown; token: unknown }): Promise<void> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireGM({ session, participant });

  const combat = await getActiveCombat(session.id);
  if (combat) {
    await query(
      db().from("mesa_combats").update({ status: "finished", active_combatant_id: null, turn_started_at: null }).eq("id", combat.id),
      "Falha ao encerrar o combate",
    );
  }
  await query(
    db().from("mesa_sessions").update({ status: "finished", updated_at: new Date().toISOString() }).eq("id", session.id),
    "Falha ao encerrar a sessão",
  );
}

/**
 * Sai da mesa (desconecta) — apaga a linha do participante no servidor.
 *
 * É um dos dois únicos caminhos de desconexão (o outro é `finishSession`, o
 * Mestre encerrando a sessão). Fechar o painel não mexe em nada: a assinatura
 * local continua até este chamado ser feito.
 *
 * Os combatentes do participante ficam na luta com `participant_id` anulado
 * (FK `on delete set null`): só o Mestre passa a comandá-los — nada de
 * personagem sumir do meio do turno.
 *
 * O Mestre não sai de uma sessão aberta: a mesa ficaria sem quem pode
 * encerrá-la. Ele se desconecta encerrando a sessão.
 */
export async function leaveSession(input: { sessionId: unknown; token: unknown }): Promise<void> {
  const { session, participant } = await authenticate(input.sessionId, input.token);

  if (participant.role === "gm" && session.status !== "finished") {
    throw new MesaError(
      "Encerre a sessão para se desconectar: a mesa não pode ficar sem Mestre.",
      403,
      "gm_must_finish_session",
    );
  }

  await query(db().from("mesa_participants").delete().eq("id", participant.id), "Falha ao sair da mesa");
}

// Mensagens/labels vêm de `messages.ts` (módulo puro, compartilhado com a UI).
export { DENIAL_MESSAGES, ACTION_LABELS } from "@/lib/mesa/messages";

/** Mensagem amigável para qualquer erro de mesa. */
export function messageForError(error: unknown): string {
  if (error instanceof MesaError) return error.message;
  if (error instanceof DatabaseQueryError) return "Falha de comunicação com o servidor. Tente novamente.";
  return "Erro inesperado. Tente novamente.";
}
