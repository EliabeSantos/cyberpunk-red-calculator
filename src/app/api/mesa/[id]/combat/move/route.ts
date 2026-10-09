/** POST /api/mesa/[id]/combat/move — registra movimento do próprio personagem. */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { movePlayerCombatant } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";
import { markMesaPostCommitStage } from "@/lib/mesa/telemetryServer";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const result = await movePlayerCombatant({ sessionId: id, token: tokenFrom(request), body: await readJson(request) });
    const postCommitStartedAt = performance.now();
    if (result.committed) await publishMesaState(id);
    markMesaPostCommitStage(performance.now() - postCommitStartedAt);
    return ok({ ...result.result, committed: result.committed });
  } catch (error) {
    return errorResponse(error);
  }
}
