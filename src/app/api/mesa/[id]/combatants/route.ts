/**
 * Combatentes (somente GM para as mutações):
 *
 * POST   — adiciona inimigos ao combate ativo   { enemies: [{ name, hp, ref }] }
 * PATCH  — ajusta HP / condições / iniciativa   { combatantId, patch: {...} }
 * DELETE — remove um inimigo                    ?combatantId=...
 */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { addEnemies, removeCombatant, updateCombatant } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    await addEnemies({ sessionId: id, token: tokenFrom(request), enemies: body.enemies });
    await publishMesaState(id);
    return ok();
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    await updateCombatant({ sessionId: id, token: tokenFrom(request), combatantId: body.combatantId, patch: body.patch });
    await publishMesaState(id);
    return ok();
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const combatantId = new URL(request.url).searchParams.get("combatantId");
    await removeCombatant({ sessionId: id, token: tokenFrom(request), combatantId });
    await publishMesaState(id);
    return ok();
  } catch (error) {
    return errorResponse(error);
  }
}
