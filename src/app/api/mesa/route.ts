/**
 * POST /api/mesa — cria uma mesa e o participante Mestre.
 *
 * Body: { name, displayName }
 * Header: x-mesa-token (identidade efetiva; gerado no navegador)
 */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { createMesa } from "@/lib/mesa/store";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson(request);
    const result = await createMesa({
      name: body.name,
      displayName: body.displayName,
      playerToken: tokenFrom(request),
    });
    return ok({ session: result.session, participant: result.participant });
  } catch (error) {
    return errorResponse(error);
  }
}
