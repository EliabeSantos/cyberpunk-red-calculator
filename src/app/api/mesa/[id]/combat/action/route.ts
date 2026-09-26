/**
 * POST /api/mesa/[id]/combat/action — executa uma ação e debita o orçamento.
 *
 * Body: { combatantId, actionType: "attack" | "move" | "item" | "other", meters? }
 *
 * A validação REAL acontece aqui no servidor (`resolveAction` do Combat Engine):
 * combate ativo? iniciativa rolada? é seu turno? é seu combatente? sobrou ação?
 * Se qualquer etapa falhar, retorna 4xx e NADA é alterado no banco.
 */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { performAction } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    await performAction({
      sessionId: id,
      token: tokenFrom(request),
      combatantId: body.combatantId,
      actionType: body.actionType,
      meters: body.meters,
    });
    await publishMesaState(id);
    return ok();
  } catch (error) {
    return errorResponse(error);
  }
}
