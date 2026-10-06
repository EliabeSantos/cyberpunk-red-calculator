/** POST /api/mesa/[id]/combat/death-save — intenção de Death Save do Player. */
import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { registerPlayerDeathSave } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

interface Context { params: Promise<{ id: string }> }

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const { id } = await context.params;
    const result = await registerPlayerDeathSave({ sessionId: id, token: tokenFrom(request), body: await readJson(request) });
    if (result.committed) await publishMesaState(id);
    return ok({ ...result.result, committed: result.committed });
  } catch (error) {
    return errorResponse(error);
  }
}
