import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { publishMesaState } from "@/lib/mesa/realtimeServer";
import { MesaError, resolveCombatantDetection } from "@/lib/mesa/store";

export const runtime = "nodejs";

interface Context { params: Promise<{ id: string }> }

/** Recebe somente a intenção observer/target; rolagem e resultado são server-side. */
export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const extra = Object.keys(body).filter((key) => !["observerCombatantId", "targetCombatantId"].includes(key));
    if (extra.length) throw new MesaError("Resultado de Detection é server-authoritative.", 400, "client_authority_forbidden");
    const result = await resolveCombatantDetection({
      sessionId: id,
      token: tokenFrom(request),
      observerCombatantId: body.observerCombatantId,
      targetCombatantId: body.targetCombatantId,
    });
    if (result.changed) await publishMesaState(id);
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
