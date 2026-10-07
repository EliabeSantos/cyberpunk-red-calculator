import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { updateTacticalMap } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    await updateTacticalMap({ sessionId: id, token: tokenFrom(request), map: body.map });
    await publishMesaState(id);
    return ok();
  } catch (error) {
    return errorResponse(error);
  }
}
