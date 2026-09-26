/**
 * POST /api/mesa/[id]/combat/turn — finaliza o turno atual.
 *
 * Permitido para o dono do combatente ativo ou para o GM. Avança a lista,
 * sobe a rodada ao fim e reabre 2 ações / 6 m do próximo (Combat Engine).
 */
import { errorResponse, ok, tokenFrom } from "@/lib/mesa/http";
import { endTurn } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    await endTurn({ sessionId: id, token: tokenFrom(request) });
    await publishMesaState(id);
    return ok();
  } catch (error) {
    return errorResponse(error);
  }
}
