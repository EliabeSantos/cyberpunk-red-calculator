/**
 * Contratos server-side da infraestrutura da Mesa.
 *
 * Esta camada descreve operações que já existem no store; ela não contém
 * regras de Cyberpunk RED nem decide autorização. Os adapters Supabase e
 * PostgreSQL local cumprem os mesmos contratos sem alterar a fachada de
 * `store.ts`.
 */

export interface MesaSessionRecord {
  id: string;
  name: string;
  gm_id: string | null;
  status: string;
  join_code: string;
  created_at: string;
  updated_at?: string;
  [column: string]: unknown;
}

export interface MesaSessionCreate {
  name: string;
  joinCode: string;
  status: string;
}

export interface MesaParticipantRecord {
  id: string;
  session_id: string;
  player_token: string;
  display_name: string;
  character_id: string | null;
  role: "gm" | "player";
  created_at: string;
  connected_at: string;
  [column: string]: unknown;
}

export interface MesaParticipantCreate {
  sessionId: string;
  playerToken: string;
  displayName: string;
  role: "gm" | "player";
}

export interface MesaCharacterRecord {
  id: string;
  owner_token: string;
  display_name: string;
  sheet: unknown;
  updated_at?: string;
  [column: string]: unknown;
}

export interface MesaCharacterUpsert {
  id: string;
  ownerToken: string;
  displayName: string;
  sheet: unknown;
  updatedAt: string;
}

export interface MesaCombatRecord {
  id: string;
  session_id: string;
  status: string;
  [column: string]: unknown;
}

export interface MesaCombatCreate {
  sessionId: string;
  status: string;
  round?: number;
  initiativeStarted?: boolean;
  eventLog?: unknown;
}

export interface MesaBattleRecord {
  id: string;
  session_id: string;
  join_code: string;
  encounter_id: string | null;
  encounter_name: string;
  status: "active" | "completed";
  started_at: string;
  ended_at: string | null;
  final_round: number | null;
  combatants: unknown;
  event_log: unknown;
  [column: string]: unknown;
}

export interface MesaBattleCreate {
  sessionId: string;
  joinCode: string;
  encounterId: string | null;
  encounterName: string;
}

export interface MesaCombatantRecord {
  id: string;
  combat_id: string;
  session_id: string;
  kind: "character" | "enemy";
  participant_id: string | null;
  [column: string]: unknown;
}

export interface CombatantWrite {
  id: string;
  /** Filtros de escopo são obrigatórios no consumidor para evitar cross-Mesa. */
  sessionId?: string;
  combatId?: string;
  patch: Readonly<Record<string, unknown>>;
  /** Valores anteriores para uma escrita CAS; vazio significa update comum. */
  expected?: Readonly<Record<string, unknown>>;
}

/** Escrita condicional de HP já calculado pelo domínio/engine. */
export interface CombatantHpWrite {
  id: string;
  sessionId: string;
  combatId: string;
  patch: Readonly<Record<string, unknown>>;
  expected?: Readonly<Record<string, unknown>>;
}

/** Débito atômico de economia de ações, com todos os valores esperados no CAS. */
export interface CombatantActionDebit {
  id: string;
  sessionId: string;
  combatId: string;
  patch: Readonly<Record<string, unknown>>;
  expected: Readonly<Record<string, unknown>>;
}

/**
 * Escopo de remoção de combatents.
 *
 * A união é proposital: toda remoção precisa nomear pelo menos uma chave. Não
 * existe operação legal de apagar a tabela inteira, então um escopo vazio é
 * recusado pelo adapter também em tempo de execução.
 */
export type CombatantScope =
  | { id: string; combatId?: string; sessionId?: string }
  | { id?: string; combatId: string; sessionId?: string }
  | { id?: string; combatId?: string; sessionId: string };

/** Uma linha de `mesa_combatants` no formato exato persistido no banco. */
export type CombatantRowPayload = Record<string, unknown>;

/**
 * Consultas e escritas reais já existentes para combates e combatants.
 *
 * Os métodos de escrita não decidem nada de gameplay: recebem linhas já
 * montadas pelo domínio (materialização, iniciativa, ICE) e devolvem erro de
 * infraestrutura quando o banco recusar. Autorização, regras e payloads
 * continuam em `store.ts`.
 */
export interface MesaRepository {
  findSessionById(sessionId: string): Promise<MesaSessionRecord | null>;
  /** Leitura/escrita do snapshot NET da sessão; projeção permanece no store. */
  findSessionNetArchitectures(sessionId: string): Promise<unknown | null>;
  updateSessionNetArchitectures(sessionId: string, architectures: unknown): Promise<MesaSessionRecord[]>;
  findSessionByJoinCode(joinCode: string): Promise<MesaSessionRecord | null>;
  createSession(input: MesaSessionCreate): Promise<MesaSessionRecord>;
  updateSession(sessionId: string, patch: Readonly<Record<string, unknown>>, expected?: Readonly<Record<string, unknown>>): Promise<MesaSessionRecord[]>;
  deleteSession(sessionId: string): Promise<void>;
  findParticipantByToken(sessionId: string, playerToken: string): Promise<MesaParticipantRecord | null>;
  listParticipantsBySession(sessionId: string): Promise<MesaParticipantRecord[]>;
  insertParticipant(input: MesaParticipantCreate): Promise<MesaParticipantRecord>;
  updateParticipant(participantId: string, sessionId: string, patch: Readonly<Record<string, unknown>>): Promise<MesaParticipantRecord[]>;
  deleteParticipant(participantId: string, sessionId: string): Promise<void>;
  findCharacterById(characterId: string): Promise<MesaCharacterRecord | null>;
  upsertCharacter(input: MesaCharacterUpsert): Promise<MesaCharacterRecord>;
  findCombatBySession(sessionId: string): Promise<MesaCombatRecord | null>;
  findCombatById(combatId: string, sessionId?: string): Promise<MesaCombatRecord | null>;
  createCombat(input: MesaCombatCreate): Promise<MesaCombatRecord>;
  updateCombat(combatId: string, sessionId: string, patch: Readonly<Record<string, unknown>>): Promise<MesaCombatRecord[]>;
  findCombatEventLog(combatId: string, sessionId: string): Promise<unknown[]>;
  replaceCombatEventLog(
    combatId: string,
    sessionId: string,
    eventLog: unknown,
    expectedEventLog?: unknown,
  ): Promise<MesaCombatRecord[]>;
  findBattleByEncounter(encounterId: string): Promise<MesaBattleRecord | null>;
  findActiveBattle(sessionId: string): Promise<MesaBattleRecord | null>;
  createBattle(input: MesaBattleCreate): Promise<MesaBattleRecord>;
  updateBattle(battleId: string, sessionId: string, patch: Readonly<Record<string, unknown>>): Promise<MesaBattleRecord[]>;
  /** Conclusão condicional: só uma partida ainda ativa pode ser concluída. */
  completeBattle(battleId: string, sessionId: string, patch: Readonly<Record<string, unknown>>): Promise<MesaBattleRecord[]>;
  deleteBattle(battleId: string, sessionId: string): Promise<void>;
  listBattles(sessionId: string, limit?: number): Promise<MesaBattleRecord[]>;
  listCombatantsByCombat(combatId: string, sessionId?: string): Promise<MesaCombatantRecord[]>;
  listCombatantsBySession(sessionId: string): Promise<MesaCombatantRecord[]>;
  findCombatantById(combatantId: string, scope: { combatId?: string; sessionId?: string }): Promise<MesaCombatantRecord | null>;
  /** Atualiza HP/estado auxiliar já resolvido, sem calcular regras. */
  updateCombatantHp(input: CombatantHpWrite): Promise<MesaCombatantRecord[]>;
  /** Aplica um débito de ações/movimento como uma única atualização CAS. */
  debitCombatantAction(input: CombatantActionDebit): Promise<MesaCombatantRecord[]>;
  updateCombatant(input: CombatantWrite): Promise<MesaCombatantRecord[]>;

  /**
   * Materialização: insere linhas novas. Duplicidade de `id` é erro de
   * infraestrutura, nunca merge silencioso.
   *
   * `context` é a mensagem de erro já usada pelo domínio (ex. "Falha ao criar
   * os combatentes"); o adapter apenas a prefixa com o detalhe do banco.
   */
  insertCombatants(rows: ReadonlyArray<CombatantRowPayload>, context: string): Promise<void>;
  /** Upsert por `id`: só as colunas presentes no payload são substituídas. */
  upsertCombatants(rows: ReadonlyArray<CombatantRowPayload>, context: string): Promise<void>;
  /** Remove linhas dentro do escopo informado; escopo vazio é recusado. */
  deleteCombatants(scope: CombatantScope, context: string): Promise<void>;
}

export type ResolutionStatus = "missing" | "processing" | "committed" | "failed";

export interface ResolutionRecord<TResult = unknown> {
  combat_id: string;
  status: ResolutionStatus;
  claim_token: string;
  result: TResult | null;
}

export interface ResolutionRecoveryRecord<TResult = unknown> {
  status: ResolutionStatus;
  result: TResult | null;
}

export interface ResolutionClaim<TResult = unknown> {
  claimed: boolean;
  status: ResolutionStatus;
  claim_token: string;
  result: TResult | null;
}

export interface ResolutionKey {
  sessionId: string;
  combatId: string;
  resolutionId: string;
}

export type ResolutionLookupKey = Omit<ResolutionKey, "combatId"> & { combatId?: string };

/**
 * Argumentos já validados pelo store para uma função SQL de resolução.
 * `rpcArgs` conserva os nomes p_* do contrato PostgreSQL; o adapter local
 * deverá interpretar os mesmos argumentos dentro de uma transação.
 */
export interface ResolutionCommit<TResult = unknown> extends ResolutionKey {
  claimToken: string;
  rpcArgs: Readonly<Record<string, unknown>>;
  result?: TResult;
}

export interface MoveResolutionCommitResult<TResult = unknown> {
  status: "committed" | "already_committed";
  result: TResult | null;
}

/**
 * Operações de concorrência persistente da Mesa.
 *
 * Os métodos são separados por família porque as migrations usam tabelas/RPCs
   * diferentes para ataque, reload, consumo e Death Save. Isso evita um repository genérico
 * que pudesse misturar payloads ou resolução de mesas diferentes.
 */
export interface ResolutionStore {
  findAttack<TResult = unknown>(key: ResolutionLookupKey): Promise<ResolutionRecord<TResult> | null>;
  recoverAttack<TResult = unknown>(key: ResolutionKey): Promise<ResolutionRecoveryRecord<TResult> | null>;
  claimAttack<TResult = unknown>(key: ResolutionKey): Promise<ResolutionClaim<TResult> | null>;
  releaseAttack(key: ResolutionKey & { claimToken: string }): Promise<void>;
  commitAttack<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null>;

  findReload<TResult = unknown>(key: ResolutionLookupKey): Promise<ResolutionRecord<TResult> | null>;
  recoverReload<TResult = unknown>(key: ResolutionKey): Promise<ResolutionRecoveryRecord<TResult> | null>;
  claimReload<TResult = unknown>(key: ResolutionKey): Promise<ResolutionClaim<TResult> | null>;
  releaseReload(key: ResolutionKey & { claimToken: string }): Promise<void>;
  commitReload<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null>;

  claimItemConsume<TResult = unknown>(key: ResolutionKey): Promise<ResolutionClaim<TResult> | null>;
  findItemConsume<TResult = unknown>(key: ResolutionKey): Promise<ResolutionRecord<TResult> | null>;
  releaseItemConsume(key: ResolutionKey & { claimToken: string }): Promise<void>;
  commitItemConsume<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null>;
  commitItemHeal<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null>;

  commitMove<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<MoveResolutionCommitResult<TResult> | null>;
  commitDeathSave<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null>;
  commitCoverDamage<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null>;
  commitNetAction<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null>;
  commitQuickhack<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null>;
  commitInitiative<TResult = unknown>(input: ResolutionCommit<TResult>): Promise<TResult | null>;
}

export interface MesaInvalidation {
  sessionId: string;
  stateVersion?: string;
  publishedAt: number;
}

export interface MesaEventSubscription {
  close(): void;
}

/** Transporte comum: somente invalida; snapshots continuam fora do evento. */
export interface MesaEventTransport {
  publishInvalidation(sessionId: string): Promise<void>;
  subscribeInvalidation(
    sessionId: string,
    onInvalidate: (event: MesaInvalidation) => void,
    onStatus?: (status: string) => void,
  ): MesaEventSubscription | null;
}
