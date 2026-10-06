import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { publishMesaState } from "@/lib/mesa/realtimeServer";
import { reloadIntegrated } from "@/lib/mesa/store";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

/** Reload integrado: recebe somente a intenção e resolve tudo no servidor. */
export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const outcome = await reloadIntegrated({
      sessionId: id,
      token: tokenFrom(request),
      resolutionId: body.resolutionId,
      weaponId: body.weaponId,
      actorCombatantId: body.actorCombatantId,
    });
    if (outcome.committed) await publishMesaState(id);
    return ok({ ...outcome.result });
  } catch (error) {
    return errorResponse(error);
  }
}
