import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { publishMesaState } from "@/lib/mesa/realtimeServer";
import { attackIntegrated } from "@/lib/mesa/store";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

/** Ataque integrado: recebe intenção e devolve somente o AttackResult do Engine. */
export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const outcome = await attackIntegrated({
        sessionId: id,
        token: tokenFrom(request),
        resolutionId: body.resolutionId,
      actorId: body.actorId,
      targetId: body.targetId,
      weaponId: body.weaponId,
      skillId: body.skillId,
      attackType: body.attackType,
      attackMode: body.attackMode,
      aimedTarget: body.aimedTarget,
    });
    if (outcome.committed) await publishMesaState(id);
    return ok(outcome.result);
  } catch (error) {
    return errorResponse(error);
  }
}
