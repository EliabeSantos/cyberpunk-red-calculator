/**
 * F1.13.2 — POST /api/mesa/[id]/combat/item-heal
 *
 * Usa um item de cura (Medkit/First Aid do sistema — o que
 * `getSupplyHealAmount` já reconhece) durante uma Mesa com combate ativo.
 *
 * Body (só intenção):
 *   { resolutionId, actorCombatantId, itemId }
 *
 * Consumo do item, cálculo da cura, HP final e débito de Action acontecem numa
 * ÚNICA transação; o cliente não envia nem recebe autoridade sobre nada disso
 * antes do commit. Resposta inclui `committed` para distinguir "curou agora"
 * de retry idempotente da mesma `resolutionId`.
 */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { applyItemHealIntegrated } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const result = await applyItemHealIntegrated({
      sessionId: id,
      token: tokenFrom(request),
      body,
    });
    if (result.committed) await publishMesaState(id);
    return ok({ ...result.result, committed: result.committed });
  } catch (error) {
    return errorResponse(error);
  }
}
