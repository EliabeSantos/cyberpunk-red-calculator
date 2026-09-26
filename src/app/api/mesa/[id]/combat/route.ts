/**
 * POST   /api/mesa/[id]/combat      — inicia o combate (somente GM).
 * DELETE /api/mesa/[id]/combat      — encerra o combate (somente GM).
 *
 * Body do POST: { enemies?: [{ name, hp, ref }] }
 * Os personagens entram pelos vínculos participante → personagem; os inimigos
 * vêm do painel do GM (catálogo local já existente em src/lib/gmStorage.ts).
 */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { endCombat, startCombat } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    await startCombat({ sessionId: id, token: tokenFrom(request), enemies: body.enemies });
    await publishMesaState(id);
    return ok();
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    await endCombat({ sessionId: id, token: tokenFrom(request) });
    await publishMesaState(id);
    return ok();
  } catch (error) {
    return errorResponse(error);
  }
}
