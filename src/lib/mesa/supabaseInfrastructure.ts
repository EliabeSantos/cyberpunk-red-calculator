/** Implementações Supabase dos contratos incrementais da infraestrutura. */
import type { SupabaseClient } from "@supabase/supabase-js";

import { DatabaseQueryError, getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { publishMesaState } from "@/lib/mesa/realtimeServer";
import { subscribeMesaState, type MesaSubscription } from "@/lib/mesa/realtime";
import type {
  CombatantRowPayload,
  CombatantScope,
  CombatantActionDebit,
  CombatantHpWrite,
  MesaEventSubscription,
  MesaEventTransport,
  MesaInvalidation,
  CombatantWrite,
  MesaCombatRecord,
  MesaCombatCreate,
  MesaBattleCreate,
  MesaBattleRecord,
  MesaCombatantRecord,
  MesaCharacterRecord,
  MesaCharacterUpsert,
  MesaParticipantCreate,
  MesaParticipantRecord,
  MesaSessionCreate,
  MesaRepository,
  MesaSessionRecord,
  ToolkitRecord,
  ToolkitRecordKind,
  ToolkitRecordWrite,
  ToolkitRepository,
  ResolutionClaim,
  ResolutionCommit,
  MoveResolutionCommitResult,
  ResolutionKey,
  ResolutionLookupKey,
  ResolutionRecord,
  ResolutionRecoveryRecord,
  ResolutionStore,
} from "@/lib/mesa/infrastructure";

type SupabaseError = { message: string } | null;

async function result<T>(
  request: PromiseLike<{ data: T | null; error: SupabaseError }>,
  context: string,
): Promise<T | null> {
  const response = await request;
  if (response.error) throw new DatabaseQueryError(`${context}: ${response.error.message}`);
  return response.data;
}

/** Adapter inicial. Reutiliza o cliente memoizado e validado já existente. */
export class SupabaseMesaRepository implements MesaRepository, ToolkitRepository {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient = getSupabaseAdmin()) {
    this.client = client;
  }

  findSessionById(sessionId: string): Promise<MesaSessionRecord | null> {
    return result(
      this.client.from("mesa_sessions").select("*").eq("id", sessionId).maybeSingle(),
      "Falha ao consultar a mesa",
    ) as Promise<MesaSessionRecord | null>;
  }

  async findSessionNetArchitectures(sessionId: string): Promise<unknown | null> {
    const row = await result(
      this.client.from("mesa_sessions").select("net_architectures").eq("id", sessionId).maybeSingle(),
      "Falha ao consultar a Architecture",
    ) as { net_architectures?: unknown } | null;
    return row?.net_architectures ?? null;
  }

  updateSessionNetArchitectures(sessionId: string, architectures: unknown, expected?: unknown): Promise<MesaSessionRecord[]> {
    let request = this.client.from("mesa_sessions").update({ net_architectures: architectures, updated_at: new Date().toISOString() }).eq("id", sessionId);
    if (expected !== undefined) request = request.eq("net_architectures", typeof expected === "object" ? JSON.stringify(expected) : expected);
    return result(
      request.select("*"),
      "Falha ao atualizar a Architecture",
    ) as Promise<MesaSessionRecord[]>;
  }

  findSessionByJoinCode(joinCode: string): Promise<MesaSessionRecord | null> {
    return result(
      this.client.from("mesa_sessions").select("*").eq("join_code", joinCode).maybeSingle(),
      "Falha ao consultar a mesa",
    ) as Promise<MesaSessionRecord | null>;
  }

  createSession(input: MesaSessionCreate): Promise<MesaSessionRecord> {
    return result(
      this.client.from("mesa_sessions").insert({ name: input.name, join_code: input.joinCode, status: input.status }).select("*").single(),
      "Falha ao criar a mesa",
    ) as Promise<MesaSessionRecord>;
  }

  updateSession(sessionId: string, patch: Readonly<Record<string, unknown>>, expected: Readonly<Record<string, unknown>> = {}): Promise<MesaSessionRecord[]> {
    let request = this.client.from("mesa_sessions").update(patch).eq("id", sessionId);
    for (const [name, value] of Object.entries(expected)) {
      request = value === null ? request.is(name, null) : request.eq(name, typeof value === "object" ? JSON.stringify(value) : value);
    }
    return result(
      request.select("*"),
      "Falha ao atualizar a mesa",
    ) as Promise<MesaSessionRecord[]>;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await result(this.client.from("mesa_sessions").delete().eq("id", sessionId), "Falha ao remover a mesa");
  }

  findParticipantByToken(sessionId: string, playerToken: string): Promise<MesaParticipantRecord | null> {
    return result(
      this.client
        .from("mesa_participants")
        .select("*")
        .eq("session_id", sessionId)
        .eq("player_token", playerToken)
        .maybeSingle(),
      "Falha ao consultar o participante",
    ) as Promise<MesaParticipantRecord | null>;
  }

  async listParticipantsBySession(sessionId: string): Promise<MesaParticipantRecord[]> {
    const rows = await result(
      this.client.from("mesa_participants").select("*").eq("session_id", sessionId).order("created_at"),
      "Falha ao consultar participantes",
    );
    return (rows ?? []) as MesaParticipantRecord[];
  }

  createParticipant(input: MesaParticipantCreate): Promise<MesaParticipantRecord> {
    return result(
      this.client.from("mesa_participants").insert({
        session_id: input.sessionId,
        player_token: input.playerToken,
        display_name: input.displayName,
        role: input.role,
      }).select("*").single(),
      "Falha ao criar o participante",
    ) as Promise<MesaParticipantRecord>;
  }

  insertParticipant(input: MesaParticipantCreate): Promise<MesaParticipantRecord> {
    return this.createParticipant(input);
  }

  updateParticipant(participantId: string, sessionId: string, patch: Readonly<Record<string, unknown>>): Promise<MesaParticipantRecord[]> {
    return result(
      this.client.from("mesa_participants").update(patch).eq("id", participantId).eq("session_id", sessionId).select("*"),
      "Falha ao atualizar o participante",
    ) as Promise<MesaParticipantRecord[]>;
  }

  async deleteParticipant(participantId: string, sessionId: string): Promise<void> {
    await result(this.client.from("mesa_participants").delete().eq("id", participantId).eq("session_id", sessionId), "Falha ao sair da mesa");
  }

  findCharacterById(characterId: string): Promise<MesaCharacterRecord | null> {
    return result(
      this.client.from("mesa_characters").select("*").eq("id", characterId).maybeSingle(),
      "Falha ao consultar o personagem",
    ) as Promise<MesaCharacterRecord | null>;
  }

  upsertCharacter(input: MesaCharacterUpsert): Promise<MesaCharacterRecord> {
    return result(
      this.client.from("mesa_characters").upsert({
        id: input.id,
        owner_token: input.ownerToken,
        display_name: input.displayName,
        sheet: input.sheet,
        updated_at: input.updatedAt,
      }, { onConflict: "id" }).select("*").single(),
      "Falha ao salvar a ficha",
    ) as Promise<MesaCharacterRecord>;
  }

  async listToolkitRecords(ownerToken: string, kind: ToolkitRecordKind): Promise<ToolkitRecord[]> {
    return (await result(
      this.client.from("mesa_toolkit_records").select("*").eq("owner_token", ownerToken).eq("kind", kind).order("updated_at", { ascending: false }),
      "Falha ao listar dados do toolkit",
    ) ?? []) as ToolkitRecord[];
  }

  findToolkitRecord(id: string, ownerToken: string, kind: ToolkitRecordKind): Promise<ToolkitRecord | null> {
    return result(
      this.client.from("mesa_toolkit_records").select("*").eq("id", id).eq("owner_token", ownerToken).eq("kind", kind).maybeSingle(),
      "Falha ao consultar dado do toolkit",
    ) as Promise<ToolkitRecord | null>;
  }

  async upsertToolkitRecord(input: ToolkitRecordWrite): Promise<ToolkitRecord> {
    if (input.expectedVersion !== undefined) {
      const row = await result(this.client.from("mesa_toolkit_records").update({ name: input.name, payload: input.payload })
        .eq("id", input.id).eq("owner_token", input.ownerToken).eq("kind", input.kind).eq("version", input.expectedVersion).select("*").single(),
        "Falha ao salvar dado do toolkit",
      );
      if (!row) throw new DatabaseQueryError("Falha ao salvar dado do toolkit: versão obsoleta ou registro não encontrado");
      return row as ToolkitRecord;
    }
    const row = await result(this.client.from("mesa_toolkit_records").upsert({
      id: input.id, owner_token: input.ownerToken, kind: input.kind, name: input.name,
      payload: input.payload,
    }, { onConflict: "id", ignoreDuplicates: false }).select("*").single(), "Falha ao salvar dado do toolkit");
    if (!row) throw new DatabaseQueryError("Falha ao salvar dado do toolkit: versão obsoleta ou registro não encontrado");
    return row as ToolkitRecord;
  }

  async deleteToolkitRecord(id: string, ownerToken: string, kind: ToolkitRecordKind): Promise<void> {
    await result(this.client.from("mesa_toolkit_records").delete().eq("id", id).eq("owner_token", ownerToken).eq("kind", kind), "Falha ao remover dado do toolkit");
  }

  findCombatBySession(sessionId: string): Promise<MesaCombatRecord | null> {
    return result(
      this.client.from("mesa_combats").select("*").eq("session_id", sessionId).maybeSingle(),
      "Falha ao consultar o combate",
    ) as Promise<MesaCombatRecord | null>;
  }

  findCombatById(combatId: string, sessionId?: string): Promise<MesaCombatRecord | null> {
    let request = this.client.from("mesa_combats").select("*").eq("id", combatId);
    if (sessionId) request = request.eq("session_id", sessionId);
    return result(request.maybeSingle(), "Falha ao consultar o combate") as Promise<MesaCombatRecord | null>;
  }

  createCombat(input: MesaCombatCreate): Promise<MesaCombatRecord> {
    return result(
      this.client.from("mesa_combats").insert({
        session_id: input.sessionId,
        status: input.status,
        round: input.round ?? 1,
        initiative_started: input.initiativeStarted ?? false,
        event_log: input.eventLog ?? [],
      }).select("*").single(),
      "Falha ao criar o combate",
    ) as Promise<MesaCombatRecord>;
  }

  updateCombat(combatId: string, sessionId: string, patch: Readonly<Record<string, unknown>>, expected: Readonly<Record<string, unknown>> = {}): Promise<MesaCombatRecord[]> {
    let request = this.client.from("mesa_combats").update(patch).eq("id", combatId).eq("session_id", sessionId);
    for (const [name, value] of Object.entries(expected)) request = value === null ? request.is(name, null) : request.eq(name, typeof value === "object" ? JSON.stringify(value) : value);
    return result(
      request.select("*"),
      "Falha ao atualizar o combate",
    ) as Promise<MesaCombatRecord[]>;
  }

  async findCombatEventLog(combatId: string, sessionId: string): Promise<unknown[]> {
    const row = await result(
      this.client.from("mesa_combats").select("event_log").eq("id", combatId).eq("session_id", sessionId).maybeSingle(),
      "Falha ao consultar o histórico do combate",
    ) as { event_log?: unknown } | null;
    return Array.isArray(row?.event_log) ? row.event_log : [];
  }

  async replaceCombatEventLog(combatId: string, sessionId: string, eventLog: unknown, expectedEventLog?: unknown): Promise<MesaCombatRecord[]> {
    let request = this.client.from("mesa_combats").update({ event_log: eventLog, updated_at: new Date().toISOString() }).eq("id", combatId).eq("session_id", sessionId);
    if (expectedEventLog !== undefined) {
      request = request.eq("event_log", typeof expectedEventLog === "object" ? JSON.stringify(expectedEventLog) : expectedEventLog);
    }
    return result(
      request.select("*"),
      "Falha ao registrar o evento",
    ) as Promise<MesaCombatRecord[]>;
  }

  async appendCombatEvent(combatId: string, sessionId: string, event: unknown, maxEvents: number): Promise<MesaCombatRecord[]> {
    return (await result(
      this.client.rpc("append_mesa_combat_event", {
        p_combat_id: combatId,
        p_session_id: sessionId,
        p_event: event,
        p_max_events: maxEvents,
      }),
      "Falha ao registrar o evento",
    ) ?? []) as MesaCombatRecord[];
  }

  async findBattleByEncounter(encounterId: string): Promise<MesaBattleRecord | null> {
    return result(
      this.client.from("mesa_battles").select("*").eq("encounter_id", encounterId).maybeSingle(),
      "Falha ao consultar a partida",
    ) as Promise<MesaBattleRecord | null>;
  }

  async findActiveBattle(sessionId: string): Promise<MesaBattleRecord | null> {
    return result(
      this.client.from("mesa_battles").select("*").eq("session_id", sessionId).eq("status", "active").order("started_at", { ascending: false }).limit(1).maybeSingle(),
      "Falha ao consultar a partida",
    ) as Promise<MesaBattleRecord | null>;
  }

  createBattle(input: MesaBattleCreate): Promise<MesaBattleRecord> {
    return result(
      this.client.from("mesa_battles").insert({
        session_id: input.sessionId,
        join_code: input.joinCode,
        encounter_id: input.encounterId,
        encounter_name: input.encounterName.slice(0, 60),
        status: "active",
      }).select("*").single(),
      "Falha ao registrar a partida",
    ) as Promise<MesaBattleRecord>;
  }

  updateBattle(battleId: string, sessionId: string, patch: Readonly<Record<string, unknown>>): Promise<MesaBattleRecord[]> {
    return result(
      this.client.from("mesa_battles").update(patch).eq("id", battleId).eq("session_id", sessionId).select("*"),
      "Falha ao atualizar a partida",
    ) as Promise<MesaBattleRecord[]>;
  }

  completeBattle(battleId: string, sessionId: string, patch: Readonly<Record<string, unknown>>): Promise<MesaBattleRecord[]> {
    return result(
      this.client.from("mesa_battles").update(patch).eq("id", battleId).eq("session_id", sessionId).eq("status", "active").select("*"),
      "Falha ao concluir a partida",
    ) as Promise<MesaBattleRecord[]>;
  }

  async deleteBattle(battleId: string, sessionId: string): Promise<void> {
    await result(this.client.from("mesa_battles").delete().eq("id", battleId).eq("session_id", sessionId), "Falha ao descartar a partida");
  }

  async listBattles(sessionId: string, limit = 50): Promise<MesaBattleRecord[]> {
    const rows = await result(
      this.client.from("mesa_battles").select("*").eq("session_id", sessionId).order("started_at", { ascending: false }).limit(Math.max(1, Math.min(100, limit))),
      "Falha ao consultar o histórico de partidas",
    );
    return (rows ?? []) as MesaBattleRecord[];
  }

  async listCombatantsByCombat(combatId: string, sessionId?: string): Promise<MesaCombatantRecord[]> {
    let request = this.client
      .from("mesa_combatants")
      .select("*")
      .eq("combat_id", combatId)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });
    if (sessionId) request = request.eq("session_id", sessionId);
    const rows = await result(request, "Falha ao consultar os combatentes");
    return (rows ?? []) as MesaCombatantRecord[];
  }

  async listCombatantsBySession(sessionId: string): Promise<MesaCombatantRecord[]> {
    const rows = await result(
      this.client.from("mesa_combatants").select("*").eq("session_id", sessionId).order("sort_order", { ascending: true, nullsFirst: false }).order("id", { ascending: true }),
      "Falha ao consultar os combatentes",
    );
    return (rows ?? []) as MesaCombatantRecord[];
  }

  findCombatantById(
    combatantId: string,
    scope: { combatId?: string; sessionId?: string },
  ): Promise<MesaCombatantRecord | null> {
    let request = this.client.from("mesa_combatants").select("*").eq("id", combatantId);
    if (scope.combatId) request = request.eq("combat_id", scope.combatId);
    if (scope.sessionId) request = request.eq("session_id", scope.sessionId);
    return result(request.maybeSingle(), "Falha ao consultar o combatente") as Promise<MesaCombatantRecord | null>;
  }

  async updateCombatant(input: CombatantWrite): Promise<MesaCombatantRecord[]> {
    let request = this.client.from("mesa_combatants").update(input.patch).eq("id", input.id);
    if (input.sessionId) request = request.eq("session_id", input.sessionId);
    if (input.combatId) request = request.eq("combat_id", input.combatId);
    for (const [column, value] of Object.entries(input.expected ?? {})) {
      request = value === null ? request.is(column, null) : request.eq(column, typeof value === "object" ? JSON.stringify(value) : value);
    }
    const rows = await result(request.select("*"), "Falha ao atualizar o combatente");
    return (rows ?? []) as MesaCombatantRecord[];
  }

  async updateCombatantHp(input: CombatantHpWrite): Promise<MesaCombatantRecord[]> {
    return this.updateConditionalCombatant(input, "Falha ao atualizar o HP");
  }

  async debitCombatantAction(input: CombatantActionDebit): Promise<MesaCombatantRecord[]> {
    return this.updateConditionalCombatant(input, "Falha ao consumir a ação");
  }

  private async updateConditionalCombatant(
    input: CombatantWrite,
    context: string,
  ): Promise<MesaCombatantRecord[]> {
    let request = this.client.from("mesa_combatants").update(input.patch).eq("id", input.id);
    if (input.sessionId) request = request.eq("session_id", input.sessionId);
    if (input.combatId) request = request.eq("combat_id", input.combatId);
    for (const [column, value] of Object.entries(input.expected ?? {})) {
      request = value === null ? request.is(column, null) : request.eq(column, typeof value === "object" ? JSON.stringify(value) : value);
    }
    const rows = await result(request.select("*"), context);
    return (rows ?? []) as MesaCombatantRecord[];
  }

  async insertCombatants(rows: ReadonlyArray<CombatantRowPayload>, context: string): Promise<void> {
    await result(this.client.from("mesa_combatants").insert(rows as Record<string, unknown>[]), context);
  }

  async upsertCombatants(rows: ReadonlyArray<CombatantRowPayload>, context: string): Promise<void> {
    await result(
      this.client.from("mesa_combatants").upsert(rows as Record<string, unknown>[], { onConflict: "id" }),
      context,
    );
  }

  async deleteCombatants(scope: CombatantScope, context: string): Promise<void> {
    // Nenhuma remoção sem chave: um escopo vazio apagaria a tabela inteira.
    const hasId = typeof scope.id === "string" && scope.id.length > 0;
    const hasCombat = typeof scope.combatId === "string" && scope.combatId.length > 0;
    const hasSession = typeof scope.sessionId === "string" && scope.sessionId.length > 0;
    if (!hasId && !hasCombat && !hasSession) {
      throw new DatabaseQueryError(`${context}: escopo de remoção vazio é recusado`);
    }
    let request = this.client.from("mesa_combatants").delete();
    if (hasId) request = request.eq("id", scope.id!);
    if (hasCombat) request = request.eq("combat_id", scope.combatId!);
    if (hasSession) request = request.eq("session_id", scope.sessionId!);
    await result(request, context);
  }
}

function keyArgs(key: ResolutionKey): Record<string, string> {
  return {
    p_session_id: key.sessionId,
    p_combat_id: key.combatId,
    p_resolution_id: key.resolutionId,
  };
}

function first<T>(rows: T[] | null): T | null {
  return rows?.[0] ?? null;
}

/**
 * Implementa a máquina de resolução já existente. Os commits recebem os
 * argumentos p_* específicos da migration, sem que este adapter tente
 * recalcular regra ou estado.
 */
export class SupabaseResolutionStore implements ResolutionStore {
  private readonly client: SupabaseClient;

  constructor(client: SupabaseClient = getSupabaseAdmin()) {
    this.client = client;
  }

  async findAttack<TResult = unknown>(key: ResolutionLookupKey): Promise<ResolutionRecord<TResult> | null> {
    let request = this.client
      .from("mesa_attack_resolutions")
      .select("combat_id,status,claim_token,result")
      .eq("session_id", key.sessionId);
    if (key.combatId) request = request.eq("combat_id", key.combatId);
    request = request.eq("resolution_id", key.resolutionId);
    return result(request.maybeSingle(), "Falha ao consultar a resolução do ataque") as Promise<ResolutionRecord<TResult> | null>;
  }

  async recoverAttack<TResult = unknown>(key: ResolutionKey): Promise<ResolutionRecoveryRecord<TResult> | null> {
    const rows = await result(
      this.client.rpc("recover_mesa_attack_resolution", keyArgs(key)),
      "Falha ao verificar a resolução interrompida",
    ) as Array<ResolutionRecoveryRecord<TResult>> | null;
    return first(rows);
  }

  async claimAttack<TResult = unknown>(key: ResolutionKey): Promise<ResolutionClaim<TResult> | null> {
    const rows = await result(
      this.client.rpc("claim_mesa_attack_resolution", keyArgs(key)),
      "Falha ao reservar resolução do ataque",
    ) as Array<ResolutionClaim<TResult>> | null;
    return first(rows);
  }

  async releaseAttack(input: ResolutionKey & { claimToken: string }): Promise<void> {
    await result(
      this.client.rpc("release_mesa_attack_resolution", { ...keyArgs(input), p_claim_token: input.claimToken }),
      "Falha ao liberar resolução do ataque",
    );
  }

  commitAttack<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    return result(
      this.client.rpc("commit_mesa_attack_resolution", input.rpcArgs),
      "Falha ao confirmar resolução do ataque",
    ) as Promise<TResult | null>;
  }

  async findReload<TResult = unknown>(key: ResolutionLookupKey): Promise<ResolutionRecord<TResult> | null> {
    let request = this.client
      .from("mesa_reload_resolutions")
      .select("combat_id,status,claim_token,result")
      .eq("session_id", key.sessionId);
    if (key.combatId) request = request.eq("combat_id", key.combatId);
    request = request.eq("resolution_id", key.resolutionId);
    return result(request.maybeSingle(), "Falha ao consultar a resolução do reload") as Promise<ResolutionRecord<TResult> | null>;
  }

  async recoverReload<TResult = unknown>(key: ResolutionKey): Promise<ResolutionRecoveryRecord<TResult> | null> {
    const rows = await result(
      this.client.rpc("recover_mesa_reload_resolution", keyArgs(key)),
      "Falha ao verificar a resolução interrompida",
    ) as Array<ResolutionRecoveryRecord<TResult>> | null;
    return first(rows);
  }

  async claimReload<TResult = unknown>(key: ResolutionKey): Promise<ResolutionClaim<TResult> | null> {
    const rows = await result(
      this.client.rpc("claim_mesa_reload_resolution", keyArgs(key)),
      "Falha ao reservar resolução do reload",
    ) as Array<ResolutionClaim<TResult>> | null;
    return first(rows);
  }

  async releaseReload(input: ResolutionKey & { claimToken: string }): Promise<void> {
    await result(
      this.client.rpc("release_mesa_reload_resolution", { ...keyArgs(input), p_claim_token: input.claimToken }),
      "Falha ao liberar resolução do reload",
    );
  }

  commitReload<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    return result(
      this.client.rpc("commit_mesa_reload_resolution", input.rpcArgs),
      "Falha ao confirmar resolução do reload",
    ) as Promise<TResult | null>;
  }

  async claimItemConsume<TResult = unknown>(key: ResolutionKey): Promise<ResolutionClaim<TResult> | null> {
    const rows = await result(
      this.client.rpc("claim_mesa_item_consume_resolution", keyArgs(key)),
      "Falha ao reservar consumo de item",
    ) as Array<ResolutionClaim<TResult>> | null;
    return first(rows);
  }

  async findItemConsume<TResult = unknown>(key: ResolutionKey): Promise<ResolutionRecord<TResult> | null> {
    return result(
      this.client.from("mesa_item_consume_resolutions").select("*").eq("session_id", key.sessionId).eq("combat_id", key.combatId).eq("resolution_id", key.resolutionId).maybeSingle(),
      "Falha ao consultar a resolução do consumo",
    ) as Promise<ResolutionRecord<TResult> | null>;
  }

  async releaseItemConsume(input: ResolutionKey & { claimToken: string }): Promise<void> {
    await result(
      this.client.rpc("release_mesa_item_consume_resolution", { ...keyArgs(input), p_claim_token: input.claimToken }),
      "Falha ao liberar consumo de item",
    );
  }

  commitItemConsume<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    return this.commitRpc("commit_mesa_item_consume_resolution", input, "Falha ao confirmar consumo de item");
  }

  commitItemHeal<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    return this.commitRpc("commit_mesa_item_heal_resolution", input, "Falha ao confirmar cura por item");
  }

  async commitMove<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<MoveResolutionCommitResult<TResult> | null> {
    const rows = await result(
      this.client.rpc("commit_mesa_move_resolution_atomic", input.rpcArgs),
      "Falha ao confirmar movimento atomicamente",
    ) as Array<MoveResolutionCommitResult<TResult>> | null;
    return rows?.[0] ?? null;
  }

  commitDeathSave<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    return this.commitRpc("commit_mesa_death_save_resolution", input, "Falha ao confirmar death save");
  }

  commitCoverDamage<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    return this.commitRpc("commit_mesa_attack_cover_resolution", input, "Falha ao confirmar dano de cobertura");
  }

  commitNetAction<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    return this.commitRpc("commit_mesa_net_action_resolution", input, "Falha ao confirmar NET action");
  }

  commitQuickhack<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    return this.commitRpc("commit_mesa_quickhack_resolution", input, "Falha ao confirmar quickhack");
  }

  async commitInitiative<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    const row = await result(
      this.client.from("mesa_attack_resolutions")
        .update({ status: "committed", result: input.rpcArgs.p_result, committed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("session_id", input.sessionId).eq("combat_id", input.combatId).eq("resolution_id", input.resolutionId)
        .eq("claim_token", input.claimToken).eq("status", "processing").select("result").maybeSingle(),
      "Falha ao confirmar a resolução da iniciativa",
    ) as { result?: TResult } | null;
    return row?.result ?? null;
  }

  private commitRpc<TResult>(
    name: string,
    input: ResolutionCommit<TResult>,
    context: string,
  ): Promise<TResult | null> {
    return result(this.client.rpc(name, input.rpcArgs), context) as Promise<TResult | null>;
  }
}

/**
 * Adaptador server-side. A implementação usa o publicador existente, que já
 * agenda `after()` e publica somente `{ invalidate, sessionId, at }`.
 */
export class SupabaseMesaEventTransport implements MesaEventTransport {
  publishInvalidation(sessionId: string): Promise<void> {
    return publishMesaState(sessionId);
  }

  subscribeInvalidation(
    sessionId: string,
    onInvalidate: (event: MesaInvalidation) => void,
    onStatus?: (status: string) => void,
  ): MesaEventSubscription | null {
    const subscription: MesaSubscription | null = subscribeMesaState(
      sessionId,
      () => undefined,
      onStatus,
      (invalidation) => onInvalidate({
        sessionId: invalidation.sessionId ?? sessionId,
        publishedAt: invalidation.publishedAt ?? Date.now(),
      }),
    );
    return subscription;
  }
}
