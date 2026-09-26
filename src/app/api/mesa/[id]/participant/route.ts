/**
 * PATCH   /api/mesa/[id]/participant — vincula/desvincula o personagem do participante.
 * DELETE  /api/mesa/[id]/participant — sai da mesa (desconecta este navegador).
 *
 * Body do PATCH: { characterId: string | null, sheet?: Character }
 * O `sheet` vem do navegador (ficha que já existe no localStorage) e é validado
 * aqui; a cópia fica em `mesa_characters` para o servidor poder calcular sozinho.
 */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { leaveSession, linkCharacter } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const participant = await linkCharacter({
      sessionId: id,
      token: tokenFrom(request),
      characterId: body.characterId,
      sheet: body.sheet,
    });
    await publishMesaState(id);
    return ok({ participant });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Desconexão explícita: quem sai some da lista de jogadores da mesa. */
export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    await leaveSession({ sessionId: id, token: tokenFrom(request) });
    await publishMesaState(id);
    return ok();
  } catch (error) {
    return errorResponse(error);
  }
}
