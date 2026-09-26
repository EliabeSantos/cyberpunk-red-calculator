/**
 * GET  /api/mesa/[id] — estado completo da mesa (validado pelo playerToken).
 * DELETE /api/mesa/[id] — encerra a sessão (somente GM).
 */
import { errorResponse, ok, tokenFrom } from "@/lib/mesa/http";
import { authenticate, finishSession, getMesaState } from "@/lib/mesa/store";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const { participant } = await authenticate(id, tokenFrom(request));
    const state = await getMesaState(id, participant.id);
    return ok({ state });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    await finishSession({ sessionId: id, token: tokenFrom(request) });
    return ok();
  } catch (error) {
    return errorResponse(error);
  }
}
