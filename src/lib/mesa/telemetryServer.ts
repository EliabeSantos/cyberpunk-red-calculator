import { AsyncLocalStorage } from "node:async_hooks";
import { createId } from "@/lib/id";

interface ServerContext {
  traceId: string;
  action: string;
  sessionId?: string;
  resolutionId?: string;
  startedAt: number;
  stages: Record<string, number>;
  dbCalls: number;
}

export interface MesaTelemetryRef {
  traceId: string;
  action: string;
  sessionId?: string;
  resolutionId?: string;
}

const requestContext = new AsyncLocalStorage<ServerContext | undefined>();

function safeSessionId(sessionId: string): string {
  return sessionId.length <= 8 ? sessionId : sessionId.slice(0, 8);
}

function write(context: MesaTelemetryRef, stage: string, durationMs?: number, success?: boolean, details?: Record<string, string | number>): void {
  try {
    console.debug("[mesa-telemetry]", JSON.stringify({
      traceId: context.traceId,
      action: context.action,
      ...(context.sessionId ? { sessionId: safeSessionId(context.sessionId) } : {}),
      ...(context.resolutionId ? { resolutionId: context.resolutionId } : {}),
      stage,
      at: Date.now(),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(success === undefined ? {} : { success }),
      ...(details ?? {}),
    }));
  } catch {
    // Telemetry must never change the result of the authoritative action.
  }
}

export function currentMesaTelemetry(): ServerContext | undefined {
  return requestContext.getStore();
}

export function captureMesaTelemetry(): MesaTelemetryRef | undefined {
  const context = currentMesaTelemetry();
  if (!context) return undefined;
  return {
    traceId: context.traceId,
    action: context.action,
    sessionId: context.sessionId,
    resolutionId: context.resolutionId,
  };
}

export function markMesaPublishStage(
  reference: MesaTelemetryRef | undefined,
  stage: string,
  durationMs?: number,
  success?: boolean,
): void {
  if (!reference) return;
  write(reference, stage, durationMs, success, durationMs === undefined ? undefined : { publish_duration_ms: durationMs });
}

export function beginMesaGatewayTelemetry(request: Request): void {
  const path = new URL(request.url).pathname;
  const action = path.includes("/combat/attack") ? "attack"
    : path.includes("/combat/move") ? "movement"
      : path.includes("/combat/player-damage") || path.includes("/combat/damage") ? "damage"
        : path.includes("/combat/player-heal") || path.includes("/combat/item-heal") ? "healing"
          : path.includes("/combat/initiative") ? "initiative"
            : path.includes("/combat/turn") ? "turn"
              : path.includes("/combat/net/device") ? "door"
                : path.includes("/combat/net/quickhack") ? "quickhack"
                  : path.includes("/combat/net/connection") ? "jack"
                    : path.includes("/combat/net/action") ? "net_action"
                      : "mesa";
  const context: ServerContext = {
    traceId: request.headers.get("x-mesa-telemetry-id") ?? createId(),
    action,
    sessionId: path.match(/\/api\/mesa\/([^/]+)/)?.[1],
    startedAt: performance.now(),
    stages: {},
    dbCalls: 0,
  };
  requestContext.enterWith(context);
  write(context, "T2");
}

export function finishMesaGatewayTelemetry(success: boolean, outcome?: "success" | "expected_rejection" | "infrastructure_error"): void {
  const context = currentMesaTelemetry();
  if (context) {
    if (context.stages.dbMs !== undefined) {
      write(context, "T4", context.stages.dbMs, true, {
        db_wall_time_sum_ms: context.stages.dbMs,
        db_call_count: context.dbCalls,
        measurement: "external_call_wall_time_sum",
      });
    }
    const gatewayDurationMs = performance.now() - context.startedAt;
    write(context, "gateway", gatewayDurationMs, success, {
      gateway_duration_ms: gatewayDurationMs,
      ...(outcome ? { outcome } : {}),
    });
    // O contexto é isolado pelo AsyncLocalStorage; não há estado global para
    // limpar nem risco de apagar o contexto de outra requisição concorrente.
    requestContext.enterWith(undefined);
  }
}

export async function runMesaGatewayTelemetry<T>(input: {
  action: string;
  request: Request;
  sessionId?: string;
  resolutionId?: string;
  handler: () => Promise<T>;
}): Promise<T> {
  const context: ServerContext = {
    traceId: input.request.headers.get("x-mesa-telemetry-id") ?? createId(),
    action: input.action,
    sessionId: input.sessionId,
    resolutionId: input.resolutionId,
    startedAt: performance.now(),
    stages: {},
    dbCalls: 0,
  };
  return requestContext.run(context, async () => {
    write(context, "T2");
    try {
      const result = await input.handler();
      const gatewayDurationMs = performance.now() - context.startedAt;
      write(context, "gateway", gatewayDurationMs, true, { gateway_duration_ms: gatewayDurationMs, outcome: "success" });
      return result;
    } catch (error) {
      const gatewayDurationMs = performance.now() - context.startedAt;
      write(context, "gateway", gatewayDurationMs, false, { gateway_duration_ms: gatewayDurationMs, outcome: "infrastructure_error" });
      throw error;
    }
  });
}

export async function measureMesaDb<T>(operation: PromiseLike<T>, operationName = "unlabeled"): Promise<T> {
  const context = currentMesaTelemetry();
  if (!context) {
    console.debug("[mesa-telemetry] db_context_missing", JSON.stringify({ operation: operationName }));
    return operation;
  }
  const startedAt = performance.now();
  if (context.stages.dbStartedAt === undefined) {
    context.stages.dbStartedAt = startedAt;
    write(context, "T3");
  }
  const callIndex = ++context.dbCalls;
  try {
    const result = await operation;
    const durationMs = performance.now() - startedAt;
    context.stages.dbMs = (context.stages.dbMs ?? 0) + durationMs;
    write(context, "DB_OP", durationMs, true, {
      operation: operationName,
      callIndex,
      db_op_duration_ms: durationMs,
      measurement: "external_call_wall_time",
    });
    return result;
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    context.stages.dbMs = (context.stages.dbMs ?? 0) + durationMs;
    write(context, "DB_OP", durationMs, false, {
      operation: operationName,
      callIndex,
      db_op_duration_ms: durationMs,
      measurement: "external_call_wall_time",
    });
    throw error;
  }
}

/** Mede uma etapa síncrona local sem alterar seu valor ou sua exceção. */
export function measureMesaLocal<T>(stage: string, operation: () => T): T {
  const startedAt = performance.now();
  try {
    const result = operation();
    markMesaLocalStage(stage, performance.now() - startedAt, true);
    return result;
  } catch (error) {
    markMesaLocalStage(stage, performance.now() - startedAt, false);
    throw error;
  }
}

export function markMesaServerStage(stage: string, durationMs?: number, success?: boolean): void {
  const context = currentMesaTelemetry();
  if (context) write(context, stage, durationMs, success);
}

/** Marca processamento local sem confundi-lo com o tempo da Promise Supabase. */
export function markMesaLocalStage(stage: string, durationMs: number, success = true): void {
  const context = currentMesaTelemetry();
  if (context) write(context, stage, durationMs, success, { local_duration_ms: durationMs });
}

/** Marca trabalho posterior ao commit, incluindo publicação quando o chamador a aguarda. */
export function markMesaPostCommitStage(durationMs: number, success = true): void {
  const context = currentMesaTelemetry();
  if (context) write(context, "POST_COMMIT", durationMs, success, { post_commit_duration_ms: durationMs });
}
