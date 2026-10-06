/**
 * POST /api/mesa/[id]/combat/initiative — dois modos na mesma rota.
 *
 * 1. GM (corpo vazio/sem intenção de player): rola a iniciativa de todos.
 *    Usa `rollInitiative` de src/lib/initiative.ts (o mesmo da ficha local) para os
 *    personagens e `rollEnemyInitiative` do Combat Engine para os inimigos — o
 *    primeiro com a mesma fórmula **1d10 + REF + mods** da ficha, o segundo com
 *    **1d10 + REF + bônus de implante** (o bônus vem do seed do encontro) — e sem
 *    regra de crítico (o d10 extra não vale para Iniciativa, decisão de 27/09/2026).
 *
 * 2. Player (corpo `{ resolutionId, actorCombatantId, initiative }`): registra a
 *    PRÓPRIA iniciativa no combatant do participante, via idempotência e escrita
 *    condicional — F1.14.2. A ficha não persiste iniciativa localmente durante
 *    `mesa-combat`; este é o único caminho de escrita.
 */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { isPlayerInitiativeIntent, registerPlayerInitiative, rollInitiativeForAll } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);

    if (isPlayerInitiativeIntent(body)) {
      const result = await registerPlayerInitiative({ sessionId: id, token: tokenFrom(request), body });
      // `committed:false` = mesma `resolutionId` repetida: nada mudou, nada publica.
      if (result.committed) await publishMesaState(id);
      return ok({ ...result.result, committed: result.committed });
    }

    await rollInitiativeForAll({ sessionId: id, token: tokenFrom(request) });
    await publishMesaState(id);
    return ok();
  } catch (error) {
    return errorResponse(error);
  }
}
