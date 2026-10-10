/**
 * Helpers HTTP das rotas /api/mesa (SOMENTE SERVIDOR).
 *
 * O playerToken viaja no header `x-mesa-token`. Ele NUNCA entra em cookie,
 * query string ou URL — assim não vaza por logs nem por histórico do navegador.
 */

import { DatabaseNotConfiguredError, DatabaseQueryError } from "@/lib/supabaseAdmin";
import { MesaError } from "@/lib/mesa/store";
import { beginMesaGatewayTelemetry, finishMesaGatewayTelemetry } from "@/lib/mesa/telemetryServer";
import { randomUUID } from "node:crypto";

export const TOKEN_HEADER = "x-mesa-token";

export function tokenFrom(request: Request): string | undefined {
  beginMesaGatewayTelemetry(request);
  return request.headers.get(TOKEN_HEADER) ?? undefined;
}

/** Lê o corpo JSON sem lançar: corpo inválido vira `{}` (as validações de domínio reclamam). */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    if (Array.isArray(body)) return { body };
    return {};
  } catch {
    return {};
  }
}

/** Converte qualquer erro em Response JSON com status adequado. */
export function errorResponse(error: unknown): Response {
  finishMesaGatewayTelemetry(false, error instanceof MesaError ? "expected_rejection" : "infrastructure_error");
  if (error instanceof MesaError && error.status < 500) {
    return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  const errorId = randomUUID();
  const errorName = error instanceof Error ? error.name : "UnknownError";
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;
  // Detalhes técnicos ficam somente no log do servidor. Redige URLs de banco e
  // valores de autenticação para que um driver não os replique acidentalmente.
  const safeLog = (value: string) => value
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[redacted]")
    .replace(/(authorization|token|key|secret|password)=?[^\s,;]+/gi, "$1=[redacted]");
  console.error(`[mesa-error:${errorId}] ${errorName}: ${safeLog(errorMessage)}`, errorStack ? safeLog(errorStack) : "");
  if (error instanceof DatabaseNotConfiguredError) {
    return Response.json({ ok: false, error: "O serviço de Mesa está temporariamente indisponível.", code: "database_not_configured", errorId }, { status: 503 });
  }
  if (error instanceof DatabaseQueryError) {
    return Response.json({ ok: false, error: "Não foi possível carregar a Mesa agora. Tente novamente.", code: "database_error", errorId }, { status: 502 });
  }
  return Response.json({ ok: false, error: "Ocorreu um erro interno ao carregar a Mesa.", code: "internal_error", errorId }, { status: 500 });
}

export function ok(payload: Record<string, unknown> = {}, status = 200): Response {
  finishMesaGatewayTelemetry(true, "success");
  return Response.json({ ok: true, ...payload }, { status });
}
