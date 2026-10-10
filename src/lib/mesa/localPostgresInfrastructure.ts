/**
 * Adaptador PostgreSQL LOCAL de `MesaRepository`.
 *
 * Escopo deliberadamente mínimo (F1.66.5): somente as operações cobertas pela
 * suíte de contrato `tests/contract/mesaRepositoryContractSuite.ts` — leituras
 * por escopo, materialização (insert/upsert/delete) e escrita condicional
 * (CAS). Cada método traduz os mesmos filtros de escopo e `expected` que o
 * `SupabaseMesaRepository` traduz, só que em SQL parametrizado direto.
 *
 * O que este arquivo NÃO faz, de propósito:
 * - não implementa `MesaEventTransport`;
 * - não calcula regra, HP, alvo ou `resolutionId` — payloads chegam prontos
 *   do domínio;
 * - não faz fallback para Supabase: a seleção explícita de hospedagem ocorre
 *   na factory e o adapter local recebe somente consultas do PostgreSQL local.
 *
 * Os registros voltam com as mesmas colunas snake_case que o PostgREST devolve
 * para o adapter Supabase: o formato persistido não muda.
 */
import type { Pool } from "pg";

import { DatabaseQueryError } from "@/lib/supabaseAdmin";
import type {
  MesaCharacterRecord,
  MesaCharacterUpsert,
  CombatantRowPayload,
  CombatantScope,
  CombatantWrite,
  MesaCombatRecord,
  MesaCombatCreate,
  MesaCombatantRecord,
  MesaBattleRecord,
  MesaBattleCreate,
  MesaParticipantCreate,
  MesaParticipantRecord,
  MesaRepository,
  MesaSessionCreate,
  MesaSessionRecord,
  ToolkitRecord,
  ToolkitRecordKind,
  ToolkitRecordWrite,
  ToolkitRepository,
  MoveResolutionCommitResult,
  ResolutionClaim,
  ResolutionCommit,
  ResolutionKey,
  ResolutionLookupKey,
  ResolutionRecord,
  ResolutionRecoveryRecord,
  ResolutionStore,
} from "@/lib/mesa/infrastructure";

/** Qualquer cliente que exponha `query(sql, params)` (Pool ou PoolClient). */
type Queryable = Pick<Pool, "query">;

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** Só nomes de coluna plausíveis entram no SQL montado por concatenação. */
function column(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new DatabaseQueryError(`nome de coluna inválido: ${String(name)}`);
  }
  return name;
}

export class LocalPostgresMesaRepository implements MesaRepository, ToolkitRepository {
  private readonly pool: Queryable;

  constructor(pool: Queryable) {
    this.pool = pool;
  }

  private async rows<T>(sql: string, params: unknown[], context: string): Promise<T[]> {
    try {
      const result = await this.pool.query(sql, params);
      return result.rows as T[];
    } catch (error) {
      // Mesmo formato do adapter Supabase: `<contexto do domínio>: <detalhe>`.
      throw new DatabaseQueryError(`${context}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async findSessionById(sessionId: string): Promise<MesaSessionRecord | null> {
    const rows = await this.rows<MesaSessionRecord>(
      "select * from public.mesa_sessions where id = $1 limit 1",
      [sessionId],
      "Falha ao consultar a mesa",
    );
    return rows[0] ?? null;
  }

  async findSessionNetArchitectures(sessionId: string): Promise<unknown | null> {
    const rows = await this.rows<{ net_architectures: unknown }>(
      "select net_architectures from public.mesa_sessions where id = $1 limit 1",
      [sessionId],
      "Falha ao consultar a Architecture",
    );
    return rows[0]?.net_architectures ?? null;
  }

  async updateSessionNetArchitectures(sessionId: string, architectures: unknown, expected?: unknown): Promise<MesaSessionRecord[]> {
    return this.updateSession(sessionId, {
      net_architectures: architectures,
      updated_at: new Date().toISOString(),
    }, expected === undefined ? {} : { net_architectures: expected });
  }

  async findSessionByJoinCode(joinCode: string): Promise<MesaSessionRecord | null> {
    const rows = await this.rows<MesaSessionRecord>(
      "select * from public.mesa_sessions where join_code = $1 limit 1",
      [joinCode],
      "Falha ao consultar a mesa",
    );
    return rows[0] ?? null;
  }

  async createSession(input: MesaSessionCreate): Promise<MesaSessionRecord> {
    const rows = await this.rows<MesaSessionRecord>(
      "insert into public.mesa_sessions (name,join_code,status) values ($1,$2,$3) returning *",
      [input.name, input.joinCode, input.status],
      "Falha ao criar a mesa",
    );
    if (!rows[0]) throw new DatabaseQueryError("Falha ao criar a mesa: nenhuma linha retornada");
    return rows[0];
  }

  async updateSession(sessionId: string, patch: Readonly<Record<string, unknown>>, expected: Readonly<Record<string, unknown>> = {}): Promise<MesaSessionRecord[]> {
    return this.updateRecord("mesa_sessions", sessionId, patch, "Falha ao atualizar a mesa", undefined, expected);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.rows("delete from public.mesa_sessions where id = $1", [sessionId], "Falha ao remover a mesa");
  }

  async findParticipantByToken(sessionId: string, playerToken: string): Promise<MesaParticipantRecord | null> {
    const rows = await this.rows<MesaParticipantRecord>(
      "select * from public.mesa_participants where session_id = $1 and player_token = $2 limit 1",
      [sessionId, playerToken],
      "Falha ao consultar o participante",
    );
    return rows[0] ?? null;
  }

  async listParticipantsBySession(sessionId: string): Promise<MesaParticipantRecord[]> {
    return this.rows<MesaParticipantRecord>(
      "select * from public.mesa_participants where session_id = $1 order by created_at",
      [sessionId],
      "Falha ao consultar participantes",
    );
  }

  async insertParticipant(input: MesaParticipantCreate): Promise<MesaParticipantRecord> {
    const rows = await this.rows<MesaParticipantRecord>(
      "insert into public.mesa_participants (session_id,player_token,display_name,role) values ($1,$2,$3,$4) returning *",
      [input.sessionId, input.playerToken, input.displayName, input.role],
      "Falha ao criar o participante",
    );
    if (!rows[0]) throw new DatabaseQueryError("Falha ao criar o participante: nenhuma linha retornada");
    return rows[0];
  }

  async updateParticipant(participantId: string, sessionId: string, patch: Readonly<Record<string, unknown>>): Promise<MesaParticipantRecord[]> {
    return this.updateRecord("mesa_participants", participantId, patch, "Falha ao atualizar o participante", sessionId);
  }

  async deleteParticipant(participantId: string, sessionId: string): Promise<void> {
    await this.rows("delete from public.mesa_participants where id = $1 and session_id = $2", [participantId, sessionId], "Falha ao sair da mesa");
  }

  async findCharacterById(characterId: string): Promise<MesaCharacterRecord | null> {
    const rows = await this.rows<MesaCharacterRecord>(
      "select * from public.mesa_characters where id = $1 limit 1",
      [characterId],
      "Falha ao consultar o personagem",
    );
    return rows[0] ?? null;
  }

  async upsertCharacter(input: MesaCharacterUpsert): Promise<MesaCharacterRecord> {
    const rows = await this.rows<MesaCharacterRecord>(
      `insert into public.mesa_characters (id,owner_token,display_name,sheet,updated_at)
       values ($1,$2,$3,$4::jsonb,$5)
       on conflict (id) do update set owner_token = excluded.owner_token,
         display_name = excluded.display_name, sheet = excluded.sheet, updated_at = excluded.updated_at
       returning *`,
      [input.id, input.ownerToken, input.displayName, jsonParameter(input.sheet), input.updatedAt],
      "Falha ao salvar a ficha",
    );
    if (!rows[0]) throw new DatabaseQueryError("Falha ao salvar a ficha: nenhuma linha retornada");
    return rows[0];
  }

  async listToolkitRecords(ownerToken: string, kind: ToolkitRecordKind): Promise<ToolkitRecord[]> {
    return this.rows<ToolkitRecord>(
      "select * from public.mesa_toolkit_records where owner_token = $1 and kind = $2 order by updated_at desc",
      [ownerToken, kind],
      "Falha ao listar dados do toolkit",
    );
  }

  async findToolkitRecord(id: string, ownerToken: string, kind: ToolkitRecordKind): Promise<ToolkitRecord | null> {
    const rows = await this.rows<ToolkitRecord>(
      "select * from public.mesa_toolkit_records where id = $1 and owner_token = $2 and kind = $3 limit 1",
      [id, ownerToken, kind],
      "Falha ao consultar dado do toolkit",
    );
    return rows[0] ?? null;
  }

  async upsertToolkitRecord(input: ToolkitRecordWrite): Promise<ToolkitRecord> {
    const params: unknown[] = [input.id, input.ownerToken, input.kind, input.name, jsonParameter(input.payload)];
    const expected = input.expectedVersion;
     // `version` também existe no pseudo-registro `excluded` do ON CONFLICT;
     // qualificar a coluna evita o erro PostgreSQL "column reference version
     // is ambiguous" ao salvar uma versão existente do toolkit.
     const where = expected === undefined ? "" : " and public.mesa_toolkit_records.version = $6";
    if (expected !== undefined) params.push(expected);
    const rows = await this.rows<ToolkitRecord>(
      `insert into public.mesa_toolkit_records (id,owner_token,kind,name,payload)
       values ($1,$2,$3,$4,$5::jsonb)
       on conflict (id,owner_token,kind) do update set name = excluded.name, payload = excluded.payload,
         version = public.mesa_toolkit_records.version + 1, updated_at = now()
       where public.mesa_toolkit_records.owner_token = $2 and public.mesa_toolkit_records.kind = $3${where}
       returning *`,
      params,
      "Falha ao salvar dado do toolkit",
    );
    if (!rows[0]) throw new DatabaseQueryError("Falha ao salvar dado do toolkit: versão obsoleta ou registro não encontrado");
    return rows[0];
  }

  async deleteToolkitRecord(id: string, ownerToken: string, kind: ToolkitRecordKind): Promise<void> {
    await this.rows(
      "delete from public.mesa_toolkit_records where id = $1 and owner_token = $2 and kind = $3",
      [id, ownerToken, kind],
      "Falha ao remover dado do toolkit",
    );
  }

  private async updateRecord<T extends Record<string, unknown>>(
    table: "mesa_sessions" | "mesa_participants" | "mesa_combats",
    id: string,
    patch: Readonly<Record<string, unknown>>,
    context: string,
    sessionId?: string,
    expected: Readonly<Record<string, unknown>> = {},
  ): Promise<T[]> {
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    const assignments = Object.entries(patch).map(([name, value]) => `${column(name)} = ${bind(value)}`);
    if (assignments.length === 0) return [];
    const filters = [`id = ${bind(id)}`];
    if (sessionId) filters.push(`session_id = ${bind(sessionId)}`);
    for (const [name, value] of Object.entries(expected)) {
      filters.push(value === null ? `${column(name)} is null` : `${column(name)} = ${bind(value)}`);
    }
    return this.rows<T>(
      `update public.${table} set ${assignments.join(", ")} where ${filters.join(" and ")} returning *`,
      params,
      context,
    );
  }

  async findCombatBySession(sessionId: string): Promise<MesaCombatRecord | null> {
    const rows = await this.rows<MesaCombatRecord>(
      "select * from public.mesa_combats where session_id = $1 limit 1",
      [sessionId],
      "Falha ao consultar o combate",
    );
    return rows[0] ?? null;
  }

  async findCombatById(combatId: string, sessionId?: string): Promise<MesaCombatRecord | null> {
    const params: unknown[] = [combatId];
    let sql = "select * from public.mesa_combats where id = $1";
    if (sessionId) {
      params.push(sessionId);
      sql += " and session_id = $2";
    }
    const rows = await this.rows<MesaCombatRecord>(`${sql} limit 1`, params, "Falha ao consultar o combate");
    return rows[0] ?? null;
  }

  async createCombat(input: MesaCombatCreate): Promise<MesaCombatRecord> {
    const rows = await this.rows<MesaCombatRecord>(
      `insert into public.mesa_combats (session_id,status,round,initiative_started,event_log)
       values ($1,$2,$3,$4,$5::jsonb) returning *`,
      [input.sessionId, input.status, input.round ?? 1, input.initiativeStarted ?? false, jsonParameter(input.eventLog ?? [])],
      "Falha ao criar o combate",
    );
    if (!rows[0]) throw new DatabaseQueryError("Falha ao criar o combate: nenhuma linha retornada");
    return rows[0];
  }

  async updateCombat(combatId: string, sessionId: string, patch: Readonly<Record<string, unknown>>, expected: Readonly<Record<string, unknown>> = {}): Promise<MesaCombatRecord[]> {
    return this.updateRecord("mesa_combats", combatId, patch, "Falha ao atualizar o combate", sessionId, expected);
  }

  async findCombatEventLog(combatId: string, sessionId: string): Promise<unknown[]> {
    const rows = await this.rows<{ event_log: unknown }>(
      "select event_log from public.mesa_combats where id = $1 and session_id = $2 limit 1",
      [combatId, sessionId],
      "Falha ao consultar o histórico do combate",
    );
    const eventLog = rows[0]?.event_log;
    return Array.isArray(eventLog) ? eventLog : [];
  }

  async replaceCombatEventLog(
    combatId: string,
    sessionId: string,
    eventLog: unknown,
    expectedEventLog?: unknown,
  ): Promise<MesaCombatRecord[]> {
    return this.updateRecord(
      "mesa_combats",
      combatId,
      { event_log: jsonParameter(eventLog), updated_at: new Date().toISOString() },
      "Falha ao registrar o evento",
      sessionId,
      expectedEventLog === undefined ? {} : { event_log: jsonParameter(expectedEventLog) },
    );
  }

  async appendCombatEvent(combatId: string, sessionId: string, event: unknown, maxEvents: number): Promise<MesaCombatRecord[]> {
    return this.rows<MesaCombatRecord>(
      "select * from public.append_mesa_combat_event($1::uuid, $2::uuid, $3::jsonb, $4::integer)",
      [combatId, sessionId, jsonParameter(event), maxEvents],
      "Falha ao registrar o evento",
    );
  }

  async findBattleByEncounter(encounterId: string): Promise<MesaBattleRecord | null> {
    const rows = await this.rows<MesaBattleRecord>(
      "select * from public.mesa_battles where encounter_id = $1 limit 1",
      [encounterId],
      "Falha ao consultar a partida",
    );
    return rows[0] ?? null;
  }

  async findActiveBattle(sessionId: string): Promise<MesaBattleRecord | null> {
    const rows = await this.rows<MesaBattleRecord>(
      "select * from public.mesa_battles where session_id = $1 and status = 'active' order by started_at desc limit 1",
      [sessionId],
      "Falha ao consultar a partida",
    );
    return rows[0] ?? null;
  }

  async createBattle(input: MesaBattleCreate): Promise<MesaBattleRecord> {
    const rows = await this.rows<MesaBattleRecord>(
      `insert into public.mesa_battles (session_id,join_code,encounter_id,encounter_name,status)
       values ($1,$2,$3,$4,'active') returning *`,
      [input.sessionId, input.joinCode, input.encounterId, input.encounterName.slice(0, 60)],
      "Falha ao registrar a partida",
    );
    if (!rows[0]) throw new DatabaseQueryError("Falha ao registrar a partida: nenhuma linha retornada");
    return rows[0];
  }

  async updateBattle(battleId: string, sessionId: string, patch: Readonly<Record<string, unknown>>): Promise<MesaBattleRecord[]> {
    const params: unknown[] = [];
    const bind = (name: string, value: unknown): string => {
      params.push(battleJsonColumn(name) ? jsonParameter(value) : value);
      return `$${params.length}`;
    };
    const assignments = Object.entries(patch).map(([name, value]) => `${column(name)} = ${bind(name, value)}`);
    if (assignments.length === 0) return [];
    return this.rows<MesaBattleRecord>(
      `update public.mesa_battles set ${assignments.join(", ")} where id = ${bind("id", battleId)} and session_id = ${bind("session_id", sessionId)} returning *`,
      params,
      "Falha ao atualizar a partida",
    );
  }

  async completeBattle(battleId: string, sessionId: string, patch: Readonly<Record<string, unknown>>): Promise<MesaBattleRecord[]> {
    const params: unknown[] = [];
    const bind = (name: string, value: unknown): string => {
      params.push(battleJsonColumn(name) ? jsonParameter(value) : value);
      return `$${params.length}`;
    };
    const assignments = Object.entries(patch).map(([name, value]) => `${column(name)} = ${bind(name, value)}`);
    if (assignments.length === 0) return [];
    return this.rows<MesaBattleRecord>(
      `update public.mesa_battles set ${assignments.join(", ")} where id = ${bind("id", battleId)} and session_id = ${bind("session_id", sessionId)} and status = 'active' returning *`,
      params,
      "Falha ao concluir a partida",
    );
  }

  async deleteBattle(battleId: string, sessionId: string): Promise<void> {
    await this.rows("delete from public.mesa_battles where id = $1 and session_id = $2", [battleId, sessionId], "Falha ao descartar a partida");
  }

  async listBattles(sessionId: string, limit = 50): Promise<MesaBattleRecord[]> {
    const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(100, limit)) : 50;
    return this.rows<MesaBattleRecord>(
      "select * from public.mesa_battles where session_id = $1 order by started_at desc limit $2",
      [sessionId, safeLimit],
      "Falha ao consultar o histórico de partidas",
    );
  }

  async listCombatantsByCombat(combatId: string, sessionId?: string): Promise<MesaCombatantRecord[]> {
    const params: unknown[] = [combatId];
    let sql = "select * from public.mesa_combatants where combat_id = $1";
    if (sessionId) {
      params.push(sessionId);
      sql += " and session_id = $2";
    }
    sql += " order by sort_order asc nulls last, id asc";
    return this.rows<MesaCombatantRecord>(sql, params, "Falha ao consultar os combatentes");
  }

  async listCombatantsBySession(sessionId: string): Promise<MesaCombatantRecord[]> {
    return this.rows<MesaCombatantRecord>(
      "select * from public.mesa_combatants where session_id = $1 order by sort_order asc nulls last, id asc",
      [sessionId],
      "Falha ao consultar os combatentes",
    );
  }

  async findCombatantById(
    combatantId: string,
    scope: { combatId?: string; sessionId?: string },
  ): Promise<MesaCombatantRecord | null> {
    const params: unknown[] = [combatantId];
    let sql = "select * from public.mesa_combatants where id = $1";
    if (scope.combatId) {
      params.push(scope.combatId);
      sql += ` and combat_id = $${params.length}`;
    }
    if (scope.sessionId) {
      params.push(scope.sessionId);
      sql += ` and session_id = $${params.length}`;
    }
    const rows = await this.rows<MesaCombatantRecord>(`${sql} limit 1`, params, "Falha ao consultar o combatente");
    return rows[0] ?? null;
  }

  async updateCombatant(input: CombatantWrite): Promise<MesaCombatantRecord[]> {
    return this.updateConditionalCombatant(input, "Falha ao atualizar o combatente");
  }

  async updateCombatantHp(input: CombatantWrite): Promise<MesaCombatantRecord[]> {
    return this.updateConditionalCombatant(input, "Falha ao atualizar o HP");
  }

  async debitCombatantAction(input: CombatantWrite): Promise<MesaCombatantRecord[]> {
    return this.updateConditionalCombatant(input, "Falha ao consumir a ação");
  }

  private async updateConditionalCombatant(input: CombatantWrite, context: string): Promise<MesaCombatantRecord[]> {
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const assignments = Object.entries(input.patch).map(([name, value]) => `${column(name)} = ${bind(value)}`);
    const filters = [`id = ${bind(input.id)}`];
    if (input.sessionId) filters.push(`session_id = ${bind(input.sessionId)}`);
    if (input.combatId) filters.push(`combat_id = ${bind(input.combatId)}`);
    // CAS: `expected` vira predicado. Zero linhas afetadas = conflito, e o
    // chamador (domínio) é quem decide a resposta — aqui não há regra.
    for (const [name, value] of Object.entries(input.expected ?? {})) {
      filters.push(value === null ? `${column(name)} is null` : `${column(name)} = ${bind(value)}`);
    }

    return this.rows<MesaCombatantRecord>(
      `update public.mesa_combatants set ${assignments.join(", ")} where ${filters.join(" and ")} returning *`,
      params,
      context,
    );
  }

  async insertCombatants(rowsInput: ReadonlyArray<CombatantRowPayload>, context: string): Promise<void> {
    if (rowsInput.length === 0) return;
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const columns = payloadColumns(rowsInput);
    // Coluna ausente no payload recebe DEFAULT — é o mesmo resultado que o
    // PostgREST produz para um insert com coluna omitida.
    const tuples = rowsInput.map(
      (row) => `(${columns.map((name) => (Object.hasOwn(row, name) ? bind(row[name]) : "default")).join(", ")})`,
    );

    await this.rows(
      `insert into public.mesa_combatants (${columns.join(", ")}) values ${tuples.join(", ")}`,
      params,
      context,
    );
  }

  async upsertCombatants(rowsInput: ReadonlyArray<CombatantRowPayload>, context: string): Promise<void> {
    if (rowsInput.length === 0) return;
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const columns = payloadColumns(rowsInput);
    const tuples = rowsInput.map(
      (row) => `(${columns.map((name) => (Object.hasOwn(row, name) ? bind(row[name]) : "default")).join(", ")})`,
    );
    const updates = columns.map((name) => `${name} = excluded.${name}`).join(", ");

    // Idem PostgREST: conflito só em `id` e somente as colunas do payload
    // são substituídas (as demais preservam o valor persistido).
    await this.rows(
      `insert into public.mesa_combatants (${columns.join(", ")}) values ${tuples.join(", ")} ` +
        `on conflict (id) do update set ${updates}`,
      params,
      context,
    );
  }

  async deleteCombatants(scope: CombatantScope, context: string): Promise<void> {
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const filters: string[] = [];
    if (typeof scope.id === "string" && scope.id.length > 0) filters.push(`id = ${bind(scope.id)}`);
    if (typeof scope.combatId === "string" && scope.combatId.length > 0) {
      filters.push(`combat_id = ${bind(scope.combatId)}`);
    }
    if (typeof scope.sessionId === "string" && scope.sessionId.length > 0) {
      filters.push(`session_id = ${bind(scope.sessionId)}`);
    }
    // Nenhuma remoção sem chave: um escopo vazio apagaria a tabela inteira.
    if (filters.length === 0) {
      throw new DatabaseQueryError(`${context}: escopo de remoção vazio é recusado`);
    }

    await this.rows(`delete from public.mesa_combatants where ${filters.join(" and ")}`, params, context);
  }
}

/**
 * Slice local da ResolutionStore para movimentação e para as máquinas de
 * claim/recovery/release/commit de ataque, reload, consumo e Death Save extraídas nesta etapa. A
 * transação, locks, CAS e idempotência continuam nas funções SQL oficiais das
 * migrations; este adapter não reimplementa RPC em TypeScript.
 */
export class LocalPostgresResolutionStore implements Pick<ResolutionStore,
  "findAttack" | "recoverAttack" | "claimAttack" | "releaseAttack" | "commitAttack" |
   "findReload" | "recoverReload" | "claimReload" | "releaseReload" | "commitReload" |
   "claimItemConsume" | "findItemConsume" | "releaseItemConsume" | "commitItemConsume" | "commitItemHeal" |
   "commitMove" | "commitDeathSave" | "commitCoverDamage" | "commitNetAction" | "commitQuickhack" | "commitInitiative"> {
  private readonly pool: Queryable;

  constructor(pool: Queryable) {
    this.pool = pool;
  }

  async commitMove<TResult = unknown>(
    input: ResolutionCommit<TResult>,
  ): Promise<MoveResolutionCommitResult<TResult> | null> {
    const args = input.rpcArgs;
    try {
      const result = await this.pool.query(
        `select status, result
           from public.commit_mesa_move_resolution_atomic(
              $1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid, $6::integer, $7::integer, $8::integer, $9::integer, $10::jsonb, $11::jsonb, $12::jsonb
           )`,
        [
          args.p_session_id,
          args.p_combat_id,
          args.p_resolution_id,
          args.p_claim_token,
          args.p_actor_id,
          args.p_movement_before,
          args.p_movement_after,
          args.p_actions_before,
          args.p_actions_after,
          jsonParameter(args.p_position),
          jsonParameter(args.p_netrunner_state),
          jsonParameter(args.p_result),
        ],
      );
      return (result.rows[0] ?? null) as MoveResolutionCommitResult<TResult> | null;
    } catch (error) {
      throw new DatabaseQueryError(
        `Falha ao confirmar movimento atomicamente: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async findAttack<TResult = unknown>(key: ResolutionKey): Promise<ResolutionRecord<TResult> | null> {
    return this.findResolution("mesa_attack_resolutions", key, "Falha ao consultar a resolução do ataque");
  }

  async recoverAttack<TResult = unknown>(key: ResolutionKey): Promise<ResolutionRecoveryRecord<TResult> | null> {
    return this.recover("recover_mesa_attack_resolution", key, "Falha ao verificar a resolução interrompida");
  }

  async claimAttack<TResult = unknown>(key: ResolutionKey): Promise<ResolutionClaim<TResult> | null> {
    return this.claim("claim_mesa_attack_resolution", key, "Falha ao reservar resolução do ataque");
  }

  async releaseAttack(input: ResolutionKey & { claimToken: string }): Promise<void> {
    await this.release("release_mesa_attack_resolution", input, "Falha ao liberar resolução do ataque");
  }

  async commitAttack<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    const a = input.rpcArgs;
    return this.commitJson(
      `select public.commit_mesa_attack_resolution(
        $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::uuid,$7::integer,$8::integer,$9::jsonb,$10::jsonb,$11::integer,$12::boolean,$13::jsonb,$14::jsonb,$15::text
      ) as result`,
      [
        a.p_session_id, a.p_combat_id, a.p_resolution_id, a.p_claim_token,
        a.p_actor_id, a.p_target_id, a.p_actions_before, a.p_actions_after,
        jsonParameter(a.p_ammo_before), jsonParameter(a.p_ammo_after),
        a.p_target_hp_before, a.p_target_dead_before,
        jsonParameter(a.p_target_patch), jsonParameter(a.p_result), a.p_event_text,
      ],
      "Falha ao confirmar resolução do ataque",
    ) as Promise<TResult | null>;
  }

  async findReload<TResult = unknown>(key: ResolutionKey): Promise<ResolutionRecord<TResult> | null> {
    return this.findResolution("mesa_reload_resolutions", key, "Falha ao consultar a resolução do reload");
  }

  async recoverReload<TResult = unknown>(key: ResolutionKey): Promise<ResolutionRecoveryRecord<TResult> | null> {
    return this.recover("recover_mesa_reload_resolution", key, "Falha ao verificar a resolução interrompida");
  }

  async claimReload<TResult = unknown>(key: ResolutionKey): Promise<ResolutionClaim<TResult> | null> {
    return this.claim("claim_mesa_reload_resolution", key, "Falha ao reservar resolução do reload");
  }

  async releaseReload(input: ResolutionKey & { claimToken: string }): Promise<void> {
    await this.release("release_mesa_reload_resolution", input, "Falha ao liberar resolução do reload");
  }

  async commitReload<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    const a = input.rpcArgs;
    return this.commitJson(
      `select public.commit_mesa_reload_resolution(
        $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::text,$7::integer,$8::integer,$9::integer,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::text
      ) as result`,
      [
        a.p_session_id, a.p_combat_id, a.p_resolution_id, a.p_claim_token,
        a.p_actor_id, a.p_weapon_id, a.p_magazine, a.p_actions_before,
        a.p_actions_after, jsonParameter(a.p_ammo_before), jsonParameter(a.p_ammo_after),
        jsonParameter(a.p_supplies_before), jsonParameter(a.p_supplies_after),
        jsonParameter(a.p_result), a.p_event_text,
      ],
      "Falha ao confirmar a resolução do reload",
    ) as Promise<TResult | null>;
  }

  async claimItemConsume<TResult = unknown>(key: ResolutionKey): Promise<ResolutionClaim<TResult> | null> {
    return this.claim(
      "claim_mesa_item_consume_resolution",
      key,
      "Falha ao reservar consumo de item",
    );
  }

  async findItemConsume<TResult = unknown>(key: ResolutionKey): Promise<ResolutionRecord<TResult> | null> {
    return this.findResolution("mesa_item_consume_resolutions", key, "Falha ao consultar a resolução do consumo");
  }

  async releaseItemConsume(input: ResolutionKey & { claimToken: string }): Promise<void> {
    await this.release(
      "release_mesa_item_consume_resolution",
      input,
      "Falha ao liberar consumo de item",
    );
  }

  async commitItemConsume<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    const a = input.rpcArgs;
    return this.commitJson(
      `select public.commit_mesa_item_consume_resolution(
        $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::integer,$7::integer,$8::jsonb,$9::jsonb,$10::text,$11::integer,$12::jsonb,$13::text
      ) as result`,
      [
        a.p_session_id,
        a.p_combat_id,
        a.p_resolution_id,
        a.p_claim_token,
        a.p_actor_id,
        a.p_actions_before,
        a.p_actions_after,
        jsonParameter(a.p_supplies_before),
        jsonParameter(a.p_supplies_after),
        a.p_item_name,
        a.p_amount,
        jsonParameter(a.p_result),
        a.p_event_text,
      ],
      "Falha ao confirmar consumo de item",
    );
  }

  async commitItemHeal<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    const a = input.rpcArgs;
    return this.commitJson(
      `select public.commit_mesa_item_heal_resolution(
        $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::integer,$7::integer,$8::jsonb,$9::jsonb,$10::integer,$11::integer,$12::text,$13::integer,$14::jsonb,$15::text
      ) as result`,
      [
        a.p_session_id,
        a.p_combat_id,
        a.p_resolution_id,
        a.p_claim_token,
        a.p_actor_id,
        a.p_actions_before,
        a.p_actions_after,
        jsonParameter(a.p_supplies_before),
        jsonParameter(a.p_supplies_after),
        a.p_hp_before,
        a.p_hp_after,
        a.p_item_name,
        a.p_amount,
        jsonParameter(a.p_result),
        a.p_event_text,
      ],
      "Falha ao confirmar cura por item",
    );
  }

  async commitDeathSave<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    const a = input.rpcArgs;
    return this.commitJson(
      `select public.commit_mesa_death_save_resolution(
        $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::integer,$7::boolean,$8::integer,$9::integer,$10::integer,$11::boolean,$12::jsonb,$13::text
      ) as result`,
      [
        a.p_session_id,
        a.p_combat_id,
        a.p_resolution_id,
        a.p_claim_token,
        a.p_actor_id,
        a.p_dc_before,
        a.p_dead_before,
        a.p_failures_before,
        a.p_dc_after,
        a.p_failures_after,
        a.p_dead_after,
        jsonParameter(a.p_result),
        a.p_event_text,
      ],
      "Falha ao confirmar a Death Save",
    );
  }

  async commitCoverDamage<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    const a = input.rpcArgs;
    return this.commitJson(
      `select public.commit_mesa_attack_cover_resolution(
        $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::integer,$7::integer,$8::jsonb,$9::jsonb,$10::text,$11::integer,$12::integer,$13::boolean,$14::jsonb,$15::text
      ) as result`,
      [
        a.p_session_id,
        a.p_combat_id,
        a.p_resolution_id,
        a.p_claim_token,
        a.p_actor_id,
        a.p_actions_before,
        a.p_actions_after,
        jsonParameter(a.p_ammo_before),
        jsonParameter(a.p_ammo_after),
        a.p_obstacle_id,
        a.p_hp_before,
        a.p_hp_after,
        a.p_destroyed,
        jsonParameter(a.p_result),
        a.p_event_text,
      ],
      "Falha ao confirmar dano da cobertura",
    );
  }

  async commitNetAction<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    const a = input.rpcArgs;
    return this.commitJson(
      `select public.commit_mesa_net_action_resolution(
        $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::integer,$7::integer,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,
         $12::jsonb,$13::jsonb,$14::jsonb,$15::text,$16::uuid
      ) as result`,
      [
        a.p_session_id,
        a.p_combat_id,
        a.p_resolution_id,
        a.p_claim_token,
        a.p_actor_id,
        a.p_actions_before,
        a.p_actions_after,
        jsonParameter(a.p_actor_state_before),
        jsonParameter(a.p_actor_state_after),
        jsonParameter(a.p_discovery_before),
        jsonParameter(a.p_discovery_after),
        jsonParameter(a.p_architecture_before),
        jsonParameter(a.p_architecture_after),
        jsonParameter(a.p_result),
        a.p_event_text,
        a.p_private_to_participant_id,
      ],
      "Falha ao confirmar NET Action",
    );
  }

  async commitQuickhack<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    const a = input.rpcArgs;
    return this.commitJson(
      `select public.commit_mesa_quickhack_resolution(
        $1::uuid,$2::uuid,$3::text,$4::uuid,$5::uuid,$6::uuid,$7::integer,$8::integer,$9::jsonb,$10::jsonb,$11::integer,$12::boolean,
         $13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb,$19::text
      ) as result`,
      [
        a.p_session_id,
        a.p_combat_id,
        a.p_resolution_id,
        a.p_claim_token,
        a.p_actor_id,
        a.p_target_id,
        a.p_actions_before,
        a.p_actions_after,
        jsonParameter(a.p_actor_state_before),
        jsonParameter(a.p_actor_state_after),
        a.p_target_hp_before,
        a.p_target_dead_before,
        jsonParameter(a.p_target_patch),
        jsonParameter(a.p_target_effects),
        jsonParameter(a.p_target_conditions),
        jsonParameter(a.p_target_supplies_before),
        jsonParameter(a.p_target_supplies_after),
        jsonParameter(a.p_result),
        a.p_event_text,
      ],
      "Falha ao confirmar Quickhack",
    );
  }

  async commitInitiative<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null> {
    const result = await this.pool.query(
      `update public.mesa_attack_resolutions
          set status = 'committed', result = $1::jsonb, committed_at = now(), updated_at = now()
        where session_id = $2 and combat_id = $3 and resolution_id = $4 and claim_token = $5 and status = 'processing'
        returning result`,
      [jsonParameter(input.rpcArgs.p_result), input.sessionId, input.combatId, input.resolutionId, input.claimToken],
    );
    return (result.rows[0]?.result ?? null) as TResult | null;
  }

  private async findResolution<TResult>(table: "mesa_attack_resolutions" | "mesa_reload_resolutions" | "mesa_item_consume_resolutions", key: ResolutionLookupKey, context: string): Promise<ResolutionRecord<TResult> | null> {
    const params: unknown[] = [key.sessionId];
    const filters = ["session_id=$1"];
    if (key.combatId) { params.push(key.combatId); filters.push(`combat_id=$${params.length}`); }
    params.push(key.resolutionId);
    filters.push(`resolution_id=$${params.length}`);
    const rows = await this.rowsWithContext<ResolutionRecord<TResult>>(
      `select combat_id,status,claim_token,result from public.${table} where ${filters.join(" and ")} order by created_at desc limit 1`,
      params,
      context,
    );
    return rows[0] ?? null;
  }

  private async recover<TResult>(functionName: string, key: ResolutionKey, context: string): Promise<ResolutionRecoveryRecord<TResult> | null> {
    const rows = await this.rowsWithContext<ResolutionRecoveryRecord<TResult>>(
      `select * from public.${functionName}($1,$2,$3)`,
      [key.sessionId, key.combatId, key.resolutionId],
      context,
    );
    return rows[0] ?? null;
  }

  private async claim<TResult>(functionName: string, key: ResolutionKey, context: string): Promise<ResolutionClaim<TResult> | null> {
    const rows = await this.rowsWithContext<ResolutionClaim<TResult>>(
      `select * from public.${functionName}($1,$2,$3)`,
      [key.sessionId, key.combatId, key.resolutionId],
      context,
    );
    return rows[0] ?? null;
  }

  private async release(functionName: string, input: ResolutionKey & { claimToken: string }, context: string): Promise<void> {
    await this.rowsWithContext(
      `select public.${functionName}($1,$2,$3,$4)`,
      [input.sessionId, input.combatId, input.resolutionId, input.claimToken],
      context,
    );
  }

  private async commitJson<TResult>(sql: string, params: unknown[], context: string): Promise<TResult | null> {
    const rows = await this.rowsWithContext<{ result: TResult | null }>(sql, params, context);
    return rows[0]?.result ?? null;
  }

  private async rowsWithContext<T>(sql: string, params: unknown[], context: string): Promise<T[]> {
    try {
      return (await this.pool.query(sql, params)).rows as T[];
    } catch (error) {
      throw new DatabaseQueryError(`${context}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** Compatibilidade nominal para consumidores que só precisam do commit de movimento. */
export class LocalPostgresMoveResolutionStore extends LocalPostgresResolutionStore {}

function jsonParameter(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function battleJsonColumn(name: string): boolean {
  return name === "combatants" || name === "event_log";
}

/** União das chaves dos payloads, preservando a ordem da primeira ocorrência. */
function payloadColumns(rows: ReadonlyArray<CombatantRowPayload>): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(column(key));
    }
  }
  return columns;
}
