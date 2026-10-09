/** Factory explícita e lifecycle dos recursos server-side da Mesa. */
import { Pool, type PoolClient } from "pg";

import type { SupabaseClient } from "@supabase/supabase-js";

import { LocalPostgresMesaRepository, LocalPostgresResolutionStore } from "@/lib/mesa/localPostgresInfrastructure";
import { LocalMesaEventTransport } from "@/lib/mesa/localEventTransport";
import type { MesaEventTransport, MesaRepository, ResolutionStore } from "@/lib/mesa/infrastructure";

export type MesaHostingMode = "supabase" | "local";

export interface MesaHostingInfrastructure {
  readonly mode: MesaHostingMode;
  readonly repository: MesaRepository;
  readonly resolutionStore: ResolutionStore;
  readonly eventTransport: MesaEventTransport;
  /** Disponível somente no modo local; Supabase não é simulado como transacional. */
  readonly beginLocalTransaction?: () => Promise<LocalPostgresTransactionContext>;
}

export interface MesaHostingFactoryOptions {
  supabaseClient?: SupabaseClient;
  /** Pool já gerenciado pelo bootstrap ou por um teste. */
  localPool?: Pick<Pool, "query">;
  /** Lifecycle correspondente ao pool injetado, quando houver. */
  localLifecycle?: LocalPostgresLifecycle;
  /** Transporte injetável; o padrão é o barramento local em memória. */
  localEventTransport?: MesaEventTransport;
}

export type LocalPostgresLifecycleState = "starting" | "ready" | "degraded" | "closing" | "closed";

export interface LocalPostgresLifecycle {
  readonly databaseKey: string;
  readonly state: LocalPostgresLifecycleState;
  readonly activeOperations: number;
  readonly pool: Pick<Pool, "query">;
  checkAvailability(): Promise<void>;
  beginTransaction(): Promise<LocalPostgresTransactionContext>;
  close(timeoutMs?: number): Promise<void>;
}

export interface LocalPostgresTransactionContext {
  readonly repository: LocalPostgresMesaRepository;
  readonly resolutionStore: LocalPostgresResolutionStore;
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): Promise<void>;
}

export class MesaHostingConfigurationError extends Error {
  readonly code: "missing_mode" | "invalid_mode" | "incomplete_mode";
  readonly mode: string | null;
  readonly missingComponents: readonly string[];

  constructor(
    code: MesaHostingConfigurationError["code"],
    message: string,
    mode: string | null,
    missingComponents: readonly string[] = [],
  ) {
    super(message);
    this.name = "MesaHostingConfigurationError";
    this.code = code;
    this.mode = mode;
    this.missingComponents = missingComponents;
  }
}

export class LocalPostgresConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalPostgresConfigurationError";
  }
}

export class LocalPostgresAvailabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalPostgresAvailabilityError";
  }
}

export class LocalPostgresConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalPostgresConnectionError";
  }
}

export class LocalPostgresShutdownTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalPostgresShutdownTimeoutError";
  }
}

const DEFAULT_CLOSE_TIMEOUT_MS = 10_000;

export type ManagedLocalPostgresPool = Pick<Pool, "query" | "end" | "connect"> & { on?: Pool["on"] };
type SharedLocalPool = Pick<Pool, "query">;

const globalForMesaHosting = globalThis as unknown as {
  mesaLocalLifecycles?: Map<string, LocalPostgresLifecycleImpl>;
};

function safeDatabaseKey(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.pathname.replace(/^\//, "") || "local-postgres";
  } catch {
    return "local-postgres";
  }
}

/**
 * Pool compartilhado por URL. Queries passam pelo gate para impedir novas
 * operações depois que o shutdown começou.
 */
class LocalPostgresLifecycleImpl implements LocalPostgresLifecycle {
  readonly databaseKey: string;
  state: LocalPostgresLifecycleState = "starting";
  activeOperations = 0;
  readonly pool: SharedLocalPool;
  private readonly rawPool: ManagedLocalPostgresPool;
  private readonly closeWaiters: Array<() => void> = [];

  constructor(rawPool: ManagedLocalPostgresPool, databaseKey: string) {
    this.rawPool = rawPool;
    this.databaseKey = databaseKey;
    this.pool = {
      query: ((...args: unknown[]) => this.runQuery(args)) as Pool["query"],
    };
    rawPool.on?.("error", () => {
      if (this.state === "ready") this.state = "degraded";
    });
  }

  async checkAvailability(): Promise<void> {
    if (this.state === "closing" || this.state === "closed") {
      throw new LocalPostgresAvailabilityError("PostgreSQL local está encerrando ou já foi encerrado.");
    }
    try {
      await this.runQuery(["select 1"]);
      this.state = "ready";
    } catch {
      this.state = "degraded";
      throw new LocalPostgresAvailabilityError("PostgreSQL local indisponível para a Mesa.");
    }
  }

  private async runQuery(args: unknown[]): Promise<unknown> {
    if (this.state === "closing" || this.state === "closed") {
      throw new LocalPostgresConnectionError("Nova operação recusada: PostgreSQL local está encerrando.");
    }
    this.activeOperations += 1;
    try {
      return await (this.rawPool.query as (...values: unknown[]) => Promise<unknown>)(...args);
    } catch {
      throw new LocalPostgresConnectionError("Falha de conexão com o PostgreSQL local.");
    } finally {
      this.activeOperations -= 1;
      if (this.activeOperations === 0) {
        const waiters = this.closeWaiters.splice(0);
        for (const resolve of waiters) resolve();
      }
    }
  }

  async beginTransaction(): Promise<LocalPostgresTransactionContext> {
    if (this.state === "closing" || this.state === "closed") {
      throw new LocalPostgresConnectionError("Nova transação recusada: PostgreSQL local está encerrando.");
    }
    this.activeOperations += 1;
    let client: PoolClient;
    try {
      client = await this.rawPool.connect();
    } catch {
      this.activeOperations -= 1;
      throw new LocalPostgresConnectionError("Falha ao iniciar transação no PostgreSQL local.");
    }
    try {
      await client.query("BEGIN");
    } catch {
      // Se a conexão foi adquirida mas o BEGIN falhou, ela ainda precisa
      // voltar ao pool. Não deixamos uma conexão presa nem reutilizamos um
      // contexto parcialmente inicializado.
      client.release();
      this.activeOperations -= 1;
      throw new LocalPostgresConnectionError("Falha ao iniciar transação no PostgreSQL local.");
    }
    return new LocalPostgresTransactionContextImpl(client, () => {
      this.activeOperations -= 1;
      if (this.activeOperations === 0) {
        const waiters = this.closeWaiters.splice(0);
        for (const resolve of waiters) resolve();
      }
    });
  }

  async close(timeoutMs = DEFAULT_CLOSE_TIMEOUT_MS): Promise<void> {
    if (this.state === "closed") return;
    this.state = "closing";
    if (this.activeOperations > 0) {
      await Promise.race([
        new Promise<void>((resolve) => this.closeWaiters.push(resolve)),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new LocalPostgresShutdownTimeoutError(
            "PostgreSQL local não encerrou dentro do prazo; operações ativas foram preservadas.",
          )), timeoutMs);
        }),
      ]);
    }
    try {
      await this.rawPool.end();
      this.state = "closed";
    } catch {
      // O recurso continua fechado para novas operações, mas não fingimos que
      // o encerramento terminou. Uma tentativa controlada pode ser feita pelo
      // bootstrap, sem descartar conexões ativas arbitrariamente.
      throw new LocalPostgresConnectionError("Falha ao encerrar o PostgreSQL local.");
    }
  }
}

class LocalPostgresTransactionContextImpl implements LocalPostgresTransactionContext {
  readonly repository: LocalPostgresMesaRepository;
  readonly resolutionStore: LocalPostgresResolutionStore;
  private state: "open" | "committed" | "rolled_back" | "released" = "open";
  private readonly client: PoolClient;
  private readonly onRelease: () => void;

  constructor(client: PoolClient, onRelease: () => void) {
    this.client = client;
    this.onRelease = onRelease;
    this.repository = new LocalPostgresMesaRepository(client);
    this.resolutionStore = new LocalPostgresResolutionStore(client);
  }

  private assertOpen(): void {
    if (this.state !== "open") throw new LocalPostgresConnectionError("Contexto transacional já foi finalizado.");
  }

  async query(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    this.assertOpen();
    return this.client.query(sql, params) as Promise<{ rows: unknown[] }>;
  }

  async commit(): Promise<void> {
    this.assertOpen();
    try {
      await this.client.query("COMMIT");
      this.state = "committed";
    } catch {
      throw new LocalPostgresConnectionError("Falha ao confirmar transação no PostgreSQL local.");
    }
  }

  async rollback(): Promise<void> {
    if (this.state === "released" || this.state === "rolled_back") return;
    if (this.state === "committed") throw new LocalPostgresConnectionError("Não é possível desfazer uma transação já confirmada.");
    try {
      await this.client.query("ROLLBACK");
      this.state = "rolled_back";
    } catch {
      throw new LocalPostgresConnectionError("Falha ao desfazer transação no PostgreSQL local.");
    }
  }

  async release(): Promise<void> {
    if (this.state === "released") return;
    if (this.state === "open") {
      try { await this.rollback(); } catch { /* release abaixo ainda é obrigatório */ }
    }
    try {
      this.client.release();
    } catch {
      // Mesmo um client que rejeite release não pode manter o lifecycle preso
      // indefinidamente; o pool/driver continua responsável pelo descarte.
      throw new LocalPostgresConnectionError("Falha ao devolver conexão transacional ao pool.");
    } finally {
      this.state = "released";
      this.onRelease();
    }
  }
}

/** Cria um lifecycle sobre um pool já fornecido pelo bootstrap/teste. */
export function createLocalPostgresLifecycle(
  pool: ManagedLocalPostgresPool,
  databaseKey = "local-postgres",
): LocalPostgresLifecycle {
  return new LocalPostgresLifecycleImpl(pool, databaseKey);
}

/** Executa callback e garante commit, rollback em erro e release da conexão. */
export async function withLocalPostgresTransaction<T>(
  callback: (context: LocalPostgresTransactionContext) => Promise<T>,
  rawUrl = process.env.MESA_LOCAL_DATABASE_URL,
): Promise<T> {
  const lifecycle = await getLocalPostgresLifecycle(rawUrl);
  const context = await lifecycle.beginTransaction();
  let operationFailed = false;
  try {
    const result = await callback(context);
    await context.commit();
    return result;
  } catch (error) {
    operationFailed = true;
    try { await context.rollback(); } catch { /* preserva o erro original */ }
    throw error;
  } finally {
    try {
      await context.release();
    } catch (releaseError) {
      if (!operationFailed) throw releaseError;
    }
  }
}

function requestedMode(raw: string | undefined): MesaHostingMode {
  const mode = raw?.trim().toLowerCase() ?? "";
  if (!mode) throw new MesaHostingConfigurationError("missing_mode", "MESA_HOSTING_MODE é obrigatória e deve ser 'supabase' ou 'local'.", null);
  if (mode !== "supabase" && mode !== "local") {
    throw new MesaHostingConfigurationError("invalid_mode", `MESA_HOSTING_MODE inválida: '${mode}'. Use somente 'supabase' ou 'local'.`, mode);
  }
  return mode;
}

async function localPoolFromEnvironment(): Promise<SharedLocalPool> {
  const url = process.env.MESA_LOCAL_DATABASE_URL?.trim();
  if (!url) {
    throw new MesaHostingConfigurationError("incomplete_mode", "Modo local incompleto: MESA_LOCAL_DATABASE_URL não configurada.", "local", ["MESA_LOCAL_DATABASE_URL"]);
  }
  const lifecycle = await getLocalPostgresLifecycle(url);
  return lifecycle.pool;
}

export interface LocalPostgresLifecycleOptions {
  /** Injeção somente para testes/bootstrap controlado; produção usa `new Pool`. */
  createPool?: () => ManagedLocalPostgresPool;
}

/** Obtém o lifecycle memoizado, executando health check antes de disponibilizar o pool. */
export async function getLocalPostgresLifecycle(
  rawUrl = process.env.MESA_LOCAL_DATABASE_URL,
  options: LocalPostgresLifecycleOptions = {},
): Promise<LocalPostgresLifecycle> {
  const url = rawUrl?.trim();
  if (!url) throw new LocalPostgresConfigurationError("MESA_LOCAL_DATABASE_URL não configurada.");
  const lifecycles = globalForMesaHosting.mesaLocalLifecycles ??= new Map();
  let lifecycle = lifecycles.get(url);
  if (lifecycle?.state === "ready") return lifecycle;
  if (!lifecycle || lifecycle.state === "closed") {
    lifecycle = new LocalPostgresLifecycleImpl(options.createPool?.() ?? new Pool({ connectionString: url }), safeDatabaseKey(url));
    lifecycles.set(url, lifecycle);
  }
  await lifecycle.checkAvailability();
  return lifecycle;
}

/** Fecha pools conhecidos; não inicia recursos e não força descarte de operações ativas. */
export async function closeLocalPostgresLifecycles(timeoutMs = DEFAULT_CLOSE_TIMEOUT_MS): Promise<void> {
  const lifecycles = globalForMesaHosting.mesaLocalLifecycles;
  if (!lifecycles) return;
  await Promise.all([...lifecycles.values()].map((lifecycle) => lifecycle.close(timeoutMs)));
  for (const [url, lifecycle] of lifecycles) if (lifecycle.state === "closed") lifecycles.delete(url);
}

/** Cria os componentes de um único modo explícito. */
export async function createMesaHostingInfrastructure(
  rawMode = process.env.MESA_HOSTING_MODE,
  options: MesaHostingFactoryOptions = {},
): Promise<MesaHostingInfrastructure> {
  const mode = requestedMode(rawMode);
  if (mode === "local") {
    const eventTransport = options.localEventTransport ?? new LocalMesaEventTransport();
    const pool = options.localPool ?? await localPoolFromEnvironment();
    // Um lifecycle descoberto pelo URL só pode acompanhar o pool criado pelo
    // próprio lifecycle. Quando um pool é injetado, exigir também o lifecycle
    // correspondente evita expor um contexto transacional ligado a outro
    // banco/conexão que não é o usado pelos repositories da factory.
    const lifecycle = options.localLifecycle ?? (!options.localPool && process.env.MESA_LOCAL_DATABASE_URL
      ? await getLocalPostgresLifecycle(process.env.MESA_LOCAL_DATABASE_URL)
      : null);
    return {
      mode,
      repository: new LocalPostgresMesaRepository(pool),
      resolutionStore: new LocalPostgresResolutionStore(pool),
      eventTransport,
      ...(lifecycle ? { beginLocalTransaction: () => lifecycle.beginTransaction() } : {}),
    };
  }

  // Import tardio: selecionar local não importa nem inicializa Supabase.
  const { SupabaseMesaEventTransport, SupabaseMesaRepository, SupabaseResolutionStore } = await import("@/lib/mesa/supabaseInfrastructure");
  const client = options.supabaseClient ?? (await import("@/lib/supabaseAdmin")).getSupabaseAdmin();
  return { mode, repository: new SupabaseMesaRepository(client), resolutionStore: new SupabaseResolutionStore(client), eventTransport: new SupabaseMesaEventTransport() };
}
