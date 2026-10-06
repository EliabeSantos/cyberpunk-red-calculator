/** GET — metadados privados para o painel de controle do Mestre. */
import { authenticate, getMesaControlMetadata } from "@/lib/mesa/store";
import { errorResponse, ok, tokenFrom } from "@/lib/mesa/http";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const actor = await authenticate(id, tokenFrom(request));
    const combatants = await getMesaControlMetadata(id, actor.participant.id);
    return ok({ combatants });
  } catch (error) {
    return errorResponse(error);
  }
}
