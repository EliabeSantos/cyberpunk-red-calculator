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
import { ENEMY_DAMAGE_POLICY, isDefeatedBy } from "@/lib/combat/damage";
import { isAmmoRelevantToWeapons, planReload, applyReload } from "@/data/enemySupplies";
import { execute } from "@/lib/combat/engine";
import { rollWeaponDamage } from "@/lib/combat/weaponDamage";
import { resolveHitLocation } from "@/lib/combat/hitLocation";
import { engineDamagePatch, type EngineDamagePatch } from "@/lib/mesa/engineAdapter";
import { serverRandom } from "@/lib/serverRandom";
import type { DiceResult } from "@/lib/dice";
import { hitLocations, type HitLocation } from "@/types/combat";
import type {
  AttackAction,
  CombatParticipant,
  CombatState,
  DamageAction,
  DamageResult,
} from "@/lib/combat/contract";
import { mergeBattleRoster, startBattleSnapshot } from "@/lib/mesa/battleHistory";
import { generateJoinCode, normalizeJoinCode } from "@/lib/mesa/joinCode";
import type {
  MesaBattle,
  MesaBattleCombatant,
  MesaCombat,
  MesaCombatant,
  MesaEvent,
  MesaParticipant,
  MesaSession,
  MesaState,
  MesaSupplies,
} from "@/lib/mesa/types";
import { DatabaseQueryError, getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ACTION_LABELS, DENIAL_MESSAGES } from "@/lib/mesa/messages";
import {
  formatRollEvent,
  MESA_ROLL_ACTION,
  parseMesaRoll,
  planRollDebit,
  rollDenialNote,
} from "@/lib/mesa/rollPolicy";
import { rollInitiative } from "@/lib/initiative";
import type { Character } from "@/types/character";
import type { EncounterParticipant } from "@/types/encounter";
import { toCombatParticipant } from "@/lib/combat/adapters";

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

function requireResolutionId(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length < 8 || raw.trim().length > 200) {
    throw new MesaError("Identificador de resolução ausente ou inválido.", 400, "invalid_resolution_id");
  }
  return raw.trim();
}

async function storedAttackResolution(sessionId: string, resolutionId: string, combatId?: string): Promise<AttackResolutionRow | null> {
  let request = db()
    .from("mesa_attack_resolutions")
    .select("combat_id,status,claim_token,result")
    .eq("session_id", sessionId)
    .eq("resolution_id", resolutionId);
  if (combatId) request = request.eq("combat_id", combatId);
  return (await query(
    request.order("created_at", { ascending: false }).limit(1).maybeSingle(),
    "Falha ao consultar a resolução do ataque",
  )) as AttackResolutionRow | null;
}

async function waitForAttackResolution(sessionId: string, resolutionId: string, combatId?: string): Promise<IntegratedAttackResponse> {
  // Uma requisição concorrente pode encontrar o claim antes do commit. Ela não
  // executa o Engine: aguarda o commit atômico da requisição dona do claim.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const row = await storedAttackResolution(sessionId, resolutionId, combatId);
    if (row?.status === "committed" && row.result) return row.result;
    if (row?.status === "failed") {
      throw new MesaError("A resolução deste ataque falhou antes do commit; não será reexecutada.", 409, "resolution_failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (combatId) {
    const recovered = (await query(
      db().rpc("recover_mesa_attack_resolution", {
        p_session_id: sessionId,
        p_combat_id: combatId,
        p_resolution_id: resolutionId,
      }),
      "Falha ao verificar a resolução interrompida",
    )) as Array<{ status: "missing" | "processing" | "committed" | "failed"; result: IntegratedAttackResponse | null }> | null;
    const state = recovered?.[0];
    if (state?.status === "committed" && state.result) return state.result;
    if (state?.status === "failed") {
      throw new MesaError("A resolução deste ataque foi marcada como abandonada; não será reexecutada.", 409, "resolution_failed");
    }
  }
  throw new MesaError("A resolução deste ataque ainda está em andamento.", 409, "resolution_in_progress");
}

async function storedReloadResolution(sessionId: string, resolutionId: string, combatId?: string): Promise<ReloadResolutionRow | null> {
  let request = db()
    .from("mesa_reload_resolutions")
    .select("combat_id,status,claim_token,result")
    .eq("session_id", sessionId)
    .eq("resolution_id", resolutionId);
  if (combatId) request = request.eq("combat_id", combatId);
  return (await query(
    request.order("created_at", { ascending: false }).limit(1).maybeSingle(),
    "Falha ao consultar a resolução do reload",
  )) as ReloadResolutionRow | null;
}

async function waitForReloadResolution(sessionId: string, resolutionId: string, combatId?: string): Promise<ReloadResponse> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const row = await storedReloadResolution(sessionId, resolutionId, combatId);
    if (row?.status === "committed" && row.result) return row.result;
    if (row?.status === "failed") {
      throw new MesaError("A resolução deste reload falhou antes do commit; não será reexecutada.", 409, "resolution_failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (combatId) {
    const recovered = (await query(
      db().rpc("recover_mesa_reload_resolution", {
        p_session_id: sessionId,
        p_combat_id: combatId,
        p_resolution_id: resolutionId,
      }),
      "Falha ao verificar a resolução interrompida",
    )) as Array<{ status: "missing" | "processing" | "committed" | "failed"; result: ReloadResponse | null }> | null;
    const state = recovered?.[0];
    if (state?.status === "committed" && state.result) return state.result;
    if (state?.status === "failed") {
      throw new MesaError("A resolução deste reload foi marcada como abandonada; não será reexecutada.", 409, "resolution_failed");
    }
  }
  throw new MesaError("A resolução deste reload ainda está em andamento.", 409, "resolution_in_progress");
}

function databaseResolutionError(error: unknown): MesaError | null {
  if (!(error instanceof Error)) return null;
  const code = ["action_conflict", "hp_conflict", "resolution_in_progress", "resolution_not_claimed", "resolution_failed"].find((candidate) =>
    error.message.includes(candidate),
  );
  if (!code) return null;
  const status = code === "hp_conflict" || code === "action_conflict" || code === "resolution_in_progress" || code === "resolution_failed" ? 409 : 500;
  return new MesaError(code === "hp_conflict" ? "A vida do alvo mudou entre a resolução e a persistência." : "A resolução concorrente não pôde ser aplicada.", status, code);
}

// ---------------------------------------------------------------------------
// Coluna `source_key` (migração 20260927000000) — presença detectada no uso
// ---------------------------------------------------------------------------

const SOURCE_KEY_MIGRATION =
  "Esta mesa precisa da migração 20260927000000_mesa_combatant_source_key.sql no Supabase para espelhar o HP dos inimigos.";

/**
 * `unknown` = ainda não testado · `yes` = coluna existe · `no` = migração
 * pendente. Cacheado por processo para não repetir escritas que vão falhar.
 */
let sourceKeySupport: "unknown" | "yes" | "no" = "unknown";

function mentionsSourceKey(error: unknown): boolean {
  return error instanceof Error && error.message.includes("source_key");
}

function withoutSourceKey(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const copy = { ...row };
    delete copy.source_key;
    return copy;
  });
}

/**
 * `supplies` é a mochila do inimigo espelhada da tela de Encontros (migração
 * `20260930000000_mesa_combatant_supplies.sql`). Mesmo molde de `source_key`:
 * sem a migração o combate continua começando, só a linha da mesa não mostra
 * pente nem cura.
 */
let suppliesSupport: "unknown" | "yes" | "no" = "unknown";

function mentionsSupplies(error: unknown): boolean {
  return error instanceof Error && error.message.includes("supplies");
}

function withoutSupplies(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const copy = { ...row };
    delete copy.supplies;
    return copy;
  });
}

/** Linhas sem as colunas de migração já sabidas como ausentes. */
function withOptionalColumns(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  let next = rows;
  if (sourceKeySupport === "no") next = withoutSourceKey(next);
  if (suppliesSupport === "no") next = withoutSupplies(next);
  return next;
}

/**
 * Cria as linhas de combatente guardando `source_key` e `supplies`.
 *
 * Se uma migração ainda não tiver sido aplicada, re-insere SEM a coluna em
 * vez de derrubar o início do combate: o que se perde é o espelho de HP (ou a
 * mochila) dos inimigos — pessoas, turno e economia de ações seguem.
 */
async function insertCombatantRows(rows: Array<Record<string, unknown>>, context: string): Promise<void> {
  // Só um insert que LEVA a coluna serve de teste: payload só de personagens
  // não prova nada sobre a migração.
  const testsSourceKey = rows.some((row) => "source_key" in row);
  const testsSupplies = rows.some((row) => "supplies" in row);

  let attempt = rows;
  for (;;) {
    try {
      await query(db().from("mesa_combatants").insert(attempt), context);
      if (testsSourceKey && "source_key" in attempt[0]) sourceKeySupport = "yes";
      if (testsSupplies && "supplies" in attempt[0]) suppliesSupport = "yes";
      return;
    } catch (error) {
      const pending =
        sourceKeySupport !== "no" && mentionsSourceKey(error)
          ? "source_key"
          : suppliesSupport !== "no" && mentionsSupplies(error)
            ? "supplies"
            : null;
      if (!pending) throw error;
      if (pending === "source_key") sourceKeySupport = "no";
      else suppliesSupport = "no";
      attempt = withOptionalColumns(rows);
    }
  }
}

// ---------------------------------------------------------------------------
// Partida (histórico) — tabela `mesa_battles` (migração 20260927000001)
// ---------------------------------------------------------------------------

const BATTLE_MIGRATION =
  "Esta mesa precisa da migração 20260927000001_mesa_battles.sql no Supabase para registrar o histórico de partidas e impedir encontro repetido.";

/**
 * `unknown` = ainda não testado · `yes` = tabela existe · `no` = migração
 * pendente. Cacheado por processo, igual a `sourceKeySupport`.
 *
 * Sem a tabela o combate continua começando (só não há histórico nem bloqueio
 * de encontro repetido) — a feature nova não pode regressar a luta em si.
 */
let battleSupport: "unknown" | "yes" | "no" = "unknown";

/** Postgres para tabela inexistente: `relation "public.mesa_battles" does not exist`. */
function missingBattleTable(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("mesa_battles") &&
    error.message.includes("does not exist")
  );
}

interface BattleRow {
  id: string;
  session_id: string;
  join_code: string;
  encounter_id: string | null;
  encounter_name: string;
  status: MesaBattle["status"];
  started_at: string;
  ended_at: string | null;
  final_round: number | null;
  combatants: MesaBattleCombatant[] | null;
  event_log: MesaEvent[] | null;
}

function toBattle(row: BattleRow): MesaBattle {
  return {
    id: row.id,
    sessionId: row.session_id,
    joinCode: row.join_code,
    encounterId: row.encounter_id,
    encounterName: row.encounter_name,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    finalRound: row.final_round,
    combatants: Array.isArray(row.combatants) ? row.combatants : [],
  };
}

/** Combatentes da mesa, na ordem da iniciativa (lê todos, inclusive os que saíram). */
async function listCombatants(sessionId: string): Promise<CombatantRow[]> {
  const rows = (await query(
    db().from("mesa_combatants").select("*").eq("session_id", sessionId).order("sort_order"),
    "Falha ao consultar combatentes",
  )) as CombatantRow[] | null;
  return rows ?? [];
}

/** A partida já lançada por ESTE encontro, se houver. Sem migração: `null`. */
async function findBattleByEncounter(encounterId: string): Promise<BattleRow | null> {
  if (battleSupport === "no") return null;
  try {
    const row = (await query(
      db().from("mesa_battles").select("*").eq("encounter_id", encounterId).maybeSingle(),
      "Falha ao consultar a partida",
    )) as BattleRow | null;
    battleSupport = "yes";
    return row;
  } catch (error) {
    if (missingBattleTable(error)) {
      battleSupport = "no";
      return null;
    }
    throw error;
  }
}

/**
 * Reserva o registro da partida ANTES de mexer no combate: o UNIQUE de
 * `encounter_id` é a autoridade contra encontro repetido, e falhar aqui não
 * deixa nada pela metade.
 *
 * Devolve `null` quando a migração está pendente (aí não há o que registrar).
 */
async function reserveBattle(input: {
  sessionId: string;
  joinCode: string;
  encounterId: string | null;
  encounterName: string;
}): Promise<string | null> {
  if (battleSupport === "no") return null;
  try {
    const created = (await query(
      db()
        .from("mesa_battles")
        .insert({
          session_id: input.sessionId,
          join_code: input.joinCode,
          encounter_id: input.encounterId,
          encounter_name: input.encounterName.slice(0, 60),
          status: "active",
        })
        .select("id")
        .single(),
      "Falha ao registrar a partida",
    )) as { id: string } | null;
    battleSupport = "yes";
    return created?.id ?? null;
  } catch (error) {
    if (error instanceof Error && error.message.includes("duplicate key")) {
      // Corrida entre dois lançamentos do mesmo encontro: o banco decidiu.
      throw new MesaError(
        "Este encontro já foi usado em uma partida e não pode ser iniciado de novo.",
        409,
        "encounter_used",
      );
    }
    if (missingBattleTable(error)) {
      battleSupport = "no";
      return null;
    }
    throw error;
  }
}

/**
 * Guarda com que vida cada combatente entrou na partida.
 *
 * Falhar aqui NÃO derruba o combate que já começou: o registro continua lá
 * (só sem o snapshot de entrada) e o fechamento ainda grava a vida final.
 */
async function updateBattleRoster(battleId: string, combatants: MesaBattleCombatant[]): Promise<void> {
  if (battleSupport === "no") return;
  try {
    await query(
      db().from("mesa_battles").update({ combatants }).eq("id", battleId),
      "Falha ao registrar os combatentes da partida",
    );
  } catch (error) {
    if (missingBattleTable(error)) battleSupport = "no";
    // qualquer outra falha aqui é só perda de histórico: o combate segue.
  }
}

/** Apaga uma reserva órfã (o lançamento falhou no meio). */
async function discardBattle(battleId: string): Promise<void> {
  try {
    await query(db().from("mesa_battles").delete().eq("id", battleId), "Falha ao descartar a partida");
  } catch {
    // O erro real do lançamento é quem importa; uma reserva que sobrar só
    // mantém o encontro bloqueado (o lado seguro do bloqueio).
  }
}

/**
 * Fecha a partida ativa da sessão com o estado final.
 *
 * Chamado em TODOS os fins de combate: GM encerrar, sessão encerrar e fim
 * automático (todos os inimigos caídos). Idempotente — sem partida ativa é um
 * no-op, então pode ser chamada sem medo nos caminhos defensivos.
 */
async function completeActiveBattle(sessionId: string): Promise<void> {
  if (battleSupport === "no") return;

  let battle: BattleRow | null;
  try {
    battle = (await query(
      db()
        .from("mesa_battles")
        .select("*")
        .eq("session_id", sessionId)
        .eq("status", "active")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "Falha ao consultar a partida",
    )) as BattleRow | null;
    battleSupport = "yes";
  } catch (error) {
    if (missingBattleTable(error)) {
      battleSupport = "no";
      return;
    }
    throw error;
  }
  if (!battle) return;

  const combatants = await listCombatants(sessionId);
  const combat = (await query(
    db().from("mesa_combats").select("*").eq("session_id", sessionId).maybeSingle(),
    "Falha ao consultar o combate",
  )) as CombatRow | null;

  await query(
    db()
      .from("mesa_battles")
      .update({
        status: "completed",
        ended_at: new Date().toISOString(),
        final_round: combat?.round ?? battle.final_round ?? 1,
        combatants: mergeBattleRoster(
          Array.isArray(battle.combatants) ? battle.combatants : [],
          combatants.map((row) => toCombatant(row)),
        ),
        event_log: Array.isArray(combat?.event_log) ? combat.event_log : [],
      })
      .eq("id", battle.id),
    "Falha ao concluir a partida",
  );
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
  source_key?: string | null;
  supplies?: MesaSupplies | null;
  combat_snapshot?: CombatState["participants"][number] | null;
  combat_ammo?: Record<string, number> | null;
  combat_armor?: { head: number; body: number } | null;
  critical_injuries?: CombatParticipant["combat"]["criticalInjuries"] | null;
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

type IntegratedAttackResponse = {
  attackResult: NonNullable<ReturnType<typeof execute>["attackResult"]>;
  weaponDamage?: DiceResult;
  damageResult?: DamageResult;
  damageError?: { code: string; message: string };
  ammoAfter?: number;
  actionAfter?: number;
};

interface IntegratedAttackOutcome {
  result: IntegratedAttackResponse;
  committed: boolean;
}

interface AttackResolutionRow {
  combat_id: string;
  status: "processing" | "committed" | "failed";
  claim_token: string;
  result: IntegratedAttackResponse | null;
}

interface AttackResolutionClaim {
  claimed: boolean;
  status: "processing" | "committed" | "failed";
  claim_token: string;
  result: IntegratedAttackResponse | null;
}

interface ReloadResolutionRow {
  combat_id: string;
  status: "processing" | "committed" | "failed";
  claim_token: string;
  result: ReloadResponse | null;
}

interface ReloadResolutionClaim {
  claimed: boolean;
  status: "processing" | "committed" | "failed";
  claim_token: string;
  result: ReloadResponse | null;
}

interface ReloadResponse {
  weaponId: string;
  ammoBefore: number;
  ammoAfter: number;
  actionsBefore: number;
  actionsAfter: number;
  consumed: number;
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
    sourceKey: row.source_key ?? null,
    supplies: row.supplies ?? null,
    armor: row.combat_armor ?? null,
    criticalInjuries: row.critical_injuries ?? [],
    ammoByWeapon: row.combat_ammo ?? null,
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

/**
 * Reconstrói o participante canônico sem consultar o payload do cliente.
 * O snapshot fornece identidade/ficha/arma; as colunas da Mesa fornecem o
 * estado mutável atual. Retorna null para combates antigos sem a migration.
 */
export function combatParticipantFromRow(row: CombatantRow): CombatParticipant | null {
  if (!row.combat_snapshot) return null;
  const weapons = row.combat_snapshot.weapons?.map((weapon) => {
    const ammo = weapon.id ? row.combat_ammo?.[weapon.id] : undefined;
    return ammo === undefined ? weapon : { ...weapon, ammo };
  });
  return {
    ...row.combat_snapshot,
    ...(weapons ? { weapons } : {}),
    combat: {
      ...row.combat_snapshot.combat,
      hp: { current: row.hp_current, max: row.hp_max },
      armor: row.combat_armor ?? { ...row.combat_snapshot.combat.armor },
      criticalInjuries: row.critical_injuries ?? [...row.combat_snapshot.combat.criticalInjuries],
      conditions: (row.conditions ?? []).map((name) => ({ id: name, name })),
      initiative: row.initiative,
      isDead: row.is_dead,
    },
    economy: {
      actionsMax: row.actions_max,
      actionsRemaining: row.actions_remaining,
      movementMax: row.movement_max,
      movementRemaining: row.movement_remaining,
    },
  };
}

function ammoStateForParticipant(participant: CombatParticipant | null): Record<string, number> | null {
  if (!participant?.weapons) return null;
  const entries = participant.weapons
    .filter((weapon): weapon is typeof weapon & { id: string; ammo: number } =>
      typeof weapon.id === "string" && typeof weapon.ammo === "number",
    )
    .map((weapon) => [weapon.id, Math.max(0, Math.floor(weapon.ammo))] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/** Materializa somente munição relevante, nunca o inventário completo da ficha. */
function suppliesForCharacter(
  sheet: Character,
  snapshot: CombatState["participants"][number] | null,
): MesaSupplies {
  const weapons = snapshot?.weapons ?? [];
  return {
    inventory: (sheet.inventory ?? [])
      .filter((item) => isAmmoRelevantToWeapons(item.name, weapons))
      .map((item) => ({ item: item.name, quantity: Math.max(0, Math.floor(item.quantity)) }))
      .filter((item) => item.quantity > 0),
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

/**
 * Autoridade do ator para o endpoint de ataque integrado.
 *
 * `actorId` identifica apenas uma linha de `mesa_combatants`; ele nunca define
 * quem fez a requisição. A identidade vem de `authenticate()` e, para Players,
 * a relação de ownership vem exclusivamente de `participant_id` no banco.
 *
 * O GM preserva a política existente: pode controlar qualquer combatant do
 * combate atual. Um Player só pode controlar o combatant ligado à sua própria
 * participação. A checagem de `session_id` evita aceitar uma linha de outra
 * Mesa mesmo se um ID externo for apresentado ao orquestrador.
 */
export function authorizeCombatAttackActor(
  actor: Actor,
  combatant: Pick<CombatantRow, "session_id" | "participant_id">,
): void {
  if (combatant.session_id !== actor.session.id) {
    throw new MesaError("Combatente não encontrado.", 404, "combatant_not_found");
  }

  if (actor.participant.role === "gm") return;

  if (combatant.participant_id !== actor.participant.id) {
    throw new MesaError("Você não pode controlar este combatente.", 403, "combatant_not_owned");
  }
}

/**
 * Validação estrutural de um alvo de ataque.
 *
 * Esta função não decide fogo amigo, PvP, facção ou relação entre os tipos de
 * combatant: o projeto ainda não possui essa política. Ela apenas garante que
 * o alvo pertence ao combate/Mesa carregados e continua elegível pelo estado
 * atual. Os dados de defesa continuam sendo lidos do snapshot, nunca do
 * request.
 */
export function validateCombatAttackTarget(
  combat: Pick<CombatRow, "id" | "session_id">,
  target: Pick<CombatantRow, "id" | "combat_id" | "session_id" | "is_dead"> | null,
): void {
  if (!target || target.combat_id !== combat.id || target.session_id !== combat.session_id) {
    throw new MesaError("Alvo não encontrado.", 404, "target_not_found");
  }
  if (target.is_dead) {
    throw new MesaError("Alvo derrotado.", 400, "target_defeated");
  }
}

/** Dados mínimos para a defesa por Evasion, sem fallback inventado. */
export function hasServerEvasionTarget(
  target: Pick<CombatParticipant, "stats" | "skills">,
): boolean {
  return typeof target.stats?.DEX === "number" && Boolean(target.skills?.evasion);
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

/**
 * Acrescenta UM evento ao `event_log` e persiste.
 *
 * O histórico é lido do banco AQUI, junto da gravação — e nunca do snapshot
 * que o chamador carregou no começo da requisição. Assim nenhum chamador consegue
 * substituir o log por uma lista antiga ou vazia (o bug que `addEnemies`
 * disparava ao passar `[]`). O único reset do histórico continua sendo o de
 * `startCombat`, explícito na atualização da linha de combate.
 *
 * A leitura imediatamente antes da escrita encurta a janela de corrida
 * read-modify-write; fechá-la de vez exigiria transação/RPC no Postgres
 * (fora do escopo desta correção).
 *
 * F1.6: exportada como está para o adapter `src/lib/mesa/combatEvents.ts`
 * (`persistCombatResult`) repassar `CombatResult.events` — assinatura e
 * comportamento continuam os do F0.1.
 */
export async function appendEvent(combatId: string, event: Omit<MesaEvent, "at">): Promise<void> {
  const row = (await query(
    db().from("mesa_combats").select("event_log").eq("id", combatId).maybeSingle(),
    "Falha ao consultar o histórico do combate",
  )) as { event_log: MesaEvent[] | null } | null;
  const currentLog = Array.isArray(row?.event_log) ? row.event_log : [];
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

/**
 * Leitura do encontro que originou o combate (`body.encounter`).
 *
 * Só o `id` importa para o vínculo (é ele que o banco torna único); o nome é
 * rótulo do histórico. Encontro ausente/velho = combate avulso, sem vínculo.
 */
function sanitizeEncounterRef(raw: unknown): { id: string; name: string } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id || id.length > 120) return null;
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : "Encontro";
  return { id, name: name.slice(0, 60) };
}

/**
 * Reinicia (ou cria) o combate da mesa e monta os combatentes vinculados.
 *
 * Quando o pedido vem de um encontro, nasce junto a **partida** dele em
 * `mesa_battles`: o encontro passa a ser de uso único (o UNIQUE de
 * `encounter_id` recusa um segundo lançamento em qualquer mesa) e a luta vira
 * histórico quando terminar.
 *
 * `restart: true` pede explicitamente o recomeço da MESMA partida ainda ativa
 * nesta mesa — é o caminho do "Encerrar e reiniciar" sem fechar a luta dos
 * outros. Sem ele, partida em andamento é erro.
 */
export async function startCombat(input: {
  sessionId: unknown;
  token: unknown;
  enemies?: unknown;
  encounter?: unknown;
  restart?: unknown;
}): Promise<void> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireGM({ session, participant });
  requireActiveSession(session);

  const encounter = sanitizeEncounterRef(input.encounter);
  const restart = input.restart === true;

  // 1. Encontro checado ANTES de qualquer escrita: falhou aqui e nada mudou.
  let reuseBattleId: string | null = null;
  if (encounter) {
    const prior = await findBattleByEncounter(encounter.id);
    if (prior) {
      if (prior.status === "completed") {
        throw new MesaError(
          "Este encontro já foi concluído em uma partida e não pode ser iniciado de novo.",
          409,
          "encounter_used",
        );
      }
      if (prior.session_id !== session.id) {
        throw new MesaError(
          `Este encontro já está em combate na Mesa ${prior.join_code}.`,
          409,
          "encounter_in_use",
        );
      }
      if (!restart) {
        // Código próprio: a UI oferece "reiniciar" SÓ para este caso (a outra
        // hipótese de `encounter_in_use` é combate em mesa de fora — recomeçar
        // ali não é possível, é abrir a Mesa certa).
        throw new MesaError(
          "Este encontro já está em combate nesta mesa. Reinicie para recomeçar.",
          409,
          "encounter_restart",
        );
      }
      // Mesma partida, mesma mesa, GM mandou recomeçar: reaproveita a linha
      // (um encontro = uma partida no histórico, mesmo reiniciada).
      reuseBattleId = prior.id;
    }
  }

  const existingCombat = (await query(
    db().from("mesa_combats").select("*").eq("session_id", session.id).maybeSingle(),
    "Falha ao consultar o combate",
  )) as CombatRow | null;
  if (existingCombat && existingCombat.status === "active" && !reuseBattleId) {
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

  // 2. Reserva o registro da partida (o UNIQUE é a autoridade contra encontro
  //    repetido). Toda escrita abaixo acontece dentro de um try que desfaz a
  //    reserva se algo falhar.
  const battleId =
    reuseBattleId ??
    (await reserveBattle({
      sessionId: session.id,
      joinCode: session.joinCode,
      encounterId: encounter?.id ?? null,
      encounterName: encounter?.name ?? "Combate",
    }));

  try {
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
      const snapshot = toCombatParticipant(sheet);
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
        combat_snapshot: snapshot,
        combat_ammo: ammoStateForParticipant(snapshot),
        supplies: suppliesForCharacter(sheet, snapshot),
        combat_armor: { ...snapshot.combat.armor },
        critical_injuries: [...snapshot.combat.criticalInjuries],
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
        // Chave do participante do encontro: é por ela que o HP aplicado lá em
        // Encontros acha esta linha aqui (ver `syncCombatHp`).
        source_key: enemy.key,
        initiative_detail: enemyInitiativeDetail(enemy),
        supplies: enemy.supplies ?? null,
        combat_snapshot: enemy.snapshot,
        combat_ammo: ammoStateForParticipant(enemy.snapshot),
        ...(enemy.snapshot
          ? {
              combat_armor: { ...enemy.snapshot.combat.armor },
              critical_injuries: [...enemy.snapshot.combat.criticalInjuries],
            }
          : {}),
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

    await insertCombatantRows(rows, "Falha ao criar os combatentes");
    await query(db().from("mesa_sessions").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", session.id), "Falha ao atualizar a mesa");
    await appendEvent(combatId, { kind: "combat_started", text: "Combate iniciado" });

    // 3. Snapshot de ENTRADA da partida: com que vida cada linha começou.
    if (battleId) {
      const combatants = await listCombatants(session.id);
      await updateBattleRoster(battleId, startBattleSnapshot(combatants.map((row) => toCombatant(row))));
    }
  } catch (error) {
    if (battleId && !reuseBattleId) await discardBattle(battleId);
    throw error;
  }
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
  /**
   * Bônus de Iniciativa dos implantes do inimigo (0 quando não há) — a mesa
   * rola `1d10 + REF + bônus`, igual à tela de Encontros.
   */
  initiativeBonus: number;
  /** Chave estável do participante do encontro (vira `source_key`). */
  key: string | null;
  /** Mochila do inimigo (pente + reserva); `null` quando não há o que mostrar. */
  supplies: MesaSupplies | null;
  /** Snapshot já convertido; null para inimigos antigos/avulsos sem fonte completa. */
  snapshot: CombatState["participants"][number] | null;
}

/** MOVE × 2 metros quando o encontro informa o MOVE; senão o fallback do motor. */
function enemyMovementBudget(move: number | null): number {
  return move === null ? MOVEMENT_PER_TURN : movementMetersPerTurn(move);
}

/**
 * Detalhe da iniciativa de um inimigo seed: sempre o REF, e o bônus de
 * implantes quando houver (`rollInitiativeForAll` lê os dois).
 */
function enemyInitiativeDetail(enemy: EnemyInput): { refBonus: number; bonus?: number } {
  return enemy.initiativeBonus
    ? { refBonus: enemy.ref, bonus: enemy.initiativeBonus }
    : { refBonus: enemy.ref };
}

/**
 * Mochila vinda do cliente → só o que a coluna `supplies` guarda.
 *
 * Valores aparados para intervalos seguros e itens duplicados removidos.
 * `null` quando não sobra nada (arma corpo a corpo sem cura): a coluna fica
 * vazia em vez de gravar `{}`.
 */
function sanitizeSupplies(raw: unknown): MesaSupplies | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;

  const inventory: Array<{ item: string; quantity: number }> = [];
  if (Array.isArray(input.inventory)) {
    for (const entry of input.inventory) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
      const item = (entry as Record<string, unknown>).item;
      const quantity = Number((entry as Record<string, unknown>).quantity);
      if (typeof item !== "string") continue;
      const name = item.trim().slice(0, 60);
      const qty = Number.isFinite(quantity) ? Math.max(0, Math.min(999, Math.floor(quantity))) : 0;
      if (name.length === 0 || qty === 0) continue;
      if (inventory.some((existing) => existing.item === name)) continue;
      inventory.push({ item: name, quantity: qty });
    }
  }

  const int = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(999, Math.floor(parsed))) : null;
  };
  const magazine = int(input.magazine);
  const rawAmmo = int(input.ammo);
  const ammo = rawAmmo === null ? null : magazine === null ? rawAmmo : Math.min(rawAmmo, magazine);

  const supplies: MesaSupplies = { inventory };
  if (typeof input.weaponId === "string" && input.weaponId.trim()) supplies.weaponId = input.weaponId.trim().slice(0, 100);
  if (magazine !== null) supplies.magazine = magazine;
  if (ammo !== null) supplies.ammo = ammo;
  if (supplies.magazine === undefined && supplies.ammo === undefined && inventory.length === 0) return null;
  return supplies;
}

/**
 * Converte o recorte do encontro em snapshot do contrato canônico.
 *
 * O servidor não recalcula aqui valores do bestiário: a origem disponível para
 * inimigos ainda é o encontro local do GM. Depois de persistido, porém, o
 * snapshot não é mais lido do request nem do catálogo/localStorage. A arma só
 * é aceita quando possui o id estável já existente no catálogo.
 */
function sanitizeEnemySnapshot(raw: unknown, expectedKey: string | null): CombatState["participants"][number] | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.isPlayer !== false) return null;
  if (typeof value.id !== "string" || value.id.length === 0) return null;
  if (expectedKey !== null && value.id !== expectedKey) return null;
  if (typeof value.weaponId !== "string" || value.weaponId.length === 0) return null;

  try {
    const participant = toCombatParticipant({
      ...(value as unknown as EncounterParticipant),
      id: value.id,
    });
    const weapon = participant.weapons?.[0];
    if (!weapon?.id) return null;
    return participant;
  } catch {
    return null;
  }
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
    // Chave de origem (opcional): identifica QUAL participante do encontro é
    // este inimigo, para o HP aplicado lá chegar a esta linha.
    const rawKey = typeof enemy.key === "string" ? enemy.key.trim() : "";
    const key = rawKey.length > 0 ? rawKey.slice(0, 80) : null;
    // Bônus de Iniciativa dos implantes (opcional): ausente/inválido → 0.
    const rawBonus = Number(enemy.initiativeBonus);
    const initiativeBonus =
      enemy.initiativeBonus === undefined || enemy.initiativeBonus === null || !Number.isFinite(rawBonus)
        ? 0
        : Math.max(-20, Math.min(20, Math.floor(rawBonus)));
    return {
      name,
      hp,
      hpMax,
      ref,
      move,
      key,
      initiativeBonus,
      supplies: sanitizeSupplies(enemy.supplies),
      snapshot: sanitizeEnemySnapshot(enemy.snapshot, key),
    };
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
      source_key: enemy.key,
      // Já em combate: entra no fim da ordem com iniciativa 0.
      initiative: combat.initiative_started ? 0 : null,
      initiative_detail: enemyInitiativeDetail(enemy),
      supplies: enemy.supplies,
      combat_snapshot: enemy.snapshot,
      combat_ammo: ammoStateForParticipant(enemy.snapshot),
      ...(enemy.snapshot
        ? {
            combat_armor: { ...enemy.snapshot.combat.armor },
            critical_injuries: [...enemy.snapshot.combat.criticalInjuries],
          }
        : {}),
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

  await insertCombatantRows(rows, "Falha ao adicionar inimigos");
  await appendEvent(combat.id, { kind: "enemy", text: `${rows.length} inimigo(s) adicionado(s)` });
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
    await advanceActiveTurn(session.id, combat);
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

// ---------------------------------------------------------------------------
// Espelho de VIDA (HP) — da origem PARA a mesa
// ---------------------------------------------------------------------------

function sanitizeSourceKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length > 0 ? value.slice(0, 80) : null;
}

function sanitizeHp(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new MesaError("HP inválido.", 400, "invalid_hp");
  return Math.floor(value);
}

/** Linha de inimigo pela chave do participante do encontro que o originou. */
async function findEnemyBySourceKey(combatId: string, key: string): Promise<CombatantRow | null> {
  if (sourceKeySupport === "no") throw new MesaError(SOURCE_KEY_MIGRATION, 503, "migration_pending");
  try {
    const rows = (await query(
      db()
        .from("mesa_combatants")
        .select("*")
        .eq("combat_id", combatId)
        .eq("kind", "enemy")
        .eq("source_key", key)
        .order("sort_order")
        .limit(1),
      "Falha ao consultar o inimigo",
    )) as CombatantRow[] | null;
    return rows?.[0] ?? null;
  } catch (error) {
    if (mentionsSourceKey(error)) {
      sourceKeySupport = "no";
      throw new MesaError(SOURCE_KEY_MIGRATION, 503, "migration_pending");
    }
    throw error;
  }
}

/**
 * Inimigo pela chave do encontro, sem derrubar a rolagem se a migração do
 * `source_key` estiver pendente: nesse caso a linha não é encontrada e o dado
 * vira relatório (entra no Registro, não debita) — mesmo degradado o Mestre
 * continua rolando na tela do encontro.
 */
async function findEnemyForRoll(combatId: string, key: string): Promise<CombatantRow | null> {
  try {
    return await findEnemyBySourceKey(combatId, key);
  } catch (error) {
    if (error instanceof MesaError && error.code === "migration_pending") return null;
    throw error;
  }
}

/** Combatente do próprio participante (ficha dele é quem manda no HP). */
async function findOwnCombatant(combatId: string, participantId: string): Promise<CombatantRow | null> {
  const rows = (await query(
    db()
      .from("mesa_combatants")
      .select("*")
      .eq("combat_id", combatId)
      .eq("participant_id", participantId)
      .order("sort_order")
      .limit(1),
    "Falha ao consultar o combatente",
  )) as CombatantRow[] | null;
  return rows?.[0] ?? null;
}

/**
 * Sincroniza a VIDA de um combatente com o valor da ORIGEM.
 *
 * Um sentindo só (decisão de 27/09/2026): quem manda é a ficha do jogador e o
 * encontro do Mestre — a mesa apenas exibe; não há escrita de volta na ficha
 * (evita loop e respeita o localStorage do jogador como fonte da verdade).
 *
 * **Precondição `hpBefore` (F1.7.1, Decisão 2)**: quando o chamador envia o HP
 * que a origem acreditava ver ANTES desta mudança, `hp_current`/`is_dead` só
 * entram se a linha da mesa ainda estiver nesse valor. É o que impede um push
 * atrasado — enviado antes de uma resolução do Combat Engine (caminho B,
 * `POST /combat/damage`) ou de um ajuste manual do painel — de sobrescrever
 * cegamente um resultado mais novo: se a linha mudou, o push de HP é ignorado
 * (`updated: false`) e o down-sync do encontro (`applyMesaStateToEncounter`,
 * realtime + polling) re-sincroniza a origem para o valor da mesa. Sem
 * `hpBefore` vale o comportamento legado (escrita direta): pacotes antigos no
 * navegador continuam funcionando; hoje TODO call site de inimigo envia.
 *
 * Dois caminhos:
 *   • **sem `key`** → o combatente ligado a ESTE participante (qualquer papel);
 *   • **com `key`** → inimigo pelo `source_key` — somente Mestre, que é quem
 *     aplica dano em `/gm/encounters`.
 *
 * Sem combate ativo ou sem combatente correspondente não dá erro: devolve
 * `{ updated: false }` e nada muda (o chamador é fire-and-forget).
 */
export async function syncCombatHp(input: {
  sessionId: unknown;
  token: unknown;
  hp?: unknown;
  hpMax?: unknown;
  isDead?: unknown;
  key?: unknown;
  /** Mochila do inimigo (só Mestre, junto do `key`) — mesma rota do espelho de HP. */
  supplies?: unknown;
  /**
   * HP da ORIGEM antes desta mudança (precondição, F1.7.1). Ausente = caminho
   * legado sem guarda. `hp_max`/`supplies` NÃO são cobertos pela precondição:
   * o Combat Engine nunca escreve essas colunas.
   */
  hpBefore?: unknown;
}): Promise<{ updated: boolean }> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  if (session.status === "finished") return { updated: false };

  const hp = sanitizeHp(input.hp);
  const hpMax =
    typeof input.hpMax === "number" && Number.isFinite(input.hpMax) ? Math.max(1, Math.floor(input.hpMax)) : null;
  const key = sanitizeSourceKey(input.key);
  if (key) requireGM({ session, participant });

  const combat = await getActiveCombat(session.id);
  if (!combat) return { updated: false };

  const row = key
    ? await findEnemyBySourceKey(combat.id, key)
    : await findOwnCombatant(combat.id, participant.id);
  if (!row) return { updated: false };

  // Durante um combate ativo, HP de personagens só muda por uma resolução
  // server-side (ataque/dano/cura quando existir). O espelho local não pode
  // sobrescrever silenciosamente o estado autoritativo da Mesa.
  if (!key) {
    throw new MesaError("Durante o combate, o HP da Mesa é autoritativo.", 409, "mesa_authoritative");
  }

  const max = hpMax ?? row.hp_max;
  const clamped = Math.max(-999, Math.min(max, hp));

  // F1.7.1 (Decisão 2): precondição opcional — a mudança de VIDA só entra se
  // a linha da mesa ainda estiver no valor que a origem acreditava antes dela.
  // É uma atualização condicional (CAS no valor esperado), sem timestamps e
  // sem texto de evento como autoridade.
  const hpBefore =
    typeof input.hpBefore === "number" && Number.isFinite(input.hpBefore) ? Math.floor(input.hpBefore) : null;
  const stalePush = hpBefore !== null && row.hp_current !== hpBefore;

  const update: Record<string, unknown> = {};
  if (!stalePush) update.hp_current = clamped;
  if (hpMax !== null) update.hp_max = hpMax;

  // Mochila do inimigo (migração pendente → simplesmente não entra no update).
  const supplies = key ? sanitizeSupplies(input.supplies) : null;
  if (supplies && suppliesSupport !== "no") update.supplies = supplies;
  if (supplies?.weaponId && supplies.ammo !== undefined && suppliesSupport !== "no") {
    update.combat_ammo = { ...(row.combat_ammo ?? {}), [supplies.weaponId]: supplies.ammo };
  }

  if (stalePush) {
    // Push obsoleto: hp_current e is_dead ficam DE FORA — a morte derivaria do
    // HP que estamos recusando. `hp_max`/`supplies` acima seguem: o Combat
    // Engine nunca escreve essas colunas, então não há o que proteger ali.
  } else if (key) {
    // Inimigo não faz death save nesta aplicação: 0 HP = fora da ordem de turno,
    // cura acima de 0 = volta a agir. Regra determinística, sem estado próprio —
    // F1.3: mesma política da regra canônica de dano (`applyDamage`), para a
    // derrota do inimigo existir num lugar só. Aqui é só o espelho do HP que
    // veio aplicado; a regra não conhece esta persistência.
    update.is_dead = isDefeatedBy(ENEMY_DAMAGE_POLICY, clamped, row.is_dead);
  } else if (typeof input.isDead === "boolean") {
    // Ficha manda: morte só quando a ficha diz morte (0 HP com death save
    // pendente continua em jogo, como no modo local).
    update.is_dead = input.isDead;
  } else if (clamped > 0) {
    update.is_dead = false;
  }

  // Só é vazio quando a guarda derrubou as duas colunas de VIDA (sem hp_max
  // nem mochila no payload): nada a escrever, devolve o no-op documentado.
  if (Object.keys(update).length === 0) return { updated: false };

  try {
    if (hpBefore !== null) {
      // Não basta o read acima: o Engine pode vencer ENTRE a leitura e o
      // update. O mesmo valor esperado também precisa estar no WHERE desta
      // instrução atômica; `select` torna a perda do CAS observável.
      const written = (await query(
        db()
          .from("mesa_combatants")
          .update(update)
          .eq("id", row.id)
          .eq("hp_current", hpBefore)
          .select("id"),
        "Falha ao atualizar o HP",
      )) as Array<{ id: string }> | null;
      if (!written || written.length === 0) return { updated: false };
    } else {
      await query(db().from("mesa_combatants").update(update).eq("id", row.id), "Falha ao atualizar o HP");
    }
  } catch (error) {
    if (suppliesSupport !== "no" && mentionsSupplies(error)) {
      // Migração da mochila pendente: a vida é o que importa, então refaz o
      // update sem a coluna e deixa a linha da mesa sem pente/cura.
      suppliesSupport = "no";
      const retry = { ...update };
      delete retry.supplies;
      if (hpBefore !== null) {
        const written = (await query(
          db()
            .from("mesa_combatants")
            .update(retry)
            .eq("id", row.id)
            .eq("hp_current", hpBefore)
            .select("id"),
          "Falha ao atualizar o HP",
        )) as Array<{ id: string }> | null;
        if (!written || written.length === 0) return { updated: false };
      } else {
        await query(db().from("mesa_combatants").update(retry).eq("id", row.id), "Falha ao atualizar o HP");
      }
      return { updated: true };
    }
    if (mentionsSourceKey(error)) {
      sourceKeySupport = "no";
      throw new MesaError(SOURCE_KEY_MIGRATION, 503, "migration_pending");
    }
    throw error;
  }

  return { updated: true };
}

// ---------------------------------------------------------------------------
// F1.7.1 — Primeiro vertical slice: Combat Engine → Adapter → mesa_combatants
// ---------------------------------------------------------------------------

/** Narrowing sem mágica: `unknown` → membro da união, pela própria lista. */
function isHitLocation(value: unknown): value is HitLocation {
  return typeof value === "string" && hitLocations.some((location) => location === value);
}

/** SP de veste/cyberware de entrada (inteiro, não-negativo); inválido → null. */
function sanitizeSp(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.max(0, Math.floor(raw));
}

/**
 * Veste `{ head, body }` vinda da ORIGEM: o encontro é o dono do armor e a
 * mesa NÃO persiste coluna de armor (fora do escopo F1.7.1). `null` = entrada
 * inválida — o chamador recusa; o motor não inventa SP.
 */
function sanitizeArmorInput(raw: unknown): { head: number; body: number } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const head = sanitizeSp(record.head);
  const body = sanitizeSp(record.body);
  if (head === null || body === null) return null;
  return { head, body };
}

/**
 * F1.7.1 — resolve UM dano de INIMIGO pelo Combat Engine e persiste o
 * resultado em `mesa_combatants` (APENAS `hp_current` e `is_dead`).
 *
 * O primeiro vertical slice real de integração — o caminho B das Decisões:
 *
 *     rota POST /combat/damage ─► authenticate + requireGM
 *                          ─► linha da mesa (hp/is_dead lidos AQUI)
 *                          ─► engine.execute(state, DamageAction, serverRandom)
 *                          ─► engineDamagePatch (VERBATIM de `changes`)
 *                          ─► UPDATE condicional (CAS) ─► mesa_combatants
 *
 * **Autoridade (Decisão 2)**: durante UMA resolução do Engine, Motor + Adapter
 * mandam no resultado escrito; o espelho `/combat/hp` (caminho A) não
 * participa — e a guarda `hpBefore` do lado DELE impede um push atrasado de
 * sobrescrever este resultado. Fora de resolução o espelho continua sendo o
 * caminho das sincronizações da origem (cura, mochila, ficha).
 *
 * **Idempotência (Decisão 4)**: `hpBefore` é a identidade prática da
 * resolução — o HP da origem ANTES deste dano, gerado antes da persistência e
 * reenviado igual no retry. Retry da MESMA resolução encontra a linha já
 * movida e é recusado (409 `stale_hp`) → efeito aplicado UMA vez. Idempotência
 * durável com chave persistida exigiria coluna + constraint novos em
 * `mesa_combatants` (migração) — BLOQUEADO como maior que o escopo seguro
 * deste palco e, por isso, não improvisada: sem chave persistida não se
 * afirma deduplicação completa (limite documentado: se a linha voltar ao
 * valor `hpBefore` entre tentativas, o retry re-aplica).
 *
 * **Concorrência (Decisão 3)**: a escrita é UMA instrução condicional
 * (`WHERE id AND hp_current = hpBefore AND is_dead = <lido>`), atômica no
 * Postgres — CAS/conditional update, sem lock distribuído, sem transação
 * multi-statement, sem RPC. Quem perde a corrida recebe 409 `hp_conflict`
 * (nunca escrita silenciosa).
 *
 * **RNG**: `serverRandom` obrigatório — nada de dado vindo do cliente; o único
 * sorteio dentro do motor aqui é o 2d6 de Critical Injury, que inimigo não
 * rastreia (`deathSave` ausente).
 *
 * Fora do escopo (não inventado): armor/lesão/munição não são persistidos;
 * personagem de jogador não passa por aqui (`key` obrigatório +
 * `findEnemyBySourceKey` filtram `kind = "enemy"`); nenhum `MesaEvent` é criado
 * (STATE = autoridade, EVENT = história auxiliar).
 */
export async function resolveEnemyDamage(input: {
  sessionId: unknown;
  token: unknown;
  /** `source_key` do inimigo — obrigatório: este caminho é só de inimigos. */
  key: unknown;
  amount: unknown;
  /** HP da ORIGEM antes deste dano — precondição, CAS e idempotência. */
  hpBefore: unknown;
  hitLocation?: unknown;
  ignoreArmor?: unknown;
  /** Veste do inimigo no encontro `{ head, body }` — dono é a origem. */
  armor?: unknown;
  /** SP de cyberware do corpo (implantes do encontro). */
  bodySP?: unknown;
}): Promise<{ updated: boolean; hp: number | null; isDead: boolean | null }> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireGM({ session, participant });
  if (session.status === "finished") return { updated: false, hp: null, isDead: null };

  const key = sanitizeSourceKey(input.key);
  if (!key) {
    throw new MesaError("Resolução de dano sem a chave do inimigo (key).", 400, "invalid_key");
  }

  const combat = await getActiveCombat(session.id);
  if (!combat) return { updated: false, hp: null, isDead: null };

  const row = await findEnemyBySourceKey(combat.id, key);
  if (!row) return { updated: false, hp: null, isDead: null };

  /* ---------------- idempotência/precondição (Decisão 4) ------------------ */

  if (typeof input.hpBefore !== "number" || !Number.isFinite(input.hpBefore)) {
    throw new MesaError("Resolução sem hpBefore (HP da origem antes deste dano).", 400, "missing_hp_before");
  }
  const hpBefore = Math.floor(input.hpBefore);
  if (row.hp_current !== hpBefore) {
    // Retry da MESMA resolução (já aplicada) ou linha movida por outra
    // escrita: recusar em 409 é o que garante efeito único — a escrita abaixo
    // é condicional ao MESMO valor.
    throw new MesaError(
      "HP da mesa não corresponde ao hpBefore desta resolução (já aplicada ou estado mudou).",
      409,
      "stale_hp",
    );
  }

  /* ------------------------- entradas de origem ---------------------------- */

  const armor = sanitizeArmorInput(input.armor);
  if (!armor) {
    throw new MesaError("Informe a armadura do inimigo: { head, body }.", 400, "invalid_armor");
  }
  const bodySP =
    typeof input.bodySP === "number" && Number.isFinite(input.bodySP) ? Math.max(0, Math.floor(input.bodySP)) : 0;
  if (input.hitLocation !== undefined && !isHitLocation(input.hitLocation)) {
    throw new MesaError("Local de impacto inválido.", 400, "invalid_action");
  }
  const hitLocation = isHitLocation(input.hitLocation) ? input.hitLocation : undefined;

  /* --------------------------- snapshot + motor --------------------------- */

  // Recorte EXATO do que a passagem `damage` do motor lê: hp/armor/
  // cyberwareSP/isDead/criticalInjuries (`deathSave` ausente = inimigo não
  // rastreia), nome para as mensagens de erro e `type` para a política.
  // STATS/perícias/armas/`cyberware` não entram porque dano não os lê; a
  // ponte `conditions: string[] → {id,name}` é pendência registrada do F1.3
  // (dano não lê conditions) — não é inventada aqui.
  const state: CombatState = {
    id: combat.id,
    status: combat.status,
    round: combat.round,
    initiativeStarted: combat.initiative_started,
    activeParticipantId: combat.active_combatant_id,
    participants: [
      {
        id: row.id,
        type: row.kind,
        name: row.name,
        // `enemyId` (template do bestiário) não existe na linha da mesa: a
        // identidade da instância é o `source_key` (decisão F0.4/F0.5).
        source: { characterId: row.character_id, sourceKey: row.source_key ?? null, enemyId: null },
        combat: {
          hp: { current: row.hp_current, max: row.hp_max },
          armor,
          cyberwareSP: { head: 0, body: bodySP }, // `head` sempre 0 (F1.3)
          criticalInjuries: [], // encontro não rastreia lesões (recorte dos adapters)
          conditions: [],
          initiative: row.initiative,
          isDead: row.is_dead,
        },
      },
    ],
  };

  const action: DamageAction = {
    type: "damage",
    actorId: null, // dano de fonte externa/GM: sem guarda de ator
    targetId: row.id,
    amount: Number(input.amount), // validação é do motor (fonte única)
    ...(hitLocation !== undefined ? { hitLocation } : {}),
    ...(input.ignoreArmor === true ? { ignoreArmor: true } : {}),
  };

  const result = execute(state, action, serverRandom);
  if (!result.ok) {
    // Recusa do motor → NENHUMA persistência (o patch nem é calculado).
    const engineError = result.errors?.[0];
    throw new MesaError(
      engineError?.message ?? "O motor de combate recusou o dano.",
      400,
      engineError?.code ?? "engine_refused",
    );
  }

  /* --------------------- adapter VERBATIM + escrita CAS ------------------- */

  const patch = engineDamagePatch(result, row.id);
  if (Object.keys(patch).length > 0) {
    // Uma única instrução condicional (Decisão 3): atômica no Postgres, protege
    // a janela leitura→escrita sem lock. Verbas atômicas: só `hp_current` e
    // `is_dead` (as colunas deste palco) — `armor_changed`/lesão não têm coluna.
    const written = (await query(
      db()
        .from("mesa_combatants")
        .update(patch)
        .eq("id", row.id)
        .eq("hp_current", hpBefore)
        .eq("is_dead", row.is_dead)
        .select("id"),
      "Falha ao persistir o dano",
    )) as Array<{ id: string }> | null;
    if (!written || written.length === 0) {
      // Perdedora da corrida: erro ALTO, nunca escrita silenciosa.
      throw new MesaError(
        "A linha da mesa mudou entre a leitura e a escrita; nada foi aplicado.",
        409,
        "hp_conflict",
      );
    }
  }

  return {
    updated: true,
    hp: patch.hp_current ?? row.hp_current,
    isDead: patch.is_dead ?? row.is_dead,
  };
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
    initiativeDetail: { expression: string; refBonus: number; total: number; bonus?: number };
    isDead: boolean;
    sortOrder: number;
  }> = [];

  for (const row of rows) {
    let total = 0;
    let expression = "";
    let refBonus = 0;
    let bonus = 0;

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
      const detail = row.initiative_detail as { refBonus?: number; bonus?: number } | null;
      refBonus = Math.floor(detail?.refBonus ?? 5);
      bonus = Math.floor(detail?.bonus ?? 0);
      total = rollEnemyInitiative(refBonus, bonus);
      expression = bonus
        ? `REF ${refBonus} + ${bonus} (implantes) + 1d10`
        : `REF ${refBonus} + 1d10`;
    }

    rolled.push({
      id: row.id,
      kind: row.kind,
      name: row.name,
      initiative: total,
      // O bônus precisa sobreviver a uma segunda rolagem: ele vem do
      // `initiative_detail` gravado no seed e não é recalculado aqui.
      initiativeDetail: { expression, refBonus, total, ...(bonus ? { bonus } : {}) },
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
  );
}

/** Avança o turno a partir do estado atual do banco. */
async function advanceActiveTurn(sessionId: string, combat: CombatRow): Promise<void> {
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
    await appendEvent(combat.id, { kind: "combat_finished", text: "Combate encerrado" });
    // Todos os inimigos caíram: a partida encerra sozinha e vira histórico.
    await completeActiveBattle(sessionId);
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
  await appendEvent(combat.id, event);
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
  await appendEvent(combat.id, { kind: "action", text: `${row.name}: ${label}` });
}

/** Reload server-authoritative, separado do fluxo de ataque. */
export async function reloadIntegrated(input: {
  sessionId: unknown;
  token: unknown;
  resolutionId: unknown;
  weaponId: unknown;
}): Promise<{ result: ReloadResponse; committed: boolean }> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  const resolutionId = requireResolutionId(input.resolutionId);
  const weaponId = typeof input.weaponId === "string" ? input.weaponId.trim() : "";
  if (!weaponId) throw new MesaError("Arma inválida.", 400, "weapon_not_found");

  const combat = await getActiveCombat(session.id);
  if (!combat) throw new MesaError("Nenhum combate ativo.", 409, "combat_not_active");

  const previous = await storedReloadResolution(session.id, resolutionId, combat.id);
  if (previous?.status === "committed" && previous.result) return { result: previous.result, committed: false };
  if (previous?.status === "failed") throw new MesaError("A resolução deste reload falhou antes do commit; não será reexecutada.", 409, "resolution_failed");
  if (previous?.status === "processing") return { result: await waitForReloadResolution(session.id, resolutionId, previous.combat_id), committed: false };

  const rows = (await query(
    db().from("mesa_combatants").select("*").eq("combat_id", combat.id),
    "Falha ao consultar os combatentes",
  )) as CombatantRow[];
  // O combatente é derivado da participação autenticada; nunca do body.
  const actorRow = rows.find((row) => row.participant_id === participant.id && row.kind === "character");
  if (!actorRow) throw new MesaError("Ator não encontrado.", 404, "actor_not_found");
  authorizeCombatAttackActor({ session, participant }, actorRow);

  const actionCheck = resolveAction({
    combatStatus: combat.status,
    initiativeStarted: combat.initiative_started,
    activeCombatantId: combat.active_combatant_id,
    actorRole: participant.role,
    actorOwnsCombatant: actorRow.participant_id === participant.id,
    combatant: {
      id: actorRow.id,
      isDead: actorRow.is_dead,
      actionsMax: actorRow.actions_max,
      actionsRemaining: actorRow.actions_remaining,
      movementMax: actorRow.movement_max,
      movementRemaining: actorRow.movement_remaining,
    },
    actionType: "reload",
  });
  if (!actionCheck.ok) throw new MesaError(DENIAL_MESSAGES[actionCheck.reason], 403, actionCheck.reason);

  const snapshot = combatParticipantFromRow(actorRow);
  const weapon = snapshot?.weapons?.find((candidate) => candidate.id === weaponId);
  if (!snapshot || !weapon) throw new MesaError("Arma não pertence ao combatente.", 400, "weapon_not_found");
  if (typeof weapon.magazine !== "number" || weapon.magazine <= 0) {
    throw new MesaError("Esta arma não possui magazine.", 409, "reload_unavailable");
  }

  const ammoBefore = actorRow.combat_ammo?.[weaponId];
  if (typeof ammoBefore !== "number") {
    throw new MesaError("A munição server-side desta arma não está disponível.", 409, "ammo_unavailable");
  }
  const suppliesBefore = actorRow.supplies ?? { inventory: [] };
  const inventory = suppliesBefore.inventory ?? [];
  const plan = planReload(weapon, ammoBefore, weapon.magazine, inventory);
  if (!plan.canReload) throw new MesaError(plan.reason ?? "Não é possível recarregar esta arma agora.", 409, "reload_unavailable");
  const suppliesAfter: MesaSupplies = {
    ...suppliesBefore,
    inventory: applyReload(plan, inventory) ?? inventory,
  };
  const ammoAfter = weapon.magazine;
  const nextAmmo = { ...(actorRow.combat_ammo ?? {}), [weaponId]: ammoAfter };
  const actionsAfter = actorRow.actions_remaining - actionCheck.cost;
  const result: ReloadResponse = {
    weaponId,
    ammoBefore,
    ammoAfter,
    actionsBefore: actorRow.actions_remaining,
    actionsAfter,
    consumed: ammoAfter - ammoBefore,
  };

  const claimRows = (await query(
    db().rpc("claim_mesa_reload_resolution", {
      p_session_id: session.id,
      p_combat_id: combat.id,
      p_resolution_id: resolutionId,
    }),
    "Falha ao reservar a resolução do reload",
  )) as ReloadResolutionClaim[] | null;
  const claim = claimRows?.[0];
  if (!claim) throw new MesaError("Não foi possível reservar a resolução do reload.", 500, "transaction_failed");
  if (!claim.claimed) {
    if (claim.status === "committed" && claim.result) return { result: claim.result, committed: false };
    if (claim.status === "failed") throw new MesaError("A resolução deste reload falhou antes do commit; não será reexecutada.", 409, "resolution_failed");
    return { result: await waitForReloadResolution(session.id, resolutionId, combat.id), committed: false };
  }

  try {
    const committedResult = (await query(
      db().rpc("commit_mesa_reload_resolution", {
        p_session_id: session.id,
        p_combat_id: combat.id,
        p_resolution_id: resolutionId,
        p_claim_token: claim.claim_token,
        p_actor_id: actorRow.id,
        p_weapon_id: weaponId,
        p_magazine: weapon.magazine,
        p_actions_before: actorRow.actions_remaining,
        p_actions_after: actionsAfter,
        p_ammo_before: actorRow.combat_ammo ?? null,
        p_ammo_after: nextAmmo,
        p_supplies_before: actorRow.supplies ?? null,
        p_supplies_after: suppliesAfter,
        p_result: result,
        p_event_text: `${actorRow.name}: recarregou ${weapon.name}`,
      }),
      "Falha ao confirmar a resolução do reload",
    )) as ReloadResponse | null;
    if (!committedResult) throw new MesaError("A resolução não retornou resultado persistido.", 500, "transaction_failed");
    return { result: committedResult, committed: true };
  } catch (error) {
    try {
      await query(
        db().rpc("release_mesa_reload_resolution", {
          p_session_id: session.id,
          p_combat_id: combat.id,
          p_resolution_id: resolutionId,
          p_claim_token: claim.claim_token,
        }),
        "Falha ao liberar a resolução do reload",
      );
    } catch {
      // Preserva o erro original; nenhum efeito parcial é aceito pela RPC.
    }
    if (error instanceof Error) {
      const code = ["reload_conflict", "reload_not_active", "not_your_turn", "resolution_in_progress"].find((candidate) => error.message.includes(candidate));
      if (code) throw new MesaError("A resolução concorrente não pôde ser aplicada.", 409, code);
    }
    throw error;
  }
}

/**
 * F1.7.5 — ataque integrado GM → Combat Engine.
 *
 * A rota recebe apenas IDs/modo. Os dois IDs HTTP são IDs de
 * `mesa_combatants`; o action usa os IDs dos snapshots. Ammo é o único estado
 * mutável do Engine persistido aqui, separado do snapshot imutável.
 */
export async function attackIntegrated(input: {
  sessionId: unknown;
  token: unknown;
  resolutionId: unknown;
  actorId: unknown;
  targetId: unknown;
  weaponId?: unknown;
  skillId?: unknown;
  attackType?: unknown;
  attackMode?: unknown;
  aimedTarget?: unknown;
}): Promise<IntegratedAttackOutcome> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  const resolutionId = requireResolutionId(input.resolutionId);
  const activeCombat = await getActiveCombat(session.id);
  const previous = await storedAttackResolution(session.id, resolutionId, activeCombat?.id);
  if (previous?.status === "committed" && previous.result) return { result: previous.result, committed: false };
  if (previous?.status === "failed") throw new MesaError("A resolução deste ataque falhou antes do commit; não será reexecutada.", 409, "resolution_failed");
  if (previous?.status === "processing") return { result: await waitForAttackResolution(session.id, resolutionId, previous.combat_id), committed: false };

  const combat = activeCombat;
  if (!combat) throw new MesaError("Nenhum combate ativo.", 409, "combat_not_active");

  const claimRows = (await query(
    db().rpc("claim_mesa_attack_resolution", {
      p_session_id: session.id,
      p_combat_id: combat.id,
      p_resolution_id: resolutionId,
    }),
    "Falha ao reservar a resolução do ataque",
  )) as AttackResolutionClaim[] | null;
  const claim = claimRows?.[0];
  if (!claim) throw new MesaError("Não foi possível reservar a resolução do ataque.", 500, "transaction_failed");
  if (!claim.claimed) {
    if (claim.status === "committed" && claim.result) return { result: claim.result, committed: false };
    if (claim.status === "failed") throw new MesaError("A resolução deste ataque foi marcada como abandonada; não será reexecutada.", 409, "resolution_failed");
    return { result: await waitForAttackResolution(session.id, resolutionId), committed: false };
  }
  const claimToken = claim.claim_token;
  let committed = false;

  try {

  const actorRowId = typeof input.actorId === "string" ? input.actorId : "";
  const targetRowId = typeof input.targetId === "string" ? input.targetId : "";
  const rows = (await query(
    db().from("mesa_combatants").select("*").eq("combat_id", combat.id),
    "Falha ao consultar os combatentes",
  )) as CombatantRow[];
  const actorRow = rows.find((row) => row.id === actorRowId);
  const targetRow = rows.find((row) => row.id === targetRowId);
  if (!actorRow) throw new MesaError("Ator não encontrado.", 404, "actor_not_found");
  if (!targetRow) throw new MesaError("Alvo não encontrado.", 404, "target_not_found");
  validateCombatAttackTarget(combat, targetRow);
  authorizeCombatAttackActor({ session, participant }, actorRow);

  const participants = rows.map((row) => ({ row, participant: combatParticipantFromRow(row) }));
  if (participants.some(({ participant: snapshot }) => !snapshot)) {
    throw new MesaError("Combate sem snapshot server-side completo.", 409, "combat_snapshot_missing");
  }
  const actor = participants.find(({ row }) => row.id === actorRow.id)?.participant;
  const target = participants.find(({ row }) => row.id === targetRow.id)?.participant;
  if (!actor || !target) throw new MesaError("Snapshot de combate ausente.", 409, "combat_snapshot_missing");
  if (actor.combat.isDead) throw new MesaError("Ator derrotado.", 403, "combatant_defeated");
  // A elegibilidade estrutural do alvo já foi validada antes de reconstruir o
  // snapshot; esta guarda mantém a autoridade do estado reconstruído caso a
  // linha seja alterada durante a leitura.
  if (target.combat.isDead) throw new MesaError("Alvo derrotado.", 400, "target_defeated");

  // A única defesa suportada nesta etapa é Evasion real do snapshot.
  if (!hasServerEvasionTarget(target)) {
    throw new MesaError("Alvo não possui DEX e Evasion server-side suficientes.", 409, "evasion_unavailable");
  }

  const rawMode = input.attackMode;
  if (rawMode !== "normal" && rawMode !== "aimed") {
    throw new MesaError("Somente ataques normal/aimed estão disponíveis nesta etapa.", 400, "invalid_attack_mode");
  }
  if (rawMode === "normal" && input.aimedTarget !== undefined) {
    throw new MesaError("Ataque normal não aceita aimedTarget.", 400, "invalid_aimed_target");
  }
  if (rawMode === "aimed" && input.aimedTarget !== "head" && input.aimedTarget !== "leg" && input.aimedTarget !== "held_item") {
    throw new MesaError("Aimed shot exige head, leg ou held_item.", 400, "invalid_aimed_target");
  }

  const requestedWeaponId = input.weaponId === undefined || input.weaponId === null ? undefined : String(input.weaponId);
  const weapon = requestedWeaponId ? actor.weapons?.find((candidate) => candidate.id === requestedWeaponId) : undefined;
  if (requestedWeaponId && !weapon) throw new MesaError("Arma não pertence ao ator.", 400, "weapon_not_found");

  const skillId = weapon?.skill ?? (typeof input.skillId === "string" ? input.skillId : undefined);
  if (!skillId || !actor.skills?.[skillId]) throw new MesaError("Skill não pertence ao ator.", 400, "skill_not_found");
  if (input.skillId !== undefined && input.skillId !== skillId) {
    throw new MesaError("Skill inconsistente com a arma do snapshot.", 400, "invalid_skill");
  }

  const attackType = weapon?.attackType ?? input.attackType;
  if (typeof attackType !== "string") throw new MesaError("Tipo de ataque ausente.", 400, "invalid_attack_type");
  if (weapon?.attackType && input.attackType !== undefined && input.attackType !== weapon.attackType) {
    throw new MesaError("Tipo de ataque inconsistente com a arma do snapshot.", 400, "invalid_attack_type");
  }

  // Sem uma coluna server-side por weaponId, não é permitido descartar ammo.
  // A migration F1.7.5 cria e mantém esse mapa antes da resolução.
  if (weapon && weapon.id && weapon.ammo === undefined && weapon.magazine !== undefined) {
    throw new MesaError("Ammo da arma não está disponível no snapshot.", 409, "ammo_unavailable");
  }

  const state: CombatState = {
    id: combat.id,
    status: combat.status,
    round: combat.round,
    initiativeStarted: combat.initiative_started,
    activeParticipantId: combat.active_combatant_id,
    participants: participants.map(({ participant: snapshot }) => snapshot as CombatParticipant),
  };
  const action: AttackAction = {
    type: "attack",
    actorId: actor.id,
    targetId: target.id,
    ...(requestedWeaponId ? { weaponId: requestedWeaponId } : {}),
    skillId,
    attackType: attackType as AttackAction["attackType"],
    attackMode: rawMode,
    defense: { type: "evasion" },
    ...(typeof input.aimedTarget === "string" ? { aimedTarget: input.aimedTarget as AttackAction["aimedTarget"] } : {}),
  };

  const economyCheck = resolveAction({
    combatStatus: combat.status,
    initiativeStarted: combat.initiative_started,
    activeCombatantId: combat.active_combatant_id,
    actorRole: participant.role,
    actorOwnsCombatant: actorRow.participant_id === participant.id,
    combatant: {
      id: actorRow.id,
      isDead: actorRow.is_dead,
      actionsMax: actorRow.actions_max,
      actionsRemaining: actorRow.actions_remaining,
      movementMax: actorRow.movement_max,
      movementRemaining: actorRow.movement_remaining,
    },
    actionType: "attack",
    meters: 0,
  });
  if (!economyCheck.ok) throw new MesaError(DENIAL_MESSAGES[economyCheck.reason], 403, economyCheck.reason);

  const result = execute(state, action, serverRandom);
  if (!result.ok || !result.attackResult) {
    const error = result.errors?.[0];
    throw new MesaError(error?.message ?? "O Combat Engine recusou o ataque.", 400, error?.code ?? "engine_refused");
  }

  const ammoAfter = requestedWeaponId
    ? result.state.participants.find((candidate) => candidate.id === actor.id)?.weapons?.find((candidate) => candidate.id === requestedWeaponId)?.ammo
    : undefined;

  const ammoChange = result.changes.find(
    (change): change is Extract<(typeof result.changes)[number], { type: "ammo_changed" }> =>
      change.type === "ammo_changed",
  );
  const nextAmmo = ammoChange?.weaponId
    ? { ...(actorRow.combat_ammo ?? {}), [ammoChange.weaponId]: ammoChange.after }
    : actorRow.combat_ammo ?? null;

  const economy = applyAction(
    {
      actionsMax: actorRow.actions_max,
      actionsRemaining: actorRow.actions_remaining,
      movementMax: actorRow.movement_max,
      movementRemaining: actorRow.movement_remaining,
    },
    "attack",
    0,
  );
  let response: IntegratedAttackResponse;
  let targetPatch: EngineDamagePatch = {};

  // Misses terminate at AttackResult. Action and ammo are committed together
  // with the durable resolution below.
  if (!result.attackResult.hit) {
    response = { attackResult: result.attackResult, ammoAfter };
  } else {
    const location = resolveHitLocation(result.attackResult);
    if (!location.ok) {
      throw new MesaError(location.error.message, 400, location.error.code);
    } else {
      // Damage is a separate pipeline. The attack is never rolled again. A
      // normal attack without a canonical location stops before damage RNG.
      const damageRoll = rollWeaponDamage(actor, result.attackResult, serverRandom);
      if (!damageRoll.ok) {
        throw new MesaError(damageRoll.error.message, 400, damageRoll.error.code);
      } else {
        const damageAction: DamageAction = {
          type: "damage",
          actorId: actor.id,
          targetId: target.id,
          amount: damageRoll.roll.total,
          hitLocation: location.location,
          damageRolls: damageRoll.roll.rolls,
        };
        const damage = execute(result.state, damageAction, serverRandom);
        if (!damage.ok || !damage.damageResult) {
          const error = damage.errors?.[0] ?? { code: "damage_refused", message: "O Damage Engine recusou o dano." };
          throw new MesaError(error.message, 400, error.code);
        } else {
          targetPatch = engineDamagePatch(damage, target.id);
          response = { attackResult: result.attackResult, ammoAfter, weaponDamage: damageRoll.roll, damageResult: damage.damageResult };
        }
      }
    }
  }

  response = { ...response, actionAfter: economy.actionsRemaining };

  const committedResult = (await query(
    db().rpc("commit_mesa_attack_resolution", {
      p_session_id: session.id,
      p_combat_id: combat.id,
      p_resolution_id: resolutionId,
      p_claim_token: claimToken,
      p_actor_id: actorRow.id,
      p_target_id: targetRow.id,
      p_actions_before: actorRow.actions_remaining,
      p_actions_after: economy.actionsRemaining,
      p_ammo_before: actorRow.combat_ammo ?? null,
      p_ammo_after: nextAmmo,
      p_target_hp_before: targetRow.hp_current,
      p_target_dead_before: targetRow.is_dead,
      p_target_patch: targetPatch,
      p_result: response,
      p_event_text: `${actorRow.name}: ataque integrado`,
    }),
    "Falha ao confirmar a resolução do ataque",
  )) as IntegratedAttackResponse | null;
  if (!committedResult) throw new MesaError("A resolução não retornou resultado persistido.", 500, "transaction_failed");
  committed = true;
  return { result: committedResult, committed: true };
  } catch (error) {
    if (!committed) {
      try {
        await query(
          db().rpc("release_mesa_attack_resolution", {
            p_session_id: session.id,
            p_combat_id: combat.id,
            p_resolution_id: resolutionId,
            p_claim_token: claimToken,
          }),
          "Falha ao liberar a resolução do ataque",
        );
      } catch {
        // O erro original é mais útil; a resolução sem commit não aplicou efeitos.
      }
    }
    throw databaseResolutionError(error) ?? error;
  }
}

/**
 * Registra uma rolagem feita NA ficha (do jogador) ou NA TELA DO ENCONTRO
 * (do Mestre) por alguém conectado à mesa.
 *
 * A rolagem usa a MESMA economia do botão ATAQUE: o servidor valida com
 * `resolveAction` (combate ativo? iniciativa? seu turno? sobrou Action?) e só
 * debita se puder — quem paga é `planRollDebit`. Fora do turno ela ainda entra
 * no Registro do combate — o dado aconteceu e todo mundo deve ver — só que
 * marcada como "não contou".
 *
 * Com `key` (a chave do participante do encontro) o Mestre rola COM o inimigo:
 * o débito sai da linha dele na mesa e o Registro passa a usar o nome do
 * inimigo. Sem chave, o GM segue como relatório puro — comanda inimigos
 * livremente na CPR e nada é debitado de combatente algum.
 *
 * Sem combate ativo não há registro: devolve `registered: false` e nada muda.
 * O chamador é fire-and-forget; falha aqui nunca pode quebrar a ficha local.
 */
export async function registerRoll(input: {
  sessionId: unknown;
  token: unknown;
  roll: unknown;
  key?: unknown;
}): Promise<{ registered: boolean; debited: boolean }> {
  const parsed = parseMesaRoll(input.roll);
  if (!parsed.ok) throw new MesaError(parsed.reason, 400, "invalid_roll");

  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireActiveSession(session);

  // Chave de inimigo só sai da tela do Mestre (mesma trava do espelho de HP).
  const key = sanitizeSourceKey(input.key);
  if (key) requireGM({ session, participant });

  const combat = await getActiveCombat(session.id);
  if (!combat) return { registered: false, debited: false };

  const roll = parsed.roll;
  // O cliente não envia custo numérico confiável. O servidor deriva o custo
  // apenas do contexto semântico validado pelo parser.
  const actionType: CombatActionType | null = roll.type === "skill_check" && roll.skillCheckContext === "action"
    ? "other"
    : MESA_ROLL_ACTION[roll.type];

  const combatants = (await query(
    db().from("mesa_combatants").select("*").eq("combat_id", combat.id),
    "Falha ao consultar os combatentes",
  )) as CombatantRow[];

  // Quem esta rolagem representa: o combatente VINCULADO ao participante ou,
  // quando veio chave, a linha do inimigo vinda do encontro.
  const mine = combatants.find((row) => row.participant_id === participant.id) ?? null;
  const target = key ? await findEnemyForRoll(combat.id, key) : participant.role === "gm" ? null : mine;

  const plan = planRollDebit({
    role: participant.role,
    actionType,
    hasKey: key !== null,
    targetFound: target !== null,
  });

  let debited = false;
  let denial: string | null = plan.denial;

  if (plan.canDebit && target && actionType !== null) {
    const economy = {
      actionsMax: target.actions_max,
      actionsRemaining: target.actions_remaining,
      movementMax: target.movement_max,
      movementRemaining: target.movement_remaining,
    };
    const result = resolveAction({
      combatStatus: combat.status,
      initiativeStarted: combat.initiative_started,
      activeCombatantId: combat.active_combatant_id,
      actorRole: participant.role,
      actorOwnsCombatant: true,
      combatant: { id: target.id, isDead: target.is_dead, ...economy },
      actionType,
      meters: 0,
    });

    if (result.ok) {
      const next = applyAction(economy, actionType, 0);
      await query(
        db().from("mesa_combatants").update({ actions_remaining: next.actionsRemaining }).eq("id", target.id),
        "Falha ao consumir a ação",
      );
      debited = true;
    } else {
      denial = result.reason;
    }
  }

  const actor = target?.name ?? participant.displayName;
  const note = actionType && !debited ? rollDenialNote(denial) : "";
  await appendEvent(
    combat.id,
    { kind: "roll", text: formatRollEvent(actor, roll, note) },
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

  await advanceActiveTurn(session.id, combat);
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
  await appendEvent(combat.id, { kind: "combat_finished", text: "Combate encerrado pelo Mestre" });
  // Fim explícito do Mestre: fecha a partida com o estado final (histórico).
  await completeActiveBattle(session.id);
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
  // Sessão encerrada com luta rolando: a partida também fecha (histórico).
  await completeActiveBattle(session.id);
  await query(
    db().from("mesa_sessions").update({ status: "finished", updated_at: new Date().toISOString() }).eq("id", session.id),
    "Falha ao encerrar a sessão",
  );
}

/**
 * Histórico de partidas da mesa (somente GM).
 *
 * É o que a tela de **⚔️ Encontros** lista como "Histórico de partidas" e com
 * o que ela reconcilia o vínculo local de cada encontro (concluído / em
 * andamento) — inclusive a luta que terminou com a tela fechada.
 *
 * Sem a migração `20260927000001` devolve `503 migration_pending`: o histórico
 * é opcional, mas não dá para fingir que está vazio.
 */
export async function listBattles(input: { sessionId: unknown; token: unknown }): Promise<MesaBattle[]> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireGM({ session, participant });

  if (battleSupport === "no") throw new MesaError(BATTLE_MIGRATION, 503, "migration_pending");
  try {
    const rows = (await query(
      db()
        .from("mesa_battles")
        .select("*")
        .eq("session_id", session.id)
        .order("started_at", { ascending: false })
        .limit(50),
      "Falha ao consultar o histórico de partidas",
    )) as BattleRow[] | null;
    battleSupport = "yes";
    return (rows ?? []).map(toBattle);
  } catch (error) {
    if (missingBattleTable(error)) {
      battleSupport = "no";
      throw new MesaError(BATTLE_MIGRATION, 503, "migration_pending");
    }
    throw error;
  }
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
