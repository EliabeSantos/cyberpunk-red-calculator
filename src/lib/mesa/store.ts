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
import { getCriticalInjuryModifiers } from "@/lib/calculations";
import { ENEMY_DAMAGE_POLICY, isDefeatedBy } from "@/lib/combat/damage";
import { resolveDeathSave } from "@/lib/damage";
import { getSupplyHealAmount, isAmmoRelevantToWeapons, planReload, applyReload } from "@/data/enemySupplies";
import { findSupplyEntry, normalizeSupplyInventory, resolveSupplyItemId, stableItemId } from "@/data/supplyItems";
import { clampHealing } from "@/lib/healing";
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
  TacticalDoor,
  TacticalGeometry,
  TacticalMap,
  TacticalPosition,
  TacticalWall,
  PlayerDamageOutcome,
  PlayerHealingOutcome,
  PlayerDeathSaveOutcome,
  PlayerInitiativeOutcome,
} from "@/lib/mesa/types";
import { TACTICAL_COVER_MATERIALS, TACTICAL_LEGACY_COVER_MATERIALS } from "@/lib/mesa/types";
import { getTacticalCoverProfile, TACTICAL_COVER_THICKNESSES } from "@/lib/mesa/tacticalCoverCatalog";
import { DatabaseQueryError, getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { ACTION_LABELS, DENIAL_MESSAGES } from "@/lib/mesa/messages";
import {
  formatRollEvent,
  formatPlayerRollEvent,
  MESA_ROLL_ACTION,
  parseMesaRoll,
  planRollDebit,
  rollDenialNote,
} from "@/lib/mesa/rollPolicy";
import { rollInitiative } from "@/lib/initiative";
import type { Character } from "@/types/character";
import type { EncounterParticipant } from "@/types/encounter";
import { toCombatParticipant } from "@/lib/combat/adapters";
import { formatMesaAttackEvent } from "@/lib/mesa/attackAudit";
import { applyTacticalCoverDamage, coverHPAfterProfileChange, deriveTacticalCoverProfile, isValidTacticalCoverDV, normalizeTacticalPosition, tacticalDistance, tacticalPositionsOverlap } from "@/lib/mesa/tacticalMap";
import { calculateLineOfSight, calculateTacticalCover } from "@/lib/mesa/tacticalGeometry";
import type { TacticalCoverResult } from "@/lib/mesa/tacticalGeometry";
import { DEFAULT_TACTICAL_OBSTACLE_THICKNESS } from "@/lib/mesa/tacticalGeometry";
export { isValidTacticalCoverDV, normalizeTacticalPosition, tacticalDistance, tacticalPositionsOverlap } from "@/lib/mesa/tacticalMap";

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

async function storedAttackResolution<T = IntegratedAttackResponse>(
  sessionId: string,
  resolutionId: string,
  combatId?: string,
): Promise<AttackResolutionRow<T> | null> {
  let request = db()
    .from("mesa_attack_resolutions")
    .select("combat_id,status,claim_token,result")
    .eq("session_id", sessionId)
    .eq("resolution_id", resolutionId);
  if (combatId) request = request.eq("combat_id", combatId);
  return (await query(
    request.order("created_at", { ascending: false }).limit(1).maybeSingle(),
    "Falha ao consultar a resolução do ataque",
  )) as AttackResolutionRow<T> | null;
}

async function waitForAttackResolution<T = IntegratedAttackResponse>(
  sessionId: string,
  resolutionId: string,
  combatId?: string,
): Promise<T> {
  // Uma requisição concorrente pode encontrar o claim antes do commit. Ela não
  // executa o Engine: aguarda o commit atômico da requisição dona do claim.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const row = await storedAttackResolution<T>(sessionId, resolutionId, combatId);
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
    )) as Array<{ status: "missing" | "processing" | "committed" | "failed"; result: T | null }> | null;
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
  const code = ["action_conflict", "hp_conflict", "death_save_conflict", "resolution_in_progress", "resolution_not_claimed", "resolution_failed"].find((candidate) =>
    error.message.includes(candidate),
  );
  if (!code) return null;
  const status = code === "hp_conflict" || code === "action_conflict" || code === "death_save_conflict" || code === "resolution_in_progress" || code === "resolution_failed" ? 409 : 500;
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

let tacticalPositionSupport: "unknown" | "yes" | "no" = "unknown";

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

function mentionsTacticalPosition(error: unknown): boolean {
  return error instanceof Error && (error.message.includes("position") || error.message.includes("avatar_url"));
}

function withoutTacticalPosition(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => { const copy = { ...row }; delete copy.position; delete copy.avatar_url; return copy; });
}

/** Linhas sem as colunas de migração já sabidas como ausentes. */
function withOptionalColumns(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  let next = rows;
  if (sourceKeySupport === "no") next = withoutSourceKey(next);
  if (suppliesSupport === "no") next = withoutSupplies(next);
  if (tacticalPositionSupport === "no") next = withoutTacticalPosition(next);
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
  const testsTacticalPosition = rows.some((row) => "position" in row || "avatar_url" in row);

  let attempt = rows;
  for (;;) {
    try {
      await query(db().from("mesa_combatants").insert(attempt), context);
      if (testsSourceKey && "source_key" in attempt[0]) sourceKeySupport = "yes";
      if (testsSupplies && "supplies" in attempt[0]) suppliesSupport = "yes";
      if (testsTacticalPosition && "position" in attempt[0]) tacticalPositionSupport = "yes";
      return;
    } catch (error) {
      const pending =
        sourceKeySupport !== "no" && mentionsSourceKey(error)
          ? "source_key"
          : suppliesSupport !== "no" && mentionsSupplies(error)
            ? "supplies"
            : tacticalPositionSupport !== "no" && mentionsTacticalPosition(error)
              ? "tactical_position"
            : null;
      if (!pending) throw error;
       if (pending === "source_key") sourceKeySupport = "no";
       else if (pending === "supplies") suppliesSupport = "no";
       else tacticalPositionSupport = "no";
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
  updated_at?: string;
  tactical_map?: TacticalMap | null;
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
  updated_at?: string;
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
  death_save_dc?: number;
  death_save_failures?: number;
  conditions: string[] | null;
  sort_order: number;
  position?: TacticalPosition | null;
  avatar_url?: string | null;
}

type IntegratedAttackResponse = {
  attackResult: NonNullable<ReturnType<typeof execute>["attackResult"]>;
  /** Geometria server-side usada nesta resolução; não é um modificador. */
  tacticalCover?: TacticalCoverResult;
  coverDamage?: { obstacleId: string; hpBefore: number; hpAfter: number; damage: number; destroyed: boolean };
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

/**
 * Linha da resolução durável (`mesa_attack_resolutions`).
 *
 * O payload é genérico de propósito: a MESMA infraestrutura claim/commit/
 * release serve ao ataque (F1.7.16) e ao Player Damage Gateway (F1.12.1) — o
 * que muda é o formato do `result`, nunca a máquina de estados.
 */
interface AttackResolutionRow<T> {
  combat_id: string;
  status: "processing" | "committed" | "failed";
  claim_token: string;
  result: T | null;
}

interface AttackResolutionClaim<T> {
  claimed: boolean;
  status: "processing" | "committed" | "failed";
  claim_token: string;
  result: T | null;
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
    tacticalMap: sanitizeTacticalMap(row.tactical_map),
  };
}

const DEFAULT_TACTICAL_GEOMETRY: TacticalGeometry = { walls: [], doors: [] };
const DEFAULT_TACTICAL_MAP: TacticalMap = { imageUrl: "", enabled: false, width: 1000, height: 600, pixelsPerMeter: 50, grid: { enabled: false, size: 1, snap: false }, geometry: DEFAULT_TACTICAL_GEOMETRY };

function sanitizeGeometryPoint(raw: unknown): TacticalPosition | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const x = Number(value.x);
  const y = Number(value.y);
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

function sanitizeGeometry(raw: unknown): TacticalGeometry {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return DEFAULT_TACTICAL_GEOMETRY;
  const value = raw as Record<string, unknown>;
  const usedIds = new Set<string>();
  const sanitizeId = (id: unknown) => typeof id === "string" && id.trim().length > 0 && id.trim().length <= 120 ? id.trim() : null;
  const readSegment = (entry: unknown, type: "wall" | "door"): TacticalWall | TacticalDoor | null => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    const id = sanitizeId(item.id);
    const start = sanitizeGeometryPoint(item.start);
    const end = sanitizeGeometryPoint(item.end);
    if (!id || usedIds.has(id) || !start || !end) return null;
    usedIds.add(id);
    const thickness = Number(item.thickness);
    const safeThickness = Number.isFinite(thickness) && thickness > 0 && thickness <= 1 ? thickness : DEFAULT_TACTICAL_OBSTACLE_THICKNESS;
    const acceptedMaterials = [...TACTICAL_COVER_MATERIALS, ...TACTICAL_LEGACY_COVER_MATERIALS] as readonly string[];
    const coverMaterial = acceptedMaterials.includes(item.coverMaterial as string)
      ? item.coverMaterial as TacticalWall["coverMaterial"]
      : undefined;
    const coverThickness = TACTICAL_COVER_THICKNESSES.includes(item.coverThickness as (typeof TACTICAL_COVER_THICKNESSES)[number])
      ? item.coverThickness as (typeof TACTICAL_COVER_THICKNESSES)[number]
      : null;
    const profile = getTacticalCoverProfile(coverMaterial, coverThickness);
    const rawCoverHP = item.coverHP === null || item.coverHP === undefined ? null : Number(item.coverHP);
    const safeLegacyHP = rawCoverHP !== null && Number.isFinite(rawCoverHP) && rawCoverHP >= 0 ? rawCoverHP : null;
    const safeCoverHP = profile ? Math.min(safeLegacyHP ?? profile.hp, profile.hp) : safeLegacyHP;
    const safeLegacyDV = item.coverDV === null || item.coverDV === undefined ? null : item.coverDV;
    const safeCoverDV = profile ? profile.dv : safeLegacyDV !== null && isValidTacticalCoverDV(safeLegacyDV) ? safeLegacyDV : null;
    const destroyed = item.destroyed === true || safeCoverHP === 0;
    const normalizedCoverHP = destroyed && safeCoverHP !== null ? 0 : safeCoverHP;
    const coverFields = coverMaterial !== undefined || coverThickness !== null || safeCoverHP !== null || safeCoverDV !== null || destroyed
      ? { ...(coverMaterial !== undefined ? { coverMaterial } : {}), ...(coverThickness !== null || coverMaterial !== undefined ? { coverThickness } : {}), ...(normalizedCoverHP !== null ? { coverHP: normalizedCoverHP } : {}), ...(safeCoverDV !== null ? { coverDV: safeCoverDV } : {}), ...(destroyed ? { destroyed: true } : {}) }
      : {};
    if (type === "wall") return { id, type, start, end, thickness: safeThickness, ...coverFields };
    const state = item.state === "open" || item.state === "closed" ? item.state : null;
    return state ? { id, type, start, end, thickness: safeThickness, state, ...coverFields } : null;
  };
  const walls = Array.isArray(value.walls) ? value.walls.slice(0, 500).map((entry) => readSegment(entry, "wall")).filter((entry): entry is TacticalWall => entry?.type === "wall") : [];
  const doors = Array.isArray(value.doors) ? value.doors.slice(0, 500).map((entry) => readSegment(entry, "door")).filter((entry): entry is TacticalDoor => entry?.type === "door") : [];
  return { walls, doors };
}

/** Valida metadados enviados por uma mutação GM sem quebrar mapas legados na leitura. */
function validateTacticalCoverMetadata(raw: unknown): void {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
  const geometry = (raw as Record<string, unknown>).geometry;
  if (typeof geometry !== "object" || geometry === null || Array.isArray(geometry)) return;
  const value = geometry as Record<string, unknown>;
  const entries = [
    ...(Array.isArray(value.walls) ? value.walls : []),
    ...(Array.isArray(value.doors) ? value.doors : []),
  ];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const item = entry as Record<string, unknown>;
    const material = item.coverMaterial;
    const hasMaterial = material !== undefined && material !== null && material !== "";
    const isOfficialMaterial = TACTICAL_COVER_MATERIALS.includes(material as (typeof TACTICAL_COVER_MATERIALS)[number]);
    const isLegacyMaterial = TACTICAL_LEGACY_COVER_MATERIALS.includes(material as (typeof TACTICAL_LEGACY_COVER_MATERIALS)[number]);
    if (hasMaterial && !isOfficialMaterial && !isLegacyMaterial) {
      throw new MesaError("Material de Cover inválido.", 400, "invalid_cover_material");
    }
    const thickness = item.coverThickness;
    const hasThickness = thickness !== undefined && thickness !== null && thickness !== "";
    if (hasThickness && !TACTICAL_COVER_THICKNESSES.includes(thickness as (typeof TACTICAL_COVER_THICKNESSES)[number])) {
      throw new MesaError("Espessura de Cover inválida.", 400, "invalid_cover_thickness");
    }
    if (hasThickness && (!isOfficialMaterial || !hasMaterial)) {
      throw new MesaError("Espessura exige um material oficial do catálogo.", 400, "invalid_cover_profile");
    }
    if (isOfficialMaterial && hasThickness) {
      const profile = getTacticalCoverProfile(material, thickness);
      if (!profile) throw new MesaError("Combinação de material e espessura inválida.", 400, "invalid_cover_profile");
      // HP/DV são derivados e não podem ser enviados como autoridade pelo cliente.
      if (item.coverHP !== undefined || item.coverDV !== undefined) {
        throw new MesaError("HP e DV de Cover são derivados do catálogo.", 400, "derived_cover_values_forbidden");
      }
    }
  }
}

function sanitizeTacticalMap(raw: unknown): TacticalMap {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ...DEFAULT_TACTICAL_MAP };
  const value = raw as Record<string, unknown>;
  const positive = (input: unknown, fallback: number, max: number) => {
    const number = Number(input);
    return Number.isFinite(number) && number > 0 ? Math.min(max, number) : fallback;
  };
  return {
    imageUrl: typeof value.imageUrl === "string" ? value.imageUrl.trim().slice(0, 2_000_000) : "",
    enabled: value.enabled === true,
    width: positive(value.width, 1000, 100_000),
    height: positive(value.height, 600, 100_000),
    pixelsPerMeter: positive(value.pixelsPerMeter, 50, 10_000),
    grid: {
      enabled: typeof value.grid === "object" && value.grid !== null && (value.grid as Record<string, unknown>).enabled === true,
      size: positive(typeof value.grid === "object" && value.grid !== null ? (value.grid as Record<string, unknown>).size : undefined, 1, 100),
      snap: typeof value.grid === "object" && value.grid !== null && (value.grid as Record<string, unknown>).snap === true,
    },
    geometry: sanitizeGeometry(value.geometry),
  };
}

async function ensurePositionAvailable(
  sessionId: string,
  combatId: string,
  combatantId: string,
  target: TacticalPosition,
  map: TacticalMap,
): Promise<void> {
  const rows = (await query(
    db().from("mesa_combatants").select("id,position").eq("session_id", sessionId).eq("combat_id", combatId),
    "Falha ao verificar espaço no mapa",
  )) as Array<{ id: string; position?: TacticalPosition | null }> | null;
  const occupied = (rows ?? []).some((row) => row.id !== combatantId && tacticalPositionsOverlap(
    normalizeTacticalPosition(row.position), target, map,
  ));
  if (occupied) throw new MesaError("Esse espaço já está ocupado.", 409, "position_occupied");
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

function effectiveMovementForRow(row: CombatantRow): { max: number; remaining: number } {
  const injuryState = row.combat_snapshot?.combat
    ? getCriticalInjuryModifiers({
        combat: {
          ...row.combat_snapshot.combat,
          criticalInjuries: row.critical_injuries ?? row.combat_snapshot.combat.criticalInjuries,
        } as unknown as Character["combat"],
      })
    : null;
  const max = injuryState?.moveZero
    ? 0
    : Math.max(0, row.movement_max + (injuryState?.moveModifier ?? 0) * 2);
  return { max, remaining: Math.min(row.movement_remaining, max) };
}

function unconsciousUntilRoundForRow(row: CombatantRow): number | undefined {
  const rounds = (row.critical_injuries ?? [])
    .map((injury) => injury.unconsciousUntilRound ?? 0)
    .filter((round) => round > 0);
  return rounds.length > 0 ? Math.max(...rounds) : undefined;
}

function toCombatant(row: CombatantRow): MesaCombatant {
  const movement = effectiveMovementForRow(row);
  const unconsciousUntilRound = unconsciousUntilRoundForRow(row);
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
    movementMax: movement.max,
    movementRemaining: movement.remaining,
    unconsciousUntilRound,
    hpCurrent: row.hp_current,
    hpMax: row.hp_max,
    isDead: row.is_dead,
    deathSaveDC: row.death_save_dc ?? 0,
    deathSaveFailures: row.death_save_failures ?? 0,
    conditions: Array.isArray(row.conditions) ? row.conditions : [],
    sortOrder: row.sort_order,
    position: normalizeTacticalPosition(row.position, { x: row.kind === "enemy" ? 0.78 : 0.22, y: 0.2 + (row.sort_order % 5) * 0.15 }),
    ...(typeof row.avatar_url === "string" && row.avatar_url.length > 0
      ? { avatarUrl: row.avatar_url }
      : {}),
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
      deathSave: row.kind === "character"
        ? { dc: row.death_save_dc ?? 0, failures: row.death_save_failures ?? 0 }
        : undefined,
    },
    economy: {
      actionsMax: row.actions_max,
      actionsRemaining: row.actions_remaining,
      movementMax: effectiveMovementForRow(row).max,
      movementRemaining: effectiveMovementForRow(row).remaining,
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

/** Materializa munição relevante E itens de cura: os dois são mochila da Mesa. */
function suppliesForCharacter(
  sheet: Character,
  snapshot: CombatState["participants"][number] | null,
): MesaSupplies {
  const weapons = snapshot?.weapons ?? [];
  // Munição entra pelo critério já existente (alimenta uma arma do snapshot);
  // cura entra pela MESMA regra que o botão [Usar] vai usar no servidor
  // (`getSupplyHealAmount`) — inclusão e uso nunca podem discordar.
  const inventory = (sheet.inventory ?? [])
    .filter(
      (item) =>
        isAmmoRelevantToWeapons(item.name, weapons) || getSupplyHealAmount(item.name) !== null,
    )
    .map((item) => ({
      itemId: stableItemId(item.name),
      item: item.name,
      quantity: Math.max(0, Math.floor(item.quantity)),
    }))
    .filter((item) => item.quantity > 0 && item.itemId.length > 0);
  return { inventory: normalizeSupplyInventory(inventory) };
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
 * Exige papel de Jogador (F1.14.2) — o Player Initiative Gateway registra a
 * iniciativa do PRÓPRIO combatente; o Mestre continua com a rolagem coletiva
 * (`rollInitiativeForAll`) e não entra por este caminho.
 */
export function requirePlayer(actor: Actor): void {
  if (actor.participant.role !== "player") {
    throw new MesaError(
      "Este registro é dos Jogadores: o Mestre usa a rolagem de iniciativa da Mesa.",
      403,
      "player_only",
    );
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

/** Decide quais participantes viram combatants sem criar um "GM fake". */
export function shouldMaterializeParticipantInCombat(
  role: MesaParticipant["role"],
  characterId: string | null,
  gmParticipation: "character" | "gm_only" = "character",
): boolean {
  if (!characterId) return false;
  return !(role === "gm" && gmParticipation === "gm_only");
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
  const stateVersion = [
    (sessionRow as SessionRow).updated_at,
    combatRow ? (combatRow as CombatRow).updated_at : null,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort()
    .at(-1);

  return {
    ...(stateVersion ? { stateVersion } : {}),
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

/**
 * Metadados de controle que não devem entrar no snapshot compartilhado.
 * O GM recebe somente as armas materializadas no combat snapshot; Players
 * continuam vendo apenas a projeção pública de `MesaCombatant`.
 */
export async function getMesaControlMetadata(sessionId: string, participantId: string): Promise<{
  combatantId: string;
  weapons: NonNullable<CombatParticipant["weapons"]>;
}[]> {
  const participant = (await query(
    db().from("mesa_participants").select("role").eq("id", participantId).eq("session_id", sessionId).maybeSingle(),
    "Falha ao consultar o controlador",
  )) as { role: MesaParticipant["role"] } | null;
  if (!participant || participant.role !== "gm") throw new MesaError("Apenas o Mestre pode consultar o controle do combate.", 403, "gm_only");

  const rows = (await query(
    db().from("mesa_combatants").select("id,kind,combat_snapshot").eq("session_id", sessionId).eq("kind", "enemy"),
    "Falha ao consultar metadados de controle",
  )) as Array<{ id: string; kind: "enemy"; combat_snapshot: CombatParticipant | null }> | null;

  return (rows ?? []).map((row) => ({ combatantId: row.id, weapons: row.combat_snapshot?.weapons ?? [] }));
}

export async function updateTacticalMap(input: { sessionId: unknown; token: unknown; map: unknown }): Promise<void> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireGM({ session, participant });
  validateTacticalCoverMetadata(input.map);
  const requestedMap = sanitizeTacticalMap(input.map);
  const currentRow = (await query(
    db().from("mesa_sessions").select("tactical_map").eq("id", session.id).maybeSingle(),
    "Falha ao consultar o mapa tático atual",
  )) as { tactical_map?: unknown } | null;
  const currentMap = sanitizeTacticalMap(currentRow?.tactical_map);
  const currentGeometry = currentMap.geometry ?? { walls: [], doors: [] };
  const requestedGeometry = requestedMap.geometry ?? { walls: [], doors: [] };
  const currentById = new Map([...currentGeometry.walls, ...currentGeometry.doors].map((entry) => [entry.id, entry]));
  const preserveCoverState = <T extends TacticalWall | TacticalDoor>(entry: T): T => {
    const previous = currentById.get(entry.id);
    const { destroyed: _requestedDestroyed, ...entryWithoutDestroyed } = entry;
    const profile = deriveTacticalCoverProfile(entry.coverMaterial, entry.coverThickness);
    if (!profile) return previous && entry.coverMaterial === previous.coverMaterial ? { ...entryWithoutDestroyed, coverHP: previous.coverHP, coverDV: previous.coverDV, ...(previous.destroyed === true ? { destroyed: true } : {}) } as T : entryWithoutDestroyed as T;
    const oldProfile = previous ? deriveTacticalCoverProfile(previous.coverMaterial, previous.coverThickness) : null;
    const destroyed = previous?.destroyed === true;
    const coverHP = coverHPAfterProfileChange(previous?.coverHP, destroyed, oldProfile?.hp ?? null, profile.hp);
    return { ...entryWithoutDestroyed, coverHP, coverDV: profile.dv, ...(destroyed || coverHP === 0 ? { destroyed: true } : {}) } as T;
  };
  const map: TacticalMap = {
    ...requestedMap,
    geometry: {
      walls: requestedGeometry.walls.map(preserveCoverState),
      doors: requestedGeometry.doors.map(preserveCoverState),
    },
  };
  await query(
    db().from("mesa_sessions").update({ tactical_map: map, updated_at: new Date().toISOString() }).eq("id", session.id),
    "Falha ao salvar o mapa tático",
  );
}

/** Posicionamento de preparação: só o GM, sem economia/turno. */
export async function positionCombatantPreparation(input: { sessionId: unknown; token: unknown; combatantId: unknown; position: unknown }): Promise<void> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireGM({ session, participant });
  const id = typeof input.combatantId === "string" ? input.combatantId.trim() : "";
  const position = normalizeTacticalPosition(input.position, { x: 0.5, y: 0.5 });
  const combat = (await query(db().from("mesa_combats").select("id,status,initiative_started").eq("session_id", session.id).maybeSingle(), "Falha ao consultar o combate")) as Pick<CombatRow, "id" | "status" | "initiative_started"> | null;
  if (!combat || (combat.status === "active" && combat.initiative_started)) {
    throw new MesaError("O posicionamento livre só existe antes da iniciativa.", 409, "combat_active");
  }
  let map = DEFAULT_TACTICAL_MAP;
  try {
    const sessionMap = (await query(db().from("mesa_sessions").select("tactical_map").eq("id", session.id).maybeSingle(), "Falha ao consultar mapa")) as { tactical_map?: TacticalMap | null } | null;
    map = sanitizeTacticalMap(sessionMap?.tactical_map);
  } catch { /* migration ainda não aplicada: usa escala padrão */ }
  await ensurePositionAvailable(session.id, combat.id, id, position, map);
  const written = await query(db().from("mesa_combatants").update({ position }).eq("id", id).eq("session_id", session.id).select("id"), "Falha ao salvar a posição");
  if (!written || written.length !== 1) throw new MesaError("Combatente não encontrado.", 404, "combatant_not_found");
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

  // F1.14.6 — durante `mesa-combat`, a ficha enviada pelo navegador não pode
  // virar um bypass para estado mecânico. Embora esta rota grave
  // `mesa_characters.sheet` (e não diretamente `mesa_combatants`), o snapshot
  // server-side da ficha é a fonte de cálculos para resoluções futuras. Player
  // não pode reenviar HP, armor, CI, Death Save, ammo, atributos ou qualquer
  // outro estado de combate enquanto a Mesa estiver resolvendo o combate.
  // Fora de combate, o fluxo de vinculação/salvamento permanece inalterado;
  // GM também preserva o comportamento existente.
  if (participant.role === "player" && (await getActiveCombat(session.id))) {
    throw new MesaError(
      "A ficha está bloqueada durante o combate da Mesa; o estado de combate é atualizado pelos gateways.",
      409,
      "mesa_authoritative",
    );
  }

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
  if (event.resolutionId && currentLog.some((entry) => entry.resolutionId === event.resolutionId)) return;
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
  const injuries = getCriticalInjuryModifiers({ combat: sheet.combat });
  if (injuries.moveZero) return 0;
  return movementMetersPerTurn(move + getCyberwareMoveModifier({ cyberware }) + injuries.moveModifier);
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
  gmParticipation?: unknown;
}): Promise<void> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireGM({ session, participant });
  requireActiveSession(session);

  const encounter = sanitizeEncounterRef(input.encounter);
  const restart = input.restart === true;
  const gmOnly = input.gmParticipation === "gm_only";

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
    const priorPositions = existingCombat
      ? ((await query(db().from("mesa_combatants").select("participant_id,source_key,kind,position").eq("combat_id", existingCombat.id), "Falha ao consultar posições anteriores")) as Array<Pick<CombatantRow, "participant_id" | "source_key" | "kind" | "position">> | null) ?? []
      : [];
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
      if (!shouldMaterializeParticipantInCombat(row.role, row.character_id, gmOnly ? "gm_only" : "character")) continue;
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
         death_save_dc: Math.max(0, Math.floor(sheet.combat.deathSaveDC)),
         death_save_failures: Math.max(0, Math.floor(sheet.combat.deathSaveFailures)),
        combat_snapshot: snapshot,
        combat_ammo: ammoStateForParticipant(snapshot),
        supplies: suppliesForCharacter(sheet, snapshot),
        combat_armor: { ...snapshot.combat.armor },
        critical_injuries: [...snapshot.combat.criticalInjuries],
        sort_order: sortOrder++,
        position: priorPositions.find((old) => old.participant_id === row.id)?.position ?? { x: 0.22, y: 0.2 + (sortOrder % 5) * 0.14 },
        avatar_url: typeof sheet.identity?.photoUrl === "string" ? sheet.identity.photoUrl.slice(0, 2_000_000) : null,
      });
    }

  for (const enemy of enemies) {
      const movement = enemyMovementBudget(enemy.move, enemy.snapshot);
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
         death_save_dc: 0,
         death_save_failures: 0,
        sort_order: sortOrder++,
        position: priorPositions.find((old) => old.kind === "enemy" && old.source_key === enemy.key)?.position ?? { x: 0.78, y: 0.2 + (sortOrder % 5) * 0.14 },
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
function enemyMovementBudget(move: number | null, snapshot?: CombatState["participants"][number] | null): number {
  if (snapshot) {
    const injuries = getCriticalInjuryModifiers({ combat: snapshot.combat as unknown as Character["combat"] });
    if (injuries.moveZero) return 0;
    if (move !== null) return movementMetersPerTurn(move + injuries.moveModifier);
  }
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

  const entries: Array<{ item: string; quantity: number }> = [];
  if (Array.isArray(input.inventory)) {
    for (const entry of input.inventory) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
      const item = (entry as Record<string, unknown>).item;
      const quantity = Number((entry as Record<string, unknown>).quantity);
      if (typeof item !== "string") continue;
      const name = item.trim().slice(0, 60);
      const qty = Number.isFinite(quantity) ? Math.max(0, Math.min(999, Math.floor(quantity))) : 0;
      if (name.length === 0 || qty === 0) continue;
      // Duplicidade decidida pela IDENTIDADE (id estável), não pelo texto —
      // e a primeira ocorrência vence: o cliente não amplia estoque repetindo
      // a linha com outro caixa ou outro rótulo.
      const itemId = stableItemId(name);
      if (itemId.length === 0) continue;
      if (entries.some((existing) => stableItemId(existing.item) === itemId)) continue;
      entries.push({ item: name, quantity: qty });
    }
  }
  // F1.13.2 — o `itemId` é SEMPRE derivado no servidor (nunca aceito do
  // cliente): identidade é função do rótulo + catálogo, não do navegador.
  const inventory = normalizeSupplyInventory(entries);

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
    const movement = enemyMovementBudget(enemy.move, enemy.snapshot);
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
       death_save_dc: 0,
       death_save_failures: 0,
      sort_order: sortOrder++,
      position: { x: 0.78, y: 0.2 + (sortOrder % 5) * 0.14 },
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

/**
 * GM ajusta condições, morte ou iniciativa de um combatente — e HP de INIMIGO.
 *
 * F1.12.1: durante combate ativo, `hpCurrent`/`isDead` de `kind = "character"`
 * são RECUSADOS (409 `mesa_authoritative`). Este era o único caminho
 * client-authoritative que alterava HP de Player na Mesa; o caminho agora é o
 * Player Damage Gateway (`applyPlayerDamage`, `POST /combat/player-damage`).
 */
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

  if (patch.position !== undefined) {
    const activeCombat = await getActiveCombat(session.id);
    if (activeCombat?.initiative_started) throw new MesaError("Durante o combate, arraste pelo Movement Gateway.", 409, "combat_active");
    update.position = normalizeTacticalPosition(patch.position);
    const combat = (await query(db().from("mesa_combats").select("id,status").eq("session_id", session.id).maybeSingle(), "Falha ao consultar o combate")) as Pick<CombatRow, "id" | "status"> | null;
    if (combat) {
      let map = DEFAULT_TACTICAL_MAP;
      try {
        const sessionMap = (await query(db().from("mesa_sessions").select("tactical_map").eq("id", session.id).maybeSingle(), "Falha ao consultar mapa")) as { tactical_map?: TacticalMap | null } | null;
        map = sanitizeTacticalMap(sessionMap?.tactical_map);
      } catch { /* usa escala padrão durante rollout */ }
      await ensurePositionAvailable(session.id, combat.id, row.id, update.position as TacticalPosition, map);
    }
  }

  // F1.12.1 (Fase 9) — durante combate ativo, HP/morte de PERSONAGEM é
  // autoridade da Mesa: nenhum cliente define o valor final. O caminho é o
  // Player Damage Gateway (`applyPlayerDamage` → Damage Engine → commit).
  // Inimigos mantêm o ajuste manual do Mestre: a autoridade de HP de inimigo
  // é o encontro/espelho (`syncCombatHp`), que já é server-side e fora do
  // escopo desta etapa.
  const touchesVitalState = "hpCurrent" in patch || "isDead" in patch;
  if (touchesVitalState && row.kind === "character" && (await getActiveCombat(session.id))) {
    throw new MesaError(
      "Durante o combate, o HP de um Personagem é autoritativo na Mesa: aplique dano pelo gateway de dano externo.",
      409,
      "mesa_authoritative",
    );
  }

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
 * Fora de combate, a ficha do jogador e o encontro do Mestre podem espelhar a
 * origem — não há escrita de volta na ficha (evita loop). Durante combate
 * ativo, porém, a Mesa é autoritativa para personagens: o espelho do Player é
 * recusado e HP/morte só entram por resolução/gateway server-side.
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
 *   • **sem `key`** → o combatente ligado a ESTE participante fora de combate;
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
          criticalInjuries: row.critical_injuries ?? [],
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

// ---------------------------------------------------------------------------
// F1.12.1 — PLAYER DAMAGE GATEWAY (dano externo autoritativo de Player)
// ---------------------------------------------------------------------------

/**
 * Prefixo do `resolution_id` gravado em `mesa_attack_resolutions`.
 *
 * A infraestrutura de resolução durável (claim/commit/release, F1.7.16) é a
 * MESMA do ataque; o prefixo é o que impede um `resolutionId` de dano externo
 * colidir com o de um ataque ou de um reload na mesma mesa/combate.
 */
const PLAYER_DAMAGE_RESOLUTION_PREFIX = "player-damage:";

/**
 * Campos de RESULTADO que um cliente NUNCA pode entregar como autoridade
 * (F1.12.1, Fase 9). Se algum aparecer no corpo, a intenção é recusada antes
 * de qualquer leitura: o servidor calcula HP/Armor/CI/morte, o cliente só
 * descreve o dano que quer resolver.
 *
 * `hpBefore` NÃO está na lista: é PRÉ-CONDIÇÃO (CAS verificado contra a linha
 * do banco), não autoridade — um valor errado recusa a escrita, nunca a impõe.
 */
const CLIENT_RESULT_FIELDS = [
  "finalHp",
  "finalHP",
  "hp",
  "hpCurrent",
  "hp_current",
  "hpAfter",
  "hpMax",
  "hp_max",
  "armor",
  "finalArmor",
  "combat_armor",
  "finalCriticalInjury",
  "finalCriticalInjuries",
  "criticalInjuries",
  "critical_injuries",
  "isDead",
  "is_dead",
  "deathSave",
  "deathSaveDC",
  "deathSaveFailures",
];

const NO_PLAYER_DAMAGE: PlayerDamageOutcome = {
  updated: false,
  hp: null,
  isDead: null,
  armor: null,
  criticalInjuries: null,
  damageResult: null,
};

/**
 * Recusa o corpo que tenta entregar um RESULTADO pronto (F1.12.1, Fase 9).
 * Chamado ANTES de autenticar qualquer campo: autoridade vinda do cliente nem
 * chega perto da resolução. `kind` só muda o texto — a LISTA é a mesma do
 * dano (F1.12.2): `hpAfter`/`finalHp` são recusados na cura também.
 */
function assertIntentOnly(body: unknown, kind: "damage" | "healing" | "initiative" = "damage"): void {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return;
  const record = body as Record<string, unknown>;
  const forbidden = CLIENT_RESULT_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(record, field));
  if (forbidden.length === 0) return;
  const rule =
    kind === "healing"
      ? "Envie apenas a intenção de cura: o HP é calculado aqui."
      : kind === "initiative"
        ? "Envie apenas a intenção de rolagem: a iniciativa é gravada aqui."
        : "Envie apenas a intenção de dano: o HP/Armor/lesão é calculado aqui.";
  throw new MesaError(
    `O servidor não aceita autoridade de resultado do cliente (${forbidden.join(", ")}). ${rule}`,
    400,
    "client_authority_forbidden",
  );
}

/** Texto curto de origem (rótulo do tipo/contexto do dano); ausente → null. */
function sanitizeSourceText(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/\s+/g, " ");
  return value.length > 0 ? value.slice(0, max) : null;
}

/**
 * Dados individuais da rolagem de dano — ENTRADA da regra de Critical Injury
 * (2+ seis), nunca um resultado final. Inválido → recusa; não se inventa dado.
 */
function sanitizeDamageRolls(raw: unknown): number[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) {
    throw new MesaError("Dados de dano inválidos.", 400, "invalid_damage_rolls");
  }
  return raw.map((value) => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10) {
      throw new MesaError("Dados de dano inválidos.", 400, "invalid_damage_rolls");
    }
    return value;
  });
}

/**
 * F1.12.1 — **Player Damage Gateway**: ponto ÚNICO server-side de dano externo
 * (ambiental, de cena, de GM, qualquer fonte) aplicado a um PERSONAGEM durante
 * uma Mesa com combate ativo.
 *
 *     intenção (cliente)
 *       → validação de autoridade + autorização
 *       → claim da resolução (idempotência durável)
 *       → linha da Mesa (hp/armor/lesão/morte LIDOS AQUI)
 *       → engine.execute(state, DamageAction, serverRandom)   ← Damage Engine existente
 *       → engineDamagePatch (VERBATIM de `changes`)
 *       → commit_mesa_attack_resolution (transação: patch + evento + status)
 *       → publishMesaState → Realtime → characterSync → ficha
 *
 * ## O que o gateway NÃO faz (F1.12.1, Fases 3 e 4)
 *
 * Não existe Armor, ablação, Critical Injury, +5, Mortal Wound ou Hit Location
 * próprios: tudo continua dentro de `execute`/`applyDamage`, a MESMA fonte que
 * o ataque integrado usa. `PLAYER_DAMAGE_POLICY` sai do motor pelo TIPO do
 * alvo (`type === "character"`), então HP pode ficar ≤ 0 sem que a morte mude —
 * Death Save continua intocado, fora deste escopo.
 *
 * F1.14.5: esta é também a autoridade de Critical Injury do personagem Player.
 * A lesão é produzida pelo mesmo `execute` que resolve o dano (2+ seis e as
 * demais regras já existentes, inclusive tabela por localização), entra no
 * mesmo `targetPatch` transacional e chega ao Player por `critical_injuries`.
 * Não existe POST de Critical Injury escolhida pelo cliente.
 *
 * ## Autoridade (Fase 9)
 *
 * O cliente envia intenção: `targetCombatantId`, `amount`, `hpBefore`
 * (pré-condição), `hitLocation?`, `damageRolls?`, `ignoreArmor?`,
 * `sourceType?`, `sourceContext?`. `finalHp`/`finalArmor`/`criticalInjuries`/
 * `isDead` são RECUSADOS em 400 (`assertIntentOnly`) — nem são lidos.
 *
 * ## Quem pode chamar
 *
 * Somente o Mestre (`requireGM`): a fonte externa é decidida pela cena. Dano
 * de Player contra Player continua no caminho já aprovado
 * (`attackIntegrated`, `POST /combat/attack`).
 *
 * ## Concorrência (Fase 6) e idempotência (Fase 7)
 *
 * Concorrência: o MESMO mecanismo do ataque — claim com `claim_token` +
 * escrita condicional `WHERE hp_current = hp_before AND is_dead = dead_before`
 * dentro de `commit_mesa_attack_resolution`. Quem perde recebe 409
 * `hp_conflict`; nunca existe escrita silenciosa por cima.
 *
 * Idempotência: DURÁVEL, reutilizando `mesa_attack_resolutions` — mesmo
 * `resolutionId` devolve o resultado já gravado sem aplicar dano de novo.
 * O prefixo `player-damage:` mantém o namespace separado do ataque/reload.
 *
 * ## Limitação conhecida (Fase 6)
 *
 * A RPC de commit também CASa a economia da "linha de ator". Dano externo não
 * tem ator: passamos o PRÓPRIO ALVO com a economia inalterada (nenhuma Action
 * ou munição é consumida). Se o alvo executar uma ação exatamente nessa
 * janela, o commit pode devolver 409 `action_conflict` — falha conservadora,
 * sem efeito parcial, resolvida por novo `resolutionId`.
 */
export async function applyPlayerDamage(input: {
  sessionId: unknown;
  token: unknown;
  /** Corpo cru da intenção: só campos de intenção são lidos; os de resultado recusam. */
  body: unknown;
}): Promise<PlayerDamageOutcome> {
  assertIntentOnly(input.body);
  const body: Record<string, unknown> =
    typeof input.body === "object" && input.body !== null && !Array.isArray(input.body)
      ? (input.body as Record<string, unknown>)
      : {};

  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireGM({ session, participant });
  if (session.status === "finished") return { ...NO_PLAYER_DAMAGE };

  const resolutionId = `${PLAYER_DAMAGE_RESOLUTION_PREFIX}${requireResolutionId(body.resolutionId)}`;

  const combat = await getActiveCombat(session.id);
  if (!combat) return { ...NO_PLAYER_DAMAGE };

  /* ------------------------- idempotência durável ------------------------ */

  const previous = await storedAttackResolution<PlayerDamageOutcome>(session.id, resolutionId, combat.id);
  if (previous?.status === "committed" && previous.result) return previous.result;
  if (previous?.status === "failed") {
    throw new MesaError("A resolução deste dano falhou antes do commit; não será reexecutada.", 409, "resolution_failed");
  }
  if (previous?.status === "processing") {
    return waitForAttackResolution<PlayerDamageOutcome>(session.id, resolutionId, combat.id);
  }

  const claimRows = (await query(
    db().rpc("claim_mesa_attack_resolution", {
      p_session_id: session.id,
      p_combat_id: combat.id,
      p_resolution_id: resolutionId,
    }),
    "Falha ao reservar a resolução do dano",
  )) as AttackResolutionClaim<PlayerDamageOutcome>[] | null;
  const claim = claimRows?.[0];
  if (!claim) throw new MesaError("Não foi possível reservar a resolução do dano.", 500, "transaction_failed");
  if (!claim.claimed) {
    if (claim.status === "committed" && claim.result) return claim.result;
    if (claim.status === "failed") {
      throw new MesaError("A resolução deste dano falhou antes do commit; não será reexecutada.", 409, "resolution_failed");
    }
    return waitForAttackResolution<PlayerDamageOutcome>(session.id, resolutionId, combat.id);
  }
  const claimToken = claim.claim_token;
  let committed = false;

  try {
    /* ---------------------------- intenção ------------------------------ */

    const targetRowId = typeof body.targetCombatantId === "string" ? body.targetCombatantId.trim() : "";
    if (!targetRowId) throw new MesaError("Alvo do dano ausente (targetCombatantId).", 400, "target_not_found");

    const rows = (await query(
      db().from("mesa_combatants").select("*").eq("combat_id", combat.id),
      "Falha ao consultar os combatentes",
    )) as CombatantRow[] | null;
    const targetRow = rows?.find((row) => row.id === targetRowId);
    if (!targetRow || targetRow.session_id !== session.id) {
      throw new MesaError("Alvo não encontrado.", 404, "target_not_found");
    }
    // Este gateway é de PLAYER: inimigo já tem caminho server-side dedicado
    // (`POST /combat/damage`, `resolveEnemyDamage`) — não se abre um segundo.
    if (targetRow.kind !== "character") {
      throw new MesaError(
        "Este gateway é para personagens; dano de inimigo passa por /api/mesa/[id]/combat/damage.",
        400,
        "not_a_player",
      );
    }

    // Pré-condição (CAS de leitura): o cliente declara o HP que VIU. Se a linha
    // já andou, o dano não é aplicado — protege contra retry e contra estado
    // defasado do navegador. O commit repete a mesma comparação no WHERE.
    if (typeof body.hpBefore !== "number" || !Number.isFinite(body.hpBefore)) {
      throw new MesaError("Dano sem hpBefore (HP do alvo antes deste dano).", 400, "missing_hp_before");
    }
    const hpBefore = Math.floor(body.hpBefore);
    if (targetRow.hp_current !== hpBefore) {
      throw new MesaError(
        "HP do alvo não corresponde ao hpBefore desta resolução (já aplicada ou estado mudou).",
        409,
        "stale_hp",
      );
    }

    if (body.hitLocation !== undefined && !isHitLocation(body.hitLocation)) {
      throw new MesaError("Local de impacto inválido.", 400, "invalid_action");
    }
    const hitLocation = isHitLocation(body.hitLocation) ? body.hitLocation : undefined;
    const damageRolls = sanitizeDamageRolls(body.damageRolls);
    const sourceType = sanitizeSourceText(body.sourceType, 40);
    const sourceContext = sanitizeSourceText(body.sourceContext, 160);

    /* ----------------------- snapshot + Damage Engine -------------------- */

    const participants = (rows ?? [])
      .map((row) => combatParticipantFromRow(row))
      .filter((entry): entry is CombatParticipant => entry !== null);
    const target = participants.find((entry) => entry.id === targetRow.id);
    if (!target) throw new MesaError("Snapshot de combate do alvo ausente.", 409, "combat_snapshot_missing");

    const state: CombatState = {
      id: combat.id,
      status: combat.status,
      round: combat.round,
      initiativeStarted: combat.initiative_started,
      activeParticipantId: combat.active_combatant_id,
      participants,
    };

    const action: DamageAction = {
      type: "damage",
      // Fonte externa/GM: sem ator — nenhuma Action é consumida por dano de cena.
      actorId: null,
      targetId: target.id,
      amount: Number(body.amount), // validação é do motor (fonte única)
      ...(hitLocation !== undefined ? { hitLocation } : {}),
      ...(body.ignoreArmor === true ? { ignoreArmor: true } : {}),
      ...(damageRolls !== undefined ? { damageRolls } : {}),
    };

    const result = execute(state, action, serverRandom);
    if (!result.ok) {
      const engineError = result.errors?.[0];
      throw new MesaError(
        engineError?.message ?? "O motor de combate recusou o dano.",
        400,
        engineError?.code ?? "engine_refused",
      );
    }

    const patch = engineDamagePatch(result, target.id);
    const outcome: PlayerDamageOutcome = {
      updated: true,
      hp: patch.hp_current ?? targetRow.hp_current,
      isDead: patch.is_dead ?? targetRow.is_dead,
      armor: patch.combat_armor ?? targetRow.combat_armor ?? null,
      criticalInjuries: patch.critical_injuries ?? targetRow.critical_injuries ?? [],
      damageResult: result.damageResult ?? null,
    };
    const eventText = [
      `Dano externo${sourceType ? ` (${sourceType})` : ""}: ${targetRow.name}`,
      sourceContext ?? "",
    ]
      .filter(Boolean)
      .join(" — ");

    /* -------------------- commit atômico (Fase 5) ------------------------ */

    // UMA transação cobre patch (HP/Armor/CI/is_dead), evento e status da
    // resolução. Se qualquer passo falhar, o Postgres desfaz TUDO: HP não
    // muda, Armor não muda, lesão não muda e o evento não é publicado.
    const committedResult = (await query(
        db().rpc("commit_mesa_attack_resolution", {
        p_session_id: session.id,
        p_combat_id: combat.id,
        p_resolution_id: resolutionId,
        p_claim_token: claimToken,
        // Dano externo não tem ator: a linha do ALVO carrega a si própria com
        // a economia inalterada (CAS trivial). Nada é debitado.
        p_actor_id: targetRow.id,
        p_target_id: targetRow.id,
        p_actions_before: targetRow.actions_remaining,
        p_actions_after: targetRow.actions_remaining,
        p_ammo_before: targetRow.combat_ammo ?? null,
        p_ammo_after: targetRow.combat_ammo ?? null,
        p_target_hp_before: hpBefore,
        p_target_dead_before: targetRow.is_dead,
          p_target_patch: patch,
        p_result: outcome,
        p_event_text: eventText,
      }),
      "Falha ao confirmar o dano externo",
    )) as PlayerDamageOutcome | null;
    if (!committedResult) throw new MesaError("A resolução não retornou resultado persistido.", 500, "transaction_failed");
    committed = true;
    return committedResult;
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
          "Falha ao liberar a resolução do dano",
        );
      } catch {
        // O erro original é mais útil; resolução sem commit não aplicou efeitos.
      }
    }
    throw databaseResolutionError(error) ?? error;
  }
}

// ---------------------------------------------------------------------------
// F1.12.2 — PLAYER HEALING GATEWAY (cura autoritativa de Player)
// ---------------------------------------------------------------------------

/**
 * Prefixo do `resolution_id` de cura gravado em `mesa_attack_resolutions`.
 *
 * A infraestrutura durável (claim/commit/release, F1.7.16) é a MESMA do dano e
 * do ataque; o prefixo é o que impede um `resolutionId` de cura de colidir com
 * um de dano externo, de ataque ou de reload na mesma mesa/combate.
 */
const PLAYER_HEAL_RESOLUTION_PREFIX = "player-heal:";

/** Limites do rótulo de origem da cura (mesma ordem de grandeza do dano). */
const HEAL_SOURCE_TYPE_MAX = 40;
const HEAL_SOURCE_CONTEXT_MAX = 160;

/**
 * Quantidade de cura — só inteiro POSITIVO. Zero, negativo, fracionário ou
 * não-numérico são RECUSADOS: nada é arredondado para dentro da conta.
 */
function requireHealAmount(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw) || raw <= 0) {
    throw new MesaError("Valor de cura inválido: informe um número inteiro maior que zero.", 400, "invalid_amount");
  }
  return raw;
}

const PLAYER_DEATH_SAVE_RESOLUTION_PREFIX = "player-death-save:";
const DEATH_SAVE_FORBIDDEN_FIELDS = [
  "hp", "hpAfter", "hpCurrent", "hp_current", "finalHp", "isDead", "is_dead", "defeated",
  "success", "failure", "result", "outcome", "deathSaveResult", "finalResult", "finalValue",
  "deathSaveDC", "deathSaveFailures", "failuresAfter", "characterDied", "dc", "roll", "diceRoll",
];

/** F1.15 — o Player envia somente a intenção de rolar a própria Death Save. */
export async function registerPlayerDeathSave(input: {
  sessionId: unknown;
  token: unknown;
  body: unknown;
}): Promise<{ result: PlayerDeathSaveOutcome; committed: boolean }> {
  if (typeof input.body !== "object" || input.body === null || Array.isArray(input.body)) {
    throw new MesaError("Envie a intenção de Death Save.", 400, "invalid_action");
  }
  const body = input.body as Record<string, unknown>;
  const forbidden = DEATH_SAVE_FORBIDDEN_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
  if (forbidden.length > 0) {
    throw new MesaError(
      `O servidor não aceita autoridade de resultado do cliente (${forbidden.join(", ")}).`,
      400,
      "client_authority_forbidden",
    );
  }
  const { session, participant } = await authenticate(input.sessionId, input.token);
  requirePlayer({ session, participant });
  requireActiveSession(session);
  const rawResolutionId = body.resolutionId;
  if (typeof rawResolutionId !== "string" || rawResolutionId.trim().length < 1 || rawResolutionId.trim().length > 120) {
    throw new MesaError("ResolutionId inválido.", 400, "invalid_resolution_id");
  }
  const resolutionId = `${PLAYER_DEATH_SAVE_RESOLUTION_PREFIX}${rawResolutionId.trim()}`;
  const actorCombatantId = typeof body.actorCombatantId === "string" ? body.actorCombatantId.trim() : "";
  if (!actorCombatantId) throw new MesaError("Combatente ausente.", 400, "combatant_not_found");
  const combat = await getActiveCombat(session.id);
  if (!combat) throw new MesaError("Nenhum combate ativo.", 409, "combat_not_active");

  const row = (await query(
    db().from("mesa_combatants").select("*").eq("id", actorCombatantId).eq("combat_id", combat.id).maybeSingle(),
    "Falha ao consultar combatente",
  )) as CombatantRow | null;
  if (!row || row.session_id !== session.id) throw new MesaError("Combatente não encontrado.", 404, "combatant_not_found");
  if (row.participant_id !== participant.id) throw new MesaError("Você não controla este combatente.", 403, "combatant_not_owned");
  if (row.kind !== "character") throw new MesaError("Death Save exige um personagem.", 400, "not_a_player");

  const replay = (result: PlayerDeathSaveOutcome) => {
    if (result.combatantId !== actorCombatantId) throw new MesaError("Esta resolução pertence a outro personagem.", 409, "resolution_conflict");
    return { result, committed: false };
  };
  const previous = await storedAttackResolution<PlayerDeathSaveOutcome>(session.id, resolutionId, combat.id);
  if (previous?.status === "committed" && previous.result) return replay(previous.result);
  if (previous?.status === "failed") throw new MesaError("Esta resolução de Death Save falhou; não será reexecutada.", 409, "resolution_failed");
  if (previous?.status === "processing") return replay(await waitForAttackResolution<PlayerDeathSaveOutcome>(session.id, resolutionId, combat.id));

  if (row.is_dead) throw new MesaError("O personagem já está morto.", 409, "death_save_ineligible");
  if (row.hp_current >= 1) throw new MesaError("Death Save só pode ser rolado com HP menor que 1.", 409, "death_save_ineligible");

  const claimRows = (await query(db().rpc("claim_mesa_attack_resolution", {
    p_session_id: session.id, p_combat_id: combat.id, p_resolution_id: resolutionId,
  }), "Falha ao reservar a Death Save")) as AttackResolutionClaim<PlayerDeathSaveOutcome>[] | null;
  const claim = claimRows?.[0];
  if (!claim) throw new MesaError("Não foi possível reservar a Death Save.", 500, "transaction_failed");
  if (!claim.claimed) {
    if (claim.status === "committed" && claim.result) return replay(claim.result);
    if (claim.status === "failed") throw new MesaError("Esta resolução de Death Save falhou; não será reexecutada.", 409, "resolution_failed");
    return replay(await waitForAttackResolution<PlayerDeathSaveOutcome>(session.id, resolutionId, combat.id));
  }

  let committed = false;
  try {
    // Dados antigos que chegaram ao combate já mortais podem ter DC 0. A regra
    // existente inicializa a primeira Death Save com BODY; isto só é aplicado
    // quando ainda não há falhas, sem confundir uma DC 0 já reduzida.
    const snapshotBody = typeof row.combat_snapshot?.stats?.BODY === "number" ? row.combat_snapshot.stats.BODY : 0;
    const currentDc = row.death_save_dc ?? 0;
    const currentFailures = row.death_save_failures ?? 0;
    const dcBefore = currentDc === 0 && currentFailures === 0 ? snapshotBody : currentDc;
    const injuryModifiers = getCriticalInjuryModifiers({
      combat: (row.combat_snapshot?.combat ?? { criticalInjuries: [] }) as unknown as Character["combat"],
    });
    const resolved = resolveDeathSave(
      { dc: dcBefore, failures: currentFailures, deathSavePenalty: injuryModifiers.deathSaveModifier },
      serverRandom,
    );
    const outcome: PlayerDeathSaveOutcome = {
      combatantId: row.id,
      diceRoll: resolved.diceRoll,
      dc: resolved.dc,
      success: resolved.success,
      failuresAfter: resolved.failuresAfter,
      characterDied: resolved.characterDied,
      deathSaveDC: resolved.state.dc,
      committed: true,
    };
    const committedResult = (await query(db().rpc("commit_mesa_death_save_resolution", {
      p_session_id: session.id,
      p_combat_id: combat.id,
      p_resolution_id: resolutionId,
      p_claim_token: claim.claim_token,
      p_actor_id: row.id,
      p_dc_before: currentDc,
      p_dead_before: row.is_dead,
      p_failures_before: currentFailures,
      p_dc_after: resolved.state.dc,
      p_failures_after: resolved.state.failures,
      p_dead_after: resolved.characterDied,
      p_result: outcome,
      p_event_text: `${row.name}: Death Save ${resolved.success ? "sucesso" : "falha"}`,
    }), "Falha ao confirmar a Death Save")) as PlayerDeathSaveOutcome | null;
    if (!committedResult) throw new MesaError("A resolução não retornou resultado persistido.", 500, "transaction_failed");
    committed = true;
    return { result: committedResult, committed: true };
  } catch (error) {
    if (!committed) {
      try { await query(db().rpc("release_mesa_attack_resolution", {
        p_session_id: session.id, p_combat_id: combat.id, p_resolution_id: resolutionId, p_claim_token: claim.claim_token,
      }), "Falha ao liberar Death Save"); } catch { /* preserva o erro original */ }
    }
    throw databaseResolutionError(error) ?? error;
  }
}

/**
 * `sourceType`/`sourceContext` da cura são apenas RÓTULO — viram texto do
 * evento e nenhuma regra (Medkit/First Aid ficam fora desta etapa). Valor
 * não-string ou acima do limite é CONTEXTO INVÁLIDO e recusa a chamada.
 */
function requireHealSourceText(raw: unknown, field: string, max: number): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") throw new MesaError(`${field} inválido.`, 400, "invalid_context");
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length === 0) return null;
  if (value.length > max) throw new MesaError(`${field} inválido.`, 400, "invalid_context");
  return value;
}

/**
 * F1.12.2 — **Player Healing Gateway**: ponto ÚNICO server-side de CURA de um
 * PERSONAGEM durante uma Mesa com combate ativo.
 *
 *     intenção (cliente: targetCombatantId + amount)
 *       → validação de autoridade + autorização (GM)
 *       → validação de intenção (amount/contexto)
 *       → claim da resolução (idempotência durável)
 *       → linha da Mesa (hp atual LIDO AQUI)
 *       → newHp = min(currentHp + amount, maxHp)
 *       → commit_mesa_attack_resolution (transação: patch + evento + status)
 *       → publishMesaState → Realtime → characterSync → ficha
 *
 * ## Autoridade (F1.12.2)
 *
 * O cliente envia APENAS intenção: `targetCombatantId`, `amount`,
 * `sourceType?`, `sourceContext?`, `resolutionId`. `hpAfter`/`finalHp`/`hp`/
 * `hpCurrent`/`hpMax`/`isDead`/`deathSave*` são RECUSADOS em 400
 * (`assertIntentOnly`) — nem são lidos. Quem declara o HP final é o servidor.
 *
 * ## O que este gateway NÃO faz
 *
 * - Não toca `is_dead` nem Death Save: a lesão de morte continua sendo da
 *   regra de Death Save (fora do escopo). Enquanto essa regra não disser se um
 *   personagem com HP ≤ 0 pode ser curado, a cura é PERMITIDA e o `is_dead`
 *   permanece como está — a infraestrutura não muda, nada é inventado.
 * - Não consome Action nem munição: a "linha de ator" da RPC é o próprio alvo
 *   com a economia inalterada.
 * - Não é Medkit/First Aid/inventário/cura entre Players: são etapas
 *   posteriores que DEVEM reutilizar este gateway.
 *
 * ## Quem pode chamar
 *
 * Somente o Mestre (`requireGM`). Cura entre Players é etapa posterior.
 *
 * ## Concorrência e idempotência
 *
 * Concorrência: o MESMO mecanismo do ataque/dano — `commit_mesa_attack_resolution`
 * compara `hp_current = p_target_hp_before AND is_dead = p_target_dead_before`
 * antes de gravar. Quem perde recebe 409 `hp_conflict`; nunca existe escrita
 * silenciosa por cima.
 *
 * Idempotência: DURÁVEL, reutilizando `mesa_attack_resolutions` — mesmo
 * `resolutionId` devolve o resultado já gravado sem curar de novo. O prefixo
 * `player-heal:` mantém o namespace separado.
 *
 * ## Recusas (todas sem efeito parcial)
 *
 * 410 `session_finished` · 409 `combat_not_active` · 403 `gm_only` ·
 * 404 `target_not_found` · 400 `not_a_player` · 400 `invalid_amount` ·
 * 400 `invalid_context` · 400 `invalid_resolution_id` ·
 * 400 `client_authority_forbidden`.
 */
export async function applyPlayerHealing(input: {
  sessionId: unknown;
  token: unknown;
  /** Corpo cru da intenção: só campos de intenção são lidos; os de resultado recusam. */
  body: unknown;
}): Promise<PlayerHealingOutcome> {
  assertIntentOnly(input.body, "healing");
  const body: Record<string, unknown> =
    typeof input.body === "object" && input.body !== null && !Array.isArray(input.body)
      ? (input.body as Record<string, unknown>)
      : {};

  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireGM({ session, participant });
  // Sessão encerrada: recusa EXPLÍCITA (neste gateway não há "sucesso silencioso").
  requireActiveSession(session);

  const resolutionId = `${PLAYER_HEAL_RESOLUTION_PREFIX}${requireResolutionId(body.resolutionId)}`;

  const combat = await getActiveCombat(session.id);
  if (!combat) throw new MesaError("Nenhum combate ativo.", 409, "combat_not_active");

  /* --------------------------- intenção limpa ---------------------------- */

  const targetRowId = typeof body.targetCombatantId === "string" ? body.targetCombatantId.trim() : "";
  if (!targetRowId) throw new MesaError("Alvo da cura ausente (targetCombatantId).", 400, "target_not_found");
  const amount = requireHealAmount(body.amount);
  const sourceType = requireHealSourceText(body.sourceType, "sourceType", HEAL_SOURCE_TYPE_MAX);
  const sourceContext = requireHealSourceText(body.sourceContext, "sourceContext", HEAL_SOURCE_CONTEXT_MAX);

  /* ------------------------- idempotência durável ------------------------ */

  const previous = await storedAttackResolution<PlayerHealingOutcome>(session.id, resolutionId, combat.id);
  if (previous?.status === "committed" && previous.result) return previous.result;
  if (previous?.status === "failed") {
    throw new MesaError("A resolução desta cura falhou antes do commit; não será reexecutada.", 409, "resolution_failed");
  }
  if (previous?.status === "processing") {
    return waitForAttackResolution<PlayerHealingOutcome>(session.id, resolutionId, combat.id);
  }

  const claimRows = (await query(
    db().rpc("claim_mesa_attack_resolution", {
      p_session_id: session.id,
      p_combat_id: combat.id,
      p_resolution_id: resolutionId,
    }),
    "Falha ao reservar a resolução da cura",
  )) as AttackResolutionClaim<PlayerHealingOutcome>[] | null;
  const claim = claimRows?.[0];
  if (!claim) throw new MesaError("Não foi possível reservar a resolução da cura.", 500, "transaction_failed");
  if (!claim.claimed) {
    if (claim.status === "committed" && claim.result) return claim.result;
    if (claim.status === "failed") {
      throw new MesaError("A resolução desta cura falhou antes do commit; não será reexecutada.", 409, "resolution_failed");
    }
    return waitForAttackResolution<PlayerHealingOutcome>(session.id, resolutionId, combat.id);
  }
  const claimToken = claim.claim_token;
  let committed = false;

  try {
    /* --------------------------- alvo da Mesa ---------------------------- */

    const rows = (await query(
      db().from("mesa_combatants").select("*").eq("combat_id", combat.id),
      "Falha ao consultar os combatentes",
    )) as CombatantRow[] | null;
    const targetRow = rows?.find((row) => row.id === targetRowId);
    if (!targetRow || targetRow.session_id !== session.id) {
      throw new MesaError("Alvo não encontrado.", 404, "target_not_found");
    }
    // Este gateway é de PERSONAGEM: inimigo continua no caminho do Mestre
    // (`PATCH /combatants`) — não se abre um segundo caminho de HP para inimigo.
    if (targetRow.kind !== "character") {
      throw new MesaError(
        "Este gateway é para personagens; a vida de inimigo é ajustada em /api/mesa/[id]/combatants.",
        400,
        "not_a_player",
      );
    }

    /* -------------- cálculo SERVIDOR: min(atual + amount, máx) ----------- */

    const hpBefore = targetRow.hp_current;
    const hpMax = targetRow.hp_max;
    // Regra ÚNICA de cura (`clampHealing`, extraída daqui): cura nunca reduz HP
    // e nunca passa do teto. A mesma função é usada pela resolução atômica de
    // item + cura da Mesa (F1.13.2) — uma implementação, não duas.
    const hp = clampHealing(hpBefore, hpMax, amount);
    const amountApplied = hp - hpBefore;

    // Já estava no máximo: nada muda, nada é publicado — mas a resolução é
    // gravada, para o retry devolver o mesmo resultado sem efeito novo.
    const patch: { hp_current?: number; death_save_dc?: number; death_save_failures?: number } = amountApplied > 0 ? { hp_current: hp } : {};

    const outcome: PlayerHealingOutcome = {
      updated: amountApplied > 0,
      hp,
      hpMax,
      amountApplied,
      // Invariante: cura não toca morte/Death Save nesta etapa.
      isDead: targetRow.is_dead,
    };
    const eventText =
      amountApplied > 0
        ? [
            `Cura${sourceType ? ` (${sourceType})` : ""}: ${targetRow.name} +${amountApplied}`,
            sourceContext ?? "",
          ]
              .filter(Boolean)
              .join(" — ")
        : null;

    /* -------------------- commit atômico (transação) --------------------- */

    // UMA transação cobre patch (APENAS hp_current), evento e status da
    // resolução. Se qualquer passo falhar, o Postgres desfaz TUDO: HP não
    // muda, o evento não é publicado e a ficha não recebe nada.
    const committedResult = (await query(
      db().rpc("commit_mesa_attack_resolution", {
        p_session_id: session.id,
        p_combat_id: combat.id,
        p_resolution_id: resolutionId,
        p_claim_token: claimToken,
        // Cura não tem ator: a linha do ALVO carrega a si própria com a
        // economia inalterada (CAS trivial). Nenhuma Action/munição é debitada.
        p_actor_id: targetRow.id,
        p_target_id: targetRow.id,
        p_actions_before: targetRow.actions_remaining,
        p_actions_after: targetRow.actions_remaining,
        p_ammo_before: targetRow.combat_ammo ?? null,
        p_ammo_after: targetRow.combat_ammo ?? null,
        p_target_hp_before: hpBefore,
        p_target_dead_before: targetRow.is_dead,
        p_target_patch: patch,
        p_result: outcome,
        p_event_text: eventText,
      }),
      "Falha ao confirmar a cura",
    )) as PlayerHealingOutcome | null;
    if (!committedResult) throw new MesaError("A resolução não retornou resultado persistido.", 500, "transaction_failed");
    committed = true;
    return committedResult;
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
          "Falha ao liberar a resolução da cura",
        );
      } catch {
        // O erro original é mais útil; resolução sem commit não aplicou efeitos.
      }
    }
    throw databaseResolutionError(error) ?? error;
  }
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
    initiativeDetail: MesaCombatant["initiativeDetail"];
    isDead: boolean;
    sortOrder: number;
  }> = [];

  for (const row of rows) {
    // F1.14.2 — iniciativa JÁ registrada (Player Initiative Gateway ou ajuste
    // manual do Mestre) é PRESERVADA: a rolagem coletiva só preenche quem ainda
    // não tem valor. Sem isto o registro do Jogador seria descartado em silêncio
    // no primeiro clique do Mestre.
    if (typeof row.initiative === "number" && Number.isFinite(row.initiative)) {
      rolled.push({
        id: row.id,
        kind: row.kind,
        name: row.name,
        initiative: row.initiative,
        initiativeDetail: row.initiative_detail,
        isDead: row.is_dead,
        sortOrder: row.sort_order,
      });
      continue;
    }

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

// ---------------------------------------------------------------------------
// F1.14.2 — PLAYER INITIATIVE GATEWAY (registro server-authoritative)
// ---------------------------------------------------------------------------

/**
 * Prefixo do `resolution_id` gravado em `mesa_attack_resolutions`.
 *
 * A infraestrutura durável (claim/commit, F1.7.16) é a MESMA do ataque, do
 * dano externo, da cura e do reload; o prefixo separa o namespace para um
 * `resolutionId` de iniciativa nunca colidir com os outros na mesma mesa.
 */
const PLAYER_INITIATIVE_RESOLUTION_PREFIX = "player-initiative:";

/**
 * Envelope do valor aceito — derivado da fórmula que o projeto JÁ usa
 * (`rollInitiative`: **1d10 + REF + modificadores**, com REF 2..8 na criação e
 * modificadores de cyberware/lesão na ordem de −10..+10). Fora deste intervalo
 * o número não veio de rolagem nenhuma; não é uma regra de CPR nova, é só o
 * alcance da conta existente.
 */
const MIN_INITIATIVE = -10;
const MAX_INITIATIVE = 30;

/** Iniciativa só como inteiro dentro do envelope da fórmula do projeto. */
function requireInitiative(raw: unknown): number {
  if (
    typeof raw !== "number" ||
    !Number.isFinite(raw) ||
    !Number.isInteger(raw) ||
    raw < MIN_INITIATIVE ||
    raw > MAX_INITIATIVE
  ) {
    throw new MesaError(
      `Iniciativa inválida: informe um número inteiro entre ${MIN_INITIATIVE} e ${MAX_INITIATIVE} (1d10 + REF + modificadores).`,
      400,
      "invalid_initiative",
    );
  }
  return raw;
}

/**
 * Além de `CLIENT_RESULT_FIELDS` (HP/Armor/lesão/morte), o contrato de
 * intenção deste gateway recusa tudo que descreva o ESTADO DERIVADO do combate:
 * ordem de turnos, ativo, rodada, economia de ações. O cliente manda
 * `{ resolutionId, actorCombatantId, initiative }` e nada mais.
 */
const INITIATIVE_FORBIDDEN_FIELDS = [
  "initiativeOrder",
  "initiativeDetail",
  "initiativeStarted",
  "activeCombatant",
  "activeCombatantId",
  "turn",
  "round",
  "actionsRemaining",
  "actionsMax",
  "sortOrder",
  "sort_order",
  "eventLog",
];

/**
 * Um corpo de Player Initiative Gateway: presente ⇔ o chamador quer registrar a
 * própria iniciativa. Ausente ⇔ operação legada do Mestre (`rollInitiativeForAll`,
 * body vazio). A distinção é de FORMA, nunca de papel: o papel é validado no
 * servidor (`requirePlayer`).
 */
export function isPlayerInitiativeIntent(body: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(body, "resolutionId") ||
    Object.prototype.hasOwnProperty.call(body, "actorCombatantId") ||
    Object.prototype.hasOwnProperty.call(body, "initiative")
  );
}

/**
 * F1.14.2 — **Player Initiative Gateway**: ponto ÚNICO server-side para o
 * Jogador registrar a INICIATIVA do PRÓPRIO personagem durante o combate da Mesa.
 *
 *     rolagem local (RNG da ficha roda no navegador)
 *       → POST só com a intenção `{ resolutionId, actorCombatantId, initiative }`
 *       → validação de sessão/papel/posse/combate/valor
 *       → claim da resolução (idempotência durável)
 *       → escrita CONDICIONAL em `mesa_combatants.initiative`
 *       → evento + carimbo `committed` da resolução
 *       → publishMesaState → Realtime → useMesaState → syncMesaCharacterState → ficha
 *
 * ## O que este gateway NÃO faz
 *
 * Não calcula ordem de turno, não vira `active_combat`, não abre rodada e não
 * debita Action: `sort_order`/`active_combatant_id` continuam sendo escritos
 * pela rolagem coletiva do Mestre (`rollInitiativeForAll`), que é a regra
 * EXISTENTE de abertura de turno. Nenhuma regra de CPR nova é inventada aqui —
 * a única travagem é a que o combate já tem: `initiative_started`.
 *
 * ## Validações (todas sem efeito parcial)
 *
 * 400 `client_authority_forbidden` · 400 `invalid_resolution_id` ·
 * 400 `invalid_initiative` · 401 `missing_token` · 403 `not_participant` ·
 * 403 `player_only` · 403 `combatant_not_owned` · 403 `combatant_defeated` ·
 * 400 `not_a_player` · 404 `session_not_found` · 404 `combatant_not_found` ·
 * 410 `session_finished` · 409 `combat_not_active` ·
 * 409 `initiative_already_rolled` · 409 `initiative_already_registered` ·
 * 409 `initiative_conflict`.
 *
 * ## Idempotência e concorrência
 *
 * Idempotência: DURÁVEL, reutilizando `mesa_attack_resolutions` — a MESMA
 * `resolutionId` devolve o resultado já gravado sem gravar de novo.
 *
 * Concorrência: a escrita é CONDICIONAL (`initiative IS NULL`); uma iniciativa
 * já registrada por outra operação nunca é sobrescrita em silêncio — quem perde
 * a corrida recebe 409 `initiative_conflict`.
 *
 * ## Limitação conhecida
 *
 * A infraestrutura de commit transacional existente não escreve a coluna
 * `initiative`, então o passo de escrita e o carimbo da resolução são DUAS
 * chamadas (a escrita em si é atômica). Uma falha entre elas deixa a iniciativa
 * persistida e a resolução `processing`; o retry com a MESMA `resolutionId`
 * recupera pelo `recover_mesa_attack_resolution` e nunca regrava.
 */
export async function registerPlayerInitiative(input: {
  sessionId: unknown;
  token: unknown;
  /** Corpo cru da intenção: campos de resultado/estado são recusados. */
  body: unknown;
}): Promise<{ result: PlayerInitiativeOutcome; committed: boolean }> {
  assertIntentOnly(input.body, "initiative");
  const body: Record<string, unknown> =
    typeof input.body === "object" && input.body !== null && !Array.isArray(input.body)
      ? (input.body as Record<string, unknown>)
      : {};

  const forbidden = INITIATIVE_FORBIDDEN_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );
  if (forbidden.length > 0) {
    throw new MesaError(
      `O servidor não aceita autoridade de resultado do cliente (${forbidden.join(", ")}). ` +
        "Envie só a intenção: ordem, turno e ações são resolvidos aqui.",
      400,
      "client_authority_forbidden",
    );
  }

  const { session, participant } = await authenticate(input.sessionId, input.token);
  requirePlayer({ session, participant });
  requireActiveSession(session);

  const resolutionId = `${PLAYER_INITIATIVE_RESOLUTION_PREFIX}${requireResolutionId(body.resolutionId)}`;
  const actorCombatantId = typeof body.actorCombatantId === "string" ? body.actorCombatantId.trim() : "";
  if (!actorCombatantId) {
    throw new MesaError("Combatente ausente (actorCombatantId).", 400, "combatant_not_found");
  }
  const initiative = requireInitiative(body.initiative);

  const combat = await getActiveCombat(session.id);
  if (!combat) throw new MesaError("Nenhum combate ativo.", 409, "combat_not_active");

  /* ------------------------- idempotência durável ------------------------ */

  const previous = await storedAttackResolution<PlayerInitiativeOutcome>(session.id, resolutionId, combat.id);
  if (previous?.status === "committed" && previous.result) return { result: previous.result, committed: false };
  if (previous?.status === "failed") {
    throw new MesaError("A resolução desta iniciativa falhou antes do commit; não será reexecutada.", 409, "resolution_failed");
  }
  if (previous?.status === "processing") {
    return { result: await waitForAttackResolution<PlayerInitiativeOutcome>(session.id, resolutionId, combat.id), committed: false };
  }

  // Trava EXISTENTE do combate: depois que a iniciativa foi rolada, ela está
  // encerrada (`rollInitiativeForAll` lança o mesmo 409). Vem DEPOIS da
  // idempotência de propósito: repetir uma `resolutionId` já resolvida devolve
  // o resultado gravado mesmo que o Mestre tenha rolado nesse meio-tempo.
  if (combat.initiative_started) {
    throw new MesaError("A iniciativa já foi rolada.", 409, "initiative_already_rolled");
  }

  const claimRows = (await query(
    db().rpc("claim_mesa_attack_resolution", {
      p_session_id: session.id,
      p_combat_id: combat.id,
      p_resolution_id: resolutionId,
    }),
    "Falha ao reservar a resolução da iniciativa",
  )) as AttackResolutionClaim<PlayerInitiativeOutcome>[] | null;
  const claim = claimRows?.[0];
  if (!claim) throw new MesaError("Não foi possível reservar a resolução da iniciativa.", 500, "transaction_failed");
  if (!claim.claimed) {
    if (claim.status === "committed" && claim.result) return { result: claim.result, committed: false };
    if (claim.status === "failed") {
      throw new MesaError("A resolução desta iniciativa falhou antes do commit; não será reexecutada.", 409, "resolution_failed");
    }
    return { result: await waitForAttackResolution<PlayerInitiativeOutcome>(session.id, resolutionId, combat.id), committed: false };
  }
  const claimToken = claim.claim_token;
  let committed = false;

  try {
    /* ----------------------------- intenção ------------------------------ */

    const rows = (await query(
      db().from("mesa_combatants").select("*").eq("combat_id", combat.id),
      "Falha ao consultar os combatentes",
    )) as CombatantRow[] | null;
    const actorRow = rows?.find((row) => row.id === actorCombatantId);
    if (!actorRow || actorRow.session_id !== session.id) {
      throw new MesaError("Combatente não encontrado.", 404, "combatant_not_found");
    }
    // Posse: um Player só registra a iniciativa do PRÓPRIO combatente.
    if (actorRow.participant_id !== participant.id) {
      throw new MesaError("Você não pode controlar este combatente.", 403, "combatant_not_owned");
    }
    // Inimigo continua sendo do Mestre (seed/`rollInitiativeForAll`): este
    // gateway é de PERSONAGEM, como os outros gateways de Player.
    if (actorRow.kind !== "character") {
      throw new MesaError("Este gateway é para personagens.", 400, "not_a_player");
    }
    if (actorRow.is_dead) throw new MesaError("Combatente derrotado.", 403, "combatant_defeated");
    // Sem sobrescrita silenciosa: valor já gravado (gateway, rolagem do Mestre
    // ou ajuste manual) só sai por uma operação explícita, nunca por este POST.
    if (actorRow.initiative !== null && actorRow.initiative !== undefined) {
      throw new MesaError("Sua iniciativa já foi registrada nesta luta.", 409, "initiative_already_registered");
    }

    // `refBonus` vem da ficha que O SERVIDOR guarda; o request só traz o total.
    const sheet = actorRow.character_id ? await loadSheet(actorRow.character_id) : null;
    const refBonus = typeof sheet?.stats?.REF === "number" ? sheet.stats.REF : undefined;
    const initiativeDetail: MesaCombatant["initiativeDetail"] = { total: initiative, ...(refBonus !== undefined ? { refBonus } : {}) };
    const outcome: PlayerInitiativeOutcome = {
      kind: "initiative",
      resolutionId,
      combatantId: actorRow.id,
      initiative,
      initiativeDetail,
      registered: true,
    };

    /* -------------------- escrita condicional (CAS) ----------------------- */

    // Só grava se a coluna AINDA estiver como foi lida: dois registros
    // concorrentes nunca sobrescrevem um ao outro em silêncio.
    const written = (await query(
      db()
        .from("mesa_combatants")
        .update({ initiative, initiative_detail: initiativeDetail })
        .eq("id", actorRow.id)
        .eq("combat_id", combat.id)
        .is("initiative", null)
        .select("id"),
      "Falha ao registrar a iniciativa",
    )) as Array<{ id: string }> | null;
    if (!written || written.length !== 1) {
      throw new MesaError(
        "Sua iniciativa mudou durante o registro; recarregue a Mesa e tente de novo.",
        409,
        "initiative_conflict",
      );
    }

    /* ------------------- carimbo da resolução (retry) --------------------- */

    const stamped = (await query(
      db()
        .from("mesa_attack_resolutions")
        .update({
          status: "committed",
          result: outcome,
          committed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("session_id", session.id)
        .eq("combat_id", combat.id)
        .eq("resolution_id", resolutionId)
        .eq("claim_token", claimToken)
        .eq("status", "processing")
        .select("id"),
      "Falha ao confirmar a resolução da iniciativa",
    )) as Array<{ id: string }> | null;
    if (!stamped || stamped.length !== 1) {
      throw new MesaError("A resolução não retornou resultado persistido.", 500, "transaction_failed");
    }
    committed = true;

    await appendEvent(combat.id, { kind: "initiative", text: `${actorRow.name}: iniciativa registrada (${initiative})` });
    return { result: outcome, committed: true };
  } catch (error) {
    // Libera só o que não foi carimbado: com o carimbo feito, um retry da MESMA
    // `resolutionId` devolve este resultado em vez de regravar (ou reclamar).
    if (!committed) {
      try {
        await query(
          db().rpc("release_mesa_attack_resolution", {
            p_session_id: session.id,
            p_combat_id: combat.id,
            p_resolution_id: resolutionId,
            p_claim_token: claimToken,
          }),
          "Falha ao liberar a resolução da iniciativa",
        );
      } catch {
        // O erro original é mais útil; resolução sem commit não aplicou efeitos.
      }
    }
    throw databaseResolutionError(error) ?? error;
  }
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
  // F1.16: esta é a rota legada de controle manual da Mesa. Players usam os
  // gateways específicos (attack/move/reload/item); não há uma segunda porta
  // genérica sem resolutionId capaz de debitar a economia.
  if (participant.role === "player" && input.actionType === "move") {
    throw new MesaError("Use o gateway de movimento da Mesa.", 403, "move_gateway_required");
  }
  requireGM({ session, participant });

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
  const movement = effectiveMovementForRow(row);
  const unconsciousUntilRound = unconsciousUntilRoundForRow(row);

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
       movementMax: movement.max,
       movementRemaining: movement.remaining,
       unconsciousUntilRound,
    },
    actionType,
    meters,
    currentRound: combat?.round,
  });

  if (!result.ok) {
    throw new MesaError(DENIAL_MESSAGES[result.reason], 403, result.reason);
  }
  if (!combat) throw new MesaError("Nenhum combate ativo.", 409, "combat_not_active");

  const economy = applyAction(
    {
      actionsMax: row.actions_max,
      actionsRemaining: row.actions_remaining,
      movementMax: movement.max,
      movementRemaining: movement.remaining,
    },
    actionType as CombatActionType,
    meters,
  );

  const written = (await query(
    db()
      .from("mesa_combatants")
      .update({
        actions_remaining: economy.actionsRemaining,
        movement_remaining: economy.movementRemaining,
      })
      .eq("id", row.id)
      .eq("actions_remaining", row.actions_remaining)
      .eq("movement_remaining", row.movement_remaining)
      .eq("is_dead", false)
      .select("id"),
    "Falha ao consumir a ação",
  )) as Array<{ id: string }> | null;
  if (!written || written.length !== 1) {
    throw new MesaError("O estado do turno mudou; atualize a Mesa.", 409, "action_conflict");
  }

  const label = actionType === "move" ? `Movimento (${Math.floor(meters)}m)` : ACTION_LABELS[actionType as CombatActionType];
  await appendEvent(combat.id, { kind: "action", text: `${row.name}: ${label}` });
}

/**
 * F1.14.3 — movimento do Player. Não há posição espacial na Mesa: o estado
 * persistido é o orçamento `movement_remaining` (metros de MOVE × 2 por turno).
 * Reutiliza resolveAction/applyAction: Move custa ZERO Actions e pode gastar o
 * orçamento em parcelas, exatamente como o /combat/action legado do GM.
 */
export async function movePlayerCombatant(input: {
  sessionId: unknown;
  token: unknown;
  body: unknown;
}): Promise<{ result: { combatantId: string; distance: number; movementRemaining: number; actionsRemaining: number }; committed: boolean }> {
  const body = typeof input.body === "object" && input.body !== null && !Array.isArray(input.body)
    ? input.body as Record<string, unknown> : {};
  const extra = Object.keys(body).filter((key) => !["resolutionId", "actorCombatantId", "distance", "targetPosition"].includes(key));
  if (extra.length) throw new MesaError(`Envie somente a intenção de movimento (${extra.join(", ")}).`, 400, "client_authority_forbidden");

  const { session, participant } = await authenticate(input.sessionId, input.token);
  if (participant.role !== "player" && participant.role !== "gm") {
    throw new MesaError("Papel sem autorização para movimento.", 403, "not_allowed");
  }
  requireActiveSession(session);
  const resolutionId = `player-move:${requireResolutionId(body.resolutionId)}`;
  const actorCombatantId = typeof body.actorCombatantId === "string" ? body.actorCombatantId.trim() : "";
  if (!actorCombatantId) throw new MesaError("Combatente ausente.", 400, "combatant_not_found");
  // O motor legado truncava metros fracionários. O gateway recebe somente
  // metros inteiros para não aceitar uma intenção diferente da registrada.
  const requestedPosition = body.targetPosition === undefined ? null : normalizeTacticalPosition(body.targetPosition, { x: -1, y: -1 });
  const hasPosition = requestedPosition !== null && requestedPosition.x >= 0 && requestedPosition.y >= 0;
  if (!hasPosition && (typeof body.distance !== "number" || !Number.isSafeInteger(body.distance) || body.distance <= 0)) {
    throw new MesaError("Informe uma distância inteira e positiva em metros.", 400, "invalid_distance");
  }
  const requestedDistance = hasPosition ? null : body.distance as number;
  const combat = await getActiveCombat(session.id);
  if (!combat) throw new MesaError("Nenhum combate ativo.", 409, "combat_not_active");

  // Também antes do replay: um participante que descubra uma resolutionId
  // alheia não pode receber o resultado gravado de outro combatente.
  const owner = (await query(db().from("mesa_combatants").select("session_id,participant_id,kind")
    .eq("id", actorCombatantId).eq("combat_id", combat.id).maybeSingle(),
  "Falha ao consultar combatente")) as Pick<CombatantRow, "session_id" | "participant_id" | "kind"> | null;
  if (!owner || owner.session_id !== session.id) throw new MesaError("Combatente não encontrado.", 404, "combatant_not_found");
  if (participant.role === "player" && owner.participant_id !== participant.id) {
    throw new MesaError("Você não controla este combatente.", 403, "combatant_not_owned");
  }
  if (participant.role === "player" && owner.kind !== "character") {
    throw new MesaError("Movimento de Player exige personagem.", 400, "not_a_player");
  }
  if (participant.role === "gm" && owner.kind !== "enemy" && owner.participant_id !== participant.id) {
    throw new MesaError("O Mestre só pode mover inimigos ou o próprio personagem.", 403, "player_only");
  }

  type MoveResult = { combatantId: string; distance: number; movementRemaining: number; actionsRemaining: number; position: TacticalPosition };
  const replay = (result: MoveResult) => {
    if (result.combatantId !== actorCombatantId || (requestedDistance !== null && result.distance !== requestedDistance) ||
      (hasPosition && JSON.stringify(result.position) !== JSON.stringify(requestedPosition))) {
      throw new MesaError("Esta resolução pertence a outro movimento.", 409, "resolution_conflict");
    }
    return { result, committed: false };
  };
  const previous = await storedAttackResolution<MoveResult>(session.id, resolutionId, combat.id);
  if (previous?.status === "committed" && previous.result) return replay(previous.result);
  if (previous?.status === "failed") throw new MesaError("Esta resolução de movimento falhou.", 409, "resolution_failed");
  if (previous?.status === "processing") {
    return replay(await waitForAttackResolution<MoveResult>(session.id, resolutionId, combat.id));
  }

  const claimRows = (await query(db().rpc("claim_mesa_attack_resolution", {
    p_session_id: session.id, p_combat_id: combat.id, p_resolution_id: resolutionId,
  }), "Falha ao reservar movimento")) as AttackResolutionClaim<MoveResult>[] | null;
  const claim = claimRows?.[0];
  if (!claim) throw new MesaError("Não foi possível reservar o movimento.", 500, "transaction_failed");
  if (!claim.claimed) {
    if (claim.status === "committed" && claim.result) return replay(claim.result);
    if (claim.status === "failed") throw new MesaError("Esta resolução de movimento falhou.", 409, "resolution_failed");
    return replay(await waitForAttackResolution<MoveResult>(session.id, resolutionId, combat.id));
  }

  let applied = false;
  try {
    const row = (await query(db().from("mesa_combatants").select("*")
      .eq("id", actorCombatantId).eq("combat_id", combat.id).maybeSingle(), "Falha ao consultar combatente")) as CombatantRow | null;
    if (!row || row.session_id !== session.id) throw new MesaError("Combatente não encontrado.", 404, "combatant_not_found");
    if (participant.role === "player" && row.participant_id !== participant.id) throw new MesaError("Você não controla este combatente.", 403, "combatant_not_owned");
    if (participant.role === "player" && row.kind !== "character") throw new MesaError("Movimento de Player exige personagem.", 400, "not_a_player");
    if (participant.role === "gm" && row.kind !== "enemy" && row.participant_id !== participant.id) {
      throw new MesaError("O Mestre só pode mover inimigos ou o próprio personagem.", 403, "player_only");
    }
    // Uma nova leitura reduz a janela entre claim e validação; o CAS abaixo
    // protege também o orçamento contra dois movimentos simultâneos.
    const currentCombat = await getActiveCombat(session.id);
    const movement = effectiveMovementForRow(row);
    let sessionMap: { tactical_map?: TacticalMap | null } | null = null;
    try {
      sessionMap = (await query(db().from("mesa_sessions").select("tactical_map").eq("id", session.id).maybeSingle(), "Falha ao consultar escala do mapa")) as { tactical_map?: TacticalMap | null } | null;
    } catch {
      // Compatibilidade durante o rollout: movimentos antigos continuam usando
      // o contrato de metros até a migration do mapa chegar ao ambiente.
      sessionMap = null;
    }
    const map = sanitizeTacticalMap(sessionMap?.tactical_map);
    const currentPosition = normalizeTacticalPosition(row.position, { x: row.kind === "enemy" ? 0.78 : 0.22, y: 0.5 });
    const targetPosition = hasPosition ? requestedPosition as TacticalPosition : currentPosition;
    const distance = hasPosition ? tacticalDistance(currentPosition, targetPosition, map) : requestedDistance as number;
    if (hasPosition && distance <= 0) throw new MesaError("Escolha uma posição diferente.", 400, "invalid_distance");
    if (hasPosition) await ensurePositionAvailable(session.id, combat.id, row.id, targetPosition, map);
    const unconsciousUntilRound = unconsciousUntilRoundForRow(row);
    const validation = resolveAction({
      combatStatus: currentCombat?.status ?? null,
      initiativeStarted: currentCombat?.initiative_started ?? false,
      activeCombatantId: currentCombat?.active_combatant_id ?? null,
      actorRole: participant.role,
      actorOwnsCombatant: true,
      combatant: {
        id: row.id, isDead: row.is_dead, actionsMax: row.actions_max,
         actionsRemaining: row.actions_remaining, movementMax: movement.max,
         movementRemaining: movement.remaining,
         unconsciousUntilRound,
      },
      actionType: "move", meters: distance,
      currentRound: currentCombat?.round,
    });
    if (!validation.ok) throw new MesaError(DENIAL_MESSAGES[validation.reason], 403, validation.reason);

    const economy = applyAction({
      actionsMax: row.actions_max, actionsRemaining: row.actions_remaining,
      movementMax: movement.max, movementRemaining: movement.remaining,
    }, "move", distance);
    const written = (await query(db().from("mesa_combatants")
      .update({ movement_remaining: economy.movementRemaining, ...(hasPosition ? { position: targetPosition } : {}) })
      .eq("id", row.id).eq("combat_id", combat.id)
      .eq("movement_remaining", row.movement_remaining)
      .eq("actions_remaining", row.actions_remaining)
      .eq("is_dead", false)
      .select("id"), "Falha ao registrar movimento")) as Array<{ id: string }> | null;
    if (written?.length !== 1) throw new MesaError("O estado de movimento mudou; atualize a Mesa.", 409, "movement_conflict");
    applied = true;
    const result: MoveResult = {
      combatantId: row.id, distance, movementRemaining: economy.movementRemaining,
      actionsRemaining: economy.actionsRemaining,
      position: targetPosition,
    };
    const stamped = (await query(db().from("mesa_attack_resolutions").update({
      status: "committed", result, committed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("session_id", session.id).eq("combat_id", combat.id).eq("resolution_id", resolutionId)
      .eq("claim_token", claim.claim_token).eq("status", "processing").select("id"),
    "Falha ao confirmar movimento")) as Array<{ id: string }> | null;
    if (stamped?.length !== 1) throw new MesaError("A resolução não foi confirmada.", 500, "transaction_failed");
    // O evento é apresentação. Depois do commit ele não pode transformar um
    // movimento já aplicado em erro para o jogador nem impedir a publicação.
    try {
      await appendEvent(combat.id, { kind: "action", text: `${row.name}: Movimento (${distance}m)` });
    } catch { /* O orçamento/resultado já foram gravados; o estado será publicado. */ }
    return { result, committed: true };
  } catch (error) {
    // Depois do CAS NÃO liberar o claim: um retry não pode aplicar de novo caso
    // o carimbo tenha falhado. Requer recuperação manual/transação para fechar
    // completamente essa janela (GAP documentado).
    if (!applied) {
      try {
        await query(db().rpc("release_mesa_attack_resolution", {
          p_session_id: session.id, p_combat_id: combat.id,
          p_resolution_id: resolutionId, p_claim_token: claim.claim_token,
        }), "Falha ao liberar resolução de movimento");
      } catch { /* Mantém o erro original. */ }
    }
    throw databaseResolutionError(error) ?? error;
  }
}

/** Reload server-authoritative, separado do fluxo de ataque. */
export async function reloadIntegrated(input: {
  sessionId: unknown;
  token: unknown;
  resolutionId: unknown;
  weaponId: unknown;
  actorCombatantId?: unknown;
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
  const requestedActorId = typeof input.actorCombatantId === "string" ? input.actorCombatantId.trim() : "";
  const actorRow = participant.role === "gm" && requestedActorId
    ? rows.find((row) => row.id === requestedActorId)
    : rows.find((row) => row.participant_id === participant.id && row.kind === "character");
  if (!actorRow) throw new MesaError("Ator não encontrado.", 404, "actor_not_found");
  if (actorRow.session_id !== session.id) throw new MesaError("Combatente não encontrado.", 404, "combatant_not_found");
  if (participant.role === "player" && actorRow.kind !== "character") {
    throw new MesaError("Reload de Player exige personagem.", 400, "not_a_player");
  }
  if (participant.role === "gm" && actorRow.kind !== "enemy" && actorRow.participant_id !== participant.id) {
    throw new MesaError("O Mestre só pode controlar inimigos ou o próprio personagem.", 403, "combatant_not_owned");
  }
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
  targetType?: unknown;
  obstacleId?: unknown;
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
  )) as AttackResolutionClaim<IntegratedAttackResponse>[] | null;
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
  const coverAttack = input.targetType === "cover";
  const rows = (await query(
    db().from("mesa_combatants").select("*").eq("combat_id", combat.id),
    "Falha ao consultar os combatentes",
  )) as CombatantRow[];
  const actorRow = rows.find((row) => row.id === actorRowId);
  const targetRow = rows.find((row) => row.id === targetRowId);
  if (!actorRow) throw new MesaError("Ator não encontrado.", 404, "actor_not_found");
  if (coverAttack) {
    const obstacleId = typeof input.obstacleId === "string" ? input.obstacleId.trim() : "";
    if (!obstacleId) throw new MesaError("Cover não informada.", 400, "cover_not_found");
    authorizeCombatAttackActor({ session, participant }, actorRow);
    const coverOutcome = await attackTacticalCover({ input, inputResolutionId: resolutionId, session, participant, combat, rows, actorRow, obstacleId, claimToken });
    committed = coverOutcome.committed;
    return coverOutcome;
  }
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

  // Tactical visibility is an authoritative combat rule: use only persisted
  // combatant positions and the sanitized Tactical Map loaded with the
  // authenticated session. Nothing from the attack request can influence this
  // decision. Cover is currently informational because the project has no
  // approved mechanical Cover modifier; only fully blocked visibility denies.
  const persistedPosition = (value: unknown): TacticalPosition | null => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const point = value as Record<string, unknown>;
    const x = Number(point.x);
    const y = Number(point.y);
    return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  };
  const actorPosition = persistedPosition(actorRow.position);
  const targetPosition = persistedPosition(targetRow.position);
  if (!actorPosition || !targetPosition) {
    throw new MesaError("Não foi possível determinar a posição tática do ataque.", 409, "tactical_position_missing");
  }
  const currentMapRow = (await query(
    db().from("mesa_sessions").select("tactical_map").eq("id", session.id).maybeSingle(),
    "Falha ao consultar a geometria tática",
  )) as { tactical_map?: unknown } | null;
  const currentTacticalMap = sanitizeTacticalMap(currentMapRow?.tactical_map);
  const tacticalCover = calculateTacticalCover(
    actorPosition,
    targetPosition,
    currentTacticalMap.geometry ?? { walls: [], doors: [] },
  );
  if (tacticalCover.lineOfSight === "blocked") {
    throw new MesaError("Linha de visão bloqueada por geometria tática.", 409, "line_of_sight_blocked");
  }

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

  response = { ...response, tacticalCover, actionAfter: economy.actionsRemaining };

  // O texto do evento é a trilha de auditoria também para instalações que só
  // conhecem a coluna `text` (eventos antigos, exportações e a tela do GM).
  // Não recalcula nada: todos os números abaixo vêm do resultado já decidido
  // pelo Combat Engine nesta resolução.
  const attackEventText = formatMesaAttackEvent({
    actorName: actorRow.name,
    targetName: targetRow.name,
    attackResult: response.attackResult,
    tacticalCover: response.tacticalCover,
    weaponDamage: response.weaponDamage,
    damageResult: response.damageResult,
  });

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
       p_event_text: attackEventText,
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

/** Ataque contra Cover: usa a rolagem normal, mas aplica dano somente ao JSON do obstáculo. */
async function attackTacticalCover(input: {
  input: { weaponId?: unknown; skillId?: unknown; attackType?: unknown; attackMode?: unknown; aimedTarget?: unknown };
  inputResolutionId: string;
  session: MesaSession;
  participant: MesaParticipant;
  combat: CombatRow;
  rows: CombatantRow[];
  actorRow: CombatantRow;
  obstacleId: string;
  claimToken: string;
}): Promise<IntegratedAttackOutcome> {
  const currentMapRow = (await query(
    db().from("mesa_sessions").select("tactical_map").eq("id", input.session.id).maybeSingle(),
    "Falha ao consultar a Cover",
  )) as { tactical_map?: unknown } | null;
  const map = sanitizeTacticalMap(currentMapRow?.tactical_map);
  const obstacle = [...(map.geometry?.walls ?? []), ...(map.geometry?.doors ?? [])].find((entry) => entry.id === input.obstacleId);
  if (!obstacle || obstacle.destroyed === true) throw new MesaError("Cover não encontrada ou já destruída.", 404, "cover_not_found");
  if (obstacle.type === "door" && obstacle.state !== "closed") throw new MesaError("Porta aberta não pode ser atacada como Cover.", 409, "cover_not_destructible");
  if (obstacle.coverHP === null || obstacle.coverHP === undefined) throw new MesaError("Cover não possui HP configurado.", 409, "cover_hp_unavailable");
  const coverProfile = deriveTacticalCoverProfile(obstacle.coverMaterial, obstacle.coverThickness);
  const authoritativeCoverDV = coverProfile?.dv ?? obstacle.coverDV;
  if (authoritativeCoverDV === null || authoritativeCoverDV === undefined) throw new MesaError("Cover não possui DV configurado.", 409, "cover_dv_unavailable");

  const persistedPosition = (value: unknown): TacticalPosition | null => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const point = value as Record<string, unknown>;
    const x = Number(point.x);
    const y = Number(point.y);
    return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  };
  const actorPosition = persistedPosition(input.actorRow.position);
  if (!actorPosition) throw new MesaError("Não foi possível determinar a posição tática do ataque.", 409, "tactical_position_missing");
  const coverPoint = { x: (obstacle.start.x + obstacle.end.x) / 2, y: (obstacle.start.y + obstacle.end.y) / 2 };
  // O obstáculo que é o alvo não pode bloquear a própria linha até seu centro;
  // os demais obstáculos continuam sendo avaliados autoritativamente.
  const geometryWithoutTarget = map.geometry
    ? { walls: map.geometry.walls.filter((entry) => entry.id !== obstacle.id), doors: map.geometry.doors.filter((entry) => entry.id !== obstacle.id) }
    : { walls: [], doors: [] };
  if (!calculateLineOfSight(actorPosition, coverPoint, geometryWithoutTarget).visible) {
    throw new MesaError("Linha de visão até a Cover bloqueada.", 409, "line_of_sight_blocked");
  }

  const snapshots = input.rows.map((row) => ({ row, participant: combatParticipantFromRow(row) }));
  if (snapshots.some(({ participant: value }) => !value)) throw new MesaError("Combate sem snapshot server-side completo.", 409, "combat_snapshot_missing");
  const actor = snapshots.find(({ row }) => row.id === input.actorRow.id)?.participant;
  if (!actor) throw new MesaError("Snapshot de combate ausente.", 409, "combat_snapshot_missing");
  const skillId = actor.weapons?.find((weapon) => weapon.id === String(input.input.weaponId ?? ""))?.skill ?? (typeof input.input.skillId === "string" ? input.input.skillId : undefined);
  const attackType = actor.weapons?.find((weapon) => weapon.id === String(input.input.weaponId ?? ""))?.attackType ?? input.input.attackType;
  if (!skillId || !actor.skills?.[skillId]) throw new MesaError("Skill não pertence ao ator.", 400, "skill_not_found");
  if (typeof attackType !== "string") throw new MesaError("Tipo de ataque ausente.", 400, "invalid_attack_type");
  const requestedWeaponId = input.input.weaponId === undefined || input.input.weaponId === null ? undefined : String(input.input.weaponId);
  const targetId = `cover:${input.obstacleId}`;
  const target: CombatParticipant = {
    id: targetId,
    type: "enemy",
    name: "Cover",
    source: { characterId: null, sourceKey: targetId, enemyId: null },
    stats: {},
    skills: {},
    combat: { hp: { current: 1, max: 1 }, armor: { head: 0, body: 0 }, criticalInjuries: [], conditions: [], initiative: null, isDead: false },
  };
  const state: CombatState = {
    id: input.combat.id,
    status: input.combat.status,
    round: input.combat.round,
    initiativeStarted: input.combat.initiative_started,
    activeParticipantId: input.combat.active_combatant_id,
    participants: [...snapshots.map(({ participant: value }) => value as CombatParticipant), target],
  };
  const rawMode = input.input.attackMode;
  if (rawMode !== "normal" && rawMode !== "aimed" && rawMode !== "autofire" && rawMode !== "suppressive") throw new MesaError("Modo de ataque inválido.", 400, "invalid_attack_mode");
  const action: AttackAction = {
    type: "attack", actorId: actor.id, targetId, ...(requestedWeaponId ? { weaponId: requestedWeaponId } : {}), skillId,
    attackType: attackType as AttackAction["attackType"], attackMode: rawMode, defense: { type: "dv", value: authoritativeCoverDV, source: "range_table", reason: "tactical_cover" },
    ...(typeof input.input.aimedTarget === "string" ? { aimedTarget: input.input.aimedTarget as AttackAction["aimedTarget"] } : {}),
  };
  const economyCheck = resolveAction({ combatStatus: input.combat.status, initiativeStarted: input.combat.initiative_started, activeCombatantId: input.combat.active_combatant_id, actorRole: input.participant.role, actorOwnsCombatant: input.actorRow.participant_id === input.participant.id, combatant: { id: input.actorRow.id, isDead: input.actorRow.is_dead, actionsMax: input.actorRow.actions_max, actionsRemaining: input.actorRow.actions_remaining, movementMax: input.actorRow.movement_max, movementRemaining: input.actorRow.movement_remaining }, actionType: "attack", meters: 0 });
  if (!economyCheck.ok) throw new MesaError(DENIAL_MESSAGES[economyCheck.reason], 403, economyCheck.reason);
  const result = execute(state, action, serverRandom);
  if (!result.ok || !result.attackResult) throw new MesaError(result.errors?.[0]?.message ?? "O Combat Engine recusou o ataque.", 400, result.errors?.[0]?.code ?? "engine_refused");
  const ammoChange = result.changes.find((change): change is Extract<(typeof result.changes)[number], { type: "ammo_changed" }> => change.type === "ammo_changed");
  const ammoAfter = requestedWeaponId ? result.state.participants.find((value) => value.id === actor.id)?.weapons?.find((value) => value.id === requestedWeaponId)?.ammo : undefined;
  let damage = 0;
  if (result.attackResult.hit) {
    const damageRoll = rollWeaponDamage(actor, result.attackResult, serverRandom);
    if (!damageRoll.ok) throw new MesaError(damageRoll.error.message, 400, damageRoll.error.code);
    damage = damageRoll.roll.total;
  }
  const hpBefore = obstacle.coverHP;
  const coverDamage = applyTacticalCoverDamage(hpBefore, damage);
  const hpAfter = coverDamage.hpAfter;
  const response: IntegratedAttackResponse = { attackResult: result.attackResult, ammoAfter, tacticalCover: { status: "clear", lineOfSight: "clear", covered: false, blockedSamples: 0, totalSamples: 0 }, coverDamage: { obstacleId: input.obstacleId, hpBefore, hpAfter, damage, destroyed: coverDamage.destroyed } };
  const economy = applyAction({ actionsMax: input.actorRow.actions_max, actionsRemaining: input.actorRow.actions_remaining, movementMax: input.actorRow.movement_max, movementRemaining: input.actorRow.movement_remaining }, "attack", 0);
  const eventText = [
    `${input.actorRow.name} → Cover: ataque ${result.attackResult.total} vs DV ${result.attackResult.defenseValue}`,
    result.attackResult.hit ? "ACERTOU" : "ERROU",
    result.attackResult.hit ? (hpAfter === 0 ? "Cover destruída" : `Cover: ${hpBefore} → ${hpAfter} HP`) : "",
  ].filter(Boolean).join(" · ");
  const committed = (await query(db().rpc("commit_mesa_attack_cover_resolution", { p_session_id: input.session.id, p_combat_id: input.combat.id, p_resolution_id: input.inputResolutionId, p_claim_token: input.claimToken, p_actor_id: actor.id, p_actions_before: input.actorRow.actions_remaining, p_actions_after: economy.actionsRemaining, p_ammo_before: input.actorRow.combat_ammo ?? null, p_ammo_after: ammoChange?.weaponId ? { ...(input.actorRow.combat_ammo ?? {}), [ammoChange.weaponId]: ammoChange.after } : input.actorRow.combat_ammo ?? null, p_obstacle_id: input.obstacleId, p_hp_before: hpBefore, p_hp_after: hpAfter, p_destroyed: hpAfter === 0, p_result: { ...response, actionAfter: economy.actionsRemaining }, p_event_text: eventText }), "Falha ao confirmar dano da Cover")) as IntegratedAttackResponse | null;
  if (!committed) throw new MesaError("A resolução não retornou resultado persistido.", 500, "transaction_failed");
  return { result: committed, committed: true };
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
  resolutionId?: unknown;
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

  const resolutionId = participant.role === "player"
    ? requireResolutionId(input.resolutionId)
    : null;

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
    const currentCombat = await getActiveCombat(session.id);
    const result = resolveAction({
      combatStatus: currentCombat?.status ?? null,
      initiativeStarted: currentCombat?.initiative_started ?? false,
      activeCombatantId: currentCombat?.active_combatant_id ?? null,
      actorRole: participant.role,
      actorOwnsCombatant: true,
      combatant: { id: target.id, isDead: target.is_dead, ...economy },
      actionType,
      meters: 0,
    });

    if (result.ok) {
      const next = applyAction(economy, actionType, 0);
      const written = (await query(
        db().from("mesa_combatants").update({ actions_remaining: next.actionsRemaining })
          .eq("id", target.id)
          .eq("actions_remaining", target.actions_remaining)
          .eq("movement_remaining", target.movement_remaining)
          .eq("is_dead", false)
          .select("id"),
        "Falha ao consumir a ação",
      )) as Array<{ id: string }> | null;
      if (!written || written.length !== 1) throw new MesaError("O estado do turno mudou; atualize a Mesa.", 409, "action_conflict");
      debited = true;
    } else {
      denial = result.reason;
    }
  }

  const actor = target?.name ?? participant.displayName;
  const note = actionType && !debited ? rollDenialNote(denial) : "";
  const eventText = participant.role === "player"
    ? formatPlayerRollEvent(actor, roll, note)
    : formatRollEvent(actor, roll, note);
  const eventResolutionId = resolutionId ? `player-roll:${resolutionId}` : undefined;
  if (eventResolutionId) {
    const existing = (await query(
      db().from("mesa_combats").select("event_log").eq("id", combat.id).maybeSingle(),
      "Falha ao consultar o histórico do combate",
    )) as { event_log: MesaEvent[] | null } | null;
    const prior = (Array.isArray(existing?.event_log) ? existing.event_log : [])
      .find((event) => event.resolutionId === eventResolutionId);
    if (prior) {
      if (prior.text !== eventText) throw new MesaError("Esta resolução de rolagem pertence a outra intenção.", 409, "resolution_conflict");
      return { registered: true, debited: !note };
    }
  }
  await appendEvent(
    combat.id,
    {
      kind: "roll",
      text: eventText,
      roll: {
        type: roll.type,
        label: roll.label,
        expression: roll.expression,
        total: roll.total,
        rolls: roll.rolls,
      },
      ...(eventResolutionId ? { resolutionId: eventResolutionId } : {}),
    },
  );

  return { registered: true, debited };
}

/** Finaliza o turno atual (somente GM; Player apenas solicita ações). */
export async function endTurn(input: { sessionId: unknown; token: unknown }): Promise<void> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  requireGM({ session, participant });

  const combat = await getActiveCombat(session.id);
  if (!combat) throw new MesaError("Nenhum combate ativo.", 409, "combat_not_active");
  if (!combat.initiative_started || !combat.active_combatant_id) {
    throw new MesaError("Nenhum turno em andamento.", 409, "no_active_turn");
  }

  const active = (await query(
    db().from("mesa_combatants").select("*").eq("id", combat.active_combatant_id).maybeSingle(),
    "Falha ao consultar o combatente",
  )) as CombatantRow | null;

  if (!active) throw new MesaError("Combatente ativo não encontrado.", 409, "turn_conflict");

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

// ---------------------------------------------------------------------------
// F1.13.1 — Player Inventory Authority: consumo atômico de item
// ---------------------------------------------------------------------------

/**
 * F1.13.1 — consumo atômico de item na Mesa.
 *
 * Caminho server-authoritative: o cliente envia a INTENÇÃO
 * (actorCombatantId, itemId, amount, resolutionId). O servidor:
 *   • valida token / sessão / combate / combatent / dono / ação;
 *   • lê `supplies.inventory` da linha da Mesa;
 *   • decrementa a quantidade;
 *   • persiste via claim/commit com CAS em `supplies`
 *     (dois requests concorrentes nunca consomem a mesma unidade);
 *   • registra evento e publica o estado.
 *
 * Nunca aceita do cliente: quantidade final, inventory, supplies,
 * HP, armor ou qualquer snapshot autoritativo.
 */

const ITEM_CONSUME_RESOLUTION_PREFIX = "item-consume:";

async function storedItemConsumeResolution<T = ConsumeItemResponse>(
  sessionId: string,
  resolutionId: string,
  combatId: string,
) {
  return (await query(
    db()
      .from("mesa_item_consume_resolutions")
      .select("*")
      .eq("session_id", sessionId)
      .eq("combat_id", combatId)
      .eq("resolution_id", resolutionId)
      .maybeSingle(),
    "Falha ao consultar a resolução do consumo",
  )) as { status: string; result: T } | null;
}

async function waitForItemConsumeResolution<T = ConsumeItemResponse>(
  sessionId: string,
  resolutionId: string,
  combatId: string,
): Promise<T> {
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((r) => setTimeout(r, 200));
    const row = await storedItemConsumeResolution<T>(sessionId, resolutionId, combatId);
    if (row?.status === "committed" && row.result) return row.result;
    if (row?.status === "failed") {
      throw new MesaError("A resolução deste consumo falhou antes do commit; não será reexecutada.", 409, "resolution_failed");
    }
  }
  throw new MesaError("A resolução do consumo continua em processamento.", 409, "resolution_in_progress");
}

export interface ConsumeItemResponse {
  combatantId: string;
  /** ID estável do item consumido (f1.13.2). */
  itemId: string;
  itemName: string;
  quantityBefore: number;
  quantityAfter: number;
  consumed: number;
  actionsBefore: number;
  actionsAfter: number;
}

export async function consumeItemIntegrated(input: {
  sessionId: unknown;
  token: unknown;
  combatantId: unknown;
  itemId: unknown;
  amount: unknown;
  resolutionId: unknown;
}): Promise<{ result: ConsumeItemResponse; committed: boolean }> {
  const { session, participant } = await authenticate(input.sessionId, input.token);
  const resolutionId = `${ITEM_CONSUME_RESOLUTION_PREFIX}${requireResolutionId(input.resolutionId)}`;
  const combatantId = typeof input.combatantId === "string" ? input.combatantId.trim() : "";
  const itemId = typeof input.itemId === "string" ? input.itemId.trim() : "";
  const amount = typeof input.amount === "number" ? input.amount : Number.NaN;
  if (!combatantId || !itemId) throw new MesaError("Dados do consumo inválidos.", 400, "invalid_action");
  // Quantidade é intenção do cliente: só aceitamos inteiro positivo.
  // O resultado final (estoque após o consumo) é sempre do servidor.
  if (!Number.isInteger(amount) || amount <= 0) throw new MesaError("Quantidade inválida.", 400, "invalid_action");

  const combat = await getActiveCombat(session.id);
  if (!combat) throw new MesaError("Nenhum combate ativo.", 409, "combat_not_active");

  const previous = await storedItemConsumeResolution<ConsumeItemResponse>(session.id, resolutionId, combat.id);
  if (previous?.status === "committed" && previous.result) return { result: previous.result, committed: false };
  if (previous?.status === "failed") {
    throw new MesaError("A resolução deste consumo falhou antes do commit; não será reexecutada.", 409, "resolution_failed");
  }
  if (previous?.status === "processing") {
    return { result: await waitForItemConsumeResolution<ConsumeItemResponse>(session.id, resolutionId, combat.id), committed: false };
  }

  const rows = (await query(
    db().from("mesa_combatants").select("*").eq("combat_id", combat.id),
    "Falha ao consultar os combatentes",
  )) as CombatantRow[];
  const actorRow = rows.find((row) => row.id === combatantId);
  if (!actorRow) throw new MesaError("Combatente não encontrado.", 404, "combatant_not_found");
  if (actorRow.session_id !== session.id) throw new MesaError("Combatente não encontrado.", 404, "combatant_not_found");
  if (participant.role === "player" && actorRow.participant_id !== participant.id) throw new MesaError("Você não pode controlar este combatente.", 403, "combatant_not_owned");
  if (participant.role === "player" && actorRow.kind !== "character") throw new MesaError("Consumo de item só é permitido em personagens.", 400, "not_a_player");
  if (participant.role === "gm" && actorRow.kind !== "enemy" && actorRow.participant_id !== participant.id) {
    throw new MesaError("O Mestre só pode controlar inimigos ou o próprio personagem.", 403, "combatant_not_owned");
  }

  const actionCheck = resolveAction({
    combatStatus: combat.status,
    initiativeStarted: combat.initiative_started,
    activeCombatantId: combat.active_combatant_id,
    actorRole: participant.role,
    actorOwnsCombatant: actorRow.participant_id === participant.id,
    combatant: { id: actorRow.id, isDead: actorRow.is_dead, actionsMax: actorRow.actions_max, actionsRemaining: actorRow.actions_remaining, movementMax: actorRow.movement_max, movementRemaining: actorRow.movement_remaining },
    actionType: "item",
  });
  if (!actionCheck.ok) throw new MesaError(DENIAL_MESSAGES[actionCheck.reason], 403, actionCheck.reason);
  if (actorRow.is_dead) throw new MesaError("Ator derrotado.", 403, "combatant_defeated");

  const suppliesBefore: MesaSupplies = actorRow.supplies ?? { inventory: [] };
  const inventory = suppliesBefore.inventory ?? [];
  // F1.13.2 — a procura é pelo ID ESTÁVEL, nunca pelo rótulo exibido.
  const rawEntry = findSupplyEntry(inventory, itemId);
  if (!rawEntry) throw new MesaError("Item não está na mochila do combate.", 400, "item_not_found");
  // Escrita SEMPRE passa pela normalização: pilhas duplicadas do mesmo id são
  // somadas e as entradas legadas ganham o `itemId`.
  const normalizedInventory = normalizeSupplyInventory(inventory);
  const entry = findSupplyEntry(normalizedInventory, itemId);
  if (!entry) throw new MesaError("Quantidade insuficiente na mochila.", 400, "insufficient_quantity");
  if (entry.quantity < amount) throw new MesaError("Quantidade insuficiente na mochila.", 400, "insufficient_quantity");

  const quantityAfter = entry.quantity - amount;
  const suppliesAfter: MesaSupplies = {
    ...suppliesBefore,
    inventory: quantityAfter > 0
      ? normalizedInventory.map((i) => (resolveSupplyItemId(i) === itemId ? { ...i, quantity: quantityAfter } : i))
      : normalizedInventory.filter((i) => resolveSupplyItemId(i) !== itemId),
  };
  const actionsAfter = actorRow.actions_remaining - actionCheck.cost;
  const result: ConsumeItemResponse = {
    combatantId: actorRow.id,
    itemId,
    itemName: entry.item,
    quantityBefore: entry.quantity,
    quantityAfter,
    consumed: amount,
    actionsBefore: actorRow.actions_remaining,
    actionsAfter,
  };

  const claimRows = (await query(
    db().rpc("claim_mesa_item_consume_resolution", {
      p_session_id: session.id, p_combat_id: combat.id, p_resolution_id: resolutionId,
    }),
    "Falha ao reservar a resolução do consumo",
  )) as Array<{ claimed: boolean; status: string; claim_token: string; result: ConsumeItemResponse }> | null;
  const claim = claimRows?.[0];
  if (!claim) throw new MesaError("Não foi possível reservar a resolução do consumo.", 500, "transaction_failed");
  if (!claim.claimed) {
    if (claim.status === "committed" && claim.result) return { result: claim.result, committed: false };
    if (claim.status === "failed") throw new MesaError("A resolução deste consumo falhou antes do commit; não será reexecutada.", 409, "resolution_failed");
    return { result: await waitForItemConsumeResolution<ConsumeItemResponse>(session.id, resolutionId, combat.id), committed: false };
  }
  const claimToken = claim.claim_token;
  let committed = false;
  try {
    const committedResult = (await query(
      db().rpc("commit_mesa_item_consume_resolution", {
        p_session_id: session.id, p_combat_id: combat.id, p_resolution_id: resolutionId,
        p_claim_token: claimToken, p_actor_id: actorRow.id,
        p_actions_before: actorRow.actions_remaining, p_actions_after: actionsAfter,
        p_supplies_before: actorRow.supplies ?? null, p_supplies_after: suppliesAfter,
        p_item_name: entry.item, p_amount: amount,
        p_result: result,
        p_event_text: `${actorRow.name}: consumiu ${amount}× ${entry.item} (${quantityAfter} restante)`,
      }),
      "Falha ao confirmar a resolução do consumo",
    )) as ConsumeItemResponse | null;
    if (!committedResult) throw new MesaError("A resolução não retornou resultado persistido.", 500, "transaction_failed");
    committed = true;
    return { result: committedResult, committed: true };
  } catch (error) {
    if (!committed) {
      try {
        await query(
          db().rpc("release_mesa_item_consume_resolution", {
            p_session_id: session.id, p_combat_id: combat.id, p_resolution_id: resolutionId, p_claim_token: claimToken,
          }),
          "Falha ao liberar a resolução do consumo",
        );
      } catch {}
    }
    if (error instanceof Error) {
      const code = ["consumption_conflict", "consumption_not_active", "not_your_turn", "resolution_in_progress"].find((c) =>
        error.message.includes(c),
      );
      if (code) throw new MesaError("A resolução concorrente não pôde ser aplicada.", 409, code);
    }
    throw error;
  }
}

/**
 * F1.13.2 — **uso atômico de item de cura** na Mesa.
 *
 *     validar → consumir → calcular cura → aplicar HP → evento → commit
 *
 * Tudo numa ÚNICA resolução (`mesa_item_consume_resolutions` + a RPC
 * `commit_mesa_item_heal_resolution`, que debita Action, decrementa o item e
 * escreve o HP numa linha só, com CAS nos três campos). Se qualquer etapa
 * falhar, nada muda: sem item consumido, sem HP, sem Action e sem evento — e a
 * resolução não fica `committed`.
 *
 * Intenção enviada pelo cliente: `{ resolutionId, actorCombatantId, itemId }`.
 * Nunca aceitamos do cliente: quantidade final, cura final, HP final,
 * inventory/supplies finais ou qualquer snapshot autoritativo.
 *
 * A regra de HP é a MESMA do Healing Gateway (`clampHealing`), e o valor do
 * item vem da MESMA regra que o resto do sistema já usa
 * (`getSupplyHealAmount`) — nada de segunda implementação de cura.
 */

const ITEM_HEAL_RESOLUTION_PREFIX = "item-heal:";

/**
 * Além dos campos de resultado genéricos (`assertIntentOnly`), o corpo deste
 * endpoint também recusa qualquer coisa que pareça com o ESTADO final da
 * mochila/economia — o contrato de intenção é só
 * `{ resolutionId, actorCombatantId, itemId }`.
 */
const ITEM_HEAL_FORBIDDEN_FIELDS = [
  "quantity",
  "quantityAfter",
  "finalQuantity",
  "restored",
  "healAmount",
  "inventory",
  "supplies",
  "actionsAfter",
  "committed",
];

export interface UseItemHealResponse {
  combatantId: string;
  itemId: string;
  itemName: string;
  quantityBefore: number;
  quantityAfter: number;
  hpBefore: number;
  hpAfter: number;
  hpMax: number;
  /** HP efetivamente devolvido (servidor). */
  restored: number;
  actionsBefore: number;
  actionsAfter: number;
}

export async function applyItemHealIntegrated(input: {
  sessionId: unknown;
  token: unknown;
  /** Corpo cru da intenção: campos de resultado são recusados. */
  body: unknown;
}): Promise<{ result: UseItemHealResponse; committed: boolean }> {
  assertIntentOnly(input.body, "healing");
  const body: Record<string, unknown> =
    typeof input.body === "object" && input.body !== null && !Array.isArray(input.body)
      ? (input.body as Record<string, unknown>)
      : {};
  const forbidden = ITEM_HEAL_FORBIDDEN_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(body, field),
  );

  if (forbidden.length > 0) {
    throw new MesaError(
      `O servidor não aceita autoridade de resultado do cliente (${forbidden.join(", ")}). ` +
        "Envie só a intenção: a mochila, o HP e as Actions são resolvidos aqui.",
      400,
      "client_authority_forbidden",
    );
  }

  const { session, participant } = await authenticate(input.sessionId, input.token);
  const resolutionId = `${ITEM_HEAL_RESOLUTION_PREFIX}${requireResolutionId(body.resolutionId)}`;
  const combatantId = typeof body.actorCombatantId === "string" ? body.actorCombatantId.trim() : "";
  const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
  if (!combatantId || !itemId) throw new MesaError("Dados do uso de item inválidos.", 400, "invalid_action");

  const combat = await getActiveCombat(session.id);
  if (!combat) throw new MesaError("Nenhum combate ativo.", 409, "combat_not_active");

  const previous = await storedItemConsumeResolution<UseItemHealResponse>(session.id, resolutionId, combat.id);
  if (previous?.status === "committed" && previous.result) return { result: previous.result, committed: false };
  if (previous?.status === "failed") {
    throw new MesaError("A resolução deste uso falhou antes do commit; não será reexecutada.", 409, "resolution_failed");
  }
  if (previous?.status === "processing") {
    return {
      result: await waitForItemConsumeResolution<UseItemHealResponse>(session.id, resolutionId, combat.id),
      committed: false,
    };
  }

  const rows = (await query(
    db().from("mesa_combatants").select("*").eq("combat_id", combat.id),
    "Falha ao consultar os combatentes",
  )) as CombatantRow[];
  const actorRow = rows.find((row) => row.id === combatantId);
  if (!actorRow) throw new MesaError("Combatente não encontrado.", 404, "combatant_not_found");
  if (actorRow.session_id !== session.id) throw new MesaError("Combatente não encontrado.", 404, "combatant_not_found");
  if (participant.role === "player" && actorRow.participant_id !== participant.id) throw new MesaError("Você não pode controlar este combatente.", 403, "combatant_not_owned");
  if (participant.role === "player" && actorRow.kind !== "character") throw new MesaError("Uso de item só é permitido em personagens.", 400, "not_a_player");
  if (participant.role === "gm" && actorRow.kind !== "enemy" && actorRow.participant_id !== participant.id) {
    throw new MesaError("O Mestre só pode controlar inimigos ou o próprio personagem.", 403, "combatant_not_owned");
  }

  const actionCheck = resolveAction({
    combatStatus: combat.status,
    initiativeStarted: combat.initiative_started,
    activeCombatantId: combat.active_combatant_id,
    actorRole: participant.role,
    actorOwnsCombatant: actorRow.participant_id === participant.id,
    combatant: { id: actorRow.id, isDead: actorRow.is_dead, actionsMax: actorRow.actions_max, actionsRemaining: actorRow.actions_remaining, movementMax: actorRow.movement_max, movementRemaining: actorRow.movement_remaining },
    actionType: "item",
  });
  if (!actionCheck.ok) throw new MesaError(DENIAL_MESSAGES[actionCheck.reason], 403, actionCheck.reason);
  if (actorRow.is_dead) throw new MesaError("Ator derrotado.", 403, "combatant_defeated");

  /* -------------------------- 6. localizar o item -------------------------- */
  const suppliesBefore: MesaSupplies = actorRow.supplies ?? { inventory: [] };
  const inventory = suppliesBefore.inventory ?? [];
  if (!findSupplyEntry(inventory, itemId)) {
    throw new MesaError("Item não está na mochila do combate.", 400, "item_not_found");
  }
  const normalizedInventory = normalizeSupplyInventory(inventory);
  const entry = findSupplyEntry(normalizedInventory, itemId);
  if (!entry) throw new MesaError("Quantidade insuficiente na mochila.", 400, "insufficient_quantity");
  if (entry.quantity < 1) throw new MesaError("Quantidade insuficiente na mochila.", 400, "insufficient_quantity");

  /* ------------------- 7/8. item utilizável + regra de cura ---------------- */
  const healAmount = getSupplyHealAmount(entry.item);
  if (healAmount === null) {
    throw new MesaError("Este item não restaura HP no sistema.", 400, "item_not_healing");
  }
  const hpBefore = actorRow.hp_current;
  const hpMax = actorRow.hp_max;
  // No teto (ou sem teto cadastrado) não há nada a curar: consumir aqui seria
  // jogar o item fora. Mesma recusa do `applyParticipantHealingItem`.
  if (hpBefore >= hpMax) throw new MesaError("Combatente já está com HP máximo.", 409, "already_full_hp");

  const hpAfter = clampHealing(hpBefore, hpMax, healAmount);
  const restored = hpAfter - hpBefore;

  /* ------------------------ 9. consumir + preparar ------------------------- */
  const quantityAfter = entry.quantity - 1;
  const suppliesAfter: MesaSupplies = {
    ...suppliesBefore,
    inventory: quantityAfter > 0
      ? normalizedInventory.map((i) => (resolveSupplyItemId(i) === itemId ? { ...i, quantity: quantityAfter } : i))
      : normalizedInventory.filter((i) => resolveSupplyItemId(i) !== itemId),
  };
  const actionsAfter = actorRow.actions_remaining - actionCheck.cost;
  const result: UseItemHealResponse = {
    combatantId: actorRow.id,
    itemId,
    itemName: entry.item,
    quantityBefore: entry.quantity,
    quantityAfter,
    hpBefore,
    hpAfter,
    hpMax,
    restored,
    actionsBefore: actorRow.actions_remaining,
    actionsAfter,
  };

  /* ------------------------ 12. claim + commit único ---------------------- */
  const claimRows = (await query(
    db().rpc("claim_mesa_item_consume_resolution", {
      p_session_id: session.id, p_combat_id: combat.id, p_resolution_id: resolutionId,
    }),
    "Falha ao reservar a resolução do uso de item",
  )) as Array<{ claimed: boolean; status: string; claim_token: string; result: UseItemHealResponse }> | null;
  const claim = claimRows?.[0];
  if (!claim) throw new MesaError("Não foi possível reservar a resolução do uso de item.", 500, "transaction_failed");
  if (!claim.claimed) {
    if (claim.status === "committed" && claim.result) return { result: claim.result, committed: false };
    if (claim.status === "failed") throw new MesaError("A resolução deste uso falhou antes do commit; não será reexecutada.", 409, "resolution_failed");
    return {
      result: await waitForItemConsumeResolution<UseItemHealResponse>(session.id, resolutionId, combat.id),
      committed: false,
    };
  }
  const claimToken = claim.claim_token;
  let committed = false;
  try {
    const committedResult = (await query(
      db().rpc("commit_mesa_item_heal_resolution", {
        p_session_id: session.id, p_combat_id: combat.id, p_resolution_id: resolutionId,
        p_claim_token: claimToken, p_actor_id: actorRow.id,
        p_actions_before: actorRow.actions_remaining, p_actions_after: actionsAfter,
        p_supplies_before: actorRow.supplies ?? null, p_supplies_after: suppliesAfter,
        p_hp_before: hpBefore, p_hp_after: hpAfter,
        p_item_name: entry.item, p_amount: healAmount,
        p_result: result,
        p_event_text: `${actorRow.name}: usou ${entry.item} → +${restored} HP (${hpAfter}/${hpMax}); ${quantityAfter} restante`,
      }),
      "Falha ao confirmar a resolução do uso de item",
    )) as UseItemHealResponse | null;
    if (!committedResult) throw new MesaError("A resolução não retornou resultado persistido.", 500, "transaction_failed");
    committed = true;
    return { result: committedResult, committed: true };
  } catch (error) {
    if (!committed) {
      try {
        await query(
          db().rpc("release_mesa_item_consume_resolution", {
            p_session_id: session.id, p_combat_id: combat.id, p_resolution_id: resolutionId, p_claim_token: claimToken,
          }),
          "Falha ao liberar a resolução do uso de item",
        );
      } catch {}
    }
    if (error instanceof Error) {
      const code = ["consumption_conflict", "consumption_not_active", "not_your_turn", "resolution_in_progress"].find((c) =>
        error.message.includes(c),
      );
      if (code) throw new MesaError("A resolução concorrente não pôde ser aplicada.", 409, code);
    }
    throw error;
  }
}

// Mensagens/labels vêm de `messages.ts` (módulo puro, compartilhado com a UI).
export { DENIAL_MESSAGES, ACTION_LABELS } from "@/lib/mesa/messages";

/** Mensagem amigável para qualquer erro de mesa. */
export function messageForError(error: unknown): string {
  if (error instanceof MesaError) return error.message;
  if (error instanceof DatabaseQueryError) return "Falha de comunicação com o servidor. Tente novamente.";
  return "Erro inesperado. Tente novamente.";
}
