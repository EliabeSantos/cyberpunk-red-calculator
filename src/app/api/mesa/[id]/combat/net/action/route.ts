import { errorResponse, ok, readJson, tokenFrom } from "@/lib/mesa/http";
import { executeNetAction, MesaError } from "@/lib/mesa/store";
import { publishMesaState } from "@/lib/mesa/realtimeServer";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const extra = Object.keys(body).filter((key) => !["action", "targetId", "resolutionId"].includes(key));
    if (extra.length) throw new MesaError("NET Action aceita somente intenção; o estado é server-authoritative.", 400, "client_authority_forbidden");
    const result = await executeNetAction({ sessionId: id, token: tokenFrom(request), body });
    if (result.committed) await publishMesaState(id);
    return ok(result.result as unknown as Record<string, unknown>);
  } catch (error) {
    return errorResponse(error);
  }
}
