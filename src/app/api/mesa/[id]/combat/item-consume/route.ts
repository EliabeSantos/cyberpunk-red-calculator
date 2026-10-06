/**
 * F1.13.1 — POST /api/mesa/[id]/combat/item-consume
 *
 * Consome unidades de um item da mochila autoritativa do combatente
 * durante uma Mesa com combate ativo.
 *
 * Body:
 *   { resolutionId, actorCombatantId, itemId, amount }
 *
 * O resultado (quantidade restante, Actions debitadas) é computado e
 * persistido pelo servidor; o cliente manda somente a intenção.
 */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { consumeItemIntegrated } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const result = await consumeItemIntegrated({
      sessionId: id,
      token: tokenFrom(request),
      combatantId: body.actorCombatantId,
      itemId: body.itemId,
      amount: body.amount,
      resolutionId: body.resolutionId,
    });
    if (result.committed) await publishMesaState(id);
    // `committed` distingue "consumiu agora" de "mesma resolução repetida"
    // (retry idempotente devolve o resultado persistido sem consumir de novo).
    return ok({ ...result.result, committed: result.committed });
  } catch (error) {
    return errorResponse(error);
  }
}
