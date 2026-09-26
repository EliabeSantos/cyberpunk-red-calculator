/**
 * POST /api/mesa/[id]/combat/roll — registra um dado rolado na ficha.
 *
 * Body: { roll: { type, label, expression, total, rolls } }
 *
 * A rolagem vira AÇÃO da mesa quando o tipo tem custo (ataque, perícia,
 * Evasion): o servidor valida com `resolveAction` — mesma regra do botão
 * ATAQUE — e debita 1 Action. Dano, dano recebido e rolagem livre só entram
 * no Registro do combate, sem custo. Fora do turno a rolagem entra marcada
 * como "não contou"; sem combate ativo, `registered: false` e nada muda.
 *
 * A ficha rola o dado antes de chamar isto — por isso um erro aqui nunca
 * desfaz a rolagem local: o chamador é fire-and-forget.
 */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { registerRoll } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const result = await registerRoll({
      sessionId: id,
      token: tokenFrom(request),
      roll: body.roll,
    });
    if (result.registered) await publishMesaState(id);
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
