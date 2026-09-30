/**
 * POST /api/mesa/[id]/combat/initiative — rola a iniciativa de todos (somente GM).
 *
 * Usa `rollInitiative` de src/lib/initiative.ts (o mesmo da ficha local) para os
 * personagens e `rollEnemyInitiative` do Combat Engine para os inimigos — o
 * primeiro com a mesma fórmula **1d10 + REF + mods** da ficha, o segundo com
 * **1d10 + REF + bônus de implante** (o bônus vem do seed do encontro) — e sem
 * regra de crítico (o d10 extra não vale para Iniciativa, decisão de 27/09/2026).
 */
import { errorResponse, ok, tokenFrom } from "@/lib/mesa/http";
import { rollInitiativeForAll } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    await rollInitiativeForAll({ sessionId: id, token: tokenFrom(request) });
    await publishMesaState(id);
    return ok();
  } catch (error) {
    return errorResponse(error);
  }
}
