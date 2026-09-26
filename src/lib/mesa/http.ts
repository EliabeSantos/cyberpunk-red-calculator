/**
 * Helpers HTTP das rotas /api/mesa (SOMENTE SERVIDOR).
 *
 * O playerToken viaja no header `x-mesa-token`. Ele NUNCA entra em cookie,
 * query string ou URL — assim não vaza por logs nem por histórico do navegador.
 */

import { DatabaseNotConfiguredError, DatabaseQueryError } from "@/lib/supabaseAdmin";
import { MesaError, messageForError } from "@/lib/mesa/store";

export const TOKEN_HEADER = "x-mesa-token";

export function tokenFrom(request: Request): string | undefined {
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
  if (error instanceof MesaError) {
    return Response.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof DatabaseNotConfiguredError) {
    return Response.json({ ok: false, error: error.message, code: "database_not_configured" }, { status: 503 });
  }
  if (error instanceof DatabaseQueryError) {
    return Response.json({ ok: false, error: error.message, code: "database_error" }, { status: 502 });
  }
  return Response.json({ ok: false, error: messageForError(error), code: "unknown" }, { status: 500 });
}

export function ok(payload: Record<string, unknown> = {}, status = 200): Response {
  return Response.json({ ok: true, ...payload }, { status });
}
