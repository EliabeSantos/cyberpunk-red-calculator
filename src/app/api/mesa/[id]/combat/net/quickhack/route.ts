import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { executeCombatQuickhack, MesaError } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const allowed = ["quickhackId", "targetCombatantId", "resolutionId"];
    const extra = Object.keys(body).filter((key) => !allowed.includes(key) && key !== "sessionId");
    // Compatibilidade com clientes antigos/cacheados: sessionId é apenas uma
    // redundância de rota, nunca um valor de estado ou resultado calculado.
    // Ele só pode ser aceito quando coincide exatamente com o ID da URL.
    if (typeof body.sessionId === "string" && body.sessionId !== id) {
      throw new MesaError("A sessão do Quickhack não corresponde à URL.", 400, "session_mismatch");
    }
    if (extra.length) throw new MesaError(`Quickhack aceita somente intenção; campos inválidos: ${extra.join(", ")}.`, 400, "client_authority_forbidden");
    const intent = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "sessionId"));
    const result = await executeCombatQuickhack({ sessionId: id, token: tokenFrom(request), body: intent });
    if (result.committed) await publishMesaState(id);
    return ok(result.result as unknown as Record<string, unknown>);
  } catch (error) {
    return errorResponse(error);
  }
}
