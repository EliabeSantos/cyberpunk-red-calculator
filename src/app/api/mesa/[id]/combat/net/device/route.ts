/**
 * F1.62 — intenção de efeito de dispositivo (CONTROL → DOOR OPEN/CLOSE).
 *
 * A rota é apenas transporte: `executeControlDeviceEffect` valida Mesa,
 * papel, Netrunner, Jack In, Access Point, Control Node, descoberta,
 * autorização, objeto, tipo, ação e estado a partir do que está persistido.
 * O corpo aceita somente `objectId` + `action`; qualquer estado enviado pelo
 * cliente (`state`, `type`, `controlNodeId`...) é rejeitado como
 * `client_authority_forbidden`.
 */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { executeControlDeviceEffect } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const { result, changed } = await executeControlDeviceEffect({ sessionId: id, token: tokenFrom(request), body });
    // Realtime: só o estado resolvido no servidor chega aos outros clientes.
    if (changed) await publishMesaState(id);
    return ok(result as unknown as Record<string, unknown>);
  } catch (error) {
    return errorResponse(error);
  }
}
